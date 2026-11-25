import { CompanyManager } from './src/server/services/companyManager';
import { dbContext } from './src/server/db/context';
import { db, schema } from './src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log("Verifying debit-equals-credit invariant across all journal entries...");
  const companies = await CompanyManager.listCompanies();
  console.log(`Found ${companies.length} companies to check.`);

  let totalUnbalanced = 0;

  for (const company of companies) {
    const companyDb = await CompanyManager.getCompanyDb(company.id);
    await dbContext.run(companyDb, async () => {
      const unbalanced = await db.select({
        id: schema.journalEntries.id,
        journalNumber: schema.journalEntries.journalNumber,
        companyId: schema.journalEntries.companyId,
        totalDebit: sql<number>`sum(${schema.journalLines.debit})`,
        totalCredit: sql<number>`sum(${schema.journalLines.credit})`
      })
      .from(schema.journalEntries)
      .leftJoin(schema.journalLines, sql`${schema.journalEntries.id} = ${schema.journalLines.journalEntryId}`)
      .groupBy(schema.journalEntries.id)
      .having(sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit})) > 0.001`);

      if (unbalanced.length > 0) {
        console.log(`Company ${company.legalName} (${company.id}) has ${unbalanced.length} unbalanced entries:`);
        console.table(unbalanced);
        totalUnbalanced += unbalanced.length;
      }
    });
  }

  if (totalUnbalanced === 0) {
    console.log("SUCCESS: All journal entries across all companies are perfectly balanced.");
  } else {
    console.log(`FAILED: Found ${totalUnbalanced} unbalanced journal entries in total.`);
  }
}

main().catch(console.error);
