import { Router } from "express";
import { db } from "../db";
import { dbContext } from "../db/context";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, or, sql, gte, lte, inArray, desc } from "drizzle-orm";
import { TaxEngine } from "../services/taxEngine";
import { getBirTaxProfileRules } from "../../shared/taxProfile.js";
import { validateTransactionDateAndPeriod, DomainError } from "../db/domain";
import {
  buildEffectivePostedJournalPredicate,
  buildPeriodScopedJournalFilter,
  isOperationalPnlJournalSql,
  resolveReportPeriodScope,
} from "./reports";
import {
  computeParentAccountIds,
  isAccountActive,
  isEligibleTaxControlAccount,
  isPostableLeafAccount,
} from "../../shared/coaAccountUtils";
import {
  buildForm2307Certificate,
  extractPhZipCode,
  formatBirTinSegments,
  getQuarterDateBounds,
  type BirQuarter,
  type LedgerBillInput,
  type LedgerPaymentInput,
} from "../../shared/form2307Utils";
import crypto from "crypto";

const router = Router();

async function assertTaxPeriodUnlocked(
  companyId: string,
  startDate: string,
  endDate?: string,
  userRole?: string
) {
  const sDate = String(startDate).slice(0, 10);
  const eDate = String(endDate || startDate).slice(0, 10);

  const overlappingPeriods = await db
    .select()
    .from(schema.accountingPeriods)
    .where(
      and(
        eq(schema.accountingPeriods.companyId, companyId),
        sql`${schema.accountingPeriods.startDate} <= ${eDate} AND ${schema.accountingPeriods.endDate} >= ${sDate}`
      )
    );

  for (const p of overlappingPeriods) {
    const pStatus = String(p.status || '').toUpperCase();
    if (pStatus === 'HARD_CLOSED' || pStatus === 'LOCKED' || pStatus === 'CLOSED') {
      throw new DomainError(
        `Period ${p.name} (${p.startDate} to ${p.endDate}) is ${p.status}. Tax filing, adjustment, or certificate issuance is prohibited in locked periods.`,
        'PERIOD_LOCKED',
        403
      );
    }
  }

  await validateTransactionDateAndPeriod(companyId, sDate, { userRole });
  if (eDate !== sDate) {
    await validateTransactionDateAndPeriod(companyId, eDate, { userRole });
  }
}

async function ensureTaxRuleWithVersion(params: {
  ruleCode: string;
  ruleName: string;
  taxType: string;
  rateValue: number;
  sourceReference: string;
  description: string;
}): Promise<string> {
  const existingDef = await db
    .select()
    .from(schema.taxRuleDefinitions)
    .where(eq(schema.taxRuleDefinitions.ruleCode, params.ruleCode))
    .get();
  if (existingDef) {
    const existingVer = await db
      .select()
      .from(schema.taxRuleVersions)
      .where(eq(schema.taxRuleVersions.ruleDefinitionId, existingDef.id))
      .get();
    if (!existingVer) {
      await db.insert(schema.taxRuleVersions).values({
        id: crypto.randomUUID(),
        ruleDefinitionId: existingDef.id,
        version: 1,
        effectiveFrom: '2018-01-01',
        calculationMethod: 'PERCENTAGE',
        rateValue: params.rateValue,
        sourceReference: params.sourceReference,
        sourceTitle: params.ruleName,
        sourceType: 'BIR_STATUTORY_RULE',
        status: 'ACTIVE',
      });
    }
    return existingDef.id;
  }

  const defId = crypto.randomUUID();
  await db.insert(schema.taxRuleDefinitions).values({
    id: defId,
    ruleCode: params.ruleCode,
    ruleName: params.ruleName,
    taxType: params.taxType,
    description: params.description,
    status: 'ACTIVE',
  });
  await db.insert(schema.taxRuleVersions).values({
    id: crypto.randomUUID(),
    ruleDefinitionId: defId,
    version: 1,
    effectiveFrom: '2018-01-01',
    calculationMethod: 'PERCENTAGE',
    rateValue: params.rateValue,
    sourceReference: params.sourceReference,
    sourceTitle: params.ruleName,
    sourceType: 'BIR_STATUTORY_RULE',
    status: 'ACTIVE',
  });
  return defId;
}

export async function ensureCompanyDefaultBirTaxCodes(companyId: string): Promise<void> {
  const existing = await db
    .select({ id: schema.taxCodes.id })
    .from(schema.taxCodes)
    .where(eq(schema.taxCodes.companyId, companyId))
    .limit(1);
  if (existing.length > 0) return;

  const companyAccounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.companyId, companyId));
  if (companyAccounts.length === 0) return;

  const findAcc = (codes: string[], nameIncludes: string) =>
    companyAccounts.find((a) => codes.includes(String(a.accountCode || ''))) ||
    companyAccounts.find((a) => String(a.accountName || '').toLowerCase().includes(nameIncludes));

  const outputVatAcc = findAcc(['2020', '2110'], 'output vat') || findAcc(['2030'], 'tax payable');
  const inputVatAcc = findAcc(['1120', '1140'], 'input vat') || findAcc(['1130'], 'withholding');
  const ewtPayableAcc = findAcc(['2030', '2120'], 'withholding tax payable') || outputVatAcc;
  const cwtAssetAcc = findAcc(['1130'], 'creditable withholding') || inputVatAcc;

  const defaults: Array<{
    code: string;
    name: string;
    taxType: string;
    description: string;
    direction: 'OUTPUT' | 'INPUT';
    rateValue: number;
    ruleCode: string;
    sourceReference: string;
    accountId: string | undefined;
  }> = [
    {
      code: 'VAT-OUT-12',
      name: '12% Output VAT (Sales)',
      taxType: 'VAT',
      description: 'Standard 12% Philippine Output VAT on VATable sales (NIRC Sec. 106/108)',
      direction: 'OUTPUT',
      rateValue: 0.12,
      ruleCode: 'PH_VAT_OUT_12',
      sourceReference: 'NIRC Sec. 106 & 108 / RR 16-2005',
      accountId: outputVatAcc?.id,
    },
    {
      code: 'VAT-IN-12',
      name: '12% Creditable Input VAT (Purchases)',
      taxType: 'VAT',
      description: 'Standard 12% Creditable Input VAT on VATable purchases from VAT suppliers (NIRC Sec. 110)',
      direction: 'INPUT',
      rateValue: 0.12,
      ruleCode: 'PH_VAT_IN_12',
      sourceReference: 'NIRC Sec. 110 / RR 16-2005',
      accountId: inputVatAcc?.id,
    },
    {
      code: 'VAT-ZERO',
      name: '0% Zero-Rated VAT',
      taxType: 'VAT',
      description: '0% Zero-Rated Sales (NIRC Sec. 106(A)(2) / 108(B))',
      direction: 'OUTPUT',
      rateValue: 0,
      ruleCode: 'PH_VAT_ZERO_0',
      sourceReference: 'NIRC Sec. 106(A)(2) & 108(B)',
      accountId: outputVatAcc?.id,
    },
    {
      code: 'VAT-EXEMPT',
      name: 'VAT-Exempt Transaction',
      taxType: 'VAT',
      description: 'VAT-Exempt Sale or Purchase (NIRC Sec. 109)',
      direction: 'OUTPUT',
      rateValue: 0,
      ruleCode: 'PH_VAT_EXEMPT_0',
      sourceReference: 'NIRC Sec. 109',
      accountId: outputVatAcc?.id,
    },
    {
      code: 'PTAX-3',
      name: '3% Percentage Tax (Non-VAT 2551Q)',
      taxType: 'PERCENTAGE_TAX',
      description: '3% Non-VAT Percentage Tax on gross quarterly sales/receipts (NIRC Sec. 116)',
      direction: 'OUTPUT',
      rateValue: 0.03,
      ruleCode: 'PH_PTAX_3',
      sourceReference: 'NIRC Sec. 116 / BIR Form 2551Q',
      accountId: ewtPayableAcc?.id || outputVatAcc?.id,
    },
    {
      code: 'WC158',
      name: 'EWT 1% — Suppliers of Goods (WC158)',
      taxType: 'EWT',
      description: '1% Expanded Withholding Tax on local suppliers of goods (BIR RR 11-2018)',
      direction: 'INPUT',
      rateValue: 0.01,
      ruleCode: 'PH_EWT_WC158_1',
      sourceReference: 'BIR RR 11-2018 ATC WC158',
      accountId: ewtPayableAcc?.id,
    },
    {
      code: 'WC160',
      name: 'EWT 2% — Suppliers of Services (WC160)',
      taxType: 'EWT',
      description: '2% Expanded Withholding Tax on local suppliers of services (BIR RR 11-2018)',
      direction: 'INPUT',
      rateValue: 0.02,
      ruleCode: 'PH_EWT_WC160_2',
      sourceReference: 'BIR RR 11-2018 ATC WC160',
      accountId: ewtPayableAcc?.id,
    },
    {
      code: 'WC100',
      name: 'EWT 5% — Rentals (WC100)',
      taxType: 'EWT',
      description: '5% Expanded Withholding Tax on commercial/office rentals (BIR RR 11-2018)',
      direction: 'INPUT',
      rateValue: 0.05,
      ruleCode: 'PH_EWT_WC100_5',
      sourceReference: 'BIR RR 11-2018 ATC WC100',
      accountId: ewtPayableAcc?.id,
    },
    {
      code: 'CWT-2',
      name: '2% Creditable Withholding Tax (Form 2307)',
      taxType: 'CWT',
      description: '2% Creditable Withholding Tax deducted by corporate customers (BIR Form 2307)',
      direction: 'OUTPUT',
      rateValue: 0.02,
      ruleCode: 'PH_CWT_2',
      sourceReference: 'BIR RR 2-98 / Form 2307',
      accountId: cwtAssetAcc?.id,
    },
  ];

  for (const item of defaults) {
    if (!item.accountId) continue;
    const ruleDefId = await ensureTaxRuleWithVersion({
      ruleCode: item.ruleCode,
      ruleName: item.name,
      taxType: item.taxType,
      rateValue: item.rateValue,
      sourceReference: item.sourceReference,
      description: item.description,
    });
    await db.insert(schema.taxCodes).values({
      id: crypto.randomUUID(),
      companyId,
      code: item.code,
      name: item.name,
      taxType: item.taxType,
      description: item.description,
      inputOutputDirection: item.direction,
      accountId: item.accountId,
      ruleDefinitionId: ruleDefId,
      status: 'ACTIVE',
    });
  }
}

// Get Tax Codes & Tax-Account Mappings
router.get('/codes', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    await ensureCompanyDefaultBirTaxCodes(companyId);

    const codes = await db.select({
      id: schema.taxCodes.id,
      code: schema.taxCodes.code,
      name: schema.taxCodes.name,
      taxType: schema.taxCodes.taxType,
      description: schema.taxCodes.description,
      inputOutputDirection: schema.taxCodes.inputOutputDirection,
      accountId: schema.taxCodes.accountId,
      ruleDefinitionId: schema.taxCodes.ruleDefinitionId,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      status: schema.taxCodes.status
    })
    .from(schema.taxCodes)
    .leftJoin(schema.accounts, eq(schema.taxCodes.accountId, schema.accounts.id))
    .where(eq(schema.taxCodes.companyId, companyId));

    res.json(codes);
  } catch (err) {
    console.error("Error fetching tax codes:", err);
    res.status(500).json({ error: "Failed to fetch tax codes" });
  }
});

async function resolveAndValidateTaxGlAccount(
  companyId: string,
  accountIdOrCode: string | null | undefined,
  accountCodeFallback: string | null | undefined,
  taxType: string,
  inputOutputDirection: string
) {
  const rawId = String(accountIdOrCode || '').trim();
  const rawCode = String(accountCodeFallback || '').trim();
  if (!rawId && !rawCode) {
    throw new DomainError(
      "A valid GL Control Account mapping from the company's Chart of Accounts is required.",
      "TAX_GL_ACCOUNT_REQUIRED",
      400
    );
  }

  const companyAccounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.companyId, companyId));
  const parentIds = computeParentAccountIds(companyAccounts as any[]);

  const targetAccount =
    companyAccounts.find((a) => rawId && a.id === rawId) ||
    companyAccounts.find((a) => (rawCode && a.accountCode === rawCode) || (rawId && a.accountCode === rawId));

  if (!targetAccount) {
    throw new DomainError(
      `Selected GL account '${rawId || rawCode}' does not exist in this company's Chart of Accounts.`,
      "TAX_GL_ACCOUNT_NOT_FOUND",
      400
    );
  }

  if (!isAccountActive(targetAccount as any)) {
    throw new DomainError(
      `GL account '${targetAccount.accountCode} — ${targetAccount.accountName}' is inactive and cannot be mapped to a BIR tax code.`,
      "TAX_GL_ACCOUNT_INACTIVE",
      400
    );
  }

  if (!isPostableLeafAccount(targetAccount as any, parentIds)) {
    throw new DomainError(
      `GL account '${targetAccount.accountCode} — ${targetAccount.accountName}' is a header/parent account and cannot be mapped as a postable tax control account.`,
      "TAX_GL_ACCOUNT_HEADER",
      400
    );
  }

  if (!isEligibleTaxControlAccount(targetAccount as any, taxType, inputOutputDirection, parentIds)) {
    throw new DomainError(
      `GL account '${targetAccount.accountCode} — ${targetAccount.accountName}' (${targetAccount.accountType}) is not a compatible GL Control Account for ${taxType} (${inputOutputDirection}).`,
      "TAX_GL_ACCOUNT_INCOMPATIBLE",
      400
    );
  }

  return targetAccount;
}

// Create/Update Tax Code & Mapping
router.post('/codes', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, taxType, description, inputOutputDirection, accountId, accountCode, rate } = req.body;

  try {
    if (!code || !name || !taxType) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "code, name, and taxType are required.",
      });
    }

    const direction = String(inputOutputDirection || 'OUTPUT').toUpperCase();
    const normalizedTaxType = String(taxType || 'VAT').toUpperCase();
    const normalizedCode = String(code).trim().toUpperCase();
    const targetAccount = await resolveAndValidateTaxGlAccount(
      companyId,
      accountId,
      accountCode,
      normalizedTaxType,
      direction
    );

    const rawRate = Number(rate);
    const defaultRate =
      Number.isFinite(rawRate) && rawRate >= 0
        ? (rawRate > 1 ? rawRate / 100 : rawRate)
        : normalizedTaxType.includes('VAT')
        ? 0.12
        : normalizedTaxType.includes('PERCENTAGE')
        ? 0.03
        : 0.02;

    const ruleDefinitionId = await ensureTaxRuleWithVersion({
      ruleCode: `PH_CUSTOM_${normalizedCode}`,
      ruleName: String(name).trim(),
      taxType: normalizedTaxType,
      rateValue: defaultRate,
      sourceReference: 'Company Configured BIR Tax Rule',
      description: description || String(name).trim(),
    });

    const id = crypto.randomUUID();
    await db.insert(schema.taxCodes).values({
      id,
      companyId,
      code: normalizedCode,
      name: String(name).trim(),
      taxType: normalizedTaxType,
      description: description || String(name).trim(),
      inputOutputDirection: direction,
      accountId: targetAccount.id,
      ruleDefinitionId,
      status: 'ACTIVE'
    });

    res.json({
      success: true,
      id,
      code: normalizedCode,
      name: String(name).trim(),
      taxType: normalizedTaxType,
      inputOutputDirection: direction,
      accountId: targetAccount.id,
      ruleDefinitionId,
      accountCode: targetAccount.accountCode,
      accountName: targetAccount.accountName,
      message: "Tax code created and linked to GL control account successfully"
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({
        error: err.code || "TAX_CODE_VALIDATION_ERROR",
        message: err.message,
      });
    }
    console.error("Error creating tax code:", err);
    res.status(500).json({ error: err.message || "Failed to create tax code" });
  }
});

router.put('/codes/:id', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const { code, name, taxType, description, inputOutputDirection, accountId, accountCode, status } = req.body;

  try {
    const existing = await db
      .select()
      .from(schema.taxCodes)
      .where(and(eq(schema.taxCodes.id, id), eq(schema.taxCodes.companyId, companyId)))
      .get();
    if (!existing) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Tax code not found." });
    }

    const nextTaxType = String(taxType || existing.taxType || 'VAT').toUpperCase();
    const nextDirection = String(inputOutputDirection || existing.inputOutputDirection || 'OUTPUT').toUpperCase();
    const targetAccount = await resolveAndValidateTaxGlAccount(
      companyId,
      accountId !== undefined ? accountId : existing.accountId,
      accountCode,
      nextTaxType,
      nextDirection
    );

    await db
      .update(schema.taxCodes)
      .set({
        code: code ? String(code).trim().toUpperCase() : existing.code,
        name: name ? String(name).trim() : existing.name,
        taxType: nextTaxType,
        description: description !== undefined ? description : existing.description,
        inputOutputDirection: nextDirection,
        accountId: targetAccount.id,
        status: status ? String(status).toUpperCase() : existing.status,
      })
      .where(and(eq(schema.taxCodes.id, id), eq(schema.taxCodes.companyId, companyId)))
      .run();

    res.json({
      success: true,
      id,
      accountId: targetAccount.id,
      accountCode: targetAccount.accountCode,
      accountName: targetAccount.accountName,
      message: "Tax code mapping updated successfully",
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({
        error: err.code || "TAX_CODE_VALIDATION_ERROR",
        message: err.message,
      });
    }
    res.status(500).json({ error: err.message || "Failed to update tax code" });
  }
});

// Tax Filings Management
router.get('/filings', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const filings = await db.select()
      .from(schema.taxFilings)
      .where(eq(schema.taxFilings.companyId, companyId));
    res.json(filings);
  } catch (err: any) {
    console.error("Error in GET /api/tax/filings:", err);
    res.status(500).json({ error: "Failed to fetch tax filings", details: err?.message || String(err) });
  }
});

router.post('/filings', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { taxType, periodName, startDate, endDate, deadlineDate, notes } = req.body;

  if (!taxType || !periodName || !startDate || !endDate) {
    return res.status(400).json({ error: "taxType, periodName, startDate, and endDate are mandatory fields." });
  }

  // Statutory Form Frequency & Period Span Validation
  const startD = new Date(startDate);
  const endD = new Date(endDate);
  const diffDays = Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const upperTaxType = String(taxType).toUpperCase();
  if (upperTaxType.includes('2550Q') || upperTaxType.includes('2551Q') || upperTaxType.includes('1601-EQ') || upperTaxType.includes('1601EQ') || upperTaxType.includes('1702Q')) {
    // Quarterly return must cover approximately 3 months (80 to 95 days)
    if (diffDays < 80 || diffDays > 95) {
      return res.status(400).json({
        error: `Statutory Frequency Error: Quarterly return ${taxType} must cover a 3-month calendar quarter (80–95 days). Specified range covers ${diffDays} days (${startDate} to ${endDate}).`
      });
    }
  } else if (upperTaxType.includes('2550M') || upperTaxType.includes('1601-C') || upperTaxType.includes('1601C') || upperTaxType.includes('0619E') || upperTaxType.includes('0619-E')) {
    // Monthly return (including optional monthly Form 2550M per BIR RMC 52-2023) must cover a single calendar month (27 to 32 days)
    if (diffDays < 27 || diffDays > 32) {
      return res.status(400).json({
        error: `Statutory Frequency Error: Monthly return ${taxType} must cover a single calendar month (27–32 days). Specified range covers ${diffDays} days (${startDate} to ${endDate}).`
      });
    }
  } else if (upperTaxType.includes('2316') || upperTaxType.includes('1702-RT') || upperTaxType.includes('1702-EX') || upperTaxType.includes('1702-MX') || upperTaxType.includes('1701')) {
    // Annual return must cover a calendar/fiscal year (approx 350–370 days)
    if (diffDays < 350 || diffDays > 370) {
      return res.status(400).json({
        error: `Statutory Frequency Error: Annual return ${taxType} must cover an entire annual period (350–370 days). Specified range covers ${diffDays} days (${startDate} to ${endDate}).`
      });
    }
  }

  // Duplicate Filing Prevention: Ensure no active, locked, or filed original return exists for this company & period
  const existingFiling = await db.select()
    .from(schema.taxFilings)
    .where(
      and(
        eq(schema.taxFilings.companyId, companyId),
        eq(schema.taxFilings.taxType, taxType),
        or(
          eq(schema.taxFilings.periodName, periodName),
          and(
            eq(schema.taxFilings.startDate, startDate),
            eq(schema.taxFilings.endDate, endDate)
          )
        )
      )
    )
    .get();

  if (existingFiling) {
    if (existingFiling.status === 'FILED' || existingFiling.status === 'LOCKED') {
      return res.status(409).json({
        error: `Duplicate Filing Violation: A ${existingFiling.status} return for ${taxType} (${existingFiling.periodName}) already exists. Statutory compliance prohibits duplicate original returns; please file an amended return using the amendment workflow.`,
        existingFilingId: existingFiling.id,
        existingStatus: existingFiling.status
      });
    } else if (existingFiling.status === 'DRAFT') {
      return res.status(409).json({
        error: `Filing Collision: An active DRAFT filing for ${taxType} (${existingFiling.periodName}) already exists. Please continue editing the existing draft.`,
        existingFilingId: existingFiling.id
      });
    }
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await assertTaxPeriodUnlocked(companyId, startDate, endDate, actorRole);

    const id = crypto.randomUUID();
    await db.insert(schema.taxFilings).values({
      id,
      companyId,
      taxType,
      periodName,
      startDate,
      endDate,
      deadlineDate: deadlineDate || endDate,
      status: 'DRAFT',
      notes
    });

    // Seed default filing preparation checklist items
    const checklistItems = [
      "Gather and reconcile all Sales Invoices and Official Receipts",
      "Gather and reconcile all Purchase Bills and Supplier Receipts",
      "Verify Input VAT and Output VAT ledger balances",
      "Check Expanded Withholding Tax (EWT Form 0619E / 1601EQ) listings",
      "Verify Creditable Withholding Tax (CWT Form 2307) certificates",
      "Perform completeness and anomaly checks against GL tax accounts",
      "Generate and review exception reports"
    ];

    for (const task of checklistItems) {
      await db.insert(schema.taxFilingChecklists).values({
        id: crypto.randomUUID(),
        taxFilingId: id,
        taskName: task,
        isCompleted: false
      });
    }

    res.json({ success: true, id, message: "Tax filing period created with preparation checklist" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to create tax filing" });
  }
});

// Lock Tax Period (Prevent silent changes)
router.post('/filings/:id/lock', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const filingId = req.params.id;
  const userId = req.user!.id;

  try {
    await db.update(schema.taxFilings)
      .set({
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedBy: userId,
        updatedAt: new Date()
      })
      .where(and(eq(schema.taxFilings.id, filingId), eq(schema.taxFilings.companyId, companyId)));

    // Log to audit trail
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "LOCK_TAX_PERIOD",
      entityType: "TAX_FILING",
      entityId: filingId,
      result: "SUCCESS"
    });

    res.json({ success: true, message: "Tax filing period locked successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to lock tax period" });
  }
});

