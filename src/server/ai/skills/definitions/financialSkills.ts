import { AISkillDefinition, AIStructuredResponse, IAIProvider } from '../../types';
import { db } from '../../../db';
import * as schema from '../../../db/schema';
import { eq, and, sql, desc, gte, lte } from 'drizzle-orm';
import { 
  startOfMonth, 
  endOfMonth, 
  subMonths, 
  startOfYear, 
  endOfYear, 
  startOfQuarter, 
  endOfQuarter, 
  format,
  subDays,
  addDays
} from 'date-fns';
import { TaxEngine } from '../../../services/taxEngine';
import { ComplianceRuleEngine } from '../../../services/complianceEngine';
import { AnalyticsEngine } from '../../../services/analyticsEngine';
import { ReportEngine } from '../../../services/reportEngine';

export async function getAccountsReceivableSummary({ companyId, asOfDate }: { companyId: string; asOfDate?: string }) {
  const invoices = await db
    .select({
      id: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      customerId: schema.salesInvoices.customerId,
      customerName: schema.customers.legalName,
      customerCode: schema.customers.code,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      dueDate: schema.salesInvoices.dueDate,
      status: schema.salesInvoices.status,
    })
    .from(schema.salesInvoices)
    .leftJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.status, 'POSTED')
      )
    );

  const activeInvoices = invoices.filter(inv => (inv.balanceDue || 0) > 0);
  const totalAR = activeInvoices.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0);
  const now = asOfDate ? new Date(asOfDate) : new Date();

  let totalOverdue = 0;
  const customerMap = new Map<string, { customerName: string; customerCode: string; totalBalance: number; totalOverdue: number }>();

  for (const inv of activeInvoices) {
    const bal = inv.balanceDue || 0;
    const isOverdue = inv.dueDate && new Date(inv.dueDate) < now;
    if (isOverdue) totalOverdue += bal;

    const custId = inv.customerId || 'unknown';
    const existing = customerMap.get(custId) || {
      customerName: inv.customerName || 'Customer',
      customerCode: inv.customerCode || 'CUST',
      totalBalance: 0,
      totalOverdue: 0,
    };
    existing.totalBalance += bal;
    if (isOverdue) existing.totalOverdue += bal;
    customerMap.set(custId, existing);
  }

  const topOutstandingCustomers = Array.from(customerMap.values())
    .sort((a, b) => b.totalBalance - a.totalBalance)
    .slice(0, 10);

  return {
    totalAccountsReceivable: totalAR,
    totalOverdue,
    overduePercentage: totalAR > 0 ? Math.round((totalOverdue / totalAR) * 100) : 0,
    topOutstandingCustomers,
  };
}

export async function getAccountsPayableSummary({ companyId, asOfDate }: { companyId: string; asOfDate?: string }) {
  const bills = await db
    .select({
      id: schema.purchaseBills.id,
      billNumber: schema.purchaseBills.billNumber,
      vendorId: schema.purchaseBills.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      totalAmount: schema.purchaseBills.totalAmount,
      balanceDue: schema.purchaseBills.balanceDue,
      dueDate: schema.purchaseBills.dueDate,
      status: schema.purchaseBills.status,
    })
    .from(schema.purchaseBills)
    .leftJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        eq(schema.purchaseBills.status, 'POSTED')
      )
    );

  const activeBills = bills.filter(b => (b.balanceDue || 0) > 0);
  const totalAP = activeBills.reduce((sum, b) => sum + (b.balanceDue || 0), 0);
  const now = asOfDate ? new Date(asOfDate) : new Date();

  let totalOverdue = 0;
  const vendorMap = new Map<string, { vendorName: string; vendorCode: string; totalBalance: number; totalOverdue: number }>();

  for (const bill of activeBills) {
    const bal = bill.balanceDue || 0;
    const isOverdue = bill.dueDate && new Date(bill.dueDate) < now;
    if (isOverdue) totalOverdue += bal;

    const vendId = bill.vendorId || 'unknown';
    const existing = vendorMap.get(vendId) || {
      vendorName: bill.vendorName || 'Vendor',
      vendorCode: bill.vendorCode || 'VEND',
      totalBalance: 0,
      totalOverdue: 0,
    };
    existing.totalBalance += bal;
    if (isOverdue) existing.totalOverdue += bal;
    vendorMap.set(vendId, existing);
  }

  const topOutstandingVendors = Array.from(vendorMap.values())
    .sort((a, b) => b.totalBalance - a.totalBalance)
    .slice(0, 10);

  return {
    totalAccountsPayable: totalAP,
    totalOverdue,
    overduePercentage: totalAP > 0 ? Math.round((totalOverdue / totalAP) * 100) : 0,
    topOutstandingVendors,
  };
}

