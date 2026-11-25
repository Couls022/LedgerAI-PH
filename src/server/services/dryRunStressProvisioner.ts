/**
 * Full-System Dry-Run Stress Test & 2-Company Live Provisioner for LedgerAI PH
 *
 * Exercises:
 * 1. PC Server Console vs. Browser Client enforcement (server-only company creation)
 * 2. Live creation of 2 persistent Philippine company profiles (VAT Corp + Non-VAT Enterprise)
 * 3. Full multi-status dry-run across ALL 16 modules & sub-modules on both companies
 * 4. Notifications & Overdue Payment Reminders
 * 5. Ledger Agent AI Assistant (English + Tagalog queries + provider health test)
 * 6. 40-request concurrent cross-tenant stress burst
 */

const BASE_URL = process.env.LEDGERAI_BASE_URL || 'http://127.0.0.1:3000';

export interface CheckResult {
  module: string;
  scenario: string;
  companyId: string;
  status: 'PASS' | 'FAIL';
  httpStatus?: number;
  durationMs: number;
  detail?: string;
}

interface CompanySeedConfig {
  id: string;
  legalName: string;
  tradeName: string;
  tin: string;
  rdoCode: string;
  address: string;
  industry: string;
  taxpayerClassification: string;
  vatStatus: 'VAT' | 'NON_VAT';
  ownerEmail: string;
  ownerPassword: string;
  ownerName: string;
  extraUsers: Array<{
    displayName: string;
    email: string;
    password: string;
    role: string;
  }>;
}

export const PROVISIONED_COMPANIES: CompanySeedConfig[] = [
  {
    id: 'LGR-PH-2026-PCT-01',
    legalName: 'Pacific Crest Trading & Logistics Corp.',
    tradeName: 'Pacific Crest Logistics',
    tin: '408-912-345-00000',
    rdoCode: '044',
    address: '28F High Street South Corporate Plaza, BGC, Taguig City, Metro Manila',
    industry: 'Trading & Logistics',
    taxpayerClassification: 'CORPORATION',
    vatStatus: 'VAT',
    ownerEmail: 'owner@pacificcrest.ph',
    ownerPassword: 'LedgerPH!2026',
    ownerName: 'Gabriel Mendoza',
    extraUsers: [
      {
        displayName: 'Clarissa Santos, CPA',
        email: 'accountant@pacificcrest.ph',
        password: 'AcctPH!2026',
        role: 'Accountant',
      },
      {
        displayName: 'Ramon Villanueva',
        email: 'finance@pacificcrest.ph',
        password: 'FinPH!2026',
        role: 'Finance Manager',
      },
    ],
  },
  {
    id: 'LGR-PH-2026-BPC-02',
    legalName: 'Bayanihan Prime Consultancy Services',
    tradeName: 'Bayanihan Prime Advisory',
    tin: '219-654-882-00000',
    rdoCode: '039',
    address: '14F Eton Centris Cyberpod Three, Quezon Ave., Quezon City',
    industry: 'Services & Consulting',
    taxpayerClassification: 'SOLE_PROPRIETOR',
    vatStatus: 'NON_VAT',
    ownerEmail: 'owner@bayanihanprime.ph',
    ownerPassword: 'Bayanihan!2026',
    ownerName: 'Marisol Reyes',
    extraUsers: [
      {
        displayName: 'Paolo Dela Cruz',
        email: 'bookkeeper@bayanihanprime.ph',
        password: 'BookPH!2026',
        role: 'Bookkeeper',
      },
    ],
  },
];

async function httpJson(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; ok: boolean; data: any; durationMs: number }> {
  const start = Date.now();
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { rawText: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, data, durationMs: Date.now() - start };
}

