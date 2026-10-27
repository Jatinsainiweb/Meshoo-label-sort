import {
  DetectionConfidence,
  PageClassificationStatus,
  ParsedPdfPage,
  PdfTextLine,
  PdfTextToken,
  UNCLASSIFIED_SKU_KEY,
} from '../types/pdfSorter';

/**
 * Groups raw PDF.js text items with coordinates into top-to-bottom visual lines,
 * with left-to-right sorted tokens on each line.
 */
export function buildVisualLines(tokens: PdfTextToken[], yTolerance = 3.8): PdfTextLine[] {
  const cleanTokens = tokens
    .map((t) => ({
      ...t,
      text: t.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((t) => t.text.length > 0);

  if (cleanTokens.length === 0) return [];

  // Sort top-to-bottom (higher Y first in PDF coordinates), then left-to-right
  const sorted = [...cleanTokens].sort((a, b) => {
    if (Math.abs(b.y - a.y) > yTolerance) {
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const rawLines: { ySum: number; count: number; tokens: PdfTextToken[] }[] = [];

  for (const token of sorted) {
    let matchedLine: { ySum: number; count: number; tokens: PdfTextToken[] } | null = null;
    for (const line of rawLines) {
      const avgY = line.ySum / line.count;
      if (Math.abs(avgY - token.y) <= yTolerance) {
        matchedLine = line;
        break;
      }
    }

    if (matchedLine) {
      matchedLine.tokens.push(token);
      matchedLine.ySum += token.y;
      matchedLine.count += 1;
    } else {
      rawLines.push({
        ySum: token.y,
        count: 1,
        tokens: [token],
      });
    }
  }

  return rawLines
    .map((line) => {
      const sortedLineTokens = [...line.tokens].sort((a, b) => a.x - b.x);
      return {
        y: line.ySum / line.count,
        tokens: sortedLineTokens,
        text: sortedLineTokens.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim(),
      };
    })
    .sort((a, b) => b.y - a.y);
}

/**
 * Checks whether a candidate string is a valid potential SKU and NOT a reserved keyword,
 * GSTIN, date, price, PIN code, or noise token.
 */
const RESERVED_NON_SKU_WORDS = new Set([
  'SKU',
  'SIZE',
  'QTY',
  'QUANTITY',
  'COLOR',
  'COLOUR',
  'ORDER',
  'NO',
  'NO.',
  'ORDERNO',
  'PRODUCT',
  'DETAILS',
  'DESCRIPTION',
  'TAX',
  'INVOICE',
  'BILL',
  'SUPPLY',
  'HSN',
  'SAC',
  'GROSS',
  'AMOUNT',
  'DISCOUNT',
  'TAXABLE',
  'VALUE',
  'IGST',
  'CGST',
  'SGST',
  'UTGST',
  'TOTAL',
  'FREE',
  'FREESIZE',
  'NA',
  'N/A',
  'NONE',
  'NULL',
  'CUSTOMER',
  'ADDRESS',
  'RETURN',
  'COD',
  'PREPAID',
  'PICKUP',
  'DELIVERY',
  'VALMO',
  'DELHIVERY',
  'SHADOWFAX',
  'XPRESSBEES',
  'ECOM',
  'EXPRESS',
  'ORIGINAL',
  'RECIPIENT',
  'SIGNATORY',
  'MEESHO',
  'FOLD',
  'HERE',
  'CUT',
  'DATE',
  'GSTIN',
  'STATE',
  'PLACE',
  'BLACK',
  'WHITE',
  'RED',
  'BLUE',
  'GREEN',
  'YELLOW',
  'PINK',
  'MULTICOLOR',
  'BROWN',
  'GREY',
  'GRAY',
  'ORANGE',
  'PURPLE',
  'SILVER',
  'GOLD',
]);

const SIZE_TOKENS = new Set([
  'FREE SIZE',
  'FREESIZE',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  'XXXL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  'NA',
  'UNSTITCHED',
]);

/**
 * Validates if a string matches valid SKU format rules and does not match GSTIN, dates, etc.
 */
export function isValidSkuFormat(
  candidate: string,
  knownNonSkus: Set<string>
): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 48) return false;

  const upper = trimmed.toUpperCase();
  if (RESERVED_NON_SKU_WORDS.has(upper)) return false;
  if (SIZE_TOKENS.has(upper)) return false;
  if (knownNonSkus.has(trimmed) || knownNonSkus.has(upper)) return false;

  // Reject Indian 15-character GSTIN format (e.g. 27AAAAA0000A1Z5)
  if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(trimmed)) {
    return false;
  }

  // Reject dates like 27/10/2026 or 2026-10-27 or 27.10.2026
  if (/^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(trimmed)) {
    return false;
  }

  // Reject pure currency / decimal amounts like Rs.149.00 or 149.00
  if (/^(RS\.?|INR|₹)?\s*\d+\.\d{2}$/i.test(trimmed)) {
    return false;
  }

  // Must contain at least one alphanumeric character and only valid SKU characters
  // Valid SKU chars: letters, digits, underscores (_), hyphens (-), slashes (/), dots (.)
  if (!/^[A-Za-z0-9][A-Za-z0-9_\-./]*[A-Za-z0-9]$/.test(trimmed)) {
    return false;
  }

  // Purely alphabetical common English words (without digits, underscores, or hyphens) are rarely SKUs
  // unless they have digits, underscores, or hyphens
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length < 5) {
    return false;
  }

  return true;
}

/**
 * Extracts known non-SKU identifiers on the page first (Order IDs, Sub-Order IDs, Invoice Nos,
 * GSTINs, HSN codes, AWB Barcodes, PIN codes) so they are never mistaken for a SKU.
 */
interface PageIdentifiers {
  orderIds: Set<string>;
  invoiceNos: Set<string>;
  gstins: Set<string>;
  hsnCodes: Set<string>;
  awbCodes: Set<string>;
  pinCodes: Set<string>;
  courier: string | null;
}

function extractPageNonSkuIdentifiers(lines: PdfTextLine[], fullText: string): PageIdentifiers {
  const orderIds = new Set<string>();
  const invoiceNos = new Set<string>();
  const gstins = new Set<string>();
  const hsnCodes = new Set<string>();
  const awbCodes = new Set<string>();
  const pinCodes = new Set<string>();
  let courier: string | null = null;

  // Detect Courier Partner
  const courierMatch = fullText.match(
    /\b(Valmo|Shadowfax|Delhivery|Xpressbees|Ecom\s*Express|DTDC|Bluedart|Ekart)\b/i
  );
  if (courierMatch) {
    courier = courierMatch[1].replace(/\s+/g, ' ').trim();
  }

  // Detect GSTIN (15-char standard format)
  const gstMatches = fullText.matchAll(
    /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/gi
  );
  for (const m of gstMatches) {
    gstins.add(m[0].toUpperCase());
  }

  // Detect explicit Order No / Sub Order No / Purchase Order No on the same line (never bridging across newlines)
  const orderPatterns = [
    /(?:Purchase[ \t]+Order[ \t]+No\.?|Sub[ \t]*[-]?[ \t]*Order[ \t]+No\.?|Order[ \t]+No\.?|Order[ \t]+ID|Packet[ \t]+ID)[ \t]*[:\-][ \t]*([0-9]{8,20}(?:_[0-9]{1,3})?)/gi,
  ];
  for (const pat of orderPatterns) {
    for (const m of fullText.matchAll(pat)) {
      if (m[1]) {
        orderIds.add(m[1].trim());
        // Also add base order number without _1 suffix
        const base = m[1].trim().split('_')[0];
        if (base.length >= 9) orderIds.add(base);
      }
    }
  }

  // Detect Invoice No on the same line
  const invMatches = fullText.matchAll(
    /(?:Invoice[ \t]+No\.?|Invoice[ \t]+Number|Bill[ \t]+No\.?)[ \t]*[:\-][ \t]*([A-Za-z0-9\-\/]{4,28})/gi
  );
  for (const m of invMatches) {
    const val = m[1].trim();
    if (!/^(Date|Order|Tax|Original)$/i.test(val)) {
      invoiceNos.add(val);
    }
  }

  // Detect explicit HSN codes on the same line
  const hsnMatches = fullText.matchAll(/\bHSN(?:[ \t]*Code)?[ \t]*[:\-][ \t]*(\d{4,8})\b/gi);
  for (const m of hsnMatches) {
    hsnCodes.add(m[1].trim());
  }

  // Detect PIN codes in address section on the same line
  const pinMatches = fullText.matchAll(/(?:PIN|Pincode|Pin[ \t]*Code)[ \t]*[:\-]?[ \t]*(\d{6})\b/gi);
  for (const m of pinMatches) {
    pinCodes.add(m[1].trim());
  }

  // Scan lines for AWB / Barcode in top section (before Product Details)
  for (const line of lines) {
    if (/Product\s+Details/i.test(line.text)) break;
    const awbMatch = line.text.match(/\b(?:AWB|Tracking\s*No\.?|Waybill)\s*[:\-]?\s*([A-Za-z0-9]{8,22})\b/i);
    if (awbMatch) {
      awbCodes.add(awbMatch[1].trim());
    }
  }

  return {
    orderIds,
    invoiceNos,
    gstins,
    hsnCodes,
    awbCodes,
    pinCodes,
    courier,
  };
}

interface ExtractedRowItem {
  sku: string;
  size: string | null;
  qty: number;
  color: string | null;
  orderId: string | null;
  confidence: DetectionConfidence;
  method: string;
}

/**
 * Parses the Meesho "Product Details" section using both spatial column positions
 * and structured row pattern matching.
 */
function parseProductDetailsSection(
  lines: PdfTextLine[],
  knownNonSkus: Set<string>,
  knownOrderIds: Set<string>
): ExtractedRowItem[] {
  const results: ExtractedRowItem[] = [];

  // Find the header line that has "SKU" and at least one of "Size", "Qty", "Color", "Order"
  let headerLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    if (
      /\bSKU\b/i.test(text) &&
      (/\bSize\b/i.test(text) || /\bQty\b/i.test(text) || /\bOrder\s*No/i.test(text) || /\bColor\b/i.test(text))
    ) {
      headerLineIndex = i;
      break;
    }
  }

  if (headerLineIndex !== -1) {
    const headerLine = lines[headerLineIndex];

    // Identify X positions of column headers if available as separate tokens
    let sizeHeaderX: number | null = null;
    let qtyHeaderX: number | null = null;
    let colorHeaderX: number | null = null;
    let orderHeaderX: number | null = null;

    for (const tok of headerLine.tokens) {
      const upper = tok.text.toUpperCase();
      if (sizeHeaderX === null && (upper === 'SIZE' || upper.startsWith('SIZE '))) {
        sizeHeaderX = tok.x;
      }
      if (qtyHeaderX === null && (upper === 'QTY' || upper === 'QUANTITY')) {
        qtyHeaderX = tok.x;
      }
      if (colorHeaderX === null && (upper === 'COLOR' || upper === 'COLOUR')) {
        colorHeaderX = tok.x;
      }
      if (orderHeaderX === null && upper.startsWith('ORDER')) {
        orderHeaderX = tok.x;
      }
    }

    // Examine rows immediately following the header line until we hit TAX INVOICE / BILL OF SUPPLY / Fold Here
    for (let r = headerLineIndex + 1; r < Math.min(lines.length, headerLineIndex + 8); r++) {
      const rowLine = lines[r];
      const rowText = rowLine.text.trim();
      if (!rowText) continue;

      // Stop if we reached Tax Invoice / Bill of Supply / Cut / Fold divider
      if (
        /\b(TAX\s+INVOICE|BILL\s+OF\s+SUPPLY|Original\s+for\s+Recipient|Fold\s+Here|Cut\s+Here|Customer\s+Address|If\s+undelivered)\b/i.test(
          rowText
        )
      ) {
        break;
      }

      // Strategy 1A: Parse full row pattern: <SKU> <Size> <Qty> <Color> <OrderNo>
      // Example: "181670964 Free Size 1 Black 394827165012_1"
      // Example: "1372453380_53 Free Size 1 White 394827165099_1"
      // Example: "MSH-BLK-TIE-100 XL 2 Black 298374651928_1"
      const structuredMatch = rowText.match(
        /^([A-Za-z0-9][A-Za-z0-9_\-./]{1,45})\s+(Free\s+Size|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|NA|\d{1,2}\s*(?:inch|in|cm|mm|yr|yrs)?|[A-Za-z0-9\-]+)\s+(\d{1,4})\s+([A-Za-z\s\/\-]+?)\s+([0-9]{8,20}(?:_[0-9]{1,3})?)$/i
      );

      if (structuredMatch) {
        const rawSku = structuredMatch[1].trim();
        const rawSize = structuredMatch[2].trim();
        const rawQty = parseInt(structuredMatch[3], 10) || 1;
        const rawColor = structuredMatch[4].trim();
        const rawOrderId = structuredMatch[5].trim();

        // Register the rightmost column value as an Order ID so it's never confused with a SKU
        knownOrderIds.add(rawOrderId);
        knownNonSkus.add(rawOrderId);

        if (isValidSkuFormat(rawSku, knownNonSkus)) {
          results.push({
            sku: rawSku,
            size: rawSize,
            qty: rawQty,
            color: rawColor,
            orderId: rawOrderId,
            confidence: 'high',
            method: 'Product Details table row (structured columns)',
          });
          continue;
        }
      }

      // Strategy 1B: Spatial X-coordinate column slicing when header tokens had distinct X positions
      if (sizeHeaderX !== null && rowLine.tokens.length >= 2) {
        const skuTokens = rowLine.tokens.filter((t) => t.x < sizeHeaderX! - 6);
        if (skuTokens.length > 0) {
          const candidateSku = skuTokens.map((t) => t.text).join('').trim();
          // Also check rightmost token for Order ID
          const lastToken = rowLine.tokens[rowLine.tokens.length - 1];
          let detectedOrderId: string | null = null;
          if (
            lastToken &&
            lastToken !== skuTokens[0] &&
            /^[0-9]{8,20}(?:_[0-9]{1,3})?$/.test(lastToken.text.trim())
          ) {
            detectedOrderId = lastToken.text.trim();
            knownOrderIds.add(detectedOrderId);
            knownNonSkus.add(detectedOrderId);
          }

          if (isValidSkuFormat(candidateSku, knownNonSkus)) {
            // Extract size & qty from remaining tokens
            const restText = rowLine.tokens
              .filter((t) => t.x >= sizeHeaderX! - 6)
              .map((t) => t.text)
              .join(' ');
            const sizeMatch = restText.match(
              /\b(Free\s+Size|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|NA)\b/i
            );
            const qtyMatch = restText.match(/\b(\d{1,3})\b/);

            results.push({
              sku: candidateSku,
              size: sizeMatch ? sizeMatch[1] : null,
              qty: qtyMatch ? parseInt(qtyMatch[1], 10) || 1 : 1,
              color: null,
              orderId: detectedOrderId,
              confidence: 'high',
              method: 'Product Details table (spatial SKU column)',
            });
            continue;
          }
        }
      }

      // Strategy 1C: Token-level fallback on the row below SKU header
      // If the row starts with a valid SKU followed by Size or Qty
      const rowParts = rowText.split(/\s+/);
      if (rowParts.length >= 2) {
        const firstToken = rowParts[0].trim();
        const lastToken = rowParts[rowParts.length - 1].trim();
        let rowOrderId: string | null = null;

        if (
          rowParts.length >= 3 &&
          /^[0-9]{8,20}(?:_[0-9]{1,3})?$/.test(lastToken) &&
          lastToken !== firstToken
        ) {
          rowOrderId = lastToken;
          knownOrderIds.add(rowOrderId);
          knownNonSkus.add(rowOrderId);
        }

        if (isValidSkuFormat(firstToken, knownNonSkus)) {
          const sizeMatch = rowText.match(
            /\b(Free\s+Size|XS|S|M|L|XL|XXL|XXXL|[2-5]XL)\b/i
          );
          const qtyMatch = rowText
            .slice(firstToken.length)
            .match(/\b([1-9]\d{0,2})\b/);
          results.push({
            sku: firstToken,
            size: sizeMatch ? sizeMatch[1] : null,
            qty: qtyMatch ? parseInt(qtyMatch[1], 10) || 1 : 1,
            color: null,
            orderId: rowOrderId,
            confidence: 'high',
            method: 'Product Details table (leading SKU column)',
          });
        }
      }
    }
  }

  return results;
}

/**
 * Fallback explicit label search for pages where "Seller SKU:" or "SKU:" is printed inline.
 */
function parseExplicitSkuLabels(
  lines: PdfTextLine[],
  knownNonSkus: Set<string>
): ExtractedRowItem[] {
  const results: ExtractedRowItem[] = [];

  for (const line of lines) {
    // Skip table header lines like "SKU Size Qty Color Order No."
    if (/\bSKU\b.*\b(Size|Qty|Order)\b/i.test(line.text)) continue;

    const match = line.text.match(
      /\b(?:Seller\s+SKU|SKU\s+Code|SKU\s+ID|SKU)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9_\-./]{1,45})\b/i
    );
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (isValidSkuFormat(candidate, knownNonSkus)) {
        results.push({
          sku: candidate,
          size: null,
          qty: 1,
          color: null,
          orderId: null,
          confidence: 'medium',
          method: 'Explicit SKU key-value label',
        });
      }
    }
  }

  return results;
}

