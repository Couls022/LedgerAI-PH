import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Printer,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Layers,
  History,
  CheckSquare,
  Square,
  FileCheck2,
  Building2,
} from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';
import {
  BIR_2307_ATC_CATALOG,
  formatBirTinDisplay,
  type BirQuarter,
  type Form2307Certificate,
} from '../../../shared/form2307Utils';
import BirForm2307OfficialSheet from '../../components/tax/BirForm2307OfficialSheet';
import { TableScrollContainer } from '../../components/shared/TableScrollContainer';
import TableFilterToolbar, {
  DatePeriodFilter,
  computePeriodDates,
  SortOrderDirection,
} from '../../components/shared/TableFilterToolbar';

interface AvailablePeriod {
  year: number;
  quarter: BirQuarter;
  billsCount: number;
  paymentsCount: number;
  ewtPhp: number;
}

interface IssuedHistoryItem {
  id: string;
  certificateControlNo: string;
  vendorId: string | null;
  vendorName: string;
  vendorTin: string | null;
  atcCodes: string[];
  signatoryName: string | null;
  periodName: string;
  startDate: string;
  endDate: string;
  deadlineDate: string;
  status: string;
  totalTaxBasePhp: number;
  totalTaxDuePhp: number;
  filedAt: string | null;
}

interface Form2307WorkspaceResponse {
  period: {
    year: number;
    quarter: BirQuarter;
    periodFrom: string;
    periodTo: string;
    statutoryDeadline: string;
    monthLabels: [string, string, string];
  };
  payor: {
    legalName: string | null;
    tradeName: string | null;
    tin: string | null;
    tinSegments: [string, string, string, string];
    address: string | null;
    zipCode: string;
    rdoCode: string | null;
    branchCode: string;
    contactPerson: string | null;
  };
  glReconciliation: {
    ewtAccounts: Array<{
      code: string;
      name: string;
      creditPhp: number;
      debitPhp: number;
      netPhp: number;
    }>;
    glEwtCreditPhp: number;
    glEwtDebitPhp: number;
    glNetEwtPayablePhp: number;
    subledgerDvEwtPhp: number;
    computedCertificatesEwtPhp: number;
    reconciliationDiffPhp: number;
  };
  summary: {
    totalVendorsInMaster: number;
    totalPayeesWithActivity: number;
    totalCertificatesIssued: number;
    totalIncomePaymentBasePhp: number;
    totalTaxWithheldPhp: number;
    totalRecordedDvEwtPhp: number;
    totalVatExcludedPhp: number;
    certificatesNeedingAttention: number;
  };
  availablePeriods: AvailablePeriod[];
  totalMatchedCertificates: number;
  certificates: Form2307Certificate[];
  issuedHistory: IssuedHistoryItem[];
}

const formatPhp = (amount: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);

