# Meesho PDF Sorter (plain HTML + CSS + JavaScript)

Sort a mixed Meesho shipping-label PDF by **SKU** and **product name**, then download a new PDF that
contains only the pages for the products you picked.

Everything runs **inside your browser**. The PDF is never uploaded — no server, login, database or
paid API. There is no React, no TypeScript and no build step needed to *use* the tool.

---

## Run it on Windows (Google Chrome)

**Option 1 — the `meesho-sorter` folder (recommended)**

1. Copy the whole `meesho-sorter` folder to your PC, e.g. `C:\Tools\meesho-sorter\`.
2. Double-click `index.html` (or right-click → *Open with* → *Google Chrome*).
3. Drag your Meesho PDF onto the upload area.

Keep the folder structure intact — `index.html` loads `style.css`, `js\` and `vendor\` next to it.

**Option 2 — one single file**

`dist\index.html` (after `npm run build`) is the same app with the CSS, JavaScript and all three
libraries embedded in one file. Copy that one file anywhere and open it in Chrome.

Both options work offline: PDF.js, pdf-lib and JSZip are bundled locally (`meesho-sorter/vendor/`).
Nothing is fetched from the internet.

> **About Chrome and `file://`** — Chrome sometimes refuses to start background Web Workers for
> pages opened from disk. The tool detects this automatically and runs the PDF reader on the main
> thread instead (same results; large PDFs just take a little longer). To use real workers, serve
> the folder with any static server, e.g. `npx serve meesho-sorter`.

---

## Project layout

```
meesho-sorter/                 ← the application (plain files, edit these)
  index.html                   page structure
  style.css                    all styling
  js/utils.js                  file sizes, safe file names, page ranges, CSV, downloads
  js/pdf-reader.js             PDF.js: open PDF, extract positioned text, render preview, worker handling
  js/detect.js                 SKU / product name / order-id detection + validation
  js/group.js                  group by exact SKU, search / filter / sort
  js/generate.js               pdf-lib: copy original pages → combined PDF; JSZip: per-SKU ZIP
  js/ui.js                     DOM rendering helpers (text only — never innerHTML)
  js/app.js                    state + events: upload → analyse → select → review → generate
  vendor/                      pdf.min.js, pdf.worker.min.js, pdf-lib.min.js, jszip.min.js
tools/make-single-file.mjs     inlines everything into one index.html (for dist/)
test/                          sample-PDF generators, Node test-suite, optional Chrome E2E test
```

Scripts are classic `<script>` tags (not ES modules) precisely so the app works when double-clicked
from disk — Chrome blocks ES-module imports on `file://`.

---

## How to use it

1. **Upload** — drag & drop or choose a PDF. Filename, size and page count are shown, with a real
   progress bar (`85 / 223 pages · 38%`) and a *Cancel processing* button.
2. **Summary cards** — total pages, unique SKUs, classified pages, pages needing review, pages selected.
3. **Select products** — search by SKU or name, filter (*All / Detected only / Needs review*), sort by
   SKU / name / pages, tick rows, *Select all*, *Clear selection*, or search then *Select only these N*.
   Expand a row to see its original page numbers and click a page chip to preview it.
4. **Review required** — every page with no SKU, a weak SKU signal, several candidates, or no name.
   Assign pages individually or in bulk to an existing (or custom) SKU; the page map updates at once.
5. **Generate** — pick *A: one combined PDF* (optionally *Group output by SKU*) or *B: separate PDF per
   SKU in a ZIP*. The exact page count is shown before you generate; the download starts when the file
   really exists. *Export page map (CSV)* saves the full page → SKU table.

Use **Upload another PDF / Remove PDF** to start over without reloading.

## How detection works

Text is extracted with its x/y position and rebuilt into visual lines. Then:

1. **SKU from the table column** — find a header cell reading `SKU` on a line that also has
   `Size / Qty / Color / Order No.`, measure that column's horizontal slot, read the value beneath it
   (*high* confidence). This is why order ids, HSN, GSTIN and invoice numbers are not mistaken for SKUs.
