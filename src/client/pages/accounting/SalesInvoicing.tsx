import React, { useState, useEffect } from 'react';
import { 
  FileText, Plus, RefreshCw, UserCheck, CheckCircle2, 
  DollarSign, ArrowUpRight, Clock, AlertCircle, Building, Filter,
  UserPlus, Users, Search, Edit3, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import ForexConverterWidget from '../../components/ForexConverterWidget';
import CustomerModal from '../../components/CustomerModal';
import { PaginationControls } from '../../components/PaginationControls';

export default function SalesInvoicing() {
  const { activeCompany, canCreate, userRole } = useAuth();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [showForexCalc, setShowForexCalc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'INVOICES' | 'CUSTOMERS'>('INVOICES');
  const [customerSearch, setCustomerSearch] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');

  const isVatRegistered = (activeCompany?.vatStatus || 'VAT') === 'VAT';
  const vatRate = isVatRegistered ? 0.12 : 0;

  const [newInvoice, setNewInvoice] = useState({
    customerId: '',
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    currency: 'PHP',
    foreignAmountUsd: 0,
    exchangeRate: 1,
    subtotalAmount: 10000,
    vatAmount: isVatRegistered ? 1200 : 0,
    cwtAmount: 100,
    totalAmount: isVatRegistered ? 11100 : 9900,
    notes: 'Sales invoice for services rendered'
  });

  useEffect(() => {
    // Recalculate default VAT when vatStatus loads or changes
    const defaultVat = isVatRegistered ? Math.round(newInvoice.subtotalAmount * 0.12 * 100) / 100 : 0;
    setNewInvoice(prev => ({
      ...prev,
      vatAmount: defaultVat,
      totalAmount: prev.subtotalAmount + defaultVat - prev.cwtAmount
    }));
  }, [activeCompany?.vatStatus]);

  // Pagination State
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);

  const fetchData = async (cursor?: string | null) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (activeCurr) params.set('cursor', activeCurr);
      if (invoiceSearch.trim()) params.set('search', invoiceSearch.trim());

      const [invRes, custRes] = await Promise.all([
        fetch(`/api/accounting/sales-invoices?${params.toString()}`),
        fetch('/api/master-data/customers')
      ]);

      if (invRes.ok) {
        const invData = await invRes.json();
        if (Array.isArray(invData)) {
          setInvoices(invData);
          setPaginationMeta(null);
        } else {
          setInvoices(invData.data || []);
          setPaginationMeta(invData.pagination || null);
        }
      }
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomers(Array.isArray(custData) ? custData : (custData.data || []));
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
  }, [activeCompany?.id, invoiceSearch]);

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
    try {
      const payload = {
        ...newInvoice,
        totalAmount: Math.round(newInvoice.totalAmount * 100),
        lines: [
          {
            accountId: "revenue-dummy", // Server must handle fallback if not found
            description: newInvoice.notes || 'Sales invoice',
            quantity: 1,
            unitPrice: Math.round(newInvoice.subtotalAmount * 100),
            amount: Math.round(newInvoice.subtotalAmount * 100)
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

  const handlePostInvoice = async (id: string) => {
    try {
      const res = await fetch(`/api/accounting/sales-invoices/${id}/post`, { method: 'POST' });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(`Posting failed: ${data.message || 'Error posting invoice'}`);
      }
    } catch (err) {
      alert('Network error posting invoice');
    }
  };

  const safeInvoices = Array.isArray(invoices) ? invoices.filter(i => {
    const matchesStatus = statusFilter === 'ALL' || i.status === statusFilter;
    if (!matchesStatus) return false;
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

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Sales & Invoicing (Accounts Receivable)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Customer billing, 12% Output VAT, BIR CWT withholding tax, and Accounts Receivable tracking.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              if (!canCreate) {
                alert(`Access Restricted: Role (${userRole}) does not have permission to create records.`);
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
                alert(`Access Restricted: Role (${userRole}) does not have permission to create records.`);
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
            {safeInvoices.length}
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
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Total AR Outstanding</span>
              <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 font-mono mt-1">
                ₱{(safeInvoices.reduce((acc, i) => acc + (i.balanceDue || 0), 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Active Invoices</span>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-1">
                {safeInvoices.length}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Overdue Collections</span>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400 font-mono mt-1">
                ₱{(safeInvoices.filter(i => new Date(i.dueDate) < new Date() && i.status !== 'PAID').reduce((acc, i) => acc + (i.balanceDue || 0), 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Status Filter:</span>
              {['ALL', 'DRAFT', 'POSTED', 'PAID'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    statusFilter === st 
                      ? 'bg-indigo-600 text-white' 
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                placeholder="Search by invoice # or customer..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Invoices Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" /> Fetching sales invoices...
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
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
                              'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                            }`}>
                              {inv.status || 'DRAFT'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {inv.status === 'DRAFT' && (
                              <button
                                onClick={() => handlePostInvoice(inv.id)}
                                className="px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                              >
                                Post to GL
                              </button>
                            )}
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
                </div>
                <PaginationControls
                  totalCount={paginationMeta?.totalCount}
                  itemCount={safeInvoices.length}
                  pageIndex={cursorStack.length}
                  hasNextPage={!!paginationMeta?.hasNextPage}
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  loading={loading}
                />
              </>
            )}
          </div>
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

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
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
                  {filteredCustomers.map((c) => (
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
                        <button
                          onClick={() => {
                            setEditingCustomer(c);
                            setShowCustomerModal(true);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1 ml-auto"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-indigo-500" /> Edit
                        </button>
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
            </div>
          </div>
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

              {/* Forex Integration Button / Modal Toggle */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-900/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
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
                        totalAmount: sub + vat - newInvoice.cwtAmount
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
                    onChange={(e) => setNewInvoice({ ...newInvoice, vatAmount: parseFloat(e.target.value) || 0 })}
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
                    onChange={(e) => setNewInvoice({ ...newInvoice, totalAmount: parseFloat(e.target.value) || 0 })}
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
    </div>
  );
}