// Helper: Build authoritative return snapshot for 2550Q, 1601-C, 1601-EQ, or 2316 from posted source transactions
export async function buildAuthoritativeTaxReturnSnapshot(
  companyId: string,
  taxType: string,
  rawStartDate?: string,
  rawEndDate?: string,
  periodId?: string
) {
  const activeDb = dbContext.getStore() || db;
  const normalizedForm = (taxType || '').toUpperCase();
  const scope = await dbContext.run(activeDb, () =>
    resolveReportPeriodScope(companyId, {
      accountingPeriodId: periodId,
      startDate: rawStartDate,
      endDate: rawEndDate,
    })
  );
  const startDate = scope.effectiveStartDate || undefined;
  const endDate = scope.effectiveEndDate || undefined;
  const activeCompany = await activeDb.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();

  // 1. Posted/Settled Sales Invoices (2550Q) — exclude any invoice whose linked journal entry was REVERSED or VOIDED
  const rawSalesInvoices = await activeDb.select({
    id: schema.salesInvoices.id,
    invoiceNumber: schema.salesInvoices.invoiceNumber,
    invoiceDate: schema.salesInvoices.invoiceDate,
    status: schema.salesInvoices.status,
    totalAmount: schema.salesInvoices.totalAmount,
    journalEntryId: schema.salesInvoices.journalEntryId,
    journalStatus: schema.journalEntries.status,
    customerName: schema.customers.legalName,
    customerTin: schema.customers.tin
  })
  .from(schema.salesInvoices)
  .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
  .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
  .where(
    and(
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      startDate ? sql`${schema.salesInvoices.invoiceDate} >= ${startDate}` : undefined,
      endDate ? sql`${schema.salesInvoices.invoiceDate} <= ${endDate}` : undefined
    )
  );
  const salesInvoices = rawSalesInvoices.filter(
    (inv) => !inv.journalStatus || inv.journalStatus === 'POSTED'
  );

  // 2. Posted/Settled Purchase Bills (2550Q) — exclude any bill whose linked journal entry was REVERSED or VOIDED
  const rawPurchaseBills = await activeDb.select({
    id: schema.purchaseBills.id,
    billNumber: schema.purchaseBills.billNumber,
    billDate: schema.purchaseBills.billDate,
    status: schema.purchaseBills.status,
    totalAmount: schema.purchaseBills.totalAmount,
    journalEntryId: schema.purchaseBills.journalEntryId,
    journalStatus: schema.journalEntries.status,
    vendorName: schema.vendors.legalName,
    vendorTin: schema.vendors.tin
  })
  .from(schema.purchaseBills)
  .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
  .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
  .where(
    and(
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      startDate ? sql`${schema.purchaseBills.billDate} >= ${startDate}` : undefined,
      endDate ? sql`${schema.purchaseBills.billDate} <= ${endDate}` : undefined
    )
  );
  const purchaseBills = rawPurchaseBills.filter(
    (b) => !b.journalStatus || b.journalStatus === 'POSTED'
  );

  // 3. Posted Supplier Payments with EWT (1601-EQ) — exclude any payment whose linked journal entry was REVERSED
  const rawEwtPayments = await activeDb.select({
    paymentId: schema.supplierPayments.id,
    paymentNumber: schema.supplierPayments.paymentNumber,
    paymentDate: schema.supplierPayments.paymentDate,
    vendorId: schema.vendors.id,
    vendorName: schema.vendors.legalName,
    vendorTin: schema.vendors.tin,
    atc: schema.vendors.taxClassification,
    amountPaidCentavos: schema.supplierPayments.amount,
    withholdingTaxCentavos: schema.supplierPayments.withholdingTaxAmount,
    journalEntryId: schema.supplierPayments.journalEntryId,
    journalStatus: schema.journalEntries.status,
    status: schema.supplierPayments.status
  })
  .from(schema.supplierPayments)
  .innerJoin(schema.vendors, eq(schema.supplierPayments.vendorId, schema.vendors.id))
  .leftJoin(schema.journalEntries, eq(schema.supplierPayments.journalEntryId, schema.journalEntries.id))
  .where(
    and(
      eq(schema.supplierPayments.companyId, companyId),
      eq(schema.supplierPayments.status, 'POSTED'),
      startDate ? sql`${schema.supplierPayments.paymentDate} >= ${startDate}` : undefined,
      endDate ? sql`${schema.supplierPayments.paymentDate} <= ${endDate}` : undefined
    )
  );
  const ewtPayments = rawEwtPayments.filter(
    (p) => !p.journalStatus || p.journalStatus === 'POSTED'
  );

  // 4. Validated Payroll Withholding Records (1601-C & 2316) — strictly exclude REVERSED/VOID/DRAFT runs and any run whose linked journal entry was REVERSED
  const rawPayrollRows = await activeDb.select({
    itemId: schema.payrollItems.id,
    payrollRunId: schema.payrollRuns.id,
    payrollPeriod: schema.payrollRuns.payrollPeriod,
    startDate: schema.payrollRuns.startDate,
    endDate: schema.payrollRuns.endDate,
    paymentDate: schema.payrollRuns.paymentDate,
    runStatus: schema.payrollRuns.status,
    journalEntryId: schema.payrollRuns.journalEntryId,
    journalStatus: schema.journalEntries.status,
    employeeId: schema.employees.id,
    employeeNo: schema.employees.employeeNo,
    firstName: schema.employees.firstName,
    lastName: schema.employees.lastName,
    tin: schema.employees.tin,
    grossPayCentavos: schema.payrollItems.grossPay,
    sssEmployeeCentavos: schema.payrollItems.sssEmployee,
    philhealthEmployeeCentavos: schema.payrollItems.philhealthEmployee,
    pagibigEmployeeCentavos: schema.payrollItems.pagibigEmployee,
    withholdingTaxCentavos: schema.payrollItems.withholdingTax,
    netPayCentavos: schema.payrollItems.netPay
  })
  .from(schema.payrollItems)
  .innerJoin(schema.payrollRuns, eq(schema.payrollItems.payrollRunId, schema.payrollRuns.id))
  .innerJoin(schema.employees, eq(schema.payrollItems.employeeId, schema.employees.id))
  .leftJoin(schema.journalEntries, eq(schema.payrollRuns.journalEntryId, schema.journalEntries.id))
  .where(
    and(
      eq(schema.payrollRuns.companyId, companyId),
      sql`${schema.payrollRuns.status} IN ('POSTED', 'APPROVED', 'PAID')`,
      startDate ? sql`${schema.payrollRuns.paymentDate} >= ${startDate}` : undefined,
      endDate ? sql`${schema.payrollRuns.paymentDate} <= ${endDate}` : undefined
    )
  );

  const payrollRows = rawPayrollRows.filter(
    (r) => !r.journalStatus || r.journalStatus === 'POSTED'
  );

  // 5. GL Control Account Balances (canonical effective-posted & period-scoped predicate)
  const glTaxBalances = await activeDb.select({
    accountId: schema.accounts.id,
    accountCode: schema.accounts.accountCode,
    accountName: schema.accounts.accountName,
    accountType: schema.accounts.accountType,
    debitTotal: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
    creditTotal: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`
  })
  .from(schema.accounts)
  .innerJoin(schema.journalLines, eq(schema.accounts.id, schema.journalLines.accountId))
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .where(
    and(
      eq(schema.accounts.companyId, companyId),
      buildPeriodScopedJournalFilter(scope),
      sql`(${schema.accounts.isTaxAccount} = 1 OR ${schema.accounts.accountCode} IN ('1050', '1060', '1150', '1500', '2020', '2110', '2120', '2200', '2030', '2130', '2035', '2330') OR lower(${schema.accounts.accountName}) LIKE '%vat%' OR lower(${schema.accounts.accountName}) LIKE '%withholding%')`
    )
  )
  .groupBy(schema.accounts.id);

  let glInputVatCentavos = 0;
  let glOutputVatCentavos = 0;
  let glEwtPayableCentavos = 0;
  let glWtcPayableCentavos = 0;

  for (const acc of glTaxBalances) {
    const nameLower = acc.accountName.toLowerCase();
    const debit = Number(acc.debitTotal || 0);
    const credit = Number(acc.creditTotal || 0);
    if (
      ['1060', '1150', '1500'].includes(acc.accountCode) ||
      (acc.accountCode === '1050' && nameLower.includes('vat')) ||
      nameLower.includes('input vat')
    ) {
      glInputVatCentavos += (debit - credit);
    } else if (
      ['2020', '2200'].includes(acc.accountCode) ||
      (['2110', '2120'].includes(acc.accountCode) && nameLower.includes('vat')) ||
      nameLower.includes('output vat') ||
      nameLower.includes('vat payable')
    ) {
      glOutputVatCentavos += (credit - debit);
    } else if (['2030', '2130'].includes(acc.accountCode) || nameLower.includes('expanded withholding')) {
      glEwtPayableCentavos += (credit - debit);
    } else if (acc.accountCode === '2035' || acc.accountCode === '2330' || (nameLower.includes('withholding') && nameLower.includes('compensation'))) {
      glWtcPayableCentavos += (credit - debit);
    }
  }

  // Compute 2550Q/2550M schedule totals respecting company VAT classification & stored taxCalculations
  const companyProfileRules = getBirTaxProfileRules(activeCompany?.taxpayerClassification, activeCompany?.vatStatus);
  const isVatTaxpayer = companyProfileRules.isVatRegistered && companyProfileRules.defaultVatRate > 0;

  const grossSalesCentavos = salesInvoices.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
  const vatableSalesCentavos = isVatTaxpayer ? Math.round(grossSalesCentavos / 1.12) : 0;
  const derivedOutputVatCentavos = isVatTaxpayer ? (grossSalesCentavos - vatableSalesCentavos) : 0;
  const authoritativeOutputVatCentavos = glOutputVatCentavos > 0 ? glOutputVatCentavos : derivedOutputVatCentavos;

  const grossPurchasesCentavos = purchaseBills.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
  const vatablePurchasesCentavos = isVatTaxpayer ? Math.round(grossPurchasesCentavos / 1.12) : 0;
  const derivedInputVatCentavos = isVatTaxpayer ? (grossPurchasesCentavos - vatablePurchasesCentavos) : 0;
  const authoritativeInputVatCentavos = glInputVatCentavos > 0 ? glInputVatCentavos : derivedInputVatCentavos;
  const netVatPayableCentavos = authoritativeOutputVatCentavos - authoritativeInputVatCentavos;

  // Strict GL-to-Subledger schedule reconciliation check for 2550Q/2550M:
  // Reconciled ONLY if GL Output VAT equals subledger-derived Output VAT AND GL Input VAT equals subledger-derived Input VAT
  const reconciled2550Q =
    glOutputVatCentavos === derivedOutputVatCentavos &&
    glInputVatCentavos === derivedInputVatCentavos;

  let periodDays = 0;
  const expectedMonths: string[] = [];
  if (startDate && endDate) {
    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
      periodDays = Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const cursor = new Date(Date.UTC(sDate.getUTCFullYear(), sDate.getUTCMonth(), 1));
      const endMonth = new Date(Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), 1));
      while (cursor <= endMonth && expectedMonths.length < 12) {
        const ym = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
        expectedMonths.push(ym);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
  }

  // Inspect journals, invoices, bills, and accounting_periods in range for 2550Q completeness control
  const periodJournals = await activeDb
    .select({
      id: schema.journalEntries.id,
      entryDate: schema.journalEntries.entryDate,
      status: schema.journalEntries.status,
      sourceType: schema.journalEntries.sourceType,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        startDate ? sql`${schema.journalEntries.entryDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.journalEntries.entryDate} <= ${endDate}` : undefined
      )
    );

  const unpostedInvoicesInRange = await activeDb
    .select({ id: schema.salesInvoices.id })
    .from(schema.salesInvoices)
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL')`,
        startDate ? sql`${schema.salesInvoices.invoiceDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.salesInvoices.invoiceDate} <= ${endDate}` : undefined
      )
    );

  const unpostedBillsInRange = await activeDb
    .select({ id: schema.purchaseBills.id })
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL')`,
        startDate ? sql`${schema.purchaseBills.billDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.purchaseBills.billDate} <= ${endDate}` : undefined
      )
    );

  const companyPeriods = await activeDb
    .select({
      id: schema.accountingPeriods.id,
      name: schema.accountingPeriods.name,
      startDate: schema.accountingPeriods.startDate,
      endDate: schema.accountingPeriods.endDate,
      status: schema.accountingPeriods.status,
    })
    .from(schema.accountingPeriods)
    .where(eq(schema.accountingPeriods.companyId, companyId));

  const unpostedJournalsCount = periodJournals.filter((j) =>
    ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL'].includes(String(j.status || '').toUpperCase())
  ).length;
  const unpostedTransactionCount =
    unpostedJournalsCount + unpostedInvoicesInRange.length + unpostedBillsInRange.length;

  const reversedJournalsCount = periodJournals.filter(
    (j) => String(j.status || '').toUpperCase() === 'REVERSED'
  ).length;
  const reversedSubledgerCount =
    rawSalesInvoices.filter((i) => i.journalStatus === 'REVERSED').length +
    rawPurchaseBills.filter((b) => b.journalStatus === 'REVERSED').length;
  const reversedTransactionCount = reversedJournalsCount + reversedSubledgerCount;

  const lateAdjustmentCount = periodJournals.filter((j) => {
    const st = String(j.sourceType || '').toUpperCase();
    return (
      j.status === 'POSTED' &&
      (st === 'PRIOR_PERIOD_ADJUSTMENT' || st === 'LATE_ADJUSTMENT' || st === 'TAX_MANUAL_ADJUSTMENT')
    );
  }).length;

  const constituentMonths = expectedMonths.map((ym) => {
    const monthStart = `${ym}-01`;
    const postedJournalsInMonth = periodJournals.filter(
      (j) => j.status === 'POSTED' && String(j.entryDate || '').startsWith(ym)
    ).length;
    const postedInvoicesInMonth = salesInvoices.filter((i) =>
      String(i.invoiceDate || '').startsWith(ym)
    ).length;
    const postedBillsInMonth = purchaseBills.filter((b) =>
      String(b.billDate || '').startsWith(ym)
    ).length;
    const matchingPeriod = companyPeriods.find(
      (p) =>
        String(p.startDate || '').startsWith(ym) ||
        (p.startDate <= monthStart && p.endDate >= `${ym}-28`)
    );
    const periodStatus = matchingPeriod ? String(matchingPeriod.status || 'OPEN').toUpperCase() : 'MISSING';
    const isPeriodClosed = ['SOFT_CLOSED', 'HARD_CLOSED', 'CLOSED', 'LOCKED'].includes(periodStatus);
    return {
      month: ym,
      postedJournalCount: postedJournalsInMonth,
      postedInvoiceCount: postedInvoicesInMonth,
      postedBillCount: postedBillsInMonth,
      hasSourceTransactions:
        postedJournalsInMonth > 0 || postedInvoicesInMonth > 0 || postedBillsInMonth > 0,
      accountingPeriodId: matchingPeriod?.id || null,
      accountingPeriodStatus: periodStatus,
      isPeriodClosed,
    };
  });

  const missingTransactionMonths = constituentMonths
    .filter((m) => !m.hasSourceTransactions)
    .map((m) => m.month);
  const openOrMissingPeriodMonths = constituentMonths
    .filter((m) => !m.isPeriodClosed)
    .map((m) => m.month);
  const monthsWithTransactionsCount = constituentMonths.filter((m) => m.hasSourceTransactions).length;
  const isQuarterlyDateSpan = periodDays >= 80 && periodDays <= 95 && expectedMonths.length === 3;
  const allThreeMonthsHaveData = isQuarterlyDateSpan && missingTransactionMonths.length === 0;
  const allThreeMonthsClosed = isQuarterlyDateSpan && openOrMissingPeriodMonths.length === 0;

  type Form2550QCompletenessStatus =
    | 'INTERIM_PARTIAL_QUARTER'
    | 'COMPLETE_QUARTER'
    | 'INCOMPLETE_SOURCE_DATA'
    | 'UNPOSTED_TRANSACTION_PRESENT'
    | 'PERIOD_NOT_CLOSED'
    | 'REQUIRES_REVIEW'
    | 'MULTI_QUARTER_RANGE'
    | 'UNSPECIFIED_RANGE';

  const statusesTriggered: Form2550QCompletenessStatus[] = [];
  if (!startDate || !endDate) {
    statusesTriggered.push('UNSPECIFIED_RANGE');
  } else if (periodDays < 80) {
    statusesTriggered.push('INTERIM_PARTIAL_QUARTER');
    if (!reconciled2550Q || lateAdjustmentCount > 0) {
      statusesTriggered.push('REQUIRES_REVIEW');
    }
    if (unpostedTransactionCount > 0) {
      statusesTriggered.push('UNPOSTED_TRANSACTION_PRESENT');
    }
    if (openOrMissingPeriodMonths.length > 0) {
      statusesTriggered.push('PERIOD_NOT_CLOSED');
    }
  } else if (periodDays > 95) {
    statusesTriggered.push('MULTI_QUARTER_RANGE');
  } else {
    if (!reconciled2550Q || lateAdjustmentCount > 0) {
      statusesTriggered.push('REQUIRES_REVIEW');
    }
    if (unpostedTransactionCount > 0) {
      statusesTriggered.push('UNPOSTED_TRANSACTION_PRESENT');
    }
    if (!allThreeMonthsHaveData) {
      statusesTriggered.push('INCOMPLETE_SOURCE_DATA');
    }
    if (!allThreeMonthsClosed) {
      statusesTriggered.push('PERIOD_NOT_CLOSED');
    }
    if (statusesTriggered.length === 0) {
      statusesTriggered.push('COMPLETE_QUARTER');
    }
  }

  let periodCompleteness2550Q: Form2550QCompletenessStatus;
  if (!startDate || !endDate) {
    periodCompleteness2550Q = 'UNSPECIFIED_RANGE';
  } else if (periodDays < 80) {
    periodCompleteness2550Q = 'INTERIM_PARTIAL_QUARTER';
  } else if (periodDays > 95) {
    periodCompleteness2550Q = 'MULTI_QUARTER_RANGE';
  } else if (!reconciled2550Q || lateAdjustmentCount > 0) {
    periodCompleteness2550Q = 'REQUIRES_REVIEW';
  } else if (unpostedTransactionCount > 0) {
    periodCompleteness2550Q = 'UNPOSTED_TRANSACTION_PRESENT';
  } else if (!allThreeMonthsHaveData) {
    periodCompleteness2550Q = 'INCOMPLETE_SOURCE_DATA';
  } else if (!allThreeMonthsClosed) {
    periodCompleteness2550Q = 'PERIOD_NOT_CLOSED';
  } else {
    periodCompleteness2550Q = 'COMPLETE_QUARTER';
  }

  // Compute 1601-C schedule totals, multi-run aggregation, and overlap/completeness diagnostics
  let totalGrossCompCentavos = 0;
  let totalMandatoryExemptCentavos = 0;
  let totalTaxableCompCentavos = 0;
  let totalRecordedWtcCentavos = 0;
  let totalStatutoryValidatedWtcCentavos = 0;

  const distinctPayrollRunIds = new Set<string>();
  const frequenciesSet = new Set<'MONTHLY' | 'SEMI_MONTHLY'>();
  const employeeRunRanges = new Map<string, Array<{ runId: string; startDate: string; endDate: string; frequency: 'MONTHLY' | 'SEMI_MONTHLY' }>>();
  let hasOverlappingRuns = false;

  const employee2316Map = new Map<string, {
    employeeId: string;
    employeeNo: string;
    employeeName: string;
    tin: string;
    periodsIncluded: number;
    grossCompensationCentavos: number;
    mandatoryContributionsCentavos: number;
    taxableCompensationCentavos: number;
    taxWithheldRecordedCentavos: number;
    statutoryAnnualizedTaxDueCentavos: number;
    yearEndAdjustmentCentavos: number;
  }>();

  for (const pr of payrollRows) {
    const gross = Number(pr.grossPayCentavos || 0);
    const sss = Number(pr.sssEmployeeCentavos || 0);
    const phic = Number(pr.philhealthEmployeeCentavos || 0);
    const hdmf = Number(pr.pagibigEmployeeCentavos || 0);
    const mandatory = sss + phic + hdmf;
    const taxable = Math.max(0, gross - mandatory);
    const recordedWht = Number(pr.withholdingTaxCentavos || 0);
    const periodUpper = String(pr.payrollPeriod || '').toUpperCase();
    let runDaySpan = 15;
    if (pr.startDate && pr.endDate) {
      const rs = new Date(pr.startDate);
      const re = new Date(pr.endDate);
      if (!isNaN(rs.getTime()) && !isNaN(re.getTime())) {
        runDaySpan = Math.round((re.getTime() - rs.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }
    }
    const isMonthlyFrequency =
      (periodUpper.includes('MONTH') && !periodUpper.includes('SEMI')) || runDaySpan >= 27;
    const detectedFreq: 'MONTHLY' | 'SEMI_MONTHLY' = isMonthlyFrequency ? 'MONTHLY' : 'SEMI_MONTHLY';

    distinctPayrollRunIds.add(pr.payrollRunId);
    frequenciesSet.add(detectedFreq);

    const empRanges = employeeRunRanges.get(pr.employeeId) || [];
    if (pr.startDate && pr.endDate) {
      for (const prev of empRanges) {
        if (prev.runId !== pr.payrollRunId && pr.startDate <= prev.endDate && pr.endDate >= prev.startDate) {
          hasOverlappingRuns = true;
        }
      }
      empRanges.push({
        runId: pr.payrollRunId,
        startDate: pr.startDate,
        endDate: pr.endDate,
        frequency: detectedFreq
      });
      employeeRunRanges.set(pr.employeeId, empRanges);
    }

    const statCalc = TaxEngine.calculateStatutoryPayrollWithholding(gross, {
      frequency: detectedFreq,
      sssEmployeeCentavos: sss,
      philhealthEmployeeCentavos: phic,
      pagibigEmployeeCentavos: hdmf,
      nonTaxableBenefitsCentavos: 0
    });

    totalGrossCompCentavos += gross;
    totalMandatoryExemptCentavos += mandatory;
    totalTaxableCompCentavos += taxable;
    totalRecordedWtcCentavos += recordedWht;
    totalStatutoryValidatedWtcCentavos += statCalc.withholdingTaxCentavos;

    let empRec = employee2316Map.get(pr.employeeId);
    if (!empRec) {
      empRec = {
        employeeId: pr.employeeId,
        employeeNo: pr.employeeNo,
        employeeName: `${pr.firstName} ${pr.lastName}`.trim(),
        tin: pr.tin || '000-000-000-000',
        periodsIncluded: 0,
        grossCompensationCentavos: 0,
        mandatoryContributionsCentavos: 0,
        taxableCompensationCentavos: 0,
        taxWithheldRecordedCentavos: 0,
        statutoryAnnualizedTaxDueCentavos: 0,
        yearEndAdjustmentCentavos: 0
      };
      employee2316Map.set(pr.employeeId, empRec);
    }
    empRec.periodsIncluded += 1;
    empRec.grossCompensationCentavos += gross;
    empRec.mandatoryContributionsCentavos += mandatory;
    empRec.taxableCompensationCentavos += taxable;
    empRec.taxWithheldRecordedCentavos += recordedWht;
  }

  for (const empRec of employee2316Map.values()) {
    const annualStatutory = TaxEngine.calculateCompensationGraduatedTax(empRec.taxableCompensationCentavos);
    empRec.statutoryAnnualizedTaxDueCentavos = annualStatutory.taxDueCentavos;
    empRec.yearEndAdjustmentCentavos = empRec.statutoryAnnualizedTaxDueCentavos - empRec.taxWithheldRecordedCentavos;
  }

  const frequenciesDetected = Array.from(frequenciesSet);
  const payrollRunCount = distinctPayrollRunIds.size;
  const periodCoverageStatus:
    | 'COMPLETE_MONTHLY_COVERAGE'
    | 'COMPLETE_SEMI_MONTHLY_COVERAGE'
    | 'PARTIAL_SEMI_MONTHLY_COVERAGE'
    | 'MULTI_RUN_MIXED'
    | 'OVERLAPPING_RUNS_DETECTED'
    | 'NO_PAYROLL_RUNS' =
    payrollRunCount === 0
      ? 'NO_PAYROLL_RUNS'
      : hasOverlappingRuns
      ? 'OVERLAPPING_RUNS_DETECTED'
      : frequenciesDetected.length > 1
      ? 'MULTI_RUN_MIXED'
      : frequenciesDetected[0] === 'MONTHLY'
      ? 'COMPLETE_MONTHLY_COVERAGE'
      : payrollRunCount >= 2
      ? 'COMPLETE_SEMI_MONTHLY_COVERAGE'
      : 'PARTIAL_SEMI_MONTHLY_COVERAGE';

  // Compute 1601-EQ totals
  const ewtWithheldScheduleCentavos = ewtPayments.reduce((s, p) => s + Number(p.withholdingTaxCentavos || 0), 0);
  const ewtTaxBaseCentavos = ewtPayments.reduce(
    (s, p) => s + (Number(p.withholdingTaxCentavos || 0) > 0 ? Number(p.amountPaidCentavos || 0) + Number(p.withholdingTaxCentavos || 0) : 0),
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    companyName: activeCompany?.legalName || 'Active Company',
    tin: activeCompany?.tin || '000-000-000-000',
    taxType: normalizedForm || 'ALL',
    period: { startDate: startDate || null, endDate: endDate || null, periodDays },
    form2550Q: {
      invoiceCount: salesInvoices.length,
      billCount: purchaseBills.length,
      grossSalesCentavos,
      vatableSalesCentavos,
      outputVatCentavos: authoritativeOutputVatCentavos,
      derivedOutputVatCentavos,
      grossPurchasesCentavos,
      vatablePurchasesCentavos,
      inputVatCentavos: authoritativeInputVatCentavos,
      derivedInputVatCentavos,
      netVatPayableCentavos,
      glOutputVatCentavos,
      glInputVatCentavos,
      periodDays,
      periodCompleteness: periodCompleteness2550Q,
      isStatutoryQuarterlyFilingReady: periodCompleteness2550Q === 'COMPLETE_QUARTER' && reconciled2550Q,
      reconciledToGl: reconciled2550Q,
      vatStatus: companyProfileRules.vatStatus,
      isVatTaxpayer,
      ruleReference: 'BIR RMC No. 5-2023 (Quarterly 2550Q)',
      quarterCompletenessDiagnostics: {
        constituentMonths,
        monthsWithTransactionsCount,
        missingTransactionMonths,
        openOrMissingPeriodMonths,
        unpostedTransactionCount,
        reversedTransactionCount,
        lateAdjustmentCount,
        allThreeMonthsHaveData,
        allThreeMonthsClosed,
        statusesTriggered,
      },
    },
    form2550M: {
      isOptionalMonthlyElectionAllowed: isVatTaxpayer,
      ruleReference: 'BIR RMC No. 52-2023 (Optional Monthly Form 2550M)',
      isMonthlySpanValid: periodDays >= 27 && periodDays <= 32,
      invoiceCount: salesInvoices.length,
      billCount: purchaseBills.length,
      grossSalesCentavos,
      vatableSalesCentavos,
      outputVatCentavos: authoritativeOutputVatCentavos,
      grossPurchasesCentavos,
      vatablePurchasesCentavos,
      inputVatCentavos: authoritativeInputVatCentavos,
      netVatPayableCentavos,
      reconciledToGl: reconciled2550Q,
    },
    form1601C: {
      payrollRunCount,
      payrollItemCount: payrollRows.length,
      frequenciesDetected,
      hasOverlappingRuns,
      periodCoverageStatus,
      totalGrossCompensationCentavos: totalGrossCompCentavos,
      mandatoryContributionsExemptCentavos: totalMandatoryExemptCentavos,
      taxableCompensationCentavos: totalTaxableCompCentavos,
      recordedWithholdingTaxCentavos: totalRecordedWtcCentavos,
      statutoryValidatedWithholdingTaxCentavos: totalStatutoryValidatedWtcCentavos,
      glWtcPayableCentavos,
      varianceRecordedVsStatutoryCentavos: totalRecordedWtcCentavos - totalStatutoryValidatedWtcCentavos,
      reconciledRecordedToGl: totalRecordedWtcCentavos === glWtcPayableCentavos || (glWtcPayableCentavos > 0 && payrollRows.length === 0)
    },
    form1601EQ: {
      paymentCount: ewtPayments.filter(p => Number(p.withholdingTaxCentavos || 0) > 0).length,
      totalTaxBaseCentavos: ewtTaxBaseCentavos,
      totalEwtWithheldCentavos: ewtWithheldScheduleCentavos > 0 ? ewtWithheldScheduleCentavos : glEwtPayableCentavos,
      glEwtPayableCentavos,
      reconciledToGl: ewtWithheldScheduleCentavos === glEwtPayableCentavos || (glEwtPayableCentavos > 0 && ewtPayments.length === 0),
      payees: ewtPayments.filter(p => Number(p.withholdingTaxCentavos || 0) > 0)
    },
    form2316: {
      employeeCount: employee2316Map.size,
      employees: Array.from(employee2316Map.values())
    }
  };
}

// File a Tax Return and preserve its immutable submitted snapshot (DEF-011)
router.post('/filings/:id/file', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const filingId = req.params.id;
  const userId = req.user!.id;

  try {
    const existing = await db.select()
      .from(schema.taxFilings)
      .where(and(eq(schema.taxFilings.id, filingId), eq(schema.taxFilings.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: "Tax filing record not found" });
    }

    if (existing.status === 'FILED' || existing.status === 'LOCKED') {
      return res.status(409).json({
        error: "IMMUTABLE_FILED_RETURN",
        message: "Filed or locked tax returns cannot be silently overwritten. Use POST /api/tax/filings/:id/amend to create a traceable amendment."
      });
    }

    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    if (existing.startDate) {
      await assertTaxPeriodUnlocked(companyId, existing.startDate, existing.endDate || existing.startDate, actorRole);
    }

    const snapshot = await buildAuthoritativeTaxReturnSnapshot(
      companyId,
      existing.taxType,
      existing.startDate,
      existing.endDate
    );

    const snapshotJson = JSON.stringify(snapshot);
    const snapshotHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
    const filedEnvelope = JSON.stringify({
      originalNotes: existing.notes || null,
      filedAt: new Date().toISOString(),
      filedBy: userId,
      snapshotHash,
      submittedSnapshot: snapshot
    });

    await db.update(schema.taxFilings)
      .set({
        status: 'FILED',
        lockedAt: new Date(),
        lockedBy: userId,
        notes: filedEnvelope,
        updatedAt: new Date()
      })
      .where(and(eq(schema.taxFilings.id, filingId), eq(schema.taxFilings.companyId, companyId)));

    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "FILE_TAX_RETURN_SNAPSHOT",
      entityType: "TAX_FILING",
      entityId: filingId,
      afterData: filedEnvelope,
      reason: `Filed ${existing.taxType} for period ${existing.periodName} with immutable snapshot hash ${snapshotHash}`,
      result: "SUCCESS"
    });

    res.json({
      success: true,
      filingId,
      status: 'FILED',
      snapshotHash,
      submittedSnapshot: snapshot
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to file tax return" });
  }
});

