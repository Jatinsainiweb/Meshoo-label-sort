// Node test harness: loads the SAME browser scripts the app uses and runs them against generated PDFs.
//   node test/makeSample.mjs && node test/makeVariants.mjs && node test/run.cjs
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

globalThis.PDFLib = require("pdf-lib");
globalThis.JSZip = require("jszip");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

for (const f of ["utils", "pdf-reader", "detect", "group", "generate"]) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../meesho-sorter/js", f + ".js"), "utf8"), { filename: f + ".js" });
}
const { reader, detect, group, generate, utils } = globalThis.MPS;

let passed = 0;
function ok(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  ✓ " + name); },
    (e) => { console.log("  ✗ " + name + "\n      " + e.message); process.exitCode = 1; },
  );
}

async function analyse(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const records = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const items = reader.toTextPositions(content.items);
    records.push(detect.classifyPage(p, reader.buildLines(items), items.length === 0));
  }
  return records;
}
const noop = () => {};
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

(async () => {
  const sampleBytes = fs.readFileSync("test/out/sample.pdf");
  const records = await analyse(sampleBytes);
  const groups = group.buildGroups(records);
  const bySku = (s) => groups.find((g) => g.sku === s);

  console.log("Detection — sample.pdf (17 pages)");
  await ok("every page is in exactly one group (no page lost)", () => {
    assert.strictEqual(groups.reduce((n, g) => n + g.pages.length, 0), 17);
    assert.strictEqual(new Set(groups.flatMap((g) => g.pages)).size, 17);
  });
  await ok("numeric / underscore / hyphen SKUs preserved exactly", () => {
    assert.deepStrictEqual(bySku("181670964").pages, [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(bySku("1429440434").pages, [7, 8, 9, 10]);
    assert.deepStrictEqual(bySku("1372453380_53").pages, [11, 12, 13]);
    assert.deepStrictEqual(bySku("CT-200-BLK").pages, [14, 15]);
  });
  await ok("similar names on different SKUs are NOT merged", () => {
    assert.notStrictEqual(bySku("181670964").key, bySku("1429440434").key);
  });
  await ok("order id / HSN / GSTIN / invoice no are never taken as SKU", () => {
    const skus = new Set(records.map((r) => r.sku).filter(Boolean));
    for (const s of skus) assert.ok(!/^(1002\d+|3926|INV-|09AABCU)/.test(s), "bad sku " + s);
    assert.strictEqual(records[0].orderId, "100200300_1");
  });
  await ok("unreadable pages go to 'SKU Not Detected' and are flagged", () => {
    const u = groups.find((g) => g.key === group.UNDETECTED);
    assert.deepStrictEqual(u.pages, [16, 17]);
    assert.ok(detect.needsReview(records[15]));
  });
  await ok("product names read from invoice description", () => {
    assert.ok(/Premium Quality Cable tie/.test(bySku("181670964").name));
    assert.ok(/Cable Tie White \(1000pcs\)/.test(bySku("1372453380_53").name));
  });

  console.log("Detection — variants.pdf (alternate layouts)");
  const vRecords = await analyse(fs.readFileSync("test/out/variants.pdf"));
  const vGroups = group.buildGroups(vRecords);
  await ok("inline 'SKU:' and '(SKU: x)' layouts", () => {
    assert.strictEqual(vRecords[0].sku, "BLU_TIE-500");
    assert.strictEqual(vRecords[1].sku, "RED-300-50");
  });
  await ok("same SKU with differing names → one group, variations flagged", () => {
    const g = vGroups.find((x) => x.sku === "BLU_TIE-500");
    assert.deepStrictEqual(g.pages, [1, 5]);
    assert.strictEqual(g.nameVariants.length, 2);
  });
  await ok("blank SKU cell / no product info → not guessed", () => {
    assert.strictEqual(vRecords[2].sku, null);
    assert.strictEqual(vRecords[3].sku, null);
    assert.strictEqual(vRecords[3].name, "Green Cable Tie 150mm pack of 100");
  });
  await ok("isPlausibleSku rejects GSTIN, date, price, phone, qty, words", () => {
    for (const bad of ["09AABCU9603R1ZM", "27.10.2026", "Rs.199.00", "9876543210", "1", "Free Size", "SKU", "N/A"])
      assert.strictEqual(detect.isPlausibleSku(bad), false, bad);
    for (const good of ["181670964", "1372453380_53", "CT-200-BLK", "abc_12-X"])
      assert.strictEqual(detect.isPlausibleSku(good), true, good);
  });

  console.log("Generation");
  const pick = (...skus) => groups.filter((g) => skus.includes(g.sku));
  const src = () => ab(sampleBytes);
  const mk = (selected, extra) => generate.generateCombined({ selected, groupBySku: false, sourceBytes: src(), onProgress: noop, isCancelled: () => false, ...extra });

  await ok("single SKU: page count + filename contains SKU", async () => {
    const out = await mk(pick("181670964"));
    assert.strictEqual(out.pages, 6);
    assert.ok(out.name.includes("181670964"));
    const r = await analyse(Buffer.from(await out.blob.arrayBuffer()));
    assert.strictEqual(r.length, 6);
    assert.ok(r.every((x) => x.sku === "181670964"));
  });
  await ok("multi SKU: output = sum of selected pages, original order, content identical", async () => {
    const sel = pick("1372453380_53", "181670964");
    const out = await mk(sel);
    assert.strictEqual(out.pages, 9);
    assert.deepStrictEqual(out.pageList, [1, 2, 3, 4, 5, 6, 11, 12, 13]);
    assert.ok(/^Meesho_Filtered_Labels_\d{4}-\d{2}-\d{2}\.pdf$/.test(out.name));
    const r = await analyse(Buffer.from(await out.blob.arrayBuffer()));
    assert.deepStrictEqual(r.map((x) => x.orderId), out.pageList.map((p) => records[p - 1].orderId));
    assert.deepStrictEqual(r.map((x) => x.text), out.pageList.map((p) => records[p - 1].text));
  });
  await ok("page size / orientation preserved", async () => {
    const out = await mk(pick("CT-200-BLK"));
    const d = await PDFLib.PDFDocument.load(await out.blob.arrayBuffer());
    d.getPages().forEach((p) => assert.deepStrictEqual([p.getWidth(), p.getHeight()], [420, 620]));
  });
  await ok("'Group output by SKU' = SKU blocks, original order within each", () => {
    const a = generate.resolvePageOrder([bySku("1372453380_53"), bySku("181670964")], true);
    const b = generate.resolvePageOrder([bySku("181670964"), bySku("1372453380_53")], true);
    assert.deepStrictEqual(a, [1, 2, 3, 4, 5, 6, 11, 12, 13]); // blocks by first appearance
    assert.deepStrictEqual(a, b); // independent of input order
    // interleaved SKUs: blocks must be contiguous, order inside block preserved
    const mix = [{ pages: [1, 3, 5] }, { pages: [2, 4] }];
    assert.deepStrictEqual(generate.resolvePageOrder(mix, true), [1, 3, 5, 2, 4]);
    assert.deepStrictEqual(generate.resolvePageOrder(mix, false), [1, 2, 3, 4, 5]);
  });
  await ok("ZIP mode: one PDF per SKU with correct page counts + safe names", async () => {
    const out = await generate.generateSeparateZip({ selected: pick("181670964", "1372453380_53", "CT-200-BLK"), sourceBytes: src(), onProgress: noop, isCancelled: () => false });
    assert.strictEqual(out.pages, 11);
    const zip = await JSZip.loadAsync(await out.blob.arrayBuffer());
    const names = Object.keys(zip.files);
    assert.strictEqual(names.length, 3);
    for (const n of names) {
      assert.ok(!/[\\/:*?"<>|]/.test(n), "unsafe name " + n);
      const d = await PDFLib.PDFDocument.load(await zip.files[n].async("uint8array"));
      assert.strictEqual(d.getPageCount(), Number(n.match(/__(\d+)pages/)[1]));
    }
  });
  await ok("cancel mid-generation throws and produces nothing", async () => {
    await assert.rejects(mk(pick("181670964"), { isCancelled: () => true }), /cancelled/);
  });
  await ok("empty selection is refused (no empty PDF)", async () => {
    await assert.rejects(mk([]), /No pages/);
  });
  await ok("manual correction moves page between groups before generation", async () => {
    const recs = JSON.parse(JSON.stringify(records));
    recs[15].manualSku = "181670964";
    const g2 = group.buildGroups(recs);
    assert.deepStrictEqual(g2.find((g) => g.sku === "181670964").pages, [1, 2, 3, 4, 5, 6, 16]);
    assert.deepStrictEqual(g2.find((g) => g.key === group.UNDETECTED).pages, [17]);
    const out = await generate.generateCombined({ selected: g2.filter((g) => g.sku === "181670964"), groupBySku: false, sourceBytes: src(), onProgress: noop, isCancelled: () => false });
    assert.strictEqual(out.pages, 7);
    // the unrelated text of the moved page must not be reported as a name variation
    assert.strictEqual(g2.find((g) => g.sku === "181670964").nameVariants.length, 1);
  });

  console.log("Filtering / sorting / utils");
  await ok("search + filter + sort", () => {
    assert.deepStrictEqual(group.filterGroups(groups, "ct-200", "all").map((g) => g.sku), ["CT-200-BLK"]);
    assert.ok(group.filterGroups(groups, "white", "all").length >= 2);
    assert.deepStrictEqual(group.filterGroups(groups, "", "issues").map((g) => g.key), [group.UNDETECTED]);
    const s = group.sortGroups(groups, "sku", "asc");
    assert.strictEqual(s[s.length - 1].key, group.UNDETECTED);
    assert.strictEqual(group.sortGroups(groups, "pages", "desc")[0].sku, "181670964");
  });
  await ok("sanitizeFileName / formatPageRanges / toCsv", () => {
    assert.strictEqual(utils.sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j");
    assert.strictEqual(utils.sanitizeFileName("CON"), "_CON");
    assert.strictEqual(utils.sanitizeFileName("   "), "untitled");
    assert.strictEqual(utils.formatPageRanges([1, 2, 3, 7, 9, 10]), "1-3, 7, 9-10");
    assert.ok(utils.toCsv([["=cmd()"]]).includes("'=cmd()"));
  });

  console.log("Scale");
  await ok("300-page PDF: analyse + export 150 pages", async () => {
    const big = await PDFLib.PDFDocument.create();
    const font = await big.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let i = 0; i < 300; i++) {
      const pg = big.addPage([420, 620]);
      const t = (s, x, y) => pg.drawText(s, { x, y, size: 8, font });
      t("SKU", 24, 400); t("Size", 170, 400); t("Qty", 225, 400); t("Color", 260, 400); t("Order No.", 315, 400);
      t("SKU_" + (i % 25), 24, 388); t("Free Size", 170, 388); t("1", 225, 388); t("Red", 260, 388); t("77" + (100000 + i) + "_1", 315, 388);
      t("Description", 24, 300); t("HSN", 215, 300); t("Qty", 250, 300);
      t("Product number " + (i % 25) + " - Free Size", 24, 286); t("3926", 215, 286); t("1", 250, 286);
    }
    const bytes = Buffer.from(await big.save());
    const t0 = Date.now();
    const recs = await analyse(bytes);
    const gs = group.buildGroups(recs);
    assert.strictEqual(gs.length, 25);
    assert.ok(gs.every((g) => g.pages.length === 12));
    const half = gs.slice(0, 12).concat(gs.slice(12, 13).slice(0, 0));
    const expect = half.reduce((n, g) => n + g.pages.length, 0);
    const out = await generate.generateCombined({ selected: half, groupBySku: false, sourceBytes: ab(bytes), onProgress: noop, isCancelled: () => false });
    assert.strictEqual(out.pages, expect);
    console.log("      (" + (Date.now() - t0) + " ms for 300 pages)");
  });

  console.log("\n" + passed + " passed" + (process.exitCode ? " — FAILURES ABOVE" : ", 0 failed"));
})();
