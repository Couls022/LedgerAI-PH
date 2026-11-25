import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ArrowLeft, CheckCircle2, Shield,
  User, Layers, Check, ChevronRight, HardDrive,
  Settings2, Folder, AlertTriangle, FolderOpen, AlertCircle, FileCheck2, Loader2
} from 'lucide-react';
import { getBirTaxProfileRules, getDefaultVatStatusForClassification } from '../../shared/taxProfile';
import { validateDirectoryPathSyntax } from '../../shared/folderPickerTypes';
import { NativeFolderPickerService } from '../services/nativeFolderPickerService';
import { useRuntimeMode } from '../services/runtimeModeService';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

export default function CreateProfile() {
  const navigate = useNavigate();
  const runtime = useRuntimeMode();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');

  // Step 1: Business & Tax Profile
  const [company, setCompany] = useState({
    legalName: '',
    tradeName: '',
    tin: '',
    branchCode: '00000',
    address: '',
    contactPerson: '',
    contactEmail: '',
    contactPhone: '',
    industry: 'Services & Consulting',
  });

  const [customIndustry, setCustomIndustry] = useState('');
  const [isCustomIndustry, setIsCustomIndustry] = useState(false);

  const [tax, setTax] = useState({
    taxpayerClassification: 'CORPORATION',
    taxpayerType: 'CORPORATION',
    vatStatus: 'VAT',
    rdoCode: '039',
    birRegistrationNo: '',
    birDateRegistered: '',
  });

  // Step 2: Accounting Setup
  const [accounting, setAccounting] = useState({
    fiscalYear: 2026,
    fiscalYearStartMonth: 1,
    currency: 'PHP',
    accountingMethod: 'ACCRUAL',
    coaTemplate: 'STANDARD_PH_BIR',
    openingCash: '0.00',
    openingCapital: '0.00',
  });

  // Storage Settings
  const [showAdvancedStorage, setShowAdvancedStorage] = useState(true);
  const [pickingFolderTarget, setPickingFolderTarget] = useState<'profile' | 'backup' | null>(null);
  const [folderPickerFeedback, setFolderPickerFeedback] = useState<{
    target: 'profile' | 'backup';
    type: 'info' | 'warning' | 'error' | 'success';
    text: string;
  } | null>(null);

  const [locations, setLocations] = useState({
    documentLocationPath: '',
    backupLocationPath: '',
  });

  const [storageEnv, setStorageEnv] = useState<{
    companiesRoot: string;
    platform: string;
    presets: Array<{ label: string; path: string; isDefault?: boolean }>;
  } | null>(null);

  useEffect(() => {
    if (!runtime.loading && !runtime.isServerConsole) {
      navigate('/client/launcher?switch=1', { replace: true });
      return;
    }
  }, [runtime.loading, runtime.isServerConsole, navigate]);

  useEffect(() => {
    if (runtime.loading || !runtime.canCreateCompany) return;
    fetch('/api/companies/storage-environment')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.companiesRoot) {
          setStorageEnv(data);
        }
      })
      .catch((err) => console.warn('Storage environment fetch warning:', err));
  }, [runtime.loading, runtime.canCreateCompany]);

  // Step 3: Administrator Account
  const [admin, setAdmin] = useState({
    displayName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const getSafeName = () => {
    return company.legalName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'company_profile';
  };

  const baseCompaniesRoot = (storageEnv?.companiesRoot || '/data/companies').replace(/\\/g, '/');
  const computedDocPath = locations.documentLocationPath || `${baseCompaniesRoot}/${getSafeName()}`;
  const computedBackupPath = locations.backupLocationPath || `${baseCompaniesRoot}/${getSafeName()}/backups`;

  const validatePath = (path: string): { valid: boolean; reason?: string; warnings?: string[] } => {
    const result = validateDirectoryPathSyntax(path);
    return {
      valid: result.valid,
      reason: result.message,
      warnings: result.warnings,
    };
  };

  const docPathValidation = validatePath(computedDocPath);
  const backupPathValidation = validatePath(computedBackupPath);
  const isStorageValid = docPathValidation.valid && backupPathValidation.valid;

  const handleChooseNativeFolder = async (target: 'profile' | 'backup') => {
    if (pickingFolderTarget !== null) return;
    setPickingFolderTarget(target);
    setFolderPickerFeedback(null);
    try {
      const result = await NativeFolderPickerService.selectDirectory({
        title: target === 'profile' ? 'Select Company Data Folder' : 'Select Backup Folder',
        defaultPath: target === 'profile' ? computedDocPath : computedBackupPath,
        purpose: target === 'profile' ? 'COMPANY_DATA' : 'BACKUP',
        requireWrite: true,
        allowNonExistent: false,
      });

      if (result.status === 'SELECTED' && result.path) {
        const selected = result.path;
        if (target === 'profile') {
          setLocations((prev) => ({
            ...prev,
            documentLocationPath: selected,
            backupLocationPath: prev.backupLocationPath || `${selected}/backups`,
          }));
        } else {
          setLocations((prev) => ({
            ...prev,
            backupLocationPath: selected,
          }));
        }
        if (result.validation?.warnings && result.validation.warnings.length > 0) {
          setFolderPickerFeedback({
            target,
            type: 'warning',
            text: result.validation.warnings[0],
          });
        } else {
          setFolderPickerFeedback({
            target,
            type: 'success',
            text: result.message || 'Folder verified and ready.',
          });
        }
      } else if (result.status === 'CANCELLED') {
        // Preserve existing folder configuration untouched
      } else if (result.status === 'UNSUPPORTED_RUNTIME') {
        setFolderPickerFeedback({
          target,
          type: 'info',
          text:
            result.message ||
            'This environment does not expose a native OS folder dialog. You can enter or paste the full folder path directly below.',
        });
      } else if (result.status === 'ERROR') {
        setFolderPickerFeedback({
          target,
          type: 'error',
          text: result.message || 'Selected folder could not be validated. Previous path preserved.',
        });
      }
    } finally {
      setPickingFolderTarget(null);
    }
  };

  const handleStep1Next = () => {
    if (!company.legalName.trim()) {
      setError('Company Legal Registered Name is required.');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleStep2Next = () => {
    if (!isStorageValid) {
      setError('Please resolve invalid storage path locations before continuing.');
      return;
    }
    setError('');
    setStep(3);
  };

  const handleCreate = async () => {
    if (!admin.displayName.trim()) {
      setError('Owner / Admin name is required.');
      return;
    }
    if (!admin.email.trim()) {
      setError('Owner / Admin email address is required.');
      return;
    }
    if (!admin.password) {
      setError('Password is required.');
      return;
    }
    if (admin.password !== admin.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');
    setErrorCode('');

    const beginningBalances = [];
    const cashVal = parseFloat(accounting.openingCash) || 0;
    const capVal = parseFloat(accounting.openingCapital) || 0;
    if (cashVal > 0) {
      beginningBalances.push({ accountCode: '1010', debit: cashVal, credit: 0 });
    }
    if (capVal > 0) {
      beginningBalances.push({ accountCode: '3010', debit: 0, credit: capVal });
    }

    const finalIndustry = isCustomIndustry
      ? customIndustry.trim() || 'General Commercial Enterprise'
      : company.industry;

    try {
      const res = await fetch('/api/companies/create-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: {
            ...company,
            industry: finalIndustry,
            tradeName: company.tradeName || company.legalName,
            contactEmail: company.contactEmail || admin.email,
          },
          tax,
          accounting: {
            ...accounting,
            beginningBalances,
          },
          locations: {
            documentLocationPath: computedDocPath,
            backupLocationPath: computedBackupPath,
          },
          admin,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const vanity = getCompanyVanityDomain({ id: data.companyId, legalName: data.legalName || company.legalName });
        navigate(`/server/${vanity}/login`);
      } else {
        const data = await res.json();
        setErrorCode(data.error || '');
        setError(data.message || 'Failed to initialize company profile.');
        setLoading(false);
      }
    } catch (err: any) {
      console.error(err);
      setError('An unexpected error occurred during company creation.');
      setLoading(false);
    }
  };

  const activeRules = getBirTaxProfileRules(tax.taxpayerClassification, tax.vatStatus);

  const inputClass =
    'w-full px-3.5 py-2.5 min-h-[42px] bg-slate-50/80 dark:bg-[#0F172A] border border-slate-300/90 dark:border-[#24344F] rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600 dark:focus:border-sky-400 transition-colors';

  if (runtime.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] text-slate-500 dark:text-slate-400 text-xs font-medium">
        <Loader2 className="w-5 h-5 animate-spin mr-2 text-blue-600" />
        Verifying server console access...
      </div>
    );
  }

  if (!runtime.canCreateCompany) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] py-12 px-4">
        <div
          data-testid="create-profile-server-only-gate"
          className="w-full max-w-lg bg-white dark:bg-[#11192B] p-7 sm:p-8 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center space-y-4 shadow-xs"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400">
            <Shield className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-extrabold text-slate-900 dark:text-slate-50">
            PC Server Console Required
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Creating new company profiles is restricted strictly to the <strong>LedgerAI PH PC Server</strong> workstation. Browser clients can select any available registered company profile and sign in directly.
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
    <div className="min-h-screen bg-[#F5F7FA] dark:bg-[#0B1120] py-6 sm:py-8 px-4 sm:px-6 transition-colors">
      <div className="w-full max-w-4xl mx-auto">
        {/* Top Navigation Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <button
            type="button"
            onClick={() => navigate('/server/launcher')}
            className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-semibold text-xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Launcher</span>
          </button>
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
            <Shield className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>Philippine BIR-Ready Setup</span>
          </div>
        </div>

        {/* Wizard Container */}
        <div className="bg-white dark:bg-[#11192B] rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs overflow-hidden">
          {/* Calm Sovereign Navy Header */}
          <div className="bg-[#0F1C2E] px-5 py-6 sm:px-8 sm:py-7 text-white">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-sky-300" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                  Create Company Profile
                </h1>
                <p className="text-slate-300 text-xs sm:text-sm mt-0.5">
                  Configure your legal business details, BIR tax classification, and administrator login.
                </p>
              </div>
            </div>

            {/* Responsive 3-Step Indicator */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-6 pt-5 border-t border-white/10">
              {[
                { num: 1 as const, label: 'Business & Tax', canJump: true },
                { num: 2 as const, label: 'Accounting & Storage', canJump: Boolean(company.legalName.trim()) },
                { num: 3 as const, label: 'Admin Account', canJump: Boolean(company.legalName.trim() && isStorageValid) },
              ].map((s) => {
                const isActive = step === s.num;
                const isDone = step > s.num;
                return (
                  <button
                    key={s.num}
                    type="button"
                    onClick={() => {
                      if (s.canJump) setStep(s.num);
                    }}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isDone
                          ? 'bg-white/10 text-teal-300 hover:bg-white/15'
                          : 'bg-white/5 text-slate-400'
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        isActive
                          ? 'bg-white text-blue-700'
                          : isDone
                            ? 'bg-teal-500 text-slate-950'
                            : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {isDone ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : s.num}
                    </div>
                    <div className="min-w-0 hidden sm:block">
                      <div className="text-[11px] opacity-80 leading-none">Step {s.num}</div>
                      <div className="text-xs font-semibold truncate mt-0.5">{s.label}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Form Body */}
          <div className="p-5 sm:p-8">
            {error && (
              <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/35 text-rose-800 dark:text-rose-200 rounded-xl border border-rose-200 dark:border-rose-800/80 text-xs font-medium space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                  <span>{error}</span>
                </div>
                {(errorCode === 'DUPLICATE_COMPANY_CONFLICT' || errorCode === 'TARGET_DIRECTORY_NOT_EMPTY') && (
                  <div className="flex flex-wrap gap-2 pl-6">
                    <button
                      type="button"
                      onClick={() => navigate('/server/profile/open')}
                      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Open Existing Profile Instead
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Choose a Different Folder
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* STEP 1: BUSINESS & BIR TAX SETUP */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-700 dark:text-sky-400 shrink-0" />
                    <span>Business Identity &amp; Registration</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Enter your registered business name and BIR taxpayer details as shown on your Certificate of Registration (BIR Form 2303).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Legal Registered Business Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={company.legalName}
                      onChange={(e) => setCompany({ ...company, legalName: e.target.value })}
                      className={`${inputClass} font-medium`}
                      placeholder="e.g., Mabuhay Trading Solutions Inc."
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Trade / DBA Name <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={company.tradeName}
                      onChange={(e) => setCompany({ ...company, tradeName: e.target.value })}
                      className={inputClass}
                      placeholder="Defaults to Legal Name"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Industry Sector
                    </label>
                    {!isCustomIndustry ? (
                      <select
                        value={company.industry}
                        onChange={(e) => {
                          if (e.target.value === 'OTHER_CUSTOM') {
                            setIsCustomIndustry(true);
                          } else {
                            setCompany({ ...company, industry: e.target.value });
                          }
                        }}
                        className={inputClass}
                      >
                        <option value="Services & Consulting">Services &amp; Professional Consulting</option>
                        <option value="Retail & Wholesale">Retail &amp; Wholesale Distribution</option>
                        <option value="Technology, IT & Software">Technology, IT &amp; Software</option>
                        <option value="Manufacturing & Industrial">Manufacturing &amp; Industrial</option>
                        <option value="Construction & Engineering">Construction &amp; Engineering</option>
                        <option value="Real Estate & Property">Real Estate &amp; Property Management</option>
                        <option value="Food & Restaurant">Food, Beverage &amp; Hospitality</option>
                        <option value="General Commercial Enterprise">General Commercial Enterprise</option>
                        <option value="OTHER_CUSTOM">+ Enter Custom Industry...</option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customIndustry}
                          onChange={(e) => setCustomIndustry(e.target.value)}
                          placeholder="Enter industry sector..."
                          className={inputClass}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setIsCustomIndustry(false)}
                          className="px-3 py-2 bg-slate-100 dark:bg-[#1B2942] hover:bg-slate-200 dark:hover:bg-[#243656] text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Presets
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      BIR Tax Identification Number (TIN)
                    </label>
                    <input
                      type="text"
                      value={company.tin}
                      onChange={(e) => setCompany({ ...company, tin: e.target.value })}
                      className={`${inputClass} font-mono`}
                      placeholder="000-123-456-000"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Branch Code
                    </label>
                    <input
                      type="text"
                      value={company.branchCode}
                      onChange={(e) => setCompany({ ...company, branchCode: e.target.value })}
                      className={`${inputClass} font-mono`}
                      placeholder="00000"
                    />
                  </div>
                </div>

                <hr className="border-slate-200/80 dark:border-[#1E2D45]" />

                {/* Clean User-Friendly BIR Tax Classification Section (Zero internal dev jargon) */}
                <div className="space-y-4">
                  <div>
                    <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                      <span>BIR Tax Registration &amp; Filing Regime</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      These selections configure your Chart of Accounts, invoicing rules, and applicable BIR tax return forms.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Taxpayer Classification <span className="text-rose-600">*</span>
                      </label>
                      <select
                        value={tax.taxpayerClassification}
                        onChange={(e) => {
                          const selectedClass = e.target.value;
                          const autoVat = getDefaultVatStatusForClassification(selectedClass);
                          setTax({
                            ...tax,
                            taxpayerClassification: selectedClass,
                            taxpayerType: selectedClass,
                            vatStatus: autoVat,
                          });
                        }}
                        className={`${inputClass} font-medium`}
                      >
                        <optgroup label="Corporate & Juridical Entities">
                          <option value="CORPORATION">Domestic Corporation (Form 1702-RT)</option>
                          <option value="OPC">One Person Corporation — OPC (Form 1702-RT)</option>
                          <option value="RFC">Resident Foreign Corp / Branch (Form 1702-MX)</option>
                          <option value="NRFC">Non-Resident Foreign Corp (Final Tax)</option>
                          <option value="GOCC">Government Agency / GOCC / LGU</option>
                        </optgroup>
                        <optgroup label="Individual Taxpayers & Professionals">
                          <option value="INDIVIDUAL">Sole Proprietorship / Individual — Graduated</option>
                          <option value="INDIVIDUAL_8PERCENT">Individual / Professional — 8% Flat Option</option>
                          <option value="ESTATE_TRUST">Estate or Trust (Form 1701)</option>
                        </optgroup>
                        <optgroup label="Partnerships & Joint Ventures">
                          <option value="PARTNERSHIP">General Commercial Partnership (Form 1702-RT)</option>
                          <option value="GPP">General Professional Partnership — GPP</option>
                          <option value="JOINT_VENTURE">Joint Venture / Consortium</option>
                        </optgroup>
                        <optgroup label="Tax-Exempt & Non-Profit Entities">
                          <option value="COOPERATIVE">CDA-Registered Cooperative (RA 9520)</option>
                          <option value="NON_PROFIT">Non-Stock Non-Profit / NGO (Sec. 30 NIRC)</option>
                        </optgroup>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        VAT &amp; Business Tax Status <span className="text-rose-600">*</span>
                      </label>
                      <select
                        value={tax.vatStatus}
                        onChange={(e) => setTax({ ...tax, vatStatus: e.target.value })}
                        className={`${inputClass} font-medium`}
                      >
                        <optgroup label="Standard Business Tax Regimes">
                          <option value="VAT">VAT-Registered (12% VAT — Form 2550Q / 2550M)</option>
                          <option value="NON_VAT">Non-VAT Registered (3% Percentage Tax — 2551Q)</option>
                          <option value="INDIVIDUAL_8PERCENT_VAT">8% Income Tax Option (Exempt from 3% PT)</option>
                        </optgroup>
                        <optgroup label="Ecozone & Special Tax Incentives (CREATE)">
                          <option value="PEZA_BOI">PEZA / BOI Ecozone (5% SCIT / 0% VAT)</option>
                          <option value="FREEPORT">Freeport Zone (SBMA, Clark, AFAB, CEZA)</option>
                          <option value="BOI_ITH">BOI Income Tax Holiday (ITH)</option>
                        </optgroup>
                        <optgroup label="Special Percentage Taxpayers">
                          <option value="PERCENTAGE_CARRIER">Common Carrier Tax (3% — Sec. 117)</option>
                          <option value="PERCENTAGE_FRANCHISE">Franchise Tax (2% / 3% — Sec. 119)</option>
                          <option value="PERCENTAGE_BANK_GRT">Bank / Financial Gross Receipts Tax</option>
                          <option value="PERCENTAGE_AMUSEMENT">Amusement Tax (Sec. 125)</option>
                          <option value="PERCENTAGE_COMMUNICATION">Overseas Communications Tax (10%)</option>
                          <option value="PERCENTAGE_INSURANCE">Life Insurance Premium Tax (2%)</option>
                        </optgroup>
                        <optgroup label="Zero-Rated & Exempt Regimes">
                          <option value="ZERO_RATED">Direct Export Zero-Rated (0% VAT)</option>
                          <option value="EFFECTIVELY_ZERO_RATED">Effectively Zero-Rated Local Sales (0% VAT)</option>
                          <option value="EXEMPT">VAT-Exempt Transactions (Sec. 109 NIRC)</option>
                          <option value="BMBE">BMBE Micro Enterprise (RA 9178)</option>
                          <option value="COOPERATIVE_EXEMPT">CDA Cooperative Exempt (RA 9520)</option>
                        </optgroup>
                        <optgroup label="Withholding Tax Agents">
                          <option value="GOVT_WITHHOLDING_AGENT">Government Withholding Agent (5% FWT VAT)</option>
                          <option value="TOP_WITHHOLDING_TAXPAYER">Top Withholding Taxpayer (1% Goods / 2% Services)</option>
                        </optgroup>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        BIR RDO Code
                      </label>
                      <input
                        type="text"
                        value={tax.rdoCode}
                        onChange={(e) => setTax({ ...tax, rdoCode: e.target.value })}
                        className={`${inputClass} font-mono`}
                        placeholder="e.g., 039"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Registered Business Address
                      </label>
                      <input
                        type="text"
                        value={company.address}
                        onChange={(e) => setCompany({ ...company, address: e.target.value })}
                        className={inputClass}
                        placeholder="e.g., Makati City, Metro Manila"
                      />
                    </div>
                  </div>

                  {/* High-Contrast Eye-Friendly BIR Filing & Compliance Summary Card */}
                  <div className="mt-4 p-4 sm:p-5 bg-slate-50 dark:bg-[#0F172A] border border-slate-200/90 dark:border-[#1E2D45] rounded-2xl space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-[#1E2D45]">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                        <span className="font-display text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                          BIR Tax &amp; Filing Summary
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                        {activeRules.invoiceHeaderBadge}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="p-3.5 bg-white dark:bg-[#11192B] rounded-xl border border-slate-200/80 dark:border-[#1E2D45]">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                          Applicable Tax Framework
                        </span>
                        <p className="font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {activeRules.legalFramework}
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                          {activeRules.incomeTaxRateDescription}
                        </p>
                      </div>

                      <div className="p-3.5 bg-white dark:bg-[#11192B] rounded-xl border border-slate-200/80 dark:border-[#1E2D45]">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                          Applicable BIR Returns
                        </span>
                        <p className="font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {activeRules.incomeTaxForm}
                        </p>
                        <p className="text-[11px] text-blue-700 dark:text-sky-400 font-semibold mt-1 leading-relaxed">
                          {activeRules.vatOrPercentageForm}
                        </p>
                      </div>

                      <div className="p-3.5 bg-white dark:bg-[#11192B] rounded-xl border border-slate-200/80 dark:border-[#1E2D45]">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                          Invoicing Notice (EOPT Act)
                        </span>
                        <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                          {activeRules.invoiceNotice}
                        </p>
                      </div>
                    </div>

                    {activeRules.applicableAuditChecks.length > 0 && (
                      <div className="pt-3 border-t border-slate-200/80 dark:border-[#1E2D45] text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-200 block mb-1.5">
                          Standard BIR Reconciliation Checks Enabled:
                        </span>
                        <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                          {activeRules.applicableAuditChecks.map((check, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                              <span>{check}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleStep1Next}
                    className="w-full sm:w-auto bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <span>Continue to Accounting Setup</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: ACCOUNTING PERIOD & STORAGE */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    <Layers className="w-5 h-5 text-blue-700 dark:text-sky-400 shrink-0" />
                    <span>Accounting Period &amp; Workspace Storage</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Set your opening balances and verify where your encrypted company files and backups will be saved.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Fiscal Year
                    </label>
                    <input
                      type="number"
                      value={accounting.fiscalYear}
                      onChange={(e) => setAccounting({ ...accounting, fiscalYear: parseInt(e.target.value) || 2026 })}
                      className={`${inputClass} font-mono`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Functional Currency
                    </label>
                    <input
                      type="text"
                      value="PHP (Philippine Peso)"
                      readOnly
                      className="w-full px-3.5 py-2.5 min-h-[42px] bg-slate-100 dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Opening Cash Balance (PHP)
                    </label>
                    <input
                      type="number"
                      value={accounting.openingCash}
                      onChange={(e) => setAccounting({ ...accounting, openingCash: e.target.value })}
                      className={`${inputClass} font-mono`}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Opening Owner Capital (PHP)
                    </label>
                    <input
                      type="number"
                      value={accounting.openingCapital}
                      onChange={(e) => setAccounting({ ...accounting, openingCapital: e.target.value })}
                      className={`${inputClass} font-mono`}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Accounting Preset Summary */}
                <div className="p-4 bg-slate-50 dark:bg-[#0F172A] rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-white dark:bg-[#11192B] rounded-xl border border-slate-200/80 dark:border-[#1E2D45]">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                      Scheduled BIR Returns
                    </span>
                    <p className="font-bold text-slate-900 dark:text-slate-100">
                      {activeRules.vatOrPercentageForm}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {activeRules.incomeTaxForm}
                    </p>
                  </div>
                  <div className="p-3 bg-white dark:bg-[#11192B] rounded-xl border border-slate-200/80 dark:border-[#1E2D45]">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                      Default Chart of Accounts
                    </span>
                    <p className="font-bold text-blue-700 dark:text-sky-400">
                      {tax.vatStatus === 'NON_VAT'
                        ? 'Percentage Tax Accounts (2210 / 6080)'
                        : 'Output VAT (2020) & Input VAT (1050)'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Philippine Standard 1000–7000 Account Series
                    </p>
                  </div>
                </div>

                {/* Storage Directory Settings */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-blue-700 dark:text-sky-400" />
                      <span>Workspace Storage Folders</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedStorage(!showAdvancedStorage)}
                      className="text-xs font-semibold text-blue-700 dark:text-sky-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      <span>{showAdvancedStorage ? 'Hide Folders' : 'Show Folders'}</span>
                    </button>
                  </div>

                  {showAdvancedStorage && (
                    <div className="p-4 bg-slate-50 dark:bg-[#0F172A] rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] space-y-4">
                      <div className="p-3 bg-white dark:bg-[#11192B] border border-slate-200/80 dark:border-[#1E2D45] rounded-xl text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
                        <Folder className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          Each company is stored in its own isolated folder so your books, attachments, and encrypted backups remain portable and easy to recover.
                        </p>
                      </div>

                      {/* Company Folder */}
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                          <label htmlFor="create-company-data-folder" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Company Data Folder <span className="text-rose-600">*</span>
                          </label>
                          <button
                            type="button"
                            data-testid="choose-company-data-folder-btn"
                            disabled={pickingFolderTarget !== null}
                            onClick={() => handleChooseNativeFolder('profile')}
                            className="text-xs font-semibold text-blue-700 dark:text-sky-400 bg-white dark:bg-[#162238] hover:bg-blue-50 dark:hover:bg-[#1B2942] disabled:opacity-60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#24344F] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {pickingFolderTarget === 'profile' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FolderOpen className="w-3.5 h-3.5" />
                            )}
                            <span>{pickingFolderTarget === 'profile' ? 'Opening Dialog...' : 'Choose Folder'}</span>
                          </button>
                        </div>

                        <div className="relative">
                          <input
                            id="create-company-data-folder"
                            type="text"
                            value={computedDocPath}
                            onChange={(e) => {
                              setFolderPickerFeedback(null);
                              setLocations({ ...locations, documentLocationPath: e.target.value });
                            }}
                            className={`w-full px-3.5 py-2.5 pr-9 bg-white dark:bg-[#11192B] border rounded-xl text-xs font-mono transition-colors ${
                              !docPathValidation.valid
                                ? 'border-rose-500 text-rose-700 dark:text-rose-300'
                                : 'border-slate-300 dark:border-[#24344F] text-slate-800 dark:text-slate-200'
                            }`}
                          />
                          {docPathValidation.valid && (
                            <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 absolute right-3 top-1/2 -translate-y-1/2" />
                          )}
                        </div>

                        {!docPathValidation.valid && (
                          <div className="mt-1.5 p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-900 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{docPathValidation.reason}</span>
                          </div>
                        )}
                        {folderPickerFeedback?.target === 'profile' && (
                          <div
                            role="status"
                            className={`mt-1.5 p-2 rounded-lg border text-xs flex items-start gap-1.5 ${
                              folderPickerFeedback.type === 'error'
                                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                                : folderPickerFeedback.type === 'warning'
                                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                  : folderPickerFeedback.type === 'success'
                                    ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                                    : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                            }`}
                          >
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{folderPickerFeedback.text}</span>
                          </div>
                        )}
                      </div>

                      {/* Backup Folder */}
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                          <label htmlFor="create-company-backup-folder" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Backup Folder <span className="text-rose-600">*</span>
                          </label>
                          <button
                            type="button"
                            data-testid="choose-backup-folder-btn"
                            disabled={pickingFolderTarget !== null}
                            onClick={() => handleChooseNativeFolder('backup')}
                            className="text-xs font-semibold text-blue-700 dark:text-sky-400 bg-white dark:bg-[#162238] hover:bg-blue-50 dark:hover:bg-[#1B2942] disabled:opacity-60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#24344F] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {pickingFolderTarget === 'backup' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FolderOpen className="w-3.5 h-3.5" />
                            )}
                            <span>{pickingFolderTarget === 'backup' ? 'Opening Dialog...' : 'Choose Folder'}</span>
                          </button>
                        </div>

                        <div className="relative">
                          <input
                            id="create-company-backup-folder"
                            type="text"
                            value={computedBackupPath}
                            onChange={(e) => {
                              setFolderPickerFeedback(null);
                              setLocations({ ...locations, backupLocationPath: e.target.value });
                            }}
                            className={`w-full px-3.5 py-2.5 pr-9 bg-white dark:bg-[#11192B] border rounded-xl text-xs font-mono transition-colors ${
                              !backupPathValidation.valid
                                ? 'border-rose-500 text-rose-700 dark:text-rose-300'
                                : 'border-slate-300 dark:border-[#24344F] text-slate-800 dark:text-slate-200'
                            }`}
                          />
                          {backupPathValidation.valid && (
                            <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 absolute right-3 top-1/2 -translate-y-1/2" />
                          )}
                        </div>

                        {!backupPathValidation.valid && (
                          <div className="mt-1.5 p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-900 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{backupPathValidation.reason}</span>
                          </div>
                        )}
                        {folderPickerFeedback?.target === 'backup' && (
                          <div
                            role="status"
                            className={`mt-1.5 p-2 rounded-lg border text-xs flex items-start gap-1.5 ${
                              folderPickerFeedback.type === 'error'
                                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                                : folderPickerFeedback.type === 'warning'
                                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                  : folderPickerFeedback.type === 'success'
                                    ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                                    : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                            }`}
                          >
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{folderPickerFeedback.text}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex flex-col-reverse sm:flex-row gap-3 justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="w-full sm:w-auto px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1B2942] rounded-xl font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleStep2Next}
                    disabled={!isStorageValid}
                    className="w-full sm:w-auto bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 py-3 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Continue to Admin Account</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ADMINISTRATOR ACCOUNT */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-700 dark:text-sky-400 shrink-0" />
                    <span>Company Owner / Administrator Account</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Create the primary login credentials for managing this company workspace and authorizing backups.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Full Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={admin.displayName}
                      onChange={(e) => setAdmin({ ...admin, displayName: e.target.value })}
                      className={inputClass}
                      placeholder="e.g., Juan Dela Cruz"
                      required
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Email Address <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="email"
                      value={admin.email}
                      onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                      className={inputClass}
                      placeholder="owner@company.ph"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Password <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="password"
                      value={admin.password}
                      onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                      className={inputClass}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Confirm Password <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="password"
                      value={admin.confirmPassword}
                      onChange={(e) => setAdmin({ ...admin, confirmPassword: e.target.value })}
                      className={inputClass}
                      required
                    />
                  </div>
                </div>

                <div className="p-4 bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/80 rounded-2xl flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-teal-950 dark:text-teal-200 space-y-1">
                    <p className="font-semibold">Ready to create your workspace</p>
                    <p className="text-teal-800/90 dark:text-teal-300/90 leading-relaxed">
                      This will initialize an isolated company database for{' '}
                      <strong>{company.legalName || 'your business'}</strong>, configure your Philippine Chart of Accounts and BIR tax rules, and register your administrator login.
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex flex-col-reverse sm:flex-row gap-3 justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="w-full sm:w-auto px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1B2942] rounded-xl font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={loading || !isStorageValid}
                    className="w-full sm:w-auto bg-teal-700 hover:bg-teal-800 text-white px-7 py-3 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {loading ? 'Creating Company Workspace...' : 'Create Company Workspace'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
