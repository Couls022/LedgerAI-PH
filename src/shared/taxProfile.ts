/**
 * =========================================================================================
 * PHILIPPINE TAX ENGINE PROFILE & REGULATORY RULES
 * =========================================================================================
 * Comprehensive Tax Engine Matrix aligning with:
 *  1. TRAIN Law (RA 10963) & BIR Revenue Regulations (RR) No. 8-2018 & RR 16-2023:
 *     - 8% Optional Flat Income Tax Regime:
 *       * Qualification Ceiling: P3,000,000.00 Gross Annual Sales/Receipts.
 *       * Ineligible Entities: Corporations, OPCs, Partnerships, GPPs, and any entity exceeding P3,000,000.
 *       * Purely Self-Employed / Professionals: Allowed statutory reduction of P250,000.00 against gross sales/receipts.
 *       * Mixed-Income Earners: P250,000.00 deduction is absorbed by compensation income under graduated rates;
 *         business income is subject to 8% tax on the first peso (gross sales) without P250k deduction.
 *       * In Lieu of: Graduated Income Tax under Sec 24(A) AND 3% Percentage Tax under Sec 116.
 *  2. CREATE Act (RA 11534) & Section 116 Percentage Tax:
 *     - Standard Statutory Rate: 3% on Gross Quarterly Sales/Receipts (NIRC Sec 116).
 *     - CREATE Act Temporary Reduction: 1% effective July 1, 2020 through June 30, 2023.
 *     - Reversion to Standard Rate: 3% effective July 1, 2023 onwards.
 *  3. Ease of Paying Taxes (EOPT) Act (RA 11976) & BIR RR 7-2024:
 *     - Primary Document: BIR-registered Sales Invoice for both Sale of Goods and Sale of Services.
 *     - Supplementary Document: Collection Receipt / Official Receipt as supplementary proof of payment or collection.
 * =========================================================================================
 */

export interface BirTaxEngineDriverRules {
  engineCode: string;
  engineName: string;
  taxpayerClassification: string;
  taxpayerClassificationLabel: string;
  vatStatus: string;
  vatStatusLabel: string;
  
  // Tax Core Formula & Legal Framework
  legalFramework: string; // e.g. "CREATE Act (RA 11534) & NIRC Title IV"
  incomeTaxRateDescription: string;
  incomeTaxFormulaType: 'CORPORATE_CREATE' | 'INDIVIDUAL_GRADUATED' | 'FLAT_8_PERCENT' | 'PEZA_5_GIT' | 'PASS_THROUGH_EXEMPT' | 'COOP_RA9520_EXEMPT' | 'NON_PROFIT_SEC30_EXEMPT' | 'FOREIGN_CORP_MX';
  
  // 8% Optional Flat Income Tax Attributes (TRAIN Law RR 8-2018)
  isMixedIncomeEarner?: boolean;
  qualifiesFor8Percent?: boolean;
  statutoryDeduction8PercentCentavos?: number; // 25,000,000 centavos (P250k) for pure self-employed, 0 for mixed-income earner
  qualificationCeiling8PercentCentavos?: number; // 300,000,000 centavos (P3,000,000.00)
  ineligibleFor8PercentReason?: string;

  // Invoicing & AR Calculation Rules
  defaultVatRate: number; // e.g. 0.12, 0.03, 0.05, 0.0
  isVatRegistered: boolean;
  isPercentageTaxRegistered: boolean;
  isSpecialPercentageTax: boolean;
  isVatExempt: boolean;
  isZeroRated: boolean;
  isBmbeExempt: boolean;
  isPezaGIt: boolean;
  invoiceHeaderBadge: string;
  invoiceNotice: string;
  
