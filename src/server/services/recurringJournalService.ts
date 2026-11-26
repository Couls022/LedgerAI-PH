import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { AuditService } from "./auditService";
import { CashFlowForecastService } from "./cashFlowForecastService";
import crypto from "crypto";

export interface RecurringJournalInput {
  companyId: string;
  templateName: string;
  frequency: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate: Date;
  endDate?: Date;
  journalData: any; // debits, credits, description
  requiresApproval?: boolean;
  userId?: string;
}

export class RecurringJournalService {
  /**
   * Create a recurring journal template
   */
  static async createTemplate(input: RecurringJournalInput) {
    const id = crypto.randomUUID();
    const nextRunDate = new Date(input.startDate);

    await db.insert(schema.recurringJournals).values({
      id,
      companyId: input.companyId,
      templateName: input.templateName,
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate || null,
      nextRunDate,
      status: 'ACTIVE',
      journalDataJson: JSON.stringify(input.journalData),
      requiresApproval: input.requiresApproval ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await AuditService.log({
      companyId: input.companyId,
      userId: input.userId || 'system',
      action: 'RECURRING_JOURNAL_GENERATED',
      entityType: 'recurringJournal',
      entityId: id,
      severity: 'INFO',
      result: 'SUCCESS',
      module: 'Accounting',
      reason: `Created recurring journal template: ${input.templateName}`
    });

    return { id, templateName: input.templateName, nextRunDate };
  }

  /**
   * List recurring journal templates
   */
  static async listTemplates(companyId: string) {
    return await db.select().from(schema.recurringJournals).where(eq(schema.recurringJournals.companyId, companyId));
  }

  /**
   * Process due recurring templates and generate real journal entries & lines (or record explicit skip reasons if COA/period is unmapped)
   */
  static async processDueTemplates(companyId: string, userId: string = 'system') {
    const now = new Date();
    const activeTemplates = await db.select()
      .from(schema.recurringJournals)
      .where(and(
        eq(schema.recurringJournals.companyId, companyId),
        eq(schema.recurringJournals.status, 'ACTIVE')
      ));

    const companyRow = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const lockDate = companyRow?.lockDate ? String(companyRow.lockDate).slice(0, 10) : null;
    const coaRows = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const periods = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.companyId, companyId));
    const parentIds = new Set(coaRows.filter((a) => a.parentAccountId).map((a) => String(a.parentAccountId)));
    const postableCoaRows = coaRows.filter((a) => a.status === 'ACTIVE' && !parentIds.has(a.id) && !(a as any).isHeader);
    const accountById = new Map(postableCoaRows.map((a) => [a.id, a]));
    const accountByCode = new Map(postableCoaRows.map((a) => [a.accountCode, a]));

    let processedCount = 0;
    const generatedDrafts: any[] = [];
    const skippedTemplates: Array<{ templateId: string; templateName: string; reason: string; status: string }> = [];

    for (const t of activeTemplates) {
      const nextRun = t.nextRunDate ? new Date(t.nextRunDate) : new Date(t.startDate);
      if (t.endDate && nextRun > new Date(t.endDate)) {
        continue;
      }
      if (nextRun <= now) {
        const journalData = JSON.parse(t.journalDataJson || '{}');
        const rawLines = Array.isArray(journalData.lines) ? journalData.lines : [];
        const entryDateStr = nextRun.toISOString().slice(0, 10);

        const isLockedByGlobalDate = Boolean(lockDate && entryDateStr <= lockDate);
        const matchingPeriod = !isLockedByGlobalDate
          ? periods.find((p) => p.status === 'OPEN' && p.startDate <= entryDateStr && p.endDate >= entryDateStr)
          : undefined;

        if (!matchingPeriod) {
          skippedTemplates.push({
            templateId: t.id,
            templateName: t.templateName,
            status: 'INCOMPLETE_CALCULATION',
            reason: `No OPEN accounting period found for ${entryDateStr}.`,
          });
          await AuditService.log({
            companyId,
            userId,
            action: 'RECURRING_JOURNAL_SKIPPED',
            entityType: 'recurringJournal',
            entityId: t.id,
            severity: 'WARN',
            result: 'FAILED',
            module: 'Accounting',
            reason: `Skipped recurring template '${t.templateName}': No OPEN accounting period for ${entryDateStr}.`,
          });
          continue;
        }

        const resolvedLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
        let unmappedAccountReason: string | null = null;
        let totalDebit = 0;
        let totalCredit = 0;

        for (const raw of rawLines) {
          const acc: any =
            (raw.accountId ? accountById.get(String(raw.accountId)) : undefined) ||
            (raw.accountCode ? accountByCode.get(String(raw.accountCode)) : undefined);
          if (!acc) {
            unmappedAccountReason = `Unmapped account reference (${raw.accountCode || raw.accountId || 'missing'}).`;
            break;
          }
          const debit = Math.max(0, Math.round(Number(raw.debit || 0)));
          const credit = Math.max(0, Math.round(Number(raw.credit || 0)));
          totalDebit += debit;
          totalCredit += credit;
          resolvedLines.push({
            accountId: acc.id,
            debit,
            credit,
            description: String(raw.description || journalData.description || t.templateName),
          });
        }

        if (unmappedAccountReason || resolvedLines.length < 2 || totalDebit <= 0 || totalDebit !== totalCredit) {
          const reason = unmappedAccountReason
            || (resolvedLines.length < 2 ? 'Template requires at least 2 balanced journal lines.' : `Unbalanced or zero amounts (DR ${totalDebit} vs CR ${totalCredit}).`);
          skippedTemplates.push({
            templateId: t.id,
            templateName: t.templateName,
            status: unmappedAccountReason ? 'UNMAPPED_ACCOUNT' : 'INCOMPLETE_CALCULATION',
            reason,
          });
          await AuditService.log({
            companyId,
            userId,
            action: 'RECURRING_JOURNAL_SKIPPED',
            entityType: 'recurringJournal',
            entityId: t.id,
            severity: 'WARN',
            result: 'FAILED',
            module: 'Accounting',
            reason: `Skipped recurring template '${t.templateName}': ${reason}`,
          });
          continue;
        }

        const draftId = crypto.randomUUID();
        const entryNumber = `RJE-${entryDateStr.replace(/-/g, '')}-${draftId.slice(0, 6).toUpperCase()}`;
        const entryStatus = t.requiresApproval === false ? 'POSTED' : 'DRAFT';

        const nextDate = new Date(nextRun);
        if (t.frequency === 'WEEKLY') nextDate.setDate(nextDate.getDate() + 7);
        else if (t.frequency === 'MONTHLY') nextDate.setMonth(nextDate.getMonth() + 1);
        else if (t.frequency === 'QUARTERLY') nextDate.setMonth(nextDate.getMonth() + 3);
        else if (t.frequency === 'YEARLY') nextDate.setFullYear(nextDate.getFullYear() + 1);

        await db.transaction(async (tx) => {
          await tx.insert(schema.journalEntries).values({
            id: draftId,
            companyId,
            journalNumber: entryNumber,
            entryNumber,
            accountingPeriodId: matchingPeriod.id,
            entryDate: entryDateStr,
            journalType: 'GENERAL',
            sourceType: 'RECURRING_JOURNAL',
            sourceId: t.id,
            reference: t.templateName,
            description: String(journalData.description || `Recurring: ${t.templateName}`),
            totalDebit,
            totalCredit,
            totalAmount: totalDebit,
            status: entryStatus,
            createdBy: userId,
            postedBy: entryStatus === 'POSTED' ? userId : null,
            postedAt: entryStatus === 'POSTED' ? now : null,
            createdAt: now,
            updatedAt: now,
          });

          for (let idx = 0; idx < resolvedLines.length; idx++) {
            const line = resolvedLines[idx];
            await tx.insert(schema.journalLines).values({
              id: crypto.randomUUID(),
              journalEntryId: draftId,
              lineNumber: idx + 1,
              accountId: line.accountId,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
              createdAt: now,
            });
          }

          await tx.update(schema.recurringJournals)
            .set({
              lastRunDate: now,
              nextRunDate: nextDate,
              updatedAt: now,
            })
            .where(and(eq(schema.recurringJournals.id, t.id), eq(schema.recurringJournals.companyId, companyId)));
        });

        await AuditService.log({
          companyId,
          userId,
          action: 'RECURRING_JOURNAL_GENERATED',
          entityType: 'journal_entry',
          entityId: draftId,
          severity: 'INFO',
          result: 'SUCCESS',
          module: 'Accounting',
          reason: `Generated ${entryStatus} journal ${entryNumber} from recurring template ${t.templateName}`,
        });

        processedCount++;
        generatedDrafts.push({
          draftId,
          journalEntryId: draftId,
          journalNumber: entryNumber,
          status: entryStatus,
          templateId: t.id,
          templateName: t.templateName,
          totalAmountCentavos: totalDebit,
          journalData,
        });
      }
    }

    return {
      processedCount,
      skippedCount: skippedTemplates.length,
      generatedDrafts,
      skippedTemplates,
    };
  }

