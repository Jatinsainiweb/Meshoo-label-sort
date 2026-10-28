import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

function page() {
  const p = doc.addPage([420, 620]);
  return (t, x, y, f = font, s = 8) =>
    p.drawText(String(t), { x, y, size: s, font: f, color: rgb(0, 0, 0) });
}

// Variant 1: inline "SKU:" key-value layout, no table
{
  const d = page();
  d("Meesho", 24, 590, bold, 14);
  d("Order No.: 9988776655_2", 24, 560);
  d("Invoice No: MH/2026/0091", 24, 546);
  d("GSTIN: 27AAACM1234C1ZV", 24, 532);
  d("HSN Code: 39269099", 24, 518);
  d("SKU: BLU_TIE-500", 24, 500);
  d("Product Name: Blue Nylon Cable Tie 500mm (50 pcs)", 24, 486);
  d("Qty: 1  Size: Free Size  Color: Blue", 24, 472);
  d("Pin: 400703   Mob: 9123456780", 24, 458);
}

// Variant 2: description cell contains "(SKU: ...)", no SKU column
{
  const d = page();
  d("TAX INVOICE", 24, 590, bold, 12);
  d("Description", 24, 540, bold);
  d("HSN", 240, 540, bold);
  d("Qty", 280, 540, bold);
  d("Total", 330, 540, bold);
  d("Red Cable Tie 300mm (SKU: RED-300-50)", 24, 524);
  d("39269099", 240, 524);
  d("2", 280, 524);
  d("Rs.350.00", 330, 524);
  d("Total", 280, 480, bold);
  d("Rs.350.00", 330, 480);
}

// Variant 3: page with only an address (no product info at all)
{
  const d = page();
  d("DELHIVERY", 24, 590, bold, 12);
  d("If undelivered, return to:", 24, 560);
  d("Example Traders, Plot 11, Bhiwandi 421302", 24, 546);
  d("1234567890", 24, 520);
}

// Variant 4: SKU column present but value is empty, name present
{
  const d = page();
  d("Product Details", 24, 590, bold);
  d("SKU", 24, 572, bold);
  d("Size", 170, 572, bold);
  d("Qty", 225, 572, bold);
  d("Color", 260, 572, bold);
  d("Order No.", 315, 572, bold);
  d("Free Size", 170, 558);
  d("1", 225, 558);
  d("Green", 260, 558);
  d("5544332211_1", 315, 558);
  d("Description", 24, 500, bold);
  d("HSN", 240, 500, bold);
  d("Green Cable Tie 150mm pack of 100", 24, 486);
  d("3926", 240, 486);
}

// Variant 5: same SKU as variant 1 but slightly different product name
{
  const d = page();
  d("SKU: BLU_TIE-500", 24, 560);
  d("Product Name: Blue Nylon Cable tie 500 mm  (50pcs)", 24, 546);
  d("Order No.: 9988776656_1", 24, 532);
}

fs.mkdirSync("test/out", { recursive: true });
fs.writeFileSync("test/out/variants.pdf", await doc.save());
console.log("wrote test/out/variants.pdf with", doc.getPageCount(), "pages");
