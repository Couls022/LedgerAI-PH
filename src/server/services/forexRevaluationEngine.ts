import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, desc, lte, inArray, sql } from "drizzle-orm";
import crypto from "crypto";
import { AccountingEngine, JournalLineInput } from "./accountingEngine";
import {
  DomainError,
  validateTransactionDateAndPeriod,
  assertNoDuplicateSourceJournal,
  reverseJournalEntry as domainReverseJournalEntry,
} from "../db/domain";
import { AuditService } from "./auditService";

export interface FxCalculationResult {
  foreignAmount: number;
  recordedRate: number;
  settlementRate: number;
  recordedAmountPhp: number;
  settlementAmountPhp: number;
  variancePhp: number;
  realizedGainPhp: number;
  realizedLossPhp: number;
  isGain: boolean;
  complianceNote: string;
}

export interface FxMonetaryAccountInfo {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  detailType: string | null;
  normalBalance: string;
  currency: string;
  bankId: string | null;
  bankName: string | null;
  carryingPhpCentavos: number; // Signed debit - credit
  carryingPhpDisplay: number;  // Unsigned display magnitude relative to normal balance
}

export interface FxExposureInput {
  accountId: string;
  foreignBalance: number;
  currency?: string;
}

export interface FxRevaluationLinePreview {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  currency: string;
  foreignBalance: number | null;
  carryingSignedCentavos: number;
  carryingPhp: number;
  targetSignedCentavos: number | null;
  revaluedPhp: number | null;
  adjustmentSignedCentavos: number;
  unrealizedGainCentavos: number;
  unrealizedLossCentavos: number;
  requiresForeignBalanceInput: boolean;
}

export interface FxPeriodEndPreviewResult {
  companyId: string;
  accountingPeriodId: string | null;
  accountingPeriodName: string | null;
  accountingPeriodStatus: string | null;
  revaluationDate: string;
  baseCurrency: string;
  targetCurrency: string;
  closingSpotRate: number;
  rateDate: string;
  rateSource: string;
  existingPostedRunId: string | null;
  existingPostedRunStatus: string | null;
  totalCarryingPhpCentavos: number;
  totalRevaluedPhpCentavos: number;
  totalGainCentavos: number;
  totalLossCentavos: number;
  netGainLossCentavos: number;
  isTaxableInItr: boolean;
  birComplianceNote: string;
  lines: FxRevaluationLinePreview[];
}

const BALANCE_SHEET_MONETARY_TYPES = new Set([
  "ASSET",
  "RECEIVABLE",
  "OTHER_CURRENT_ASSET",
  "LIABILITY",
  "PAYABLE",
  "OTHER_CURRENT_LIABILITY",
  "LONG_TERM_LIABILITY",
]);

export class ForexRevaluationEngine {
  /**
   * Ensure FX Revaluation schema tables and accounts.currency column exist idempotently.
   */
  static ensureFxTables(): void {
    try {
      const tableInfo = db.all(sql`PRAGMA table_info('accounts')`) as Array<{ name: string }>;
      if (!tableInfo.some((c) => c.name === "currency")) {
        db.run(sql.raw(`ALTER TABLE accounts ADD COLUMN currency TEXT DEFAULT 'PHP' NOT NULL;`));
      }
    } catch (_) {}

    try {
      db.run(
        sql.raw(`
          CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
            id TEXT PRIMARY KEY NOT NULL,
            company_id TEXT NOT NULL REFERENCES companies(id),
            accounting_period_id TEXT REFERENCES accounting_periods(id),
            revaluation_date TEXT NOT NULL,
            base_currency TEXT NOT NULL DEFAULT 'PHP',
            target_currency TEXT NOT NULL,
            closing_spot_rate REAL NOT NULL,
            rate_date TEXT NOT NULL,
            rate_source TEXT NOT NULL DEFAULT 'BSP',
            status TEXT NOT NULL DEFAULT 'PREVIEW',
            total_carrying_php_centavos INTEGER NOT NULL DEFAULT 0,
            total_revalued_php_centavos INTEGER NOT NULL DEFAULT 0,
            total_gain_centavos INTEGER NOT NULL DEFAULT 0,
            total_loss_centavos INTEGER NOT NULL DEFAULT 0,
            net_gain_loss_centavos INTEGER NOT NULL DEFAULT 0,
            unrealized_journal_id TEXT REFERENCES journal_entries(id),
            reversal_journal_id TEXT REFERENCES journal_entries(id),
            auto_reverse_date TEXT,
            details_json TEXT NOT NULL,
            notes TEXT,
            created_by TEXT REFERENCES users(id),
            posted_by TEXT REFERENCES users(id),
            posted_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          );
        `)
      );
      db.run(
        sql.raw(`
          CREATE INDEX IF NOT EXISTS idx_fx_reval_runs_company_period
            ON fx_revaluation_runs(company_id, accounting_period_id, target_currency);
        `)
      );
      db.run(
        sql.raw(`
          CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup
            ON currency_exchange_rates(company_id, currency, rate_date DESC);
        `)
      );
    } catch (_) {}
  }