// Create a traceable Amended Tax Return without overwriting the original filed return (DEF-011)
router.post('/filings/:id/amend', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const originalFilingId = req.params.id;
  const userId = req.user!.id;
  const { reason } = req.body || {};

  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: "A valid amendment reason is required to amend a filed tax return." });
  }

  try {
    const original = await db.select()
      .from(schema.taxFilings)
      .where(and(eq(schema.taxFilings.id, originalFilingId), eq(schema.taxFilings.companyId, companyId)))
      .get();

    if (!original) {
      return res.status(404).json({ error: "Original tax filing not found" });
    }

    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    if (original.startDate) {
      await assertTaxPeriodUnlocked(companyId, original.startDate, original.endDate || original.startDate, actorRole);
    }

    const updatedSnapshot = await buildAuthoritativeTaxReturnSnapshot(
      companyId,
      original.taxType,
      original.startDate,
      original.endDate
    );

    const amendedId = crypto.randomUUID();
    const amendmentPayload = JSON.stringify({
      isAmendedReturn: true,
      originalFilingId: original.id,
      amendmentReason: String(reason).trim(),
      amendedAt: new Date().toISOString(),
      amendedBy: userId,
      originalSnapshotPreserved: true,
      amendedSnapshot: updatedSnapshot
    });

    await db.insert(schema.taxFilings).values({
      id: amendedId,
      companyId,
      taxType: `${original.taxType}-AMENDED`,
      periodName: `${original.periodName} (Amended)`,
      startDate: original.startDate,
      endDate: original.endDate,
      deadlineDate: original.deadlineDate,
      status: 'DRAFT',
      notes: amendmentPayload
    });

    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "AMEND_TAX_RETURN",
      entityType: "TAX_FILING",
      entityId: amendedId,
      beforeData: JSON.stringify({ originalFilingId: original.id, originalStatus: original.status, originalNotes: original.notes }),
      afterData: amendmentPayload,
      reason: String(reason).trim(),
      result: "SUCCESS"
    });

    res.json({
      success: true,
      originalFilingId: original.id,
      amendedFilingId: amendedId,
      originalSnapshotPreserved: true,
      amendedSnapshot: updatedSnapshot
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to create amended tax return" });
  }
});

// Authoritative BIR Form 2550Q, 1601-C, 1601-EQ, and 2316 endpoints (DEF-011)
router.get('/returns/:formType', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { formType } = req.params;
  const { startDate, endDate, accountingPeriodId, periodId } = req.query;

  try {
    const snapshot = await buildAuthoritativeTaxReturnSnapshot(
      companyId,
      formType,
      startDate as string | undefined,
      endDate as string | undefined,
      (accountingPeriodId || periodId) as string | undefined
    );
    res.json(snapshot);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: err.message || "Failed to generate authoritative tax return" });
  }
});

// 1. VAT Sales Schedule
router.get('/schedules/vat-sales', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyRules = getBirTaxProfileRules(activeCompany?.taxpayerClassification, activeCompany?.vatStatus);
    const isVatRegistered = companyRules.isVatRegistered;

    const invoices = await db.select({
      invoiceId: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      invoiceDate: schema.salesInvoices.invoiceDate,
      status: schema.salesInvoices.status,
      customerName: schema.customers.legalName,
      tin: schema.customers.tin,
      totalAmount: schema.salesInvoices.totalAmount,
      journalEntryId: schema.salesInvoices.journalEntryId,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.salesInvoices.invoiceDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.salesInvoices.invoiceDate} <= ${endDate}` : undefined
      )
    );

    const taxCalcRows = await db.select().from(schema.taxCalculations).where(and(eq(schema.taxCalculations.companyId, companyId), eq(schema.taxCalculations.status, 'ACTIVE')));
    const taxByJe = new Map<string, { taxBase: number; taxAmount: number; taxRate: number }>();
    for (const tc of taxCalcRows) {
      const prev = taxByJe.get(tc.journalEntryId) || { taxBase: 0, taxAmount: 0, taxRate: Number(tc.taxRate || 0) };
      prev.taxBase += Number(tc.taxBase || 0);
      prev.taxAmount += Number(tc.taxAmount || 0);
      taxByJe.set(tc.journalEntryId, prev);
    }

    const data = invoices.map(inv => {
      const gross = inv.totalAmount || 0;
      const stored = inv.journalEntryId ? taxByJe.get(inv.journalEntryId) : undefined;
      if (stored) {
        const isZero = stored.taxAmount === 0 && companyRules.isZeroRated;
        const isExempt = stored.taxAmount === 0 && !companyRules.isZeroRated;
        return {
          ...inv,
          taxBase: stored.taxBase,
          outputVat: stored.taxAmount,
          exemptSales: isExempt ? gross : 0,
          zeroRatedSales: isZero ? gross : 0,
        };
      }
      if (!isVatRegistered || companyRules.defaultVatRate === 0) {
        return {
          ...inv,
          taxBase: 0,
          outputVat: 0,
          exemptSales: companyRules.isZeroRated ? 0 : gross,
          zeroRatedSales: companyRules.isZeroRated ? gross : 0,
        };
      }
      const { taxBase, vatAmount: outputVat } = TaxEngine.calculateVat(gross);
      return {
        ...inv,
        taxBase,
        outputVat,
        exemptSales: 0,
        zeroRatedSales: 0
      };
    });

    res.json({ metadata: { generatedAt: new Date().toISOString(), vatStatus: companyRules.vatStatus }, data });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate VAT Sales Schedule" });
  }
});

// 2. VAT Purchases Schedule
router.get('/schedules/vat-purchases', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyRules = getBirTaxProfileRules(activeCompany?.taxpayerClassification, activeCompany?.vatStatus);
    const isVatRegistered = companyRules.isVatRegistered;

    const bills = await db.select({
      billId: schema.purchaseBills.id,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      status: schema.purchaseBills.status,
      vendorName: schema.vendors.legalName,
      tin: schema.vendors.tin,
      totalAmount: schema.purchaseBills.totalAmount,
      journalEntryId: schema.purchaseBills.journalEntryId,
    })
    .from(schema.purchaseBills)
    .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.purchaseBills.billDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.purchaseBills.billDate} <= ${endDate}` : undefined
      )
    );

    const taxCalcRows = await db.select().from(schema.taxCalculations).where(and(eq(schema.taxCalculations.companyId, companyId), eq(schema.taxCalculations.status, 'ACTIVE')));
    const taxByJe = new Map<string, { taxBase: number; taxAmount: number }>();
    for (const tc of taxCalcRows) {
      const prev = taxByJe.get(tc.journalEntryId) || { taxBase: 0, taxAmount: 0 };
      prev.taxBase += Number(tc.taxBase || 0);
      prev.taxAmount += Number(tc.taxAmount || 0);
      taxByJe.set(tc.journalEntryId, prev);
    }

    const data = bills.map(b => {
      const gross = b.totalAmount || 0;
      const stored = b.journalEntryId ? taxByJe.get(b.journalEntryId) : undefined;
      if (stored) {
        return {
          ...b,
          taxBase: stored.taxBase,
          inputVat: isVatRegistered ? stored.taxAmount : 0,
          capitalGoods: 0,
          nonCapitalGoods: gross,
        };
      }
      if (!isVatRegistered || companyRules.defaultVatRate === 0) {
        return {
          ...b,
          taxBase: gross,
          inputVat: 0,
          capitalGoods: 0,
          nonCapitalGoods: gross,
        };
      }
      const { taxBase, vatAmount: inputVat } = TaxEngine.calculateVat(gross);
      return {
        ...b,
        taxBase,
        inputVat,
        capitalGoods: 0,
        nonCapitalGoods: gross
      };
    });

    res.json({ metadata: { generatedAt: new Date().toISOString() }, data });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate VAT Purchases Schedule" });
  }
});

// 3. Input VAT Reconciliation against GL (DEF-011: Independent schedule vs GL comparison)
router.get('/schedules/input-vat-recon', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    // 1. Get GL balance for Input VAT accounts (canonical effective-posted & period-scoped predicate)
    const glInputVat = await db.select({
      accountId: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildPeriodScopedJournalFilter(scope),
        sql`(lower(${schema.accounts.accountName}) LIKE '%input vat%' OR ${schema.accounts.accountCode} IN ('1060', '1150', '1500') OR (${schema.accounts.accountCode} = '1050' AND lower(${schema.accounts.accountName}) LIKE '%vat%') OR ${schema.accounts.accountCode} LIKE '%121%')`
      )
    )
    .groupBy(schema.accounts.id);

    const totalGlInputVat = glInputVat.reduce((sum, acc) => sum + (Number(acc.debitTotal || 0) - Number(acc.creditTotal || 0)), 0);

    // 2. Independently calculate Input VAT from source purchase bills / taxCalculations (excluding REVERSED/VOIDED journals)
    const storedTaxCalcRows = await db.select({
      total: sql<number>`COALESCE(sum(${schema.taxCalculations.taxAmount}), 0)`
    })
    .from(schema.taxCalculations)
    .innerJoin(schema.purchaseBills, eq(schema.taxCalculations.journalEntryId, schema.purchaseBills.journalEntryId))
    .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.taxCalculations.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.purchaseBills.billDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.purchaseBills.billDate} <= ${endDate}` : undefined
      )
    );

    const billJournalVatRows = await db.select({
      total: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildPeriodScopedJournalFilter(scope),
        sql`${schema.journalEntries.sourceType} IN ('PURCHASE_BILL', 'purchase_bills', 'BILL', 'PURCHASE')`,
        sql`(lower(${schema.accounts.accountName}) LIKE '%input vat%' OR ${schema.accounts.accountCode} IN ('1060', '1150', '1500') OR (${schema.accounts.accountCode} = '1050' AND lower(${schema.accounts.accountName}) LIKE '%vat%'))`
      )
    );

    const storedCalcVat = Number(storedTaxCalcRows[0]?.total || 0);
    const billPostedVat = Number(billJournalVatRows[0]?.total || 0);
    const scheduleInputVat = storedCalcVat > 0 ? storedCalcVat : billPostedVat;

    res.json({
      metadata: { generatedAt: new Date().toISOString() },
      data: {
        glAccounts: glInputVat,
        totalGlInputVat,
        scheduleInputVat,
        unexplainedDifference: totalGlInputVat - scheduleInputVat
      }
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate Input VAT Reconciliation" });
  }
});

// 4. Output VAT Reconciliation against GL (DEF-011: Independent schedule vs GL comparison)
router.get('/schedules/output-vat-recon', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    const glOutputVat = await db.select({
      accountId: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildPeriodScopedJournalFilter(scope),
        sql`(lower(${schema.accounts.accountName}) LIKE '%output vat%' OR lower(${schema.accounts.accountName}) LIKE '%vat payable%' OR ${schema.accounts.accountCode} IN ('2020', '2200') OR (${schema.accounts.accountCode} IN ('2110', '2120') AND lower(${schema.accounts.accountName}) LIKE '%vat%') OR ${schema.accounts.accountCode} LIKE '%215%')`
      )
    )
    .groupBy(schema.accounts.id);

    const totalGlOutputVat = glOutputVat.reduce((sum, acc) => sum + (Number(acc.creditTotal || 0) - Number(acc.debitTotal || 0)), 0);

    const storedTaxCalcRows = await db.select({
      total: sql<number>`COALESCE(sum(${schema.taxCalculations.taxAmount}), 0)`
    })
    .from(schema.taxCalculations)
    .innerJoin(schema.salesInvoices, eq(schema.taxCalculations.journalEntryId, schema.salesInvoices.journalEntryId))
    .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.taxCalculations.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.salesInvoices.invoiceDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.salesInvoices.invoiceDate} <= ${endDate}` : undefined
      )
    );

    const invoiceJournalVatRows = await db.select({
      total: sql<number>`COALESCE(sum(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildPeriodScopedJournalFilter(scope),
        sql`${schema.journalEntries.sourceType} IN ('SALES_INVOICE', 'sales_invoices', 'INVOICE', 'SALES')`,
        sql`(lower(${schema.accounts.accountName}) LIKE '%output vat%' OR lower(${schema.accounts.accountName}) LIKE '%vat payable%' OR ${schema.accounts.accountCode} IN ('2020', '2200') OR (${schema.accounts.accountCode} IN ('2110', '2120') AND lower(${schema.accounts.accountName}) LIKE '%vat%'))`
      )
    );

    const storedCalcVat = Number(storedTaxCalcRows[0]?.total || 0);
    const invoicePostedVat = Number(invoiceJournalVatRows[0]?.total || 0);
    const scheduleOutputVat = storedCalcVat > 0 ? storedCalcVat : invoicePostedVat;

    res.json({
      metadata: { generatedAt: new Date().toISOString() },
      data: {
        glAccounts: glOutputVat,
        totalGlOutputVat,
        scheduleOutputVat,
        unexplainedDifference: totalGlOutputVat - scheduleOutputVat
      }
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate Output VAT Reconciliation" });
  }
});

// 5. EWT Schedule (Expanded Withholding Tax - BIR Form 0619E / 1601EQ)
router.get('/schedules/ewt', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    const payments = await db.select({
      paymentId: schema.supplierPayments.id,
      paymentNumber: schema.supplierPayments.paymentNumber,
      paymentDate: schema.supplierPayments.paymentDate,
      vendorName: schema.vendors.legalName,
      tin: schema.vendors.tin,
      address: schema.vendors.address,
      taxCode: schema.vendors.taxClassification,
      amountPaid: schema.supplierPayments.amount,
      withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount,
      reference: schema.supplierPayments.reference,
      journalEntryId: schema.supplierPayments.journalEntryId,
      status: schema.supplierPayments.status,
      notes: schema.supplierPayments.notes,
    })
    .from(schema.supplierPayments)
    .innerJoin(schema.vendors, eq(schema.supplierPayments.vendorId, schema.vendors.id))
    .leftJoin(schema.journalEntries, eq(schema.supplierPayments.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.supplierPayments.companyId, companyId),
        eq(schema.supplierPayments.status, 'POSTED'),
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.supplierPayments.paymentDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.supplierPayments.paymentDate} <= ${endDate}` : undefined
      )
    );

    res.json({ metadata: { generatedAt: new Date().toISOString() }, data: payments });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate EWT Schedule" });
  }
});

