/*
 * SKU / product-name / order-id detection.
 *
 * Input: positioned text lines from pdf-reader.js. We read the *table column* under a "SKU"
 * header rather than guessing "the first number", then validate the value so order ids, HSN,
 * GSTIN, invoice numbers, dates, prices and phone numbers are never taken for a SKU.
 * All PDF text is untrusted data: it is only ever compared / displayed as text.
 */
(function (g) {
  "use strict";
  var MPS = (g.MPS = g.MPS || {});

  function norm(s) {
    return s
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  function clean(s) {
    return s.replace(/\s+/g, " ").trim();
  }

  var STOPWORDS = {};
  [
    "sku", "size", "qty", "quantity", "color", "colour", "order", "orderno", "order no", "free",
    "free size", "na", "n a", "none", "nil", "null", "product", "description", "hsn", "total",
    "price", "amount", "item", "details", "default",
  ].forEach(function (w) {
    STOPWORDS[w] = true;
  });

  var GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i;
  var DATE_RE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;
  var MONEY_RE = /^(rs\.?|inr|₹)?\s*\d+[.,]\d{2}$/i;
  var PHONE_RE = /^(\+?91)?[6-9]\d{9}$/;

  /** Structural validation: permissive about characters, strict about known non-SKU shapes. */
  function isPlausibleSku(raw) {
    var v = raw.trim().replace(/^[:\-–—|,]+|[:,.;|]+$/g, "").trim();
    if (!v) return false;
    if (v.length > 60) return false;
    if (STOPWORDS[norm(v)]) return false;
    if (GSTIN_RE.test(v)) return false;
    if (DATE_RE.test(v)) return false;
    if (MONEY_RE.test(v)) return false;
    if (PHONE_RE.test(v)) return false;
    if (!/[A-Za-z0-9]/.test(v)) return false;
    if (/^\d{1,2}$/.test(v)) return false; // quantity / serial number
    if (v.split(/\s+/).length > 3) return false; // free text = product name
    return true;
  }

  function tidySku(raw) {
    var v = raw.trim().replace(/^[:\-–—|,]+/, "").replace(/[:,.;|]+$/, "").trim();
    // drop an unbalanced closing bracket picked up from "(SKU: X)"
    while (/[)\]}]$/.test(v) && !/[([{]/.test(v)) v = v.slice(0, -1).trim();
    return v;
  }

  /* ---------------------- table-column reader ---------------------- */

  function findHeaderColumn(lines, matches, requireSiblings) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (requireSiblings && requireSiblings.length) {
        var lineNorm = norm(line.text);
        var ok = requireSiblings.some(function (s) {
          return lineNorm.indexOf(s) !== -1;
        });
        if (!ok) continue;
      }
      for (var j = 0; j < line.items.length; j++) {
        var item = line.items[j];
        if (!matches(norm(item.str))) continue;
        var next = line.items[j + 1];
        return {
          headerLineIndex: i,
          x0: item.x - 2,
          x1: next ? next.x - 1 : item.x + Math.max(item.w, 40) * 3,
        };
      }
    }
    return null;
  }

  function readColumnCell(lines, col, opts) {
    opts = opts || {};
    var maxLines = opts.maxLines || 3;
    var collected = [];
    var headerY = lines[col.headerLineIndex].y;
    var scanned = 0;
    for (var i = col.headerLineIndex + 1; i < lines.length && scanned < maxLines + 2; i++) {
      var line = lines[i];
      if (headerY - line.y > 140) break; // fell into a different block of the page
      if (opts.stopRe && opts.stopRe.test(line.text)) break;
      scanned++;
      var inCell = line.items.filter(function (it) {
        var center = it.x + it.w / 2;
        return it.x >= col.x0 - 3 && (center < col.x1 || it.x < col.x1 - 2);
      });
      if (!inCell.length) {
        if (collected.length) break;
        continue;
      }
      var text = clean(
        inCell
          .map(function (it) {
            return it.str;
          })
          .join(" "),
      );
      if (!text) {
        if (collected.length) break;
        continue;
      }
      collected.push(text);
      if (!opts.joinAll) break;
      if (collected.length >= maxLines) break;
    }
    return { value: clean(collected.join(" ")), lines: collected };
  }

  /* ------------------------------ SKU ------------------------------ */

  function isSkuHeader(t) {
    return t === "sku" || t === "sku id" || t === "seller sku" || t === "sku code" || t === "skus";
  }
  var SKU_LABEL_RE = /(?:seller\s*sku|sku\s*(?:id|code|no|number)?)\s*[:\-–]\s*([^\s|,;)\]]{2,60})/i;
  var SKU_IN_PARENS_RE = /\(\s*sku\s*[:\-]?\s*([^)]{2,60})\)/i;

  function detectSku(lines, fullText) {
    var out = [];
    function push(value, source, confidence) {
      var v = tidySku(value);
      if (!v || !isPlausibleSku(v)) return;
      for (var i = 0; i < out.length; i++) if (out[i].value === v) return;
      out.push({ value: v, source: source, confidence: confidence });
    }

    // 1. column under "SKU" inside a real product table (Size / Qty / Color / Order No. siblings)
    var strict = findHeaderColumn(lines, isSkuHeader, [
      "size", "qty", "color", "colour", "order no", "order number", "quantity",
    ]);
    if (strict) {
      var cell = readColumnCell(lines, strict, { maxLines: 2 });
      if (cell.value) push(cell.value, "Product table column", "high");
    }

    // 2. column under a bare "SKU" header
    if (!out.length) {
      var loose = findHeaderColumn(lines, isSkuHeader);
      if (loose) {
        var c2 = readColumnCell(lines, loose, { maxLines: 2 });
        if (c2.value) push(c2.value, "SKU column", "medium");
      }
    }

    // 3. "SKU: value" written inline
    var m = fullText.match(SKU_LABEL_RE);
    if (m) push(m[1], "Inline SKU label", out.length ? "low" : "medium");

    // 4. "Product name (SKU: value)"
    var p = fullText.match(SKU_IN_PARENS_RE);
    if (p) push(p[1], "SKU in description", out.length ? "low" : "medium");

    // 5. a line that starts with SKU and holds one token
    if (!out.length) {
      for (var i = 0; i < lines.length; i++) {
        var lm = lines[i].text.match(/^sku\b[^A-Za-z0-9]{0,4}([^\s|,;]{2,60})$/i);
        if (lm) {
          push(lm[1], "SKU line", "medium");
          break;
        }
      }
    }
    return out;
  }

  /* ------------------------- product / item name ------------------------- */

  var DESC_HEADERS = {
    "description": 1, "description of goods": 1, "product details": 1, "product name": 1,
    "item name": 1, "item description": 1, "product": 1,
  };
  function isDescHeader(t) {
    return DESC_HEADERS[t] === 1;
  }
  var NAME_STOP_RE =
    /^(total|sub\s*total|taxable|tax(es)?\b|grand total|other charges|shipping|amount|tax is not|all values|declaration|signature|includes|discount)/i;
  var NAME_NOISE_RE =
    /^(hsn|sgst|cgst|igst|qty|quantity|gross amount|discount|taxable value|total|rs\.?|inr|₹|\d+(\.\d+)?%?)$/i;

  function cleanName(raw) {
    var v = raw
      .replace(/\s+/g, " ")
      .replace(/\(\s*sku\s*[:\-]?[^)]*\)/gi, " ")
      .replace(/\bsku\s*[:\-]\s*[^\s|,;]+/gi, " ")
      .replace(/\bhsn\s*(code)?\s*[:\-]?\s*\d+/gi, " ")
      .replace(/^[\s|,:;\-–—]+/, "")
      .replace(/[\s|,:;]+$/, "")
      .trim();
    v = v.replace(/^\d{1,2}[.)]\s+/, "");
    return clean(v);
  }

  function nameFromColumn(lines, col, maxLines) {
    var cell = readColumnCell(lines, col, { maxLines: maxLines, joinAll: true, stopRe: NAME_STOP_RE });
    var value = cleanName(
      cell.lines
        .filter(function (l) {
          return !NAME_NOISE_RE.test(l.trim());
        })
        .join(" "),
    );
    return value.length >= 3 && /[A-Za-z]/.test(value) ? value : null;
  }

  function detectName(lines, fullText) {
    var col = findHeaderColumn(lines, isDescHeader, [
      "hsn", "qty", "gross amount", "taxable value", "quantity", "total", "size", "color", "colour",
    ]);
    if (col) {
      var v = nameFromColumn(lines, col, 4);
      if (v) return { name: v, source: "Invoice description column" };
    }
    var loose = findHeaderColumn(lines, isDescHeader);
    if (loose) {
      var v2 = nameFromColumn(lines, loose, 3);
      if (v2) return { name: v2, source: "Product details column" };
    }
    var inline = fullText.match(
      /(?:product\s*name|item\s*name|description\s*of\s*goods|description)\s*[:\-–]\s*(.{3,120})/i,
    );
    if (inline) {
      var v3 = cleanName(inline[1].split(/\n/)[0]);
      if (v3.length >= 3 && /[A-Za-z]/.test(v3)) return { name: v3, source: "Inline label" };
    }
    return { name: null, source: "not found" };
  }

  /* ----------------------------- order id ----------------------------- */

  function isOrderHeader(t) {
    return t === "order no" || t === "order number" || t === "order id" || t === "order";
  }
  function detectOrderId(lines, fullText) {
    var col = findHeaderColumn(lines, isOrderHeader, ["sku", "size", "qty", "color", "colour"]);
    if (col) {
      var cell = readColumnCell(lines, col, { maxLines: 2 });
      if (cell.value && cell.value.length <= 60) return clean(cell.value);
    }
    var m = fullText.match(
      /(?:sub[\s-]*order\s*(?:id|no\.?)|order\s*(?:id|no\.?)|purchase\s*order\s*no\.?)\s*[:\-–]?\s*([A-Za-z0-9_\-/]{6,40})/i,
    );
    return m ? m[1] : null;
  }

  /* --------------------------- page classifier --------------------------- */

  function classifyPage(pageNumber, lines, emptyText) {
    if (emptyText) {
      return {
        page: pageNumber, sku: null, skuSource: "none", skuConfidence: "none",
        name: null, nameSource: "none", orderId: null, candidates: [],
        issues: ["No selectable text on this page (likely a scanned / image-only page)."],
        text: "", manualSku: null, manualName: null,
      };
    }
    var fullText = lines
      .map(function (l) {
        return l.text;
      })
      .join("\n");
    var issues = [];
    var all = detectSku(lines, fullText);
    var nameRes = detectName(lines, fullText);
    var orderId = detectOrderId(lines, fullText);

    var candidates = all.filter(function (c) {
      return !orderId || c.value !== orderId;
    });
    if (candidates.length < all.length) issues.push("A candidate value matching the order id was rejected.");

    var best = candidates.length ? candidates[0] : null;
    var sku = best ? best.value : null;
    var conf = best ? best.confidence : "none";

    if (!sku) {
      issues.push("No reliable SKU found on this page.");
    } else {
      if (candidates.length > 1) {
        issues.push(
          "Multiple possible SKU values found (" +
            candidates.map(function (c) { return c.value; }).join(", ") +
            "). The highest-confidence one was used.",
        );
      }
      if (conf === "medium") {
        issues.push(
          "SKU was read from an inline label rather than a structured product table (usually still correct).",
        );
      }
    }
    if (!nameRes.name) issues.push("Product name could not be read from this page.");

    return {
      page: pageNumber, sku: sku, skuSource: best ? best.source : "none", skuConfidence: conf,
      name: nameRes.name, nameSource: nameRes.source, orderId: orderId,
      candidates: candidates.map(function (c) { return c.value; }),
      issues: issues, text: fullText.slice(0, 6000), manualSku: null, manualName: null,
    };
  }

  function effectiveSku(rec) {
    return rec.manualSku ? rec.manualSku : rec.sku;
  }
  function effectiveName(rec) {
    return rec.manualName ? rec.manualName : rec.name;
  }
  /** A page needs a human look: no SKU, weak SKU signal, several candidates, or no name. */
  function needsReview(rec) {
    if (rec.manualSku) return false;
    if (!rec.sku) return true;
    if (rec.skuConfidence === "low" || rec.skuConfidence === "none") return true;
    if (!rec.name) return true;
    if (rec.candidates.length > 1) return true;
    return false;
  }

  MPS.detect = {
    isPlausibleSku: isPlausibleSku,
    detectSku: detectSku,
    detectName: detectName,
    detectOrderId: detectOrderId,
    classifyPage: classifyPage,
    effectiveSku: effectiveSku,
    effectiveName: effectiveName,
    needsReview: needsReview,
  };
})(typeof window !== "undefined" ? window : globalThis);
