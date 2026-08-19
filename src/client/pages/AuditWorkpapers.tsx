import React, { useEffect, useState } from 'react';
import { 
  FileCheck, FileText, Plus, CheckCircle2, Clock, ShieldCheck, 
  Paperclip, ExternalLink, UserCheck, AlertCircle, Bookmark, Check, X, Tag, Sparkles
} from 'lucide-react';
import AuditChatPanel from '../components/ai/AuditChatPanel';

const STANDARD_TICK_MARKS = [
  { symbol: '✓', label: 'Verified to General Ledger' },
  { symbol: '⊗', label: 'Footed & Cross-Footed' },
  { symbol: '‡', label: 'Agreed to External Confirmation' },
  { symbol: '£', label: 'Recalculated & Tested' },
  { symbol: '⌂', label: 'Inspected Physical Asset / Document' },
  { symbol: '💡', label: 'Pending Management Inquiry' }
];

export default function AuditWorkpapers() {
  const [workpapers, setWorkpapers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkpaper, setSelectedWorkpaper] = useState<any | null>(null);

  // Modal for new workpaper
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [referenceCode, setReferenceCode] = useState('A-1');
  const [category, setCategory] = useState('Lead Schedule');
  const [preparedBy, setPreparedBy] = useState('Junior Auditor');
  const [notes, setNotes] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');

  // Active workpaper detail editing
  const [activeTab, setActiveTab] = useState<'DETAILS' | 'EVIDENCE' | 'TICKMARKS'>('DETAILS');
  const [newTickSymbol, setNewTickSymbol] = useState('✓');
  const [newTickNote, setNewTickNote] = useState('');
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);

  const fetchWorkpapers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/audit/workpapers');
      const data = await res.json();
      if (res.ok) {
        const list = Array.isArray(data) ? data : [];
        setWorkpapers(list);
        if (list.length > 0 && !selectedWorkpaper) {
          setSelectedWorkpaper(list[0]);
        } else if (selectedWorkpaper) {
          const updated = list.find((w: any) => w.id === selectedWorkpaper.id);
          if (updated) setSelectedWorkpaper(updated);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkpapers();
  }, []);

  const handleCreateWorkpaper = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/audit/workpapers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, referenceCode, category, preparedBy, notes, evidenceUrl })
      });
      const data = await res.json();
      if (res.ok) {
        setIsModalOpen(false);
        setTitle('');
        setReferenceCode('A-1');
        setNotes('');
        setEvidenceUrl('');
        fetchWorkpapers();
      } else {
        alert(data.error || 'Failed to create workpaper');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateSignOff = async (status: string, reviewerName?: string, approverName?: string) => {
    if (!selectedWorkpaper) return;
    try {
      const body: any = { signOffStatus: status };
      if (status === 'REVIEWED' && reviewerName) body.reviewedBy = reviewerName;
      if (status === 'APPROVED' && approverName) body.approvedBy = approverName;

      const res = await fetch(`/api/audit/workpapers/${selectedWorkpaper.id}/signoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        fetchWorkpapers();
      } else {
        alert('Failed to update sign-off status');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getEvidenceList = (wp: any) => {
    try {
      const parsed = JSON.parse(wp.evidenceLinks || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return wp.evidenceLinks ? [wp.evidenceLinks] : [];
    }
  };

  const parseTickMarks = (wp: any) => {
    try {
      // We can store tick marks inside reviewNotes or separate
      return [];
    } catch {
      return [];
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileCheck className="w-6 h-6 text-indigo-600" /> Audit Working Papers & Lifecycle
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage audit schedules, attach supporting evidence, link transactions, apply standard tick marks, and control 3-tier sign-off (Prepared, Reviewed, Approved).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAiChatOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" /> Ask Ledger AI
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Create Working Paper
          </button>
        </div>
      </div>

      <AuditChatPanel isOpen={isAiChatOpen} onClose={() => setIsAiChatOpen(false)} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Workpapers List */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[680px]">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider flex justify-between items-center">
            <span>Workpapers Index ({workpapers.length})</span>
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <div className="p-12 text-center text-slate-400 text-xs">Loading working papers...</div>
            ) : workpapers.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs space-y-2">
                <p className="font-semibold text-slate-600 dark:text-slate-300">No working papers found.</p>
                <p>Create your first schedule or lead sheet above.</p>
              </div>
            ) : (
              workpapers.map(wp => {
                const isSelected = selectedWorkpaper?.id === wp.id;
                return (
                  <div
                    key={wp.id}
                    onClick={() => setSelectedWorkpaper(wp)}
                    className={`p-4 cursor-pointer transition-all space-y-1.5 ${
                      isSelected ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-l-4 border-indigo-600' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-extrabold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 rounded">
                        {wp.wpRef || 'A-1'}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        wp.status === 'APPROVED' || wp.status === 'LOCKED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
                        wp.status === 'REVIEWED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300' :
                        wp.status === 'PREPARED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' :
                        'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}>
                        {wp.status || 'DRAFT'}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">{wp.title}</h4>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>{wp.objective || 'Lead Schedule'}</span>
                      <span>{wp.reviewNotes || 'Junior Auditor'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Detailed Workpaper Workspace */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[680px]">
          {selectedWorkpaper ? (
            <>
              {/* Header */}
              <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-extrabold px-2.5 py-1 bg-indigo-600 text-white rounded-md">
                      Ref: {selectedWorkpaper.wpRef}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Category: {selectedWorkpaper.objective}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {selectedWorkpaper.title}
                  </h2>
                </div>

                {/* Sign-off Actions */}
                <div className="flex items-center gap-2">
                  {selectedWorkpaper.status === 'DRAFT' && (
                    <button
                      onClick={() => handleUpdateSignOff('PREPARED')}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                    >
                      Sign Off (Prepared)
                    </button>
                  )}
                  {selectedWorkpaper.status === 'PREPARED' && (
                    <button
                      onClick={() => handleUpdateSignOff('REVIEWED', 'Senior Audit Manager', undefined)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                    >
                      Sign Off (Reviewed)
                    </button>
                  )}
                  {selectedWorkpaper.status === 'REVIEWED' && (
                    <button
                      onClick={() => handleUpdateSignOff('APPROVED', undefined, 'Engagement Partner')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                    >
                      Sign Off (Approved)
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10">
                <button
                  onClick={() => setActiveTab('DETAILS')}
                  className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all border-b-2 ${
                    activeTab === 'DETAILS'
                      ? 'border-indigo-600 text-indigo-600 bg-white dark:bg-slate-900 dark:text-indigo-400'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Workpaper Notes & Procedures
                </button>
                <button
                  onClick={() => setActiveTab('EVIDENCE')}
                  className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all border-b-2 flex items-center gap-1.5 ${
                    activeTab === 'EVIDENCE'
                      ? 'border-indigo-600 text-indigo-600 bg-white dark:bg-slate-900 dark:text-indigo-400'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Paperclip className="w-3.5 h-3.5" /> Attached Evidence ({getEvidenceList(selectedWorkpaper).length})
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                {activeTab === 'DETAILS' && (
                  <div className="space-y-6">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-[10px] text-slate-400 font-bold uppercase block">Sign-off & Review Trail</span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                        {selectedWorkpaper.reviewNotes || 'Prepared by Junior Auditor'}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">Audit Procedures & Scope Notes</h3>
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line border border-slate-200 dark:border-slate-800 min-h-[160px]">
                        {selectedWorkpaper.procedure || 'No procedures outlined for this workpaper.'}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'EVIDENCE' && (
                  <div className="space-y-6">
                    <div className="p-6 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Paperclip className="w-4 h-4 text-indigo-600" /> Supporting Evidence & Source Link
                      </h3>
                      <p className="text-xs text-slate-500">
                        Attach PDFs, bank confirmations, invoices, or document repository links as audit evidence.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          placeholder="https://storage.client-portal.com/evidence/bank-conf-2026.pdf"
                          defaultValue={getEvidenceList(selectedWorkpaper)[0] || ''}
                          onBlur={async (e) => {
                            const val = e.target.value;
                            await fetch(`/api/audit/workpapers/${selectedWorkpaper.id}/signoff`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ evidenceUrl: val })
                            });
                            fetchWorkpapers();
                          }}
                          className="flex-1 px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-900 font-mono"
                        />
                      </div>
                      {getEvidenceList(selectedWorkpaper).length > 0 && (
                        <div className="space-y-2 pt-2">
                          {getEvidenceList(selectedWorkpaper).map((link: string, i: number) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-all mr-2"
                            >
                              <ExternalLink className="w-4 h-4" /> {link}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-center text-slate-400 text-xs">
              Select a working paper from the index to view and edit its lifecycle details.
            </div>
          )}
        </div>
      </div>

      {/* New Workpaper Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-xl border w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h4 className="font-bold text-xs flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-indigo-600" /> Create Audit Working Paper
              </h4>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateWorkpaper} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Index / Ref Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. A-1, B-2, C-3"
                    value={referenceCode}
                    onChange={e => setReferenceCode(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="Lead Schedule">Lead Schedule</option>
                    <option value="Substantive Testing">Substantive Testing</option>
                    <option value="Internal Control">Internal Control Evaluation</option>
                    <option value="Analytical Review">Analytical Review</option>
                    <option value="General Audit Memo">General Audit Memo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Workpaper Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cash and Cash Equivalents Lead Schedule"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Prepared By</label>
                <input
                  type="text"
                  required
                  value={preparedBy}
                  onChange={e => setPreparedBy(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Audit Notes & Initial Scope</label>
                <textarea
                  rows={3}
                  placeholder="Outline audit objectives, testing scope, and expected procedures..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-50 dark:bg-slate-800"
                ></textarea>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">Create Workpaper</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
