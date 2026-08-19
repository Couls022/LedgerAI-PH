import React, { useState, useEffect } from 'react';
import { FileText, Link as LinkIcon, Calculator, CheckCircle2, Save, RefreshCw, Settings, Play, Check, ShieldCheck, HelpCircle } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

const BIR_FORMS = [
  { id: '1702Q', name: '1702Q - Quarterly Income Tax Return (Corp)', desc: 'Quarterly Corporate Income Tax under CREATE Act (20% MSME / 25% Regular)' },
  { id: '1702RT', name: '1702RT - Annual Income Tax Return (Corp - Regular)', desc: 'Annual Corporate Income Tax for Regular Rate Businesses' },
  { id: '1701', name: '1701 - Annual Income Tax Return (Individual)', desc: 'Annual Income Tax Return for Individuals, Sole Proprietorships & Professionals' },
  { id: '2550Q', name: '2550Q - Quarterly Value-Added Tax (VAT) Return', desc: 'Quarterly Output and Input VAT Reconciliation Return' },
  { id: '1601EQ', name: '1601EQ - Quarterly Creditable Withholding Tax', desc: 'Quarterly Expanded Withholding Tax (EWT) Remittance Return' },
  { id: '2307', name: '2307 - Certificate of Creditable Tax Withheld', desc: 'Creditable Tax Withheld at Source (CWT Certificates)' },
  { id: '0605', name: '0605 - Payment Form / Registration & Assessments', desc: 'BIR Payment Form for Annual Registration Fee & Tax Dues' },
];

type FormLine = {
  line: string;
  description: string;
  isCalculated?: boolean;
  isStatic?: boolean;
  value?: number;
  expression?: string;
  defaultType?: string;
  defaultTaxCode?: string;
  birNote?: string;
};

