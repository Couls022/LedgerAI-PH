import React, { useState, useRef } from 'react';
import {
  Key,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Building2,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  X,
  Download,
  FileCode,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface LicenseActivationProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  isModal?: boolean;
}

type ActivationUiState =
  | 'BOTH_FILES_MISSING'
  | 'LICENSE_KEY_FILE_SELECTED'
  | 'KEY_LICENSE_FILE_SELECTED'
  | 'BOTH_FILES_SELECTED'
  | 'VALIDATING_PAIR'
  | 'LICENSE_PAIR_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'LICENSE_ALREADY_REDEEMED'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_REVOKED'
  | 'COMPANY_IDENTITY_MISMATCH'
  | 'ACTIVATION_SUCCESSFUL'
  | 'ACTIVATION_FAILED';

const STATE_BADGE_MAP: Record<
  ActivationUiState,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'error' | 'success' }
> = {
  BOTH_FILES_MISSING: { label: 'Both files missing', tone: 'neutral' },
  LICENSE_KEY_FILE_SELECTED: { label: 'License Key File selected', tone: 'info' },
  KEY_LICENSE_FILE_SELECTED: { label: 'Key License File selected', tone: 'info' },
  BOTH_FILES_SELECTED: { label: 'Both files selected', tone: 'info' },
  VALIDATING_PAIR: { label: 'Validating license pair', tone: 'info' },
  LICENSE_PAIR_MISMATCH: { label: 'License pair mismatch', tone: 'error' },
  INVALID_SIGNATURE: { label: 'Invalid signature', tone: 'error' },
  LICENSE_ALREADY_REDEEMED: { label: 'License already redeemed', tone: 'error' },
  LICENSE_EXPIRED: { label: 'License expired', tone: 'error' },
  LICENSE_REVOKED: { label: 'License revoked', tone: 'error' },
  COMPANY_IDENTITY_MISMATCH: { label: 'Company identity mismatch', tone: 'error' },
  ACTIVATION_SUCCESSFUL: { label: 'Activation successful', tone: 'success' },
  ACTIVATION_FAILED: { label: 'Activation failed', tone: 'error' },
};

