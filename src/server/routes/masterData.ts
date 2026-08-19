import { Router } from 'express';
import { db } from '../db';
import * as schema from '../db/schema';
import { requireAuth,  requirePermission } from '../auth';
import { eq, and, sql, or, like } from 'drizzle-orm';
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from '../utils/pagination';
import crypto from 'crypto';
import { AuditService } from '../services/auditService';

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
router.get('/accounts', requireAuth, requirePermission('accounting:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { status, type } = req.query;

    let query = db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));

    const allAccounts = await query.orderBy(schema.accounts.accountCode);

    let filtered = allAccounts;
    if (status) {
      filtered = filtered.filter(a => a.status === String(status).toUpperCase());
    }
    if (type) {
      filtered = filtered.filter(a => a.accountType === String(type).toUpperCase());
    }

    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/master-data/accounts - Create account
router.post('/accounts', requireAuth, requirePermission('accounting:create'), async (req, res) => {
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
      isRetainedEarnings
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
    const newAccount = {
      id,
      companyId,
      accountCode: accountCode.trim(),
      accountName: accountName.trim(),
      accountType: typeUpper,
      detailType: detailType ? String(detailType).toUpperCase() : null,
      normalBalance: String(normalBalance).toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      parentAccountId: parentAccountId || null,
      description: description || null,
      isSubAccount: Boolean(isSubAccount),
      birTaxCategory: birTaxCategory || null,
      openingBalance: openingBalance ? Number(openingBalance) : 0,
      asOfDate: asOfDate || null,
      isControlAccount: Boolean(isControlAccount),
      isCashAccount: Boolean(isCashAccount) || ['CHECKING', 'SAVINGS', 'CASH_ON_HAND', 'PETTY_CASH', 'PAYROLL_BANK', 'DOLLAR_ACCOUNT'].includes(String(detailType).toUpperCase()),
      isTaxAccount: Boolean(isTaxAccount) || Boolean(birTaxCategory && birTaxCategory !== 'NOT_APPLICABLE'),
      isRetainedEarnings: Boolean(isRetainedEarnings) || String(detailType).toUpperCase() === 'RETAINED_EARNINGS',
      status: 'ACTIVE',
    };

    await db.insert(schema.accounts).values(newAccount);

    await AuditService.log({
      req,
      companyId,
      action: 'CREATE_ACCOUNT',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: newAccount.accountCode,
      module: 'MASTER_DATA',
      afterData: newAccount,
    });

    res.status(201).json(newAccount);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PUT /api/master-data/accounts/:id - Edit account
router.put('/accounts/:id', requireAuth, requirePermission('accounting:create'), async (req, res) => {
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

    const updatedData = {
      accountCode: accountCode ? accountCode.trim() : existing.accountCode,
      accountName: accountName ? accountName.trim() : existing.accountName,
      accountType: accountType ? String(accountType).toUpperCase() : existing.accountType,
      detailType: detailType !== undefined ? (detailType ? String(detailType).toUpperCase() : null) : existing.detailType,
      normalBalance: normalBalance ? (String(normalBalance).toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT') : existing.normalBalance,
      parentAccountId: parentAccountId !== undefined ? parentAccountId : existing.parentAccountId,
      description: description !== undefined ? description : existing.description,
      isSubAccount: isSubAccount !== undefined ? Boolean(isSubAccount) : existing.isSubAccount,
      birTaxCategory: birTaxCategory !== undefined ? birTaxCategory : existing.birTaxCategory,
      openingBalance: openingBalance !== undefined ? Number(openingBalance) : existing.openingBalance,
      asOfDate: asOfDate !== undefined ? asOfDate : existing.asOfDate,
      isControlAccount: isControlAccount !== undefined ? Boolean(isControlAccount) : existing.isControlAccount,
      isCashAccount: isCashAccount !== undefined ? Boolean(isCashAccount) : existing.isCashAccount,
      isTaxAccount: isTaxAccount !== undefined ? Boolean(isTaxAccount) : existing.isTaxAccount,
      isRetainedEarnings: isRetainedEarnings !== undefined ? Boolean(isRetainedEarnings) : existing.isRetainedEarnings,
      status: status ? String(status).toUpperCase() : existing.status,
      updatedAt: new Date(),
    };

    await db.update(schema.accounts)
      .set(updatedData)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: 'UPDATE_ACCOUNT',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: updatedData.accountCode,
      module: 'MASTER_DATA',
      beforeData: existing,
      afterData: updatedData,
    });

    res.json({ id, ...updatedData });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PATCH /api/master-data/accounts/:id/status - Activate / Deactivate
router.patch('/accounts/:id/status', requireAuth, requirePermission('accounting:create'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['ACTIVE', 'INACTIVE'].includes(String(status).toUpperCase())) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Status must be ACTIVE or INACTIVE.' });
    }

    const existing = await db.select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)))
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });
    }

    const newStatus = String(status).toUpperCase();
    await db.update(schema.accounts)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: newStatus === 'ACTIVE' ? 'ACTIVATE_ACCOUNT' : 'DEACTIVATE_ACCOUNT',
      entityType: 'ACCOUNT',
      entityId: id,
      recordReference: existing.accountCode,
      module: 'MASTER_DATA',
      beforeData: { status: existing.status },
      afterData: { status: newStatus },
    });

    res.json({ id, status: newStatus });
  } catch (err: any) {
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
router.post('/accounts/import', requireAuth, requirePermission('accounting:create'), async (req, res) => {
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
      updatedAt: new Date(),
    };

    await db.update(schema.customers).set(updated).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId)));
    res.json({ id, ...updated });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
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
      updatedAt: new Date(),
    };

    await db.update(schema.vendors).set(updated).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId)));
    res.json({ id, ...updated });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

