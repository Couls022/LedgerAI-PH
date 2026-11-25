import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Upload,
  CheckCircle,
  AlertTriangle,
  FileCheck,
  RefreshCw,
  Key,
  RotateCcw,
  Building,
  Check,
  X,
  FileText,
  Lock,
  Calendar,
  Layers,
  Award,
  BookOpen
} from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';
import { useAuth } from '../../context/AuthContext';
import { TableScrollContainer } from '../../components/shared/TableScrollContainer';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter, computePeriodDates } from '../../components/shared/TableFilterToolbar';

interface ActiveRule {
  id: string;
  agency: string;
  ruleCode: string;
  ruleName: string;
  regulatorySourceRef: string;
  officialPublicationDate: string;
  effectiveStartDate: string;
  versionNumber: number;
  calculationMethodology: string;
  status: string;
  ruleDefinitionJson: string;
  validationStatus: string;
}

interface StatutoryPackage {
  id: string;
  packageCode: string;
  packageName: string;
  packageVersion: string;
  publisherIdentity: string;
  signerKeyFingerprint: string;
  payloadSha256: string;
  status: string;
  rulesCount: number;
  validationReportJson: string;
  importedBy: string;
  importedByName: string;
  importedAt: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
}

interface FreshnessReport {
  overallStatus: 'CURRENT' | 'NEEDS_ATTENTION' | 'OUTDATED_WARNING' | 'EXPIRED_CRITICAL';
  currentDate: string;
  agencies: Array<{
    agency: string;
    activeRuleCode: string;
    regulatorySourceRef: string;
    effectiveStartDate: string;
    versionNumber: number;
    status: string;
    daysSinceEffective: number;
    notice: string;
  }>;
  pendingPackagesCount: number;
  warnings: string[];
}

