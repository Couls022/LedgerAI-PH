import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission, requireApprovalRole } from "../auth";
import { eq, and, sql, desc, lte, gte, like, or, inArray } from "drizzle-orm";
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from "../utils/pagination";
import crypto from "crypto";
import { ForexRevaluationEngine } from "../services/forexRevaluationEngine";
import { AccountingEngine } from "../services/accountingEngine";
import { TaxEngine } from "../services/taxEngine";
import { validateTransactionDateAndPeriod, DomainError } from "../db/domain";
import { RbacService } from "../services/rbacService";
import { AuditService } from "../services/auditService";
import { createSalesInvoice, approvePurchaseBill, resolveCompanyControlAccount } from "../db/business_transactions";
import { validateFixedAssetInput } from "../utils/requestPath";
import { getAuthoritativeOperationsSummary } from "../services/financialSourceOfTruth";

const router = Router();

// ==========================================
// 0. AUTHORITATIVE OPERATIONS SUMMARY (SINGLE SOURCE OF TRUTH)
// ==========================================
router.get('/summary', requireAuth, requirePermission('operations:view', 'accounting:view', 'dashboard:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const summary = await getAuthoritativeOperationsSummary(companyId);
    res.json(summary);
  } catch (err: any) {
    console.error('Operations summary error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to compute authoritative operations summary' });
  }
});

// ==========================================
// 1. FOREIGN CURRENCY & BIR FOREX POLICY (BIR RMC 12-2024)
// ==========================================

// Get Spot Exchange Rates
router.get('/forex/rates', requireAuth, requirePermission('operations:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const rates = await db.select()
      .from(schema.currencyExchangeRates)
      .where(eq(schema.currencyExchangeRates.companyId, companyId))
      .orderBy(desc(schema.currencyExchangeRates.rateDate), desc(schema.currencyExchangeRates.createdAt));
    res.json(rates);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch exchange rates" });
  }
});

// Set / Update Spot Exchange Rate (BSP / BAP)
router.post('/forex/rates', requireAuth, requirePermission('accounting:create', 'accounting:edit', 'settings:manage', 'operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
  const { rateDate, currency, bspSpotRate, source } = req.body;

  const normalizedCurrency = String(currency || 'USD').trim().toUpperCase();
  const parsedRate = Number(bspSpotRate);

  if (!rateDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(rateDate).slice(0, 10))) {
    res.status(400).json({ error: "INVALID_FOREX_INPUT", message: "A valid rateDate (YYYY-MM-DD) is required." });
    return;
  }
  if (!/^[A-Z]{3}$/.test(normalizedCurrency) || normalizedCurrency === 'PHP') {
    res.status(400).json({ error: "INVALID_CURRENCY_CODE", message: "Currency must be a valid 3-letter foreign currency code (not PHP)." });
    return;
  }
  if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
    res.status(400).json({ error: "INVALID_FOREX_INPUT", message: "bspSpotRate must be a positive finite number." });
    return;
  }

  try {
    const id = crypto.randomUUID();
    const cleanDate = String(rateDate).slice(0, 10);
    await db.insert(schema.currencyExchangeRates).values({
      id,
      companyId,
      rateDate: cleanDate,
      currency: normalizedCurrency,
      bspSpotRate: parsedRate,
      source: source || 'BSP'
    });

    await AuditService.log({
      req,
      companyId,
      userId,
      role: actorRole,
      action: 'RECORD_BSP_SPOT_RATE',
      entityType: 'currency_exchange_rates',
      entityId: id,
      recordReference: `${normalizedCurrency}@${cleanDate}`,
      module: 'Accounting & General Ledger / Foreign Exchange Revaluation',
      afterData: { rateDate: cleanDate, currency: normalizedCurrency, bspSpotRate: parsedRate, source: source || 'BSP' },
    });

    res.json({ success: true, id, message: "BSP Spot Rate saved successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to save exchange rate" });
  }
});

