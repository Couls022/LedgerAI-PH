import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCcw, ArrowLeft, AlertCircle, Database, CheckCircle,
  Loader2, AlertTriangle, FolderOpen, ShieldCheck, Copy, X,
  KeyRound, Lock, Eye, EyeOff, HardDriveDownload
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NativeFolderPickerService } from '../services/nativeFolderPickerService';
import { useRuntimeMode } from '../services/runtimeModeService';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

interface ArchiveHeaderHint {
  companyName?: string;
  companyId?: string;
  timestamp?: string;
  version?: string;
}

/**
 * Safely reads the unverified header hint from a local LAIPH1/LGBPH1 file solely so
 * the user knows which company backup they selected before entering Owner/Admin credentials.
 * All cryptographic checksum, HMAC signature, and RBAC checks happen strictly on the server.
 */
function peekLaiHeaderHint(bytes: Uint8Array): ArchiveHeaderHint | null {
  try {
    if (bytes.length < 14) return null;
    const magic = String.fromCharCode(...bytes.subarray(0, 6));
    if (magic !== 'LAIPH1' && magic !== 'LGBPH1') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const metaLen = view.getUint32(6, false);
    if (metaLen <= 0 || bytes.length < 14 + metaLen || metaLen > 512 * 1024) return null;
    const metaBytes = bytes.subarray(10, 10 + metaLen);
    const decoded = new TextDecoder('utf-8').decode(metaBytes);
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName : undefined,
      companyId: typeof parsed.companyId === 'string' ? parsed.companyId : undefined,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    };
  } catch {
    return null;
  }
}

