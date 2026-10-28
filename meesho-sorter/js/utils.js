/* Utilities: formatting, safe filenames, CSV, downloads. No DOM needed except downloadBlob. */
(function (g) {
  "use strict";
  var MPS = (g.MPS = g.MPS || {});

  function formatBytes(bytes) {
    if (!isFinite(bytes) || bytes <= 0) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    var v = bytes / Math.pow(1024, i);
    return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)) + " " + units[i];
  }

  /** Make a string safe for a Windows / macOS / Linux file name. */
  function sanitizeFileName(input, maxLen) {
    maxLen = maxLen || 60;
    var cleaned = String(input || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();
    var safe = cleaned.replace(/[^A-Za-z0-9 ._()\-+]/g, "-").replace(/-{2,}/g, "-");
    var trimmed = safe.slice(0, maxLen).replace(/[-. ]+$/g, "");
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(trimmed)) trimmed = "_" + trimmed;
    return trimmed.length ? trimmed : "untitled";
  }

  function todayStamp() {
    var d = new Date();
    function p(n) {
      return String(n).padStart(2, "0");
    }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /** [1,2,3,7,9,10] -> "1-3, 7, 9-10" */
  function formatPageRanges(pages, max) {
    if (!pages.length) return "—";
    max = max || Infinity;
    var sorted = pages.slice().sort(function (a, b) {
      return a - b;
    });
    var parts = [];
    var start = sorted[0];
    var prev = sorted[0];
    for (var i = 1; i <= sorted.length; i++) {
      var cur = sorted[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      parts.push(start === prev ? "" + start : start + "-" + prev);
      start = cur;
      prev = cur;
    }
    if (parts.length <= max) return parts.join(", ");
    return parts.slice(0, max).join(", ") + " … (+" + (parts.length - max) + " more)";
  }

  function yieldToUi() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
  }

  function toCsv(rows) {
    return rows
      .map(function (row) {
        return row
          .map(function (cell) {
            var s = cell === null || cell === undefined ? "" : String(cell);
            // Guard against spreadsheet formula injection from untrusted PDF text.
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replace(/"/g, '""') + '"';
          })
          .join(",");
      })
      .join("\r\n");
  }

  MPS.utils = {
    formatBytes: formatBytes,
    sanitizeFileName: sanitizeFileName,
    todayStamp: todayStamp,
    formatPageRanges: formatPageRanges,
    yieldToUi: yieldToUi,
    downloadBlob: downloadBlob,
    toCsv: toCsv,
  };
})(typeof window !== "undefined" ? window : globalThis);
