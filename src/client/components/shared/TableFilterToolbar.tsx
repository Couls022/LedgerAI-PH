import React from 'react';
import {
  Calendar,
  Filter,
  ArrowUpDown,
  Search,
  X,
  RotateCcw,
  Building2,
  Package,
  Layers,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { formatIsoDateLocal, getCurrentCalendarMonthRange } from '../../utils/dateFilterUtils';

export type SortOrderDirection = 'DESC' | 'ASC';

export type DatePeriodFilter =
  | 'ALL'
  | 'THIS_MONTH'
  | 'PREV_MONTH'
  | 'LAST_30_DAYS'
  | 'THIS_QUARTER'
  | 'YTD'
  | 'CUSTOM';

export interface DropdownOption {
  value: string;
  label: string;
  sublabel?: string;
}

export interface TableFilterToolbarProps {
  // Sort Direction (DESC = latest on top, ASC = oldest on top)
  sortOrder?: SortOrderDirection;
  onSortOrderChange?: (order: SortOrderDirection) => void;

  // Date Period Filter
  datePeriod?: DatePeriodFilter;
  onDatePeriodChange?: (period: DatePeriodFilter) => void;

  // Custom Date Range
  fromDate?: string;
  toDate?: string;
  onDateRangeChange?: (range: { fromDate: string; toDate: string }) => void;

  // Company / Counterparty Filter (Customer / Vendor / Account)
  entityLabel?: string; // e.g. "Customer", "Vendor", "Account", "Company"
  selectedEntityId?: string;
  entityOptions?: DropdownOption[];
  onEntityChange?: (entityId: string) => void;

  // Product / Category Filter (Optional)
  productLabel?: string; // e.g. "Product / Item", "Category"
  selectedProductId?: string;
  productOptions?: DropdownOption[];
  onProductChange?: (productId: string) => void;

  // Search Input (Transaction #, Reference, Description, Product SKU)
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;

  // Record Counts & Summary
  filteredCount?: number;
  totalCount?: number;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;

  // Reset Callback
  onResetFilters?: () => void;

  // Styling
  className?: string;
}

/**
 * Calculates start and end dates based on period presets
 */
export function computePeriodDates(
  period: DatePeriodFilter,
  referenceDate: Date = new Date()
): { fromDate: string; toDate: string } {
  const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const todayStr = formatIsoDateLocal(ref);

  switch (period) {
    case 'ALL':
      return { fromDate: '', toDate: '' };

    case 'THIS_MONTH': {
      const monthRange = getCurrentCalendarMonthRange(ref);
      return { fromDate: monthRange.fromDate, toDate: monthRange.toDate };
    }

    case 'PREV_MONTH': {
      const firstDayPrev = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
      const lastDayPrev = new Date(ref.getFullYear(), ref.getMonth(), 0);
      return {
        fromDate: formatIsoDateLocal(firstDayPrev),
        toDate: formatIsoDateLocal(lastDayPrev),
      };
    }

    case 'LAST_30_DAYS': {
      const past30 = new Date(ref);
      past30.setDate(ref.getDate() - 30);
      return { fromDate: formatIsoDateLocal(past30), toDate: todayStr };
    }

    case 'THIS_QUARTER': {
      const qStartMonth = Math.floor(ref.getMonth() / 3) * 3;
      const start = new Date(ref.getFullYear(), qStartMonth, 1);
      return { fromDate: formatIsoDateLocal(start), toDate: todayStr };
    }

    case 'YTD': {
      const start = new Date(ref.getFullYear(), 0, 1);
      return { fromDate: formatIsoDateLocal(start), toDate: todayStr };
    }

    case 'CUSTOM':
    default:
      return { fromDate: '', toDate: '' };
  }
}

export const TableFilterToolbar: React.FC<TableFilterToolbarProps> = ({
  sortOrder = 'DESC',
  onSortOrderChange,
  datePeriod = 'ALL',
  onDatePeriodChange,
  fromDate = '',
  toDate = '',
  onDateRangeChange,
  entityLabel = 'Company / Entity',
  selectedEntityId = 'ALL',
  entityOptions,
  onEntityChange,
  productLabel = 'Product / Item',
  selectedProductId = 'ALL',
  productOptions,
  onProductChange,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search transaction #, reference, details...',
  filteredCount,
  totalCount,
  pageSize = 20,
  onPageSizeChange,
  onResetFilters,
  className = '',
}) => {
  const isCustomDate = datePeriod === 'CUSTOM';

  const handlePeriodChange = (newPeriod: DatePeriodFilter) => {
    if (onDatePeriodChange) {
      onDatePeriodChange(newPeriod);
    }
    if (onDateRangeChange) {
      if (newPeriod === 'CUSTOM') {
        // Keep current or clear
      } else {
        const computed = computePeriodDates(newPeriod);
        onDateRangeChange(computed);
      }
    }
  };

  const isFiltered =
    datePeriod !== 'ALL' ||
    Boolean(fromDate) ||
    Boolean(toDate) ||
    (selectedEntityId && selectedEntityId !== 'ALL') ||
    (selectedProductId && selectedProductId !== 'ALL') ||
    Boolean(searchQuery.trim()) ||
    sortOrder !== 'DESC';

  const handleReset = () => {
    if (onResetFilters) {
      onResetFilters();
    } else {
      if (onSortOrderChange) onSortOrderChange('DESC');
      if (onDatePeriodChange) onDatePeriodChange('ALL');
      if (onDateRangeChange) onDateRangeChange({ fromDate: '', toDate: '' });
      if (onEntityChange) onEntityChange('ALL');
      if (onProductChange) onProductChange('ALL');
      if (onSearchChange) onSearchChange('');
    }
  };

  return (
    <div
      data-testid="table-filter-toolbar"
      className={`flex flex-col gap-2.5 p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs transition-colors ${className}`}
    >
      {/* Primary Toolbar Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left Section: Sort Order + Date Filter Dropdown + Entity Dropdown */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. Sort Order Dropdown (Latest on Top vs Oldest on Top) */}
          {onSortOrderChange && (
            <div className="relative inline-flex items-center">
              <label
                htmlFor="filter-sort-order"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Piliin kung ang pinakabagong update ay nasa itaas o nasa ibaba"
              >
                {sortOrder === 'DESC' ? (
                  <ArrowDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span className="text-[11px] font-medium text-slate-400">Sort:</span>
                <select
                  id="filter-sort-order"
                  value={sortOrder}
                  onChange={(e) => onSortOrderChange(e.target.value as SortOrderDirection)}
                  className="bg-transparent border-none text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer pr-1"
                >
                  <option value="DESC" className="dark:bg-slate-800">
                    Latest on Top (Bago sa Taas)
                  </option>
                  <option value="ASC" className="dark:bg-slate-800">
                    Oldest on Top (Luma sa Taas)
                  </option>
                </select>
              </label>
            </div>
          )}

          {/* 2. Date Period Dropdown (All Records, This Month, Prev Month, 30 Days, Custom) */}
          {onDatePeriodChange && (
            <div className="relative inline-flex items-center">
              <label
                htmlFor="filter-date-period"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  datePeriod !== 'ALL'
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200'
                    : 'bg-slate-50 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Filter by transaction date. 'All Records' guarantees past months remain visible even if current month is empty."
              >
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-[11px] font-medium text-slate-400">Date:</span>
                <select
                  id="filter-date-period"
                  value={datePeriod}
                  onChange={(e) => handlePeriodChange(e.target.value as DatePeriodFilter)}
                  className="bg-transparent border-none text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer pr-1"
                >
                  <option value="ALL" className="dark:bg-slate-800">
                    All Records (Show All / Visible)
                  </option>
                  <option value="THIS_MONTH" className="dark:bg-slate-800">
                    This Month (Kasalukuyang Buwan)
                  </option>
                  <option value="PREV_MONTH" className="dark:bg-slate-800">
                    Previous Month (Nakaraang Buwan)
                  </option>
                  <option value="LAST_30_DAYS" className="dark:bg-slate-800">
                    Recent 30 Days (Huling 30 Araw)
                  </option>
                  <option value="THIS_QUARTER" className="dark:bg-slate-800">
                    This Quarter
                  </option>
                  <option value="YTD" className="dark:bg-slate-800">
                    Year to Date (YTD)
                  </option>
                  <option value="CUSTOM" className="dark:bg-slate-800">
                    Custom Date Range...
                  </option>
                </select>
              </label>
            </div>
          )}

          {/* 3. Company / Counterparty Filter (Customer / Vendor / Account) */}
          {entityOptions && entityOptions.length > 0 && onEntityChange && (
            <div className="relative inline-flex items-center">
              <label
                htmlFor="filter-entity-dropdown"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  selectedEntityId && selectedEntityId !== 'ALL'
                    ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                    : 'bg-slate-50 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-medium text-slate-400">{entityLabel}:</span>
                <select
                  id="filter-entity-dropdown"
                  value={selectedEntityId}
                  onChange={(e) => onEntityChange(e.target.value)}
                  className="bg-transparent border-none text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer max-w-[160px] truncate pr-1"
                >
                  <option value="ALL" className="dark:bg-slate-800">
                    All {entityLabel}s
                  </option>
                  {entityOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="dark:bg-slate-800">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* 4. Product / Category Filter (Optional) */}
          {productOptions && productOptions.length > 0 && onProductChange && (
            <div className="relative inline-flex items-center">
              <label
                htmlFor="filter-product-dropdown"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  selectedProductId && selectedProductId !== 'ALL'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Package className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[11px] font-medium text-slate-400">{productLabel}:</span>
                <select
                  id="filter-product-dropdown"
                  value={selectedProductId}
                  onChange={(e) => onProductChange(e.target.value)}
                  className="bg-transparent border-none text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer max-w-[150px] truncate pr-1"
                >
                  <option value="ALL" className="dark:bg-slate-800">
                    All {productLabel}s
                  </option>
                  {productOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="dark:bg-slate-800">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* Right Section: Search Bar + Active Count + Reset Button */}
        <div className="flex items-center gap-2 grow lg:grow-0 justify-end">
          {/* Search Box */}
          {onSearchChange && (
            <div className="relative w-full sm:w-64 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8.5 pr-7 py-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Reset Filters Button */}
          {isFiltered && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer shrink-0"
              title="Reset all filters to default (All records, latest first)"
            >
              <RotateCcw className="w-3 h-3 text-slate-500" />
              <span>Reset</span>
            </button>
          )}

          {/* Page Size Selector */}
          {onPageSizeChange && (
            <div className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
              <span>Rows:</span>
              <select
                aria-label="Table rows per page"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20 (Default)</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Secondary Row: Custom Date Pickers (Shown if CUSTOM period or if user manually supplied custom dates) */}
      {(isCustomDate || fromDate || toDate) && onDateRangeChange && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-xs">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Filter className="w-3 h-3 text-indigo-500" />
            Custom Date Range:
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs">
              <span className="text-[11px] text-slate-400">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => onDateRangeChange({ fromDate: e.target.value, toDate })}
                className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none"
              />
            </label>
            <span className="text-slate-400 text-xs">to</span>
            <label className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs">
              <span className="text-[11px] text-slate-400">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => onDateRangeChange({ fromDate, toDate: e.target.value })}
                className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none"
              />
            </label>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => onDateRangeChange({ fromDate: '', toDate: '' })}
                className="text-[11px] text-slate-400 hover:text-rose-500 ml-1 transition-colors"
                title="Clear date inputs"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Informational Status Strip (Showing current filter state & record count) */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5 px-0.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            {sortOrder === 'DESC' ? 'Latest updates first' : 'Oldest records first'}
          </span>
          <span>•</span>
          <span>
            {datePeriod === 'ALL'
              ? 'All historical periods visible (no hidden records)'
              : datePeriod === 'THIS_MONTH'
              ? 'Filtered: Current Month'
              : datePeriod === 'PREV_MONTH'
              ? 'Filtered: Previous Month'
              : datePeriod === 'LAST_30_DAYS'
              ? 'Filtered: Last 30 Days'
              : `Date Range: ${fromDate || 'Start'} to ${toDate || 'Present'}`}
          </span>
          {selectedEntityId && selectedEntityId !== 'ALL' && (
            <>
              <span>•</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                {entityLabel} filtered
              </span>
            </>
          )}
        </div>

        <div className="font-mono text-[11px]">
          {filteredCount !== undefined ? (
            <span>
              Showing <strong className="text-slate-700 dark:text-slate-200">{filteredCount}</strong>
              {totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : ''} items (20/page)
            </span>
          ) : (
            <span>Page size: {pageSize} rows</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default TableFilterToolbar;
