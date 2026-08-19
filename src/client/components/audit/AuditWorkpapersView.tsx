import React, { useEffect, useState } from 'react';
import { 
  FileText, Plus, ShieldCheck, Lock, Unlock, History, CheckCircle2, 
  AlertCircle, RefreshCw, Layers, ExternalLink, X, Save 
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function AuditWorkpapersView({ engagementId }: { engagementId: string }) {
  const [workpapers, setWorkpapers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWp, setSelectedWp] = useState<any>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWp, setNewWp] = useState({
    wpRef: 'A-100',
    title: 'Cash & Cash Equivalents Verification',
    objective: 'Verify existence, completeness, and valuation of cash balances.',
    procedure: 'Obtain bank confirmations, review bank reconciliations, test cut-off.',
    population: 'All bank accounts (PHP 50,000,000)',
    sample: 'Top 3 operating accounts covering 95% of total cash.',
    result: 'All bank confirmations returned directly with no exceptions noted.',
    exception: 'None',
    conclusion: 'Cash balances are fairly stated in all material respects.'
  });

  const fetchWps = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/audit-advanced/workpapers/${engagementId}`);
      const data = await res.json();
      if (res.ok) {
        setWorkpapers(Array.isArray(data) ? data : []);
        if (data.length > 0 && !selectedWp) {
          setSelectedWp(data[0]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWps();
  }, [engagementId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/audit-advanced/workpapers/${engagementId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWp)
      });
      if (res.ok) {
        setIsCreateOpen(false);
        fetchWps();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWp) return;
    try {
      const res = await fetch(`/api/audit-advanced/workpapers/item/${selectedWp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedWp)
      });
      const data = await res.json();
      if (res.ok) {
        alert('Workpaper updated and version snapshot recorded.');
        fetchWps();
      } else {
        alert(data.error || 'Failed to update');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLock = async (id: string) => {
    try {
      const res = await fetch(`/api/audit-advanced/workpapers/item/${id}/lock`, { method: 'POST' });
      if (res.ok) {
        fetchWps();
        if (selectedWp?.id === id) setSelectedWp({ ...selectedWp, status: 'LOCKED' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReopen = async (id: string) => {
    const reason = prompt('Enter justification/approval reason to reopen locked workpaper:');
    if (!reason) return;
    try {
      const res = await fetch(`/api/audit-advanced/workpapers/item/${id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        fetchWps();
        alert('Workpaper reopened with new version.');
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
            <FileText className="w-5 h-5 text-emerald-600" /> Audit Working Papers
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Persistent, reviewable, and signable audit working papers with version history and locked audit trails.</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
        >
          <Plus className="w-4 h-4" /> Create Workpaper
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List of Workpapers */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3">
          <h4 className="font-bold text-xs text-slate-400 uppercase">Engagement Working Papers</h4>
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs">Loading workpapers...</div>
          ) : workpapers.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">No working papers created yet.</div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {workpapers.map(wp => {
                const isSelected = selectedWp?.id === wp.id;
                return (
                  <div
                    key={wp.id}
                    onClick={() => setSelectedWp(wp)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded">
                        {wp.wpRef}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        wp.status === 'LOCKED' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                        wp.status === 'REVIEWED' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                        'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      }`}>
                        {wp.status} (v{wp.versionNumber})
                      </span>
                    </div>
                    <h5 className="font-bold text-xs text-slate-800 dark:text-slate-100 mt-2">{wp.title}</h5>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Workpaper Detail / Editor */}
        {selectedWp ? (
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-6">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 rounded">
                    {selectedWp.wpRef}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">Version {selectedWp.versionNumber}</span>
                </div>
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 mt-1">{selectedWp.title}</h4>
              </div>

              <div className="flex items-center gap-2">
                {selectedWp.status !== 'LOCKED' ? (
                  <button
                    onClick={() => handleLock(selectedWp.id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200"
                  >
                    <Lock className="w-3.5 h-3.5 text-red-500" /> Lock Workpaper
                  </button>
                ) : (
                  <button
                    onClick={() => handleReopen(selectedWp.id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-bold"
                  >
                    <Unlock className="w-3.5 h-3.5" /> Reopen (Approval Required)
                  </button>
                )}
              </div>
            </div>

            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Workpaper Ref & Title</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={selectedWp.wpRef}
                      disabled={selectedWp.status === 'LOCKED'}
                      onChange={e => setSelectedWp({...selectedWp, wpRef: e.target.value})}
                      className="w-1/3 px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900 font-mono"
                    />
                    <input
                      type="text"
                      value={selectedWp.title}
                      disabled={selectedWp.status === 'LOCKED'}
                      onChange={e => setSelectedWp({...selectedWp, title: e.target.value})}
                      className="w-2/3 px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Status</label>
                  <select
                    value={selectedWp.status}
                    disabled={selectedWp.status === 'LOCKED'}
                    onChange={e => setSelectedWp({...selectedWp, status: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PREPARED">Prepared</option>
                    <option value="REVIEWED">Reviewed</option>
                    <option value="LOCKED">Locked</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Objective</label>
                  <textarea
                    rows={2}
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.objective || ''}
                    onChange={e => setSelectedWp({...selectedWp, objective: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Audit Procedure</label>
                  <textarea
                    rows={2}
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.procedure || ''}
                    onChange={e => setSelectedWp({...selectedWp, procedure: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Population</label>
                  <input
                    type="text"
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.population || ''}
                    onChange={e => setSelectedWp({...selectedWp, population: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Sample & Testing</label>
                  <input
                    type="text"
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.sample || ''}
                    onChange={e => setSelectedWp({...selectedWp, sample: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Result / Findings</label>
                  <textarea
                    rows={3}
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.result || ''}
                    onChange={e => setSelectedWp({...selectedWp, result: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Exceptions Noted</label>
                  <textarea
                    rows={3}
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.exception || ''}
                    onChange={e => setSelectedWp({...selectedWp, exception: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Conclusion</label>
                  <textarea
                    rows={3}
                    disabled={selectedWp.status === 'LOCKED'}
                    value={selectedWp.conclusion || ''}
                    onChange={e => setSelectedWp({...selectedWp, conclusion: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Reviewer Notes & Feedback</label>
                <textarea
                  rows={2}
                  placeholder="Reviewer notes or clearing comments..."
                  value={selectedWp.reviewNotes || ''}
                  onChange={e => setSelectedWp({...selectedWp, reviewerNotes: e.target.value})}
                  className="w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
                />
              </div>

              {selectedWp.status !== 'LOCKED' && (
                <div className="flex justify-end pt-4 border-t">
                  <button
                    type="submit"
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
                  >
                    <Save className="w-4 h-4" /> Save & Snapshot Version
                  </button>
                </div>
              )}
            </form>
          </div>
        ) : (
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center text-slate-400">
            Select a working paper to view details or edit.
          </div>
        )}
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs">Create New Audit Working Paper</h4>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-500"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">WP Ref</label>
                  <input
                    type="text"
                    required
                    value={newWp.wpRef}
                    onChange={e => setNewWp({...newWp, wpRef: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={newWp.title}
                    onChange={e => setNewWp({...newWp, title: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Objective</label>
                <textarea
                  rows={2}
                  value={newWp.objective}
                  onChange={e => setNewWp({...newWp, objective: e.target.value})}
                  className="w-full px-3 py-2 text-xs border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Procedure</label>
                <textarea
                  rows={2}
                  value={newWp.procedure}
                  onChange={e => setNewWp({...newWp, procedure: e.target.value})}
                  className="w-full px-3 py-2 text-xs border rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Create Workpaper</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
