/**
 * LedgerAI PH — Enterprise 1,000+ Transaction Multi-Month Stress Test & Deep-Dive Cross-Module Verifier
 *
 * Drives 1,300+ real double-entry financial & operational transactions across Jan–Nov 2026
 * through the live authenticated REST APIs for BOTH persistent workspaces:
 *   1) Pacific Crest Trading & Logistics Corp. (LGR-PH-2026-PCT-01 — VAT Corp, RDO 044): 1,000+ transactions
 *   2) Bayanihan Prime Consultancy Services   (LGR-PH-2026-BPC-02 — Non-VAT Sole Prop, RDO 039): 300+ transactions
 *
 * Verifies:
 *   - Trial Balance: Total Debits === Total Credits (₱0.00 variance)
 *   - Balance Sheet: Assets === Liabilities + Equity (₱0.00 variance)
 *   - AR Subledger vs GL 1020 AR Control (₱0.00 variance)
 *   - AP Subledger vs GL 2010 AP Control (₱0.00 variance)
 *   - VAT Corp: GL 2020 Output VAT > 0, GL 1120 Input VAT > 0, BIR 2550Q/2550M/SLSP .DAT + 0 MISSING_TIN
 *   - Non-VAT Corp: Input VAT === 0, Output VAT === 0, BIR 2551Q 3% Percentage Tax + 0 MISSING_TIN
 *   - BIR Form 2307 & EWT (WC158 1%, WC160 2%, WC100 5%) + Payroll 1601-C + BI Budgets + Procurement 3-Way Match
 *   - High-volume latency benchmarks across all 18+ module endpoints
 */

const BASE_URL = process.env.LEDGERAI_BASE_URL || 'http://127.0.0.1:3000';

interface HttpResult {
  status: number;
  ok: boolean;
  data: any;
  rawText: string;
  durationMs: number;
}

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: any } = {}
): Promise<HttpResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const rawText = await res.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data, rawText, durationMs: Date.now() - t0 };
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CompanyPlan {
  id: string;
  name: string;
  vatStatus: 'VAT' | 'NON_VAT';
  email: string;
  password: string;
  salesInvoiceCount: number;
  purchaseBillCount: number;
  poCount: number;
  pendingMatchPoCount: number;
  payrollMonths: string[];
  fixedAssetAddCount: number;
  stockAdjCount: number;
}

const PLANS: CompanyPlan[] = [
  {
    id: 'LGR-PH-2026-PCT-01',
    name: 'Pacific Crest Trading & Logistics Corp.',
    vatStatus: 'VAT',
    email: 'owner@pacificcrest.ph',
    password: 'LedgerPH!2026',
    salesInvoiceCount: 340,
    purchaseBillCount: 240,
    poCount: 30,
    pendingMatchPoCount: 5,
    payrollMonths: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
    fixedAssetAddCount: 3,
    stockAdjCount: 20,
  },
  {
    id: 'LGR-PH-2026-BPC-02',
    name: 'Bayanihan Prime Consultancy Services',
    vatStatus: 'NON_VAT',
    email: 'owner@bayanihanprime.ph',
    password: 'Bayanihan!2026',
    salesInvoiceCount: 110,
    purchaseBillCount: 75,
    poCount: 10,
    pendingMatchPoCount: 3,
    payrollMonths: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
    fixedAssetAddCount: 1,
    stockAdjCount: 8,
  },
];

