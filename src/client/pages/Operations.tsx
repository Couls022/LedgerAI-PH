import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  FileText, Boxes, Users, Building2, ShieldCheck, Landmark, 
  ArrowUpRight, RefreshCw, ShoppingCart, DollarSign, Clock, 
  AlertTriangle, CheckCircle2, Activity, Layers, Calendar, ChevronRight
} from 'lucide-react';
import ExportButton, { ExportData } from '../components/ExportButton';
import { useAuth } from '../context/AuthContext';

import SalesInvoicing from './accounting/SalesInvoicing';
import InventoryManagement from './accounting/InventoryManagement';
import PayrollCompensation from './accounting/PayrollCompensation';
import FixedAssetsRegister from './accounting/FixedAssetsRegister';
import ProcurementMatching from './accounting/ProcurementMatching';
import BankReconciliation from './accounting/BankReconciliation';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

function OperationsOverview() {
  const { activeCompany } = useAuth();
  const [loading, setLoading] = useState(false);
  
  // Real or calculated metrics with clean fallbacks
  const [salesSummary, setSalesSummary] = useState({ totalInvoices: 0, unpaidAmount: 0, vatCollected: 0 });
  const [inventorySummary, setInventorySummary] = useState({ totalItems: 0, stockValuation: 0, lowStockCount: 0 });
  const [payrollSummary, setPayrollSummary] = useState({ activeEmployees: 0, grossPayroll: 0, withholdingTax: 0 });
  const [assetSummary, setAssetSummary] = useState({ totalAssets: 0, bookValue: 0, monthlyDep: 0 });
  const [procurementSummary, setProcurementSummary] = useState({ openPOs: 0, matchedCount: 0, pendingGRNs: 0 });
  const [bankSummary, setBankSummary] = useState({ bankAccounts: 0, reconciledBalance: 0, unreconciledLines: 0 });

  const fetchOperationsData = async () => {
    setLoading(true);
    try {
      const [invRes, itemsRes, assetsRes, bankRes] = await Promise.all([
        fetch('/api/accounting/sales-invoices').catch(() => null),
        fetch('/api/operations/inventory/items').catch(() => null),
        fetch('/api/operations/fixed-assets').catch(() => null),
        fetch('/api/accounting/bank-reconciliations').catch(() => null)
      ]);

      if (invRes && invRes.ok) {
        const invData = await invRes.json();
        const invs = Array.isArray(invData) ? invData : (invData.data || []);
        if (invs.length > 0) {
          const unpaid = invs.filter((i: any) => i.status !== 'PAID').reduce((sum: number, i: any) => sum + (i.totalAmount || 0), 0);
          setSalesSummary(prev => ({ ...prev, totalInvoices: invs.length, unpaidAmount: unpaid }));
        }
      }

      if (itemsRes && itemsRes.ok) {
        const itemData = await itemsRes.json();
        const items = Array.isArray(itemData) ? itemData : (itemData.data || []);
        if (items.length > 0) {
          const totalVal = items.reduce((sum: number, i: any) => sum + ((i.quantity || 0) * (i.unitCost || 0)), 0);
          const low = items.filter((i: any) => (i.quantity || 0) <= (i.reorderLevel || 10)).length;
          setInventorySummary({ totalItems: items.length, stockValuation: totalVal * 100, lowStockCount: low });
        }
      }

      if (assetsRes && assetsRes.ok) {
        const assetData = await assetsRes.json();
        const assets = Array.isArray(assetData) ? assetData : (assetData.data || []);
        if (assets.length > 0) {
          const totalCost = assets.reduce((sum: number, a: any) => sum + (a.acquisitionCost || 0), 0);
          setAssetSummary(prev => ({ ...prev, totalAssets: assets.length, bookValue: totalCost * 100 }));
        }
      }

      if (bankRes && bankRes.ok) {
        const reconData = await bankRes.json();
        const recons = Array.isArray(reconData) ? reconData : (reconData.data || []);
        if (recons.length > 0) {
          setBankSummary(prev => ({ ...prev, unreconciledLines: recons.filter((r: any) => r.status === 'PENDING').length }));
        }
      }
    } catch (err) {
      console.error('Error refreshing operations data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOperationsData();
  }, []);

  const exportData: ExportData = {
    title: 'Operations Dashboard Summary',
    filename: `operations_summary_${new Date().toISOString().slice(0,10)}`,
    headers: ['Operational Area', 'Primary Metric', 'Key Value', 'Status / Alert'],
    rows: [
      ['Sales & Invoicing', 'Unpaid Invoices', formatCurrency(salesSummary.unpaidAmount), `${salesSummary.totalInvoices} Total Invoices`],
      ['Inventory & Stock', 'Stock Valuation', formatCurrency(inventorySummary.stockValuation), `${inventorySummary.lowStockCount} Low Stock Alerts`],
      ['Payroll & Compensation', 'Gross Monthly Payroll', formatCurrency(payrollSummary.grossPayroll), `${payrollSummary.activeEmployees} Active Employees`],
      ['Fixed Assets Register', 'Net Book Value', formatCurrency(assetSummary.bookValue), `${assetSummary.totalAssets} Capital Assets`],
      ['Procurement (3-Way Match)', 'Open POs', `${procurementSummary.openPOs} Active POs`, `${procurementSummary.pendingGRNs} GRNs Pending`],
      ['Bank Reconciliation', 'Reconciled Cash', formatCurrency(bankSummary.reconciledBalance), `${bankSummary.unreconciledLines} Unmatched Items`]
    ]
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">
            <Activity className="w-4 h-4" />
            <span>Operations & Supply Chain Workspace</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Operations Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Real-time management for Sales Invoicing, Inventory Stock, Payroll, Capital Assets, 3-Way Match Procurement, and Bank Reconciliation.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={fetchOperationsData}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <ExportButton data={exportData} />
        </div>
      </div>

      {/* 6 Core Operational Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        
        {/* 1. Sales & Invoicing */}
        {(() => {
          const vatStatus = activeCompany?.vatStatus || 'VAT';
          const isVat = vatStatus === 'VAT';
          const isNonVat = vatStatus === 'NON_VAT';
          let badgeText = '12% VAT Active';
          let badgeClass = 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
          let descText = 'Accounts Receivable, Output VAT & CWT';
          let vatLabel = 'Output VAT Collected:';
          let vatValue = formatCurrency(salesSummary.vatCollected);

          if (isNonVat) {
            badgeText = 'Non-VAT (3% Tax)';
            badgeClass = 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
            descText = 'Accounts Receivable, 3% Percentage Tax (2551Q) & CWT';
            vatLabel = 'Percentage Tax (3%):';
            vatValue = formatCurrency(Math.round(salesSummary.unpaidAmount * 0.03));
          } else if (vatStatus === 'EXEMPT' || vatStatus === 'BMBE') {
            badgeText = 'VAT Exempt / BMBE';
            badgeClass = 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800';
            descText = 'Accounts Receivable, Tax Exempt Sales & CWT';
            vatLabel = 'Output VAT:';
            vatValue = '₱0.00 (Exempt)';
          } else if (vatStatus === 'PEZA_BOI') {
            badgeText = 'PEZA / BOI Exempt';
            badgeClass = 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800';
            descText = 'Accounts Receivable, Ecozone Exempt Sales & CWT';
            vatLabel = 'Output VAT:';
            vatValue = '₱0.00 (PEZA)';
          } else if (vatStatus === 'ZERO_RATED') {
            badgeText = '0% Zero-Rated Export';
            badgeClass = 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800';
            descText = 'Accounts Receivable, 0% Export Sales & CWT';
            vatLabel = 'Output VAT:';
            vatValue = '₱0.00 (0% Rate)';
          }

          return (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-400 transition-all flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <FileText className="w-6 h-6" />
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center space-x-1 ${badgeClass}`}>
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{badgeText}</span>
                  </span>
                </div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Sales & Invoicing</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{descText}</p>
                
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Outstanding AR:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(salesSummary.unpaidAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                    <span>{vatLabel}</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{vatValue}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{salesSummary.totalInvoices} Total Invoices</span>
                <Link
                  to="sales-invoicing"
                  className="inline-flex items-center space-x-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 group-hover:translate-x-0.5 transition-all"
                >
                  <span>Manage Invoicing</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          );
        })()}

        {/* 2. Inventory & Stock */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-emerald-500 dark:hover:border-emerald-400 transition-all flex flex-col justify-between group">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                <Boxes className="w-6 h-6" />
              </div>
              {inventorySummary.lowStockCount > 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center space-x-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{inventorySummary.lowStockCount} Reorder Alerts</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                  Optimal Stock
                </span>
              )}
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Inventory & Stock</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">FIFO & Weighted Average Stock Valuation</p>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Stock Valuation:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(inventorySummary.stockValuation)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Active SKUs Tracked:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{inventorySummary.totalItems} Items</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Automatic COGS Sync</span>
            <Link
              to="inventory"
              className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 group-hover:translate-x-0.5 transition-all"
            >
              <span>Manage Stock</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* 3. Payroll & Compensation */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-blue-500 dark:hover:border-blue-400 transition-all flex flex-col justify-between group">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl">
                <Users className="w-6 h-6" />
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center space-x-1">
                <Calendar className="w-3 h-3" />
                <span>BIR 1601-C Compliant</span>
              </span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Payroll & Compensation</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">SSS, PhilHealth, Pag-IBIG & Withholding Tax</p>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Gross Monthly Payroll:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(payrollSummary.grossPayroll)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Withholding Tax (1601-C):</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(payrollSummary.withholdingTax)}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{payrollSummary.activeEmployees} Active Employees</span>
            <Link
              to="payroll"
              className="inline-flex items-center space-x-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 group-hover:translate-x-0.5 transition-all"
            >
              <span>Process Payroll</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* 4. Fixed Assets Register */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-teal-500 dark:hover:border-teal-400 transition-all flex flex-col justify-between group">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 rounded-xl">
                <Building2 className="w-6 h-6" />
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400">
                Straight-Line & DDB
              </span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Fixed Assets Register</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Asset Capitalization & Monthly Depreciation</p>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Net Book Value:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(assetSummary.bookValue)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Monthly Depreciation:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(assetSummary.monthlyDep)}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{assetSummary.totalAssets} Registered Assets</span>
            <Link
              to="fixed-assets"
              className="inline-flex items-center space-x-1 text-xs font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 group-hover:translate-x-0.5 transition-all"
            >
              <span>View Assets</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* 5. Procurement & 3-Way Match */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-orange-500 dark:hover:border-orange-400 transition-all flex flex-col justify-between group">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 rounded-xl">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                PO vs GRN vs Invoice
              </span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Procurement (3-Way Match)</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Purchase Orders, Receiving & Tolerance Audit</p>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Open Purchase Orders:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{procurementSummary.openPOs} Orders</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Pending Goods Receipts:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{procurementSummary.pendingGRNs} GRNs</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{procurementSummary.matchedCount} Auto-Matched</span>
            <Link
              to="procurement"
              className="inline-flex items-center space-x-1 text-xs font-bold text-orange-600 dark:text-orange-400 hover:text-orange-700 group-hover:translate-x-0.5 transition-all"
            >
              <span>Audit Procurement</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* 6. Bank Reconciliation */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-cyan-500 dark:hover:border-cyan-400 transition-all flex flex-col justify-between group">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 rounded-xl">
                <Landmark className="w-6 h-6" />
              </div>
              {bankSummary.unreconciledLines > 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center space-x-1">
                  <Clock className="w-3 h-3" />
                  <span>{bankSummary.unreconciledLines} Lines Unmatched</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                  Fully Balanced
                </span>
              )}
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Bank Reconciliation</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Statement Import & GL Voucher Auto-Match</p>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Reconciled Cash:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(bankSummary.reconciledBalance)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Active Bank Accounts:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{bankSummary.bankAccounts} Accounts</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">BDO, BPI & Metrobank</span>
            <Link
              to="bank-reconciliation"
              className="inline-flex items-center space-x-1 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 group-hover:translate-x-0.5 transition-all"
            >
              <span>Reconcile Statement</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

      </div>

      {/* Operational Highlights & Activity Summary Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Operational Workflows Status */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Operational Control Matrix</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Key metrics, audit compliance, and quick action shortcuts</p>
            </div>
            <span className="px-2.5 py-1 text-xs rounded-lg font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              Live Real-Time
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            
            <div className="py-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Sales Invoicing & CWT</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">12% Output VAT billed with BIR Creditable Tax Certificates</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded-full">
                  Compliant
                </span>
                <Link to="sales-invoicing" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="py-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-lg">
                  <Boxes className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Inventory Valuation & COGS</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Automatic cost of goods sold posting upon stock movement</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded-full">
                  FIFO Active
                </span>
                <Link to="inventory" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="py-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-lg">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Payroll & Mandatory Contributions</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">SSS, PhilHealth, Pag-IBIG & BIR 1601-C withholding calculations</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2.5 py-1 rounded-full">
                  Ready
                </span>
                <Link to="payroll" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="py-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400 rounded-lg">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Fixed Assets & Depreciation</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Monthly GL depreciation schedule posting and asset disposal logs</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950 px-2.5 py-1 rounded-full">
                  Schedule Posted
                </span>
                <Link to="fixed-assets" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="py-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400 rounded-lg">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Procurement & 3-Way Match</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">PO, Goods Receipt Note, and Supplier Invoice price tolerance audit</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2.5 py-1 rounded-full">
                  Matching
                </span>
                <Link to="procurement" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="py-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400 rounded-lg">
                  <Landmark className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Bank Reconciliation</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Import bank statement CSV and auto-match with GL cash entries</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950 px-2.5 py-1 rounded-full">
                  Balanced
                </span>
                <Link to="bank-reconciliation" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

          </div>
        </div>

        {/* Right 1 Col: Quick Links & Summary */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-1">Quick Operational Actions</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Direct access to primary transaction forms</p>

            <div className="space-y-2.5">
              <Link
                to="sales-invoicing"
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all text-sm font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <FileText className="w-4 h-4 text-indigo-500" />
                  <span>Create Sales Invoice</span>
                </div>
                <ArrowUpRight className="w-4 h-4 opacity-60" />
              </Link>

              <Link
                to="inventory"
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-sm font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <Boxes className="w-4 h-4 text-emerald-500" />
                  <span>Stock Take & Adjustment</span>
                </div>
                <ArrowUpRight className="w-4 h-4 opacity-60" />
              </Link>

              <Link
                to="payroll"
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-950/50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-all text-sm font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span>Process Period Payroll</span>
                </div>
                <ArrowUpRight className="w-4 h-4 opacity-60" />
              </Link>

              <Link
                to="procurement"
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-orange-50 dark:hover:bg-orange-950/50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 transition-all text-sm font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <ShieldCheck className="w-4 h-4 text-orange-500" />
                  <span>Perform 3-Way Match</span>
                </div>
                <ArrowUpRight className="w-4 h-4 opacity-60" />
              </Link>

              <Link
                to="bank-reconciliation"
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-400 transition-all text-sm font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <Landmark className="w-4 h-4 text-cyan-500" />
                  <span>Upload Bank Statement</span>
                </div>
                <ArrowUpRight className="w-4 h-4 opacity-60" />
              </Link>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
            <div className="flex items-center space-x-2 text-slate-700 dark:text-slate-200 font-semibold text-xs">
              <CheckCircle2 className="w-4 h-4 text-indigo-500" />
              <span>Full Double-Entry Integration</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All transactions automatically generate balanced double-entry general journal entries in real-time.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function Operations() {
  const location = useLocation();
  const isRoot = location.pathname === '/operations' || location.pathname === '/operations/';

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center space-x-2 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/operations" className="hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">
          Operations Dashboard
        </Link>
        {!isRoot && <span>/</span>}
        {!isRoot && (
          <span className="text-slate-800 dark:text-slate-200 font-semibold capitalize">
            {location.pathname.split('/').pop()?.replace('-', ' ')}
          </span>
        )}
      </div>

      <Routes>
        <Route path="/" element={<OperationsOverview />} />
        <Route path="sales-invoicing" element={<SalesInvoicing />} />
        <Route path="inventory" element={<InventoryManagement />} />
        <Route path="payroll" element={<PayrollCompensation />} />
        <Route path="fixed-assets" element={<FixedAssetsRegister />} />
        <Route path="procurement" element={<ProcurementMatching />} />
        <Route path="bank-reconciliation" element={<BankReconciliation />} />
      </Routes>
    </div>
  );
}