export async function runFullDryRunStressSuite(): Promise<{
  passed: number;
  failed: number;
  results: CheckResult[];
  tokensByCompany: Record<string, string>;
}> {
  const results: CheckResult[] = [];
  const tokensByCompany: Record<string, string> = {};

  const record = (
    module: string,
    scenario: string,
    companyId: string,
    ok: boolean,
    httpStatus: number | undefined,
    durationMs: number,
    detail?: string
  ) => {
    results.push({
      module,
      scenario,
      companyId,
      status: ok ? 'PASS' : 'FAIL',
      httpStatus,
      durationMs,
      detail,
    });
  };

  // =========================================================================
  // 0. PC SERVER vs BROWSER CLIENT BOUNDARY CHECKS
  // =========================================================================
  {
    const srvMode = await httpJson('/api/companies/runtime-mode');
    record(
      'Server-Client Security',
      'PC Server Console loopback detection',
      'SYSTEM',
      srvMode.ok && srvMode.data?.isServerConsole === true && srvMode.data?.canCreateCompany === true,
      srvMode.status,
      srvMode.durationMs,
      JSON.stringify(srvMode.data)
    );

    const cliMode = await httpJson('/api/companies/runtime-mode', {
      headers: { 'X-Forwarded-For': '192.168.1.55' },
    });
    record(
      'Server-Client Security',
      'Browser Client remote detection',
      'SYSTEM',
      cliMode.ok && cliMode.data?.isServerConsole === false && cliMode.data?.canCreateCompany === false,
      cliMode.status,
      cliMode.durationMs,
      JSON.stringify(cliMode.data)
    );

    const remoteCreate = await httpJson('/api/companies/create-profile', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.168.1.55' },
      body: {
        company: { legalName: 'Unauthorized Client Corp' },
        admin: { email: 'hacker@client.local', password: 'Password123!' },
      },
    });
    record(
      'Server-Client Security',
      'Remote Browser Client blocked from POST /create-profile (403 SERVER_CONSOLE_ONLY)',
      'SYSTEM',
      remoteCreate.status === 403 && remoteCreate.data?.error === 'SERVER_CONSOLE_ONLY',
      remoteCreate.status,
      remoteCreate.durationMs,
      remoteCreate.data?.message
    );

    const remoteFolder = await httpJson('/api/companies/create-folder', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.168.1.55' },
      body: { parentPath: '/tmp', folderName: 'rogue' },
    });
    record(
      'Server-Client Security',
      'Remote Browser Client blocked from POST /create-folder (403 SERVER_CONSOLE_ONLY)',
      'SYSTEM',
      remoteFolder.status === 403 && remoteFolder.data?.error === 'SERVER_CONSOLE_ONLY',
      remoteFolder.status,
      remoteFolder.durationMs,
      remoteFolder.data?.message
    );
  }

  // =========================================================================
  // 1. CREATE & LOGIN BOTH PERSISTENT COMPANIES ON PC SERVER CONSOLE
  // =========================================================================
  for (const cfg of PROVISIONED_COMPANIES) {
    const existing = await httpJson(`/api/companies/${encodeURIComponent(cfg.id)}`);
    if (!existing.ok) {
      const createRes = await httpJson('/api/companies/create-profile', {
        method: 'POST',
        body: {
          company: {
            id: cfg.id,
            legalName: cfg.legalName,
            tradeName: cfg.tradeName,
            tin: cfg.tin,
            branchCode: '00000',
            address: cfg.address,
            contactPerson: cfg.ownerName,
            contactEmail: cfg.ownerEmail,
            contactPhone: '+63 2 8890-4500',
            industry: cfg.industry,
            classification: 'PRODUCTION',
          },
          tax: {
            taxpayerClassification: cfg.taxpayerClassification,
            taxpayerType: cfg.taxpayerClassification,
            vatStatus: cfg.vatStatus,
            rdoCode: cfg.rdoCode,
            birRegistrationNo: `OCN-${cfg.rdoCode}-2026-00188`,
            birDateRegistered: '2026-01-05',
          },
          accounting: {
            fiscalYear: 2026,
            fiscalYearStartMonth: 1,
            currency: 'PHP',
            accountingMethod: 'ACCRUAL',
            beginningBalances: [
              { accountCode: '1010', debit: 2500000, credit: 0 },
              { accountCode: '1020', debit: 50000, credit: 0 },
              { accountCode: '3010', debit: 0, credit: 2550000 },
            ],
          },
          admin: {
            displayName: cfg.ownerName,
            email: cfg.ownerEmail,
            password: cfg.ownerPassword,
          },
        },
      });
      record(
        'Company Provisioning',
        `Create ${cfg.vatStatus} Company (${cfg.legalName})`,
        cfg.id,
        createRes.ok,
        createRes.status,
        createRes.durationMs,
        createRes.ok ? `Created ${createRes.data?.companyId || cfg.id}` : JSON.stringify(createRes.data)
      );
    } else {
      record(
        'Company Provisioning',
        `Verify existing persistent company (${cfg.legalName})`,
        cfg.id,
        true,
        existing.status,
        existing.durationMs,
        'Already registered and active'
      );
    }

    // Verify Browser Client directory lists this company cleanly without server paths
    const clientList = await httpJson('/api/companies?availableOnly=true', {
      headers: { 'X-Forwarded-For': '192.168.1.88' },
    });
    const foundInClient = Array.isArray(clientList.data)
      ? clientList.data.find((c: any) => c.id === cfg.id)
      : null;
    record(
      'Company Provisioning',
      'Visible on Browser Client landing with server paths redacted',
      cfg.id,
      Boolean(foundInClient && !foundInClient.dbPath && !foundInClient.location && foundInClient.storageScope === 'SERVER_MANAGED'),
      clientList.status,
      clientList.durationMs,
      foundInClient ? `storageScope=${foundInClient.storageScope}` : 'Not found in client list'
    );

    // Authenticate as Owner
    const loginRes = await httpJson('/api/auth/login', {
      method: 'POST',
      body: {
        companyId: cfg.id,
        email: cfg.ownerEmail,
        password: cfg.ownerPassword,
      },
    });
    const token = loginRes.data?.token || '';
    tokensByCompany[cfg.id] = token;
    record(
      'Authentication & Session',
      `Owner Login (${cfg.ownerEmail})`,
      cfg.id,
      loginRes.ok && Boolean(token),
      loginRes.status,
      loginRes.durationMs,
      loginRes.ok ? `Role=${loginRes.data?.activeCompany?.role}` : JSON.stringify(loginRes.data)
    );
    if (!token) continue;

    // =========================================================================
    // 2. USERS, ROLES & RBAC
    // =========================================================================
    const existingUsersRes = await httpJson('/api/users', { token });
    const existingEmails = new Set(
      (Array.isArray(existingUsersRes.data) ? existingUsersRes.data : existingUsersRes.data?.users || []).map(
        (u: any) => String(u.email || '').toLowerCase()
      )
    );
    for (const extra of cfg.extraUsers) {
      if (!existingEmails.has(extra.email.toLowerCase())) {
        const uRes = await httpJson('/api/users', {
          method: 'POST',
          token,
          body: {
            displayName: extra.displayName,
            email: extra.email,
            password: extra.password,
            role: extra.role,
          },
        });
        record(
          'Users & RBAC',
          `Create user ${extra.email} (${extra.role})`,
          cfg.id,
          uRes.ok,
          uRes.status,
          uRes.durationMs,
          uRes.ok ? 'User created' : JSON.stringify(uRes.data)
        );
      }
    }
    const rbacMatrix = await httpJson('/api/rbac/matrix', { token });
    record('Users & RBAC', 'GET /api/rbac/matrix', cfg.id, rbacMatrix.ok, rbacMatrix.status, rbacMatrix.durationMs);

    // =========================================================================
    // 3. MASTER DATA (COA, Customers, Vendors, Banks, Departments, Projects)
    // =========================================================================
    const coaRes = await httpJson('/api/accounting/accounts', { token });
    const accountsList: any[] = Array.isArray(coaRes.data) ? coaRes.data : coaRes.data?.accounts || [];
    const findAcc = (code: string) => accountsList.find((a) => String(a.accountCode) === code);
    const cashAcc = findAcc('1010') || accountsList.find((a) => a.accountType === 'ASSET');
    const pettyCashAcc = findAcc('1020') || cashAcc;
    const arAcc = findAcc('1030');
    const invAcc = findAcc('1080');
    const equipAcc = findAcc('1510');
    const accumDepAcc = findAcc('1520');
    const apAcc = findAcc('2010');
    const revAcc = findAcc('4010');
    const cogsAcc = findAcc('5010');
    const rentAcc = findAcc('6020');
    const suppliesAcc = findAcc('6040');
    const depExpAcc = findAcc('6060');
    record(
      'Master Data & COA',
      'Load Chart of Accounts',
      cfg.id,
      coaRes.ok && accountsList.length >= 15,
      coaRes.status,
      coaRes.durationMs,
      `Accounts=${accountsList.length}`
    );

    const existingCusts = await httpJson('/api/master-data/customers', { token });
    const custList: any[] = Array.isArray(existingCusts.data)
      ? existingCusts.data
      : existingCusts.data?.items || existingCusts.data?.data || existingCusts.data?.customers || [];
    const ensureCustomer = async (code: string, legalName: string, tin: string, contactPerson: string, email: string) => {
      const found = custList.find((c) => c.code === code || c.legalName === legalName);
      if (found) return found;
      const r = await httpJson('/api/master-data/customers', {
        method: 'POST',
        token,
        body: {
          code,
          legalName,
          tradeName: legalName,
          tin,
          address: 'Makati City, Metro Manila',
          contactPerson,
          contactDetails: email,
          paymentTerms: 'NET_30',
          creditLimit: 500000,
        },
      });
      const created = r.data?.customer || r.data;
      if (r.ok && created?.id) custList.push(created);
      return created;
    };

    const cust1 = await ensureCustomer('CUST-001', 'Metro Ayala Retail Group Inc.', '008-451-209-00000', 'Elena Soriano', 'ap@metroayala.ph');
    const cust2 = await ensureCustomer('CUST-002', 'Cebu Visayas Distribution Corp.', '009-318-774-00000', 'Marco Lim', 'billing@cebuvisayas.ph');
    const cust3 = await ensureCustomer('CUST-003', 'Davao Agri-Cold Storage Ventures', '007-892-113-00000', 'Teresa Tan', 'finance@davaoagricold.ph');
    record(
      'Master Data & COA',
      'Provision Customers (Active Multi-Client Portfolio)',
      cfg.id,
      Boolean(cust1?.id && cust2?.id && cust3?.id),
      201,
      0,
      `Customers=${custList.length}`
    );

    const existingVendors = await httpJson('/api/master-data/vendors', { token });
    const vendList: any[] = Array.isArray(existingVendors.data)
      ? existingVendors.data
      : existingVendors.data?.items || existingVendors.data?.data || existingVendors.data?.vendors || [];
    const ensureVendor = async (code: string, legalName: string, tin: string, contactPerson: string, email: string) => {
      const found = vendList.find((v) => v.code === code || v.legalName === legalName);
      if (found) return found;
      const r = await httpJson('/api/master-data/vendors', {
        method: 'POST',
        token,
        body: {
          code,
          legalName,
          tradeName: legalName,
          tin,
          address: 'Ortigas Center, Pasig City',
          contactPerson,
          contactDetails: email,
          paymentTerms: 'NET_30',
          vatStatus: 'VAT',
          taxClassification: 'CORPORATION',
        },
      });
      const created = r.data?.vendor || r.data;
      if (r.ok && created?.id) vendList.push(created);
      return created;
    };

    const vend1 = await ensureVendor('VEND-001', 'Manila Port Freight & Customs Inc.', '004-219-880-00000', 'Lito Bautista', 'ar@manilaportfreight.ph');
    const vend2 = await ensureVendor('VEND-002', 'BGC Commercial Leasing Holdings', '005-672-411-00000', 'Grace Chua', 'leasing@bgcholdings.ph');
    record(
      'Master Data & COA',
      'Provision Vendors',
      cfg.id,
      Boolean(vend1?.id && vend2?.id),
      201,
      0,
      `Vendors=${vendList.length}`
    );

    const existingBanks = await httpJson('/api/master-data/banks', { token });
    const bankList: any[] = Array.isArray(existingBanks.data) ? existingBanks.data : existingBanks.data?.banks || [];
    let primaryBank = bankList[0];
    if (!primaryBank) {
      const bRes = await httpJson('/api/master-data/banks', {
        method: 'POST',
        token,
        body: {
          code: 'BDO-01',
          bankName: 'BDO Unibank Inc.',
          branch: 'BGC High Street Corporate',
          accountNumber: '0045-8821-9034',
          accountType: 'CHECKING',
          currency: 'PHP',
          glAccountId: cashAcc?.id,
        },
      });
      primaryBank = bRes.data?.bank || bRes.data;
      record('Master Data & COA', 'Create Primary Bank Account', cfg.id, bRes.ok, bRes.status, bRes.durationMs);
    }

    const deptRes = await httpJson('/api/master-data/departments', {
      method: 'POST',
      token,
      body: { code: 'OPS', name: 'Operations & Logistics', managerName: cfg.ownerName },
    });
    const projRes = await httpJson('/api/master-data/projects', {
      method: 'POST',
      token,
      body: { code: 'PRJ-2026-Q1', name: '2026 Nationwide Expansion', budgetAmount: 1500000 },
    });
    record(
      'Master Data & COA',
      'Departments & Projects Provisioning',
      cfg.id,
      (deptRes.ok || deptRes.status === 409) && (projRes.ok || projRes.status === 409),
      deptRes.status,
      deptRes.durationMs + projRes.durationMs
    );

    const periodsRes = await httpJson('/api/accounting/periods', { token });
    const periodsList: any[] = Array.isArray(periodsRes.data) ? periodsRes.data : periodsRes.data?.periods || [];
    const activePeriodId =
      periodsList.find((p) => p.status === 'OPEN' && String(p.periodName || p.name || '').includes('2026-02'))?.id ||
      periodsList.find((p) => p.status === 'OPEN')?.id ||
      periodsList[0]?.id;

    // Check if we already seeded transactions for this company (idempotent guard)
    const existingJournalsRes = await httpJson('/api/accounting/journals', { token });
    const existingJournals = Array.isArray(existingJournalsRes.data)
      ? existingJournalsRes.data
      : existingJournalsRes.data?.items || existingJournalsRes.data?.data || existingJournalsRes.data?.journals || [];
    const alreadySeeded = existingJournals.length >= 4;

    if (!alreadySeeded) {
      // =========================================================================
      // 4. GENERAL LEDGER & MANUAL JOURNALS (ALL SCENARIO STATUSES)
      // =========================================================================
      const createJe = async (num: string, date: string, desc: string, amtPesos: number, debitId: string, creditId: string) => {
        const amtCentavos = Math.round(amtPesos * 100);
        const r = await httpJson('/api/accounting/journals', {
          method: 'POST',
          token,
          body: {
            journalNumber: num,
            entryDate: date,
            description: desc,
            lines: [
              { accountId: debitId, debit: amtCentavos, credit: 0, description: desc },
              { accountId: creditId, debit: 0, credit: amtCentavos, description: desc },
            ],
          },
        });
        return { res: r, id: r.data?.id || r.data?.journal?.id };
      };

      // 4a. DRAFT Journal
      const jeDraft = await createJe('JE-2026-001', '2026-02-10', 'Draft Accrual for Q1 Office Supplies', 12500, suppliesAcc.id, apAcc.id);
      record('General Ledger', 'Journal Entry — DRAFT', cfg.id, jeDraft.res.ok, jeDraft.res.status, jeDraft.res.durationMs);

      // 4b. SUBMITTED (PENDING_APPROVAL) Journal
      const jeSub = await createJe('JE-2026-002', '2026-02-12', 'Pending Approval — Feb Facility Rent Accrual', 45000, rentAcc.id, apAcc.id);
      const jeSubAct = jeSub.id ? await httpJson(`/api/accounting/journals/${jeSub.id}/submit`, { method: 'POST', token }) : { ok: false, status: 400, durationMs: 0, data: null };
      record('General Ledger', 'Journal Entry — SUBMITTED / PENDING_APPROVAL', cfg.id, jeSubAct.ok, jeSubAct.status, jeSubAct.durationMs);

      // 4c. APPROVED Journal
      const jeApp = await createJe('JE-2026-003', '2026-02-14', 'Approved Pre-Posting Utility Adjustment', 18400, suppliesAcc.id, cashAcc.id);
      if (jeApp.id) {
        await httpJson(`/api/accounting/journals/${jeApp.id}/submit`, { method: 'POST', token });
        const appRes = await httpJson(`/api/accounting/journals/${jeApp.id}/approve`, { method: 'POST', token });
        record('General Ledger', 'Journal Entry — APPROVED', cfg.id, appRes.ok, appRes.status, appRes.durationMs);
      }

      // 4d. REJECTED Journal
      const jeRej = await createJe('JE-2026-004', '2026-02-15', 'Rejected Duplicate Supplies Reclass', 9800, suppliesAcc.id, cashAcc.id);
      if (jeRej.id) {
        await httpJson(`/api/accounting/journals/${jeRej.id}/submit`, { method: 'POST', token });
        const rejRes = await httpJson(`/api/accounting/journals/${jeRej.id}/reject`, {
          method: 'POST',
          token,
          body: { reason: 'Duplicate entry — already recorded via purchase bill.' },
        });
        record('General Ledger', 'Journal Entry — REJECTED', cfg.id, rejRes.ok, rejRes.status, rejRes.durationMs);
      }

      // 4e. POSTED Journal
      const jePost = await createJe('JE-2026-005', '2026-02-18', 'Posted Office Lease & Administrative Expense', 65000, rentAcc.id, cashAcc.id);
      if (jePost.id) {
        await httpJson(`/api/accounting/journals/${jePost.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/journals/${jePost.id}/approve`, { method: 'POST', token });
        const postRes = await httpJson(`/api/accounting/journals/${jePost.id}/post`, { method: 'POST', token });
        record('General Ledger', 'Journal Entry — POSTED', cfg.id, postRes.ok, postRes.status, postRes.durationMs);
      }

      // 4f. REVERSED Journal
      const jeRev = await createJe('JE-2026-006', '2026-02-20', 'Posted & Reversed Erroneous Petty Cash Transfer', 15000, pettyCashAcc.id, cashAcc.id);
      if (jeRev.id) {
        await httpJson(`/api/accounting/journals/${jeRev.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/journals/${jeRev.id}/approve`, { method: 'POST', token });
        await httpJson(`/api/accounting/journals/${jeRev.id}/post`, { method: 'POST', token });
        const revRes = await httpJson(`/api/accounting/journals/${jeRev.id}/reverse`, {
          method: 'POST',
          token,
          body: { reverseDate: '2026-02-21', newPeriodId: activePeriodId, reason: 'Reversing temporary petty cash top-up.' },
        });
        record('General Ledger', 'Journal Entry — REVERSED', cfg.id, revRes.ok, revRes.status, revRes.durationMs, revRes.ok ? 'Reversed cleanly' : JSON.stringify(revRes.data));
      }

      // 4g. VOIDED Journal
      const jeVoid = await createJe('JE-2026-007', '2026-02-22', 'Voided Draft Entry', 5000, suppliesAcc.id, cashAcc.id);
      if (jeVoid.id) {
        const voidRes = await httpJson(`/api/accounting/journals/${jeVoid.id}/void`, {
          method: 'POST',
          token,
          body: { reason: 'Cancelled before submission.' },
        });
        record('General Ledger', 'Journal Entry — VOIDED', cfg.id, voidRes.ok, voidRes.status, voidRes.durationMs);
      }

      // Resolve company tax codes for authentic BIR VAT (2550Q) vs Percentage Tax (2551Q) posting
      const taxCodesRes = await httpJson('/api/tax/codes', { token });
      const taxCodesList: any[] = Array.isArray(taxCodesRes.data)
        ? taxCodesRes.data
        : taxCodesRes.data?.codes || taxCodesRes.data?.data || [];
      const salesTaxCode = cfg.vatStatus === 'VAT'
        ? taxCodesList.find((t) => String(t.taxType || '').toUpperCase().includes('VAT') && String(t.inputOutputDirection || '').toUpperCase() === 'OUTPUT')
        : taxCodesList.find((t) => String(t.taxType || '').toUpperCase().includes('PERCENTAGE') || String(t.code || '').toUpperCase().includes('PT'));
      const purchaseTaxCode = cfg.vatStatus === 'VAT'
        ? taxCodesList.find((t) => String(t.taxType || '').toUpperCase().includes('VAT') && String(t.inputOutputDirection || '').toUpperCase() === 'INPUT')
        : undefined;

      // =========================================================================
      // 5. SALES & RECEIVABLES (ALL SCENARIO STATUSES + PAYMENTS + CREDIT MEMO)
      // =========================================================================
      const createInv = async (
        customerId: string,
        invoiceNumber: string,
        invoiceDate: string,
        dueDate: string,
        totalAmountPesos: number,
        desc: string
      ) => {
        const amtCentavos = Math.round(totalAmountPesos * 100);
        const r = await httpJson('/api/accounting/sales-invoices', {
          method: 'POST',
          token,
          body: {
            customerId,
            invoiceNumber,
            invoiceDate,
            dueDate,
            reference: `REF-${invoiceNumber}`,
            totalAmount: amtCentavos,
            lines: [
              {
                description: desc,
                quantity: 1,
                unitPrice: amtCentavos,
                amount: amtCentavos,
                accountId: revAcc?.id,
                ...(salesTaxCode?.id ? { taxCodeId: salesTaxCode.id, isTaxInclusive: true } : {}),
              },
            ],
          },
        });
        return { res: r, id: r.data?.id };
      };

      // 5a. DRAFT Sales Invoice
      const siDraft = await createInv(cust1.id, 'SI-2026-0001', '2026-03-01', '2026-03-31', 85000, 'Draft Logistics Retainer');
      record('Sales & Receivables', 'Sales Invoice — DRAFT', cfg.id, siDraft.res.ok, siDraft.res.status, siDraft.res.durationMs);

      // 5b. SUBMITTED Sales Invoice
      const siSub = await createInv(cust2.id, 'SI-2026-0002', '2026-03-02', '2026-04-01', 112000, 'Submitted Freight Consolidation');
      if (siSub.id) {
        const subR = await httpJson(`/api/accounting/sales-invoices/${siSub.id}/submit`, { method: 'POST', token });
        record('Sales & Receivables', 'Sales Invoice — SUBMITTED', cfg.id, subR.ok, subR.status, subR.durationMs);
      }

      // 5c. APPROVED Sales Invoice
      const siApp = await createInv(cust3.id, 'SI-2026-0003', '2026-03-03', '2026-04-02', 95000, 'Approved Cold Chain Advisory');
      if (siApp.id) {
        await httpJson(`/api/accounting/sales-invoices/${siApp.id}/submit`, { method: 'POST', token });
        const appR = await httpJson(`/api/accounting/sales-invoices/${siApp.id}/approve`, { method: 'POST', token });
        record('Sales & Receivables', 'Sales Invoice — APPROVED', cfg.id, appR.ok, appR.status, appR.durationMs);
      }

      // 5d. REJECTED Sales Invoice
      const siRej = await createInv(cust1.id, 'SI-2026-0004', '2026-03-04', '2026-04-03', 42000, 'Rejected Incorrect Pricing');
      if (siRej.id) {
        await httpJson(`/api/accounting/sales-invoices/${siRej.id}/submit`, { method: 'POST', token });
        const rejR = await httpJson(`/api/accounting/sales-invoices/${siRej.id}/reject`, {
          method: 'POST',
          token,
          body: { reason: 'Rate card mismatch with signed quotation.' },
        });
        record('Sales & Receivables', 'Sales Invoice — REJECTED', cfg.id, rejR.ok, rejR.status, rejR.durationMs);
      }

      // 5e. POSTED (OVERDUE) Sales Invoice (dueDate in past for Overdue Reminders & Aging!)
      const siOverdue = await createInv(cust1.id, 'SI-2026-0005', '2026-01-10', '2026-01-25', 224000, 'Q1 Supply Chain & Customs Clearance');
      if (siOverdue.id) {
        await httpJson(`/api/accounting/sales-invoices/${siOverdue.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/sales-invoices/${siOverdue.id}/approve`, { method: 'POST', token });
        const postR = await httpJson(`/api/accounting/sales-invoices/${siOverdue.id}/post`, { method: 'POST', token });
        record('Sales & Receivables', 'Sales Invoice — POSTED (OVERDUE)', cfg.id, postR.ok, postR.status, postR.durationMs);
      }

      // 5f. PARTIALLY_PAID Sales Invoice
      const siPartial = await createInv(cust2.id, 'SI-2026-0006', '2026-02-01', '2026-03-03', 168000, 'Regional Distribution Contract');
      if (siPartial.id) {
        await httpJson(`/api/accounting/sales-invoices/${siPartial.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/sales-invoices/${siPartial.id}/approve`, { method: 'POST', token });
        await httpJson(`/api/accounting/sales-invoices/${siPartial.id}/post`, { method: 'POST', token });
        const cp1 = await httpJson('/api/accounting/customer-payments', {
          method: 'POST',
          token,
          body: {
            customerId: cust2.id,
            paymentNumber: 'OR-2026-0001',
            officialReceiptNumber: 'OR-000101',
            paymentDate: '2026-02-15',
            cashAccountId: cashAcc.id,
            paymentMethod: 'BANK_TRANSFER',
            amount: 8400000,
            reference: 'BDO-TRX-88201',
            applications: [{ invoiceId: siPartial.id, appliedAmount: 8400000 }],
          },
        });
        if (cp1.ok && cp1.data?.id) {
          await httpJson(`/api/accounting/customer-payments/${cp1.data.id}/submit`, { method: 'POST', token });
          await httpJson(`/api/accounting/customer-payments/${cp1.data.id}/approve`, { method: 'POST', token });
          const cpPost = await httpJson(`/api/accounting/customer-payments/${cp1.data.id}/post`, { method: 'POST', token });
          record('Sales & Receivables', 'Sales Invoice — PARTIALLY_PAID via Customer Payment', cfg.id, cpPost.ok, cpPost.status, cpPost.durationMs, cpPost.ok ? '50% collected (₱84,000.00)' : JSON.stringify(cpPost.data));
        } else {
          record('Sales & Receivables', 'Sales Invoice — PARTIALLY_PAID via Customer Payment', cfg.id, false, cp1.status, cp1.durationMs, JSON.stringify(cp1.data));
        }
      }

      // 5g. FULLY PAID Sales Invoice
      const siPaid = await createInv(cust3.id, 'SI-2026-0007', '2026-02-05', '2026-03-07', 336000, 'Annual Enterprise Compliance Retainer');
      if (siPaid.id) {
        await httpJson(`/api/accounting/sales-invoices/${siPaid.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/sales-invoices/${siPaid.id}/approve`, { method: 'POST', token });
        await httpJson(`/api/accounting/sales-invoices/${siPaid.id}/post`, { method: 'POST', token });
        const cp2 = await httpJson('/api/accounting/customer-payments', {
          method: 'POST',
          token,
          body: {
            customerId: cust3.id,
            paymentNumber: 'OR-2026-0002',
            officialReceiptNumber: 'OR-000102',
            paymentDate: '2026-02-20',
            cashAccountId: cashAcc.id,
            paymentMethod: 'BANK_TRANSFER',
            amount: 33600000,
            reference: 'BDO-TRX-99104',
            applications: [{ invoiceId: siPaid.id, appliedAmount: 33600000 }],
          },
        });
        if (cp2.ok && cp2.data?.id) {
          await httpJson(`/api/accounting/customer-payments/${cp2.data.id}/submit`, { method: 'POST', token });
          await httpJson(`/api/accounting/customer-payments/${cp2.data.id}/approve`, { method: 'POST', token });
          const cpPost2 = await httpJson(`/api/accounting/customer-payments/${cp2.data.id}/post`, { method: 'POST', token });
          record('Sales & Receivables', 'Sales Invoice — PAID in Full', cfg.id, cpPost2.ok, cpPost2.status, cpPost2.durationMs, cpPost2.ok ? '100% collected (₱336,000.00)' : JSON.stringify(cpPost2.data));
        } else {
          record('Sales & Receivables', 'Sales Invoice — PAID in Full', cfg.id, false, cp2.status, cp2.durationMs, JSON.stringify(cp2.data));
        }
      }

      // 5g-Q4. Current Quarter (November 2026) Posted Sales Invoice for Live Q4 BIR Reporting
      const siNov = await createInv(cust1.id, 'SI-2026-0008', '2026-11-05', '2026-12-05', 280000, 'Q4 2026 National Supply Chain & Advisory Retainer');
      if (siNov.id) {
        await httpJson(`/api/accounting/sales-invoices/${siNov.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/sales-invoices/${siNov.id}/approve`, { method: 'POST', token });
        const postNov = await httpJson(`/api/accounting/sales-invoices/${siNov.id}/post`, { method: 'POST', token });
        record('Sales & Receivables', 'Sales Invoice — Q4 2026 POSTED (Current Quarter)', cfg.id, postNov.ok, postNov.status, postNov.durationMs);
      }

      // 5h. Credit Memo (POSTED)
      if (siOverdue.id) {
        const cmRes = await httpJson('/api/accounting/credit-memos', {
          method: 'POST',
          token,
          body: {
            customerId: cust1.id,
            creditMemoNumber: 'CM-2026-0001',
            memoDate: '2026-02-24',
            totalAmount: 1400000,
            reason: 'Volume rebate adjustment',
            lines: [
              {
                accountId: revAcc?.id,
                description: 'Volume rebate adjustment',
                quantity: 1,
                unitPrice: 1400000,
                amount: 1400000,
                ...(salesTaxCode?.id ? { taxCodeId: salesTaxCode.id, isTaxInclusive: true } : {}),
              },
            ],
            applications: [{ invoiceId: siOverdue.id, appliedAmount: 1400000 }],
          },
        });
        if (cmRes.ok && cmRes.data?.id) {
          const cmPost = await httpJson(`/api/accounting/credit-memos/${cmRes.data.id}/post`, { method: 'POST', token });
          record('Sales & Receivables', 'Credit Memo — POSTED', cfg.id, cmPost.ok, cmPost.status, cmPost.durationMs, cmPost.ok ? '₱14,000.00 credited' : JSON.stringify(cmPost.data));
        } else {
          record('Sales & Receivables', 'Credit Memo — POSTED', cfg.id, false, cmRes.status, cmRes.durationMs, JSON.stringify(cmRes.data));
        }
      }

      // =========================================================================
      // 6. PROCUREMENT & ACCOUNTS PAYABLE (PO + BILLS ALL STATUSES + DEBIT MEMO)
      // =========================================================================
      const poRes = await httpJson('/api/operations/procurement/purchase-orders', {
        method: 'POST',
        token,
        body: {
          vendorId: vend1.id,
          poNumber: 'PO-2026-0001',
          poDate: '2026-02-05',
          expectedDeliveryDate: '2026-02-15',
          expectedTotal: 112000,
          items: [{ description: 'Freight & Handling Pallets', quantity: 20, unitPrice: 5600 }],
        },
      });
      const poId = poRes.data?.poId || poRes.data?.id || poRes.data?.purchaseOrder?.id;
      if (poRes.ok && poId) {
        const recRes = await httpJson(`/api/operations/procurement/purchase-orders/${poId}/receive`, {
          method: 'POST',
          token,
          body: { receivedDate: '2026-02-12', notes: 'Complete delivery inspected.' },
        });
        record('Procurement & AP', 'Purchase Order — CREATED & RECEIVED', cfg.id, recRes.ok, recRes.status, recRes.durationMs, recRes.ok ? `PO ${poId} received` : JSON.stringify(recRes.data));
      } else {
        record('Procurement & AP', 'Purchase Order — CREATED & RECEIVED', cfg.id, false, poRes.status, poRes.durationMs, JSON.stringify(poRes.data));
      }

      const createBill = async (
        vendorId: string,
        billNumber: string,
        billDate: string,
        dueDate: string,
        totalAmountPesos: number,
        desc: string,
        expAccId: string
      ) => {
        const amtCentavos = Math.round(totalAmountPesos * 100);
        const r = await httpJson('/api/accounting/purchase-bills', {
          method: 'POST',
          token,
          body: {
            vendorId,
            billNumber,
            billDate,
            dueDate,
            reference: `VINV-${billNumber}`,
            totalAmount: amtCentavos,
            lines: [
              {
                accountId: expAccId,
                description: desc,
                amount: amtCentavos,
                ...(purchaseTaxCode?.id ? { taxCodeId: purchaseTaxCode.id, isTaxInclusive: true } : {}),
              },
            ],
          },
        });
        return { res: r, id: r.data?.id };
      };

      // 6a. DRAFT Bill
      const pbDraft = await createBill(vend1.id, 'BILL-2026-0001', '2026-03-01', '2026-03-31', 35000, 'Draft Brokerage Fee', cogsAcc.id);
      record('Procurement & AP', 'Purchase Bill — DRAFT', cfg.id, pbDraft.res.ok, pbDraft.res.status, pbDraft.res.durationMs);

      // 6b. SUBMITTED Bill
      const pbSub = await createBill(vend2.id, 'BILL-2026-0002', '2026-03-02', '2026-04-01', 78000, 'Submitted March Office Lease', rentAcc.id);
      if (pbSub.id) {
        const r = await httpJson(`/api/accounting/purchase-bills/${pbSub.id}/submit`, { method: 'POST', token });
        record('Procurement & AP', 'Purchase Bill — SUBMITTED', cfg.id, r.ok, r.status, r.durationMs);
      }

      // 6c. REJECTED Bill
      const pbRej = await createBill(vend1.id, 'BILL-2026-0003', '2026-03-03', '2026-04-02', 19500, 'Rejected Missing Delivery Receipt', suppliesAcc.id);
      if (pbRej.id) {
        await httpJson(`/api/accounting/purchase-bills/${pbRej.id}/submit`, { method: 'POST', token });
        const r = await httpJson(`/api/accounting/purchase-bills/${pbRej.id}/reject`, {
          method: 'POST',
          token,
          body: { reason: 'Missing signed delivery receipt for 3-way match.' },
        });
        record('Procurement & AP', 'Purchase Bill — REJECTED', cfg.id, r.ok, r.status, r.durationMs);
      }

      // 6d. POSTED (OVERDUE) Bill
      const pbOverdue = await createBill(vend1.id, 'BILL-2026-0004', '2026-01-12', '2026-02-01', 112000, 'Jan Customs & Freight Charges', cogsAcc.id);
      if (pbOverdue.id) {
        await httpJson(`/api/accounting/purchase-bills/${pbOverdue.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/purchase-bills/${pbOverdue.id}/approve`, { method: 'POST', token });
        const r = await httpJson(`/api/accounting/purchase-bills/${pbOverdue.id}/post`, { method: 'POST', token });
        record('Procurement & AP', 'Purchase Bill — POSTED (OVERDUE)', cfg.id, r.ok, r.status, r.durationMs);
      }

      // 6e. PAID Bill
      const pbPaid = await createBill(vend2.id, 'BILL-2026-0005', '2026-02-01', '2026-02-28', 89600, 'Feb Commercial Office Lease', rentAcc.id);
      if (pbPaid.id) {
        await httpJson(`/api/accounting/purchase-bills/${pbPaid.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/purchase-bills/${pbPaid.id}/approve`, { method: 'POST', token });
        await httpJson(`/api/accounting/purchase-bills/${pbPaid.id}/post`, { method: 'POST', token });
        const payRes = await httpJson(`/api/accounting/purchase-bills/${pbPaid.id}/pay`, {
          method: 'POST',
          token,
          body: {
            paymentDate: '2026-02-22',
            cashAccountId: cashAcc.id,
            amountCentavos: 8960000,
            amount: 8960000,
            paymentMethod: 'BANK_TRANSFER',
            reference: 'CV-2026-0005',
          },
        });
        record('Procurement & AP', 'Purchase Bill — PAID', cfg.id, payRes.ok, payRes.status, payRes.durationMs, payRes.ok ? 'Settled (₱89,600.00)' : JSON.stringify(payRes.data));
      }

      // 6e-Q4. Current Quarter (November 2026) Posted Purchase Bill for Q4 Input VAT / Expense Tracking
      const pbNov = await createBill(vend2.id, 'BILL-2026-0006', '2026-11-08', '2026-12-08', 112000, 'November 2026 Operations & Warehouse Lease', rentAcc.id);
      if (pbNov.id) {
        await httpJson(`/api/accounting/purchase-bills/${pbNov.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/purchase-bills/${pbNov.id}/approve`, { method: 'POST', token });
        const postPbNov = await httpJson(`/api/accounting/purchase-bills/${pbNov.id}/post`, { method: 'POST', token });
        record('Procurement & AP', 'Purchase Bill — Q4 2026 POSTED (Current Quarter)', cfg.id, postPbNov.ok, postPbNov.status, postPbNov.durationMs);
      }

      // 6f. Debit Memo (POSTED)
      if (pbOverdue.id) {
        const dmRes = await httpJson('/api/accounting/debit-memos', {
          method: 'POST',
          token,
          body: {
            vendorId: vend1.id,
            debitMemoNumber: 'DM-2026-0001',
            memoDate: '2026-02-25',
            totalAmount: 800000,
            reason: 'Damaged crate credit claim',
            lines: [
              {
                accountId: cogsAcc?.id,
                description: 'Damaged crate credit claim',
                quantity: 1,
                unitPrice: 800000,
                amount: 800000,
              },
            ],
            applications: [{ billId: pbOverdue.id, appliedAmount: 800000 }],
          },
        });
        if (dmRes.ok && dmRes.data?.id) {
          await httpJson(`/api/accounting/debit-memos/${dmRes.data.id}/submit`, { method: 'POST', token });
          await httpJson(`/api/accounting/debit-memos/${dmRes.data.id}/approve`, { method: 'POST', token });
          const dmPost = await httpJson(`/api/accounting/debit-memos/${dmRes.data.id}/post`, { method: 'POST', token });
          record('Procurement & AP', 'Debit Memo — POSTED', cfg.id, dmPost.ok, dmPost.status, dmPost.durationMs, dmPost.ok ? '₱8,000.00 debited' : JSON.stringify(dmPost.data));
        } else {
          record('Procurement & AP', 'Debit Memo — POSTED', cfg.id, false, dmRes.status, dmRes.durationMs, JSON.stringify(dmRes.data));
        }
      }

      // =========================================================================
      // 7. INVENTORY & WAREHOUSE
      // =========================================================================
      const invItem1 = await httpJson('/api/operations/inventory/items', {
        method: 'POST',
        token,
        body: {
          sku: 'SKU-RFID-100',
          name: 'RFID Logistics Tracking Scanner',
          category: 'Hardware',
          unitOfMeasure: 'UNIT',
          costingMethod: 'WEIGHTED_AVERAGE',
          unitCost: 4500,
          sellingPrice: 7200,
          quantityOnHand: 40,
          reorderPoint: 15,
          assetAccountId: invAcc?.id,
          cogsAccountId: cogsAcc?.id,
        },
      });
      const invItem2 = await httpJson('/api/operations/inventory/items', {
        method: 'POST',
        token,
        body: {
          sku: 'SKU-SEAL-200',
          name: 'Tamper-Evident Container Security Seals (Box)',
          category: 'Consumables',
          unitOfMeasure: 'BOX',
          costingMethod: 'FIFO',
          unitCost: 1200,
          sellingPrice: 2100,
          quantityOnHand: 8,
          reorderPoint: 20, // Intentionally below reorder point to trigger low-stock scenario!
          assetAccountId: invAcc?.id,
          cogsAccountId: cogsAcc?.id,
        },
      });
      const invItemId = invItem1.data?.id || invItem1.data?.item?.id;
      if (invItemId) {
        const adjRes = await httpJson('/api/operations/inventory/adjustments', {
          method: 'POST',
          token,
          body: {
            adjustmentNumber: 'ADJ-2026-001',
            adjustmentDate: '2026-02-26',
            itemId: invItemId,
            adjustmentType: 'INCREASE',
            quantity: 5,
            reason: 'Physical cycle count surplus',
            expenseAccountId: cogsAcc?.id,
          },
        });
        record('Inventory & Warehouse', 'Items (Normal + Low Stock) & Stock Adjustment', cfg.id, invItem1.ok && invItem2.ok && adjRes.ok, adjRes.status, adjRes.durationMs);
      } else {
        record('Inventory & Warehouse', 'Items & Stock Adjustment', cfg.id, false, invItem1.status, invItem1.durationMs, JSON.stringify(invItem1.data));
      }

      // =========================================================================
      // 8. CASH & BANKING + CHECKS + DEPOSITS + BANK RECONCILIATION
      // =========================================================================
      const ctRes = await httpJson('/api/accounting/cash-transactions', {
        method: 'POST',
        token,
        body: {
          accountId: cashAcc.id,
          type: 'DISBURSEMENT',
          amount: 1450000,
          transactionDate: '2026-02-24',
          reference: 'CDV-2026-001',
          description: 'Courier & Office Internet Subscription',
          offsetAccountId: suppliesAcc.id,
        },
      });
      if (ctRes.ok && ctRes.data?.id) {
        await httpJson(`/api/accounting/cash-transactions/${ctRes.data.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/cash-transactions/${ctRes.data.id}/approve`, { method: 'POST', token });
        const ctPost = await httpJson(`/api/accounting/cash-transactions/${ctRes.data.id}/post`, { method: 'POST', token });
        record('Cash & Banking', 'Cash Disbursement — POSTED', cfg.id, ctPost.ok, ctPost.status, ctPost.durationMs);
      } else {
        record('Cash & Banking', 'Cash Disbursement — POSTED', cfg.id, false, ctRes.status, ctRes.durationMs, JSON.stringify(ctRes.data));
      }

      const chk1 = await httpJson('/api/accounting/checks', {
        method: 'POST',
        token,
        body: {
          checkNumber: 'CHK-000101',
          checkDate: '2026-02-20',
          payeeName: 'Meralco Business Center',
          cashAccountId: cashAcc.id,
          amount: 2245000,
          voucherNumber: 'CV-2026-0101',
        },
      });
      const chk2 = await httpJson('/api/accounting/checks', {
        method: 'POST',
        token,
        body: {
          checkNumber: 'CHK-000102',
          checkDate: '2026-02-21',
          payeeName: 'Voided Test Payee',
          cashAccountId: cashAcc.id,
          amount: 500000,
          voucherNumber: 'CV-2026-0102',
        },
      });
      let chkOk = chk1.ok && chk2.ok;
      if (chk1.data?.id) {
        const cl = await httpJson(`/api/accounting/checks/${chk1.data.id}/clear`, { method: 'POST', token, body: { clearedDate: '2026-02-23' } });
        chkOk = chkOk && cl.ok;
      }
      if (chk2.data?.id) {
        const ca = await httpJson(`/api/accounting/checks/${chk2.data.id}/cancel`, { method: 'POST', token, body: { reason: 'Misprinted check leaf' } });
        chkOk = chkOk && ca.ok;
      }
      record('Cash & Banking', 'Checks — ISSUED, CLEARED & CANCELLED', cfg.id, chkOk, chk1.status, chk1.durationMs);

      const depRes = await httpJson('/api/accounting/bank-deposits', {
        method: 'POST',
        token,
        body: {
          depositNumber: 'DEP-2026-001',
          depositDate: '2026-02-25',
          toBankAccountId: cashAcc.id,
          fromCashAccountId: pettyCashAcc.id,
          totalAmount: 1000000,
          reference: 'BDO-SLIP-4490',
        },
      });
      if (depRes.ok && depRes.data?.id) {
        await httpJson(`/api/accounting/bank-deposits/${depRes.data.id}/submit`, { method: 'POST', token });
        await httpJson(`/api/accounting/bank-deposits/${depRes.data.id}/approve`, { method: 'POST', token });
        const dpPost = await httpJson(`/api/accounting/bank-deposits/${depRes.data.id}/post`, { method: 'POST', token });
        record('Cash & Banking', 'Bank Deposit — POSTED', cfg.id, dpPost.ok, dpPost.status, dpPost.durationMs);
      }

      const recCreate = await httpJson('/api/accounting/bank-reconciliations', {
        method: 'POST',
        token,
        body: {
          bankAccountId: cashAcc.id,
          statementDate: '2026-02-28',
          statementEndingBalance: 270000000,
          notes: 'February 2026 BDO Statement Reconciliation',
        },
      });
      record('Cash & Banking', 'Bank Reconciliation Session Created', cfg.id, recCreate.ok, recCreate.status, recCreate.durationMs);

      // =========================================================================
      // 9. FIXED ASSETS & DEPRECIATION
      // =========================================================================
      const faRes = await httpJson('/api/operations/fixed-assets', {
        method: 'POST',
        token,
        body: {
          assetTag: 'FA-2026-001',
          assetName: 'Enterprise Server Rack & UPS Power System',
          category: 'IT Equipment',
          acquisitionDate: '2026-01-15',
          acquisitionCost: 360000,
          salvageValue: 36000,
          usefulLifeMonths: 36,
          assetAccountId: equipAcc?.id,
          accumulatedDepAccountId: accumDepAcc?.id,
          depreciationExpenseAccountId: depExpAcc?.id,
        },
      });
      const depRun = await httpJson('/api/operations/depreciation/post', {
        method: 'POST',
        token,
        body: { depreciationDate: '2026-02-28', periodMonth: '2026-02' },
      });
      record(
        'Fixed Assets',
        'Register Asset & Post Monthly Depreciation',
        cfg.id,
        faRes.ok && (depRun.ok || depRun.status === 400),
        faRes.status,
        faRes.durationMs + depRun.durationMs,
        `Asset=${faRes.status}, DepPost=${depRun.status}`
      );

      // =========================================================================
      // 10. PAYROLL & HUMAN RESOURCES
      // =========================================================================
      const emp1 = await httpJson('/api/operations/payroll/employees', {
        method: 'POST',
        token,
        body: {
          employeeNo: 'EMP-2026-001',
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          email: 'juan.delacruz@company.ph',
          tin: '312-445-678-000',
          sssNo: '34-1234567-8',
          philhealthNo: '12-098765432-1',
          pagibigNo: '1234-5678-9012',
          position: 'Senior Accounting Manager',
          department: 'Finance',
          monthlyBasicSalary: 68000,
        },
      });
      const emp2 = await httpJson('/api/operations/payroll/employees', {
        method: 'POST',
        token,
        body: {
          employeeNo: 'EMP-2026-002',
          firstName: 'Maria',
          lastName: 'Clara',
          email: 'maria.clara@company.ph',
          tin: '312-998-112-000',
          sssNo: '34-7654321-0',
          philhealthNo: '12-112233445-6',
          pagibigNo: '9876-5432-1098',
          position: 'Logistics Coordinator',
          department: 'Operations',
          monthlyBasicSalary: 28000,
        },
      });
      const payProc = await httpJson('/api/operations/payroll/process', {
        method: 'POST',
        token,
        body: {
          payrollPeriod: '2026-02-2H',
          startDate: '2026-02-16',
          endDate: '2026-02-28',
          paymentDate: '2026-02-28',
          isMonthly: false,
        },
      });
      record(
        'Payroll & HR',
        'Provision Employees & Process Statutory Payroll Run (SSS/PHIC/HDMF/WHT)',
        cfg.id,
        emp1.ok && emp2.ok && payProc.ok,
        payProc.status,
        payProc.durationMs,
        payProc.ok ? 'Payroll processed' : JSON.stringify(payProc.data)
      );

      // =========================================================================
      // 11. MULTI-CURRENCY & FOREX
      // =========================================================================
      const fxRate = await httpJson('/api/operations/forex/rates', {
        method: 'POST',
        token,
        body: {
          rateDate: '2026-02-28',
          currency: 'USD',
          bspSpotRate: 57.85,
          source: 'BSP_REFERENCE',
        },
      });
      record('Multi-Currency & Forex', 'Register BSP USD/PHP Exchange Rate', cfg.id, fxRate.ok, fxRate.status, fxRate.durationMs, fxRate.ok ? 'USD/PHP=57.85' : JSON.stringify(fxRate.data));

      // =========================================================================
      // 12. BUDGETS & FINANCIAL PLANNING
      // =========================================================================
      const budRes = await httpJson('/api/budgets', {
        method: 'POST',
        token,
        body: {
          periodMonth: '2026-02',
          items: [
            { accountId: revAcc.id, budgetAmount: 850000 },
            { accountId: rentAcc.id, budgetAmount: 120000 },
            { accountId: suppliesAcc.id, budgetAmount: 45000 },
          ],
        },
      });
      record('Budget & Planning', 'Create Monthly Operating Budget', cfg.id, budRes.ok, budRes.status, budRes.durationMs);

      // =========================================================================
      // 13. DOCUMENTS & OCR
      // =========================================================================
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const docRes = await httpJson('/api/documents', {
        method: 'POST',
        token,
        body: {
          fileName: `Official_Receipt_${cfg.id}.png`,
          fileType: 'image/png',
          documentType: 'RECEIPT',
          entityType: 'PURCHASE_BILL',
          entityId: pbPaid.id || 'NONE',
          fileContentBase64: tinyPngBase64,
          autoOcr: true,
          notes: 'Scanned BIR Official Receipt for February Office Lease',
        },
      });
      const docId = docRes.data?.id || docRes.data?.document?.id;
      let ocrReviewOk = docRes.ok;
      if (docId) {
        const revDoc = await httpJson(`/api/documents/${docId}/ocr-review`, {
          method: 'PUT',
          token,
          body: {
            ocrStatus: 'VERIFIED',
            vendorName: 'BGC Commercial Leasing Holdings',
            documentNumber: 'OR-88412',
            totalAmount: 89600,
            vatAmount: 9600,
          },
        });
        ocrReviewOk = ocrReviewOk && revDoc.ok;
      }
      record('Documents & OCR', 'Upload Document, Run OCR & Verify', cfg.id, ocrReviewOk, docRes.status, docRes.durationMs);

      // =========================================================================
      // 14. APPROVALS & WORKFLOW CENTER (ALL STATUSES)
      // =========================================================================
      const apr1 = await httpJson('/api/approval/requests', {
        method: 'POST',
        token,
        body: { actionType: 'CAPEX_PURCHASE', amountPHP: 250000, details: 'Pending Approval — New Delivery Van Downpayment' },
      });
      const apr2 = await httpJson('/api/approval/requests', {
        method: 'POST',
        token,
        body: { actionType: 'VENDOR_PAYMENT', amountPHP: 112000, details: 'Approved — Q1 Customs Brokerage Settlement' },
      });
      if (apr2.data?.id) {
        await httpJson(`/api/approval/requests/${apr2.data.id}/action`, {
          method: 'POST',
          token,
          body: { status: 'APPROVED', comments: 'Verified against PO and GRN.' },
        });
      }
      const apr3 = await httpJson('/api/approval/requests', {
        method: 'POST',
        token,
        body: { actionType: 'EXPENSE_REIMBURSEMENT', amountPHP: 38500, details: 'Rejected — Unreceipted Travel Claim' },
      });
      if (apr3.data?.id) {
        await httpJson(`/api/approval/requests/${apr3.data.id}/action`, {
          method: 'POST',
          token,
          body: { status: 'REJECTED', comments: 'Please attach official BIR receipts.' },
        });
      }
      const apr4 = await httpJson('/api/approval/requests', {
        method: 'POST',
        token,
        body: { actionType: 'BUDGET_REALLOCATION', amountPHP: 50000, details: 'Cancelled — Superseded by Q2 Budget' },
      });
      if (apr4.data?.id) {
        await httpJson(`/api/approval/requests/${apr4.data.id}/cancel`, { method: 'POST', token });
      }
      record(
        'Approvals & Workflow',
        'Approval Requests — PENDING, APPROVED, REJECTED, CANCELLED',
        cfg.id,
        apr1.ok && apr2.ok && apr3.ok && apr4.ok,
        apr1.status,
        apr1.durationMs
      );

      // =========================================================================
      // 15. AUDIT & GOVERNANCE (ENGAGEMENTS, WORKPAPERS, FINDINGS)
      // =========================================================================
      const engRes = await httpJson('/api/audit-engagements', {
        method: 'POST',
        token,
        body: {
          clientCompanyId: cfg.id,
          engagementName: 'FY2026 Q1 Statutory & Internal Controls Audit',
          auditPeriod: '2026-Q1',
          engagementType: 'INTERNAL',
          materiality: 250000,
          performanceMateriality: 187500,
          trivialThreshold: 12500,
          notes: 'Full review of Revenue Recognition, BIR VAT/WHT filings, and Cash Controls.',
        },
      });
      const wpRes = await httpJson('/api/audit/workpapers', {
        method: 'POST',
        token,
        body: {
          title: 'Cash & Bank Reconciliation Cutoff Workpaper',
          referenceCode: 'WP-A100',
          category: 'CASH_BANKING',
          preparedBy: cfg.ownerName,
          notes: 'Verified BDO February statement against GL 1010.',
        },
      });
      if (wpRes.data?.id) {
        await httpJson(`/api/audit/workpapers/${wpRes.data.id}/signoff`, {
          method: 'POST',
          token,
          body: { signOffStatus: 'APPROVED', notes: 'Reviewed and signed off.' },
        });
      }
      const fnd1 = await httpJson('/api/audit/findings', {
        method: 'POST',
        token,
        body: {
          title: 'Overdue Customer Invoices Exceeding 30-Day Credit Terms',
          condition: 'One customer invoice remains uncollected beyond 30 days.',
          criteria: 'Company AR Credit Policy Section 4.2',
          cause: 'Automated payment reminders were pending review.',
          effect: 'Elevated working capital lockup.',
          riskRating: 'MEDIUM',
          recommendation: 'Dispatch automated overdue reminders weekly.',
        },
      });
      const fnd2 = await httpJson('/api/audit/findings', {
        method: 'POST',
        token,
        body: {
          title: 'Vendor 3-Way Match Documentation Verified',
          condition: 'Missing GRN on one draft vendor bill caught by approval gate.',
          criteria: 'Procurement SOP 3.1',
          cause: 'Warehouse upload delay.',
          effect: 'Bill properly rejected prior to GL posting.',
          riskRating: 'LOW',
          recommendation: 'Maintain mandatory 3-way match enforcement.',
        },
      });
      if (fnd2.data?.id) {
        await httpJson(`/api/audit/findings/${fnd2.data.id}/status`, {
          method: 'POST',
          token,
          body: { status: 'RESOLVED' },
        });
      }
      record(
        'Audit & Governance',
        'Audit Engagement, Signed Workpaper, Findings (OPEN & RESOLVED)',
        cfg.id,
        engRes.ok && wpRes.ok && fnd1.ok && fnd2.ok,
        engRes.status,
        engRes.durationMs,
        engRes.ok ? 'Engagement + Workpaper + 2 Findings created' : JSON.stringify(engRes.data)
      );

      // =========================================================================
      // 16. ELECTRONIC BIR TAX FILING LIFECYCLE (DRAFT -> VALIDATED -> PACKAGED -> SIGNED -> SUBMIT)
      // =========================================================================
      const filingType = cfg.vatStatus === 'VAT' ? '2550Q' : '2551Q';
      const efCreate = await httpJson('/api/filing', {
        method: 'POST',
        token,
        body: {
          filingType,
          reportingPeriod: '2026-Q1',
          payloadData: {
            companyId: cfg.id,
            filingType,
            reportingPeriod: '2026-Q1',
            tin: cfg.tin,
            rdoCode: cfg.rdoCode,
            taxableSales: 728000,
            taxDue: cfg.vatStatus === 'VAT' ? 87360 : 21840,
          },
        },
      });
      const efId = efCreate.data?.id || efCreate.data?.filing?.id;
      let efOk = efCreate.ok;
      let efStage = `create=${efCreate.status}`;
      if (efId) {
        const v = await httpJson(`/api/filing/${efId}/validate`, { method: 'POST', token });
        const p = await httpJson(`/api/filing/${efId}/package`, { method: 'POST', token });
        const s = await httpJson(`/api/filing/${efId}/sign`, {
          method: 'POST',
          token,
          body: { certificateData: `BIR-CERT-${cfg.id}-2026` },
        });
        const sub = await httpJson(`/api/filing/${efId}/submit`, { method: 'POST', token });
        efStage += ` validate=${v.status} package=${p.status} sign=${s.status} submit=${sub.status}(${sub.data?.status || ''})`;
        efOk = efOk && v.ok && p.ok && s.ok && sub.ok;
      }
      record('Tax & BIR Compliance', `Electronic Filing ${filingType} Full Lifecycle (Create->Validate->Package->Sign->Submit)`, cfg.id, efOk, efCreate.status, efCreate.durationMs, efStage);
    }

    // =========================================================================
    // 17. COMPREHENSIVE READ & ANALYTICS VERIFICATION ACROSS ALL 16 MODULES
    // =========================================================================
    const readChecks: Array<[string, string, string]> = [
      ['Dashboard', 'GET /api/dashboard/overview', '/api/dashboard/overview'],
      ['Operations', 'GET /api/operations/summary', '/api/operations/summary'],
      ['Sales & Receivables', 'GET /api/accounting/sales-invoices', '/api/accounting/sales-invoices'],
      ['Sales & Receivables', 'GET /api/accounting/customer-payments', '/api/accounting/customer-payments'],
      ['Sales & Receivables', 'GET /api/accounting/credit-memos', '/api/accounting/credit-memos'],
      ['Sales & Receivables', 'GET /api/accounting/ar-aging', '/api/accounting/ar-aging'],
      ['Procurement & AP', 'GET /api/operations/procurement/purchase-orders', '/api/operations/procurement/purchase-orders'],
      ['Procurement & AP', 'GET /api/accounting/purchase-bills', '/api/accounting/purchase-bills'],
      ['Procurement & AP', 'GET /api/accounting/debit-memos', '/api/accounting/debit-memos'],
      ['Inventory & Warehouse', 'GET /api/operations/inventory/items', '/api/operations/inventory/items'],
      ['Inventory & Warehouse', 'GET /api/operations/inventory/valuation', '/api/operations/inventory/valuation'],
      ['Cash & Banking', 'GET /api/accounting/cash-transactions', '/api/accounting/cash-transactions'],
      ['Cash & Banking', 'GET /api/accounting/checks', '/api/accounting/checks'],
      ['Cash & Banking', 'GET /api/accounting/bank-deposits', '/api/accounting/bank-deposits'],
      ['Cash & Banking', 'GET /api/accounting/bank-reconciliations', '/api/accounting/bank-reconciliations'],
      ['Cash & Banking', 'GET /api/accounting/cashbook', `/api/accounting/cashbook?cashAccountId=${encodeURIComponent(cashAcc.id)}`],
      ['General Ledger', 'GET /api/accounting/journals', '/api/accounting/journals'],
      ['General Ledger', 'GET /api/accounting/periods', '/api/accounting/periods'],
      ['General Ledger', 'GET /api/accounting/integrity-check', '/api/accounting/integrity-check'],
      ['Fixed Assets', 'GET /api/operations/fixed-assets', '/api/operations/fixed-assets'],
      ['Payroll & HR', 'GET /api/operations/payroll/employees', '/api/operations/payroll/employees'],
      ['Multi-Currency & Forex', 'GET /api/operations/forex/rates', '/api/operations/forex/rates'],
      ['Tax & BIR Compliance', 'GET /api/tax/dashboard-summary', '/api/tax/dashboard-summary'],
      ['Tax & BIR Compliance', 'GET /api/tax/engine/active-profile', '/api/tax/engine/active-profile'],
      ['Tax & BIR Compliance', 'GET /api/tax/atc-directory', '/api/tax/atc-directory'],
      ['Tax & BIR Compliance', 'GET /api/tax/2307/workspace', '/api/tax/2307/workspace'],
      ['Tax & BIR Compliance', 'GET /api/filing', '/api/filing'],
      ['Budget & Planning', 'GET /api/budgets', '/api/budgets'],
      ['Documents & OCR', 'GET /api/documents', '/api/documents'],
      ['Documents & OCR', 'GET /api/documents/diagnostics/audit', '/api/documents/diagnostics/audit'],
      ['Approvals & Workflow', 'GET /api/approval/requests', '/api/approval/requests'],
      ['Audit & Governance', 'GET /api/audit', '/api/audit'],
      ['Audit & Governance', 'GET /api/audit/verify-chain', '/api/audit/verify-chain'],
      ['Audit & Governance', 'GET /api/audit-engagements', '/api/audit-engagements'],
      ['Audit & Governance', 'GET /api/audit/workpapers', '/api/audit/workpapers'],
      ['Audit & Governance', 'GET /api/audit/findings', '/api/audit/findings'],
      ['Reports & BI', 'GET /api/reports/trial-balance', '/api/reports/trial-balance'],
      ['Reports & BI', 'GET /api/reports/income-statement', '/api/reports/income-statement'],
      ['Reports & BI', 'GET /api/reports/balance-sheet', '/api/reports/balance-sheet'],
      ['Reports & BI', 'GET /api/reports/cash-flow', '/api/reports/cash-flow'],
      ['Reports & BI', 'GET /api/reports/general-ledger', '/api/reports/general-ledger'],
      ['Reports & BI', 'GET /api/reports/ar-aging', '/api/reports/ar-aging'],
      ['Reports & BI', 'GET /api/reports/ap-aging', '/api/reports/ap-aging'],
      ['Reports & BI', 'GET /api/reports/integrity-check', '/api/reports/integrity-check'],
      ['Reports & BI', 'GET /api/bi/dashboard', '/api/bi/dashboard'],
      ['Reports & BI', 'GET /api/bi/analytics', '/api/bi/analytics'],
      ['Backup & Settings', 'GET /api/backup/status', '/api/backup/status'],
      ['Backup & Settings', 'GET /api/licensing/status', '/api/licensing/status'],
      ['Backup & Settings', 'GET /api/lan/server-info', '/api/lan/server-info'],
    ];

    for (const [mod, label, endpoint] of readChecks) {
      const r = await httpJson(endpoint, { token });
      let extraOk = r.ok;
      let detail = '';
      if (endpoint === '/api/reports/trial-balance' && r.ok) {
        const td = Number(r.data?.totalDebits ?? r.data?.totals?.totalDebit ?? 0);
        const tc = Number(r.data?.totalCredits ?? r.data?.totals?.totalCredit ?? 0);
        const balanced = Math.abs(td - tc) < 0.02;
        extraOk = extraOk && balanced;
        detail = `Debits=${td}, Credits=${tc}, Balanced=${balanced}`;
      }
      if (endpoint === '/api/audit/verify-chain' && r.ok) {
        const valid = r.data?.valid !== false && r.data?.isValid !== false;
        extraOk = extraOk && valid;
        detail = `ChainValid=${valid}`;
      }
      record(mod, label, cfg.id, extraOk, r.status, r.durationMs, detail || (!r.ok ? JSON.stringify(r.data).slice(0, 180) : undefined));
    }

    // =========================================================================
    // 17B. SINGLE SOURCE-OF-TRUTH CROSS-MODULE RECONCILIATION VERIFICATION
    // =========================================================================
    {
      const [dashR, repSumR, tbR, biR] = await Promise.all([
        httpJson('/api/dashboard/overview', { token }),
        httpJson('/api/reports/summary', { token }),
        httpJson('/api/reports/trial-balance', { token }),
        httpJson('/api/bi/analytics', { token }),
      ]);

      const dash = dashR.data || {};
      const repSum = repSumR.data || {};
      const tb = tbR.data || {};
      const bi = biR.data || {};
      const recon = dash.reconciliationSummary || {};

      // 1. Zero AR/AP GL-to-subledger variance & 100% control health
      const zeroVarianceOk =
        dashR.ok &&
        recon.tbBalanced === true &&
        recon.postingIntegrityOk === true &&
        Number(recon.arVarianceCentavos) === 0 &&
        Number(recon.apVarianceCentavos) === 0 &&
        dash.complianceStatus === 'Reconciled & Active';
      record(
        'Source-of-Truth Reconciliation',
        'Zero AR/AP GL-to-Subledger Variance & 100% Control Health',
        cfg.id,
        zeroVarianceOk,
        dashR.status,
        dashR.durationMs,
        `status=${dash.complianceStatus}, arVar=${recon.arVarianceCentavos}, apVar=${recon.apVarianceCentavos}, postingOk=${recon.postingIntegrityOk}`
      );

      // 2. Opening Cash + Transactions Match Across Dashboard & BI Analytics
      const dashCash = Number(dash.cashBalance || 0);
      const biCash = Number(bi.cashFlow?.cashBalance || 0);
      const cashMatchOk = dashCash > 250_000_000 && dashCash === biCash; // > ₱2.5M opening cash preserved
      record(
        'Source-of-Truth Reconciliation',
        'Cash Position Parity (Dashboard === BI Analytics, Opening Capital Intact)',
        cfg.id,
        cashMatchOk,
        200,
        0,
        `DashboardCash=${dashCash}, BICash=${biCash}`
      );

      // 3. AR & AP Subledger Parity Across Dashboard, GL Control & BI Analytics
      const arParityOk =
        Number(dash.accountsReceivable) === Number(recon.arGlControlCentavos) &&
        Number(dash.accountsReceivable) === Number(bi.aging?.accountsReceivableTotal);
      const apParityOk =
        Number(dash.accountsPayable) === Number(recon.apGlControlCentavos) &&
        Number(dash.accountsPayable) === Number(bi.aging?.accountsPayableTotal);
      record(
        'Source-of-Truth Reconciliation',
        'AR & AP Parity (Dashboard === GL Control === BI Analytics)',
        cfg.id,
        arParityOk && apParityOk,
        200,
        0,
        `AR=${dash.accountsReceivable}/${bi.aging?.accountsReceivableTotal}, AP=${dash.accountsPayable}/${bi.aging?.accountsPayableTotal}`
      );

      // 4. Net Operating Margin Parity Across Dashboard, Reports Summary & BI Analytics
      const dashMargin = Number(dash.summaryStats?.avgProfitMargin || 0);
      const repMargin = Number(repSum.netProfitMargin || 0);
      const biMargin = Number(bi.margins?.netProfitMarginPercentage || 0);
      const marginParityOk =
        Math.abs(dashMargin - repMargin) <= 0.15 &&
        Math.abs(dashMargin - biMargin) <= 0.15 &&
        Number.isFinite(dashMargin);
      record(
        'Source-of-Truth Reconciliation',
        'Net Operating Margin Parity (Dashboard === Reports === BI Analytics)',
        cfg.id,
        marginParityOk,
        200,
        0,
        `Dashboard=${dashMargin}%, Reports=${repMargin}%, BI=${biMargin}%`
      );

      // 5. Inventory Adjustment Hit 1080/1300 Merchandise Inventory (Zero Phantom Balance on 1040 Allowance for Doubtful Accounts)
      const tbAccounts: any[] = Array.isArray(tb) ? tb : Array.isArray(tb.accounts) ? tb.accounts : Array.isArray(tb.data) ? tb.data : [];
      const acc1040 = tbAccounts.find((a) => String(a.accountCode) === '1040');
      const acc1040Net = acc1040 ? Math.abs(Number(acc1040.debitTotal ?? acc1040.totalDebit ?? 0) - Number(acc1040.creditTotal ?? acc1040.totalCredit ?? 0)) : 0;
      const accInv = tbAccounts.find((a) => String(a.accountCode) === '1080' || String(a.accountCode) === '1300');
      const accInvNet = accInv ? Math.abs(Number(accInv.debitTotal ?? accInv.totalDebit ?? 0) - Number(accInv.creditTotal ?? accInv.totalCredit ?? 0)) : 0;
      const invOk = cfg.industry === 'Trading & Logistics' ? (acc1040Net === 0 && accInvNet > 0) : (acc1040Net === 0);
      record(
        'Source-of-Truth Reconciliation',
        'Inventory Posting Integrity (1080/1300 Merchandise Inventory > 0, 1040 Allowance === 0)',
        cfg.id,
        invOk,
        tbR.status,
        0,
        `1040Net=${acc1040Net}, InvNet=${accInvNet}`
      );

      // 6. Tax Regime Parity (VAT 2550Q vs Non-VAT 2551Q)
      const taxEst = dash.taxEstimate || {};
      const taxOk = cfg.vatStatus === 'VAT'
        ? Number(taxEst.outputVat || 0) > 0 && Number(taxEst.inputVat || 0) > 0 && Number(taxEst.estimatedTaxLiability || 0) > 0 && String(taxEst.primaryForm || '').includes('2550Q')
        : Number(taxEst.percentageTaxPayable || 0) > 0 && Number(taxEst.estimatedTaxLiability || 0) > 0 && Number(taxEst.percentageTaxRate) === 3 && String(taxEst.primaryForm || '').includes('2551Q');
      record(
        'Source-of-Truth Reconciliation',
        `BIR Tax Engine Accuracy (${cfg.vatStatus === 'VAT' ? '2550Q VAT Output/Input' : '2551Q 3% Percentage Tax'})`,
        cfg.id,
        taxOk,
        200,
        0,
        JSON.stringify({
          vatStatus: taxEst.vatStatus,
          primaryForm: taxEst.primaryForm,
          outputVat: taxEst.outputVat,
          inputVat: taxEst.inputVat,
          percentageTaxPayable: taxEst.percentageTaxPayable,
          estimatedTaxLiability: taxEst.estimatedTaxLiability,
        })
      );
    }

    // =========================================================================
    // 18. NOTIFICATIONS & OVERDUE REMINDERS
    // =========================================================================
    const nTest = await httpJson('/api/notifications/test', {
      method: 'POST',
      token,
      body: {
        title: `Dry-Run Stress Check — ${cfg.tradeName}`,
        message: 'All 16 modules, approval gates, and BIR compliance controls verified active.',
        type: 'SYSTEM',
      },
    });
    const overdueRes = await httpJson('/api/notifications/overdue-invoices', { token });
    const remindRes = await httpJson('/api/notifications/reminders/send', {
      method: 'POST',
      token,
      body: { sendAll: false },
    });
    const nList = await httpJson('/api/notifications', { token });
    let markReadOk = true;
    if (Array.isArray(nList.data) && nList.data.length > 0) {
      const firstId = nList.data[nList.data.length - 1].id;
      const mr = await httpJson(`/api/notifications/${firstId}/read`, { method: 'PATCH', token });
      markReadOk = mr.ok;
    }
    record(
      'Notifications & Reminders',
      'Broadcast Alert, Overdue Preview, Payment Reminder Dispatch, Read State',
      cfg.id,
      nTest.ok && overdueRes.ok && remindRes.ok && nList.ok && markReadOk && Array.isArray(nList.data) && nList.data.length >= 2,
      nList.status,
      nTest.durationMs + remindRes.durationMs,
      `Notifications=${Array.isArray(nList.data) ? nList.data.length : 0}, Overdue=${Array.isArray(overdueRes.data) ? overdueRes.data.length : 0}`
    );

    // =========================================================================
    // 19. LEDGER AGENT AI ASSISTANT (ENGLISH + TAGALOG + PROVIDER HEALTH)
    // =========================================================================
    const aiSettings = await httpJson('/api/ai/settings', { token });
    const aiProvTest = await httpJson('/api/ai/providers/test', {
      method: 'POST',
      token,
      body: { providerId: 'offline_local' },
    });
    record(
      'Ledger Agent AI Assistant',
      'AI Settings & Offline Deterministic Engine Provider Health Test',
      cfg.id,
      aiSettings.ok && aiProvTest.ok,
      aiProvTest.status,
      aiProvTest.durationMs
    );

    const aiPrompts = [
      { label: 'Trial Balance Inquiry (EN)', prompt: 'Show me our trial balance summary and verify if debits equal credits.' },
      { label: 'Overdue Invoices Inquiry (EN)', prompt: 'Which customer invoices are currently unpaid or overdue?' },
      { label: 'BIR Tax Compliance Inquiry (EN)', prompt: 'What is our active BIR tax profile and VAT or percentage tax summary?' },
      { label: 'Revenue & Cash Inquiry (Tagalog)', prompt: 'Magkano ang total sales revenue at cash balance natin ngayon?' },
      { label: 'Guided Workflow Help (Tagalog)', prompt: 'Paano mag-approve at mag-post ng journal entry sa LedgerAI PH?' },
    ];

    for (const q of aiPrompts) {
      const aiRes = await httpJson('/api/ai/ledger-agent', {
        method: 'POST',
        token,
        body: {
          prompt: q.prompt,
          activeModuleId: 'dashboard',
        },
      });
      const replyText =
        aiRes.data?.response ||
        aiRes.data?.answer ||
        aiRes.data?.reply ||
        aiRes.data?.message ||
        '';
      record(
        'Ledger Agent AI Assistant',
        q.label,
        cfg.id,
        aiRes.ok && typeof replyText === 'string' && replyText.trim().length > 20,
        aiRes.status,
        aiRes.durationMs,
        typeof replyText === 'string' ? replyText.replace(/\s+/g, ' ').slice(0, 120) : JSON.stringify(aiRes.data).slice(0, 120)
      );
    }
  }

  // =========================================================================
  // 20. CONCURRENT MULTI-TENANT STRESS BURST (40 SIMULTANEOUS REQUESTS)
  // =========================================================================
  const c1 = PROVISIONED_COMPANIES[0];
  const c2 = PROVISIONED_COMPANIES[1];
  const t1 = tokensByCompany[c1.id];
  const t2 = tokensByCompany[c2.id];
  if (t1 && t2) {
    const startBurst = Date.now();
    const endpoints = [
      '/api/dashboard/overview',
      '/api/reports/trial-balance',
      '/api/accounting/sales-invoices',
      '/api/accounting/purchase-bills',
      '/api/accounting/journals',
      '/api/notifications',
      '/api/tax/dashboard-summary',
      '/api/operations/summary',
      '/api/approval/requests',
      '/api/audit/verify-chain',
    ];
    const jobs: Array<Promise<{ companyId: string; ok: boolean; status: number }>> = [];
    for (let round = 0; round < 2; round++) {
      for (const ep of endpoints) {
        jobs.push(
          httpJson(ep, { token: t1 }).then((r) => ({ companyId: c1.id, ok: r.ok, status: r.status }))
        );
        jobs.push(
          httpJson(ep, { token: t2 }).then((r) => ({ companyId: c2.id, ok: r.ok, status: r.status }))
        );
      }
    }
    const burstResults = await Promise.all(jobs);
    const burstDuration = Date.now() - startBurst;
    const burstPassCount = burstResults.filter((b) => b.ok).length;
    record(
      'Concurrent Stress Test',
      `40 Simultaneous Cross-Company API Requests (${c1.id} + ${c2.id})`,
      'MULTI-TENANT',
      burstPassCount === burstResults.length,
      200,
      burstDuration,
      `${burstPassCount}/${burstResults.length} succeeded in ${burstDuration}ms`
    );

    // Cross-tenant isolation verification: token 1 must see ONLY company 1 in /api/auth/session
    const s1 = await httpJson('/api/auth/session', { token: t1 });
    const s2 = await httpJson('/api/auth/session', { token: t2 });
    record(
      'Concurrent Stress Test',
      'Strict Multi-Company Tenant Isolation Check',
      'MULTI-TENANT',
      s1.ok && s2.ok && s1.data?.activeCompany?.id === c1.id && s2.data?.activeCompany?.id === c2.id,
      200,
      s1.durationMs + s2.durationMs,
      `Session1=${s1.data?.activeCompany?.id}, Session2=${s2.data?.activeCompany?.id}`
    );
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  return { passed, failed, results, tokensByCompany };
}

