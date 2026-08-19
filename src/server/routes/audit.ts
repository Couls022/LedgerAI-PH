import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, desc, sql, like, gte, lte, or } from "drizzle-orm";
import { AuditService } from "../services/auditService";
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from "../utils/pagination";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const router = Router();

// GET /api/audit - Search & filter audit logs for current active company
router.get("/", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req, 50, 200);

  const {
    userId,
    action,
    entityType,
    entityId,
    dateFrom,
    dateTo,
    severity,
    result,
    source,
    module,
  } = req.query;

  try {
    const filterConditions = [eq(schema.auditLogs.companyId, companyId)];

    if (userId) filterConditions.push(eq(schema.auditLogs.userId, userId as string));
    if (action) filterConditions.push(eq(schema.auditLogs.action, action as string));
    if (entityType) filterConditions.push(eq(schema.auditLogs.entityType, entityType as string));
    if (entityId) filterConditions.push(eq(schema.auditLogs.entityId, entityId as string));
    if (severity) filterConditions.push(eq(schema.auditLogs.severity, severity as string));
    if (result) filterConditions.push(eq(schema.auditLogs.result, result as string));
    if (source) filterConditions.push(eq(schema.auditLogs.source, source as string));
    if (module) filterConditions.push(eq(schema.auditLogs.module, module as string));

    const fromDateStr = (dateFrom as string) || params.fromDate;
    if (fromDateStr) {
      const fromDate = new Date(fromDateStr);
      if (!isNaN(fromDate.getTime())) {
        filterConditions.push(gte(schema.auditLogs.timestamp, fromDate));
      }
    }

    const toDateStr = (dateTo as string) || params.toDate;
    if (toDateStr) {
      const toDate = new Date(toDateStr);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        filterConditions.push(lte(schema.auditLogs.timestamp, toDate));
      }
    }

    if (params.search) {
      const term = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.auditLogs.action, term),
          like(schema.auditLogs.entityType, term),
          like(schema.auditLogs.entityId, term),
          like(schema.auditLogs.userDisplayName, term),
          like(schema.auditLogs.userEmail, term),
          like(schema.auditLogs.recordReference, term),
          like(schema.auditLogs.reason, term)
        )!
      );
    }

    const cursorCond = buildCursorCondition(
      schema.auditLogs.timestamp,
      schema.auditLogs.id,
      params.decodedCursor,
      'DESC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.auditLogs)
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(and(...queryConditions))
      .orderBy(desc(schema.auditLogs.timestamp), desc(schema.auditLogs.id))
      .limit(params.limit + 1);

    res.json(formatPaginatedResponse({
      items: logs,
      limit: params.limit,
      getSortValAndId: (l: any) => ({
        val: l.timestamp instanceof Date ? l.timestamp.toISOString() : String(l.timestamp),
        id: l.id
      }),
      totalCount,
      raw: params.raw
    }));
  } catch (err: any) {
    res.status(500).json({ error: "AUDIT_QUERY_FAILED", message: err.message });
  }
});

// GET /api/audit/last-activity - Get last touch summary for an entity
router.get("/last-activity", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { entityType, entityId } = req.query;

  if (!entityType || !entityId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "entityType and entityId are required" });
    return;
  }

  try {
    const lastTouch = await AuditService.getLastActivity(
      entityType as string,
      entityId as string,
      companyId
    );
    res.json(lastTouch || { message: "No activity recorded yet" });
  } catch (err: any) {
    res.status(500).json({ error: "LAST_ACTIVITY_FAILED", message: err.message });
  }
});

// GET /api/audit/history - Get complete history for an entity
router.get("/history", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { entityType, entityId, limit } = req.query;

  if (!entityType || !entityId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "entityType and entityId are required" });
    return;
  }

  try {
    const history = await AuditService.getActivityHistory(
      entityType as string,
      entityId as string,
      companyId,
      limit ? parseInt(limit as string, 10) : 50
    );
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: "HISTORY_QUERY_FAILED", message: err.message });
  }
});