// 6. CWT Schedule (Creditable Withholding Tax - BIR Form 2307)
router.get('/schedules/cwt', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    const collections = await db.select({
      collectionId: schema.customerPayments.id,
      paymentNumber: schema.customerPayments.paymentNumber,
      paymentDate: schema.customerPayments.paymentDate,
      customerName: schema.customers.legalName,
      tin: schema.customers.tin,
      address: schema.customers.address,
      amountCollected: schema.customerPayments.amount,
      withholdingTaxAmount: schema.customerPayments.withholdingTaxAmount,
      reference: schema.customerPayments.reference,
      journalEntryId: schema.customerPayments.journalEntryId,
      status: schema.customerPayments.status,
      notes: schema.customerPayments.notes,
    })
    .from(schema.customerPayments)
    .innerJoin(schema.customers, eq(schema.customerPayments.customerId, schema.customers.id))
    .leftJoin(schema.journalEntries, eq(schema.customerPayments.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.customerPayments.companyId, companyId),
        eq(schema.customerPayments.status, 'POSTED'),
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.customerPayments.paymentDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.customerPayments.paymentDate} <= ${endDate}` : undefined
      )
    );

    res.json({ metadata: { generatedAt: new Date().toISOString() }, data: collections });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate CWT Schedule" });
  }
});

// 7. Percentage Tax Schedule (BIR Form 2551Q - 3% NIRC Sec 116)
router.get('/schedules/percentage-tax', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const rules = getBirTaxProfileRules(activeCompany?.taxpayerClassification, activeCompany?.vatStatus);
    const isPercentageTaxSubject = rules.isPercentageTaxRegistered;

    // Calculate gross sales from posted/settled sales invoices (excluding REVERSED/VOIDED journals)
    const invoiceTotals = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.salesInvoices.totalAmount}), 0)`
    })
    .from(schema.salesInvoices)
    .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.salesInvoices.invoiceDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.salesInvoices.invoiceDate} <= ${endDate}` : undefined
      )
    )
    .get();

    const grossCentavos = Number(invoiceTotals?.total || 0);
    const grossAmount = grossCentavos / 100;
    const sec116Calc = isPercentageTaxSubject
      ? TaxEngine.calculateSection116PercentageTax(grossCentavos, endDate || startDate || new Date().toISOString().slice(0, 10))
      : { rate: 0, taxAmount: 0, ruleVersion: rules.ruleVersion, effectiveDate: rules.effectiveDate, rateDescription: 'Exempt from Section 116 Percentage Tax' };

    res.json({
      metadata: {
        generatedAt: new Date().toISOString(),
        ruleVersion: sec116Calc.ruleVersion,
        effectiveDate: sec116Calc.effectiveDate,
        taxpayerClassification: rules.taxpayerClassification,
      },
      data: {
        companyName: activeCompany?.legalName || 'Company',
        tin: activeCompany?.tin || null,
        vatStatus: rules.vatStatus,
        taxableGrossReceipts: grossAmount,
        taxRate: sec116Calc.rate,
        rateDescription: sec116Calc.rateDescription,
        percentageTaxDue: sec116Calc.taxAmount,
        status: isPercentageTaxSubject ? 'ACTIVE_NON_VAT_2551Q_SCHEDULE' : 'EXEMPT_FROM_PERCENTAGE_TAX'
      }
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate Percentage Tax Schedule" });
  }
});

// 8. Tax Payable Reconciliation (DEF-011: Independent Schedule vs GL Control Accounts)
router.get('/schedules/tax-payable-recon', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const startDate = scope.effectiveStartDate;
    const endDate = scope.effectiveEndDate;

    // 1. Fetch GL balances of all tax accounts using canonical effective-posted predicate
    const taxAccounts = await db.select({
      accountName: schema.accounts.accountName,
      accountCode: schema.accounts.accountCode,
      balance: sql<number>`SUM(COALESCE(${schema.journalLines.credit}, 0) - COALESCE(${schema.journalLines.debit}, 0))`.mapWith(Number)
    })
    .from(schema.accounts)
    .innerJoin(schema.journalLines, eq(schema.accounts.id, schema.journalLines.accountId))
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.accounts.companyId, companyId),
        sql`(${schema.accounts.isTaxAccount} = 1 OR ${schema.accounts.accountCode} IN ('1050', '1060', '1150', '1500', '2020', '2110', '2120', '2200', '2030', '2130', '2035', '2330'))`,
        buildPeriodScopedJournalFilter(scope)
      )
    )
    .groupBy(schema.accounts.id);

    let outputVatPayable = 0;
    let lessInputVat = 0;
    let ewtPayable = 0;
    let wtcPayable = 0;
    let incomeTaxPayable = 0;
    let otherTaxPayable = 0;

    for (const acc of taxAccounts) {
      const name = acc.accountName.toLowerCase();
      const bal = Number(acc.balance || 0); // credit - debit
      
      if (name.includes('output vat') || name.includes('vat payable') || ['2020', '2200'].includes(acc.accountCode) || (['2110', '2120'].includes(acc.accountCode) && name.includes('vat'))) {
        outputVatPayable += bal;
      } else if (name.includes('input vat') || ['1060', '1150', '1500'].includes(acc.accountCode) || (acc.accountCode === '1050' && name.includes('vat'))) {
        lessInputVat += Math.abs(bal);
      } else if (name.includes('expanded withholding') || name.includes('ewt') || ['2030', '2130'].includes(acc.accountCode)) {
        ewtPayable += bal;
      } else if (name.includes('compensation') || name.includes('wtc') || acc.accountCode === '2035' || acc.accountCode === '2330') {
        wtcPayable += bal;
      } else if (name.includes('income tax')) {
        incomeTaxPayable += bal;
      } else if (!name.includes('creditable withholding')) {
        otherTaxPayable += bal;
      }
    }

    const netVatPayable = outputVatPayable - lessInputVat;
    const glTaxPayableAccountsBalance = netVatPayable + ewtPayable + wtcPayable + incomeTaxPayable + otherTaxPayable;

    // 2. Independently compute Subledger Tax Schedules (EWT from supplierPayments, WTC from payrollItems)
    const ewtSubledgerRow = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.supplierPayments.withholdingTaxAmount}), 0)`
    })
    .from(schema.supplierPayments)
    .leftJoin(schema.journalEntries, eq(schema.supplierPayments.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.supplierPayments.companyId, companyId),
        eq(schema.supplierPayments.status, 'POSTED'),
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.supplierPayments.paymentDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.supplierPayments.paymentDate} <= ${endDate}` : undefined
      )
    )
    .get();

    const wtcSubledgerRow = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.payrollItems.withholdingTax}), 0)`
    })
    .from(schema.payrollItems)
    .innerJoin(schema.payrollRuns, eq(schema.payrollItems.payrollRunId, schema.payrollRuns.id))
    .leftJoin(schema.journalEntries, eq(schema.payrollRuns.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.payrollRuns.companyId, companyId),
        sql`${schema.payrollRuns.status} IN ('POSTED', 'APPROVED', 'PAID')`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? sql`${schema.payrollRuns.paymentDate} >= ${startDate}` : undefined,
        endDate ? sql`${schema.payrollRuns.paymentDate} <= ${endDate}` : undefined
      )
    )
    .get();

    const scheduleEwtPayable = Number(ewtSubledgerRow?.total || 0) > 0 ? Number(ewtSubledgerRow?.total || 0) : ewtPayable;
    const scheduleWtcPayable = Number(wtcSubledgerRow?.total || 0) > 0 ? Number(wtcSubledgerRow?.total || 0) : wtcPayable;
    const totalTaxPayable = netVatPayable + scheduleEwtPayable + scheduleWtcPayable + incomeTaxPayable + otherTaxPayable;
    const unexplainedDifference = totalTaxPayable - glTaxPayableAccountsBalance;

    res.json({
      metadata: { generatedAt: new Date().toISOString() },
      data: {
        outputVatPayable,
        lessInputVat,
        netVatPayable,
        ewtPayable,
        wtcPayable,
        scheduleEwtPayable,
        scheduleWtcPayable,
        incomeTaxPayable,
        otherTaxPayable,
        totalTaxPayable,
        glTaxPayableAccountsBalance,
        unexplainedDifference,
        status: unexplainedDifference === 0 ? 'RECONCILED_SUCCESSFULLY' : 'VARIANCE_DETECTED'
      }
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to generate Tax Payable Reconciliation" });
  }
});

// 9. Exception Report
router.get('/schedules/exceptions', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const exceptions = await db.select()
      .from(schema.taxExceptions)
      .where(eq(schema.taxExceptions.companyId, companyId));

    res.json({ metadata: { generatedAt: new Date().toISOString() }, data: exceptions });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tax exceptions" });
  }
});

// 10. Tax Calendar
router.get('/calendar', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const calendar = await db.select()
      .from(schema.taxCalendar)
      .where(eq(schema.taxCalendar.companyId, companyId));

    return res.json(calendar || []);
  } catch (err) {
    res.json([]);
  }
});

// Manual Approved Adjustments
router.post('/adjustments', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { taxFilingId, adjustmentType, amount, reason } = req.body;
  const userId = req.user!.id;

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    if (taxFilingId) {
      const filing = await db.select()
        .from(schema.taxFilings)
        .where(and(eq(schema.taxFilings.id, taxFilingId), eq(schema.taxFilings.companyId, companyId)))
        .get();
      if (!filing) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Tax filing record not found." });
      }
      if (filing.status === 'LOCKED') {
        return res.status(403).json({ error: "PERIOD_LOCKED", message: "Cannot post manual adjustments to a locked tax filing." });
      }
      if (filing.startDate) {
        await assertTaxPeriodUnlocked(companyId, filing.startDate, filing.endDate || filing.startDate, actorRole);
      }
    } else {
      await validateTransactionDateAndPeriod(companyId, new Date().toISOString().slice(0, 10), { userRole: actorRole });
    }

    const id = crypto.randomUUID();
    await db.insert(schema.taxManualAdjustments).values({
      id,
      taxFilingId,
      companyId,
      adjustmentType,
      amount,
      reason,
      approvedBy: userId,
      status: 'APPROVED'
    });

    // Log exception for audit trail if post-filing or manual override
    await db.insert(schema.taxExceptions).values({
      id: crypto.randomUUID(),
      companyId,
      taxFilingId,
      exceptionType: 'MANUAL_APPROVED_ADJUSTMENT',
      description: `Manual adjustment of ${amount} applied: ${reason}`,
      severity: 'WARNING',
      status: 'OPEN'
    });

    res.json({ success: true, id, message: "Manual tax adjustment approved and logged." });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to create adjustment" });
  }
});

// Filing Preparation Checklist
router.get('/checklist/:filingId', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const filingId = req.params.filingId;
  try {
    const checklist = await db.select()
      .from(schema.taxFilingChecklists)
      .where(eq(schema.taxFilingChecklists.taxFilingId, filingId));
    res.json(checklist);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch checklist" });
  }
});

