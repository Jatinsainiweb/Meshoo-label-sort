/* Application controller: state, events, and the upload → analyse → select → generate flow. */
(function () {
  "use strict";
  var MPS = window.MPS;
  var UT = MPS.utils, R = MPS.reader, D = MPS.detect, G = MPS.group, GEN = MPS.generate, ui = MPS.ui;
  var $ = ui.$, show = ui.show;
  var REVIEW_STEP = 25;

  var state = {
    file: null,
    status: "idle", // idle | parsing | ready | error
    total: 0,
    processed: 0,
    records: [],
    selected: new Set(),
    query: "",
    filter: "all",
    sortKey: "pages",
    sortDir: "desc",
    expanded: null,
    reviewLimit: REVIEW_STEP,
    reviewChecked: new Set(),
    mode: "combined",
    groupBySku: false,
    generating: false,
    result: null,
    inspectPage: null,
  };

  // Non-UI resources
  var masterBytes = null; // ArrayBuffer of the uploaded PDF (kept so output is copied from the original)
  var pdf = null; // PDF.js document wrapper
  var pendingFile = null;
  var cancelParse = false;
  var cancelGen = false;
  var runId = 0; // guards against stale async work after Remove / new upload

  /* ============================= derived data ============================= */

  var cache = { records: null, groups: [] };
  function groups() {
    if (cache.records !== state.records || cache.version !== version) {
      cache.groups = G.buildGroups(state.records);
      cache.records = state.records;
      cache.version = version;
    }
    return cache.groups;
  }
  var version = 0; // bumped whenever record fields change in place
  function pendingReview() {
    return state.records.filter(D.needsReview);
  }
  function reviewRecords() {
    return state.records.filter(function (r) { return D.needsReview(r) || r.manualSku; });
  }
  function selectedGroups() {
    return groups().filter(function (grp) { return state.selected.has(grp.key); });
  }
  function selectedPageCount() {
    return selectedGroups().reduce(function (n, grp) { return n + grp.pages.length; }, 0);
  }
  function visibleGroups() {
    return G.sortGroups(G.filterGroups(groups(), state.query, state.filter), state.sortKey, state.sortDir);
  }
  function skuOptions() {
    return groups()
      .filter(function (grp) { return grp.sku; })
      .map(function (grp) { return { sku: grp.sku, name: grp.name }; })
      .sort(function (a, b) { return a.sku.localeCompare(b.sku, undefined, { numeric: true }); });
  }

  /* ================================ render ================================ */

  function renderUpload() {
    var hasFile = !!state.file;
    show($("dropzone"), !hasFile);
    show($("file-bar"), hasFile);
    show($("upload-actions"), hasFile && state.status !== "parsing");
    show($("btn-cancel-parse"), state.status === "parsing");
    if (hasFile) {
      $("file-name").textContent = state.file.name;
      var meta = UT.formatBytes(state.file.size);
      if (state.total) meta += " · " + state.total + " pages detected";
      if (state.status === "ready") meta += " · analysis complete";
      $("file-meta").textContent = meta;
    }
    var parsing = state.status === "parsing";
    show($("parse-progress"), parsing);
    if (parsing) {
      var pct = state.total ? Math.round((state.processed / state.total) * 100) : 0;
      $("parse-count").textContent = state.processed + " / " + (state.total || "?") + " pages · " + pct + "%";
      $("parse-bar").style.width = pct + "%";
    }
    show($("howto"), state.records.length === 0 && !parsing);
  }

  function renderStats() {
    var grps = groups();
    var classified = state.records.filter(function (r) { return D.effectiveSku(r) !== null; }).length;
    var pending = pendingReview().length;
    var uniq = grps.filter(function (grp) { return grp.key !== G.UNDETECTED; }).length;
    var sel = selectedGroups();
    ui.renderStats($("stats"), [
      { label: "Total pages", value: state.total || state.records.length, hint: state.records.length + " analysed" },
      { label: "Unique SKUs", value: uniq, tone: "violet", hint: "exact-match grouping" },
      { label: "Classified pages", value: classified, tone: "green",
        hint: (state.records.length ? Math.round((classified / state.records.length) * 100) : 0) + "% of pages" },
      { label: "Need review", value: pending, tone: pending ? "amber" : "", hint: "never discarded" },
      { label: "Pages selected", value: selectedPageCount(), hint: sel.length + " SKU" + (sel.length === 1 ? "" : "s") + " ticked" },
    ]);
  }

  function renderTable() {
    var visible = visibleGroups();
    var keys = visible.map(function (grp) { return grp.key; });
    ui.renderTableBody($("table-body"), visible, {
      selected: state.selected, expanded: state.expanded,
      onToggle: toggleGroup,
      onExpand: function (key) { state.expanded = state.expanded === key ? null : key; renderTable(); },
      onInspect: openInspector,
    });
    ui.renderSortIndicators(state.sortKey, state.sortDir);
    $("showing").textContent = "Showing " + visible.length + " of " + groups().length + " SKUs";
    var all = keys.length > 0 && keys.every(function (k) { return state.selected.has(k); });
    var some = keys.some(function (k) { return state.selected.has(k); });
    var ca = $("check-all");
    ca.checked = all;
    ca.indeterminate = !all && some;
    var filtered = state.query || state.filter !== "all";
    $("btn-select-all").textContent = filtered ? "Select all matching" : "Select all";
    show($("btn-select-only"), !!state.query.trim() && visible.length > 0);
    $("btn-select-only").textContent = "Select only these " + visible.length;
    document.querySelectorAll("#filter-seg button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-filter") === state.filter);
    });
  }

  function renderReview() {
    var recs = reviewRecords();
    var pending = pendingReview().length;
    $("review-title").textContent = "Review required — " + pending + " page" + (pending === 1 ? "" : "s");
    show($("review-empty"), recs.length === 0);
    show($("review-main"), recs.length > 0);
    if (!recs.length) return;

    // bulk target options
    var sel = $("bulk-target");
    var current = sel.value;
    ui.clear(sel);
    sel.appendChild(ui.h("option", { value: "", text: "Choose a SKU…" }));
    skuOptions().forEach(function (o) {
      sel.appendChild(ui.h("option", { value: o.sku, text: o.sku + " — " + o.name.slice(0, 50) }));
    });
    sel.appendChild(ui.h("option", { value: "__custom__", text: "+ New / custom SKU…" }));
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === current; }) ? current : "";
    show($("bulk-custom"), sel.value === "__custom__");

    ui.renderReviewBody($("review-body"), recs.slice(0, state.reviewLimit), {
      skuOptions: skuOptions(), checked: state.reviewChecked,
      onTick: function (p) {
        if (state.reviewChecked.has(p)) state.reviewChecked.delete(p); else state.reviewChecked.add(p);
        updateBulkButton();
      },
      onAssign: assignPages, onInspect: openInspector,
    });
    show($("review-more-wrap"), recs.length > state.reviewLimit);
    $("btn-review-more").textContent = "Show more (" + (recs.length - state.reviewLimit) + " remaining)";
    updateBulkButton();
  }

  function bulkSkuValue() {
    var t = $("bulk-target").value;
    return t === "__custom__" ? $("bulk-custom").value.trim() : t;
  }
  function updateBulkButton() {
    var n = state.reviewChecked.size;
    var b = $("btn-bulk-apply");
    b.textContent = "Apply to " + n + " page" + (n === 1 ? "" : "s");
    b.disabled = !n || !bulkSkuValue();
  }

  function renderGenerate() {
    var sel = selectedGroups();
    var total = ui.renderSelection(sel);
    var btn = $("btn-generate");
    btn.disabled = state.generating || sel.length === 0 || total === 0;
    btn.textContent = state.generating ? "Generating…"
      : state.mode === "combined" ? "Generate PDF (" + total + " pages)" : "Generate " + sel.length + " PDFs as ZIP";
    show($("btn-cancel-gen"), state.generating);
    show($("opt-group"), state.mode === "combined");
    $("opt-combined").classList.toggle("active", state.mode === "combined");
    $("opt-separate").classList.toggle("active", state.mode === "separate");

    // alerts
    var box = $("gen-alerts");
    ui.clear(box);
    if (!sel.length) box.appendChild(ui.alertBox("info", "No product selected", "Select at least one SKU above. An empty PDF will never be generated."));
    var empty = sel.filter(function (grp) { return grp.pages.length === 0; });
    if (empty.length) box.appendChild(ui.alertBox("warning", "Some selected SKUs have no mapped pages", empty.map(function (x) { return x.sku; }).join(", ")));
    if (state.selected.has(G.UNDETECTED)) {
      box.appendChild(ui.alertBox("warning", "Check before you print",
        "Your selection includes pages whose SKU could not be detected. They will be added to the output exactly as they appear in the source PDF."));
    }
    var flagged = sel.filter(function (grp) { return grp.key !== G.UNDETECTED && grp.reviewPages.length > 0; });
    if (flagged.length) {
      box.appendChild(ui.alertBox("warning", "Check before you print",
        flagged.length + " selected SKU" + (flagged.length === 1 ? " has" : "s have") + ' pages flagged in "Review required". Check them before printing.'));
    }
    if (state.genError) box.appendChild(ui.alertBox("error", "Generation failed", state.genError));

    var r = state.result;
    show($("gen-result"), !!r && !state.generating);
    if (r) {
      $("result-title").textContent = "✓ File ready — " + r.pages + " page" + (r.pages === 1 ? "" : "s") + " · " + UT.formatBytes(r.blob.size);
      $("result-name").textContent = r.name;
      $("btn-download").textContent = "⬇ Download " + (/\.zip$/.test(r.name) ? "ZIP" : "PDF");
    }
  }

  function renderAll() {
    renderUpload();
    var has = state.records.length > 0;
    show($("results"), has);
    if (!has) return;
    renderStats();
    renderTable();
    renderReview();
    renderGenerate();
  }

  /* ============================== upload flow ============================== */

  function showError(msg) {
    show($("upload-error"), !!msg);
    if (msg) $("upload-error-text").textContent = msg;
  }
  function showNotice(msg) {
    show($("upload-notice"), !!msg);
    if (msg) $("upload-notice-text").textContent = msg;
  }

  async function disposePdf() {
    if (pdf) {
      var p = pdf;
      pdf = null;
      try { await p.destroy(); } catch (e) { /* ignore */ }
    }
  }

  async function removePdf() {
    runId++;
    cancelParse = true;
    cancelGen = true;
    var oldPdf = pdf;
    pdf = null;
    masterBytes = null;
    pendingFile = null;
    state.file = null; state.status = "idle"; state.total = 0; state.processed = 0;
    state.records = []; state.selected = new Set(); state.reviewChecked = new Set();
    state.expanded = null; state.generating = false; state.result = null; state.genError = null;
    state.inspectPage = null; state.reviewLimit = REVIEW_STEP; state.query = ""; state.filter = "all";
    $("search").value = "";
    show($("password-form"), false);
    showError(null); showNotice(null);
    closeInspector();
    version++;
    renderAll();
    if (oldPdf) {
      try { await oldPdf.destroy(); } catch (e) { /* ignore */ }
    }
  }

  async function processFile(file, password) {
    var isPdf = file.type === "application/pdf" || file.type === "application/x-pdf" || /\.pdf$/i.test(file.name);
    showNotice(null);
    if (!isPdf) {
      showError('"' + file.name + '" is not a PDF file. Please choose a .pdf file.');
      return;
    }
    if (file.size === 0) {
      showError("That file is empty (0 bytes).");
      return;
    }
    var myRun = ++runId;
    await disposePdf();
    cancelParse = false;
    pendingFile = file;
    state.file = file; state.status = "parsing"; state.total = 0; state.processed = 0;
    state.records = []; state.selected = new Set(); state.reviewChecked = new Set();
    state.result = null; state.genError = null; state.expanded = null; state.reviewLimit = REVIEW_STEP;
    version++;
    showError(null);
    show($("password-form"), false);
    renderAll();

    var bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch (e) {
      state.status = "error";
      showError("The file could not be read from disk. Try copying it to another folder and uploading again.");
      renderAll();
      return;
    }
    if (myRun !== runId) return;
    masterBytes = bytes;

    var loaded;
    try {
      loaded = await R.loadPdf(bytes, password);
    } catch (err) {
      if (myRun !== runId) return;
      state.status = "error";
      if (err instanceof R.PasswordRequiredError) {
        show($("password-form"), true);
        $("password-input").value = "";
        if (err.wrongPassword) showError("Incorrect password. Please try again.");
      } else {
        showError(err.message || "Unknown error while opening the PDF.");
      }
      renderAll();
      return;
    }
    if (myRun !== runId) {
      await loaded.destroy();
      return;
    }
    pdf = loaded;
    state.total = loaded.numPages;
    renderUpload();

    var collected = [];
    try {
      for (var p = 1; p <= loaded.numPages; p++) {
        if (cancelParse || myRun !== runId) break;
        try {
          var res = await R.extractPageLines(loaded.doc, p);
          collected.push(D.classifyPage(p, res.lines, res.empty));
        } catch (e) {
          collected.push({
            page: p, sku: null, skuSource: "error", skuConfidence: "none", name: null, nameSource: "error",
            orderId: null, candidates: [], text: "", manualSku: null, manualName: null,
            issues: ["This page could not be read: " + ((e && e.message) || "unknown error")],
          });
        }
        state.processed = p;
        if (p % 2 === 0 || p === loaded.numPages) {
          renderUpload();
          await UT.yieldToUi();
        }
      }
    } catch (err) {
      if (myRun !== runId) return;
      state.status = "error";
      showError((err && err.message) || "Processing stopped unexpectedly.");
      renderAll();
      return;
    }
    if (myRun !== runId) return;

    state.records = collected;
    version++;
    if (cancelParse) {
      state.status = collected.length ? "ready" : "idle";
      if (!collected.length) { state.file = null; masterBytes = null; await disposePdf(); }
      showNotice(collected.length
        ? "Processing was cancelled after " + collected.length + " of " + loaded.numPages + " pages. Only the analysed pages can be sorted."
        : "Processing cancelled.");
    } else {
      state.status = "ready";
    }
    renderAll();
  }

  /* ============================= selection / edits ============================= */

  function toggleGroup(key) {
    if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
    state.result = null;
    renderStats(); renderTable(); renderGenerate();
  }
  function setSelection(keys) {
    state.selected = new Set(keys);
    state.result = null;
    renderStats(); renderTable(); renderGenerate();
  }

  /** Manual correction: update the page → SKU mapping before generation. */
  function assignPages(pages, sku) {
    var set = {};
    pages.forEach(function (p) { set[p] = true; });
    state.records.forEach(function (r) {
      if (set[r.page]) r.manualSku = sku ? sku : null;
    });
    version++;
    // drop selections whose group no longer exists
    var keys = {};
    groups().forEach(function (grp) { keys[grp.key] = true; });
    state.selected.forEach(function (k) { if (!keys[k]) state.selected.delete(k); });
    state.result = null;
    renderAll();
    if (state.inspectPage) {
      var rec = state.records.filter(function (r) { return r.page === state.inspectPage; })[0];
      if (rec) ui.renderInspector(rec);
    }
  }

  /* ================================ inspector ================================ */

  var inspectToken = 0;
  async function openInspector(page) {
    var rec = state.records.filter(function (r) { return r.page === page; })[0];
    if (!rec) return;
    state.inspectPage = page;
    ui.renderInspector(rec);
    show($("inspector"), true);
    var canvas = $("insp-canvas");
    var err = $("insp-render-error");
    show(err, false); show(canvas, true);
    var token = ++inspectToken;
    try {
      if (!pdf) throw new Error("The PDF is no longer open.");
      await R.renderPage(pdf.doc, page, canvas, 620);
    } catch (e) {
      if (token !== inspectToken) return;
      show(canvas, false);
      err.textContent = (e && e.message) || "Preview unavailable.";
      show(err, true);
    }
  }
  function closeInspector() {
    state.inspectPage = null;
    inspectToken++;
    show($("inspector"), false);
  }

  /* ================================ generation ================================ */

  function setGenProgress(p) {
    show($("gen-progress"), true);
    var pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    $("gen-stage").textContent = p.stage + "…";
    $("gen-count").textContent = p.done + " / " + p.total + " pages · " + pct + "%";
    $("gen-bar").style.width = pct + "%";
  }

  async function generate() {
    state.genError = null;
    state.result = null;
    var sel = selectedGroups();
    if (!masterBytes) { state.genError = "The source PDF is no longer available. Please upload it again."; renderGenerate(); return; }
    if (!sel.length) { state.genError = "Select at least one product first."; renderGenerate(); return; }
    var expected = selectedPageCount();
    if (!expected) { state.genError = "The selected products have no mapped pages, so there is nothing to export."; renderGenerate(); return; }

    cancelGen = false;
    state.generating = true;
    renderGenerate();
    setGenProgress({ stage: "Preparing", done: 0, total: expected });
    try {
      var opts = {
        selected: sel, sourceBytes: masterBytes.slice(0),
        onProgress: setGenProgress, isCancelled: function () { return cancelGen; },
      };
      var out = state.mode === "combined"
        ? await GEN.generateCombined(Object.assign(opts, { groupBySku: state.groupBySku }))
        : await GEN.generateSeparateZip(opts);
      if (out.pages !== expected) {
        state.genError = "Internal check failed: expected " + expected + " pages but produced " + out.pages + ". The file was not offered for download.";
      } else {
        state.result = out;
        UT.downloadBlob(out.blob, out.name);
      }
    } catch (e) {
      var msg = (e && e.message) || "Unknown error";
      state.genError = msg === "cancelled" ? "Generation cancelled — no file was created." : msg;
    } finally {
      state.generating = false;
      show($("gen-progress"), false);
      renderGenerate();
    }
  }

  function exportCsv() {
    var rows = [["original_page", "effective_sku", "detected_sku", "manual_sku", "product_name", "order_id", "confidence", "sku_source", "needs_review", "issues"]];
    state.records.forEach(function (r) {
      rows.push([r.page, D.effectiveSku(r) || "", r.sku || "", r.manualSku || "", D.effectiveName(r) || "",
        r.orderId || "", r.skuConfidence, r.skuSource, D.needsReview(r) ? "yes" : "no", r.issues.join(" | ")]);
    });
    UT.downloadBlob(new Blob(["\ufeff" + UT.toCsv(rows)], { type: "text/csv;charset=utf-8" }), "Meesho_Page_Map_" + UT.todayStamp() + ".csv");
  }

  /* ================================= events ================================= */

  function init() {
    var input = $("file-input");
    var dz = $("dropzone");
    function pick() { input.click(); }

    dz.addEventListener("click", pick);
    dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("drag"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault();
      dz.classList.remove("drag");
      if (e.dataTransfer.files && e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
    });
    // Dropping a file anywhere else must not make Chrome navigate away to the PDF.
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      if (!dz.contains(e.target) && e.dataTransfer.files && e.dataTransfer.files.length && state.status !== "parsing") {
        processFile(e.dataTransfer.files[0]);
      }
    });
    input.addEventListener("change", function () {
      if (input.files && input.files.length) processFile(input.files[0]);
      input.value = "";
    });
    $("btn-upload-another").addEventListener("click", pick);
    $("btn-remove").addEventListener("click", removePdf);
    $("btn-cancel-parse").addEventListener("click", function () { cancelParse = true; });
    $("password-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = $("password-input").value;
      if (pw && pendingFile) processFile(pendingFile, pw);
    });

    // table controls
    $("search").addEventListener("input", function (e) { state.query = e.target.value; renderTable(); });
    $("filter-seg").addEventListener("click", function (e) {
      var f = e.target.getAttribute && e.target.getAttribute("data-filter");
      if (f) { state.filter = f; renderTable(); }
    });
    document.querySelectorAll("#table-card .sort").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-sort");
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = key; state.sortDir = key === "pages" ? "desc" : "asc"; }
        renderTable();
      });
    });
    $("check-all").addEventListener("change", function () {
      var keys = visibleGroups().map(function (grp) { return grp.key; });
      var all = keys.length > 0 && keys.every(function (k) { return state.selected.has(k); });
      var next = new Set(state.selected);
      keys.forEach(function (k) { if (all) next.delete(k); else next.add(k); });
      setSelection(Array.from(next));
    });
    $("btn-select-all").addEventListener("click", function () {
      var next = new Set(state.selected);
      visibleGroups().forEach(function (grp) { next.add(grp.key); });
      setSelection(Array.from(next));
    });
    $("btn-clear").addEventListener("click", function () { setSelection([]); });
    $("btn-select-only").addEventListener("click", function () {
      setSelection(visibleGroups().map(function (grp) { return grp.key; }));
    });

    // review controls
    $("bulk-target").addEventListener("change", function () {
      show($("bulk-custom"), $("bulk-target").value === "__custom__");
      updateBulkButton();
    });
    $("bulk-custom").addEventListener("input", updateBulkButton);
    $("btn-bulk-apply").addEventListener("click", function () {
      var sku = bulkSkuValue();
      if (!sku || !state.reviewChecked.size) return;
      var pages = Array.from(state.reviewChecked);
      state.reviewChecked = new Set();
      $("bulk-target").value = "";
      $("bulk-custom").value = "";
      assignPages(pages, sku);
    });
    $("btn-tick-shown").addEventListener("click", function () {
      reviewRecords().slice(0, state.reviewLimit).forEach(function (r) { state.reviewChecked.add(r.page); });
      renderReview();
    });
    $("btn-untick").addEventListener("click", function () { state.reviewChecked = new Set(); renderReview(); });
    $("btn-review-more").addEventListener("click", function () { state.reviewLimit += REVIEW_STEP * 2; renderReview(); });

    // generate controls
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked) { state.mode = r.value; state.result = null; renderGenerate(); }
      });
    });
    $("group-by-sku").addEventListener("change", function (e) { state.groupBySku = e.target.checked; state.result = null; });
    $("btn-generate").addEventListener("click", generate);
    $("btn-cancel-gen").addEventListener("click", function () { cancelGen = true; });
    $("btn-download").addEventListener("click", function () { if (state.result) UT.downloadBlob(state.result.blob, state.result.name); });
    $("btn-csv").addEventListener("click", exportCsv);

    // inspector
    $("insp-close").addEventListener("click", closeInspector);
    $("inspector").addEventListener("click", function (e) { if (e.target === $("inspector")) closeInspector(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.inspectPage) closeInspector(); });
    $("insp-assign").addEventListener("click", function () {
      var v = $("insp-assign-input").value.trim();
      if (v && state.inspectPage) { var p = state.inspectPage; closeInspector(); assignPages([p], v); }
    });
    $("insp-reset").addEventListener("click", function () { if (state.inspectPage) assignPages([state.inspectPage], null); });

    if (!window.pdfjsLib || !window.PDFLib || !window.JSZip) {
      showError("A required library failed to load. Make sure the 'vendor' folder sits next to index.html.");
    }
    renderAll();
  }

  init();
})();