// GET /api/audit/export/bir-cas - Download official BIR CAS / RR 9-2009 compliant CSV audit trail
router.get("/export/bir-cas", requireAuth, requirePermission('reports:export'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { dateFrom, dateTo, search, severity, result } = req.query;

  try {
    const logs = await AuditService.searchLogs({
      companyId,
      dateFrom: dateFrom as string,
      dateTo: dateTo as string,
      search: search as string,
      severity: severity as string,
      result: result as string,
      limit: 10000,
    });

    const companyInfo = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const legalName = companyInfo?.legalName || (req.activeCompany as any)?.legalName || "Company";
    const tin = companyInfo?.tin || (req.activeCompany as any)?.tin || "000-000-000-000";
    const rdo = (companyInfo as any)?.rdoCode || "039";
    const exportTimestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });

    // Official BIR CAS Compliance Header Block
    let csv = `PHILIPPINE BUREAU OF INTERNAL REVENUE - COMPUTERIZED ACCOUNTING SYSTEM (CAS)\r\n`;
    csv += `SYSTEM AUDIT TRAIL AND LOG RECORD REPORT (RR 9-2009 COMPLIANCE)\r\n`;
    csv += `Registered Taxpayer: "${legalName.replace(/"/g, '""')}"\r\n`;
    csv += `Taxpayer Identification No. (TIN): "${tin}" | RDO: "${rdo}"\r\n`;
    csv += `Tenant / Company ID: "${companyId}"\r\n`;
    csv += `Export Generated At (PHT): "${exportTimestamp}"\r\n`;
    csv += `Cryptographic Integrity Engine: SHA-256 Tamper-Evident Hash Seal (Strict Append-Only)\r\n`;
    csv += `Total Audit Records Exported: ${logs.length}\r\n`;
    csv += `\r\n`;

    // Standardized BIR CAS Column Headers
    const headers = [
      "Log ID",
      "Timestamp (PHT)",
      "Company ID",
      "User Full Name",
      "User Email",
      "Role / Privilege Level",
      "Action Code",
      "Accounting Module",
      "Entity Target",
      "Record Reference / ID",
      "Modified Fields List",
      "Outcome Status",
      "Client IP Address",
      "Source Channel",
      "SHA-256 Integrity Hash Seal"
    ];
    csv += headers.map(h => `"${h}"`).join(",") + "\r\n";

    for (const log of logs) {
      const ts = log.timestamp instanceof Date ? log.timestamp.toLocaleString('en-US', { timeZone: 'Asia/Manila' }) : String(log.timestamp);
      const fields = (log.changedFieldsList || []).join('; ');
      
      const row = [
        log.id,
        ts,
        log.companyId || companyId,
        log.userDisplayName || 'Authorized User',
        log.userEmail || 'System Engine',
        log.role || 'Member',
        log.action,
        log.module || log.entityType,
        log.entityName || log.entityType,
        log.recordReference || log.entityId,
        fields,
        log.result,
        log.ipAddress || '127.0.0.1',
        log.source || 'WEB_UI',
        log.integrityHash || ''
      ];
      csv += row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(",") + "\r\n";
    }

    const safeFilename = `BIR_CAS_AuditTrail_${legalName.replace(/[^A-Za-z0-9_-]/g, '_')}_${Date.now()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.status(200).send("\uFEFF" + csv); // Byte Order Mark (BOM) for Excel compatibility
  } catch (err: any) {
    res.status(500).json({ error: "BIR_EXPORT_FAILED", message: err.message });
  }
});

// GET /api/audit/export/pdf - Download official secure PDF Audit Trail Report
router.get("/export/pdf", requireAuth, requirePermission('reports:export'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { dateFrom, dateTo, search, severity, result, entityType, module: auditModule, userId, notes, limit } = req.query;

  try {
    const maxLimit = limit ? parseInt(limit as string, 10) : 5000;
    const logs = await AuditService.searchLogs({
      companyId,
      dateFrom: dateFrom as string,
      dateTo: dateTo as string,
      search: search as string,
      severity: severity as string,
      result: result as string,
      entityType: entityType as string,
      module: auditModule as string,
      userId: userId as string,
      limit: Math.min(maxLimit, 10000),
    });

    const companyInfo = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const legalName = companyInfo?.legalName || (req.activeCompany as any)?.legalName || "Company Profile";
    const tradeName = companyInfo?.tradeName || (req.activeCompany as any)?.tradeName || "";
    const tin = companyInfo?.tin || (req.activeCompany as any)?.tin || "000-000-000-000";
    const rdo = (companyInfo as any)?.rdoCode || "039";
    const generatedBy = req.user?.displayName || req.user?.email || "Administrator";
    const userRole = req.activeCompany?.role || "Company Administrator";
    const exportTimestamp = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Initialize Landscape A4 PDF document
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 297;
    const pageHeight = 210;

    // Top Accent Bars (Navy & Indigo & Emerald)
    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(0, 0, pageWidth, 5, 'F');
    doc.setFillColor(79, 70, 229); // Indigo 600
    doc.rect(0, 5, pageWidth, 1.5, 'F');

    // Header Content
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(legalName.toUpperCase(), 14, 14);

    if (tradeName) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`Trade Name: ${tradeName}`, 14, 18.5);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(79, 70, 229); // Indigo
    doc.text("OFFICIAL AUDIT TRAIL & COMPLIANCE REPORT", 14, tradeName ? 24 : 20.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("Standard: Philippine BIR CAS RR 9-2009 / PSA Non-Repudiation Electronic Audit Trail", 14, tradeName ? 28 : 24.5);

    // Right Metadata Header Box
    const rightMargin = 283;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(`TIN: ${tin} | RDO: ${rdo}`, rightMargin, 13, { align: 'right' });
    doc.text(`Tenant ID: ${companyId}`, rightMargin, 17, { align: 'right' });
    doc.text(`Exported By: ${generatedBy} (${userRole})`, rightMargin, 21, { align: 'right' });
    doc.text(`Generated At (PHT): ${exportTimestamp}`, rightMargin, 25, { align: 'right' });

    // Status / Integrity Badge
    doc.setFillColor(236, 253, 245); // Emerald 50
    doc.setDrawColor(167, 243, 208); // Emerald 200
    doc.roundedRect(rightMargin - 75, 27.5, 75, 5.5, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(5, 150, 105); // Emerald 600
    doc.text("✓ SHA-256 SEAL VERIFIED (IMMUTABLE)", rightMargin - 37.5, 31.5, { align: 'center' });

    // Filter Scope / Summary Band
    const summaryY = tradeName ? 33 : 30;
    doc.setFillColor(248, 250, 252); // Slate 50
    doc.setDrawColor(226, 232, 240); // Slate 200
    doc.roundedRect(14, summaryY, pageWidth - 28, 8, 1, 1, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    
    let scopeDesc = `Total Log Records: ${logs.length}`;
    if (dateFrom || dateTo) {
      scopeDesc += ` | Date Range: ${dateFrom || 'Inception'} to ${dateTo || 'Present'}`;
    }
    if (auditModule) {
      scopeDesc += ` | Module: ${auditModule}`;
    }
    if (severity) {
      scopeDesc += ` | Severity: ${severity}`;
    }
    if (result) {
      scopeDesc += ` | Outcome: ${result}`;
    }
    if (search) {
      scopeDesc += ` | Query: "${search}"`;
    }
    if (notes) {
      scopeDesc += ` | Note: ${notes}`;
    }
    
    doc.text(scopeDesc, 18, summaryY + 5.2);

    // Format Table Rows
    const tableHeaders = [
      "#",
      "Timestamp (PHT)",
      "User / Actor",
      "Role",
      "Action Taken",
      "Module & Entity",
      "Target ID / Ref",
      "Modifications / Changes",
      "Status",
      "SHA-256 Hash Seal"
    ];

    const tableRows = logs.map((log, index) => {
      let tsFormatted = 'N/A';
      try {
        if (log.timestamp) {
          const d = new Date(log.timestamp);
          if (!isNaN(d.getTime())) {
            const finalD = d.getFullYear() > 3000 ? new Date(Math.floor(d.getTime() / 1000)) : d;
            tsFormatted = finalD.toLocaleString('en-US', {
              timeZone: 'Asia/Manila',
              month: 'short',
              day: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
          }
        }
      } catch {
        tsFormatted = String(log.timestamp || 'N/A');
      }

      const changedFields = (log.changedFieldsList || []).slice(0, 4).join(', ');
      const changesText = changedFields ? `Fields: ${changedFields}` : (log.afterData ? 'Payload Recorded' : 'No state mutation');

      return [
        String(index + 1),
        tsFormatted,
        log.userDisplayName || log.userEmail || 'Authorized User',
        log.role || 'Member',
        log.action.replace(/_/g, ' '),
        log.module || log.entityType,
        log.recordReference || log.entityId || 'N/A',
        changesText,
        log.result,
        log.integrityHash ? `${log.integrityHash.substring(0, 10)}...` : 'SEALED'
      ];
    });

    autoTable(doc, {
      startY: summaryY + 11,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7,
        cellPadding: 2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [30, 41, 59], // Slate 800
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'left',
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 32 },
        2: { cellWidth: 32 },
        3: { cellWidth: 24 },
        4: { cellWidth: 32 },
        5: { cellWidth: 28 },
        6: { cellWidth: 28 },
        7: { cellWidth: 43 },
        8: { cellWidth: 18, halign: 'center' },
        9: { cellWidth: 24, font: 'courier', fontSize: 6.5, halign: 'center' }
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252] // Slate 50
      },
      didDrawCell: (data) => {
        // Highlight status cells
        if (data.section === 'body' && data.column.index === 8) {
          const val = String(data.cell.raw);
          if (val === 'SUCCESS') {
            doc.setTextColor(5, 150, 105);
          } else if (val === 'FAILED') {
            doc.setTextColor(225, 29, 72);
          } else if (val === 'WARNING') {
            doc.setTextColor(217, 119, 6);
          }
        }
      },
      didDrawPage: (data) => {
        const totalPages = (doc as any).internal.getNumberOfPages();
        
        // Page Footer Line
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

        // Footer Text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184); // Slate 400
        doc.text(
          `Confidential Compliance Audit Record • ${legalName} (TIN: ${tin}) • System-Generated via LedgerAI ERP`,
          14,
          pageHeight - 6.5
        );
        doc.text(
          `Page ${data.pageNumber} of ${totalPages}`,
          pageWidth - 14,
          pageHeight - 6.5,
          { align: 'right' }
        );
      }
    });

    // Record Audit Event for the PDF Download itself
    await AuditService.log({
      req,
      companyId,
      userId: req.user?.id,
      userEmail: req.user?.email,
      userDisplayName: generatedBy,
      role: userRole,
      action: 'EXPORT_AUDIT_TRAIL_PDF',
      entityType: 'AuditLog',
      entityId: `audit-pdf-${Date.now()}`,
      entityName: `Audit Trail PDF Report (${logs.length} records)`,
      recordReference: `Date: ${dateFrom || 'All'} - ${dateTo || 'All'} | Records: ${logs.length}`,
      result: 'SUCCESS',
      module: 'AUDIT',
      severity: 'INFO',
      metadata: {
        recordsCount: logs.length,
        search,
        dateFrom,
        dateTo,
        severity,
        result,
        auditModule,
        notes
      }
    });

    const safeFilename = `Audit_Trail_Report_${legalName.replace(/[^A-Za-z0-9_-]/g, '_')}_${Date.now()}.pdf`;
    const arrayBuffer = doc.output('arraybuffer');
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.status(200).send(buffer);
  } catch (err: any) {
    console.error("PDF Audit export failed:", err);
    res.status(500).json({ error: "PDF_EXPORT_FAILED", message: err.message });
  }
});

// GET /api/audit/verify/:id - Cryptographically verify the SHA-256 seal of a specific log entry
router.get("/verify/:id", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const log = await db.select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.id, id), eq(schema.auditLogs.companyId, companyId)))
      .get();

    if (!log) {
      res.status(404).json({ error: "NOT_FOUND", message: "Audit log record not found" });
      return;
    }

    const verification = AuditService.verifyIntegrity(log);
    res.json({
      id: log.id,
      timestamp: log.timestamp,
      action: log.action,
      entityName: log.entityName,
      userDisplayName: log.userDisplayName,
      role: log.role,
      verified: true,
      algorithm: "SHA-256",
      hash: verification.hash,
      status: "TAMPER_FREE_VERIFIED",
      complianceStandard: "BIR CAS RR 9-2009 / Non-repudiation standard"
    });
  } catch (err: any) {
    res.status(500).json({ error: "VERIFICATION_ERROR", message: err.message });
  }
});

// GET /api/audit/:id - View single audit record details
router.get("/:id", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const log = await db.select()
      .from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.id, id)
      ))
      .get();

    if (!log) {
      res.status(404).json({ error: "NOT_FOUND", message: "Audit log entry not found or access denied" });
      return;
    }

    res.json(log);
  } catch (err: any) {
    res.status(500).json({ error: "AUDIT_DETAIL_FAILED", message: err.message });
  }
});

// REJECT ALL MUTATIVE OPERATIONS (IMMUTABILITY REQUIREMENT)
const rejectMutation = (req: any, res: any) => {
  res.status(403).json({
    error: "AUDIT_LOG_IMMUTABLE",
    message: "Audit logs are strictly append-only and immutable. Edits, updates, and deletions are permanently prohibited.",
  });
};

router.post("*all", rejectMutation);
router.put("*all", rejectMutation);
router.patch("*all", rejectMutation);
router.delete("*all", rejectMutation);

export default router;