export async function getVatPayable({ companyId, startDate, endDate }: { companyId: string; startDate: string; endDate: string }) {
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const isVat = company?.vatStatus === 'VAT' || company?.vatStatus === 'VAT_REGISTERED';

  const invoices = await db.select()
    .from(schema.salesInvoices)
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.status, 'POSTED'),
        gte(schema.salesInvoices.invoiceDate, startDate),
        lte(schema.salesInvoices.invoiceDate, endDate)
      )
    );

  const bills = await db.select()
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        eq(schema.purchaseBills.status, 'POSTED'),
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

  const grossSales = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
  const outputVat = isVat ? Math.round((grossSales / 1.12) * 0.12) : 0;
  const grossPurchases = bills.reduce((s, b) => s + (b.totalAmount || 0), 0);
  const creditableInputVat = isVat ? Math.round((grossPurchases / 1.12) * 0.12) : 0;

  const netVatPayable = Math.max(0, outputVat - creditableInputVat);
  const excessInputVat = Math.max(0, creditableInputVat - outputVat);

  return {
    isVatRegistered: isVat,
    grossSales,
    outputVat,
    grossPurchases,
    creditableInputVat,
    netVatPayable,
    excessInputVat,
    status: netVatPayable > 0 ? 'PAYABLE' : excessInputVat > 0 ? 'EXCESS_INPUT_VAT' : 'BALANCED',
  };
}

export async function getPercentageTax({ companyId, startDate, endDate }: { companyId: string; startDate: string; endDate: string }) {
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const isPercentage = company?.vatStatus === 'NON_VAT' || company?.vatStatus === 'PERCENTAGE_TAX';

  const invoices = await db.select()
    .from(schema.salesInvoices)
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.status, 'POSTED'),
        gte(schema.salesInvoices.invoiceDate, startDate),
        lte(schema.salesInvoices.invoiceDate, endDate)
      )
    );

  const grossSales = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
  const percentageTaxPayable = isPercentage ? Math.round(grossSales * 0.03) : 0;

  return {
    isPercentageTaxRegistered: isPercentage,
    taxRatePercentage: '3% (BIR Form 2551Q)',
    grossSales,
    percentageTaxPayable,
  };
}

export async function getTaxFilingRequirements({ companyId }: { companyId: string }) {
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const profile = await db.select().from(schema.companyTaxProfiles).where(eq(schema.companyTaxProfiles.companyId, companyId)).get();

  const classification = profile?.taxpayerClassification || company?.taxpayerClassification || 'CORPORATION';
  const isCorp = classification === 'CORPORATION' || classification === 'ONE_PERSON_CORPORATION' || classification === 'GENERAL_PARTNERSHIP';
  const is8Percent = classification === 'INDIVIDUAL_8PERCENT' || profile?.taxRegime === '8_PERCENT_FLAT';
  const isVat = (profile?.vatStatus || company?.vatStatus || 'VAT') === 'VAT';

  let isMixedIncome = false;
  if (profile?.registrationInformation) {
    try {
      const reg = JSON.parse(profile.registrationInformation);
      if (typeof reg.isMixedIncomeEarner === 'boolean') isMixedIncome = reg.isMixedIncomeEarner;
    } catch (e) {}
  }

  let incomeTaxForm = isCorp 
    ? 'BIR Form 1702Q / 1702-RT (Corporate Income Tax)' 
    : is8Percent
      ? isMixedIncome 
        ? 'BIR Form 1701 (Mixed Income: Compensation + 8% Business)' 
        : 'BIR Form 1701A / 1701Q (Individual 8% Flat Tax Return)'
      : 'BIR Form 1701Q / 1701 (Individual Graduated Income Tax)';

  return {
    taxpayerClassificationLabel: isCorp 
      ? 'Corporation' 
      : is8Percent 
        ? `Individual / Sole Proprietor (${isMixedIncome ? 'Mixed-Income Earner 8%' : 'Purely Self-Employed 8%'})`
        : 'Individual / Sole Proprietorship (Graduated)',
    vatStatusLabel: isVat ? 'VAT Registered (12%)' : is8Percent ? 'Non-VAT (8% Flat Rate in lieu of Sec 116)' : 'Non-VAT (3% Percentage Tax)',
    legalFramework: is8Percent 
      ? 'TRAIN Law (RA 10963) & BIR RR 8-2018 & EOPT Act (RA 11976)' 
      : 'NIRC as amended by CREATE Act (RA 11534) and EOPT Act (RA 11976)',
    isMixedIncomeEarner: isMixedIncome,
    vatOrPercentageTax: {
      form: isVat ? 'BIR Form 2550Q (Quarterly VAT Return)' : is8Percent ? 'Exempt from Form 2551Q (8% Rate in Lieu of Percentage Tax)' : 'BIR Form 2551Q (Quarterly Percentage Tax Return)',
      filingDeadline: '25th day of the month following the close of each taxable quarter',
      isSlspRequired: isVat,
    },
    incomeTax: {
      form: incomeTaxForm,
      annualFilingDeadline: 'April 15 of the following calendar year',
    },
    withholdingTaxes: {
      expandedWithholdingTaxForm: 'BIR Form 1601-EQ (Quarterly EWT) & BIR Form 2307',
      monthlyRemittanceDeadline: 'Last day of the month following the close of the taxable quarter',
    },
  };
}

