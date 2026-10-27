import * as pdfjsLib from 'pdfjs-dist';
// @ts-expect-error - Bundling PDF.js worker directly in-memory for 100% local offline execution
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js';
import { ParsedPdfPage, PdfTextToken } from '../types/pdfSorter';
import { analyzeMeeshoPage } from './skuDetector';

// Register the bundled worker on globalThis / window so PDF.js runs locally without external worker fetches
if (typeof window !== 'undefined') {
  (window as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;
}

export interface PdfExtractionCallbacks {
  onDocumentLoaded?: (totalPages: number) => void;
  onPageProcessed?: (
    processedPages: number,
    totalPages: number,
    latestPage: ParsedPdfPage
  ) => void;
  shouldCancel?: () => boolean;
}

export interface PdfExtractionResult {
  totalPages: number;
  pages: ParsedPdfPage[];
  cancelled: boolean;
}

/**
 * Validates that the binary buffer begins with a valid %PDF header.
 */
function hasPdfMagicHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  // Check within the first 1024 bytes for "%PDF-"
  const maxCheck = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= maxCheck; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Translates PDF.js errors into clear, actionable messages for sellers.
 */
export function formatPdfError(err: unknown): string {
  if (!err) return 'An unknown error occurred while reading the PDF file.';
  const e = err as { name?: string; message?: string };
  const name = e.name || '';
  const msg = e.message || String(err);

  if (name === 'PasswordException' || /password/i.test(msg)) {
    return 'This PDF is password-protected. Please unlock or remove the password before uploading.';
  }
  if (
    name === 'InvalidPDFException' ||
    /Invalid PDF structure/i.test(msg) ||
    /MissingPDFException/i.test(name)
  ) {
    return 'The uploaded file is corrupt or does not have a valid PDF structure. Please re-download the shipping label PDF from your Meesho Supplier Panel.';
  }
  return `Unable to read PDF file: ${msg}`;
}

/**
 * Extracts text and coordinates from every page of a PDF ArrayBuffer locally in the browser.
 * Yields to the browser event loop periodically to keep the UI responsive on large PDFs.
 */
export async function extractPagesFromPdfBuffer(
  buffer: ArrayBuffer,
  callbacks: PdfExtractionCallbacks = {}
): Promise<PdfExtractionResult> {
  // Clone the buffer so PDF.js does not detach the original ArrayBuffer needed by pdf-lib
  const uint8Copy = new Uint8Array(buffer.slice(0));

  if (uint8Copy.byteLength === 0) {
    throw new Error('The uploaded PDF file is empty (0 bytes).');
  }

  if (!hasPdfMagicHeader(uint8Copy)) {
    throw new Error(
      'Invalid file format: The selected file does not contain a valid PDF header (%PDF-).'
    );
  }

  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Copy,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    throw new Error(formatPdfError(err));
  }

  const totalPages = pdfDoc.numPages;
  if (totalPages === 0) {
    throw new Error('The uploaded PDF contains 0 pages.');
  }

  callbacks.onDocumentLoaded?.(totalPages);

  const parsedPages: ParsedPdfPage[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (callbacks.shouldCancel?.()) {
      await pdfDoc.destroy();
      return {
        totalPages,
        pages: parsedPages,
        cancelled: true,
      };
    }

    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const tokens: PdfTextToken[] = [];
    for (const item of textContent.items) {
      if ('str' in item && typeof item.str === 'string') {
        const transform = item.transform || [1, 0, 0, 1, 0, 0];
        const x = Number(transform[4]) || 0;
        const y = Number(transform[5]) || 0;
        tokens.push({
          text: item.str,
          x,
          y,
          width: Number(item.width) || 0,
          height: Number(item.height) || 10,
        });
      }
    }

    const analyzed = analyzeMeeshoPage(pageNum, tokens);
    parsedPages.push(analyzed);

    callbacks.onPageProcessed?.(pageNum, totalPages, analyzed);

    // Yield to UI thread every 3 pages (or every page for small files) so progress bar and cancel button stay responsive
    if (pageNum % 3 === 0 || totalPages <= 30) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  await pdfDoc.destroy();

  return {
    totalPages,
    pages: parsedPages,
    cancelled: false,
  };
}

/**
 * Renders a specific 1-indexed PDF page onto an HTMLCanvasElement for visual inspection
 * of barcodes, QR codes, shipping addresses, and invoice details.
 */
export async function renderPdfPageToCanvas(
  buffer: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.35
): Promise<{ width: number; height: number }> {
  const uint8Copy = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({
    data: uint8Copy,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  try {
    const clampedPage = Math.max(1, Math.min(pageNumber, pdfDoc.numPages));
    const page = await pdfDoc.getPage(clampedPage);
    const viewport = page.getViewport({ scale });

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D canvas context for page preview.');
    }

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    return { width: canvas.width, height: canvas.height };
  } finally {
    await pdfDoc.destroy();
  }
}
