import React, { useState, useEffect } from 'react';
import { 
  FileText, Plus, RefreshCw, UserCheck, CheckCircle2, 
  ArrowRightLeft, ArrowUpRight, Clock, AlertCircle, Building, Filter,
  UserPlus, Users, Search, Edit3, ShieldCheck, Activity
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import ForexConverterWidget from '../../components/ForexConverterWidget';
import RecordActivityModal from '../../components/RecordActivityModal';
import { PaginationControls } from '../../components/PaginationControls';
import { TableScrollContainer, TableDensity } from '../../components/shared/TableScrollContainer';
import TableRecencyFilterBadge from '../../components/shared/TableRecencyFilterBadge';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter } from '../../components/shared/TableFilterToolbar';
import CustomerModal from '../../components/CustomerModal';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';
import { filterEligibleRevenueAccounts, formatAccountOptionLabel } from '../../../shared/coaAccountUtils';

export default function SalesInvoicing() {
  const { activeCompany, canCreate, userRole } = useAuth();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [showForexCalc, setShowForexCalc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; invoiceNumber: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'INVOICES' | 'CUSTOMERS'>('INVOICES');
  const [customerSearch, setCustomerSearch] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  const isVatRegistered = (activeCompany?.vatStatus || 'VAT') === 'VAT';
  const vatRate = isVatRegistered ? 0.12 : 0;

  const [newInvoice, setNewInvoice] = useState({
    customerId: '',
    revenueAccountId: '',
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    currency: 'PHP',
    foreignAmountUsd: 0,
    exchangeRate: 1,
    subtotalAmount: 10000,
    vatAmount: isVatRegistered ? 1200 : 0,
    cwtAmount: 0,
    totalAmount: isVatRegistered ? 11200 : 10000,
    notes: 'Sales invoice for services rendered'
  });

  const eligibleRevenueAccounts = React.useMemo(
    () => filterEligibleRevenueAccounts(coaAccounts),
    [coaAccounts]
  );

  useEffect(() => {
    // Recalculate default VAT when vatStatus loads or changes
    const defaultVat = isVatRegistered ? Math.round(newInvoice.subtotalAmount * 0.12 * 100) / 100 : 0;
    setNewInvoice(prev => ({
      ...prev,
      vatAmount: defaultVat,
      totalAmount: Math.round((prev.subtotalAmount + defaultVat) * 100) / 100
    }));
  }, [activeCompany?.vatStatus]);

  // Pagination & Density State (Default 20 per page, configurable)
  const [pageSize, setPageSize] = useState(20);
  const [density, setDensity] = useState<TableDensity>('comfortable');
  const [customerPageIndex, setCustomerPageIndex] = useState(0);
  const [customerPageSize, setCustomerPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('ALL');
  const [datePreset, setDatePreset] = useState<'RECENT_1_MONTH' | 'ALL'>('ALL');

  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);
  const [serverSummary, setServerSummary] = useState<{
    totalArOutstanding: number;
    postedArBalance?: number;
    partialArBalance?: number;
    totalGrossBilledOpenAr?: number;
    settledOnOpenAr?: number;
    overdueCollections: number;
    overdueInvoicesCount?: number;
    currentNotDueAr?: number;
    currentNotDueCount?: number;
    activeInvoicesCount: number;
    draftUnpostedPotentialAr?: number;
    glArBalance?: number;
    glSubledgerVariance?: number;
    isGlReconciled?: boolean;
    asOfDate?: string;
    statusCounts: Record<string, number>;
  } | null>(null);

  const fetchData = async (cursor?: string | null, customLimit?: number) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const activeLimit = customLimit || pageSize;
      const params = new URLSearchParams();
      params.set('limit', String(activeLimit));
      params.set('order', sortOrder);
      if (activeCurr) params.set('cursor', activeCurr);
      if (invoiceSearch.trim()) params.set('search', invoiceSearch.trim());
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (fromDate) {
        params.set('fromDate', fromDate);
      } else if (datePreset === 'RECENT_1_MONTH') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        params.set('fromDate', d.toISOString().slice(0, 10));
      }
      if (toDate) {
        params.set('toDate', toDate);
      }

      const [invRes, custRes, accRes] = await Promise.all([
        fetch(`/api/accounting/sales-invoices?${params.toString()}`),
        fetch('/api/master-data/customers'),
        fetch('/api/master-data/accounts?raw=true')
      ]);

      if (invRes.ok) {
        const invData = await invRes.json();
        if (Array.isArray(invData)) {
          setInvoices(invData);
          setPaginationMeta(null);
          setServerSummary(null);
        } else {
          setInvoices(invData.data || []);
          setPaginationMeta(invData.pagination || null);
          setServerSummary(invData.summary || null);
        }
      }
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomers(Array.isArray(custData) ? custData : (custData.data || []));
      }
      if (accRes.ok) {
        const accData = await accRes.json();
        const accList = Array.isArray(accData) ? accData : (accData.data || []);
        setCoaAccounts(accList);
        const revOptions = filterEligibleRevenueAccounts(accList);
        if (revOptions.length > 0) {
          setNewInvoice(prev => ({
            ...prev,
            revenueAccountId: prev.revenueAccountId || revOptions[0].id
          }));
        }
      }
    } catch (err) {
      console.error('Error loading sales invoicing data', err);
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
  }, [activeCompany?.id, invoiceSearch, statusFilter, sortOrder, fromDate, toDate, pageSize]);

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

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newInvoice.revenueAccountId) {
      setError('Please select a Revenue GL Account from the Chart of Accounts.');
      return;
    }
    try {
      const subtotalCentavos = Math.round(newInvoice.subtotalAmount * 100);
      const vatCentavos = Math.round(newInvoice.vatAmount * 100);
      const reconciledTotalCentavos = subtotalCentavos + vatCentavos;
      const payload = {
        ...newInvoice,
        totalAmount: reconciledTotalCentavos,
        lines: [
          {
            accountId: newInvoice.revenueAccountId,
            description: newInvoice.notes || 'Sales invoice',
            quantity: 1,
            unitPrice: subtotalCentavos,
            amount: subtotalCentavos,
            taxAmount: vatCentavos
          }
        ]
      };
      const res = await fetch('/api/accounting/sales-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowCreateModal(false);
        fetchData();
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to create invoice');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating invoice');
    }
  };

  const handleWorkflowAction = async (
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'post',
    reason?: string
  ) => {
    setError(null);
    setSuccessMsg(null);
    setProcessingId(id);
    try {
      const res = await fetch(`/api/accounting/sales-invoices/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {})
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const labels: Record<string, string> = {
          submit: 'submitted for approval',
          approve: 'approved',
          reject: 'returned/rejected',
          post: 'posted to General Ledger'
        };
        setSuccessMsg(data.message || `Sales invoice ${labels[action] || 'updated'} successfully.`);
        if (action === 'reject') {
          setRejectTarget(null);
          setRejectReason('');
        }
        await fetchData();
      } else {
        setError(data.message || `Action ${action} failed on sales invoice.`);
      }
    } catch (err: any) {
      setError(err?.message || `Network error while executing ${action} on sales invoice.`);
    } finally {
      setProcessingId(null);
    }
  };

  const customerDropdownOptions = React.useMemo(() => {
    return customers.map(c => ({
      value: c.id,
      label: c.legalName || c.tradeName || c.code || 'Unnamed Customer'
    }));
  }, [customers]);

  const safeInvoices = Array.isArray(invoices) ? invoices.filter(i => {
    const stUpper = (i?.status || 'DRAFT').toUpperCase();
    if (['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes(stUpper)) return false;
    const matchesStatus =
      statusFilter === 'ALL' ||
      stUpper === statusFilter ||
      (statusFilter === 'PARTIAL' && stUpper === 'PARTIALLY_PAID') ||
      (statusFilter === 'RETURNED' && stUpper === 'REJECTED');
    if (!matchesStatus) return false;
    if (selectedCustomerId && selectedCustomerId !== 'ALL' && i.customerId !== selectedCustomerId) {
      return false;
    }
    if (!invoiceSearch.trim()) return true;
    const q = invoiceSearch.toLowerCase();
    return (
      (i.invoiceNumber && i.invoiceNumber.toLowerCase().includes(q)) ||
      (i.customerName && i.customerName.toLowerCase().includes(q)) ||
      (i.notes && i.notes.toLowerCase().includes(q))
    );
  }) : [];

  const exportData: ExportData = {
    filename: `Sales_Invoices_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Sales Invoices & Accounts Receivable Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | AR Ledger`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Invoice #', 'Customer', 'Date', 'Total Amount (PHP)', 'Balance Due (PHP)', 'Status'],
    rows: safeInvoices.map(i => [
      i?.invoiceNumber || '-',
      i?.customerName || i?.customerId || '-',
      i?.invoiceDate ? new Date(i.invoiceDate).toLocaleDateString() : '-',
      `₱${((i?.totalAmount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      `₱${((i?.balanceDue || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      i?.status || 'DRAFT'
    ])
  };

  const handleCustomerCreated = (newCust: any) => {
    setCustomers(prev => {
      const idx = prev.findIndex(c => c.id === newCust.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newCust;
        return copy;
      }
      return [newCust, ...prev];
    });
    setNewInvoice(prev => ({
      ...prev,
      customerId: newCust.id
    }));
  };

  const filteredCustomers = customers.filter(c => {
    if (!customerSearch.trim()) return true;
    const q = customerSearch.toLowerCase();
    return (
      (c.legalName && c.legalName.toLowerCase().includes(q)) ||
      (c.code && c.code.toLowerCase().includes(q)) ||
      (c.tin && c.tin.toLowerCase().includes(q)) ||
      (c.contactPerson && c.contactPerson.toLowerCase().includes(q))
    );
  });

  const paginatedCustomers = React.useMemo(() => {
    const start = customerPageIndex * customerPageSize;
    return filteredCustomers.slice(start, start + customerPageSize);
  }, [filteredCustomers, customerPageIndex, customerPageSize]);

  useEffect(() => {
    setCustomerPageIndex(0);
  }, [customerSearch]);

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>Sales &amp; Invoicing (Accounts Receivable)</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Customer billing, 12% Output VAT (EOPT Act / BIR RR 7-2024 Sales Invoice), BIR CWT withholding tax, and Accounts Receivable tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <ModuleArchiveInbox
            entityTypes={['SALES_INVOICE', 'CUSTOMER_PAYMENT', 'CREDIT_MEMO', 'CUSTOMER']}
            moduleTitle="Sales & Accounts Receivable"
            description="Archived Sales Invoices, Official Receipts, Credit Memos, and Customers with 30-day retention and state-preserving restore."
            onRestored={() => fetchData()}
          />
          <button
            onClick={() => {
              if (!canCreate) {
                setError(`Access Restricted: Role (${userRole}) does not have permission to create records.`);
                return;
              }
              setEditingCustomer(null);
              setShowCustomerModal(true);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm ${
              canCreate ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-500 cursor-not-allowed opacity-80'
            }`}
            title={canCreate ? 'Create Customer' : `Restricted for role: ${userRole}`}
          >
            <UserPlus className="w-4 h-4" /> Create Customer
          </button>
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => {
              if (!canCreate) {
                setError(`Access Restricted: Role (${userRole}) does not have permission to create records.`);
                return;
              }
              setShowCreateModal(true);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm ${
              canCreate ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-500 cursor-not-allowed opacity-80'
            }`}
            title={canCreate ? 'Create Sales Invoice' : `Restricted for role: ${userRole}`}
          >
            <Plus className="w-4 h-4" /> Create Sales Invoice
          </button>
        </div>
      </div>

      {/* Main Page Error & Success Banners */}
      {error && !showCreateModal && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-rose-600 dark:text-rose-300 underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-700 dark:text-emerald-300 underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {rejectTarget && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!rejectReason.trim()) {
              setError('Please enter a reason to reject or return the invoice.');
              return;
            }
            handleWorkflowAction(rejectTarget.id, 'reject', rejectReason.trim());
          }}
          className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        >
          <div className="text-xs font-bold text-amber-900 dark:text-amber-200 shrink-0">
            Reject / Return #{rejectTarget.invoiceNumber}:
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

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-1">
        <button
          onClick={() => setActiveTab('INVOICES')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'INVOICES'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Sales Invoices & AR Register</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-500/30 text-white">
            {(serverSummary?.statusCounts?.ALL ?? paginationMeta?.totalCount ?? safeInvoices.length).toLocaleString()}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('CUSTOMERS')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'CUSTOMERS'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Customers Master Directory</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
            {customers.length}
          </span>
        </button>
      </div>

      {activeTab === 'INVOICES' && (
        <>
          {/* KPI Summary Cards (Authoritative Database Aggregates) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Total AR Outstanding (All Posted)</span>
              <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 font-mono mt-1">
                {serverSummary
                  ? `₱${(serverSummary.totalArOutstanding / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                  : '—'}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Database sum of unpaid POSTED &amp; PARTIAL invoices
              </span>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Active Invoices</span>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-1">
                {serverSummary ? serverSummary.activeInvoicesCount.toLocaleString() : safeInvoices.length.toLocaleString()}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Excludes Cancelled, Reversed, Archived &amp; Removed
              </span>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Overdue Collections</span>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400 font-mono mt-1">
                {serverSummary
                  ? `₱${(serverSummary.overdueCollections / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                  : '—'}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Posted invoices past statutory/credit due date
              </span>
            </div>
          </div>

          {/* Status Filter Bar */}
          <div className="flex flex-wrap items-center gap-1.5 min-w-0 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 shrink-0">Status Filter:</span>
            {([
              { key: 'ALL', tip: 'All active Sales Invoices (excludes Archived, Removed & Soft Deleted)' },
              { key: 'DRAFT', tip: 'Unissued internal draft; no GL or Output VAT recognized yet' },
              { key: 'SUBMITTED', tip: 'Submitted for accounting/supervisor verification' },
              { key: 'RETURNED', tip: 'Returned or rejected for correction before approval' },
              { key: 'APPROVED', tip: 'SoD approved; ready for BIR Sales Invoice issuance & Post to GL' },
              { key: 'POSTED', tip: 'Issued BIR Sales Invoice posted to GL (AR + 12% Output VAT recognized)' },
              { key: 'PARTIAL', tip: 'Partially collected with remaining AR balance due' },
              { key: 'PAID', tip: 'Fully collected via Official/Collection Receipt' },
              { key: 'CANCELLED', tip: 'Voided pre-posting while preserving BIR serial sequence' },
              { key: 'REVERSED', tip: 'Reversed via Credit Memo / offsetting GL journal per BIR CAS rules' }
            ] as const).map(({ key: st, tip }) => {
              const dbCount = serverSummary?.statusCounts?.[st];
              return (
                <button
                  key={st}
                  type="button"
                  title={tip}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
                    statusFilter === st
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  <span>{st}</span>
                  {dbCount !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                        statusFilter === st
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {dbCount.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Unified Filter, Sort, Company & Search Toolbar */}
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
            entityLabel="Customer"
            selectedEntityId={selectedCustomerId}
            entityOptions={customerDropdownOptions}
            onEntityChange={(cId) => setSelectedCustomerId(cId)}
            searchQuery={invoiceSearch}
            onSearchChange={(q) => {
              setInvoiceSearch(q);
              setCursorStack([]);
              setCurrentCursor(null);
            }}
            searchPlaceholder="Search invoice #, customer name, notes..."
            filteredCount={safeInvoices.length}
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
              setFromDate('');
              setToDate('');
              setSelectedCustomerId('ALL');
              setInvoiceSearch('');
              setStatusFilter('ALL');
              setCursorStack([]);
              setCurrentCursor(null);
            }}
          />

          {/* Invoices Table */}
          {loading ? (
            <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" /> Fetching sales invoices...
            </div>
          ) : (
            <TableScrollContainer
              title="Sales Invoices & AR Register"
              totalRecordsCount={paginationMeta?.totalCount ?? safeInvoices.length}
              density={density}
              onDensityChange={setDensity}
              footer={
                <PaginationControls
                  totalCount={paginationMeta?.totalCount}
                  itemCount={safeInvoices.length}
                  pageIndex={cursorStack.length}
                  pageSize={pageSize}
                  pageSizeOptions={[20, 50, 100]}
                  hasNextPage={!!paginationMeta?.hasNextPage}
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  onPageSizeChange={(newSize) => {
                    setPageSize(newSize);
                    setCursorStack([]);
                    setCurrentCursor(null);
                    fetchData(null, newSize);
                  }}
                  loading={loading}
                />
              }
            >
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3.5 px-4">Invoice #</th>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4 text-right">Total (PHP)</th>
                    <th className="py-3.5 px-4 text-right">Balance Due</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {safeInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">
                        {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100">
                        {inv.customerName || inv.customerId || 'Acme Client'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                        ₱{((inv.totalAmount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        ₱{((inv.balanceDue || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          inv.status === 'POSTED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300' :
                          inv.status === 'PAID' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300' :
                          (inv.status === 'PARTIAL' || inv.status === 'PARTIALLY_PAID') ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700' :
                          inv.status === 'APPROVED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300' :
                          (inv.status === 'SUBMITTED' || inv.status === 'REVIEWED' || inv.status === 'UNDER_REVIEW') ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300' :
                          (inv.status === 'CANCELLED' || inv.status === 'REVERSED') ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300' :
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {inv.status === 'PARTIALLY_PAID' ? 'PARTIAL' : (inv.status || 'DRAFT')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setJourneyTarget({
                              entityType: 'SALES_INVOICE',
                              entityId: inv.id,
                              title: `Sales Invoice #${inv.invoiceNumber} — ${inv.customerName || 'Customer'}`
                            })}
                            className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1"
                          >
                            <Activity className="w-3.5 h-3.5" /> 360° Journey
                          </button>
                          {(['DRAFT', 'RETURNED', 'REJECTED'].includes((inv.status || 'DRAFT').toUpperCase())) && (
                            <button
                              type="button"
                              disabled={processingId === inv.id}
                              onClick={() => handleWorkflowAction(inv.id, 'submit')}
                              className="px-2.5 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                              {processingId === inv.id ? 'Submitting...' : 'Submit'}
                            </button>
                          )}
                          {(['SUBMITTED', 'REVIEWED', 'UNDER_REVIEW'].includes((inv.status || '').toUpperCase())) && (
                            <>
                              <button
                                type="button"
                                disabled={processingId === inv.id}
                                onClick={() => handleWorkflowAction(inv.id, 'approve')}
                                className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                              >
                                {processingId === inv.id ? 'Working...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                disabled={processingId === inv.id}
                                onClick={() => {
                                  setRejectTarget({ id: inv.id, invoiceNumber: inv.invoiceNumber });
                                  setRejectReason('');
                                  setError(null);
                                }}
                                className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-semibold rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {(inv.status || '').toUpperCase() === 'APPROVED' && (
                            <button
                              type="button"
                              disabled={processingId === inv.id}
                              onClick={() => handleWorkflowAction(inv.id, 'post')}
                              className="px-3 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                              {processingId === inv.id ? 'Posting...' : 'Post to GL'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {safeInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        No sales invoices recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableScrollContainer>
          )}
        </>
      )}

      {/* Customers Directory Tab */}
      {activeTab === 'CUSTOMERS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customers by name, code, TIN..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <button
              onClick={() => {
                setEditingCustomer(null);
                setShowCustomerModal(true);
              }}
              className="w-full sm:w-auto px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm flex items-center justify-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" /> Add New Customer
            </button>
          </div>

          <TableScrollContainer
            title="Customers Master Directory"
            totalRecordsCount={filteredCustomers.length}
            density={density}
            onDensityChange={setDensity}
            footer={
              <PaginationControls
                totalCount={filteredCustomers.length}
                itemCount={paginatedCustomers.length}
                pageIndex={customerPageIndex}
                pageSize={customerPageSize}
                pageSizeOptions={[20, 50, 100]}
                hasNextPage={(customerPageIndex + 1) * customerPageSize < filteredCustomers.length}
                onNextPage={() => setCustomerPageIndex(p => p + 1)}
                onPrevPage={() => setCustomerPageIndex(p => Math.max(0, p - 1))}
                onFirstPage={() => setCustomerPageIndex(0)}
                onLastPage={() => setCustomerPageIndex(Math.max(0, Math.ceil(filteredCustomers.length / customerPageSize) - 1))}
                onPageSizeChange={(newSize) => {
                  setCustomerPageSize(newSize);
                  setCustomerPageIndex(0);
                }}
              />
            }
          >
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Code</th>
                  <th className="py-3.5 px-4">Customer Name / DBA</th>
                  <th className="py-3.5 px-4">BIR TIN</th>
                  <th className="py-3.5 px-4">VAT Status</th>
                  <th className="py-3.5 px-4">Contact Person</th>
                  <th className="py-3.5 px-4">Payment Terms</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {paginatedCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                      {c.code || '-'}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-100">
                      {c.legalName}
                      {c.tradeName && <span className="block text-[11px] text-slate-400 font-normal">DBA: {c.tradeName}</span>}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {c.tin || <span className="text-slate-400 italic">Not set</span>}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-[11px]">
                        {c.vatStatus || 'VATable'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {c.contactPerson || '-'}
                      {c.contactDetails && <span className="block text-[10px] text-slate-400">{c.contactDetails}</span>}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-slate-600 dark:text-slate-300">
                      {c.paymentTerms || 'NET_30'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setJourneyTarget({
                            entityType: 'CUSTOMER',
                            entityId: c.id,
                            title: `Customer Master: ${c.legalName}`
                          })}
                          className="px-2.5 py-1 text-xs font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-1"
                        >
                          <Activity className="w-3.5 h-3.5" /> 360°
                        </button>
                        <button
                          onClick={() => {
                            setEditingCustomer(c);
                            setShowCustomerModal(true);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-indigo-500" /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No customers found matching your criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        </div>
      )}

      {/* Create Sales Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              Create New Sales Invoice
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateInvoice} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">Customer</label>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCustomer(null);
                        setShowCustomerModal(true);
                      }}
                      className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:underline flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> + Create Customer
                    </button>
                  </div>
                  <select
                    required
                    value={newInvoice.customerId}
                    onChange={(e) => {
                      if (e.target.value === '__NEW_CUSTOMER__') {
                        setEditingCustomer(null);
                        setShowCustomerModal(true);
                      } else {
                        setNewInvoice({ ...newInvoice, customerId: e.target.value });
                      }
                    }}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="">Select a customer...</option>
                    <option value="__NEW_CUSTOMER__" className="font-semibold text-indigo-600">+ Create New Customer...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.code ? `[${c.code}] ` : ''}{c.legalName || c.customerName}
                      </option>
                    ))}
                    <option value="CUST-GENERIC">Generic Retail Customer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Invoice Number</label>
                  <input
                    type="text"
                    required
                    value={newInvoice.invoiceNumber}
                    onChange={(e) => setNewInvoice({ ...newInvoice, invoiceNumber: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Revenue / Sales GL Account</label>
                <select
                  required
                  value={newInvoice.revenueAccountId}
                  onChange={(e) => setNewInvoice({ ...newInvoice, revenueAccountId: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                >
                  <option value="">-- Select Revenue GL Account --</option>
                  {eligibleRevenueAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {formatAccountOptionLabel(acc)} ({acc.accountType})
                    </option>
                  ))}
                </select>
                {eligibleRevenueAccounts.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    No active Revenue accounts found. Configure one in Chart of Accounts.
                  </p>
                )}
              </div>

              {/* Forex Integration Button / Modal Toggle */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-900/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
                    Foreign Currency / Spot Rate Calculator
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowForexCalc(!showForexCalc)}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {showForexCalc ? 'Hide Converter' : 'Show Spot Rate Converter'}
                  </button>
                </div>

                {showForexCalc && (
                  <ForexConverterWidget
                    onApplyPhpAmount={(amountPhp, curr, rate, foreignAmt) => {
                      const computedVat = isVatRegistered ? Math.round(amountPhp * 0.12 * 100) / 100 : 0;
                      setNewInvoice({
                        ...newInvoice,
                        currency: curr,
                        exchangeRate: rate,
                        foreignAmountUsd: foreignAmt,
                        subtotalAmount: amountPhp,
                        vatAmount: computedVat,
                        totalAmount: Math.round((amountPhp + computedVat) * 100) / 100
                      });
                    }}
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Subtotal (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newInvoice.subtotalAmount}
                    onChange={(e) => {
                      const sub = parseFloat(e.target.value) || 0;
                      const vat = isVatRegistered ? Math.round(sub * 0.12 * 100) / 100 : 0;
                      setNewInvoice({
                        ...newInvoice,
                        subtotalAmount: sub,
                        vatAmount: vat,
                        totalAmount: Math.round((sub + vat) * 100) / 100
                      });
                    }}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {isVatRegistered ? '12% Output VAT' : `Output VAT (${(activeCompany?.vatStatus || 'NON_VAT').replace('_', ' ')})`}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newInvoice.vatAmount}
                    onChange={(e) => {
                      const vat = parseFloat(e.target.value) || 0;
                      setNewInvoice({
                        ...newInvoice,
                        vatAmount: vat,
                        totalAmount: Math.round((newInvoice.subtotalAmount + vat) * 100) / 100
                      });
                    }}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Total (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newInvoice.totalAmount}
                    onChange={(e) => {
                      const tot = parseFloat(e.target.value) || 0;
                      const sub = isVatRegistered ? Math.round((tot / 1.12) * 100) / 100 : tot;
                      const vat = Math.round((tot - sub) * 100) / 100;
                      setNewInvoice({
                        ...newInvoice,
                        subtotalAmount: sub,
                        vatAmount: vat,
                        totalAmount: tot
                      });
                    }}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold text-indigo-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Invoice Date</label>
                  <input
                    type="date"
                    required
                    value={newInvoice.invoiceDate}
                    onChange={(e) => setNewInvoice({ ...newInvoice, invoiceDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Due Date</label>
                  <input
                    type="date"
                    required
                    value={newInvoice.dueDate}
                    onChange={(e) => setNewInvoice({ ...newInvoice, dueDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Save Sales Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Create / Edit Modal */}
      <CustomerModal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false);
          setEditingCustomer(null);
        }}
        onCustomerCreated={handleCustomerCreated}
        initialData={editingCustomer}
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
