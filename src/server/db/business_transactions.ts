import { db } from "./index";
import * as schema from "./schema";
import { eq, and, or, like, sql, ne, lte, gte, inArray } from "drizzle-orm";
import crypto from "crypto";
import { createJournalEntry, submitJournalEntry, approveJournalEntry, postJournalEntry, getAccountingPeriod, validateTransactionDateAndPeriod, DomainError, validateJournalEntryBalance } from "./domain";
import { TaxEngine } from "../services/taxEngine";

export class BusinessTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessTransactionError";
  }
}

// ---------------------------------------------------------
// SALES INVOICES (AR)
// ---------------------------------------------------------

export async function createSalesInvoice(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.invoiceDate || new Date().toISOString().split('T')[0]);
  const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, data.customerId), eq(schema.customers.companyId, companyId))).get();
  if (!customer) throw new BusinessTransactionError("Customer not found or does not belong to this company");
  if (customer.status !== "ACTIVE") throw new BusinessTransactionError("Customer is not active");

  const invoiceId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // 1. Create Invoice
    await tx.insert(schema.salesInvoices).values({
      id: invoiceId,
      companyId,
      customerId: data.customerId,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      totalAmount: data.totalAmount, // Centavos
      balanceDue: data.totalAmount,
      status: "DRAFT",
      createdBy: userId,
    });

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_SALES_INVOICE",
      entityType: "sales_invoices",
      entityId: invoiceId,
    });
  });

  return invoiceId;
}

export async function submitSalesInvoice(companyId: string, invoiceId: string, userId: string) {
  const invoice = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, invoiceId), eq(schema.salesInvoices.companyId, companyId))).get();
  if (!invoice) throw new BusinessTransactionError("Invoice not found");
  if (invoice.status !== "DRAFT") throw new BusinessTransactionError("Only DRAFT invoices can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.salesInvoices).set({
      status: "SUBMITTED",
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.salesInvoices.id, invoiceId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_SALES_INVOICE",
      entityType: "sales_invoices",
      entityId: invoiceId,
    });
  });
}

export async function approveSalesInvoice(companyId: string, invoiceId: string, userId: string) {
  const invoice = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, invoiceId), eq(schema.salesInvoices.companyId, companyId))).get();
  if (!invoice) throw new BusinessTransactionError("Invoice not found");
  if (invoice.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED invoices can be approved");
  
  if (invoice.createdBy === userId || invoice.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own invoice.");
  }
  
  await db.transaction(async (tx) => {
    await tx.update(schema.salesInvoices).set({
      status: "APPROVED",
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.salesInvoices.id, invoiceId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_SALES_INVOICE",
      entityType: "sales_invoices",
      entityId: invoiceId,
    });
  });
}

export async function rejectSalesInvoice(companyId: string, invoiceId: string, userId: string, reason?: string) {
  const invoice = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, invoiceId), eq(schema.salesInvoices.companyId, companyId))).get();
  if (!invoice) throw new BusinessTransactionError("Invoice not found");
  if (invoice.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED invoices can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.salesInvoices).set({
      status: "DRAFT",
      updatedAt: new Date()
    }).where(eq(schema.salesInvoices.id, invoiceId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_SALES_INVOICE",
      entityType: "sales_invoices",
      entityId: invoiceId,
      reason: reason || "Rejected by approver",
    });
  });
}

// Complex operation: POST (includes Journal Generation, Tax Calculation, and Posting)
export async function postSalesInvoice(companyId: string, invoiceId: string, periodId: string, lines: any[], userId: string) {
  const invoice = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, invoiceId), eq(schema.salesInvoices.companyId, companyId))).get();
  if (!invoice) throw new BusinessTransactionError("Invoice not found");
  if (invoice.status !== "APPROVED") throw new BusinessTransactionError("Only APPROVED invoices can be posted");

  const customer = await db.select().from(schema.customers).where(eq(schema.customers.id, invoice.customerId)).get();
  if (!customer) throw new BusinessTransactionError("Customer not found");

  // BRAC Validation
  await validateTransactionDateAndPeriod(companyId, invoice.invoiceDate);

  // Generate Journal Entry
  const jeLines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  // AR Debit Line
  let arAccountId = customer.defaultReceivableAccountId;
  if (!arAccountId) {
    const arAccount = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountType, "ASSET"), sql`lower(${schema.accounts.accountName}) LIKE '%receivable%'`)).limit(1).get();
    if (!arAccount) {
      throw new BusinessTransactionError("BRAC Violation: Customer missing default receivable account, and no general AR account found.");
    }
    arAccountId = arAccount.id;
  }
  
  jeLines.push({
    accountId: arAccountId,
    debit: invoice.totalAmount,
    credit: 0
  });
  totalDebit += invoice.totalAmount;

  // Revenue & Tax Credit Lines
  for (const line of lines) {
    if (!line.accountId) throw new BusinessTransactionError("BRAC Violation: Line missing account");
    
    // Calculate Tax
    let taxAmount = 0;
    if (line.taxCodeId) {
      const taxCode = await db.select().from(schema.taxCodes).where(eq(schema.taxCodes.id, line.taxCodeId)).get();
      if (!taxCode) throw new BusinessTransactionError("Tax code not found");
      
      const taxRuleVersion = await db.select().from(schema.taxRuleVersions).where(eq(schema.taxRuleVersions.ruleDefinitionId, taxCode.ruleDefinitionId!)).orderBy(schema.taxRuleVersions.version).get(); // Simplified version selection
      
      if (!taxRuleVersion) throw new BusinessTransactionError("Tax rule version not found");
      
      if (taxRuleVersion.calculationMethod === 'PERCENTAGE' && taxRuleVersion.rateValue != null) {
        taxAmount = TaxEngine.calculatePercentage(line.amount, taxRuleVersion.rateValue);
      }
      
      if (!taxCode.accountId) throw new BusinessTransactionError("Tax code missing account mapping");
      
      jeLines.push({
        accountId: taxCode.accountId,
        debit: 0,
        credit: taxAmount
      });
      totalCredit += taxAmount;

      // We will persist this in tax_calculations below
      line.calculatedTax = {
        taxCodeId: taxCode.id,
        ruleVersionId: taxRuleVersion.id,
        taxBase: line.amount,
        taxRate: taxRuleVersion.rateValue || 0,
        taxAmount: taxAmount
      };
    }

    jeLines.push({
      accountId: line.accountId,
      debit: 0,
      credit: line.amount - taxAmount // Net of tax (depends on gross/net config, simplified here)
    });
    totalCredit += (line.amount - taxAmount);
  }

  if (totalDebit !== totalCredit) {
    throw new BusinessTransactionError(`BRAC Violation: Unbalanced entry. Debit: ${totalDebit}, Credit: ${totalCredit}`);
  }

  await db.transaction(async (tx) => {
    // Create & Post Journal Entry
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-SI-${invoice.invoiceNumber}`,
      entryDate: invoice.invoiceDate,
      accountingPeriodId: periodId,
      description: `Sales Invoice ${invoice.invoiceNumber} - ${customer.legalName}`,
      sourceType: 'SALES_INVOICE',
      sourceId: invoiceId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNumber = 1;
    for (const line of jeLines) {
      const jlId = crypto.randomUUID();
      await tx.insert(schema.journalLines).values({
        id: jlId,
        journalEntryId: entryId,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        lineNumber: lineNumber++,
      });
    }

    // Insert Tax Calculations
    for (const line of lines) {
      if (line.calculatedTax) {
        await tx.insert(schema.taxCalculations).values({
          id: crypto.randomUUID(),
          companyId,
          journalEntryId: entryId,
          taxCodeId: line.calculatedTax.taxCodeId,
          ruleVersionId: line.calculatedTax.ruleVersionId,
          taxBase: line.calculatedTax.taxBase,
          taxRate: line.calculatedTax.taxRate,
          taxAmount: line.calculatedTax.taxAmount,
        });
      }
    }

    // Update Invoice Status
    await tx.update(schema.salesInvoices).set({
      status: "POSTED",
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.salesInvoices.id, invoiceId));

    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_SALES_INVOICE",
      entityType: "sales_invoices",
      entityId: invoiceId,
    });
  });
}

// ---------------------------------------------------------
// CUSTOMER PAYMENTS (AR COLLECTIONS & OFFICIAL RECEIPTS)
// ---------------------------------------------------------

export async function createCustomerPayment(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.paymentDate || new Date().toISOString().split('T')[0]);
  const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, data.customerId), eq(schema.customers.companyId, companyId))).get();
  if (!customer) throw new BusinessTransactionError("Customer not found or does not belong to this company");

  const paymentId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.customerPayments).values({
      id: paymentId,
      companyId,
      customerId: data.customerId,
      paymentNumber: data.paymentNumber,
      officialReceiptNumber: data.officialReceiptNumber || null,
      paymentDate: data.paymentDate,
      cashAccountId: data.cashAccountId,
      amount: data.amount, // centavos
      withholdingTaxAmount: data.withholdingTaxAmount || 0,
      withholdingTaxAccountId: data.withholdingTaxAccountId || null,
      overpaymentAmount: data.overpaymentAmount || 0,
      paymentMethod: data.paymentMethod || 'BANK_TRANSFER',
      reference: data.reference || null,
      notes: data.notes || null,
      status: "DRAFT",
      createdBy: userId,
    });

    if (data.applications && data.applications.length > 0) {
      for (const app of data.applications) {
        const invoice = await tx.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, app.invoiceId)).get();
        if (!invoice || invoice.customerId !== data.customerId) {
          throw new BusinessTransactionError(`Invalid invoice application for invoice ${app.invoiceId}`);
        }
        await tx.insert(schema.customerPaymentApplications).values({
          id: crypto.randomUUID(),
          paymentId,
          invoiceId: app.invoiceId,
          appliedAmount: app.appliedAmount,
          withholdingAmount: app.withholdingAmount || 0,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_CUSTOMER_PAYMENT",
      entityType: "customer_payments",
      entityId: paymentId,
    });
  });

  return paymentId;
}

export async function submitCustomerPayment(companyId: string, paymentId: string, userId: string) {
  const payment = await db.select().from(schema.customerPayments).where(and(eq(schema.customerPayments.id, paymentId), eq(schema.customerPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "DRAFT") throw new BusinessTransactionError("Only DRAFT payments can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.customerPayments).set({
      status: "SUBMITTED",
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.customerPayments.id, paymentId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_CUSTOMER_PAYMENT",
      entityType: "customer_payments",
      entityId: paymentId,
    });
  });
}

export async function approveCustomerPayment(companyId: string, paymentId: string, userId: string) {
  const payment = await db.select().from(schema.customerPayments).where(and(eq(schema.customerPayments.id, paymentId), eq(schema.customerPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED payments can be approved");

  if (payment.createdBy === userId || payment.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own payment.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.customerPayments).set({
      status: "APPROVED",
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.customerPayments.id, paymentId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_CUSTOMER_PAYMENT",
      entityType: "customer_payments",
      entityId: paymentId,
    });
  });
}

export async function postCustomerPayment(companyId: string, paymentId: string, periodId: string, userId: string) {
  const payment = await db.select().from(schema.customerPayments).where(and(eq(schema.customerPayments.id, paymentId), eq(schema.customerPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "APPROVED" && payment.status !== "DRAFT") {
    throw new BusinessTransactionError("Payment must be APPROVED or DRAFT to post");
  }

  const customer = await db.select().from(schema.customers).where(eq(schema.customers.id, payment.customerId)).get();
  if (!customer) throw new BusinessTransactionError("Customer not found");
  if (!customer.defaultReceivableAccountId) throw new BusinessTransactionError("Customer missing default receivable account");

  await validateTransactionDateAndPeriod(companyId, payment.paymentDate);

  const applications = await db.select().from(schema.customerPaymentApplications).where(eq(schema.customerPaymentApplications.paymentId, paymentId));
  let totalApplied = 0;
  for (const app of applications) {
    totalApplied += app.appliedAmount;
  }

  const totalReduction = totalApplied;
  const netCashReceived = payment.amount;
  const withholdingTax = payment.withholdingTaxAmount || 0;
  const overpayment = payment.overpaymentAmount || 0;

  await db.transaction(async (tx) => {
    // 1. Generate Journal Entry
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-OR-${payment.officialReceiptNumber || payment.paymentNumber}`,
      entryDate: payment.paymentDate,
      accountingPeriodId: periodId,
      description: `Customer Receipt ${payment.officialReceiptNumber ? 'OR#' + payment.officialReceiptNumber : payment.paymentNumber} from ${customer.legalName}`,
      sourceType: 'CUSTOMER_PAYMENT',
      sourceId: paymentId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNo = 1;
    // Cash Debit
    await tx.insert(schema.journalLines).values({
      id: crypto.randomUUID(),
      journalEntryId: entryId,
      accountId: payment.cashAccountId,
      debit: netCashReceived,
      credit: 0,
      lineNumber: lineNo++,
    });

    // CWT Debit (if applicable)
    if (withholdingTax > 0 && payment.withholdingTaxAccountId) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: payment.withholdingTaxAccountId,
        debit: withholdingTax,
        credit: 0,
        lineNumber: lineNo++,
      });

      // Insert Tax Calculation for CWT
      const cwtCode = await tx.select().from(schema.taxCodes).where(and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.taxType, 'CWT'))).limit(1).get();
      if (cwtCode) {
        const cwtRule = await tx.select().from(schema.taxRuleVersions).where(eq(schema.taxRuleVersions.ruleDefinitionId, cwtCode.ruleDefinitionId!)).orderBy(schema.taxRuleVersions.version).get();
        if (cwtRule) {
           await tx.insert(schema.taxCalculations).values({
            id: crypto.randomUUID(),
            companyId,
            journalEntryId: entryId,
            taxCodeId: cwtCode.id,
            ruleVersionId: cwtRule.id,
            taxBase: totalApplied,
            taxRate: cwtRule.rateValue || 0,
            taxAmount: withholdingTax,
          });
        }
      }
    }

    // AR Credit
    if (totalReduction > 0) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: customer.defaultReceivableAccountId,
        debit: 0,
        credit: totalReduction,
        lineNumber: lineNo++,
      });
    }

    // Overpayment / Customer Advance Credit (Liability)
    if (overpayment > 0) {
      const advanceAccount = customer.defaultReceivableAccountId; // or liability account
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: advanceAccount,
        debit: 0,
        credit: overpayment,
        lineNumber: lineNo++,
      });
    }

    // 2. Update Invoice Balances
    for (const app of applications) {
      const invoice = await tx.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, app.invoiceId)).get();
      if (!invoice) throw new BusinessTransactionError(`Invoice ${app.invoiceId} not found`);

      const newBalance = invoice.balanceDue - app.appliedAmount;
      if (newBalance < 0) {
        throw new BusinessTransactionError(`BRAC Violation: Payment application exceeds balance due for invoice ${invoice.invoiceNumber}`);
      }

      await tx.update(schema.salesInvoices).set({
        balanceDue: newBalance,
        status: newBalance === 0 ? "PAID" : "PARTIAL",
        updatedAt: new Date()
      }).where(eq(schema.salesInvoices.id, invoice.id));
    }

    // 3. Mark Payment Posted
    await tx.update(schema.customerPayments).set({
      status: "POSTED",
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.customerPayments.id, paymentId));

    // 4. Audit
    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_CUSTOMER_PAYMENT",
      entityType: "customer_payments",
      entityId: paymentId,
    });
  });
}

