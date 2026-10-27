import React from 'react';
import {
  CheckCircle2,
  FileCheck,
  HardDrive,
  Monitor,
  ShieldCheck,
  X,
} from 'lucide-react';

interface WindowsInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WindowsInstructionsModal: React.FC<
  WindowsInstructionsModalProps
> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Monitor className="h-5 w-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Running Meesho PDF Sorter Locally on Windows (Google Chrome)
              </h3>
              <p className="text-xs text-slate-500">
                100% Client-Side Browser Execution — Zero External Servers or Paid APIs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200/60 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5 overflow-y-auto p-6 text-xs leading-relaxed text-slate-700">
          {/* Privacy & Offline Architecture Box */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <h4 className="text-sm font-semibold text-emerald-950">
                  Local-Only PDF Processing Guarantee
                </h4>
                <p className="mt-1 text-emerald-900">
                  All PDF text extraction (via bundled <code>PDF.js</code>) and page copying (via bundled <code>pdf-lib</code> and <code>JSZip</code>) run directly inside your local Google Chrome browser memory. Your Meesho shipping labels, customer addresses, and tax invoices are never uploaded to any remote server.
                </p>
              </div>
            </div>
          </div>

          {/* Step-by-Step Windows Instructions */}
          <div>
            <h4 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <HardDrive className="h-4 w-4 text-indigo-600" />
              How to Open &amp; Use on a Windows PC
            </h4>
            <ol className="list-decimal space-y-2 pl-5 text-slate-700">
              <li>
                <strong>Option A — Self-Contained Single-File Build (<code>dist/index.html</code>):</strong>{' '}
                Double-click <code>dist/index.html</code> (or right-click &rarr; <em>Open with &rarr; Google Chrome</em>). Because all JavaScript and CSS libraries (<code>PDF.js</code>, <code>pdf-lib</code>, <code>JSZip</code>) are compiled directly into the bundle, it runs immediately in Chrome without needing any internet connection or background server.
              </li>
              <li>
                <strong>Option B — Local Development / Preview Server:</strong>{' '}
                If running from the source folder with Node.js installed on Windows, open Command Prompt or PowerShell in the project folder, run <code>npm install</code> followed by <code>npm run dev</code>, and open the displayed localhost URL in Google Chrome.
              </li>
              <li>
                <strong>Upload Your Meesho Label PDF:</strong>{' '}
                Download your mixed shipping label PDF from the <em>Meesho Supplier Panel &rarr; Orders &rarr; Ready to Ship &rarr; Download Labels</em>, then drag and drop the PDF into the upload box.
              </li>
              <li>
                <strong>Filter &amp; Select SKUs:</strong>{' '}
                Review the automatically grouped SKU table. Use the search box to find specific SKUs or product names, inspect any flagged pages under <strong>Review Required</strong>, and check the boxes for the SKUs you want to print.
              </li>
              <li>
                <strong>Generate &amp; Download:</strong>{' '}
                Choose <strong>Mode A (One Combined PDF)</strong> or <strong>Mode B (Separate PDFs by SKU in ZIP)</strong>, select whether to preserve original page order or group pages by SKU, and click <strong>Generate PDF</strong>.
              </li>
            </ol>
          </div>

          {/* How Original Labels, Barcodes & QR Codes Are Preserved */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileCheck className="h-4 w-4 text-indigo-600" />
              How Barcodes, QR Codes &amp; Tax Invoices Are Preserved
            </h4>
            <p>
              This tool <strong>never</strong> reconstructs or re-types shipping labels from extracted text. Instead, it uses <code>pdf-lib</code>&apos;s <code>copyPages()</code> API to clone the exact binary PDF page objects from your original Meesho PDF into the new PDF. Every vector barcode, 2D QR code, font glyph, customer address, and tax invoice table remains 100% identical to the source document.
            </p>
          </div>

          {/* 12-Point Verification Summary */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">
              Built-in Support for All 12 Meesho Seller Scenarios
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                'Multiple SKUs in one combined PDF',
                'Same SKU appearing across dozens of pages',
                'Different SKUs with identical product names kept separate',
                'SKUs with underscores (_) and hyphens (-) preserved',
                'Missing/unreadable SKU pages caught in Review Required',
                'Large PDFs (200+ pages) processed without UI freezing',
                'Single-SKU and Multi-SKU selection modes',
                'Original page order vs. Group-by-SKU output order',
                'Lossless vector barcode & QR code preservation',
                'Click any page number to inspect visual PDF rendering',
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Got It, Return to Sorter
          </button>
        </div>
      </div>
    </div>
  );
};
