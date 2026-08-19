import React, { useState } from 'react';
import { Calculator, Play, FileCheck, ShieldCheck, CheckCircle2, ArrowRight, RefreshCw, BarChart2, Layers } from 'lucide-react';

export default function AuditSampling() {
  const [targetPopulation, setTargetPopulation] = useState<'SALES_INVOICES' | 'PURCHASE_BILLS' | 'JOURNAL_ENTRIES'>('SALES_INVOICES');
  const [samplingMethod, setSamplingMethod] = useState<'MUS' | 'RANDOM' | 'STRATIFIED'>('MUS');
  const [materialityThresholdPhp, setMaterialityThresholdPhp] = useState(100000); // 100k PHP
  const [sampleSize, setSampleSize] = useState(10);
  const [confidenceLevel, setConfidenceLevel] = useState(95);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val || 0);
  };

  const handleRunSampling = async () => {
    setLoading(true);
    setSaveSuccess('');
    try {
      const res = await fetch('/api/audit-advanced/sampling/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPopulation,
          samplingMethod,
          materialityThreshold: materialityThresholdPhp * 100, // convert to centavos
          sampleSize,
          confidenceLevel
        })
      });
      const data = await res.json();
      if (res.ok) {
        setResults(data);
      } else {
        alert(data.error || 'Failed to execute audit sampling');
      }
    } catch (err) {
      console.error(err);
      alert('Error running audit sampling algorithm');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToWorkpaper = async () => {
    if (!results || !results.samples || results.samples.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/audit-advanced/sampling/save-to-workpaper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPopulation,
          wpTitle: `Substantive Audit Sample - ${targetPopulation} (${samplingMethod})`,
          samplingSummary: results.summary,
          samples: results.samples
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSaveSuccess(`Successfully attached sample to Workpaper #${data.wpRef}`);
      } else {
        alert(data.error || 'Failed to save to workpaper');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Automated Audit Sampling Engine
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Compliant with Philippine Standards on Auditing (PSA 530 - Audit Sampling). Calculate statistical Monetary Unit Sampling (MUS), Stratified, or Random selections directly from active ledgers.
          </p>
        </div>
      </div>

      {/* Sampling Controls Configuration Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" /> Sampling Parameters
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Target Ledger Population
            </label>
            <select
              value={targetPopulation}
              onChange={(e: any) => setTargetPopulation(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            >
              <option value="SALES_INVOICES">Sales Invoices & Receivables (AR)</option>
              <option value="PURCHASE_BILLS">Purchase Bills & Payables (AP)</option>
              <option value="JOURNAL_ENTRIES">General Journal Entries (GL)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Sampling Methodology
            </label>
            <select
              value={samplingMethod}
              onChange={(e: any) => setSamplingMethod(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            >
              <option value="MUS">Monetary Unit Sampling (MUS / Cutoff)</option>
              <option value="STRATIFIED">Stratified Value-Weighted Stratum</option>
              <option value="RANDOM">Uniform Statistical Random</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Materiality Cutoff Threshold (PHP)
            </label>
            <input
              type="number"
              value={materialityThresholdPhp}
              onChange={(e) => setMaterialityThresholdPhp(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
              placeholder="100000"
            />
            <p className="text-[11px] text-slate-400 mt-1">100% testing applied to items exceeding this threshold.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Target Sample Size
              </label>
              <input
                type="number"
                value={sampleSize}
                onChange={(e) => setSampleSize(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Confidence Level
              </label>
              <select
                value={confidenceLevel}
                onChange={(e) => setConfidenceLevel(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
              >
                <option value={90}>90% Confidence</option>
                <option value={95}>95% Standard</option>
                <option value={99}>99% High Risk</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleRunSampling}
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
            Run Audit Sampling
          </button>
        </div>

        {/* Results Output Section */}
        <div className="lg:col-span-2 space-y-4">
          {results && results.summary ? (
            <>
              {/* Coverage Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-xs text-slate-400 block font-medium">Population Size</span>
                  <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                    {results.summary.populationCount} <span className="text-xs font-normal text-slate-500">items</span>
                  </p>
                  <span className="text-[11px] text-slate-400 font-mono mt-1 block">
                    {formatCurrency(results.summary.populationValuePhp)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-xs text-slate-400 block font-medium">Selected Sample</span>
                  <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
                    {results.summary.sampleCount} <span className="text-xs font-normal text-slate-500">vouched</span>
                  </p>
                  <span className="text-[11px] text-slate-400 font-mono mt-1 block">
                    {formatCurrency(results.summary.sampleValuePhp)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-xs text-slate-400 block font-medium">Value Coverage %</span>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {results.summary.coveragePercentage}%
                  </p>
                  <span className="text-[11px] text-emerald-500 font-medium mt-1 block">
                    PSA 530 Compliant
                  </span>
                </div>
              </div>

              {/* Sample Table */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                    Selected Substantive Test Sample Items
                  </h4>
                  <button
                    onClick={handleSaveToWorkpaper}
                    disabled={saving}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
                    Attach to Working Paper
                  </button>
                </div>

                {saveSuccess && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {saveSuccess}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 min-w-[600px]">
                    <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-3 py-2">Ref No</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Counterparty</th>
                        <th className="px-3 py-2">Stratum / Reason</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {results.samples.map((item: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                          <td className="px-3 py-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {item.refNo}
                          </td>
                          <td className="px-3 py-2.5">{item.date}</td>
                          <td className="px-3 py-2.5 font-medium">{item.counterparty}</td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.stratum?.includes('HIGH') 
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300' 
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                            }`}>
                              {item.reason || item.stratum}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold">
                            {formatCurrency(item.amountPhp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="p-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-slate-400 space-y-3">
              <BarChart2 className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium">Configure sampling parameters on the left and click "Run Audit Sampling".</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