  /**
   * Executive KPI Dashboard calculations — strictly derived from posted GL & subledgers (zero hardcoded fallbacks)
   */
  static async getExecutiveKpis(companyId: string) {
    const glRows = await db.select({
      accountType: schema.accounts.accountType,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      isCashAccount: schema.accounts.isCashAccount,
      normalBalance: schema.accounts.normalBalance,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED')
      ))
      .groupBy(
        schema.accounts.id,
        schema.accounts.accountType,
        schema.accounts.accountCode,
        schema.accounts.accountName,
        schema.accounts.isCashAccount,
        schema.accounts.normalBalance
      );

    let revenue = 0;
    let cogs = 0;
    let operatingExpenses = 0;
    let cashBalance = 0;
    let currentAssets = 0;
    let currentLiabilities = 0;

    for (const row of glRows) {
      const deb = Number(row.debitTotal || 0);
      const cred = Number(row.creditTotal || 0);
      const netDebit = deb - cred;
      const netCredit = cred - deb;
      const t = String(row.accountType || '').toUpperCase();
      const name = String(row.accountName || '');

      if (['REVENUE', 'OTHER_INCOME', 'INCOME'].includes(t)) {
        revenue += netCredit;
      } else if (['COST_OF_SALES', 'COGS', 'COST_OF_GOODS_SOLD'].includes(t)) {
        cogs += netDebit;
      } else if (['EXPENSE', 'OTHER_EXPENSE'].includes(t)) {
        operatingExpenses += netDebit;
      }

      if (row.isCashAccount || (['ASSET', 'OTHER_CURRENT_ASSET'].includes(t) && (name.includes('Cash') || name.includes('Bank')))) {
        cashBalance += netDebit;
      }

      if (['ASSET', 'RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET'].includes(t)) {
        currentAssets += netDebit;
      } else if (['LIABILITY', 'PAYABLE', 'OTHER_CURRENT_LIABILITY'].includes(t)) {
        currentLiabilities += netCredit;
      }
    }

    const expenses = cogs + operatingExpenses;
    const grossProfit = revenue - cogs;
    const netIncome = revenue - expenses;

    const arAging = await CashFlowForecastService.getArApAgingAnalysis(companyId);
    const totalAr = arAging.totalAr;

    const apRow = await db.select({
      totalAp: sql<number>`COALESCE(sum(${schema.purchaseBills.balanceDue}), 0)`,
    })
      .from(schema.purchaseBills)
      .where(and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.purchaseBills.balanceDue} > 0`
      ))
      .get();
    const totalAp = Number(apRow?.totalAp || 0);

    const effectiveCurrentAssets = currentAssets !== 0 ? currentAssets : (cashBalance + totalAr);
    const effectiveCurrentLiabilities = currentLiabilities !== 0 ? currentLiabilities : totalAp;
    const workingCapital = effectiveCurrentAssets - effectiveCurrentLiabilities;

    const currentRatio = effectiveCurrentLiabilities > 0
      ? Math.round((effectiveCurrentAssets / effectiveCurrentLiabilities) * 100) / 100
      : 0;
    const quickRatio = effectiveCurrentLiabilities > 0
      ? Math.round(((cashBalance + totalAr) / effectiveCurrentLiabilities) * 100) / 100
      : 0;

    // Derive DSO / DPO from annualised (365-day) posted activity if non-zero, otherwise 0
    const dso = revenue > 0 ? Math.round((totalAr / revenue) * 365) : 0;
    const dpo = expenses > 0 ? Math.round((totalAp / expenses) * 365) : 0;
    const cashConversionCycle = revenue > 0 || expenses > 0 ? dso - dpo : 0;
    const hasRecords = glRows.length > 0 || totalAr > 0 || totalAp > 0;

    return {
      revenue,
      cogs,
      expenses,
      netIncome,
      grossProfit,
      cashBalance,
      accountsReceivable: totalAr,
      accountsPayable: totalAp,
      currentAssets: effectiveCurrentAssets,
      currentLiabilities: effectiveCurrentLiabilities,
      workingCapital,
      currentRatio,
      quickRatio,
      currentRatioAvailable: effectiveCurrentLiabilities > 0,
      dso,
      dpo,
      cashConversionCycle,
      dataStatus: hasRecords ? 'OK' : 'NO_RECORDS',
      missingExplanation: hasRecords ? null : 'No posted journal entries or open subledger invoices/bills recorded for this company.',
      sourceTables: ['journal_entries', 'journal_lines', 'accounts', 'sales_invoices', 'purchase_bills'],
      lastUpdated: new Date().toISOString(),
    };
  }
}
