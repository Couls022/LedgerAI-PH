import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requireMinRole, requirePermission } from "../auth";
import { eq, desc, and } from "drizzle-orm";
import crypto from "crypto";
import os from "os";
import { verifyLicense, extractAndValidateLicense, parseAndVerifyToken } from "../licensing/verify";
import { broadcastAuthorityEvent } from "../ws";
import { AntiRollbackService } from "../services/antiRollbackService";

const router = Router();


// --- PRODUCTION CLIENT LICENSING STATUS AND ACTIVATION ---
router.get(["/licensing/status", "/licenses/status"], requireAuth, async (req, res) => {
  const companyId = req.activeCompany?.id;
  if (!companyId) {
    res.json({ status: 'NOT ACTIVATED', activePlan: 'TRIAL' });
    return;
  }

  try {
    let license = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();
    
    // If no license exists yet, create 7-day automatic trial
    if (!license) {
      const startDate = new Date().toISOString().slice(0, 10);
      const expDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const key = `LEDGERAI-TRIAL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const signedContent = crypto.createHash('sha256').update(key + companyId + expDate).digest('hex');

      await db.insert(schema.companyLicenses).values({
        id: crypto.randomUUID(),
        companyId,
        licenseKey: key,
        planType: 'TRIAL',
        status: 'ACTIVE',
        trialStartDate: startDate,
        expirationDate: expDate,
        signedFileContent: signedContent,
        isLifetime: false
      });

      await db.insert(schema.licenseAuditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        action: 'ACTIVATED',
        details: `Automatic 7-day trial activated for company ${companyId}`
      });

      license = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();
    }

    // Anti-Rollback clock integrity check
    const clockCheck = await AntiRollbackService.verifyClock(companyId);
    if (!clockCheck.valid) {
      if (license && license.status !== 'TAMPERED') {
        try {
          await db.update(schema.companyLicenses)
            .set({ status: 'TAMPERED', updatedAt: new Date() })
            .where(eq(schema.companyLicenses.companyId, companyId));
        } catch {
          // ignore
        }
      }
      if (license) {
        license = { 
          ...license, 
          status: 'TAMPERED' as any,
          clockRollbackDetected: true,
          clockRollbackMessage: clockCheck.message
        } as any;
      }
    }

    if (license && license.status === 'ACTIVE' && license.signedFileContent) {
      try {
        const parsed = JSON.parse(license.signedFileContent);
        if (parsed && parsed.payload && parsed.signature) {
          const isValid = verifyLicense(parsed.payload, parsed.signature);
          if (!isValid) {
            license = { ...license, status: 'EXPIRED' };
          } else if (parsed.payload.companyId !== companyId) {
            license = { ...license, status: 'EXPIRED' };
          }
        }
      } catch (e) {
        // Ignored for raw/trial content
      }
    }

    if (license && license.status === 'ACTIVE' && license.deviceBindingHash) {
      const currentDeviceHash = req.headers['user-agent'] ? crypto.createHash('md5').update(req.headers['user-agent'] as string).digest('hex') : null;
      if (currentDeviceHash && license.deviceBindingHash !== currentDeviceHash) {
        license = { ...license, status: 'EXPIRED', needsReactivation: true };
      }
    }

    const effectiveNow = Math.max(Date.now(), clockCheck.lastKnownTime);
    if (license && license.status === 'ACTIVE' && !license.isLifetime && license.expirationDate && license.expirationDate !== 'LIFETIME') {
      if (new Date(license.expirationDate).getTime() < effectiveNow) {
        license = { ...license, status: 'EXPIRED' };
      }
    }

    if (license && license.status === 'ACTIVE') {
      await AntiRollbackService.advanceTimeIfValid(companyId);
    }

    res.json(license);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export official client license request artifact (.lrq)
router.get("/licensing/request", requireAuth, async (req, res) => {
  const activeCompany = req.activeCompany;
  if (!activeCompany || !activeCompany.id) {
    res.status(400).json({ error: "No active company selected." });
    return;
  }

  try {
    const companyRecord = await db.select().from(schema.companies).where(eq(schema.companies.id, activeCompany.id)).get();
    const legalName = companyRecord?.legalName || 'Active Workspace';
    const tin = companyRecord?.tin || 'N/A';
    const installationId = `LGR-INST-${crypto.createHash('md5').update(activeCompany.id + tin).digest('hex').substring(0, 8).toUpperCase()}`;
    const requestedPlan = req.query.plan === 'ENTERPRISE' ? 'ENTERPRISE' : 'PRO';

    const lrqPayload = {
      requestType: "LEDGERAI_LICENSE_REQUEST",
      version: 1,
      companyId: activeCompany.id,
      companyName: legalName,
      tin,
      requestedPlan,
      installationId,
      timestamp: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="LedgerAI-License-Request.lrq"');
    res.json(lrqPayload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post(["/licensing/activate", "/licenses/activate"], requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { activationKey, licenseFile } = req.body;

  try {
    if (!activationKey && !licenseFile) {
      res.status(400).json({ error: "Please provide either an Activation Key or upload a .lai License File." });
      return;
    }

    // 1. Extract and validate cryptographic payload and signature
    const result = extractAndValidateLicense({ activationKey, licenseFile });
    if (!result.valid || !result.payload || !result.signature) {
      res.status(403).json({ error: result.error || "Cryptographic validation failed. The license is invalid or has been tampered with." });
      return;
    }

    const payload = result.payload;
    const signature = result.signature;
    const effectiveKey = result.keyString || activationKey || payload.activationKey || 'LGR-ACTIVATED';
    const effectiveFileContent = licenseFile || JSON.stringify({ payload, signature }, null, 2);
    
    // 2. Verify it's bound to THIS company ID
    if (payload.companyId !== companyId) {
      res.status(403).json({ error: `License is bound to a different Company ID (${payload.companyId}). Active company is (${companyId}).` });
      return;
    }

    // 3. Verify Product ID if specified
    if (payload.productId && payload.productId !== 'LEDGERAI-PH' && payload.productId !== 'LEDGERAI') {
      res.status(403).json({ error: `Invalid Product ID (${payload.productId}). Expected LEDGERAI-PH.` });
      return;
    }

    // 4. Verify Client License Plan is ONLY PRO or ENTERPRISE
    const validPlans = ['PRO', 'ENTERPRISE'];
    const planToSave = validPlans.includes(payload.planType) ? payload.planType : null;
    if (!planToSave) {
      res.status(403).json({ error: `Invalid plan type '${payload.planType}'. Client license plans must be strictly Pro or Enterprise.` });
      return;
    }
    
    // 5. Verify system clock anti-rollback and expiration
    const clockCheck = await AntiRollbackService.verifyClock(companyId);
    if (!clockCheck.valid && clockCheck.code === 'CLOCK_ROLLBACK_DETECTED') {
      res.status(403).json({ error: clockCheck.message || "Cannot activate license: Unauthorized system clock rollback detected." });
      return;
    }

    const effectiveNow = Math.max(Date.now(), clockCheck.lastKnownTime);
    const isLifetime = payload.type === 'LIFETIME' || payload.isLifetime === true;
    if (!isLifetime && payload.expirationDate && payload.expirationDate !== 'LIFETIME' && new Date(payload.expirationDate).getTime() < effectiveNow) {
      res.status(403).json({ error: `This license has expired on ${payload.expirationDate}.` });
      return;
    }

    // 6. Verify revocation state
    const existing = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();
    if (existing && existing.status === 'REVOKED') {
      res.status(403).json({ error: "This company license has been revoked and cannot be activated." });
      return;
    }

    const deviceBindingHash = payload.deviceBindingHash || (req.headers['user-agent'] ? crypto.createHash('md5').update(req.headers['user-agent'] as string).digest('hex') : null);

    // Update or insert
    if (existing) {
      await db.update(schema.companyLicenses).set({
        licenseKey: effectiveKey,
        planType: planToSave,
        status: 'ACTIVE',
        expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
        signedFileContent: effectiveFileContent,
        isLifetime,
        deviceBindingHash,
        updatedAt: new Date()
      }).where(eq(schema.companyLicenses.companyId, companyId));
    } else {
      await db.insert(schema.companyLicenses).values({
        id: payload.licenseId || crypto.randomUUID(),
        companyId,
        licenseKey: effectiveKey,
        planType: planToSave,
        status: 'ACTIVE',
        trialStartDate: payload.issuedAt ? payload.issuedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
        expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
        signedFileContent: effectiveFileContent,
        isLifetime,
        deviceBindingHash
      });
    }

    await db.insert(schema.licenseAuditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      action: 'ACTIVATED',
      details: `License key (${planToSave}) activated successfully via cryptographic offline validation.`
    });

    broadcastAuthorityEvent({
      type: 'LICENSE_ACTIVATED',
      action: 'ACTIVATED',
      companyId,
      licenseKey: effectiveKey,
      planType: planToSave
    });

    res.json({ 
      success: true, 
      message: `License (${planToSave}) activated successfully. Full functionality enabled.`,
      planType: planToSave,
      isLifetime,
      expirationDate: isLifetime ? 'LIFETIME' : payload.expirationDate
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// --- MULTI-USER LOCAL SERVER & RECORD LOCKING ---
router.get("/lan/server-info", requireAuth, requirePermission('lan:view'), async (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const lanIps: { name: string; address: string; family: string; internal: boolean }[] = [];
    
    for (const [name, netList] of Object.entries(interfaces)) {
      if (netList) {
        for (const net of netList) {
          if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('127.')) {
            lanIps.push({ name, address: net.address, family: net.family, internal: net.internal });
          }
        }
      }
    }

    const primaryIp = lanIps.length > 0 ? lanIps[0].address : '127.0.0.1';

    res.json({
      hostname: os.hostname(),
      primaryIp,
      lanIps,
      domain: 'ledgerai.ph',
      port: 80,
      internalPort: 3000,
      dnsRecordGuide: {
        host: 'ledgerai.ph',
        type: 'A',
        value: primaryIp
      },
      clientSetupCommand: `.\\configure-lan-client.ps1 -ServerIp ${primaryIp}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/lan/sessions", requireAuth, requirePermission('lan:view'), async (req, res) => {
  const companyId = req.activeCompany?.id;
  if (!companyId) {
    res.json([]);
    return;
  }
  try {
    const sessions = await db.select().from(schema.lanServerSessions).where(eq(schema.lanServerSessions.companyId, companyId));
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/lan/sessions/:id", requireAuth, requirePermission('lan:sessions:terminate'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    await db.delete(schema.lanServerSessions).where(and(
      eq(schema.lanServerSessions.id, req.params.id),
      eq(schema.lanServerSessions.companyId, companyId)
    ));
    res.json({ success: true, message: "Session forcibly terminated." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lan/lock-record", requireAuth, requirePermission('lan:lock'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { tableName, recordId } = req.body;

  try {
    const existing = await db.select().from(schema.recordLocks).where(and(
      eq(schema.recordLocks.companyId, companyId),
      eq(schema.recordLocks.tableName, tableName),
      eq(schema.recordLocks.recordId, recordId)
    )).get();

    if (existing && existing.lockedByUserId !== userId && existing.expiresAt > new Date()) {
      res.status(409).json({ error: "Optimistic Concurrency Conflict: Record is currently locked by another active user session." });
      return;
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
    if (existing) {
      await db.update(schema.recordLocks).set({ lockedByUserId: userId, expiresAt }).where(eq(schema.recordLocks.id, existing.id));
    } else {
      await db.insert(schema.recordLocks).values({
        id: crypto.randomUUID(),
        companyId,
        tableName,
        recordId,
        lockedByUserId: userId,
        expiresAt
      });
    }

    res.json({ success: true, message: "Record locked successfully for exclusive editing." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT FINDINGS & ADJUSTMENTS API ---
router.get("/audit/findings", requireAuth, async (req, res) => {
  try {
    const findings = await db.select().from(schema.auditFindings).orderBy(desc(schema.auditFindings.createdAt));
    res.json(findings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/findings", requireAuth, async (req, res) => {
  const { title, condition, criteria, cause, effect, riskRating, recommendation } = req.body;
  try {
    const id = crypto.randomUUID();
    const firstEngagement = await db.select().from(schema.auditEngagements).limit(1).get();
    await db.insert(schema.auditFindings).values({
      id,
      engagementId: firstEngagement ? firstEngagement.id : null,
      title: title || 'Audit Finding',
      condition: condition || '',
      criteria: criteria || '',
      cause: cause || '',
      effect: effect || '',
      riskRating: riskRating || 'MEDIUM',
      recommendation: recommendation || '',
      status: 'OPEN'
    });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/findings/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body;
  try {
    await db.update(schema.auditFindings).set({ status }).where(eq(schema.auditFindings.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/audit/adjustments", requireAuth, async (req, res) => {
  try {
    const adjustments = await db.select().from(schema.auditAdjustments).orderBy(desc(schema.auditAdjustments.createdAt));
    res.json(adjustments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/adjustments", requireAuth, async (req, res) => {
  const { description, accountCode, debitAmount, creditAmount, workflowStatus, reason } = req.body;
  try {
    const id = crypto.randomUUID();
    const firstEngagement = await db.select().from(schema.auditEngagements).limit(1).get();
    const affectedAccounts = JSON.stringify([{ accountCode: accountCode || '1000', debit: Number(debitAmount) || 0, credit: Number(creditAmount) || 0 }]);
    await db.insert(schema.auditAdjustments).values({
      id,
      engagementId: firstEngagement ? firstEngagement.id : null,
      adjustmentType: workflowStatus || 'PROPOSED',
      classification: 'FSD',
      affectedAccountsJson: affectedAccounts,
      financialEffect: description || 'Audit Adjustment',
      managementResponse: reason || ''
    });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/adjustments/:id/workflow", requireAuth, async (req, res) => {
  const { workflowStatus } = req.body;
  try {
    await db.update(schema.auditAdjustments).set({ adjustmentType: workflowStatus }).where(eq(schema.auditAdjustments.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- APPROVAL WORKFLOW API ---
router.get("/approval/requests", requireAuth, async (req, res) => {
  const companyId = req.activeCompany?.id;
  if (!companyId) {
    res.json([]);
    return;
  }
  try {
    const requests = await db.select().from(schema.approvalWorkflowRequests).where(eq(schema.approvalWorkflowRequests.companyId, companyId)).orderBy(desc(schema.approvalWorkflowRequests.createdAt));
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/approval/requests", requireAuth, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { actionType, amountPHP, details } = req.body;
  try {
    const id = crypto.randomUUID();
    await db.insert(schema.approvalWorkflowRequests).values({
      id,
      companyId,
      actionType: actionType || 'SENSITIVE_ACTION',
      amountPHP: Number(amountPHP) || 0,
      makerUserId: userId,
      status: 'PENDING',
      details: details || 'Requires maker-checker 4-eyes approval'
    });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/approval/requests/:id/action", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { status } = req.body;
  try {
    await db.update(schema.approvalWorkflowRequests).set({
      checkerUserId: userId,
      status: status || 'APPROVED'
    }).where(eq(schema.approvalWorkflowRequests.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT WORKPAPERS API ---
router.get("/audit/workpapers", requireAuth, async (req, res) => {
  try {
    const workpapers = await db.select().from(schema.auditWorkpapers).orderBy(desc(schema.auditWorkpapers.createdAt));
    res.json(workpapers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/workpapers", requireAuth, async (req, res) => {
  const { title, referenceCode, category, preparedBy, notes, evidenceUrl } = req.body;
  try {
    const id = crypto.randomUUID();
    const firstEngagement = await db.select().from(schema.auditEngagements).limit(1).get();
    await db.insert(schema.auditWorkpapers).values({
      id,
      engagementId: firstEngagement ? firstEngagement.id : 'default-engagement',
      wpRef: referenceCode || 'A-1',
      title: title || 'Audit Working Paper',
      objective: category || 'Lead Schedule',
      procedure: notes || '',
      evidenceLinks: evidenceUrl ? JSON.stringify([evidenceUrl]) : JSON.stringify([]),
      status: 'DRAFT',
      reviewNotes: preparedBy ? `Prepared by: ${preparedBy}` : 'Prepared by Junior Auditor'
    });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/workpapers/:id/signoff", requireAuth, async (req, res) => {
  const { signOffStatus, reviewedBy, approvedBy, tickMarksJson, notes, evidenceUrl } = req.body;
  try {
    const updateData: any = {};
    if (signOffStatus) updateData.status = signOffStatus;
    if (notes !== undefined) updateData.procedure = notes;
    if (evidenceUrl !== undefined) {
      updateData.evidenceLinks = JSON.stringify([evidenceUrl]);
    }
    if (reviewedBy || approvedBy) {
      updateData.reviewNotes = `Reviewed: ${reviewedBy || 'N/A'}, Approved: ${approvedBy || 'N/A'}`;
    }

    await db.update(schema.auditWorkpapers).set(updateData).where(eq(schema.auditWorkpapers.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
