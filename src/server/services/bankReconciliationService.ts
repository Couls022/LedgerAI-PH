import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { AuditService } from "./auditService";
import crypto from "crypto";

export interface BankAccountInput {
  companyId: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  currency?: string;
}

export interface BankStatementImportInput {
  companyId: string;
  bankAccountId: string;
  statementDate: Date;
  startDate?: Date;
  endDate?: Date;
  filename?: string;
  csvContent: string; // CSV string with columns: date, description, reference, amount, type (CREDIT/DEBIT)
  userId?: string;
}

export class BankReconciliationService {
  /**
   * Create a bank account
   */
  static async createBankAccount(input: BankAccountInput) {
    const id = crypto.randomUUID();
    const encryptedNum = crypto.createHash('sha256').update(input.accountNumber).digest('hex'); // Encrypted/hashed safe representation
    
    await db.insert(schema.bankAccounts).values({
      id,
      companyId: input.companyId,
      accountName: input.accountName,
      bankName: input.bankName,
      accountNumberEncrypted: encryptedNum,
      currency: input.currency || 'PHP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { id, accountName: input.accountName, bankName: input.bankName };
  }

  /**
   * List bank accounts for a company
   */
  static async getBankAccounts(companyId: string) {
    return await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.companyId, companyId));
  }