export function parseDateRange(query: string): { start: Date; end: Date; label: string } {
  const q = query.toLowerCase();
  const now = new Date();

  // Year check e.g. "January 1, 1900" or "Year 1900"
  const yearMatch = q.match(/\b(19\d\d|20\d\d)\b/);
  if (yearMatch && (q.includes('year') || q.includes('january 1,') || q.includes('from'))) {
    const yr = parseInt(yearMatch[1], 10);
    if (!q.includes('this year') && !q.includes('last year') && !q.includes('this month') && !q.includes('last month')) {
      const start = new Date(yr, 0, 1);
      const end = new Date(yr, 11, 31, 23, 59, 59);
      return { start, end, label: `Year ${yr}` };
    }
  }

  // Relative periods: Month / Year / Quarter FIRST
  if (q.includes('last month') || q.includes('nakaraang buwan') || q.includes('nakalipas na buwan')) {
    const lastMonth = subMonths(now, 1);
    return {
      start: startOfMonth(lastMonth),
      end: endOfMonth(lastMonth),
      label: 'Last Month'
    };
  }

  if (q.includes('this month') || q.includes('ngayong buwan') || q.includes('buwan na ito')) {
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
      label: 'This Month'
    };
  }

  if (q.includes('this year') || q.includes('ngayong taon') || q.includes('taong ito')) {
    return {
      start: startOfYear(now),
      end: endOfYear(now),
      label: `This Year (${now.getFullYear()})`
    };
  }

  if (q.includes('last year') || q.includes('nakaraang taon')) {
    const lastYear = new Date(now.getFullYear() - 1, 0, 1);
    return {
      start: startOfYear(lastYear),
      end: endOfYear(lastYear),
      label: `Last Year (${lastYear.getFullYear()})`
    };
  }

  if (q.includes('this quarter') || q.includes('ngayong quarter')) {
    return {
      start: startOfQuarter(now),
      end: endOfQuarter(now),
      label: `This Quarter (Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()})`
    };
  }

  // Today / Ngayong Araw / Ngayon
  if (q.includes('today') || q.includes('ngayong araw') || /\bngayon\b/.test(q)) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { start, end, label: 'Today' };
  }

  // Yesterday / Kahapon
  if (q.includes('yesterday') || q.includes('kahapon')) {
    const yest = subDays(now, 1);
    const start = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0);
    const end = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59);
    return { start, end, label: 'Yesterday' };
  }

  // English & Taglish Month Names
  if (q.includes('january') || q.includes('enero')) {
    const year = now.getFullYear();
    const d = new Date(year, 0, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `January ${year}` };
  }
  if (q.includes('february') || q.includes('pebrero')) {
    const year = now.getFullYear();
    const d = new Date(year, 1, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `February ${year}` };
  }
  if (q.includes('march') || q.includes('marso')) {
    const year = now.getFullYear();
    const d = new Date(year, 2, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `March ${year}` };
  }
  if (q.includes('april') || q.includes('abril')) {
    const year = now.getFullYear();
    const d = new Date(year, 3, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `April ${year}` };
  }
  if (q.includes('may') || q.includes('mayo')) {
    const year = now.getFullYear();
    const d = new Date(year, 4, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `May ${year}` };
  }
  if (q.includes('june') || q.includes('hunyo')) {
    const year = now.getFullYear();
    const d = new Date(year, 5, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `June ${year}` };
  }
  if (q.includes('july') || q.includes('hulyo')) {
    const year = now.getFullYear();
    const d = new Date(year, 6, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `July ${year}` };
  }
  if (q.includes('august') || q.includes('agosto')) {
    const year = now.getFullYear();
    const d = new Date(year, 7, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `August ${year}` };
  }
  if (q.includes('september') || q.includes('setyembre')) {
    const year = now.getFullYear();
    const d = new Date(year, 8, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `September ${year}` };
  }
  if (q.includes('october') || q.includes('oktubre')) {
    const year = now.getFullYear();
    const d = new Date(year, 9, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `October ${year}` };
  }
  if (q.includes('november') || q.includes('nobyembre')) {
    const year = now.getFullYear();
    const d = new Date(year, 10, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `November ${year}` };
  }
  if (q.includes('december') || q.includes('disyembre')) {
    const year = now.getFullYear();
    const d = new Date(year, 11, 1);
    return { start: startOfMonth(d), end: endOfMonth(d), label: `December ${year}` };
  }

  // Default: Current month
  return {
    start: startOfMonth(now),
    end: endOfMonth(now),
    label: 'This Month'
  };
}

