import { CompanyManager } from './src/server/services/companyManager';
import { dbContext } from './src/server/db/context';
import { db, schema } from './src/server/db';
import { eq } from 'drizzle-orm';
import { RbacService } from './src/server/services/rbacService';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { hashToken } from './src/server/auth';

const BASE_URL = 'http://localhost:3000';

async function generateTestTokens() {
  const companies = await CompanyManager.listCompanies();
  const company = companies.find(c => c.legalName.includes('DeskGuard'));
  if (!company) throw new Error("Company not found");
  const companyDb = await CompanyManager.getCompanyDb(company.id);
  
  let token1 = null;
  let token2 = null;
  await dbContext.run(companyDb, async () => {
    let u1 = await db.select().from(schema.users).where(eq(schema.users.email, 'creator@example.com')).get();
    if (!u1) {
      const id = crypto.randomUUID();
      await db.insert(schema.users).values({ id, email: 'creator@example.com', displayName: 'Creator', passwordHash: 'hash', status: 'ACTIVE' });
      u1 = await db.select().from(schema.users).where(eq(schema.users.email, 'creator@example.com')).get();
    }
    
    let u2 = await db.select().from(schema.users).where(eq(schema.users.email, 'approver@example.com')).get();
    if (!u2) {
      const id = crypto.randomUUID();
      await db.insert(schema.users).values({ id, email: 'approver@example.com', displayName: 'Approver', passwordHash: 'hash', status: 'ACTIVE' });
      u2 = await db.select().from(schema.users).where(eq(schema.users.email, 'approver@example.com')).get();
    }
    
    // Give users all permissions
    
    let membership1 = await db.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, u1!.id)).get();
    if (!membership1) {
        await db.insert(schema.companyUsers).values({
            id: crypto.randomUUID(),
            companyId: company.id,
            userId: u1!.id,
            status: 'ACTIVE'
        });
        membership1 = await db.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, u1!.id)).get();
    }
    
    const ownerRole1 = await RbacService.ensureRoleRecord('Company Owner');
    await db.update(schema.companyUsers).set({ roleId: ownerRole1.id }).where(eq(schema.companyUsers.id, membership1.id));
    await db.delete(schema.companyUserRoles).where(eq(schema.companyUserRoles.companyUserId, membership1.id));
    await db.insert(schema.companyUserRoles).values({ id: crypto.randomUUID(), companyUserId: membership1.id, roleId: ownerRole1.id });


    let membership2 = await db.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, u2!.id)).get();
    if (!membership2) {
        await db.insert(schema.companyUsers).values({
            id: crypto.randomUUID(),
            companyId: company.id,
            userId: u2!.id,
            status: 'ACTIVE'
        });
        membership2 = await db.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, u2!.id)).get();
    }
    
    const ownerRole2 = await RbacService.ensureRoleRecord('Company Owner');
    await db.update(schema.companyUsers).set({ roleId: ownerRole2.id }).where(eq(schema.companyUsers.id, membership2.id));
    await db.delete(schema.companyUserRoles).where(eq(schema.companyUserRoles.companyUserId, membership2.id));
    await db.insert(schema.companyUserRoles).values({ id: crypto.randomUUID(), companyUserId: membership2.id, roleId: ownerRole2.id });


    let license = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, company.id)).get();
    if (!license)
 {
        await db.insert(schema.companyLicenses).values({
            id: crypto.randomUUID(),
            companyId: company.id,
            licenseKey: 'LIC-TRIAL-123',
            planType: 'TRIAL',
            status: 'ACTIVE',
            trialStartDate: new Date().toISOString(),
            expirationDate: new Date(Date.now() + 86400000).toISOString(),
            signedFileContent: "{}"
        });
    } else {
        await db.update(schema.companyLicenses)
            .set({ licenseKey: 'LIC-TRIAL-123', planType: 'TRIAL', signedFileContent: '{}', status: 'ACTIVE' })
            .where(eq(schema.companyLicenses.id, license.id));
    }

    const sessionId1 = crypto.randomUUID().replace(/-/g, '');
    await db.insert(schema.sessions).values({
      id: hashToken(sessionId1),
      userId: u1!.id,
      expiresAt: new Date(Date.now() + 86400000)
    });
    
    const sessionId2 = crypto.randomUUID().replace(/-/g, '');
    await db.insert(schema.sessions).values({
      id: hashToken(sessionId2),
      userId: u2!.id,
      expiresAt: new Date(Date.now() + 86400000)
    });
    
    token1 = `${company.id}.${sessionId1}`;
    token2 = `${company.id}.${sessionId2}`;
  });
  return { token1, token2 };
}

