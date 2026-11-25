import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Scale,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  CheckCircle,
  Calendar,
} from 'lucide-react';
import ExportButton, { ExportData } from '../ExportButton';
import { PaginationControls } from '../PaginationControls';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import { computeTrialBalanceSummary, validateTrialBalanceCertification } from '../../../shared/accountingGlUtils';
import { formatEnterpriseTimestamp } from '../../../shared/timestampUtils';

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string | null;
  debitTotal: number;
  creditTotal: number;
  broughtForwardDebit?: number;
  broughtForwardCredit?: number;
  broughtForwardNetBalance?: number;
  openingJournalDebit?: number;
  openingJournalCredit?: number;
  openingJournalNetBalance?: number;
  openingDebit: number;
  openingCredit: number;
  openingNetBalance: number;
  periodDebit: number;
  periodCredit: number;
  periodNetMovement: number;
  closingDebit: number;
  closingCredit: number;
  closingNetBalance: number;
  accountingPeriodId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

interface AccountingPeriodOption {
  id: string;
  name: string;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  status: string;
}

const formatCurrency = (centavos: number): string =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((centavos || 0) / 100);

const normalizeAccountGroup = (accountType: string): string => {
  const upper = String(accountType || '').toUpperCase();
  if (['ASSET', 'RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET'].includes(upper)) {
    return 'ASSET';
  }
  if (['LIABILITY', 'PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'].includes(upper)) {
    return 'LIABILITY';
  }
  if (upper === 'EQUITY') return 'EQUITY';
  if (['REVENUE', 'OTHER_INCOME'].includes(upper)) return 'REVENUE';
  if (['EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE'].includes(upper)) return 'EXPENSE';
  return upper;
};

