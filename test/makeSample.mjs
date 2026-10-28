import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";

const products = [
  { sku: "181670964", name: "12inch Black 100pcs Premium Quality Cable tie", size: "Free Size", color: "Black", copies: 6 },
  { sku: "1429440434", name: "12inch White 100pcs Premium Quality Cable tie", size: "Free Size", color: "White", copies: 4 },
  { sku: "1372453380_53", name: "Cable Tie White (1000pcs)", size: "Free Size", color: "White", copies: 3 },
  { sku: "CT-200-BLK", name: "Cable tie 200mm Heavy Duty Black pack of 50", size: "Free Size", color: "Black", copies: 2 },
  { sku: null, name: null, size: "", color: "", copies: 2 }, // unclassifiable pages
];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

let orderSeq = 100200300;

function wrap(text, max) {
  const words = text.split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      out.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

for (const p of products) {
  for (let c = 0; c < p.copies; c++) {
    const page = doc.addPage([420, 620]);
    const draw = (t, x, y, f = font, s = 8) =>
      page.drawText(String(t), { x, y, size: s, font: f, color: rgb(0, 0, 0) });

    draw("Meesho", 24, 590, bold, 14);
    draw("DELHIVERY", 300, 590, bold, 11);
    draw("Shipping Label", 24, 572, font, 9);
    draw("||| |||| || ||| |||| || |||| ||| |||", 24, 550, bold, 12);
    draw("AWB 2938471029384", 24, 536);

    draw("Customer Address", 24, 505, bold);
    draw("Rahul Sharma", 24, 492);
    draw("B-42, Sector 18, Near City Mall", 24, 480);
    draw("Noida, Uttar Pradesh, 201301", 24, 468);
    draw("Phone: 9876543210", 24, 456);

    draw("Invoice No: INV-2026-000" + (orderSeq % 997), 240, 492);
    draw("Invoice Date: 27.10.2026", 240, 480);
    draw("GSTIN: 09AABCU9603R1ZM", 240, 468);

    const orderId = `${orderSeq++}_${(c % 4) + 1}`;

    if (p.sku) {
      // Product table on the shipping label
      draw("Product Details", 24, 420, bold);
      draw("SKU", 24, 402, bold);
      draw("Size", 170, 402, bold);
      draw("Qty", 225, 402, bold);
      draw("Color", 260, 402, bold);
      draw("Order No.", 315, 402, bold);
      draw(p.sku, 24, 388);
      draw(p.size, 170, 388);
      draw("1", 225, 388);
      draw(p.color, 260, 388);
      draw(orderId, 315, 388);
    } else {
      draw("Product Details", 24, 420, bold);
      draw("Return address: Warehouse 7, Bhiwandi", 24, 400);
      draw("Handle with care", 24, 388);
    }

    draw("TAX INVOICE", 24, 340, bold, 10);
    draw("Sold by: Example Traders Pvt Ltd", 24, 326);
    draw("HSN: 3926", 240, 326);

    if (p.name) {
      draw("Description", 24, 300, bold);
      draw("HSN", 215, 300, bold);
      draw("Qty", 250, 300, bold);
      draw("Gross Amount", 285, 300, bold);
      draw("Total", 370, 300, bold);
      const lines = wrap(`${p.name} - ${p.size}`, 38);
      lines.forEach((l, i) => draw(l, 24, 286 - i * 11));
      draw("3926", 215, 286);
      draw("1", 250, 286);
      draw("Rs.199.00", 285, 286);
      draw("Rs.199.00", 370, 286);
      draw("Total", 285, 250, bold);
      draw("Rs.199.00", 370, 250);
    }

    draw("Tax is not payable on reverse charge basis.", 24, 200);
    draw("Declaration: This is a computer generated invoice.", 24, 188);
    draw("Page generated for testing only", 24, 40);
  }
}

fs.mkdirSync("test/out", { recursive: true });
fs.writeFileSync("test/out/sample.pdf", await doc.save());
console.log("wrote test/out/sample.pdf with", doc.getPageCount(), "pages");
