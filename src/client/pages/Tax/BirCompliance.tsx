import React, { useState, useEffect } from 'react';
import { 
  FileText, Printer, Download, CheckCircle2, AlertCircle, Calendar, 
  Building2, ShieldCheck, HelpCircle, ArrowRight, RefreshCw, Filter, Layers
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
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
    fiscalYearEnd: string;
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
    grossProfit: number;
    estOperatingExpenses: number;
    taxableNetIncome: number;
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
  };
}

export default function BirCompliance() {
  const { activeCompany } = useAuth();
  const [data, setData] = useState<ReturnTemplateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedForm, setSelectedForm] = useState<string>('AUTO');
  const [returnQuarter, setReturnQuarter] = useState<string>('Q3-2026');
  const [amendedReturn, setAmendedReturn] = useState<boolean>(false);

  useEffect(() => {
    fetchTemplateData();
  }, [activeCompany?.id]);

  const fetchTemplateData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/tax/compliance/templates');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        // Auto select form based on company
        const vatStatus = json.company?.vatStatus || 'VAT';
        const taxpayerType = json.company?.taxpayerClassification || 'CORPORATION';
        
        if (selectedForm === 'AUTO') {
          if (vatStatus === 'VAT') {
            setSelectedForm('2550Q');
          } else {
            setSelectedForm('2551Q');
          }
        }
      }
    } catch (err) {
      console.error('Failed to load BIR template data:', err);
    } finally {
      setLoading(false);
    }
  };

  const vatStatus = data?.company.vatStatus || activeCompany?.vatStatus || 'VAT';
  const taxpayerType = data?.company.taxpayerClassification || activeCompany?.taxpayerClassification || 'CORPORATION';
  const profileRules = getBirTaxProfileRules(taxpayerType, vatStatus);
  const isVat = profileRules.isVatRegistered;
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

  const metrics = data?.returnMetrics || {
    grossSales: 0,
    salesSubtotal: 0,
    outputVat: 0,
    grossPurchases: 0,
    purchaseSubtotal: 0,
    inputVat: 0,
    netVatPayable: 0,
    percentageTaxDue: 0,
    grossProfit: 0,
    estOperatingExpenses: 0,
    taxableNetIncome: 0,
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
    legalName: activeCompany?.legalName || 'Registered Company',
    tin: activeCompany?.tin || '000-123-456-00000',
    rdoCode: activeCompany?.rdoCode || '039',
    address: (activeCompany as any)?.address || 'Metro Manila, Philippines',
    vatStatus,
    taxpayerClassification: taxpayerType,
    industry: 'Business Operations & Trading'
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

        <div className="flex items-center gap-3">
          <button
            onClick={fetchTemplateData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Data
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Printer className="w-4 h-4" /> Print / Export PDF
          </button>
        </div>
      </div>

      {/* Tax Profile Matrix & Form Selector */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600" />
              Taxpayer Information & Registration Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Registered Legal Name: <strong className="text-slate-800 dark:text-slate-200">{company.legalName}</strong> | 12-Digit TIN: <strong className="text-slate-800 dark:text-slate-200">{company.tin}</strong> | RDO Code: <strong className="text-slate-800 dark:text-slate-200">{company.rdoCode}</strong>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Return Period</label>
              <select
                value={returnQuarter}
                onChange={(e) => setReturnQuarter(e.target.value)}
                className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
              >
                <option value="Q3-2026">3rd Quarter 2026</option>
                <option value="Q2-2026">2nd Quarter 2026</option>
                <option value="Q1-2026">1st Quarter 2026</option>
                <option value="ANNUAL-2025">Annual Fiscal Year 2025</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Amended Return?</label>
              <button
                type="button"
                onClick={() => setAmendedReturn(!amendedReturn)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all ${amendedReturn ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}
              >
                {amendedReturn ? 'YES (Amended)' : 'NO (Original)'}
              </button>
            </div>
          </div>
        </div>

        {/* BIR Form Selector Tabs */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Select Mandatory BIR Tax Return Form Template:
          </label>
          <div className="flex flex-wrap gap-2">
            {isVat ? (
              <button
                onClick={() => setSelectedForm('2550Q')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '2550Q' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
              >
                <FileText className="w-3.5 h-3.5" /> BIR Form 2550Q (Quarterly VAT)
              </button>
            ) : (
              <button
                onClick={() => setSelectedForm('2551Q')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${selectedForm === '2551Q' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
              >
                <FileText className="w-3.5 h-3.5" /> BIR Form 2551Q (3% Percentage Tax)
              </button>
            )}

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
        
        {/* FORM 2550Q TEMPLATE */}
        {selectedForm === '2550Q' && (
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
                  <h1 className="text-2xl font-black font-serif tracking-wider">BIR Form No. 2550Q</h1>
                  <p className="text-xs font-bold">Quarterly Value-Added Tax Return</p>
                  <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">Pursuant to NIRC Sec. 114 & EOPT Act (RA 11976)</p>
                </div>
                <div className="text-right text-[10px] font-mono border border-slate-800 p-2 rounded bg-white dark:bg-slate-800">
                  <p className="font-bold">FOR BIR USE ONLY</p>
                  <p>Period: {returnQuarter}</p>
                  <p>Amended: {amendedReturn ? 'YES' : 'NO'}</p>
                </div>
              </div>
            </div>

            {/* Part I: Taxpayer Information */}
            <div className="border border-slate-800 rounded bg-white dark:bg-slate-800/80 p-4 text-xs space-y-2">
              <h2 className="font-black text-slate-900 dark:text-slate-100 border-b border-slate-400 pb-1 uppercase tracking-wide">
                Part I: Taxpayer Background & Registration
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                <div>
                  <span className="text-slate-500 text-[10px] block">1. Taxpayer Identification Number (TIN):</span>
                  <strong className="text-sm text-indigo-700 dark:text-indigo-400">{company.tin}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">2. RDO Code:</span>
                  <strong>{company.rdoCode}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">3. Line of Business:</span>
                  <strong>{company.industry}</strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500 text-[10px] block">4. Registered Taxpayer Name:</span>
                  <strong className="uppercase text-sm">{company.legalName}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">5. Telephone / Contact:</span>
                  <strong>(02) 8888-9000</strong>
                </div>
                <div className="sm:col-span-3">
                  <span className="text-slate-500 text-[10px] block">6. Registered Address:</span>
                  <strong className="uppercase">{company.address}</strong>
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
                  <span>22. Less: Creditable Value Added Tax Withheld (Form 2307 Credits)</span>
                  <span>({formatCurrency(metrics.estimatedCwtCredits)})</span>
                </div>
                <div className="flex justify-between items-center py-2 bg-indigo-50 dark:bg-indigo-950/60 p-3 rounded-lg font-black text-base border border-indigo-200">
                  <span>26. TOTAL AMOUNT STILL DUE / PAYABLE</span>
                  <span className="text-indigo-800 dark:text-indigo-300">
                    {formatCurrency(Math.max(0, metrics.netVatPayable - metrics.estimatedCwtCredits))}
                  </span>
                </div>
              </div>
            </div>

            {/* Legal Deadline & Filing Notes */}
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-[11px] text-amber-800 dark:text-amber-200 font-mono space-y-1">
              <p className="font-bold">⚠️ Statutory Filing Deadline:</p>
              <p>Mandatory filing via BIR eFPS or eBIRForms is on or before the 25th day following the close of each taxable quarter.</p>
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
                  <span>2. Less: Cost of Sales / Services</span>
                  <span>({formatCurrency(metrics.purchaseSubtotal * 0.4)})</span>
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
                  <strong className="text-indigo-600">25.00%</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold">
                  <span>7. Income Tax Due</span>
                  <strong>{formatCurrency(metrics.corporateTaxDue)}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span>8. Less: Prior Quarter Payments & Creditable Tax Withheld (2307)</span>
                  <span>({formatCurrency(metrics.estimatedCwtCredits)})</span>
                </div>
                <div className="flex justify-between py-2 bg-blue-100 p-3 rounded-lg font-black text-base border border-blue-300">
                  <span>12. NET CORPORATE INCOME TAX STILL DUE</span>
                  <span className="text-blue-900">{formatCurrency(metrics.netCorporateTaxPayable)}</span>
                </div>
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

        {/* FORM 0619-E TEMPLATE */}
        {selectedForm === '0619E' && (
          <div className="space-y-6 max-w-4xl mx-auto border border-slate-800 p-6 bg-slate-50 dark:bg-slate-900 rounded-lg text-slate-900 dark:text-slate-100 font-mono">
            <div className="border-b-2 border-slate-900 pb-4 text-center">
              <h1 className="text-2xl font-black font-serif">BIR Form No. 0619-E / 1601-EQ</h1>
              <p className="text-xs font-bold">Monthly/Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded)</p>
            </div>

            <div className="border border-slate-800 rounded p-4 text-xs space-y-3">
              <div className="flex justify-between py-1 border-b">
                <span>Amount of Income Payment Subject to Expanded Withholding Tax</span>
                <strong>{formatCurrency(metrics.purchaseSubtotal)}</strong>
              </div>
              <div className="flex justify-between py-2 bg-emerald-100 p-3 rounded-lg font-black text-base">
                <span>TOTAL EXPANDED TAX WITHHELD AT SOURCE</span>
                <span className="text-emerald-900">{formatCurrency(metrics.purchaseSubtotal * 0.02)}</span>
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
              <p className="text-[10px] text-slate-500">Signature Over Printed Name & Date</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 mb-8">
              Official BIR Electronic Return Copy generated by LedgerAI-PH Compliance Engine.
            </p>
            <div className="border-t border-slate-800 pt-1 inline-block text-left">
              <p className="font-bold">BIR eFPS / eBIRForms STAMP</p>
              <p className="text-[10px] text-slate-500">System Verification Code: {company.tin.slice(0, 9)}-2026-OK</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