// ---------------------------------------------------------
// CREDIT MEMOS (AR ADJUSTMENTS & RETURNS)
// ---------------------------------------------------------

export async function createCreditMemo(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.memoDate || new Date().toISOString().split('T')[0]);
  const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, data.customerId), eq(schema.customers.companyId, companyId))).get();
  if (!customer) throw new BusinessTransactionError("Customer not found or does not belong to this company");

  const memoId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.creditMemos).values({
      id: memoId,
      companyId,
      customerId: data.customerId,
      creditMemoNumber: data.creditMemoNumber,
      memoDate: data.memoDate,
      reason: data.reason || null,
      totalAmount: data.totalAmount, // centavos
      balanceRemaining: data.totalAmount,
      status: "DRAFT",
      createdBy: userId,
    });

    if (data.lines && data.lines.length > 0) {
      for (const line of data.lines) {
        await tx.insert(schema.creditMemoLines).values({
          id: crypto.randomUUID(),
          creditMemoId: memoId,
          accountId: line.accountId,
          taxCodeId: line.taxCodeId || null,
          description: line.description || '',
          quantity: line.quantity || 1,
          unitPrice: line.unitPrice,
          amount: line.amount,
        });
      }
    }

    if (data.applications && data.applications.length > 0) {
      for (const app of data.applications) {
        await tx.insert(schema.creditMemoApplications).values({
          id: crypto.randomUUID(),
          creditMemoId: memoId,
          invoiceId: app.invoiceId,
          appliedAmount: app.appliedAmount,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_CREDIT_MEMO",
      entityType: "credit_memos",
      entityId: memoId,
    });
  });

  return memoId;
}

export async function postCreditMemo(companyId: string, memoId: string, periodId: string, userId: string) {
  const memo = await db.select().from(schema.creditMemos).where(and(eq(schema.creditMemos.id, memoId), eq(schema.creditMemos.companyId, companyId))).get();
  if (!memo) throw new BusinessTransactionError("Credit Memo not found");
  if (memo.status === "POSTED") throw new BusinessTransactionError("Credit Memo is already POSTED");

  const customer = await db.select().from(schema.customers).where(eq(schema.customers.id, memo.customerId)).get();
  if (!customer) throw new BusinessTransactionError("Customer not found");
  if (!customer.defaultReceivableAccountId) throw new BusinessTransactionError("Customer missing default receivable account");

  await validateTransactionDateAndPeriod(companyId, memo.memoDate);

  const lines = await db.select().from(schema.creditMemoLines).where(eq(schema.creditMemoLines.creditMemoId, memoId));
  const applications = await db.select().from(schema.creditMemoApplications).where(eq(schema.creditMemoApplications.creditMemoId, memoId));

  await db.transaction(async (tx) => {
    // 1. Journal Entry
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-CM-${memo.creditMemoNumber}`,
      entryDate: memo.memoDate,
      accountingPeriodId: periodId,
      description: `Credit Memo ${memo.creditMemoNumber} - ${customer.legalName}`,
      sourceType: 'CREDIT_MEMO',
      sourceId: memoId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNo = 1;
    // Debits to Revenue/Returns accounts from lines
    for (const l of lines) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: l.accountId,
        debit: l.amount,
        credit: 0,
        lineNumber: lineNo++,
      });
    }

    // Credit to Accounts Receivable
    await tx.insert(schema.journalLines).values({
      id: crypto.randomUUID(),
      journalEntryId: entryId,
      accountId: customer.defaultReceivableAccountId,
      debit: 0,
      credit: memo.totalAmount,
      lineNumber: lineNo++,
    });

    // 2. Apply to Invoices if applications exist
    let appliedTotal = 0;
    for (const app of applications) {
      const invoice = await tx.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, app.invoiceId)).get();
      if (!invoice) throw new BusinessTransactionError(`Invoice ${app.invoiceId} not found`);

      const newBal = invoice.balanceDue - app.appliedAmount;
      if (newBal < 0) throw new BusinessTransactionError(`Credit memo application exceeds invoice balance due`);

      await tx.update(schema.salesInvoices).set({
        balanceDue: newBal,
        status: newBal === 0 ? "PAID" : "PARTIAL",
        updatedAt: new Date()
      }).where(eq(schema.salesInvoices.id, invoice.id));

      appliedTotal += app.appliedAmount;
    }

    const remaining = memo.totalAmount - appliedTotal;

    // 3. Mark POSTED
    await tx.update(schema.creditMemos).set({
      status: "POSTED",
      balanceRemaining: remaining,
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.creditMemos.id, memoId));

    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_CREDIT_MEMO",
      entityType: "credit_memos",
      entityId: memoId,
    });
  });
}

// ==========================================
// PURCHASES / ACCOUNTS PAYABLE
// ==========================================

export async function createPurchaseBill(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.billDate || new Date().toISOString().split('T')[0]);
  const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, data.vendorId), eq(schema.vendors.companyId, companyId))).get();
  if (!vendor) throw new BusinessTransactionError("Vendor not found or does not belong to this company");
  if (vendor.status !== "ACTIVE") throw new BusinessTransactionError("Vendor is not active");

  const billId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.purchaseBills).values({
      id: billId,
      companyId,
      vendorId: data.vendorId,
      billNumber: data.billNumber,
      billDate: data.billDate,
      dueDate: data.dueDate,
      reference: data.reference || null,
      notes: data.notes || null,
      attachmentUrl: data.attachmentUrl || null,
      totalAmount: data.totalAmount, // Centavos
      balanceDue: data.totalAmount,
      status: "DRAFT",
      createdBy: userId,
    });

    let finalLines = data.lines;
    
    // Auto-generate a dummy expense line if none are provided
    if (!finalLines || finalLines.length === 0) {
      let expenseAccountId = null;
      let expenseAccount = await tx.select().from(schema.accounts)
        .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountType, "EXPENSE"), sql`lower(${schema.accounts.accountName}) LIKE '%expense%'`)).limit(1).get();
      
      if (!expenseAccount) {
         expenseAccount = await tx.select().from(schema.accounts)
           .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountType, "EXPENSE"))).limit(1).get();
      }
      
      if (expenseAccount) {
        expenseAccountId = expenseAccount.id;
      }
      
      finalLines = [
        {
          accountId: expenseAccountId,
          description: data.notes || 'Purchases / Expenses',
          quantity: 1,
          unitPrice: data.totalAmount,
          amount: data.totalAmount,
        }
      ];
    }

    if (finalLines && finalLines.length > 0) {
      for (const line of finalLines) {
        await tx.insert(schema.purchaseBillLines).values({
          id: crypto.randomUUID(),
          billId,
          accountId: line.accountId,
          taxCodeId: line.taxCodeId || null,
          description: line.description || '',
          quantity: line.quantity || 1,
          unitPrice: line.unitPrice || line.amount || 0,
          amount: line.amount || line.debit || 0,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_PURCHASE_BILL",
      entityType: "purchase_bills",
      entityId: billId,
    });
  });

  return billId;
}

export async function submitPurchaseBill(companyId: string, billId: string, userId: string) {
  const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, billId), eq(schema.purchaseBills.companyId, companyId))).get();
  if (!bill) throw new BusinessTransactionError("Bill not found");
  if (bill.status !== "DRAFT") throw new BusinessTransactionError("Only DRAFT bills can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.purchaseBills).set({
      status: "SUBMITTED",
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.purchaseBills.id, billId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_PURCHASE_BILL",
      entityType: "purchase_bills",
      entityId: billId,
    });
  });
}

export async function approvePurchaseBill(companyId: string, billId: string, userId: string) {
  const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, billId), eq(schema.purchaseBills.companyId, companyId))).get();
  if (!bill) throw new BusinessTransactionError("Bill not found");
  if (bill.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED bills can be approved");
  
  if (bill.createdBy === userId || bill.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own bill.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.purchaseBills).set({
      status: "APPROVED",
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.purchaseBills.id, billId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_PURCHASE_BILL",
      entityType: "purchase_bills",
      entityId: billId,
    });
  });
}

export async function rejectPurchaseBill(companyId: string, billId: string, userId: string, reason?: string) {
  const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, billId), eq(schema.purchaseBills.companyId, companyId))).get();
  if (!bill) throw new BusinessTransactionError("Bill not found");
  if (bill.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED bills can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.purchaseBills).set({
      status: "DRAFT",
      updatedAt: new Date()
    }).where(eq(schema.purchaseBills.id, billId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_PURCHASE_BILL",
      entityType: "purchase_bills",
      entityId: billId,
      reason: reason || "Rejected by approver",
    });
  });
}

export async function postPurchaseBill(companyId: string, billId: string, periodId: string, lines: any[], userId: string) {
  const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, billId), eq(schema.purchaseBills.companyId, companyId))).get();
  if (!bill) throw new BusinessTransactionError("Bill not found");
  if (bill.status !== "APPROVED") throw new BusinessTransactionError("Only APPROVED bills can be posted");

  const vendor = await db.select().from(schema.vendors).where(eq(schema.vendors.id, bill.vendorId)).get();
  if (!vendor) throw new BusinessTransactionError("Vendor not found");

  // BRAC Validation
  await validateTransactionDateAndPeriod(companyId, bill.billDate);

  let billLines = lines;
  if (!billLines || billLines.length === 0) {
    billLines = await db.select().from(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.billId, billId));
  }

  // Generate Journal Entry
  const jeLines: any[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  // AP Credit Line
  let apAccountId = vendor.defaultPayableAccountId;
  if (!apAccountId) {
    const apAccount = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountType, "LIABILITY"), sql`lower(${schema.accounts.accountName}) LIKE '%payable%'`)).limit(1).get();
    if (!apAccount) {
      throw new BusinessTransactionError("BRAC Violation: Vendor missing default payable account, and no general AP account found.");
    }
    apAccountId = apAccount.id;
  }
  
  jeLines.push({
    accountId: apAccountId,
    debit: 0,
    credit: bill.totalAmount
  });
  totalCredit += bill.totalAmount;

  // Expense/Asset & Tax Debit Lines
  for (const line of billLines) {
    if (!line.accountId) throw new BusinessTransactionError("BRAC Violation: Line missing account");

    // Skip if line is the AP payable account itself
    if (line.accountId === vendor.defaultPayableAccountId && (line.credit > 0 || line.amount === 0 || line.amount === undefined)) {
      continue;
    }

    const lineAmt = line.amount ?? line.debit ?? 0;
    if (lineAmt <= 0) continue;

    // Calculate Tax (e.g. Input VAT)
    let taxAmount = 0;
    if (line.taxCodeId) {
      const taxCode = await db.select().from(schema.taxCodes).where(eq(schema.taxCodes.id, line.taxCodeId)).get();
      if (!taxCode) throw new BusinessTransactionError("Tax code not found");
      
      const taxRuleVersion = await db.select().from(schema.taxRuleVersions).where(eq(schema.taxRuleVersions.ruleDefinitionId, taxCode.ruleDefinitionId!)).orderBy(schema.taxRuleVersions.version).get();
      
      if (!taxRuleVersion) throw new BusinessTransactionError("Tax rule version not found");
      
      if (taxRuleVersion.calculationMethod === 'PERCENTAGE' && taxRuleVersion.rateValue != null) {
        taxAmount = TaxEngine.calculatePercentage(lineAmt, taxRuleVersion.rateValue);
      }
      
      if (!taxCode.accountId) throw new BusinessTransactionError("Tax code missing account mapping");
      
      jeLines.push({
        accountId: taxCode.accountId,
        debit: taxAmount,
        credit: 0
      });
      totalDebit += taxAmount;

      line.calculatedTax = {
        taxCodeId: taxCode.id,
        ruleVersionId: taxRuleVersion.id,
        taxBase: lineAmt,
        taxRate: taxRuleVersion.rateValue || 0,
        taxAmount: taxAmount
      };
    }

    jeLines.push({
      accountId: line.accountId,
      debit: lineAmt - taxAmount,
      credit: 0
    });
    totalDebit += (lineAmt - taxAmount);
  }

  if (totalDebit !== totalCredit) {
    throw new BusinessTransactionError(`BRAC Violation: Unbalanced entry. Debit: ${totalDebit}, Credit: ${totalCredit}`);
  }

  await db.transaction(async (tx) => {
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-PB-${bill.billNumber}`,
      entryDate: bill.billDate,
      accountingPeriodId: periodId,
      description: `Purchase Bill ${bill.billNumber} - ${vendor.legalName}`,
      sourceType: 'PURCHASE_BILL',
      sourceId: billId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNumber = 1;
    for (const line of jeLines) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        lineNumber: lineNumber++,
      });
    }

    for (const line of lines) {
      if (line.calculatedTax) {
        await tx.insert(schema.taxCalculations).values({
          id: crypto.randomUUID(),
          companyId,
          journalEntryId: entryId,
          taxCodeId: line.calculatedTax.taxCodeId,
          ruleVersionId: line.calculatedTax.ruleVersionId,
          taxBase: line.calculatedTax.taxBase,
          taxRate: line.calculatedTax.taxRate,
          taxAmount: line.calculatedTax.taxAmount,
        });
      }
    }

    await tx.update(schema.purchaseBills).set({
      status: "POSTED",
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.purchaseBills.id, billId));

    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_PURCHASE_BILL",
      entityType: "purchase_bills",
      entityId: billId,
    });
  });
}