function downloadCsvFile(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Form2307Module() {
  const [activeTab, setActiveTab] = useState<'generate' | 'register'>('generate');

  // Period & filter state (empty initially so backend auto-selects most active ledger quarter)
  const [year, setYear] = useState<string>('');
  const [quarter, setQuarter] = useState<BirQuarter | ''>('');
  const [filterMode, setFilterMode] = useState<'ACTIVITY' | 'RECORDED_EWT' | 'ATTENTION' | 'ISSUED' | 'ALL'>('ACTIVITY');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [overrideAtc, setOverrideAtc] = useState<string>('');
  const [overrideRate, setOverrideRate] = useState<string>('');

  // Workspace data
  const [workspace, setWorkspace] = useState<Form2307WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Selection & preview controls
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [checkedVendorIds, setCheckedVendorIds] = useState<Set<string>>(new Set());
  const [showLedgerSource, setShowLedgerSource] = useState<boolean>(false);
  const [showSignatoryDrawer, setShowSignatoryDrawer] = useState<boolean>(false);

  // Customizable print/signatory overrides
  const [signatoryName, setSignatoryName] = useState<string>('');
  const [signatoryTitle, setSignatoryTitle] = useState<string>('');
  const [signatoryTin, setSignatoryTin] = useState<string>('');
  const [payorZip, setPayorZip] = useState<string>('');
  const [payeeZipOverride, setPayeeZipOverride] = useState<string>('');
  const [payeeForeignAddress, setPayeeForeignAddress] = useState<string>('');

  // Action states
  const [issuingSingle, setIssuingSingle] = useState<boolean>(false);
  const [issuingBatch, setIssuingBatch] = useState<boolean>(false);
  const [printQueue, setPrintQueue] = useState<Form2307Certificate[]>([]);

  // Pagination for issued history register (20 default, 25, 50, 100, custom)
  const [historyPageIndex, setHistoryPageIndex] = useState<number>(0);
  const [historyPageSize, setHistoryPageSize] = useState<number>(20);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySortOrder, setHistorySortOrder] = useState<SortOrderDirection>('DESC');
  const [historyDatePeriod, setHistoryDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [historyFromDate, setHistoryFromDate] = useState('');
  const [historyToDate, setHistoryToDate] = useState('');
  const [historyPayeeFilter, setHistoryPayeeFilter] = useState('ALL');

  const issuedHistory = useMemo(() => workspace?.issuedHistory || [], [workspace?.issuedHistory]);

  const payeeOptions = useMemo(() => {
    const set = new Map<string, string>();
    issuedHistory.forEach((h) => {
      if (h.vendorId && h.vendorName) set.set(h.vendorId, h.vendorName);
    });
    return [
      { label: 'All Payees', value: 'ALL' },
      ...Array.from(set.entries()).map(([val, label]) => ({ label, value: val })),
    ];
  }, [issuedHistory]);

  const filteredIssuedHistory = useMemo(() => {
    const q = historySearchQuery.trim().toLowerCase();
    const dateRange = historyDatePeriod === 'CUSTOM'
      ? { fromDate: historyFromDate, toDate: historyToDate }
      : computePeriodDates(historyDatePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;

    const list = issuedHistory.filter((item) => {
      if (historyPayeeFilter !== 'ALL' && item.vendorId !== historyPayeeFilter) return false;
      const fileDate = (item.filedAt || '').slice(0, 10);
      if (from && fileDate && fileDate < from) return false;
      if (to && fileDate && fileDate > to) return false;
      if (!q) return true;
      const ctrl = (item.certificateControlNo || '').toLowerCase();
      const payee = (item.vendorName || '').toLowerCase();
      const tin = (item.vendorTin || '').toLowerCase();
      const atc = (item.atcCodes || []).join(' ').toLowerCase();
      return ctrl.includes(q) || payee.includes(q) || tin.includes(q) || atc.includes(q);
    });

    return list.sort((a, b) => {
      const dateA = a.filedAt || a.periodName || '';
      const dateB = b.filedAt || b.periodName || '';
      if (historySortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [issuedHistory, historySearchQuery, historyPayeeFilter, historyDatePeriod, historyFromDate, historyToDate, historySortOrder]);

  const pagedIssuedHistory = useMemo(() => {
    return filteredIssuedHistory.slice(historyPageIndex * historyPageSize, (historyPageIndex + 1) * historyPageSize);
  }, [filteredIssuedHistory, historyPageIndex, historyPageSize]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchWorkspace = useCallback(
    async (opts?: { forceYear?: string; forceQuarter?: BirQuarter | '' }) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const params = new URLSearchParams();
        const useYear = opts?.forceYear !== undefined ? opts.forceYear : year;
        const useQuarter = opts?.forceQuarter !== undefined ? opts.forceQuarter : quarter;
        if (useYear) params.set('year', useYear);
        if (useQuarter) params.set('quarter', useQuarter);
        params.set('filter', filterMode);
        params.set('limit', '200');
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (overrideAtc) params.set('overrideAtc', overrideAtc);
        if (overrideRate !== '') params.set('overrideRate', overrideRate);

        const data = await apiFetch<Form2307WorkspaceResponse>(`/api/tax/2307/workspace?${params.toString()}`);
        setWorkspace(data);

        // Sync period selectors on initial auto-detection
        if (!useYear && data.period?.year) {
          setYear(String(data.period.year));
        }
        if (!useQuarter && data.period?.quarter) {
          setQuarter(data.period.quarter);
        }

        // Pre-populate signatory defaults once
        if (data.certificates.length > 0) {
          setSignatoryName((prev) => prev || data.certificates[0].signatory.name || '');
          setSignatoryTitle((prev) => prev || data.certificates[0].signatory.designation || '');
          setSignatoryTin((prev) => prev || data.certificates[0].signatory.tin || '');
          setPayorZip((prev) => prev || data.payor.zipCode || '');
        }

        // Keep active vendor selected if still in list, else select first
        setSelectedVendorId((prev) => {
          if (prev && data.certificates.some((c) => c.payee.vendorId === prev)) {
            return prev;
          }
          return data.certificates[0]?.payee.vendorId || null;
        });
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load BIR Form 2307 ledger workspace.');
      } finally {
        setLoading(false);
      }
    },
    [year, quarter, filterMode, debouncedSearch, overrideAtc, overrideRate]
  );

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const certificates = workspace?.certificates || [];

  const activeCertificate = useMemo(() => {
    if (!certificates.length) return null;
    return certificates.find((c) => c.payee.vendorId === selectedVendorId) || certificates[0];
  }, [certificates, selectedVendorId]);

  // Reset per-payee zip override when switching selected vendor
  useEffect(() => {
    setPayeeZipOverride(activeCertificate?.payee.zipCode || '');
    setPayeeForeignAddress(activeCertificate?.payee.foreignAddress || '');
  }, [activeCertificate?.payee.vendorId]);

  // Trigger clean native print of selected Form 2307 sheet(s)
  const triggerPrint = useCallback((certsToPrint: Form2307Certificate[]) => {
    if (!certsToPrint.length) return;
    setPrintQueue(certsToPrint);
    document.body.classList.add('printing-bir-2307');

    const cleanup = () => {
      document.body.classList.remove('printing-bir-2307');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Give React one frame to render the print queue before invoking print dialog
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
        // Fallback cleanup in headless/iframe environments where afterprint may fire immediately
        setTimeout(cleanup, 1200);
      }, 80);
    });
  }, []);

  const handleToggleCheck = (vendorId: string) => {
    setCheckedVendorIds((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) next.delete(vendorId);
      else next.add(vendorId);
      return next;
    });
  };

  const handleToggleCheckAll = () => {
    if (checkedVendorIds.size === certificates.length && certificates.length > 0) {
      setCheckedVendorIds(new Set());
    } else {
      setCheckedVendorIds(new Set(certificates.map((c) => c.payee.vendorId)));
    }
  };

  const handleIssueSingle = async (cert: Form2307Certificate) => {
    setIssuingSingle(true);
    setStatusBanner(null);
    try {
      const res = await apiFetch<any>('/api/tax/2307/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificateControlNo: cert.certificateControlNo,
          vendorId: cert.payee.vendorId,
          vendorName: cert.payee.legalName,
          vendorTin: cert.payee.tin,
          atcCodes: cert.schedule.map((s) => s.atcCode).filter((c) => c !== 'UNASSIGNED_ATC'),
          signatoryName: signatoryName || cert.signatory.name,
          quarter: cert.quarter,
          year: cert.year,
          grossPaymentPhp: cert.totals.grossPaymentPhp,
          taxWithheldPhp: cert.totals.taxWithheldPhp,
        }),
      });
      setStatusBanner({
        type: 'success',
        text: res?.message || `BIR Form 2307 (${cert.certificateControlNo}) recorded in Statutory Tax Register.`,
      });
      await fetchWorkspace();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'Failed to issue BIR Form 2307 certificate.',
      });
    } finally {
      setIssuingSingle(false);
    }
  };

  const handleIssueBatch = async () => {
    const selectedCerts = certificates.filter((c) => checkedVendorIds.has(c.payee.vendorId));
    if (!selectedCerts.length || !workspace) return;
    setIssuingBatch(true);
    setStatusBanner(null);
    try {
      const res = await apiFetch<any>('/api/tax/2307/issue-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: workspace.period.year,
          quarter: workspace.period.quarter,
          certificates: selectedCerts.map((c) => ({
            certificateControlNo: c.certificateControlNo,
            vendorId: c.payee.vendorId,
            vendorName: c.payee.legalName,
            vendorTin: c.payee.tin,
            atcCodes: c.schedule.map((s) => s.atcCode).filter((code) => code !== 'UNASSIGNED_ATC'),
            signatoryName: signatoryName || c.signatory.name,
            grossPaymentPhp: c.totals.grossPaymentPhp,
            taxWithheldPhp: c.totals.taxWithheldPhp,
          })),
        }),
      });
      setStatusBanner({
        type: 'success',
        text: res?.message || `Batch issued ${selectedCerts.length} BIR Form 2307 certificates.`,
      });
      setCheckedVendorIds(new Set());
      await fetchWorkspace();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'Batch issuance failed.',
      });
    } finally {
      setIssuingBatch(false);
    }
  };

  const handleExportSawtCsv = (certsToExport: Form2307Certificate[]) => {
    if (!certsToExport.length) return;
    const headers = [
      'Certificate Control No',
      'Period From',
      'Period To',
      'Payor TIN',
      'Payor Name',
      'Payee TIN',
      'Payee Code',
      'Payee Registered Name',
      'ATC Code',
      'Nature of Income Payment',
      'Tax Rate (%)',
      '1st Month Income (PHP)',
      '2nd Month Income (PHP)',
      '3rd Month Income (PHP)',
      'Total Income Payment Net of VAT (PHP)',
      'Tax Withheld for Quarter (PHP)',
      'Status',
    ];
    const rows: Array<Array<string | number>> = [];
    for (const c of certsToExport) {
      for (const row of c.schedule) {
        rows.push([
          c.certificateControlNo,
          c.periodFrom,
          c.periodTo,
          formatBirTinDisplay(c.payor.tin, c.payor.branchCode),
          c.payor.legalName || '',
          formatBirTinDisplay(c.payee.tin),
          c.payee.vendorCode,
          c.payee.legalName,
          row.atcCode,
          row.natureOfPayment,
          row.taxRatePercent.toFixed(2),
          row.month1GrossPhp.toFixed(2),
          row.month2GrossPhp.toFixed(2),
          row.month3GrossPhp.toFixed(2),
          row.totalGrossPhp.toFixed(2),
          row.totalTaxWithheldPhp.toFixed(2),
          c.issuanceStatus,
        ]);
      }
    }
    const label = certsToExport.length === 1 ? certsToExport[0].certificateControlNo : `BIR-2307-${workspace?.period.year}-${workspace?.period.quarter}`;
    downloadCsvFile(`${label}.csv`, headers, rows);
  };

  const handleAtcOverrideChange = (code: string) => {
    setOverrideAtc(code);
    if (!code) {
      setOverrideRate('');
      return;
    }
    const meta = BIR_2307_ATC_CATALOG.find((a) => a.code === code);
    if (meta) {
      setOverrideRate(String(meta.ratePercent));
    }
  };

  const availableYears = useMemo(() => {
    const set = new Set<number>([2026, 2025, 2024]);
    workspace?.availablePeriods.forEach((p) => set.add(p.year));
    if (year) set.add(Number(year));
    return Array.from(set).sort((a, b) => b - a);
  }, [workspace?.availablePeriods, year]);

  const checkedCerts = useMemo(
    () => certificates.filter((c) => checkedVendorIds.has(c.payee.vendorId)),
    [certificates, checkedVendorIds]
  );

  return (
    <div className="space-y-5">
      {/* HEADER BAR */}
      <section className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-400">
            <FileText className="w-4 h-4 shrink-0" />
            <span>BIR Form No. 2307 · January 2018 (ENCS)</span>
            {workspace?.period && (
              <>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-mono text-slate-600 dark:text-slate-300">
                  {workspace.period.quarter} {workspace.period.year} ({workspace.period.periodFrom} to {workspace.period.periodTo})
                </span>
              </>
            )}
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 tracking-tight">
            BIR Form 2307 — Certificate of Creditable Tax Withheld at Source
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Auto-populated from posted Purchase Bills (net of 12% Input VAT), Supplier Disbursement Vouchers, Vendor Master TINs, and General Ledger EWT control accounts.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => fetchWorkspace()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync Ledger
          </button>

          <button
            type="button"
            onClick={() => handleExportSawtCsv(checkedCerts.length > 0 ? checkedCerts : certificates)}
            disabled={certificates.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            type="button"
            onClick={() => triggerPrint(checkedCerts.length > 0 ? checkedCerts : activeCertificate ? [activeCertificate] : [])}
            disabled={!activeCertificate && checkedCerts.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            {checkedCerts.length > 0 ? `Batch Print (${checkedCerts.length})` : 'Print Form 2307'}
          </button>
        </div>
      </section>

      {/* STATUS & ERROR ALERTS */}
      {errorMsg && (
        <div className="no-print bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusBanner && (
        <div
          className={`no-print rounded-xl px-4 py-3 text-xs border flex items-center justify-between gap-3 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span className="font-medium">{statusBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-xs font-semibold underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 KPI METRIC STRIP */}
      <section className="no-print grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total EWT Withheld ({workspace?.period.quarter || '—'})
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {formatPhp(workspace?.summary.totalTaxWithheldPhp || 0)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
            DV Recorded: {formatPhp(workspace?.summary.totalRecordedDvEwtPhp || 0)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Net-of-VAT Income Base
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {formatPhp(workspace?.summary.totalIncomePaymentBasePhp || 0)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
            12% VAT Excluded: {formatPhp(workspace?.summary.totalVatExcludedPhp || 0)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Payee Certificates Status
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {workspace?.summary.totalCertificatesIssued || 0}{' '}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              / {workspace?.summary.totalPayeesWithActivity || 0} active
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Deadline: <span className="font-mono font-semibold">{workspace?.period.statutoryDeadline || '—'}</span>
            {(workspace?.summary.certificatesNeedingAttention || 0) > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {' '}· {workspace?.summary.certificatesNeedingAttention} attention
              </span>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            GL EWT Control Ledger
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {formatPhp(workspace?.glReconciliation.glEwtCreditPhp || 0)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono truncate">
            {workspace?.glReconciliation.ewtAccounts.length
              ? `GL ${workspace.glReconciliation.ewtAccounts.map((a) => a.code).join(', ')} · Diff: ${formatPhp(workspace.glReconciliation.reconciliationDiffPhp)}`
              : 'No GL EWT credits posted in quarter'}
          </div>
        </div>
      </section>

      {/* WORKSPACE TABS */}
      <div className="no-print border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-6" role="tablist" aria-label="BIR Form 2307 Views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'generate'}
            onClick={() => setActiveTab('generate')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'generate'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <FileCheck2 className="w-4 h-4" />
            Generate &amp; Print Certificates ({workspace?.totalMatchedCertificates ?? 0})
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'register'}
            onClick={() => setActiveTab('register')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'register'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            Issued Certificates Register ({workspace?.issuedHistory.length ?? 0})
          </button>
        </div>

        {/* Active Payor Info Line */}
        {workspace?.payor && (
          <div className="pb-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">{workspace.payor.legalName}</span>
            <span>·</span>
            <span className="font-mono">TIN {formatBirTinDisplay(workspace.payor.tin, workspace.payor.branchCode)}</span>
            {workspace.payor.rdoCode && (
              <>
                <span>·</span>
                <span className="font-mono">RDO {workspace.payor.rdoCode}</span>
              </>
            )}
          </div>
        )}
      </div>

      {activeTab === 'generate' ? (
        <div className="no-print space-y-4">
          {/* FILTER & PERIOD CONTROL BAR */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              {/* Year */}
              <div className="md:col-span-2">
                <label htmlFor="f2307-year" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Taxable Year
                </label>
                <select
                  id="f2307-year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {availableYears.map((yr) => (
                    <option key={yr} value={String(yr)}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quarter */}
              <div className="md:col-span-2">
                <label htmlFor="f2307-quarter" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  BIR Quarter
                </label>
                <select
                  id="f2307-quarter"
                  value={quarter}
                  onChange={(e) => setQuarter(e.target.value as BirQuarter)}
                  className="w-full h-9 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="Q1">Q1 (Jan–Mar)</option>
                  <option value="Q2">Q2 (Apr–Jun)</option>
                  <option value="Q3">Q3 (Jul–Sep)</option>
                  <option value="Q4">Q4 (Oct–Dec)</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="md:col-span-2">
                <label htmlFor="f2307-filter" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Payee Scope
                </label>
                <select
                  id="f2307-filter"
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value as any)}
                  className="w-full h-9 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="ACTIVITY">Active in Quarter</option>
                  <option value="RECORDED_EWT">With EWT / Tax Withheld</option>
                  <option value="ATTENTION">Needs Attention</option>
                  <option value="ISSUED">Issued Only</option>
                  <option value="ALL">All Master Vendors</option>
                </select>
              </div>

              {/* ATC Override */}
              <div className="md:col-span-3">
                <label htmlFor="f2307-atc" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  ATC Rule (Auto or Override)
                </label>
                <select
                  id="f2307-atc"
                  value={overrideAtc}
                  onChange={(e) => handleAtcOverrideChange(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">Auto-detect from Ledger / Vendor</option>
                  {BIR_2307_ATC_CATALOG.map((atc) => (
                    <option key={atc.code} value={atc.code}>
                      {atc.code} ({atc.ratePercent}%) — {atc.nature}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div className="md:col-span-3">
                <label htmlFor="f2307-search" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Search Payee / TIN / ATC
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="f2307-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Supplier name, TIN, or ATC..."
                    className="w-full h-9 pl-8 pr-3 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>

            {/* Active Ledger Quarters Quick Strip + Signatory Drawer Toggle */}
            <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Ledger Periods with Activity:
                </span>
                {(workspace?.availablePeriods || []).slice(0, 6).map((p) => {
                  const isCurrent = String(p.year) === year && p.quarter === quarter;
                  return (
                    <button
                      key={`${p.year}-${p.quarter}`}
                      type="button"
                      onClick={() => {
                        setYear(String(p.year));
                        setQuarter(p.quarter);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                        isCurrent
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {p.quarter} {p.year} ({p.billsCount} bills{p.ewtPhp > 0 ? ` · ${formatPhp(p.ewtPhp)} EWT` : ''})
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setShowSignatoryDrawer((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-400 hover:underline"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Signatory &amp; Print Details
                {showSignatoryDrawer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* COLLAPSIBLE SIGNATORY & ZIP OVERRIDES */}
            {showSignatoryDrawer && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <div>
                  <label htmlFor="sig-name" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Authorized Signatory
                  </label>
                  <input
                    id="sig-name"
                    type="text"
                    value={signatoryName}
                    onChange={(e) => setSignatoryName(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="sig-title" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Designation / Title
                  </label>
                  <input
                    id="sig-title"
                    type="text"
                    value={signatoryTitle}
                    onChange={(e) => setSignatoryTitle(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="sig-tin" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Signatory TIN
                  </label>
                  <input
                    id="sig-tin"
                    type="text"
                    value={signatoryTin}
                    onChange={(e) => setSignatoryTin(e.target.value)}
                    placeholder="000-000-000-000"
                    className="w-full h-8 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="payor-zip" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Payor ZIP (Box 9A)
                  </label>
                  <input
                    id="payor-zip"
                    type="text"
                    maxLength={4}
                    value={payorZip}
                    onChange={(e) => setPayorZip(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 1634"
                    className="w-full h-8 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="payee-zip" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Payee ZIP (Box 5A)
                  </label>
                  <input
                    id="payee-zip"
                    type="text"
                    maxLength={4}
                    value={payeeZipOverride}
                    onChange={(e) => setPayeeZipOverride(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 1226"
                    className="w-full h-8 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="override-rate" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Rate Override (%)
                  </label>
                  <input
                    id="override-rate"
                    type="number"
                    min="0"
                    max="35"
                    step="0.5"
                    value={overrideRate}
                    onChange={(e) => setOverrideRate(e.target.value)}
                    placeholder="Auto"
                    className="w-full h-8 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* BATCH SELECTION ACTION BAR */}
          {checkedCerts.length > 0 && (
            <div className="bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                {checkedCerts.length} payee certificate(s) selected · Combined EWT:{' '}
                <span className="font-mono font-bold">
                  {formatPhp(checkedCerts.reduce((s, c) => s + c.totals.taxWithheldPhp, 0))}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleIssueBatch}
                  disabled={issuingBatch}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {issuingBatch ? 'Issuing Batch...' : `Batch Issue (${checkedCerts.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => triggerPrint(checkedCerts)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Batch Print ({checkedCerts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedVendorIds(new Set())}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* MASTER-DETAIL SPLIT WORKSPACE */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT RAIL: PAYEE CERTIFICATES QUEUE */}
            <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
                <button
                  type="button"
                  onClick={handleToggleCheckAll}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  {checkedVendorIds.size === certificates.length && certificates.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                  <span>Payee Queue ({certificates.length})</span>
                </button>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Sorted by EWT
                </span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[820px] overflow-y-auto">
                {loading && certificates.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                    Scanning AP Bills &amp; Disbursement Vouchers...
                  </div>
                ) : certificates.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      No matching payees in {quarter || 'selected quarter'} {year}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Switch Payee Scope to &ldquo;All Master Vendors&rdquo; or select a quarter with posted supplier bills above.
                    </p>
                  </div>
                ) : (
                  certificates.map((cert) => {
                    const isSelected = activeCertificate?.payee.vendorId === cert.payee.vendorId;
                    const isChecked = checkedVendorIds.has(cert.payee.vendorId);
                    const hasWarn = cert.warnings.some((w) => w.severity === 'ERROR' || w.severity === 'WARNING');
                    const primaryAtc = cert.schedule[0]?.atcCode || 'UNASSIGNED_ATC';

                    return (
                      <div
                        key={cert.payee.vendorId}
                        className={`px-3.5 py-3 flex items-start gap-2.5 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-indigo-50/90 dark:bg-indigo-950/50'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                        onClick={() => setSelectedVendorId(cert.payee.vendorId)}
                      >
                        <button
                          type="button"
                          aria-label={`Select ${cert.payee.legalName} for batch action`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleCheck(cert.payee.vendorId);
                          }}
                          className="mt-0.5 text-slate-400 hover:text-indigo-600 shrink-0"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className={`text-xs font-semibold truncate ${
                                isSelected
                                  ? 'text-indigo-900 dark:text-indigo-200'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {cert.payee.legalName}
                            </span>
                            <span className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                              {formatPhp(cert.totals.taxWithheldPhp)}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            <span className="truncate">
                              {cert.payee.tin || 'No TIN'} · {primaryAtc === 'UNASSIGNED_ATC' ? 'No ATC' : primaryAtc}
                            </span>
                            <span className="shrink-0">
                              Base {formatPhp(cert.totals.grossPaymentPhp)}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center gap-2 text-[10.5px]">
                            <span
                              className={`font-semibold ${
                                cert.issuanceStatus === 'ISSUED'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {cert.issuanceStatus === 'ISSUED' ? 'Issued' : 'Draft'}
                            </span>
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {cert.apRecordsCount.billsCount} bill(s) · {cert.apRecordsCount.paymentsCount} DV(s)
                            </span>
                            {hasWarn && (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                  Attention
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT STAGE: LIVE OFFICIAL BIR FORM 2307 PREVIEW & LEDGER AUDIT */}
            <div className="lg:col-span-8 space-y-4">
              {activeCertificate ? (
                <>
                  {/* CERTIFICATE ACTION HEADER */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {activeCertificate.certificateControlNo}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {activeCertificate.payee.legalName} · Status:{' '}
                        <span
                          className={
                            activeCertificate.issuanceStatus === 'ISSUED'
                              ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                              : 'font-semibold text-slate-700 dark:text-slate-300'
                          }
                        >
                          {activeCertificate.issuanceStatus}
                        </span>
                        {activeCertificate.issuedAt && (
                          <span className="font-mono"> ({activeCertificate.issuedAt.slice(0, 10)})</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowLedgerSource((v) => !v)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        {showLedgerSource ? 'Hide Ledger Source' : 'Ledger Source'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportSawtCsv([activeCertificate])}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Download className="w-3.5 h-3.5" />
                        CSV
                      </button>

                      <button
                        type="button"
                        onClick={() => handleIssueSingle(activeCertificate)}
                        disabled={issuingSingle}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {issuingSingle
                          ? 'Recording...'
                          : activeCertificate.issuanceStatus === 'ISSUED'
                            ? 'Re-Issue & Update'
                            : 'Issue & Record 2307'}
                      </button>

                      <button
                        type="button"
                        onClick={() => triggerPrint([activeCertificate])}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print Form 2307
                      </button>
                    </div>
                  </div>

                  {/* COMPLIANCE VALIDATION NOTES (ONLY IF WARNINGS/ERRORS EXIST) */}
                  {activeCertificate.warnings.some((w) => w.severity === 'ERROR' || w.severity === 'WARNING') && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-3.5 space-y-1.5">
                      {activeCertificate.warnings
                        .filter((w) => w.severity === 'ERROR' || w.severity === 'WARNING')
                        .map((w, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                            <span>{w.message}</span>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* LEDGER SOURCE TRACEABILITY DRAWER */}
                  {showLedgerSource && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                          Linked Posted Purchase Bills ({activeCertificate.sourceBills.length})
                        </h3>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                              <tr>
                                <th className="py-2 pr-3">Bill #</th>
                                <th className="py-2 pr-3">Date</th>
                                <th className="py-2 pr-3">ATC</th>
                                <th className="py-2 pr-3 text-right">Gross (₱)</th>
                                <th className="py-2 pr-3 text-right">12% VAT (₱)</th>
                                <th className="py-2 pr-3 text-right">Net EWT Base (₱)</th>
                                <th className="py-2 text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                              {activeCertificate.sourceBills.slice(0, 25).map((b) => (
                                <tr key={b.billId}>
                                  <td className="py-1.5 pr-3 font-semibold text-indigo-700 dark:text-indigo-400">{b.billNumber}</td>
                                  <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{String(b.billDate || '').slice(0, 10)}</td>
                                  <td className="py-1.5 pr-3 text-slate-700 dark:text-slate-300">{b.atcCode === 'UNASSIGNED_ATC' ? '—' : b.atcCode}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPhp(b.grossPhp)}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{formatPhp(b.vatPhp)}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">{formatPhp(b.netOfVatPhp)}</td>
                                  <td className="py-1.5 text-right text-[11px] text-slate-600 dark:text-slate-300">{b.status}</td>
                                </tr>
                              ))}
                              {activeCertificate.sourceBills.length === 0 && (
                                <tr>
                                  <td colSpan={7} className="py-3 text-center font-sans text-slate-500">
                                    No posted purchase bills in this quarter.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                          Linked Supplier Disbursement Vouchers ({activeCertificate.sourcePayments.length})
                        </h3>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                              <tr>
                                <th className="py-2 pr-3">Voucher #</th>
                                <th className="py-2 pr-3">Date</th>
                                <th className="py-2 pr-3">Method / Ref</th>
                                <th className="py-2 pr-3 text-right">Net Cash Paid (₱)</th>
                                <th className="py-2 text-right">EWT Withheld (₱)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                              {activeCertificate.sourcePayments.slice(0, 25).map((p) => (
                                <tr key={p.paymentId}>
                                  <td className="py-1.5 pr-3 font-semibold text-emerald-700 dark:text-emerald-400">{p.paymentNumber}</td>
                                  <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-300">{p.paymentDate}</td>
                                  <td className="py-1.5 pr-3 font-sans text-slate-600 dark:text-slate-300">
                                    {p.paymentMethod}{p.reference ? ` · ${p.reference}` : ''}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPhp(p.cashPaidPhp)}</td>
                                  <td className="py-1.5 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">{formatPhp(p.ewtWithheldPhp)}</td>
                                </tr>
                              ))}
                              {activeCertificate.sourcePayments.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="py-3 text-center font-sans text-slate-500">
                                    No posted supplier disbursement vouchers in this quarter.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* OFFICIAL BIR FORM 2307 PAPER PREVIEW */}
                  <div className="bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 overflow-x-auto">
                    <BirForm2307OfficialSheet
                      certificate={activeCertificate}
                      signatoryOverride={{
                        name: signatoryName,
                        designation: signatoryTitle,
                        tin: signatoryTin,
                      }}
                      payorZipOverride={payorZip}
                      payeeZipOverride={payeeZipOverride}
                      payeeForeignAddressOverride={payeeForeignAddress}
                    />
                  </div>
                </>
              ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-2">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Select a Payee to Preview BIR Form 2307
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    All certificate boxes auto-populate directly from posted AP bills, Disbursement Vouchers, and Vendor TIN master records.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* TAB 2: ISSUED CERTIFICATES REGISTER */
        <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Issued BIR Form 2307 Statutory Register
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Audit-logged certificates formally issued and archived in the company&rsquo;s Tax Filings register.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchWorkspace()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Register
            </button>
          </div>

          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <TableFilterToolbar
              searchQuery={historySearchQuery}
              onSearchChange={(q) => {
                setHistorySearchQuery(q);
                setHistoryPageIndex(0);
              }}
              searchPlaceholder="Search control #, payee name, TIN, ATC..."
              sortOrder={historySortOrder}
              onSortOrderChange={(ord) => {
                setHistorySortOrder(ord);
                setHistoryPageIndex(0);
              }}
              datePeriod={historyDatePeriod}
              onDatePeriodChange={(p) => {
                setHistoryDatePeriod(p);
                setHistoryPageIndex(0);
              }}
              fromDate={historyFromDate}
              toDate={historyToDate}
              onDateRangeChange={({ fromDate, toDate }) => {
                setHistoryFromDate(fromDate);
                setHistoryToDate(toDate);
                setHistoryPageIndex(0);
              }}
              entityLabel="Payee / Supplier"
              selectedEntityId={historyPayeeFilter}
              onEntityChange={(val) => {
                setHistoryPayeeFilter(val);
                setHistoryPageIndex(0);
              }}
              entityOptions={payeeOptions}
              pageSize={historyPageSize}
              onPageSizeChange={(sz) => {
                setHistoryPageSize(sz);
                setHistoryPageIndex(0);
              }}
              totalCount={issuedHistory.length}
              filteredCount={filteredIssuedHistory.length}
              onResetFilters={() => {
                setHistorySearchQuery('');
                setHistorySortOrder('DESC');
                setHistoryDatePeriod('ALL');
                setHistoryFromDate('');
                setHistoryToDate('');
                setHistoryPayeeFilter('ALL');
                setHistoryPageSize(20);
                setHistoryPageIndex(0);
              }}
            />
          </div>

          <TableScrollContainer
            maxHeight="calc(100vh - 360px)"
            minHeight="280px"
            stickyHeader={true}
            title={`Issued Form 2307 Certificates Register (${filteredIssuedHistory.length})`}
            totalRecordsCount={filteredIssuedHistory.length}
            pagination={{
              pageIndex: historyPageIndex,
              pageSize: historyPageSize,
              pageSizeOptions: [20, 25, 50, 100],
              totalRecords: filteredIssuedHistory.length,
              itemCount: pagedIssuedHistory.length,
              onPageChange: setHistoryPageIndex,
              onPageSizeChange: (newSize) => {
                setHistoryPageSize(newSize);
                setHistoryPageIndex(0);
              },
              loading,
            }}
          >
            <table className="w-full text-left text-xs min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Control No.</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4">Payee &amp; TIN</th>
                  <th className="py-3 px-4">ATC</th>
                  <th className="py-3 px-4 text-right">Income Base (₱)</th>
                  <th className="py-3 px-4 text-right">EWT Withheld (₱)</th>
                  <th className="py-3 px-4">Issued Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedIssuedHistory.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-indigo-700 dark:text-indigo-400">
                      {row.certificateControlNo}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {row.periodName}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{row.vendorName}</div>
                      {row.vendorTin && (
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">TIN {row.vendorTin}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {row.atcCodes.length > 0 ? row.atcCodes.join(', ') : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatPhp(row.totalTaxBasePhp)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                      {formatPhp(row.totalTaxDuePhp)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                      {row.filedAt ? row.filedAt.slice(0, 10) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          const [pYear, pQuarter] = String(row.periodName || '').split('-');
                          if (pYear && ['Q1', 'Q2', 'Q3', 'Q4'].includes(pQuarter)) {
                            setYear(pYear);
                            setQuarter(pQuarter as BirQuarter);
                          }
                          if (row.vendorId) {
                            setSelectedVendorId(row.vendorId);
                          }
                          setActiveTab('generate');
                        }}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Open &amp; Print
                      </button>
                    </td>
                  </tr>
                ))}

                {issuedHistory.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400">
                      No BIR Form 2307 certificates have been formally issued yet. Select a payee in &ldquo;Generate &amp; Print Certificates&rdquo; and click &ldquo;Issue &amp; Record 2307&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        </div>
      )}

      {/* DEDICATED PRINT-ONLY PORTAL FOR CLEAN OFFICIAL BIR FORM 2307 OUTPUT */}
      <div className="bir-2307-print-only" aria-hidden="true">
        {(printQueue.length > 0 ? printQueue : activeCertificate ? [activeCertificate] : []).map((cert) => (
          <div key={cert.certificateControlNo} className="bir-2307-page-break">
            <BirForm2307OfficialSheet
              certificate={cert}
              signatoryOverride={{
                name: signatoryName,
                designation: signatoryTitle,
                tin: signatoryTin,
              }}
              payorZipOverride={payorZip}
              payeeZipOverride={
                cert.payee.vendorId === activeCertificate?.payee.vendorId ? payeeZipOverride : cert.payee.zipCode
              }
              payeeForeignAddressOverride={
                cert.payee.vendorId === activeCertificate?.payee.vendorId
                  ? payeeForeignAddress
                  : cert.payee.foreignAddress
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