2. **Fallbacks** — a bare `SKU` column, `SKU: ABC_12`, or `Product name (SKU: ABC_12)` (*medium/low*).
3. **Validation** — rejects GSTIN, dates, prices, phone numbers, 1–2 digit quantities, free text, size/colour
   words, and any value equal to the page's own order id.
4. **Product name** — from the invoice *Description* column (multi-line cells joined), else *Product
   Details / Product Name*. `SKU:`/`HSN` fragments are stripped; whitespace is collapsed; the rest is kept verbatim.

Grouping is by **exact SKU**: different SKUs are never merged (even with identical names); one SKU with
several name spellings stays together and is flagged; no name → "Name Not Detected"; no reliable SKU →
"SKU Not Detected" bucket (never discarded, can still be exported).

## Output guarantees

* Pages are **copied** from the original PDF with pdf-lib, not redrawn: size, orientation, barcodes, QR
  codes, fonts and images are unchanged.
* Default order = original order. *Group output by SKU* = one block per SKU (blocks ordered by each
  SKU's first page; original order inside a block).
* Before offering the file, the tool checks `output pages == sum of selected pages`.
* File names: `Meesho_Filtered_Labels_YYYY-MM-DD.pdf`, or `Meesho_<SKU>_<name>_YYYY-MM-DD.pdf` for a single
  SKU; ZIP: `Meesho_Labels_By_SKU_YYYY-MM-DD.zip` containing `<SKU>__<name>__<N>pages.pdf`. Names are
  sanitised for Windows (illegal characters, reserved names like `CON`, trailing dots).
* PDF text is untrusted: it is only displayed through `textContent`, never evaluated, and CSV export
  neutralises spreadsheet formulas.

---

## Tests (what was actually run)

```bash
npm install
node test/makeSample.mjs && node test/makeVariants.mjs     # synthetic Meesho-style PDFs → test/out/
node test/run.cjs                                          # 21 tests, loads the app's own js/ files
```

The suite covers: multiple SKUs; a SKU repeated over many pages; similar names on different SKUs;
numeric / `_` / `-` SKUs; inline-label and `(SKU: …)` layouts; blank-SKU and no-product pages; name
variations; single and multi-SKU selection; empty selection (refused); original order vs. grouped
order; page size preserved; output page count and per-page content equal to the originals; ZIP
contents; cancel; manual re-assignment; filename sanitising; and a 300-page PDF (~0.5 s to analyse).

An optional **real-Chrome end-to-end test** (`test/e2e.cjs`, needs `playwright-core` + Chromium) was also
run against both `dist/index.html` and `meesho-sorter/index.html` opened via `file://`: upload → analyse →
search/select → download a 9-page PDF → ZIP download → manual assignment → page preview → remove →
non-PDF and corrupt-PDF errors, with zero console errors.

### Honest limitations

* **Not tested against a real Meesho PDF** — none was available to me. The tests use synthetic PDFs that
  imitate the layout. Meesho can change its template; if a real file is misread, open the page inspector
  (click a page number) to see the extracted text and the detection source, fix pages in *Review
  required*, and send me the extracted text so detection can be tuned. Do a quick visual check of any
  large print batch.
* **No OCR** — scanned / image-only pages have no text. They are listed in *Review required* (with a
  preview) for manual assignment.
* **Barcode/QR "readability"** is guaranteed by construction (original page content is copied, not
  re-rendered) but was not scanned with a barcode reader here. Opening output in Adobe Reader / other
  viewers was not tested on Windows; output was re-opened and re-parsed with PDF.js and pdf-lib.
* Password-protected PDFs work only if you enter the password.
* Very large PDFs (1000+ pages) work but take proportionally longer; progress is real and cancellable.

## Rebuilding the single file (developers only)

```bash
node tools/make-single-file.mjs   # meesho-sorter/ → ./index.html (self-contained)
npm run build                     # Vite just copies it to dist/index.html
```

Vite is used only to produce `dist/`; it does not transform the application code.