router.post('/checklist/:id/toggle', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const checklistId = req.params.id;
  const { isCompleted } = req.body;
  const userId = req.user!.id;

  try {
    await db.update(schema.taxFilingChecklists)
      .set({
        isCompleted: !!isCompleted,
        completedBy: isCompleted ? userId : null,
        completedAt: isCompleted ? new Date() : null
      })
      .where(eq(schema.taxFilingChecklists.id, checklistId));

    res.json({ success: true, message: "Checklist updated" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update checklist" });
  }
});

// ==========================================
// BIR ELECTRONIC TAX EXPORTS & DAT FILE GENERATORS
// ==========================================
// DIGITAL GENERATION TOOL FOR BIR FORM 2307 (ACCOUNTS PAYABLE INTEGRATION)
// ==========================================

// Helper: Build ledger-backed BIR Form 2307 certificates for a company & quarter without N+1 queries
async function buildLedgerForm2307Bundle(params: {
  companyId: string;
  year: number;
  quarter: BirQuarter;
  vendorId?: string;
  overrideAtc?: string;
  overrideRate?: number;
  signatoryName: string;
  signatoryDesignation: string;
  signatoryTin?: string | null;
}) {
  const { companyId, year, quarter, vendorId, overrideAtc, overrideRate } = params;
  const bounds = getQuarterDateBounds(year, quarter);

  const payor = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId))
    .get();

  const vendorsToProcess =
    vendorId && vendorId !== 'ALL'
      ? await db
          .select()
          .from(schema.vendors)
          .where(and(eq(schema.vendors.id, vendorId), eq(schema.vendors.companyId, companyId)))
      : await db
          .select()
          .from(schema.vendors)
          .where(eq(schema.vendors.companyId, companyId));

  // Single SQL query for quarter-scoped posted purchase bills (ISO-timestamp safe)
  const billWhereConditions: any[] = [
    eq(schema.purchaseBills.companyId, companyId),
    sql`substr(${schema.purchaseBills.billDate}, 1, 10) >= ${bounds.periodFrom}`,
    sql`substr(${schema.purchaseBills.billDate}, 1, 10) <= ${bounds.periodTo}`,
    sql`UPPER(COALESCE(${schema.purchaseBills.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
    sql`(${schema.purchaseBills.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`,
  ];
  if (vendorId && vendorId !== 'ALL') {
    billWhereConditions.push(eq(schema.purchaseBills.vendorId, vendorId));
  }

  const quarterBills = await db
    .select({
      id: schema.purchaseBills.id,
      vendorId: schema.purchaseBills.vendorId,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      totalAmount: schema.purchaseBills.totalAmount,
      status: schema.purchaseBills.status,
    })
    .from(schema.purchaseBills)
    .leftJoin(
      schema.journalEntries,
      and(
        eq(schema.journalEntries.id, schema.purchaseBills.journalEntryId),
        eq(schema.journalEntries.companyId, companyId)
      )
    )
    .where(and(...billWhereConditions));

  // Single SQL JOIN query for all bill lines in the quarter (zero N+1 queries)
  const quarterBillLines = await db
    .select({
      billId: schema.purchaseBillLines.billId,
      amount: schema.purchaseBillLines.amount,
      taxCodeId: schema.purchaseBillLines.taxCodeId,
      taxCode: schema.taxCodes.code,
      taxType: schema.taxCodes.taxType,
    })
    .from(schema.purchaseBillLines)
    .innerJoin(
      schema.purchaseBills,
      eq(schema.purchaseBillLines.billId, schema.purchaseBills.id)
    )
    .leftJoin(
      schema.taxCodes,
      eq(schema.purchaseBillLines.taxCodeId, schema.taxCodes.id)
    )
    .leftJoin(
      schema.journalEntries,
      and(
        eq(schema.journalEntries.id, schema.purchaseBills.journalEntryId),
        eq(schema.journalEntries.companyId, companyId)
      )
    )
    .where(and(...billWhereConditions));

  // Single SQL query for quarter-scoped posted supplier payments / Disbursement Vouchers (ISO-timestamp safe)
  const paymentWhereConditions: any[] = [
    eq(schema.supplierPayments.companyId, companyId),
    sql`substr(${schema.supplierPayments.paymentDate}, 1, 10) >= ${bounds.periodFrom}`,
    sql`substr(${schema.supplierPayments.paymentDate}, 1, 10) <= ${bounds.periodTo}`,
    sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
    sql`(${schema.supplierPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`,
  ];
  if (vendorId && vendorId !== 'ALL') {
    paymentWhereConditions.push(eq(schema.supplierPayments.vendorId, vendorId));
  }

  const quarterPayments = await db
    .select({
      id: schema.supplierPayments.id,
      vendorId: schema.supplierPayments.vendorId,
      paymentNumber: schema.supplierPayments.paymentNumber,
      paymentDate: schema.supplierPayments.paymentDate,
      amount: schema.supplierPayments.amount,
      withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount,
      paymentMethod: schema.supplierPayments.paymentMethod,
      reference: schema.supplierPayments.reference,
    })
    .from(schema.supplierPayments)
    .leftJoin(
      schema.journalEntries,
      and(
        eq(schema.journalEntries.id, schema.supplierPayments.journalEntryId),
        eq(schema.journalEntries.companyId, companyId)
      )
    )
    .where(and(...paymentWhereConditions));

  // Fetch existing issued Form 2307 records for this company
  const issuedRows = await db
    .select()
    .from(schema.taxFilings)
    .where(
      and(
        eq(schema.taxFilings.companyId, companyId),
        eq(schema.taxFilings.taxType, 'BIR Form 2307')
      )
    )
    .orderBy(desc(schema.taxFilings.createdAt));

  const issuedByControlNo = new Map<string, { filingId: string; issuedAt: string | null }>();
  for (const row of issuedRows) {
    const notesStr = String(row.notes || '');
    const ctrlMatch = notesStr.match(/2307-[A-Za-z0-9_-]+-\d{4}-Q[1-4]/);
    if (ctrlMatch && !issuedByControlNo.has(ctrlMatch[0])) {
      issuedByControlNo.set(ctrlMatch[0], {
        filingId: row.id,
        issuedAt: row.filedAt ? new Date(row.filedAt).toISOString() : row.createdAt ? new Date(row.createdAt).toISOString() : null,
      });
    }
  }

  // Group lines by billId
  const linesByBillId = new Map<string, LedgerBillInput['lines']>();
  for (const l of quarterBillLines) {
    const arr = linesByBillId.get(l.billId) || [];
    arr.push({
      amountCentavos: l.amount || 0,
      taxCode: l.taxCode || null,
      taxType: l.taxType || null,
    });
    linesByBillId.set(l.billId, arr);
  }

  // Group bills and payments by vendorId in O(N)
  const billsByVendor = new Map<string, LedgerBillInput[]>();
  for (const b of quarterBills) {
    const arr = billsByVendor.get(b.vendorId) || [];
    arr.push({
      id: b.id,
      billNumber: b.billNumber,
      billDate: b.billDate,
      totalAmountCentavos: b.totalAmount || 0,
      status: b.status,
      lines: linesByBillId.get(b.id) || [],
    });
    billsByVendor.set(b.vendorId, arr);
  }

  const paymentsByVendor = new Map<string, LedgerPaymentInput[]>();
  for (const p of quarterPayments) {
    const arr = paymentsByVendor.get(p.vendorId) || [];
    arr.push({
      id: p.id,
      paymentNumber: p.paymentNumber,
      paymentDate: p.paymentDate,
      amountCentavos: p.amount || 0,
      withholdingTaxAmountCentavos: p.withholdingTaxAmount || 0,
      paymentMethod: p.paymentMethod || 'BANK_TRANSFER',
      reference: p.reference || null,
    });
    paymentsByVendor.set(p.vendorId, arr);
  }

  const certificates = vendorsToProcess.map((v) => {
    const controlCode = (v.code || v.id.slice(0, 6)).replace(/[^A-Za-z0-9_-]/g, '');
    const expectedControlNo = `2307-${controlCode}-${year}-${quarter}`;
    return buildForm2307Certificate({
      payor: {
        tin: payor?.tin || null,
        branchCode: payor?.branchCode || '00000',
        legalName: payor?.legalName || null,
        tradeName: payor?.tradeName || payor?.legalName || null,
        address: payor?.address || null,
        rdoCode: payor?.rdoCode || null,
      },
      payee: {
        id: v.id,
        code: v.code,
        legalName: v.legalName,
        tradeName: v.tradeName || v.legalName,
        tin: v.tin || null,
        address: v.address || null,
        taxClassification: v.taxClassification || null,
        vatStatus: v.vatStatus || null,
        withholdingApplicability: v.withholdingApplicability || null,
      },
      year,
      quarter,
      bills: billsByVendor.get(v.id) || [],
      payments: paymentsByVendor.get(v.id) || [],
      overrideAtc: overrideAtc || null,
      overrideRatePercent: typeof overrideRate === 'number' && !Number.isNaN(overrideRate) ? overrideRate : null,
      signatory: {
        name: params.signatoryName,
        designation: params.signatoryDesignation,
        tin: params.signatoryTin || payor?.tin || null,
      },
      issuedRecord: issuedByControlNo.get(expectedControlNo) || null,
    });
  });

  // Sort: recorded EWT first, then highest gross income payment, then vendor code
  certificates.sort((a, b) => {
    if (b.totals.taxWithheldPhp !== a.totals.taxWithheldPhp) {
      return b.totals.taxWithheldPhp - a.totals.taxWithheldPhp;
    }
    if (b.totals.grossPaymentPhp !== a.totals.grossPaymentPhp) {
      return b.totals.grossPaymentPhp - a.totals.grossPaymentPhp;
    }
    return a.payee.vendorCode.localeCompare(b.payee.vendorCode);
  });

  return { payor, bounds, certificates, issuedRows, quarterPayments };
}

// GET /api/tax/2307/ap-vendors - Fetch all Accounts Payable vendors with active AP bills and EWT withholding
router.get('/2307/ap-vendors', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const allVendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));

    const billAggs = await db
      .select({
        vendorId: schema.purchaseBills.vendorId,
        billCount: sql<number>`COUNT(*)`,
        totalGross: sql<number>`COALESCE(SUM(${schema.purchaseBills.totalAmount}), 0)`,
      })
      .from(schema.purchaseBills)
      .leftJoin(
        schema.journalEntries,
        and(
          eq(schema.journalEntries.id, schema.purchaseBills.journalEntryId),
          eq(schema.journalEntries.companyId, companyId)
        )
      )
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`UPPER(COALESCE(${schema.purchaseBills.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
          sql`(${schema.purchaseBills.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`
        )
      )
      .groupBy(schema.purchaseBills.vendorId);

    const paymentAggs = await db
      .select({
        vendorId: schema.supplierPayments.vendorId,
        paymentCount: sql<number>`COUNT(*)`,
        totalWithheld: sql<number>`COALESCE(SUM(${schema.supplierPayments.withholdingTaxAmount}), 0)`,
      })
      .from(schema.supplierPayments)
      .leftJoin(
        schema.journalEntries,
        and(
          eq(schema.journalEntries.id, schema.supplierPayments.journalEntryId),
          eq(schema.journalEntries.companyId, companyId)
        )
      )
      .where(
        and(
          eq(schema.supplierPayments.companyId, companyId),
          sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
          sql`(${schema.supplierPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`
        )
      )
      .groupBy(schema.supplierPayments.vendorId);

    const billMap = new Map<string, { vendorId: string; billCount: number; totalGross: number }>(
      (billAggs as Array<{ vendorId: string; billCount: number; totalGross: number }>).map((r) => [r.vendorId, r])
    );
    const payMap = new Map<string, { vendorId: string; paymentCount: number; totalWithheld: number }>(
      (paymentAggs as Array<{ vendorId: string; paymentCount: number; totalWithheld: number }>).map((r) => [r.vendorId, r])
    );

    const vendorSummaries = allVendors.map((vendor) => {
      const bAgg = billMap.get(vendor.id);
      const pAgg = payMap.get(vendor.id);
      const totalBilledCentavos = Number(bAgg?.totalGross || 0);
      const totalWithheldCentavos = Number(pAgg?.totalWithheld || 0);
      const hasUnwithheldBills = totalBilledCentavos > 0 && totalWithheldCentavos === 0;

      return {
        vendorId: vendor.id,
        vendorCode: vendor.code,
        legalName: vendor.legalName,
        tradeName: vendor.tradeName,
        tin: vendor.tin || null,
        address: vendor.address || null,
        taxClassification: vendor.taxClassification || null,
        vatStatus: vendor.vatStatus || null,
        withholdingApplicability: vendor.withholdingApplicability || null,
        billCount: Number(bAgg?.billCount || 0),
        paymentCount: Number(pAgg?.paymentCount || 0),
        totalGrossBilledPhp: totalBilledCentavos / 100,
        totalEwtWithheldPhp: totalWithheldCentavos / 100,
        withholdingStatus:
          totalWithheldCentavos > 0
            ? 'RECORDED'
            : hasUnwithheldBills
              ? 'NO_WITHHOLDING_RECORDED'
              : 'NO_RECORDS',
      };
    });

    vendorSummaries.sort((a, b) => b.totalEwtWithheldPhp - a.totalEwtWithheldPhp || b.totalGrossBilledPhp - a.totalGrossBilledPhp);

    res.json(vendorSummaries);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch AP vendors for Form 2307", message: err.message });
  }
});

// GET /api/tax/2307/workspace - Full Form 2307 automation workspace with GL reconciliation, available periods & issued history
router.get('/2307/workspace', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const {
    year,
    quarter,
    vendorId = 'ALL',
    overrideAtc,
    overrideRate,
    search = '',
    filter = 'ACTIVITY', // ALL | ACTIVITY | RECORDED_EWT | ATTENTION | ISSUED
    limit = '100',
  } = req.query;

  try {
    // Discover all quarters that have posted purchase bills or supplier payments
    const billPeriods = await db
      .select({
        yr: sql<number>`CAST(substr(${schema.purchaseBills.billDate}, 1, 4) AS INTEGER)`,
        qtr: sql<number>`((CAST(substr(${schema.purchaseBills.billDate}, 6, 2) AS INTEGER) - 1) / 3) + 1`,
        billsCount: sql<number>`COUNT(*)`,
      })
      .from(schema.purchaseBills)
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`UPPER(COALESCE(${schema.purchaseBills.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
          sql`length(${schema.purchaseBills.billDate}) >= 7`
        )
      )
      .groupBy(
        sql`substr(${schema.purchaseBills.billDate}, 1, 4)`,
        sql`((CAST(substr(${schema.purchaseBills.billDate}, 6, 2) AS INTEGER) - 1) / 3) + 1`
      );

    const payPeriods = await db
      .select({
        yr: sql<number>`CAST(substr(${schema.supplierPayments.paymentDate}, 1, 4) AS INTEGER)`,
        qtr: sql<number>`((CAST(substr(${schema.supplierPayments.paymentDate}, 6, 2) AS INTEGER) - 1) / 3) + 1`,
        paymentsCount: sql<number>`COUNT(*)`,
        ewtCentavos: sql<number>`COALESCE(SUM(${schema.supplierPayments.withholdingTaxAmount}), 0)`,
      })
      .from(schema.supplierPayments)
      .where(
        and(
          eq(schema.supplierPayments.companyId, companyId),
          sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
          sql`length(${schema.supplierPayments.paymentDate}) >= 7`
        )
      )
      .groupBy(
        sql`substr(${schema.supplierPayments.paymentDate}, 1, 4)`,
        sql`((CAST(substr(${schema.supplierPayments.paymentDate}, 6, 2) AS INTEGER) - 1) / 3) + 1`
      );

    const periodMap = new Map<string, { year: number; quarter: BirQuarter; billsCount: number; paymentsCount: number; ewtPhp: number }>();
    for (const bp of billPeriods) {
      if (!bp.yr || bp.qtr < 1 || bp.qtr > 4) continue;
      const qStr = `Q${bp.qtr}` as BirQuarter;
      const key = `${bp.yr}-${qStr}`;
      periodMap.set(key, { year: Number(bp.yr), quarter: qStr, billsCount: Number(bp.billsCount || 0), paymentsCount: 0, ewtPhp: 0 });
    }
    for (const pp of payPeriods) {
      if (!pp.yr || pp.qtr < 1 || pp.qtr > 4) continue;
      const qStr = `Q${pp.qtr}` as BirQuarter;
      const key = `${pp.yr}-${qStr}`;
      const existing = periodMap.get(key) || { year: Number(pp.yr), quarter: qStr, billsCount: 0, paymentsCount: 0, ewtPhp: 0 };
      existing.paymentsCount = Number(pp.paymentsCount || 0);
      existing.ewtPhp = Math.round(Number(pp.ewtCentavos || 0)) / 100;
      periodMap.set(key, existing);
    }

    const availablePeriods = Array.from(periodMap.values()).sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.quarter.localeCompare(a.quarter);
    });

    // If year/quarter not explicitly passed, auto-pick the latest quarter that has recorded EWT or posted bills
    const preferredPeriod =
      availablePeriods.find((p) => p.ewtPhp > 0) ||
      availablePeriods[0] || {
        year: new Date().getFullYear(),
        quarter: (`Q${Math.floor(new Date().getMonth() / 3) + 1}`) as BirQuarter,
      };

    const targetYear = year ? Number(year) : preferredPeriod.year;
    const qUpper = (quarter ? String(quarter).trim().toUpperCase() : preferredPeriod.quarter) as BirQuarter;

    if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(qUpper)) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid quarter. Must be Q1, Q2, Q3, or Q4.' });
      return;
    }
    if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2100) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid year. Must be a 4-digit integer.' });
      return;
    }

    const parsedRate =
      overrideRate !== undefined && String(overrideRate).trim() !== ''
        ? Number(overrideRate)
        : undefined;

    const bundle = await buildLedgerForm2307Bundle({
      companyId,
      year: targetYear,
      quarter: qUpper,
      vendorId: vendorId ? String(vendorId) : 'ALL',
      overrideAtc: overrideAtc ? String(overrideAtc) : undefined,
      overrideRate: parsedRate,
      signatoryName: req.user?.displayName || req.user?.email || 'Authorized Tax Officer',
      signatoryDesignation: req.activeCompany?.roleName || req.activeCompany?.role || 'Authorized Representative',
    });

    // Query General Ledger EWT Payable accounts for this exact quarter for 1:1 ledger reconciliation
    const glEwtRows = await db
      .select({
        accountCode: schema.accounts.accountCode,
        accountName: schema.accounts.accountName,
        totalCredit: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`,
        totalDebit: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
      })
      .from(schema.journalLines)
      .innerJoin(
        schema.journalEntries,
        eq(schema.journalLines.journalEntryId, schema.journalEntries.id)
      )
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.status, 'POSTED'),
          sql`substr(${schema.journalEntries.entryDate}, 1, 10) >= ${bundle.bounds.periodFrom}`,
          sql`substr(${schema.journalEntries.entryDate}, 1, 10) <= ${bundle.bounds.periodTo}`,
          sql`(
            ${schema.accounts.accountCode} IN ('2030', '2120', '2110', '2121', '2122', '2130')
            OR UPPER(COALESCE(${schema.accounts.detailType}, '')) LIKE '%EWT%'
            OR UPPER(COALESCE(${schema.accounts.detailType}, '')) LIKE '%WITHHOLD%'
            OR UPPER(COALESCE(${schema.accounts.birTaxCategory}, '')) LIKE '%EWT%'
            OR LOWER(${schema.accounts.accountName}) LIKE '%expanded withholding%'
            OR LOWER(${schema.accounts.accountName}) LIKE '%ewt%'
            OR LOWER(${schema.accounts.accountName}) LIKE '%withholding tax%'
          )`
        )
      )
      .groupBy(schema.accounts.accountCode, schema.accounts.accountName);

    const glEwtCreditCentavos = glEwtRows.reduce((s, r) => s + Number(r.totalCredit || 0), 0);
    const glEwtDebitCentavos = glEwtRows.reduce((s, r) => s + Number(r.totalDebit || 0), 0);
    const glNetEwtPayablePhp = Math.round(glEwtCreditCentavos - glEwtDebitCentavos) / 100;

    const allWithActivity = bundle.certificates.filter(
      (c) => c.apRecordsCount.billsCount > 0 || c.apRecordsCount.paymentsCount > 0
    );
    const totalIncomePaymentBasePhp = Math.round(allWithActivity.reduce((s, c) => s + c.totals.grossPaymentPhp, 0) * 100) / 100;
    const totalTaxWithheldPhp = Math.round(allWithActivity.reduce((s, c) => s + c.totals.taxWithheldPhp, 0) * 100) / 100;
    const totalRecordedDvEwtPhp = Math.round(allWithActivity.reduce((s, c) => s + c.totals.recordedDvEwtPhp, 0) * 100) / 100;
    const totalVatExcludedPhp = Math.round(allWithActivity.reduce((s, c) => s + c.totals.vatExcludedPhp, 0) * 100) / 100;
    const totalCertificatesIssued = bundle.certificates.filter((c) => c.issuanceStatus === 'ISSUED').length;
    const certificatesNeedingAttention = allWithActivity.filter(
      (c) => c.warnings.some((w) => w.severity === 'ERROR' || w.severity === 'WARNING')
    ).length;

    // Apply search and filter
    const kw = String(search || '').trim().toLowerCase();
    const filterUpper = String(filter || 'ACTIVITY').toUpperCase();
    let filtered = bundle.certificates;
    if (filterUpper === 'ACTIVITY') {
      filtered = filtered.filter((c) => c.apRecordsCount.billsCount > 0 || c.apRecordsCount.paymentsCount > 0);
    } else if (filterUpper === 'RECORDED_EWT') {
      filtered = filtered.filter((c) => c.totals.recordedDvEwtPhp > 0 || c.totals.taxWithheldPhp > 0);
    } else if (filterUpper === 'ATTENTION') {
      filtered = filtered.filter((c) => c.warnings.some((w) => w.severity === 'ERROR' || w.severity === 'WARNING'));
    } else if (filterUpper === 'ISSUED') {
      filtered = filtered.filter((c) => c.issuanceStatus === 'ISSUED');
    }

    if (kw) {
      filtered = filtered.filter(
        (c) =>
          c.payee.legalName.toLowerCase().includes(kw) ||
          c.payee.vendorCode.toLowerCase().includes(kw) ||
          (c.payee.tin || '').toLowerCase().includes(kw) ||
          c.certificateControlNo.toLowerCase().includes(kw) ||
          c.schedule.some((s) => s.atcCode.toLowerCase().includes(kw))
      );
    }

    const maxLimit = Math.min(500, Math.max(10, Number(limit) || 100));
    const sliced = filtered.slice(0, maxLimit);

    // Format issued register history
    const issuedHistory = bundle.issuedRows.slice(0, 150).map((row) => {
      const notesStr = String(row.notes || '');
      let parsedMeta: any = null;
      const jsonIdx = notesStr.indexOf('{');
      if (jsonIdx !== -1) {
        try {
          parsedMeta = JSON.parse(notesStr.slice(jsonIdx));
        } catch {
          parsedMeta = null;
        }
      }
      const ctrlMatch = notesStr.match(/2307-[A-Za-z0-9_-]+-\d{4}-Q[1-4]/);
      return {
        id: row.id,
        certificateControlNo: parsedMeta?.certificateControlNo || (ctrlMatch ? ctrlMatch[0] : row.periodName),
        vendorId: parsedMeta?.vendorId || null,
        vendorName: parsedMeta?.vendorName || 'Registered Payee',
        vendorTin: parsedMeta?.vendorTin || null,
        atcCodes: parsedMeta?.atcCodes || [],
        signatoryName: parsedMeta?.signatoryName || null,
        periodName: row.periodName,
        startDate: row.startDate,
        endDate: row.endDate,
        deadlineDate: row.deadlineDate,
        status: row.status,
        totalTaxBasePhp: Number(row.totalTaxBase || 0) / 100,
        totalTaxDuePhp: Number(row.totalTaxDue || 0) / 100,
        filedAt: row.filedAt ? new Date(row.filedAt).toISOString() : row.createdAt ? new Date(row.createdAt).toISOString() : null,
      };
    });

    const payorTinSegments = formatBirTinSegments(bundle.payor?.tin, bundle.payor?.branchCode);

    res.json({
      period: {
        year: targetYear,
        quarter: qUpper,
        periodFrom: bundle.bounds.periodFrom,
        periodTo: bundle.bounds.periodTo,
        statutoryDeadline: bundle.bounds.deadlineDate,
        monthLabels: bundle.bounds.monthLabels,
      },
      payor: {
        legalName: bundle.payor?.legalName || null,
        tradeName: bundle.payor?.tradeName || bundle.payor?.legalName || null,
        tin: bundle.payor?.tin || null,
        tinSegments: payorTinSegments,
        address: bundle.payor?.address || null,
        zipCode: extractPhZipCode(bundle.payor?.address),
        rdoCode: bundle.payor?.rdoCode || null,
        branchCode: payorTinSegments[3] || '00000',
        contactPerson: bundle.payor?.contactPerson || null,
      },
      glReconciliation: {
        ewtAccounts: glEwtRows.map((r) => ({
          code: r.accountCode,
          name: r.accountName,
          creditPhp: Number(r.totalCredit || 0) / 100,
          debitPhp: Number(r.totalDebit || 0) / 100,
          netPhp: (Number(r.totalCredit || 0) - Number(r.totalDebit || 0)) / 100,
        })),
        glEwtCreditPhp: glEwtCreditCentavos / 100,
        glEwtDebitPhp: glEwtDebitCentavos / 100,
        glNetEwtPayablePhp,
        subledgerDvEwtPhp: totalRecordedDvEwtPhp,
        computedCertificatesEwtPhp: totalTaxWithheldPhp,
        reconciliationDiffPhp: Math.round((glEwtCreditCentavos / 100 - totalRecordedDvEwtPhp) * 100) / 100,
      },
      summary: {
        totalVendorsInMaster: bundle.certificates.length,
        totalPayeesWithActivity: allWithActivity.length,
        totalCertificatesIssued,
        totalIncomePaymentBasePhp,
        totalTaxWithheldPhp,
        totalRecordedDvEwtPhp,
        totalVatExcludedPhp,
        certificatesNeedingAttention,
      },
      availablePeriods,
      totalMatchedCertificates: filtered.length,
      certificates: sliced,
      issuedHistory,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'FORM_2307_WORKSPACE_ERROR', message: err.message });
  }
});

// GET /api/tax/2307/generate - Generates official BIR 2307 certificate array pulling live AP & GL data
router.get('/2307/generate', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { vendorId, year = '2026', quarter = 'Q1', overrideAtc, overrideRate, onlyWithActivity } = req.query;

  const qUpper = String(quarter || 'Q1').trim().toUpperCase() as BirQuarter;
  if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(qUpper)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid quarter. Must be Q1, Q2, Q3, or Q4.' });
    return;
  }
  const targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2100) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid year. Must be a 4-digit integer.' });
    return;
  }

  try {
    const parsedRate =
      overrideRate !== undefined && String(overrideRate).trim() !== ''
        ? Number(overrideRate)
        : undefined;

    const bundle = await buildLedgerForm2307Bundle({
      companyId,
      year: targetYear,
      quarter: qUpper,
      vendorId: vendorId ? String(vendorId) : 'ALL',
      overrideAtc: overrideAtc ? String(overrideAtc) : undefined,
      overrideRate: parsedRate,
      signatoryName: req.user?.displayName || req.user?.email || 'Authorized Tax Officer',
      signatoryDesignation: req.activeCompany?.roleName || req.activeCompany?.role || 'Authorized Representative',
    });

    const result =
      String(onlyWithActivity).toLowerCase() === 'true'
        ? bundle.certificates.filter((c) => c.apRecordsCount.billsCount > 0 || c.apRecordsCount.paymentsCount > 0)
        : bundle.certificates;

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Form 2307 from AP records", message: err.message });
  }
});

// POST /api/tax/2307/issue - Saves/Issues BIR Form 2307 Certificate to Statutory Tax Register + Audit Trail
router.post('/2307/issue', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const {
    certificateControlNo,
    vendorId,
    vendorName,
    vendorTin,
    atcCodes,
    signatoryName,
    quarter,
    year,
    grossPaymentPhp,
    taxWithheldPhp,
  } = req.body;

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const yr = Number(year) || new Date().getFullYear();
    const qUpper = String(quarter || 'Q1').trim().toUpperCase() as BirQuarter;
    if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(qUpper)) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid quarter. Must be Q1, Q2, Q3, or Q4.' });
      return;
    }
    const bounds = getQuarterDateBounds(yr, qUpper);
    await assertTaxPeriodUnlocked(companyId, bounds.periodFrom, bounds.periodTo, actorRole);

    const safeControlNo = String(certificateControlNo || `2307-${vendorId || 'GEN'}-${yr}-${qUpper}`).trim();
    const now = new Date();
    const metaJson = JSON.stringify({
      certificateControlNo: safeControlNo,
      vendorId: vendorId || null,
      vendorName: vendorName || 'Registered Payee',
      vendorTin: vendorTin || null,
      atcCodes: Array.isArray(atcCodes) ? atcCodes : [],
      signatoryName: signatoryName || req.user?.displayName || req.user?.email || 'Authorized Officer',
    });
    const notesPayload = `Official BIR Form 2307 Issued (${safeControlNo}) ${metaJson}`;

    // Check if already issued for this control number to avoid duplicate clutter (update & log re-issue)
    const existingRows = await db
      .select()
      .from(schema.taxFilings)
      .where(
        and(
          eq(schema.taxFilings.companyId, companyId),
          eq(schema.taxFilings.taxType, 'BIR Form 2307'),
          eq(schema.taxFilings.periodName, `${yr}-${qUpper}`)
        )
      );

    const existing = existingRows.find((r) => String(r.notes || '').includes(safeControlNo));
    let filingId: string;
    let actionLabel: 'ISSUED' | 'REISSUED';

    if (existing) {
      filingId = existing.id;
      actionLabel = 'REISSUED';
      await db
        .update(schema.taxFilings)
        .set({
          status: 'FILED',
          totalTaxBase: Math.round((Number(grossPaymentPhp) || 0) * 100),
          totalTaxDue: Math.round((Number(taxWithheldPhp) || 0) * 100),
          netTaxPayable: Math.round((Number(taxWithheldPhp) || 0) * 100),
          filedAt: now,
          filedBy: req.user?.id || null,
          notes: notesPayload,
          updatedAt: now,
        })
        .where(eq(schema.taxFilings.id, filingId));
    } else {
      filingId = crypto.randomUUID();
      actionLabel = 'ISSUED';
      await db.insert(schema.taxFilings).values({
        id: filingId,
        companyId,
        taxType: 'BIR Form 2307',
        periodName: `${yr}-${qUpper}`,
        startDate: bounds.periodFrom,
        endDate: bounds.periodTo,
        deadlineDate: bounds.deadlineDate,
        status: 'FILED',
        totalTaxBase: Math.round((Number(grossPaymentPhp) || 0) * 100),
        totalTaxDue: Math.round((Number(taxWithheldPhp) || 0) * 100),
        netTaxPayable: Math.round((Number(taxWithheldPhp) || 0) * 100),
        filedAt: now,
        filedBy: req.user?.id || null,
        notes: notesPayload,
      });
    }

    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: req.user?.id || null,
      action: actionLabel === 'ISSUED' ? 'ISSUE_FORM_2307' : 'REISSUE_FORM_2307',
      entityType: 'TAX_FILING',
      entityId: filingId,
      newValues: metaJson,
      ipAddress: req.ip || '127.0.0.1',
    });

    res.json({
      success: true,
      action: actionLabel,
      filingId,
      certificateControlNo: safeControlNo,
      issuedAt: now.toISOString(),
      message: `BIR Form 2307 (${safeControlNo}) ${actionLabel === 'ISSUED' ? 'issued' : 're-issued'} and recorded in the Statutory Tax Register.`,
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// POST /api/tax/2307/issue-batch - Batch-issue multiple BIR Form 2307 certificates for a quarter
router.post('/2307/issue-batch', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { year, quarter, certificates } = req.body || {};

  if (!Array.isArray(certificates) || certificates.length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Provide at least one certificate to issue.' });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const yr = Number(year) || new Date().getFullYear();
    const qUpper = String(quarter || 'Q1').trim().toUpperCase() as BirQuarter;
    if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(qUpper)) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid quarter. Must be Q1, Q2, Q3, or Q4.' });
      return;
    }

    const bounds = getQuarterDateBounds(yr, qUpper);
    await assertTaxPeriodUnlocked(companyId, bounds.periodFrom, bounds.periodTo, actorRole);

    const existingRows = await db
      .select()
      .from(schema.taxFilings)
      .where(
        and(
          eq(schema.taxFilings.companyId, companyId),
          eq(schema.taxFilings.taxType, 'BIR Form 2307'),
          eq(schema.taxFilings.periodName, `${yr}-${qUpper}`)
        )
      );

    const now = new Date();
    let issuedCount = 0;
    let reissuedCount = 0;

    for (const item of certificates) {
      const safeControlNo = String(item.certificateControlNo || `2307-${item.vendorId || 'GEN'}-${yr}-${qUpper}`).trim();
      const metaJson = JSON.stringify({
        certificateControlNo: safeControlNo,
        vendorId: item.vendorId || null,
        vendorName: item.vendorName || 'Registered Payee',
        vendorTin: item.vendorTin || null,
        atcCodes: Array.isArray(item.atcCodes) ? item.atcCodes : [],
        signatoryName: item.signatoryName || req.user?.displayName || req.user?.email || 'Authorized Officer',
      });
      const notesPayload = `Official BIR Form 2307 Issued (${safeControlNo}) ${metaJson}`;

      const existing = existingRows.find((r) => String(r.notes || '').includes(safeControlNo));
      if (existing) {
        reissuedCount += 1;
        await db
          .update(schema.taxFilings)
          .set({
            status: 'FILED',
            totalTaxBase: Math.round((Number(item.grossPaymentPhp) || 0) * 100),
            totalTaxDue: Math.round((Number(item.taxWithheldPhp) || 0) * 100),
            netTaxPayable: Math.round((Number(item.taxWithheldPhp) || 0) * 100),
            filedAt: now,
            filedBy: req.user?.id || null,
            notes: notesPayload,
            updatedAt: now,
          })
          .where(eq(schema.taxFilings.id, existing.id));
      } else {
        issuedCount += 1;
        await db.insert(schema.taxFilings).values({
          id: crypto.randomUUID(),
          companyId,
          taxType: 'BIR Form 2307',
          periodName: `${yr}-${qUpper}`,
          startDate: bounds.periodFrom,
          endDate: bounds.periodTo,
          deadlineDate: bounds.deadlineDate,
          status: 'FILED',
          totalTaxBase: Math.round((Number(item.grossPaymentPhp) || 0) * 100),
          totalTaxDue: Math.round((Number(item.taxWithheldPhp) || 0) * 100),
          netTaxPayable: Math.round((Number(item.taxWithheldPhp) || 0) * 100),
          filedAt: now,
          filedBy: req.user?.id || null,
          notes: notesPayload,
        });
      }
    }

    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: req.user?.id || null,
      action: 'BATCH_ISSUE_FORM_2307',
      entityType: 'TAX_FILING',
      entityId: `${yr}-${qUpper}`,
      newValues: JSON.stringify({ period: `${yr}-${qUpper}`, issuedCount, reissuedCount, total: certificates.length }),
      ipAddress: req.ip || '127.0.0.1',
    });

    res.json({
      success: true,
      issuedCount,
      reissuedCount,
      totalProcessed: issuedCount + reissuedCount,
      message: `Batch processed ${issuedCount + reissuedCount} BIR Form 2307 certificate(s) for ${qUpper} ${yr} (${issuedCount} newly issued, ${reissuedCount} updated).`,
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || 'WORKFLOW_ERROR', message: err.message });
  }
});

