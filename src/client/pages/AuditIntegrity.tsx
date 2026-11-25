import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  RefreshCcw,
  AlertTriangle,
  Database,
  Lock,
  FileSearch,
  History,
  Download,
  ExternalLink,
  Layers,
  CheckCircle,
  XCircle,
  Info,
  Cpu,
  Clock,
  Hash,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getAuthToken } from '../utils/apiClient';
import RecordActivityModal from '../components/RecordActivityModal';
import TableFilterToolbar, { SortOrderDirection } from '../components/shared/TableFilterToolbar';
import { PaginationControls } from '../components/PaginationControls';

export default function AuditIntegrity() {
  const { activeCompany } = useAuth();
  const navigate = useNavigate();

  const [loadingOverview, setLoadingOverview] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [scanHistory, setScanHistory] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [pageSize, setPageSize] = useState(20);
  const [pageIndex, setPageIndex] = useState(0);
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({
    ACCOUNTING_INTEGRITY: true,
    RECORD_INTEGRITY: true,
    CRYPTOGRAPHIC_INTEGRITY: true,
  });

  // 360° Record Drill-Down Modal state
  const [selected360Target, setSelected360Target] = useState<{
    entityType: string;
    entityId: string;
    entityName: string;
  } | null>(null);

  const loadOverview = useCallback(async () => {
    if (!activeCompany?.id) return;
    setLoadingOverview(true);
    setError(null);
    try {
      const data = await apiFetch<any>('/api/audit/integrity/overview?limit=20');
      setOverview(data);
      if (data?.latestReport) {
        setReport(data.latestReport);
      } else {
        setReport(null);
      }
      setScanHistory(Array.isArray(data?.scanHistory) ? data.scanHistory : []);
    } catch (err: any) {
      setError(err.message || 'Unable to load cryptographic ledger integrity overview.');
    } finally {
      setLoadingOverview(false);
    }
  }, [activeCompany?.id]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const runIntegrityCheck = async () => {
    if (!activeCompany?.id || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const scanResult = await apiFetch<any>('/api/audit/integrity/scan', {
        method: 'POST',
      });
      setReport(scanResult);
      // Refresh history list
      const updatedOverview = await apiFetch<any>('/api/audit/integrity/overview?limit=20');
      setOverview(updatedOverview);
      setScanHistory(Array.isArray(updatedOverview?.scanHistory) ? updatedOverview.scanHistory : []);
    } catch (err: any) {
      setError(err.message || 'Failed to execute cryptographic ledger integrity scan.');
    } finally {
      setScanning(false);
    }
  };

  const handleSelectHistoricalScan = async (scanId: string) => {
    if (!activeCompany?.id) return;
    try {
      const historicalReport = await apiFetch<any>(`/api/audit/integrity/scans/${scanId}`);
      if (historicalReport) {
        setReport(historicalReport);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load historical scan report.');
    }
  };

  const handleExportReport = async (scanId: string, format: 'json' | 'csv') => {
    try {
      const token = getAuthToken() || '';
      const res = await fetch(`/api/audit/integrity/scans/${scanId}/export?format=${format}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(activeCompany?.id ? { 'X-Company-Id': activeCompany.id } : {}),
        },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LedgerAI_Integrity_Scan_${scanId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to export integrity report.');
    }
  };

  const toggleDomainExpand = (domainKey: string) => {
    setExpandedDomains((prev) => ({ ...prev, [domainKey]: !prev[domainKey] }));
  };

  const getSeverityBadgeClass = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800';
      case 'HIGH':
        return 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/70 dark:text-orange-200 dark:border-orange-800';
      case 'MEDIUM':
        return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800';
      case 'LOW':
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/70 dark:text-blue-200 dark:border-blue-800';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    }
  };

  const filteredFindings = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = (report?.findings || []).filter((f: any) => {
      if (severityFilter !== 'ALL' && f.severity !== severityFilter) return false;
      if (domainFilter !== 'ALL' && f.domain !== domainFilter) return false;
      if (!q) return true;
      const hay = `${f.checkName || ''} ${f.checkCode || ''} ${f.recordReference || ''} ${f.title || ''} ${f.description || ''} ${f.entityType || ''}`.toLowerCase();
      return hay.includes(q);
    });

    const severityWeight: Record<string, number> = {
      CRITICAL: 5,
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      INFORMATIONAL: 1,
    };

    return list.sort((a: any, b: any) => {
      const wA = severityWeight[a.severity] || 0;
      const wB = severityWeight[b.severity] || 0;
      if (sortOrder === 'ASC') {
        return wA - wB;
      }
      return wB - wA;
    });
  }, [report?.findings, severityFilter, domainFilter, searchQuery, sortOrder]);

  const paginatedFindings = React.useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredFindings.slice(start, start + pageSize);
  }, [filteredFindings, pageIndex, pageSize]);

  const companyName =
    report?.companyName ||
    overview?.companyName ||
    activeCompany?.legalName ||
    activeCompany?.tradeName ||
    'Active Company';
  const dbIdentity =
    report?.databaseIdentity ||
    overview?.databaseIdentity ||
    `company_${activeCompany?.id || 'default'}.lai`;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
              Cryptographic Ledger Integrity & Audit Verification
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <Cpu className="w-3.5 h-3.5" /> Offline Execution Ready
            </span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Three-domain local verification across Accounting Double-Entry Invariants, Relational Record Continuity, and SHA-256 / LAISDOC1 Cryptographic Seals.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {report?.scanId && (
            <>
              <button
                onClick={() => handleExportReport(report.scanId, 'json')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                title="Download Signed JSON Integrity Report"
              >
                <Download className="w-3.5 h-3.5 text-indigo-500" />
                Export JSON
              </button>
              <button
                onClick={() => handleExportReport(report.scanId, 'csv')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                title="Download CSV Findings Report"
              >
                <Download className="w-3.5 h-3.5 text-emerald-500" />
                Export CSV
              </button>
            </>
          )}
          <button
            onClick={runIntegrityCheck}
            disabled={scanning || !activeCompany}
            data-testid="run-integrity-scan-btn"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
          >
            <RefreshCcw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Running 3-Domain Scan...' : 'Run Integrity Scan'}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          data-testid="integrity-error-banner"
          className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Integrity Verification Notice</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
          <button
            onClick={loadOverview}
            className="px-3 py-1 bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-700 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Database & Identity Status Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" /> Overall Integrity Status
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {scanning ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                  <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> SCANNING LEDGER...
                </span>
              ) : !report ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <Clock className="w-3.5 h-3.5" /> NOT SCANNED YET
                </span>
              ) : report.criticalCount === 0 && report.failedChecks === 0 ? (
                <span
                  data-testid="integrity-status-badge"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> VERIFIED INTACT ({report.passedChecks}/{report.passedChecks + report.failedChecks} Checks)
                </span>
              ) : (
                <span
                  data-testid="integrity-status-badge"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                >
                  <ShieldAlert className="w-3.5 h-3.5" /> {report.findingsCount} FINDING(S) DETECTED
                </span>
              )}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-indigo-500" /> Isolated Tenant Database
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1 truncate" title={companyName}>
              {companyName}
            </p>
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate" title={dbIdentity}>
              {dbIdentity}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileSearch className="w-3.5 h-3.5 text-indigo-500" /> Records Inspected
            </div>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">
              {report ? Number(report.recordsInspected?.totalRecordsInspected || 0).toLocaleString() : '—'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {report
                ? `${Number(report.recordsInspected?.postedJournals || 0).toLocaleString()} Posted JEs • ${Number(report.recordsInspected?.documentsInVault || 0).toLocaleString()} Docs • ${Number(report.recordsInspected?.periodCertifications || 0)} Certifications`
                : 'Click "Run Integrity Scan" to inspect'}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-indigo-500" /> Report SHA-256 Seal & Timestamp
            </div>
            <p className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 mt-1 truncate" title={report?.reportHash || ''}>
              {report?.reportHash ? `${report.reportHash.slice(0, 20)}...` : 'No Scan Seal Yet'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {report?.scanTimestamp
                ? `${new Date(report.scanTimestamp).toLocaleString()} (${report.durationMs}ms)`
                : 'Ready for local execution'}
            </p>
          </div>
        </div>
      </div>

      {/* Empty State when no scan has been executed yet */}
      {!loadingOverview && !report && !scanning && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-10 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div className="max-w-lg mx-auto space-y-1.5">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              Ready to Execute 3-Domain Cryptographic Ledger Scan
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              No integrity scan has been recorded yet for <strong>{companyName}</strong>. Click{' '}
              <strong>Run Integrity Scan</strong> above to verify all posted journal entries, relational foreign keys, Period Close SHA-256 certifications, and encrypted LAISDOC1 vault attachments 100% offline.
            </p>
          </div>
          <button
            onClick={runIntegrityCheck}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors cursor-pointer"
          >
            <RefreshCcw className="w-4 h-4" />
            Run First Integrity Scan Now
          </button>
        </div>
      )}

      {/* Active Scan Report Content */}
      {report && (
        <div className="space-y-6">
          {/* Severity Breakdown Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'CRITICAL', count: report.criticalCount || 0, color: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800' },
              { label: 'HIGH', count: report.highCount || 0, color: 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800' },
              { label: 'MEDIUM', count: report.mediumCount || 0, color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' },
              { label: 'LOW', count: report.lowCount || 0, color: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' },
              { label: 'INFORMATIONAL', count: report.infoCount || 0, color: 'text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700' },
            ].map((sev) => (
              <button
                key={sev.label}
                onClick={() => setSeverityFilter(severityFilter === sev.label ? 'ALL' : sev.label)}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${sev.color} ${
                  severityFilter === sev.label ? 'ring-2 ring-indigo-500' : ''
                }`}
              >
                <div className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">
                  {sev.label} SEVERITY
                </div>
                <div className="text-2xl font-bold mt-1">{sev.count}</div>
              </button>
            ))}
          </div>

          {/* 3-Domain Verification Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {(['ACCOUNTING_INTEGRITY', 'RECORD_INTEGRITY', 'CRYPTOGRAPHIC_INTEGRITY'] as const).map(
              (domainKey) => {
                const dom = report.domains?.[domainKey];
                if (!dom) return null;
                const isVerified = dom.status === 'VERIFIED';
                const isExpanded = !!expandedDomains[domainKey];

                return (
                  <div
                    key={domainKey}
                    data-testid={`domain-card-${domainKey}`}
                    className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                              {domainKey.replace(/_/g, ' ')}
                            </span>
                            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                              {dom.title}
                            </h3>
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded-md text-[11px] font-bold shrink-0 ${
                              isVerified
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : dom.status === 'WARNINGS_DETECTED'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {dom.passedChecks}/{dom.totalChecks} Passed
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                          {dom.subtitle}
                        </p>
                      </div>

                      {isExpanded && (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {(dom.checks || []).map((chk: any) => (
                            <div key={chk.checkCode} className="p-3.5 text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                  {chk.status === 'PASSED' ? (
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  ) : chk.status === 'WARNING' ? (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  ) : (
                                    <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                  )}
                                  {chk.checkName}
                                </span>
                                <span className="font-mono text-[10px] text-slate-400">
                                  {Number(chk.recordsEvaluated || 0).toLocaleString()} rec
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-5">
                                {chk.summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => toggleDomainExpand(domainKey)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {isExpanded ? (
                        <>
                          Hide Domain Checks <ChevronUp className="w-3.5 h-3.5" />
                        </>
                      ) : (
                        <>
                          Show {dom.totalChecks} Checks <ChevronDown className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                );
              }
            )}
          </div>

          {/* Findings & Remediation Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-500" />
                  Verification Findings & Source-Record Remediation ({filteredFindings.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Click any affected record to open its Entity-Specific 360° Journey or navigate to the remediation workspace.
                </p>
              </div>

            <TableFilterToolbar
              searchQuery={searchQuery}
              onSearchChange={(q) => {
                setSearchQuery(q);
                setPageIndex(0);
              }}
              searchPlaceholder="Search check code, name, reference, title..."
              sortOrder={sortOrder}
              onSortOrderChange={(ord) => {
                setSortOrder(ord);
                setPageIndex(0);
              }}
              entityLabel="Severity"
              selectedEntityId={severityFilter}
              onEntityChange={(val) => {
                setSeverityFilter(val);
                setPageIndex(0);
              }}
              entityOptions={[
                { label: 'All Severities', value: 'ALL' },
                { label: 'Critical', value: 'CRITICAL' },
                { label: 'High', value: 'HIGH' },
                { label: 'Medium', value: 'MEDIUM' },
                { label: 'Low', value: 'LOW' },
                { label: 'Informational', value: 'INFORMATIONAL' },
              ]}
              productLabel="Domain"
              selectedProductId={domainFilter}
              onProductChange={(val) => {
                setDomainFilter(val);
                setPageIndex(0);
              }}
              productOptions={[
                { label: 'All Domains', value: 'ALL' },
                { label: 'Accounting Integrity', value: 'ACCOUNTING_INTEGRITY' },
                { label: 'Record Integrity', value: 'RECORD_INTEGRITY' },
                { label: 'Cryptographic Integrity', value: 'CRYPTOGRAPHIC_INTEGRITY' },
              ]}
              pageSize={pageSize}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setPageIndex(0);
              }}
              totalCount={(report?.findings || []).length}
              filteredCount={filteredFindings.length}
              onResetFilters={() => {
                setSearchQuery('');
                setSortOrder('DESC');
                setSeverityFilter('ALL');
                setDomainFilter('ALL');
                setPageSize(20);
                setPageIndex(0);
              }}
            />
            </div>

            {filteredFindings.length === 0 ? (
              <div className="text-center py-10 px-4 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/70 dark:border-emerald-800/50">
                <CheckCircle2 className="w-11 h-11 text-emerald-500 mx-auto mb-2.5" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  All 3 Integrity Domains Verified Intact
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm max-w-lg mx-auto mt-1">
                  All {Number(report.recordsInspected?.postedJournals || 0).toLocaleString()} posted journals balance (∑DR = ∑CR), all relational foreign keys and tenant boundaries are intact, and all Period Close SHA-256 certifications and LAISDOC1 encrypted containers passed verification.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-xs whitespace-nowrap min-w-[750px]">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Severity</th>
                      <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Domain / Check</th>
                      <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Record Reference</th>
                      <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Finding & Remediation</th>
                      <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-right">Discrepancy</th>
                      <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {paginatedFindings.map((f: any) => (
                      <tr key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 align-top">
                          <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-extrabold uppercase ${getSeverityBadgeClass(f.severity)}`}>
                            {f.severity}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{f.checkName}</div>
                          <div className="text-[10px] font-mono text-slate-400">{f.checkCode}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {f.recordReference}
                          </div>
                          <div className="text-[10px] text-slate-400">{f.entityType}</div>
                        </td>
                        <td className="px-4 py-3 align-top whitespace-normal max-w-md">
                          <div className="font-semibold text-slate-800 dark:text-slate-100">{f.title}</div>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">{f.description}</p>
                          <p className="text-indigo-600 dark:text-indigo-400 text-[11px] font-medium mt-1">
                            Recommended Action: {f.remediationAction}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                          {f.discrepancyAmountCentavos > 0
                            ? `₱${(f.discrepancyAmountCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                setSelected360Target({
                                  entityType: f.entityType,
                                  entityId: f.entityId,
                                  entityName: f.recordReference || f.entityId,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 text-[11px] font-semibold cursor-pointer"
                            >
                              360° Inspect
                            </button>
                            {f.remediationModulePath && (
                              <button
                                onClick={() => navigate(f.remediationModulePath)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                                title="Open Module Workspace"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <PaginationControls
              totalCount={filteredFindings.length}
              itemCount={paginatedFindings.length}
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(pageIndex + 1) * pageSize < filteredFindings.length}
              onNextPage={() => setPageIndex((p) => p + 1)}
              onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredFindings.length / pageSize) - 1))}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPageIndex(0);
              }}
            />

            {/* Cryptographic Boundary & Non-Repudiation Footnote */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Cryptographic Hash-Chain & Verification Scope ({report.engineVersion}):
                </span>{' '}
                {report.cryptographicBoundaryStatement}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Persisted Scan History & Hash-Chain Table */}
      {scanHistory.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-500" />
              Persisted Integrity Scan History & Hash Chain ({scanHistory.length})
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              Append-Only SHA-256 Chain of Custody
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs whitespace-nowrap min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400">Scan ID</th>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400">Timestamp</th>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400">Checks</th>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400">Records</th>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400">Report SHA-256 → Prev Link</th>
                  <th className="px-4 py-2.5 font-bold text-slate-500 dark:text-slate-400 text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {scanHistory.map((h: any) => (
                  <tr
                    key={h.scanId}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      report?.scanId === h.scanId ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {h.scanId}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                      {new Date(h.scanTimestamp).toLocaleString()} ({h.durationMs}ms)
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          h.findingsCount === 0
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {h.status} ({h.findingsCount} findings)
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                      {h.passedChecks} passed / {h.failedChecks} failed
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                      {Number(h.totalRecordsInspected || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                      <span title={h.reportHash}>{String(h.reportHash || '').slice(0, 12)}…</span>
                      {' → '}
                      <span title={h.previousReportHash || 'GENESIS'}>
                        {h.previousReportHash ? `${String(h.previousReportHash).slice(0, 10)}…` : 'GENESIS'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleSelectHistoricalScan(h.scanId)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        Load Report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 360° Record Activity Modal */}
      {selected360Target && (
        <RecordActivityModal
          isOpen={true}
          onClose={() => setSelected360Target(null)}
          entityType={selected360Target.entityType}
          entityId={selected360Target.entityId}
          title={selected360Target.entityName}
        />
      )}
    </div>
  );
}
