import React, { useEffect, useState } from 'react';
import { 
  ShieldAlert, RefreshCw, AlertTriangle, CheckCircle2, Search, Filter, 
  UserCheck, FileText, Lock, ArrowUpRight, ShieldCheck, AlertCircle 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function FraudDetection() {
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

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
        alert(data.message || 'Fraud scan completed successfully.');
        fetchFlags();
      } else {
        alert(data.error || 'Scan failed');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (id: string, status: string) => {
    const notes = prompt(`Enter resolution notes for status [${status}]:`);
    if (notes === null) return;
    try {
      const res = await fetch(`/api/audit-advanced/fraud/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolutionNotes: notes || 'Reviewed and classified by auditor.' })
      });
      if (res.ok) {
        fetchFlags();
      } else {
        alert('Failed to update status');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredFlags = flags.filter(f => {
    if (filterSeverity !== 'ALL' && f.severity !== filterSeverity) return false;
    if (filterStatus !== 'ALL' && f.status !== filterStatus) return false;
    return true;
  });

  const criticalCount = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length;
  const resolvedCount = flags.filter(f => f.status === 'RESOLVED' || f.status === 'FALSE_POSITIVE').length;

  return (
    <div className="w-full space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-600" /> Fraud Detection & Risk Scoring Dashboard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time heuristic anomaly detection monitoring duplicate payments, manual journal entries, round numbers, and backdated transactions.
          </p>
        </div>
        <button
          onClick={handleRunScan}
          disabled={scanning}
          className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Running Heuristics Scan...' : 'Run Fraud Heuristics Scan'}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-slate-500 text-xs font-medium">Total Flagged Items</div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">{flags.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">Across all heuristic rules</div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-slate-500 text-xs font-medium">High / Critical Risk</div>
          <div className="text-2xl font-black text-red-600 mt-1">{criticalCount}</div>
          <div className="text-[11px] text-red-500 mt-1">Requires immediate investigation</div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-slate-500 text-xs font-medium">Resolved & Closed</div>
          <div className="text-2xl font-black text-emerald-600 mt-1">{resolvedCount}</div>
          <div className="text-[11px] text-emerald-500 mt-1">Cleared with audit notes</div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-slate-500 text-xs font-medium">Scan Engine Status</div>
          <div className="text-lg font-bold text-indigo-600 mt-1 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span> Active / Real Ledger
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Direct database integration</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <Filter className="w-4 h-4" /> Filter Severity:
          </div>
          <select
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value)}
            className="px-3 py-1.5 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="text-xs font-bold text-slate-500">Status:</div>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">All Statuses</option>
            <option value="FLAGGED">Flagged</option>
            <option value="INVESTIGATING">Investigating</option>
            <option value="FALSE_POSITIVE">False Positive</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </div>
      </div>

      {/* Main Flags List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider">
          Ledger Fraud Risk Flags ({filteredFlags.length})
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-400 text-xs">Loading fraud heuristics data...</div>
        ) : filteredFlags.length === 0 ? (
          <div className="p-16 text-center text-slate-400 text-xs space-y-2">
            <p className="font-semibold text-slate-600 dark:text-slate-300">No fraud flags found matching your filters.</p>
            <p>Click "Run Fraud Heuristics Scan" to analyze company ledger transactions and manual entries.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredFlags.map(flag => (
              <div key={flag.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 rounded-md">
                      {flag.ruleName}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      flag.severity === 'CRITICAL' ? 'bg-red-500 text-white' :
                      flag.severity === 'HIGH' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300' :
                      'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                    }`}>
                      {flag.severity}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      flag.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
                      flag.status === 'FALSE_POSITIVE' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300' :
                      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      {flag.status}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                    {flag.detailsJson}
                  </p>

                  {flag.resolutionNotes && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                      Resolution Notes: {flag.resolutionNotes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 self-start md:self-center">
                  {flag.status === 'FLAGGED' && (
                    <>
                      <button
                        onClick={() => handleResolve(flag.id, 'RESOLVED')}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => handleResolve(flag.id, 'FALSE_POSITIVE')}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
                      >
                        False Positive
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
