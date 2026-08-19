import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { AccountingEngine } from "./accountingEngine";

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

export class ForexRevaluationEngine {
  /**
   * Fetch BSP/BAP Spot Rate for a given currency and date, defaulting to 56.00 if unavailable.
   */
  static async getBspSpotRate(companyId: string, currency: string = "USD", rateDate?: string): Promise<number> {
    if (rateDate) {
      const rateRecord = await db.select()
        .from(schema.currencyExchangeRates)
        .where(
          and(
            eq(schema.currencyExchangeRates.companyId, companyId),
            eq(schema.currencyExchangeRates.currency, currency),
            eq(schema.currencyExchangeRates.rateDate, rateDate)
          )
        )
        .limit(1);

      if (rateRecord.length > 0) {
        return rateRecord[0].bspSpotRate;
      }
    }

    // Fallback to latest rate available for company
    const latestRecord = await db.select()
      .from(schema.currencyExchangeRates)
      .where(
        and(
          eq(schema.currencyExchangeRates.companyId, companyId),
          eq(schema.currencyExchangeRates.currency, currency)
        )
      )
      .orderBy(desc(schema.currencyExchangeRates.rateDate))
      .limit(1);

    if (latestRecord.length > 0) {
      return latestRecord[0].bspSpotRate;
    }

    return 56.00; // Default BSP USD/PHP spot rate
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
      complianceNote: "BIR RMC 12-2024: Realized FX difference recorded using official BSP/BAP Spot Rate."
    };
  }

  /**
   * Post FX Revaluation Journal Entry to the General Ledger with explicit separation of Gain/Loss.
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
      sourceType?: string;
    }
  ) {
    const fxResult = this.calculateRealizedFx(
      params.foreignAmount,
      params.recordedRate,
      params.settlementRate
    );

    if (fxResult.variancePhp === 0) {
      return null; // No FX variance to post
    }

    return await AccountingEngine.postCustomerCollectionForex(companyId, userId, {
      paymentId: params.transactionId,
      paymentNumber: params.transactionNumber,
      paymentDate: params.transactionDate,
      usdAmount: params.foreignAmount,
      invoiceRate: params.recordedRate,
      collectionRate: params.settlementRate,
      customerName: `FX Revaluation (${params.sourceType || 'Trade'})`
    });
  }
}
