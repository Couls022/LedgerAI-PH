import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth,  requirePermission } from "../auth";
import { eq, and, sql, desc, lte, gte, like, or } from "drizzle-orm";
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from "../utils/pagination";
import crypto from "crypto";
import { ForexRevaluationEngine } from "../services/forexRevaluationEngine";
import { AccountingEngine } from "../services/accountingEngine";
import { validateTransactionDateAndPeriod, DomainError } from "../db/domain";

const router = Router();

// ==========================================
// 1. FOREIGN CURRENCY & BIR FOREX POLICY (BIR RMC 12-2024)
// ==========================================

// Get Spot Exchange Rates
router.get('/forex/rates', requireAuth, requirePermission('operations:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const rates = await db.select()
      .from(schema.currencyExchangeRates)
      .where(eq(schema.currencyExchangeRates.companyId, companyId))
      .orderBy(desc(schema.currencyExchangeRates.rateDate));
    res.json(rates);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch exchange rates" });
  }
});

// Set / Update Spot Exchange Rate (BSP / BAP)
router.post('/forex/rates', requireAuth, requirePermission('operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { rateDate, currency, bspSpotRate, source } = req.body;

  if (!rateDate || !bspSpotRate) {
    res.status(400).json({ error: "Rate date and spot rate are required" });
    return;
  }

  try {
    const id = crypto.randomUUID();
    await db.insert(schema.currencyExchangeRates).values({
      id,
      companyId,
      rateDate,
      currency: currency || 'USD',
      bspSpotRate: Number(bspSpotRate),
      source: source || 'BSP'
    });
    res.json({ success: true, id, message: "BSP Spot Rate saved successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to save exchange rate" });
  }
});

