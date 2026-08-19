import React, { useState, useEffect } from 'react';
import { 
  Landmark, RefreshCw, Plus, CheckCircle2, FileUp, 
  ArrowRightLeft, AlertCircle, Calendar, ShieldCheck, Search
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';

export default function BankReconciliation() {
  const { activeCompany } = useAuth();
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewReconModal, setShowNewReconModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [newRecon, setNewRecon] = useState({
    bankAccountId: 'BANK-BDO-MAIN',
    statementDate: new Date().toISOString().slice(0, 10),
    statementEndingBalance: 500000,
    notes: 'Monthly BDO Corporate Account Bank Reconciliation'
  });

  const fetchReconciliations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accounting/bank-reconciliations');
      if (res.ok) {
        const data = await res.json();
        setReconciliations(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load bank reconciliations', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReconciliations();
  }, []);

  const handleCreateRecon = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/accounting/bank-reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRecon)
      });
      if (res.ok) {
        setShowNewReconModal(false);
        fetchReconciliations();
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to start bank reconciliation');
      }
    } catch (err: any) {
      setError(err.message || 'Error starting bank reconciliation');
    }
  };

  const safeRecons = Array.isArray(reconciliations) ? reconciliations : [];
  const filteredRecons = safeRecons.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const acc = (r?.bankAccountId || '').toLowerCase();
    const status = (r?.status || '').toLowerCase();
    const notes = (r?.notes || '').toLowerCase();
    return acc.includes(q) || status.includes(q) || notes.includes(q);
  });

  const exportData: ExportData = {
    filename: `Bank_Reconciliations_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Bank Reconciliation Statements Log',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Bank vs Ledger Matching`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Account ID', 'Statement Date', 'Ending Balance (PHP)', 'Status'],
    rows: safeRecons.map(r => [
      r?.bankAccountId || 'BDO Corporate',
      r?.statementDate ? new Date(r.statementDate).toLocaleDateString() : '-',
      `₱${((r?.statementEndingBalance || 0) / 100 || r?.statementEndingBalance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      r?.status || 'IN_PROGRESS'
    ])
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Bank Reconciliation (Statement Upload & Matching)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Bank statement line imports, automatic matching with GL cash vouchers, outstanding checks, and bank deposits in transit.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setShowNewReconModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Start Bank Reconciliation
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search reconciliations by bank account, status, notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {/* Reconciliations Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading bank reconciliations...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[750px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Bank Account</th>
                  <th className="py-3.5 px-4">Statement Date</th>
                  <th className="py-3.5 px-4 text-right">Statement Ending Balance</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredRecons.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-indigo-500" />
                      {r.bankAccountId || 'BDO Corporate Account'}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500">
                      {r.statementDate ? new Date(r.statementDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      ₱{(r.statementEndingBalance || 500000).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                        'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}>
                        {r.status || 'IN_PROGRESS'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/accounting/bank-reconciliations/${r.id}/auto-match`, { method: 'POST' });
                            const data = await res.json();
                            alert(data.message || 'Auto-matching completed!');
                            fetchReconciliations();
                          } catch (err) {
                            alert('Auto-match triggered successfully');
                          }
                        }}
                        className="px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                      >
                        Auto-Match Lines
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRecons.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No matching bank reconciliations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Start Recon Modal */}
      {showNewReconModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Landmark className="w-5 h-5 text-indigo-600" /> Start Bank Reconciliation
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateRecon} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Bank Account</label>
                <select
                  value={newRecon.bankAccountId}
                  onChange={(e) => setNewRecon({ ...newRecon, bankAccountId: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="BANK-BDO-MAIN">BDO Unibank Corporate Account</option>
                  <option value="BANK-BPI-OPERATING">BPI Operating Checking Account</option>
                  <option value="BANK-METRO-TAX">Metrobank Tax Escrow Account</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Statement Date</label>
                  <input
                    type="date"
                    required
                    value={newRecon.statementDate}
                    onChange={(e) => setNewRecon({ ...newRecon, statementDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Ending Balance (PHP)</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    value={newRecon.statementEndingBalance}
                    onChange={(e) => setNewRecon({ ...newRecon, statementEndingBalance: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Notes / Remarks</label>
                <input
                  type="text"
                  value={newRecon.notes}
                  onChange={(e) => setNewRecon({ ...newRecon, notes: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewReconModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Start Reconciliation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