export function StatutoryRulesManager() {
  const { user, activeCompany } = useAuth();
  const [activeTab, setActiveTab] = useState<'freshness' | 'import' | 'packages' | 'diff' | 'audit'>('freshness');
  const [loading, setLoading] = useState(false);
  const [freshness, setFreshness] = useState<FreshnessReport | null>(null);
  const [rules, setRules] = useState<ActiveRule[]>([]);
  const [packages, setPackages] = useState<StatutoryPackage[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [importJsonText, setImportJsonText] = useState('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<StatutoryPackage | null>(null);

  // Packages table filtering & pagination (default datePeriod = 'ALL', sortOrder = 'DESC', pageSize = 20)
  const [pkgSearch, setPkgSearch] = useState('');
  const [pkgSortOrder, setPkgSortOrder] = useState<SortOrderDirection>('DESC');
  const [pkgDatePeriod, setPkgDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [pkgCustomFrom, setPkgCustomFrom] = useState('');
  const [pkgCustomTo, setPkgCustomTo] = useState('');
  const [pkgPage, setPkgPage] = useState(0);
  const [pkgPageSize, setPkgPageSize] = useState(20);

  const filteredPackages = React.useMemo(() => {
    let result = [...packages];
    if (pkgSearch.trim()) {
      const q = pkgSearch.toLowerCase();
      result = result.filter(p =>
        (p.packageName || '').toLowerCase().includes(q) ||
        (p.packageCode || '').toLowerCase().includes(q) ||
        (p.publisherIdentity || '').toLowerCase().includes(q) ||
        (p.status || '').toLowerCase().includes(q)
      );
    }
    if (pkgDatePeriod !== 'ALL') {
      const { fromDate, toDate } = pkgDatePeriod === 'CUSTOM'
        ? { fromDate: pkgCustomFrom, toDate: pkgCustomTo }
        : computePeriodDates(pkgDatePeriod);
      if (fromDate) result = result.filter(p => (p.importedAt || '').slice(0, 10) >= fromDate);
      if (toDate) result = result.filter(p => (p.importedAt || '').slice(0, 10) <= toDate);
    }
    result.sort((a, b) => {
      const cmp = (a.importedAt || '').localeCompare(b.importedAt || '');
      return pkgSortOrder === 'ASC' ? cmp : -cmp;
    });
    return result;
  }, [packages, pkgSearch, pkgDatePeriod, pkgCustomFrom, pkgCustomTo, pkgSortOrder]);

  const pagedPackages = React.useMemo(() => {
    return filteredPackages.slice(pkgPage * pkgPageSize, (pkgPage + 1) * pkgPageSize);
  }, [filteredPackages, pkgPage, pkgPageSize]);

  // Audit logs table filtering & pagination (default datePeriod = 'ALL', sortOrder = 'DESC', pageSize = 20)
  const [auditSearch, setAuditSearch] = useState('');
  const [auditSortOrder, setAuditSortOrder] = useState<SortOrderDirection>('DESC');
  const [auditDatePeriod, setAuditDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [auditCustomFrom, setAuditCustomFrom] = useState('');
  const [auditCustomTo, setAuditCustomTo] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const [auditPageSize, setAuditPageSize] = useState(20);

  const filteredAuditLogs = React.useMemo(() => {
    let result = [...auditLogs];
    if (auditSearch.trim()) {
      const q = auditSearch.toLowerCase();
      result = result.filter(l =>
        (l.userName || '').toLowerCase().includes(q) ||
        (l.action || '').toLowerCase().includes(q) ||
        (l.packageId || '').toLowerCase().includes(q) ||
        (l.ruleId || '').toLowerCase().includes(q) ||
        (l.detailsJson || '').toLowerCase().includes(q)
      );
    }
    if (auditDatePeriod !== 'ALL') {
      const { fromDate, toDate } = auditDatePeriod === 'CUSTOM'
        ? { fromDate: auditCustomFrom, toDate: auditCustomTo }
        : computePeriodDates(auditDatePeriod);
      if (fromDate) result = result.filter(l => (l.createdAt || '').slice(0, 10) >= fromDate);
      if (toDate) result = result.filter(l => (l.createdAt || '').slice(0, 10) <= toDate);
    }
    result.sort((a, b) => {
      const cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      return auditSortOrder === 'ASC' ? cmp : -cmp;
    });
    return result;
  }, [auditLogs, auditSearch, auditDatePeriod, auditCustomFrom, auditCustomTo, auditSortOrder]);

  const pagedAuditLogs = React.useMemo(() => {
    return filteredAuditLogs.slice(auditPage * auditPageSize, (auditPage + 1) * auditPageSize);
  }, [filteredAuditLogs, auditPage, auditPageSize]);

  const fetchStatutoryData = async () => {
    setLoading(true);
    setActionError(null);
    try {
      const [freshData, rulesData, pkgsData, auditData] = await Promise.all([
        apiFetch<FreshnessReport>('/api/statutory-rules/freshness'),
        apiFetch<any>('/api/statutory-rules'),
        apiFetch<any>('/api/statutory-rules/packages'),
        apiFetch<any>('/api/statutory-rules/audit-logs')
      ]);

      setFreshness(freshData);
      setRules(rulesData?.rules || []);
      setPackages(pkgsData?.packages || []);
      setAuditLogs(auditData?.logs || []);
    } catch (err: any) {
      setActionError(`Failed to load statutory rules data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatutoryData();
  }, []);

  const handleImportPackage = async () => {
    if (!importJsonText.trim()) {
      setActionError('Please paste or select a statutory update package JSON payload.');
      return;
    }

    setLoading(true);
    setActionSuccess(null);
    setActionError(null);

    try {
      const data = await apiFetch<any>('/api/statutory-rules/packages/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageJson: JSON.parse(importJsonText) })
      });

      setActionSuccess(`Package '${data.package.packageName}' imported and verified cryptographically!`);
      setImportJsonText('');
      await fetchStatutoryData();
      setActiveTab('packages');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSample2027 = async () => {
    setLoading(true);
    setActionSuccess(null);
    setActionError(null);

    try {
      const data = await apiFetch<any>('/api/statutory-rules/sample-2027-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      setActionSuccess(`Generated and imported signed sample 2027 package '${data.package.packageName}'!`);
      await fetchStatutoryData();
      setActiveTab('packages');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprovePackage = async (packageId: string) => {
    setLoading(true);
    setActionSuccess(null);
    setActionError(null);

    try {
      const data = await apiFetch<any>(`/api/statutory-rules/packages/${packageId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userRole: activeCompany?.roleName || activeCompany?.role || 'Company Administrator',
          userName: user?.displayName || user?.email || 'Authorized Administrator'
        })
      });

      setActionSuccess(`Package approved and ${data.activatedRulesCount} statutory rules activated!`);
      await fetchStatutoryData();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRollbackPackage = async (packageId: string) => {
    setLoading(true);
    setActionSuccess(null);
    setActionError(null);

    try {
      await apiFetch<any>(`/api/statutory-rules/packages/${packageId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Administrative rollback to previous statutory rule set',
          userRole: activeCompany?.roleName || activeCompany?.role || 'Company Administrator'
        })
      });

      setActionSuccess('Package successfully rolled back to prior active rules!');
      await fetchStatutoryData();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-indigo-800/40">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-indigo-600/30 rounded-xl border border-indigo-500/40">
                <ShieldCheck className="w-8 h-8 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Offline-First Statutory Rules Management</h1>
                <p className="text-indigo-200/80 text-sm mt-0.5">
                  Standalone Cryptographic Update Distribution & Compliance Freshness Engine (SSS, PhilHealth, Pag-IBIG, BIR)
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleGenerateSample2027}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg flex items-center space-x-2 border border-indigo-400/30"
            >
              <Upload className="w-4 h-4" />
              <span>Generate USB 2027 Package</span>
            </button>

            <button
              onClick={fetchStatutoryData}
              disabled={loading}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-all border border-slate-700"
              title="Refresh Engine"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Freshness Status Summary Card */}
        {freshness && (
          <div className="mt-6 pt-6 border-t border-indigo-800/40 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-800/60 backdrop-blur rounded-xl p-4 border border-slate-700/60">
              <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Compliance Status</div>
              <div className="mt-2 flex items-center space-x-2">
                {freshness.overallStatus === 'CURRENT' && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> CURRENT & COMPLIANT
                  </span>
                )}
                {freshness.overallStatus === 'NEEDS_ATTENTION' && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> PENDING UPDATE AVAILABLE
                  </span>
                )}
                {freshness.overallStatus === 'OUTDATED_WARNING' && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> OUTDATED RULE NOTICE
                  </span>
                )}
              </div>
            </div>

            <div className="bg-slate-800/60 backdrop-blur rounded-xl p-4 border border-slate-700/60">
              <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Active Statutory Rules</div>
              <div className="mt-1 text-2xl font-bold text-white">{rules.filter(r => r.status === 'ACTIVE').length} / 4 Agencies</div>
            </div>

            <div className="bg-slate-800/60 backdrop-blur rounded-xl p-4 border border-slate-700/60">
              <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Pending Packages</div>
              <div className="mt-1 text-2xl font-bold text-amber-400">{freshness.pendingPackagesCount} Update Packages</div>
            </div>

            <div className="bg-slate-800/60 backdrop-blur rounded-xl p-4 border border-slate-700/60">
              <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Cryptographic Security</div>
              <div className="mt-2 flex items-center text-xs text-emerald-300 font-medium">
                <Lock className="w-4 h-4 mr-1 text-emerald-400" /> RSA-256 Signature Verified
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-semibold text-sm">{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            <span className="font-semibold text-sm">{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-2">
        <button
          onClick={() => setActiveTab('freshness')}
          className={`px-4 py-3 font-bold text-sm border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'freshness'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Active Rules & Freshness</span>
        </button>

        <button
          onClick={() => setActiveTab('import')}
          className={`px-4 py-3 font-bold text-sm border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'import'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Import USB Package</span>
        </button>

        <button
          onClick={() => setActiveTab('packages')}
          className={`px-4 py-3 font-bold text-sm border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'packages'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Update Packages ({packages.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-3 font-bold text-sm border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'audit'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Statutory Audit Trail</span>
        </button>
      </div>

      {/* Tab 1: Active Rules Repository & Freshness */}
      {activeTab === 'freshness' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {freshness?.agencies.map((agency) => {
              const activeRuleObj = rules.find(r => r.agency === agency.agency && r.status === 'ACTIVE');
              return (
                <div
                  key={agency.agency}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 hover:border-indigo-300 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 font-black text-base">
                        {agency.agency}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{agency.activeRuleCode}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{agency.regulatorySourceRef}</p>
                      </div>
                    </div>

                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                      ACTIVE (v{agency.versionNumber})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Effective Date:</span>
                      <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{agency.effectiveStartDate}</div>
                    </div>

                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Active Duration:</span>
                      <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{agency.daysSinceEffective} days</div>
                    </div>
                  </div>

                  {activeRuleObj && (
                    <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                      <div className="font-bold text-slate-700 dark:text-slate-200 mb-1">Methodology: {activeRuleObj.calculationMethodology}</div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        Source Ref: {activeRuleObj.regulatorySourceRef}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold flex items-center">
                    <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                    <span>{agency.notice}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Package USB Offline Import */}
      {activeTab === 'import' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Import Cryptographic Statutory Package</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Import a signed statutory update package file (`.json` or `.laistat`) from USB drive without internet connectivity.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                Signed Statutory Update Package JSON Payload
              </label>
              <textarea
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder="Paste signed .json or .laistat update package content here..."
                rows={10}
                className="w-full font-mono text-xs p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleImportPackage}
                disabled={loading}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center space-x-2"
              >
                <Upload className="w-4 h-4" />
                <span>Verify Signature & Import Package</span>
              </button>

              <button
                onClick={handleGenerateSample2027}
                disabled={loading}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200 rounded-xl text-sm font-bold transition-all border border-slate-300 dark:border-slate-700"
              >
                Load Sample Signed 2027 Package
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Update Packages List & Approval Workflow */}
      {activeTab === 'packages' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Statutory Update Packages</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Review, approve, and activate verified statutory packages for local deployment.
            </p>
          </div>

          <TableFilterToolbar
            searchQuery={pkgSearch}
            onSearchChange={setPkgSearch}
            searchPlaceholder="Search statutory update packages..."
            sortOrder={pkgSortOrder}
            onSortOrderChange={setPkgSortOrder}
            datePeriod={pkgDatePeriod}
            onDatePeriodChange={setPkgDatePeriod}
            fromDate={pkgCustomFrom}
            toDate={pkgCustomTo}
            onDateRangeChange={(range) => {
              setPkgDatePeriod('CUSTOM');
              setPkgCustomFrom(range.fromDate);
              setPkgCustomTo(range.toDate);
            }}
            pageSize={pkgPageSize}
            onPageSizeChange={(newSize) => {
              setPkgPageSize(newSize);
              setPkgPage(0);
            }}
            totalCount={packages.length}
            filteredCount={filteredPackages.length}
            onResetFilters={() => {
              setPkgSearch('');
              setPkgSortOrder('DESC');
              setPkgDatePeriod('ALL');
              setPkgCustomFrom('');
              setPkgCustomTo('');
              setPkgPage(0);
            }}
          />

          <TableScrollContainer
            maxHeight="calc(100vh - 360px)"
            minHeight="280px"
            stickyHeader={true}
            title={`Statutory Update Packages (${filteredPackages.length})`}
            totalRecordsCount={filteredPackages.length}
            pagination={{
              pageIndex: pkgPage,
              pageSize: pkgPageSize,
              pageSizeOptions: [20, 25, 50, 100],
              totalRecords: filteredPackages.length,
              itemCount: pagedPackages.length,
              onPageChange: setPkgPage,
              onPageSizeChange: (newSize) => {
                setPkgPageSize(newSize);
                setPkgPage(0);
              },
              loading,
            }}
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <th className="p-4">Package Code & Name</th>
                  <th className="p-4">Publisher Identity</th>
                  <th className="p-4">Key Fingerprint</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Imported At</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedPackages.map((pkg) => (
                  <tr key={pkg.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all">
                    <td className="p-4 font-medium text-slate-900 dark:text-slate-100">
                      <div className="font-bold text-slate-900 dark:text-slate-100">{pkg.packageName}</div>
                      <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px] mt-0.5">{pkg.packageCode} (v{pkg.packageVersion})</div>
                    </td>
                    <td className="p-4 text-slate-600 dark:text-slate-300 font-semibold">{pkg.publisherIdentity}</td>
                    <td className="p-4 font-mono text-slate-500 dark:text-slate-400 text-[11px]">{pkg.signerKeyFingerprint}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] ${
                        pkg.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : pkg.status === 'VALIDATED'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        {pkg.status}
                      </span>
                    </td>
                    <td className="p-4 text-slate-500 dark:text-slate-400">{new Date(pkg.importedAt).toLocaleDateString()}</td>
                    <td className="p-4 text-right space-x-2">
                      {pkg.status === 'VALIDATED' && (
                        <button
                          onClick={() => handleApprovePackage(pkg.id)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-all shadow-sm"
                        >
                          Approve & Activate
                        </button>
                      )}

                      {pkg.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleRollbackPackage(pkg.id)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold transition-all shadow-sm flex items-center space-x-1 inline-flex"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          <span>Rollback</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredPackages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No statutory update packages found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        </div>
      )}

      {/* Tab 4: Immutable Audit Trail */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Statutory Rules Immutable Audit Trail</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Complete audit log of rule imports, cryptographic verifications, approvals, activations, and rollbacks.
            </p>
          </div>

          <TableFilterToolbar
            searchQuery={auditSearch}
            onSearchChange={setAuditSearch}
            searchPlaceholder="Search statutory audit logs..."
            sortOrder={auditSortOrder}
            onSortOrderChange={setAuditSortOrder}
            datePeriod={auditDatePeriod}
            onDatePeriodChange={setAuditDatePeriod}
            fromDate={auditCustomFrom}
            toDate={auditCustomTo}
            onDateRangeChange={(range) => {
              setAuditDatePeriod('CUSTOM');
              setAuditCustomFrom(range.fromDate);
              setAuditCustomTo(range.toDate);
            }}
            pageSize={auditPageSize}
            onPageSizeChange={(newSize) => {
              setAuditPageSize(newSize);
              setAuditPage(0);
            }}
            totalCount={auditLogs.length}
            filteredCount={filteredAuditLogs.length}
            onResetFilters={() => {
              setAuditSearch('');
              setAuditSortOrder('DESC');
              setAuditDatePeriod('ALL');
              setAuditCustomFrom('');
              setAuditCustomTo('');
              setAuditPage(0);
            }}
          />

          <TableScrollContainer
            maxHeight="calc(100vh - 360px)"
            minHeight="280px"
            stickyHeader={true}
            title={`Statutory Rules Audit Trail (${filteredAuditLogs.length})`}
            totalRecordsCount={filteredAuditLogs.length}
            pagination={{
              pageIndex: auditPage,
              pageSize: auditPageSize,
              pageSizeOptions: [20, 25, 50, 100],
              totalRecords: filteredAuditLogs.length,
              itemCount: pagedAuditLogs.length,
              onPageChange: setAuditPage,
              onPageSizeChange: (newSize) => {
                setAuditPageSize(newSize);
                setAuditPage(0);
              },
              loading,
            }}
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">User & Role</th>
                  <th className="p-4">Action</th>
                  <th className="p-4">Package / Rule Ref</th>
                  <th className="p-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedAuditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all">
                    <td className="p-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="p-4 font-semibold text-slate-800 dark:text-slate-200">
                      <div>{log.userName}</div>
                      <div className="text-[11px] text-slate-400">{log.userRole || 'Admin'}</div>
                    </td>
                    <td className="p-4 font-bold text-indigo-600 dark:text-indigo-400">{log.action}</td>
                    <td className="p-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">{log.packageId || log.ruleId || 'N/A'}</td>
                    <td className="p-4 text-slate-600 dark:text-slate-300 font-mono text-[11px] truncate max-w-xs">{log.detailsJson}</td>
                  </tr>
                ))}

                {filteredAuditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      No statutory audit logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        </div>
      )}
    </div>
  );
}
