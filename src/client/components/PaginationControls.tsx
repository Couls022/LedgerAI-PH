import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check, Hash } from 'lucide-react';

export interface PaginationControlsProps {
  totalCount?: number;
  itemCount: number;
  pageIndex: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  hasNextPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  onPageSizeChange?: (newSize: number) => void;
  onFirstPage?: () => void;
  onLastPage?: () => void;
  loading?: boolean;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  totalCount,
  itemCount,
  pageIndex,
  pageSize = 20,
  pageSizeOptions = [20, 25, 50, 100],
  hasNextPage,
  onNextPage,
  onPrevPage,
  onPageSizeChange,
  onFirstPage,
  onLastPage,
  loading = false,
}) => {
  const totalPages = totalCount !== undefined && pageSize ? Math.max(1, Math.ceil(totalCount / pageSize)) : undefined;
  const startItem = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const endItem = totalCount !== undefined ? Math.min((pageIndex + 1) * pageSize, totalCount) : startItem + itemCount - 1;

  // Custom page size handling ("pwdeng gawin kahit ilan")
  const isPresetOption = pageSizeOptions.includes(pageSize);
  const [isCustomMode, setIsCustomMode] = useState(!isPresetOption);
  const [customInputVal, setCustomInputVal] = useState(String(pageSize));

  useEffect(() => {
    setCustomInputVal(String(pageSize));
    setIsCustomMode(!pageSizeOptions.includes(pageSize));
  }, [pageSize, pageSizeOptions]);

  const handleSelectChange = (val: string) => {
    if (val === 'CUSTOM') {
      setIsCustomMode(true);
    } else {
      setIsCustomMode(false);
      const num = Number(val);
      if (onPageSizeChange && !isNaN(num) && num > 0) {
        onPageSizeChange(num);
      }
    }
  };

  const handleApplyCustom = () => {
    const val = parseInt(customInputVal, 10);
    if (!isNaN(val) && val > 0 && onPageSizeChange) {
      onPageSizeChange(val);
    }
  };

  const handleKeyDownCustom = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApplyCustom();
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 select-none">
      {/* Records Count & Page Size Selector */}
      <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
        {totalCount !== undefined ? (
          <span className="text-slate-600 dark:text-slate-400">
            Showing <strong className="font-semibold text-slate-900 dark:text-slate-100">{startItem}</strong>–
            <strong className="font-semibold text-slate-900 dark:text-slate-100">{endItem}</strong> of{' '}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">{totalCount.toLocaleString()}</strong> records
          </span>
        ) : (
          <span className="text-slate-600 dark:text-slate-400">
            Showing <strong className="font-semibold text-slate-900 dark:text-slate-100">{itemCount}</strong> records
          </span>
        )}

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-0 sm:ml-2 border-l sm:border-slate-200 sm:dark:border-slate-800 sm:pl-3">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Rows per page:</span>
            <select
              value={isCustomMode ? 'CUSTOM' : pageSize}
              onChange={(e) => handleSelectChange(e.target.value)}
              disabled={loading}
              className="px-2 py-1 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
              <option value="CUSTOM">Custom...</option>
            </select>

            {/* Custom page size input field ("pwdeng gawin kahit ilan") */}
            {isCustomMode && (
              <div className="inline-flex items-center gap-1 ml-1">
                <div className="relative">
                  <Hash className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={customInputVal}
                    onChange={(e) => setCustomInputVal(e.target.value)}
                    onKeyDown={handleKeyDownCustom}
                    onBlur={handleApplyCustom}
                    placeholder="Size"
                    title="Enter custom rows per page and press Enter"
                    className="w-16 pl-6 pr-1.5 py-1 text-xs font-mono font-semibold bg-slate-50 dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyCustom}
                  title="Apply custom rows per page"
                  className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 transition-colors"
                >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pagination Navigation Buttons */}
      <div className="flex items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-end">
        <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px] mr-2">
          Page <strong className="font-bold text-slate-800 dark:text-slate-200">{pageIndex + 1}</strong>
          {totalPages ? ` of ${totalPages}` : ''}
        </span>

        {onFirstPage && (
          <button
            type="button"
            onClick={onFirstPage}
            disabled={pageIndex === 0 || loading}
            title="First Page"
            aria-label="First Page"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={onPrevPage}
          disabled={pageIndex === 0 || loading}
          title="Previous Page"
          aria-label="Previous Page"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Previous</span>
        </button>

        <button
          type="button"
          onClick={onNextPage}
          disabled={!hasNextPage || loading}
          title="Next Page"
          aria-label="Next Page"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
        >
          <span className="hidden sm:inline">Next</span> <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {onLastPage && totalPages && (
          <button
            type="button"
            onClick={onLastPage}
            disabled={pageIndex >= totalPages - 1 || !hasNextPage || loading}
            title="Last Page"
            aria-label="Last Page"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
