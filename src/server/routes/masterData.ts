import { Router } from 'express';
import { db } from '../db';
import * as schema from '../db/schema';
import { requireAuth,  requirePermission } from '../auth';
import { eq, and, sql, or, like, desc, inArray } from 'drizzle-orm';
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from '../utils/pagination';
import crypto from 'crypto';
import { AuditService } from '../services/auditService';
import { RbacService } from '../services/rbacService';
import { resolvePreArchiveStatus, resolveEntityRbacConfig } from './journey';
import { DomainError } from '../db/domain';
import { OpeningBalanceService } from '../services/openingBalanceService';
import { MasterDataService } from '../services/masterDataService';
import { BankReconciliationService } from '../services/bankReconciliationService';
import {
  ArchiveRetentionService,
  ArchiveRetentionScheduler,
  ARCHIVE_ENTITY_REGISTRY,
} from '../services/archiveRetentionService';
import {
  computeParentAccountIds,
  enrichCoaAccount,
  inferAccountDetailAndBirCategory,
  isAccountActive,
  isEligibleCashBankAccount,
  isEligibleTaxControlAccount,
  isPostableLeafAccount,
  isStrictBankAccount,
  shouldAutoFlagAsCashAccount,
} from '../../shared/coaAccountUtils';
import { DEFAULT_PHILIPPINE_COA } from './companies';

const router = Router();

const VALID_ACCOUNT_TYPES = [
  'ASSET',
  'RECEIVABLE',
  'OTHER_CURRENT_ASSET',
  'INVENTORY',
  'FIXED_ASSET',
  'PAYABLE',
  'OTHER_CURRENT_LIABILITY',
  'LONG_TERM_LIABILITY',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'COST_OF_SALES',
  'EXPENSE',
  'OTHER_INCOME',
  'OTHER_EXPENSE'
];

// ============================================================================
// 1. CHART OF ACCOUNTS
// ============================================================================

// GET /api/master-data/accounts
router.get('/accounts', requireAuth, requirePermission('accounting:view', 'accounts:read', 'cash:view', 'tax:view', 'masterdata:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { status, type } = req.query;

    const allAccounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId))
      .orderBy(schema.accounts.accountCode);

    const parentIds = computeParentAccountIds(allAccounts as any[]);
    const enriched = [];
    for (const acc of allAccounts) {
      const e = enrichCoaAccount(acc as any, parentIds);
      if ((!acc.detailType || !acc.birTaxCategory) && (e.detailType || e.birTaxCategory)) {
        try {
          db.update(schema.accounts)
            .set({
              detailType: e.detailType,
              birTaxCategory: e.birTaxCategory,
              isCashAccount: Boolean(e.isCashAccount),
            })
            .where(and(eq(schema.accounts.id, acc.id), eq(schema.accounts.companyId, companyId)))
            .run();
        } catch {
          // non-fatal backfill failure
        }
      }
      enriched.push(e);
    }

    let filtered = enriched;
    if (status) {
      filtered = filtered.filter(a => String(a.status || 'ACTIVE').toUpperCase() === String(status).toUpperCase());
    }
    if (type) {
      filtered = filtered.filter(a => String(a.accountType || '').toUpperCase() === String(type).toUpperCase());
    }

    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/accounts - Create account
