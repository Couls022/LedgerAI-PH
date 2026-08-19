import { Router } from "express";
import { requireAuth, requirePermission } from "../auth";
import nodemailer from "nodemailer";

const router = Router();

router.post("/test-smtp", requireAuth, requirePermission('settings:manage'), async (req, res) => {
  try {
    const { host, port, user, pass, ssl, sender, subjectTemplate, bodyTemplate } = req.body;

    if (!host || !port || !user || !pass) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Missing required SMTP details." });
    }

    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port, 10),
      secure: ssl === true || parseInt(port, 10) === 465,
      auth: {
        user: user,
        pass: pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify connection configuration
    await transporter.verify();

    // Use test data to render templates
    const timestamp = new Date().toLocaleString();
    const status = "SUCCESS (Test)";
    
    const parsedSubject = subjectTemplate 
      ? subjectTemplate.replace(/\{\{TIMESTAMP\}\}/g, timestamp).replace(/\{\{STATUS\}\}/g, status)
      : "LedgerAI SMTP Connection Test";
      
    const parsedBody = bodyTemplate
      ? bodyTemplate.replace(/\{\{TIMESTAMP\}\}/g, timestamp).replace(/\{\{STATUS\}\}/g, status)
      : "This is a test email to verify your SMTP settings in LedgerAI. The connection is working correctly.";

    // Send a test email to the configured sender (or the authenticated user's email if we had it, we'll use sender for test)
    const mailOptions = {
      from: sender || user,
      to: sender || user,
      subject: parsedSubject,
      text: parsedBody,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4f46e5;">${parsedSubject}</h2>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; white-space: pre-wrap; font-family: monospace;">
${parsedBody}
          </div>
          <p style="margin-top: 20px; font-size: 12px; color: #64748b;">
            This is an automated test from your LedgerAI Notification Template Settings.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: "SMTP connection successful and test email sent." });
  } catch (error: any) {
    console.error("SMTP Test Error:", error);
    res.status(500).json({ 
      error: "SMTP_ERROR", 
      message: error.message || "Failed to connect to the SMTP server." 
    });
  }
});

export default router;
