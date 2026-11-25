import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText, Download, ShieldCheck, AlertTriangle, CheckCircle2,
  RefreshCw, Plus, Save, Lock, Clock, Activity, Trash2, Send, ThumbsUp, RotateCcw
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import RecordActivityModal from '../../components/RecordActivityModal';
import { apiFetch } from '../../utils/apiClient';
import { TableScrollContainer } from '../../components/shared/TableScrollContainer';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter, computePeriodDates } from '../../components/shared/TableFilterToolbar';

const BIR_EWT_ATC_OPTIONS = [
  { code: 'WC156', label: 'WC156 — Top Withholding Agent: Goods (Corp) · 1%', ratePercent: 1 },
  { code: 'WC158', label: 'WC158 — Top Withholding Agent: Local Goods (Corp) · 1%', ratePercent: 1 },
  { code: 'WI158', label: 'WI158 — Top Withholding Agent: Local Goods (Indiv) · 1%', ratePercent: 1 },
  { code: 'WC160', label: 'WC160 — Services / Contractors (Corp) · 2%', ratePercent: 2 },
  { code: 'WI160', label: 'WI160 — Services / Contractors (Indiv) · 2%', ratePercent: 2 },
  { code: 'WC157', label: 'WC157 — Top Withholding Agent: Services (Corp) · 2%', ratePercent: 2 },
  { code: 'WC100', label: 'WC100 — Rentals on Real/Personal Property (Corp) · 5%', ratePercent: 5 },
  { code: 'WI100', label: 'WI100 — Rentals on Real/Personal Property (Indiv) · 5%', ratePercent: 5 },
  { code: 'WC010', label: 'WC010 — Professional / Management Fees (Corp) · 10%', ratePercent: 10 },
  { code: 'WI010', label: 'WI010 — Professional Fees <= ₱3M (Indiv) · 5%', ratePercent: 5 },
  { code: 'WI011', label: 'WI011 — Professional Fees > ₱3M (Indiv) · 10%', ratePercent: 10 },
  { code: 'WC140', label: 'WC140 — Brokers / Commission / Agents (Corp) · 10%', ratePercent: 10 },
] as const;

const formatCentavos = (centavos: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((centavos || 0) / 100);
};

const TIN_REGEX = /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/;

interface OfflineDraftEntry {
  id: string;
  exporterType: 'QAP_MAP' | 'SAWT' | 'SLSP' | '1604_E';
  counterpartyName: string;
  tin: string;
  atcCode: string;
  transactionDate: string;
  taxBaseCentavos: number;
  taxRatePercent: number;
  taxAmountCentavos: number;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
  createdBy: string;
  updatedAt: string;
}