router.post('/accounts', requireAuth, requirePermission('accounting:create', 'accounting:edit', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const {
      accountCode,
      accountName,
      accountType,
      detailType,
      normalBalance,
      parentAccountId,
      description,
      isSubAccount,
      birTaxCategory,
      openingBalance,
      asOfDate,
      isControlAccount,
      isCashAccount,
      isTaxAccount,
      isRetainedEarnings,
      currency
    } = req.body;

    if (!accountCode || !accountName || !accountType || !normalBalance) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'accountCode, accountName, accountType, and normalBalance are required fields.'
      });
    }

    const typeUpper = String(accountType).toUpperCase();
    if (!VALID_ACCOUNT_TYPES.includes(typeUpper)) {
      return res.status(400).json({
        error: 'INVALID_ACCOUNT_TYPE',
        message: `Account type must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`
      });
    }

    const parsedOpeningBalance = openingBalance !== undefined && openingBalance !== null && openingBalance !== ''
      ? Number(openingBalance)
      : 0;
    if (!Number.isFinite(parsedOpeningBalance)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Opening balance must be a valid finite number.'
      });
    }
    const openingCentavos = Math.round(parsedOpeningBalance * 100);
    const normalizedOpeningPhp = openingCentavos / 100;

    if (openingCentavos !== 0 && !OpeningBalanceService.isBalanceSheetAccountType(typeUpper)) {
      return res.status(400).json({
        error: 'OPENING_BALANCE_INVALID_ACCOUNT_TYPE',
        message: `Opening balances are restricted to Balance Sheet accounts. ${typeUpper} accounts cannot carry a direct opening balance.`
      });
    }

    const effectiveAsOfDate = openingCentavos !== 0
      ? (asOfDate ? String(asOfDate).slice(0, 10) : new Date().toISOString().slice(0, 10))
      : (asOfDate ? String(asOfDate).slice(0, 10) : null);

    // Check duplicate account code in company
    const existingCode = await db.select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountCode, accountCode.trim())))
      .get();

    if (existingCode) {
      return res.status(400).json({
        error: 'DUPLICATE_ACCOUNT_CODE',
        message: `Account code "${accountCode}" already exists for this company.`
      });
    }

    // Check parent account if provided
    if (parentAccountId) {
      const parent = await db.select()
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, parentAccountId), eq(schema.accounts.companyId, companyId)))
        .get();
      if (!parent) {
        return res.status(400).json({
          error: 'PARENT_ACCOUNT_NOT_FOUND',
          message: 'Selected parent account was not found.'
        });
      }
    }

    const id = crypto.randomUUID();
    const inferredMeta = inferAccountDetailAndBirCategory({
      accountCode: accountCode.trim(),
      accountName: accountName.trim(),
      accountType: typeUpper,
      detailType: detailType ? String(detailType).toUpperCase() : null,
      birTaxCategory: birTaxCategory || null,
      isCashAccount,
      isTaxAccount,
    });
    const resolvedDetailType = detailType ? String(detailType).toUpperCase() : inferredMeta.detailType;
    const resolvedBirCategory = birTaxCategory || inferredMeta.birTaxCategory;
    const resolvedCashFlag =
      Boolean(isCashAccount) ||
      shouldAutoFlagAsCashAccount({
        accountType: typeUpper,
        detailType: resolvedDetailType,
        accountName: accountName.trim(),
        accountCode: accountCode.trim(),
        isCashAccount,
        isTaxAccount,
      });

    const newAccount = {
      id,
      companyId,
      accountCode: accountCode.trim(),
      accountName: accountName.trim(),
      accountType: typeUpper,
      detailType: resolvedDetailType,
      normalBalance: String(normalBalance).toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      parentAccountId: parentAccountId || null,
      description: description || null,
      isSubAccount: Boolean(isSubAccount),
      birTaxCategory: resolvedBirCategory,
      openingBalance: normalizedOpeningPhp,
      asOfDate: effectiveAsOfDate,
      isControlAccount: Boolean(isControlAccount),
      isCashAccount: resolvedCashFlag,
      isTaxAccount:
        Boolean(isTaxAccount) ||
        ['VAT_PAYABLE', 'EWT_PAYABLE', 'TAX_PAYABLE', 'PREPAID_TAX'].includes(resolvedDetailType) ||
        Boolean(resolvedBirCategory && !['NONE', 'NOT_APPLICABLE'].includes(resolvedBirCategory)),
      isRetainedEarnings: Boolean(isRetainedEarnings) || resolvedDetailType === 'RETAINED_EARNINGS',
      currency: currency ? String(currency).trim().toUpperCase().slice(0, 10) : (resolvedDetailType === 'DOLLAR_ACCOUNT' ? 'USD' : 'PHP'),
      status: 'ACTIVE',
    };

    let openingJournal: { journalEntryId: string; journalNumber: string; amountCentavos: number } | null = null;

    await db.transaction(async (tx: any) => {
      await tx.insert(schema.accounts).values(newAccount);

      // Automatically synchronize eligible Bank COA accounts with the company's Bank Account Registry (without creating duplicate GL accounts)
      if (isStrictBankAccount(newAccount)) {
        const existingBankReg = await tx
          .select()
          .from(schema.bankAccounts)
          .where(and(eq(schema.bankAccounts.companyId, companyId), eq(schema.bankAccounts.glAccountId, id)))
          .get();
        if (!existingBankReg) {
          const bankMatch = newAccount.accountName.match(/\b(BDO|BPI|Metrobank|Landbank|UnionBank|RCBC|PNB|Security Bank|ChinaBank|EastWest|Maybank|PSBank)\b/i);
          const encNum = BankReconciliationService.encryptAccountNumber(companyId, `COA-${newAccount.accountCode}`);
          await tx.insert(schema.bankAccounts).values({
            id: crypto.randomUUID(),
            companyId,
            glAccountId: id,
            accountName: newAccount.accountName,
            bankName: bankMatch ? bankMatch[1].toUpperCase() : newAccount.accountName,
            accountNumberEncrypted: encNum,
            currency: newAccount.currency || 'PHP',
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      if (openingCentavos !== 0 && effectiveAsOfDate) {
        openingJournal = await OpeningBalanceService.postInitialOpeningBalanceInTx(tx, {
          companyId,
          account: newAccount,
          openingBalancePhp: normalizedOpeningPhp,
          asOfDate: effectiveAsOfDate,
          userId: req.user!.id,
          userRole: req.activeCompany?.role,
          sourceType: 'OPENING_BALANCE',
          sourceId: `COA-OB:${id}`,
        });
      }
    });

    await AuditService.log({
      req,
      companyId,
      action: 'CREATE_ACCOUNT',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: newAccount.accountCode,
      module: 'MASTER_DATA',
      afterData: {
        ...newAccount,
        openingJournalEntryId: openingJournal ? (openingJournal as any).journalEntryId : null,
        openingJournalNumber: openingJournal ? (openingJournal as any).journalNumber : null,
      },
    });

    res.status(201).json({
      ...newAccount,
      openingJournalEntryId: openingJournal ? (openingJournal as any).journalEntryId : null,
      openingJournalNumber: openingJournal ? (openingJournal as any).journalNumber : null,
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'DOMAIN_ERROR', message: err.message, details: err.details });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PUT /api/master-data/accounts/:id - Edit account
router.put('/accounts/:id', requireAuth, requirePermission('accounting:edit', 'accounting:create', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const {
      accountCode,
      accountName,
      accountType,
      detailType,
      normalBalance,
      parentAccountId,
      description,
      isSubAccount,
      birTaxCategory,
      openingBalance,
      asOfDate,
      isControlAccount,
      isCashAccount,
      isTaxAccount,
      isRetainedEarnings,
      currency,
      status
    } = req.body;

    const existing = await db.select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });
    }

    if (accountCode && accountCode.trim() !== existing.accountCode) {
      const codeCheck = await db.select()
        .from(schema.accounts)
        .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountCode, accountCode.trim())))
        .get();
      if (codeCheck) {
        return res.status(400).json({
          error: 'DUPLICATE_ACCOUNT_CODE',
          message: `Account code "${accountCode}" is already taken.`
        });
      }
    }

    if (accountType) {
      const typeUpper = String(accountType).toUpperCase();
      if (!VALID_ACCOUNT_TYPES.includes(typeUpper)) {
        return res.status(400).json({
          error: 'INVALID_ACCOUNT_TYPE',
          message: `Account type must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`
        });
      }
    }

    const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
    const curVer = Number(existing.version || 1);
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
      const expVer = Number(expectedVersion);
      if (expVer !== curVer) {
        return res.status(409).json({
          error: 'CONCURRENT_MODIFICATION_CONFLICT',
          code: 'CONCURRENT_MODIFICATION_CONFLICT',
          message: `CONCURRENT_MODIFICATION_CONFLICT: Account '${existing.accountCode}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before saving.`,
          currentVersion: curVer,
          expectedVersion: expVer,
          details: { recordId: id, currentVersion: curVer, clientVersion: expVer }
        });
      }
    }

    // Check opening balance immutability & GL synchronization
    const existingObCentavos = Math.round(Number(existing.openingBalance || 0) * 100);
    const postedGlOb = await OpeningBalanceService.getPostedOpeningBalanceForAccount(
      companyId,
      existing.id,
      existing.normalBalance,
      db
    );

    let shouldPostInitialOb = false;
    let nextOpeningPhp = Number(existing.openingBalance || 0);
    let nextAsOfDate = existing.asOfDate || null;

    if (openingBalance !== undefined && openingBalance !== null && openingBalance !== '') {
      const requestedPhp = Number(openingBalance);
      if (!Number.isFinite(requestedPhp)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Opening balance must be a valid finite number.' });
      }
      const requestedCentavos = Math.round(requestedPhp * 100);
      if (requestedCentavos !== existingObCentavos) {
        if (existingObCentavos !== 0 || postedGlOb.postedEntryCount > 0) {
          return res.status(409).json({
            error: 'OPENING_BALANCE_IMMUTABLE',
            code: 'OPENING_BALANCE_IMMUTABLE',
            message: `Opening balance for account '${existing.accountCode}' cannot be overwritten directly. Use the auditable Opening Balance Adjustment workflow to record delta corrections.`,
          });
        }
        if (requestedCentavos !== 0) {
          shouldPostInitialOb = true;
          nextOpeningPhp = requestedCentavos / 100;
        }
      }
    }

    if (asOfDate !== undefined) {
      const requestedDate = asOfDate ? String(asOfDate).slice(0, 10) : null;
      if (requestedDate !== (existing.asOfDate || null) && postedGlOb.postedEntryCount > 0) {
        return res.status(409).json({
          error: 'OPENING_BALANCE_IMMUTABLE',
          code: 'OPENING_BALANCE_IMMUTABLE',
          message: `Opening balance As-of Date for account '${existing.accountCode}' cannot be edited after GL opening journal posting.`,
        });
      }
      nextAsOfDate = requestedDate;
    }

    if (shouldPostInitialOb && !nextAsOfDate) {
      nextAsOfDate = new Date().toISOString().slice(0, 10);
    }

    const nextVer = Number(existing.version || 1) + 1;
    const nextCode = accountCode ? accountCode.trim() : existing.accountCode;
    const nextName = accountName ? accountName.trim() : existing.accountName;
    const nextType = accountType ? String(accountType).toUpperCase() : existing.accountType;
    const rawDetail = detailType !== undefined ? (detailType ? String(detailType).toUpperCase() : null) : existing.detailType;
    const rawBir = birTaxCategory !== undefined ? birTaxCategory : existing.birTaxCategory;
    const inferredUpdateMeta = inferAccountDetailAndBirCategory({
      accountCode: nextCode,
      accountName: nextName,
      accountType: nextType,
      detailType: rawDetail,
      birTaxCategory: rawBir,
      isCashAccount: isCashAccount !== undefined ? isCashAccount : existing.isCashAccount,
      isTaxAccount: isTaxAccount !== undefined ? isTaxAccount : existing.isTaxAccount,
    });
    const finalDetail = rawDetail || inferredUpdateMeta.detailType;
    const finalBir = rawBir || inferredUpdateMeta.birTaxCategory;

    const updatedData = {
      accountCode: nextCode,
      accountName: nextName,
      accountType: nextType,
      detailType: finalDetail,
      normalBalance: normalBalance ? (String(normalBalance).toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT') : existing.normalBalance,
      parentAccountId: parentAccountId !== undefined ? parentAccountId : existing.parentAccountId,
      description: description !== undefined ? description : existing.description,
      isSubAccount: isSubAccount !== undefined ? Boolean(isSubAccount) : existing.isSubAccount,
      birTaxCategory: finalBir,
      openingBalance: nextOpeningPhp,
      asOfDate: nextAsOfDate,
      isCashAccount: isCashAccount !== undefined
        ? Boolean(isCashAccount)
        : shouldAutoFlagAsCashAccount({
            accountType: nextType,
            detailType: finalDetail,
            accountName: nextName,
            accountCode: nextCode,
            isCashAccount: existing.isCashAccount,
            isTaxAccount: existing.isTaxAccount,
          }),
      isTaxAccount: isTaxAccount !== undefined ? Boolean(isTaxAccount) : existing.isTaxAccount,
      isRetainedEarnings: isRetainedEarnings !== undefined ? Boolean(isRetainedEarnings) : existing.isRetainedEarnings,
      currency: currency !== undefined && currency !== '' ? String(currency).trim().toUpperCase().slice(0, 10) : (existing.currency || 'PHP'),
      status: status ? String(status).toUpperCase() : existing.status,
      isActive: (status ? String(status).toUpperCase() : existing.status) === 'ACTIVE',
      version: nextVer,
      updatedAt: new Date(),
    };

    let openingJournal: { journalEntryId: string; journalNumber: string; amountCentavos: number } | null = null;

    await db.transaction(async (tx: any) => {
      const resUpdate = await tx.update(schema.accounts)
        .set(updatedData)
        .where(and(
          eq(schema.accounts.id, id),
          eq(schema.accounts.companyId, companyId),
          eq(schema.accounts.version, existing.version || 1)
        ))
        .run();

      if (resUpdate.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Account '${id}' was updated concurrently by another transaction.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: id, currentVersion: nextVer, clientVersion: expectedVersion }
        );
      }

      // Sync linked Bank Account Registry status/name if applicable
      const existingBankReg = await tx
        .select()
        .from(schema.bankAccounts)
        .where(and(eq(schema.bankAccounts.companyId, companyId), eq(schema.bankAccounts.glAccountId, id)))
        .get();
      if (isStrictBankAccount(updatedData) && updatedData.status === 'ACTIVE') {
        if (!existingBankReg) {
          const bankMatch = updatedData.accountName.match(/\b(BDO|BPI|Metrobank|Landbank|UnionBank|RCBC|PNB|Security Bank|ChinaBank|EastWest|Maybank|PSBank)\b/i);
          const encNum = BankReconciliationService.encryptAccountNumber(companyId, `COA-${updatedData.accountCode}`);
          await tx.insert(schema.bankAccounts).values({
            id: crypto.randomUUID(),
            companyId,
            glAccountId: id,
            accountName: updatedData.accountName,
            bankName: bankMatch ? bankMatch[1].toUpperCase() : updatedData.accountName,
            accountNumberEncrypted: encNum,
            currency: updatedData.currency || 'PHP',
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } else {
          await tx
            .update(schema.bankAccounts)
            .set({
              accountName: updatedData.accountName,
              currency: updatedData.currency || 'PHP',
              status: 'ACTIVE',
              updatedAt: new Date(),
            })
            .where(eq(schema.bankAccounts.id, existingBankReg.id))
            .run();
        }
      } else if (existingBankReg && updatedData.status !== 'ACTIVE') {
        await tx
          .update(schema.bankAccounts)
          .set({ status: 'INACTIVE', updatedAt: new Date() })
          .where(eq(schema.bankAccounts.id, existingBankReg.id))
          .run();
      }

      if (shouldPostInitialOb && nextAsOfDate) {
        openingJournal = await OpeningBalanceService.postInitialOpeningBalanceInTx(tx, {
          companyId,
          account: {
            id,
            accountCode: updatedData.accountCode,
            accountName: updatedData.accountName,
            accountType: updatedData.accountType,
            detailType: updatedData.detailType,
            normalBalance: updatedData.normalBalance,
            status: updatedData.status,
          },
          openingBalancePhp: nextOpeningPhp,
          asOfDate: nextAsOfDate,
          userId: req.user!.id,
          userRole: req.activeCompany?.role,
          sourceType: 'OPENING_BALANCE',
          sourceId: `COA-OB:${id}`,
        });
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId: req.user!.id,
        action: 'UPDATE_ACCOUNT',
        entityType: 'accounts',
        entityId: id,
        details: JSON.stringify({ before: existing, after: updatedData })
      });
    });

    res.json({
      id,
      ...updatedData,
      openingJournalEntryId: openingJournal ? (openingJournal as any).journalEntryId : null,
      openingJournalNumber: openingJournal ? (openingJournal as any).journalNumber : null,
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'DOMAIN_ERROR', message: err.message, details: err.details });
    }
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : 500;
    res.status(status).json({ error: err.code || 'SERVER_ERROR', message: err.message, details: err.details });
  }
});

