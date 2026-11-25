import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  FileText, Boxes, Users, Building2, ShieldCheck, Landmark, 
  ArrowUpRight, RefreshCw, ShoppingCart, DollarSign, Clock, 
  AlertTriangle, CheckCircle2, Activity, Layers, Calendar, ChevronRight
} from 'lucide-react';
import ExportButton, { ExportData } from '../components/ExportButton';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/apiClient';

import SalesInvoicing from './accounting/SalesInvoicing';
import InventoryManagement from './accounting/InventoryManagement';
import PayrollCompensation from './accounting/PayrollCompensation';
import FixedAssetsRegister from './accounting/FixedAssetsRegister';
import ProcurementMatching from './accounting/ProcurementMatching';
import BankReconciliation from './accounting/BankReconciliation';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const statusBadgeStyle = (status?: string) => {
  switch (status) {
    case 'OK':
      return 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'NOT_POSTED':
    case 'PENDING_RECONCILIATION':
      return 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'NO_RECORDS':
      return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    default:
      return 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
  }
};

const statusLabel = (status?: string, okText = 'Reconciled') => {
  switch (status) {
    case 'OK':
      return okText;
    case 'NOT_POSTED':
      return 'Pending Posting';
    case 'PENDING_RECONCILIATION':
      return 'Pending Reconciliation';
    case 'NO_RECORDS':
      return 'No Records';
    default:
      return 'Needs Review';
  }
};

