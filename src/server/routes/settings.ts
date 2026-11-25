import { Router } from "express";
import { requireAuth, requirePermission } from "../auth";
import { SmtpConfigService } from "../services/smtpConfigService";
import { AuditService } from "../services/auditService";
import { dbContext } from "../db/context";

const router = Router();

const WALKTHROUGH_VERSION = 2;

function getRawSqliteForSettings(): any {
  const activeDb = dbContext.getStore() as any;
  return activeDb?.$client || activeDb?.session?.client || null;
}

router.get("/walkthrough", requireAuth, (req, res) => {
  try {
    const client = getRawSqliteForSettings();
    const companyId = req.activeCompany!.id;
    const userId = req.user!.id;
    if (!client) {
      return res.json({ completed: false, version: WALKTHROUGH_VERSION, completedAt: null });
    }
    client.exec(`
      CREATE TABLE IF NOT EXISTS user_walkthrough_state (
        company_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 2,
        completed INTEGER NOT NULL DEFAULT 0,
        last_step INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id)
      )
    `);
    const row = client
      .prepare("SELECT version, completed, last_step, completed_at, updated_at FROM user_walkthrough_state WHERE company_id = ? AND user_id = ?")
      .get(companyId, userId) as any;

    res.json({
      completed: Boolean(row && row.completed && Number(row.version) >= WALKTHROUGH_VERSION),
      version: WALKTHROUGH_VERSION,
      lastStep: row ? Number(row.last_step || 0) : 0,
      completedAt: row?.completed_at || null,
      updatedAt: row?.updated_at || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: "WALKTHROUGH_LOAD_ERROR", message: error.message });
  }
});

router.post("/walkthrough", requireAuth, (req, res) => {
  try {
    const client = getRawSqliteForSettings();
    const companyId = req.activeCompany!.id;
    const userId = req.user!.id;
    const { completed = true, lastStep = 0 } = req.body || {};
    if (!client) {
      return res.json({ success: true, completed: Boolean(completed), version: WALKTHROUGH_VERSION });
    }
    client.exec(`
      CREATE TABLE IF NOT EXISTS user_walkthrough_state (
        company_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 2,
        completed INTEGER NOT NULL DEFAULT 0,
        last_step INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id)
      )
    `);
    const now = new Date().toISOString();
    client
      .prepare(`
        INSERT INTO user_walkthrough_state (company_id, user_id, version, completed, last_step, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id, user_id) DO UPDATE SET
          version = excluded.version,
          completed = excluded.completed,
          last_step = excluded.last_step,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
      `)
      .run(
        companyId,
        userId,
        WALKTHROUGH_VERSION,
        completed ? 1 : 0,
        Number(lastStep) || 0,
        completed ? now : null,
        now
      );

    res.json({ success: true, completed: Boolean(completed), version: WALKTHROUGH_VERSION, completedAt: completed ? now : null });
  } catch (error: any) {
    res.status(500).json({ error: "WALKTHROUGH_SAVE_ERROR", message: error.message });
  }
});

router.get("/smtp", requireAuth, requirePermission('settings:view', 'settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const config = SmtpConfigService.getPublicConfig(companyId);
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: "SMTP_LOAD_ERROR", message: error.message || "Failed to load SMTP settings." });
  }
});

router.post("/smtp", requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const userId = req.user!.id;
    const saved = SmtpConfigService.saveConfig(companyId, req.body || {}, userId);
    await AuditService.log({
      companyId,
      userId,
      action: "SETTINGS_SMTP_UPDATED",
      entityType: "COMPANY_SETTINGS",
      entityId: companyId,
      afterData: {
        host: saved.host,
        port: saved.port,
        user: saved.user,
        ssl: saved.ssl,
        sender: saved.sender,
        configured: saved.configured,
      },
      ipAddress: req.ip,
    });
    res.json({ success: true, message: "SMTP configuration saved securely to company database.", config: saved });
  } catch (error: any) {
    const status = error.message?.includes("required") || error.message?.includes("invalid") || error.message?.includes("Port") ? 400 : 500;
    res.status(status).json({ error: "SMTP_SAVE_ERROR", message: error.message || "Failed to save SMTP settings." });
  }
});

router.post("/test-smtp", requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { host, port, user, pass, ssl, sender, subjectTemplate, bodyTemplate } = req.body || {};

    const saved = !pass ? SmtpConfigService.getTransportConfig(companyId) : null;
    const resolvedPass = pass || saved?.pass || "";
    const resolvedHost = host || saved?.host || "";
    const resolvedPort = parseInt(String(port || saved?.port || 587), 10);
    const resolvedUser = user || saved?.user || "";
    const resolvedSsl = typeof ssl === "boolean" ? ssl : Boolean(saved?.ssl);
    const resolvedSender = sender || saved?.sender || resolvedUser;

    if (!resolvedHost || !resolvedPort || !resolvedUser || !resolvedPass) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Missing required SMTP details or saved password." });
    }

    const transporter = SmtpConfigService.createTransporter({
      host: resolvedHost,
      port: resolvedPort,
      user: resolvedUser,
      pass: resolvedPass,
      ssl: resolvedSsl,
    });

    await transporter.verify();

    const timestamp = new Date().toLocaleString();
    const status = "SUCCESS (Test)";
    const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const parsedSubject = subjectTemplate
      ? String(subjectTemplate).replace(/\{\{TIMESTAMP\}\}/g, timestamp).replace(/\{\{STATUS\}\}/g, status)
      : "LedgerAI PH SMTP Connection Test";

    const parsedBody = bodyTemplate
      ? String(bodyTemplate).replace(/\{\{TIMESTAMP\}\}/g, timestamp).replace(/\{\{STATUS\}\}/g, status)
      : "This is a test email to verify your SMTP settings in LedgerAI PH. The connection is working correctly.";

    await transporter.sendMail({
      from: resolvedSender,
      to: resolvedSender,
      subject: parsedSubject,
      text: parsedBody,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4f46e5;">${escapeHtml(parsedSubject)}</h2>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; white-space: pre-wrap; font-family: monospace;">
${escapeHtml(parsedBody)}
          </div>
          <p style="margin-top: 20px; font-size: 12px; color: #64748b;">
            This is an automated test from your LedgerAI PH Notification Template Settings.
          </p>
        </div>
      `,
    });

    res.json({ success: true, message: "SMTP connection verified and test email sent successfully." });
  } catch (error: any) {
    console.error("SMTP Test Error:", error);
    res.status(500).json({
      error: "SMTP_ERROR",
      message: error.message || "Failed to connect to the SMTP server.",
    });
  }
});

export default router;
