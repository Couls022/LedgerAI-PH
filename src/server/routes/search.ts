import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, like, or, sql } from "drizzle-orm";

const router = Router();

router.get("/", requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const q = (req.query.q as string || "").trim();

  if (!q) {
    res.json({
      query: "",
      results: {
        transactions: [],
        documents: [],
        taxRecords: [],
        contacts: []
      }
    });
    return;
  }

  const searchTerm = `%${q}%`;

  try {
    // 1. Journal Entries
    const journals = await db
      .select({
        id: schema.journalEntries.id,
        number: schema.journalEntries.journalNumber,
        date: schema.journalEntries.entryDate,
        description: schema.journalEntries.description,
        status: schema.journalEntries.status,
      })
      .from(schema.journalEntries)
      .where(
        sql`(
          ${schema.journalEntries.journalNumber} LIKE ${searchTerm} OR
          ${schema.journalEntries.description} LIKE ${searchTerm} OR
          ${schema.journalEntries.status} LIKE ${searchTerm}
        )`
      )
      .limit(8);

    // 2. Sales Invoices
    const invoices = await db
      .select({
        id: schema.salesInvoices.id,
        number: schema.salesInvoices.invoiceNumber,
        date: schema.salesInvoices.invoiceDate,
        amount: schema.salesInvoices.totalAmount,
        status: schema.salesInvoices.status,
        customerName: schema.customers.legalName,
      })
      .from(schema.salesInvoices)
      .leftJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
      .where(
        sql`(
          ${schema.salesInvoices.invoiceNumber} LIKE ${searchTerm} OR
          ${schema.customers.legalName} LIKE ${searchTerm} OR
          ${schema.salesInvoices.status} LIKE ${searchTerm}
        )`
      )
      .limit(8);

    // 3. Purchase Bills
    const bills = await db
      .select({
        id: schema.purchaseBills.id,
        number: schema.purchaseBills.billNumber,
        date: schema.purchaseBills.billDate,
        amount: schema.purchaseBills.totalAmount,
        status: schema.purchaseBills.status,
        vendorName: schema.vendors.legalName,
      })
      .from(schema.purchaseBills)
      .leftJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
      .where(
        sql`(
          ${schema.purchaseBills.billNumber} LIKE ${searchTerm} OR
          ${schema.vendors.legalName} LIKE ${searchTerm} OR
          ${schema.purchaseBills.status} LIKE ${searchTerm}
        )`
      )
      .limit(8);

    // 4. Cash Transactions
    const cashTxs = await db
      .select({
        id: schema.cashTransactions.id,
        number: schema.cashTransactions.transactionNumber,
        type: schema.cashTransactions.type,
        date: schema.cashTransactions.transactionDate,
        amount: schema.cashTransactions.totalAmount,
        description: schema.cashTransactions.description,
        status: schema.cashTransactions.status,
      })
      .from(schema.cashTransactions)
      .where(
        sql`(
          ${schema.cashTransactions.transactionNumber} LIKE ${searchTerm} OR
          ${schema.cashTransactions.description} LIKE ${searchTerm} OR
          ${schema.cashTransactions.type} LIKE ${searchTerm} OR
          ${schema.cashTransactions.reference} LIKE ${searchTerm}
        )`
      )
      .limit(8);

    // 5. Documents
    const docs = await db
      .select({
        id: schema.documents.id,
        fileName: schema.documents.fileName,
        fileType: schema.documents.fileType,
        entityType: schema.documents.entityType,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        sql`(
          ${schema.documents.fileName} LIKE ${searchTerm} OR
          ${schema.documents.entityType} LIKE ${searchTerm}
        )`
      )
      .limit(8);

    // 6. Tax Codes
    const taxCodesList = await db
      .select({
        id: schema.taxCodes.id,
        code: schema.taxCodes.code,
        name: schema.taxCodes.name,
        taxType: schema.taxCodes.taxType,
        direction: schema.taxCodes.inputOutputDirection,
        description: schema.taxCodes.description,
      })
      .from(schema.taxCodes)
      .where(
        sql`(
          ${schema.taxCodes.code} LIKE ${searchTerm} OR
          ${schema.taxCodes.name} LIKE ${searchTerm} OR
          ${schema.taxCodes.taxType} LIKE ${searchTerm} OR
          ${schema.taxCodes.description} LIKE ${searchTerm}
        )`
      )
      .limit(8);

    // 7. Customers & Vendors
    const customerList = await db
      .select({
        id: schema.customers.id,
        code: schema.customers.code,
        name: schema.customers.legalName,
        tradeName: schema.customers.tradeName,
        tin: schema.customers.tin,
      })
      .from(schema.customers)
      .where(
        sql`(
          ${schema.customers.code} LIKE ${searchTerm} OR
          ${schema.customers.legalName} LIKE ${searchTerm} OR
          ${schema.customers.tradeName} LIKE ${searchTerm} OR
          ${schema.customers.tin} LIKE ${searchTerm}
        )`
      )
      .limit(5);

    const vendorList = await db
      .select({
        id: schema.vendors.id,
        code: schema.vendors.code,
        name: schema.vendors.legalName,
        tradeName: schema.vendors.tradeName,
        tin: schema.vendors.tin,
      })
      .from(schema.vendors)
      .where(
        sql`(
          ${schema.vendors.code} LIKE ${searchTerm} OR
          ${schema.vendors.legalName} LIKE ${searchTerm} OR
          ${schema.vendors.tradeName} LIKE ${searchTerm} OR
          ${schema.vendors.tin} LIKE ${searchTerm}
        )`
      )
      .limit(5);

    // Format results nicely into categories
    const formattedTransactions = [
      ...journals.map(j => ({
        id: j.id,
        type: 'Journal Entry',
        title: j.number,
        subtitle: `${j.description || 'General Voucher'} • Date: ${j.date}`,
        status: j.status,
        url: `/accounting/journals?search=${encodeURIComponent(j.number)}`
      })),
      ...invoices.map(i => ({
        id: i.id,
        type: 'Sales Invoice',
        title: i.number,
        subtitle: `Customer: ${i.customerName || 'N/A'} • ₱${((i.amount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} • Date: ${i.date}`,
        status: i.status,
        url: `/accounting/journals?search=${encodeURIComponent(i.number)}`
      })),
      ...bills.map(b => ({
        id: b.id,
        type: 'Purchase Bill',
        title: b.number,
        subtitle: `Vendor: ${b.vendorName || 'N/A'} • ₱${((b.amount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} • Date: ${b.date}`,
        status: b.status,
        url: `/accounting/bills?search=${encodeURIComponent(b.number)}`
      })),
      ...cashTxs.map(c => ({
        id: c.id,
        type: `Cash ${c.type}`,
        title: c.number,
        subtitle: `${c.description || 'Cash Voucher'} • ₱${((c.amount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} • Date: ${c.date}`,
        status: c.status,
        url: `/accounting/cash-advances?search=${encodeURIComponent(c.number)}`
      }))
    ];

    const formattedDocs = docs.map(d => ({
      id: d.id,
      type: 'Document',
      title: d.fileName,
      subtitle: `Entity: ${d.entityType} • Mime: ${d.fileType}`,
      url: `/documents?search=${encodeURIComponent(d.fileName)}`
    }));

    const formattedTaxRecords = taxCodesList.map(t => ({
      id: t.id,
      type: 'Tax Schedule Code',
      title: `${t.code} - ${t.name}`,
      subtitle: `Tax Type: ${t.taxType} (${t.direction || 'BOTH'}) • ${t.description || 'Approved BIR Schedule'}`,
      url: `/tax?search=${encodeURIComponent(t.code)}`
    }));

    const formattedContacts = [
      ...customerList.map(c => ({
        id: c.id,
        type: 'Customer',
        title: c.name,
        subtitle: `Code: ${c.code} • TIN: ${c.tin || 'N/A'}`,
        url: `/accounting/accounts?search=${encodeURIComponent(c.code)}`
      })),
      ...vendorList.map(v => ({
        id: v.id,
        type: 'Vendor / Supplier',
        title: v.name,
        subtitle: `Code: ${v.code} • TIN: ${v.tin || 'N/A'}`,
        url: `/accounting/bills?search=${encodeURIComponent(v.code)}`
      }))
    ];

    res.json({
      query: q,
      results: {
        transactions: formattedTransactions,
        documents: formattedDocs,
        taxRecords: formattedTaxRecords,
        contacts: formattedContacts
      }
    });
  } catch (err: any) {
    console.error("Search query failed:", err);
    res.status(500).json({ error: "SEARCH_FAILED", message: err.message || "Error executing global search" });
  }
});

export default router;
