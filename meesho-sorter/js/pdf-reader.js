/*
 * PDF text extraction (PDF.js).
 *
 * Worker strategy (so the tool works when double-clicked from disk):
 *  1. Single-file build: the PDF.js worker source is embedded in the page. We try to start it
 *     as a Blob worker (real background thread).
 *  2. If Chrome refuses workers on file://, we evaluate the same worker code on the main thread
 *     (PDF.js "fake worker"). Still works, just slightly slower on huge PDFs.
 *  3. Multi-file build (index.html + vendor/): on http(s) the worker is loaded from
 *     vendor/pdf.worker.min.js; on file:// the worker script is loaded with a <script> tag.
 */
(function (g) {
  "use strict";
  var MPS = (g.MPS = g.MPS || {});

  /* ---------------- text items -> visual lines (pure, testable) ---------------- */

  function toTextPositions(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      var t = it.transform || [1, 0, 0, 1, 0, 0];
      out.push({
        x: t[4],
        y: t[5],
        w: it.width || 0,
        h: it.height || Math.abs(t[3]) || 8,
        str: it.str,
      });
    }
    return out;
  }

  /** Group text items into visual lines (same baseline), keeping x/y geometry. */
  function buildLines(items) {
    var sorted = items.slice().sort(function (a, b) {
      return b.y - a.y || a.x - b.x;
    });
    var lines = [];
    sorted.forEach(function (it) {
      var tol = Math.max(2.2, (it.h || 8) * 0.55);
      var line = null;
      for (var i = 0; i < lines.length; i++) {
        if (Math.abs(lines[i].y - it.y) <= tol) {
          line = lines[i];
          break;
        }
      }
      if (line) {
        line.items.push(it);
        line.y = (line.y * (line.items.length - 1) + it.y) / line.items.length;
      } else {
        lines.push({ y: it.y, items: [it], text: "" });
      }
    });
    lines.forEach(function (line) {
      line.items.sort(function (a, b) {
        return a.x - b.x;
      });
      var text = "";
      var prevEnd = null;
      line.items.forEach(function (it) {
        var s = it.str;
        if (!s) return;
        if (prevEnd !== null) {
          var gap = it.x - prevEnd;
          var needsSpace = gap > Math.max(1, (it.h || 8) * 0.18);
          if (needsSpace && !/\s$/.test(text) && !/^\s/.test(s)) text += " ";
        }
        text += s;
        prevEnd = it.x + it.w;
      });
      line.text = text.replace(/\s+/g, " ").trim();
    });
    return lines.sort(function (a, b) {
      return b.y - a.y;
    });
  }

  /* ----------------------------- PDF.js engine ----------------------------- */

  var engineMode = null; // "worker" | "main"
  var workerBlobUrl = null;

  function workerSourceText() {
    var el = document.getElementById("pdfjs-worker-src");
    return el ? el.textContent : null;
  }

  function externalWorkerPath() {
    var meta = document.querySelector('meta[name="pdfjs-worker-src"]');
    return meta ? meta.getAttribute("content") : "vendor/pdf.worker.min.js";
  }

  function probeBlobWorkers() {
    return new Promise(function (resolve) {
      var url, w, timer;
      try {
        url = URL.createObjectURL(new Blob(["self.postMessage(1)"], { type: "text/javascript" }));
        w = new Worker(url);
      } catch (e) {
        resolve(false);
        return;
      }
      function done(ok) {
        clearTimeout(timer);
        try {
          w.terminate();
          URL.revokeObjectURL(url);
        } catch (e) {
          /* ignore */
        }
        resolve(ok);
      }
      timer = setTimeout(function () {
        done(false);
      }, 2500);
      w.onmessage = function () {
        done(true);
      };
      w.onerror = function () {
        done(false);
      };
    });
  }

  function injectScript(opts) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      if (opts.text) {
        s.text = opts.text;
        document.head.appendChild(s);
        resolve();
        return;
      }
      s.src = opts.src;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Could not load " + opts.src));
      };
      document.head.appendChild(s);
    });
  }

  function initEngine() {
    if (engineMode) return Promise.resolve(engineMode);
    if (!g.pdfjsLib) {
      return Promise.reject(new Error("The PDF.js library (vendor/pdf.min.js) failed to load."));
    }
    var inline = workerSourceText();
    var isHttp = /^https?:$/.test(location.protocol);

    function useMainThread() {
      var p = inline ? injectScript({ text: inline }) : injectScript({ src: externalWorkerPath() });
      return p.then(function () {
        engineMode = "main";
        return engineMode;
      });
    }

    if (inline) {
      return probeBlobWorkers().then(function (ok) {
        if (!ok) return useMainThread();
        workerBlobUrl = URL.createObjectURL(new Blob([inline], { type: "text/javascript" }));
        engineMode = "worker";
        return engineMode;
      });
    }
    if (isHttp) {
      g.pdfjsLib.GlobalWorkerOptions.workerSrc = externalWorkerPath();
      engineMode = "worker";
      return Promise.resolve(engineMode);
    }
    return useMainThread();
  }

  function PasswordRequiredError(wrong) {
    this.name = "PasswordRequiredError";
    this.wrongPassword = !!wrong;
    this.message = wrong ? "Incorrect password." : "This PDF is password protected.";
  }
  PasswordRequiredError.prototype = Object.create(Error.prototype);

  /** Open a PDF. `data` is an ArrayBuffer (a private copy is made for PDF.js). */
  function loadPdf(arrayBuffer, password) {
    return initEngine().then(function (mode) {
      var rawWorker = null;
      var params = {
        data: new Uint8Array(arrayBuffer.slice(0)),
        password: password || undefined,
        isEvalSupported: false,
      };
      var pdfWorker = null;
      if (mode === "worker" && workerBlobUrl) {
        rawWorker = new Worker(workerBlobUrl);
        pdfWorker = new g.pdfjsLib.PDFWorker({ port: rawWorker });
        params.worker = pdfWorker;
      }
      function cleanup() {
        try {
          if (pdfWorker) pdfWorker.destroy();
        } catch (e) {
          /* ignore */
        }
        try {
          if (rawWorker) rawWorker.terminate();
        } catch (e) {
          /* ignore */
        }
      }
      var task = g.pdfjsLib.getDocument(params);
      return task.promise.then(
        function (doc) {
          return {
            doc: doc,
            numPages: doc.numPages,
            destroy: function () {
              return Promise.resolve(doc.destroy())
                .catch(function () {})
                .then(cleanup);
            },
          };
        },
        function (err) {
          cleanup();
          var name = err && err.name;
          if (name === "PasswordException") throw new PasswordRequiredError(err.code === 2);
          if (name === "InvalidPDFException")
            throw new Error("This file is not a valid PDF, or it is corrupted.");
          if (name === "MissingPDFException") throw new Error("The PDF file could not be found.");
          throw new Error((err && err.message) || "The PDF could not be opened.");
        },
      );
    });
  }

  /** Extract positioned text lines for one page (1-based). */
  function extractPageLines(doc, pageNumber) {
    return doc.getPage(pageNumber).then(function (page) {
      return page
        .getTextContent({ includeMarkedContent: false })
        .then(function (content) {
          var items = toTextPositions(content.items);
          return { lines: buildLines(items), empty: items.length === 0 };
        })
        .then(
          function (r) {
            page.cleanup();
            return r;
          },
          function (e) {
            page.cleanup();
            throw e;
          },
        );
    });
  }

  /** Draw a page onto a canvas for the page inspector. */
  function renderPage(doc, pageNumber, canvas, maxWidth) {
    return doc.getPage(pageNumber).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(2, Math.max(0.4, (maxWidth || 640) / base.width));
      var viewport = page.getViewport({ scale: scale });
      var ctx = canvas.getContext("2d");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        page.cleanup();
      });
    });
  }

  MPS.reader = {
    toTextPositions: toTextPositions,
    buildLines: buildLines,
    loadPdf: loadPdf,
    extractPageLines: extractPageLines,
    renderPage: renderPage,
    PasswordRequiredError: PasswordRequiredError,
    getMode: function () {
      return engineMode;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