// GET /api/master-data/accounts/:id/opening-balance - Inspect COA vs GL opening balance status
router.get('/accounts/:id/opening-balance', requireAuth, requirePermission('accounting:view', 'accounts:read', 'coa:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const account = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)))
      .get();

    if (!account) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });
    }

    const glOb = await OpeningBalanceService.getPostedOpeningBalanceForAccount(
      companyId,
      account.id,
      account.normalBalance,
      db
    );

    res.json({
      accountId: account.id,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      normalBalance: account.normalBalance,
      isBalanceSheetAccount: OpeningBalanceService.isBalanceSheetAccountType(account.accountType),
      masterOpeningBalancePhp: Number(account.openingBalance || 0),
      asOfDate: account.asOfDate || null,
      glPostedOpeningBalancePhp: glOb.signedCentavos / 100,
      glPostedDebitPhp: glOb.debitCentavos / 100,
      glPostedCreditPhp: glOb.creditCentavos / 100,
      postedEntryCount: glOb.postedEntryCount,
      version: Number(account.version || 1),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/accounts/:id/opening-balance-adjustment - Auditable delta adjustment
router.post('/accounts/:id/opening-balance-adjustment', requireAuth, requirePermission('accounting:edit', 'accounting:create', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { newOpeningBalance, adjustmentDate, reason, expectedVersion } = req.body;

    if (newOpeningBalance === undefined || newOpeningBalance === null || newOpeningBalance === '') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'newOpeningBalance is required.' });
    }

    const result = await OpeningBalanceService.recordOpeningBalanceAdjustment({
      companyId,
      accountId: id,
      newOpeningBalancePhp: Number(newOpeningBalance),
      adjustmentDate: String(adjustmentDate || new Date().toISOString().slice(0, 10)),
      reason: String(reason || ''),
      userId: req.user!.id,
      userRole: req.activeCompany?.role,
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
    });

    await AuditService.log({
      req,
      companyId,
      action: 'ADJUST_ACCOUNT_OPENING_BALANCE',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: result.journalNumber,
      module: 'MASTER_DATA',
      afterData: result,
    });

    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'DOMAIN_ERROR', message: err.message, details: err.details });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/master-data/opening-balances/reconciliation - Inspect historical COA vs GL opening status
router.get('/opening-balances/reconciliation', requireAuth, requirePermission('accounting:view', 'coa:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const report = await OpeningBalanceService.inspectOpeningBalanceReconciliation(companyId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/opening-balances/reconcile - Migrate ONLY accounts missing GL opening entries
router.post('/opening-balances/reconcile', requireAuth, requirePermission('accounting:edit', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { dryRun, fallbackAsOfDate } = req.body || {};
    const result = await OpeningBalanceService.reconcileMissingOpeningBalances({
      companyId,
      userId: req.user!.id,
      userRole: req.activeCompany?.role,
      fallbackAsOfDate,
      dryRun: Boolean(dryRun),
    });
    res.json(result);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'DOMAIN_ERROR', message: err.message, details: err.details });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/opening-balances/batch - Phase 5 Controlled Multi-Line Opening Balance Cutover
router.post('/opening-balances/batch', requireAuth, requirePermission('accounting:edit', 'accounting:create', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const {
      effectiveDate,
      batchReference,
      sourceSystem,
      supportingScheduleRef,
      notes,
      enforceStrictBalance,
      approvedByUserId,
      lines,
    } = req.body || {};

    const result = await OpeningBalanceService.postOpeningBalanceBatch({
      companyId,
      effectiveDate: String(effectiveDate || ''),
      batchReference: String(batchReference || ''),
      sourceSystem: String(sourceSystem || ''),
      supportingScheduleRef: String(supportingScheduleRef || ''),
      notes: notes ? String(notes) : undefined,
      enforceStrictBalance: enforceStrictBalance !== false,
      userId: req.user!.id,
      approvedByUserId: approvedByUserId ? String(approvedByUserId) : req.user!.id,
      userRole: req.activeCompany?.role,
      lines: Array.isArray(lines) ? lines : [],
    });

    await AuditService.log({
      req,
      companyId,
      action: 'POST_OPENING_BALANCE_BATCH',
      entityType: 'JOURNAL_ENTRY',
      entityId: result.journalEntryId,
      recordReference: result.journalNumber,
      module: 'ACCOUNTING',
      afterData: result,
    });

    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'DOMAIN_ERROR', message: err.message, details: err.details });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/master-data/opening-balances/validation - Phase 5 Opening Trial Balance & COA-to-GL Validation
router.get('/opening-balances/validation', requireAuth, requirePermission('accounting:view', 'coa:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const validation = await OpeningBalanceService.validateOpeningTrialBalanceAndSubledgers(companyId);
    res.json(validation);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PATCH /api/master-data/accounts/:id/status - Activate / Deactivate / Remove from List / Soft Delete
router.patch('/accounts/:id/status', requireAuth, requirePermission('accounting:edit', 'accounting:create', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { status, reason } = req.body;

    const allowedStatuses = ['ACTIVE', 'INACTIVE', 'REMOVED', 'REMOVED_FROM_LIST', 'SOFT_DELETED'];
    const rawStatus = String(status || '').toUpperCase();
    const newStatus = rawStatus === 'REMOVED_FROM_LIST' ? 'REMOVED' : rawStatus;
    if (!status || !allowedStatuses.includes(rawStatus)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Status must be ACTIVE, INACTIVE, REMOVED, or SOFT_DELETED.' });
    }

    const existing = await db.select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });
    }

    await db.update(schema.accounts)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)));

    const actionMap: Record<string, string> = {
      ACTIVE: 'ACTIVATE_ACCOUNT',
      INACTIVE: 'DEACTIVATE_ACCOUNT',
      REMOVED: 'REMOVE_ACCOUNT_FROM_LIST',
      SOFT_DELETED: 'SOFT_DELETE_ACCOUNT',
    };

    await AuditService.log({
      req,
      companyId,
      action: actionMap[newStatus] || 'UPDATE_ACCOUNT_STATUS',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: existing.accountCode,
      module: 'MASTER_DATA',
      beforeData: { status: existing.status },
      afterData: { status: newStatus },
      reason: reason || `Account status changed from ${existing.status} to ${newStatus}.`,
    });

    res.json({ id, status: newStatus, previousStatus: existing.status });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PATCH /api/master-data/accounts/:id/archive - Archive account to Dedicated Archive Inbox (30-day retention)
router.patch('/accounts/:id/archive', requireAuth, requirePermission('accounting:edit', 'accounting:create', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;

    const existing = await db.select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });
    }

    await db.update(schema.accounts)
      .set({ status: 'ARCHIVED', updatedAt: new Date() })
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: 'ARCHIVE_ACCOUNT',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: existing.accountCode,
      module: 'MASTER_DATA',
      beforeData: { status: existing.status },
      afterData: { status: 'ARCHIVED' },
      reason: req.body?.reason || 'Archived to Chart of Accounts Archive Inbox.',
    });

    res.json({ id, status: 'ARCHIVED', previousStatus: existing.status });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PATCH /api/master-data/accounts/:id/restore - Module-aware restore of archived/removed/soft-deleted account
