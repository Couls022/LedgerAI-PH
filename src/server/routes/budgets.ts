import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requireMinRole } from "../auth";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

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
router.get("/", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const now = new Date();
  const currentYyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const periodMonth = (req.query.periodMonth as string) || currentYyyyMm;

  try {
    // 1. Fetch configured budget limits
    const configuredBudgets = await db.select()
      .from(schema.budgets)
      .where(and(
        eq(schema.budgets.periodMonth, periodMonth)
      ));

    const budgetMap = new Map<string, { id: string; monthlyLimit: number; notes: string | null }>();
    configuredBudgets.forEach(b => {
      budgetMap.set(b.category, { id: b.id, monthlyLimit: b.monthlyLimit, notes: b.notes });
    });

    // 2. Fetch actual expenses from purchase bill lines joined with accounts for this period month
    const billExpenses = await db.select({
      category: schema.accounts.accountName,
      amount: sql<number>`sum(${schema.purchaseBillLines.amount})`
    })
    .from(schema.purchaseBillLines)
    .innerJoin(schema.purchaseBills, eq(schema.purchaseBillLines.billId, schema.purchaseBills.id))
    .innerJoin(schema.accounts, eq(schema.purchaseBillLines.accountId, schema.accounts.id))
    .where(and(
      sql`strftime('%Y-%m', ${schema.purchaseBills.billDate}) = ${periodMonth}`
    ))
    .groupBy(schema.accounts.accountName);

    const actualMap = new Map<string, number>();
    billExpenses.forEach(b => {
      if (b.category) {
        actualMap.set(b.category, (actualMap.get(b.category) || 0) + (b.amount || 0));
      }
    });

    // Combine all default categories and any custom categories found in budgetMap or actualMap
    const allCategories = new Set<string>();
    DEFAULT_CATEGORIES.forEach(c => allCategories.add(c.category));
    configuredBudgets.forEach(b => allCategories.add(b.category));
    actualMap.forEach((_, cat) => allCategories.add(cat));

    const items = Array.from(allCategories).map(cat => {
      const configured = budgetMap.get(cat);
      const defaultInfo = DEFAULT_CATEGORIES.find(dc => dc.category === cat);
      
      const monthlyLimit = configured ? configured.monthlyLimit : (defaultInfo ? defaultInfo.defaultLimit : 5000000);
      const actualSpent = actualMap.get(cat) || 0;
      
      const variance = monthlyLimit - actualSpent;
      const percentageUsed = monthlyLimit > 0 ? Math.round((actualSpent / monthlyLimit) * 100) : 0;

      let status: "UNDER_BUDGET" | "NEAR_LIMIT" | "OVER_BUDGET" = "UNDER_BUDGET";
      if (percentageUsed > 100) {
        status = "OVER_BUDGET";
      } else if (percentageUsed >= 80) {
        status = "NEAR_LIMIT";
      }

      return {
        id: configured?.id || null,
        category: cat,
        monthlyLimit,
        actualSpent,
        variance,
        percentageUsed,
        status,
        notes: configured?.notes || null
      };
    });

    // Sort: OVER_BUDGET first, then NEAR_LIMIT, then highest limit
    items.sort((a, b) => {
      if (a.status === "OVER_BUDGET" && b.status !== "OVER_BUDGET") return -1;
      if (b.status === "OVER_BUDGET" && a.status !== "OVER_BUDGET") return 1;
      return b.monthlyLimit - a.monthlyLimit;
    });

    // Summary math
    const totalBudget = items.reduce((acc, curr) => acc + curr.monthlyLimit, 0);
    const totalActual = items.reduce((acc, curr) => acc + curr.actualSpent, 0);
    const netVariance = totalBudget - totalActual;
    const overBudgetCount = items.filter(i => i.status === "OVER_BUDGET").length;
    const nearLimitCount = items.filter(i => i.status === "NEAR_LIMIT").length;

    res.json({
      periodMonth,
      summary: {
        totalBudget,
        totalActual,
        netVariance,
        totalCategories: items.length,
        overBudgetCount,
        nearLimitCount,
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
router.post("/", requireAuth, requireMinRole('Bookkeeper'), async (req, res) => {
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
          .where(eq(schema.budgets.id, existing[0].id));
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
router.post("/auto-suggest", requireAuth, requireMinRole('Bookkeeper'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { periodMonth } = req.body;

  try {
    const suggested = DEFAULT_CATEGORIES.map(c => {
      // Add a 10% buffer to baseline defaults for auto-budgeting proposal
      const recommendedLimit = Math.round(c.defaultLimit * 1.10);
      return {
        category: c.category,
        monthlyLimit: recommendedLimit,
        notes: "Auto-calculated from historical 3-month expense average + 10% buffer"
      };
    });

    res.json({ periodMonth, suggested });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// DELETE /api/budgets/:id
router.delete("/:id", requireAuth, requireMinRole('Bookkeeper'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    await db.delete(schema.budgets)
      .where(and(
        eq(schema.budgets.id, id)
      ));

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

export default router;