export default function TrialBalanceWorkspace() {
  const { activeCompany } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [periods, setPeriods] = useState<AccountingPeriodOption[]>([]);
  const [accountingPeriodId, setAccountingPeriodId] = useState<string>(() => searchParams.get('accountingPeriodId') || '');
  const [startDate, setStartDate] = useState<string>(() => searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState<string>(() => searchParams.get('endDate') || '');
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>(() => searchParams.get('accountType') || 'ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showZeroBalances, setShowZeroBalances] = useState<boolean>(
    () => searchParams.get('includeZeroBalances') === 'true'
  );

  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pageIndex, setPageIndex] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(20);

  const [signedOff, setSignedOff] = useState<boolean>(false);
  const [latestCertification, setLatestCertification] = useState<any | null>(null);
  const [signOffHistory, setSignOffHistory] = useState<any[]>([]);
  const [showSignOffHistory, setShowSignOffHistory] = useState<boolean>(false);
  const [signingOff, setSigningOff] = useState<boolean>(false);
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const [signNote, setSignNote] = useState<string>('');

  // Load company accounting periods for the Period Selector
  useEffect(() => {
    let active = true;
    apiFetch<any>('/api/accounting/periods')
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        setPeriods(list);
      })
      .catch((err) => {
        console.error('Failed to load accounting periods for Trial Balance:', err);
      });
    return () => {
      active = false;
    };
  }, [activeCompany?.id]);

  const fetchTrialBalance = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const params = new URLSearchParams();
      if (accountingPeriodId) {
        params.append('accountingPeriodId', accountingPeriodId);
      } else {
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
      }
      if (showZeroBalances) {
        params.append('includeZeroBalances', 'true');
      }

      const json = await apiFetch<any>(`/api/reports/trial-balance?${params.toString()}`);
      setRows(Array.isArray(json) ? json : []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load Trial Balance.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSignOffStatus = async () => {
    try {
      const params = new URLSearchParams({
        reportName: 'Trial Balance & Ledger Verification',
      });
      if (accountingPeriodId) params.set('accountingPeriodId', accountingPeriodId);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const data = await apiFetch<any>(`/api/reports/sign-off?${params.toString()}`);
      setLatestCertification(data?.latestForScope || null);
      setSignedOff(Boolean(data?.latestForScope));
      setSignOffHistory(Array.isArray(data?.history) ? data.history : []);
    } catch {
      setLatestCertification(null);
      setSignedOff(false);
    }
  };

  useEffect(() => {
    fetchTrialBalance();
    fetchSignOffStatus();
    setPageIndex(0);
  }, [accountingPeriodId, startDate, endDate, showZeroBalances, activeCompany?.id]);

  // Sync key filters to URL query string cleanly
  useEffect(() => {
    const next = new URLSearchParams();
    if (accountingPeriodId) next.set('accountingPeriodId', accountingPeriodId);
    if (startDate) next.set('startDate', startDate);
    if (endDate) next.set('endDate', endDate);
    if (accountTypeFilter !== 'ALL') next.set('accountType', accountTypeFilter);
    if (showZeroBalances) next.set('includeZeroBalances', 'true');
    setSearchParams(next, { replace: true });
  }, [accountingPeriodId, startDate, endDate, accountTypeFilter, showZeroBalances]);

  const handlePeriodChange = (selectedId: string) => {
    setAccountingPeriodId(selectedId);
    if (!selectedId) {
      setStartDate('');
      setEndDate('');
      return;
    }
    const found = periods.find((p) => p.id === selectedId);
    if (found) {
      setStartDate(found.startDate);
      setEndDate(found.endDate);
    }
  };

  const handleCustomDateChange = (kind: 'start' | 'end', val: string) => {
    setAccountingPeriodId('');
    if (kind === 'start') setStartDate(val);
    else setEndDate(val);
  };

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showZeroBalances) {
        const hasActivity =
          Number(r.openingDebit || 0) !== 0 ||
          Number(r.openingCredit || 0) !== 0 ||
          Number(r.periodDebit || 0) !== 0 ||
          Number(r.periodCredit || 0) !== 0 ||
          Number(r.closingDebit || 0) !== 0 ||
          Number(r.closingCredit || 0) !== 0 ||
          Number(r.closingNetBalance || 0) !== 0;
        if (!hasActivity) return false;
      }

      if (accountTypeFilter !== 'ALL') {
        if (normalizeAccountGroup(r.accountType) !== accountTypeFilter) return false;
      }

      if (term) {
        const matchesSearch =
          r.accountCode?.toLowerCase().includes(term) ||
          r.accountName?.toLowerCase().includes(term) ||
          r.accountType?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }
      return true;
    });
  }, [rows, showZeroBalances, accountTypeFilter, searchTerm]);

  useEffect(() => {
    setPageIndex(0);
  }, [accountTypeFilter, searchTerm, pageSize]);

  // Full-dataset totals across ALL matching rows (never just current page)
  const totals = useMemo(() => computeTrialBalanceSummary(filteredRows), [filteredRows]);

  // Unfiltered ledger balance invariant across the full period scope
  const ledgerTotals = useMemo(() => computeTrialBalanceSummary(rows), [rows]);

  const closingVariance = totals.closingVariance;
  const periodVariance = totals.periodVariance;
  const openingVariance = totals.openingVariance;
  const fullLedgerVariance = ledgerTotals.closingVariance;
  const isLedgerBalanced = ledgerTotals.isBalanced;

  const totalCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const paginatedRows = useMemo(() => {
    const start = safePageIndex * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePageIndex, pageSize]);

  const activePeriod = periods.find((p) => p.id === accountingPeriodId);
  const periodLabel = activePeriod
    ? `${activePeriod.name} (${activePeriod.startDate} to ${activePeriod.endDate})`
    : startDate || endDate
      ? `${startDate || 'Beginning'} to ${endDate || 'Current'}`
      : 'All Periods (Cumulative)';

  const handleDrillDownToGL = (row: TrialBalanceRow) => {
    const params = new URLSearchParams();
    params.set('accountId', row.accountId);
    params.set('accountCode', row.accountCode);
    params.set('accountName', row.accountName);
    if (accountingPeriodId) {
      params.set('accountingPeriodId', accountingPeriodId);
    }
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    navigate(`/reports/general-ledger?${params.toString()}`);
  };

  const handleSignOff = async () => {
    setSignOffError(null);
    const certCheck = validateTrialBalanceCertification(ledgerTotals);
    if (!certCheck.allowed) {
      setSignOffError(certCheck.reason || 'Trial Balance is out of balance and cannot be certified.');
      return;
    }

    setSigningOff(true);
    try {
      const res = await apiFetch<any>('/api/reports/sign-off', {
        method: 'POST',
        body: {
          reportName: 'Trial Balance & Ledger Verification',
          notes: signNote.trim() || `Trial Balance reconciled (${rows.length} accounts, ₱0.00 variance).`,
          accountingPeriodId: accountingPeriodId || null,
          periodLabel,
          startDate: startDate || null,
          endDate: endDate || null,
          openingDebit: ledgerTotals.openingDebit,
          openingCredit: ledgerTotals.openingCredit,
          periodDebit: ledgerTotals.periodDebit,
          periodCredit: ledgerTotals.periodCredit,
          closingDebit: ledgerTotals.closingDebit,
          closingCredit: ledgerTotals.closingCredit,
          accountCount: rows.length,
          isBalanced: isLedgerBalanced,
        } as any,
      });
      setSignedOff(true);
      setLatestCertification(res?.certification || null);
      setSignNote('');
      await fetchSignOffStatus();
    } catch (err: any) {
      setSignOffError(err?.message || 'Failed to record Trial Balance sign-off.');
    } finally {
      setSigningOff(false);
    }
  };

  const exportData: ExportData = {
    filename: `Trial_Balance_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Trial Balance & Ledger Verification (6-Column + Closing Net)',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Scope: ${periodLabel}`,
    companyName: activeCompany?.legalName || 'Active Workspace',
    reportPeriod: periodLabel,
    orientation: 'landscape',
    headers: [
      'Account Code',
      'Account Name',
      'Type',
      'Opening Debit (PHP)',
      'Opening Credit (PHP)',
      'Period Debit (PHP)',
      'Period Credit (PHP)',
      'Closing Debit (PHP)',
      'Closing Credit (PHP)',
      'Closing Net Balance (PHP)',
    ],
    rows: filteredRows.map((r) => [
      r.accountCode,
      r.accountName,
      r.accountType,
      formatCurrency(r.openingDebit),
      formatCurrency(r.openingCredit),
      formatCurrency(r.periodDebit),
      formatCurrency(r.periodCredit),
      formatCurrency(r.closingDebit),
      formatCurrency(r.closingCredit),
      formatCurrency(r.closingNetBalance),
    ]),
    totals: [
      'TOTALS',
      `${filteredRows.length} Accounts`,
      isLedgerBalanced ? 'BALANCED' : `VAR ${formatCurrency(fullLedgerVariance)}`,
      formatCurrency(totals.openingDebit),
      formatCurrency(totals.openingCredit),
      formatCurrency(totals.periodDebit),
      formatCurrency(totals.periodCredit),
      formatCurrency(totals.closingDebit),
      formatCurrency(totals.closingCredit),
      formatCurrency(closingVariance),
    ],
  };

  return (
    <div className="space-y-4">
      {/* HEADER & FILTER WORKSPACE */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Scale className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Trial Balance Ledger
              </h2>
              <span
                data-testid="tb-balance-status"
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${
                  isLedgerBalanced
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                }`}
              >
                {isLedgerBalanced ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Debits = Credits Balanced (Variance: ₱0.00)
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Out of Balance ({formatCurrency(fullLedgerVariance)})
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Authoritative 6-column verification across Opening Brought-Forward, Period Activity, and Closing Balances · Scope:{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{periodLabel}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={fetchTrialBalance}
              disabled={loading}
              className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Refresh Trial Balance"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <ExportButton data={exportData} disabled={loading || filteredRows.length === 0} />
          </div>
        </div>

        {/* COMPACT FILTER TOOLBAR */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
          {/* Accounting Period Selector */}
          <div className="relative min-w-[230px] flex-1 max-w-[300px]">
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Accounting Period"
              value={accountingPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">All Periods (Cumulative)</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.startDate} to {p.endDate}) [{p.status}]
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            <input
              type="date"
              aria-label="Start Date"
              value={startDate}
              onChange={(e) => handleCustomDateChange('start', e.target.value)}
              className="w-[136px] px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
            />
            <span className="text-slate-400 shrink-0">to</span>
            <input
              type="date"
              aria-label="End Date"
              value={endDate}
              onChange={(e) => handleCustomDateChange('end', e.target.value)}
              className="w-[136px] px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
            />
          </div>

          {/* Account Type Filter */}
          <div className="w-[150px] shrink-0">
            <select
              aria-label="Account Type Filter"
              value={accountTypeFilter}
              onChange={(e) => setAccountTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ALL">All Account Types</option>
              <option value="ASSET">Assets</option>
              <option value="LIABILITY">Liabilities</option>
              <option value="EQUITY">Equity</option>
              <option value="REVENUE">Revenue</option>
              <option value="EXPENSE">Expenses & COGS</option>
            </select>
          </div>

          {/* Search Code or Name */}
          <div className="relative min-w-[170px] flex-1 max-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search code or account..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Zero-Balance Toggle */}
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none shrink-0 ml-auto">
            <input
              type="checkbox"
              checked={showZeroBalances}
              onChange={(e) => setShowZeroBalances(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Show Zero Balances</span>
          </label>
        </div>
      </div>

      {/* KPI RECONCILIATION STRIP */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Opening Balance (DR / CR)</div>
          <div className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {formatCurrency(totals.openingDebit)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            CR: {formatCurrency(totals.openingCredit)} · Diff: {formatCurrency(openingVariance)}
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Period Movement (DR / CR)</div>
          <div className="text-sm font-black text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums">
            {formatCurrency(totals.periodDebit)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            CR: {formatCurrency(totals.periodCredit)} · Diff: {formatCurrency(periodVariance)}
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Closing Balance (DR / CR)</div>
          <div className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
            {formatCurrency(totals.closingDebit)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            CR: {formatCurrency(totals.closingCredit)}
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Accounts & Net Check</div>
          <div className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {filteredRows.length.toLocaleString()} Accounts
          </div>
          <div
            className={`text-[11px] font-semibold mt-0.5 tabular-nums ${
              closingVariance === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            Filtered Variance: {formatCurrency(closingVariance)}
          </div>
        </div>
      </div>

      {/* ERROR STATE */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* AUTHORITATIVE 6-COLUMN + NET TRIAL BALANCE TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading Trial Balance dataset...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] text-slate-600 dark:text-slate-300 min-w-[900px]">
                <thead className="sticky-table-header bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-2 whitespace-nowrap">Code</th>
                    <th className="py-2.5 px-2">Account Name</th>
                    <th className="py-2.5 px-1.5 whitespace-nowrap">Type</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Opening DR</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Opening CR</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Period DR</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Period CR</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Closing DR</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Closing CR</th>
                    <th className="py-2.5 px-1.5 text-right whitespace-nowrap">Closing Net</th>
                    <th className="py-2.5 px-1.5 text-center whitespace-nowrap">GL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {paginatedRows.map((row) => (
                    <tr
                      key={row.accountId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2 px-2 font-mono font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        {row.accountCode}
                      </td>
                      <td className="py-2 px-2 font-medium text-slate-800 dark:text-slate-200 max-w-[165px] truncate" title={row.accountName}>
                        {row.accountName}
                      </td>
                      <td className="py-2 px-1.5 whitespace-nowrap">
                        <span
                          title={row.accountType}
                          className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-semibold"
                        >
                          {normalizeAccountGroup(row.accountType)}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatCurrency(row.openingDebit)}
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatCurrency(row.openingCredit)}
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap text-indigo-700 dark:text-indigo-300 font-medium">
                        {formatCurrency(row.periodDebit)}
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap text-indigo-700 dark:text-indigo-300 font-medium">
                        {formatCurrency(row.periodCredit)}
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(row.closingDebit)}
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(row.closingCredit)}
                      </td>
                      <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(row.closingNetBalance)}
                      </td>
                      <td className="py-2 px-1.5 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDrillDownToGL(row)}
                          data-testid={`tb-drilldown-${row.accountCode}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 transition-colors cursor-pointer"
                          title={`Open General Ledger for ${row.accountCode} ${row.accountName}`}
                        >
                          <span>GL</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {paginatedRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-400">
                        No Trial Balance accounts matched the selected period or filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>

                {/* MANDATORY FULL-DATASET TOTALS FOOTER */}
                {filteredRows.length > 0 && (
                  <tfoot
                    data-testid="tb-totals-footer"
                    className="bg-slate-50 dark:bg-slate-950 border-t-2 border-slate-300 dark:border-slate-700 font-bold text-slate-900 dark:text-slate-100"
                  >
                    <tr>
                      <td colSpan={3} className="py-2.5 px-2 text-[11px] uppercase tracking-wide whitespace-nowrap">
                        Totals ({filteredRows.length} accts)
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap" data-testid="tb-total-opening-debit">
                        {formatCurrency(totals.openingDebit)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap" data-testid="tb-total-opening-credit">
                        {formatCurrency(totals.openingCredit)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap text-indigo-700 dark:text-indigo-300" data-testid="tb-total-period-debit">
                        {formatCurrency(totals.periodDebit)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap text-indigo-700 dark:text-indigo-300" data-testid="tb-total-period-credit">
                        {formatCurrency(totals.periodCredit)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap" data-testid="tb-total-closing-debit">
                        {formatCurrency(totals.closingDebit)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap" data-testid="tb-total-closing-credit">
                        {formatCurrency(totals.closingCredit)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap" data-testid="tb-total-closing-variance">
                        {closingVariance === 0 ? '₱0.00 Diff' : formatCurrency(closingVariance)}
                      </td>
                      <td className="py-2.5 px-2 text-center text-[10px] whitespace-nowrap">
                        {closingVariance === 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">DR = CR</span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400">Check</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <PaginationControls
              totalCount={totalCount}
              itemCount={paginatedRows.length}
              pageIndex={safePageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(safePageIndex + 1) * pageSize < totalCount}
              onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
              onNextPage={() => setPageIndex((p) => (p + 1 < totalPages ? p + 1 : p))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, totalPages - 1))}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPageIndex(0);
              }}
              loading={loading}
            />
          </>
        )}
      </div>

      {/* REPORT CERTIFICATION & SIGN-OFF */}
      <div
        data-testid="tb-certification-card"
        className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Trial Balance Certification & Sign-off
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {signedOff && latestCertification
                ? `Certified by ${latestCertification.signerName} (${latestCertification.signerRole}) on ${formatEnterpriseTimestamp(latestCertification.signedAt)} — "${latestCertification.notes}"`
                : 'Certify that Opening, Period Movement, and Closing Debit/Credit totals reconcile for BIR & PFRS audit compliance.'}
            </p>
          </div>
          <div className="flex items-center gap-2.5 w-full lg:w-auto flex-wrap">
            {signOffHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSignOffHistory((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {showSignOffHistory ? 'Hide Log' : `Sign-off Log (${signOffHistory.length})`}
              </button>
            )}
            {!signedOff ? (
              <>
                <input
                  type="text"
                  placeholder="Enter reviewer notes / sign-off comments..."
                  value={signNote}
                  onChange={(e) => setSignNote(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex-1 sm:w-64"
                />
                <button
                  type="button"
                  onClick={handleSignOff}
                  disabled={signingOff || !isLedgerBalanced}
                  data-testid="tb-signoff-btn"
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors shrink-0 cursor-pointer"
                >
                  {signingOff ? 'Certifying...' : 'Sign Off & Seal'}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  data-testid="tb-signed-badge"
                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800"
                >
                  <CheckCircle className="w-4 h-4" />
                  Certified & Signed
                </div>
                <button
                  type="button"
                  onClick={() => setSignedOff(false)}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg cursor-pointer"
                >
                  Re-certify
                </button>
              </div>
            )}
          </div>
        </div>

        {signOffError && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{signOffError}</span>
          </div>
        )}

        {showSignOffHistory && signOffHistory.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 max-h-48 overflow-y-auto">
            {signOffHistory.map((item) => (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 text-xs"
              >
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    {item.periodLabel} · Closing DR {formatCurrency(item.closingDebit)} = CR {formatCurrency(item.closingCredit)}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">{item.notes}</div>
                </div>
                <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                  <div className="font-semibold text-slate-700 dark:text-slate-300">
                    {item.signerName} ({item.signerRole})
                  </div>
                  <div>{formatEnterpriseTimestamp(item.signedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