// Direct CLI execution when run via `npx tsx src/server/services/dryRunStressProvisioner.ts`
const isDirectCli =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('dryRunStressProvisioner.ts');

if (isDirectCli) {
  runFullDryRunStressSuite()
    .then(({ passed, failed, results }) => {
      console.log(`\n============================================================`);
      console.log(`LEDGERAI PH FULL-SYSTEM DRY-RUN STRESS TEST SUMMARY`);
      console.log(`============================================================`);
      console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
      const failures = results.filter((r) => r.status === 'FAIL');
      if (failures.length > 0) {
        console.log(`\n--- FAILURES (${failures.length}) ---`);
        for (const f of failures) {
          console.log(`[FAIL] [${f.companyId}] ${f.module} :: ${f.scenario} (HTTP ${f.httpStatus}) -> ${f.detail}`);
        }
      }
      console.log(`\n--- MODULE SUMMARY ---`);
      const byMod = new Map<string, { pass: number; fail: number }>();
      for (const r of results) {
        const cur = byMod.get(r.module) || { pass: 0, fail: 0 };
        if (r.status === 'PASS') cur.pass++;
        else cur.fail++;
        byMod.set(r.module, cur);
      }
      for (const [mod, counts] of byMod.entries()) {
        console.log(`  ${counts.fail === 0 ? '✓' : '✗'} ${mod}: ${counts.pass}/${counts.pass + counts.fail} passed`);
      }
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal dry-run error:', err);
      process.exit(1);
    });
}
