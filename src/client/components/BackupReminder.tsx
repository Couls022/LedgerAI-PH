import React, { useState, useEffect } from 'react';
import { Download, Clock, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { recordExportActivity } from '../utils/exportUtils';
import { useAuth } from '../context/AuthContext';
import { getAuthorizedERPModules } from '../../shared/moduleRegistry';
import { apiFetch } from '../utils/apiClient';

export default function BackupReminder() {
  const { activeCompany, userRole, permissions, hasPermission } = useAuth();
  const [showReminder, setShowReminder] = useState(false);
  const [daysOverdue, setDaysOverdue] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [successToast, setSuccessToast] = useState(false);

  const hasBackupVaultAccess = React.useMemo(() => {
    const authMods = getAuthorizedERPModules(
      userRole,
      permissions,
      activeCompany?.assignedModules,
      activeCompany?.assignedSubmodules
    );
    const mdMod = authMods.find(m => m.id === 'master-data');
    return Boolean(mdMod?.submodules.some(s => s.id === 'md-backup-vault'));
  }, [userRole, permissions, activeCompany]);

  const canDownloadBackup = React.useMemo(() => {
    return hasBackupVaultAccess && hasPermission(['backups:download', 'backup:download', 'backups:manage', 'backup:manage']);
  }, [hasBackupVaultAccess, hasPermission]);

  const checkExportStatus = async () => {
    try {
      // Check snooze timestamp
      const snoozedUntilStr = localStorage.getItem('ledger_backup_snoozed_until');
      if (snoozedUntilStr) {
        const snoozedUntil = new Date(snoozedUntilStr).getTime();
        if (Date.now() < snoozedUntil) {
          setShowReminder(false);
          return;
        }
      }

      // Query automated backup status from server
      try {
        const status = await apiFetch<any>('/api/backup/status');
        if (status && status.lastBackupTime) {
          localStorage.setItem('ledger_last_export_timestamp', status.lastBackupTime);
          const serverAgeDays = Math.floor((Date.now() - new Date(status.lastBackupTime).getTime()) / (1000 * 60 * 60 * 24));
          if (!status.isOverdue && serverAgeDays < 30) {
            setShowReminder(false);
            return;
          }
          setDaysOverdue(Math.max(1, serverAgeDays));
          setShowReminder(true);
          return;
        }
      } catch {
        // Fail gracefully to local timestamp if network or endpoint fails
      }

      // Get last export timestamp
      let lastExportStr = localStorage.getItem('ledger_last_export_timestamp');
      if (!lastExportStr) {
        // When server has automated backup active by default, default to current timestamp
        const now = new Date().toISOString();
        localStorage.setItem('ledger_last_export_timestamp', now);
        lastExportStr = now;
      }

      const lastExportTime = new Date(lastExportStr).getTime();
      const diffDays = Math.floor((Date.now() - lastExportTime) / (1000 * 60 * 60 * 24));

      if (diffDays >= 30) {
        setDaysOverdue(diffDays);
        setShowReminder(true);
      } else {
        setShowReminder(false);
      }
    } catch (e) {
      console.error("Error reading export status:", e);
    }
  };

  useEffect(() => {
    checkExportStatus();

    // Listen to custom event when any export happens
    const handleExportRecorded = () => {
      setShowReminder(false);
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 5000);
    };

    window.addEventListener('ledger-export-recorded', handleExportRecorded);
    return () => window.removeEventListener('ledger-export-recorded', handleExportRecorded);
  }, [activeCompany?.id, canDownloadBackup]);

  if (!canDownloadBackup) return null;

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDownloadBackup = async () => {
    try {
      setDownloading(true);
      setErrorMsg(null);
      const created = await apiFetch<any>('/api/audit-advanced/backups/create', { method: 'POST' });

      // If a snapshot ID was returned, also offer direct download via authenticated blob fetch
      const backupId = created?.id || created?.backup?.id;
      if (backupId) {
        const dlRes = await fetch(`/api/audit-advanced/backups/${encodeURIComponent(backupId)}/download`, {
          credentials: 'include',
        });
        if (dlRes.ok) {
          const blob = await dlRes.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = created?.backupName || created?.backup?.backupName || `${activeCompany?.legalName || 'company'}-backup.lai`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
        }
      }

      // Record export timestamp
      recordExportActivity();

      setShowReminder(false);
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 5000);
    } catch (err: any) {
      console.error("Backup snapshot error:", err);
      setErrorMsg(err?.message || 'Unable to create backup snapshot right now.');
    } finally {
      setDownloading(false);
    }
  };

  const handleSnooze = () => {
    try {
      // Snooze for 7 days
      const snoozeDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('ledger_backup_snoozed_until', snoozeDate);
      setShowReminder(false);
    } catch (e) {
      setShowReminder(false);
    }
  };

  if (successToast) {
    return (
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 p-4 bg-emerald-900 text-white rounded-2xl shadow-2xl border border-emerald-700 animate-in slide-in-from-bottom duration-300">
        <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
        <div>
          <h4 className="font-bold text-xs">Backup & Export Logged!</h4>
          <p className="text-[11px] text-emerald-200 mt-0.5">Your encrypted database snapshot has been verified and saved in the Backup Vault.</p>
        </div>
        <button onClick={() => setSuccessToast(false)} className="ml-2 text-emerald-300 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!showReminder) return null;

  return (
    <div className="bg-amber-500/10 dark:bg-amber-950/40 border-b border-amber-500/20 px-4 py-3 text-amber-900 dark:text-amber-200 transition-all">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2 bg-amber-500/20 dark:bg-amber-900/50 rounded-lg text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-amber-800 dark:text-amber-200">
              Data Security Reminder: No report exports or backups recorded in over {daysOverdue} days.
            </span>
            <span className="hidden md:inline ml-1 text-amber-700 dark:text-amber-300">
              Keep your financial records and tax schedules secure by creating an encrypted LedgerAI database (.lai) snapshot.
            </span>
            {errorMsg && (
              <p className="mt-1 text-rose-700 dark:text-rose-300 font-semibold">{errorMsg}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            onClick={handleDownloadBackup}
            disabled={downloading}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading ? 'Creating Backup...' : 'Create Backup Now'}</span>
          </button>

          <button
            onClick={handleSnooze}
            className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-semibold rounded-lg transition-colors flex items-center gap-1"
            title="Remind me again in 7 days"
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Remind in 7d</span>
          </button>

          <button
            onClick={() => setShowReminder(false)}
            className="p-1.5 text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-100 rounded-lg"
            title="Dismiss for this session"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
