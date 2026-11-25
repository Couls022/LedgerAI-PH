import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, sql, desc } from "drizzle-orm";
import { AuditService } from "../services/auditService";

const router = Router();

function isRestrictedAuditUser(req: any): boolean {
  const roles: string[] = Array.isArray(req.activeCompany?.roles) && req.activeCompany.roles.length > 0
    ? req.activeCompany.roles
    : [req.activeCompany?.role || ''];
  return roles.every((r) => r === 'Read-only User' || r === 'Auditor');
}

function isAssignedToEngagement(
  userId: string,
  engagement: { preparerId?: string | null; reviewerId?: string | null; partnerId?: string | null; teamMembers?: string | null }
): boolean {
  if (
    engagement.preparerId === userId ||
    engagement.reviewerId === userId ||
    engagement.partnerId === userId
  ) {
    return true;
  }
  try {
    const members = JSON.parse(engagement.teamMembers || '[]');
    if (Array.isArray(members) && members.includes(userId)) {
      return true;
    }
  } catch {
    // ignore malformed JSON
  }
  return false;
}

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

    // If user is strictly Read-only or Auditor, filter to only assigned engagements or team
    let filtered = engagements;
    if (isRestrictedAuditUser(req)) {
      filtered = engagements.filter((e) => isAssignedToEngagement(userId, e));
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
  if (clientCompanyId !== companyId) {
    res.status(403).json({ error: "CROSS_COMPANY_ACCESS_DENIED", message: "Cannot create an audit engagement for a foreign client company." });
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

    await AuditService.log({
      req,
      companyId,
      userId,
      action: 'CREATE_AUDIT_ENGAGEMENT',
      entityType: 'audit_engagements',
      entityId: id,
      module: 'Audit',
      afterData: { engagementName, auditPeriod, engagementType, clientCompanyId }
    });

    res.status(201).json({ success: true, id, message: "Audit engagement created successfully with default PBC checklist." });
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

    if (isRestrictedAuditUser(req) && !isAssignedToEngagement(req.user!.id, engagement)) {
      res.status(403).json({
        error: "ENGAGEMENT_ACCESS_DENIED",
        message: "You are not assigned to this audit engagement.",
      });
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
    const existing = await db.select()
      .from(schema.auditEngagements)
      .where(and(eq(schema.auditEngagements.id, engagementId), eq(schema.auditEngagements.companyId, companyId)))
      .get();
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Audit engagement not found in active company" });
      return;
    }
    if (isRestrictedAuditUser(req) && !isAssignedToEngagement(userId, existing)) {
      res.status(403).json({
        error: "ENGAGEMENT_ACCESS_DENIED",
        message: "You are not assigned to this audit engagement.",
      });
      return;
    }

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
    await AuditService.log({
      req,
      companyId,
      userId,
      action: 'UPDATE_AUDIT_ENGAGEMENT',
      entityType: 'audit_engagements',
      entityId: engagementId,
      module: 'Audit',
      beforeData: { status: existing.status, engagementName: existing.engagementName },
      afterData: { status, engagementName }
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
    const existing = await db.select()
      .from(schema.auditEngagements)
      .where(and(eq(schema.auditEngagements.id, engagementId), eq(schema.auditEngagements.companyId, companyId)))
      .get();
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Audit engagement not found in active company" });
      return;
    }
    if (isRestrictedAuditUser(req) && !isAssignedToEngagement(userId, existing)) {
      res.status(403).json({
        error: "ENGAGEMENT_ACCESS_DENIED",
        message: "You are not assigned to this audit engagement.",
      });
      return;
    }

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
    await AuditService.log({
      req,
      companyId,
      userId,
      action: 'ARCHIVE_AUDIT_ENGAGEMENT',
      entityType: 'audit_engagements',
      entityId: engagementId,
      module: 'Audit',
    });

    res.json({ success: true, message: "Engagement archived successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to archive engagement" });
  }
});

// ADD open item / PBC request
router.post("/:id/items", requireAuth, requirePermission('audit:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const engagementId = req.params.id;
  const userId = req.user!.id;
  const { itemCategory, title, description, assignedTo, dueDate } = req.body;

  try {
    const existing = await db.select()
      .from(schema.auditEngagements)
      .where(and(eq(schema.auditEngagements.id, engagementId), eq(schema.auditEngagements.companyId, companyId)))
      .get();
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Audit engagement not found in active company" });
      return;
    }
    if (isRestrictedAuditUser(req) && !isAssignedToEngagement(userId, existing)) {
      res.status(403).json({
        error: "ENGAGEMENT_ACCESS_DENIED",
        message: "You are not assigned to this audit engagement.",
      });
      return;
    }

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
    await AuditService.log({
      req,
      companyId,
      userId,
      action: 'ADD_AUDIT_ENGAGEMENT_ITEM',
      entityType: 'audit_engagement_items',
      entityId: id,
      module: 'Audit',
      afterData: { engagementId, title, itemCategory }
    });

    res.json({ success: true, id, message: "Item added successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add item" });
  }
});

// UPDATE open item status
router.post("/items/:itemId/status", requireAuth, requirePermission('audit:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const itemId = req.params.itemId;
  const userId = req.user!.id;
  const { status } = req.body;

  try {
    const item = await db.select({
      id: schema.auditEngagementItems.id,
      engagementId: schema.auditEngagementItems.engagementId,
      status: schema.auditEngagementItems.status,
      engagementCompanyId: schema.auditEngagements.companyId,
      preparerId: schema.auditEngagements.preparerId,
      reviewerId: schema.auditEngagements.reviewerId,
      partnerId: schema.auditEngagements.partnerId,
      teamMembers: schema.auditEngagements.teamMembers,
    })
      .from(schema.auditEngagementItems)
      .innerJoin(schema.auditEngagements, eq(schema.auditEngagementItems.engagementId, schema.auditEngagements.id))
      .where(and(eq(schema.auditEngagementItems.id, itemId), eq(schema.auditEngagements.companyId, companyId)))
      .get();

    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Audit engagement item not found in active company" });
      return;
    }
    if (isRestrictedAuditUser(req) && !isAssignedToEngagement(userId, item)) {
      res.status(403).json({
        error: "ENGAGEMENT_ACCESS_DENIED",
        message: "You are not assigned to this audit engagement.",
      });
      return;
    }

    await db.update(schema.auditEngagementItems)
      .set({ status })
      .where(eq(schema.auditEngagementItems.id, itemId));

    await AuditService.log({
      req,
      companyId,
      userId,
      action: 'UPDATE_AUDIT_ENGAGEMENT_ITEM_STATUS',
      entityType: 'audit_engagement_items',
      entityId: itemId,
      module: 'Audit',
      beforeData: { status: item.status },
      afterData: { status }
    });

    res.json({ success: true, message: "Item status updated." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update item status" });
  }
});

export default router;