router.patch('/vendors/:id/status', requireAuth, requirePermission('vendors:edit'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { id } = req.params;
    const { status } = req.body;
    const newStatus = String(status).toUpperCase();
    await db.update(schema.vendors).set({ status: newStatus, updatedAt: new Date() }).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId)));
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
    res.json({ message: 'Supplier deleted successfully.', id });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ============================================================================
// 4. OTHER MASTER DATA (Banks, Departments, Projects, Cost Centers, Locations, Payment Methods)
// ============================================================================

// BANKS
router.get('/banks', requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select().from(schema.banks).where(eq(schema.banks.companyId, companyId));
  res.json(list);
});

router.post('/banks', requireAuth, requirePermission('cash:manage'), async (req, res) => {
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
  res.status(201).json(bank);
});

// CASH ACCOUNTS
router.get('/cash-accounts', requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const cashAccounts = await db.select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.isCashAccount, true)));
  res.json(cashAccounts);
});

// DEPARTMENTS
router.get('/departments', requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  let list = await db.select().from(schema.departments).where(eq(schema.departments.companyId, companyId));

  if (list.length === 0) {
    const defaultDepts = [
      { id: crypto.randomUUID(), companyId, code: 'DEPT-ADM', name: 'Executive & Administration', managerName: 'Admin Head', status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'DEPT-FIN', name: 'Finance & Accounting', managerName: 'Finance Manager', status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'DEPT-OPS', name: 'Operations & Logistics', managerName: 'Ops Director', status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'DEPT-SAL', name: 'Sales & Marketing', managerName: 'Sales Lead', status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'DEPT-IT', name: 'Information Technology', managerName: 'IT Lead', status: 'ACTIVE' },
    ];
    await db.insert(schema.departments).values(defaultDepts);
    list = await db.select().from(schema.departments).where(eq(schema.departments.companyId, companyId));
  }

  res.json(list);
});

router.post('/departments', requireAuth, requirePermission('company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, managerName } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const dep = { id, companyId, code: code.trim(), name: name.trim(), managerName: managerName || null, status: 'ACTIVE' };
  await db.insert(schema.departments).values(dep);
  res.status(201).json(dep);
});

// PROJECTS
router.get('/projects', requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  let list = await db.select().from(schema.projects).where(eq(schema.projects.companyId, companyId));

  if (list.length === 0) {
    const defaultProjects = [
      { id: crypto.randomUUID(), companyId, code: 'PRJ-GEN', name: 'General Business Operations', budgetAmount: 100000000, status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'PRJ-2026-ALPHA', name: 'Client Expansion Project Alpha', budgetAmount: 50000000, status: 'ACTIVE' },
    ];
    await db.insert(schema.projects).values(defaultProjects);
    list = await db.select().from(schema.projects).where(eq(schema.projects.companyId, companyId));
  }

  res.json(list);
});

