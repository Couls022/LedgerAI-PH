import React, { useEffect, useState, useMemo } from 'react';
import { Routes, Route, Link, useLocation, useSearchParams } from 'react-router-dom';
import { 
  FileText, TrendingUp, Users, ShoppingBag, Search, Filter, 
  BarChart3, RefreshCw, Layers, Calendar, Activity, CheckCircle, 
  ShieldCheck, ArrowRight, Percent, PieChart, Landmark,
  Scale, ArrowUpRight, ArrowDownRight, CheckCircle2, AlertTriangle, BookOpen, X
} from 'lucide-react';

const PesoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`${className || 'w-5 h-5'} inline-flex items-center justify-center font-black leading-none text-base`}>₱</span>
);
import ExportButton, { ExportData } from '../components/ExportButton';
import { PaginationControls } from '../components/PaginationControls';
import { TableScrollContainer } from '../components/shared/TableScrollContainer';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter, computePeriodDates } from '../components/shared/TableFilterToolbar';
import { getCurrentCalendarMonthRange } from '../utils/dateFilterUtils';
import TrialBalanceWorkspace from '../components/reports/TrialBalanceWorkspace';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/apiClient';

const ASSET_TYPES = new Set(['ASSET', 'RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET']);
const LIABILITY_TYPES = new Set(['LIABILITY', 'PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY']);
const EQUITY_TYPES = new Set(['EQUITY']);
const REVENUE_TYPES = new Set(['REVENUE', 'OTHER_INCOME', 'INCOME']);
const EXPENSE_TYPES = new Set(['EXPENSE', 'COST_OF_SALES', 'COGS', 'COST_OF_GOODS_SOLD', 'OTHER_EXPENSE']);

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const formatPercent = (val: number | string) => {
  const num = typeof val === 'number' ? val : parseFloat(val || '0');
  if (isNaN(num)) return '0.0%';
  return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
};

