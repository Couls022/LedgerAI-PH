import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, desc, sql } from "drizzle-orm";
import { broadcastNotification } from "../ws";

const router = Router();

// GET notifications for active company
router.get("/", requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const list = await db.select()
    .from(schema.notifications)
    
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);

  const parsedList = list.map((item) => ({
    ...item,
    metadata: item.metadata ? JSON.parse(item.metadata) : null,
  }));

  res.json(parsedList);
});

// Mark single notification as read
router.patch("/:id/read", requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  await db.update(schema.notifications)
    .set({ isRead: true })
    .where(and(
      eq(schema.notifications.id, id)
    ));

  res.json({ success: true, id });
});

// Mark all notifications as read
router.patch("/read-all", requireAuth, requirePermission('company:read'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  await db.update(schema.notifications)
    .set({ isRead: true })
    ;

  res.json({ success: true });
});

// Send a test broadcast notification
router.post("/test", requireAuth, requirePermission('settings:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { title, message, type } = req.body;

  const notif = await broadcastNotification({
    companyId,
    userId: req.user!.id,
    title: title || "Test Real-Time Alert",
    message: message || "This is a real-time event notification delivered via WebSocket.",
    type: type || "SYSTEM",
    metadata: { test: true, triggeredBy: req.user!.displayName }
  });

  res.status(201).json({ success: true, notification: notif });
});

// GET overdue invoices for reminder preview
router.get("/overdue-invoices", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  const queryResult = await db.select({
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
  .where(and(
    sql`${schema.salesInvoices.status} != 'PAID' AND ${schema.salesInvoices.status} != 'VOID'`
  ))
  .orderBy(desc(schema.salesInvoices.dueDate));

  const items = queryResult;

  res.json(items);
});

// POST Send automated friendly email reminders for overdue invoices
router.post("/reminders/send", requireAuth, requirePermission('sales:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const companyName = (req.activeCompany as any)?.legalName || "Active Company";
  const { invoiceId, sendAll, customMessage } = req.body;

  let targets: any[] = [];

  if (invoiceId) {
    const single = await db.select({
      id: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      customerName: schema.customers.legalName,
      contactPerson: schema.customers.contactPerson,
      contactDetails: schema.customers.contactDetails,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      dueDate: schema.salesInvoices.dueDate,
      invoiceDate: schema.salesInvoices.invoiceDate,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(and(
      eq(schema.salesInvoices.id, invoiceId)
    ));

    if (single.length > 0) {
      targets = single;
    }
  }

  if (targets.length === 0 || sendAll) {
    const dbTargets = await db.select({
      id: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      customerName: schema.customers.legalName,
      contactPerson: schema.customers.contactPerson,
      contactDetails: schema.customers.contactDetails,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      dueDate: schema.salesInvoices.dueDate,
      invoiceDate: schema.salesInvoices.invoiceDate,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(and(
      sql`${schema.salesInvoices.status} != 'PAID' AND ${schema.salesInvoices.status} != 'VOID'`
    ));

    targets = dbTargets;
  }

  const dispatched: any[] = [];

  for (const inv of targets) {
    const formattedAmount = `₱${((inv.balanceDue || inv.totalAmount) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
    const emailRecipient = inv.contactDetails || `${inv.customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@client-domain.ph`;
    
    const subject = `Friendly Reminder: Outstanding Payment for Invoice #${inv.invoiceNumber} - ${companyName}`;
    const defaultBody = `Dear ${inv.contactPerson || inv.customerName},\n\nWe hope this email finds you well.\n\nThis is a friendly reminder regarding Invoice #${inv.invoiceNumber} issued on ${inv.invoiceDate} for the total outstanding amount of ${formattedAmount}, which was due on ${inv.dueDate}.\n\nIf payment has already been sent, please disregard this notice. Otherwise, kindly remit payment or share your payment reference at your earliest convenience.\n\nThank you for your business!\n\nBest regards,\nAccounting Department\n${companyName}`;

    const bodyText = customMessage || defaultBody;

    // Log broadcast notification
    await broadcastNotification({
      companyId,
      userId: req.user!.id,
      title: `📧 Reminder Sent: ${inv.invoiceNumber}`,
      message: `Friendly payment reminder dispatched to ${inv.customerName} (${emailRecipient}) for ${formattedAmount}.`,
      type: "SYSTEM",
      entityType: "sales_invoice",
      entityId: inv.id,
      metadata: {
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        recipientEmail: emailRecipient,
        sentAt: new Date().toISOString(),
        dispatchedBy: req.user!.displayName
      }
    });

    dispatched.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customerName,
      recipientEmail: emailRecipient,
      balanceDue: inv.balanceDue,
      subject,
      body: bodyText,
      status: "SENT",
      sentAt: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    message: `Successfully dispatched ${dispatched.length} friendly overdue payment reminder email(s).`,
    dispatchedCount: dispatched.length,
    dispatched
  });
});

export default router;
