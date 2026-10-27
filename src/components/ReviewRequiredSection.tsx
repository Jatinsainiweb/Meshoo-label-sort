import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FolderPlus,
  RotateCcw,
  Tag,
} from 'lucide-react';
import {
  ParsedPdfPage,
  SkuGroup,
  UNCLASSIFIED_SKU_KEY,
} from '../types/pdfSorter';

interface ReviewRequiredSectionProps {
  pages: ParsedPdfPage[];
  existingGroups: SkuGroup[];
  includeUnclassifiedAsGroup: boolean;
  onToggleIncludeUnclassifiedGroup: (include: boolean) => void;
  onInspectPage: (pageNumber: number) => void;
  onReassignPage: (
    pageNumber: number,
    newSku: string,
    newProductName?: string
  ) => void;
  onResetPage: (pageNumber: number) => void;
}

export const ReviewRequiredSection: React.FC<ReviewRequiredSectionProps> = ({
  pages,
  existingGroups,
  includeUnclassifiedAsGroup,
  onToggleIncludeUnclassifiedGroup,
  onInspectPage,
  onReassignPage,
  onResetPage,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [inlineSkuSelection, setInlineSkuSelection] = useState<
    Record<number, string>
  >({});
  const [inlineCustomSku, setInlineCustomSku] = useState<
    Record<number, string>
  >({});

  // Pages that currently need attention or were manually resolved from review
  const reviewPages = pages.filter(
    (p) =>
      p.effectiveSku === UNCLASSIFIED_SKU_KEY ||
      p.status === 'review_required' ||
      p.effectiveProductName === 'Name Not Detected' ||
      p.isManuallyAssigned
  );

  const unresolvedCount = pages.filter(
    (p) =>
      p.effectiveSku === UNCLASSIFIED_SKU_KEY || p.status === 'review_required'
  ).length;

  const validExistingGroups = existingGroups.filter(
    (g) => g.sku !== UNCLASSIFIED_SKU_KEY
  );

  if (reviewPages.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-5 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <h3 className="text-sm font-semibold text-emerald-950">
                Review Required (0 Pages) — All Pages Classified Confidently
              </h3>
              <p className="text-xs text-emerald-800">
                Every page in this PDF has a verified SKU and product name. No manual corrections are needed.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Review Required"
      className={`rounded-lg border ${
        unresolvedCount > 0
          ? 'border-amber-300 bg-amber-50/40'
          : 'border-slate-200 bg-white'
      } shadow-xs overflow-hidden`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50/80 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <AlertTriangle
            className={`h-5 w-5 shrink-0 ${
              unresolvedCount > 0 ? 'text-amber-600' : 'text-emerald-600'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Review Required
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold ${
                  unresolvedCount > 0
                    ? 'bg-amber-200/80 text-amber-950'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {unresolvedCount} Unresolved / {reviewPages.length} Total Flagged
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Pages with missing or uncertain SKU/Product information are never silently discarded. Inspect and assign them below before generating your PDF.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {pages.some((p) => p.effectiveSku === UNCLASSIFIED_SKU_KEY) && (
            <button
              type="button"
              onClick={() =>
                onToggleIncludeUnclassifiedGroup(!includeUnclassifiedAsGroup)
              }
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                includeUnclassifiedAsGroup
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {includeUnclassifiedAsGroup
                ? 'Unclassified Group Added to Table'
                : 'List Unclassified as Separate Group'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {isExpanded ? (
              <>
                Hide Details <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Show Details ({reviewPages.length}){' '}
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expandable Table of Review Required Pages */}
      {isExpanded && (
        <div className="overflow-x-auto bg-white">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
                <th className="px-4 py-2.5">Original Page</th>
                <th className="px-4 py-2.5">Detected SKU</th>
                <th className="px-4 py-2.5">Detected Product Name</th>
                <th className="px-4 py-2.5">Reason Flagged</th>
                <th className="px-4 py-2.5">Manual SKU Assignment</th>
                <th className="px-4 py-2.5 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {reviewPages.map((p) => {
                const isUnclassified = p.effectiveSku === UNCLASSIFIED_SKU_KEY;
                const selectedVal = inlineSkuSelection[p.pageNumber] || '';
                const customVal = inlineCustomSku[p.pageNumber] || '';

                return (
                  <tr
                    key={p.pageNumber}
                    className={`transition ${
                      isUnclassified
                        ? 'bg-red-50/25 hover:bg-red-50/50'
                        : p.isManuallyAssigned
                        ? 'bg-indigo-50/20 hover:bg-indigo-50/40'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Original Page Number */}
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-slate-900">
                      <button
                        type="button"
                        onClick={() => onInspectPage(p.pageNumber)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800 hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700"
                        title="Click to inspect original PDF page"
                      >
                        Page {p.pageNumber}
                      </button>
                      {p.orderId && (
                        <div className="mt-1 font-mono text-[11px] font-normal text-slate-500">
                          Order: {p.orderId}
                        </div>
                      )}
                    </td>

                    {/* Detected / Effective SKU */}
                    <td className="whitespace-nowrap px-4 py-3">
                      {isUnclassified ? (
                        <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-xs font-semibold text-red-700">
                          SKU Not Detected
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex w-fit items-center gap-1 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-900">
                            {p.effectiveSku}
                          </span>
                          {p.isManuallyAssigned && (
                            <span className="text-[11px] font-medium text-indigo-600">
                              ✓ Manually assigned
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Detected Product Name */}
                    <td className="max-w-xs px-4 py-3 text-slate-800">
                      {p.effectiveProductName === 'Name Not Detected' ? (
                        <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          Name Not Detected
                        </span>
                      ) : (
                        <span className="line-clamp-2 font-medium">
                          {p.effectiveProductName}
                        </span>
                      )}
                    </td>

                    {/* Reason Flagged */}
                    <td className="max-w-xs px-4 py-3 text-slate-600">
                      {p.reviewReason || 'Flagged for verification'}
                    </td>

                    {/* Inline Manual Assignment Controls */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {validExistingGroups.length > 0 && (
                          <div className="flex items-center gap-1">
                            <select
                              aria-label={`Assign page ${p.pageNumber} to existing SKU`}
                              value={selectedVal}
                              onChange={(e) =>
                                setInlineSkuSelection((prev) => ({
                                  ...prev,
                                  [p.pageNumber]: e.target.value,
                                }))
                              }
                              className="w-40 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800 focus:border-indigo-600 focus:outline-none"
                            >
                              <option value="">Existing SKU...</option>
                              {validExistingGroups.map((g) => (
                                <option key={g.sku} value={g.sku}>
                                  {g.sku} ({g.pages.length}p)
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!selectedVal}
                              onClick={() => {
                                if (!selectedVal) return;
                                const matchGroup = validExistingGroups.find(
                                  (g) => g.sku === selectedVal
                                );
                                onReassignPage(
                                  p.pageNumber,
                                  selectedVal,
                                  matchGroup?.primaryProductName
                                );
                              }}
                              className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              Assign
                            </button>
                          </div>
                        )}

                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="Or custom SKU..."
                            value={customVal}
                            onChange={(e) =>
                              setInlineCustomSku((prev) => ({
                                ...prev,
                                [p.pageNumber]: e.target.value,
                              }))
                            }
                            className="w-32 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800 focus:border-indigo-600 focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={!customVal.trim()}
                            onClick={() => {
                              const trimmed = customVal.trim();
                              if (!trimmed) return;
                              onReassignPage(p.pageNumber, trimmed);
                              setInlineCustomSku((prev) => ({
                                ...prev,
                                [p.pageNumber]: '',
                              }));
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-40"
                          >
                            <Tag className="h-3 w-3" />
                            Set SKU
                          </button>
                        </div>

                        {p.isManuallyAssigned && (
                          <button
                            type="button"
                            onClick={() => onResetPage(p.pageNumber)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-200"
                            title="Reset manual SKU override"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Undo
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Inspect Page Button */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onInspectPage(p.pageNumber)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Inspect Label
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
