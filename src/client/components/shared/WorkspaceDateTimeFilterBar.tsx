import React, { useState } from 'react';
import { Clock, RotateCcw, Search, X, SlidersHorizontal } from 'lucide-react';
import { useWorkspaceFilter } from '../../context/WorkspaceFilterContext';
import { DateFilterPreset } from '../../utils/dateFilterUtils';

const PRESET_OPTIONS: Array<{ id: DateFilterPreset; label: string; shortLabel: string }> = [
  { id: 'RECENT_1_MONTH', label: 'Recent 1 Month (Default)', shortLabel: '1M' },
  { id: 'ALL', label: 'All Periods', shortLabel: 'All' },
  { id: 'TODAY', label: 'Today', shortLabel: 'Today' },
  { id: 'THIS_WEEK', label: 'This Week', shortLabel: 'Week' },
  { id: 'THIS_MONTH', label: 'This Month', shortLabel: 'Month' },
  { id: 'THIS_QUARTER', label: 'This Quarter', shortLabel: 'Quarter' },
  { id: 'YTD', label: 'Year to Date', shortLabel: 'YTD' },
];

export default function WorkspaceDateTimeFilterBar({
  onClose,
}: {
  onClose?: () => void;
}) {
  const {
    filter,
    isFilterActive,
    setPreset,
    setDateFrom,
    setDateTo,
    setTimeFrom,
    setTimeTo,
    setSearchQuery,
    resetFilter,
  } = useWorkspaceFilter();

  const [showTimeInputs, setShowTimeInputs] = useState<boolean>(
    Boolean(filter.timeFrom || filter.timeTo)
  );

  return (
    <div
      data-testid="workspace-datetime-filter-bar"
      className="bg-white dark:bg-[#11192B] border-b border-slate-200/90 dark:border-[#1E2D45] px-3 sm:px-5 lg:px-6 py-2.5 transition-colors"
    >
      <div className="flex flex-col gap-2.5">
        {/* Primary Row: Presets + Date Pickers + Search + Reset */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          {/* Quick Presets — Segmented on Desktop/Wide, Select on Compact Laptop/Mobile */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="hidden 2xl:inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B1120] border border-slate-200/80 dark:border-[#1E2D45]">
              {PRESET_OPTIONS.map((opt) => {
                const active = filter.preset === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPreset(opt.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-white dark:bg-[#1B2942] text-blue-700 dark:text-sky-300 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Compact Laptop / Tablet / Mobile Preset Selector */}
            <div className="flex 2xl:hidden items-center gap-1.5 w-full sm:w-auto">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:block" />
              <select
                aria-label="Period preset"
                value={filter.preset}
                onChange={(e) => setPreset(e.target.value as DateFilterPreset)}
                className="w-full sm:w-auto min-h-[38px] md:min-h-[34px] px-3 py-1.5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
              >
                {PRESET_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
                <option value="CUSTOM">Custom Date Range</option>
              </select>
            </div>

            {/* Date Range Pickers — Clean From/To prefix with native calendar icon */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
              <label className="relative flex items-center gap-1.5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-lg px-2.5 min-h-[38px] md:min-h-[34px] focus-within:border-blue-600 dark:focus-within:border-sky-400 transition-colors">
                <span className="text-[11px] font-medium text-slate-400 shrink-0">From</span>
                <input
                  type="date"
                  aria-label="Date from"
                  value={filter.dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none w-full min-w-[108px]"
                />
              </label>

              <label className="relative flex items-center gap-1.5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-lg px-2.5 min-h-[38px] md:min-h-[34px] focus-within:border-blue-600 dark:focus-within:border-sky-400 transition-colors">
                <span className="text-[11px] font-medium text-slate-400 shrink-0">To</span>
                <input
                  type="date"
                  aria-label="Date to"
                  value={filter.dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none w-full min-w-[108px]"
                />
              </label>
            </div>

            {/* Optional Time Range Toggle */}
            <button
              type="button"
              onClick={() => setShowTimeInputs((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 min-h-[38px] md:min-h-[34px] rounded-lg text-xs font-semibold border whitespace-nowrap transition-colors cursor-pointer ${
                showTimeInputs || filter.timeFrom || filter.timeTo
                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                  : 'bg-slate-50 dark:bg-[#0F172A] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#24344F] hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Filter by time of day"
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Time</span>
            </button>
          </div>

          {/* Right Controls: Quick Record Filter + Reset + Close */}
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-56 xl:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Quick filter records"
                value={filter.searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Quick filter in view..."
                className="w-full pl-8 pr-7 py-1.5 min-h-[38px] md:min-h-[34px] bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-lg text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400 transition-colors"
              />
              {filter.searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter text"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {isFilterActive && (
              <button
                type="button"
                onClick={resetFilter}
                className="inline-flex items-center gap-1 px-2.5 min-h-[38px] md:min-h-[34px] rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 bg-slate-100 dark:bg-[#1B2942] hover:bg-rose-50 dark:hover:bg-rose-950/40 whitespace-nowrap transition-colors cursor-pointer shrink-0"
                title="Reset all date, time, and text filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Hide period filter bar"
                className="p-2 min-h-[38px] md:min-h-[34px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1B2942] transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Optional Time-of-Day Row */}
        {showTimeInputs && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-[#1B2942]">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              Time Window:
            </span>
            <label className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-lg px-2.5 py-1 min-h-[36px] md:min-h-[32px]">
              <span className="text-[11px] text-slate-400 font-medium">From</span>
              <input
                type="time"
                aria-label="Time from"
                value={filter.timeFrom}
                onChange={(e) => setTimeFrom(e.target.value)}
                className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-lg px-2.5 py-1 min-h-[36px] md:min-h-[32px]">
              <span className="text-[11px] text-slate-400 font-medium">To</span>
              <input
                type="time"
                aria-label="Time to"
                value={filter.timeTo}
                onChange={(e) => setTimeTo(e.target.value)}
                className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none"
              />
            </label>
            {(filter.timeFrom || filter.timeTo) && (
              <button
                type="button"
                onClick={() => {
                  setTimeFrom('');
                  setTimeTo('');
                }}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
              >
                Clear time
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