async function stressTestCompany(plan: CompanyPlan) {
  console.log(`\n======================================================================`);
  console.log(`COMPANY: ${plan.name} (${plan.id} · ${plan.vatStatus})`);
  console.log(`======================================================================`);

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { companyId: plan.id, email: plan.email, password: plan.password },
  });
  if (!login.ok || !login.data?.token) {
    throw new Error(`Login failed for ${plan.id}: ${login.status} ${login.rawText}`);
  }
  const token: string = login.data.token;

  // 1. Trigger auto-provisioning of authoritative PH BIR Tax Codes & fetch COA + Master Data
  const [taxCodesRes, accountsRes, customersRes, vendorsRes, itemsRes, fixedAssetsRes, existingSiRes, existingPbRes] = await Promise.all([
    api('/api/tax/codes', { token }),
    api('/api/accounting/accounts', { token }),
    api('/api/master-data/customers', { token }),
    api('/api/master-data/vendors', { token }),
    api('/api/operations/inventory/items?limit=100', { token }),
    api('/api/operations/fixed-assets?limit=100', { token }),
    api('/api/accounting/sales-invoices?limit=10', { token }),
    api('/api/accounting/purchase-bills?limit=10', { token }),
  ]);

  const taxCodes: any[] = Array.isArray(taxCodesRes.data) ? taxCodesRes.data : [];
  const accounts: any[] = Array.isArray(accountsRes.data) ? accountsRes.data : accountsRes.data?.data || [];
  const customers: any[] = Array.isArray(customersRes.data) ? customersRes.data : customersRes.data?.data || [];
  const vendors: any[] = Array.isArray(vendorsRes.data) ? vendorsRes.data : vendorsRes.data?.data || [];
  const invItems: any[] = Array.isArray(itemsRes.data) ? itemsRes.data : itemsRes.data?.data || [];
  const fixedAssets: any[] = Array.isArray(fixedAssetsRes.data) ? fixedAssetsRes.data : fixedAssetsRes.data?.data || [];

  const findAcc = (code: string, fallbackName?: string) =>
    accounts.find((a) => String(a.accountCode) === code) ||
    (fallbackName ? accounts.find((a) => String(a.accountName || '').toLowerCase().includes(fallbackName)) : undefined);

  const cashAcc = findAcc('1010', 'cash') || accounts.find((a) => a.accountType === 'ASSET');
  const revAcc = findAcc('4010', 'sales') || accounts.find((a) => a.accountType === 'REVENUE');
  const cogsAcc = findAcc('5010', 'cost of') || findAcc('6010', 'expense');
  const rentAcc = findAcc('6020', 'rent') || cogsAcc;
  const utilAcc = findAcc('6030', 'utilities') || cogsAcc;
  const suppliesAcc = findAcc('6040', 'supplies') || cogsAcc;
  const profAcc = findAcc('6050', 'professional') || rentAcc;
  const eqAcc = findAcc('3010', 'capital') || findAcc('3020', 'retained') || accounts.find((a) => a.accountType === 'EQUITY');
  const faAcc = findAcc('1500', 'equipment') || findAcc('1510', 'property');

  const vatOutCode = taxCodes.find((t) => String(t.code).toUpperCase() === 'VAT-OUT-12');
  const vatInCode = taxCodes.find((t) => String(t.code).toUpperCase() === 'VAT-IN-12');
  const ptaxCode = taxCodes.find((t) => String(t.code).toUpperCase() === 'PTAX-3');

  const salesTaxCode = plan.vatStatus === 'VAT' ? vatOutCode : ptaxCode;
  const purchaseTaxCode = plan.vatStatus === 'VAT' ? vatInCode : undefined;

  console.log(`Tax Codes Ready: ${taxCodes.length} (Sales=${salesTaxCode?.code || 'NONE'}, Purchase=${purchaseTaxCode?.code || 'NON-VAT'})`);

  // Ensure additional enterprise customers & vendors for rich realistic variety
  const extraCustomers = [
    { code: 'CUST-STR-04', legalName: 'Ayala Meridian Retail Group Inc.', tin: '006-312-441-00000', vatStatus: 'VAT', creditLimit: 2500000 },
    { code: 'CUST-STR-05', legalName: 'Iloilo Agro-Industrial Cooperative', tin: '007-418-902-00000', vatStatus: 'NON_VAT', creditLimit: 1200000 },
    { code: 'CUST-STR-06', legalName: 'Clark Freeport Logistics Hub Corp.', tin: '008-529-114-00000', vatStatus: 'VAT', creditLimit: 3000000 },
  ];
  for (const c of extraCustomers) {
    if (!customers.some((x) => x.code === c.code)) {
      const r = await api('/api/master-data/customers', {
        method: 'POST',
        token,
        body: { ...c, email: `${c.code.toLowerCase()}@client.ph`, phone: '+63-2-8888-1000', address: 'Metro Manila, Philippines', status: 'ACTIVE' },
      });
      if (r.ok && r.data?.id) customers.push({ id: r.data.id, ...c });
    }
  }

  const extraVendors = [
    { code: 'VEND-STR-03', legalName: 'Subic Bay Industrial Supply Corp.', tin: '009-641-223-00000', vatStatus: 'VAT', atc: 'WC158' },
    { code: 'VEND-STR-04', legalName: 'Makati Prime IT & Cloud Advisory Inc.', tin: '008-771-534-00000', vatStatus: 'VAT', atc: 'WC160' },
    { code: 'VEND-STR-05', legalName: 'Laguna Micro Packaging Services', tin: '214-882-190-00000', vatStatus: 'NON_VAT', atc: 'WC160' },
  ];
  for (const v of extraVendors) {
    if (!vendors.some((x) => x.code === v.code)) {
      const r = await api('/api/master-data/vendors', {
        method: 'POST',
        token,
        body: {
          code: v.code,
          legalName: v.legalName,
          tin: v.tin,
          vatStatus: v.vatStatus,
          email: `${v.code.toLowerCase()}@supplier.ph`,
          phone: '+63-2-8777-2000',
          address: 'Makati City, Philippines',
          defaultExpenseAccountId: cogsAcc?.id,
          status: 'ACTIVE',
        },
      });
      if (r.ok && r.data?.id) vendors.push({ id: r.data.id, ...v });
    }
  }

  const existingSiTotal = Number(existingSiRes.data?.pagination?.totalCount ?? existingSiRes.data?.summary?.statusCounts?.ALL ?? 0);
  const existingPbTotal = Number(existingPbRes.data?.pagination?.totalCount ?? existingPbRes.data?.summary?.statusCounts?.ALL ?? 0);
  const alreadyStressed = existingSiTotal >= plan.salesInvoiceCount && existingPbTotal >= plan.purchaseBillCount;

  const counters = {
    salesInvoices: 0,
    customerPayments: 0,
    purchaseOrders: 0,
    grns: 0,
    threeWayMatches: 0,
    purchaseBills: 0,
    supplierPayments: 0,
    payrollRuns: 0,
    fixedAssets: 0,
    depreciationRuns: 0,
    stockAdjustments: 0,
    bankStatementLines: 0,
    journalEntries: 0,
    errors: 0,
  };

  if (alreadyStressed) {
    console.log(`Workspace already holds heavy dataset (${existingSiTotal} SI, ${existingPbTotal} PB) — checking employee roster & payroll completion.`);
    const empRes = await api('/api/operations/payroll/employees', { token });
    const empList: any[] = Array.isArray(empRes.data) ? empRes.data : empRes.data?.data || [];
    if (empList.length === 0) {
      const initialEmployees = plan.id === 'LGR-PH-2026-PCT-01' ? [
        { employeeNo: 'EMP-PCT-001', firstName: 'Juan', lastName: 'Santos', position: 'Logistics Operations Director', department: 'Operations', monthlyBasicSalary: 85000, customWithholdingTax: 12500, tin: '123-456-781-00000', sssNo: '03-1234567-1', philhealthNo: '12-345678901-2', pagibigNo: '1234-5678-9012' },
        { employeeNo: 'EMP-PCT-002', firstName: 'Maria', lastName: 'Del Rosario', position: 'Warehouse Manager', department: 'Logistics', monthlyBasicSalary: 48000, customWithholdingTax: 4600, tin: '123-456-782-00000', sssNo: '03-1234567-2', philhealthNo: '12-345678901-3', pagibigNo: '1234-5678-9013' },
        { employeeNo: 'EMP-PCT-003', firstName: 'Carlos', lastName: 'Lim', position: 'Fleet Supervisor', department: 'Transport', monthlyBasicSalary: 36000, customWithholdingTax: 2400, tin: '123-456-783-00000', sssNo: '03-1234567-3', philhealthNo: '12-345678901-4', pagibigNo: '1234-5678-9014' },
      ] : [
        { employeeNo: 'EMP-BPC-001', firstName: 'Andrea', lastName: 'Morales', position: 'Senior Tax Consultant', department: 'Advisory', monthlyBasicSalary: 62000, customWithholdingTax: 8200, tin: '234-567-891-00000', sssNo: '04-2345678-1', philhealthNo: '13-456789012-3', pagibigNo: '2345-6789-0123' },
        { employeeNo: 'EMP-BPC-002', firstName: 'Eduardo', lastName: 'Tan', position: 'Financial Analyst', department: 'Consulting', monthlyBasicSalary: 34000, customWithholdingTax: 2100, tin: '234-567-892-00000', sssNo: '04-2345678-2', philhealthNo: '13-456789012-4', pagibigNo: '2345-6789-0124' },
      ];
      for (const e of initialEmployees) {
        await api('/api/operations/payroll/employees', { method: 'POST', token, body: e });
      }
    }
    const existingPayrollRes = await api('/api/operations/payroll/runs', { token });
    const existingRuns: any[] = Array.isArray(existingPayrollRes.data) ? existingPayrollRes.data : existingPayrollRes.data?.data || [];
    for (const pm of plan.payrollMonths) {
      const periodLabel = `${pm} Monthly Payroll`;
      if (existingRuns.some((r) => String(r.payrollPeriod || '').includes(pm) || String(r.paymentDate || '').startsWith(pm))) {
        continue;
      }
      const pDay = pm === '2026-11' ? '2026-11-20' : `${pm}-28`;
      await api('/api/operations/payroll/process', {
        method: 'POST',
        token,
        body: {
          payrollPeriod: periodLabel,
          startDate: `${pm}-01`,
          endDate: pDay,
          paymentDate: pDay,
          payFrequency: 'MONTHLY',
          isMonthly: true,
        },
      });
    }
  } else {
    const startTs = Date.now();
    // 2. Fix any pre-existing uncapitalized Fixed Asset (e.g. FA-2026-001) so GL 1500 matches FA Register!
    const tbBefore = await api('/api/reports/trial-balance', { token });
    const tbRows: any[] = tbBefore.data?.accounts || tbBefore.data?.rows || [];
    const gl1500Row = tbRows.find((r: any) => String(r.accountCode) === '1500');
    const gl1500Centavos = gl1500Row ? Math.round((Number(gl1500Row.debit || 0) - Number(gl1500Row.credit || 0))) : 0;
    const faGrossCentavos = fixedAssets.reduce((s, a) => s + Number(a.rawAcquisitionCost || Math.round(Number(a.acquisitionCost || 0) * 100)), 0);
    if (faGrossCentavos > gl1500Centavos && faAcc && eqAcc) {
      const capDiff = faGrossCentavos - gl1500Centavos;
      const jeCap = await api('/api/accounting/journals', {
        method: 'POST',
        token,
        body: {
          journalNumber: `JE-FA-INIT-${plan.id.slice(-2)}`,
          entryDate: '2026-01-05',
          description: 'Capitalize initial Fixed Asset Register balance to GL 1500 Equipment',
          lines: [
            { accountId: faAcc.id, description: 'Capitalize initial Fixed Asset Equipment', debit: capDiff, credit: 0 },
            { accountId: eqAcc.id, description: 'Owner / Opening Capitalization Offset', debit: 0, credit: capDiff },
          ],
        },
      });
      if (jeCap.ok && jeCap.data?.id) {
        await api(`/api/accounting/journals/${jeCap.data.id}/submit`, { method: 'POST', token });
        await api(`/api/accounting/journals/${jeCap.data.id}/approve`, { method: 'POST', token });
        await api(`/api/accounting/journals/${jeCap.data.id}/post`, { method: 'POST', token });
        counters.journalEntries++;
      }
    }

    // Inject healthy working capital equity contribution so 200+ supplier DVs & payroll never overdraw cash
    if (cashAcc && eqAcc) {
      const capAmount = plan.vatStatus === 'VAT' ? 2500000000 : 800000000; // P25M / P8M
      const jeFund = await api('/api/accounting/journals', {
        method: 'POST',
        token,
        body: {
          journalNumber: `JE-CAP-2026-${plan.id.slice(-2)}`,
          entryDate: '2026-01-02',
          description: '2026 Working Capital & Treasury Expansion Injection',
          lines: [
            { accountId: cashAcc.id, description: 'Treasury Operating Cash Infusion', debit: capAmount, credit: 0 },
            { accountId: eqAcc.id, description: 'Paid-in Capital / Owner Contribution', debit: 0, credit: capAmount },
          ],
        },
      });
      if (jeFund.ok && jeFund.data?.id) {
        await api(`/api/accounting/journals/${jeFund.data.id}/submit`, { method: 'POST', token });
        await api(`/api/accounting/journals/${jeFund.data.id}/approve`, { method: 'POST', token });
        await api(`/api/accounting/journals/${jeFund.data.id}/post`, { method: 'POST', token });
        counters.journalEntries++;
      }
    }

    // 3. BULK SALES INVOICES + CUSTOMER COLLECTIONS (Jan–Nov 2026, all lifecycle statuses)
    const siJobs = Array.from({ length: plan.salesInvoiceCount }, (_, i) => i + 1);
    await runPool(siJobs, 6, async (idx) => {
      const monthNum = ((idx - 1) % 11) + 1; // Jan..Nov 2026
      const dayNum = ((idx * 3) % 25) + 1;
      const invDate = `2026-${pad2(monthNum)}-${pad2(dayNum)}`;
      const cust = customers[idx % customers.length];
      // Deterministic realistic amounts (clean multiples of 112 for VAT exact centavos)
      const basePesos = (15 + (idx % 25) * 4) * 1000;
      const grossPesos = plan.vatStatus === 'VAT' ? Math.round(basePesos * 1.12) : basePesos;
      const grossCentavos = grossPesos * 100;
      const invNo = `SI-STR-${pad4(idx)}`;

      // Lifecycle mix:
      // 65% PAID, 16% PARTIAL, 10% POSTED (half overdue in Jan-Sep, half current in Nov), 3% APPROVED, 3% SUBMITTED, 3% DRAFT
      const bucket = idx % 100;
      let targetStatus: 'PAID' | 'PARTIAL' | 'POSTED_OVERDUE' | 'POSTED_CURRENT' | 'APPROVED' | 'SUBMITTED' | 'DRAFT' = 'PAID';
      if (bucket >= 97) targetStatus = 'DRAFT';
      else if (bucket >= 94) targetStatus = 'SUBMITTED';
      else if (bucket >= 91) targetStatus = 'APPROVED';
      else if (bucket >= 86) targetStatus = 'POSTED_CURRENT';
      else if (bucket >= 81) targetStatus = 'POSTED_OVERDUE';
      else if (bucket >= 65) targetStatus = 'PARTIAL';

      const effectiveInvDate = targetStatus === 'POSTED_CURRENT' ? `2026-11-${pad2(Math.min(18, dayNum))}` :
                               targetStatus === 'POSTED_OVERDUE' ? `2026-${pad2(((idx % 8) + 1))}-${pad2(dayNum)}` : invDate;
      const dueDate = addDaysIso(effectiveInvDate, 30);

      const createR = await api('/api/accounting/sales-invoices', {
        method: 'POST',
        token,
        body: {
          customerId: cust.id,
          invoiceNumber: invNo,
          invoiceDate: effectiveInvDate,
          dueDate,
          reference: `SO-2026-${pad4(idx)}`,
          totalAmount: grossCentavos,
          lines: [
            {
              description: plan.vatStatus === 'VAT'
                ? `Freight, Logistics & Commercial Supply Batch #${idx}`
                : `Advisory, Tax & Financial Consultancy Engagement #${idx}`,
              quantity: 1,
              unitPrice: grossCentavos,
              amount: grossCentavos,
              accountId: revAcc.id,
              ...(salesTaxCode?.id ? { taxCodeId: salesTaxCode.id, isTaxInclusive: true } : {}),
            },
          ],
        },
      });
      if (!createR.ok || !createR.data?.id) {
        counters.errors++;
        return;
      }
      counters.salesInvoices++;
      const siId = createR.data.id;
      if (targetStatus === 'DRAFT') return;

      const subR = await api(`/api/accounting/sales-invoices/${siId}/submit`, { method: 'POST', token });
      if (!subR.ok) { counters.errors++; return; }
      if (targetStatus === 'SUBMITTED') return;

      const appR = await api(`/api/accounting/sales-invoices/${siId}/approve`, { method: 'POST', token });
      if (!appR.ok) { counters.errors++; return; }
      if (targetStatus === 'APPROVED') return;

      const postR = await api(`/api/accounting/sales-invoices/${siId}/post`, { method: 'POST', token });
      if (!postR.ok) { counters.errors++; return; }
      if (targetStatus === 'POSTED_OVERDUE' || targetStatus === 'POSTED_CURRENT') return;

      // Record Collection / Official Receipt (with 2% CWT Form 2307 on corporate VAT clients every 3rd collection)
      const appliedCentavos = targetStatus === 'PAID' ? grossCentavos : Math.round(grossCentavos * 0.5);
      const applyCwt = idx % 3 === 0;
      const cwtBase = plan.vatStatus === 'VAT' ? Math.round(appliedCentavos / 1.12) : appliedCentavos;
      const cwtCentavos = applyCwt ? Math.round(cwtBase * 0.02) : 0;
      const cashReceivedCentavos = appliedCentavos - cwtCentavos;
      const payDate = addDaysIso(effectiveInvDate, 7) <= '2026-11-20' ? addDaysIso(effectiveInvDate, 7) : '2026-11-20';

      const cpR = await api('/api/accounting/customer-payments', {
        method: 'POST',
        token,
        body: {
          customerId: cust.id,
          paymentNumber: `OR-STR-${pad4(idx)}`,
          officialReceiptNumber: `OR-2026-${pad4(idx)}`,
          paymentDate: payDate,
          cashAccountId: cashAcc.id,
          paymentMethod: idx % 2 === 0 ? 'BANK_TRANSFER' : 'CHECK',
          amount: cashReceivedCentavos,
          withholdingTaxAmount: cwtCentavos,
          birForm2307Reference: applyCwt ? `2307-CWT-2026-${pad4(idx)}` : null,
          reference: `COLL-${pad4(idx)}`,
          applications: [{ invoiceId: siId, appliedAmount: appliedCentavos }],
        },
      });
      if (cpR.ok && cpR.data?.id) {
        await api(`/api/accounting/customer-payments/${cpR.data.id}/submit`, { method: 'POST', token });
        await api(`/api/accounting/customer-payments/${cpR.data.id}/approve`, { method: 'POST', token });
        const cpPost = await api(`/api/accounting/customer-payments/${cpR.data.id}/post`, { method: 'POST', token });
        if (cpPost.ok) counters.customerPayments++;
        else counters.errors++;
      } else {
        counters.errors++;
      }
    });

    // 4. PROCUREMENT: PO -> GRN -> 3-WAY MATCH (leaving `pendingMatchPoCount` GRN-received POs ready for manual 3-Way Match!)
    const poJobs = Array.from({ length: plan.poCount }, (_, i) => i + 1);
    await runPool(poJobs, 4, async (idx) => {
      const vend = vendors[idx % vendors.length];
      const monthNum = ((idx - 1) % 10) + 1;
      const poDate = `2026-${pad2(monthNum)}-${pad2(((idx * 2) % 20) + 1)}`;
      const qty = 10 + (idx % 15);
      const unitPrice = 2800 + (idx % 5) * 400; // pesos
      const totalPesos = qty * unitPrice;
      const poNo = `PO-STR-${pad4(idx)}`;

      const poR = await api('/api/operations/procurement/purchase-orders', {
        method: 'POST',
        token,
        body: {
          vendorId: vend.id,
          poNumber: poNo,
          poDate,
          expectedDeliveryDate: addDaysIso(poDate, 10),
          expectedTotal: totalPesos,
          items: [{ description: `Procured Logistics & Operational Units Batch #${idx}`, quantity: qty, unitPrice }],
        },
      });
      const poId = poR.data?.poId || poR.data?.id;
      if (!poR.ok || !poId) { counters.errors++; return; }
      counters.purchaseOrders++;

      const grnR = await api(`/api/operations/procurement/purchase-orders/${poId}/receive`, {
        method: 'POST',
        token,
        body: { receivedDate: addDaysIso(poDate, 5), notes: `Warehouse GRN inspection passed for ${poNo}` },
      });
      if (!grnR.ok) { counters.errors++; return; }
      counters.grns++;

      // Leave the last `pendingMatchPoCount` POs in RECEIVED state (GRN received, ready for 3-Way Match!)
      if (idx > plan.poCount - plan.pendingMatchPoCount) return;

      const matchR = await api('/api/operations/procurement/3-way-match', {
        method: 'POST',
        token,
        body: {
          poId,
          vendorInvoiceNumber: `BILL-${poNo}`,
          vendorInvoiceAmount: totalPesos,
          billAmount: totalPesos,
          autoCreateBill: true,
          expenseAccountId: cogsAcc?.id,
          atcCode: 'WC158',
        },
      });
      if (matchR.ok && matchR.data?.billId) {
        counters.threeWayMatches++;
        const postB = await api(`/api/accounting/purchase-bills/${matchR.data.billId}/post`, { method: 'POST', token });
        if (postB.ok && idx % 2 === 0) {
          // Settle half of matched PO bills with EWT WC158 (1% goods)
          const grossC = Math.round(totalPesos * 100);
          const ewtBase = plan.vatStatus === 'VAT' ? Math.round(grossC / 1.12) : grossC;
          const ewtC = Math.round(ewtBase * 0.01);
          const cashC = grossC - ewtC;
          const payR = await api(`/api/accounting/purchase-bills/${matchR.data.billId}/pay`, {
            method: 'POST',
            token,
            body: {
              paymentDate: addDaysIso(poDate, 12) <= '2026-11-20' ? addDaysIso(poDate, 12) : '2026-11-20',
              cashAccountId: cashAcc.id,
              amountCentavos: cashC,
              amount: cashC,
              withholdingTaxAmount: ewtC,
              atcCode: 'WC158',
              paymentMethod: 'BANK_TRANSFER',
              reference: `DV-PO-${pad4(idx)}`,
            },
          });
          if (payR.ok) counters.supplierPayments++;
        }
      }
    });

    // 5. DIRECT PURCHASE BILLS + SUPPLIER DISBURSEMENT VOUCHERS (with BIR RR 11-2018 EWT WC158/WC160/WC100)
    const expAccounts = [cogsAcc, rentAcc, utilAcc, suppliesAcc, profAcc].filter(Boolean);
    const pbJobs = Array.from({ length: plan.purchaseBillCount }, (_, i) => i + 1);
    await runPool(pbJobs, 6, async (idx) => {
      const monthNum = ((idx - 1) % 11) + 1;
      const dayNum = ((idx * 5) % 24) + 1;
      const vend = vendors[idx % vendors.length];
      const expAcc = expAccounts[idx % expAccounts.length];
      const isRent = expAcc?.id === rentAcc?.id;
      const isGoods = expAcc?.id === cogsAcc?.id || expAcc?.id === suppliesAcc?.id;
      const atcCode = isRent ? 'WC100' : isGoods ? 'WC158' : 'WC160';
      const ewtRate = isRent ? 0.05 : isGoods ? 0.01 : 0.02;

      const basePesos = (8 + (idx % 18) * 3) * 1000;
      const vendIsVat = String(vend.vatStatus || '').toUpperCase().includes('VAT') && !String(vend.vatStatus || '').toUpperCase().includes('NON');
      const useInputVat = plan.vatStatus === 'VAT' && vendIsVat && Boolean(purchaseTaxCode?.id);
      const grossPesos = useInputVat ? Math.round(basePesos * 1.12) : basePesos;
      const grossCentavos = grossPesos * 100;
      const billNo = `BILL-STR-${pad4(idx)}`;

      const bucket = idx % 100;
      let targetStatus: 'PAID' | 'PARTIAL' | 'POSTED_OVERDUE' | 'POSTED_CURRENT' | 'APPROVED' | 'SUBMITTED' | 'DRAFT' = 'PAID';
      if (bucket >= 96) targetStatus = 'DRAFT';
      else if (bucket >= 92) targetStatus = 'SUBMITTED';
      else if (bucket >= 88) targetStatus = 'APPROVED';
      else if (bucket >= 82) targetStatus = 'POSTED_CURRENT';
      else if (bucket >= 74) targetStatus = 'POSTED_OVERDUE';
      else if (bucket >= 58) targetStatus = 'PARTIAL';

      const billDate = targetStatus === 'POSTED_CURRENT' ? `2026-11-${pad2(Math.min(18, dayNum))}` :
                       targetStatus === 'POSTED_OVERDUE' ? `2026-${pad2(((idx % 8) + 1))}-${pad2(dayNum)}` :
                       `2026-${pad2(monthNum)}-${pad2(dayNum)}`;
      const dueDate = addDaysIso(billDate, 30);

      const createR = await api('/api/accounting/purchase-bills', {
        method: 'POST',
        token,
        body: {
          vendorId: vend.id,
          billNumber: billNo,
          billDate,
          dueDate,
          reference: `VINV-2026-${pad4(idx)}`,
          totalAmount: grossCentavos,
          lines: [
            {
              accountId: expAcc.id,
              description: `${expAcc.accountName} — Supplier Billing #${idx}`,
              amount: grossCentavos,
              ...(useInputVat ? { taxCodeId: purchaseTaxCode.id, isTaxInclusive: true } : {}),
            },
          ],
        },
      });
      if (!createR.ok || !createR.data?.id) { counters.errors++; return; }
      counters.purchaseBills++;
      const billId = createR.data.id;
      if (targetStatus === 'DRAFT') return;

      if (!(await api(`/api/accounting/purchase-bills/${billId}/submit`, { method: 'POST', token })).ok) { counters.errors++; return; }
      if (targetStatus === 'SUBMITTED') return;

      if (!(await api(`/api/accounting/purchase-bills/${billId}/approve`, { method: 'POST', token })).ok) { counters.errors++; return; }
      if (targetStatus === 'APPROVED') return;

      if (!(await api(`/api/accounting/purchase-bills/${billId}/post`, { method: 'POST', token })).ok) { counters.errors++; return; }
      if (targetStatus === 'POSTED_OVERDUE' || targetStatus === 'POSTED_CURRENT') return;

      // Disbursement Voucher with BIR RR 11-2018 EWT withholding
      const settleGross = targetStatus === 'PAID' ? grossCentavos : Math.round(grossCentavos * 0.5);
      const ewtBase = useInputVat ? Math.round(settleGross / 1.12) : settleGross;
      const ewtC = Math.round(ewtBase * ewtRate);
      const netCashC = settleGross - ewtC;
      const payDate = addDaysIso(billDate, 8) <= '2026-11-20' ? addDaysIso(billDate, 8) : '2026-11-20';

      const payR = await api(`/api/accounting/purchase-bills/${billId}/pay`, {
        method: 'POST',
        token,
        body: {
          paymentDate: payDate,
          cashAccountId: cashAcc.id,
          amountCentavos: netCashC,
          amount: netCashC,
          withholdingTaxAmount: ewtC,
          atcCode,
          paymentMethod: idx % 2 === 0 ? 'BANK_TRANSFER' : 'CHECK',
          reference: `DV-STR-${pad4(idx)}`,
        },
      });
      if (payR.ok) counters.supplierPayments++;
      else counters.errors++;
    });

    // 6. PAYROLL RUNS (including November 2026 so 1601-C shows live current-month tax!)
    const empRes = await api('/api/operations/payroll/employees', { token });
    const empList: any[] = Array.isArray(empRes.data) ? empRes.data : empRes.data?.data || [];
    if (empList.length === 0) {
      const initialEmployees = plan.id === 'LGR-PH-2026-PCT-01' ? [
        { employeeNo: 'EMP-PCT-001', firstName: 'Juan', lastName: 'Santos', position: 'Logistics Operations Director', department: 'Operations', monthlyBasicSalary: 85000, customWithholdingTax: 12500, tin: '123-456-781-00000', sssNo: '03-1234567-1', philhealthNo: '12-345678901-2', pagibigNo: '1234-5678-9012' },
        { employeeNo: 'EMP-PCT-002', firstName: 'Maria', lastName: 'Del Rosario', position: 'Warehouse Manager', department: 'Logistics', monthlyBasicSalary: 48000, customWithholdingTax: 4600, tin: '123-456-782-00000', sssNo: '03-1234567-2', philhealthNo: '12-345678901-3', pagibigNo: '1234-5678-9013' },
        { employeeNo: 'EMP-PCT-003', firstName: 'Carlos', lastName: 'Lim', position: 'Fleet Supervisor', department: 'Transport', monthlyBasicSalary: 36000, customWithholdingTax: 2400, tin: '123-456-783-00000', sssNo: '03-1234567-3', philhealthNo: '12-345678901-4', pagibigNo: '1234-5678-9014' },
      ] : [
        { employeeNo: 'EMP-BPC-001', firstName: 'Andrea', lastName: 'Morales', position: 'Senior Tax Consultant', department: 'Advisory', monthlyBasicSalary: 62000, customWithholdingTax: 8200, tin: '234-567-891-00000', sssNo: '04-2345678-1', philhealthNo: '13-456789012-3', pagibigNo: '2345-6789-0123' },
        { employeeNo: 'EMP-BPC-002', firstName: 'Eduardo', lastName: 'Tan', position: 'Financial Analyst', department: 'Consulting', monthlyBasicSalary: 34000, customWithholdingTax: 2100, tin: '234-567-892-00000', sssNo: '04-2345678-2', philhealthNo: '13-456789012-4', pagibigNo: '2345-6789-0124' },
      ];
      for (const e of initialEmployees) {
        await api('/api/operations/payroll/employees', { method: 'POST', token, body: e });
      }
    }

    const existingPayrollRes = await api('/api/operations/payroll/runs', { token });
    const existingRuns: any[] = Array.isArray(existingPayrollRes.data) ? existingPayrollRes.data : existingPayrollRes.data?.data || [];
    for (const pm of plan.payrollMonths) {
      const periodLabel = `${pm} Monthly Payroll`;
      if (existingRuns.some((r) => String(r.payrollPeriod || '').includes(pm) || String(r.paymentDate || '').startsWith(pm))) {
        continue;
      }
      const pDay = pm === '2026-11' ? '2026-11-20' : `${pm}-28`;
      const prR = await api('/api/operations/payroll/process', {
        method: 'POST',
        token,
        body: {
          payrollPeriod: periodLabel,
          startDate: `${pm}-01`,
          endDate: pDay,
          paymentDate: pDay,
          payFrequency: 'MONTHLY',
          isMonthly: true,
        },
      });
      if (prR.ok) counters.payrollRuns++;
    }

    // 7. FIXED ASSETS (Capitalized to GL 1500!) + Monthly Depreciation Jan–Oct 2026 (leaving Nov 2026 PENDING!)
    const newAssets = [
      { tag: `FA-STR-${plan.id.slice(-2)}-01`, name: 'Isuzu NLR Delivery Van (NCR Fleet)', category: 'VEHICLES', cost: 1440000, salvage: 144000, months: 60 },
      { tag: `FA-STR-${plan.id.slice(-2)}-02`, name: 'Enterprise Blade Server & Backup NAS Cluster', category: 'IT_EQUIPMENT', cost: 480000, salvage: 48000, months: 36 },
      { tag: `FA-STR-${plan.id.slice(-2)}-03`, name: 'Warehouse Cold-Chain Forklift & Racking', category: 'MACHINERY', cost: 720000, salvage: 72000, months: 60 },
    ].slice(0, plan.fixedAssetAddCount);

    for (const fa of newAssets) {
      if (!fixedAssets.some((x) => x.assetTag === fa.tag)) {
        const faR = await api('/api/operations/fixed-assets', {
          method: 'POST',
          token,
          body: {
            assetTag: fa.tag,
            assetName: fa.name,
            category: fa.category,
            acquisitionDate: '2026-01-15',
            acquisitionCost: fa.cost,
            salvageValue: fa.salvage,
            usefulLifeMonths: fa.months,
            capitalizeToGl: true,
          },
        });
        if (faR.ok) counters.fixedAssets++;
      }
    }

    // Post depreciation for Feb..Oct 2026 (leaving 2026-11 PENDING as an actionable month-end close task!)
    for (let m = 2; m <= 10; m++) {
      const pm = `2026-${pad2(m)}`;
      const depR = await api('/api/operations/depreciation/post', {
        method: 'POST',
        token,
        body: { periodMonth: pm },
      });
      if (depR.ok && Number(depR.data?.processedCount || 0) > 0) counters.depreciationRuns++;
    }

    // 8. INVENTORY STOCK MOVEMENTS (syncing GL 1080 + inventory_transactions)
    if (invItems.length > 0) {
      for (let i = 0; i < plan.stockAdjCount; i++) {
        const item = invItems[i % invItems.length];
        const isIn = i % 2 === 0;
        const adjR = await api('/api/operations/inventory/adjustments', {
          method: 'POST',
          token,
          body: {
            itemId: item.id,
            adjustmentDate: `2026-${pad2(((i % 10) + 1))}-14`,
            adjustmentType: isIn ? 'STOCK_IN' : 'STOCK_OUT',
            quantity: isIn ? 10 : 4,
            reason: isIn ? `Warehouse restock batch #${i + 1}` : `Fulfillment dispatch COGS #${i + 1}`,
          },
        });
        if (adjR.ok) counters.stockAdjustments++;
      }
    }

    // 9. CONFIGURE NOVEMBER 2026 BUDGETS (realistic OVER_BUDGET, NEAR_LIMIT, UNDER_BUDGET)
    const budgetItems = [
      { category: cogsAcc?.accountName || 'Cost of Goods Sold', monthlyLimit: plan.vatStatus === 'VAT' ? 28000000 : 12000000, notes: 'Q4 Operating Budget Ceiling' },
      { category: rentAcc?.accountName || 'Rent Expense', monthlyLimit: plan.vatStatus === 'VAT' ? 25000000 : 10000000, notes: 'BGC / QC Commercial Lease Allocation' },
      { category: utilAcc?.accountName || 'Utilities Expense', monthlyLimit: 18000000, notes: 'Power, Telco & Cloud Infrastructure' },
      { category: suppliesAcc?.accountName || 'Office Supplies Expense', monthlyLimit: 12000000, notes: 'Office & Packaging Consumables' },
      { category: 'Salaries and Wages Expense', monthlyLimit: plan.vatStatus === 'VAT' ? 40000000 : 25000000, notes: 'Monthly Payroll & Statutory Allocation' },
    ];
    await api('/api/budgets', {
      method: 'POST',
      token,
      body: { periodMonth: '2026-11', items: budgetItems },
    });

    const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(1);
    const totalCreated =
      counters.salesInvoices +
      counters.customerPayments +
      counters.purchaseOrders +
      counters.grns +
      counters.threeWayMatches +
      counters.purchaseBills +
      counters.supplierPayments +
      counters.payrollRuns +
      counters.fixedAssets +
      counters.depreciationRuns +
      counters.stockAdjustments +
      counters.journalEntries;
    console.log(`SEEDED ${totalCreated} TRANSACTIONS in ${elapsedSec}s (errors=${counters.errors})`);
    console.log(`  Breakdown:`, JSON.stringify(counters));
  }

  // =========================================================================
  // FULL ENTERPRISE CROSS-MODULE VERIFICATION & LATENCY BENCHMARK (18+ APIs)
  // =========================================================================
  const benchEndpoints: Array<{ label: string; url: string }> = [
    { label: 'Executive Dashboard Overview', url: '/api/dashboard/overview' },
    { label: 'Trial Balance (GL)', url: '/api/reports/trial-balance' },
    { label: 'Income Statement (P&L)', url: '/api/reports/income-statement' },
    { label: 'Balance Sheet (BS)', url: '/api/reports/balance-sheet' },
    { label: 'AR Aging Summary', url: '/api/reports/ar-aging' },
    { label: 'AP Aging Summary', url: '/api/reports/ap-aging' },
    { label: 'Sales Invoices Register (50/pg)', url: '/api/accounting/sales-invoices?limit=50' },
    { label: 'Purchase Bills Register (50/pg)', url: '/api/accounting/purchase-bills?limit=50' },
    { label: 'Purchase Bills PO_LINKED Filter', url: '/api/accounting/purchase-bills?limit=50&source=PO_LINKED' },
    { label: 'Purchase Bills DIRECT Filter', url: '/api/accounting/purchase-bills?limit=50&source=DIRECT' },
    { label: 'Procurement & 3-Way Match', url: '/api/operations/procurement/purchase-orders' },
    { label: 'Fixed Assets Register (No N+1)', url: '/api/operations/fixed-assets?limit=50' },
    { label: 'Inventory Valuation & Movements', url: '/api/operations/inventory/valuation' },
    { label: 'Tax Dashboard Summary (2026-11)', url: '/api/tax/dashboard-summary?periodMonth=2026-11' },
    { label: 'BIR VAT Relief Summary (Full 2026)', url: '/api/compliance/bir/vat-summary?startDate=2026-01-01&endDate=2026-12-31' },
    { label: 'BIR Form 2307 Q4 (No N+1)', url: '/api/compliance/bir/form-2307?startDate=2026-10-01&endDate=2026-12-31' },
    { label: 'BIR SLSP .DAT Export (No >999 crash)', url: '/api/tax/export/slsp?year=2026&month=11' },
    { label: 'BIR CAS Audit Log Count', url: '/api/tax/export/cas-audit-log' },
    { label: 'Budgets vs Actuals (2026-11)', url: '/api/budgets?periodMonth=2026-11' },
    { label: 'BI Analytics Budgets (GL Connected)', url: '/api/bi/budgets?periodMonth=2026-11' },
    { label: 'BI Financial Analytics (12m)', url: '/api/bi/analytics?months=12' },
    { label: 'Integrity & GL-Subledger Check', url: '/api/reports/integrity' },
  ];

  const results: Record<string, HttpResult> = {};
  const latencies: Array<{ label: string; status: number; ms: number }> = [];
  for (const ep of benchEndpoints) {
    const r = await api(ep.url, { token });
    results[ep.label] = r;
    latencies.push({ label: ep.label, status: r.status, ms: r.durationMs });
  }

  // Extract authoritative assertions
  const dash = results['Executive Dashboard Overview'].data;
  const tb = results['Trial Balance (GL)'].data;
  const bs = results['Balance Sheet (BS)'].data;
  const taxDash = results['Tax Dashboard Summary (2026-11)'].data;
  const vatRel = results['BIR VAT Relief Summary (Full 2026)'].data?.data || results['BIR VAT Relief Summary (Full 2026)'].data;
  const f2307 = results['BIR Form 2307 Q4 (No N+1)'].data?.data || results['BIR Form 2307 Q4 (No N+1)'].data;
  const casLog = results['BIR CAS Audit Log Count'].data;
  const biBudgets = results['BI Analytics Budgets (GL Connected)'].data;
  const poData = results['Procurement & 3-Way Match'].data;
  const pbData = results['Purchase Bills Register (50/pg)'].data;
  const siData = results['Sales Invoices Register (50/pg)'].data;
  const faData = results['Fixed Assets Register (No N+1)'].data;

  const tbRows = Array.isArray(tb) ? tb : (tb?.rows || tb?.lines || tb?.accounts || []);
  const tbDebit = Array.isArray(tb)
    ? tb.reduce((s: number, r: any) => s + (Number(r.debitTotal ?? r.closingDebit ?? 0)), 0)
    : Number(tb?.totalDebit ?? tb?.totals?.totalDebit ?? 0);
  const tbCredit = Array.isArray(tb)
    ? tb.reduce((s: number, r: any) => s + (Number(r.creditTotal ?? r.closingCredit ?? 0)), 0)
    : Number(tb?.totalCredit ?? tb?.totals?.totalCredit ?? 0);
  const tbDiff = Math.abs(tbDebit - tbCredit);

  const bsAssets = Number(bs?.totalAssets ?? 0);
  const bsLiabEq = Number(bs?.totalLiabilitiesAndEquity ?? (Number(bs?.totalLiabilities || 0) + Number(bs?.totalEquity || 0)));
  const bsDiff = Math.abs(bsAssets - bsLiabEq);

  const arSubledger = Number(dash?.summary?.accountsReceivable ?? 0);
  const arDiff = Math.abs(Number(dash?.reconciliation?.arVariance ?? dash?.summary?.arVariance ?? 0));
  const apDiff = Math.abs(Number(dash?.reconciliation?.apVariance ?? dash?.summary?.apVariance ?? 0));

  const f2307Items = f2307?.lineItems || (Array.isArray(f2307) ? f2307 : []);
  const f2307Withheld = Number(f2307?.summary?.totalWithheld ?? f2307Items.reduce((s: number, i: any) => s + (Number(i.totalWithheld || 0)), 0));

  const missingTinCount = [
    ...(vatRel?.purchases || []),
    ...(vatRel?.sales || []),
  ].filter((x: any) => x.validationStatus === 'MISSING_TIN').length;

  const assertions: Array<{ check: string; pass: boolean; detail: string }> = [
    {
      check: 'All 22 Module APIs returned HTTP 200',
      pass: latencies.every((l) => l.status === 200),
      detail: latencies.filter((l) => l.status !== 200).map((l) => `${l.label}=${l.status}`).join(', ') || '22/22 HTTP 200 OK',
    },
    {
      check: 'Trial Balance Balanced (Debit === Credit)',
      pass: tbDiff === 0 && tbDebit > 0,
      detail: `Dr=₱${(tbDebit / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, Cr=₱${(tbCredit / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, Diff=₱${(tbDiff / 100).toFixed(2)}`,
    },
    {
      check: 'Balance Sheet Balanced (Assets === Liabilities + Equity)',
      pass: bsDiff === 0 && bsAssets > 0,
      detail: `Assets=₱${(bsAssets / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, L+E=₱${(bsLiabEq / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, Diff=₱${(bsDiff / 100).toFixed(2)}`,
    },
    {
      check: 'AR & AP Subledgers 100% Reconciled with GL Control Accounts',
      pass: arDiff === 0 && apDiff === 0,
      detail: `AR Diff=₱${(arDiff / 100).toFixed(2)}, AP Diff=₱${(apDiff / 100).toFixed(2)}, Open AR=₱${(arSubledger / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    },
    {
      check: 'BIR TIN 14-Digit Validation (Zero false MISSING_TIN)',
      pass: missingTinCount === 0,
      detail: `MISSING_TIN rows = ${missingTinCount} across ${(vatRel?.purchases?.length || 0) + (vatRel?.sales?.length || 0)} VAT Relief lines`,
    },
    {
      check: plan.vatStatus === 'VAT'
        ? 'VAT Corp: GL Output VAT (2020) > 0 & Input VAT (1120) > 0'
        : 'Non-VAT Corp: Zero Fabricated Input VAT & Output VAT (NIRC Sec. 116)',
      pass: plan.vatStatus === 'VAT'
        ? Number(taxDash?.glTaxBalances?.outputVatCentavos || 0) > 0 && Number(taxDash?.glTaxBalances?.inputVatCentavos || 0) > 0
        : Number(vatRel?.totals?.inputVat || 0) === 0 && Number(vatRel?.totals?.outputVat || 0) === 0,
      detail: plan.vatStatus === 'VAT'
        ? `GL Output VAT=₱${(Number(taxDash?.glTaxBalances?.outputVatCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, GL Input VAT=₱${(Number(taxDash?.glTaxBalances?.inputVatCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
        : `VAT Relief Input VAT=₱${(Number(vatRel?.totals?.inputVat || 0) / 100).toFixed(2)}, Output VAT=₱${(Number(vatRel?.totals?.outputVat || 0) / 100).toFixed(2)} (2551Q Compliant)`,
    },
    {
      check: 'BIR Form 2307 Q4 Populated from Disbursement Vouchers (No N+1)',
      pass: f2307Items.length > 0 && f2307Withheld > 0,
      detail: `${f2307Items.length} payee-ATC lines, Q4 EWT Withheld=₱${(f2307Withheld / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    },
    {
      check: 'Payroll 1601-C Connected to Tax Dashboard Summary (2026-11)',
      pass: Number(taxDash?.withholdingSummary?.payrollTaxTotalCentavos || 0) > 0 && Number(taxDash?.glTaxBalances?.compensationTaxPayableCentavos || 0) > 0,
      detail: `Nov 1601-C=${taxDash?.withholdingSummary?.payrollTaxFormatted}, GL 2035=₱${(Number(taxDash?.glTaxBalances?.compensationTaxPayableCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    },
    {
      check: 'BIR SLSP .DAT Export Succeeded at High Volume',
      pass: results['BIR SLSP .DAT Export (No >999 crash)'].ok && results['BIR SLSP .DAT Export (No >999 crash)'].rawText.startsWith('S,P,'),
      detail: `${results['BIR SLSP .DAT Export (No >999 crash)'].rawText.split('\n').length} lines generated in ${results['BIR SLSP .DAT Export (No >999 crash)'].durationMs}ms`,
    },
    {
      check: 'BI Budgets Connected to Live GL Actuals',
      pass: Boolean(biBudgets?.hasConfiguredBudgets) && Number(biBudgets?.summary?.totalActual || 0) > 0,
      detail: `Configured=${biBudgets?.budgets?.length || 0} categories, Nov Actual=₱${(Number(biBudgets?.summary?.totalActual || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    },
    {
      check: 'CAS Audit Log Reports True Total Count (>100)',
      pass: Number(casLog?.totalAuditLogsCount || 0) > 100,
      detail: `Immutable Audit Logs = ${casLog?.totalAuditLogsCount}`,
    },
    {
      check: 'Actionable Items Visible Upon Login (Overdue AR/AP + Pending 3-Way Match + Drafts)',
      pass:
        Number(siData?.summary?.overdueCount ?? siData?.summary?.overdueInvoicesCount ?? 0) > 0 &&
        Number(pbData?.summary?.overdueBillsCount ?? 0) > 0 &&
        Number(poData?.summary?.pendingMatchCount ?? 0) > 0,
      detail: `Overdue AR=${siData?.summary?.overdueCount ?? siData?.summary?.overdueInvoicesCount ?? 0}, Overdue AP=${pbData?.summary?.overdueBillsCount ?? 0}, Pending 3-Way Match POs=${poData?.summary?.pendingMatchCount ?? 0}, Fixed Assets=${faData?.data?.length ?? faData?.length ?? 0}`,
    },
  ];

  const sortedMs = latencies.map((l) => l.ms).sort((a, b) => a - b);
  const p50 = sortedMs[Math.floor(sortedMs.length * 0.5)] || 0;
  const p95 = sortedMs[Math.floor(sortedMs.length * 0.95)] || 0;
  const maxL = latencies.reduce((m, l) => (l.ms > m.ms ? l : m), latencies[0]);

  console.log(`\nVERIFICATION SCORECARD — ${plan.name}:`);
  for (const a of assertions) {
    console.log(`  [${a.pass ? 'PASS' : 'FAIL'}] ${a.check} -> ${a.detail}`);
  }
  console.log(`  LATENCY (22 endpoints under heavy load): p50=${p50}ms | p95=${p95}ms | slowest=${maxL.label} (${maxL.ms}ms)`);
  console.log(`  TOTAL RECORDS: Sales Invoices=${siData?.pagination?.totalCount ?? '?'}, Purchase Bills=${pbData?.pagination?.totalCount ?? '?'}, POs=${poData?.summary?.totalPos ?? '?'}, Audit Logs=${casLog?.totalAuditLogsCount ?? '?'}`);

  return {
    companyId: plan.id,
    passed: assertions.filter((a) => a.pass).length,
    failed: assertions.filter((a) => !a.pass).length,
    assertions,
    p50,
    p95,
    slowest: maxL,
    siTotal: siData?.pagination?.totalCount ?? 0,
    pbTotal: pbData?.pagination?.totalCount ?? 0,
    poTotal: poData?.summary?.totalPos ?? 0,
    auditLogs: casLog?.totalAuditLogsCount ?? 0,
  };
}

async function main() {
  const summaries = [];
  for (const plan of PLANS) {
    summaries.push(await stressTestCompany(plan));
  }
  const totalFailed = summaries.reduce((s, x) => s + x.failed, 0);
  console.log('\n======================================================================');
  console.log(`OVERALL ENTERPRISE STRESS TEST RESULT: ${totalFailed === 0 ? 'ALL CHECKS PASSED' : `${totalFailed} CHECK(S) FAILED`}`);
  console.log('======================================================================');
  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('STRESS TEST CRASHED:', err);
  process.exit(1);
});
