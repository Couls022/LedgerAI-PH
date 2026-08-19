import React, { useState } from 'react';
import { ShieldAlert, CheckCircle, RefreshCcw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuditIntegrity() {
  const { activeCompany } = useAuth();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runIntegrityCheck = async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/integrity-check`, {
        headers: {
          'Authorization': `Bearer \${localStorage.getItem('ledgerai_token')}`
        }
      });
      if (!res.ok) throw new Error("Failed to fetch integrity report");
      const data = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ledger Integrity Audit</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Automated double-entry invariant verification across all posted journal entries.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Integrity Verification Tool</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Scans all historically posted journals for unbalanced debits and credits.
            </p>
          </div>
          <button
            onClick={runIntegrityCheck}
            disabled={loading || !activeCompany}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 \${loading ? 'animate-spin' : ''}`} />
            {loading ? "Scanning..." : "Run Integrity Scan"}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm mb-6 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {report && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Posted Journals Scanned</div>
                <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{report.totalPosted}</div>
              </div>
              <div className={`p-4 rounded-xl border \${report.violationsCount === 0 ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'}`}>
                <div className={`text-sm mb-1 \${report.violationsCount === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  Integrity Violations Found
                </div>
                <div className={`text-2xl font-bold flex items-center gap-2 \${report.violationsCount === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {report.violationsCount}
                  {report.violationsCount === 0 ? <CheckCircle className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
                </div>
              </div>
            </div>

            {report.violationsCount > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[500px]">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Journal No.</th>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400 text-right">Total Debit</th>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400 text-right">Total Credit</th>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400 text-right">Discrepancy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {report.violations.map((v: any) => (
                      <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 text-slate-900 dark:text-slate-100 font-medium">{v.journalNumber}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-right text-red-600 font-mono">
                          ₱{(v.totalDebit / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-right text-red-600 font-mono">
                          ₱{(v.totalCredit / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-right text-red-600 font-bold font-mono">
                          ₱{(v.discrepancy / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 px-4">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">Double-Entry Invariant Intact</h4>
                <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mx-auto">
                  All posted journals perfectly balance. The integrity of the general ledger is verified.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
