import React, { useEffect, useState, useMemo } from 'react';
import {
  Archive,
  Search,
  RefreshCw,
  ShieldCheck,
  Trash2,
  RotateCcw,
  Filter,
  AlertTriangle,
  Activity,
  Clock,
  Lock,
  Play,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/apiClient';
import RecordActivityModal from '../components/RecordActivityModal';
import TableFilterToolbar, {
  DatePeriodFilter,
  computePeriodDates,
  SortOrderDirection,
} from '../components/shared/TableFilterToolbar';
import { PaginationControls } from '../components/PaginationControls';

export default function ArchiveVaultWorkspace() {
  const { activeCompany } = useAuth();
  const [records, setRecords] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [scheduler, setScheduler] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [runningSweep, setRunningSweep] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModuleFilter, setSelectedModuleFilter] = useState('ALL');
  const [selectedEntityFilter, setSelectedEntityFilter] = useState('ALL');
  const [selectedRetentionFilter, setSelectedRetentionFilter] = useState('ALL');
  const [archivedByFilter, setArchivedByFilter] = useState('');
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
  const [processingAction, setProcessingAction] = useState(false);
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  const fetchArchivedRecords = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/api/system/archived-records');
      setRecords(Array.isArray(res?.records) ? res.records : []);
      setSummary(res?.summary || null);
      setScheduler(res?.scheduler || null);
    } catch (err: any) {
      console.error('Failed to load system-wide archived records', err);
      setBanner({ type: 'error', message: err?.message || 'Failed to load archived records.' });
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchivedRecords();
  }, [activeCompany?.id]);

  const handleRunRetentionSweep = async () => {
    setRunningSweep(true);
    setBanner(null);
    try {
      const res = await apiFetch<any>('/api/system/archived-records/run-retention-sweep', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false }),
      });
      const s = res?.summary;
      setScheduler(res?.scheduler || scheduler);
      setBanner({
        type: 'success',
        message: `30-Day Retention Sweep completed: ${s?.evaluated ?? 0} evaluated, ${s?.purgedCount ?? 0} purged, ${s?.blockedCount ?? 0} dependency-blocked, ${s?.exemptCount ?? 0} BIR-exempt.`,
      });
      await fetchArchivedRecords();
    } catch (err: any) {
      setBanner({ type: 'error', message: err?.message || 'Failed to run retention sweep.' });
    } finally {
      setRunningSweep(false);
    }
  };

  const handleRestore = (entityType: string, id: string, name: string, previousStatus?: string) => {
    setBanner(null);
    setConfirmAction({ type: 'restore', entityType, id, name, previousStatus });
  };

  const handlePermanentDelete = (entityType: string, id: string, name: string) => {
    setBanner(null);
    setConfirmAction({ type: 'purge', entityType, id, name });
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    const { type, entityType, id, name } = confirmAction;
    setProcessingAction(true);
    setBanner(null);
    try {
      if (type === 'restore') {
        const res = await apiFetch<any>(`/api/system/archived-records/${entityType}/${id}/restore`, {
          method: 'PATCH',
        });
        setBanner({ type: 'success', message: res.message || `Record "${name}" restored successfully.` });
        await fetchArchivedRecords();
        window.dispatchEvent(new CustomEvent('coa:updated'));
      } else {
        const res = await apiFetch<any>(`/api/system/archived-records/${entityType}/${id}/permanent`, {
          method: 'DELETE',
        });
        setBanner({ type: 'success', message: res.message || `Record "${name}" permanently deleted.` });
        await fetchArchivedRecords();
      }
      setConfirmAction(null);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: type === 'restore'
          ? `Failed to restore record: ${err.message}`
          : `Failed to delete record: ${err.message}`,
      });
      setConfirmAction(null);
    } finally {
      setProcessingAction(false);
    }
  };

  const modulesList = useMemo(() => {
    const set = new Set(records.map((r) => r.module).filter(Boolean));
    return ['ALL', ...Array.from(set)];
  }, [records]);

  const entityTypesList = useMemo(() => {
    const set = new Set(records.map((r) => r.entityType).filter(Boolean));
    return ['ALL', ...Array.from(set).sort()];
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const byQ = archivedByFilter.trim().toLowerCase();
    const dateRange = datePeriod === 'CUSTOM'
      ? { fromDate, toDate }
      : computePeriodDates(datePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;

    const list = records.filter((r) => {
      const matchesSearch =
        !q ||
        (r?.id || '').toLowerCase().includes(q) ||
        (r?.code || '').toLowerCase().includes(q) ||
        (r?.name || '').toLowerCase().includes(q) ||
        (r?.entityType || '').toLowerCase().includes(q) ||
        (r?.archiveReason || '').toLowerCase().includes(q);
      const matchesModule = selectedModuleFilter === 'ALL' || r?.module === selectedModuleFilter;
      const matchesEntity = selectedEntityFilter === 'ALL' || r?.entityType === selectedEntityFilter;
      const matchesRetention =
        selectedRetentionFilter === 'ALL' || (r?.retentionState || 'ACTIVE_RETENTION') === selectedRetentionFilter;
      const matchesArchivedBy = !byQ || (r?.archivedBy || '').toLowerCase().includes(byQ);

      const archDate = (r?.archivedAt || '').slice(0, 10);
      if (from && archDate && archDate < from) return false;
      if (to && archDate && archDate > to) return false;

      return matchesSearch && matchesModule && matchesEntity && matchesRetention && matchesArchivedBy;
    });

    return list.sort((a, b) => {
      const dateA = a?.archivedAt || '';
      const dateB = b?.archivedAt || '';
      if (sortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [records, searchQuery, selectedModuleFilter, selectedEntityFilter, selectedRetentionFilter, archivedByFilter, datePeriod, fromDate, toDate, sortOrder]);

  const paginatedRecords = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, pageIndex, pageSize]);

  const renderRetentionBadge = (r: any) => {
    const state = r.retentionState || 'ACTIVE_RETENTION';
    if (state === 'EXEMPT') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700"
          title={r.retentionRule}
        >
          <ShieldCheck className="w-3 h-3" /> BIR Exempt (10y)
        </span>
      );
    }
    if (state === 'BLOCKED') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700"
          title={r.retentionRule}
        >
          <Lock className="w-3 h-3" /> Blocked ({r.dependencyCount || 1} dep)
        </span>
      );
    }
    if (state === 'ELIGIBLE_FOR_PURGE') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-700"
          title={r.retentionRule}
        >
          <Clock className="w-3 h-3" /> Expired (Purge Ready)
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
        title={r.retentionRule}
      >
        <Clock className="w-3 h-3" /> {r.daysRemaining}d left (30-day)
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Archive className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            System Archive Vault & 30-Day Retention Center
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Centralized cross-module governance repository for all 29 archive-enabled entity types. Protected by independent 30-day backend retention scheduler and BIR 10-year statutory immutability rules.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleRunRetentionSweep}
            disabled={runningSweep}
            className="px-3.5 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition-colors flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
            title="Execute the 30-day retention sweep for this company now (never deletes BIR-exempt or dependency-blocked records)"
          >
            <Play className="w-3.5 h-3.5" />
            {runningSweep ? 'Running Sweep...' : 'Run 30-Day Retention Sweep'}
          </button>
          <button
            type="button"
            onClick={fetchArchivedRecords}
            className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Vault
          </button>
        </div>
      </div>

      {/* Live Retention Policy & Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-slate-400 uppercase">Total Archived</div>
          <div className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">{summary?.total ?? records.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-amber-600 uppercase">30-Day Active</div>
          <div className="text-xl font-black text-amber-700 dark:text-amber-400 mt-1">{summary?.activeRetention ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-orange-600 uppercase">Purge Ready (&gt;30d)</div>
          <div className="text-xl font-black text-orange-700 dark:text-orange-400 mt-1">{summary?.eligibleForPurge ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-rose-600 uppercase">Dependency Blocked</div>
          <div className="text-xl font-black text-rose-700 dark:text-rose-400 mt-1">{summary?.blocked ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-emerald-600 uppercase">BIR 10-Yr Exempt</div>
          <div className="text-xl font-black text-emerald-700 dark:text-emerald-400 mt-1">{summary?.exempt ?? 0}</div>
        </div>
      </div>

      {scheduler && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Independent Backend Retention Scheduler: {scheduler.schedulerActive ? 'RUNNING' : 'ON-DEMAND'} · {scheduler.retentionDays}-day window · Sweep interval every {scheduler.intervalHours}h
          </span>
          <span className="text-slate-400">
            Last Sweep: {scheduler.companySummary?.ranAt
              ? new Date(scheduler.companySummary.ranAt).toLocaleString()
              : scheduler.lastGlobalSweepAt
              ? new Date(scheduler.lastGlobalSweepAt).toLocaleString()
              : 'Pending first cycle'}
          </span>
        </div>
      )}

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
            banner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{banner.message}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-[11px] font-bold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <TableFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPageIndex(0);
        }}
        searchPlaceholder="Search code, ID, name, reason..."
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
        entityLabel="Entity Type"
        selectedEntityId={selectedEntityFilter}
        onEntityChange={(val) => {
          setSelectedEntityFilter(val);
          setPageIndex(0);
        }}
        entityOptions={entityTypesList.map((et) => ({ label: et === 'ALL' ? 'All Entity Types' : et, value: et }))}
        productLabel="Module"
        selectedProductId={selectedModuleFilter}
        onProductChange={(val) => {
          setSelectedModuleFilter(val);
          setPageIndex(0);
        }}
        productOptions={modulesList.map((m) => ({ label: m === 'ALL' ? 'All Modules' : m, value: m }))}
        pageSize={pageSize}
        onPageSizeChange={(sz) => {
          setPageSize(sz);
          setPageIndex(0);
        }}
        totalCount={records.length}
        filteredCount={filteredRecords.length}
        onResetFilters={() => {
          setSearchQuery('');
          setSelectedModuleFilter('ALL');
          setSelectedEntityFilter('ALL');
          setSelectedRetentionFilter('ALL');
          setArchivedByFilter('');
          setSortOrder('DESC');
          setDatePeriod('ALL');
          setFromDate('');
          setToDate('');
          setPageSize(20);
          setPageIndex(0);
        }}
      />

      <div className="flex items-center gap-2 overflow-x-auto px-1 text-xs">
        <span className="font-semibold text-slate-500 dark:text-slate-400 shrink-0">Retention State:</span>
        {[
          { id: 'ALL', label: 'All States' },
          { id: 'ACTIVE_RETENTION', label: 'Active 30-Day' },
          { id: 'ELIGIBLE_FOR_PURGE', label: 'Eligible for Purge' },
          { id: 'BLOCKED', label: 'Blocked' },
          { id: 'EXEMPT', label: 'BIR Exempt' },
        ].map((ret) => (
          <button
            key={ret.id}
            type="button"
            onClick={() => {
              setSelectedRetentionFilter(ret.id);
              setPageIndex(0);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
              selectedRetentionFilter === ret.id
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            {ret.label}
          </button>
        ))}
      </div>

      {/* Table List */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading archived records across all modules...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-16 text-center text-slate-400 space-y-2">
            <Archive className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">
              {records.length === 0
                ? 'No archived records found in the system.'
                : 'No archived records match your current filters.'}
            </p>
            <p className="text-xs text-slate-400">
              Records archived via any module or 360° Journey appear here and in their dedicated Module Archive Inbox.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[1080px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider font-bold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Identifier / Original ID</th>
                  <th className="py-3.5 px-4">Record & Reason</th>
                  <th className="py-3.5 px-4">Source Module</th>
                  <th className="py-3.5 px-4">Pre-Archive State</th>
                  <th className="py-3.5 px-4">Archived By & Date</th>
                  <th className="py-3.5 px-4">Retention & Protection</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {paginatedRecords.map((r) => (
                  <tr key={`${r.entityType}-${r.id}`} className="hover:bg-purple-50/30 dark:hover:bg-slate-700/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono">
                      <div className="font-bold text-indigo-600 dark:text-indigo-400">{r.code}</div>
                      <div className="text-[10px] text-slate-400" title={r.id}>
                        {r.entityType} · {String(r.id || '').slice(0, 14)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.archiveReason || 'Moved to Archive Inbox'}</div>
                      {Array.isArray(r.dependencySummary) && r.dependencySummary.length > 0 && (
                        <div className="text-[10px] text-rose-600 dark:text-rose-400 mt-1">
                          Dependencies: {r.dependencySummary.slice(0, 3).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">
                      {r.module}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                        {r.previousStatus || 'DRAFT'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-[11px]">
                      <div className="font-semibold text-slate-700 dark:text-slate-200">{r.archivedBy || 'System User'}</div>
                      <div className="text-slate-400">{r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '—'}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      {renderRetentionBadge(r)}
                      <div className="text-[10px] text-slate-400 mt-1 max-w-[200px] truncate" title={r.retentionRule}>
                        {r.retentionState === 'ACTIVE_RETENTION'
                          ? `Expires ${r.archiveExpiresAt ? new Date(r.archiveExpiresAt).toLocaleDateString() : 'in 30 days'}`
                          : r.retentionRule}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setJourneyTarget({
                            entityType: r.entityType,
                            entityId: r.id,
                            title: `${r.code} — ${r.name}`,
                          })
                        }
                        className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 inline-flex items-center gap-1"
                        title="Open 360° Record Journey"
                      >
                        <Activity className="w-3.5 h-3.5" /> 360°
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRestore(r.entityType, r.id, r.name, r.previousStatus)}
                        className="px-3 py-1.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 shadow-2xs inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Restore
                      </button>
                      {r.canPermanentDelete ? (
                        <button
                          type="button"
                          onClick={() => handlePermanentDelete(r.entityType, r.id, r.name)}
                          className="px-3 py-1.5 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 shadow-2xs inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Purge
                        </button>
                      ) : (
                        <span
                          className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-semibold rounded-lg text-[10px] inline-flex items-center gap-1"
                          title={r.retentionRule || 'Protected by statutory retention or accounting dependencies'}
                        >
                          <Lock className="w-3 h-3" /> {r.retentionState === 'BLOCKED' ? 'Blocked' : 'BIR Retained'}
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
      </div>

      {confirmAction && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-xl shrink-0 ${confirmAction.type === 'purge' ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'}`}>
                {confirmAction.type === 'purge' ? <AlertTriangle className="w-5 h-5" /> : <RotateCcw className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {confirmAction.type === 'restore' ? 'Restore Archived Record' : 'Permanently Purge Record'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  {confirmAction.type === 'restore'
                    ? `Restore "${confirmAction.name}" back to its active operational register (${confirmAction.previousStatus || 'previous status'})?`
                    : `Permanently delete "${confirmAction.name}" from the archive vault? This action cannot be undone.`}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={processingAction}
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processingAction}
                onClick={executeConfirmedAction}
                className={`px-4 py-2 text-xs font-bold text-white rounded-lg shadow-2xs disabled:opacity-50 ${
                  confirmAction.type === 'purge' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {processingAction ? 'Processing...' : confirmAction.type === 'restore' ? 'Confirm Restore' : 'Confirm Purge'}
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
          onActionSuccess={fetchArchivedRecords}
        />
      )}
    </div>
  );
}
