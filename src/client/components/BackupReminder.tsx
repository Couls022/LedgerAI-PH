import React, { useState, useEffect } from 'react';
import { ShieldAlert, Download, Clock, X, CheckCircle2, Sparkles, AlertTriangle } from 'lucide-react';
import { recordExportActivity } from '../utils/exportUtils';
import { useAuth } from '../context/AuthContext';

export default function BackupReminder() {
  const { activeCompany } = useAuth();
  const [showReminder, setShowReminder] = useState(false);
  const [daysOverdue, setDaysOverdue] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [successToast, setSuccessToast] = useState(false);

  const checkExportStatus = () => {
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

      // Get last export timestamp
      let lastExportStr = localStorage.getItem('ledger_last_export_timestamp');
      if (!lastExportStr) {
        // If never exported, default to 31 days ago to trigger quality-of-life reminder
        const defaultOverdue = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem('ledger_last_export_timestamp', defaultOverdue);
        lastExportStr = defaultOverdue;
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
  }, []);

  const handleDownloadBackup = async () => {
    try {
      setDownloading(true);
      const res = await fetch('/api/restore/export');
      if (!res.ok) {
        throw new Error('Failed to generate backup file');
      }

      const blob = await res.blob();
      const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] 
        || `LedgerAI_Database_${activeCompany?.legalName.replace(/[^a-zA-Z0-9]/g, '_') || 'Company'}_${new Date().toISOString().slice(0, 10)}.lai`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Record export timestamp
      recordExportActivity();

      setShowReminder(false);
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 5000);
    } catch (err) {
      console.error("Backup download error:", err);
      alert("Error downloading database backup. Please try again or check network connectivity.");
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
          <p className="text-[11px] text-emerald-200 mt-0.5">Your offline database backup has been downloaded safely.</p>
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
              Keep your financial records and tax schedules secure by downloading a full offline LedgerAI database (.lai) package.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            onClick={handleDownloadBackup}
            disabled={downloading}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading ? 'Preparing Backup...' : 'Download Backup Now'}</span>
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
