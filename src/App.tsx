import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FileUp,
  Filter,
  FolderKanban,
  HelpCircle,
  Layers,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  FilterTab,
  GeneratedOutputFile,
  GenerationProgress,
  OutputMode,
  PageOrderMode,
  ParsedPdfPage,
  ProcessingProgress,
  SortColumn,
  SortDirection,
  UNCLASSIFIED_SKU_KEY,
} from './types/pdfSorter';
import { extractPagesFromPdfBuffer } from './services/pdfExtractor';
import {
  groupPagesBySku,
  reassignPageToSku,
  resetPageAssignment,
} from './services/productGrouper';
import { generateFilteredPdfOutput } from './services/pdfGenerator';
import {
  buildSampleMeeshoPdf,
  SAMPLE_PRESETS,
  SamplePresetId,
} from './services/samplePdfBuilder';
import { PageInspectorModal } from './components/PageInspectorModal';
import { ReviewRequiredSection } from './components/ReviewRequiredSection';
import { WindowsInstructionsModal } from './components/WindowsInstructionsModal';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function App() {
  // Uploaded file & binary buffer state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sourceBuffer, setSourceBuffer] = useState<ArrayBuffer | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Extraction progress & cancellation
  const [progress, setProgress] = useState<ProcessingProgress>({
    phase: 'idle',
    processedPages: 0,
    totalPages: 0,
    percentage: 0,
    message: '',
  });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const cancelExtractionRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);

  // Parsed pages & grouping state
  const [parsedPages, setParsedPages] = useState<ParsedPdfPage[]>([]);
  const [includeUnclassifiedAsGroup, setIncludeUnclassifiedAsGroup] =
    useState<boolean>(false);

  // Selected SKUs (Set of exact SKU strings)
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  // Table search, filter, sort & row expansion
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTab>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('pageCount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedPageLists, setExpandedPageLists] = useState<Set<string>>(
    new Set()
  );
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(
    new Set()
  );
  const [copiedSku, setCopiedSku] = useState<string | null>(null);

  // Output PDF generation settings & state
  const [outputMode, setOutputMode] = useState<OutputMode>('combined_pdf');
  const [pageOrderMode, setPageOrderMode] =
    useState<PageOrderMode>('original_order');
  const [genProgress, setGenProgress] = useState<GenerationProgress>({
    isGenerating: false,
    processedItems: 0,
    totalItems: 0,
    percentage: 0,
    message: '',
  });
  const [generatedOutput, setGeneratedOutput] =
    useState<GeneratedOutputFile | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Modals (Page Inspector & Windows Instructions)
  const [inspectedPageNumber, setInspectedPageNumber] = useState<number | null>(
    null
  );
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const [loadingSampleId, setLoadingSampleId] =
    useState<SamplePresetId | null>(null);

  // Group pages by exact SKU dynamically whenever parsedPages or includeUnclassifiedAsGroup changes
  const skuGroups = useMemo(() => {
    return groupPagesBySku(parsedPages, includeUnclassifiedAsGroup);
  }, [parsedPages, includeUnclassifiedAsGroup]);

  // Telemetry metrics
  const totalPages = parsedPages.length;
  const classifiedPagesCount = useMemo(
    () =>
      parsedPages.filter((p) => p.effectiveSku !== UNCLASSIFIED_SKU_KEY).length,
    [parsedPages]
  );
  const reviewRequiredCount = useMemo(
    () =>
      parsedPages.filter(
        (p) =>
          p.effectiveSku === UNCLASSIFIED_SKU_KEY ||
          p.status === 'review_required'
      ).length,
    [parsedPages]
  );

  // Filter and sort SKU groups for table display
  const filteredAndSortedGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = skuGroups.filter((group) => {
      // Tab filter
      if (activeFilterTab === 'verified' && group.status !== 'verified') {
        return false;
      }
      if (
        activeFilterTab === 'name_variations' &&
        !group.hasNameVariation
      ) {
        return false;
      }
      if (
        activeFilterTab === 'review_required' &&
        group.status !== 'missing_name' &&
        group.status !== 'unclassified' &&
        !group.hasNameVariation
      ) {
        return false;
      }

      // Search query filter (matches SKU, product name, variant names, or page number)
      if (!query) return true;
      const matchesSku = group.sku.toLowerCase().includes(query);
      const matchesName = group.primaryProductName
        .toLowerCase()
        .includes(query);
      const matchesVariant = group.productNameVariants.some((v) =>
        v.toLowerCase().includes(query)
      );
      const matchesPage = group.pages.some((p) => String(p) === query);

      return matchesSku || matchesName || matchesVariant || matchesPage;
    });

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortColumn === 'sku') {
        comparison = a.sku.localeCompare(b.sku, undefined, { numeric: true });
      } else if (sortColumn === 'productName') {
        comparison = a.primaryProductName.localeCompare(b.primaryProductName);
      } else if (sortColumn === 'pageCount') {
        comparison = a.pages.length - b.pages.length;
      } else if (sortColumn === 'status') {
        comparison = a.status.localeCompare(b.status);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [skuGroups, searchQuery, activeFilterTab, sortColumn, sortDirection]);

  // Selected groups & selected page count
  const selectedGroups = useMemo(
    () => skuGroups.filter((g) => selectedSkus.has(g.sku)),
    [skuGroups, selectedSkus]
  );

  const totalSelectedPages = useMemo(() => {
    const uniquePages = new Set<number>();
    for (const g of selectedGroups) {
      for (const p of g.pages) {
        uniquePages.add(p);
      }
    }
    return uniquePages.size;
  }, [selectedGroups]);

  // Inspected page object
  const inspectedPage = useMemo(() => {
    if (inspectedPageNumber === null) return null;
    return (
      parsedPages.find((p) => p.pageNumber === inspectedPageNumber) || null
    );
  }, [parsedPages, inspectedPageNumber]);

  /**
   * Core handler to process any PDF File + ArrayBuffer locally in Chrome
   */
  const processPdfFile = async (file: File, preloadedBuffer?: ArrayBuffer) => {
    setErrorBanner(null);
    setGenerationError(null);
    setGeneratedOutput(null);
    setParsedPages([]);
    setSelectedSkus(new Set());
    setSearchQuery('');
    setActiveFilterTab('all');
    setExpandedPageLists(new Set());
    setExpandedVariants(new Set());
    cancelExtractionRef.current = false;

    // Validate extension or MIME type
    const isPdfFile =
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf');
    if (!isPdfFile) {
      setErrorBanner(
        `Unsupported file "${file.name}". Please upload a valid PDF file (.pdf) downloaded from Meesho.`
      );
      return;
    }

    setUploadedFile(file);
    setProgress({
      phase: 'loading_document',
      processedPages: 0,
      totalPages: 0,
      percentage: 0,
      message: `Opening "${file.name}" locally in browser...`,
    });

    try {
      const buffer = preloadedBuffer || (await file.arrayBuffer());
      setSourceBuffer(buffer);

      const result = await extractPagesFromPdfBuffer(buffer, {
        onDocumentLoaded: (numPages) => {
          setProgress({
            phase: 'extracting_pages',
            processedPages: 0,
            totalPages: numPages,
            percentage: 0,
            message: `Detected ${numPages} pages. Scanning SKUs and product names...`,
          });
        },
        onPageProcessed: (done, total) => {
          const pct = Math.round((done / total) * 100);
          setProgress({
            phase: 'extracting_pages',
            processedPages: done,
            totalPages: total,
            percentage: pct,
            message: `Scanning page ${done} / ${total} pages (${pct}%)...`,
          });
        },
        shouldCancel: () => cancelExtractionRef.current,
      });

      if (result.cancelled) {
        setProgress({
          phase: 'cancelled',
          processedPages: result.pages.length,
          totalPages: result.totalPages,
          percentage: Math.round(
            (result.pages.length / Math.max(1, result.totalPages)) * 100
          ),
          message: `Processing cancelled at ${result.pages.length} / ${result.totalPages} pages.`,
        });
        setParsedPages(result.pages);
        return;
      }

      setParsedPages(result.pages);

      // Select all valid detected SKUs by default for convenience, or let user adjust
      const initialGroups = groupPagesBySku(result.pages, false);
      setSelectedSkus(new Set(initialGroups.map((g) => g.sku)));

      setProgress({
        phase: 'complete',
        processedPages: result.totalPages,
        totalPages: result.totalPages,
        percentage: 100,
        message: `Successfully analyzed ${result.totalPages} / ${result.totalPages} pages across ${initialGroups.length} unique SKUs.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to read the uploaded PDF file.';
      setErrorBanner(msg);
      setProgress({
        phase: 'error',
        processedPages: 0,
        totalPages: 0,
        percentage: 0,
        message: msg,
      });
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processPdfFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processPdfFile(file);
    }
  };

  const handleLoadSamplePreset = async (
    presetId: SamplePresetId,
    downloadRawOnly = false
  ) => {
    try {
      setLoadingSampleId(presetId);
      setErrorBanner(null);
      const { file, buffer } = await buildSampleMeeshoPdf(presetId);

      if (downloadRawOnly) {
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setLoadingSampleId(null);
        return;
      }

      await processPdfFile(file, buffer);
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Failed to generate sample Meesho PDF.'
      );
    } finally {
      setLoadingSampleId(null);
    }
  };

  const handleResetWorkspace = () => {
    cancelExtractionRef.current = true;
    if (generatedOutput?.blobUrl) {
      URL.revokeObjectURL(generatedOutput.blobUrl);
    }
    setUploadedFile(null);
    setSourceBuffer(null);
    setParsedPages([]);
    setSelectedSkus(new Set());
    setGeneratedOutput(null);
    setErrorBanner(null);
    setGenerationError(null);
    setSearchQuery('');
    setProgress({
      phase: 'idle',
      processedPages: 0,
      totalPages: 0,
      percentage: 0,
      message: '',
    });
  };

  // Selection handlers
  const handleToggleSku = (sku: string) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) {
        next.delete(sku);
      } else {
        next.add(sku);
      }
      return next;
    });
    setGeneratedOutput(null);
    setGenerationError(null);
  };

  const handleSelectAll = () => {
    setSelectedSkus(new Set(skuGroups.map((g) => g.sku)));
    setGeneratedOutput(null);
    setGenerationError(null);
  };

  const handleDeselectAll = () => {
    setSelectedSkus(new Set());
    setGeneratedOutput(null);
    setGenerationError(null);
  };

  const handleSelectOnlyFiltered = () => {
    setSelectedSkus(new Set(filteredAndSortedGroups.map((g) => g.sku)));
    setGeneratedOutput(null);
    setGenerationError(null);
  };

  const handleToggleAllVisible = () => {
    const allVisibleSelected =
      filteredAndSortedGroups.length > 0 &&
      filteredAndSortedGroups.every((g) => selectedSkus.has(g.sku));

    if (allVisibleSelected) {
      setSelectedSkus((prev) => {
        const next = new Set(prev);
        for (const g of filteredAndSortedGroups) {
          next.delete(g.sku);
        }
        return next;
      });
    } else {
      setSelectedSkus((prev) => {
        const next = new Set(prev);
        for (const g of filteredAndSortedGroups) {
          next.add(g.sku);
        }
        return next;
      });
    }
    setGeneratedOutput(null);
    setGenerationError(null);
  };

  // Manual page reassignment handlers
  const handleReassignPage = (
    pageNumber: number,
    newSku: string,
    newProductName?: string
  ) => {
    setParsedPages((prev) =>
      reassignPageToSku(prev, pageNumber, newSku, newProductName)
    );
    // Automatically select the target SKU so the user's manual fix is included
    setSelectedSkus((prev) => new Set(prev).add(newSku.trim()));
    setGeneratedOutput(null);
  };

  const handleResetPage = (pageNumber: number) => {
    setParsedPages((prev) => resetPageAssignment(prev, pageNumber));
    setGeneratedOutput(null);
  };

  // Sorting toggle handler
  const handleSortColumn = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection(col === 'pageCount' ? 'desc' : 'asc');
    }
  };

  // Generate Filtered PDF handler
  const handleGeneratePdf = async () => {
    setGenerationError(null);
    setGeneratedOutput(null);

    if (!sourceBuffer) {
      setGenerationError('No source PDF is loaded.');
      return;
    }

    if (selectedGroups.length === 0) {
      setGenerationError(
        'No products selected. Please check at least one SKU in the product table before clicking Generate PDF.'
      );
      return;
    }

    try {
      setGenProgress({
        isGenerating: true,
        processedItems: 0,
        totalItems: totalSelectedPages,
        percentage: 5,
        message: 'Preparing selected pages...',
      });

      const output = await generateFilteredPdfOutput({
        sourceBuffer,
        selectedGroups,
        outputMode,
        pageOrderMode,
        onProgress: (done, total, message) => {
          const pct = Math.min(
            99,
            Math.max(5, Math.round((done / Math.max(1, total)) * 100))
          );
          setGenProgress({
            isGenerating: true,
            processedItems: done,
            totalItems: total,
            percentage: pct,
            message,
          });
        },
      });

      setGenProgress({
        isGenerating: false,
        processedItems: output.pageCount,
        totalItems: output.pageCount,
        percentage: 100,
        message: `Generated ${output.filename} (${output.pageCount} pages).`,
      });
      setGeneratedOutput(output);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'An error occurred while generating the filtered PDF.';
      setGenerationError(msg);
      setGenProgress({
        isGenerating: false,
        processedItems: 0,
        totalItems: 0,
        percentage: 0,
        message: '',
      });
    }
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopySku = (sku: string) => {
    navigator.clipboard?.writeText(sku);
    setCopiedSku(sku);
    setTimeout(() => setCopiedSku(null), 1500);
  };

  const isExtracting =
    progress.phase === 'loading_document' ||
    progress.phase === 'extracting_pages';

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* TOP UTILITY HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  Meesho PDF Sorter
                </h1>
                <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700">
                  v2.4 Local Utility
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Sort shipping labels by SKU and product name • Preserves original barcodes, QR codes &amp; tax invoices
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 md:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>100% Local Browser Processing • Zero Server Upload</span>
            </div>

            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
              Windows &amp; Chrome Guide
            </button>

            {uploadedFile && (
              <button
                type="button"
                onClick={handleResetWorkspace}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove PDF / Upload Another
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN WORKSPACE CONTAINER */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 px-6 py-6 pb-28">
        {/* SECTION 1: PDF UPLOAD & PROCESSING PROGRESS */}
        <section aria-label="PDF Upload and Processing" className="space-y-4">
          {!uploadedFile || progress.phase === 'idle' ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left 7 Cols: Drag & Drop Upload Box */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={handleDrop}
                className={`lg:col-span-7 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition ${
                  isDraggingOver
                    ? 'border-indigo-600 bg-indigo-50/70'
                    : 'border-slate-300 bg-white hover:border-indigo-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                  <FileUp className="h-6 w-6" />
                </div>

                <h2 className="text-base font-semibold text-slate-900">
                  Drop your mixed Meesho shipping-label PDF here
                </h2>
                <p className="mt-1 max-w-md text-xs text-slate-500">
                  Accepts combined Meesho PDF files containing shipping labels and tax invoices. All pages are scanned locally in Google Chrome.
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 cursor-pointer"
                  >
                    <FileUp className="h-4 w-4" />
                    Select Meesho PDF File
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500">
                  <span>• Accepts .PDF files only</span>
                  <span>• Preserves vector barcodes &amp; QR codes</span>
                  <span>• Handles 200+ page batches smoothly</span>
                </div>
              </div>

              {/* Right 5 Cols: Built-in Sample Meesho PDF Generator for Instant Testing */}
              <div className="lg:col-span-5 flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-2xs">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-indigo-600 uppercase">
                      <Sparkles className="h-3.5 w-3.5" />
                      Instant Test Suite (Real Generated PDFs)
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                      No Hardcoded Data
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">
                    Don&apos;t have a Meesho PDF handy right now?
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Generate a real multi-page Meesho shipping label + tax invoice PDF in memory (complete with barcodes, QR codes, and SKUs) and run it through the full parser:
                  </p>

                  <div className="mt-3.5 space-y-2.5">
                    {SAMPLE_PRESETS.map((preset) => {
                      const isThisLoading = loadingSampleId === preset.id;
                      return (
                        <div
                          key={preset.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-2.5 hover:border-indigo-200 hover:bg-indigo-50/30"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold text-slate-900">
                                {preset.title}
                              </span>
                              <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-indigo-700">
                                {preset.badge}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">
                              {preset.subtitle}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              disabled={loadingSampleId !== null}
                              onClick={() =>
                                handleLoadSamplePreset(preset.id, false)
                              }
                              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                            >
                              {isThisLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FileCheck2 className="h-3.5 w-3.5" />
                              )}
                              Load &amp; Scan
                            </button>
                            <button
                              type="button"
                              disabled={loadingSampleId !== null}
                              onClick={() =>
                                handleLoadSamplePreset(preset.id, true)
                              }
                              title="Download raw sample PDF to disk"
                              className="inline-flex items-center rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 cursor-pointer"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Active File & Processing Progress Strip */
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {uploadedFile.name}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                        {formatBytes(uploadedFile.size)}
                      </span>
                      {progress.totalPages > 0 && (
                        <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700">
                          {progress.totalPages} Total Pages
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {progress.message}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
                    {progress.processedPages} / {progress.totalPages} pages (
                    {progress.percentage}%)
                  </span>

                  {isExtracting ? (
                    <button
                      type="button"
                      onClick={() => {
                        cancelExtractionRef.current = true;
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel Processing
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={handleFileInputChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Upload Another PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full transition-all duration-150 ${
                    progress.phase === 'error'
                      ? 'bg-red-600'
                      : progress.phase === 'cancelled'
                      ? 'bg-amber-500'
                      : progress.phase === 'complete'
                      ? 'bg-emerald-600'
                      : 'bg-indigo-600'
                  }`}
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Banner for corrupt, password-protected, or invalid PDFs */}
          {errorBanner && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-xs text-red-900"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div>
                  <h4 className="font-semibold text-red-950">
                    PDF Processing Error
                  </h4>
                  <p className="mt-0.5 text-red-800">{errorBanner}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="rounded px-2 py-1 font-medium text-red-700 hover:bg-red-100"
              >
                Dismiss
              </button>
            </div>
          )}
        </section>

        {/* SHOW WORKSPACE SECTIONS ONCE PAGES ARE EXTRACTED */}
        {parsedPages.length > 0 && (
          <>
            {/* SECTION 2: 4-COLUMN TELEMETRY SUMMARY CARDS */}
            <section
              aria-label="PDF Summary Telemetry"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {/* Card 1: Total Pages */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    Total Pages in PDF
                  </span>
                  <FileText className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                    {totalPages}
                  </span>
                  <span className="text-xs text-slate-500">
                    shipping labels
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Click any page badge below to preview original label
                </p>
              </div>

              {/* Card 2: Unique SKUs */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    Unique SKUs
                  </span>
                  <FolderKanban className="h-4 w-4 text-indigo-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-indigo-600 tabular-nums">
                    {
                      skuGroups.filter((g) => g.sku !== UNCLASSIFIED_SKU_KEY)
                        .length
                    }
                  </span>
                  <span className="text-xs text-slate-500">
                    distinct product groups
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Grouped strictly by exact extracted SKU code
                </p>
              </div>

              {/* Card 3: Classified Pages */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    Classified Pages
                  </span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-emerald-600 tabular-nums">
                    {classifiedPagesCount}
                  </span>
                  <span className="text-xs text-slate-500">
                    of {totalPages} pages (
                    {Math.round(
                      (classifiedPagesCount / Math.max(1, totalPages)) * 100
                    )}
                    %)
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Mapped to verified SKUs and ready for export
                </p>
              </div>

              {/* Card 4: Pages Requiring Review */}
              <div
                className={`rounded-lg border p-4 shadow-2xs ${
                  reviewRequiredCount > 0
                    ? 'border-amber-300 bg-amber-50/50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-slate-600 uppercase">
                    Pages Requiring Review
                  </span>
                  <AlertTriangle
                    className={`h-4 w-4 ${
                      reviewRequiredCount > 0
                        ? 'text-amber-600'
                        : 'text-slate-400'
                    }`}
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-mono text-2xl font-bold tabular-nums ${
                        reviewRequiredCount > 0
                          ? 'text-amber-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {reviewRequiredCount}
                    </span>
                    <span className="text-xs text-slate-600">
                      {reviewRequiredCount === 1 ? 'page' : 'pages'}
                    </span>
                  </div>
                  {reviewRequiredCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        reviewSectionRef.current?.scrollIntoView({
                          behavior: 'smooth',
                        })
                      }
                      className="text-xs font-semibold text-indigo-600 underline hover:text-indigo-800"
                    >
                      Review below &darr;
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {reviewRequiredCount > 0
                    ? 'Missing or ambiguous SKU — assign manually below'
                    : 'Zero unclassified pages detected'}
                </p>
              </div>
            </section>

            {/* SECTION 3: SEARCH, FILTER & PRODUCT SELECTION TABLE */}
            <section
              aria-label="Product Selection Table"
              className="rounded-lg border border-slate-200 bg-white shadow-2xs"
            >
              {/* Toolbar Header */}
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Detected Products &amp; SKU Groups
                    </h2>
                    <p className="text-xs text-slate-500">
                      Select one or more SKUs using the checkboxes below. Selection maps directly to the exact original PDF pages for each SKU.
                    </p>
                  </div>

                  {/* Quick Selection Counters & Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-mono text-xs font-semibold text-indigo-800 tabular-nums">
                      Selected: {selectedGroups.length} / {skuGroups.length}{' '}
                      SKUs ({totalSelectedPages} / {totalPages} pages)
                    </span>

                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <CheckSquare className="h-3.5 w-3.5 text-indigo-600" />
                      Select All ({skuGroups.length})
                    </button>

                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      disabled={selectedSkus.size === 0}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                    >
                      <Square className="h-3.5 w-3.5 text-slate-500" />
                      Deselect All
                    </button>

                    {searchQuery.trim() !== '' &&
                      filteredAndSortedGroups.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSelectOnlyFiltered}
                          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 cursor-pointer"
                        >
                          <Filter className="h-3.5 w-3.5" />
                          Select Only Search Matches (
                          {filteredAndSortedGroups.length})
                        </button>
                      )}
                  </div>
                </div>

                {/* Search Input + Filter Pills Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  {/* Search Input */}
                  <div className="relative min-w-[280px] flex-1 max-w-md">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by SKU (e.g. 181670964), product name, or page number..."
                      className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-8 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/15 focus:outline-none"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Segmented Filter Tabs */}
                  <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveFilterTab('all')}
                      className={`rounded px-2.5 py-1 font-medium transition ${
                        activeFilterTab === 'all'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All SKUs ({skuGroups.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilterTab('verified')}
                      className={`rounded px-2.5 py-1 font-medium transition ${
                        activeFilterTab === 'verified'
                          ? 'bg-white text-emerald-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Verified (
                      {
                        skuGroups.filter((g) => g.status === 'verified').length
                      }
                      )
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilterTab('name_variations')}
                      className={`rounded px-2.5 py-1 font-medium transition ${
                        activeFilterTab === 'name_variations'
                          ? 'bg-white text-amber-800 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Name Variations (
                      {skuGroups.filter((g) => g.hasNameVariation).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilterTab('review_required')}
                      className={`rounded px-2.5 py-1 font-medium transition ${
                        activeFilterTab === 'review_required'
                          ? 'bg-white text-amber-800 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Flagged / Missing Info (
                      {
                        skuGroups.filter(
                          (g) =>
                            g.status === 'missing_name' ||
                            g.status === 'unclassified' ||
                            g.hasNameVariation
                        ).length
                      }
                      )
                    </button>
                  </div>
                </div>
              </div>

              {/* Product Selection Data Table */}
              <div className="max-h-[540px] overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold tracking-wider text-slate-600 uppercase shadow-2xs">
                    <tr>
                      <th className="w-12 px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label="Select all visible SKUs"
                          checked={
                            filteredAndSortedGroups.length > 0 &&
                            filteredAndSortedGroups.every((g) =>
                              selectedSkus.has(g.sku)
                            )
                          }
                          onChange={handleToggleAllVisible}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </th>

                      <th className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('sku')}
                          className="inline-flex items-center gap-1 font-semibold uppercase hover:text-slate-900 cursor-pointer"
                        >
                          SKU
                          {sortColumn === 'sku' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-indigo-600" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </button>
                      </th>

                      <th className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('productName')}
                          className="inline-flex items-center gap-1 font-semibold uppercase hover:text-slate-900 cursor-pointer"
                        >
                          Product / Item Name
                          {sortColumn === 'productName' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-indigo-600" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </button>
                      </th>

                      <th className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('pageCount')}
                          className="inline-flex items-center justify-end gap-1 font-semibold uppercase hover:text-slate-900 cursor-pointer"
                        >
                          Pages
                          {sortColumn === 'pageCount' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-indigo-600" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </button>
                      </th>

                      <th className="px-4 py-3">Original Page Numbers</th>

                      <th className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('status')}
                          className="inline-flex items-center gap-1 font-semibold uppercase hover:text-slate-900 cursor-pointer"
                        >
                          Status
                          {sortColumn === 'status' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-indigo-600" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </button>
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {filteredAndSortedGroups.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-6 py-10 text-center text-sm text-slate-500"
                        >
                          No SKU groups match your current search or filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedGroups.map((group) => {
                        const isSelected = selectedSkus.has(group.sku);
                        const isExpandedPages = expandedPageLists.has(
                          group.sku
                        );
                        const isExpandedVar = expandedVariants.has(group.sku);
                        const maxPreviewPages = 10;
                        const visiblePages = isExpandedPages
                          ? group.pages
                          : group.pages.slice(0, maxPreviewPages);

                        return (
                          <tr
                            key={group.sku}
                            onClick={() => handleToggleSku(group.sku)}
                            className={`transition cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-50/60 hover:bg-indigo-50/90'
                                : 'bg-white hover:bg-slate-50'
                            }`}
                          >
                            {/* Checkbox cell */}
                            <td
                              className={`w-12 px-4 py-3.5 text-center ${
                                isSelected
                                  ? 'border-l-4 border-l-indigo-600'
                                  : ''
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSku(group.sku)}
                                aria-label={`Select SKU ${group.sku}`}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                            </td>

                            {/* Exact SKU Cell */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`inline-flex items-center rounded border px-2.5 py-1 font-mono text-[13px] font-semibold ${
                                    group.sku === UNCLASSIFIED_SKU_KEY
                                      ? 'border-red-300 bg-red-50 text-red-700'
                                      : isSelected
                                      ? 'border-indigo-300 bg-white text-indigo-950 shadow-2xs'
                                      : 'border-slate-300 bg-slate-100 text-slate-900'
                                  }`}
                                >
                                  {group.sku === UNCLASSIFIED_SKU_KEY
                                    ? 'SKU Not Detected'
                                    : group.sku}
                                </span>

                                {group.sku !== UNCLASSIFIED_SKU_KEY && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopySku(group.sku);
                                    }}
                                    title="Copy exact SKU"
                                    className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {copiedSku === group.sku && (
                                  <span className="text-[10px] font-medium text-emerald-600">
                                    Copied
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Product / Item Name Cell */}
                            <td className="max-w-md px-4 py-3.5">
                              <div className="font-medium text-slate-900 text-[13px] leading-snug">
                                {group.hasMissingName ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                                    Name Not Detected
                                  </span>
                                ) : (
                                  group.primaryProductName
                                )}
                              </div>

                              {/* Metadata Sub-row: Sizes, Couriers & Name Variations */}
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                {group.sizes.length > 0 && (
                                  <span>
                                    Size: <strong>{group.sizes.join(', ')}</strong>
                                  </span>
                                )}
                                {group.couriers.length > 0 && (
                                  <span>
                                    • Courier: {group.couriers.join(', ')}
                                  </span>
                                )}
                                {group.hasNameVariation && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedVariants((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(group.sku)) {
                                          next.delete(group.sku);
                                        } else {
                                          next.add(group.sku);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 hover:bg-amber-100"
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                                    {group.productNameVariants.length} Name Variations{' '}
                                    {isExpandedVar ? '▲' : '▼'}
                                  </button>
                                )}
                              </div>

                              {/* Expanded Name Variations List */}
                              {group.hasNameVariation && isExpandedVar && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-2 rounded border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-950"
                                >
                                  <div className="font-semibold mb-1">
                                    Product name variations grouped under SKU{' '}
                                    <code className="font-mono">{group.sku}</code>:
                                  </div>
                                  <ul className="list-disc pl-4 space-y-0.5">
                                    {group.productNameVariants.map((v, i) => (
                                      <li key={i}>{v}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </td>

                            {/* Matching Page Count Cell */}
                            <td className="whitespace-nowrap px-4 py-3.5 text-right">
                              <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                                {group.pages.length}
                              </span>
                              <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                                Qty: {group.totalQty}
                              </div>
                            </td>

                            {/* Original Page Numbers Cell */}
                            <td
                              className="max-w-xs px-4 py-3.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex flex-wrap items-center gap-1">
                                {visiblePages.map((pageNum) => (
                                  <button
                                    key={pageNum}
                                    type="button"
                                    onClick={() =>
                                      setInspectedPageNumber(pageNum)
                                    }
                                    title={`Click to inspect original PDF page ${pageNum}`}
                                    className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700 hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer"
                                  >
                                    p.{pageNum}
                                  </button>
                                ))}

                                {group.pages.length > maxPreviewPages && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedPageLists((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(group.sku)) {
                                          next.delete(group.sku);
                                        } else {
                                          next.add(group.sku);
                                        }
                                        return next;
                                      })
                                    }
                                    className="inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                                  >
                                    {isExpandedPages
                                      ? 'Show less'
                                      : `+${
                                          group.pages.length - maxPreviewPages
                                        } more`}
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Processing Status Cell */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <div className="flex items-center justify-between gap-2">
                                {group.status === 'verified' && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Verified
                                  </span>
                                )}
                                {group.status === 'name_variation' && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                                    <AlertTriangle className="h-3 w-3" />
                                    Name Variation
                                  </span>
                                )}
                                {group.status === 'missing_name' && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                                    <HelpCircle className="h-3 w-3" />
                                    Name Not Detected
                                  </span>
                                )}
                                {group.status === 'manual_group' && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Manual Assignment
                                  </span>
                                )}
                                {group.status === 'unclassified' && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
                                    <AlertTriangle className="h-3 w-3" />
                                    SKU Not Detected
                                  </span>
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInspectedPageNumber(group.pages[0]);
                                  }}
                                  title="Preview first label of this SKU"
                                  className="rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* SECTION 4: REVIEW REQUIRED (UNCLASSIFIED & FLAGGED PAGES) */}
            <div ref={reviewSectionRef}>
              <ReviewRequiredSection
                pages={parsedPages}
                existingGroups={skuGroups}
                includeUnclassifiedAsGroup={includeUnclassifiedAsGroup}
                onToggleIncludeUnclassifiedGroup={(inc) => {
                  setIncludeUnclassifiedAsGroup(inc);
                  if (inc) {
                    setSelectedSkus((prev) =>
                      new Set(prev).add(UNCLASSIFIED_SKU_KEY)
                    );
                  } else {
                    setSelectedSkus((prev) => {
                      const next = new Set(prev);
                      next.delete(UNCLASSIFIED_SKU_KEY);
                      return next;
                    });
                  }
                }}
                onInspectPage={(pageNum) => setInspectedPageNumber(pageNum)}
                onReassignPage={handleReassignPage}
                onResetPage={handleResetPage}
              />
            </div>

            {/* SECTION 5: DOWNLOAD RESULT PANEL (WHEN GENERATED) */}
            {generatedOutput && (
              <section
                aria-label="Generated PDF Result"
                className="rounded-lg border-2 border-emerald-500 bg-emerald-50/50 p-5 shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                      <PackageCheck className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-emerald-950">
                          Filtered Output Ready for Download
                        </h3>
                        <span className="rounded-full bg-emerald-200/80 px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-900">
                          {generatedOutput.pageCount} Pages Verified
                        </span>
                        <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-xs font-medium text-slate-700">
                          {formatBytes(generatedOutput.sizeBytes)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-emerald-900">
                        Filename:{' '}
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-slate-900">
                          {generatedOutput.filename}
                        </code>{' '}
                        • Includes {generatedOutput.skuCount} selected{' '}
                        {generatedOutput.skuCount === 1 ? 'SKU' : 'SKUs'} •
                        Original barcodes, QR codes, and page dimensions preserved.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {generatedOutput.mode === 'combined_pdf' && (
                      <a
                        href={generatedOutput.blobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open PDF in Chrome Tab
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        triggerDownload(
                          generatedOutput.blobUrl,
                          generatedOutput.filename
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      Download{' '}
                      {generatedOutput.mode === 'separate_zip'
                        ? 'ZIP Archive (.zip)'
                        : 'Filtered PDF (.pdf)'}
                    </button>
                  </div>
                </div>

                {/* If Mode B (Separate PDFs by SKU), also list individual SKU PDF download buttons */}
                {generatedOutput.individualFiles &&
                  generatedOutput.individualFiles.length > 0 && (
                    <div className="mt-4 border-t border-emerald-200 pt-3.5">
                      <h4 className="mb-2 text-xs font-semibold text-emerald-950">
                        Individual SKU PDFs inside this batch (Click any file to download separately):
                      </h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {generatedOutput.individualFiles.map((item) => (
                          <div
                            key={item.filename}
                            className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-white px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono font-semibold text-slate-900">
                                {item.sku} ({item.pageCount}p)
                              </div>
                              <div className="truncate text-[11px] text-slate-500">
                                {item.filename}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <a
                                href={item.blobUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open in new tab"
                                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  triggerDownload(item.blobUrl, item.filename)
                                }
                                title="Download this SKU PDF"
                                className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100"
                              >
                                Download
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </section>
            )}

            {/* Generation Error Alert */}
            {generationError && (
              <div
                role="alert"
                className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-900"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="font-medium">{generationError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setGenerationError(null)}
                  className="font-semibold text-red-700 hover:underline"
                >
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* STICKY BOTTOM EXPORT & GENERATION COMMAND BAR */}
      {parsedPages.length > 0 && (
        <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-slate-300 bg-white/95 shadow-lg backdrop-blur-xs">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-3">
            {/* Left: Selection Summary */}
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Export Selection Summary
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {selectedGroups.length} SKUs Selected
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="font-mono text-sm font-bold text-indigo-600 tabular-nums">
                    {totalSelectedPages} of {totalPages} Pages Included
                  </span>
                </div>
              </div>
            </div>

            {/* Center: Output Mode (Mode A vs Mode B) & Page Ordering */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Output Mode Selector */}
              <div className="flex items-center rounded-md border border-slate-300 bg-slate-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setOutputMode('combined_pdf');
                    setGeneratedOutput(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition cursor-pointer ${
                    outputMode === 'combined_pdf'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-indigo-600" />
                  Mode A: One Combined PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOutputMode('separate_zip');
                    setGeneratedOutput(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition cursor-pointer ${
                    outputMode === 'separate_zip'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileArchive className="h-3.5 w-3.5 text-indigo-600" />
                  Mode B: Separate PDFs by SKU (.zip)
                </button>
              </div>

              {/* Page Ordering Option (Mode A) */}
              {outputMode === 'combined_pdf' && (
                <div className="flex items-center gap-1.5 text-xs">
                  <label
                    htmlFor="pageOrderSelect"
                    className="font-medium text-slate-600"
                  >
                    Page Order:
                  </label>
                  <select
                    id="pageOrderSelect"
                    value={pageOrderMode}
                    onChange={(e) => {
                      setPageOrderMode(e.target.value as PageOrderMode);
                      setGeneratedOutput(null);
                    }}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-600 focus:outline-none"
                  >
                    <option value="original_order">
                      Preserve Original Page Order (Default)
                    </option>
                    <option value="group_by_sku">
                      Group Output Pages by SKU
                    </option>
                  </select>
                </div>
              )}

              {/* Primary Generate PDF Button */}
              <button
                type="button"
                onClick={handleGeneratePdf}
                disabled={genProgress.isGenerating || selectedGroups.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 cursor-pointer"
              >
                {genProgress.isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {genProgress.message} ({genProgress.percentage}%)
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Generate PDF ({totalSelectedPages}{' '}
                    {totalSelectedPages === 1 ? 'Page' : 'Pages'})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAGE INSPECTOR MODAL (VISUAL LABEL PREVIEW & MANUAL OVERRIDE) */}
      <PageInspectorModal
        isOpen={inspectedPageNumber !== null}
        page={inspectedPage}
        totalPages={totalPages}
        sourceBuffer={sourceBuffer}
        existingGroups={skuGroups}
        onClose={() => setInspectedPageNumber(null)}
        onNavigatePage={(newPageNum) => setInspectedPageNumber(newPageNum)}
        onReassignPage={handleReassignPage}
        onResetPage={handleResetPage}
      />

      {/* WINDOWS & CHROME SETUP GUIDE MODAL */}
      <WindowsInstructionsModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
}

export default App;
