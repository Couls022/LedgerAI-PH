import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, desc, or, isNull, sql } from "drizzle-orm";
import { broadcastNotification } from "../ws";
import { RbacService } from "../services/rbacService";
import { SmtpConfigService } from "../services/smtpConfigService";
import { AuditService } from "../services/auditService";

const router = Router();

function isNotificationAuthorizedForCaller(
  item: typeof schema.notifications.$inferSelect,
  callerAccess: Awaited<ReturnType<typeof RbacService.resolveEffectiveAccess>>,
  currentUserId: string
): boolean {
  // 1. User targeting check: either broadcast to company (userId is null) or addressed to current user
  if (item.userId && item.userId !== currentUserId) {
    return false;
  }

  // 2. Entity/module permission check: if notification references a specific module entity, verify view access
  const entityType = (item.entityType || "").toUpperCase();
  const notifType = (item.type || "").toUpperCase();

  if (entityType.includes("INVOICE") || entityType.includes("CUSTOMER_PAYMENT") || entityType === "SALES_ORDER" || entityType === "QUOTATION") {
    return (
      callerAccess.effectiveModuleIds.includes("sales") &&
      RbacService.hasPermission(callerAccess, "sales:view")
    );
  }
  if (entityType.includes("BILL") || entityType.includes("SUPPLIER_PAYMENT") || entityType === "PURCHASE_ORDER") {
    return (
      callerAccess.effectiveModuleIds.includes("procurement") &&
      RbacService.hasPermission(callerAccess, "purchases:view")
    );
  }
  if (entityType.includes("JOURNAL") || entityType.includes("PERIOD")) {
    return (
      callerAccess.effectiveModuleIds.includes("accounting") &&
      RbacService.hasPermission(callerAccess, "accounting:view")
    );
  }
  if (entityType.includes("CASH") || entityType.includes("BANK")) {
    return (
      callerAccess.effectiveModuleIds.includes("cash-banking") &&
      RbacService.hasPermission(callerAccess, "cash:view", "bank_rec:view")
    );
  }
  if (entityType.includes("TAX") || notifType === "TAX_DEADLINE") {
    return (
      callerAccess.effectiveModuleIds.includes("tax") &&
      RbacService.hasPermission(callerAccess, "tax:view")
    );
  }
  if (entityType.includes("PAYROLL")) {
    return RbacService.hasPermission(callerAccess, "payroll:view");
  }
  if (entityType.includes("INVENTORY")) {
    return (
      callerAccess.effectiveModuleIds.includes("inventory") &&
      RbacService.hasPermission(callerAccess, "inventory:view")
    );
  }
  if (entityType.includes("ASSET")) {
    return (
      callerAccess.effectiveModuleIds.includes("fixed-assets") &&
      RbacService.hasPermission(callerAccess, "assets:view")
    );
  }
  if (entityType.includes("APPROVAL") || notifType.includes("APPROVAL")) {
    return (
      (callerAccess.effectiveModuleIds.includes("approvals") &&
        RbacService.hasPermission(callerAccess, "approvals:view", "approvals:approve", "approvals:review")) ||
      item.userId === currentUserId
    );
  }
  if (entityType.includes("BACKUP") || notifType.includes("BACKUP")) {
    return RbacService.hasPermission(callerAccess, "backups:view", "backup:read", "settings:view");
  }

  return true;
}

// GET notifications for active company
router.get("/", requireAuth, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const membershipId = req.activeCompany!.membershipId;

  const callerAccess = await RbacService.resolveEffectiveAccess(membershipId);

  const list = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.companyId, companyId),
        or(isNull(schema.notifications.userId), eq(schema.notifications.userId, userId))
      )
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);

  const authorizedList = list.filter((item) =>
    isNotificationAuthorizedForCaller(item, callerAccess, userId)
  );

  const parsedList = authorizedList.map((item) => ({
    ...item,
    metadata: item.metadata ? JSON.parse(item.metadata) : null,
  }));

  res.json(parsedList);
});

// Mark single notification as read
router.patch("/:id/read", requireAuth, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { id } = req.params;

  await db
    .update(schema.notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(schema.notifications.id, id),
        eq(schema.notifications.companyId, companyId),
        or(isNull(schema.notifications.userId), eq(schema.notifications.userId, userId))
      )
    );

  res.json({ success: true, id });
});

// Mark all notifications as read
router.patch("/read-all", requireAuth, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;

  await db
    .update(schema.notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(schema.notifications.companyId, companyId),
        or(isNull(schema.notifications.userId), eq(schema.notifications.userId, userId))
      )
    );

  res.json({ success: true });
});

// Send a test broadcast notification
router.post("/test", requireAuth, requirePermission("settings:manage"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { title, message, type } = req.body;

  const notif = await broadcastNotification({
    companyId,
    userId: req.user!.id,
    title: title || "Test Real-Time Alert",
    message: message || "This is a real-time event notification delivered via WebSocket.",
    type: type || "SYSTEM",
    metadata: { test: true, triggeredBy: req.user!.displayName },
  });

  res.status(201).json({ success: true, notification: notif });
});