async function runTests() {
  console.log("Generating tokens...");
  const { token1, token2 } = await generateTestTokens();
  console.log(`Token 1 generated: ${token1!.substring(0, 20)}...`);
  console.log(`Token 2 generated: ${token2!.substring(0, 20)}...`);

  const headers1 = {
    'Authorization': `Bearer ${token1}`,
    'Content-Type': 'application/json'
  };
  
  const headers2 = {
    'Authorization': `Bearer ${token2}`,
    'Content-Type': 'application/json'
  };

  // Test 1: Dashboard
  console.log("\n--- Testing Dashboard ---");
  const dashboardRes = await fetch(`${BASE_URL}/api/dashboard/overview`, { headers: headers1 });
  console.log(`Status: ${dashboardRes.status}`);
  const dashboardData = await dashboardRes.json();
  console.log("Dashboard response:", JSON.stringify(dashboardData).substring(0, 150));

  // Test 2: Chart of Accounts
  console.log("\n--- Testing Chart of Accounts ---");
  const accountsRes = await fetch(`${BASE_URL}/api/accounting/accounts`, { headers: headers1 });
  const accounts = await accountsRes.json();
  console.log(`Found ${accounts?.length || 0} accounts.`);
  
  const salesAccount = accounts.find((a: any) => a.accountType === 'REVENUE');
  const arAccount = accounts.find((a: any) => a.accountCode === '1120');

  // Test 3: Customers
  console.log("\n--- Testing Customers ---");
  const customerRes = await fetch(`${BASE_URL}/api/master-data/customers`, { headers: headers1 });
  const customers = await customerRes.json();
  console.log(`Found ${customers?.length || 0} customers.`);
  
  let customerId = customers[0]?.id;
  if (!customerId) {
      console.log("Creating test customer...");
      const newCustomerRes = await fetch(`${BASE_URL}/api/master-data/customers`, {
          method: 'POST',
          headers: headers1,
          body: JSON.stringify({
              code: 'CUST-007',
              legalName: 'Test Customer 7',
              tin: '123-456-789-000',
              status: 'ACTIVE'
          })
      });
      const newCustomer = await newCustomerRes.json();
      customerId = newCustomer.id;
      console.log(`Created customer: ${customerId}`);
  }

  // Test 4: Sales Invoice
  console.log("\n--- Testing Sales Invoice E2E ---");
  const siRes = await fetch(`${BASE_URL}/api/accounting/sales-invoices`, {
      method: 'POST',
      headers: headers1,
      body: JSON.stringify({
          customerId,
          invoiceNumber: `INV-${Date.now()}`,
          totalAmount: 10055, // e.g. 112.61 in centavos if backend expects centavos, or 112.61 if float
          invoiceDate: new Date().toISOString().split('T')[0],
          dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          description: 'Live Test Invoice',
          paymentTerms: 'Net 30',
          lines: [
              {
                  accountId: salesAccount?.id || accounts[0].id,
                  description: 'Consulting Services',
                  quantity: 1,
                  unitPrice: 10055, 
                  amount: 10055,
                  taxCode: 'VAT'
              }
          ]
      })
  });
  
  console.log(`SI Create Status: ${siRes.status}`);
  const siText = await siRes.text();
  console.log(`SI Create Response: ${siText.substring(0, 100)}`);
  
  if (siRes.ok) {
      const siId = JSON.parse(siText).id;
      
      console.log(`\nSubmitting SI ${siId}...`);
      const submitRes = await fetch(`${BASE_URL}/api/accounting/sales-invoices/${siId}/submit`, { method: 'POST', headers: headers1 });
      console.log(`Submit Status: ${submitRes.status}, Body: ${await submitRes.text()}`);
      
      console.log(`Approving SI ${siId} with user 2...`);
      const approveRes = await fetch(`${BASE_URL}/api/accounting/sales-invoices/${siId}/approve`, { method: 'POST', headers: headers2 });
      console.log(`Approve Status: ${approveRes.status}, Body: ${await approveRes.text()}`);
      
      console.log(`Posting SI ${siId}...`);
      const postRes = await fetch(`${BASE_URL}/api/accounting/sales-invoices/${siId}/post`, { method: 'POST', headers: headers1 });
      console.log(`Post Status: ${postRes.status}, Body: ${await postRes.text()}`);
      
      // Check Trial Balance
      console.log("\n--- Testing Trial Balance ---");
      const tbRes = await fetch(`${BASE_URL}/api/reports/trial-balance?startDate=2020-01-01&endDate=2030-12-31`, { headers: headers1 });
      const tbData = await tbRes.json();
      console.log('TB:', JSON.stringify(tbData));
      if (tbData.data) {
         console.log("TB Data:", JSON.stringify(tbData.data.slice(0, 5)));
      }
      
      // Check Dashboard again
      console.log("\n--- Testing Dashboard Update ---");
      const dash2Res = await fetch(`${BASE_URL}/api/dashboard/overview`, { headers: headers1 });
      const dash2Data = await dash2Res.json();
      console.log("Dashboard after post:", JSON.stringify(dash2Data).substring(0, 150));
  }
}

runTests().catch(console.error);
