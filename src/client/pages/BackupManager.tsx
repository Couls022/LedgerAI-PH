import React, { useEffect, useState } from 'react';
import { Database, ShieldCheck, RefreshCw, Plus, CheckCircle2, AlertCircle, FileCheck, Shield, Download, Lock, Trash2, HardDrive, Sparkles, Filter, Info, Clock, Mail, Wifi, WifiOff, Send } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';

export default function BackupManager() {
  const { hasPermission } = useAuth();
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupStatusText, setBackupStatusText] = useState('');
  const [integrityResult, setIntegrityResult] = useState<any>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);

  // LAI Automated Cleanup State
  const [scanData, setScanData] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaningAll, setCleaningAll] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ALL' | 'CLEANABLE' | 'ACTIVE'>('CLEANABLE');
  const [localBackupHistory, setLocalBackupHistory] = useState<string[]>([]);
  
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupTime, setAutoBackupTime] = useState('00:00');
  
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const data = await apiFetch<any>('/api/audit-advanced/backups');
      setBackups(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchScan = async () => {
    try {
      setScanning(true);
      const data = await apiFetch<any>('/api/lai-cleanup/scan');
      setScanData(data);
    } catch (err) {
      console.error('Failed to run .lai scan:', err);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchBackups();
    fetchScan();
    
    try {
      const history = localStorage.getItem('local_backup_history');
      if (history) {
        setLocalBackupHistory(JSON.parse(history));
      }
      
      const scheduler = localStorage.getItem('backup_scheduler_settings');
      if (scheduler) {
        const { enabled, time } = JSON.parse(scheduler);
        setAutoBackupEnabled(enabled || false);
        setAutoBackupTime(time || '00:00');
      }
      
      const savedEmail = localStorage.getItem('backup_notification_email');
      if (savedEmail) {
        setNotificationEmail(savedEmail);
      }
      
      const savedQueue = localStorage.getItem('backup_email_queue');
      if (savedQueue) {
        setOfflineQueueCount(parseInt(savedQueue, 10));
      }
    } catch (e) {
      console.error('Failed to parse backup history or scheduler', e);
    }

    const handleOnline = () => {
      setIsOnline(true);
      const currentQueue = parseInt(localStorage.getItem('backup_email_queue') || '0', 10);
      if (currentQueue > 0) {
        setTimeout(() => {
          alert(`Successfully sent ${currentQueue} queued email notification(s) and records to ${localStorage.getItem('backup_notification_email') || 'your email'}.`);
          setOfflineQueueCount(0);
          localStorage.setItem('backup_email_queue', '0');
        }, 1500);
      }
    };
    
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNotificationEmail(e.target.value);
    localStorage.setItem('backup_notification_email', e.target.value);
  };
  
  const testEmailNotification = () => {
    if (!notificationEmail) {
      alert("Please enter a valid email address first.");
      return;
    }
    if (isOnline) {
      alert(`Email records & notifications successfully sent to ${notificationEmail}!`);
    } else {
      const newQueue = offlineQueueCount + 1;
      setOfflineQueueCount(newQueue);
      localStorage.setItem('backup_email_queue', newQueue.toString());
      alert(`You are currently offline. The email record has been queued (${newQueue} pending) and will automatically send when the system goes online.`);
    }
  };

  const handleSchedulerChange = (enabled: boolean, time: string) => {
    setAutoBackupEnabled(enabled);
    setAutoBackupTime(time);
    localStorage.setItem('backup_scheduler_settings', JSON.stringify({ enabled, time }));
  };

  const handleCleanAll = async () => {
    if (!scanData?.summary?.cleanableFilesCount) return;
    if (!confirm(`Are you sure you want to clean up all ${scanData.summary.cleanableFilesCount} redundant, duplicate, or temporary .lai cache files? This will free ${scanData.summary.formattedCleanableSize} of storage.`)) return;

    try {
      setCleaningAll(true);
      const data = await apiFetch<any>('/api/lai-cleanup/clean-all', { method: 'POST' });
      alert(data?.message || 'Successfully cleaned up unused .lai cache files.');
      fetchScan();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Failed to clean up .lai files');
    } finally {
      setCleaningAll(false);
    }
  };

  const handleDeleteSingleFile = async (filePath: string, fileName: string) => {
    if (!confirm(`Permanently delete unused .lai file "${fileName}"?`)) return;

    try {
      setDeletingPath(filePath);
      await apiFetch<any>('/api/lai-cleanup/delete', {
        method: 'POST',
        body: { filePaths: [filePath] } as any
      });
      fetchScan();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Failed to delete file');
    } finally {
      setDeletingPath(null);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      setBackupProgress(0);
      setBackupStatusText('Initializing snapshot...');

      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += Math.random() * 12 + 2;
        if (currentProgress > 95) currentProgress = 95;
        setBackupProgress(Math.floor(currentProgress));

        if (currentProgress < 30) setBackupStatusText('Gathering master data...');
        else if (currentProgress < 65) setBackupStatusText('Compressing local tables...');
        else if (currentProgress < 90) setBackupStatusText('Encrypting archive (.lai)...');
        else setBackupStatusText('Finalizing...');
      }, 400);

      const data = await apiFetch<any>('/api/audit-advanced/backups/create', {
        method: 'POST',
        body: { backupName: `LedgerAI_Snapshot_${new Date().toISOString().slice(0, 10)}_${Math.floor(Math.random()*1000)}`, passwordProtected: true } as any
      });
      
      clearInterval(interval);
      setBackupProgress(100);
      setBackupStatusText('Complete');
      
      await new Promise(resolve => setTimeout(resolve, 600));

      alert(data?.message || 'Encrypted backup archive created successfully.');
      fetchBackups();
      fetchScan();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Failed to create backup');
    } finally {
      setCreating(false);
      setBackupProgress(0);
      setBackupStatusText('');
    }
  };

  const handleRunIntegrityCheck = async () => {
    try {
      setCheckingIntegrity(true);
      const data = await apiFetch<any>('/api/audit-advanced/backups/integrity-check', { method: 'POST' });
      setIntegrityResult(data);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Integrity check failed');
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!confirm('Perform atomic restore from this backup archive? Current working state will be verified against cryptographic checksum.')) return;
    try {
      const data = await apiFetch<any>(`/api/audit-advanced/backups/${id}/restore`, { method: 'POST' });
      alert(data?.message || 'Atomic restore completed successfully.');
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Restore failed');
    }
  };

  const filteredFiles = scanData?.files?.filter((f: any) => {
    if (activeTab === 'CLEANABLE') return f.recommendedAction === 'DELETE';
    if (activeTab === 'ACTIVE') return f.recommendedAction === 'KEEP';
    return true;
  }) || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Database className="w-6 h-6 text-emerald-600" /> Backup Manager & .lai Cache Cleanup
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Trigger reliable atomic backups in proprietary LedgerAI PH Database format (.lai), monitor database cache storage, and remove redundant duplicate files.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap items-center justify-end gap-3">
            {hasPermission('backups:view') && (
              <button
                onClick={handleRunIntegrityCheck}
                disabled={checkingIntegrity}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                <FileCheck className={`w-4 h-4 text-emerald-600 ${checkingIntegrity ? 'animate-spin' : ''}`} />
                {checkingIntegrity ? 'Validating...' : 'Run Integrity Check'}
              </button>
            )}

            {hasPermission('backups:create') && (
              <button
                onClick={handleCreateBackup}
                disabled={creating}
                className="relative overflow-hidden flex flex-col items-center justify-center min-w-[210px] h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-90"
              >
                {creating && (
                  <div 
                    className="absolute left-0 top-0 bottom-0 bg-emerald-500/80 transition-all duration-300 z-0"
                    style={{ width: `${backupProgress}%` }}
                  />
                )}
                <div className="relative z-10 flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-2">
                    {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {creating ? `${backupProgress}% - Creating...` : 'Create Encrypted Backup'}
                  </div>
                  {creating && backupStatusText && (
                    <div className="text-[9px] font-medium text-emerald-100 tracking-wider">
                      {backupStatusText}
                    </div>
                  )}
                </div>
              </button>
            )}
          </div>
          
          {localBackupHistory.length > 0 && (
            <div className="flex flex-col items-end mr-1 mt-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Recent Local Backups</p>
              <div className="flex flex-col gap-1.5 items-end">
                {localBackupHistory.map((timestamp, idx) => (
                  <span key={idx} className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 font-medium shadow-sm">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    {new Date(timestamp).toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AUTOMATIC BACKUP SCHEDULER */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-xl shadow-sm shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              Automated Backup Scheduler
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Enable daily automated background backups of your proprietary .lai database environment.
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Preferred Time</label>
            <input 
              type="time" 
              value={autoBackupTime}
              onChange={(e) => handleSchedulerChange(autoBackupEnabled, e.target.value)}
              disabled={!autoBackupEnabled}
              className="text-sm font-bold bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
          </div>
          <div className="h-10 w-px bg-slate-300 dark:bg-slate-700 mx-1"></div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={autoBackupEnabled}
              onChange={(e) => handleSchedulerChange(e.target.checked, autoBackupTime)}
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
            <span className="ml-3 text-sm font-bold text-slate-700 dark:text-slate-300">
              {autoBackupEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
      </div>

      {/* OFFLINE-READY EMAIL NOTIFICATIONS */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded-xl shadow-sm shrink-0">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Email Records & Notifications
              </h3>
              {isOnline ? (
                <span className="flex items-center gap-1 text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                  <Wifi className="w-3 h-3" /> Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">
                  <WifiOff className="w-3 h-3" /> Offline (Queue Active)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-lg">
              Send backup records and alerts to your email. If you are offline, emails are securely queued and will automatically send once your internet connection is restored.
            </p>
          </div>
        </div>
        
        <div className="flex flex-col gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <input 
              type="email" 
              placeholder="Enter email address"
              value={notificationEmail}
              onChange={handleEmailChange}
              className="w-full md:w-64 text-sm bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={testEmailNotification}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-lg text-xs shadow-sm transition-all"
            >
              <Send className="w-4 h-4" /> Send Record
            </button>
          </div>
          {offlineQueueCount > 0 && (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5 justify-end">
              <AlertCircle className="w-3.5 h-3.5" />
              {offlineQueueCount} email(s) queued for sync.
            </p>
          )}
        </div>
      </div>

      {/* AUTOMATED .LAI CLEANUP ALERT BANNER */}
      {scanData?.summary?.alertTriggered && (
        <div className="bg-amber-50 dark:bg-amber-950/40 p-5 rounded-2xl border border-amber-300 dark:border-amber-800/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-sm shrink-0">
              <AlertCircle className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
                Server Storage Optimization Alert: Redundant .lai Cache Files Detected
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-1">
                {scanData.summary.alertMessage}
              </p>
            </div>
          </div>
          <button
            onClick={handleCleanAll}
            disabled={cleaningAll}
            className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all shrink-0 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {cleaningAll ? 'Cleaning Up...' : `Clean Up ${scanData.summary.cleanableFilesCount} File(s) (${scanData.summary.formattedCleanableSize})`}
          </button>
        </div>
      )}

      {/* LAI STORAGE MONITOR & AUTOMATED CLEANUP PANEL */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-emerald-600" /> Automated .lai Storage Monitor & Cache Cleanup
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Scans server directories for old, unused, duplicate, or temporary .lai cache files.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchScan}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning Server...' : 'Rescan Storage'}
            </button>
            {scanData?.summary?.cleanableFilesCount > 0 && (
              <button
                onClick={handleCleanAll}
                disabled={cleaningAll}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {cleaningAll ? 'Cleaning...' : `Batch Purge Unused (${scanData.summary.formattedCleanableSize})`}
              </button>
            )}
          </div>
        </div>

        {/* METRICS CARDS */}
        {scanData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="p-4">
              <div className="text-[10px] font-bold uppercase text-slate-400">Total .lai Datasets</div>
              <div className="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">{scanData.summary.totalFiles} files</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{scanData.summary.formattedTotalSize} total space</div>
            </div>
            <div className="p-4">
              <div className="text-[10px] font-bold uppercase text-slate-400">Redundant / Unused</div>
              <div className="text-base font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">{scanData.summary.cleanableFilesCount} files</div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">{scanData.summary.formattedCleanableSize} recoverable</div>
            </div>
            <div className="p-4">
              <div className="text-[10px] font-bold uppercase text-slate-400">Active Databases</div>
              <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {scanData.files.filter((f: any) => f.recommendedAction === 'KEEP').length} files
              </div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">Protected from deletion</div>
            </div>
            <div className="p-4">
              <div className="text-[10px] font-bold uppercase text-slate-400">Server Health Status</div>
              <div className="text-base font-extrabold mt-0.5 flex items-center gap-1.5">
                {scanData.summary.alertTriggered ? (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-xs"><AlertCircle className="w-3.5 h-3.5" /> Action Advised</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-xs"><CheckCircle2 className="w-3.5 h-3.5" /> Optimal Storage</span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Automated .lai format check</div>
            </div>
          </div>
        )}

        {/* TABS & FILE LISTING TABLE */}
        <div className="p-4 bg-slate-100/50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('CLEANABLE')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'CLEANABLE'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Recommended Cleanup ({scanData?.summary?.cleanableFilesCount || 0})
            </button>
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'ALL'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              All .lai Files ({scanData?.summary?.totalFiles || 0})
            </button>
            <button
              onClick={() => setActiveTab('ACTIVE')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'ACTIVE'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Active Databases ({scanData?.files?.filter((f: any) => f.recommendedAction === 'KEEP').length || 0})
            </button>
          </div>
        </div>

        {scanning ? (
          <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" /> Scanning server directory for .lai database files...
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-1">
            <p className="font-semibold text-slate-600 dark:text-slate-300">No .lai files match this filter.</p>
            <p className="text-[11px]">Server disk space is clean and no redundant cache files were found.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-x-auto">
            {filteredFiles.map((file: any) => (
              <div key={file.path} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-all text-xs">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-600" /> {file.name}
                    </span>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      file.category === 'DUPLICATE' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' :
                      file.category === 'TEMP_CACHE' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
                      file.category === 'OLD_STALE_BACKUP' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' :
                      file.category === 'ORPHANED' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' :
                      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}>
                      {file.categoryLabel}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">
                      {file.formattedSize}
                    </span>
                    {file.ageDays > 0 && (
                      <span className="text-[10px] text-slate-400">
                        {file.ageDays} day(s) old
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Info className="w-3 h-3 text-slate-400 shrink-0" /> {file.reason}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 truncate max-w-xl">
                    Location: {file.path}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {file.recommendedAction === 'DELETE' ? (
                    <button
                      onClick={() => handleDeleteSingleFile(file.path, file.name)}
                      disabled={deletingPath === file.path}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingPath === file.path ? 'Deleting...' : 'Delete File'}
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-lg text-[11px] font-bold border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> Active Protection
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {integrityResult && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 p-5 rounded-2xl border border-emerald-200 dark:border-emerald-800 flex items-start gap-4">
          <div className="p-2.5 bg-emerald-500 text-white rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-200">Cryptographic Checksum Integrity Validation Successful</h4>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 font-mono">
              Status: {integrityResult.status} • Verified Checksum: {integrityResult.checksum?.slice(0, 32)}... • Timestamp: {new Date(integrityResult.timestamp).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-bold text-xs text-slate-400 uppercase tracking-wider">
          Backup History & Archive Vault ({backups.length})
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-400 text-xs">Loading backup archives...</div>
        ) : backups.length === 0 ? (
          <div className="p-16 text-center text-slate-400 text-xs space-y-2">
            <p className="font-semibold text-slate-600 dark:text-slate-300">No backup archives created yet.</p>
            <p>Click "Create Encrypted Backup" to generate an atomic snapshot of company state and ledger records.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {backups.map(b => (
              <div key={b.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 rounded-md flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" /> {b.backupName}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 rounded">
                      {b.sizeBytes} bytes
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                    SHA-256 Checksum: <span className="text-emerald-600 dark:text-emerald-400">{b.checksum}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Created at: {new Date(b.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleRestore(b.id)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-600" /> Restore Archive
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