// GET overdue & receivable invoices for reminder preview
router.get("/overdue-invoices", requireAuth, requirePermission("sales:view"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const includeUpcoming = req.query.includeUpcoming === "1";
  const todayIso = new Date().toISOString().slice(0, 10);

  const queryResult = await db
    .select({
      id: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      customerName: schema.customers.legalName,
      contactPerson: schema.customers.contactPerson,
      contactDetails: schema.customers.contactDetails,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      dueDate: schema.salesInvoices.dueDate,
      invoiceDate: schema.salesInvoices.invoiceDate,
      status: schema.salesInvoices.status,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} NOT IN ('PAID', 'VOID', 'CANCELLED', 'DRAFT', 'REJECTED', 'ARCHIVED', 'SOFT_DELETED', 'DELETED')`,
        sql`COALESCE(${schema.salesInvoices.balanceDue}, ${schema.salesInvoices.totalAmount}, 0) > 0`
      )
    )
    .orderBy(schema.salesInvoices.dueDate)
    .limit(Math.min(1000, Number(req.query.limit) || 200));

  const enriched = queryResult
    .map((inv: any) => {
      const dueStr = String(inv.dueDate || "").slice(0, 10);
      const isOverdue = Boolean(dueStr && dueStr < todayIso);
      const diffDays = dueStr
        ? Math.max(0, Math.floor((Date.parse(todayIso) - Date.parse(dueStr)) / 86400000))
        : 0;
      const recipientEmail = SmtpConfigService.extractValidEmail(inv.contactDetails);
      return {
        ...inv,
        isOverdue,
        daysOverdue: isOverdue ? diffDays : 0,
        recipientEmail,
      };
    })
    .filter((inv: any) => includeUpcoming || inv.isOverdue || String(inv.status || "").toUpperCase() === "OVERDUE");

  res.json(enriched);
});

// POST Send overdue payment reminders (real SMTP when configured; honest internal log when SMTP unconfigured)
router.post("/reminders/send", requireAuth, requirePermission("sales:edit"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const companyRow = await db
    .select({ legalName: schema.companies.legalName, tradeName: schema.companies.tradeName })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId))
    .get();
  const companyName = companyRow?.tradeName || companyRow?.legalName || "Active Company";

  const { invoiceId, sendAll, includeUpcoming, customMessage } = req.body || {};
  const todayIso = new Date().toISOString().slice(0, 10);

  let targets: any[] = [];

  if (invoiceId) {
    const single = await db
      .select({
        id: schema.salesInvoices.id,
        invoiceNumber: schema.salesInvoices.invoiceNumber,
        customerName: schema.customers.legalName,
        contactPerson: schema.customers.contactPerson,
        contactDetails: schema.customers.contactDetails,
        totalAmount: schema.salesInvoices.totalAmount,
        balanceDue: schema.salesInvoices.balanceDue,
        dueDate: schema.salesInvoices.dueDate,
        invoiceDate: schema.salesInvoices.invoiceDate,
        status: schema.salesInvoices.status,
      })
      .from(schema.salesInvoices)
      .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
      .where(and(eq(schema.salesInvoices.companyId, companyId), eq(schema.salesInvoices.id, invoiceId)));

    if (single.length === 0) {
      return res.status(404).json({
        success: false,
        error: "INVOICE_NOT_FOUND",
        message: "The specified sales invoice does not exist in this company.",
      });
    }
    targets = single;
  } else if (sendAll) {
    const dbTargets = await db
      .select({
        id: schema.salesInvoices.id,
        invoiceNumber: schema.salesInvoices.invoiceNumber,
        customerName: schema.customers.legalName,
        contactPerson: schema.customers.contactPerson,
        contactDetails: schema.customers.contactDetails,
        totalAmount: schema.salesInvoices.totalAmount,
        balanceDue: schema.salesInvoices.balanceDue,
        dueDate: schema.salesInvoices.dueDate,
        invoiceDate: schema.salesInvoices.invoiceDate,
        status: schema.salesInvoices.status,
      })
      .from(schema.salesInvoices)
      .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
      .where(
        and(
          eq(schema.salesInvoices.companyId, companyId),
          sql`${schema.salesInvoices.status} NOT IN ('PAID', 'VOID', 'CANCELLED', 'DRAFT', 'REJECTED', 'ARCHIVED', 'SOFT_DELETED', 'DELETED')`,
          sql`COALESCE(${schema.salesInvoices.balanceDue}, ${schema.salesInvoices.totalAmount}, 0) > 0`
        )
      );

    targets = dbTargets.filter((inv: any) => {
      if (includeUpcoming) return true;
      const dueStr = String(inv.dueDate || "").slice(0, 10);
      return (dueStr && dueStr < todayIso) || String(inv.status || "").toUpperCase() === "OVERDUE";
    });
  }

  const smtpConfig = SmtpConfigService.getTransportConfig(companyId);
  const smtpConfigured = Boolean(smtpConfig);
  const dispatched: any[] = [];
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const inv of targets) {
    const balanceCentavos = Number(inv.balanceDue ?? inv.totalAmount ?? 0);
    const formattedAmount = `₱${(balanceCentavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
    const emailRecipient = SmtpConfigService.extractValidEmail(inv.contactDetails);

    const subject = `Friendly Reminder: Outstanding Payment for Invoice #${inv.invoiceNumber} - ${companyName}`;
    const noteBlock = customMessage ? `\nAdditional Note: ${String(customMessage).trim()}\n` : "";
    const defaultBody = `Dear ${inv.contactPerson || inv.customerName},\n\nWe hope this email finds you well.\n\nThis is a reminder regarding Invoice #${inv.invoiceNumber} issued on ${inv.invoiceDate} for the outstanding balance of ${formattedAmount}, due on ${inv.dueDate}.${noteBlock}\nIf payment has already been sent, please disregard this notice. Otherwise, kindly remit payment or share your payment reference at your earliest convenience.\n\nBest regards,\nAccounting Department\n${companyName}`;

    if (!emailRecipient) {
      skippedCount++;
      dispatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        recipientEmail: null,
        balanceDue: balanceCentavos,
        subject,
        status: "SKIPPED_NO_EMAIL",
        reason: "Customer record does not contain a valid email address.",
      });
      continue;
    }

    if (!smtpConfig) {
      skippedCount++;
      await broadcastNotification({
        companyId,
        userId: req.user!.id,
        title: `Reminder Queued (SMTP Unconfigured): ${inv.invoiceNumber}`,
        message: `Prepared payment reminder for ${inv.customerName} (${emailRecipient}) — configure SMTP under Settings to send email.`,
        type: "SYSTEM",
        entityType: "sales_invoice",
        entityId: inv.id,
        metadata: {
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          recipientEmail: emailRecipient,
          deliveryStatus: "SMTP_NOT_CONFIGURED",
          route: "/operations/invoices",
        },
      });
      dispatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        recipientEmail: emailRecipient,
        balanceDue: balanceCentavos,
        subject,
        status: "SMTP_NOT_CONFIGURED",
        reason: "No company SMTP server configured in Settings → Email Notifications.",
      });
      continue;
    }

    try {
      const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const sendInfo = await SmtpConfigService.sendMail(companyId, {
        to: emailRecipient,
        subject,
        text: defaultBody,
        html: `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 640px;"><h3 style="color:#4f46e5;">${escapeHtml(subject)}</h3><div style="white-space: pre-wrap;">${escapeHtml(defaultBody)}</div></div>`,
      });
      sentCount++;
      const sentAt = new Date().toISOString();

      await broadcastNotification({
        companyId,
        userId: req.user!.id,
        title: `Reminder Sent: ${inv.invoiceNumber}`,
        message: `Payment reminder emailed to ${inv.customerName} (${emailRecipient}) for ${formattedAmount}.`,
        type: "SYSTEM",
        entityType: "sales_invoice",
        entityId: inv.id,
        metadata: {
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          recipientEmail: emailRecipient,
          messageId: sendInfo.messageId,
          sentAt,
          dispatchedBy: req.user!.displayName,
          route: "/operations/invoices",
        },
      });

      await AuditService.log({
        companyId,
        userId: req.user!.id,
        action: "PAYMENT_REMINDER_EMAILED",
        entityType: "SALES_INVOICE",
        entityId: inv.id,
        afterData: {
          invoiceNumber: inv.invoiceNumber,
          recipientEmail: emailRecipient,
          messageId: sendInfo.messageId,
          amountCentavos: balanceCentavos,
        },
        ipAddress: req.ip,
      });

      dispatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        recipientEmail: emailRecipient,
        balanceDue: balanceCentavos,
        subject,
        body: defaultBody,
        status: "SENT",
        messageId: sendInfo.messageId,
        sentAt,
      });
    } catch (smtpErr: any) {
      failedCount++;
      dispatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        recipientEmail: emailRecipient,
        balanceDue: balanceCentavos,
        subject,
        status: "FAILED",
        reason: smtpErr?.message || "SMTP delivery failed.",
      });
    }
  }

  let summaryMessage = "";
  if (targets.length === 0) {
    summaryMessage = "No overdue unpaid invoices matched the reminder criteria.";
  } else if (!smtpConfigured) {
    summaryMessage = `SMTP server is not configured (${dispatched.length} reminder notice(s) logged in-app only; configure SMTP in Settings → Email Notifications to deliver real emails).`;
  } else {
    summaryMessage = `Sent ${sentCount} email reminder(s)${skippedCount ? `, ${skippedCount} skipped (missing customer email)` : ""}${failedCount ? `, ${failedCount} failed` : ""}.`;
  }

  res.json({
    success: failedCount === 0 && (smtpConfigured || targets.length === 0 || sentCount > 0),
    smtpConfigured,
    message: summaryMessage,
    dispatchedCount: sentCount,
    sentCount,
    skippedCount,
    failedCount,
    dispatched,
  });
});

export default router;
