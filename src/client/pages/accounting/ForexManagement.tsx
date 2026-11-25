import React, { useState, useEffect, useMemo } from 'react';
import {
  Coins,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Calculator,
  Search,
  Globe,
  RotateCcw,
  History,
  ArrowRightLeft,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import ExportButton, { ExportData } from '../../components/ExportButton';
import ForexConverterWidget from '../../components/ForexConverterWidget';
import { PaginationControls } from '../../components/PaginationControls';
import TableFilterToolbar, { DatePeriodFilter, computePeriodDates, SortOrderDirection } from '../../components/shared/TableFilterToolbar';
import { filterPostableLeafAccounts, formatAccountOptionLabel } from '../../../shared/coaAccountUtils';

type ForexTab = 'rates' | 'revaluation' | 'history';

interface MonetaryAccountRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  currency: string;
  carryingPhpCentavos: number;
  carryingPhpDisplay: number;
  bankName?: string | null;
}

export default function ForexManagement() {
  const { activeCompany } = useAuth();
  const [activeTab, setActiveTab] = useState<ForexTab>('rates');

  // Spot Rates State
  const [rates, setRates] = useState<any[]>([]);
  const [loadingRates, setLoadingRates] = useState(true);
  const [showRateModal, setShowRateModal] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSuccess, setRateSuccess] = useState<string | null>(null);
  const [confirmDeleteRateId, setConfirmDeleteRateId] = useState<string | null>(null);
  const [ratesRefreshKey, setRatesRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [ratesSortOrder, setRatesSortOrder] = useState<SortOrderDirection>('DESC');
  const [ratesDatePeriod, setRatesDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [ratesDateFrom, setRatesDateFrom] = useState('');
  const [ratesDateTo, setRatesDateTo] = useState('');
  const [ratesCurrencyFilter, setRatesCurrencyFilter] = useState('ALL');
  const [ratesPageIndex, setRatesPageIndex] = useState(0);
  const [ratesPageSize, setRatesPageSize] = useState(20);

  const [newRate, setNewRate] = useState({
    currency: 'USD',
    bspSpotRate: '',
    rateDate: new Date().toISOString().slice(0, 10),
    source: 'Bangko Sentral ng Pilipinas (BSP)',
  });

  // Period-End Revaluation State
  const [periods, setPeriods] = useState<any[]>([]);
  const [allBalanceSheetAccounts, setAllBalanceSheetAccounts] = useState<any[]>([]);
  const [monetaryAccounts, setMonetaryAccounts] = useState<MonetaryAccountRow[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [revalDate, setRevalDate] = useState(new Date().toISOString().slice(0, 10));
  const [targetCurrency, setTargetCurrency] = useState('USD');
  const [closingSpotRateInput, setClosingSpotRateInput] = useState('');
  const [foreignBalanceInputs, setForeignBalanceInputs] = useState<Record<string, string>>({});
  const [selectedExtraAccountId, setSelectedExtraAccountId] = useState('');
  const [extraAccountIds, setExtraAccountIds] = useState<string[]>([]);
  const [autoReverse, setAutoReverse] = useState(true);
  const [autoReverseDate, setAutoReverseDate] = useState('');
  const [revalNotes, setRevalNotes] = useState('');
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [postLoading, setPostLoading] = useState(false);
  const [revalError, setRevalError] = useState<string | null>(null);
  const [revalSuccess, setRevalSuccess] = useState<string | null>(null);

  // Revaluation Runs History State
  const [revalRuns, setRevalRuns] = useState<any[]>([]);
  const [runsTotalCount, setRunsTotalCount] = useState(0);
  const [runsPageIndex, setRunsPageIndex] = useState(0);
  const [runsPageSize, setRunsPageSize] = useState(20);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const fetchRates = async () => {
    setLoadingRates(true);
    try {
      const data = await apiFetch<any[]>('/api/operations/forex/rates');
      setRates(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load spot rates', err);
    } finally {
      setLoadingRates(false);
    }
  };

  const fetchPeriodsAndAccounts = async () => {
    try {
      const [perData, accData, monData] = await Promise.all([
        apiFetch<any>('/api/accounting/periods').catch(() => []),
        apiFetch<any>('/api/master-data/accounts?raw=true').catch(() => []),
        apiFetch<any>(`/api/operations/forex/monetary-accounts?currency=${encodeURIComponent(targetCurrency)}`).catch(() => ({ accounts: [] })),
      ]);

      const list = Array.isArray(perData) ? perData : perData?.periods || perData?.items || [];
      setPeriods(list);
      if (!selectedPeriodId && list.length > 0) {
        const openPeriod = list.find((p: any) => p.status === 'OPEN') || list[0];
        setSelectedPeriodId(openPeriod.id);
        setRevalDate(openPeriod.endDate);
        const nextDay = new Date(`${openPeriod.endDate}T00:00:00Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        setAutoReverseDate(nextDay.toISOString().slice(0, 10));
      }

      const items = Array.isArray(accData) ? accData : accData?.accounts || accData?.items || [];
      const bsTypes = new Set([
        'ASSET',
        'RECEIVABLE',
        'OTHER_CURRENT_ASSET',
        'LIABILITY',
        'PAYABLE',
        'OTHER_CURRENT_LIABILITY',
        'LONG_TERM_LIABILITY',
      ]);
      const postable = filterPostableLeafAccounts(items);
      setAllBalanceSheetAccounts(
        postable.filter((a: any) => bsTypes.has(String(a.accountType || '').toUpperCase()))
      );

      setMonetaryAccounts(Array.isArray(monData?.accounts) ? monData.accounts : []);
    } catch (err) {
      console.error('Failed to load periods/accounts for FX revaluation', err);
    }
  };

  const fetchRevaluationRuns = async (page = runsPageIndex + 1, limit = runsPageSize) => {
    setLoadingRuns(true);
    try {
      const data = await apiFetch<any>(`/api/operations/forex/revaluations?page=${page}&limit=${limit}`);
      setRevalRuns(Array.isArray(data?.items) ? data.items : []);
      setRunsTotalCount(Number(data?.totalCount || 0));
    } catch (err) {
      console.error('Failed to fetch FX revaluation runs', err);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    fetchRates();
    fetchPeriodsAndAccounts();
    fetchRevaluationRuns(1, runsPageSize);
    const handleCoaUpdated = () => fetchPeriodsAndAccounts();
    window.addEventListener('coa:updated', handleCoaUpdated);
    return () => window.removeEventListener('coa:updated', handleCoaUpdated);
  }, [activeCompany?.id]);

  useEffect(() => {
    apiFetch<any>(`/api/operations/forex/monetary-accounts?currency=${encodeURIComponent(targetCurrency)}&asOfDate=${encodeURIComponent(revalDate)}`)
      .then((d) => setMonetaryAccounts(Array.isArray(d?.accounts) ? d.accounts : []))
      .catch(() => {});
  }, [targetCurrency, revalDate]);

  const handlePeriodChange = (periodId: string) => {
    setSelectedPeriodId(periodId);
    setPreviewData(null);
    const p = periods.find((item) => item.id === periodId);
    if (p) {
      setRevalDate(p.endDate);
      const nextDay = new Date(`${p.endDate}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      setAutoReverseDate(nextDay.toISOString().slice(0, 10));
    }
  };

  const handleCreateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRateError(null);
    setRateSuccess(null);
    try {
      await apiFetch('/api/operations/forex/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: newRate.currency,
          bspSpotRate: Number(newRate.bspSpotRate),
          rateDate: newRate.rateDate,
          source: newRate.source,
        }),
      });
      setShowRateModal(false);
      setRateSuccess(`Recorded official BSP spot rate for ${newRate.currency} (₱${Number(newRate.bspSpotRate).toFixed(4)}).`);
      setNewRate((prev) => ({ ...prev, bspSpotRate: '' }));
      await fetchRates();
      setRatesRefreshKey((k) => k + 1);
    } catch (err: any) {
      setRateError(err?.message || 'Error recording spot rate');
    }
  };

  const handleDeleteRate = async (rateId: string) => {
    setRateError(null);
    setRateSuccess(null);
    try {
      await apiFetch(`/api/operations/forex/rates/${rateId}`, { method: 'DELETE' });
      setConfirmDeleteRateId(null);
      setRateSuccess('BSP spot rate removed from register.');
      await fetchRates();
      setRatesRefreshKey((k) => k + 1);
    } catch (err: any) {
      setRateError(err?.message || 'Failed to delete BSP spot rate.');
    }
  };

  // Combine discovered FX monetary accounts + manually added balance-sheet exposure accounts
  const exposureCandidateAccounts = useMemo(() => {
    const byId = new Map<string, MonetaryAccountRow>();
    for (const m of monetaryAccounts) {
      byId.set(m.accountId, m);
    }
    for (const extraId of extraAccountIds) {
      if (!byId.has(extraId)) {
        const found = allBalanceSheetAccounts.find((a) => a.id === extraId);
        if (found) {
          byId.set(extraId, {
            accountId: found.id,
            accountCode: found.accountCode,
            accountName: found.accountName,
            accountType: found.accountType,
            normalBalance: found.normalBalance,
            currency: found.currency && found.currency !== 'PHP' ? found.currency : targetCurrency,
            carryingPhpCentavos: 0,
            carryingPhpDisplay: 0,
          });
        }
      }
    }
    return Array.from(byId.values());
  }, [monetaryAccounts, extraAccountIds, allBalanceSheetAccounts, targetCurrency]);

  const buildExposuresPayload = () => {
    return exposureCandidateAccounts
      .map((acc) => {
        const raw = foreignBalanceInputs[acc.accountId];
        if (raw === undefined || raw === '') return null;
        const val = Number(raw);
        if (!Number.isFinite(val)) return null;
        return {
          accountId: acc.accountId,
          foreignBalance: val,
          currency: targetCurrency,
        };
      })
      .filter((x): x is { accountId: string; foreignBalance: number; currency: string } => x !== null);
  };

  const handlePreviewRevaluation = async () => {
    setRevalError(null);
    setRevalSuccess(null);
    setPreviewLoading(true);
    try {
      const data = await apiFetch<any>('/api/operations/forex/revaluations/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountingPeriodId: selectedPeriodId || undefined,
          revaluationDate: revalDate,
          currency: targetCurrency,
          closingSpotRate: closingSpotRateInput ? Number(closingSpotRateInput) : undefined,
          exposures: buildExposuresPayload(),
        }),
      });
      setPreviewData(data);
    } catch (err: any) {
      setPreviewData(null);
      setRevalError(err?.message || 'Failed to preview FX revaluation.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePostRevaluation = async () => {
    setRevalError(null);
    setRevalSuccess(null);
    const exposures = buildExposuresPayload();
    if (exposures.length === 0) {
      setRevalError('Enter the closing foreign currency balance for at least one monetary account before posting.');
      return;
    }
    setPostLoading(true);
    try {
      const data = await apiFetch<any>('/api/operations/forex/revaluations/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountingPeriodId: selectedPeriodId || undefined,
          revaluationDate: revalDate,
          currency: targetCurrency,
          closingSpotRate: closingSpotRateInput ? Number(closingSpotRateInput) : undefined,
          exposures,
          autoReverse,
          autoReverseDate: autoReverse ? autoReverseDate : undefined,
          notes: revalNotes.trim() || undefined,
        }),
      });
      setRevalSuccess(
        `Posted Unrealized FX Revaluation JE ${data.journalNumber}${data.reversalJournalId ? ` with next-period auto-reversal (${autoReverseDate})` : ''}.`
      );
      setPreviewData(data.preview || null);
      fetchRevaluationRuns(1, runsPageSize);
      fetchPeriodsAndAccounts();
    } catch (err: any) {
      setRevalError(err?.message || 'Error posting FX revaluation.');
    } finally {
      setPostLoading(false);
    }
  };

  const handleReverseRun = async (runId: string) => {
    setRevalError(null);
    setRevalSuccess(null);
    try {
      await apiFetch(`/api/operations/forex/revaluations/${runId}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual FX Revaluation Reversal' }),
      });
      setRevalSuccess(`Reversed FX revaluation run ${runId}.`);
      fetchRevaluationRuns(runsPageIndex + 1, runsPageSize);
    } catch (err: any) {
      setRevalError(err?.message || 'Failed to reverse FX revaluation run.');
    }
  };

  const currencyOptions = useMemo(() => {
    const set = new Set<string>();
    (rates || []).forEach((r) => {
      if (r?.currency) set.add(r.currency);
    });
    return [
      { label: 'All Currencies', value: 'ALL' },
      ...Array.from(set).sort().map((c) => ({ label: c, value: c }))
    ];
  }, [rates]);

  const safeRates = Array.isArray(rates) ? rates : [];
  const filteredRates = useMemo(() => {
    const dateRange = ratesDatePeriod === 'CUSTOM'
      ? { fromDate: ratesDateFrom, toDate: ratesDateTo }
      : computePeriodDates(ratesDatePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;
    const q = searchQuery.trim().toLowerCase();

    const filtered = safeRates.filter((r) => {
      if (ratesCurrencyFilter !== 'ALL' && r?.currency !== ratesCurrencyFilter) return false;
      if (from && r?.rateDate && r.rateDate < from) return false;
      if (to && r?.rateDate && r.rateDate > to) return false;
      if (!q) return true;
      const curr = (r?.currency || '').toLowerCase();
      const src = (r?.source || '').toLowerCase();
      const rateStr = (r?.bspSpotRate || '').toString();
      return curr.includes(q) || src.includes(q) || rateStr.includes(q) || (r?.rateDate || '').includes(q);
    });

    return filtered.sort((a, b) => {
      const dateA = a?.rateDate || '';
      const dateB = b?.rateDate || '';
      if (ratesSortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [safeRates, searchQuery, ratesCurrencyFilter, ratesDatePeriod, ratesDateFrom, ratesDateTo, ratesSortOrder]);

  const paginatedRates = filteredRates.slice(
    ratesPageIndex * ratesPageSize,
    ratesPageIndex * ratesPageSize + ratesPageSize
  );

  const exportData: ExportData = {
    filename: `BSP_Forex_SpotRates_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'BSP Foreign Currency Exchange Spot Rates (BIR RMC 12-2024)',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Official BSP Daily Rates`,
    companyName: activeCompany?.legalName || 'Company Workspace',
    headers: ['Currency', 'BSP Spot Rate (PHP)', 'Rate Date', 'Source'],
    rows: filteredRates.map((r) => [
      r?.currency || 'USD',
      `₱${Number(r?.bspSpotRate || 0).toFixed(4)}`,
      r?.rateDate || '-',
      r?.source || 'BSP',
    ]),
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Compact Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-800 px-5 py-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Foreign Exchange & Period-End Revaluation (PAS 21 / BIR RMC 12-2024)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Official BSP daily spot rates, realized settlement FX calculator, and period-end unrealized FX revaluation runs.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <ExportButton data={exportData} disabled={loadingRates} />
          <button
            type="button"
            onClick={() => setShowRateModal(true)}
            data-testid="add-bsp-rate-btn"
            className="bg-indigo-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Daily BSP Rate
          </button>
        </div>
      </div>

      {/* Workspace Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('rates')}
          data-testid="fx-tab-rates"
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'rates'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          BSP Spot Rates & Calculator ({filteredRates.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('revaluation')}
          data-testid="fx-tab-revaluation"
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'revaluation'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          Period-End Unrealized FX Revaluation ({monetaryAccounts.length} FX Accounts)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          data-testid="fx-tab-history"
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'history'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Revaluation Run History ({runsTotalCount})
        </button>
      </div>

      {/* TAB 1: BSP SPOT RATES & REALIZED CALCULATOR */}
      {activeTab === 'rates' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-2.5">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 uppercase tracking-wider">
              <Calculator className="w-4 h-4 text-indigo-600" />
              Real-Time Forex & Realized FX Gain/Loss Calculator
            </h3>
            <ForexConverterWidget
              refreshKey={ratesRefreshKey}
              monetaryAccounts={allBalanceSheetAccounts}
              onRealizedPosted={() => {
                fetchPeriodsAndAccounts();
                fetchRevaluationRuns(1, runsPageSize);
              }}
            />
          </div>

          {rateSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {rateSuccess}
              </span>
              <button type="button" onClick={() => setRateSuccess(null)} className="underline">Dismiss</button>
            </div>
          )}

          {rateError && !showRateModal && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
              <span>{rateError}</span>
              <button type="button" onClick={() => setRateError(null)} className="underline">Dismiss</button>
            </div>
          )}

          <TableFilterToolbar
            searchQuery={searchQuery}
            onSearchChange={(q) => {
              setSearchQuery(q);
              setRatesPageIndex(0);
            }}
            searchPlaceholder="Search rates by currency, date, source..."
            sortOrder={ratesSortOrder}
            onSortOrderChange={(ord) => {
              setRatesSortOrder(ord);
              setRatesPageIndex(0);
            }}
            datePeriod={ratesDatePeriod}
            onDatePeriodChange={(p) => {
              setRatesDatePeriod(p);
              setRatesPageIndex(0);
            }}
            fromDate={ratesDateFrom}
            toDate={ratesDateTo}
            onDateRangeChange={({ fromDate, toDate }) => {
              setRatesDateFrom(fromDate);
              setRatesDateTo(toDate);
              setRatesPageIndex(0);
            }}
            productLabel="Currency"
            selectedProductId={ratesCurrencyFilter}
            onProductChange={(val) => {
              setRatesCurrencyFilter(val);
              setRatesPageIndex(0);
            }}
            productOptions={currencyOptions}
            pageSize={ratesPageSize}
            onPageSizeChange={(sz) => {
              setRatesPageSize(sz);
              setRatesPageIndex(0);
            }}
            totalCount={safeRates.length}
            filteredCount={filteredRates.length}
            onResetFilters={() => {
              setSearchQuery('');
              setRatesSortOrder('DESC');
              setRatesDatePeriod('ALL');
              setRatesDateFrom('');
              setRatesDateTo('');
              setRatesCurrencyFilter('ALL');
              setRatesPageSize(20);
              setRatesPageIndex(0);
            }}
          />

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
              <span>Official BSP Spot Rates Log</span>
              <span className="text-[11px] font-normal text-slate-500">Strict lookup — no fallback rates fabricated</span>
            </div>
            {loadingRates ? (
              <div className="p-10 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
                <RefreshCw className="w-4 h-4 animate-spin" /> Fetching BSP spot rates...
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="py-2.5 px-4">Currency</th>
                        <th className="py-2.5 px-4">BSP Spot Rate (₱)</th>
                        <th className="py-2.5 px-4">Rate Date</th>
                        <th className="py-2.5 px-4">Source</th>
                        <th className="py-2.5 px-4 text-center">Compliance</th>
                        <th className="py-2.5 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {paginatedRates.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="py-2.5 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {r.currency}
                          </td>
                          <td className="py-2.5 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            ₱{Number(r.bspSpotRate || 0).toFixed(4)}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 font-mono">
                            {r.rateDate || '-'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                            {r.source || 'Bangko Sentral ng Pilipinas'}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] font-bold rounded-full border border-indigo-200 dark:border-indigo-800">
                              RMC 12-2024 VALIDATED
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {confirmDeleteRateId === r.id ? (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRate(r.id)}
                                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteRateId(null)}
                                  className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold"
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRateId(r.id)}
                                aria-label={`Delete BSP rate ${r.currency} ${r.rateDate}`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-[11px] font-semibold"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {paginatedRates.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-slate-400">
                            No BSP spot rates recorded yet. Click &ldquo;Add Daily BSP Rate&rdquo; to record an official closing rate.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  totalCount={filteredRates.length}
                  itemCount={paginatedRates.length}
                  pageIndex={ratesPageIndex}
                  pageSize={ratesPageSize}
                  pageSizeOptions={[20, 50, 100]}
                  hasNextPage={(ratesPageIndex + 1) * ratesPageSize < filteredRates.length}
                  onNextPage={() => setRatesPageIndex((p) => p + 1)}
                  onPrevPage={() => setRatesPageIndex((p) => Math.max(0, p - 1))}
                  onFirstPage={() => setRatesPageIndex(0)}
                  onLastPage={() => setRatesPageIndex(Math.max(0, Math.ceil(filteredRates.length / ratesPageSize) - 1))}
                  onPageSizeChange={(newSize) => {
                    setRatesPageSize(newSize);
                    setRatesPageIndex(0);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PERIOD-END UNREALIZED FX REVALUATION WORKSPACE */}
      {activeTab === 'revaluation' && (
        <div className="space-y-4">
          {revalError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{revalError}</span>
            </div>
          )}
          {revalSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{revalSuccess}</span>
            </div>
          )}

          {/* Parameters Bar */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Accounting Period
                </label>
                <select
                  value={selectedPeriodId}
                  onChange={(e) => handlePeriodChange(e.target.value)}
                  data-testid="fx-reval-period-select"
                  className="w-full text-xs px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.startDate} to {p.endDate}) [{p.status}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-36">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Target Currency
                </label>
                <select
                  value={targetCurrency}
                  onChange={(e) => {
                    setTargetCurrency(e.target.value);
                    setPreviewData(null);
                  }}
                  data-testid="fx-reval-currency-select"
                  className="w-full text-xs px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                  <option value="SGD">SGD - Singapore Dollar</option>
                  <option value="GBP">GBP - British Pound</option>
                </select>
              </div>

              <div className="w-36">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Revaluation Date
                </label>
                <input
                  type="date"
                  value={revalDate}
                  onChange={(e) => setRevalDate(e.target.value)}
                  className="w-full text-xs px-2.5 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="w-44">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Closing BSP Rate (optional override)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="Use BSP Spot Log"
                  value={closingSpotRateInput}
                  onChange={(e) => setClosingSpotRateInput(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono"
                />
              </div>

              <button
                type="button"
                onClick={handlePreviewRevaluation}
                disabled={previewLoading}
                data-testid="fx-preview-btn"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Calculator className="w-3.5 h-3.5" />
                {previewLoading ? 'Calculating...' : 'Preview Revaluation'}
              </button>
            </div>

            {/* Add non-FX-flagged Balance Sheet account into exposure schedule if needed */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
              <span className="text-[11px] text-slate-500">Add foreign-denominated GL exposure account:</span>
              <select
                value={selectedExtraAccountId}
                onChange={(e) => setSelectedExtraAccountId(e.target.value)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 min-w-[240px]"
              >
                <option value="">-- Select Balance Sheet GL Account --</option>
                {allBalanceSheetAccounts
                  .filter((a) => !exposureCandidateAccounts.some((e) => e.accountId === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a, true)}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!selectedExtraAccountId}
                onClick={() => {
                  if (selectedExtraAccountId && !extraAccountIds.includes(selectedExtraAccountId)) {
                    setExtraAccountIds((prev) => [...prev, selectedExtraAccountId]);
                    setSelectedExtraAccountId('');
                  }
                }}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
              >
                + Add Account
              </button>
            </div>
          </div>

          {/* Exposure Accounts Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-800 dark:text-slate-100">
                Monetary Balance Sheet Accounts ({targetCurrency})
              </span>
              {previewData && (
                <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  Closing BSP Rate: ₱{Number(previewData.closingSpotRate).toFixed(4)} ({previewData.rateSource} · {previewData.rateDate})
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">Account</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">GL Carrying (PHP)</th>
                    <th className="py-2.5 px-3 text-right">Closing Foreign Bal ({targetCurrency})</th>
                    <th className="py-2.5 px-3 text-right">Revalued Value (PHP)</th>
                    <th className="py-2.5 px-3 text-right">Unrealized Gain</th>
                    <th className="py-2.5 px-3 text-right">Unrealized Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {exposureCandidateAccounts.map((acc) => {
                    const prevLine = previewData?.lines?.find((l: any) => l.accountId === acc.accountId);
                    const carryingPhp = prevLine ? prevLine.carryingPhp : acc.carryingPhpDisplay / 100;
                    return (
                      <tr key={acc.accountId} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-100">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400 mr-1.5">{acc.accountCode}</span>
                            {acc.accountName}
                          </div>
                          {acc.bankName && <div className="text-[10px] text-slate-400">Bank: {acc.bankName}</div>}
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          {acc.accountType} ({acc.normalBalance})
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium">
                          ₱{Number(carryingPhp || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={foreignBalanceInputs[acc.accountId] ?? ''}
                            onChange={(e) =>
                              setForeignBalanceInputs((prev) => ({
                                ...prev,
                                [acc.accountId]: e.target.value,
                              }))
                            }
                            data-testid={`fx-foreign-input-${acc.accountCode}`}
                            className="w-32 text-right font-mono text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {prevLine && prevLine.revaluedPhp !== null
                            ? `₱${Number(prevLine.revaluedPhp).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {prevLine && prevLine.unrealizedGainCentavos > 0
                            ? `₱${(prevLine.unrealizedGainCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                          {prevLine && prevLine.unrealizedLossCentavos > 0
                            ? `₱${(prevLine.unrealizedLossCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {exposureCandidateAccounts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No {targetCurrency}-denominated GL or Dollar Bank accounts detected automatically. Use the selector above to add an exposure account.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Posting Bar */}
            {previewData && (
              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-6 text-xs">
                    <div>
                      <span className="text-slate-500">Total Unrealized Gain: </span>
                      <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                        ₱{(Number(previewData.totalGainCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Total Unrealized Loss: </span>
                      <strong className="font-mono text-rose-600 dark:text-rose-400">
                        ₱{(Number(previewData.totalLossCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">ITR Taxable Status: </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold text-[11px]">
                        <ShieldCheck className="w-3 h-3" /> EXCLUDED (BIR RMC 12-2024)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/70 dark:border-slate-700">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoReverse}
                        onChange={(e) => setAutoReverse(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Auto-Reverse on Next Period Opening
                    </label>
                    {autoReverse && (
                      <input
                        type="date"
                        value={autoReverseDate}
                        onChange={(e) => setAutoReverseDate(e.target.value)}
                        className="text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                      />
                    )}
                    <input
                      type="text"
                      placeholder="Optional closing notes / BSP bulletin ref..."
                      value={revalNotes}
                      onChange={(e) => setRevalNotes(e.target.value)}
                      className="text-xs px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 w-64"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handlePostRevaluation}
                    disabled={postLoading || (previewData.totalGainCentavos === 0 && previewData.totalLossCentavos === 0)}
                    data-testid="fx-post-reval-btn"
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {postLoading ? 'Posting JE...' : 'Post Period-End Revaluation JE'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: REVALUATION RUN HISTORY */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
            <span>Posted Period-End FX Revaluation Runs</span>
            <button
              type="button"
              onClick={() => fetchRevaluationRuns(runsPageIndex + 1, runsPageSize)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRuns ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Period</th>
                  <th className="py-2.5 px-3">Currency & Rate</th>
                  <th className="py-2.5 px-3 text-right">Unrealized Gain</th>
                  <th className="py-2.5 px-3 text-right">Unrealized Loss</th>
                  <th className="py-2.5 px-3">Journal Refs</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {revalRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                    <td className="py-2.5 px-3 font-mono">{run.revaluationDate}</td>
                    <td className="py-2.5 px-3">{run.accountingPeriodName || run.accountingPeriodId || '—'}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold">
                      {run.targetCurrency} @ ₱{Number(run.closingSpotRate).toFixed(4)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      ₱{(Number(run.totalGainCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                      ₱{(Number(run.totalLossCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      <div>JE: {run.unrealizedJournalNumber || run.unrealizedJournalId || '—'}</div>
                      {run.reversalJournalNumber && (
                        <div className="text-slate-400">REV: {run.reversalJournalNumber}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          run.status === 'AUTO_REVERSED'
                            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                            : run.status === 'REVERSED'
                              ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {run.status === 'POSTED' && (
                        <button
                          type="button"
                          onClick={() => handleReverseRun(run.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 text-[11px] font-semibold cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" /> Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {revalRuns.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400">
                      No period-end FX revaluation runs posted yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            totalCount={runsTotalCount}
            itemCount={revalRuns.length}
            pageIndex={runsPageIndex}
            pageSize={runsPageSize}
            pageSizeOptions={[20, 50, 100]}
            hasNextPage={(runsPageIndex + 1) * runsPageSize < runsTotalCount}
            onNextPage={() => {
              const next = runsPageIndex + 1;
              setRunsPageIndex(next);
              fetchRevaluationRuns(next + 1, runsPageSize);
            }}
            onPrevPage={() => {
              const prev = Math.max(0, runsPageIndex - 1);
              setRunsPageIndex(prev);
              fetchRevaluationRuns(prev + 1, runsPageSize);
            }}
            onFirstPage={() => {
              setRunsPageIndex(0);
              fetchRevaluationRuns(1, runsPageSize);
            }}
            onLastPage={() => {
              const last = Math.max(0, Math.ceil(runsTotalCount / runsPageSize) - 1);
              setRunsPageIndex(last);
              fetchRevaluationRuns(last + 1, runsPageSize);
            }}
            onPageSizeChange={(newSize) => {
              setRunsPageSize(newSize);
              setRunsPageIndex(0);
              fetchRevaluationRuns(1, newSize);
            }}
          />
        </div>
      )}

      {/* Add Spot Rate Modal */}
      {showRateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Coins className="w-5 h-5 text-emerald-600" /> Record Daily BSP Spot Rate
            </h3>
            {rateError && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs">{rateError}</div>}

            <form onSubmit={handleCreateRate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Currency Code</label>
                <select
                  value={newRate.currency}
                  onChange={(e) => setNewRate({ ...newRate, currency: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                  <option value="SGD">SGD - Singapore Dollar</option>
                  <option value="GBP">GBP - British Pound</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">BSP Spot Rate (PHP)</label>
                  <input
                    type="number"
                    required
                    step="0.0001"
                    min="0.0001"
                    placeholder="e.g. 56.8500"
                    value={newRate.bspSpotRate}
                    onChange={(e) => setNewRate({ ...newRate, bspSpotRate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold text-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Rate Date</label>
                  <input
                    type="date"
                    required
                    value={newRate.rateDate}
                    onChange={(e) => setNewRate({ ...newRate, rateDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Source Reference</label>
                <input
                  type="text"
                  value={newRate.source}
                  onChange={(e) => setNewRate({ ...newRate, source: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-sm cursor-pointer"
                >
                  Save BSP Rate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