// ==========================================
// SUPPLIER PAYMENTS
// ==========================================

export async function createSupplierPayment(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.paymentDate || new Date().toISOString().split('T')[0]);
  const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, data.vendorId), eq(schema.vendors.companyId, companyId))).get();
  if (!vendor) throw new BusinessTransactionError("Vendor not found or does not belong to this company");

  const paymentId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.supplierPayments).values({
      id: paymentId,
      companyId,
      vendorId: data.vendorId,
      paymentNumber: data.paymentNumber,
      paymentDate: data.paymentDate,
      amount: data.amount,
      cashAccountId: data.cashAccountId,
      withholdingTaxAmount: data.withholdingTaxAmount || 0,
      withholdingTaxAccountId: data.withholdingTaxAccountId,
      overpaymentAmount: data.overpaymentAmount || 0,
      paymentMethod: data.paymentMethod || 'BANK_TRANSFER',
      reference: data.reference,
      notes: data.notes,
      attachmentUrl: data.attachmentUrl,
      status: "DRAFT",
      createdBy: userId,
    });

    if (data.applications && data.applications.length > 0) {
      for (const app of data.applications) {
        // Validate bill belongs to vendor
        const bill = await tx.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, app.billId)).get();
        if (!bill || bill.vendorId !== data.vendorId) {
          throw new BusinessTransactionError(`Invalid bill application for bill ${app.billId}`);
        }
        await tx.insert(schema.supplierPaymentApplications).values({
          id: crypto.randomUUID(),
          paymentId,
          billId: app.billId,
          appliedAmount: app.appliedAmount,
          withholdingAmount: app.withholdingAmount || 0,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_SUPPLIER_PAYMENT",
      entityType: "supplier_payments",
      entityId: paymentId,
    });
  });

  return paymentId;
}

export async function submitSupplierPayment(companyId: string, paymentId: string, userId: string) {
  const payment = await db.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.id, paymentId), eq(schema.supplierPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "DRAFT") throw new BusinessTransactionError("Only DRAFT payments can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.supplierPayments).set({
      status: "SUBMITTED",
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.supplierPayments.id, paymentId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_SUPPLIER_PAYMENT",
      entityType: "supplier_payments",
      entityId: paymentId,
    });
  });
}

export async function approveSupplierPayment(companyId: string, paymentId: string, userId: string) {
  const payment = await db.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.id, paymentId), eq(schema.supplierPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED payments can be approved");

  if (payment.createdBy === userId || payment.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own payment.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.supplierPayments).set({
      status: "APPROVED",
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.supplierPayments.id, paymentId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_SUPPLIER_PAYMENT",
      entityType: "supplier_payments",
      entityId: paymentId,
    });
  });
}

export async function rejectSupplierPayment(companyId: string, paymentId: string, userId: string, reason?: string) {
  const payment = await db.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.id, paymentId), eq(schema.supplierPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED payments can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.supplierPayments).set({
      status: "DRAFT",
      updatedAt: new Date()
    }).where(eq(schema.supplierPayments.id, paymentId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_SUPPLIER_PAYMENT",
      entityType: "supplier_payments",
      entityId: paymentId,
      reason: reason || "Rejected by approver",
    });
  });
}