export const getFinancialSummarySkill: AISkillDefinition = {
  id: 'getFinancialSummary',
  name: 'Get Financial Summary',
  description: 'Retrieves sales, expenses, and estimated net income for a requested period.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const { start, end, label } = parseDateRange(input.query || '');
    const startDate = format(start, 'yyyy-MM-dd');
    const endDate = format(end, 'yyyy-MM-dd');

    const summary = await ReportEngine.getFinancialSummary(companyId, startDate, endDate);

    const promptText = `
You are Ledger Agent, Philippine AI Accounting Assistant.
Answer the user's query regarding their financial figures for: ${label}.
Actual posted data from ReportEngine:
- Total Sales: ₱${summary.totalSales.toLocaleString('en-PH', {minimumFractionDigits: 2})} (from ${summary.invoiceCount} invoices)
- Total Expenses: ₱${summary.totalExpenses.toLocaleString('en-PH', {minimumFractionDigits: 2})} (from ${summary.billCount} bills)
- Estimated Net Income: ₱${summary.netIncome.toLocaleString('en-PH', {minimumFractionDigits: 2})}

User Query: ${input.query}

Format a concise, friendly, and authoritative answer in the language requested (English, Filipino, or Taglish). Never invent or fabricate numbers.
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['LedgerAI General Ledger & Financial Report Engine'],
      authoritativeSource: 'General Ledger (ReportEngine)',
      model: res.model,
      sourceDataUsed: { period: label, ...summary }
    };
  }
};

export const arApQuerySkill: AISkillDefinition = {
  id: 'arApQuery',
  name: 'Accounts Receivable and Payable Query',
  description: 'Queries customer receivables, vendor payables, aging, and overdue debts.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const asOfDate = format(new Date(), 'yyyy-MM-dd');
    const [arSummary, apSummary] = await Promise.all([
      getAccountsReceivableSummary({ companyId, asOfDate }),
      getAccountsPayableSummary({ companyId, asOfDate })
    ]);

    const queryLower = (input.query || '').toLowerCase();
    const isVendorFocus = queryLower.includes('vendor') || queryLower.includes('supplier') || queryLower.includes('bill') || queryLower.includes('payable') || queryLower.includes('bayarin');

    const promptText = `
You are Ledger Agent. Answer the user's question regarding receivables (paniningil / utang ng customer) or payables (babayarang bills / utang sa supplier).
Data as of ${asOfDate}:

1. Accounts Receivable (Customer Balances):
- Total AR: ₱${arSummary.totalAccountsReceivable.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Total Overdue AR: ₱${arSummary.totalOverdue.toLocaleString('en-PH', {minimumFractionDigits: 2})} (${arSummary.overduePercentage}% overdue)
- Top Debtors / Customers with Balances:
${arSummary.topOutstandingCustomers.map(c => `  * ${c.customerName} (${c.customerCode}): Total ₱${c.totalBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}, Overdue ₱${c.totalOverdue.toLocaleString('en-PH', {minimumFractionDigits: 2})}`).join('\n') || '  (None)'}

2. Accounts Payable (Supplier Bills):
- Total AP: ₱${apSummary.totalAccountsPayable.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Total Overdue AP: ₱${apSummary.totalOverdue.toLocaleString('en-PH', {minimumFractionDigits: 2})} (${apSummary.overduePercentage}% overdue)
- Top Creditors / Suppliers:
${apSummary.topOutstandingVendors.map(v => `  * ${v.vendorName} (${v.vendorCode}): Total ₱${v.totalBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}, Overdue ₱${v.totalOverdue.toLocaleString('en-PH', {minimumFractionDigits: 2})}`).join('\n') || '  (None)'}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['Accounts Receivable & Payable Engine'],
      authoritativeSource: isVendorFocus ? 'Accounts Payable Ledger' : 'Accounts Receivable Ledger',
      model: res.model,
      sourceDataUsed: { arSummary, apSummary }
    };
  }
};

