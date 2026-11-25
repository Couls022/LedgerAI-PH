import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown, Check, FileArchive, FileCode2, Loader2 } from 'lucide-react';
import { exportToCSV, exportToPDF } from '../utils/exportUtils';
import { apiFetch } from '../utils/api';

export interface ExportData {
  filename: string;
  title: string;
  subtitle?: string;
  companyName?: string;
  reportPeriod?: string;
  accountingBasis?: string;
  currency?: string;
  appliedFilters?: Record<string, any> | string;
  sourceTransactionReferences?: string[] | string;
  headers: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  orientation?: 'portrait' | 'landscape';
  columnStyles?: { [key: number]: { halign?: 'left' | 'center' | 'right'; cellWidth?: number | 'auto' } };
}

interface ExportButtonProps {
  data: ExportData;
  className?: string;
  disabled?: boolean;
}

export default function ExportButton({ data, className = '', disabled = false }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastExported, setLastExported] = useState<'xlsx' | 'csv' | 'pdf' | 'docx' | 'zip' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerServerExport = async (format: 'xlsx' | 'csv' | 'pdf' | 'docx' | 'zip') => {
    setIsOpen(false);
    setIsExporting(true);
    let wasForbiddenOrUnauthorized = false;
    try {
      const response = await apiFetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          filename: data.filename,
          reportTitle: data.title,
          subtitle: data.subtitle,
          reportPeriod: data.reportPeriod || `As of ${new Date().toISOString().slice(0, 10)}`,
          accountingBasis: data.accountingBasis || 'ACCRUAL (PFRS / BIR CAS)',
          currency: data.currency || 'PHP (₱)',
          appliedFilters: data.appliedFilters,
          sourceTransactionReferences: data.sourceTransactionReferences,
          headers: data.headers,
          rows: data.rows,
          totals: data.totals,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          wasForbiddenOrUnauthorized = true;
        }
        throw new Error(`Server export failed (${response.status})`);
      }

      const blob = await response.blob();
      const extMap: Record<string, string> = {
        xlsx: '.xlsx',
        csv: '.csv',
        pdf: '.pdf',
        docx: '_CPA_Memorandum.docx',
        zip: '_Audit_Evidence_Package.zip',
      };
      const cleanBase = data.filename.replace(/\.(csv|pdf|xlsx|docx|zip)$/i, '');
      const downloadName = `${cleanBase}${extMap[format] || `.${format}`}`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', downloadName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setLastExported(format);
      setTimeout(() => setLastExported(null), 3000);
    } catch (err: any) {
      if (wasForbiddenOrUnauthorized || err?.status === 401 || err?.status === 403) {
        console.warn('Export blocked by RBAC authorization policy.');
        return;
      }
      // Fallback to client-side generator only on network/offline error
      if (format === 'csv') {
        exportToCSV(data.filename, data.headers, data.rows);
        setLastExported('csv');
        setTimeout(() => setLastExported(null), 3000);
      } else if (format === 'pdf') {
        exportToPDF({
          filename: data.filename,
          title: data.title,
          subtitle: data.subtitle,
          companyName: data.companyName,
          headers: data.headers,
          rows: data.rows,
          totals: data.totals,
          orientation: data.orientation || 'portrait',
          columnStyles: data.columnStyles,
        });
        setLastExported('pdf');
        setTimeout(() => setLastExported(null), 3000);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled || isExporting || data.rows.length === 0}
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-2 border ${
          disabled || data.rows.length === 0
            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600 dark:border-slate-700'
            : lastExported
            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700'
        }`}
      >
        {isExporting ? (
          <>
            <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
            <span>Generating...</span>
          </>
        ) : lastExported ? (
          <>
            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Exported {lastExported.toUpperCase()}</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Export Matrix</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </>
        )}
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-60 rounded-xl shadow-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ring-1 ring-black/5 z-50 divide-y divide-slate-100 dark:divide-slate-700/60">
          <div className="px-3.5 py-2 bg-slate-50/80 dark:bg-slate-900/50 rounded-t-xl">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              CPA & Audit Reproducible Exports
            </div>
          </div>
          <div className="py-1">
            <button
              onClick={() => triggerServerExport('xlsx')}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <div>Export as Excel (.xlsx)</div>
                <div className="text-[10px] text-slate-400 font-normal">QuickBooks & Excel workbook + Audit sheet</div>
              </div>
            </button>
            <button
              onClick={() => triggerServerExport('csv')}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileCode2 className="w-4 h-4 text-teal-600 shrink-0" />
              <div>
                <div>Export as CSV (.csv)</div>
                <div className="text-[10px] text-slate-400 font-normal">Raw dataset + SHA-256 header seal</div>
              </div>
            </button>
            <button
              onClick={() => triggerServerExport('pdf')}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileText className="w-4 h-4 text-rose-500 shrink-0" />
              <div>
                <div>Export as PDF (.pdf)</div>
                <div className="text-[10px] text-slate-400 font-normal">Official BIR / PFRS formatted statement</div>
              </div>
            </button>
            <button
              onClick={() => triggerServerExport('docx')}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileText className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <div>CPA Memorandum (.docx)</div>
                <div className="text-[10px] text-slate-400 font-normal">Editable Word audit & management report</div>
              </div>
            </button>
          </div>
          <div className="py-1">
            <button
              onClick={() => triggerServerExport('zip')}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileArchive className="w-4 h-4 text-indigo-600 shrink-0" />
              <div>
                <div>Audit Evidence Package (.zip)</div>
                <div className="text-[10px] text-slate-400 font-normal">PDF + XLSX + DOCX + CSV + SHA-256 Manifest</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

