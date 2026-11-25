import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { AuditService } from "./auditService";
import crypto from "crypto";

export interface CashFlowForecastParams {
  companyId: string;
  horizonDays: number; // 30, 60, 90
  scenario?: 'BASE' | 'BEST_CASE' | 'WORST_CASE';
  userId?: string;
}

export class CashFlowForecastService {
  /**
   * Generate deterministic cash flow forecast with scenarios
   */
  static async generateForecast(params: CashFlowForecastParams) {
    const horizon = params.horizonDays || 30;
    const scenario = params.scenario || 'BASE';

    // 1. Actual opening cash balance strictly from posted GL cash/bank accounts
    const cashRow = await db.select({
      balance: sql<number>`COALESCE(sum(case when ${schema.accounts.normalBalance} = 'DEBIT' then ${schema.journalLines.debit} - ${schema.journalLines.credit} else ${schema.journalLines.credit} - ${schema.journalLines.debit} end), 0)`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        eq(schema.journalEntries.companyId, params.companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        sql`(${schema.accounts.isCashAccount} = 1 OR (${schema.accounts.accountType} IN ('ASSET', 'OTHER_CURRENT_ASSET') AND (${schema.accounts.accountName} LIKE '%Cash%' OR ${schema.accounts.accountName} LIKE '%Bank%')))`
      ))
      .get();

    const openingBalance = Number(cashRow?.balance || 0);

    // 2. Projected Inflows (strictly POSTED/PARTIAL/PARTIALLY_PAID AR invoices with balanceDue > 0)
    const invoices = await db.select()
      .from(schema.salesInvoices)
      .where(and(
        eq(schema.salesInvoices.companyId, params.companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`
      ));

    let baseInflows = 0;
    for (const inv of invoices) {
      baseInflows += Math.max(0, Number(inv.balanceDue || 0));
    }

    let projectedInflows = baseInflows;
    if (scenario === 'BEST_CASE') projectedInflows = Math.round(baseInflows * 1.15);
    if (scenario === 'WORST_CASE') projectedInflows = Math.round(baseInflows * 0.75);

    // 3. Projected Outflows (strictly POSTED/PARTIAL/PARTIALLY_PAID AP bills with balanceDue > 0)
    const bills = await db.select()
      .from(schema.purchaseBills)
      .where(and(
        eq(schema.purchaseBills.companyId, params.companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.purchaseBills.balanceDue} > 0`
      ));

    let baseOutflows = 0;
    for (const bill of bills) {
      baseOutflows += Math.max(0, Number(bill.balanceDue || 0));
    }

    // Add actual approved/pending unpaid payroll runs & tax payables in DB (never synthetic constants)
    const unpaidPayrollRow = await db.select({
      total: sql<number>`COALESCE(sum(${schema.payrollRuns.totalNetPay} + ${schema.payrollRuns.totalWithholdingTax} + ${schema.payrollRuns.totalSss} + ${schema.payrollRuns.totalPhilhealth} + ${schema.payrollRuns.totalPagibig}), 0)`,
    })
      .from(schema.payrollRuns)
      .where(and(
        eq(schema.payrollRuns.companyId, params.companyId),
        sql`${schema.payrollRuns.status} IN ('APPROVED', 'COMPUTED')`
      ))
      .get();
    const pendingPayrollOutflows = Number(unpaidPayrollRow?.total || 0);
    baseOutflows += pendingPayrollOutflows;

    let projectedOutflows = baseOutflows;
    if (scenario === 'BEST_CASE') projectedOutflows = Math.round(baseOutflows * 0.90);
    if (scenario === 'WORST_CASE') projectedOutflows = Math.round(baseOutflows * 1.20);

    const closingBalance = openingBalance + projectedInflows - projectedOutflows;
    const hasRecords = openingBalance !== 0 || invoices.length > 0 || bills.length > 0 || pendingPayrollOutflows > 0;

    const forecastId = crypto.randomUUID();
    const details = {
      openingBalance,
      projectedInflows,
      projectedOutflows,
      pendingPayrollOutflows,
      closingBalance,
      unpaidInvoicesCount: invoices.length,
      unpaidBillsCount: bills.length,
      dataStatus: hasRecords ? 'OK' : 'NO_RECORDS',
      missingExplanation: hasRecords ? null : 'No posted GL cash balance, open receivables, open payables, or approved unpaid payroll runs recorded.',
      classification: 'ACTUAL_SUBLEDGER_AND_GL',
      assumptionsApplied: scenario,
      sourceTables: ['journal_lines', 'sales_invoices', 'purchase_bills', 'payroll_runs'],
    };

    await db.insert(schema.cashFlowForecasts).values({
      id: forecastId,
      companyId: params.companyId,
      forecastDate: new Date(),
      horizonDays: horizon,
      scenario,
      openingBalance,
      projectedInflows,
      projectedOutflows,
      closingBalance,
      detailsJson: JSON.stringify(details),
      createdAt: new Date(),
    });

    await AuditService.log({
      companyId: params.companyId,
      userId: params.userId || 'system',
      action: 'CASH_FLOW_FORECAST_GENERATED',
      entityType: 'cashFlowForecast',
      entityId: forecastId,
      severity: 'INFO',
      result: 'SUCCESS',
      module: 'CashFlow',
      reason: `Generated ${horizon}-day cash flow forecast under ${scenario} scenario`
    });

    return {
      forecastId,
      horizonDays: horizon,
      scenario,
      openingBalance,
      projectedInflows,
      projectedOutflows,
      closingBalance,
      dataStatus: hasRecords ? 'OK' : 'NO_RECORDS',
      missingExplanation: details.missingExplanation,
      details,
    };
  }

  /**
   * AR Aging & Collection Analysis (strictly open posted receivables)
   */
  static async getArApAgingAnalysis(companyId: string) {
    const invoices = await db.select()
      .from(schema.salesInvoices)
      .where(and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`
      ));

    let overdueAr = 0;
    let currentAr = 0;
    let overdueCount = 0;
    const now = Date.now();

    for (const inv of invoices) {
      const remaining = Math.max(0, Number(inv.balanceDue || 0));
      const dueDate = inv.dueDate ? new Date(inv.dueDate).getTime() : now;
      if (dueDate < now) {
        overdueAr += remaining;
        overdueCount++;
      } else {
        currentAr += remaining;
      }
    }

    return {
      totalAr: currentAr + overdueAr,
      currentAr,
      overdueAr,
      overdueCount,
      openInvoicesCount: invoices.length,
      collectionRemindersPrepared: overdueCount,
    };
  }
}