export const taxQuerySkill: AISkillDefinition = {
  id: 'taxQuery',
  name: 'Tax Compliance Query',
  description: 'Queries VAT, Percentage Tax, Withholding, and Income Tax information using authoritative Philippine Tax Engine.',
  category: 'TAX',
  version: '1.0.0',
  requiredPermissions: ['TAX_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');
    
    const { start, end, label } = parseDateRange(input.query || '');
    const startDate = format(start, 'yyyy-MM-dd');
    const endDate = format(end, 'yyyy-MM-dd');

    const [vatResult, ptResult, filingReqs] = await Promise.all([
      getVatPayable({ companyId, startDate, endDate }),
      getPercentageTax({ companyId, startDate, endDate }),
      getTaxFilingRequirements({ companyId })
    ]);

    const dataResult = {
      period: label,
      taxpayerClassification: filingReqs.taxpayerClassificationLabel,
      vatStatus: filingReqs.vatStatusLabel,
      legalFramework: filingReqs.legalFramework,
      vat: vatResult,
      percentageTax: ptResult,
      filingRequirements: filingReqs
    };

    const promptText = `
You are Ledger Agent. Answer the user's Philippine tax question using authoritative calculations from PhilippineTaxEngine:

Company: ${context.company?.legalName || 'Company'} (${dataResult.taxpayerClassification})
Tax Regime: ${dataResult.vatStatus} | Legal Framework: ${dataResult.legalFramework}
Period Evaluated: ${dataResult.period}

1. Value-Added Tax (BIR Form 2550Q):
- Registered for VAT: ${dataResult.vat.isVatRegistered ? 'Yes' : 'No'}
- Gross Sales: ₱${dataResult.vat.grossSales.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Output VAT (12%): ₱${dataResult.vat.outputVat.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Gross Purchases: ₱${dataResult.vat.grossPurchases.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Creditable Input VAT: ₱${dataResult.vat.creditableInputVat.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Net VAT Payable: ₱${dataResult.vat.netVatPayable.toLocaleString('en-PH', {minimumFractionDigits: 2})} (${dataResult.vat.status})

2. Percentage Tax (BIR Form 2551Q):
- Registered for Percentage Tax: ${dataResult.percentageTax.isPercentageTaxRegistered ? 'Yes' : 'No'}
- Rate: ${dataResult.percentageTax.taxRatePercentage}
- Payable: ₱${dataResult.percentageTax.percentageTaxPayable.toLocaleString('en-PH', {minimumFractionDigits: 2})}

3. Filing Forms & Deadlines:
- Income Tax: ${dataResult.filingRequirements.incomeTax.form} (Deadline: ${dataResult.filingRequirements.incomeTax.annualFilingDeadline})
- Business Tax: ${dataResult.filingRequirements.vatOrPercentageTax.form} (Deadline: ${dataResult.filingRequirements.vatOrPercentageTax.filingDeadline})
- EWT Withholding: ${dataResult.filingRequirements.withholdingTaxes.expandedWithholdingTaxForm}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['PhilippineTaxEngine', 'National Internal Revenue Code (NIRC)', 'CREATE Act (RA 11534)', 'Ease of Paying Taxes (EOPT) Act (RA 11976)'],
      authoritativeSource: 'Philippine Tax Engine (NIRC / CREATE / EOPT)',
      model: res.model,
      sourceDataUsed: dataResult
    };
  }
};

export const taxRemindersSkill: AISkillDefinition = {
  id: 'taxRemindersQuery',
  name: 'Tax Reminders and Statutory Deadlines',
  description: 'Provides upcoming BIR tax deadlines, filing schedules, and statutory reminders.',
  category: 'TAX',
  version: '1.0.0',
  requiredPermissions: ['TAX_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const filingReqs = await getTaxFilingRequirements({ companyId });

    const promptText = `
You are Ledger Agent. Provide a clear list of upcoming Philippine tax filing deadlines and statutory reminders.
Company Tax Profile:
- Classification: ${filingReqs.taxpayerClassificationLabel}
- Tax Regime: ${filingReqs.vatStatusLabel}

Key BIR Deadlines:
1. Business Tax Return (${filingReqs.vatOrPercentageTax.form}): ${filingReqs.vatOrPercentageTax.filingDeadline}
2. Expanded Withholding Tax (${filingReqs.withholdingTaxes.expandedWithholdingTaxForm}): ${filingReqs.withholdingTaxes.monthlyRemittanceDeadline}
3. Annual Income Tax Return (${filingReqs.incomeTax.form}): ${filingReqs.incomeTax.annualFilingDeadline}
4. Quarterly Income Tax (1701Q / 1702Q): 60 days following close of taxable quarter.
5. Summary List of Sales and Purchases (SLSP): ${filingReqs.vatOrPercentageTax.isSlspRequired ? 'Required quarterly alongside 2550Q' : 'Not required for Non-VAT'}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['BIR Compliance Calendar', 'EOPT Act Implementing Rules'],
      authoritativeSource: 'BIR Statutory Tax Calendar',
      model: res.model,
      sourceDataUsed: filingReqs
    };
  }
};