  /**
   * Import bank statement and parse CSV transactions with duplicate detection
   */
  static async importStatement(input: BankStatementImportInput) {
    const statementId = crypto.randomUUID();
    
    await db.insert(schema.bankStatements).values({
      id: statementId,
      companyId: input.companyId,
      bankAccountId: input.bankAccountId,
      statementDate: input.statementDate,
      startDate: input.startDate || input.statementDate,
      endDate: input.endDate || input.statementDate,
      filename: input.filename || 'statement.csv',
      status: 'IMPORTED',
      createdAt: new Date(),
    });

    // Parse CSV rows
    const lines = input.csvContent.split('\n').map(l => l.trim()).filter(Boolean);
    const transactionsToInsert: any[] = [];
    let duplicateCount = 0;

    // Skip header if present
    const startIndex = lines[0]?.toLowerCase().includes('date') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 4) {
        const [dateStr, descStr, refStr, amountStr, typeStr] = parts;
        const txDate = new Date(dateStr);
        const amount = parseFloat(amountStr) || 0;
        const type = (typeStr || (amount >= 0 ? 'CREDIT' : 'DEBIT')).toUpperCase();
        const reference = refStr || '';
        const description = descStr || 'Bank Transaction';

        // Check duplicate within bank account
        const existing = await db.select()
          .from(schema.bankTransactions)
          .where(and(
            eq(schema.bankTransactions.companyId, input.companyId),
            eq(schema.bankTransactions.bankAccountId, input.bankAccountId),
            eq(schema.bankTransactions.amount, Math.abs(amount)),
            eq(schema.bankTransactions.transactionDate, txDate),
            eq(schema.bankTransactions.description, description)
          ))
          .get();

        if (existing) {
          duplicateCount++;
          continue;
        }

        transactionsToInsert.push({
          id: crypto.randomUUID(),
          companyId: input.companyId,
          bankStatementId: statementId,
          bankAccountId: input.bankAccountId,
          transactionDate: isNaN(txDate.getTime()) ? new Date() : txDate,
          description,
          reference: reference || null,
          amount: Math.abs(amount),
          type: type.includes('CREDIT') ? 'CREDIT' : 'DEBIT',
          matchedStatus: 'UNMATCHED',
          createdAt: new Date(),
        });
      }
    }

    if (transactionsToInsert.length > 0) {
      await db.insert(schema.bankTransactions).values(transactionsToInsert);
    }

    // Audit log
    await AuditService.log({
      companyId: input.companyId,
      userId: input.userId || 'system',
      action: 'BANK_STATEMENT_IMPORTED',
      entityType: 'bankStatement',
      entityId: statementId,
      severity: 'INFO',
      result: 'SUCCESS',
      module: 'Banking',
      reason: `Imported statement with ${transactionsToInsert.length} transactions (${duplicateCount} duplicates skipped)`
    });

    return {
      statementId,
      importedCount: transactionsToInsert.length,
      duplicateCount,
    };
  }

  /**
   * Run matching engine against bank transactions (Exact Reference, Exact Amount, Date Tolerance, Fuzzy Description)
   */
  static async runMatchingEngine(companyId: string, bankAccountId: string) {
    const unmatchedTransactions = await db.select()
      .from(schema.bankTransactions)
      .where(and(
        eq(schema.bankTransactions.companyId, companyId),
        eq(schema.bankTransactions.bankAccountId, bankAccountId),
        eq(schema.bankTransactions.matchedStatus, 'UNMATCHED')
      ));

    // Fetch posted journal entries or payments for comparison
    const journals = await db.select()
      .from(schema.journalEntries)
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED')
      ));

    const suggestions: any[] = [];

    for (const tx of unmatchedTransactions) {
      let bestMatch: any = null;
      let highestConfidence = 0;
      let matchReason = '';

      for (const j of journals) {
        let confidence = 0;
        let reasons: string[] = [];

        // 1. Amount match (exact)
        if (Math.abs(j.totalAmount - tx.amount) < 0.01) {
          confidence += 0.5;
          reasons.push('Exact amount match');
        }

        // 2. Reference match
        if (tx.reference && j.referenceNumber && tx.reference.toLowerCase() === j.referenceNumber.toLowerCase()) {
          confidence += 0.3;
          reasons.push('Exact reference match');
        }

        // 3. Date tolerance (within 5 days)
        const txTime = new Date(tx.transactionDate).getTime();
        const jTime = new Date(j.entryDate).getTime();
        const diffDays = Math.abs(txTime - jTime) / (1000 * 60 * 60 * 24);
        if (diffDays <= 5) {
          confidence += 0.1;
          reasons.push(`Date within ${Math.round(diffDays)} days`);
        }

        // 4. Fuzzy description match
        if (tx.description && j.description && j.description.toLowerCase().includes(tx.description.toLowerCase().slice(0, 10))) {
          confidence += 0.1;
          reasons.push('Description similarity match');
        }

        if (confidence > highestConfidence && confidence >= 0.5) {
          highestConfidence = confidence;
          bestMatch = j;
          matchReason = reasons.join(', ');
        }
      }

      if (bestMatch && highestConfidence >= 0.5) {
        await db.update(schema.bankTransactions)
          .set({
            matchedStatus: 'SUGGESTED',
            matchedJournalId: bestMatch.id,
            matchConfidence: highestConfidence,
            matchReason,
          })
          .where(eq(schema.bankTransactions.id, tx.id));

        suggestions.push({
          bankTransactionId: tx.id,
          matchedJournalId: bestMatch.id,
          confidence: highestConfidence,
          reason: matchReason,
          amount: tx.amount,
          description: tx.description
        });
      }
    }

    return {
      evaluatedCount: unmatchedTransactions.length,
      suggestionsCount: suggestions.length,
      suggestions,
    };
  }

  /**
   * Approve a bank transaction match (creates reconciliation approval record, marks transaction MATCHED)
   */
  static async approveMatch(companyId: string, bankTransactionId: string, matchedJournalId: string, userId: string) {
    const txRecord = await db.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.id, bankTransactionId)).get();
    if (!txRecord || txRecord.companyId !== companyId) {
      throw new Error('Bank transaction not found or unauthorized');
    }

    const approvalId = crypto.randomUUID();
    await db.insert(schema.bankReconciliationApprovals).values({
      id: approvalId,
      companyId,
      bankTransactionId,
      matchedRecordType: 'JOURNAL',
      matchedRecordId: matchedJournalId,
      status: 'APPROVED',
      approvedBy: userId,
      approvedAt: new Date(),
      createdAt: new Date(),
    });

    await db.update(schema.bankTransactions)
      .set({
        matchedStatus: 'MATCHED',
        matchedJournalId,
      })
      .where(eq(schema.bankTransactions.id, bankTransactionId));

    await AuditService.log({
      companyId,
      userId,
      action: 'BANK_RECONCILIATION_APPROVED',
      entityType: 'bankTransaction',
      entityId: bankTransactionId,
      severity: 'INFO',
      result: 'SUCCESS',
      module: 'Banking',
      reason: `Approved bank reconciliation match with journal ${matchedJournalId}`
    });

    return { success: true, approvalId };
  }
}
