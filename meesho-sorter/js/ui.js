/*
 * UI rendering helpers. Every piece of PDF-derived text is inserted with textContent / text nodes
 * (never innerHTML), so extracted text can never be interpreted as markup or code.
 */
(function (g) {
  "use strict";
  var MPS = (g.MPS = g.MPS || {});
  var U = function () { return MPS.utils; };
  var G = function () { return MPS.group; };

  /** Tiny DOM builder: h("div", {class:"x", onclick:fn}, "text", childNode, ...) */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
        else if (k === "value") el.value = v;
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function $(id) {
    return document.getElementById(id);
  }
  function show(el, on) {
    el.hidden = !on;
  }

  /* ------------------------------ alerts ------------------------------ */
  function alertBox(tone, title, text) {
    var icons = { info: "i", success: "✓", warning: "!", error: "✕" };
    return h("div", { class: "alert alert-" + tone },
      h("span", { class: "alert-icon", text: icons[tone] }),
      h("div", { class: "alert-body" }, h("p", { class: "alert-title", text: title }), text ? h("p", { text: text }) : null));
  }

  /* ------------------------------ stats ------------------------------ */
  function renderStats(el, stats) {
    clear(el);
    stats.forEach(function (s) {
      el.appendChild(h("div", { class: "stat " + (s.tone || "") },
        h("p", { class: "stat-label", text: s.label }),
        h("p", { class: "stat-value", text: s.value }),
        h("p", { class: "stat-hint", text: s.hint || "" })));
    });
  }

  /* --------------------------- product table --------------------------- */
  function renderTableBody(tbody, visible, ctx) {
    clear(tbody);
    if (!visible.length) {
      tbody.appendChild(h("tr", { class: "empty-row" }, h("td", { colspan: 5, text: "No products match the current search or filter." })));
      return;
    }
    visible.forEach(function (grp) {
      var undetected = grp.key === G().UNDETECTED;
      var isSel = ctx.selected.has(grp.key);
      var isOpen = ctx.expanded === grp.key;

      var skuCell = h("td", null,
        h("span", { class: "sku-val" + (undetected ? " undetected" : ""), text: undetected ? "SKU Not Detected" : grp.sku }),
        grp.manualCount ? h("div", { class: "mt" }, h("span", { class: "badge badge-blue", text: grp.manualCount + " manually assigned" })) : null);

      var nameCell = h("td", null,
        h("p", { class: "name-val", text: grp.name }),
        grp.nameVariants.length > 1
          ? h("button", { class: "link warn", type: "button", onclick: function () { ctx.onExpand(grp.key); },
              text: "⚠ " + grp.nameVariants.length + " name variations — review" })
          : null,
        h("button", { class: "link", type: "button", onclick: function () { ctx.onExpand(grp.key); },
          text: isOpen ? "Hide pages ▲" : "Show original page numbers ▼" }));

      var status = undetected
        ? h("span", { class: "badge badge-amber", text: "Needs review" })
        : grp.reviewPages.length
          ? h("span", { class: "badge badge-amber", text: grp.reviewPages.length + " to check" })
          : h("span", { class: "badge badge-green", text: "Detected" });

      tbody.appendChild(h("tr", { class: isSel ? "selected" : "" },
        h("td", { class: "col-check" }, h("input", {
          type: "checkbox", checked: isSel, "aria-label": "Select " + (grp.sku || "unclassified pages"),
          onchange: function () { ctx.onToggle(grp.key); } })),
        skuCell, nameCell,
        h("td", { class: "pages-val", text: grp.pages.length }),
        h("td", null, status)));

      if (isOpen) {
        var chips = h("div", { class: "chips" });
        grp.pages.slice(0, 40).forEach(function (p) {
          chips.appendChild(h("button", { class: "chip", type: "button", title: "Inspect page " + p,
            onclick: function () { ctx.onInspect(p); }, text: "p" + p }));
        });
        if (grp.pages.length > 40) chips.appendChild(h("span", { class: "muted small", text: "+" + (grp.pages.length - 40) + " more" }));
        var detail = h("div", { class: "detail" },
          h("p", { class: "eyebrow", text: "Original page numbers" }),
          h("p", { class: "mono small", text: U().formatPageRanges(grp.pages) }));
        if (grp.nameVariants.length > 1) {
          detail.appendChild(h("p", { class: "eyebrow mt", text: "Name variations recorded for this SKU" }));
          detail.appendChild(h("ul", null, grp.nameVariants.map(function (n) { return h("li", { text: n }); })));
        }
        detail.appendChild(chips);
        tbody.appendChild(h("tr", { class: "detail-row" }, h("td"), h("td", { colspan: 4 }, detail)));
      }
    });
  }

  function renderSortIndicators(sortKey, sortDir) {
    document.querySelectorAll("#table-card .sort").forEach(function (b) {
      var active = b.getAttribute("data-sort") === sortKey;
      b.querySelector("i").textContent = active ? (sortDir === "asc" ? "▲" : "▼") : "⇅";
    });
  }

  /* ----------------------------- review table ----------------------------- */
  function renderReviewBody(tbody, records, ctx) {
    clear(tbody);
    records.forEach(function (r) {
      var select = h("select", { class: "row-select", onchange: function (e) {
        ctx.onAssign([r.page], e.target.value === "" ? null : e.target.value);
      } });
      select.appendChild(h("option", { value: "", text: "— keep detected result —" }));
      r.candidates.forEach(function (c) {
        select.appendChild(h("option", { value: c, text: "candidate: " + c, selected: r.manualSku === c }));
      });
      ctx.skuOptions.forEach(function (o) {
        select.appendChild(h("option", { value: o.sku, text: o.sku + " — " + o.name.slice(0, 40), selected: r.manualSku === o.sku && r.candidates.indexOf(o.sku) === -1 }));
      });

      var skuCell = h("td", null,
        r.manualSku ? h("span", { class: "badge badge-blue", text: "manual: " + r.manualSku })
          : r.sku ? h("span", { class: "sku-val", text: r.sku })
          : h("span", { class: "sku-val undetected", text: "none" }),
        r.orderId ? h("p", { class: "muted small", text: "order " + r.orderId }) : null);

      tbody.appendChild(h("tr", null,
        h("td", { class: "col-check" }, h("input", { type: "checkbox", checked: ctx.checked.has(r.page),
          "aria-label": "Tick page " + r.page, onchange: function () { ctx.onTick(r.page); } })),
        h("td", null, h("button", { class: "page-link", type: "button", text: r.page, onclick: function () { ctx.onInspect(r.page); } })),
        skuCell,
        h("td", null,
          r.name ? h("p", { text: r.name }) : h("p", { class: "sku-val undetected", text: "Name Not Detected" }),
          h("ul", { class: "issues" }, r.issues.map(function (i) { return h("li", { text: "• " + i }); }))),
        h("td", null, select)));
    });
  }

  /* --------------------------- selection summary --------------------------- */
  function renderSelection(selectedGroups) {
    var list = $("sel-list");
    clear(list);
    var total = 0;
    selectedGroups.forEach(function (grp) {
      total += grp.pages.length;
      list.appendChild(h("li", null,
        h("span", { class: "min0" },
          h("span", { class: "sku-val" + (grp.key === G().UNDETECTED ? " undetected" : ""), text: grp.key === G().UNDETECTED ? "SKU Not Detected" : grp.sku }),
          h("span", { class: "nm", text: grp.name }),
          h("span", { class: "pg", text: "pages " + U().formatPageRanges(grp.pages, 6) })),
        h("span", { class: "cnt", text: grp.pages.length })));
    });
    show($("sel-empty"), selectedGroups.length === 0);
    var t = $("sel-total");
    clear(t);
    t.appendChild(document.createTextNode(selectedGroups.length + " SKU" + (selectedGroups.length === 1 ? "" : "s") + " · "));
    t.appendChild(h("b", { text: total }));
    t.appendChild(document.createTextNode(" page" + (total === 1 ? "" : "s") + " will be written to the output"));
    return total;
  }

  /* ------------------------------ inspector ------------------------------ */
  function renderInspector(rec) {
    $("insp-title").textContent = "Original page " + rec.page;
    var kv = $("insp-kv");
    clear(kv);
    function row(label, node) {
      kv.appendChild(h("dt", { text: label }));
      kv.appendChild(h("dd", null, node));
    }
    row("Detected SKU", rec.manualSku ? h("span", { class: "badge badge-blue", text: "manual: " + rec.manualSku })
      : rec.sku ? h("span", { class: "sku-val", text: rec.sku }) : h("span", { class: "sku-val undetected", text: "SKU Not Detected" }));
    row("Source", rec.skuSource);
    row("Confidence", rec.skuConfidence);
    row("Product name", rec.name ? rec.name : h("span", { class: "sku-val undetected", text: "Name Not Detected" }));
    row("Order id", rec.orderId || "—");
    row("All candidates", rec.candidates.length ? rec.candidates.join(", ") : "—");
    var iss = $("insp-issues");
    clear(iss);
    rec.issues.forEach(function (i) { iss.appendChild(h("li", { text: "• " + i })); });
    $("insp-text").textContent = rec.text || "(no selectable text on this page)";
    $("insp-assign-input").value = "";
    show($("insp-reset"), !!rec.manualSku);
  }

  MPS.ui = {
    h: h, clear: clear, $: $, show: show, alertBox: alertBox,
    renderStats: renderStats, renderTableBody: renderTableBody, renderSortIndicators: renderSortIndicators,
    renderReviewBody: renderReviewBody, renderSelection: renderSelection, renderInspector: renderInspector,
  };
})(typeof window !== "undefined" ? window : globalThis);
