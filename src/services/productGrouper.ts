import {
  ParsedPdfPage,
  SkuGroup,
  SkuGroupStatus,
  UNCLASSIFIED_SKU_KEY,
} from '../types/pdfSorter';

/**
 * Groups parsed PDF pages by their exact effectiveSku.
 * Pages with UNCLASSIFIED_SKU_KEY are excluded from standard SKU groups unless
 * includeUnclassifiedGroup is true.
 */
export function groupPagesBySku(
  pages: ParsedPdfPage[],
  includeUnclassifiedAsGroup = false
): SkuGroup[] {
  const map = new Map<string, ParsedPdfPage[]>();

  for (const page of pages) {
    const skuKey = page.effectiveSku;
    if (skuKey === UNCLASSIFIED_SKU_KEY && !includeUnclassifiedAsGroup) {
      continue;
    }
    const list = map.get(skuKey);
    if (list) {
      list.push(page);
    } else {
      map.set(skuKey, [page]);
    }
  }

  const groups: SkuGroup[] = [];

  for (const [sku, skuPages] of map.entries()) {
    // Ensure pages are sorted in ascending original page order
    const sortedPages = [...skuPages].sort((a, b) => a.pageNumber - b.pageNumber);
    const pageNumbers = sortedPages.map((p) => p.pageNumber);

    // Collect distinct non-missing product names for this SKU
    const nameFrequency = new Map<string, number>();
    for (const p of sortedPages) {
      const name = p.effectiveProductName.trim();
      if (name && name !== 'Name Not Detected') {
        nameFrequency.set(name, (nameFrequency.get(name) || 0) + 1);
      }
    }

    const productNameVariants = Array.from(nameFrequency.keys());
    let primaryProductName = 'Name Not Detected';

    if (productNameVariants.length > 0) {
      // Pick the most frequent product name for this SKU (tie-break by longest descriptive name)
      primaryProductName = [...productNameVariants].sort((a, b) => {
        const freqDiff = (nameFrequency.get(b) || 0) - (nameFrequency.get(a) || 0);
        if (freqDiff !== 0) return freqDiff;
        return b.length - a.length;
      })[0];
    } else if (sku === UNCLASSIFIED_SKU_KEY) {
      primaryProductName = 'SKU Not Detected (Unclassified Pages)';
    }

    const hasNameVariation = productNameVariants.length > 1;
    const hasMissingName =
      sku !== UNCLASSIFIED_SKU_KEY && primaryProductName === 'Name Not Detected';
    const hasManualAssignments = sortedPages.some((p) => p.isManuallyAssigned);

    let status: SkuGroupStatus = 'verified';
    if (sku === UNCLASSIFIED_SKU_KEY) {
      status = 'unclassified';
    } else if (hasNameVariation) {
      status = 'name_variation';
    } else if (hasMissingName) {
      status = 'missing_name';
    } else if (hasManualAssignments) {
      status = 'manual_group';
    }

    const totalQty = sortedPages.reduce((sum, p) => sum + (p.qty || 1), 0);
    const sizes = Array.from(
      new Set(sortedPages.map((p) => p.size).filter((s): s is string => Boolean(s)))
    );
    const couriers = Array.from(
      new Set(
        sortedPages.map((p) => p.courier).filter((c): c is string => Boolean(c))
      )
    );

    groups.push({
      sku,
      primaryProductName,
      productNameVariants,
      hasNameVariation,
      hasMissingName,
      pages: pageNumbers,
      pageDetails: sortedPages,
      totalQty,
      sizes,
      couriers,
      status,
      hasManualAssignments,
    });
  }

  return groups;
}

/**
 * Reassigns a specific page (by 1-indexed pageNumber) to a target SKU and optional product name.
 * Returns a new array of ParsedPdfPage items.
 */
export function reassignPageToSku(
  pages: ParsedPdfPage[],
  pageNumber: number,
  targetSku: string,
  targetProductName?: string
): ParsedPdfPage[] {
  const cleanSku = targetSku.trim();
  if (!cleanSku) return pages;

  // Find existing product name for targetSku if not explicitly provided
  let resolvedName = targetProductName?.trim();
  if (!resolvedName) {
    const existingMatch = pages.find(
      (p) =>
        p.effectiveSku === cleanSku &&
        p.effectiveProductName &&
        p.effectiveProductName !== 'Name Not Detected'
    );
    if (existingMatch) {
      resolvedName = existingMatch.effectiveProductName;
    }
  }

  return pages.map((page) => {
    if (page.pageNumber !== pageNumber) return page;

    const finalProductName =
      resolvedName ||
      (page.detectedProductName !== 'Name Not Detected'
        ? page.detectedProductName
        : 'Name Not Detected');

    return {
      ...page,
      effectiveSku: cleanSku,
      effectiveProductName: finalProductName,
      status: 'manually_assigned',
      confidence: 'manual',
      isManuallyAssigned: true,
      reviewReason: `Manually assigned to SKU "${cleanSku}" by user.`,
    };
  });
}

/**
 * Resets a manually assigned page back to its original auto-detected state.
 */
export function resetPageAssignment(
  pages: ParsedPdfPage[],
  pageNumber: number
): ParsedPdfPage[] {
  return pages.map((page) => {
    if (page.pageNumber !== pageNumber) return page;
    const restoredSku = page.detectedSku || UNCLASSIFIED_SKU_KEY;
    const isUnclassified = !page.detectedSku || page.skuCandidates.length > 1;
    return {
      ...page,
      effectiveSku: restoredSku,
      effectiveProductName: page.detectedProductName,
      status: isUnclassified ? 'review_required' : 'classified',
      confidence: page.detectedSku ? 'high' : 'low',
      isManuallyAssigned: false,
      reviewReason: !page.detectedSku
        ? 'No valid SKU could be identified in the Product Details or Invoice sections.'
        : page.skuCandidates.length > 1
        ? `Multiple distinct SKUs detected on the same page (${page.skuCandidates.join(', ')}).`
        : null,
    };
  });
}
