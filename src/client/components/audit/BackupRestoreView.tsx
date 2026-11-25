import React, { useEffect, useState } from 'react';
import { Database, ShieldCheck, RefreshCw, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';

export default function BackupRestoreView() {
  const { hasPermission } = useAuth();
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  const canViewBackups =
    hasPermission('backups:view') ||
    hasPermission('backup:view') ||
    hasPermission('backups:manage') ||
    hasPermission('backup:manage');
  const canCreateBackups =
    hasPermission('backups:create') ||
    hasPermission('backup:create') ||
    hasPermission('backups:manage') ||
    hasPermission('backup:manage');
  const canRestoreBackups =
    hasPermission('backups:restore') ||
    hasPermission('backup:restore') ||
    hasPermission('backups:manage') ||
    hasPermission('backup:manage');

  const fetchBackups = async () => {
    if (!canViewBackups) {
      setBackups([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await apiFetch<any[]>('/api/audit-advanced/backups');
      setBackups(Array.isArray(data) ? data : []);
    } catch (err: any) {
      if (err?.status !== 403 && !String(err?.message || '').includes('403')) {
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, [canViewBackups]);

  const handleCreateBackup = async () => {
    if (!canCreateBackups) return;
    try {
      setCreating(true);
      setStatusMsg(null);
      const data = await apiFetch<any>('/api/audit-advanced/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupName: `Company_Snapshot_${new Date().toISOString().slice(0, 10)}`, passwordProtected: true })
      });
      setStatusMsg({ type: 'success', text: data.message || 'Encrypted backup archive created successfully.' });
      fetchBackups();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to create backup archive.' });
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!canRestoreBackups) return;
    try {
      setStatusMsg(null);
      const data = await apiFetch<any>(`/api/audit-advanced/backups/${id}/restore`, { method: 'POST' });
      setStatusMsg({ type: 'success', text: data.message || 'Backup restored successfully.' });
      setConfirmRestoreId(null);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Restore failed.' });
      setConfirmRestoreId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" /> Backup and Atomic Restore
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Reliable atomic backups with cryptographic SHA-256 checksum verification, encrypted archives, and verified state restoration.</p>
        </div>
        {canCreateBackups && (
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Create Encrypted Backup Archive
          </button>
        )}
      </div>

      {statusMsg && (
        <div className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
          statusMsg.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
            : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }`}>
          <div className="flex items-center gap-2">
            {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{statusMsg.text}</span>
          </div>
          <button type="button" onClick={() => setStatusMsg(null)} className="text-xs opacity-70 hover:opacity-100 px-2">✕</button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b font-bold text-xs text-slate-400 uppercase">System Backup Archives ({backups.length})</div>
        {!canViewBackups ? (
          <div className="p-12 text-center text-xs text-slate-400">You do not have permission (`backups:view`) to view system backup archives.</div>
        ) : loading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading backups...</div>
        ) : backups.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No backups created yet. Click "Create Encrypted Backup Archive" to generate an atomic snapshot.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {backups.map(b => (
              <div key={b.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded">
                      {b.backupName}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded">
                      {b.sizeBytes} bytes
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-400 truncate max-w-lg">Checksum: {b.checksum}</p>
                </div>

                {canRestoreBackups && (
                  confirmRestoreId === b.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRestore(b.id)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
                      >
                        Confirm Restore
                      </button>
                      <button
                        onClick={() => setConfirmRestoreId(null)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRestoreId(b.id)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-emerald-600" /> Restore Archive
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