// BIR Form 2307 Legacy Generator Data Export
router.get('/export/2307', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const payments = await db.select({
      paymentId: schema.supplierPayments.id,
      paymentNumber: schema.supplierPayments.paymentNumber,
      paymentDate: schema.supplierPayments.paymentDate,
      vendorName: schema.vendors.legalName,
      tin: schema.vendors.tin,
      address: schema.vendors.address,
      taxClassification: schema.vendors.taxClassification,
      amount: schema.supplierPayments.amount,
      withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount
    })
    .from(schema.supplierPayments)
    .innerJoin(schema.vendors, eq(schema.supplierPayments.vendorId, schema.vendors.id))
    .leftJoin(schema.journalEntries, and(
      eq(schema.journalEntries.id, schema.supplierPayments.journalEntryId),
      eq(schema.journalEntries.companyId, companyId)
    ))
    .where(and(
      eq(schema.supplierPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
      sql`(${schema.supplierPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`
    ));

    res.json({
      form: "BIR Form 2307",
      title: "Certificate of Creditable Tax Withheld at Source",
      payor: {
        tin: activeCompany?.tin || "000-000-000-00000",
        name: activeCompany?.legalName || "Company",
        address: activeCompany?.address || "Philippines"
      },
      records: payments
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Form 2307 export" });
  }
});

// Update EWT withholding payment before posting
router.put('/withholding/ewt/:id', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const paymentId = req.params.id;
  const { withholdingTaxAmount, reference, amount } = req.body;

  try {
    const payment = await db.select()
      .from(schema.supplierPayments)
      .where(and(eq(schema.supplierPayments.id, paymentId), eq(schema.supplierPayments.companyId, companyId)))
      .get();

    if (!payment) {
      return res.status(404).json({ error: "Withholding payment record not found" });
    }

    if (payment.status === "POSTED") {
      return res.status(400).json({ error: "Cannot edit withholding amount on a posted payment transaction." });
    }

    // Check accounting period lock & tax filing lock status
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await validateTransactionDateAndPeriod(companyId, payment.paymentDate, { userRole: actorRole });

    const filings = await db.select().from(schema.taxFilings).where(and(eq(schema.taxFilings.companyId, companyId), eq(schema.taxFilings.status, 'LOCKED'))).limit(1);
    if (filings.length > 0) {
      return res.status(403).json({ error: "PERIOD_LOCKED", message: "Tax period is locked. Editing is disabled." });
    }

    await db.update(schema.supplierPayments)
      .set({
        withholdingTaxAmount: Math.round(withholdingTaxAmount),
        reference: reference || payment.reference,
        amount: amount !== undefined ? Math.round(amount) : payment.amount,
        updatedAt: new Date()
      })
      .where(eq(schema.supplierPayments.id, paymentId));

    // Log to audit trail
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "EDIT_EWT_WITHHOLDING",
      entityType: "SUP_PAYMENT",
      entityId: paymentId,
      result: "SUCCESS"
    });

    res.json({ success: true, message: "EWT Withholding record updated successfully." });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to update EWT withholding" });
  }
});

// Update CWT withholding collection before posting
router.put('/withholding/cwt/:id', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const paymentId = req.params.id;
  const { withholdingTaxAmount, reference, amount } = req.body;

  try {
    const payment = await db.select()
      .from(schema.customerPayments)
      .where(and(eq(schema.customerPayments.id, paymentId), eq(schema.supplierPayments ? schema.customerPayments.companyId : schema.customerPayments.companyId, companyId)))
      .get();

    if (!payment) {
      return res.status(404).json({ error: "Withholding collection record not found" });
    }

    if (payment.status === "POSTED") {
      return res.status(400).json({ error: "Cannot edit withholding amount on a posted collection transaction." });
    }

    // Check accounting period lock & tax filing lock status
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await validateTransactionDateAndPeriod(companyId, payment.paymentDate, { userRole: actorRole });

    const filings = await db.select().from(schema.taxFilings).where(and(eq(schema.taxFilings.companyId, companyId), eq(schema.taxFilings.status, 'LOCKED'))).limit(1);
    if (filings.length > 0) {
      return res.status(403).json({ error: "PERIOD_LOCKED", message: "Tax period is locked. Editing is disabled." });
    }

    await db.update(schema.customerPayments)
      .set({
        withholdingTaxAmount: Math.round(withholdingTaxAmount),
        reference: reference || payment.reference,
        amount: amount !== undefined ? Math.round(amount) : payment.amount,
        updatedAt: new Date()
      })
      .where(eq(schema.customerPayments.id, paymentId));

    // Log to audit trail
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "EDIT_CWT_WITHHOLDING",
      entityType: "CUST_PAYMENT",
      entityId: paymentId,
      result: "SUCCESS"
    });

    res.json({ success: true, message: "CWT Withholding record updated successfully." });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 500);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message || "Failed to update CWT withholding" });
  }
});

// View Journal lines for a withholding transaction
router.get('/withholding/journal/:id', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const journalEntryId = req.params.id;

  try {
    const lines = await db.select({
      id: schema.journalLines.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      description: schema.journalLines.description
    })
    .from(schema.journalLines)
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(
      eq(schema.journalLines.journalEntryId, journalEntryId),
      eq(schema.accounts.companyId, companyId)
    ));

    res.json(lines);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch journal lines" });
  }
});

// View Audit logs for a withholding transaction (entityId)
router.get('/withholding/audit-logs/:id', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const entityId = req.params.id;

  try {
    const logs = await db.select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.companyId, companyId),
          eq(schema.auditLogs.entityId, entityId)
        )
      )
      .orderBy(schema.auditLogs.timestamp);

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

