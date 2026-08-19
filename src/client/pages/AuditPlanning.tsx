import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, FileText, CheckCircle2, AlertTriangle, Plus, Trash2, 
  Save, ArrowLeft, Layers, Check, Clock, UserCheck, History, RefreshCw 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const ASSERTIONS = [
  { id: 'EXISTENCE', label: 'Existence / Occurrence' },
  { id: 'COMPLETENESS', label: 'Completeness' },
  { id: 'VALUATION', label: 'Valuation / Allocation' },
  { id: 'RIGHTS_OBLIGATIONS', label: 'Rights & Obligations' },
  { id: 'PRESENTATION', label: 'Presentation & Disclosure' }
];

export default function AuditPlanning({ engagementId, onBack }: { engagementId: string; onBack: () => void }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'strategy' | 'accounts' | 'risks' | 'versions'>('strategy');

  // Form states for strategy doc
  const [docForm, setDocForm] = useState({
    entityUnderstanding: '',
    businessProcesses: '',
    auditStrategy: '',
    auditPlan: '',
    samplingPlan: '',
    materialityNotes: ''
  });
  const [savingDoc, setSavingDoc] = useState(false);

  // New account form
  const [newAccount, setNewAccount] = useState({
    accountName: '',
    accountBalance: '',
    isSignificant: true,
    assertions: [] as string[],
    inherentRisk: 'MEDIUM',
    controlRisk: 'MEDIUM',
    fraudRisk: false
  });
  const [isAddingAcc, setIsAddingAcc] = useState(false);

  // New risk & procedure form
  const [newRisk, setNewRisk] = useState({
    riskDescription: '',
    riskType: 'INHERENT',
    assertionLinked: 'EXISTENCE',
    auditProcedure: ''
  });
  const [isAddingRisk, setIsAddingRisk] = useState(false);

  const fetchPlanningData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/audit-planning/${engagementId}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
        if (json.planningDoc) {
          setDocForm({
            entityUnderstanding: json.planningDoc.entityUnderstanding || '',
            businessProcesses: json.planningDoc.businessProcesses || '',
            auditStrategy: json.planningDoc.auditStrategy || '',
            auditPlan: json.planningDoc.auditPlan || '',
            samplingPlan: json.planningDoc.samplingPlan || '',
            materialityNotes: json.planningDoc.materialityNotes || ''
          });
        }
      }
    } catch (err) {
      console.error('Failed to load audit planning:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlanningData();
  }, [engagementId]);

  const handleSaveDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingDoc(true);
      const res = await fetch(`/api/audit-planning/${engagementId}/doc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docForm)
      });
      if (res.ok) {
        fetchPlanningData();
        alert('Audit planning document saved successfully.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingDoc(false);
    }
  };

  const handleSignOff = async (roleType: 'preparer' | 'reviewer' | 'partner') => {
    if (!confirm(`Are you sure you want to sign off as ${roleType.toUpperCase()}?`)) return;
    try {
      const res = await fetch(`/api/audit-planning/${engagementId}/sign-off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleType })
      });
      if (res.ok) {
        fetchPlanningData();
        alert(`Successfully signed off as ${roleType}! Version snapshot recorded.`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAccount.assertions.length === 0) {
      alert('Please select at least one relevant assertion for this significant account.');
      return;
    }
    try {
      const res = await fetch(`/api/audit-planning/${engagementId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount)
      });
      if (res.ok) {
        setNewAccount({
          accountName: '',
          accountBalance: '',
          isSignificant: true,
          assertions: [],
          inherentRisk: 'MEDIUM',
          controlRisk: 'MEDIUM',
          fraudRisk: false
        });
        setIsAddingAcc(false);
        fetchPlanningData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    try {
      await fetch(`/api/audit-planning/accounts/${id}`, { method: 'DELETE' });
      fetchPlanningData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRisk.riskDescription || !newRisk.auditProcedure) {
      alert('Risk description and audit procedure mapping are required.');
      return;
    }
    try {
      const res = await fetch(`/api/audit-planning/${engagementId}/risks-procedures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRisk)
      });
      if (res.ok) {
        setNewRisk({ riskDescription: '', riskType: 'INHERENT', assertionLinked: 'EXISTENCE', auditProcedure: '' });
        setIsAddingRisk(false);
        fetchPlanningData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteRisk = async (id: string) => {
    try {
      await fetch(`/api/audit-planning/risks-procedures/${id}`, { method: 'DELETE' });
      fetchPlanningData();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" /> Loading Audit Planning & Risk Assessment...
      </div>
    );
  }

  const planningDoc = data?.planningDoc || {};
  const significantAccounts = data?.significantAccounts || [];
  const risksAndProcedures = data?.risksAndProcedures || [];
  const versions = data?.versions || [];

  return (
    <div className="space-y-6">
      {/* Top Bar with Back button and Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-emerald-600" /> Audit Planning & Risk Assessment
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">Entity understanding, significant accounts, assertions, risk assessment, and audit program mapping.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
            planningDoc.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
            planningDoc.status === 'REVIEWED' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
            planningDoc.status === 'PREPARED' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
            'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
          }`}>
            Status: {planningDoc.status}
          </span>

          <div className="flex items-center gap-1.5 border-l pl-3 border-slate-200 dark:border-slate-700">
            <button
              onClick={() => handleSignOff('preparer')}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5 text-emerald-600" /> Sign Prep
            </button>
            <button
              onClick={() => handleSignOff('reviewer')}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5 text-blue-600" /> Review
            </button>
            <button
              onClick={() => handleSignOff('partner')}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Partner Approve
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
        <button
          onClick={() => setActiveTab('strategy')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'strategy' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 hover:bg-slate-100 dark:text-slate-300'}`}
        >
          1. Strategy, Plan & Entity Understanding
        </button>
        <button
          onClick={() => setActiveTab('accounts')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'accounts' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 hover:bg-slate-100 dark:text-slate-300'}`}
        >
          2. Significant Accounts & Assertions ({significantAccounts.length})
        </button>
        <button
          onClick={() => setActiveTab('risks')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'risks' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 hover:bg-slate-100 dark:text-slate-300'}`}
        >
          3. Risk & Procedure Mapping ({risksAndProcedures.length})
        </button>
        <button
          onClick={() => setActiveTab('versions')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'versions' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 hover:bg-slate-100 dark:text-slate-300'}`}
        >
          4. Version History ({versions.length})
        </button>
      </div>

      {/* Tab 1: Strategy, Plan & Entity Understanding */}
      {activeTab === 'strategy' && (
        <form onSubmit={handleSaveDoc} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Understanding of Entity & Environment
              </label>
              <textarea
                rows={5}
                value={docForm.entityUnderstanding}
                onChange={e => setDocForm({...docForm, entityUnderstanding: e.target.value})}
                placeholder="Industry, regulatory environment, business model, governance..."
                className="w-full p-3 text-xs border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Business-Process Documentation
              </label>
              <textarea
                rows={5}
                value={docForm.businessProcesses}
                onChange={e => setDocForm({...docForm, businessProcesses: e.target.value})}
                placeholder="Revenue, expenditure, payroll, and financial closing cycles..."
                className="w-full p-3 text-xs border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Overall Audit Strategy
              </label>
              <textarea
                rows={5}
                value={docForm.auditStrategy}
                onChange={e => setDocForm({...docForm, auditStrategy: e.target.value})}
                placeholder="Scope, timing, direction, and resource allocation..."
                className="w-full p-3 text-xs border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Detailed Audit Plan & Program
              </label>
              <textarea
                rows={5}
                value={docForm.auditPlan}
                onChange={e => setDocForm({...docForm, auditPlan: e.target.value})}
                placeholder="Nature, timing, and extent of substantive and test of controls procedures..."
                className="w-full p-3 text-xs border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Sampling Plan Methodology
              </label>
              <textarea
                rows={4}
                value={docForm.samplingPlan}
                onChange={e => setDocForm({...docForm, samplingPlan: e.target.value})}
                placeholder="Population size, tolerable misstatement, expected misstatement..."
                className="w-full p-3 text-xs border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Materiality & Threshold Notes
              </label>
              <textarea
                rows={4}
                value={docForm.materialityNotes}
                onChange={e => setDocForm({...docForm, materialityNotes: e.target.value})}
                placeholder="Rationale for overall, performance, and trivial thresholds..."
                className="w-full p-3 text-xs border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="submit"
              disabled={savingDoc}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
            >
              <Save className="w-4 h-4" /> {savingDoc ? 'Saving...' : 'Save Strategy & Plan'}
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Significant Accounts & Assertions */}
      {activeTab === 'accounts' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Significant Accounts & Relevant Assertions</h3>
              <p className="text-xs text-slate-500">Every significant account must link to relevant assertions (Existence, Completeness, Valuation, Rights & Obligations, Presentation).</p>
            </div>
            <button
              onClick={() => setIsAddingAcc(!isAddingAcc)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Significant Account
            </button>
          </div>

          {isAddingAcc && (
            <form onSubmit={handleAddAccount} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
              <h4 className="font-bold text-xs text-slate-700 dark:text-slate-300 uppercase">New Significant Account</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Accounts Receivable"
                    value={newAccount.accountName}
                    onChange={e => setNewAccount({...newAccount, accountName: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Balance (Centavos)</label>
                  <input
                    type="number"
                    value={newAccount.accountBalance}
                    onChange={e => setNewAccount({...newAccount, accountBalance: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 font-mono"
                  />
                </div>
                <div className="flex items-center gap-4 pt-6">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAccount.fraudRisk}
                      onChange={e => setNewAccount({...newAccount, fraudRisk: e.target.checked})}
                      className="rounded text-emerald-600"
                    />
                    Fraud Risk Identified
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Inherent & Control Risk</label>
                  <div className="flex gap-2">
                    <select
                      value={newAccount.inherentRisk}
                      onChange={e => setNewAccount({...newAccount, inherentRisk: e.target.value})}
                      className="w-1/2 px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                    >
                      <option value="LOW">Inherent: Low</option>
                      <option value="MEDIUM">Inherent: Medium</option>
                      <option value="HIGH">Inherent: High</option>
                    </select>
                    <select
                      value={newAccount.controlRisk}
                      onChange={e => setNewAccount({...newAccount, controlRisk: e.target.value})}
                      className="w-1/2 px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                    >
                      <option value="LOW">Control: Low</option>
                      <option value="MEDIUM">Control: Medium</option>
                      <option value="HIGH">Control: High</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Relevant Assertions (Select at least one)</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ASSERTIONS.map(a => {
                      const checked = newAccount.assertions.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            const updated = checked 
                              ? newAccount.assertions.filter(x => x !== a.id)
                              : [...newAccount.assertions, a.id];
                            setNewAccount({...newAccount, assertions: updated});
                          }}
                          className={`px-2.5 py-1 rounded text-[11px] font-bold border transition-all ${checked ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsAddingAcc(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-1.5 text-xs bg-emerald-600 text-white font-bold rounded-lg shadow-sm">Save Significant Account</button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[800px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b">
                <tr>
                  <th className="py-3 px-3">Account Name</th>
                  <th className="py-3 px-3 text-right">Balance</th>
                  <th className="py-3 px-3">Inherent / Control Risk</th>
                  <th className="py-3 px-3">Relevant Assertions</th>
                  <th className="py-3 px-3 text-center">Fraud Risk</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {significantAccounts.map((acc: any) => {
                  let assertionsParsed = [];
                  try { assertionsParsed = JSON.parse(acc.assertions || '[]'); } catch { assertionsParsed = []; }
                  return (
                    <tr key={acc.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-3 font-bold text-slate-800 dark:text-slate-100">{acc.accountName}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatCurrency(acc.accountBalance)}</td>
                      <td className="py-3 px-3 font-mono text-xs">
                        <span className="text-slate-500">I:</span> <strong className="text-slate-700 dark:text-slate-300">{acc.inherentRisk}</strong> | 
                        <span className="text-slate-500 ml-1">C:</span> <strong className="text-slate-700 dark:text-slate-300">{acc.controlRisk}</strong>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          {assertionsParsed.map((as: string) => (
                            <span key={as} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              {as}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {acc.fraudRisk ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">YES</span>
                        ) : (
                          <span className="text-slate-400 text-xs">No</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleDeleteAccount(acc.id)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"
                          title="Delete Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {significantAccounts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">No significant accounts defined yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Risk & Procedure Mapping */}
      {activeTab === 'risks' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Risk-to-Procedure Mapping</h3>
              <p className="text-xs text-slate-500">Every material risk (Inherent, Control, Fraud, Significant) must link directly to specific audit procedures.</p>
            </div>
            <button
              onClick={() => setIsAddingRisk(!isAddingRisk)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Risk & Procedure
            </button>
          </div>

          {isAddingRisk && (
            <form onSubmit={handleAddRisk} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
              <h4 className="font-bold text-xs text-slate-700 dark:text-slate-300 uppercase">New Risk Assessment & Procedure Mapping</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Risk Type</label>
                  <select
                    value={newRisk.riskType}
                    onChange={e => setNewRisk({...newRisk, riskType: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                  >
                    <option value="INHERENT">Inherent Risk</option>
                    <option value="CONTROL">Control Risk</option>
                    <option value="FRAUD">Fraud Risk (ISA 240)</option>
                    <option value="SIGNIFICANT">Significant Risk</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Relevant Assertion</label>
                  <select
                    value={newRisk.assertionLinked}
                    onChange={e => setNewRisk({...newRisk, assertionLinked: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                  >
                    {ASSERTIONS.map(a => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-1 flex items-end">
                  <span className="text-[11px] text-slate-400">Linked to audit program</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Risk Description</label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Describe the risk of material misstatement..."
                    value={newRisk.riskDescription}
                    onChange={e => setNewRisk({...newRisk, riskDescription: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Audit Procedure (Response)</label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Detail the specific substantive test or test of controls responding to this risk..."
                    value={newRisk.auditProcedure}
                    onChange={e => setNewRisk({...newRisk, auditProcedure: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsAddingRisk(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-1.5 text-xs bg-emerald-600 text-white font-bold rounded-lg shadow-sm">Save Risk Mapping</button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {risksAndProcedures.map((rp: any) => (
              <div key={rp.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                      rp.riskType === 'FRAUD' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                      rp.riskType === 'SIGNIFICANT' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    }`}>
                      {rp.riskType}
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-500">Assertion: {rp.assertionLinked}</span>
                  </div>
                  <button onClick={() => handleDeleteRisk(rp.id)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Delete Risk Mapping">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Identified Risk</span>
                    <p className="text-slate-800 dark:text-slate-100 font-medium">{rp.riskDescription}</p>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-bold text-emerald-600 uppercase block mb-1">Audit Procedure Response</span>
                    <p className="text-slate-800 dark:text-slate-100 font-medium">{rp.auditProcedure}</p>
                  </div>
                </div>
              </div>
            ))}
            {risksAndProcedures.length === 0 && (
              <div className="p-12 text-center text-slate-400 text-xs">No risk-to-procedure mappings recorded yet.</div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Version History */}
      {activeTab === 'versions' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Planning Version History</h3>
          <p className="text-xs text-slate-500">Immutable version snapshots created whenever a sign-off or approval occurs.</p>

          <div className="space-y-3">
            {versions.map((v: any) => (
              <div key={v.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-slate-800 dark:text-slate-100 font-mono text-sm">Version {v.versionNumber}</strong>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 uppercase">
                      Snapshot Saved
                    </span>
                  </div>
                  <p className="text-slate-500 mt-1 font-mono">Created at: {new Date(v.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 font-mono text-[11px]">Snapshot ID: {v.id.slice(0, 8)}...</span>
                </div>
              </div>
            ))}
            {versions.length === 0 && (
              <div className="p-12 text-center text-slate-400 text-xs">No version snapshots created yet. Sign off on the planning document to generate the first version.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