  // Ledger & Journal Posting Rules
  ledgerPostingRules: {
    salesRevenueAccountCode: string; // e.g. "4010" Sales or "4030" Ecozone/Exempt Sales
    salesTaxPayableAccountCode: string; // e.g. "2020" Output VAT, "2120" Percentage Tax Payable, "2130" GRT Payable
    purchasesInputVatHandling: 'CREDITABLE_INPUT_VAT' | 'EXPENSE_OR_CAPITALIZE' | 'ZERO_RATED_INPUT_VAT';
    cwt2307AssetAccountCode: string; // "1060" Creditable Withholding Tax
    ewtPayableAccountCode: string; // "2030" Expanded Withholding Tax Payable
  };

  // BIR Returns & Filing Matrix
  incomeTaxForm: string; // e.g. Form 1701, 1701A, 1702-RT, 1702-EX, 1702-MX
  vatOrPercentageForm: string; // e.g. Form 2550Q, Form 2551Q, Form 1600
  ewtForm: string; // Form 1601-EQ / 0619E
  withholdingCertForm: string; // Form 2307 / 2306
  isSlspRequired: boolean; // Summary List of Sales & Purchases (SLSP)
  
  // Core Engine Audit Guardian Checks
  applicableAuditChecks: string[];
}

export function getBirTaxProfileRules(
  taxpayerClassification?: string | null,
  vatStatus?: string | null,
  options: { isMixedIncomeEarner?: boolean } = {}
): BirTaxEngineDriverRules {
  const cls = taxpayerClassification || 'CORPORATION';
  const vat = vatStatus || 'VAT';
  const isMixedIncome = !!options.isMixedIncomeEarner;

  // 1. Classification Labels
  const taxpayerLabels: Record<string, string> = {
    CORPORATION: 'Domestic Corporation (Form 1702-RT - 25% / 20% CREATE)',
    INDIVIDUAL: 'Sole Proprietorship / Individual - Graduated Rates (Form 1701/1701A)',
    INDIVIDUAL_8PERCENT: 'Individual Professional / Sole Proprietor - 8% Optional Flat Tax Rate (Form 1701A)',
    OPC: 'One Person Corporation - OPC (Form 1702-RT)',
    PARTNERSHIP: 'General Commercial Partnership (Form 1702-RT)',
    GPP: 'General Professional Partnership - GPP (Form 1702-EX)',
    COOPERATIVE: 'CDA-Registered Cooperative (Form 1702-EX / RA 9520)',
    NON_PROFIT: 'Non-Stock Non-Profit / NGO (Form 1702-EX / Sec 30 NIRC)',
    GOCC: 'Government Agency / GOCC / LGU (Form 1702-RT / Form 1600)',
    RFC: 'Resident Foreign Corp / Branch Office / ROHQ (Form 1702-MX)',
    NRFC: 'Non-Resident Foreign Corp (Final Withholding Tax Agent)',
    JOINT_VENTURE: 'Joint Venture / Consortium (Form 1702-RT / 1702-EX)',
    ESTATE_TRUST: 'Estate or Trust Under Judicial Settlement (Form 1701)'
  };

  // 2. VAT & Tax Status Labels
  const vatLabels: Record<string, string> = {
    VAT: 'Regular Value-Added Tax (12% Output VAT - Form 2550Q / Sec 106 & 108 NIRC)',
    NON_VAT: 'Non-VAT Registered / 3% Percentage Tax (Form 2551Q / Sec 116 NIRC)',
    INDIVIDUAL_8PERCENT_VAT: '8% Optional Flat Tax Rate Regime (In Lieu of Income & Percentage Tax - TRAIN RR 8-2018)',
    PEZA_BOI: 'PEZA / BOI Ecozone Registered (5% Special Gross Income Tax - GIT / 0% VAT - CREATE Act)',
    FREEPORT: 'Freeport Zone Registered (Subic SBMA, Clark CDC, AFAB, CEZA - 5% SCIT / 0% VAT)',
    BOI_ITH: 'BOI Income Tax Holiday (ITH Registered - 12% or 0% VAT Taxpayer)',
    PERCENTAGE_CARRIER: 'Common Carrier / Land Passenger Transport (3% Common Carrier Tax - Sec 117 NIRC)',
    PERCENTAGE_FRANCHISE: 'Franchise Taxpayer (2% Utilities / 3% Radio & TV Broadcasting - Sec 119 NIRC)',
    PERCENTAGE_BANK_GRT: 'Bank & Non-Bank Financial Intermediary (1%-7% Gross Receipts Tax - Sec 121/122 NIRC)',
    PERCENTAGE_AMUSEMENT: 'Amusement & Entertainment Operator (10%-30% Amusement Tax - Sec 125 NIRC)',
    PERCENTAGE_COMMUNICATION: 'Overseas Dispatch / Telecommunications (10% Overseas Communications Tax - Sec 120)',
    PERCENTAGE_INSURANCE: 'Life Insurance Company (2% Premium Tax - Sec 123 NIRC)',
    ZERO_RATED: 'Direct Export Zero-Rated Taxpayer (0% VAT - Direct Export Sec 106/108 NIRC)',
    EFFECTIVELY_ZERO_RATED: 'Effectively Zero-Rated Local Seller (0% VAT Sales to PEZA / Diplomatic Missions)',
    EXEMPT: 'VAT Exempt Seller / Transactions (Section 109 NIRC - Agriculture, Medical, Books, Education)',
    BMBE: 'BMBE Registered Enterprise (Barangay Micro Business Enterprise - Income & Percentage Tax Exempt RA 9178)',
    COOPERATIVE_EXEMPT: 'CDA-Registered Cooperative (VAT & Percentage Tax Exempt on Member Sales - RA 9520)',
    GOVT_WITHHOLDING_AGENT: 'Government Agency Withholding Agent (5% Final Withholding VAT / 3% PT - Form 1600)',
    TOP_WITHHOLDING_TAXPAYER: 'Top Withholding Taxpayer (TWA / TWT - Designated Withholding Agent RR 11-2018)'
  };

  // Build Engine Code Identifier
  const engineCode = `ENG-${cls}-${vat}`;

  // Engine Defaults
  let defaultVatRate = 0.12;
  let isVatRegistered = true;
  let isPercentageTaxRegistered = false;
  let isSpecialPercentageTax = false;
  let isVatExempt = false;
  let isZeroRated = false;
  let isBmbeExempt = false;
  let isPezaGIt = false;
  
  let vatOrPercentageForm = 'BIR Form 2550Q (Quarterly VAT Return)';
  let isSlspRequired = true;
  let invoiceHeaderBadge = '12% VAT REGISTERED';
  let invoiceNotice = 'This document serves as an Official Sales Invoice pursuant to BIR EOPT Act RR 7-2024. Collection Receipt / Official Receipt is supplementary proof of payment or collection.';

  let salesRevenueAccountCode = '4010';
  let salesTaxPayableAccountCode = '2020'; // 2020 Output VAT
  let purchasesInputVatHandling: 'CREDITABLE_INPUT_VAT' | 'EXPENSE_OR_CAPITALIZE' | 'ZERO_RATED_INPUT_VAT' = 'CREDITABLE_INPUT_VAT';

  // 8% Attributes
  let qualifiesFor8Percent: boolean | undefined = undefined;
  let statutoryDeduction8PercentCentavos: number | undefined = undefined;
  let qualificationCeiling8PercentCentavos: number | undefined = undefined;
  let ineligibleFor8PercentReason: string | undefined = undefined;

  const isIndividualClass = cls === 'INDIVIDUAL' || cls === 'INDIVIDUAL_8PERCENT';

  // Specific VAT & Tax Status Engine Drivers
  if (vat === 'NON_VAT') {
    defaultVatRate = 0.0;
    isVatRegistered = false;
    isPercentageTaxRegistered = true;
    salesTaxPayableAccountCode = '2120'; // 2120 Percentage Tax Payable
    purchasesInputVatHandling = 'EXPENSE_OR_CAPITALIZE';
    vatOrPercentageForm = 'BIR Form 2551Q (Quarterly Percentage Tax Return - 3%)';
    isSlspRequired = false;
    invoiceHeaderBadge = 'NON-VAT REGISTERED (3% PERCENTAGE TAX)';
    invoiceNotice = 'NON-VAT REGISTERED TIN. Issued pursuant to BIR Revenue Regulations No. 8-2018 & EOPT Act RR 7-2024.';
  } else if (vat === 'INDIVIDUAL_8PERCENT_VAT') {
    defaultVatRate = 0.0;
    isVatRegistered = false;
    isPercentageTaxRegistered = false;
    salesTaxPayableAccountCode = 'NONE';
    purchasesInputVatHandling = 'EXPENSE_OR_CAPITALIZE';
    vatOrPercentageForm = 'EXEMPT from 3% Percentage Tax (8% Flat Income Tax Option under Form 1701A)';
    isSlspRequired = false;
    invoiceHeaderBadge = 'NON-VAT 8% FLAT RATE TAXPAYER';
    invoiceNotice = 'TAXABLE UNDER 8% FLAT RATE REGIME (TRAIN LAW RR 8-2018). Exempt from Percentage Tax under Sec 116. Primary document: BIR-registered Sales Invoice.';
    
    if (!isIndividualClass) {
      qualifiesFor8Percent = false;
      ineligibleFor8PercentReason = 'Corporations, OPCs, partnerships, and juridical entities are strictly barred from electing the 8% flat income tax option under Section 24(A)(2)(b) NIRC and RR 8-2018.';
    } else {
      qualifiesFor8Percent = true;
      qualificationCeiling8PercentCentavos = 300000000; // P3,000,000.00
      statutoryDeduction8PercentCentavos = isMixedIncome ? 0 : 25000000; // P250k for pure self-employed, 0 for mixed-income
    }
  } else if (vat === 'EXEMPT' || vat === 'COOPERATIVE_EXEMPT') {
    defaultVatRate = 0.0;
    isVatRegistered = false;
    isVatExempt = true;
    salesRevenueAccountCode = '4030'; // VAT Exempt / Special Revenue
    salesTaxPayableAccountCode = 'NONE';
    purchasesInputVatHandling = 'EXPENSE_OR_CAPITALIZE';
    vatOrPercentageForm = 'EXEMPT from VAT & Percentage Tax (BIR Form 1702-EX / RA 9520 / Sec 109)';
    isSlspRequired = false;
    invoiceHeaderBadge = 'VAT-EXEMPT ENTERPRISE';
    invoiceNotice = 'VAT EXEMPT TIN. Issued pursuant to Section 109 NIRC and BIR EOPT Act RR 7-2024.';
  } else if (vat === 'ZERO_RATED' || vat === 'EFFECTIVELY_ZERO_RATED') {
    defaultVatRate = 0.0;
    isVatRegistered = true;
    isZeroRated = true;
    salesRevenueAccountCode = '4020'; // Zero-Rated Revenue
    salesTaxPayableAccountCode = '2020'; // Output VAT 0%
    purchasesInputVatHandling = 'CREDITABLE_INPUT_VAT';
    vatOrPercentageForm = 'BIR Form 2550Q (0% VAT Export Return)';
    isSlspRequired = true;
    invoiceHeaderBadge = vat === 'EFFECTIVELY_ZERO_RATED' ? 'EFFECTIVELY ZERO-RATED (0% VAT)' : 'ZERO-RATED VAT (0% EXPORT)';
    invoiceNotice = 'VAT ZERO-RATED SALES INVOICE. Issued pursuant to Section 106/108 NIRC and EOPT Act.';
  } else if (vat === 'BMBE') {
    defaultVatRate = 0.0;
    isVatRegistered = false;
    isBmbeExempt = true;
    salesTaxPayableAccountCode = 'NONE';
    purchasesInputVatHandling = 'EXPENSE_OR_CAPITALIZE';
    vatOrPercentageForm = 'EXEMPT from Percentage Tax (BMBE Certificate of Authority RA 9178)';
    isSlspRequired = false;
    invoiceHeaderBadge = 'BMBE REGISTERED (TAX EXEMPT)';
    invoiceNotice = 'BMBE CERTIFIED ENTERPRISE (RA 9178). Exempt from Income Tax & Percentage Tax. Primary document: BIR-registered Sales Invoice.';
  } else if (vat === 'PEZA_BOI' || vat === 'FREEPORT') {
    defaultVatRate = 0.0;
    isVatRegistered = false;
    isPezaGIt = true;
    salesRevenueAccountCode = '4030'; // PEZA Ecozone Revenue
    salesTaxPayableAccountCode = '2140'; // 5% GIT Payable
    purchasesInputVatHandling = 'EXPENSE_OR_CAPITALIZE';
    vatOrPercentageForm = 'BIR Form 1702-EX (5% Special Gross Income Tax Return)';
    isSlspRequired = false;
    invoiceHeaderBadge = 'PEZA / FREEPORT ECOZONE ENTERPRISE (5% GIT)';
    invoiceNotice = 'REGISTERED ECOZONE ENTERPRISE. Subject to 5% Special Gross Income Tax (CREATE Act / RA 7916). Primary document: BIR-registered Sales Invoice.';
  } else if (vat === 'PERCENTAGE_CARRIER' || vat === 'PERCENTAGE_FRANCHISE' || vat === 'PERCENTAGE_BANK_GRT' || vat === 'PERCENTAGE_AMUSEMENT') {
    defaultVatRate = 0.0;
    isVatRegistered = false;
    isPercentageTaxRegistered = true;
    isSpecialPercentageTax = true;
    salesTaxPayableAccountCode = '2120';
    purchasesInputVatHandling = 'EXPENSE_OR_CAPITALIZE';
    vatOrPercentageForm = 'BIR Form 2551Q (Special Percentage Tax Return)';
    isSlspRequired = false;
    invoiceHeaderBadge = 'SPECIAL PERCENTAGE TAXPAYER';
    invoiceNotice = 'SPECIAL PERCENTAGE TAXPAYER. Issued pursuant to Title V NIRC and BIR EOPT Act RR 7-2024.';
  } else if (vat === 'TOP_WITHHOLDING_TAXPAYER') {
    defaultVatRate = 0.12;
    isVatRegistered = true;
    salesTaxPayableAccountCode = '2020';
    vatOrPercentageForm = 'BIR Form 2550Q & Form 1601-EQ (Top Withholding Taxpayer Agent)';
    invoiceHeaderBadge = 'TOP WITHHOLDING TAXPAYER (TWA / TWT)';
    invoiceNotice = 'DESIGNATED TOP WITHHOLDING TAXPAYER. Required to withhold 1% on Goods / 2% on Services under RR 11-2018. Primary document: BIR-registered Sales Invoice.';
  }

  // Specific Entity Classification Drivers
  let incomeTaxForm = 'BIR Form 1702-RT (Regular Corporate Income Tax Return)';
  let incomeTaxRateDescription = '25% Regular Corporate Income Tax (20% CREATE Rate for MSME with Net Taxable Income <= P5M)';
  let incomeTaxFormulaType: BirTaxEngineDriverRules['incomeTaxFormulaType'] = 'CORPORATE_CREATE';
  let legalFramework = 'CREATE Act (RA 11534) & NIRC Title II';
  let ewtForm = 'BIR Form 1601-EQ (Quarterly EWT) & Form 0619E';
  let withholdingCertForm = 'BIR Form 2307 (Certificate of Creditable Tax Withheld at Source)';

  if (cls === 'INDIVIDUAL') {
    incomeTaxForm = 'BIR Form 1701 / 1701A (Individual Income Tax Return)';
    incomeTaxRateDescription = 'Graduated Individual Income Tax Rates (0%-35% under TRAIN Law RA 10963)';
    incomeTaxFormulaType = 'INDIVIDUAL_GRADUATED';
    legalFramework = 'TRAIN Law (RA 10963) Sec 24 NIRC';
  } else if (cls === 'INDIVIDUAL_8PERCENT') {
    incomeTaxForm = 'BIR Form 1701A (8% Optional Flat Income Tax Return)';
    qualifiesFor8Percent = true;
    qualificationCeiling8PercentCentavos = 300000000; // P3,000,000.00
    statutoryDeduction8PercentCentavos = isMixedIncome ? 0 : 25000000; // P250k for pure self-employed, 0 for mixed-income

    if (isMixedIncome) {
      incomeTaxRateDescription = '8% Flat Income Tax on Gross Sales/Receipts (Mixed-Income Earner: No P250,000 deduction on business income as exemption applies to compensation income; Exempt from 3% Percentage Tax)';
    } else {
      incomeTaxRateDescription = '8% Flat Income Tax on Gross Sales/Receipts in excess of P250,000 (Purely Self-Employed / Professional; Exempt from 3% Percentage Tax)';
    }
    incomeTaxFormulaType = 'FLAT_8_PERCENT';
    legalFramework = 'TRAIN Law (RA 10963) Sec 24(A)(2)(b) & BIR RR 8-2018 & RR 16-2023';
  } else if (cls === 'OPC') {
    incomeTaxForm = 'BIR Form 1702-RT (One Person Corporation Income Tax)';
    incomeTaxRateDescription = '20% / 25% Corporate Income Tax Rate under CREATE Act for OPC';
    incomeTaxFormulaType = 'CORPORATE_CREATE';
    legalFramework = 'Revised Corporation Code (RA 11232) & CREATE Act';
  } else if (cls === 'PARTNERSHIP') {
    incomeTaxForm = 'BIR Form 1702-RT (General Commercial Partnership Return)';
    incomeTaxRateDescription = '25% / 20% Commercial Partnership Corporate Income Tax Rate';
    incomeTaxFormulaType = 'CORPORATE_CREATE';
    legalFramework = 'NIRC Sec 27 & CREATE Act';
  } else if (cls === 'GPP') {
    incomeTaxForm = 'BIR Form 1702-EX (General Professional Partnership Pass-Through Return)';
    incomeTaxRateDescription = 'Tax-Exempt Pass-Through Entity (Income distributed directly to partners via Form 1701)';
    incomeTaxFormulaType = 'PASS_THROUGH_EXEMPT';
    legalFramework = 'NIRC Sec 26 & RR 2-98';
  } else if (cls === 'COOPERATIVE') {
    incomeTaxForm = 'BIR Form 1702-EX (Cooperative Tax Exempt Return - RA 9520)';
    incomeTaxRateDescription = '0% Corporate Income Tax Exemption on transactions with members (CDA Certificate Required)';
    incomeTaxFormulaType = 'COOP_RA9520_EXEMPT';
    legalFramework = 'Philippine Cooperative Code of 2008 (RA 9520)';
  } else if (cls === 'NON_PROFIT') {
    incomeTaxForm = 'BIR Form 1702-EX (Non-Stock Non-Profit Corporation Return)';
    incomeTaxRateDescription = 'Exempt from Income Tax on Non-Profit Operations under Section 30 of NIRC';
    incomeTaxFormulaType = 'NON_PROFIT_SEC30_EXEMPT';
    legalFramework = 'NIRC Section 30 Tax Exemption Protocol';
  } else if (cls === 'GOCC') {
    incomeTaxForm = 'BIR Form 1702-RT (GOCC Corporate Return)';
    incomeTaxRateDescription = 'Government Owned/Controlled Corporation Income Tax & 5% Final VAT Agent';
    incomeTaxFormulaType = 'CORPORATE_CREATE';
    legalFramework = 'NIRC Sec 27(C) & Sec 114 Government Withholding';
    ewtForm = 'BIR Form 1600 (Government Final VAT) & Form 1601-EQ';
    withholdingCertForm = 'BIR Form 2306 (Certificate of Final Tax Withheld at Source)';
  } else if (cls === 'RFC') {
    incomeTaxForm = 'BIR Form 1702-MX (Resident Foreign Corp Income Tax Return)';
    incomeTaxRateDescription = '25% Corporate Tax on Philippine-sourced Income (Branch Office / ROHQ)';
    incomeTaxFormulaType = 'FOREIGN_CORP_MX';
    legalFramework = 'NIRC Sec 28(A) Resident Foreign Corporations';
  } else if (cls === 'NRFC') {
    incomeTaxForm = 'BIR Form 1601-FQ / 1602 (Final Withholding Tax Agent Return)';
    incomeTaxRateDescription = '25% Final Withholding Tax on Gross Income derived from Philippine Sources';
    incomeTaxFormulaType = 'FOREIGN_CORP_MX';
    legalFramework = 'NIRC Sec 28(B) Non-Resident Foreign Corporations';
    withholdingCertForm = 'BIR Form 2306 (Final Tax Withheld)';
  } else if (cls === 'JOINT_VENTURE') {
    incomeTaxForm = 'BIR Form 1702-RT / 1702-EX (Joint Venture Tax Return)';
    incomeTaxRateDescription = '25% CIT for Commercial JV or Tax-Exempt Pass-Through for Construction/Energy Consortium';
    incomeTaxFormulaType = 'CORPORATE_CREATE';
    legalFramework = 'NIRC Sec 22(B) Construction/Energy Consortium Rules';
  } else if (cls === 'ESTATE_TRUST') {
    incomeTaxForm = 'BIR Form 1701 (Estate / Trust Income Tax Return)';
    incomeTaxRateDescription = 'Graduated Income Tax Rates (0%-35%) under Judicial Settlement';
    incomeTaxFormulaType = 'INDIVIDUAL_GRADUATED';
    legalFramework = 'NIRC Title II Chapter X (Estates & Trusts)';
  }

  // Override Income Tax for BMBE & PEZA
  if (vat === 'BMBE') {
    incomeTaxForm = 'BIR Form 1701/1702-EX (BMBE Income Tax Exempt Return)';
    incomeTaxRateDescription = '0% Income Tax Exemption under Barangay Micro Business Enterprise Act (RA 9178)';
    incomeTaxFormulaType = 'PASS_THROUGH_EXEMPT';
    legalFramework = 'BMBE Act of 2002 (RA 9178)';
  } else if (vat === 'PEZA_BOI' || vat === 'FREEPORT') {
    incomeTaxForm = 'BIR Form 1702-EX (5% Special Gross Income Tax Return)';
    incomeTaxRateDescription = '5% Special Gross Income Tax (3% National Government, 2% LGU Host City)';
    incomeTaxFormulaType = 'PEZA_5_GIT';
    legalFramework = 'Special Economic Zone Act (RA 7916) & CREATE Act';
  }

  // Audit Guardian Checks
  const applicableAuditChecks: string[] = [];
  if (vat === 'NON_VAT') {
    applicableAuditChecks.push('Audit Check: Verify no 12% Output VAT is illegally billed on Non-VAT Sales Invoices (BIR RR 8-2018)');
    applicableAuditChecks.push('Audit Check: Monitor 12-month rolling gross receipts to prevent unauthorized crossing of P3,000,000 VAT threshold');
  } else if (vat === 'VAT') {
    applicableAuditChecks.push('Audit Check: Reconcile 12% Output VAT vs Input VAT ledger balances for Quarterly Form 2550Q filing');
    applicableAuditChecks.push('Audit Check: Validate Summary List of Sales and Purchases (SLSP) completeness against General Ledger');
  } else if (vat === 'BMBE') {
    applicableAuditChecks.push('Audit Check: Verify active DTI/LGU BMBE Certificate of Authority and P3,000,000 asset limit Compliance');
  } else if (vat === 'PEZA_BOI' || vat === 'FREEPORT') {
    applicableAuditChecks.push('Audit Check: Verify PEZA/Freeport Zone Certificate of Registration and 5% Gross Income Tax calculation (3% National / 2% LGU)');
  } else if (vat.startsWith('PERCENTAGE_')) {
    applicableAuditChecks.push('Audit Check: Validate Special Percentage Tax rate applied against Title V NIRC statutory limits');
  }

  if (cls === 'INDIVIDUAL_8PERCENT' || vat === 'INDIVIDUAL_8PERCENT_VAT') {
    applicableAuditChecks.push('Audit Check: Ensure annual gross sales do not exceed P3,000,000 qualification ceiling for 8% flat rate eligibility');
    if (isMixedIncome) {
      applicableAuditChecks.push('Audit Check: Mixed-Income Earner verified: ensure P250,000 statutory deduction is not deducted from business income');
    }
  } else if (cls === 'COOPERATIVE' || vat === 'COOPERATIVE_EXEMPT') {
    applicableAuditChecks.push('Audit Check: Verify active CDA Certificate of Good Standing to maintain RA 9520 tax exemption status');
  } else if (cls === 'GPP') {
    applicableAuditChecks.push('Audit Check: Verify 100% pass-through income allocation to partner BIR Form 1701 filings');
  }

  return {
    engineCode,
    engineName: `${taxpayerLabels[cls] || cls} [${vatLabels[vat] || vat}] Core Engine`,
    taxpayerClassification: cls,
    taxpayerClassificationLabel: taxpayerLabels[cls] || cls,
    vatStatus: vat,
    vatStatusLabel: vatLabels[vat] || vat,
    legalFramework,
    incomeTaxRateDescription,
    incomeTaxFormulaType,
    isMixedIncomeEarner: isMixedIncome,
    qualifiesFor8Percent,
    statutoryDeduction8PercentCentavos,
    qualificationCeiling8PercentCentavos,
    ineligibleFor8PercentReason,
    defaultVatRate,
    isVatRegistered,
    isPercentageTaxRegistered,
    isSpecialPercentageTax,
    isVatExempt,
    isZeroRated,
    isBmbeExempt,
    isPezaGIt,
    invoiceHeaderBadge,
    invoiceNotice,
    ledgerPostingRules: {
      salesRevenueAccountCode,
      salesTaxPayableAccountCode,
      purchasesInputVatHandling,
      cwt2307AssetAccountCode: '1060',
      ewtPayableAccountCode: '2030'
    },
    incomeTaxForm,
    vatOrPercentageForm,
    ewtForm,
    withholdingCertForm,
    isSlspRequired,
    applicableAuditChecks
  };
}

