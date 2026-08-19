import React, { useEffect, useState } from 'react';
import { Database, ShieldCheck, RefreshCw, Plus, CheckCircle2, AlertCircle } from 'lucide-react';

export default function BackupRestoreView() {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/audit-advanced/backups');
      const data = await res.json();
      if (res.ok) {
        setBackups(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      const res = await fetch('/api/audit-advanced/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupName: `Company_Snapshot_${new Date().toISOString().slice(0, 10)}`, passwordProtected: true })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchBackups();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!confirm('Perform atomic restore from this backup archive? Current working state will be verified against checksum.')) return;
    try {
      const res = await fetch(`/api/audit-advanced/backups/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert(data.error || 'Restore failed');
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
            <Database className="w-5 h-5 text-emerald-600" /> Backup and Atomic Restore
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Reliable atomic backups with cryptographic SHA-256 checksum verification, encrypted archives, and verified state restoration.</p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Create Encrypted Backup Archive
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b font-bold text-xs text-slate-400 uppercase">System Backup Archives ({backups.length})</div>
        {loading ? (
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

                <button
                  onClick={() => handleRestore(b.id)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-600" /> Restore Archive
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
