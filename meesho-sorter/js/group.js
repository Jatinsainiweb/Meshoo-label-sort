/* Grouping, sorting and filtering of pages by exact SKU. */
(function (g) {
  "use strict";
  var MPS = (g.MPS = g.MPS || {});
  var D = function () {
    return MPS.detect;
  };
  var UNDETECTED = "__SKU_NOT_DETECTED__";
  var RANK = { high: 3, medium: 2, low: 1, none: 0 };

  /**
   * Group pages by *exact* SKU. Different SKUs are never merged even if their names look the
   * same. The same SKU with different names stays in one group and the variations are reported.
   */
  function buildGroups(records) {
    var map = {};
    var order = [];
    records.forEach(function (rec) {
      var sku = D().effectiveSku(rec);
      var key = sku === null || sku === undefined ? UNDETECTED : "sku:" + sku;
      var grp = map[key];
      if (!grp) {
        grp = map[key] = {
          key: key, sku: sku || null, name: "", nameVariants: [], pages: [], reviewPages: [],
          confidence: "none", manualCount: 0,
        };
        order.push(key);
      }
      grp.pages.push(rec.page);
      if (D().needsReview(rec)) grp.reviewPages.push(rec.page);
      if (rec.manualSku) grp.manualCount++;
      var name = D().effectiveName(rec);
      if (name) {
        // A manually assigned page's own text may describe something unrelated, so it must not
        // create a "name variation" for the SKU it was moved into (used only as a fallback).
        var bucket = rec.manualSku ? (grp.manualNames = grp.manualNames || []) : grp.nameVariants;
        if (bucket.indexOf(name) === -1) bucket.push(name);
      }
      var conf = rec.manualSku ? "high" : rec.skuConfidence;
      if (RANK[conf] > RANK[grp.confidence]) grp.confidence = conf;
    });

    var groups = order.map(function (k) {
      return map[k];
    });
    groups.forEach(function (grp) {
      grp.pages.sort(function (a, b) { return a - b; });
      grp.reviewPages.sort(function (a, b) { return a - b; });
      if (!grp.nameVariants.length && grp.manualNames && grp.manualNames.length) {
        grp.nameVariants = grp.manualNames.slice(0, 1);
      }
      if (!grp.nameVariants.length) {
        grp.name = grp.key === UNDETECTED ? "—" : "Name Not Detected";
      } else {
        grp.name = grp.nameVariants.slice().sort(function (a, b) { return b.length - a.length; })[0];
      }
    });
    groups.sort(function (a, b) {
      if (a.key === UNDETECTED) return 1;
      if (b.key === UNDETECTED) return -1;
      return b.pages.length - a.pages.length;
    });
    return groups;
  }

  function sortGroups(groups, key, dir) {
    var f = dir === "asc" ? 1 : -1;
    var collator = new Intl.Collator(undefined, { numeric: true });
    return groups.slice().sort(function (a, b) {
      if (a.key === UNDETECTED) return 1; // the "not detected" bucket always stays last
      if (b.key === UNDETECTED) return -1;
      if (key === "pages") return (a.pages.length - b.pages.length) * f;
      if (key === "name") return collator.compare(a.name, b.name) * f;
      return collator.compare(a.sku || "", b.sku || "") * f;
    });
  }

  function filterGroups(groups, query, filter) {
    var q = (query || "").trim().toLowerCase();
    return groups.filter(function (grp) {
      var undetected = grp.key === UNDETECTED;
      if (filter === "detected" && (undetected || grp.reviewPages.length > 0)) return false;
      if (filter === "issues" && !undetected && grp.reviewPages.length === 0 && grp.nameVariants.length < 2)
        return false;
      if (!q) return true;
      return (
        (grp.sku || "sku not detected").toLowerCase().indexOf(q) !== -1 ||
        grp.name.toLowerCase().indexOf(q) !== -1 ||
        grp.nameVariants.some(function (n) {
          return n.toLowerCase().indexOf(q) !== -1;
        })
      );
    });
  }

  MPS.group = {
    UNDETECTED: UNDETECTED,
    buildGroups: buildGroups,
    sortGroups: sortGroups,
    filterGroups: filterGroups,
  };
})(typeof window !== "undefined" ? window : globalThis);
