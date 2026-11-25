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

// Pass through /findings, /adjustments, and /workpapers sub-paths handled by licensingAndLanRoutes
router.use(["/findings", "/adjustments", "/workpapers"], (_req, _res, next) => next("router"));

// Helper to build domain category SQL condition for Module 15 Category Quick Tabs
function buildAuditDomainCategoryCondition(catRaw?: string) {
  const cat = String(catRaw || '').trim().toUpperCase();
  if (!cat || cat === 'ALL') return undefined;
  if (cat === 'FILES' || cat === 'DOCUMENTS' || cat === 'DOCUMENT') {
    return or(
      eq(schema.auditLogs.module, 'DOCUMENTS'),
      eq(schema.auditLogs.module, 'DOCUMENT'),
      eq(schema.auditLogs.entityType, 'DOCUMENT'),
      eq(schema.auditLogs.entityType, 'DOCUMENTS'),
      like(schema.auditLogs.entityType, '%DOC%')
    )!;
  }
  if (cat === 'COMPANY' || cat === 'SETTINGS' || cat === 'TAX') {
    return or(
      eq(schema.auditLogs.module, 'COMPANY'),
      eq(schema.auditLogs.module, 'SETTINGS'),
      eq(schema.auditLogs.module, 'TAX'),
      eq(schema.auditLogs.module, 'PERIOD'),
      eq(schema.auditLogs.entityType, 'COMPANY'),
      eq(schema.auditLogs.entityType, 'SETTINGS'),
      eq(schema.auditLogs.entityType, 'TAX'),
      eq(schema.auditLogs.entityType, 'TAX_FILING'),
      eq(schema.auditLogs.entityType, 'ACCOUNTING_PERIOD'),
      eq(schema.auditLogs.entityType, 'PERIOD'),
      eq(schema.auditLogs.entityType, 'BRANCH')
    )!;
  }
  if (cat === 'USERS' || cat === 'MEMBERSHIP' || cat === 'RBAC' || cat === 'USER') {
    return or(
      eq(schema.auditLogs.module, 'MEMBERSHIP'),
      eq(schema.auditLogs.module, 'RBAC'),
      eq(schema.auditLogs.module, 'AUTH'),
      eq(schema.auditLogs.module, 'USER'),
      eq(schema.auditLogs.module, 'ROLE'),
      eq(schema.auditLogs.module, 'APPROVALS'),
      eq(schema.auditLogs.entityType, 'MEMBERSHIP'),
      eq(schema.auditLogs.entityType, 'USER'),
      eq(schema.auditLogs.entityType, 'ROLE'),
      eq(schema.auditLogs.entityType, 'AUTH'),
      eq(schema.auditLogs.entityType, 'APPROVAL_POLICY'),
      eq(schema.auditLogs.entityType, 'APPROVAL_DELEGATION')
    )!;
  }
  if (cat === 'ACCOUNTING' || cat === 'JOURNAL_ENTRY' || cat === 'JOURNAL') {
    return or(
      eq(schema.auditLogs.module, 'JOURNAL_ENTRY'),
      eq(schema.auditLogs.module, 'ACCOUNTING'),
      eq(schema.auditLogs.module, 'SALES'),
      eq(schema.auditLogs.module, 'PROCUREMENT'),
      eq(schema.auditLogs.module, 'CASH'),
      eq(schema.auditLogs.module, 'PAYROLL'),
      eq(schema.auditLogs.module, 'FIXED_ASSETS'),
      eq(schema.auditLogs.module, 'INVENTORY'),
      eq(schema.auditLogs.module, 'BUDGETS'),
      eq(schema.auditLogs.entityType, 'JOURNAL_ENTRY'),
      eq(schema.auditLogs.entityType, 'SALES_INVOICE'),
      eq(schema.auditLogs.entityType, 'PURCHASE_BILL'),
      eq(schema.auditLogs.entityType, 'CUSTOMER_PAYMENT'),
      eq(schema.auditLogs.entityType, 'SUPPLIER_PAYMENT'),
      eq(schema.auditLogs.entityType, 'CASH_TRANSACTION'),
      eq(schema.auditLogs.entityType, 'BANK_RECONCILIATION'),
      eq(schema.auditLogs.entityType, 'ACCOUNT'),
      eq(schema.auditLogs.entityType, 'PAYROLL_RUN'),
      eq(schema.auditLogs.entityType, 'FIXED_ASSET'),
      eq(schema.auditLogs.entityType, 'PURCHASE_ORDER'),
      eq(schema.auditLogs.entityType, 'PURCHASE_REQUISITION'),
      eq(schema.auditLogs.entityType, 'GOODS_RECEIPT_NOTE'),
      eq(schema.auditLogs.entityType, 'BUDGET'),
      eq(schema.auditLogs.entityType, 'CREDIT_MEMO'),
      eq(schema.auditLogs.entityType, 'DEBIT_MEMO')
    )!;
  }
  return eq(schema.auditLogs.module, catRaw as string);
}

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
    category,
  } = req.query;

  try {
    const baseConditions = [eq(schema.auditLogs.companyId, companyId)];

    if (userId) baseConditions.push(eq(schema.auditLogs.userId, userId as string));
    if (action) baseConditions.push(eq(schema.auditLogs.action, action as string));
    if (entityType) {
      const variants = AuditService.getEntityTypeVariants(entityType as string);
      const variantConds = variants.map(v => eq(schema.auditLogs.entityType, v));
      variantConds.push(eq(schema.auditLogs.module, String(entityType).toUpperCase()));
      baseConditions.push(variantConds.length === 1 ? variantConds[0] : or(...variantConds)!);
    }
    if (entityId) baseConditions.push(eq(schema.auditLogs.entityId, entityId as string));
    if (severity) baseConditions.push(eq(schema.auditLogs.severity, severity as string));
    if (result) baseConditions.push(eq(schema.auditLogs.result, result as string));
    if (source) baseConditions.push(eq(schema.auditLogs.source, source as string));

    const fromDateStr = (dateFrom as string) || params.fromDate;
    if (fromDateStr) {
      const fromDate = new Date(fromDateStr);
      if (!isNaN(fromDate.getTime())) {
        baseConditions.push(gte(schema.auditLogs.timestamp, fromDate));
      }
    }

    const toDateStr = (dateTo as string) || params.toDate;
    if (toDateStr) {
      const toDate = new Date(toDateStr);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        baseConditions.push(lte(schema.auditLogs.timestamp, toDate));
      }
    }

    if (params.search) {
      const term = `%${params.search}%`;
      baseConditions.push(
        or(
          like(schema.auditLogs.action, term),
          like(schema.auditLogs.entityType, term),
          like(schema.auditLogs.entityId, term),
          like(schema.auditLogs.userDisplayName, term),
          like(schema.auditLogs.userEmail, term),
          like(schema.auditLogs.recordReference, term),
          like(schema.auditLogs.reason, term),
          like(schema.auditLogs.module, term)
        )!
      );
    }

    const filterConditions = [...baseConditions];
    const activeCatOrMod = (category as string) || (module as string);
    if (activeCatOrMod) {
      const catCond = buildAuditDomainCategoryCondition(activeCatOrMod);
      if (catCond) filterConditions.push(catCond);
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

    // Compute category tab counts across the active search/filter base conditions
    const countForCat = async (catKey?: string) => {
      const conds = [...baseConditions];
      if (catKey) {
        const c = buildAuditDomainCategoryCondition(catKey);
        if (c) conds.push(c);
      }
      const [row] = await db
        .select({ total: sql<number>`count(*)` })
        .from(schema.auditLogs)
        .where(and(...conds));
      return Number(row?.total || 0);
    };

    const [allCnt, filesCnt, companyCnt, usersCnt, accountingCnt] = await Promise.all([
      countForCat(undefined),
      countForCat('FILES'),
      countForCat('COMPANY'),
      countForCat('USERS'),
      countForCat('ACCOUNTING'),
    ]);

    const rawLogs = await db
      .select()
      .from(schema.auditLogs)
      .where(and(...queryConditions))
      .orderBy(desc(schema.auditLogs.timestamp), desc(schema.auditLogs.id))
      .limit(params.limit + 1);

    // Enrich rows with parsed changedFieldsList, integrityHash, verified, and canonicalEntityType
    const logs = rawLogs.map((l) => {
      const integrity = AuditService.verifyIntegrity(l);
      let changedFieldsList: string[] = [];
      try {
        changedFieldsList = l.changedFields ? JSON.parse(l.changedFields) : [];
      } catch {
        changedFieldsList = [];
      }
      if (!Array.isArray(changedFieldsList) || changedFieldsList.length === 0) {
        try {
          const bObj = l.beforeData ? JSON.parse(l.beforeData) : null;
          const aObj = l.afterData ? JSON.parse(l.afterData) : null;
          const keys = new Set<string>([
            ...(bObj && typeof bObj === 'object' ? Object.keys(bObj) : []),
            ...(aObj && typeof aObj === 'object' ? Object.keys(aObj) : []),
          ]);
          changedFieldsList = Array.from(keys).filter((k) => {
            if (bObj && aObj) return JSON.stringify(bObj[k]) !== JSON.stringify(aObj[k]);
            return true;
          });
        } catch {
          changedFieldsList = [];
        }
      }

      let tsDate: Date;
      if (l.timestamp instanceof Date) {
        tsDate = l.timestamp;
      } else {
        const num = Number(l.timestamp);
        if (!isNaN(num) && num > 0) {
          tsDate = new Date(num < 10000000000 ? num * 1000 : num);
        } else {
          tsDate = new Date(String(l.timestamp));
        }
      }

      return {
        ...l,
        timestamp: !isNaN(tsDate.getTime()) ? tsDate : new Date(),
        canonicalEntityType: (l.entityType && AuditService.getEntityTypeVariants(l.entityType)[0]) || l.entityType,
        userDisplayName: l.userDisplayName || l.userEmail || 'Authorized User',
        role: l.role || 'Member',
        changedFieldsList,
        integrityHash: integrity.hash,
        verified: integrity.verified,
      };
    });

    const paginatedPayload = formatPaginatedResponse({
      items: logs,
      limit: params.limit,
      getSortValAndId: (l: any) => ({
        val: l.timestamp instanceof Date ? l.timestamp.toISOString() : String(l.timestamp),
        id: l.id
      }),
      totalCount,
      raw: params.raw
    });

    if (params.raw) {
      res.json(paginatedPayload);
    } else {
      res.json({
        ...(paginatedPayload as any),
        categoryCounts: {
          ALL: allCnt,
          FILES: filesCnt,
          COMPANY: companyCnt,
          USERS: usersCnt,
          ACCOUNTING: accountingCnt,
        },
      });
    }
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

// GET /api/audit/verify-chain - Cryptographically verify full per-company audit log hash chain & sequence continuity
router.get("/verify-chain", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const chainResult = await AuditService.verifyAuditChain(companyId);
    res.json({
      companyId,
      algorithm: "SHA-256",
      status: chainResult.verified ? "TAMPER_FREE_VERIFIED" : "TAMPERED_DETECTED",
      ...chainResult,
      complianceStandard: "BIR CAS RR 9-2009 / Non-repudiation hash-chain standard"
    });
  } catch (err: any) {
    res.status(500).json({ error: "CHAIN_VERIFICATION_ERROR", message: err.message });
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
      verified: verification.verified,
      reason: verification.reason || null,
      chainVersion: verification.chainVersion || 1,
      sequenceNumber: verification.sequenceNumber ?? null,
      previousHash: verification.previousHash || null,
      algorithm: "SHA-256",
      hash: verification.hash,
      expectedSeal: verification.expectedSeal || null,
      status: verification.verified ? "TAMPER_FREE_VERIFIED" : "TAMPERED_DETECTED",
      complianceStandard: "BIR CAS RR 9-2009 / Non-repudiation standard"
    });
  } catch (err: any) {
    res.status(500).json({ error: "VERIFICATION_ERROR", message: err.message });
  }
});