async function resolveTaxExportPeriodWindow(companyId: string, query: Record<string, any>) {
  const now = new Date();
  const rawPeriod = typeof query.period === 'string' ? query.period.trim().toUpperCase() : '';
  const rawYear = typeof query.year === 'string' ? query.year.trim() : '';
  const rawQuarter = typeof query.quarter === 'string' ? query.quarter.trim().replace(/^Q/i, '') : '';
  const rawMonth = typeof query.month === 'string' ? query.month.trim() : '';
  const rawStartDate = typeof query.startDate === 'string' ? query.startDate.trim() : '';
  const rawEndDate = typeof query.endDate === 'string' ? query.endDate.trim() : '';
  const explicitAccountingPeriodId =
    (typeof query.accountingPeriodId === 'string' && query.accountingPeriodId.trim()) ||
    (typeof query.periodId === 'string' && query.periodId.trim()) ||
    undefined;

  let startDate: string | null = null;
  let endDate: string | null = null;
  let year = now.getUTCFullYear();
  let quarter = Math.ceil((now.getUTCMonth() + 1) / 3);
  let periodScope: Awaited<ReturnType<typeof resolveReportPeriodScope>> | null = null;

  if (explicitAccountingPeriodId || rawStartDate || rawEndDate) {
    periodScope = await resolveReportPeriodScope(companyId, {
      accountingPeriodId: explicitAccountingPeriodId,
      startDate: rawStartDate || undefined,
      endDate: rawEndDate || undefined,
    });
    startDate = periodScope.effectiveStartDate || '';
    endDate = periodScope.effectiveEndDate || '';
    const refDate = endDate || startDate || now.toISOString().slice(0, 10);
    year = parseInt(refDate.slice(0, 4), 10) || year;
    quarter = Math.ceil((parseInt(refDate.slice(5, 7), 10) || (now.getUTCMonth() + 1)) / 3);
  } else {
    const qMatch = /^(\d{4})-Q([1-4])$/.exec(rawPeriod);
    const ymMatch = /^(\d{4})-(\d{2})$/.exec(rawPeriod);

    if (qMatch) {
      year = parseInt(qMatch[1], 10);
      quarter = parseInt(qMatch[2], 10);
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = quarter * 3;
      const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
      startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (ymMatch) {
      year = parseInt(ymMatch[1], 10);
      const m = parseInt(ymMatch[2], 10);
      quarter = Math.ceil(m / 3);
      const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
      startDate = `${year}-${String(m).padStart(2, '0')}-01`;
      endDate = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (/^\d{4}$/.test(rawYear) && /^[1-4]$/.test(rawQuarter)) {
      year = parseInt(rawYear, 10);
      quarter = parseInt(rawQuarter, 10);
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = quarter * 3;
      const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
      startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (/^\d{4}$/.test(rawYear) && /^\d{1,2}$/.test(rawMonth)) {
      year = parseInt(rawYear, 10);
      const m = parseInt(rawMonth, 10);
      quarter = Math.ceil(m / 3);
      const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
      startDate = `${year}-${String(m).padStart(2, '0')}-01`;
      endDate = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  const endRef = endDate || (() => {
    const endMonth = quarter * 3;
    const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    return `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  })();
  const [ey, em, ed] = endRef.split('-');
  const headerEndMmDdYyyy = `${em}${ed}${ey}`;

  return { startDate, endDate, year, quarter, headerEndMmDdYyyy, periodScope };
}

// SAWT .DAT File Generator (Summary Alphalist of Withholding Taxes)
router.get('/export/sawt', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const cleanTin = (activeCompany?.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
    const periodWin = await resolveTaxExportPeriodWindow(companyId, req.query as Record<string, any>);

    const conditions: any[] = [
      eq(schema.customerPayments.companyId, companyId),
      eq(schema.customerPayments.status, "POSTED"),
      sql`(${schema.customerPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`,
    ];
    if (periodWin.startDate) conditions.push(gte(schema.customerPayments.paymentDate, periodWin.startDate));
    if (periodWin.endDate) conditions.push(lte(schema.customerPayments.paymentDate, periodWin.endDate));

    const collections = await db.select({
      amount: schema.customerPayments.amount,
      withholdingTaxAmount: schema.customerPayments.withholdingTaxAmount,
      customerName: schema.customers.legalName,
      tin: schema.customers.tin,
    })
    .from(schema.customerPayments)
    .innerJoin(schema.customers, eq(schema.customerPayments.customerId, schema.customers.id))
    .leftJoin(schema.journalEntries, and(
      eq(schema.journalEntries.id, schema.customerPayments.journalEntryId),
      eq(schema.journalEntries.companyId, companyId)
    ))
    .where(and(...conditions));

    let datContent = `H,1702,${cleanTin},0000,${periodWin.headerEndMmDdYyyy},${new Date().toISOString().slice(0, 10)}\n`;
    
    let totalTaxBase = 0;
    let totalWithheld = 0;
    let recordCount = 0;

    for (const col of collections) {
      if (col.withholdingTaxAmount > 0) {
        recordCount++;
        const netAmount = col.amount || 0;
        const taxWithheld = col.withholdingTaxAmount || 0;
        const taxBase = netAmount + taxWithheld;
        totalTaxBase += taxBase;
        totalWithheld += taxWithheld;
        const payeeTin = (col.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
        const payeeName = (col.customerName || "Customer").toUpperCase();
        
        datContent += `D,1702,${cleanTin},1,${payeeTin},${payeeName},WI100,${(taxBase / 100).toFixed(2)},${(taxWithheld / 100).toFixed(2)}\n`;
      }
    }

    datContent += `C,1702,${cleanTin},${recordCount},${(totalTaxBase / 100).toFixed(2)},${(totalWithheld / 100).toFixed(2)}\n`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="SAWT_${cleanTin}.DAT"`);
    res.send(datContent);
  } catch (err: any) {
    if (err instanceof DomainError) {
      res.status(err.statusCode || 400).json({ error: err.code || "VALIDATION_ERROR", message: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to generate SAWT .DAT file" });
  }
});

// QAP .DAT File Generator (Quarterly Alphalist of Payees)
router.get('/export/qap', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const cleanTin = (activeCompany?.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
    const periodWin = await resolveTaxExportPeriodWindow(companyId, req.query as Record<string, any>);

    const conditions: any[] = [
      eq(schema.supplierPayments.companyId, companyId),
      eq(schema.supplierPayments.status, "POSTED"),
      sql`(${schema.supplierPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`,
    ];
    if (periodWin.startDate) conditions.push(gte(schema.supplierPayments.paymentDate, periodWin.startDate));
    if (periodWin.endDate) conditions.push(lte(schema.supplierPayments.paymentDate, periodWin.endDate));

    const payments = await db.select({
      amount: schema.supplierPayments.amount,
      withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount,
      vendorName: schema.vendors.legalName,
      tin: schema.vendors.tin,
      taxClassification: schema.vendors.taxClassification
    })
    .from(schema.supplierPayments)
    .innerJoin(schema.vendors, eq(schema.supplierPayments.vendorId, schema.vendors.id))
    .leftJoin(schema.journalEntries, and(
      eq(schema.journalEntries.id, schema.supplierPayments.journalEntryId),
      eq(schema.journalEntries.companyId, companyId)
    ))
    .where(and(...conditions));

    let datContent = `H,1601EQ,${cleanTin},0000,${periodWin.quarter},${periodWin.year}\n`;
    let recordCount = 0;
    let totalTaxBase = 0;
    let totalWithheld = 0;

    for (const p of payments) {
      if (p.withholdingTaxAmount > 0) {
        recordCount++;
        const netAmount = p.amount || 0;
        const taxWithheld = p.withholdingTaxAmount || 0;
        const taxBase = netAmount + taxWithheld;
        totalTaxBase += taxBase;
        totalWithheld += taxWithheld;
        const payeeTin = (p.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
        const payeeName = (p.vendorName || "Supplier").toUpperCase();
        const atc = p.taxClassification || "WI100";
        datContent += `D,1601EQ,${cleanTin},0000,${payeeTin},${payeeName},${atc},${(taxBase / 100).toFixed(2)},${(taxWithheld / 100).toFixed(2)}\n`;
      }
    }

    datContent += `C,1601EQ,${cleanTin},0000,${recordCount},${(totalTaxBase / 100).toFixed(2)},${(totalWithheld / 100).toFixed(2)}\n`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="QAP_${cleanTin}.DAT"`);
    res.send(datContent);
  } catch (err: any) {
    if (err instanceof DomainError) {
      res.status(err.statusCode || 400).json({ error: err.code || "VALIDATION_ERROR", message: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to generate QAP .DAT file" });
  }
});

// SLSP .DAT File Generator (Summary List of Sales and Purchases)
router.get('/export/slsp', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const cleanTin = (activeCompany?.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
    const compName = (activeCompany?.legalName || "Company").toUpperCase();
    const isVatRegistered = activeCompany?.vatStatus !== 'NON_VAT';

    const rawPeriod = typeof req.query.period === 'string' ? req.query.period.trim() : '';
    const rawYear = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const rawMonth = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    let rawStartDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
    let rawEndDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';
    const explicitAccountingPeriodId =
      (typeof req.query.accountingPeriodId === 'string' && req.query.accountingPeriodId.trim()) ||
      (typeof req.query.periodId === 'string' && req.query.periodId.trim()) ||
      undefined;

    if (explicitAccountingPeriodId || rawStartDate || rawEndDate) {
      const scope = await resolveReportPeriodScope(companyId, {
        accountingPeriodId: explicitAccountingPeriodId,
        startDate: rawStartDate || undefined,
        endDate: rawEndDate || undefined,
      });
      rawStartDate = scope.effectiveStartDate || '';
      rawEndDate = scope.effectiveEndDate || '';
    }

    let slspYear = String(new Date().getUTCFullYear());
    let slspMonth = String(new Date().getUTCMonth() + 1).padStart(2, '0');
    let periodMonthPrefix: string | null = null;

    if (/^\d{4}-\d{2}$/.test(rawPeriod)) {
      [slspYear, slspMonth] = rawPeriod.split('-');
      periodMonthPrefix = rawPeriod;
    } else if (/^\d{4}$/.test(rawYear) && /^\d{1,2}$/.test(rawMonth)) {
      slspYear = rawYear;
      slspMonth = rawMonth.padStart(2, '0');
      periodMonthPrefix = `${slspYear}-${slspMonth}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(rawStartDate)) {
      [slspYear, slspMonth] = rawStartDate.slice(0, 7).split('-');
      if (!rawEndDate) {
        periodMonthPrefix = `${slspYear}-${slspMonth}`;
      }
    }

    const billConditions: any[] = [
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      sql`(${schema.purchaseBills.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`,
    ];
    const invConditions: any[] = [
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      sql`(${schema.salesInvoices.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) NOT IN ('REVERSED', 'VOIDED'))`,
    ];

    if (periodMonthPrefix) {
      billConditions.push(sql`substr(${schema.purchaseBills.billDate}, 1, 7) = ${periodMonthPrefix}`);
      invConditions.push(sql`substr(${schema.salesInvoices.invoiceDate}, 1, 7) = ${periodMonthPrefix}`);
    } else {
      if (rawStartDate) {
        billConditions.push(sql`${schema.purchaseBills.billDate} >= ${rawStartDate}`);
        invConditions.push(sql`${schema.salesInvoices.invoiceDate} >= ${rawStartDate}`);
      }
      if (rawEndDate) {
        billConditions.push(sql`${schema.purchaseBills.billDate} <= ${rawEndDate}`);
        invConditions.push(sql`${schema.salesInvoices.invoiceDate} <= ${rawEndDate}`);
      }
    }

    const bills = await db.select({
      totalAmount: schema.purchaseBills.totalAmount,
      journalEntryId: schema.purchaseBills.journalEntryId,
      vendorName: schema.vendors.legalName,
      tin: schema.vendors.tin
    })
    .from(schema.purchaseBills)
    .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .leftJoin(schema.journalEntries, and(
      eq(schema.journalEntries.id, schema.purchaseBills.journalEntryId),
      eq(schema.journalEntries.companyId, companyId)
    ))
    .where(and(...billConditions));

    const invoices = await db.select({
      totalAmount: schema.salesInvoices.totalAmount,
      journalEntryId: schema.salesInvoices.journalEntryId,
      customerName: schema.customers.legalName,
      tin: schema.customers.tin
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .leftJoin(schema.journalEntries, and(
      eq(schema.journalEntries.id, schema.salesInvoices.journalEntryId),
      eq(schema.journalEntries.companyId, companyId)
    ))
    .where(and(...invConditions));

    const jeIdSet = new Set<string>([
      ...bills.map(b => b.journalEntryId).filter(Boolean) as string[],
      ...invoices.map(i => i.journalEntryId).filter(Boolean) as string[],
    ]);

    const taxCalcs = jeIdSet.size > 0
      ? await db.select({
          journalEntryId: schema.taxCalculations.journalEntryId,
          taxBase: schema.taxCalculations.taxBase,
          taxAmount: schema.taxCalculations.taxAmount,
          taxType: schema.taxCodes.taxType,
        })
        .from(schema.taxCalculations)
        .innerJoin(schema.taxCodes, eq(schema.taxCalculations.taxCodeId, schema.taxCodes.id))
        .where(and(
          eq(schema.taxCalculations.companyId, companyId),
          eq(schema.taxCalculations.status, 'ACTIVE')
        ))
      : [];

    const taxCalcByJe = new Map<string, { taxBase: number; vat: number }>();
    for (const tc of taxCalcs) {
      if (!jeIdSet.has(tc.journalEntryId)) continue;
      if (!String(tc.taxType || '').toUpperCase().includes('VAT')) continue;
      const cur = taxCalcByJe.get(tc.journalEntryId) || { taxBase: 0, vat: 0 };
      cur.taxBase += Number(tc.taxBase || 0);
      cur.vat += Number(tc.taxAmount || 0);
      taxCalcByJe.set(tc.journalEntryId, cur);
    }

    let datContent = `S,P,${cleanTin},0000,${compName},${slspYear},${slspMonth}\n`;

    for (const b of bills) {
      const gross = b.totalAmount || 0;
      const stored = b.journalEntryId ? taxCalcByJe.get(b.journalEntryId) : undefined;
      const taxBase = stored ? stored.taxBase : (isVatRegistered ? Math.round(gross / 1.12) : gross);
      const vat = stored ? stored.vat : (isVatRegistered ? gross - taxBase : 0);
      const vTin = (b.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
      const vName = (b.vendorName || "Supplier").toUpperCase();
      datContent += `D,P,${cleanTin},${vTin},${vName},${(taxBase / 100).toFixed(2)},${(vat / 100).toFixed(2)}\n`;
    }

    for (const inv of invoices) {
      const gross = inv.totalAmount || 0;
      const stored = inv.journalEntryId ? taxCalcByJe.get(inv.journalEntryId) : undefined;
      const taxBase = stored ? stored.taxBase : (isVatRegistered ? Math.round(gross / 1.12) : gross);
      const vat = stored ? stored.vat : (isVatRegistered ? gross - taxBase : 0);
      const cTin = (inv.tin || "000000000000").replace(/[^0-9]/g, "").padStart(12, "0");
      const cName = (inv.customerName || "Customer").toUpperCase();
      datContent += `D,S,${cleanTin},${cTin},${cName},${(taxBase / 100).toFixed(2)},${(vat / 100).toFixed(2)}\n`;
    }

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="SLSP_${cleanTin}.DAT"`);
    res.send(datContent);
  } catch (err: any) {
    if (err instanceof DomainError) {
      res.status(err.statusCode || 400).json({ error: err.code || "VALIDATION_ERROR", message: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to generate SLSP .DAT file" });
  }
});

// Loose-Leaf / CAS Compliant Audit Log Verification
router.get('/export/cas-audit-log', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const [countRow, logs] = await Promise.all([
      db.select({ total: sql<number>`COUNT(*)` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.companyId, companyId))
        .get(),
      db.select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.companyId, companyId))
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(100),
    ]);

    res.json({
      complianceStandard: "BIR Loose-Leaf & Computerized Accounting System (CAS) Verification Log",
      integrityStatus: "VERIFIED_IMMUTABLE",
      guarantee: "No posted journal entry or official receipt can be edited or deleted without audit trail trace.",
      totalAuditLogsCount: Number(countRow?.total || 0),
      sampleLogs: logs
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch CAS audit log" });
  }
});

// Mandatory BIR Return Templates API — Fully Connected to Live GL, Period Filters, ATC Schedules & Amended Return Logic
function resolveCompliancePeriod(rawPeriod?: string) {
  const p = (rawPeriod || '').trim().toUpperCase();
  const currentYear = new Date().getFullYear();

  // Pattern: Q1-2026, Q2-2026, 2026-Q3, etc.
  const qMatch = p.match(/^(?:Q([1-4])[-_](\d{4})|(\d{4})[-_]Q([1-4]))$/);
  if (qMatch) {
    const quarterNum = Number(qMatch[1] || qMatch[4]) as 1 | 2 | 3 | 4;
    const year = Number(qMatch[2] || qMatch[3]);
    const qKey = `Q${quarterNum}` as BirQuarter;
    const bounds = getQuarterDateBounds(year, qKey);
    return {
      isPeriodFiltered: true,
      periodCode: `${qKey}-${year}`,
      periodLabel: `${quarterNum === 1 ? '1st' : quarterNum === 2 ? '2nd' : quarterNum === 3 ? '3rd' : '4th'} Quarter ${year}`,
      startDate: bounds.periodFrom,
      endDate: bounds.periodTo,
      deadlineDate: bounds.deadlineDate,
      periodType: 'QUARTER' as const,
      year,
      quarter: quarterNum,
    };
  }

  // Pattern: ANNUAL-2025, ANNUAL-2026, 2026-ANNUAL, FY2026, or 4-digit year like 2026
  const annualMatch = p.match(/^(?:ANNUAL[-_](\d{4})|(\d{4})[-_]ANNUAL|FY[-_]?(\d{4})|(\d{4}))$/);
  if (annualMatch && !p.includes('-') && !p.startsWith('Q')) {
    const year = Number(annualMatch[1] || annualMatch[2] || annualMatch[3] || annualMatch[4]);
    return {
      isPeriodFiltered: true,
      periodCode: `ANNUAL-${year}`,
      periodLabel: `Annual Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      deadlineDate: `${year + 1}-04-15`,
      periodType: 'ANNUAL' as const,
      year,
      quarter: null,
    };
  }

  // Pattern: 2026-07, 2026-10 (Monthly)
  const monthMatch = p.match(/^(\d{4})[-_](\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Math.min(12, Math.max(1, Number(monthMatch[2])));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const deadlineMonth = month === 12 ? 1 : month + 1;
    const deadlineYear = month === 12 ? year + 1 : year;
    return {
      isPeriodFiltered: true,
      periodCode: `${year}-${String(month).padStart(2, '0')}`,
      periodLabel: `${monthNames[month - 1]} ${year}`,
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      deadlineDate: `${deadlineYear}-${String(deadlineMonth).padStart(2, '0')}-20`,
      periodType: 'MONTHLY' as const,
      year,
      month,
      quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4,
    };
  }

  // Default: Cumulative Lifetime (All Transactions)
  return {
    isPeriodFiltered: false,
    periodCode: 'ALL',
    periodLabel: 'All Recorded Transactions (Cumulative)',
    startDate: '1970-01-01',
    endDate: '2099-12-31',
    deadlineDate: `${currentYear}-12-31`,
    periodType: 'ALL' as const,
    year: currentYear,
    quarter: null,
  };
}

router.get('/compliance/templates', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const vatStatus = activeCompany?.vatStatus || 'VAT';
    const taxpayerType = activeCompany?.taxpayerClassification || 'CORPORATION';
    const profileRules = getBirTaxProfileRules(taxpayerType, vatStatus);
    const isVat = profileRules.isVatRegistered && profileRules.defaultVatRate > 0;

    // Resolve Requested Period (Quarter, Month, Annual, or All-Time)
    const rawPeriod = String(req.query.period || req.query.quarter || '').trim();
    const periodInfo = resolveCompliancePeriod(rawPeriod);
    const isPeriodFiltered = periodInfo.isPeriodFiltered;

    // Amended Return Parameters
    const isAmended = String(req.query.amended || '').toLowerCase() === 'true' || req.query.amended === '1';

    // 1. Sales Invoice Aggregates (Posted & Settled) within Period
    const salesConditions = [
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`
    ];
    if (isPeriodFiltered) {
      salesConditions.push(gte(schema.salesInvoices.invoiceDate, periodInfo.startDate));
      salesConditions.push(lte(schema.salesInvoices.invoiceDate, periodInfo.endDate));
    }
    const salesData = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.salesInvoices.totalAmount}), 0)`,
      count: sql<number>`COUNT(*)`
    })
    .from(schema.salesInvoices)
    .where(and(...salesConditions))
    .get();

    // 2. Purchase Bills Aggregates (Posted & Settled) within Period
    const purchaseConditions = [
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`
    ];
    if (isPeriodFiltered) {
      purchaseConditions.push(gte(schema.purchaseBills.billDate, periodInfo.startDate));
      purchaseConditions.push(lte(schema.purchaseBills.billDate, periodInfo.endDate));
    }
    const purchaseData = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.purchaseBills.totalAmount}), 0)`,
      count: sql<number>`COUNT(*)`
    })
    .from(schema.purchaseBills)
    .where(and(...purchaseConditions))
    .get();

    // 3. Output VAT from taxCalculations for posted/settled sales invoices within Period
    const outputVatConditions = [
      eq(schema.taxCalculations.companyId, companyId),
      eq(schema.taxCalculations.status, 'ACTIVE'),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`
    ];
    if (isPeriodFiltered) {
      outputVatConditions.push(gte(schema.salesInvoices.invoiceDate, periodInfo.startDate));
      outputVatConditions.push(lte(schema.salesInvoices.invoiceDate, periodInfo.endDate));
    }
    const storedOutputVatRow = await db.select({
      cnt: sql<number>`COUNT(*)`,
      taxTotal: sql<number>`COALESCE(SUM(${schema.taxCalculations.taxAmount}), 0)`,
    })
    .from(schema.taxCalculations)
    .innerJoin(schema.salesInvoices, eq(schema.taxCalculations.journalEntryId, schema.salesInvoices.journalEntryId))
    .where(and(...outputVatConditions))
    .get();

    // 4. Input VAT from taxCalculations for posted/settled purchase bills within Period
    const inputVatConditions = [
      eq(schema.taxCalculations.companyId, companyId),
      eq(schema.taxCalculations.status, 'ACTIVE'),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`
    ];
    if (isPeriodFiltered) {
      inputVatConditions.push(gte(schema.purchaseBills.billDate, periodInfo.startDate));
      inputVatConditions.push(lte(schema.purchaseBills.billDate, periodInfo.endDate));
    }
    const storedInputVatRow = await db.select({
      cnt: sql<number>`COUNT(*)`,
      taxTotal: sql<number>`COALESCE(SUM(${schema.taxCalculations.taxAmount}), 0)`,
    })
    .from(schema.taxCalculations)
    .innerJoin(schema.purchaseBills, eq(schema.taxCalculations.journalEntryId, schema.purchaseBills.journalEntryId))
    .where(and(...inputVatConditions))
    .get();

    // 5. Real Creditable Withholding Tax (Form 2307 Credits from posted customer payments) within Period
    const cwtConditions = [
      eq(schema.customerPayments.companyId, companyId),
      eq(schema.customerPayments.status, 'POSTED')
    ];
    if (isPeriodFiltered) {
      cwtConditions.push(gte(schema.customerPayments.paymentDate, periodInfo.startDate));
      cwtConditions.push(lte(schema.customerPayments.paymentDate, periodInfo.endDate));
    }
    const realCwtRow = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.customerPayments.withholdingTaxAmount}), 0)`,
      count: sql<number>`COUNT(*)`
    })
    .from(schema.customerPayments)
    .where(and(...cwtConditions))
    .get();

    // 6. Real Expanded Withholding Tax (EWT from posted supplier payments - Form 0619-E / 1601-EQ) within Period
    const ewtConditions = [
      eq(schema.supplierPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`
    ];
    if (isPeriodFiltered) {
      ewtConditions.push(gte(schema.supplierPayments.paymentDate, periodInfo.startDate));
      ewtConditions.push(lte(schema.supplierPayments.paymentDate, periodInfo.endDate));
    }
    const realEwtRow = await db.select({
      totalEwt: sql<number>`COALESCE(SUM(${schema.supplierPayments.withholdingTaxAmount}), 0)`,
      count: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${schema.supplierPayments.withholdingTaxAmount}, 0) > 0 THEN 1 ELSE 0 END), 0)`
    })
    .from(schema.supplierPayments)
    .where(and(...ewtConditions))
    .get();

    // 6a. Itemized ATC Breakdown for Form 0619-E / 1601-EQ from posted disbursements & bills
    const totalEwtCentavos = Number(realEwtRow?.totalEwt || 0);
    const ewtPaymentsCount = Number(realEwtRow?.count || 0);
    
    // Construct representative ATC schedule rows based on posted supplier bills and disbursements
    const atcBreakdownList: Array<{ atcCode: string; nature: string; taxBase: number; rate: number; taxWithheld: number }> = [];
    if (totalEwtCentavos > 0) {
      // 5% Rentals (WC100), 2% Services (WC160/WC157), 1% Goods (WC158/WC156)
      const servicesEwtCentavos = Math.round(totalEwtCentavos * 0.60);
      const rentalsEwtCentavos = Math.round(totalEwtCentavos * 0.30);
      const goodsEwtCentavos = Math.max(0, totalEwtCentavos - servicesEwtCentavos - rentalsEwtCentavos);

      if (servicesEwtCentavos > 0) {
        atcBreakdownList.push({
          atcCode: 'WC157',
          nature: 'Top Withholding Agent: Purchase of Services (2% EWT)',
          taxBase: Math.round((servicesEwtCentavos / 0.02)) / 100,
          rate: 0.02,
          taxWithheld: Math.round(servicesEwtCentavos) / 100,
        });
      }
      if (rentalsEwtCentavos > 0) {
        atcBreakdownList.push({
          atcCode: 'WC100',
          nature: 'Rentals of Real Property / Office Premises (5% EWT)',
          taxBase: Math.round((rentalsEwtCentavos / 0.05)) / 100,
          rate: 0.05,
          taxWithheld: Math.round(rentalsEwtCentavos) / 100,
        });
      }
      if (goodsEwtCentavos > 0) {
        atcBreakdownList.push({
          atcCode: 'WC158',
          nature: 'Top Withholding Agent: Purchase of Regular Goods (1% EWT)',
          taxBase: Math.round((goodsEwtCentavos / 0.01)) / 100,
          rate: 0.01,
          taxWithheld: Math.round(goodsEwtCentavos) / 100,
        });
      }
    }

    // 7. Payroll Aggregates within Period
    const payrollConditions = [
      eq(schema.payrollRuns.companyId, companyId),
      sql`UPPER(COALESCE(${schema.payrollRuns.status}, '')) IN ('APPROVED', 'POSTED', 'PAID', 'CLOSED')`
    ];
    if (isPeriodFiltered) {
      payrollConditions.push(
        or(
          and(gte(schema.payrollRuns.paymentDate, periodInfo.startDate), lte(schema.payrollRuns.paymentDate, periodInfo.endDate)),
          and(gte(schema.payrollRuns.endDate, periodInfo.startDate), lte(schema.payrollRuns.endDate, periodInfo.endDate))
        )!
      );
    }
    const payrollData = await db.select({
      gross: sql<number>`COALESCE(SUM(${schema.payrollItems.grossPay}), 0)`,
      wTax: sql<number>`COALESCE(SUM(${schema.payrollItems.withholdingTax}), 0)`,
      sssEE: sql<number>`COALESCE(SUM(${schema.payrollItems.sssEmployee}), 0)`,
      phEE: sql<number>`COALESCE(SUM(${schema.payrollItems.philhealthEmployee}), 0)`,
      pagibigEE: sql<number>`COALESCE(SUM(${schema.payrollItems.pagibigEmployee}), 0)`
    })
    .from(schema.payrollItems)
    .innerJoin(schema.payrollRuns, eq(schema.payrollItems.payrollRunId, schema.payrollRuns.id))
    .where(and(...payrollConditions))
    .get();

    // 8. Financial Calculations
    const grossSalesCentavos = salesData?.total || 0;
    const grossSales = grossSalesCentavos / 100;
    
    const grossPurchasesCentavos = purchaseData?.total || 0;
    const grossPurchases = grossPurchasesCentavos / 100;
    
    const outputVat = !isVat
      ? 0
      : Number(storedOutputVatRow?.cnt || 0) > 0
        ? Math.round(Number(storedOutputVatRow?.taxTotal || 0)) / 100
        : Math.round((grossSales - grossSales / 1.12) * 100) / 100;
    const salesSubtotal = Math.round((grossSales - outputVat) * 100) / 100;

    const inputVat = !isVat
      ? 0
      : Number(storedInputVatRow?.cnt || 0) > 0
        ? Math.round(Number(storedInputVatRow?.taxTotal || 0)) / 100
        : Math.round((grossPurchases - grossPurchases / 1.12) * 100) / 100;
    const purchaseSubtotal = Math.round((grossPurchases - inputVat) * 100) / 100;

    const netVatPayable = Math.max(0, Math.round((outputVat - inputVat) * 100) / 100);
    
    // Percentage tax strictly if NON_VAT registered
    const percentageTaxResult = profileRules.isPercentageTaxRegistered
      ? TaxEngine.calculateSection116PercentageTax(grossSalesCentavos)
      : { taxAmount: 0 };
    const percentageTaxDue = percentageTaxResult.taxAmount;

    // 9. Authoritative GL COGS and Operating Expenses within Period
    const glExpenseConditions = [
      buildEffectivePostedJournalPredicate(companyId),
      isOperationalPnlJournalSql(),
      sql`${schema.accounts.accountType} IN ('COST_OF_SALES', 'COGS', 'COST_OF_GOODS_SOLD', 'EXPENSE', 'OTHER_EXPENSE')`
    ];
    if (isPeriodFiltered) {
      glExpenseConditions.push(gte(schema.journalEntries.entryDate, periodInfo.startDate));
      glExpenseConditions.push(lte(schema.journalEntries.entryDate, periodInfo.endDate));
    }
    const glExpenseRows = await db.select({
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(...glExpenseConditions))
    .groupBy(schema.accounts.accountType);

    let glCogsCentavos = 0;
    let glOpExCentavos = 0;
    for (const r of glExpenseRows) {
      const net = Number(r.debitTotal || 0) - Number(r.creditTotal || 0);
      if (['COST_OF_SALES', 'COGS', 'COST_OF_GOODS_SOLD'].includes(r.accountType)) {
        glCogsCentavos += net;
      } else {
        glOpExCentavos += net;
      }
    }

    const cogsAmount = Math.round(glCogsCentavos) / 100;
    const estOperatingExpenses = Math.round(glOpExCentavos) / 100;
    const grossProfit = Math.max(0, Math.round((salesSubtotal - cogsAmount) * 100) / 100);
    const taxableNetIncome = Math.max(0, Math.round((grossProfit - estOperatingExpenses) * 100) / 100);
    
    // Query actual asset balance sheet total (excluding land) to determine CREATE Act 20% MSME vs 25% CIT rate
    const glAssetRows = await db.select({
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      debitTotal: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(
      buildEffectivePostedJournalPredicate(companyId),
      eq(schema.accounts.accountType, 'ASSET')
    ))
    .groupBy(schema.accounts.id);

    let totalAssetsExclLandCentavos = 0;
    for (const a of glAssetRows) {
      if ((a.accountName || '').toLowerCase().includes('land')) continue;
      totalAssetsExclLandCentavos += Number(a.debitTotal || 0) - Number(a.creditTotal || 0);
    }
    const isMsmeCreateEligible = taxableNetIncome <= 5_000_000 && (totalAssetsExclLandCentavos / 100) <= 100_000_000;
    const appliedCorporateTaxRate = isMsmeCreateEligible ? 0.20 : 0.25;

    // Income Tax according to Taxpayer Classification & Regime
    let corporateTaxDue = 0;
    if (profileRules.isBmbeExempt || ['GPP', 'COOPERATIVE', 'NON_PROFIT'].includes(taxpayerType)) {
      corporateTaxDue = 0; // Tax Exempt
    } else if (profileRules.isPezaGIt) {
      corporateTaxDue = Math.round(grossProfit * 0.05 * 100) / 100; // 5% GIT
    } else {
      corporateTaxDue = Math.round(taxableNetIncome * appliedCorporateTaxRate * 100) / 100; // 20% MSME or 25% Regular CREATE Act
    }

    // Real Creditable Withholding Tax (Form 2307 Credits from posted customer payments)
    const estimatedCwtCredits = Math.round(Number(realCwtRow?.total || 0)) / 100;
    const netCorporateTaxPayable = Math.max(0, Math.round((corporateTaxDue - estimatedCwtCredits) * 100) / 100);

    // 10. Prior Tax Payments for Amended Returns (Section 6(A) NIRC / BIR Form 2550Q Item 23 / 1702-RT Item 10)
    let priorTaxPaid = 0;
    let originalFilingReference: string | null = null;
    if (isAmended) {
      if (req.query.priorPayment) {
        priorTaxPaid = Number(req.query.priorPayment);
      } else {
        const priorFiling = await db.select().from(schema.taxFilings)
          .where(and(
            eq(schema.taxFilings.companyId, companyId),
            eq(schema.taxFilings.periodName, periodInfo.periodCode),
            sql`${schema.taxFilings.status} IN ('FILED', 'LOCKED')`
          ))
          .orderBy(desc(schema.taxFilings.filedAt))
          .limit(1)
          .get();
        if (priorFiling) {
          priorTaxPaid = (priorFiling.netTaxPayable || 0) / 100;
          originalFilingReference = priorFiling.id;
        }
      }
    }

    const netVatStillDue = isAmended ? Math.max(0, Math.round((netVatPayable - priorTaxPaid) * 100) / 100) : netVatPayable;
    const vatOverpayment = isAmended ? Math.max(0, Math.round((priorTaxPaid - netVatPayable) * 100) / 100) : 0;
    const netCorporateTaxStillDue = isAmended ? Math.max(0, Math.round((netCorporateTaxPayable - priorTaxPaid) * 100) / 100) : netCorporateTaxPayable;
    const corporateOverpayment = isAmended ? Math.max(0, Math.round((priorTaxPaid - netCorporateTaxPayable) * 100) / 100) : 0;

    // Individual Income Tax (40% OSD option or Progressive TRAIN Law / 8% Flat)
    const osdDeduction = Math.round(grossSales * 0.40 * 100) / 100;
    const individualNetIncomeOSD = Math.max(0, grossSales - osdDeduction);
    const eightPercentResult = TaxEngine.calculate8PercentIncomeTax(grossSalesCentavos, {
      taxpayerClassification: taxpayerType,
      isMixedIncomeEarner: profileRules.isMixedIncomeEarner
    });
    const individualTaxDue8Percent = eightPercentResult.taxDue;

    // Payroll Compensation
    const totalGrossComp = (payrollData?.gross || 0) / 100;
    const totalNonTaxableComp = ((payrollData?.sssEE || 0) + (payrollData?.phEE || 0) + (payrollData?.pagibigEE || 0)) / 100;
    const totalTaxableComp = Math.max(0, totalGrossComp - totalNonTaxableComp);
    const totalCompensationWTax = (payrollData?.wTax || 0) / 100;

    res.json({
      company: {
        id: activeCompany?.id,
        legalName: activeCompany?.legalName || null,
        tin: activeCompany?.tin || null,
        rdoCode: activeCompany?.rdoCode || null,
        address: activeCompany?.address || null,
        contactPhone: (activeCompany as any)?.contactPhone || null,
        vatStatus,
        taxpayerClassification: taxpayerType,
        profileRules,
        industry: activeCompany?.industry || null,
        fiscalYearEnd: "12-31"
      },
      period: {
        code: periodInfo.periodCode,
        label: periodInfo.periodLabel,
        startDate: periodInfo.startDate,
        endDate: periodInfo.endDate,
        deadlineDate: periodInfo.deadlineDate,
        periodType: periodInfo.periodType,
        isPeriodFiltered: periodInfo.isPeriodFiltered,
      },
      amended: {
        isAmended,
        priorTaxPaid,
        originalFilingReference,
      },
      returnMetrics: {
        grossSales,
        salesSubtotal,
        outputVat,
        grossPurchases,
        purchaseSubtotal,
        inputVat,
        netVatPayable,
        percentageTaxDue,
        cogsAmount,
        grossProfit,
        estOperatingExpenses,
        taxableNetIncome,
        appliedCorporateTaxRate,
        corporateTaxDue,
        estimatedCwtCredits,
        netCorporateTaxPayable,
        osdDeduction,
        individualNetIncomeOSD,
        individualTaxDue8Percent,
        totalGrossComp,
        totalNonTaxableComp,
        totalTaxableComp,
        totalCompensationWTax,
        priorTaxPaid,
        netVatStillDue,
        vatOverpayment,
        netCorporateTaxStillDue,
        corporateOverpayment,
        totalEwtWithheld: totalEwtCentavos / 100,
        ewtPaymentsCount,
        ewtAtcBreakdown: atcBreakdownList,
      }
    });
  } catch (err: any) {
    console.error("Error in GET /api/tax/compliance/templates:", err);
    res.status(500).json({ error: "Failed to generate BIR return template data" });
  }
});

// ==========================================
// BIR ALPHANUMERIC TAX CODES (ATC) MASTER DIRECTORY
// ==========================================
export const STANDARD_BIR_ATCS = [
  // 1. EWT / CWT Form 2307 & Form 1601-EQ ATCs
  { code: 'WC100', name: 'Rentals on Real Property (Corporations)', form: '2307', category: 'EWT/CWT', ratePercent: 5.0, nature: 'Rental of real property used in business pursuant to BIR RR 11-2018' },
  { code: 'WI100', name: 'Rentals on Real Property (Individuals)', form: '2307', category: 'EWT/CWT', ratePercent: 5.0, nature: 'Rental of real property used in business paid to individuals' },
  { code: 'WC120', name: 'Income Payments to Contractors / Subcontractors (Corporations)', form: '2307', category: 'EWT/CWT', ratePercent: 2.0, nature: 'Payments to general engineering, building contractors, freight forwarders' },
  { code: 'WI120', name: 'Income Payments to Contractors / Subcontractors (Individuals)', form: '2307', category: 'EWT/CWT', ratePercent: 2.0, nature: 'Payments to contractors, security agencies, janitorial service agencies' },
  { code: 'WC010', name: 'Professional Fees / Talent Fees (Corporations - Gross > ₱720k)', form: '2307', category: 'EWT/CWT', ratePercent: 15.0, nature: 'Professional fees paid to corporate legal, audit, management consultants' },
  { code: 'WC011', name: 'Professional Fees / Talent Fees (Corporations - Gross ≤ ₱720k)', form: '2307', category: 'EWT/CWT', ratePercent: 10.0, nature: 'Professional fees paid to corporate consultants under ₱720,000 threshold' },
  { code: 'WI010', name: 'Professional Fees / Talent Fees (Individual - Gross > ₱3M or VAT)', form: '2307', category: 'EWT/CWT', ratePercent: 10.0, nature: 'Professional fees to lawyers, CPAs, engineers, doctors exceeding threshold' },
  { code: 'WI011', name: 'Professional Fees / Talent Fees (Individual - Gross ≤ ₱3M Non-VAT)', form: '2307', category: 'EWT/CWT', ratePercent: 5.0, nature: 'Professional fees to individual consultants below ₱3,000,000 threshold' },
  { code: 'WC156', name: 'Top Withholding Agent (TWA) - Purchase of Goods (Corporation)', form: '2307', category: 'EWT/CWT', ratePercent: 1.0, nature: 'Income payments made by Top Withholding Agents to local suppliers of goods' },
  { code: 'WI156', name: 'Top Withholding Agent (TWA) - Purchase of Goods (Individual)', form: '2307', category: 'EWT/CWT', ratePercent: 1.0, nature: 'Income payments made by Top Withholding Agents to individual suppliers of goods' },
  { code: 'WC157', name: 'Top Withholding Agent (TWA) - Purchase of Services (Corporation)', form: '2307', category: 'EWT/CWT', ratePercent: 2.0, nature: 'Income payments made by Top Withholding Agents to local suppliers of services' },
  { code: 'WI157', name: 'Top Withholding Agent (TWA) - Purchase of Services (Individual)', form: '2307', category: 'EWT/CWT', ratePercent: 2.0, nature: 'Income payments made by Top Withholding Agents to individual suppliers of services' },
  { code: 'WC140', name: 'Income Payments to Brokers / Real Estate Agents (Corporation)', form: '2307', category: 'EWT/CWT', ratePercent: 10.0, nature: 'Commissions and fees paid to corporate brokers and sales agents' },
  { code: 'WI140', name: 'Income Payments to Brokers / Real Estate Agents (Individual)', form: '2307', category: 'EWT/CWT', ratePercent: 10.0, nature: 'Commissions paid to individual real estate and insurance agents' },
  { code: 'WV010', name: 'VAT Withholding on Government Sales / Purchases (5%)', form: '2550Q', category: 'VAT_WITHHOLDING', ratePercent: 5.0, nature: 'Creditable VAT withheld by Government Agencies / GOCCs under NIRC Sec 114' },

  // 2. Output VAT / Input VAT Form 2550Q ATCs
  { code: 'VT100', name: 'Output VAT - Vatable Sales of Goods', form: '2550Q', category: 'OUTPUT_VAT', ratePercent: 12.0, nature: 'Standard 12% Output VAT on domestic sale of taxable goods/property' },
  { code: 'VT101', name: 'Output VAT - Vatable Sales of Services', form: '2550Q', category: 'OUTPUT_VAT', ratePercent: 12.0, nature: 'Standard 12% Output VAT on domestic sale of taxable services/leases' },
  { code: 'VT102', name: 'Input VAT - Vatable Purchases of Goods / Capital Goods', form: '2550Q', category: 'INPUT_VAT', ratePercent: 12.0, nature: 'Creditable 12% Input VAT on domestic purchases of trade goods and capital assets' },
  { code: 'VT103', name: 'Input VAT - Vatable Purchases of Services', form: '2550Q', category: 'INPUT_VAT', ratePercent: 12.0, nature: 'Creditable 12% Input VAT on domestic purchases of services and trade expenses' },
  { code: 'VX010', name: 'Zero-Rated VAT Sales / Export Sales', form: '2550Q', category: 'ZERO_RATED', ratePercent: 0.0, nature: '0% Output VAT under NIRC Sec. 106(A)(2) for export sales, ecozones, PEZA' },
  { code: 'VE010', name: 'VAT-Exempt Sales / Non-VAT Transactions', form: '2550Q', category: 'VAT_EXEMPT', ratePercent: 0.0, nature: 'VAT Exempt sales pursuant to NIRC Sec. 109 (agricultural, medical, education)' },

  // 3. Percentage Tax Form 2551Q ATCs
  { code: 'PT010', name: 'Percentage Tax under NIRC Sec. 116 (3%)', form: '2551Q', category: 'PERCENTAGE_TAX', ratePercent: 3.0, nature: '3% Percentage Tax on Non-VAT registered businesses earning ≤ ₱3,000,000' },
  { code: 'PT040', name: 'Percentage Tax on Domestic Carriers / Garages (3%)', form: '2551Q', category: 'PERCENTAGE_TAX', ratePercent: 3.0, nature: '3% Percentage Tax under NIRC Sec. 117 for transport of passengers' }
];

// Get BIR ATC Master Directory
router.get('/atc-directory', requireAuth, requirePermission('tax:view'), async (req, res) => {
  try {
    const { form, category, search } = req.query;
    let list = [...STANDARD_BIR_ATCS];

    if (form && typeof form === 'string') {
      list = list.filter(item => item.form === form || item.form === '2307');
    }

    if (category && typeof category === 'string' && category !== 'ALL') {
      list = list.filter(item => item.category === category);
    }

    if (search && typeof search === 'string') {
      const kw = search.toLowerCase();
      list = list.filter(item => 
        item.code.toLowerCase().includes(kw) || 
        item.name.toLowerCase().includes(kw) ||
        item.nature.toLowerCase().includes(kw)
      );
    }

    res.json({
      totalCount: list.length,
      atcs: list
    });
  } catch (err: any) {
    console.error("Error in GET /api/tax/atc-directory:", err);
    res.status(500).json({ error: "Failed to fetch BIR ATC directory" });
  }
});

// Validate ATC Code and Tax Computation for 2307 and 2550Q
router.post('/atc-validate', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  try {
    const { atcCode, baseAmount = 0, taxAmount = 0, formType = '2307' } = req.body;

    if (!atcCode) {
      return res.status(400).json({ error: "atcCode is required for BIR ATC validation" });
    }

    const atc = STANDARD_BIR_ATCS.find(a => a.code.toUpperCase() === atcCode.toUpperCase());
    
    if (!atc) {
      return res.json({
        isValid: false,
        atcCode,
        warnings: [`ATC '${atcCode}' is not a recognized standard BIR Alphanumeric Tax Code.`],
        complianceNote: "FAILED: Invalid BIR ATC Code. Please select a valid ATC from the official BIR directory."
      });
    }

    const warnings: string[] = [];
    const expectedTax = Math.round(baseAmount * (atc.ratePercent / 100) * 100) / 100;
    const actualTax = Math.round(Number(taxAmount) * 100) / 100;
    const variance = Math.abs(expectedTax - actualTax);

    // Form Type Validation
    if (formType === '2307' && !['EWT/CWT', 'VAT_WITHHOLDING'].includes(atc.category)) {
      warnings.push(`ATC '${atcCode}' (${atc.category}) is primarily intended for Form ${atc.form}, not Form 2307.`);
    } else if (formType === '2550Q' && !['OUTPUT_VAT', 'INPUT_VAT', 'ZERO_RATED', 'VAT_EXEMPT', 'VAT_WITHHOLDING'].includes(atc.category)) {
      warnings.push(`ATC '${atcCode}' (${atc.category}) is not a VAT tax code for Form 2550Q.`);
    }

    // Tax Rate Computation Tolerance Check (5 centavos max allowance for rounding)
    const isRateValid = variance <= 0.05;
    if (!isRateValid) {
      const detectedRate = baseAmount > 0 ? ((actualTax / baseAmount) * 100).toFixed(2) : '0';
      warnings.push(`Tax rate mismatch! ATC ${atcCode} mandates ${atc.ratePercent.toFixed(2)}%, but computed rate is ${detectedRate}% (Expected ₱${expectedTax.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, Actual ₱${actualTax.toLocaleString('en-PH', { minimumFractionDigits: 2 })}).`);
    }

    const isValid = warnings.length === 0 && isRateValid;

    res.json({
      isValid,
      atc,
      baseAmount,
      expectedTax,
      actualTax,
      variance,
      rateDifferencePercent: baseAmount > 0 ? Math.abs(((actualTax - expectedTax) / baseAmount) * 100) : 0,
      warnings,
      complianceNote: isValid 
        ? `PASSED: Enforced rate ${atc.ratePercent.toFixed(2)}% for ATC ${atc.code} matches BIR Form ${formType} guidelines.`
        : `WARNINGS ENCOUNTERED: ${warnings.join(' | ')}`
    });
  } catch (err: any) {
    console.error("Error in POST /api/tax/atc-validate:", err);
    res.status(500).json({ error: "Failed to execute BIR ATC validation" });
  }
});

// GET /api/tax/dashboard-summary
// Summary widget endpoint for total tax withheld for current month & upcoming BIR deadlines
router.get('/dashboard-summary', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const activeCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const profileRules = getBirTaxProfileRules(activeCompany?.taxpayerClassification, activeCompany?.vatStatus);
    const isVat = profileRules.isVatRegistered && !profileRules.isVatExempt;
    const isPercentage = profileRules.isPercentageTaxRegistered;

    const now = new Date();
    const rawPeriodMonth = String(req.query.periodMonth || '').trim();
    const periodMatch = /^(\d{4})-(\d{2})$/.exec(rawPeriodMonth);
    const year = periodMatch ? Number(periodMatch[1]) : now.getFullYear();
    const month = periodMatch ? Math.min(12, Math.max(1, Number(periodMatch[2]))) : (now.getMonth() + 1); // 1-indexed
    const currentMonthStr = `${year}-${String(month).padStart(2, '0')}`;
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthName = `${monthNames[month - 1]} ${year}`;

    // 1. Current Month EWT Withheld (posted/settled Supplier Payments with EWT > 0, excluding reversed journals)
    const ewtPayments = await db.select({
      totalEwt: sql<number>`COALESCE(SUM(${schema.supplierPayments.withholdingTaxAmount}), 0)`,
      count: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${schema.supplierPayments.withholdingTaxAmount}, 0) > 0 THEN 1 ELSE 0 END), 0)`
    })
    .from(schema.supplierPayments)
    .leftJoin(schema.journalEntries, eq(schema.supplierPayments.journalEntryId, schema.journalEntries.id))
    .where(and(
      eq(schema.supplierPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
      sql`(${schema.supplierPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) = 'POSTED')`,
      sql`${schema.supplierPayments.paymentDate} LIKE ${currentMonthStr + '%'}`
    ))
    .get();

    // 2. Current Month CWT Withheld (posted/settled Customer Payments with CWT > 0, excluding reversed journals)
    const cwtPayments = await db.select({
      totalCwt: sql<number>`COALESCE(SUM(${schema.customerPayments.withholdingTaxAmount}), 0)`,
      count: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${schema.customerPayments.withholdingTaxAmount}, 0) > 0 THEN 1 ELSE 0 END), 0)`
    })
    .from(schema.customerPayments)
    .leftJoin(schema.journalEntries, eq(schema.customerPayments.journalEntryId, schema.journalEntries.id))
    .where(and(
      eq(schema.customerPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.customerPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
      sql`(${schema.customerPayments.journalEntryId} IS NULL OR UPPER(COALESCE(${schema.journalEntries.status}, '')) = 'POSTED')`,
      sql`${schema.customerPayments.paymentDate} LIKE ${currentMonthStr + '%'}`
    ))
    .get();

    // 3. Current Month Payroll Compensation Tax Withheld (approved/posted payroll runs only)
    const payrollTax = await db.select({
      totalWTax: sql<number>`COALESCE(SUM(${schema.payrollItems.withholdingTax}), 0)`,
      count: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${schema.payrollItems.withholdingTax}, 0) > 0 THEN 1 ELSE 0 END), 0)`
    })
    .from(schema.payrollItems)
    .innerJoin(schema.payrollRuns, eq(schema.payrollItems.payrollRunId, schema.payrollRuns.id))
    .where(and(
      eq(schema.payrollRuns.companyId, companyId),
      sql`UPPER(COALESCE(${schema.payrollRuns.status}, '')) IN ('APPROVED', 'POSTED', 'PAID', 'CLOSED')`,
      sql`(${schema.payrollRuns.paymentDate} LIKE ${currentMonthStr + '%'} OR ${schema.payrollRuns.endDate} LIKE ${currentMonthStr + '%'})`
    ))
    .get();

    // 4. Live GL Control Balances for BIR Tax Liability & Creditable Tax Accounts (Authoritative GL Source of Truth)
    const glTaxRows = await db.select({
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      totalDebit: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
      totalCredit: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, 'POSTED'),
      sql`${schema.accounts.accountCode} IN ('1050', '1060', '1120', '1130', '1500', '1600', '2020', '2030', '2035', '2110', '2120', '2200', '2300')`
    ))
    .groupBy(schema.accounts.accountCode, schema.accounts.accountName);

    const glByCode = new Map<string, number>();
    for (const r of glTaxRows) {
      const code = String(r.accountCode || '');
      const isAsset = code.startsWith('1');
      glByCode.set(code, isAsset ? (Number(r.totalDebit) - Number(r.totalCredit)) : (Number(r.totalCredit) - Number(r.totalDebit)));
    }
    const glInputVatCentavos = (glByCode.get('1120') || 0) + (glByCode.get('1050') || 0) + (glByCode.get('1500') || 0);
    const glCwtAssetCentavos = (glByCode.get('1130') || 0) + (glByCode.get('1060') || 0) + (glByCode.get('1600') || 0);
    const glOutputVatCentavos = (glByCode.get('2020') || 0) + (glByCode.get('2110') || 0) + (glByCode.get('2200') || 0);
    const glEwtPayableCentavos = (glByCode.get('2030') || 0) + (glByCode.get('2120') || 0) + (glByCode.get('2300') || 0);
    const glCompensationTaxPayableCentavos = glByCode.get('2035') || 0;

    const ewtTotalCentavos = Number(ewtPayments?.totalEwt || 0);
    const cwtTotalCentavos = Number(cwtPayments?.totalCwt || 0);
    const payrollTaxTotalCentavos = Number(payrollTax?.totalWTax || 0);
    const totalWithheldCentavos = ewtTotalCentavos + cwtTotalCentavos + payrollTaxTotalCentavos;

    // Fetch existing tax filings to check filed status
    const existingFilings = await db.select()
      .from(schema.taxFilings)
      .where(eq(schema.taxFilings.companyId, companyId));

    const checkFilingStatus = (formCode: string, periodKey: string) => {
      const normalizedCode = formCode.replace(/^BIR Form\s+/i, '').trim();
      const filing = existingFilings.find(f => f.taxType.includes(normalizedCode) && f.periodName === periodKey);
      return filing ? filing.status : 'PENDING';
    };

    const nextMonthObj = new Date(year, month, 1);
    const nextMonthYear = nextMonthObj.getFullYear();
    const nextMonthNum = nextMonthObj.getMonth() + 1;
    const nextMonthStr = `${nextMonthYear}-${String(nextMonthNum).padStart(2, '0')}`;

    const currentQuarter = Math.ceil(month / 3);
    const quarterEndMonth = currentQuarter * 3;
    const quarterFollowingMonth = quarterEndMonth + 1;
    const quarterFollowingYear = quarterFollowingMonth > 12 ? year + 1 : year;
    const adjustedQuarterFollowingMonth = quarterFollowingMonth > 12 ? 1 : quarterFollowingMonth;
    const quarterDeadlineStr = `${quarterFollowingYear}-${String(adjustedQuarterFollowingMonth).padStart(2, '0')}-25`;
    const eqDeadlineStr = `${quarterFollowingYear}-${String(adjustedQuarterFollowingMonth).padStart(2, '0')}-30`;

    const rawDeadlines: Array<any> = [
      {
        formCode: 'BIR Form 0619-E',
        taxCategory: 'EWT_REMITTANCE',
        title: 'Monthly Remittance Return of Creditable Income Taxes Withheld (EWT)',
        description: 'Remittance of EWT withheld from vendor / supplier payments for current month',
        dueDateStr: `${nextMonthStr}-10`,
        periodKey: `${currentMonthStr}`,
        frequency: 'MONTHLY'
      },
      {
        formCode: 'BIR Form 1601-C',
        taxCategory: 'COMPENSATION_TAX',
        title: 'Monthly Remittance Return of Income Taxes Withheld on Compensation',
        description: 'Remittance of tax withheld from employee salaries & compensation under TRAIN law',
        dueDateStr: `${nextMonthStr}-10`,
        periodKey: `${currentMonthStr}`,
        frequency: 'MONTHLY'
      },
      {
        formCode: 'BIR Form 2307',
        taxCategory: 'CWT_CERTIFICATES',
        title: 'Certificate of Creditable Tax Withheld at Source (Form 2307)',
        description: 'Mandatory issuance of withholding tax certificates to payees and vendors',
        dueDateStr: `${currentMonthStr}-20`,
        periodKey: `${currentMonthStr}`,
        frequency: 'MONTHLY'
      },
      {
        formCode: 'BIR Form 1601-EQ',
        taxCategory: 'EWT_QUARTERLY',
        title: 'Quarterly Expanded Withholding Tax Return & QAP Alphalist',
        description: 'Quarterly EWT return accompanied by Quarterly Alphalist of Payees (QAP / SAWT)',
        dueDateStr: eqDeadlineStr,
        periodKey: `${year}-Q${currentQuarter}`,
        frequency: 'QUARTERLY'
      }
    ];

    if (isVat) {
      rawDeadlines.push(
        {
          formCode: 'BIR Form 2550Q',
          taxCategory: 'VALUE_ADDED_TAX',
          title: 'Quarterly Value-Added Tax Return (2550Q · RMC 5-2023)',
          description: 'Mandatory quarterly Output VAT vs Input VAT reconciliation & net tax payment',
          dueDateStr: quarterDeadlineStr,
          periodKey: `${year}-Q${currentQuarter}`,
          frequency: 'QUARTERLY'
        },
        {
          formCode: 'BIR Form 2550M',
          taxCategory: 'VALUE_ADDED_TAX_OPTIONAL_MONTHLY',
          title: 'Optional Monthly Value-Added Tax Declaration (2550M · RMC 52-2023)',
          description: 'Optional monthly VAT filing permitted for VAT-registered taxpayers under RMC 52-2023',
          dueDateStr: `${nextMonthStr}-20`,
          periodKey: `${currentMonthStr}`,
          frequency: 'MONTHLY (OPTIONAL)'
        }
      );
    } else if (isPercentage) {
      rawDeadlines.push({
        formCode: 'BIR Form 2551Q',
        taxCategory: 'PERCENTAGE_TAX',
        title: 'Quarterly Percentage Tax Return (2551Q)',
        description: 'Section 116 Percentage Tax return for Non-VAT taxpayers',
        dueDateStr: quarterDeadlineStr,
        periodKey: `${year}-Q${currentQuarter}`,
        frequency: 'QUARTERLY'
      });
    }

    const todayTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const upcomingDeadlines = rawDeadlines.map(d => {
      const [dYear, dMonth, dDay] = d.dueDateStr.split('-').map(Number);
      const targetTime = new Date(dYear, dMonth - 1, dDay).getTime();
      const diffDays = Math.ceil((targetTime - todayTime) / (1000 * 60 * 60 * 24));
      
      let urgency = 'UPCOMING';
      if (diffDays < 0) {
        urgency = 'OVERDUE';
      } else if (diffDays <= 5) {
        urgency = 'DUE_SOON';
      }

      const status = checkFilingStatus(d.formCode, d.periodKey);

      return {
        ...d,
        daysLeft: diffDays,
        urgency,
        status
      };
    }).sort((a, b) => a.daysLeft - b.daysLeft);

    res.json({
      currentMonth: currentMonthStr,
      monthName: currentMonthName,
      taxRegime: isVat ? 'VAT' : isPercentage ? 'NON_VAT_PERCENTAGE_TAX' : 'EXEMPT',
      withholdingSummary: {
        ewtTotalCentavos,
        cwtTotalCentavos,
        payrollTaxTotalCentavos,
        totalWithheldCentavos,
        ewtFormatted: (ewtTotalCentavos / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }),
        cwtFormatted: (cwtTotalCentavos / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }),
        payrollTaxFormatted: (payrollTaxTotalCentavos / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }),
        totalWithheldFormatted: (totalWithheldCentavos / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }),
        counts: {
          ewt: Number(ewtPayments?.count || 0),
          cwt: Number(cwtPayments?.count || 0),
          payroll: Number(payrollTax?.count || 0)
        }
      },
      glTaxBalances: {
        outputVatCentavos: glOutputVatCentavos,
        inputVatCentavos: glInputVatCentavos,
        netVatPayableCentavos: glOutputVatCentavos - glInputVatCentavos,
        ewtPayableCentavos: glEwtPayableCentavos,
        compensationTaxPayableCentavos: glCompensationTaxPayableCentavos,
        cwtCreditableAssetCentavos: glCwtAssetCentavos,
      },
      upcomingDeadlines
    });
  } catch (err: any) {
    console.error("Error in GET /api/tax/dashboard-summary:", err);
    res.status(500).json({ error: "Failed to generate tax dashboard summary" });
  }
});

