export type BirQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface Bir2307AtcEntry {
  code: string;
  name: string;
  section: 'EWT' | 'BUSINESS_TAX';
  ratePercent: number;
  taxpayerType: 'CORPORATION' | 'INDIVIDUAL' | 'ALL';
  nature: string;
}

export const BIR_2307_ATC_CATALOG: Bir2307AtcEntry[] = [
  { code: 'WC156', name: 'Income Payments by Top Withholding Agents to Local Suppliers of Goods (Corp)', section: 'EWT', ratePercent: 1.0, taxpayerType: 'CORPORATION', nature: 'Top Withholding Agent — Purchase of Goods (Corporation)' },
  { code: 'WI156', name: 'Income Payments by Top Withholding Agents to Local Suppliers of Goods (Indiv)', section: 'EWT', ratePercent: 1.0, taxpayerType: 'INDIVIDUAL', nature: 'Top Withholding Agent — Purchase of Goods (Individual)' },
  { code: 'WC157', name: 'Income Payments by Top Withholding Agents to Local Suppliers of Services (Corp)', section: 'EWT', ratePercent: 2.0, taxpayerType: 'CORPORATION', nature: 'Top Withholding Agent — Purchase of Services (Corporation)' },
  { code: 'WI157', name: 'Income Payments by Top Withholding Agents to Local Suppliers of Services (Indiv)', section: 'EWT', ratePercent: 2.0, taxpayerType: 'INDIVIDUAL', nature: 'Top Withholding Agent — Purchase of Services (Individual)' },
  { code: 'WC120', name: 'Income Payments to Certain Contractors (Corporation)', section: 'EWT', ratePercent: 2.0, taxpayerType: 'CORPORATION', nature: 'General Engineering / Building / Security / Janitorial Contractors (Corp)' },
  { code: 'WI120', name: 'Income Payments to Certain Contractors (Individual)', section: 'EWT', ratePercent: 2.0, taxpayerType: 'INDIVIDUAL', nature: 'General Engineering / Building / Security / Janitorial Contractors (Indiv)' },
  { code: 'WC100', name: 'Rentals on Real / Personal Property (Corporation)', section: 'EWT', ratePercent: 5.0, taxpayerType: 'CORPORATION', nature: 'Rentals on Real Property / Equipment Used in Business (Corp)' },
  { code: 'WI100', name: 'Rentals on Real / Personal Property (Individual)', section: 'EWT', ratePercent: 5.0, taxpayerType: 'INDIVIDUAL', nature: 'Rentals on Real Property / Equipment Used in Business (Indiv)' },
  { code: 'WC011', name: 'Professional / Management / Technical Fees (Corp — Gross ≤ ₱720k)', section: 'EWT', ratePercent: 10.0, taxpayerType: 'CORPORATION', nature: 'Professional, Consultancy & Technical Fees (Corp ≤ ₱720k)' },
  { code: 'WC010', name: 'Professional / Management / Technical Fees (Corp — Gross > ₱720k)', section: 'EWT', ratePercent: 15.0, taxpayerType: 'CORPORATION', nature: 'Professional, Consultancy & Technical Fees (Corp > ₱720k)' },
  { code: 'WI011', name: 'Professional / Talent Fees (Individual — Gross ≤ ₱3M Non-VAT)', section: 'EWT', ratePercent: 5.0, taxpayerType: 'INDIVIDUAL', nature: 'Professional Fees to Individuals (≤ ₱3M Non-VAT)' },
  { code: 'WI010', name: 'Professional / Talent Fees (Individual — Gross > ₱3M or VAT)', section: 'EWT', ratePercent: 10.0, taxpayerType: 'INDIVIDUAL', nature: 'Professional Fees to Individuals (> ₱3M or VAT-Registered)' },
  { code: 'WC140', name: 'Gross Commissions / Service Fees of Brokers & Agents (Corporation)', section: 'EWT', ratePercent: 10.0, taxpayerType: 'CORPORATION', nature: 'Commissions & Brokerage Fees (Corporation)' },
  { code: 'WI140', name: 'Gross Commissions / Service Fees of Brokers & Agents (Individual)', section: 'EWT', ratePercent: 10.0, taxpayerType: 'INDIVIDUAL', nature: 'Commissions & Brokerage Fees (Individual)' },
  { code: 'WC160', name: 'Income Payments to Beneficiaries of Estates & Trusts / Other Payments (Corp)', section: 'EWT', ratePercent: 2.0, taxpayerType: 'CORPORATION', nature: 'Other Creditable Income Payments (Corporation)' },
  { code: 'WI160', name: 'Income Payments to Other Suppliers / Freight & Logistics (Individual)', section: 'EWT', ratePercent: 2.0, taxpayerType: 'INDIVIDUAL', nature: 'Other Creditable Income Payments (Individual)' },
  { code: 'WV010', name: 'VAT Withholding on Purchase of Goods by Government (5%)', section: 'BUSINESS_TAX', ratePercent: 5.0, taxpayerType: 'ALL', nature: 'Creditable VAT Withheld on Goods (NIRC Sec. 114)' },
  { code: 'WV020', name: 'VAT Withholding on Purchase of Services by Government (5%)', section: 'BUSINESS_TAX', ratePercent: 5.0, taxpayerType: 'ALL', nature: 'Creditable VAT Withheld on Services (NIRC Sec. 114)' },
  { code: 'WB080', name: 'Withholding of Percentage Tax on Non-VAT Suppliers (3%)', section: 'BUSINESS_TAX', ratePercent: 3.0, taxpayerType: 'ALL', nature: 'Percentage Tax Withheld at Source (Sec. 116)' },
];