export default function LedgerDataEntry() {
  const { activeCompany, user } = useAuth();
  const [activeExporter, setActiveExporter] = useState<'QAP_MAP' | 'SAWT' | 'SLSP' | '1604_E'>('QAP_MAP');
  const [period, setPeriod] = useState('2026-Q4');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Pagination for authoritative schedule rows (20 default, 25, 50, 100, custom)
  const [schedulePageIndex, setSchedulePageIndex] = useState(0);
  const [schedulePageSize, setSchedulePageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');

  // Offline Drafts stored locally per company
  const storageKey = `ledgerai_ph_lde_drafts_${activeCompany?.id || 'default'}`;
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineDraftEntry[]>([]);
  const [batchApprovalStatus, setBatchApprovalStatus] = useState<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED'>('DRAFT');

  // New Draft Form State (Integer-Centavo calculations, explicit ATC required)
  const [draftForm, setDraftForm] = useState({
    counterpartyName: '',
    tin: '',
    atcCode: '',
    transactionDate: new Date().toISOString().slice(0, 10),
    taxBasePhp: '',
    taxRatePercent: 0
  });
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // 360° Journey Modal
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title?: string } | null>(null);

  const loadOfflineDrafts = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setOfflineDrafts(parsed);
          return;
        }
      }
      setOfflineDrafts([]);
    } catch (e) {
      console.error('Failed to load offline drafts:', e);
      setOfflineDrafts([]);
    }
  };

  const saveOfflineDrafts = (next: OfflineDraftEntry[]) => {
    setOfflineDrafts(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to persist offline drafts:', e);
    }
  };

  const fetchLdeData = async () => {
    setLoading(true);
    try {
      const json = await apiFetch<any>('/api/journey/ledger-data-entry');
      setData(json);
    } catch (err) {
      console.error('Error loading Ledger Data Entry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOfflineDrafts();
    fetchLdeData();
  }, [activeCompany?.id]);

  // Integer-centavo calculation
  const computedBaseCentavos = Math.round((parseFloat(draftForm.taxBasePhp) || 0) * 100);
  const computedTaxCentavos = Math.round((computedBaseCentavos * (Number(draftForm.taxRatePercent) || 0)) / 100);

  const handleSaveOfflineDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!draftForm.counterpartyName.trim()) {
      errs.push('Counterparty legal name is required.');
    }
    if (!TIN_REGEX.test(draftForm.tin.trim())) {
      errs.push('Strict BIR TIN validation failed: Format must be NNN-NNN-NNN-000.');
    }
    if (!draftForm.atcCode.trim()) {
      errs.push('Explicit BIR ATC selection is required (no silent default tax rate).');
    }
    if (!draftForm.transactionDate || isNaN(Date.parse(draftForm.transactionDate))) {
      errs.push('Strict date integrity check failed: Valid YYYY-MM-DD transaction date is required.');
    }
    if (computedBaseCentavos <= 0) {
      errs.push('Tax base must be greater than ₱0.00 (0 centavos).');
    }

    if (errs.length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormErrors([]);
    const newEntry: OfflineDraftEntry = {
      id: `LDE-DRAFT-${Date.now().toString().slice(-6)}`,
      exporterType: activeExporter,
      counterpartyName: draftForm.counterpartyName.trim(),
      tin: draftForm.tin.trim(),
      atcCode: draftForm.atcCode.trim(),
      transactionDate: draftForm.transactionDate,
      taxBaseCentavos: computedBaseCentavos,
      taxRatePercent: Number(draftForm.taxRatePercent),
      taxAmountCentavos: computedTaxCentavos,
      status: 'DRAFT',
      createdBy: user?.displayName || user?.email || 'Current User',
      updatedAt: new Date().toISOString()
    };

    saveOfflineDrafts([newEntry, ...offlineDrafts]);
    setDraftForm({
      ...draftForm,
      counterpartyName: ''
    });
    setFeedback({
      type: 'success',
      message: `Offline draft ${newEntry.id} saved locally with integer-centavo precision (${computedTaxCentavos} centavos).`
    });
  };

  const handleDraftStatusChange = (id: string, nextStatus: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED') => {
    const updated = offlineDrafts.map(d => d.id === id ? { ...d, status: nextStatus, updatedAt: new Date().toISOString() } : d);
    saveOfflineDrafts(updated);
  };

  const handleRemoveDraft = (id: string) => {
    saveOfflineDrafts(offlineDrafts.filter(d => d.id !== id));
  };

  const handleExecuteExport = async () => {
    setFeedback(null);

    if (batchApprovalStatus !== 'APPROVED') {
      setFeedback({
        type: 'error',
        message: `Export Blocked: Ledger Data Entry schedule is currently ${batchApprovalStatus}. Approval is required before generating official BIR DAT/CSV files.`
      });
      return;
    }

    setExporting(true);
    try {
      const resData = await apiFetch<any>('/api/journey/ledger-data-entry/export', {
        method: 'POST',
        body: {
          exporterType: activeExporter,
          period
        } as any
      });

      // Trigger browser download of DAT content
      const blob = new Blob([resData.datContent || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resData.fileName || `BIR_${activeExporter}_${period}.DAT`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setFeedback({
        type: 'success',
        message: `Exported ${resData.fileName} (${resData.rowCount} records) and recorded in immutable Export Audit History.`
      });
      fetchLdeData();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Export failed.'
      });
    } finally {
      setExporting(false);
    }
  };

  const exporterTabs = [
    { id: 'QAP_MAP', label: 'QAP / MAP (1601-EQ / 0619-E)', desc: 'Quarterly & Monthly Alphalist of Payees (Expanded Withholding Tax)' },
    { id: 'SAWT', label: 'SAWT (Form 2307 Credits)', desc: 'Summary Alphalist of Withholding Taxes Claimed as Tax Credits' },
    { id: 'SLSP', label: 'SLSP (RELIEF Sales & Purchases)', desc: 'Summary List of Sales & Purchases (12% Output & Input VAT)' },
    { id: '1604_E', label: 'BIR Form 1604-E Annual', desc: 'Annual Information Return of Creditable Income Taxes Withheld' }
  ] as const;

  const activeScheduleRows: any[] =
    activeExporter === 'QAP_MAP'
      ? data?.exporters?.qapMap || []
      : activeExporter === 'SAWT'
      ? data?.exporters?.sawt || []
      : activeExporter === 'SLSP'
      ? [
          ...(data?.exporters?.slsp?.sales || []).map((r: any) => ({ ...r, slspType: 'SALES' })),
          ...(data?.exporters?.slsp?.purchases || []).map((r: any) => ({ ...r, slspType: 'PURCHASES' }))
        ]
      : data?.exporters?.form1604E || [];

  const filteredScheduleRows = useMemo(() => {
    let result = [...activeScheduleRows];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => {
        const text = `${r.vendorName || ''} ${r.customerName || ''} ${r.counterpartyName || ''} ${r.tin || ''} ${r.atcCode || ''} ${r.reference || ''}`.toLowerCase();
        return text.includes(q);
      });
    }

    if (datePeriod !== 'ALL') {
      const { fromDate, toDate } = datePeriod === 'CUSTOM'
        ? { fromDate: customFromDate, toDate: customToDate }
        : computePeriodDates(datePeriod);

      if (fromDate) {
        result = result.filter(r => {
          const d = (r.billDate || r.invoiceDate || r.date || '').slice(0, 10);
          return d ? d >= fromDate : true;
        });
      }
      if (toDate) {
        result = result.filter(r => {
          const d = (r.billDate || r.invoiceDate || r.date || '').slice(0, 10);
          return d ? d <= toDate : true;
        });
      }
    }

    result.sort((a, b) => {
      const dateA = (a.billDate || a.invoiceDate || a.date || '');
      const dateB = (b.billDate || b.invoiceDate || b.date || '');
      const cmp = dateA.localeCompare(dateB);
      return sortOrder === 'ASC' ? cmp : -cmp;
    });

    return result;
  }, [activeScheduleRows, searchQuery, datePeriod, customFromDate, customToDate, sortOrder]);

  const pagedScheduleRows: any[] = useMemo(() => {
    return filteredScheduleRows.slice(schedulePageIndex * schedulePageSize, (schedulePageIndex + 1) * schedulePageSize);
  }, [filteredScheduleRows, schedulePageIndex, schedulePageSize]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSortOrder('DESC');
    setDatePeriod('ALL');
    setCustomFromDate('');
    setCustomToDate('');
    setSchedulePageIndex(0);
  };

  useEffect(() => {
    setSchedulePageIndex(0);
  }, [activeExporter, period]);

  const reconciliation = data?.reconciliation;
  const exportBlocked = data?.exportBlocked;
  const blockingReasons: string[] = data?.blockingReasons || [];
  const exportHistory: any[] = data?.exportHistory || [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              BIR Statutory Exporters & Reconciliation
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${
              batchApprovalStatus === 'APPROVED'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
            }`}>
              Lifecycle: {batchApprovalStatus}
            </span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Ledger Data Entry
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Official QAP/MAP, SAWT, SLSP, and 1604-E schedules with offline draft persistence, strict TIN/date integrity, integer-centavo calculations, GL-to-subledger reconciliation, and export blocking.
          </p>
        </div>

        {/* Batch Approval Lifecycle Controls & Exporter Trigger */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setBatchApprovalStatus('SUBMITTED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${
                batchApprovalStatus === 'SUBMITTED' ? 'bg-purple-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Send className="w-3 h-3" /> Submit
            </button>
            <button
              type="button"
              onClick={() => setBatchApprovalStatus('APPROVED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${
                batchApprovalStatus === 'APPROVED' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <ThumbsUp className="w-3 h-3" /> Approve
            </button>
            <button
              type="button"
              onClick={() => setBatchApprovalStatus('RETURNED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${
                batchApprovalStatus === 'RETURNED' ? 'bg-amber-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <RotateCcw className="w-3 h-3" /> Return
            </button>
          </div>

          <input
            type="text"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="w-28 px-3 py-2 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100"
            placeholder="2026-Q4"
          />

          <button
            type="button"
            disabled={exporting || exportBlocked || batchApprovalStatus !== 'APPROVED'}
            onClick={handleExecuteExport}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
            title={exportBlocked ? 'Export blocked due to validation issues' : 'Generate official BIR DAT export'}
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Generating DAT...' : `Export ${activeExporter} (.DAT)`}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div className={`p-4 rounded-2xl border text-xs font-semibold flex items-center justify-between ${
          feedback.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
        }`}>
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="underline ml-4">Dismiss</button>
        </div>
      )}

      {/* Export Blocking Alert */}
      {(exportBlocked || batchApprovalStatus !== 'APPROVED') && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-start gap-3">
          <Lock className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <div className="font-extrabold text-rose-900 dark:text-rose-200 uppercase tracking-wider">
              BIR Statutory Export Gate Blocked
            </div>
            {batchApprovalStatus !== 'APPROVED' && (
              <p className="text-rose-700 dark:text-rose-300">
                • Schedule lifecycle status is <strong>{batchApprovalStatus}</strong>. Only <strong>APPROVED</strong> schedules can be exported.
              </p>
            )}
            {blockingReasons.map((r, idx) => (
              <p key={idx} className="text-rose-700 dark:text-rose-300">• {r}</p>
            ))}
          </div>
        </div>
      )}

      {/* GL-to-Subledger Centavo Reconciliation Panel */}
      {reconciliation && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                AR Subledger vs General Ledger (Centavo Check)
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                reconciliation.isArReconciled
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}>
                {reconciliation.isArReconciled ? 'RECONCILED (₱0.00 Diff)' : 'VARIANCE DETECTED'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono">
              <div>
                <span className="text-[10px] text-slate-400 block">AR Subledger</span>
                <strong className="text-slate-900 dark:text-white">{formatCentavos(reconciliation.subledgerArCentavos)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">GL Posted AR</span>
                <strong className="text-slate-900 dark:text-white">{formatCentavos(reconciliation.glArCentavos)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Variance</span>
                <strong className={reconciliation.arVarianceCentavos === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                  {formatCentavos(reconciliation.arVarianceCentavos)}
                </strong>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                AP Subledger vs General Ledger (Centavo Check)
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                reconciliation.isApReconciled
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}>
                {reconciliation.isApReconciled ? 'RECONCILED (₱0.00 Diff)' : 'VARIANCE DETECTED'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono">
              <div>
                <span className="text-[10px] text-slate-400 block">AP Subledger</span>
                <strong className="text-slate-900 dark:text-white">{formatCentavos(reconciliation.subledgerApCentavos)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">GL Posted AP</span>
                <strong className="text-slate-900 dark:text-white">{formatCentavos(reconciliation.glApCentavos)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Variance</span>
                <strong className={reconciliation.apVarianceCentavos === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                  {formatCentavos(reconciliation.apVarianceCentavos)}
                </strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4 Exporter Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {exporterTabs.map(tab => {
          const active = activeExporter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveExporter(tab.id)}
              className={`p-4 rounded-2xl border text-left transition-all ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
              }`}
            >
              <div className="font-extrabold text-sm">{tab.label}</div>
              <p className={`text-[11px] mt-1 ${active ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>
                {tab.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Offline Draft Entry Form (Integer-Centavo + Strict TIN & Date Validation) */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Save className="w-4 h-4 text-indigo-600" />
              Offline-First Ledger Data Entry Drafts ({offlineDrafts.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Create and validate BIR tax schedule rows offline with strict TIN format (`NNN-NNN-NNN-000`) and integer-centavo accuracy.
            </p>
          </div>
        </div>

        {formErrors.length > 0 && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 space-y-1">
            {formErrors.map((e, i) => (
              <div key={i}>• {e}</div>
            ))}
          </div>
        )}

        <form onSubmit={handleSaveOfflineDraft} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Registered Counterparty Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Manila Prime Supplies Inc."
              value={draftForm.counterpartyName}
              onChange={e => setDraftForm({ ...draftForm, counterpartyName: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">BIR TIN (NNN-NNN-NNN-000)</label>
            <input
              type="text"
              required
              placeholder="000-000-000-000"
              value={draftForm.tin}
              onChange={e => setDraftForm({ ...draftForm, tin: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">BIR ATC & Rate</label>
            <select
              required
              value={draftForm.atcCode}
              onChange={e => {
                const selected = BIR_EWT_ATC_OPTIONS.find(o => o.code === e.target.value);
                setDraftForm({
                  ...draftForm,
                  atcCode: e.target.value,
                  taxRatePercent: selected ? selected.ratePercent : 0
                });
              }}
              className="w-full px-2.5 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            >
              <option value="">Select ATC...</option>
              {BIR_EWT_ATC_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Transaction Date</label>
            <input
              type="date"
              required
              value={draftForm.transactionDate}
              onChange={e => setDraftForm({ ...draftForm, transactionDate: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Tax Base (PHP)</label>
            <input
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={draftForm.taxBasePhp}
              onChange={e => setDraftForm({ ...draftForm, taxBasePhp: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <button
              type="submit"
              className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs"
            >
              <Plus className="w-4 h-4" /> Save Offline Draft
            </button>
          </div>
        </form>

        {offlineDrafts.length > 0 && (
          <div className="pt-2 overflow-x-auto">
            <table className="w-full text-left text-xs border-t border-slate-100 dark:border-slate-700">
              <thead className="text-slate-400 uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2 px-3">Draft Ref</th>
                  <th className="py-2 px-3">Schedule</th>
                  <th className="py-2 px-3">Counterparty</th>
                  <th className="py-2 px-3">TIN</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3 text-right">Base (Centavos)</th>
                  <th className="py-2 px-3 text-right">Tax (Centavos)</th>
                  <th className="py-2 px-3 text-center">Lifecycle Status</th>
                  <th className="py-2 px-3 text-right">Workflow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {offlineDrafts.map(d => (
                  <tr key={d.id}>
                    <td className="py-2.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">{d.id}</td>
                    <td className="py-2.5 px-3 font-mono">{d.exporterType}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-100">{d.counterpartyName}</td>
                    <td className="py-2.5 px-3 font-mono">{d.tin}</td>
                    <td className="py-2.5 px-3 font-mono">{d.transactionDate}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatCentavos(d.taxBaseCentavos)} ({d.taxBaseCentavos}c)</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">{formatCentavos(d.taxAmountCentavos)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700">
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1">
                      {d.status === 'DRAFT' && (
                        <button
                          onClick={() => handleDraftStatusChange(d.id, 'SUBMITTED')}
                          className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold"
                        >
                          Submit
                        </button>
                      )}
                      {d.status === 'SUBMITTED' && (
                        <>
                          <button
                            onClick={() => handleDraftStatusChange(d.id, 'APPROVED')}
                            className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleDraftStatusChange(d.id, 'RETURNED')}
                            className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] font-bold"
                          >
                            Return
                          </button>
                        </>
                      )}
                      {d.status === 'RETURNED' && (
                        <button
                          onClick={() => handleDraftStatusChange(d.id, 'SUBMITTED')}
                          className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold"
                        >
                          Resubmit
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveDraft(d.id)}
                        className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                        title="Remove offline draft"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Authoritative Schedule Table for Active Exporter */}
      <TableFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={`Search within ${activeExporter.replace('_', '/')} schedule...`}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        datePeriod={datePeriod}
        onDatePeriodChange={setDatePeriod}
        fromDate={customFromDate}
        toDate={customToDate}
        onDateRangeChange={(range) => {
          setDatePeriod('CUSTOM');
          setCustomFromDate(range.fromDate);
          setCustomToDate(range.toDate);
        }}
        pageSize={schedulePageSize}
        onPageSizeChange={(newSize) => {
          setSchedulePageSize(newSize);
          setSchedulePageIndex(0);
        }}
        totalCount={activeScheduleRows.length}
        filteredCount={filteredScheduleRows.length}
        onResetFilters={handleResetFilters}
      />

      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm shadow-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" /> Loading Ledger Data Entry schedule...
        </div>
      ) : (
        <TableScrollContainer
          maxHeight="calc(100vh - 360px)"
          minHeight="280px"
          stickyHeader={true}
          title={`Authoritative ${activeExporter.replace('_', '/')} Schedule Rows (${filteredScheduleRows.length})`}
          totalRecordsCount={filteredScheduleRows.length}
          pagination={{
            pageIndex: schedulePageIndex,
            pageSize: schedulePageSize,
            pageSizeOptions: [20, 25, 50, 100],
            totalRecords: filteredScheduleRows.length,
            itemCount: pagedScheduleRows.length,
            onPageChange: setSchedulePageIndex,
            onPageSizeChange: (newSize) => {
              setSchedulePageSize(newSize);
              setSchedulePageIndex(0);
            },
            loading,
          }}
        >
          <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[900px]">
            <thead className="bg-slate-50/80 dark:bg-slate-900/50 text-slate-500 uppercase font-bold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4">Seq</th>
                <th className="py-3 px-4">Counterparty Name</th>
                <th className="py-3 px-4">BIR TIN</th>
                <th className="py-3 px-4">ATC / Ref</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4 text-right">Tax Base (PHP)</th>
                <th className="py-3 px-4 text-right">Tax Amount (PHP)</th>
                <th className="py-3 px-4 text-center">Validation</th>
                <th className="py-3 px-4 text-right">360° Lineage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {pagedScheduleRows.map((row: any, i: number) => {
                const sourceEntityType = activeExporter === 'QAP_MAP' || (activeExporter === 'SLSP' && row.slspType === 'PURCHASES') ? 'PURCHASE_BILL' : 'SALES_INVOICE';
                return (
                  <tr key={row.id || i} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                    <td className="py-3 px-4 font-mono">{row.seq || (schedulePageIndex * schedulePageSize) + i + 1}</td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      {row.vendorName || row.customerName || row.counterpartyName || '-'}
                    </td>
                    <td className="py-3 px-4 font-mono">{row.tin}</td>
                    <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {row.atcCode || row.reference || '-'}
                    </td>
                    <td className="py-3 px-4 font-mono">{row.billDate || row.invoiceDate || row.date || '-'}</td>
                    <td className="py-3 px-4 text-right font-mono">
                      {formatCentavos(row.taxBaseCentavos ?? row.grossCentavos ?? row.totalTaxBaseCentavos ?? 0)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCentavos(row.ewtCentavos ?? row.cwtCentavos ?? row.vatCentavos ?? row.totalEwtCentavos ?? 0)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.tinValid === false || row.dateValid === false ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                          INVALID TIN/DATE
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          VALIDATED
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {row.id && !String(row.id).startsWith('1604E-') && (
                        <button
                          onClick={() => setJourneyTarget({
                            entityType: sourceEntityType,
                            entityId: row.id,
                            title: `${row.reference || row.id} — ${row.vendorName || row.customerName || ''}`
                          })}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold hover:bg-indigo-100 inline-flex items-center gap-1"
                        >
                          <Activity className="w-3 h-3" /> 360° Journey
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {activeScheduleRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No active transactions recorded for {activeExporter} yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScrollContainer>
      )}

      {/* Export Audit History */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-600" />
          Ledger Data Entry Export History ({exportHistory.length})
        </h3>
        {exportHistory.length === 0 ? (
          <p className="text-xs text-slate-400">No BIR DAT exports have been generated yet.</p>
        ) : (
          <div className="space-y-2">
            {exportHistory.slice(0, 8).map((h: any) => (
              <div key={h.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 mr-2">{h.action}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-100">{h.reason}</span>
                </div>
                <div className="font-mono text-slate-500">
                  {h.userDisplayName || 'System'} • {new Date(h.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={fetchLdeData}
        />
      )}
    </div>
  );
}
