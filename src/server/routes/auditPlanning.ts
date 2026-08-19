import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requireMinRole } from "../auth";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

// GET planning doc, significant accounts, risks & procedures, and version history for an engagement
router.get("/:engagementId", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const engagementId = req.params.engagementId;
  const companyId = req.activeCompany!.id;

  try {
    // Verify engagement belongs to active company
    const engagement = await db.select()
      .from(schema.auditEngagements)
      .where(and(
        eq(schema.auditEngagements.id, engagementId),
        eq(schema.auditEngagements.companyId, companyId)
      ))
      .get();

    if (!engagement) {
      res.status(404).json({ error: "Audit engagement not found" });
      return;
    }

    // Get or create planning doc
    let planningDoc = await db.select()
      .from(schema.auditPlanningDocs)
      .where(eq(schema.auditPlanningDocs.engagementId, engagementId))
      .get();

    if (!planningDoc) {
      const docId = crypto.randomUUID();
      await db.insert(schema.auditPlanningDocs).values({
        id: docId,
        engagementId,
        entityUnderstanding: 'Initial entity background and operating environment overview...',
        businessProcesses: 'Key revenue, expenditure, inventory, and financial reporting cycles...',
        auditStrategy: 'Risk-based audit approach focusing on substantive testing and control reliance where appropriate.',
        auditPlan: 'Detailed audit schedule and testing procedures.',
        samplingPlan: 'Monetary Unit Sampling (MUS) and attribute sampling methodology.',
        materialityNotes: 'Calculated based on 5% of profit before tax or 1% of total assets.',
        status: 'DRAFT'
      });
      planningDoc = await db.select()
        .from(schema.auditPlanningDocs)
        .where(eq(schema.auditPlanningDocs.engagementId, engagementId))
        .get();
    }

    // Get significant accounts
    const significantAccounts = await db.select()
      .from(schema.auditSignificantAccounts)
      .where(eq(schema.auditSignificantAccounts.engagementId, engagementId));

    // Get risks and procedures mapping
    const risksAndProcedures = await db.select()
      .from(schema.auditRisksAndProcedures)
      .where(eq(schema.auditRisksAndProcedures.engagementId, engagementId));

    // Get version history
    const versions = await db.select()
      .from(schema.auditPlanningVersions)
      .where(eq(schema.auditPlanningVersions.engagementId, engagementId))
      .orderBy(desc(schema.auditPlanningVersions.versionNumber));

    res.json({
      planningDoc,
      significantAccounts,
      risksAndProcedures,
      versions
    });
  } catch (err: any) {
    console.error("Error fetching audit planning data:", err);
    res.status(500).json({ error: "Failed to fetch audit planning data" });
  }
});

// UPDATE planning doc (Entity understanding, strategy, plan, etc.)
router.put("/:engagementId/doc", requireAuth, requireMinRole('Accountant'), async (req, res) => {
  const engagementId = req.params.engagementId;
  const userId = req.user!.id;
  const {
    entityUnderstanding,
    businessProcesses,
    auditStrategy,
    auditPlan,
    samplingPlan,
    materialityNotes,
    status
  } = req.body;

  try {
    await db.update(schema.auditPlanningDocs)
      .set({
        entityUnderstanding,
        businessProcesses,
        auditStrategy,
        auditPlan,
        samplingPlan,
        materialityNotes,
        status: status || 'DRAFT',
        updatedAt: new Date()
      })
      .where(eq(schema.auditPlanningDocs.engagementId, engagementId));

    // Log action
    await db.insert(schema.auditEngagementLogs).values({
      id: crypto.randomUUID(),
      engagementId,
      userId,
      action: 'UPDATE_AUDIT_PLANNING',
      details: `Updated audit planning documentation and strategy.`
    });

    res.json({ success: true, message: "Audit planning document updated successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update planning document" });
  }
});