/**
 * Cleans an extracted product description line so invoice numbers, HSN codes,
 * currency values, or table headers do not pollute the product name.
 */
function cleanExtractedProductName(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();

  // Remove leading serial number like "1 " or "1. " only if followed by a letter or number+inch/pcs
  text = text.replace(/^(?:SN\.?\s*)?[1-9]\.\s+/, '');

  // Strip invoice numeric columns (HSN + Qty + Gross/Total) whether at the end of the line or starting the line when Description is blank:
  // Pattern: <4-8 digit HSN> <1-3 digit Qty> <Decimal Price/Gross> ...
  text = text.replace(
    /(?:^|\s+)\b\d{4,8}\s+\d{1,3}\s+(?:Rs\.?\s*|INR\s*|₹\s*)?\d+(?:\.\d{1,2})?(?:\s+.*)?$/i,
    ''
  );

  // Also strip trailing HSN code + prices if attached at the very end
  text = text.replace(
    /\s+\bHSN\s*[:\-]?\s*\d{4,8}\b.*$/i,
    ''
  );

  // Strip trailing IGST/CGST/SGST tax breakdown fragments
  text = text.replace(
    /\s+\b(?:IGST|CGST|SGST|UTGST)\s*@?\s*\d+(?:\.\d+)?%.*$/i,
    ''
  );

  // Trim stray leading/trailing pipes or colons
  text = text.replace(/^[|:\-\s]+|[|:\s]+$/g, '').trim();

  return text;
}

