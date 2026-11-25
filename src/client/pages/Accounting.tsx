import React, { useEffect, useState, useMemo } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  filterEligibleCashBankAccounts,
  filterEligibleDestinationBankAccounts,
  filterEligibleExpenseAndPurchaseAccounts,
  filterEligibleSourceCashAccounts,
  filterPostableLeafAccounts,
  formatAccountOptionLabel,
  inferAccountDetailAndBirCategory,
  isStrictBankAccount
} from '../../shared/coaAccountUtils';
import {
  BIR_TAX_CATEGORIES,
  getDetailTypeDefinition
} from '../../shared/accountCategories';
import { 
  ShoppingCart, Landmark, Plus, 
  BookOpen, ListTree, RefreshCw, Calendar, Lock, Unlock, History, ShieldAlert,
  FileText, Boxes, Users, Building2, ShieldCheck, Search, Filter, Edit2, Activity, Archive,
  CalendarCheck2
} from 'lucide-react';
import ExportButton, { ExportData } from '../components/ExportButton';
import { AccountModal } from '../components/AccountModal';
import VendorModal from '../components/VendorModal';
import RecordActivityModal from '../components/RecordActivityModal';
import ModuleArchiveInbox from '../components/ModuleArchiveInbox';
import { Truck, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/apiClient';
import Journals from './accounting/Journals';
import SalesInvoicing from './accounting/SalesInvoicing';
import InventoryManagement from './accounting/InventoryManagement';
import PayrollCompensation from './accounting/PayrollCompensation';
import FixedAssetsRegister from './accounting/FixedAssetsRegister';
import ProcurementMatching from './accounting/ProcurementMatching';
import BankReconciliation from './accounting/BankReconciliation';
import ForexManagement from './accounting/ForexManagement';
import PurchaseBills from './accounting/PurchaseBills';
import { PeriodCloseWorkspaceModal } from '../components/accounting/PeriodCloseWorkspaceModal';
import { PaginationControls } from '../components/PaginationControls';
import TableRecencyFilterBadge from '../components/shared/TableRecencyFilterBadge';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter } from '../components/shared/TableFilterToolbar';
import { isIsoDateInRecentOneMonth } from '../utils/dateFilterUtils';
import { formatEnterpriseTimestamp } from '../../shared/timestampUtils';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const StatusBadge = ({ status }: { status: string }) => {
  const s = (status || 'DRAFT').toUpperCase();
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
      s === 'POSTED' || s === 'PAID' || s === 'CLEARED' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
      s === 'APPROVED' ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
      s === 'SUBMITTED' || s === 'REVIEWED' || s === 'UNDER_REVIEW' ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800' :
      s === 'CANCELLED' || s === 'REVERSED' || s === 'REJECTED' || s === 'BOUNCED' ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800' :
      s === 'DRAFT' ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300' : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
    }`}>
      {s}
    </span>
  );
};

const AccountingOverview = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">Accounting & Operational Hub</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Double-entry bookkeeping, sub-ledgers, 12% Output VAT, 3-Way Matching, BIR RMC 12-2024 Forex, and fiscal closing controls.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Link 
          to="/accounting/sales-invoicing" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl w-fit mb-3.5 border border-indigo-100 dark:border-indigo-900/40 group-hover:scale-105 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Sales & Invoicing</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Accounts Receivable, 12% Output VAT, CWT, and customer billing.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
            <span>Manage AR</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/purchase-bills" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-amber-500 dark:hover:border-amber-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl w-fit mb-3.5 border border-amber-100 dark:border-amber-900/40 group-hover:scale-105 transition-transform">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">Purchase Bills</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Accounts Payable, supplier invoices, and 12% Input VAT.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <span>Manage AP</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/procurement" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-orange-500 dark:hover:border-orange-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 rounded-xl w-fit mb-3.5 border border-orange-100 dark:border-orange-900/40 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">Procurement (3-Way Match)</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              PO creation, Goods Receipt Notes, and 3-way matching tolerance.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-orange-600 dark:text-orange-400">
            <span>Verify Orders</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/inventory" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl w-fit mb-3.5 border border-emerald-100 dark:border-emerald-900/40 group-hover:scale-105 transition-transform">
              <Boxes className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Inventory & Stock</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              FIFO & Weighted Avg stock valuation, stock take, and COGS entries.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <span>Track Stock</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/payroll" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl w-fit mb-3.5 border border-blue-100 dark:border-blue-900/40 group-hover:scale-105 transition-transform">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Payroll & 1601-C</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              SSS, PhilHealth, Pag-IBIG, 1601-C withholding, and salary GL journals.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-blue-600 dark:text-blue-400">
            <span>Process Payroll</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/fixed-assets" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-teal-500 dark:hover:border-teal-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 rounded-xl w-fit mb-3.5 border border-teal-100 dark:border-teal-900/40 group-hover:scale-105 transition-transform">
              <Building2 className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">Fixed Assets Register</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Capitalization, depreciation schedules, and monthly GL posting.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-teal-600 dark:text-teal-400">
            <span>Depreciation</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/bank-reconciliation" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-cyan-500 dark:hover:border-cyan-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 rounded-xl w-fit mb-3.5 border border-cyan-100 dark:border-cyan-900/40 group-hover:scale-105 transition-transform">
              <Landmark className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">Bank Reconciliation</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Statement line import, auto-matching with GL cash vouchers.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-cyan-600 dark:text-cyan-400">
            <span>Reconcile</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/forex" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl w-fit mb-3.5 border border-emerald-100 dark:border-emerald-900/40 group-hover:scale-105 transition-transform">
              <span className="w-5 h-5 flex items-center justify-center font-black text-base leading-none" aria-hidden="true">₱</span>
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Forex & BSP Rates</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              BIR RMC 12-2024 compliance, realized FX gain/loss revaluation.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <span>Forex Ledger</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/journals" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 rounded-xl w-fit mb-3.5 border border-purple-100 dark:border-purple-900/40 group-hover:scale-105 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Journal Entries</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              General journal vouchers & transaction log. CSV & PDF export.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-purple-600 dark:text-purple-400">
            <span>Post Entries</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/accounts" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl w-fit mb-3.5 border border-indigo-100 dark:border-indigo-900/40 group-hover:scale-105 transition-transform">
              <ListTree className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Chart of Accounts</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              General ledger account master list and normal balances.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
            <span>View COA</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/cash-transactions" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-sky-500 dark:hover:border-sky-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 rounded-xl w-fit mb-3.5 border border-sky-100 dark:border-sky-900/40 group-hover:scale-105 transition-transform">
              <Landmark className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">Cash Management</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Cash receipts, disbursements, and petty cash vouchers.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-sky-600 dark:text-sky-400">
            <span>Cash Books</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/accounting/periods" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-rose-500 dark:hover:border-rose-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl w-fit mb-3.5 border border-rose-100 dark:border-rose-900/40 group-hover:scale-105 transition-transform">
              <Calendar className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">Accounting Periods</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Fiscal periods, soft/hard close, lock dates, and year-end closing.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-rose-600 dark:text-rose-400">
            <span>Lock & Close</span>
            <span>&rarr;</span>
          </div>
        </Link>
      </div>
    </div>
  );
};

const Accounts = () => {
  const { activeCompany } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showArchiveInbox, setShowArchiveInbox] = useState(false);
  const [archivedAccounts, setArchivedAccounts] = useState<any[]>([]);
  const [journeyAccount, setJourneyAccount] = useState<{ id: string; title: string } | null>(null);
  const [seedingTemplate, setSeedingTemplate] = useState(false);
  const [seedSuccessMessage, setSeedSuccessMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [confirmAccountAction, setConfirmAccountAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'primary';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  const fetchArchivedAccounts = async () => {
    try {
      const data = await apiFetch<any>('/api/master-data/accounts/archived');
      setArchivedAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch (err) {
      console.error('Failed to load archived accounts', err);
    }
  };

  const handlePermanentDeleteArchive = (id: string) => {
    setConfirmAccountAction({
      title: 'Permanently Delete Archived Account',
      message: 'Permanently delete this archived account? This cannot be undone.',
      confirmLabel: 'Permanently Delete',
      variant: 'danger',
      onConfirm: async () => {
        await apiFetch(`/api/master-data/accounts/${id}/permanent`, { method: 'DELETE' });
        setAccountSuccess('Archived account permanently deleted.');
        fetchArchivedAccounts();
        fetchAccounts();
      }
    });
  };

  const handleRestoreArchive = (id: string) => {
    setConfirmAccountAction({
      title: 'Restore Account from Archive',
      message: 'Restore this account from the archive back into the active Chart of Accounts?',
      confirmLabel: 'Restore Account',
      variant: 'primary',
      onConfirm: async () => {
        await apiFetch(`/api/master-data/accounts/${id}/restore`, { method: 'PATCH' });
        setAccountSuccess('Account restored from archive.');
        fetchArchivedAccounts();
        fetchAccounts();
        window.dispatchEvent(new CustomEvent('coa:updated'));
      }
    });
  };

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>('/api/accounting/accounts');
      setAccounts(Array.isArray(data) ? data : (data?.data || []));
    } catch (err: any) {
      setAccounts([]);
      setAccountError(err?.message || 'Failed to load Chart of Accounts.');
    } finally {
      setLoading(false);
    }
  };

  const handleSeedStandardTemplate = async () => {
    setSeedingTemplate(true);
    setSeedSuccessMessage(null);
    setAccountError(null);
    try {
      const res = await apiFetch<any>('/api/master-data/accounts/seed-template', {
        method: 'POST',
      });
      setSeedSuccessMessage(res?.message || 'Standard Philippine COA template loaded successfully.');
      fetchAccounts();
      window.dispatchEvent(new CustomEvent('coa:updated'));
    } catch (err: any) {
      setAccountError(`Failed to load COA template: ${err.message}`);
    } finally {
      setSeedingTemplate(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    const handleCoaUpdated = () => fetchAccounts();
    window.addEventListener('coa:updated', handleCoaUpdated);
    return () => window.removeEventListener('coa:updated', handleCoaUpdated);
  }, [activeCompany?.id]);

  const handleOpenNewModal = () => {
    setSelectedAccount(null);
    setShowModal(true);
  };

  const handleEditAccount = (acc: any) => {
    setSelectedAccount(acc);
    setShowModal(true);
  };

  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const visibleMasterAccounts = safeAccounts.filter(a => {
    const status = (a?.status || 'ACTIVE').toUpperCase();
    return status !== 'ARCHIVED';
  });

  const activeOperationalAccounts = visibleMasterAccounts.filter(a => {
    const status = (a?.status || 'ACTIVE').toUpperCase();
    return status !== 'REMOVED' && status !== 'REMOVED_FROM_LIST';
  });

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: 0 };
    const source = statusFilter === 'REMOVED' ? visibleMasterAccounts : activeOperationalAccounts;
    for (const a of source) {
      const status = (a?.status || 'ACTIVE').toUpperCase();
      if (statusFilter !== 'ALL' && status !== statusFilter) continue;
      counts.ALL += 1;
      const t = (a?.accountType || '').toUpperCase();
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [visibleMasterAccounts, activeOperationalAccounts, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: 0, ACTIVE: 0, INACTIVE: 0, REMOVED: 0, SOFT_DELETED: 0 };
    for (const a of visibleMasterAccounts) {
      if (selectedTypeFilter !== 'ALL' && a?.accountType !== selectedTypeFilter) continue;
      const rawSt = (a?.status || 'ACTIVE').toUpperCase();
      const st = rawSt === 'REMOVED_FROM_LIST' ? 'REMOVED' : rawSt;
      if (st !== 'REMOVED') counts.ALL += 1;
      counts[st] = (counts[st] || 0) + 1;
    }
    return counts;
  }, [visibleMasterAccounts, selectedTypeFilter]);

  const filteredAccounts = visibleMasterAccounts.filter(a => {
    const rawStatus = (a?.status || 'ACTIVE').toUpperCase();
    const status = rawStatus === 'REMOVED_FROM_LIST' ? 'REMOVED' : rawStatus;
    if (statusFilter === 'ALL') {
      if (status === 'REMOVED') return false;
    } else if (status !== statusFilter) {
      return false;
    }

    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      (a?.accountCode || '').toLowerCase().includes(q) ||
      (a?.accountName || '').toLowerCase().includes(q) ||
      (a?.detailType || '').toLowerCase().includes(q) ||
      (a?.birTaxCategory || '').toLowerCase().includes(q);

    if (selectedTypeFilter === 'ALL') return matchesSearch;
    return matchesSearch && a?.accountType === selectedTypeFilter;
  }).sort((a, b) => {
    const statusA = (a?.status || 'ACTIVE').toUpperCase();
    const statusB = (b?.status || 'ACTIVE').toUpperCase();
    if (statusA === 'INACTIVE' && statusB !== 'INACTIVE') return 1;
    if (statusA !== 'INACTIVE' && statusB === 'INACTIVE') return -1;
    return String(a?.accountCode || '').localeCompare(String(b?.accountCode || ''));
  });

  const exportData: ExportData = {
    filename: `Chart_of_Accounts_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Chart of Accounts Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | BIR Compliant General Ledger Accounts`,
    companyName: activeCompany?.legalName || 'Active Company',
    headers: ['Code', 'Account Name', 'Account Type', 'Detail Type', 'BIR Classification', 'Normal Balance', 'GL Balance (PHP)', 'Status'],
    rows: filteredAccounts.map(a => {
      const normalized = inferAccountDetailAndBirCategory(a || {});
      const detailCode = a?.detailType && a.detailType !== '-' ? a.detailType : normalized.detailType;
      const detailDef = getDetailTypeDefinition(a?.accountType || '', detailCode);
      const birCode = (a?.birTaxCategory && a.birTaxCategory !== '-' && a.birTaxCategory !== 'NONE')
        ? a.birTaxCategory
        : normalized.birTaxCategory;
      return [
        a?.accountCode || '',
        a?.accountName || '',
        a?.accountType || '',
        detailDef?.label || detailCode || '-',
        birCode || 'NOT_APPLICABLE',
        a?.normalBalance || '',
        formatCurrency(Number(a?.glBalanceCentavos || 0)),
        a?.status || 'ACTIVE',
      ];
    }),
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 28 },
      3: { cellWidth: 34 },
      4: { cellWidth: 32 },
      5: { cellWidth: 22 },
      6: { cellWidth: 28 },
      7: { cellWidth: 20 },
    },
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ListTree className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Chart of Accounts (COA)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            General ledger master accounts mapped strictly to Philippine BIR Tax & Accounting policy.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ModuleArchiveInbox
            entityTypes={['ACCOUNT']}
            moduleTitle="Chart of Accounts"
            description="Archived General Ledger accounts with 30-day retention, accounting dependency protection, and code-collision-checked restoration."
            onRestored={() => {
              fetchAccounts();
              window.dispatchEvent(new CustomEvent('coa:updated'));
            }}
          />
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={handleOpenNewModal}
            className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Account
          </button>
        </div>
      </div>

      {accountError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{accountError}</span>
          <button type="button" onClick={() => setAccountError(null)} className="underline">Dismiss</button>
        </div>
      )}

      {accountSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{accountSuccess}</span>
          <button type="button" onClick={() => setAccountSuccess(null)} className="underline">Dismiss</button>
        </div>
      )}

      {/* Dedicated Zero-COA Setup Workspace for New Companies */}
      {safeAccounts.length === 0 && !loading && (
        <div data-testid="zero-coa-workspace" className="p-6 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border-2 border-amber-300 dark:border-amber-700 shadow-md">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
                  <ListTree className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-amber-900 dark:text-amber-200">
                  Zero Chart of Accounts Registered for This Company
                </h3>
              </div>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/90 max-w-2xl leading-relaxed">
                This workspace does not have any General Ledger accounts yet. To begin posting journal entries, issuing invoices, recording bills, or reconciling bank accounts, you can create custom accounts manually or load the standard BIR-compliant Philippine Chart of Accounts template.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                onClick={handleOpenNewModal}
                className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-bold border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-xs flex items-center gap-2 cursor-pointer"
                data-testid="zero-coa-add-manual-btn"
              >
                <Plus className="w-4 h-4 text-emerald-600" />
                Add Custom Account
              </button>
              <button
                onClick={handleSeedStandardTemplate}
                disabled={seedingTemplate}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                data-testid="zero-coa-seed-template-btn"
              >
                {seedingTemplate ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Initializing Template...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Load Standard BIR COA Template
                  </>
                )}
              </button>
            </div>
          </div>
          {seedSuccessMessage && (
            <div className="mt-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/40 p-2.5 rounded-xl border border-emerald-300 dark:border-emerald-700">
              ✓ {seedSuccessMessage}
            </div>
          )}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="relative w-full lg:w-56 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search code, name, detail..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 mr-0.5">Filter:</span>
            {['ALL', 'ASSET', 'RECEIVABLE', 'PAYABLE', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedTypeFilter(type)}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 inline-flex items-center gap-1 ${
                  selectedTypeFilter === type
                    ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{type}</span>
                <span className={`text-[10px] font-mono px-1 rounded ${
                  selectedTypeFilter === type
                    ? 'bg-white/20 dark:bg-slate-900/20'
                    : 'bg-slate-200/80 dark:bg-slate-600/80 text-slate-600 dark:text-slate-200'
                }`}>
                  {typeCounts[type] || 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status Filter Bar */}
      <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-x-auto">
        <span className="text-xs font-bold text-slate-400 uppercase shrink-0">Status Filter:</span>
        {[
          { id: 'ALL', label: 'All Operational' },
          { id: 'ACTIVE', label: 'Active' },
          { id: 'INACTIVE', label: 'Inactive' },
          { id: 'REMOVED', label: 'Removed from List' },
          { id: 'SOFT_DELETED', label: 'Soft Deleted' },
        ].map(st => (
          <button
            key={st.id}
            type="button"
            onClick={() => setStatusFilter(st.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 inline-flex items-center gap-1.5 ${
              statusFilter === st.id
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <span>{st.label}</span>
            <span className={`text-[10px] font-mono px-1.5 rounded-md ${
              statusFilter === st.id
                ? 'bg-white/20'
                : 'bg-slate-200/80 dark:bg-slate-600/80 text-slate-600 dark:text-slate-200'
            }`}>
              {statusCounts[st.id] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Table List */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching general ledger accounts...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50/80 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider font-bold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3 pl-4 pr-2">Code</th>
                  <th className="py-3 px-2.5">Account Name</th>
                  <th className="py-3 px-2.5">Type</th>
                  <th className="py-3 px-2.5">Detail Type</th>
                  <th className="py-3 px-2.5">BIR Tax</th>
                  <th className="py-3 px-2 text-center">Normal</th>
                  <th className="py-3 px-2.5 text-right">GL Balance (₱)</th>
                  <th className="py-3 pl-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredAccounts.map((a, idx) => {
                  const statusUpper = (a?.status || 'ACTIVE').toUpperCase();
                  const postedLines = Number(a?.postedLineCount || 0);
                  const glBalCentavos = Number(a?.glBalanceCentavos || 0);
                  return (
                    <tr
                      key={a?.id || `acc-${a?.accountCode || idx}`}
                      onClick={() => handleEditAccount(a)}
                      className="hover:bg-indigo-50/40 dark:hover:bg-slate-700/40 transition-colors cursor-pointer group"
                    >
                      <td className="py-3 pl-4 pr-2 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                        {a?.accountCode || '-'}
                      </td>
                      <td className="py-3 px-2.5 font-semibold text-xs text-slate-800 dark:text-slate-100 max-w-[190px]">
                        {a?.isSubAccount && <span className="text-slate-400 mr-1">└─</span>}
                        <span className="leading-snug">{a?.accountName || '-'}</span>
                        {a?.description && (
                          <span className="block text-[10px] font-normal text-slate-400 line-clamp-1 truncate mt-0.5">
                            {a.description}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 leading-tight">
                          {(a?.accountType || '-').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 max-w-[155px] leading-snug">
                        {(() => {
                          const normalized = inferAccountDetailAndBirCategory(a || {});
                          const detailCode = a?.detailType && a.detailType !== '-' ? a.detailType : normalized.detailType;
                          const detailDef = getDetailTypeDefinition(a?.accountType || '', detailCode);
                          return detailDef?.label || detailCode;
                        })()}
                      </td>
                      <td className="py-3 px-2.5 text-xs whitespace-nowrap">
                        {(() => {
                          const normalized = inferAccountDetailAndBirCategory(a || {});
                          const birCode = (a?.birTaxCategory && a.birTaxCategory !== '-' && a.birTaxCategory !== 'NONE')
                            ? a.birTaxCategory
                            : normalized.birTaxCategory;
                          const birDef = BIR_TAX_CATEGORIES.find(c => c.code === birCode);
                          if (birCode && birCode !== 'NOT_APPLICABLE') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title={birDef?.label || birCode}>
                                {birCode}
                              </span>
                            );
                          }
                          return (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              N/A
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-2 text-center text-xs font-semibold whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          a?.normalBalance === 'DEBIT'
                            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {a?.normalBalance || '-'}
                        </span>
                      </td>
                      <td
                        className="py-3 px-2.5 text-right font-mono text-xs whitespace-nowrap"
                        title={postedLines > 0 ? `${postedLines} posted GL line(s) · DR ${formatCurrency(Number(a?.glDebitCentavos || 0))} / CR ${formatCurrency(Number(a?.glCreditCentavos || 0))}` : 'No posted GL entries yet'}
                      >
                        <div className={`font-bold ${glBalCentavos < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
                          {formatCurrency(glBalCentavos)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-sans">
                          {postedLines > 0 ? `${postedLines} posted ${postedLines === 1 ? 'line' : 'lines'}` : 'No postings'}
                        </div>
                      </td>
                      <td className="py-3 pl-2 pr-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            statusUpper === 'ARCHIVED'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                              : statusUpper === 'INACTIVE' || statusUpper === 'SOFT_DELETED'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}>
                            {statusUpper.replace(/_/g, ' ')}
                          </span>
                          {(statusUpper === 'REMOVED' || statusUpper === 'REMOVED_FROM_LIST' || statusUpper === 'SOFT_DELETED') && (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await apiFetch(`/api/master-data/accounts/${a.id}/status`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ status: 'ACTIVE', reason: 'Restored back to active COA operational list.' }),
                                  });
                                  setAccountSuccess(`Account ${a.accountCode} restored to active list.`);
                                  fetchAccounts();
                                  window.dispatchEvent(new CustomEvent('coa:updated'));
                                } catch (err: any) {
                                  setAccountError(err?.message || 'Failed to restore account to list.');
                                }
                              }}
                              className="px-2 py-1 text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-md inline-flex items-center gap-1 transition-colors"
                              title="Restore account back to active operational list"
                            >
                              Restore to List
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setJourneyAccount({ id: a.id, title: `${a.accountCode} — ${a.accountName}` });
                            }}
                            aria-label={`Open 360 journey for ${a.accountCode} ${a.accountName}`}
                            title="Open 360° Record Journey (Lifecycle Actions, Audit Trail & GL Postings)"
                            className="px-2 py-1 text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 border border-indigo-200 dark:border-indigo-800 rounded-md inline-flex items-center gap-1 transition-colors"
                          >
                            <Activity className="w-3 h-3" /> 360°
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditAccount(a);
                            }}
                            aria-label={`Edit account ${a.accountCode} ${a.accountName}`}
                            className="px-2 py-1 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors inline-flex items-center gap-1 text-[11px] font-semibold"
                          >
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredAccounts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      {safeAccounts.length === 0 ? (
                        <div className="space-y-1.5">
                          <p className="font-semibold text-slate-600 dark:text-slate-300">No General Ledger accounts exist in this company yet.</p>
                          <p className="text-xs text-slate-400">Use the setup workspace above to load the standard BIR template or create custom accounts.</p>
                        </div>
                      ) : (
                        'No matching accounts found for the current search query or filter.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Account Modal */}
      <AccountModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={() => {
          fetchAccounts();
        }}
        existingAccount={selectedAccount}
        accountsList={safeAccounts}
      />

      {journeyAccount && (
        <RecordActivityModal
          isOpen={!!journeyAccount}
          onClose={() => setJourneyAccount(null)}
          entityType="ACCOUNT"
          entityId={journeyAccount.id}
          title={journeyAccount.title}
          onActionSuccess={() => {
            fetchAccounts();
            window.dispatchEvent(new CustomEvent('coa:updated'));
          }}
        />
      )}

      {/* Inline Account Action Confirmation Modal */}
      {confirmAccountAction && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{confirmAccountAction.title}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{confirmAccountAction.message}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={confirmActionLoading}
                onClick={() => setConfirmAccountAction(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmActionLoading}
                onClick={async () => {
                  setConfirmActionLoading(true);
                  setAccountError(null);
                  try {
                    await confirmAccountAction.onConfirm();
                    setConfirmAccountAction(null);
                  } catch (err: any) {
                    setAccountError(err?.message || 'Action failed');
                    setConfirmAccountAction(null);
                  } finally {
                    setConfirmActionLoading(false);
                  }
                }}
                className={`px-4 py-2 text-xs font-bold text-white rounded-lg disabled:opacity-50 ${
                  confirmAccountAction.variant === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {confirmActionLoading ? 'Processing...' : confirmAccountAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Note: PurchaseBills is imported from modular ./accounting/PurchaseBills

const CashTransactions = () => {
  const { activeCompany } = useAuth();
  const [activeTab, setActiveTab] = useState<'TXNS' | 'CHECKS' | 'DEPOSITS' | 'CASHBOOK'>('TXNS');
  const [txns, setTxns] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [cashbookData, setCashbookData] = useState<any | null>(null);
  const [selectedCashAccountId, setSelectedCashAccountId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showIssueCheckModal, setShowIssueCheckModal] = useState(false);
  const [showCreateDepositModal, setShowCreateDepositModal] = useState(false);
  const [newTxn, setNewTxn] = useState({
    accountId: '',
    type: 'RECEIPT',
    amount: 0,
    offsetAccountId: '',
    transactionDate: new Date().toISOString().slice(0, 10),
    reference: '',
    description: ''
  });
  const [newCheck, setNewCheck] = useState({
    checkNumber: '',
    checkDate: new Date().toISOString().slice(0, 10),
    payeeName: '',
    cashAccountId: '',
    amountPhp: '',
    voucherNumber: '',
    notes: ''
  });
  const [newDeposit, setNewDeposit] = useState({
    depositNumber: '',
    depositDate: new Date().toISOString().slice(0, 10),
    toBankAccountId: '',
    fromCashAccountId: '',
    totalAmountPhp: '',
    reference: '',
    notes: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [bankRegistryAccounts, setBankRegistryAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [dateFilterMode, setDateFilterMode] = useState<'RECENT_1_MONTH' | 'ALL'>('ALL');
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  const cashBankDropdownOptions = useMemo(() => {
    return (accounts || [])
      .filter((a: any) => ['ASSET', 'BANK', 'CASH'].includes((a.accountType || '').toUpperCase()) || ['1010', '1020'].includes(a.accountCode))
      .map((a: any) => ({
        value: a.id,
        label: `${a.accountCode} - ${a.accountName}`
      }));
  }, [accounts]);

  const sourceCashAccounts = useMemo(() => filterEligibleSourceCashAccounts(accounts), [accounts]);
  const destinationBankAccounts = useMemo(
    () => filterEligibleDestinationBankAccounts(accounts, bankRegistryAccounts),
    [accounts, bankRegistryAccounts]
  );
  const cashAccounts = sourceCashAccounts;
  const postableAccounts = useMemo(() => filterPostableLeafAccounts(accounts), [accounts]);

  const fetchAllTreasuryData = async () => {
    setLoading(true);
    try {
      const [txnRes, chkRes, depRes] = await Promise.all([
        fetch('/api/accounting/cash-transactions?raw=true'),
        fetch('/api/accounting/checks'),
        fetch('/api/accounting/bank-deposits')
      ]);
      if (txnRes.ok) {
        const d = await txnRes.json();
        setTxns(Array.isArray(d) ? d : d?.data || []);
      }
      if (chkRes.ok) {
        const c = await chkRes.json();
        setChecks(Array.isArray(c) ? c : []);
      }
      if (depRes.ok) {
        const dep = await depRes.json();
        setDeposits(Array.isArray(dep) ? dep : []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchCashbookForAccount = async (accId: string) => {
    if (!accId) return;
    try {
      const res = await fetch(`/api/accounting/cashbook?cashAccountId=${encodeURIComponent(accId)}&startDate=2026-01-01&endDate=2026-12-31`);
      if (res.ok) {
        const data = await res.json();
        setCashbookData(data);
      }
    } catch {
      // ignore
    }
  };

  const fetchCoaAndBankAccounts = async (initializeSelections = false) => {
    setAccountsLoading(true);
    try {
      const [accRaw, bankRaw] = await Promise.all([
        apiFetch<any>('/api/master-data/accounts?raw=true').catch(() => []),
        apiFetch<any>('/api/banking/accounts').catch(() => [])
      ]);
      const list = Array.isArray(accRaw) ? accRaw : accRaw?.data || [];
      const bankList = Array.isArray(bankRaw) ? bankRaw : bankRaw?.accounts || bankRaw?.data || [];
      setAccounts(list);
      setBankRegistryAccounts(bankList);

      const eligibleSource = filterEligibleSourceCashAccounts(list);
      const eligibleDest = filterEligibleDestinationBankAccounts(list, bankList);
      const primaryCash = eligibleDest[0] || eligibleSource[0];
      const defaultDestBank = eligibleDest[0];
      const defaultSourceCash =
        eligibleSource.find((s: any) => s.id !== defaultDestBank?.id && !isStrictBankAccount(s)) ||
        eligibleSource.find((s: any) => s.id !== defaultDestBank?.id) ||
        null;

      if (initializeSelections || !selectedCashAccountId) {
        if (primaryCash) {
          setSelectedCashAccountId((prev) => prev || primaryCash.id);
          setNewTxn((prev) => ({ ...prev, accountId: prev.accountId || primaryCash.id }));
          fetchCashbookForAccount(primaryCash.id);
        }
        if (defaultDestBank) {
          setNewCheck((prev) => ({ ...prev, cashAccountId: prev.cashAccountId || defaultDestBank.id }));
          setNewDeposit((prev) => ({
            ...prev,
            toBankAccountId: prev.toBankAccountId || defaultDestBank.id,
            fromCashAccountId: prev.fromCashAccountId || (defaultSourceCash?.id || '')
          }));
        }
      }
    } catch {
      setAccounts([]);
      setBankRegistryAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllTreasuryData();
    fetchCoaAndBankAccounts(true);
    const handleCoaUpdated = () => fetchCoaAndBankAccounts(false);
    window.addEventListener('coa:updated', handleCoaUpdated);
    return () => window.removeEventListener('coa:updated', handleCoaUpdated);
  }, [activeCompany?.id]);

  const handleCreateTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const centavos = Math.round(newTxn.amount * 100);
      const payload: any = {
        accountId: newTxn.accountId,
        type: newTxn.type,
        amount: centavos,
        transactionDate: newTxn.transactionDate,
        reference: newTxn.reference,
        description: newTxn.description,
        lines: newTxn.offsetAccountId ? [{
          accountId: newTxn.offsetAccountId,
          amount: centavos,
          description: newTxn.description || `Cash transaction ${newTxn.reference}`
        }] : []
      };
      const res = await fetch('/api/accounting/cash-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreateModal(false);
        setNewTxn({
          accountId: selectedCashAccountId || '',
          offsetAccountId: '',
          type: 'RECEIPT',
          amount: 0,
          transactionDate: new Date().toISOString().slice(0, 10),
          reference: '',
          description: ''
        });
        setBanner({ type: 'success', message: 'Cash transaction created in DRAFT status.' });
        fetchAllTreasuryData();
      } else {
        setError(data.message || 'Failed to create cash transaction.');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating cash transaction.');
    }
  };

  const handleTxnWorkflow = async (id: string, action: 'submit' | 'approve' | 'post' | 'reject') => {
    setProcessingId(id);
    setBanner(null);
    try {
      const res = await fetch(`/api/accounting/cash-transactions/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { reason: 'Returned to draft by reviewer' } : {})
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ type: 'success', message: data.message || `Cash transaction ${action} succeeded.` });
        await fetchAllTreasuryData();
        if (selectedCashAccountId) fetchCashbookForAccount(selectedCashAccountId);
      } else {
        setBanner({ type: 'error', message: data.message || `Failed to ${action} transaction.` });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || `Failed to ${action} transaction.` });
    } finally {
      setProcessingId(null);
    }
  };

  const handleIssueCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/accounting/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkNumber: newCheck.checkNumber,
          checkDate: newCheck.checkDate,
          payeeName: newCheck.payeeName,
          cashAccountId: newCheck.cashAccountId,
          amount: Math.round((parseFloat(newCheck.amountPhp) || 0) * 100),
          voucherNumber: newCheck.voucherNumber,
          notes: newCheck.notes
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowIssueCheckModal(false);
        setNewCheck({
          checkNumber: '',
          checkDate: new Date().toISOString().slice(0, 10),
          payeeName: '',
          cashAccountId: selectedCashAccountId || '',
          amountPhp: '',
          voucherNumber: '',
          notes: ''
        });
        setBanner({ type: 'success', message: 'Check issued and logged in Check Register.' });
        fetchAllTreasuryData();
      } else {
        setError(data.message || 'Failed to issue check.');
      }
    } catch (err: any) {
      setError(err.message || 'Error issuing check.');
    }
  };

  const handleClearCheck = async (checkId: string) => {
    setProcessingId(checkId);
    setBanner(null);
    try {
      const res = await fetch(`/api/accounting/checks/${checkId}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearedDate: new Date().toISOString().slice(0, 10) })
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ type: 'success', message: data.message || 'Check marked as CLEARED.' });
        fetchAllTreasuryData();
      } else {
        setBanner({ type: 'error', message: data.message || 'Failed to clear check.' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Error clearing check.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleBounceCheck = async (checkId: string) => {
    setProcessingId(checkId);
    setBanner(null);
    try {
      const res = await fetch(`/api/accounting/checks/${checkId}/bounce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Returned NSF / Bounced by depository bank' })
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ type: 'success', message: data.message || 'Check marked as BOUNCED.' });
        fetchAllTreasuryData();
      } else {
        setBanner({ type: 'error', message: data.message || 'Failed to mark check as bounced.' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Error marking check as bounced.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancelCheck = async (checkId: string) => {
    setProcessingId(checkId);
    setBanner(null);
    try {
      const res = await fetch(`/api/accounting/checks/${checkId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Voided / Cancelled in Check Register' })
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ type: 'success', message: data.message || 'Check voided/cancelled.' });
        fetchAllTreasuryData();
      } else {
        setBanner({ type: 'error', message: data.message || 'Failed to void/cancel check.' });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Error voiding/cancelling check.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/accounting/bank-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositNumber: newDeposit.depositNumber || `DEP-${Date.now().toString().slice(-6)}`,
          depositDate: newDeposit.depositDate,
          toBankAccountId: newDeposit.toBankAccountId,
          fromCashAccountId: newDeposit.fromCashAccountId,
          totalAmount: Math.round((parseFloat(newDeposit.totalAmountPhp) || 0) * 100),
          reference: newDeposit.reference,
          notes: newDeposit.notes
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreateDepositModal(false);
        setBanner({ type: 'success', message: 'Bank deposit batch created.' });
        fetchAllTreasuryData();
      } else {
        setError(data.message || 'Failed to create bank deposit.');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating bank deposit.');
    }
  };

  const handleDepositWorkflow = async (id: string, action: 'submit' | 'approve' | 'reject' | 'post') => {
    setProcessingId(id);
    setBanner(null);
    try {
      const res = await fetch(`/api/accounting/bank-deposits/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { reason: 'Returned to draft by reviewer' } : {})
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ type: 'success', message: data.message || `Bank deposit ${action} completed.` });
        fetchAllTreasuryData();
      } else {
        setBanner({ type: 'error', message: data.message || `Failed to ${action} bank deposit.` });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || `Error during deposit ${action}.` });
    } finally {
      setProcessingId(null);
    }
  };

  const safeTxns = Array.isArray(txns) ? txns : [];
  const filteredTxns = safeTxns
    .filter((t) => {
      if (selectedAccountId && selectedAccountId !== 'ALL' && t.cashAccountId !== selectedAccountId) {
        return false;
      }
      const txnDate = (t?.transactionDate || t?.createdAt || '').slice(0, 10);
      if (fromDate && txnDate && txnDate < fromDate) return false;
      if (toDate && txnDate && txnDate > toDate) return false;
      if (dateFilterMode === 'RECENT_1_MONTH' && !fromDate && !toDate) {
        if (!isIsoDateInRecentOneMonth(t?.transactionDate || t?.createdAt)) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (t?.transactionNumber || '').toLowerCase().includes(q) ||
        (t?.type || '').toLowerCase().includes(q) ||
        (t?.description || '').toLowerCase().includes(q) ||
        (t?.status || '').toLowerCase().includes(q) ||
        (t?.accountCode || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dateA = new Date(a.transactionDate || a.createdAt || 0).getTime();
      const dateB = new Date(b.transactionDate || b.createdAt || 0).getTime();
      return sortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
    });

  const filteredChecks = (Array.isArray(checks) ? checks : [])
    .filter((c) => {
      if (selectedAccountId && selectedAccountId !== 'ALL' && c.bankAccountId !== selectedAccountId) {
        return false;
      }
      const chkDate = (c?.checkDate || c?.createdAt || '').slice(0, 10);
      if (fromDate && chkDate && chkDate < fromDate) return false;
      if (toDate && chkDate && chkDate > toDate) return false;
      if (dateFilterMode === 'RECENT_1_MONTH' && !fromDate && !toDate) {
        if (!isIsoDateInRecentOneMonth(c?.checkDate || c?.createdAt)) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (c?.checkNumber || '').toLowerCase().includes(q) ||
        (c?.payeeName || '').toLowerCase().includes(q) ||
        (c?.voucherNumber || '').toLowerCase().includes(q) ||
        (c?.status || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dateA = new Date(a.checkDate || a.createdAt || 0).getTime();
      const dateB = new Date(b.checkDate || b.createdAt || 0).getTime();
      return sortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
    });

  const filteredDeposits = (Array.isArray(deposits) ? deposits : [])
    .filter((d) => {
      if (selectedAccountId && selectedAccountId !== 'ALL' && d.bankAccountId !== selectedAccountId) {
        return false;
      }
      const depDate = (d?.depositDate || d?.createdAt || '').slice(0, 10);
      if (fromDate && depDate && depDate < fromDate) return false;
      if (toDate && depDate && depDate > toDate) return false;
      if (dateFilterMode === 'RECENT_1_MONTH' && !fromDate && !toDate) {
        if (!isIsoDateInRecentOneMonth(d?.depositDate || d?.createdAt)) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (d?.depositNumber || '').toLowerCase().includes(q) ||
        (d?.reference || '').toLowerCase().includes(q) ||
        (d?.status || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dateA = new Date(a.depositDate || a.createdAt || 0).getTime();
      const dateB = new Date(b.depositDate || b.createdAt || 0).getTime();
      return sortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
    });

  const activeList =
    activeTab === 'TXNS' ? filteredTxns : activeTab === 'CHECKS' ? filteredChecks : filteredDeposits;
  const paginatedItems = activeList.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const exportData: ExportData = {
    filename: `Cash_Treasury_${activeTab}_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Cash & Check Management Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Tab: ${activeTab}`,
    companyName: activeCompany?.legalName || 'Deskguard Solutions Inc.',
    headers: ['Date', 'Reference #', 'Type / Payee', 'Description / Voucher', 'Amount (PHP)', 'Status'],
    rows: safeTxns.map((t) => [
      t?.transactionDate || '-',
      t?.transactionNumber || '',
      t?.type || '',
      t?.description || '-',
      ((t?.totalAmount || 0) / 100).toFixed(2),
      t?.status || 'POSTED'
    ])
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Cash & Check Management Workspace
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Cash receipts & disbursements, corporate check register, bank deposit batches, and live GL Cashbook reconciliation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <ModuleArchiveInbox
            entityTypes={['CASH_TRANSACTION', 'CHECK', 'BANK_DEPOSIT', 'CASH_COUNT']}
            moduleTitle="Cash & Check Management"
            description="Archived cash vouchers, checks, bank deposits, and cash counts with 30-day retention."
            onRestored={fetchAllTreasuryData}
          />
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => {
              fetchCoaAndBankAccounts(false);
              setError(null);
              setShowCreateModal(true);
            }}
            className="bg-indigo-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> New Cash Txn
          </button>
          <button
            onClick={() => {
              fetchCoaAndBankAccounts(false);
              setError(null);
              setShowIssueCheckModal(true);
            }}
            className="bg-slate-800 dark:bg-slate-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-slate-900 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Issue Check
          </button>
          <button
            onClick={() => {
              fetchCoaAndBankAccounts(false);
              setError(null);
              setShowCreateDepositModal(true);
            }}
            className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> New Bank Deposit
          </button>
        </div>
      </div>

      {banner && (
        <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
          banner.type === 'error'
            ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
            : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
        }`}>
          <span>{banner.message}</span>
          <button type="button" onClick={() => setBanner(null)} className="underline ml-3">Dismiss</button>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700">
          {[
            { id: 'TXNS', label: `Cash Receipts & Disbursements (${safeTxns.length})` },
            { id: 'CHECKS', label: `Check Register (${checks.length})` },
            { id: 'DEPOSITS', label: `Bank Deposits (${deposits.length})` },
            { id: 'CASHBOOK', label: 'Cashbook & GL Proof' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as any);
                setPageIndex(0);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
      </div>

      {activeTab !== 'CASHBOOK' && (
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
          entityLabel="Account"
          selectedEntityId={selectedAccountId}
          entityOptions={cashBankDropdownOptions}
          onEntityChange={(aId) => {
            setSelectedAccountId(aId);
            setPageIndex(0);
          }}
          searchQuery={searchQuery}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setPageIndex(0);
          }}
          searchPlaceholder="Search number, payee, reference, status..."
          filteredCount={activeList.length}
          pageSize={pageSize}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPageIndex(0);
          }}
          onResetFilters={() => {
            setSortOrder('DESC');
            setDatePeriod('ALL');
            setDateFilterMode('ALL');
            setFromDate('');
            setToDate('');
            setSelectedAccountId('ALL');
            setSearchQuery('');
            setPageIndex(0);
          }}
        />
      )}
      </div>

      {/* Tab Content */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading treasury records...
          </div>
        ) : activeTab === 'TXNS' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[950px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Transaction #</th>
                    <th className="py-3.5 px-4">Cash Account</th>
                    <th className="py-3.5 px-4">Type</th>
                    <th className="py-3.5 px-4">Description</th>
                    <th className="py-3.5 px-4 text-right">Amount</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {paginatedItems.map((t: any, idx: number) => (
                    <tr key={t?.id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-500">{t?.transactionDate || '-'}</td>
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        {t?.transactionNumber || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t?.accountCode
                          ? `${t.accountCode} — ${t.accountName}`
                          : (() => {
                              const resolved = accounts.find((a) => a.id === t?.cashAccountId);
                              return resolved ? `${resolved.accountCode} — ${resolved.accountName}` : t?.cashAccountId || 'Unlinked Account';
                            })()}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-semibold">{t?.type || '-'}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100 truncate max-w-[220px]">
                        {t?.description || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-cyan-600 dark:text-cyan-400">
                        {formatCurrency(t?.totalAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <StatusBadge status={t?.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {t?.status === 'DRAFT' && (
                            <button
                              type="button"
                              disabled={processingId === t.id}
                              onClick={() => handleTxnWorkflow(t.id, 'submit')}
                              className="px-2.5 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {processingId === t.id ? 'Working...' : 'Submit'}
                            </button>
                          )}
                          {t?.status === 'SUBMITTED' && (
                            <>
                              <button
                                type="button"
                                disabled={processingId === t.id}
                                onClick={() => handleTxnWorkflow(t.id, 'approve')}
                                className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {processingId === t.id ? 'Working...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                disabled={processingId === t.id}
                                onClick={() => handleTxnWorkflow(t.id, 'reject')}
                                className="px-2 py-1 bg-rose-50 text-rose-700 text-xs font-semibold rounded-lg hover:bg-rose-100 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {t?.status === 'APPROVED' && (
                            <button
                              type="button"
                              disabled={processingId === t.id}
                              onClick={() => handleTxnWorkflow(t.id, 'post')}
                              className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {processingId === t.id ? 'Posting...' : 'Post to GL'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setJourneyTarget({
                                entityType: 'CASH_TRANSACTION',
                                entityId: t.id,
                                title: `Cash Transaction — ${t.transactionNumber}`
                              })
                            }
                            className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1"
                          >
                            <Activity className="w-3.5 h-3.5" /> 360° Journey
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        No cash transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalCount={filteredTxns.length}
              itemCount={paginatedItems.length}
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(pageIndex + 1) * pageSize < filteredTxns.length}
              onNextPage={() => setPageIndex((p) => p + 1)}
              onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredTxns.length / pageSize) - 1))}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPageIndex(0);
              }}
              loading={loading}
            />
          </>
        ) : activeTab === 'CHECKS' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[900px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3.5 px-4">Check Date</th>
                    <th className="py-3.5 px-4">Check #</th>
                    <th className="py-3.5 px-4">Payee Name</th>
                    <th className="py-3.5 px-4">Voucher #</th>
                    <th className="py-3.5 px-4">Bank Account</th>
                    <th className="py-3.5 px-4 text-right">Amount</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {paginatedItems.map((chk: any) => (
                    <tr key={chk.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                      <td className="py-3.5 px-4 text-xs font-mono">{chk.checkDate}</td>
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">{chk.checkNumber}</td>
                      <td className="py-3.5 px-4 text-xs font-semibold text-slate-800 dark:text-slate-100">{chk.payeeName}</td>
                      <td className="py-3.5 px-4 text-xs font-mono">{chk.voucherNumber || '-'}</td>
                      <td className="py-3.5 px-4 text-xs">
                        {chk.accountCode ? `${chk.accountCode} — ${chk.accountName}` : chk.cashAccountId}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold">{formatCurrency(chk.amount)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <StatusBadge status={chk.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {chk.status === 'ISSUED' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleClearCheck(chk.id)}
                                className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
                              >
                                Mark Cleared
                              </button>
                              <button
                                type="button"
                                onClick={() => handleBounceCheck(chk.id)}
                                className="px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold rounded-lg hover:bg-amber-100"
                              >
                                Bounce
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelCheck(chk.id)}
                                className="px-2 py-1 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg hover:bg-rose-100"
                              >
                                Void
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setJourneyTarget({
                                entityType: 'CHECK',
                                entityId: chk.id,
                                title: `Corporate Check #${chk.checkNumber} — ${chk.payeeName}`
                              })
                            }
                            className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1"
                          >
                            <Activity className="w-3.5 h-3.5" /> 360° Journey
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalCount={filteredChecks.length}
              itemCount={paginatedItems.length}
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(pageIndex + 1) * pageSize < filteredChecks.length}
              onNextPage={() => setPageIndex((p) => p + 1)}
              onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredChecks.length / pageSize) - 1))}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPageIndex(0);
              }}
              loading={loading}
            />
          </>
        ) : activeTab === 'DEPOSITS' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[900px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3.5 px-4">Deposit Date</th>
                    <th className="py-3.5 px-4">Deposit #</th>
                    <th className="py-3.5 px-4">Destination Bank</th>
                    <th className="py-3.5 px-4">Bank Slip Ref</th>
                    <th className="py-3.5 px-4 text-right">Amount</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {paginatedItems.map((dep: any) => (
                    <tr key={dep.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                      <td className="py-3.5 px-4 text-xs font-mono">{dep.depositDate}</td>
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">{dep.depositNumber}</td>
                      <td className="py-3.5 px-4 text-xs">
                        {dep.toBankAccountCode ? `${dep.toBankAccountCode} — ${dep.toBankAccountName}` : dep.toBankAccountId}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono">{dep.reference || '-'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold">{formatCurrency(dep.totalAmount)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <StatusBadge status={dep.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {dep.status === 'DRAFT' && (
                            <button
                              type="button"
                              disabled={processingId === dep.id}
                              onClick={() => handleDepositWorkflow(dep.id, 'submit')}
                              className="px-2.5 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {processingId === dep.id ? 'Working...' : 'Submit'}
                            </button>
                          )}
                          {dep.status === 'SUBMITTED' && (
                            <>
                              <button
                                type="button"
                                disabled={processingId === dep.id}
                                onClick={() => handleDepositWorkflow(dep.id, 'approve')}
                                className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                              >
                                {processingId === dep.id ? 'Working...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                disabled={processingId === dep.id}
                                onClick={() => handleDepositWorkflow(dep.id, 'reject')}
                                className="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg hover:bg-rose-100 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {dep.status === 'APPROVED' && (
                            <button
                              type="button"
                              disabled={processingId === dep.id}
                              onClick={() => handleDepositWorkflow(dep.id, 'post')}
                              className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {processingId === dep.id ? 'Posting...' : 'Post to GL'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setJourneyTarget({
                                entityType: 'BANK_DEPOSIT',
                                entityId: dep.id,
                                title: `Bank Deposit ${dep.depositNumber}`
                              })
                            }
                            className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1"
                          >
                            <Activity className="w-3.5 h-3.5" /> 360° Journey
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalCount={filteredDeposits.length}
              itemCount={paginatedItems.length}
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(pageIndex + 1) * pageSize < filteredDeposits.length}
              onNextPage={() => setPageIndex((p) => p + 1)}
              onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
              onFirstPage={() => setPageIndex(0)}
              onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredDeposits.length / pageSize) - 1))}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPageIndex(0);
              }}
              loading={loading}
            />
          </>
        ) : (
          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold uppercase text-slate-500">Cash/Bank Account:</label>
                <select
                  value={selectedCashAccountId}
                  onChange={(e) => {
                    setSelectedCashAccountId(e.target.value);
                    fetchCashbookForAccount(e.target.value);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900"
                >
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountCode} — {a.accountName}
                    </option>
                  ))}
                </select>
              </div>
              {cashbookData && (
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    Opening Balance: <strong className="font-mono">{formatCurrency(cashbookData.openingBalance)}</strong>
                  </div>
                  <div>
                    Closing GL Cash Balance: <strong className="font-mono text-emerald-600">{formatCurrency(cashbookData.closingBalance)}</strong>
                  </div>
                </div>
              )}
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden max-h-[460px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 uppercase sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Journal #</th>
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-right">Cash In (Debit)</th>
                    <th className="py-2.5 px-3 text-right">Cash Out (Credit)</th>
                    <th className="py-2.5 px-3 text-right">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {(cashbookData?.transactions || cashbookData?.entries || []).slice(-100).map((entry: any) => (
                    <tr key={entry.id}>
                      <td className="py-2 px-3 font-mono">{entry.transactionDate || entry.date}</td>
                      <td className="py-2 px-3 font-mono font-bold text-indigo-600">{entry.reference || entry.journalNumber}</td>
                      <td className="py-2 px-3">{entry.type || entry.sourceType || 'GL'}</td>
                      <td className="py-2 px-3 truncate max-w-[260px]">{entry.description}</td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-600">
                        {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-rose-600">
                        {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(entry.runningBalance ?? entry.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create Cash Transaction Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Create Cash Transaction</h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleCreateTxn} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Cash / Bank Account</label>
                <select
                  required
                  value={newTxn.accountId}
                  onChange={(e) => setNewTxn({ ...newTxn, accountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select a cash/bank account...</option>
                  {sourceCashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a, true)}
                    </option>
                  ))}
                </select>
                {!accountsLoading && cashAccounts.length === 0 && (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                    No eligible Cash/Bank accounts found. Configure a Cash/Bank account in Chart of Accounts or Bank Account Management.{' '}
                    <Link to="/accounting/accounts" onClick={() => setShowCreateModal(false)} className="font-bold underline hover:text-amber-950 dark:hover:text-white">
                      Go to Chart of Accounts &rarr;
                    </Link>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Offset / Counterparty GL Account</label>
                <select
                  value={newTxn.offsetAccountId}
                  onChange={(e) => setNewTxn({ ...newTxn, offsetAccountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Auto-resolve from Account Role / Mapping</option>
                  {postableAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountCode} - {a.accountName} ({a.accountType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Transaction Type</label>
                  <select
                    value={newTxn.type}
                    onChange={(e) => setNewTxn({ ...newTxn, type: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="RECEIPT">RECEIPT</option>
                    <option value="DISBURSEMENT">DISBURSEMENT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={newTxn.amount || ''}
                    onChange={(e) => setNewTxn({ ...newTxn, amount: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={newTxn.transactionDate}
                    onChange={(e) => setNewTxn({ ...newTxn, transactionDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Reference No.</label>
                  <input
                    type="text"
                    required
                    value={newTxn.reference}
                    onChange={(e) => setNewTxn({ ...newTxn, reference: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  required
                  value={newTxn.description}
                  onChange={(e) => setNewTxn({ ...newTxn, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg">
                  Create Txn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Check Modal */}
      {showIssueCheckModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Issue Corporate Check</h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleIssueCheck} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Corporate Bank Account</label>
                <select
                  required
                  value={newCheck.cashAccountId}
                  onChange={(e) => setNewCheck({ ...newCheck, cashAccountId: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select Corporate Bank Account...</option>
                  {destinationBankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.displayLabel}
                    </option>
                  ))}
                </select>
                {destinationBankAccounts.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    No active Bank accounts configured.{' '}
                    <Link to="/accounting/accounts" onClick={() => setShowIssueCheckModal(false)} className="font-bold underline">
                      Configure a Bank account in COA →
                    </Link>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Check Number</label>
                  <input
                    type="text"
                    required
                    placeholder="0000800105"
                    value={newCheck.checkNumber}
                    onChange={(e) => setNewCheck({ ...newCheck, checkNumber: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Check Date</label>
                  <input
                    type="date"
                    required
                    value={newCheck.checkDate}
                    onChange={(e) => setNewCheck({ ...newCheck, checkDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Payee Name</label>
                <input
                  type="text"
                  required
                  value={newCheck.payeeName}
                  onChange={(e) => setNewCheck({ ...newCheck, payeeName: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (PHP)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newCheck.amountPhp}
                    onChange={(e) => setNewCheck({ ...newCheck, amountPhp: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Check Voucher #</label>
                  <input
                    type="text"
                    value={newCheck.voucherNumber}
                    onChange={(e) => setNewCheck({ ...newCheck, voucherNumber: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowIssueCheckModal(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg">
                  Issue Check
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Bank Deposit Modal */}
      {showCreateDepositModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Create Bank Deposit Batch</h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleCreateDeposit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Destination Bank Account</label>
                  <select
                    required
                    value={newDeposit.toBankAccountId}
                    onChange={(e) => setNewDeposit({ ...newDeposit, toBankAccountId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="">Select Destination Bank...</option>
                    {destinationBankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.displayLabel}
                      </option>
                    ))}
                  </select>
                  {!accountsLoading && destinationBankAccounts.length === 0 && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      No active Bank accounts found.{' '}
                      <Link to="/accounting/accounts" onClick={() => setShowCreateDepositModal(false)} className="font-bold underline">
                        Add Bank account in COA →
                      </Link>
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Source Cash Account</label>
                  <select
                    required
                    value={newDeposit.fromCashAccountId}
                    onChange={(e) => setNewDeposit({ ...newDeposit, fromCashAccountId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="">Select Source Cash...</option>
                    {sourceCashAccounts.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.id === newDeposit.toBankAccountId}>
                        {formatAccountOptionLabel(a)}
                      </option>
                    ))}
                  </select>
                  {!accountsLoading && sourceCashAccounts.length === 0 && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      No active Cash/Bank accounts found.{' '}
                      <Link to="/accounting/accounts" onClick={() => setShowCreateDepositModal(false)} className="font-bold underline">
                        Configure Cash account in COA →
                      </Link>
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Deposit Date</label>
                  <input
                    type="date"
                    required
                    value={newDeposit.depositDate}
                    onChange={(e) => setNewDeposit({ ...newDeposit, depositDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (PHP)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newDeposit.totalAmountPhp}
                    onChange={(e) => setNewDeposit({ ...newDeposit, totalAmountPhp: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Bank Validated Deposit Reference</label>
                <input
                  type="text"
                  required
                  value={newDeposit.reference}
                  onChange={(e) => setNewDeposit({ ...newDeposit, reference: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateDepositModal(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg">
                  Create Deposit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={() => fetchAllTreasuryData()}
        />
      )}
    </div>
  );
};

const AccountingPeriods = () => {
  const { userRole, permissions, activeCompany } = useAuth();
  const canEdit =
    userRole === 'Company Owner' ||
    userRole === 'Company Administrator' ||
    userRole === 'Accountant' ||
    (Array.isArray(permissions) && permissions.includes('accounting:edit'));
  const canApprove =
    userRole === 'Company Owner' ||
    userRole === 'Company Administrator' ||
    (Array.isArray(permissions) && permissions.includes('accounting:approve'));

  const [periods, setPeriods] = useState<any[]>([]);
  const [lockDate, setLockDate] = useState<string>('');
  const [savedLockDate, setSavedLockDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedPeriodId, setBlockedPeriodId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', startDate: '', endDate: '', fiscalYear: new Date().getFullYear() });

  const [reopenModalPeriod, setReopenModalPeriod] = useState<any | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const [historyModalPeriod, setHistoryModalPeriod] = useState<any | null>(null);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);

  const [workspaceModal, setWorkspaceModal] = useState<{
    periodId: string;
    initialTab: 'OVERVIEW' | 'CHECKLIST' | 'EXECUTE' | 'CERTIFICATIONS' | 'HISTORY' | 'POLICY';
  } | null>(null);

  // Year-End Close Modal State
  const [showYearEndModal, setShowYearEndModal] = useState(false);
  const [yearEndFiscalYear, setYearEndFiscalYear] = useState<number>(new Date().getFullYear());
  const [equityAccounts, setEquityAccounts] = useState<any[]>([]);
  const [retainedEarningsAccountId, setRetainedEarningsAccountId] = useState<string>('');
  const [yearEndSubmitting, setYearEndSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pData, lData] = await Promise.all([
        apiFetch<any[]>('/api/accounting/periods'),
        apiFetch<{ lockDate: string | null }>('/api/accounting/lock-date'),
      ]);
      setPeriods(Array.isArray(pData) ? pData : []);
      const activeLock = lData?.lockDate || '';
      setLockDate(activeLock);
      setSavedLockDate(activeLock);
    } catch (err: any) {
      setError(err?.message || 'Failed to load accounting periods.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeCompany?.id]);

  const handleOpenYearEndModal = async () => {
    setError(null);
    setBlockedPeriodId(null);
    setShowYearEndModal(true);
    try {
      const allAccs = await apiFetch<any[]>('/api/accounting/accounts');
      const eq = (Array.isArray(allAccs) ? allAccs : []).filter(
        (a: any) => String(a?.accountType || '').toUpperCase() === 'EQUITY' && String(a?.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
      );
      setEquityAccounts(eq);
      const preferred = eq.find((a: any) =>
        String(a?.accountName || '').toLowerCase().includes('retained earnings') ||
        String(a?.detailType || '').toUpperCase().includes('RETAINED')
      ) || eq[0];
      if (preferred) setRetainedEarningsAccountId(preferred.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Equity accounts for Year-End Close.');
    }
  };

  const handleExecuteYearEndClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retainedEarningsAccountId) {
      setError('Please select a Retained Earnings Equity account before executing Year-End Close.');
      return;
    }
    setYearEndSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<any>('/api/accounting/year-end-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fiscalYear: Number(yearEndFiscalYear),
          retainedEarningsAccountId,
        }),
      });
      setSuccessMsg(res?.message || `Fiscal Year ${yearEndFiscalYear} Year-End Close completed successfully.`);
      setShowYearEndModal(false);
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Year-End Close failed.');
    } finally {
      setYearEndSubmitting(false);
    }
  };

  const handleUpdateLockDate = async (overrideDate?: string | null) => {
    setError(null);
    setBlockedPeriodId(null);
    setSuccessMsg(null);
    const targetLockDate = overrideDate !== undefined ? overrideDate : (lockDate || null);
    try {
      await apiFetch('/api/accounting/lock-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockDate: targetLockDate })
      });
      setSuccessMsg(
        targetLockDate
          ? `Company lock date updated to ${targetLockDate}. All postings on or before this date are now strictly blocked.`
          : 'Company lock date cleared. Posting restrictions now rely on individual period status.'
      );
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to update lock date');
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBlockedPeriodId(null);
    setSuccessMsg(null);
    try {
      await apiFetch('/api/accounting/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPeriod)
      });
      setSuccessMsg(`Accounting period "${newPeriod.name}" created successfully.`);
      setShowCreateModal(false);
      setNewPeriod({ name: '', startDate: '', endDate: '', fiscalYear: new Date().getFullYear() });
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to create period');
    }
  };

  const handleSoftClose = async (periodId: string) => {
    setError(null);
    setBlockedPeriodId(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/accounting/periods/${periodId}/soft-close`, { method: 'POST' });
      setSuccessMsg('Period soft-closed successfully.');
      loadData();
    } catch (err: any) {
      setBlockedPeriodId(periodId);
      setError(err?.message || 'Failed to soft close period');
    }
  };

  const handleHardClose = async (periodId: string) => {
    setError(null);
    setBlockedPeriodId(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/accounting/periods/${periodId}/hard-close`, { method: 'POST' });
      setSuccessMsg('Period hard-closed and locked for BIR statutory audit.');
      loadData();
    } catch (err: any) {
      setBlockedPeriodId(periodId);
      setError(err?.message || 'Failed to hard close period');
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenModalPeriod) return;
    setError(null);
    setBlockedPeriodId(null);
    try {
      await apiFetch(`/api/accounting/periods/${reopenModalPeriod.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason })
      });
      setSuccessMsg(`Period "${reopenModalPeriod.name}" reopened successfully.`);
      setReopenModalPeriod(null);
      setReopenReason('');
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to reopen period');
    }
  };

  const handleViewHistory = async (period: any) => {
    setHistoryModalPeriod(period);
    try {
      const data = await apiFetch<any[]>(`/api/accounting/periods/${period.id}/history`);
      setHistoryLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      setHistoryLogs([]);
    }
  };

  const filteredPeriods = periods.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = (p?.name || '').toLowerCase();
    const year = (p?.fiscalYear || '').toString();
    const status = (p?.status || '').toLowerCase();
    return name.includes(q) || year.includes(q) || status.includes(q);
  });

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Accounting Period Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Control fiscal periods, BIR lock dates, 12-check closing audits, soft/hard closing rules, and year-end close.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {canApprove && (
            <button
              type="button"
              onClick={handleOpenYearEndModal}
              data-testid="btn-open-year-end-close"
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors shadow-sm"
            >
              <CalendarCheck2 className="w-4 h-4" /> Year-End Close
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> New Period
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>{error}</span>
          <div className="flex items-center gap-2 shrink-0">
            {blockedPeriodId && (
              <button
                type="button"
                onClick={() => {
                  setWorkspaceModal({ periodId: blockedPeriodId, initialTab: 'CHECKLIST' });
                  setError(null);
                  setBlockedPeriodId(null);
                }}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg"
              >
                Open 12-Check Audit
              </button>
            )}
            <button type="button" onClick={() => { setError(null); setBlockedPeriodId(null); }} className="text-xs font-bold underline">Dismiss</button>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-xs font-bold underline">Dismiss</button>
        </div>
      )}

      {/* Lock Date Card */}
      <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-lg">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Company Lock Date</h3>
              {savedLockDate ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  LOCKED THRU {savedLockDate}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  NO GLOBAL LOCK SET
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Transactions dated on or before this lock date are strictly blocked from posting across all modules (BIR Audit Freeze).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <input
            type="date"
            aria-label="Company Lock Date"
            value={lockDate}
            onChange={(e) => setLockDate(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={() => handleUpdateLockDate()}
            className="px-3 py-1.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Update Lock Date
          </button>
          {savedLockDate && (
            <button
              type="button"
              onClick={() => handleUpdateLockDate(null)}
              className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1"
            >
              <Unlock className="w-3.5 h-3.5" /> Clear Lock
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search periods by name, fiscal year, status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {/* Period Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">Loading accounting periods...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Fiscal Year</th>
                  <th className="py-3.5 px-4">Period Name</th>
                  <th className="py-3.5 px-4">Start Date</th>
                  <th className="py-3.5 px-4">End Date</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredPeriods.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-slate-700 dark:text-slate-300">{p.fiscalYear}</td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-100">{p.name}</td>
                    <td className="py-3.5 px-4 text-xs font-mono">{p.startDate}</td>
                    <td className="py-3.5 px-4 text-xs font-mono">{p.endDate}</td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        p.status === 'OPEN' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                        p.status === 'SOFT_CLOSED' ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                        'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        type="button"
                        data-testid={`btn-open-close-workspace-${p.id}`}
                        onClick={() => setWorkspaceModal({ periodId: p.id, initialTab: 'OVERVIEW' })}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded transition-colors cursor-pointer"
                        title="Open Evidence-Driven Period Close Workspace"
                      >
                        Close Workspace
                      </button>
                      <button
                        type="button"
                        data-testid={`btn-open-checklist-${p.id}`}
                        onClick={() => setWorkspaceModal({ periodId: p.id, initialTab: 'CHECKLIST' })}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition-colors cursor-pointer"
                        title="Open 12-Section Closing Checklist"
                      >
                        12-Check Audit
                      </button>
                      <button
                        onClick={() => handleViewHistory(p)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        title="View Status History"
                      >
                        History
                      </button>
                      {p.status === 'OPEN' && (
                        <button
                          onClick={() => handleSoftClose(p.id)}
                          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded transition-colors"
                        >
                          Soft Close
                        </button>
                      )}
                      {(p.status === 'OPEN' || p.status === 'SOFT_CLOSED') && (
                        <button
                          onClick={() => handleHardClose(p.id)}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded transition-colors"
                        >
                          Hard Close
                        </button>
                      )}
                      {p.status !== 'OPEN' && (
                        <button
                          onClick={() => setReopenModalPeriod(p)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded transition-colors"
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredPeriods.length === 0 && (
                  <tr><td colSpan={6} className="py-12 text-center text-slate-400">No accounting periods found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Create Accounting Period</h3>
            <form onSubmit={handleCreatePeriod} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Period Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q1 2026 or Jan 2026"
                  value={newPeriod.name}
                  onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={newPeriod.startDate}
                    onChange={(e) => setNewPeriod({ ...newPeriod, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={newPeriod.endDate}
                    onChange={(e) => setNewPeriod({ ...newPeriod, endDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Fiscal Year</label>
                <input
                  type="number"
                  required
                  value={newPeriod.fiscalYear}
                  onChange={(e) => setNewPeriod({ ...newPeriod, fiscalYear: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg"
                >
                  Create Period
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reopen Modal */}
      {reopenModalPeriod && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Reopen Period: {reopenModalPeriod.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reopening a closed accounting period requires an explicit audit reason to maintain compliance and auditability.
            </p>
            <form onSubmit={handleReopen} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Audit Reason (Mandatory)</label>
                <textarea
                  required
                  rows={3}
                  placeholder="State the justification or audit approval reference..."
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setReopenModalPeriod(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg"
                >
                  Confirm Reopen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Status History Modal */}
      {historyModalPeriod && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Status History: {historyModalPeriod.name}</h3>
              <button onClick={() => setHistoryModalPeriod(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">&times;</button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-3">
              {historyLogs.map((log) => (
                <div key={log.id} className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-100 dark:border-slate-700/60 text-xs space-y-1">
                  <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                    <span>{log.action} ({log.previousStatus || 'NONE'} &rarr; {log.newStatus})</span>
                    <span className="text-slate-400">{log.formattedTimestamp || formatEnterpriseTimestamp(log.createdAt)}</span>
                  </div>
                  {log.reason && <p className="text-slate-600 dark:text-slate-400">Reason: {log.reason}</p>}
                  {log.warningJustification && (
                    <p className="text-amber-700 dark:text-amber-400">Warning Justification: {log.warningJustification}</p>
                  )}
                  <p className="text-slate-400">
                    By: {log.changedByName || log.changedBy} {log.changedByRole ? `(${log.changedByRole})` : ''}
                  </p>
                  {log.certificationSnapshotId && (
                    <p className="text-emerald-700 font-semibold">
                      Certification Snapshot: {log.certificationSnapshotId}
                    </p>
                  )}
                </div>
              ))}
              {historyLogs.length === 0 && <p className="text-center text-slate-400 text-xs py-4">No history records found.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Year-End Close Modal */}
      {showYearEndModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <CalendarCheck2 className="w-5 h-5 text-amber-600" />
                Execute Fiscal Year-End Close
              </h3>
              <button
                type="button"
                onClick={() => setShowYearEndModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
                aria-label="Close Year-End Close modal"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Closes all nominal <strong>Revenue</strong> and <strong>Expense</strong> accounts for the selected fiscal year into <strong>Retained Earnings</strong> via an automated closing journal entry, in compliance with Philippine PFRS &amp; BIR Annual Income Tax Return (BIR Form 1702) preparation.
            </p>
            <form onSubmit={handleExecuteYearEndClose} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Fiscal Year to Close</label>
                <input
                  type="number"
                  required
                  min={2000}
                  max={2100}
                  value={yearEndFiscalYear}
                  onChange={(e) => setYearEndFiscalYear(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Retained Earnings (Equity Account)</label>
                <select
                  required
                  value={retainedEarningsAccountId}
                  onChange={(e) => setRetainedEarningsAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">-- Select Equity Account --</option>
                  {equityAccounts.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.accountCode} — {eq.accountName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={yearEndSubmitting}
                  onClick={() => setShowYearEndModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={yearEndSubmitting || !retainedEarningsAccountId}
                  className="px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50"
                >
                  {yearEndSubmitting ? 'Closing Year...' : `Run FY ${yearEndFiscalYear} Close`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evidence-Driven Period Close Workspace Modal */}
      {workspaceModal && (
        <PeriodCloseWorkspaceModal
          periodId={workspaceModal.periodId}
          initialTab={workspaceModal.initialTab}
          canEdit={canEdit}
          canApprove={canApprove}
          onClose={() => setWorkspaceModal(null)}
          onPeriodUpdated={loadData}
        />
      )}
    </div>
  );
};

export default function Accounting() {
  const location = useLocation();
  const { userRole, permissions, activeCompany } = useAuth();
  const isRoot = location.pathname === '/accounting' || location.pathname === '/accounting/';

  const defaultAccountingRoute = React.useMemo(() => {
    const candidateRoutes = [
      '/accounting/journals',
      '/accounting/accounts',
      '/accounting/sales-invoicing',
      '/accounting/purchase-bills',
      '/accounting/procurement',
      '/accounting/inventory',
      '/accounting/cash-transactions',
      '/accounting/bank-reconciliation',
      '/accounting/fixed-assets',
      '/accounting/payroll',
      '/accounting/periods',
      '/accounting/forex',
    ];
    const authSubRoutes = activeCompany?.assignedSubmodules
      ? Object.values(activeCompany.assignedSubmodules).flat()
      : [];
    if (authSubRoutes.length > 0) {
      const subIdToRoute: Record<string, string> = {
        'acct-journals': '/accounting/journals',
        'acct-coa': '/accounting/accounts',
        'sales-invoices': '/accounting/sales-invoicing',
        'proc-bills': '/accounting/purchase-bills',
        'proc-orders': '/accounting/procurement',
        'inv-items': '/accounting/inventory',
        'cash-vouchers': '/accounting/cash-transactions',
        'cash-bank-rec': '/accounting/bank-reconciliation',
        'fa-register': '/accounting/fixed-assets',
        'pay-records': '/accounting/payroll',
        'acct-periods': '/accounting/periods',
        'acct-forex': '/accounting/forex',
      };
      for (const subId of authSubRoutes) {
        if (subIdToRoute[subId]) return subIdToRoute[subId];
      }
    }
    return candidateRoutes[0];
  }, [userRole, permissions, activeCompany]);

  return (
    <div className="w-full space-y-4">
      <div className="flex space-x-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-500 dark:text-slate-400">Accounting Module</span>
        {!isRoot && <span>/</span>}
        {!isRoot && <span className="text-slate-800 dark:text-slate-200 font-bold capitalize">{location.pathname.split('/').pop()?.replace(/-/g, ' ')}</span>}
      </div>

      <Routes>
        <Route path="/" element={<Navigate to={(defaultAccountingRoute || 'journals').replace(/^\/accounting\/?/, '')} replace />} />
        <Route path="sales-invoicing" element={<SalesInvoicing />} />
        <Route path="inventory" element={<InventoryManagement />} />
        <Route path="payroll" element={<PayrollCompensation />} />
        <Route path="fixed-assets" element={<FixedAssetsRegister />} />
        <Route path="procurement" element={<ProcurementMatching />} />
        <Route path="bank-reconciliation" element={<BankReconciliation />} />
        <Route path="forex" element={<ForexManagement />} />
        <Route path="journals" element={<Journals />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="purchase-bills" element={<PurchaseBills />} />
        <Route path="cash-transactions" element={<CashTransactions />} />
        <Route path="periods" element={<AccountingPeriods />} />
      </Routes>
    </div>
  );
}