export default function LicenseActivation({ onSuccess, onCancel, isModal = false }: LicenseActivationProps) {
  const { activeCompany } = useAuth();

  // Required File 1: License Key File (.lkey)
  const [licenseKeyFileContent, setLicenseKeyFileContent] = useState('');
  const [keyFileName, setKeyFileName] = useState('');
  const [keyFileSize, setKeyFileSize] = useState('');
  const [isKeyDragOver, setIsKeyDragOver] = useState(false);

  // Required File 2: Key License File (.lai)
  const [keyLicenseFileContent, setKeyLicenseFileContent] = useState('');
  const [licenseFileName, setLicenseFileName] = useState('');
  const [licenseFileSize, setLicenseFileSize] = useState('');
  const [isLicDragOver, setIsLicDragOver] = useState(false);

  const [isActivating, setIsActivating] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [exportedLrq, setExportedLrq] = useState(false);
  const [activationErrorState, setActivationErrorState] = useState<ActivationUiState | null>(null);
  const [activationSucceeded, setActivationSucceeded] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; title: string; text: string } | null>(null);

  const keyFileInputRef = useRef<HTMLInputElement>(null);
  const licenseFileInputRef = useRef<HTMLInputElement>(null);

  const hasKeyFile = licenseKeyFileContent.trim().length > 0;
  const hasLicenseFile = keyLicenseFileContent.trim().length > 0;
  const bothFilesSelected = hasKeyFile && hasLicenseFile;

  const deriveUiState = (): ActivationUiState => {
    if (isActivating) return 'VALIDATING_PAIR';
    if (activationSucceeded) return 'ACTIVATION_SUCCESSFUL';
    if (activationErrorState) return activationErrorState;
    if (hasKeyFile && hasLicenseFile) return 'BOTH_FILES_SELECTED';
    if (hasKeyFile) return 'LICENSE_KEY_FILE_SELECTED';
    if (hasLicenseFile) return 'KEY_LICENSE_FILE_SELECTED';
    return 'BOTH_FILES_MISSING';
  };

  const currentUiState = deriveUiState();
  const stateMeta = STATE_BADGE_MAP[currentUiState];

  const handleExportLicenseRequest = async () => {
    if (!activeCompany?.id) {
      setStatusMsg({
        type: 'error',
        title: 'No Active Company',
        text: 'Please select an active company profile before exporting a license request.',
      });
      return;
    }

    try {
      const res = await fetch('/api/licensing/request', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Failed to generate license request');
      }
      const lrqJson = await res.text();
      const blob = new Blob([lrqJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LedgerAI-License-Request.lrq';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportedLrq(true);
      setTimeout(() => setExportedLrq(false), 4000);
    } catch {
      setStatusMsg({
        type: 'error',
        title: 'Export Failed',
        text: 'Unable to export official license request from server.',
      });
    }
  };

  const handleCopyCompanyId = () => {
    if (activeCompany?.id) {
      navigator.clipboard.writeText(activeCompany.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const processLicenseKeyFile = (file: File) => {
    if (!file) return;
    setActivationErrorState(null);
    setActivationSucceeded(false);
    setStatusMsg(null);

    if (!file.name.toLowerCase().endsWith('.lkey')) {
      setActivationErrorState('ACTIVATION_FAILED');
      setStatusMsg({
        type: 'error',
        title: 'Invalid License Key File Format',
        text: 'Only the officially supported License Key File format (.lkey) is accepted for this field.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      if (!content.trim()) {
        setLicenseKeyFileContent('');
        setKeyFileName('');
        setKeyFileSize('');
        setActivationErrorState('ACTIVATION_FAILED');
        setStatusMsg({
          type: 'error',
          title: 'Empty License Key File',
          text: 'Selected License Key File is empty.',
        });
        return;
      }
      setKeyFileName(file.name);
      setKeyFileSize(`${(file.size / 1024).toFixed(2)} KB`);
      setLicenseKeyFileContent(content);
    };
    reader.readAsText(file);
  };

  const processKeyLicenseFile = (file: File) => {
    if (!file) return;
    setActivationErrorState(null);
    setActivationSucceeded(false);
    setStatusMsg(null);

    if (!file.name.toLowerCase().endsWith('.lai')) {
      setActivationErrorState('ACTIVATION_FAILED');
      setStatusMsg({
        type: 'error',
        title: 'Invalid Key License File Format',
        text: 'Only the officially supported Key License File format (.lai) is accepted for this field.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      if (!content.trim()) {
        setKeyLicenseFileContent('');
        setLicenseFileName('');
        setLicenseFileSize('');
        setActivationErrorState('ACTIVATION_FAILED');
        setStatusMsg({
          type: 'error',
          title: 'Empty Key License File',
          text: 'Selected Key License File is empty.',
        });
        return;
      }
      setLicenseFileName(file.name);
      setLicenseFileSize(`${(file.size / 1024).toFixed(2)} KB`);
      setKeyLicenseFileContent(content);
    };
    reader.readAsText(file);
  };

  const clearKeyFile = () => {
    setKeyFileName('');
    setKeyFileSize('');
    setLicenseKeyFileContent('');
    setActivationErrorState(null);
    setActivationSucceeded(false);
    setStatusMsg(null);
    if (keyFileInputRef.current) keyFileInputRef.current.value = '';
  };

  const clearLicenseFile = () => {
    setLicenseFileName('');
    setLicenseFileSize('');
    setKeyLicenseFileContent('');
    setActivationErrorState(null);
    setActivationSucceeded(false);
    setStatusMsg(null);
    if (licenseFileInputRef.current) licenseFileInputRef.current.value = '';
  };

  const mapServerErrorToUiState = (code?: string): ActivationUiState => {
    switch (code) {
      case 'LICENSE_PAIR_MISMATCH':
        return 'LICENSE_PAIR_MISMATCH';
      case 'INVALID_SIGNATURE':
        return 'INVALID_SIGNATURE';
      case 'LICENSE_ALREADY_REDEEMED':
        return 'LICENSE_ALREADY_REDEEMED';
      case 'LICENSE_EXPIRED':
        return 'LICENSE_EXPIRED';
      case 'LICENSE_REVOKED':
        return 'LICENSE_REVOKED';
      case 'COMPANY_IDENTITY_MISMATCH':
        return 'COMPANY_IDENTITY_MISMATCH';
      default:
        return 'ACTIVATION_FAILED';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bothFilesSelected) {
      setActivationErrorState('ACTIVATION_FAILED');
      setStatusMsg({
        type: 'error',
        title: 'Both Files Required',
        text: 'Activation requires both the License Key File (.lkey) and the Key License File (.lai). One file is never sufficient.',
      });
      return;
    }

    setIsActivating(true);
    setActivationErrorState(null);
    setActivationSucceeded(false);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/licensing/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          licenseKeyFile: licenseKeyFileContent,
          keyLicenseFile: keyLicenseFileContent,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setActivationSucceeded(true);
        setStatusMsg({
          type: 'success',
          title: 'Activation successful',
          text:
            data.message ||
            'Both licensing files have been verified by the local licensing service. Company license is now ACTIVE.',
        });

        // Clear sensitive file buffers from browser memory once server confirms persistence
        setLicenseKeyFileContent('');
        setKeyLicenseFileContent('');
        window.dispatchEvent(new Event('refresh-license-banner'));

        if (onSuccess) {
          setTimeout(() => {
            onSuccess();
          }, 1200);
        }
      } else {
        const mappedState = mapServerErrorToUiState(data.code || data.error);
        setActivationErrorState(mappedState);
        setStatusMsg({
          type: 'error',
          title: STATE_BADGE_MAP[mappedState].label,
          text: data.message || data.error || 'Dual-file license activation failed.',
        });
      }
    } catch {
      setActivationErrorState('ACTIVATION_FAILED');
      setStatusMsg({
        type: 'error',
        title: 'Activation failed',
        text: 'Unable to reach the local licensing verification service.',
      });
    } finally {
      setIsActivating(false);
    }
  };

  const content = (
    <div className="space-y-5 text-slate-800 dark:text-slate-100">
      {/* Target Company ID Info Box & LRQ Export */}
      <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
            <Building2 className="w-3.5 h-3.5 text-indigo-500" /> Target Company Profile
          </span>
          <span
            data-testid="activation-ui-state"
            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
              stateMeta.tone === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                : stateMeta.tone === 'error'
                ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                : stateMeta.tone === 'info'
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800'
                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
            }`}
          >
            {stateMeta.label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-1.5 text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 overflow-x-auto truncate">
            {activeCompany?.id || 'No company selected'}
          </div>
          <button
            type="button"
            onClick={handleCopyCompanyId}
            className="px-3 py-1.5 text-xs font-medium bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors flex items-center gap-1 shrink-0"
          >
            {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedId ? 'Copied' : 'Copy ID'}
          </button>
        </div>

        {/* Export License Request Action */}
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-indigo-500" /> Official License Request
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Export a sanitized <code className="text-indigo-600 dark:text-indigo-400 font-mono">.lrq</code> file to obtain your matched dual-file license pair from the License Authority.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportLicenseRequest}
            className="px-3.5 py-1.5 text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 self-start sm:self-center"
          >
            {exportedLrq ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Download className="w-3.5 h-3.5" />}
            {exportedLrq ? 'LRQ Exported!' : 'Export License Request (.lrq)'}
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {statusMsg && (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div>
            <h4 className="font-bold mb-0.5">{statusMsg.title}</h4>
            <p className="leading-relaxed opacity-90">{statusMsg.text}</p>
          </div>
        </div>
      )}

      {/* Dual-File Activation Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* REQUIRED INPUT 1: License Key File (.lkey) */}
        <div>
          <label
            htmlFor="license-key-file-input"
            className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-500" />
              License Key File <span className="text-rose-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">Required (.lkey)</span>
          </label>

          {!keyFileName ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsKeyDragOver(true);
              }}
              onDragLeave={() => setIsKeyDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsKeyDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) processLicenseKeyFile(f);
              }}
              onClick={() => keyFileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                isKeyDragOver
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 bg-slate-50/50 dark:bg-slate-900/30'
              }`}
            >
              <Upload className="w-6 h-6 text-indigo-500/80 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Select the authorized License Key File
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                Official <code className="font-mono">.lkey</code> licensing key artifact
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-lg">
                  <Key className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 font-mono truncate">{keyFileName}</p>
                  <p className="text-[10px] text-indigo-700 dark:text-indigo-400 font-medium">
                    {keyFileSize} &bull; License Key File selected
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearKeyFile}
                className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors rounded-lg"
                title="Remove License Key File"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input
            id="license-key-file-input"
            ref={keyFileInputRef}
            type="file"
            accept=".lkey"
            required
            aria-label="License Key File"
            placeholder="Select the authorized License Key File"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processLicenseKeyFile(f);
            }}
            className="hidden"
          />
        </div>

        {/* REQUIRED INPUT 2: Key License File (.lai) */}
        <div>
          <label
            htmlFor="key-license-file-input"
            className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Key License File <span className="text-rose-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">Required (.lai)</span>
          </label>

          {!licenseFileName ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsLicDragOver(true);
              }}
              onDragLeave={() => setIsLicDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsLicDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) processKeyLicenseFile(f);
              }}
              onClick={() => licenseFileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                isLicDragOver
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400 bg-slate-50/50 dark:bg-slate-900/30'
              }`}
            >
              <Upload className="w-6 h-6 text-emerald-600/80 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Select the corresponding Key License File
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                Official <code className="font-mono">.lai</code> signed company authorization artifact
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 font-mono truncate">{licenseFileName}</p>
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                    {licenseFileSize} &bull; Key License File selected
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearLicenseFile}
                className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors rounded-lg"
                title="Remove Key License File"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input
            id="key-license-file-input"
            ref={licenseFileInputRef}
            type="file"
            accept=".lai"
            required
            aria-label="Key License File"
            placeholder="Select the corresponding Key License File"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processKeyLicenseFile(f);
            }}
            className="hidden"
          />
        </div>

        {/* Helper guidance when missing one or both files */}
        {!bothFilesSelected && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800/50 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Both the License Key File (.lkey) and the corresponding Key License File (.lai) are mandatory. Activation remains disabled until both files are selected.
          </p>
        )}

        {/* Action Buttons */}
        <div className="pt-3 flex gap-3 justify-end border-t border-slate-200 dark:border-slate-700">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!bothFilesSelected || isActivating}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center gap-2 cursor-pointer"
          >
            {isActivating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Validating license pair...
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" /> Activate License
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Dual-File Company License Activation
            </h3>
            {onCancel && (
              <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="p-6">{content}</div>
        </div>
      </div>
    );
  }

  return content;
}
