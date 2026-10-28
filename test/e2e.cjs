// OPTIONAL real-Chrome end-to-end test (needs: npm i -D playwright-core && npx playwright-core install chromium).
//   node test/makeSample.mjs && node test/e2e.cjs dist/index.html dist
const { chromium } = require("playwright-core");
const path = require("path"); const fs = require("fs");
const assert = require("assert");
const TMP = require("os").tmpdir();

const PROJECT = process.cwd(); // run from the project root
const target = process.argv[2] || "dist/index.html";
const label = process.argv[3] || "e2e";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (["error"].includes(m.type())) errors.push("CONSOLE " + m.text()); });

  await page.goto("file://" + path.join(PROJECT, target));
  console.log(`[${label}] loaded`);
  await page.setInputFiles("#file-input", path.join(PROJECT, "test/out/sample.pdf"));
  await page.waitForSelector("#results:not([hidden])", { timeout: 30000 });
  const stats = await page.$$eval(".stat", (els) => els.map((e) => e.querySelector(".stat-label").textContent + "=" + e.querySelector(".stat-value").textContent));
  console.log(`[${label}] stats:`, stats.join(" | "));
  assert.deepStrictEqual(stats.slice(0, 4), ["Total pages=17", "Unique SKUs=4", "Classified pages=15", "Need review=2"]);

  const rows = await page.$$eval("#table-body tr:not(.detail-row)", (trs) => trs.map((t) => t.children[1].textContent.trim() + " :: " + t.children[3].textContent.trim()));
  console.log(`[${label}] rows:`, rows);
  assert.strictEqual(rows.length, 5);

  // search + select only
  await page.fill("#search", "1372453380");
  assert.strictEqual(await page.$$eval("#table-body tr:not(.detail-row)", (t) => t.length), 1);
  await page.click("#btn-select-only");
  await page.fill("#search", "");
  assert.match(await page.textContent("#sel-total"), /1 SKU · 3 pages/);
  // add another
  await page.click('#table-body tr:has-text("181670964") input[type=checkbox]');
  assert.match(await page.textContent("#sel-total"), /2 SKUs · 9 pages/);

  // generate combined, capture download
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#btn-generate")]);
  const out = path.join(TMP, "out-" + label + ".pdf");
  await dl.saveAs(out);
  console.log(`[${label}] downloaded`, dl.suggestedFilename(), fs.statSync(out).size, "bytes");
  assert.match(dl.suggestedFilename(), /^Meesho_Filtered_Labels_\d{4}-\d{2}-\d{2}\.pdf$/);
  const { PDFDocument } = require(path.join(PROJECT, "node_modules/pdf-lib"));
  const d = await PDFDocument.load(fs.readFileSync(out));
  assert.strictEqual(d.getPageCount(), 9);
  assert.ok(await page.isVisible("#gen-result"));

  // manual assignment of a review page
  await page.selectOption("#review-body tr:first-child select", "181670964");
  assert.match(await page.textContent("#review-title"), /1 page/);
  const stats2 = await page.$$eval(".stat-value", (els) => els.map((e) => e.textContent));
  console.log(`[${label}] after manual assign:`, stats2.join(","));

  // inspector renders a page
  await page.click('#table-body tr:has-text("CT-200-BLK") .link:last-child');
  await page.click(".chip >> nth=0");
  await page.waitForSelector("#inspector:not([hidden])");
  await page.waitForTimeout(800);
  const painted = await page.$eval("#insp-canvas", (c) => { const ctx = c.getContext("2d"); const d = ctx.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) n++; return n; });
  console.log(`[${label}] inspector dark pixels:`, painted);
  assert.ok(painted > 200);
  await page.screenshot({ path: path.join(TMP, `shot-inspector-${label}.png`) });
  await page.keyboard.press("Escape");

  // ZIP mode
  await page.click("#table-wrap input#check-all, #check-all");
  await page.check('input[name=mode][value=separate]');
  const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#btn-generate")]);
  console.log(`[${label}] zip`, dl2.suggestedFilename());
  assert.match(dl2.suggestedFilename(), /\.zip$/);

  // Remove PDF
  await page.screenshot({ path: path.join(TMP, `shot-main-${label}.png`), fullPage: true });
  await page.click("#btn-remove");
  assert.ok(await page.isVisible("#dropzone"));
  // non-PDF
  fs.writeFileSync(path.join(TMP, "x.txt"), "hello");
  await page.setInputFiles("#file-input", path.join(TMP, "x.txt"));
  assert.match(await page.textContent("#upload-error-text"), /not a PDF/);
  // corrupt pdf
  fs.writeFileSync(path.join(TMP, "bad.pdf"), "%PDF-1.4 garbage garbage");
  await page.setInputFiles("#file-input", path.join(TMP, "bad.pdf"));
  await page.waitForFunction(() => !document.getElementById("upload-error").hidden && /PDF|corrupt|valid|Invalid|structure/i.test(document.getElementById("upload-error-text").textContent), null, { timeout: 15000 });
  console.log(`[${label}] corrupt msg:`, await page.textContent("#upload-error-text"));

  console.log(`[${label}] errors:`, errors.length ? errors : "none");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log(`[${label}] E2E OK`);
})().catch((e) => { console.error("E2E FAILED", e); process.exit(1); });