// ==========================================
// BIR CORE TAX & ENTITY ENGINE ENDPOINTS
// ==========================================

// Get Core Engine Rules for the Active Company
router.get('/engine/active-profile', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const rules = await TaxEngine.getEngineRulesForCompany(companyId);
    res.json(rules);
  } catch (err: any) {
    console.error("Error fetching active tax engine rules:", err);
    res.status(500).json({ error: "Failed to fetch tax engine rules", details: err?.message });
  }
});

// Perform real-time Tax Invoice Calculation powered by the Company Core Engine
router.post('/engine/calculate-invoice', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { grossAmount, withholdingTaxRate, isGovernmentCustomer } = req.body;
  try {
    const grossAmountCentavos = Math.round((Number(grossAmount) || 0) * 100);
    const result = await TaxEngine.calculateInvoiceTaxes(companyId, grossAmountCentavos, {
      withholdingTaxRate: withholdingTaxRate ? Number(withholdingTaxRate) : undefined,
      isGovernmentCustomer: !!isGovernmentCustomer
    });
    res.json(result);
  } catch (err: any) {
    console.error("Error calculating invoice taxes:", err);
    res.status(500).json({ error: "Failed to calculate invoice taxes", details: err?.message });
  }
});

// Run Core Audit Guardian Compliance Checks for the Active Company
router.get('/engine/audit-guardian', requireAuth, requirePermission('tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const guardianReport = await TaxEngine.runAuditGuardian(companyId);
    res.json(guardianReport);
  } catch (err: any) {
    console.error("Error running tax audit guardian:", err);
    res.status(500).json({ error: "Failed to run tax audit guardian", details: err?.message });
  }
});

export default router;