export const BIR_2307_ATC_MAP = new Map<string, Bir2307AtcEntry>(
  BIR_2307_ATC_CATALOG.map((item) => [item.code.toUpperCase(), item])
);

export interface Form2307ScheduleRow {
  section: 'EWT' | 'BUSINESS_TAX';
  atcCode: string;
  taxRatePercent: number;
  natureOfPayment: string;
  month1GrossPhp: number;
  month2GrossPhp: number;
  month3GrossPhp: number;
  month1TaxPhp: number;
  month2TaxPhp: number;
  month3TaxPhp: number;
  totalGrossPhp: number;
  totalTaxWithheldPhp: number;
  sourceBasis: 'RECORDED_DV' | 'LEDGER_BILL' | 'OVERRIDE';
}

export interface Form2307ComplianceWarning {
  code: 'MISSING_PAYEE_TIN' | 'MISSING_PAYOR_TIN' | 'MISSING_ATC' | 'UNWITHHELD_BILLS' | 'EWT_VARIANCE' | 'NO_ACTIVITY';
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
}

export interface Form2307SourceBill {
  billId: string;
  billNumber: string;
  billDate: string;
  grossPhp: number;
  netOfVatPhp: number;
  vatPhp: number;
  status: string;
  atcCode: string;
}

export interface Form2307SourcePayment {
  paymentId: string;
  paymentNumber: string;
  paymentDate: string;
  cashPaidPhp: number;
  ewtWithheldPhp: number;
  paymentMethod: string;
  reference: string | null;
}

export interface Form2307Certificate {
  certificateControlNo: string;
  atcStatus: 'RESOLVED' | 'MISSING_ATC';
  issuanceStatus: 'DRAFT' | 'ISSUED';
  issuedFilingId?: string | null;
  issuedAt?: string | null;
  periodFrom: string;
  periodTo: string;
  statutoryDeadline: string;
  quarter: BirQuarter;
  year: number;
  monthLabels: [string, string, string];
  dateIssued: string;
  payor: {
    tin: string | null;
    tinSegments: [string, string, string, string];
    legalName: string | null;
    tradeName: string | null;
    address: string | null;
    zipCode: string;
    rdoCode: string | null;
    branchCode: string;
  };
  payee: {
    vendorId: string;
    vendorCode: string;
    tin: string | null;
    tinSegments: [string, string, string, string];
    legalName: string;
    tradeName: string;
    address: string | null;
    zipCode: string;
    foreignAddress: string;
    taxpayerType: string | null;
    vatStatus: string | null;
  };
  apRecordsCount: {
    billsCount: number;
    paymentsCount: number;
  };
  schedule: Form2307ScheduleRow[];
  ewtSchedule: Form2307ScheduleRow[];
  businessTaxSchedule: Form2307ScheduleRow[];
  totals: {
    month1GrossPhp: number;
    month2GrossPhp: number;
    month3GrossPhp: number;
    grossPaymentPhp: number;
    taxWithheldPhp: number;
    recordedDvEwtPhp: number;
    computedLedgerEwtPhp: number;
    variancePhp: number;
    vatExcludedPhp: number;
  };
  warnings: Form2307ComplianceWarning[];
  sourceBills: Form2307SourceBill[];
  sourcePayments: Form2307SourcePayment[];
  signatory: {
    name: string;
    designation: string;
    tin: string | null;
  };
}

export interface LedgerBillInput {
  id: string;
  billNumber: string;
  billDate: string;
  totalAmountCentavos: number;
  status: string;
  lines: Array<{
    amountCentavos: number;
    taxCode?: string | null;
    taxType?: string | null;
    taxRatePercent?: number | null;
  }>;
}

export interface LedgerPaymentInput {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amountCentavos: number;
  withholdingTaxAmountCentavos: number;
  paymentMethod?: string | null;
  reference?: string | null;
}

