import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, sql, desc } from "drizzle-orm";

const router = Router();

// GET all audit engagements for active company
router.get("/", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const userRole = req.activeCompany?.role;

  try {
    const engagements = await db.select({
      id: schema.auditEngagements.id,
      companyId: schema.auditEngagements.companyId,
      clientCompanyId: schema.auditEngagements.clientCompanyId,
      clientCompanyName: schema.companies.legalName,
      engagementName: schema.auditEngagements.engagementName,
      auditPeriod: schema.auditEngagements.auditPeriod,
      engagementType: schema.auditEngagements.engagementType,
      status: schema.auditEngagements.status,
      materiality: schema.auditEngagements.materiality,
      performanceMateriality: schema.auditEngagements.performanceMateriality,
      trivialThreshold: schema.auditEngagements.trivialThreshold,
      teamMembers: schema.auditEngagements.teamMembers,
      preparerId: schema.auditEngagements.preparerId,
      reviewerId: schema.auditEngagements.reviewerId,
      partnerId: schema.auditEngagements.partnerId,
      fieldworkDeadline: schema.auditEngagements.fieldworkDeadline,
      signOffDeadline: schema.auditEngagements.signOffDeadline,
      reportDeadline: schema.auditEngagements.reportDeadline,
      notes: schema.auditEngagements.notes,
      createdAt: schema.auditEngagements.createdAt,
      updatedAt: schema.auditEngagements.updatedAt
    })
    .from(schema.auditEngagements)
    .innerJoin(schema.companies, eq(schema.auditEngagements.clientCompanyId, schema.companies.id))
    .where(eq(schema.auditEngagements.companyId, companyId))
    .orderBy(desc(schema.auditEngagements.createdAt));

    // If user is Read-only or Auditor, filter to only assigned engagements or team
    let filtered = engagements;
    if (userRole === 'Read-only User' || userRole === 'Auditor') {
      filtered = engagements.filter(e => {
        if (e.preparerId === userId || e.reviewerId === userId || e.partnerId === userId) return true;
        try {
          const members = JSON.parse(e.teamMembers || '[]');
          if (Array.isArray(members) && members.includes(userId)) return true;
        } catch {
          // ignore
        }
        return false;
      });
    }

    res.json(filtered);
  } catch (err: any) {
    console.error("Error fetching audit engagements:", err);
    res.status(500).json({ error: "Failed to fetch audit engagements" });
  }
});

// CREATE audit engagement
router.post("/", requireAuth, requirePermission('audit:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const {
    clientCompanyId,
    engagementName,
    auditPeriod,
    engagementType,
    materiality,
    performanceMateriality,
    trivialThreshold,
    teamMembers,
    preparerId,
    reviewerId,
    partnerId,
    fieldworkDeadline,
    signOffDeadline,
    reportDeadline,
    notes
  } = req.body;

  if (!clientCompanyId || !engagementName || !auditPeriod || !engagementType) {
    res.status(400).json({ error: "Missing required engagement fields" });
    return;
  }

  try {
    const id = crypto.randomUUID();
    await db.insert(schema.auditEngagements).values({
      id,
      companyId,
      clientCompanyId,
      engagementName,
      auditPeriod,
      engagementType,
      status: 'PLANNING',
      materiality: materiality ? parseInt(materiality, 10) : 0,
      performanceMateriality: performanceMateriality ? parseInt(performanceMateriality, 10) : 0,
      trivialThreshold: trivialThreshold ? parseInt(trivialThreshold, 10) : 0,
      teamMembers: typeof teamMembers === 'string' ? teamMembers : JSON.stringify(teamMembers || []),
      preparerId: preparerId || userId,
      reviewerId: reviewerId || null,
      partnerId: partnerId || null,
      fieldworkDeadline: fieldworkDeadline || null,
      signOffDeadline: signOffDeadline || null,
      reportDeadline: reportDeadline || null,
      notes: notes || null
    });

    // Seed default PBC items / open items checklist
    const defaultItems = [
      { cat: 'PBC', title: 'Trial Balance & General Ledger Export (Final)' },
      { cat: 'PBC', title: 'Bank Reconciliation Statements & Confirmation Letters' },
      { cat: 'PBC', title: 'Accounts Receivable Aging & Confirmations' },
      { cat: 'PBC', title: 'Inventory Count Sheets & Valuation Schedules' },
      { cat: 'PBC', title: 'Accounts Payable Aging & Supplier Statements' },
      { cat: 'PBC', title: 'BIR Tax Returns (VAT Form 2550M/Q, EWT, ITR) & Form 2307s' },
      { cat: 'WORKING_PAPER', title: 'Materiality & Risk Assessment Memorandum' },
      { cat: 'CONTROL_DEFICIENCY', title: 'IT General Controls & Segregation of Duties Review' }
    ];

    for (const item of defaultItems) {
      await db.insert(schema.auditEngagementItems).values({
        id: crypto.randomUUID(),
        engagementId: id,
        itemCategory: item.cat,
        title: item.title,
        status: 'OPEN',
        assignedTo: preparerId || userId
      });
    }

    // Log to engagement audit trail
    await db.insert(schema.auditEngagementLogs).values({
      id: crypto.randomUUID(),
      engagementId: id,
      userId,
      action: 'CREATE_ENGAGEMENT',
      details: `Created audit engagement '${engagementName}' for audit period ${auditPeriod}.`
    });

    res.json({ success: true, id, message: "Audit engagement created successfully with default PBC checklist." });
  } catch (err: any) {
    console.error("Error creating audit engagement:", err);
    res.status(500).json({ error: err.message || "Failed to create audit engagement" });
  }
});

