import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  ShoppingCart, Landmark, Plus, 
  BookOpen, ListTree, RefreshCw, Calendar, Lock, History, ShieldAlert,
  FileText, Boxes, Users, Building2, DollarSign, ShieldCheck, Search, Filter, Edit2
} from 'lucide-react';
import ExportButton, { ExportData } from '../components/ExportButton';
import { AccountModal } from '../components/AccountModal';
import VendorModal from '../components/VendorModal';
import { Truck, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Journals from './accounting/Journals';
import SalesInvoicing from './accounting/SalesInvoicing';
import InventoryManagement from './accounting/InventoryManagement';
import PayrollCompensation from './accounting/PayrollCompensation';
import FixedAssetsRegister from './accounting/FixedAssetsRegister';
import ProcurementMatching from './accounting/ProcurementMatching';
import BankReconciliation from './accounting/BankReconciliation';
import ForexManagement from './accounting/ForexManagement';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const StatusBadge = ({ status }: { status: string }) => {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
      status === 'POSTED' || status === 'PAID' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 
      status === 'DRAFT' ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300' : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
    }`}>
      {status || 'DRAFT'}
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
              <DollarSign className="w-5 h-5" />
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

  const fetchAccounts = () => {
    setLoading(true);
    fetch('/api/accounting/accounts')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAccounts(Array.isArray(data) ? data : (data?.data || [])))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleOpenNewModal = () => {
    setSelectedAccount(null);
    setShowModal(true);
  };

  const handleEditAccount = (acc: any) => {
    setSelectedAccount(acc);
    setShowModal(true);
  };

  const safeAccounts = Array.isArray(accounts) ? accounts : [];

  const filteredAccounts = safeAccounts.filter(a => {
    const matchesSearch = 
      (a?.accountCode || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a?.accountName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a?.detailType || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    if (selectedTypeFilter === 'ALL') return matchesSearch;
    return matchesSearch && a?.accountType === selectedTypeFilter;
  });

  const exportData: ExportData = {
    filename: `Chart_of_Accounts_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Chart of Accounts Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | BIR Compliant General Ledger Accounts`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Code', 'Account Name', 'Account Type', 'Detail Type', 'BIR Classification', 'Normal Balance'],
    rows: filteredAccounts.map(a => [
      a?.accountCode || '',
      a?.accountName || '',
      a?.accountType || '',
      a?.detailType || '-',
      a?.birTaxCategory || 'NOT_APPLICABLE',
      a?.normalBalance || '',
    ]),
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 35 },
      3: { cellWidth: 35 },
      4: { cellWidth: 40 },
      5: { cellWidth: 25 },
    },
  };

  return (
    <div className="space-y-4">
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
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={handleOpenNewModal}
            className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Account
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search code, name, detail type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">Filter:</span>
          {['ALL', 'ASSET', 'RECEIVABLE', 'PAYABLE', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map(type => (
            <button
              key={type}
              onClick={() => setSelectedTypeFilter(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                selectedTypeFilter === type
                  ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Table List */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching general ledger accounts...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50/80 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider font-bold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Code</th>
                  <th className="py-3.5 px-4">Account Name</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Detail Type</th>
                  <th className="py-3.5 px-4">BIR Tax Category</th>
                  <th className="py-3.5 px-4 text-center">Normal Balance</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredAccounts.map((a, idx) => (
                  <tr
                    key={a?.id || `acc-${a?.accountCode || idx}`}
                    onClick={() => handleEditAccount(a)}
                    className="hover:bg-indigo-50/40 dark:hover:bg-slate-700/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                      {a?.accountCode || '-'}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-100">
                      {a?.isSubAccount && <span className="text-slate-400 mr-1.5">└─</span>}
                      {a?.accountName || '-'}
                      {a?.description && (
                        <span className="block text-[11px] font-normal text-slate-400 line-clamp-1 truncate max-w-xs mt-0.5">
                          {a.description}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {a?.accountType || '-'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                      {a?.detailType || '-'}
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      {a?.birTaxCategory && a.birTaxCategory !== 'NOT_APPLICABLE' ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          {a.birTaxCategory}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center text-xs font-semibold">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        a?.normalBalance === 'DEBIT'
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                          : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {a?.normalBalance || '-'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditAccount(a);
                        }}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-semibold"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredAccounts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No matching accounts found.
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
    </div>
  );
};

const PurchaseBills = () => {
  const { activeCompany } = useAuth();
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [newBill, setNewBill] = useState({ vendorId: '', billNumber: '', billDate: '', dueDate: '', totalAmount: 0 });
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBills = () => {
    setLoading(true);
    fetch('/api/accounting/purchase-bills')
      .then(r => r.ok ? r.json() : [])
      .then(data => setBills(Array.isArray(data) ? data : (data.data || [])))
      .catch(() => setBills([]))
      .finally(() => setLoading(false));
  };

  const fetchVendors = () => {
    fetch('/api/master-data/vendors')
      .then(r => r.ok ? r.json() : [])
      .then(data => setVendors(Array.isArray(data) ? data : (data.data || [])))
      .catch(() => setVendors([]));
  };

  useEffect(() => {
    fetchBills();
    fetchVendors();
  }, []);

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
      const payload = {
        ...newBill,
        totalAmount: Math.round(newBill.totalAmount * 100), // convert to cents
        lines: [] // Assuming simple creation first
      };
      const res = await fetch('/api/accounting/purchase-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewBill({ vendorId: '', billNumber: '', billDate: '', dueDate: '', totalAmount: 0 });
        fetchBills();
      } else {
        setError("Failed to create bill.");
      }
    } catch (err: any) {
      setError(err.message || "Error creating bill.");
    }
  };

  const safeBills = Array.isArray(bills) ? bills : [];
  const filteredBills = safeBills.filter(b => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const billNum = (b?.billNumber || '').toLowerCase();
    const vendor = (b?.vendorName || '').toLowerCase();
    const status = (b?.status || '').toLowerCase();
    return billNum.includes(q) || vendor.includes(q) || status.includes(q);
  });

  const exportData: ExportData = {
    filename: `Purchase_Bills_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Purchase Bills Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Supplier Invoices`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Bill Date', 'Bill Number', 'Vendor Name', 'Total Amount (PHP)', 'Balance Due (PHP)', 'Status'],
    rows: safeBills.map(b => [
      b?.billDate ? new Date(b.billDate).toLocaleDateString() : '-',
      b?.billNumber || '',
      b?.vendorName || '',
      ((b?.totalAmount || 0) / 100).toFixed(2),
      ((b?.balanceDue || 0) / 100).toFixed(2),
      b?.status || 'DRAFT',
    ]),
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 35 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 35 },
      4: { halign: 'right', cellWidth: 35 },
      5: { cellWidth: 25 },
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            Purchase Bills (Accounts Payable)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Supplier invoices and payable liabilities register.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setEditingVendor(null);
              setShowVendorModal(true);
            }}
            className="bg-amber-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-amber-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Truck className="w-4 h-4" /> Create Vendor
          </button>
          <ExportButton data={exportData} disabled={loading} />
          <button onClick={() => setShowCreateModal(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" /> New Bill
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by bill #, vendor, or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching purchase bills...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Number</th>
                  <th className="py-3.5 px-4">Vendor</th>
                  <th className="py-3.5 px-4 text-right">Total</th>
                  <th className="py-3.5 px-4 text-right">Balance Due</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredBills.map((b, idx) => (
                  <tr key={b?.id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 text-xs text-slate-500">
                      {b?.billDate ? new Date(b.billDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">{b?.billNumber || '-'}</td>
                    <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100">{b?.vendorName || '-'}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-700 dark:text-slate-200">{formatCurrency(b?.totalAmount)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(b?.balanceDue)}</td>
                    <td className="py-3.5 px-4 text-center"><StatusBadge status={b?.status} /></td>
                  </tr>
                ))}
                {filteredBills.length === 0 && (
                  <tr><td colSpan={6} className="py-12 text-center text-slate-400">No purchase bills found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                    placeholder="INV-001"
                    value={newBill.billNumber}
                    onChange={(e) => setNewBill({ ...newBill, billNumber: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
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
    </div>
  );
};

const CashTransactions = () => {
  const { activeCompany } = useAuth();
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTxn, setNewTxn] = useState({ accountId: '', type: 'RECEIPT', amount: 0, transactionDate: '', reference: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTxns = () => {
    setLoading(true);
    fetch('/api/accounting/cash-transactions')
      .then(r => r.ok ? r.json() : [])
      .then(data => setTxns(Array.isArray(data) ? data : (data.data || [])))
      .catch(() => setTxns([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTxns();
    fetch('/api/master-data/accounts')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAccounts(Array.isArray(data) ? data : (data?.data || [])))
      .catch(() => setAccounts([]));
  }, []);

  const handleCreateTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        ...newTxn,
        amount: Math.round(newTxn.amount * 100),
      };
      const res = await fetch('/api/accounting/cash-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewTxn({ accountId: '', type: 'RECEIPT', amount: 0, transactionDate: '', reference: '', description: '' });
        fetchTxns();
      } else {
        setError("Failed to create cash transaction.");
      }
    } catch (err) {
      setError(err.message || "Error creating cash transaction.");
    }
  };

  const safeTxns = Array.isArray(txns) ? txns : [];
  const filteredTxns = safeTxns.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const num = (t?.transactionNumber || '').toLowerCase();
    const type = (t?.type || '').toLowerCase();
    const desc = (t?.description || '').toLowerCase();
    const status = (t?.status || '').toLowerCase();
    return num.includes(q) || type.includes(q) || desc.includes(q) || status.includes(q);
  });

  const exportData: ExportData = {
    filename: `Cash_Transactions_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Cash Receipts & Disbursements Log',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Cash Register`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Date', 'Transaction Number', 'Type', 'Description', 'Amount (PHP)', 'Status'],
    rows: safeTxns.map(t => [
      t?.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : '-',
      t?.transactionNumber || '',
      t?.type || '',
      t?.description || '-',
      ((t?.totalAmount || 0) / 100).toFixed(2),
      t?.status || 'POSTED',
    ]),
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 35 },
      2: { cellWidth: 30 },
      3: { cellWidth: 'auto' },
      4: { halign: 'right', cellWidth: 35 },
      5: { cellWidth: 25 },
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Cash Management Register
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Cash receipts, disbursements, and petty cash transactions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton data={exportData} disabled={loading} />
          <button onClick={() => setShowCreateModal(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" /> New Cash Txn
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by txn #, type, description, or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching cash transactions...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Number</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Description</th>
                  <th className="py-3.5 px-4 text-right">Amount</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredTxns.map((t, idx) => (
                  <tr key={t?.id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 text-xs text-slate-500">
                      {t?.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">{t?.transactionNumber || '-'}</td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-600 dark:text-slate-300">{t?.type || '-'}</td>
                    <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100 truncate max-w-[200px]">{t?.description || '-'}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-cyan-600 dark:text-cyan-400">{formatCurrency(t?.totalAmount)}</td>
                    <td className="py-3.5 px-4 text-center"><StatusBadge status={t?.status} /></td>
                  </tr>
                ))}
                {filteredTxns.length === 0 && (
                  <tr><td colSpan={6} className="py-12 text-center text-slate-400">No cash transactions found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Create Cash Transaction</h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleCreateTxn} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Cash Account</label>
                <select
                  required
                  value={newTxn.accountId}
                  onChange={(e) => setNewTxn({ ...newTxn, accountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select an account...</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.accountCode} - {a.accountName}</option>
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
                    min="0"
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
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg"
                >
                  Create Txn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const AccountingPeriods = () => {
  const [periods, setPeriods] = useState<any[]>([]);
  const [lockDate, setLockDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', startDate: '', endDate: '', fiscalYear: new Date().getFullYear() });

  const [reopenModalPeriod, setReopenModalPeriod] = useState<any | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const [historyModalPeriod, setHistoryModalPeriod] = useState<any | null>(null);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/accounting/periods').then(r => r.ok ? r.json() : []),
      fetch('/api/accounting/lock-date').then(r => r.ok ? r.json() : { lockDate: null })
    ]).then(([pData, lData]) => {
      setPeriods(Array.isArray(pData) ? pData : []);
      setLockDate(lData?.lockDate || '');
      setLoading(false);
    }).catch(err => {
      setError(err.message);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateLockDate = async () => {
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/accounting/lock-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockDate: lockDate || null })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update lock date');
      setSuccessMsg('Lock date updated successfully');
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/accounting/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPeriod)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create period');
      setSuccessMsg('Accounting period created successfully');
      setShowCreateModal(false);
      setNewPeriod({ name: '', startDate: '', endDate: '', fiscalYear: new Date().getFullYear() });
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSoftClose = async (periodId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/accounting/periods/${periodId}/soft-close`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to soft close period');
      setSuccessMsg('Period soft-closed');
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleHardClose = async (periodId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/accounting/periods/${periodId}/hard-close`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to hard close period');
      setSuccessMsg('Period hard-closed');
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenModalPeriod) return;
    setError(null);
    try {
      const res = await fetch(`/api/accounting/periods/${reopenModalPeriod.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to reopen period');
      setSuccessMsg('Period reopened successfully');
      setReopenModalPeriod(null);
      setReopenReason('');
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleViewHistory = async (period: any) => {
    setHistoryModalPeriod(period);
    try {
      const res = await fetch(`/api/accounting/periods/${period.id}/history`);
      const data = await res.json();
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Accounting Period Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Control fiscal periods, lock dates, soft/hard closing rules, and reopen audit reasons.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Period
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-xs font-bold underline">Dismiss</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-xs font-bold underline">Dismiss</button>
        </div>
      )}

      {/* Lock Date Card */}
      <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-lg">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Company Lock Date</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Transactions dated on or before this lock date are strictly blocked from posting across all modules.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            value={lockDate}
            onChange={(e) => setLockDate(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleUpdateLockDate}
            className="px-3 py-1.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Update Lock Date
          </button>
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
                    <span className="text-slate-400">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                  {log.reason && <p className="text-slate-600 dark:text-slate-400">Reason: {log.reason}</p>}
                  <p className="text-slate-400">By User ID: {log.changedBy}</p>
                </div>
              ))}
              {historyLogs.length === 0 && <p className="text-center text-slate-400 text-xs py-4">No history records found.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function Accounting() {
  const location = useLocation();
  const isRoot = location.pathname === '/accounting' || location.pathname === '/accounting/';

  return (
    <div className="w-full space-y-4">
      <div className="flex space-x-2 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/accounting" className="hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">Accounting Workspace</Link>
        {!isRoot && <span>/</span>}
        {!isRoot && <span className="text-slate-800 dark:text-slate-200 font-semibold capitalize">{location.pathname.split('/').pop()?.replace('-', ' ')}</span>}
      </div>

      <Routes>
        <Route path="/" element={<AccountingOverview />} />
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
