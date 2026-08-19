import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, DollarSign, Plus, X, ShieldAlert, FileSpreadsheet } from 'lucide-react';

export default function AuditFindingsAndAdjustmentsView({ engagementId }: { engagementId: string }) {
  const [findings, setFindings] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'findings' | 'adjustments'>('findings');

  const [isFindingModal, setIsFindingModal] = useState(false);
  const [isAdjModal, setIsAdjModal] = useState(false);

  const [newFinding, setNewFinding] = useState({
    title: 'Lack of Segregation of Duties in Cash Disbursements',
    riskRating: 'HIGH',
    criteria: 'PAS 1 / Internal Control Framework Policy 4.2',
    condition: 'Accounts payable clerk has rights to create vendors and disburse checks.',
    cause: 'System role configuration limitation in legacy setup.',
    effect: 'Risk of unauthorized or fictitious disbursements.',
    recommendation: 'Implement strict maker-checker controls immediately.',
    managementResponse: 'Agreed. Remediation underway.',
    targetDate: '2026-09-30'
  });

  const [newAdj, setNewAdj] = useState({
    adjustmentType: 'PROPOSED',
    classification: 'FSD',
    financialEffect: 'Understatement of Accrued Expenses by PHP 250,000.',
    managementResponse: 'Will record in Q3 adjustments.',
    affectedAccountsJson: [{ accountName: 'Operating Expenses', amount: 25000000 }, { accountName: 'Accrued Liabilities', amount: -25000000 }]
  });

  const fetchAll = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/audit-advanced/findings/${engagementId}`);
      const data = await res.json();
      if (res.ok) {
        setFindings(data.findings || []);
        setAdjustments(data.adjustments || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [engagementId]);

  const handleCreateFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/audit-advanced/findings/${engagementId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFinding)
      });
      if (res.ok) {
        setIsFindingModal(false);
        fetchAll();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateAdj = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/audit-advanced/adjustments/${engagementId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAdj)
      });
      if (res.ok) {
        setIsAdjModal(false);
        fetchAll();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleApproveAdj = async (id: string) => {
    try {
      const res = await fetch(`/api/audit-advanced/adjustments/${id}/approve`, { method: 'POST' });
      if (res.ok) {
        fetchAll();
        alert('Adjustment approved and posted successfully.');
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
            <AlertTriangle className="w-5 h-5 text-amber-600" /> Audit Findings & Adjustments
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Manage audit findings, risk ratings, recommendations, and proposed/posted financial adjustments.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('findings')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'findings' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
          >
            Audit Findings ({findings.length})
          </button>
          <button
            onClick={() => setActiveTab('adjustments')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'adjustments' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
          >
            Adjustments ({adjustments.length})
          </button>
        </div>
      </div>

      {activeTab === 'findings' ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-bold text-xs text-slate-400 uppercase">Registered Findings & Recommendations</h4>
            <button
              onClick={() => setIsFindingModal(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> New Finding
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {findings.map(f => (
              <div key={f.id} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    f.riskRating === 'CRITICAL' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                    f.riskRating === 'HIGH' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  }`}>
                    Risk: {f.riskRating}
                  </span>
                  <span className="text-xs font-bold text-slate-500">{f.status}</span>
                </div>
                <h5 className="font-bold text-sm text-slate-900 dark:text-slate-100">{f.title}</h5>
                <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                  <p><strong>Condition:</strong> {f.condition}</p>
                  <p><strong>Effect:</strong> {f.effect}</p>
                  <p><strong>Recommendation:</strong> {f.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-bold text-xs text-slate-400 uppercase">Audit Adjustments & Misstatements</h4>
            <button
              onClick={() => setIsAdjModal(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> Propose Adjustment
            </button>
          </div>

          <div className="space-y-3">
            {adjustments.map(adj => (
              <div key={adj.id} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">{adj.adjustmentType}</span>
                    <span className="text-xs font-bold text-slate-500">Classification: {adj.classification}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${adj.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {adj.approvalStatus}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-200 font-medium">{adj.financialEffect}</p>
                </div>

                {adj.approvalStatus !== 'APPROVED' && (
                  <button
                    onClick={() => handleApproveAdj(adj.id)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm whitespace-nowrap"
                  >
                    Approve & Post JE →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Finding Modal */}
      {isFindingModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <h4 className="font-bold text-xs">New Audit Finding</h4>
              <button onClick={() => setIsFindingModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateFinding} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Title</label>
                <input type="text" required value={newFinding.title} onChange={e => setNewFinding({...newFinding, title: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Risk Rating</label>
                <select value={newFinding.riskRating} onChange={e => setNewFinding({...newFinding, riskRating: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg">
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Condition</label>
                <textarea rows={2} value={newFinding.condition} onChange={e => setNewFinding({...newFinding, condition: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Effect</label>
                <textarea rows={2} value={newFinding.effect} onChange={e => setNewFinding({...newFinding, effect: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Recommendation</label>
                <textarea rows={2} value={newFinding.recommendation} onChange={e => setNewFinding({...newFinding, recommendation: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsFindingModal(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Save Finding</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Adjustment Modal */}
      {isAdjModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <h4 className="font-bold text-xs">Propose Audit Adjustment</h4>
              <button onClick={() => setIsAdjModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateAdj} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Financial Effect / Description</label>
                <textarea rows={2} required value={newAdj.financialEffect} onChange={e => setNewAdj({...newAdj, financialEffect: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Classification</label>
                <select value={newAdj.classification} onChange={e => setNewAdj({...newAdj, classification: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg">
                  <option value="FSD">FSD (Likely Misstatement)</option>
                  <option value="FSI">FSI (Known Misstatement)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsAdjModal(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Propose Adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
