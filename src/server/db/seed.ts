import { db } from "./index";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function seed() {
  console.log("Starting database seed for Acme and Manila profiles...");

  if (process.env.NODE_ENV === 'production') {
    console.log("Seed skipped in production.");
    return;
  }

  // Helper to ensure role exists
  const getOrCreateRole = async (code: string, name: string) => {
    const existing = await db.select().from(schema.roles).where(eq(schema.roles.code, code)).get();
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    await db.insert(schema.roles).values({ id, code, name, description: `${name} Role`, isSystem: true });
    return id;
  };

  const adminRoleId = await getOrCreateRole("COMPANY_OWNER", "Company Owner");
  const acctRoleId = await getOrCreateRole("ACCOUNTANT", "Accountant");
  const viewerRoleId = await getOrCreateRole("VIEWER", "Viewer");

  // Create or get Acme
  let acme = await db.select().from(schema.companies).where(eq(schema.companies.legalName, "Acme Philippine Services Corp.")).get();
  if (!acme) {
    const companyId = crypto.randomUUID();
    await db.insert(schema.companies).values({
      id: companyId,
      legalName: "Acme Philippine Services Corp.",
      tradeName: "Acme Trading (PH)",
      tin: "123-456-789-000",
      taxpayerType: "REGULAR",
      vatStatus: "VAT",
      status: "ACTIVE",
      isDemo: true
    });
    acme = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  }

  // Create or get Manila
  let manila = await db.select().from(schema.companies).where(eq(schema.companies.legalName, "Manila Business Solutions Inc.")).get();
  if (!manila) {
    const companyId = crypto.randomUUID();
    await db.insert(schema.companies).values({
      id: companyId,
      legalName: "Manila Business Solutions Inc.",
      tradeName: "Manila Solutions",
      tin: "987-654-321-000",
      taxpayerType: "REGULAR",
      vatStatus: "VAT",
      status: "ACTIVE",
      isDemo: true
    });
    manila = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  }

  console.log("Seeding complete for Acme & Manila profiles.");
}

seed().catch(console.error);