router.patch('/accounts/:id/restore', requireAuth, requirePermission('accounting:edit', 'accounting:create', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;

    const result = await ArchiveRetentionService.restoreArchivedRecord(companyId, 'ACCOUNT', id, {
      req,
      userId: req.user?.id,
      reason: req.body?.reason,
    });

    res.json({
      success: true,
      id,
      status: result.restoredStatus,
      warnings: result.warnings,
      message: `Account ${result.recordCode} restored successfully to ${result.restoredStatus}.`,
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'RESTORE_FAILED', message: err.message, details: err.details });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/master-data/accounts/archived - Pure read-only list of archived accounts with retention & dependency protection metadata
router.get('/accounts/archived', requireAuth, async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { records, summary } = await ArchiveRetentionService.listArchivedRecords(companyId, {
      entityTypes: ['ACCOUNT'],
      search: String(req.query.search || ''),
      retentionState: String(req.query.retentionState || ''),
    });

    res.json({
      success: true,
      accounts: records,
      records,
      summary,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// DELETE /api/master-data/accounts/:id/permanent - Guarded permanent delete enforcing full dependency & BIR retention rules
router.delete('/accounts/:id/permanent', requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;

    await ArchiveRetentionService.permanentlyDeleteArchivedRecord(companyId, 'ACCOUNT', id, {
      req,
      userId: req.user?.id,
      reason: req.body?.reason,
    });

    res.json({ success: true, message: 'Account permanently deleted from archive.' });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({
        error: err.code || 'RETENTION_POLICY_BLOCKED',
        message: err.message,
        details: err.details,
      });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// DELETE /api/master-data/accounts/:id - Prevent deletion when used
router.delete('/accounts/:id', requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;

    const account = await db.select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)))
      .get();

    if (!account) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });
    }

    // Usage Checks
    const [
      jLines,
      sLines,
      pLines,
      cTxns,
      cLines,
      vendorDefP,
      vendorDefE,
      custDefR,
      custDefRev,
      taxC,
      bankGL,
      pmDef
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.journalLines).where(eq(schema.journalLines.accountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.accountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.accountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.cashTransactions).where(eq(schema.cashTransactions.cashAccountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.cashTransactionLines).where(eq(schema.cashTransactionLines.accountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.vendors).where(eq(schema.vendors.defaultPayableAccountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.vendors).where(eq(schema.vendors.defaultExpenseAccountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.customers).where(eq(schema.customers.defaultReceivableAccountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.customers).where(eq(schema.customers.defaultRevenueAccountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.taxCodes).where(eq(schema.taxCodes.accountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.banks).where(eq(schema.banks.glAccountId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.paymentMethods).where(eq(schema.paymentMethods.defaultAccountId, id)).get(),
    ]);

    const totalUsage =
      (jLines?.count || 0) +
      (sLines?.count || 0) +
      (pLines?.count || 0) +
      (cTxns?.count || 0) +
      (cLines?.count || 0) +
      (vendorDefP?.count || 0) +
      (vendorDefE?.count || 0) +
      (custDefR?.count || 0) +
      (custDefRev?.count || 0) +
      (taxC?.count || 0) +
      (bankGL?.count || 0) +
      (pmDef?.count || 0);

    if (totalUsage > 0) {
      return res.status(400).json({
        error: 'CANNOT_DELETE_USED_RECORD',
        message: `Account "${account.accountCode} - ${account.accountName}" cannot be deleted because it is referenced in accounting transactions or master data. Deactivate it instead.`
      });
    }

    await db.delete(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: 'DELETE_ACCOUNT',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: account.accountCode,
      module: 'MASTER_DATA',
      beforeData: account,
    });

    res.json({ message: 'Account deleted successfully.', id });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/accounts/import - Import CSV / JSON
router.post('/accounts/import', requireAuth, requirePermission('accounting:create', 'accounting:edit', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { accountsList } = req.body;

    if (!Array.isArray(accountsList) || accountsList.length === 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'accountsList array is required.' });
    }

    const existingAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const existingCodeSet = new Set(existingAccounts.map(a => a.accountCode.toUpperCase()));

    const imported: any[] = [];
    const errors: string[] = [];
    const seenImportCodes = new Set<string>();

    for (let index = 0; index < accountsList.length; index++) {
      const item = accountsList[index];
      const code = String(item.accountCode || item.code || '').trim();
      const name = String(item.accountName || item.name || '').trim();
      let type = String(item.accountType || item.type || '').trim().toUpperCase();

      if (!code || !name || !type) {
        errors.push(`Row ${index + 1}: Account Code, Name, and Type are required.`);
        continue;
      }

      if (!VALID_ACCOUNT_TYPES.includes(type)) {
        errors.push(`Row ${index + 1} (${code}): Invalid account type "${type}". Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`);
        continue;
      }

      if (existingCodeSet.has(code.toUpperCase()) || seenImportCodes.has(code.toUpperCase())) {
        errors.push(`Row ${index + 1}: Duplicate account code "${code}".`);
        continue;
      }

      seenImportCodes.add(code.toUpperCase());

      const id = crypto.randomUUID();
      const newAcc = {
        id,
        companyId,
        accountCode: code,
        accountName: name,
        accountType: type,
        normalBalance: item.normalBalance ? String(item.normalBalance).toUpperCase() : (['ASSET', 'EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT'),
        description: item.description || null,
        isControlAccount: Boolean(item.isControlAccount),
        isCashAccount: Boolean(item.isCashAccount),
        isTaxAccount: Boolean(item.isTaxAccount),
        isRetainedEarnings: Boolean(item.isRetainedEarnings),
        status: 'ACTIVE',
      };

      await db.insert(schema.accounts).values(newAcc);
      imported.push(newAcc);
    }

    res.json({
      importedCount: imported.length,
      errorsCount: errors.length,
      imported,
      errors,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/accounts/seed-template - Explicit, controlled, company-scoped standard COA template seeding
router.post('/accounts/seed-template', requireAuth, requirePermission('accounting:create', 'accounting:edit', 'coa:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const userId = req.user?.id || 'system';

    // Fetch company tax profile if present to apply adaptive BIR accounts
    const [taxProfile] = await db
      .select()
      .from(schema.companyTaxProfiles)
      .where(eq(schema.companyTaxProfiles.companyId, companyId))
      .limit(1);

    const vatStatus = taxProfile?.vatStatus || 'VAT';
    const taxpayerClassification = taxProfile?.taxpayerClassification || 'CORPORATION';

    const adaptiveCoa: any[] = [...DEFAULT_PHILIPPINE_COA];

    if (vatStatus === 'NON_VAT') {
      adaptiveCoa.push(
        { accountCode: "2120", accountName: "Percentage Tax Payable (Form 2551Q - 3%)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
        { accountCode: "6080", accountName: "Percentage Tax Expense (3%)", accountType: "EXPENSE", normalBalance: "DEBIT" }
      );
    } else if (vatStatus === 'PEZA_BOI' || vatStatus === 'FREEPORT') {
      adaptiveCoa.push(
        { accountCode: "2130", accountName: "Special Gross Income Tax Payable (5% GIT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
        { accountCode: "4030", accountName: "Tax Exempt / Ecozone Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
      );
    } else if (vatStatus === 'PERCENTAGE_CARRIER') {
      adaptiveCoa.push(
        { accountCode: "2140", accountName: "Common Carrier Tax Payable (3% CCT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true }
      );
    } else if (vatStatus === 'PERCENTAGE_BANK_GRT') {
      adaptiveCoa.push(
        { accountCode: "2150", accountName: "Gross Receipts Tax Payable (1%-7% GRT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true }
      );
    } else if (vatStatus === 'ZERO_RATED' || vatStatus === 'EXEMPT' || vatStatus === 'COOPERATIVE_EXEMPT') {
      adaptiveCoa.push(
        { accountCode: "4030", accountName: "VAT Exempt / Zero-Rated Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
      );
    }

    if (taxpayerClassification === 'INDIVIDUAL' || taxpayerClassification === 'INDIVIDUAL_8PERCENT' || taxpayerClassification === 'OPC') {
      adaptiveCoa.push(
        { accountCode: "3020", accountName: "Proprietor Drawings / Personal Distributions", accountType: "EQUITY", normalBalance: "DEBIT" }
      );
    } else if (taxpayerClassification === 'PARTNERSHIP' || taxpayerClassification === 'GPP') {
      adaptiveCoa.push(
        { accountCode: "3030", accountName: "Partner Capital - Managing Partner", accountType: "EQUITY", normalBalance: "CREDIT" },
        { accountCode: "3040", accountName: "Partner Drawings / Profit Share Distributions", accountType: "EQUITY", normalBalance: "DEBIT" }
      );
    } else if (taxpayerClassification === 'COOPERATIVE') {
      adaptiveCoa.push(
        { accountCode: "3050", accountName: "Cooperative Reserve Fund (RA 9520 Statutory Reserve)", accountType: "EQUITY", normalBalance: "CREDIT" },
        { accountCode: "3060", accountName: "Patronage Refund & Interest on Share Capital Payable", accountType: "LIABILITY", normalBalance: "CREDIT" }
      );
    } else if (vatStatus === 'BMBE') {
      adaptiveCoa.push(
        { accountCode: "3070", accountName: "BMBE Micro Capital Reserve (RA 9178)", accountType: "EQUITY", normalBalance: "CREDIT" }
      );
    }

    const existingAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const existingCodeSet = new Set(existingAccounts.map((a) => a.accountCode.toUpperCase()));

    const newlyInserted: any[] = [];
    for (const def of adaptiveCoa) {
      if (existingCodeSet.has(def.accountCode.toUpperCase())) {
        continue;
      }
      const accId = crypto.randomUUID();
      const inferredMeta = inferAccountDetailAndBirCategory(def as any);
      const newAcc = {
        id: accId,
        companyId,
        accountCode: def.accountCode,
        accountName: def.accountName,
        accountType: def.accountType,
        detailType: (def as any).detailType || inferredMeta.detailType,
        birTaxCategory: (def as any).birTaxCategory || inferredMeta.birTaxCategory,
        normalBalance: def.normalBalance,
        isCashAccount: !!(def as any).isCashAccount,
        isControlAccount: !!(def as any).isControlAccount,
        isTaxAccount: !!(def as any).isTaxAccount,
        isRetainedEarnings: !!(def as any).isRetainedEarnings,
        status: 'ACTIVE',
        isActive: true,
      };

      await db.insert(schema.accounts).values(newAcc).onConflictDoNothing();
      existingCodeSet.add(def.accountCode.toUpperCase());
      newlyInserted.push(newAcc);
    }

    await AuditService.log({
      companyId,
      userId,
      entityType: 'ACCOUNT',
      entityId: companyId,
      action: 'COA_TEMPLATE_SEEDED',
      afterData: { seededCount: newlyInserted.length, totalAccounts: existingAccounts.length + newlyInserted.length }
    });

    res.json({
      success: true,
      message: `Standard Philippine COA template loaded successfully. Added ${newlyInserted.length} new accounts.`,
      seededCount: newlyInserted.length,
      totalCount: existingAccounts.length + newlyInserted.length,
      accounts: await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId)).orderBy(schema.accounts.accountCode),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/master-data/accounts/export
router.get('/accounts/export', requireAuth, requirePermission('reports:export'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId)).orderBy(schema.accounts.accountCode);
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ============================================================================
// 2. CUSTOMERS
// ============================================================================

router.get('/customers', requireAuth, requirePermission('customers:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const params = parsePaginationParams(req);

    const filterConditions = [eq(schema.customers.companyId, companyId)];

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.customers.code, searchPattern),
          like(schema.customers.legalName, searchPattern),
          like(schema.customers.tradeName, searchPattern),
          like(schema.customers.tin, searchPattern),
          like(schema.customers.contactDetails, searchPattern)
        )!
      );
    }

    if (params.status) {
      filterConditions.push(eq(schema.customers.status, params.status.toUpperCase()));
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.customers.status}, 'ACTIVE')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const cursorCond = buildCursorCondition(
      schema.customers.code,
      schema.customers.id,
      params.decodedCursor,
      'ASC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.customers)
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const list = await db
      .select()
      .from(schema.customers)
      .where(and(...queryConditions))
      .orderBy(schema.customers.code, schema.customers.id)
      .limit(params.limit + 1);

    res.json(formatPaginatedResponse({
      items: list,
      limit: params.limit,
      getSortValAndId: (c: any) => ({ val: c.code, id: c.id }),
      totalCount,
      raw: params.raw
    }));
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.post('/customers', requireAuth, requirePermission('customers:create'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const {
      code,
      legalName,
      tradeName,
      tin,
      address,
      billingAddress,
      shippingAddress,
      contactPerson,
      contactDetails,
      paymentTerms,
      creditLimit,
      taxClassification,
      vatStatus,
      withholdingApplicability,
      defaultReceivableAccountId,
      defaultRevenueAccountId,
      notes
    } = req.body;

    if (!code || !legalName) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Customer code and legalName are required.' });
    }

    const existingCode = await db.select()
      .from(schema.customers)
      .where(and(eq(schema.customers.companyId, companyId), eq(schema.customers.code, code.trim())))
      .get();

    if (existingCode) {
      return res.status(400).json({ error: 'DUPLICATE_CODE', message: `Customer code "${code}" already exists.` });
    }

    const id = crypto.randomUUID();
    const newCustomer = {
      id,
      companyId,
      code: code.trim(),
      legalName: legalName.trim(),
      tradeName: tradeName ? tradeName.trim() : null,
      tin: tin ? tin.trim() : null,
      address: address || null,
      billingAddress: billingAddress || address || null,
      shippingAddress: shippingAddress || address || null,
      contactPerson: contactPerson || null,
      contactDetails: contactDetails || null,
      paymentTerms: paymentTerms || 'NET_30',
      creditLimit: creditLimit ? Number(creditLimit) : 0,
      taxClassification: taxClassification || null,
      vatStatus: vatStatus || 'VATable',
      withholdingApplicability: withholdingApplicability || null,
      defaultReceivableAccountId: defaultReceivableAccountId || null,
      defaultRevenueAccountId: defaultRevenueAccountId || null,
      notes: notes || null,
      status: 'ACTIVE',
    };

    await db.insert(schema.customers).values(newCustomer);

    await AuditService.log({
      req,
      companyId,
      action: 'CREATE_CUSTOMER',
      entityType: 'CUSTOMER',
      entityId: id,
      recordReference: newCustomer.code,
      module: 'MASTER_DATA',
      afterData: newCustomer,
    });

    res.status(201).json(newCustomer);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.put('/customers/:id', requireAuth, requirePermission('customers:edit'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const existing = await db.select().from(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId))).get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
    }

    const data = req.body;
    if (data.code && data.code.trim() !== existing.code) {
      const codeCheck = await db.select().from(schema.customers).where(and(eq(schema.customers.companyId, companyId), eq(schema.customers.code, data.code.trim()))).get();
      if (codeCheck) {
        return res.status(400).json({ error: 'DUPLICATE_CODE', message: `Customer code "${data.code}" is already taken.` });
      }
    }

    const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
      const expVer = Number(expectedVersion);
      const curVer = Number(existing.version || 1);
      if (expVer !== curVer) {
        return res.status(409).json({
          error: 'CONCURRENT_MODIFICATION_CONFLICT',
          code: 'CONCURRENT_MODIFICATION_CONFLICT',
          message: `CONCURRENT_MODIFICATION_CONFLICT: Customer '${existing.code}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before saving.`,
          currentVersion: curVer,
          expectedVersion: expVer,
          details: { recordId: id, currentVersion: curVer, clientVersion: expVer }
        });
      }
    }

    const nextVer = Number(existing.version || 1) + 1;
    const updated = {
      code: data.code ? data.code.trim() : existing.code,
      legalName: data.legalName ? data.legalName.trim() : existing.legalName,
      tradeName: data.tradeName !== undefined ? data.tradeName : existing.tradeName,
      tin: data.tin !== undefined ? data.tin : existing.tin,
      address: data.address !== undefined ? data.address : existing.address,
      billingAddress: data.billingAddress !== undefined ? data.billingAddress : existing.billingAddress,
      shippingAddress: data.shippingAddress !== undefined ? data.shippingAddress : existing.shippingAddress,
      contactPerson: data.contactPerson !== undefined ? data.contactPerson : existing.contactPerson,
      contactDetails: data.contactDetails !== undefined ? data.contactDetails : existing.contactDetails,
      paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : existing.paymentTerms,
      creditLimit: data.creditLimit !== undefined ? Number(data.creditLimit) : existing.creditLimit,
      taxClassification: data.taxClassification !== undefined ? data.taxClassification : existing.taxClassification,
      vatStatus: data.vatStatus !== undefined ? data.vatStatus : existing.vatStatus,
      withholdingApplicability: data.withholdingApplicability !== undefined ? data.withholdingApplicability : existing.withholdingApplicability,
      defaultReceivableAccountId: data.defaultReceivableAccountId !== undefined ? data.defaultReceivableAccountId : existing.defaultReceivableAccountId,
      defaultRevenueAccountId: data.defaultRevenueAccountId !== undefined ? data.defaultRevenueAccountId : existing.defaultRevenueAccountId,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      status: data.status ? String(data.status).toUpperCase() : existing.status,
      version: nextVer,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx: any) => {
      const resUpdate = await tx.update(schema.customers)
        .set(updated)
        .where(and(
          eq(schema.customers.id, id),
          eq(schema.customers.companyId, companyId),
          eq(schema.customers.version, existing.version || 1)
        ))
        .run();

      if (resUpdate.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Customer '${id}' was updated concurrently by another transaction.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: id, currentVersion: nextVer, clientVersion: expectedVersion }
        );
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId: req.user!.id,
        action: 'UPDATE_CUSTOMER',
        entityType: 'customers',
        entityId: id,
        details: JSON.stringify({ before: existing, after: updated })
      });
    });

    res.json({ id, ...updated });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : 500;
    res.status(status).json({ error: err.code || 'SERVER_ERROR', message: err.message, details: err.details });
  }
});

router.patch('/customers/:id/status', requireAuth, requirePermission('customers:edit'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { status } = req.body;
    const newStatus = String(status).toUpperCase();
    await db.update(schema.customers).set({ status: newStatus, updatedAt: new Date() }).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId)));
    res.json({ id, status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.delete('/customers/:id', requireAuth, requirePermission('customers:delete'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;

    const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId))).get();
    if (!customer) return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });

    // Usage check in sales invoices & projects
    const [invCount, projCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.salesInvoices).where(eq(schema.salesInvoices.customerId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.projects).where(eq(schema.projects.clientCustomerId, id)).get(),
    ]);

    if ((invCount?.count || 0) > 0 || (projCount?.count || 0) > 0) {
      return res.status(400).json({
        error: 'CANNOT_DELETE_USED_RECORD',
        message: `Customer "${customer.code} - ${customer.legalName}" cannot be deleted because it is referenced in sales invoices or projects. Deactivate it instead.`
      });
    }

    await db.delete(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId)));
    res.json({ message: 'Customer deleted successfully.', id });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ============================================================================
// 3. SUPPLIERS / VENDORS
// ============================================================================

router.get('/vendors', requireAuth, requirePermission('vendors:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const params = parsePaginationParams(req);

    const filterConditions = [eq(schema.vendors.companyId, companyId)];

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.vendors.code, searchPattern),
          like(schema.vendors.legalName, searchPattern),
          like(schema.vendors.tradeName, searchPattern),
          like(schema.vendors.tin, searchPattern),
          like(schema.vendors.contactDetails, searchPattern)
        )!
      );
    }

    if (params.status) {
      filterConditions.push(eq(schema.vendors.status, params.status.toUpperCase()));
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.vendors.status}, 'ACTIVE')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const cursorCond = buildCursorCondition(
      schema.vendors.code,
      schema.vendors.id,
      params.decodedCursor,
      'ASC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.vendors)
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const list = await db
      .select()
      .from(schema.vendors)
      .where(and(...queryConditions))
      .orderBy(schema.vendors.code, schema.vendors.id)
      .limit(params.limit + 1);

    res.json(formatPaginatedResponse({
      items: list,
      limit: params.limit,
      getSortValAndId: (v: any) => ({ val: v.code, id: v.id }),
      totalCount,
      raw: params.raw
    }));
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.post('/vendors', requireAuth, requirePermission('vendors:create'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const {
      code,
      legalName,
      tradeName,
      tin,
      address,
      contactPerson,
      contactDetails,
      paymentTerms,
      taxClassification,
      vatStatus,
      withholdingApplicability,
      defaultPayableAccountId,
      defaultExpenseAccountId,
      notes
    } = req.body;

    if (!code || !legalName) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Supplier code and legalName are required.' });
    }

    const existingCode = await db.select().from(schema.vendors).where(and(eq(schema.vendors.companyId, companyId), eq(schema.vendors.code, code.trim()))).get();
    if (existingCode) {
      return res.status(400).json({ error: 'DUPLICATE_CODE', message: `Supplier code "${code}" already exists.` });
    }

    const id = crypto.randomUUID();
    const newVendor = {
      id,
      companyId,
      code: code.trim(),
      legalName: legalName.trim(),
      tradeName: tradeName ? tradeName.trim() : null,
      tin: tin ? tin.trim() : null,
      address: address || null,
      contactPerson: contactPerson || null,
      contactDetails: contactDetails || null,
      paymentTerms: paymentTerms || 'NET_30',
      taxClassification: taxClassification || null,
      vatStatus: vatStatus || 'VATable',
      withholdingApplicability: withholdingApplicability || null,
      defaultPayableAccountId: defaultPayableAccountId || null,
      defaultExpenseAccountId: defaultExpenseAccountId || null,
      notes: notes || null,
      status: 'ACTIVE',
    };

    await db.insert(schema.vendors).values(newVendor);
    await AuditService.log({
      req,
      companyId,
      action: 'CREATE_VENDOR',
      entityType: 'VENDOR',
      entityId: id,
      recordReference: newVendor.code,
      module: 'MASTER_DATA',
      afterData: newVendor,
    });
    res.status(201).json(newVendor);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.put('/vendors/:id', requireAuth, requirePermission('vendors:edit'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const existing = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId))).get();
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Supplier not found.' });

    const data = req.body;
    if (data.code && data.code.trim() !== existing.code) {
      const check = await db.select().from(schema.vendors).where(and(eq(schema.vendors.companyId, companyId), eq(schema.vendors.code, data.code.trim()))).get();
      if (check) return res.status(400).json({ error: 'DUPLICATE_CODE', message: `Supplier code "${data.code}" is already taken.` });
    }

    const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
      const expVer = Number(expectedVersion);
      const curVer = Number(existing.version || 1);
      if (expVer !== curVer) {
        return res.status(409).json({
          error: 'CONCURRENT_MODIFICATION_CONFLICT',
          code: 'CONCURRENT_MODIFICATION_CONFLICT',
          message: `CONCURRENT_MODIFICATION_CONFLICT: Supplier '${existing.code}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before saving.`,
          currentVersion: curVer,
          expectedVersion: expVer,
          details: { recordId: id, currentVersion: curVer, clientVersion: expVer }
        });
      }
    }

    const nextVer = Number(existing.version || 1) + 1;
    const updated = {
      code: data.code ? data.code.trim() : existing.code,
      legalName: data.legalName ? data.legalName.trim() : existing.legalName,
      tradeName: data.tradeName !== undefined ? data.tradeName : existing.tradeName,
      tin: data.tin !== undefined ? data.tin : existing.tin,
      address: data.address !== undefined ? data.address : existing.address,
      contactPerson: data.contactPerson !== undefined ? data.contactPerson : existing.contactPerson,
      contactDetails: data.contactDetails !== undefined ? data.contactDetails : existing.contactDetails,
      paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : existing.paymentTerms,
      taxClassification: data.taxClassification !== undefined ? data.taxClassification : existing.taxClassification,
      vatStatus: data.vatStatus !== undefined ? data.vatStatus : existing.vatStatus,
      withholdingApplicability: data.withholdingApplicability !== undefined ? data.withholdingApplicability : existing.withholdingApplicability,
      defaultPayableAccountId: data.defaultPayableAccountId !== undefined ? data.defaultPayableAccountId : existing.defaultPayableAccountId,
      defaultExpenseAccountId: data.defaultExpenseAccountId !== undefined ? data.defaultExpenseAccountId : existing.defaultExpenseAccountId,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      status: data.status ? String(data.status).toUpperCase() : existing.status,
      version: nextVer,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx: any) => {
      const resUpdate = await tx.update(schema.vendors)
        .set(updated)
        .where(and(
          eq(schema.vendors.id, id),
          eq(schema.vendors.companyId, companyId),
          eq(schema.vendors.version, existing.version || 1)
        ))
        .run();

      if (resUpdate.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Supplier '${id}' was updated concurrently by another transaction.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: id, currentVersion: nextVer, clientVersion: expectedVersion }
        );
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId: req.user!.id,
        action: 'UPDATE_VENDOR',
        entityType: 'vendors',
        entityId: id,
        details: JSON.stringify({ before: existing, after: updated })
      });
    });

    res.json({ id, ...updated });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : 500;
    res.status(status).json({ error: err.code || 'SERVER_ERROR', message: err.message, details: err.details });
  }
});

