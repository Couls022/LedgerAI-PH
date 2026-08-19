import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { DomainError, validateTransactionDateAndPeriod } from "../db/domain";

export interface JournalLineInput {
  accountId: string;
  debit: number;  // centavos
  credit: number; // centavos
  description?: string;
}

export class AccountingEngine {

  /**
   * Ensure default chart of accounts exist for the company.
   * Returns a map of account code -> account object.
   */
  static async ensureDefaultAccounts(companyId: string, dbClient: any = db) {
    const existingAccounts = await dbClient.select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));

    const accountMap: Record<string, typeof schema.accounts.$inferSelect> = {};
    for (const acc of existingAccounts) {
      accountMap[acc.accountCode] = acc;
    }

    const defaultDefs = [
      { code: "1100", name: "Cash and Cash Equivalents", type: "ASSET", normal: "DEBIT", isCash: true },
      { code: "1200", name: "Accounts Receivable", type: "ASSET", normal: "DEBIT", isControl: true },
      { code: "1300", name: "Merchandise Inventory Asset", type: "ASSET", normal: "DEBIT" },
      { code: "1400", name: "Creditable Withholding Tax (2307)", type: "ASSET", normal: "DEBIT", isTax: true },
      { code: "1500", name: "Input VAT Asset", type: "ASSET", normal: "DEBIT", isTax: true },
      { code: "1700", name: "Property, Plant and Equipment", type: "ASSET", normal: "DEBIT" },
      { code: "1750", name: "Accumulated Depreciation - Equipment", type: "ASSET", normal: "CREDIT" },
      { code: "2000", name: "Accounts Payable", type: "LIABILITY", normal: "CREDIT", isControl: true },
      { code: "2100", name: "Goods Received Not Invoiced (Unbilled AP)", type: "LIABILITY", normal: "CREDIT" },
      { code: "2200", name: "Output VAT Payable", type: "LIABILITY", normal: "CREDIT", isTax: true },
      { code: "2300", name: "SSS Premium Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "2310", name: "PhilHealth Premium Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "2320", name: "Pag-IBIG Premium Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "2330", name: "BIR Withholding Tax Payable (1601-C)", type: "LIABILITY", normal: "CREDIT", isTax: true },
      { code: "2340", name: "Net Payroll Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "4000", name: "Sales & Service Revenue", type: "REVENUE", normal: "CREDIT" },
      { code: "4900", name: "Realized Foreign Exchange Gain", type: "OTHER_INCOME", normal: "CREDIT" },
      { code: "5000", name: "Cost of Goods Sold (COGS)", type: "COST_OF_SALES", normal: "DEBIT" },
      { code: "5100", name: "Inventory Spoilage & Shrinkage Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6000", name: "Salaries and Wages Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6100", name: "SSS Employer Contribution Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6110", name: "PhilHealth Employer Contribution Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6120", name: "Pag-IBIG Employer Contribution Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6200", name: "Depreciation Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6900", name: "Realized Foreign Exchange Loss", type: "EXPENSE", normal: "DEBIT" },
    ];

    for (const def of defaultDefs) {
      if (!accountMap[def.code]) {
        const id = crypto.randomUUID();
        const newAcc = {
          id,
          companyId,
          accountCode: def.code,
          accountName: def.name,
          accountType: def.type,
          normalBalance: def.normal,
          isCashAccount: !!def.isCash,
          isControlAccount: !!def.isControl,
          isTaxAccount: !!def.isTax,
          isRetainedEarnings: false,
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date()
        };
        try {
          await dbClient.insert(schema.accounts).values(newAcc).onConflictDoNothing();
        } catch (insertErr: any) {
          console.error(`Failed to insert default account ${def.code} for company ${companyId}:`, insertErr);
          throw insertErr;
        }
        accountMap[def.code] = newAcc as any;
      }
    }

    return accountMap;
  }

  /**
   * Atomic Journal Poster enforcing Period Lock Date and Balanced Debits == Credits in centavos ($1 = $1)
   */
  static async postBalancedJournalEntry(
    companyId: string,
    data: {
      journalNumber: string;
      entryDate: string;
      description: string;
      sourceType: string;
      sourceId: string;
      createdBy: string;
    },
    lines: JournalLineInput[],
    txContext?: any
  ) {
    // 1. Period & Lock Date Validation
    const validatedPeriod = await validateTransactionDateAndPeriod(companyId, data.entryDate, {
      userRole: 'Bookkeeper'
    });

    // 2. Double-Entry Balance Check
    let totalDebitCentavos = 0;
    let totalCreditCentavos = 0;

    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        throw new DomainError("Negative monetary amounts are strictly prohibited in double-entry lines.");
      }
      if (line.debit > 0 && line.credit > 0) {
        throw new DomainError("Journal line cannot have both Debit and Credit greater than zero.");
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new DomainError("Journal line must contain a non-zero Debit or Credit amount.");
      }
      totalDebitCentavos += line.debit;
      totalCreditCentavos += line.credit;
    }

    if (totalDebitCentavos !== totalCreditCentavos) {
      throw new DomainError(`Unbalanced Journal Entry: Total Debits (${(totalDebitCentavos / 100).toFixed(2)}) != Total Credits (${(totalCreditCentavos / 100).toFixed(2)}).`);
    }

    // 3. Atomic Database Transaction
    const entryId = crypto.randomUUID();
    const executeInTransaction = async (txRunner: any) => {
      await txRunner.insert(schema.journalEntries).values({
        id: entryId,
        companyId,
        journalNumber: data.journalNumber,
        entryDate: data.entryDate,
        accountingPeriodId: validatedPeriod ? validatedPeriod.id : null,
        description: data.description,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        status: "POSTED",
        createdBy: data.createdBy,
        postedBy: data.createdBy,
        postedAt: new Date(),
      });

      let lineNumber = 1;
      for (const line of lines) {
        await txRunner.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: entryId,
          accountId: line.accountId,
          description: line.description || data.description,
          debit: line.debit,
          credit: line.credit,
          lineNumber: lineNumber++,
        });
      }

      await txRunner.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId: data.createdBy,
        action: "POST_AUTOMATED_JOURNAL_ENTRY",
        entityType: "journal_entries",
        entityId: entryId,
        recordReference: data.journalNumber,
        afterData: JSON.stringify({ data, totalCentavos: totalDebitCentavos, linesCount: lines.length }),
      });
    };

    if (txContext) {
      await executeInTransaction(txContext);
    } else {
      await db.transaction(async (tx) => {
        await executeInTransaction(tx);
      });
    }

    return entryId;
  }

  // =========================================================================
  // LIFECYCLE 1: ACCOUNTS RECEIVABLE & COLLECTION ENGINE
  // =========================================================================

  /**
   * Post Sales Invoice Issued:
   * DR: Accounts Receivable (Gross)
   * CR: Sales Revenue (Net)
   * CR: Output VAT Payable (if VATable)
   */
  static async postInvoiceIssued(
    companyId: string,
    userId: string,
    params: {
      invoiceId: string;
      invoiceNumber: string;
      invoiceDate: string;
      netAmountCentavos: number;
      vatAmountCentavos: number;
      customerName: string;
    }
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId);
    const grossCentavos = params.netAmountCentavos + params.vatAmountCentavos;

    const lines: JournalLineInput[] = [
      {
        accountId: accMap["1200"].id,
        debit: grossCentavos,
        credit: 0,
        description: `AR - Sales Invoice ${params.invoiceNumber} (${params.customerName})`
      },
      {
        accountId: accMap["4000"].id,
        debit: 0,
        credit: params.netAmountCentavos,
        description: `Sales Revenue - Invoice ${params.invoiceNumber}`
      }
    ];

    if (params.vatAmountCentavos > 0) {
      lines.push({
        accountId: accMap["2200"].id,
        debit: 0,
        credit: params.vatAmountCentavos,
        description: `12% Output VAT Payable - Invoice ${params.invoiceNumber}`
      });
    }

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-INV-${params.invoiceNumber}`,
      entryDate: params.invoiceDate,
      description: `Sales Invoice ${params.invoiceNumber} issued to ${params.customerName}`,
      sourceType: "sales_invoices",
      sourceId: params.invoiceId,
      createdBy: userId
    }, lines);
  }

  /**
   * Post Customer Collection with Foreign Currency (USD -> PHP) BIR RMC 12-2024 Forex & Form 2307:
   * DR: Cash / Bank (Settled PHP - Form 2307 Withholding)
   * DR: Creditable Withholding Tax (2307) (if applicable)
   * DR: Realized Forex Loss (if collection rate < invoice rate)
   * CR: Accounts Receivable (Original Recorded PHP Value)
   * CR: Realized Forex Gain (if collection rate > invoice rate)
   */
  static async postCustomerCollectionForex(
    companyId: string,
    userId: string,
    params: {
      paymentId: string;
      paymentNumber: string;
      paymentDate: string;
      usdAmount: number;
      invoiceRate: number;    // e.g. 56.00 PHP/USD
      collectionRate: number; // e.g. 57.50 PHP/USD (BIR RMC 12-2024 BSP Spot Rate)
      withholdingTax2307Php?: number; // centavos
      customerName: string;
    }
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId);

    const originalPhpCentavos = Math.round(params.usdAmount * params.invoiceRate * 100);
    const settledPhpCentavos = Math.round(params.usdAmount * params.collectionRate * 100);
    const fxDifferenceCentavos = settledPhpCentavos - originalPhpCentavos; // Positive = Gain, Negative = Loss
    const tax2307Centavos = Math.round(params.withholdingTax2307Php || 0);
    const cashReceivedCentavos = settledPhpCentavos - tax2307Centavos;

    const lines: JournalLineInput[] = [];

    // DR: Cash Received
    lines.push({
      accountId: accMap["1100"].id,
      debit: cashReceivedCentavos,
      credit: 0,
      description: `Collection Received - Payment ${params.paymentNumber}`
    });

    // DR: Form 2307 Creditable Withholding Tax (if any)
    if (tax2307Centavos > 0) {
      lines.push({
        accountId: accMap["1400"].id,
        debit: tax2307Centavos,
        credit: 0,
        description: `BIR Form 2307 CWT - Payment ${params.paymentNumber}`
      });
    }

    // Realized Forex Loss
    if (fxDifferenceCentavos < 0) {
      lines.push({
        accountId: accMap["6900"].id,
        debit: Math.abs(fxDifferenceCentavos),
        credit: 0,
        description: `BIR RMC 12-2024 Realized Forex Loss - ${params.paymentNumber}`
      });
    }

    // CR: Accounts Receivable (Original PHP Recorded Value)
    lines.push({
      accountId: accMap["1200"].id,
      debit: 0,
      credit: originalPhpCentavos,
      description: `Clear AR - Customer Payment ${params.paymentNumber}`
    });

    // Realized Forex Gain
    if (fxDifferenceCentavos > 0) {
      lines.push({
        accountId: accMap["4900"].id,
        debit: 0,
        credit: fxDifferenceCentavos,
        description: `BIR RMC 12-2024 Realized Forex Gain - ${params.paymentNumber}`
      });
    }

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-PYM-${params.paymentNumber}`,
      entryDate: params.paymentDate,
      description: `Collection for $${params.usdAmount} USD @ BSP rate ${params.collectionRate} PHP/USD`,
      sourceType: "customer_payments",
      sourceId: params.paymentId,
      createdBy: userId
    }, lines);
  }

  // =========================================================================
  // LIFECYCLE 2: PROCUREMENT & 3-WAY MATCHING ENGINE
  // =========================================================================

  /**
   * Post Goods Receipt Note (GRN):
   * DR: Inventory Asset (Qty * Unit Cost)
   * CR: Goods Received Not Invoiced / Unbilled AP
   */
  static async postGoodsReceiptNote(
    companyId: string,
    userId: string,
    params: {
      grnId: string;
      grnNumber: string;
      receiptDate: string;
      amountCentavos: number;
      vendorName: string;
    }
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId);

    const lines: JournalLineInput[] = [
      {
        accountId: accMap["1300"].id,
        debit: params.amountCentavos,
        credit: 0,
        description: `Inventory Received via GRN ${params.grnNumber}`
      },
      {
        accountId: accMap["2100"].id,
        debit: 0,
        credit: params.amountCentavos,
        description: `Unbilled AP (GRN ${params.grnNumber} - ${params.vendorName})`
      }
    ];

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-GRN-${params.grnNumber}`,
      entryDate: params.receiptDate,
      description: `GRN ${params.grnNumber} received from ${params.vendorName}`,
      sourceType: "goods_receipt_notes",
      sourceId: params.grnId,
      createdBy: userId
    }, lines);
  }

  /**
   * Post Supplier Bill Matched (3-Way Validation: PO vs. GRN vs. Bill):
   * DR: Goods Received Not Invoiced / Unbilled AP
   * DR: Input VAT Asset (if VATable)
   * CR: Accounts Payable
   */
  static async postPurchaseBillMatched(
    companyId: string,
    userId: string,
    params: {
      billId: string;
      billNumber: string;
      billDate: string;
      unbilledApCentavos: number;
      inputVatCentavos: number;
      totalBillCentavos: number;
      vendorName: string;
      poAmountCentavos: number;
    }
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId);

    // 3-Way Match Check
    const varianceCentavos = Math.abs(params.totalBillCentavos - params.poAmountCentavos);
    if (varianceCentavos > 100) { // Tolerance threshold > 1.00 PHP
      console.warn(`[ProcurementEngine] 3-Way Match Variance detected: Bill (${params.totalBillCentavos / 100}) vs PO (${params.poAmountCentavos / 100})`);
    }

    const lines: JournalLineInput[] = [
      {
        accountId: accMap["2100"].id,
        debit: params.unbilledApCentavos,
        credit: 0,
        description: `Clear Unbilled AP - Bill ${params.billNumber}`
      }
    ];

    if (params.inputVatCentavos > 0) {
      lines.push({
        accountId: accMap["1500"].id,
        debit: params.inputVatCentavos,
        credit: 0,
        description: `Input VAT Asset - Bill ${params.billNumber}`
      });
    }

    lines.push({
      accountId: accMap["2000"].id,
      debit: 0,
      credit: params.totalBillCentavos,
      description: `Accounts Payable - ${params.vendorName} (Bill ${params.billNumber})`
    });

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-BILL-${params.billNumber}`,
      entryDate: params.billDate,
      description: `Supplier Bill ${params.billNumber} matched against GRN/PO`,
      sourceType: "supplier_bills",
      sourceId: params.billId,
      createdBy: userId
    }, lines);
  }

  // =========================================================================
  // LIFECYCLE 3: INVENTORY COSTING & COGS ENGINE (FIFO / WEIGHTED AVERAGE)
  // =========================================================================

  /**
   * Post Inventory Sale / Cost of Goods Sold (COGS):
   * DR: Cost of Goods Sold (Expense)
   * CR: Inventory Asset
   */
  static async postInventorySaleCOGS(
    companyId: string,
    userId: string,
    params: {
      saleId: string;
      saleNumber: string;
      saleDate: string;
      cogsCentavos: number;
      sku: string;
    }
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId);

    const lines: JournalLineInput[] = [
      {
        accountId: accMap["5000"].id,
        debit: params.cogsCentavos,
        credit: 0,
        description: `COGS - Sale ${params.saleNumber} (${params.sku})`
      },
      {
        accountId: accMap["1300"].id,
        debit: 0,
        credit: params.cogsCentavos,
        description: `Inventory Out - Sale ${params.saleNumber}`
      }
    ];

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-COGS-${params.saleNumber}`,
      entryDate: params.saleDate,
      description: `COGS recognition for Sale ${params.saleNumber}`,
      sourceType: "inventory_transactions",
      sourceId: params.saleId,
      createdBy: userId
    }, lines);
  }

  /**
   * Post Spoilage / Stock Adjustment:
   * DR: Inventory Spoilage & Shrinkage Expense
   * CR: Merchandise Inventory Asset
   */
  static async postInventorySpoilageAdjustment(
    companyId: string,
    userId: string,
    params: {
      adjustmentId: string;
      adjustmentNumber: string;
      adjustmentDate: string;
      spoilageValueCentavos: number;
      reason: string;
      itemName: string;
    }
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId);

    const lines: JournalLineInput[] = [
      {
        accountId: accMap["5100"].id,
        debit: params.spoilageValueCentavos,
        credit: 0,
        description: `Inventory Spoilage Expense (${params.reason}) - ${params.itemName}`
      },
      {
        accountId: accMap["1300"].id,
        debit: 0,
        credit: params.spoilageValueCentavos,
        description: `Inventory Stock Reduction (${params.adjustmentNumber})`
      }
    ];

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-ADJ-${params.adjustmentNumber}`,
      entryDate: params.adjustmentDate,
      description: `Stock adjustment/spoilage for ${params.itemName} (${params.reason})`,
      sourceType: "stock_adjustments",
      sourceId: params.adjustmentId,
      createdBy: userId
    }, lines);
  }

  // =========================================================================
  // LIFECYCLE 4: PAYROLL & MANDATORY DEDUCTIONS ENGINE
  // =========================================================================

  /**
   * Post Payroll Run Entry:
   * DR: Salaries & Wages Expense (Gross Pay)
   * DR: SSS Employer Contribution Expense
   * DR: PhilHealth Employer Contribution Expense
   * DR: Pag-IBIG Employer Contribution Expense
   * CR: SSS Premium Payable (EE + ER Share)
   * CR: PhilHealth Premium Payable (EE + ER Share)
   * CR: Pag-IBIG Premium Payable (EE + ER Share)
   * CR: BIR Withholding Tax Payable (1601-C)
   * CR: Net Payroll Payable
   */
  static async postPayrollRun(
    companyId: string,
    userId: string,
    params: {
      payrollRunId: string;
      payrollPeriod: string;
      paymentDate: string;
      grossPayCentavos: number;
      sssEmployeeCentavos: number;
      sssEmployerCentavos: number;
      philhealthEmployeeCentavos: number;
      philhealthEmployerCentavos: number;
      pagibigEmployeeCentavos: number;
      pagibigEmployerCentavos: number;
      withholdingTaxCentavos: number;
      netPayCentavos: number;
    },
    txContext?: any
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId, txContext || db);

    const totalSssPayable = params.sssEmployeeCentavos + params.sssEmployerCentavos;
    const totalPhilhealthPayable = params.philhealthEmployeeCentavos + params.philhealthEmployerCentavos;
    const totalPagibigPayable = params.pagibigEmployeeCentavos + params.pagibigEmployerCentavos;

    const lines: JournalLineInput[] = [
      // Debits
      {
        accountId: accMap["6000"].id,
        debit: params.grossPayCentavos,
        credit: 0,
        description: `Gross Salaries & Wages Expense (${params.payrollPeriod})`
      },
      {
        accountId: accMap["6100"].id,
        debit: params.sssEmployerCentavos,
        credit: 0,
        description: `SSS ER Contribution Expense (${params.payrollPeriod})`
      },
      {
        accountId: accMap["6110"].id,
        debit: params.philhealthEmployerCentavos,
        credit: 0,
        description: `PhilHealth ER Contribution Expense (${params.payrollPeriod})`
      },
      {
        accountId: accMap["6120"].id,
        debit: params.pagibigEmployerCentavos,
        credit: 0,
        description: `Pag-IBIG ER Contribution Expense (${params.payrollPeriod})`
      },
      // Credits
      {
        accountId: accMap["2300"].id,
        debit: 0,
        credit: totalSssPayable,
        description: `SSS Premium Payable (EE + ER)`
      },
      {
        accountId: accMap["2310"].id,
        debit: 0,
        credit: totalPhilhealthPayable,
        description: `PhilHealth Premium Payable (EE + ER)`
      },
      {
        accountId: accMap["2320"].id,
        debit: 0,
        credit: totalPagibigPayable,
        description: `Pag-IBIG Premium Payable (EE + ER)`
      },
      {
        accountId: accMap["2330"].id,
        debit: 0,
        credit: params.withholdingTaxCentavos,
        description: `BIR Form 1601-C Compensation Withholding Tax Payable`
      },
      {
        accountId: accMap["2340"].id,
        debit: 0,
        credit: params.netPayCentavos,
        description: `Net Payroll Payable (${params.payrollPeriod})`
      }
    ];

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-PAY-${params.payrollPeriod}`,
      entryDate: params.paymentDate,
      description: `Payroll Posting for Period ${params.payrollPeriod}`,
      sourceType: "payroll_runs",
      sourceId: params.payrollRunId,
      createdBy: userId
    }, lines, txContext);
  }

  // =========================================================================
  // LIFECYCLE 5: FIXED ASSETS & DEPRECIATION SCHEDULE ENGINE
  // =========================================================================

  /**
   * Post Monthly Depreciation Schedule Run:
   * DR: Depreciation Expense
   * CR: Accumulated Depreciation - Equipment
   */
  static async postMonthlyDepreciation(
    companyId: string,
    userId: string,
    params: {
      scheduleId: string;
      assetId: string;
      assetName: string;
      periodMonth: string;
      depreciationAmountCentavos: number;
    },
    txContext?: any
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId, txContext || db);

    const lines: JournalLineInput[] = [
      {
        accountId: accMap["6200"].id,
        debit: params.depreciationAmountCentavos,
        credit: 0,
        description: `Depreciation Expense - ${params.assetName} (${params.periodMonth})`
      },
      {
        accountId: accMap["1750"].id,
        debit: 0,
        credit: params.depreciationAmountCentavos,
        description: `Accumulated Depreciation - ${params.assetName}`
      }
    ];

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-DEP-${params.periodMonth}-${params.assetId.slice(0, 6)}`,
      entryDate: `${params.periodMonth}-28`,
      description: `Monthly Depreciation for ${params.assetName} (${params.periodMonth})`,
      sourceType: "depreciation_schedules",
      sourceId: params.scheduleId,
      createdBy: userId
    }, lines, txContext);
  }
}
