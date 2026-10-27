import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  RotateCcw,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ParsedPdfPage,
  SkuGroup,
  UNCLASSIFIED_SKU_KEY,
} from '../types/pdfSorter';
import { renderPdfPageToCanvas } from '../services/pdfExtractor';

interface PageInspectorModalProps {
  isOpen: boolean;
  page: ParsedPdfPage | null;
  totalPages: number;
  sourceBuffer: ArrayBuffer | null;
  existingGroups: SkuGroup[];
  onClose: () => void;
  onNavigatePage: (pageNumber: number) => void;
  onReassignPage: (
    pageNumber: number,
    newSku: string,
    newProductName?: string
  ) => void;
  onResetPage: (pageNumber: number) => void;
}

export const PageInspectorModal: React.FC<PageInspectorModalProps> = ({
  isOpen,
  page,
  totalPages,
  sourceBuffer,
  existingGroups,
  onClose,
  onNavigatePage,
  onReassignPage,
  onResetPage,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState<number>(1.15);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [selectedExistingSku, setSelectedExistingSku] = useState<string>('');
  const [customSkuInput, setCustomSkuInput] = useState<string>('');
  const [customNameInput, setCustomNameInput] = useState<string>('');
  const [assignSuccessMsg, setAssignSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!page) return;
    setAssignSuccessMsg(null);
    const currentSku =
      page.effectiveSku === UNCLASSIFIED_SKU_KEY ? '' : page.effectiveSku;
    setCustomSkuInput(currentSku);
    setCustomNameInput(
      page.effectiveProductName === 'Name Not Detected'
        ? ''
        : page.effectiveProductName
    );
    setSelectedExistingSku('');
  }, [page]);

  useEffect(() => {
    if (!isOpen || !page || !sourceBuffer || !canvasRef.current) return;
    let cancelled = false;
    setIsRendering(true);
    setRenderError(null);

    renderPdfPageToCanvas(sourceBuffer, page.pageNumber, canvasRef.current, scale)
      .then(() => {
        if (!cancelled) setIsRendering(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setIsRendering(false);
          setRenderError(
            err instanceof Error ? err.message : 'Failed to render page preview.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, page, sourceBuffer, scale]);

  if (!isOpen || !page) return null;

  const validExistingGroups = existingGroups.filter(
    (g) => g.sku !== UNCLASSIFIED_SKU_KEY
  );

  const handleApplyExistingSku = () => {
    if (!selectedExistingSku) return;
    const targetGroup = validExistingGroups.find(
      (g) => g.sku === selectedExistingSku
    );
    onReassignPage(
      page.pageNumber,
      selectedExistingSku,
      targetGroup?.primaryProductName
    );
    setAssignSuccessMsg(`Page ${page.pageNumber} assigned to SKU "${selectedExistingSku}".`);
  };

  const handleApplyCustomSku = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSku = customSkuInput.trim();
    if (!trimmedSku) return;
    onReassignPage(
      page.pageNumber,
      trimmedSku,
      customNameInput.trim() || undefined
    );
    setAssignSuccessMsg(`Page ${page.pageNumber} assigned to SKU "${trimmedSku}".`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 font-mono text-xs font-semibold text-white">
              <FileText className="h-3.5 w-3.5" />
              Page {page.pageNumber} of {totalPages}
            </span>
            <h3 className="text-base font-semibold text-slate-900">
              Original Label &amp; Invoice Inspector
            </h3>
            {page.effectiveSku === UNCLASSIFIED_SKU_KEY ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                SKU Not Detected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                SKU: {page.effectiveSku}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigatePage(Math.max(1, page.pageNumber - 1))}
              disabled={page.pageNumber <= 1}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev Page
            </button>
            <button
              type="button"
              onClick={() =>
                onNavigatePage(Math.min(totalPages, page.pageNumber + 1))
              }
              disabled={page.pageNumber >= totalPages}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Next Page
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <div className="mx-1 h-4 w-px bg-slate-300" />
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200/60 hover:text-slate-800"
              aria-label="Close inspector"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Left Canvas Preview + Right Metadata & Manual Correction */}
        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* Left 7 Cols: Visual PDF Page Canvas */}
          <div className="flex flex-col border-b border-slate-200 bg-slate-100 lg:col-span-7 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
              <span>
                Original PDF Page Preview (Barcodes, QR &amp; Layout Preserved)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.max(0.75, +(s - 0.2).toFixed(2)))}
                  className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-1 hover:bg-slate-100"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="font-mono text-xs font-medium text-slate-700">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.min(2.0, +(s + 0.2).toFixed(2)))}
                  className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-1 hover:bg-slate-100"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="relative flex flex-1 items-start justify-center overflow-auto p-4 max-h-[70vh]">
              {isRendering && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/10">
                  <div className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow">
                    Rendering page {page.pageNumber}...
                  </div>
                </div>
              )}
              {renderError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                  {renderError}
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="rounded border border-slate-300 bg-white shadow-md"
                />
              )}
            </div>
          </div>

          {/* Right 5 Cols: Extracted Details & Manual SKU Assignment */}
          <div className="flex flex-col gap-4 overflow-y-auto p-5 max-h-[76vh] lg:col-span-5">
            {/* Extracted Fields Summary Card */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Detected Page Metadata
              </h4>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div className="col-span-2">
                  <dt className="text-slate-500">Assigned / Effective SKU</dt>
                  <dd className="mt-0.5 font-mono text-sm font-bold text-slate-900">
                    {page.effectiveSku === UNCLASSIFIED_SKU_KEY
                      ? 'SKU Not Detected'
                      : page.effectiveSku}
                    {page.isManuallyAssigned && (
                      <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 font-sans text-[11px] font-medium text-indigo-700">
                        Manual Override
                      </span>
                    )}
                  </dd>
                </div>

                <div className="col-span-2">
                  <dt className="text-slate-500">Product / Item Name</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">
                    {page.effectiveProductName}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Order / Sub-Order ID</dt>
                  <dd className="mt-0.5 font-mono text-slate-800">
                    {page.orderId || '—'}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Size / Qty</dt>
                  <dd className="mt-0.5 font-mono text-slate-800">
                    {page.size || '—'} / Qty: {page.qty}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Courier Partner</dt>
                  <dd className="mt-0.5 text-slate-800">{page.courier || '—'}</dd>
                </div>

                <div>
                  <dt className="text-slate-500">HSN Code</dt>
                  <dd className="mt-0.5 font-mono text-slate-800">
                    {page.hsn || '—'}
                  </dd>
                </div>

                <div className="col-span-2">
                  <dt className="text-slate-500">Detection Source</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {page.extractionMethod}
                  </dd>
                </div>
              </dl>

              {page.reviewReason && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  <span className="font-semibold">Note: </span>
                  {page.reviewReason}
                </div>
              )}
            </div>

            {/* Manual SKU Assignment Card */}
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-indigo-950 uppercase">
                  <Tag className="h-3.5 w-3.5 text-indigo-600" />
                  Manual SKU Assignment / Correction
                </h4>
                {page.isManuallyAssigned && (
                  <button
                    type="button"
                    onClick={() => {
                      onResetPage(page.pageNumber);
                      setAssignSuccessMsg('Reset to original auto-detection.');
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                )}
              </div>

              {/* Option 1: Pick from existing detected SKUs */}
              {validExistingGroups.length > 0 && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Assign to an Existing SKU in this PDF:
                  </label>
                  <div className="mt-1 flex gap-2">
                    <select
                      value={selectedExistingSku}
                      onChange={(e) => setSelectedExistingSku(e.target.value)}
                      className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-600 focus:outline-none"
                    >
                      <option value="">-- Select existing SKU --</option>
                      {validExistingGroups.map((g) => (
                        <option key={g.sku} value={g.sku}>
                          {g.sku} — {g.primaryProductName.slice(0, 38)} ({g.pages.length}p)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyExistingSku}
                      disabled={!selectedExistingSku}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      Assign
                    </button>
                  </div>
                </div>
              )}

              {/* Option 2: Custom SKU & Product Name */}
              <form onSubmit={handleApplyCustomSku} className="space-y-2.5 border-t border-indigo-100 pt-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Or Enter Custom / New SKU:
                  </label>
                  <input
                    type="text"
                    value={customSkuInput}
                    onChange={(e) => setCustomSkuInput(e.target.value)}
                    placeholder="e.g. 181670964 or MSH_SKU_01"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Product Name (Optional override):
                  </label>
                  <input
                    type="text"
                    value={customNameInput}
                    onChange={(e) => setCustomNameInput(e.target.value)}
                    placeholder="e.g. 12inch Black 100pcs Premium Quality Cable tie"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!customSkuInput.trim()}
                  className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  Save SKU Assignment for Page {page.pageNumber}
                </button>
              </form>

              {assignSuccessMsg && (
                <div className="mt-2.5 flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  {assignSuccessMsg}
                </div>
              )}
            </div>

            {/* Extracted Raw Text Lines */}
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Extracted Text Lines ({page.lines.length} lines)
              </h4>
              <div className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700">
                {page.lines.length === 0 ? (
                  <span className="text-slate-400 italic">
                    No text tokens extracted on this page.
                  </span>
                ) : (
                  page.lines.map((line, idx) => (
                    <div key={idx} className="border-b border-slate-100 py-0.5 last:border-0">
                      <span className="mr-2 select-none text-slate-400">
                        {String(idx + 1).padStart(2, '0')}:
                      </span>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