export interface PayorInput {
  tin?: string | null;
  branchCode?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  address?: string | null;
  rdoCode?: string | null;
}

export interface PayeeInput {
  id: string;
  code: string;
  legalName: string;
  tradeName?: string | null;
  tin?: string | null;
  address?: string | null;
  taxClassification?: string | null;
  vatStatus?: string | null;
  withholdingApplicability?: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Splits any Philippine TIN into official BIR Form 2307 4-box segments: [3, 3, 3, 5].
 * Handles 9-digit (TIN only), 12-digit (3-3-3-3), or 14-digit (3-3-3-5) inputs.
 */
export function formatBirTinSegments(
  tin?: string | null,
  branchCode?: string | null
): [string, string, string, string] {
  const digits = String(tin || '').replace(/\D/g, '');
  if (!digits) {
    return ['', '', '', ''];
  }
  const s1 = digits.slice(0, 3).padEnd(3, '0');
  const s2 = digits.slice(3, 6).padEnd(3, '0');
  const s3 = digits.slice(6, 9).padEnd(3, '0');
  let rawBranch = digits.slice(9, 14);
  if (!rawBranch && branchCode) {
    rawBranch = String(branchCode).replace(/\D/g, '').slice(0, 5);
  }
  const s4 = (rawBranch || '00000').padStart(5, '0').slice(-5);
  return [s1, s2, s3, s4];
}

export function formatBirTinDisplay(
  tin?: string | null,
  branchCode?: string | null
): string {
  const [s1, s2, s3, s4] = formatBirTinSegments(tin, branchCode);
  if (!s1) return 'NOT SET';
  return `${s1}-${s2}-${s3}-${s4}`;
}

/**
 * Extracts a 4-digit Philippine ZIP code from an address string if present.
 */
export function extractPhZipCode(address?: string | null): string {
  if (!address) return '';
  const matches = String(address).match(/\b(\d{4})\b/g);
  if (!matches || matches.length === 0) return '';
  // Prefer the last 4-digit code (typical PH address format ends with City + 4-digit ZIP)
  for (let i = matches.length - 1; i >= 0; i--) {
    const num = Number(matches[i]);
    if (num >= 1000 && num <= 9899) {
      return matches[i];
    }
  }
  return '';
}

/**
 * Converts YYYY-MM-DD into official BIR Form 2307 MM / DD / YYYY header boxes.
 */
export function formatForm2307PeriodBoxes(isoDate: string): { mm: string; dd: string; yyyy: string } {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return { mm: '', dd: '', yyyy: '' };
  }
  return {
    yyyy: match[1],
    mm: match[2],
    dd: match[3],
  };
}

/**
 * Computes exact quarter date bounds, month indices, month labels, and BIR statutory
 * 2307 issuance deadline (20th day of the month following close of the taxable quarter).
 */
export function getQuarterDateBounds(year: number, quarter: BirQuarter): {
  quarterNumber: 1 | 2 | 3 | 4;
  periodFrom: string;
  periodTo: string;
  deadlineDate: string;
  months: [number, number, number];
  monthLabels: [string, string, string];
} {
  const qMap: Record<BirQuarter, 1 | 2 | 3 | 4> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
  const quarterNumber = qMap[quarter];
  const m1 = (quarterNumber - 1) * 3 + 1;
  const m2 = m1 + 1;
  const m3 = m1 + 2;
  const lastDayOfM3 = new Date(Date.UTC(year, m3, 0)).getUTCDate();

  const periodFrom = `${year}-${String(m1).padStart(2, '0')}-01`;
  const periodTo = `${year}-${String(m3).padStart(2, '0')}-${String(lastDayOfM3).padStart(2, '0')}`;

  // BIR RR 2-98 Sec 2.58(B): Form 2307 must be issued on or before the 20th day
  // following the close of the taxable quarter.
  const deadlineYear = quarterNumber === 4 ? year + 1 : year;
  const deadlineMonth = quarterNumber === 4 ? 1 : m3 + 1;
  const deadlineDate = `${deadlineYear}-${String(deadlineMonth).padStart(2, '0')}-20`;

  return {
    quarterNumber,
    periodFrom,
    periodTo,
    deadlineDate,
    months: [m1, m2, m3],
    monthLabels: [MONTH_NAMES[m1 - 1], MONTH_NAMES[m2 - 1], MONTH_NAMES[m3 - 1]],
  };
}

/**
 * Computes BIR statutory EWT income payment base (net of 12% VAT per BIR RR 2-98).
 */