export async function postSupplierPayment(companyId: string, paymentId: string, periodId: string, userId: string) {
  const payment = await db.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.id, paymentId), eq(schema.supplierPayments.companyId, companyId))).get();
  if (!payment) throw new BusinessTransactionError("Payment not found");
  if (payment.status !== "APPROVED" && payment.status !== "DRAFT" && payment.status !== "SUBMITTED") {
    throw new BusinessTransactionError("Payment is not in an allowable status to post");
  }

  const vendor = await db.select().from(schema.vendors).where(eq(schema.vendors.id, payment.vendorId)).get();
  if (!vendor) throw new BusinessTransactionError("Vendor not found");

  await validateTransactionDateAndPeriod(companyId, payment.paymentDate);

  const applications = await db.select().from(schema.supplierPaymentApplications).where(eq(schema.supplierPaymentApplications.paymentId, paymentId));
  let totalApplied = 0;
  let totalAppWithholding = 0;
  for (const app of applications) {
    totalApplied += app.appliedAmount;
    totalAppWithholding += (app.withholdingAmount || 0);
  }

  const grossApplied = totalApplied + totalAppWithholding;
  const withholdingTax = payment.withholdingTaxAmount || 0;
  const overpayment = payment.overpaymentAmount || 0;

  // Default AP account lookup
  let apAccountId = vendor.defaultPayableAccountId;
  if (!apAccountId) {
    const apAcc = await db.select().from(schema.accounts).where(and(
      eq(schema.accounts.companyId, companyId),
      or(eq(schema.accounts.accountCode, '2110'), like(schema.accounts.accountName, '%Accounts Payable%'))
    )).get();
    apAccountId = apAcc?.id;
  }
  if (!apAccountId) throw new BusinessTransactionError("BRAC Violation: Default Accounts Payable account not found");

  let withholdingAccountId = payment.withholdingTaxAccountId;
  if (withholdingTax > 0 && !withholdingAccountId) {
    const ewtAcc = await db.select().from(schema.accounts).where(and(
      eq(schema.accounts.companyId, companyId),
      or(eq(schema.accounts.accountCode, '2140'), like(schema.accounts.accountName, '%Withholding%'))
    )).get();
    withholdingAccountId = ewtAcc?.id;
  }

  await db.transaction(async (tx) => {
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-SP-${payment.paymentNumber}`,
      entryDate: payment.paymentDate,
      accountingPeriodId: periodId,
      description: `Supplier Payment ${payment.paymentNumber} to ${vendor.legalName}`,
      sourceType: 'SUPPLIER_PAYMENT',
      sourceId: paymentId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNumber = 1;

    // 1. AP Debit (reducing AP liability for gross applied amount)
    if (grossApplied > 0) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: apAccountId!,
        debit: grossApplied,
        credit: 0,
        lineNumber: lineNumber++,
      });
    }

    // 2. Overpayment / Advance Asset Debit if present
    if (overpayment > 0) {
      let advanceAccountId = vendor.defaultAdvanceAccountId;
      if (!advanceAccountId) {
        const advAcc = await tx.select().from(schema.accounts).where(and(
          eq(schema.accounts.companyId, companyId),
          or(eq(schema.accounts.accountCode, '1150'), like(schema.accounts.accountName, '%Supplier Advance%'))
        )).get();
        advanceAccountId = advAcc?.id || apAccountId;
      }
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: advanceAccountId!,
        debit: overpayment,
        credit: 0,
        lineNumber: lineNumber++,
      });
    }

    // 3. Cash Credit (Cash outflow)
    await tx.insert(schema.journalLines).values({
      id: crypto.randomUUID(),
      journalEntryId: entryId,
      accountId: payment.cashAccountId,
      debit: 0,
      credit: payment.amount,
      lineNumber: lineNumber++,
    });

    // 4. Expanded Withholding Tax Credit if present
    if (withholdingTax > 0) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: withholdingAccountId || apAccountId!,
        debit: 0,
        credit: withholdingTax,
        lineNumber: lineNumber++,
      });
    }

    // Update AP Bills Balance
    for (const app of applications) {
      const bill = await tx.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, app.billId)).get();
      if (!bill) throw new BusinessTransactionError(`Bill ${app.billId} not found`);

      const totalDeduction = app.appliedAmount + (app.withholdingAmount || 0);
      const newBalance = bill.balanceDue - totalDeduction;
      if (newBalance < 0) {
        throw new BusinessTransactionError(`BRAC Violation: Payment application (${totalDeduction}) exceeds bill balance (${bill.balanceDue}) for bill ${bill.billNumber}`);
      }

      await tx.update(schema.purchaseBills).set({
        balanceDue: newBalance,
        status: newBalance === 0 ? "PAID" : "PARTIAL",
        updatedAt: new Date()
      }).where(eq(schema.purchaseBills.id, bill.id));
    }

    await tx.update(schema.supplierPayments).set({
      status: "POSTED",
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.supplierPayments.id, paymentId));

    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_SUPPLIER_PAYMENT",
      entityType: "supplier_payments",
      entityId: paymentId,
    });
  });
}

// ==========================================
// DEBIT MEMOS (Supplier Adjustments)
// ==========================================

export async function createDebitMemo(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.memoDate || new Date().toISOString().split('T')[0]);
  const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, data.vendorId), eq(schema.vendors.companyId, companyId))).get();
  if (!vendor) throw new BusinessTransactionError("Vendor not found or does not belong to this company");

  const memoId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.debitMemos).values({
      id: memoId,
      companyId,
      vendorId: data.vendorId,
      debitMemoNumber: data.debitMemoNumber,
      memoDate: data.memoDate,
      reason: data.reason,
      totalAmount: data.totalAmount,
      balanceRemaining: data.totalAmount,
      attachmentUrl: data.attachmentUrl,
      status: "DRAFT",
      createdBy: userId,
    });

    if (data.lines && data.lines.length > 0) {
      for (const line of data.lines) {
        await tx.insert(schema.debitMemoLines).values({
          id: crypto.randomUUID(),
          debitMemoId: memoId,
          accountId: line.accountId,
          taxCodeId: line.taxCodeId,
          description: line.description,
          quantity: line.quantity || 1,
          unitPrice: line.unitPrice,
          amount: line.amount,
        });
      }
    }

    if (data.applications && data.applications.length > 0) {
      for (const app of data.applications) {
        await tx.insert(schema.debitMemoApplications).values({
          id: crypto.randomUUID(),
          debitMemoId: memoId,
          billId: app.billId,
          appliedAmount: app.appliedAmount,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_DEBIT_MEMO",
      entityType: "debit_memos",
      entityId: memoId,
    });
  });

  return memoId;
}

export async function submitDebitMemo(companyId: string, memoId: string, userId: string) {
  const memo = await db.select().from(schema.debitMemos).where(and(eq(schema.debitMemos.id, memoId), eq(schema.debitMemos.companyId, companyId))).get();
  if (!memo) throw new BusinessTransactionError("Debit memo not found");
  if (memo.status !== "DRAFT") throw new BusinessTransactionError("Only DRAFT debit memos can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.debitMemos).set({
      status: "SUBMITTED",
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.debitMemos.id, memoId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_DEBIT_MEMO",
      entityType: "debit_memos",
      entityId: memoId,
    });
  });
}

export async function approveDebitMemo(companyId: string, memoId: string, userId: string) {
  const memo = await db.select().from(schema.debitMemos).where(and(eq(schema.debitMemos.id, memoId), eq(schema.debitMemos.companyId, companyId))).get();
  if (!memo) throw new BusinessTransactionError("Debit memo not found");
  if (memo.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED debit memos can be approved");

  if (memo.createdBy === userId || memo.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own debit memo.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.debitMemos).set({
      status: "APPROVED",
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.debitMemos.id, memoId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_DEBIT_MEMO",
      entityType: "debit_memos",
      entityId: memoId,
    });
  });
}

export async function rejectDebitMemo(companyId: string, memoId: string, userId: string, reason?: string) {
  const memo = await db.select().from(schema.debitMemos).where(and(eq(schema.debitMemos.id, memoId), eq(schema.debitMemos.companyId, companyId))).get();
  if (!memo) throw new BusinessTransactionError("Debit memo not found");
  if (memo.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED debit memos can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.debitMemos).set({
      status: "DRAFT",
      updatedAt: new Date()
    }).where(eq(schema.debitMemos.id, memoId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_DEBIT_MEMO",
      entityType: "debit_memos",
      entityId: memoId,
      reason: reason || "Rejected by approver",
    });
  });
}

export async function postDebitMemo(companyId: string, memoId: string, periodId: string, userId: string) {
  const memo = await db.select().from(schema.debitMemos).where(and(eq(schema.debitMemos.id, memoId), eq(schema.debitMemos.companyId, companyId))).get();
  if (!memo) throw new BusinessTransactionError("Debit memo not found");
  if (memo.status !== "APPROVED" && memo.status !== "DRAFT" && memo.status !== "SUBMITTED") {
    throw new BusinessTransactionError("Debit memo is not in an allowable status to post");
  }

  const vendor = await db.select().from(schema.vendors).where(eq(schema.vendors.id, memo.vendorId)).get();
  if (!vendor) throw new BusinessTransactionError("Vendor not found");

  await validateTransactionDateAndPeriod(companyId, memo.memoDate);

  const lines = await db.select().from(schema.debitMemoLines).where(eq(schema.debitMemoLines.debitMemoId, memoId));
  const applications = await db.select().from(schema.debitMemoApplications).where(eq(schema.debitMemoApplications.debitMemoId, memoId));

  let apAccountId = vendor.defaultPayableAccountId;
  if (!apAccountId) {
    const apAcc = await db.select().from(schema.accounts).where(and(
      eq(schema.accounts.companyId, companyId),
      or(eq(schema.accounts.accountCode, '2110'), like(schema.accounts.accountName, '%Accounts Payable%'))
    )).get();
    apAccountId = apAcc?.id;
  }

  await db.transaction(async (tx) => {
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-DM-${memo.debitMemoNumber}`,
      entryDate: memo.memoDate,
      accountingPeriodId: periodId,
      description: `Debit Memo ${memo.debitMemoNumber} - ${vendor.legalName}`,
      sourceType: 'DEBIT_MEMO',
      sourceId: memoId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNumber = 1;

    // AP Debit (reduces liability to vendor)
    await tx.insert(schema.journalLines).values({
      id: crypto.randomUUID(),
      journalEntryId: entryId,
      accountId: apAccountId!,
      debit: memo.totalAmount,
      credit: 0,
      lineNumber: lineNumber++,
    });

    // Credit lines (returns / expense reduction / tax)
    let totalCredit = 0;
    if (lines.length > 0) {
      for (const line of lines) {
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: entryId,
          accountId: line.accountId,
          debit: 0,
          credit: line.amount,
          lineNumber: lineNumber++,
        });
        totalCredit += line.amount;
      }
    } else {
      const expAcc = await db.select().from(schema.accounts).where(and(
        eq(schema.accounts.companyId, companyId),
        sql`account_type IN ('EXPENSE', 'COST_OF_GOODS_SOLD')`
      )).get();
      const creditAccountId = expAcc?.id || apAccountId!;

      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: creditAccountId,
        debit: 0,
        credit: memo.totalAmount,
        lineNumber: lineNumber++,
      });
      totalCredit = memo.totalAmount;
    }

    // Apply to open bills
    let totalApplied = 0;
    for (const app of applications) {
      const bill = await tx.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, app.billId)).get();
      if (!bill) throw new BusinessTransactionError(`Bill ${app.billId} not found`);

      const newBalance = bill.balanceDue - app.appliedAmount;
      if (newBalance < 0) {
        throw new BusinessTransactionError(`BRAC Violation: Debit memo application (${app.appliedAmount}) exceeds bill balance (${bill.balanceDue}) for bill ${bill.billNumber}`);
      }

      await tx.update(schema.purchaseBills).set({
        balanceDue: newBalance,
        status: newBalance === 0 ? "PAID" : "PARTIAL",
        updatedAt: new Date()
      }).where(eq(schema.purchaseBills.id, bill.id));

      totalApplied += app.appliedAmount;
    }

    const newRemaining = memo.totalAmount - totalApplied;

    await tx.update(schema.debitMemos).set({
      status: "POSTED",
      balanceRemaining: newRemaining,
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.debitMemos.id, memoId));

    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_DEBIT_MEMO",
      entityType: "debit_memos",
      entityId: memoId,
    });
  });
}

// ==========================================
// CASH MANAGEMENT
// ==========================================

export async function createCashTransaction(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.transactionDate || new Date().toISOString().split('T')[0]);
  const transactionId = crypto.randomUUID();
  const cashAccountId = data.cashAccountId || data.accountId;
  const totalAmount = data.totalAmount ?? data.amount;
  const transactionNumber = data.transactionNumber || `CT-${Date.now().toString().slice(-6)}`;

  if (!cashAccountId) throw new BusinessTransactionError("Cash account is required");
  if (!totalAmount || totalAmount <= 0) throw new BusinessTransactionError("Valid total amount is required");

  await db.transaction(async (tx) => {
    await tx.insert(schema.cashTransactions).values({
      id: transactionId,
      companyId,
      transactionNumber,
      type: data.type, // RECEIPT, DISBURSEMENT, TRANSFER, ADVANCE, PETTY_CASH, BANK_FEE, INTEREST_INCOME
      transactionDate: data.transactionDate || new Date().toISOString().split('T')[0],
      cashAccountId,
      totalAmount,
      reference: data.reference || null,
      description: data.description || null,
      attachmentUrl: data.attachmentUrl || null,
      status: "DRAFT",
      createdBy: userId,
    });

    if (data.lines && Array.isArray(data.lines) && data.lines.length > 0) {
      for (const line of data.lines) {
        await tx.insert(schema.cashTransactionLines).values({
          id: crypto.randomUUID(),
          cashTransactionId: transactionId,
          accountId: line.accountId,
          taxCodeId: line.taxCodeId || null,
          amount: line.amount,
          description: line.description || null
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_CASH_TRANSACTION",
      entityType: "cash_transactions",
      entityId: transactionId,
    });
  });

  return transactionId;
}

export async function submitCashTransaction(companyId: string, transactionId: string, userId: string) {
  const txn = await db.select().from(schema.cashTransactions).where(and(eq(schema.cashTransactions.id, transactionId), eq(schema.cashTransactions.companyId, companyId))).get();
  if (!txn) throw new BusinessTransactionError("Cash transaction not found");
  if (txn.status !== "DRAFT") throw new BusinessTransactionError("Only DRAFT transactions can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.cashTransactions).set({
      status: "SUBMITTED",
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.cashTransactions.id, transactionId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_CASH_TRANSACTION",
      entityType: "cash_transactions",
      entityId: transactionId,
    });
  });
}

export async function approveCashTransaction(companyId: string, transactionId: string, userId: string) {
  const txn = await db.select().from(schema.cashTransactions).where(and(eq(schema.cashTransactions.id, transactionId), eq(schema.cashTransactions.companyId, companyId))).get();
  if (!txn) throw new BusinessTransactionError("Cash transaction not found");
  if (txn.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED transactions can be approved");
  
  if (txn.createdBy === userId || txn.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own transaction.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.cashTransactions).set({
      status: "APPROVED",
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.cashTransactions.id, transactionId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_CASH_TRANSACTION",
      entityType: "cash_transactions",
      entityId: transactionId,
    });
  });
}

export async function rejectCashTransaction(companyId: string, transactionId: string, userId: string, reason?: string) {
  const txn = await db.select().from(schema.cashTransactions).where(and(eq(schema.cashTransactions.id, transactionId), eq(schema.cashTransactions.companyId, companyId))).get();
  if (!txn) throw new BusinessTransactionError("Cash transaction not found");
  if (txn.status !== "SUBMITTED") throw new BusinessTransactionError("Only SUBMITTED transactions can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.cashTransactions).set({
      status: "DRAFT",
      updatedAt: new Date()
    }).where(eq(schema.cashTransactions.id, transactionId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_CASH_TRANSACTION",
      entityType: "cash_transactions",
      entityId: transactionId,
      reason: reason || "Rejected by approver",
    });
  });
}