router.patch('/vendors/:id/status', requireAuth, requirePermission('vendors:edit'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { status } = req.body;
    const newStatus = String(status).toUpperCase();
    await db.update(schema.vendors).set({ status: newStatus, updatedAt: new Date() }).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId)));
    await AuditService.log({
      req,
      companyId,
      action: 'UPDATE_VENDOR_STATUS',
      entityType: 'VENDOR',
      entityId: id,
      module: 'MASTER_DATA',
      afterData: { status: newStatus },
    });
    res.json({ id, status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.delete('/vendors/:id', requireAuth, requirePermission('vendors:delete'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;

    const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId))).get();
    if (!vendor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Supplier not found.' });

    const [billCount, payCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.purchaseBills).where(eq(schema.purchaseBills.vendorId, id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(schema.supplierPayments).where(eq(schema.supplierPayments.vendorId, id)).get(),
    ]);

    if ((billCount?.count || 0) > 0 || (payCount?.count || 0) > 0) {
      return res.status(400).json({
        error: 'CANNOT_DELETE_USED_RECORD',
        message: `Supplier "${vendor.code} - ${vendor.legalName}" cannot be deleted because it is referenced in purchase bills or payments. Deactivate it instead.`
      });
    }

    await db.delete(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId)));
    await AuditService.log({
      req,
      companyId,
      action: 'DELETE_VENDOR',
      entityType: 'VENDOR',
      entityId: id,
      recordReference: vendor.code,
      module: 'MASTER_DATA',
      beforeData: vendor,
    });
    res.json({ message: 'Supplier deleted successfully.', id });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ============================================================================