// GET single audit engagement details
router.get("/:id", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const engagementId = req.params.id;

  try {
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

    // Get items
    const items = await db.select()
      .from(schema.auditEngagementItems)
      .where(eq(schema.auditEngagementItems.engagementId, engagementId));

    // Get logs
    const logs = await db.select()
      .from(schema.auditEngagementLogs)
      .where(eq(schema.auditEngagementLogs.engagementId, engagementId))
      .orderBy(desc(schema.auditEngagementLogs.createdAt));

    res.json({ ...engagement, items, logs });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch audit engagement details" });
  }
});

// UPDATE audit engagement
router.put("/:id", requireAuth, requirePermission('audit:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const engagementId = req.params.id;
  const userId = req.user!.id;
  const {
    engagementName,
    auditPeriod,
    engagementType,
    status,
    materiality,
    performanceMateriality,
    trivialThreshold,
    teamMembers,
    preparerId,
    reviewerId,
    partnerId,
    fieldworkDeadline,
    signOffDeadline,
    reportDeadline,
    notes
  } = req.body;

  try {
    await db.update(schema.auditEngagements)
      .set({
        engagementName,
        auditPeriod,
        engagementType,
        status,
        materiality: materiality !== undefined ? parseInt(materiality, 10) : undefined,
        performanceMateriality: performanceMateriality !== undefined ? parseInt(performanceMateriality, 10) : undefined,
        trivialThreshold: trivialThreshold !== undefined ? parseInt(trivialThreshold, 10) : undefined,
        teamMembers: typeof teamMembers === 'string' ? teamMembers : JSON.stringify(teamMembers || []),
        preparerId,
        reviewerId,
        partnerId,
        fieldworkDeadline,
        signOffDeadline,
        reportDeadline,
        notes,
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.auditEngagements.id, engagementId),
        eq(schema.auditEngagements.companyId, companyId)
      ));

    // Log change
    await db.insert(schema.auditEngagementLogs).values({
      id: crypto.randomUUID(),
      engagementId,
      userId,
      action: 'UPDATE_ENGAGEMENT',
      details: `Updated engagement details and status to ${status}.`
    });

    res.json({ success: true, message: "Audit engagement updated successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update audit engagement" });
  }
});

// ARCHIVE engagement (Archived engagements remain readable)
router.post("/:id/archive", requireAuth, requirePermission('audit:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const engagementId = req.params.id;
  const userId = req.user!.id;

  try {
    await db.update(schema.auditEngagements)
      .set({
        status: 'ARCHIVED',
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.auditEngagements.id, engagementId),
        eq(schema.auditEngagements.companyId, companyId)
      ));

    await db.insert(schema.auditEngagementLogs).values({
      id: crypto.randomUUID(),
      engagementId,
      userId,
      action: 'ARCHIVE_ENGAGEMENT',
      details: `Archived audit engagement.`
    });

    res.json({ success: true, message: "Engagement archived successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to archive engagement" });
  }
});

// ADD open item / PBC request
router.post("/:id/items", requireAuth, requirePermission('audit:edit'), async (req, res) => {
  const engagementId = req.params.id;
  const userId = req.user!.id;
  const { itemCategory, title, description, assignedTo, dueDate } = req.body;

  try {
    const id = crypto.randomUUID();
    await db.insert(schema.auditEngagementItems).values({
      id,
      engagementId,
      itemCategory: itemCategory || 'PBC',
      title,
      description: description || null,
      status: 'OPEN',
      assignedTo: assignedTo || null,
      dueDate: dueDate || null
    });

    await db.insert(schema.auditEngagementLogs).values({
      id: crypto.randomUUID(),
      engagementId,
      userId,
      action: 'ADD_OPEN_ITEM',
      details: `Added open item: ${title} (${itemCategory})`
    });

    res.json({ success: true, id, message: "Item added successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add item" });
  }
});

// UPDATE open item status
router.post("/items/:itemId/status", requireAuth, requirePermission('audit:edit'), async (req, res) => {
  const itemId = req.params.itemId;
  const userId = req.user!.id;
  const { status } = req.body;

  try {
    await db.update(schema.auditEngagementItems)
      .set({ status })
      .where(eq(schema.auditEngagementItems.id, itemId));

    res.json({ success: true, message: "Item status updated." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update item status" });
  }
});

export default router;
