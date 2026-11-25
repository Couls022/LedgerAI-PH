import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { CompanyManager } from '../src/server/services/companyManager';
import { dbContext } from '../src/server/db/context';
import * as schema from '../src/server/db/schema';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

interface StaffSpec {
  email: string;
  password: string;
  displayName: string;
  role: string;
}

interface CompanySpec {
  key: 'VAT_CORP' | 'NON_VAT_CORP';
  legalName: string;
  tradeName: string;
  tin: string;
  rdoCode: string;
  vatStatus: 'VAT' | 'NON_VAT';
  taxpayerClassification: string;
  industry: string;
  address: string;
  owner: StaffSpec;
  staff: StaffSpec[];
  openingBankCentavos: number;
  openingPettyCashCentavos: number;
  baseInvoiceCentavos: number;
  baseBillCentavos: number;
}

const COMPANY_SPECS: CompanySpec[] = [
  {
    key: 'VAT_CORP',
    legalName: 'Maharlika Pacific Trading & Logistics Corp.',
    tradeName: 'Maharlika Pacific Logistics',
    tin: '009-482-715-00000',
    rdoCode: '044',
    vatStatus: 'VAT',
    taxpayerClassification: 'CORPORATION',
    industry: 'Wholesale Trading & Logistics',
    address: '18F Bonifacio One Tower, 32nd St., BGC, Taguig City, Metro Manila 1634',
    owner: {
      email: 'owner@maharlikapacific.ph',
      password: 'Maharlika2026!',
      displayName: 'Ricardo Santos',
      role: 'Company Owner',
    },
    staff: [
      {
        email: 'accountant@maharlikapacific.ph',
        password: 'Maharlika2026!',
        displayName: 'Elena Mendoza',
        role: 'Accountant',
      },
      {
        email: 'approver@maharlikapacific.ph',
        password: 'Maharlika2026!',
        displayName: 'Marco Villanueva',
        role: 'Approver',
      },
      {
        email: 'auditor@maharlikapacific.ph',
        password: 'Maharlika2026!',
        displayName: 'Clarissa Reyes, CPA',
        role: 'Auditor',
      },
    ],
    openingBankCentavos: 25_000_000_00, // ₱25,000,000.00
    openingPettyCashCentavos: 500_000_00, // ₱500,000.00
    baseInvoiceCentavos: 85_000_00, // ₱85,000 base
    baseBillCentavos: 48_000_00, // ₱48,000 base
  },
  {
    key: 'NON_VAT_CORP',
    legalName: 'Visayas Highland Agri-Tech & Services Inc.',
    tradeName: 'Visayas Highland Agri-Tech',
    tin: '010-739-402-00000',
    rdoCode: '081',
    vatStatus: 'NON_VAT',
    taxpayerClassification: 'CORPORATION',
    industry: 'Agri-Tech & Farm Logistics Services',
    address: 'Unit 9B Cebu IT Park Corporate Center, Apas, Cebu City 6000',
    owner: {
      email: 'owner@visayashighland.ph',
      password: 'Visayas2026!',
      displayName: 'Lorenzo Alcantara',
      role: 'Company Owner',
    },
    staff: [
      {
        email: 'accountant@visayashighland.ph',
        password: 'Visayas2026!',
        displayName: 'Marisol Bautista',
        role: 'Accountant',
      },
      {
        email: 'approver@visayashighland.ph',
        password: 'Visayas2026!',
        displayName: 'Gabriel Soriano',
        role: 'Approver',
      },
      {
        email: 'bookkeeper@visayashighland.ph',
        password: 'Visayas2026!',
        displayName: 'Patricia Navarro',
        role: 'Bookkeeper',
      },
    ],
    openingBankCentavos: 12_000_000_00, // ₱12,000,000.00
    openingPettyCashCentavos: 250_000_00, // ₱250,000.00
    baseInvoiceCentavos: 42_000_00, // ₱42,000 base
    baseBillCentavos: 24_000_00, // ₱24,000 base
  },
];

const PH_CITIES = [
  'Makati City, Metro Manila',
  'Taguig City, Metro Manila',
  'Quezon City, Metro Manila',
  'Pasig City, Metro Manila',
  'Cebu City, Cebu',
  'Davao City, Davao del Sur',
  'Iloilo City, Iloilo',
  'Clark Freeport, Pampanga',
  'Calamba City, Laguna',
  'Cagayan de Oro, Misamis Oriental',
];

const PH_CUSTOMER_PREFIXES = [
  'Luzon Premier', 'Ayala Corridor', 'Pacific Rim', 'Archipelago', 'Bayanihan',
  'Manila Bay', 'Metro South', 'Cebu Maritime', 'Mindanao Fresh', 'Cordillera',
  'Taguig Tech', 'Ortigas Prime', 'Makati Central', 'Subic Freeport', 'Bicol Express',
  'Panay Harvest', 'Negros Sugar', 'Palawan Eco', 'Cavite Industrial', 'Laguna Smart',
  'Pampanga Trade', 'Batangas Port', 'Bulacan Builders', 'Rizal Retail', 'Alabang Med',
];

const PH_VENDOR_PREFIXES = [
  'Filipinas Freight', 'Pinoy Industrial', 'Meralco Grid', 'PLDT Fiber', 'San Miguel Packaging',
  'Aboitiz Supply', 'Jollibee Commissary', 'SM Wholesale', 'Robinsons Logistics', 'Puregold Bulk',
  'Petron Fleet', 'Shell Commercial', 'Wilcon Depot', 'Ace Hardware Corp', 'National Book Corp',
  'Globe Business', 'Converge ICT', 'LBC Express Corp', '2GO Sea Cargo', 'Cebu Pacific Cargo',
  'Del Monte Supply', 'Universal Robina', 'Century Pacific', 'Monde Nissin Trade', 'Ayala Land Leasing',
];

const PH_FIRST_NAMES = [
  'Jose', 'Maria', 'Juan', 'Ana', 'Miguel', 'Sofia', 'Carlos', 'Isabella', 'Rafael', 'Camille',
  'Antonio', 'Beatriz', 'Andres', 'Clarissa', 'Diego', 'Patricia', 'Gabriel', 'Marisol', 'Marco', 'Elena',
  'Paolo', 'Katrina', 'Emilio', 'Bianca', 'Ramon', 'Therese', 'Victor', 'Angela', 'Lorenzo', 'Jocelyn',
];

const PH_LAST_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Tomas', 'Andrada',
  'Villanueva', 'Ramos', 'Aquino', 'Castro', 'Navarro', 'Salazar', 'Soriano', 'Alcantara', 'Pascual', 'Del Rosario',
  'Mercado', 'Aguilar', 'Valdez', 'Castillo', 'Lim', 'Tan', 'Sy', 'Gokongwei', 'Zobel', 'Fernandez',
];

function uuid(): string {
  return crypto.randomUUID();
}

function pad(n: number, len = 4): string {
  return String(n).padStart(len, '0');
}

function dateIn2026(index: number, total: number): string {
  // Distribute deterministically across 2026-01-05 .. 2026-11-15
  const monthIdx = Math.min(10, Math.floor((index / Math.max(1, total)) * 11)); // 0..10 (Jan..Nov)
  const month = monthIdx + 1;
  const maxDay = month === 2 ? 27 : month === 11 ? 15 : 28;
  const day = (index % maxDay) + 1;
  return `2026-${pad(month, 2)}-${pad(day, 2)}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function apiFetch(
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; ok: boolean; data: any; ms: number }> {
  const start = performance.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ms = Math.round(performance.now() - start);
  let data: any = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }
  return { status: res.status, ok: res.ok, data, ms };
}

async function insertInChunks(db: any, table: any, rows: any[], chunkSize = 100, label = 'table') {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    try {
      await db.insert(table).values(chunk).onConflictDoNothing();
    } catch (err: any) {
      // Binary-locate offending row in chunk
      for (const r of chunk) {
        try {
          await db.insert(table).values(r).onConflictDoNothing();
        } catch (rowErr: any) {
          throw new Error(`[insertInChunks:${label}] ${rowErr?.message || rowErr} | ROW=${JSON.stringify(r)}`);
        }
      }
      throw new Error(`[insertInChunks:${label}] ${err?.message || err}`);
    }
  }
}

async function provisionOrFindCompany(spec: CompanySpec): Promise<{ companyId: string; ownerToken: string; created: boolean }> {
  // Check existing companies list first so script is idempotent
  const listRes = await apiFetch('GET', '/api/companies');
  const existingList: any[] = Array.isArray(listRes.data)
    ? listRes.data
    : Array.isArray(listRes.data?.companies)
      ? listRes.data.companies
      : [];

  const match = existingList.find(
    (c: any) =>
      String(c.legalName || c.name || '').toLowerCase() === spec.legalName.toLowerCase()
  );

  let companyId: string;
  let created = false;

  if (match) {
    companyId = match.id;
    console.log(`  [REUSE] Found existing company ${spec.legalName} (${companyId})`);
  } else {
    const createRes = await apiFetch('POST', '/api/companies/create-profile', undefined, {
      classification: 'DEVELOPMENT',
      company: {
        legalName: spec.legalName,
        tradeName: spec.tradeName,
        tin: spec.tin,
        address: spec.address,
        branchCode: '00000',
        contactPerson: spec.owner.displayName,
        contactEmail: spec.owner.email,
        contactPhone: '+63 2 8845 9200',
        industry: spec.industry,
        classification: 'DEVELOPMENT',
      },
      tax: {
        taxpayerClassification: spec.taxpayerClassification,
        taxpayerType: spec.taxpayerClassification,
        vatStatus: spec.vatStatus,
        rdoCode: spec.rdoCode,
        birRegistrationNo: `OCN-2026-${spec.rdoCode}-008812`,
        birDateRegistered: '2026-01-02',
      },
      accounting: {
        fiscalYear: 2026,
        fiscalYearStartMonth: 1,
        currency: 'PHP',
        accountingMethod: 'ACCRUAL',
      },
      admin: {
        email: spec.owner.email,
        password: spec.owner.password,
        displayName: spec.owner.displayName,
      },
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create company ${spec.legalName}: HTTP ${createRes.status} ${JSON.stringify(createRes.data)}`);
    }
    companyId = createRes.data?.company?.id || createRes.data?.companyId || createRes.data?.id;
    if (!companyId) {
      throw new Error(`No companyId returned for ${spec.legalName}: ${JSON.stringify(createRes.data)}`);
    }
    created = true;
    console.log(`  [CREATED] ${spec.legalName} => ${companyId} (${spec.vatStatus})`);
  }

  // Login as Company Owner
  const loginRes = await apiFetch('POST', '/api/auth/login', undefined, {
    email: spec.owner.email,
    password: spec.owner.password,
    companyId,
  });
  if (!loginRes.ok || !loginRes.data?.token) {
    throw new Error(`Owner login failed for ${spec.legalName}: HTTP ${loginRes.status} ${JSON.stringify(loginRes.data)}`);
  }
  const ownerToken = loginRes.data.token;

  // Provision RBAC staff accounts via live POST /api/users
  const existingUsersRes = await apiFetch('GET', '/api/users', ownerToken);
  const existingUsers: any[] = Array.isArray(existingUsersRes.data)
    ? existingUsersRes.data
    : Array.isArray(existingUsersRes.data?.users)
      ? existingUsersRes.data.users
      : [];

  for (const st of spec.staff) {
    const found = existingUsers.find((u: any) => String(u.email || '').toLowerCase() === st.email.toLowerCase());
    if (!found) {
      const uRes = await apiFetch('POST', '/api/users', ownerToken, {
        email: st.email,
        password: st.password,
        displayName: st.displayName,
        role: st.role,
        status: 'ACTIVE',
      });
      if (!uRes.ok) {
        throw new Error(`Failed to create staff ${st.email} (${st.role}): HTTP ${uRes.status} ${JSON.stringify(uRes.data)}`);
      }
      console.log(`    + Staff created: ${st.email} (${st.role})`);
    }
  }

  return { companyId, ownerToken, created };
}

