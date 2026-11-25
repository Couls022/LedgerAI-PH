import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  FolderOpen,
  Trash2,
  Clock,
  AlertCircle,
  RefreshCcw,
  Search,
  AlertTriangle,
  Loader2,
  Database,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/apiClient';
import { NativeFolderPickerService } from '../services/nativeFolderPickerService';
import { CompanyPreferenceService } from '../services/companyPreferenceService';
import { useRuntimeMode } from '../services/runtimeModeService';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

export default function OpenProfile() {
  const { user, userRole, activeCompany, switchWorkspaceCleanup } = useAuth();
  const isOwner = Boolean(user && userRole === 'Company Owner');
  const runtime = useRuntimeMode();
  const isLocalHost = runtime.isServerConsole;
  const [shortcuts, setShortcuts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [folderPath, setFolderPath] = useState('');
  const [registeringFolder, setRegisteringFolder] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [registerStatus, setRegisterStatus] = useState<{
    success?: boolean;
    tone?: 'success' | 'warning' | 'error';
    code?: string;
    text?: string;
    companyId?: string;
    companyName?: string;
    registrationAction?: string;
    attachmentAudit?: {
      totalReferences: number;
      presentCount: number;
      missingCount: number;
      missingFiles?: Array<{ documentId: string; fileName: string; expectedPath: string }>;
    } | null;
  } | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    mode: 'LOCAL_FOLDER' | 'PORTABLE_UPLOAD';
    targetPath?: string;
    uploadedFiles?: Array<{ relativePath: string; base64Content: string }>;
    companyId: string;
    existingLegalName: string;
    existingLocation: string;
    selectedLocation: string;
    message: string;
  } | null>(null);

  const [companyToRemove, setCompanyToRemove] = useState<{ id: string; name: string; location?: string } | null>(null);
  const [confirmCleanupStale, setConfirmCleanupStale] = useState(false);
  const [cleaningStale, setCleaningStale] = useState(false);
  const [confirmClearAllShortcuts, setConfirmClearAllShortcuts] = useState(false);
  const [clearingAllShortcuts, setClearingAllShortcuts] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [pickingFolder, setPickingFolder] = useState(false);
  const [importingPortable, setImportingPortable] = useState(false);

  const navigate = useNavigate();

  const fetchShortcuts = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/companies/shortcuts').catch(() => null);
      if (Array.isArray(data?.shortcuts)) {
        setShortcuts(data.shortcuts);
        return;
      }
      const list = await apiFetch('/api/companies').catch(() => null);
      if (Array.isArray(list)) {
        setShortcuts(
          list.map((c: any) => ({
            companyId: c.id,
            displayName: c.legalName,
            databasePath: c.dbPath,
            companyDirectory: c.location,
            lastOpenedAt: c.lastOpenedAt || c.createdAt || new Date().toISOString(),
            lastOperation: 'OPENED',
            availabilityStatus: 'AVAILABLE',
            validationStatus: 'VALID',
            classification: c.classification,
          }))
        );
      }
    } catch (err) {
      console.error('Error fetching company shortcuts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!runtime.loading && !runtime.isServerConsole) {
      navigate('/client/launcher?switch=1', { replace: true });
      return;
    }
    if (!runtime.loading) {
      fetchShortcuts();
    }
  }, [runtime.loading, runtime.isServerConsole, navigate]);

  const handleRegisterFolder = async (
    pathOverride?: string,
    conflictResolution: 'FAIL_ON_CONFLICT' | 'SWITCH_REGISTRY_TO_SELECTED' = 'FAIL_ON_CONFLICT'
  ) => {
    const pathToRegister = (pathOverride ?? folderPath).trim();
    if (!pathToRegister) {
      setRegisterStatus({ success: false, text: 'Select or enter a portable company folder path.' });
      return;
    }
    setRegisteringFolder(true);
    setRegisterStatus(null);
    if (conflictResolution === 'FAIL_ON_CONFLICT') {
      setDuplicateConflict(null);
    }
    try {
      const data = await apiFetch('/api/companies/open-folder', {
        method: 'POST',
        body: { path: pathToRegister, conflictResolution } as any,
      });

      const audit = data.attachmentAudit || null;
      const missingCount = audit?.missingCount || 0;
      const actionLabel =
        data.registrationAction === 'REUSED_EXISTING'
          ? 'Reused existing registry entry'
          : data.registrationAction === 'RELOCATED'
            ? `Relocated portable folder (${data.relocatedDocumentsUpdated || 0} document references remapped)`
            : data.registrationAction === 'SWITCHED_REGISTRY'
              ? 'Switched registry to selected portable folder'
              : 'Registered new portable company folder';

      setDuplicateConflict(null);
      setRegisterStatus({
        success: true,
        tone: missingCount > 0 ? 'warning' : 'success',
        registrationAction: data.registrationAction,
        companyId: data.company?.id,
        companyName: data.company?.legalName,
        attachmentAudit: audit,
        text:
          `${actionLabel}: "${data.company?.legalName || 'Company'}". Ready to open.` +
          (missingCount > 0
            ? ` Warning: ${missingCount} document attachment(s) referenced in the database were not found in the folder.`
            : ''),
      });
      setFolderPath(pathToRegister);
      await fetchShortcuts();
    } catch (err: any) {
      if (err?.data?.error === 'DUPLICATE_COMPANY_IDENTITY_CONFLICT' && err?.data?.conflict) {
        setDuplicateConflict({
          mode: 'LOCAL_FOLDER',
          targetPath: pathToRegister,
          companyId: err.data.conflict.companyId,
          existingLegalName: err.data.conflict.existingLegalName || err.data.conflict.companyId,
          existingLocation: err.data.conflict.existingLocation || '[Existing Registered Folder]',
          selectedLocation: err.data.conflict.selectedLocation || pathToRegister,
          message: err.message || 'This company identity already exists in another active registered folder.',
        });
      } else {
        setRegisterStatus({
          success: false,
          code: err?.data?.error,
          text: err?.message || 'Unable to open portable company folder.',
        });
      }
    } finally {
      setRegisteringFolder(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buf = new Uint8Array(reader.result as ArrayBuffer);
        const chunkSize = 0x8000;
        const parts: string[] = [];
        for (let i = 0; i < buf.length; i += chunkSize) {
          parts.push(String.fromCharCode(...buf.subarray(i, Math.min(i + chunkSize, buf.length))));
        }
        resolve(btoa(parts.join('')));
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsArrayBuffer(file);
    });

  const collectPortableFilesFromHandle = async (
    dirHandle: any,
    prefix = ''
  ): Promise<Array<{ relativePath: string; base64Content: string }>> => {
    const out: Array<{ relativePath: string; base64Content: string }> = [];
    if (!dirHandle || typeof dirHandle.values !== 'function') return out;
    for await (const entry of dirHandle.values()) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const nested = await collectPortableFilesFromHandle(entry, rel);
        out.push(...nested);
      } else if (entry.kind === 'file' && typeof entry.getFile === 'function') {
        const f: File = await entry.getFile();
        out.push({ relativePath: rel, base64Content: await fileToBase64(f) });
      }
      if (out.length >= 250) break;
    }
    return out;
  };

  const submitPortableUpload = async (
    uploadedFiles: Array<{ relativePath: string; base64Content: string }>,
    conflictResolution: 'FAIL_ON_CONFLICT' | 'SWITCH_REGISTRY_TO_SELECTED' = 'FAIL_ON_CONFLICT'
  ) => {
    setImportingPortable(true);
    setRegisterStatus(null);
    try {
      const data = await apiFetch('/api/companies/import-portable', {
        method: 'POST',
        body: { files: uploadedFiles, conflictResolution } as any,
      });
      setDuplicateConflict(null);
      setRegisterStatus({
        success: true,
        tone: data.attachmentAudit?.missingCount > 0 ? 'warning' : 'success',
        registrationAction: data.registrationAction,
        attachmentAudit: data.attachmentAudit || null,
        text: data.message || `Imported "${data.company?.legalName || 'Company'}" to central server.`,
      });
      await fetchShortcuts();
    } catch (err: any) {
      if (err?.data?.error === 'DUPLICATE_COMPANY_IDENTITY_CONFLICT' && err?.data?.conflict) {
        setDuplicateConflict({
          mode: 'PORTABLE_UPLOAD',
          uploadedFiles,
          companyId: err.data.conflict.companyId,
          existingLegalName: err.data.conflict.existingLegalName || err.data.conflict.companyId,
          existingLocation: err.data.conflict.existingLocation || '[Server Managed Storage]',
          selectedLocation: '[Uploaded Portable Package]',
          message: err.message || 'This company is already registered on the central server.',
        });
      } else {
        setRegisterStatus({
          success: false,
          code: err?.data?.error,
          text: err?.message || 'Unable to import portable company package.',
        });
      }
    } finally {
      setImportingPortable(false);
    }
  };

  const handleImportPortablePackageToServer = async () => {
    if (pickingFolder || importingPortable) return;
    setPickingFolder(true);
    setRegisterStatus(null);
    setDuplicateConflict(null);
    try {
      const result = await NativeFolderPickerService.selectDirectory({
        title: 'Select Portable Company Folder to Import',
        purpose: 'IMPORT_SOURCE',
        requireWrite: false,
      });
      if (result.status === 'CANCELLED') return;
      if (result.status !== 'SELECTED') {
        setRegisterStatus({
          success: false,
          text: result.message || 'Could not open native folder picker for portable import.',
        });
        return;
      }

      let uploadedFiles: Array<{ relativePath: string; base64Content: string }> = [];
      if (result.directoryHandle) {
        uploadedFiles = await collectPortableFilesFromHandle(result.directoryHandle);
      } else if (result.localDirectory?.files?.length) {
        for (const f of result.localDirectory.files.slice(0, 250)) {
          const webkitPath = String((f as any).webkitRelativePath || f.name).replace(/\\/g, '/');
          const parts = webkitPath.split('/').filter(Boolean);
          const rel = parts.length > 1 ? parts.slice(1).join('/') : f.name;
          uploadedFiles.push({
            relativePath: rel,
            base64Content: await fileToBase64(f),
          });
        }
      }

      if (uploadedFiles.length === 0) {
        setRegisterStatus({
          success: false,
          text: 'The selected folder did not contain readable portable company files.',
        });
        return;
      }

      await submitPortableUpload(uploadedFiles, 'FAIL_ON_CONFLICT');
    } finally {
      setPickingFolder(false);
    }
  };

  const handleReopenCompany = async (shortcut: any) => {
    setOpeningId(shortcut.companyId);
    setActionFeedback(null);
    try {
      if (activeCompany && activeCompany.id !== shortcut.companyId) {
        await switchWorkspaceCleanup(shortcut.companyId);
      }

      await apiFetch(`/api/companies/shortcuts/${encodeURIComponent(shortcut.companyId)}/reopen`, {
        method: 'POST',
        body: {} as any,
      });
      const vanity = getCompanyVanityDomain({ id: shortcut.companyId, legalName: shortcut.displayName || shortcut.legalName });
      navigate(`/server/${vanity}/login`);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        text: err?.message || `Failed to open "${shortcut.displayName}".`,
      });
      await fetchShortcuts();
    } finally {
      setOpeningId(null);
    }
  };

  const handleBrowseCompanyFolder = async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    setRegisterStatus(null);
    try {
      const result = await NativeFolderPickerService.selectDirectory({
        title: 'Select Company Workspace Folder',
        defaultPath: folderPath || undefined,
        purpose: 'OPEN_COMPANY',
        requireWrite: false,
      });

      if (result.status === 'SELECTED' && (result.path || result.folderName)) {
        const picked = result.path || result.folderName || '';
        setFolderPath(picked);
        const detectedFiles = result.localDirectory?.detectedLedgerFiles || [];
        const hasBackupArchive = Boolean(
          detectedFiles.some((f) => /\.(lgb)$/i.test(f) || /backup.*\.lai$/i.test(f))
        );
        const detectedLabel =
          detectedFiles.length > 0
            ? ` Detected: ${detectedFiles.slice(0, 3).join(', ')}.`
            : '';
        setRegisterStatus({
          success: true,
          tone: hasBackupArchive ? 'warning' : 'success',
          code: hasBackupArchive ? 'BACKUP_FILE_NOT_WORKSPACE' : undefined,
          text:
            `Folder selected: "${picked}". Click "Verify & Open" to verify and open this company workspace.` +
            detectedLabel,
        });
      } else if (result.status === 'CANCELLED') {
        // Preserve existing folderPath untouched
      } else if (result.status === 'UNSUPPORTED_RUNTIME' || result.status === 'ERROR') {
        if (result.path || result.folderName) {
          setFolderPath(result.path || result.folderName || '');
        }
        setRegisterStatus({
          success: false,
          text:
            result.message ||
            'This environment does not expose a native OS folder dialog. Paste the company folder path above and click Verify & Open.',
        });
      }
    } finally {
      setPickingFolder(false);
    }
  };

  const handleLocateDatabase = async (shortcut: any) => {
    if (pickingFolder) return;
    const id = shortcut.companyId;
    setPickingFolder(true);
    setActionFeedback(null);
    try {
      const result = await NativeFolderPickerService.selectDirectory({
        title: `Locate Company Folder — ${shortcut.displayName || id}`,
        defaultPath: shortcut.companyDirectory || undefined,
        purpose: 'OPEN_COMPANY',
        requireWrite: false,
      });

      if (result.status === 'CANCELLED') {
        return;
      }
      if (result.status !== 'SELECTED' || !result.path) {
        setActionFeedback({
          type: 'error',
          text:
            result.message ||
            'This environment does not expose a native OS folder dialog. Enter the folder path above to relocate this workspace.',
        });
        return;
      }
      if (result.resolutionMode === 'BROWSER_HANDLE_ONLY') {
        setFolderPath(result.path);
        setActionFeedback({
          type: 'error',
          text:
            result.message ||
            `Selected "${result.folderName}" via browser OS picker. Verify the full directory path in the field above to relocate this workspace.`,
        });
        return;
      }

      setOpeningId(id);
      const data = await apiFetch(`/api/companies/shortcuts/${encodeURIComponent(id)}/locate`, {
        method: 'POST',
        body: { path: result.path } as any,
      });
      setActionFeedback({
        type: 'success',
        text: data.message || `Relocated company folder for ${id}.`,
      });
      await fetchShortcuts();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        text: err?.message || 'Selected folder did not pass verification or identity check.',
      });
    } finally {
      setPickingFolder(false);
      setOpeningId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setActionFeedback(null);
    try {
      const data = await apiFetch(`/api/companies/shortcuts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: { confirmProtectedUnregister: true } as any,
      });
      setCompanyToRemove(null);
      setShortcuts((prev) => prev.filter((c) => c.companyId !== id));
      setActionFeedback({
        type: 'success',
        text: data.message || 'Removed from saved list. Your company files on disk remain intact.',
      });
    } catch (err: any) {
      setCompanyToRemove(null);
      setActionFeedback({
        type: 'error',
        text: err?.message || `Cannot remove entry for ${id}.`,
      });
    }
  };

  const handleCleanupStale = async () => {
    if (!isOwner) {
      setConfirmCleanupStale(false);
      setActionFeedback({
        type: 'error',
        text: 'Sign in as a Company Owner first to clean missing entries.',
      });
      return;
    }
    setCleaningStale(true);
    setActionFeedback(null);
    try {
      const data = await apiFetch('/api/companies/registry/cleanup-stale', {
        method: 'POST',
        body: { dryRun: false } as any,
      });
      setConfirmCleanupStale(false);
      await fetchShortcuts();
      const removedCount = data.removedCount ?? 0;
      const preservedCount = data.afterCount ?? shortcuts.length;
      setActionFeedback({
        type: 'success',
        text: `Cleanup completed: ${removedCount} missing ${removedCount === 1 ? 'entry' : 'entries'} removed, ${preservedCount} valid ${preservedCount === 1 ? 'company' : 'companies'} kept. No files on disk were deleted.`,
      });
    } catch (err: any) {
      setConfirmCleanupStale(false);
      setActionFeedback({
        type: 'error',
        text: err?.message || 'Error running cleanup.',
      });
    } finally {
      setCleaningStale(false);
    }
  };

  const handleClearAllShortcutsOnly = async () => {
    setClearingAllShortcuts(true);
    setActionFeedback(null);
    try {
      const data = await apiFetch('/api/companies/shortcuts', {
        method: 'DELETE',
        body: { confirmClearShortcutsOnly: true } as any,
      });
      CompanyPreferenceService.clearLastSelectedCompany();
      setConfirmClearAllShortcuts(false);
      setCompanyToRemove(null);
      setShortcuts([]);
      setActionFeedback({
        type: 'success',
        text:
          data?.message ||
          'Saved list cleared. All physical company databases, backups, and documents remain safely intact on disk.',
      });
    } catch (err: any) {
      setConfirmClearAllShortcuts(false);
      setActionFeedback({
        type: 'error',
        text: err?.message || 'Failed to clear saved list.',
      });
    } finally {
      setClearingAllShortcuts(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] dark:bg-[#0B1120] py-6 sm:py-10 px-4 sm:px-6 transition-colors">
      <div className="w-full max-w-3xl mx-auto">
        {/* Top Bar */}
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate('/server/launcher')}
            className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-semibold text-xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Launcher</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/server/profile/restore')}
              className="bg-white dark:bg-[#11192B] border border-slate-200 dark:border-[#24344F] text-slate-700 dark:text-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#162238] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Restore from Backup</span>
            </button>

            {shortcuts.length > 0 && (
              <button
                type="button"
                data-testid="clear-all-shortcuts-btn"
                onClick={() => {
                  setActionFeedback(null);
                  setConfirmCleanupStale(false);
                  setConfirmClearAllShortcuts(true);
                }}
                title="Clears saved workspace shortcuts from this list only — company database files on disk are NOT deleted"
                className="text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 px-3 py-2 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear List Only</span>
              </button>
            )}

            {isOwner && shortcuts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActionFeedback(null);
                  setConfirmClearAllShortcuts(false);
                  setConfirmCleanupStale(true);
                }}
                className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 px-3 py-2 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
              >
                Clean Missing
              </button>
            )}
          </div>
        </div>

        {/* Global Feedback */}
        {actionFeedback && (
          <div
            className={`mb-5 p-4 rounded-2xl border flex items-center justify-between gap-4 text-xs font-medium ${
              actionFeedback.type === 'success'
                ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 border-teal-200 dark:border-teal-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{actionFeedback.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionFeedback(null)}
              className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {confirmClearAllShortcuts && (
          <div
            data-testid="confirm-clear-all-shortcuts-panel"
            className="mb-5 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-rose-900 dark:text-rose-100">
                  Clear all saved company shortcuts (databases stay safe)?
                </h4>
                <p className="text-xs text-rose-800 dark:text-rose-200 mt-1 leading-relaxed">
                  Removes all <strong>{shortcuts.length}</strong> entry/entries from this list only.{' '}
                  <strong>No physical company databases (.lai), backups, or documents on disk will be deleted.</strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
              <button
                type="button"
                data-testid="confirm-clear-all-shortcuts-btn"
                onClick={handleClearAllShortcutsOnly}
                disabled={clearingAllShortcuts}
                className="px-3.5 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                {clearingAllShortcuts ? 'Clearing...' : 'Confirm Clear List'}
              </button>
              <button
                type="button"
                data-testid="cancel-clear-all-shortcuts-btn"
                onClick={() => setConfirmClearAllShortcuts(false)}
                className="px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {confirmCleanupStale && (
          <div className="mb-5 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Remove missing company entries from list?
                </h4>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                  Removes only entries whose files were moved or deleted externally. Existing company files are untouched.
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCleanupStale}
                disabled={cleaningStale}
                className="px-3.5 py-2 bg-amber-600 text-white rounded-xl text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {cleaningStale ? 'Cleaning...' : 'Clean Missing'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCleanupStale(false)}
                className="px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Clean User-Friendly Heading */}
        <div className="mb-6">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2.5">
            <Building2 className="w-6 h-6 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>Open Existing Company</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Open a saved company workspace or browse an existing portable company folder directly — no backup archive required.
          </p>
        </div>

        {/* Open Existing Portable Company Folder (Standalone / Central Server Console Only) */}
        {isLocalHost ? (
        <div className="bg-white dark:bg-[#11192B] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] mb-7 space-y-4">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-blue-700 dark:text-sky-400 shrink-0" />
              <span>Open Portable Company Folder</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Select a portable company folder (local drive, USB, or migrated directory containing <code className="font-mono">database.lai</code>). To recover a <code className="font-mono">.lai</code>/<code className="font-mono">.lgb</code> backup archive, use <strong>Restore from Backup</strong> above.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="Browse or paste portable company folder path..."
              className="flex-1 px-3.5 py-2.5 min-h-[42px] bg-slate-50 dark:bg-[#0F172A] border border-slate-300/90 dark:border-[#24344F] rounded-xl text-slate-900 dark:text-slate-100 text-xs font-mono focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600 outline-none"
            />
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                data-testid="open-profile-browse-folder-btn"
                disabled={pickingFolder}
                onClick={handleBrowseCompanyFolder}
                className="flex-1 sm:flex-none bg-slate-100 dark:bg-[#162238] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#24344F] px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold hover:bg-slate-200 dark:hover:bg-[#1F2F4C] disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                {pickingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                <span>{pickingFolder ? 'Opening...' : 'Browse Company Folder'}</span>
              </button>
              <button
                type="button"
                data-testid="open-profile-verify-btn"
                onClick={() => handleRegisterFolder()}
                disabled={registeringFolder}
                className="flex-1 sm:flex-none bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                {registeringFolder ? 'Verifying...' : 'Verify & Open'}
              </button>
            </div>
          </div>

          {duplicateConflict && (
            <div
              role="alert"
              data-testid="duplicate-identity-conflict-panel"
              className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 space-y-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-950 dark:text-amber-100 space-y-1">
                  <p className="font-bold">Duplicate Company Identity Detected — Explicit Decision Required</p>
                  <p className="leading-relaxed">
                    Company <strong>{duplicateConflict.existingLegalName}</strong> (<code className="font-mono">{duplicateConflict.companyId}</code>) is already registered at another active folder. LedgerAI PH will never silently overwrite or merge duplicate copies.
                  </p>
                  <div className="font-mono text-[11px] bg-white/70 dark:bg-[#0F172A] p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/70 space-y-1">
                    <div>Registered: <strong>{duplicateConflict.existingLocation}</strong></div>
                    <div>Selected: <strong>{duplicateConflict.selectedLocation}</strong></div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  data-testid="conflict-keep-existing-btn"
                  onClick={() => setDuplicateConflict(null)}
                  className="px-3.5 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Keep Existing Registered Folder
                </button>
                <button
                  type="button"
                  data-testid="conflict-switch-selected-btn"
                  disabled={registeringFolder || importingPortable}
                  onClick={() => {
                    if (duplicateConflict.mode === 'PORTABLE_UPLOAD' && duplicateConflict.uploadedFiles) {
                      submitPortableUpload(duplicateConflict.uploadedFiles, 'SWITCH_REGISTRY_TO_SELECTED');
                    } else if (duplicateConflict.targetPath) {
                      handleRegisterFolder(duplicateConflict.targetPath, 'SWITCH_REGISTRY_TO_SELECTED');
                    }
                  }}
                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  Switch Registry to Selected Folder
                </button>
              </div>
            </div>
          )}

          {registerStatus && (
            <div
              className={`text-xs p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                registerStatus.success && registerStatus.tone !== 'warning'
                  ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 border-teal-200 dark:border-teal-800'
                  : registerStatus.tone === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
              }`}
            >
              <span className="font-medium leading-relaxed">{registerStatus.text}</span>
              <div className="flex items-center gap-2 shrink-0">
                {registerStatus.companyId && (
                  <button
                    type="button"
                    onClick={() => {
                      const vanity = getCompanyVanityDomain({
                        id: registerStatus.companyId!,
                        legalName: registerStatus.companyName,
                      });
                      navigate(`/server/${vanity}/login`);
                    }}
                    className="px-3.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <span>Open Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {registerStatus.code === 'BACKUP_FILE_NOT_WORKSPACE' && (
                  <button
                    type="button"
                    onClick={() => navigate('/server/profile/restore')}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    Open Restore Wizard &rarr;
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        ) : (
          <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-blue-200/80 dark:border-blue-900/60 mb-7 space-y-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Database className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">Connected to Central LedgerAI PH Server</p>
                  <p className="mt-0.5 leading-relaxed">
                    Select an authorized company workspace below, or securely upload a portable company folder from this device for server-side validation and registration.
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="import-portable-server-btn"
                disabled={pickingFolder || importingPortable}
                onClick={handleImportPortablePackageToServer}
                className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {importingPortable || pickingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{importingPortable ? 'Validating & Importing...' : 'Import Portable Folder'}</span>
              </button>
            </div>
            {duplicateConflict && (
              <div
                role="alert"
                data-testid="duplicate-identity-conflict-panel"
                className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 space-y-2.5"
              >
                <p className="font-bold text-amber-950 dark:text-amber-100">
                  Company "{duplicateConflict.existingLegalName}" ({duplicateConflict.companyId}) is already registered on this server.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDuplicateConflict(null)}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Keep Existing Server Company
                  </button>
                  <button
                    type="button"
                    disabled={importingPortable}
                    onClick={() =>
                      duplicateConflict.uploadedFiles &&
                      submitPortableUpload(duplicateConflict.uploadedFiles, 'SWITCH_REGISTRY_TO_SELECTED')
                    }
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Replace Server Package
                  </button>
                </div>
              </div>
            )}
            {registerStatus && (
              <div
                className={`text-xs p-3 rounded-xl border ${
                  registerStatus.success && registerStatus.tone !== 'warning'
                    ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 border-teal-200 dark:border-teal-800'
                    : registerStatus.tone === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
                }`}
              >
                {registerStatus.text}
              </div>
            )}
          </div>
        )}

        {/* Saved Companies List */}
        <div className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Saved Company Workspaces
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={fetchShortcuts}
                className="font-semibold text-blue-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                Refresh Status
              </button>
              <span className="font-mono text-slate-500 dark:text-slate-400 font-semibold">
                {shortcuts.length} {shortcuts.length === 1 ? 'Company' : 'Companies'}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-500 bg-white dark:bg-[#11192B] border border-slate-200/90 dark:border-[#1E2D45] rounded-2xl">
              <Clock className="w-7 h-7 animate-spin text-blue-600 dark:text-sky-400 mx-auto mb-2.5" />
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Checking saved company workspaces...
              </p>
            </div>
          ) : shortcuts.length === 0 ? (
            <div className="bg-white dark:bg-[#11192B] p-10 sm:p-12 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center">
              <Building2 className="w-11 h-11 text-slate-300 dark:text-slate-600 mx-auto mb-3.5" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                No Saved Companies Yet
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
                Create a new company profile, restore from an encrypted backup archive, or browse a folder above to get started.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate('/server/profile/create')}
                  className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Create New Company
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/server/profile/restore')}
                  className="px-4 py-2.5 bg-slate-100 dark:bg-[#162238] hover:bg-slate-200 dark:hover:bg-[#1F2F4C] text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Restore from Backup
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {shortcuts.map((c) => {
                const isConfirmingRemove = companyToRemove?.id === c.companyId;
                const isHealthy = c.availabilityStatus === 'AVAILABLE' && c.validationStatus === 'VALID';
                const isBusy = openingId === c.companyId;

                return (
                  <div
                    key={c.companyId}
                    className="bg-white dark:bg-[#11192B] p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex flex-col gap-3 hover:border-blue-300 dark:hover:border-sky-700/60 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-display font-bold text-slate-900 dark:text-slate-100 truncate text-base">
                            {c.displayName}
                          </h4>
                          <span
                            className={`text-[11px] font-semibold shrink-0 ${
                              isHealthy ? 'text-teal-700 dark:text-teal-400' : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isHealthy ? 'Ready' : 'Needs Location'}
                          </span>
                        </div>
                        {c.lastOpenedAt && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Last opened {new Date(c.lastOpenedAt).toLocaleDateString()}
                          </p>
                        )}
                        {c.lastValidationError && (
                          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1">
                            {c.lastValidationError}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isHealthy ? (
                          <button
                            type="button"
                            onClick={() => handleReopenCompany(c)}
                            disabled={isBusy}
                            data-testid={`open-workspace-${c.companyId}`}
                            className="flex-1 sm:flex-none bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white px-4 py-2.5 min-h-[40px] rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Open Workspace</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleLocateDatabase(c)}
                            disabled={isBusy || pickingFolder}
                            data-testid={`locate-db-${c.companyId}`}
                            className="flex-1 sm:flex-none bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2.5 min-h-[40px] rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Search className="w-3.5 h-3.5" />
                            <span>Locate Folder</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionFeedback(null);
                            setCompanyToRemove({
                              id: c.companyId,
                              name: c.displayName,
                              location: c.companyDirectory,
                            });
                          }}
                          data-testid={`unregister-btn-${c.companyId}`}
                          className="bg-slate-50 hover:bg-rose-50 dark:bg-[#162238] dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 p-2.5 min-h-[40px] rounded-xl border border-slate-200 dark:border-[#24344F] transition-colors cursor-pointer"
                          title="Remove from list only (company files remain safely on disk)"
                          aria-label={`Remove ${c.displayName} from list`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isConfirmingRemove && (
                      <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="text-xs text-amber-950 dark:text-amber-200 leading-relaxed">
                          <span className="font-bold">Remove from saved list?</span>{' '}
                          Removes <strong>{c.displayName}</strong> from this selector only. All company database files remain untouched on disk.
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            data-testid={`confirm-unregister-${c.companyId}`}
                            onClick={() => handleRemove(c.companyId)}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Remove from List
                          </button>
                          <button
                            type="button"
                            onClick={() => setCompanyToRemove(null)}
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}