// ==========================================
// REPORTS OVERVIEW & EXECUTIVE DASHBOARD
// ==========================================
const ReportsOverview = () => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'statements' | 'registers' | 'subledgers' | 'dimensional'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadingSummary(true);
    setSummaryError(null);
    apiFetch<any>('/api/reports/summary')
      .then(data => {
        if (!active) return;
        setSummaryData(data || null);
      })
      .catch(err => {
        if (!active) return;
        console.error('Failed to load financial summary:', err);
        setSummaryError(err?.message || 'Unable to load authoritative report summary.');
      })
      .finally(() => {
        if (active) setLoadingSummary(false);
      });
    return () => { active = false; };
  }, []);

  // Master Consolidated Template Cards (Eliminates duplicates, unifies source datasets)
  const masterCards = [
    { 
      id: 'general-ledger-master',
      title: 'General Ledger & Journal Register', 
      path: '/reports/general-ledger', 
      category: 'registers',
      desc: 'Authoritative unified register for account ledgers, chronological journal entries, cashbook receipts/disbursements, account schedules, and transaction details.', 
      icon: BookOpen, 
      color: 'indigo',
      badge: 'Unified Ledger',
      source: 'General Ledger & Journal Entries'
    },
    { 
      id: 'balance-sheet-master',
      title: 'Balance Sheet & Financial Position', 
      path: '/reports/balance-sheet', 
      category: 'statements',
      desc: 'Complete statement of financial position with interactive single-period and period-over-period comparative analysis, working capital metrics, and solvency ratios.', 
      icon: TrendingUp, 
      color: 'blue',
      badge: 'Financial Statement',
      source: 'Source: Asset, Liability & Equity Ledgers'
    },
    { 
      id: 'income-statement-master',
      title: 'Income Statement & Profitability (P&L)', 
      path: '/reports/income-statement', 
      category: 'statements',
      desc: 'Revenue, cost of goods sold, operating expenses, gross profit margin %, net margin %, and comparative period-over-period variance analysis.', 
      icon: Activity, 
      color: 'emerald',
      badge: 'Financial Statement',
      source: 'Source: Revenue & Expense Ledgers'
    },
    { 
      id: 'trial-balance-master',
      title: 'Trial Balance & Ledger Verification', 
      path: '/reports/trial-balance', 
      category: 'statements',
      desc: 'Consolidated debit and credit balances with automated 100% Debit = Credit health check widget and percentage asset/liability distribution.', 
      icon: Scale, 
      color: 'violet',
      badge: 'Reconciliation',
      source: 'Source: All Chart of Accounts Balances'
    },
    { 
      id: 'cash-flow-master',
      title: 'Statement of Cash Flows', 
      path: '/reports/cash-flow', 
      category: 'statements',
      desc: 'Operating, investing, and financing cash activity analysis with net cash movement KPI widgets and cash conversion indicators.', 
      icon: PesoIcon, 
      color: 'amber',
      badge: 'Cash Analysis',
      source: 'Source: Cash & Cash Equivalent GL Accounts'
    },
    { 
      id: 'equity-master',
      title: 'Statement of Changes in Equity', 
      path: '/reports/changes-in-equity', 
      category: 'statements',
      desc: 'Owner equity components, share capital, retained earnings breakdown, and net income allocations.', 
      icon: PieChart, 
      color: 'rose',
      badge: 'Equity Analysis',
      source: 'Source: Owner Equity & Retained Earnings Accounts'
    },
    { 
      id: 'subledger-aging-master',
      title: 'Accounts Subledgers & Aging Hub', 
      path: '/reports/ar-aging', 
      category: 'subledgers',
      desc: 'Customer Accounts Receivable aging, Vendor Accounts Payable aging schedules, and Bank Reconciliation match audits.', 
      icon: Users, 
      color: 'sky',
      badge: 'Subledger & AR/AP',
      source: 'Source: Customer Invoices, Vendor Bills & Bank Statements'
    },
    { 
      id: 'dimensional-audit-master',
      title: 'Dimensional Analytics & Audit Trail', 
      path: '/reports/department-report', 
      category: 'dimensional',
      desc: 'Financial performance by Department, Cost Center, Project, Branch location, and immutable audit log inspection.', 
      icon: ShieldCheck, 
      color: 'purple',
      badge: 'Governance & Analytics',
      source: 'Source: Dimensional Tags & Immutable System Audit Logs'
    },
  ];

  const filteredCards = masterCards.filter(c => {
    const matchesCat = selectedCategory === 'all' || c.category === selectedCategory;
    const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.desc.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Financial Reporting
            </span>
            <span className="text-xs font-semibold text-slate-400">Verified Financial Statements</span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mt-1">
            Financial Reports & Executive Analytics Hub
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Consolidated financial statements, statutory registers, and subledger aging reports prepared directly from your company books.
          </p>
        </div>
      </div>

      {/* EXECUTIVE KPI SUMMARY WIDGETS */}
      {summaryError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{summaryError}</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Trial Balance Health Check */}
        <Link to="trial-balance" className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 transition-colors shadow-xs relative overflow-hidden group block">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Trial Balance Integrity</span>
            <div className={`p-2 rounded-xl border ${
              summaryData?.tbIntegrityStatus === 'IMBALANCED'
                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-900/40'
                : summaryData?.tbIntegrityStatus === 'OK'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/40'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
            }`}>
              {summaryData?.tbIntegrityStatus === 'IMBALANCED' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-black text-slate-900 dark:text-slate-100">
              {loadingSummary ? 'Verifying...' : (summaryData?.tbIntegrityLabel || 'Unavailable')}
            </div>
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold mt-1 ${
              summaryData?.tbIntegrityStatus === 'IMBALANCED'
                ? 'text-rose-600 dark:text-rose-400'
                : summaryData?.tbIntegrityStatus === 'OK'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}>
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate" title={summaryData?.tbIntegrityExplanation || ''}>
                {loadingSummary ? 'Querying posted GL...' : (summaryData?.tbIntegrityExplanation || 'No posted entries yet')}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex justify-between">
            <span>{summaryData?.postedJournalLineCount ?? 0} Verified Ledger Lines</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">Inspect TB →</span>
          </div>
        </Link>

        {/* KPI 2: Net Profit Margin % Widget */}
        <Link to="income-statement" className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 transition-colors shadow-xs relative overflow-hidden group block">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Net Profit Margin %</span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-black text-slate-900 dark:text-slate-100 tabular-nums">
              {loadingSummary
                ? 'Calculating...'
                : summaryData?.hasPnlRecords && summaryData?.netProfitMargin != null
                ? `${summaryData.netProfitMargin.toFixed(1)}%`
                : 'No P&L Data'}
            </div>
            <div className={`flex items-center gap-1 text-[11px] font-semibold mt-1 ${
              !summaryData?.hasPnlRecords
                ? 'text-slate-500 dark:text-slate-400'
                : (summaryData?.netIncome || 0) >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}>
              {(summaryData?.netIncome || 0) >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 shrink-0" /> : <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate">
                {loadingSummary
                  ? 'Computing P&L...'
                  : summaryData?.hasPnlRecords
                  ? `Net Income: ${formatCurrency(summaryData?.netIncome || 0)}`
                  : 'No posted revenue or expense entries'}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex justify-between">
            <span>Rev: {formatCurrency(summaryData?.totalRevenue || 0)}</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">View P&L →</span>
          </div>
        </Link>

        {/* KPI 3: Working Capital & Solvency */}
        <Link to="balance-sheet" className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 transition-colors shadow-xs relative overflow-hidden group block">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Solvency & Working Capital</span>
            <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-900/40">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-black text-slate-900 dark:text-slate-100 tabular-nums">
              {loadingSummary
                ? 'Calculating...'
                : summaryData?.solvencyStatus && summaryData.solvencyStatus !== 'NO_RECORDS'
                ? formatCurrency(summaryData?.workingCapital || 0)
                : 'No BS Data'}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 mt-1">
              <span className="truncate" title={summaryData?.solvencyExplanation || ''}>
                {loadingSummary
                  ? 'Querying Assets & Liabilities...'
                  : summaryData?.currentRatio != null
                  ? `Current Ratio: ${summaryData.currentRatio.toFixed(2)}x`
                  : summaryData?.solvencyExplanation || 'Current ratio N/A'}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex justify-between">
            <span>Assets: {formatCurrency(summaryData?.totalAssets || 0)}</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">Balance Sheet →</span>
          </div>
        </Link>

        {/* KPI 4: Ledger Posting & Audit Trail */}
        <Link to="audit-trail-report" className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 transition-colors shadow-xs relative overflow-hidden group block">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Posting & Audit Activity</span>
            <div className="p-2 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 rounded-xl border border-purple-100 dark:border-purple-900/40">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-1.5 tabular-nums">
              <span>{loadingSummary ? 'Loading...' : `${summaryData?.postedJournalCount ?? 0} Posted JEs`}</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 mt-1">
              <span>
                {summaryData?.unpostedJournalCount ?? 0} Pending/Draft • {summaryData?.auditVerifiedCount ?? 0} Audit Events
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex justify-between">
            <span>Live Ledger</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">Audit Trail →</span>
          </div>
        </Link>
      </div>

      {/* FILTER & CATEGORY TOOLBAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {[
            { id: 'all', label: 'All Master Reports (8)' },
            { id: 'statements', label: 'Financial Statements' },
            { id: 'registers', label: 'Ledgers & Registers' },
            { id: 'subledgers', label: 'Subledgers & Aging' },
            { id: 'dimensional', label: 'Dimensional & Audit' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedCategory(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                selectedCategory === tab.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search master reports..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      </div>

      {/* CONSOLIDATED MASTER REPORT CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-5">
        {filteredCards.map((rc) => {
          const Icon = rc.icon;
          return (
            <Link 
              key={rc.id}
              to={rc.path} 
              className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/40 group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    {rc.badge}
                  </span>
                </div>

                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {rc.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {rc.desc}
                </p>
              </div>

              <div className="mt-5 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 italic">
                  {rc.source}
                </span>
                <div className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                  <span>Open Master Report</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          );
        })}

        {filteredCards.length === 0 && (
          <div className="col-span-full p-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-slate-400">
            No master report matched your search filter.
          </div>
        )}
      </div>
    </div>
  );
};


// ==========================================
// UNIFIED MASTER REPORT VIEWERS
// ==========================================

// 1. MASTER GENERAL LEDGER & JOURNAL REGISTER VIEW
const MasterGeneralLedgerView = () => {
  const { activeCompany } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'ledger' | 'cashbook' | 'schedule' | 'detail'>(() => {
    const t = searchParams.get('tab');
    return t === 'cashbook' || t === 'schedule' || t === 'detail' ? t : 'ledger';
  });
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const defaultMonthRange = useMemo(() => getCurrentCalendarMonthRange(), []);
  const [startDate, setStartDate] = useState(() => searchParams.get('startDate') || defaultMonthRange.dateFrom);
  const [endDate, setEndDate] = useState(() => searchParams.get('endDate') || defaultMonthRange.dateTo);
  const [accountIdFilter, setAccountIdFilter] = useState(() => searchParams.get('accountId') || '');
  const [accountCodeFilter, setAccountCodeFilter] = useState(() => searchParams.get('accountCode') || '');
  const [accountNameFilter, setAccountNameFilter] = useState(() => searchParams.get('accountName') || '');
  const [accountingPeriodIdFilter, setAccountingPeriodIdFilter] = useState(() => searchParams.get('accountingPeriodId') || '');
  const [signedOff, setSignedOff] = useState(false);
  const [signNote, setSignNote] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const endpointMap = {
    ledger: '/api/reports/general-ledger',
    cashbook: '/api/reports/cashbook',
    schedule: '/api/reports/account-schedule',
    detail: '/api/reports/transaction-detail',
  };

  useEffect(() => {
    const urlAccId = searchParams.get('accountId') || '';
    const urlAccCode = searchParams.get('accountCode') || '';
    const urlAccName = searchParams.get('accountName') || '';
    const urlPeriodId = searchParams.get('accountingPeriodId') || '';
    const urlStart = searchParams.get('startDate') || '';
    const urlEnd = searchParams.get('endDate') || '';
    if (urlAccId !== accountIdFilter) setAccountIdFilter(urlAccId);
    if (urlAccCode !== accountCodeFilter) setAccountCodeFilter(urlAccCode);
    if (urlAccName !== accountNameFilter) setAccountNameFilter(urlAccName);
    if (urlPeriodId !== accountingPeriodIdFilter) setAccountingPeriodIdFilter(urlPeriodId);
    if (urlStart && urlStart !== startDate) setStartDate(urlStart);
    if (urlEnd && urlEnd !== endDate) setEndDate(urlEnd);
  }, [searchParams]);

  const clearAccountFilter = () => {
    setAccountIdFilter('');
    setAccountCodeFilter('');
    setAccountNameFilter('');
    const next = new URLSearchParams(searchParams);
    next.delete('accountId');
    next.delete('accountCode');
    next.delete('accountName');
    setSearchParams(next, { replace: true });
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (accountingPeriodIdFilter && !startDate && !endDate) {
        params.append('accountingPeriodId', accountingPeriodIdFilter);
      } else {
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
      }
      if (accountIdFilter) params.append('accountId', accountIdFilter);
      const json = await apiFetch<any>(`${endpointMap[activeTab]}?${params.toString()}`);
      setData(Array.isArray(json) ? json : (json.data || json.items || []));
    } catch (err) {
      console.error('Failed to fetch general ledger view:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    setPageIndex(0);
  }, [activeTab, startDate, endDate, accountIdFilter, accountingPeriodIdFilter]);

  const filteredData = data.filter(item => {
    if (accountIdFilter && item.accountId && item.accountId !== accountIdFilter) {
      return false;
    }
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      item.accountName?.toLowerCase().includes(term) ||
      item.accountCode?.toLowerCase().includes(term) ||
      item.journalNumber?.toLowerCase().includes(term) ||
      item.description?.toLowerCase().includes(term)
    );
  });

  useEffect(() => {
    setPageIndex(0);
  }, [searchTerm, pageSize]);

  const totalDebits = filteredData.reduce((acc, curr) => acc + (curr.debit || curr.totalDebit || 0), 0);
  const totalCredits = filteredData.reduce((acc, curr) => acc + (curr.credit || curr.totalCredit || 0), 0);

  const exportHeaders = {
    ledger: ['Entry Date', 'Journal #', 'Account Code & Name', 'Line Description', 'Debit (PHP)', 'Credit (PHP)'],
    cashbook: ['Date', 'Journal #', 'Cash Account Name', 'Description', 'Receipts (Debit)', 'Disbursements (Credit)'],
    schedule: ['Account Code', 'Account Name', 'Type', 'Total Debit', 'Total Credit', 'Net Movement', 'Closing Balance'],
    detail: ['Journal #', 'Entry Date', 'Status', 'Description'],
  }[activeTab];

  const exportRows = filteredData.map(item => {
    if (activeTab === 'ledger') {
      return [
        item.entryDate || '-',
        item.journalNumber || '-',
        `${item.accountCode || ''} - ${item.accountName || ''}`,
        item.description || item.lineDescription || '-',
        formatCurrency(item.debit),
        formatCurrency(item.credit)
      ];
    } else if (activeTab === 'cashbook') {
      return [
        item.entryDate || '-',
        item.journalNumber || '-',
        item.accountName || '-',
        item.description || '-',
        formatCurrency(item.debit),
        formatCurrency(item.credit)
      ];
    } else if (activeTab === 'schedule') {
      return [
        item.accountCode,
        item.accountName,
        item.accountType,
        formatCurrency(item.totalDebit),
        formatCurrency(item.totalCredit),
        formatCurrency(item.netMovement),
        formatCurrency(item.closingBalance)
      ];
    } else {
      return [item.journalNumber, item.entryDate, item.status, item.description || '-'];
    }
  });

  const exportData: ExportData = {
    filename: `General_Ledger_Register_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: `General Ledger & Journal Register (${activeTab.toUpperCase()})`,
    subtitle: `Company: ${activeCompany?.legalName || 'Active Company'} | Generated: ${new Date().toLocaleString()}`,
    companyName: activeCompany?.legalName || 'Active Company',
    headers: exportHeaders,
    rows: exportRows
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Master General Ledger & Journal Register
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unified source dataset for posted GL entries, chronological journals, cashbook receipts/disbursements, and account schedules.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
              />
              <span className="text-slate-400">to</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
              />
            </div>
            <button
              onClick={fetchData}
              className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <ExportButton data={exportData} disabled={loading} />
          </div>
        </div>

        {/* View Selection Tabs (Unified Submodules) */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 flex-wrap gap-2">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {[
              { id: 'ledger', label: 'General Ledger' },
              { id: 'cashbook', label: 'Cashbook Ledger (Cash & Bank)' },
              { id: 'schedule', label: 'Account Schedule Breakdown' },
              { id: 'detail', label: 'Transaction Log Detail' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {accountIdFilter && (
              <div
                data-testid="gl-account-filter-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold"
              >
                <span>Account: {accountCodeFilter || accountIdFilter} {accountNameFilter ? `· ${accountNameFilter}` : ''}</span>
                <button
                  type="button"
                  onClick={clearAccountFilter}
                  className="hover:text-indigo-900 dark:hover:text-white cursor-pointer"
                  title="Clear account filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search register entries..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>
        </div>
      </div>

      {/* KPI METRIC BAR */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-400">Total Register Items</div>
          <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5 tabular-nums">{filteredData.length} records</div>
        </div>
        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-400">Total Debits</div>
          <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-0.5 tabular-nums">{formatCurrency(totalDebits)}</div>
        </div>
        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-400">Total Credits</div>
          <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">{formatCurrency(totalCredits)}</div>
        </div>
        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-400">Ledger Imbalance</div>
          <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5 flex items-center gap-1 tabular-nums">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>{formatCurrency(Math.abs(totalDebits - totalCredits))}</span>
          </div>
        </div>
      </div>

      {/* DATA TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading register dataset...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[800px]">
                <thead className="sticky-table-header bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 uppercase font-semibold border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    {exportHeaders.map((h, i) => (
                      <th key={i} className="py-3 px-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {exportRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200 tabular-nums">{cell}</td>
                      ))}
                    </tr>
                  ))}
                  {exportRows.length === 0 && (
                    <tr>
                      <td colSpan={exportHeaders.length} className="py-12 text-center text-slate-400">
                        No matching records found for this register view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalCount={exportRows.length}
              itemCount={exportRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).length}
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(pageIndex + 1) * pageSize < exportRows.length}
              onPrevPage={() => setPageIndex(p => Math.max(0, p - 1))}
              onNextPage={() => setPageIndex(p => ((p + 1) * pageSize < exportRows.length ? p + 1 : p))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, Math.ceil(exportRows.length / pageSize) - 1))}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPageIndex(0);
              }}
              loading={loading}
            />
          </>
        )}
      </div>
    </div>
  );
};


// 2. MASTER BALANCE SHEET & FINANCIAL POSITION VIEW
const MasterBalanceSheetView = () => {
  const { activeCompany } = useAuth();
  const [viewMode, setViewMode] = useState<'standard' | 'comparative'>('standard');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const defaultMonthRange = useMemo(() => getCurrentCalendarMonthRange(), []);
  const [startDate, setStartDate] = useState(defaultMonthRange.dateFrom);
  const [endDate, setEndDate] = useState(defaultMonthRange.dateTo);

  const fetchData = async () => {
    try {
      setLoading(true);
      const endpoint = viewMode === 'standard' ? '/api/reports/balance-sheet' : '/api/reports/comparative-balance-sheet';
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const json = await apiFetch<any>(`${endpoint}?${params.toString()}`);
      setData(Array.isArray(json) ? json : (json.comparison || json.data || []));
    } catch (err) {
      console.error('Failed to fetch balance sheet view:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [viewMode, startDate, endDate]);

  const totalAssets = data.filter(i => ASSET_TYPES.has(String(i.accountType || '').toUpperCase())).reduce((acc, curr) => acc + (curr.balance || curr.currentPeriodBalance || 0), 0);
  const totalLiabilities = data.filter(i => LIABILITY_TYPES.has(String(i.accountType || '').toUpperCase())).reduce((acc, curr) => acc + (curr.balance || curr.currentPeriodBalance || 0), 0);
  const totalEquity = data.filter(i => EQUITY_TYPES.has(String(i.accountType || '').toUpperCase())).reduce((acc, curr) => acc + (curr.balance || curr.currentPeriodBalance || 0), 0);
  const workingCapital = totalAssets - totalLiabilities;
  const debtToEquity = totalEquity > 0 ? (totalLiabilities / totalEquity) * 100 : 0;

  const exportHeaders = viewMode === 'standard' 
    ? ['Account Code', 'Account Name', 'Type', 'Balance (PHP)', '% of Total Assets']
    : ['Code', 'Account Name', 'Type', 'Current Period', 'Prior Period', 'Variance (PHP)', 'Variance %'];

  const exportRows = data.map(item => {
    if (viewMode === 'standard') {
      const pct = totalAssets > 0 ? ((item.balance / totalAssets) * 100).toFixed(1) + '%' : '0.0%';
      return [item.accountCode, item.accountName, item.accountType, formatCurrency(item.balance), pct];
    } else {
      return [
        item.accountCode,
        item.accountName,
        item.accountType,
        formatCurrency(item.currentPeriodBalance),
        formatCurrency(item.priorPeriodBalance),
        formatCurrency(item.varianceAmount),
        item.variancePercent || '0.0%'
      ];
    }
  });

  const exportData: ExportData = {
    filename: `Balance_Sheet_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: `Balance Sheet & Financial Position (${viewMode.toUpperCase()})`,
    subtitle: `Company: ${activeCompany?.legalName || 'Active Company'} | Generated: ${new Date().toLocaleString()}`,
    companyName: activeCompany?.legalName || 'Active Company',
    headers: exportHeaders,
    rows: exportRows
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Master Balance Sheet & Financial Position
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Statement of financial position with interactive period comparison toggles and solvency indicators.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
              <button
                onClick={() => setViewMode('standard')}
                className={`px-3 py-1 rounded-lg transition-all ${viewMode === 'standard' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-slate-500'}`}
              >
                Standard Position
              </button>
              <button
                onClick={() => setViewMode('comparative')}
                className={`px-3 py-1 rounded-lg transition-all ${viewMode === 'comparative' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-slate-500'}`}
              >
                Comparative Mode
              </button>
            </div>
            <ExportButton data={exportData} disabled={loading} />
          </div>
        </div>
      </div>

      {/* EXECUTIVE WIDGETS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Total Assets</span>
          <div className="text-xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(totalAssets)}</div>
          <div className="text-[11px] text-slate-400 mt-1">100% Asset Base</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Total Liabilities</span>
          <div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(totalLiabilities)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Obligations & Payables</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Total Stockholder Equity</span>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(totalEquity)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Net Book Value</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Debt-to-Equity Ratio</span>
          <div className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">
            {totalEquity > 0 ? `${debtToEquity.toFixed(1)}%` : data.length === 0 ? 'No BS Data' : 'N/A'}
          </div>
          <div className={`text-[11px] font-semibold mt-1 ${
            data.length === 0
              ? 'text-slate-400'
              : totalEquity <= 0
              ? 'text-rose-600'
              : debtToEquity <= 150
              ? 'text-emerald-600'
              : 'text-amber-600'
          }`}>
            {data.length === 0
              ? 'No posted balance sheet accounts'
              : totalEquity <= 0
              ? 'Zero or negative equity'
              : debtToEquity <= 150
              ? 'Conservative Leverage (<=150%)'
              : 'Elevated Leverage (>150%)'}
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading Balance Sheet...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 uppercase font-semibold border-b border-slate-100 dark:border-slate-800">
                <tr>
                  {exportHeaders.map((h, i) => (
                    <th key={i} className="py-3.5 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {exportRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{cell}</td>
                    ))}
                  </tr>
                ))}
                {exportRows.length === 0 && (
                  <tr>
                    <td colSpan={exportHeaders.length} className="py-12 text-center text-slate-400">
                      No accounts found for this balance sheet view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};


// 3. MASTER INCOME STATEMENT & PROFITABILITY VIEW
const MasterIncomeStatementView = () => {
  const { activeCompany } = useAuth();
  const [viewMode, setViewMode] = useState<'standard' | 'comparative'>('standard');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const endpoint = viewMode === 'standard' ? '/api/reports/income-statement' : '/api/reports/comparative-income-statement';
      const json = await apiFetch<any>(endpoint);
      setData(Array.isArray(json) ? json : (json.comparison || json.data || []));
    } catch (err) {
      console.error('Failed to fetch income statement:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [viewMode]);

  const totalRevenues = data.filter(i => REVENUE_TYPES.has(String(i.accountType || '').toUpperCase()) || i.lineItem?.includes('Revenue')).reduce((acc, curr) => acc + (curr.balance || curr.currentPeriod || 0), 0);
  const totalExpenses = data.filter(i => EXPENSE_TYPES.has(String(i.accountType || '').toUpperCase()) || i.lineItem?.includes('Expense')).reduce((acc, curr) => acc + (curr.balance || curr.currentPeriod || 0), 0);
  const netIncome = totalRevenues - totalExpenses;
  const netProfitMargin = totalRevenues > 0 ? (netIncome / totalRevenues) * 100 : 0;

  const exportHeaders = viewMode === 'standard'
    ? ['Account Code', 'Account Name', 'Type', 'Amount (PHP)', '% of Net Revenue']
    : ['Financial Line Item', 'Current Period', 'Prior Period', 'Variance (PHP)', 'Variance %'];

  const exportRows = data.map(item => {
    if (viewMode === 'standard') {
      const pct = totalRevenues > 0 ? ((item.balance / totalRevenues) * 100).toFixed(1) + '%' : '0.0%';
      return [item.accountCode || '-', item.accountName || item.lineItem, item.accountType || 'P&L', formatCurrency(item.balance || item.currentPeriod), pct];
    } else {
      return [
        item.lineItem || item.accountName,
        formatCurrency(item.currentPeriod),
        formatCurrency(item.priorPeriod),
        formatCurrency(item.varianceAmount),
        item.variancePercent || '0.0%'
      ];
    }
  });

  const exportData: ExportData = {
    filename: `Income_Statement_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: `Income Statement (P&L) - (${viewMode.toUpperCase()})`,
    subtitle: `Company: ${activeCompany?.legalName || 'Active Company'} | Generated: ${new Date().toLocaleString()}`,
    companyName: activeCompany?.legalName || 'Active Company',
    headers: exportHeaders,
    rows: exportRows
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Master Income Statement & Profitability (P&L)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Comprehensive statement of revenues, cost of sales, operating expenses, and net profit margin analysis.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
              <button
                onClick={() => setViewMode('standard')}
                className={`px-3 py-1 rounded-lg transition-all ${viewMode === 'standard' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-slate-500'}`}
              >
                Standard P&L
              </button>
              <button
                onClick={() => setViewMode('comparative')}
                className={`px-3 py-1 rounded-lg transition-all ${viewMode === 'comparative' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-slate-500'}`}
              >
                Comparative P&L
              </button>
            </div>
            <ExportButton data={exportData} disabled={loading} />
          </div>
        </div>
      </div>

      {/* EXECUTIVE KPI WIDGETS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Total Net Revenue</span>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(totalRevenues)}</div>
          <div className="text-[11px] text-slate-400 mt-1">100% Gross Top-line</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Total Operating Expenses</span>
          <div className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1">{formatCurrency(totalExpenses)}</div>
          <div className="text-[11px] text-slate-400 mt-1">OpEx & Costs</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Net Profit</span>
          <div className="text-xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(netIncome)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Bottom Line Profit</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-400">Net Margin %</span>
          <div className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">
            {totalRevenues > 0 ? `${netProfitMargin.toFixed(1)}%` : totalExpenses > 0 ? 'N/A' : 'No P&L Data'}
          </div>
          <div className={`text-[11px] font-semibold mt-1 ${
            totalRevenues === 0 && totalExpenses === 0
              ? 'text-slate-400'
              : netIncome >= 0
              ? 'text-emerald-600'
              : 'text-rose-600'
          }`}>
            {totalRevenues === 0 && totalExpenses === 0
              ? 'No posted P&L activity'
              : netIncome >= 0
              ? 'Net Profitable Period'
              : 'Net Loss Period'}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading Income Statement...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 uppercase font-semibold border-b border-slate-100 dark:border-slate-800">
                <tr>
                  {exportHeaders.map((h, i) => (
                    <th key={i} className="py-3.5 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {exportRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{cell}</td>
                    ))}
                  </tr>
                ))}
                {exportRows.length === 0 && (
                  <tr>
                    <td colSpan={exportHeaders.length} className="py-12 text-center text-slate-400">
                      No revenue or expense records found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};


// GENERIC AUTHORITATIVE REPORT VIEW (FOR SINGLE PURPOSE REPORTS LIKE TRIAL BALANCE, CASH FLOW, ETC.)
const GenericReportView = ({ title, endpoint, headersMapper, rowMapper }: { title: string, endpoint: string, headersMapper: string[], rowMapper: (item: any) => (string | number)[] }) => {
  const { activeCompany } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Authoritative full-history table filtering: default datePeriod = 'ALL', sortOrder = 'DESC', pageSize = 20
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [signedOff, setSignedOff] = useState(false);
  const [signNote, setSignNote] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const effectiveDateRange = useMemo(() => {
    if (datePeriod === 'ALL') {
      return { fromDate: '', toDate: '' };
    }
    if (datePeriod === 'CUSTOM') {
      return { fromDate: customFromDate, toDate: customToDate };
    }
    return computePeriodDates(datePeriod);
  }, [datePeriod, customFromDate, customToDate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (effectiveDateRange.fromDate) params.append('startDate', effectiveDateRange.fromDate);
      if (effectiveDateRange.toDate) params.append('endDate', effectiveDateRange.toDate);
      const json = await apiFetch<any>(`${endpoint}?${params.toString()}`);
      setData(Array.isArray(json) ? json : (json.data || json.comparison || []));
      setMetadata(json?.metadata || null);
    } catch (err) {
      console.error(`Failed to fetch ${title}:`, err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPageIndex(0);
    fetchData();
  }, [effectiveDateRange.fromDate, effectiveDateRange.toDate]);

  const filteredData = useMemo(() => {
    let result = [...data];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => {
        const row = rowMapper(item);
        return row.some(cell => String(cell).toLowerCase().includes(q));
      });
    }
    if (sortOrder === 'ASC') {
      result.reverse();
    }
    return result;
  }, [data, searchQuery, sortOrder, rowMapper]);

  const pagedData = useMemo(() => {
    return filteredData.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }, [filteredData, pageIndex, pageSize]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSortOrder('DESC');
    setDatePeriod('ALL');
    setCustomFromDate('');
    setCustomToDate('');
    setPageIndex(0);
  };

  const handleSignOff = async () => {
    try {
      await apiFetch('/api/reports/sign-off', {
        method: 'POST',
        body: { reportName: title, notes: signNote } as any
      });
      setSignedOff(true);
    } catch (err) {
      console.error('Sign off failed:', err);
    }
  };

  const exportData: ExportData = {
    filename: `${title.replace(/\s+/g, '_')}_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: title,
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Generated: ${metadata?.generatedAt || new Date().toLocaleString()}`,
    companyName: activeCompany?.legalName || 'Active Company',
    headers: headersMapper,
    rows: filteredData.map(rowMapper),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Generated by <span className="font-medium text-slate-700 dark:text-slate-300">{metadata?.generatedBy || 'System'}</span> at {metadata?.generatedAt ? new Date(metadata.generatedAt).toLocaleString() : 'Just now'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={fetchData}
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <ExportButton data={exportData} disabled={loading} />
        </div>
      </div>

      <TableFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={`Search within ${title.toLowerCase()}...`}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        datePeriod={datePeriod}
        onDatePeriodChange={setDatePeriod}
        fromDate={effectiveDateRange.fromDate}
        toDate={effectiveDateRange.toDate}
        onDateRangeChange={(range) => {
          setDatePeriod('CUSTOM');
          setCustomFromDate(range.fromDate);
          setCustomToDate(range.toDate);
        }}
        pageSize={pageSize}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setPageIndex(0);
        }}
        totalCount={data.length}
        filteredCount={filteredData.length}
        onResetFilters={handleResetFilters}
      />

      {loading ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading report data...
        </div>
      ) : (
        <TableScrollContainer
          maxHeight="calc(100vh - 360px)"
          minHeight="280px"
          stickyHeader={true}
          title={`${title} (${filteredData.length})`}
          totalRecordsCount={filteredData.length}
          pagination={{
            pageIndex,
            pageSize,
            pageSizeOptions: [20, 25, 50, 100],
            totalRecords: filteredData.length,
            itemCount: pagedData.length,
            onPageChange: setPageIndex,
            onPageSizeChange: (newSize) => {
              setPageSize(newSize);
              setPageIndex(0);
            },
            loading,
          }}
        >
          <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[750px]">
            <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 uppercase font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                {headersMapper.map((h, i) => (
                  <th key={i} className="py-3.5 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {pagedData.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                  {rowMapper(item).map((cell, cIdx) => (
                    <td key={cIdx} className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{cell}</td>
                  ))}
                </tr>
              ))}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={headersMapper.length} className="py-12 text-center text-slate-400">
                    No records found matching the active filters for this report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScrollContainer>
      )}

      {/* Report Sign-off & Certification */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Report Certification & Sign-off
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {signedOff ? 'This report has been officially certified and signed off.' : 'Certify this financial report for audit and compliance review.'}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {!signedOff ? (
            <>
              <input 
                type="text" 
                placeholder="Enter sign-off notes / reviewer comments..."
                value={signNote}
                onChange={e => setSignNote(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex-1 sm:w-64"
              />
              <button
                onClick={handleSignOff}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shrink-0"
              >
                Sign Off & Seal
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <CheckCircle className="w-4 h-4" />
              Certified & Signed
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


// ==========================================
// MAIN ROUTER & ROUTE DIRECTORY
// ==========================================
export default function Reports() {
  const location = useLocation();
  const isRoot = location.pathname === '/reports' || location.pathname === '/reports/';

  return (
    <div className="w-full space-y-4">
      <div className="flex space-x-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-500 dark:text-slate-400">Financial Reports</span>
        {!isRoot && <span>/</span>}
        {!isRoot && <span className="text-slate-800 dark:text-slate-200 font-bold capitalize">{location.pathname.split('/').pop()?.replace(/-/g, ' ')}</span>}
      </div>

      <Routes>
        <Route path="/" element={<ReportsOverview />} />
        
        {/* Unified Master Routes */}
        <Route path="general-ledger" element={<MasterGeneralLedgerView />} />
        <Route path="balance-sheet" element={<MasterBalanceSheetView />} />
        <Route path="income-statement" element={<MasterIncomeStatementView />} />

        {/* Backward Compatible Legacy Routes -> Map cleanly into Master Views */}
        <Route path="general-journal" element={<MasterGeneralLedgerView />} />
        <Route path="cashbook" element={<MasterGeneralLedgerView />} />
        <Route path="account-schedule" element={<MasterGeneralLedgerView />} />
        <Route path="transaction-detail" element={<MasterGeneralLedgerView />} />
        <Route path="comparative-balance-sheet" element={<MasterBalanceSheetView />} />
        <Route path="comparative-income-statement" element={<MasterIncomeStatementView />} />

        {/* Authoritative Trial Balance Workspace */}
        <Route path="trial-balance" element={<TrialBalanceWorkspace />} />

        <Route path="cash-flow" element={
          <GenericReportView 
            title="Statement of Cash Flows"
            endpoint="/api/reports/cash-flow"
            headersMapper={['Date', 'Account', 'Description', 'Net Cash (PHP)']}
            rowMapper={(cf) => [
              cf.entryDate,
              cf.accountName,
              cf.description || '-',
              formatCurrency((cf.debit || 0) - (cf.credit || 0))
            ]}
          />
        } />

        <Route path="changes-in-equity" element={
          <GenericReportView 
            title="Statement of Changes in Equity"
            endpoint="/api/reports/changes-in-equity"
            headersMapper={['Equity Component', 'Amount (PHP)']}
            rowMapper={(item) => [item.component, formatCurrency(item.amount)]}
          />
        } />

        <Route path="ar-aging" element={
          <GenericReportView 
            title="AR Aging Summary"
            endpoint="/api/reports/ar-aging"
            headersMapper={['Customer', 'Invoice #', 'Due Date', 'Balance Due']}
            rowMapper={(ar) => [ar.customerName, ar.invoiceNumber, ar.dueDate, formatCurrency(ar.balanceDue)]}
          />
        } />

        <Route path="ap-aging" element={
          <GenericReportView 
            title="AP Aging Summary"
            endpoint="/api/reports/ap-aging"
            headersMapper={['Vendor', 'Bill #', 'Due Date', 'Balance Due']}
            rowMapper={(ap) => [ap.vendorName, ap.billNumber, ap.dueDate, formatCurrency(ap.balanceDue)]}
          />
        } />

        <Route path="bank-reconciliation-report" element={
          <GenericReportView 
            title="Bank Reconciliation Report"
            endpoint="/api/reports/bank-reconciliation-report"
            headersMapper={['Statement Date', 'Statement Ending Balance', 'Book Ending Balance', 'Status']}
            rowMapper={(br) => [br.statementDate, formatCurrency(br.statementEndingBalance), formatCurrency(br.bookEndingBalance), br.status]}
          />
        } />

        <Route path="department-report" element={
          <GenericReportView 
            title="Department Report"
            endpoint="/api/reports/department-report"
            headersMapper={['Code', 'Department Name', 'Manager', 'Status']}
            rowMapper={(d) => [d.code, d.name, d.managerName || '-', d.status]}
          />
        } />

        <Route path="project-report" element={
          <GenericReportView 
            title="Project Report"
            endpoint="/api/reports/project-report"
            headersMapper={['Code', 'Project Name', 'Budget', 'Status']}
            rowMapper={(p) => [p.code, p.name, p.budgetAmount ? formatCurrency(p.budgetAmount) : '-', p.status]}
          />
        } />

        <Route path="branch-report" element={
          <GenericReportView 
            title="Branch Report"
            endpoint="/api/reports/branch-report"
            headersMapper={['Branch Code', 'Branch Name', 'Address', 'Main Branch']}
            rowMapper={(b) => [b.code, b.name, b.address || '-', b.isMainBranch ? 'Yes' : 'No']}
          />
        } />

        <Route path="audit-trail-report" element={
          <GenericReportView 
            title="Audit Trail Report"
            endpoint="/api/reports/audit-trail-report"
            headersMapper={['Timestamp', 'User Email', 'Action', 'Entity Type', 'Result']}
            rowMapper={(a) => [new Date(a.timestamp).toLocaleString(), a.userEmail || 'System', a.action, a.entityType, a.result]}
          />
        } />
      </Routes>
    </div>
  );
}
