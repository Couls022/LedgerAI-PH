import { eq } from "drizzle-orm";
import { CompanyManager } from "./src/server/services/companyManager";
import * as schema from "./src/server/db/schema";
import crypto from 'crypto';

const uuidv4 = () => crypto.randomUUID();

const companyId = 'LGR-PH-2026-COR-00-59CEAD34';
const adminId = 'cpenaflor@ledgerai.ph';

async function run() {
  console.log('Connecting to DB for company:', companyId);
  const db = await CompanyManager.getCompanyDb(companyId);

  // Insert company record to satisfy foreign keys
  await db.insert(schema.companies).values({
    id: companyId,
    legalName: "DeskGuard Solutions",
    industry: "COR",
    tin: "123-456-789-000",
    registrationDate: "2026-08-17",
    status: "ACTIVE"
  }).onConflictDoNothing();

  const adminUser = await db.select().from(schema.users).where(eq(schema.users.email, adminId)).get();
  let userId = adminUser ? adminUser.id : null;

  if (!userId) {
    userId = uuidv4();
    await db.insert(schema.users).values({
       id: userId,
       email: adminId,
       displayName: 'Admin Penaflor',
       passwordHash: 'dummy',
       status: 'ACTIVE'
    }).onConflictDoNothing();
  }

  console.log("Seeding Chart of Accounts...");
  const accountsData = [
    { id: uuidv4(), companyId, accountCode: '1000', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '1200', accountName: 'Accounts Receivable', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '2000', accountName: 'Accounts Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '4000', accountName: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '5000', accountName: 'Cost of Goods Sold', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '6000', accountName: 'Operating Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '2100', accountName: 'Output VAT', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
    { id: uuidv4(), companyId, accountCode: '1100', accountName: 'Input VAT', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
  ];
  
  for (const acc of accountsData) {
    await db.insert(schema.accounts).values(acc).onConflictDoNothing();
  }

  console.log("Seeding Customers & Vendors...");
  const customers = [];
  for(let i=1; i<=100; i++) {
    customers.push({
      id: uuidv4(), companyId,
      code: 'CUST-' + i.toString().padStart(4, '0'),
      legalName: 'Client Corporation ' + i,
      contactPerson: 'Jane Doe', contactDetails: 'contact' + i + '@clientcorp.com',
      status: 'ACTIVE'
    });
  }
  await db.insert(schema.customers).values(customers).onConflictDoNothing();

  const vendors = [];
  for(let i=1; i<=100; i++) {
    vendors.push({
      id: uuidv4(), companyId,
      code: 'VEND-' + i.toString().padStart(4, '0'),
      legalName: 'Supplier Enterprise ' + i,
      contactPerson: 'John Smith', contactDetails: 'sales' + i + '@supplier.com',
      status: 'ACTIVE'
    });
  }
  await db.insert(schema.vendors).values(vendors).onConflictDoNothing();

  console.log("Seeding Sales Invoices & AR...");
  const invoices = [];
  const invoiceLines = [];
  const jeData = [];
  const jeLines = [];
  
  for(let i=1; i<=100; i++) {
    const invId = uuidv4();
    const cust = customers[i % customers.length];
    const amount = Math.floor(Math.random() * 50000) + 5000;
    
    invoices.push({
      id: invId, companyId, customerId: cust.id,
      invoiceNumber: 'INV-2026-' + i.toString().padStart(4, '0'),
      invoiceDate: '2026-08-15', dueDate: '2026-09-15',
      totalAmount: Math.round(amount * 1.12),
      status: i % 3 === 0 ? 'PAID' : 'POSTED',
      createdBy: userId,
      balanceDue: i % 3 === 0 ? 0 : Math.round(amount * 1.12)
    });

    invoiceLines.push({
      id: uuidv4(), invoiceId: invId, accountId: accountsData[3].id,
      description: 'Consulting Services ' + i,
      quantity: 1, unitPrice: amount, amount: amount
    });

    const jeId = uuidv4();
    jeData.push({
      id: jeId, companyId, journalNumber: 'JE-INV-' + i,
      entryDate: '2026-08-15', description: 'Invoice ' + invoices[invoices.length-1].invoiceNumber,
      status: 'POSTED', createdBy: userId
    });
    
    jeLines.push({ id: uuidv4(), journalEntryId: jeId, accountId: accountsData[1].id, debit: Math.round(amount * 1.12), credit: 0, lineNumber: 1 });
    jeLines.push({ id: uuidv4(), journalEntryId: jeId, accountId: accountsData[3].id, debit: 0, credit: amount, lineNumber: 2 });
    jeLines.push({ id: uuidv4(), journalEntryId: jeId, accountId: accountsData[6].id, debit: 0, credit: Math.round(amount * 0.12), lineNumber: 3 });
  }

  for (let i = 0; i < invoices.length; i += 50) {
    await db.insert(schema.salesInvoices).values(invoices.slice(i, i + 50));
    await db.insert(schema.salesInvoiceLines).values(invoiceLines.slice(i, i + 50));
    await db.insert(schema.journalEntries).values(jeData.slice(i, i + 50));
    await db.insert(schema.journalLines).values(jeLines.slice(i * 3, (i + 50) * 3));
  }

  console.log("Seeding Purchase Bills & AP...");
  const bills = [];
  const billLines = [];
  const jeBillsData = [];
  const jeBillsLines = [];

  for(let i=1; i<=100; i++) {
    const billId = uuidv4();
    const vend = vendors[i % vendors.length];
    const amount = Math.floor(Math.random() * 30000) + 2000;

    bills.push({
      id: billId, companyId, vendorId: vend.id,
      billNumber: 'BILL-2026-' + i.toString().padStart(4, '0'),
      billDate: '2026-08-10', dueDate: '2026-09-10',
      totalAmount: Math.round(amount * 1.12),
      status: 'POSTED', createdBy: userId, balanceDue: Math.round(amount * 1.12)
    });

    billLines.push({
      id: uuidv4(), billId: billId, accountId: accountsData[5].id,
      description: 'Office Supplies & Services ' + i,
      quantity: 1, unitPrice: amount, amount: amount
    });

    const jeId = uuidv4();
    jeBillsData.push({
      id: jeId, companyId, journalNumber: 'JE-BILL-' + i,
      entryDate: '2026-08-10', description: 'Bill ' + bills[bills.length-1].billNumber,
      status: 'POSTED', createdBy: userId
    });

    jeBillsLines.push({ id: uuidv4(), journalEntryId: jeId, accountId: accountsData[5].id, debit: amount, credit: 0, lineNumber: 1 });
    jeBillsLines.push({ id: uuidv4(), journalEntryId: jeId, accountId: accountsData[7].id, debit: Math.round(amount * 0.12), credit: 0, lineNumber: 2 });
    jeBillsLines.push({ id: uuidv4(), journalEntryId: jeId, accountId: accountsData[2].id, debit: 0, credit: Math.round(amount * 1.12), lineNumber: 3 });
  }

  for (let i = 0; i < bills.length; i += 50) {
    await db.insert(schema.purchaseBills).values(bills.slice(i, i + 50));
    await db.insert(schema.purchaseBillLines).values(billLines.slice(i, i + 50));
    await db.insert(schema.journalEntries).values(jeBillsData.slice(i, i + 50));
    await db.insert(schema.journalLines).values(jeBillsLines.slice(i * 3, (i + 50) * 3));
  }

  console.log("Successfully seeded test data.");
}

run().catch(console.error);
