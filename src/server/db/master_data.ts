import { db } from "./index";
import * as schema from "./schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

export class MasterDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterDataError";
  }
}

// ================= CUSTOMER =================
export async function createCustomer(companyId: string, data: any, userId: string) {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.customers).values({
      id,
      companyId,
      code: data.code,
      legalName: data.legalName,
      tradeName: data.tradeName,
      tin: data.tin,
      address: data.address,
      billingAddress: data.billingAddress,
      shippingAddress: data.shippingAddress,
      contactPerson: data.contactPerson,
      contactDetails: data.contactDetails,
      paymentTerms: data.paymentTerms,
      creditLimit: data.creditLimit,
      taxClassification: data.taxClassification,
      vatStatus: data.vatStatus,
      withholdingApplicability: data.withholdingApplicability,
      defaultReceivableAccountId: data.defaultReceivableAccountId,
      defaultRevenueAccountId: data.defaultRevenueAccountId,
      notes: data.notes,
    });
    
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_CUSTOMER",
      entityType: "customers",
      entityId: id,
    });
  });
  return id;
}

export async function updateCustomer(companyId: string, id: string, data: any, userId: string) {
  const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId))).get();
  if (!customer) throw new MasterDataError("Customer not found");

  await db.transaction(async (tx) => {
    await tx.update(schema.customers).set({
      ...data,
      updatedAt: new Date()
    }).where(eq(schema.customers.id, id));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "UPDATE_CUSTOMER",
      entityType: "customers",
      entityId: id,
    });
  });
}

export async function deactivateCustomer(companyId: string, id: string, userId: string) {
  const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.companyId, companyId))).get();
  if (!customer) throw new MasterDataError("Customer not found");

  await db.transaction(async (tx) => {
    await tx.update(schema.customers).set({ status: "INACTIVE", updatedAt: new Date() }).where(eq(schema.customers.id, id));
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "DEACTIVATE_CUSTOMER",
      entityType: "customers",
      entityId: id,
    });
  });
}

// ================= VENDOR =================
export async function createVendor(companyId: string, data: any, userId: string) {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.vendors).values({
      id,
      companyId,
      code: data.code,
      legalName: data.legalName,
      tradeName: data.tradeName,
      tin: data.tin,
      address: data.address,
      contactPerson: data.contactPerson,
      contactDetails: data.contactDetails,
      paymentTerms: data.paymentTerms,
      taxClassification: data.taxClassification,
      vatStatus: data.vatStatus,
      withholdingApplicability: data.withholdingApplicability,
      defaultPayableAccountId: data.defaultPayableAccountId,
      defaultExpenseAccountId: data.defaultExpenseAccountId,
      notes: data.notes,
    });
    
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_VENDOR",
      entityType: "vendors",
      entityId: id,
    });
  });
  return id;
}

export async function updateVendor(companyId: string, id: string, data: any, userId: string) {
  const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId))).get();
  if (!vendor) throw new MasterDataError("Vendor not found");

  await db.transaction(async (tx) => {
    await tx.update(schema.vendors).set({
      ...data,
      updatedAt: new Date()
    }).where(eq(schema.vendors.id, id));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "UPDATE_VENDOR",
      entityType: "vendors",
      entityId: id,
    });
  });
}

export async function deactivateVendor(companyId: string, id: string, userId: string) {
  const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.companyId, companyId))).get();
  if (!vendor) throw new MasterDataError("Vendor not found");

  await db.transaction(async (tx) => {
    await tx.update(schema.vendors).set({ status: "INACTIVE", updatedAt: new Date() }).where(eq(schema.vendors.id, id));
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "DEACTIVATE_VENDOR",
      entityType: "vendors",
      entityId: id,
    });
  });
}

// ================= TAX CODES =================
export async function createTaxCode(companyId: string, data: any, userId: string) {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.taxCodes).values({
      id,
      companyId,
      code: data.code,
      name: data.name,
      taxType: data.taxType,
      description: data.description,
      applicability: data.applicability,
      inputOutputDirection: data.inputOutputDirection,
      accountId: data.accountId,
      ruleDefinitionId: data.ruleDefinitionId,
    });
    
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: "CREATE_TAX_CODE",
      entityType: "tax_codes",
      entityId: id,
    });
  });
  return id;
}
