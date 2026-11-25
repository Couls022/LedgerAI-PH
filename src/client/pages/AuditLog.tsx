import React, { useEffect, useState } from 'react';
import { 
  Filter, Download, ShieldCheck, RefreshCw, Radio, Search, Eye, X, 
  Calendar, User, Building2, FileText, CheckCircle2, AlertTriangle, 
  Key, ArrowRight, FileCheck, Users, Database, Layers, ShieldAlert,
  Hash, Lock, FileSpreadsheet, Sparkles, Clock, Globe, ArrowUpRight
} from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { PaginationControls } from '../components/PaginationControls';
import TableRecencyFilterBadge from '../components/shared/TableRecencyFilterBadge';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter } from '../components/shared/TableFilterToolbar';
import { getRecentOneMonthRange } from '../utils/dateFilterUtils';
import { TableScrollContainer, TableDensity } from '../components/shared/TableScrollContainer';
import { exportAuditTrailToPDF } from '../utils/exportUtils';
import RecordActivityModal from '../components/RecordActivityModal';
import { Activity } from 'lucide-react';

interface AuditLogEntry {
  id: string;
  companyId: string;
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  role?: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  recordReference?: string;
  beforeData?: string | null;
  afterData?: string | null;
  changedFields?: string | null;
  changedFieldsList?: string[];
  reason?: string;
  result: 'SUCCESS' | 'FAILED' | 'WARNING';
  severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  source: string;
  module: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  metadata?: string;
  timestamp: string | Date;
  integrityHash?: string;
}

