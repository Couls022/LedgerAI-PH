import React, { useEffect, useState } from 'react';
import { Download, Printer, ShieldCheck, FileCheck, CheckCircle2, FileText, Building2, Calendar, Award } from 'lucide-react';

export default function AuditPackageExporter() {
  const [pkg, setPkg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [auditOpinion, setAuditOpinion] = useState<'UNQUALIFIED' | 'QUALIFIED' | 'ADVERSE'>('UNQUALIFIED');

  const fetchPackage = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit-advanced/package/export');
      const data = await res.json();
      if (res.ok) {
        setPkg(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPackage();
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadJson = () => {
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Audit_Engagement_Binder_${pkg.metadata?.companyName || 'Company'}_2026.json`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Download className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Audit Package & Working Paper Binder Exporter
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Export complete PSA-compliant audit working paper binder containing lead sheets, sampling results, findings, and audit opinion draft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadJson}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export Audit Binder (JSON)
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Audit Binder
          </button>
        </div>
      </div>

      {/* Package Printable Preview Binder */}
      {pkg ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-6 gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                Independent Auditor's Engagement Binder
              </span>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {pkg.metadata?.companyName}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                TIN: {pkg.metadata?.tin || 'Registered Taxpayer'} | Fiscal Year: {pkg.metadata?.fiscalYear} | Standard: {pkg.metadata?.psaStandardVersion}
              </p>
            </div>
            <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              Audit Engagement Active
            </div>
          </div>

          {/* Draft Auditor's Opinion Selection */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300 flex items-center gap-2">
              <Award className="w-4 h-4 text-indigo-500" /> Draft Auditor's Opinion Draft
            </h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setAuditOpinion('UNQUALIFIED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  auditOpinion === 'UNQUALIFIED'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Unqualified (Clean Opinion)
              </button>
              <button
                onClick={() => setAuditOpinion('QUALIFIED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  auditOpinion === 'QUALIFIED'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Qualified Opinion (Except For)
              </button>
              <button
                onClick={() => setAuditOpinion('ADVERSE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  auditOpinion === 'ADVERSE'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Adverse / Disclaimer Opinion
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 italic pt-1">
              {auditOpinion === 'UNQUALIFIED' && '"In our opinion, the accompanying financial statements present fairly, in all material respects, the financial position of the company in accordance with Philippine Financial Reporting Standards (PFRS)."'}
              {auditOpinion === 'QUALIFIED' && '"Except for the effects of the matter described in the Basis for Qualified Opinion section, the financial statements present fairly in all material respects."'}
              {auditOpinion === 'ADVERSE' && '"Due to the significance of the matters described, the financial statements do not present fairly the financial position."'}
            </p>
          </div>

          {/* Binder Summary Modules */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-400 block font-medium">Working Papers</span>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">
                {pkg.workpapersCount} <span className="text-xs font-normal text-slate-500">filed</span>
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-400 block font-medium">Audit Findings</span>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                {pkg.findingsCount} <span className="text-xs font-normal text-slate-500">observations</span>
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-400 block font-medium">Audit Adjustments (AJE)</span>
              <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                {pkg.proposedAdjustmentsCount} <span className="text-xs font-normal text-slate-500">entries</span>
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-400 block font-medium">Audit Logs Trail</span>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {pkg.auditLogsCount} <span className="text-xs font-normal text-slate-500">recorded</span>
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