export const complianceQuerySkill: AISkillDefinition = {
  id: 'complianceQuery',
  name: 'Compliance and Audit Guardian Query',
  description: 'Audits books for compliance violations, missing receipts, duplicate invoices, and statutory risks.',
  category: 'COMPLIANCE',
  version: '1.0.0',
  requiredPermissions: ['AUDIT_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const report = await ComplianceRuleEngine.evaluateAll(companyId);

    const promptText = `
You are Ledger Agent. Present the company's compliance health and audit findings from ComplianceRuleEngine.
Compliance Report Summary:
- Health Score: ${report.summary.healthScore} / 100
- Total Findings: ${report.summary.totalFindings} (Critical: ${report.summary.criticalCount}, High: ${report.summary.highCount}, Medium: ${report.summary.mediumCount}, Low: ${report.summary.lowCount})

Key Findings:
${report.findings.map(f => `[${f.severity}] ${f.issue}: ${f.explanation} (Recommended: ${f.recommendedAction})`).join('\n') || 'None. All books and documents comply with statutory standards.'}

Statutory Checklist:
${report.statutoryChecklist.map(c => `- ${c.description}: ${c.status} (${c.notes})`).join('\n')}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['ComplianceRuleEngine', 'BIR RR 16-2005', 'Double-Entry Invariant Validator'],
      authoritativeSource: 'ComplianceRuleEngine & Audit Guardian',
      model: res.model,
      sourceDataUsed: report
    };
  }
};

export const financialAnalyticsQuerySkill: AISkillDefinition = {
  id: 'financialAnalyticsQuery',
  name: 'Financial Analytics & BI Query',
  description: 'Performs multi-month trend analysis, margin breakdown, customer/vendor concentration, and answers questions like "Why did expenses increase?".',
  category: 'ANALYTICS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const analytics = await AnalyticsEngine.getFinancialAnalytics(companyId, 6);

    const promptText = `
You are Ledger Agent, Business Intelligence & Financial Analytics Assistant.
Analyze the company's financial trends, margins, concentration, and expense fluctuations.

Analytics Data:
- Month-over-Month Growth: Revenue: ${analytics.trends.revenueGrowthMoM}%, Expenses: ${analytics.trends.expenseGrowthMoM}%, Profit: ${analytics.trends.profitGrowthMoM}%
- Gross Profit Margin: ${analytics.margins.grossMarginPercentage}% (Gross Profit: ₱${analytics.margins.grossProfit.toLocaleString('en-PH', {minimumFractionDigits: 2})})
- Monthly Historical Trends:
${analytics.trends.monthly.map(m => `  * ${m.label}: Rev ₱${m.revenue.toLocaleString('en-PH', {minimumFractionDigits: 2})}, Exp ₱${m.expenses.toLocaleString('en-PH', {minimumFractionDigits: 2})}, Net ₱${m.netIncome.toLocaleString('en-PH', {minimumFractionDigits: 2})}`).join('\n')}

- Customer Concentration: Top 3 customers account for ${analytics.concentration.customerTop3Share}% of revenue (High Risk: ${analytics.concentration.isCustomerConcentrationHighRisk ? 'Yes' : 'No'}).
- Vendor Concentration: Top 3 suppliers account for ${analytics.concentration.vendorTop3Share}% of spend.
- Operating Cash Flow: ₱${analytics.cashFlow.netOperatingCashFlow.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Detected Anomalies: ${analytics.anomalies.map(a => `[${a.type}] ${a.description}`).join('; ') || 'None'}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['LedgerAI Financial Analytics Engine', 'Time-Series Trend Model'],
      authoritativeSource: 'AnalyticsEngine & BI Subsystem',
      model: res.model,
      sourceDataUsed: analytics
    };
  }
};