  /**
   * Fetch BSP/BAP Spot Rate for a given currency and date (fail-closed: never fabricates fake rates).
   */
  static async getBspSpotRateDetails(
    companyId: string,
    currency: string = "USD",
    rateDate?: string
  ): Promise<{ rate: number; rateDate: string; source: string }> {
    const normalizedCurrency = String(currency || "USD").trim().toUpperCase();
    if (!normalizedCurrency || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      throw new DomainError(
        `Invalid ISO currency code '${currency}'. Expected 3-letter currency code (e.g. USD, EUR, JPY).`,
        "INVALID_CURRENCY_CODE",
        400
      );
    }

    if (normalizedCurrency === "PHP") {
      return {
        rate: 1,
        rateDate: rateDate ? rateDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
        source: "FUNCTIONAL_CURRENCY",
      };
    }

    const effectiveDate = rateDate ? String(rateDate).slice(0, 10) : undefined;

    if (effectiveDate) {
      const exactRecord = await db
        .select()
        .from(schema.currencyExchangeRates)
        .where(
          and(
            eq(schema.currencyExchangeRates.companyId, companyId),
            eq(schema.currencyExchangeRates.currency, normalizedCurrency),
            eq(schema.currencyExchangeRates.rateDate, effectiveDate)
          )
        )
        .orderBy(desc(schema.currencyExchangeRates.createdAt))
        .limit(1);

      if (exactRecord.length > 0 && Number.isFinite(exactRecord[0].bspSpotRate) && exactRecord[0].bspSpotRate > 0) {
        return {
          rate: Number(exactRecord[0].bspSpotRate),
          rateDate: exactRecord[0].rateDate,
          source: exactRecord[0].source || "BSP",
        };
      }

      const priorRecord = await db
        .select()
        .from(schema.currencyExchangeRates)
        .where(
          and(
            eq(schema.currencyExchangeRates.companyId, companyId),
            eq(schema.currencyExchangeRates.currency, normalizedCurrency),
            lte(schema.currencyExchangeRates.rateDate, effectiveDate)
          )
        )
        .orderBy(desc(schema.currencyExchangeRates.rateDate), desc(schema.currencyExchangeRates.createdAt))
        .limit(1);

      if (priorRecord.length > 0 && Number.isFinite(priorRecord[0].bspSpotRate) && priorRecord[0].bspSpotRate > 0) {
        return {
          rate: Number(priorRecord[0].bspSpotRate),
          rateDate: priorRecord[0].rateDate,
          source: priorRecord[0].source || "BSP",
        };
      }
    } else {
      const latestRecord = await db
        .select()
        .from(schema.currencyExchangeRates)
        .where(
          and(
            eq(schema.currencyExchangeRates.companyId, companyId),
            eq(schema.currencyExchangeRates.currency, normalizedCurrency)
          )
        )
        .orderBy(desc(schema.currencyExchangeRates.rateDate), desc(schema.currencyExchangeRates.createdAt))
        .limit(1);

      if (latestRecord.length > 0 && Number.isFinite(latestRecord[0].bspSpotRate) && latestRecord[0].bspSpotRate > 0) {
        return {
          rate: Number(latestRecord[0].bspSpotRate),
          rateDate: latestRecord[0].rateDate,
          source: latestRecord[0].source || "BSP",
        };
      }
    }

    throw new DomainError(
      `No official BSP/BAP spot rate found for ${normalizedCurrency}${effectiveDate ? ` on or before ${effectiveDate}` : ""}. Record an official BSP exchange rate before computing or posting FX valuations.`,
      "BSP_SPOT_RATE_NOT_FOUND",
      400,
      { currency: normalizedCurrency, rateDate: effectiveDate || null }
    );
  }

  static async getBspSpotRate(
    companyId: string,
    currency: string = "USD",
    rateDate?: string
  ): Promise<number> {
    const details = await this.getBspSpotRateDetails(companyId, currency, rateDate);
    return details.rate;
  }

  /**
   * Calculate realized FX Gain / Loss in compliance with BIR RMC 12-2024.
   * BIR RMC 12-2024 mandates explicit separation of Realized FX Gains (Other Income)
   * and Realized FX Losses (Operating Expense) using the official BSP Spot Rate on transaction date.
   */
  static calculateRealizedFx(
    foreignAmount: number,
    recordedRate: number,
    settlementRate: number
  ): FxCalculationResult {
    if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) {
      throw new DomainError("Foreign currency amount must be a positive finite number.", "INVALID_FOREX_INPUT", 400);
    }
    if (!Number.isFinite(recordedRate) || recordedRate <= 0) {
      throw new DomainError("Recorded BSP spot rate must be a positive finite number.", "INVALID_FOREX_INPUT", 400);
    }
    if (!Number.isFinite(settlementRate) || settlementRate <= 0) {
      throw new DomainError("Settlement BSP spot rate must be a positive finite number.", "INVALID_FOREX_INPUT", 400);
    }

    const recordedAmountPhp = Math.round(foreignAmount * recordedRate * 100) / 100;
    const settlementAmountPhp = Math.round(foreignAmount * settlementRate * 100) / 100;
    const variancePhp = Math.round((settlementAmountPhp - recordedAmountPhp) * 100) / 100;

    const isGain = variancePhp >= 0;
    const realizedGainPhp = isGain ? variancePhp : 0;
    const realizedLossPhp = !isGain ? Math.abs(variancePhp) : 0;

