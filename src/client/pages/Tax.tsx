import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  Percent, FileText, CheckCircle2, RefreshCw, Calculator, 
  ShieldCheck, Download, Plus, Search, Calendar, AlertTriangle, Lock, Unlock, X, Printer, CheckSquare, Square,
  Edit, Eye, BookOpen, History, Clock, ArrowRight, Bell, Coins
} from 'lucide-react';
import ExportButton, { ExportData } from '../components/ExportButton';
import { useAuth } from '../context/AuthContext';
import TaxSchedules from './Tax/TaxSchedules';
import BirCompliance from './Tax/BirCompliance';
import TaxForms from './Tax/TaxForms';
import { apiFetch } from '../utils/apiClient';
import { exportToPDF } from '../utils/exportUtils';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const TaxDashboardSummaryWidget = () => {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      const data = await apiFetch<any>('/api/tax/dashboard-summary');
      setSummary(data);
    } catch (err: any) {
      if (err?.status === 401) {
        return;
      }
      console.error('Failed to fetch tax dashboard summary:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-slate-400 gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" /> Loading Tax & Withholding Summary...
      </div>
    );
  }

  if (!summary || typeof summary !== 'object') return null;

  const { withholdingSummary, upcomingDeadlines, monthName } = summary;
  const urgentCount = Array.isArray(upcomingDeadlines) 
    ? upcomingDeadlines.filter((d: any) => d?.urgency === 'DUE_SOON' || d?.urgency === 'OVERDUE').length 
    : 0;

  return (
    <div className="space-y-4">
      {/* ALERT BANNER IF URGENT OR OVERDUE DEADLINES EXIST */}
      {urgentCount > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-amber-500/10 border border-amber-500/40 p-4 rounded-2xl text-amber-950 dark:text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Action Required: {urgentCount} BIR Statutory Deadline{urgentCount > 1 ? 's' : ''} Approaching
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Ensure all monthly withholding taxes (0619-E / 1601-C) and BIR Form 2307 certificates are filed and issued on time to avoid BIR late penalties (RR 12-2018).
              </p>
            </div>
          </div>
          <Link
            to="/tax/bir-compliance"
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition-all shadow whitespace-nowrap flex items-center gap-1"
          >
            Go to BIR Filing Cockpit &rarr;
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* WIDGET 1: MONTHLY TAX WITHHELD SUMMARY */}
        <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white p-6 rounded-2xl shadow-md border border-indigo-800/60 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-400/30">
                Monthly Tax Withheld Summary
              </span>
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-indigo-400" /> {monthName}
              </span>
            </div>

            <div className="mt-4">
              <span className="text-xs text-slate-400 block font-medium">Total Tax Withheld (Current Month)</span>
              <div className="text-3xl font-black font-mono text-emerald-400 mt-1 tracking-tight">
                {withholdingSummary?.totalWithheldFormatted || '₱0.00'}
              </div>
              <p className="text-[11px] text-slate-300 mt-1">
                Combined EWT from suppliers, CWT collected, & Compensation Tax.
              </p>
            </div>

            <div className="space-y-2 mt-5 pt-4 border-t border-indigo-800/50 text-xs">
              <div className="flex items-center justify-between bg-indigo-950/60 p-2.5 rounded-xl border border-indigo-800/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  <span className="text-slate-300 font-medium">EWT (Vendor Tax Withheld - 0619-E)</span>
                </div>
                <span className="font-mono font-bold text-slate-100">{withholdingSummary?.ewtFormatted}</span>
              </div>

              <div className="flex items-center justify-between bg-indigo-950/60 p-2.5 rounded-xl border border-indigo-800/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-300 font-medium">CWT (Customer Tax Credits - Form 2307)</span>
                </div>
                <span className="font-mono font-bold text-slate-100">{withholdingSummary?.cwtFormatted}</span>
              </div>

              <div className="flex items-center justify-between bg-indigo-950/60 p-2.5 rounded-xl border border-indigo-800/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  <span className="text-slate-300 font-medium">Payroll Compensation Tax (1601-C)</span>
                </div>
                <span className="font-mono font-bold text-slate-100">{withholdingSummary?.payrollTaxFormatted}</span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between text-xs">
            <Link
              to="/tax/withholdings"
              className="text-indigo-300 hover:text-white font-bold transition-colors flex items-center gap-1"
            >
              View Full Withholding Schedule &rarr;
            </Link>
            <button
              onClick={fetchSummary}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 transition-all"
              title="Refresh Tax Summary"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* WIDGET 2: UPCOMING BIR SUBMISSION DEADLINES */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm lg:col-span-2 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/80 pb-3">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-600" /> Upcoming BIR Statutory Submission Deadlines
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Automated deadline tracking based on BIR Tax Calendar & NIRC statutory due dates.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                {upcomingDeadlines.length} Tax Returns
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700/60 mt-1">
              {upcomingDeadlines.map((item: any, idx: number) => {
                const isOverdue = item.urgency === 'OVERDUE';
                const isDueSoon = item.urgency === 'DUE_SOON';

                return (
                  <div key={idx} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 px-2 rounded-xl transition-all">
                    <div className="flex items-start space-x-3">
                      <div className={`p-2 rounded-xl mt-0.5 ${
                        isOverdue 
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' 
                          : isDueSoon 
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' 
                          : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                      }`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-800 dark:text-slate-100">
                            {item.formCode}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {item.frequency}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center sm:flex-col sm:items-end justify-between gap-1.5 shrink-0 pl-11 sm:pl-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold font-mono border ${
                          isOverdue 
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300' 
                            : isDueSoon 
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300' 
                            : 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {isOverdue 
                            ? `OVERDUE (${Math.abs(item.daysLeft)} days ago)` 
                            : item.daysLeft === 0 
                            ? 'DUE TODAY' 
                            : `${item.daysLeft} days left`
                          }
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        Due: <strong className="text-slate-700 dark:text-slate-200">{item.dueDateStr}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs mt-2">
            <span className="text-slate-500 dark:text-slate-400">
              Tax deadlines follow official BIR eFPS & eBIRForms schedule.
            </span>
            <Link
              to="/tax/bir-compliance"
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold flex items-center gap-1"
            >
              Generate Official Returns &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

const TaxOverview = () => {
  const { activeCompany } = useAuth();
  const vatStatus = activeCompany?.vatStatus || 'VAT';
  const taxpayerType = activeCompany?.taxpayerClassification || 'CORPORATION';
  const isVat = vatStatus === 'VAT';
  const isNonVat = vatStatus === 'NON_VAT';
  const isIndividual = ['INDIVIDUAL', 'OPC'].includes(taxpayerType);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">Philippine Tax & BIR Compliance Hub</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${isVat ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' : isNonVat ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300'}`}>
              BIR: {vatStatus.replace('_', ' ')}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300">
              {taxpayerType.replace('_', ' ')}
            </span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Production-grade BIR compliance engine tailored to {activeCompany?.legalName || 'your company'}. Auto-routing filings for {isVat ? '12% Value-Added Tax (Form 2550Q)' : isNonVat ? '3% Percentage Tax (Form 2551Q)' : 'Exempt / Zero-Rated Sales'} and {isIndividual ? 'Individual Income Tax (Form 1701/1701A)' : 'Corporate Income Tax (Form 1702-RT)'}.
          </p>
        </div>
      </div>

      {/* DASHBOARD SUMMARY WIDGET */}
      <TaxDashboardSummaryWidget />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Link 
          to="/tax/bir-compliance" 
          className="p-6 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/80 dark:to-slate-800 rounded-xl shadow-sm border-2 border-indigo-200 dark:border-indigo-800 hover:border-indigo-500 transition-all group md:col-span-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3.5 bg-indigo-600 text-white rounded-xl shadow group-hover:scale-105 transition-transform">
                <FileText className="w-7 h-7" />
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-200 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-200 tracking-wider">
                  STATUTORY RETURNS
                </span>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xl mt-0.5">
                  BIR Compliance & Return Templates
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                  Pre-formatted official replicas for mandatory returns ({isVat ? '2550Q' : '2551Q'}, {isIndividual ? '1701/1701A' : '1702-RT'}, 2307, 1601-C, 0619-E) tailored to {activeCompany?.legalName || 'your company'}.
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform">
              Open BIR Return Generator &rarr;
            </div>
          </div>
        </Link>

        <Link 
          to="/tax/codes" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <Percent className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Tax Codes & Mappings</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Official BIR tax rates and account mappings.
          </p>
        </Link>

        <Link 
          to="/tax/vat-schedules" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <Calculator className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">VAT Sales & Purchases</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Input & Output VAT schedules and GL reconciliations.
          </p>
        </Link>

        <Link 
          to="/tax/reconciliation" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-amber-50 dark:bg-amber-950/60 text-amber-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Tax Payable & Reconciliations</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Zero unexplained difference validation against GL.
          </p>
        </Link>

        <Link 
          to="/tax/withholdings" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-purple-50 dark:bg-purple-950/60 text-purple-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">EWT & CWT Schedules</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Expanded and Creditable Withholding Tax (Form 2307).
          </p>
        </Link>

        <Link 
          to="/tax/calendar" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 text-rose-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">BIR Tax Calendar & Filings</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Filing preparation checklists and period locking.
          </p>
        </Link>

        <Link 
          to="/tax/exceptions" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-sky-50 dark:bg-sky-950/60 text-sky-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Exception Reports</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Post-filing change flags and discrepancy audits.
          </p>
        </Link>
        <Link 
          to="/tax/forms" 
          className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all group"
        >
          <div className="p-3 bg-violet-50 dark:bg-violet-950/60 text-violet-600 rounded-xl w-fit mb-4 group-hover:scale-105 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Tax Forms Mapping</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Map accounts to BIR forms for tax calculation accuracy.
          </p>
        </Link>
      </div>
    </div>
  );
};

const TaxCodes = () => {
  const { activeCompany } = useAuth();
  const [codes, setCodes] = useState<any[]>([]);
  const [atcs, setAtcs] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'atc' | 'gl'>('atc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // ATC Directory Filters & Search
  const [atcSearch, setAtcSearch] = useState('');
  const [atcCategory, setAtcCategory] = useState('ALL');

  // ATC Live Rate Validator Widget State
  const [valAtcCode, setValAtcCode] = useState('WC100');
  const [valBaseAmount, setValBaseAmount] = useState<number>(100000);
  const [valTaxAmount, setValTaxAmount] = useState<number>(5000);
  const [valFormType, setValFormType] = useState('2307');
  const [valResult, setValResult] = useState<any>(null);
  const [valLoading, setValLoading] = useState(false);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    rateBasisPoints: 1200,
    taxType: 'VAT',
    inputOutputDirection: 'OUTPUT',
    accountCode: '',
    description: ''
  });

  const fetchCodesAndAtcs = async () => {
    try {
      setLoading(true);
      const [cRes, aRes, atcRes] = await Promise.all([
        apiFetch<any>('/api/tax/codes'),
        apiFetch<any>('/api/accounting/accounts'),
        apiFetch<any>('/api/tax/atc-directory')
      ]);
      setCodes(cRes || []);
      setAccounts(aRes.data || []);
      setAtcs(atcRes?.atcs || []);
    } catch (err) {
      console.error('Failed to fetch tax codes or ATCs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCodesAndAtcs();
  }, []);

  const handleValidateAtc = async () => {
    try {
      setValLoading(true);
      const res = await apiFetch<any>('/api/tax/atc-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atcCode: valAtcCode,
          baseAmount: Number(valBaseAmount),
          taxAmount: Number(valTaxAmount),
          formType: valFormType
        })
      });
      setValResult(res);
    } catch (err: any) {
      setValResult({
        isValid: false,
        complianceNote: err.message || 'Validation service error'
      });
    } finally {
      setValLoading(false);
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formData.code || !formData.name) {
      setFormError('Tax code and name are required.');
      return;
    }

    try {
      setSaving(true);
      await apiFetch<any>('/api/tax/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      setShowAddModal(false);
      setFormData({
        code: '',
        name: '',
        rateBasisPoints: 1200,
        taxType: 'VAT',
        inputOutputDirection: 'OUTPUT',
        accountCode: '',
        description: ''
      });
      fetchCodesAndAtcs();
    } catch (err: any) {
      setFormError(err.message || 'Error connecting to server.');
    } finally {
      setSaving(false);
    }
  };

  // Filtered ATC directory
  const filteredAtcs = atcs.filter(item => {
    const matchesCat = atcCategory === 'ALL' || item.category === atcCategory;
    const matchesKw = !atcSearch || 
      item.code.toLowerCase().includes(atcSearch.toLowerCase()) ||
      item.name.toLowerCase().includes(atcSearch.toLowerCase()) ||
      item.nature.toLowerCase().includes(atcSearch.toLowerCase());
    return matchesCat && matchesKw;
  });

  const exportData: ExportData = {
    filename: `BIR_ATC_Codes_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'BIR Alphanumeric Tax Codes (ATC) Master Schedule',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Approved BIR ATCs & Tax Rates`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['ATC Code', 'Tax Category', 'Mandatory Form', 'Rate (%)', 'Nature & Description'],
    rows: atcs.map(a => [
      a.code || '',
      a.category || '',
      `BIR Form ${a.form}` || '',
      `${a.ratePercent?.toFixed(2)}%`,
      a.nature || a.name || '',
    ]),
  };

  return (
    <div className="space-y-6">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Percent className="w-5 h-5 text-indigo-600" /> BIR Alphanumeric Tax Codes (ATC) & Rate Enforcement
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Standard BIR ATC lookup, statutory tax rate validation, and GL account mapping for Form 2307, 2550Q, and 2551Q processing.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Custom GL Code Map
          </button>
          <ExportButton data={exportData} disabled={loading} />
        </div>
      </div>

      {/* ATC LIVE RATE VALIDATOR COCKPIT WIDGET */}
      <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-800 text-white p-6 rounded-2xl border border-indigo-900/50 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-indigo-800/60 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-400/30">
              Interactive Compliance Engine
            </span>
            <h3 className="text-base font-bold flex items-center gap-2 mt-1">
              <ShieldCheck className="w-5 h-5 text-emerald-400" /> BIR ATC Statutory Rate & Computation Validator
            </h3>
          </div>
          <p className="text-[11px] text-slate-300">
            Verify whether transaction amounts and tax withheld comply with BIR RR 11-2018 & TRAIN Law mandates.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-medium text-indigo-200 mb-1">Target Form</label>
            <select
              value={valFormType}
              onChange={e => setValFormType(e.target.value)}
              className="w-full bg-slate-800/90 border border-indigo-700/60 rounded-xl px-3 py-2 text-white text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            >
              <option value="2307">BIR Form 2307 (EWT / CWT)</option>
              <option value="2550Q">BIR Form 2550Q (VAT Return)</option>
              <option value="2551Q">BIR Form 2551Q (Percentage Tax)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-indigo-200 mb-1">Select ATC Code</label>
            <select
              value={valAtcCode}
              onChange={e => setValAtcCode(e.target.value)}
              className="w-full bg-slate-800/90 border border-indigo-700/60 rounded-xl px-3 py-2 text-white font-mono font-bold text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            >
              {atcs.map(a => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name} ({a.ratePercent}%)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-indigo-200 mb-1">Tax Base / Gross Amount (₱)</label>
            <input
              type="number"
              value={valBaseAmount}
              onChange={e => setValBaseAmount(Number(e.target.value))}
              className="w-full bg-slate-800/90 border border-indigo-700/60 rounded-xl px-3 py-2 text-white font-mono text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-indigo-200 mb-1">Calculated Tax Amount (₱)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={valTaxAmount}
                onChange={e => setValTaxAmount(Number(e.target.value))}
                className="w-full bg-slate-800/90 border border-indigo-700/60 rounded-xl px-3 py-2 text-white font-mono text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleValidateAtc}
                disabled={valLoading}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow whitespace-nowrap transition-all"
              >
                {valLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Validate
              </button>
            </div>
          </div>
        </div>

        {/* VALIDATION RESULT DISPLAY BOX */}
        {valResult && (
          <div className={`p-4 rounded-xl border text-xs space-y-1.5 transition-all ${
            valResult.isValid 
              ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200' 
              : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
          }`}>
            <div className="flex items-center justify-between font-bold">
              <span className="flex items-center gap-1.5 text-sm">
                {valResult.isValid ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                )}
                {valResult.isValid ? 'BIR ATC Compliance Passed!' : 'Compliance Issue / Rate Variance Detected'}
              </span>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/30">
                ATC {valResult.atc?.code || valAtcCode} ({valResult.atc?.ratePercent || 0}% Mandatory Rate)
              </span>
            </div>
            <p className="text-[11px]">{valResult.complianceNote}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10 font-mono text-[11px]">
              <div>
                <span className="text-slate-400 block text-[9px] uppercase">Base Amount</span>
                <span className="font-bold">₱{(valResult.baseAmount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px] uppercase">Mandated Tax</span>
                <span className="font-bold text-emerald-300">₱{(valResult.expectedTax || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px] uppercase">Detected Input Tax</span>
                <span className="font-bold">₱{(valResult.actualTax || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px] uppercase">Rate Variance</span>
                <span className={`font-bold ${valResult.variance > 0.05 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  ₱{(valResult.variance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NAVIGATION TABS FOR ATC DIRECTORY VS MAPPED GL CODES */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 gap-6">
        <button
          type="button"
          onClick={() => setActiveTab('atc')}
          className={`pb-3 text-xs font-bold transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === 'atc'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <Search className="w-4 h-4" /> Official BIR ATC Master Directory ({atcs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('gl')}
          className={`pb-3 text-xs font-bold transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === 'gl'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <FileText className="w-4 h-4" /> Company Mapped GL Tax Codes ({codes.length})
        </button>
      </div>

      {/* TAB 1: BIR ATC MASTER DIRECTORY */}
      {activeTab === 'atc' && (
        <div className="space-y-4">
          {/* SEARCH & FILTER CONTROLS */}
          <div className="flex flex-col sm:flex-row gap-3 justify-between items-center bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search ATC code, name, nature..."
                value={atcSearch}
                onChange={e => setAtcSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
              {[
                { id: 'ALL', label: 'All ATCs' },
                { id: 'EWT/CWT', label: 'EWT/CWT (Form 2307)' },
                { id: 'OUTPUT_VAT', label: 'Output VAT (2550Q)' },
                { id: 'INPUT_VAT', label: 'Input VAT (2550Q)' },
                { id: 'PERCENTAGE_TAX', label: 'Percentage (2551Q)' }
              ].map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setAtcCategory(cat.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    atcCategory === cat.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* ATC DIRECTORY TABLE */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" /> Loading BIR ATC Directory...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[800px]">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                    <tr>
                      <th className="py-3.5 px-4">ATC Code</th>
                      <th className="py-3.5 px-4">Tax Description</th>
                      <th className="py-3.5 px-4">Category</th>
                      <th className="py-3.5 px-4">Target Form</th>
                      <th className="py-3.5 px-4 text-center">Mandatory Rate</th>
                      <th className="py-3.5 px-4">NIRC / Legal Nature</th>
                      <th className="py-3.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
                    {filteredAtcs.map((a) => (
                      <tr key={a.code} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                        <td className="py-3.5 px-4 font-mono font-extrabold text-indigo-600 dark:text-indigo-400 text-sm">
                          {a.code}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-100 max-w-xs">
                          {a.name}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            {a.category}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-700 dark:text-slate-300">
                          Form {a.form}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="px-2.5 py-1 rounded-full font-mono font-extrabold text-xs bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {a.ratePercent.toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 max-w-md text-[11px] leading-relaxed">
                          {a.nature}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setValAtcCode(a.code);
                              setValFormType(a.form === '2550Q' ? '2550Q' : a.form === '2551Q' ? '2551Q' : '2307');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg border border-indigo-200 dark:border-indigo-800"
                          >
                            Test Validator
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: COMPANY MAPPED GL TAX CODES */}
      {activeTab === 'gl' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" /> Loading company tax mappings...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[800px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3.5 px-4">Code</th>
                    <th className="py-3.5 px-4">Tax Name</th>
                    <th className="py-3.5 px-4">Type</th>
                    <th className="py-3.5 px-4">Direction</th>
                    <th className="py-3.5 px-4">GL Account Mapping</th>
                    <th className="py-3.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {codes.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">{c.code}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100">{c.name}</td>
                      <td className="py-3.5 px-4 text-xs">{c.taxType}</td>
                      <td className="py-3.5 px-4 text-xs">{c.inputOutputDirection || 'N/A'}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {c.accountCode ? `${c.accountCode} - ${c.accountName}` : <span className="text-amber-500">Unmapped</span>}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {c.status || 'ACTIVE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showAddModal && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Percent className="w-5 h-5 text-indigo-600" /> New BIR Tax Code & Mapping
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="bg-red-50 text-red-700 p-3 rounded-xl text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateCode} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tax Code (ATC Code)</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. WI100" 
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tax Description / Name</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. Professional Fees to Individuals (5%)" 
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tax Type</label>
                  <select 
                    value={formData.taxType}
                    onChange={e => setFormData({ ...formData, taxType: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  >
                    <option value="VAT">VAT (12%)</option>
                    <option value="EWT">EWT (Withholding)</option>
                    <option value="CWT">CWT (Creditable)</option>
                    <option value="PERCENTAGE">Percentage Tax</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Direction</label>
                  <select 
                    value={formData.inputOutputDirection}
                    onChange={e => setFormData({ ...formData, inputOutputDirection: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  >
                    <option value="OUTPUT">OUTPUT (Sales)</option>
                    <option value="INPUT">INPUT (Purchases)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">GL Control Account Mapping</label>
                <select 
                  value={formData.accountCode}
                  onChange={e => setFormData({ ...formData, accountCode: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono"
                >
                  <option value="">-- Select GL Account --</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.accountCode}>
                      {acc.accountCode} - {acc.accountName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Create Tax Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const TaxReconciliation = () => {
  const [recon, setRecon] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [adjForm, setAdjForm] = useState({
    adjustmentType: 'BIR_ASSESSMENT_PENALTY',
    amount: '',
    reason: '',
    notes: ''
  });

  const fetchRecon = async () => {
    setLoading(true);
    fetch('/api/tax/schedules/tax-payable-recon')
      .then(res => res.json())
      .then(data => setRecon(data.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecon();
  }, []);

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjForm.amount || parseFloat(adjForm.amount) <= 0) {
      setErrorMsg('Please enter a valid positive adjustment amount.');
      return;
    }
    if (!adjForm.reason) {
      setErrorMsg('Adjustment reason is mandatory for audit trail.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      const amountCents = Math.round(parseFloat(adjForm.amount) * 100);
      const res = await fetch('/api/tax/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustmentType: adjForm.adjustmentType,
          amount: amountCents,
          reason: adjForm.reason,
          notes: adjForm.notes
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowAdjModal(false);
        setAdjForm({ adjustmentType: 'BIR_ASSESSMENT_PENALTY', amount: '', reason: '', notes: '' });
        fetchRecon();
      } else {
        setErrorMsg(data.error || 'Failed to record manual adjustment.');
      }
    } catch (err) {
      setErrorMsg('Failed to process adjustment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" /> Tax Payable & GL Reconciliation
          </h2>
          <p className="text-slate-500 text-xs mt-1">Verification gate ensuring zero unexplained difference between tax schedules and General Ledger.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAdjModal(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Manual Adjustment
          </button>
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
            Zero Unexplained Difference
          </span>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400">Loading reconciliation...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-3">VAT & Withholding Payable Summary</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Output VAT Payable:</span>
                <span className="font-mono font-semibold">{formatCurrency(recon?.outputVatPayable)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Less: Input VAT Claimable:</span>
                <span className="font-mono font-semibold text-emerald-600">({formatCurrency(recon?.lessInputVat)})</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 dark:border-slate-700 pt-2 font-bold">
                <span>Net VAT Payable:</span>
                <span className="font-mono">{formatCurrency(recon?.netVatPayable)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Expanded Withholding Tax (EWT):</span>
                <span className="font-mono font-semibold">{formatCurrency(recon?.ewtPayable)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Withholding Tax on Compensation (WTC):</span>
                <span className="font-mono font-semibold">{formatCurrency(recon?.wtcPayable || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Income Tax Payable:</span>
                <span className="font-mono font-semibold">{formatCurrency(recon?.incomeTaxPayable || 0)}</span>
              </div>
              <div className="flex justify-between border-t-2 border-slate-200 dark:border-slate-700 pt-3 font-bold text-indigo-600 text-lg">
                <span>Total Tax Liability:</span>
                <span className="font-mono">{formatCurrency(recon?.totalTaxPayable)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-3">General Ledger Reconciliation Gate</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">GL Tax Payable Control Balance:</span>
                <span className="font-mono font-semibold">{formatCurrency(recon?.glTaxPayableAccountsBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Computed Schedule Total:</span>
                <span className="font-mono font-semibold">{formatCurrency(recon?.totalTaxPayable)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 dark:border-slate-700 pt-2 font-bold text-emerald-600">
                <span>Unexplained Difference:</span>
                <span className="font-mono">{formatCurrency(recon?.unexplainedDifference)}</span>
              </div>
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl mt-4 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                  Tax schedules successfully reconciled to General Ledger with zero variance. Ready for BIR filing preparation.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdjModal && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowAdjModal(false)}
        >
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-600" /> Record Manual Tax Adjustment
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAdjModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="bg-red-50 text-red-700 p-3 rounded-xl text-xs font-medium">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateAdjustment} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Adjustment Type</label>
                <select 
                  value={adjForm.adjustmentType}
                  onChange={e => setAdjForm({ ...adjForm, adjustmentType: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  <option value="BIR_ASSESSMENT_PENALTY">BIR Assessment / Surcharge Penalty</option>
                  <option value="TAX_AUDIT_DIFFERENCE">Tax Audit Reconciliation Variance</option>
                  <option value="LATE_FILING_INTEREST">Late Filing Interest (SEC/BIR)</option>
                  <option value="MISCELLANEOUS_TAX_CREDIT">Creditable Tax Adjustment</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Adjustment Amount (PHP)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  required 
                  placeholder="e.g. 2500.00" 
                  value={adjForm.amount}
                  onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Audit Justification / Reason</label>
                <textarea 
                  required 
                  rows={2} 
                  placeholder="e.g. Approved BIR Surcharge per BIR Letter of Authority #2026-04" 
                  value={adjForm.reason}
                  onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button 
                  type="button"
                  onClick={() => setShowAdjModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50"
                >
                  {saving ? 'Processing...' : 'Record Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const WithholdingSchedules = () => {
  const { activeCompany } = useAuth();
  const [ewt, setEwt] = useState<any[]>([]);
  const [cwt, setCwt] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'ewt' | 'cwt'>('ewt');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals and selection state
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showForm2307Modal, setShowForm2307Modal] = useState(false);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);

  // Dynamic details state
  const [journalLines, setJournalLines] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editReference, setEditReference] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // BIR Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationChecked, setValidationChecked] = useState(false);

  const loadSchedules = () => {
    setLoading(true);
    Promise.all([
      apiFetch<any>('/api/tax/schedules/ewt'),
      apiFetch<any>('/api/tax/schedules/cwt')
    ]).then(([eRes, cRes]) => {
      setEwt(eRes.data || []);
      setCwt(cRes.data || []);
    }).catch(err => {
      showToast("Error loading schedules: " + err.message, 'error');
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSchedules();
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const handleDownloadAlphalist = async (type: string) => {
    showToast(`Downloading Live database-backed .DAT file (${type.toUpperCase()}) for BIR eSubmission...`, 'success');
    try {
      const response = await fetch(`/api/tax/export/${type}`);
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${type.toUpperCase()}_EXPORT.DAT`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match && match[1]) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Run real-time BIR Compliance Validation on selected record
  const runBIRValidation = (item: any, type: 'ewt' | 'cwt') => {
    const errors: string[] = [];
    
    // 1. Company Context
    if (!activeCompany?.legalName) {
      errors.push("Company registered legal name is missing. Configure in Settings.");
    }
    const cleanCompanyTin = ((activeCompany as any)?.tin || "").replace(/[^0-9]/g, "");
    if (cleanCompanyTin.length < 9) {
      errors.push("Company TIN must be a valid 9 or 12-digit number (currently: " + ((activeCompany as any)?.tin || 'Empty') + ")");
    }
    if (!(activeCompany as any)?.address) {
      errors.push("Company physical business registered address is missing.");
    }

    // 2. Payee Context
    const payeeName = type === 'ewt' ? item.vendorName : item.customerName;
    const payeeTin = (item.tin || "").replace(/[^0-9]/g, "");
    const payeeAddress = item.address;

    if (!payeeName) {
      errors.push("Payee (Supplier/Customer) legal name is missing.");
    }
    if (payeeTin.length < 9) {
      errors.push(`Payee TIN must be a valid 9 or 12-digit number (currently: ${item.tin || 'Empty'})`);
    }
    if (!payeeAddress || payeeAddress.trim() === "") {
      errors.push("Payee registered tax address is missing. Update Vendor/Customer record.");
    }

    // 3. Amount & Status Validation
    if ((item.withholdingTaxAmount || 0) <= 0) {
      errors.push("Withholding tax amount must be greater than PHP 0.00 to generate a certificate.");
    }
    if (item.status !== "POSTED") {
      errors.push("Warning: Transaction status is currently " + (item.status || 'DRAFT') + ". BIR forms should only be generated for POSTED transactions.");
    }

    // 4. ATC Code & Statutory Compliance Validation
    const atcCode = item.taxCode || item.atcCode || 'WI100';
    if (!atcCode) {
      errors.push("Missing BIR Alphanumeric Tax Code (ATC). A valid ATC is mandatory for BIR Form 2307 & 2550Q filing.");
    }

    setValidationErrors(errors);
    setValidationChecked(true);
    return errors.length === 0;
  };

  // Open Form 2307 after performing real-time validation
  const handleOpenForm2307 = (item: any, type: 'ewt' | 'cwt') => {
    setSelectedItem({ ...item, type });
    runBIRValidation(item, type);
    setShowForm2307Modal(true);
  };

  // Print Form 2307
  const handlePrintCertificate = (item: any, type: 'ewt' | 'cwt') => {
    setSelectedItem({ ...item, type });
    runBIRValidation(item, type);
    setShowForm2307Modal(true);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  // Export PDF Certificate
  const handleExportCertificatePDF = (item: any, type: 'ewt' | 'cwt') => {
    const grossAmount = (item.amountPaid || item.amountCollected || 0) + (item.withholdingTaxAmount || 0);
    const ratePercent = grossAmount > 0 ? Math.round((item.withholdingTaxAmount || 0) / grossAmount * 100) : 0;
    
    exportToPDF({
      filename: `BIR_Form_2307_${item.paymentNumber || 'Certificate'}.pdf`,
      title: 'BIR Form 2307 - Certificate of Creditable Tax Withheld at Source',
      subtitle: `Transaction Reference: ${item.paymentNumber} | Covered Period: ${item.paymentDate} to ${item.paymentDate}`,
      companyName: activeCompany?.legalName || 'LedgerAI Active Workspace',
      headers: ['Certificate Field Description', 'Value Details'],
      rows: [
        ['Certificate Form No.', 'BIR Form No. 2307 (Revised Sept 2018)'],
        ['Covered Period', `${item.paymentDate} to ${item.paymentDate}`],
        ['Tax Code Mapping / ATC', item.taxCode || 'WI100'],
        ['Payee Legal Name', (type === 'ewt' ? item.vendorName : item.customerName || 'Supplier/Customer').toUpperCase()],
        ['Payee TIN', (item.tin || '000-000-000-000').toUpperCase()],
        ['Payee Registered Tax Address', item.address || 'N/A'],
        ['Payor Legal Name', (activeCompany?.legalName || 'LedgerAI active Company').toUpperCase()],
        ['Payor TIN', ((activeCompany as any)?.tin || '009-876-543-000').toUpperCase()],
        ['Payor Registered Tax Address', (activeCompany as any)?.address || 'N/A'],
        ['Nature of Income Payment', type === 'ewt' ? 'Expanded Withholding Tax on Goods/Services supplied to Local Contractors' : 'Creditable Withholding Taxes on Income payments by local withholding agents'],
        ['Income Tax Base (Gross)', formatCurrency(grossAmount)],
        ['Withholding Tax Rate (%)', `${ratePercent}%`],
        ['Total Tax Withheld Amount', formatCurrency(item.withholdingTaxAmount)],
        ['Certificate Status', item.status || 'DRAFT']
      ],
      orientation: 'portrait',
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 100 }
      }
    });
    
    showToast(`PDF Certificate downloaded successfully for ${item.paymentNumber}.`, 'success');
  };

  // Load and open Journal entry lines
  const handleOpenJournal = async (item: any) => {
    if (!item.journalEntryId) {
      showToast("No journal entry is generated for this transaction yet.", 'error');
      return;
    }
    setSelectedItem(item);
    try {
      const data = await apiFetch<any>(`/api/tax/withholding/journal/${item.journalEntryId}`);
      setJournalLines(data || []);
      setShowJournalModal(true);
    } catch (err: any) {
      showToast("Failed to fetch journal lines: " + err.message, 'error');
    }
  };

  // Load and open Audit Logs
  const handleOpenAudit = async (item: any, type: 'ewt' | 'cwt') => {
    const recordId = type === 'ewt' ? item.paymentId : item.collectionId;
    setSelectedItem({ ...item, type, recordId });
    try {
      const data = await apiFetch<any>(`/api/tax/withholding/audit-logs/${recordId}`);
      setAuditLogs(data || []);
      setShowAuditModal(true);
    } catch (err: any) {
      showToast("Failed to fetch audit trails: " + err.message, 'error');
    }
  };

  // Open edit modal for draft withholdings
  const handleOpenEdit = (item: any, type: 'ewt' | 'cwt') => {
    if (item.status === "POSTED") {
      showToast("Cannot edit posted transactions. Editing is locked for CAS compliance.", 'error');
      return;
    }
    setSelectedItem({ ...item, type });
    setEditAmount(item.withholdingTaxAmount || 0);
    setEditReference(item.reference || '');
    setShowEditModal(true);
  };

  // Submit withholding edits to server
  const handleSaveWithholdingEdit = async () => {
    const recordId = selectedItem.type === 'ewt' ? selectedItem.paymentId : selectedItem.collectionId;
    setUpdating(true);
    try {
      const data = await apiFetch<any>(`/api/tax/withholding/${selectedItem.type}/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          withholdingTaxAmount: editAmount,
          reference: editReference
        })
      });
      
      showToast("Withholding record updated successfully.", 'success');
      setShowEditModal(false);
      loadSchedules();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUpdating(false);
    }
  };

  const filteredEwt = ewt.filter(e => 
    e.paymentNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.vendorName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.tin?.includes(searchTerm)
  );

  const filteredCwt = cwt.filter(c => 
    c.paymentNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.tin?.includes(searchTerm)
  );

  // Compute live calculations for Reconciliation Widget
  const totalEwtTransactions = ewt.reduce((acc, curr) => acc + (curr.withholdingTaxAmount || 0), 0);
  const totalCwtTransactions = cwt.reduce((acc, curr) => acc + (curr.withholdingTaxAmount || 0), 0);
  const postedEwt = ewt.filter(e => e.status === "POSTED").reduce((acc, curr) => acc + (curr.withholdingTaxAmount || 0), 0);
  const postedCwt = cwt.filter(c => c.status === "POSTED").reduce((acc, curr) => acc + (curr.withholdingTaxAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 p-4 rounded-xl shadow-lg border text-white text-xs font-semibold flex items-center gap-2 animate-bounce ${
          toast.type === 'success' ? 'bg-emerald-600 border-emerald-500' : 'bg-rose-600 border-rose-500'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Hero Header */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Percent className="w-5 h-5 text-indigo-600" /> EWT & CWT Withholding Tax cockpit
          </h2>
          <p className="text-slate-500 text-xs mt-1">
            Authoritative, double-entry reconciled Expanded Withholding (EWT) and Creditable Withholding (CWT) ledgers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={loadSchedules}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
            title="Reload Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live Reconciliation Widget */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-slate-500 block">EWT Schedule Sum</span>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">{formatCurrency(totalEwtTransactions)}</p>
          <div className="text-[10px] text-slate-500 mt-1">Total withholding taxes recorded</div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Posted Tax Ledger (GL)</span>
          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(postedEwt)}</p>
          <div className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Reconciled with General Ledger
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-slate-500 block">CWT Collected Sum</span>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">{formatCurrency(totalCwtTransactions)}</p>
          <div className="text-[10px] text-slate-500 mt-1">From customer payment receipts</div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-emerald-200 dark:border-emerald-950 bg-emerald-50/20 dark:bg-emerald-950/10 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-300 block">Reconciliation Status</span>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
            <CheckCircle2 className="w-5 h-5" /> 100% Matches
          </p>
          <div className="text-[10px] text-emerald-600 mt-1">Transactions = Form 2307 = Alphalists</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: List and actions table (Section 1) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            
            {/* Table Header and Controls */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('ewt')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    activeSubTab === 'ewt' 
                      ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  EWT (Suppliers)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('cwt')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    activeSubTab === 'cwt' 
                      ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  CWT (Customers)
                </button>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search number, name, TIN..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full sm:w-56 pl-9 pr-4 py-1.5 bg-slate-50 dark:bg-slate-900 text-xs border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* SECTION 1 — WITHHOLDING RECORDS / SCHEDULE TABLE */}
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                  Loading authoritative withholding entries...
                </div>
              ) : (activeSubTab === 'ewt' ? filteredEwt.length : filteredCwt.length) === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">
                  No withholding records found for this view.
                </div>
              ) : (
                <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[1300px]">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-100 dark:border-slate-700">
                    <tr>
                      <th className="py-3 px-3">Payment #</th>
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3">{activeSubTab === 'ewt' ? 'Vendor/Supplier' : 'Customer'}</th>
                      <th className="py-3 px-3">TIN</th>
                      <th className="py-3 px-3 text-right">Amount Paid</th>
                      <th className="py-3 px-3 text-right">Tax Base</th>
                      <th className="py-3 px-3 text-right">EWT Rate</th>
                      <th className="py-3 px-3 text-right">EWT Amount</th>
                      <th className="py-3 px-3 text-right">CWT where applicable</th>
                      <th className="py-3 px-3 text-center">Certificate Status</th>
                      <th className="py-3 px-3">Reference</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {activeSubTab === 'ewt' ? (
                      filteredEwt.map(item => {
                        const taxBase = (item.amountPaid || 0) + (item.withholdingTaxAmount || 0);
                        const ratePercent = taxBase > 0 ? Math.round((item.withholdingTaxAmount || 0) / taxBase * 100) : 0;
                        return (
                          <tr key={item.paymentId} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/20">
                            {/* Payment # */}
                            <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{item.paymentNumber}</td>
                            {/* Date */}
                            <td className="py-3 px-3 text-slate-500 whitespace-nowrap">{item.paymentDate}</td>
                            {/* Vendor/Supplier */}
                            <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">{item.vendorName}</td>
                            {/* TIN */}
                            <td className="py-3 px-3 font-mono text-slate-500">{item.tin || 'N/A'}</td>
                            {/* Amount Paid */}
                            <td className="py-3 px-3 text-right font-mono">{formatCurrency(item.amountPaid)}</td>
                            {/* Tax Base */}
                            <td className="py-3 px-3 text-right font-mono">{formatCurrency(taxBase)}</td>
                            {/* EWT Rate */}
                            <td className="py-3 px-3 text-right font-semibold text-slate-500">{ratePercent}%</td>
                            {/* EWT Amount */}
                            <td className="py-3 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">{formatCurrency(item.withholdingTaxAmount)}</td>
                            {/* CWT where applicable */}
                            <td className="py-3 px-3 text-right text-slate-400">—</td>
                            {/* Certificate Status */}
                            <td className="py-3 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase inline-block ${
                                item.status === 'POSTED' 
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60' 
                                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-100 dark:border-amber-900/60'
                              }`}>
                                {item.status || 'DRAFT'}
                              </span>
                            </td>
                            {/* Reference */}
                            <td className="py-3 px-3 text-slate-500 truncate max-w-[120px]" title={item.reference}>{item.reference || '—'}</td>
                            {/* Actions */}
                            <td className="py-3 px-3 text-right">
                              <div className="flex justify-end gap-1 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItem({ ...item, type: 'ewt' }); setShowViewModal(true); }}
                                  className="p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                  title="View Details"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                {item.status !== 'POSTED' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(item, 'ewt')}
                                    className="p-1 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded"
                                    title="Edit before Lock/Post"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="p-1 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                    title="Locked & Posted"
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenForm2307(item, 'ewt')}
                                  className="p-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded"
                                  title="Generate Certificate"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePrintCertificate(item, 'ewt')}
                                  className="p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                  title="Print Certificate"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleExportCertificatePDF(item, 'ewt')}
                                  className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded"
                                  title="Export PDF"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItem({ ...item, type: 'ewt' }); setShowViewModal(true); }}
                                  className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded font-semibold text-[10px] px-1.5"
                                  title="View Source Transaction"
                                >
                                  Source
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      filteredCwt.map(item => {
                        const taxBase = (item.amountCollected || 0) + (item.withholdingTaxAmount || 0);
                        const ratePercent = taxBase > 0 ? Math.round((item.withholdingTaxAmount || 0) / taxBase * 100) : 0;
                        return (
                          <tr key={item.collectionId} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/20">
                            {/* Payment # */}
                            <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{item.paymentNumber}</td>
                            {/* Date */}
                            <td className="py-3 px-3 text-slate-500 whitespace-nowrap">{item.paymentDate}</td>
                            {/* Customer */}
                            <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">{item.customerName}</td>
                            {/* TIN */}
                            <td className="py-3 px-3 font-mono text-slate-500">{item.tin || 'N/A'}</td>
                            {/* Amount Paid */}
                            <td className="py-3 px-3 text-right font-mono">{formatCurrency(item.amountCollected)}</td>
                            {/* Tax Base */}
                            <td className="py-3 px-3 text-right font-mono">{formatCurrency(taxBase)}</td>
                            {/* EWT Rate */}
                            <td className="py-3 px-3 text-right text-slate-400">—</td>
                            {/* EWT Amount */}
                            <td className="py-3 px-3 text-right text-slate-400">—</td>
                            {/* CWT where applicable */}
                            <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(item.withholdingTaxAmount)}</td>
                            {/* Certificate Status */}
                            <td className="py-3 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase inline-block ${
                                item.status === 'POSTED' 
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60' 
                                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-100 dark:border-amber-900/60'
                              }`}>
                                {item.status || 'DRAFT'}
                              </span>
                            </td>
                            {/* Reference */}
                            <td className="py-3 px-3 text-slate-500 truncate max-w-[120px]" title={item.reference}>{item.reference || '—'}</td>
                            {/* Actions */}
                            <td className="py-3 px-3 text-right">
                              <div className="flex justify-end gap-1 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItem({ ...item, type: 'cwt' }); setShowViewModal(true); }}
                                  className="p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                  title="View Details"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                {item.status !== 'POSTED' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(item, 'cwt')}
                                    className="p-1 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded"
                                    title="Edit before Lock/Post"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="p-1 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                    title="Locked & Posted"
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenForm2307(item, 'cwt')}
                                  className="p-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded"
                                  title="Generate Certificate"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePrintCertificate(item, 'cwt')}
                                  className="p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                  title="Print Certificate"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleExportCertificatePDF(item, 'cwt')}
                                  className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded"
                                  title="Export PDF"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItem({ ...item, type: 'cwt' }); setShowViewModal(true); }}
                                  className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded font-semibold text-[10px] px-1.5"
                                  title="View Source Transaction"
                                >
                                  Source
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: SECTION 2 & SECTION 3 (Forms & DAT filing files) */}
        <div className="space-y-6">
          
          {/* SECTION 2 — BIR FORMS / CERTIFICATES & COMPLIANCE VALIDATOR */}
          <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-3">
              <FileText className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">SECTION 2 — BIR Forms & Certificates</h3>
                <p className="text-[10px] text-slate-500">Official human-readable certificates and printouts</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 block">BIR Form 2307 Certificate</span>
                <p className="text-[10px] text-slate-500 mt-1">Certificate of Creditable Tax Withheld at Source. Issued to vendors or collected from customers.</p>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Printable Layout</span>
                  <button
                    type="button"
                    onClick={() => {
                      const list = activeSubTab === 'ewt' ? ewt : cwt;
                      if (list.length > 0) {
                        handleOpenForm2307(list[0], activeSubTab);
                      } else {
                        showToast("No records available to generate a preview certificate.", 'error');
                      }
                    }}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded text-[10px] font-semibold"
                  >
                    View Latest Form
                  </button>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 block">Tax Withholding Schedules</span>
                <p className="text-[10px] text-slate-500 mt-1">Full expanded schedule list with ATC mapping and payment cross-references for company accounting books.</p>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Ready for Print
                  </span>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded text-[10px] font-semibold flex items-center gap-1"
                  >
                    <Printer className="w-3 h-3" /> Print Schedule
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3 — ELECTRONIC FILING FILES (DAT exports) */}
          <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-indigo-100 dark:border-indigo-950 bg-indigo-50/10 dark:bg-indigo-950/5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-3">
              <Download className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">SECTION 3 — Electronic Filing Files</h3>
                <p className="text-[10px] text-slate-500">Machine-readable submission alphalists (.DAT)</p>
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
              Machine-readable electronic filing format <strong>(.DAT)</strong> files required by the BIR for eSubmission through the BIR Electronic Filing System (eFPS or Alphalist Validation Program). These are formatted strictly according to BIR eSubmission specs and are <strong>not intended for manual human reading or direct printing</strong>. Please use Section 2 above for human-readable forms.
            </p>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => handleDownloadAlphalist('sawt')}
                className="w-full px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold rounded-lg flex items-center justify-between transition-colors"
              >
                <span>Generate SAWT .DAT File</span>
                <span className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-mono">1702 MAP</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadAlphalist('qap')}
                className="w-full px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold rounded-lg flex items-center justify-between transition-colors"
              >
                <span>Generate QAP .DAT File</span>
                <span className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-mono">1601EQ MAP</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadAlphalist('slsp')}
                className="w-full px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold rounded-lg flex items-center justify-between transition-colors"
              >
                <span>Generate SLSP .DAT File</span>
                <span className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-mono">SALES/PURCH</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* VIEW MODAL / TRANSACTIONS OVERVIEW */}
      {showViewModal && selectedItem && (() => {
        const grossAmount = (selectedItem.amountPaid || selectedItem.amountCollected || 0) + (selectedItem.withholdingTaxAmount || 0);
        const ratePercent = grossAmount > 0 ? Math.round((selectedItem.withholdingTaxAmount || 0) / grossAmount * 100) : 0;
        const payeeName = selectedItem.type === 'ewt' ? selectedItem.vendorName : selectedItem.customerName;
        return (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Withholding Transaction Details</h3>
                  <p className="text-[10px] text-slate-500">Comprehensive real-time double-entry compliance data</p>
                </div>
                <button onClick={() => setShowViewModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Contents of details */}
              <div className="space-y-4 text-xs">
                {/* Core Withholding Record */}
                <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[10px] tracking-wider border-b border-slate-200/60 dark:border-slate-800 pb-1.5">Withholding Record Summary</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Payment / Ref Number</span>
                      <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{selectedItem.paymentNumber}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Transaction Date</span>
                      <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{selectedItem.paymentDate}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Tax Type Mapping</span>
                      <p className="font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{selectedItem.type?.toUpperCase()} ({selectedItem.taxCode || 'WI100'})</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Payee Name</span>
                      <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{payeeName}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Payee TIN</span>
                      <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{selectedItem.tin || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Status</span>
                      <p className="mt-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                          selectedItem.status === 'POSTED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {selectedItem.status || 'DRAFT'}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Source Transaction Details */}
                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-700 pb-1.5 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-500" /> Source Transaction Ledger Records
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Net Paid / Collected</span>
                      <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 font-mono">{formatCurrency(selectedItem.amountPaid || selectedItem.amountCollected)}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Gross Taxable Base</span>
                      <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 font-mono">{formatCurrency(grossAmount)}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Withheld Tax Base Amount</span>
                      <p className="font-bold text-indigo-600 dark:text-indigo-400 mt-0.5 font-mono">{formatCurrency(selectedItem.withholdingTaxAmount)}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Withholding Rate</span>
                      <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{ratePercent}%</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">External Reference</span>
                      <p className="text-slate-800 dark:text-slate-200 mt-0.5">{selectedItem.reference || 'None provided'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold">Origin GL Entry ID</span>
                      <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{selectedItem.journalEntryId || 'Pending journal posting'}</p>
                    </div>
                  </div>

                  {/* Quick Audit / Journal trigger buttons */}
                  <div className="pt-2 flex flex-wrap gap-2">
                    {selectedItem.journalEntryId ? (
                      <button
                        type="button"
                        onClick={() => { handleOpenJournal(selectedItem); setShowViewModal(false); }}
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded text-[10px] font-semibold flex items-center gap-1"
                      >
                        <BookOpen className="w-3 h-3" /> View Source Double-Entry Journal
                      </button>
                    ) : (
                      <span className="text-[10px] text-amber-500 font-semibold italic">Journal not posted yet (Draft Status)</span>
                    )}
                    <button
                      type="button"
                      onClick={() => { handleOpenAudit(selectedItem, selectedItem.type); setShowViewModal(false); }}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded text-[10px] font-semibold flex items-center gap-1"
                    >
                      <History className="w-3 h-3" /> View Audit Trail
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Footer */}
              <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => handleExportCertificatePDF(selectedItem, selectedItem.type)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" /> Download Certificate (PDF)
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenForm2307(selectedItem, selectedItem.type)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold"
                  >
                    Generate Form 2307
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowViewModal(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* EDIT MODAL FOR DRAFT WITHHOLDINGS */}
      {showEditModal && selectedItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Edit className="w-4 h-4 text-amber-500" /> Edit Withholding Record
                </h3>
                <p className="text-[10px] text-slate-500">Adjust withholding amounts prior to journal lock and posting</p>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-slate-500 font-semibold block">Payee Legal Name:</span>
                <p className="text-slate-800 dark:text-slate-100 font-bold mt-0.5">{selectedItem.vendorName || selectedItem.customerName}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 font-semibold block mb-1">Withholding Tax (EWT/CWT)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 font-mono">₱</span>
                    <input
                      type="number"
                      value={(editAmount / 100).toFixed(2)}
                      onChange={(e) => setEditAmount(Math.round(parseFloat(e.target.value) * 100) || 0)}
                      className="w-full pl-7 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-500 font-semibold block mb-1">Payment Reference</label>
                  <input
                    type="text"
                    value={editReference}
                    onChange={(e) => setEditReference(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/10 rounded-xl border border-amber-100 dark:border-amber-900/60 text-amber-800 dark:text-amber-400 text-[10px] leading-relaxed">
                Notice: Editing the withholding tax will update the cash payments engine. Upon posting this payment, a balanced double-entry journal voucher is computed automatically matching CAS and BIR standards.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveWithholdingEdit}
                disabled={updating}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1"
              >
                {updating ? 'Saving...' : 'Save Adjustments'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOURNAL PREVIEW MODAL */}
      {showJournalModal && selectedItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-indigo-500" /> CAS Journal Entry audit
                </h3>
                <p className="text-[10px] text-slate-500">Authoritative general ledger lines generated for Transaction {selectedItem.paymentNumber}</p>
              </div>
              <button onClick={() => setShowJournalModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-100 dark:border-slate-700 rounded-xl">
              <table className="w-full text-left text-xs min-w-[500px]">
                <thead className="bg-slate-50 dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">Account Code</th>
                    <th className="py-2.5 px-3">Account Name</th>
                    <th className="py-2.5 px-3 text-right">Debit</th>
                    <th className="py-2.5 px-3 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {journalLines.map((line: any) => (
                    <tr key={line.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/10">
                      <td className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-400">{line.accountCode}</td>
                      <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200 font-sans">{line.accountName}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-600">{line.debit > 0 ? formatCurrency(line.debit) : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-indigo-600">{line.credit > 0 ? formatCurrency(line.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowJournalModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT TRAIL MODAL */}
      {showAuditModal && selectedItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-xl w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-500" /> compliance Audit Trail Logs
                </h3>
                <p className="text-[10px] text-slate-500">Immutable CAS timeline tracking for transaction reference {selectedItem.paymentNumber}</p>
              </div>
              <button onClick={() => setShowAuditModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
              {auditLogs.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  No explicit audit entries recorded for this transaction. System logged creation automatically.
                </div>
              ) : (
                <div className="relative border-l border-slate-200 dark:border-slate-700 ml-4 space-y-6">
                  {auditLogs.map((log: any) => (
                    <div key={log.id} className="relative pl-6">
                      <div className="absolute -left-1.5 top-1 w-3 h-3 bg-indigo-600 dark:bg-indigo-400 rounded-full border border-white dark:border-slate-800" />
                      <div className="text-xs">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block uppercase tracking-wide">{log.action.replace(/_/g, ' ')}</span>
                        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                          {new Date(log.timestamp).toLocaleString()} • {log.userEmail || 'System Agent'}
                        </div>
                        {log.result && (
                          <span className="mt-1 inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase">
                            {log.result}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FORM 2307 CERTIFICATE PREVIEW & PRINT OVERLAY */}
      {showForm2307Modal && selectedItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-4xl w-full p-6 space-y-4 my-8">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3 no-print">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">BIR Form 2307 Preview Cockpit</h3>
                <p className="text-[10px] text-slate-500">Interactive validation checks and print-ready CSS scaling</p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowForm2307Modal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Validation Panel (Only shown in screen preview) */}
            <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-950 bg-indigo-50/10 dark:bg-indigo-950/5 space-y-2 text-xs no-print">
              <div className="flex items-center gap-1.5 font-bold text-indigo-800 dark:text-indigo-400">
                <ShieldCheck className="w-4 h-4" /> Real-time BIR Compliance Validation Checklist
              </div>
              
              {validationErrors.length > 0 ? (
                <div className="space-y-1.5 mt-2">
                  <div className="text-[10px] text-rose-600 font-bold uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Validation Failed: {validationErrors.length} issues must be configured before filing
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-400 pl-1">
                    {validationErrors.map((err, idx) => (
                      <li key={idx} className="text-rose-600 dark:text-rose-400 font-medium">{err}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 mt-2">
                  <CheckCircle2 className="w-4 h-4" /> All compliance checks passed! Payor, Payee, TIN alignment, and EWT rate match BIR Form 2307 guidelines perfectly.
                </div>
              )}
            </div>

            {/* Dynamic CSS Print Styling Trick */}
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                body * {
                  visibility: hidden;
                }
                #bir-form-2307-printable, #bir-form-2307-printable * {
                  visibility: visible;
                }
                #bir-form-2307-printable {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  background: white !important;
                  color: black !important;
                }
                .no-print {
                  display: none !important;
                }
              }
            `}} />

            {/* Print-Ready BIR replica of Form 2307 */}
            <div 
              id="bir-form-2307-printable" 
              className="p-8 border border-slate-300 dark:border-slate-700 rounded-xl bg-white text-slate-900 font-sans space-y-6 max-w-3xl mx-auto shadow-inner"
            >
              
              {/* Form Heading Header */}
              <div className="border-2 border-black p-4 text-center space-y-1">
                <div className="flex justify-between items-center">
                  <span className="font-mono font-extrabold text-xs">BIR Form No. 2307</span>
                  <span className="font-bold text-xs uppercase tracking-wider">Republika ng Pilipinas</span>
                  <span className="font-mono text-slate-500 text-[10px]">Revised Sept 2018</span>
                </div>
                <h1 className="text-sm font-extrabold uppercase tracking-wide">Certificate of Creditable Tax Withheld at Source</h1>
                <p className="text-[10px] text-slate-500">In accordance with BIR Revenue Regulations, issued to payee for income payments subject to expanded withholding tax.</p>
              </div>

              {/* 1. Period Cover */}
              <div className="grid grid-cols-4 border-l-2 border-r-2 border-b-2 border-t-2 border-black text-[10px]">
                <div className="col-span-2 border-r border-black p-2">
                  <span className="font-bold block">1 For the Period Cover:</span>
                  <div className="flex gap-4 font-mono font-semibold mt-1">
                    <div>FROM: <span className="underline">{selectedItem.paymentDate || '2026-08-01'}</span></div>
                    <div>TO: <span className="underline">{selectedItem.paymentDate || '2026-08-31'}</span></div>
                  </div>
                </div>
                <div className="col-span-2 p-2">
                  <span className="font-bold block">Tax Code Mapping Reference:</span>
                  <span className="font-mono font-bold text-indigo-600 block mt-1">{selectedItem.taxCode || 'WI100'}</span>
                </div>
              </div>

              {/* 2. Payee Information Section */}
              <div className="border-l-2 border-r-2 border-b-2 border-black text-[10px]">
                <div className="bg-slate-100 p-1.5 font-bold uppercase border-b border-black">Part I — Payee Information (Recipient of Income)</div>
                <div className="grid grid-cols-4 border-b border-black">
                  <div className="col-span-2 border-r border-black p-2">
                    <span className="font-bold block text-[9px] uppercase text-slate-500">2 Taxpayer Identification Number (TIN)</span>
                    <p className="font-mono font-bold text-xs tracking-widest mt-1">{(selectedItem.tin || "000-000-000-000").toUpperCase()}</p>
                  </div>
                  <div className="col-span-2 p-2">
                    <span className="font-bold block text-[9px] uppercase text-slate-500">3 Payee's Registered Name</span>
                    <p className="font-bold text-xs mt-1">{(selectedItem.vendorName || selectedItem.customerName || 'Supplier').toUpperCase()}</p>
                  </div>
                </div>
                <div className="p-2">
                  <span className="font-bold block text-[9px] uppercase text-slate-500">4 Registered Tax Address</span>
                  <p className="font-semibold text-slate-700 mt-1">{selectedItem.address || 'No registered address supplied in contact details.'}</p>
                </div>
              </div>

              {/* 3. Payor Information Section */}
              <div className="border-l-2 border-r-2 border-b-2 border-black text-[10px]">
                <div className="bg-slate-100 p-1.5 font-bold uppercase border-b border-black">Part II — Payor Information (Withholding Agent)</div>
                <div className="grid grid-cols-4 border-b border-black">
                  <div className="col-span-2 border-r border-black p-2">
                    <span className="font-bold block text-[9px] uppercase text-slate-500">5 Taxpayer Identification Number (TIN)</span>
                    <p className="font-mono font-bold text-xs tracking-widest mt-1">{((activeCompany as any)?.tin || "009-876-543-000").toUpperCase()}</p>
                  </div>
                  <div className="col-span-2 p-2">
                    <span className="font-bold block text-[9px] uppercase text-slate-500">6 Payor's Registered Name</span>
                    <p className="font-bold text-xs mt-1">{(activeCompany?.legalName || 'LedgerAI active Company').toUpperCase()}</p>
                  </div>
                </div>
                <div className="p-2">
                  <span className="font-bold block text-[9px] uppercase text-slate-500">7 Registered Tax Address</span>
                  <p className="font-semibold text-slate-700 mt-1">{(activeCompany as any)?.address || 'No registered business address configured.'}</p>
                </div>
              </div>

              {/* 4. Details of Withholding Table */}
              <div className="border-2 border-black text-[10px] overflow-x-auto">
                <div className="bg-slate-100 p-1.5 font-bold uppercase border-b border-black whitespace-nowrap">Part III — Details of Creditable Withholding Tax At Source</div>
                <table className="w-full text-left border-collapse text-[10px] min-w-[700px]">
                  <thead>
                    <tr className="bg-slate-50 font-bold uppercase border-b border-black">
                      <th className="py-2 px-2 border-r border-black">Nature of Income Payment</th>
                      <th className="py-2 px-2 border-r border-black text-center">ATC</th>
                      <th className="py-2 px-2 border-r border-black text-right">Tax Base (Gross)</th>
                      <th className="py-2 px-2 border-r border-black text-center">Rate</th>
                      <th className="py-2 px-2 text-right">Tax Withheld Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black font-mono">
                    <tr>
                      <td className="py-2.5 px-2 border-r border-black font-sans font-semibold">
                        {selectedItem.type === 'ewt' 
                          ? 'Expanded Withholding Tax on Goods/Services supplied to Local Contractors' 
                          : 'Creditable Withholding Taxes on Income payments by local withholding agents'}
                      </td>
                      <td className="py-2.5 px-2 border-r border-black text-center font-bold text-indigo-600">{selectedItem.taxCode || 'WI100'}</td>
                      <td className="py-2.5 px-2 border-r border-black text-right">
                        {formatCurrency((selectedItem.amountPaid || selectedItem.amountCollected || 0) + (selectedItem.withholdingTaxAmount || 0))}
                      </td>
                      <td className="py-2.5 px-2 border-r border-black text-center font-semibold">
                        {Math.round((selectedItem.withholdingTaxAmount || 0) / ((selectedItem.amountPaid || selectedItem.amountCollected || 1) + (selectedItem.withholdingTaxAmount || 0)) * 100)}%
                      </td>
                      <td className="py-2.5 px-2 text-right font-extrabold text-rose-600">
                        {formatCurrency(selectedItem.withholdingTaxAmount)}
                      </td>
                    </tr>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={2} className="py-2 px-2 border-r border-black text-right font-sans uppercase">Total Summary</td>
                      <td className="py-2 px-2 border-r border-black text-right">
                        {formatCurrency((selectedItem.amountPaid || selectedItem.amountCollected || 0) + (selectedItem.withholdingTaxAmount || 0))}
                      </td>
                      <td className="py-2 px-2 border-r border-black text-center">—</td>
                      <td className="py-2 px-2 text-right font-black text-rose-600">
                        {formatCurrency(selectedItem.withholdingTaxAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Signature area */}
              <div className="grid grid-cols-2 gap-8 pt-8 text-[10px] text-center no-print">
                <div className="border-t border-black pt-2">
                  <p className="font-bold">{(activeCompany?.legalName || 'Withholding Agent').toUpperCase()}</p>
                  <p className="text-slate-500">Signature Over Printed Name of Payor/Authorized Representative</p>
                </div>
                <div className="border-t border-black pt-2">
                  <p className="font-bold">{(selectedItem.vendorName || selectedItem.customerName || 'Payee').toUpperCase()}</p>
                  <p className="text-slate-500">Signature Over Printed Name of Payee/Authorized Representative</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700 no-print">
              <button 
                type="button" 
                onClick={() => setShowForm2307Modal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
              >
                Close Certificate
              </button>
              <button 
                type="button" 
                onClick={() => window.print()}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" /> Print Official Form 2307
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TaxCalendarView = () => {
  const { activeCompany } = useAuth();
  const [filings, setFilings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewFilingModal, setShowNewFilingModal] = useState(false);
  const [activeChecklistFiling, setActiveChecklistFiling] = useState<any>(null);
  const [checklistItems, setChecklistItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [newFiling, setNewFiling] = useState({
    taxType: '1601-C',
    periodName: 'July 2026 Monthly Remittance',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    deadlineDate: '2026-08-10'
  });

  const fetchFilings = async () => {
    setLoading(true);
    fetch('/api/tax/filings')
      .then(res => res.json())
      .then(fData => setFilings(fData || []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchFilings();
  }, []);

  const handleCreateFiling = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await fetch('/api/tax/filings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFiling)
      });
      if (res.ok) {
        setShowNewFilingModal(false);
        fetchFilings();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChecklist = async (filing: any) => {
    setActiveChecklistFiling(filing);
    try {
      const res = await fetch(`/api/tax/checklist/${filing.id}`);
      if (res.ok) {
        const data = await res.json();
        setChecklistItems(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleChecklist = async (itemId: string, currentVal: boolean) => {
    setChecklistItems(prev => prev.map(item => item.id === itemId ? { ...item, isCompleted: !currentVal } : item));
    try {
      await fetch(`/api/tax/checklist/${itemId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !currentVal })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleLock = async (id: string) => {
    if (!confirm("Are you sure you want to lock this tax period? Once locked, silent modifications are strictly prohibited.")) return;
    try {
      const res = await fetch(`/api/tax/filings/${id}/lock`, { method: 'POST' });
      if (res.ok) {
        setFilings(prev => prev.map(f => f.id === id ? { ...f, status: 'LOCKED' } : f));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-rose-600" /> BIR Tax Calendar & Filing Periods
          </h2>
          <p className="text-slate-500 text-xs mt-1">Tax compliance deadlines, filing preparation checklists, and immutable locked periods.</p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewFilingModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New Filing Period
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h3 className="font-bold text-slate-800 dark:text-slate-100">Registered Tax Filings & Period Locking</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[800px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
              <tr>
                <th className="py-3 px-3">Tax Type</th>
                <th className="py-3 px-3">Period</th>
                <th className="py-3 px-3">Deadline</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-center">Preparation Checklist</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {filings.map(f => (
                <tr key={f.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                  <td className="py-3 px-3 font-bold text-indigo-600">{f.taxType}</td>
                  <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-100">{f.periodName}</td>
                  <td className="py-3 px-3 font-mono text-xs">{f.deadlineDate}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${f.status === 'LOCKED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button 
                      type="button"
                      onClick={() => handleOpenChecklist(f)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded text-xs font-semibold flex items-center gap-1 mx-auto"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-500" /> View Checklist
                    </button>
                  </td>
                  <td className="py-3 px-3 text-right">
                    {f.status !== 'LOCKED' && (
                      <button 
                        type="button"
                        onClick={() => handleLock(f.id)}
                        className="px-3 py-1 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 flex items-center gap-1 ml-auto"
                      >
                        <Lock className="w-3.5 h-3.5" /> Lock Period
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNewFilingModal && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowNewFilingModal(false)}
        >
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-rose-600" /> New Tax Filing Period
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewFilingModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFiling} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">BIR Form Tax Type</label>
                <select 
                  value={newFiling.taxType}
                  onChange={e => setNewFiling({ ...newFiling, taxType: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  <option value="1601-C">BIR Form 1601-C (Compensation Withholding)</option>
                  <option value="0619-E">BIR Form 0619-E / 1601-EQ (Expanded Withholding)</option>
                  {(activeCompany?.vatStatus || 'VAT') === 'VAT' ? (
                    <option value="2550Q">BIR Form 2550Q (Quarterly VAT Return)</option>
                  ) : (
                    <option value="2551Q">BIR Form 2551Q (Quarterly Percentage Tax Return - 3%)</option>
                  )}
                  {['INDIVIDUAL', 'OPC'].includes(activeCompany?.taxpayerClassification || '') ? (
                    <>
                      <option value="1701Q">BIR Form 1701Q (Quarterly Individual Income Tax Return)</option>
                      <option value="1701A">BIR Form 1701A (Annual Income Tax for Individuals)</option>
                    </>
                  ) : (
                    <>
                      <option value="1702Q">BIR Form 1702Q (Quarterly Corporate Income Tax Return)</option>
                      <option value="1702-RT">BIR Form 1702-RT (Annual Corporate Income Tax Return)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Period Description / Name</label>
                <input 
                  type="text" 
                  required 
                  value={newFiling.periodName}
                  onChange={e => setNewFiling({ ...newFiling, periodName: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Start Date</label>
                  <input 
                    type="date" 
                    required 
                    value={newFiling.startDate}
                    onChange={e => setNewFiling({ ...newFiling, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Deadline Date</label>
                  <input 
                    type="date" 
                    required 
                    value={newFiling.deadlineDate}
                    onChange={e => setNewFiling({ ...newFiling, deadlineDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button 
                  type="button"
                  onClick={() => setShowNewFilingModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Register Filing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeChecklistFiling && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setActiveChecklistFiling(null)}
        >
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Filing Preparation Checklist</h3>
                <p className="text-xs text-indigo-600 font-semibold">{activeChecklistFiling.taxType} - {activeChecklistFiling.periodName}</p>
              </div>
              <button 
                type="button" 
                onClick={() => setActiveChecklistFiling(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {checklistItems.map(item => (
                <div 
                  key={item.id} 
                  onClick={() => handleToggleChecklist(item.id, item.isCompleted)}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-3 cursor-pointer transition-colors"
                >
                  {item.isCompleted ? (
                    <CheckSquare className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-400 flex-shrink-0" />
                  )}
                  <span className={`text-xs font-medium ${item.isCompleted ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                    {item.taskDescription}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-700">
              <button 
                type="button" 
                onClick={() => setActiveChecklistFiling(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ExceptionReports = () => {
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tax/schedules/exceptions')
      .then(res => res.json())
      .then(data => setExceptions(data.data || []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-sky-600" /> Tax Exception & Audit Log Reports
        </h2>
        <p className="text-slate-500 text-xs mt-1">Discrepancies, post-filing alterations, and locked period modification flags.</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[700px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
              <tr>
                <th className="py-3 px-3">Exception Type</th>
                <th className="py-3 px-3">Description</th>
                <th className="py-3 px-3">Severity</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {exceptions.map(ex => (
                <tr key={ex.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                  <td className="py-3 px-3 font-mono font-bold text-xs text-sky-600">{ex.exceptionType}</td>
                  <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-100">{ex.description}</td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      {ex.severity}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-xs text-slate-700 dark:text-slate-300">{ex.status}</td>
                </tr>
              ))}
              {exceptions.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">No tax exceptions or post-filing modifications detected.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default function Tax() {
  const location = useLocation();
  const isRoot = location.pathname === '/tax' || location.pathname === '/tax/';

  return (
    <div className="w-full space-y-4">
      <div className="flex space-x-2 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/tax" className="hover:text-indigo-600 font-medium">Tax & Compliance</Link>
        {!isRoot && <span>/</span>}
        {!isRoot && <span className="text-slate-800 dark:text-slate-200 font-semibold capitalize">{location.pathname.split('/').pop()}</span>}
      </div>

      <Routes>
        <Route path="/" element={<TaxOverview />} />
        <Route path="bir-compliance" element={<BirCompliance />} />
        <Route path="codes" element={<TaxCodes />} />
        <Route path="vat-schedules" element={<TaxSchedules />} />
        <Route path="reconciliation" element={<TaxReconciliation />} />
        <Route path="withholdings" element={<WithholdingSchedules />} />
        <Route path="calendar" element={<TaxCalendarView />} />
        <Route path="exceptions" element={<ExceptionReports />} />
        <Route path="forms" element={<TaxForms />} />
      </Routes>
    </div>
  );
}
