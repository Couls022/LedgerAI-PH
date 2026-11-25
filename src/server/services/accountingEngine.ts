import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { DomainError, validateTransactionDateAndPeriod, reverseJournalEntry as domainReverseJournalEntry, assertNoDuplicateSourceJournal, isAdminPeriodOverrideRole } from "../db/domain";

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
    const existingAccounts: Array<typeof schema.accounts.$inferSelect> = await dbClient.select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));

    const parentIds = new Set(
      existingAccounts.filter((a) => a.parentAccountId).map((a) => a.parentAccountId!)
    );
    const isLeafAndActive = (acc: typeof schema.accounts.$inferSelect) =>
      acc.status === "ACTIVE" && !parentIds.has(acc.id) && !(acc as any).isHeader;

    const eligibleLeafs = existingAccounts.filter(isLeafAndActive);
    const occupiedCodes = new Set(existingAccounts.map((a) => a.accountCode));

    const accountMap: Record<string, typeof schema.accounts.$inferSelect> = {};
    for (const acc of eligibleLeafs) {
      accountMap[acc.accountCode] = acc;
    }

    const resolveExistingRoleAccount = (code: string): typeof schema.accounts.$inferSelect | undefined => {
      const exactLeaf = eligibleLeafs.find((a) => a.accountCode === code);
      if (exactLeaf) {
        if (code === "2120" && exactLeaf.accountName.toLowerCase().includes("output vat")) {
          // 2120 is used for Output VAT in this company's COA; do not conflate with Percentage Tax
        } else {
          return exactLeaf;
        }
      }

      switch (code) {
        case "1100":
          return (
            eligibleLeafs.find((a) => a.accountCode === "1010") ||
            eligibleLeafs.find((a) => a.isCashAccount && ["1010", "1020", "1100"].includes(a.accountCode)) ||
            eligibleLeafs.find((a) => a.isCashAccount)
          );
        case "1200":
          return (
            eligibleLeafs.find((a) => ["1030", "1110", "1120", "1200"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.isControlAccount &&
                (a.accountType === "RECEIVABLE" ||
                  a.detailType === "ACCOUNTS_RECEIVABLE" ||
                  a.accountName.toLowerCase().includes("receivable"))
            ) ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "RECEIVABLE" ||
                a.detailType === "ACCOUNTS_RECEIVABLE" ||
                a.accountName.toLowerCase().includes("accounts receivable")
            )
          );
        case "1300":
          return (
            eligibleLeafs.find((a) => ["1080", "1130", "1300", "1310"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "INVENTORY" ||
                a.detailType === "INVENTORY" ||
                a.detailType === "MERCHANDISE_INVENTORY" ||
                a.accountName.toLowerCase().includes("inventory")
            )
          );
        case "1400":
          return (
            eligibleLeafs.find((a) => ["1055", "1140", "1400"].includes(a.accountCode)) ||
            eligibleLeafs.find((a) => a.accountName.toLowerCase().includes("creditable withholding"))
          );
        case "1500":
          return (
            eligibleLeafs.find((a) => ["1060", "1150", "1500"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) => a.accountCode === "1050" && a.accountName.toLowerCase().includes("vat")
            ) ||
            eligibleLeafs.find((a) => a.accountName.toLowerCase().includes("input vat"))
          );
        case "2000":
          return (
            eligibleLeafs.find(
              (a) =>
                ["2010", "2110", "2000"].includes(a.accountCode) &&
                !a.accountName.toLowerCase().includes("vat")
            ) ||
            eligibleLeafs.find(
              (a) =>
                a.isControlAccount &&
                (a.accountType === "PAYABLE" ||
                  a.detailType === "ACCOUNTS_PAYABLE" ||
                  a.accountName.toLowerCase().includes("accounts payable"))
            ) ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "PAYABLE" ||
                a.detailType === "ACCOUNTS_PAYABLE" ||
                a.accountName.toLowerCase().includes("accounts payable")
            )
          );
        case "2100":
          return (
            eligibleLeafs.find((a) => ["2100", "2015", "2115"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.accountName.toLowerCase().includes("unbilled") ||
                a.accountName.toLowerCase().includes("grni")
            )
          );
        case "2200":
          return (
            eligibleLeafs.find((a) => a.accountCode === "2020") ||
            eligibleLeafs.find(
              (a) =>
                ["2110", "2120", "2200"].includes(a.accountCode) &&
                a.accountName.toLowerCase().includes("vat")
            ) ||
            eligibleLeafs.find(
              (a) =>
                a.accountName.toLowerCase().includes("output vat") ||
                a.accountName.toLowerCase().includes("vat payable")
            )
          );
        case "2030":
          return (
            eligibleLeafs.find((a) => ["2030", "2130"].includes(a.accountCode)) ||
            eligibleLeafs.find((a) => a.accountName.toLowerCase().includes("expanded withholding"))
          );
        case "2035":
        case "2330":
          return (
            eligibleLeafs.find((a) => ["2035", "2330"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.accountName.toLowerCase().includes("withholding") &&
                a.accountName.toLowerCase().includes("compensation")
            )
          );
        case "4000":
          return (
            eligibleLeafs.find((a) => ["4010", "4000", "4100"].includes(a.accountCode)) ||
            eligibleLeafs.find((a) => a.accountType === "REVENUE" && a.detailType !== "OTHER_INCOME")
          );
        case "5000":
          return (
            eligibleLeafs.find((a) => ["5010", "5000"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "COGS" ||
                a.accountType === "COST_OF_SALES" ||
                a.detailType === "COGS" ||
                a.accountName.toLowerCase().includes("cost of goods") ||
                a.accountName.toLowerCase().includes("cost of sales")
            )
          );
        case "1700":
          return (
            eligibleLeafs.find((a) => ["1700", "1210", "1510"].includes(a.accountCode) && !a.accountName.toLowerCase().includes("accumulated")) ||
            eligibleLeafs.find(
              (a) =>
                (a.detailType === "FIXED_ASSET" ||
                  a.accountName.toLowerCase().includes("property, plant") ||
                  a.accountName.toLowerCase().includes("equipment") ||
                  a.accountName.toLowerCase().includes("fixed asset")) &&
                !a.accountName.toLowerCase().includes("accumulated")
            )
          );
        case "1750":
          return (
            eligibleLeafs.find((a) => ["1750", "1220", "1520"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "ACCUMULATED_DEPRECIATION" ||
                a.accountName.toLowerCase().includes("accumulated depreciation")
            )
          );
        case "2300":
          return (
            eligibleLeafs.find((a) => ["2300", "2050"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "SSS_PAYABLE" ||
                (a.accountType === "LIABILITY" && a.accountName.toLowerCase().includes("sss"))
            )
          );
        case "2310":
          return (
            eligibleLeafs.find((a) => ["2310", "2060"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "PHILHEALTH_PAYABLE" ||
                (a.accountType === "LIABILITY" && a.accountName.toLowerCase().includes("philhealth"))
            )
          );
        case "2320":
          return (
            eligibleLeafs.find((a) => ["2320", "2070"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "PAGIBIG_PAYABLE" ||
                (a.accountType === "LIABILITY" && (a.accountName.toLowerCase().includes("pag-ibig") || a.accountName.toLowerCase().includes("pagibig") || a.accountName.toLowerCase().includes("hdmf")))
            )
          );
        case "2340":
          return (
            eligibleLeafs.find((a) => ["2340", "2045"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "NET_PAYROLL_PAYABLE" ||
                a.accountName.toLowerCase().includes("net payroll payable") ||
                a.accountName.toLowerCase().includes("salaries payable") ||
                a.accountName.toLowerCase().includes("accrued payroll")
            )
          );
        case "5100":
          return (
            eligibleLeafs.find((a) => a.accountCode === "5100") ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "INVENTORY_SHRINKAGE" ||
                a.accountName.toLowerCase().includes("spoilage") ||
                a.accountName.toLowerCase().includes("shrinkage")
            )
          );
        case "6000":
          return (
            eligibleLeafs.find((a) => ["6010", "6000"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "SALARIES_EXPENSE" ||
                a.accountName.toLowerCase().includes("salar") ||
                a.accountName.toLowerCase().includes("wage") ||
                a.accountName.toLowerCase().includes("operating expense")
            )
          );
        case "6100":
          return (
            eligibleLeafs.find((a) => a.accountCode === "6100") ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "EXPENSE" &&
                a.accountName.toLowerCase().includes("sss") &&
                a.accountName.toLowerCase().includes("employer")
            )
          );
        case "6110":
          return (
            eligibleLeafs.find((a) => a.accountCode === "6110") ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "EXPENSE" &&
                a.accountName.toLowerCase().includes("philhealth") &&
                a.accountName.toLowerCase().includes("employer")
            )
          );
        case "6120":
          return (
            eligibleLeafs.find((a) => a.accountCode === "6120") ||
            eligibleLeafs.find(
              (a) =>
                a.accountType === "EXPENSE" &&
                (a.accountName.toLowerCase().includes("pag-ibig") || a.accountName.toLowerCase().includes("pagibig")) &&
                a.accountName.toLowerCase().includes("employer")
            )
          );
        case "6200":
          return (
            eligibleLeafs.find((a) => ["6200", "6050", "6210"].includes(a.accountCode)) ||
            eligibleLeafs.find(
              (a) =>
                a.detailType === "DEPRECIATION_EXPENSE" ||
                a.accountName.toLowerCase().includes("depreciation expense") ||
                (a.accountType === "EXPENSE" && a.accountName.toLowerCase().includes("depreciation"))
            )
          );
        default:
          return undefined;
      }
    };

    const defaultDefs = [
      { code: "1100", fallbackCode: "1010", name: "Cash and Cash Equivalents", type: "ASSET", normal: "DEBIT", isCash: true },
      { code: "1200", fallbackCode: "1030", name: "Accounts Receivable", type: "ASSET", normal: "DEBIT", isControl: true },
      { code: "1300", fallbackCode: "1080", name: "Merchandise Inventory Asset", type: "INVENTORY", normal: "DEBIT" },
      { code: "1400", fallbackCode: "1055", name: "Creditable Withholding Tax (2307)", type: "ASSET", normal: "DEBIT", isTax: true },
      { code: "1500", fallbackCode: "1050", name: "Input VAT Asset", type: "ASSET", normal: "DEBIT", isTax: true },
      { code: "1700", fallbackCode: "1710", name: "Property, Plant and Equipment", type: "ASSET", normal: "DEBIT" },
      { code: "1750", fallbackCode: "1755", name: "Accumulated Depreciation - Equipment", type: "ASSET", normal: "CREDIT" },
      { code: "2000", fallbackCode: "2010", name: "Accounts Payable", type: "LIABILITY", normal: "CREDIT", isControl: true },
      { code: "2100", fallbackCode: "2015", name: "Goods Received Not Invoiced (Unbilled AP)", type: "LIABILITY", normal: "CREDIT" },
      { code: "2200", fallbackCode: "2020", name: "Output VAT Payable", type: "LIABILITY", normal: "CREDIT", isTax: true },
      { code: "2030", fallbackCode: "2130", name: "Expanded Withholding Tax Payable", type: "PAYABLE", normal: "CREDIT", isTax: true },
      { code: "2035", fallbackCode: "2135", name: "Withholding Tax Payable - Compensation", type: "PAYABLE", normal: "CREDIT", isTax: true },
      { code: "2036", fallbackCode: "2136", name: "Employee Tax Refund Payable", type: "PAYABLE", normal: "CREDIT" },
      { code: "2120", fallbackCode: "2125", name: "Percentage Tax Payable (Form 2551Q)", type: "PAYABLE", normal: "CREDIT", isTax: true },
      { code: "2140", fallbackCode: "2145", name: "Special Gross Income Tax Payable (5% GIT)", type: "PAYABLE", normal: "CREDIT", isTax: true },
      { code: "2300", fallbackCode: "2305", name: "SSS Premium Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "2310", fallbackCode: "2315", name: "PhilHealth Premium Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "2320", fallbackCode: "2325", name: "Pag-IBIG Premium Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "2330", fallbackCode: "2335", name: "BIR Withholding Tax Payable (1601-C)", type: "PAYABLE", normal: "CREDIT", isTax: true },
      { code: "2340", fallbackCode: "2345", name: "Net Payroll Payable", type: "LIABILITY", normal: "CREDIT" },
      { code: "4000", fallbackCode: "4010", name: "Sales & Service Revenue", type: "REVENUE", normal: "CREDIT" },
      { code: "4900", fallbackCode: "4905", name: "Realized Foreign Exchange Gain", type: "OTHER_INCOME", normal: "CREDIT", detailType: "FOREX_GAIN" },
      { code: "4910", fallbackCode: "4915", name: "Unrealized Foreign Exchange Gain", type: "OTHER_INCOME", normal: "CREDIT", detailType: "UNREALIZED_FX_GAIN", birTaxCategory: "NON_TAXABLE_EXEMPT" },
      { code: "5000", fallbackCode: "5010", name: "Cost of Goods Sold (COGS)", type: "COST_OF_SALES", normal: "DEBIT" },
      { code: "5100", fallbackCode: "5110", name: "Inventory Spoilage & Shrinkage Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6000", fallbackCode: "6010", name: "Salaries and Wages Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6100", fallbackCode: "6105", name: "SSS Employer Contribution Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6110", fallbackCode: "6115", name: "PhilHealth Employer Contribution Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6120", fallbackCode: "6125", name: "Pag-IBIG Employer Contribution Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6200", fallbackCode: "6205", name: "Depreciation Expense", type: "EXPENSE", normal: "DEBIT" },
      { code: "6900", fallbackCode: "6905", name: "Realized Foreign Exchange Loss", type: "EXPENSE", normal: "DEBIT", detailType: "FOREX_LOSS" },
      { code: "6910", fallbackCode: "6915", name: "Unrealized Foreign Exchange Loss", type: "OTHER_EXPENSE", normal: "DEBIT", detailType: "UNREALIZED_FX_LOSS", birTaxCategory: "NON_TAXABLE_EXEMPT" },
    ];

    for (const def of defaultDefs) {
      const resolvedExisting = resolveExistingRoleAccount(def.code);
      if (resolvedExisting) {
        accountMap[def.code] = resolvedExisting;
        accountMap[resolvedExisting.accountCode] = resolvedExisting;
        continue;
      }

      let codeToInsert = def.code;
      if (occupiedCodes.has(codeToInsert)) {
        codeToInsert = occupiedCodes.has(def.fallbackCode) ? `${def.code}-LEAF` : def.fallbackCode;
      }
      occupiedCodes.add(codeToInsert);

      const id = crypto.randomUUID();
      const newAcc = {
        id,
        companyId,
        accountCode: codeToInsert,
        accountName: def.name,
        accountType: def.type,
        detailType: (def as any).detailType || null,
        birTaxCategory: (def as any).birTaxCategory || null,
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
        console.error(`Failed to insert default account ${codeToInsert} for company ${companyId}:`, insertErr);
        throw insertErr;
      }
      eligibleLeafs.push(newAcc as any);
      accountMap[def.code] = newAcc as any;
      accountMap[codeToInsert] = newAcc as any;
    }

    return accountMap;
  }

  /**
   * Fail-Closed Period Validation Engine
   * Enforces:
   * 1. Missing period -> Reject posting with PERIOD_CLOSED_ERROR
   * 2. HARD_CLOSED / LOCKED / CLOSED -> Reject posting with PERIOD_LOCKED
   * 3. SOFT_CLOSED -> Reject posting unless administrative override authorized
   * 4. OPEN -> Allow posting
   */
  static async assertPeriodIsOpen(
    dbClient: any,
    companyId: string,
    entryDate: Date | string,
    options?: { userRole?: string; isClosingAdjustment?: boolean }
  ): Promise<typeof schema.accountingPeriods.$inferSelect> {
    const dateStr = typeof entryDate === 'string' ? entryDate.slice(0, 10) : entryDate.toISOString().slice(0, 10);

    const company = await dbClient.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    if (company && company.lockDate && dateStr <= company.lockDate) {
      throw new DomainError(
        `Transaction date (${dateStr}) is on or before company lock date (${company.lockDate}). Postings to locked dates are prohibited.`,
        'PERIOD_CLOSED_ERROR',
        403
      );
    }

    const allPeriods = await dbClient.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.companyId, companyId));
    const period = allPeriods.find((p: any) => p.startDate <= dateStr && p.endDate >= dateStr);

    if (!period) {
      throw new DomainError(
        `No open accounting period found for transaction date ${dateStr}. Postings require an initialized, open accounting period.`,
        'PERIOD_CLOSED_ERROR',
        403
      );
    }

    if (period.status === 'HARD_CLOSED' || period.status === 'LOCKED' || period.status === 'CLOSED') {
      throw new DomainError(
        `Accounting period '${period.name}' (${period.startDate} to ${period.endDate}) is ${period.status}. Postings into closed periods are strictly prohibited.`,
        'PERIOD_LOCKED',
        403
      );
    }

    if (period.status === 'SOFT_CLOSED') {
      const isAuthorized = Boolean(options?.isClosingAdjustment || isAdminPeriodOverrideRole(options?.userRole));
      if (!isAuthorized) {
        throw new DomainError(
          `Accounting period '${period.name}' is SOFT_CLOSED. Standard postings are prohibited without Company Administrator authorization or closing adjustment status.`,
          'PERIOD_CLOSED_ERROR',
          403
        );
      }
    }

    return period;
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
      userRole?: string;
      isClosingAdjustment?: boolean;
    },
    lines: JournalLineInput[],
    txContext?: any
  ) {
    // 1. Period & Lock Date Validation
    const validatedPeriod = await validateTransactionDateAndPeriod(companyId, data.entryDate, {
      userRole: data.userRole,
      isClosingAdjustment: data.isClosingAdjustment
    });

    // 2. Double-Entry Balance Check (Exact Integer Centavos)
    let totalDebitCentavos = 0;
    let totalCreditCentavos = 0;

    for (const line of lines) {
      if (!Number.isInteger(line.debit) || !Number.isInteger(line.credit)) {
        throw new DomainError("Journal line debit/credit values must be exact integer centavos.", "VALIDATION_ERROR", 400);
      }
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

    // 3. Atomic Database Transaction with (companyId, sourceType, sourceId) Idempotency Guard
    const entryId = crypto.randomUUID();
    const executeInTransaction = async (txRunner: any) => {
      const existingDuplicate = await assertNoDuplicateSourceJournal(txRunner, companyId, data.sourceType, data.sourceId);
      if (existingDuplicate) {
        throw new DomainError(
          `DUPLICATE_JOURNAL_POSTING: Transaction (${data.sourceType}:${data.sourceId}) already has an active journal entry (${existingDuplicate.journalNumber}, status: ${existingDuplicate.status}).`,
          'DUPLICATE_JOURNAL_POSTING',
          409,
          { existingJournalId: existingDuplicate.id, existingJournalNumber: existingDuplicate.journalNumber, sourceType: data.sourceType, sourceId: data.sourceId }
        );
      }

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
      userRole?: string;
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
      createdBy: userId,
      userRole: params.userRole
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
      userRole?: string;
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
      createdBy: userId,
      userRole: params.userRole
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
      userRole?: string;
    },
    txContext?: any
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId, txContext || db);

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
      createdBy: userId,
      userRole: params.userRole
    }, lines, txContext);
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
      userRole?: string;
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
      createdBy: userId,
      userRole: params.userRole
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
      userRole?: string;
    },
    txContext?: any
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId, txContext || db);

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
      createdBy: userId,
      userRole: params.userRole
    }, lines, txContext);
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
      userRole?: string;
    },
    txContext?: any
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId, txContext || db);

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
      createdBy: userId,
      userRole: params.userRole
    }, lines, txContext);
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
      userRole?: string;
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
        accountId: (accMap["2035"] || accMap["2330"]).id,
        debit: 0,
        credit: params.withholdingTaxCentavos,
        description: `Withholding Tax Payable - Compensation (BIR Form 1601-C)`
      },
      {
        accountId: accMap["2340"].id,
        debit: 0,
        credit: params.netPayCentavos,
        description: `Net Payroll Payable (${params.payrollPeriod})`
      }
    ];

    const whtAccountId = (accMap["2035"] || accMap["2330"]).id;
    const statutoryBenefitAccountIds = [
      accMap["2300"]?.id,
      accMap["2310"]?.id,
      accMap["2320"]?.id,
      accMap["2040"]?.id
    ].filter(Boolean);
    if (statutoryBenefitAccountIds.includes(whtAccountId)) {
      throw new DomainError(
        "DEF-010 Violation: Compensation withholding tax must never be mapped to SSS, PhilHealth, or Pag-IBIG payable accounts."
      );
    }

    return await this.postBalancedJournalEntry(companyId, {
      journalNumber: `JE-PAY-${params.payrollPeriod}`,
      entryDate: params.paymentDate,
      description: `Payroll Posting for Period ${params.payrollPeriod}`,
      sourceType: "payroll_runs",
      sourceId: params.payrollRunId,
      createdBy: userId,
      userRole: params.userRole
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
      depreciationExpenseAccountId?: string | null;
      accumulatedDepAccountId?: string | null;
      userRole?: string;
    },
    txContext?: any
  ) {
    const accMap = await this.ensureDefaultAccounts(companyId, txContext || db);

    const lines: JournalLineInput[] = [
      {
        accountId: params.depreciationExpenseAccountId || accMap["6200"].id,
        debit: params.depreciationAmountCentavos,
        credit: 0,
        description: `Depreciation Expense - ${params.assetName} (${params.periodMonth})`
      },
      {
        accountId: params.accumulatedDepAccountId || accMap["1750"].id,
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
      createdBy: userId,
      userRole: params.userRole
    }, lines, txContext);
  }

  /**
   * Convenience wrapper to post a balanced journal entry and return its ID.
   */
  static async createAndPostJournalEntry(params: {
    companyId: string;
    journalNumber?: string;
    entryDate: string;
    description: string;
    sourceType: string;
    sourceId: string;
    userId: string;
    userRole?: string;
    isClosingAdjustment?: boolean;
    lines: JournalLineInput[];
  }): Promise<string> {
    const journalNumber =
      params.journalNumber ||
      `JE-${params.entryDate.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const result = await this.postBalancedJournalEntry(
      params.companyId,
      {
        journalNumber,
        entryDate: params.entryDate,
        description: params.description,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        createdBy: params.userId,
        userRole: params.userRole,
        isClosingAdjustment: params.isClosingAdjustment,
      },
      params.lines
    );
    return typeof result === 'string' ? result : (result as any).id || (result as any).entryId;
  }

  /**
   * Creates an immutable reversing journal entry that swaps debits and credits of a posted journal entry,
   * preserving full audit lineage between the original entry and reversal entry.
   */
  static async reverseJournalEntry(
    companyId: string,
    originalJournalEntryId: string,
    userId: string,
    reason: string,
    reverseDate?: string,
    newPeriodId?: string,
    userRole?: string
  ): Promise<string> {
    const originalEntry = await db
      .select()
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.id, originalJournalEntryId)
        )
      )
      .get();

    if (!originalEntry) {
      throw new DomainError(`Original journal entry ${originalJournalEntryId} not found.`, 'NOT_FOUND', 404);
    }

    const effectiveReverseDate = reverseDate || originalEntry.entryDate;
    const effectivePeriodId = newPeriodId || originalEntry.accountingPeriodId || '';
    return await domainReverseJournalEntry(
      companyId,
      originalJournalEntryId,
      userId,
      effectiveReverseDate,
      effectivePeriodId,
      userRole
    );
  }
}