// SIGN OFF planning doc (Preparer, Reviewer, Partner)
router.post("/:engagementId/sign-off", requireAuth, requireMinRole('Accountant'), async (req, res) => {
  const engagementId = req.params.engagementId;
  const userId = req.user!.id;
  const { roleType } = req.body; // 'preparer' | 'reviewer' | 'partner'

  try {
    const doc = await db.select()
      .from(schema.auditPlanningDocs)
      .where(eq(schema.auditPlanningDocs.engagementId, engagementId))
      .get();

    if (!doc) {
      res.status(404).json({ error: "Planning document not found" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    let actionName = 'SIGN_OFF';

    if (roleType === 'preparer') {
      updates.preparerId = userId;
      updates.preparerSignedAt = new Date();
      updates.status = 'PREPARED';
      actionName = 'PREPARER_SIGN_OFF';
    } else if (roleType === 'reviewer') {
      updates.reviewerId = userId;
      updates.reviewerSignedAt = new Date();
      updates.status = 'REVIEWED';
      actionName = 'REVIEWER_SIGN_OFF';
    } else if (roleType === 'partner') {
      updates.partnerId = userId;
      updates.partnerSignedAt = new Date();
      updates.status = 'APPROVED';
      actionName = 'PARTNER_APPROVAL';
    }

    await db.update(schema.auditPlanningDocs)
      .set(updates)
      .where(eq(schema.auditPlanningDocs.engagementId, engagementId));

    // Create version snapshot on sign-off
    const existingVersions = await db.select()
      .from(schema.auditPlanningVersions)
      .where(eq(schema.auditPlanningVersions.engagementId, engagementId));

    const nextVer = existingVersions.length + 1;
    const accounts = await db.select().from(schema.auditSignificantAccounts).where(eq(schema.auditSignificantAccounts.engagementId, engagementId));
    const risks = await db.select().from(schema.auditRisksAndProcedures).where(eq(schema.auditRisksAndProcedures.engagementId, engagementId));

    await db.insert(schema.auditPlanningVersions).values({
      id: crypto.randomUUID(),
      engagementId,
      versionNumber: nextVer,
      snapshotJson: JSON.stringify({ doc, accounts, risks, signedByRole: roleType }),
      createdBy: userId
    });

    await db.insert(schema.auditEngagementLogs).values({
      id: crypto.randomUUID(),
      engagementId,
      userId,
      action: actionName,
      details: `Audit planning document signed off by ${roleType} (v${nextVer}).`
    });

    res.json({ success: true, message: `Successfully signed off as ${roleType}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to sign off" });
  }
});

// ADD OR UPDATE Significant Account (Validation: must link to assertions)
router.post("/:engagementId/accounts", requireAuth, requireMinRole('Accountant'), async (req, res) => {
  const engagementId = req.params.engagementId;
  const { accountName, accountBalance, isSignificant, assertions, inherentRisk, controlRisk, fraudRisk } = req.body;

  if (!accountName || !assertions || !Array.isArray(assertions) || assertions.length === 0) {
    res.status(400).json({ error: "Significant account requires name and at least one relevant assertion." });
    return;
  }

  try {
    const id = crypto.randomUUID();
    await db.insert(schema.auditSignificantAccounts).values({
      id,
      engagementId,
      accountName,
      accountBalance: accountBalance ? parseInt(accountBalance, 10) : 0,
      isSignificant: isSignificant !== false,
      assertions: JSON.stringify(assertions),
      inherentRisk: inherentRisk || 'MEDIUM',
      controlRisk: controlRisk || 'MEDIUM',
      fraudRisk: !!fraudRisk
    });

    res.json({ success: true, id, message: "Significant account added successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add significant account" });
  }
});

// DELETE Significant Account
router.delete("/accounts/:accountId", requireAuth, requireMinRole('Accountant'), async (req, res) => {
  const accountId = req.params.accountId;
  try {
    await db.delete(schema.auditSignificantAccounts).where(eq(schema.auditSignificantAccounts.id, accountId));
    res.json({ success: true, message: "Account deleted." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// ADD Risk & Procedure Mapping (Validation: material risk must link to audit procedure)
router.post("/:engagementId/risks-procedures", requireAuth, requireMinRole('Accountant'), async (req, res) => {
  const engagementId = req.params.engagementId;
  const { riskDescription, riskType, assertionLinked, auditProcedure, assignedTo } = req.body;

  if (!riskDescription || !auditProcedure || !assertionLinked) {
    res.status(400).json({ error: "Risk description, assertion, and audit procedure mapping are required." });
    return;
  }

  try {
    const id = crypto.randomUUID();
    await db.insert(schema.auditRisksAndProcedures).values({
      id,
      engagementId,
      riskDescription,
      riskType: riskType || 'INHERENT',
      assertionLinked,
      auditProcedure,
      assignedTo: assignedTo || null,
      status: 'OPEN'
    });

    res.json({ success: true, id, message: "Risk-to-procedure mapping added successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add risk mapping" });
  }
});

// DELETE Risk & Procedure
router.delete("/risks-procedures/:id", requireAuth, requireMinRole('Accountant'), async (req, res) => {
  const id = req.params.id;
  try {
    await db.delete(schema.auditRisksAndProcedures).where(eq(schema.auditRisksAndProcedures.id, id));
    res.json({ success: true, message: "Risk procedure deleted." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete risk procedure" });
  }
});

export default router;
