import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth } from "../auth";
import { and, eq, inArray, sql } from "drizzle-orm";
import { RbacService } from "../services/rbacService";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const membershipId = req.activeCompany!.membershipId;
  const userId = req.user!.id;
  const q = ((req.query.q as string) || "").trim();

  if (!q) {
    res.json({
      query: "",
      results: {
        transactions: [],
        documents: [],
        taxRecords: [],
        contacts: [],
      },
    });
    return;
  }

  const searchTerm = `%${q}%`;

  try {
    const callerAccess = await RbacService.resolveEffectiveAccess(membershipId);

    const hasMod = (modId: string) => callerAccess.effectiveModuleIds.includes(modId);
    const hasSubmod = (modId: string, subId: string) => {
      if (!hasMod(modId)) return false;
      const subs = callerAccess.effectiveSubmodulesMap[modId];
      if (!subs || subs.length === 0) return true;
      return subs.includes(subId);
    };

    const canViewJournals =
      hasSubmod("accounting", "acct-journals") &&
      RbacService.hasPermission(callerAccess, "accounting:view");
    const canViewSalesInvoices =
      hasSubmod("sales", "sales-invoices") &&
      RbacService.hasPermission(callerAccess, "sales:view");
    const canViewPurchaseBills =
      hasSubmod("procurement", "proc-bills") &&
      RbacService.hasPermission(callerAccess, "purchases:view");
    const canViewCashTxs =
      hasSubmod("cash-banking", "cash-mgmt") &&
      RbacService.hasPermission(callerAccess, "cash:view");
    const canViewDocuments =
      hasMod("documents") &&
      RbacService.hasPermission(callerAccess, "documents:view");
    const canViewTaxRecords =
      (hasMod("tax") && RbacService.hasPermission(callerAccess, "tax:view")) ||
      (hasSubmod("master-data", "md-tax-codes") &&
        RbacService.hasPermission(callerAccess, "masterdata:view", "tax:view"));
    const canViewCustomers =
      (hasMod("sales") && RbacService.hasPermission(callerAccess, "sales:view")) ||
      (hasSubmod("master-data", "md-customers") &&
        RbacService.hasPermission(callerAccess, "customers:view", "masterdata:view"));
    const canViewVendors =
      (hasMod("procurement") && RbacService.hasPermission(callerAccess, "purchases:view")) ||
      (hasSubmod("master-data", "md-vendors") &&
        RbacService.hasPermission(callerAccess, "vendors:view", "masterdata:view"));

    // 1. Journal Entries
    let journals: Array<{
      id: string;
      number: string;
      date: string;
      description: string | null;
      status: string;
    }> = [];
    if (canViewJournals) {
      const scope = await RbacService.resolveModuleDataScope(membershipId, userId, "accounting");
      const jConds: any[] = [
        eq(schema.journalEntries.companyId, companyId),
        sql`(
          ${schema.journalEntries.journalNumber} LIKE ${searchTerm} OR
          ${schema.journalEntries.description} LIKE ${searchTerm} OR
          ${schema.journalEntries.status} LIKE ${searchTerm}
        )`,
      ];
      if (!scope.isCompanyWide) {
        if (scope.dataScope === "OWN_RECORDS" || scope.dataScope === "ASSIGNED_RECORDS") {
          jConds.push(eq(schema.journalEntries.createdBy, userId));
        } else if (scope.dataScope === "DEPARTMENT") {
          if (scope.departmentMatches.length > 0) {
            jConds.push(
              sql`EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id = ${schema.journalEntries.id} AND UPPER(jl.department_id) IN (${sql.join(scope.departmentMatches.map((m) => sql`${m}`), sql`, `)}))`
            );
          } else {
            jConds.push(sql`1 = 0`);
          }
        }
      }
      journals = await db
        .select({
          id: schema.journalEntries.id,
          number: schema.journalEntries.journalNumber,
          date: schema.journalEntries.entryDate,
          description: schema.journalEntries.description,
          status: schema.journalEntries.status,
        })
        .from(schema.journalEntries)
        .where(and(...jConds))
        .limit(8);
    }

    // 2. Sales Invoices
    let invoices: Array<{
      id: string;
      number: string;
      date: string;
      amount: number;
      status: string;
      customerName: string | null;
    }> = [];
    if (canViewSalesInvoices) {
      const scope = await RbacService.resolveModuleDataScope(membershipId, userId, "sales");
      const sConds: any[] = [
        eq(schema.salesInvoices.companyId, companyId),
        sql`(
          ${schema.salesInvoices.invoiceNumber} LIKE ${searchTerm} OR
          ${schema.customers.legalName} LIKE ${searchTerm} OR
          ${schema.salesInvoices.status} LIKE ${searchTerm}
        )`,
      ];
      if (!scope.isCompanyWide) {
        if (scope.dataScope === "OWN_RECORDS" || scope.dataScope === "ASSIGNED_RECORDS") {
          sConds.push(eq(schema.salesInvoices.createdBy, userId));
        }
      }
      invoices = await db
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
        .where(and(...sConds))
        .limit(8);
    }

    // 3. Purchase Bills
    let bills: Array<{
      id: string;
      number: string;
      date: string;
      amount: number;
      status: string;
      vendorName: string | null;
    }> = [];
    if (canViewPurchaseBills) {
      const scope = await RbacService.resolveModuleDataScope(membershipId, userId, "procurement");
      const pConds: any[] = [
        eq(schema.purchaseBills.companyId, companyId),
        sql`(
          ${schema.purchaseBills.billNumber} LIKE ${searchTerm} OR
          ${schema.vendors.legalName} LIKE ${searchTerm} OR
          ${schema.purchaseBills.status} LIKE ${searchTerm}
        )`,
      ];
      if (!scope.isCompanyWide) {
        if (scope.dataScope === "OWN_RECORDS" || scope.dataScope === "ASSIGNED_RECORDS") {
          pConds.push(eq(schema.purchaseBills.createdBy, userId));
        }
      }
      bills = await db
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
        .where(and(...pConds))
        .limit(8);
    }

    // 4. Cash Transactions
    let cashTxs: Array<{
      id: string;
      number: string;
      type: string;
      date: string;
      amount: number;
      description: string | null;
      status: string;
    }> = [];
    if (canViewCashTxs) {
      const scope = await RbacService.resolveModuleDataScope(membershipId, userId, "cash-banking");
      const cConds: any[] = [
        eq(schema.cashTransactions.companyId, companyId),
        sql`(
          ${schema.cashTransactions.transactionNumber} LIKE ${searchTerm} OR
          ${schema.cashTransactions.description} LIKE ${searchTerm} OR
          ${schema.cashTransactions.type} LIKE ${searchTerm} OR
          ${schema.cashTransactions.reference} LIKE ${searchTerm}
        )`,
      ];
      if (!scope.isCompanyWide) {
        if (scope.dataScope === "OWN_RECORDS" || scope.dataScope === "ASSIGNED_RECORDS") {
          cConds.push(eq(schema.cashTransactions.createdBy, userId));
        }
      }
      cashTxs = await db
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
        .where(and(...cConds))
        .limit(8);
    }

    // 5. Documents
    let docs: Array<{
      id: string;
      fileName: string;
      fileType: string;
      entityType: string;
      createdAt: Date | null;
    }> = [];
    if (canViewDocuments) {
      docs = await db
        .select({
          id: schema.documents.id,
          fileName: schema.documents.fileName,
          fileType: schema.documents.fileType,
          entityType: schema.documents.entityType,
          createdAt: schema.documents.createdAt,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.companyId, companyId),
            sql`(
              ${schema.documents.fileName} LIKE ${searchTerm} OR
              ${schema.documents.entityType} LIKE ${searchTerm}
            )`
          )
        )
        .limit(8);
    }

    // 6. Tax Codes
    let taxCodesList: Array<{
      id: string;
      code: string;
      name: string;
      taxType: string;
      direction: string | null;
      description: string | null;
    }> = [];
    if (canViewTaxRecords) {
      taxCodesList = await db
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
          and(
            eq(schema.taxCodes.companyId, companyId),
            sql`(
              ${schema.taxCodes.code} LIKE ${searchTerm} OR
              ${schema.taxCodes.name} LIKE ${searchTerm} OR
              ${schema.taxCodes.taxType} LIKE ${searchTerm} OR
              ${schema.taxCodes.description} LIKE ${searchTerm}
            )`
          )
        )
        .limit(8);
    }

    // 7. Customers & Vendors
    let customerList: Array<{
      id: string;
      code: string;
      name: string;
      tradeName: string | null;
      tin: string | null;
    }> = [];
    if (canViewCustomers) {
      customerList = await db
        .select({
          id: schema.customers.id,
          code: schema.customers.code,
          name: schema.customers.legalName,
          tradeName: schema.customers.tradeName,
          tin: schema.customers.tin,
        })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.companyId, companyId),
            sql`(
              ${schema.customers.code} LIKE ${searchTerm} OR
              ${schema.customers.legalName} LIKE ${searchTerm} OR
              ${schema.customers.tradeName} LIKE ${searchTerm} OR
              ${schema.customers.tin} LIKE ${searchTerm}
            )`
          )
        )
        .limit(5);
    }

    let vendorList: Array<{
      id: string;
      code: string;
      name: string;
      tradeName: string | null;
      tin: string | null;
    }> = [];
    if (canViewVendors) {
      vendorList = await db
        .select({
          id: schema.vendors.id,
          code: schema.vendors.code,
          name: schema.vendors.legalName,
          tradeName: schema.vendors.tradeName,
          tin: schema.vendors.tin,
        })
        .from(schema.vendors)
        .where(
          and(
            eq(schema.vendors.companyId, companyId),
            sql`(
              ${schema.vendors.code} LIKE ${searchTerm} OR
              ${schema.vendors.legalName} LIKE ${searchTerm} OR
              ${schema.vendors.tradeName} LIKE ${searchTerm} OR
              ${schema.vendors.tin} LIKE ${searchTerm}
            )`
          )
        )
        .limit(5);
    }

    // Format results nicely into categories with canonical authorized URLs
    const formattedTransactions = [
      ...journals.map((j) => ({
        id: j.id,
        type: "Journal Entry",
        title: j.number,
        subtitle: `${j.description || "General Voucher"} • Date: ${j.date}`,
        status: j.status,
        url: `/accounting/journals?search=${encodeURIComponent(j.number)}`,
      })),
      ...invoices.map((i) => ({
        id: i.id,
        type: "Sales Invoice",
        title: i.number,
        subtitle: `Customer: ${i.customerName || "N/A"} • ₱${((i.amount || 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })} • Date: ${i.date}`,
        status: i.status,
        url: `/operations/sales/invoices?search=${encodeURIComponent(i.number)}`,
      })),
      ...bills.map((b) => ({
        id: b.id,
        type: "Purchase Bill",
        title: b.number,
        subtitle: `Vendor: ${b.vendorName || "N/A"} • ₱${((b.amount || 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })} • Date: ${b.date}`,
        status: b.status,
        url: `/operations/procurement/bills?search=${encodeURIComponent(b.number)}`,
      })),
      ...cashTxs.map((c) => ({
        id: c.id,
        type: `Cash ${c.type}`,
        title: c.number,
        subtitle: `${c.description || "Cash Voucher"} • ₱${((c.amount || 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })} • Date: ${c.date}`,
        status: c.status,
        url: `/operations/cash-banking/vouchers?search=${encodeURIComponent(c.number)}`,
      })),
    ];

    const formattedDocs = docs.map((d) => ({
      id: d.id,
      type: "Document",
      title: d.fileName,
      subtitle: `Entity: ${d.entityType} • Mime: ${d.fileType}`,
      url: `/documents?search=${encodeURIComponent(d.fileName)}`,
    }));

    const formattedTaxRecords = taxCodesList.map((t) => ({
      id: t.id,
      type: "Tax Schedule Code",
      title: `${t.code} - ${t.name}`,
      subtitle: `Tax Type: ${t.taxType} (${t.direction || "BOTH"}) • ${t.description || "Approved BIR Schedule"}`,
      url: `/tax?search=${encodeURIComponent(t.code)}`,
    }));

    const formattedContacts = [
      ...customerList.map((c) => ({
        id: c.id,
        type: "Customer",
        title: c.name,
        subtitle: `Code: ${c.code} • TIN: ${c.tin || "N/A"}`,
        url: `/master-data/customers?search=${encodeURIComponent(c.code)}`,
      })),
      ...vendorList.map((v) => ({
        id: v.id,
        type: "Vendor / Supplier",
        title: v.name,
        subtitle: `Code: ${v.code} • TIN: ${v.tin || "N/A"}`,
        url: `/master-data/vendors?search=${encodeURIComponent(v.code)}`,
      })),
    ];

    res.json({
      query: q,
      results: {
        transactions: formattedTransactions,
        documents: formattedDocs,
        taxRecords: formattedTaxRecords,
        contacts: formattedContacts,
      },
    });
  } catch (err: any) {
    console.error("Search query failed:", err);
    res
      .status(500)
      .json({ error: "SEARCH_FAILED", message: err.message || "Error executing global search" });
  }
});

export default router;