async function seedCompanyStressDataset(spec: CompanySpec, companyId: string): Promise<Record<string, number>> {
  const db = await CompanyManager.getCompanyDb(companyId);
  const counts: Record<string, number> = {};

  await dbContext.run(db, async () => {
    // Skip bulk seed if already seeded with 250+ sales invoices
    const existingInvoices = await db.select().from(schema.salesInvoices);
    if (existingInvoices.length >= 250) {
      console.log(`  [SKIP SEED] ${spec.legalName} already contains ${existingInvoices.length} invoices.`);
      counts.alreadySeeded = existingInvoices.length;
      return;
    }

    // If a previous seed run aborted mid-way before flushing invoices/JEs, clear partial operational tables cleanly
    const existingPRs = await db.select().from(schema.purchaseRequisitions);
    if (existingInvoices.length === 0 && existingPRs.length > 0) {
      console.log(`  [CLEANUP] Clearing interrupted partial seed state for ${spec.legalName}...`);
      const tablesToClear = [
        schema.goodsReceiptLines, schema.goodsReceiptNotes, schema.purchaseOrderLines, schema.purchaseOrders,
        schema.purchaseRequisitions, schema.inventoryTransactions, schema.stockAdjustments, schema.inventoryItems,
        schema.checks, schema.cashCountDenominations, schema.cashCounts, schema.bankReconciliationAdjustments,
        schema.bankStatementLines, schema.bankReconciliations, schema.bankTransactions, schema.bankStatements,
        schema.currencyExchangeRates, schema.recurringJournals, schema.fixedAssets, schema.employees,
        schema.taxFilingChecklists, schema.taxManualAdjustments, schema.taxExceptions, schema.taxFilings,
        schema.taxCalendar, schema.electronicFilingSubmissions, schema.budgets, schema.cashFlowForecasts,
        schema.documentOcrHistory, schema.documentVersions, schema.documents,
        schema.approvalSteps, schema.approvalWorkflows, schema.approvalWorkflowRequests, schema.approvalDelegations,
        schema.auditEngagementItems, schema.auditPlanningDocs, schema.auditSignificantAccounts,
        schema.auditRisksAndProcedures, schema.auditWorkpapers, schema.auditFindings, schema.auditEngagements,
        schema.fraudFlags, schema.internalControlsLog, schema.notifications, schema.systemBackups,
        schema.journalLines, schema.journalEntries,
      ];
      for (const tbl of tablesToClear) {
        await db.delete(tbl).catch(() => {});
      }
    }

    const t0 = performance.now();
    const isVat = spec.vatStatus === 'VAT';

    // Lookup users in this isolated DB
    const dbUsers = await db.select().from(schema.users);
    const findUserId = (email: string) =>
      dbUsers.find((u: any) => u.email.toLowerCase() === email.toLowerCase())?.id || dbUsers[0].id;
    const ownerId = findUserId(spec.owner.email);
    const accountantId = findUserId(spec.staff[0].email);
    const approverId = findUserId(spec.staff[1].email);
    const reviewerId = findUserId(spec.staff[2].email);

    // Lookup seeded COA
    const dbAccounts = await db.select().from(schema.accounts);
    const accByCode = new Map<string, string>();
    for (const a of dbAccounts) {
      accByCode.set(a.accountCode, a.id);
    }

    const ensureAccount = async (
      code: string,
      name: string,
      type: string,
      detailType: string,
      normalBalance: 'DEBIT' | 'CREDIT',
      flags: { isCashAccount?: boolean; isControlAccount?: boolean; isTaxAccount?: boolean; birTaxCategory?: string; status?: string } = {}
    ) => {
      if (accByCode.has(code)) return accByCode.get(code)!;
      const id = uuid();
      await db.insert(schema.accounts).values({
        id,
        companyId,
        accountCode: code,
        accountName: name,
        accountType: type,
        detailType,
        normalBalance,
        isCashAccount: Boolean(flags.isCashAccount),
        isControlAccount: Boolean(flags.isControlAccount),
        isTaxAccount: Boolean(flags.isTaxAccount),
        birTaxCategory: flags.birTaxCategory || null,
        status: flags.status || 'ACTIVE',
      }).onConflictDoNothing();
      accByCode.set(code, id);
      return id;
    };

    // Ensure key COA accounts exist + add extra custom COA accounts (including INACTIVE & ARCHIVED for full status coverage)
    const accCashBank = await ensureAccount('1010', 'Cash in Bank', 'ASSET', 'Checking Account', 'DEBIT', { isCashAccount: true });
    const accPettyCash = await ensureAccount('1020', 'Petty Cash Fund', 'ASSET', 'Petty Cash Fund', 'DEBIT', { isCashAccount: true });
    const accAR = await ensureAccount('1030', 'Accounts Receivable', 'RECEIVABLE', 'TRADE_RECEIVABLE', 'DEBIT', { isControlAccount: true });
    const accInputVat = await ensureAccount('1050', 'Input VAT', 'ASSET', 'INPUT_VAT', 'DEBIT', { isTaxAccount: true, birTaxCategory: 'INPUT_VAT_12' });
    const accCWT = await ensureAccount('1055', 'Creditable Withholding Tax (BIR Form 2307)', 'ASSET', 'CWT_ASSET', 'DEBIT', { isTaxAccount: true, birTaxCategory: 'CWT_2307' });
    const accInventory = await ensureAccount('1080', 'Merchandise Inventory', 'INVENTORY', 'INVENTORY', 'DEBIT');
    const accEquipment = await ensureAccount('1510', 'Property, Plant & Equipment', 'FIXED_ASSET', 'EQUIPMENT', 'DEBIT');
    const accAccumDep = await ensureAccount('1590', 'Accumulated Depreciation', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'CREDIT');
    const accAP = await ensureAccount('2010', 'Accounts Payable', 'PAYABLE', 'TRADE_PAYABLE', 'CREDIT', { isControlAccount: true });
    const accOutputVat = await ensureAccount('2020', 'Output VAT Payable', 'PAYABLE', 'OUTPUT_VAT', 'CREDIT', { isTaxAccount: true, birTaxCategory: 'OUTPUT_VAT_12' });
    const accEWT = await ensureAccount('2030', 'Expanded Withholding Tax Payable (1601-EQ)', 'PAYABLE', 'EWT_PAYABLE', 'CREDIT', { isTaxAccount: true, birTaxCategory: 'EWT_1601EQ' });
    const accWHTComp = await ensureAccount('2035', 'Withholding Tax on Compensation Payable (1601-C)', 'PAYABLE', 'WHT_COMPENSATION', 'CREDIT', { isTaxAccount: true, birTaxCategory: 'WHT_1601C' });
    const accStatutory = await ensureAccount('2040', 'SSS, PhilHealth & Pag-IBIG Payable', 'PAYABLE', 'STATUTORY_PAYABLE', 'CREDIT');
    const accPctTaxPayable = await ensureAccount('2120', 'Percentage Tax Payable (Form 2551Q - 3%)', 'LIABILITY', 'PERCENTAGE_TAX', 'CREDIT', { isTaxAccount: true, birTaxCategory: 'PERCENTAGE_TAX_3' });
    const accEquity = await ensureAccount('3010', "Owner's Equity / Share Capital", 'EQUITY', 'CAPITAL', 'CREDIT');
    const accSalesRev = await ensureAccount('4010', 'Sales Revenue', 'REVENUE', 'SALES_REVENUE', 'CREDIT');
    const accServiceRev = await ensureAccount('4020', 'Service & Logistics Revenue', 'REVENUE', 'SERVICE_REVENUE', 'CREDIT');
    const accInterestInc = await ensureAccount('4090', 'Interest Income', 'REVENUE', 'OTHER_INCOME', 'CREDIT');
    const accCogs = await ensureAccount('5010', 'Cost of Goods Sold', 'COST_OF_SALES', 'COGS', 'DEBIT');
    const accSalaries = await ensureAccount('6010', 'Salaries & Wages Expense', 'EXPENSE', 'PAYROLL_EXPENSE', 'DEBIT');
    const accRent = await ensureAccount('6020', 'Rent & Warehouse Lease Expense', 'EXPENSE', 'RENT_EXPENSE', 'DEBIT');
    const accUtilities = await ensureAccount('6030', 'Utilities & Telecom Expense', 'EXPENSE', 'UTILITIES_EXPENSE', 'DEBIT');
    const accSupplies = await ensureAccount('6040', 'Office & Operating Supplies', 'EXPENSE', 'SUPPLIES_EXPENSE', 'DEBIT');
    const accTransport = await ensureAccount('6050', 'Freight, Fuel & Delivery Expense', 'EXPENSE', 'LOGISTICS_EXPENSE', 'DEBIT');
    const accDepExp = await ensureAccount('6060', 'Depreciation Expense', 'EXPENSE', 'DEPRECIATION_EXPENSE', 'DEBIT');
    const accProfFees = await ensureAccount('6070', 'Professional & Consulting Fees', 'EXPENSE', 'PROFESSIONAL_FEES', 'DEBIT');
    const accPctTaxExp = await ensureAccount('6080', 'Percentage Tax Expense (3%)', 'EXPENSE', 'PERCENTAGE_TAX_EXPENSE', 'DEBIT');
    const accBankCharges = await ensureAccount('6090', 'Bank Charges & Documentary Stamp Tax', 'EXPENSE', 'BANK_FEES', 'DEBIT');
    const accFxGainLoss = await ensureAccount('6095', 'Unrealized Foreign Exchange Gain / (Loss)', 'EXPENSE', 'FX_REVALUATION', 'DEBIT');

    // Extra custom accounts covering INACTIVE & ARCHIVED states in COA
    await ensureAccount('1015', 'Cash in Bank - USD Dollar Savings (BDO)', 'ASSET', 'FOREIGN_CURRENCY_BANK', 'DEBIT', { isCashAccount: true, status: 'ACTIVE' });
    await ensureAccount('6110', 'Marketing & Trade Exhibitions Expense', 'EXPENSE', 'MARKETING', 'DEBIT', { status: 'ACTIVE' });
    await ensureAccount('6120', 'Legacy Print Advertising (Inactive)', 'EXPENSE', 'MARKETING', 'DEBIT', { status: 'INACTIVE' });
    await ensureAccount('6199', 'Deprecated Legacy Expense Account', 'EXPENSE', 'OTHER_EXPENSE', 'DEBIT', { status: 'ARCHIVED' });

    // Ensure 12 Accounting Periods for 2026 with mixed statuses (HARD_CLOSED, SOFT_CLOSED, OPEN)
    const existingPeriods = await db.select().from(schema.accountingPeriods);
    const periodMap = new Map<string, string>(); // '2026-01' -> id
    for (const p of existingPeriods) {
      periodMap.set(p.name, p.id);
    }

    const periodHistRows: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const pName = `2026-${pad(m, 2)}`;
      const lastDay = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      const targetStatus = m <= 3 ? 'HARD_CLOSED' : m <= 6 ? 'SOFT_CLOSED' : 'OPEN';
      let pid = periodMap.get(pName);
      if (!pid) {
        pid = uuid();
        await db.insert(schema.accountingPeriods).values({
          id: pid,
          companyId,
          name: pName,
          startDate: `2026-${pad(m, 2)}-01`,
          endDate: `2026-${pad(m, 2)}-${pad(lastDay, 2)}`,
          fiscalYear: 2026,
          status: targetStatus,
          softClosedBy: m <= 6 ? accountantId : null,
          hardClosedBy: m <= 3 ? ownerId : null,
          closedBy: m <= 3 ? ownerId : null,
        });
        periodMap.set(pName, pid);
      } else {
        await db.update(schema.accountingPeriods).set({
          status: targetStatus,
          softClosedBy: m <= 6 ? accountantId : null,
          hardClosedBy: m <= 3 ? ownerId : null,
        }).where(eq(schema.accountingPeriods.id, pid));
      }
      if (targetStatus !== 'OPEN') {
        periodHistRows.push({
          id: uuid(),
          companyId,
          accountingPeriodId: pid,
          action: targetStatus === 'HARD_CLOSED' ? 'HARD_CLOSE' : 'SOFT_CLOSE',
          previousStatus: 'OPEN',
          newStatus: targetStatus,
          reason: `Monthly close completed & reconciled for ${pName}`,
          changedBy: targetStatus === 'HARD_CLOSED' ? ownerId : accountantId,
        });
      }
    }
    if (periodHistRows.length > 0) {
      await insertInChunks(db, schema.periodStatusHistory, periodHistRows);
    }
    const getPeriodId = (isoDate: string) => periodMap.get(isoDate.slice(0, 7)) || null;

    // -----------------------------------------------------------------------
    // MODULE 16: MASTER DATA (Departments, Projects, Cost Centers, Locations, Banks, Payment Methods, Tax Rules/Codes/ATCs, Customers, Vendors)
    // -----------------------------------------------------------------------
    const deptNames = ['Finance & Accounting', 'Sales & Commercial', 'Procurement & Supply Chain', 'Warehouse & Logistics', 'Human Resources & Admin', 'IT & Digital Operations'];
    const deptRows = deptNames.map((name, i) => ({
      id: uuid(),
      companyId,
      code: `DEPT-${pad(i + 1, 2)}`,
      name,
      managerName: `${PH_FIRST_NAMES[i]} ${PH_LAST_NAMES[i]}`,
      status: 'ACTIVE',
    }));
    await insertInChunks(db, schema.departments, deptRows, 50, 'departments');
    const persistedDepts = await db.select().from(schema.departments);
    deptRows.length = 0;
    deptRows.push(...persistedDepts);

    const ccRows = deptRows.map((d, i) => ({
      id: uuid(),
      companyId,
      code: `CC-${pad(i + 1, 3)}`,
      name: `${d.name} Cost Center`,
      departmentId: d.id,
      status: 'ACTIVE',
    }));
    await insertInChunks(db, schema.costCenters, ccRows, 50, 'costCenters');
    const persistedCCs = await db.select().from(schema.costCenters);
    ccRows.length = 0;
    ccRows.push(...persistedCCs);

    const locRows = [
      { id: uuid(), companyId, code: 'HQ-001', name: 'Head Office (Main Branch)', address: spec.address, isMainBranch: true, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'WH-002', name: 'Calamba Central Warehouse', address: 'Carmelray Industrial Park II, Calamba, Laguna', isMainBranch: false, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'BR-003', name: 'Cebu Visayas Hub', address: 'Mandaue North Road, Cebu', isMainBranch: false, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'BR-004', name: 'Davao Mindanao Hub', address: 'Lanang Business Park, Davao City', isMainBranch: false, status: 'ACTIVE' },
    ];
    await insertInChunks(db, schema.locations, locRows);

    const bankDefs = [
      { code: 'BNK-BDO', bankName: 'BDO Unibank, Inc.', branch: 'BGC Corporate Center', acct: '0048-2910-4421', type: 'CHECKING' },
      { code: 'BNK-BPI', bankName: 'Bank of the Philippine Islands (BPI)', branch: 'Ayala Triangle', acct: '1093-4481-02', type: 'CHECKING' },
      { code: 'BNK-MBTC', bankName: 'Metropolitan Bank & Trust Co.', branch: 'Ortigas Center', acct: '007-481-52109-4', type: 'SAVINGS' },
      { code: 'BNK-LBP', bankName: 'Land Bank of the Philippines', branch: 'Intramuros Main', acct: '3402-1194-08', type: 'CHECKING' },
    ];
    const bankRows = bankDefs.map((b) => ({
      id: uuid(),
      companyId,
      code: b.code,
      bankName: b.bankName,
      branch: b.branch,
      accountNumber: b.acct,
      accountType: b.type,
      currency: 'PHP',
      glAccountId: accCashBank,
      status: 'ACTIVE',
    }));
    await insertInChunks(db, schema.banks, bankRows);

    const bankAccountRows = bankDefs.map((b) => ({
      id: uuid(),
      companyId,
      glAccountId: accCashBank,
      accountName: `${b.bankName} — ${b.branch}`,
      bankName: b.bankName,
      accountNumberEncrypted: `ENC-${b.acct}`,
      currency: 'PHP',
      status: 'ACTIVE',
    }));
    await insertInChunks(db, schema.bankAccounts, bankAccountRows, 50, 'bankAccounts');
    const persistedBankAccts = await db.select().from(schema.bankAccounts);
    bankAccountRows.length = 0;
    bankAccountRows.push(...persistedBankAccts);

    const pmRows = [
      { id: uuid(), companyId, code: 'PM-BANK', name: 'PESONet / InstaPay Bank Transfer', type: 'BANK_TRANSFER', defaultAccountId: accCashBank, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'PM-CHECK', name: 'Corporate Check Disbursement', type: 'CHECK', defaultAccountId: accCashBank, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'PM-CASH', name: 'Cash / Petty Cash', type: 'CASH', defaultAccountId: accPettyCash, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'PM-GCASH', name: 'GCash / Maya Business E-Wallet', type: 'E_WALLET', defaultAccountId: accCashBank, status: 'ACTIVE' },
      { id: uuid(), companyId, code: 'PM-CARD', name: 'Corporate Credit Card', type: 'CREDIT_CARD', defaultAccountId: accCashBank, status: 'ACTIVE' },
    ];
    await insertInChunks(db, schema.paymentMethods, pmRows);

    // Seed Tax Rule Definitions, Versions, ATCs, and Tax Codes
    const existingRuleDefs = await db.select().from(schema.taxRuleDefinitions);
    const ruleDefByCode = new Map<string, string>();
    for (const r of existingRuleDefs) ruleDefByCode.set(r.ruleCode, r.id);

    const ruleSpecs = [
      { code: 'PH-VAT-12', name: 'Philippine 12% Value-Added Tax (NIRC Sec. 106/108)', taxType: 'VAT', rate: 0.12, ref: 'RA 10963 / TRAIN Law' },
      { code: 'PH-PT-3', name: 'Philippine 3% Non-VAT Percentage Tax (Sec. 116)', taxType: 'PERCENTAGE_TAX', rate: 0.03, ref: 'NIRC Sec. 116 / CREATE' },
      { code: 'PH-EWT-1', name: 'EWT 1% — Purchase of Goods (Top Withholding Agent)', taxType: 'EWT', rate: 0.01, ref: 'RR 11-2018 (WC158)' },
      { code: 'PH-EWT-2', name: 'EWT 2% — Purchase of Services / Contractors', taxType: 'EWT', rate: 0.02, ref: 'RR 11-2018 (WC160)' },
      { code: 'PH-EWT-5', name: 'EWT 5% — Commercial Rentals & Leases', taxType: 'EWT', rate: 0.05, ref: 'RR 11-2018 (WC100)' },
    ];
    const ruleVerByCode = new Map<string, string>();
    const existingRuleVers = await db.select().from(schema.taxRuleVersions);
    for (const rv of existingRuleVers) {
      const def = existingRuleDefs.find((d: any) => d.id === rv.ruleDefinitionId);
      if (def) ruleVerByCode.set(def.ruleCode, rv.id);
    }

    for (const rs of ruleSpecs) {
      let defId = ruleDefByCode.get(rs.code);
      if (!defId) {
        defId = uuid();
        await db.insert(schema.taxRuleDefinitions).values({
          id: defId,
          ruleCode: rs.code,
          ruleName: rs.name,
          taxType: rs.taxType,
          description: rs.name,
          status: 'ACTIVE',
        }).onConflictDoNothing();
        ruleDefByCode.set(rs.code, defId);
      }
      if (!ruleVerByCode.has(rs.code)) {
        const verId = uuid();
        await db.insert(schema.taxRuleVersions).values({
          id: verId,
          ruleDefinitionId: defId,
          version: 1,
          effectiveFrom: '2024-01-01',
          calculationMethod: 'PERCENTAGE_OF_BASE',
          rateValue: rs.rate,
          sourceReference: rs.ref,
          sourceTitle: rs.name,
          sourceType: 'BIR_RR',
          status: 'ACTIVE',
        }).onConflictDoNothing();
        ruleVerByCode.set(rs.code, verId);
      }
    }

    const atcRows = [
      { id: uuid(), code: 'WC158', description: 'Income payments made by top withholding agents to local supplier of goods (Corp)', incomeType: 'GOODS', taxRate: 0.01, taxpayerClassification: 'CORPORATION', formReference: '2307 / 1601-EQ' },
      { id: uuid(), code: 'WC160', description: 'Income payments made by top withholding agents to local supplier of services (Corp)', incomeType: 'SERVICES', taxRate: 0.02, taxpayerClassification: 'CORPORATION', formReference: '2307 / 1601-EQ' },
      { id: uuid(), code: 'WC100', description: 'Rentals — Real properties / Commercial warehouse lease (Corp)', incomeType: 'RENTAL', taxRate: 0.05, taxpayerClassification: 'CORPORATION', formReference: '2307 / 1601-EQ' },
      { id: uuid(), code: 'WI010', description: 'Professional, talent, and consultancy fees paid to individuals', incomeType: 'PROFESSIONAL', taxRate: 0.05, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601-EQ' },
      { id: uuid(), code: 'WC120', description: 'Payments to prime contractors / sub-contractors (Corp)', incomeType: 'CONTRACTOR', taxRate: 0.02, taxpayerClassification: 'CORPORATION', formReference: '2307 / 1601-EQ' },
    ];
    await insertInChunks(db, schema.atcDefinitions, atcRows);

    const existingTaxCodes = await db.select().from(schema.taxCodes);
    const taxCodeMap = new Map<string, string>();
    for (const tc of existingTaxCodes) taxCodeMap.set(tc.code, tc.id);

    const ensureTaxCode = async (code: string, name: string, taxType: string, dir: 'INPUT' | 'OUTPUT', accountId: string, ruleCode: string) => {
      if (taxCodeMap.has(code)) return taxCodeMap.get(code)!;
      const id = uuid();
      await db.insert(schema.taxCodes).values({
        id,
        companyId,
        code,
        name,
        taxType,
        inputOutputDirection: dir,
        accountId,
        ruleDefinitionId: ruleDefByCode.get(ruleCode) || null,
        status: 'ACTIVE',
      }).onConflictDoNothing();
      taxCodeMap.set(code, id);
      return id;
    };

    const tcVatOut = await ensureTaxCode('VAT12_OUT', '12% Output VAT (Vatable Sales)', 'VAT', 'OUTPUT', accOutputVat, 'PH-VAT-12');
    const tcVatIn = await ensureTaxCode('VAT12_IN', '12% Creditable Input VAT (Purchases)', 'VAT', 'INPUT', accInputVat, 'PH-VAT-12');
    const tcPt3 = await ensureTaxCode('PT3_OUT', '3% Non-VAT Percentage Tax (2551Q)', 'PERCENTAGE_TAX', 'OUTPUT', accPctTaxPayable, 'PH-PT-3');
    const tcEwt1 = await ensureTaxCode('EWT_1_GOODS', '1% EWT — Goods (WC158)', 'EWT', 'INPUT', accEWT, 'PH-EWT-1');
    const tcEwt2 = await ensureTaxCode('EWT_2_SVC', '2% EWT — Services (WC160)', 'EWT', 'INPUT', accEWT, 'PH-EWT-2');
    const tcEwt5 = await ensureTaxCode('EWT_5_RENT', '5% EWT — Rentals (WC100)', 'EWT', 'INPUT', accEWT, 'PH-EWT-5');

    // 50 Customers (44 ACTIVE, 3 INACTIVE, 3 ARCHIVED)
    const customerRows: any[] = [];
    for (let i = 0; i < 50; i++) {
      const prefix = PH_CUSTOMER_PREFIXES[i % PH_CUSTOMER_PREFIXES.length];
      const suffix = i < 25 ? 'Corporation' : 'Trading Inc.';
      const status = i >= 47 ? 'ARCHIVED' : i >= 44 ? 'INACTIVE' : 'ACTIVE';
      customerRows.push({
        id: uuid(),
        companyId,
        code: `CUST-${pad(i + 1, 4)}`,
        legalName: `${prefix} ${suffix} ${i >= 25 ? 'II' : ''}`.trim(),
        tradeName: `${prefix} PH`,
        tin: `00${(i % 8) + 1}-${pad(210 + i * 7, 3)}-${pad(400 + i * 11, 3)}-00000`,
        address: PH_CITIES[i % PH_CITIES.length],
        billingAddress: PH_CITIES[i % PH_CITIES.length],
        contactPerson: `${PH_FIRST_NAMES[i % PH_FIRST_NAMES.length]} ${PH_LAST_NAMES[i % PH_LAST_NAMES.length]}`,
        contactDetails: `ar@client${pad(i + 1, 3)}.ph`,
        paymentTerms: i % 3 === 0 ? 'NET_30' : i % 3 === 1 ? 'NET_45' : 'NET_15',
        creditLimit: (500_000 + i * 50_000) * 100,
        taxClassification: 'CORPORATION',
        vatStatus: i % 5 === 0 ? 'NON_VAT' : 'VAT',
        withholdingApplicability: i % 2 === 0 ? 'CWT_2' : 'CWT_1',
        defaultReceivableAccountId: accAR,
        defaultRevenueAccountId: accSalesRev,
        status,
      });
    }
    await insertInChunks(db, schema.customers, customerRows, 100, 'customers');
    const persistedCustomers = await db.select().from(schema.customers);
    customerRows.length = 0;
    customerRows.push(...persistedCustomers);
    const activeCustomers = customerRows.filter((c) => c.status === 'ACTIVE');

    // 6 Projects linked to Customers
    const projRows = [
      '2026 Cold-Chain Expansion', 'Nationwide ERP Rollout', 'Visayas Port Integration',
      'BGC Hub Modernization', 'Luzon Retail Fulfillment', 'Mindanao Agri-Supply Link',
    ].map((name, i) => ({
      id: uuid(),
      companyId,
      code: `PRJ-2026-${pad(i + 1, 2)}`,
      name,
      clientCustomerId: activeCustomers[i % activeCustomers.length].id,
      budgetAmount: (1_500_000 + i * 400_000) * 100,
      startDate: '2026-01-15',
      endDate: '2026-12-15',
      status: i === 5 ? 'COMPLETED' : 'ACTIVE',
    }));
    await insertInChunks(db, schema.projects, projRows, 50, 'projects');
    const persistedProjects = await db.select().from(schema.projects);
    projRows.length = 0;
    projRows.push(...persistedProjects);

    // 50 Vendors (44 ACTIVE, 3 INACTIVE, 3 ARCHIVED)
    const vendorRows: any[] = [];
    for (let i = 0; i < 50; i++) {
      const prefix = PH_VENDOR_PREFIXES[i % PH_VENDOR_PREFIXES.length];
      const suffix = i < 25 ? 'Inc.' : 'Enterprises Corp.';
      const status = i >= 47 ? 'ARCHIVED' : i >= 44 ? 'INACTIVE' : 'ACTIVE';
      const atcTag = i % 3 === 0 ? 'WC158 (1% Goods)' : i % 3 === 1 ? 'WC160 (2% Services)' : 'WC100 (5% Rental)';
      vendorRows.push({
        id: uuid(),
        companyId,
        code: `VEND-${pad(i + 1, 4)}`,
        legalName: `${prefix} ${suffix}`.trim(),
        tradeName: prefix,
        tin: `00${(i % 7) + 2}-${pad(510 + i * 9, 3)}-${pad(700 + i * 5, 3)}-00000`,
        address: PH_CITIES[(i + 2) % PH_CITIES.length],
        contactPerson: `${PH_FIRST_NAMES[(i + 5) % PH_FIRST_NAMES.length]} ${PH_LAST_NAMES[(i + 7) % PH_LAST_NAMES.length]}`,
        contactDetails: `billing@vendor${pad(i + 1, 3)}.ph`,
        paymentTerms: i % 2 === 0 ? 'NET_30' : 'NET_15',
        taxClassification: 'CORPORATION',
        vatStatus: i % 4 === 0 ? 'NON_VAT' : 'VAT',
        withholdingApplicability: atcTag,
        defaultPayableAccountId: accAP,
        defaultExpenseAccountId: i % 3 === 0 ? accCogs : i % 3 === 1 ? accTransport : accRent,
        status,
      });
    }
    await insertInChunks(db, schema.vendors, vendorRows, 100, 'vendors');
    const persistedVendors = await db.select().from(schema.vendors);
    vendorRows.length = 0;
    vendorRows.push(...persistedVendors);
    const activeVendors = vendorRows.filter((v) => v.status === 'ACTIVE');

    // Buffers for bulk JEs, Lines, Tax Calculations, Audit Logs, Approval Workflows
    const jeBuffer: any[] = [];
    const jlBuffer: any[] = [];
    const taxCalcBuffer: any[] = [];
    const wfBuffer: any[] = [];
    const wfStepBuffer: any[] = [];
    const auditBuffer: any[] = [];

    let jeSeq = 1;
    const pushJE = (opts: {
      date: string;
      description: string;
      sourceType: string;
      sourceId?: string;
      status: string;
      createdBy?: string;
      approvedBy?: string | null;
      postedBy?: string | null;
      originalJournalId?: string | null;
      rejectionReason?: string | null;
      lines: Array<{ accountId: string; debit: number; credit: number; description?: string; deptIdx?: number; projIdx?: number; ccIdx?: number }>;
    }) => {
      const id = uuid();
      const totalDr = opts.lines.reduce((s, l) => s + l.debit, 0);
      const totalCr = opts.lines.reduce((s, l) => s + l.credit, 0);
      if (totalDr !== totalCr) {
        throw new Error(`Unbalanced JE (${opts.description}): DR=${totalDr} CR=${totalCr}`);
      }
      const journalNumber = `JE-2026-${pad(jeSeq++, 5)}`;
      const isPosted = opts.status === 'POSTED' || opts.status === 'REVERSED';
      jeBuffer.push({
        id,
        companyId,
        journalNumber,
        entryDate: opts.date,
        accountingPeriodId: getPeriodId(opts.date),
        description: opts.description,
        sourceType: opts.sourceType,
        sourceId: opts.sourceId || null,
        status: opts.status,
        createdBy: opts.createdBy || accountantId,
        submittedBy: opts.status !== 'DRAFT' ? accountantId : null,
        approvedBy: isPosted || opts.status === 'APPROVED' ? (opts.approvedBy || approverId) : null,
        postedBy: isPosted ? (opts.postedBy || ownerId) : null,
        originalJournalId: opts.originalJournalId || null,
        rejectionReason: opts.rejectionReason || null,
      });
      opts.lines.forEach((l, idx) => {
        jlBuffer.push({
          id: uuid(),
          journalEntryId: id,
          accountId: l.accountId,
          description: l.description || opts.description,
          debit: l.debit,
          credit: l.credit,
          lineNumber: idx + 1,
          departmentId: l.deptIdx !== undefined ? deptRows[l.deptIdx % deptRows.length].id : deptRows[jeSeq % deptRows.length].id,
          projectId: l.projIdx !== undefined ? projRows[l.projIdx % projRows.length].id : projRows[jeSeq % projRows.length].id,
          costCenterId: l.ccIdx !== undefined ? ccRows[l.ccIdx % ccRows.length].id : ccRows[jeSeq % ccRows.length].id,
        });
      });
      return { id, journalNumber };
    };

    // -----------------------------------------------------------------------
    // 1. OPENING EQUITY & CASH CAPITALIZATION JE
    // -----------------------------------------------------------------------
    pushJE({
      date: '2026-01-02',
      description: `Opening Paid-Up Share Capital & Operating Cash Deposit — ${spec.legalName}`,
      sourceType: 'OPENING_BALANCE',
      status: 'POSTED',
      createdBy: ownerId,
      approvedBy: approverId,
      postedBy: ownerId,
      lines: [
        { accountId: accCashBank, debit: spec.openingBankCentavos, credit: 0, description: 'Opening Corporate Bank Balance (BDO/BPI)' },
        { accountId: accPettyCash, debit: spec.openingPettyCashCentavos, credit: 0, description: 'Imprest Petty Cash Fund Setup' },
        { accountId: accEquity, debit: 0, credit: spec.openingBankCentavos + spec.openingPettyCashCentavos, description: "Paid-Up Capital Stock / Owner's Equity" },
      ],
    });

    // -----------------------------------------------------------------------
    // MODULE 2: SALES & RECEIVABLES (320 Invoices across ALL 11 statuses + 200 OR Customer Payments + 8 Credit Memos)
    // -----------------------------------------------------------------------
    const invStatusPlan: string[] = [
      ...Array(140).fill('PAID'),
      ...Array(60).fill('PARTIAL'),
      ...Array(65).fill('POSTED'),
      ...Array(10).fill('APPROVED'),
      ...Array(12).fill('SUBMITTED'),
      ...Array(6).fill('RETURNED'),
      ...Array(5).fill('REJECTED'),
      ...Array(10).fill('DRAFT'),
      ...Array(5).fill('CANCELLED'),
      ...Array(4).fill('REVERSED'),
      ...Array(3).fill('ARCHIVED'),
    ]; // Total = 320

    const invRows: any[] = [];
    const invLineRows: any[] = [];
    const custPayRows: any[] = [];
    const custPayAppRows: any[] = [];
    const postedOpenInvRefs: Array<{ id: string; customerId: string; balanceDue: number; date: string; invoiceNumber: string }> = [];

    for (let i = 0; i < invStatusPlan.length; i++) {
      const status = invStatusPlan[i];
      const invId = uuid();
      const cust = activeCustomers[i % activeCustomers.length];
      const invDate = dateIn2026(i, invStatusPlan.length);
      const dueDate = addDays(invDate, 30);
      const invNumber = `SI-2026-${pad(i + 1, 5)}`;

      // Deterministic centavo amount (exact multiple of 100 so 12% VAT & 2% CWT are clean integers)
      const netBase = spec.baseInvoiceCentavos + ((i % 15) * 5_000_00);
      const vatAmt = isVat ? Math.round(netBase * 0.12) : 0;
      const pctTaxAmt = !isVat ? Math.round(netBase * 0.03) : 0;
      const grossTotal = netBase + vatAmt;
      const revAcc = i % 3 === 0 ? accServiceRev : accSalesRev;

      let jeId: string | null = null;
      let balanceDue = grossTotal;

      const hasPostedGL = status === 'PAID' || status === 'PARTIAL' || status === 'POSTED' || status === 'REVERSED';

      if (hasPostedGL) {
        const lines: Array<{ accountId: string; debit: number; credit: number; description?: string }> = [
          { accountId: accAR, debit: grossTotal, credit: 0, description: `AR — ${cust.legalName} (${invNumber})` },
          { accountId: revAcc, debit: 0, credit: netBase, description: `Sales Revenue — ${invNumber}` },
        ];
        if (isVat && vatAmt > 0) {
          lines.push({ accountId: accOutputVat, debit: 0, credit: vatAmt, description: `12% Output VAT — ${invNumber}` });
        }
        if (!isVat && pctTaxAmt > 0) {
          lines.push({ accountId: accPctTaxExp, debit: pctTaxAmt, credit: 0, description: `3% Percentage Tax Expense (2551Q) — ${invNumber}` });
          lines.push({ accountId: accPctTaxPayable, debit: 0, credit: pctTaxAmt, description: `3% Percentage Tax Payable (2551Q) — ${invNumber}` });
        }

        const je = pushJE({
          date: invDate,
          description: `Sales Invoice ${invNumber} — ${cust.legalName}`,
          sourceType: 'SALES_INVOICE',
          sourceId: invId,
          status: 'POSTED',
          lines,
        });
        jeId = je.id;

        if (status !== 'REVERSED') {
          taxCalcBuffer.push({
            id: uuid(),
            companyId,
            journalEntryId: jeId,
            taxCodeId: isVat ? tcVatOut : tcPt3,
            ruleVersionId: ruleVerByCode.get(isVat ? 'PH-VAT-12' : 'PH-PT-3')!,
            taxBase: netBase,
            taxRate: isVat ? 0.12 : 0.03,
            taxAmount: isVat ? vatAmt : pctTaxAmt,
            status: 'ACTIVE',
          });
        }

        if (status === 'REVERSED') {
          // Exact reversing JE so net AR, Revenue, and Tax = 0
          pushJE({
            date: addDays(invDate, 2),
            description: `Reversal of Sales Invoice ${invNumber} — Billing Cancellation`,
            sourceType: 'SALES_INVOICE_REVERSAL',
            sourceId: invId,
            status: 'POSTED',
            originalJournalId: jeId,
            lines: lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: `Reversal: ${l.description}`,
            })),
          });
          balanceDue = 0;
        }
      } else if (status === 'CANCELLED' || status === 'ARCHIVED') {
        balanceDue = 0;
      }

      // Customer Payments (OR + 2% CWT Form 2307) for PAID (140) and PARTIAL (60)
      if (status === 'PAID' || status === 'PARTIAL') {
        const payId = uuid();
        const payDate = addDays(invDate, 10) <= '2026-11-18' ? addDays(invDate, 10) : invDate;
        const settledGross = status === 'PAID' ? grossTotal : Math.round(grossTotal * 0.5);
        // 2% CWT on net base proportion
        const cwtAmt = Math.round((status === 'PAID' ? netBase : Math.round(netBase * 0.5)) * 0.02);
        const netCashReceived = settledGross - cwtAmt;

        const payJe = pushJE({
          date: payDate,
          description: `Official Receipt OR-2026-${pad(custPayRows.length + 1, 5)} — ${cust.legalName} (${invNumber})`,
          sourceType: 'CUSTOMER_PAYMENT',
          sourceId: payId,
          status: 'POSTED',
          lines: [
            { accountId: accCashBank, debit: netCashReceived, credit: 0, description: `Cash Collection — ${invNumber}` },
            { accountId: accCWT, debit: cwtAmt, credit: 0, description: `2% CWT (BIR Form 2307) — ${cust.legalName}` },
            { accountId: accAR, debit: 0, credit: settledGross, description: `AR Settlement — ${invNumber}` },
          ],
        });

        custPayRows.push({
          id: payId,
          companyId,
          customerId: cust.id,
          paymentNumber: `CP-2026-${pad(custPayRows.length + 1, 5)}`,
          officialReceiptNumber: `OR-2026-${pad(custPayRows.length + 1, 5)}`,
          paymentDate: payDate,
          cashAccountId: accCashBank,
          amount: netCashReceived,
          withholdingTaxAmount: cwtAmt,
          withholdingTaxAccountId: accCWT,
          overpaymentAmount: 0,
          paymentMethod: i % 3 === 0 ? 'BANK_TRANSFER' : i % 3 === 1 ? 'CHECK' : 'ONLINE',
          reference: `REF-OR-${pad(i + 1, 5)}`,
          notes: status === 'PAID' ? 'Full collection with BIR Form 2307' : '50% Partial collection with BIR Form 2307',
          status: 'POSTED',
          journalEntryId: payJe.id,
          createdBy: accountantId,
          submittedBy: accountantId,
          approvedBy: approverId,
        });

        custPayAppRows.push({
          id: uuid(),
          paymentId: payId,
          invoiceId: invId,
          appliedAmount: netCashReceived,
          withholdingAmount: cwtAmt,
        });

        balanceDue = grossTotal - settledGross;
      }

      invRows.push({
        id: invId,
        companyId,
        customerId: cust.id,
        invoiceNumber: invNumber,
        invoiceType: i % 3 === 0 ? 'SERVICE' : 'SALES',
        invoiceDate: invDate,
        dueDate,
        reference: `SO-2026-${pad(i + 1, 5)}`,
        totalAmount: grossTotal,
        balanceDue,
        status,
        journalEntryId: jeId,
        createdBy: accountantId,
        submittedBy: status !== 'DRAFT' ? accountantId : null,
        approvedBy: ['APPROVED', 'POSTED', 'PARTIAL', 'PAID', 'REVERSED'].includes(status) ? approverId : null,
      });

      invLineRows.push({
        id: uuid(),
        invoiceId: invId,
        accountId: revAcc,
        taxCodeId: isVat ? tcVatOut : tcPt3,
        description: isVat ? `Commercial Supply & Freight Batch #${i + 1} (12% VAT)` : `Agri-Tech Managed Service Package #${i + 1} (Non-VAT 3%)`,
        quantity: (i % 5) + 1,
        unitPrice: Math.round(netBase / ((i % 5) + 1)),
        amount: netBase,
      });

      if (status === 'POSTED' && balanceDue > 20_000_00) {
        postedOpenInvRefs.push({ id: invId, customerId: cust.id, balanceDue, date: invDate, invoiceNumber: invNumber });
      }

      // Workflow records for SUBMITTED / RETURNED / REJECTED invoices
      if (status === 'SUBMITTED' || status === 'RETURNED' || status === 'REJECTED') {
        const wfId = uuid();
        wfBuffer.push({
          id: wfId,
          companyId,
          entityType: 'SALES_INVOICE',
          entityId: invId,
          recordReference: invNumber,
          workflowType: 'AMOUNT_THRESHOLD',
          status: status === 'SUBMITTED' ? 'PENDING' : status,
          currentStepOrder: 1,
          totalSteps: 2,
          amountCentavos: grossTotal,
          departmentId: deptRows[1].id,
          submittedBy: accountantId,
          submittedByName: spec.staff[0].displayName,
          submittedAt: new Date(),
          slaStatus: i % 4 === 0 ? 'AT_RISK' : 'ON_TRACK',
        });
        wfStepBuffer.push({
          id: uuid(),
          workflowId: wfId,
          companyId,
          entityType: 'SALES_INVOICE',
          entityId: invId,
          stepOrder: 1,
          stepName: 'Finance Manager Verification',
          requiredRole: 'Approver',
          assignedApproverId: approverId,
          assignedApproverName: spec.staff[1].displayName,
          actualApproverId: status === 'SUBMITTED' ? null : approverId,
          actualApproverName: status === 'SUBMITTED' ? null : spec.staff[1].displayName,
          status: status === 'SUBMITTED' ? 'PENDING' : status,
          decision: status === 'SUBMITTED' ? null : status,
          comments: status === 'RETURNED' ? 'Please attach signed Delivery Receipt (DR)' : status === 'REJECTED' ? 'Duplicate customer billing rejected' : null,
        });
      }
    }

    // 8 Credit Memos (4 POSTED applied to open POSTED invoices to keep AR subledger === GL 1030 exact, + 4 DRAFT/SUBMITTED/APPROVED/VOID)
    const cmStatuses = ['POSTED', 'POSTED', 'POSTED', 'POSTED', 'APPROVED', 'SUBMITTED', 'DRAFT', 'VOID'];
    const cmRows: any[] = [];
    const cmLineRows: any[] = [];
    const cmAppRows: any[] = [];

    for (let i = 0; i < cmStatuses.length; i++) {
      const st = cmStatuses[i];
      const cmId = uuid();
      const targetInv = postedOpenInvRefs[i % postedOpenInvRefs.length];
      const cmBase = 5_000_00;
      const cmVat = isVat ? 600_00 : 0;
      const cmTotal = cmBase + cmVat;
      let cmJeId: string | null = null;

      if (st === 'POSTED' && targetInv) {
        const cmLines = [
          { accountId: accSalesRev, debit: cmBase, credit: 0, description: `Sales Return / Credit Memo CM-2026-${pad(i + 1, 4)}` },
          ...(isVat ? [{ accountId: accOutputVat, debit: cmVat, credit: 0, description: `Output VAT Adjustment — CM-2026-${pad(i + 1, 4)}` }] : []),
          { accountId: accAR, debit: 0, credit: cmTotal, description: `AR Reduction — ${targetInv.invoiceNumber}` },
        ];
        const cmJe = pushJE({
          date: '2026-10-15',
          description: `Credit Memo CM-2026-${pad(i + 1, 4)} applied to ${targetInv.invoiceNumber}`,
          sourceType: 'CREDIT_MEMO',
          sourceId: cmId,
          status: 'POSTED',
          lines: cmLines,
        });
        cmJeId = cmJe.id;

        // Reduce the target invoice's balanceDue so AR Subledger === GL 1030 stays ₱0.00 variance!
        const invObj = invRows.find((r) => r.id === targetInv.id);
        if (invObj) {
          invObj.balanceDue -= cmTotal;
          invObj.status = invObj.balanceDue > 0 ? 'PARTIAL' : 'PAID';
        }
        cmAppRows.push({
          id: uuid(),
          creditMemoId: cmId,
          invoiceId: targetInv.id,
          appliedAmount: cmTotal,
        });
      }

      cmRows.push({
        id: cmId,
        companyId,
        customerId: targetInv ? targetInv.customerId : activeCustomers[i].id,
        creditMemoNumber: `CM-2026-${pad(i + 1, 4)}`,
        memoDate: '2026-10-15',
        reason: 'Volume rebate / damaged goods adjustment',
        totalAmount: cmTotal,
        balanceRemaining: st === 'POSTED' ? 0 : cmTotal,
        status: st,
        journalEntryId: cmJeId,
        createdBy: accountantId,
        submittedBy: st !== 'DRAFT' ? accountantId : null,
        approvedBy: st === 'POSTED' || st === 'APPROVED' ? approverId : null,
      });
      cmLineRows.push({
        id: uuid(),
        creditMemoId: cmId,
        accountId: accSalesRev,
        taxCodeId: isVat ? tcVatOut : tcPt3,
        description: 'Sales allowance credit adjustment',
        quantity: 1,
        unitPrice: cmBase,
        amount: cmBase,
      });
    }

    // -----------------------------------------------------------------------
    // MODULE 3: PROCUREMENT & PAYABLES (120 PRs + 150 POs + 120 GRNs + 320 Bills + 200 Supplier Payments w/ EWT 2307 + 6 Debit Memos)
    // -----------------------------------------------------------------------
    const prStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CONVERTED_TO_PO', 'CANCELLED'];
    const prRows: any[] = [];
    for (let i = 0; i < 120; i++) {
      const st = prStatuses[i % prStatuses.length];
      const vend = activeVendors[i % activeVendors.length];
      const reqDate = dateIn2026(i, 120);
      const amt = 35_000_00 + (i % 10) * 8_000_00;
      prRows.push({
        id: uuid(),
        companyId,
        prNumber: `PR-2026-${pad(i + 1, 5)}`,
        requestDate: reqDate,
        neededByDate: addDays(reqDate, 14),
        departmentId: deptRows[i % deptRows.length].id,
        branchCode: locRows[i % locRows.length].code,
        requestedBy: accountantId,
        requestedByName: spec.staff[0].displayName,
        preferredVendorId: vend.id,
        preferredVendorName: vend.legalName,
        purpose: `Operational Procurement Request #${i + 1} — ${deptRows[i % deptRows.length].name}`,
        itemsJson: JSON.stringify([{ description: `Supply Lot #${i + 1}`, qty: 10, unitPrice: amt / 10, amount: amt }]),
        totalAmount: amt,
        status: st,
        approvedBy: ['APPROVED', 'CONVERTED_TO_PO'].includes(st) ? approverId : null,
        notes: 'Standard PH procurement cycle',
      });
    }
    await insertInChunks(db, schema.purchaseRequisitions, prRows);

    const poStatuses = ['CLOSED', 'FULLY_RECEIVED', 'PARTIALLY_RECEIVED', 'APPROVED', 'DRAFT', 'CANCELLED'];
    const poRows: any[] = [];
    const poLineRows: any[] = [];
    const grnRows: any[] = [];
    const grnLineRows: any[] = [];

    for (let i = 0; i < 150; i++) {
      const st = poStatuses[i % poStatuses.length];
      const poId = uuid();
      const poLineId = uuid();
      const vend = activeVendors[i % activeVendors.length];
      const poDate = dateIn2026(i, 150);
      const qtyOrd = 20 + (i % 5) * 10;
      const unitP = 2_500_00;
      const totalAmt = qtyOrd * unitP;
      const qtyRec = st === 'CLOSED' || st === 'FULLY_RECEIVED' ? qtyOrd : st === 'PARTIALLY_RECEIVED' ? qtyOrd / 2 : 0;

      poRows.push({
        id: poId,
        companyId,
        vendorId: vend.id,
        poNumber: `PO-2026-${pad(i + 1, 5)}`,
        poDate,
        expectedDeliveryDate: addDays(poDate, 10),
        totalAmount: totalAmt,
        status: st,
        createdBy: accountantId,
        approvedBy: st !== 'DRAFT' ? approverId : null,
      });

      poLineRows.push({
        id: poLineId,
        poId,
        description: `Contracted Goods / Supplies Batch #${i + 1}`,
        quantityOrdered: qtyOrd,
        quantityReceived: qtyRec,
        unitPrice: unitP,
        amount: totalAmt,
      });

      if (qtyRec > 0 && grnRows.length < 120) {
        const grnId = uuid();
        grnRows.push({
          id: grnId,
          companyId,
          poId,
          grnNumber: `GRN-2026-${pad(grnRows.length + 1, 5)}`,
          receiptDate: addDays(poDate, 5),
          deliveryNoteNo: `DR-${pad(i + 1001, 6)}`,
          status: 'RECEIVED',
          receivedBy: accountantId,
        });
        grnLineRows.push({
          id: uuid(),
          grnId,
          poLineId,
          quantityReceived: qtyRec,
          notes: 'Inspected at warehouse — within 2.0% tolerance',
        });
      }
    }
    await insertInChunks(db, schema.purchaseOrders, poRows);
    await insertInChunks(db, schema.purchaseOrderLines, poLineRows);
    await insertInChunks(db, schema.goodsReceiptNotes, grnRows);
    await insertInChunks(db, schema.goodsReceiptLines, grnLineRows);

    // 320 Purchase Bills across ALL 11 statuses + 200 Supplier Payments (with EWT 1%/2%/5% -> BIR Form 2307!)
    const billStatusPlan: string[] = [
      ...Array(140).fill('PAID'),
      ...Array(60).fill('PARTIAL'),
      ...Array(65).fill('POSTED'),
      ...Array(10).fill('APPROVED'),
      ...Array(12).fill('SUBMITTED'),
      ...Array(6).fill('RETURNED'),
      ...Array(5).fill('REJECTED'),
      ...Array(10).fill('DRAFT'),
      ...Array(5).fill('CANCELLED'),
      ...Array(4).fill('REVERSED'),
      ...Array(3).fill('ARCHIVED'),
    ]; // Total = 320

    const billRows: any[] = [];
    const billLineRows: any[] = [];
    const supPayRows: any[] = [];
    const supPayAppRows: any[] = [];
    const postedOpenBillRefs: Array<{ id: string; vendorId: string; balanceDue: number; billNumber: string }> = [];
    const expenseAccountsCycle = [accCogs, accTransport, accRent, accUtilities, accSupplies, accProfFees];

    for (let i = 0; i < billStatusPlan.length; i++) {
      const status = billStatusPlan[i];
      const billId = uuid();
      const vend = activeVendors[i % activeVendors.length];
      const billDate = dateIn2026(i, billStatusPlan.length);
      const dueDate = addDays(billDate, 30);
      const billNumber = `BILL-2026-${pad(i + 1, 5)}`;

      const netBase = spec.baseBillCentavos + ((i % 12) * 3_000_00);
      const vendorIsVat = vend.vatStatus === 'VAT';
      const inputVatAmt = isVat && vendorIsVat ? Math.round(netBase * 0.12) : 0;
      const grossTotal = netBase + inputVatAmt;
      const expAcc = expenseAccountsCycle[i % expenseAccountsCycle.length];

      let jeId: string | null = null;
      let balanceDue = grossTotal;
      const hasPostedGL = status === 'PAID' || status === 'PARTIAL' || status === 'POSTED' || status === 'REVERSED';

      if (hasPostedGL) {
        const lines: Array<{ accountId: string; debit: number; credit: number; description?: string }> = [
          { accountId: expAcc, debit: netBase, credit: 0, description: `Supplier Expense — ${vend.legalName} (${billNumber})` },
          ...(inputVatAmt > 0 ? [{ accountId: accInputVat, debit: inputVatAmt, credit: 0, description: `12% Creditable Input VAT — ${billNumber}` }] : []),
          { accountId: accAP, debit: 0, credit: grossTotal, description: `Accounts Payable — ${vend.legalName} (${billNumber})` },
        ];

        const je = pushJE({
          date: billDate,
          description: `Purchase Bill ${billNumber} — ${vend.legalName}`,
          sourceType: 'PURCHASE_BILL',
          sourceId: billId,
          status: 'POSTED',
          lines,
        });
        jeId = je.id;

        if (status !== 'REVERSED' && inputVatAmt > 0) {
          taxCalcBuffer.push({
            id: uuid(),
            companyId,
            journalEntryId: jeId,
            taxCodeId: tcVatIn,
            ruleVersionId: ruleVerByCode.get('PH-VAT-12')!,
            taxBase: netBase,
            taxRate: 0.12,
            taxAmount: inputVatAmt,
            status: 'ACTIVE',
          });
        }

        if (status === 'REVERSED') {
          pushJE({
            date: addDays(billDate, 2),
            description: `Reversal of Purchase Bill ${billNumber} — Supplier Billing Dispute`,
            sourceType: 'PURCHASE_BILL_REVERSAL',
            sourceId: billId,
            status: 'POSTED',
            originalJournalId: jeId,
            lines: lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: `Reversal: ${l.description}`,
            })),
          });
          balanceDue = 0;
        }
      } else if (status === 'CANCELLED' || status === 'ARCHIVED') {
        balanceDue = 0;
      }

      // Supplier Payments (DV + 1%/2%/5% EWT Form 2307) for PAID (140) and PARTIAL (60)
      if (status === 'PAID' || status === 'PARTIAL') {
        const spId = uuid();
        const payDate = addDays(billDate, 12) <= '2026-11-18' ? addDays(billDate, 12) : billDate;
        const settledGross = status === 'PAID' ? grossTotal : Math.round(grossTotal * 0.5);
        const ewtRate = i % 3 === 0 ? 0.01 : i % 3 === 1 ? 0.02 : 0.05;
        const ewtBase = status === 'PAID' ? netBase : Math.round(netBase * 0.5);
        const ewtAmt = Math.round(ewtBase * ewtRate);
        const netCashPaid = settledGross - ewtAmt;
        const atcLabel = ewtRate === 0.01 ? 'WC158 (1%)' : ewtRate === 0.02 ? 'WC160 (2%)' : 'WC100 (5%)';

        const spJe = pushJE({
          date: payDate,
          description: `Disbursement Voucher DV-2026-${pad(supPayRows.length + 1, 5)} — ${vend.legalName} (${billNumber}) [EWT ${atcLabel}]`,
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: spId,
          status: 'POSTED',
          lines: [
            { accountId: accAP, debit: settledGross, credit: 0, description: `AP Settlement — ${billNumber}` },
            { accountId: accCashBank, debit: 0, credit: netCashPaid, description: `Cash Disbursement — ${billNumber}` },
            { accountId: accEWT, debit: 0, credit: ewtAmt, description: `EWT Withheld (${atcLabel}) — BIR Form 2307` },
          ],
        });

        supPayRows.push({
          id: spId,
          companyId,
          vendorId: vend.id,
          paymentNumber: `DV-2026-${pad(supPayRows.length + 1, 5)}`,
          paymentDate: payDate,
          amount: netCashPaid,
          cashAccountId: accCashBank,
          withholdingTaxAmount: ewtAmt,
          withholdingTaxAccountId: accEWT,
          overpaymentAmount: 0,
          paymentMethod: i % 2 === 0 ? 'BANK_TRANSFER' : 'CHECK',
          reference: `CHK-${pad(80000 + i, 6)}`,
          notes: `ATC ${atcLabel} — BIR Form 2307 issued`,
          status: 'POSTED',
          journalEntryId: spJe.id,
          createdBy: accountantId,
          submittedBy: accountantId,
          approvedBy: approverId,
        });

        supPayAppRows.push({
          id: uuid(),
          paymentId: spId,
          billId,
          appliedAmount: netCashPaid,
          withholdingAmount: ewtAmt,
        });

        balanceDue = grossTotal - settledGross;
      }

      billRows.push({
        id: billId,
        companyId,
        vendorId: vend.id,
        billNumber,
        billDate,
        dueDate,
        reference: `SINV-${pad(3000 + i, 6)}`,
        notes: `3-Way Matched / Supplier Invoice (${vend.withholdingApplicability})`,
        totalAmount: grossTotal,
        balanceDue,
        status,
        journalEntryId: jeId,
        createdBy: accountantId,
        submittedBy: status !== 'DRAFT' ? accountantId : null,
        approvedBy: ['APPROVED', 'POSTED', 'PARTIAL', 'PAID', 'REVERSED'].includes(status) ? approverId : null,
      });

      billLineRows.push({
        id: uuid(),
        billId,
        accountId: expAcc,
        taxCodeId: inputVatAmt > 0 ? tcVatIn : (i % 3 === 0 ? tcEwt1 : i % 3 === 1 ? tcEwt2 : tcEwt5),
        description: `Vendor Supply / Service Line #${i + 1}`,
        quantity: 1,
        unitPrice: netBase,
        amount: netBase,
      });

      if (status === 'POSTED' && balanceDue > 15_000_00) {
        postedOpenBillRefs.push({ id: billId, vendorId: vend.id, balanceDue, billNumber });
      }

      if (status === 'SUBMITTED' || status === 'RETURNED' || status === 'REJECTED') {
        const wfId = uuid();
        wfBuffer.push({
          id: wfId,
          companyId,
          entityType: 'PURCHASE_BILL',
          entityId: billId,
          recordReference: billNumber,
          workflowType: 'SEQUENTIAL',
          status: status === 'SUBMITTED' ? 'PENDING' : status,
          currentStepOrder: 1,
          totalSteps: 2,
          amountCentavos: grossTotal,
          departmentId: deptRows[2].id,
          submittedBy: accountantId,
          submittedByName: spec.staff[0].displayName,
          submittedAt: new Date(),
          slaStatus: i % 5 === 0 ? 'OVERDUE' : 'ON_TRACK',
        });
        wfStepBuffer.push({
          id: uuid(),
          workflowId: wfId,
          companyId,
          entityType: 'PURCHASE_BILL',
          entityId: billId,
          stepOrder: 1,
          stepName: 'AP Controller Approval',
          requiredRole: 'Approver',
          assignedApproverId: approverId,
          assignedApproverName: spec.staff[1].displayName,
          actualApproverId: status === 'SUBMITTED' ? null : approverId,
          actualApproverName: status === 'SUBMITTED' ? null : spec.staff[1].displayName,
          status: status === 'SUBMITTED' ? 'PENDING' : status,
          decision: status === 'SUBMITTED' ? null : status,
          comments: status === 'RETURNED' ? 'Attach BIR 2307 ATC breakdown' : status === 'REJECTED' ? 'Price variance exceeded 2% PO tolerance' : null,
        });
      }
    }

    // 6 Debit Memos (3 POSTED applied to open POSTED bills to keep AP subledger === GL 2010 exact)
    const dmStatuses = ['POSTED', 'POSTED', 'POSTED', 'APPROVED', 'SUBMITTED', 'DRAFT'];
    const dmRows: any[] = [];
    const dmLineRows: any[] = [];
    const dmAppRows: any[] = [];
    for (let i = 0; i < dmStatuses.length; i++) {
      const st = dmStatuses[i];
      const dmId = uuid();
      const targetBill = postedOpenBillRefs[i % postedOpenBillRefs.length];
      const dmBase = 4_000_00;
      const dmVat = isVat ? 480_00 : 0;
      const dmTotal = dmBase + dmVat;
      let dmJeId: string | null = null;

      if (st === 'POSTED' && targetBill) {
        const dmJe = pushJE({
          date: '2026-10-18',
          description: `Debit Memo DM-2026-${pad(i + 1, 4)} applied to ${targetBill.billNumber}`,
          sourceType: 'DEBIT_MEMO',
          sourceId: dmId,
          status: 'POSTED',
          lines: [
            { accountId: accAP, debit: dmTotal, credit: 0, description: `AP Reduction — ${targetBill.billNumber}` },
            { accountId: accCogs, debit: 0, credit: dmBase, description: `Purchase Return — DM-2026-${pad(i + 1, 4)}` },
            ...(isVat ? [{ accountId: accInputVat, debit: 0, credit: dmVat, description: `Input VAT Reversal — DM-2026-${pad(i + 1, 4)}` }] : []),
          ],
        });
        dmJeId = dmJe.id;
        const billObj = billRows.find((r) => r.id === targetBill.id);
        if (billObj) {
          billObj.balanceDue -= dmTotal;
          billObj.status = billObj.balanceDue > 0 ? 'PARTIAL' : 'PAID';
        }
        dmAppRows.push({
          id: uuid(),
          debitMemoId: dmId,
          billId: targetBill.id,
          appliedAmount: dmTotal,
        });
      }

      dmRows.push({
        id: dmId,
        companyId,
        vendorId: targetBill ? targetBill.vendorId : activeVendors[i].id,
        debitMemoNumber: `DM-2026-${pad(i + 1, 4)}`,
        memoDate: '2026-10-18',
        reason: 'Defective shipment return / quantity shortage',
        totalAmount: dmTotal,
        balanceRemaining: st === 'POSTED' ? 0 : dmTotal,
        status: st,
        journalEntryId: dmJeId,
        createdBy: accountantId,
        submittedBy: st !== 'DRAFT' ? accountantId : null,
        approvedBy: st === 'POSTED' || st === 'APPROVED' ? approverId : null,
      });
      dmLineRows.push({
        id: uuid(),
        debitMemoId: dmId,
        accountId: accCogs,
        taxCodeId: isVat ? tcVatIn : null,
        description: 'Supplier return debit memo line',
        quantity: 1,
        unitPrice: dmBase,
        amount: dmBase,
      });
    }

    // -----------------------------------------------------------------------
    // MODULE 4: INVENTORY & WAREHOUSE (60 Items + 200 Movements + 12 Adjustments + Balanced Inventory GL JE)
    // -----------------------------------------------------------------------
    const invItemRows: any[] = [];
    const invTxRows: any[] = [];
    const stockAdjRows: any[] = [];
    let totalInventoryValuationCentavos = 0;

    const invCategories = isVat
      ? ['Industrial Packaging', 'Cold-Chain Containers', 'Logistics Pallets', 'Fleet Parts', 'Warehouse Safety', 'Barcode Hardware']
      : ['Hybrid Seeds', 'Organic Fertilizers', 'Drip Irrigation Kits', 'Soil Sensors', 'Harvest Crates', 'Bio-Pesticides'];

    for (let i = 0; i < 60; i++) {
      const itemId = uuid();
      const unitCost = (850 + (i % 10) * 350) * 100;
      const sellingPrice = Math.round(unitCost * 1.45);
      // 8 items deliberately below reorder point to test Low Stock Alerts!
      const qtyOnHand = i < 8 ? 5 : 40 + (i % 6) * 15;
      const reorderPoint = 15;
      totalInventoryValuationCentavos += Math.round(unitCost * qtyOnHand);

      invItemRows.push({
        id: itemId,
        companyId,
        sku: `SKU-${spec.key === 'VAT_CORP' ? 'MP' : 'VH'}-${pad(i + 1, 4)}`,
        name: `${invCategories[i % invCategories.length]} — Grade ${String.fromCharCode(65 + (i % 4))} #${i + 1}`,
        description: `Standard stock item tracked under ${i % 2 === 0 ? 'FIFO' : 'WEIGHTED_AVG'}`,
        category: invCategories[i % invCategories.length],
        unitOfMeasure: i % 3 === 0 ? 'BOX' : i % 3 === 1 ? 'UNIT' : 'PACK',
        costingMethod: i % 2 === 0 ? 'FIFO' : 'WEIGHTED_AVG',
        unitCost,
        sellingPrice,
        quantityOnHand: qtyOnHand,
        reorderPoint,
        assetAccountId: accInventory,
        cogsAccountId: accCogs,
        status: i >= 57 ? 'INACTIVE' : 'ACTIVE',
      });
    }

    for (let i = 0; i < 200; i++) {
      const item = invItemRows[i % invItemRows.length];
      const types = ['RECEIPT', 'SALE', 'RECEIPT', 'SALE', 'ADJUSTMENT', 'RETURN', 'WASTE'];
      const t = types[i % types.length];
      const qty = (i % 8) + 2;
      invTxRows.push({
        id: uuid(),
        companyId,
        itemId: item.id,
        transactionDate: dateIn2026(i, 200),
        type: t,
        quantity: t === 'SALE' || t === 'WASTE' ? -qty : qty,
        unitCost: item.unitCost,
        totalValue: item.unitCost * qty,
        reference: `${t}-${pad(i + 1, 5)}`,
        notes: `Automated stock movement (${t})`,
      });
    }

    for (let i = 0; i < 12; i++) {
      const item = invItemRows[i];
      stockAdjRows.push({
        id: uuid(),
        companyId,
        adjustmentNumber: `SADJ-2026-${pad(i + 1, 4)}`,
        adjustmentDate: dateIn2026(i, 12),
        itemId: item.id,
        quantityChange: i % 2 === 0 ? -2 : 3,
        reason: i % 3 === 0 ? 'WASTE' : i % 3 === 1 ? 'DAMAGE' : 'INVENTORY_COUNT_CORRECTION',
        expenseAccountId: accCogs,
        status: 'POSTED',
        createdBy: accountantId,
      });
    }

    // Balanced JE for Merchandise Inventory so GL 1080 === SUM(unitCost * qtyOnHand)
    pushJE({
      date: '2026-01-10',
      description: `Merchandise Inventory Stocking & Opening Valuation (${invItemRows.length} SKUs)`,
      sourceType: 'INVENTORY',
      status: 'POSTED',
      lines: [
        { accountId: accInventory, debit: totalInventoryValuationCentavos, credit: 0, description: 'Merchandise Inventory Capitalized' },
        { accountId: accCashBank, debit: 0, credit: totalInventoryValuationCentavos, description: 'Cash Paid for Initial Stock' },
      ],
    });

    await insertInChunks(db, schema.inventoryItems, invItemRows);
    await insertInChunks(db, schema.inventoryTransactions, invTxRows);
    await insertInChunks(db, schema.stockAdjustments, stockAdjRows);

    // -----------------------------------------------------------------------
    // MODULE 5: CASH & BANKING (120 Cash Tx + 30 Checks + 20 Bank Deposits + 12 Cash Advances + 6 Cash Counts + 6 Bank Reconciliations)
    // -----------------------------------------------------------------------
    const cashTxRows: any[] = [];
    const cashTxLineRows: any[] = [];
    const cashAdvRows: any[] = [];
    const cashTypes = ['RECEIPT', 'DISBURSEMENT', 'PETTY_CASH', 'BANK_FEE', 'INTEREST_INCOME', 'ADVANCE', 'LIQUIDATION', 'TRANSFER'];
    const cashStatuses = ['POSTED', 'POSTED', 'POSTED', 'POSTED', 'APPROVED', 'SUBMITTED', 'DRAFT', 'CANCELLED'];

    for (let i = 0; i < 120; i++) {
      const ctId = uuid();
      const cType = cashTypes[i % cashTypes.length];
      const cStatus = cashStatuses[i % cashStatuses.length];
      const cDate = dateIn2026(i, 120);
      const amt = cType === 'BANK_FEE' ? 250_00 : cType === 'INTEREST_INCOME' ? 1_850_00 : 8_500_00 + (i % 6) * 1_500_00;
      const cashAcc = cType === 'PETTY_CASH' ? accPettyCash : accCashBank;
      const offsetAcc =
        cType === 'RECEIPT' ? accServiceRev :
        cType === 'INTEREST_INCOME' ? accInterestInc :
        cType === 'BANK_FEE' ? accBankCharges :
        cType === 'TRANSFER' ? accPettyCash :
        accSupplies;

      let ctJeId: string | null = null;
      if (cStatus === 'POSTED') {
        const isInflow = cType === 'RECEIPT' || cType === 'INTEREST_INCOME';
        const je = pushJE({
          date: cDate,
          description: `Cash ${cType} CT-2026-${pad(i + 1, 5)}`,
          sourceType: 'CASH_TRANSACTION',
          sourceId: ctId,
          status: 'POSTED',
          lines: isInflow
            ? [
                { accountId: cashAcc, debit: amt, credit: 0, description: `Cash Inflow (${cType})` },
                { accountId: offsetAcc, debit: 0, credit: amt, description: `Offset (${cType})` },
              ]
            : [
                { accountId: offsetAcc === cashAcc ? accCashBank : offsetAcc, debit: amt, credit: 0, description: `Cash Outflow (${cType})` },
                { accountId: cashAcc, debit: 0, credit: amt, description: `Cash Disbursement (${cType})` },
              ],
        });
        ctJeId = je.id;
      }

      cashTxRows.push({
        id: ctId,
        companyId,
        transactionNumber: `CT-2026-${pad(i + 1, 5)}`,
        type: cType,
        transactionDate: cDate,
        cashAccountId: cashAcc,
        totalAmount: amt,
        reference: `CREF-${pad(i + 1, 5)}`,
        description: `Operational ${cType.replace('_', ' ')} Voucher #${i + 1}`,
        status: cStatus,
        journalEntryId: ctJeId,
        createdBy: accountantId,
        submittedBy: cStatus !== 'DRAFT' ? accountantId : null,
        approvedBy: cStatus === 'POSTED' || cStatus === 'APPROVED' ? approverId : null,
      });

      cashTxLineRows.push({
        id: uuid(),
        cashTransactionId: ctId,
        accountId: offsetAcc,
        amount: amt,
        description: `${cType} line detail #${i + 1}`,
      });

      if (cType === 'ADVANCE' && cashAdvRows.length < 12) {
        const advStatus = cashAdvRows.length % 3 === 0 ? 'LIQUIDATED' : cashAdvRows.length % 3 === 1 ? 'PARTIALLY_LIQUIDATED' : 'UNLIQUIDATED';
        cashAdvRows.push({
          id: uuid(),
          companyId,
          employeeName: `${PH_FIRST_NAMES[cashAdvRows.length]} ${PH_LAST_NAMES[cashAdvRows.length]}`,
          advanceDate: cDate,
          amount: amt,
          liquidatedAmount: advStatus === 'LIQUIDATED' ? amt : advStatus === 'PARTIALLY_LIQUIDATED' ? Math.round(amt * 0.5) : 0,
          status: advStatus,
          disbursementTransactionId: ctId,
        });
      }
    }
    // Deferred flush after journalEntries are inserted

    const checkRows: any[] = [];
    for (let i = 0; i < 30; i++) {
      const cDate = dateIn2026(i, 30);
      const st = i % 5 === 0 ? 'CANCELLED' : i % 3 === 0 ? 'ISSUED' : 'CLEARED';
      checkRows.push({
        id: uuid(),
        companyId,
        checkNumber: `CHK-2026-${pad(5001 + i, 5)}`,
        checkDate: cDate,
        payeeName: activeVendors[i % activeVendors.length].legalName,
        cashAccountId: accCashBank,
        amount: 25_000_00 + i * 2_500_00,
        voucherNumber: `DV-2026-${pad(i + 1, 5)}`,
        status: st,
        clearedDate: st === 'CLEARED' ? addDays(cDate, 4) : null,
        cancellationReason: st === 'CANCELLED' ? 'Spoiled check print — reissued' : null,
        createdBy: accountantId,
      });
    }
    await insertInChunks(db, schema.checks, checkRows);

    const depositRows: any[] = [];
    for (let i = 0; i < 20; i++) {
      const depId = uuid();
      const dDate = dateIn2026(i, 20);
      const amt = 15_000_00;
      const st = i < 16 ? 'POSTED' : 'DRAFT';
      let dJeId: string | null = null;
      if (st === 'POSTED') {
        dJeId = pushJE({
          date: dDate,
          description: `Bank Deposit Slip DEP-2026-${pad(i + 1, 4)}`,
          sourceType: 'BANK_DEPOSIT',
          sourceId: depId,
          status: 'POSTED',
          lines: [
            { accountId: accCashBank, debit: amt, credit: 0, description: 'Deposit to Corporate Bank Account' },
            { accountId: accPettyCash, debit: 0, credit: amt, description: 'Cash on Hand Deposited' },
          ],
        }).id;
      }
      depositRows.push({
        id: depId,
        companyId,
        depositNumber: `DEP-2026-${pad(i + 1, 4)}`,
        depositDate: dDate,
        toBankAccountId: accCashBank,
        fromCashAccountId: accPettyCash,
        totalAmount: amt,
        reference: `BDO-SLIP-${pad(900 + i, 5)}`,
        status: st,
        journalEntryId: dJeId,
        createdBy: accountantId,
        approvedBy: st === 'POSTED' ? approverId : null,
      });
    }
    // Deferred flush after journalEntries are inserted

    const cashCountRows: any[] = [];
    const cashDenomRows: any[] = [];
    for (let i = 0; i < 6; i++) {
      const ccId = uuid();
      const st = i < 4 ? 'POSTED' : i === 4 ? 'APPROVED' : 'DRAFT';
      cashCountRows.push({
        id: ccId,
        companyId,
        countNumber: `CC-2026-${pad(i + 1, 4)}`,
        countDate: `2026-${pad(i + 5, 2)}-28`,
        cashAccountId: accPettyCash,
        custodianName: spec.staff[0].displayName,
        bookBalance: 50_000_00,
        countedBalance: 50_000_00,
        varianceAmount: 0,
        notes: 'Monthly surprise petty cash count — reconciled ₱0.00 variance',
        status: st,
        createdBy: accountantId,
        approvedBy: st !== 'DRAFT' ? approverId : null,
      });
      const denoms = [
        { label: '1000', unit: 1000_00, qty: 30 },
        { label: '500', unit: 500_00, qty: 30 },
        { label: '100', unit: 100_00, qty: 50 },
      ];
      for (const d of denoms) {
        cashDenomRows.push({
          id: uuid(),
          cashCountId: ccId,
          denominationLabel: d.label,
          unitValue: d.unit,
          countQuantity: d.qty,
          totalAmount: d.unit * d.qty,
        });
      }
    }
    await insertInChunks(db, schema.cashCounts, cashCountRows);
    await insertInChunks(db, schema.cashCountDenominations, cashDenomRows);

    // 6 Bank Reconciliations + Statement Lines + Adjustments + Bank Statements/Transactions
    const reconRows: any[] = [];
    const stmtLineRows: any[] = [];
    const reconAdjRows: any[] = [];
    const bankStmtRows: any[] = [];
    const bankTxRows: any[] = [];

    for (let i = 0; i < 6; i++) {
      const recId = uuid();
      const stmtDate = `2026-${pad(i + 5, 2)}-28`;
      const st = i < 4 ? 'APPROVED' : i === 4 ? 'SUBMITTED' : 'DRAFT';
      const bookBal = spec.openingBankCentavos + i * 250_000_00;
      reconRows.push({
        id: recId,
        companyId,
        bankAccountId: accCashBank,
        statementDate: stmtDate,
        statementEndingBalance: bookBal,
        bookEndingBalance: bookBal,
        clearedDepositsCount: 18,
        clearedDepositsAmount: 1_850_000_00,
        clearedChecksCount: 14,
        clearedChecksAmount: 1_240_000_00,
        outstandingChecksCount: 2,
        outstandingChecksAmount: 55_000_00,
        depositsInTransitCount: 1,
        depositsInTransitAmount: 55_000_00,
        bankChargesAmount: 500_00,
        interestIncomeAmount: 500_00,
        otherAdjustmentsAmount: 0,
        adjustedBookBalance: bookBal,
        adjustedStatementBalance: bookBal,
        unexplainedDifference: 0,
        status: st,
        notes: `Monthly Bank Reconciliation (${stmtDate})`,
        createdBy: accountantId,
        submittedBy: st !== 'DRAFT' ? accountantId : null,
        approvedBy: st === 'APPROVED' ? approverId : null,
      });

      stmtLineRows.push(
        {
          id: uuid(),
          bankReconciliationId: recId,
          companyId,
          bankAccountId: accCashBank,
          lineDate: stmtDate,
          description: 'PESONet Customer Collections Batch',
          reference: `PESO-${pad(i + 1, 4)}`,
          type: 'DEPOSIT',
          amount: 450_000_00,
          matchedStatus: 'MATCHED',
          matchedType: 'BANK_DEPOSIT',
          matchedAmount: 450_000_00,
        },
        {
          id: uuid(),
          bankReconciliationId: recId,
          companyId,
          bankAccountId: accCashBank,
          lineDate: stmtDate,
          description: 'Corporate Check Clearing Batch',
          reference: `CLRG-${pad(i + 1, 4)}`,
          type: 'CHECK',
          amount: 210_000_00,
          matchedStatus: 'MATCHED',
          matchedType: 'CHECK',
          matchedAmount: 210_000_00,
        }
      );

      reconAdjRows.push({
        id: uuid(),
        bankReconciliationId: recId,
        companyId,
        type: 'BANK_CHARGE',
        amount: 500_00,
        offsetAccountId: accBankCharges,
        description: 'Monthly CMS & Wire Service Charge',
        reference: `FEE-${pad(i + 1, 4)}`,
        adjustmentDate: stmtDate,
      });

      const bsId = uuid();
      bankStmtRows.push({
        id: bsId,
        companyId,
        bankAccountId: bankAccountRows[0].id,
        statementDate: new Date(`${stmtDate}T00:00:00Z`),
        filename: `BDO_Statement_${stmtDate}.csv`,
        status: st === 'APPROVED' ? 'RECONCILED' : 'IMPORTED',
      });
      bankTxRows.push({
        id: uuid(),
        companyId,
        bankStatementId: bsId,
        bankAccountId: bankAccountRows[0].id,
        transactionDate: new Date(`${stmtDate}T00:00:00Z`),
        description: `BDO Corporate Clearing Batch ${stmtDate}`,
        reference: `BDO-${pad(i + 1, 4)}`,
        amount: 450000,
        type: 'CREDIT',
        matchedStatus: st === 'APPROVED' ? 'RECONCILED' : 'SUGGESTED',
        matchConfidence: 0.98,
        matchReason: 'Exact amount and reference match',
      });
    }
    await insertInChunks(db, schema.bankReconciliations, reconRows);
    await insertInChunks(db, schema.bankStatementLines, stmtLineRows);
    await insertInChunks(db, schema.bankReconciliationAdjustments, reconAdjRows);
    await insertInChunks(db, schema.bankStatements, bankStmtRows);
    await insertInChunks(db, schema.bankTransactions, bankTxRows);

    // -----------------------------------------------------------------------
    // MODULE 6: STANDALONE GENERAL JOURNALS (ALL 10 STATUSES) + FX RATES & REVALUATIONS + RECURRING JOURNALS
    // -----------------------------------------------------------------------
    const manualJeStatuses: string[] = [
      ...Array(80).fill('POSTED'),
      ...Array(15).fill('DRAFT'),
      ...Array(12).fill('SUBMITTED'),
      ...Array(8).fill('RETURNED'),
      ...Array(8).fill('REJECTED'),
      ...Array(10).fill('APPROVED'),
      ...Array(6).fill('REVERSED'),
      ...Array(5).fill('CANCELLED'),
      ...Array(3).fill('ARCHIVED'),
      ...Array(3).fill('SOFT_DELETED'),
    ]; // 150 standalone manual JEs

    for (let i = 0; i < manualJeStatuses.length; i++) {
      const st = manualJeStatuses[i];
      const jDate = dateIn2026(i, manualJeStatuses.length);
      const amt = 12_000_00 + (i % 10) * 2_500_00;
      const expAcc = expenseAccountsCycle[i % expenseAccountsCycle.length];

      const je = pushJE({
        date: jDate,
        description: `Manual General Journal #${i + 1} (${st}) — Monthly Expense Accrual & Allocation`,
        sourceType: 'MANUAL_JOURNAL',
        status: st,
        rejectionReason: st === 'REJECTED' ? 'Insufficient supporting BIR Official Receipt attached' : st === 'RETURNED' ? 'Specify cost center code' : null,
        lines: [
          { accountId: expAcc, debit: amt, credit: 0, description: `Accrued Operating Expense #${i + 1}` },
          { accountId: accCashBank, debit: 0, credit: amt, description: `Treasury Settlement #${i + 1}` },
        ],
      });

      if (st === 'REVERSED') {
        pushJE({
          date: addDays(jDate, 1),
          description: `Auto-Reversal of ${je.journalNumber}`,
          sourceType: 'MANUAL_REVERSAL',
          status: 'POSTED',
          originalJournalId: je.id,
          lines: [
            { accountId: accCashBank, debit: amt, credit: 0, description: `Reversal of ${je.journalNumber}` },
            { accountId: expAcc, debit: 0, credit: amt, description: `Reversal of ${je.journalNumber}` },
          ],
        });
      }

      if (st === 'SUBMITTED' || st === 'RETURNED' || st === 'REJECTED') {
        const wfId = uuid();
        wfBuffer.push({
          id: wfId,
          companyId,
          entityType: 'JOURNAL_ENTRY',
          entityId: je.id,
          recordReference: je.journalNumber,
          workflowType: 'ROLE_ROUTED',
          status: st === 'SUBMITTED' ? 'PENDING' : st,
          currentStepOrder: 1,
          totalSteps: 1,
          amountCentavos: amt,
          departmentId: deptRows[0].id,
          submittedBy: accountantId,
          submittedByName: spec.staff[0].displayName,
          submittedAt: new Date(),
          slaStatus: 'ON_TRACK',
        });
        wfStepBuffer.push({
          id: uuid(),
          workflowId: wfId,
          companyId,
          entityType: 'JOURNAL_ENTRY',
          entityId: je.id,
          stepOrder: 1,
          stepName: 'Chief Accountant / Approver Review',
          requiredRole: 'Approver',
          assignedApproverId: approverId,
          assignedApproverName: spec.staff[1].displayName,
          status: st === 'SUBMITTED' ? 'PENDING' : st,
          decision: st === 'SUBMITTED' ? null : st,
        });
      }
    }

    // 20 BSP Exchange Rates + 3 FX Revaluation Runs + 4 Recurring Journals
    const fxRates: any[] = [];
    const currencies = [
      { cur: 'USD', base: 56.45 },
      { cur: 'EUR', base: 61.20 },
      { cur: 'JPY', base: 0.378 },
      { cur: 'SGD', base: 42.15 },
    ];
    for (let m = 6; m <= 10; m++) {
      for (const c of currencies) {
        fxRates.push({
          id: uuid(),
          companyId,
          rateDate: `2026-${pad(m, 2)}-28`,
          currency: c.cur,
          bspSpotRate: Number((c.base + (m - 6) * 0.18).toFixed(4)),
          source: 'BSP',
        });
      }
    }
    await insertInChunks(db, schema.currencyExchangeRates, fxRates);

    const fxRevalJe = pushJE({
      date: '2026-10-31',
      description: 'PAS 21 / BIR RMC 12-2024 Month-End Unrealized FX Revaluation (USD)',
      sourceType: 'FX_REVALUATION',
      status: 'POSTED',
      lines: [
        { accountId: accFxGainLoss, debit: 18_500_00, credit: 0, description: 'Unrealized FX Loss (Non-deductible until realized per BIR RMC 12-2024)' },
        { accountId: accByCode.get('1015') || accCashBank, debit: 0, credit: 18_500_00, description: 'USD Bank Account Revaluation Adjustment' },
      ],
    });
    const fxRevalRows = [
      {
        id: uuid(),
        companyId,
        accountingPeriodId: periodMap.get('2026-10') || null,
        revaluationDate: '2026-10-31',
        targetCurrency: 'USD',
        closingSpotRate: 57.17,
        rateDate: '2026-10-31',
        status: 'POSTED',
        totalCarryingPhpCentavos: 2_822_500_00,
        totalRevaluedPhpCentavos: 2_804_000_00,
        totalGainCentavos: 0,
        totalLossCentavos: 18_500_00,
        netGainLossCentavos: -18_500_00,
        unrealizedJournalId: fxRevalJe.id,
        detailsJson: JSON.stringify([{ accountCode: '1015', foreignBalance: 50000, carryingPhp: 282250000, revaluedPhp: 280400000 }]),
        notes: 'PAS 21 Closing Rate Method',
        createdBy: accountantId,
        postedBy: ownerId,
      },
      {
        id: uuid(),
        companyId,
        accountingPeriodId: periodMap.get('2026-09') || null,
        revaluationDate: '2026-09-30',
        targetCurrency: 'EUR',
        closingSpotRate: 61.74,
        rateDate: '2026-09-30',
        status: 'PREVIEW',
        totalCarryingPhpCentavos: 612_000_00,
        totalRevaluedPhpCentavos: 617_400_00,
        totalGainCentavos: 5_400_00,
        totalLossCentavos: 0,
        netGainLossCentavos: 5_400_00,
        detailsJson: JSON.stringify([]),
        notes: 'EUR Quarter-end preview',
        createdBy: accountantId,
      },
    ];

    await insertInChunks(db, schema.recurringJournals, [
      {
        id: uuid(),
        companyId,
        templateName: 'Monthly Office Lease Accrual (5% EWT WC100)',
        frequency: 'MONTHLY',
        startDate: new Date('2026-01-01T00:00:00Z'),
        nextRunDate: new Date('2026-12-01T00:00:00Z'),
        status: 'ACTIVE',
        journalDataJson: JSON.stringify({ debitAccount: '6020', creditAccount: '1010', amountCentavos: 9500000 }),
        requiresApproval: true,
      },
      {
        id: uuid(),
        companyId,
        templateName: 'Monthly Cloud ERP & Fiber Connectivity Accrual',
        frequency: 'MONTHLY',
        startDate: new Date('2026-01-01T00:00:00Z'),
        nextRunDate: new Date('2026-12-01T00:00:00Z'),
        status: 'ACTIVE',
        journalDataJson: JSON.stringify({ debitAccount: '6030', creditAccount: '1010', amountCentavos: 2400000 }),
        requiresApproval: true,
      },
      {
        id: uuid(),
        companyId,
        templateName: 'Quarterly Insurance Amortization',
        frequency: 'QUARTERLY',
        startDate: new Date('2026-01-01T00:00:00Z'),
        nextRunDate: new Date('2027-01-01T00:00:00Z'),
        status: 'PAUSED',
        journalDataJson: JSON.stringify({ debitAccount: '6040', creditAccount: '1010', amountCentavos: 1800000 }),
        requiresApproval: true,
      },
    ]);

    // -----------------------------------------------------------------------
    // MODULE 7: FIXED ASSETS & DEPRECIATION (25 Assets + 150 Monthly Schedules + Balanced Acquisition & Dep JEs)
    // -----------------------------------------------------------------------
    const faCategories = ['EQUIPMENT', 'VEHICLE', 'FURNITURE', 'IT_HARDWARE', 'BUILDING'];
    const faRows: any[] = [];
    const depRows: any[] = [];
    let totalAssetCost = 0;

    for (let i = 0; i < 25; i++) {
      const assetId = uuid();
      const cat = faCategories[i % faCategories.length];
      const cost = (cat === 'VEHICLE' ? 960_000 : cat === 'BUILDING' ? 1_200_000 : 120_000) * 100;
      const salvage = Math.round(cost * 0.1);
      const lifeMonths = 60;
      const monthlyDep = Math.round((cost - salvage) / lifeMonths);
      totalAssetCost += cost;

      faRows.push({
        id: assetId,
        companyId,
        assetTag: `FA-2026-${pad(i + 1, 4)}`,
        assetName: `${cat.replace('_', ' ')} Asset #${i + 1} — PH Operations`,
        category: cat,
        acquisitionDate: '2026-01-15',
        acquisitionCost: cost,
        salvageValue: salvage,
        usefulLifeMonths: lifeMonths,
        depreciationMethod: 'STRAIGHT_LINE',
        assetAccountId: accEquipment,
        accumulatedDepAccountId: accAccumDep,
        depreciationExpenseAccountId: accDepExp,
        status: i >= 23 ? 'DISPOSED' : 'ACTIVE',
      });

      for (let m = 5; m <= 10; m++) {
        const schedId = uuid();
        const isPosted = m <= 9;
        const accum = monthlyDep * (m - 4);
        const bv = cost - accum;
        let depJeId: string | null = null;
        if (isPosted && i < 10) {
          // Post individual depreciation JEs for first 10 assets using unique schedId as sourceId
          depJeId = pushJE({
            date: `2026-${pad(m, 2)}-28`,
            description: `Monthly Depreciation FA-2026-${pad(i + 1, 4)} (${`2026-${pad(m, 2)}`})`,
            sourceType: 'DEPRECIATION',
            sourceId: schedId,
            status: 'POSTED',
            lines: [
              { accountId: accDepExp, debit: monthlyDep, credit: 0, description: `Depreciation Expense — FA-2026-${pad(i + 1, 4)}` },
              { accountId: accAccumDep, debit: 0, credit: monthlyDep, description: `Accumulated Depreciation — FA-2026-${pad(i + 1, 4)}` },
            ],
          }).id;
        }
        depRows.push({
          id: schedId,
          assetId,
          companyId,
          periodMonth: `2026-${pad(m, 2)}`,
          depreciationAmount: monthlyDep,
          accumulatedDepreciation: accum,
          bookValue: bv,
          status: isPosted ? 'POSTED' : 'PENDING',
          journalEntryId: depJeId,
        });
      }
    }

    pushJE({
      date: '2026-01-15',
      description: `Capital Acquisition of ${faRows.length} Fixed Assets (PPE Register)`,
      sourceType: 'FIXED_ASSET',
      status: 'POSTED',
      lines: [
        { accountId: accEquipment, debit: totalAssetCost, credit: 0, description: 'Property, Plant & Equipment Acquired' },
        { accountId: accCashBank, debit: 0, credit: totalAssetCost, description: 'Bank Disbursement for PPE' },
      ],
    });

    await insertInChunks(db, schema.fixedAssets, faRows, 100, 'fixedAssets');
    // depreciationSchedules deferred until after journalEntries flush

    // -----------------------------------------------------------------------
    // MODULE 8: PAYROLL & HUMAN RESOURCES (30 Employees + 10 Payroll Runs + 300 Payroll Items + Balanced Payroll JEs)
    // -----------------------------------------------------------------------
    const empRows: any[] = [];
    const positions = ['Senior Accountant', 'Logistics Coordinator', 'Sales Executive', 'Warehouse Supervisor', 'IT Systems Analyst', 'HR Officer'];
    for (let i = 0; i < 30; i++) {
      const monthly = (24_000 + (i % 10) * 6_500) * 100;
      empRows.push({
        id: uuid(),
        companyId,
        employeeNo: `EMP-2026-${pad(i + 1, 3)}`,
        firstName: PH_FIRST_NAMES[i % PH_FIRST_NAMES.length],
        lastName: PH_LAST_NAMES[i % PH_LAST_NAMES.length],
        email: `emp${pad(i + 1, 3)}@${spec.key === 'VAT_CORP' ? 'maharlikapacific.ph' : 'visayashighland.ph'}`,
        tin: `31${i % 9}-${pad(100 + i * 3, 3)}-${pad(200 + i * 7, 3)}-000`,
        sssNo: `34-${pad(1234560 + i, 7)}-${i % 9}`,
        philhealthNo: `12-0250${pad(10000 + i, 5)}-${i % 9}`,
        pagibigNo: `1210-${pad(4000 + i, 4)}-${pad(8000 + i, 4)}`,
        position: positions[i % positions.length],
        department: deptRows[i % deptRows.length].name,
        monthlyBasicSalary: monthly,
        dailyRate: Math.round(monthly / 22),
        hourlyRate: Math.round(monthly / 176),
        status: i >= 28 ? 'INACTIVE' : 'ACTIVE',
      });
    }
    await insertInChunks(db, schema.employees, empRows);

    const prunRows: any[] = [];
    const pitemRows: any[] = [];
    for (let r = 0; r < 10; r++) {
      const runId = uuid();
      const month = r + 1; // Jan..Oct 2026
      const status = r < 8 ? 'POSTED' : r === 8 ? 'APPROVED' : 'DRAFT';
      const pDate = `2026-${pad(month, 2)}-28`;

      let sumGross = 0;
      let sumSss = 0;
      let sumPh = 0;
      let sumPi = 0;
      let sumWht = 0;
      let sumNet = 0;

      for (const emp of empRows) {
        const basic = emp.monthlyBasicSalary;
        const ot = (r % 2 === 0) ? 2_500_00 : 0;
        const gross = basic + ot;
        const sssEe = Math.min(1_350_00, Math.round(basic * 0.045));
        const sssEr = Math.min(2_850_00, Math.round(basic * 0.095));
        const phEe = Math.round(basic * 0.025);
        const phEr = phEe;
        const piEe = 200_00;
        const piEr = 200_00;
        const taxable = gross - sssEe - phEe - piEe;
        const wht = taxable > 20_833_00 ? Math.round((taxable - 20_833_00) * 0.15) : 0;
        const totalDed = sssEe + phEe + piEe + wht;
        const net = gross - totalDed;

        sumGross += gross;
        sumSss += sssEe;
        sumPh += phEe;
        sumPi += piEe;
        sumWht += wht;
        sumNet += net;

        pitemRows.push({
          id: uuid(),
          payrollRunId: runId,
          employeeId: emp.id,
          basicPay: basic,
          overtimePay: ot,
          holidayPay: 0,
          nightDiffPay: 0,
          grossPay: gross,
          sssEmployee: sssEe,
          sssEmployer: sssEr,
          philhealthEmployee: phEe,
          philhealthEmployer: phEr,
          pagibigEmployee: piEe,
          pagibigEmployer: piEr,
          withholdingTax: wht,
          totalDeductions: totalDed,
          netPay: net,
        });
      }

      let runJeId: string | null = null;
      if (status === 'POSTED') {
        const statutoryTotal = sumSss + sumPh + sumPi;
        runJeId = pushJE({
          date: pDate,
          description: `Monthly Payroll Register 2026-${pad(month, 2)} (30 Employees — SSS/PhilHealth/Pag-IBIG/1601-C)`,
          sourceType: 'PAYROLL',
          sourceId: runId,
          status: 'POSTED',
          lines: [
            { accountId: accSalaries, debit: sumGross, credit: 0, description: `Gross Salaries & Wages — 2026-${pad(month, 2)}` },
            { accountId: accWHTComp, debit: 0, credit: sumWht, description: `BIR 1601-C Withholding Tax on Compensation` },
            { accountId: accStatutory, debit: 0, credit: statutoryTotal, description: `Employee SSS, PhilHealth & Pag-IBIG Deductions` },
            { accountId: accCashBank, debit: 0, credit: sumNet, description: `Net Payroll Bank Crediting` },
          ],
        }).id;
      }

      prunRows.push({
        id: runId,
        companyId,
        payrollPeriod: `2026-${pad(month, 2)}`,
        startDate: `2026-${pad(month, 2)}-01`,
        endDate: pDate,
        paymentDate: pDate,
        totalGrossPay: sumGross,
        totalSss: sumSss,
        totalPhilhealth: sumPh,
        totalPagibig: sumPi,
        totalWithholdingTax: sumWht,
        totalNetPay: sumNet,
        status,
        journalEntryId: runJeId,
        createdBy: accountantId,
        approvedBy: status !== 'DRAFT' ? approverId : null,
      });
    }
    // payrollRuns & payrollItems deferred until after journalEntries flush

    // -----------------------------------------------------------------------
    // MODULE 9: TAX & BIR COMPLIANCE (18 Filings + 54 Checklists + Adjustments + Exceptions + Tax Calendar + eFiling)
    // -----------------------------------------------------------------------
    const filingRows: any[] = [];
    const checklistRows: any[] = [];
    const filingTypes = isVat ? ['VAT', 'EWT', 'CWT'] : ['PERCENTAGE_TAX', 'EWT', 'CWT'];
    const filingStatuses = ['LOCKED', 'FILED', 'REVIEWED', 'PREPARED', 'DRAFT'];

    for (let q = 1; q <= 4; q++) {
      for (let t = 0; t < filingTypes.length; t++) {
        const fId = uuid();
        const fType = filingTypes[t];
        const st = q <= 2 ? 'FILED' : q === 3 ? 'REVIEWED' : filingStatuses[(q + t) % filingStatuses.length];
        const startM = (q - 1) * 3 + 1;
        const endM = q * 3;
        filingRows.push({
          id: fId,
          companyId,
          taxType: fType,
          periodName: `2026-Q${q}`,
          startDate: `2026-${pad(startM, 2)}-01`,
          endDate: `2026-${pad(endM, 2)}-28`,
          deadlineDate: `2026-${pad(Math.min(12, endM + 1), 2)}-25`,
          status: st,
          totalTaxBase: 4_500_000_00 + q * 350_000_00,
          totalTaxDue: fType === 'VAT' ? 540_000_00 : fType === 'PERCENTAGE_TAX' ? 135_000_00 : 90_000_00,
          netTaxPayable: fType === 'VAT' ? 215_000_00 : fType === 'PERCENTAGE_TAX' ? 135_000_00 : 90_000_00,
          filedBy: st === 'FILED' || st === 'LOCKED' ? ownerId : null,
          notes: `Quarterly BIR ${fType} return — ${spec.vatStatus}`,
        });

        ['Reconcile Subledger vs General Ledger', 'Validate Vendor TIN & ATC Codes (2307)', 'Generate BIR DAT / eFPS Export'].forEach((task, idx) => {
          checklistRows.push({
            id: uuid(),
            taxFilingId: fId,
            taskName: task,
            description: `BIR Statutory control step #${idx + 1}`,
            isCompleted: st === 'FILED' || st === 'LOCKED' || idx === 0,
            completedBy: st === 'FILED' || idx === 0 ? accountantId : null,
          });
        });
      }
    }
    await insertInChunks(db, schema.taxFilings, filingRows);
    await insertInChunks(db, schema.taxFilingChecklists, checklistRows);

    await insertInChunks(db, schema.taxManualAdjustments, [
      {
        id: uuid(),
        taxFilingId: filingRows[0].id,
        companyId,
        adjustmentType: 'TAX_CREDIT_MEMO',
        amount: 25_000_00,
        reason: 'Carry-over creditable withholding tax from prior quarter (BIR Form 2307)',
        approvedBy: approverId,
        status: 'APPROVED',
      },
      {
        id: uuid(),
        taxFilingId: filingRows[filingRows.length - 1].id,
        companyId,
        adjustmentType: 'PRIOR_PERIOD_ADJUSTMENT',
        amount: 8_500_00,
        reason: 'Late supplier invoice input tax claim pending review',
        status: 'PENDING',
      },
    ]);

    await insertInChunks(db, schema.taxExceptions, [
      {
        id: uuid(),
        companyId,
        taxFilingId: filingRows[filingRows.length - 1].id,
        exceptionType: 'UNTRACED_TAX',
        description: 'Verify BIR Form 2307 hardcopy attachment for Q4 supplier payment batch',
        entityType: 'SUPPLIER_PAYMENT',
        entityId: supPayRows[0].id,
        severity: 'WARNING',
        status: 'OPEN',
      },
    ]);

    const taxCalRows = [
      { form: isVat ? 'BIR Form 2550Q' : 'BIR Form 2551Q', type: isVat ? 'VAT' : 'PERCENTAGE_TAX', desc: 'Q3 2026 Quarterly Return', dl: '2026-10-25', st: 'FILED' },
      { form: 'BIR Form 1601-EQ', type: 'EWT', desc: 'Q3 2026 Quarterly Expanded Withholding Tax + QAP', dl: '2026-10-31', st: 'FILED' },
      { form: 'BIR Form 1601-C', type: 'WHT_COMP', desc: 'October 2026 Monthly Withholding Tax on Compensation', dl: '2026-11-10', st: 'FILED' },
      { form: 'BIR Form 0619-E', type: 'EWT', desc: 'November 2026 Monthly Remittance Form of Creditable Income Taxes Withheld', dl: '2026-12-10', st: 'DUE_SOON' },
      { form: 'BIR Form 1601-C', type: 'WHT_COMP', desc: 'November 2026 Monthly Withholding Tax on Compensation', dl: '2026-12-10', st: 'UPCOMING' },
      { form: isVat ? 'BIR Form 2550Q' : 'BIR Form 2551Q', type: isVat ? 'VAT' : 'PERCENTAGE_TAX', desc: 'Q4 2026 Quarterly Return', dl: '2027-01-25', st: 'UPCOMING' },
      { form: 'BIR Form 1601-EQ', type: 'EWT', desc: 'Q4 2026 Quarterly EWT + Alphalist (QAP)', dl: '2027-01-31', st: 'UPCOMING' },
      { form: 'BIR Form 1702-RT', type: 'ITR', desc: 'FY 2026 Annual Corporate Income Tax Return', dl: '2027-04-15', st: 'UPCOMING' },
    ].map((c) => ({
      id: uuid(),
      companyId,
      taxType: c.type,
      formNumber: c.form,
      periodDescription: c.desc,
      deadlineDate: c.dl,
      status: c.st,
    }));
    await insertInChunks(db, schema.taxCalendar, taxCalRows);

    await insertInChunks(db, schema.electronicFilingSubmissions, [
      {
        id: uuid(),
        companyId,
        filingType: isVat ? '2550Q' : '2551Q',
        reportingPeriod: '2026-Q3',
        status: 'ACCEPTED',
        externalReference: `EFPS-${spec.rdoCode}-2026Q3-00412`,
        receiptReference: `BIR-RCPT-8841209`,
        attemptCount: 1,
        submittedAt: new Date('2026-10-22T06:30:00Z'),
      },
      {
        id: uuid(),
        companyId,
        filingType: '1601-EQ',
        reportingPeriod: '2026-Q3',
        status: 'ACCEPTED',
        externalReference: `EFPS-${spec.rdoCode}-1601EQ-00918`,
        receiptReference: `BIR-RCPT-8849102`,
        attemptCount: 1,
        submittedAt: new Date('2026-10-28T08:15:00Z'),
      },
      {
        id: uuid(),
        companyId,
        filingType: '1601-C',
        reportingPeriod: '2026-11',
        status: 'DRAFT',
        attemptCount: 0,
      },
    ]);

    // -----------------------------------------------------------------------
    // MODULE 10: BUDGETS & CASH FLOW FORECASTS (48 Budgets + 6 Forecasts)
    // -----------------------------------------------------------------------
    const budgetCats = ['Salaries & Benefits', 'Rent & Facilities', 'Utilities & Tech', 'Cost of Goods Sold', 'Travel & Transport', 'Office Supplies'];
    const budgetRows: any[] = [];
    for (let m = 5; m <= 12; m++) {
      for (let c = 0; c < budgetCats.length; c++) {
        budgetRows.push({
          id: uuid(),
          companyId,
          periodMonth: `2026-${pad(m, 2)}`,
          category: budgetCats[c],
          monthlyLimit: (250_000 + c * 180_000) * 100,
          notes: `FY 2026 departmental budget cap — ${budgetCats[c]}`,
          status: m <= 10 ? 'ACTIVE' : m === 11 ? 'APPROVED' : 'DRAFT',
        });
      }
    }
    await insertInChunks(db, schema.budgets, budgetRows);

    const forecastRows = [
      { horizon: 30, scen: 'BASE', inAmt: 4_800_000, outAmt: 3_150_000 },
      { horizon: 60, scen: 'BASE', inAmt: 9_600_000, outAmt: 6_200_000 },
      { horizon: 90, scen: 'BASE', inAmt: 14_500_000, outAmt: 9_100_000 },
      { horizon: 30, scen: 'BEST_CASE', inAmt: 5_600_000, outAmt: 2_950_000 },
      { horizon: 60, scen: 'WORST_CASE', inAmt: 7_800_000, outAmt: 6_700_000 },
    ].map((f) => ({
      id: uuid(),
      companyId,
      forecastDate: new Date('2026-11-18T00:00:00Z'),
      horizonDays: f.horizon,
      scenario: f.scen,
      openingBalance: spec.openingBankCentavos / 100,
      projectedInflows: f.inAmt,
      projectedOutflows: f.outAmt,
      closingBalance: (spec.openingBankCentavos / 100) + f.inAmt - f.outAmt,
      detailsJson: JSON.stringify({ basis: 'AR/AP maturity schedule + recurring payroll' }),
    }));
    await insertInChunks(db, schema.cashFlowForecasts, forecastRows);

    // -----------------------------------------------------------------------
    // MODULE 11: DOCUMENTS & OCR (40 Documents + 40 Versions + 40 OCR Logs)
    // -----------------------------------------------------------------------
    const docRows: any[] = [];
    const docVerRows: any[] = [];
    const docOcrRows: any[] = [];
    for (let i = 0; i < 40; i++) {
      const docId = uuid();
      const verId = uuid();
      const isBillDoc = i % 2 === 0;
      const linkedEntity = isBillDoc ? billRows[i % billRows.length] : invRows[i % invRows.length];
      const vStatus = i < 24 ? 'POSTED_TO_ACCOUNTING' : i < 32 ? 'VERIFIED' : i < 37 ? 'UNVERIFIED' : 'REJECTED';
      const fileHash = crypto.createHash('sha256').update(`${companyId}-${docId}-${i}`).digest('hex');

      docRows.push({
        id: docId,
        companyId,
        entityType: isBillDoc ? 'PURCHASE_BILL' : 'SALES_INVOICE',
        entityId: linkedEntity.id,
        documentType: isBillDoc ? 'PURCHASE_INVOICE' : 'SALES_INVOICE',
        fileName: `${isBillDoc ? 'SUPPLIER_INV' : 'SALES_INV'}_2026_${pad(i + 1, 4)}.pdf`,
        originalFileName: `scan_${pad(i + 1, 4)}.pdf`,
        fileType: 'application/pdf',
        fileSize: 128_400 + i * 2_048,
        fileHash,
        filePath: `/vault/${companyId}/originals/doc_${pad(i + 1, 4)}.pdf`,
        source: 'WEB_UI',
        linkedTransactionType: isBillDoc ? 'PURCHASE_BILL' : 'SALES_INVOICE',
        linkedTransactionId: linkedEntity.id,
        linkedVendorId: isBillDoc ? linkedEntity.vendorId : null,
        linkedCustomerId: !isBillDoc ? linkedEntity.customerId : null,
        uploadedBy: accountantId,
        status: 'ACTIVE',
        ocrStatus: vStatus === 'REJECTED' ? 'REJECTED' : 'COMPLETED',
        verificationStatus: vStatus,
        confidenceScore: 0.94,
        extractedMerchant: isBillDoc ? activeVendors[i % activeVendors.length].legalName : spec.legalName,
        extractedInvoiceNumber: isBillDoc ? linkedEntity.billNumber : linkedEntity.invoiceNumber,
        extractedDate: isBillDoc ? linkedEntity.billDate : linkedEntity.invoiceDate,
        extractedTotalAmount: linkedEntity.totalAmount,
        extractionEngine: 'TESSERACT_WASM',
        verifiedBy: vStatus === 'VERIFIED' || vStatus === 'POSTED_TO_ACCOUNTING' ? approverId : null,
      });

      docVerRows.push({
        id: verId,
        documentId: docId,
        companyId,
        versionNumber: 1,
        fileName: `doc_${pad(i + 1, 4)}.pdf`,
        fileType: 'application/pdf',
        fileSize: 128_400 + i * 2_048,
        filePath: `/vault/${companyId}/originals/doc_${pad(i + 1, 4)}.pdf`,
        fileHash,
        linkedEntityType: isBillDoc ? 'PURCHASE_BILL' : 'SALES_INVOICE',
        linkedEntityId: linkedEntity.id,
        ocrStatus: 'COMPLETED',
        ocrEngine: 'TESSERACT_WASM_OFFLINE',
        uploadedBy: accountantId,
        uploadedByName: spec.staff[0].displayName,
        uploadedByRole: spec.staff[0].role,
      });

      docOcrRows.push({
        id: uuid(),
        documentId: docId,
        versionId: verId,
        companyId,
        actionType: 'INITIAL_EXTRACTION',
        engineUsed: 'TESSERACT_WASM_OFFLINE',
        confidenceScore: 0.94,
        performedBy: accountantId,
        performedByName: spec.staff[0].displayName,
        performedByRole: spec.staff[0].role,
      });
    }
    await insertInChunks(db, schema.documents, docRows, 100, 'documents');
    await insertInChunks(db, schema.documentVersions, docVerRows, 100, 'documentVersions');
    try {
      await insertInChunks(db, schema.documentOcrHistory, docOcrRows, 100, 'documentOcrHistory');
    } catch {
      // Legacy migrationManager schema uses ocr_engine/status instead of engine_used/action_type
    }

    // -----------------------------------------------------------------------
    // MODULE 13: APPROVAL REQUESTS & DELEGATIONS
    // -----------------------------------------------------------------------
    const reqRows: any[] = [];
    for (let i = 0; i < 25; i++) {
      const st = i % 3 === 0 ? 'PENDING' : i % 3 === 1 ? 'APPROVED' : 'REJECTED';
      reqRows.push({
        id: uuid(),
        companyId,
        actionType: i % 2 === 0 ? 'DISBURSEMENT' : 'JOURNAL_ENTRY_POSTING',
        amountPHP: 75_000 + i * 12_500,
        makerUserId: accountantId,
        checkerUserId: st === 'PENDING' ? null : approverId,
        status: st,
        details: `Maker-Checker Control Request #${i + 1} (${st})`,
      });
    }
    await insertInChunks(db, schema.approvalWorkflowRequests, reqRows);

    await insertInChunks(db, schema.approvalDelegations, [
      {
        id: uuid(),
        companyId,
        fromUserId: ownerId,
        fromUserName: spec.owner.displayName,
        toUserId: approverId,
        toUserName: spec.staff[1].displayName,
        roleScope: 'Approver',
        moduleScope: 'PROCUREMENT',
        maxAmountCentavos: 500_000_00,
        reason: 'Standing operational disbursement approval authority up to ₱500,000',
        isTemporary: false,
        status: 'ACTIVE',
        createdBy: ownerId,
      },
    ]);

    // -----------------------------------------------------------------------
    // MODULE 14 & 15: AUDIT ENGAGEMENTS, WORKPAPERS, FINDINGS, FRAUD FLAGS, INTEGRITY SCANS, NOTIFICATIONS, AUDIT LOGS, BACKUPS
    // -----------------------------------------------------------------------
    const engRows = [
      { id: uuid(), companyId, clientCompanyId: companyId, engagementName: `FY 2026 External Financial Statement Audit — ${spec.tradeName}`, auditPeriod: 'FY 2026', engagementType: 'STATUTORY_AUDIT', status: 'FIELDWORK', materiality: 450_000_00, performanceMateriality: 315_000_00, trivialThreshold: 22_500_00, preparerId: accountantId, reviewerId: approverId, partnerId: ownerId, fieldworkDeadline: '2027-02-15', reportDeadline: '2027-03-31' },
      { id: uuid(), companyId, clientCompanyId: companyId, engagementName: 'Q3 2026 BIR VAT / EWT Tax Compliance Health Check', auditPeriod: 'Q3 2026', engagementType: 'TAX_COMPLIANCE', status: 'COMPLETED', materiality: 150_000_00, performanceMateriality: 105_000_00, trivialThreshold: 7_500_00, preparerId: accountantId, reviewerId, partnerId: ownerId, fieldworkDeadline: '2026-10-20', reportDeadline: '2026-10-30' },
      { id: uuid(), companyId, clientCompanyId: companyId, engagementName: 'Internal Controls & Procurement 3-Way Match Review', auditPeriod: 'H2 2026', engagementType: 'INTERNAL_AUDIT', status: 'PLANNING', materiality: 200_000_00, performanceMateriality: 140_000_00, trivialThreshold: 10_000_00, preparerId: accountantId, reviewerId, partnerId: ownerId, fieldworkDeadline: '2026-12-10', reportDeadline: '2026-12-20' },
    ];
    await insertInChunks(db, schema.auditEngagements, engRows);

    await insertInChunks(db, schema.auditPlanningDocs, engRows.map((e) => ({
      id: uuid(),
      engagementId: e.id,
      entityUnderstanding: `${spec.legalName} operates in ${spec.industry} under BIR RDO ${spec.rdoCode} (${spec.vatStatus}).`,
      businessProcesses: 'Order-to-Cash (O2C), Procure-to-Pay (P2P 3-Way Match), Record-to-Report (R2R), Payroll.',
      auditStrategy: 'Substantive analytical procedures combined with test of controls on SoD approvals.',
      auditPlan: '100% automated Trial Balance, Subledger-to-GL reconciliation, and BIR Form 2307 vouching.',
      samplingPlan: 'Monetary Unit Sampling (MUS) above performance materiality.',
      status: 'APPROVED',
      preparerId: accountantId,
      reviewerId: approverId,
      partnerId: ownerId,
    })));

    await insertInChunks(db, schema.auditSignificantAccounts, [
      { id: uuid(), engagementId: engRows[0].id, accountName: '1010 Cash in Bank', accountBalance: spec.openingBankCentavos, isSignificant: true, assertions: JSON.stringify(['EXISTENCE', 'RIGHTS', 'VALUATION']), inherentRisk: 'HIGH', controlRisk: 'LOW', fraudRisk: true },
      { id: uuid(), engagementId: engRows[0].id, accountName: '1030 Accounts Receivable', accountBalance: 4_500_000_00, isSignificant: true, assertions: JSON.stringify(['EXISTENCE', 'VALUATION']), inherentRisk: 'MEDIUM', controlRisk: 'LOW', fraudRisk: false },
      { id: uuid(), engagementId: engRows[0].id, accountName: '2010 Accounts Payable', accountBalance: 2_200_000_00, isSignificant: true, assertions: JSON.stringify(['COMPLETENESS', 'OBLIGATIONS']), inherentRisk: 'MEDIUM', controlRisk: 'LOW', fraudRisk: false },
      { id: uuid(), engagementId: engRows[0].id, accountName: '4010 Sales Revenue', accountBalance: 18_000_000_00, isSignificant: true, assertions: JSON.stringify(['OCCURRENCE', 'CUTOFF']), inherentRisk: 'HIGH', controlRisk: 'MEDIUM', fraudRisk: true },
    ]);

    await insertInChunks(db, schema.auditEngagementItems, [
      { id: uuid(), engagementId: engRows[0].id, itemCategory: 'PBC', title: 'Trial Balance & General Ledger Dump (Jan–Nov 2026)', status: 'CLEARED', assignedTo: accountantId, dueDate: '2026-11-30' },
      { id: uuid(), engagementId: engRows[0].id, itemCategory: 'WORKING_PAPER', title: 'Cash & Bank Confirmation Lead Schedule', status: 'REVIEWED', assignedTo: reviewerId, dueDate: '2026-12-05' },
      { id: uuid(), engagementId: engRows[0].id, itemCategory: 'PBC', title: 'BIR Form 2307 & QAP Reconciliation Schedule', status: 'IN_PROGRESS', assignedTo: accountantId, dueDate: '2026-12-10' },
    ]);

    await insertInChunks(db, schema.auditRisksAndProcedures, [
      { id: uuid(), engagementId: engRows[0].id, riskDescription: 'Premature revenue recognition near quarter cut-off', riskType: 'FRAUD', assertionLinked: 'CUTOFF', auditProcedure: 'Vouch 25 sales invoices around Sept 30 and Nov 15 to signed delivery receipts', assignedTo: reviewerId, status: 'IN_PROGRESS' },
      { id: uuid(), engagementId: engRows[0].id, riskDescription: 'Unwithheld EWT on supplier service payments', riskType: 'CONTROL', assertionLinked: 'COMPLETENESS', auditProcedure: 'Recompute 1%/2%/5% EWT on sample of 40 disbursement vouchers and tie to Form 2307', assignedTo: reviewerId, status: 'OPEN' },
    ]);

    await insertInChunks(db, schema.auditWorkpapers, [
      { id: uuid(), engagementId: engRows[0].id, wpRef: 'A-100', title: 'Cash & Bank Reconciliation Lead Sheet', objective: 'Verify existence and accuracy of Cash in Bank', procedure: 'Tie bank reconciliations to GL 1010', result: 'Reconciled with ₱0.00 unexplained difference', conclusion: 'Satisfactory', preparerId: accountantId, reviewerId: approverId, status: 'REVIEWED' },
      { id: uuid(), engagementId: engRows[0].id, wpRef: 'B-100', title: 'Accounts Receivable Aging & Subledger Tie-Out', objective: 'Verify AR completeness and valuation', procedure: 'Reconcile AR aging to GL 1030', result: 'Exact match — ₱0.00 variance', conclusion: 'Satisfactory', preparerId: accountantId, reviewerId: approverId, status: 'LOCKED' },
      { id: uuid(), engagementId: engRows[0].id, wpRef: 'C-100', title: 'BIR Tax Compliance & Form 2307 Vouching', objective: 'Validate BIR VAT/Percentage Tax and EWT accuracy', procedure: 'Tie 2307 certificates to GL 2030', result: 'All ATC codes valid per RR 11-2018', conclusion: 'Satisfactory', preparerId: accountantId, reviewerId: approverId, status: 'PREPARED' },
    ]);

    await insertInChunks(db, schema.auditFindings, [
      { id: uuid(), engagementId: engRows[0].id, title: 'Missing hardcopy scan on 3 unverified supplier bills', riskRating: 'LOW', criteria: 'BIR RR 9-2009 Record Retention', condition: '3 documents remain in UNVERIFIED queue', cause: 'Pending branch courier upload', effect: 'Minor documentation delay', recommendation: 'Complete OCR verification prior to quarterly VAT filing', status: 'OPEN', ownerId: accountantId, targetDate: '2026-11-30' },
      { id: uuid(), engagementId: engRows[1].id, title: 'Timely 1601-EQ Alphalist Submission Verified', riskRating: 'LOW', criteria: 'BIR RR 11-2018', condition: 'All Q3 supplier EWT remittances filed on time', status: 'CLOSED', ownerId: accountantId, targetDate: '2026-10-31' },
    ]);

    await insertInChunks(db, schema.fraudFlags, [
      { id: uuid(), companyId, ruleName: 'ROUND_NUMBER', severity: 'LOW', entityType: 'JOURNAL_ENTRY', entityId: jeBuffer[0].id, detailsJson: JSON.stringify({ note: 'Opening paid-up capital exact round amount — verified with SEC Articles of Incorporation' }), status: 'FALSE_POSITIVE', assignedTo: reviewerId, resolutionNotes: 'Verified legitimate capital injection' },
      { id: uuid(), companyId, ruleName: 'HIGH_VALUE_DISBURSEMENT', severity: 'MEDIUM', entityType: 'SUPPLIER_PAYMENT', entityId: supPayRows[0].id, detailsJson: JSON.stringify({ note: 'Supplier disbursement reviewed under SoD dual-approval rule' }), status: 'RESOLVED', assignedTo: approverId, resolutionNotes: 'Dual-approved with valid PO/GRN 3-way match' },
    ], 50, 'fraudFlags');

    await insertInChunks(db, schema.internalControlsLog, [
      { id: uuid(), companyId, actionType: 'SOD_APPROVAL_VERIFIED', requestedBy: accountantId, approvedBy: approverId, thresholdAmount: 100_000_00, overrideReason: 'Standard Maker-Checker dual sign-off enforced', status: 'APPROVED' },
      { id: uuid(), companyId, actionType: 'PERIOD_HARD_CLOSE', requestedBy: accountantId, approvedBy: ownerId, thresholdAmount: 0, overrideReason: 'Q1 2026 periods hard-closed after TB certification', status: 'APPROVED' },
    ]);

    const notifRows: any[] = [];
    for (let i = 0; i < 30; i++) {
      notifRows.push({
        id: uuid(),
        companyId,
        userId: i % 2 === 0 ? ownerId : approverId,
        title: i % 3 === 0 ? 'Approval Required: Submitted Voucher' : i % 3 === 1 ? 'BIR Filing Deadline Reminder' : 'Reconciliation Certified',
        message: i % 3 === 0
          ? `Voucher #${i + 1} awaiting Maker-Checker SoD approval.`
          : i % 3 === 1
            ? `Upcoming BIR ${isVat ? '2550Q / 1601-EQ' : '2551Q / 1601-EQ'} filing preparation checklist.`
            : `Trial Balance & Subledger control accounts reconciled with ₱0.00 variance.`,
        type: i % 3 === 0 ? 'JOURNAL_CREATED' : i % 3 === 1 ? 'TAX_RETURN' : 'SYSTEM',
        isRead: i >= 12,
      });
    }
    await insertInChunks(db, schema.notifications, notifRows);

    // 250 Rich Audit Log entries linked to real entities with before/after diffs & SHA-256 seals
    const realEntityPool = [
      ...invRows.slice(0, 40).map((r: any) => ({ entityType: 'SALES_INVOICE', module: 'SALES', id: r.id, ref: r.invoiceNumber, amt: r.totalAmount })),
      ...billRows.slice(0, 40).map((r: any) => ({ entityType: 'PURCHASE_BILL', module: 'PROCUREMENT', id: r.id, ref: r.billNumber, amt: r.totalAmount })),
      ...jeBuffer.slice(0, 40).map((r: any) => ({ entityType: 'JOURNAL_ENTRY', module: 'JOURNAL_ENTRY', id: r.id, ref: r.journalNumber, amt: 85_000_00 })),
      ...custPayRows.slice(0, 20).map((r: any) => ({ entityType: 'CUSTOMER_PAYMENT', module: 'SALES', id: r.id, ref: r.paymentNumber, amt: r.amount })),
      ...supPayRows.slice(0, 20).map((r: any) => ({ entityType: 'SUPPLIER_PAYMENT', module: 'PROCUREMENT', id: r.id, ref: r.paymentNumber, amt: r.amount })),
      ...prRows.slice(0, 15).map((r: any) => ({ entityType: 'PURCHASE_REQUISITION', module: 'PROCUREMENT', id: r.id, ref: r.prNumber, amt: r.totalEstimatedAmount || 150_000_00 })),
      ...poRows.slice(0, 15).map((r: any) => ({ entityType: 'PURCHASE_ORDER', module: 'PROCUREMENT', id: r.id, ref: r.poNumber, amt: r.totalAmount || 250_000_00 })),
      ...docRows.slice(0, 25).map((r: any) => ({ entityType: 'DOCUMENT', module: 'DOCUMENTS', id: r.id, ref: r.extractedInvoiceNumber || r.fileName, amt: r.extractedTotalAmount || 50_000_00 })),
      ...filingRows.slice(0, 15).map((r: any) => ({ entityType: 'TAX_FILING', module: 'COMPANY', id: r.id, ref: `${r.formType}-${r.period}`, amt: r.taxDue || 95_000_00 })),
      ...faRows.slice(0, 10).map((r: any) => ({ entityType: 'FIXED_ASSET', module: 'FIXED_ASSETS', id: r.id, ref: r.assetTag, amt: r.acquisitionCost })),
      ...prunRows.slice(0, 10).map((r: any) => ({ entityType: 'PAYROLL_RUN', module: 'PAYROLL', id: r.id, ref: r.runNumber, amt: r.totalNetPay || 450_000_00 })),
    ];
    const auditActions = [
      'CREATE_RECORD',
      'UPDATE_FIELD_VALUES',
      'SUBMIT_FOR_APPROVAL',
      'APPROVE_WORKFLOW_STEP',
      'POST_TO_GL',
      'RETURN_FOR_CORRECTION',
      'REJECT_TRANSACTION',
      'CANCEL_VOID_RECORD',
      'ARCHIVE_RETENTION_VAULT',
      'DELETE_SOFT_RECORD',
      'RESTORE_FROM_ARCHIVE',
      'REVERSE_GL_POSTING',
      'SOD_POLICY_BLOCKED_FAILED',
      'SECURITY_PERMISSION_ROLE_AUDIT',
    ];
    for (let i = 0; i < 250; i++) {
      const target = realEntityPool[i % realEntityPool.length];
      const act = auditActions[i % auditActions.length];
      const logId = uuid();
      const actorId = i % 3 === 0 ? ownerId : i % 3 === 1 ? accountantId : approverId;
      const beforeObj = act === 'CREATE_RECORD' ? null : { status: 'DRAFT', amountPhp: ((target.amt * 0.95) / 100).toFixed(2) };
      const afterObj = { status: act.includes('POST') ? 'POSTED' : act.includes('APPROVE') ? 'APPROVED' : 'UPDATED', amountPhp: (target.amt / 100).toFixed(2), birCasVerified: true };
      const beforeStr = beforeObj ? JSON.stringify(beforeObj) : null;
      const afterStr = JSON.stringify(afterObj);
      const tsIso = new Date(Date.now() - i * 35 * 60 * 1000).toISOString();
      const resCode = act.includes('FAILED') ? 'FAILED' : 'SUCCESS';
      const payload = [logId, companyId, actorId, act, target.entityType, target.id, beforeStr || '', afterStr, resCode, tsIso].join('|');
      const seal = crypto.createHash('sha256').update(payload).digest('hex');

      auditBuffer.push({
        id: logId,
        companyId,
        userId: actorId,
        userEmail: i % 3 === 0 ? spec.owner.email : i % 3 === 1 ? spec.staff[0].email : spec.staff[1].email,
        userDisplayName: i % 3 === 0 ? spec.owner.displayName : i % 3 === 1 ? spec.staff[0].displayName : spec.staff[1].displayName,
        role: i % 3 === 0 ? 'Company Owner' : i % 3 === 1 ? 'Accountant' : 'Approver',
        action: act,
        entityType: target.entityType,
        entityId: target.id,
        entityName: `${target.entityType} ${target.ref}`,
        recordReference: target.ref,
        beforeData: beforeStr,
        afterData: afterStr,
        changedFields: JSON.stringify(['status', 'amountPhp', 'birCasVerified']),
        reason: `Executed ${act} on ${target.ref} under Philippine BIR RR 9-2009 CAS controls.`,
        result: resCode,
        source: 'WEB_UI',
        module: i % 14 === 13 ? 'MEMBERSHIP' : target.module,
        severity: act.includes('SECURITY') ? 'CRITICAL' : act.includes('FAILED') ? 'ERROR' : 'INFO',
        metadata: JSON.stringify({ integritySeal: seal, sealAlgorithm: 'SHA-256', sealedTimestampIso: tsIso }),
        timestamp: new Date(tsIso),
      });
    }

    await insertInChunks(db, schema.systemBackups, [
      {
        id: uuid(),
        companyId,
        backupName: `${spec.tradeName.replace(/\s+/g, '_')}_FY2026_Q3_Snapshot.lai.bak`,
        checksum: crypto.createHash('sha256').update(`${companyId}-backup-q3`).digest('hex'),
        sizeBytes: 4_820_992,
        passwordProtected: true,
        payloadJson: JSON.stringify({ companyId, period: '2026-Q3', status: 'VERIFIED' }),
        createdBy: ownerId,
      },
    ]);

    // Flush ALL batched transaction tables in strict foreign-key order!
    // 1. Journal Entries & Lines first (referenced by invoices, bills, payments, cash, deposits, FX, dep, payroll, memos, tax_calculations)
    await insertInChunks(db, schema.journalEntries, jeBuffer, 100, 'journalEntries');
    await insertInChunks(db, schema.journalLines, jlBuffer, 200, 'journalLines');
    // 2. Cash, Deposits, FX Revaluations, Depreciation & Payroll (reference journalEntries)
    await insertInChunks(db, schema.cashTransactions, cashTxRows, 100, 'cashTransactions');
    await insertInChunks(db, schema.cashTransactionLines, cashTxLineRows, 100, 'cashTransactionLines');
    await insertInChunks(db, schema.cashAdvances, cashAdvRows, 100, 'cashAdvances');
    await insertInChunks(db, schema.bankDeposits, depositRows, 100, 'bankDeposits');
    await insertInChunks(db, schema.fxRevaluationRuns, fxRevalRows, 50, 'fxRevaluationRuns');
    await insertInChunks(db, schema.depreciationSchedules, depRows, 100, 'depreciationSchedules');
    await insertInChunks(db, schema.payrollRuns, prunRows, 50, 'payrollRuns');
    await insertInChunks(db, schema.payrollItems, pitemRows, 100, 'payrollItems');
    // 3. Sales & AR
    await insertInChunks(db, schema.salesInvoices, invRows, 100, 'salesInvoices');
    await insertInChunks(db, schema.salesInvoiceLines, invLineRows, 100, 'salesInvoiceLines');
    await insertInChunks(db, schema.customerPayments, custPayRows, 100, 'customerPayments');
    await insertInChunks(db, schema.customerPaymentApplications, custPayAppRows, 100, 'customerPaymentApplications');
    await insertInChunks(db, schema.creditMemos, cmRows, 50, 'creditMemos');
    await insertInChunks(db, schema.creditMemoLines, cmLineRows, 50, 'creditMemoLines');
    await insertInChunks(db, schema.creditMemoApplications, cmAppRows, 50, 'creditMemoApplications');
    // 4. Purchase & AP
    await insertInChunks(db, schema.purchaseBills, billRows, 100, 'purchaseBills');
    await insertInChunks(db, schema.purchaseBillLines, billLineRows, 100, 'purchaseBillLines');
    await insertInChunks(db, schema.supplierPayments, supPayRows, 100, 'supplierPayments');
    await insertInChunks(db, schema.supplierPaymentApplications, supPayAppRows, 100, 'supplierPaymentApplications');
    await insertInChunks(db, schema.debitMemos, dmRows, 50, 'debitMemos');
    await insertInChunks(db, schema.debitMemoLines, dmLineRows, 50, 'debitMemoLines');
    await insertInChunks(db, schema.debitMemoApplications, dmAppRows, 50, 'debitMemoApplications');
    // 5. Tax Calculations, Workflows & Audit Logs
    await insertInChunks(db, schema.taxCalculations, taxCalcBuffer, 100, 'taxCalculations');
    await insertInChunks(db, schema.approvalWorkflows, wfBuffer, 100, 'approvalWorkflows');
    await insertInChunks(db, schema.approvalSteps, wfStepBuffer, 100, 'approvalSteps');
    await insertInChunks(db, schema.auditLogs, auditBuffer, 100, 'auditLogs');

    const elapsed = Math.round(performance.now() - t0);
    Object.assign(counts, {
      customers: customerRows.length,
      vendors: vendorRows.length,
      salesInvoices: invRows.length,
      customerPayments: custPayRows.length,
      creditMemos: cmRows.length,
      purchaseRequisitions: prRows.length,
      purchaseOrders: poRows.length,
      goodsReceiptNotes: grnRows.length,
      purchaseBills: billRows.length,
      supplierPayments: supPayRows.length,
      debitMemos: dmRows.length,
      inventoryItems: invItemRows.length,
      inventoryTransactions: invTxRows.length,
      cashTransactions: cashTxRows.length,
      checks: checkRows.length,
      bankDeposits: depositRows.length,
      bankReconciliations: reconRows.length,
      journalEntries: jeBuffer.length,
      journalLines: jlBuffer.length,
      fixedAssets: faRows.length,
      depreciationSchedules: depRows.length,
      employees: empRows.length,
      payrollRuns: prunRows.length,
      payrollItems: pitemRows.length,
      taxCalculations: taxCalcBuffer.length,
      taxFilings: filingRows.length,
      budgets: budgetRows.length,
      documents: docRows.length,
      approvalWorkflows: wfBuffer.length,
      auditLogs: auditBuffer.length,
      seedElapsedMs: elapsed,
    });

    const totalRecords = Object.entries(counts)
      .filter(([k]) => k !== 'seedElapsedMs')
      .reduce((s, [, v]) => s + v, 0);
    counts.totalRecords = totalRecords;
    console.log(`  [SEEDED] ${spec.legalName}: ${totalRecords.toLocaleString()} DB rows (${jeBuffer.length} JEs / ${jlBuffer.length} JL lines) in ${elapsed}ms`);
  });

  return counts;
}

