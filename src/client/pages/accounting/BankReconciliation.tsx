import React, { useState, useEffect, useMemo } from 'react';
import {
  Landmark, RefreshCw, Plus, CheckCircle2,
  ArrowRightLeft, AlertCircle, ShieldCheck, Search, Activity,
  Eye, X, Check, RotateCcw, FileCheck2, Scale
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import RecordActivityModal from '../../components/RecordActivityModal';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';
import { PaginationControls } from '../../components/PaginationControls';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter } from '../../components/shared/TableFilterToolbar';
import {
  filterEligibleDestinationBankAccounts,
  filterPostableLeafAccounts,
  formatAccountOptionLabel
} from '../../../shared/coaAccountUtils';

const formatPhp = (centavos: number | null | undefined): string => {
  const val = Number(centavos || 0) / 100;
  return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function BankReconciliation() {
  const { activeCompany } = useAuth();
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [bankRegistryAccounts, setBankRegistryAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewReconModal, setShowNewReconModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('ALL');
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  // Active reconciliation workspace drawer/modal
  const [selectedReconId, setSelectedReconId] = useState<string | null>(null);
  const [reconDetail, setReconDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newLine, setNewLine] = useState({
    lineDate: new Date().toISOString().slice(0, 10),
    description: '',
    reference: '',
    type: 'DEPOSIT',
    amountPhp: ''
  });
  const [newAdj, setNewAdj] = useState({
    type: 'BANK_CHARGE',
    amountPhp: '',
    offsetAccountId: '',
    description: 'Monthly bank service charge',
    reference: ''
  });
  const [reopenReason, setReopenReason] = useState('');
  const [showReopenInput, setShowReopenInput] = useState(false);

  const [newRecon, setNewRecon] = useState({
    bankAccountId: '',
    statementDate: new Date().toISOString().slice(0, 10),
    statementEndingBalancePhp: '19720000.00',
    notes: 'Monthly Corporate Bank Statement Reconciliation'
  });

  const cashAccounts = useMemo(
    () => filterEligibleDestinationBankAccounts(accounts, bankRegistryAccounts),
    [accounts, bankRegistryAccounts]
  );
  const postableAccounts = useMemo(() => filterPostableLeafAccounts(accounts), [accounts]);

  const fetchAccounts = async () => {
    try {
      const [res, bankRes] = await Promise.all([
        fetch('/api/master-data/accounts?raw=true'),
        fetch('/api/banking/accounts')
      ]);
      const data = res.ok ? await res.json() : [];
      const list = Array.isArray(data) ? data : data?.data || [];
      const bankRaw = bankRes.ok ? await bankRes.json() : [];
      const bankList = Array.isArray(bankRaw) ? bankRaw : bankRaw?.accounts || bankRaw?.data || [];
      setAccounts(list);
      setBankRegistryAccounts(bankList);
      const eligibleBank = filterEligibleDestinationBankAccounts(list, bankList);
      const defaultBank = eligibleBank[0];
      if (defaultBank) {
        setNewRecon((prev) => ({ ...prev, bankAccountId: prev.bankAccountId || defaultBank.id }));
      }
    } catch (err) {
      console.error('Failed to load accounts', err);
    }
  };

  const fetchReconciliations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accounting/bank-reconciliations');
      if (res.ok) {
        const data = await res.json();
        setReconciliations(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load bank reconciliations', err);
    } finally {
      setLoading(false);
    }
  };

  const openReconDetail = async (id: string) => {
    setSelectedReconId(id);
    setDetailLoading(true);
    setShowReopenInput(false);
    try {
      const res = await fetch(`/api/accounting/bank-reconciliations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setReconDetail(data);
      }
    } catch (err) {
      console.error('Failed to load reconciliation summary', err);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchReconciliations();
    const handleCoaUpdated = () => fetchAccounts();
    window.addEventListener('coa:updated', handleCoaUpdated);
    return () => window.removeEventListener('coa:updated', handleCoaUpdated);
  }, [activeCompany?.id]);

  const handleCreateRecon = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const centavos = Math.round((parseFloat(newRecon.statementEndingBalancePhp) || 0) * 100);
    try {
      const res = await fetch('/api/accounting/bank-reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId: newRecon.bankAccountId,
          statementDate: newRecon.statementDate,
          statementEndingBalance: centavos,
          notes: newRecon.notes
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewReconModal(false);
        setBanner({ type: 'success', message: 'Bank reconciliation session created and linked to General Ledger.' });
        await fetchReconciliations();
        if (data?.id) {
          openReconDetail(data.id);
        }
      } else {
        setError(data.message || data.error || 'Failed to start bank reconciliation');
      }
    } catch (err: any) {
      setError(err.message || 'Error starting bank reconciliation');
    }
  };

  const handleAutoMatch = async (reconId: string) => {
    try {
      const res = await fetch(`/api/accounting/bank-reconciliations/${reconId}/auto-match`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          message: `Auto-matching completed for reconciliation (${reconId}). GL cash vouchers, checks, and deposits reconciled.`
        });
        await fetchReconciliations();
        if (selectedReconId === reconId) {
          setReconDetail(data);
        }
      } else {
        setBanner({ type: 'error', message: data.message || data.error || 'Auto-match failed' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Auto-match request failed' });
    }
  };

  const handleAddStatementLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReconId) return;
    const amountCentavos = Math.round((parseFloat(newLine.amountPhp) || 0) * 100);
    if (amountCentavos <= 0) return;
    try {
      const res = await fetch(`/api/accounting/bank-reconciliations/${selectedReconId}/statement-line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineDate: newLine.lineDate,
          description: newLine.description,
          reference: newLine.reference,
          type: newLine.type,
          amount: amountCentavos
        })
      });
      const data = await res.json();
      if (res.ok) {
        setNewLine({
          lineDate: reconDetail?.reconciliation?.statementDate || new Date().toISOString().slice(0, 10),
          description: '',
          reference: '',
          type: 'DEPOSIT',
          amountPhp: ''
        });
        setReconDetail(data);
        await fetchReconciliations();
        setBanner({ type: 'success', message: 'Statement line added and reconciliation metrics recalculated.' });
      } else {
        setBanner({ type: 'error', message: data.message || 'Failed to add statement line' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Error adding statement line' });
    }
  };

  const handleToggleLineMatch = async (line: any) => {
    if (!selectedReconId) return;
    const nextStatus = line.matchedStatus === 'MATCHED' ? 'UNMATCHED' : 'MATCHED';
    try {
      const res = await fetch(`/api/accounting/bank-reconciliations/${selectedReconId}/match-line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: line.id,
          matchedStatus: nextStatus,
          matchedType: nextStatus === 'MATCHED' ? 'MANUAL_VERIFIED' : undefined,
          matchedEntityId: nextStatus === 'MATCHED' ? selectedReconId : undefined,
          matchedAmount: nextStatus === 'MATCHED' ? line.amount : undefined
        })
      });
      const data = await res.json();
      if (res.ok) {
        setReconDetail(data);
        await fetchReconciliations();
      } else {
        setBanner({ type: 'error', message: data.message || 'Failed to update line match status' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Error updating line match status' });
    }
  };

  const handleAddAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReconId) return;
    const amountCentavos = Math.round((parseFloat(newAdj.amountPhp) || 0) * 100);
    if (amountCentavos <= 0 || !newAdj.offsetAccountId) return;
    try {
      const res = await fetch(`/api/accounting/bank-reconciliations/${selectedReconId}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newAdj.type,
          amount: amountCentavos,
          offsetAccountId: newAdj.offsetAccountId,
          description: newAdj.description,
          reference: newAdj.reference,
          adjustmentDate: reconDetail?.reconciliation?.statementDate
        })
      });
      const data = await res.json();
      if (res.ok) {
        setNewAdj({ ...newAdj, amountPhp: '', reference: '' });
        setReconDetail(data);
        await fetchReconciliations();
        setBanner({ type: 'success', message: 'Book adjustment recorded.' });
      } else {
        setBanner({ type: 'error', message: data.message || 'Failed to add adjustment' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Error adding adjustment' });
    }
  };

  const handleWorkflowAction = async (action: 'submit' | 'approve' | 'reopen') => {
    if (!selectedReconId) return;
    try {
      const bodyPayload =
        action === 'reopen'
          ? { reason: reopenReason || 'Reopened for statement adjustment review' }
          : {};
      const res = await fetch(`/api/accounting/bank-reconciliations/${selectedReconId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          message: data.message || `Bank reconciliation ${action} completed.`
        });
        await openReconDetail(selectedReconId);
        await fetchReconciliations();
      } else {
        setBanner({ type: 'error', message: data.message || data.error || `Failed to ${action} reconciliation` });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || `Failed to ${action} reconciliation` });
    }
  };

  const resolveAccountLabel = (r: any) => {
    if (r?.accountCode && r?.accountName) {
      return `${r.accountCode} — ${r.accountName}`;
    }
    const found = accounts.find((a) => a.id === r?.bankAccountId);
    if (found) {
      return `${found.accountCode} — ${found.accountName}`;
    }
    return r?.bankAccountId || 'Unlinked Bank Account';
  };

  const bankAccountDropdownOptions = useMemo(() => {
    return (accounts || [])
      .filter((a: any) => ['ASSET', 'BANK', 'CASH'].includes((a.accountType || '').toUpperCase()) || ['1010', '1020'].includes(a.accountCode))
      .map((a: any) => ({
        value: a.id,
        label: `${a.accountCode} - ${a.accountName}`
      }));
  }, [accounts]);

  const safeRecons = Array.isArray(reconciliations) ? reconciliations : [];
  const filteredRecons = safeRecons
    .filter((r) => {
      if (selectedBankAccountId && selectedBankAccountId !== 'ALL' && r.bankAccountId !== selectedBankAccountId) {
        return false;
      }
      const stmtDate = (r?.statementDate || '').slice(0, 10);
      if (fromDate && stmtDate && stmtDate < fromDate) return false;
      if (toDate && stmtDate && stmtDate > toDate) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const accLabel = resolveAccountLabel(r).toLowerCase();
      const status = (r?.status || '').toLowerCase();
      const notes = (r?.notes || '').toLowerCase();
      const dateStr = (r?.statementDate || '').toLowerCase();
      return accLabel.includes(q) || status.includes(q) || notes.includes(q) || dateStr.includes(q);
    })
    .sort((a, b) => {
      const tA = new Date(a.statementDate || 0).getTime();
      const tB = new Date(b.statementDate || 0).getTime();
      return sortOrder === 'DESC' ? tB - tA : tA - tB;
    });

  const paginatedRecons = filteredRecons.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const latestRecon = safeRecons[0] || null;

  const exportData: ExportData = {
    filename: `Bank_Reconciliations_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Bank Reconciliation Statements Log',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | GL vs Bank Statement Proof`,
    companyName: activeCompany?.legalName || 'Deskguard Solutions Inc.',
    headers: [
      'Bank Account',
      'Statement Date',
      'GL Book Balance',
      'Statement Ending Balance',
      'Deposits in Transit (+)',
      'Outstanding Checks (-)',
      'Adjusted Balance',
      'Variance',
      'Status'
    ],
    rows: safeRecons.map((r) => [
      resolveAccountLabel(r),
      r?.statementDate || '-',
      formatPhp(r?.bookEndingBalance),
      formatPhp(r?.statementEndingBalance),
      formatPhp(r?.depositsInTransitAmount),
      formatPhp(r?.outstandingChecksAmount),
      formatPhp(r?.adjustedStatementBalance),
      formatPhp(r?.unexplainedDifference),
      r?.status || 'DRAFT'
    ])
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Bank Reconciliation (Statement Upload & GL Matching)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Authoritative General Ledger cash control account reconciliation, deposits in transit (+), outstanding checks (-), and audit-locked statement proof.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <ModuleArchiveInbox
            entityTypes={['BANK_RECONCILIATION', 'BANK_ACCOUNT']}
            moduleTitle="Bank Reconciliation & Accounts"
            description="Archived bank statement reconciliations and bank accounts with 30-day retention and state-preserving restore."
            onRestored={fetchReconciliations}
          />
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setShowNewReconModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Start Bank Reconciliation
          </button>
        </div>
      </div>

      {/* Inline Status Banner */}
      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : banner.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {banner.message}
          </span>
          <button onClick={() => setBanner(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Reconciliation Summary Cards (Reconciled with Dashboard Cash Position) */}
      {latestRecon && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">GL Cash Book Balance</div>
            <div className="text-lg font-mono font-black text-slate-900 dark:text-white mt-1">
              {formatPhp(latestRecon.bookEndingBalance)}
            </div>
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Reconciled 1:1 with Dashboard Cash Position
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Latest Statement Balance</div>
            <div className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 mt-1">
              {formatPhp(latestRecon.statementEndingBalance)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Cut-off Date: {latestRecon.statementDate}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Net Timing Items (DIT - OC)</div>
            <div className="text-sm font-mono font-bold text-slate-800 dark:text-slate-200 mt-1">
              +{formatPhp(latestRecon.depositsInTransitAmount)} / -{formatPhp(latestRecon.outstandingChecksAmount)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {latestRecon.depositsInTransitCount || 0} Deposits in Transit • {latestRecon.outstandingChecksCount || 0} Unpresented Checks
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Adjusted Bank vs Book Variance</div>
            <div className={`text-lg font-mono font-black mt-1 ${
              (latestRecon.unexplainedDifference || 0) === 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}>
              {formatPhp(latestRecon.unexplainedDifference)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Adjusted Balance: {formatPhp(latestRecon.adjustedStatementBalance)}
            </div>
          </div>
        </div>
      )}

      {/* Unified Filter, Sort, Bank Account & Search Toolbar */}
      <TableFilterToolbar
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => {
          setSortOrder(ord);
          setPageIndex(0);
        }}
        datePeriod={datePeriod}
        onDatePeriodChange={(p) => {
          setDatePeriod(p);
          setPageIndex(0);
        }}
        fromDate={fromDate}
        toDate={toDate}
        onDateRangeChange={({ fromDate: f, toDate: t }) => {
          setFromDate(f);
          setToDate(t);
          setPageIndex(0);
        }}
        entityLabel="Bank"
        selectedEntityId={selectedBankAccountId}
        entityOptions={bankAccountDropdownOptions}
        onEntityChange={(aId) => {
          setSelectedBankAccountId(aId);
          setPageIndex(0);
        }}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPageIndex(0);
        }}
        searchPlaceholder="Search account code/name, statement date, status, notes..."
        filteredCount={filteredRecons.length}
        pageSize={pageSize}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setPageIndex(0);
        }}
        onResetFilters={() => {
          setSortOrder('DESC');
          setDatePeriod('ALL');
          setFromDate('');
          setToDate('');
          setSelectedBankAccountId('ALL');
          setSearchQuery('');
          setPageIndex(0);
        }}
      />

      {/* Reconciliations Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading bank reconciliations...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-3 whitespace-nowrap">Bank Account</th>
                    <th className="py-3 px-2 whitespace-nowrap">Date</th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">GL Book Balance</th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">Statement Balance</th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">DIT (+)</th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">Outst. Checks (-)</th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">Adjusted Balance</th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">Variance</th>
                    <th className="py-3 px-2 text-center whitespace-nowrap">Lines</th>
                    <th className="py-3 px-2 text-center whitespace-nowrap">Status</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {paginatedRecons.map((r) => {
                    const variance = Number(r.unexplainedDifference || 0);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-xs text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Landmark className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <div>
                              <div className="whitespace-nowrap">{resolveAccountLabel(r)}</div>
                              <div className="text-[10px] font-mono text-slate-400">{r.bankAccountId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {r.statementDate || '-'}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          {formatPhp(r.bookEndingBalance)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                          {formatPhp(r.statementEndingBalance)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatPhp(r.depositsInTransitAmount)}
                          <span className="block text-[10px] text-slate-400">({r.depositsInTransitCount || 0} items)</span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs text-amber-700 dark:text-amber-400 whitespace-nowrap">
                          {formatPhp(r.outstandingChecksAmount)}
                          <span className="block text-[10px] text-slate-400">({r.outstandingChecksCount || 0} checks)</span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {formatPhp(r.adjustedStatementBalance)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs font-bold whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] ${
                              variance === 0
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                            }`}
                          >
                            {formatPhp(variance)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center text-xs font-mono whitespace-nowrap">
                          <span className="text-slate-700 dark:text-slate-300 font-semibold">
                            {r.matchedLinesCount || 0}/{r.totalLinesCount || 0}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              r.status === 'APPROVED' || r.status === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : r.status === 'SUBMITTED'
                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {r.status || 'DRAFT'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openReconDetail(r.id)}
                              className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold rounded-lg hover:bg-slate-200 inline-flex items-center gap-1 transition-colors"
                            >
                              <Eye className="w-3 h-3" /> Inspect
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setJourneyTarget({
                                  entityType: 'BANK_RECONCILIATION',
                                  entityId: r.id,
                                  title: `Bank Reconciliation — ${resolveAccountLabel(r)} (${r.statementDate || 'Statement'})`
                                })
                              }
                              className="px-2 py-1 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1 transition-colors"
                            >
                              <Activity className="w-3 h-3" /> 360°
                            </button>
                            {r.status !== 'APPROVED' && r.status !== 'COMPLETED' && (
                              <button
                                type="button"
                                onClick={() => {
                                  if ((r.totalLinesCount || 0) === 0 || (r.matchedLinesCount || 0) >= (r.totalLinesCount || 0)) {
                                    openReconDetail(r.id);
                                  } else {
                                    handleAutoMatch(r.id);
                                  }
                                }}
                                className="px-2 py-1 bg-indigo-600 text-white text-[11px] font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                                title={(r.totalLinesCount || 0) === 0 ? 'Open worksheet to import/add statement lines and match' : 'Run auto-match or review matched lines & approve'}
                              >
                                {(r.totalLinesCount || 0) > 0 && (r.matchedLinesCount || 0) >= (r.totalLinesCount || 0) ? 'Review & Finalize' : 'Match'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {paginatedRecons.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-400">
                        No matching bank reconciliations found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalCount={filteredRecons.length}
              itemCount={paginatedRecons.length}
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(pageIndex + 1) * pageSize < filteredRecons.length}
              onNextPage={() => setPageIndex((p) => p + 1)}
              onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredRecons.length / pageSize) - 1))}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPageIndex(0);
              }}
              loading={loading}
            />
          </>
        )}
      </div>

      {/* Interactive Reconciliation Detail & Matching Modal */}
      {selectedReconId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Scale className="w-5 h-5 text-indigo-600" />
                  Bank Statement vs General Ledger Proof Worksheet
                </h3>
                {reconDetail?.reconciliation && (
                  <p className="text-xs text-slate-500 mt-1">
                    Account: <strong>{reconDetail.account ? `${reconDetail.account.accountCode} — ${reconDetail.account.accountName}` : reconDetail.reconciliation.bankAccountId}</strong> | Statement Date: <strong>{reconDetail.reconciliation.statementDate}</strong> | Status: <strong>{reconDetail.reconciliation.status}</strong>
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectedReconId(null);
                  setReconDetail(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading || !reconDetail?.reconciliation ? (
              <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" /> Loading reconciliation worksheet...
              </div>
            ) : (
              <>
                {/* Two-Column Bank vs Book Formula Proof */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                  <div className="space-y-2">
                    <div className="font-bold uppercase text-slate-500 tracking-wider">Bank Statement Side</div>
                    <div className="flex justify-between">
                      <span>Unadjusted Bank Statement Ending Balance:</span>
                      <span className="font-mono font-bold">{formatPhp(reconDetail.reconciliation.statementEndingBalance)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                      <span>(+) Deposits in Transit ({reconDetail.reconciliation.depositsInTransitCount || 0}):</span>
                      <span className="font-mono">+{formatPhp(reconDetail.reconciliation.depositsInTransitAmount)}</span>
                    </div>
                    <div className="flex justify-between text-amber-700 dark:text-amber-400">
                      <span>(-) Outstanding Checks ({reconDetail.reconciliation.outstandingChecksCount || 0}):</span>
                      <span className="font-mono">-{formatPhp(reconDetail.reconciliation.outstandingChecksAmount)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 font-bold text-slate-900 dark:text-white">
                      <span>Adjusted Bank Balance:</span>
                      <span className="font-mono">{formatPhp(reconDetail.reconciliation.adjustedStatementBalance)}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="font-bold uppercase text-slate-500 tracking-wider">General Ledger Book Side</div>
                    <div className="flex justify-between">
                      <span>GL Control Account Balance (As of {reconDetail.reconciliation.statementDate}):</span>
                      <span className="font-mono font-bold">{formatPhp(reconDetail.reconciliation.bookEndingBalance)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>(+/-) Unposted Book Adjustments ({(reconDetail.adjustments || []).length}):</span>
                      <span className="font-mono">
                        {formatPhp((reconDetail.reconciliation.adjustedBookBalance || 0) - (reconDetail.reconciliation.bookEndingBalance || 0))}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 font-bold text-slate-900 dark:text-white">
                      <span>Adjusted GL Book Balance:</span>
                      <span className="font-mono">{formatPhp(reconDetail.reconciliation.adjustedBookBalance)}</span>
                    </div>
                    <div className="flex justify-between pt-1 font-bold">
                      <span>Unexplained Variance (Adjusted Book - Adjusted Bank):</span>
                      <span className={`font-mono ${reconDetail.reconciliation.unexplainedDifference === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatPhp(reconDetail.reconciliation.unexplainedDifference)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Statement Lines Table */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Bank Statement Lines ({(reconDetail.statementLines || []).length})
                    </h4>
                    {reconDetail.reconciliation.status !== 'APPROVED' && reconDetail.reconciliation.status !== 'COMPLETED' && (
                      <button
                        type="button"
                        onClick={() => handleAutoMatch(selectedReconId)}
                        className="px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700"
                      >
                        Run Auto-Match Engine
                      </button>
                    )}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Reference</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3 text-center">Match Status</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {(reconDetail.statementLines || []).map((line: any) => (
                          <tr key={line.id}>
                            <td className="py-2 px-3 font-mono">{line.lineDate}</td>
                            <td className="py-2 px-3 font-mono">{line.reference || '-'}</td>
                            <td className="py-2 px-3">{line.description}</td>
                            <td className="py-2 px-3 font-semibold">{line.type}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold">{formatPhp(line.amount)}</td>
                            <td className="py-2 px-3 text-center">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  line.matchedStatus === 'MATCHED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {line.matchedStatus}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              {reconDetail.reconciliation.status !== 'APPROVED' &&
                                reconDetail.reconciliation.status !== 'COMPLETED' && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLineMatch(line)}
                                    className="px-2 py-1 text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 rounded hover:bg-slate-200"
                                  >
                                    {line.matchedStatus === 'MATCHED' ? 'Unmatch' : 'Mark Matched'}
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                        {(reconDetail.statementLines || []).length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-slate-400">
                              No bank statement lines recorded yet. Add a statement line below to provide reconciliation evidence.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Statement Line Form (if editable) */}
                  {reconDetail.reconciliation.status !== 'APPROVED' && reconDetail.reconciliation.status !== 'COMPLETED' && (
                    <form onSubmit={handleAddStatementLine} className="grid grid-cols-1 sm:grid-cols-6 gap-2 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                      <input
                        type="date"
                        required
                        value={newLine.lineDate}
                        onChange={(e) => setNewLine({ ...newLine, lineDate: e.target.value })}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      />
                      <input
                        type="text"
                        placeholder="Ref # (e.g. BPI-STMT)"
                        value={newLine.reference}
                        onChange={(e) => setNewLine({ ...newLine, reference: e.target.value })}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      />
                      <input
                        type="text"
                        required
                        placeholder="Statement line description"
                        value={newLine.description}
                        onChange={(e) => setNewLine({ ...newLine, description: e.target.value })}
                        className="sm:col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      />
                      <input
                        type="number"
                        step="0.01"
                        required
                        placeholder="Amount (PHP)"
                        value={newLine.amountPhp}
                        onChange={(e) => setNewLine({ ...newLine, amountPhp: e.target.value })}
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700"
                      >
                        + Add Line
                      </button>
                    </form>
                  )}
                </div>

                {/* Book Adjustments Section (Bank Service Charges, Interest Income, NSF) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Book Adjustments ({(reconDetail.adjustments || []).length}) — Auto-Posted to GL upon Approval
                    </h4>
                  </div>

                  {(reconDetail.adjustments || []).length > 0 && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 uppercase">
                          <tr>
                            <th className="py-2 px-3">Date</th>
                            <th className="py-2 px-3">Adjustment Type</th>
                            <th className="py-2 px-3">Description</th>
                            <th className="py-2 px-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                          {(reconDetail.adjustments || []).map((adj: any) => (
                            <tr key={adj.id}>
                              <td className="py-2 px-3 font-mono">{adj.adjustmentDate}</td>
                              <td className="py-2 px-3 font-semibold">{adj.type}</td>
                              <td className="py-2 px-3">{adj.description}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold">
                                {formatPhp(adj.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {reconDetail.reconciliation.status !== 'APPROVED' && reconDetail.reconciliation.status !== 'COMPLETED' && (
                    <form onSubmit={handleAddAdjustment} className="grid grid-cols-1 sm:grid-cols-6 gap-2 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                      <select
                        value={newAdj.type}
                        onChange={(e) => setNewAdj({ ...newAdj, type: e.target.value })}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      >
                        <option value="BANK_CHARGE">Bank Service Charge (-)</option>
                        <option value="INTEREST_INCOME">Interest Income (+)</option>
                        <option value="OTHER_ADJUSTMENT">Other Book Adjustment</option>
                      </select>
                      <select
                        required
                        value={newAdj.offsetAccountId}
                        onChange={(e) => setNewAdj({ ...newAdj, offsetAccountId: e.target.value })}
                        className="sm:col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      >
                        <option value="">Select Offset GL Account...</option>
                        {postableAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountCode} — {a.accountName} ({a.accountType})
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        placeholder="Adjustment description"
                        value={newAdj.description}
                        onChange={(e) => setNewAdj({ ...newAdj, description: e.target.value })}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      />
                      <input
                        type="number"
                        step="0.01"
                        required
                        placeholder="Amount (PHP)"
                        value={newAdj.amountPhp}
                        onChange={(e) => setNewAdj({ ...newAdj, amountPhp: e.target.value })}
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-900"
                      >
                        + Add Adj
                      </button>
                    </form>
                  )}
                </div>

                {/* Workflow Footer Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                  <div className="text-xs text-slate-500">
                    {reconDetail.reconciliation.notes}
                  </div>
                  <div className="flex items-center gap-2">
                    {(reconDetail.reconciliation.status === 'DRAFT' || reconDetail.reconciliation.status === 'REOPENED') && (
                      <button
                        type="button"
                        onClick={() => handleWorkflowAction('submit')}
                        className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 flex items-center gap-1.5"
                      >
                        <FileCheck2 className="w-4 h-4" /> Submit for Approval
                      </button>
                    )}
                    {reconDetail.reconciliation.status === 'SUBMITTED' && (
                      <button
                        type="button"
                        onClick={() => handleWorkflowAction('approve')}
                        className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 flex items-center gap-1.5"
                      >
                        <Check className="w-4 h-4" /> Approve & Lock Reconciliation
                      </button>
                    )}
                    {(reconDetail.reconciliation.status === 'APPROVED' ||
                      reconDetail.reconciliation.status === 'COMPLETED' ||
                      reconDetail.reconciliation.status === 'SUBMITTED') && (
                      <>
                        {showReopenInput ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="Reason for reopening..."
                              value={reopenReason}
                              onChange={(e) => setReopenReason(e.target.value)}
                              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={() => handleWorkflowAction('reopen')}
                              className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700"
                            >
                              Confirm Reopen
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowReopenInput(true)}
                            className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold rounded-xl hover:bg-amber-100 flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Reopen
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Start Recon Modal */}
      {showNewReconModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Landmark className="w-5 h-5 text-indigo-600" /> Start Bank Reconciliation
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateRecon} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  GL Cash / Bank Account
                </label>
                <select
                  required
                  value={newRecon.bankAccountId}
                  onChange={(e) => setNewRecon({ ...newRecon, bankAccountId: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select GL Cash/Bank Account...</option>
                  {cashAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountCode} — {acc.accountName} ({acc.currency || 'PHP'})
                    </option>
                  ))}
                </select>
                {cashAccounts.length === 0 && (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                    No eligible Cash/Bank accounts found. Configure a Cash/Bank account in Chart of Accounts or Bank Account Management.{' '}
                    <a href="/accounting/accounts" className="font-bold underline hover:text-amber-950 dark:hover:text-white">
                      Go to Chart of Accounts &rarr;
                    </a>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Statement Date
                  </label>
                  <input
                    type="date"
                    required
                    value={newRecon.statementDate}
                    onChange={(e) => setNewRecon({ ...newRecon, statementDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Statement Ending Balance (PHP)
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    value={newRecon.statementEndingBalancePhp}
                    onChange={(e) => setNewRecon({ ...newRecon, statementEndingBalancePhp: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Notes / Remarks
                </label>
                <input
                  type="text"
                  value={newRecon.notes}
                  onChange={(e) => setNewRecon({ ...newRecon, notes: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewReconModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Start Reconciliation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enterprise 360° Record Journey Modal */}
      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={() => fetchReconciliations()}
        />
      )}
    </div>
  );
}