export default function RestoreProfile() {
  const navigate = useNavigate();
  const { user, activeCompany, hasPermission, loading: authLoading } = useAuth();
  const runtime = useRuntimeMode();

  const [file, setFile] = useState<File | null>(null);
  const [backupData, setBackupData] = useState<string | null>(null);
  const [backupFilePath, setBackupFilePath] = useState<string | null>(null);
  const [headerHint, setHeaderHint] = useState<ArchiveHeaderHint | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [scopeSummary, setScopeSummary] = useState<any>(null);
  const [verifiedBackupUser, setVerifiedBackupUser] = useState<{
    displayName: string;
    email: string;
    role: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Cold Disaster-Recovery credentials verified directly against the backup archive
  const [backupEmail, setBackupEmail] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [showBackupPassword, setShowBackupPassword] = useState(false);
  const [authErrorMsg, setAuthErrorMsg] = useState('');

  const [mode, setMode] = useState<'NEW' | 'REPLACE'>('NEW');
  const [cloneAsNew, setCloneAsNew] = useState(false);
  const [destinationPath, setDestinationPath] = useState<string>('');
  const [dedicatedSubfolderName, setDedicatedSubfolderName] = useState<string>('');
  const [defaultCompaniesRoot, setDefaultCompaniesRoot] = useState<string>('/data/companies');

  const [status, setStatus] = useState<
    'IDLE' | 'NEEDS_BACKUP_AUTH' | 'VALIDATING' | 'READY' | 'RESTORING' | 'SUCCESS' | 'ERROR'
  >('IDLE');
  const [errorCode, setErrorCode] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [restoredCompanyId, setRestoredCompanyId] = useState<string | null>(null);
  const [restoreRequiredLogin, setRestoreRequiredLogin] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);
  const [validationStep, setValidationStep] = useState<string>('');

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pickingNativeTarget, setPickingNativeTarget] = useState<'backupFile' | 'destination' | null>(null);
  const [destPickerFeedback, setDestPickerFeedback] = useState<{ type: 'info' | 'warning' | 'error' | 'success'; text: string } | null>(null);

  const hasWorkspaceRestoreSession = Boolean(user && activeCompany && hasPermission('backup:restore'));

  useEffect(() => {
    if (!runtime.loading && !runtime.isServerConsole) {
      navigate('/client/launcher?switch=1', { replace: true });
      return;
    }
  }, [runtime.loading, runtime.isServerConsole, navigate]);

  useEffect(() => {
    fetch('/api/companies/storage-environment')
      .then(res => res.json())
      .then(data => {
        if (data?.companiesRoot) {
          setDefaultCompaniesRoot(data.companiesRoot);
        }
      })
      .catch(() => {});
  }, []);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const resetToIdle = () => {
    setStatus('IDLE');
    setFile(null);
    setBackupData(null);
    setBackupFilePath(null);
    setHeaderHint(null);
    setMetadata(null);
    setScopeSummary(null);
    setVerifiedBackupUser(null);
    setBackupEmail('');
    setBackupPassword('');
    setAuthErrorMsg('');
    setErrorCode('');
    setErrorMsg('');
    setCloneAsNew(false);
    setDestinationPath('');
    setDedicatedSubfolderName('');
    setShowConfirmDialog(false);
  };

  const runServerValidation = async (params: {
    base64Data?: string | null;
    serverFilePath?: string | null;
    credentials?: { email: string; password: string } | null;
  }) => {
    const { base64Data, serverFilePath, credentials } = params;
    setStatus('VALIDATING');
    setErrorCode('');
    setErrorMsg('');
    setAuthErrorMsg('');
    setProgress(40);
    setValidationStep(
      credentials
        ? 'Authenticating Owner/Admin credentials against encrypted backup...'
        : 'Verifying SHA-256 integrity, HMAC signature, and metadata...'
    );
    addLog(
      credentials
        ? `Verifying backup integrity and authenticating ${credentials.email.trim()} against archive RBAC...`
        : 'Verifying cryptographic checksum and HMAC signature on server...'
    );

    try {
      setProgress(75);
      const isPath = Boolean(serverFilePath && !base64Data);
      const endpoint = isPath ? '/api/restore/validate-path' : '/api/restore/validate';
      const bodyPayload: Record<string, any> = isPath
        ? { backupFilePath: serverFilePath }
        : { backupData: base64Data };

      if (credentials) {
        bodyPayload.backupAuth = {
          email: credentials.email.trim(),
          password: credentials.password,
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      setProgress(95);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error || '';
        setErrorCode(code);
        addLog(`Error (${code || res.status}): ${data.message || 'Validation failed'}`);

        const isCredentialFailure =
          res.status === 401 ||
          res.status === 403 ||
          code.startsWith('BACKUP_AUTH') ||
          code.startsWith('BACKUP_ACCOUNT') ||
          code === 'BACKUP_MEMBERSHIP_INACTIVE' ||
          code === 'BACKUP_RESTORE_FORBIDDEN';

        if (credentials && isCredentialFailure) {
          setAuthErrorMsg(data.message || 'Invalid Company Owner or Administrator credentials for this backup archive.');
          setStatus('NEEDS_BACKUP_AUTH');
          return;
        }
        throw new Error(data.message || `Validation failed (HTTP ${res.status})`);
      }

      addLog('Archive checksum, cryptographic signature, and restore authority verified.');
      setProgress(100);
      setValidationStep('Backup package verified!');
      setMetadata(data.metadata);
      setScopeSummary(data.scopeSummary);
      setVerifiedBackupUser(data.verifiedBackupUser || null);

      const canReplaceActive = Boolean(
        hasWorkspaceRestoreSession && activeCompany?.id && activeCompany.id === data.metadata?.companyId
      );
      setMode(canReplaceActive ? 'REPLACE' : 'NEW');
      if (data.metadata?.companyId) {
        setDestinationPath(`${defaultCompaniesRoot}/${data.metadata.companyId}`);
      }
      setStatus('READY');
    } catch (err: any) {
      setStatus('ERROR');
      addLog(`Failed: ${err.message}`);
      setErrorMsg(err.message || 'Failed to validate backup package');
    }
  };

  const handleValidateServerPath = async (selectedPath: string) => {
    setFile(null);
    setBackupData(null);
    setHeaderHint(null);
    setBackupFilePath(selectedPath);
    setLogs([]);
    setErrorCode('');
    setErrorMsg('');
    setAuthErrorMsg('');
    addLog(`Selected server backup archive: ${selectedPath}`);

    if (!hasWorkspaceRestoreSession) {
      // Cold / Disaster-Recovery Restore: require Backup Owner/Admin verification before inspecting or extracting
      setStatus('NEEDS_BACKUP_AUTH');
      return;
    }

    await runServerValidation({ serverFilePath: selectedPath });
  };

  const handleBrowseBackupArchive = async () => {
    if (pickingNativeTarget !== null) return;
    if (!NativeFolderPickerService.isDesktopNativePickerAvailable()) {
      // In browser mode, trigger the native OS file picker input directly
      const inputEl = document.getElementById('backup-archive-upload') as HTMLInputElement | null;
      inputEl?.click();
      return;
    }

    setPickingNativeTarget('backupFile');
    try {
      const result = await NativeFolderPickerService.selectFile({
        title: 'Select LedgerAI PH Backup Archive (.lai / .lgb)',
        defaultPath: defaultCompaniesRoot,
        buttonLabel: 'Select Backup',
        filters: [{ name: 'LedgerAI Backup Archives', extensions: ['lai', 'lgb'] }],
      });
      if (result.status === 'SELECTED' && result.path) {
        await handleValidateServerPath(result.path);
      } else if (result.status === 'ERROR') {
        setErrorMsg(result.message || 'Unable to select backup archive.');
      }
    } finally {
      setPickingNativeTarget(null);
    }
  };

  const handleChooseRestoreDestination = async () => {
    if (pickingNativeTarget !== null) return;
    setPickingNativeTarget('destination');
    setDestPickerFeedback(null);
    try {
      const result = await NativeFolderPickerService.selectDirectory({
        title: 'Select Restore Destination Folder',
        defaultPath: destinationPath || defaultCompaniesRoot,
        purpose: 'RESTORE_DESTINATION',
        requireWrite: true,
      });

      if (result.status === 'SELECTED' && result.path) {
        setDestinationPath(result.path);
        setDestPickerFeedback({
          type: result.validation?.warnings?.length ? 'warning' : 'success',
          text:
            result.validation?.warnings?.[0] ||
            result.message ||
            'Restore destination folder verified.',
        });
      } else if (result.status === 'CANCELLED') {
        // Preserve existing destinationPath untouched
      } else if (result.status === 'UNSUPPORTED_RUNTIME') {
        setDestPickerFeedback({
          type: 'info',
          text:
            result.message ||
            'This environment does not expose a native OS folder dialog. Enter the destination folder path directly above.',
        });
      } else if (result.status === 'ERROR') {
        setDestPickerFeedback({
          type: 'error',
          text: result.message || 'Selected folder failed validation. Previous path preserved.',
        });
      }
    } finally {
      setPickingNativeTarget(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const fileNameLower = selected.name.toLowerCase();
    if (!fileNameLower.endsWith('.lai') && !fileNameLower.endsWith('.lgb')) {
      setStatus('ERROR');
      setErrorMsg('Invalid file format. LedgerAI PH requires a .lai or .lgb backup package.');
      return;
    }

    setFile(selected);
    setBackupFilePath(null);
    setHeaderHint(null);
    setStatus('VALIDATING');
    setLogs([]);
    addLog(`Reading backup archive: ${selected.name}`);
    addLog('Checking .lai package signature...');
    setProgress(15);
    setValidationStep('Reading binary bytes from backup file...');
    setErrorCode('');
    setErrorMsg('');
    setAuthErrorMsg('');

    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const loadedPercent = Math.round((event.loaded / event.total) * 35);
        setProgress(15 + loadedPercent);
      }
    };

    reader.onload = async (event) => {
      try {
        addLog('File read complete.');
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);

        const header6 = String.fromCharCode(...bytes.subarray(0, Math.min(6, bytes.length)));
        const header8 = String.fromCharCode(...bytes.subarray(0, Math.min(8, bytes.length)));
        if (header8 === 'LAISENC1' || header8 === 'LAISENC2') {
          setErrorCode('WORKSPACE_DB_NOT_BACKUP');
          throw new Error(
            'This file is an active encrypted workspace database (database.lai), not a portable backup archive. Use "Open Existing Profile" instead.'
          );
        }

        const isLaiHeader = header6 === 'LAIPH1' || header6 === 'LGBPH1';
        if (!isLaiHeader) {
          addLog('Error: Invalid or missing .lai backup header signature.');
          throw new Error('This file lacks a valid LedgerAI PH backup header signature and cannot be restored.');
        }
        addLog('.lai package signature verified.');

        const hint = peekLaiHeaderHint(bytes);
        setHeaderHint(hint);

        setProgress(55);
        setValidationStep('Encoding package payload...');
        const base64 = uint8ToBase64(bytes);
        setBackupData(base64);

        if (!hasWorkspaceRestoreSession) {
          // Cold / Disaster-Recovery Restore (QuickBooks Enterprise workflow):
          // Ask for Company Owner / Administrator credentials stored inside this backup archive
          addLog('Cold Disaster-Recovery mode: awaiting Company Owner / Administrator verification.');
          setProgress(100);
          setStatus('NEEDS_BACKUP_AUTH');
          return;
        }

        await runServerValidation({ base64Data: base64 });
      } catch (err: any) {
        setStatus('ERROR');
        addLog(`Failed: ${err.message}`);
        setErrorMsg(err.message || 'Failed to read or validate backup file');
      }
    };

    reader.onerror = () => {
      setStatus('ERROR');
      setErrorMsg('Failed to read the selected backup file from local storage.');
    };

    reader.readAsArrayBuffer(selected);
  };

  const handleColdAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupEmail.trim() || !backupPassword) {
      setAuthErrorMsg('Enter both the Company Owner / Administrator email and password from inside this backup.');
      return;
    }
    await runServerValidation({
      base64Data: backupData,
      serverFilePath: backupFilePath,
      credentials: { email: backupEmail.trim(), password: backupPassword },
    });
  };

  const triggerRestore = () => {
    if ((!backupData && !backupFilePath) || !metadata) return;
    setShowConfirmDialog(true);
  };

  const handleRestore = async (forceClone = cloneAsNew, modeOverride?: 'NEW' | 'REPLACE') => {
    const effectiveMode = modeOverride || mode;
    setShowConfirmDialog(false);
    setStatus('RESTORING');
    setErrorCode('');
    setErrorMsg('');

    try {
      const payload: Record<string, any> = {
        mode: effectiveMode,
        cloneAsNew: effectiveMode === 'NEW' ? Boolean(forceClone) : false,
        targetCompanyId: metadata.companyId,
        destinationPath: destinationPath.trim() || undefined,
        dedicatedSubfolderName: effectiveMode === 'NEW' && dedicatedSubfolderName.trim()
          ? dedicatedSubfolderName.trim()
          : undefined,
      };
      if (backupData) {
        payload.backupData = backupData;
      } else if (backupFilePath) {
        payload.backupFilePath = backupFilePath;
      }
      if (!hasWorkspaceRestoreSession && backupEmail.trim() && backupPassword) {
        payload.backupAuth = {
          email: backupEmail.trim(),
          password: backupPassword,
        };
      }

      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCode(data.error || '');
        throw new Error(data.message || `Restore failed (HTTP ${res.status})`);
      }

      // Clear in-memory credentials immediately once atomic extraction succeeds
      setBackupPassword('');
      setRestoredCompanyId(data.companyId);
      setRestoreRequiredLogin(Boolean(data.requiresLogin ?? !hasWorkspaceRestoreSession));
      setStatus('SUCCESS');
    } catch (err: any) {
      setStatus('ERROR');
      setErrorMsg(err.message || 'Restore failed');
    }
  };

  const steps = [
    { label: 'Selecting', description: 'Choose .lai backup' },
    { label: 'Verifying', description: 'Integrity & owner auth' },
    { label: 'Confirming', description: 'Verify target' },
    { label: 'Finalizing', description: 'Restore & sign in' }
  ];

  let activeStep = 0;
  if (status === 'NEEDS_BACKUP_AUTH' || status === 'VALIDATING') activeStep = 1;
  else if (status === 'READY' || showConfirmDialog) activeStep = 2;
  else if (status === 'RESTORING' || status === 'SUCCESS') activeStep = 3;

  const canReplaceActiveCompany = Boolean(
    hasWorkspaceRestoreSession && activeCompany?.id && metadata?.companyId && activeCompany.id === metadata.companyId
  );

  const backupTimestamp = metadata?.timestamp || metadata?.exportedAt;
  const journalCount = scopeSummary?.journalEntryCount ?? scopeSummary?.journalCount ?? 0;

  if (runtime.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] text-slate-500 dark:text-slate-400 text-xs font-medium">
        <Loader2 className="w-5 h-5 animate-spin mr-2 text-blue-600" />
        Verifying server console access...
      </div>
    );
  }

  if (!runtime.canRestoreCompany) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] py-12 px-4">
        <div
          data-testid="restore-profile-server-only-gate"
          className="w-full max-w-lg bg-white dark:bg-[#11192B] p-7 sm:p-8 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center space-y-4 shadow-xs"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-extrabold text-slate-900 dark:text-slate-50">
            PC Server Console Required
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Restoring backup archives (<code className="font-mono text-[11px]">.lai</code> / <code className="font-mono text-[11px]">.lgb</code>) is restricted to the <strong>LedgerAI PH PC Server</strong> workstation. Browser clients can select an available company workspace to sign in.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => navigate('/client/launcher', { replace: true })}
              className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>View Available Company Profiles</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] dark:bg-[#0B1120] py-6 sm:py-10 px-4 sm:px-6 transition-colors duration-200">
      <div className="w-full max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/server/launcher')}
          className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-semibold text-xs mb-6 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Launcher</span>
        </button>

        <div className="mb-6">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">
            Restore Company Database
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-xs sm:text-sm mt-1">
            Verify and restore an encrypted LedgerAI PH backup archive (<code className="font-mono">.lai</code>) into an isolated company workspace.
          </p>
        </div>

        {/* Context Banner: Disaster-Recovery Cold Restore vs Active Workspace Session */}
        {!authLoading && !hasWorkspaceRestoreSession && (
          <div className="mb-6 p-4 sm:p-5 bg-white dark:bg-[#11192B] border border-blue-200/90 dark:border-[#24344F] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/60 flex items-center justify-center shrink-0">
                <HardDriveDownload className="w-4 h-4 text-blue-700 dark:text-sky-400" />
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                <p className="font-display font-bold text-sm text-slate-900 dark:text-slate-50">
                  {user
                    ? `Cold Disaster-Recovery Restore (Current Role: ${activeCompany?.role || 'User'})`
                    : 'Disaster Recovery & New-Device Restore Ready'}
                </p>
                <p className="leading-relaxed text-slate-600 dark:text-slate-400">
                  {user
                    ? 'Your active session does not have restore permission for in-place replacement. You can still restore a .lai archive as a new workspace by verifying the Company Owner or Administrator credentials inside the backup.'
                    : 'No existing company profile is required. Select your .lai backup archive, verify ownership using the Company Owner or Administrator credentials inside the backup, then sign in to open your restored books.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/server/profile/open')}
              className="px-4 py-2.5 sm:py-2 bg-slate-100 dark:bg-[#162238] hover:bg-slate-200 dark:hover:bg-[#1F2F4C] text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-[#24344F] rounded-xl text-xs font-semibold shrink-0 transition-colors whitespace-nowrap cursor-pointer"
            >
              Open Existing Profile
            </button>
          </div>
        )}

        <div className="bg-white dark:bg-[#11192B] rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs overflow-hidden">
          <div className="bg-[#0F1C2E] px-5 py-6 sm:px-8 sm:py-7">
            <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2.5">
                  <RefreshCcw className="w-5 h-5 text-teal-400 shrink-0" />
                  <span>Restore Company Profile</span>
                </h2>
                <p className="text-slate-300 text-xs sm:text-sm mt-1">
                  Atomic rollback protection with cryptographic verification and owner authentication.
                </p>
              </div>
              <div className="bg-white/10 text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/15 whitespace-nowrap shrink-0">
                Step {activeStep + 1} of {steps.length}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {steps.map((step, idx) => (
                <div key={idx} className="min-w-0">
                  <div className={`h-1.5 rounded-full w-full mb-1.5 transition-colors ${activeStep >= idx ? 'bg-teal-400' : 'bg-white/15'}`} />
                  <span className={`block text-[11px] sm:text-xs font-semibold truncate ${activeStep === idx ? 'text-white' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {(status === 'VALIDATING' || status === 'RESTORING') && (
            <div className="px-5 sm:px-8 pt-6">
              <div className="bg-[#0B1120] rounded-xl p-3.5 font-mono text-[11px] text-teal-300 h-28 overflow-y-auto border border-[#1E2D45]">
                {logs.map((log, i) => <div key={i}>{log}</div>)}
                {status === 'RESTORING' && <div>Restoring encrypted company database, documents, and verifying consistency...</div>}
              </div>
            </div>
          )}

          <div className="p-5 sm:p-8">
            {status === 'IDLE' || status === 'VALIDATING' || status === 'ERROR' ? (
              <div className="space-y-5">
                {status === 'ERROR' && (
                  <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 rounded-xl border border-rose-200 dark:border-rose-800 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                      <div>
                        <p className="font-bold text-sm">Restore Could Not Proceed</p>
                        <p className="text-xs mt-1 leading-relaxed">{errorMsg}</p>
                      </div>
                    </div>

                    {errorCode === 'COMPANY_ALREADY_EXISTS' && metadata && (
                      <div className="flex flex-wrap gap-2 pl-8">
                        <button
                          type="button"
                          onClick={() => handleRestore(true, 'NEW')}
                          className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" /> Clone as New Independent Company
                        </button>
                        {canReplaceActiveCompany && (
                          <button
                            type="button"
                            onClick={() => {
                              setMode('REPLACE');
                              setStatus('READY');
                              setErrorMsg('');
                            }}
                            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
                          >
                            Review Replace Active Company
                          </button>
                        )}
                      </div>
                    )}

                    {errorCode === 'WORKSPACE_DB_NOT_BACKUP' && (
                      <div className="pl-8">
                        <button
                          type="button"
                          onClick={() => navigate('/server/profile/open')}
                          className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold cursor-pointer"
                        >
                          Open Existing Workspace Instead &rarr;
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="border-2 border-dashed border-slate-300 dark:border-[#2A3B58] rounded-2xl p-7 sm:p-9 text-center hover:bg-slate-50 dark:hover:bg-[#162238]/50 hover:border-blue-400 dark:hover:border-sky-500/60 transition-colors cursor-pointer relative">
                  <input
                    id="backup-archive-upload"
                    aria-label="Upload LedgerAI PH Backup Archive (.lai)"
                    type="file"
                    accept=".lai,.lgb"
                    onChange={handleFileChange}
                    disabled={status === 'VALIDATING'}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/60 flex items-center justify-center mx-auto mb-3.5">
                    <Database className="w-6 h-6 text-blue-700 dark:text-sky-400" />
                  </div>
                  <p className="font-display text-slate-900 dark:text-slate-100 font-bold text-sm sm:text-base">
                    {file ? file.name : 'Upload LedgerAI PH Backup Archive (.lai)'}
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 text-xs mt-1.5">
                    Supports encrypted company backup archives (.lai / .lgb) — works on new devices &amp; clean setups
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-[#0F172A] border border-slate-200/90 dark:border-[#1E2D45] rounded-xl">
                  <div className="text-xs">
                    <p className="font-bold text-slate-900 dark:text-slate-100">Or select a backup archive stored on disk</p>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">Browse local company backup folders on this machine.</p>
                  </div>
                  <button
                    type="button"
                    data-testid="browse-disk-backups-btn"
                    disabled={status === 'VALIDATING' || pickingNativeTarget !== null}
                    onClick={handleBrowseBackupArchive}
                    className="w-full sm:w-auto px-4 py-2.5 bg-[#0F1C2E] hover:bg-[#192B45] dark:bg-[#1B2942] dark:hover:bg-[#243656] disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    {pickingNativeTarget === 'backupFile' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                    <span>{pickingNativeTarget === 'backupFile' ? 'Opening...' : 'Browse Disk Backups'}</span>
                  </button>
                </div>

                {status === 'VALIDATING' && (
                  <div className="bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E2D45] rounded-xl p-5 space-y-3 w-full">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-semibold">
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-sky-400" />
                        {validationStep}
                      </span>
                      <span className="font-mono">{progress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-[#1B2942] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-sky-400 h-full rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : status === 'NEEDS_BACKUP_AUTH' ? (
              /* Step 2: Backup Ownership Verification (Cold / Disaster-Recovery Restore) */
              <form onSubmit={handleColdAuthSubmit} className="space-y-5">
                <div className="p-4 sm:p-5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200/90 dark:border-[#1E2D45] rounded-2xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-[#1E2D45] pb-2.5">
                    <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      <KeyRound className="w-4 h-4 text-blue-700 dark:text-sky-400" />
                      <span>Verify Backup Ownership Before Extraction</span>
                    </div>
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                      Owner Verification Required
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Selected Archive</p>
                      <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5 truncate" title={file?.name || backupFilePath || ''}>
                        {file?.name || backupFilePath}
                      </p>
                    </div>
                    {headerHint?.companyName && (
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Company in Archive</p>
                        <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">{headerHint.companyName}</p>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Enter the <strong>Company Owner</strong> or <strong>Company Administrator</strong> credentials stored inside this <code className="font-mono">.lai</code> backup file. No data will be extracted to disk until ownership and cryptographic integrity are verified.
                  </p>
                </div>

                {authErrorMsg && (
                  <div
                    role="alert"
                    className="p-3.5 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 rounded-xl border border-rose-200 dark:border-rose-800 flex items-start gap-2.5 text-xs"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Backup Credential Verification Failed</p>
                      <p className="mt-0.5">{authErrorMsg}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="backup-owner-email"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Backup Owner / Administrator Email
                    </label>
                    <input
                      id="backup-owner-email"
                      type="email"
                      required
                      autoComplete="username"
                      value={backupEmail}
                      onChange={(e) => setBackupEmail(e.target.value)}
                      placeholder="owner@company.ph"
                      className="w-full px-3.5 py-2.5 min-h-[44px] bg-slate-50 dark:bg-[#0F172A] border border-slate-300 dark:border-[#24344F] rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="backup-owner-password"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="backup-owner-password"
                        type={showBackupPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={backupPassword}
                        onChange={(e) => setBackupPassword(e.target.value)}
                        placeholder="Enter password stored inside backup"
                        className="w-full px-3.5 py-2.5 pr-11 min-h-[44px] bg-slate-50 dark:bg-[#0F172A] border border-slate-300 dark:border-[#24344F] rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
                      />
                      <button
                        type="button"
                        aria-label={showBackupPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowBackupPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showBackupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={resetToIdle}
                    className="w-full sm:w-auto px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1B2942] rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Choose Different Backup
                  </button>
                  <button
                    type="submit"
                    data-testid="verify-backup-credentials-btn"
                    className="w-full sm:w-auto px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Verify Credentials &amp; Inspect Backup</span>
                  </button>
                </div>
              </form>
            ) : status === 'RESTORING' ? (
              <div className="py-10 text-center space-y-3">
                <Loader2 className="w-10 h-10 animate-spin text-blue-600 dark:text-sky-400 mx-auto" />
                <p className="font-display font-bold text-slate-900 dark:text-slate-100">
                  Restoring Encrypted Database &amp; Documents...
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Please wait while atomic extraction and integrity verification complete.
                </p>
              </div>
            ) : status === 'SUCCESS' ? (
              <div className="text-center py-6 sm:py-8">
                <CheckCircle className="w-14 h-14 text-teal-600 dark:text-teal-400 mx-auto mb-4" />
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                  {restoreRequiredLogin ? 'Database Restored & Verified — Sign In Required' : 'Restore Completed & Verified'}
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm mt-2 max-w-lg mx-auto leading-relaxed">
                  Company profile <code className="font-mono font-bold text-blue-700 dark:text-sky-400">{restoredCompanyId}</code> passed integrity verification and has been registered on this device.
                </p>

                {restoreRequiredLogin && (
                  <div className="mt-5 max-w-md mx-auto p-4 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E2D45] rounded-xl flex items-start gap-2.5 text-left text-xs text-slate-600 dark:text-slate-300">
                    <Lock className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">
                      For enterprise security and BIR CAS audit traceability, the restored workspace remains locked until you sign in with your company credentials.
                    </span>
                  </div>
                )}

                <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const vanity = getCompanyVanityDomain({
                        id: restoredCompanyId,
                        legalName: metadata?.companyName || headerHint?.companyName,
                      });
                      navigate(`/server/${vanity}/login`);
                    }}
                    data-testid="sign-in-restored-profile-btn"
                    className="w-full sm:w-auto px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Sign In to Restored Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/server/profile/open')}
                    className="w-full sm:w-auto px-5 py-3 bg-slate-100 dark:bg-[#162238] text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    View Saved Companies
                  </button>
                </div>
              </div>
            ) : (
              /* Step 3: Confirmation & Options View */
              <div className="space-y-6">
                <div className="p-4 sm:p-5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200/90 dark:border-[#1E2D45] rounded-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-[#1E2D45] pb-2.5">
                    <h4 className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm">
                      Verified Backup Details
                    </h4>
                    {verifiedBackupUser && (
                      <span className="inline-flex items-center gap-1.5 text-teal-700 dark:text-teal-400 text-xs font-semibold">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Authorized: {verifiedBackupUser.displayName} ({verifiedBackupUser.role})</span>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Company Name</p>
                      <p className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5">{metadata.companyName}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Company Identifier</p>
                      <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{metadata.companyId}</p>
                    </div>
                    {backupTimestamp && (
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Backup Date &amp; Time</p>
                        <p className="text-slate-700 dark:text-slate-300 font-mono mt-0.5">{new Date(backupTimestamp).toLocaleString()}</p>
                      </div>
                    )}
                    {scopeSummary && (
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Included Records</p>
                        <p className="text-slate-700 dark:text-slate-300 font-mono mt-0.5">
                          {journalCount} Journals &bull; {scopeSummary.documentCount ?? 0} Encrypted Docs
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Restore Mode Selector */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Restore Mode
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setMode('NEW')}
                      className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                        mode === 'NEW'
                          ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/35'
                          : 'border-slate-200 dark:border-[#1E2D45]'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">New Workspace Restore</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Restore into a clean folder without overwriting existing registered companies.
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={!canReplaceActiveCompany}
                      onClick={() => {
                        setMode('REPLACE');
                        setCloneAsNew(false);
                      }}
                      className={`p-4 rounded-xl border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                        mode === 'REPLACE'
                          ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/35'
                          : 'border-slate-200 dark:border-[#1E2D45]'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Replace Active Company</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {canReplaceActiveCompany
                          ? 'Overwrite the active matching company with pre-restore rollback protection.'
                          : `Requires active signed-in session in matching company (${metadata.companyId}).`}
                      </p>
                    </button>
                  </div>

                  {mode === 'NEW' && (
                    <div className="space-y-3 pt-1">
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cloneAsNew}
                          onChange={(e) => setCloneAsNew(e.target.checked)}
                          className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                        />
                        <span>Clone as a separate Company ID (safe copy alongside existing company)</span>
                      </label>

                      <div>
                        <label
                          htmlFor="restore-destination-path"
                          className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5"
                        >
                          Destination Folder
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            id="restore-destination-path"
                            type="text"
                            value={destinationPath}
                            onChange={(e) => setDestinationPath(e.target.value)}
                            placeholder={`${defaultCompaniesRoot}/${metadata.companyId}`}
                            className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-[#0F172A] border border-slate-300 dark:border-[#24344F] rounded-xl text-xs font-mono"
                          />
                          <button
                            type="button"
                            data-testid="restore-choose-destination-folder-btn"
                            disabled={pickingNativeTarget !== null}
                            onClick={handleChooseRestoreDestination}
                            className="px-4 py-2.5 bg-slate-100 dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] rounded-xl text-xs font-semibold hover:bg-slate-200 dark:hover:bg-[#1F2F4C] disabled:opacity-60 inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                          >
                            {pickingNativeTarget === 'destination' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                            <span>{pickingNativeTarget === 'destination' ? 'Opening...' : 'Choose Folder'}</span>
                          </button>
                        </div>
                        {destPickerFeedback && (
                          <div
                            role="status"
                            className={`mt-1.5 p-2 rounded-lg border text-xs flex items-start gap-1.5 ${
                              destPickerFeedback.type === 'error'
                                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                                : destPickerFeedback.type === 'warning'
                                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                  : destPickerFeedback.type === 'success'
                                    ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                                    : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                            }`}
                          >
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{destPickerFeedback.text}</span>
                          </div>
                        )}
                        <div className="mt-3">
                          <label
                            htmlFor="restore-dedicated-subfolder"
                            className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
                          >
                            Optional Dedicated Company Subfolder
                          </label>
                          <input
                            id="restore-dedicated-subfolder"
                            data-testid="restore-dedicated-subfolder-input"
                            type="text"
                            value={dedicatedSubfolderName}
                            onChange={(e) => setDedicatedSubfolderName(e.target.value)}
                            placeholder="e.g. acme_trading_2026 (leave blank to restore directly into Destination Folder)"
                            className="w-full px-3.5 py-2 bg-slate-50 dark:bg-[#0F172A] border border-slate-300 dark:border-[#24344F] rounded-xl text-xs font-mono"
                          />
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            Restores as a complete reusable portable company folder with standardized metadata (<code className="font-mono">portable_meta.json</code>) that can be reopened directly via Open Existing Company.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={resetToIdle}
                    className="w-full sm:w-auto px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1B2942] rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={triggerRestore}
                    data-testid="proceed-restore-btn"
                    className="w-full sm:w-auto px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Proceed with Restore</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Explicit Confirmation Modal */}
      {showConfirmDialog && metadata && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-[#11192B] border border-slate-200 dark:border-[#24344F] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 bg-[#0F1C2E] text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-display font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Confirm Company Database Restore</span>
              </div>
              <button
                type="button"
                aria-label="Close confirmation dialog"
                onClick={() => setShowConfirmDialog(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700 dark:text-slate-300">
              <p className="leading-relaxed">
                You are about to restore <strong>{metadata.companyName}</strong> (<code className="font-mono">{metadata.companyId}</code>).
              </p>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E2D45] space-y-1 font-mono text-[11px]">
                <div>Mode: <strong>{mode}{mode === 'NEW' && cloneAsNew ? ' (CLONE COPY)' : ''}</strong></div>
                {mode === 'NEW' && (
                  <div>
                    Target Folder:{' '}
                    <strong>
                      {(destinationPath || `${defaultCompaniesRoot}/${metadata.companyId}`) +
                        (dedicatedSubfolderName.trim() ? `/${dedicatedSubfolderName.trim()}` : '')}
                    </strong>
                  </div>
                )}
              </div>
              {mode === 'REPLACE' ? (
                <p className="text-amber-700 dark:text-amber-300 font-semibold leading-relaxed">
                  Warning: Replace mode replaces the active company database after creating a pre-restore rollback snapshot.
                </p>
              ) : !hasWorkspaceRestoreSession ? (
                <p className="text-blue-700 dark:text-sky-300 font-medium leading-relaxed">
                  After extraction completes, you will be redirected to sign in to the restored company profile before accessing financial records.
                </p>
              ) : null}
            </div>
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-[#0F172A] border-t border-slate-200 dark:border-[#1E2D45] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 border border-slate-300 dark:border-[#24344F] rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRestore()}
                data-testid="confirm-restore-execute-btn"
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                Confirm &amp; Restore Database
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

