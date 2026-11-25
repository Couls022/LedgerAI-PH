import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql, desc, inArray, ne, isNull } from "drizzle-orm";
import { AuditService } from "./auditService";
import { DocumentEncryptionService } from "./documentEncryptionService";
import { validateTransactionDateAndPeriod } from "../db/domain";
import {
  isEligibleCashBankAccount,
  isEligibleDestinationBankAccount,
  isPostableLeafAccount,
} from "../../shared/coaAccountUtils";
import crypto from "crypto";

export interface BankAccountInput {
  companyId: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  currency?: string;
  glAccountId?: string | null;
  accountCode?: string | null;
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

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeBankTxDate(dateStr: string): Date {
  const trimmed = String(dateStr || '').trim();
  if (!trimmed) {
    throw new Error('INVALID_BANK_TX_DATE: Missing transaction date in bank statement row.');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) {
      throw new Error(`INVALID_BANK_TX_DATE: Invalid calendar date '${trimmed}'.`);
    }
    return d;
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    throw new Error(`INVALID_BANK_TX_DATE: Unrecognized date format '${trimmed}'.`);
  }
  return parsed;
}

const BANK_ACC_ENC_PREFIX = 'LAIBANK1:';

export class BankReconciliationService {
  static encryptAccountNumber(companyId: string, rawAccountNumber: string): string {
    const clean = String(rawAccountNumber || '').trim();
    if (!clean) return '';
    if (clean.startsWith(BANK_ACC_ENC_PREFIX)) return clean;
    const masterKey = DocumentEncryptionService.deriveCompanyDocumentMasterKey(companyId);
    const key = crypto.createHmac('sha256', masterKey).update(`BANK-ACC-KEY|${companyId}`, 'utf8').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`LAIBANK1|${companyId}`, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${BANK_ACC_ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  static decryptAccountNumber(companyId: string, storedValue: string | null | undefined): string {
    if (!storedValue) return '';
    if (!storedValue.startsWith(BANK_ACC_ENC_PREFIX)) return storedValue;
    try {
      const payload = storedValue.slice(BANK_ACC_ENC_PREFIX.length);
      const [ivHex, tagHex, cipherHex] = payload.split(':');
      if (!ivHex || !tagHex || !cipherHex) return '';
      const masterKey = DocumentEncryptionService.deriveCompanyDocumentMasterKey(companyId);
      const key = crypto.createHmac('sha256', masterKey).update(`BANK-ACC-KEY|${companyId}`, 'utf8').digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
      decipher.setAAD(Buffer.from(`LAIBANK1|${companyId}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      const plain = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
      return plain.toString('utf8');
    } catch {
      return '';
    }
  }

  static maskAccountNumber(companyId: string, storedValue: string | null | undefined): string {
    const plain = this.decryptAccountNumber(companyId, storedValue);
    if (!plain) return '••••';
    if (plain.length <= 4) return plain;
    return `••••-${plain.slice(-4)}`;
  }

  /**
   * Create a bank account linked to the company's authoritative Chart of Accounts
   */
  static async createBankAccount(input: BankAccountInput) {
    const id = crypto.randomUUID();
    const encryptedNum = this.encryptAccountNumber(input.companyId, input.accountNumber);

    const companyAccounts: Array<typeof schema.accounts.$inferSelect> = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, input.companyId));
    const parentIds = new Set<string>(
      companyAccounts.filter((a) => a.parentAccountId).map((a) => String(a.parentAccountId))
    );

    let linkedGlAccount: (typeof companyAccounts)[number] | undefined;

    if (input.glAccountId || input.accountCode) {
      linkedGlAccount = companyAccounts.find(
        (a) =>
          (input.glAccountId && a.id === input.glAccountId) ||
          (input.accountCode && a.accountCode === input.accountCode)
      );
      if (!linkedGlAccount) {
        throw new Error(
          `BANK_GL_ACCOUNT_NOT_FOUND: Linked GL account '${input.glAccountId || input.accountCode}' does not exist in company '${input.companyId}'.`
        );
      }
      if (String(linkedGlAccount.status || 'ACTIVE').toUpperCase() !== 'ACTIVE' || (linkedGlAccount as any).isActive === false) {
        throw new Error(
          `BANK_GL_ACCOUNT_INACTIVE: Linked GL account '${linkedGlAccount.accountCode} - ${linkedGlAccount.accountName}' is not ACTIVE.`
        );
      }
      if (!isPostableLeafAccount(linkedGlAccount as any, parentIds)) {
        throw new Error(
          `BANK_GL_ACCOUNT_HEADER: Account '${linkedGlAccount.accountCode} - ${linkedGlAccount.accountName}' is a header account and cannot be linked to a Bank Account.`
        );
      }
      if (!isEligibleCashBankAccount(linkedGlAccount as any, parentIds)) {
        throw new Error(
          `BANK_GL_ACCOUNT_INVALID_TYPE: Account '${linkedGlAccount.accountCode} - ${linkedGlAccount.accountName}' (${linkedGlAccount.accountType}) is not an eligible Cash/Bank asset account.`
        );
      }
      if (!isEligibleDestinationBankAccount(linkedGlAccount as any, parentIds)) {
        throw new Error(
          `BANK_GL_ACCOUNT_INVALID_TYPE: Account '${linkedGlAccount.accountCode} - ${linkedGlAccount.accountName}' is a Petty Cash or physical Cash on Hand account and cannot be registered as a Bank Account.`
        );
      }
    } else {
      // Auto-discover matching leaf Bank account in company COA by name/bankName if unambiguous
      const eligibleBankAccounts = companyAccounts.filter((a) =>
        isEligibleDestinationBankAccount(a as any, parentIds)
      );
      const targetNameLower = String(input.accountName || '').trim().toLowerCase();
      const targetBankLower = String(input.bankName || '').trim().toLowerCase();
      linkedGlAccount =
        eligibleBankAccounts.find(
          (a) => String(a.accountName || '').trim().toLowerCase() === targetNameLower
        ) ||
        eligibleBankAccounts.find(
          (a) => String(a.accountName || '').trim().toLowerCase() === targetBankLower
        ) ||
        eligibleBankAccounts.find(
          (a) =>
            targetNameLower.length >= 3 &&
            (String(a.accountName || '').toLowerCase().includes(targetNameLower) ||
              targetNameLower.includes(String(a.accountName || '').trim().toLowerCase()))
        );
    }

    await db.insert(schema.bankAccounts).values({
      id,
      companyId: input.companyId,
      glAccountId: linkedGlAccount?.id || null,
      accountName: input.accountName,
      bankName: input.bankName,
      accountNumberEncrypted: encryptedNum,
      currency: input.currency || 'PHP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      id,
      companyId: input.companyId,
      glAccountId: linkedGlAccount?.id || null,
      glAccountCode: linkedGlAccount?.accountCode || null,
      glAccountName: linkedGlAccount?.accountName || null,
      glNormalBalance: linkedGlAccount?.normalBalance || 'DEBIT',
      isGlLinked: Boolean(linkedGlAccount),
      accountName: input.accountName,
      bankName: input.bankName,
      accountNumberMasked: this.maskAccountNumber(input.companyId, encryptedNum),
    };
  }

  /**
   * List bank accounts for a company with authoritative COA linkage metadata
   */
  static async getBankAccounts(companyId: string) {
    const rows: Array<typeof schema.bankAccounts.$inferSelect> = await db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.companyId, companyId));
    const companyAccounts: Array<typeof schema.accounts.$inferSelect> = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));
    const accountById = new Map<string, typeof schema.accounts.$inferSelect>(
      companyAccounts.map((a) => [a.id, a])
    );
    const parentIds = new Set<string>(
      companyAccounts.filter((a) => a.parentAccountId).map((a) => String(a.parentAccountId))
    );
    const eligibleBankAccounts = companyAccounts.filter((a) =>
      isEligibleDestinationBankAccount(a as any, parentIds)
    );

    const mappedRows = rows.map((r) => {
      let linkedAcc = r.glAccountId ? accountById.get(r.glAccountId) : undefined;
      if (!linkedAcc) {
        const nameLower = String(r.accountName || '').trim().toLowerCase();
        const bankLower = String(r.bankName || '').trim().toLowerCase();
        linkedAcc =
          eligibleBankAccounts.find(
            (a) => String(a.accountName || '').trim().toLowerCase() === nameLower
          ) ||
          eligibleBankAccounts.find(
            (a) => String(a.accountName || '').trim().toLowerCase() === bankLower
          );
      }
      return {
        ...r,
        glAccountId: linkedAcc?.id || r.glAccountId || null,
        glAccountCode: linkedAcc?.accountCode || null,
        glAccountName: linkedAcc?.accountName || null,
        glNormalBalance: linkedAcc?.normalBalance || 'DEBIT',
        isGlLinked: Boolean(linkedAcc),
        accountNumberMasked: this.maskAccountNumber(companyId, r.accountNumberEncrypted),
      };
    });

    const linkedGlIds = new Set(
      mappedRows.map((r) => r.glAccountId).filter((id): id is string => Boolean(id))
    );

    // Ensure every active postable leaf Bank COA account is represented in the returned list
    for (const bankCoa of eligibleBankAccounts) {
      if (!linkedGlIds.has(bankCoa.id)) {
        const bankMatch = String(bankCoa.accountName || '').match(
          /\b(BDO|BPI|Metrobank|Landbank|UnionBank|RCBC|PNB|Security Bank|ChinaBank|EastWest|Maybank|PSBank)\b/i
        );
        mappedRows.push({
          id: bankCoa.id,
          companyId,
          glAccountId: bankCoa.id,
          glAccountCode: bankCoa.accountCode,
          glAccountName: bankCoa.accountName,
          glNormalBalance: bankCoa.normalBalance || 'DEBIT',
          isGlLinked: true,
          accountName: bankCoa.accountName,
          bankName: bankMatch ? bankMatch[1].toUpperCase() : bankCoa.accountName,
          accountNumberEncrypted: '',
          accountNumberMasked: `COA-${bankCoa.accountCode}`,
          currency: bankCoa.currency || 'PHP',
          status: 'ACTIVE',
          createdAt: bankCoa.createdAt || new Date(),
          updatedAt: bankCoa.updatedAt || new Date(),
        });
      }
    }

    return mappedRows;
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

    // Parse CSV rows (quote-aware)
    const lines = input.csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const transactionsToInsert: any[] = [];
    let duplicateCount = 0;

    // Skip header if present
    const startIndex = lines[0]?.toLowerCase().includes('date') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]);
      if (parts.length >= 4) {
        const [dateStr, descStr, refStr, amountStr, typeStr] = parts;
        const txDate = normalizeBankTxDate(dateStr);
        const cleanedAmt = String(amountStr || '0').replace(/,/g, '').trim();
        const amount = parseFloat(cleanedAmt) || 0;
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
          transactionDate: txDate,
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
    const bankAccountRow = await db.select()
      .from(schema.bankAccounts)
      .where(and(
        eq(schema.bankAccounts.companyId, companyId),
        eq(schema.bankAccounts.id, bankAccountId)
      ))
      .get();
    const linkedGlAccountId = bankAccountRow?.glAccountId || null;

    const unmatchedTransactions = await db.select()
      .from(schema.bankTransactions)
      .where(and(
        eq(schema.bankTransactions.companyId, companyId),
        eq(schema.bankTransactions.bankAccountId, bankAccountId),
        eq(schema.bankTransactions.matchedStatus, 'UNMATCHED')
      ));

    // Fetch posted non-reversal journal entries for comparison
    const journals = await db.select()
      .from(schema.journalEntries)
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        isNull(schema.journalEntries.originalJournalId)
      ));

    // Exclude journals already matched or reconciled to another bank transaction
    const existingMatchedRows = await db.select({ matchedJournalId: schema.bankTransactions.matchedJournalId })
      .from(schema.bankTransactions)
      .where(and(
        eq(schema.bankTransactions.companyId, companyId),
        inArray(schema.bankTransactions.matchedStatus, ['MATCHED', 'RECONCILED'])
      ));
    const alreadyMatchedJournalIds = new Set(
      existingMatchedRows.map(r => r.matchedJournalId).filter((id): id is string => Boolean(id))
    );

    const journalIds = journals.map(j => j.id);
    const allJournalLines = journalIds.length > 0
      ? await db.select().from(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, journalIds))
      : [];
    const companyAccounts: Array<typeof schema.accounts.$inferSelect> = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const parentIds = new Set<string>(
      companyAccounts.filter((a) => a.parentAccountId).map((a) => String(a.parentAccountId))
    );
    const cashAccountIds = new Set<string>(
      companyAccounts
        .filter(a => isEligibleCashBankAccount(a as any, parentIds))
        .map(a => a.id)
    );
    if (linkedGlAccountId) {
      cashAccountIds.add(linkedGlAccountId);
    }

    const linesByJournal = new Map<string, typeof allJournalLines>();
    for (const jl of allJournalLines) {
      const arr = linesByJournal.get(jl.journalEntryId) || [];
      arr.push(jl);
      linesByJournal.set(jl.journalEntryId, arr);
    }

    const suggestions: any[] = [];

    for (const tx of unmatchedTransactions) {
      const candidates: Array<{ journal: typeof journals[number]; confidence: number; reason: string }> = [];

      for (const j of journals) {
        if (alreadyMatchedJournalIds.has(j.id)) continue;

        const jLines = linesByJournal.get(j.id) || [];
        const linkedLines = linkedGlAccountId
          ? jLines.filter(l => l.accountId === linkedGlAccountId)
          : [];
        const targetCashLines = linkedLines.length > 0
          ? linkedLines
          : jLines.filter(l => cashAccountIds.has(l.accountId));
        const cashLineNet = targetCashLines
          .reduce((sum, l) => sum + ((l.debit || 0) - (l.credit || 0)), 0);

        // Enforce flow direction parity: CREDIT deposit must have net cash debit (>0); DEBIT withdrawal must have net cash credit (<0)
        if (cashLineNet !== 0) {
          if (tx.type === 'CREDIT' && cashLineNet < 0) continue;
          if (tx.type === 'DEBIT' && cashLineNet > 0) continue;
        }

        const totalDebitCentavos = jLines.reduce((sum, l) => sum + (l.debit || 0), 0);
        const journalCentavos = cashLineNet !== 0 ? Math.abs(cashLineNet) : totalDebitCentavos;
        const journalAmountPesos = journalCentavos / 100;

        let confidence = 0;
        const reasons: string[] = [];

        // 1. Amount match (exact pesos comparison against GL centavos/100)
        if (journalAmountPesos > 0 && Math.abs(journalAmountPesos - tx.amount) < 0.01) {
          confidence += 0.5;
          reasons.push('Exact amount match');
        }

        // 2. Reference match against journalNumber, sourceId, or description
        const txRefLower = tx.reference ? tx.reference.toLowerCase() : '';
        if (
          txRefLower &&
          (
            (j.journalNumber && j.journalNumber.toLowerCase().includes(txRefLower)) ||
            (j.sourceId && j.sourceId.toLowerCase() === txRefLower) ||
            (j.description && j.description.toLowerCase().includes(txRefLower))
          )
        ) {
          confidence += 0.3;
          reasons.push('Exact reference match');
        }

        // 3. Date tolerance (within 5 days)
        const txTime = new Date(tx.transactionDate).getTime();
        const jTime = new Date(`${String(j.entryDate).slice(0, 10)}T00:00:00Z`).getTime();
        const diffDays = Math.abs(txTime - jTime) / (1000 * 60 * 60 * 24);
        if (!isNaN(diffDays) && diffDays <= 5) {
          confidence += 0.1;
          reasons.push(`Date within ${Math.round(diffDays)} days`);
        }

        // 4. Fuzzy description match
        if (tx.description && j.description && j.description.toLowerCase().includes(tx.description.toLowerCase().slice(0, 10))) {
          confidence += 0.1;
          reasons.push('Description similarity match');
        }

        if (confidence >= 0.5) {
          candidates.push({ journal: j, confidence, reason: reasons.join(', ') });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.confidence - a.confidence);
        const highestConfidence = candidates[0].confidence;
        const topTies = candidates.filter(c => Math.abs(c.confidence - highestConfidence) < 1e-9);
        // Refuse silent arbitrary selection when multiple candidates tie at top confidence
        if (topTies.length === 1) {
          const best = topTies[0];
          await db.update(schema.bankTransactions)
            .set({
              matchedStatus: 'SUGGESTED',
              matchedJournalId: best.journal.id,
              matchConfidence: best.confidence,
              matchReason: best.reason,
            })
            .where(eq(schema.bankTransactions.id, tx.id));

          suggestions.push({
            bankTransactionId: tx.id,
            matchedJournalId: best.journal.id,
            confidence: best.confidence,
            reason: best.reason,
            amount: tx.amount,
            description: tx.description
          });
        }
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
  static async approveMatch(companyId: string, bankTransactionId: string, matchedJournalId: string, userId: string, userRole?: string) {
    const approvalId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      const txRecord = await tx.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.id, bankTransactionId)).get();
      if (!txRecord || txRecord.companyId !== companyId) {
        throw new Error('Bank transaction not found or unauthorized');
      }
      if (txRecord.matchedStatus === 'MATCHED' || txRecord.matchedStatus === 'RECONCILED') {
        throw new Error('CONCURRENT_MODIFICATION_CONFLICT: Bank transaction is already matched or reconciled.');
      }

      const journal = await tx.select().from(schema.journalEntries).where(
        and(eq(schema.journalEntries.id, matchedJournalId), eq(schema.journalEntries.companyId, companyId))
      ).get();
      if (!journal || journal.status !== 'POSTED') {
        throw new Error('Matched journal entry not found, belongs to another company, or is not POSTED');
      }

      const existingJournalClaim = await tx.select({ id: schema.bankTransactions.id })
        .from(schema.bankTransactions)
        .where(and(
          eq(schema.bankTransactions.companyId, companyId),
          eq(schema.bankTransactions.matchedJournalId, matchedJournalId),
          inArray(schema.bankTransactions.matchedStatus, ['MATCHED', 'RECONCILED']),
          ne(schema.bankTransactions.id, bankTransactionId)
        ))
        .get();
      if (existingJournalClaim) {
        throw new Error('CONCURRENT_MODIFICATION_CONFLICT: Journal entry is already matched to another bank transaction.');
      }

      await validateTransactionDateAndPeriod(companyId, String(journal.entryDate).slice(0, 10), { userRole });

      const updRes = await tx.update(schema.bankTransactions)
        .set({
          matchedStatus: 'MATCHED',
          matchedJournalId,
        })
        .where(and(
          eq(schema.bankTransactions.id, bankTransactionId),
          eq(schema.bankTransactions.companyId, companyId),
          ne(schema.bankTransactions.matchedStatus, 'MATCHED'),
          ne(schema.bankTransactions.matchedStatus, 'RECONCILED')
        ));
      if ((updRes as any)?.changes === 0) {
        throw new Error('CONCURRENT_MODIFICATION_CONFLICT: Bank transaction was matched concurrently.');
      }

      await tx.insert(schema.bankReconciliationApprovals).values({
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
    });

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
