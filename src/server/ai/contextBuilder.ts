import { dbContext } from '../db/context';
import { CompanyManager } from '../services/companyManager';
import { db } from '../db';
import { companies, accounts, journalEntries, journalLines, vendors, customers, purchaseBills, salesInvoices, companyTaxProfiles } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { AISkillContextRequirement } from './types';

export class ContextBuilder {
  static async buildContext(
    companyId: string,
    requirements: AISkillContextRequirement,
    params: Record<string, any> = {}
  ): Promise<Record<string, any>> {
    let companyDb: any = dbContext.getStore() || db;
    try {
      if (!dbContext.getStore()) {
        companyDb = await CompanyManager.getCompanyDb(companyId);
      }
    } catch {
      companyDb = dbContext.getStore() || db;
    }

    const currentDb = dbContext.getStore() || companyDb || db;

    return dbContext.run(currentDb, async () => {
      const context: Record<string, any> = {};

      // 1. Company Context
      if (requirements.requireCompany !== false) {
        const company = await currentDb.select({
          id: companies.id,
          legalName: companies.legalName,
          tradeName: companies.tradeName,
          tin: companies.tin,
          taxpayerType: companies.taxpayerType,
          vatStatus: companies.vatStatus,
          currency: companies.currency,
        }).from(companies).where(eq(companies.id, companyId)).get();

        if (company) {
          context.company = company;
        }
      }

      // 2. Account Context
      if (requirements.requireAccount && params.accountId) {
        const account = await currentDb.select().from(accounts).where(and(eq(accounts.id, params.accountId), eq(accounts.companyId, companyId))).get();
        if (account) {
          context.account = account;
        }
      }

      // 3. Journal Context
      if (requirements.requireJournal && params.journalId) {
        const entry = await currentDb.select().from(journalEntries).where(and(eq(journalEntries.id, params.journalId), eq(journalEntries.companyId, companyId))).get();
        if (entry) {
          const lines = await currentDb.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
          context.journal = { ...entry, lines };
        }
      }

      // 4. Tax Profile Context
      if (requirements.requireTaxProfile) {
        const taxProfile = await currentDb.select().from(companyTaxProfiles).where(eq(companyTaxProfiles.companyId, companyId)).get();
        if (taxProfile) {
          context.taxProfile = taxProfile;
        }
      }

      // 5. Purchase Bill Context
      if (params.billId) {
        const bill = await currentDb.select().from(purchaseBills).where(and(eq(purchaseBills.id, params.billId), eq(purchaseBills.companyId, companyId))).get();
        if (bill) {
          context.bill = bill;
        }
      }

      // 6. Sales Invoice Context
      if (params.invoiceId) {
        const invoice = await currentDb.select().from(salesInvoices).where(and(eq(salesInvoices.id, params.invoiceId), eq(salesInvoices.companyId, companyId))).get();
        if (invoice) {
          context.invoice = invoice;
        }
      }

      return context;
    });
  }
}