// Delete Spot Exchange Rate (with audit trail)
router.delete('/forex/rates/:id', requireAuth, requirePermission('accounting:edit', 'settings:manage', 'operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
  const { id } = req.params;

  try {
    const existing = await db.select()
      .from(schema.currencyExchangeRates)
      .where(and(eq(schema.currencyExchangeRates.id, id), eq(schema.currencyExchangeRates.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'BSP spot rate record not found.' });
    }

    await db.delete(schema.currencyExchangeRates)
      .where(and(eq(schema.currencyExchangeRates.id, id), eq(schema.currencyExchangeRates.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      userId,
      role: actorRole,
      action: 'DELETE_BSP_SPOT_RATE',
      entityType: 'currency_exchange_rates',
      entityId: id,
      recordReference: `${existing.currency}@${existing.rateDate}`,
      module: 'Accounting & General Ledger / Foreign Exchange Revaluation',
      beforeData: existing,
    });

    res.json({ success: true, message: `Deleted BSP spot rate ${existing.currency} (${existing.rateDate}).` });
  } catch (err: any) {
    res.status(500).json({ error: 'DELETE_FAILED', message: err?.message || 'Failed to delete exchange rate.' });
  }
});

// Realized & Unrealized Forex Gain/Loss Engine (BIR RMC 12-2024 Compliance)
router.get('/forex/calculate-realized', requireAuth, requirePermission('operations:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { currency, invoiceDate, invoiceRate, paymentDate, paymentRate, foreignAmountUsd, foreignAmount } = req.query;

  try {
    const targetCurrency = String(currency || 'USD').trim().toUpperCase();
    const rawAmount = foreignAmountUsd ?? foreignAmount;
    const fxAmount = Number(rawAmount);
    if (!rawAmount || !Number.isFinite(fxAmount) || fxAmount <= 0) {
      return res.status(400).json({
        error: "INVALID_FOREX_INPUT",
        message: "A positive foreignAmountUsd (or foreignAmount) query parameter is required."
      });
    }

    let invRate = invoiceRate !== undefined && invoiceRate !== '' ? Number(invoiceRate) : NaN;
    if (!Number.isFinite(invRate) || invRate <= 0) {
      if (invoiceDate) {
        invRate = await ForexRevaluationEngine.getBspSpotRate(companyId, targetCurrency, String(invoiceDate).slice(0, 10));
      } else {
        return res.status(400).json({
          error: "INVALID_FOREX_INPUT",
          message: "invoiceRate (> 0) or an invoiceDate matching a recorded BSP spot rate is required."
        });
      }
    }

    let payRate = paymentRate !== undefined && paymentRate !== '' ? Number(paymentRate) : NaN;
    if (!Number.isFinite(payRate) || payRate <= 0) {
      if (paymentDate) {
        payRate = await ForexRevaluationEngine.getBspSpotRate(companyId, targetCurrency, String(paymentDate).slice(0, 10));
      } else {
        return res.status(400).json({
          error: "INVALID_FOREX_INPUT",
          message: "paymentRate (> 0) or a paymentDate matching a recorded BSP spot rate is required."
        });
      }
    }

    const fxResult = ForexRevaluationEngine.calculateRealizedFx(fxAmount, invRate, payRate);

    res.json({
      complianceNotice: fxResult.complianceNote,
      currency: targetCurrency,
      foreignAmountUsd: fxAmount,
      foreignAmount: fxAmount,
      invoiceRate: invRate,
      paymentRate: payRate,
      originalValuePhp: fxResult.recordedAmountPhp,
      settledValuePhp: fxResult.settlementAmountPhp,
      realizedFxAmountPhp: fxResult.isGain ? fxResult.realizedGainPhp : fxResult.realizedLossPhp,
      type: fxResult.isGain ? "REALIZED_FX_GAIN" : "REALIZED_FX_LOSS",
      glAccountCategory: fxResult.isGain ? "Other Taxable Income" : "Itemized Deductions",
      isTaxableInItr: true, // Realized is included in ITR
      unrealizedTreatment: "Unrealized FX fluctuations are tracked separately and EXCLUDED from Taxable Income on ITR."
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 500;
    return res.status(status).json({
      error: err.code || "FOREX_CALCULATION_ERROR",
      message: err.message || "Failed to calculate realized FX gain/loss."
    });
  }
});

router.post('/forex/revalue-and-post', requireAuth, requirePermission('accounting:post', 'accounting:create', 'operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
  const {
    transactionId,
    transactionNumber,
    transactionDate,
    foreignAmount,
    recordedRate,
    settlementRate,
    currency,
    targetAccountId,
    revaluationType,
    sourceType,
  } = req.body;

  try {
    const journalEntryId = await ForexRevaluationEngine.postRealizedFxJournal(companyId, userId, {
      transactionId: transactionId || crypto.randomUUID(),
      transactionNumber: transactionNumber || `FX-${Date.now()}`,
      transactionDate: transactionDate || new Date().toISOString().slice(0, 10),
      foreignAmount: Number(foreignAmount),
      recordedRate: Number(recordedRate),
      settlementRate: Number(settlementRate),
      currency: currency ? String(currency).toUpperCase() : undefined,
      targetAccountId: targetAccountId ? String(targetAccountId) : undefined,
      revaluationType,
      sourceType: sourceType || "UNREALIZED_MONTH_END",
      userRole: actorRole
    });

    res.json({
      success: true,
      journalEntryId,
      message: "FX revaluation journal entry posted to GL in compliance with BIR RMC 12-2024."
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to post FX revaluation journal entry." });
  }
});

// List foreign-currency monetary GL accounts & carrying PHP balances
router.get('/forex/monetary-accounts', requireAuth, requirePermission('operations:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { asOfDate, currency } = req.query;
  try {
    const accounts = await ForexRevaluationEngine.listForeignMonetaryAccounts(companyId, {
      asOfDate: asOfDate ? String(asOfDate) : undefined,
      currency: currency ? String(currency) : undefined,
    });
    res.json({ accounts });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 500;
    res.status(status).json({ error: err.code || "FOREX_ERROR", message: err.message || "Failed to load FX monetary accounts." });
  }
});

// List Period-End Unrealized FX Revaluation Runs (supports page & limit, default 20)
router.get('/forex/revaluations', requireAuth, requirePermission('operations:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const allRuns = await ForexRevaluationEngine.listRevaluationRuns(companyId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const items = allRuns.slice(offset, offset + limit);

    res.json({
      items,
      totalCount: allRuns.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(allRuns.length / limit)),
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 500;
    res.status(status).json({ error: err.code || "FOREX_ERROR", message: err.message || "Failed to fetch FX revaluation runs." });
  }
});

// Preview Period-End Unrealized FX Revaluation (PAS 21 / BIR RMC 12-2024)
router.post('/forex/revaluations/preview', requireAuth, requirePermission('operations:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { accountingPeriodId, revaluationDate, currency, closingSpotRate, rateSource, exposures } = req.body;
  try {
    const preview = await ForexRevaluationEngine.previewPeriodEndRevaluation(companyId, {
      accountingPeriodId,
      revaluationDate,
      currency,
      closingSpotRate,
      rateSource,
      exposures,
    });
    res.json(preview);
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 500;
    res.status(status).json({ error: err.code || "FOREX_PREVIEW_ERROR", message: err.message || "Failed to preview FX revaluation." });
  }
});

// Post Period-End Unrealized FX Revaluation Run + Optional Next-Period Auto-Reversal
router.post('/forex/revaluations/post', requireAuth, requirePermission('accounting:post', 'accounting:create', 'operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
  const { accountingPeriodId, revaluationDate, currency, closingSpotRate, rateSource, exposures, autoReverse, autoReverseDate, notes } = req.body;

  try {
    const result = await ForexRevaluationEngine.postPeriodEndRevaluation(companyId, userId, {
      accountingPeriodId,
      revaluationDate,
      currency,
      closingSpotRate,
      rateSource,
      exposures,
      autoReverse: Boolean(autoReverse),
      autoReverseDate,
      notes,
      userRole: actorRole,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 500;
    res.status(status).json({ error: err.code || "FOREX_POST_ERROR", message: err.message || "Failed to post FX revaluation run." });
  }
});

// Reverse a Posted FX Revaluation Run
router.post('/forex/revaluations/:id/reverse', requireAuth, requirePermission('accounting:post', 'accounting:reverse', 'operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
  const { id } = req.params;
  const { reverseDate, reason } = req.body || {};

  try {
    const result = await ForexRevaluationEngine.reverseRevaluationRun(companyId, id, userId, {
      reverseDate,
      reason,
      userRole: actorRole,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 500;
    res.status(status).json({ error: err.code || "FOREX_REVERSE_ERROR", message: err.message || "Failed to reverse FX revaluation run." });
  }
});


// ==========================================
// 2. INVENTORY & COST OF GOODS SOLD (COGS) MODULE
// ==========================================

// Get Inventory Stock Items & Reorder Point Status
router.get('/inventory/items', requireAuth, requirePermission('inventory:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  try {
    const filterConditions = [eq(schema.inventoryItems.companyId, companyId)];

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.inventoryItems.sku, searchPattern),
          like(schema.inventoryItems.name, searchPattern),
          like(schema.inventoryItems.description, searchPattern),
          like(schema.inventoryItems.category, searchPattern)
        )!
      );
    }

    if (params.status) {
      filterConditions.push(eq(schema.inventoryItems.status, params.status));
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.inventoryItems.status}, 'ACTIVE')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const cursorCond = buildCursorCondition(
      schema.inventoryItems.sku,
      schema.inventoryItems.id,
      params.decodedCursor,
      'ASC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.inventoryItems)
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const items = await db
      .select()
      .from(schema.inventoryItems)
      .where(and(...queryConditions))
      .orderBy(schema.inventoryItems.sku, schema.inventoryItems.id)
      .limit(params.limit + 1);

    const enriched = items.map(item => ({
      ...item,
      itemCode: item.sku,
      itemName: item.name,
      reorderLevel: item.reorderPoint,
      needsReorder: item.quantityOnHand <= item.reorderPoint,
      totalStockValuePhp: (item.quantityOnHand * item.unitCost) / 100
    }));

    res.json(formatPaginatedResponse({
      items: enriched,
      limit: params.limit,
      getSortValAndId: (item: any) => ({ val: item.sku, id: item.id }),
      totalCount,
      raw: params.raw
    }));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch inventory items" });
  }
});

// Create Inventory Stock Item
router.post('/inventory/items', requireAuth, requirePermission('inventory:create', 'inventory:edit', 'inventory:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { sku, itemCode, name, itemName, description, category, unitOfMeasure, costingMethod, unitCost, sellingPrice, quantityOnHand, reorderPoint, reorderLevel, assetAccountId, cogsAccountId, department, departmentId, projectId, costCenterId } = req.body;

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, userId, 'inventory');
    if (!scope.isCompanyWide && (department || departmentId || projectId || costCenterId)) {
      scope.assertRecordAccess({ department, departmentId, projectId, costCenterId }, 'inventory item');
    }
  } catch (scopeErr: any) {
    res.status(scopeErr.statusCode || 403).json({ error: scopeErr.error || 'PERMISSION_DENIED', code: scopeErr.code, message: scopeErr.message });
    return;
  }

  const finalSku = sku || itemCode;
  const finalName = name || itemName;

  if (!finalSku || !finalName) {
    res.status(400).json({ error: "SKU and Item Name are required" });
    return;
  }

  try {
    const id = crypto.randomUUID();
    const initialQty = Number(quantityOnHand) || 0;
    const costCentavos = Number(unitCost) || 0;

    await db.transaction(async (tx) => {
      await tx.insert(schema.inventoryItems).values({
        id,
        companyId,
        sku: finalSku,
        name: finalName,
        description: description || finalName,
        category: category || 'GENERAL',
        unitOfMeasure: unitOfMeasure || 'PCS',
        costingMethod: costingMethod || 'FIFO',
        unitCost: costCentavos,
        sellingPrice: Number(sellingPrice) || 0,
        quantityOnHand: initialQty,
        reorderPoint: Number(reorderPoint ?? reorderLevel) || 10,
        assetAccountId: assetAccountId || null,
        cogsAccountId: cogsAccountId || null,
      });

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: "CREATE_INVENTORY_ITEM",
        entityType: "inventory_items",
        entityId: id,
        recordReference: finalSku,
        module: "Inventory & Warehouse",
        afterData: JSON.stringify({ sku: finalSku, name: finalName, costingMethod: costingMethod || 'FIFO', unitCost: costCentavos, quantityOnHand: initialQty })
      });
    });

    res.json({ success: true, id, message: "Inventory item created" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create item" });
  }
});

// Stock Adjustments & Waste Log (with automatic GL COGS/Valuation Posting)
router.post("/inventory/adjustments", requireAuth, requirePermission('inventory:edit', 'inventory:create', 'inventory:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { adjustmentNumber, adjustmentDate, itemId, quantityChange, adjustmentType, quantity, reason, expenseAccountId, department, departmentId, projectId, costCenterId } = req.body;

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, userId, 'inventory');
    if (!scope.isCompanyWide && (department || departmentId || projectId || costCenterId)) {
      scope.assertRecordAccess({ department, departmentId, projectId, costCenterId }, 'stock adjustment');
    }
  } catch (scopeErr: any) {
    res.status(scopeErr.statusCode || 403).json({ error: scopeErr.error || 'PERMISSION_DENIED', code: scopeErr.code, message: scopeErr.message });
    return;
  }

  let resolvedQtyChange = quantityChange !== undefined ? Number(quantityChange) : undefined;
  if (resolvedQtyChange === undefined && quantity !== undefined) {
    const absQty = Math.abs(Number(quantity));
    const isOut = adjustmentType === 'STOCK_OUT' || adjustmentType === 'SCRAP' || adjustmentType === 'DECREASE';
    resolvedQtyChange = isOut ? -absQty : absQty;
  }

  if (!itemId || resolvedQtyChange === undefined || resolvedQtyChange === 0 || !reason) {
    res.status(400).json({ error: "Item, non-zero quantity change, and reason are required" });
    return;
  }

  try {
    const expectedVersion = req.body.expectedVersion;
    const qChange = Number(resolvedQtyChange);
    const adjId = crypto.randomUUID();
    const adjNo = adjustmentNumber || `SA-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const adjDate = adjustmentDate || new Date().toISOString().slice(0, 10);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;

    const txResult = await db.transaction(async (tx) => {
      const item = await tx.select().from(schema.inventoryItems).where(and(eq(schema.inventoryItems.id, itemId), eq(schema.inventoryItems.companyId, companyId))).get();
      if (!item) {
        throw new DomainError("Item not found", "NOT_FOUND", 404);
      }

      const curItemVer = item.version ?? 1;
      if (expectedVersion !== undefined && expectedVersion !== null) {
        if (Number(expectedVersion) !== curItemVer) {
          const conflictErr: any = new DomainError(
            `Inventory item was modified by another user (current: v${curItemVer}, expected: v${expectedVersion}). Please reload before adjusting stock.`,
            "CONCURRENT_MODIFICATION_CONFLICT",
            409
          );
          conflictErr.currentVersion = curItemVer;
          conflictErr.expectedVersion = Number(expectedVersion);
          throw conflictErr;
        }
      }

      const newQty = item.quantityOnHand + qChange;
      if (newQty < 0) {
        throw new DomainError(`Cannot reduce stock by ${Math.abs(qChange)}. Current quantity on hand is ${item.quantityOnHand}.`, "INSUFFICIENT_STOCK", 400);
      }

      const unitCostCentavos = Number(item.unitCost ?? 0);
      if (!Number.isFinite(unitCostCentavos) || unitCostCentavos <= 0) {
        throw new DomainError(
          `Inventory item '${item.name}' (${item.sku}) has no valid unit cost recorded. Record unit cost before posting stock valuation adjustments.`,
          "MISSING_UNIT_COST",
          400
        );
      }
      const valuationDeltaCentavos = Math.round(Math.abs(qChange) * unitCostCentavos);
      let journalEntryId: string | null = null;

      if (qChange < 0) {
        if (adjustmentType === 'STOCK_OUT') {
          journalEntryId = await AccountingEngine.postInventorySaleCOGS(companyId, userId, {
            saleId: adjId,
            saleNumber: adjNo,
            saleDate: adjDate,
            cogsCentavos: valuationDeltaCentavos,
            sku: item.sku,
            userRole: actorRole
          }, tx);
        } else {
          journalEntryId = await AccountingEngine.postInventorySpoilageAdjustment(companyId, userId, {
            adjustmentId: adjId,
            adjustmentNumber: adjNo,
            adjustmentDate: adjDate,
            spoilageValueCentavos: valuationDeltaCentavos,
            reason,
            itemName: item.name,
            userRole: actorRole
          }, tx);
        }
      } else {
        journalEntryId = await AccountingEngine.postGoodsReceiptNote(companyId, userId, {
          grnId: adjId,
          grnNumber: adjNo,
          receiptDate: adjDate,
          amountCentavos: valuationDeltaCentavos,
          vendorName: `Stock In Adjustment (${reason})`,
          userRole: actorRole
        }, tx);
      }

      const nextItemVer = curItemVer + 1;
      const updRes = await tx.update(schema.inventoryItems)
        .set({ quantityOnHand: newQty, version: nextItemVer, updatedAt: new Date() })
        .where(and(
          eq(schema.inventoryItems.id, itemId),
          eq(schema.inventoryItems.companyId, companyId),
          eq(schema.inventoryItems.version, curItemVer),
          sql`${schema.inventoryItems.quantityOnHand} + ${qChange} >= 0`
        ));

      if ((updRes as any)?.changes === 0) {
        const conflictErr: any = new DomainError("Concurrent modification conflict on inventory item stock", "CONCURRENT_MODIFICATION_CONFLICT", 409);
        conflictErr.currentVersion = curItemVer;
        throw conflictErr;
      }

      await tx.insert(schema.stockAdjustments).values({
        id: adjId,
        companyId,
        adjustmentNumber: adjNo,
        adjustmentDate: adjDate,
        itemId,
        quantityChange: qChange,
        reason,
        expenseAccountId: expenseAccountId || item.cogsAccountId,
        createdBy: userId,
      });

      await tx.insert(schema.inventoryTransactions).values({
        id: crypto.randomUUID(),
        companyId,
        itemId,
        transactionDate: adjDate,
        type: qChange > 0 ? 'IN' : 'OUT',
        reference: journalEntryId ? `${adjNo} (JE:${journalEntryId})` : adjNo,
        notes: reason,
        quantity: qChange,
        unitCost: unitCostCentavos,
        totalValue: qChange > 0 ? valuationDeltaCentavos : -valuationDeltaCentavos,
      });

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: "POST_STOCK_ADJUSTMENT",
        entityType: "stock_adjustments",
        entityId: adjId,
        recordReference: adjNo,
        module: "Inventory & Warehouse",
        reason,
        beforeData: JSON.stringify({ itemId, sku: item.sku, previousQuantityOnHand: item.quantityOnHand }),
        afterData: JSON.stringify({ itemId, sku: item.sku, quantityChange: qChange, newQuantityOnHand: newQty, journalEntryId })
      });

      return { journalEntryId, newQty };
    });

    res.json({ success: true, id: adjId, journalEntryId: txResult.journalEntryId, newQuantityOnHand: txResult.newQty, message: "Stock adjustment recorded and posted to General Ledger" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({
      error: err.code || "WORKFLOW_ERROR",
      message: err.message || "Failed stock adjustment",
      ...(err.currentVersion !== undefined ? { currentVersion: err.currentVersion } : {}),
      ...(err.expectedVersion !== undefined ? { expectedVersion: err.expectedVersion } : {}),
    });
  }
});

// Get Paginated Inventory Movements (1,000,000+ Movement Capacity Support)
router.get('/inventory/movements', requireAuth, requirePermission('inventory:view', 'reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const itemId = req.query.itemId as string | undefined;
  const type = req.query.type as string | undefined;

  try {
    const conds = [eq(schema.inventoryTransactions.companyId, companyId)];
    if (itemId) conds.push(eq(schema.inventoryTransactions.itemId, itemId));
    if (type) conds.push(eq(schema.inventoryTransactions.type, type));

    const [countRow] = await db.select({ total: sql<number>`count(*)` })
      .from(schema.inventoryTransactions)
      .where(and(...conds));
    const totalCount = Number(countRow?.total || 0);

    const rows = await db.select()
      .from(schema.inventoryTransactions)
      .where(and(...conds))
      .orderBy(desc(schema.inventoryTransactions.transactionDate), desc(schema.inventoryTransactions.id))
      .limit(limit)
      .offset(offset);

    res.json({
      items: rows,
      totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch inventory movements", message: err?.message });
  }
});

// Get Inventory Subledger Valuation Summary
router.get('/inventory/valuation', requireAuth, requirePermission('inventory:view', 'reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const [itemSummary] = await db.select({
      skuCount: sql<number>`count(*)`,
      totalQtyOnHand: sql<number>`COALESCE(sum(${schema.inventoryItems.quantityOnHand}), 0)`,
      totalSubledgerValueCentavos: sql<number>`COALESCE(sum(CAST(ROUND(${schema.inventoryItems.quantityOnHand} * ${schema.inventoryItems.unitCost}) AS INTEGER)), 0)`
    })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.companyId, companyId));

    const [movSummary] = await db.select({
      movementCount: sql<number>`count(*)`,
      netQty: sql<number>`COALESCE(sum(${schema.inventoryTransactions.quantity}), 0)`,
      netValueCentavos: sql<number>`COALESCE(sum(${schema.inventoryTransactions.totalValue}), 0)`
    })
    .from(schema.inventoryTransactions)
    .where(eq(schema.inventoryTransactions.companyId, companyId));

    const subledgerVal = Number(itemSummary?.totalSubledgerValueCentavos || 0);
    const movVal = Number(movSummary?.netValueCentavos || 0);
    const movCount = Number(movSummary?.movementCount || 0);

    res.json({
      companyId,
      skuCount: Number(itemSummary?.skuCount || 0),
      totalQuantityOnHand: Number(itemSummary?.totalQtyOnHand || 0),
      totalSubledgerValueCentavos: subledgerVal,
      movementCount: movCount,
      movementNetQuantity: Number(movSummary?.netQty || 0),
      movementNetValueCentavos: movVal,
      reconciled: movCount === 0 || Math.abs(subledgerVal - movVal) <= 1
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to compute inventory valuation", message: err?.message });
  }
});


// ==========================================
// 3. PAYROLL & MANDATORY CONTRIBUTIONS MODULE
// ==========================================

// Employee Roster
router.get('/payroll/employees', requireAuth, requirePermission('payroll:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'payroll');
    const filterConditions = [eq(schema.employees.companyId, companyId)];

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.employees.employeeNo, searchPattern),
          like(schema.employees.firstName, searchPattern),
          like(schema.employees.lastName, searchPattern),
          like(schema.employees.department, searchPattern)
        )!
      );
    }

    if (params.status) {
      filterConditions.push(eq(schema.employees.status, params.status));
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.employees.status}, 'ACTIVE')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const cursorCond = buildCursorCondition(
      schema.employees.employeeNo,
      schema.employees.id,
      params.decodedCursor,
      'ASC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const allMatching = await db
      .select()
      .from(schema.employees)
      .where(and(...queryConditions))
      .orderBy(schema.employees.employeeNo, schema.employees.id);

    const scopedEmps = scope.isCompanyWide
      ? allMatching
      : allMatching.filter(emp => scope.matchesRecord({ department: emp.department }));

    const totalCount = scopedEmps.length;
    const emps = scopedEmps.slice(0, params.limit + 1);

    res.json(formatPaginatedResponse({
      items: emps,
      limit: params.limit,
      getSortValAndId: (emp: any) => ({ val: emp.employeeNo, id: emp.id }),
      totalCount,
      raw: params.raw
    }));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

router.post('/payroll/employees', requireAuth, requirePermission('payroll:manage', 'payroll:process', 'payroll:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { 
    employeeNo, firstName, lastName, email, tin, sssNo, philhealthNo, pagibigNo, position, department, monthlyBasicSalary,
    customSssEE, customSssER, customPhilhealthEE, customPhilhealthER, customPagibigEE, customPagibigER, customWithholdingTax,
    departmentId, projectId, costCenterId
  } = req.body;

  if (!employeeNo || !firstName || !lastName || monthlyBasicSalary === undefined) {
    res.status(400).json({ error: "Employee No, Name, and Monthly Basic Salary are required" });
    return;
  }

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'payroll');
    if (!scope.isCompanyWide) {
      scope.assertRecordAccess({ department: department || 'General', departmentId, projectId, costCenterId }, 'employee record');
    }

    const id = crypto.randomUUID();
    const monthlyCentavos = Math.round(Number(monthlyBasicSalary) * 100);
    const dailyRateCentavos = Math.round(monthlyCentavos / 22);
    const hourlyRateCentavos = Math.round(dailyRateCentavos / 8);

    await db.insert(schema.employees).values({
      id,
      companyId,
      employeeNo,
      firstName,
      lastName,
      email: email || null,
      tin: tin || null,
      sssNo: sssNo || null,
      philhealthNo: philhealthNo || null,
      pagibigNo: pagibigNo || null,
      position: position || 'Staff',
      department: department || 'General',
      monthlyBasicSalary: monthlyCentavos,
      dailyRate: dailyRateCentavos,
      hourlyRate: hourlyRateCentavos,
      customSssEE: Math.round(Number(customSssEE || 0) * 100),
      customSssER: Math.round(Number(customSssER || 0) * 100),
      customPhilhealthEE: Math.round(Number(customPhilhealthEE || 0) * 100),
      customPhilhealthER: Math.round(Number(customPhilhealthER || 0) * 100),
      customPagibigEE: Math.round(Number(customPagibigEE || 0) * 100),
      customPagibigER: Math.round(Number(customPagibigER || 0) * 100),
      customWithholdingTax: Math.round(Number(customWithholdingTax || 0) * 100),
    });

    res.json({ success: true, id, message: "Employee added successfully" });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === 'DATA_SCOPE_VIOLATION') {
      res.status(403).json({ error: err.error || 'PERMISSION_DENIED', code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to add employee" });
  }
});

router.put('/payroll/employees/:id', requireAuth, requirePermission('payroll:manage', 'payroll:process', 'payroll:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const { 
    employeeNo, firstName, lastName, email, tin, sssNo, philhealthNo, pagibigNo, position, department, monthlyBasicSalary,
    customSssEE, customSssER, customPhilhealthEE, customPhilhealthER, customPagibigEE, customPagibigER, customWithholdingTax
  } = req.body;

  try {
    const existingEmp = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId))).get();
    if (!existingEmp) {
      res.status(404).json({ error: "NOT_FOUND", message: "Employee not found" });
      return;
    }

    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'payroll');
    if (!scope.isCompanyWide) {
      scope.assertRecordAccess({ department: existingEmp.department }, 'employee record');
      if (department) {
        scope.assertRecordAccess({ department }, 'employee target department');
      }
    }
    const expectedVersion = req.body.expectedVersion;
    const curEmpVer = existingEmp.version ?? 1;
    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (Number(expectedVersion) !== curEmpVer) {
        res.status(409).json({
          error: "CONCURRENT_MODIFICATION_CONFLICT",
          code: "STALE_RECORD_VERSION",
          message: `Employee record was modified by another session (current: v${curEmpVer}, expected: v${expectedVersion}). Please reload before saving changes.`,
          currentVersion: curEmpVer,
          expectedVersion: Number(expectedVersion)
        });
        return;
      }
    }

    const monthlyCentavos = Math.round(Number(monthlyBasicSalary) * 100);
    const dailyRateCentavos = Math.round(monthlyCentavos / 22);
    const hourlyRateCentavos = Math.round(dailyRateCentavos / 8);
    const nextEmpVer = curEmpVer + 1;

    const updResult = await db.update(schema.employees)
      .set({
        employeeNo,
        firstName,
        lastName,
        email: email || null,
        tin: tin || null,
        sssNo: sssNo || null,
        philhealthNo: philhealthNo || null,
        pagibigNo: pagibigNo || null,
        position: position || 'Staff',
        department: department || 'General',
        monthlyBasicSalary: monthlyCentavos,
        dailyRate: dailyRateCentavos,
        hourlyRate: hourlyRateCentavos,
        customSssEE: Math.round(Number(customSssEE || 0) * 100),
        customSssER: Math.round(Number(customSssER || 0) * 100),
        customPhilhealthEE: Math.round(Number(customPhilhealthEE || 0) * 100),
        customPhilhealthER: Math.round(Number(customPhilhealthER || 0) * 100),
        customPagibigEE: Math.round(Number(customPagibigEE || 0) * 100),
        customPagibigER: Math.round(Number(customPagibigER || 0) * 100),
        customWithholdingTax: Math.round(Number(customWithholdingTax || 0) * 100),
        version: nextEmpVer,
        updatedAt: new Date()
      })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId), eq(schema.employees.version, curEmpVer)));

    if ((updResult as any)?.changes === 0) {
      res.status(409).json({
        error: "CONCURRENT_MODIFICATION_CONFLICT",
        code: "STALE_RECORD_VERSION",
        message: `Employee record was concurrently updated by another transaction. Please reload and retry.`,
        currentVersion: curEmpVer
      });
      return;
    }

    res.json({ success: true, version: nextEmpVer, message: "Employee profile updated successfully" });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === 'DATA_SCOPE_VIOLATION') {
      res.status(403).json({ error: err.error || 'PERMISSION_DENIED', code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to update employee" });
  }
});

router.delete('/payroll/employees/:id', requireAuth, requirePermission('payroll:manage', 'payroll:process', 'payroll:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  try {
    const existingEmp = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId))).get();
    if (!existingEmp) {
      res.status(404).json({ error: "NOT_FOUND", message: "Employee not found" });
      return;
    }
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'payroll');
    if (!scope.isCompanyWide) {
      scope.assertRecordAccess({ department: existingEmp.department }, 'employee record');
    }

    await db.update(schema.employees)
      .set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId)));
    res.json({ success: true, message: "Employee deactivated successfully" });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === 'DATA_SCOPE_VIOLATION') {
      res.status(403).json({ error: err.error || 'PERMISSION_DENIED', code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to deactivate employee" });
  }
});

// Process Payroll Run (Compute SSS, PhilHealth, Pag-IBIG & BIR Withholding Tax)
router.post("/payroll/process", requireAuth, requirePermission('payroll:manage', 'payroll:process', 'payroll:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { 
    payrollPeriod, startDate, payPeriodStart, endDate, payPeriodEnd, paymentDate,
    employeeId, grossSalary, sssEmployee, philhealthEmployee, pagibigEmployee, withholdingTax, isMonthly 
  } = req.body;

  const finalPeriod = payrollPeriod || `${new Date().toISOString().slice(0, 7)}-${Date.now().toString().slice(-4)}`;
  const pDate = paymentDate || new Date().toISOString().slice(0, 10);
  const finalStartDate = startDate || payPeriodStart || new Date().toISOString().slice(0, 10);
  const finalEndDate = endDate || payPeriodEnd || new Date().toISOString().slice(0, 10);

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, userId, 'payroll');
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;

    // 1. Period & Lock Date Validation
    await validateTransactionDateAndPeriod(companyId, pDate, { userRole: actorRole });

    // 2. Idempotency Check - prevent double processing for the same period
    const existingRun = await db.select()
      .from(schema.payrollRuns)
      .where(
        and(
          eq(schema.payrollRuns.companyId, companyId),
          eq(schema.payrollRuns.payrollPeriod, finalPeriod)
        )
      )
      .get();

    if (existingRun) {
      res.status(400).json({ error: `Payroll for period ${finalPeriod} has already been processed and posted.` });
      return;
    }

    let emps = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, companyId), eq(schema.employees.status, 'ACTIVE')));
    if (!emps.length) {
      res.status(400).json({ error: "No active employees found to process payroll." });
      return;
    }

    if (employeeId && employeeId !== 'ALL_BATCH') {
      emps = emps.filter(e => e.id === employeeId);
      if (!emps.length) {
        res.status(400).json({ error: "Selected employee not found or inactive." });
        return;
      }
      if (!scope.isCompanyWide) {
        scope.assertRecordAccess({ department: emps[0].department }, 'payroll employee');
      }
    } else if (!scope.isCompanyWide) {
      emps = emps.filter(e => scope.matchesRecord({ department: e.department }));
      if (!emps.length) {
        res.status(403).json({ error: "PERMISSION_DENIED", code: "DATA_SCOPE_VIOLATION", message: "No active employees found within your assigned data scope." });
        return;
      }
    }

    const runId = crypto.randomUUID();
    let totalGross = 0;
    let totalSss = 0;
    let totalSssER = 0;
    let totalPh = 0;
    let totalPhER = 0;
    let totalPagibig = 0;
    let totalPagibigER = 0;
    let totalTax = 0;
    let totalNet = 0;

    const items = [];

    for (const emp of emps) {
      const isSingleOverride = employeeId === emp.id;
      const isFullMonth = isMonthly === true || isMonthly === 'true';

      // Daily Rate (22 working days default) & Hourly Rate (8 working hours default)
      const empDailyRate = emp.dailyRate > 0 ? emp.dailyRate : Math.round(emp.monthlyBasicSalary / 22);
      const empHourlyRate = emp.hourlyRate > 0 ? emp.hourlyRate : Math.round(empDailyRate / 8);

      // Time & Attendance Calculation
      let calculatedBasicPay = isFullMonth ? emp.monthlyBasicSalary : Math.round(emp.monthlyBasicSalary / 2);
      let calculatedOtPay = 0;
      let calculatedHolidayPay = 0;
      let calculatedNightDiffPay = 0;
      let calculatedDeductions = 0;

      if (isSingleOverride && req.body.daysWorked !== undefined && req.body.daysWorked !== null && Number(req.body.daysWorked) > 0) {
        calculatedBasicPay = Math.round(Number(req.body.daysWorked) * empDailyRate);
      }

      if (isSingleOverride && req.body.overtimePay !== undefined && req.body.overtimePay !== null) {
        calculatedOtPay = Math.round(Number(req.body.overtimePay) * 100);
      } else if (isSingleOverride && req.body.overtimeHours) {
        const regOt = Math.round(Number(req.body.overtimeHours) * empHourlyRate * 1.25);
        const restOt = Math.round(Number(req.body.restDayOtHours || 0) * empHourlyRate * 1.30);
        const holOt = Math.round(Number(req.body.holidayOtHours || 0) * empHourlyRate * 2.00);
        calculatedOtPay = regOt + restOt + holOt;
      }

      if (isSingleOverride && req.body.holidayPay !== undefined && req.body.holidayPay !== null) {
        calculatedHolidayPay = Math.round(Number(req.body.holidayPay) * 100);
      }

      if (isSingleOverride && req.body.nightDiffPay !== undefined && req.body.nightDiffPay !== null) {
        calculatedNightDiffPay = Math.round(Number(req.body.nightDiffPay) * 100);
      } else if (isSingleOverride && req.body.nightDiffHours) {
        calculatedNightDiffPay = Math.round(Number(req.body.nightDiffHours) * empHourlyRate * 0.10);
      }

      if (isSingleOverride && req.body.tardinessDeduction !== undefined && req.body.tardinessDeduction !== null) {
        calculatedDeductions = Math.round(Number(req.body.tardinessDeduction) * 100);
      } else if (isSingleOverride && (req.body.tardinessHours || req.body.absentDays)) {
        const late = Math.round(Number(req.body.tardinessHours || 0) * empHourlyRate);
        const absent = Math.round(Number(req.body.absentDays || 0) * empDailyRate);
        calculatedDeductions = late + absent;
      }

      const allowancesVal = (isSingleOverride && req.body.allowance) ? Math.round(Number(req.body.allowance) * 100) : 0;

      // Gross Salary Calculation
      let grossPay = calculatedBasicPay + calculatedOtPay + calculatedHolidayPay + calculatedNightDiffPay - calculatedDeductions + allowancesVal;
      if (grossPay < 0) grossPay = 0;

      if (isSingleOverride && grossSalary !== undefined && grossSalary !== null && grossSalary > 0) {
        grossPay = Math.round(Number(grossSalary) * 100);
      }

      // 1-3. Statutory Mandatory Deductions (SSS, PhilHealth, Pag-IBIG) via 2026 Discrete Statutory Engine
      const statutoryContribs = TaxEngine.calculate2026StatutoryContributions(grossPay, {
        frequency: isFullMonth ? 'MONTHLY' : 'SEMI_MONTHLY',
        sssScheduleVersion: '2026_STATUTORY_5PCT'
      });

      // SSS EE & ER
      let sssEE = 0;
      let sssER = 0;
      if (isSingleOverride && sssEmployee !== undefined && sssEmployee !== null) {
        sssEE = Math.round(Number(sssEmployee) * 100);
      } else if (emp.customSssEE && emp.customSssEE > 0) {
        sssEE = isFullMonth ? emp.customSssEE : Math.round(emp.customSssEE / 2);
      } else {
        sssEE = statutoryContribs.sssEmployeeCentavos;
      }

      if (emp.customSssER && emp.customSssER > 0) {
        sssER = isFullMonth ? emp.customSssER : Math.round(emp.customSssER / 2);
      } else {
        sssER = statutoryContribs.sssEmployerCentavos;
      }

      // PhilHealth EE & ER (2.5% EE + 2.5% ER, floor ₱10k/mo, ceiling ₱100k/mo)
      let phEE = 0;
      let phER = 0;
      if (isSingleOverride && philhealthEmployee !== undefined && philhealthEmployee !== null) {
        phEE = Math.round(Number(philhealthEmployee) * 100);
      } else if (emp.customPhilhealthEE && emp.customPhilhealthEE > 0) {
        phEE = isFullMonth ? emp.customPhilhealthEE : Math.round(emp.customPhilhealthEE / 2);
      } else {
        phEE = statutoryContribs.philhealthEmployeeCentavos;
      }

      if (emp.customPhilhealthER && emp.customPhilhealthER > 0) {
        phER = isFullMonth ? emp.customPhilhealthER : Math.round(emp.customPhilhealthER / 2);
      } else {
        phER = statutoryContribs.philhealthEmployerCentavos;
      }

      // Pag-IBIG EE & ER (HDMF Circular 460: 2% EE + 2% ER on ₱10k MFS ceiling = ₱200/mo or ₱100/semi-monthly)
      let pagibigEE = 0;
      let pagibigER = 0;
      if (isSingleOverride && pagibigEmployee !== undefined && pagibigEmployee !== null) {
        pagibigEE = Math.round(Number(pagibigEmployee) * 100);
      } else if (emp.customPagibigEE && emp.customPagibigEE > 0) {
        pagibigEE = isFullMonth ? emp.customPagibigEE : Math.round(emp.customPagibigEE / 2);
      } else {
        pagibigEE = statutoryContribs.pagibigEmployeeCentavos;
      }

      if (emp.customPagibigER && emp.customPagibigER > 0) {
        pagibigER = isFullMonth ? emp.customPagibigER : Math.round(emp.customPagibigER / 2);
      } else {
        pagibigER = statutoryContribs.pagibigEmployerCentavos;
      }

      // 4. BIR TRAIN Law Withholding Tax (RA 10963 / RR 11-2018 2023+ Graduated Brackets)
      let wTax = 0;
      if (isSingleOverride && withholdingTax !== undefined && withholdingTax !== null) {
        wTax = Math.round(Number(withholdingTax) * 100);
      } else if (emp.customWithholdingTax && emp.customWithholdingTax > 0) {
        wTax = isFullMonth ? emp.customWithholdingTax : Math.round(emp.customWithholdingTax / 2);
      } else {
        const statutoryWht = TaxEngine.calculateStatutoryPayrollWithholding(grossPay, {
          frequency: isFullMonth ? 'MONTHLY' : 'SEMI_MONTHLY',
          sssEmployeeCentavos: sssEE,
          philhealthEmployeeCentavos: phEE,
          pagibigEmployeeCentavos: pagibigEE,
          nonTaxableBenefitsCentavos: 0
        });
        wTax = statutoryWht.withholdingTaxCentavos;
      }

      const totalDeductions = sssEE + phEE + pagibigEE + wTax;
      const netPay = grossPay - totalDeductions;

      totalGross += grossPay;
      totalSss += sssEE;
      totalSssER += sssER;
      totalPh += phEE;
      totalPhER += phER;
      totalPagibig += pagibigEE;
      totalPagibigER += pagibigER;
      totalTax += wTax;
      totalNet += netPay;

      const itemId = crypto.randomUUID();
      items.push({
        id: itemId,
        payrollRunId: runId,
        employeeId: emp.id,
        basicPay: calculatedBasicPay,
        overtimePay: calculatedOtPay,
        holidayPay: calculatedHolidayPay,
        nightDiffPay: calculatedNightDiffPay,
        grossPay,
        sssEmployee: sssEE,
        sssEmployer: sssER,
        philhealthEmployee: phEE,
        philhealthEmployer: phER,
        pagibigEmployee: pagibigEE,
        pagibigEmployer: pagibigER,
        withholdingTax: wTax,
        totalDeductions,
        netPay,
      });
    }

    let journalEntryId: string | null = null;

    // 3. Atomic Database Transaction
    await db.transaction(async (tx) => {
      // Post payroll general ledger entries using the existing AccountingEngine
      journalEntryId = await AccountingEngine.postPayrollRun(companyId, userId, {
        payrollRunId: runId,
        payrollPeriod: finalPeriod,
        paymentDate: pDate,
        grossPayCentavos: totalGross,
        sssEmployeeCentavos: totalSss,
        sssEmployerCentavos: totalSssER,
        philhealthEmployeeCentavos: totalPh,
        philhealthEmployerCentavos: totalPhER,
        pagibigEmployeeCentavos: totalPagibig,
        pagibigEmployerCentavos: totalPagibigER,
        withholdingTaxCentavos: totalTax,
        netPayCentavos: totalNet,
        userRole: actorRole
      }, tx);

      // Insert payroll run as POSTED with journal reference
      await tx.insert(schema.payrollRuns).values({
        id: runId,
        companyId,
        payrollPeriod: finalPeriod,
        startDate: finalStartDate,
        endDate: finalEndDate,
        paymentDate: pDate,
        totalGrossPay: totalGross,
        totalSss,
        totalPhilhealth: totalPh,
        totalPagibig,
        totalWithholdingTax: totalTax,
        totalNetPay: totalNet,
        status: 'POSTED',
        journalEntryId,
        createdBy: userId,
        approvedBy: userId
      });

      for (const item of items) {
        await tx.insert(schema.payrollItems).values(item);
      }
    });

    res.json({
      success: true,
      payrollRunId: runId,
      summary: {
        totalEmployees: emps.length,
        totalGrossPayPhp: totalGross / 100,
        totalGovernmentDeductionsPhp: (totalSss + totalPh + totalPagibig) / 100,
        totalWithholdingTaxPhp: totalTax / 100,
        totalNetPayPhp: totalNet / 100
      },
      message: "Payroll processed, approved, and posted to General Ledger successfully."
    });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === 'DATA_SCOPE_VIOLATION') {
      res.status(403).json({ error: err.code || err.error || 'PERMISSION_DENIED', code: err.code, message: err.message });
      return;
    }
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to process payroll" });
  }
});


// ==========================================
// 4. CASH, TREASURY & FIXED ASSETS
// ==========================================

// Fixed Asset Register & Depreciation
router.get('/fixed-assets', requireAuth, requirePermission('fixed_assets:view', 'fixedassets:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  try {
    const filterConditions = [eq(schema.fixedAssets.companyId, companyId)];

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.fixedAssets.assetTag, searchPattern),
          like(schema.fixedAssets.assetName, searchPattern),
          like(schema.fixedAssets.category, searchPattern)
        )!
      );
    }

    if (params.status) {
      filterConditions.push(eq(schema.fixedAssets.status, params.status));
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.fixedAssets.status}, 'ACTIVE')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const cursorCond = buildCursorCondition(
      schema.fixedAssets.acquisitionDate,
      schema.fixedAssets.id,
      params.decodedCursor,
      'DESC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.fixedAssets)
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const assets = await db
      .select()
      .from(schema.fixedAssets)
      .where(and(...queryConditions))
      .orderBy(desc(schema.fixedAssets.acquisitionDate), desc(schema.fixedAssets.id))
      .limit(params.limit + 1);

    // Batch-aggregate posted depreciation across all fetched fixed assets in ONE query (zero N+1)
    const assetIds = assets.map(a => a.id);
    const postedDepMap = new Map<string, number>();
    if (assetIds.length > 0) {
      const depAggRows = await db.select({
        assetId: schema.depreciationSchedules.assetId,
        totalDep: sql<number>`COALESCE(SUM(${schema.depreciationSchedules.depreciationAmount}), 0)`
      })
      .from(schema.depreciationSchedules)
      .where(and(
        eq(schema.depreciationSchedules.companyId, companyId),
        eq(schema.depreciationSchedules.status, 'POSTED'),
        inArray(schema.depreciationSchedules.assetId, assetIds)
      ))
      .groupBy(schema.depreciationSchedules.assetId);

      for (const row of depAggRows) {
        postedDepMap.set(row.assetId, Number(row.totalDep || 0));
      }
    }

    const enriched = assets.map((a) => {
      const totalPostDepCentavos = postedDepMap.get(a.id) || 0;
      return {
        ...a,
        assetCode: a.assetTag,
        acquisitionCost: a.acquisitionCost / 100,
        salvageValue: a.salvageValue / 100,
        accumulatedDepreciation: totalPostDepCentavos / 100,
        usefulLifeYears: Math.round(a.usefulLifeMonths / 12),
        rawAcquisitionCost: a.acquisitionCost,
        rawSalvageValue: a.salvageValue
      };
    });

    res.json(formatPaginatedResponse({
      items: enriched,
      limit: params.limit,
      getSortValAndId: (a: any) => ({ val: a.acquisitionDate, id: a.id }),
      totalCount,
      raw: params.raw
    }));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch fixed assets" });
  }
});

router.post("/fixed-assets", requireAuth, requirePermission('fixed_assets:manage', 'fixedassets:manage', 'fixed_assets:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { 
    assetTag, 
    assetCode, // fallback from UI
    assetName, 
    category, 
    acquisitionDate, 
    acquisitionCost, 
    salvageValue, 
    usefulLifeMonths,
    usefulLifeYears, // fallback from UI
    assetAccountId, 
    accumulatedDepAccountId, 
    depreciationExpenseAccountId,
    department,
    departmentId,
    projectId,
    costCenterId
  } = req.body;

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, userId, 'fixed-assets');
    if (!scope.isCompanyWide && (department || departmentId || projectId || costCenterId)) {
      scope.assertRecordAccess({ department, departmentId, projectId, costCenterId }, 'fixed asset');
    }
  } catch (scopeErr: any) {
    res.status(scopeErr.statusCode || 403).json({ error: scopeErr.error || 'PERMISSION_DENIED', code: scopeErr.code, message: scopeErr.message });
    return;
  }

  const finalAssetTag = assetTag || assetCode;
  const finalUsefulLifeMonths =
    usefulLifeMonths !== undefined && usefulLifeMonths !== null
      ? Number(usefulLifeMonths)
      : usefulLifeYears !== undefined && usefulLifeYears !== null
      ? Number(usefulLifeYears) * 12
      : 0;

  if (!finalAssetTag || !assetName || acquisitionCost === undefined || acquisitionCost === null) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Asset Tag/Code, Name, Acquisition Cost, and Useful Life are required" });
    return;
  }

  const faValidation = validateFixedAssetInput({
    acquisitionCost: Number(acquisitionCost),
    salvageValue: salvageValue !== undefined && salvageValue !== null ? Number(salvageValue) : 0,
    usefulLifeMonths: finalUsefulLifeMonths,
  });
  if (!faValidation.ok) {
    const errMsg = "message" in faValidation ? faValidation.message : "Invalid fixed asset input parameters.";
    res.status(400).json({ error: "VALIDATION_ERROR", message: errMsg });
    return;
  }

  try {
    const id = crypto.randomUUID();
    const costCentavos = Math.round(Number(acquisitionCost) * 100);
    const salvageCentavos = Math.round((Number(salvageValue) || 0) * 100);
    const lifeMonths = Number(finalUsefulLifeMonths);
    const acqDate = acquisitionDate || new Date().toISOString().slice(0, 10);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;

    const capitalizeToGl = req.body.capitalizeToGl === true;
    const fundingAccountId = req.body.fundingAccountId || null;
    let capitalizationJournalEntryId: string | null = null;

    const validatedPeriod = await validateTransactionDateAndPeriod(companyId, acqDate, { userRole: actorRole });

    const scheduleMonths = Math.min(Math.max(1, Math.trunc(lifeMonths)), 600);
    const depreciableBase = Math.max(0, costCentavos - salvageCentavos);
    const baseMonthlyDep = Math.floor(depreciableBase / scheduleMonths);
    const monthlyDep = Math.round(depreciableBase / scheduleMonths);
    const [acqYearStr, acqMonthStr] = String(acqDate).slice(0, 10).split('-');
    const acqYear = Number(acqYearStr) || new Date().getUTCFullYear();
    const acqMonth = Number(acqMonthStr) || 1;

    await db.transaction(async (tx) => {
      let resolvedAssetAccId = assetAccountId || null;
      if (!resolvedAssetAccId) {
        const companyAccounts = await tx
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.companyId, companyId));
        const defaultAssetAcc =
          companyAccounts.find((a) => ['1700', '1210', '1510', '1600'].includes(String(a.accountCode))) ||
          companyAccounts.find(
            (a) =>
              String(a.accountType).toUpperCase() === 'ASSET' &&
              /fixed asset|property|plant|equipment/i.test(String(a.accountName || ''))
          );
        resolvedAssetAccId = defaultAssetAcc?.id || null;
      }

      await tx.insert(schema.fixedAssets).values({
        id,
        companyId,
        assetTag: finalAssetTag,
        assetName,
        category: category || 'EQUIPMENT',
        acquisitionDate: acqDate,
        acquisitionCost: costCentavos,
        salvageValue: salvageCentavos,
        usefulLifeMonths: lifeMonths,
        depreciationMethod: 'STRAIGHT_LINE',
        assetAccountId: resolvedAssetAccId,
        accumulatedDepAccountId: accumulatedDepAccountId || null,
        depreciationExpenseAccountId: depreciationExpenseAccountId || null
      });

      let accum = 0;
      for (let i = 1; i <= scheduleMonths; i++) {
        const monthDep = i === scheduleMonths ? Math.max(0, depreciableBase - accum) : baseMonthlyDep;
        accum += monthDep;
        const totalMonths = acqYear * 12 + (acqMonth - 1) + i;
        const schedYear = Math.floor(totalMonths / 12);
        const schedMonth = (totalMonths % 12) + 1;
        const periodMonth = `${schedYear}-${String(schedMonth).padStart(2, '0')}`;

        await tx.insert(schema.depreciationSchedules).values({
          id: crypto.randomUUID(),
          assetId: id,
          companyId,
          periodMonth,
          depreciationAmount: monthDep,
          accumulatedDepreciation: accum,
          bookValue: Math.max(salvageCentavos, costCentavos - accum),
          status: 'PENDING'
        });
      }

      if (capitalizeToGl && costCentavos > 0 && resolvedAssetAccId) {
        let resolvedFundingAccId = fundingAccountId;
        if (!resolvedFundingAccId) {
          const cashAcc = await resolveCompanyControlAccount(tx, companyId, 'CASH');
          resolvedFundingAccId = cashAcc?.id || null;
        }
        if (resolvedFundingAccId) {
          const jeId = crypto.randomUUID();
          const jeNumber = `JE-FA-CAP-${finalAssetTag}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
          await tx.insert(schema.journalEntries).values({
            id: jeId,
            companyId,
            accountingPeriodId: validatedPeriod.id,
            journalNumber: jeNumber,
            entryDate: acqDate,
            description: `Fixed Asset Capitalization: ${assetName} (${finalAssetTag})`,
            sourceType: 'FIXED_ASSET',
            sourceId: id,
            status: 'POSTED',
            createdBy: userId,
            approvedBy: userId,
            postedBy: userId,
            postedAt: new Date(),
          });
          await tx.insert(schema.journalLines).values([
            {
              id: crypto.randomUUID(),
              journalEntryId: jeId,
              accountId: resolvedAssetAccId,
              description: `Capitalize Fixed Asset ${finalAssetTag} - ${assetName}`,
              debit: costCentavos,
              credit: 0,
              lineNumber: 1,
            },
            {
              id: crypto.randomUUID(),
              journalEntryId: jeId,
              accountId: resolvedFundingAccId,
              description: `Funding for Fixed Asset ${finalAssetTag}`,
              debit: 0,
              credit: costCentavos,
              lineNumber: 2,
            },
          ]);
          capitalizationJournalEntryId = jeId;
        }
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: "CAPITALIZE_FIXED_ASSET",
        entityType: "fixed_assets",
        entityId: id,
        recordReference: finalAssetTag,
        module: "Fixed Assets",
        afterData: JSON.stringify({
          assetTag: finalAssetTag,
          assetName,
          category: category || 'EQUIPMENT',
          acquisitionCostCentavos: costCentavos,
          usefulLifeMonths: scheduleMonths,
          capitalizationJournalEntryId,
        })
      });
    });

    res.json({
      success: true,
      id,
      journalEntryId: capitalizationJournalEntryId,
      monthlyDepreciationPhp: monthlyDep / 100,
      message: capitalizationJournalEntryId
        ? "Fixed asset capitalized to General Ledger and depreciation schedule created."
        : "Fixed asset and depreciation schedule created."
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to create fixed asset" });
  }
});

