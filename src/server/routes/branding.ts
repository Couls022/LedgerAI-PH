import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

// GET /api/branding
router.get("/", requireAuth, async (req, res) => {
  const companyId = req.activeCompany!.id;

  try {
    const existing = await db
      .select()
      .from(schema.companyBranding)
      .where(eq(schema.companyBranding.companyId, companyId));

    if (existing.length > 0) {
      return res.json(existing[0]);
    }

    // Return company defaults if no explicit branding created yet
    const company = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .get();
    res.json({
      id: null,
      companyId,
      logoUrl: "",
      brandColor: "#1e1b4b",
      secondaryColor: "#4f46e5",
      headerTitle: "OFFICIAL BILLING STATEMENT & TAX INVOICE",
      footerNote: "Generated from company accounting records.",
      companyAddress: company?.address || "",
      contactPhone: (company as any)?.contactPhone || "",
      contactEmail: "",
      website: "",
      tinNumber: company?.tin || "",
      showLogo: true,
      showWatermark: true,
      customTerms:
        "1. Payment is strictly due per agreed invoice terms.\n2. Make all checks payable to the company's full legal registered name.",
    });
  } catch (err: any) {
    console.error("Fetch branding error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// POST /api/branding
router.post("/", requireAuth, requirePermission("company:write", "settings:manage"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const {
    logoUrl,
    brandColor,
    secondaryColor,
    headerTitle,
    footerNote,
    companyAddress,
    contactPhone,
    contactEmail,
    website,
    tinNumber,
    showLogo,
    showWatermark,
    customTerms,
  } = req.body;

  try {
    const existing = await db
      .select()
      .from(schema.companyBranding)
      .where(eq(schema.companyBranding.companyId, companyId));

    if (existing.length > 0) {
      await db
        .update(schema.companyBranding)
        .set({
          logoUrl,
          brandColor: brandColor || "#1e1b4b",
          secondaryColor: secondaryColor || "#4f46e5",
          headerTitle: headerTitle || "OFFICIAL BILLING STATEMENT & TAX INVOICE",
          footerNote: footerNote || "Thank you for your business!",
          companyAddress,
          contactPhone,
          contactEmail,
          website,
          tinNumber,
          showLogo: showLogo !== undefined ? showLogo : true,
          showWatermark: showWatermark !== undefined ? showWatermark : true,
          customTerms,
          updatedAt: new Date(),
        })
        .where(eq(schema.companyBranding.companyId, companyId));
    } else {
      await db.insert(schema.companyBranding).values({
        id: `brand-${crypto.randomUUID().slice(0, 8)}`,
        companyId,
        logoUrl,
        brandColor: brandColor || "#1e1b4b",
        secondaryColor: secondaryColor || "#4f46e5",
        headerTitle: headerTitle || "OFFICIAL BILLING STATEMENT & TAX INVOICE",
        footerNote: footerNote || "Thank you for your business!",
        companyAddress,
        contactPhone,
        contactEmail,
        website,
        tinNumber,
        showLogo: showLogo !== undefined ? showLogo : true,
        showWatermark: showWatermark !== undefined ? showWatermark : true,
        customTerms,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Audit log
    await db.insert(schema.auditLogs).values({
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      companyId,
      userId: req.user!.id,
      action: "UPDATE_BRANDING",
      entityType: "COMPANY_BRANDING",
      entityId: companyId,
      metadata: JSON.stringify({ brandColor, headerTitle }),
      timestamp: new Date(),
    });

    res.json({ success: true, message: "Company branding & print layout updated successfully" });
  } catch (err: any) {
    console.error("Save branding error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

export default router;