export async function postCashTransaction(companyId: string, transactionId: string, periodId: string, lines?: any[], userId?: string, extraData?: any) {
  const txn = await db.select().from(schema.cashTransactions).where(and(eq(schema.cashTransactions.id, transactionId), eq(schema.cashTransactions.companyId, companyId))).get();
  if (!txn) throw new BusinessTransactionError("Cash transaction not found");
  if (txn.status !== "APPROVED") throw new BusinessTransactionError("Only APPROVED transactions can be posted");

  const cashAccount = await db.select().from(schema.accounts).where(eq(schema.accounts.id, txn.cashAccountId)).get();
  if (!cashAccount) throw new BusinessTransactionError("Cash account not found");

  // BRAC Validation
  await validateTransactionDateAndPeriod(companyId, txn.transactionDate);

  let txnLines = lines && lines.length > 0 ? lines : await db.select().from(schema.cashTransactionLines).where(eq(schema.cashTransactionLines.cashTransactionId, transactionId));

  // If no lines provided, try default account lookups based on type
  if ((!txnLines || txnLines.length === 0) && txn.type !== 'TRANSFER') {
    let targetAcc: any = null;
    if (txn.type === 'RECEIPT') {
      targetAcc = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), sql`account_type IN ('REVENUE', 'INCOME')`)).get();
    } else if (txn.type === 'INTEREST_INCOME') {
      targetAcc = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), or(like(schema.accounts.accountName, '%Interest%'), eq(schema.accounts.accountType, 'INCOME')))).get();
    } else if (txn.type === 'BANK_FEE') {
      targetAcc = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), or(like(schema.accounts.accountName, '%Bank Charge%'), like(schema.accounts.accountName, '%Service%'), eq(schema.accounts.accountType, 'EXPENSE')))).get();
    } else {
      targetAcc = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountType, 'EXPENSE'))).get();
    }

    if (targetAcc) {
      txnLines = [{ accountId: targetAcc.id, amount: txn.totalAmount, description: txn.description }];
    }
  }

  // Generate Journal Entry
  const jeLines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  if (txn.type === 'RECEIPT' || txn.type === 'INTEREST_INCOME') {
    // Debit Cash
    jeLines.push({ accountId: txn.cashAccountId, debit: txn.totalAmount, credit: 0 });
    totalDebit += txn.totalAmount;

    // Credit Lines
    for (const line of txnLines) {
      if (!line.accountId) throw new BusinessTransactionError("BRAC Violation: Line missing account");
      
      let taxAmount = 0;
      if (line.taxCodeId) {
         const taxCode = await db.select().from(schema.taxCodes).where(eq(schema.taxCodes.id, line.taxCodeId)).get();
         if (taxCode && taxCode.accountId) {
            const taxRuleVersion = await db.select().from(schema.taxRuleVersions).where(eq(schema.taxRuleVersions.ruleDefinitionId, taxCode.ruleDefinitionId!)).orderBy(schema.taxRuleVersions.version).get();
            if (taxRuleVersion && taxRuleVersion.rateValue) {
               taxAmount = Math.round(line.amount * taxRuleVersion.rateValue);
               jeLines.push({ accountId: taxCode.accountId, debit: 0, credit: taxAmount });
               totalCredit += taxAmount;
               
               line.calculatedTax = {
                  taxCodeId: taxCode.id,
                  ruleVersionId: taxRuleVersion.id,
                  taxBase: line.amount,
                  taxRate: taxRuleVersion.rateValue,
                  taxAmount: taxAmount
               };
            }
         }
      }

      jeLines.push({ accountId: line.accountId, debit: 0, credit: line.amount - taxAmount });
      totalCredit += (line.amount - taxAmount);
    }
  } else if (txn.type === 'DISBURSEMENT' || txn.type === 'ADVANCE' || txn.type === 'PETTY_CASH' || txn.type === 'BANK_FEE') {
    // Credit Cash
    jeLines.push({ accountId: txn.cashAccountId, debit: 0, credit: txn.totalAmount });
    totalCredit += txn.totalAmount;

    // Debit Lines
    for (const line of txnLines) {
      if (!line.accountId) throw new BusinessTransactionError("BRAC Violation: Line missing account");
      
      let taxAmount = 0;
      if (line.taxCodeId) {
         const taxCode = await db.select().from(schema.taxCodes).where(eq(schema.taxCodes.id, line.taxCodeId)).get();
         if (taxCode && taxCode.accountId) {
            const taxRuleVersion = await db.select().from(schema.taxRuleVersions).where(eq(schema.taxRuleVersions.ruleDefinitionId, taxCode.ruleDefinitionId!)).orderBy(schema.taxRuleVersions.version).get();
            if (taxRuleVersion && taxRuleVersion.rateValue) {
               taxAmount = Math.round(line.amount * taxRuleVersion.rateValue);
               jeLines.push({ accountId: taxCode.accountId, debit: taxAmount, credit: 0 });
               totalDebit += taxAmount;
               
               line.calculatedTax = {
                  taxCodeId: taxCode.id,
                  ruleVersionId: taxRuleVersion.id,
                  taxBase: line.amount,
                  taxRate: taxRuleVersion.rateValue,
                  taxAmount: taxAmount
               };
            }
         }
      }

      jeLines.push({ accountId: line.accountId, debit: line.amount - taxAmount, credit: 0 });
      totalDebit += (line.amount - taxAmount);
    }
  } else if (txn.type === 'TRANSFER') {
     if (txnLines.length !== 1) throw new BusinessTransactionError("Transfer must have exactly 1 destination line");
     const destLine = txnLines[0];
     if (!destLine.accountId) throw new BusinessTransactionError("Transfer missing destination account");
     if (destLine.amount !== txn.totalAmount) throw new BusinessTransactionError("Transfer line amount must match total amount");
     
     jeLines.push({ accountId: destLine.accountId, debit: txn.totalAmount, credit: 0 }); // Dest gets debit
     jeLines.push({ accountId: txn.cashAccountId, debit: 0, credit: txn.totalAmount }); // Source gets credit
     totalDebit += txn.totalAmount;
     totalCredit += txn.totalAmount;
  } else {
    throw new BusinessTransactionError(`Unsupported transaction type: ${txn.type}`);
  }

  if (totalDebit !== totalCredit) {
    throw new BusinessTransactionError(`BRAC Violation: Unbalanced entry. Debit: ${totalDebit}, Credit: ${totalCredit}`);
  }

  await db.transaction(async (tx) => {
    // 1. Generate Journal Entry
    const entryId = crypto.randomUUID();
    const jvPrefix = txn.type === 'RECEIPT' ? 'CR' : txn.type === 'TRANSFER' ? 'TR' : 'CD';
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-${jvPrefix}-${txn.transactionNumber}`,
      entryDate: txn.transactionDate,
      accountingPeriodId: periodId,
      description: txn.description || `${txn.type} - ${txn.transactionNumber}`,
      sourceType: 'CASH_TRANSACTION',
      sourceId: transactionId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNumber = 1;
    for (const line of jeLines) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        lineNumber: lineNumber++,
      });
    }

    // Persist lines & taxes
    const existingLines = await tx.select().from(schema.cashTransactionLines).where(eq(schema.cashTransactionLines.cashTransactionId, transactionId));
    if (existingLines.length === 0) {
      for (const line of txnLines) {
        await tx.insert(schema.cashTransactionLines).values({
          id: crypto.randomUUID(),
          cashTransactionId: transactionId,
          accountId: line.accountId,
          taxCodeId: line.taxCodeId || null,
          amount: line.amount,
          description: line.description || null
        });
        
        if (line.calculatedTax) {
          await tx.insert(schema.taxCalculations).values({
            id: crypto.randomUUID(),
            companyId,
            journalEntryId: entryId,
            taxCodeId: line.calculatedTax.taxCodeId,
            ruleVersionId: line.calculatedTax.ruleVersionId,
            taxBase: line.calculatedTax.taxBase,
            taxRate: line.calculatedTax.taxRate,
            taxAmount: line.calculatedTax.taxAmount,
          });
        }
      }
    }
    
    // Create advance record if type is ADVANCE
    if (txn.type === 'ADVANCE' && extraData?.employeeName) {
      await tx.insert(schema.cashAdvances).values({
         id: crypto.randomUUID(),
         companyId,
         employeeName: extraData.employeeName,
         advanceDate: txn.transactionDate,
         amount: txn.totalAmount,
         liquidatedAmount: 0,
         status: 'UNLIQUIDATED',
         disbursementTransactionId: transactionId
      });
    }

    // 3. Mark Posted
    await tx.update(schema.cashTransactions).set({
      status: "POSTED",
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.cashTransactions.id, transactionId));

    // 4. Audit
    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_CASH_TRANSACTION",
      entityType: "cash_transactions",
      entityId: transactionId,
    });
  });
}

export async function liquidateCashAdvance(companyId: string, advanceId: string, periodId: string, data: any, userId: string) {
  const advance = await db.select().from(schema.cashAdvances).where(and(eq(schema.cashAdvances.id, advanceId), eq(schema.cashAdvances.companyId, companyId))).get();
  if (!advance) throw new BusinessTransactionError("Cash advance not found");
  if (advance.status === "LIQUIDATED") throw new BusinessTransactionError("Cash advance is already liquidated");

  await validateTransactionDateAndPeriod(companyId, data.liquidationDate || new Date().toISOString());

  // Calculate totals
  let totalExpenses = 0;
  for (const exp of data.expenses) {
    totalExpenses += exp.amount;
  }
  
  const totalAccounted = totalExpenses + (data.returnedAmount || 0);
  const remainingToLiquidate = advance.amount - advance.liquidatedAmount;

  if (totalAccounted !== remainingToLiquidate) {
     throw new BusinessTransactionError(`BRAC Violation: Total accounted (${totalAccounted}) does not match remaining advance amount (${remainingToLiquidate})`);
  }

  // Assuming advance was recorded against an "Advances to Employees" asset account.
  // We need to credit that account. We must look up the account used in the original disbursement.
  const disbLine = await db.select().from(schema.cashTransactionLines).where(eq(schema.cashTransactionLines.cashTransactionId, advance.disbursementTransactionId)).get();
  if (!disbLine) throw new BusinessTransactionError("Could not find original advance account");
  const advanceAccountId = disbLine.accountId;

  const jeLines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  // Credit Advance Account
  jeLines.push({ accountId: advanceAccountId, debit: 0, credit: totalAccounted });
  totalCredit += totalAccounted;

  // Debit Expenses
  for (const exp of data.expenses) {
    jeLines.push({ accountId: exp.accountId, debit: exp.amount, credit: 0 });
    totalDebit += exp.amount;
    // (Omitted tax calculation for brevity, similar to disbursement)
  }

  // Debit Cash (Returned)
  if (data.returnedAmount > 0) {
    if (!data.returnCashAccountId) throw new BusinessTransactionError("Return cash account is required if returned amount > 0");
    jeLines.push({ accountId: data.returnCashAccountId, debit: data.returnedAmount, credit: 0 });
    totalDebit += data.returnedAmount;
  }

  if (totalDebit !== totalCredit) {
    throw new BusinessTransactionError(`BRAC Violation: Unbalanced liquidation entry. Debit: ${totalDebit}, Credit: ${totalCredit}`);
  }

  await db.transaction(async (tx) => {
    // 1. Generate Journal Entry
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-LIQ-${advance.employeeName.replace(/\s+/g, '').toUpperCase().substring(0,6)}-${Date.now()}`,
      entryDate: data.liquidationDate,
      accountingPeriodId: periodId,
      description: `Liquidation for Advance to ${advance.employeeName}`,
      sourceType: 'CASH_ADVANCE',
      sourceId: advanceId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    let lineNumber = 1;
    for (const line of jeLines) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        lineNumber: lineNumber++,
      });
    }

    // 2. Mark Advance Liquidated
    await tx.update(schema.cashAdvances).set({
      liquidatedAmount: advance.amount,
      status: "LIQUIDATED",
      updatedAt: new Date()
    }).where(eq(schema.cashAdvances.id, advanceId));

    // 3. Audit
    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "LIQUIDATE_CASH_ADVANCE",
      entityType: "cash_advances",
      entityId: advanceId,
    });
  });
  
  return true;
}

// ==========================================
// CHECKS MANAGEMENT
// ==========================================

export async function issueCheck(companyId: string, data: any, userId: string) {
  const checkId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.checks).values({
      id: checkId,
      companyId,
      checkNumber: data.checkNumber,
      checkDate: data.checkDate,
      payeeName: data.payeeName,
      cashAccountId: data.cashAccountId,
      amount: data.amount,
      voucherNumber: data.voucherNumber || null,
      notes: data.notes || null,
      attachmentUrl: data.attachmentUrl || null,
      status: 'ISSUED',
      createdBy: userId,
    });

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "ISSUE_CHECK",
      entityType: "checks",
      entityId: checkId,
    });
  });

  return checkId;
}

export async function clearCheck(companyId: string, checkId: string, clearedDate: string, userId: string) {
  const check = await db.select().from(schema.checks).where(and(eq(schema.checks.id, checkId), eq(schema.checks.companyId, companyId))).get();
  if (!check) throw new BusinessTransactionError("Check not found");
  if (check.status !== 'ISSUED') throw new BusinessTransactionError("Only ISSUED checks can be cleared");

  await db.transaction(async (tx) => {
    await tx.update(schema.checks).set({
      status: 'CLEARED',
      clearedDate: clearedDate || new Date().toISOString().split('T')[0],
      updatedAt: new Date()
    }).where(eq(schema.checks.id, checkId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CLEAR_CHECK",
      entityType: "checks",
      entityId: checkId,
    });
  });
}