export function computeNetOfVatBaseCentavos(
  grossCentavos: number,
  explicitVatCentavos: number | null | undefined,
  isVatApplicable: boolean
): { netOfVatCentavos: number; vatCentavos: number } {
  const safeGross = Math.max(0, Math.round(grossCentavos || 0));
  if (safeGross === 0) {
    return { netOfVatCentavos: 0, vatCentavos: 0 };
  }
  if (typeof explicitVatCentavos === 'number' && explicitVatCentavos > 0 && explicitVatCentavos < safeGross) {
    return {
      netOfVatCentavos: safeGross - Math.round(explicitVatCentavos),
      vatCentavos: Math.round(explicitVatCentavos),
    };
  }
  if (isVatApplicable) {
    const net = Math.round(safeGross / 1.12);
    return {
      netOfVatCentavos: net,
      vatCentavos: safeGross - net,
    };
  }
  return { netOfVatCentavos: safeGross, vatCentavos: 0 };
}

function isIndividualTaxpayer(taxClassification?: string | null): boolean {
  const norm = String(taxClassification || '').toUpperCase();
  return norm.includes('INDIV') || norm.includes('SOLE') || norm.includes('SINGLE');
}

function isAtcCode(code?: string | null): boolean {
  if (!code) return false;
  const upper = String(code).trim().toUpperCase();
  return BIR_2307_ATC_MAP.has(upper) || /^(WC|WI|WV|WB|WF)\d{3}$/.test(upper);
}

/**
 * Resolves the best BIR Form 2307 ATC code for a bill or vendor from explicit line codes,
 * vendor withholding applicability metadata, or effective recorded EWT rate.
 */
