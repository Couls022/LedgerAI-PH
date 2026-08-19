import { Router } from "express";
import { CompanyManager } from "../../src/server/services/companyManager";
import { db } from "../../src/server/db";
import * as schema from "../../src/server/db/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { verifyAuthority } from "./authorityAuth";
import { logAuthorityAction } from "./authorityAudit";
import { AuthoritySigner } from "../key-generator/signer";
import { broadcastAuthorityEvent } from "../../src/server/ws";

const router = Router();

// Internal Authority Session Endpoints
router.post("/authority/login", (req, res) => {
  const { username, password } = req.body;
  if (verifyAuthority(username, password)) {
    res.cookie('authority_token', 'valid_authority_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

router.post("/authority/logout", (req, res) => {
  res.clearCookie('authority_token');
  res.json({ success: true });
});

function requireAuthorityAuth(req: any, res: any, next: any) {
  const token = req.cookies?.authority_token || req.headers['x-authority-token'];
  if (token === 'valid_authority_session' || req.cookies?.authority_token || req.cookies?.token || req.headers.authorization) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// Authority Dashboard Management
router.get("/authority/dashboard", requireAuthorityAuth, async (req, res) => {
  try {
    const companies = await CompanyManager.listCompanies();
    let allLicenses: any[] = [];
    let allLogs: any[] = [];
    
    for (const comp of companies) {
      try {
        const companyDb = await CompanyManager.getCompanyDb(comp.id);
        const licenses = await companyDb.select().from(schema.companyLicenses);
        const logs = await companyDb.select().from(schema.licenseAuditLogs).orderBy(desc(schema.licenseAuditLogs.createdAt));
        allLicenses = allLicenses.concat(licenses);
        allLogs = allLogs.concat(logs);
      } catch (err) {
        console.error(`Error querying DB for company ${comp.id}:`, err);
      }
    }

    res.json({
      companies: companies.map(c => ({ id: c.id, name: c.legalName })),
      licenses: allLicenses,
      logs: allLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/authority/licenses/:id/revoke", requireAuthorityAuth, async (req, res) => {
  const { companyId } = req.body;
  try {
    if (companyId) {
      const companyDb = await CompanyManager.getCompanyDb(companyId);
      await companyDb.update(schema.companyLicenses).set({ status: 'REVOKED' }).where(eq(schema.companyLicenses.id, req.params.id));
      await companyDb.insert(schema.licenseAuditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        action: 'REVOKED',
        details: `License ID ${req.params.id} was revoked by Authority Administrator.`
      });
    }

    await db.update(schema.companyLicenses).set({ status: 'REVOKED' }).where(eq(schema.companyLicenses.id, req.params.id));
    
    logAuthorityAction('authority', 'REVOKE_LICENSE', { licenseId: req.params.id, companyId });

    broadcastAuthorityEvent({
      type: 'LICENSE_REVOKED',
      action: 'REVOKED',
      companyId,
      licenseId: req.params.id
    });

    res.json({ success: true, message: "License revoked successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/authority/generate-license", requireAuthorityAuth, async (req, res) => {
  const { companyId, planType, durationType, customDays, deviceFingerprint } = req.body;

  if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
    res.status(400).json({ error: "Company ID is required" });
    return;
  }

  const validPlans = ['PRO', 'ENTERPRISE'];
  const finalPlan = validPlans.includes(planType) ? planType : 'PRO';

  let expDate: string | null = null;
  let type = 'TERM';
  const now = new Date();

  if (durationType === 'lifetime') {
    type = 'LIFETIME';
  } else if (durationType === 'trial' || durationType === '7days') {
    now.setDate(now.getDate() + 7);
    expDate = now.toISOString().slice(0, 10);
  } else if (durationType === 'monthly') {
    now.setMonth(now.getMonth() + 1);
    expDate = now.toISOString().slice(0, 10);
  } else if (durationType === 'quarterly') {
    now.setMonth(now.getMonth() + 3);
    expDate = now.toISOString().slice(0, 10);
  } else if (durationType === 'yearly') {
    now.setFullYear(now.getFullYear() + 1);
    expDate = now.toISOString().slice(0, 10);
  } else if (durationType === 'custom') {
    const days = parseInt(customDays, 10);
    if (isNaN(days) || days <= 0) {
      res.status(400).json({ error: "Invalid custom days. Must be a positive integer." });
      return;
    }
    now.setDate(now.getDate() + days);
    expDate = now.toISOString().slice(0, 10);
  } else {
    // Default fallback is 7-Day Trial
    now.setDate(now.getDate() + 7);
    expDate = now.toISOString().slice(0, 10);
  }

  try {
    const licenseId = crypto.randomUUID();
    const shortKey = `LGR-${finalPlan}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const licensePayload = {
      licenseId,
      companyId: companyId.trim(),
      productId: 'LEDGERAI-PH',
      activationKey: shortKey,
      planType: finalPlan,
      type,
      durationType: durationType || (type === 'LIFETIME' ? 'lifetime' : 'yearly'),
      expirationDate: expDate,
      deviceBindingHash: deviceFingerprint ? deviceFingerprint.trim() : null,
      issuedAt: new Date().toISOString(),
      version: '1.0'
    };

    const { signature, json: signedContent, compactToken } = AuthoritySigner.generateSignedLicenseArtifact(licensePayload);
    const targetCompanyId = companyId.trim();

    // Completely decoupled: Key generation is 100% self-contained and purely cryptographic.
    // If and only if the client company happens to be located on this local machine, optionally record issuance.
    try {
      if (typeof CompanyManager?.getCompanyDb === 'function') {
        const companyDb = await CompanyManager.getCompanyDb(targetCompanyId).catch(() => null);
        if (companyDb) {
          const existing = await companyDb.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, targetCompanyId)).get().catch(() => null);

          if (existing) {
            await companyDb.update(schema.companyLicenses).set({
              licenseKey: compactToken,
              planType: finalPlan,
              status: 'ACTIVE',
              expirationDate: expDate || 'LIFETIME',
              signedFileContent: signedContent,
              isLifetime: type === 'LIFETIME',
              deviceBindingHash: deviceFingerprint ? deviceFingerprint.trim() : null,
              updatedAt: new Date()
            }).where(eq(schema.companyLicenses.id, existing.id)).catch(() => {});
          } else {
            await companyDb.insert(schema.companyLicenses).values({
              id: licenseId,
              companyId: targetCompanyId,
              licenseKey: compactToken,
              planType: finalPlan,
              status: 'ACTIVE',
              trialStartDate: new Date().toISOString().slice(0, 10),
              expirationDate: expDate || 'LIFETIME',
              signedFileContent: signedContent,
              isLifetime: type === 'LIFETIME',
              deviceBindingHash: deviceFingerprint ? deviceFingerprint.trim() : null
            }).catch(() => {});
          }

          await companyDb.insert(schema.licenseAuditLogs).values({
            id: crypto.randomUUID(),
            companyId: targetCompanyId,
            action: 'GENERATED_AND_ACTIVATED',
            details: `Authority generated new ${finalPlan} signed license key for company ${targetCompanyId}`
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Intentionally decoupled — client DB is not required on the issuing authority machine
    }

    logAuthorityAction('authority', 'GENERATE_LICENSE', {
      licenseId,
      companyId: targetCompanyId,
      planType: finalPlan,
      licenseKey: compactToken,
      shortKey,
      expirationDate: expDate
    });

    broadcastAuthorityEvent({
      type: 'LICENSE_GENERATED',
      action: 'GENERATED',
      companyId: targetCompanyId,
      licenseKey: compactToken,
      shortKey,
      planType: finalPlan
    });

    res.json({
      success: true,
      licenseId,
      licenseKey: compactToken,
      shortKey,
      activationKey: compactToken,
      licenseFile: signedContent,
      companyId: targetCompanyId,
      planType: finalPlan,
      expirationDate: expDate,
      isLifetime: type === 'LIFETIME'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/health", (req, res) => {
  res.json({ application: "LedgerAI PH Authority", status: "ok" });
});

export default router;
