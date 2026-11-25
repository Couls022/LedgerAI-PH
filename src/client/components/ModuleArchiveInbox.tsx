import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  RefreshCw,
  RotateCcw,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Activity,
  Search,
  Lock,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';
import RecordActivityModal from './RecordActivityModal';
import TableFilterToolbar, {
  DatePeriodFilter,
  computePeriodDates,
  SortOrderDirection,
} from './shared/TableFilterToolbar';
import { PaginationControls } from './PaginationControls';

export interface ModuleArchiveInboxProps {
  entityTypes: string[];
  moduleTitle: string;
  description?: string;
  buttonLabel?: string;
  onRestored?: () => void;
  className?: string;
}

export default function ModuleArchiveInbox({
  entityTypes,
  moduleTitle,
  description,
  buttonLabel = 'Archive Inbox',
  onRestored,
  className = '',
}: ModuleArchiveInboxProps) {
  const { activeCompany } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [retentionFilter, setRetentionFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [pageIndex, setPageIndex] = useState(0);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'restore' | 'purge';
    entityType: string;
    id: string;
    name: string;
    previousStatus?: string;
  } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  const entityTypesParam = entityTypes.map((e) => e.trim().toUpperCase()).filter(Boolean).join(',');

  const fetchArchived = async () => {
    if (!entityTypesParam) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/api/system/archived-records?entityTypes=${encodeURIComponent(entityTypesParam)}`);
      const list = Array.isArray(res?.records) ? res.records : [];
      setRecords(list);
      setCount(list.length);
    } catch (err: any) {
      setBanner({ type: 'error', message: err?.message || 'Failed to load archived records.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchived();
  }, [activeCompany?.id, entityTypesParam]);

  const handleOpen = () => {
    setBanner(null);
    setIsOpen(true);
    fetchArchived();
  };

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const dateRange = datePeriod === 'CUSTOM'
      ? { fromDate, toDate }
      : computePeriodDates(datePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;

    const list = records.filter((rec) => {
      if (retentionFilter !== 'ALL' && (rec.retentionState || 'ACTIVE_RETENTION') !== retentionFilter) {
        return false;
      }
      const archDate = (rec.archivedAt || '').slice(0, 10);
      if (from && archDate && archDate < from) return false;
      if (to && archDate && archDate > to) return false;
      if (!q) return true;
      const hay = `${rec.id || ''} ${rec.code || ''} ${rec.name || ''} ${rec.entityType || ''} ${rec.archivedBy || ''} ${rec.archiveReason || ''}`.toLowerCase();
      return hay.includes(q);
    });

    return list.sort((a, b) => {
      const dateA = a.archivedAt || '';
      const dateB = b.archivedAt || '';
      if (sortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [records, searchQuery, retentionFilter, datePeriod, fromDate, toDate, sortOrder]);

  const paginatedRecords = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, pageIndex, pageSize]);

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    setProcessing(true);
    setBanner(null);
    try {
      if (confirmAction.type === 'restore') {
        const res = await apiFetch<any>(
          `/api/system/archived-records/${encodeURIComponent(confirmAction.entityType)}/${encodeURIComponent(confirmAction.id)}/restore`,
          { method: 'PATCH' }
        );
        setBanner({
          type: 'success',
          message: res?.message || `"${confirmAction.name}" restored successfully.`,
        });
      } else {
        const res = await apiFetch<any>(
          `/api/system/archived-records/${encodeURIComponent(confirmAction.entityType)}/${encodeURIComponent(confirmAction.id)}/permanent`,
          { method: 'DELETE' }
        );
        setBanner({
          type: 'success',
          message: res?.message || `"${confirmAction.name}" permanently deleted.`,
        });
      }
      setConfirmAction(null);
      await fetchArchived();
      onRestored?.();
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err?.message || 'Operation failed.',
      });
      setConfirmAction(null);
    } finally {
      setProcessing(false);
    }
  };

  const renderRetentionBadge = (rec: any) => {
    const state = rec.retentionState || 'ACTIVE_RETENTION';
    if (state === 'EXEMPT') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700"
          title={rec.retentionRule}
        >
          <ShieldCheck className="w-3 h-3" />
          BIR Exempt (10y)
        </span>
      );
    }
    if (state === 'BLOCKED') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700"
          title={rec.retentionRule}
        >
          <Lock className="w-3 h-3" />
          Blocked ({rec.dependencyCount || 1} dep)
        </span>
      );
    }
    if (state === 'ELIGIBLE_FOR_PURGE') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-700"
          title={rec.retentionRule}
        >
          <Clock className="w-3 h-3" />
          Expired (Purge Ready)
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
        title={rec.retentionRule}
      >
        <Clock className="w-3 h-3" />
        {rec.daysRemaining}d left
      </span>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        data-testid={`module-archive-inbox-btn-${entityTypes[0]?.toLowerCase() || 'module'}`}
        className={`px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 border border-slate-300 dark:border-slate-700 shadow-2xs ${className}`}
        title={`Open ${moduleTitle} Archive Inbox (30-day retention & restore)`}
      >
        <Archive className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <span>{buttonLabel}</span>
        {count > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-purple-600 text-white leading-none">
            {count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[99990] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl max-w-6xl w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/90">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-600 text-white rounded-xl shadow-xs">
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {moduleTitle} — Dedicated Archive Inbox
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {description ||
                      'Module-scoped archive vault with 30-day retention tracking, dependency & BIR statutory protection, and state-preserving restoration.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchArchived}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close Archive Inbox"
                  className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl hover:bg-slate-200/60 transition-colors text-lg font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {/* Search & Retention State Filter Toolbar */}
              <TableFilterToolbar
                searchQuery={searchQuery}
                onSearchChange={(q) => {
                  setSearchQuery(q);
                  setPageIndex(0);
                }}
                searchPlaceholder="Search code, record ID, name, archived by, or reason..."
                sortOrder={sortOrder}
                onSortOrderChange={(ord) => {
                  setSortOrder(ord);
                  setPageIndex(0);
                }}
                datePeriod={datePeriod}
                onDatePeriodChange={(p) => {
                  setDatePeriod(p);
                  setPageIndex(0);
                }}
                fromDate={fromDate}
                toDate={toDate}
                onDateRangeChange={({ fromDate, toDate }) => {
                  setFromDate(fromDate);
                  setToDate(toDate);
                  setPageIndex(0);
                }}
                pageSize={pageSize}
                onPageSizeChange={(sz) => {
                  setPageSize(sz);
                  setPageIndex(0);
                }}
                totalCount={records.length}
                filteredCount={filteredRecords.length}
                onResetFilters={() => {
                  setSearchQuery('');
                  setSortOrder('DESC');
                  setDatePeriod('ALL');
                  setFromDate('');
                  setToDate('');
                  setRetentionFilter('ALL');
                  setPageSize(20);
                  setPageIndex(0);
                }}
              />

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Retention:</span>
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'ACTIVE_RETENTION', label: '30-Day Active' },
                  { id: 'ELIGIBLE_FOR_PURGE', label: 'Purge Ready' },
                  { id: 'BLOCKED', label: 'Blocked' },
                  { id: 'EXEMPT', label: 'BIR Exempt' },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setRetentionFilter(st.id);
                      setPageIndex(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      retentionFilter === st.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {banner && (
                <div
                  className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
                    banner.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  <span>{banner.message}</span>
                  <button type="button" onClick={() => setBanner(null)} className="underline">
                    Dismiss
                  </button>
                </div>
              )}

              {loading && records.length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-600" />
                  Loading archived records...
                </div>
              ) : filteredRecords.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-1">
                  <Archive className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                  <p className="font-semibold text-slate-600 dark:text-slate-300">
                    {records.length === 0
                      ? `No archived records in ${moduleTitle}.`
                      : 'No archived records match your current search or retention filter.'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Records archived from this module or its 360° Journey appear here for 30 calendar days and can be restored anytime.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[880px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 uppercase font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Reference / Original ID</th>
                        <th className="py-3 px-4">Record & Reason</th>
                        <th className="py-3 px-4">Pre-Archive State</th>
                        <th className="py-3 px-4">Archived By & When</th>
                        <th className="py-3 px-4">Retention & Protection</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paginatedRecords.map((rec: any) => (
                        <tr key={`${rec.entityType}-${rec.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono">
                            <div className="font-bold text-indigo-600 dark:text-indigo-400">{rec.code}</div>
                            <div className="text-[10px] text-slate-400" title={rec.id}>
                              {rec.entityType} · {String(rec.id || '').slice(0, 14)}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{rec.name}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{rec.archiveReason}</div>
                            {Array.isArray(rec.dependencySummary) && rec.dependencySummary.length > 0 && (
                              <div className="text-[10px] text-rose-600 dark:text-rose-400 mt-1">
                                Linked: {rec.dependencySummary.slice(0, 3).join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              {rec.previousStatus || 'DRAFT'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[11px] text-slate-600 dark:text-slate-300">
                            <div className="font-semibold">{rec.archivedBy}</div>
                            <div className="text-slate-400">
                              {rec.archivedAt ? new Date(rec.archivedAt).toLocaleString() : '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {renderRetentionBadge(rec)}
                            <div className="text-[10px] text-slate-400 mt-1 max-w-[200px] truncate" title={rec.retentionRule}>
                              {rec.retentionState === 'ACTIVE_RETENTION'
                                ? `Expires ${rec.archiveExpiresAt ? new Date(rec.archiveExpiresAt).toLocaleDateString() : 'in 30 days'}`
                                : rec.retentionRule}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                setJourneyTarget({
                                  entityType: rec.entityType,
                                  entityId: rec.id,
                                  title: `${rec.code} — ${rec.name}`,
                                })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 inline-flex items-center gap-1"
                              title="Inspect 360° Record Journey"
                            >
                              <Activity className="w-3 h-3" />
                              360°
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmAction({
                                  type: 'restore',
                                  entityType: rec.entityType,
                                  id: rec.id,
                                  name: `${rec.code} (${rec.name})`,
                                  previousStatus: rec.previousStatus,
                                })
                              }
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-2xs inline-flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Restore
                            </button>
                            {rec.canPermanentDelete ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmAction({
                                    type: 'purge',
                                    entityType: rec.entityType,
                                    id: rec.id,
                                    name: `${rec.code} (${rec.name})`,
                                  })
                                }
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-2xs inline-flex items-center gap-1"
                                title="Permanently purge eligible record with zero dependencies"
                              >
                                <Trash2 className="w-3 h-3" />
                                Purge
                              </button>
                            ) : (
                              <span
                                className="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[10px] inline-flex items-center gap-1"
                                title={rec.retentionRule || 'Protected from permanent deletion'}
                              >
                                <Lock className="w-3 h-3" />
                                Protected
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <PaginationControls
                totalCount={filteredRecords.length}
                itemCount={paginatedRecords.length}
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[20, 50, 100]}
                hasNextPage={(pageIndex + 1) * pageSize < filteredRecords.length}
                onNextPage={() => setPageIndex((p) => p + 1)}
                onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
                onFirstPage={() => setPageIndex(0)}
                onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredRecords.length / pageSize) - 1))}
                onPageSizeChange={(newSize) => {
                  setPageSize(newSize);
                  setPageIndex(0);
                }}
              />

              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Authoritative Lifecycle Policy: Restoring returns the record to its exact pre-archive status ({'POSTED'}, {'APPROVED'}, {'ACTIVE'}, or {'DRAFT'}) with full audit trail continuity. Records with active accounting dependencies or BIR 10-year statutory retention (RR 17-2013 / RR 5-2014) are permanently protected from purge.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <AlertTriangle
                className={`w-5 h-5 ${confirmAction.type === 'purge' ? 'text-rose-600' : 'text-emerald-600'}`}
              />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {confirmAction.type === 'restore' ? 'Restore Archived Record' : 'Permanently Delete Record'}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {confirmAction.type === 'restore'
                ? `Restore "${confirmAction.name}" back to active operational records (${confirmAction.previousStatus || 'previous status'})? All historical transactions and audit trails remain intact.`
                : `Permanently delete "${confirmAction.name}" from the database? This action cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={processing}
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={executeConfirmedAction}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm ${
                  confirmAction.type === 'purge' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {processing
                  ? 'Processing...'
                  : confirmAction.type === 'restore'
                  ? 'Confirm Restore'
                  : 'Confirm Permanent Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={() => {
            fetchArchived();
            onRestored?.();
          }}
        />
      )}
    </>
  );
}
