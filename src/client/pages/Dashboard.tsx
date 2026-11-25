import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard,
  Users,
  FileText,
  RefreshCw,
  ShieldCheck,
  Clock,
  ArrowUpRight,
  AlertTriangle,
  Activity,
  Calendar,
  X,
} from 'lucide-react';
import D3FinancialCharts from '../components/D3FinancialCharts';
import QuickSnapshotWidget from '../components/QuickSnapshotWidget';
import EmailReminderModal from '../components/EmailReminderModal';
import DashboardBudgetWidget from '../components/DashboardBudgetWidget';
import RecordActivityModal from '../components/RecordActivityModal';
import PercentageMetricWidget from '../components/shared/PercentageMetricWidget';
import { useWorkspaceFilter } from '../context/WorkspaceFilterContext';
import {
  computeDashboardPercentageMetrics,
  matchesDateTimeFilter,
} from '../utils/dateFilterUtils';
import { apiFetch } from '../utils/apiClient';

function LicenseExpirationWarning() {
  const [license, setLicense] = useState<any>(null);

  useEffect(() => {
    apiFetch<any>('/api/licenses/status?t=' + Date.now())
      .then((data) => {
        if (data) setLicense(data);
      })
      .catch(() => {});
  }, []);

  if (!license || license.isLifetime || !license.expirationDate) return null;

  const expDate = new Date(license.expirationDate);
  const now = new Date();
  const diffTime = expDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 7 || diffDays < 0) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-xl shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400" />
        </div>
        <div>
          <h4 className="font-display text-sm font-bold text-amber-950 dark:text-amber-100">
            License expires in {diffDays} {diffDays === 1 ? 'day' : 'days'}
          </h4>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
            Renew your workspace license to avoid service interruption.
          </p>
        </div>
      </div>
      <Link
        to="/settings"
        className="self-start sm:self-auto px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl transition-colors whitespace-nowrap"
      >
        Manage License
      </Link>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoiceForReminder, setSelectedInvoiceForReminder] = useState<string | undefined>(undefined);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [selected360Record, setSelected360Record] = useState<{
    entityType: string;
    entityId: string;
    title?: string;
  } | null>(null);

  const { filter, isFilterActive, summaryLabel, toggleBarOpen, resetFilter } = useWorkspaceFilter();

  const fetchDashboardData = () => {
    setLoading(true);
    apiFetch<any>('/api/dashboard/overview')
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (
          err?.status !== 401 &&
          !err?.message?.includes('Company not found') &&
          !err?.message?.includes('session')
        ) {
          console.error('Error fetching dashboard data:', err);
        }
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
  };

  // Source-of-truth percentage widgets strictly derived from backend DB metrics (zero fabrication)
  const percentageMetrics = useMemo(() => computeDashboardPercentageMetrics(data), [data]);

  // Apply global Date/Time & Search filter cleanly to dashboard records
  const filteredActivities = useMemo(() => {
    const raw = Array.isArray(data?.activities) ? data.activities : [];
    const q = filter.searchQuery.trim().toLowerCase();
    return raw.filter((act: any) => {
      if (!matchesDateTimeFilter(act.timestamp, filter)) return false;
      if (q) {
        const haystack = `${act.action || ''} ${act.entityType || ''} ${act.entityId || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data?.activities, filter]);

  const filteredPendingInvoices = useMemo(() => {
    const raw = Array.isArray(data?.pendingInvoices) ? data.pendingInvoices : [];
    const q = filter.searchQuery.trim().toLowerCase();
    return raw.filter((inv: any) => {
      if (!matchesDateTimeFilter(inv.invoiceDate || inv.dueDate, filter)) return false;
      if (q) {
        const haystack = `${inv.invoiceNumber || ''} ${inv.customerName || ''} ${inv.status || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data?.pendingInvoices, filter]);

  if (loading && !data) {
    return (
      <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-7 h-7 animate-spin text-blue-600 dark:text-sky-400" />
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Loading financial health metrics...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <LicenseExpirationWarning />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">
            Financial Overview
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">
            Live General Ledger balances, subledger reconciliation, and Philippine BIR compliance status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleBarOpen}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
              isFilterActive
                ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-sky-300'
                : 'bg-white dark:bg-[#11192B] border-slate-200 dark:border-[#24344F] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162238]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>{isFilterActive ? summaryLabel : 'Filter Date & Time'}</span>
          </button>

          {isFilterActive && (
            <button
              type="button"
              onClick={resetFilter}
              aria-label="Clear active period filter"
              className="p-2 rounded-xl bg-slate-100 dark:bg-[#162238] text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
              title="Reset date & time filter"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={fetchDashboardData}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#11192B] border border-slate-200 dark:border-[#24344F] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162238] transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-600 dark:text-sky-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Cards Grid — 1 col Mobile, 2 cols Tablet, 4 cols Desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Cash Position */}
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] card-hover hover:border-blue-300 dark:hover:border-sky-700/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Cash Position
              </span>
              <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-400 rounded-xl">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums tracking-tight">
              {formatCurrency(data?.cashBalance)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
              {data?.kpiMeta?.cashBalance?.missingExplanation ||
                data?.kpiMeta?.cashBalance?.source ||
                'Cash & Bank Accounts'}
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-slate-100 dark:border-[#1B2942] flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400 dark:text-slate-500 truncate">
              {data?.kpiMeta?.cashBalance?.varianceLabel || 'Ledger Balanced'}
            </span>
            <Link
              to={data?.kpiMeta?.cashBalance?.drillDownPath || '/reports/cashbook'}
              className="font-semibold text-blue-700 dark:text-sky-400 hover:underline inline-flex items-center gap-0.5 whitespace-nowrap shrink-0"
            >
              <span>Cashbook</span>
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Accounts Receivable */}
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] card-hover hover:border-teal-300 dark:hover:border-teal-700/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Accounts Receivable
              </span>
              <div className="p-2 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 rounded-xl">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums tracking-tight">
              {formatCurrency(data?.accountsReceivable)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
              {data?.kpiMeta?.accountsReceivable?.missingExplanation ||
                data?.kpiMeta?.accountsReceivable?.source ||
                'Open Customer Invoices'}
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-slate-100 dark:border-[#1B2942] flex items-center justify-between gap-2 text-[11px]">
            <span
              className={
                data?.reconciliationSummary?.arVarianceCentavos
                  ? 'text-amber-600 dark:text-amber-400 font-semibold truncate'
                  : 'text-slate-400 dark:text-slate-500 truncate'
              }
            >
              {data?.kpiMeta?.accountsReceivable?.varianceLabel || 'Reconciled'}
            </span>
            <Link
              to={data?.kpiMeta?.accountsReceivable?.drillDownPath || '/reports/ar-aging'}
              className="font-semibold text-teal-700 dark:text-teal-400 hover:underline inline-flex items-center gap-0.5 whitespace-nowrap shrink-0"
            >
              <span>AR Aging</span>
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Accounts Payable */}
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] card-hover hover:border-rose-300 dark:hover:border-rose-800/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Accounts Payable
              </span>
              <div className="p-2 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 rounded-xl">
                <FileText className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums tracking-tight">
              {formatCurrency(data?.accountsPayable)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
              {data?.kpiMeta?.accountsPayable?.missingExplanation ||
                data?.kpiMeta?.accountsPayable?.source ||
                'Open Supplier Bills'}
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-slate-100 dark:border-[#1B2942] flex items-center justify-between gap-2 text-[11px]">
            <span
              className={
                data?.reconciliationSummary?.apVarianceCentavos
                  ? 'text-amber-600 dark:text-amber-400 font-semibold truncate'
                  : 'text-slate-400 dark:text-slate-500 truncate'
              }
            >
              {data?.kpiMeta?.accountsPayable?.varianceLabel || 'Reconciled'}
            </span>
            <Link
              to={data?.kpiMeta?.accountsPayable?.drillDownPath || '/reports/ap-aging'}
              className="font-semibold text-rose-700 dark:text-rose-400 hover:underline inline-flex items-center gap-0.5 whitespace-nowrap shrink-0"
            >
              <span>AP Aging</span>
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Ledger & BIR Compliance */}
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] card-hover hover:border-amber-300 dark:hover:border-amber-800/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Ledger &amp; BIR Status
              </span>
              <div className="p-2 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded-xl">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  data?.complianceStatus === 'Reconciled & Active'
                    ? 'bg-teal-500'
                    : data?.complianceStatus === 'Action Required'
                      ? 'bg-rose-500'
                      : 'bg-amber-500'
                }`}
              />
              <p className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {data?.complianceStatus || 'Checking...'}
              </p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
              {data?.complianceDetail || 'Reconciling Trial Balance and subledger controls.'}
            </p>
          </div>
          <div className="mt-4 pt-2.5 border-t border-slate-100 dark:border-[#1B2942] flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400 dark:text-slate-500 font-mono truncate">
              {data?.lastUpdated ? `Updated ${new Date(data.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live'}
            </span>
            <Link
              to="/reports/trial-balance"
              className="font-semibold text-amber-700 dark:text-amber-400 hover:underline inline-flex items-center gap-0.5 whitespace-nowrap shrink-0"
            >
              <span>Trial Balance</span>
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Real Source-of-Truth Percentage Widgets Strip */}
      <section aria-label="Financial performance and control ratios" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-slate-800 dark:text-slate-100">
            Performance &amp; Reconciliation Ratios
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Live financial and BIR compliance ratios
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {percentageMetrics.map((metric) => (
            <PercentageMetricWidget key={metric.id} metric={metric} />
          ))}
        </div>
      </section>

      {/* Quick Snapshot Widget */}
      <QuickSnapshotWidget
        pendingInvoices={filteredPendingInvoices}
        taxEstimate={data?.taxEstimate}
        formatCurrency={formatCurrency}
        onSendReminder={(invId) => {
          setSelectedInvoiceForReminder(invId);
          setIsReminderModalOpen(true);
        }}
      />

      {/* Monthly Budget & Spending Variance Widget */}
      <DashboardBudgetWidget formatCurrency={formatCurrency} />

      <EmailReminderModal
        isOpen={isReminderModalOpen}
        onClose={() => setIsReminderModalOpen(false)}
        selectedInvoiceId={selectedInvoiceForReminder}
        onReminderSent={() => fetchDashboardData()}
      />

      {/* D3 Financial Charts Suite */}
      <D3FinancialCharts
        data={data?.monthlyTrends || []}
        expenseBreakdown={data?.expenseBreakdown || []}
        formatCurrency={formatCurrency}
      />

      {/* Audit Log / Activity Stream */}
      <div className="bg-white dark:bg-[#11192B] rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-[#1B2942]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-slate-100 dark:bg-[#162238] text-blue-700 dark:text-sky-400 rounded-xl shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Recent Audit &amp; Ledger Activity
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFilterActive
                  ? `Showing ${filteredActivities.length} event(s) matching ${summaryLabel}`
                  : 'Append-only verifiable company audit trail'}
              </p>
            </div>
          </div>
          <Link
            to="/activity-center"
            className="self-start sm:self-auto px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-[#162238] text-blue-700 dark:text-sky-300 hover:bg-blue-50 dark:hover:bg-[#1F2F4C] transition-colors whitespace-nowrap"
          >
            Activity Center &rarr;
          </Link>
        </div>

        {filteredActivities.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-[#1B2942]">
            {filteredActivities.map((act: any) => (
              <div
                key={act.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs hover:bg-slate-50/70 dark:hover:bg-[#162238]/50 px-2 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono font-semibold text-[11px] text-blue-700 dark:text-sky-300 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md shrink-0">
                    {act.action}
                  </span>
                  <p className="font-medium text-slate-800 dark:text-slate-200 capitalize truncate">
                    {act.entityType.replace('_', ' ')}:{' '}
                    <span className="font-mono text-slate-400 dark:text-slate-500">
                      {act.entityId?.slice(0, 12)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                    {new Date(act.timestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {act.entityType && act.entityId && (
                    <button
                      type="button"
                      onClick={() =>
                        setSelected360Record({
                          entityType: act.entityType,
                          entityId: act.entityId,
                          title: `${act.entityType} #${act.entityId}`,
                        })
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#162238] text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-sky-300 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer"
                    >
                      <Activity className="w-3 h-3" />
                      <span>360° View</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 dark:text-slate-400 text-xs py-6 text-center">
            {isFilterActive
              ? 'No audit activity matches the selected date/time filter.'
              : 'No recent activity logs recorded yet.'}
          </p>
        )}
      </div>

      {selected360Record && (
        <RecordActivityModal
          isOpen={!!selected360Record}
          onClose={() => setSelected360Record(null)}
          entityType={selected360Record.entityType}
          entityId={selected360Record.entityId}
          title={selected360Record.title}
          onActionSuccess={fetchDashboardData}
        />
      )}
    </div>
  );
}