// Post Monthly Depreciation Schedule Run (execute straight-line monthly schedules and post to GL)
router.post("/depreciation/post", requireAuth, requirePermission('fixed_assets:manage', 'fixedassets:manage', 'accounting:post', 'fixed_assets:depreciate'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { periodMonth } = req.body; // e.g. "2026-08"

  if (!periodMonth) {
    res.status(400).json({ error: "Period Month (YYYY-MM) is required" });
    return;
  }

  try {
    // 1. Period Lock & Date Validation
    const postingDate = `${periodMonth}-28`;
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await validateTransactionDateAndPeriod(companyId, postingDate, { userRole: actorRole });

    let processedCount = 0;
    const postedScheduleIds: string[] = [];

    // 2. Query pending schedules AND post atomically inside transaction to eliminate race duplicates
    await db.transaction(async (tx) => {
      const schedules = await tx.select()
        .from(schema.depreciationSchedules)
        .where(
          and(
            eq(schema.depreciationSchedules.companyId, companyId),
            eq(schema.depreciationSchedules.periodMonth, periodMonth),
            eq(schema.depreciationSchedules.status, 'PENDING')
          )
        );

      if (!schedules.length) {
        const alreadyPosted = await tx.select({ id: schema.depreciationSchedules.id })
          .from(schema.depreciationSchedules)
          .where(
            and(
              eq(schema.depreciationSchedules.companyId, companyId),
              eq(schema.depreciationSchedules.periodMonth, periodMonth),
              eq(schema.depreciationSchedules.status, 'POSTED')
            )
          )
          .get();
        if (alreadyPosted) {
          throw new DomainError(
            `Depreciation schedules for month ${periodMonth} have already been posted.`,
            "CONCURRENT_MODIFICATION_CONFLICT",
            409
          );
        }
        throw new DomainError(`No pending depreciation schedules found for month ${periodMonth}.`, "NO_PENDING_SCHEDULES", 400);
      }

      for (const sched of schedules) {
        const asset = await tx.select()
          .from(schema.fixedAssets)
          .where(and(eq(schema.fixedAssets.id, sched.assetId), eq(schema.fixedAssets.companyId, companyId)))
          .get();

        if (!asset) {
          throw new Error(`Asset not found for schedule ${sched.id}`);
        }
        if (asset.status !== 'ACTIVE') {
          continue; // Never depreciate disposed/retired/inactive assets
        }

        const journalEntryId = await AccountingEngine.postMonthlyDepreciation(companyId, userId, {
          scheduleId: sched.id,
          assetId: sched.assetId,
          assetName: asset.assetName,
          periodMonth: sched.periodMonth,
          depreciationAmountCentavos: sched.depreciationAmount,
          depreciationExpenseAccountId: asset.depreciationExpenseAccountId,
          accumulatedDepAccountId: asset.accumulatedDepAccountId,
          userRole: actorRole
        }, tx);

        const updSched = await tx.update(schema.depreciationSchedules)
          .set({
            status: 'POSTED',
            journalEntryId
          })
          .where(and(eq(schema.depreciationSchedules.id, sched.id), eq(schema.depreciationSchedules.status, 'PENDING')));

        if ((updSched as any)?.changes === 0) {
          throw new DomainError(
            `Concurrent modification: Depreciation schedule ${sched.id} was already posted.`,
            "CONCURRENT_MODIFICATION_CONFLICT",
            409
          );
        }

        processedCount++;
        postedScheduleIds.push(sched.id);
      }

      if (processedCount === 0) {
        throw new DomainError(`No active fixed assets with pending depreciation found for month ${periodMonth}.`, "NO_ACTIVE_ASSETS", 400);
      }
    });

    await AuditService.log({
      req,
      companyId,
      userId,
      action: "POST_MONTHLY_DEPRECIATION",
      entityType: "depreciation_schedules",
      entityId: periodMonth,
      entityName: `Depreciation Run ${periodMonth}`,
      module: "Fixed Assets",
      result: "SUCCESS",
      afterData: { periodMonth, processedCount, postedScheduleIds }
    });

    res.json({
      success: true,
      processedCount,
      message: `Successfully posted ${processedCount} monthly depreciation schedule entries to General Ledger.`
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to post monthly depreciation schedules" });
  }
});


// ==========================================
// 5. PROCUREMENT & 3-WAY MATCHING (PO -> GRN -> BILL)
// ==========================================

// List Purchase Orders with authoritative full-DB KPI summary, GRN receiving state & linked AP bill status
router.get("/procurement/purchase-orders", requireAuth, requirePermission('purchases:view', 'procurement:manage', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'procurement');
    const requestedLimit = Math.min(2000, Math.max(1, Number(req.query.limit) || 1000));

    // Load all non-archived POs for authoritative KPI computation & full register parity
    const allPos = await db.select({
      id: schema.purchaseOrders.id,
      companyId: schema.purchaseOrders.companyId,
      vendorId: schema.purchaseOrders.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      vendorTin: schema.vendors.tin,
      vendorTaxClassification: schema.vendors.taxClassification,
      poNumber: schema.purchaseOrders.poNumber,
      poDate: schema.purchaseOrders.poDate,
      orderDate: schema.purchaseOrders.poDate,
      expectedDeliveryDate: schema.purchaseOrders.expectedDeliveryDate,
      totalAmount: schema.purchaseOrders.totalAmount,
      status: schema.purchaseOrders.status,
      createdBy: schema.purchaseOrders.createdBy,
      approvedBy: schema.purchaseOrders.approvedBy,
      createdAt: schema.purchaseOrders.createdAt,
    })
      .from(schema.purchaseOrders)
      .leftJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
      .where(and(
        eq(schema.purchaseOrders.companyId, companyId),
        sql`UPPER(COALESCE(${schema.purchaseOrders.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
      ))
      .orderBy(desc(schema.purchaseOrders.poDate), desc(schema.purchaseOrders.id));

    const scopedPos = scope.isCompanyWide
      ? allPos
      : allPos.filter(po => scope.matchesRecord({ createdBy: po.createdBy }));

    // Fetch ALL company GRNs and active PO-referenced Purchase Bills to compute exact bidirectional linkage
    const grnMap: Record<string, any[]> = {};
    const billMap: Record<string, any[]> = {};

    if (scopedPos.length > 0) {
      const allGrns = await db.select().from(schema.goodsReceiptNotes).where(
        and(
          eq(schema.goodsReceiptNotes.companyId, companyId),
          sql`UPPER(COALESCE(${schema.goodsReceiptNotes.status}, 'RECEIVED')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED')`
        )
      );
      for (const grn of allGrns) {
        if (!grnMap[grn.poId]) grnMap[grn.poId] = [];
        grnMap[grn.poId].push(grn);
      }

      const poNumberSet = new Set(scopedPos.map(p => p.poNumber));
      const allRefBills = await db.select({
        id: schema.purchaseBills.id,
        billNumber: schema.purchaseBills.billNumber,
        reference: schema.purchaseBills.reference,
        status: schema.purchaseBills.status,
        totalAmount: schema.purchaseBills.totalAmount,
        balanceDue: schema.purchaseBills.balanceDue,
        billDate: schema.purchaseBills.billDate,
        dueDate: schema.purchaseBills.dueDate,
      })
        .from(schema.purchaseBills)
        .where(
          and(
            eq(schema.purchaseBills.companyId, companyId),
            sql`${schema.purchaseBills.reference} IS NOT NULL`,
            sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED', 'REVERSED')`
          )
        );
      for (const b of allRefBills) {
        if (b.reference && poNumberSet.has(b.reference)) {
          if (!billMap[b.reference]) billMap[b.reference] = [];
          billMap[b.reference].push(b);
        }
      }
    }

    const RECEIVED_GRN_STATUSES = new Set(['RECEIVED', 'COMPLETED', 'INSPECTED', 'APPROVED', 'CLOSED']);

    const allEnrichedPos = scopedPos.map(po => {
      const linkedGrns = grnMap[po.id] || [];
      const linkedBills = billMap[po.poNumber] || [];
      const primaryBill = linkedBills[0] || null;
      const hasGrn = linkedGrns.length > 0;
      const hasBill = linkedBills.length > 0;

      let receivingStatus: 'GRN_RECEIVED' | 'PARTIALLY_RECEIVED' | 'PENDING_INSPECTION' = 'PENDING_INSPECTION';
      if (hasGrn) {
        receivingStatus = linkedGrns.some(g => RECEIVED_GRN_STATUSES.has(String(g.status || '').toUpperCase()))
          ? 'GRN_RECEIVED'
          : 'PARTIALLY_RECEIVED';
      }

      const normalizedBillStatus = primaryBill
        ? (String(primaryBill.status || 'DRAFT').toUpperCase() === 'PARTIALLY_PAID'
            ? 'PARTIAL'
            : String(primaryBill.status || 'DRAFT').toUpperCase())
        : null;

      let matchStatus: 'MATCHED_AND_BILLED' | 'READY_FOR_MATCH' | 'PENDING_GRN' = 'PENDING_GRN';
      if (hasBill) {
        matchStatus = 'MATCHED_AND_BILLED';
      } else if (hasGrn) {
        matchStatus = 'READY_FOR_MATCH';
      }

      let apRecognitionState: 'PAID' | 'POSTED_OPEN_AP' | 'PENDING_GL_POSTING' | 'UNBILLED' = 'UNBILLED';
      if (normalizedBillStatus === 'PAID') {
        apRecognitionState = 'PAID';
      } else if (normalizedBillStatus === 'POSTED' || normalizedBillStatus === 'PARTIAL') {
        apRecognitionState = 'POSTED_OPEN_AP';
      } else if (normalizedBillStatus) {
        apRecognitionState = 'PENDING_GL_POSTING';
      }

      return {
        ...po,
        grnStatus: receivingStatus,
        matchStatus,
        apRecognitionState,
        linkedGrnCount: linkedGrns.length,
        linkedBillCount: linkedBills.length,
        linkedGrnNumbers: linkedGrns.map(g => g.grnNumber),
        linkedBillNumbers: linkedBills.map(b => b.billNumber),
        linkedBillId: primaryBill?.id || null,
        linkedBillNumber: primaryBill?.billNumber || null,
        linkedBillStatus: normalizedBillStatus,
        linkedBillTotalCentavos: primaryBill ? Number(primaryBill.totalAmount || 0) : null,
        linkedBillBalanceDueCentavos: primaryBill ? Number(primaryBill.balanceDue || 0) : null,
        linkedBillPaidCentavos: primaryBill
          ? Math.max(0, Number(primaryBill.totalAmount || 0) - Number(primaryBill.balanceDue || 0))
          : null,
      };
    });

    // Compute mutually exclusive, authoritative database-wide Procurement KPIs
    let totalCumulativeCommitmentsCentavos = 0;
    let totalOpenCommitmentsCentavos = 0;
    let openPoCount = 0;
    let closedPoCount = 0;
    let cancelledPoCount = 0;
    let pendingMatchCount = 0;
    let readyForMatchCount = 0;
    let pendingGrnCount = 0;
    let matchedAndBilledCount = 0;
    let pendingGlPostingBillCount = 0;
    let pendingGlPostingCentavos = 0;
    let postedApBillCount = 0;
    let postedApOpenCentavos = 0;
    let paidBillCount = 0;
    let paidBillCentavos = 0;

    for (const po of allEnrichedPos) {
      const poStatus = String(po.status || 'APPROVED').toUpperCase();
      const amt = Number(po.totalAmount || 0);

      if (poStatus === 'CANCELLED') {
        cancelledPoCount++;
        continue;
      }

      totalCumulativeCommitmentsCentavos += amt;
      if (poStatus === 'CLOSED') {
        closedPoCount++;
      } else {
        openPoCount++;
        totalOpenCommitmentsCentavos += amt;
      }

      if (po.matchStatus === 'MATCHED_AND_BILLED') {
        matchedAndBilledCount++;
        if (po.apRecognitionState === 'PAID') {
          paidBillCount++;
          paidBillCentavos += Number(po.linkedBillTotalCentavos || 0);
        } else if (po.apRecognitionState === 'POSTED_OPEN_AP') {
          postedApBillCount++;
          postedApOpenCentavos += Number(po.linkedBillBalanceDueCentavos || 0);
        } else if (po.apRecognitionState === 'PENDING_GL_POSTING') {
          pendingGlPostingBillCount++;
          pendingGlPostingCentavos += Number(po.linkedBillTotalCentavos || 0);
        }
      } else {
        pendingMatchCount++;
        if (po.matchStatus === 'READY_FOR_MATCH') {
          readyForMatchCount++;
        } else {
          pendingGrnCount++;
        }
      }
    }

    // Live company-wide AP subledger & GL Account 2010 parity snapshot (with PO-Linked vs Direct Non-PO breakdown)
    const allPoNumbers = new Set(allPos.map(p => String(p.poNumber || '').trim()).filter(Boolean));
    const allActiveBills = await db
      .select({
        id: schema.purchaseBills.id,
        reference: schema.purchaseBills.reference,
        status: schema.purchaseBills.status,
        balanceDue: schema.purchaseBills.balanceDue,
      })
      .from(schema.purchaseBills)
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED', 'REVERSED')`
        )
      );

    let totalCompanyApOutstandingCentavos = 0;
    let totalActiveBillsCount = 0;
    let poLinkedActiveBillsCount = 0;
    let directNonPoActiveBillsCount = 0;
    let poLinkedOpenApCentavos = 0;
    let directNonPoOpenApCentavos = 0;

    for (const bill of allActiveBills) {
      totalActiveBillsCount++;
      const ref = String(bill.reference || '').trim();
      const isPoLinked = ref.length > 0 && allPoNumbers.has(ref);
      if (isPoLinked) {
        poLinkedActiveBillsCount++;
      } else {
        directNonPoActiveBillsCount++;
      }
      const st = String(bill.status || 'DRAFT').toUpperCase();
      const bal = Number(bill.balanceDue || 0);
      if (['POSTED', 'PARTIAL', 'PARTIALLY_PAID'].includes(st) && bal > 0) {
        totalCompanyApOutstandingCentavos += bal;
        if (isPoLinked) {
          poLinkedOpenApCentavos += bal;
        } else {
          directNonPoOpenApCentavos += bal;
        }
      }
    }

    const [glApRow] = await db
      .select({
        glApBalance: sql<number>`COALESCE(SUM(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.status, 'POSTED'),
          or(
            eq(schema.accounts.accountCode, '2010'),
            like(sql`LOWER(${schema.accounts.accountName})`, '%accounts payable%')
          )!
        )
      );

    const glAp2010BalanceCentavos = Number(glApRow?.glApBalance || 0);

    const returnedItems = allEnrichedPos.slice(0, requestedLimit);

    if (String(req.query.raw || '').toLowerCase() === 'true') {
      res.json(returnedItems);
      return;
    }

    res.json({
      items: returnedItems,
      data: returnedItems,
      pagination: {
        totalCount: allEnrichedPos.length,
        returnedCount: returnedItems.length,
        limit: requestedLimit,
      },
      summary: {
        totalPoCount: allEnrichedPos.length,
        openPoCount,
        closedPoCount,
        cancelledPoCount,
        totalCumulativeCommitmentsCentavos,
        totalOpenCommitmentsCentavos,
        pendingMatchCount,
        readyForMatchCount,
        pendingGrnCount,
        matchedAndBilledCount,
        pendingGlPostingBillCount,
        pendingGlPostingCentavos,
        postedApBillCount,
        postedApOpenCentavos,
        paidBillCount,
        paidBillCentavos,
        totalCompanyApOutstandingCentavos,
        totalActiveBillsCount,
        poLinkedActiveBillsCount,
        directNonPoActiveBillsCount,
        poLinkedOpenApCentavos,
        directNonPoOpenApCentavos,
        glAp2010BalanceCentavos,
        isGlReconciled: Math.abs(totalCompanyApOutstandingCentavos - glAp2010BalanceCentavos) < 1,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch purchase orders" });
  }
});

// Create Purchase Order
router.post("/procurement/purchase-orders", requireAuth, requirePermission('purchases:create', 'purchases:edit', 'procurement:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { vendorId, poNumber, poDate, orderDate, expectedDeliveryDate, expectedTotal, items, department, departmentId, projectId, costCenterId } = req.body;

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, userId, 'procurement');
    if (!scope.isCompanyWide && (department || departmentId || projectId || costCenterId)) {
      scope.assertRecordAccess({ department, departmentId, projectId, costCenterId }, 'purchase order');
    }
  } catch (scopeErr: any) {
    res.status(scopeErr.statusCode || 403).json({ error: scopeErr.error || 'PERMISSION_DENIED', code: scopeErr.code, message: scopeErr.message });
    return;
  }

  if (!vendorId || !poNumber) {
    res.status(400).json({ error: "Vendor and PO number are required" });
    return;
  }

  try {
    const poId = crypto.randomUUID();
    let total = 0;

    const poItems = Array.isArray(items) && items.length > 0
      ? items
      : [{ description: 'Authorized Procurement Order', quantity: 1, unitPrice: Number(expectedTotal) || 15000 }];

    for (const item of poItems) {
      total += Math.round(Number(item.quantity || 1) * Number(item.unitPrice || expectedTotal || 0) * 100);
    }
    if (expectedTotal && total === 0) {
      total = Math.round(Number(expectedTotal) * 100);
    }

    const finalPoDate = poDate || orderDate || new Date().toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      await tx.insert(schema.purchaseOrders).values({
        id: poId,
        companyId,
        vendorId,
        poNumber,
        poDate: finalPoDate,
        expectedDeliveryDate: expectedDeliveryDate || null,
        totalAmount: total,
        status: 'APPROVED',
        createdBy: userId,
        approvedBy: userId
      });

      for (const item of poItems) {
        const lineAmt = Math.round(Number(item.quantity || 1) * Number(item.unitPrice || expectedTotal || 0) * 100);
        await tx.insert(schema.purchaseOrderLines).values({
          id: crypto.randomUUID(),
          poId,
          itemId: item.itemId || null,
          description: item.description || 'PO Item',
          quantityOrdered: Number(item.quantity || 1),
          quantityReceived: 0,
          unitPrice: Math.round(Number(item.unitPrice || expectedTotal || 0) * 100),
          amount: lineAmt
        });
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: "CREATE_PURCHASE_ORDER",
        entityType: "purchase_orders",
        entityId: poId,
        recordReference: poNumber,
        module: "Procurement & Payables",
        afterData: JSON.stringify({ poNumber, vendorId, poDate: finalPoDate, totalAmountCentavos: total })
      });
    });

    res.json({ success: true, poId, poNumber, totalAmountPhp: total / 100, message: `Purchase Order ${poNumber} created and approved.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create PO" });
  }
});

