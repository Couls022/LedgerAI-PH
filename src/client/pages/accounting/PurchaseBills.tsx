import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ShoppingCart, Plus, RefreshCw, CheckCircle2, AlertCircle, 
  Clock, Users, Search, Edit3, ShieldCheck, Activity,
  Truck, ArrowUpRight, Filter, FileText, Check, Layers, AlertTriangle, Link2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import ExportButton, { ExportData } from '../../components/ExportButton';
import VendorModal from '../../components/VendorModal';
import RecordActivityModal from '../../components/RecordActivityModal';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';
import TableRecencyFilterBadge from '../../components/shared/TableRecencyFilterBadge';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter } from '../../components/shared/TableFilterToolbar';
import { getRecentOneMonthRange } from '../../utils/dateFilterUtils';
import { TableScrollContainer, TableDensity } from '../../components/shared/TableScrollContainer';
import { PaginationControls } from '../../components/PaginationControls';
import { filterEligibleExpenseAndPurchaseAccounts, formatAccountOptionLabel } from '../../../shared/coaAccountUtils';

function formatCurrency(centavos: number | undefined | null): string {
  if (centavos === undefined || centavos === null) return '₱0.00';
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || 'DRAFT').toUpperCase();
  const styles: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300',
    SUBMITTED: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200',
    RETURNED: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200',
    REJECTED: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200',
    APPROVED: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200',
    POSTED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200',
    PARTIAL: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200',
    PARTIALLY_PAID: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200',
    PAID: 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200',
    CANCELLED: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200',
    REVERSED: 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200'
  };
  const label = s === 'PARTIALLY_PAID' ? 'PARTIAL' : (s === 'REJECTED' ? 'RETURNED' : s);
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${styles[s] || styles.DRAFT}`}>
      {label}
    </span>
  );
}

export default function PurchaseBills() {
  const { activeCompany, canCreate, userRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bills, setBills] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; billNumber: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'PO_LINKED' | 'DIRECT'>(() => {
    const s = String(searchParams.get('source') || 'ALL').toUpperCase();
    return s === 'PO_LINKED' || s === 'DIRECT' ? s : 'ALL';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [pendingPayBillId, setPendingPayBillId] = useState<string | null>(() => searchParams.get('payBillId'));
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  // Pay Supplier / Disbursement Voucher Modal State
  const [payTargetBill, setPayTargetBill] = useState<any | null>(null);
  const [disbursementData, setDisbursementData] = useState({
    paymentNumber: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    cashAccountId: '',
    paymentMethod: 'BANK_TRANSFER',
    atcCode: 'WC158', // Official BIR RR 11-2018 ATC: WC158 1% Goods
    atcRatePercent: 1,
    settlementAmountPhp: '',
    withholdingTaxAccountId: '',
    reference: '',
    notes: ''
  });
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Pagination & Density State (Default 20 per page)
  const [pageSize, setPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('ALL');
  const [dateFilterMode, setDateFilterMode] = useState<'RECENT_1_MONTH' | 'ALL'>('ALL');
  const [density, setDensity] = useState<TableDensity>('comfortable');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);
  const [serverSummary, setServerSummary] = useState<{
    totalApOutstanding: number;
    postedApBalance?: number;
    partialApBalance?: number;
    totalGrossBilledOpenAp?: number;
    settledOnOpenAp?: number;
    overduePayables: number;
    overdueBillsCount?: number;
    currentNotDueAp?: number;
    currentNotDueCount?: number;
    activeBillsCount: number;
    poLinkedBillsCount?: number;
    directBillsCount?: number;
    poLinkedOpenAp?: number;
    directBillsOpenAp?: number;
    totalPoCount?: number;
    draftUnpostedPotentialAp?: number;
    unpostedApprovedCount?: number;
    unpostedApprovedCentavos?: number;
    glApBalance?: number;
    glSubledgerVariance?: number;
    isGlReconciled?: boolean;
    asOfDate?: string;
    statusCounts: Record<string, number>;
  } | null>(null);

  const [newBill, setNewBill] = useState({
    vendorId: '',
    expenseAccountId: '',
    billNumber: `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`,
    billDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    totalAmount: 11200,
    reference: '',
    notes: 'Purchase of goods/services'
  });

  const postableExpenseAccounts = useMemo(() => {
    return filterEligibleExpenseAndPurchaseAccounts(coaAccounts);
  }, [coaAccounts]);

  const cashAndBankAccounts = useMemo(() => {
    return (coaAccounts || []).filter(a => 
      ['ASSET', 'BANK', 'CASH'].includes((a.accountType || '').toUpperCase()) ||
      ['1010', '1020'].includes(a.accountCode)
    );
  }, [coaAccounts]);

  const fetchData = async (cursor?: string | null, customLimit?: number) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const activeLimit = customLimit || pageSize;
      const params = new URLSearchParams();
      params.set('limit', String(activeLimit));
      params.set('order', sortOrder);
      if (activeCurr) params.set('cursor', activeCurr);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (sourceFilter && sourceFilter !== 'ALL') params.set('source', sourceFilter);
      if (fromDate) {
        params.set('fromDate', fromDate);
      } else if (dateFilterMode === 'RECENT_1_MONTH') {
        const range = getRecentOneMonthRange();
        params.set('fromDate', range.fromDate);
      }
      if (toDate) {
        params.set('toDate', toDate);
      }

      const [billsData, vData, aData] = await Promise.all([
        apiFetch<any>(`/api/accounting/purchase-bills?${params.toString()}`),
        apiFetch<any>('/api/master-data/vendors'),
        apiFetch<any>('/api/master-data/accounts?raw=true')
      ]);

      if (Array.isArray(billsData)) {
        setBills(billsData);
        setPaginationMeta(null);
        setServerSummary(null);
      } else {
        setBills(billsData.items || billsData.data || []);
        setPaginationMeta(billsData.pagination || null);
        setServerSummary(billsData.summary || null);
      }
      setVendors(Array.isArray(vData) ? vData : (vData.data || []));
      setCoaAccounts(Array.isArray(aData) ? aData : (aData.data || []));
    } catch (err: any) {
      console.error('Error loading purchase bills', err);
      setError(err?.message || 'Error loading purchase bills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    fetchData(null);
    const handleCoaUpdated = () => fetchData(null);
    window.addEventListener('coa:updated', handleCoaUpdated);
    return () => window.removeEventListener('coa:updated', handleCoaUpdated);
  }, [activeCompany?.id, searchQuery, statusFilter, sourceFilter, dateFilterMode, sortOrder, fromDate, toDate, pageSize]);

  // Auto-open Disbursement Voucher modal if navigated via "Pay in AP" from Procurement & 3-Way Match
  useEffect(() => {
    if (!pendingPayBillId || loading || bills.length === 0) return;
    const match = bills.find((b) => b.id === pendingPayBillId);
    if (match && Number(match.balanceDue || 0) > 0) {
      openPayModal(match);
      setPendingPayBillId(null);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('payBillId');
      setSearchParams(nextParams, { replace: true });
    }
  }, [pendingPayBillId, loading, bills]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      fetchData(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevStack = [...cursorStack];
      const prevCursor = prevStack.pop() || null;
      setCursorStack(prevStack);
      setCurrentCursor(prevCursor);
      fetchData(prevCursor);
    }
  };

  const handleVendorCreated = (newVendor: any) => {
    setVendors(prev => {
      const idx = prev.findIndex(v => v.id === newVendor.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newVendor;
        return copy;
      }
      return [newVendor, ...prev];
    });
    setNewBill(prev => ({
      ...prev,
      vendorId: newVendor.id
    }));
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const amountCentavos = Math.round(newBill.totalAmount * 100);
      const payload: any = {
        vendorId: newBill.vendorId,
        billNumber: newBill.billNumber,
        billDate: newBill.billDate,
        dueDate: newBill.dueDate,
        reference: newBill.reference,
        notes: newBill.notes,
        totalAmount: amountCentavos,
        lines: newBill.expenseAccountId ? [{
          accountId: newBill.expenseAccountId,
          description: newBill.notes || `Purchase Bill ${newBill.billNumber}`,
          quantity: 1,
          unitPrice: amountCentavos,
          amount: amountCentavos
        }] : []
      };
      await apiFetch<any>('/api/accounting/purchase-bills', {
        method: 'POST',
        body: payload
      });
      setShowCreateModal(false);
      setSuccessMsg(`Purchase bill ${newBill.billNumber} created successfully.`);
      setNewBill({
        vendorId: '',
        expenseAccountId: '',
        billNumber: `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`,
        billDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        totalAmount: 11200,
        reference: '',
        notes: 'Purchase of goods/services'
      });
      fetchData();
    } catch (err: any) {
      setError(err.message || "Error creating bill.");
    }
  };

  const handleBillWorkflow = async (
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'post',
    reason?: string
  ) => {
    setError(null);
    setSuccessMsg(null);
    setProcessingId(id);
    try {
      const data = await apiFetch<any>(`/api/accounting/purchase-bills/${id}/${action}`, {
        method: 'POST',
        body: (reason ? { reason } : {}) as any
      });
      const labels: Record<string, string> = {
        submit: 'submitted for approval',
        approve: 'approved',
        reject: 'returned/rejected',
        post: 'posted to General Ledger'
      };
      setSuccessMsg(data.message || `Purchase bill ${labels[action] || 'updated'} successfully.`);
      if (action === 'reject') {
        setRejectTarget(null);
        setRejectReason('');
      }
      fetchData();
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} purchase bill.`);
    } finally {
      setProcessingId(null);
    }
  };

  // Open Pay Supplier Disbursement Modal
  const openPayModal = (bill: any) => {
    const defaultCashId = cashAndBankAccounts[0]?.id || '';
    const currentBalanceCentavos = bill.balanceDue !== undefined && bill.balanceDue !== null ? bill.balanceDue : (bill.totalAmount || 0);
    const balDuePhp = (currentBalanceCentavos / 100).toFixed(2);
    setPayTargetBill(bill);
    setDisbursementData({
      paymentNumber: `DV-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`,
      paymentDate: new Date().toISOString().slice(0, 10),
      cashAccountId: defaultCashId,
      paymentMethod: 'BANK_TRANSFER',
      atcCode: 'WC158', // Official BIR RR 11-2018 ATC: WC158 1% Goods
      atcRatePercent: 1,
      settlementAmountPhp: balDuePhp,
      withholdingTaxAccountId: '',
      reference: `DV Ref for Bill ${bill.billNumber}`,
      notes: `Supplier disbursement voucher (DV) for Bill #${bill.billNumber}`
    });
    setError(null);
  };

  // Determine whether a bill is subject to 12% VAT (both company & supplier are VAT-registered)
  const isBillVatApplicable = (bill: any): boolean => {
    const companyVat = String(activeCompany?.vatStatus || 'VAT').toUpperCase() === 'VAT';
    if (!companyVat) return false;
    const vendor = vendors.find(v => v.id === bill?.vendorId);
    const vendorTaxClass = String(vendor?.taxClassification || 'VAT').toUpperCase();
    return !vendorTaxClass.includes('NON_VAT') && !vendorTaxClass.includes('EXEMPT');
  };

  // Submit Supplier Disbursement
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTargetBill) return;
    setSubmittingPayment(true);
    setError(null);
    try {
      const currentBalanceCentavos = payTargetBill.balanceDue !== undefined && payTargetBill.balanceDue !== null ? payTargetBill.balanceDue : (payTargetBill.totalAmount || 0);
      const settlementCentavos = Math.round((parseFloat(disbursementData.settlementAmountPhp) || 0) * 100);

      if (settlementCentavos <= 0) {
        setError('Please enter a valid disbursement settlement amount greater than ₱0.00.');
        setSubmittingPayment(false);
        return;
      }

      if (settlementCentavos > currentBalanceCentavos) {
        setError(`Settlement amount (₱${(settlementCentavos/100).toFixed(2)}) exceeds remaining balance due (₱${(currentBalanceCentavos/100).toFixed(2)}).`);
        setSubmittingPayment(false);
        return;
      }

      // Calculate EWT Withholding per BIR RR 2-98 / RR 11-2018 Form 2307 (net of 12% VAT if VAT supplier)
      const rateFrac = (disbursementData.atcRatePercent || 0) / 100;
      const taxBaseCentavos = isBillVatApplicable(payTargetBill)
        ? Math.round((settlementCentavos / 1.12))
        : settlementCentavos;
      const ewtCentavos = Math.round(taxBaseCentavos * rateFrac);
      const netCashCentavos = Math.max(0, settlementCentavos - ewtCentavos);

      await apiFetch<any>(`/api/accounting/purchase-bills/${payTargetBill.id}/pay`, {
        method: 'POST',
        body: {
          paymentNumber: disbursementData.paymentNumber,
          paymentDate: disbursementData.paymentDate,
          amountCentavos: netCashCentavos,
          withholdingTaxAmount: ewtCentavos,
          atcCode: disbursementData.atcCode,
          cashAccountId: disbursementData.cashAccountId,
          paymentMethod: disbursementData.paymentMethod,
          reference: disbursementData.reference,
          notes: disbursementData.notes,
          autoPost: true
        } as any
      });

      const remainingCentavos = Math.max(0, currentBalanceCentavos - settlementCentavos);
      const isFullyPaid = remainingCentavos === 0;
      setPayTargetBill(null);
      setSuccessMsg(
        isFullyPaid
          ? `Disbursement voucher ${disbursementData.paymentNumber} posted! Bill #${payTargetBill.billNumber} is now fully PAID (₱0.00 remaining balance). Net cash: ₱${(netCashCentavos/100).toFixed(2)}, BIR Form 2307 (${disbursementData.atcCode}) EWT: ₱${(ewtCentavos/100).toFixed(2)}.`
          : `Partial disbursement voucher ${disbursementData.paymentNumber} recorded! Remaining balance: ₱${(remainingCentavos/100).toFixed(2)}. Net cash: ₱${(netCashCentavos/100).toFixed(2)}, BIR Form 2307 (${disbursementData.atcCode}) EWT: ₱${(ewtCentavos/100).toFixed(2)}.`
      );
      fetchData();
    } catch (err: any) {
      setError(err?.message || 'Error processing supplier payment.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const vendorDropdownOptions = useMemo(() => {
    return (vendors || []).map((v: any) => ({
      value: v.id,
      label: v.legalName || v.name || v.code || 'Unnamed Vendor'
    }));
  }, [vendors]);

  const safeBills = Array.isArray(bills)
    ? bills.filter(b => {
        const st = (b?.status || 'DRAFT').toUpperCase();
        if (['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes(st)) return false;
        if (selectedVendorId && selectedVendorId !== 'ALL' && b.vendorId !== selectedVendorId) {
          return false;
        }
        return true;
      })
    : [];

  const counts = serverSummary?.statusCounts || {
    ALL: safeBills.length,
    DRAFT: 0,
    SUBMITTED: 0,
    RETURNED: 0,
    APPROVED: 0,
    POSTED: 0,
    PARTIAL: 0,
    PAID: 0,
    CANCELLED: 0,
    REVERSED: 0
  };

  const statusFilterTabs = [
    { key: 'ALL', label: 'ALL', count: counts.ALL },
    { key: 'DRAFT', label: 'DRAFT', count: counts.DRAFT },
    { key: 'SUBMITTED', label: 'SUBMITTED', count: counts.SUBMITTED },
    { key: 'RETURNED', label: 'RETURNED', count: counts.RETURNED },
    { key: 'APPROVED', label: 'APPROVED', count: counts.APPROVED },
    { key: 'POSTED', label: 'POSTED', count: counts.POSTED },
    { key: 'PARTIAL', label: 'PARTIAL', count: counts.PARTIAL },
    { key: 'PAID', label: 'PAID', count: counts.PAID },
    { key: 'CANCELLED', label: 'CANCELLED', count: counts.CANCELLED },
    { key: 'REVERSED', label: 'REVERSED', count: counts.REVERSED },
  ];

  const exportData: ExportData = {
    filename: `Purchase_Bills_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Purchase Bills Register (Accounts Payable)',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Supplier Invoices & Liabilities`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Bill Date', 'Bill Number', 'Vendor Name', 'Vendor TIN', 'Total Amount (PHP)', 'Balance Due (PHP)', 'Status'],
    rows: safeBills.map(b => [
      b?.billDate ? new Date(b.billDate).toLocaleDateString() : '-',
      b?.billNumber || '',
      b?.vendorName || '',
      b?.vendorTin || 'N/A',
      ((b?.totalAmount || 0) / 100).toFixed(2),
      ((b?.balanceDue || 0) / 100).toFixed(2),
      b?.status || 'DRAFT',
    ])
  };

  return (
    <div className="space-y-5">
      {/* Notifications */}
      {successMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:underline">Dismiss</button>
        </div>
      )}

      {error && !showCreateModal && !payTargetBill && (
        <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-rose-600" /> {error}</span>
          <button onClick={() => setError(null)} className="text-rose-600 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3.5 bg-white dark:bg-[#11192B] p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs">
        <div className="min-w-0">
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-sky-400 shrink-0" />
            <span>Purchase Bills (Accounts Payable)</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 leading-relaxed">
            Supplier invoices, 12% Creditable Input VAT, BIR Form 2307 EWT withholding, and Accounts Payable tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/accounting/procurement')}
            className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Procurement &amp; 3-Way Match</span>
            {serverSummary?.totalPoCount !== undefined && (
              <span className="px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                {serverSummary.totalPoCount} PO
              </span>
            )}
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <ModuleArchiveInbox
            entityTypes={['PURCHASE_BILL', 'SUPPLIER_PAYMENT', 'DEBIT_MEMO', 'VENDOR']}
            moduleTitle="Purchase Bills & Accounts Payable"
            description="Archived purchase bills, supplier payments, debit memos, and vendors with 30-day retention."
            onRestored={fetchData}
          />
          <button
            onClick={() => {
              setEditingVendor(null);
              setShowVendorModal(true);
            }}
            className="bg-amber-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-amber-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Truck className="w-4 h-4 shrink-0" /> Create Vendor
          </button>
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" /> New Bill
          </button>
        </div>
      </div>

      {/* Top 3 Authoritative Financial KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: TOTAL AP OUTSTANDING */}
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs card-hover relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total AP Outstanding (All Posted)
            </span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400 flex items-center justify-center w-8 h-8">
              <span className="font-bold text-base leading-none">₱</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
              {formatCurrency(serverSummary ? serverSummary.totalApOutstanding : safeBills.reduce((s, b) => s + (['POSTED', 'PARTIAL'].includes(b.status) ? b.balanceDue : 0), 0))}
            </span>
            {serverSummary && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                serverSummary.isGlReconciled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
              }`}>
                {serverSummary.isGlReconciled
                  ? '✓ GL 2010 Reconciled'
                  : `GL Variance: ${formatCurrency(serverSummary.glSubledgerVariance)}`}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 space-y-1">
            <div>Database sum of unpaid POSTED &amp; PARTIAL bills (GL Account 2010)</div>
            {serverSummary && (serverSummary.poLinkedOpenAp !== undefined || serverSummary.directBillsOpenAp !== undefined) && (
              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <button
                  type="button"
                  onClick={() => setSourceFilter('PO_LINKED')}
                  className="font-mono font-semibold text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
                  title="Filter register to PO 3-Way Matched bills"
                >
                  PO 3-Way AP: {formatCurrency(serverSummary.poLinkedOpenAp)}
                </button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <button
                  type="button"
                  onClick={() => setSourceFilter('DIRECT')}
                  className="font-mono font-semibold text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                  title="Filter register to Direct Non-PO supplier bills"
                >
                  Direct Bills AP: {formatCurrency(serverSummary.directBillsOpenAp)}
                </button>
              </div>
            )}
            {(serverSummary?.unpostedApprovedCount || 0) > 0 && (
              <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                + {serverSummary?.unpostedApprovedCount} Approved bill(s) ({formatCurrency(serverSummary?.unpostedApprovedCentavos)}) pending Post to GL
              </div>
            )}
          </div>
        </div>

        {/* KPI 2: ACTIVE BILLS */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Active Bills
            </span>
            <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded-lg text-slate-600 dark:text-slate-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
            {(serverSummary?.activeBillsCount !== undefined ? serverSummary.activeBillsCount : safeBills.length).toLocaleString()}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 space-y-1">
            <div>
              {((counts.POSTED || 0) + (counts.PARTIAL || 0)).toLocaleString()} Open AP · {(counts.PAID || 0).toLocaleString()} Paid · {(counts.APPROVED || 0).toLocaleString()} Pending GL Post
            </div>
            {serverSummary && serverSummary.poLinkedBillsCount !== undefined && (
              <div className="pt-1 border-t border-slate-100 dark:border-slate-700/70 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {serverSummary.poLinkedBillsCount} PO 3-Way Matched · {serverSummary.directBillsCount ?? 0} Direct Supplier Bills
              </div>
            )}
          </div>
        </div>

        {/* KPI 3: OVERDUE PAYABLES */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              Overdue Payables
            </span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
            {formatCurrency(serverSummary ? serverSummary.overduePayables : 0)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {(serverSummary?.overdueBillsCount ?? 0).toLocaleString()} overdue posted bills · {(serverSummary?.currentNotDueCount ?? 0).toLocaleString()} current ({formatCurrency(serverSummary?.currentNotDueAp ?? 0)})
          </div>
        </div>
      </div>

      {/* Status & Source Origin Filter Controls */}
      <div className="space-y-2.5 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-slate-500 mr-2 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Status Filter:
          </span>
          {statusFilterTabs.map(tab => {
            const isActive = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                  isActive 
                    ? 'bg-indigo-600 text-white shadow-xs' 
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  isActive ? 'bg-indigo-700 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-100 dark:border-slate-700/70">
          <span className="text-xs font-bold text-slate-500 mr-2 flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5" /> Bill Origin:
          </span>
          {[
            { key: 'ALL' as const, label: 'All Sources', count: serverSummary?.activeBillsCount ?? counts.ALL },
            { key: 'PO_LINKED' as const, label: 'PO 3-Way Matched', count: serverSummary?.poLinkedBillsCount ?? 0 },
            { key: 'DIRECT' as const, label: 'Direct Supplier Bills', count: serverSummary?.directBillsCount ?? 0 },
          ].map(src => {
            const isActive = sourceFilter === src.key;
            return (
              <button
                key={src.key}
                type="button"
                onClick={() => setSourceFilter(src.key)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? src.key === 'PO_LINKED'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-slate-900 dark:bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{src.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  isActive ? 'bg-black/20 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300'
                }`}>
                  {src.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rejection Form Banner */}
      {rejectTarget && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!rejectReason.trim()) {
              setError('Please enter a reason to reject or return the purchase bill.');
              return;
            }
            handleBillWorkflow(rejectTarget.id, 'reject', rejectReason.trim());
          }}
          className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        >
          <div className="text-xs font-bold text-amber-900 dark:text-amber-200 shrink-0">
            Reject / Return #{rejectTarget.billNumber}:
          </div>
          <input
            type="text"
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter mandatory rejection / return reason..."
            className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason('');
              }}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={processingId === rejectTarget.id}
              className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {processingId === rejectTarget.id ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </form>
      )}

      {/* Unified Filter, Sort, Vendor & Search Toolbar */}
      <TableFilterToolbar
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => {
          setSortOrder(ord);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        datePeriod={datePeriod}
        onDatePeriodChange={(p) => {
          setDatePeriod(p);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        fromDate={fromDate}
        toDate={toDate}
        onDateRangeChange={({ fromDate: f, toDate: t }) => {
          setFromDate(f);
          setToDate(t);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        entityLabel="Vendor"
        selectedEntityId={selectedVendorId}
        entityOptions={vendorDropdownOptions}
        onEntityChange={(vId) => setSelectedVendorId(vId)}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        searchPlaceholder="Search bill #, vendor name, reference, TIN..."
        filteredCount={safeBills.length}
        totalCount={paginationMeta?.totalCount}
        pageSize={pageSize}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setCursorStack([]);
          setCurrentCursor(null);
        }}
        onResetFilters={() => {
          setSortOrder('DESC');
          setDatePeriod('ALL');
          setDateFilterMode('ALL');
          setFromDate('');
          setToDate('');
          setSelectedVendorId('ALL');
          setSearchQuery('');
          setStatusFilter('ALL');
          setSourceFilter('ALL');
          setCursorStack([]);
          setCurrentCursor(null);
        }}
      />

      {/* Subledger Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Purchase Bills & AP Register</span>
            <span className="text-xs text-slate-400">({paginationMeta ? `${paginationMeta.totalCount} records` : `${safeBills.length} records`})</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Showing 20 items per page</span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching purchase bills...
          </div>
        ) : (
          <TableScrollContainer
            title="Purchase Bills Register"
            totalRecordsCount={paginationMeta?.totalCount || safeBills.length}
            density={density}
            onDensityChange={setDensity}
            footer={
              <PaginationControls
                totalCount={paginationMeta?.totalCount || safeBills.length}
                itemCount={safeBills.length}
                pageIndex={cursorStack.length}
                pageSize={pageSize}
                pageSizeOptions={[20, 50, 100]}
                onPageSizeChange={(newSize) => {
                  setPageSize(newSize);
                  setCursorStack([]);
                  setCurrentCursor(null);
                  fetchData(null, newSize);
                }}
                hasNextPage={Boolean(paginationMeta?.hasNextPage)}
                onNextPage={handleNextPage}
                onPrevPage={handlePrevPage}
              />
            }
          >
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[950px]">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900/90 text-slate-500 uppercase font-semibold border-b border-slate-100 dark:border-slate-700 shadow-xs">
                <tr>
                  <th className="py-3 px-4">Bill Date</th>
                  <th className="py-3 px-4">Bill #</th>
                  <th className="py-3 px-4">Vendor</th>
                  <th className="py-3 px-4 text-right">Total (PHP)</th>
                  <th className="py-3 px-4 text-right">Balance Due</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">360° & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {safeBills.map((b, idx) => {
                  const billDateStr = b?.billDate ? new Date(b.billDate).toLocaleDateString() : '-';
                  const isPostablePayment = ['POSTED', 'PARTIAL', 'PARTIALLY_PAID'].includes(String(b?.status || '').toUpperCase()) && (b?.balanceDue > 0);

                  return (
                    <tr key={b?.id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-medium">
                        {billDateStr}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        <div className="flex flex-col items-start gap-1">
                          <button
                            onClick={() => setJourneyTarget({ entityType: 'PURCHASE_BILL', entityId: b.id, title: `Purchase Bill #${b.billNumber} — ${b.vendorName || 'Vendor'}` })}
                            className="hover:underline flex items-center gap-1"
                            title="Inspect Purchase Bill 360° Journey"
                          >
                            {b?.billNumber || '-'}
                          </button>
                          {b?.linkedPoId && b?.linkedPoNumber ? (
                            <button
                              type="button"
                              onClick={() => setJourneyTarget({ entityType: 'PURCHASE_ORDER', entityId: b.linkedPoId, title: `Purchase Order ${b.linkedPoNumber}` })}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-bold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 hover:bg-amber-100 transition-colors"
                              title={`Open Linked Purchase Order ${b.linkedPoNumber}${b.linkedGrnNumber ? ` (${b.linkedGrnNumber})` : ''} 360° Journey`}
                            >
                              <ShieldCheck className="w-3 h-3 shrink-0" />
                              <span>{b.linkedPoNumber} · 3-Way Matched</span>
                              {b.linkedGrnNumber && <span className="font-mono opacity-75">({b.linkedGrnNumber})</span>}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-slate-100 text-slate-500 border border-slate-200/80 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                              Direct Supplier Bill (Non-PO)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">
                          {b?.vendorName || '-'}
                        </div>
                        {b?.vendorTin && (
                          <div className="text-[10px] font-mono text-slate-400">
                            TIN: {b.vendorTin}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                        {formatCurrency(b?.totalAmount)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        {formatCurrency(b?.balanceDue)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <StatusBadge status={b?.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setJourneyTarget({ entityType: 'PURCHASE_BILL', entityId: b.id, title: `Purchase Bill #${b.billNumber} — ${b.vendorName || 'Vendor'}` })}
                            className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1 transition-colors"
                          >
                            <Activity className="w-3.5 h-3.5" /> 360° Journey
                          </button>

                          {/* Pay Supplier / Disbursement Button */}
                          {isPostablePayment && (
                            <button
                              type="button"
                              onClick={() => openPayModal(b)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs inline-flex items-center gap-1 transition-colors"
                              title={b?.status === 'PARTIAL' ? 'Settle remaining balance via Disbursement Voucher (DV)' : 'Record Supplier Disbursement Voucher (DV)'}
                            >
                              <span className="font-bold text-xs leading-none">₱</span>
                              {b?.status === 'PARTIAL' ? 'Settle Balance (DV)' : 'Disbursement Voucher'}
                            </button>
                          )}

                          {/* Workflow buttons */}
                          {(['DRAFT', 'RETURNED', 'REJECTED'].includes((b?.status || 'DRAFT').toUpperCase())) && (
                            <button
                              type="button"
                              disabled={processingId === b.id}
                              onClick={() => handleBillWorkflow(b.id, 'submit')}
                              className="px-2.5 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {processingId === b.id ? 'Submitting...' : 'Submit'}
                            </button>
                          )}
                          {(['SUBMITTED', 'REVIEWED', 'UNDER_REVIEW'].includes((b?.status || '').toUpperCase())) && (
                            <>
                              <button
                                type="button"
                                disabled={processingId === b.id}
                                onClick={() => handleBillWorkflow(b.id, 'approve')}
                                className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                              >
                                {processingId === b.id ? 'Working...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                disabled={processingId === b.id}
                                onClick={() => {
                                  setRejectTarget({ id: b.id, billNumber: b.billNumber });
                                  setRejectReason('');
                                  setError(null);
                                }}
                                className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-semibold rounded-lg hover:bg-rose-100 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {(b?.status || '').toUpperCase() === 'APPROVED' && (
                            <button
                              type="button"
                              disabled={processingId === b.id}
                              onClick={() => handleBillWorkflow(b.id, 'post')}
                              className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {processingId === b.id ? 'Posting...' : 'Post to GL'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {safeBills.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No purchase bills found matching current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        )}
      </div>

      {/* Pay Supplier / Disbursement Voucher Modal with BIR Form 2307 EWT */}
      {payTargetBill && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-bold text-base flex items-center justify-center">₱</span>
                  Supplier Disbursement Voucher (DV / CV)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Record supplier settlement & BIR Form 2307 against Bill #{payTargetBill.billNumber}
                </p>
              </div>
              <span className="text-xs font-mono font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800">
                Due: {formatCurrency(payTargetBill.balanceDue)}
              </span>
            </div>

            {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs font-semibold">{error}</div>}

            <form onSubmit={handleSubmitPayment} className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1 text-slate-700 dark:text-slate-300">
                <div className="font-bold text-slate-900 dark:text-slate-100">{payTargetBill.vendorName}</div>
                {payTargetBill.vendorTin && <div className="text-[11px] font-mono text-slate-500">TIN: {payTargetBill.vendorTin}</div>}
              </div>

              {/* Settlement Amount & Quick Buttons */}
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">Settlement Gross Amount (PHP) *</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const balCent = payTargetBill.balanceDue !== undefined && payTargetBill.balanceDue !== null ? payTargetBill.balanceDue : (payTargetBill.totalAmount || 0);
                        const half = Math.round(balCent / 2);
                        setDisbursementData({ ...disbursementData, settlementAmountPhp: (half / 100).toFixed(2) });
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                    >
                      50% Partial
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const balCent = payTargetBill.balanceDue !== undefined && payTargetBill.balanceDue !== null ? payTargetBill.balanceDue : (payTargetBill.totalAmount || 0);
                        setDisbursementData({ ...disbursementData, settlementAmountPhp: (balCent / 100).toFixed(2) });
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                    >
                      Full Balance ({formatCurrency(payTargetBill.balanceDue)})
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 font-bold">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={disbursementData.settlementAmountPhp}
                    onChange={(e) => setDisbursementData({ ...disbursementData, settlementAmountPhp: e.target.value })}
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono font-bold text-sm text-slate-900 dark:text-slate-100"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>Current Balance Due: <strong className="font-mono text-slate-700 dark:text-slate-300">{formatCurrency(payTargetBill.balanceDue)}</strong></span>
                  <span>
                    Resulting Status:{' '}
                    <strong className={
                      Math.max(0, (payTargetBill.balanceDue || 0) - Math.round((parseFloat(disbursementData.settlementAmountPhp) || 0) * 100)) === 0
                        ? 'text-emerald-600 font-bold'
                        : 'text-amber-600 font-bold'
                    }>
                      {Math.max(0, (payTargetBill.balanceDue || 0) - Math.round((parseFloat(disbursementData.settlementAmountPhp) || 0) * 100)) === 0 ? 'PAID' : 'PARTIAL'}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Voucher Number (DV #)</label>
                  <input
                    type="text"
                    required
                    value={disbursementData.paymentNumber}
                    onChange={(e) => setDisbursementData({ ...disbursementData, paymentNumber: e.target.value })}
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Payment Date</label>
                  <input
                    type="date"
                    required
                    value={disbursementData.paymentDate}
                    onChange={(e) => setDisbursementData({ ...disbursementData, paymentDate: e.target.value })}
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* BIR Form 2307 Creditable Withholding Tax (EWT) */}
              <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-900/60 space-y-2">
                <div className="font-bold text-blue-900 dark:text-blue-300 flex items-center justify-between">
                  <span>BIR Form 2307 Withholding Tax (EWT)</span>
                  <span className="text-[10px] font-mono bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">RR 2-98 / RR 11-2018 / EOPT</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] text-slate-500 block mb-1">Official BIR Form 2307 ATC Classification</label>
                    <select
                      value={disbursementData.atcCode}
                      onChange={(e) => {
                        const code = e.target.value;
                        const rateMap: Record<string, number> = {
                          WC158: 1,
                          WC160: 2,
                          WC100: 5,
                          WC010: 10,
                          WI010: 5,
                          WC120: 2,
                          NONE: 0
                        };
                        setDisbursementData({ ...disbursementData, atcCode: code, atcRatePercent: rateMap[code] ?? 0 });
                      }}
                      className="w-full p-1.5 border border-blue-200 dark:border-blue-800 rounded bg-white dark:bg-slate-900 font-semibold text-xs"
                    >
                      <option value="WC158">WC158 — Top Withholding Agent: Goods (1%)</option>
                      <option value="WC160">WC160 — Top Withholding Agent: Services (2%)</option>
                      <option value="WC100">WC100 — Rental of Real/Personal Property (5%)</option>
                      <option value="WC010">WC010 — Corp. Professional / Talent Fees (10%)</option>
                      <option value="WI010">WI010 — Ind. Professional Fees ≤ ₱3M (5%)</option>
                      <option value="WC120">WC120 — Prime Contractors / Subcontractors (2%)</option>
                      <option value="NONE">NONE — Exempt / 0% EWT Withholding</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">EWT Withheld (2307)</label>
                    <div className="p-1.5 font-mono font-bold text-amber-700 dark:text-amber-300 bg-white dark:bg-slate-900 rounded border border-blue-200 text-xs">
                      {(() => {
                        const sCent = Math.round((parseFloat(disbursementData.settlementAmountPhp) || 0) * 100);
                        const taxBase = isBillVatApplicable(payTargetBill) ? Math.round(sCent / 1.12) : sCent;
                        const ewt = Math.round(taxBase * (disbursementData.atcRatePercent / 100));
                        return formatCurrency(ewt);
                      })()}
                    </div>
                  </div>
                </div>
                <div className="pt-1 border-t border-blue-100 dark:border-blue-900/60 flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 dark:text-slate-400">
                    Net Cash Outflow ({isBillVatApplicable(payTargetBill) ? 'EWT Base: Net of 12% VAT' : 'EWT Base: Gross Non-VAT'}):
                  </span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {(() => {
                      const sCent = Math.round((parseFloat(disbursementData.settlementAmountPhp) || 0) * 100);
                      const taxBase = isBillVatApplicable(payTargetBill) ? Math.round(sCent / 1.12) : sCent;
                      const ewt = Math.round(taxBase * (disbursementData.atcRatePercent / 100));
                      const net = Math.max(0, sCent - ewt);
                      return formatCurrency(net);
                    })()}
                  </span>
                </div>
              </div>

              {/* Cash/Bank Account & Payment Method */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Disbursing Account</label>
                  <select
                    required
                    value={disbursementData.cashAccountId}
                    onChange={(e) => setDisbursementData({ ...disbursementData, cashAccountId: e.target.value })}
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                  >
                    <option value="">Select Cash/Bank account...</option>
                    {cashAndBankAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Payment Method</label>
                  <select
                    value={disbursementData.paymentMethod}
                    onChange={(e) => setDisbursementData({ ...disbursementData, paymentMethod: e.target.value })}
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (PCHC / InstaPay)</option>
                    <option value="CHECK">Corporate Check Voucher</option>
                    <option value="CASH">Petty Cash</option>
                    <option value="ONLINE">Online Remittance / Direct AP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Reference / Check #</label>
                <input
                  type="text"
                  value={disbursementData.reference}
                  onChange={(e) => setDisbursementData({ ...disbursementData, reference: e.target.value })}
                  className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                  placeholder="Check number, bank transaction sequence..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setPayTargetBill(null)}
                  className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="px-4 py-2 font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submittingPayment ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Disbursement & Post GL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Purchase Bill Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Create Purchase Bill</h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleCreateBill} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">Vendor</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingVendor(null);
                      setShowVendorModal(true);
                    }}
                    className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:underline flex items-center gap-1"
                  >
                    <Truck className="w-3.5 h-3.5" /> + Create Vendor
                  </button>
                </div>
                <select
                  required
                  value={newBill.vendorId}
                  onChange={(e) => {
                    if (e.target.value === '__NEW_VENDOR__') {
                      setEditingVendor(null);
                      setShowVendorModal(true);
                    } else {
                      setNewBill({ ...newBill, vendorId: e.target.value });
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select a vendor...</option>
                  <option value="__NEW_VENDOR__" className="font-semibold text-amber-600">+ Create New Vendor...</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.code ? `[${v.code}] ` : ''}{v.legalName || v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Bill Number</label>
                  <input
                    type="text"
                    required
                    placeholder="BILL-001"
                    value={newBill.billNumber}
                    onChange={(e) => setNewBill({ ...newBill, billNumber: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Total Amount (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newBill.totalAmount || ''}
                    onChange={(e) => setNewBill({ ...newBill, totalAmount: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Expense / Cost Account</label>
                <select
                  value={newBill.expenseAccountId}
                  onChange={(e) => setNewBill({ ...newBill, expenseAccountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Default from Vendor / Company COA Mapping</option>
                  {postableExpenseAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.accountCode} - {a.accountName} ({a.accountType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Bill Date</label>
                  <input
                    type="date"
                    required
                    value={newBill.billDate}
                    onChange={(e) => setNewBill({ ...newBill, billDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Due Date</label>
                  <input
                    type="date"
                    required
                    value={newBill.dueDate}
                    onChange={(e) => setNewBill({ ...newBill, dueDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Reference / PO #</label>
                <input
                  type="text"
                  placeholder="e.g. PO-2026-0098"
                  value={newBill.reference}
                  onChange={(e) => setNewBill({ ...newBill, reference: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Create Bill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vendor Creation Modal */}
      <VendorModal
        isOpen={showVendorModal}
        onClose={() => {
          setShowVendorModal(false);
          setEditingVendor(null);
        }}
        onVendorCreated={handleVendorCreated}
        initialData={editingVendor}
      />

      {/* Enterprise 360° Record Journey Modal */}
      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={() => fetchData()}
        />
      )}
    </div>
  );
}
