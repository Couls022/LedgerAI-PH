import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, RefreshCw, Search, Eye, X, Clock, ArrowRight,
  CheckCircle2, AlertTriangle, Lock, Download, Layers, FileText,
  Building2, Users, FileSpreadsheet
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuditItem {
  id: string;
  companyId: string;
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  role?: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  recordReference?: string;
  beforeData?: string | null;
  afterData?: string | null;
  changedFields?: string | null;
  changedFieldsList?: string[];
  reason?: string;
  result: 'SUCCESS' | 'FAILED' | 'WARNING';
  module: string;
  ipAddress?: string;
  timestamp: string | Date;
  integrityHash?: string;
}

export default function CompanyAuditPanel() {
  const { activeCompany } = useAuth();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<AuditItem | null>(null);

  const fetchCompanyLogs = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (search) query.append('search', search);
      if (moduleFilter) query.append('module', moduleFilter);

      const res = await fetch(`/api/audit?${query.toString()}`);
      if (res.ok) {
        const payload = await res.json();
        setLogs(Array.isArray(payload) ? payload : (payload.data || []));
      }
    } catch (e) {
      console.error('Failed to load company audit trail:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanyLogs();
  }, [moduleFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCompanyLogs();
  };

  const formatTimestamp = (ts: any) => {
    try {
      if (!ts) return 'N/A';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return 'N/A';
      if (d.getFullYear() > 3000) {
        return new Date(Math.floor(d.getTime() / 1000)).toLocaleString('en-US', {
          timeZone: 'Asia/Manila',
          month: 'short',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      }
      return d.toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return String(ts);
    }
  };

  const parseJsonSafe = (str?: string | null) => {
    if (!str) return null;
    if (typeof str === 'object') return str;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

  const getActionBadgeColor = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('DELETE') || act.includes('REMOVE')) {
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (act.includes('CREATE') || act.includes('UPLOAD')) {
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (act.includes('UPDATE') || act.includes('MODIFY')) {
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Company Audit Trail & Modification History
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              Active Company Only
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Complete record of who accessed or modified files, tax configurations, and company data for <span className="font-semibold text-slate-700 dark:text-slate-200">{activeCompany?.legalName}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchCompanyLogs}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Module Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setModuleFilter('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            moduleFilter === ''
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          All Activities ({logs.length})
        </button>

        <button
          onClick={() => setModuleFilter('COMPANY')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            moduleFilter === 'COMPANY'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          Company Profile Changes
        </button>

        <button
          onClick={() => setModuleFilter('DOCUMENTS')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            moduleFilter === 'DOCUMENTS'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          Files & Documents
        </button>

        <button
          onClick={() => setModuleFilter('MEMBERSHIP')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            moduleFilter === 'MEMBERSHIP'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          User Roles & Access
        </button>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by User Name, Role, Action, or modified fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-lg hover:bg-slate-800"
        >
          Filter
        </button>
      </form>

      {/* Table */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" /> Loading company audit history...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 font-bold uppercase border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-3.5">Timestamp (PHT)</th>
                  <th className="py-3 px-3.5">User (Who)</th>
                  <th className="py-3 px-3.5">Role</th>
                  <th className="py-3 px-3.5">Action (What)</th>
                  <th className="py-3 px-3.5">Target / Fields Changed</th>
                  <th className="py-3 px-3.5 text-right">View Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                    
                    {/* Timestamp */}
                    <td className="py-3 px-3.5 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>

                    {/* User Name */}
                    <td className="py-3 px-3.5 font-bold text-slate-800 dark:text-slate-200">
                      <div>
                        <span>{log.userDisplayName || 'Authorized User'}</span>
                        <span className="block text-[10px] font-normal text-slate-400">{log.userEmail}</span>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="py-3 px-3.5">
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600">
                        {log.role || 'Member'}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getActionBadgeColor(log.action)}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Target & Fields */}
                    <td className="py-3 px-3.5">
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 block truncate max-w-[180px]">
                          {log.entityName || log.entityType}
                        </span>
                        {log.changedFieldsList && log.changedFieldsList.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {log.changedFieldsList.slice(0, 2).map((f, idx) => (
                              <span key={idx} className="px-1.5 py-0.2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-[9px] font-mono">
                                {f}
                              </span>
                            ))}
                            {log.changedFieldsList.length > 2 && (
                              <span className="text-[9px] text-slate-400">+{log.changedFieldsList.length - 2} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Button */}
                    <td className="py-3 px-3.5 text-right">
                      <button
                        onClick={() => setSelectedItem(log)}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      >
                        <Eye className="w-3 h-3" /> Inspect
                      </button>
                    </td>
                  </tr>
                ))}

                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No activity records recorded yet for this company.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspect Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Modification Record #{selectedItem.id}
                </h3>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              
              {/* User & Role */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">User Name & Email</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 block text-sm mt-0.5">
                    {selectedItem.userDisplayName || 'Authorized User'}
                  </span>
                  <span className="text-slate-500 block">{selectedItem.userEmail}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Assigned Role</span>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold rounded border border-indigo-200 dark:border-indigo-800">
                    {selectedItem.role || 'Member'}
                  </span>
                </div>
              </div>

              {/* Action & Date */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Action Taken</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400 block mt-0.5">
                    {selectedItem.action}
                  </span>
                  <span className="text-slate-500">Module: {selectedItem.module}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Timestamp (PHT)</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200 block mt-0.5">
                    {formatTimestamp(selectedItem.timestamp)}
                  </span>
                </div>
              </div>

              {/* Changed Payloads */}
              {selectedItem.beforeData && (
                <div>
                  <span className="font-bold text-rose-500 uppercase block mb-1 text-[10px]">State Before Modification:</span>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto max-h-36">
                    {selectedItem.beforeData}
                  </pre>
                </div>
              )}

              {selectedItem.afterData && (
                <div>
                  <span className="font-bold text-emerald-500 uppercase block mb-1 text-[10px]">State After Modification:</span>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto max-h-36">
                    {selectedItem.afterData}
                  </pre>
                </div>
              )}

            </div>

            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-1.5 bg-slate-900 dark:bg-slate-700 text-white rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