export function resolveAtcCode(params: {
  overrideAtc?: string | null;
  lineTaxCodes?: Array<string | null | undefined>;
  vendorWithholdingApplicability?: string | null;
  vendorTaxClassification?: string | null;
  effectiveRatePercent?: number | null;
}): { code: string; ratePercent: number; nature: string; section: 'EWT' | 'BUSINESS_TAX' } {
  const isIndiv = isIndividualTaxpayer(params.vendorTaxClassification);

  const lookup = (candidate: string) => {
    const upper = candidate.trim().toUpperCase();
    const meta = BIR_2307_ATC_MAP.get(upper);
    if (meta) {
      return {
        code: meta.code,
        ratePercent: meta.ratePercent,
        nature: meta.nature,
        section: meta.section,
      };
    }
    if (/^(WV|WB)\d{3}$/.test(upper)) {
      return { code: upper, ratePercent: 5, nature: 'Money Payments Subject to Business Tax Withholding', section: 'BUSINESS_TAX' as const };
    }
    if (/^(WC|WI|WF)\d{3}$/.test(upper)) {
      return { code: upper, ratePercent: 2, nature: 'Creditable Income Tax Withheld at Source', section: 'EWT' as const };
    }
    return null;
  };

  if (params.overrideAtc && params.overrideAtc.trim()) {
    const found = lookup(params.overrideAtc);
    if (found) return found;
    return {
      code: params.overrideAtc.trim().toUpperCase(),
      ratePercent: 0,
      nature: 'Custom BIR Alphanumeric Tax Code (ATC)',
      section: 'EWT',
    };
  }

  for (const rawCode of params.lineTaxCodes || []) {
    if (isAtcCode(rawCode)) {
      const found = lookup(rawCode!);
      if (found) return found;
    }
  }

  // Check vendor withholdingApplicability string for an embedded ATC code (e.g. "WC157 - Services 2%")
  const whtText = String(params.vendorWithholdingApplicability || '').toUpperCase();
  const embeddedMatch = whtText.match(/\b(WC\d{3}|WI\d{3}|WV\d{3}|WB\d{3})\b/);
  if (embeddedMatch) {
    const found = lookup(embeddedMatch[1]);
    if (found) return found;
  }

  // Check explicit rate keywords in vendor withholdingApplicability or effective DV EWT rate
  const inferByRate = (rate: number) => {
    if (Math.abs(rate - 1) <= 0.15) return lookup(isIndiv ? 'WI156' : 'WC156')!;
    if (Math.abs(rate - 2) <= 0.15) return lookup(isIndiv ? 'WI157' : 'WC157')!;
    if (Math.abs(rate - 5) <= 0.25) return lookup(isIndiv ? 'WI100' : 'WC100')!;
    if (Math.abs(rate - 10) <= 0.25) return lookup(isIndiv ? 'WI010' : 'WC011')!;
    if (Math.abs(rate - 15) <= 0.25) return lookup('WC010')!;
    return null;
  };

  if (typeof params.effectiveRatePercent === 'number' && params.effectiveRatePercent > 0) {
    const inferred = inferByRate(params.effectiveRatePercent);
    if (inferred) return inferred;
  }

  if (whtText.includes('1%') || whtText.includes('GOODS')) {
    return lookup(isIndiv ? 'WI156' : 'WC156')!;
  }
  if (whtText.includes('2%') || whtText.includes('SERVICE') || whtText.includes('CONTRACTOR') || whtText === 'EWT' || whtText === 'YES' || whtText === 'APPLICABLE') {
    return lookup(isIndiv ? 'WI157' : 'WC157')!;
  }
  if (whtText.includes('5%') || whtText.includes('RENT')) {
    return lookup(isIndiv ? 'WI100' : 'WC100')!;
  }
  if (whtText.includes('10%') || whtText.includes('PROFESSIONAL')) {
    return lookup(isIndiv ? 'WI010' : 'WC011')!;
  }

  return {
    code: 'UNASSIGNED_ATC',
    ratePercent: 0,
    nature: 'ATC Not Assigned — Select Official BIR ATC Code',
    section: 'EWT',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure deterministic builder for an official BIR Form 2307 certificate from ledger records.
 */
export function buildForm2307Certificate(args: {
  payor: PayorInput;
  payee: PayeeInput;
  year: number;
  quarter: BirQuarter;
  bills: LedgerBillInput[];
  payments: LedgerPaymentInput[];
  overrideAtc?: string | null;
  overrideRatePercent?: number | null;
  dateIssued?: string;
  signatory: {
    name: string;
    designation: string;
    tin?: string | null;
  };
  issuedRecord?: {
    filingId: string;
    issuedAt?: string | null;
  } | null;
}): Form2307Certificate {
  const bounds = getQuarterDateBounds(args.year, args.quarter);
  const [m1, m2, m3] = bounds.months;

  const qBills = args.bills.filter((b) => {
    const d = typeof b.billDate === 'string' ? b.billDate.slice(0, 10) : '';
    return d >= bounds.periodFrom && d <= bounds.periodTo;
  });
  const qPayments = args.payments.filter((p) => {
    const d = typeof p.paymentDate === 'string' ? p.paymentDate.slice(0, 10) : '';
    return d >= bounds.periodFrom && d <= bounds.periodTo;
  });

  const isVendorVat = String(args.payee.vatStatus || '').toUpperCase() === 'VAT' ||
    String(args.payee.vatStatus || '').toUpperCase() === 'VAT_REGISTERED';

  const recordedDvEwtCentavos = qPayments.reduce((s, p) => s + Math.max(0, Math.round(p.withholdingTaxAmountCentavos || 0)), 0);

  // First pass: compute net-of-VAT income base per bill so we know effective rate if DVs recorded EWT
  const analyzedBills = qBills.map((b) => {
    const lineSumCentavos = b.lines.reduce((s, l) => s + Math.max(0, Math.round(l.amountCentavos || 0)), 0);
    const hasVatLine = b.lines.some((l) => {
      const code = String(l.taxCode || '').toUpperCase();
      const type = String(l.taxType || '').toUpperCase();
      return type === 'VAT' || type === 'INPUT_VAT' || code.includes('VAT') || code === 'VT102' || code === 'VT103';
    });
    // If sum of pre-VAT line amounts is strictly less than gross bill total (e.g. 5,000 lines + 600 VAT = 5,600 total),
    // the exact VAT is totalAmount - lineSum!
    let explicitVatCentavos: number | null = null;
    if (lineSumCentavos > 0 && lineSumCentavos < b.totalAmountCentavos) {
      const diff = b.totalAmountCentavos - lineSumCentavos;
      // Validate diff is approximately 12% VAT (within tolerance) or VAT line flagged
      const impliedRate = diff / lineSumCentavos;
      if (hasVatLine || (impliedRate >= 0.11 && impliedRate <= 0.13)) {
        explicitVatCentavos = diff;
      }
    }

    const { netOfVatCentavos, vatCentavos } = computeNetOfVatBaseCentavos(
      b.totalAmountCentavos,
      explicitVatCentavos,
      isVendorVat || hasVatLine
    );

    const monthNum = Number(String(b.billDate).slice(5, 7));
    const lineTaxCodes = b.lines.map((l) => l.taxCode);

    return {
      bill: b,
      monthNum,
      netOfVatCentavos,
      vatCentavos,
      lineTaxCodes,
    };
  });

  const totalBillNetBaseCentavos = analyzedBills.reduce((s, item) => s + item.netOfVatCentavos, 0);
  const totalVatExcludedCentavos = analyzedBills.reduce((s, item) => s + item.vatCentavos, 0);

  // Determine effective EWT rate if payments recorded EWT directly on DVs
  let effectiveRatePercent: number | null = null;
  if (recordedDvEwtCentavos > 0) {
    if (totalBillNetBaseCentavos > 0) {
      effectiveRatePercent = round2((recordedDvEwtCentavos / totalBillNetBaseCentavos) * 100);
    } else {
      const dvGrossCentavos = qPayments.reduce((s, p) => s + Math.max(0, p.amountCentavos + p.withholdingTaxAmountCentavos), 0);
      if (dvGrossCentavos > 0) {
        const dvNetBase = isVendorVat ? Math.round(dvGrossCentavos / 1.12) : dvGrossCentavos;
        effectiveRatePercent = dvNetBase > 0 ? round2((recordedDvEwtCentavos / dvNetBase) * 100) : null;
      }
    }
  }

  // Group schedule buckets by ATC code
  type Bucket = {
    section: 'EWT' | 'BUSINESS_TAX';
    atcCode: string;
    taxRatePercent: number;
    natureOfPayment: string;
    m1Base: number;
    m2Base: number;
    m3Base: number;
    m1RecordedTax: number;
    m2RecordedTax: number;
    m3RecordedTax: number;
  };
  const buckets = new Map<string, Bucket>();

  const getOrCreateBucket = (resolved: { code: string; ratePercent: number; nature: string; section: 'EWT' | 'BUSINESS_TAX' }) => {
    const rate = typeof args.overrideRatePercent === 'number' && !Number.isNaN(args.overrideRatePercent)
      ? args.overrideRatePercent
      : resolved.ratePercent;
    const key = `${resolved.section}:${resolved.code}`;
    let existing = buckets.get(key);
    if (!existing) {
      existing = {
        section: resolved.section,
        atcCode: resolved.code,
        taxRatePercent: rate,
        natureOfPayment: resolved.nature,
        m1Base: 0,
        m2Base: 0,
        m3Base: 0,
        m1RecordedTax: 0,
        m2RecordedTax: 0,
        m3RecordedTax: 0,
      };
      buckets.set(key, existing);
    }
    return existing;
  };

  const sourceBills: Form2307SourceBill[] = [];
  for (const item of analyzedBills) {
    const resolved = resolveAtcCode({
      overrideAtc: args.overrideAtc,
      lineTaxCodes: item.lineTaxCodes,
      vendorWithholdingApplicability: args.payee.withholdingApplicability,
      vendorTaxClassification: args.payee.taxClassification,
      effectiveRatePercent,
    });
    const bucket = getOrCreateBucket(resolved);
    if (item.monthNum === m1) bucket.m1Base += item.netOfVatCentavos;
    else if (item.monthNum === m2) bucket.m2Base += item.netOfVatCentavos;
    else if (item.monthNum === m3) bucket.m3Base += item.netOfVatCentavos;

    sourceBills.push({
      billId: item.bill.id,
      billNumber: item.bill.billNumber,
      billDate: String(item.bill.billDate || '').slice(0, 10),
      grossPhp: round2(item.bill.totalAmountCentavos / 100),
      netOfVatPhp: round2(item.netOfVatCentavos / 100),
      vatPhp: round2(item.vatCentavos / 100),
      status: item.bill.status,
      atcCode: bucket.atcCode,
    });
  }

  // If there are posted supplier payments with EWT in the quarter, distribute/attach them cleanly
  // (Handles cases where DVs exist in Q4 for bills dated in Q3, or standalone DVs with EWT!)
  const sourcePayments: Form2307SourcePayment[] = qPayments.map((p) => ({
    paymentId: p.id,
    paymentNumber: p.paymentNumber,
    paymentDate: String(p.paymentDate || '').slice(0, 10),
    cashPaidPhp: round2((p.amountCentavos || 0) / 100),
    ewtWithheldPhp: round2((p.withholdingTaxAmountCentavos || 0) / 100),
    paymentMethod: p.paymentMethod || 'BANK_TRANSFER',
    reference: p.reference || null,
  }));

  if (qPayments.length > 0 && buckets.size === 0) {
    // No bills dated in this quarter, but supplier disbursement vouchers were posted in this quarter
    const resolved = resolveAtcCode({
      overrideAtc: args.overrideAtc,
      vendorWithholdingApplicability: args.payee.withholdingApplicability,
      vendorTaxClassification: args.payee.taxClassification,
      effectiveRatePercent,
    });
    const bucket = getOrCreateBucket(resolved);
    for (const p of qPayments) {
      const monthNum = Number(String(p.paymentDate).slice(5, 7));
      const grossSettled = Math.max(0, (p.amountCentavos || 0) + (p.withholdingTaxAmountCentavos || 0));
      const { netOfVatCentavos } = computeNetOfVatBaseCentavos(grossSettled, null, isVendorVat);
      if (monthNum === m1) {
        bucket.m1Base += netOfVatCentavos;
        bucket.m1RecordedTax += Math.max(0, p.withholdingTaxAmountCentavos || 0);
      } else if (monthNum === m2) {
        bucket.m2Base += netOfVatCentavos;
        bucket.m2RecordedTax += Math.max(0, p.withholdingTaxAmountCentavos || 0);
      } else if (monthNum === m3) {
        bucket.m3Base += netOfVatCentavos;
        bucket.m3RecordedTax += Math.max(0, p.withholdingTaxAmountCentavos || 0);
      }
    }
  } else if (qPayments.length > 0 && buckets.size === 1) {
    // Single ATC bucket: attach exact recorded monthly DV EWT amounts
    const onlyBucket = Array.from(buckets.values())[0];
    for (const p of qPayments) {
      const monthNum = Number(String(p.paymentDate).slice(5, 7));
      const ewt = Math.max(0, p.withholdingTaxAmountCentavos || 0);
      if (monthNum === m1) onlyBucket.m1RecordedTax += ewt;
      else if (monthNum === m2) onlyBucket.m2RecordedTax += ewt;
      else if (monthNum === m3) onlyBucket.m3RecordedTax += ewt;
    }
  }

  // Ensure at least one placeholder row if no transactions in period
  if (buckets.size === 0) {
    const resolved = resolveAtcCode({
      overrideAtc: args.overrideAtc,
      vendorWithholdingApplicability: args.payee.withholdingApplicability,
      vendorTaxClassification: args.payee.taxClassification,
    });
    getOrCreateBucket(resolved);
  }

  const hasExplicitOverride = Boolean(args.overrideAtc && args.overrideAtc.trim()) ||
    (typeof args.overrideRatePercent === 'number' && !Number.isNaN(args.overrideRatePercent));

  const schedule: Form2307ScheduleRow[] = [];
  let computedLedgerEwtCentavos = 0;

  for (const bucket of buckets.values()) {
    const totalBaseCentavos = bucket.m1Base + bucket.m2Base + bucket.m3Base;
    const rateDecimal = Math.max(0, bucket.taxRatePercent) / 100;
    const computedM1 = Math.round(bucket.m1Base * rateDecimal);
    const computedM2 = Math.round(bucket.m2Base * rateDecimal);
    const computedM3 = Math.round(bucket.m3Base * rateDecimal);
    const computedTotal = Math.round(totalBaseCentavos * rateDecimal);
    computedLedgerEwtCentavos += computedTotal;

    const bucketRecordedTotal = bucket.m1RecordedTax + bucket.m2RecordedTax + bucket.m3RecordedTax;
    const useRecordedDv = !hasExplicitOverride && bucketRecordedTotal > 0;

    const finalM1Tax = useRecordedDv ? bucket.m1RecordedTax : computedM1;
    const finalM2Tax = useRecordedDv ? bucket.m2RecordedTax : computedM2;
    const finalM3Tax = useRecordedDv ? bucket.m3RecordedTax : computedM3;
    const finalTotalTax = useRecordedDv ? bucketRecordedTotal : computedTotal;

    schedule.push({
      section: bucket.section,
      atcCode: bucket.atcCode,
      taxRatePercent: round2(bucket.taxRatePercent),
      natureOfPayment: bucket.natureOfPayment,
      month1GrossPhp: round2(bucket.m1Base / 100),
      month2GrossPhp: round2(bucket.m2Base / 100),
      month3GrossPhp: round2(bucket.m3Base / 100),
      month1TaxPhp: round2(finalM1Tax / 100),
      month2TaxPhp: round2(finalM2Tax / 100),
      month3TaxPhp: round2(finalM3Tax / 100),
      totalGrossPhp: round2(totalBaseCentavos / 100),
      totalTaxWithheldPhp: round2(finalTotalTax / 100),
      sourceBasis: hasExplicitOverride ? 'OVERRIDE' : useRecordedDv ? 'RECORDED_DV' : 'LEDGER_BILL',
    });
  }

  const ewtSchedule = schedule.filter((r) => r.section === 'EWT');
  const businessTaxSchedule = schedule.filter((r) => r.section === 'BUSINESS_TAX');

  const month1GrossPhp = round2(schedule.reduce((s, r) => s + r.month1GrossPhp, 0));
  const month2GrossPhp = round2(schedule.reduce((s, r) => s + r.month2GrossPhp, 0));
  const month3GrossPhp = round2(schedule.reduce((s, r) => s + r.month3GrossPhp, 0));
  const grossPaymentPhp = round2(schedule.reduce((s, r) => s + r.totalGrossPhp, 0));
  const taxWithheldPhp = round2(schedule.reduce((s, r) => s + r.totalTaxWithheldPhp, 0));
  const recordedDvEwtPhp = round2(recordedDvEwtCentavos / 100);
  const computedLedgerEwtPhp = round2(computedLedgerEwtCentavos / 100);
  const variancePhp = round2(recordedDvEwtPhp - computedLedgerEwtPhp);

  const warnings: Form2307ComplianceWarning[] = [];
  const payorTinSegments = formatBirTinSegments(args.payor.tin, args.payor.branchCode);
  const payeeTinSegments = formatBirTinSegments(args.payee.tin);

  if (!payorTinSegments[0]) {
    warnings.push({
      code: 'MISSING_PAYOR_TIN',
      severity: 'ERROR',
      message: 'Payor (Company) TIN is missing. Update Company Profile in Master Data before official BIR filing.',
    });
  }
  if (!payeeTinSegments[0]) {
    warnings.push({
      code: 'MISSING_PAYEE_TIN',
      severity: 'ERROR',
      message: `Payee TIN is missing for ${args.payee.legalName}. BIR Form 2307 requires a valid 9-to-14 digit TIN.`,
    });
  }
  const hasMissingAtc = schedule.some((r) => r.atcCode === 'UNASSIGNED_ATC');
  if (hasMissingAtc && grossPaymentPhp > 0) {
    warnings.push({
      code: 'MISSING_ATC',
      severity: 'WARNING',
      message: 'No BIR ATC code assigned on vendor or bill lines. Select an official ATC code (e.g., WC156 / WC157) to compute EWT.',
    });
  }
  if (grossPaymentPhp > 0 && recordedDvEwtPhp === 0) {
    warnings.push({
      code: 'UNWITHHELD_BILLS',
      severity: 'INFO',
      message: 'Posted bills found in period without recorded Disbursement Voucher EWT. Preview reflects computed EWT base until DV settlement.',
    });
  }
  if (recordedDvEwtPhp > 0 && computedLedgerEwtPhp > 0 && Math.abs(variancePhp) >= 1) {
    warnings.push({
      code: 'EWT_VARIANCE',
      severity: 'WARNING',
      message: `Recorded DV EWT (₱${recordedDvEwtPhp.toFixed(2)}) differs from computed ledger EWT (₱${computedLedgerEwtPhp.toFixed(2)}) by ₱${Math.abs(variancePhp).toFixed(2)}.`,
    });
  }
  if (qBills.length === 0 && qPayments.length === 0) {
    warnings.push({
      code: 'NO_ACTIVITY',
      severity: 'INFO',
      message: `No posted supplier bills or disbursement vouchers recorded for ${args.quarter} ${args.year}.`,
    });
  }

  const controlCode = (args.payee.code || args.payee.id.slice(0, 6)).replace(/[^A-Za-z0-9_-]/g, '');
  const certControlNo = `2307-${controlCode}-${args.year}-${args.quarter}`;

  return {
    certificateControlNo: certControlNo,
    atcStatus: hasMissingAtc && recordedDvEwtPhp === 0 ? 'MISSING_ATC' : 'RESOLVED',
    issuanceStatus: args.issuedRecord ? 'ISSUED' : 'DRAFT',
    issuedFilingId: args.issuedRecord?.filingId || null,
    issuedAt: args.issuedRecord?.issuedAt || null,
    periodFrom: bounds.periodFrom,
    periodTo: bounds.periodTo,
    statutoryDeadline: bounds.deadlineDate,
    quarter: args.quarter,
    year: args.year,
    monthLabels: bounds.monthLabels,
    dateIssued: args.dateIssued || new Date().toISOString().slice(0, 10),
    payor: {
      tin: args.payor.tin || null,
      tinSegments: payorTinSegments,
      legalName: args.payor.legalName || null,
      tradeName: args.payor.tradeName || args.payor.legalName || null,
      address: args.payor.address || null,
      zipCode: extractPhZipCode(args.payor.address),
      rdoCode: args.payor.rdoCode || null,
      branchCode: payorTinSegments[3] || '00000',
    },
    payee: {
      vendorId: args.payee.id,
      vendorCode: args.payee.code,
      tin: args.payee.tin || null,
      tinSegments: payeeTinSegments,
      legalName: args.payee.legalName,
      tradeName: args.payee.tradeName || args.payee.legalName,
      address: args.payee.address || null,
      zipCode: extractPhZipCode(args.payee.address),
      foreignAddress: '',
      taxpayerType: args.payee.taxClassification || null,
      vatStatus: args.payee.vatStatus || null,
    },
    apRecordsCount: {
      billsCount: qBills.length,
      paymentsCount: qPayments.length,
    },
    schedule,
    ewtSchedule,
    businessTaxSchedule,
    totals: {
      month1GrossPhp,
      month2GrossPhp,
      month3GrossPhp,
      grossPaymentPhp,
      taxWithheldPhp,
      recordedDvEwtPhp,
      computedLedgerEwtPhp,
      variancePhp,
      vatExcludedPhp: round2(totalVatExcludedCentavos / 100),
    },
    warnings,
    sourceBills,
    sourcePayments,
    signatory: {
      name: args.signatory.name,
      designation: args.signatory.designation,
      tin: args.signatory.tin || args.payor.tin || null,
    },
  };
}