export default function AuditLog() {
  const { activeCompany, user, userRole, isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [verifyState, setVerifyState] = useState<{
    loading: boolean;
    verified?: boolean;
    status?: string;
    hash?: string;
    expectedSeal?: string | null;
    reason?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!selectedLog) {
      setVerifyState(null);
      return;
    }
    let cancelled = false;
    setVerifyState({ loading: true });
    fetch(`/api/audit/verify/${encodeURIComponent(selectedLog.id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setVerifyState({
            loading: false,
            verified: Boolean(data.verified),
            status: data.status || (data.verified ? 'TAMPER_FREE_VERIFIED' : 'TAMPERED_DETECTED'),
            hash: data.hash,
            expectedSeal: data.expectedSeal ?? null,
            reason: data.reason ?? null,
          });
        } else {
          setVerifyState({
            loading: false,
            verified: false,
            status: data.error || 'VERIFICATION_FAILED',
            reason: data.message || 'Unable to verify audit seal',
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVerifyState({
            loading: false,
            verified: false,
            status: 'VERIFICATION_FAILED',
            reason: 'Network error while verifying seal',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLog?.id]);

  // PDF Export State
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfScope, setPdfScope] = useState<'filtered' | 'all'>('filtered');
  const [pdfNotes, setPdfNotes] = useState('');
  const [pdfSuccessMessage, setPdfSuccessMessage] = useState<string | null>(null);

  // Search & Filter State
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [result, setResult] = useState('');
  const [severity, setSeverity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Pagination & Density State (Default 20 per page, configurable)
  const [pageSize, setPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [dateFilterMode, setDateFilterMode] = useState<'RECENT_1_MONTH' | 'ALL'>('ALL');
  const [density, setDensity] = useState<TableDensity>('comfortable');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<{ ALL: number; FILES: number; COMPANY: number; USERS: number; ACCOUNTING: number }>({
    ALL: 0,
    FILES: 0,
    COMPANY: 0,
    USERS: 0,
    ACCOUNTING: 0,
  });
  const [journeyRecord, setJourneyRecord] = useState<{ entityType: string; entityId: string; initialTab?: 'overview' | 'details' | 'activity' | 'approvals' | 'changes' | 'related' | 'documents' | 'audit' } | null>(null);

  const { notifications, isConnected } = useNotifications();

  const fetchLogs = async (cursor?: string | null, customLimit?: number) => {
    try {
      setLoading(true);
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const activeLimit = customLimit || pageSize;
      const query = new URLSearchParams();
      query.set('limit', String(activeLimit));
      if (activeCurr) query.set('cursor', activeCurr);
      if (search) query.append('search', search);
      if (action) query.append('action', action);
      if (entityType) query.append('entityType', entityType);
      if (result) query.append('result', result);
      if (severity) query.append('severity', severity);
      if (dateFrom) {
        query.append('dateFrom', dateFrom);
      } else if (dateFilterMode === 'RECENT_1_MONTH') {
        const range = getRecentOneMonthRange();
        query.append('dateFrom', range.fromDate);
      }
      if (dateTo) query.append('dateTo', dateTo);

      if (categoryFilter && categoryFilter !== 'ALL') {
        query.append('category', categoryFilter);
      }

      const res = await fetch(`/api/audit?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLogs(data);
          setPaginationMeta(null);
        } else {
          setLogs(data.data || []);
          setPaginationMeta(data.pagination || null);
          if (data.categoryCounts) {
            setCategoryCounts(data.categoryCounts);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    fetchLogs(null);
  }, [activeCompany?.id, categoryFilter, action, entityType, result, severity, dateFrom, dateTo, dateFilterMode]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      fetchLogs(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevCursor = cursorStack[cursorStack.length - 1];
      setCursorStack(prev => prev.slice(0, -1));
      setCurrentCursor(prevCursor || null);
      fetchLogs(prevCursor || null);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCursorStack([]);
    setCurrentCursor(null);
    fetchLogs(null, newSize);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCursorStack([]);
    setCurrentCursor(null);
    fetchLogs(null);
  };

  const handleDownloadPdf = async (scope: 'filtered' | 'all' = pdfScope) => {
    try {
      setIsExportingPdf(true);
      setPdfSuccessMessage(null);

      const query = new URLSearchParams();
      if (scope === 'filtered') {
        if (search) query.append('search', search);
        if (action) query.append('action', action);
        if (entityType) query.append('entityType', entityType);
        if (result) query.append('result', result);
        if (severity) query.append('severity', severity);
        if (dateFrom) query.append('dateFrom', dateFrom);
        if (dateTo) query.append('dateTo', dateTo);
        if (categoryFilter && categoryFilter !== 'ALL') {
          query.append('category', categoryFilter);
        }
      }
      if (pdfNotes) query.append('notes', pdfNotes);
      query.append('limit', scope === 'all' ? '10000' : '5000');

      const exportUrl = `/api/audit/export/pdf?${query.toString()}`;
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Audit_Trail_Report_${(activeCompany?.legalName || 'Company').replace(/[^A-Za-z0-9_-]/g, '_')}_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setPdfSuccessMessage('Audit Trail PDF downloaded successfully.');
      setTimeout(() => {
        setPdfModalOpen(false);
        setPdfSuccessMessage(null);
      }, 1500);
    } catch (err) {
      console.error('PDF export fallback triggered:', err);
      // Client-side fallback
      exportAuditTrailToPDF({
        companyName: activeCompany?.legalName || 'Company Profile',
        tin: activeCompany?.tin || '000-000-000-000',
        rdoCode: (activeCompany as any)?.rdoCode || '039',
        tenantId: activeCompany?.id,
        exportedBy: user?.displayName || user?.email || 'Administrator',
        userRole: userRole || 'Company Administrator',
        dateRange: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : (dateFrom ? `From ${dateFrom}` : (dateTo ? `Until ${dateTo}` : 'Inception to Present')),
        notes: pdfNotes,
        logs: logs,
      });
      setPdfSuccessMessage('Audit Trail PDF generated and saved.');
      setTimeout(() => {
        setPdfModalOpen(false);
        setPdfSuccessMessage(null);
      }, 1500);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Live WebSocket updates
  useEffect(() => {
    if (notifications.length > 0) {
      const latest = notifications[0];
      if (latest.type === 'AUDIT_LOG' || latest.type === 'DOCUMENT_UPLOAD' || latest.type === 'JOURNAL_CREATED') {
        fetchLogs();
      }
    }
  }, [notifications]);

  const formatTimestamp = (ts: any) => {
    try {
      if (!ts) return 'N/A';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return 'N/A';
      // Guard against potential epoch unit mismatch
      if (d.getFullYear() > 3000) {
        return new Date(Math.floor(d.getTime() / 1000)).toLocaleString('en-US', {
          timeZone: 'Asia/Manila',
          month: 'short',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      }
      return d.toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return String(ts);
    }
  };

  const parseJsonSafe = (str?: string | null) => {
    if (!str) return null;
    if (typeof str === 'object') return str;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

  const getActionBadgeColor = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('DELETE') || act.includes('REMOVE') || act.includes('TERMINATE')) {
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (act.includes('CREATE') || act.includes('UPLOAD') || act.includes('POST')) {
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (act.includes('UPDATE') || act.includes('MODIFY') || act.includes('EDIT')) {
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    if (act.includes('AUTH') || act.includes('LOGIN') || act.includes('SECURITY')) {
      return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
    }
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  const getRoleBadgeStyle = (role?: string) => {
    const r = (role || '').toUpperCase();
    if (r.includes('ADMIN') || r.includes('OWNER')) {
      return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300 dark:border-purple-800';
    }
    if (r.includes('ACCOUNTANT')) {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800';
    }
    if (r.includes('AUDITOR')) {
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
    }
    if (r.includes('BOOKKEEPER')) {
      return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-300 dark:border-cyan-800';
    }
    if (r.includes('SYSTEM')) {
      return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700';
    }
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  const renderFieldDiffs = (log: AuditLogEntry) => {
    const before = parseJsonSafe(log.beforeData);
    const after = parseJsonSafe(log.afterData);

    if (!before && !after) {
      return <p className="text-slate-400 italic text-xs">No state payload recorded for this event.</p>;
    }

    if (before && !after) {
      return (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Deleted Record State:
          </p>
          <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800">
            {JSON.stringify(before, null, 2)}
          </pre>
        </div>
      );
    }

    if (!before && after) {
      return (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Initial Created State:
          </p>
          <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800">
            {JSON.stringify(after, null, 2)}
          </pre>
        </div>
      );
    }

    // Both before and after exist -> Compare keys
    const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
    const diffKeys = allKeys.filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

    if (diffKeys.length === 0) {
      return (
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
          No field discrepancies detected between snapshots.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Field-by-Field Modifications ({diffKeys.length} changed)
          </span>
          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">
            Red = Previous Value → Green = Modified Value
          </span>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
          {diffKeys.map((key) => {
            const valBefore = before[key];
            const valAfter = after[key];
            return (
              <div key={key} className="p-3 grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
                <div className="md:col-span-3 font-mono font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {key}
                </div>
                <div className="md:col-span-4 bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 p-2 rounded-lg text-rose-800 dark:text-rose-300 font-mono break-all">
                  <span className="text-[10px] uppercase font-bold text-rose-500 block mb-0.5">Previous (Before)</span>
                  {valBefore === undefined ? <span className="italic text-rose-400">undefined</span> : typeof valBefore === 'object' ? JSON.stringify(valBefore) : String(valBefore)}
                </div>
                <div className="md:col-span-1 flex items-center justify-center text-slate-400">
                  <ArrowRight className="w-4 h-4 hidden md:block" />
                </div>
                <div className="md:col-span-4 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 p-2 rounded-lg text-emerald-800 dark:text-emerald-300 font-mono break-all">
                  <span className="text-[10px] uppercase font-bold text-emerald-500 block mb-0.5">Modified (After)</span>
                  {valAfter === undefined ? <span className="italic text-emerald-400">undefined</span> : typeof valAfter === 'object' ? JSON.stringify(valAfter) : String(valAfter)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const sortedLogs = React.useMemo(() => {
    return [...logs].sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return sortOrder === 'DESC' ? tB - tA : tA - tB;
    });
  }, [logs, sortOrder]);

  return (
    <div className="w-full space-y-6 pb-16">
      
      {/* Active Company Isolation Guard Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 rounded-2xl border border-indigo-500/30 shadow-lg relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Tenant Isolated Audit Scope
              </span>
              <span className="text-xs text-slate-400">• Philippine Standard BIR CAS / RR 9-2009 Compliant</span>
            </div>
            <h2 className="text-lg md:text-xl font-bold flex items-center gap-2 text-white">
              <Building2 className="w-5 h-5 text-indigo-400" />
              Company: {activeCompany?.legalName || 'Active Company Profile'}
            </h2>
            <p className="text-xs text-slate-300">
              Company ID: <span className="font-mono text-indigo-300">{activeCompany?.id || 'N/A'}</span> | TIN: <span className="font-mono text-slate-200">{activeCompany?.tin || '000-000-000-000'}</span> | Every record is cryptographic & strictly bound to this profile only.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button 
              onClick={() => fetchLogs()}
              className="bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} /> Refresh
            </button>

            <button 
              onClick={() => setPdfModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-colors"
              title="Download official secure PDF audit trail report with compliance seal"
            >
              <Download className="w-3.5 h-3.5" /> Download Audit Trail (PDF)
            </button>
            
            <button 
              onClick={async () => {
                // Official BIR CAS Compliant CSV Export via Backend API
                const query = new URLSearchParams();
                if (search) query.append('search', search);
                if (severity) query.append('severity', severity);
                if (result) query.append('result', result);
                if (dateFrom) query.append('dateFrom', dateFrom);
                if (dateTo) query.append('dateTo', dateTo);

                try {
                  const res = await fetch(`/api/audit/export/bir-cas?${query.toString()}`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BIR_CAS_AuditTrail_${(activeCompany?.legalName || 'Company').replace(/[^A-Za-z0-9_-]/g, '_')}_${Date.now()}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch {
                  window.location.href = `/api/audit/export/bir-cas?${query.toString()}`;
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-colors"
              title="Download Philippine BIR CAS RR 9-2009 compliant CSV audit trail report"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> BIR CAS CSV
            </button>
          </div>
        </div>
      </div>

      {/* Category Quick Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setCategoryFilter('ALL')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            categoryFilter === 'ALL'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Layers className="w-4 h-4" /> All Activities ({categoryCounts.ALL || paginationMeta?.totalCount || logs.length})
        </button>

        <button
          onClick={() => setCategoryFilter('FILES')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            categoryFilter === 'FILES'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <FileText className="w-4 h-4 text-amber-500" /> Files & Documents ({categoryCounts.FILES})
        </button>

        <button
          onClick={() => setCategoryFilter('COMPANY')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            categoryFilter === 'COMPANY'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Building2 className="w-4 h-4 text-blue-500" /> Company Profile & Tax Settings ({categoryCounts.COMPANY})
        </button>

        <button
          onClick={() => setCategoryFilter('USERS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            categoryFilter === 'USERS'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Users className="w-4 h-4 text-purple-500" /> User & Role Modifications ({categoryCounts.USERS})
        </button>

        <button
          onClick={() => setCategoryFilter('ACCOUNTING')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            categoryFilter === 'ACCOUNTING'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Journal & Accounting ({categoryCounts.ACCOUNTING})
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search by User Name, Email, Role, Modified File, TIN, Action, or Reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            className="w-full md:w-auto px-5 py-2 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors"
          >
            Apply Filters
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-2 border-t border-slate-100 dark:border-slate-700/80">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Entity / Module</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="">All Entities</option>
              <option value="JOURNAL_ENTRY">Journal Entries (GL)</option>
              <option value="SALES_INVOICE">Sales Invoices (AR)</option>
              <option value="PURCHASE_BILL">Purchase Bills (AP)</option>
              <option value="CUSTOMER_PAYMENT">Customer Payments</option>
              <option value="SUPPLIER_PAYMENT">Supplier Payments</option>
              <option value="PURCHASE_REQUISITION">Purchase Requisitions</option>
              <option value="PURCHASE_ORDER">Purchase Orders</option>
              <option value="CASH_TRANSACTION">Cash & Banking</option>
              <option value="PAYROLL_RUN">Payroll Runs</option>
              <option value="FIXED_ASSET">Fixed Assets</option>
              <option value="TAX_FILING">BIR Tax Filings</option>
              <option value="BUDGET">Budgets</option>
              <option value="ACCOUNT">Chart of Accounts</option>
              <option value="DOCUMENT">Documents & OCR</option>
              <option value="COMPANY">Company Profile & Settings</option>
              <option value="MEMBERSHIP">User / Role / RBAC</option>
              <option value="PERIOD">Accounting Periods</option>
              <option value="BACKUP">Database Backups</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Outcome</label>
            <select
              value={result}
              onChange={(e) => setResult(e.target.value)}
              className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="">All Outcomes</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="WARNING">Warning</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="">All Severities</option>
              <option value="INFO">Info</option>
              <option value="WARN">Warning</option>
              <option value="ERROR">Error</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">From Date (PHT)</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">To Date (PHT)</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
            />
          </div>
          <div className="flex flex-col justify-end">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Quick Date Filter</label>
            <TableRecencyFilterBadge
              mode={dateFilterMode}
              onChange={(newMode) => {
                setDateFilterMode(newMode);
                setDateFrom('');
                setDateTo('');
                setCursorStack([]);
                setCurrentCursor(null);
              }}
              recordCount={paginationMeta?.totalCount ?? logs.length}
            />
          </div>
        </div>
      </div>

      {/* Unified Filter & Sort Toolbar */}
      <TableFilterToolbar
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => setSortOrder(ord)}
        datePeriod={datePeriod}
        onDatePeriodChange={(p) => setDatePeriod(p)}
        fromDate={dateFrom}
        toDate={dateTo}
        onDateRangeChange={({ fromDate: f, toDate: t }) => {
          setDateFrom(f);
          setDateTo(t);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        searchQuery={search}
        onSearchChange={(q) => {
          setSearch(q);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        searchPlaceholder="Search actor, action, entity, details, IP..."
        filteredCount={logs.length}
        totalCount={paginationMeta?.totalCount}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        onResetFilters={() => {
          setSortOrder('DESC');
          setDatePeriod('ALL');
          setDateFilterMode('ALL');
          setDateFrom('');
          setDateTo('');
          setSearch('');
          setCategoryFilter('ALL');
          setAction('');
          setEntityType('');
          setResult('');
          setSeverity('');
          setCursorStack([]);
          setCurrentCursor(null);
        }}
      />

      {/* Main Audit Trail Data Table */}
      <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
            <p className="text-xs font-semibold">Querying isolated audit ledger for {activeCompany?.legalName}...</p>
          </div>
        ) : (
          <TableScrollContainer
            title="System Audit & Security Trail"
            totalRecordsCount={paginationMeta?.totalCount ?? logs.length}
            density={density}
            onDensityChange={setDensity}
            footer={
              paginationMeta ? (
                <PaginationControls
                  totalCount={paginationMeta.totalCount}
                  itemCount={logs.length}
                  pageIndex={cursorStack.length}
                  pageSize={pageSize}
                  pageSizeOptions={[20, 50, 100]}
                  onPageSizeChange={handlePageSizeChange}
                  hasNextPage={paginationMeta.hasNextPage}
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  loading={loading}
                />
              ) : undefined
            }
          >
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[980px]">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-bold tracking-wider border-b border-slate-200 dark:border-slate-800 shadow-xs">
                <tr>
                  <th className="py-3.5 px-4 whitespace-nowrap">Date & Time (PHT)</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">User & Role (Who)</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Action Taken (What)</th>
                  <th className="py-3.5 px-4">Entity / Modified Target</th>
                  <th className="py-3.5 px-4">Modified Fields & Diffs</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">SHA-256 Seal</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Result</th>
                  <th className="py-3.5 px-5 text-right whitespace-nowrap min-w-[110px]">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans">
                {sortedLogs.map((log) => {
                  const changedFields = log.changedFieldsList || [];
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                      
                      {/* Timestamp */}
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{formatTimestamp(log.timestamp)}</span>
                        </div>
                      </td>

                      {/* Who: User Name, Email & Role */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                            {(log.userDisplayName || 'U')[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-1.5">
                              <span>{log.userDisplayName || 'Authorized User'}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {log.userEmail || 'System Automated'}
                            </div>
                            <div className="mt-1">
                              <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${getRoleBadgeStyle(log.role)}`}>
                                {log.role || 'Member'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* What: Action */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="space-y-1">
                          <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border ${getActionBadgeColor(log.action)}`}>
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Module: {log.module || log.entityType}
                          </div>
                        </div>
                      </td>

                      {/* Entity / Target */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5 max-w-[200px]">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate block" title={log.entityName || log.entityType}>
                            {log.entityName || log.entityType}
                          </span>
                          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-mono block truncate" title={log.recordReference || log.entityId}>
                            ID: {log.recordReference || log.entityId}
                          </span>
                        </div>
                      </td>

                      {/* What was modified (Changed fields pills) */}
                      <td className="py-3.5 px-4">
                        {changedFields.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {changedFields.slice(0, 3).map((f, i) => (
                              <span key={i} className="px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-[10px] font-mono font-medium">
                                {f}
                              </span>
                            ))}
                            {changedFields.length > 3 && (
                              <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-[10px] font-bold">
                                +{changedFields.length - 3} more
                              </span>
                            )}
                          </div>
                        ) : log.afterData ? (
                          <span className="text-[11px] text-slate-500 font-mono">Payload Recorded</span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No field mutations</span>
                        )}
                      </td>

                      {/* Cryptographic SHA-256 Hash Seal */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5" title={`Cryptographic SHA-256 Hash Seal: ${log.integrityHash}`}>
                          <span className="p-1 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </span>
                          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                            {log.integrityHash ? `${log.integrityHash.substring(0, 8)}...` : 'SEALED'}
                          </span>
                        </div>
                      </td>

                      {/* Outcome */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          log.result === 'FAILED' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' :
                          log.result === 'WARNING' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}>
                          {log.result}
                        </span>
                      </td>

                      {/* Action Button */}
                      <td className="py-3.5 px-5 text-right whitespace-nowrap min-w-[190px]">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/80 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 shadow-xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Inspect</span>
                          </button>
                          {log.entityType && log.entityId && (
                            <button
                              onClick={() =>
                                setJourneyRecord({
                                  entityType: (log as any).canonicalEntityType || log.entityType,
                                  entityId: log.entityId,
                                  initialTab: 'overview',
                                })
                              }
                              className="px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-1 border border-indigo-200 dark:border-indigo-800 shadow-xs"
                              title="Open 360° Record Journey"
                            >
                              <Activity className="w-3.5 h-3.5" />
                              <span>360°</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {logs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-400">
                      <ShieldCheck className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No audit records found matching the active filter.</p>
                      <p className="text-xs text-slate-400 mt-1">Actions performed in {activeCompany?.legalName} will automatically be logged here.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        )}
      </div>

      {/* Forensic Deep Dive Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                    Audit Event Details #{selectedLog.id}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                    <span>Company: {activeCompany?.legalName || selectedLog.companyId}</span>
                    <span>•</span>
                    <span>SHA-256 Hash: {selectedLog.integrityHash || 'VERIFIED'}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedLog(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-700 dark:text-slate-200">
              
              {/* Identity & Role Box (WHO) */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">User Identity (Who Modified)</p>
                  <p className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-1">
                    {selectedLog.userDisplayName || 'Authorized User'}
                  </p>
                  <p className="text-slate-500">{selectedLog.userEmail || 'No Email'}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold border ${getRoleBadgeStyle(selectedLog.role)}`}>
                      Role: {selectedLog.role || 'Member'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      UID: {selectedLog.userId || 'N/A'}
                    </span>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Action & Target Entity</p>
                  <div className="mt-1">
                    <span className={`inline-block px-2.5 py-1 rounded text-xs font-bold border ${getActionBadgeColor(selectedLog.action)}`}>
                      {selectedLog.action}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 mt-1">
                    Module: <span className="font-bold">{selectedLog.module || selectedLog.entityType}</span>
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
                    Target Reference: {selectedLog.recordReference || selectedLog.entityId}
                  </p>
                </div>
              </div>

              {/* Timestamp & Origin */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-100 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Timestamp (PHT)</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                    {formatTimestamp(selectedLog.timestamp)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">IP Address / Source</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 mt-0.5 block">
                    {selectedLog.ipAddress || '127.0.0.1 (Local)'} ({selectedLog.source})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Outcome Status</span>
                  <span className={`inline-block mt-0.5 px-2 py-0.5 rounded font-bold text-[11px] ${
                    selectedLog.result === 'FAILED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {selectedLog.result}
                  </span>
                </div>
              </div>

              {/* Cryptographic SHA-256 Seal Verification Card */}
              <div className={`p-4 rounded-xl border space-y-2 ${
                verifyState?.loading
                  ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700'
                  : verifyState?.verified
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 font-bold text-xs ${
                    verifyState?.loading
                      ? 'text-slate-600 dark:text-slate-300'
                      : verifyState?.verified
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-rose-700 dark:text-rose-300'
                  }`}>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Cryptographic Tamper-Evident SHA-256 Seal</span>
                  </div>
                  <span
                    data-testid="audit-seal-status-badge"
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                      verifyState?.loading
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                        : verifyState?.verified
                          ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                          : 'bg-rose-100 dark:bg-rose-900 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700'
                    }`}
                  >
                    {verifyState?.loading
                      ? 'VERIFYING...'
                      : verifyState?.verified
                        ? 'TAMPER_FREE_VERIFIED'
                        : verifyState?.status || 'TAMPERED_DETECTED'}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 select-all">
                  {verifyState?.expectedSeal || verifyState?.hash || selectedLog.integrityHash || 'NO_SEAL_RECORDED'}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  {verifyState?.reason
                    ? `Verification detail: ${verifyState.reason}. Standard: Philippine BIR CAS RR 9-2009 Non-Repudiation Spec.`
                    : 'Standard: Philippine BIR CAS RR 9-2009 Non-Repudiation Spec. Verified live against persisted SHA-256 integrity seal.'}
                </p>
              </div>

              {/* What was modified (Visual Diffs) */}
              <div>
                {renderFieldDiffs(selectedLog)}
              </div>

              {/* Metadata Context if available */}
              {selectedLog.metadata && (
                <div>
                  <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1 text-[10px]">Context Metadata:</span>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] overflow-x-auto max-h-40 border border-slate-800">
                    {typeof selectedLog.metadata === 'object' ? JSON.stringify(selectedLog.metadata, null, 2) : selectedLog.metadata}
                  </pre>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Immutable cryptographic record verified.</span>
              </div>
              <div className="flex items-center gap-2">
                {selectedLog.entityType && selectedLog.entityId && (
                  <button
                    onClick={() => {
                      const rec = {
                        entityType: (selectedLog as any).canonicalEntityType || selectedLog.entityType,
                        entityId: selectedLog.entityId,
                        initialTab: 'overview' as const,
                      };
                      setSelectedLog(null);
                      setJourneyRecord(rec);
                    }}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Open 360° Record Journey</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {journeyRecord && (
        <RecordActivityModal
          isOpen={!!journeyRecord}
          onClose={() => setJourneyRecord(null)}
          entityType={journeyRecord.entityType}
          entityId={journeyRecord.entityId}
          initialTab={journeyRecord.initialTab}
          onActionSuccess={() => fetchLogs()}
        />
      )}

      {/* PDF Export Compliance Modal */}
      {pdfModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-850 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-start justify-between border-b border-indigo-500/20">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-indigo-400" /> BIR CAS & PSA Compliance
                  </span>
                </div>
                <h3 className="text-xl font-bold flex items-center gap-2 text-white mt-1">
                  <Download className="w-5 h-5 text-indigo-400" />
                  Download Audit Trail Report (PDF)
                </h3>
                <p className="text-xs text-slate-300">
                  Export tamper-evident, cryptographically sealed activity history for statutory compliance and external audit inspection.
                </p>
              </div>
              <button
                onClick={() => setPdfModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

              {/* Taxpayer Information Summary */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Registered Taxpayer</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{activeCompany?.legalName || 'Active Entity'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">TIN / RDO</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{activeCompany?.tin || '000-000-000-000'} | RDO {(activeCompany as any)?.rdoCode || '039'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Compliance Standard</span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">BIR RR 9-2009 / PSA Non-Repudiation</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Authorized Administrator</span>
                    <span className="text-slate-700 dark:text-slate-300">{user?.displayName || user?.email || 'Admin'} ({userRole || 'Administrator'})</span>
                  </div>
                </div>
              </div>

              {/* Scope Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                  Export Scope
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label 
                    className={`p-3.5 rounded-xl border cursor-pointer flex items-start gap-3 transition-all ${
                      pdfScope === 'filtered'
                        ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pdfScope"
                      checked={pdfScope === 'filtered'}
                      onChange={() => setPdfScope('filtered')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Current Filtered View</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Exports {logs.length} matching events with active filters applied.
                      </span>
                    </div>
                  </label>

                  <label 
                    className={`p-3.5 rounded-xl border cursor-pointer flex items-start gap-3 transition-all ${
                      pdfScope === 'all'
                        ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pdfScope"
                      checked={pdfScope === 'all'}
                      onChange={() => setPdfScope('all')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Complete Historical Trail</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Exports all historical entries logged for this company profile.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Compliance Assurance Features Included */}
              <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800/60 text-xs space-y-1.5">
                <span className="font-bold text-emerald-800 dark:text-emerald-300 block">Included Report Security Features:</span>
                <ul className="text-[11px] text-emerald-700 dark:text-emerald-400 space-y-1 list-disc list-inside">
                  <li>Cryptographic SHA-256 tamper-evident hash seals for every activity log</li>
                  <li>Complete actor identification, privilege level, and Philippine Standard Time (PHT) timestamps</li>
                  <li>Module, modified target entity, and field state change summaries</li>
                  <li>Official BIR CAS RR 9-2009 verification header & certificate watermark</li>
                </ul>
              </div>

              {/* Optional Compliance / Auditor Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                  Auditor Remarks / Purpose Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., Annual Financial Audit FY 2026, BIR CAS Compliance Verification, Routine Inspection"
                  value={pdfNotes}
                  onChange={(e) => setPdfNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {pdfSuccessMessage && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{pdfSuccessMessage}</span>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-indigo-500" />
                <span>Encrypted & digitally formatted document</span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setPdfModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold transition-colors w-full sm:w-auto"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadPdf(pdfScope)}
                  disabled={isExportingPdf}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-colors w-full sm:w-auto"
                >
                  <Download className={`w-4 h-4 ${isExportingPdf ? 'animate-bounce' : ''}`} />
                  {isExportingPdf ? 'Generating PDF...' : 'Download PDF Report'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
