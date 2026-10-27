import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import {
  GeneratedOutputFile,
  OutputMode,
  PageOrderMode,
  SkuGroup,
  UNCLASSIFIED_SKU_KEY,
} from '../types/pdfSorter';

/**
 * Sanitizes a SKU or product name for safe Windows/Chrome filenames.
 * Removes reserved Windows characters: < > : " / \ | ? * and control chars.
 */
export function sanitizeFilenameSegment(input: string, maxLength = 42): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) return 'Item';
  return cleaned.slice(0, maxLength).replace(/_+$/, '');
}

/**
 * Returns YYYY-MM-DD formatted date string for filenames.
 */
export function getFormattedDateString(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface GeneratePdfOptions {
  sourceBuffer: ArrayBuffer;
  selectedGroups: SkuGroup[];
  outputMode: OutputMode;
  pageOrderMode: PageOrderMode;
  onProgress?: (processed: number, total: number, message: string) => void;
}

/**
 * Generates either a single combined PDF (Mode A) or a ZIP archive of separate SKU PDFs (Mode B)
 * by copying the original PDF pages losslessly with pdf-lib.
 */
export async function generateFilteredPdfOutput(
  options: GeneratePdfOptions
): Promise<GeneratedOutputFile> {
  const {
    sourceBuffer,
    selectedGroups,
    outputMode,
    pageOrderMode,
    onProgress,
  } = options;

  if (!selectedGroups || selectedGroups.length === 0) {
    throw new Error(
      'No products selected. Please select at least one SKU checkbox before generating a PDF.'
    );
  }

  // Verify no selected SKU has 0 mapped pages
  const emptyGroups = selectedGroups.filter(
    (g) => !g.pages || g.pages.length === 0
  );
  if (emptyGroups.length > 0) {
    const emptySkus = emptyGroups.map((g) => g.sku).join(', ');
    throw new Error(
      `Selected SKU(s) [${emptySkus}] have 0 mapped pages and cannot be exported.`
    );
  }

  const dateStr = getFormattedDateString();
  onProgress?.(0, 100, 'Loading original source PDF into memory...');

  const sourcePdfDoc = await PDFDocument.load(sourceBuffer.slice(0), {
    ignoreEncryption: true,
  });
  const totalSourcePages = sourcePdfDoc.getPageCount();

  // MODE A: One Combined PDF
  if (outputMode === 'combined_pdf') {
    let orderedPageNumbers: number[] = [];

    if (pageOrderMode === 'original_order') {
      // Collect unique 1-indexed page numbers across all selected SKUs and sort in original ascending order
      const pageSet = new Set<number>();
      for (const group of selectedGroups) {
        for (const p of group.pages) {
          if (p >= 1 && p <= totalSourcePages) {
            pageSet.add(p);
          }
        }
      }
      orderedPageNumbers = Array.from(pageSet).sort((a, b) => a - b);
    } else {
      // Group output by SKU: keep groups in their current order, and pages inside each group in ascending order
      const seenPages = new Set<number>();
      for (const group of selectedGroups) {
        const sortedGroupPages = [...group.pages].sort((a, b) => a - b);
        for (const p of sortedGroupPages) {
          if (p >= 1 && p <= totalSourcePages && !seenPages.has(p)) {
            seenPages.add(p);
            orderedPageNumbers.push(p);
          }
        }
      }
    }

    if (orderedPageNumbers.length === 0) {
      throw new Error('No valid pages found for the selected SKUs.');
    }

    const outPdfDoc = await PDFDocument.create();
    const totalToCopy = orderedPageNumbers.length;

    // Copy pages in chunks so progress updates smoothly for large PDFs
    const chunkSize = 25;
    for (let i = 0; i < totalToCopy; i += chunkSize) {
      const chunk = orderedPageNumbers.slice(i, i + chunkSize);
      const zeroBasedIndices = chunk.map((p) => p - 1);
      const copiedPages = await outPdfDoc.copyPages(
        sourcePdfDoc,
        zeroBasedIndices
      );
      for (const cp of copiedPages) {
        outPdfDoc.addPage(cp);
      }

      const completed = Math.min(i + chunk.length, totalToCopy);
      onProgress?.(
        completed,
        totalToCopy,
        `Copying page ${completed} of ${totalToCopy}...`
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Verify exact output page count matches expected count
    const finalPageCount = outPdfDoc.getPageCount();
    if (finalPageCount !== orderedPageNumbers.length) {
      throw new Error(
        `Page count verification failed: expected ${orderedPageNumbers.length} pages, but generated ${finalPageCount} pages.`
      );
    }

    onProgress?.(totalToCopy, totalToCopy, 'Serializing output PDF...');
    const pdfBytes = await outPdfDoc.save();
    const blob = new Blob([pdfBytes as unknown as BlobPart], {
      type: 'application/pdf',
    });
    const blobUrl = URL.createObjectURL(blob);

    let filename = `Meesho_Filtered_Labels_${dateStr}.pdf`;
    if (selectedGroups.length === 1) {
      const single = selectedGroups[0];
      const safeSku =
        single.sku === UNCLASSIFIED_SKU_KEY
          ? 'Unclassified'
          : sanitizeFilenameSegment(single.sku, 30);
      const safeName = sanitizeFilenameSegment(single.primaryProductName, 28);
      filename = `Meesho_SKU_${safeSku}_${safeName}_${dateStr}.pdf`;
    }

    return {
      filename,
      blobUrl,
      sizeBytes: pdfBytes.byteLength,
      pageCount: finalPageCount,
      skuCount: selectedGroups.length,
      mode: 'combined_pdf',
      pageOrder: pageOrderMode,
      includedPages: orderedPageNumbers,
      timestamp: new Date().toLocaleTimeString(),
    };
  }

  // MODE B: Separate PDFs by SKU packaged into a single ZIP file
  const zip = new JSZip();
  const individualFiles: NonNullable<GeneratedOutputFile['individualFiles']> = [];
  const allIncludedPages = new Set<number>();
  const usedFilenames = new Set<string>();

  for (let idx = 0; idx < selectedGroups.length; idx++) {
    const group = selectedGroups[idx];
    const sortedGroupPages = [...group.pages]
      .filter((p) => p >= 1 && p <= totalSourcePages)
      .sort((a, b) => a - b);

    onProgress?.(
      idx,
      selectedGroups.length,
      `Building PDF for SKU ${group.sku} (${sortedGroupPages.length} pages)...`
    );

    const skuPdfDoc = await PDFDocument.create();
    const zeroBasedIndices = sortedGroupPages.map((p) => p - 1);
    const copiedPages = await skuPdfDoc.copyPages(sourcePdfDoc, zeroBasedIndices);
    for (const cp of copiedPages) {
      skuPdfDoc.addPage(cp);
    }

    const skuPdfBytes = await skuPdfDoc.save();
    const safeSku =
      group.sku === UNCLASSIFIED_SKU_KEY
        ? 'SKU_Not_Detected'
        : sanitizeFilenameSegment(group.sku, 32);
    const safeName = sanitizeFilenameSegment(group.primaryProductName, 36);

    let baseFilename = `${safeSku}_${safeName}.pdf`;
    if (usedFilenames.has(baseFilename.toLowerCase())) {
      baseFilename = `${safeSku}_${safeName}_${idx + 1}.pdf`;
    }
    usedFilenames.add(baseFilename.toLowerCase());

    zip.file(baseFilename, skuPdfBytes);

    const singleBlob = new Blob([skuPdfBytes as unknown as BlobPart], {
      type: 'application/pdf',
    });
    const singleBlobUrl = URL.createObjectURL(singleBlob);

    for (const p of sortedGroupPages) {
      allIncludedPages.add(p);
    }

    individualFiles.push({
      sku: group.sku,
      productName: group.primaryProductName,
      filename: baseFilename,
      pageCount: sortedGroupPages.length,
      pages: sortedGroupPages,
      blobUrl: singleBlobUrl,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  onProgress?.(
    selectedGroups.length,
    selectedGroups.length,
    'Compressing separate SKU PDFs into ZIP archive...'
  );

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipBlobUrl = URL.createObjectURL(zipBlob);
  const zipFilename = `Meesho_Labels_By_SKU_${dateStr}.zip`;

  return {
    filename: zipFilename,
    blobUrl: zipBlobUrl,
    sizeBytes: zipBlob.size,
    pageCount: allIncludedPages.size,
    skuCount: selectedGroups.length,
    mode: 'separate_zip',
    pageOrder: 'group_by_sku',
    includedPages: Array.from(allIncludedPages).sort((a, b) => a - b),
    timestamp: new Date().toLocaleTimeString(),
    individualFiles,
  };
}
