import React, { useState, useRef, useEffect } from 'react';
import { Key, Upload, FileText, CheckCircle2, AlertCircle, Building2, Copy, Check, Loader2, ShieldCheck, X, Download, FileCode } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface LicenseActivationProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  isModal?: boolean;
}

export default function LicenseActivation({ onSuccess, onCancel, isModal = false }: LicenseActivationProps) {
  const { activeCompany } = useAuth();
  const [activationKey, setActivationKey] = useState('');
  const [licenseFileContent, setLicenseFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [exportedLrq, setExportedLrq] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; title: string; text: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get or persist a stable installation ID
  const getInstallationId = () => {
    try {
      let instId = localStorage.getItem('ledgerai_installation_id');
      if (!instId) {
        const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
        instId = `LGR-INST-${randomPart}`;
        localStorage.setItem('ledgerai_installation_id', instId);
      }
      return instId;
    } catch (e) {
      return 'LGR-INST-SYS01';
    }
  };

  const handleExportLicenseRequest = () => {
    if (!activeCompany?.id) {
      setStatusMsg({
        type: 'error',
        title: 'No Active Company',
        text: 'Please select an active company profile before exporting a license request.'
      });
      return;
    }

    const installationId = getInstallationId();

    const requestPayload = {
      requestType: 'LEDGERAI_LICENSE_REQUEST',
      version: 1,
      companyId: activeCompany.id,
      companyName: activeCompany.legalName || 'Active Workspace',
      tin: (activeCompany as any).tin || 'N/A',
      requestedPlan: 'PRO',
      installationId,
      timestamp: new Date().toISOString()
    };

    const lrqJson = JSON.stringify(requestPayload, null, 2);
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
  };

  // State validation: Activate button enabled if EITHER activationKey OR licenseFileContent is provided
  const isFormValid = activationKey.trim().length > 0 || licenseFileContent.trim().length > 0;

  const handleCopyCompanyId = () => {
    if (activeCompany?.id) {
      navigator.clipboard.writeText(activeCompany.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const processFile = (file: File) => {
    if (!file) return;

    if (!file.name.endsWith('.lai') && !file.name.endsWith('.json')) {
      setStatusMsg({
        type: 'error',
        title: 'Invalid File Extension',
        text: 'Please upload the official ledgeria-ph.lai license artifact produced by the License Authority.'
      });
      return;
    }

    setFileName(file.name);
    setFileSize((file.size / 1024).toFixed(2) + ' KB');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      try {
        const parsed = JSON.parse(content);
        if (!parsed.payload || !parsed.signature) {
          setStatusMsg({
            type: 'error',
            title: 'Malformed Artifact Structure',
            text: 'The selected file is missing payload or cryptographic signature fields.'
          });
          setLicenseFileContent('');
          return;
        }

        setLicenseFileContent(content);
        setStatusMsg({
          type: 'success',
          title: 'License File Loaded',
          text: `Loaded signed license for company: ${parsed.payload.companyId || 'Unknown'} (${parsed.payload.planType || 'PRO'}). Ready to activate.`
        });

        // Auto-fill activation key if key field is empty and payload has activationKey
        if (!activationKey && parsed.payload.activationKey) {
          setActivationKey(parsed.payload.activationKey);
        }
      } catch (err) {
        setStatusMsg({
          type: 'error',
          title: 'Unparseable File',
          text: 'Selected file is not valid JSON or .lai license artifact.'
        });
        setLicenseFileContent('');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const clearFile = () => {
    setFileName('');
    setFileSize('');
    setLicenseFileContent('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      setStatusMsg({
        type: 'error',
        title: 'Missing License Artifact',
        text: 'Please provide either an Activation Key or upload a ledgeria-ph.lai license file.'
      });
      return;
    }

    setIsActivating(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/licensing/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activationKey: activationKey.trim() || undefined,
          licenseFile: licenseFileContent || undefined
        })
      });

      const data = await res.json();

      if (res.ok) {
        setStatusMsg({
          type: 'success',
          title: 'Activation Successful!',
          text: data.message || 'Cryptographic verification passed. Company license is now ACTIVE.'
        });
        
        window.dispatchEvent(new Event('refresh-license-banner'));

        if (onSuccess) {
          setTimeout(() => {
            onSuccess();
          }, 1200);
        }
      } else {
        setStatusMsg({
          type: 'error',
          title: 'Activation Rejected',
          text: data.error || 'Cryptographic verification failed. Please verify that your key or license file matches this company ID.'
        });
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        title: 'Connection Error',
        text: 'Unable to connect to activation service. Please verify server connection.'
      });
    } finally {
      setIsActivating(false);
    }
  };


  const content = (
    <div className="space-y-5 text-slate-800 dark:text-slate-100">
      {/* Target Company ID Info Box & LRQ Export */}
      <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
            <Building2 className="w-3.5 h-3.5 text-indigo-500" /> Target Company Profile
          </span>
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
            {activeCompany?.legalName || 'Active Workspace'}
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
              Export a sanitized <code className="text-indigo-600 dark:text-indigo-400 font-mono">.lrq</code> request file to send to your License Authority.
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
          className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div>
            <h4 className="font-bold mb-0.5">{statusMsg.title}</h4>
            <p className="leading-relaxed opacity-90">{statusMsg.text}</p>
          </div>
        </div>
      )}

      {/* Activation Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Artifact 1: Activation Key Input */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-500" />
              Option 1: Activation Key / Token
            </span>
            <span className="text-[11px] font-normal text-slate-400">Pasted string</span>
          </label>
          <input
            type="text"
            value={activationKey}
            onChange={(e) => setActivationKey(e.target.value.trim())}
            placeholder="e.g. LGR-PRO-xxxx or full signed token"
            className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1" />
          <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">OR</span>
          <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1" />
        </div>

        {/* Artifact 2: License File Input (.lai) */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              Option 2: License Key File (<code className="text-indigo-600 dark:text-indigo-400">ledgeria-ph.lai</code>)
            </span>
            <span className="text-[11px] font-normal text-slate-400">Cryptographic file</span>
          </label>

          {!fileName ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 bg-slate-50/50 dark:bg-slate-900/30'
              }`}
            >
              <Upload className="w-8 h-8 text-indigo-500/80 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Click to browse or drag & drop <span className="text-indigo-600 dark:text-indigo-400 font-mono">ledgeria-ph.lai</span>
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Signed cryptographic license file (.lai format)
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3.5 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 font-mono">{fileName}</p>
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5 font-medium">
                    {fileSize} • Valid cryptographic structure detected
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearFile}
                className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800"
                title="Remove file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".lai,.json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Form Validation State Helper Text */}
        {!isFormValid && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800/50 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Please provide either an Activation Key OR upload a .lai file to proceed.
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
            disabled={!isFormValid || isActivating}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center gap-2"
          >
            {isActivating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Verifying Cryptography...
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" /> Activate Company License
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
              Two-Artifact Company License Activation
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
