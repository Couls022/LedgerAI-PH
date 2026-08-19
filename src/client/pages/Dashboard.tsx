import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Users, FileText, RefreshCw, ShieldCheck, TrendingUp, Clock, ArrowUpRight, AlertTriangle } from 'lucide-react';
import D3FinancialCharts from '../components/D3FinancialCharts';
import QuickSnapshotWidget from '../components/QuickSnapshotWidget';
import EmailReminderModal from '../components/EmailReminderModal';
import DashboardBudgetWidget from '../components/DashboardBudgetWidget';
import { apiFetch } from '../utils/apiClient';

function LicenseExpirationWarning() {
  const [license, setLicense] = useState<any>(null);

  useEffect(() => {
    fetch('/api/licenses/status?t=' + Date.now())
      .then(r => r.ok ? r.json() : null)
      .then(data => {
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
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100">License expires in {diffDays} {diffDays === 1 ? 'day' : 'days'}</h4>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Please renew your license to avoid disruption to your LedgerAI instance.</p>
        </div>
      </div>
      <Link to="/settings" className="self-start sm:self-auto px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 rounded-lg transition-colors whitespace-nowrap shadow-xs">
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

  const fetchDashboardData = () => {
    setLoading(true);
    apiFetch<any>('/api/dashboard/overview')
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching dashboard data:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
  };

  if (loading && !data) {
    return (
      <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-7 h-7 animate-spin text-indigo-600 dark:text-indigo-400" />
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Loading financial health metrics...</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <LicenseExpirationWarning />
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-[26px] font-extrabold text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2.5">
                Financial Health Command Center
              </h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                Real-time balance positions, BIR compliance status, and Philippine tax ledger telemetry.
              </p>
            </div>

            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="self-start sm:self-auto px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 text-indigo-600 dark:text-indigo-400 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>

          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cash Balance */}
        <div className="bg-white dark:bg-[#111827] p-5 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 transition-all hover:border-indigo-300 dark:hover:border-indigo-700/60">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cash Position</span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tracking-tight">
            {formatCurrency(data?.cashBalance)}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" /> Liquid bank & cash assets
          </p>
        </div>

        {/* Accounts Receivable */}
        <div className="bg-white dark:bg-[#111827] p-5 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 transition-all hover:border-emerald-300 dark:hover:border-emerald-700/60">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Accounts Receivable</span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tracking-tight">
            {formatCurrency(data?.accountsReceivable)}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block shrink-0" /> Pending customer collections
          </p>
        </div>

        {/* Accounts Payable */}
        <div className="bg-white dark:bg-[#111827] p-5 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 transition-all hover:border-rose-300 dark:hover:border-rose-700/60">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Accounts Payable</span>
            <div className="p-2 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl border border-rose-100 dark:border-rose-900/40">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tracking-tight">
            {formatCurrency(data?.accountsPayable)}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block shrink-0" /> Outstanding supplier obligations
          </p>
        </div>

        {/* BIR Compliance */}
        <div className="bg-white dark:bg-[#111827] p-5 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 transition-all hover:border-amber-300 dark:hover:border-amber-700/60">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">BIR Compliance</span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-900/40">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {data?.complianceStatus || 'Compliant & Active'}
            </p>
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            Tax books & vouchers synchronized
          </p>
        </div>
      </div>

      {/* Quick Snapshot Widget */}
      <QuickSnapshotWidget
        pendingInvoices={data?.pendingInvoices || []}
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
      <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 p-6">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Recent Audit & System Activities
              </h2>
              <p className="text-[11px] text-slate-400">Append-only immutable system ledger</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Live Stream
          </span>
        </div>

        {data?.activities?.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {data.activities.map((act: any) => (
              <div key={act.id} className="py-3 flex items-center justify-between text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/40 px-2 rounded-xl transition-colors">
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-0.5 rounded-lg font-mono font-bold text-[11px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/40">
                    {act.action}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                      {act.entityType.replace('_', ' ')}: <span className="font-mono text-slate-400 dark:text-slate-500">{act.entityId?.slice(0, 8)}...</span>
                    </p>
                  </div>
                </div>
                <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                  {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 text-xs py-6 text-center">No recent activity logs found.</p>
        )}
      </div>
    </div>
  );
}