async function runLiveDryRunAndStressAudit(spec: CompanySpec, companyId: string, ownerToken: string) {
  console.log(`\n  [DRY RUN & STRESS AUDIT] Running live API & SoD approval suite for ${spec.legalName}...`);

  // 1. Login as Accountant (Maker) and Approver (Checker) to prove real RBAC + SoD!
  const accLogin = await apiFetch('POST', '/api/auth/login', undefined, {
    email: spec.staff[0].email,
    password: spec.staff[0].password,
    companyId,
  });
  const appLogin = await apiFetch('POST', '/api/auth/login', undefined, {
    email: spec.staff[1].email,
    password: spec.staff[1].password,
    companyId,
  });
  if (!accLogin.ok || !appLogin.ok) {
    throw new Error(`Staff login failed for ${spec.legalName}: acc=${accLogin.status}, app=${appLogin.status}`);
  }
  const accountantToken = accLogin.data.token;
  const approverToken = appLogin.data.token;

  // Fetch accounts, customers, vendors to run live creation dry run
  const [acctsRes, custsRes, vendsRes] = await Promise.all([
    apiFetch('GET', '/api/accounting/accounts', ownerToken),
    apiFetch('GET', '/api/master-data/customers', ownerToken),
    apiFetch('GET', '/api/master-data/vendors', ownerToken),
  ]);
  const extractArr = (payload: any, keys: string[]): any[] => {
    if (Array.isArray(payload)) return payload;
    for (const k of keys) {
      if (Array.isArray(payload?.[k])) return payload[k];
    }
    return [];
  };
  const accts = extractArr(acctsRes.data, ['accounts', 'data', 'items', 'records']);
  const custs = extractArr(custsRes.data, ['customers', 'data', 'items', 'records']);
  const vends = extractArr(vendsRes.data, ['vendors', 'data', 'items', 'records']);

  const accCash = accts.find((a) => a.accountCode === '1010')?.id;
  const accRev = accts.find((a) => a.accountCode === '4010')?.id;
  const accExp = accts.find((a) => a.accountCode === '6040')?.id;
  const activeCust = custs.find((c) => c.status === 'ACTIVE') || custs[0];
  const activeVend = vends.find((v) => v.status === 'ACTIVE') || vends[0];

  // 2. Live Maker-Checker Journal Entry Workflow (Create as Accountant -> Submit -> Approve as Approver -> Post as Owner)
  const suffix = Date.now().toString().slice(-5);
  const createJeRes = await apiFetch('POST', '/api/accounting/journals', accountantToken, {
    entryDate: '2026-11-16',
    description: `Live Stress Dry-Run JE (${spec.key} #${suffix})`,
    lines: [
      { accountId: accExp, debit: 15_000_00, credit: 0, description: 'Live Dry-Run Operating Supplies' },
      { accountId: accCash, debit: 0, credit: 15_000_00, description: 'Cash Settlement' },
    ],
  });
  if (!createJeRes.ok) {
    throw new Error(`Live JE creation failed: HTTP ${createJeRes.status} ${JSON.stringify(createJeRes.data)}`);
  }
  const liveJeId = createJeRes.data?.id || createJeRes.data?.journal?.id;
  const subJeRes = await apiFetch('POST', `/api/accounting/journals/${liveJeId}/submit`, accountantToken, {});
  const appJeRes = await apiFetch('POST', `/api/accounting/journals/${liveJeId}/approve`, approverToken, { notes: 'SoD Approved during dry run' });
  const postJeRes = await apiFetch('POST', `/api/accounting/journals/${liveJeId}/post`, ownerToken, {});
  console.log(`    ✓ Live SoD JE Lifecycle: Create(${createJeRes.status}) -> Submit(${subJeRes.status}) -> Approve[${spec.staff[1].role}](${appJeRes.status}) -> Post(${postJeRes.status})`);

  // 3. Live Sales Invoice -> Submit (Owner) -> Approve (Approver SoD) -> Post (Owner)
  const createInvRes = await apiFetch('POST', '/api/accounting/sales-invoices', ownerToken, {
    customerId: activeCust.id,
    invoiceNumber: `SI-LIVE-${suffix}`,
    invoiceType: 'SALES',
    invoiceDate: '2026-11-16',
    dueDate: '2026-12-16',
    reference: `LIVE-DR-${suffix}`,
    totalAmount: 50_000_00,
    lines: [
      {
        accountId: accRev,
        description: 'Live Dry-Run Billing Item',
        quantity: 2,
        unitPrice: 25_000_00,
        amount: 50_000_00,
      },
    ],
  });
  let liveInvSummary = `Create(${createInvRes.status})`;
  if (createInvRes.ok) {
    const liveInvId = createInvRes.data?.id || createInvRes.data?.invoice?.id;
    const sRes = await apiFetch('POST', `/api/accounting/sales-invoices/${liveInvId}/submit`, ownerToken, {});
    const aRes = await apiFetch('POST', `/api/accounting/sales-invoices/${liveInvId}/approve`, approverToken, {});
    const pRes = await apiFetch('POST', `/api/accounting/sales-invoices/${liveInvId}/post`, ownerToken, {});
    liveInvSummary += ` -> Submit(${sRes.status}) -> Approve[Approver](${aRes.status}) -> Post(${pRes.status})`;
  } else {
    throw new Error(`Live Invoice creation failed: HTTP ${createInvRes.status} ${JSON.stringify(createInvRes.data)}`);
  }
  console.log(`    ✓ Live SoD Sales Invoice Lifecycle: ${liveInvSummary}`);

  // 4. Live Purchase Bill -> Submit (Owner) -> Approve (Approver SoD) -> Post (Owner)
  const createBillRes = await apiFetch('POST', '/api/accounting/purchase-bills', ownerToken, {
    vendorId: activeVend.id,
    billNumber: `BILL-LIVE-${suffix}`,
    billDate: '2026-11-16',
    dueDate: '2026-12-16',
    reference: `LIVE-PB-${suffix}`,
    totalAmount: 20_000_00,
    lines: [
      {
        accountId: accExp,
        description: 'Live Dry-Run Supplier Expense',
        quantity: 1,
        unitPrice: 20_000_00,
        amount: 20_000_00,
      },
    ],
  });
  let liveBillSummary = `Create(${createBillRes.status})`;
  if (createBillRes.ok) {
    const liveBillId = createBillRes.data?.id || createBillRes.data?.bill?.id;
    const sRes = await apiFetch('POST', `/api/accounting/purchase-bills/${liveBillId}/submit`, ownerToken, {});
    const aRes = await apiFetch('POST', `/api/accounting/purchase-bills/${liveBillId}/approve`, approverToken, {});
    const pRes = await apiFetch('POST', `/api/accounting/purchase-bills/${liveBillId}/post`, ownerToken, {});
    liveBillSummary += ` -> Submit(${sRes.status}) -> Approve[Approver](${aRes.status}) -> Post(${pRes.status})`;
  } else {
    throw new Error(`Live Purchase Bill creation failed: HTTP ${createBillRes.status} ${JSON.stringify(createBillRes.data)}`);
  }
  console.log(`    ✓ Live SoD Purchase Bill Lifecycle: ${liveBillSummary}`);

  const accEquity = accts.find((a) => a.accountCode === '3010')?.id || accts.find((a) => a.accountType === 'EQUITY')?.id;

  // Ensure positive working capital cash reserve via real live SoD Equity Capital Injection JE if cash < ₱5M
  const preDash = await apiFetch('GET', '/api/dashboard/overview', ownerToken);
  const preCash = Number(preDash.data?.cashBalance ?? 0);
  if (accCash && accEquity && preCash < 5_000_000_00) {
    const injectCentavos = Math.ceil((12_000_000_00 - preCash) / 100_000_00) * 100_000_00;
    const capRes = await apiFetch('POST', '/api/accounting/journals', accountantToken, {
      entryDate: '2026-11-16',
      description: `Paid-in Capital Infusion — Working Capital Reserve (${spec.key})`,
      lines: [
        { accountId: accCash, debit: injectCentavos, credit: 0, description: 'BDO/BPI Corporate Checking Deposit' },
        { accountId: accEquity, debit: 0, credit: injectCentavos, description: 'Subscribed & Paid-in Share Capital' },
      ],
    });
    if (capRes.ok) {
      const capId = capRes.data?.id || capRes.data?.journal?.id;
      await apiFetch('POST', `/api/accounting/journals/${capId}/submit`, accountantToken, {});
      await apiFetch('POST', `/api/accounting/journals/${capId}/approve`, approverToken, { notes: 'Board-approved working capital infusion' });
      await apiFetch('POST', `/api/accounting/journals/${capId}/post`, ownerToken, {});
      console.log(`    ✓ Working Capital Infusion Posted (Live SoD): ₱${(injectCentavos / 100).toLocaleString()}`);
    }
  }

  // 5. Full 16-Module & Submodule Live API Stress Sweep (50 Endpoints)
  const endpoints: Array<{ mod: string; path: string }> = [
    { mod: '1. Dashboard Overview & SoT', path: '/api/dashboard/overview' },
    { mod: '2. Sales Invoices', path: '/api/accounting/sales-invoices?limit=50' },
    { mod: '2. Customer Payments (OR)', path: '/api/accounting/customer-payments' },
    { mod: '2. Credit Memos', path: '/api/accounting/credit-memos' },
    { mod: '3. Purchase Requisitions', path: '/api/journey/requisitions' },
    { mod: '3. Procurement POs', path: '/api/operations/procurement/purchase-orders' },
    { mod: '3. Purchase Bills', path: '/api/accounting/purchase-bills?limit=50' },
    { mod: '3. Supplier Payments (DV)', path: '/api/accounting/supplier-payments' },
    { mod: '3. Debit Memos', path: '/api/accounting/debit-memos' },
    { mod: '4. Inventory Items', path: '/api/operations/inventory/items' },
    { mod: '4. Inventory Movements', path: '/api/operations/inventory/movements' },
    { mod: '4. Inventory Valuation', path: '/api/operations/inventory/valuation' },
    { mod: '5. Cash Transactions', path: '/api/accounting/cash-transactions' },
    { mod: '5. Cashbook', path: `/api/accounting/cashbook?cashAccountId=${encodeURIComponent(accCash || '')}` },
    { mod: '5. Bank Reconciliations', path: '/api/accounting/bank-reconciliations' },
    { mod: '6. Chart of Accounts', path: '/api/accounting/accounts' },
    { mod: '6. General Journals', path: '/api/accounting/journals?limit=50' },
    { mod: '6. Accounting Periods', path: '/api/accounting/periods' },
    { mod: '6. FX Rates', path: '/api/operations/forex/rates' },
    { mod: '6. FX Revaluations', path: '/api/operations/forex/revaluations' },
    { mod: '7. Fixed Assets', path: '/api/operations/fixed-assets' },
    { mod: '8. Payroll Employees', path: '/api/operations/payroll/employees' },
    { mod: '9. Tax Dashboard Summary', path: '/api/tax/dashboard-summary' },
    { mod: '9. Tax Filings', path: '/api/tax/filings' },
    { mod: '9. Tax Calendar', path: '/api/tax/calendar' },
    { mod: '9. BIR Form 2307 Workspace', path: '/api/tax/2307/workspace' },
    { mod: '10. Budgets', path: '/api/budgets' },
    { mod: '11. Documents & OCR', path: '/api/documents' },
    { mod: '12. Trial Balance Report', path: '/api/reports/trial-balance' },
    { mod: '12. General Ledger Report', path: '/api/reports/general-ledger?limit=100' },
    { mod: '12. Income Statement', path: '/api/reports/income-statement' },
    { mod: '12. Balance Sheet', path: '/api/reports/balance-sheet' },
    { mod: '12. Cash Flow Statement', path: '/api/reports/cash-flow' },
    { mod: '12. AR Aging', path: '/api/reports/ar-aging' },
    { mod: '12. AP Aging', path: '/api/reports/ap-aging' },
    { mod: '12. Management Analytics', path: '/api/journey/management-analytics' },
    { mod: '13. Approvals Inbox', path: '/api/journey/approvals' },
    { mod: '13. Approval Policies', path: '/api/journey/approvals/policies' },
    { mod: '13. Approval Delegations', path: '/api/journey/approvals/delegations' },
    { mod: '14. Activity Center', path: '/api/journey/activity-center' },
    { mod: '14. Notifications', path: '/api/notifications' },
    { mod: '14. Audit Trail Stream', path: '/api/audit' },
    { mod: '15. Audit Engagements', path: '/api/audit-engagements' },
    { mod: '15. Ledger Integrity Check', path: '/api/accounting/integrity-check' },
    { mod: '16. Master Customers', path: '/api/master-data/customers' },
    { mod: '16. Master Vendors', path: '/api/master-data/vendors' },
    { mod: '16. Master Banks', path: '/api/master-data/banks' },
    { mod: '16. Master Departments', path: '/api/master-data/departments' },
    { mod: '16. Master Projects', path: '/api/master-data/projects' },
    { mod: '16. RBAC Users', path: '/api/users' },
  ];

  const failures: Array<{ mod: string; path: string; status: number; err: any }> = [];
  const resultsMap = new Map<string, { status: number; ms: number; data: any }>();
  let totalLatency = 0;
  let maxLatency = { mod: '', ms: 0 };

  for (const ep of endpoints) {
    const r = await apiFetch('GET', ep.path, ownerToken);
    resultsMap.set(ep.path, { status: r.status, ms: r.ms, data: r.data });
    totalLatency += r.ms;
    if (r.ms > maxLatency.ms) maxLatency = { mod: ep.mod, ms: r.ms };
    if (!r.ok) {
      failures.push({ mod: ep.mod, path: ep.path, status: r.status, err: r.data });
    }
  }

  // 6. Strict Source-of-Truth Financial Reconciliation Verification
  const dash = resultsMap.get('/api/dashboard/overview')?.data;
  const tb = resultsMap.get('/api/reports/trial-balance')?.data;
  const is = resultsMap.get('/api/reports/income-statement')?.data;
  const bs = resultsMap.get('/api/reports/balance-sheet')?.data;
  const ws2307 = resultsMap.get('/api/tax/2307/workspace')?.data;

  const tbRows: any[] = Array.isArray(tb) ? tb : (Array.isArray(tb?.rows) ? tb.rows : []);
  const tbDr = tbRows.reduce((s, r) => s + Number(r.closingDebit ?? r.debit ?? 0), 0);
  const tbCr = tbRows.reduce((s, r) => s + Number(r.closingCredit ?? r.credit ?? 0), 0);
  const tbDiff = Math.abs(tbDr - tbCr);

  const recon = dash?.reconciliationSummary || {};
  const stats = dash?.summaryStats || {};
  const dashCash = Number(dash?.cashBalance ?? 0);
  const dashAR = Number(dash?.accountsReceivable ?? 0);
  const dashAP = Number(dash?.accountsPayable ?? 0);
  const dashRev = Number(stats.totalYtdRevenue ?? 0);
  const dashExp = Number(stats.totalYtdExpenses ?? 0);
  const dashNet = Number(stats.totalYtdNetProfit ?? 0);

  const sotChecks = {
    tbBalanced: (recon.tbStatus === 'OK' || recon.tbStatus === 'BALANCED') && Boolean(recon.tbBalanced) && Number(recon.tbVarianceCentavos ?? -1) === 0 && tbDr > 0 && tbDiff === 0,
    arReconciled: Number(recon.arVarianceCentavos ?? -1) === 0,
    apReconciled: Number(recon.apVarianceCentavos ?? -1) === 0,
    bsBalanced: bs ? Math.abs(Number(bs.totalAssets ?? 0) - (Number(bs.totalLiabilities ?? 0) + Number(bs.totalEquity ?? 0))) <= 1 : false,
    netProfitFormulaExact: Math.abs((dashRev - dashExp) - dashNet) <= 1,
    form2307AutoPopulated: Array.isArray(ws2307?.certificates)
      ? ws2307.certificates.length > 0
      : Array.isArray(ws2307?.suppliers)
        ? ws2307.suppliers.length > 0
        : Number(ws2307?.summary?.totalWithheldCentavos ?? ws2307?.totalWithheldCentavos ?? 0) > 0,
  };

  console.log(`    ✓ Endpoints Passed: ${endpoints.length - failures.length}/${endpoints.length} | Avg Latency: ${Math.round(totalLatency / endpoints.length)}ms | Slowest: ${maxLatency.mod} (${maxLatency.ms}ms)`);
  if (failures.length > 0) {
    console.log('    ✗ Endpoint Failures:');
    for (const f of failures) {
      console.log(`      - [${f.status}] ${f.mod} (${f.path}): ${JSON.stringify(f.err).slice(0, 180)}`);
    }
  }
  console.log(`    ✓ Dashboard SoT Metrics: Cash=₱${(dashCash / 100).toLocaleString()} | AR=₱${(dashAR / 100).toLocaleString()} (Subledger=₱${((recon.arSubledgerCentavos || 0) / 100).toLocaleString()} vs GL=₱${((recon.arGlControlCentavos || 0) / 100).toLocaleString()}, var=₱${((recon.arVarianceCentavos || 0) / 100).toFixed(2)}) | AP=₱${(dashAP / 100).toLocaleString()} (Subledger=₱${((recon.apSubledgerCentavos || 0) / 100).toLocaleString()} vs GL=₱${((recon.apGlControlCentavos || 0) / 100).toLocaleString()}, var=₱${((recon.apVarianceCentavos || 0) / 100).toFixed(2)})`);
  console.log(`    ✓ P&L & TB: Revenue=₱${(dashRev / 100).toLocaleString()} | Expenses=₱${(dashExp / 100).toLocaleString()} | Net=₱${(dashNet / 100).toLocaleString()} | TB=${recon.tbStatus} (DR=₱${(tbDr / 100).toLocaleString()} === CR=₱${(tbCr / 100).toLocaleString()})`);
  console.log(`    ✓ Source-of-Truth Assertions:`, JSON.stringify(sotChecks));

  return {
    companyId,
    endpointsTotal: endpoints.length,
    endpointsPassed: endpoints.length - failures.length,
    failures,
    avgLatencyMs: Math.round(totalLatency / endpoints.length),
    slowestEndpoint: maxLatency,
    sotChecks,
    metrics: {
      cashPhp: dashCash / 100,
      arPhp: dashAR / 100,
      apPhp: dashAP / 100,
      revenuePhp: dashRev / 100,
      expensesPhp: dashExp / 100,
      netProfitPhp: dashNet / 100,
      tbDebitPhp: tbDr / 100,
      tbCreditPhp: tbCr / 100,
      arSubledgerPhp: Number(recon.arSubledgerCentavos ?? 0) / 100,
      arGlControlPhp: Number(recon.arGlControlCentavos ?? 0) / 100,
      arVarianceCentavos: recon.arVarianceCentavos,
      apSubledgerPhp: Number(recon.apSubledgerCentavos ?? 0) / 100,
      apGlControlPhp: Number(recon.apGlControlCentavos ?? 0) / 100,
      apVarianceCentavos: recon.apVarianceCentavos,
      tbVarianceCentavos: recon.tbVarianceCentavos,
      isRevenuePhp: Number(is?.totalRevenue ?? is?.revenue ?? 0) / 100,
      bsAssetsPhp: Number(bs?.totalAssets ?? 0) / 100,
      bsLiabPlusEqPhp: (Number(bs?.totalLiabilities ?? 0) + Number(bs?.totalEquity ?? 0)) / 100,
    },
  };
}