// 4. OTHER MASTER DATA (Banks, Departments, Projects, Cost Centers, Locations, Payment Methods)
// ============================================================================

// BANKS
router.get('/banks', requireAuth, requirePermission('cash:view', 'bank_rec:view', 'masterdata:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select().from(schema.banks).where(eq(schema.banks.companyId, companyId));
  res.json(list);
});

router.post('/banks', requireAuth, requirePermission('bank_rec:create', 'bank_rec:edit', 'masterdata:manage', 'settings:manage', 'cash:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, bankName, branch, accountNumber, accountType, currency, glAccountId } = req.body;
  if (!code || !bankName) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and bankName are required.' });

  const id = crypto.randomUUID();
  const bank = {
    id,
    companyId,
    code: code.trim(),
    bankName: bankName.trim(),
    branch: branch || null,
    accountNumber: accountNumber || null,
    accountType: accountType || 'CHECKING',
    currency: currency || 'PHP',
    glAccountId: glAccountId || null,
    status: 'ACTIVE',
  };
  await db.insert(schema.banks).values(bank);
  await AuditService.log({
    req,
    companyId,
    action: 'CREATE_BANK',
    entityType: 'BANK',
    entityId: id,
    recordReference: bank.code,
    module: 'MASTER_DATA',
    afterData: bank,
  });
  res.status(201).json(bank);
});

// CASH ACCOUNTS
router.get('/cash-accounts', requireAuth, requirePermission('cash:view', 'bank_rec:view', 'masterdata:view', 'accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const cashAccounts = await db.select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.isCashAccount, true)));
  res.json(cashAccounts);
});

// DEPARTMENTS
router.get('/departments', requireAuth, requirePermission('masterdata:view', 'company:read', 'accounting:view', 'budget:view', 'sales:view', 'purchases:view', 'payroll:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  let list = await db.select().from(schema.departments).where(eq(schema.departments.companyId, companyId));

  const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'master-data');
  if (scope.dataScope === 'DEPARTMENT' && scope.departmentMatches.length > 0) {
    list = list.filter(d =>
      scope.departmentMatches.includes(d.id.trim().toUpperCase()) ||
      scope.departmentMatches.includes(d.code.trim().toUpperCase()) ||
      scope.departmentMatches.includes(d.name.trim().toUpperCase())
    );
  }

  res.json(list);
});

router.post('/departments', requireAuth, requirePermission('masterdata:manage', 'settings:manage', 'company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, managerName } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const normalizedCode = code.trim();
  const existing = await db
    .select()
    .from(schema.departments)
    .where(and(eq(schema.departments.companyId, companyId), eq(schema.departments.code, normalizedCode)))
    .get();
  if (existing) {
    return res.status(409).json({
      error: 'DUPLICATE_CODE',
      message: `Department code '${normalizedCode}' already exists in this company.`,
      department: existing,
    });
  }

  const id = crypto.randomUUID();
  const dep = { id, companyId, code: normalizedCode, name: name.trim(), managerName: managerName || null, status: 'ACTIVE' };
  await db.insert(schema.departments).values(dep);
  await AuditService.log({
    req,
    companyId,
    action: 'CREATE_DEPARTMENT',
    entityType: 'DEPARTMENT',
    entityId: id,
    recordReference: dep.code,
    module: 'MASTER_DATA',
    afterData: dep,
  });
  res.status(201).json(dep);
});

