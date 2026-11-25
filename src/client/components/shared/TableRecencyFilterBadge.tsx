import React from 'react';
import { Calendar, Filter } from 'lucide-react';

export interface TableRecencyFilterBadgeProps {
  mode: 'RECENT_1_MONTH' | 'ALL';
  onModeChange?: (newMode: 'RECENT_1_MONTH' | 'ALL') => void;
  onChange?: (newMode: 'RECENT_1_MONTH' | 'ALL') => void;
  filteredCount?: number;
  totalCount?: number;
  recordCount?: number;
  className?: string;
}

export const TableRecencyFilterBadge: React.FC<TableRecencyFilterBadgeProps> = ({
  mode,
  onModeChange,
  onChange,
  filteredCount,
  totalCount,
  recordCount,
  className = '',
}) => {
  const isRecent = mode === 'RECENT_1_MONTH';
  const displayCount = recordCount !== undefined ? recordCount : filteredCount;

  const handleSelect = (nextMode: 'RECENT_1_MONTH' | 'ALL') => {
    if (onModeChange) onModeChange(nextMode);
    if (onChange) onChange(nextMode);
  };

  return (
    <div className={`inline-flex items-center gap-1.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs ${className}`}>
      <button
        type="button"
        onClick={() => handleSelect('RECENT_1_MONTH')}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
          isRecent
            ? 'bg-indigo-600 text-white shadow-2xs'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
        title="Showing recent 1 month (past 30 days) updated data"
      >
        <Calendar className="w-3.5 h-3.5" />
        <span>Recent 1 Month</span>
        {isRecent && displayCount !== undefined && (
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-700 text-indigo-100">
            {displayCount}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => handleSelect('ALL')}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
          !isRecent
            ? 'bg-indigo-600 text-white shadow-2xs'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
        title="Show all records across all time"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>All Time</span>
        {!isRecent && (totalCount !== undefined || displayCount !== undefined) && (
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-700 text-indigo-100">
            {totalCount !== undefined ? totalCount : displayCount}
          </span>
        )}
      </button>
    </div>
  );
};

export default TableRecencyFilterBadge;
