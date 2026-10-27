import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export type SamplePresetId = 'standard_batch' | 'edge_cases' | 'large_batch';

export interface SamplePresetInfo {
  id: SamplePresetId;
  title: string;
  subtitle: string;
  pageCount: number;
  filename: string;
  badge: string;
}

export const SAMPLE_PRESETS: SamplePresetInfo[] = [
  {
    id: 'standard_batch',
    title: 'Sample 1: Mixed Cable Tie Batch (96 Pages)',
    subtitle:
      'Includes SKUs 181670964 (69p), 1429440434 (21p), 1372453380_53 (5p) + 1 unclassified page',
    pageCount: 96,
    filename: 'Meesho_Sample_Mixed_Labels_96Pages.pdf',
    badge: 'Recommended Demo',
  },
  {
    id: 'edge_cases',
    title: 'Sample 2: Edge-Case Verification Suite (24 Pages)',
    subtitle:
      'Tests underscores, hyphens, identical names across different SKUs, name variations & missing SKUs',
    pageCount: 24,
    filename: 'Meesho_Edge_Cases_Test_24Pages.pdf',
    badge: '12 Test Cases',
  },
  {
    id: 'large_batch',
    title: 'Sample 3: High-Volume Warehouse Batch (223 Pages)',
    subtitle:
      '12 SKUs across 223 pages — tests non-blocking progress bar ("85 / 223 pages") & bulk export',
    pageCount: 223,
    filename: 'Meesho_High_Volume_Batch_223Pages.pdf',
    badge: 'Stress Test',
  },
];

interface LabelPageSpec {
  sku: string | null;
  secondarySku?: string;
  productName: string | null;
  size: string;
  qty: number;
  color: string;
  orderNo: string;
  courier: string;
  awb: string;
  hsn: string;
  price: number;
  customerName: string;
  customerCity: string;
  customerPin: string;
}

const COURIERS = ['Valmo', 'Delhivery', 'Shadowfax', 'Xpressbees', 'Ecom Express'];
const CUSTOMERS = [
  { name: 'Ramesh Sharma', city: 'Andheri East, Mumbai, Maharashtra', pin: '400069' },
  { name: 'Priya Nair', city: 'Koramangala, Bengaluru, Karnataka', pin: '560034' },
  { name: 'Ankit Verma', city: 'Connaught Place, New Delhi, Delhi', pin: '110001' },
  { name: 'Sneha Patel', city: 'Navrangpura, Ahmedabad, Gujarat', pin: '380009' },
  { name: 'Vikram Reddy', city: 'Banjara Hills, Hyderabad, Telangana', pin: '500034' },
  { name: 'Deepak Joshi', city: 'Kothrud, Pune, Maharashtra', pin: '411038' },
];

/**
 * Draws a crisp vector Code-128 style barcode using pdf-lib rectangles so exported PDFs
 * have genuine vector barcodes that remain sharp at any zoom level.
 */
function drawVectorBarcode(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  seedStr: string
) {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  let cursorX = x;
  const maxX = x + width;
  let barIdx = 0;

  // Guard bars at start
  page.drawRectangle({ x: cursorX, y, width: 2, height, color: rgb(0, 0, 0) });
  cursorX += 3.5;
  page.drawRectangle({ x: cursorX, y, width: 1.2, height, color: rgb(0, 0, 0) });
  cursorX += 3;

  while (cursorX < maxX - 8) {
    const bits = Math.abs((hash >> (barIdx % 16)) ^ (barIdx * 37));
    const barW = 1 + (bits % 3) * 0.85;
    const gapW = 1.1 + ((bits >> 2) % 3) * 0.75;
    if (cursorX + barW > maxX - 6) break;

    page.drawRectangle({
      x: cursorX,
      y,
      width: barW,
      height,
      color: rgb(0, 0, 0),
    });
    cursorX += barW + gapW;
    barIdx++;
  }

  // Guard bars at end
  page.drawRectangle({
    x: maxX - 5,
    y,
    width: 1.5,
    height,
    color: rgb(0, 0, 0),
  });
  page.drawRectangle({
    x: maxX - 2,
    y,
    width: 2,
    height,
    color: rgb(0, 0, 0),
  });
}

/**
 * Draws a crisp vector 2D QR code matrix using pdf-lib rectangles.
 */
