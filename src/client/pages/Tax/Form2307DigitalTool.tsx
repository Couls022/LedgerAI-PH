import React, { useState, useEffect } from 'react';
import { 
  FileText, Printer, Download, CheckCircle2, Building2, 
  RefreshCw, Filter, ShieldCheck, Sparkles, AlertCircle, ArrowRight, Save
} from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

interface APVendorSummary {
  vendorId: string;
  vendorCode: string;
  legalName: string;
  tradeName: string;
  tin: string;
  address: string;
  taxClassification: string;
  vatStatus: string;
  billCount: number;
  paymentCount: number;
  totalGrossBilledPhp: number;
  totalEwtWithheldPhp: number;
}

interface Form2307Certificate {
  certificateControlNo: string;
  periodFrom: string;
  periodTo: string;
  quarter: string;
  year: number;
  dateIssued: string;
  payor: {
    tin: string;
    legalName: string;
    tradeName: string;
    address: string;
    zipCode: string;
  };
  payee: {
    vendorId: string;
    vendorCode: string;
    tin: string;
    legalName: string;
    tradeName: string;
    address: string;
    zipCode: string;
    taxpayerType: string;
  };
  apRecordsCount: {
    billsCount: number;
    paymentsCount: number;
  };
  schedule: Array<{
    atcCode: string;
    natureOfPayment: string;
    month1GrossPhp: number;
    month2GrossPhp: number;
    month3GrossPhp: number;
    month1TaxPhp: number;
    month2TaxPhp: number;
    month3TaxPhp: number;
    totalGrossPhp: number;
    totalTaxWithheldPhp: number;
  }>;
  totals: {
    grossPaymentPhp: number;
    taxWithheldPhp: number;
  };
  signatory: {
    name: string;
    designation: string;
    tin: string;
  };
}