/**
 * Extracts the Product / Item Name and HSN from the Tax Invoice "Description" column
 * or explicit Product Name / Item Description fields.
 */
function extractProductNameAndHsn(
  lines: PdfTextLine[],
  fullText: string,
  detectedSku: string | null
): { productName: string; hsn: string | null } {
  let hsn: string | null = null;

  // Check for explicit HSN anywhere on page
  const explicitHsn = fullText.match(/\bHSN(?:\s*Code)?\s*[:\-]?\s*(\d{4,8})\b/i);
  if (explicitHsn) {
    hsn = explicitHsn[1];
  }

  // Strategy 1: Look for explicit "Product Name:" / "Item Name:" label if present
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].text;
    const explicitMatch = lineText.match(
      /\b(?:Product\s+Name|Item\s+Name|Product\s+Title)\s*[:\-]\s*(.+)$/i
    );
    if (explicitMatch && explicitMatch[1]) {
      const cleaned = cleanExtractedProductName(explicitMatch[1]);
      if (cleaned.length >= 3 && !/^(NA|N\/A|None|Null)$/i.test(cleaned)) {
        return { productName: cleaned, hsn };
      }
    }
  }

  // Strategy 2: Parse the Tax Invoice / Bill of Supply "Description" table section
  let descHeaderIndex = -1;
  let hsnColumnX: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /\bDescription\b/i.test(line.text) &&
      (/\bHSN\b/i.test(line.text) ||
        /\bQty\b/i.test(line.text) ||
        /\bGross\b/i.test(line.text) ||
        /\bTaxable\b/i.test(line.text) ||
        /\bTotal\b/i.test(line.text))
    ) {
      descHeaderIndex = i;
      for (const tok of line.tokens) {
        const upper = tok.text.toUpperCase();
        if (
          hsnColumnX === null &&
          (upper === 'HSN' ||
            upper === 'HSN/SAC' ||
            upper === 'QTY' ||
            upper.startsWith('GROSS'))
        ) {
          hsnColumnX = tok.x;
        }
      }
      break;
    }
  }

  if (descHeaderIndex !== -1) {
    const descriptionParts: string[] = [];

    for (
      let r = descHeaderIndex + 1;
      r < Math.min(lines.length, descHeaderIndex + 7);
      r++
    ) {
      const rowLine = lines[r];
      const rowText = rowLine.text.trim();
      if (!rowText) continue;

      // Stop when reaching summary/footer rows of the invoice
      if (
        /^(?:Total|Sub\s*Total|Grand\s*Total|Tax\s+is\s+not|Authorized\s+Signatory|Terms|Declaration|Shipping\s+Charges|Customer\s+Name|Sold\s+By)\b/i.test(
          rowText
        )
      ) {
        break;
      }

      // Extract HSN from this row if it has a 6-8 digit HSN number
      const rowHsnMatch = rowText.match(/\b(\d{6,8})\s+\d{1,3}\s+/);
      if (rowHsnMatch && !hsn) {
        hsn = rowHsnMatch[1];
      }

      // If we have spatial X coordinate for HSN/Qty column, filter tokens strictly to the left of HSN column
      if (hsnColumnX !== null && rowLine.tokens.length > 1) {
        const leftTokens = rowLine.tokens.filter((t) => t.x < hsnColumnX! - 10);
        if (leftTokens.length > 0) {
          const leftText = leftTokens.map((t) => t.text).join(' ').trim();
          // Ignore pure tax rate or serial number tokens
          if (
            leftText &&
            !/^(?:\d+\.?|IGST|CGST|SGST|Shipping|Total)$/i.test(leftText) &&
            leftText !== detectedSku
          ) {
            descriptionParts.push(leftText);
          }
          continue;
        }
      }

      // Line-based extraction fallback
      const cleanedLine = cleanExtractedProductName(rowText);
      if (
        cleanedLine &&
        cleanedLine.length >= 3 &&
        !/^(?:IGST|CGST|SGST|Total|Taxable|Discount)/i.test(cleanedLine) &&
        cleanedLine !== detectedSku
      ) {
        descriptionParts.push(cleanedLine);
      }
    }

    if (descriptionParts.length > 0) {
      const combined = cleanExtractedProductName(descriptionParts.join(' '));
      if (combined.length >= 3) {
        return { productName: combined, hsn };
      }
    }
  }

  // Strategy 3: Look for "Description:" inline field
  const inlineDescMatch = fullText.match(
    /\bDescription\s*[:\-]\s*([^\n\r]{4,140})/i
  );
  if (inlineDescMatch && inlineDescMatch[1]) {
    const cleaned = cleanExtractedProductName(inlineDescMatch[1]);
    if (
      cleaned.length >= 3 &&
      !/\b(HSN|Gross\s+Amount|Taxable\s+Value)\b/i.test(cleaned)
    ) {
      return { productName: cleaned, hsn };
    }
  }

  return { productName: 'Name Not Detected', hsn };
}