// PROJECTS
router.get('/projects', requireAuth, requirePermission('masterdata:view', 'company:read', 'accounting:view', 'budget:view', 'sales:view', 'purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  let list = await db.select().from(schema.projects).where(eq(schema.projects.companyId, companyId));

  const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'master-data');
  if (scope.dataScope === 'PROJECT' && scope.projectMatches.length > 0) {
    list = list.filter(p =>
      scope.projectMatches.includes(p.id.trim().toUpperCase()) ||
      scope.projectMatches.includes(p.code.trim().toUpperCase()) ||
      scope.projectMatches.includes(p.name.trim().toUpperCase())
    );
  }

  res.json(list);
});

router.post('/projects', requireAuth, requirePermission('masterdata:manage', 'settings:manage', 'company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, clientCustomerId, budgetAmount, startDate, endDate } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const normalizedCode = code.trim();
  const existing = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.companyId, companyId), eq(schema.projects.code, normalizedCode)))
    .get();
  if (existing) {
    return res.status(409).json({
      error: 'DUPLICATE_CODE',
      message: `Project code '${normalizedCode}' already exists in this company.`,
      project: existing,
    });
  }

  const id = crypto.randomUUID();
  const proj = {
    id,
    companyId,
    code: normalizedCode,
    name: name.trim(),
    clientCustomerId: clientCustomerId || null,
    budgetAmount: budgetAmount ? Number(budgetAmount) : null,
    startDate: startDate || null,
    endDate: endDate || null,
    status: 'ACTIVE',
  };
  await db.insert(schema.projects).values(proj);
  await AuditService.log({
    req,
    companyId,
    action: 'CREATE_PROJECT',
    entityType: 'PROJECT',
    entityId: id,
    recordReference: proj.code,
    module: 'MASTER_DATA',
    afterData: proj,
  });
  res.status(201).json(proj);
});

// COST CENTERS
router.get('/cost-centers', requireAuth, requirePermission('masterdata:view', 'company:read', 'accounting:view', 'budget:view', 'sales:view', 'purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  let list = await db.select().from(schema.costCenters).where(eq(schema.costCenters.companyId, companyId));

  const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'master-data');
  if (scope.dataScope === 'COST_CENTER' && scope.costCenterMatches.length > 0) {
    list = list.filter(cc =>
      scope.costCenterMatches.includes(cc.id.trim().toUpperCase()) ||
      scope.costCenterMatches.includes(cc.code.trim().toUpperCase()) ||
      scope.costCenterMatches.includes(cc.name.trim().toUpperCase())
    );
  } else if (scope.dataScope === 'DEPARTMENT' && scope.departmentMatches.length > 0) {
    list = list.filter(cc => cc.departmentId && scope.departmentMatches.includes(cc.departmentId.trim().toUpperCase()));
  }

  res.json(list);
});

router.post('/cost-centers', requireAuth, requirePermission('masterdata:manage', 'settings:manage', 'company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, departmentId, status } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const cc = {
    id,
    companyId,
    code: code.trim(),
    name: name.trim(),
    departmentId: departmentId || null,
    status: status ? String(status).toUpperCase() : 'ACTIVE',
  };
  await db.insert(schema.costCenters).values(cc);
  await AuditService.log({
    req,
    companyId,
    action: 'CREATE_COST_CENTER',
    entityType: 'COST_CENTER',
    entityId: id,
    recordReference: cc.code,
    module: 'MASTER_DATA',
    afterData: cc,
  });
  res.status(201).json(cc);
});

router.put('/cost-centers/:id', requireAuth, requirePermission('masterdata:manage', 'settings:manage', 'company:write'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { code, name, departmentId, status } = req.body;

    const existing = await db.select()
      .from(schema.costCenters)
      .where(and(eq(schema.costCenters.id, id), eq(schema.costCenters.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Cost center not found.' });
    }

    const updated = {
      code: code ? String(code).trim() : existing.code,
      name: name ? String(name).trim() : existing.name,
      departmentId: departmentId !== undefined ? (departmentId || null) : existing.departmentId,
      status: status ? String(status).toUpperCase() : existing.status,
      updatedAt: new Date(),
    };

    await db.update(schema.costCenters)
      .set(updated)
      .where(and(eq(schema.costCenters.id, id), eq(schema.costCenters.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: 'UPDATE_COST_CENTER',
      entityType: 'COST_CENTER',
      entityId: id,
      recordReference: updated.code,
      module: 'MASTER_DATA',
      beforeData: existing,
      afterData: updated,
    });

    res.json({ id, companyId, ...updated });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// LOCATIONS / BRANCHES
router.get('/locations', requireAuth, requirePermission('masterdata:view', 'company:read', 'accounting:view', 'inventory:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select().from(schema.locations).where(eq(schema.locations.companyId, companyId));
  res.json(list);
});

router.post('/locations', requireAuth, requirePermission('masterdata:manage', 'settings:manage', 'company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, address, isMainBranch } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const loc = { id, companyId, code: code.trim(), name: name.trim(), address: address || null, isMainBranch: Boolean(isMainBranch), status: 'ACTIVE' };
  await db.insert(schema.locations).values(loc);
  await AuditService.log({
    req,
    companyId,
    action: 'CREATE_LOCATION',
    entityType: 'LOCATION',
    entityId: id,
    recordReference: loc.code,
    module: 'MASTER_DATA',
    afterData: loc,
  });
  res.status(201).json(loc);
});

// PAYMENT METHODS
router.get('/payment-methods', requireAuth, requirePermission('masterdata:view', 'company:read', 'cash:view', 'sales:view', 'purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.companyId, companyId));
  res.json(list);
});

router.post('/payment-methods', requireAuth, requirePermission('masterdata:manage', 'settings:manage', 'company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, type, defaultAccountId } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  let resolvedAccountId: string | null = defaultAccountId ? String(defaultAccountId).trim() : null;
  if (resolvedAccountId) {
    const companyAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const parentIds = computeParentAccountIds(companyAccounts as any[]);
    const targetAcc = companyAccounts.find((a) => a.id === resolvedAccountId || a.accountCode === resolvedAccountId);
    if (!targetAcc) {
      return res.status(400).json({ error: 'INVALID_ACCOUNT', message: `Default account '${resolvedAccountId}' does not exist in this company's Chart of Accounts.` });
    }
    if (!isAccountActive(targetAcc as any) || !isPostableLeafAccount(targetAcc as any, parentIds)) {
      return res.status(400).json({ error: 'INVALID_ACCOUNT', message: `Account '${targetAcc.accountCode} — ${targetAcc.accountName}' must be an active postable leaf account.` });
    }
    if (!isEligibleCashBankAccount(targetAcc as any, parentIds)) {
      return res.status(400).json({ error: 'INELIGIBLE_CASH_ACCOUNT', message: `Account '${targetAcc.accountCode} — ${targetAcc.accountName}' is not an eligible Cash or Bank account.` });
    }
    resolvedAccountId = targetAcc.id;
  }

  const id = crypto.randomUUID();
  const pm = { id, companyId, code: code.trim(), name: name.trim(), type: type || 'CASH', defaultAccountId: resolvedAccountId, status: 'ACTIVE' };
  await db.insert(schema.paymentMethods).values(pm);
  await AuditService.log({
    req,
    companyId,
    action: 'CREATE_PAYMENT_METHOD',
    entityType: 'PAYMENT_METHOD',
    entityId: id,
    recordReference: pm.code,
    module: 'MASTER_DATA',
    afterData: pm,
  });
  res.status(201).json(pm);
});

async function validateOptionalMasterTaxGlAccount(
  companyId: string,
  accountId: string | null | undefined,
  accountCode: string | null | undefined,
  taxType: string,
  direction: string
) {
  const rawId = String(accountId || '').trim();
  const rawCode = String(accountCode || '').trim();
  if (!rawId && !rawCode) return null;

  const companyAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
  const parentIds = computeParentAccountIds(companyAccounts as any[]);
  const target =
    companyAccounts.find((a) => rawId && a.id === rawId) ||
    companyAccounts.find((a) => (rawCode && a.accountCode === rawCode) || (rawId && a.accountCode === rawId));

  if (!target) {
    throw new DomainError(`Selected GL account '${rawId || rawCode}' does not exist in this company's Chart of Accounts.`, 'TAX_GL_ACCOUNT_NOT_FOUND', 400);
  }
  if (!isAccountActive(target as any) || !isPostableLeafAccount(target as any, parentIds)) {
    throw new DomainError(`GL account '${target.accountCode} — ${target.accountName}' must be an active postable leaf account.`, 'TAX_GL_ACCOUNT_INELIGIBLE', 400);
  }
  if (!isEligibleTaxControlAccount(target as any, taxType, direction, parentIds)) {
    throw new DomainError(`GL account '${target.accountCode} — ${target.accountName}' is incompatible with ${taxType} (${direction}).`, 'TAX_GL_ACCOUNT_INCOMPATIBLE', 400);
  }
  return target;
}

// ================= TAX CODES =================
router.get('/tax-codes', requireAuth, requirePermission('tax:view', 'masterdata:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const taxCodesList = await db
      .select({
        id: schema.taxCodes.id,
        companyId: schema.taxCodes.companyId,
        code: schema.taxCodes.code,
        name: schema.taxCodes.name,
        taxType: schema.taxCodes.taxType,
        description: schema.taxCodes.description,
        inputOutputDirection: schema.taxCodes.inputOutputDirection,
        accountId: schema.taxCodes.accountId,
        accountCode: schema.accounts.accountCode,
        accountName: schema.accounts.accountName,
        status: schema.taxCodes.status,
      })
      .from(schema.taxCodes)
      .leftJoin(schema.accounts, eq(schema.taxCodes.accountId, schema.accounts.id))
      .where(eq(schema.taxCodes.companyId, companyId));
    res.json(taxCodesList);
  } catch (err: any) {
    console.error("Error fetching tax codes:", err);
    res.status(500).json({ error: "Failed to fetch tax codes", details: err?.message });
  }
});

router.post('/tax-codes', requireAuth, requirePermission('tax:create', 'tax:edit', 'tax:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { code, name, taxType, description, inputOutputDirection, accountId, accountCode, status } = req.body;

    const existing = await db
      .select()
      .from(schema.taxCodes)
      .where(and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.code, code)))
      .get();

    if (existing) {
      return res.status(400).json({ error: "Tax code already exists" });
    }

    const direction = String(inputOutputDirection || 'OUTPUT').toUpperCase();
    const normTaxType = String(taxType || 'VAT').toUpperCase();
    const targetAccount = await validateOptionalMasterTaxGlAccount(companyId, accountId, accountCode, normTaxType, direction);

    const id = crypto.randomUUID();
    const newTaxCode = {
      id,
      companyId,
      code: String(code || '').trim().toUpperCase(),
      name: String(name || '').trim(),
      taxType: normTaxType,
      description,
      inputOutputDirection: direction,
      accountId: targetAccount?.id || null,
      status: status || "ACTIVE",
    };

    await db.insert(schema.taxCodes).values(newTaxCode);

    await AuditService.log({
      req,
      companyId,
      action: 'CREATE_TAX_CODE',
      entityType: 'TAX_CODE',
      entityId: id,
      recordReference: newTaxCode.code,
      module: 'MASTER_DATA',
      afterData: newTaxCode,
    });

    res.json({
      message: "Tax code created successfully",
      id,
      accountId: newTaxCode.accountId,
      accountCode: targetAccount?.accountCode || null,
      accountName: targetAccount?.accountName || null,
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'TAX_GL_ACCOUNT_INVALID', message: err.message });
    }
    console.error("Error creating tax code:", err);
    res.status(500).json({ error: "Failed to create tax code", details: err?.message });
  }
});