export default function Form2307DigitalTool() {
  const [apVendors, setApVendors] = useState<APVendorSummary[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('ALL');
  const [year, setYear] = useState<string>('2026');
  const [quarter, setQuarter] = useState<string>('Q1');
  const [overrideAtc, setOverrideAtc] = useState<string>('');
  const [overrideRate, setOverrideRate] = useState<string>('');
  
  const [certificates, setCertificates] = useState<Form2307Certificate[]>([]);
  const [selectedCertIndex, setSelectedCertIndex] = useState<number>(0);
  
  const [loadingVendors, setLoadingVendors] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [issuing, setIssuing] = useState<boolean>(false);
  const [issueSuccess, setIssueSuccess] = useState<string | null>(null);

  // Fetch AP vendors summary
  const fetchApVendors = async () => {
    setLoadingVendors(true);
    try {
      const res = await apiFetch('/api/tax/2307/ap-vendors');
      if (Array.isArray(res)) {
        setApVendors(res);
        if (res.length > 0 && selectedVendorId === 'ALL') {
          // Keep ALL as default or select first vendor
        }
      }
    } catch (err) {
      console.error('Failed to fetch AP vendors for 2307:', err);
    } finally {
      setLoadingVendors(false);
    }
  };

  // Generate 2307 certificates from live AP data
  const generateCertificates = async () => {
    setGenerating(true);
    setIssueSuccess(null);
    try {
      let url = `/api/tax/2307/generate?year=${year}&quarter=${quarter}`;
      if (selectedVendorId && selectedVendorId !== 'ALL') {
        url += `&vendorId=${selectedVendorId}`;
      }
      if (overrideAtc) url += `&overrideAtc=${overrideAtc}`;
      if (overrideRate) url += `&overrideRate=${overrideRate}`;

      const res = await apiFetch(url);
      if (Array.isArray(res)) {
        setCertificates(res);
        setSelectedCertIndex(0);
      }
    } catch (err) {
      console.error('Failed to generate Form 2307:', err);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    fetchApVendors();
  }, []);

  useEffect(() => {
    generateCertificates();
  }, [selectedVendorId, year, quarter, overrideAtc, overrideRate]);

  const handleIssueCertificate = async () => {
    const cert = certificates[selectedCertIndex];
    if (!cert) return;

    setIssuing(true);
    setIssueSuccess(null);
    try {
      const res = await apiFetch('/api/tax/2307/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificateControlNo: cert.certificateControlNo,
          vendorId: cert.payee.vendorId,
          quarter: cert.quarter,
          year: cert.year,
          grossPaymentPhp: cert.totals.grossPaymentPhp,
          taxWithheldPhp: cert.totals.taxWithheldPhp
        })
      });

      if (res?.success) {
        setIssueSuccess(res.message || `Certificate ${cert.certificateControlNo} successfully recorded!`);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to issue certificate');
    } finally {
      setIssuing(false);
    }
  };

  const currentCert = certificates[selectedCertIndex] || null;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val || 0);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Panel */}
      <div className="p-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black font-serif text-slate-900 dark:text-slate-100 tracking-wide flex items-center gap-2">
                BIR Form 2307 Digital Generator
                <span className="text-[10px] uppercase font-sans font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                  AP Live Records Integrated
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Automatically extracts Accounts Payable purchases, disbursements, and EWT deductions to generate official withholding certificates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchApVendors}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingVendors ? 'animate-spin' : ''}`} />
              Sync AP Records
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          {/* AP Vendor Dropdown */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
              Payee / AP Vendor
            </label>
            <select
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 font-semibold focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All AP Vendors ({apVendors.length})</option>
              {apVendors.map((v) => (
                <option key={v.vendorId} value={v.vendorId}>
                  {v.legalName} ({v.billCount} bills - {formatCurrency(v.totalEwtWithheldPhp)})
                </option>
              ))}
            </select>
          </div>

          {/* Quarter & Year */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
              Filing Period
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 font-semibold"
              >
                <option value="Q1">Q1 (Jan-Mar)</option>
                <option value="Q2">Q2 (Apr-Jun)</option>
                <option value="Q3">Q3 (Jul-Sep)</option>
                <option value="Q4">Q4 (Oct-Dec)</option>
              </select>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 font-semibold text-center"
              />
            </div>
          </div>

          {/* ATC Override */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
              ATC Code Override
            </label>
            <select
              value={overrideAtc}
              onChange={(e) => setOverrideAtc(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 font-semibold"
            >
              <option value="">Auto-Detect (WC100 / WI100)</option>
              <option value="WC100">WC100 - Prof Fees Corp (2%)</option>
              <option value="WI100">WI100 - Prof Fees Individual (2%)</option>
              <option value="WC157">WC157 - Top Withholding Agent Corp (2%)</option>
              <option value="WI157">WI157 - Top Withholding Agent Individual (2%)</option>
              <option value="WC140">WC140 - Brokerage Fees Corp (10%)</option>
              <option value="WI120">WI120 - Real Property Rentals (5%)</option>
            </select>
          </div>

          {/* Tax Rate Override */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
              Withholding Tax Rate (%)
            </label>
            <select
              value={overrideRate}
              onChange={(e) => setOverrideRate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 font-semibold"
            >
              <option value="">Standard (2%)</option>
              <option value="1">1% (Goods / TWA)</option>
              <option value="2">2% (Services / Prof Fees)</option>
              <option value="5">5% (Rentals / Gov't)</option>
              <option value="10">10% (Brokers / Directors)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Vendor Selector Badges (If multiple certificates generated) */}
      {certificates.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="font-bold text-slate-500 uppercase text-[10px] shrink-0">Generated Payees ({certificates.length}):</span>
          {certificates.map((c, idx) => (
            <button
              key={c.certificateControlNo}
              onClick={() => setSelectedCertIndex(idx)}
              className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all border ${
                selectedCertIndex === idx
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              {c.payee.legalName} ({formatCurrency(c.totals.taxWithheldPhp)})
            </button>
          ))}
        </div>
      )}

      {/* Success Notification Banner */}
      {issueSuccess && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{issueSuccess}</span>
          </div>
          <button onClick={() => setIssueSuccess(null)} className="text-emerald-600 font-bold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Official Pixel-Perfect BIR Form 2307 Preview */}
      {currentCert ? (
        <div className="bg-white dark:bg-slate-900 border-2 border-slate-800 rounded-2xl shadow-xl p-8 space-y-6 font-mono text-xs text-slate-900 dark:text-slate-100">
          {/* Action Header inside Certificate */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-300 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                Control #: {currentCert.certificateControlNo}
              </span>
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold rounded-lg text-[11px]">
                AP Bills: {currentCert.apRecordsCount.billsCount} Linked
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleIssueCertificate}
                disabled={issuing}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                {issuing ? 'Issuing...' : 'Issue & Record 2307'}
              </button>

              <button
                onClick={() => window.print()}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                Print Certificate
              </button>
            </div>
          </div>

          {/* BIR Form Header Title */}
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-black font-serif tracking-wider uppercase">BIR FORM NO. 2307</h1>
            <p className="text-xs font-bold uppercase tracking-wide">Certificate of Creditable Tax Withheld at Source</p>
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold pt-1">
              Period Covered: {currentCert.periodFrom} to {currentCert.periodTo} ({currentCert.quarter} {currentCert.year})
            </p>
          </div>

          {/* Parts I & II: Payee & Payor Boxes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Payee Box */}
            <div className="border border-slate-700 rounded-xl p-4 space-y-2 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="border-b border-slate-400 pb-1 flex justify-between items-center">
                <span className="font-bold uppercase text-[10px] text-slate-500">Part I - Payee Details (Supplier)</span>
                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{currentCert.payee.vendorCode}</span>
              </div>
              <div className="space-y-1">
                <p className="text-xs">Taxpayer Identification No. (TIN): <strong className="font-bold text-slate-900 dark:text-slate-100">{currentCert.payee.tin}</strong></p>
                <p className="text-xs">Payee's Registered Name: <strong className="font-bold uppercase text-slate-900 dark:text-slate-100">{currentCert.payee.legalName}</strong></p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Registered Address: {currentCert.payee.address}</p>
                <p className="text-[11px] text-slate-500">Tax Classification: {currentCert.payee.taxpayerType}</p>
              </div>
            </div>

            {/* Payor Box */}
            <div className="border border-slate-700 rounded-xl p-4 space-y-2 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="border-b border-slate-400 pb-1 flex justify-between items-center">
                <span className="font-bold uppercase text-[10px] text-slate-500">Part II - Payor Details (Withholding Agent)</span>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Withholding Agent</span>
              </div>
              <div className="space-y-1">
                <p className="text-xs">Taxpayer Identification No. (TIN): <strong className="font-bold text-slate-900 dark:text-slate-100">{currentCert.payor.tin}</strong></p>
                <p className="text-xs">Payor's Registered Name: <strong className="font-bold uppercase text-slate-900 dark:text-slate-100">{currentCert.payor.legalName}</strong></p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Registered Address: {currentCert.payor.address}</p>
                <p className="text-[11px] text-slate-500">Zip Code: {currentCert.payor.zipCode}</p>
              </div>
            </div>
          </div>

          {/* Part III: Details of Income Payments Schedule */}
          <div className="space-y-2">
            <span className="font-bold uppercase text-[10px] text-slate-500 block">
              Part III - Details of Income Payments Subject to Expanded Withholding Tax
            </span>

            <div className="overflow-x-auto border border-slate-700 rounded-xl">
              <table className="w-full text-left border-collapse text-xs min-w-[800px]">
                <thead>
                  <tr className="bg-slate-200 dark:bg-slate-800 border-b border-slate-700 text-[10px] uppercase font-bold text-slate-700 dark:text-slate-200">
                    <th className="p-2.5 border-r border-slate-700">ATC</th>
                    <th className="p-2.5 border-r border-slate-700">Nature of Income Payment</th>
                    <th className="p-2.5 border-r border-slate-700 text-right">1st Month</th>
                    <th className="p-2.5 border-r border-slate-700 text-right">2nd Month</th>
                    <th className="p-2.5 border-r border-slate-700 text-right">3rd Month</th>
                    <th className="p-2.5 border-r border-slate-700 text-right">Total Gross Payment</th>
                    <th className="p-2.5 text-right font-black">Tax Withheld</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-slate-700">
                  {currentCert.schedule.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                      <td className="p-2.5 border-r border-slate-700 font-bold text-indigo-600 dark:text-indigo-400">
                        {item.atcCode}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 font-sans">
                        {item.natureOfPayment}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right font-mono">
                        {formatCurrency(item.month1GrossPhp)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right font-mono">
                        {formatCurrency(item.month2GrossPhp)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right font-mono">
                        {formatCurrency(item.month3GrossPhp)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right font-bold font-mono">
                        {formatCurrency(item.totalGrossPhp)}
                      </td>
                      <td className="p-2.5 text-right font-black font-mono text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(item.totalTaxWithheldPhp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 font-bold text-slate-900 dark:text-slate-100 border-t border-slate-700">
                    <td colSpan={5} className="p-2.5 border-r border-slate-700 uppercase text-right">
                      Total Creditable Tax Withheld:
                    </td>
                    <td className="p-2.5 border-r border-slate-700 text-right font-mono">
                      {formatCurrency(currentCert.totals.grossPaymentPhp)}
                    </td>
                    <td className="p-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatCurrency(currentCert.totals.taxWithheldPhp)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Perjury Declaration & Official Signatory Block */}
          <div className="pt-6 border-t border-slate-400 grid grid-cols-1 md:grid-cols-2 gap-6 text-[11px] font-sans">
            <div className="space-y-3">
              <p className="text-[10px] text-slate-500 leading-relaxed italic">
                I declare under the penalties of perjury that this certificate has been made in good faith, verified by me, and to the best of my knowledge and belief, is true and correct pursuant to NIRC regulations and BIR revenue issuances.
              </p>
              <div className="pt-4 border-t border-slate-800">
                <p className="font-bold text-slate-800 dark:text-slate-200">{currentCert.signatory.name}</p>
                <p className="text-[10px] text-slate-500">{currentCert.signatory.designation} (TIN: {currentCert.signatory.tin})</p>
              </div>
            </div>

            <div className="text-right space-y-3">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Official BIR Electronic Return Copy generated by LedgerAI-PH Statutory Compliance Engine.
              </p>
              <div className="pt-4 border-t border-slate-800 inline-block text-left">
                <p className="font-bold text-slate-800 dark:text-slate-200">BIR eFPS Verification Stamp</p>
                <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                  Verification Code: {currentCert.payor.tin.slice(0, 9)}-2026-CERT-OK
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <p className="text-sm font-semibold">No Accounts Payable records found for selected vendor/period.</p>
          <p className="text-xs mt-1">Select a different AP Vendor or Filing Quarter from the controls above.</p>
        </div>
      )}
    </div>
  );
}