// Record Goods Receipt Note (GRN — Physical Inspection & Warehouse Receiving)
router.post("/procurement/purchase-orders/:id/receive", requireAuth, requirePermission('purchases:create', 'purchases:edit', 'procurement:manage', 'inventory:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const poId = req.params.id;
  const { deliveryNoteNo, receiptDate, notes } = req.body || {};

  try {
    const po = await db.select().from(schema.purchaseOrders).where(
      and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.companyId, companyId))
    ).get();

    if (!po) {
      res.status(404).json({ error: "NOT_FOUND", message: "Purchase Order not found" });
      return;
    }

    const existingGrn = await db.select().from(schema.goodsReceiptNotes).where(
      and(eq(schema.goodsReceiptNotes.companyId, companyId), eq(schema.goodsReceiptNotes.poId, po.id))
    ).get();

    if (existingGrn) {
      res.json({
        success: true,
        alreadyReceived: true,
        grnId: existingGrn.id,
        grnNumber: existingGrn.grnNumber,
        status: existingGrn.status,
        message: `Goods Receipt Note ${existingGrn.grnNumber} is already recorded for ${po.poNumber}.`,
      });
      return;
    }

    const grnId = crypto.randomUUID();
    const grnNumber = `GRN-${po.poNumber}`;
    const finalReceiptDate = (receiptDate && String(receiptDate).slice(0, 10)) || new Date().toISOString().slice(0, 10);
    const poLines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, po.id));

    await db.transaction(async (tx) => {
      await tx.insert(schema.goodsReceiptNotes).values({
        id: grnId,
        companyId,
        poId: po.id,
        grnNumber,
        receiptDate: finalReceiptDate,
        deliveryNoteNo: deliveryNoteNo || `DR-${po.poNumber}`,
        status: 'RECEIVED',
        receivedBy: userId,
      });

      for (const line of poLines) {
        await tx.insert(schema.goodsReceiptLines).values({
          id: crypto.randomUUID(),
          grnId,
          poLineId: line.id,
          quantityReceived: Number(line.quantityOrdered || 1),
          notes: notes || `Inspected and received in full against ${po.poNumber}`,
        });
        await tx.update(schema.purchaseOrderLines).set({
          quantityReceived: Number(line.quantityOrdered || 1),
        }).where(eq(schema.purchaseOrderLines.id, line.id));
      }

      if (String(po.status || '').toUpperCase() === 'APPROVED' || String(po.status || '').toUpperCase() === 'DRAFT') {
        await tx.update(schema.purchaseOrders).set({
          status: 'RECEIVED',
          updatedAt: new Date(),
        }).where(eq(schema.purchaseOrders.id, po.id));
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: "RECORD_GOODS_RECEIPT_NOTE",
        entityType: "goods_receipt_notes",
        entityId: grnId,
        recordReference: grnNumber,
        module: "Procurement & Payables",
        afterData: JSON.stringify({ grnNumber, poId: po.id, poNumber: po.poNumber, receiptDate: finalReceiptDate, status: 'RECEIVED' }),
      });
    });

    res.json({
      success: true,
      grnId,
      grnNumber,
      poNumber: po.poNumber,
      status: 'RECEIVED',
      message: `Goods Receipt Note ${grnNumber} recorded & inspected. PO ${po.poNumber} is now ready for 3-Way Match.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to record Goods Receipt Note" });
  }
});

// 3-Way Matching System Validation, Atomic GRN Verification & BIR-Compliant Auto-AP Creation
router.post('/procurement/3-way-match', requireAuth, requirePermission('purchases:review', 'purchases:create', 'purchases:edit', 'purchases:approve', 'procurement:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { poId, poNumber, vendorInvoiceNumber, poAmount, grnAmount, vendorInvoiceAmount, billAmount, receivedQuantity, billedQuantity, autoCreateBill, expenseAccountId, vatOption, atcCode } = req.body;

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, userId, 'procurement');
    let po = null;
    if (poId) {
      po = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.companyId, companyId))).get();
    } else if (poNumber) {
      po = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.poNumber, poNumber), eq(schema.purchaseOrders.companyId, companyId))).get();
    }
    if (po && !scope.isCompanyWide && scope.dataScope === 'OWN_RECORDS') {
      scope.assertRecordAccess({ createdBy: po.createdBy }, 'purchase order');
    }

    const poAmountPhp = po ? (po.totalAmount / 100) : Number(poAmount || 0);
    const grnAmtPhp = grnAmount !== undefined ? Number(grnAmount) : poAmountPhp;
    const billAmtPhp = Number(billAmount ?? vendorInvoiceAmount ?? 0);

    // 2.0% Tolerance Verification between PO, GRN, and Supplier Invoice per BIR procurement audit standards
    const tolerancePhp = Math.max(0.01, poAmountPhp * 0.02);
    const poVsBillDiff = Math.abs(poAmountPhp - billAmtPhp);
    const grnVsBillDiff = Math.abs(grnAmtPhp - billAmtPhp);
    const variancePercent = poAmountPhp > 0 ? (poVsBillDiff / poAmountPhp) * 100 : 0;
    const amountMatched = poVsBillDiff <= tolerancePhp && grnVsBillDiff <= tolerancePhp;

    const recQty = receivedQuantity !== undefined ? Number(receivedQuantity) : 1;
    const billQty = billedQuantity !== undefined ? Number(billedQuantity) : 1;
    const qtyMatched = recQty === billQty;

    const isMatchSuccessful = amountMatched && qtyMatched;
    const resolvedPoNumber = po?.poNumber || poNumber || 'PO-DIRECT';
    const normalizedAtc = String(atcCode || 'WC158').toUpperCase();

    // Determine BIR VAT 12% Input VAT applicability (NIRC Sec. 110 & RR 16-2005 / EOPT Act)
    const companyRecord = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const vendor = po ? await db.select().from(schema.vendors).where(eq(schema.vendors.id, po.vendorId)).get() : null;
    const companyIsVat = String(companyRecord?.vatStatus || 'VAT').toUpperCase() === 'VAT';
    const vendorIsNonVat = String(vendor?.taxClassification || 'VAT').toUpperCase().includes('NON_VAT') || String(vendor?.taxClassification || '').toUpperCase().includes('EXEMPT');
    const applyInputVat12 = companyIsVat && !vendorIsNonVat && String(vatOption || 'VAT_12_INCLUSIVE').toUpperCase() !== 'NON_VAT_EXEMPT';

    const billTotalCentavos = Math.round(billAmtPhp * 100);
    const vatableBaseCentavos = applyInputVat12 ? Math.round(billTotalCentavos / 1.12) : billTotalCentavos;
    const inputVatCentavos = applyInputVat12 ? (billTotalCentavos - vatableBaseCentavos) : 0;

    let generatedBillId: string | null = null;
    let generatedBillNumber: string | null = null;
    let generatedBillStatus: string | null = null;
    let generatedGrnNumber: string | null = null;
    let alreadyMatched = false;

    if (isMatchSuccessful && po) {
      // Check for existing active linked bill first (idempotent guard)
      const existingBill = await db.select().from(schema.purchaseBills).where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED', 'REVERSED')`,
          or(
            eq(schema.purchaseBills.reference, resolvedPoNumber),
            eq(schema.purchaseBills.billNumber, vendorInvoiceNumber || `BILL-${resolvedPoNumber}`)
          )!
        )
      ).get();

      const existingGrn = await db.select().from(schema.goodsReceiptNotes).where(
        and(eq(schema.goodsReceiptNotes.companyId, companyId), eq(schema.goodsReceiptNotes.poId, po.id))
      ).get();

      const poLines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, po.id));

      // Resolve company INPUT VAT 12% tax code (with verified active tax_rule_versions) under BIR NIRC Sec. 110
      let inputVatTaxCodeId: string | null = null;
      if (applyInputVat12) {
        const companyTaxCodes = await db.select().from(schema.taxCodes).where(
          and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.status, 'ACTIVE'))
        );
        const ruleDefIds = Array.from(new Set(companyTaxCodes.map(t => t.ruleDefinitionId).filter(Boolean) as string[]));
        const validRuleDefSet = new Set<string>();
        if (ruleDefIds.length > 0) {
          const activeVersions = await db.select({
            ruleDefinitionId: schema.taxRuleVersions.ruleDefinitionId,
          }).from(schema.taxRuleVersions).where(
            and(
              inArray(schema.taxRuleVersions.ruleDefinitionId, ruleDefIds),
              eq(schema.taxRuleVersions.status, 'ACTIVE')
            )
          );
          for (const v of activeVersions) {
            validRuleDefSet.add(v.ruleDefinitionId);
          }
        }
        const versionedTaxCodes = companyTaxCodes.filter(t => t.ruleDefinitionId && validRuleDefSet.has(t.ruleDefinitionId));
        const preferredInputVat =
          versionedTaxCodes.find(t => String(t.inputOutputDirection || '').toUpperCase() === 'INPUT' && String(t.taxType || '').toUpperCase().includes('VAT')) ||
          versionedTaxCodes.find(t => /INPUT.*VAT|VAT.*12|VAT_IN/i.test(`${t.code} ${t.name}`) && !/ZERO|EXEMPT|NON/i.test(`${t.code} ${t.name}`)) ||
          versionedTaxCodes.find(t => String(t.taxType || '').toUpperCase() === 'VAT' && !/OUTPUT|ZERO|EXEMPT/i.test(`${t.code} ${t.name} ${t.inputOutputDirection || ''}`));
        inputVatTaxCodeId = preferredInputVat?.id || null;
      }

      // Resolve expense account
      let finalExpenseAccId = expenseAccountId || vendor?.defaultExpenseAccountId;
      if (!finalExpenseAccId) {
        const defaultExp = await resolveCompanyControlAccount(db, companyId, "EXPENSE");
        finalExpenseAccId = defaultExp?.id;
      }

      const todayIso = new Date().toISOString().slice(0, 10);

      await db.transaction(async (tx) => {
        // 1. Atomically ensure a persisted Goods Receipt Note (GRN) exists for 3-Way Match auditability
        if (!existingGrn) {
          const newGrnId = crypto.randomUUID();
          const grnNum = `GRN-${resolvedPoNumber}`;
          await tx.insert(schema.goodsReceiptNotes).values({
            id: newGrnId,
            companyId,
            poId: po.id,
            grnNumber: grnNum,
            receiptDate: todayIso,
            deliveryNoteNo: `DR-${resolvedPoNumber}`,
            status: 'RECEIVED',
            receivedBy: userId,
          });
          for (const line of poLines) {
            await tx.insert(schema.goodsReceiptLines).values({
              id: crypto.randomUUID(),
              grnId: newGrnId,
              poLineId: line.id,
              quantityReceived: Number(line.quantityOrdered || recQty || 1),
              notes: `Verified via 3-Way Match for ${resolvedPoNumber}`,
            });
            await tx.update(schema.purchaseOrderLines).set({
              quantityReceived: Number(line.quantityOrdered || recQty || 1),
            }).where(eq(schema.purchaseOrderLines.id, line.id));
          }
          generatedGrnNumber = grnNum;
        } else {
          generatedGrnNumber = existingGrn.grnNumber;
        }

        // 2. Create BIR-compliant Purchase Bill if requested and not already created
        if (autoCreateBill) {
          if (!existingBill) {
            const billId = crypto.randomUUID();
            const billNum = vendorInvoiceNumber || `BILL-${resolvedPoNumber}`;
            const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const birTag = applyInputVat12
              ? `BIR 12% Input VAT Inclusive (Base: ₱${(vatableBaseCentavos / 100).toFixed(2)}, Input VAT: ₱${(inputVatCentavos / 100).toFixed(2)})`
              : `Non-VAT / VAT-Exempt Purchase (0% Input VAT)`;

            await tx.insert(schema.purchaseBills).values({
              id: billId,
              companyId,
              vendorId: po.vendorId,
              billNumber: billNum,
              billDate: todayIso,
              dueDate,
              reference: resolvedPoNumber,
              notes: `Auto-generated from 3-Way Match (${resolvedPoNumber} / ${generatedGrnNumber}, Variance: ${variancePercent.toFixed(2)}% <= 2.0%). ${birTag}. BIR Form 2307 ATC: ${normalizedAtc}.`,
              totalAmount: billTotalCentavos,
              balanceDue: billTotalCentavos,
              status: 'APPROVED',
              createdBy: userId,
              approvedBy: userId
            });

            if (finalExpenseAccId) {
              // When a versioned 12% Input VAT taxCodeId is attached, postPurchaseBill extracts VAT from the gross inclusive line amount.
              // If no versioned taxCode exists yet, store the net-of-VAT expense base so postPurchaseBill reconciles the 12% Input VAT line cleanly.
              const lineAmountCentavos = (applyInputVat12 && !inputVatTaxCodeId) ? vatableBaseCentavos : billTotalCentavos;
              await tx.insert(schema.purchaseBillLines).values({
                id: crypto.randomUUID(),
                billId,
                accountId: finalExpenseAccId,
                taxCodeId: inputVatTaxCodeId,
                description: `3-Way Matched Goods/Services from ${resolvedPoNumber} (${generatedGrnNumber}) [ATC: ${normalizedAtc}]`,
                quantity: billQty,
                unitPrice: Math.round(lineAmountCentavos / Math.max(1, billQty)),
                amount: lineAmountCentavos
              });
            }

            await tx.update(schema.purchaseOrders).set({
              status: 'CLOSED',
              updatedAt: new Date()
            }).where(eq(schema.purchaseOrders.id, po.id));

            generatedBillId = billId;
            generatedBillNumber = billNum;
            generatedBillStatus = 'APPROVED';
          } else {
            alreadyMatched = true;
            generatedBillId = existingBill.id;
            generatedBillNumber = existingBill.billNumber;
            generatedBillStatus = existingBill.status;
          }
        }
      });
    }

    const validationNotes = !isMatchSuccessful
      ? `3-Way Match Discrepancy Detected (${resolvedPoNumber}): Variance between PO (₱${poAmountPhp.toFixed(2)}), GRN (₱${grnAmtPhp.toFixed(2)}), and Bill (₱${billAmtPhp.toFixed(2)}) is ${variancePercent.toFixed(2)}%, exceeding statutory 2.0% tolerance. Accounts Payable posting blocked pending discrepancy voucher.`
      : alreadyMatched
      ? `PO ${resolvedPoNumber} is already 3-Way Matched and linked to Purchase Bill #${generatedBillNumber} (Status: ${generatedBillStatus}). Duplicate bill creation prevented.`
      : `3-Way Match Verified (${resolvedPoNumber} ↔ ${generatedGrnNumber || 'GRN'} ↔ ${generatedBillNumber || vendorInvoiceNumber || 'SI'}): Variance ${variancePercent.toFixed(2)}% ≤ 2.0%. ${applyInputVat12 ? `12% Creditable Input VAT (₱${(inputVatCentavos / 100).toFixed(2)}) mapped per NIRC Sec. 110; Form 2307 ATC ${normalizedAtc}.` : `Non-VAT / 0% Input VAT; Form 2307 ATC ${normalizedAtc}.`} Ready for GL Posting in Purchase Bills (AP).`;

    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: isMatchSuccessful ? "VERIFY_3_WAY_MATCH_PASS" : "VERIFY_3_WAY_MATCH_FAIL",
      entityType: "purchase_orders",
      entityId: po?.id || resolvedPoNumber,
      recordReference: resolvedPoNumber,
      module: "Procurement & Payables",
      afterData: JSON.stringify({
        poNumber: resolvedPoNumber,
        grnNumber: generatedGrnNumber,
        vendorInvoiceNumber,
        poAmountPhp,
        grnAmountPhp: grnAmtPhp,
        billAmountPhp: billAmtPhp,
        vatableBaseCentavos,
        inputVatCentavos,
        applyInputVat12,
        atcCode: normalizedAtc,
        variancePercent,
        matched: isMatchSuccessful,
        alreadyMatched,
        autoCreatedBillId: generatedBillId,
        autoCreatedBillStatus: generatedBillStatus,
      })
    });

    res.json({
      matched: isMatchSuccessful,
      alreadyMatched,
      matchStatus: isMatchSuccessful ? "PASSED_3_WAY_MATCH" : "DISCREPANCY_DETECTED",
      poNumber: resolvedPoNumber,
      grnNumber: generatedGrnNumber,
      poAmountPhp,
      grnAmountPhp: grnAmtPhp,
      billAmountPhp: billAmtPhp,
      vatableBaseCentavos,
      inputVatCentavos,
      applyInputVat12,
      atcCode: normalizedAtc,
      variancePercent: Math.round(variancePercent * 100) / 100,
      receivedQuantity: recQty,
      billedQuantity: billQty,
      isAmountMatch: amountMatched,
      isQuantityMatch: qtyMatched,
      paymentAuthorizationAllowed: isMatchSuccessful,
      message: validationNotes,
      validationNotes,
      generatedBillId,
      generatedBillNumber,
      generatedBillStatus,
    });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === 'DATA_SCOPE_VIOLATION') {
      res.status(403).json({ error: err.error || 'PERMISSION_DENIED', code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: err.message || "Failed 3-way match validation" });
  }
});

