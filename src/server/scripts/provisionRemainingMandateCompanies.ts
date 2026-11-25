import path from 'path';
import fs from 'fs';

const BASE_URL = process.env.LEDGERAI_BASE_URL || 'http://127.0.0.1:3000';

async function api(pathUrl: string, opts: { method?: string; token?: string; body?: any } = {}) {
  const res = await fetch(`${BASE_URL}${pathUrl}`, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

interface NewCompanyDef {
  id: string;
  legalName: string;
  tradeName: string;
  tin: string;
  industry: string;
  branchCode: string;
  address: string;
  vatStatus: 'VAT' | 'NON_VAT';
  taxpayerClassification: 'INDIVIDUAL' | 'CORPORATION';
  rdoCode: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  secondaryUsers: Array<{ email: string; password: string; displayName: string; role: string }>;
}

const MANDATE_COMPANIES: NewCompanyDef[] = [
  {
    id: 'LGR-PH-2026-8PCT-03',
    legalName: 'Archipelago Digital Creative Studio (8% Sole Prop)',
    tradeName: 'Archipelago Creative Studio',
    tin: '312-554-789-00000',
    industry: 'PROFESSIONAL_SERVICES',
    branchCode: '00000',
    address: 'Unit 405, Joy-Nostalg Center, ADB Avenue, Pasig City',
    vatStatus: 'NON_VAT',
    taxpayerClassification: 'INDIVIDUAL',
    rdoCode: '043',
    adminEmail: 'owner@archipelagostudio.ph',
    adminPassword: 'StudioPH!2026',
    adminName: 'Mateo Alcantara',
    secondaryUsers: [
      {
        email: 'accountant@archipelagostudio.ph',
        password: 'AcctPH!2026',
        displayName: 'Theresa Cruz, CPA',
        role: 'Accountant',
      },
    ],
  },
  {
    id: 'LGR-PH-2026-PROF-04',
    legalName: 'Vanguard Legal & Accounting Associates Corp.',
    tradeName: 'Vanguard Associates',
    tin: '008-992-143-00000',
    industry: 'PROFESSIONAL_SERVICES',
    branchCode: '00000',
    address: '24th Floor, Zuellig Building, Makati Avenue, Makati City',
    vatStatus: 'VAT',
    taxpayerClassification: 'CORPORATION',
    rdoCode: '050',
    adminEmail: 'owner@vanguardassociates.ph',
    adminPassword: 'Vanguard!2026',
    adminName: 'Atty. Roberto Tan, CPA',
    secondaryUsers: [
      {
        email: 'finance@vanguardassociates.ph',
        password: 'FinPH!2026',
        displayName: 'Beatrice Valenzuela',
        role: 'Finance Manager',
      },
      {
        email: 'tax@vanguardassociates.ph',
        password: 'TaxPH!2026',
        displayName: 'Lorenzo Diaz, CPA',
        role: 'Accountant',
      },
    ],
  },
  {
    id: 'LGR-PH-2026-MB-05',
    legalName: 'Visayas-Mindanao Express Haulers Inc.',
    tradeName: 'VisMin Express Haulers',
    tin: '009-114-682-00000',
    industry: 'LOGISTICS_TRADING',
    branchCode: '00000',
    address: 'M.L. Quezon National Highway, Lapu-Lapu City, Cebu',
    vatStatus: 'VAT',
    taxpayerClassification: 'CORPORATION',
    rdoCode: '080',
    adminEmail: 'owner@visminhaulers.ph',
    adminPassword: 'Vismin!2026',
    adminName: 'Rodrigo Osmeña',
    secondaryUsers: [
      {
        email: 'cebu.acct@visminhaulers.ph',
        password: 'AcctPH!2026',
        displayName: 'Fiona Cabahug, CPA',
        role: 'Accountant',
      },
      {
        email: 'davao.finance@visminhaulers.ph',
        password: 'FinPH!2026',
        displayName: 'Dante Monteverde',
        role: 'Finance Manager',
      },
    ],
  },
  {
    id: 'LGR-PH-2026-HV-06',
    legalName: 'Titan Distribution & Retail Network Corp.',
    tradeName: 'Titan Retail Network',
    tin: '007-654-321-00000',
    industry: 'LOGISTICS_TRADING',
    branchCode: '00000',
    address: 'Pier 4, North Harbor, Tondo, Manila City',
    vatStatus: 'VAT',
    taxpayerClassification: 'CORPORATION',
    rdoCode: '033',
    adminEmail: 'owner@titandistribution.ph',
    adminPassword: 'TitanPH!2026',
    adminName: 'Victor Sy',
    secondaryUsers: [
      {
        email: 'cfo@titandistribution.ph',
        password: 'CfoPH!2026',
        displayName: 'Helena Gokongwei, CPA',
        role: 'Finance Manager',
      },
      {
        email: 'senior.acct@titandistribution.ph',
        password: 'AcctPH!2026',
        displayName: 'Arthur Co, CPA',
        role: 'Accountant',
      },
    ],
  },
];

async function seedCompanyBasics(def: NewCompanyDef, token: string) {
  // 1. Fetch COA
  const accRes = await api('/api/accounting/accounts', { token });
  const accounts: any[] = Array.isArray(accRes.data) ? accRes.data : accRes.data?.data || [];
  const cashAcc = accounts.find((a) => a.accountCode === '1010') || accounts.find((a) => a.accountType === 'ASSET');
  const eqAcc = accounts.find((a) => a.accountCode === '3010') || accounts.find((a) => a.accountType === 'EQUITY');
  const revAcc = accounts.find((a) => a.accountCode === '4010') || accounts.find((a) => a.accountType === 'REVENUE');
  const expAcc = accounts.find((a) => a.accountCode === '6010') || accounts.find((a) => a.accountType === 'EXPENSE');

  // 2. Initial Capital Infusion Journal Entry
  if (cashAcc && eqAcc) {
    const jeRes = await api('/api/accounting/journals', {
      method: 'POST',
      token,
      body: {
        journalNumber: `JE-INIT-${def.id.slice(-2)}`,
        entryDate: '2026-01-02',
        description: `${def.legalName} Initial Capital & Operating Equity Injection`,
        lines: [
          { accountId: cashAcc.id, description: 'Initial Treasury Bank Deposit', debit: 500000000, credit: 0 },
          { accountId: eqAcc.id, description: 'Owner Paid-in Equity Contribution', debit: 0, credit: 500000000 },
        ],
      },
    });
    if (jeRes.ok && jeRes.data?.id) {
      await api(`/api/accounting/journals/${jeRes.data.id}/submit`, { method: 'POST', token });
      await api(`/api/accounting/journals/${jeRes.data.id}/approve`, { method: 'POST', token });
      await api(`/api/accounting/journals/${jeRes.data.id}/post`, { method: 'POST', token });
    }
  }

  // 3. Add Master Data (Customers & Vendors)
  const custRes = await api('/api/master-data/customers', {
    method: 'POST',
    token,
    body: {
      code: `CUST-${def.id.slice(-2)}-01`,
      legalName: `${def.tradeName} Client Alpha Inc.`,
      tin: '009-223-445-00000',
      vatStatus: 'VAT',
      email: 'client.alpha@enterprise.ph',
      phone: '+63-2-8222-1111',
      address: 'Bonifacio Global City, Taguig City, Philippines',
      status: 'ACTIVE',
      creditLimit: 5000000,
    },
  });

  const vendRes = await api('/api/master-data/vendors', {
    method: 'POST',
    token,
    body: {
      code: `VEND-${def.id.slice(-2)}-01`,
      legalName: `${def.tradeName} Supplier Prime Corp.`,
      tin: '008-334-556-00000',
      vatStatus: 'VAT',
      email: 'supplier.prime@vendor.ph',
      phone: '+63-2-8333-2222',
      address: 'Ortigas Center, Pasig City, Philippines',
      status: 'ACTIVE',
      defaultExpenseAccountId: expAcc?.id,
    },
  });

  // 4. Create Sample Sales Invoice and Purchase Bill
  const custId = custRes.data?.id;
  const vendId = vendRes.data?.id;

  if (custId && revAcc) {
    const siRes = await api('/api/accounting/sales-invoices', {
      method: 'POST',
      token,
      body: {
        customerId: custId,
        invoiceNumber: `SI-${def.id.slice(-2)}-0001`,
        invoiceDate: '2026-10-15',
        dueDate: '2026-11-15',
        reference: `ORD-${def.id.slice(-2)}-001`,
        totalAmount: 11200000,
        lines: [
          {
            description: `${def.tradeName} Professional & Operational Deliverable`,
            quantity: 1,
            unitPrice: 11200000,
            amount: 11200000,
            accountId: revAcc.id,
          },
        ],
      },
    });
    if (siRes.ok && siRes.data?.id) {
      await api(`/api/accounting/sales-invoices/${siRes.data.id}/submit`, { method: 'POST', token });
      await api(`/api/accounting/sales-invoices/${siRes.data.id}/approve`, { method: 'POST', token });
      await api(`/api/accounting/sales-invoices/${siRes.data.id}/post`, { method: 'POST', token });
    }
  }

  if (vendId && expAcc) {
    const pbRes = await api('/api/accounting/purchase-bills', {
      method: 'POST',
      token,
      body: {
        vendorId: vendId,
        billNumber: `BILL-${def.id.slice(-2)}-0001`,
        billDate: '2026-10-20',
        dueDate: '2026-11-20',
        reference: `SUP-${def.id.slice(-2)}-001`,
        totalAmount: 5600000,
        lines: [
          {
            accountId: expAcc.id,
            description: 'Direct Operating & Facility Maintenance Supplies',
            amount: 5600000,
          },
        ],
      },
    });
    if (pbRes.ok && pbRes.data?.id) {
      await api(`/api/accounting/purchase-bills/${pbRes.data.id}/submit`, { method: 'POST', token });
      await api(`/api/accounting/purchase-bills/${pbRes.data.id}/approve`, { method: 'POST', token });
      await api(`/api/accounting/purchase-bills/${pbRes.data.id}/post`, { method: 'POST', token });
    }
  }

  console.log(`[SEED] Initialized basic records for ${def.id}`);
}

async function main() {
  console.log('[PROVISION] Starting provision of remaining mandate companies (C, D, E, F)...');

  const existingRes = await api('/api/companies');
  const existingCompanies: any[] = Array.isArray(existingRes.data) ? existingRes.data : [];

  for (const def of MANDATE_COMPANIES) {
    const exists = existingCompanies.some((c) => c.id === def.id);
    if (exists) {
      console.log(`[SKIP] Company ${def.id} already exists.`);
      continue;
    }

    console.log(`\n[CREATING] ${def.id}: ${def.legalName} (${def.vatStatus} · RDO ${def.rdoCode})`);
    const createRes = await api('/api/companies/create-profile', {
      method: 'POST',
      body: {
        company: {
          id: def.id,
          legalName: def.legalName,
          tradeName: def.tradeName,
          tin: def.tin,
          industry: def.industry,
          branchCode: def.branchCode,
          address: def.address,
          classification: 'TEST',
        },
        tax: {
          vatStatus: def.vatStatus,
          taxpayerClassification: def.taxpayerClassification,
          rdoCode: def.rdoCode,
        },
        accounting: {
          fiscalYear: 2026,
          currency: 'PHP',
          accountingMethod: 'ACCRUAL',
        },
        admin: {
          email: def.adminEmail,
          password: def.adminPassword,
          displayName: def.adminName,
        },
      },
    });

    if (!createRes.ok) {
      console.error(`[ERROR] Failed to create ${def.id}:`, createRes.status, createRes.data);
      continue;
    }
    console.log(`[SUCCESS] Created ${def.id}`);

    // Login as admin
    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      body: {
        companyId: def.id,
        email: def.adminEmail,
        password: def.adminPassword,
      },
    });
    if (!loginRes.ok || !loginRes.data?.token) {
      console.error(`[ERROR] Login failed for ${def.id}:`, loginRes.status, loginRes.data);
      continue;
    }
    const token = loginRes.data.token;
    console.log(`[AUTH] Logged in as ${def.adminName}`);

    // Add secondary users
    for (const u of def.secondaryUsers) {
      const uRes = await api('/api/users', {
        method: 'POST',
        token,
        body: {
          email: u.email,
          password: u.password,
          displayName: u.displayName,
          role: u.role,
        },
      });
      console.log(`  Added user ${u.displayName} (${u.role}): ${uRes.status}`);
    }

    // Seed basic records
    await seedCompanyBasics(def, token);
  }

  // Update shortcut history to include all 6 Mandate Companies
  const shortcutHistoryPath = 'C:\\Users\\Couls\\AppData\\Roaming\\LedgerAI_Data\\shortcut_history.json';
  const nowIso = new Date().toISOString();
  
  const all6 = [
    {
      companyId: 'LGR-PH-2026-PCT-01',
      displayName: 'Pacific Crest Trading & Logistics Corp.',
      databasePath: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-PCT-01/database.lai',
      companyDirectory: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-PCT-01',
      databaseIdentity: 'LGR-PH-2026-PCT-01',
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: { schemaVersion: 21, latestSupportedVersion: 21, containerFormat: 'UNKNOWN', keyMode: 'LEGACY_DEV_KEY' },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
    {
      companyId: 'LGR-PH-2026-BPC-02',
      displayName: 'Bayanihan Prime Consultancy Services',
      databasePath: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-BPC-02/database.lai',
      companyDirectory: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-BPC-02',
      databaseIdentity: 'LGR-PH-2026-BPC-02',
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: { schemaVersion: 21, latestSupportedVersion: 21, containerFormat: 'UNKNOWN', keyMode: 'LEGACY_DEV_KEY' },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
    {
      companyId: 'LGR-PH-2026-8PCT-03',
      displayName: 'Archipelago Digital Creative Studio (8% Sole Prop)',
      databasePath: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-8PCT-03/database.lai',
      companyDirectory: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-8PCT-03',
      databaseIdentity: 'LGR-PH-2026-8PCT-03',
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: { schemaVersion: 21, latestSupportedVersion: 21, containerFormat: 'UNKNOWN', keyMode: 'LEGACY_DEV_KEY' },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
    {
      companyId: 'LGR-PH-2026-PROF-04',
      displayName: 'Vanguard Legal & Accounting Associates Corp.',
      databasePath: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-PROF-04/database.lai',
      companyDirectory: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-PROF-04',
      databaseIdentity: 'LGR-PH-2026-PROF-04',
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: { schemaVersion: 21, latestSupportedVersion: 21, containerFormat: 'UNKNOWN', keyMode: 'LEGACY_DEV_KEY' },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
    {
      companyId: 'LGR-PH-2026-MB-05',
      displayName: 'Visayas-Mindanao Express Haulers Inc.',
      databasePath: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-MB-05/database.lai',
      companyDirectory: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-MB-05',
      databaseIdentity: 'LGR-PH-2026-MB-05',
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: { schemaVersion: 21, latestSupportedVersion: 21, containerFormat: 'UNKNOWN', keyMode: 'LEGACY_DEV_KEY' },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
    {
      companyId: 'LGR-PH-2026-HV-06',
      displayName: 'Titan Distribution & Retail Network Corp.',
      databasePath: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-HV-06/database.lai',
      companyDirectory: 'C:/Users/Couls/Documents/LedgerAI Companies/LGR-PH-2026-HV-06',
      databaseIdentity: 'LGR-PH-2026-HV-06',
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: { schemaVersion: 21, latestSupportedVersion: 21, containerFormat: 'UNKNOWN', keyMode: 'LEGACY_DEV_KEY' },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
  ];

  try {
    fs.writeFileSync(shortcutHistoryPath, JSON.stringify(all6, null, 2), 'utf8');
    console.log(`[SHORTCUTS] Updated ${shortcutHistoryPath} with all 6 mandated companies.`);
  } catch (err: any) {
    console.warn(`[SHORTCUTS WARN] Could not update shortcut history: ${err?.message}`);
  }

  console.log('\n[COMPLETE] All 6 mandated companies ready for enterprise operation!');
}

main().catch((err) => {
  console.error('[PROVISION FAILED]', err);
  process.exit(1);
});
