import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown, Check } from 'lucide-react';
import { exportToCSV, exportToPDF, PDFExportOptions } from '../utils/exportUtils';

export interface ExportData {
  filename: string;
  title: string;
  subtitle?: string;
  companyName?: string;
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
  const [lastExported, setLastExported] = useState<'csv' | 'pdf' | null>(null);
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

  const handleExportCSV = () => {
    setIsOpen(false);
    exportToCSV(data.filename, data.headers, data.rows);
    setLastExported('csv');
    setTimeout(() => setLastExported(null), 3000);
  };

  const handleExportPDF = () => {
    setIsOpen(false);
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
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled || data.rows.length === 0}
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-2 border ${
          disabled || data.rows.length === 0
            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600 dark:border-slate-700'
            : lastExported
            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700'
        }`}
      >
        {lastExported ? (
          <>
            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Exported {lastExported.toUpperCase()}</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Export Report</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </>
        )}
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-xl shadow-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ring-1 ring-black/5 z-50 divide-y divide-slate-100 dark:divide-slate-700/60">
          <div className="py-1">
            <button
              onClick={handleExportPDF}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileText className="w-4 h-4 text-rose-500" />
              <div>
                <div>Export as PDF</div>
                <div className="text-[10px] text-slate-400 font-normal">Formatted printable report</div>
              </div>
            </button>
            <button
              onClick={handleExportCSV}
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/80 flex items-center gap-2.5 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <div>
                <div>Export as CSV</div>
                <div className="text-[10px] text-slate-400 font-normal">Excel & Spreadsheet compatible</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
