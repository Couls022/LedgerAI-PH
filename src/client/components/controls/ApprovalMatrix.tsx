import React, { useState } from 'react';
import { ShieldCheck, UserCheck, Lock, CheckCircle2, AlertTriangle, Plus, Settings } from 'lucide-react';

export default function ApprovalMatrix() {
  const [rules, setRules] = useState<any[]>([
    { id: '1', actionType: 'Journal Entry Posting', thresholdPHP: 500000, makerRole: 'Accountant', checkerRole: 'Senior Accountant / Owner', status: 'ENFORCED' },
    { id: '2', actionType: 'Vendor Disbursement / Check Run', thresholdPHP: 100000, makerRole: 'Accounts Payable Clerk', checkerRole: 'Company Owner', status: 'ENFORCED' },
    { id: '3', actionType: 'Period Close / Year-End Adjustment', thresholdPHP: 0, makerRole: 'Senior Accountant', checkerRole: 'Company Owner', status: 'ENFORCED' },
    { id: '4', actionType: 'Tax Return Final Filing (BIR 1702/2550Q)', thresholdPHP: 0, makerRole: 'Tax Accountant', checkerRole: 'Company Owner', status: 'ENFORCED' },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAction, setNewAction] = useState('');
  const [newThreshold, setNewThreshold] = useState('100000');
  const [newMaker, setNewMaker] = useState('Accountant');
  const [newChecker, setNewChecker] = useState('Company Owner');

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAction) return;
    const rule = {
      id: Date.now().toString(),
      actionType: newAction,
      thresholdPHP: Number(newThreshold) || 0,
      makerRole: newMaker,
      checkerRole: newChecker,
      status: 'ENFORCED'
    };
    setRules([...rules, rule]);
    setIsModalOpen(false);
    setNewAction('');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-emerald-600" /> Maker-Checker & Segregation of Duties Matrix
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Enforce strict internal controls ensuring sensitive accounting actions, threshold disbursements, and period closes require independent checker authorization.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> Add Approval Rule
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{rules.length}</div>
            <div className="text-xs text-slate-500">Active Control Rules</div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-950/40 text-blue-600 rounded-xl">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">100%</div>
            <div className="text-xs text-slate-500">Maker-Checker Segregation</div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-4 bg-purple-50 dark:bg-purple-950/40 text-purple-600 rounded-xl">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">Enforced</div>
            <div className="text-xs text-slate-500">Automated Server Policy</div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider">
          Segregation of Duties Authorization Rules
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[650px]">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="p-4">Action / Transaction Type</th>
                <th className="p-4">Threshold (PHP)</th>
                <th className="p-4">Maker Role (Initiator)</th>
                <th className="p-4">Checker Role (Approver)</th>
                <th className="p-4">Policy Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                  <td className="p-4 font-bold text-slate-900 dark:text-slate-100">{r.actionType}</td>
                  <td className="p-4 font-mono font-semibold text-emerald-600">
                    {r.thresholdPHP === 0 ? 'All Amounts' : `₱${r.thresholdPHP.toLocaleString()}`}
                  </td>
                  <td className="p-4 font-mono text-slate-600 dark:text-slate-300">{r.makerRole}</td>
                  <td className="p-4 font-mono font-bold text-indigo-600">{r.checkerRole}</td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 rounded-lg text-[10px] font-bold">
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-xl border w-full max-w-md overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h4 className="font-bold text-xs flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-600" /> Add Approval Matrix Rule
              </h4>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleAddRule} className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Action Type</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Asset Write-off or Large Expense"
                  value={newAction}
                  onChange={e => setNewAction(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Threshold Amount (PHP)</label>
                <input
                  type="number"
                  value={newThreshold}
                  onChange={e => setNewThreshold(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Required Maker Role</label>
                <select
                  value={newMaker}
                  onChange={e => setNewMaker(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Accountant">Accountant</option>
                  <option value="Accounts Payable Clerk">Accounts Payable Clerk</option>
                  <option value="Senior Accountant">Senior Accountant</option>
                  <option value="Tax Accountant">Tax Accountant</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Required Checker Role</label>
                <select
                  value={newChecker}
                  onChange={e => setNewChecker(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Company Owner">Company Owner</option>
                  <option value="Senior Accountant / Owner">Senior Accountant / Owner</option>
                  <option value="Internal Auditor">Internal Auditor</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">Save Rule</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