export const anomalyDetectionQuerySkill: AISkillDefinition = {
  id: 'anomalyDetectionQuery',
  name: 'Anomaly Detection Query',
  description: 'Identifies unusual accounting spikes, unposted transactions, and suspicious patterns.',
  category: 'ANALYTICS',
  version: '1.0.0',
  requiredPermissions: ['ACCOUNTING_VIEW', 'AUDIT_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const [analytics, compliance] = await Promise.all([
      AnalyticsEngine.getFinancialAnalytics(companyId, 3),
      ComplianceRuleEngine.evaluateAll(companyId)
    ]);

    const anomalies = [
      ...analytics.anomalies,
      ...compliance.findings.filter(f => f.category === 'SUSPICIOUS_ENTRY' || f.category === 'INVALID_TRANSACTION')
    ];

    const promptText = `
You are Ledger Agent. Report any financial anomalies or suspicious entries detected in the company's ledger.
Detected Anomalies & Outliers:
${anomalies.map(a => typeof a === 'object' && 'issue' in a ? `- [${(a as any).severity}] ${(a as any).issue}: ${(a as any).explanation}` : `- [${(a as any).type}] ${(a as any).description}`).join('\n') || 'No anomalies detected. All ledger postings and expense trends align with expected distributions.'}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.95,
      citations: ['Statistical Anomaly Detector', 'ComplianceRuleEngine'],
      authoritativeSource: 'Anomaly Detection Subsystem',
      model: res.model,
      sourceDataUsed: { anomalies }
    };
  }
};

export const auditQuerySkill: AISkillDefinition = {
  id: 'auditQuery',
  name: 'Audit Trail and Security Log Query',
  description: 'Queries recent system audit events, user actions, and administrative changes.',
  category: 'AUDIT',
  version: '1.0.0',
  requiredPermissions: ['AUDIT_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');

    const recentLogs = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.companyId, companyId))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(10);

    const promptText = `
You are Ledger Agent. Answer questions about the company's immutable audit trail and user action history.
Recent Audit Logs (Last 10 events):
${recentLogs.map(l => `[${l.timestamp}] Action: ${l.action}, Entity: ${l.entityType} (${l.entityId}), User: ${l.userId || 'SYSTEM'}, Role: ${l.userRole}`).join('\n') || 'No recent audit trail entries logged.'}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.98,
      citations: ['Immutable Audit Trail (BIR CAS Requirement)'],
      authoritativeSource: 'Audit Log Vault',
      model: res.model,
      sourceDataUsed: { logCount: recentLogs.length }
    };
  }
};

export const requestActionConfirmationSkill: AISkillDefinition = {
  id: 'requestActionConfirmation',
  name: 'Request AI Mutation Confirmation',
  description: 'Safely proposes write or high-risk mutations and requests explicit user confirmation before execution.',
  category: 'ACTIONS',
  version: '1.0.0',
  requiredPermissions: ['ACCOUNTING_CREATE'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'HIGH_MUTATION',
  isReadOnly: false,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const isHighRisk = input.actionType === 'DELETE_TRANSACTION' || input.actionType === 'CHANGE_TAX_CONFIG' || input.actionType === 'SUBMIT_FILING';
    const actionId = `action-${Date.now()}`;

    const pendingAction = {
      actionId,
      actionType: input.actionType || 'CUSTOM_MUTATION',
      description: `Proposed operation for: "${input.query}"`,
      riskLevel: isHighRisk ? ('HIGH_MUTATION' as const) : ('LOW_MUTATION' as const),
      payload: { query: input.query, parameters: input.parameters || {} },
      warningMessage: isHighRisk 
        ? '⚠️ HIGH-RISK ACTION: This modification will permanently alter general ledger state, statutory tax configuration, or audit records. Explicit confirmation is required.'
        : 'Please review and confirm this action before posting.',
      status: 'PENDING' as const,
    };

    return {
      skillId: this.id,
      answer: isHighRisk
        ? `⚠️ **Action Confirmation Required (High Risk)**\nYou have requested an operation that modifies financial or tax records:\n- **Action**: ${pendingAction.description}\n- **Risk Level**: High Mutation\n\nPlease review the parameters below and click **Confirm Action** to proceed or **Cancel** to abort.`
        : `📝 **Action Confirmation Required**\nPlease confirm if you would like to proceed with this entry:\n- **Action**: ${pendingAction.description}\n\nClick **Confirm Action** to post to the General Ledger.`,
      confidence: 1.0,
      citations: ['AI Action Safety & Dual-Confirmation Policy'],
      authoritativeSource: 'AI Action Safety Guard',
      pendingAction,
      suggestedActions: [
        { label: 'Confirm Action', action: 'CONFIRM_AI_ACTION', params: { actionId } },
        { label: 'Cancel', action: 'CANCEL_AI_ACTION', params: { actionId } }
      ]
    };
  }
};