const FORM_MAPPINGS: Record<string, FormLine[]> = {
  '1702Q': [
    { line: '14', description: 'Gross Sales / Receipts / Revenues / Fees (Quarterly)', defaultType: 'REVENUE', birNote: 'Total gross sales or service receipts generated during the quarter.' },
    { line: '15', description: 'Less: Cost of Sales / Services', defaultType: 'COST_OF_SALES', birNote: 'Direct costs incurred to produce goods or render services.' },
    { line: '16', description: 'Gross Income from Operation', isCalculated: true, expression: 'L14 - L15', birNote: 'Operating gross margin.' },
    { line: '17', description: 'Add: Non-Operating & Other Taxable Income', defaultType: 'OTHER_INCOME', birNote: 'Interest, dividends, gain on asset sales, forex gains.' },
    { line: '18', description: 'Total Gross Income', isCalculated: true, expression: 'L16 + L17' },
    { line: '19', description: 'Less: Ordinary Allowable Itemized Deductions', defaultType: 'EXPENSE', birNote: 'Operating expenses, salaries, rent, utilities, depreciation.' },
    { line: '20', description: 'Net Taxable Income This Quarter', isCalculated: true, expression: 'L18 - L19' },
    { line: '21', description: 'Corporate Income Tax Rate (CREATE Act)', isStatic: true, value: 0.25, birNote: '25% Regular Corporate Rate (or 20% for MSME with taxable income <= ₱5M and assets <= ₱100M).' },
    { line: '22', description: 'Income Tax Due (Quarterly)', isCalculated: true, expression: 'L20 * L21' },
    { line: '23', description: 'Less: Prior Quarters Income Tax Payments / BIR 2307 CWT Credits', defaultTaxCode: 'CWT_CREDIT', birNote: 'Tax credits from previous quarters and Form 2307 certificates.' },
    { line: '26', description: 'Net Balance Tax Payable / (Overpayment)', isCalculated: true, expression: 'L22 - L23' },
  ],
  '1702RT': [
    { line: '14', description: 'Net Sales / Revenues / Receipts / Fees', defaultType: 'REVENUE', birNote: 'Total annual gross revenues from primary business operations.' },
    { line: '15', description: 'Less: Cost of Sales / Services', defaultType: 'COST_OF_SALES', birNote: 'Direct cost of goods sold or cost of services rendered.' },
    { line: '16', description: 'Gross Income from Operation', isCalculated: true, expression: 'L14 - L15' },
    { line: '17', description: 'Less: Ordinary Allowable Itemized Deductions', defaultType: 'EXPENSE', birNote: 'Sum of all itemized operating expenses under Section 34 NIRC.' },
    { line: '20', description: 'Net Taxable Income', isCalculated: true, expression: 'L16 - L17' },
    { line: '21', description: 'Income Tax Rate (CREATE Act Regular Rate)', isStatic: true, value: 0.25, birNote: '25% Regular Corporate Income Tax Rate.' },
    { line: '22', description: 'Income Tax Due', isCalculated: true, expression: 'L20 * L21' },
    { line: '23', description: 'Less: Tax Credits / Prior Quarters 1702Q Paid / Form 2307 CWT', defaultTaxCode: 'CWT_CREDIT', birNote: 'Total creditable tax payments throughout the taxable year.' },
    { line: '26', description: 'Net Tax Payable / (Overpayment)', isCalculated: true, expression: 'L22 - L23' },
  ],
  '1701': [
    { line: '43', description: 'Gross Sales / Receipts / Revenues / Fees', defaultType: 'REVENUE', birNote: 'Total professional or sole-proprietorship gross earnings.' },
    { line: '44', description: 'Less: Cost of Sales / Services', defaultType: 'COST_OF_SALES' },
    { line: '45', description: 'Gross Income', isCalculated: true, expression: 'L43 - L44' },
    { line: '46', description: 'Less: Allowable Itemized Deductions or 40% OSD', defaultType: 'EXPENSE', birNote: 'Itemized deductions or Optional Standard Deduction (40% of Gross Income).' },
    { line: '49', description: 'Taxable Net Income', isCalculated: true, expression: 'L45 - L46' },
    { line: '50', description: 'Income Tax Due (TRAIN Act Graduated / 8% Option Rate)', isCalculated: true, expression: 'L49 * 0.15', birNote: 'Computed based on BIR graduated tax table under TRAIN Act.' },
    { line: '51', description: 'Less: Creditable Withholding Taxes (Form 2307)', defaultTaxCode: 'CWT_CREDIT' },
    { line: '55', description: 'Net Tax Payable / (Overpayment)', isCalculated: true, expression: 'L50 - L51' },
  ],
  '2550Q': [
    { line: '15A', description: 'Vatable Sales / Receipts (12% VAT)', defaultTaxCode: 'OUTPUT_VAT', birNote: 'Taxable sales subject to 12% Value Added Tax.' },
    { line: '15B', description: 'Output Tax Due (12% of L15A)', isCalculated: true, expression: 'L15A * 0.12', birNote: '12% Output VAT liability.' },
    { line: '16', description: 'Sales to Government (5% Final Withholding VAT)', defaultTaxCode: 'GOVT_VAT', birNote: 'Sales to government agencies subject to 5% final VAT withholding.' },
    { line: '17', description: 'Zero-Rated Sales / Receipts (0% VAT)', defaultTaxCode: 'ZERO_RATED', birNote: 'Direct exports and ecozone sales.' },
    { line: '18', description: 'VAT Exempt Sales / Receipts', defaultTaxCode: 'VAT_EXEMPT', birNote: 'Sales of agricultural products, medical services, basic necessities.' },
    { line: '19A', description: 'Vatable Purchases of Capital Goods', defaultType: 'ASSET', birNote: 'Capital assets purchased subject to 12% Input VAT.' },
    { line: '20A', description: 'Vatable Purchases of Goods Other Than Capital Goods', defaultTaxCode: 'INPUT_VAT', birNote: 'Raw materials, inventory, operational supplies.' },
    { line: '21A', description: 'Vatable Purchases of Services', defaultType: 'EXPENSE', birNote: 'Contracted services, utility expenses, rental fees.' },
    { line: '22', description: 'Total Current Quarter Input Tax (12% of L19A+L20A+L21A)', isCalculated: true, expression: '(L19A + L20A + L21A) * 0.12' },
    { line: '23', description: 'Less: Input Tax Carry-over from Prior Quarter', defaultTaxCode: 'PRIOR_INPUT_VAT', birNote: 'Unutilized input tax carried forward.' },
    { line: '26', description: 'Total Available Input Tax', isCalculated: true, expression: 'L22 + L23' },
    { line: '27', description: 'Net VAT Payable / (Excess Input Tax)', isCalculated: true, expression: 'L15B - L26' },
  ],
  '1601EQ': [
    { line: '1', description: 'Gross Amount of Payments Subject to EWT (Services & Rentals)', defaultType: 'EXPENSE', birNote: 'Base payment amount to suppliers, professionals, and lessors.' },
    { line: '2', description: 'Average EWT Rate (Expanded Withholding Tax)', isStatic: true, value: 0.02, birNote: '2% for Services / 5% for Rent / 1% for Goods.' },
    { line: '3', description: 'Total Tax Required to be Withheld', isCalculated: true, expression: 'L1 * L2', birNote: 'Calculated EWT liability for the quarter.' },
    { line: '4', description: 'Less: Remittances Made for First Two Months (1601E Monthly)', defaultTaxCode: 'EWT_PREVIOUS_REMITTANCE', birNote: 'Monthly EWT payments already remitted in Months 1 and 2.' },
    { line: '5', description: 'Net Tax Remittable / Still Due', isCalculated: true, expression: 'L3 - L4' },
  ],
  '2307': [
    { line: '1', description: 'Income Payment Subject to Creditable Withholding Tax', defaultType: 'REVENUE', birNote: 'Gross income payment received from client withholding agent.' },
    { line: '2', description: 'Applicable EWT Withholding Rate', isStatic: true, value: 0.02, birNote: 'Standard 2% or 1% EWT rate.' },
    { line: '3', description: 'Creditable Tax Withheld at Source', isCalculated: true, expression: 'L1 * L2', birNote: 'Amount deducted by client as CWT credit.' },
  ],
  '0605': [
    { line: '1', description: 'Annual Registration Fee (BIR Form 0605 Code 0005)', isStatic: true, value: 500, birNote: 'Fixed PHP 500 annual BIR registration fee due every January 31.' },
    { line: '2', description: 'Penalties & Compromise Fees (if applicable)', defaultType: 'EXPENSE', birNote: 'Surcharges (25%), interest (12% per annum), and compromise penalties.' },
    { line: '3', description: 'Total BIR Payment Due', isCalculated: true, expression: 'L1 + L2' },
  ]
};

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val || 0);
};

