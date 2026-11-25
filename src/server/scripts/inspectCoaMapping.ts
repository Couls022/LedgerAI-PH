import { CompanyManager } from '../services/companyManager';

const MANDATE_IDS = [
  'LGR-PH-2026-PCT-01',
  'LGR-PH-2026-BPC-02',
  'LGR-PH-2026-8PCT-03',
  'LGR-PH-2026-PROF-04',
  'LGR-PH-2026-MB-05',
  'LGR-PH-2026-HV-06'
];

async function main() {
  for (const id of MANDATE_IDS) {
    const sqlite = await CompanyManager.getCompanySqlite(id);
    const accounts = sqlite.prepare('SELECT id, account_code, account_name, account_type FROM accounts WHERE company_id = ? ORDER BY account_code ASC').all(id) as any[];
    console.log(`\n=== Accounts for ${id} (Total: ${accounts.length}) ===`);
    for (const a of accounts) {
      console.log(`  ${a.account_code}: ${a.account_name} (${a.account_type})`);
    }
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
