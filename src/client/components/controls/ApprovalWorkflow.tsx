import React, { useEffect, useState } from 'react';
import { ShieldCheck, UserCheck, CheckCircle2, XCircle, Plus, AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function ApprovalWorkflow() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionType, setActionType] = useState('JOURNAL_ENTRY_POSTING');
  const [amountPHP, setAmountPHP] = useState('100000');
  const [details, setDetails] = useState('');

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/approval/requests');
      const data = await res.json();
      if (res.ok) {
        setRequests(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/approval/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType, amountPHP: Number(amountPHP), details })
      });
      const data = await res.json();
      if (res.ok) {
        setIsModalOpen(false);
        setDetails('');
        fetchRequests();
      } else {
        alert(data.error || 'Failed to submit approval request');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAction = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await fetch(`/api/approval/requests/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchRequests();
      } else {
        alert('Failed to update request');
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-indigo-600" /> Maker-Checker Approval Workflow
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Four-eyes principle enforcement requiring secondary independent approval for sensitive accounting actions, threshold disbursements, and period closes.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> Request Sensitive Action Approval
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider">
          Pending & Historical Maker-Checker Requests ({requests.length})
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-400 text-xs">Loading approval workflow requests...</div>
        ) : requests.length === 0 ? (
          <div className="p-16 text-center text-slate-400 text-xs space-y-2">
            <p className="font-semibold text-slate-600 dark:text-slate-300">No approval requests submitted yet.</p>
            <p>Initiate sensitive accounting actions above to require secondary checker review.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {requests.map(req => (
              <div key={req.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 rounded-md">
                      {req.actionType}
                    </span>
                    <span className="text-xs font-bold text-emerald-600">
                      ₱{Number(req.amountPHP).toLocaleString()}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      req.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
                      req.status === 'REJECTED' ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300' :
                      'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                    }`}>
                      {req.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                    {req.details}
                  </p>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Maker ID: {req.makerUserId} • Created: {new Date(req.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {req.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handleAction(req.id, 'APPROVED')}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                      >
                        Approve (4-Eyes)
                      </button>
                      <button
                        onClick={() => handleAction(req.id, 'REJECTED')}
                        className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-600 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-xl border w-full max-w-md overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h4 className="font-bold text-xs flex items-center gap-2">
                <Lock className="w-4 h-4 text-indigo-600" /> Request Maker-Checker Approval
              </h4>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateRequest} className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Action Type</label>
                <select
                  value={actionType}
                  onChange={e => setActionType(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                >
                  <option value="JOURNAL_ENTRY_POSTING">Journal Entry Posting</option>
                  <option value="VENDOR_DISBURSEMENT">Vendor Disbursement / Check Run</option>
                  <option value="PERIOD_CLOSE">Period Close / Year-End Adjustment</option>
                  <option value="TAX_FILING">Tax Return Final Filing</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (PHP)</label>
                <input
                  type="number"
                  required
                  value={amountPHP}
                  onChange={e => setAmountPHP(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Justification & Details</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe why this sensitive action is required..."
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                ></textarea>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">Submit for Review</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
