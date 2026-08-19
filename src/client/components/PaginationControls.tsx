import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationControlsProps {
  totalCount?: number;
  itemCount: number;
  pageIndex: number;
  hasNextPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  loading?: boolean;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  totalCount,
  itemCount,
  pageIndex,
  hasNextPage,
  onNextPage,
  onPrevPage,
  loading = false,
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
      <div>
        {totalCount !== undefined ? (
          <span>
            Showing <strong className="font-semibold text-slate-800 dark:text-slate-200">{itemCount}</strong> of{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">{totalCount}</strong> records
          </span>
        ) : (
          <span>Showing <strong className="font-semibold text-slate-800 dark:text-slate-200">{itemCount}</strong> records</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] mr-2">Page {pageIndex + 1}</span>
        <button
          type="button"
          onClick={onPrevPage}
          disabled={pageIndex === 0 || loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Previous
        </button>
        <button
          type="button"
          onClick={onNextPage}
          disabled={!hasNextPage || loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
