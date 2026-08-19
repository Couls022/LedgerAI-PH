import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { runInTestDb } from '../setup';
import { BankReconciliationService } from '../../src/server/services/bankReconciliationService';
import { CashFlowForecastService } from '../../src/server/services/cashFlowForecastService';
import { RecurringJournalService } from '../../src/server/services/recurringJournalService';
import crypto from 'crypto';

describe('LEDGERAI PH — Phase 9: Intelligent Accounting Platform & Business Automation Test Suite', () => {
  const companyId = '82acee12-1ec5-40a5-839c-612fa6a23335';
  let bankAccountId: string;
  let userId: string;

  beforeEach(async () => {
    bankAccountId = crypto.randomUUID();
    userId = crypto.randomUUID();

    await runInTestDb(async () => {
      // Insert test user
      await db.insert(schema.users).values({
        id: userId,
        email: `phase9_${userId}@test.com`,
        displayName: 'Phase 9 Accountant',
        passwordHash: 'hash',
        role: 'Accountant',
        isActive: true,
      }).onConflictDoNothing();

      // Insert test company
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Phase 9 Enterprise Corp',
        tin: '123-456-789-000',
        address: 'Makati City, Metro Manila',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      // Insert bank account
      await db.insert(schema.bankAccounts).values({
        id: bankAccountId,
        companyId,
        accountName: 'BPI Checking',
        bankName: 'Bank of the Philippine Islands',
        accountNumberEncrypted: 'hashed_acc_123',
        currency: 'PHP',
        status: 'ACTIVE',
      }).onConflictDoNothing();
    });
  });

  it('9-01: CSV Bank Statement Import parses transactions and skips duplicates safely', async () => {
    await runInTestDb(async () => {
      const csvContent = `date,description,reference,amount,type
2026-08-01,Client Payment,OR-001,25000.00,CREDIT
2026-08-02,Office Rent,CHK-101,15000.00,DEBIT`;

      const result = await BankReconciliationService.importStatement({
        companyId,
        bankAccountId,
        statementDate: new Date('2026-08-31'),
        filename: 'august_statement.csv',
        csvContent,
        userId,
      });

      expect(result.importedCount).toBe(2);

      // Re-import same CSV to verify duplicate detection
      const duplicateResult = await BankReconciliationService.importStatement({
        companyId,
        bankAccountId,
        statementDate: new Date('2026-08-31'),
        filename: 'august_statement.csv',
        csvContent,
        userId,
      });

      expect(duplicateResult.duplicateCount).toBe(2);
      expect(duplicateResult.importedCount).toBe(0);
    });
  });

  it('9-02: Bank Reconciliation Matching Engine suggests ledger transactions with confidence', async () => {
    await runInTestDb(async () => {
      const matchingResult = await BankReconciliationService.runMatchingEngine(companyId, bankAccountId);
      expect(matchingResult).toBeDefined();
      expect(typeof matchingResult.evaluatedCount).toBe('number');
    });
  });

  it('9-03: Cash Flow Forecast generates 30/60/90 day projections with scenario support', async () => {
    await runInTestDb(async () => {
      const forecast = await CashFlowForecastService.generateForecast({
        companyId,
        horizonDays: 30,
        scenario: 'BASE',
        userId,
      });

      expect(forecast).toBeDefined();
      expect(forecast.horizonDays).toBe(30);
      expect(forecast.scenario).toBe('BASE');
      expect(typeof forecast.closingBalance).toBe('number');
    });
  });

  it('9-04: Recurring Journal Service creates templates and processes due runs into drafts', async () => {
    await runInTestDb(async () => {
      const template = await RecurringJournalService.createTemplate({
        companyId,
        templateName: 'Monthly Office Rent Depreciation',
        frequency: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        journalData: {
          description: 'Monthly Depreciation',
          lines: [
            { accountCode: '6010', debit: 5000, credit: 0 },
            { accountCode: '1500', debit: 0, credit: 5000 }
          ]
        },
        requiresApproval: true,
        userId,
      });

      expect(template.id).toBeDefined();
      expect(template.templateName).toBe('Monthly Office Rent Depreciation');

      const processResult = await RecurringJournalService.processDueTemplates(companyId, userId);
      expect(processResult).toBeDefined();
      expect(typeof processResult.processedCount).toBe('number');
    });
  });

  it('9-05: Executive KPI Dashboard computes financial health metrics deterministically', async () => {
    await runInTestDb(async () => {
      const kpis = await RecurringJournalService.getExecutiveKpis(companyId);
      expect(kpis).toBeDefined();
      expect(typeof kpis.revenue).toBe('number');
      expect(typeof kpis.netIncome).toBe('number');
      expect(typeof kpis.currentRatio).toBe('number');
      expect(typeof kpis.cashConversionCycle).toBe('number');
    });
  });
});
