import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function FraudDetectionView() {
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchFlags = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/audit-advanced/fraud');
      const data = await res.json();
      if (res.ok) {
        setFlags(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const handleRunScan = async () => {
    try {
      setScanning(true);
      const res = await fetch('/api/audit-advanced/fraud/run-scan', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchFlags();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (id: string, status: string) => {
    const notes = prompt('Enter resolution or false-positive notes:');
    if (!notes) return;
    try {
      const res = await fetch(`/api/audit-advanced/fraud/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolutionNotes: notes })
      });
      if (res.ok) {
        fetchFlags();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" /> Fraud Detection Integration
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Automated heuristics scanner for duplicate payments, round-number transactions, manual JEs, and suspicious activity.</p>
        </div>
        <button
          onClick={handleRunScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} /> Run Fraud Heuristics Scan
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b font-bold text-xs text-slate-400 uppercase">Detected Fraud & Risk Flags ({flags.length})</div>
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading fraud findings...</div>
        ) : flags.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No suspicious flags detected. Click "Run Fraud Heuristics Scan" to analyze company ledger.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {flags.map(flag => (
              <div key={flag.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 rounded">
                      {flag.ruleName}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      flag.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-700' :
                      flag.status === 'FALSE_POSITIVE' ? 'bg-blue-100 text-blue-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {flag.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-200 font-mono">{flag.detailsJson}</p>
                  {flag.resolutionNotes && <p className="text-[11px] text-slate-400">Notes: {flag.resolutionNotes}</p>}
                </div>

                {flag.status === 'FLAGGED' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleResolve(flag.id, 'RESOLVED')}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => handleResolve(flag.id, 'FALSE_POSITIVE')}
                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold"
                    >
                      False Positive
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