function OperationsOverview() {
  const { activeCompany } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);

  const fetchOperationsData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch<any>('/api/operations/summary');
      setSummary(data);
    } catch (err: any) {
      console.error('Error refreshing operations data', err);
      setErrorMsg(err?.message || 'Failed to load authoritative operations summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOperationsData();
  }, [activeCompany?.id]);

  const salesSummary = summary?.sales || {
    totalInvoices: 0,
    postedInvoices: 0,
    draftInvoices: 0,
    unpaidAmountCentavos: 0,
    outputVatCentavos: 0,
    percentageTaxCentavos: 0,
    arVarianceCentavos: 0,
    status: 'NO_RECORDS',
    missingExplanation: 'No sales invoices recorded yet.',
  };
  const inventorySummary = summary?.inventory || {
    totalItems: 0,
    totalQuantityOnHand: 0,
    stockValuationCentavos: 0,
    lowStockCount: 0,
    costingMethods: [],
    inventoryVarianceCentavos: 0,
    status: 'NO_RECORDS',
    missingExplanation: 'No inventory items registered.',
  };
  const payrollSummary = summary?.payroll || {
    activeEmployees: 0,
    postedRuns: 0,
    latestPeriod: null,
    grossPayrollCentavos: 0,
    withholdingTaxCentavos: 0,
    status: 'NO_RECORDS',
    missingExplanation: 'No payroll runs recorded.',
  };
  const assetSummary = summary?.fixedAssets || {
    totalAssets: 0,
    activeAssets: 0,
    netBookValueCentavos: 0,
    monthlyDepreciationCentavos: 0,
    status: 'NO_RECORDS',
    missingExplanation: 'No fixed assets capitalized.',
  };
  const procurementSummary = summary?.procurement || {
    totalPOs: 0,
    openPOs: 0,
    openPoAmountCentavos: 0,
    matchedCount: 0,
    grnCount: 0,
    status: 'NO_RECORDS',
    missingExplanation: 'No purchase orders recorded.',
  };
  const bankSummary = summary?.banking || {
    bankAccounts: 0,
    reconciliationsCount: 0,
    reconciledBalanceCentavos: 0,
    unreconciledLines: 0,
    status: 'NO_RECORDS',
    missingExplanation: 'No bank reconciliations recorded.',
  };

  const exportData: ExportData = {
    title: 'Operations Dashboard Summary',
    filename: `operations_summary_${new Date().toISOString().slice(0, 10)}`,
    headers: ['Operational Area', 'Primary Metric', 'Key Value', 'GL / Status Check'],
    rows: [
      ['Sales & Invoicing', 'Open Posted AR', formatCurrency(salesSummary.unpaidAmountCentavos), `${salesSummary.postedInvoices}/${salesSummary.totalInvoices} Posted · ${statusLabel(salesSummary.status)}`],
      ['Inventory & Stock', 'Stock Valuation', formatCurrency(inventorySummary.stockValuationCentavos), `${inventorySummary.lowStockCount} Reorder Alerts · GL Diff ${formatCurrency(inventorySummary.inventoryVarianceCentavos)}`],
      ['Payroll & Compensation', 'Latest Posted Gross Payroll', formatCurrency(payrollSummary.grossPayrollCentavos), `${payrollSummary.activeEmployees} Active Employees · ${payrollSummary.postedRuns} Posted Runs`],
      ['Fixed Assets Register', 'Net Book Value', formatCurrency(assetSummary.netBookValueCentavos), `${assetSummary.totalAssets} Capital Assets · ${statusLabel(assetSummary.status)}`],
      ['Procurement (3-Way Match)', 'Open POs', `${procurementSummary.openPOs} Active POs`, `${procurementSummary.grnCount} GRNs · ${procurementSummary.matchedCount} Closed/Matched`],
      ['Bank Reconciliation', 'Approved Reconciled Balance', formatCurrency(bankSummary.reconciledBalanceCentavos), `${bankSummary.unreconciledLines} Unmatched Lines · ${statusLabel(bankSummary.status)}`]
    ]
  };

  const vatStatus = summary?.vatStatus || activeCompany?.vatStatus || 'VAT';

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
            Authoritative subledger rollups & GL reconciliation status across Sales, Inventory, Payroll, Fixed Assets, Procurement, and Banking.
            {summary?.lastUpdated && (
              <span className="ml-2 font-mono text-xs text-slate-400">
                Last synced: {new Date(summary.lastUpdated).toLocaleTimeString()}
              </span>
            )}
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

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 6 Core Operational Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* 1. Sales & Invoicing */}
        {(() => {
          const isNonVat = vatStatus === 'NON_VAT';
          let badgeText = '12% VAT Registered';
          let badgeClass = 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
          let descText = 'Posted AR Subledger, Stored Output VAT & CWT';
          let taxLabel = 'Recorded Output VAT:';
          let taxValue = formatCurrency(salesSummary.outputVatCentavos);

          if (isNonVat) {
            badgeText = 'Non-VAT (3% Sec. 116)';
            badgeClass = 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
            descText = 'Posted AR Subledger, 3% Percentage Tax (2551Q) & CWT';
            taxLabel = 'Percentage Tax (3%):';
            taxValue = formatCurrency(salesSummary.percentageTaxCentavos);
          } else if (vatStatus === 'EXEMPT' || vatStatus === 'BMBE') {
            badgeText = 'VAT Exempt / BMBE';
            badgeClass = 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800';
            descText = 'Exempt Sales Subledger & CWT';
            taxLabel = 'Output VAT:';
            taxValue = '₱0.00 (Exempt)';
          } else if (vatStatus === 'PEZA_BOI') {
            badgeText = 'PEZA / BOI';
            badgeClass = 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800';
            descText = 'Ecozone Sales Subledger & CWT';
            taxLabel = 'Output VAT:';
            taxValue = '₱0.00 (PEZA)';
          } else if (vatStatus === 'ZERO_RATED') {
            badgeText = '0% Zero-Rated';
            badgeClass = 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800';
            descText = '0% Zero-Rated Export Sales';
            taxLabel = 'Output VAT:';
            taxValue = '₱0.00 (0% Rate)';
          }

          return (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-400 transition-all flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <FileText className="w-6 h-6" />
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center space-x-1 ${badgeClass}`}>
                    <span>{badgeText}</span>
                  </span>
                </div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Sales & Invoicing</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{descText}</p>

                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Open Posted AR:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(salesSummary.unpaidAmountCentavos)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                    <span>{taxLabel}</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{taxValue}</span>
                  </div>
                  {salesSummary.missingExplanation && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{salesSummary.missingExplanation}</p>
                  )}
                </div>
              </div>

              <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {salesSummary.postedInvoices}/{salesSummary.totalInvoices} Posted
                </span>
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
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadgeStyle(inventorySummary.status)}`}>
                  {statusLabel(inventorySummary.status, 'GL Reconciled')}
                </span>
              )}
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Inventory & Stock</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {inventorySummary.costingMethods?.length > 0
                ? `Costing: ${inventorySummary.costingMethods.join(', ')}`
                : 'Subledger Quantity On Hand × Centavo Unit Cost'}
            </p>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Stock Valuation:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(inventorySummary.stockValuationCentavos)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Active SKUs / Units:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {inventorySummary.totalItems} SKUs ({inventorySummary.totalQuantityOnHand} qty)
                </span>
              </div>
              {inventorySummary.missingExplanation && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{inventorySummary.missingExplanation}</p>
              )}
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              GL Diff: {formatCurrency(inventorySummary.inventoryVarianceCentavos)}
            </span>
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
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border flex items-center space-x-1 ${statusBadgeStyle(payrollSummary.status)}`}>
                <Calendar className="w-3 h-3" />
                <span>{statusLabel(payrollSummary.status, 'Posted Run')}</span>
              </span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Payroll & Compensation</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {payrollSummary.latestPeriod ? `Latest Posted Period: ${payrollSummary.latestPeriod}` : 'SSS, PhilHealth, Pag-IBIG & BIR 1601-C'}
            </p>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Latest Gross Payroll:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(payrollSummary.grossPayrollCentavos)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Withholding Tax (1601-C):</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(payrollSummary.withholdingTaxCentavos)}</span>
              </div>
              {payrollSummary.missingExplanation && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{payrollSummary.missingExplanation}</p>
              )}
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {payrollSummary.activeEmployees} Active · {payrollSummary.postedRuns} Posted Runs
            </span>
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
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadgeStyle(assetSummary.status)}`}>
                {statusLabel(assetSummary.status, 'Posted Depreciation')}
              </span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Fixed Assets Register</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Acquisition Cost Minus Posted Accum. Depreciation</p>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Net Book Value:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(assetSummary.netBookValueCentavos)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Current Month Depreciation:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(assetSummary.monthlyDepreciationCentavos)}</span>
              </div>
              {assetSummary.missingExplanation && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{assetSummary.missingExplanation}</p>
              )}
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
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadgeStyle(procurementSummary.status)}`}>
                {statusLabel(procurementSummary.status, 'Active')}
              </span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Procurement (3-Way Match)</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Purchase Orders, Receiving & Tolerance Audit</p>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Open Purchase Orders:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  {procurementSummary.openPOs} ({formatCurrency(procurementSummary.openPoAmountCentavos)})
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Recorded Goods Receipts:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{procurementSummary.grnCount} GRNs</span>
              </div>
              {procurementSummary.missingExplanation && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{procurementSummary.missingExplanation}</p>
              )}
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{procurementSummary.matchedCount} Received/Matched</span>
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
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadgeStyle(bankSummary.status)}`}>
                  {statusLabel(bankSummary.status, 'Reconciled')}
                </span>
              )}
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Bank Reconciliation</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Statement Import & GL Voucher Auto-Match</p>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Approved Reconciled Balance:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(bankSummary.reconciledBalanceCentavos)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>Active Bank Accounts:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{bankSummary.bankAccounts} Accounts</span>
              </div>
              {bankSummary.missingExplanation && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{bankSummary.missingExplanation}</p>
              )}
            </div>
          </div>

          <div className="mt-5 pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{bankSummary.reconciliationsCount} Statements</span>
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
              <p className="text-xs text-slate-500 dark:text-slate-400">Authoritative subledger-to-GL verification status per module</p>
            </div>
            <span className="px-2.5 py-1 text-xs rounded-lg font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              DB Verified
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {[
              {
                title: 'Sales Invoicing & AR Control',
                sub: `${salesSummary.postedInvoices} posted invoice(s); GL AR variance ${formatCurrency(salesSummary.arVarianceCentavos)}`,
                status: salesSummary.status,
                okText: 'Reconciled',
                to: 'sales-invoicing',
                icon: FileText,
                color: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400',
              },
              {
                title: 'Inventory Valuation & COGS',
                sub: `${inventorySummary.totalItems} SKU(s); GL Inventory variance ${formatCurrency(inventorySummary.inventoryVarianceCentavos)}`,
                status: inventorySummary.status,
                okText: 'Reconciled',
                to: 'inventory',
                icon: Boxes,
                color: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400',
              },
              {
                title: 'Payroll & Statutory Contributions',
                sub: `${payrollSummary.activeEmployees} active employee(s); ${payrollSummary.postedRuns} posted payroll run(s)`,
                status: payrollSummary.status,
                okText: 'Posted',
                to: 'payroll',
                icon: Users,
                color: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400',
              },
              {
                title: 'Fixed Assets & Depreciation',
                sub: `${assetSummary.totalAssets} asset(s); NBV ${formatCurrency(assetSummary.netBookValueCentavos)}`,
                status: assetSummary.status,
                okText: 'Up to Date',
                to: 'fixed-assets',
                icon: Building2,
                color: 'bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400',
              },
              {
                title: 'Procurement & 3-Way Match',
                sub: `${procurementSummary.totalPOs} PO(s), ${procurementSummary.grnCount} GRN(s)`,
                status: procurementSummary.status,
                okText: 'Active',
                to: 'procurement',
                icon: ShieldCheck,
                color: 'bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400',
              },
              {
                title: 'Bank Reconciliation',
                sub: `${bankSummary.bankAccounts} bank account(s), ${bankSummary.unreconciledLines} unmatched line(s)`,
                status: bankSummary.status,
                okText: 'Reconciled',
                to: 'bank-reconciliation',
                icon: Landmark,
                color: 'bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400',
              },
            ].map((row) => {
              const Icon = row.icon;
              return (
                <div key={row.title} className="py-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${row.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{row.title}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.sub}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusBadgeStyle(row.status)}`}>
                      {statusLabel(row.status, row.okText)}
                    </span>
                    <Link to={row.to} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
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
        <Link to="." className="hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">
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
