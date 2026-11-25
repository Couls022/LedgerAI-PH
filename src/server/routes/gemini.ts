import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission, normalizeRole } from "../auth";
import { eq } from "drizzle-orm";
import { EnterpriseAiAgentService } from "../services/enterpriseAiAgentService";

const router = Router();

router.post("/financial-insight", requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const companyRow = await db
      .select({ legalName: schema.companies.legalName, tradeName: schema.companies.tradeName })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .get();
    const companyName = companyRow?.tradeName || companyRow?.legalName || (req.activeCompany as any)?.name || "Active Company";
    const { prompt, chatHistory = [], currentPath, dateRangeFilter } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "Prompt string is required" });
      return;
    }

    const user = req.user!;
    const userRoles: string[] = (req as any).roles || ((user as any)?.role ? [(user as any).role] : []);
    const roleName = userRoles[0] || (user as any)?.role || 'Viewer';
    const isCompanyOwner = userRoles.some(
      (r) => r === 'Company Owner' || normalizeRole(r) === 'Company Owner'
    );
    const permissions: string[] = isCompanyOwner
      ? Array.from(new Set(['*', ...((req as any).permissions || [])]))
      : ((req as any).permissions || []);
    const deniedPermissions: string[] = isCompanyOwner
      ? []
      : ((req as any).deniedPermissions || []);

    const inquiryResult = await EnterpriseAiAgentService.executeInquiry({
      companyId,
      companyName,
      userId: user.id,
      userRole: roleName,
      permissions,
      deniedPermissions,
      prompt,
      history: Array.isArray(chatHistory)
        ? chatHistory.map((m: any) => ({ sender: String(m.role || m.sender || 'user'), text: String(m.content || m.text || '') }))
        : undefined,
      activePath: typeof currentPath === 'string' ? currentPath : undefined,
      dateRangeFilter: dateRangeFilter || undefined,
    });

    res.json({
      answer: inquiryResult.answer,
      citations: inquiryResult.citations,
      provenance: inquiryResult.provenance,
      authoritativeSource: inquiryResult.authoritativeSource,
    });
  } catch (error: any) {
    console.error("Gemini financial insight error:", error);
    res.status(500).json({
      error: "AI_PROCESSING_ERROR",
      message: error?.message || "Unable to complete AI analysis."
    });
  }
});

router.post("/parse-receipt", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { imageBase64, mimeType = "image/jpeg" } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "imageBase64 string is required" });
      return;
    }

    const { OCRService } = await import("../services/ocrService");
    const extractedData = await OCRService.parseReceipt(imageBase64, mimeType);
    const validationResult = await OCRService.validateExtractedData(companyId, extractedData);

    res.json({
      success: true,
      extractedData,
      validationResult,
      source: "ledgerai-ocr-engine"
    });
  } catch (error: any) {
    console.error("Receipt parsing error:", error);
    res.status(500).json({
      error: "RECEIPT_PARSE_ERROR",
      message: error.message || "Failed to process receipt image"
    });
  }
});

export default router;
