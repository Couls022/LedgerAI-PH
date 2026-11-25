import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, MoveHorizontal, RotateCcw } from 'lucide-react';
import { attachResizableTableColumns, ResizableTablesHandle } from '../../utils/uiLayoutUtils';
import { PaginationControls } from '../PaginationControls';

export type TableDensity = 'compact' | 'comfortable' | 'spacious';

export interface TablePaginationConfig {
  pageIndex: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  totalRecords?: number;
  itemCount?: number;
  onPageChange: (newPageIndex: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  canPreviousPage?: boolean;
  canNextPage?: boolean;
  loading?: boolean;
}

interface TableScrollContainerProps {
  children: React.ReactNode;
  maxHeight?: string;
  minHeight?: string;
  className?: string;
  tableClassName?: string;
  stickyHeader?: boolean;
  showScrollButtons?: boolean;
  showTopScrollbar?: boolean;
  density?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;
  title?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  footer?: React.ReactNode;
  totalRecordsCount?: number;
  pagination?: TablePaginationConfig;
}

export const TableScrollContainer: React.FC<TableScrollContainerProps> = ({
  children,
  maxHeight = 'calc(100vh - 280px)',
  minHeight = '280px',
  className = '',
  tableClassName = '',
  stickyHeader = true,
  showScrollButtons = true,
  showTopScrollbar = true,
  density = 'comfortable',
  onDensityChange,
  title,
  toolbarActions,
  footer,
  totalRecordsCount,
  pagination,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<ResizableTablesHandle | null>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasResizedColumns, setHasResizedColumns] = useState(false);

  // Pagination navigation state & calculations
  const totalPages =
    pagination?.totalRecords !== undefined && pagination?.pageSize
      ? Math.max(1, Math.ceil(pagination.totalRecords / pagination.pageSize))
      : undefined;

  const canPrev =
    pagination?.canPreviousPage !== undefined
      ? pagination.canPreviousPage
      : (pagination?.pageIndex ?? 0) > 0;

  const canNext =
    pagination?.canNextPage !== undefined
      ? pagination.canNextPage
      : totalPages !== undefined
      ? (pagination?.pageIndex ?? 0) < totalPages - 1
      : (pagination?.itemCount ?? 0) >= (pagination?.pageSize ?? 20);

  const handlePrevPage = () => {
    if (pagination && canPrev) {
      pagination.onPageChange(Math.max(0, pagination.pageIndex - 1));
    }
  };

  const handleNextPage = () => {
    if (pagination && canNext) {
      pagination.onPageChange(pagination.pageIndex + 1);
    }
  };

  // Update overflow metrics
  const checkOverflow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth: sw, clientWidth: cw } = el;
    setScrollWidth(sw);
    setClientWidth(cw);
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft < sw - cw - 2);

    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = scrollLeft;
    }
  }, []);

  // Attach drag-left/right column resizing to every table rendered inside this container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handle = attachResizableTableColumns(el, (hasCustom) => {
      setHasResizedColumns(hasCustom);
      checkOverflow();
    });
    resizeHandleRef.current = handle;

    return () => {
      handle.cleanup();
      resizeHandleRef.current = null;
    };
  }, [checkOverflow]);

  useEffect(() => {
    checkOverflow();
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => checkOverflow());
    observer.observe(el);

    const handleScroll = () => {
      if (isSyncing) return;
      checkOverflow();
      if (topScrollRef.current && Math.abs(topScrollRef.current.scrollLeft - el.scrollLeft) > 1) {
        topScrollRef.current.scrollLeft = el.scrollLeft;
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', handleScroll);
    };
  }, [checkOverflow, isSyncing, children]);

  const handleTopScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const el = containerRef.current;
    if (!el) return;
    setIsSyncing(true);
    el.scrollLeft = target.scrollLeft;
    setCanScrollLeft(target.scrollLeft > 2);
    setCanScrollRight(target.scrollLeft < target.scrollWidth - target.clientWidth - 2);
    setTimeout(() => setIsSyncing(false), 50);
  };

  const scrollLeftBy = (amount = -300) => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  const scrollRightBy = (amount = 300) => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  const hasHorizontalOverflow = scrollWidth > clientWidth + 4;

  const densityClass =
    density === 'compact'
      ? 'density-compact'
      : density === 'spacious'
      ? 'density-spacious'
      : 'density-comfortable';

  return (
    <div
      className={`table-scroll-wrapper group/table-scroll relative rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] bg-white dark:bg-[#11192B] shadow-xs flex flex-col transition-all ${
        isFullscreen ? 'fixed inset-3 sm:inset-4 z-50 shadow-2xl max-h-[calc(100vh-24px)] motion-modal-enter' : ''
      } ${className}`}
    >
      {/* Top Utility & Scroll Assistance Toolbar */}
      {(title || toolbarActions || hasHorizontalOverflow || onDensityChange || hasResizedColumns || pagination) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 sm:px-4 py-2.5 border-b border-slate-200/80 dark:border-[#1E2D45] bg-slate-50/75 dark:bg-[#0D1524]/70 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            {title && <div className="font-display font-bold text-slate-800 dark:text-slate-100 truncate">{title}</div>}
            {totalRecordsCount !== undefined && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap shrink-0">
                ({totalRecordsCount.toLocaleString()} {totalRecordsCount === 1 ? 'record' : 'records'})
              </span>
            )}
            {pagination && pagination.totalRecords !== undefined && totalRecordsCount === undefined && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap shrink-0">
                ({pagination.totalRecords.toLocaleString()} {pagination.totalRecords === 1 ? 'record' : 'records'})
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            {/* Quick Top Page Navigation */}
            {pagination && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-slate-700 dark:text-slate-200 shadow-2xs shrink-0">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={!canPrev || pagination.loading}
                  title="Previous Page (Row Table) — Preview <"
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#1E2D45] text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-semibold px-1 font-mono">
                  {pagination.pageIndex + 1}{totalPages ? ` / ${totalPages}` : ''}
                </span>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={!canNext || pagination.loading}
                  title="Next Page (Row Table) — Next >"
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#1E2D45] text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Reset Resized Columns Button */}
            {hasResizedColumns && (
              <button
                type="button"
                data-testid="reset-col-widths-btn"
                onClick={() => {
                  resizeHandleRef.current?.resetAllWidths();
                  checkOverflow();
                }}
                title="Reset column widths to default"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-sky-300 text-[11px] font-semibold hover:bg-blue-100 dark:hover:bg-blue-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Widths</span>
              </button>
            )}

            {/* Quick Horizontal Scroll Navigator Buttons */}
            {hasHorizontalOverflow && showScrollButtons && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-slate-600 dark:text-slate-300 shadow-2xs shrink-0">
                <MoveHorizontal className="w-3.5 h-3.5 text-slate-400 mr-0.5 shrink-0" />
                <span className="hidden sm:inline text-[10px] font-semibold text-slate-500 dark:text-slate-400 mr-1 whitespace-nowrap">
                  Pan:
                </span>
                <button
                  type="button"
                  onClick={() => scrollLeftBy(-320)}
                  disabled={!canScrollLeft}
                  title="Scroll Left"
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#1E2D45] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollRightBy(320)}
                  disabled={!canScrollRight}
                  title="Scroll Right"
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#1E2D45] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Density Selector */}
            {onDensityChange && (
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-[#24344F] bg-white dark:bg-[#162238] p-0.5 text-[11px] font-semibold shrink-0">
                <button
                  type="button"
                  onClick={() => onDensityChange('compact')}
                  className={`px-2 py-0.5 rounded whitespace-nowrap transition-colors cursor-pointer ${
                    density === 'compact'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                  title="Compact Density"
                >
                  Compact
                </button>
                <button
                  type="button"
                  onClick={() => onDensityChange('comfortable')}
                  className={`px-2 py-0.5 rounded whitespace-nowrap transition-colors cursor-pointer ${
                    density === 'comfortable'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                  title="Comfortable Density"
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  onClick={() => onDensityChange('spacious')}
                  className={`px-2 py-0.5 rounded whitespace-nowrap transition-colors cursor-pointer ${
                    density === 'spacious'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                  title="Spacious Density"
                >
                  Spacious
                </button>
              </div>
            )}

            {toolbarActions}

            {/* Fullscreen Expand */}
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit Focus View' : 'Focus Table View'}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-[#24344F] bg-white dark:bg-[#162238] hover:bg-slate-100 dark:hover:bg-[#1E2D45] text-slate-500 hover:text-slate-800 dark:text-slate-400 transition-colors shrink-0 cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Mirrored Top Horizontal Scrollbar */}
      {hasHorizontalOverflow && showTopScrollbar && (
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="overflow-x-auto scrollbar-custom bg-slate-100/80 dark:bg-[#0D1524] border-b border-slate-200/60 dark:border-[#1E2D45] h-2.5 w-full select-none"
          title="Top scrollbar: drag to pan wide columns horizontally"
        >
          <div style={{ width: `${scrollWidth}px`, height: '1px' }} />
        </div>
      )}

      {/* Main Table Scroll Area */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {canScrollLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-black/10 dark:from-black/30 to-transparent z-15" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/10 dark:from-black/30 to-transparent z-15" />
        )}

        {/* Hover Floating Previous/Next Navigation Arrows directly over table rows */}
        {pagination && (
          <>
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={!canPrev || pagination.loading}
              aria-label="Previous Page"
              title="Previous Page (Row Table) — Preview <"
              className={`absolute left-3 top-1/2 -translate-y-1/2 z-25 flex items-center justify-center w-9 h-9 rounded-full shadow-lg border border-slate-300 dark:border-slate-600 bg-white/95 dark:bg-[#162238]/95 text-slate-700 dark:text-slate-100 backdrop-blur-xs transition-all duration-200 cursor-pointer ${
                canPrev
                  ? 'opacity-0 group-hover/table-scroll:opacity-90 hover:!opacity-100 hover:scale-110 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={!canNext || pagination.loading}
              aria-label="Next Page"
              title="Next Page (Row Table) — Next >"
              className={`absolute right-3 top-1/2 -translate-y-1/2 z-25 flex items-center justify-center w-9 h-9 rounded-full shadow-lg border border-slate-300 dark:border-slate-600 bg-white/95 dark:bg-[#162238]/95 text-slate-700 dark:text-slate-100 backdrop-blur-xs transition-all duration-200 cursor-pointer ${
                canNext
                  ? 'opacity-0 group-hover/table-scroll:opacity-90 hover:!opacity-100 hover:scale-110 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        <div
          ref={containerRef}
          data-scroll-region="true"
          style={{
            maxHeight: isFullscreen ? 'calc(100vh - 120px)' : maxHeight,
            minHeight: minHeight,
          }}
          className={`overflow-auto scroll-region scrollbar-custom w-full ${stickyHeader ? 'sticky-table-header' : ''} ${densityClass} ${tableClassName}`}
        >
          {children}
        </div>
      </div>

      {/* Sticky Bottom Pagination or Custom Footer */}
      {(footer || pagination) && (
        <div className="sticky bottom-0 z-20 bg-white dark:bg-[#11192B] border-t border-slate-200 dark:border-[#1E2D45]">
          {footer ? (
            footer
          ) : pagination ? (
            <PaginationControls
              pageIndex={pagination.pageIndex}
              pageSize={pagination.pageSize || 20}
              pageSizeOptions={pagination.pageSizeOptions || [20, 25, 50, 100]}
              totalCount={pagination.totalRecords}
              itemCount={pagination.itemCount || 0}
              hasNextPage={canNext}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
              onPageSizeChange={pagination.onPageSizeChange}
              loading={pagination.loading}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};