export const ledgerQuerySkill: AISkillDefinition = {
  id: 'ledgerQuery',
  name: 'General Ledger and Journal Query',
  description: 'Queries journal entries and GL balances.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['JOURNAL_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');
    
    const { start, end, label } = parseDateRange(input.query || '');
    const startDate = format(start, 'yyyy-MM-dd');
    const endDate = format(end, 'yyyy-MM-dd');

    const postedJournals = await db.select({ count: sql<number>`count(*)` }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'POSTED'), gte(schema.journalEntries.entryDate, startDate), lte(schema.journalEntries.entryDate, endDate))).get();
    const unpostedJournals = await db.select({ count: sql<number>`count(*)` }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'DRAFT'), gte(schema.journalEntries.entryDate, startDate), lte(schema.journalEntries.entryDate, endDate))).get();

    const dataResult = {
      posted: postedJournals?.count || 0,
      unposted: unpostedJournals?.count || 0
    };

    const promptText = `
You are Ledger Agent. Answer the user's question regarding journal entries and the general ledger.
Data for period: ${label}:
- Posted Journal Entries: ${dataResult.posted}
- Unposted/Draft Journal Entries: ${dataResult.unposted}

User Query: ${input.query}
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.95,
      citations: ['LedgerAI GL Data'],
      authoritativeSource: 'General Ledger Data',
      model: res.model,
      sourceDataUsed: dataResult
    };
  }
};

export const getSalesSummarySkill: AISkillDefinition = {
  id: 'getSalesSummary',
  name: 'Get Sales Summary',
  description: 'Retrieves a summary of sales invoices.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');
    
    const { start, end, label } = parseDateRange(input.query || '');
    const startDate = format(start, 'yyyy-MM-dd');
    const endDate = format(end, 'yyyy-MM-dd');
    
    const summary = await ReportEngine.getSalesSummary(companyId, startDate, endDate);

    const promptText = `You are Ledger Agent. Answer the user's query about their sales.
Data provided by Report Engine for period: ${label}:
- Total Sales: ₱${summary.totalSales.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Number of Invoices: ${summary.invoiceCount}

User Query: ${input.query}`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.95,
      citations: ['LedgerAI Sales Reports'],
      authoritativeSource: 'Sales Invoice Ledger',
      model: res.model,
      sourceDataUsed: { period: label, totalSales: summary.totalSales, invoiceCount: summary.invoiceCount }
    };
  }
};

export const getExpenseSummarySkill: AISkillDefinition = {
  id: 'getExpenseSummary',
  name: 'Get Expense Summary',
  description: 'Retrieves a summary of purchase bills and expenses.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');
    
    const { start, end, label } = parseDateRange(input.query || '');
    const startDate = format(start, 'yyyy-MM-dd');
    const endDate = format(end, 'yyyy-MM-dd');
    
    const summary = await ReportEngine.getExpenseSummary(companyId, startDate, endDate);

    const promptText = `You are Ledger Agent. Answer the user's query about their expenses.
Data provided by Report Engine for period: ${label}:
- Total Expenses: ₱${summary.totalExpenses.toLocaleString('en-PH', {minimumFractionDigits: 2})}
- Number of Bills: ${summary.billCount}

User Query: ${input.query}`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: 0.95,
      citations: ['LedgerAI Expense Reports'],
      authoritativeSource: 'Purchase Bills Ledger',
      model: res.model,
      sourceDataUsed: { period: label, totalExpenses: summary.totalExpenses, billCount: summary.billCount }
    };
  }
};

export const financialQuerySkill: AISkillDefinition = {
  id: 'financialQuery',
  name: 'Financial Query',
  description: 'Calculates sales, expenses, and net income from posted transactions, with support for periods.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1', 
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    return getFinancialSummarySkill.execute(input, context, provider);
  }
};

export const getAccountsReceivableSummarySkill: AISkillDefinition = {
  id: 'getAccountsReceivableSummary',
  name: 'Get Accounts Receivable Summary',
  description: 'Retrieves AR aging, overdue totals, and top customer balances.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');
    const arSummary = await ReportEngine.getAccountsReceivableSummary(companyId);
    return {
      skillId: this.id,
      answer: `Total Accounts Receivable: ₱${(arSummary.totalAccountsReceivable || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      confidence: 0.98,
      sourceDataUsed: arSummary,
    };
  }
};

export const getAccountsPayableSummarySkill: AISkillDefinition = {
  id: 'getAccountsPayableSummary',
  name: 'Get Accounts Payable Summary',
  description: 'Retrieves AP aging, overdue totals, and top vendor balances.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORTS_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.generalQuery.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const companyId = context.company?.id;
    if (!companyId) throw new Error('Company context required');
    const apSummary = await ReportEngine.getAccountsPayableSummary(companyId);
    return {
      skillId: this.id,
      answer: `Total Accounts Payable: ₱${(apSummary.totalAccountsPayable || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      confidence: 0.98,
      sourceDataUsed: apSummary,
    };
  }
};
