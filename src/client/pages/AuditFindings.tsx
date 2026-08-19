import React, { useEffect, useState } from 'react';
import { ShieldCheck, FileText, Plus, CheckCircle2, AlertTriangle, RefreshCw, Layers, Lock, Sparkles } from 'lucide-react';
import AuditChatPanel from '../components/ai/AuditChatPanel';

export default function AuditFindings() {
  const [findings, setFindings] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'FINDINGS' | 'ADJUSTMENTS'>('FINDINGS');

  // Finding form state
  const [isFindingModalOpen, setIsFindingModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [condition, setCondition] = useState('');
  const [criteria, setCriteria] = useState('');
  const [cause, setCause] = useState('');
  const [effect, setEffect] = useState('');
  const [riskRating, setRiskRating] = useState('MEDIUM');
  const [recommendation, setRecommendation] = useState('');

  // Adjustment form state
  const [isAdjModalOpen, setIsAdjModalOpen] = useState(false);
  const [adjDescription, setAdjDescription] = useState('');
  const [adjAccountCode, setAdjAccountCode] = useState('1000');
  const [adjDebit, setAdjDebit] = useState('0');
  const [adjCredit, setAdjCredit] = useState('0');
  const [adjReason, setAdjReason] = useState('');
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [fRes, aRes] = await Promise.all([
        fetch('/api/audit/findings'),
        fetch('/api/audit/adjustments')
      ]);
      const fData = await fRes.json();
      const aData = await aRes.json();
      if (fRes.ok) setFindings(Array.isArray(fData) ? fData : []);
      if (aRes.ok) setAdjustments(Array.isArray(aData) ? aData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/audit/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, condition, criteria, cause, effect, riskRating, recommendation })
      });
      if (res.ok) {
        setIsFindingModalOpen(false);
        setTitle('');
        setCondition('');
        setCriteria('');
        setCause('');
        setEffect('');
        setRecommendation('');
        fetchData();
      } else {
        alert('Failed to create audit finding');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/audit/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: adjDescription,
          accountCode: adjAccountCode,
          debitAmount: Number(adjDebit),
          creditAmount: Number(adjCredit),
          workflowStatus: 'PROPOSED',
          reason: adjReason
        })
      });
      if (res.ok) {
        setIsAdjModalOpen(false);
        setAdjDescription('');
        setAdjReason('');
        setAdjDebit('0');
        setAdjCredit('0');
        fetchData();
      } else {
        alert('Failed to create audit adjustment');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateAdjWorkflow = async (id: string, workflowStatus: 'PROPOSED' | 'PASSED' | 'POSTED') => {
    try {
      const res = await fetch(`/api/audit/adjustments/${id}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowStatus })
      });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to update adjustment workflow status');
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" /> Audit Findings & Adjustments Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage structured audit findings (Condition, Criteria, Cause, Effect) and audit adjustment workflows (Proposed, Passed, Posted).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAiChatOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" /> Ask Ledger AI
          </button>
          {activeTab === 'FINDINGS' ? (
            <button
              onClick={() => setIsFindingModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Add Audit Finding
            </button>
          ) : (
            <button
              onClick={() => setIsAdjModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Propose Audit Adjustment
            </button>
          )}
        </div>
      </div>

      <AuditChatPanel isOpen={isAiChatOpen} onClose={() => setIsAiChatOpen(false)} />

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('FINDINGS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'FINDINGS'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
          }`}
        >
          Audit Findings ({findings.length})
        </button>
        <button
          onClick={() => setActiveTab('ADJUSTMENTS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'ADJUSTMENTS'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
          }`}
        >
          Audit Adjustments / AJE Workflow ({adjustments.length})
        </button>
      </div>

      {activeTab === 'FINDINGS' ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider">
            Registered Audit Findings & 4C Analysis
          </div>

          {loading ? (
            <div className="p-16 text-center text-slate-400 text-xs">Loading audit findings...</div>
          ) : findings.length === 0 ? (
            <div className="p-16 text-center text-slate-400 text-xs space-y-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">No audit findings recorded.</p>
              <p>Click "Add Audit Finding" to document control deficiencies or misstatements.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {findings.map(f => (
                <div key={f.id} className="p-6 space-y-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" /> {f.title}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md ${
                        f.riskRating === 'CRITICAL' ? 'bg-red-500 text-white' :
                        f.riskRating === 'HIGH' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300' :
                        'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                      }`}>
                        Risk: {f.riskRating}
                      </span>
                      <span className="text-[10px] font-bold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md">
                        {f.status}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <strong className="text-slate-500 block mb-1">Condition (What is):</strong>
                      <p className="text-slate-700 dark:text-slate-300">{f.condition}</p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <strong className="text-slate-500 block mb-1">Criteria (Standard/Policy):</strong>
                      <p className="text-slate-700 dark:text-slate-300">{f.criteria}</p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <strong className="text-slate-500 block mb-1">Cause (Root Cause):</strong>
                      <p className="text-slate-700 dark:text-slate-300">{f.cause}</p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <strong className="text-slate-500 block mb-1">Effect (Impact):</strong>
                      <p className="text-slate-700 dark:text-slate-300">{f.effect}</p>
                    </div>
                  </div>

                  {f.recommendation && (
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl">
                      <strong>Auditor Recommendation:</strong> {f.recommendation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider">
            Audit Adjustments / AJE Workflow (Proposed, Passed, Posted)
          </div>

          {loading ? (
            <div className="p-16 text-center text-slate-400 text-xs">Loading audit adjustments...</div>
          ) : adjustments.length === 0 ? (
            <div className="p-16 text-center text-slate-400 text-xs space-y-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">No audit adjustments recorded.</p>
              <p>Click "Propose Audit Adjustment" to create trial balance or journal corrections.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {adjustments.map(adj => (
                <div key={adj.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                  <div className="space-y-1.5 max-w-2xl">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 rounded-md">
                        Account {adj.accountCode}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        adj.workflowStatus === 'POSTED' ? 'bg-emerald-500 text-white' :
                        adj.workflowStatus === 'PASSED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' :
                        'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                      }`}>
                        {adj.workflowStatus}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {adj.description}
                    </p>

                    <div className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-center gap-4">
                      <span>Debit: ₱{(Number(adj.debitAmount) / 100).toLocaleString()}</span>
                      <span>Credit: ₱{(Number(adj.creditAmount) / 100).toLocaleString()}</span>
                    </div>

                    {adj.reason && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Reason: {adj.reason}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={adj.workflowStatus}
                      onChange={e => handleUpdateAdjWorkflow(adj.id, e.target.value as any)}
                      className="px-3 py-1.5 text-xs font-bold border rounded-xl bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="PROPOSED">Proposed</option>
                      <option value="PASSED">Passed</option>
                      <option value="POSTED">Posted</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Finding Modal */}
      {isFindingModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-xl border w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h4 className="font-bold text-xs flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Document Audit Finding (4C Analysis)
              </h4>
              <button onClick={() => setIsFindingModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateFinding} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Finding Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Unreconciled Bank Deposits or Missing Supporting Invoices"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Risk Rating</label>
                  <select
                    value={riskRating}
                    onChange={e => setRiskRating(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Condition (What exists)</label>
                  <textarea
                    rows={2}
                    required
                    value={condition}
                    onChange={e => setCondition(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  ></textarea>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Criteria (What should exist / Policy)</label>
                  <textarea
                    rows={2}
                    required
                    value={criteria}
                    onChange={e => setCriteria(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  ></textarea>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Cause (Why it happened)</label>
                  <textarea
                    rows={2}
                    required
                    value={cause}
                    onChange={e => setCause(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  ></textarea>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Effect (Impact / Risk)</label>
                  <textarea
                    rows={2}
                    required
                    value={effect}
                    onChange={e => setEffect(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  ></textarea>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Recommendation</label>
                  <textarea
                    rows={2}
                    value={recommendation}
                    onChange={e => setRecommendation(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  ></textarea>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsFindingModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">Save Finding</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {isAdjModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-xl border w-full max-w-md overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h4 className="font-bold text-xs flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-600" /> Propose Audit Adjustment (AJE)
              </h4>
              <button onClick={() => setIsAdjModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateAdjustment} className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Accrued utilities adjustment"
                  value={adjDescription}
                  onChange={e => setAdjDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Account Code</label>
                <input
                  type="text"
                  required
                  value={adjAccountCode}
                  onChange={e => setAdjAccountCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Debit (PHP Centavos)</label>
                  <input
                    type="number"
                    value={adjDebit}
                    onChange={e => setAdjDebit(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Credit (PHP Centavos)</label>
                  <input
                    type="number"
                    value={adjCredit}
                    onChange={e => setAdjCredit(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Reason / Notes</label>
                <textarea
                  rows={2}
                  value={adjReason}
                  onChange={e => setAdjReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                ></textarea>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsAdjModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">Propose Adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
