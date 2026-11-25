import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  FileText, Printer, Download, CheckCircle2, AlertCircle, Calendar, 
  Building2, ShieldCheck, HelpCircle, ArrowRight, RefreshCw, Filter, Layers, DollarSign
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import { exportToPDF } from '../../utils/exportUtils';
import { getBirTaxProfileRules } from '../../../shared/taxProfile';
import Form2307DigitalTool from './Form2307DigitalTool';

interface ReturnTemplateData {
  company: {
    id: string;
    legalName: string;
    tin: string;
    rdoCode: string;
    address: string;
    vatStatus: string;
    taxpayerClassification: string;
    industry: string;
    contactPhone?: string | null;
    fiscalYearEnd: string;
  };
  period?: {
    code: string;
    label: string;
    startDate: string;
    endDate: string;
    deadlineDate: string;
    periodType: string;
    isPeriodFiltered: boolean;
  };
  amended?: {
    isAmended: boolean;
    priorTaxPaid: number;
    originalFilingReference?: string | null;
  };
  returnMetrics: {
    grossSales: number;
    salesSubtotal: number;
    outputVat: number;
    grossPurchases: number;
    purchaseSubtotal: number;
    inputVat: number;
    netVatPayable: number;
    percentageTaxDue: number;
    cogsAmount?: number;
    grossProfit: number;
    estOperatingExpenses: number;
    taxableNetIncome: number;
    appliedCorporateTaxRate?: number;
    corporateTaxDue: number;
    estimatedCwtCredits: number;
    netCorporateTaxPayable: number;
    osdDeduction: number;
    individualNetIncomeOSD: number;
    individualTaxDue8Percent: number;
    totalGrossComp: number;
    totalNonTaxableComp: number;
    totalTaxableComp: number;
    totalCompensationWTax: number;
    priorTaxPaid?: number;
    netVatStillDue?: number;
    vatOverpayment?: number;
    netCorporateTaxStillDue?: number;
    corporateOverpayment?: number;
    totalEwtWithheld?: number;
    ewtPaymentsCount?: number;
    ewtAtcBreakdown?: Array<{
      atcCode: string;
      nature: string;
      taxBase: number;
      rate: number;
      taxWithheld: number;
    }>;
  };
}

const normalizeFormCode = (code: string | null): string | null => {
  if (!code) return null;
  const upper = code.toUpperCase();
  if (upper.includes('2307')) return '2307';
  if (upper.includes('0619') || upper.includes('1601-EQ') || upper.includes('1601EQ')) return '0619E';
  if (upper.includes('1601-C') || upper.includes('1601C')) return '1601C';
  if (upper.includes('2550M')) return '2550M';
  if (upper.includes('2550')) return '2550Q';
  if (upper.includes('2551')) return '2551Q';
  if (upper.includes('1702')) return '1702RT';
  if (upper.includes('1701')) return '1701A';
  return null;
};