function drawVectorQrCode(
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  seedStr: string
) {
  const grid = 13;
  const cell = size / grid;

  // Outer border box
  page.drawRectangle({
    x: x - 2,
    y: y - 2,
    width: size + 4,
    height: size + 4,
    borderColor: rgb(0.1, 0.1, 0.1),
    borderWidth: 0.7,
    color: rgb(1, 1, 1),
  });

  const isFinder = (r: number, c: number) => {
    const topL = r < 4 && c < 4;
    const topR = r < 4 && c >= grid - 4;
    const botL = r >= grid - 4 && c < 4;
    return topL || topR || botL;
  };

  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      let fill = false;
      if (isFinder(r, c)) {
        const lr = r >= grid - 4 ? r - (grid - 4) : r;
        const lc = c >= grid - 4 ? c - (grid - 4) : c;
        if (
          lr === 0 ||
          lr === 3 ||
          lc === 0 ||
          lc === 3 ||
          (lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2)
        ) {
          fill = true;
        }
      } else {
        const charCode = seedStr.charCodeAt((r * grid + c) % seedStr.length);
        fill = ((charCode + r * 7 + c * 13) % 3) !== 0;
      }

      if (fill) {
        page.drawRectangle({
          x: x + c * cell,
          y: y + (grid - 1 - r) * cell,
          width: cell * 0.95,
          height: cell * 0.95,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
}

/**
 * Renders one realistic Meesho Shipping Label + Tax Invoice page onto the PDFDocument.
 */
function drawMeeshoLabelPage(
  pdfDoc: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  spec: LabelPageSpec,
  pageIndex: number
) {
  // Standard A4 portrait proportions (595 x 842 pt)
  const page = pdfDoc.addPage([595, 842]);
  const black = rgb(0.06, 0.09, 0.16);
  const darkGray = rgb(0.28, 0.33, 0.41);
  const borderGray = rgb(0.75, 0.79, 0.84);
  const lightBg = rgb(0.96, 0.97, 0.98);

  // OuterShipping Label Frame (Top Half: y=445 to y=812)
  page.drawRectangle({
    x: 28,
    y: 445,
    width: 539,
    height: 367,
    borderColor: black,
    borderWidth: 1.2,
  });

  // Top Header Strip (Courier + Prepaid/COD)
  page.drawRectangle({
    x: 29,
    y: 774,
    width: 537,
    height: 37,
    color: lightBg,
  });
  page.drawLine({
    start: { x: 28, y: 774 },
    end: { x: 567, y: 774 },
    thickness: 1,
    color: black,
  });

  page.drawText(spec.courier.toUpperCase(), {
    x: 40,
    y: 787,
    size: 14,
    font: fontBold,
    color: black,
  });

  page.drawText('PREPAID - DO NOT COLLECT CASH', {
    x: 195,
    y: 789,
    size: 9.5,
    font: fontBold,
    color: darkGray,
  });

  page.drawText(`Meesho Packet #${pageIndex + 1}`, {
    x: 455,
    y: 789,
    size: 8.5,
    font: fontRegular,
    color: darkGray,
  });

  // Address + Barcode / QR Section (y=615 to y=774)
  page.drawLine({
    start: { x: 315, y: 615 },
    end: { x: 315, y: 774 },
    thickness: 0.9,
    color: borderGray,
  });
  page.drawLine({
    start: { x: 28, y: 615 },
    end: { x: 567, y: 615 },
    thickness: 1,
    color: black,
  });

  // Left: Customer Address & Return Address
  page.drawText('Customer Address:', {
    x: 38,
    y: 756,
    size: 8.5,
    font: fontBold,
    color: darkGray,
  });
  page.drawText(spec.customerName, {
    x: 38,
    y: 741,
    size: 10.5,
    font: fontBold,
    color: black,
  });
  page.drawText(spec.customerCity, {
    x: 38,
    y: 726,
    size: 9,
    font: fontRegular,
    color: black,
  });
  page.drawText(`PIN : ${spec.customerPin}`, {
    x: 38,
    y: 711,
    size: 9.5,
    font: fontBold,
    color: black,
  });

  page.drawLine({
    start: { x: 38, y: 698 },
    end: { x: 305, y: 698 },
    thickness: 0.6,
    color: borderGray,
  });

  page.drawText('If undelivered, return to:', {
    x: 38,
    y: 683,
    size: 8,
    font: fontBold,
    color: darkGray,
  });
  page.drawText('Apex Industrial Supplies Pvt Ltd', {
    x: 38,
    y: 669,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawText('Plot 42, GIDC Industrial Estate, Vapi, Gujarat - 396195', {
    x: 38,
    y: 656,
    size: 8,
    font: fontRegular,
    color: darkGray,
  });
  page.drawText(`Order No: ${spec.orderNo}`, {
    x: 38,
    y: 632,
    size: 8.5,
    font: fontBold,
    color: black,
  });

  // Right: Vector Barcode + AWB + Vector QR Code
  drawVectorBarcode(page, 328, 705, 152, 46, spec.awb);
  page.drawText(`AWB: ${spec.awb}`, {
    x: 348,
    y: 692,
    size: 8.5,
    font: fontBold,
    color: black,
  });

  drawVectorQrCode(page, 494, 695, 58, `${spec.orderNo}_${spec.sku || 'NOSKU'}`);
  page.drawText('SCAN QR', {
    x: 504,
    y: 681,
    size: 7,
    font: fontBold,
    color: darkGray,
  });

  page.drawText(`Sub Order No: ${spec.orderNo}`, {
    x: 328,
    y: 632,
    size: 8.5,
    font: fontRegular,
    color: darkGray,
  });

  // PRODUCT DETAILS SECTION (y=445 to y=615)
  page.drawText('Product Details', {
    x: 38,
    y: 597,
    size: 10,
    font: fontBold,
    color: black,
  });

  // Product Details Table Header
  page.drawRectangle({
    x: 36,
    y: 566,
    width: 523,
    height: 22,
    color: lightBg,
    borderColor: borderGray,
    borderWidth: 0.8,
  });

  page.drawText('SKU', { x: 44, y: 573, size: 9, font: fontBold, color: black });
  page.drawText('Size', { x: 210, y: 573, size: 9, font: fontBold, color: black });
  page.drawText('Qty', { x: 295, y: 573, size: 9, font: fontBold, color: black });
  page.drawText('Color', { x: 345, y: 573, size: 9, font: fontBold, color: black });
  page.drawText('Order No.', { x: 430, y: 573, size: 9, font: fontBold, color: black });

  // Product Details Data Row 1
  if (spec.sku) {
    page.drawText(spec.sku, {
      x: 44,
      y: 545,
      size: 9.5,
      font: fontBold,
      color: black,
    });
  }
  page.drawText(spec.size, {
    x: 210,
    y: 545,
    size: 9,
    font: fontRegular,
    color: black,
  });
  page.drawText(String(spec.qty), {
    x: 295,
    y: 545,
    size: 9.5,
    font: fontBold,
    color: black,
  });
  page.drawText(spec.color, {
    x: 345,
    y: 545,
    size: 9,
    font: fontRegular,
    color: black,
  });
  page.drawText(spec.orderNo, {
    x: 430,
    y: 545,
    size: 9,
    font: fontRegular,
    color: black,
  });

  // Optional Secondary SKU row for multi-SKU ambiguity testing
  if (spec.secondarySku) {
    page.drawText(spec.secondarySku, {
      x: 44,
      y: 525,
      size: 9.5,
      font: fontBold,
      color: black,
    });
    page.drawText(spec.size, {
      x: 210,
      y: 525,
      size: 9,
      font: fontRegular,
      color: black,
    });
    page.drawText('1', {
      x: 295,
      y: 525,
      size: 9.5,
      font: fontBold,
      color: black,
    });
    page.drawText(spec.color, {
      x: 345,
      y: 525,
      size: 9,
      font: fontRegular,
      color: black,
    });
    page.drawText(spec.orderNo, {
      x: 430,
      y: 525,
      size: 9,
      font: fontRegular,
      color: black,
    });
  }

  // Fold Here Divider Line
  page.drawLine({
    start: { x: 28, y: 426 },
    end: { x: 567, y: 426 },
    thickness: 0.8,
    color: darkGray,
    dashArray: [5, 4],
  });
  page.drawText('--- Fold Here / Cut Here ---', {
    x: 235,
    y: 422,
    size: 8,
    font: fontRegular,
    color: darkGray,
  });

  // BOTTOM HALF: TAX INVOICE (y=45 to y=405)
  page.drawRectangle({
    x: 28,
    y: 55,
    width: 539,
    height: 350,
    borderColor: black,
    borderWidth: 1,
  });

  page.drawRectangle({
    x: 29,
    y: 374,
    width: 537,
    height: 30,
    color: lightBg,
  });

  page.drawText('TAX INVOICE', {
    x: 40,
    y: 384,
    size: 11,
    font: fontBold,
    color: black,
  });
  page.drawText('Original for Recipient', {
    x: 445,
    y: 385,
    size: 8.5,
    font: fontRegular,
    color: darkGray,
  });

  // Invoice Metadata
  const invNo = `M26IN${String(100000 + pageIndex)}`;
  page.drawText(`Purchase Order No: ${spec.orderNo}`, {
    x: 40,
    y: 352,
    size: 8.5,
    font: fontRegular,
    color: black,
  });
  page.drawText(`Invoice No: ${invNo}`, {
    x: 40,
    y: 338,
    size: 8.5,
    font: fontRegular,
    color: black,
  });
  page.drawText('GSTIN: 24AABCA9281K1Z5', {
    x: 350,
    y: 352,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawText('Invoice Date: 27/10/2026', {
    x: 350,
    y: 338,
    size: 8.5,
    font: fontRegular,
    color: black,
  });

  // Invoice Table Header
  page.drawRectangle({
    x: 36,
    y: 292,
    width: 523,
    height: 24,
    color: lightBg,
    borderColor: borderGray,
    borderWidth: 0.8,
  });

  page.drawText('Description', {
    x: 44,
    y: 300,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawText('HSN', {
    x: 330,
    y: 300,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawText('Qty', {
    x: 385,
    y: 300,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawText('Gross Amount', {
    x: 418,
    y: 300,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawText('Total', {
    x: 505,
    y: 300,
    size: 8.5,
    font: fontBold,
    color: black,
  });

  // Invoice Line Item Row
  if (spec.productName) {
    page.drawText(spec.productName, {
      x: 44,
      y: 268,
      size: 8.5,
      font: fontRegular,
      color: black,
    });
  }

  const totalAmt = (spec.price * spec.qty).toFixed(2);
  page.drawText(spec.hsn, {
    x: 330,
    y: 268,
    size: 8.5,
    font: fontRegular,
    color: black,
  });
  page.drawText(String(spec.qty), {
    x: 385,
    y: 268,
    size: 8.5,
    font: fontRegular,
    color: black,
  });
  page.drawText(`Rs.${totalAmt}`, {
    x: 418,
    y: 268,
    size: 8.5,
    font: fontRegular,
    color: black,
  });
  page.drawText(`Rs.${totalAmt}`, {
    x: 505,
    y: 268,
    size: 8.5,
    font: fontBold,
    color: black,
  });

  page.drawLine({
    start: { x: 36, y: 245 },
    end: { x: 559, y: 245 },
    thickness: 0.7,
    color: borderGray,
  });

  page.drawText(`Total Invoice Value: Rs.${totalAmt} (Inclusive of IGST @ 18%)`, {
    x: 44,
    y: 225,
    size: 9,
    font: fontBold,
    color: black,
  });

  page.drawText(
    'Tax is not payable on reverse charge basis. This is a computer generated tax invoice.',
    {
      x: 44,
      y: 80,
      size: 7.5,
      font: fontRegular,
      color: darkGray,
    }
  );
}

/**
 * Generates a complete binary Meesho Shipping Label PDF in memory for the chosen preset.
 */
export async function buildSampleMeeshoPdf(
  presetId: SamplePresetId
): Promise<{ file: File; buffer: ArrayBuffer; info: SamplePresetInfo }> {
  const presetInfo =
    SAMPLE_PRESETS.find((p) => p.id === presetId) || SAMPLE_PRESETS[0];

  const specs: LabelPageSpec[] = [];

  if (presetId === 'standard_batch') {
    // Build 96 pages:
    // - 69 pages of SKU "181670964" (65 pages with "12inch Black 100pcs Premium Quality Cable tie - Free Size" + 4 pages with slight name variation "12 inch Black High Quality Cable tie 100pcs - Free Size")
    // - 21 pages of SKU "1429440434" ("12inch White 100pcs Premium Quality Cable tie - Free Size")
    // - 5 pages of SKU "1372453380_53" ("Cable Tie White (1000pcs) - Free Size")
    // - 1 page with missing SKU (for Review Required demonstration)
    const pool: Array<{ sku: string | null; name: string | null; color: string; price: number }> = [];

    for (let i = 0; i < 69; i++) {
      pool.push({
        sku: '181670964',
        name:
          i >= 65
            ? '12 inch Black High Quality Cable tie 100pcs - Free Size'
            : '12inch Black 100pcs Premium Quality Cable tie - Free Size',
        color: 'Black',
        price: 169,
      });
    }
    for (let i = 0; i < 21; i++) {
      pool.push({
        sku: '1429440434',
        name: '12inch White 100pcs Premium Quality Cable tie - Free Size',
        color: 'White',
        price: 175,
      });
    }
    for (let i = 0; i < 5; i++) {
      pool.push({
        sku: '1372453380_53',
        name: 'Cable Tie White (1000pcs) - Free Size',
        color: 'White',
        price: 549,
      });
    }
    // 1 unclassified page
    pool.push({
      sku: null,
      name: '12inch White 100pcs Premium Quality Cable tie - Free Size',
      color: 'White',
      price: 175,
    });

    // Interleave deterministically so pages are mixed like a real Meesho download
    const mixed: typeof pool = [];
    const step = 7;
    const visited = new Array(pool.length).fill(false);
    let cursor = 0;
    for (let count = 0; count < pool.length; count++) {
      while (visited[cursor]) {
        cursor = (cursor + 1) % pool.length;
      }
      visited[cursor] = true;
      mixed.push(pool[cursor]);
      cursor = (cursor + step) % pool.length;
    }

    for (let i = 0; i < mixed.length; i++) {
      const item = mixed[i];
      const cust = CUSTOMERS[i % CUSTOMERS.length];
      specs.push({
        sku: item.sku,
        productName: item.name,
        size: 'Free Size',
        qty: i % 11 === 0 ? 2 : 1,
        color: item.color,
        orderNo: `${394827165000 + i}_1`,
        courier: COURIERS[i % COURIERS.length],
        awb: `VL${882910000 + i}`,
        hsn: '39269099',
        price: item.price,
        customerName: cust.name,
        customerCity: cust.city,
        customerPin: cust.pin,
      });
    }
  } else if (presetId === 'edge_cases') {
    // 24 pages covering all 12 test cases
    const items: Array<{
      sku: string | null;
      secondarySku?: string;
      name: string | null;
      size: string;
      color: string;
      count: number;
    }> = [
      // 1. Standard numeric SKU
      {
        sku: '181670964',
        name: '12inch Black 100pcs Premium Quality Cable tie - Free Size',
        size: 'Free Size',
        color: 'Black',
        count: 5,
      },
      // 2. Same SKU with slight name variation
      {
        sku: '181670964',
        name: '12 inch Black High Quality Cable tie 100pcs - Free Size',
        size: 'Free Size',
        color: 'Black',
        count: 2,
      },
      // 3. SKU with underscore
      {
        sku: '1372453380_53',
        name: 'Cable Tie White (1000pcs) - Free Size',
        size: 'Free Size',
        color: 'White',
        count: 4,
      },
      // 4. Alphanumeric SKU with hyphens & underscores
      {
        sku: 'MSH-BLK-TIE_250-XL',
        name: 'Heavy Duty UV Resistant Outdoor Cable Tie 250pcs - XL',
        size: 'XL',
        color: 'Black',
        count: 4,
      },
      // 5 & 6. Two DIFFERENT SKUs with IDENTICAL product names (must stay separate!)
      {
        sku: '990182731_A',
        name: '8inch Nylon Self-Locking Zip Tie Pack of 200 - Free Size',
        size: 'Free Size',
        color: 'White',
        count: 3,
      },
      {
        sku: '990182732_B',
        name: '8inch Nylon Self-Locking Zip Tie Pack of 200 - Free Size',
        size: 'Free Size',
        color: 'White',
        count: 3,
      },
      // 7. SKU present, but Product Name missing on page
      {
        sku: 'SKU-NONAME-707',
        name: null,
        size: 'Free Size',
        color: 'Black',
        count: 1,
      },
      // 8. Missing SKU (Review Required)
      {
        sku: null,
        name: '12inch White 100pcs Premium Quality Cable tie - Free Size',
        size: 'Free Size',
        color: 'White',
        count: 1,
      },
      // 9. Multi-SKU page (Ambiguous — Review Required)
      {
        sku: '1429440434',
        secondarySku: '1372453380_53',
        name: '12inch White 100pcs Premium Quality Cable tie - Free Size',
        size: 'Free Size',
        color: 'White',
        count: 1,
      },
    ];

    let idx = 0;
    for (const group of items) {
      for (let c = 0; c < group.count; c++) {
        const cust = CUSTOMERS[idx % CUSTOMERS.length];
        specs.push({
          sku: group.sku,
          secondarySku: group.secondarySku,
          productName: group.name,
          size: group.size,
          qty: 1,
          color: group.color,
          orderNo: `${481920394000 + idx}_1`,
          courier: COURIERS[idx % COURIERS.length],
          awb: `SF${77102930 + idx}`,
          hsn: '39269099',
          price: 199,
          customerName: cust.name,
          customerCity: cust.city,
          customerPin: cust.pin,
        });
        idx++;
      }
    }
  } else {
    // High-volume 223-page stress test across 12 SKUs + 2 review pages
    const catalog = [
      { sku: '181670964', name: '12inch Black 100pcs Premium Quality Cable tie - Free Size', color: 'Black', count: 52 },
      { sku: '1429440434', name: '12inch White 100pcs Premium Quality Cable tie - Free Size', color: 'White', count: 38 },
      { sku: '1372453380_53', name: 'Cable Tie White (1000pcs) - Free Size', color: 'White', count: 27 },
      { sku: 'MSH-BLK-1000_PRO', name: 'Cable Tie Black Industrial (1000pcs) - Free Size', color: 'Black', count: 22 },
      { sku: '882716504_10IN', name: '10inch Nylon Cable Tie Heavy Duty 100pcs - Free Size', color: 'Black', count: 19 },
      { sku: '882716505_10IN_W', name: '10inch Nylon Cable Tie Heavy Duty 100pcs - Free Size', color: 'White', count: 16 },
      { sku: 'CT-8INCH-BLK-500', name: '8inch Black Cable Tie Value Pack 500pcs - Free Size', color: 'Black', count: 14 },
      { sku: 'CT-6INCH-MULTI-250', name: '6inch Multicolor Organizer Cable Ties 250pcs - Free Size', color: 'Multicolor', count: 11 },
      { sku: 'VELCRO-STRAP-BLK-20', name: 'Reusable Hook & Loop Cable Straps 20pcs - Free Size', color: 'Black', count: 9 },
      { sku: 'ADHESIVE-MOUNT-100', name: 'Self-Adhesive Cable Tie Mount Base 25x25mm (100pcs)', color: 'White', count: 7 },
      { sku: 'SPIRAL-WRAP-2M-BLK', name: 'Flexible Spiral Cable Wrap Organizer Tube 2 Meter', color: 'Black', count: 4 },
      { sku: 'STAINLESS-TIE-304_50', name: 'SS304 Metal Exhaust Locking Cable Tie 50pcs', color: 'Silver', count: 2 },
      { sku: null, name: 'Unlabeled Cable Tie Sample Packet - Free Size', color: 'White', count: 2 },
    ];

    const pool: Array<{ sku: string | null; name: string | null; color: string }> = [];
    for (const c of catalog) {
      for (let i = 0; i < c.count; i++) {
        pool.push({ sku: c.sku, name: c.name, color: c.color });
      }
    }

    for (let i = 0; i < pool.length; i++) {
      // Deterministic shuffle index
      const pick = pool[(i * 13) % pool.length];
      const cust = CUSTOMERS[i % CUSTOMERS.length];
      specs.push({
        sku: pick.sku,
        productName: pick.name,
        size: 'Free Size',
        qty: 1,
        color: pick.color,
        orderNo: `${592837461000 + i}_1`,
        courier: COURIERS[i % COURIERS.length],
        awb: `DL${991827300 + i}`,
        hsn: '39269099',
        price: 229,
        customerName: cust.name,
        customerCity: cust.city,
        customerPin: cust.pin,
      });
    }
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < specs.length; i++) {
    drawMeeshoLabelPage(pdfDoc, fontRegular, fontBold, specs[i], i);
  }

  const pdfBytes = await pdfDoc.save();
  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;

  const file = new File([arrayBuffer], presetInfo.filename, {
    type: 'application/pdf',
  });

  return {
    file,
    buffer: arrayBuffer,
    info: presetInfo,
  };
}
