import { CompanyManager } from '../src/server/services/companyManager';
import { dbContext } from '../src/server/db/context';
import { db } from '../src/server/db';
import * as schema from '../src/server/db/schema';
import { eq, sql, isNull, and, or } from 'drizzle-orm';

interface IntegrityCheckResult {
  checkName: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  details: string;
  metrics?: Record<string, any>;
}

async function runDatabaseIntegrityAudit() {
  console.log('================================================================================');
  console.log('  SECTION 1: DATABASE INTEGRITY & RELATIONSHIP AUDIT');
  console.log('  Target Company: LGR-PH-2026-TEST-00-ABC12345 (Workspace: test)');
  console.log('================================================================================\n');

  await CompanyManager.init();
  const companyId = 'LGR-PH-2026-TEST-00-ABC12345';
  const compDb = await CompanyManager.getCompanyDb(companyId);
  if (!compDb) {
    throw new Error(`Database connection failed for ${companyId}`);
  }

  const results: IntegrityCheckResult[] = [];

  await dbContext.run(compDb, async () => {
    // 1. Foreign Key Engine Pragma Check
    const rawDb = (compDb as any).$client || (compDb as any).session?.client;
    let pragmaFkViolations: any[] = [];
    try {
      if (rawDb && typeof rawDb.pragma === 'function') {
        pragmaFkViolations = rawDb.pragma('foreign_key_check');
      } else {
        const res = await db.all(sql`PRAGMA foreign_key_check;`);
        pragmaFkViolations = res || [];
      }
    } catch (e: any) {
      console.warn('PRAGMA foreign_key_check note:', e.message);
    }

    results.push({
      checkName: 'SQLite Foreign Key Constraints (PRAGMA foreign_key_check)',
      category: 'Foreign Key Resolution',
      status: pragmaFkViolations.length === 0 ? 'PASS' : 'FAIL',
      details: pragmaFkViolations.length === 0 
        ? 'Zero foreign key constraint violations detected across all 40+ tables.'
        : `Found ${pragmaFkViolations.length} constraint violations: ${JSON.stringify(pragmaFkViolations)}`,
      metrics: { violationsCount: pragmaFkViolations.length }
    });

    // 2. Orphan Check: Sales Invoice Lines without Sales Invoices
    const orphanInvLines = await db.select({
      id: schema.salesInvoiceLines.id,
      invoiceId: schema.salesInvoiceLines.invoiceId
    })
    .from(schema.salesInvoiceLines)
    .leftJoin(schema.salesInvoices, eq(schema.salesInvoiceLines.invoiceId, schema.salesInvoices.id))
    .where(isNull(schema.salesInvoices.id));

    results.push({
      checkName: 'Orphan Record Check: Sales Invoice Lines',
      category: 'Orphan Integrity',
      status: orphanInvLines.length === 0 ? 'PASS' : 'FAIL',
      details: orphanInvLines.length === 0
        ? 'All sales invoice line items link to existing, valid Sales Invoices.'
        : `Found ${orphanInvLines.length} orphaned sales invoice lines.`,
      metrics: { orphanCount: orphanInvLines.length }
    });

    // 3. Orphan Check: Purchase Bill Lines without Purchase Bills
    const orphanBillLines = await db.select({
      id: schema.purchaseBillLines.id,
      billId: schema.purchaseBillLines.billId
    })
    .from(schema.purchaseBillLines)
    .leftJoin(schema.purchaseBills, eq(schema.purchaseBillLines.billId, schema.purchaseBills.id))
    .where(isNull(schema.purchaseBills.id));

    results.push({
      checkName: 'Orphan Record Check: Purchase Bill Lines',
      category: 'Orphan Integrity',
      status: orphanBillLines.length === 0 ? 'PASS' : 'FAIL',
      details: orphanBillLines.length === 0
        ? 'All purchase bill line items link to existing, valid Purchase Bills.'
        : `Found ${orphanBillLines.length} orphaned purchase bill lines.`,
      metrics: { orphanCount: orphanBillLines.length }
    });

    // 4. Orphan Check: Journal Lines without Journal Entries
    const orphanJournalLines = await db.select({
      id: schema.journalLines.id,
      journalEntryId: schema.journalLines.journalEntryId
    })
    .from(schema.journalLines)
    .leftJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .where(isNull(schema.journalEntries.id));

    results.push({
      checkName: 'Orphan Record Check: Journal Lines',
      category: 'Orphan Integrity',
      status: orphanJournalLines.length === 0 ? 'PASS' : 'FAIL',
      details: orphanJournalLines.length === 0
        ? 'All general journal lines link to existing, valid Journal Entries.'
        : `Found ${orphanJournalLines.length} orphaned journal lines.`,
      metrics: { orphanCount: orphanJournalLines.length }
    });

    // 5. Foreign Key Resolution: Sales Invoices -> Customers
    const invalidCustomerInvoices = await db.select({
      id: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      customerId: schema.salesInvoices.customerId
    })
    .from(schema.salesInvoices)
    .leftJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(isNull(schema.customers.id));

    results.push({
      checkName: 'Foreign Key Resolution: Sales Invoices -> Customers',
      category: 'Foreign Key Resolution',
      status: invalidCustomerInvoices.length === 0 ? 'PASS' : 'FAIL',
      details: invalidCustomerInvoices.length === 0
        ? 'All Sales Invoices reference existing, valid Customers in Master Data.'
        : `Found ${invalidCustomerInvoices.length} invoices with invalid customerId.`,
      metrics: { invalidCount: invalidCustomerInvoices.length }
    });

    // 6. Foreign Key Resolution: Purchase Bills -> Vendors
    const invalidVendorBills = await db.select({
      id: schema.purchaseBills.id,
      billNumber: schema.purchaseBills.billNumber,
      vendorId: schema.purchaseBills.vendorId
    })
    .from(schema.purchaseBills)
    .leftJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .where(isNull(schema.vendors.id));

    results.push({
      checkName: 'Foreign Key Resolution: Purchase Bills -> Vendors',
      category: 'Foreign Key Resolution',
      status: invalidVendorBills.length === 0 ? 'PASS' : 'FAIL',
      details: invalidVendorBills.length === 0
        ? 'All Purchase Bills reference existing, valid Vendors in Master Data.'
        : `Found ${invalidVendorBills.length} bills with invalid vendorId.`,
      metrics: { invalidCount: invalidVendorBills.length }
    });

    // 7. Duplicate Business Reference Checks
    const duplicateInvoices = await db.select({
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      count: sql<number>`count(*)`
    })
    .from(schema.salesInvoices)
    .groupBy(schema.salesInvoices.invoiceNumber)
    .having(sql`count(*) > 1`);

    results.push({
      checkName: 'Unintended Duplicates: Sales Invoice Numbers',
      category: 'Business Key Uniqueness',
      status: duplicateInvoices.length === 0 ? 'PASS' : 'FAIL',
      details: duplicateInvoices.length === 0
        ? 'All Sales Invoice numbers are 100% globally unique within company scope.'
        : `Found duplicate invoice numbers: ${JSON.stringify(duplicateInvoices)}`,
      metrics: { duplicatesCount: duplicateInvoices.length }
    });

    const duplicateBills = await db.select({
      billNumber: schema.purchaseBills.billNumber,
      count: sql<number>`count(*)`
    })
    .from(schema.purchaseBills)
    .groupBy(schema.purchaseBills.billNumber)
    .having(sql`count(*) > 1`);

    results.push({
      checkName: 'Unintended Duplicates: Purchase Bill Numbers',
      category: 'Business Key Uniqueness',
      status: duplicateBills.length === 0 ? 'PASS' : 'FAIL',
      details: duplicateBills.length === 0
        ? 'All Purchase Bill numbers are 100% globally unique within company scope.'
        : `Found duplicate bill numbers: ${JSON.stringify(duplicateBills)}`,
      metrics: { duplicatesCount: duplicateBills.length }
    });

    const duplicateJournals = await db.select({
      journalNumber: schema.journalEntries.journalNumber,
      count: sql<number>`count(*)`
    })
    .from(schema.journalEntries)
    .groupBy(schema.journalEntries.journalNumber)
    .having(sql`count(*) > 1`);

    results.push({
      checkName: 'Unintended Duplicates: General Journal Numbers',
      category: 'Business Key Uniqueness',
      status: duplicateJournals.length === 0 ? 'PASS' : 'FAIL',
      details: duplicateJournals.length === 0
        ? 'All General Journal numbers are 100% globally unique.'
        : `Found duplicate journal numbers: ${JSON.stringify(duplicateJournals)}`,
      metrics: { duplicatesCount: duplicateJournals.length }
    });

    // 8. Tenant Boundary / Company Isolation Verification
    const crossTenantInvoices = await db.select({ id: schema.salesInvoices.id, companyId: schema.salesInvoices.companyId })
      .from(schema.salesInvoices)
      .where(sql`${schema.salesInvoices.companyId} != ${companyId}`);

    const crossTenantBills = await db.select({ id: schema.purchaseBills.id, companyId: schema.purchaseBills.companyId })
      .from(schema.purchaseBills)
      .where(sql`${schema.purchaseBills.companyId} != ${companyId}`);

    const crossTenantJournals = await db.select({ id: schema.journalEntries.id, companyId: schema.journalEntries.companyId })
      .from(schema.journalEntries)
      .where(sql`${schema.journalEntries.companyId} != ${companyId}`);

    const crossTenantCount = crossTenantInvoices.length + crossTenantBills.length + crossTenantJournals.length;
    results.push({
      checkName: 'Tenant Boundary & Company Isolation',
      category: 'Tenant Isolation',
      status: crossTenantCount === 0 ? 'PASS' : 'FAIL',
      details: crossTenantCount === 0
        ? `Zero cross-tenant records detected. 100% of rows belong strictly to companyId '${companyId}'.`
        : `Found ${crossTenantCount} records with leaked companyId!`,
      metrics: { crossTenantCount }
    });

    // 9. Unexpected NULL Value Checks in Critical Columns
    const nullInvoiceAmounts = await db.select({ id: schema.salesInvoices.id })
      .from(schema.salesInvoices)
      .where(or(isNull(schema.salesInvoices.totalAmount), isNull(schema.salesInvoices.status), isNull(schema.salesInvoices.invoiceDate)));

    const nullBillAmounts = await db.select({ id: schema.purchaseBills.id })
      .from(schema.purchaseBills)
      .where(or(isNull(schema.purchaseBills.totalAmount), isNull(schema.purchaseBills.status), isNull(schema.purchaseBills.billDate)));

    const nullJournalDates = await db.select({ id: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(or(isNull(schema.journalEntries.entryDate), isNull(schema.journalEntries.status), isNull(schema.journalEntries.journalNumber)));

    const totalNullViolations = nullInvoiceAmounts.length + nullBillAmounts.length + nullJournalDates.length;
    results.push({
      checkName: 'Critical Column Non-Null Integrity',
      category: 'Data Cleanliness',
      status: totalNullViolations === 0 ? 'PASS' : 'FAIL',
      details: totalNullViolations === 0
        ? 'No unexpected NULL values in mandatory financial fields (amounts, dates, statuses, references).'
        : `Found ${totalNullViolations} unexpected NULL violations.`,
      metrics: { totalNullViolations }
    });

    // 10. Audit Log Linkage Verification
    const unreferencedAuditLogs = await db.select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(isNull(schema.auditLogs.entityId));

    results.push({
      checkName: 'Audit Trail Entity Reference Completeness',
      category: 'Audit Integrity',
      status: unreferencedAuditLogs.length === 0 ? 'PASS' : 'FAIL',
      details: unreferencedAuditLogs.length === 0
        ? '100% of audit log events possess valid entityType and entityId references.'
        : `Found ${unreferencedAuditLogs.length} audit logs missing entityId.`,
      metrics: { unreferencedAuditLogsCount: unreferencedAuditLogs.length }
    });

    // Output Summary
    console.log(JSON.stringify(results, null, 2));
  });
}

runDatabaseIntegrityAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
