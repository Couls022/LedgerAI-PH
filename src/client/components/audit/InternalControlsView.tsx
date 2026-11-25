import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, CheckCircle2, XCircle, Plus, AlertCircle, X } from 'lucide-react';
import ApprovalMatrix from '../controls/ApprovalMatrix';

export default function InternalControlsView() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionType, setActionType] = useState('PERIOD_REOPEN');
  const [thresholdPhp, setThresholdPhp] = useState('10000');
  const [overrideReason, setOverrideReason] = useState('Urgent adjustment needed for prior period accrual.');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/audit-advanced/controls');
      const data = await res.json();
      if (res.ok) {
        setLogs(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleRequestOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setStatusBanner(null);
    try {
      const parsedPhp = parseFloat(thresholdPhp);
      const thresholdAmountCentavos = Number.isFinite(parsedPhp) && parsedPhp > 0 ? Math.round(parsedPhp * 100) : null;
      const res = await fetch('/api/audit-advanced/controls/request-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType, thresholdAmount: thresholdAmountCentavos, overrideReason })
      });
      const data = await res.json();
      if (res.ok) {
        setIsModalOpen(false);
        setStatusBanner({ type: 'success', message: 'Control override request submitted for approval.' });
        fetchLogs();
      } else {
        setModalError(data.error || 'Failed to submit override request.');
      }
    } catch (err: any) {
      console.error(err);
      setModalError(err?.message || 'Failed to submit override request.');
    }
  };

  const handleAction = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setStatusBanner(null);
    try {
      const res = await fetch(`/api/audit-advanced/controls/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      const data = await res.json();
      if (res.ok) {
        fetchLogs();
        setStatusBanner({ type: 'success', message: data.message || `Control override ${decision.toLowerCase()}.` });
      } else {
        setStatusBanner({ type: 'error', message: data.error || 'Maker-checker check failed.' });
      }
    } catch (err: any) {
      console.error(err);
      setStatusBanner({ type: 'error', message: err?.message || 'Maker-checker check failed.' });
    }
  };

  return (
    <div className="space-y-8">
      <ApprovalMatrix />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" /> Internal Control Enforcement & Maker-Checker
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Enforce four-eyes approval matrices, segregation-of-duties checks, and immutable override audit logs.</p>
          </div>
          <button
            onClick={() => { setModalError(null); setIsModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
          >
            <Plus className="w-4 h-4" /> Request Sensitive Override
          </button>
        </div>

        {statusBanner && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
            }`}
          >
            <span>{statusBanner.message}</span>
            <button type="button" onClick={() => setStatusBanner(null)} className="text-[11px] font-bold underline">
              Dismiss
            </button>
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b font-bold text-xs text-slate-400 uppercase">Maker-Checker & Override Audit Trail</div>
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-400">Loading control logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">No sensitive override requests recorded.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {logs.map(log => (
                <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 rounded">
                        {log.actionType}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        log.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        log.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-200"><strong>Reason:</strong> {log.overrideReason}</p>
                    <p className="text-[11px] text-slate-400">
                      Threshold: ₱{((Number(log.thresholdAmount) || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>

                  {log.status === 'PENDING' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAction(log.id, 'APPROVED')}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm"
                      >
                        Approve (4-Eyes)
                      </button>
                      <button
                        onClick={() => handleAction(log.id, 'REJECTED')}
                        className="px-3.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-bold"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border w-full max-w-md overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <h4 className="font-bold text-xs">Request Control Override</h4>
              <button onClick={() => setIsModalOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRequestOverride} className="p-6 space-y-4">
              {modalError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold">
                  {modalError}
                </div>
              )}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Action Type</label>
                <select value={actionType} onChange={e => setActionType(e.target.value)} className="w-full px-3 py-2 text-xs border rounded-lg">
                  <option value="PERIOD_REOPEN">Closed Period Reopening</option>
                  <option value="HIGH_VALUE_DISBURSEMENT">High-Value Disbursement Exceeding Threshold</option>
                  <option value="MANUAL_JOURNAL_OVERRIDE">Manual Journal Entry Post-Period Override</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Threshold Amount (PHP)</label>
                <input type="number" step="0.01" min="0" value={thresholdPhp} onChange={e => setThresholdPhp(e.target.value)} className="w-full px-3 py-2 text-xs border rounded-lg font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Override Justification Reason</label>
                <textarea rows={3} value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Submit for Approval</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
