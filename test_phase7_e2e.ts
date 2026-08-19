import { db } from "./src/server/db";
import * as schema from "./src/server/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry
} from "./src/server/db/domain";

async function run() {
  console.log("Running Phase 7 E2E tests...");
  const company = await db.select().from(schema.companies).get();
  const user = await db.select().from(schema.users).get();
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, company.id)).limit(2);

  const entryDate = new Date().toISOString().split('T')[0];
  const journalId = await createJournalEntry(company.id, {
    journalNumber: "TEST-JE-002",
    entryDate,
    description: "Phase 7 E2E Test 2",
    createdBy: user.id,
    userRole: "Company Administrator",
  }, [
    { accountId: accounts[0].id, debit: 20000, credit: 0 },
    { accountId: accounts[1].id, debit: 0, credit: 20000 }
  ]);
  
  await submitJournalEntry(company.id, journalId, user.id);
  await approveJournalEntry(company.id, journalId, user.id);
  await postJournalEntry(company.id, journalId, user.id, "Company Administrator");
  
  const journal = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
  console.log("Journal status:", journal?.status);

  const balances = await db.select({
    accountId: schema.accounts.id,
    debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
    creditTotal: sql<number>`sum(${schema.journalLines.credit})`
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .where(eq(schema.journalEntries.status, "POSTED"))
  .groupBy(schema.accounts.id);

  console.log("Trial Balance Result:");
  console.table(balances);
  console.log("SUCCESS");
}

run().catch(console.error);