router.post('/projects', requireAuth, requirePermission('company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, clientCustomerId, budgetAmount, startDate, endDate } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const proj = {
    id,
    companyId,
    code: code.trim(),
    name: name.trim(),
    clientCustomerId: clientCustomerId || null,
    budgetAmount: budgetAmount ? Number(budgetAmount) : null,
    startDate: startDate || null,
    endDate: endDate || null,
    status: 'ACTIVE',
  };
  await db.insert(schema.projects).values(proj);
  res.status(201).json(proj);
});

// COST CENTERS
router.get('/cost-centers', requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  let list = await db.select().from(schema.costCenters).where(eq(schema.costCenters.companyId, companyId));

  if (list.length === 0) {
    const defaultCostCenters = [
      { id: crypto.randomUUID(), companyId, code: 'CC-100', name: 'Head Office Overhead', status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'CC-200', name: 'Sales & Distribution Center', status: 'ACTIVE' },
      { id: crypto.randomUUID(), companyId, code: 'CC-300', name: 'Plant & Operations Warehouse', status: 'ACTIVE' },
    ];
    await db.insert(schema.costCenters).values(defaultCostCenters);
    list = await db.select().from(schema.costCenters).where(eq(schema.costCenters.companyId, companyId));
  }

  res.json(list);
});

router.post('/cost-centers', requireAuth, requirePermission('company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, departmentId } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const cc = { id, companyId, code: code.trim(), name: name.trim(), departmentId: departmentId || null, status: 'ACTIVE' };
  await db.insert(schema.costCenters).values(cc);
  res.status(201).json(cc);
});

// LOCATIONS / BRANCHES
router.get('/locations', requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select().from(schema.locations).where(eq(schema.locations.companyId, companyId));
  res.json(list);
});

router.post('/locations', requireAuth, requirePermission('company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, address, isMainBranch } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const loc = { id, companyId, code: code.trim(), name: name.trim(), address: address || null, isMainBranch: Boolean(isMainBranch), status: 'ACTIVE' };
  await db.insert(schema.locations).values(loc);
  res.status(201).json(loc);
});

// PAYMENT METHODS
router.get('/payment-methods', requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.companyId, companyId));
  res.json(list);
});

router.post('/payment-methods', requireAuth, requirePermission('company:write'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { code, name, type, defaultAccountId } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });

  const id = crypto.randomUUID();
  const pm = { id, companyId, code: code.trim(), name: name.trim(), type: type || 'CASH', defaultAccountId: defaultAccountId || null, status: 'ACTIVE' };
  await db.insert(schema.paymentMethods).values(pm);
  res.status(201).json(pm);
});

// ================= TAX CODES =================
router.get('/tax-codes', requireAuth, requirePermission('tax:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const taxCodesList = await db
      .select()
      .from(schema.taxCodes)
      .where(eq(schema.taxCodes.companyId, companyId));
    res.json(taxCodesList);
  } catch (err: any) {
    console.error("Error fetching tax codes:", err);
    res.status(500).json({ error: "Failed to fetch tax codes", details: err?.message });
  }
});

router.post('/tax-codes', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { code, name, taxType, description, inputOutputDirection, status } = req.body;

    const existing = await db
      .select()
      .from(schema.taxCodes)
      .where(and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.code, code)))
      .get();

    if (existing) {
      return res.status(400).json({ error: "Tax code already exists" });
    }

    await db.insert(schema.taxCodes).values({
      id: crypto.randomUUID(),
      companyId,
      code,
      name,
      taxType,
      description,
      inputOutputDirection,
      status: status || "ACTIVE",
    });

    res.json({ message: "Tax code created successfully" });
  } catch (err: any) {
    console.error("Error creating tax code:", err);
    res.status(500).json({ error: "Failed to create tax code", details: err?.message });
  }
});

router.put('/tax-codes/:id', requireAuth, requirePermission('tax:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { code, name, taxType, description, inputOutputDirection, status } = req.body;

    await db.update(schema.taxCodes).set({
      code,
      name,
      taxType,
      description,
      inputOutputDirection,
      status,
      updatedAt: new Date(),
    }).where(and(eq(schema.taxCodes.companyId, companyId), eq(schema.taxCodes.id, req.params.id)));

    res.json({ message: "Tax code updated successfully" });
  } catch (err: any) {
    console.error("Error updating tax code:", err);
    res.status(500).json({ error: "Failed to update tax code", details: err?.message });
  }
});


export default router;
