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

async function main() {
  console.log('[PROVISION] Initializing Enterprise Test Companies...');

  // 1. Company 1: Pacific Crest Trading & Logistics Corp.
  const pctId = 'LGR-PH-2026-PCT-01';
  console.log(`\nCreating ${pctId}: Pacific Crest Trading & Logistics Corp. (VAT Corp)`);
  const pctRes = await api('/api/companies/create-profile', {
    method: 'POST',
    body: {
      company: {
        id: pctId,
        legalName: 'Pacific Crest Trading & Logistics Corp.',
        tradeName: 'Pacific Crest Trading',
        tin: '009-876-543-00000',
        industry: 'LOGISTICS_TRADING',
        branchCode: '00000',
        address: 'Km 18 West Service Road, Sucat, Parañaque City, Metro Manila',
        classification: 'TEST',
      },
      tax: {
        vatStatus: 'VAT',
        taxpayerClassification: 'CORPORATION',
        rdoCode: '044',
      },
      accounting: {
        fiscalYear: 2026,
        currency: 'PHP',
        accountingMethod: 'ACCRUAL',
      },
      admin: {
        email: 'owner@pacificcrest.ph',
        password: 'LedgerPH!2026',
        displayName: 'Gabriel Mendoza',
      },
    },
  });

  if (pctRes.ok) {
    console.log(`[PROVISION] Created ${pctId} successfully.`);
  } else {
    console.log(`[PROVISION] Create returned ${pctRes.status}:`, pctRes.data);
  }

  // Login as Pacific Crest owner
  const pctLogin = await api('/api/auth/login', {
    method: 'POST',
    body: {
      companyId: pctId,
      email: 'owner@pacificcrest.ph',
      password: 'LedgerPH!2026',
    },
  });
  if (!pctLogin.ok || !pctLogin.data?.token) {
    throw new Error(`Failed to login to ${pctId}: ${pctLogin.status} ${JSON.stringify(pctLogin.data)}`);
  }
  const pctToken = pctLogin.data.token;
  console.log(`[PROVISION] Logged in as Gabriel Mendoza (Owner)`);

  // Add Clarissa Santos, CPA (Accountant)
  const user1 = await api('/api/users', {
    method: 'POST',
    token: pctToken,
    body: {
      email: 'accountant@pacificcrest.ph',
      password: 'AcctPH!2026',
      displayName: 'Clarissa Santos, CPA',
      role: 'Accountant',
    },
  });
  console.log(`[PROVISION] Added Accountant Clarissa Santos: ${user1.status}`);

  // Add Ramon Villanueva (Finance Manager)
  const user2 = await api('/api/users', {
    method: 'POST',
    token: pctToken,
    body: {
      email: 'finance@pacificcrest.ph',
      password: 'FinPH!2026',
      displayName: 'Ramon Villanueva',
      role: 'Finance Manager',
    },
  });
  console.log(`[PROVISION] Added Finance Manager Ramon Villanueva: ${user2.status}`);

  // 2. Company 2: Bayanihan Prime Consultancy Services
  const bpcId = 'LGR-PH-2026-BPC-02';
  console.log(`\nCreating ${bpcId}: Bayanihan Prime Consultancy Services (Non-VAT Sole Prop)`);
  const bpcRes = await api('/api/companies/create-profile', {
    method: 'POST',
    body: {
      company: {
        id: bpcId,
        legalName: 'Bayanihan Prime Consultancy Services',
        tradeName: 'Bayanihan Prime Consultancy',
        tin: '245-891-304-00000',
        industry: 'PROFESSIONAL_SERVICES',
        branchCode: '00000',
        address: 'Unit 802, Prestige Tower, F. Ortigas Jr. Road, Pasig City, Metro Manila',
        classification: 'TEST',
      },
      tax: {
        vatStatus: 'NON_VAT',
        taxpayerClassification: 'INDIVIDUAL',
        rdoCode: '039',
      },
      accounting: {
        fiscalYear: 2026,
        currency: 'PHP',
        accountingMethod: 'ACCRUAL',
      },
      admin: {
        email: 'owner@bayanihanprime.ph',
        password: 'Bayanihan!2026',
        displayName: 'Marisol Reyes',
      },
    },
  });

  if (bpcRes.ok) {
    console.log(`[PROVISION] Created ${bpcId} successfully.`);
  } else {
    console.log(`[PROVISION] Create returned ${bpcRes.status}:`, bpcRes.data);
  }

  // Login as Bayanihan Prime owner
  const bpcLogin = await api('/api/auth/login', {
    method: 'POST',
    body: {
      companyId: bpcId,
      email: 'owner@bayanihanprime.ph',
      password: 'Bayanihan!2026',
    },
  });
  if (!bpcLogin.ok || !bpcLogin.data?.token) {
    throw new Error(`Failed to login to ${bpcId}: ${bpcLogin.status} ${JSON.stringify(bpcLogin.data)}`);
  }
  const bpcToken = bpcLogin.data.token;
  console.log(`[PROVISION] Logged in as Marisol Reyes (Owner)`);

  // Add Paolo Dela Cruz (Bookkeeper)
  const user3 = await api('/api/users', {
    method: 'POST',
    token: bpcToken,
    body: {
      email: 'bookkeeper@bayanihanprime.ph',
      password: 'BookPH!2026',
      displayName: 'Paolo Dela Cruz',
      role: 'Bookkeeper',
    },
  });
  console.log(`[PROVISION] Added Bookkeeper Paolo Dela Cruz: ${user3.status}`);

  // 3. Register shortcuts in shortcut_history.json so they appear cleanly as shown in screenshot
  const shortcutHistoryPath = 'C:\\Users\\Couls\\AppData\\Roaming\\LedgerAI_Data\\shortcut_history.json';
  const nowIso = new Date().toISOString();
  const shortcuts = [
    {
      companyId: pctId,
      displayName: 'Pacific Crest Trading & Logistics Corp.',
      databasePath: `C:/Users/Couls/Documents/LedgerAI Companies/${pctId}/database.lai`,
      companyDirectory: `C:/Users/Couls/Documents/LedgerAI Companies/${pctId}`,
      databaseIdentity: pctId,
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: {
        schemaVersion: 21,
        latestSupportedVersion: 21,
        containerFormat: 'UNKNOWN',
        keyMode: 'LEGACY_DEV_KEY',
      },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
    {
      companyId: bpcId,
      displayName: 'Bayanihan Prime Consultancy Services',
      databasePath: `C:/Users/Couls/Documents/LedgerAI Companies/${bpcId}/database.lai`,
      companyDirectory: `C:/Users/Couls/Documents/LedgerAI Companies/${bpcId}`,
      databaseIdentity: bpcId,
      lastOpenedAt: nowIso,
      lastOperation: 'OPENED',
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: 'TEST',
      isDemo: false,
      versionMetadata: {
        schemaVersion: 21,
        latestSupportedVersion: 21,
        containerFormat: 'UNKNOWN',
        keyMode: 'LEGACY_DEV_KEY',
      },
      lastValidationError: null,
      lastCheckedAt: nowIso,
    },
  ];

  fs.writeFileSync(shortcutHistoryPath, JSON.stringify(shortcuts, null, 2), 'utf8');
  console.log(`[PROVISION] Updated ${shortcutHistoryPath} with the 2 active companies.`);

  console.log('\n[PROVISION COMPLETE] Both company workspaces provisioned and registered!');
}

main().catch((err) => {
  console.error('[PROVISION FAILED]', err);
  process.exit(1);
});