    return {
      foreignAmount,
      recordedRate,
      settlementRate,
      recordedAmountPhp,
      settlementAmountPhp,
      variancePhp,
      realizedGainPhp,
      realizedLossPhp,
      isGain,
      complianceNote: "BIR RMC 12-2024: Realized FX difference recorded using official BSP/BAP Spot Rate.",
    };
  }

  /**
   * Resolve active Unrealized FX Gain & Unrealized FX Loss GL accounts via metadata first,
   * creating canonical 4910 / 6910 defaults only if missing.
   */
  static async resolveUnrealizedFxAccounts(companyId: string, dbClient: any = db) {
    const existing = await dbClient
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));

    const parentIds = new Set(
      existing.filter((a: any) => a.parentAccountId).map((a: any) => String(a.parentAccountId))
    );
    const activeEligible = existing.filter(
      (a: any) => String(a.status || "ACTIVE").toUpperCase() === "ACTIVE" && !parentIds.has(a.id)
    );

    let gainAcc =
      activeEligible.find((a: any) => String(a.detailType || "").toUpperCase() === "UNREALIZED_FX_GAIN") ||
      activeEligible.find((a: any) => /unrealized.*(fx|forex|foreign exchange).*gain/i.test(a.accountName)) ||
      activeEligible.find((a: any) => a.accountCode === "4910");

    let lossAcc =
      activeEligible.find((a: any) => String(a.detailType || "").toUpperCase() === "UNREALIZED_FX_LOSS") ||
      activeEligible.find((a: any) => /unrealized.*(fx|forex|foreign exchange).*loss/i.test(a.accountName)) ||
      activeEligible.find((a: any) => a.accountCode === "6910");

    if (!gainAcc || !lossAcc) {
      const defaults = await AccountingEngine.ensureDefaultAccounts(companyId, dbClient);
      if (!gainAcc) gainAcc = defaults["4910"];
      if (!lossAcc) lossAcc = defaults["6910"];
    }

    return { gainAccount: gainAcc, lossAccount: lossAcc };
  }

  /**
   * Resolve active Realized FX Gain & Realized FX Loss GL accounts via metadata first.
   */
  static async resolveRealizedFxAccounts(companyId: string, dbClient: any = db) {
    const existing = await dbClient
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));

    const parentIds = new Set(
      existing.filter((a: any) => a.parentAccountId).map((a: any) => String(a.parentAccountId))
    );
    const activeEligible = existing.filter(
      (a: any) => String(a.status || "ACTIVE").toUpperCase() === "ACTIVE" && !parentIds.has(a.id)
    );

    let gainAcc =
      activeEligible.find((a: any) => String(a.detailType || "").toUpperCase() === "FOREX_GAIN") ||
      activeEligible.find((a: any) => /^realized.*(fx|forex|foreign exchange).*gain/i.test(a.accountName)) ||
      activeEligible.find((a: any) => a.accountCode === "4900");

    let lossAcc =
      activeEligible.find((a: any) => String(a.detailType || "").toUpperCase() === "FOREX_LOSS") ||
      activeEligible.find((a: any) => /^realized.*(fx|forex|foreign exchange).*loss/i.test(a.accountName)) ||
      activeEligible.find((a: any) => a.accountCode === "6900");

    if (!gainAcc || !lossAcc) {
      const defaults = await AccountingEngine.ensureDefaultAccounts(companyId, dbClient);
      if (!gainAcc) gainAcc = defaults["4900"];
      if (!lossAcc) lossAcc = defaults["6900"];
    }

    return { gainAccount: gainAcc, lossAccount: lossAcc };
  }

  /**
   * Discover foreign-currency monetary GL accounts and compute authoritative GL carrying balances.
   */
  static async listForeignMonetaryAccounts(
    companyId: string,
    options?: { asOfDate?: string; currency?: string }
  ): Promise<FxMonetaryAccountInfo[]> {
    this.ensureFxTables();
    const asOfDate = options?.asOfDate ? String(options.asOfDate).slice(0, 10) : undefined;
    const filterCurrency = options?.currency ? String(options.currency).trim().toUpperCase() : undefined;

    const allAccounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));

    const parentIds = new Set(
      allAccounts.filter((a: any) => a.parentAccountId).map((a: any) => String(a.parentAccountId))
    );

    const bankRecords = await db
      .select()
      .from(schema.banks)
      .where(eq(schema.banks.companyId, companyId));
    const fxBankByGlId = new Map<string, typeof schema.banks.$inferSelect>();
    for (const b of bankRecords) {
      if (b.glAccountId && String(b.status || "ACTIVE").toUpperCase() === "ACTIVE" && String(b.currency || "PHP").toUpperCase() !== "PHP") {
        fxBankByGlId.set(b.glAccountId, b);
      }
    }

    const fxAccounts = allAccounts.filter((acc: any) => {
      if (String(acc.status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
      if (parentIds.has(acc.id)) return false;
      if (!BALANCE_SHEET_MONETARY_TYPES.has(String(acc.accountType || "").toUpperCase())) return false;

      const linkedBank = fxBankByGlId.get(acc.id);
      const effectiveCurrency = String(
        (acc.currency && acc.currency !== "PHP" ? acc.currency : null) ||
          linkedBank?.currency ||
          (String(acc.detailType || "").toUpperCase() === "DOLLAR_ACCOUNT" ? "USD" : "PHP")
      ).toUpperCase();

      if (effectiveCurrency === "PHP") return false;
      if (filterCurrency && effectiveCurrency !== filterCurrency) return false;
      return true;
    });

    if (fxAccounts.length === 0) return [];

    const accountIds = fxAccounts.map((a) => a.id);
    const postedEntriesQuery = db
      .select({
        accountId: schema.journalLines.accountId,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        entryDate: schema.journalEntries.entryDate,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          inArray(schema.journalLines.accountId, accountIds),
          inArray(schema.journalEntries.status, ["POSTED", "REVERSED"])
        )
      );

    const rows = await postedEntriesQuery;
    const netByAccount = new Map<string, number>();
    for (const r of rows) {
      if (asOfDate && r.entryDate > asOfDate) continue;
      netByAccount.set(r.accountId, (netByAccount.get(r.accountId) || 0) + Number(r.debit || 0) - Number(r.credit || 0));
    }

    return fxAccounts.map((acc: any) => {
      const linkedBank = fxBankByGlId.get(acc.id);
      const effectiveCurrency = String(
        (acc.currency && acc.currency !== "PHP" ? acc.currency : null) ||
          linkedBank?.currency ||
          (String(acc.detailType || "").toUpperCase() === "DOLLAR_ACCOUNT" ? "USD" : "USD")
      ).toUpperCase();
      const carryingSigned = netByAccount.get(acc.id) || 0;
      const normal = String(acc.normalBalance || "DEBIT").toUpperCase();
      const displayMagnitude = normal === "CREDIT" ? -carryingSigned : carryingSigned;

      return {
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        detailType: acc.detailType || null,
        normalBalance: normal,
        currency: effectiveCurrency,
        bankId: linkedBank?.id || null,
        bankName: linkedBank?.bankName || null,
        carryingPhpCentavos: carryingSigned,
        carryingPhpDisplay: displayMagnitude,
      };
    });
  }

  /**
   * Preview Period-End Unrealized FX Revaluation (PAS 21 / BIR RMC 12-2024).
   */
  static async previewPeriodEndRevaluation(
    companyId: string,
    params: {
      accountingPeriodId?: string;
      revaluationDate?: string;
      currency?: string;
      closingSpotRate?: number;
      rateSource?: string;
      exposures?: FxExposureInput[];
    }
  ): Promise<FxPeriodEndPreviewResult> {
    this.ensureFxTables();
    const targetCurrency = String(params.currency || "USD").trim().toUpperCase();
    if (!targetCurrency || targetCurrency === "PHP" || !/^[A-Z]{3}$/.test(targetCurrency)) {
      throw new DomainError(
        `Target currency for FX revaluation must be a valid 3-letter foreign currency (not PHP). Received '${params.currency}'.`,
        "INVALID_CURRENCY_CODE",
        400
      );
    }

    let period: typeof schema.accountingPeriods.$inferSelect | undefined;
    if (params.accountingPeriodId) {
      period = await db
        .select()
        .from(schema.accountingPeriods)
        .where(
          and(
            eq(schema.accountingPeriods.id, params.accountingPeriodId),
            eq(schema.accountingPeriods.companyId, companyId)
          )
        )
        .get();
      if (!period) {
        throw new DomainError("Accounting period not found for company.", "PERIOD_NOT_FOUND", 404);
      }
    }

    const revaluationDate = String(
      params.revaluationDate || period?.endDate || new Date().toISOString().slice(0, 10)
    ).slice(0, 10);

    if (!period) {
      const allPeriods = await db
        .select()
        .from(schema.accountingPeriods)
        .where(eq(schema.accountingPeriods.companyId, companyId));
      period = allPeriods.find((p) => p.startDate <= revaluationDate && p.endDate >= revaluationDate);
    } else if (revaluationDate < period.startDate || revaluationDate > period.endDate) {
      throw new DomainError(
        `Revaluation date (${revaluationDate}) must fall within accounting period '${period.name}' (${period.startDate} to ${period.endDate}).`,
        "PERIOD_DATE_MISMATCH",
        400
      );
    }

    // Determine authoritative BSP closing spot rate (fail-closed if unrecorded and not explicitly supplied)
    let closingSpotRate: number;
    let rateDate = revaluationDate;
    let rateSource = params.rateSource || "BSP";

    if (params.closingSpotRate !== undefined && params.closingSpotRate !== null && String(params.closingSpotRate) !== "") {
      const parsedRate = Number(params.closingSpotRate);
      if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
        throw new DomainError("Closing BSP spot rate must be a positive finite number.", "INVALID_FOREX_INPUT", 400);
      }
      closingSpotRate = parsedRate;
    } else {
      const rateDetails = await this.getBspSpotRateDetails(companyId, targetCurrency, revaluationDate);
      closingSpotRate = rateDetails.rate;
      rateDate = rateDetails.rateDate;
      rateSource = rateDetails.source;
    }

    // Resolve accounts & balances
    const allCompanyAccounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));
    const parentIds = new Set(
      allCompanyAccounts.filter((a) => a.parentAccountId).map((a) => String(a.parentAccountId))
    );
    const accountById = new Map<string, typeof schema.accounts.$inferSelect>(
      allCompanyAccounts.map((a) => [a.id, a])
    );

    const discovered = await this.listForeignMonetaryAccounts(companyId, {
      asOfDate: revaluationDate,
      currency: targetCurrency,
    });
    const discoveredMap = new Map<string, FxMonetaryAccountInfo>(
      discovered.map((d) => [d.accountId, d])
    );

    const exposureMap = new Map<string, FxExposureInput>();
    if (Array.isArray(params.exposures) && params.exposures.length > 0) {
      for (const exp of params.exposures) {
        const acc = accountById.get(exp.accountId);
        if (!acc) {
          throw new DomainError(`FX exposure account '${exp.accountId}' not found in company.`, "ACCOUNT_NOT_FOUND", 400);
        }
        if (String(acc.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
          throw new DomainError(`FX exposure account '${acc.accountCode} - ${acc.accountName}' is not ACTIVE.`, "INACTIVE_ACCOUNT", 400);
        }
        if (parentIds.has(acc.id)) {
          throw new DomainError(`Parent header account '${acc.accountCode} - ${acc.accountName}' cannot be directly revalued.`, "PARENT_HEADER_ACCOUNT_POSTING_PROHIBITED", 400);
        }
        const foreignVal = Number(exp.foreignBalance);
        if (!Number.isFinite(foreignVal)) {
          throw new DomainError(`Foreign balance for account '${acc.accountCode}' must be a valid finite number.`, "INVALID_FOREX_INPUT", 400);
        }
        exposureMap.set(acc.id, {
          accountId: acc.id,
          foreignBalance: foreignVal,
          currency: (exp.currency || targetCurrency).toUpperCase(),
        });
      }
    }

    const targetAccountIds = Array.from(
      new Set<string>([...discovered.map((d) => d.accountId), ...Array.from(exposureMap.keys())])
    );

    // Fetch carrying PHP balances for any explicitly passed exposure accounts not already in discoveredMap
    const missingFromDiscovered = targetAccountIds.filter((id) => !discoveredMap.has(id));
    const extraCarryingMap = new Map<string, number>();
    if (missingFromDiscovered.length > 0) {
      const extraRows = await db
        .select({
          accountId: schema.journalLines.accountId,
          debit: schema.journalLines.debit,
          credit: schema.journalLines.credit,
          entryDate: schema.journalEntries.entryDate,
        })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
        .where(
          and(
            eq(schema.journalEntries.companyId, companyId),
            inArray(schema.journalLines.accountId, missingFromDiscovered),
            inArray(schema.journalEntries.status, ["POSTED", "REVERSED"])
          )
        );
      for (const r of extraRows) {
        if (r.entryDate <= revaluationDate) {
          extraCarryingMap.set(r.accountId, (extraCarryingMap.get(r.accountId) || 0) + Number(r.debit || 0) - Number(r.credit || 0));
        }
      }
    }

    const lines: FxRevaluationLinePreview[] = [];
    let totalCarryingPhpCentavos = 0;
    let totalRevaluedPhpCentavos = 0;
    let totalGainCentavos = 0;
    let totalLossCentavos = 0;

    for (const accId of targetAccountIds) {
      const acc = accountById.get(accId)!;
      const disc = discoveredMap.get(accId);
      const exp = exposureMap.get(accId);
      const normal = String(acc.normalBalance || "DEBIT").toUpperCase();
      const carryingSigned = disc ? disc.carryingPhpCentavos : (extraCarryingMap.get(accId) || 0);
      const carryingPhp = (normal === "CREDIT" ? -carryingSigned : carryingSigned) / 100;

      if (!exp || exp.foreignBalance === undefined || exp.foreignBalance === null) {
        lines.push({
          accountId: acc.id,
          accountCode: acc.accountCode,
          accountName: acc.accountName,
          accountType: acc.accountType,
          normalBalance: normal,
          currency: disc?.currency || targetCurrency,
          foreignBalance: null,
          carryingSignedCentavos: carryingSigned,
          carryingPhp,
          targetSignedCentavos: null,
          revaluedPhp: null,
          adjustmentSignedCentavos: 0,
          unrealizedGainCentavos: 0,
          unrealizedLossCentavos: 0,
          requiresForeignBalanceInput: true,
        });
        continue;
      }

      const directionSign = normal === "CREDIT" ? -1 : 1;
      const targetSignedCentavos = Math.round(directionSign * exp.foreignBalance * closingSpotRate * 100);
      const adjustmentSignedCentavos = targetSignedCentavos - carryingSigned;
      const unrealizedGainCentavos = adjustmentSignedCentavos > 0 ? adjustmentSignedCentavos : 0;
      const unrealizedLossCentavos = adjustmentSignedCentavos < 0 ? Math.abs(adjustmentSignedCentavos) : 0;

      totalCarryingPhpCentavos += Math.abs(carryingSigned);
      totalRevaluedPhpCentavos += Math.abs(targetSignedCentavos);
      totalGainCentavos += unrealizedGainCentavos;
      totalLossCentavos += unrealizedLossCentavos;

      lines.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        normalBalance: normal,
        currency: exp.currency || targetCurrency,
        foreignBalance: exp.foreignBalance,
        carryingSignedCentavos: carryingSigned,
        carryingPhp,
        targetSignedCentavos,
        revaluedPhp: Math.round(exp.foreignBalance * closingSpotRate * 100) / 100,
        adjustmentSignedCentavos,
        unrealizedGainCentavos,
        unrealizedLossCentavos,
        requiresForeignBalanceInput: false,
      });
    }

    let existingPostedRun: typeof schema.fxRevaluationRuns.$inferSelect | undefined;
    if (period) {
      const existingRuns = await db
        .select()
        .from(schema.fxRevaluationRuns)
        .where(
          and(
            eq(schema.fxRevaluationRuns.companyId, companyId),
            eq(schema.fxRevaluationRuns.accountingPeriodId, period.id),
            eq(schema.fxRevaluationRuns.targetCurrency, targetCurrency)
          )
        )
        .orderBy(desc(schema.fxRevaluationRuns.createdAt));
      existingPostedRun = existingRuns.find((r) => r.status === "POSTED" || r.status === "AUTO_REVERSED");
    }

    return {
      companyId,
      accountingPeriodId: period?.id || null,
      accountingPeriodName: period?.name || null,
      accountingPeriodStatus: period?.status || null,
      revaluationDate,
      baseCurrency: "PHP",
      targetCurrency,
      closingSpotRate,
      rateDate,
      rateSource,
      existingPostedRunId: existingPostedRun?.id || null,
      existingPostedRunStatus: existingPostedRun?.status || null,
      totalCarryingPhpCentavos,
      totalRevaluedPhpCentavos,
      totalGainCentavos,
      totalLossCentavos,
      netGainLossCentavos: totalGainCentavos - totalLossCentavos,
      isTaxableInItr: false,
      birComplianceNote:
        "BIR RMC 12-2024 & PAS 21: Period-end unrealized FX gains/losses adjust monetary asset/liability carrying values to the closing BSP spot rate and are EXCLUDED from taxable income/deductions on the Income Tax Return until realized.",
      lines,
    };
  }

  /**
   * Post Period-End Unrealized FX Revaluation Journal Entry + optional Next-Period Auto-Reversal.
   */
  static async postPeriodEndRevaluation(
    companyId: string,
    userId: string,
    params: {
      accountingPeriodId?: string;
      revaluationDate?: string;
      currency?: string;
      closingSpotRate?: number;
      rateSource?: string;
      exposures: FxExposureInput[];
      autoReverse?: boolean;
      autoReverseDate?: string;
      notes?: string;
      userRole?: string;
    }
  ) {
    this.ensureFxTables();
    if (!Array.isArray(params.exposures) || params.exposures.length === 0) {
      throw new DomainError(
        "At least one foreign-currency monetary account exposure is required to post period-end revaluation.",
        "MISSING_FX_EXPOSURES",
        400
      );
    }

    const preview = await this.previewPeriodEndRevaluation(companyId, {
      accountingPeriodId: params.accountingPeriodId,
      revaluationDate: params.revaluationDate,
      currency: params.currency,
      closingSpotRate: params.closingSpotRate,
      rateSource: params.rateSource,
      exposures: params.exposures,
    });

    // Fail-closed period validation on revaluationDate
    const validatedPeriod = await validateTransactionDateAndPeriod(companyId, preview.revaluationDate, {
      userRole: params.userRole,
    });

    // Prevent duplicate active period-end revaluation for same period + currency
    if (preview.existingPostedRunId) {
      throw new DomainError(
        `Period '${validatedPeriod.name}' already has an active posted ${preview.targetCurrency} revaluation run (${preview.existingPostedRunId}). Reverse the existing run before re-posting.`,
        "DUPLICATE_FX_REVALUATION_RUN",
        409,
        { existingRunId: preview.existingPostedRunId }
      );
    }

    const activeLines = preview.lines.filter((l) => !l.requiresForeignBalanceInput && l.adjustmentSignedCentavos !== 0);
    if (activeLines.length === 0 || (preview.totalGainCentavos === 0 && preview.totalLossCentavos === 0)) {
      throw new DomainError(
        "No unrealized FX revaluation variance detected between carrying PHP balances and closing BSP spot rate.",
        "NO_FX_VARIANCE",
        400
      );
    }

    // Validate autoReverseDate upfront if requested
    let autoReverseDate: string | null = null;
    if (params.autoReverse) {
      if (!params.autoReverseDate) {
        const d = new Date(`${preview.revaluationDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        autoReverseDate = d.toISOString().slice(0, 10);
      } else {
        autoReverseDate = String(params.autoReverseDate).slice(0, 10);
      }
      if (autoReverseDate <= preview.revaluationDate) {
        throw new DomainError(
          `Auto-reversal date (${autoReverseDate}) must be after revaluation date (${preview.revaluationDate}).`,
          "INVALID_AUTO_REVERSE_DATE",
          400
        );
      }
      await validateTransactionDateAndPeriod(companyId, autoReverseDate, {
        userRole: params.userRole,
      });
    }

    const { gainAccount, lossAccount } = await this.resolveUnrealizedFxAccounts(companyId);
    const jeLines: JournalLineInput[] = [];

    for (const line of activeLines) {
      if (line.adjustmentSignedCentavos > 0) {
        jeLines.push({
          accountId: line.accountId,
          debit: line.adjustmentSignedCentavos,
          credit: 0,
          description: `PAS 21 Revaluation (${line.currency} @ ${preview.closingSpotRate}) - ${line.accountCode} ${line.accountName}`,
        });
      } else {
        jeLines.push({
          accountId: line.accountId,
          debit: 0,
          credit: Math.abs(line.adjustmentSignedCentavos),
          description: `PAS 21 Revaluation (${line.currency} @ ${preview.closingSpotRate}) - ${line.accountCode} ${line.accountName}`,
        });
      }
    }

    if (preview.totalGainCentavos > 0) {
      jeLines.push({
        accountId: gainAccount.id,
        debit: 0,
        credit: preview.totalGainCentavos,
        description: `BIR RMC 12-2024 Unrealized FX Gain (${preview.targetCurrency} @ ${preview.closingSpotRate} on ${preview.revaluationDate})`,
      });
    }
    if (preview.totalLossCentavos > 0) {
      jeLines.push({
        accountId: lossAccount.id,
        debit: preview.totalLossCentavos,
        credit: 0,
        description: `BIR RMC 12-2024 Unrealized FX Loss (${preview.targetCurrency} @ ${preview.closingSpotRate} on ${preview.revaluationDate})`,
      });
    }

    const runId = `fxr-${crypto.randomUUID().slice(0, 12)}`;
    const journalNumber = `JE-FXR-${preview.targetCurrency}-${preview.revaluationDate.replace(/-/g, "")}-${runId.slice(-4).toUpperCase()}`;

    const unrealizedJournalId = await AccountingEngine.postBalancedJournalEntry(
      companyId,
      {
        journalNumber,
        entryDate: preview.revaluationDate,
        description: `Period-End Unrealized FX Revaluation (${preview.targetCurrency} @ ₱${preview.closingSpotRate}, Period: ${validatedPeriod.name})`,
        sourceType: "fx_revaluation_runs",
        sourceId: runId,
        createdBy: userId,
        userRole: params.userRole,
      },
      jeLines
    );

    let reversalJournalId: string | null = null;
    if (params.autoReverse && autoReverseDate) {
      const revLines: JournalLineInput[] = jeLines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: `Auto-Reversal of Unrealized FX (${journalNumber})`,
      }));
      reversalJournalId = await AccountingEngine.postBalancedJournalEntry(
        companyId,
        {
          journalNumber: `${journalNumber}-AUTOREV`,
          entryDate: autoReverseDate,
          description: `Next-Period Auto-Reversal of Period-End Unrealized FX (${journalNumber})`,
          sourceType: "fx_revaluation_auto_reversal",
          sourceId: runId,
          createdBy: userId,
          userRole: params.userRole,
        },
        revLines
      );
    }

    const finalStatus = reversalJournalId ? "AUTO_REVERSED" : "POSTED";
    await db.insert(schema.fxRevaluationRuns).values({
      id: runId,
      companyId,
      accountingPeriodId: validatedPeriod.id,
      revaluationDate: preview.revaluationDate,
      baseCurrency: "PHP",
      targetCurrency: preview.targetCurrency,
      closingSpotRate: preview.closingSpotRate,
      rateDate: preview.rateDate,
      rateSource: preview.rateSource,
      status: finalStatus,
      totalCarryingPhpCentavos: preview.totalCarryingPhpCentavos,
      totalRevaluedPhpCentavos: preview.totalRevaluedPhpCentavos,
      totalGainCentavos: preview.totalGainCentavos,
      totalLossCentavos: preview.totalLossCentavos,
      netGainLossCentavos: preview.netGainLossCentavos,
      unrealizedJournalId,
      reversalJournalId,
      autoReverseDate,
      detailsJson: JSON.stringify(preview.lines),
      notes: params.notes || null,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    });

    await AuditService.log({
      companyId,
      userId,
      role: params.userRole,
      action: "POST_FX_REVALUATION_RUN",
      entityType: "fx_revaluation_runs",
      entityId: runId,
      recordReference: journalNumber,
      module: "Accounting & General Ledger / Foreign Exchange Revaluation",
      afterData: {
        runId,
        accountingPeriodId: validatedPeriod.id,
        targetCurrency: preview.targetCurrency,
        closingSpotRate: preview.closingSpotRate,
        totalGainCentavos: preview.totalGainCentavos,
        totalLossCentavos: preview.totalLossCentavos,
        unrealizedJournalId,
        reversalJournalId,
        status: finalStatus,
      },
    });

    return {
      runId,
      status: finalStatus,
      unrealizedJournalId,
      reversalJournalId,
      journalNumber,
      preview,
    };
  }

  /**
   * Reverse a posted period-end FX revaluation run cleanly via canonical journal reversal.
   */
  static async reverseRevaluationRun(
    companyId: string,
    runId: string,
    userId: string,
    options?: { reverseDate?: string; reason?: string; userRole?: string }
  ) {
    this.ensureFxTables();
    const run = await db
      .select()
      .from(schema.fxRevaluationRuns)
      .where(and(eq(schema.fxRevaluationRuns.id, runId), eq(schema.fxRevaluationRuns.companyId, companyId)))
      .get();

    if (!run) {
      throw new DomainError("FX revaluation run not found.", "NOT_FOUND", 404);
    }
    if (run.status === "REVERSED" || run.status === "AUTO_REVERSED") {
      throw new DomainError(`FX revaluation run '${run.id}' has already been reversed (${run.status}).`, "ALREADY_REVERSED", 409);
    }
    if (!run.unrealizedJournalId) {
      throw new DomainError("FX revaluation run does not have a posted journal entry.", "INVALID_STATE", 400);
    }

    const revDate = options?.reverseDate || run.revaluationDate;
    const reversalJournalId = await domainReverseJournalEntry(
      companyId,
      run.unrealizedJournalId,
      userId,
      options?.reason || `Reversal of FX revaluation run ${run.id}`,
      options?.userRole,
      revDate
    );

    await db
      .update(schema.fxRevaluationRuns)
      .set({
        status: "REVERSED",
        reversalJournalId,
        autoReverseDate: revDate,
      })
      .where(and(eq(schema.fxRevaluationRuns.id, run.id), eq(schema.fxRevaluationRuns.companyId, companyId)));

    return {
      runId: run.id,
      status: "REVERSED",
      reversalJournalId,
    };
  }

  /**
   * List historical FX Revaluation Runs for a company with period & journal metadata.
   */
  static async listRevaluationRuns(companyId: string) {
    this.ensureFxTables();
    const runs = await db
      .select()
      .from(schema.fxRevaluationRuns)
      .where(eq(schema.fxRevaluationRuns.companyId, companyId))
      .orderBy(desc(schema.fxRevaluationRuns.revaluationDate), desc(schema.fxRevaluationRuns.createdAt));

    const periods = await db
      .select()
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.companyId, companyId));
    const periodMap = new Map<string, typeof schema.accountingPeriods.$inferSelect>(
      periods.map((p) => [p.id, p])
    );

    const jeIds: string[] = Array.from(
      new Set(
        runs
          .flatMap((r): Array<string | null | undefined> => [r.unrealizedJournalId, r.reversalJournalId])
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const jeMap = new Map<string, typeof schema.journalEntries.$inferSelect>();
    if (jeIds.length > 0) {
      const jes = await db
        .select()
        .from(schema.journalEntries)
        .where(and(eq(schema.journalEntries.companyId, companyId), inArray(schema.journalEntries.id, jeIds)));
      for (const j of jes) jeMap.set(j.id, j);
    }

    return runs.map((r) => ({
      ...r,
      accountingPeriodName: r.accountingPeriodId ? periodMap.get(r.accountingPeriodId)?.name || null : null,
      unrealizedJournalNumber: r.unrealizedJournalId ? jeMap.get(r.unrealizedJournalId)?.journalNumber || null : null,
      reversalJournalNumber: r.reversalJournalId ? jeMap.get(r.reversalJournalId)?.journalNumber || null : null,
      lines: (() => {
        try {
          return JSON.parse(r.detailsJson || "[]");
        } catch {
          return [];
        }
      })(),
    }));
  }

  /**
   * Post FX Gain/Loss Adjustment or Revaluation Journal Entry (DECOUPLED from AR Customer Collections).
   * - Requires an active monetary FX account (`targetAccountId` or single company FX monetary account).
   * - Never fabricates a Cash `1100` Debit / AR `1200` Credit customer collection entry!
   * - Routes UNREALIZED entries to Unrealized FX Gain/Loss (4910/6910) and REALIZED entries to Realized FX Gain/Loss (4900/6900).
   */
  static async postRealizedFxJournal(
    companyId: string,
    userId: string,
    params: {
      transactionId: string;
      transactionNumber: string;
      transactionDate: string;
      foreignAmount: number;
      recordedRate: number;
      settlementRate: number;
      currency?: string;
      targetAccountId?: string;
      revaluationType?: "REALIZED" | "UNREALIZED";
      sourceType?: string;
      userRole?: string;
    }
  ) {
    this.ensureFxTables();

    // 1. Validate Period & Lock Date immediately (fail-closed)
    await validateTransactionDateAndPeriod(companyId, params.transactionDate, {
      userRole: params.userRole,
    });

    const fxResult = this.calculateRealizedFx(
      params.foreignAmount,
      params.recordedRate,
      params.settlementRate
    );

    if (fxResult.variancePhp === 0) {
      return null; // No FX variance to post
    }

    const srcUpper = String(params.sourceType || "").toUpperCase();
    const isUnrealized =
      params.revaluationType === "UNREALIZED" ||
      srcUpper.includes("UNREALIZED") ||
      srcUpper.includes("MONTH_END") ||
      srcUpper.includes("PERIOD_END");

    // Resolve target monetary GL account cleanly — NEVER fall back to fabricated 1100 Cash / 1200 AR collection!
    const allCompanyAccounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));
    const parentIds = new Set(
      allCompanyAccounts.filter((a) => a.parentAccountId).map((a) => String(a.parentAccountId))
    );

    let targetAccount: typeof schema.accounts.$inferSelect | undefined;
    if (params.targetAccountId) {
      targetAccount = allCompanyAccounts.find((a) => a.id === params.targetAccountId);
      if (!targetAccount) {
        throw new DomainError(
          `Target FX monetary account '${params.targetAccountId}' not found for company.`,
          "ACCOUNT_NOT_FOUND",
          400
        );
      }
      if (String(targetAccount.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
        throw new DomainError(
          `Target FX monetary account '${targetAccount.accountCode}' is not ACTIVE.`,
          "INACTIVE_ACCOUNT",
          400
        );
      }
      if (parentIds.has(targetAccount.id)) {
        throw new DomainError(
          `Parent header account '${targetAccount.accountCode}' cannot be posted to directly.`,
          "PARENT_HEADER_ACCOUNT_POSTING_PROHIBITED",
          400
        );
      }
    } else {
      const fxMonetary = await this.listForeignMonetaryAccounts(companyId, {
        asOfDate: params.transactionDate,
        currency: params.currency,
      });
      if (fxMonetary.length > 0) {
        targetAccount = allCompanyAccounts.find((a) => a.id === fxMonetary[0].accountId);
      }
    }

    if (!targetAccount) {
      throw new DomainError(
        "FX revaluation requires a valid foreign-currency monetary GL account (`targetAccountId` or an active Foreign Currency / Dollar Bank account). Standalone `/forex/revalue-and-post` does not fabricate Cash/AR collection entries.",
        "MISSING_FX_MONETARY_ACCOUNT",
        400
      );
    }

    const fxAccounts = isUnrealized
      ? await this.resolveUnrealizedFxAccounts(companyId)
      : await this.resolveRealizedFxAccounts(companyId);

    const varianceCentavos = Math.round(fxResult.variancePhp * 100);
    const absVariance = Math.abs(varianceCentavos);
    const directionSign = String(targetAccount.normalBalance || "DEBIT").toUpperCase() === "CREDIT" ? -1 : 1;
    // If asset increases (variance > 0) -> DR Asset / CR FX Gain; if asset decreases (variance < 0) -> DR FX Loss / CR Asset
    // If liability increases (variance > 0) -> DR FX Loss / CR Liability; if liability decreases (variance < 0) -> DR Liability / CR FX Gain
    const signedAdjustment = directionSign * varianceCentavos;
    const isGain = signedAdjustment > 0;

    const lines: JournalLineInput[] = isGain
      ? [
          {
            accountId: targetAccount.id,
            debit: absVariance,
            credit: 0,
            description: `${isUnrealized ? "Unrealized" : "Realized"} FX Gain Revaluation (${params.transactionNumber}) - ${targetAccount.accountCode}`,
          },
          {
            accountId: fxAccounts.gainAccount.id,
            debit: 0,
            credit: absVariance,
            description: `BIR RMC 12-2024 ${isUnrealized ? "Unrealized" : "Realized"} FX Gain - ${params.transactionNumber}`,
          },
        ]
      : [
          {
            accountId: fxAccounts.lossAccount.id,
            debit: absVariance,
            credit: 0,
            description: `BIR RMC 12-2024 ${isUnrealized ? "Unrealized" : "Realized"} FX Loss - ${params.transactionNumber}`,
          },
          {
            accountId: targetAccount.id,
            debit: 0,
            credit: absVariance,
            description: `${isUnrealized ? "Unrealized" : "Realized"} FX Loss Revaluation (${params.transactionNumber}) - ${targetAccount.accountCode}`,
          },
        ];

    return await AccountingEngine.postBalancedJournalEntry(
      companyId,
      {
        journalNumber: `JE-${isUnrealized ? "UFX" : "RFX"}-${params.transactionNumber}`,
        entryDate: params.transactionDate,
        description: `${isUnrealized ? "Unrealized" : "Realized"} FX Revaluation (${params.foreignAmount} ${params.currency || "USD"}: ${params.recordedRate} -> ${params.settlementRate})`,
        sourceType: isUnrealized ? "fx_revaluation_runs" : (params.sourceType || "fx_realized_adjustment"),
        sourceId: params.transactionId,
        createdBy: userId,
        userRole: params.userRole,
      },
      lines
    );
  }
}
