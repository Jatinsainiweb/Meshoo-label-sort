# Meesho Shipping Label PDF Sorter — Local Chrome Utility

A fast, 100% local, privacy-preserving desktop web application for Meesho sellers to scan mixed shipping-label and tax-invoice PDFs, detect each page's **SKU** and **Product / Item Name**, group pages by exact SKU, and generate filtered PDFs containing only the selected products' original pages.

---

## 1. Key Capabilities

- **100% Local Client-Side Processing**: Runs entirely inside Google Chrome on Windows. No backend server, login, database, or external API is ever used. Your customer addresses, barcodes, and invoices never leave your computer.
- **Lossless Original Label Preservation**: Uses `pdf-lib` (`copyPages`) to copy the exact binary PDF page objects from your source PDF. Shipping labels, Code-128 barcodes, 2D QR codes, customer addresses, and tax invoices remain 100% untouched and scannable.
- **Spatial & Contextual SKU Detection**:
  - Extracts SKUs from the `Product Details` table (`SKU | Size | Qty | Color | Order No.`) and explicit SKU fields.
  - Supports numeric SKUs (`181670964`), underscore SKUs (`1372453380_53`), and hyphenated/alphanumeric SKUs (`MSH-BLK-TIE_250-XL`).
  - Contextually excludes Order IDs, Sub-Order IDs, HSN codes, GSTINs, Invoice numbers, PIN codes, and AWB tracking numbers so they are never mistaken for SKUs.
- **Product Name Extraction & Variation Detection**:
  - Extracts product descriptions from the Tax Invoice `Description` column.
  - Keeps different SKUs with identical product names strictly separate.
  - Groups pages sharing the same exact SKU together and flags any product-name variations for review.
- **Review Required & Visual Label Inspector**:
  - Never silently discards unclassified pages. Any page with a missing or ambiguous SKU is listed under **Review Required**.
  - Click any page badge (`p.1`, `p.14`, etc.) or **Inspect Label** to view a live rendered preview of that PDF page and manually assign it to an existing or custom SKU.
- **Dual Output Modes**:
  - **Mode A — One Combined PDF**: Combines all pages for the selected SKUs into a single PDF (either preserving original page order by default, or grouping output pages by SKU).
  - **Mode B — Separate PDFs by SKU (`.zip`)**: Generates one individual PDF per selected SKU (`<SKU>_<ProductName>.pdf`) and packages them into a single downloadable `.zip` archive.

---

## 2. How to Run on Windows in Google Chrome

### Method A — Direct Single-File Launch (Recommended for Sellers)
Because the project builds into a self-contained single-file bundle (`dist/index.html`) with `PDF.js`, `pdf-lib`, and `JSZip` embedded directly inside the file:

1. Locate `dist/index.html` on your Windows computer.
2. Right-click `dist/index.html` and select **Open with -> Google Chrome** (or double-click if Chrome is your default browser).
3. The application opens immediately and works completely offline.

### Method B — Running from Source on Windows (For Developers)
If you want to run the development server or rebuild the application from source:

1. Ensure [Node.js](https://nodejs.org/) (v18+) is installed on your Windows PC.
2. Open **Command Prompt** or **PowerShell** in the project folder.
3. Install dependencies locally:
   ```bash
   npm install
   ```
4. Start the local server:
   ```bash
   npm run dev
   ```
5. Open the displayed local URL (e.g., `http://localhost:5173`) in **Google Chrome**.
6. To produce the self-contained single-file production bundle (`dist/index.html`):
   ```bash
   npm run build
   ```

---

## 3. Codebase Architecture

- `index.html` — Application shell and font definitions.
- `src/types/pdfSorter.ts` — TypeScript definitions for spatial text tokens, parsed pages, SKU groups, and export options.
- `src/services/pdfExtractor.ts` — Local PDF.js initialization (with bundled in-memory worker), non-blocking chunked page extraction, cancellation, error handling, and `<canvas>` page preview rendering.
- `src/services/skuDetector.ts` — Spatial table column and contextual regex parser for Meesho SKUs, Product Names, Order IDs, Sizes, Quantities, Couriers, and HSN codes.
- `src/services/productGrouper.ts` — Exact-SKU grouping engine, name-variation detector, and manual page-to-SKU reassignment logic.
- `src/services/pdfGenerator.ts` — Lossless PDF page copying (`pdf-lib`) and multi-PDF ZIP packaging (`JSZip`) with Windows-safe filename sanitization.
- `src/services/samplePdfBuilder.ts` — Dynamic generator that builds authentic multi-page Meesho shipping label + tax invoice PDFs (with vector barcodes and QR codes) in memory for testing all 12 test cases.
- `src/components/PageInspectorModal.tsx` — Side-by-side visual PDF page preview (`<canvas>`) and manual SKU assignment modal.
- `src/components/ReviewRequiredSection.tsx` — Dedicated management panel for unclassified or ambiguous pages.