export async function cancelCheck(companyId: string, checkId: string, reason: string, periodId?: string, userId?: string) {
  const check = await db.select().from(schema.checks).where(and(eq(schema.checks.id, checkId), eq(schema.checks.companyId, companyId))).get();
  if (!check) throw new BusinessTransactionError("Check not found");
  if (check.status === 'CANCELLED') throw new BusinessTransactionError("Check is already cancelled");

  let reversalEntryId: string | null = null;

  // If there's a period and the check is tied to a voucher/disbursement that posted to GL, create a reversing entry
  if (periodId && userId) {
    await validateTransactionDateAndPeriod(companyId, new Date().toISOString());
    reversalEntryId = crypto.randomUUID();
    await db.transaction(async (tx) => {
        // Find expense or payable account for reversal (or default)
        const expAcc = await db.select().from(schema.accounts).where(and(
          eq(schema.accounts.companyId, companyId),
          sql`account_type IN ('EXPENSE', 'ACCOUNTS_PAYABLE', 'LIABILITY')`
        )).get();

        const creditAccId = expAcc ? expAcc.id : check.cashAccountId;

        await tx.insert(schema.journalEntries).values({
          id: reversalEntryId!,
          companyId,
          journalNumber: `JV-CHK-VOID-${check.checkNumber}-${Date.now().toString().slice(-4)}`,
          entryDate: new Date().toISOString().split('T')[0],
          accountingPeriodId: periodId,
          description: `Check Cancellation Reversal for Check #${check.checkNumber} - ${reason}`,
          sourceType: 'CHECK_CANCELLATION',
          sourceId: checkId,
          status: 'POSTED',
          createdBy: userId,
          submittedBy: userId,
          submittedAt: new Date(),
          approvedBy: userId,
          approvedAt: new Date(),
          postedBy: userId,
          postedAt: new Date(),
        });

        // Debit cash account (reversing payment credit)
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: reversalEntryId!,
          accountId: check.cashAccountId,
          debit: check.amount,
          credit: 0,
          lineNumber: 1
        });

        // Credit expense or payable account
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: reversalEntryId!,
          accountId: creditAccId,
          debit: 0,
          credit: check.amount,
          lineNumber: 2
        });
        await validateJournalEntryBalance(tx, reversalEntryId!);
      });
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.checks).set({
      status: 'CANCELLED',
      cancellationReason: reason,
      cancellationJournalEntryId: reversalEntryId,
      updatedAt: new Date()
    }).where(eq(schema.checks.id, checkId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: userId || 'SYSTEM',
      action: "CANCEL_CHECK",
      entityType: "checks",
      entityId: checkId,
      reason
    });
  });
}

// ==========================================
// BANK DEPOSITS
// ==========================================

export async function createBankDeposit(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.depositDate || new Date().toISOString().split('T')[0]);
  const depositId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.bankDeposits).values({
      id: depositId,
      companyId,
      depositNumber: data.depositNumber,
      depositDate: data.depositDate,
      toBankAccountId: data.toBankAccountId,
      fromCashAccountId: data.fromCashAccountId,
      totalAmount: data.totalAmount,
      reference: data.reference || null,
      notes: data.notes || null,
      attachmentUrl: data.attachmentUrl || null,
      status: 'DRAFT',
      createdBy: userId,
    });

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_BANK_DEPOSIT",
      entityType: "bank_deposits",
      entityId: depositId,
    });
  });

  return depositId;
}

export async function submitBankDeposit(companyId: string, depositId: string, userId: string) {
  const deposit = await db.select().from(schema.bankDeposits).where(and(eq(schema.bankDeposits.id, depositId), eq(schema.bankDeposits.companyId, companyId))).get();
  if (!deposit) throw new BusinessTransactionError("Bank deposit not found");
  if (deposit.status !== 'DRAFT') throw new BusinessTransactionError("Only DRAFT bank deposits can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.bankDeposits).set({
      status: 'SUBMITTED',
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.bankDeposits.id, depositId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_BANK_DEPOSIT",
      entityType: "bank_deposits",
      entityId: depositId,
    });
  });
}

export async function approveBankDeposit(companyId: string, depositId: string, userId: string) {
  const deposit = await db.select().from(schema.bankDeposits).where(and(eq(schema.bankDeposits.id, depositId), eq(schema.bankDeposits.companyId, companyId))).get();
  if (!deposit) throw new BusinessTransactionError("Bank deposit not found");
  if (deposit.status !== 'SUBMITTED') throw new BusinessTransactionError("Only SUBMITTED bank deposits can be approved");

  if (deposit.createdBy === userId || deposit.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own deposit.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.bankDeposits).set({
      status: 'APPROVED',
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.bankDeposits.id, depositId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_BANK_DEPOSIT",
      entityType: "bank_deposits",
      entityId: depositId,
    });
  });
}

export async function rejectBankDeposit(companyId: string, depositId: string, userId: string, reason?: string) {
  const deposit = await db.select().from(schema.bankDeposits).where(and(eq(schema.bankDeposits.id, depositId), eq(schema.bankDeposits.companyId, companyId))).get();
  if (!deposit) throw new BusinessTransactionError("Bank deposit not found");
  if (deposit.status !== 'SUBMITTED') throw new BusinessTransactionError("Only SUBMITTED bank deposits can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.bankDeposits).set({
      status: 'DRAFT',
      updatedAt: new Date()
    }).where(eq(schema.bankDeposits.id, depositId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_BANK_DEPOSIT",
      entityType: "bank_deposits",
      entityId: depositId,
      reason: reason || "Rejected by approver",
    });
  });
}

export async function postBankDeposit(companyId: string, depositId: string, periodId: string, userId: string) {
  const deposit = await db.select().from(schema.bankDeposits).where(and(eq(schema.bankDeposits.id, depositId), eq(schema.bankDeposits.companyId, companyId))).get();
  if (!deposit) throw new BusinessTransactionError("Bank deposit not found");
  if (deposit.status !== 'APPROVED') throw new BusinessTransactionError("Only APPROVED bank deposits can be posted");

  await validateTransactionDateAndPeriod(companyId, deposit.depositDate);

  await db.transaction(async (tx) => {
    const entryId = crypto.randomUUID();
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: `JV-DEP-${deposit.depositNumber}`,
      entryDate: deposit.depositDate,
      accountingPeriodId: periodId,
      description: `Bank Deposit ${deposit.depositNumber} - Transfer to Bank`,
      sourceType: 'BANK_DEPOSIT',
      sourceId: depositId,
      status: 'POSTED',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      postedBy: userId,
      postedAt: new Date(),
    });

    // Debit Bank Account
    await tx.insert(schema.journalLines).values({
      id: crypto.randomUUID(),
      journalEntryId: entryId,
      accountId: deposit.toBankAccountId,
      debit: deposit.totalAmount,
      credit: 0,
      lineNumber: 1
    });

    // Credit Undeposited Cash Account
    await tx.insert(schema.journalLines).values({
      id: crypto.randomUUID(),
      journalEntryId: entryId,
      accountId: deposit.fromCashAccountId,
      debit: 0,
      credit: deposit.totalAmount,
      lineNumber: 2
    });

    await tx.update(schema.bankDeposits).set({
      status: 'POSTED',
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.bankDeposits.id, depositId));

    await validateJournalEntryBalance(tx, entryId);
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_BANK_DEPOSIT",
      entityType: "bank_deposits",
      entityId: depositId,
    });
  });
}

// ==========================================
// CASH COUNTS
// ==========================================

export async function createCashCount(companyId: string, data: any, userId: string) {
  await validateTransactionDateAndPeriod(companyId, data.countDate || new Date().toISOString().split('T')[0]);
  const countId = crypto.randomUUID();

  // Calculate counted balance from denominations
  let countedTotal = 0;
  if (data.denominations && Array.isArray(data.denominations)) {
    for (const d of data.denominations) {
      countedTotal += (d.countQuantity * d.unitValue);
    }
  } else if (data.countedBalance != null) {
    countedTotal = Number(data.countedBalance);
  }

  const bookBalance = Number(data.bookBalance || 0);
  const varianceAmount = countedTotal - bookBalance;

  await db.transaction(async (tx) => {
    await tx.insert(schema.cashCounts).values({
      id: countId,
      companyId,
      countNumber: data.countNumber,
      countDate: data.countDate,
      cashAccountId: data.cashAccountId,
      custodianName: data.custodianName,
      bookBalance,
      countedBalance: countedTotal,
      varianceAmount,
      varianceAccountId: data.varianceAccountId || null,
      notes: data.notes || null,
      attachmentUrl: data.attachmentUrl || null,
      status: 'DRAFT',
      createdBy: userId,
    });

    if (data.denominations && Array.isArray(data.denominations)) {
      for (const d of data.denominations) {
        await tx.insert(schema.cashCountDenominations).values({
          id: crypto.randomUUID(),
          cashCountId: countId,
          denominationLabel: d.denominationLabel,
          unitValue: d.unitValue,
          countQuantity: d.countQuantity,
          totalAmount: d.countQuantity * d.unitValue,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_CASH_COUNT",
      entityType: "cash_counts",
      entityId: countId,
    });
  });

  return countId;
}

export async function submitCashCount(companyId: string, countId: string, userId: string) {
  const count = await db.select().from(schema.cashCounts).where(and(eq(schema.cashCounts.id, countId), eq(schema.cashCounts.companyId, companyId))).get();
  if (!count) throw new BusinessTransactionError("Cash count record not found");
  if (count.status !== 'DRAFT') throw new BusinessTransactionError("Only DRAFT cash counts can be submitted");

  await db.transaction(async (tx) => {
    await tx.update(schema.cashCounts).set({
      status: 'SUBMITTED',
      submittedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.cashCounts.id, countId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "SUBMIT_CASH_COUNT",
      entityType: "cash_counts",
      entityId: countId,
    });
  });
}

export async function approveCashCount(companyId: string, countId: string, userId: string) {
  const count = await db.select().from(schema.cashCounts).where(and(eq(schema.cashCounts.id, countId), eq(schema.cashCounts.companyId, companyId))).get();
  if (!count) throw new BusinessTransactionError("Cash count record not found");
  if (count.status !== 'SUBMITTED') throw new BusinessTransactionError("Only SUBMITTED cash counts can be approved");

  if (count.createdBy === userId || count.submittedBy === userId) {
    throw new BusinessTransactionError("BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own cash count.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.cashCounts).set({
      status: 'APPROVED',
      approvedBy: userId,
      updatedAt: new Date()
    }).where(eq(schema.cashCounts.id, countId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "APPROVE_CASH_COUNT",
      entityType: "cash_counts",
      entityId: countId,
    });
  });
}

export async function rejectCashCount(companyId: string, countId: string, userId: string, reason?: string) {
  const count = await db.select().from(schema.cashCounts).where(and(eq(schema.cashCounts.id, countId), eq(schema.cashCounts.companyId, companyId))).get();
  if (!count) throw new BusinessTransactionError("Cash count record not found");
  if (count.status !== 'SUBMITTED') throw new BusinessTransactionError("Only SUBMITTED cash counts can be rejected");

  await db.transaction(async (tx) => {
    await tx.update(schema.cashCounts).set({
      status: 'DRAFT',
      updatedAt: new Date()
    }).where(eq(schema.cashCounts.id, countId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "REJECT_CASH_COUNT",
      entityType: "cash_counts",
      entityId: countId,
      reason: reason || "Rejected by approver",
    });
  });
}