// ==========================================
// 8. OPERATIONS INVOICES & BILLS ALIAS ENDPOINTS
// ==========================================

// GET /api/operations/invoices
router.get('/invoices', requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'sales');
    const filterConditions = [eq(schema.salesInvoices.companyId, companyId)];
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      filterConditions.push(eq(schema.salesInvoices.createdBy, req.user!.id));
    }
    const invoices = await db.select().from(schema.salesInvoices).where(and(...filterConditions)).orderBy(desc(schema.salesInvoices.invoiceDate)).limit(Math.min(1000, Number(req.query.limit) || 200));
    res.json(invoices);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch invoices" });
  }
});

// POST /api/operations/invoices
router.post('/invoices', requireAuth, requirePermission('sales:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { customerId, invoiceNumber, invoiceType, invoiceDate, dueDate, reference, totalAmount, lines } = req.body;

  if (!customerId || !invoiceNumber || !totalAmount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Customer, invoice number, and total amount are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createSalesInvoice(companyId, {
      customerId,
      invoiceNumber,
      invoiceType: invoiceType || 'SALES',
      invoiceDate: invoiceDate ? invoiceDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      dueDate: dueDate ? dueDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      reference: reference || null,
      totalAmount: Number(totalAmount),
    }, req.user!.id, actorRole);

    if (lines && Array.isArray(lines) && lines.length > 0) {
      let revenueAccount = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.status, "ACTIVE"), eq(schema.accounts.accountType, "REVENUE"), sql`account_code NOT IN ('4000')`)).limit(1).get();
      if (!revenueAccount) {
        revenueAccount = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.status, "ACTIVE"), eq(schema.accounts.accountType, "REVENUE"))).limit(1).get();
      }
      const defaultRevenueAccountId = revenueAccount?.id;

      for (const line of lines) {
        await db.insert(schema.salesInvoiceLines).values({
          id: crypto.randomUUID(),
          invoiceId: id,
          accountId: line.accountId === "revenue-dummy" && defaultRevenueAccountId ? defaultRevenueAccountId : line.accountId,
          taxCodeId: line.taxCodeId || null,
          description: line.description || '',
          quantity: line.quantity || 1,
          unitPrice: line.unitPrice,
          amount: line.amount,
        });
      }
    }

    res.json({ message: "Sales invoice created successfully", id, invoiceNumber });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// PUT /api/operations/invoices/:id
