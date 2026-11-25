import { StressTestingService } from '../src/server/services/stressTestingService';

async function main() {
  console.log('================================================================================');
  console.log('   LEDGERAI PH — MAX VOLUME SUBMODULE STRESS TESTING & 360 JOURNEY EXECUTION   ');
  console.log('================================================================================\n');

  const startTime = Date.now();
  const result = await StressTestingService.runStressTest('LedgerAI Enterprise Stress Test Corp (Max Volume Submodules)', {
    maxVolume: true,
    volumeMultiplier: 2,
    alsoPopulateTestCompany: true
  });
  const totalDuration = Date.now() - startTime;

  console.log('\n--------------------------------------------------------------------------------');
  console.log('   STRESS TESTING EXECUTION REPORT & RESULTS                                    ');
  console.log('--------------------------------------------------------------------------------');
  console.log(`Company ID         : ${result.companyId}`);
  console.log(`Company Name       : ${result.companyName}`);
  console.log(`Execution Time     : ${result.durationMs}ms (Total elapsed: ${totalDuration}ms)`);
  console.log(`Total Records      : ${result.totalRecordsCreated} entries created across all submodules`);
  console.log(`\n--- ALL SUBMODULES DATA BREAKDOWN ---`);
  console.log(`  1. Master Data:`);
  console.log(`     - Chart of Accounts       : ${result.breakdown?.chartOfAccounts || 0}`);
  console.log(`     - Banks & Accounts        : ${result.breakdown?.banks || 0}`);
  console.log(`     - Departments             : ${result.breakdown?.departments || 0}`);
  console.log(`     - Cost Centers            : ${result.breakdown?.costCenters || 0}`);
  console.log(`     - Customers Directory     : ${result.breakdown?.customers || 0}`);
  console.log(`     - Vendors / Suppliers     : ${result.breakdown?.vendors || 0}`);
  console.log(`  2. Sales & Receivables:`);
  console.log(`     - Sales Invoices          : ${result.breakdown?.salesInvoices || 0}`);
  console.log(`     - Sales Invoice Lines     : ${result.breakdown?.salesInvoiceLines || 0}`);
  console.log(`     - Customer Collections/OR : ${result.breakdown?.customerPayments || 0}`);
  console.log(`  3. Procurement & Payables:`);
  console.log(`     - Purchase Bills          : ${result.breakdown?.purchaseBills || 0}`);
  console.log(`     - Purchase Bill Lines     : ${result.breakdown?.purchaseBillLines || 0}`);
  console.log(`     - Supplier Disbursements  : ${result.breakdown?.supplierPayments || 0}`);
  console.log(`  4. Inventory & Warehouse:`);
  console.log(`     - Inventory SKUs          : ${result.breakdown?.inventoryItems || 0}`);
  console.log(`  5. Cash & Banking:`);
  console.log(`     - Cash Transactions & Lines: ${(result.breakdown?.cashTransactions || 0) + (result.breakdown?.cashTransactionLines || 0)}`);
  console.log(`     - Check Register          : ${result.breakdown?.checks || 0}`);
  console.log(`     - Bank Reconciliations    : ${result.breakdown?.bankReconciliations || 0} (${result.breakdown?.bankStatementLines || 0} statement lines)`);
  console.log(`  6. Accounting & General Ledger:`);
  console.log(`     - General Journal Entries : ${result.breakdown?.journalEntries || 0}`);
  console.log(`     - Double-Entry GL Lines   : ${result.breakdown?.journalLines || 0}`);
  console.log(`  7. Fixed Assets:`);
  console.log(`     - Capitalized Assets      : ${result.breakdown?.fixedAssets || 0}`);
  console.log(`     - Depreciation Schedules  : ${result.breakdown?.depreciationSchedules || 0}`);
  console.log(`  8. Payroll & HR:`);
  console.log(`     - Employees Master        : ${result.breakdown?.employees || 0}`);
  console.log(`     - Payroll Runs & Items    : ${(result.breakdown?.payrollRuns || 0)} runs (${result.breakdown?.payrollItems || 0} items)`);
  console.log(`  9. Tax & BIR Compliance:`);
  console.log(`     - Statutory Tax Filings   : ${result.breakdown?.taxFilings || 0}`);
  console.log(`     - Tax Calendar Deadlines  : ${result.breakdown?.taxCalendar || 0}`);
  console.log(` 10. Budgets & Financial Planning: ${result.breakdown?.budgets || 0} categories`);
  console.log(` 11. Documents & OCR:`);
  console.log(`     - Uploaded & OCR Scanned  : ${result.breakdown?.documents || 0}`);
  console.log(` 12. Approvals & Workflow:`);
  console.log(`     - Workflow Requests/Steps : ${(result.breakdown?.approvalWorkflows || 0)} requests (${result.breakdown?.approvalSteps || 0} steps)`);
  console.log(` 13. Activity & Notifications:`);
  console.log(`     - System Notifications    : ${result.breakdown?.notifications || 0}`);
  console.log(` 14. 360 Activity Journey:`);
  console.log(`     - Audit Trail Events      : ${result.auditJourneyEventsLogged}`);

  console.log(`\n--- ACCOUNTING INTEGRITY CHECK ---`);
  console.log(`  - Total Debits   : ₱${((result.integrityCheck?.totalDebits || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  console.log(`  - Total Credits  : ₱${((result.integrityCheck?.totalCredits || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  console.log(`  - Discrepancy    : ₱${((result.integrityCheck?.discrepancy || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  console.log(`  - Balanced       : ${result.integrityCheck?.balanced ? '✅ YES (100% Mathematically Balanced)' : '❌ NO'}`);
  console.log(`Status             : ${result.success ? '🚀 PASSED (ALL SUBMODULES POPULATED & PRODUCTION READY)' : '❌ FAILED'}`);

  if (result.error) {
    console.log(`Error Details      : ${result.error}`);
  }
  console.log('================================================================================\n');

  if (!result.success) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Stress Testing Utility Runner Failed:', err);
  process.exit(1);
});