// Realized & Unrealized Forex Gain/Loss Engine (BIR RMC 12-2024 Compliance)
router.get('/forex/calculate-realized', requireAuth, requirePermission('operations:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { invoiceDate, invoiceRate, paymentDate, paymentRate, foreignAmountUsd } = req.query;

  const invRate = Number(invoiceRate) || 56.00;
  const payRate = Number(paymentRate) || 57.00;
  const usdAmount = Number(foreignAmountUsd) || 1000;

  const fxResult = ForexRevaluationEngine.calculateRealizedFx(usdAmount, invRate, payRate);

  res.json({
    complianceNotice: fxResult.complianceNote,
    foreignAmountUsd: usdAmount,
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
});

router.post('/forex/revalue-and-post', requireAuth, requirePermission('operations:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { transactionId, transactionNumber, transactionDate, foreignAmount, recordedRate, settlementRate, sourceType } = req.body;

  try {
    const journalEntryId = await ForexRevaluationEngine.postRealizedFxJournal(companyId, userId, {
      transactionId: transactionId || crypto.randomUUID(),
      transactionNumber: transactionNumber || `FX-${Date.now()}`,
      transactionDate: transactionDate || new Date().toISOString().slice(0, 10),
      foreignAmount: Number(foreignAmount),
      recordedRate: Number(recordedRate),
      settlementRate: Number(settlementRate),
      sourceType: sourceType || "forex_revaluation"
    });

    res.json({
      success: true,
      journalEntryId,
      message: "Realized FX gain/loss journal entry posted to GL in compliance with BIR RMC 12-2024."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to post FX revaluation journal entry." });
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
          like(schema.inventoryItems.description, searchPattern),
          like(schema.inventoryItems.category, searchPattern)
        )!
      );
    }

    if (params.status) {
      filterConditions.push(eq(schema.inventoryItems.status, params.status));
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
router.post('/inventory/items', requireAuth, requirePermission('inventory:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { sku, name, description, category, unitOfMeasure, costingMethod, unitCost, sellingPrice, quantityOnHand, reorderPoint, assetAccountId, cogsAccountId } = req.body;

  if (!sku || !name) {
    res.status(400).json({ error: "SKU and Item Name are required" });
    return;
  }

  try {
    const id = crypto.randomUUID();
    await db.insert(schema.inventoryItems).values({
      id,
      companyId,
      sku,
      name,
      description,
      category: category || 'GENERAL',
      unitOfMeasure: unitOfMeasure || 'PCS',
      costingMethod: costingMethod || 'FIFO',
      unitCost: Number(unitCost) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      quantityOnHand: Number(quantityOnHand) || 0,
      reorderPoint: Number(reorderPoint) || 10,
      assetAccountId: assetAccountId || null,
      cogsAccountId: cogsAccountId || null,
    });

    res.json({ success: true, id, message: "Inventory item created" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create item" });
  }
});

// Stock Adjustments & Waste Log
router.post("/inventory/adjustments", requireAuth, requirePermission('inventory:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { adjustmentNumber, adjustmentDate, itemId, quantityChange, reason, expenseAccountId } = req.body;

  if (!itemId || quantityChange === undefined || !reason) {
    res.status(400).json({ error: "Item, quantity change, and reason are required" });
    return;
  }

  try {
    const item = await db.select().from(schema.inventoryItems).where(and(eq(schema.inventoryItems.id, itemId), eq(schema.inventoryItems.companyId, companyId))).get();
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    const adjId = crypto.randomUUID();
    const qChange = Number(quantityChange);
    const newQty = item.quantityOnHand + qChange;

    // Update item stock
    await db.update(schema.inventoryItems)
      .set({ quantityOnHand: newQty, updatedAt: new Date() })
      .where(eq(schema.inventoryItems.id, itemId));

    // Record adjustment
    await db.insert(schema.stockAdjustments).values({
      id: adjId,
      companyId,
      adjustmentNumber: adjustmentNumber || `SA-${Date.now().toString().slice(-6)}`,
      adjustmentDate: adjustmentDate || new Date().toISOString().slice(0, 10),
      itemId,
      quantityChange: qChange,
      reason, // e.g. SPOILAGE, DAMAGE, FREEBIE, COUNT_CORRECTION
      expenseAccountId: expenseAccountId || item.cogsAccountId,
      createdBy: userId,
    });

    res.json({ success: true, id: adjId, newQuantityOnHand: newQty, message: "Stock adjustment recorded" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed stock adjustment" });
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

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.employees)
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const emps = await db
      .select()
      .from(schema.employees)
      .where(and(...queryConditions))
      .orderBy(schema.employees.employeeNo, schema.employees.id)
      .limit(params.limit + 1);

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

router.post('/payroll/employees', requireAuth, requirePermission('payroll:process'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { 
    employeeNo, firstName, lastName, email, tin, sssNo, philhealthNo, pagibigNo, position, department, monthlyBasicSalary,
    customSssEE, customSssER, customPhilhealthEE, customPhilhealthER, customPagibigEE, customPagibigER, customWithholdingTax
  } = req.body;

  if (!employeeNo || !firstName || !lastName || monthlyBasicSalary === undefined) {
    res.status(400).json({ error: "Employee No, Name, and Monthly Basic Salary are required" });
    return;
  }

  try {
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
    res.status(500).json({ error: err.message || "Failed to add employee" });
  }
});

router.put('/payroll/employees/:id', requireAuth, requirePermission('payroll:process'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const { 
    employeeNo, firstName, lastName, email, tin, sssNo, philhealthNo, pagibigNo, position, department, monthlyBasicSalary,
    customSssEE, customSssER, customPhilhealthEE, customPhilhealthER, customPagibigEE, customPagibigER, customWithholdingTax
  } = req.body;

  try {
    const monthlyCentavos = Math.round(Number(monthlyBasicSalary) * 100);
    const dailyRateCentavos = Math.round(monthlyCentavos / 22);
    const hourlyRateCentavos = Math.round(dailyRateCentavos / 8);

    await db.update(schema.employees)
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
        updatedAt: new Date()
      })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId)));

    res.json({ success: true, message: "Employee profile updated successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update employee" });
  }
});

router.delete('/payroll/employees/:id', requireAuth, requirePermission('payroll:process'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  try {
    await db.update(schema.employees)
      .set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId)));
    res.json({ success: true, message: "Employee deactivated successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to deactivate employee" });
  }
});

// Process Payroll Run (Compute SSS, PhilHealth, Pag-IBIG & BIR Withholding Tax)
router.post("/payroll/process", requireAuth, requirePermission('payroll:process'), async (req, res) => {
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
    // 1. Period & Lock Date Validation
    await validateTransactionDateAndPeriod(companyId, pDate, { userRole: 'Bookkeeper' });

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

      // 1. SSS EE & ER
      let sssEE = 0;
      let sssER = 0;
      if (isSingleOverride && sssEmployee !== undefined && sssEmployee !== null) {
        sssEE = Math.round(Number(sssEmployee) * 100);
      } else if (emp.customSssEE && emp.customSssEE > 0) {
        sssEE = isFullMonth ? emp.customSssEE : Math.round(emp.customSssEE / 2);
      } else {
        sssEE = Math.min(157500, Math.max(22500, Math.round(grossPay * 0.045)));
      }

      if (emp.customSssER && emp.customSssER > 0) {
        sssER = isFullMonth ? emp.customSssER : Math.round(emp.customSssER / 2);
      } else {
        sssER = Math.min(332500, Math.max(47500, Math.round(grossPay * 0.095)));
      }

      // 2. PhilHealth EE & ER
      let phEE = 0;
      let phER = 0;
      if (isSingleOverride && philhealthEmployee !== undefined && philhealthEmployee !== null) {
        phEE = Math.round(Number(philhealthEmployee) * 100);
      } else if (emp.customPhilhealthEE && emp.customPhilhealthEE > 0) {
        phEE = isFullMonth ? emp.customPhilhealthEE : Math.round(emp.customPhilhealthEE / 2);
      } else {
        phEE = Math.round(Math.min(5000000, Math.max(500000, grossPay)) * 0.025);
      }

      if (emp.customPhilhealthER && emp.customPhilhealthER > 0) {
        phER = isFullMonth ? emp.customPhilhealthER : Math.round(emp.customPhilhealthER / 2);
      } else {
        phER = phEE;
      }

      // 3. Pag-IBIG EE & ER
      let pagibigEE = 0;
      let pagibigER = 0;
      if (isSingleOverride && pagibigEmployee !== undefined && pagibigEmployee !== null) {
        pagibigEE = Math.round(Number(pagibigEmployee) * 100);
      } else if (emp.customPagibigEE && emp.customPagibigEE > 0) {
        pagibigEE = isFullMonth ? emp.customPagibigEE : Math.round(emp.customPagibigEE / 2);
      } else {
        pagibigEE = Math.min(10000, Math.round(grossPay * 0.02));
      }

      if (emp.customPagibigER && emp.customPagibigER > 0) {
        pagibigER = isFullMonth ? emp.customPagibigER : Math.round(emp.customPagibigER / 2);
      } else {
        pagibigER = pagibigEE;
      }

      // 4. BIR TRAIN Law Withholding Tax
      let wTax = 0;
      if (isSingleOverride && withholdingTax !== undefined && withholdingTax !== null) {
        wTax = Math.round(Number(withholdingTax) * 100);
      } else if (emp.customWithholdingTax && emp.customWithholdingTax > 0) {
        wTax = isFullMonth ? emp.customWithholdingTax : Math.round(emp.customWithholdingTax / 2);
      } else {
        const taxableCompensation = Math.max(0, grossPay - sssEE - phEE - pagibigEE);
        if (taxableCompensation <= 1041700) {
          wTax = 0;
        } else if (taxableCompensation <= 1666600) {
          wTax = Math.round((taxableCompensation - 1041700) * 0.15);
        } else if (taxableCompensation <= 3333200) {
          wTax = Math.round(93750 + (taxableCompensation - 1666600) * 0.20);
        } else if (taxableCompensation <= 8333200) {
          wTax = Math.round(427083 + (taxableCompensation - 3333200) * 0.25);
        } else if (taxableCompensation <= 33333200) {
          wTax = Math.round(1677083 + (taxableCompensation - 8333200) * 0.30);
        } else {
          wTax = Math.round(9177083 + (taxableCompensation - 33333200) * 0.35);
        }
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
        netPayCentavos: totalNet
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
    res.status(500).json({ error: err.message || "Failed to process payroll" });
  }
});


// ==========================================
// 4. CASH, TREASURY & FIXED ASSETS
// ==========================================

// Fixed Asset Register & Depreciation
router.get('/fixed-assets', requireAuth, requirePermission('fixed_assets:view'), async (req, res) => {
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

    const enriched = [];
    for (const a of assets) {
      // Query posted schedules for this asset to calculate accumulated depreciation
      const schedules = await db.select()
        .from(schema.depreciationSchedules)
        .where(
          and(
            eq(schema.depreciationSchedules.assetId, a.id),
            eq(schema.depreciationSchedules.status, 'POSTED')
          )
        );
      
      const totalPostDepCentavos = schedules.reduce((sum, s) => sum + s.depreciationAmount, 0);
      
      enriched.push({
        ...a,
        assetCode: a.assetTag, // Map database assetTag to client assetCode
        // Map database centavos to float PHP for UI consistency
        acquisitionCost: a.acquisitionCost / 100,
        salvageValue: a.salvageValue / 100,
        accumulatedDepreciation: totalPostDepCentavos / 100,
        usefulLifeYears: Math.round(a.usefulLifeMonths / 12),
        // Send raw values for backend compatibility if needed
        rawAcquisitionCost: a.acquisitionCost,
        rawSalvageValue: a.salvageValue
      });
    }

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

router.post("/fixed-assets", requireAuth, requirePermission('fixed_assets:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
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
    depreciationExpenseAccountId 
  } = req.body;

  const finalAssetTag = assetTag || assetCode;
  const finalUsefulLifeMonths = usefulLifeMonths ? Number(usefulLifeMonths) : (usefulLifeYears ? Number(usefulLifeYears) * 12 : 0);

  if (!finalAssetTag || !assetName || !acquisitionCost || !finalUsefulLifeMonths) {
    res.status(400).json({ error: "Asset Tag/Code, Name, Acquisition Cost, and Useful Life are required" });
    return;
  }

  try {
    const id = crypto.randomUUID();
    const costCentavos = Math.round(Number(acquisitionCost) * 100);
    const salvageCentavos = Math.round((Number(salvageValue) || 0) * 100);
    const lifeMonths = Number(finalUsefulLifeMonths);

    await db.insert(schema.fixedAssets).values({
      id,
      companyId,
      assetTag: finalAssetTag,
      assetName,
      category: category || 'EQUIPMENT',
      acquisitionDate: acquisitionDate || new Date().toISOString().slice(0, 10),
      acquisitionCost: costCentavos,
      salvageValue: salvageCentavos,
      usefulLifeMonths: lifeMonths,
      depreciationMethod: 'STRAIGHT_LINE',
      assetAccountId: assetAccountId || null,
      accumulatedDepAccountId: accumulatedDepAccountId || null,
      depreciationExpenseAccountId: depreciationExpenseAccountId || null
    });

    // Auto-generate Straight-Line Monthly Depreciation Schedule
    const monthlyDep = Math.round((costCentavos - salvageCentavos) / lifeMonths);
    let accum = 0;
    const acqDateObj = new Date(acquisitionDate || Date.now());

    for (let i = 1; i <= Math.min(lifeMonths, 120); i++) {
      accum += monthlyDep;
      const periodMonth = new Date(acqDateObj.getFullYear(), acqDateObj.getMonth() + i, 1).toISOString().slice(0, 7);
      await db.insert(schema.depreciationSchedules).values({
        id: crypto.randomUUID(),
        assetId: id,
        companyId,
        periodMonth,
        depreciationAmount: monthlyDep,
        accumulatedDepreciation: Math.min(accum, costCentavos - salvageCentavos),
        bookValue: Math.max(salvageCentavos, costCentavos - accum),
        status: 'PENDING'
      });
    }

    res.json({ success: true, id, monthlyDepreciationPhp: monthlyDep / 100, message: "Fixed asset and depreciation schedule created." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create fixed asset" });
  }
});

// Post Monthly Depreciation Schedule Run (execute straight-line monthly schedules and post to GL)
router.post("/depreciation/post", requireAuth, requirePermission('accounting:post'), async (req, res) => {
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
    await validateTransactionDateAndPeriod(companyId, postingDate, { userRole: 'Bookkeeper' });

    // 2. Fetch pending schedules for this company and period
    const schedules = await db.select()
      .from(schema.depreciationSchedules)
      .where(
        and(
          eq(schema.depreciationSchedules.companyId, companyId),
          eq(schema.depreciationSchedules.periodMonth, periodMonth),
          eq(schema.depreciationSchedules.status, 'PENDING')
        )
      );

    if (!schedules.length) {
      res.status(400).json({ error: `No pending depreciation schedules found for month ${periodMonth}.` });
      return;
    }

    // 3. Process postings atomically
    await db.transaction(async (tx) => {
      for (const sched of schedules) {
        // Load asset details to retrieve its name
        const asset = await tx.select()
          .from(schema.fixedAssets)
          .where(eq(schema.fixedAssets.id, sched.assetId))
          .get();

        if (!asset) {
          throw new Error(`Asset not found for schedule ${sched.id}`);
        }

        // Post balanced journal entry via the existing AccountingEngine
        const journalEntryId = await AccountingEngine.postMonthlyDepreciation(companyId, userId, {
          scheduleId: sched.id,
          assetId: sched.assetId,
          assetName: asset.assetName,
          periodMonth: sched.periodMonth,
          depreciationAmountCentavos: sched.depreciationAmount
        }, tx);

        // Update schedule status to POSTED
        await tx.update(schema.depreciationSchedules)
          .set({
            status: 'POSTED',
            journalEntryId
          })
          .where(eq(schema.depreciationSchedules.id, sched.id));
      }
    });

    res.json({
      success: true,
      processedCount: schedules.length,
      message: `Successfully posted ${schedules.length} monthly depreciation schedule entries to General Ledger.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to post monthly depreciation schedules" });
  }
});


// ==========================================
// 5. PROCUREMENT & 3-WAY MATCHING (PO -> GRN -> BILL)
// ==========================================

// Create Purchase Order
router.post("/procurement/purchase-orders", requireAuth, requirePermission('procurement:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { vendorId, poNumber, poDate, items } = req.body;

  if (!vendorId || !poNumber || !items || !items.length) {
    res.status(400).json({ error: "Vendor, PO number, and items are required" });
    return;
  }

  try {
    const poId = crypto.randomUUID();
    let total = 0;

    for (const item of items) {
      total += Math.round(Number(item.quantity) * Number(item.unitPrice) * 100);
    }

    await db.insert(schema.purchaseOrders).values({
      id: poId,
      companyId,
      vendorId,
      poNumber,
      poDate: poDate || new Date().toISOString().slice(0, 10),
      totalAmount: total,
      status: 'APPROVED',
      createdBy: userId,
      approvedBy: userId
    });

    for (const item of items) {
      const lineAmt = Math.round(Number(item.quantity) * Number(item.unitPrice) * 100);
      await db.insert(schema.purchaseOrderLines).values({
        id: crypto.randomUUID(),
        poId,
        itemId: item.itemId || null,
        description: item.description || 'PO Item',
        quantityOrdered: Number(item.quantity),
        quantityReceived: 0,
        unitPrice: Math.round(Number(item.unitPrice) * 100),
        amount: lineAmt
      });
    }

    res.json({ success: true, poId, totalAmountPhp: total / 100, message: "Purchase Order created and approved." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create PO" });
  }
});

// 3-Way Matching System Validation
router.post('/procurement/3-way-match', requireAuth, requirePermission('procurement:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { poId, billAmount, receivedQuantity, billedQuantity } = req.body;

  try {
    const po = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.companyId, companyId))).get();
    if (!po) {
      res.status(404).json({ error: "Purchase Order not found" });
      return;
    }

    const poAmountPhp = po.totalAmount / 100;
    const billAmtPhp = Number(billAmount);
    const amountMatched = Math.abs(poAmountPhp - billAmtPhp) < 0.01;
    const qtyMatched = Number(receivedQuantity) === Number(billedQuantity);

    const isMatchSuccessful = amountMatched && qtyMatched;

    res.json({
      matchStatus: isMatchSuccessful ? "PASSED_3_WAY_MATCH" : "DISCREPANCY_DETECTED",
      poNumber: po.poNumber,
      poAmountPhp,
      billAmountPhp: billAmtPhp,
      receivedQuantity: Number(receivedQuantity),
      billedQuantity: Number(billedQuantity),
      isAmountMatch: amountMatched,
      isQuantityMatch: qtyMatched,
      paymentAuthorizationAllowed: isMatchSuccessful,
      validationNotes: isMatchSuccessful
        ? "3-Way Match Verified: Purchase Order, Receiving Report (GRN), and Purchase Bill match perfectly."
        : "3-Way Match Failed: Variance detected between PO, GRN, and Bill. AP Payment approval blocked until resolved."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed 3-way match validation" });
  }
});

export default router;