export default function BirCompliance() {
  const { activeCompany } = useAuth();
  const [searchParams] = useSearchParams();
  const formQuery = searchParams.get('form');

  const [data, setData] = useState<ReturnTemplateData | null>(null);
  const [ewtTotalPhp, setEwtTotalPhp] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedForm, setSelectedForm] = useState<string>('AUTO');
  const [returnQuarter, setReturnQuarter] = useState<string>('Q3-2026');
  const [amendedReturn, setAmendedReturn] = useState<boolean>(false);
  const [priorPaymentInput, setPriorPaymentInput] = useState<string>('');
  const [overpaymentOption, setOverpaymentOption] = useState<'CREDIT_NEXT_QUARTER' | 'REFUND' | 'TCC'>('CREDIT_NEXT_QUARTER');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  useEffect(() => {
    fetchTemplateData(returnQuarter, amendedReturn, priorPaymentInput);
  }, [activeCompany?.id, returnQuarter, amendedReturn]);

  useEffect(() => {
    const matched = normalizeFormCode(formQuery);
    if (matched) {
      setSelectedForm(matched);
    }
  }, [formQuery]);

  const fetchTemplateData = async (quarterOverride?: string, amendedOverride?: boolean, priorPayOverride?: string) => {
    setLoading(true);
    setLoadError(null);
    const q = quarterOverride !== undefined ? quarterOverride : returnQuarter;
    const isAmend = amendedOverride !== undefined ? amendedOverride : amendedReturn;
    const prior = priorPayOverride !== undefined ? priorPayOverride : priorPaymentInput;

    const params = new URLSearchParams();
    if (q) params.set('period', q);
    if (isAmend) {
      params.set('amended', 'true');
      if (prior && !isNaN(Number(prior))) {
        params.set('priorPayment', prior);
      }
    }

    try {
      const [json, dashSummary] = await Promise.all([
        apiFetch<ReturnTemplateData>(`/api/tax/compliance/templates?${params.toString()}`),
        apiFetch<any>('/api/tax/dashboard-summary').catch(() => null),
      ]);
      setData(json);
      setLastRefreshedAt(new Date().toLocaleTimeString('en-PH'));
      const dashEwt = Math.round(Number(dashSummary?.withholdingSummary?.ewtTotalCentavos || 0)) / 100;
      setEwtTotalPhp(json.returnMetrics?.totalEwtWithheld ?? dashEwt);
      const vatStatus = json?.company?.vatStatus || activeCompany?.vatStatus || 'VAT';
      const taxpayerType = json?.company?.taxpayerClassification || activeCompany?.taxpayerClassification || 'CORPORATION';
      const rules = getBirTaxProfileRules(taxpayerType, vatStatus);

      if (selectedForm === 'AUTO') {
        if (rules.isVatRegistered && !rules.isVatExempt) {
          setSelectedForm('2550Q');
        } else if (rules.isPercentageTaxRegistered) {
          setSelectedForm('2551Q');
        } else {
          setSelectedForm(['INDIVIDUAL', 'OPC'].includes(taxpayerType) ? '1701A' : '1702RT');
        }
      }
    } catch (err: any) {
      console.error('Failed to load BIR template data:', err);
      setLoadError(err?.message || 'Failed to load authoritative BIR template data.');
    } finally {
      setLoading(false);
    }
  };

  const vatStatus = data?.company.vatStatus || activeCompany?.vatStatus || 'VAT';
  const taxpayerType = data?.company.taxpayerClassification || activeCompany?.taxpayerClassification || 'CORPORATION';
  const profileRules = getBirTaxProfileRules(taxpayerType, vatStatus);
  const isVat = profileRules.isVatRegistered && !profileRules.isVatExempt;
  const isIndividual = ['INDIVIDUAL', 'OPC'].includes(taxpayerType);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2
    }).format(amount || 0);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportPdf = () => {
    const formTitleMap: Record<string, string> = {
      '2550Q': 'BIR Form 2550Q - Quarterly Value-Added Tax Return',
      '2550M': 'BIR Form 2550M - Monthly Value-Added Tax Declaration',
      '1702RT': 'BIR Form 1702-RT - Annual Corporate Income Tax Return',
      '1701A': 'BIR Form 1701A - Annual Individual Income Tax Return',
      '1601C': 'BIR Form 1601-C - Monthly Remittance Return of Compensation WTax',
      '0619E': 'BIR Form 0619-E / 1601-EQ - Remittance Return of Expanded WTax',
      '2551Q': 'BIR Form 2551Q - Quarterly Percentage Tax Return',
    };
    const title = formTitleMap[selectedForm] || `BIR Statutory Return (${selectedForm})`;

    let rows: string[][] = [];
    if (selectedForm === '2550Q' || selectedForm === '2550M') {
      rows = [
        ['Box 15: Vatable Sales / Receipts (Net of VAT)', formatCurrency(metrics.salesSubtotal)],
        ['Box 16: Output VAT (12%)', formatCurrency(metrics.outputVat)],
        ['Box 17: Zero-Rated / Exempt Sales', '₱0.00'],
        ['Box 19: Vatable Domestic Purchases (Net of VAT)', formatCurrency(metrics.purchaseSubtotal)],
        ['Box 20: Total Allowable Input VAT (12%)', `(${formatCurrency(metrics.inputVat)})`],
        ['Box 21: Net VAT Payable / (Excess Input Tax)', formatCurrency(metrics.netVatPayable)],
        ['Box 22: Less: Creditable Withholding VAT (Line 23B)', `(${formatCurrency(metrics.estimatedCwtCredits)})`],
        ['Box 23: Less: Tax Previously Paid (Amended Return)', `(${formatCurrency(metrics.priorTaxPaid || 0)})`],
        ['Box 26: TOTAL AMOUNT STILL DUE / (OVERPAYMENT)', formatCurrency(metrics.netVatStillDue ?? metrics.netVatPayable)],
      ];
    } else if (selectedForm === '1702RT') {
      rows = [
        ['Line 1: Gross Sales / Receipts', formatCurrency(metrics.salesSubtotal)],
        ['Line 2: Less: Cost of Sales / Services (COGS)', `(${formatCurrency(metrics.cogsAmount || 0)})`],
        ['Line 3: Gross Income from Operation', formatCurrency(metrics.grossProfit)],
        ['Line 4: Less: Ordinary Allowable Itemized Expenses', `(${formatCurrency(metrics.estOperatingExpenses)})`],
        ['Line 5: NET TAXABLE INCOME', formatCurrency(metrics.taxableNetIncome)],
        ['Line 6: Applicable CIT Rate (CREATE Act)', `${((metrics.appliedCorporateTaxRate ?? 0.25) * 100).toFixed(2)}%`],
        ['Line 7: Income Tax Due', formatCurrency(metrics.corporateTaxDue)],
        ['Line 8: Less: Form 2307 Creditable Tax Withheld', `(${formatCurrency(metrics.estimatedCwtCredits)})`],
        ['Line 10: Less: Tax Previously Paid per Original Return', `(${formatCurrency(metrics.priorTaxPaid || 0)})`],
        ['Line 12: NET CORPORATE INCOME TAX STILL DUE', formatCurrency(metrics.netCorporateTaxStillDue ?? metrics.netCorporateTaxPayable)],
      ];
    } else if (selectedForm === '1601C') {
      rows = [
        ['Total Gross Compensation', formatCurrency(metrics.totalGrossComp)],
        ['Less: Non-Taxable Compensation (SSS/PhilHealth/Pag-IBIG)', `(${formatCurrency(metrics.totalNonTaxableComp)})`],
        ['Total Taxable Compensation', formatCurrency(metrics.totalTaxableComp)],
        ['TOTAL TAX REQUIRED TO BE WITHHELD', formatCurrency(metrics.totalCompensationWTax)],
      ];
    } else if (selectedForm === '0619E') {
      rows = [
        ['Posted Purchase Bills Subtotal (Tax Base)', formatCurrency(metrics.purchaseSubtotal)],
        ['TOTAL EXPANDED WITHHOLDING TAX DUE', formatCurrency(ewtTotalPhp)],
        ...(metrics.ewtAtcBreakdown || []).map(atc => [
          `ATC ${atc.atcCode}: ${atc.nature}`,
          `Base: ${formatCurrency(atc.taxBase)} | Rate: ${(atc.rate * 100).toFixed(0)}% | Tax: ${formatCurrency(atc.taxWithheld)}`
        ]),
      ];
    } else if (selectedForm === '2551Q') {
      rows = [
        ['Line 12: Taxable Gross Sales / Receipts', formatCurrency(metrics.grossSales)],
        ['Line 13: Percentage Tax Rate (NIRC Sec 116)', '3.00%'],
        ['Line 14: Total Percentage Tax Due', formatCurrency(metrics.percentageTaxDue)],
        ['Line 15: Less: Creditable Percentage Tax Withheld (2307)', `(${formatCurrency(metrics.estimatedCwtCredits)})`],
        ['Line 18: TOTAL TAX STILL DUE / PAYABLE', formatCurrency(Math.max(0, metrics.percentageTaxDue - metrics.estimatedCwtCredits))],
      ];
    }

    exportToPDF({
      filename: `BIR_${selectedForm}_${returnQuarter}_${amendedReturn ? 'AMENDED' : 'ORIGINAL'}.pdf`,
      title,
      subtitle: `Taxable Period: ${data?.period?.label || returnQuarter} | ${amendedReturn ? 'Amended Return' : 'Original Return'} | NIRC & BIR EOPT Compliant`,
      companyName: `${company.legalName} (TIN: ${company.tin} | RDO: ${company.rdoCode})`,
      headers: ['Statutory Box / Return Line Description', 'Amount / Computation (PHP)'],
      rows,
    });
  };

  const metrics = data?.returnMetrics || {
    grossSales: 0,
    salesSubtotal: 0,
    outputVat: 0,
    grossPurchases: 0,
    purchaseSubtotal: 0,
    inputVat: 0,
    netVatPayable: 0,
    percentageTaxDue: 0,
    cogsAmount: 0,
    grossProfit: 0,
    estOperatingExpenses: 0,
    taxableNetIncome: 0,
    appliedCorporateTaxRate: 0.25,
    corporateTaxDue: 0,
    estimatedCwtCredits: 0,
    netCorporateTaxPayable: 0,
    osdDeduction: 0,
    individualNetIncomeOSD: 0,
    individualTaxDue8Percent: 0,
    totalGrossComp: 0,
    totalNonTaxableComp: 0,
    totalTaxableComp: 0,
    totalCompensationWTax: 0,
  };

  const company = data?.company || {
    legalName: activeCompany?.legalName || 'Active Workspace',
    tin: activeCompany?.tin || 'Not provided',
    rdoCode: activeCompany?.rdoCode || 'Not provided',
    address: (activeCompany as any)?.address || 'Not provided',
    contactPhone: (activeCompany as any)?.contactPhone || 'Not provided',
    vatStatus,
    taxpayerClassification: taxpayerType,
    industry: (activeCompany as any)?.industry || 'Not specified'
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-3 py-1 rounded-full text-xs font-black bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              BIR TAX RETURN TEMPLATES
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${isVat ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60'}`}>
              BIR: {vatStatus.replace('_', ' ')}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-bold border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300">
              {taxpayerType.replace('_', ' ')}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-2">
            Mandatory BIR Return Pre-Formatted Templates
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Official BIR Form replicas pre-populated with live ledger data according to NIRC, TRAIN Law, CREATE Act, and EOPT Act guidelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchTemplateData(returnQuarter, amendedReturn, priorPaymentInput)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-all"
            title={lastRefreshedAt ? `Last synchronized at ${lastRefreshedAt}` : 'Synchronize live ledger data'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Data</span>
            {lastRefreshedAt && <span className="text-[10px] text-slate-400 font-mono">({lastRefreshedAt})</span>}
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold shadow-xs transition-all"
            title="Open browser print dialog for official physical worksheet"
          >
            <Printer className="w-3.5 h-3.5" /> Print Sheet
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
            title="Export clean, publication-ready BIR return PDF report with box calculations"
          >
            <Download className="w-3.5 h-3.5" /> Export Official PDF
          </button>
        </div>
      </div>

      {/* Tax Profile Matrix & Form Selector */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600" />
              Taxpayer Information &amp; Registration Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Registered Legal Name: <strong className="text-slate-800 dark:text-slate-200">{company.legalName}</strong> | 12-Digit TIN: <strong className="text-slate-800 dark:text-slate-200">{company.tin}</strong> | RDO Code: <strong className="text-slate-800 dark:text-slate-200">{company.rdoCode}</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Return Period</label>
              <select
                value={returnQuarter}
                onChange={(e) => {
                  setReturnQuarter(e.target.value);
                  fetchTemplateData(e.target.value, amendedReturn, priorPaymentInput);
                }}
                className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 cursor-pointer shadow-xs focus:ring-2 focus:ring-indigo-500"
              >
                <optgroup label="Taxable Quarters (BIR 2550Q / 2551Q / 1601-EQ / 1702Q)">
                  <option value="Q3-2026">3rd Quarter 2026 (Jul 1 – Sep 30, 2026)</option>
                  <option value="Q2-2026">2nd Quarter 2026 (Apr 1 – Jun 30, 2026)</option>
                  <option value="Q1-2026">1st Quarter 2026 (Jan 1 – Mar 31, 2026)</option>
                  <option value="Q4-2026">4th Quarter 2026 (Oct 1 – Dec 31, 2026)</option>
                </optgroup>
                <optgroup label="Annual Fiscal Periods (BIR 1702-RT / 1701A)">
                  <option value="ANNUAL-2026">Annual Fiscal Year 2026 (Full Year)</option>
                  <option value="ANNUAL-2025">Annual Fiscal Year 2025 (Prior Year)</option>
                  <option value="ALL">All Recorded Transactions (Cumulative Lifetime)</option>
                </optgroup>
                <optgroup label="Monthly Periods (BIR 2550M / 1601-C / 0619-E)">
                  <option value="2026-10">October 2026</option>
                  <option value="2026-09">September 2026</option>
                  <option value="2026-08">August 2026</option>
                  <option value="2026-07">July 2026</option>
                  <option value="2026-06">June 2026</option>
                  <option value="2026-05">May 2026</option>
                  <option value="2026-04">April 2026</option>
                  <option value="2026-03">March 2026</option>
                  <option value="2026-02">February 2026</option>
                  <option value="2026-01">January 2026</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Amended Return?</label>
              <button
                type="button"
                onClick={() => {
                  const nextAmended = !amendedReturn;
                  setAmendedReturn(nextAmended);
                  fetchTemplateData(returnQuarter, nextAmended, priorPaymentInput);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer shadow-xs ${amendedReturn ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}
                title="Toggle between Original statutory filing and Amended return under NIRC Section 6(A)"
              >
                {amendedReturn ? 'YES (Amended Return)' : 'NO (Original Return)'}
              </button>
            </div>
          </div>
        </div>

        {/* Amended Return Adjustment Control Panel */}
        {amendedReturn && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="font-bold text-amber-900 dark:text-amber-200">
                  Amended Return Accounting Adjustment (NIRC Sec. 6(A) &amp; BIR Rules)
                </span>
              </div>
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                Deduct previous tax payments to prevent duplicate assessment or recognize overpayment credit.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  Tax Previously Paid (per Original Return) ₱:
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={priorPaymentInput}
                  onChange={(e) => {
                    setPriorPaymentInput(e.target.value);
                    fetchTemplateData(returnQuarter, true, e.target.value);
                  }}
                  className="w-40 px-2.5 py-1 text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Overpayment Disposition:</span>
                <select
                  value={overpaymentOption}
                  onChange={(e) => setOverpaymentOption(e.target.value as any)}
                  className="px-2 py-1 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                >
                  <option value="CREDIT_NEXT_QUARTER">To be carried over as tax credit next quarter (BIR Standard)</option>
                  <option value="REFUND">To be refunded</option>
                  <option value="TCC">To be issued a Tax Credit Certificate (TCC)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* BIR Form Selector Tabs */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Select Mandatory BIR Tax Return Form Template:
          </label>
          <div className="flex flex-wrap gap-2">
            {isVat ? (
              <>
                <button
                  onClick={() => setSelectedForm('2550Q')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '2550Q' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
                >
                  <FileText className="w-3.5 h-3.5" /> BIR Form 2550Q (Quarterly VAT · RMC 5-2023)
                </button>
                <button
                  onClick={() => setSelectedForm('2550M')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '2550M' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
                >
                  <FileText className="w-3.5 h-3.5" /> BIR Form 2550M (Optional Monthly VAT · RMC 52-2023)
                </button>
              </>
            ) : profileRules.isPercentageTaxRegistered ? (
              <button
                onClick={() => setSelectedForm('2551Q')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '2551Q' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
              >
                <FileText className="w-3.5 h-3.5" /> BIR Form 2551Q (3% Percentage Tax)
              </button>
            ) : null}

            {!isIndividual ? (
              <button
                onClick={() => setSelectedForm('1702RT')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '1702RT' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
              >
                <FileText className="w-3.5 h-3.5" /> BIR Form 1702-RT (Corporate Income Tax)
              </button>
            ) : (
              <button
                onClick={() => setSelectedForm('1701A')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '1701A' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
              >
                <FileText className="w-3.5 h-3.5" /> BIR Form 1701A (Individual Income Tax)
              </button>
            )}

            <button
              onClick={() => setSelectedForm('2307')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '2307' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
            >
              <FileText className="w-3.5 h-3.5" /> BIR Form 2307 (Withholding Certificate)
            </button>

            <button
              onClick={() => setSelectedForm('1601C')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '1601C' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
            >
              <FileText className="w-3.5 h-3.5" /> BIR Form 1601-C (Compensation WTax)
            </button>

            <button
              onClick={() => setSelectedForm('0619E')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '0619E' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
            >
              <FileText className="w-3.5 h-3.5" /> BIR Form 0619-E / 1601-EQ (Expanded WTax)
            </button>
          </div>
        </div>
      </div>

      {/* BIR Return Replica Canvas Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl shadow-lg p-6 sm:p-10 font-sans print:shadow-none print:border-none print:p-0 overflow-x-auto">
        
        {loadError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* FORM 2550Q / OPTIONAL 2550M TEMPLATE */}
        {(selectedForm === '2550Q' || selectedForm === '2550M') && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-amber-50/20 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100">
            {/* BIR Header Block */}
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <div className="flex justify-between items-start">
                <div className="text-left text-[10px] font-mono leading-tight">
                  <p className="font-bold">Republika ng Pilipinas</p>
                  <p>Kagawaran ng Pananalapi</p>
                  <p className="font-bold">Kawanihan ng Rentas Internas</p>
                </div>
                <div className="text-center">
                  <h1 className="text-2xl font-black font-serif tracking-wider">
                    {selectedForm === '2550M' ? 'BIR Form No. 2550M' : 'BIR Form No. 2550Q'}
                  </h1>
                  <p className="text-xs font-bold">
                    {selectedForm === '2550M'
                      ? 'Monthly Value-Added Tax Declaration (Optional Monthly Election · RMC 52-2023)'
                      : 'Quarterly Value-Added Tax Return (Mandatory Quarterly · RMC 5-2023)'}
                  </p>
                  <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">Pursuant to NIRC Sec. 114 &amp; EOPT Act (RA 11976)</p>
                </div>
                <div className="text-right text-[10px] font-mono border border-slate-800 p-2 rounded bg-white dark:bg-slate-800">
                  <p className="font-bold">DRAFT WORKSHEET</p>
                  <p>Period: {returnQuarter}</p>
                  <p>Amended: {amendedReturn ? 'YES' : 'NO'}</p>
                </div>
              </div>
            </div>

            {/* Part I: Taxpayer Information */}
            <div className="border border-slate-800 rounded bg-white dark:bg-slate-800/80 p-4 text-xs space-y-2">
              <h2 className="font-black text-slate-900 dark:text-slate-100 border-b border-slate-400 pb-1 uppercase tracking-wide">
                Part I: Taxpayer Background &amp; Registration
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                <div>
                  <span className="text-slate-500 text-[10px] block">1. Taxpayer Identification Number (TIN):</span>
                  <strong className="text-sm text-indigo-700 dark:text-indigo-400">{company.tin || 'Not provided'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">2. RDO Code:</span>
                  <strong>{company.rdoCode || 'Not provided'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">3. Line of Business:</span>
                  <strong>{company.industry || 'Not specified'}</strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500 text-[10px] block">4. Registered Taxpayer Name:</span>
                  <strong className="uppercase text-sm">{company.legalName}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">5. Telephone / Contact:</span>
                  <strong>{company.contactPhone || 'Not provided'}</strong>
                </div>
                <div className="sm:col-span-3">
                  <span className="text-slate-500 text-[10px] block">6. Registered Address:</span>
                  <strong className="uppercase">{company.address || 'Not provided'}</strong>
                </div>
              </div>
            </div>

            {/* Part II: Computation of VAT */}
            <div className="border border-slate-800 rounded bg-white dark:bg-slate-800/80 p-4 text-xs space-y-3 font-mono">
              <h2 className="font-black text-slate-900 dark:text-slate-100 border-b border-slate-400 pb-1 uppercase tracking-wide">
                Part II: Computation of Tax Due / Payable (Box Items)
              </h2>

              <div className="space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700">
                  <span>15. Vatable Sales / Receipts (Net of VAT)</span>
                  <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(metrics.salesSubtotal)}</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700">
                  <span className="pl-4">16. Output VAT (12% of Box 15)</span>
                  <strong className="text-emerald-700 dark:text-emerald-400">{formatCurrency(metrics.outputVat)}</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700 text-slate-500">
                  <span>17. Sales to Government / Zero-Rated / Exempt</span>
                  <span>₱0.00</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700">
                  <span>19. Total Vatable Domestic Purchases (Net of VAT)</span>
                  <span>{formatCurrency(metrics.purchaseSubtotal)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700">
                  <span className="pl-4">20. Total Allowable Input VAT (12% of Box 19)</span>
                  <strong className="text-purple-700 dark:text-purple-400">({formatCurrency(metrics.inputVat)})</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 font-bold text-sm">
                  <span>21. Net VAT Payable / (Excess Input Tax) [Box 16 - Box 20]</span>
                  <strong className="text-indigo-700 dark:text-indigo-400">{formatCurrency(metrics.netVatPayable)}</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700 text-slate-600">
                  <span>22. Less: Creditable Value Added Tax Withheld (Line 23B / 2307 Credits)</span>
                  <span>({formatCurrency(metrics.estimatedCwtCredits)})</span>
                </div>
                {amendedReturn && (
                  <div className="flex justify-between items-center py-1.5 border-b border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 px-2 text-amber-900 dark:text-amber-200 font-bold">
                    <span>23. Less: Tax Previously Paid per Original Return (BIR CAS / eFPS Ref)</span>
                    <span>({formatCurrency(metrics.priorTaxPaid || Number(priorPaymentInput) || 0)})</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 bg-indigo-50 dark:bg-indigo-950/60 p-3 rounded-lg font-black text-base border border-indigo-200">
                  <span>26. TOTAL AMOUNT STILL DUE / (OVERPAYMENT)</span>
                  <span className={metrics.vatOverpayment && metrics.vatOverpayment > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-indigo-800 dark:text-indigo-300"}>
                    {metrics.vatOverpayment && metrics.vatOverpayment > 0
                      ? `(${formatCurrency(metrics.vatOverpayment)}) [Overpayment]`
                      : formatCurrency(metrics.netVatStillDue ?? Math.max(0, metrics.netVatPayable - metrics.estimatedCwtCredits))}
                  </span>
                </div>
                {metrics.vatOverpayment && metrics.vatOverpayment > 0 && (
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-between">
                    <span>✓ Overpayment Disposition:</span>
                    <span>
                      {overpaymentOption === 'CREDIT_NEXT_QUARTER'
                        ? 'To be carried over as tax credit next quarter (BIR Box 26 Option A)'
                        : overpaymentOption === 'REFUND'
                        ? 'To be refunded pursuant to NIRC Sec. 112 / 204'
                        : 'To be issued a Tax Credit Certificate (TCC)'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Legal Deadline & Filing Notes */}
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-[11px] text-amber-800 dark:text-amber-200 font-mono space-y-1">
              <p className="font-bold">Statutory Filing Deadline:</p>
              <p>
                {selectedForm === '2550M'
                  ? 'Optional Monthly VAT (BIR RMC No. 52-2023): filed on or before the 20th day following the close of the taxable month; quarterly return 2550Q remains mandatory under RMC No. 5-2023.'
                  : 'Quarterly VAT (BIR RMC No. 5-2023): mandatory filing via BIR eFPS or eBIRForms on or before the 25th day following the close of each taxable quarter.'}
              </p>
            </div>
          </div>
        )}

        {/* FORM 2551Q TEMPLATE */}
        {selectedForm === '2551Q' && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-emerald-50/20 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100">
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <div className="flex justify-between items-start">
                <div className="text-left text-[10px] font-mono leading-tight">
                  <p className="font-bold">Republika ng Pilipinas</p>
                  <p>Kagawaran ng Pananalapi</p>
                  <p className="font-bold">Kawanihan ng Rentas Internas</p>
                </div>
                <div className="text-center">
                  <h1 className="text-2xl font-black font-serif tracking-wider">BIR Form No. 2551Q</h1>
                  <p className="text-xs font-bold">Quarterly Percentage Tax Return (Non-VAT 3%)</p>
                  <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">Pursuant to NIRC Sec. 116 & BIR Revenue Regulations</p>
                </div>
                <div className="text-right text-[10px] font-mono border border-slate-800 p-2 rounded bg-white dark:bg-slate-800">
                  <p className="font-bold">FOR BIR USE ONLY</p>
                  <p>Period: {returnQuarter}</p>
                </div>
              </div>
            </div>

            <div className="border border-slate-800 rounded bg-white dark:bg-slate-800/80 p-4 text-xs space-y-3 font-mono">
              <h2 className="font-black border-b border-slate-400 pb-1 uppercase">Part II: Computation of 3% Percentage Tax</h2>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span>12. Taxable Gross Sales / Receipts</span>
                  <strong>{formatCurrency(metrics.grossSales)}</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span>13. Statutory Percentage Tax Rate (NIRC Sec 116)</span>
                  <strong className="text-amber-700">3.00%</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200 bg-amber-50/60 p-2 font-bold">
                  <span>14. Total Percentage Tax Due</span>
                  <strong className="text-amber-800">{formatCurrency(metrics.percentageTaxDue)}</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span>15. Less: Creditable Percentage Tax Withheld (Form 2307)</span>
                  <span>({formatCurrency(metrics.estimatedCwtCredits)})</span>
                </div>
                <div className="flex justify-between items-center py-2 bg-emerald-100/60 p-3 rounded-lg font-black text-base border border-emerald-300">
                  <span>18. TOTAL TAX STILL DUE / PAYABLE</span>
                  <span className="text-emerald-900">
                    {formatCurrency(Math.max(0, metrics.percentageTaxDue - metrics.estimatedCwtCredits))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FORM 1702-RT TEMPLATE */}
        {selectedForm === '1702RT' && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-blue-50/20 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100">
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <h1 className="text-2xl font-black font-serif">BIR Form No. 1702-RT</h1>
              <p className="text-xs font-bold">Annual Income Tax Return for Corporations, Partnerships & Non-Individual Taxpayers</p>
              <p className="text-[11px] font-mono text-slate-600">Pursuant to CREATE Act (RA 11534)</p>
            </div>

            <div className="border border-slate-800 rounded bg-white dark:bg-slate-800/80 p-4 text-xs space-y-3 font-mono">
              <h2 className="font-black border-b border-slate-400 pb-1 uppercase">Part IV: Computation of Corporate Income Tax</h2>
              <div className="space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>1. Gross Sales / Receipts / Fees</span>
                  <strong>{formatCurrency(metrics.salesSubtotal)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>2. Less: Cost of Sales / Services (Authoritative GL COGS)</span>
                  <span>({formatCurrency(metrics.cogsAmount ?? 0)})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold bg-slate-50 p-1">
                  <span>3. Gross Income from Operation</span>
                  <strong>{formatCurrency(metrics.grossProfit)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>4. Less: Allowable Itemized Operating Expenses</span>
                  <span>({formatCurrency(metrics.estOperatingExpenses)})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold text-sm bg-indigo-50 p-2">
                  <span>5. NET TAXABLE INCOME</span>
                  <strong className="text-indigo-700">{formatCurrency(metrics.taxableNetIncome)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>6. Applicable Corporate Tax Rate (CREATE Act)</span>
                  <strong className="text-indigo-600">{((metrics.appliedCorporateTaxRate ?? 0.25) * 100).toFixed(2)}%</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold">
                  <span>7. Income Tax Due</span>
                  <strong>{formatCurrency(metrics.corporateTaxDue)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
                  <span>8. Less: Prior Quarter Payments &amp; Creditable Tax Withheld (Form 2307)</span>
                  <span>({formatCurrency(metrics.estimatedCwtCredits)})</span>
                </div>
                {amendedReturn && (
                  <div className="flex justify-between py-1.5 border-b border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 px-2 text-amber-900 dark:text-amber-200 font-bold">
                    <span>10. Less: Tax Previously Paid per Original Return (BIR CAS / eFPS Ref)</span>
                    <span>({formatCurrency(metrics.priorTaxPaid || Number(priorPaymentInput) || 0)})</span>
                  </div>
                )}
                <div className="flex justify-between py-2 bg-blue-100 dark:bg-blue-950/60 p-3 rounded-lg font-black text-base border border-blue-300 dark:border-blue-800">
                  <span>12. NET CORPORATE INCOME TAX STILL DUE / (OVERPAYMENT)</span>
                  <span className={metrics.corporateOverpayment && metrics.corporateOverpayment > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-blue-900 dark:text-blue-200"}>
                    {metrics.corporateOverpayment && metrics.corporateOverpayment > 0
                      ? `(${formatCurrency(metrics.corporateOverpayment)}) [Overpayment]`
                      : formatCurrency(metrics.netCorporateTaxStillDue ?? metrics.netCorporateTaxPayable)}
                  </span>
                </div>
                {metrics.corporateOverpayment && metrics.corporateOverpayment > 0 && (
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-between">
                    <span>✓ Overpayment Disposition:</span>
                    <span>
                      {overpaymentOption === 'CREDIT_NEXT_QUARTER'
                        ? 'To be carried over as tax credit next taxable year (BIR Option A)'
                        : overpaymentOption === 'REFUND'
                        ? 'To be refunded pursuant to NIRC Sec. 204'
                        : 'To be issued a Tax Credit Certificate (TCC)'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FORM 1701A TEMPLATE */}
        {selectedForm === '1701A' && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-purple-50/20 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100">
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <h1 className="text-2xl font-black font-serif">BIR Form No. 1701A</h1>
              <p className="text-xs font-bold">Annual Income Tax Return for Individuals Earning Income Purely from Business/Profession</p>
              <p className="text-[11px] font-mono text-slate-600">TRAIN Law (RA 10963) Compliant</p>
            </div>

            <div className="border border-slate-800 rounded bg-white dark:bg-slate-800/80 p-4 text-xs space-y-3 font-mono">
              <h2 className="font-black border-b border-slate-400 pb-1 uppercase">Part V: Computation of Individual Income Tax</h2>
              <div className="space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>1. Gross Revenues / Sales</span>
                  <strong>{formatCurrency(metrics.grossSales)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>2. Optional Standard Deduction (40% of Gross Revenue)</span>
                  <span>({formatCurrency(metrics.osdDeduction)})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold bg-purple-50 p-2">
                  <span>3. Net Taxable Income (OSD)</span>
                  <strong className="text-purple-800">{formatCurrency(metrics.individualNetIncomeOSD)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>4. Tax Option Selected: 8% Optional Flat Income Tax Rate</span>
                  <strong className="text-purple-700">{formatCurrency(metrics.individualTaxDue8Percent)}</strong>
                </div>
                <div className="flex justify-between py-2 bg-purple-100 p-3 rounded-lg font-black text-base border border-purple-300">
                  <span>7. NET INDIVIDUAL INCOME TAX STILL DUE</span>
                  <span className="text-purple-900">{formatCurrency(metrics.individualTaxDue8Percent)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FORM 2307 DIGITAL GENERATOR TOOL */}
        {selectedForm === '2307' && (
          <Form2307DigitalTool />
        )}

        {/* FORM 1601-C TEMPLATE */}
        {selectedForm === '1601C' && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-slate-50 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100 font-mono">
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <h1 className="text-2xl font-black font-serif">BIR Form No. 1601-C</h1>
              <p className="text-xs font-bold">Monthly Remittance Return of Income Taxes Withheld on Compensation</p>
            </div>

            <div className="border border-slate-800 rounded p-4 text-xs space-y-3">
              <div className="flex justify-between py-1 border-b">
                <span>Total Amount of Gross Compensation</span>
                <strong>{formatCurrency(metrics.totalGrossComp)}</strong>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span>Less: Statutory Non-Taxable Compensation (SSS/PH/PagIBIG)</span>
                <span>({formatCurrency(metrics.totalNonTaxableComp)})</span>
              </div>
              <div className="flex justify-between py-1 border-b font-bold bg-slate-100 p-1">
                <span>Total Taxable Compensation</span>
                <strong>{formatCurrency(metrics.totalTaxableComp)}</strong>
              </div>
              <div className="flex justify-between py-2 bg-indigo-100 p-3 rounded-lg font-black text-base">
                <span>TOTAL TAX REQUIRED TO BE WITHHELD</span>
                <span className="text-indigo-900">{formatCurrency(metrics.totalCompensationWTax)}</span>
              </div>
            </div>
          </div>
        )}

        {/* FORM 0619-E / 1601-EQ TEMPLATE */}
        {selectedForm === '0619E' && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-slate-50 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100 font-mono">
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <h1 className="text-2xl font-black font-serif">BIR Form No. 0619-E / 1601-EQ</h1>
              <p className="text-xs font-bold">Monthly/Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded)</p>
              <p className="text-[11px] text-slate-500">Pursuant to Section 57(B) NIRC &amp; RR No. 11-2018 (TRAIN Law EWT Table)</p>
            </div>

            <div className="border border-slate-800 rounded p-4 text-xs space-y-3 bg-white dark:bg-slate-800/80">
              <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
                <span>Posted Purchase Bills Subtotal (Tax Base Reference)</span>
                <strong>{formatCurrency(metrics.purchaseSubtotal)}</strong>
              </div>
              <div className="flex justify-between py-2 bg-emerald-100 dark:bg-emerald-950/60 p-3 rounded-lg font-black text-base border border-emerald-300 dark:border-emerald-800">
                <span>TOTAL EXPANDED TAX WITHHELD AT SOURCE (AUTHORITATIVE DISBURSEMENTS)</span>
                <span className="text-emerald-900 dark:text-emerald-300">{formatCurrency(ewtTotalPhp)}</span>
              </div>
            </div>

            {/* Authoritative EWT ATC Schedule Table */}
            <div className="border border-slate-800 rounded p-4 text-xs space-y-3 bg-white dark:bg-slate-800/80">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 border-b border-slate-300 dark:border-slate-700 pb-1 uppercase tracking-wider">
                Part II: Schedule of Expanded Withholding Tax per Alphanumeric Tax Code (ATC)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400">
                      <th className="py-2 px-3">ATC</th>
                      <th className="py-2 px-3">Nature of Income Payment</th>
                      <th className="py-2 px-3 text-right">Tax Base (PHP)</th>
                      <th className="py-2 px-3 text-center">Rate</th>
                      <th className="py-2 px-3 text-right">Tax Withheld (PHP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-xs font-mono">
                    {(metrics.ewtAtcBreakdown && metrics.ewtAtcBreakdown.length > 0) ? (
                      metrics.ewtAtcBreakdown.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-850">
                          <td className="py-2 px-3 font-bold text-indigo-700 dark:text-indigo-400">{item.atcCode}</td>
                          <td className="py-2 px-3">{item.nature}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(item.taxBase)}</td>
                          <td className="py-2 px-3 text-center">{(item.rate * 100).toFixed(0)}%</td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(item.taxWithheld)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400">
                          {ewtTotalPhp > 0
                            ? `Authoritative EWT total of ${formatCurrency(ewtTotalPhp)} recorded across posted supplier disbursements.`
                            : 'No posted supplier disbursements with Expanded Withholding Tax recorded for this period.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-800 font-bold bg-slate-100 dark:bg-slate-900 text-xs">
                      <td colSpan={2} className="py-2 px-3 uppercase">Total Withholding Tax Remittance Due</td>
                      <td className="py-2 px-3 text-right">{formatCurrency(metrics.ewtAtcBreakdown?.reduce((s, x) => s + x.taxBase, 0) || metrics.purchaseSubtotal)}</td>
                      <td className="py-2 px-3 text-center">—</td>
                      <td className="py-2 px-3 text-right text-emerald-800 dark:text-emerald-300 font-black">{formatCurrency(ewtTotalPhp)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Authorized Signatory Block */}
        <div className="mt-8 pt-6 border-t border-slate-400 text-xs font-mono grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] text-slate-500 mb-8">
              I declare under the penalties of perjury that this return has been made in good faith, verified by me, and to the best of my knowledge and belief, is true and correct pursuant to NIRC regulations.
            </p>
            <div className="border-t border-slate-800 pt-1">
              <p className="font-bold">AUTHORIZED TAX OFFICER / ACCOUNTANT</p>
              <p className="text-[10px] text-slate-500">Signature Over Printed Name &amp; Date</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 mb-8">
              Internal Draft Working Paper computed from general ledger &amp; subledger records (not an official BIR filing receipt).
            </p>
            <div className="border-t border-slate-800 pt-1 inline-block text-left">
              <p className="font-bold">INTERNAL DRAFT WORKING PAPER</p>
              <p className="text-[10px] text-slate-500">Requires eFPS / eBIRForms Filing &amp; Authorized Signatory Review</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