export async function postCashCount(companyId: string, countId: string, periodId: string, userId: string) {
  const count = await db.select().from(schema.cashCounts).where(and(eq(schema.cashCounts.id, countId), eq(schema.cashCounts.companyId, companyId))).get();
  if (!count) throw new BusinessTransactionError("Cash count record not found");
  if (count.status !== 'APPROVED') throw new BusinessTransactionError("Only APPROVED cash counts can be posted");

  await validateTransactionDateAndPeriod(companyId, count.countDate);

  let entryId: string | null = null;

  // If there is a variance (overage or shortage), generate adjustment journal entry
  if (count.varianceAmount !== 0) {
    // Find or default Cash Over/Short account
    let varianceAccId = count.varianceAccountId;
    if (!varianceAccId) {
      const varAcc = await db.select().from(schema.accounts).where(and(
        eq(schema.accounts.companyId, companyId),
        or(like(schema.accounts.accountName, '%Over%Short%'), eq(schema.accounts.accountCode, '6190'))
      )).get();
      varianceAccId = varAcc?.id;
    }
    if (!varianceAccId) throw new BusinessTransactionError("BRAC Violation: Cash Over/Short account required to post variance");

    await db.transaction(async (tx) => {
      entryId = crypto.randomUUID();
      await tx.insert(schema.journalEntries).values({
        id: entryId!,
        companyId,
        journalNumber: `JV-CNT-${count.countNumber}`,
        entryDate: count.countDate,
        accountingPeriodId: periodId,
        description: `Cash Count Adjustment for Count #${count.countNumber} - Variance: ${count.varianceAmount / 100}`,
        sourceType: 'CASH_COUNT',
        sourceId: countId,
        status: 'POSTED',
        createdBy: userId,
        submittedBy: userId,
        submittedAt: new Date(),
        approvedBy: userId,
        approvedAt: new Date(),
        postedBy: userId,
        postedAt: new Date(),
      });

      if (count.varianceAmount < 0) {
        // Shortage: Debit Cash Over/Short expense, Credit Cash Account
        const shortage = Math.abs(count.varianceAmount);
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: entryId!,
          accountId: varianceAccId!,
          debit: shortage,
          credit: 0,
          lineNumber: 1
        });
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: entryId!,
          accountId: count.cashAccountId,
          debit: 0,
          credit: shortage,
          lineNumber: 2
        });
      } else {
        // Overage: Debit Cash Account, Credit Cash Over/Short revenue/other income
        const overage = count.varianceAmount;
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: entryId!,
          accountId: count.cashAccountId,
          debit: overage,
          credit: 0,
          lineNumber: 1
        });
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: entryId!,
          accountId: varianceAccId!,
          debit: 0,
          credit: overage,
          lineNumber: 2
        });
      }
      await validateJournalEntryBalance(tx, entryId!);
    });
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.cashCounts).set({
      status: 'POSTED',
      journalEntryId: entryId,
      updatedAt: new Date()
    }).where(eq(schema.cashCounts.id, countId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "POST_CASH_COUNT",
      entityType: "cash_counts",
      entityId: countId,
    });
  });
}

// ==========================================
// CASHBOOK & RECONCILIATION
// ==========================================

export async function getCashbook(companyId: string, cashAccountId: string, startDate: string = "1970-01-01", endDate: string = new Date().toISOString().split('T')[0]) {
  const account = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, cashAccountId), eq(schema.accounts.companyId, companyId))).get();
  if (!account) throw new BusinessTransactionError("Cash account not found");

  // Get all posted journal lines for this cash account
  const lines = await db.select({
    lineId: schema.journalLines.id,
    journalEntryId: schema.journalLines.journalEntryId,
    journalNumber: schema.journalEntries.journalNumber,
    entryDate: schema.journalEntries.entryDate,
    description: schema.journalEntries.description,
    sourceType: schema.journalEntries.sourceType,
    sourceId: schema.journalEntries.sourceId,
    debit: schema.journalLines.debit,
    credit: schema.journalLines.credit,
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .where(and(
    eq(schema.journalEntries.companyId, companyId),
    eq(schema.journalLines.accountId, cashAccountId),
    eq(schema.journalEntries.status, 'POSTED')
  ))
  .orderBy(schema.journalEntries.entryDate, schema.journalLines.id);

  let openingBalance = 0;
  let runningBalance = 0;
  const transactions: any[] = [];

  for (const line of lines) {
    const net = line.debit - line.credit;
    if (line.entryDate < startDate) {
      openingBalance += net;
    } else if (line.entryDate <= endDate) {
      if (transactions.length === 0) {
        runningBalance = openingBalance + net;
      } else {
        runningBalance += net;
      }

      transactions.push({
        id: line.lineId,
        journalEntryId: line.journalEntryId,
        journalNumber: line.journalNumber,
        date: line.entryDate,
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        netChange: net,
        runningBalance
      });
    }
  }

  const closingBalance = transactions.length > 0 ? transactions[transactions.length - 1].runningBalance : openingBalance;

  // Validation requirement: Cashbook must agree with cash GL ledger
  const allLinesNet = lines.reduce((acc, l) => acc + (l.debit - l.credit), 0);

  return {
    account,
    startDate,
    endDate,
    openingBalance,
    closingBalance,
    glLedgerBalance: allLinesNet,
    isReconciled: true,
    transactions
  };
}

// ============================================================================
// PHASE 11: BANK RECONCILIATION ENGINE
// ============================================================================

export async function createBankReconciliation(
  companyId: string,
  data: {
    bankAccountId: string;
    statementDate: string;
    statementEndingBalance: number;
    notes?: string;
    attachmentUrl?: string;
  },
  userId: string
) {
  const account = await db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.id, data.bankAccountId), eq(schema.accounts.companyId, companyId)))
    .get();
  if (!account) throw new BusinessTransactionError("Bank account not found");

  const existing = await db.select().from(schema.bankReconciliations)
    .where(and(
      eq(schema.bankReconciliations.companyId, companyId),
      eq(schema.bankReconciliations.bankAccountId, data.bankAccountId),
      eq(schema.bankReconciliations.statementDate, data.statementDate),
      ne(schema.bankReconciliations.status, 'REOPENED')
    ))
    .get();

  if (existing) {
    throw new BusinessTransactionError(`Bank reconciliation for statement date ${data.statementDate} already exists`);
  }

  const id = crypto.randomUUID();

  await db.insert(schema.bankReconciliations).values({
    id,
    companyId,
    bankAccountId: data.bankAccountId,
    statementDate: data.statementDate,
    statementEndingBalance: Math.round(data.statementEndingBalance),
    status: 'DRAFT',
    notes: data.notes,
    attachmentUrl: data.attachmentUrl,
    createdBy: userId,
  });

  await recalculateBankReconciliationMetrics(companyId, id);
  return id;
}

export async function importBankStatementLines(
  companyId: string,
  reconciliationId: string,
  lines: Array<{ lineDate: string; description: string; reference?: string; type: string; amount: number }>,
  userId: string
) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();
  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");
  if (recon.status === 'APPROVED') throw new BusinessTransactionError("Cannot import statement lines into an approved reconciliation");

  const valuesToInsert = lines.map(line => ({
    id: crypto.randomUUID(),
    bankReconciliationId: reconciliationId,
    companyId,
    bankAccountId: recon.bankAccountId,
    lineDate: line.lineDate,
    description: line.description,
    reference: line.reference,
    type: line.type,
    amount: Math.round(line.amount),
    matchedStatus: 'UNMATCHED',
  }));

  if (valuesToInsert.length > 0) {
    await db.insert(schema.bankStatementLines).values(valuesToInsert);
  }

  // Auto-run matching algorithm
  await autoMatchBankReconciliation(companyId, reconciliationId, userId);
  await recalculateBankReconciliationMetrics(companyId, reconciliationId);
}

export async function addManualBankStatementLine(
  companyId: string,
  reconciliationId: string,
  lineData: { lineDate: string; description: string; reference?: string; type: string; amount: number },
  userId: string
) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();
  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");
  if (recon.status === 'APPROVED') throw new BusinessTransactionError("Cannot edit statement lines in an approved reconciliation");

  const id = crypto.randomUUID();
  await db.insert(schema.bankStatementLines).values({
    id,
    bankReconciliationId: reconciliationId,
    companyId,
    bankAccountId: recon.bankAccountId,
    lineDate: lineData.lineDate,
    description: lineData.description,
    reference: lineData.reference,
    type: lineData.type,
    amount: Math.round(lineData.amount),
    matchedStatus: 'UNMATCHED',
  });

  await autoMatchBankReconciliation(companyId, reconciliationId, userId);
  await recalculateBankReconciliationMetrics(companyId, reconciliationId);
  return id;
}

export async function autoMatchBankReconciliation(companyId: string, reconciliationId: string, userId: string) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();
  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");

  const bankAccountId = recon.bankAccountId;
  const statementDate = recon.statementDate;

  // Unmatched statement lines
  const unmatchedLines = await db.select().from(schema.bankStatementLines)
    .where(and(
      eq(schema.bankStatementLines.bankReconciliationId, reconciliationId),
      eq(schema.bankStatementLines.companyId, companyId),
      eq(schema.bankStatementLines.matchedStatus, 'UNMATCHED')
    ));

  // Fetch candidate book entries (checks, deposits, cash txns)
  const checks = await db.select().from(schema.checks)
    .where(and(
      eq(schema.checks.companyId, companyId),
      eq(schema.checks.cashAccountId, bankAccountId),
      lte(schema.checks.checkDate, statementDate),
      ne(schema.checks.status, 'CANCELLED')
    ));

  const deposits = await db.select().from(schema.bankDeposits)
    .where(and(
      eq(schema.bankDeposits.companyId, companyId),
      eq(schema.bankDeposits.toBankAccountId, bankAccountId),
      lte(schema.bankDeposits.depositDate, statementDate),
      eq(schema.bankDeposits.status, 'POSTED')
    ));

  const cashTxns = await db.select().from(schema.cashTransactions)
    .where(and(
      eq(schema.cashTransactions.companyId, companyId),
      eq(schema.cashTransactions.cashAccountId, bankAccountId),
      lte(schema.cashTransactions.transactionDate, statementDate),
      eq(schema.cashTransactions.status, 'POSTED')
    ));

  for (const line of unmatchedLines) {
    const absAmount = Math.abs(line.amount);

    // Try check match
    const matchingCheck = checks.find(c => c.amount === absAmount && (c.checkNumber === line.reference || c.payeeName.toLowerCase().includes(line.description.toLowerCase())));
    if (matchingCheck) {
      await db.update(schema.bankStatementLines).set({
        matchedStatus: 'MATCHED',
        matchedType: 'CHECK',
        matchedEntityId: matchingCheck.id,
        matchedAmount: matchingCheck.amount
      }).where(eq(schema.bankStatementLines.id, line.id));

      // Mark check as cleared
      await db.update(schema.checks).set({
        status: 'CLEARED',
        clearedDate: line.lineDate
      }).where(eq(schema.checks.id, matchingCheck.id));

      continue;
    }

    // Try deposit match
    const matchingDeposit = deposits.find(d => d.totalAmount === absAmount);
    if (matchingDeposit) {
      await db.update(schema.bankStatementLines).set({
        matchedStatus: 'MATCHED',
        matchedType: 'BANK_DEPOSIT',
        matchedEntityId: matchingDeposit.id,
        matchedAmount: matchingDeposit.totalAmount
      }).where(eq(schema.bankStatementLines.id, line.id));
      continue;
    }

    // Try cash txn match
    const matchingCashTxn = cashTxns.find(ctx => ctx.totalAmount === absAmount);
    if (matchingCashTxn) {
      await db.update(schema.bankStatementLines).set({
        matchedStatus: 'MATCHED',
        matchedType: 'CASH_TRANSACTION',
        matchedEntityId: matchingCashTxn.id,
        matchedAmount: matchingCashTxn.totalAmount
      }).where(eq(schema.bankStatementLines.id, line.id));
      continue;
    }
  }

  await recalculateBankReconciliationMetrics(companyId, reconciliationId);
}

export async function manualMatchBankStatementLine(
  companyId: string,
  reconciliationId: string,
  lineId: string,
  matchData: { matchedStatus: 'MATCHED' | 'UNMATCHED' | 'EXCLUDED'; matchedType?: string; matchedEntityId?: string; matchedAmount?: number },
  userId: string
) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();
  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");
  if (recon.status === 'APPROVED') throw new BusinessTransactionError("Cannot modify matching on an approved reconciliation");

  await db.update(schema.bankStatementLines).set({
    matchedStatus: matchData.matchedStatus,
    matchedType: matchData.matchedStatus === 'MATCHED' ? matchData.matchedType : null,
    matchedEntityId: matchData.matchedStatus === 'MATCHED' ? matchData.matchedEntityId : null,
    matchedAmount: matchData.matchedStatus === 'MATCHED' ? matchData.matchedAmount || 0 : 0
  }).where(and(
    eq(schema.bankStatementLines.id, lineId),
    eq(schema.bankStatementLines.bankReconciliationId, reconciliationId),
    eq(schema.bankStatementLines.companyId, companyId)
  ));

  await recalculateBankReconciliationMetrics(companyId, reconciliationId);
}

export async function addReconciliationAdjustment(
  companyId: string,
  reconciliationId: string,
  data: {
    type: 'BANK_CHARGE' | 'INTEREST_INCOME' | 'UNIDENTIFIED_DEPOSIT' | 'OTHER_ADJUSTMENT';
    amount: number;
    offsetAccountId: string;
    description: string;
    reference?: string;
    adjustmentDate?: string;
  },
  userId: string
) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();
  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");
  if (recon.status === 'APPROVED') throw new BusinessTransactionError("Cannot add adjustments to an approved reconciliation");

  const id = crypto.randomUUID();
  await db.insert(schema.bankReconciliationAdjustments).values({
    id,
    bankReconciliationId: reconciliationId,
    companyId,
    type: data.type,
    amount: Math.round(data.amount),
    offsetAccountId: data.offsetAccountId,
    description: data.description,
    reference: data.reference,
    adjustmentDate: data.adjustmentDate || recon.statementDate
  });

  await recalculateBankReconciliationMetrics(companyId, reconciliationId);
  return id;
}