router.put('/tax-codes/:id', requireAuth, requirePermission('tax:edit', 'tax:create', 'tax:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { code, name, taxType, description, inputOutputDirection, accountId, accountCode, status } = req.body;

    const existing = await db.select()
      .from(schema.taxCodes)
      .where(and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.id, req.params.id)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Tax code not found" });
    }

    const direction = String(inputOutputDirection || existing.inputOutputDirection || 'OUTPUT').toUpperCase();
    const normTaxType = String(taxType || existing.taxType || 'VAT').toUpperCase();
    const targetAccount = await validateOptionalMasterTaxGlAccount(companyId, accountId, accountCode, normTaxType, direction);

    await db.update(schema.taxCodes).set({
      code: code !== undefined ? String(code).trim().toUpperCase() : existing.code,
      name: name !== undefined ? String(name).trim() : existing.name,
      taxType: normTaxType,
      description,
      inputOutputDirection: direction,
      accountId: accountId !== undefined || accountCode !== undefined ? (targetAccount?.id || null) : existing.accountId,
      status: status || existing.status,
      updatedAt: new Date(),
    }).where(and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.id, req.params.id)));

    await AuditService.log({
      req,
      companyId,
      action: 'UPDATE_TAX_CODE',
      entityType: 'TAX_CODE',
      entityId: req.params.id,
      recordReference: code || existing?.code,
      module: 'MASTER_DATA',
      beforeData: existing,
      afterData: { code, name, taxType: normTaxType, description, inputOutputDirection: direction, accountId: targetAccount?.id || existing.accountId, status },
    });

    res.json({ message: "Tax code updated successfully" });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'TAX_GL_ACCOUNT_INVALID', message: err.message });
    }
    console.error("Error updating tax code:", err);
    res.status(500).json({ error: "Failed to update tax code", details: err?.message });
  }
});

// ============================================================================
// ENTERPRISE SYSTEM-WIDE ARCHIVE INBOX & 30-DAY RETENTION VAULT
// Authoritatively backed by ArchiveRetentionService & ArchiveRetentionScheduler
// ============================================================================

export const systemArchiveRouter = Router();

// Pure read-only archive query (never performs destructive mutations inside GET)
systemArchiveRouter.get('/archived-records', requireAuth, async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const rawEntityTypes = String(req.query.entityTypes || req.query.entityType || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const { records, summary } = await ArchiveRetentionService.listArchivedRecords(companyId, {
      entityTypes: rawEntityTypes.length > 0 ? rawEntityTypes : undefined,
      module: String(req.query.module || ''),
      search: String(req.query.search || ''),
      archivedBy: String(req.query.archivedBy || ''),
      retentionState: String(req.query.retentionState || ''),
    });

    res.json({
      success: true,
      records,
      summary,
      scheduler: ArchiveRetentionScheduler.getStatus(companyId),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Live telemetry for the independent 30-day backend Archive Retention Scheduler
systemArchiveRouter.get('/archived-records/retention-status', requireAuth, async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    res.json({
      success: true,
      scheduler: ArchiveRetentionScheduler.getStatus(companyId),
      supportedEntityTypes: Object.keys(ARCHIVE_ENTITY_REGISTRY),
      supportedEntityCount: Object.keys(ARCHIVE_ENTITY_REGISTRY).length,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Authorized on-demand execution of the 30-day retention sweep for the active company
systemArchiveRouter.post('/archived-records/run-retention-sweep', requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const dryRun = Boolean(req.body?.dryRun);
    const summary = await ArchiveRetentionScheduler.runRetentionSweepForCompany(companyId, {
      dryRun,
      userId: req.user?.id,
    });
    res.json({
      success: true,
      dryRun,
      summary,
      scheduler: ArchiveRetentionScheduler.getStatus(companyId),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Module-aware restore from Dedicated Archive Inbox or Central Archive Vault
systemArchiveRouter.patch('/archived-records/:entityType/:id/restore', requireAuth, async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { entityType, id } = req.params;
    const normType = entityType.toUpperCase();
    const meta = ARCHIVE_ENTITY_REGISTRY[normType];
    if (!meta?.table) {
      return res.status(400).json({ error: 'INVALID_ENTITY', message: `Invalid entity type: ${entityType}` });
    }

    const rbacConfig = resolveEntityRbacConfig(normType);
    const restorePerms = rbacConfig.actionPermissionMap['RESTORE'] || rbacConfig.actionPermissionMap['EDIT'] || [];
    if (restorePerms.length > 0 && req.activeCompany?.membershipId) {
      const access = await RbacService.resolveEffectiveAccess(req.activeCompany.membershipId);
      const isOwnerOrAdmin = ['Company Owner', 'Company Administrator', 'COMPANY_OWNER', 'COMPANY_ADMIN'].includes(
        access.primaryRole
      );
      const hasPerm =
        isOwnerOrAdmin ||
        restorePerms.some((p) => access.effectivePermissions.includes(p)) ||
        (req.permissions || []).some((p) => restorePerms.includes(p));
      if (!hasPerm) {
        return res.status(403).json({
          error: 'PERMISSION_DENIED',
          message: `You do not have permission to restore ${meta.moduleLabel} records.`,
        });
      }
    }

    const result = await ArchiveRetentionService.restoreArchivedRecord(companyId, normType, id, {
      req,
      userId: req.user?.id,
      reason: req.body?.reason,
    });

    res.json({
      success: true,
      message: `Record restored successfully to ${result.restoredStatus}.`,
      status: result.restoredStatus,
      warnings: result.warnings,
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({ error: err.code || 'RESTORE_FAILED', message: err.message, details: err.details });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Guarded permanent delete enforcing full dependency inspection & BIR 10-year statutory retention
systemArchiveRouter.delete('/archived-records/:entityType/:id/permanent', requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { entityType, id } = req.params;
    const normType = entityType.toUpperCase();
    if (!ARCHIVE_ENTITY_REGISTRY[normType]?.table) {
      return res.status(400).json({ error: 'INVALID_ENTITY', message: `Invalid entity type: ${entityType}` });
    }

    await ArchiveRetentionService.permanentlyDeleteArchivedRecord(companyId, normType, id, {
      req,
      userId: req.user?.id,
      reason: req.body?.reason,
    });

    res.json({ success: true, message: 'Record permanently deleted from archive.' });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return res.status(err.statusCode || 400).json({
        error: err.code || 'RETENTION_POLICY_BLOCKED',
        message: err.message,
        details: err.details,
      });
    }
    if (String(err?.message || '').toUpperCase().includes('FOREIGN KEY')) {
      return res.status(409).json({
        error: 'REFERENTIAL_INTEGRITY_BLOCKED',
        message: 'This archived record has dependent financial or operational transactions and cannot be permanently purged. Keep it archived or restore it instead.',
      });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.use('/system', systemArchiveRouter);

router.post('/clear-stress-test-data', requireAuth, requirePermission('masterdata:manage', 'settings:manage'), async (req, res) => {
  try {
    const { confirmClear } = req.body || {};
    const result = await MasterDataService.clearAllStressTestData({
      confirmClear: Boolean(confirmClear),
      authorizedByUserId: req.user!.id,
    });
    res.clearCookie('token');
    res.json(result);
  } catch (err: any) {
    console.error("Error clearing stress test data:", err);
    res.status(400).json({ error: "CLEAR_STRESS_TEST_DATA_FAILED", message: err?.message || "Failed to clear stress test data" });
  }
});

export default router;
