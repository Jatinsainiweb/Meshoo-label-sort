/* PDF generation (pdf-lib) and ZIP packaging (JSZip). Pages are COPIED, never redrawn. */
(function (g) {
  "use strict";
  var MPS = (g.MPS = g.MPS || {});
  var CHUNK = 20;

  function U() {
    return MPS.utils;
  }

  function loadSource(bytes) {
    return g.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  }

  async function copyPages(src, pageNumbers, onProgress, isCancelled) {
    var out = await g.PDFLib.PDFDocument.create();
    var done = 0;
    for (var i = 0; i < pageNumbers.length; i += CHUNK) {
      if (isCancelled()) throw new Error("cancelled");
      var slice = pageNumbers.slice(i, i + CHUNK).map(function (p) {
        return p - 1;
      });
      var copied = await out.copyPages(src, slice);
      copied.forEach(function (pg) {
        out.addPage(pg);
      });
      done += slice.length;
      onProgress(done);
      await U().yieldToUi();
    }
    return out;
  }

  /** Page order for the combined PDF: original order, or SKU blocks (original order inside). */
  function resolvePageOrder(selected, groupBySku) {
    var cmp = function (a, b) {
      return a - b;
    };
    if (groupBySku) {
      var out = [];
      // SKU blocks appear in the order each SKU first occurs in the source PDF (deterministic).
      var ordered = selected
        .filter(function (grp) {
          return grp.pages.length;
        })
        .sort(function (a, b) {
          return Math.min.apply(null, a.pages) - Math.min.apply(null, b.pages);
        });
      ordered.forEach(function (grp) {
        grp.pages.slice().sort(cmp).forEach(function (p) {
          out.push(p);
        });
      });
      return out;
    }
    var seen = {};
    selected.forEach(function (grp) {
      grp.pages.forEach(function (p) {
        seen[p] = true;
      });
    });
    return Object.keys(seen).map(Number).sort(cmp);
  }

  /** Mode A: one combined PDF. opts: selected, groupBySku, sourceBytes, onProgress, isCancelled */
  async function generateCombined(opts) {
    var pages = resolvePageOrder(opts.selected, opts.groupBySku);
    if (!pages.length) throw new Error("No pages are mapped to the selected products.");
    opts.onProgress({ stage: "Opening source PDF", done: 0, total: pages.length });
    var src = await loadSource(opts.sourceBytes);
    var out = await copyPages(
      src,
      pages,
      function (d) {
        opts.onProgress({ stage: "Copying original pages", done: d, total: pages.length });
      },
      opts.isCancelled,
    );
    opts.onProgress({ stage: "Writing PDF", done: pages.length, total: pages.length });
    var bytes = await out.save({ useObjectStreams: true });
    var stamp = U().todayStamp();
    var name;
    if (opts.selected.length === 1) {
      var s = opts.selected[0];
      name =
        "Meesho_" +
        U().sanitizeFileName(s.sku || "SKU-Not-Detected", 40) +
        "_" +
        U().sanitizeFileName(s.name === "—" ? "pages" : s.name, 40) +
        "_" +
        stamp +
        ".pdf";
    } else {
      name = "Meesho_Filtered_Labels_" + stamp + ".pdf";
    }
    return { name: name, blob: new Blob([bytes], { type: "application/pdf" }), pages: pages.length, pageList: pages };
  }

  /** Mode B: one PDF per SKU, packed in a ZIP. */
  async function generateSeparateZip(opts) {
    var total = opts.selected.reduce(function (n, grp) {
      return n + grp.pages.length;
    }, 0);
    if (!total) throw new Error("No pages are mapped to the selected products.");
    opts.onProgress({ stage: "Opening source PDF", done: 0, total: total });
    var src = await loadSource(opts.sourceBytes);
    var zip = new g.JSZip();
    var used = {};
    var done = 0;

    for (var k = 0; k < opts.selected.length; k++) {
      var grp = opts.selected[k];
      if (opts.isCancelled()) throw new Error("cancelled");
      var pages = grp.pages.slice().sort(function (a, b) {
        return a - b;
      });
      var base = done;
      var out = await copyPages(
        src,
        pages,
        function (d) {
          opts.onProgress({
            stage: "Building PDF for " + (grp.sku || "unclassified pages"),
            done: base + d,
            total: total,
          });
        },
        opts.isCancelled,
      );
      done += pages.length;
      var bytes = await out.save({ useObjectStreams: true });
      var skuPart = U().sanitizeFileName(grp.sku || "SKU-Not-Detected", 40);
      var namePart = U().sanitizeFileName(grp.name === "—" ? "pages" : grp.name, 50);
      var fileName = skuPart + "__" + namePart + "__" + pages.length + "pages.pdf";
      var n = 2;
      while (used[fileName.toLowerCase()]) {
        fileName = skuPart + "__" + namePart + "__" + pages.length + "pages (" + n++ + ").pdf";
      }
      used[fileName.toLowerCase()] = true;
      zip.file(fileName, bytes);
      await U().yieldToUi();
    }

    opts.onProgress({ stage: "Compressing ZIP", done: total, total: total });
    var blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } },
      function (meta) {
        opts.onProgress({ stage: "Compressing ZIP (" + Math.round(meta.percent) + "%)", done: total, total: total });
      },
    );
    return { name: "Meesho_Labels_By_SKU_" + U().todayStamp() + ".zip", blob: blob, pages: total };
  }

  MPS.generate = {
    resolvePageOrder: resolvePageOrder,
    generateCombined: generateCombined,
    generateSeparateZip: generateSeparateZip,
  };
})(typeof window !== "undefined" ? window : globalThis);
