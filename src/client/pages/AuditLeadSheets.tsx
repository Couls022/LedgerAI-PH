import React, { useEffect, useState } from 'react';
import { Table, RefreshCw, Plus, CheckCircle2, AlertCircle, FileText, Download, ShieldCheck } from 'lucide-react';

export default function AuditLeadSheets() {
  const [leadSheets, setLeadSheets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('A');

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val || 0);
  };

  const fetchLeadSheets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit-advanced/lead-sheets');
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setLeadSheets(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeadSheets();
  }, []);

  const activeSheet = leadSheets.find(ls => ls.categoryCode === selectedCategory) || leadSheets[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Table className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Audit Lead Sheets & Working Schedules
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Automated lead schedules summarizing Trial Balance accounts, Audit Journal Adjustments (AJE), and final audit balances per Financial Statement Class.
          </p>
        </div>
        <button
          onClick={fetchLeadSheets}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Recalculate Lead Sheets
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-none">
        {leadSheets.map((cat) => (
          <button
            key={cat.categoryCode}
            onClick={() => setSelectedCategory(cat.categoryCode)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
              selectedCategory === cat.categoryCode
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
            }`}
          >
            {cat.categoryCode} - {cat.categoryTitle}
          </button>
        ))}
      </div>

      {/* Selected Lead Sheet Detail Table */}
      {activeSheet ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-700">
            <div>
              <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase">
                Lead Sheet {activeSheet.categoryCode}
              </span>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {activeSheet.categoryTitle}
              </h3>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono font-semibold">
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">Unadjusted Total</span>
                <span className="text-slate-700 dark:text-slate-200">
                  {formatCurrency(activeSheet.unadjustedTotalPhp)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">Audited Total</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  {formatCurrency(activeSheet.adjustedTotalPhp)}
                </span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2.5">Account Code</th>
                  <th className="px-3 py-2.5">Account Title</th>
                  <th className="px-3 py-2.5 text-right">Unadjusted Balance</th>
                  <th className="px-3 py-2.5 text-right">AJE Debit</th>
                  <th className="px-3 py-2.5 text-right">AJE Credit</th>
                  <th className="px-3 py-2.5 text-right">Final Audited Balance</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {activeSheet.leadSheetRows.length > 0 ? (
                  activeSheet.leadSheetRows.map((row: any) => (
                    <tr key={row.accountId} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                      <td className="px-3 py-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                        {row.accountCode}
                      </td>
                      <td className="px-3 py-3 font-medium">{row.accountName}</td>
                      <td className="px-3 py-3 text-right font-mono">
                        {formatCurrency(row.unadjustedBalancePhp)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {row.ajeDebitPhp > 0 ? `+${formatCurrency(row.ajeDebitPhp)}` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-rose-500">
                        {row.ajeCreditPhp > 0 ? `-${formatCurrency(row.ajeCreditPhp)}` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {formatCurrency(row.adjustedBalancePhp)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          row.auditorStatus === 'VERIFIED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                            : row.auditorStatus === 'ADJUSTED'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {row.auditorStatus}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      No accounts assigned to this lead schedule category yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
