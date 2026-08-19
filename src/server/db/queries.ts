import { db } from "./index";
import { accounts, journalEntries, accountingPeriods, auditLogs } from "./schema";
import { eq, and } from "drizzle-orm";

export function getCompanyAccounts(companyId: string) {
  return db.select().from(accounts).where(eq(accounts.companyId, companyId));
}

export function getCompanyJournalEntries(companyId: string) {
  return db.select().from(journalEntries).where(eq(journalEntries.companyId, companyId));
}

export function getCompanyAccountingPeriods(companyId: string) {
  return db.select().from(accountingPeriods).where(eq(accountingPeriods.companyId, companyId));
}

export function getCompanyAuditLogs(companyId: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.companyId, companyId));
}