/**
 * Returns the BIR PH Policy designated default VAT & Tax Status for a given Taxpayer Entity Classification.
 * Note: Users may still manually change/override the VAT & Tax Status if their entity has a custom BIR approval (e.g., PEZA, BOI, Voluntary VAT).
 */
export function getDefaultVatStatusForClassification(taxpayerClassification: string): string {
  const norm = (taxpayerClassification || '').toUpperCase().trim();
  switch (norm) {
    case 'INDIVIDUAL_8PERCENT':
      return 'INDIVIDUAL_8PERCENT_VAT'; // 8% Optional Flat Income Tax Regime (TRAIN Law RR 8-2018)
    case 'COOPERATIVE':
      return 'COOPERATIVE_EXEMPT'; // CDA-Registered Cooperative (VAT & PT Exempt RA 9520)
    case 'NON_PROFIT':
      return 'EXEMPT'; // Non-Stock Non-Profit / NGO (Sec 30 NIRC / Sec 109)
    case 'GOCC':
      return 'GOVT_WITHHOLDING_AGENT'; // Government Agency / GOCC (5% Final Withholding VAT / Form 1600)
    case 'INDIVIDUAL':
      return 'NON_VAT'; // Sole Proprietorship / Individual - Default Non-VAT (Percentage Tax 3% Form 2551Q)
    case 'PEZA_BOI':
      return 'PEZA_BOI';
    case 'CORPORATION':
    case 'OPC':
    case 'RFC':
    case 'NRFC':
    case 'PARTNERSHIP':
    case 'GPP':
    case 'JOINT_VENTURE':
    case 'ESTATE_TRUST':
    default:
      return 'VAT'; // Regular Value-Added Tax (12% Output VAT - Form 2550Q / Sec 106 & 108 NIRC)
  }
}
