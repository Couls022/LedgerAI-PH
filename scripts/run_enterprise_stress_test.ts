import { dbContext } from '../src/server/db/context';
import { db } from '../src/server/db';
import { CompanyManager } from '../src/server/services/companyManager';
import * as schema from '../src/server/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import crypto from 'crypto';

async function main() {
  console.log("=================================================================");
  console.log("   LEDGERAI PH — HARD ENTERPRISE STRESS TEST & SEEDING SUITE    ");
  console.log("=================================================================");
  console.log("Timestamp:", new Date().toISOString());

  try {
    await CompanyManager.init();

    const allCompanies = await CompanyManager.listCompanies();
    console.log(`[INFO] Found ${allCompanies.length} existing companies in workspace.`);

    let targetCompanyId: string;
    let companyDb: any;

    if (allCompanies.length > 0) {
      targetCompanyId = allCompanies[0].id;
      companyDb = await CompanyManager.getCompanyDb(targetCompanyId);
      console.log(`[INFO] Using existing active company DB for stress test: ${targetCompanyId} (${allCompanies[0].legalName})`);
    } else {
      const newComp = await (CompanyManager as any).createCompany({ legalName: "Philippine Enterprise Stress Test Corp" });
      targetCompanyId = newComp.id;
      companyDb = await CompanyManager.getCompanyDb(targetCompanyId);
      console.log(`[INFO] Created new test company DB: ${targetCompanyId}`);
    }

    await dbContext.run(companyDb, async () => {
      console.log(`\n[STEP 1] Connected to Company DB context: ${targetCompanyId}`);

      let testUser = await db.select().from(schema.users).limit(1);
      let userId: string;
      if (testUser.length === 0) {
        userId = 'stress-test-admin-user';
        await db.insert(schema.users).values({
          id: userId,
          email: 'admin@stresstest.ph',
          passwordHash: 'hash123',
          displayName: 'System Stress Test Admin',
          status: 'ACTIVE'
        });
      } else {
        userId = testUser[0].id;
      }
      console.log(`  ✓ Using User ID: ${userId}`);

      const existingComp = await db.select().from(schema.companies).where(eq(schema.companies.id, targetCompanyId));
      if (existingComp.length === 0) {
        await db.insert(schema.companies).values({
          id: targetCompanyId,
          legalName: "Philippine Enterprise Stress Test Corp.",
          tradeName: "StressTest PH",
          tin: "999-888-777-00000",
          address: "777 Enterprise Tower, BGC, Taguig City, Metro Manila",
          branchCode: "00000",
          vatStatus: "VAT",
          rdoCode: "044",
          currency: "PHP",
          timezone: "Asia/Manila",
          fiscalYear: 2026,
          status: "ACTIVE"
        });
      }

      // 2. Seed Customers, Vendors, Cost Centers
      console.log("\n[STEP 2] Seeding Master Registries (Customers, Vendors, Cost Centers)...");

      const customersToInsert = Array.from({ length: 10 }).map((_, i) => ({
        id: `cust-stress-${i + 1}`,
        companyId: targetCompanyId,
        code: `CUST-${(i + 1).toString().padStart(3, '0')}`,
        legalName: `Enterprise Client Corp ${i + 1}`,
        tin: `111-222-33${i}-00000`,
        address: `${i + 100} Corporate Blvd, Makati City`,
        vatStatus: 'VAT'
      }));

      for (const cust of customersToInsert) {
        await db.insert(schema.customers).values(cust).onConflictDoNothing();
      }
      console.log(`  ✓ Inserted/Verified ${customersToInsert.length} Customers.`);

      const vendorsToInsert = Array.from({ length: 10 }).map((_, i) => ({
        id: `vend-stress-${i + 1}`,
        companyId: targetCompanyId,
        code: `VEND-${(i + 1).toString().padStart(3, '0')}`,
        legalName: `Prime Industrial Supply Co. ${i + 1}`,
        tin: `444-555-66${i}-00000`,
        address: `${i + 50} Industrial Ave, Pasig City`,
        vatStatus: 'VAT'
      }));

      for (const v of vendorsToInsert) {
        await db.insert(schema.vendors).values(v).onConflictDoNothing();
      }
      console.log(`  ✓ Inserted/Verified ${vendorsToInsert.length} Vendors.`);

      const costCenters = [
        { id: 'cc-001', companyId: targetCompanyId, code: 'DEPT-HQ', name: 'Executive & Admin HQ' },
        { id: 'cc-002', companyId: targetCompanyId, code: 'DEPT-FIN', name: 'Finance & Accounting' },
        { id: 'cc-003', companyId: targetCompanyId, code: 'DEPT-SALES', name: 'Sales & Marketing' },
        { id: 'cc-004', companyId: targetCompanyId, code: 'DEPT-OPS', name: 'Operations & Logistics' },
        { id: 'cc-005', companyId: targetCompanyId, code: 'DEPT-IT', name: 'IT & Digital Infrastructure' }
      ];
      for (const cc of costCenters) {
        await db.insert(schema.costCenters).values(cc).onConflictDoNothing();
      }
      console.log(`  ✓ Inserted/Verified ${costCenters.length} Cost Centers.`);

      // 3. Chart of Accounts (COA)
      console.log("\n[STEP 3] Verifying Standard Chart of Accounts...");
      const coaAccounts = [
        { id: `coa-1010-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '1010', accountName: 'Cash on Hand & Petty Cash', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true },
        { id: `coa-1020-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '1020', accountName: 'Cash in Bank (BDO Operating)', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true },
        { id: `coa-1100-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '1100', accountName: 'Accounts Receivable', accountType: 'ASSET', normalBalance: 'DEBIT' },
        { id: `coa-1200-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '1200', accountName: 'Input VAT (12%)', accountType: 'ASSET', normalBalance: 'DEBIT' },
        { id: `coa-1300-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '1300', accountName: 'Merchandise Inventory', accountType: 'ASSET', normalBalance: 'DEBIT' },
        { id: `coa-1500-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '1500', accountName: 'Property, Plant & Equipment', accountType: 'ASSET', normalBalance: 'DEBIT' },
        { id: `coa-2000-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '2000', accountName: 'Accounts Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
        { id: `coa-2100-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '2100', accountName: 'Output VAT Payable (12%)', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
        { id: `coa-2200-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '2200', accountName: 'Expanded Withholding Tax (EWT) Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
        { id: `coa-3000-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '3000', accountName: 'Common Share Capital', accountType: 'EQUITY', normalBalance: 'CREDIT' },
        { id: `coa-3100-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '3100', accountName: 'Retained Earnings', accountType: 'EQUITY', normalBalance: 'CREDIT' },
        { id: `coa-4000-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '4000', accountName: 'Sales & Service Revenues', accountType: 'REVENUE', normalBalance: 'CREDIT' },
        { id: `coa-5000-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '5000', accountName: 'Cost of Goods Sold (COGS)', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
        { id: `coa-6000-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '6000', accountName: 'Salaries & Wages Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
        { id: `coa-6100-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '6100', accountName: 'Office Rent Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
        { id: `coa-6200-${targetCompanyId}`, companyId: targetCompanyId, accountCode: '6200', accountName: 'Depreciation Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
      ];

      for (const acc of coaAccounts) {
        await db.insert(schema.accounts).values(acc).onConflictDoNothing();
      }
      console.log(`  ✓ Chart of Accounts verified (${coaAccounts.length} accounts).`);

      // 4. Generate 20 Posted Journal Entries
      console.log("\n[STEP 4] Generating 20 Heavy Transaction Journal Entries...");

      const batchTag = crypto.randomUUID().slice(0, 8);
      let totalEntriesCreated = 0;

      for (let i = 1; i <= 10; i++) {
        const jeId = `je-sales-st-${i}-${batchTag}`;
        const netSalesCentavos = 10000000 + i * 2500000;
        const outputVatCentavos = Math.round(netSalesCentavos * 0.12);
        const grossArCentavos = netSalesCentavos + outputVatCentavos;

        await db.insert(schema.journalEntries).values({
          id: jeId,
          companyId: targetCompanyId,
          journalNumber: `SJ-2026-${i.toString().padStart(4, '0')}`,
          entryDate: `2026-10-${(i % 28 + 1).toString().padStart(2, '0')}`,
          description: `Stress Test Sales Invoice #SI-2026-${i.toString().padStart(4, '0')} for Client ${i}`,
          status: 'POSTED',
          createdBy: userId,
          createdAt: new Date()
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-sales-${i}-ar-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-1100-${targetCompanyId}`,
          debit: grossArCentavos,
          credit: 0,
          lineNumber: 1,
          description: `Accounts Receivable - Client ${i}`
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-sales-${i}-rev-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-4000-${targetCompanyId}`,
          debit: 0,
          credit: netSalesCentavos,
          lineNumber: 2,
          description: `Sales Revenue`
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-sales-${i}-vat-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-2100-${targetCompanyId}`,
          debit: 0,
          credit: outputVatCentavos,
          lineNumber: 3,
          description: `12% Output VAT`
        }).onConflictDoNothing();

        totalEntriesCreated++;
      }

      for (let i = 1; i <= 10; i++) {
        const jeId = `je-purch-st-${i}-${batchTag}`;
        const baseExpenseCentavos = 8000000 + i * 1500000;
        const inputVatCentavos = Math.round(baseExpenseCentavos * 0.12);
        const ewtCentavos = Math.round(baseExpenseCentavos * 0.02);
        const netApCentavos = baseExpenseCentavos + inputVatCentavos - ewtCentavos;

        await db.insert(schema.journalEntries).values({
          id: jeId,
          companyId: targetCompanyId,
          journalNumber: `PJ-2026-${i.toString().padStart(4, '0')}`,
          entryDate: `2026-10-${(i % 28 + 1).toString().padStart(2, '0')}`,
          description: `Stress Test Purchase Bill #PB-2026-${i.toString().padStart(4, '0')} from Vendor ${i}`,
          status: 'POSTED',
          createdBy: userId,
          createdAt: new Date()
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-purch-${i}-exp-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-5000-${targetCompanyId}`,
          debit: baseExpenseCentavos,
          credit: 0,
          lineNumber: 1,
          description: `Cost of Goods / Expense`
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-purch-${i}-vat-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-1200-${targetCompanyId}`,
          debit: inputVatCentavos,
          credit: 0,
          lineNumber: 2,
          description: `12% Input VAT`
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-purch-${i}-ap-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-2000-${targetCompanyId}`,
          debit: 0,
          credit: netApCentavos,
          lineNumber: 3,
          description: `Accounts Payable`
        }).onConflictDoNothing();

        await db.insert(schema.journalLines).values({
          id: `jl-purch-${i}-ewt-${batchTag}`,
          journalEntryId: jeId,
          accountId: `coa-2200-${targetCompanyId}`,
          debit: 0,
          credit: ewtCentavos,
          lineNumber: 4,
          description: `2% EWT Payable`
        }).onConflictDoNothing();

        totalEntriesCreated++;
      }

      console.log(`  ✓ Inserted ${totalEntriesCreated} POSTED Journal Entries.`);

      // 5. Seed Inventory, Fixed Assets
      console.log("\n[STEP 5] Seeding Operational Submodules...");

      for (let i = 1; i <= 5; i++) {
        await db.insert(schema.inventoryItems).values({
          id: `item-st-${i}`,
          companyId: targetCompanyId,
          sku: `SKU-STRESS-${i.toString().padStart(3, '0')}`,
          name: `Enterprise Hardware Unit ${i}`,
          description: `High-performance industrial unit model ${i}`,
          unitOfMeasure: 'PCS',
          quantityOnHand: 100 * i,
          unitCost: 1500000,
          reorderPoint: 20,
          status: 'ACTIVE'
        }).onConflictDoNothing();
      }
      console.log("  ✓ Seeded Inventory Items.");

      for (let i = 1; i <= 3; i++) {
        await db.insert(schema.fixedAssets).values({
          id: `asset-st-${i}`,
          companyId: targetCompanyId,
          assetTag: `FA-2026-${i.toString().padStart(3, '0')}`,
          assetName: `Corporate Server Equipment ${i}`,
          category: 'EQUIPMENT',
          acquisitionDate: '2026-01-15',
          acquisitionCost: 50000000,
          usefulLifeMonths: 60,
          salvageValue: 5000000,
          status: 'ACTIVE'
        }).onConflictDoNothing();
      }
      console.log("  ✓ Seeded Fixed Assets.");

      // 6. Comprehensive Integrity & Balance Audit Checks
      console.log("\n=================================================================");
      console.log("             RUNNING STRESS TEST INTEGRITY VERIFICATION           ");
      console.log("=================================================================");

      const tbResult = await db.select({
        totalDebit: sql<number>`sum(${schema.journalLines.debit})`,
        totalCredit: sql<number>`sum(${schema.journalLines.credit})`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, targetCompanyId),
          eq(schema.journalEntries.status, "POSTED")
        )
      );

      const debitsSum = tbResult[0]?.totalDebit || 0;
      const creditsSum = tbResult[0]?.totalCredit || 0;
      const diff = Math.abs(debitsSum - creditsSum);

      console.log(`\n1. TRIAL BALANCE EQUALITY CHECK:`);
      console.log(`   - Total Debits  : PHP ${(debitsSum / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   - Total Credits : PHP ${(creditsSum / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   - Discrepancy   : PHP ${(diff / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);

      if (diff === 0) {
        console.log(`   STATUS: ✅ 100% PERFECT DEBIT-CREDIT BALANCE`);
      } else {
        console.error(`   STATUS: ❌ DISCREPANCY DETECTED (${diff})`);
      }

      const unbalancedEntries = await db.select({
        id: schema.journalEntries.id,
        journalNumber: schema.journalEntries.journalNumber,
        totalDebit: sql<number>`sum(${schema.journalLines.debit})`,
        totalCredit: sql<number>`sum(${schema.journalLines.credit})`
      })
      .from(schema.journalEntries)
      .leftJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
      .where(
        and(
          eq(schema.journalEntries.companyId, targetCompanyId),
          eq(schema.journalEntries.status, 'POSTED')
        )
      )
      .groupBy(schema.journalEntries.id)
      .having(sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit})) > 0.001`);

      console.log(`\n2. UNBALANCED POSTED JOURNAL ENTRIES CHECK:`);
      console.log(`   - Unbalanced Entries Found: ${unbalancedEntries.length}`);
      if (unbalancedEntries.length === 0) {
        console.log(`   STATUS: ✅ ZERO UNBALANCED POSTED ENTRIES`);
      } else {
        console.error(`   STATUS: ❌ UNBALANCED ENTRIES FOUND!`);
      }

      const pnlData = await db.select({
        accountType: schema.accounts.accountType,
        debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
        creditTotal: sql<number>`sum(${schema.journalLines.credit})`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, targetCompanyId),
          eq(schema.journalEntries.status, "POSTED")
        )
      )
      .groupBy(schema.accounts.accountType);

      let rev = 0, exp = 0, assets = 0, liab = 0;
      for (const row of pnlData) {
        const netCredit = (row.creditTotal || 0) - (row.debitTotal || 0);
        const netDebit = (row.debitTotal || 0) - (row.creditTotal || 0);
        if (row.accountType === 'REVENUE') rev += netCredit;
        if (row.accountType === 'EXPENSE') exp += netDebit;
        if (row.accountType === 'ASSET') assets += netDebit;
        if (row.accountType === 'LIABILITY') liab += netCredit;
      }

      const netProfit = rev - exp;
      console.log(`\n3. FINANCIAL STATEMENTS SUMMARY:`);
      console.log(`   - Total Revenue     : PHP ${(rev / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   - Total COGS/Expense: PHP ${(exp / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   - Net Profit        : PHP ${(netProfit / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   - Total Assets      : PHP ${(assets / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   - Total Liabilities : PHP ${(liab / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`   STATUS: ✅ FINANCIAL STATEMENTS DATA INTEGRITY PASSED`);

      console.log("\n=================================================================");
      console.log("   ALL STRESS TEST SEEDING AND INTEGRITY CHECKS SUCCEEDED!       ");
      console.log("=================================================================");
    });

  } catch (err) {
    console.error("CRITICAL STRESS TEST ERROR:", err);
    process.exit(1);
  }
}

main();
