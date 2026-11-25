import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  DateFilterPreset,
  WorkspaceFilterState,
  DEFAULT_WORKSPACE_FILTER,
  computePresetDateRange,
  isWorkspaceFilterActive,
  formatFilterSummaryLabel,
} from '../utils/dateFilterUtils';

const STORAGE_KEY = 'ledgerai_workspace_period_filter_v1';

interface WorkspaceFilterContextValue {
  filter: WorkspaceFilterState;
  isFilterActive: boolean;
  summaryLabel: string;
  isBarOpen: boolean;
  setIsBarOpen: (open: boolean) => void;
  toggleBarOpen: () => void;
  setPreset: (preset: DateFilterPreset) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setTimeFrom: (value: string) => void;
  setTimeTo: (value: string) => void;
  setSearchQuery: (value: string) => void;
  resetFilter: () => void;
}

const WorkspaceFilterContext = createContext<WorkspaceFilterContextValue | null>(null);

function loadInitialFilter(): WorkspaceFilterState {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_FILTER;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_FILTER;
    const parsed = JSON.parse(raw);
    return {
      preset: parsed.preset || 'ALL',
      dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : '',
      dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : '',
      timeFrom: typeof parsed.timeFrom === 'string' ? parsed.timeFrom : '',
      timeTo: typeof parsed.timeTo === 'string' ? parsed.timeTo : '',
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
    };
  } catch {
    return DEFAULT_WORKSPACE_FILTER;
  }
}

export function WorkspaceFilterProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilter] = useState<WorkspaceFilterState>(loadInitialFilter);
  const [isBarOpen, setIsBarOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // ignore storage quota errors
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ledgerai:workspace-filter', { detail: filter }));
    }
  }, [filter]);

  const setPreset = useCallback((preset: DateFilterPreset) => {
    if (preset === 'CUSTOM') {
      setFilter((prev) => ({ ...prev, preset: 'CUSTOM' }));
      return;
    }
    const { dateFrom, dateTo } = computePresetDateRange(preset);
    setFilter((prev) => ({
      ...prev,
      preset,
      dateFrom,
      dateTo,
    }));
  }, []);

  const setDateFrom = useCallback((value: string) => {
    setFilter((prev) => ({ ...prev, preset: 'CUSTOM', dateFrom: value }));
  }, []);

  const setDateTo = useCallback((value: string) => {
    setFilter((prev) => ({ ...prev, preset: 'CUSTOM', dateTo: value }));
  }, []);

  const setTimeFrom = useCallback((value: string) => {
    setFilter((prev) => ({ ...prev, timeFrom: value }));
  }, []);

  const setTimeTo = useCallback((value: string) => {
    setFilter((prev) => ({ ...prev, timeTo: value }));
  }, []);

  const setSearchQuery = useCallback((value: string) => {
    setFilter((prev) => ({ ...prev, searchQuery: value }));
  }, []);

  const resetFilter = useCallback(() => {
    setFilter(DEFAULT_WORKSPACE_FILTER);
  }, []);

  const toggleBarOpen = useCallback(() => {
    setIsBarOpen((prev) => !prev);
  }, []);

  const isFilterActive = useMemo(() => isWorkspaceFilterActive(filter), [filter]);
  const summaryLabel = useMemo(() => formatFilterSummaryLabel(filter), [filter]);

  const value = useMemo<WorkspaceFilterContextValue>(
    () => ({
      filter,
      isFilterActive,
      summaryLabel,
      isBarOpen,
      setIsBarOpen,
      toggleBarOpen,
      setPreset,
      setDateFrom,
      setDateTo,
      setTimeFrom,
      setTimeTo,
      setSearchQuery,
      resetFilter,
    }),
    [
      filter,
      isFilterActive,
      summaryLabel,
      isBarOpen,
      toggleBarOpen,
      setPreset,
      setDateFrom,
      setDateTo,
      setTimeFrom,
      setTimeTo,
      setSearchQuery,
      resetFilter,
    ]
  );

  return <WorkspaceFilterContext.Provider value={value}>{children}</WorkspaceFilterContext.Provider>;
}

export function useWorkspaceFilter(): WorkspaceFilterContextValue {
  const ctx = useContext(WorkspaceFilterContext);
  if (!ctx) {
    throw new Error('useWorkspaceFilter must be used within a WorkspaceFilterProvider');
  }
  return ctx;
}