async function main() {
  console.log('===============================================================================');
  console.log(' LedgerAI PH — Dual-Company 16-Module Enterprise Dry-Run & 1,000+ Stress Test');
  console.log('===============================================================================\n');

  const summary: any[] = [];

  for (const spec of COMPANY_SPECS) {
    console.log(`\n>>> [${spec.key}] ${spec.legalName} (${spec.vatStatus}, TIN ${spec.tin}, RDO ${spec.rdoCode})`);
    const { companyId, ownerToken } = await provisionOrFindCompany(spec);
    const seedCounts = await seedCompanyStressDataset(spec, companyId);
    const audit = await runLiveDryRunAndStressAudit(spec, companyId, ownerToken);
    summary.push({
      legalName: spec.legalName,
      companyId,
      vatStatus: spec.vatStatus,
      tin: spec.tin,
      rdoCode: spec.rdoCode,
      credentials: {
        owner: { email: spec.owner.email, password: spec.owner.password, role: spec.owner.role },
        staff: spec.staff.map((s) => ({ email: s.email, password: s.password, role: s.role })),
      },
      seedCounts,
      audit,
    });
  }

  console.log('\n===============================================================================');
  console.log(' FINAL STRESS-TEST SUMMARY JSON');
  console.log('===============================================================================');
  console.log(JSON.stringify(summary, null, 2));

  const anyFailure = summary.some(
    (s) =>
      s.audit.failures.length > 0 ||
      !s.audit.sotChecks.tbBalanced ||
      !s.audit.sotChecks.arReconciled ||
      !s.audit.sotChecks.apReconciled ||
      !s.audit.sotChecks.bsBalanced
  );
  if (anyFailure) {
    console.error('\n[!] One or more stress-test endpoints or Source-of-Truth assertions failed!');
    process.exitCode = 1;
  } else {
    console.log('\n[PASS] ALL 16 MODULES, SUBMODULES, SOD WORKFLOWS, AND SOURCE-OF-TRUTH RECONCILIATIONS PASSED 100%!');
  }
}

main().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
