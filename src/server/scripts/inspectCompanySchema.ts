import { CompanyManager } from '../services/companyManager';

async function main() {
  const sqlite = await CompanyManager.getCompanySqlite('LGR-PH-2026-HV-06');
  console.log('Tables:');
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC").all() as any[];
  console.log(tables.map(t => t.name).join(', '));

  console.log('\nTax Codes in HV-06:');
  const tcs = sqlite.prepare("SELECT * FROM tax_codes WHERE company_id = 'LGR-PH-2026-HV-06'").all();
  console.log(tcs);

  console.log('\nUsers in HV-06:');
  const u = sqlite.prepare("SELECT * FROM company_users WHERE company_id = 'LGR-PH-2026-HV-06'").all();
  console.log(u);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