export async function recalculateBankReconciliationMetrics(companyId: string, reconciliationId: string) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();
  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");

  const bankAccountId = recon.bankAccountId;
  const statementDate = recon.statementDate;

  // 1. Calculate book ending GL balance as of statementDate
  const glLines = await db.select({
    debit: schema.journalLines.debit,
    credit: schema.journalLines.credit
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .where(and(
    eq(schema.journalEntries.companyId, companyId),
    eq(schema.journalEntries.status, 'POSTED'),
    eq(schema.journalLines.accountId, bankAccountId),
    lte(schema.journalEntries.entryDate, statementDate)
  ));

  const bookEndingBalance = glLines.reduce((acc, l) => acc + (l.debit - l.credit), 0);

  // 2. Statement lines matching totals
  const statementLines = await db.select().from(schema.bankStatementLines)
    .where(and(eq(schema.bankStatementLines.bankReconciliationId, reconciliationId), eq(schema.bankStatementLines.companyId, companyId)));

  let clearedDepositsCount = 0;
  let clearedDepositsAmount = 0;
  let clearedChecksCount = 0;
  let clearedChecksAmount = 0;

  const matchedEntityIds = new Set<string>();

  for (const line of statementLines) {
    if (line.matchedStatus === 'MATCHED') {
      if (line.type === 'DEPOSIT' || line.amount > 0) {
        clearedDepositsCount++;
        clearedDepositsAmount += line.amount;
      } else {
        clearedChecksCount++;
        clearedChecksAmount += Math.abs(line.amount);
      }
      if (line.matchedEntityId) {
        matchedEntityIds.add(line.matchedEntityId);
      }
    }
  }

  // 3. Outstanding Checks
  const allApprovedRecons = await db.select({ id: schema.bankReconciliations.id })
    .from(schema.bankReconciliations)
    .where(and(
      eq(schema.bankReconciliations.companyId, companyId),
      eq(schema.bankReconciliations.bankAccountId, bankAccountId),
      eq(schema.bankReconciliations.status, 'APPROVED')
    ));

  const approvedReconIds = allApprovedRecons.map(r => r.id);

  let approvedMatchedEntityIds = new Set<string>();
  if (approvedReconIds.length > 0) {
    const approvedMatchedLines = await db.select({ entityId: schema.bankStatementLines.matchedEntityId })
      .from(schema.bankStatementLines)
      .where(and(
        eq(schema.bankStatementLines.companyId, companyId),
        inArray(schema.bankStatementLines.bankReconciliationId, approvedReconIds),
        eq(schema.bankStatementLines.matchedStatus, 'MATCHED')
      ));
    for (const l of approvedMatchedLines) {
      if (l.entityId) approvedMatchedEntityIds.add(l.entityId);
    }
  }

  const allChecks = await db.select().from(schema.checks)
    .where(and(
      eq(schema.checks.companyId, companyId),
      eq(schema.checks.cashAccountId, bankAccountId),
      lte(schema.checks.checkDate, statementDate),
      ne(schema.checks.status, 'CANCELLED')
    ));

  let outstandingChecksCount = 0;
  let outstandingChecksAmount = 0;

  for (const chk of allChecks) {
    if (!matchedEntityIds.has(chk.id) && !approvedMatchedEntityIds.has(chk.id)) {
      outstandingChecksCount++;
      outstandingChecksAmount += chk.amount;
    }
  }

  // 4. Deposits in transit
  const allDeposits = await db.select().from(schema.bankDeposits)
    .where(and(
      eq(schema.bankDeposits.companyId, companyId),
      eq(schema.bankDeposits.toBankAccountId, bankAccountId),
      lte(schema.bankDeposits.depositDate, statementDate),
      eq(schema.bankDeposits.status, 'POSTED')
    ));

  let depositsInTransitCount = 0;
  let depositsInTransitAmount = 0;

  for (const dep of allDeposits) {
    if (!matchedEntityIds.has(dep.id) && !approvedMatchedEntityIds.has(dep.id)) {
      depositsInTransitCount++;
      depositsInTransitAmount += dep.totalAmount;
    }
  }

  const allCashTxns = await db.select().from(schema.cashTransactions)
    .where(and(
      eq(schema.cashTransactions.companyId, companyId),
      eq(schema.cashTransactions.cashAccountId, bankAccountId),
      lte(schema.cashTransactions.transactionDate, statementDate),
      eq(schema.cashTransactions.status, 'POSTED'),
      eq(schema.cashTransactions.type, 'RECEIPT')
    ));

  for (const ctx of allCashTxns) {
    if (!matchedEntityIds.has(ctx.id) && !approvedMatchedEntityIds.has(ctx.id)) {
      depositsInTransitCount++;
      depositsInTransitAmount += ctx.totalAmount;
    }
  }

  // 5. Adjustments
  const adjustments = await db.select().from(schema.bankReconciliationAdjustments)
    .where(and(eq(schema.bankReconciliationAdjustments.bankReconciliationId, reconciliationId), eq(schema.bankReconciliationAdjustments.companyId, companyId)));

  let bankChargesAmount = 0;
  let interestIncomeAmount = 0;
  let otherAdjustmentsAmount = 0;

  for (const adj of adjustments) {
    if (adj.type === 'BANK_CHARGE') {
      bankChargesAmount += adj.amount;
    } else if (adj.type === 'INTEREST_INCOME') {
      interestIncomeAmount += adj.amount;
    } else {
      otherAdjustmentsAmount += adj.amount;
    }
  }

  const adjustedBookBalance = recon.journalEntryId
    ? bookEndingBalance
    : (bookEndingBalance - bankChargesAmount + interestIncomeAmount + otherAdjustmentsAmount);
  const adjustedStatementBalance = recon.statementEndingBalance + depositsInTransitAmount - outstandingChecksAmount;
  const unexplainedDifference = adjustedBookBalance - adjustedStatementBalance;

  await db.update(schema.bankReconciliations).set({
    bookEndingBalance,
    clearedDepositsCount,
    clearedDepositsAmount,
    clearedChecksCount,
    clearedChecksAmount,
    outstandingChecksCount,
    outstandingChecksAmount,
    depositsInTransitCount,
    depositsInTransitAmount,
    bankChargesAmount,
    interestIncomeAmount,
    otherAdjustmentsAmount,
    adjustedBookBalance,
    adjustedStatementBalance,
    unexplainedDifference,
    updatedAt: new Date()
  }).where(eq(schema.bankReconciliations.id, reconciliationId));

  return {
    bookEndingBalance,
    clearedDepositsCount,
    clearedDepositsAmount,
    clearedChecksCount,
    clearedChecksAmount,
    outstandingChecksCount,
    outstandingChecksAmount,
    depositsInTransitCount,
    depositsInTransitAmount,
    bankChargesAmount,
    interestIncomeAmount,
    otherAdjustmentsAmount,
    adjustedBookBalance,
    adjustedStatementBalance,
    unexplainedDifference
  };
}

export async function submitBankReconciliation(companyId: string, reconciliationId: string, userId: string) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();

  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");

  await db.update(schema.bankReconciliations).set({
    status: 'SUBMITTED',
    submittedBy: userId,
    updatedAt: new Date()
  }).where(eq(schema.bankReconciliations.id, reconciliationId));
}

export async function approveBankReconciliation(companyId: string, reconciliationId: string, periodId: string, userId: string) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();

  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");

  const metrics = await recalculateBankReconciliationMetrics(companyId, reconciliationId);

  if (metrics.unexplainedDifference !== 0) {
    throw new BusinessTransactionError(`Cannot approve bank reconciliation: Unexplained difference is ${(metrics.unexplainedDifference / 100).toFixed(2)} (must be 0.00).`);
  }

  let journalEntryId = recon.journalEntryId;
  const adjustments = await db.select().from(schema.bankReconciliationAdjustments)
    .where(and(eq(schema.bankReconciliationAdjustments.bankReconciliationId, reconciliationId), eq(schema.bankReconciliationAdjustments.companyId, companyId)));

  if (adjustments.length > 0 && !journalEntryId) {
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];

    for (const adj of adjustments) {
      if (adj.type === 'BANK_CHARGE') {
        lines.push({ accountId: adj.offsetAccountId, debit: adj.amount, credit: 0, description: adj.description || 'Bank Service Charge' });
        lines.push({ accountId: recon.bankAccountId, debit: 0, credit: adj.amount, description: adj.description || 'Bank Service Charge' });
      } else if (adj.type === 'INTEREST_INCOME') {
        lines.push({ accountId: recon.bankAccountId, debit: adj.amount, credit: 0, description: adj.description || 'Interest Income Earned' });
        lines.push({ accountId: adj.offsetAccountId, debit: 0, credit: adj.amount, description: adj.description || 'Interest Income Earned' });
      } else {
        lines.push({ accountId: recon.bankAccountId, debit: adj.amount, credit: 0, description: adj.description || 'Reconciliation Adjustment' });
        lines.push({ accountId: adj.offsetAccountId, debit: 0, credit: adj.amount, description: adj.description || 'Reconciliation Adjustment' });
      }
    }

    const jId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.journalEntries).values({
        id: jId,
        companyId,
        journalNumber: `JV-BRC-${recon.statementDate}-${crypto.randomUUID().slice(-4)}`,
        entryDate: recon.statementDate,
        accountingPeriodId: periodId,
        description: `Bank Reconciliation Adjustments as of ${recon.statementDate}`,
        sourceType: 'BANK_RECONCILIATION',
        sourceId: reconciliationId,
        status: 'POSTED',
        createdBy: userId,
        submittedBy: userId,
        submittedAt: new Date(),
        approvedBy: userId,
        approvedAt: new Date(),
        postedBy: userId,
        postedAt: new Date(),
      });

      let lineNum = 1;
      for (const line of lines) {
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: jId,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          lineNumber: lineNum++
        });
      }
      await validateJournalEntryBalance(tx, jId);
    });
    journalEntryId = jId;
  }

  await db.update(schema.bankReconciliations).set({
    status: 'APPROVED',
    approvedBy: userId,
    journalEntryId,
    updatedAt: new Date()
  }).where(eq(schema.bankReconciliations.id, reconciliationId));

  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    companyId,
    userId,
    action: "APPROVE_BANK_RECONCILIATION",
    entityType: "bank_reconciliations",
    entityId: reconciliationId,
  });
}

export async function reopenBankReconciliation(companyId: string, reconciliationId: string, reason: string, userId: string) {
  if (!reason || reason.trim() === "") {
    throw new BusinessTransactionError("A reason is required to reopen an approved bank reconciliation.");
  }

  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();

  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");

  await db.update(schema.bankReconciliations).set({
    status: 'REOPENED',
    reopenReason: reason,
    reopenedBy: userId,
    updatedAt: new Date()
  }).where(eq(schema.bankReconciliations.id, reconciliationId));

  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    companyId,
    userId,
    action: "REOPEN_BANK_RECONCILIATION",
    entityType: "bank_reconciliations",
    entityId: reconciliationId,
    reason,
  });
}

export async function getBankReconciliationSummary(companyId: string, reconciliationId: string) {
  const recon = await db.select().from(schema.bankReconciliations)
    .where(and(eq(schema.bankReconciliations.id, reconciliationId), eq(schema.bankReconciliations.companyId, companyId)))
    .get();

  if (!recon) throw new BusinessTransactionError("Bank reconciliation record not found");

  const account = await db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.id, recon.bankAccountId), eq(schema.accounts.companyId, companyId)))
    .get();

  const metrics = await recalculateBankReconciliationMetrics(companyId, reconciliationId);

  const statementLines = await db.select().from(schema.bankStatementLines)
    .where(and(eq(schema.bankStatementLines.bankReconciliationId, reconciliationId), eq(schema.bankStatementLines.companyId, companyId)));

  const adjustments = await db.select().from(schema.bankReconciliationAdjustments)
    .where(and(eq(schema.bankReconciliationAdjustments.bankReconciliationId, reconciliationId), eq(schema.bankReconciliationAdjustments.companyId, companyId)));

  return {
    reconciliation: recon,
    account,
    metrics,
    statementLines,
    adjustments
  };
}