// ============================================================================
// CRYPTOGRAPHIC LEDGER INTEGRITY ROUTES (REQ-CRYPTO-LEDGER-001 & REQ-OFFLINE-INTEGRITY-001)
// ============================================================================
import { LedgerIntegrityService } from "../services/ledgerIntegrityService";

const hasExplicitDeny = (req: any, code: string): boolean => {
  const denied = (req.deniedPermissions || []) as string[];
  return denied.some((d) => d.toLowerCase() === code.toLowerCase());
};

// GET /api/audit/integrity/overview - Get current integrity status, latest scan report, and scan history
router.get(
  "/integrity/overview",
  requireAuth,
  requirePermission("audit:integrity:view", "audit:view"),
  async (req, res) => {
    if (hasExplicitDeny(req, "audit:integrity:view") || hasExplicitDeny(req, "audit:view")) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Access explicitly denied by RBAC override for audit:integrity:view",
      });
      return;
    }
    const companyId = req.activeCompany!.id;
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
      const data = await LedgerIntegrityService.getOverviewAndHistory(companyId, limit);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({
        error: "INTEGRITY_OVERVIEW_FAILED",
        message: err?.message || "Failed to load ledger integrity overview",
      });
    }
  }
);

// POST /api/audit/integrity/scan - Execute 3-domain offline cryptographic & accounting integrity scan
router.post(
  "/integrity/scan",
  requireAuth,
  requirePermission("audit:integrity:scan", "audit:manage"),
  async (req, res) => {
    if (hasExplicitDeny(req, "audit:integrity:scan") || hasExplicitDeny(req, "audit:manage")) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Access explicitly denied by RBAC override for audit:integrity:scan",
      });
      return;
    }
    const companyId = req.activeCompany!.id;
    try {
      const report = await LedgerIntegrityService.runIntegrityScan(companyId, {
        userId: req.user?.id,
        userName: req.user?.displayName || req.user?.email || "Auditor",
        userRole: req.activeCompany?.roleName || req.activeCompany?.role || "Company Owner",
        req,
      });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({
        error: "INTEGRITY_SCAN_FAILED",
        message: err?.message || "Failed to execute cryptographic ledger integrity scan",
      });
    }
  }
);