/**
 * Analyzes a single PDF page's spatial text tokens and returns a complete ParsedPdfPage record.
 */
export function analyzeMeeshoPage(
  pageNumber: number,
  tokens: PdfTextToken[]
): ParsedPdfPage {
  const lines = buildVisualLines(tokens);
  const lineStrings = lines.map((l) => l.text);
  const rawText = lineStrings.join('\n');

  // Case 1: Empty / scanned image-only page with no extractable text
  if (lines.length === 0 || rawText.trim().length === 0) {
    return {
      pageNumber,
      detectedSku: null,
      effectiveSku: UNCLASSIFIED_SKU_KEY,
      detectedProductName: 'Name Not Detected',
      effectiveProductName: 'Name Not Detected',
      orderId: null,
      size: null,
      qty: 1,
      color: null,
      courier: null,
      hsn: null,
      status: 'review_required',
      confidence: 'low',
      reviewReason:
        'Page contains no extractable text (blank page or scanned image without OCR layer).',
      skuCandidates: [],
      extractionMethod: 'None (Empty Text Layer)',
      lines: [],
      rawText: '',
      isManuallyAssigned: false,
    };
  }

  // Extract all non-SKU identifiers on the page first for contextual exclusion
  const identifiers = extractPageNonSkuIdentifiers(lines, rawText);
  const knownNonSkus = new Set<string>([
    ...identifiers.orderIds,
    ...identifiers.invoiceNos,
    ...identifiers.gstins,
    ...identifiers.hsnCodes,
    ...identifiers.awbCodes,
    ...identifiers.pinCodes,
  ]);

  // Tier 1 & 2: Parse Product Details table
  let skuItems = parseProductDetailsSection(
    lines,
    knownNonSkus,
    identifiers.orderIds
  );

  // Tier 3: Parse explicit SKU labels if Product Details table wasn't matched
  if (skuItems.length === 0) {
    skuItems = parseExplicitSkuLabels(lines, knownNonSkus);
  }

  // Extract Product Name and HSN from Invoice Description
  const primaryCandidateSku = skuItems.length > 0 ? skuItems[0].sku : null;
  const { productName, hsn } = extractProductNameAndHsn(
    lines,
    rawText,
    primaryCandidateSku
  );

  // Determine unique SKU candidates found on this page
  const uniqueSkus = Array.from(new Set(skuItems.map((item) => item.sku)));
  const firstOrderId =
    skuItems.find((i) => i.orderId)?.orderId ||
    Array.from(identifiers.orderIds)[0] ||
    null;

  // Case 2: No reliable SKU detected
  if (uniqueSkus.length === 0) {
    return {
      pageNumber,
      detectedSku: null,
      effectiveSku: UNCLASSIFIED_SKU_KEY,
      detectedProductName: productName,
      effectiveProductName: productName,
      orderId: firstOrderId,
      size: null,
      qty: 1,
      color: null,
      courier: identifiers.courier,
      hsn,
      status: 'review_required',
      confidence: 'low',
      reviewReason:
        productName !== 'Name Not Detected'
          ? 'Product name was found in invoice, but SKU was missing or unreadable in Product Details.'
          : 'No valid SKU could be identified in the Product Details or Invoice sections.',
      skuCandidates: [],
      extractionMethod: 'Failed Contextual Validation',
      lines: lineStrings,
      rawText,
      isManuallyAssigned: false,
    };
  }

  // Case 3: Multiple DIFFERENT SKUs detected on the same page (ambiguous or multi-item order page)
  const primaryItem = skuItems[0];
  const totalQtyOnPage = skuItems.reduce((acc, item) => acc + (item.qty || 1), 0);

  if (uniqueSkus.length > 1) {
    return {
      pageNumber,
      detectedSku: primaryItem.sku,
      effectiveSku: primaryItem.sku,
      detectedProductName: productName,
      effectiveProductName: productName,
      orderId: firstOrderId,
      size: primaryItem.size,
      qty: totalQtyOnPage,
      color: primaryItem.color,
      courier: identifiers.courier,
      hsn,
      status: 'review_required',
      confidence: 'medium',
      reviewReason: `Multiple distinct SKUs detected on the same page (${uniqueSkus.join(', ')}). Assigned to primary SKU "${primaryItem.sku}" — please verify.`,
      skuCandidates: uniqueSkus,
      extractionMethod: primaryItem.method,
      lines: lineStrings,
      rawText,
      isManuallyAssigned: false,
    };
  }

  // Case 4: Single reliable SKU detected
  const isMissingName = productName === 'Name Not Detected';
  const status: PageClassificationStatus = 'classified';

  return {
    pageNumber,
    detectedSku: primaryItem.sku,
    effectiveSku: primaryItem.sku,
    detectedProductName: productName,
    effectiveProductName: productName,
    orderId: firstOrderId,
    size: primaryItem.size,
    qty: primaryItem.qty || 1,
    color: primaryItem.color,
    courier: identifiers.courier,
    hsn,
    status,
    confidence: primaryItem.confidence,
    reviewReason: isMissingName
      ? 'SKU detected reliably, but product name was missing in the invoice description.'
      : null,
    skuCandidates: uniqueSkus,
    extractionMethod: primaryItem.method,
    lines: lineStrings,
    rawText,
    isManuallyAssigned: false,
  };
}
