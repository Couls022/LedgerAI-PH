import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  User, Building2, Sun, Moon, Laptop, Check, Loader2, Sparkles, 
  CheckCircle2, Lock, AlertCircle, AlertTriangle, Key, Copy, 
  Database, Server, ShieldCheck, Mail, Shield, RefreshCw, ArrowRight, FolderOpen 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme, ThemeMode } from '../context/ThemeContext';
import { RoleBadge } from '../components/ProtectedRoute';
import LicenseActivation from '../components/licensing/LicenseActivation';
import EmailSettings from '../components/EmailSettings';
import AiSettings from '../components/AiSettings';
import { apiFetch } from '../utils/apiClient';
import { validateDirectoryPathSyntax } from '../../shared/folderPickerTypes';
import { NativeFolderPickerService } from '../services/nativeFolderPickerService';

type Tab = 'company' | 'license' | 'user' | 'email' | 'ai';

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, activeCompany, userRole, isAdmin, updateUser, refreshSession, hasPermission } = useAuth();
  const { theme, setTheme, isSyncing, syncSuccess, resolvedTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>(isAdmin ? 'company' : 'user');

  const showCompany = hasPermission('company:read') || hasPermission('company:write') || isAdmin;
  const showLicense = true;
  const showUser = true;
  const showEmail = hasPermission('settings:view') || hasPermission('settings:manage') || isAdmin;
  const showAi = hasPermission('settings:view') || hasPermission('settings:manage') || isAdmin;

  // Handle URL query parameters and redirect external submodule links
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam) {
      if (tabParam === 'company' && showCompany) setActiveTab('company');
      else if (tabParam === 'license' || tabParam === 'licenses' || tabParam === 'licensing') setActiveTab('license');
      else if (tabParam === 'user') setActiveTab('user');
      else if (tabParam === 'email' && showEmail) setActiveTab('email');
      else if (tabParam === 'ai' || tabParam === 'agent') setActiveTab('ai');
      // Direct canonical navigation for external enterprise modules to prevent duplicate embedded UI
      else if (tabParam === 'lan') navigate('/master-data/lan-network', { replace: true });
      else if (tabParam === 'backup') navigate('/master-data/backup-vault', { replace: true });
      else if (tabParam === 'roles' || tabParam === 'users') navigate('/master-data/rbac', { replace: true });
      else if (tabParam === 'periods') navigate('/accounting/periods', { replace: true });
      else if (tabParam === 'audit') navigate('/audit/logs', { replace: true });
    }
  }, [location.search, showCompany, showEmail, showAi, navigate]);

  // Safe fallback if active tab lacks permission
  useEffect(() => {
    if (activeTab === 'company' && !showCompany) setActiveTab('user');
    else if (activeTab === 'email' && !showEmail) setActiveTab('user');
    else if (activeTab === 'ai' && !showAi) setActiveTab('user');
  }, [activeTab, showCompany, showEmail, showAi]);

  // Company Settings Form State
  const [companyDetails, setCompanyDetails] = useState<any>(null);
  const [legalName, setLegalName] = useState(activeCompany?.legalName || '');
  const [tradeName, setTradeName] = useState(activeCompany?.legalName || '');
  const [tin, setTin] = useState('');
  const [address, setAddress] = useState('');
  const [branchCode, setBranchCode] = useState('00000');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [industry, setIndustry] = useState('');
  const [taxpayerClassification, setTaxpayerClassification] = useState('CORPORATION');
  const [vatStatus, setVatStatus] = useState('VAT');
  const [rdoCode, setRdoCode] = useState('039');
  const [birRegistrationNo, setBirRegistrationNo] = useState('');
  const [birDateRegistered, setBirDateRegistered] = useState('');
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [accountingMethod, setAccountingMethod] = useState('ACCRUAL');
  const [documentLocationPath, setDocumentLocationPath] = useState('');
  const [backupLocationPath, setBackupLocationPath] = useState('');
  const [pickingFolderTarget, setPickingFolderTarget] = useState<'document' | 'backup' | null>(null);
  const [folderFeedback, setFolderFeedback] = useState<{
    target: 'document' | 'backup';
    type: 'info' | 'warning' | 'error' | 'success';
    text: string;
  } | null>(null);

  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [licenseStatus, setLicenseStatus] = useState<any>(null);
  const [copiedCompanyId, setCopiedCompanyId] = useState(false);
  const [resetPanelOpen, setResetPanelOpen] = useState(false);
  const [resetScope, setResetScope] = useState<'SYNTHETIC_ONLY' | 'CURRENT_COMPANY'>('SYNTHETIC_ONLY');
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchCompanyDetails = async () => {
    try {
      const data = await apiFetch('/api/companies/current/details');
      setCompanyDetails(data);
      if (data.legalName) setLegalName(data.legalName);
      if (data.tradeName) setTradeName(data.tradeName);
      if (data.tin) setTin(data.tin);
      if (data.address) setAddress(data.address);
      if (data.branchCode) setBranchCode(data.branchCode);
      if (data.contactPerson) setContactPerson(data.contactPerson);
      if (data.contactEmail) setContactEmail(data.contactEmail);
      if (data.contactPhone) setContactPhone(data.contactPhone);
      if (data.industry) setIndustry(data.industry);
      if (data.taxpayerClassification) setTaxpayerClassification(data.taxpayerClassification);
      if (data.vatStatus) setVatStatus(data.vatStatus);
      if (data.rdoCode) setRdoCode(data.rdoCode);
      if (data.birRegistrationNo) setBirRegistrationNo(data.birRegistrationNo);
      if (data.birDateRegistered) setBirDateRegistered(data.birDateRegistered);
      if (data.fiscalYear) setFiscalYear(data.fiscalYear);
      if (data.accountingMethod) setAccountingMethod(data.accountingMethod);
      if (data.documentLocationPath) setDocumentLocationPath(data.documentLocationPath);
      if (data.backupLocationPath) setBackupLocationPath(data.backupLocationPath);
    } catch (err) {
      console.error('Failed to fetch company details', err);
    }
  };

  const fetchLicenseStatus = async () => {
    try {
      const data = await apiFetch(`/api/licensing/status?t=${Date.now()}`);
      setLicenseStatus(data);
      window.dispatchEvent(new Event('refresh-license-banner'));
    } catch (e) {}
  };

  const getCanonicalLicenseState = (lic: any): 'NOT ACTIVATED' | 'ACTIVATED' | 'GRACE_PERIOD' | 'EXPIRED' | 'REVOKED' | 'REACTIVATION REQUIRED' => {
    if (!lic || lic.status === 'NO_COMPANY') return 'NOT ACTIVATED';
    if (lic.status === 'REVOKED') return 'REVOKED';
    if (lic.needsReactivation) return 'REACTIVATION REQUIRED';
    if (lic.inGracePeriod || lic.status === 'GRACE_PERIOD') return 'GRACE_PERIOD';
    if (lic.status === 'EXPIRED') return 'EXPIRED';
    if (!lic.isLifetime && lic.expirationDate && lic.expirationDate !== 'LIFETIME') {
      const expTime = new Date(lic.expirationDate).getTime();
      const graceEndTime = expTime + 15 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      if (now > graceEndTime) return 'EXPIRED';
      if (now > expTime) return 'GRACE_PERIOD';
    }
    if (lic.status === 'ACTIVE' || lic.status === 'ACTIVATED') return 'ACTIVATED';
    return 'NOT ACTIVATED';
  };

  useEffect(() => {
    fetchCompanyDetails();
    fetchLicenseStatus();
  }, [activeCompany?.id]);

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setIsSavingCompany(true);
    setCompanyMsg(null);
    try {
      await apiFetch('/api/companies/current/settings', {
        method: 'PUT',
        body: { 
          legalName, 
          tradeName, 
          tin, 
          address, 
          branchCode, 
          contactPerson, 
          contactEmail, 
          contactPhone, 
          industry, 
          taxpayerClassification, 
          vatStatus, 
          rdoCode, 
          birRegistrationNo, 
          birDateRegistered, 
          fiscalYear, 
          accountingMethod, 
          documentLocationPath, 
          backupLocationPath 
        } as any,
      });
      setCompanyMsg({ type: 'success', text: 'Company profile and parameters updated successfully' });
      fetchCompanyDetails();
      await refreshSession();
    } catch (err: any) {
      setCompanyMsg({ type: 'error', text: err.message || 'Error saving settings' });
    } finally {
      setIsSavingCompany(false);
    }
  };

  const docPathSyntax = documentLocationPath ? validateDirectoryPathSyntax(documentLocationPath) : { valid: true, normalizedPath: '' };
  const backupPathSyntax = backupLocationPath ? validateDirectoryPathSyntax(backupLocationPath) : { valid: true, normalizedPath: '' };

  const handleChooseSettingsFolder = async (target: 'document' | 'backup') => {
    if (!isAdmin || pickingFolderTarget !== null) return;
    setPickingFolderTarget(target);
    setFolderFeedback(null);
    try {
      const result = await NativeFolderPickerService.selectDirectory({
        title: target === 'document' ? 'Select Document Storage Folder' : 'Select Backup Folder',
        defaultPath: target === 'document' ? documentLocationPath : backupLocationPath,
        purpose: target === 'document' ? 'DOCUMENT_STORAGE' : 'BACKUP',
        requireWrite: true,
        companyId: activeCompany?.id,
      });

      if (result.status === 'SELECTED' && result.path) {
        if (target === 'document') {
          setDocumentLocationPath(result.path);
        } else {
          setBackupLocationPath(result.path);
        }
        setFolderFeedback({
          target,
          type: result.validation?.warnings?.length ? 'warning' : 'success',
          text:
            result.validation?.warnings?.[0] ||
            (result.folderName
              ? `Selected "${result.folderName}" via OS folder picker. Click Save Company Settings to apply.`
              : 'Folder verified. Click Save Company Settings to apply.'),
        });
      } else if (result.status === 'CANCELLED') {
        // Preserve existing folder configuration
      } else if (result.status === 'UNSUPPORTED_RUNTIME') {
        setFolderFeedback({
          target,
          type: 'info',
          text:
            result.message ||
            'This environment does not expose a native OS folder dialog. Enter or paste a validated directory path below.',
        });
      } else if (result.status === 'ERROR') {
        setFolderFeedback({
          target,
          type: 'error',
          text: result.message || 'Selected directory could not be validated. Existing path preserved.',
        });
      }
    } finally {
      setPickingFolderTarget(null);
    }
  };

  const handleThemeChange = async (newTheme: ThemeMode) => {
    await setTheme(newTheme, true);
    if (user) {
      updateUser({ theme: newTheme });
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#111827] p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">
            <Building2 className="w-4 h-4" />
            <span>Master Data & System Administration</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">Company Profile & System Settings</h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Manage company registration, cryptographic licensing, personal appearance, and system communication services.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Current Role:</span>
          <RoleBadge role={userRole} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Navigation Sidebar */}
        <div className="space-y-2">
          {showCompany && (
            <button
              type="button"
              onClick={() => setActiveTab('company')}
              className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border cursor-pointer ${
                activeTab === 'company' 
                  ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/50 text-indigo-600 dark:text-indigo-400 font-semibold' 
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Building2 className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'company' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Company Profile & BIR</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">TIN, legal identity & storage paths</p>
              </div>
            </button>
          )}

          {showLicense && (
            <button
              type="button"
              onClick={() => setActiveTab('license')}
              className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border cursor-pointer ${
                activeTab === 'license' 
                  ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/50 text-indigo-600 dark:text-indigo-400 font-semibold' 
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Key className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'license' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">License & CAS Authority</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Cryptographic activation & status</p>
              </div>
            </button>
          )}

          {showUser && (
            <button
              type="button"
              onClick={() => setActiveTab('user')}
              className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border cursor-pointer ${
                activeTab === 'user' 
                  ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/50 text-indigo-600 dark:text-indigo-400 font-semibold' 
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <User className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'user' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">User Profile & Appearance</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Theme settings & personal profile</p>
              </div>
            </button>
          )}

          {showEmail && (
            <button
              type="button"
              onClick={() => setActiveTab('email')}
              className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border cursor-pointer ${
                activeTab === 'email' 
                  ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/50 text-indigo-600 dark:text-indigo-400 font-semibold' 
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Mail className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'email' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Email Notifications</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">SMTP server & delivery configuration</p>
              </div>
            </button>
          )}

          {showAi && (
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border cursor-pointer ${
                activeTab === 'ai' 
                  ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/50 text-indigo-600 dark:text-indigo-400 font-semibold' 
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'ai' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Ledger Agent AI</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Configure AI reasoning & OCR engine</p>
              </div>
            </button>
          )}

          {/* Canonical Enterprise Workspaces Navigation Panel (Direct Non-Duplicated Access) */}
          <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="px-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Administration Workspaces
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Authoritative standalone modules in ERP sidebar:
              </p>
            </div>

            <Link
              to="/master-data/rbac"
              className="w-full text-left flex items-center justify-between p-3 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-900/40 hover:bg-purple-50/60 dark:hover:bg-purple-950/30 border border-slate-200/80 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-800 text-slate-700 dark:text-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-slate-200">Role & Access Matrix</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">User accounts & module assignments</span>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-purple-600 transition-colors" />
            </Link>

            <Link
              to="/master-data/backup-vault"
              className="w-full text-left flex items-center justify-between p-3 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-900/40 hover:bg-sky-50/60 dark:hover:bg-sky-950/30 border border-slate-200/80 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-800 text-slate-700 dark:text-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <Database className="w-4 h-4 text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-slate-200">Database Vault & Recovery</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">Snapshots, integrity & point-in-time</span>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-colors" />
            </Link>

            <Link
              to="/master-data/lan-network"
              className="w-full text-left flex items-center justify-between p-3 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-900/40 hover:bg-teal-50/60 dark:hover:bg-teal-950/30 border border-slate-200/80 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-800 text-slate-700 dark:text-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <Server className="w-4 h-4 text-teal-600 dark:text-teal-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-slate-200">Multi-Workstation LAN</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">Local node server & device concurrency</span>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-teal-600 transition-colors" />
            </Link>
          </div>
        </div>

        {/* Main Details Panel */}
        <div className="md:col-span-2 space-y-6">

          {/* TAB 1: COMPANY PROFILE & TAX REGISTRATION */}
          {activeTab === 'company' && showCompany && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                    <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Company Profile & Tax Registration
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage registration details for {activeCompany?.legalName}.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/audit/logs"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> View Audit Trail
                  </Link>
                  {!isAdmin && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-semibold rounded-full border border-amber-200 dark:border-amber-800">
                      <Lock className="w-3 h-3" /> Read-Only ({userRole})
                    </span>
                  )}
                </div>
              </div>

              {companyMsg && (
                <div className={`p-3 rounded-lg text-sm ${companyMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  {companyMsg.text}
                </div>
              )}

              <form onSubmit={handleSaveCompany} className="space-y-6 max-w-2xl">
                {/* Read-Only Unique Company ID */}
                <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Unique Company ID (Immutable Read-Only)
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      readOnly 
                      disabled
                      value={activeCompany?.id || companyDetails?.id || ''} 
                      className="flex-1 px-3 py-2 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none"
                    />
                    <button 
                      type="button"
                      onClick={() => navigator.clipboard.writeText(activeCompany?.id || companyDetails?.id || '')}
                      className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-300 transition-colors"
                    >
                      Copy ID
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">This ID is permanently bound to this company's isolated database environment.</p>
                </div>

                {/* Identity & Contacts */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Legal Name</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={legalName} 
                      onChange={e => setLegalName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Trade Name / Brand</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={tradeName} 
                      onChange={e => setTradeName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">TIN</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={tin} 
                      onChange={e => setTin(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Branch Code</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={branchCode} 
                      onChange={e => setBranchCode(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Industry</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={industry} 
                      onChange={e => setIndustry(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Person</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={contactPerson} 
                      onChange={e => setContactPerson(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Email</label>
                    <input 
                      type="email" 
                      disabled={!isAdmin} 
                      value={contactEmail} 
                      onChange={e => setContactEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Phone</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={contactPhone} 
                      onChange={e => setContactPhone(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Business Address</label>
                  <textarea 
                    disabled={!isAdmin} 
                    rows={2}
                    value={address} 
                    onChange={e => setAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                  />
                </div>

                {/* BIR Tax Compliance Mapping */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-200 dark:border-slate-700 pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Taxpayer Classification</label>
                    <select 
                      disabled={!isAdmin}
                      value={taxpayerClassification} 
                      onChange={e => setTaxpayerClassification(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                    >
                      <option value="CORPORATION">Corporation (BIR Form 1702-RT)</option>
                      <option value="INDIVIDUAL">Individual / Sole Proprietor (BIR Form 1701 / 1701A)</option>
                      <option value="PARTNERSHIP">General Professional Partnership (GPP)</option>
                      <option value="OPC">One Person Corporation (OPC)</option>
                      <option value="NON_PROFIT">Non-Profit / NGO (Tax-Exempt Entity)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">VAT Status</label>
                    <select 
                      disabled={!isAdmin}
                      value={vatStatus} 
                      onChange={e => setVatStatus(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                    >
                      <option value="VAT">Value-Added Tax (VAT) Registered - 12%</option>
                      <option value="NON_VAT">Non-VAT Registered (Percentage Tax - Form 2551Q / 3%)</option>
                      <option value="EXEMPT">VAT Exempt / Non-Taxable Seller</option>
                      <option value="BMBE">BMBE Registered (Barangay Micro Business Enterprise)</option>
                      <option value="PEZA_BOI">PEZA / BOI Registered (Ecozone Tax Exempt)</option>
                      <option value="ZERO_RATED">Zero-Rated / Exempt Export Taxpayer (0% VAT)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">RDO Code</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={rdoCode} 
                      onChange={e => setRdoCode(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">BIR Registration No. (COR)</label>
                    <input 
                      type="text" 
                      disabled={!isAdmin} 
                      value={birRegistrationNo} 
                      onChange={e => setBirRegistrationNo(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                  </div>
                </div>

                {/* Storage & Backup Paths */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label htmlFor="settings-document-folder" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Document Storage Folder
                      </label>
                      {isAdmin && (
                        <button
                          type="button"
                          data-testid="settings-choose-document-folder-btn"
                          disabled={pickingFolderTarget !== null}
                          onClick={() => handleChooseSettingsFolder('document')}
                          className="text-xs font-semibold text-blue-700 dark:text-sky-400 bg-white dark:bg-[#162238] hover:bg-blue-50 dark:hover:bg-[#1B2942] disabled:opacity-60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#24344F] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          title="Choose Document Storage Folder"
                        >
                          {pickingFolderTarget === 'document' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FolderOpen className="w-3.5 h-3.5" />
                          )}
                          <span>{pickingFolderTarget === 'document' ? 'Opening Dialog...' : 'Choose Folder'}</span>
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="settings-document-folder"
                        type="text"
                        disabled={!isAdmin}
                        value={documentLocationPath}
                        onChange={(e) => {
                          setFolderFeedback(null);
                          setDocumentLocationPath(e.target.value);
                        }}
                        className={`w-full px-3 py-2 pr-9 bg-slate-50 dark:bg-slate-900 border rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200 ${
                          !docPathSyntax.valid
                            ? 'border-rose-500'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      />
                      {documentLocationPath && docPathSyntax.valid && (
                        <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      )}
                    </div>
                    {!docPathSyntax.valid && (
                      <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{docPathSyntax.message}</p>
                    )}
                    {folderFeedback?.target === 'document' && (
                      <div
                        role="status"
                        className={`mt-1.5 p-2 rounded-lg border text-xs flex items-start gap-1.5 ${
                          folderFeedback.type === 'error'
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                            : folderFeedback.type === 'warning'
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : folderFeedback.type === 'success'
                                ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{folderFeedback.text}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label htmlFor="settings-backup-folder" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Backup Folder
                      </label>
                      {isAdmin && (
                        <button
                          type="button"
                          data-testid="settings-choose-backup-folder-btn"
                          disabled={pickingFolderTarget !== null}
                          onClick={() => handleChooseSettingsFolder('backup')}
                          className="text-xs font-semibold text-blue-700 dark:text-sky-400 bg-white dark:bg-[#162238] hover:bg-blue-50 dark:hover:bg-[#1B2942] disabled:opacity-60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#24344F] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          title="Choose Backup Folder"
                        >
                          {pickingFolderTarget === 'backup' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FolderOpen className="w-3.5 h-3.5" />
                          )}
                          <span>{pickingFolderTarget === 'backup' ? 'Opening Dialog...' : 'Choose Folder'}</span>
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="settings-backup-folder"
                        type="text"
                        disabled={!isAdmin}
                        value={backupLocationPath}
                        onChange={(e) => {
                          setFolderFeedback(null);
                          setBackupLocationPath(e.target.value);
                        }}
                        className={`w-full px-3 py-2 pr-9 bg-slate-50 dark:bg-slate-900 border rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200 ${
                          !backupPathSyntax.valid
                            ? 'border-rose-500'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      />
                      {backupLocationPath && backupPathSyntax.valid && (
                        <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      )}
                    </div>
                    {!backupPathSyntax.valid && (
                      <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{backupPathSyntax.message}</p>
                    )}
                    {folderFeedback?.target === 'backup' && (
                      <div
                        role="status"
                        className={`mt-1.5 p-2 rounded-lg border text-xs flex items-start gap-1.5 ${
                          folderFeedback.type === 'error'
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                            : folderFeedback.type === 'warning'
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : folderFeedback.type === 'success'
                                ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{folderFeedback.text}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setActiveTab('license')}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <Key className="w-3.5 h-3.5" /> Check License Status &rarr;
                  </button>

                  {isAdmin ? (
                    <button 
                      type="submit" 
                      disabled={isSavingCompany}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {isSavingCompany && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save Company Settings
                    </button>
                  ) : (
                    <p className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                      Editing requires <strong>Company Administrator</strong> or Owner role.
                    </p>
                  )}
                </div>
              </form>

              {/* Danger Zone: Tenant-Safe Data Maintenance & Reset */}
              {userRole === 'Company Owner' && (
                <div className="mt-8 pt-6 border-t border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-6 rounded-2xl space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-red-800 dark:text-red-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Danger Zone: Workspace Reset & Synthetic Data Purge
                    </h3>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Purge disposable synthetic stress-test datasets or reset only the current active company workspace. Protected pilot and other tenants&apos; workspaces are never affected.
                    </p>
                  </div>

                  {resetFeedback && (
                    <div className={`p-3 rounded-xl border text-xs font-semibold ${
                      resetFeedback.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                    }`}>
                      {resetFeedback.text}
                    </div>
                  )}

                  {!resetPanelOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setResetFeedback(null);
                        setResetConfirmText('');
                        setResetPanelOpen(true);
                      }}
                      className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm cursor-pointer flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" /> Configure Workspace Reset...
                    </button>
                  ) : (
                    <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 space-y-4">
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">Reset Scope</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={() => setResetScope('SYNTHETIC_ONLY')}
                            className={`p-3 rounded-xl border text-left text-xs transition-all ${
                              resetScope === 'SYNTHETIC_ONLY'
                                ? 'border-red-500 bg-red-50/70 dark:bg-red-950/40 text-red-900 dark:text-red-200 font-bold'
                                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div>Purge Synthetic / Stress-Test Data Only</div>
                            <div className="text-[11px] font-normal opacity-80 mt-0.5">Preserves all Production &amp; Pilot workspaces.</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResetScope('CURRENT_COMPANY')}
                            className={`p-3 rounded-xl border text-left text-xs transition-all ${
                              resetScope === 'CURRENT_COMPANY'
                                ? 'border-red-500 bg-red-50/70 dark:bg-red-950/40 text-red-900 dark:text-red-200 font-bold'
                                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div>Reset Current Active Company Only</div>
                            <div className="text-[11px] font-normal opacity-80 mt-0.5">Deletes only {activeCompany?.legalName}; other tenants remain intact.</div>
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Type <code className="font-mono font-bold text-red-600">CONFIRM RESET</code> to authorize
                        </label>
                        <input
                          type="text"
                          value={resetConfirmText}
                          onChange={(e) => setResetConfirmText(e.target.value)}
                          placeholder="CONFIRM RESET"
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isResetting || resetConfirmText.trim() !== 'CONFIRM RESET'}
                          onClick={async () => {
                            setIsResetting(true);
                            setResetFeedback(null);
                            try {
                              const data = await apiFetch('/api/companies/factory-reset', {
                                method: 'POST',
                                body: {
                                  confirmFactoryReset: true,
                                  scope: resetScope,
                                  reason: `Company Owner authorized ${resetScope} reset via Settings UI`,
                                } as any,
                              });
                              setResetPanelOpen(false);
                              setResetConfirmText('');
                              setResetFeedback({
                                type: 'success',
                                text: data.message || 'Workspace reset completed.',
                              });
                              if (resetScope === 'CURRENT_COMPANY') {
                                localStorage.removeItem('ledgerai_last_company_id');
                                navigate('/launcher?switch=1');
                              }
                            } catch (err: any) {
                              setResetFeedback({
                                type: 'error',
                                text: err?.message || 'Workspace reset failed.',
                              });
                            } finally {
                              setIsResetting(false);
                            }
                          }}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
                        >
                          {isResetting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Execute Authorized Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetPanelOpen(false);
                            setResetConfirmText('');
                          }}
                          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SOFTWARE LICENSE & CAS AUTHORITY */}
          {activeTab === 'license' && showLicense && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8 space-y-6">
              <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                  <Key className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> Software License & CAS Authority
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Manage cryptographic license activation, CAS/CBA authority verification, and enterprise entitlement status.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Unique Company ID (Read-only)
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      readOnly 
                      disabled
                      value={activeCompany?.id || ''} 
                      className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none cursor-not-allowed font-mono text-xs"
                    />
                    <button 
                      type="button"
                      onClick={() => {
                        if (activeCompany?.id) {
                          navigator.clipboard.writeText(activeCompany.id);
                          setCopiedCompanyId(true);
                          setTimeout(() => setCopiedCompanyId(false), 2000);
                        }
                      }}
                      className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex items-center gap-1.5"
                    >
                      {copiedCompanyId ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedCompanyId ? 'Copied!' : 'Copy ID'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    This ID is automatically generated and immutable. Provide this to your License Authority.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">License Status</label>
                  {(() => {
                    const canonical = getCanonicalLicenseState(licenseStatus);
                    let badgeStyle = 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400';
                    let text = 'NOT ACTIVATED';
                    let Icon = AlertCircle;

                    if (canonical === 'ACTIVATED') {
                      badgeStyle = 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400';
                      text = `ACTIVATED (${licenseStatus?.planType || 'ENTERPRISE'} PLAN)`;
                      Icon = CheckCircle2;
                    } else if (canonical === 'GRACE_PERIOD') {
                      badgeStyle = 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300';
                      text = `GRACE PERIOD (${licenseStatus?.graceDaysRemaining ?? 15} DAYS REMAINING)`;
                      Icon = AlertTriangle;
                    } else if (canonical === 'REACTIVATION REQUIRED') {
                      badgeStyle = 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-400';
                      text = 'REACTIVATION REQUIRED (HARDWARE CHANGE)';
                      Icon = AlertCircle;
                    } else if (canonical === 'EXPIRED') {
                      badgeStyle = 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400';
                      text = 'EXPIRED';
                      Icon = AlertCircle;
                    } else if (canonical === 'REVOKED') {
                      badgeStyle = 'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/40 dark:border-rose-800 dark:text-rose-300';
                      text = 'REVOKED';
                      Icon = AlertCircle;
                    }

                    let daysRemaining: number | null = null;
                    const isLifetime = Boolean(
                      licenseStatus?.isLifetime === true ||
                      licenseStatus?.isLifetime === 'true' ||
                      licenseStatus?.expirationDate === 'LIFETIME'
                    );

                    if (licenseStatus?.expirationDate && !isLifetime && typeof licenseStatus.expirationDate === 'string' && licenseStatus.expirationDate !== 'LIFETIME') {
                      try {
                        const expDate = new Date(licenseStatus.expirationDate);
                        if (!isNaN(expDate.getTime())) {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const expZero = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());
                          const diffMs = expZero.getTime() - today.getTime();
                          daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        }
                      } catch (err) {
                        daysRemaining = null;
                      }
                    }

                    const isExpiringSoon = 
                      canonical === 'ACTIVATED' &&
                      !isLifetime &&
                      daysRemaining !== null &&
                      !isNaN(daysRemaining) &&
                      daysRemaining >= 0 && 
                      daysRemaining <= 30;

                    return (
                      <div className="space-y-2">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${badgeStyle}`}>
                          <Icon className="w-4 h-4" />
                          {text}
                        </div>
                        {licenseStatus?.expirationDate && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Expiration Date: <span className="font-semibold">{licenseStatus.expirationDate}</span> {licenseStatus.isLifetime ? '(Lifetime License)' : ''}
                          </p>
                        )}
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Licensed Workstation Seats: <span className="font-semibold text-slate-800 dark:text-slate-200">{licenseStatus?.seatCount === 'UNLIMITED' || licenseStatus?.planType === 'ENTERPRISE' ? 'Unlimited Workstations (Enterprise Plan)' : `${licenseStatus?.seatCount || 3} Concurrent Workstations (Pro Plan)`}</span>
                        </p>
                        {canonical === 'GRACE_PERIOD' && (
                          <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 flex items-start gap-3 mt-2">
                            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-100">
                                Trial Expired — 15 Days Grace Period Active
                              </h4>
                              <p className="text-xs mt-0.5 leading-relaxed">
                                Your 15-day free trial has expired. You have <span className="font-bold underline">{licenseStatus?.graceDaysRemaining ?? 15} day(s) remaining</span> in your grace period (Lock Date: {licenseStatus?.graceExpirationDate || 'soon'}). Please import a license key below before this period ends to prevent complete workspace lockout.
                              </p>
                            </div>
                          </div>
                        )}
                        {isExpiringSoon && (
                          <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 flex items-start gap-3 mt-2">
                            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-100">License Expiring Soon</h4>
                              <p className="text-xs mt-0.5 leading-relaxed">
                                Your active license will expire in <span className="font-bold">{daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}</span>. Please import an updated license key to ensure uninterrupted compliance reporting.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 mb-4">Import Cryptographic License</h3>
                <LicenseActivation onSuccess={() => fetchLicenseStatus()} />
              </div>
            </div>
          )}

          {/* TAB 3: USER PROFILE & APPEARANCE */}
          {activeTab === 'user' && showUser && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8 space-y-8">
              <div>
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <User className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> User Profile & Preferences
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure your personal account preferences and theme mode.</p>
                  </div>
                  {isSyncing && (
                    <span className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1 rounded-full font-medium border border-indigo-200 dark:border-indigo-800">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                    </span>
                  )}
                  {syncSuccess && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 rounded-full font-medium border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Saved to Profile
                    </span>
                  )}
                </div>

                {/* Account Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Display Name</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">{user?.displayName || 'Unknown User'}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Email Address</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">{user?.email || 'N/A'}</p>
                  </div>
                </div>

                {/* Visual Theme Mode */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" /> Interface Theme
                    </h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      Active: <strong className="text-slate-700 dark:text-slate-300 capitalize">{resolvedTheme} Mode</strong>
                    </span>
                  </div>
                  
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Choose your preferred visual theme. Your selection is automatically synced with your profile settings.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <button
                      type="button"
                      onClick={() => handleThemeChange('light')}
                      className={`relative flex flex-col items-center p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        theme === 'light'
                          ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                      }`}
                    >
                      {theme === 'light' && (
                        <span className="absolute top-3 right-3 text-indigo-600 bg-indigo-100 p-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center mb-3 shrink-0">
                        <Sun className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Light Mode</span>
                      <span className="text-[11px] text-slate-500 text-center mt-1">High contrast clarity</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleThemeChange('dark')}
                      className={`relative flex flex-col items-center p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        theme === 'dark'
                          ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                      }`}
                    >
                      {theme === 'dark' && (
                        <span className="absolute top-3 right-3 text-indigo-600 bg-indigo-100 p-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <div className="w-10 h-10 rounded-lg bg-indigo-950 text-indigo-400 flex items-center justify-center mb-3 shrink-0">
                        <Moon className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Dark Mode</span>
                      <span className="text-[11px] text-slate-500 text-center mt-1">Reduced eye strain</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleThemeChange('system')}
                      className={`relative flex flex-col items-center p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        theme === 'system'
                          ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                      }`}
                    >
                      {theme === 'system' && (
                        <span className="absolute top-3 right-3 text-indigo-600 bg-indigo-100 p-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center mb-3 shrink-0">
                        <Laptop className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">System Match</span>
                      <span className="text-[11px] text-slate-500 text-center mt-1">Sync with OS appearance</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: EMAIL & SMTP NOTIFICATIONS */}
          {activeTab === 'email' && showEmail && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8">
              <EmailSettings />
            </div>
          )}

          {/* TAB 5: LEDGER AGENT & AI INTELLIGENCE */}
          {activeTab === 'ai' && showAi && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8">
              <AiSettings />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
