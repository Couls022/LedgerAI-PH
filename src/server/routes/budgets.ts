import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { RbacService } from "../services/rbacService";
import { ensurePhase2Tables } from "./journey";

const router = Router();

// Standard expense categories
const DEFAULT_CATEGORIES = [
  { category: "Utilities & Tech", defaultLimit: 5000000 },       // ₱50,000.00
  { category: "Salaries & Benefits", defaultLimit: 18000000 },   // ₱180,000.00
  { category: "Rent & Facilities", defaultLimit: 9000000 },      // ₱90,000.00
  { category: "Marketing & Sales", defaultLimit: 7000000 },      // ₱70,000.00
  { category: "Cost of Goods Sold", defaultLimit: 22000000 },    // ₱220,000.00
  { category: "Taxes & Compliance", defaultLimit: 4500000 },     // ₱45,000.00
  { category: "Office Supplies", defaultLimit: 2500000 },        // ₱25,000.00
  { category: "Travel & Transport", defaultLimit: 3500000 },     // ₱35,000.00
  { category: "Hardware & Equipment", defaultLimit: 6000000 },   // ₱60,000.00
  { category: "Professional Fees", defaultLimit: 4000000 },      // ₱40,000.00
];

// GET /api/budgets
router.get("/", requireAuth, requirePermission('budget:view', 'budget:manage', 'budgets:view'), async (req, res) => {
  ensurePhase2Tables();
  const companyId = req.activeCompany!.id;
  const now = new Date();
  const currentYyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const periodMonth = (req.query.periodMonth as string) || currentYyyyMm;

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'budget');

    // 1. Fetch configured budget limits for this company and period (excluding archived/removed/soft-deleted records)
    const configuredBudgets = await db.select()
      .from(schema.budgets)
      .where(and(
        eq(schema.budgets.companyId, companyId),
        eq(schema.budgets.periodMonth, periodMonth),
        sql`UPPER(COALESCE(${schema.budgets.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
      ));

    const budgetMap = new Map<string, { id: string; monthlyLimit: number; notes: string | null; lifecycleStatus: string }>();
    configuredBudgets.forEach(b => {
      budgetMap.set(b.category, { id: b.id, monthlyLimit: b.monthlyLimit, notes: b.notes, lifecycleStatus: b.status || 'DRAFT' });
    });

    const billConditions = [
      eq(schema.purchaseBills.companyId, companyId),
      sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED', 'REJECTED', 'ARCHIVED', 'REMOVED', 'SOFT_DELETED')`,
      sql`strftime('%Y-%m', ${schema.purchaseBills.billDate}) = ${periodMonth}`
    ];
    if (!scope.isCompanyWide) {
      if (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS') {
        billConditions.push(eq(schema.purchaseBills.createdBy, req.user!.id));
      } else if (
        (scope.dataScope === 'DEPARTMENT' && scope.departmentMatches.length === 0) ||
        (scope.dataScope === 'PROJECT' && scope.projectMatches.length === 0) ||
        (scope.dataScope === 'COST_CENTER' && scope.costCenterMatches.length === 0)
      ) {
        billConditions.push(sql`1 = 0`);
      }
    }

    // 2. Fetch actual expenses from purchase bill lines joined with accounts for this period month
    const billExpenses = await db.select({
      category: schema.accounts.accountName,
      amount: sql<number>`sum(${schema.purchaseBillLines.amount})`
    })
    .from(schema.purchaseBillLines)
    .innerJoin(schema.purchaseBills, eq(schema.purchaseBillLines.billId, schema.purchaseBills.id))
    .innerJoin(schema.accounts, eq(schema.purchaseBillLines.accountId, schema.accounts.id))
    .where(and(...billConditions))
    .groupBy(schema.accounts.accountName);

    const glConditions = [
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      sql`${schema.accounts.accountType} IN ('EXPENSE', 'COST_OF_SALES')`,
      sql`strftime('%Y-%m', ${schema.journalEntries.entryDate}) = ${periodMonth}`
    ];
    if (!scope.isCompanyWide) {
      if (scope.dataScope === 'DEPARTMENT') {
        if (scope.departmentMatches.length > 0) {
          glConditions.push(sql`UPPER(${schema.journalLines.departmentId}) IN (${sql.join(scope.departmentMatches.map(m => sql`${m}`), sql`, `)})`);
        } else {
          glConditions.push(sql`1 = 0`);
        }
      } else if (scope.dataScope === 'PROJECT') {
        if (scope.projectMatches.length > 0) {
          glConditions.push(sql`UPPER(${schema.journalLines.projectId}) IN (${sql.join(scope.projectMatches.map(m => sql`${m}`), sql`, `)})`);
        } else {
          glConditions.push(sql`1 = 0`);
        }
      } else if (scope.dataScope === 'COST_CENTER') {
        if (scope.costCenterMatches.length > 0) {
          glConditions.push(sql`UPPER(${schema.journalLines.costCenterId}) IN (${sql.join(scope.costCenterMatches.map(m => sql`${m}`), sql`, `)})`);
        } else {
          glConditions.push(sql`1 = 0`);
        }
      } else if (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS') {
        glConditions.push(eq(schema.journalEntries.createdBy, req.user!.id));
      } else {
        glConditions.push(sql`1 = 0`);
      }
    }

    // 3. Also fetch posted GL journal lines on EXPENSE / COST_OF_SALES accounts for this period month
    const glExpenses = await db.select({
      category: schema.accounts.accountName,
      netExpense: sql<number>`sum(${schema.journalLines.debit} - ${schema.journalLines.credit})`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(...glConditions))
    .groupBy(schema.accounts.accountName);

    const actualMap = new Map<string, number>();
    billExpenses.forEach(b => {
      if (b.category) {
        actualMap.set(b.category, Math.max(0, (actualMap.get(b.category) || 0) + (b.amount || 0)));
      }
    });
    glExpenses.forEach(g => {
      if (g.category && (g.netExpense || 0) > 0) {
        // Use the higher of direct GL posted balance or unposted bill lines to prevent double counting
        const current = actualMap.get(g.category) || 0;
        actualMap.set(g.category, Math.max(current, g.netExpense || 0));
      }
    });

    // Combine ONLY actually configured budgets + categories with actual spend (never fabricate unconfigured default limits)
    const allCategories = new Set<string>();
    configuredBudgets.forEach(b => allCategories.add(b.category));
    actualMap.forEach((_, cat) => allCategories.add(cat));

    const items = Array.from(allCategories).map(cat => {
      const configured = budgetMap.get(cat);
      const isConfigured = Boolean(configured);
      const monthlyLimit = configured ? configured.monthlyLimit : 0;
      const actualSpent = actualMap.get(cat) || 0;

      const variance = monthlyLimit - actualSpent;
      const percentageUsed = monthlyLimit > 0 ? Math.round((actualSpent / monthlyLimit) * 100) : (actualSpent > 0 ? 100 : 0);

      let status: "UNDER_BUDGET" | "NEAR_LIMIT" | "OVER_BUDGET" | "UNBUDGETED" = "UNDER_BUDGET";
      if (!isConfigured) {
        status = "UNBUDGETED";
      } else if (percentageUsed > 100) {
        status = "OVER_BUDGET";
      } else if (percentageUsed >= 80) {
        status = "NEAR_LIMIT";
      }

      return {
        id: configured?.id || null,
        category: cat,
        isConfigured,
        monthlyLimit,
        actualSpent,
        variance,
        percentageUsed,
        status,
        notes: configured?.notes || (isConfigured ? null : 'Unbudgeted expense activity (no budget target saved)')
      };
    });

    // Sort: OVER_BUDGET / UNBUDGETED first, then NEAR_LIMIT, then highest limit
    items.sort((a, b) => {
      if (a.status === "OVER_BUDGET" && b.status !== "OVER_BUDGET") return -1;
      if (b.status === "OVER_BUDGET" && a.status !== "OVER_BUDGET") return 1;
      return b.monthlyLimit - a.monthlyLimit || b.actualSpent - a.actualSpent;
    });

    // Summary math strictly from configured budgets and actual spend
    const totalBudget = items.reduce((acc, curr) => acc + (curr.isConfigured ? curr.monthlyLimit : 0), 0);
    const totalActual = items.reduce((acc, curr) => acc + curr.actualSpent, 0);
    const netVariance = totalBudget - totalActual;
    const overBudgetCount = items.filter(i => i.status === "OVER_BUDGET").length;
    const nearLimitCount = items.filter(i => i.status === "NEAR_LIMIT").length;
    const unbudgetedCount = items.filter(i => i.status === "UNBUDGETED").length;

    res.json({
      periodMonth,
      hasConfiguredBudgets: configuredBudgets.length > 0,
      summary: {
        totalBudget,
        totalActual,
        netVariance,
        totalCategories: items.length,
        configuredCategories: configuredBudgets.length,
        overBudgetCount,
        nearLimitCount,
        unbudgetedCount,
        percentageUsed: totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0
      },
      budgets: items
    });
  } catch (err: any) {
    console.error("Fetch budgets error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// POST /api/budgets
router.post("/", requireAuth, requirePermission('budget:create', 'budget:edit', 'budget:approve', 'budget:write'), async (req, res) => {
  ensurePhase2Tables();
  const companyId = req.activeCompany!.id;
  const { periodMonth, items } = req.body;

  if (!periodMonth || !Array.isArray(items)) {
    return res.status(400).json({ error: "INVALID_BODY", message: "periodMonth and items array are required" });
  }

  try {
    for (const item of items) {
      if (!item.category || typeof item.monthlyLimit !== 'number') continue;

      const existing = await db.select().from(schema.budgets)
        .where(and(
          eq(schema.budgets.companyId, companyId),
          eq(schema.budgets.periodMonth, periodMonth),
          eq(schema.budgets.category, item.category)
        ));

      if (existing.length > 0) {
        await db.update(schema.budgets)
          .set({
            monthlyLimit: Math.round(item.monthlyLimit),
            notes: item.notes || null,
            updatedAt: new Date()
          })
          .where(and(
            eq(schema.budgets.id, existing[0].id),
            eq(schema.budgets.companyId, companyId)
          ));
      } else {
        await db.insert(schema.budgets).values({
          id: `bud-${crypto.randomUUID().slice(0, 8)}`,
          companyId,
          periodMonth,
          category: item.category,
          monthlyLimit: Math.round(item.monthlyLimit),
          notes: item.notes || null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }

    // Log audit
    await db.insert(schema.auditLogs).values({
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      companyId,
      userId: req.user!.id,
      action: "UPDATE_BUDGET",
      entityType: "BUDGET",
      entityId: periodMonth,
      metadata: JSON.stringify({ periodMonth, count: items.length }),
      timestamp: new Date()
    });

    res.json({ success: true, message: `Budget limits saved for ${periodMonth}` });
  } catch (err: any) {
    console.error("Save budgets error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// POST /api/budgets/auto-suggest
router.post("/auto-suggest", requireAuth, requirePermission('budget:view', 'budget:create', 'budget:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { periodMonth } = req.body;

  try {
    // Compute actual average historical monthly expenses over posted purchase bills & journals
    const histExpenses = await db.select({
      category: schema.accounts.accountName,
      totalAmount: sql<number>`COALESCE(SUM(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
      monthCount: sql<number>`COUNT(DISTINCT strftime('%Y-%m', ${schema.journalEntries.entryDate}))`
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        sql`${schema.accounts.accountType} IN ('EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE')`
      ))
      .groupBy(schema.accounts.accountName);

    const histMap = new Map<string, { avg: number; months: number }>();
    for (const row of histExpenses) {
      const m = Math.max(1, Number(row.monthCount || 1));
      const avg = Math.max(0, Math.round(Number(row.totalAmount || 0) / m));
      if (avg > 0 && row.category) {
        histMap.set(row.category, { avg, months: m });
      }
    }

    const suggested = histMap.size > 0
      ? Array.from(histMap.entries()).map(([category, info]) => ({
          category,
          monthlyLimit: Math.round(info.avg * 1.10),
          notes: `Calculated from ${info.months}-month posted GL expense average + 10% buffer`
        }))
      : DEFAULT_CATEGORIES.map(c => ({
          category: c.category,
          monthlyLimit: Math.round(c.defaultLimit * 1.10),
          notes: "Baseline starter template (no historical posted expenses recorded yet)"
        }));

    res.json({ periodMonth, suggested });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// DELETE /api/budgets/:id
router.delete("/:id", requireAuth, requirePermission('budget:create', 'budget:edit', 'budget:approve', 'budget:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const existing = await db.select().from(schema.budgets)
      .where(and(eq(schema.budgets.id, id), eq(schema.budgets.companyId, companyId)))
      .get();

    await db.delete(schema.budgets)
      .where(and(
        eq(schema.budgets.id, id),
        eq(schema.budgets.companyId, companyId)
      ));

    await db.insert(schema.auditLogs).values({
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      companyId,
      userId: req.user!.id,
      action: "DELETE_BUDGET",
      entityType: "BUDGET",
      entityId: id,
      beforeData: existing ? JSON.stringify(existing) : null,
      metadata: JSON.stringify({ id, category: existing?.category }),
      timestamp: new Date()
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

export default router;
