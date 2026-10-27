export interface PdfTextToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextLine {
  y: number;
  tokens: PdfTextToken[];
  text: string;
}

export type PageClassificationStatus =
  | 'classified'
  | 'review_required'
  | 'manually_assigned';

export type DetectionConfidence = 'high' | 'medium' | 'low' | 'manual';

export interface ParsedPdfPage {
  /** 1-indexed original PDF page number */
  pageNumber: number;
  /** Original detected SKU from the PDF page (null if none reliably detected) */
  detectedSku: string | null;
  /** Effective SKU used for grouping (includes manual user reassignments) */
  effectiveSku: string;
  /** Original detected Product / Item Name */
  detectedProductName: string;
  /** Effective Product Name used for display (includes manual overrides) */
  effectiveProductName: string;
  /** Order ID or Sub-Order ID if detected */
  orderId: string | null;
  /** Product Size if detected (e.g., Free Size, XL) */
  size: string | null;
  /** Quantity if detected on label */
  qty: number;
  /** Color if detected */
  color: string | null;
  /** Courier / Logistics partner if detected */
  courier: string | null;
  /** HSN Code if detected in tax invoice */
  hsn: string | null;
  /** Classification status */
  status: PageClassificationStatus;
  /** Confidence level of SKU extraction */
  confidence: DetectionConfidence;
  /** Explanation if page requires review or had ambiguity */
  reviewReason: string | null;
  /** Additional SKU candidates found on the page (for review resolution) */
  skuCandidates: string[];
  /** Extraction method used (for transparency in page inspector) */
  extractionMethod: string;
  /** Reconstructed visual lines from top to bottom */
  lines: string[];
  /** Full raw text of the page */
  rawText: string;
  /** Whether user manually corrected this page */
  isManuallyAssigned: boolean;
}

export type SkuGroupStatus =
  | 'verified'
  | 'name_variation'
  | 'missing_name'
  | 'manual_group'
  | 'unclassified';

export interface SkuGroup {
  /** Exact SKU string (primary grouping key) */
  sku: string;
  /** Representative product name for the SKU */
  primaryProductName: string;
  /** All distinct product names encountered for this exact SKU */
  productNameVariants: string[];
  /** True if the same SKU appeared with multiple slightly different product names */
  hasNameVariation: boolean;
  /** True if SKU was found but product name was missing on all its pages */
  hasMissingName: boolean;
  /** Sorted 1-indexed original PDF page numbers belonging to this SKU */
  pages: number[];
  /** Detailed page objects belonging to this SKU */
  pageDetails: ParsedPdfPage[];
  /** Sum of item quantities across all pages in this group */
  totalQty: number;
  /** Unique sizes seen for this SKU */
  sizes: string[];
  /** Unique couriers seen for this SKU */
  couriers: string[];
  /** Group status badge type */
  status: SkuGroupStatus;
  /** Whether any page in this group was manually assigned */
  hasManualAssignments: boolean;
}

export type OutputMode = 'combined_pdf' | 'separate_zip';

export type PageOrderMode = 'original_order' | 'group_by_sku';

export type SortColumn = 'sku' | 'productName' | 'pageCount' | 'status';
export type SortDirection = 'asc' | 'desc';

export type FilterTab = 'all' | 'verified' | 'name_variations' | 'review_required';

export interface ProcessingProgress {
  phase: 'idle' | 'loading_document' | 'extracting_pages' | 'grouping' | 'complete' | 'cancelled' | 'error';
  processedPages: number;
  totalPages: number;
  percentage: number;
  message: string;
}

export interface GenerationProgress {
  isGenerating: boolean;
  processedItems: number;
  totalItems: number;
  percentage: number;
  message: string;
}

export interface GeneratedOutputFile {
  filename: string;
  blobUrl: string;
  sizeBytes: number;
  pageCount: number;
  skuCount: number;
  mode: OutputMode;
  pageOrder: PageOrderMode;
  includedPages: number[];
  timestamp: string;
  individualFiles?: Array<{
    sku: string;
    productName: string;
    filename: string;
    pageCount: number;
    pages: number[];
    blobUrl: string;
  }>;
}

export const UNCLASSIFIED_SKU_KEY = '__SKU_NOT_DETECTED__';
