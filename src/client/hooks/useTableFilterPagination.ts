import { useState, useMemo, useCallback } from 'react';

export interface UseTableFilterPaginationOptions<T> {
  defaultPageSize?: number; // Defaults to 20
  pageSizeOptions?: number[]; // Defaults to [20, 50, 100]
  getDate?: (item: T) => string | Date | null | undefined;
  defaultToRecentOneMonth?: boolean; // Defaults to true
}

export interface UseTableFilterPaginationReturn<T> {
  // Date Filtering State
  dateFilterMode: 'RECENT_1_MONTH' | 'ALL';
  setDateFilterMode: (mode: 'RECENT_1_MONTH' | 'ALL') => void;
  isRecentFilterActive: boolean;

  // Pagination State
  pageIndex: number;
  setPageIndex: (index: number | ((prev: number) => number)) => void;
  pageSize: number;
  pageSizeOptions: number[];
  onPageSizeChange: (newSize: number) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  onFirstPage: () => void;
  onLastPage: () => void;
  hasNextPage: boolean;
  hasPrevPage: boolean;

  // Sliced / Filtered Data
  totalCount: number;
  totalPages: number;
  paginatedItems: T[];
  filteredItems: T[];
  unfilteredCount: number;
}

export function useTableFilterPagination<T>(
  items: T[],
  options?: UseTableFilterPaginationOptions<T>
): UseTableFilterPaginationReturn<T> {
  const defaultPageSize = options?.defaultPageSize || 20;
  const pageSizeOptions = options?.pageSizeOptions || [20, 50, 100];
  const defaultToRecent = options?.defaultToRecentOneMonth !== false;

  const [dateFilterMode, setDateFilterModeState] = useState<'RECENT_1_MONTH' | 'ALL'>(
    defaultToRecent ? 'RECENT_1_MONTH' : 'ALL'
  );
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);

  // Compute 30 days ago (recent 1 month boundary)
  const oneMonthAgoIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const setDateFilterMode = useCallback((mode: 'RECENT_1_MONTH' | 'ALL') => {
    setDateFilterModeState(mode);
    setPageIndex(0);
  }, []);

  // Filter items by recency if RECENT_1_MONTH is active
  const filteredItems = useMemo(() => {
    if (!options?.getDate || dateFilterMode === 'ALL') {
      return items;
    }
    return items.filter((item) => {
      const val = options.getDate!(item);
      if (!val) return true;
      const str = val instanceof Date ? val.toISOString().slice(0, 10) : String(val).slice(0, 10);
      return str >= oneMonthAgoIso;
    });
  }, [items, dateFilterMode, options?.getDate, oneMonthAgoIso]);

  // Slice paginated chunk of rows (default 20, 50, 100)
  const paginatedItems = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, pageIndex, pageSize]);

  const totalCount = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasNextPage = pageIndex < totalPages - 1;
  const hasPrevPage = pageIndex > 0;

  const onNextPage = useCallback(() => {
    setPageIndex((prev) => (prev < totalPages - 1 ? prev + 1 : prev));
  }, [totalPages]);

  const onPrevPage = useCallback(() => {
    setPageIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const onPageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPageIndex(0);
  }, []);

  return {
    dateFilterMode,
    setDateFilterMode,
    isRecentFilterActive: dateFilterMode === 'RECENT_1_MONTH',

    pageIndex,
    setPageIndex,
    pageSize,
    pageSizeOptions,
    onPageSizeChange,
    onNextPage,
    onPrevPage,
    onFirstPage: () => setPageIndex(0),
    onLastPage: () => setPageIndex(totalPages - 1),
    hasNextPage,
    hasPrevPage,

    totalCount,
    totalPages,
    paginatedItems,
    filteredItems,
    unfilteredCount: items.length,
  };
}
