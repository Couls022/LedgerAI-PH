import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, ArrowLeft, CheckCircle2, Shield, Calculator, 
  FileSpreadsheet, Sparkles, User, KeyRound, Mail, Layers,
  Check, Info, ChevronRight, HardDrive, Settings2, Folder, 
  AlertTriangle, FolderOpen, AlertCircle, Edit3, Cpu
} from 'lucide-react';
import { getBirTaxProfileRules, getDefaultVatStatusForClassification } from '../../shared/taxProfile';
import DirectoryExplorerModal from '../components/DirectoryExplorerModal';

export default function CreateProfile() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    industry: 'Services & Consulting'
  });

  const [customIndustry, setCustomIndustry] = useState('');
  const [isCustomIndustry, setIsCustomIndustry] = useState(false);

  const [tax, setTax] = useState({
    taxpayerClassification: 'CORPORATION',
    taxpayerType: 'CORPORATION',
    vatStatus: 'VAT',
    rdoCode: '039',
    birRegistrationNo: '',
    birDateRegistered: ''
  });

  // Step 2: Financial Setup
  const [accounting, setAccounting] = useState({
    fiscalYear: 2026,
    fiscalYearStartMonth: 1,
    currency: 'PHP',
    accountingMethod: 'ACCRUAL',
    coaTemplate: 'STANDARD_PH_BIR',
    openingCash: '0.00',
    openingCapital: '0.00'
  });

  // Advanced Storage
  const [showAdvancedStorage, setShowAdvancedStorage] = useState(true);
  const [showLocationPickerModal, setShowLocationPickerModal] = useState<'profile' | 'backup' | null>(null);

  const [locations, setLocations] = useState({
    documentLocationPath: '',
    backupLocationPath: ''
  });

  const [storageEnv, setStorageEnv] = useState<{
    companiesRoot: string;
    platform: string;
    presets: Array<{ label: string; path: string; isDefault?: boolean }>;
  } | null>(null);

  useEffect(() => {
    fetch('/api/companies/storage-environment')
      .then(res => res.json())
      .then(data => {
        if (data && data.companiesRoot) {
          setStorageEnv(data);
        }
      })
      .catch(err => console.warn('Storage environment fetch warning:', err));
  }, []);

  // Step 3: Administrator Account
  const [admin, setAdmin] = useState({
    displayName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  // Auto-generate storage paths based on company name
  const getSafeName = () => {
    return company.legalName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'company_profile';
  };

  const baseCompaniesRoot = (storageEnv?.companiesRoot || '/data/companies').replace(/\\/g, '/');
  const computedDocPath = locations.documentLocationPath || `${baseCompaniesRoot}/${getSafeName()}`;
  const computedBackupPath = locations.backupLocationPath || `${baseCompaniesRoot}/${getSafeName()}/backups`;

  // Real-time Path Validation Logic
  const validatePath = (path: string): { valid: boolean; reason?: string } => {
    if (!path || !path.trim()) {
      return { valid: false, reason: 'Path location cannot be empty.' };
    }
    const trimmed = path.trim().replace(/\\/g, '/');
    if (trimmed === '/' || trimmed === '\\') {
      return { valid: false, reason: 'Root directory "/" or "\\" is not allowed for security.' };
    }

    // Strip Windows drive letter prefix (e.g. "C:" or "D:") before checking forbidden characters
    const pathWithoutDrive = trimmed.replace(/^[a-zA-Z]:/, '');

    if (/[<>"|?*]/.test(pathWithoutDrive) || pathWithoutDrive.includes(':')) {
      return { valid: false, reason: 'Path contains invalid characters (<>:"|?*).' };
    }
    if (/^\/(bin|etc|sys|proc|boot|dev|lib|sbin)(\/|$)/i.test(trimmed)) {
      return { valid: false, reason: 'Path cannot be a reserved system operating system directory.' };
    }
    if (!trimmed.startsWith('/') && !trimmed.startsWith('./') && !/^[a-zA-Z]:[\\/]?/.test(trimmed)) {
      return { valid: false, reason: 'Path must start with "/" (Unix/Linux) or drive letter (e.g. C:\\ or D:/).' };
    }
    return { valid: true };
  };

  const docPathValidation = validatePath(computedDocPath);
  const backupPathValidation = validatePath(computedBackupPath);
  const isStorageValid = docPathValidation.valid && backupPathValidation.valid;

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

    // Beginning Balances Array
    const beginningBalances = [];
    const cashVal = parseFloat(accounting.openingCash) || 0;
    const capVal = parseFloat(accounting.openingCapital) || 0;
    if (cashVal > 0) {
      beginningBalances.push({ accountCode: '1010', debit: cashVal, credit: 0 });
    }
    if (capVal > 0) {
      beginningBalances.push({ accountCode: '3010', debit: 0, credit: capVal });
    }

    const finalIndustry = isCustomIndustry ? (customIndustry.trim() || 'General Commercial Enterprise') : company.industry;

    try {
      const res = await fetch('/api/companies/create-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: {
            ...company,
            industry: finalIndustry,
            tradeName: company.tradeName || company.legalName,
            contactEmail: company.contactEmail || admin.email
          },
          tax,
          accounting: {
            ...accounting,
            beginningBalances
          },
          locations: {
            documentLocationPath: computedDocPath,
            backupLocationPath: computedBackupPath
          },
          admin
        })
      });

      if (res.ok) {
        const data = await res.json();
        navigate(`/login/${data.companyId}`);
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to initialize company profile.');
        setLoading(false);
      }
    } catch (err: any) {
      console.error(err);
      setError('An unexpected error occurred during company creation.');
      setLoading(false);
    }
  };

  // Presets for Path Picker Modal
  const getPresetPaths = (type: 'profile' | 'backup') => {
    const safe = getSafeName();
    if (storageEnv?.presets && storageEnv.presets.length > 0) {
      return storageEnv.presets.map(p => ({
        label: p.label,
        path: type === 'profile' ? `${p.path}/${safe}`.replace(/\\/g, '/') : `${p.path}/${safe}/backups`.replace(/\\/g, '/')
      }));
    }
    const defaultRoot = baseCompaniesRoot;
    if (type === 'profile') {
      return [
        { label: 'Active Device Storage (Default)', path: `${defaultRoot}/${safe}` },
        { label: 'Primary Windows Drive C:', path: `C:/LedgerAI_Data/companies/${safe}` },
        { label: 'Secondary Volume D:', path: `D:/LedgerAI_Data/companies/${safe}` }
      ];
    } else {
      return [
        { label: 'Active Internal Backup Folder', path: `${defaultRoot}/${safe}/backups` },
        { label: 'Dedicated Backup Volume D:', path: `D:/LedgerAI_Data/companies/${safe}/backups` }
      ];
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="w-full max-w-4xl mx-auto">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between mb-6">
          <button 
            onClick={() => navigate('/launcher')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Launcher
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
            <Shield className="w-4 h-4 text-emerald-500" /> BIR PH Compliant Accounting Architecture
          </div>
        </div>

        {/* Wizard Card Container */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 sm:p-8 text-white relative">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center shrink-0">
                <Building2 className="w-6 h-6 text-indigo-300" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Create Company Profile</h1>
                <p className="text-slate-300 text-xs sm:text-sm mt-1">Quick & easy setup configured for Philippine business taxation & BIR policies.</p>
              </div>
            </div>

            {/* Stepper Tabs */}
            <div className="grid grid-cols-3 gap-2 mt-8 pt-6 border-t border-slate-800">
              <button 
                type="button" 
                onClick={() => setStep(1)}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-left transition-all ${
                  step === 1 ? 'bg-indigo-600 text-white font-bold shadow-md' : step > 1 ? 'bg-slate-800/80 text-emerald-400 font-semibold' : 'bg-slate-800/40 text-slate-400'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 1 ? 'bg-white text-indigo-600' : step > 1 ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
                  {step > 1 ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '1'}
                </div>
                <div className="hidden sm:block">
                  <div className="text-xs leading-none">Step 1</div>
                  <div className="text-[11px] opacity-90 mt-0.5">Business & Tax</div>
                </div>
              </button>

              <button 
                type="button" 
                onClick={() => { if (company.legalName) setStep(2); }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-left transition-all ${
                  step === 2 ? 'bg-indigo-600 text-white font-bold shadow-md' : step > 2 ? 'bg-slate-800/80 text-emerald-400 font-semibold' : 'bg-slate-800/40 text-slate-400'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 2 ? 'bg-white text-indigo-600' : step > 2 ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
                  {step > 2 ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '2'}
                </div>
                <div className="hidden sm:block">
                  <div className="text-xs leading-none">Step 2</div>
                  <div className="text-[11px] opacity-90 mt-0.5">Financial Engine</div>
                </div>
              </button>

              <button 
                type="button" 
                onClick={() => { if (company.legalName && isStorageValid) setStep(3); }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-left transition-all ${
                  step === 3 ? 'bg-indigo-600 text-white font-bold shadow-md' : 'bg-slate-800/40 text-slate-400'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 3 ? 'bg-white text-indigo-600' : 'bg-slate-700 text-slate-300'}`}>
                  3
                </div>
                <div className="hidden sm:block">
                  <div className="text-xs leading-none">Step 3</div>
                  <div className="text-[11px] opacity-90 mt-0.5">Admin User</div>
                </div>
              </button>
            </div>
          </div>

          {/* Form Body */}
          <div className="p-6 sm:p-8">
            {error && (
              <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 rounded-xl border border-rose-200 dark:border-rose-900 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{error}</span>
              </div>
            )}

            {/* STEP 1: BUSINESS & BIR TAX SETUP */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-indigo-600" /> Business Identity & Registration
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Enter your legal registered company name and BIR tax classification.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Legal Registered Business Name <span className="text-rose-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={company.legalName} 
                      onChange={e => setCompany({...company, legalName: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="e.g., Deskguard Solutions Philippines Inc." 
                      required 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Trade / DBA Name <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input 
                      type="text" 
                      value={company.tradeName} 
                      onChange={e => setCompany({...company, tradeName: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="Defaults to Legal Name" 
                    />
                  </div>

                  {/* Industry Sector with Manual Type Option */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Industry Sector</label>
                    {!isCustomIndustry ? (
                      <select 
                        value={company.industry} 
                        onChange={e => {
                          if (e.target.value === 'OTHER_CUSTOM') {
                            setIsCustomIndustry(true);
                          } else {
                            setCompany({...company, industry: e.target.value});
                          }
                        }} 
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="Services & Consulting">Services & Professional Consulting</option>
                        <option value="Retail & Wholesale">Retail & Wholesale Distribution</option>
                        <option value="Technology, IT & Software">Technology, IT & Software</option>
                        <option value="Manufacturing & Industrial">Manufacturing & Industrial</option>
                        <option value="Construction & Engineering">Construction & Engineering</option>
                        <option value="Real Estate & Property">Real Estate & Property Management</option>
                        <option value="Food & Restaurant">Food, Beverage & Hospitality</option>
                        <option value="General Commercial Enterprise">General Commercial Enterprise</option>
                        <option value="OTHER_CUSTOM">+ Type Other Custom Industry Sector...</option>
                      </select>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={customIndustry} 
                            onChange={e => setCustomIndustry(e.target.value)} 
                            placeholder="Type custom industry sector name..." 
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-indigo-400 dark:border-indigo-600 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            autoFocus
                          />
                          <button 
                            type="button" 
                            onClick={() => { setIsCustomIndustry(false); }} 
                            className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-xl text-xs font-bold transition-all shrink-0"
                          >
                            Preset List
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      BIR Tax Identification Number (TIN)
                    </label>
                    <input 
                      type="text" 
                      value={company.tin} 
                      onChange={e => setCompany({...company, tin: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="000-123-456-000" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Branch Code
                    </label>
                    <input 
                      type="text" 
                      value={company.branchCode} 
                      onChange={e => setCompany({...company, branchCode: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="00000 (Head Office)" 
                    />
                  </div>
                </div>

                <hr className="border-slate-200 dark:border-slate-800" />

                {/* BIR Tax Profile Selection - PROMINENT TAX ROUTE DRIVER */}
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-900/10 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 rounded-2xl">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-black text-indigo-950 dark:text-indigo-200">
                          Core Business Tax Engine Routing
                        </h3>
                        <p className="text-xs text-indigo-800/90 dark:text-indigo-300/90 mt-1 leading-relaxed">
                          <strong className="font-bold text-indigo-950 dark:text-indigo-100">Taxpayer Entity Classification</strong> and <strong className="font-bold text-indigo-950 dark:text-indigo-100">VAT & Tax Status</strong> drive the whole system's module flow, double-entry Chart of Accounts, and official BIR tax return generation (*Forms 2550Q, 2551Q, 1702/1701*).
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                        Taxpayer Entity Classification <span className="text-indigo-600 font-black">* Core Engine Driver</span>
                      </label>
                      <select 
                        value={tax.taxpayerClassification} 
                        onChange={e => {
                          const selectedClass = e.target.value;
                          const autoVat = getDefaultVatStatusForClassification(selectedClass);
                          setTax({
                            ...tax,
                            taxpayerClassification: selectedClass,
                            taxpayerType: selectedClass,
                            vatStatus: autoVat
                          });
                        }} 
                        className="w-full px-4 py-2.5 bg-indigo-50/50 dark:bg-slate-800 border-2 border-indigo-300 dark:border-indigo-600 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <optgroup label="Corporate & Juridical Entities">
                          <option value="CORPORATION">Domestic Corporation (Form 1702-RT - 25% / 20% CREATE)</option>
                          <option value="OPC">One Person Corporation - OPC (Form 1702-RT)</option>
                          <option value="RFC">Resident Foreign Corp / Branch / ROHQ (Form 1702-MX)</option>
                          <option value="NRFC">Non-Resident Foreign Corp (Final Withholding Agent)</option>
                          <option value="GOCC">Government Agency / GOCC / LGU (Form 1702-RT / 1600)</option>
                        </optgroup>
                        
                        <optgroup label="Individual Taxpayers & Professionals">
                          <option value="INDIVIDUAL">Sole Proprietorship / Individual - Graduated Rates (Form 1701/1701A)</option>
                          <option value="INDIVIDUAL_8PERCENT">Individual Professional - 8% Optional Flat Tax Rate (Form 1701A)</option>
                          <option value="ESTATE_TRUST">Estate or Trust Under Judicial Settlement (Form 1701)</option>
                        </optgroup>

                        <optgroup label="Partnerships & Joint Ventures">
                          <option value="PARTNERSHIP">General Commercial Partnership (Form 1702-RT)</option>
                          <option value="GPP">General Professional Partnership - GPP (Form 1702-EX)</option>
                          <option value="JOINT_VENTURE">Joint Venture / Consortium (Form 1702-RT / 1702-EX)</option>
                        </optgroup>

                        <optgroup label="Special Tax-Exempt & Non-Profit Entities">
                          <option value="COOPERATIVE">CDA-Registered Cooperative (Form 1702-EX / RA 9520 Exemption)</option>
                          <option value="NON_PROFIT">Non-Stock Non-Profit / Foundation / NGO (Form 1702-EX / Sec 30 NIRC)</option>
                        </optgroup>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                        VAT & Tax Status <span className="text-indigo-600 font-black">* Core Engine Driver</span>
                      </label>
                      <select 
                        value={tax.vatStatus} 
                        onChange={e => setTax({...tax, vatStatus: e.target.value})} 
                        className="w-full px-4 py-2.5 bg-indigo-50/50 dark:bg-slate-800 border-2 border-indigo-300 dark:border-indigo-600 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <optgroup label="Standard Business Tax Regimes">
                          <option value="VAT">Regular Value-Added Tax (12% Output VAT - Form 2550Q / Sec 106 & 108 NIRC)</option>
                          <option value="NON_VAT">Non-VAT Registered / 3% Percentage Tax (Form 2551Q / Sec 116 NIRC)</option>
                          <option value="INDIVIDUAL_8PERCENT_VAT">8% Flat Income Tax Option (Exempt from 3% Percentage Tax - TRAIN RR 8-2018)</option>
                        </optgroup>

                        <optgroup label="Ecozone, Freeport & Special Tax Incentives (CREATE Act)">
                          <option value="PEZA_BOI">PEZA / BOI Ecozone Enterprise (5% Special Gross Income Tax - GIT / 0% VAT)</option>
                          <option value="FREEPORT">Freeport Zone Registered (Subic SBMA, Clark CDC, AFAB, CEZA - 5% SCIT / 0% VAT)</option>
                          <option value="BOI_ITH">BOI Registered Enterprise (Income Tax Holiday ITH Registered)</option>
                        </optgroup>

                        <optgroup label="Special Percentage Taxpayers (Title V NIRC)">
                          <option value="PERCENTAGE_CARRIER">Common Carrier / Land Passenger Transport (3% Common Carrier Tax - Sec 117)</option>
                          <option value="PERCENTAGE_FRANCHISE">Franchise Taxpayer (2% Utilities / 3% Radio & TV Broadcasting - Sec 119)</option>
                          <option value="PERCENTAGE_BANK_GRT">Bank & Financial Intermediary (1%-7% Gross Receipts Tax - Sec 121/122)</option>
                          <option value="PERCENTAGE_AMUSEMENT">Amusement & Entertainment Operator (10%-30% Amusement Tax - Sec 125)</option>
                          <option value="PERCENTAGE_COMMUNICATION">Overseas Telecoms / Dispatch (10% Overseas Communications Tax - Sec 120)</option>
                          <option value="PERCENTAGE_INSURANCE">Life Insurance Company (2% Premium Tax - Sec 123)</option>
                        </optgroup>

                        <optgroup label="Zero-Rated & Special Tax Exempt Regimes">
                          <option value="ZERO_RATED">Direct Export Zero-Rated Taxpayer (0% VAT - Direct Export Sec 106/108)</option>
                          <option value="EFFECTIVELY_ZERO_RATED">Effectively Zero-Rated Local Seller (0% VAT Sales to PEZA / Diplomatic)</option>
                          <option value="EXEMPT">VAT Exempt Seller / Transactions (Section 109 NIRC - Agriculture, Medical, Books)</option>
                          <option value="BMBE">BMBE Micro Enterprise (Barangay Micro Business Enterprise - Income & PT Exempt RA 9178)</option>
                          <option value="COOPERATIVE_EXEMPT">CDA-Registered Cooperative (VAT & PT Exempt on Member Sales - RA 9520)</option>
                        </optgroup>

                        <optgroup label="Government & Top Withholding Tax Agents">
                          <option value="GOVT_WITHHOLDING_AGENT">Government Agency Withholding Agent (5% Final Withholding VAT - Form 1600)</option>
                          <option value="TOP_WITHHOLDING_TAXPAYER">Top Withholding Taxpayer (TWA / TWT Agent - 1% Goods / 2% Services RR 11-2018)</option>
                        </optgroup>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">BIR RDO Code</label>
                      <input 
                        type="text" 
                        value={tax.rdoCode} 
                        onChange={e => setTax({...tax, rdoCode: e.target.value})} 
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        placeholder="e.g., 039 (South Quezon City)" 
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Business Address</label>
                      <input 
                        type="text" 
                        value={company.address} 
                        onChange={e => setCompany({...company, address: e.target.value})} 
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        placeholder="e.g., Metro Manila, Philippines" 
                      />
                    </div>
                  </div>

                  {/* Active Core Engine Specifications Live Display */}
                  {(() => {
                    const activeRules = getBirTaxProfileRules(tax.taxpayerClassification, tax.vatStatus);
                    return (
                      <div className="mt-4 p-4 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl text-left space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Cpu className="w-5 h-5 text-indigo-400" />
                            <span className="text-xs font-black uppercase tracking-wider text-indigo-300">
                              Configured Core Engine Specification:
                            </span>
                            <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 rounded-md font-mono text-xs font-bold">
                              {activeRules.engineCode}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                            Connected System Driver
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                          <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                            <span className="text-slate-400 block font-medium mb-1">Legal Framework & Formula</span>
                            <p className="font-bold text-slate-200">{activeRules.legalFramework}</p>
                            <p className="text-[11px] text-slate-400 mt-1">{activeRules.incomeTaxRateDescription}</p>
                          </div>

                          <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                            <span className="text-slate-400 block font-medium mb-1">BIR Tax Returns Matrix</span>
                            <p className="font-bold text-slate-200">{activeRules.incomeTaxForm}</p>
                            <p className="text-[11px] text-indigo-300 font-semibold mt-1">{activeRules.vatOrPercentageForm}</p>
                          </div>

                          <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                            <span className="text-slate-400 block font-medium mb-1">Sales Invoicing Disclosure</span>
                            <span className="inline-block px-2 py-0.5 bg-indigo-600/30 text-indigo-200 rounded font-bold text-[10px] mb-1">
                              {activeRules.invoiceHeaderBadge}
                            </span>
                            <p className="text-[10px] text-slate-300 italic line-clamp-2">{activeRules.invoiceNotice}</p>
                          </div>
                        </div>

                        {activeRules.applicableAuditChecks.length > 0 && (
                          <div className="pt-2 border-t border-indigo-500/20 text-[11px]">
                            <span className="font-bold text-amber-400 block mb-1">Active Tax Audit Guardian Rules:</span>
                            <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                              {activeRules.applicableAuditChecks.map((check, i) => (
                                <li key={i}>{check}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>


                <div className="pt-4 flex justify-end">
                  <button 
                    type="button" 
                    onClick={handleStep1Next} 
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
                  >
                    Continue to Financial Setup <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: FINANCIAL ENGINE & STORAGE PATH PICKER */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-indigo-600" /> Accounting Period & Storage Path Location
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure opening balances and pick valid storage paths for your company database and backups.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Fiscal Year</label>
                    <input 
                      type="number" 
                      value={accounting.fiscalYear} 
                      onChange={e => setAccounting({...accounting, fiscalYear: parseInt(e.target.value) || 2026})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Functional Currency</label>
                    <input 
                      type="text" 
                      value="PHP (Philippine Peso)" 
                      readOnly 
                      className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 cursor-not-allowed" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Opening Cash Balance (PHP)</label>
                    <input 
                      type="number" 
                      value={accounting.openingCash} 
                      onChange={e => setAccounting({...accounting, openingCash: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="0.00" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Opening Owner Capital (PHP)</label>
                    <input 
                      type="number" 
                      value={accounting.openingCapital} 
                      onChange={e => setAccounting({...accounting, openingCapital: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="0.00" 
                    />
                  </div>
                </div>

                {/* QuickBooks-Style Live BIR Config Badge */}
                <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">BIR Tax Engine Auto-Preset</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Auto-Configured
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-800/80 rounded-xl space-y-1">
                      <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Tax Returns Enabled</span>
                      <p className="font-bold text-slate-100">
                        {tax.vatStatus === 'VAT' ? 'Form 2550Q (Quarterly VAT Return)' : tax.vatStatus === 'NON_VAT' ? 'Form 2551Q (3% Percentage Tax Return)' : 'Exempt / Ecozone Return'}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        {['INDIVIDUAL', 'OPC'].includes(tax.taxpayerClassification) ? 'Form 1701 / 1701A (Individual Income Tax)' : 'Form 1702-RT (Corporate Income Tax)'}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-800/80 rounded-xl space-y-1">
                      <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Auto Chart of Accounts (COA)</span>
                      <p className="font-bold text-indigo-300">
                        {tax.vatStatus === 'NON_VAT' ? 'Percentage Tax Accounts (2210 / 6080)' : 'Output VAT (2020) & Input VAT (1050)'}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Standard Philippine BIR 1000-7000 Account Series
                      </p>
                    </div>
                  </div>
                </div>

                {/* STORAGE SETTINGS & PATH LOCATION PICKER WITH REAL-TIME VALIDATION */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-indigo-600" /> Storage Settings & Directory Paths
                    </h3>
                    <button 
                      type="button" 
                      onClick={() => setShowAdvancedStorage(!showAdvancedStorage)}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                    >
                      <Settings2 className="w-3.5 h-3.5" /> {showAdvancedStorage ? 'Hide Storage Paths' : 'Show Storage Paths'}
                    </button>
                  </div>

                  {showAdvancedStorage && (
                    <div className="p-4 bg-slate-100 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
                      {/* System Storage Company Profile Info Banner */}
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-2.5">
                        <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Production-Safe Storage Architecture</p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                            Company data is stored in user-writable storage (<span className="font-mono font-bold text-indigo-600 dark:text-indigo-300">Documents/LedgerAI Companies/{getSafeName()}</span>) completely separated from Program Files, ensuring permanent write access and seamless backups.
                          </p>
                        </div>
                      </div>

                      {/* Company Profile Path */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Company Profile Storage Path <span className="text-rose-500">*</span>
                          </label>
                          <button 
                            type="button" 
                            onClick={async () => {
                              if (typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder) {
                                try {
                                  const selected = await (window as any).electronAPI.selectFolder({
                                    title: 'Select Company Profile Storage Directory',
                                    defaultPath: computedDocPath
                                  });
                                  if (selected) {
                                    const normalized = selected.replace(/\\/g, '/');
                                    setLocations(prev => ({
                                      ...prev,
                                      documentLocationPath: normalized,
                                      backupLocationPath: prev.backupLocationPath || `${normalized}/backups`
                                    }));
                                    return;
                                  }
                                } catch (e) {
                                  console.warn('Native picker error:', e);
                                }
                              }
                              setShowLocationPickerModal('profile');
                            }}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800"
                          >
                            <FolderOpen className="w-3.5 h-3.5" /> Pick Folder / Native Explorer...
                          </button>
                        </div>

                        <div className="relative">
                          <input 
                            type="text" 
                            value={computedDocPath} 
                            onChange={e => setLocations({...locations, documentLocationPath: e.target.value})} 
                            className={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border rounded-xl text-xs font-mono transition-all ${
                              !docPathValidation.valid 
                                ? 'border-rose-500 focus:ring-2 focus:ring-rose-500 text-rose-600 dark:text-rose-400' 
                                : 'border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200'
                            }`}
                            placeholder="C:/Users/.../Documents/LedgerAI Companies/company_name" 
                          />
                          {docPathValidation.valid && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-3 top-3" />
                          )}
                        </div>

                        {!docPathValidation.valid && (
                          <div className="mt-1.5 p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-900 text-[11px] font-semibold flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                            <span>Invalid Path Location: {docPathValidation.reason}</span>
                          </div>
                        )}
                      </div>

                      {/* Backup Storage Path */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Backup Storage Path <span className="text-rose-500">*</span>
                          </label>
                          <button 
                            type="button" 
                            onClick={async () => {
                              if (typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder) {
                                try {
                                  const selected = await (window as any).electronAPI.selectFolder({
                                    title: 'Select Backup Storage Directory',
                                    defaultPath: computedBackupPath
                                  });
                                  if (selected) {
                                    const normalized = selected.replace(/\\/g, '/');
                                    setLocations(prev => ({
                                      ...prev,
                                      backupLocationPath: normalized
                                    }));
                                    return;
                                  }
                                } catch (e) {
                                  console.warn('Native picker error:', e);
                                }
                              }
                              setShowLocationPickerModal('backup');
                            }}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800"
                          >
                            <FolderOpen className="w-3.5 h-3.5" /> Pick Folder / Native Explorer...
                          </button>
                        </div>

                        <div className="relative">
                          <input 
                            type="text" 
                            value={computedBackupPath} 
                            onChange={e => setLocations({...locations, backupLocationPath: e.target.value})} 
                            className={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border rounded-xl text-xs font-mono transition-all ${
                              !backupPathValidation.valid 
                                ? 'border-rose-500 focus:ring-2 focus:ring-rose-500 text-rose-600 dark:text-rose-400' 
                                : 'border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200'
                            }`}
                            placeholder="C:/Users/.../Documents/LedgerAI Companies/company_name/backups" 
                          />
                          {backupPathValidation.valid && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-3 top-3" />
                          )}
                        </div>

                        {!backupPathValidation.valid && (
                          <div className="mt-1.5 p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-900 text-[11px] font-semibold flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                            <span>Invalid Path Location: {backupPathValidation.reason}</span>
                          </div>
                        )}
                      </div>

                      {/* Path Validation Global Banner */}
                      {!isStorageValid && (
                        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-bold">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Warning: Storage path is invalid. You cannot continue until valid directory locations are selected.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-4 flex justify-between items-center">
                  <button 
                    type="button" 
                    onClick={() => setStep(1)} 
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-bold text-xs uppercase tracking-wide"
                  >
                    Back
                  </button>
                  <button 
                    type="button" 
                    onClick={handleStep2Next} 
                    disabled={!isStorageValid}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:shadow-none transition-all disabled:cursor-not-allowed"
                    title={!isStorageValid ? 'Resolve path validation errors to continue' : ''}
                  >
                    Continue to Admin User <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ADMINISTRATOR ACCOUNT */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <User className="w-5 h-5 text-indigo-600" /> Owner / System Administrator Account
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Set up your credentials to manage this company profile.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Owner / Admin Full Name <span className="text-rose-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={admin.displayName} 
                      onChange={e => setAdmin({...admin, displayName: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="e.g., Juan Dela Cruz" 
                      required 
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Owner Email Address <span className="text-rose-500">*</span>
                    </label>
                    <input 
                      type="email" 
                      value={admin.email} 
                      onChange={e => setAdmin({...admin, email: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      placeholder="admin@company.ph" 
                      required 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Password <span className="text-rose-500">*</span>
                    </label>
                    <input 
                      type="password" 
                      value={admin.password} 
                      onChange={e => setAdmin({...admin, password: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      required 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Confirm Password <span className="text-rose-500">*</span>
                    </label>
                    <input 
                      type="password" 
                      value={admin.confirmPassword} 
                      onChange={e => setAdmin({...admin, confirmPassword: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      required 
                    />
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-900 dark:text-emerald-300 space-y-1">
                    <span className="font-bold">Ready to Launch Company Ledger:</span>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      Clicking below will create an isolated company database, seed the Philippine BIR Chart of Accounts, set up the tax engine for {company.legalName || 'your company'}, and register your administrator user.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex justify-between items-center">
                  <button 
                    type="button" 
                    onClick={() => setStep(2)} 
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-bold text-xs uppercase tracking-wide"
                  >
                    Back
                  </button>
                  <button 
                    type="button" 
                    onClick={handleCreate} 
                    disabled={loading || !isStorageValid}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Initializing Profile...' : 'Create & Initialize Company Profile'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DIRECTORY EXPLORER MODAL */}
      <DirectoryExplorerModal 
        isOpen={showLocationPickerModal !== null}
        onClose={() => setShowLocationPickerModal(null)}
        initialPath={
          showLocationPickerModal === 'profile' 
            ? computedDocPath 
            : showLocationPickerModal === 'backup' 
            ? computedBackupPath 
            : '/data/companies'
        }
        title={
          showLocationPickerModal === 'profile'
            ? "Browse & Select Company Profile Folder"
            : "Browse & Select Backup Storage Folder"
        }
        companyName={company.legalName}
        onSelectPath={(selectedPath) => {
          if (showLocationPickerModal === 'profile') {
            setLocations({ ...locations, documentLocationPath: selectedPath });
          } else if (showLocationPickerModal === 'backup') {
            setLocations({ ...locations, backupLocationPath: selectedPath });
          }
        }}
      />
    </div>
  );
}