router.put('/invoices/:id', requireAuth, requirePermission('sales:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const existing = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, id), eq(schema.salesInvoices.companyId, companyId))).get();
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Sales invoice not found" });
      return;
    }
    const { reference, notes, dueDate, totalAmount } = req.body;
    const isDraft = String(existing.status || '').toUpperCase() === 'DRAFT';
    if (totalAmount !== undefined && Number(totalAmount) !== Number(existing.totalAmount) && !isDraft) {
      res.status(400).json({
        error: "IMMUTABLE_POSTED_DOCUMENT",
        message: "Cannot modify totalAmount of a posted/settled invoice directly. Use Credit/Debit Memo or reverse & re-issue.",
      });
      return;
    }
    const updateData: any = { updatedAt: new Date() };
    if (reference !== undefined) updateData.reference = reference;
    if (notes !== undefined) updateData.notes = notes;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (totalAmount !== undefined && isDraft) {
      updateData.totalAmount = Number(totalAmount);
      updateData.balanceDue = Number(totalAmount);
    }

    await db.update(schema.salesInvoices).set(updateData).where(and(eq(schema.salesInvoices.id, id), eq(schema.salesInvoices.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: "UPDATE_SALES_INVOICE",
      entityType: "SALES_INVOICE",
      entityId: id,
      module: "SALES",
      afterData: updateData
    });
    res.json({ success: true, message: "Sales invoice updated successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// POST /api/operations/bills/:id/review
router.post('/bills/:id/review', requireAuth, requirePermission('purchases:review'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId))).get();
    if (!bill) {
      res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });
      return;
    }
    await db.update(schema.purchaseBills).set({
      status: "REVIEWED",
      updatedAt: new Date()
    }).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: "REVIEW_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      afterData: { status: "REVIEWED", reviewedBy: req.user!.id }
    });
    res.json({ message: "Purchase bill reviewed successfully", id, status: "REVIEWED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// POST /api/operations/bills/:id/approve
router.post('/bills/:id/approve', requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId))).get();
    if (!bill) {
      res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });
      return;
    }

    const limit = req.activeCompany?.approvalLimitCentavos;
    if (limit !== undefined && limit !== null && limit > 0 && bill.totalAmount > limit) {
      res.status(403).json({
        error: "APPROVAL_LIMIT_EXCEEDED",
        message: `Transaction amount (${bill.totalAmount} centavos) exceeds custom approval limit (${limit} centavos).`
      });
      return;
    }

    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approvePurchaseBill(companyId, id, req.user!.id, expectedVersion ? Number(expectedVersion) : undefined, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "APPROVE_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      afterData: { status: "APPROVED", approvedBy: req.user!.id }
    });
    res.json({ message: "Purchase bill approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

export default router;