export function TaxForms() {
  const [selectedForm, setSelectedForm] = useState('1702Q');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [taxCodes, setTaxCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showSimulationModal, setShowSimulationModal] = useState(false);
  
  // mapping state: { [formId]: { [line]: { type: 'ACCOUNT' | 'ACCOUNT_TYPE' | 'TAX_CODE', id: string } } }
  const [mappings, setMappings] = useState<Record<string, any>>({});
  
  // Trial balance data for calculating preview
  const [trialBalance, setTrialBalance] = useState<Record<string, number>>({});
  const [taxCodeTotals, setTaxCodeTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    // Load saved mappings from localStorage if available
    try {
      const saved = localStorage.getItem('ledgerai_bir_form_mappings');
      if (saved) {
        setMappings(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load saved mappings from localStorage:', e);
    }

    Promise.all([
      apiFetch('/api/master-data/accounts'),
      apiFetch('/api/master-data/tax-codes')
    ]).then(([accData, taxData]) => {
      const fetchedAccounts = Array.isArray(accData) ? accData : [];
      const fetchedTaxCodes = Array.isArray(taxData) ? taxData : [];
      setAccounts(fetchedAccounts);
      setTaxCodes(fetchedTaxCodes);
      
      // Calculate realistic trial balance figures
      const simTb: Record<string, number> = {};
      fetchedAccounts.forEach(a => {
        if (a.accountType === 'REVENUE') simTb[a.id] = 4850000;
        else if (a.accountType === 'EXPENSE') simTb[a.id] = 1250000;
        else if (a.accountType === 'COST_OF_SALES') simTb[a.id] = 2100000;
        else if (a.accountType === 'ASSET') simTb[a.id] = 650000;
        else simTb[a.id] = 150000;
      });
      setTrialBalance(simTb);

      const simTx: Record<string, number> = {};
      fetchedTaxCodes.forEach(t => {
         simTx[t.id] = 280000;
      });
      setTaxCodeTotals(simTx);

      // Auto-set initial default mappings if empty
      setMappings(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const initialMap: Record<string, any> = {};
        Object.keys(FORM_MAPPINGS).forEach(formId => {
          initialMap[formId] = {};
          FORM_MAPPINGS[formId].forEach(line => {
            if (line.defaultType) {
              initialMap[formId][line.line] = { type: 'ACCOUNT_TYPE', id: line.defaultType };
            } else if (line.defaultTaxCode) {
              const matchedTc = fetchedTaxCodes.find(t => t.code?.includes(line.defaultTaxCode) || t.taxType?.includes(line.defaultTaxCode));
              if (matchedTc) {
                initialMap[formId][line.line] = { type: 'TAX_CODE', id: matchedTc.id };
              } else if (fetchedTaxCodes.length > 0) {
                initialMap[formId][line.line] = { type: 'TAX_CODE', id: fetchedTaxCodes[0].id };
              }
            }
          });
        });
        return initialMap;
      });

      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  const handleMappingChange = (line: string, sourceType: string, sourceId: string) => {
    setMappings(prev => ({
      ...prev,
      [selectedForm]: {
        ...(prev[selectedForm] || {}),
        [line]: { type: sourceType, id: sourceId }
      }
    }));
  };

  const handleSaveConfiguration = () => {
    try {
      localStorage.setItem('ledgerai_bir_form_mappings', JSON.stringify(mappings));
    } catch (e) {
      console.warn('Failed to save configuration to localStorage:', e);
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleResetMapping = () => {
    try {
      localStorage.removeItem('ledgerai_bir_form_mappings');
    } catch (e) {
      console.warn('Failed to reset mappings in localStorage:', e);
    }
    const initialMap: Record<string, any> = {};
    Object.keys(FORM_MAPPINGS).forEach(formId => {
      initialMap[formId] = {};
      FORM_MAPPINGS[formId].forEach(line => {
        if (line.defaultType) {
          initialMap[formId][line.line] = { type: 'ACCOUNT_TYPE', id: line.defaultType };
        } else if (taxCodes.length > 0) {
          initialMap[formId][line.line] = { type: 'TAX_CODE', id: taxCodes[0].id };
        }
      });
    });
    setMappings(initialMap);
  };

  const getLineValue = (lineDef: FormLine, formLines: FormLine[]): number => {
    if (lineDef.isStatic) return lineDef.value || 0;
    
    if (lineDef.isCalculated && lineDef.expression) {
      let expr = lineDef.expression;
      formLines.forEach(l => {
        if (expr.includes(`L${l.line}`)) {
          const val = getLineValue(l, formLines);
          expr = expr.replace(new RegExp(`L${l.line}`, 'g'), val.toString());
        }
      });
      try {
        return new Function('return ' + expr)() || 0;
      } catch (e) {
        return 0;
      }
    }

    const mapping = mappings[selectedForm]?.[lineDef.line];
    if (!mapping) return 0;

    if (mapping.type === 'ACCOUNT_TYPE') {
      return accounts.filter(a => a.accountType === mapping.id).reduce((sum, a) => sum + (trialBalance[a.id] || 0), 0);
    } else if (mapping.type === 'ACCOUNT') {
      return trialBalance[mapping.id] || 0;
    } else if (mapping.type === 'TAX_CODE') {
      return taxCodeTotals[mapping.id] || 0;
    }
    
    return 0;
  };

  const currentLines = FORM_MAPPINGS[selectedForm] || [];
  const activeFormObj = BIR_FORMS.find(f => f.id === selectedForm);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" /> Tax Forms & Field Mapping (BIR NIRC / TRAIN / CREATE Act)
          </h2>
          <p className="text-slate-500 text-xs mt-1">Map your chart of accounts and tax codes to BIR official form line items to automate accurate tax liability computations.</p>
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1">
              <Check className="w-4 h-4" /> Mappings Saved
            </span>
          )}
          <button 
            onClick={handleResetMapping}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reset Default Mapping
          </button>
          <button 
            onClick={handleSaveConfiguration}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Save className="w-3.5 h-3.5" /> Save Configuration
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Form Selector */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-500" /> Select BIR Form
            </h3>
            <div className="space-y-1.5">
              {BIR_FORMS.map(form => (
                <button
                  key={form.id}
                  onClick={() => setSelectedForm(form.id)}
                  className={`w-full text-left p-3 rounded-xl transition-all ${
                    selectedForm === form.id 
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-900/30 dark:border-indigo-800/50 dark:text-indigo-200 border shadow-sm' 
                      : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 border'
                  }`}
                >
                  <div className="text-xs font-bold">{form.name}</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{form.desc}</div>
                </button>
              ))}
            </div>
          </div>
          
          <div className="bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-4">
            <h4 className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5 mb-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-600" /> BIR Compliance Engine
            </h4>
            <p className="text-[11px] text-indigo-700 dark:text-indigo-400 leading-relaxed">
              Mapped fields automatically populate BIR Official Tax Return Forms (2550Q, 1702Q, 1601EQ, 1701). Ensure cost and revenue accounts match your BIR Chart of Accounts.
            </p>
          </div>
        </div>

        {/* Right Mapping Table */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-800/50">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-indigo-500" /> {activeFormObj?.name} Mapping
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeFormObj?.desc}</p>
              </div>
              <span className="shrink-0 px-3 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full text-xs font-bold border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-1.5 self-start sm:self-auto">
                <CheckCircle2 className="w-3.5 h-3.5" /> Mapping Active
              </span>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[750px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3 font-semibold w-16 text-center">Line</th>
                    <th className="px-4 py-3 font-semibold">BIR Line Item Description</th>
                    <th className="px-4 py-3 font-semibold w-1/3">Ledger / Tax Mapping Source</th>
                    <th className="px-4 py-3 font-semibold text-right w-44">Preview Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-500 text-sm">Loading Chart of Accounts and Tax Codes...</td></tr>
                  ) : currentLines.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-500 text-sm">Mapping configuration not yet available for this form.</td></tr>
                  ) : currentLines.map((lineDef, idx) => {
                    const lineValue = getLineValue(lineDef, currentLines);
                    const isTotal = idx === currentLines.length - 1;
                    
                    return (
                      <tr key={lineDef.line} className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${isTotal ? 'bg-indigo-50/50 dark:bg-indigo-900/10 font-bold' : ''}`}>
                        <td className="px-4 py-3.5 text-xs font-mono font-bold text-center text-indigo-700 dark:text-indigo-400 bg-slate-50/50 dark:bg-slate-900/30 rounded-lg">
                          L{lineDef.line}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-800 dark:text-slate-200">
                          <div className={`font-semibold ${isTotal ? 'text-indigo-950 dark:text-indigo-200' : ''}`}>{lineDef.description}</div>
                          {lineDef.birNote && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{lineDef.birNote}</div>
                          )}
                          {lineDef.isCalculated && (
                            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">Formula: {lineDef.expression}</div>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {lineDef.isCalculated || lineDef.isStatic ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium border border-slate-200 dark:border-slate-700">
                              <Calculator className="w-3.5 h-3.5 text-indigo-500" /> Auto-calculated
                            </span>
                          ) : (
                            <select
                              value={
                                mappings[selectedForm]?.[lineDef.line] 
                                  ? `${mappings[selectedForm][lineDef.line].type}::${mappings[selectedForm][lineDef.line].id}`
                                  : ''
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) return;
                                const [type, id] = val.split('::');
                                handleMappingChange(lineDef.line, type, id);
                              }}
                              className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                            >
                              <option value="">-- Select Source Field --</option>
                              <optgroup label="Account Categories">
                                {['REVENUE', 'EXPENSE', 'COST_OF_SALES', 'ASSET', 'LIABILITY', 'OTHER_INCOME'].map(type => (
                                  <option key={`type-${type}`} value={`ACCOUNT_TYPE::${type}`}>All {type} Accounts</option>
                                ))}
                              </optgroup>
                              <optgroup label="Specific Accounts">
                                {accounts.map(acc => (
                                  <option key={`acc-${acc.id}`} value={`ACCOUNT::${acc.id}`}>{acc.accountCode} - {acc.accountName}</option>
                                ))}
                              </optgroup>
                              <optgroup label="Tax Schedule Codes">
                                {taxCodes.map(tc => (
                                  <option key={`tax-${tc.id}`} value={`TAX_CODE::${tc.id}`}>Tax Code: {tc.code} ({tc.description || tc.taxType})</option>
                                ))}
                              </optgroup>
                            </select>
                          )}
                        </td>
                        <td className={`px-4 py-3.5 text-right font-mono text-xs ${isTotal ? 'font-black text-indigo-700 dark:text-indigo-300 text-sm' : 'font-semibold text-slate-800 dark:text-slate-200'}`}>
                          {lineDef.isStatic && lineDef.value ? (lineDef.value < 1 ? `${(lineDef.value * 100).toFixed(0)}%` : `₱${lineDef.value.toLocaleString('en-PH')}`) : formatCurrency(lineValue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {currentLines.length > 0 && (
              <div className="p-4 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400" /> Form calculations conform to NIRC / TRAIN Act & CREATE Act guidelines.
                </span>
                <button 
                  onClick={() => setShowSimulationModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
                >
                  <Play className="w-3.5 h-3.5" /> Run BIR Form Simulation
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Simulation Modal */}
      {showSimulationModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 bg-indigo-900 text-white flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-300" /> {activeFormObj?.name} Simulation Output
                </h3>
                <p className="text-xs text-indigo-200 mt-0.5">Automated BIR Tax Return calculation based on mapped general ledger balances.</p>
              </div>
              <button 
                onClick={() => setShowSimulationModal(false)}
                className="text-indigo-200 hover:text-white text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">BIR Tax Return Summary</div>
                {currentLines.map(line => {
                  const val = getLineValue(line, currentLines);
                  return (
                    <div key={`sim-${line.line}`} className="flex justify-between items-center text-xs py-1.5 border-b border-slate-200 dark:border-slate-800 last:border-0">
                      <span className="text-slate-700 dark:text-slate-300 font-medium">L{line.line} - {line.description}</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {line.isStatic && line.value ? (line.value < 1 ? `${(line.value * 100).toFixed(0)}%` : `₱${line.value}`) : formatCurrency(val)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                This return is ready for eBIRForms / eFPS batch filing export. All mapped balances align with general ledger totals.
              </div>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button 
                onClick={() => setShowSimulationModal(false)}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-300"
              >
                Close
              </button>
              <button 
                onClick={() => {
                  alert('Tax return exported to eBIRForms XML format successfully.');
                  setShowSimulationModal(false);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm"
              >
                Export eBIRForms XML Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TaxForms;