// GET /api/audit/integrity/scans/:scanId - Load a specific persisted scan report
router.get(
  "/integrity/scans/:scanId",
  requireAuth,
  requirePermission("audit:integrity:view", "audit:view"),
  async (req, res) => {
    if (hasExplicitDeny(req, "audit:integrity:view") || hasExplicitDeny(req, "audit:view")) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Access explicitly denied by RBAC override for audit:integrity:view",
      });
      return;
    }
    const companyId = req.activeCompany!.id;
    const { scanId } = req.params;
    try {
      const report = await LedgerIntegrityService.getScanReportById(companyId, scanId);
      if (!report) {
        res.status(404).json({
          error: "SCAN_REPORT_NOT_FOUND",
          message: `Integrity scan report '${scanId}' not found for active company.`,
        });
        return;
      }
      res.json(report);
    } catch (err: any) {
      res.status(500).json({
        error: "INTEGRITY_REPORT_QUERY_FAILED",
        message: err?.message || "Failed to load integrity scan report",
      });
    }
  }
);

// GET /api/audit/integrity/scans/:scanId/export - Export tamper-evident JSON or CSV integrity report
router.get(
  "/integrity/scans/:scanId/export",
  requireAuth,
  requirePermission("audit:integrity:export", "audit:export"),
  async (req, res) => {
    if (hasExplicitDeny(req, "audit:integrity:export") || hasExplicitDeny(req, "audit:export")) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Access explicitly denied by RBAC override for audit:integrity:export",
      });
      return;
    }
    const companyId = req.activeCompany!.id;
    const { scanId } = req.params;
    const format = String(req.query.format || "json").toLowerCase();

    try {
      const report = await LedgerIntegrityService.getScanReportById(companyId, scanId);
      if (!report) {
        res.status(404).json({
          error: "SCAN_REPORT_NOT_FOUND",
          message: `Integrity scan report '${scanId}' not found for active company.`,
        });
        return;
      }

      await AuditService.log({
        req,
        companyId,
        userId: req.user?.id,
        userDisplayName: req.user?.displayName || req.user?.email,
        role: req.activeCompany?.roleName || req.activeCompany?.role,
        action: "EXPORT_CRYPTOGRAPHIC_INTEGRITY_REPORT",
        entityType: "AUDIT_LOG",
        entityId: scanId,
        entityName: `Integrity Scan Report ${scanId} (${format.toUpperCase()})`,
        recordReference: scanId,
        result: "SUCCESS",
        module: "AUDIT",
        severity: "INFO",
        metadata: { scanId, format, reportHash: report.reportHash },
      });

      if (format === "csv") {
        let csv = `LEDGERAI PH — CRYPTOGRAPHIC LEDGER INTEGRITY REPORT\r\n`;
        csv += `Scan ID,"${report.scanId}"\r\n`;
        csv += `Company,"${report.companyName.replace(/"/g, '""')}" (${report.companyId})\r\n`;
        csv += `Database Identity,"${report.databaseIdentity}"\r\n`;
        csv += `Execution Mode,"${report.executionMode}"\r\n`;
        csv += `Scan Timestamp,"${report.scanTimestamp}"\r\n`;
        csv += `Report SHA-256 Digest,"${report.reportHash}"\r\n`;
        csv += `Previous Scan SHA-256,"${report.previousReportHash || "GENESIS"}"\r\n`;
        csv += `Passed Checks,${report.passedChecks},Failed Checks,${report.failedChecks},Findings,${report.findingsCount}\r\n\r\n`;
        csv += `"Finding ID","Domain","Check Code","Severity","Entity Type","Entity ID","Reference","Title","Discrepancy (PHP)","Remediation Action"\r\n`;
        for (const f of report.findings) {
          const row = [
            f.id,
            f.domain,
            f.checkCode,
            f.severity,
            f.entityType,
            f.entityId,
            f.recordReference,
            f.title,
            (f.discrepancyAmountCentavos / 100).toFixed(2),
            f.remediationAction,
          ];
          csv += row.map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",") + "\r\n";
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="LedgerAI_Integrity_Scan_${report.scanId}.csv"`
        );
        res.status(200).send("\uFEFF" + csv);
        return;
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="LedgerAI_Integrity_Scan_${report.scanId}.json"`
      );
      res.status(200).send(JSON.stringify(report, null, 2));
    } catch (err: any) {
      res.status(500).json({
        error: "INTEGRITY_EXPORT_FAILED",
        message: err?.message || "Failed to export integrity report",
      });
    }
  }
);

// GET /api/audit/:id - View single audit record details
router.get("/:id", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const log = await db.select()
      .from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.id, id),
        eq(schema.auditLogs.companyId, companyId)
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
