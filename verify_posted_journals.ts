import { CompanyManager } from './src/server/services/companyManager';
import { dbContext } from './src/server/db/context';
import { db, schema } from './src/server/db';
import { sql, eq } from 'drizzle-orm';

async function main() {
  console.log("==========================================================");
  console.log("   LEDGERAI PH - POSTED JOURNALS INTEGRITY AUDIT REPORT   ");
  console.log("==========================================================\n");

  const companies = await CompanyManager.listCompanies();
  console.log(`Scanning ${companies.length} registered companies...\n`);

  let grandTotalPosted = 0;
  let grandTotalViolations = 0;
  const allViolations: any[] = [];

  for (const company of companies) {
    const companyDb = await CompanyManager.getCompanyDb(company.id);
    await dbContext.run(companyDb, async () => {
      // Count total POSTED entries
      const countQuery = await db.select({ count: sql<number>`count(*)` })
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.status, 'POSTED'));
      
      const companyPostedCount = Number(countQuery[0]?.count || 0);
      grandTotalPosted += companyPostedCount;

      // Find unbalanced POSTED entries
      const unbalanced = await db.select({
        id: schema.journalEntries.id,
        journalNumber: schema.journalEntries.journalNumber,
        companyName: sql<string>`'${company.legalName}'`,
        totalDebit: sql<number>`sum(${schema.journalLines.debit})`,
        totalCredit: sql<number>`sum(${schema.journalLines.credit})`,
        discrepancy: sql<number>`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit}))`
      })
      .from(schema.journalEntries)
      .leftJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
      .where(eq(schema.journalEntries.status, 'POSTED'))
      .groupBy(schema.journalEntries.id)
      .having(sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit})) > 0.001`);

      if (unbalanced.length > 0) {
        grandTotalViolations += unbalanced.length;
        allViolations.push(...unbalanced);
      }
    });
  }

  console.log("----------------------------------------------------------");
  console.log(`Total Posted Journals Scanned : ${grandTotalPosted}`);
  console.log(`Total Integrity Violations    : ${grandTotalViolations}`);
  console.log("----------------------------------------------------------\n");

  if (grandTotalViolations > 0) {
    console.log("⚠️ CRITICAL: INTEGRITY VIOLATIONS DETECTED ⚠️");
    console.table(allViolations.map(v => ({
      Company: v.companyName,
      JournalNo: v.journalNumber,
      JournalID: v.id,
      TotalDebit: `₱${(v.totalDebit / 100).toFixed(2)}`,
      TotalCredit: `₱${(v.totalCredit / 100).toFixed(2)}`,
      Discrepancy: `₱${(v.discrepancy / 100).toFixed(2)}`
    })));
    process.exit(1);
  } else {
    console.log("✅ SUCCESS: All posted journals are perfectly balanced.");
    console.log("The double-entry invariant is fully intact across all companies.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal Error during audit:", err);
  process.exit(1);
});
