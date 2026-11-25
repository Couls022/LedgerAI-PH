import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PilotCompanyRevalidationService } from '../../src/server/services/pilotCompanyRevalidationService';
import { CompanyManager } from '../../src/server/services/companyManager';
import { buildAuthoritativeTaxReturnSnapshot } from '../../src/server/routes/tax';
import { dbContext } from '../../src/server/db/context';
import { OCRService } from '../../src/server/services/ocrService';
import { paths } from '../../src/server/services/paths';

describe('Phase E, H, J & L — Pilot Company CPA-01..CPA-06 Persistence, Subledger Reconciliation, Lock Ownership & OCR Adversarial Suite', () => {
  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
  });

  it('1. provisions and persists LGR-PH-2026-PILOT-CLEAN-01 with all 6 CPA scenarios (CPA-01 through CPA-06) and 0 centavos subledger-to-GL variance (DEF-ADV-001 & DEF-ADV-005)', async () => {
    const report = await PilotCompanyRevalidationService.ensureAndVerifyPilotCompany();

    expect(report.companyId).toBe('LGR-PH-2026-PILOT-CLEAN-01');
    expect(report.classification).toBe('PILOT');
    expect(report.encryptionContainer).toBe('LAISENC2');
    expect(report.keyMode).toBe('OS_KEYCHAIN_STANDALONE');
    expect(report.hasRecoveryEnvelope).toBe(true);

    // CPA-01 Opening Trial Balance: ₱3,900,000.00 (390,000,000 centavos)
    expect(report.openingTrialBalance.balanced).toBe(true);
    expect(report.openingTrialBalance.totalDebitsCentavos).toBe(390000000);
    expect(report.openingTrialBalance.totalCreditsCentavos).toBe(390000000);

    // Post-CPA-01..CPA-06 Closing Trial Balance: ₱4,990,855.00 (499,085,500 centavos)
    expect(report.closingTrialBalance.balanced).toBe(true);
    expect(report.closingTrialBalance.totalDebitsCentavos).toBe(499085500);
    expect(report.closingTrialBalance.totalCreditsCentavos).toBe(499085500);

    // Exact 0-centavo subledger-to-GL reconciliation across all 5 subledgers
    expect(report.subledgerReconciliation.arSubledgerCentavos).toBe(46200000); // ₱350,000 opening + ₱112,000 remaining on SI-2026-0001
    expect(report.subledgerReconciliation.arGlCentavos).toBe(46200000);
    expect(report.subledgerReconciliation.arVarianceCentavos).toBe(0);

    expect(report.subledgerReconciliation.apSubledgerCentavos).toBe(74800000); // ₱300,000 opening + ₱448,000 remaining on PB-2026-0001
    expect(report.subledgerReconciliation.apGlCentavos).toBe(74800000);
    expect(report.subledgerReconciliation.apVarianceCentavos).toBe(0);

    expect(report.subledgerReconciliation.inventorySubledgerCentavos).toBe(45000000); // 900 units @ ₱500.00
    expect(report.subledgerReconciliation.inventoryGlCentavos).toBe(45000000);
    expect(report.subledgerReconciliation.inventoryVarianceCentavos).toBe(0);

    expect(report.subledgerReconciliation.fixedAssetNbvSubledgerCentavos).toBe(49000000); // ₱600,000 cost - ₱110,000 accum depr
    expect(report.subledgerReconciliation.fixedAssetNbvGlCentavos).toBe(49000000);
    expect(report.subledgerReconciliation.fixedAssetVarianceCentavos).toBe(0);

    expect(report.subledgerReconciliation.bankReconAdjustedBalanceCentavos).toBe(244821840); // ₱2,448,218.40
    expect(report.subledgerReconciliation.cashGlCentavos).toBe(244821840);
    expect(report.subledgerReconciliation.bankReconVarianceCentavos).toBe(0);

    // Simulate application restart: close all connections, delete .db_active.sqlite, and reopen from encrypted .lai snapshot
    await CompanyManager.closeAllConnections();
    const activeSqlitePath = path.join(report.companyDir, '.db_active.sqlite');
    if (fs.existsSync(activeSqlitePath)) fs.unlinkSync(activeSqlitePath);
    if (fs.existsSync(`${activeSqlitePath}-wal`)) fs.unlinkSync(`${activeSqlitePath}-wal`);
    if (fs.existsSync(`${activeSqlitePath}-shm`)) fs.unlinkSync(`${activeSqlitePath}-shm`);

    const reopenedSqlite = await CompanyManager.getCompanySqlite('LGR-PH-2026-PILOT-CLEAN-01');
    const postRestartJournals = reopenedSqlite
      .prepare(`SELECT COUNT(*) as c FROM journal_entries WHERE company_id = 'LGR-PH-2026-PILOT-CLEAN-01' AND status = 'POSTED'`)
      .get() as { c: number };
    expect(postRestartJournals.c).toBe(8);

    // Verify exact persisted Payroll Statutory Component Bridge (Section 3)
    const prRow = reopenedSqlite
      .prepare(`SELECT total_gross_pay, total_sss, total_philhealth, total_pagibig, total_withholding_tax, total_net_pay FROM payroll_runs WHERE id = 'pr-pilot-2026-01'`)
      .get() as any;
    const piRow = reopenedSqlite
      .prepare(`SELECT gross_pay, sss_employee, sss_employer, philhealth_employee, philhealth_employer, pagibig_employee, pagibig_employer, withholding_tax, total_deductions, net_pay FROM payroll_items WHERE id = 'pi-pilot-2026-01'`)
      .get() as any;

    expect(prRow.total_gross_pay).toBe(6500000); // ₱65,000.00
    expect(piRow.sss_employee).toBe(175000); // ₱1,750.00 EE SSS
    expect(piRow.sss_employer).toBe(353000); // ₱3,500.00 ER SSS + ₱30.00 ER EC = ₱3,530.00
    expect(prRow.total_sss).toBe(528000); // ₱5,280.00 combined SSS + EC
    expect(piRow.philhealth_employee).toBe(162500); // ₱1,625.00 EE PhilHealth
    expect(piRow.philhealth_employer).toBe(162500); // ₱1,625.00 ER PhilHealth
    expect(prRow.total_philhealth).toBe(325000); // ₱3,250.00 combined PhilHealth
    expect(piRow.pagibig_employee).toBe(20000); // ₱200.00 EE Pag-IBIG
    expect(piRow.pagibig_employer).toBe(20000); // ₱200.00 ER Pag-IBIG
    expect(prRow.total_pagibig).toBe(40000); // ₱400.00 combined Pag-IBIG
    expect(prRow.total_sss + prRow.total_philhealth + prRow.total_pagibig).toBe(893000); // ₱8,930.00 combined statutory payable (GL 2040)
    expect(piRow.sss_employer + piRow.philhealth_employer + piRow.pagibig_employer).toBe(535500); // ₱5,355.00 employer statutory expense (GL 6020)
    expect(piRow.sss_employee + piRow.philhealth_employee + piRow.pagibig_employee).toBe(357500); // ₱3,575.00 employee statutory deductions
    expect(prRow.total_withholding_tax).toBe(749340); // ₱7,493.40 WTax (GL 2035)
    expect(piRow.total_deductions).toBe(1106840); // ₱11,068.40 total EE deductions
    expect(prRow.total_net_pay).toBe(5393160); // ₱53,931.60 net pay (GL 1010 Cr)
  });

  it('2. reconciles BIR Forms 2550Q, 1601-C (monthly frequency DEF-ADV-009), 1601-EQ, and 2316 directly to posted GL balances on LGR-PH-2026-PILOT-CLEAN-01 and rejects January-only data as a complete Q1 return', async () => {
    await PilotCompanyRevalidationService.ensureAndVerifyPilotCompany();
    const db = await CompanyManager.getCompanyDb('LGR-PH-2026-PILOT-CLEAN-01');

    const snap = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(
        'LGR-PH-2026-PILOT-CLEAN-01',
        '2550Q',
        '2026-01-01',
        '2026-01-31'
      )
    );

    // Form 2550Q (January 2026 interim): Output VAT ₱24,000.00 (2,400,000) - Input VAT ₱60,000.00 (6,000,000) = -₱36,000.00 (-3,600,000 excess input VAT credit)
    expect(snap.form2550Q.reconciledToGl).toBe(true);
    expect(snap.form2550Q.outputVatCentavos).toBe(2400000);
    expect(snap.form2550Q.inputVatCentavos).toBe(6000000);
    expect(snap.form2550Q.netVatPayableCentavos).toBe(-3600000);
    expect(snap.form2550Q.periodDays).toBe(31);
    expect(snap.form2550Q.periodCompleteness).toBe('INTERIM_PARTIAL_QUARTER');
    expect(snap.form2550Q.isStatutoryQuarterlyFilingReady).toBe(false);

    // Full Q1 range (2026-01-01 to 2026-03-31 = 90 days) on January-only pilot dataset MUST NOT be COMPLETE_QUARTER
    const snapFullQ1 = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(
        'LGR-PH-2026-PILOT-CLEAN-01',
        '2550Q',
        '2026-01-01',
        '2026-03-31'
      )
    );
    expect(snapFullQ1.form2550Q.periodDays).toBe(90);
    expect(snapFullQ1.form2550Q.periodCompleteness).toBe('INCOMPLETE_SOURCE_DATA');
    expect(snapFullQ1.form2550Q.isStatutoryQuarterlyFilingReady).toBe(false);
    expect(snapFullQ1.form2550Q.quarterCompletenessDiagnostics.missingTransactionMonths).toEqual([
      '2026-02',
      '2026-03',
    ]);
    expect(snapFullQ1.form2550Q.quarterCompletenessDiagnostics.statusesTriggered).toContain(
      'INCOMPLETE_SOURCE_DATA'
    );
    expect(snapFullQ1.form2550Q.quarterCompletenessDiagnostics.statusesTriggered).toContain(
      'PERIOD_NOT_CLOSED'
    );

    // Form 1601-C: Monthly Payroll Run (₱65,000.00 gross, ₱3,575.00 mandatory EE contributions, ₱61,425.00 taxable, ₱7,493.40 WTax under 2023+ TRAIN Monthly Bracket 3)
    expect(snap.form1601C.reconciledRecordedToGl).toBe(true);
    expect(snap.form1601C.payrollRunCount).toBe(1);
    expect(snap.form1601C.frequenciesDetected).toEqual(['MONTHLY']);
    expect(snap.form1601C.hasOverlappingRuns).toBe(false);
    expect(snap.form1601C.periodCoverageStatus).toBe('COMPLETE_MONTHLY_COVERAGE');
    expect(snap.form1601C.recordedWithholdingTaxCentavos).toBe(749340);
    expect(snap.form1601C.statutoryValidatedWithholdingTaxCentavos).toBe(749340);
    expect(snap.form1601C.varianceRecordedVsStatutoryCentavos).toBe(0);
    expect(snap.form1601C.glWtcPayableCentavos).toBe(749340);

    // Form 1601-EQ: 2% EWT on SP-2026-0001 (₱2,000.00 = 200,000 centavos)
    expect(snap.form1601EQ.reconciledToGl).toBe(true);
    expect(snap.form1601EQ.totalEwtWithheldCentavos).toBe(200000);
    expect(snap.form1601EQ.glEwtPayableCentavos).toBe(200000);

    // Form 2316: Employee Juan Dela Cruz
    expect(snap.form2316.employeeCount).toBe(1);
    expect(snap.form2316.employees[0].tin).toBe('214-889-331-000');
  });

  it('3. validates .server_process.lock unique instanceId ownership, recovers from PID reuse and malformed lockfiles, and blocks active foreign PIDs (DEF-ADV-004)', async () => {
    const companyId = 'LGR-PH-2026-PILOT-CLEAN-01';
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    const companyDir = manifest?.location || path.join(paths.getCompaniesRootDir(), companyId);
    const lockFilePath = path.join(companyDir, '.server_process.lock');

    await CompanyManager.closeCompanyDb(companyId);

    // Write a malformed/corrupted lock file -> should recover cleanly
    fs.writeFileSync(lockFilePath, '{corrupted_json_lock!!!');
    await CompanyManager.getCompanyDb(companyId);
    const validLock = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
    expect(validLock.pid).toBe(process.pid);
    expect(typeof validLock.instanceId).toBe('string');
    expect(validLock.instanceId.length).toBeGreaterThan(10);

    // Simulate PID reuse: same PID (process.pid) but a stale/different instanceId -> should reclaim cleanly
    await CompanyManager.closeCompanyDb(companyId);
    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({
        pid: process.pid,
        instanceId: 'stale-previous-container-instance-uuid',
        lockedAt: new Date(Date.now() - 86400000).toISOString(),
      })
    );
    await CompanyManager.getCompanyDb(companyId);
    const reclaimedLock = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
    expect(reclaimedLock.instanceId).not.toBe('stale-previous-container-instance-uuid');

    // Simulate active foreign PID (PID 1 on Linux, ppid / PID 4 on Windows) -> must reject with CONCURRENT_SERVER_LOCK_CONFLICT
    await CompanyManager.closeCompanyDb(companyId);
    const activeForeignPid = process.platform === 'win32' ? (process.ppid || 4) : (process.pid === 1 ? (process.ppid || 2) : 1);
    if (process.pid !== activeForeignPid) {
      fs.writeFileSync(
        lockFilePath,
        JSON.stringify({
          pid: activeForeignPid,
          instanceId: 'foreign-live-server-instance',
          lockedAt: new Date().toISOString(),
        })
      );
      await expect(CompanyManager.getCompanyDb(companyId)).rejects.toThrow(/CONCURRENT_SERVER_LOCK_CONFLICT/);
      // Restore valid lock for subsequent tests
      fs.unlinkSync(lockFilePath);
      await CompanyManager.getCompanyDb(companyId);
    }
  });

  it('4. flags missing transaction dates in OCRService.normalizeExtractedData + validateExtractedData instead of silently substituting today (DEF-ADV-006)', async () => {
    const normalizedMissingDate = OCRService.normalizeExtractedData({
      merchant: 'Manila Office Supplies Inc.',
      tin: '123-456-789-000',
      invoiceNumber: 'SI-9911',
      date: '',
      subtotal: 1000,
      vatAmount: 120,
      totalAmount: 1120,
    });

    expect(normalizedMissingDate.date).toBe('');
    const db = await CompanyManager.getCompanyDb('LGR-PH-2026-PILOT-CLEAN-01');
    const validation = await dbContext.run(db as any, () =>
      OCRService.validateExtractedData('LGR-PH-2026-PILOT-CLEAN-01', normalizedMissingDate)
    );
    expect(validation.isValid).toBe(false);
    expect(validation.birCompliant).toBe(false);
    expect(validation.errors).toContain('Transaction date is missing.');
  });

  it('5. handles multi-run semi-monthly payroll aggregation, excludes reversed payroll runs, and detects overlapping runs in Form 1601-C (DEF-CHAL-004)', async () => {
    const testCompId = 'LGR-PH-2026-TEST-TAX-1601C-01';
    await CompanyManager.resetDisposableTestCompanyWorkspace(testCompId);
    await CompanyManager.createCompanyProfile(
      testCompId,
      'Tax 1601-C Multi-Run Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    const sqlite = await CompanyManager.getCompanySqlite(testCompId);
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO employees (id, company_id, employee_no, first_name, last_name, tin, monthly_basic_salary, status, created_at, updated_at)
         VALUES ('emp-multi-01', ?, 'EMP-M01', 'Maria', 'Santos', '311-222-333-000', 3650000, 'ACTIVE', ?, ?)`
      )
      .run(testCompId, now, now);

    // Two semi-monthly runs of ₱18,250.00 each (WTax = 96,785 centavos each -> total 193,570 centavos)
    sqlite
      .prepare(
        `INSERT INTO payroll_runs (id, company_id, payroll_period, start_date, end_date, payment_date, total_gross_pay, total_withholding_tax, total_net_pay, status, created_at)
         VALUES
         ('pr-sm-1', ?, '2026-02-SEMI-MONTHLY-1', '2026-02-01', '2026-02-15', '2026-02-15', 1825000, 96785, 1585090, 'POSTED', ?),
         ('pr-sm-2', ?, '2026-02-SEMI-MONTHLY-2', '2026-02-16', '2026-02-28', '2026-02-28', 1825000, 96785, 1585090, 'POSTED', ?),
         ('pr-sm-rev', ?, '2026-02-SEMI-MONTHLY-REV', '2026-02-01', '2026-02-15', '2026-02-15', 1825000, 96785, 1585090, 'REVERSED', ?)`
      )
      .run(testCompId, now, testCompId, now, testCompId, now);

    sqlite
      .prepare(
        `INSERT INTO payroll_items (id, payroll_run_id, employee_id, basic_pay, gross_pay, sss_employee, philhealth_employee, pagibig_employee, withholding_tax, total_deductions, net_pay, created_at)
         VALUES
         ('pi-sm-1', 'pr-sm-1', 'emp-multi-01', 1825000, 1825000, 87500, 45625, 10000, 96785, 239910, 1585090, ?),
         ('pi-sm-2', 'pr-sm-2', 'emp-multi-01', 1825000, 1825000, 87500, 45625, 10000, 96785, 239910, 1585090, ?),
         ('pi-sm-rev', 'pr-sm-rev', 'emp-multi-01', 1825000, 1825000, 87500, 45625, 10000, 96785, 239910, 1585090, ?)`
      )
      .run(now, now, now);

    const db = await CompanyManager.getCompanyDb(testCompId);
    const snapFeb = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '1601-C', '2026-02-01', '2026-02-28')
    );

    expect(snapFeb.form1601C.payrollRunCount).toBe(2);
    expect(snapFeb.form1601C.payrollItemCount).toBe(2);
    expect(snapFeb.form1601C.frequenciesDetected).toEqual(['SEMI_MONTHLY']);
    expect(snapFeb.form1601C.hasOverlappingRuns).toBe(false);
    expect(snapFeb.form1601C.periodCoverageStatus).toBe('COMPLETE_SEMI_MONTHLY_COVERAGE');
    expect(snapFeb.form1601C.recordedWithholdingTaxCentavos).toBe(193570);
    expect(snapFeb.form1601C.statutoryValidatedWithholdingTaxCentavos).toBe(193570);
    expect(snapFeb.form1601C.varianceRecordedVsStatutoryCentavos).toBe(0);

    // Insert an overlapping active run and verify overlap detection
    sqlite
      .prepare(
        `INSERT INTO payroll_runs (id, company_id, payroll_period, start_date, end_date, payment_date, total_gross_pay, total_withholding_tax, total_net_pay, status, created_at)
         VALUES ('pr-sm-overlap', ?, '2026-02-SEMI-MONTHLY-DUP', '2026-02-10', '2026-02-20', '2026-02-20', 1825000, 96785, 1585090, 'POSTED', ?)`
      )
      .run(testCompId, now);
    sqlite
      .prepare(
        `INSERT INTO payroll_items (id, payroll_run_id, employee_id, basic_pay, gross_pay, sss_employee, philhealth_employee, pagibig_employee, withholding_tax, total_deductions, net_pay, created_at)
         VALUES ('pi-sm-overlap', 'pr-sm-overlap', 'emp-multi-01', 1825000, 1825000, 87500, 45625, 10000, 96785, 239910, 1585090, ?)`
      )
      .run(now);

    const snapOverlap = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '1601-C', '2026-02-01', '2026-02-28')
    );
    expect(snapOverlap.form1601C.hasOverlappingRuns).toBe(true);
    expect(snapOverlap.form1601C.periodCoverageStatus).toBe('OVERLAPPING_RUNS_DETECTED');

    await CompanyManager.resetDisposableTestCompanyWorkspace(testCompId);
  });

  it('6. enforces all 6 BIR Form 2550Q quarterly completeness states (INTERIM_PARTIAL_QUARTER, INCOMPLETE_SOURCE_DATA, UNPOSTED_TRANSACTION_PRESENT, PERIOD_NOT_CLOSED, REQUIRES_REVIEW, COMPLETE_QUARTER) on an isolated test company', async () => {
    const testCompId = 'LGR-PH-2026-TEST-2550Q-GATE-01';
    await CompanyManager.resetDisposableTestCompanyWorkspace(testCompId);
    await CompanyManager.createCompanyProfile(
      testCompId,
      '2550Q Completeness Gate Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    const sqlite = await CompanyManager.getCompanySqlite(testCompId);
    const db = await CompanyManager.getCompanyDb(testCompId);
    const now = Date.now();

    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
         VALUES ('usr-q-test', 'qtest@example.com', 'hash', 'Q Tester', 'ACTIVE', 0, ?, ?)`
      )
      .run(now, now);

    sqlite
      .prepare(
        `INSERT OR IGNORE INTO customers (id, company_id, code, legal_name, tin, vat_status, status, created_at, updated_at)
         VALUES ('cust-q-01', ?, 'CUST-Q1', 'Q1 Customer Corp.', '111-222-333-000', 'VAT', 'ACTIVE', ?, ?)`
      )
      .run(testCompId, now, now);

    sqlite
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, company_id, account_code, account_name, account_type, normal_balance, is_tax_account, status, created_at, updated_at)
         VALUES
         ('acc-q-1030', ?, '1030', 'Accounts Receivable', 'RECEIVABLE', 'DEBIT', 0, 'ACTIVE', ?, ?),
         ('acc-q-4010', ?, '4010', 'Sales Revenue', 'REVENUE', 'CREDIT', 0, 'ACTIVE', ?, ?),
         ('acc-q-2020', ?, '2020', 'Output VAT (12%)', 'OTHER_CURRENT_LIABILITY', 'CREDIT', 1, 'ACTIVE', ?, ?)`
      )
      .run(testCompId, now, now, testCompId, now, now, testCompId, now, now);

    // Seed Jan, Feb, Mar accounting periods as OPEN initially
    sqlite
      .prepare(
        `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
         VALUES
         ('per-q-01', ?, 'Jan 2026', '2026-01-01', '2026-01-31', 2026, 'OPEN', ?, ?),
         ('per-q-02', ?, 'Feb 2026', '2026-02-01', '2026-02-28', 2026, 'OPEN', ?, ?),
         ('per-q-03', ?, 'Mar 2026', '2026-03-01', '2026-03-31', 2026, 'OPEN', ?, ?)`
      )
      .run(testCompId, now, now, testCompId, now, now, testCompId, now, now);

    const seedMonthSale = (suffix: string, date: string, periodId: string) => {
      const jeId = `je-q-${suffix}`;
      const invId = `inv-q-${suffix}`;
      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Monthly VAT Sale', 'SALES_INVOICE', ?, 'POSTED', 'usr-q-test', 'usr-q-test', 'usr-q-test', ?, ?)`
        )
        .run(jeId, testCompId, `SJ-${suffix}`, date, periodId, invId, now, now);
      sqlite
        .prepare(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
           VALUES
           (?, ?, 'acc-q-1030', 'AR', 11200000, 0, 1, ?),
           (?, ?, 'acc-q-4010', 'Sales', 0, 10000000, 2, ?),
           (?, ?, 'acc-q-2020', 'Output VAT', 0, 1200000, 3, ?)`
        )
        .run(`jl-1-${suffix}`, jeId, now, `jl-2-${suffix}`, jeId, now, `jl-3-${suffix}`, jeId, now);
      sqlite
        .prepare(
          `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_type, invoice_date, due_date, total_amount, balance_due, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
           VALUES (?, ?, 'cust-q-01', ?, 'SALES', ?, ?, 11200000, 11200000, 'POSTED', ?, 'usr-q-test', 'usr-q-test', ?, ?)`
        )
        .run(invId, testCompId, `SI-${suffix}`, date, date, jeId, now, now);
    };

    // Only seed Jan & Feb first -> March is missing -> INCOMPLETE_SOURCE_DATA
    seedMonthSale('jan', '2026-01-15', 'per-q-01');
    seedMonthSale('feb', '2026-02-15', 'per-q-02');

    const snapIncomplete = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '2550Q', '2026-01-01', '2026-03-31')
    );
    expect(snapIncomplete.form2550Q.periodCompleteness).toBe('INCOMPLETE_SOURCE_DATA');
    expect(snapIncomplete.form2550Q.isStatutoryQuarterlyFilingReady).toBe(false);

    // Seed March sale -> all 3 months have data, but periods are still OPEN -> PERIOD_NOT_CLOSED
    seedMonthSale('mar', '2026-03-15', 'per-q-03');
    const snapOpenPeriod = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '2550Q', '2026-01-01', '2026-03-31')
    );
    expect(snapOpenPeriod.form2550Q.periodCompleteness).toBe('PERIOD_NOT_CLOSED');
    expect(snapOpenPeriod.form2550Q.isStatutoryQuarterlyFilingReady).toBe(false);

    // Add a DRAFT invoice in March -> UNPOSTED_TRANSACTION_PRESENT
    sqlite
      .prepare(
        `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_type, invoice_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES ('inv-q-draft', ?, 'cust-q-01', 'SI-DRAFT-01', 'SALES', '2026-03-20', '2026-03-20', 5600000, 5600000, 'DRAFT', 'usr-q-test', ?, ?)`
      )
      .run(testCompId, now, now);

    const snapUnposted = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '2550Q', '2026-01-01', '2026-03-31')
    );
    expect(snapUnposted.form2550Q.periodCompleteness).toBe('UNPOSTED_TRANSACTION_PRESENT');
    expect(snapUnposted.form2550Q.isStatutoryQuarterlyFilingReady).toBe(false);

    // Remove draft invoice and close all 3 accounting periods -> COMPLETE_QUARTER
    sqlite.prepare(`DELETE FROM sales_invoices WHERE id = 'inv-q-draft'`).run();
    sqlite
      .prepare(`UPDATE accounting_periods SET status = 'HARD_CLOSED' WHERE company_id = ?`)
      .run(testCompId);

    const snapComplete = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '2550Q', '2026-01-01', '2026-03-31')
    );
    expect(snapComplete.form2550Q.periodCompleteness).toBe('COMPLETE_QUARTER');
    expect(snapComplete.form2550Q.isStatutoryQuarterlyFilingReady).toBe(true);
    expect(snapComplete.form2550Q.outputVatCentavos).toBe(3600000); // 3 * ₱12,000.00 = ₱36,000.00

    // Add a late adjustment journal -> REQUIRES_REVIEW
    sqlite
      .prepare(
        `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, status, created_by, approved_by, posted_by, created_at, updated_at)
         VALUES ('je-q-late', ?, 'GJ-LATE-01', '2026-03-31', 'per-q-03', 'Late Tax Adjustment', 'PRIOR_PERIOD_ADJUSTMENT', 'POSTED', 'usr-q-test', 'usr-q-test', 'usr-q-test', ?, ?)`
      )
      .run(testCompId, now, now);

    const snapReview = await dbContext.run(db as any, () =>
      buildAuthoritativeTaxReturnSnapshot(testCompId, '2550Q', '2026-01-01', '2026-03-31')
    );
    expect(snapReview.form2550Q.periodCompleteness).toBe('REQUIRES_REVIEW');
    expect(snapReview.form2550Q.isStatutoryQuarterlyFilingReady).toBe(false);

    await CompanyManager.resetDisposableTestCompanyWorkspace(testCompId);
  });
});
