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
  console.log('Testing DB readiness for 6 mandate companies...');
  for (const id of MANDATE_IDS) {
    try {
      const sqlite = await CompanyManager.getCompanySqlite(id);
      if (!sqlite) {
        console.error(`FAILED: No sqlite instance for ${id}`);
        continue;
      }
      const comp = sqlite.prepare('SELECT id, legal_name, classification, vat_status FROM companies WHERE id = ?').get(id) as any;
      const accCount = sqlite.prepare('SELECT COUNT(*) as c FROM accounts WHERE company_id = ?').get(id) as any;
      const userCount = sqlite.prepare('SELECT COUNT(*) as c FROM company_users WHERE company_id = ?').get(id) as any;
      console.log(`[OK] ${id}: Name="${comp?.legal_name}", Class=${comp?.classification}, Accounts=${accCount?.c}, Users=${userCount?.c}`);
    } catch (e: any) {
      console.error(`[ERROR] ${id}:`, e.message);
    }
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
