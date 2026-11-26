import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requireMinRole, requirePermission, requireApprovalRole } from "../auth";
import { eq, desc, and, inArray, sql, lt } from "drizzle-orm";
import crypto from "crypto";
import os from "os";
import { verifyLicense, extractAndValidateLicense, validateLicenseFilePair } from "../licensing/verify";
import { LocalLicenseRegistry } from "../licensing/localLicenseRegistry";
import { broadcastAuthorityEvent } from "../ws";
import { AntiRollbackService } from "../services/antiRollbackService";
import { AuditService } from "../services/auditService";
import { ServerTelemetryService } from "../services/serverTelemetryService";
import { AuthorityHeartbeatClient } from "../services/authorityHeartbeatClient";
import { validateWorkpaperSignOff } from "../utils/requestPath";

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
    
    // If no license exists yet, create 15-day automatic trial
    if (!license) {
      const startDate = new Date().toISOString().slice(0, 10);
      const expDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
        details: `Automatic 15-day trial activated for company ${companyId}`
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

    const isTrial =
      !license ||
      (license.planType === 'TRIAL' &&
        (license.licenseKey?.startsWith('LEDGERAI-TRIAL-') || license.licenseKey?.startsWith('LIC-TRIAL-')));

    let registryVerificationError: string | null = null;
    let registryVerificationCode: string | null = null;
    let recoveryRequired = false;

    if (license && !isTrial && license.status !== 'TAMPERED') {
      const regCheck = LocalLicenseRegistry.verifyCompanyActivationAgainstRegistry({
        companyId,
        dbLicense: license,
      });
      if (!regCheck.valid) {
        registryVerificationError = regCheck.error || 'License activation verification failed.';
        registryVerificationCode = regCheck.code;
        if (regCheck.code === 'LICENSE_REVOKED') {
          license = { ...license, status: 'REVOKED' };
        } else if (regCheck.code === 'LICENSE_SUSPENDED') {
          license = { ...license, status: 'SUSPENDED' };
        } else {
          recoveryRequired = true;
          license = { ...license, status: 'RECOVERY_REQUIRED' };
        }
      }
    }

    if (license && license.status === 'ACTIVE' && license.signedFileContent && !isTrial) {
      try {
        const parsed = JSON.parse(license.signedFileContent);
        if (parsed && parsed.payload && parsed.signature) {
          const isValid = verifyLicense(parsed.payload, parsed.signature);
          if (!isValid || parsed.payload.companyId !== companyId) {
            recoveryRequired = true;
            registryVerificationCode = !isValid ? 'INVALID_SIGNATURE' : 'COMPANY_IDENTITY_MISMATCH';
            registryVerificationError = !isValid
              ? 'Cryptographic signature verification failed.'
              : 'Company ID mismatch in license record.';
            license = { ...license, status: 'RECOVERY_REQUIRED' };
          }
        }
      } catch {
        recoveryRequired = true;
        registryVerificationCode = 'CORRUPTED_ACTIVATION_METADATA';
        license = { ...license, status: 'RECOVERY_REQUIRED' };
      }
    }

    if (license && license.status === 'ACTIVE' && license.deviceBindingHash) {
      const ua = req.headers['user-agent'] as string | undefined;
      if (ua) {
        const expectedHash = license.deviceBindingHash.length === 32
          ? crypto.createHash('md5').update(ua).digest('hex')
          : crypto.createHash('sha256').update(ua).digest('hex');
        if (license.deviceBindingHash !== expectedHash) {
          license = { ...license, status: 'EXPIRED', needsReactivation: true };
        }
      }
    }

    const effectiveNow = Math.max(Date.now(), clockCheck.lastKnownTime);
    let licenseStatus = license ? license.status : 'NOT_ACTIVATED';
    let inGracePeriod = false;
    let graceDaysRemaining = 0;
    let trialDaysRemaining = 0;
    let graceExpirationDate: string | null = null;

    if (license && license.status === 'ACTIVE' && !license.isLifetime && license.expirationDate && license.expirationDate !== 'LIFETIME') {
      const expTime = new Date(license.expirationDate).getTime();
      if (isTrial) {
        const gracePeriodMs = 15 * 24 * 60 * 60 * 1000;
        const graceEndTime = expTime + gracePeriodMs;
        graceExpirationDate = new Date(graceEndTime).toISOString().slice(0, 10);

        if (effectiveNow <= expTime) {
          trialDaysRemaining = Math.max(0, Math.ceil((expTime - effectiveNow) / (24 * 60 * 60 * 1000)));
          licenseStatus = 'ACTIVE';
        } else if (effectiveNow <= graceEndTime) {
          inGracePeriod = true;
          licenseStatus = 'GRACE_PERIOD';
          graceDaysRemaining = Math.max(1, Math.ceil((graceEndTime - effectiveNow) / (24 * 60 * 60 * 1000)));
        } else {
          licenseStatus = 'EXPIRED';
        }
      } else {
        let isDualV2 = Boolean((license as any).licensePairId);
        if (!isDualV2 && license.signedFileContent) {
          try {
            const p = JSON.parse(license.signedFileContent);
            if (p?.payload?.licenseVersion === '2.0') isDualV2 = true;
          } catch {}
        }
        const graceEndTime = isDualV2 ? expTime : expTime + 15 * 24 * 60 * 60 * 1000;
        graceExpirationDate = isDualV2 ? null : new Date(graceEndTime).toISOString().slice(0, 10);

        if (effectiveNow <= expTime) {
          trialDaysRemaining = Math.max(0, Math.ceil((expTime - effectiveNow) / (24 * 60 * 60 * 1000)));
          licenseStatus = 'ACTIVE';
        } else if (!isDualV2 && effectiveNow <= graceEndTime) {
          inGracePeriod = true;
          licenseStatus = 'GRACE_PERIOD';
          graceDaysRemaining = Math.max(1, Math.ceil((graceEndTime - effectiveNow) / (24 * 60 * 60 * 1000)));
        } else {
          licenseStatus = 'EXPIRED';
        }
      }
    }

    if (license && (licenseStatus === 'ACTIVE' || licenseStatus === 'GRACE_PERIOD')) {
      await AntiRollbackService.advanceTimeIfValid(companyId);
    }

    // Sanitized authoritative status DTO (never exposes raw private keys or raw signed payloads/receipts)
    res.json({
      id: license?.id,
      companyId: license?.companyId || companyId,
      planType: license?.planType || 'TRIAL',
      licenseKey: license?.licenseKey ? `${String(license.licenseKey).slice(0, 18)}` : undefined,
      seatCount: license?.planType === 'ENTERPRISE' ? 'UNLIMITED' : (license?.seatCount || 3),
      status: licenseStatus,
      trialStartDate: license?.trialStartDate,
      expirationDate: license?.expirationDate,
      isLifetime: Boolean(license?.isLifetime),
      licensePairId: (license as any)?.licensePairId || null,
      keyFileId: (license as any)?.keyFileId || null,
      activationRecordId: (license as any)?.activationRecordId || null,
      activationTimestamp: (license as any)?.activationTimestamp || null,
      activatedBy: (license as any)?.activatedBy || null,
      revocationRef: (license as any)?.revocationRef || null,
      licenseVersion: (license as any)?.licenseVersion || '2.0',
      activationPolicy: (license as any)?.activationPolicy || 'ONE_TIME_COMPANY_BOUND',
      recoveryRequired,
      verificationCode: registryVerificationCode,
      verificationError: registryVerificationError,
      inGracePeriod,
      graceDaysRemaining,
      trialDaysRemaining,
      graceExpirationDate,
      needsReactivation: Boolean((license as any)?.needsReactivation),
      clockRollbackDetected: Boolean((license as any)?.clockRollbackDetected),
      clockRollbackMessage: (license as any)?.clockRollbackMessage || null,
    });
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
    const installationId = `LGR-INST-${crypto.createHash('sha256').update(activeCompany.id + tin).digest('hex').substring(0, 8).toUpperCase()}`;
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

router.post(["/licensing/activate", "/licenses/activate"], requireAuth, requirePermission('settings:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const actorIdentity = req.user?.email || req.user?.id || 'authorized-admin';
  const { licenseKeyFile, keyLicenseFile, recoveryReason } = req.body || {};

  try {
    // 1. Validate Anti-Rollback Clock before any activation processing
    const clockCheck = await AntiRollbackService.verifyClock(companyId);
    if (!clockCheck.valid) {
      await db.update(schema.companyLicenses)
        .set({ status: 'TAMPERED', updatedAt: new Date() })
        .where(eq(schema.companyLicenses.companyId, companyId))
        .catch(() => {});
      res.status(403).json({
        error: 'TAMPERED',
        code: clockCheck.code,
        message: clockCheck.message || "Cannot activate license: Unauthorized system clock rollback detected."
      });
      return;
    }

    // 2. Enforce Mandatory Dual-File Pairing & Signature Verification
    const pairResult = validateLicenseFilePair({
      licenseKeyFile,
      keyLicenseFile,
      expectedCompanyId: companyId,
    });

    if (!pairResult.valid || !pairResult.keyPayload || !pairResult.licensePayload || !pairResult.licenseSignature) {
      const isMissing =
        pairResult.code === 'BOTH_FILES_REQUIRED' ||
        pairResult.code === 'LICENSE_KEY_FILE_REQUIRED' ||
        pairResult.code === 'KEY_LICENSE_FILE_REQUIRED';

      await db.insert(schema.licenseAuditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        action: 'ACTIVATION_REJECTED',
        details: `Activation rejected (${pairResult.code}): ${pairResult.error}`
      }).catch(() => {});

      res.status(isMissing ? 400 : 403).json({
        error: pairResult.code,
        code: pairResult.code,
        message: pairResult.error || "Cryptographic validation failed for license pair."
      });
      return;
    }

    const payload = pairResult.licensePayload;
    const keyPayload = pairResult.keyPayload;
    const effectiveKey = pairResult.keyString || payload.activationKey;
    const effectiveFileContent = keyLicenseFile.trim();
    const effectiveKeyFileContent = licenseKeyFile.trim();

    // 3. Verify Product ID & Plan Entitlement
    if (payload.productId && payload.productId !== 'LEDGERAI-PH' && payload.productId !== 'LEDGERAI') {
      res.status(403).json({ error: 'INVALID_PRODUCT_ID', message: `Invalid Product ID (${payload.productId}). Expected LEDGERAI-PH.` });
      return;
    }

    const validPlans = ['PRO', 'ENTERPRISE'];
    const planToSave = validPlans.includes(payload.planType) ? payload.planType : null;
    if (!planToSave) {
      res.status(403).json({ error: 'INVALID_PLAN_TYPE', message: `Invalid plan type '${payload.planType}'. Must be PRO or ENTERPRISE.` });
      return;
    }

    // 4. Verify Expiration against Monotonic Watermark
    const effectiveNow = Math.max(Date.now(), clockCheck.lastKnownTime);
    const isLifetime = payload.type === 'LIFETIME' || payload.isLifetime === true || !payload.expirationDate;
    if (!isLifetime && payload.expirationDate && payload.expirationDate !== 'LIFETIME' && new Date(payload.expirationDate).getTime() < effectiveNow) {
      res.status(403).json({
        error: 'LICENSE_EXPIRED',
        code: 'LICENSE_EXPIRED',
        message: `This license pair expired on ${payload.expirationDate}.`
      });
      return;
    }

    // 5. Load Existing Company DB License Record & Guard Revoked/Tampered States
    const existing = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();
    if (existing?.status === 'TAMPERED') {
      res.status(403).json({
        error: 'TAMPERED',
        code: 'TAMPERED',
        message: "This company workspace is locked in TAMPERED state. Use authorized recovery after correcting system time integrity."
      });
      return;
    }

    if (existing?.status === 'REVOKED' && !payload.recoveryReference) {
      res.status(403).json({
        error: 'LICENSE_REVOKED',
        code: 'LICENSE_REVOKED',
        message: "This company license has been revoked and cannot be reactivated."
      });
      return;
    }

    if (existing?.status === 'SUSPENDED' && !payload.recoveryReference) {
      res.status(403).json({
        error: 'LICENSE_SUSPENDED',
        code: 'LICENSE_SUSPENDED',
        message: "This company license is currently suspended."
      });
      return;
    }

    // 6. Execute One-Time Pair Redemption in Trusted Local Licensing Registry
    const authorizedRecovery =
      payload.recoveryReference
        ? {
            recoveryReference: String(payload.recoveryReference),
            reason: recoveryReason || payload.recoveryReason || 'Authorized license recovery/replacement',
            authorizedBy: actorIdentity,
          }
        : null;

    const redemption = LocalLicenseRegistry.redeemPairForCompany({
      companyId,
      licensePairId: payload.licensePairId,
      licenseId: payload.licenseId,
      keyFileId: keyPayload.keyFileId,
      activationKey: effectiveKey,
      planType: planToSave,
      expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
      isLifetime,
      revocationRef: payload.revocationRef || `rev-${payload.licensePairId}`,
      activatedBy: actorIdentity,
      existingDbLicense: existing || null,
      authorizedRecovery,
    });

    if (!redemption.allowed || !redemption.record) {
      await db.insert(schema.licenseAuditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        action: 'REDEMPTION_DENIED',
        details: `Pair '${payload.licensePairId}' rejected (${redemption.code}): ${redemption.error}`
      }).catch(() => {});

      res.status(403).json({
        error: redemption.code,
        code: redemption.code,
        message: redemption.error || "License pair redemption rejected."
      });
      return;
    }

    // Idempotent verification of already activated matching company + pair (no duplicate activation records)
    if (redemption.idempotent) {
      res.json({
        success: true,
        idempotent: true,
        alreadyActivated: true,
        activationRecordId: redemption.record.activationRecordId,
        licensePairId: redemption.record.licensePairId,
        companyId,
        planType: planToSave,
        isLifetime,
        expirationDate: isLifetime ? 'LIFETIME' : payload.expirationDate,
        message: `License (${planToSave}) is already active and verified for this company.`,
      });
      return;
    }

    const record = redemption.record;
    const deviceBindingHash = payload.deviceBindingHash || null;

    let seatCountToSave: number | null = null;
    if (planToSave !== 'ENTERPRISE') {
      if (typeof payload.seatCount === 'number' && payload.seatCount > 0) {
        seatCountToSave = payload.seatCount;
      } else if (typeof payload.seatCount === 'string' && !isNaN(parseInt(payload.seatCount, 10)) && parseInt(payload.seatCount, 10) > 0) {
        seatCountToSave = parseInt(payload.seatCount, 10);
      } else {
        seatCountToSave = existing?.seatCount || 3;
      }
    }

    // 7. Persist Signed Activation Record, Dual-File Proofs & Receipt in Company Database
    if (existing) {
      await db.update(schema.companyLicenses).set({
        licenseKey: effectiveKey,
        planType: planToSave,
        status: 'ACTIVE',
        seatCount: seatCountToSave,
        expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
        signedFileContent: effectiveFileContent,
        keyFileContent: effectiveKeyFileContent,
        licensePairId: payload.licensePairId,
        keyFileId: keyPayload.keyFileId,
        activationRecordId: record.activationRecordId,
        activationTimestamp: record.redeemedAt,
        activatedBy: actorIdentity,
        activationReceipt: record.signedActivationReceipt,
        revocationRef: payload.revocationRef || `rev-${payload.licensePairId}`,
        licenseVersion: payload.licenseVersion || '2.0',
        activationPolicy: payload.activationPolicy || 'ONE_TIME_COMPANY_BOUND',
        recoveryReference: payload.recoveryReference || null,
        recoveryReason: authorizedRecovery?.reason || null,
        previousLicenseId: existing.id,
        replacementReason: authorizedRecovery?.reason || (existing.planType === 'TRIAL' ? 'Trial upgraded via Dual-File Activation' : null),
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
        seatCount: seatCountToSave,
        trialStartDate: payload.issuedAt ? payload.issuedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
        expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
        signedFileContent: effectiveFileContent,
        keyFileContent: effectiveKeyFileContent,
        licensePairId: payload.licensePairId,
        keyFileId: keyPayload.keyFileId,
        activationRecordId: record.activationRecordId,
        activationTimestamp: record.redeemedAt,
        activatedBy: actorIdentity,
        activationReceipt: record.signedActivationReceipt,
        revocationRef: payload.revocationRef || `rev-${payload.licensePairId}`,
        licenseVersion: payload.licenseVersion || '2.0',
        activationPolicy: payload.activationPolicy || 'ONE_TIME_COMPANY_BOUND',
        recoveryReference: payload.recoveryReference || null,
        recoveryReason: authorizedRecovery?.reason || null,
        isLifetime,
        deviceBindingHash
      });
    }

    await db.insert(schema.licenseRedemptionRecords).values({
      id: record.activationRecordId,
      companyId,
      licensePairId: payload.licensePairId,
      licenseId: payload.licenseId,
      keyFileId: keyPayload.keyFileId,
      activationKey: effectiveKey,
      planType: planToSave,
      activationStatus: 'ACTIVE',
      activatedAt: record.redeemedAt,
      activatedBy: actorIdentity,
      activationReceipt: record.signedActivationReceipt,
      recoveryReference: payload.recoveryReference || null,
      recoveryReason: authorizedRecovery?.reason || null,
    });

    await db.insert(schema.licenseAuditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      action: authorizedRecovery ? 'RECOVERED_AND_ACTIVATED' : 'ACTIVATED',
      details: `Dual-file license pair '${payload.licensePairId}' (${planToSave}) activated cleanly via one-time company-bound redemption. Activation Record: ${record.activationRecordId}`
    });

    await AntiRollbackService.advanceTimeIfValid(companyId);

    broadcastAuthorityEvent({
      type: 'LICENSE_ACTIVATED',
      action: 'ACTIVATED',
      companyId,
      licensePairId: payload.licensePairId,
      activationRecordId: record.activationRecordId,
      licenseKey: effectiveKey,
      planType: planToSave
    });

    AuthorityHeartbeatClient.pingCompany(companyId).catch(() => {});

    res.json({ 
      success: true,
      idempotent: false,
      alreadyActivated: false,
      activationRecordId: record.activationRecordId,
      licensePairId: payload.licensePairId,
      keyFileId: keyPayload.keyFileId,
      companyId,
      message: `Dual-file license pair verified and activated (${planToSave}). Full functionality enabled.`,
      planType: planToSave,
      isLifetime,
      expirationDate: isLifetime ? 'LIFETIME' : payload.expirationDate,
      activationTimestamp: record.redeemedAt
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Controlled Authorized License Recovery Endpoint
router.post(["/licensing/recover", "/licenses/recover"], requireAuth, requirePermission('settings:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const actorIdentity = req.user?.email || req.user?.id || 'authorized-admin';
  const { licenseKeyFile, keyLicenseFile, recoveryReason } = req.body || {};

  if (!recoveryReason || typeof recoveryReason !== 'string' || recoveryReason.trim().length < 5) {
    res.status(400).json({
      error: 'RECOVERY_REASON_REQUIRED',
      message: 'An explicit audit reason (min 5 characters) is required for authorized license recovery.',
    });
    return;
  }

  try {
    const pairResult = validateLicenseFilePair({
      licenseKeyFile,
      keyLicenseFile,
      expectedCompanyId: companyId,
    });

    if (!pairResult.valid || !pairResult.keyPayload || !pairResult.licensePayload) {
      res.status(403).json({
        error: pairResult.code,
        message: pairResult.error || 'Dual-file recovery artifact validation failed.',
      });
      return;
    }

    const payload = pairResult.licensePayload;
    if (!payload.recoveryReference) {
      res.status(403).json({
        error: 'AUTHORIZED_RECOVERY_REFERENCE_REQUIRED',
        message: 'Recovery requires a License Authority signed recoveryReference bound to the prior activation or company profile.',
      });
      return;
    }

    const clockCheck = await AntiRollbackService.verifyClock(companyId);
    const effectiveNow = Math.max(Date.now(), clockCheck.lastKnownTime);
    const isLifetime = payload.type === 'LIFETIME' || payload.isLifetime === true || !payload.expirationDate;
    if (!isLifetime && payload.expirationDate && payload.expirationDate !== 'LIFETIME' && new Date(payload.expirationDate).getTime() < effectiveNow) {
      res.status(403).json({
        error: 'LICENSE_EXPIRED',
        message: 'Expired licenses cannot be activated during recovery.',
      });
      return;
    }

    const existing = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();

    const redemption = LocalLicenseRegistry.redeemPairForCompany({
      companyId,
      licensePairId: payload.licensePairId,
      licenseId: payload.licenseId,
      keyFileId: pairResult.keyPayload.keyFileId,
      activationKey: payload.activationKey,
      planType: payload.planType,
      expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
      isLifetime,
      revocationRef: payload.revocationRef || `rev-${payload.licensePairId}`,
      activatedBy: actorIdentity,
      existingDbLicense: existing || null,
      authorizedRecovery: {
        recoveryReference: String(payload.recoveryReference),
        reason: recoveryReason.trim(),
        authorizedBy: actorIdentity,
      },
    });

    if (!redemption.allowed || !redemption.record) {
      res.status(403).json({
        error: redemption.code,
        message: redemption.error || 'Authorized recovery failed registry validation.',
      });
      return;
    }

    const record = redemption.record;
    const seatCountToSave = payload.planType === 'ENTERPRISE' ? null : (typeof payload.seatCount === 'number' ? payload.seatCount : 3);

    if (existing) {
      await db.update(schema.companyLicenses).set({
        licenseKey: payload.activationKey,
        planType: payload.planType,
        status: 'ACTIVE',
        seatCount: seatCountToSave,
        expirationDate: isLifetime ? 'LIFETIME' : (payload.expirationDate || 'LIFETIME'),
        signedFileContent: keyLicenseFile.trim(),
        keyFileContent: licenseKeyFile.trim(),
        licensePairId: payload.licensePairId,
        keyFileId: pairResult.keyPayload.keyFileId,
        activationRecordId: record.activationRecordId,
        activationTimestamp: record.redeemedAt,
        activatedBy: actorIdentity,
        activationReceipt: record.signedActivationReceipt,
        revocationRef: payload.revocationRef || `rev-${payload.licensePairId}`,
        recoveryReference: String(payload.recoveryReference),
        recoveryReason: recoveryReason.trim(),
        previousLicenseId: existing.id,
        replacementReason: recoveryReason.trim(),
        isLifetime,
        updatedAt: new Date(),
      }).where(eq(schema.companyLicenses.companyId, companyId));
    }

    await db.insert(schema.licenseRedemptionRecords).values({
      id: record.activationRecordId,
      companyId,
      licensePairId: payload.licensePairId,
      licenseId: payload.licenseId,
      keyFileId: pairResult.keyPayload.keyFileId,
      activationKey: payload.activationKey,
      planType: payload.planType,
      activationStatus: 'ACTIVE',
      activatedAt: record.redeemedAt,
      activatedBy: actorIdentity,
      activationReceipt: record.signedActivationReceipt,
      recoveryReference: String(payload.recoveryReference),
      recoveryReason: recoveryReason.trim(),
    });

    await db.insert(schema.licenseAuditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      action: 'AUTHORIZED_RECOVERY',
      details: `Recovered company license via Authority reference '${payload.recoveryReference}'. New Pair: '${payload.licensePairId}'. Reason: ${recoveryReason.trim()}. Operator: ${actorIdentity}`,
    });

    res.json({
      success: true,
      activationRecordId: record.activationRecordId,
      licensePairId: payload.licensePairId,
      recoveryReference: payload.recoveryReference,
      recoveryReason: recoveryReason.trim(),
      planType: payload.planType,
      message: 'Company license recovered and re-activated cleanly with full audit history.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


export type LanAddressClassification =
  | 'LOOPBACK'
  | 'LINK_LOCAL'
  | 'PRIVATE_LAN'
  | 'CGNAT'
  | 'PUBLIC'
  | 'INVALID';

export interface ClassifiedLanInterface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
  classification: LanAddressClassification;
  usableForLan: boolean;
  reason: string;
}

export function classifyIpv4Address(
  address: string,
  internal: boolean = false
): {
  classification: LanAddressClassification;
  usableForLan: boolean;
  reason: string;
} {
  const trimmed = String(address || '').trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) {
    return {
      classification: 'INVALID',
      usableForLan: false,
      reason: 'Not a valid IPv4 dotted-quad address.'
    };
  }

  const octets = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return {
      classification: 'INVALID',
      usableForLan: false,
      reason: 'IPv4 octets out of range (0-255).'
    };
  }

  const [o1, o2] = octets;

  if (internal || o1 === 127) {
    return {
      classification: 'LOOPBACK',
      usableForLan: false,
      reason: 'Loopback interface (127.0.0.0/8, RFC 5735); accessible only on the local host.'
    };
  }

  if (o1 === 169 && o2 === 254) {
    return {
      classification: 'LINK_LOCAL',
      usableForLan: false,
      reason: 'IPv4 Link-Local / APIPA address (169.254.0.0/16, RFC 3927); non-routable and excluded from LAN workstation advertisement.'
    };
  }

  if (
    o1 === 10 ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) ||
    (o1 === 192 && o2 === 168)
  ) {
    return {
      classification: 'PRIVATE_LAN',
      usableForLan: true,
      reason: 'RFC 1918 private LAN IPv4 address suitable for local multi-workstation connectivity.'
    };
  }

  if (o1 === 100 && o2 >= 64 && o2 <= 127) {
    return {
      classification: 'CGNAT',
      usableForLan: false,
      reason: 'Carrier-Grade NAT shared address space (100.64.0.0/10, RFC 6598); not a local office LAN subnet.'
    };
  }

  if (o1 === 0 || o1 >= 224) {
    return {
      classification: 'INVALID',
      usableForLan: false,
      reason: 'Reserved, unspecified, or multicast IPv4 address.'
    };
  }

  return {
    classification: 'PUBLIC',
    usableForLan: false,
    reason: 'Publicly routable IPv4 address; excluded from private LAN workstation discovery.'
  };
}

export function inspectLanNetworkInterfaces(
  interfacesMap: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
  serverPort: number = Number(process.env.PORT) || 3000
) {
  const usableLanIps: ClassifiedLanInterface[] = [];
  const excludedInterfaces: ClassifiedLanInterface[] = [];

  for (const [name, netList] of Object.entries(interfacesMap || {})) {
    if (!Array.isArray(netList)) continue;
    for (const net of netList) {
      const familyStr = String((net as any).family);
      if (familyStr !== 'IPv4' && familyStr !== '4') continue;
      const check = classifyIpv4Address(net.address, Boolean(net.internal));
      const entry: ClassifiedLanInterface = {
        name,
        address: net.address,
        family: 'IPv4',
        internal: Boolean(net.internal),
        classification: check.classification,
        usableForLan: check.usableForLan,
        reason: check.reason
      };
      if (check.usableForLan) {
        usableLanIps.push(entry);
      } else {
        excludedInterfaces.push(entry);
      }
    }
  }

  const usableLanAvailable = usableLanIps.length > 0;
  const primaryIp = usableLanAvailable ? usableLanIps[0].address : null;
  const effectiveBindAddress = primaryIp || '127.0.0.1';
  const port80ProxyActive = Boolean(process.env.LEDGERAI_PORT80_PROXY_ACTIVE === 'true' && usableLanAvailable);

  const networkDiagnosticStatus = usableLanAvailable
    ? 'USABLE_PRIVATE_LAN_DETECTED'
    : 'NO_USABLE_LAN_INTERFACE';

  const networkDiagnosticMessage = usableLanAvailable
    ? `Detected ${usableLanIps.length} usable RFC 1918 private LAN interface(s). Primary LAN address: ${primaryIp}:${serverPort}.`
    : `No usable RFC 1918 private LAN interface detected. Loopback (127.0.0.1) and link-local APIPA (169.254.x.x) interfaces are excluded from LAN advertisement. Operating in local workstation loopback mode on 127.0.0.1:${serverPort}.`;

  const configuredDomain = (process.env.LEDGERAI_LAN_HOSTNAME || 'ledgerai.local').trim().toLowerCase();
  const alternateDomain = configuredDomain === 'ledgerai-server.local' ? 'ledgerai.local' : 'ledgerai-server.local';

  return {
    hostname: os.hostname(),
    usableLanAvailable,
    primaryIp,
    effectiveBindAddress,
    lanIps: usableLanIps,
    excludedInterfaces,
    domain: configuredDomain,
    alternateDomain,
    port: port80ProxyActive ? 80 : serverPort,
    internalPort: serverPort,
    port80ProxyActive,
    localLoopbackActive: true,
    directFallbackUrl: primaryIp ? `http://${primaryIp}:${serverPort}` : `http://127.0.0.1:${serverPort}`,
    networkDiagnosticStatus,
    networkDiagnosticMessage,
    dnsRecordGuide: primaryIp
      ? {
          host: configuredDomain,
          type: 'A',
          value: primaryIp
        }
      : null,
    clientSetupCommand: primaryIp
      ? `.\\configure-lan-client.ps1 -ServerIp ${primaryIp} -Hostname ${configuredDomain}`
      : null
  };
}

// --- MULTI-USER LOCAL SERVER & RECORD LOCKING ---
router.get("/lan/server-info", requireAuth, requirePermission('lan:view'), async (_req, res) => {
  try {
    const info = inspectLanNetworkInterfaces();
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Authoritative Central Server Management Dashboard telemetry
router.get("/lan/server-dashboard", requireAuth, requirePermission('lan:view'), async (_req, res) => {
  try {
    const snapshot = await ServerTelemetryService.getServerDashboardSnapshot();
    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_DASHBOARD_ERROR', message: err?.message || 'Failed to compute server telemetry.' });
  }
});

router.get("/lan/sessions", requireAuth, requirePermission('lan:view'), async (req, res) => {
  const companyId = req.activeCompany?.id;
  if (!companyId) {
    res.json({ sessions: [], concurrency: { planType: 'PRO', maxWorkstations: 3, activeWorkstations: 0, activeIps: [], activeSessions: 0, isLimitReached: false } });
    return;
  }
  try {
    // Purge stale sessions older than 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    await db.delete(schema.lanServerSessions).where(
      and(
        eq(schema.lanServerSessions.companyId, companyId),
        lt(schema.lanServerSessions.lastActiveAt, fifteenMinutesAgo)
      )
    ).catch(() => {});

    const sessions = await db
      .select()
      .from(schema.lanServerSessions)
      .where(eq(schema.lanServerSessions.companyId, companyId));

    let lic: any = null;
    try {
      lic = db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();
    } catch {}
    const planType = (lic?.planType || 'PRO').toUpperCase();
    const distinctIps = Array.from(new Set((sessions || []).map((s) => s.clientIp || '127.0.0.1')));
    const effectiveSeatLimit = planType === 'ENTERPRISE'
      ? 'UNLIMITED'
      : (lic?.seatCount && lic.seatCount > 0 ? lic.seatCount : 3);
    const maxWorkstations = effectiveSeatLimit;
    const isLimitReached = planType !== 'ENTERPRISE' && distinctIps.length >= (typeof maxWorkstations === 'number' ? maxWorkstations : 3);

    res.json({
      sessions: Array.isArray(sessions) ? sessions : [],
      concurrency: {
        planType,
        maxWorkstations,
        activeWorkstations: distinctIps.length,
        activeIps: distinctIps,
        activeSessions: (sessions || []).length,
        isLimitReached
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'LAN_SESSIONS_QUERY_FAILED', message: err?.message || 'Failed to query LAN sessions.' });
  }
});

router.delete("/lan/sessions/:id", requireAuth, requirePermission('lan:sessions:terminate'), async (req, res) => {
  const companyId = req.activeCompany?.id;
  const userId = req.user?.id;
  const sessionId = String(req.params.id || '').trim();

  if (!companyId || !userId) {
    res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication and active company context required.' });
    return;
  }
  if (!sessionId) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Session ID is required.' });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(schema.lanServerSessions)
      .where(and(
        eq(schema.lanServerSessions.id, sessionId),
        eq(schema.lanServerSessions.companyId, companyId)
      ))
      .get();

    if (!existing) {
      res.status(404).json({
        error: 'SESSION_NOT_FOUND',
        message: 'Active LAN session not found within the current company.'
      });
      return;
    }

    await db.delete(schema.lanServerSessions).where(and(
      eq(schema.lanServerSessions.id, sessionId),
      eq(schema.lanServerSessions.companyId, companyId)
    ));

    await AuditService.log({
      companyId,
      userId,
      action: 'LAN_SESSION_TERMINATED',
      entityType: 'lan_server_session',
      entityId: sessionId,
      beforeData: {
        id: existing.id,
        companyId: existing.companyId,
        userId: existing.userId,
        clientIp: existing.clientIp
      },
      afterData: { terminated: true },
      req
    });

    res.json({ success: true, terminatedSessionId: sessionId, message: "Session forcibly terminated." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lan/lock-record", requireAuth, requirePermission('lan:lock'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const tableName = typeof req.body?.tableName === 'string' ? req.body.tableName.trim() : '';
  const recordId = typeof req.body?.recordId === 'string' ? req.body.recordId.trim() : '';

  if (!tableName || !recordId) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Both tableName and recordId must be non-empty strings.'
    });
    return;
  }

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

async function getOrCreateCompanyAuditEngagementId(companyId: string): Promise<string> {
  const existing = await db
    .select({ id: schema.auditEngagements.id })
    .from(schema.auditEngagements)
    .where(eq(schema.auditEngagements.companyId, companyId))
    .limit(1)
    .get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db.insert(schema.auditEngagements).values({
    id,
    companyId,
    clientCompanyId: companyId,
    engagementName: 'Default Company Audit Engagement',
    auditPeriod: `FY ${new Date().getFullYear()}`,
    engagementType: 'INTERNAL_AUDIT',
    status: 'PLANNING',
  });
  return id;
}

async function getCompanyEngagementIds(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.auditEngagements.id })
    .from(schema.auditEngagements)
    .where(eq(schema.auditEngagements.companyId, companyId));
  return rows.map((r) => r.id);
}

// --- AUDIT FINDINGS & ADJUSTMENTS API ---
router.get("/audit/findings", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const engagementIds = await getCompanyEngagementIds(companyId);
    if (engagementIds.length === 0) {
      res.json([]);
      return;
    }
    const findings = await db
      .select()
      .from(schema.auditFindings)
      .where(inArray(schema.auditFindings.engagementId, engagementIds))
      .orderBy(desc(schema.auditFindings.createdAt));
    res.json(findings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/findings", requireAuth, requirePermission('audit:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { title, condition, criteria, cause, effect, riskRating, recommendation } = req.body;
  try {
    const id = crypto.randomUUID();
    const engagementId = await getOrCreateCompanyAuditEngagementId(companyId);
    await db.insert(schema.auditFindings).values({
      id,
      engagementId,
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

router.post("/audit/findings/:id/status", requireAuth, requirePermission('audit:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { status } = req.body;
  try {
    const engagementIds = await getCompanyEngagementIds(companyId);
    if (engagementIds.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Audit finding not found in active company' });
      return;
    }
    const upd = await db
      .update(schema.auditFindings)
      .set({ status })
      .where(and(eq(schema.auditFindings.id, req.params.id), inArray(schema.auditFindings.engagementId, engagementIds)));
    if ((upd as any)?.changes === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Audit finding not found in active company' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/audit/adjustments", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const engagementIds = await getCompanyEngagementIds(companyId);
    if (engagementIds.length === 0) {
      res.json([]);
      return;
    }
    const adjustments = await db
      .select()
      .from(schema.auditAdjustments)
      .where(inArray(schema.auditAdjustments.engagementId, engagementIds))
      .orderBy(desc(schema.auditAdjustments.createdAt));
    res.json(adjustments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/adjustments", requireAuth, requirePermission('audit:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { description, accountCode, debitAmount, creditAmount, workflowStatus, reason } = req.body;
  try {
    const id = crypto.randomUUID();
    const engagementId = await getOrCreateCompanyAuditEngagementId(companyId);
    const affectedAccounts = JSON.stringify([{ accountCode: accountCode || '1000', debit: Number(debitAmount) || 0, credit: Number(creditAmount) || 0 }]);
    await db.insert(schema.auditAdjustments).values({
      id,
      engagementId,
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

router.post("/audit/adjustments/:id/workflow", requireAuth, requirePermission('audit:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { workflowStatus } = req.body;
  try {
    const engagementIds = await getCompanyEngagementIds(companyId);
    if (engagementIds.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Audit adjustment not found in active company' });
      return;
    }
    const upd = await db
      .update(schema.auditAdjustments)
      .set({ adjustmentType: workflowStatus })
      .where(and(eq(schema.auditAdjustments.id, req.params.id), inArray(schema.auditAdjustments.engagementId, engagementIds)));
    if ((upd as any)?.changes === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Audit adjustment not found in active company' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- APPROVAL WORKFLOW API ---
router.get("/approval/requests", requireAuth, requirePermission('approvals:view', 'accounting:view'), async (req, res) => {
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

router.post("/approval/requests", requireAuth, requirePermission('approvals:create', 'approvals:view', 'accounting:create', 'accounting:edit', 'sales:create', 'purchases:create', 'operations:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { actionType, amountPHP, details } = req.body;
  try {
    if ('actionType' in req.body && (!actionType || String(actionType).trim() === '')) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'actionType must be a non-empty string.' });
      return;
    }
    const numericAmount = amountPHP === undefined || amountPHP === null ? 0 : Number(amountPHP);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'amountPHP must be a finite non-negative number.' });
      return;
    }

    const normalizedActionType = String(actionType || 'SENSITIVE_ACTION').trim();
    const normalizedDetails = String(details || 'Requires maker-checker 4-eyes approval').trim();

    const existingPending = await db
      .select()
      .from(schema.approvalWorkflowRequests)
      .where(and(
        eq(schema.approvalWorkflowRequests.companyId, companyId),
        eq(schema.approvalWorkflowRequests.makerUserId, userId),
        eq(schema.approvalWorkflowRequests.actionType, normalizedActionType),
        eq(schema.approvalWorkflowRequests.amountPHP, numericAmount),
        eq(schema.approvalWorkflowRequests.details, normalizedDetails),
        eq(schema.approvalWorkflowRequests.status, 'PENDING')
      ))
      .get();

    if (existingPending) {
      res.status(409).json({
        error: 'DUPLICATE_APPROVAL_REQUEST',
        message: 'An identical pending approval request already exists.',
        existingId: existingPending.id
      });
      return;
    }

    const id = crypto.randomUUID();
    await db.insert(schema.approvalWorkflowRequests).values({
      id,
      companyId,
      actionType: normalizedActionType,
      amountPHP: numericAmount,
      makerUserId: userId,
      status: 'PENDING',
      details: normalizedDetails
    });

    await AuditService.log({
      companyId,
      userId,
      action: 'APPROVAL_REQUEST_CREATED',
      entityType: 'approval_workflow_request',
      entityId: id,
      afterData: { id, actionType: normalizedActionType, amountPHP: numericAmount, details: normalizedDetails, status: 'PENDING' },
      req
    });

    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/approval/requests/:id/cancel", requireAuth, requirePermission('approvals:create', 'approvals:view', 'accounting:create', 'accounting:edit', 'sales:create', 'purchases:create', 'operations:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  try {
    const existing = await db
      .select()
      .from(schema.approvalWorkflowRequests)
      .where(and(eq(schema.approvalWorkflowRequests.id, req.params.id), eq(schema.approvalWorkflowRequests.companyId, companyId)))
      .get();

    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Approval request not found in active company.' });
      return;
    }

    if (existing.makerUserId !== userId) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only the original maker can cancel a pending approval request.'
      });
      return;
    }

    if (existing.status !== 'PENDING') {
      res.status(409).json({
        error: 'INVALID_WORKFLOW_STATE',
        message: `Approval request is already ${existing.status}.`
      });
      return;
    }

    const upd = await db
      .update(schema.approvalWorkflowRequests)
      .set({
        status: 'CANCELLED'
      })
      .where(and(
        eq(schema.approvalWorkflowRequests.id, req.params.id),
        eq(schema.approvalWorkflowRequests.companyId, companyId),
        eq(schema.approvalWorkflowRequests.status, 'PENDING')
      ));

    if ((upd as any)?.changes === 0) {
      res.status(409).json({ error: 'CONCURRENT_MODIFICATION_CONFLICT', message: 'Approval request was already actioned.' });
      return;
    }

    await AuditService.log({
      companyId,
      userId,
      action: 'APPROVAL_REQUEST_CANCELLED',
      entityType: 'approval_workflow_request',
      entityId: existing.id,
      beforeData: { status: existing.status },
      afterData: { status: 'CANCELLED' },
      req
    });

    res.json({ success: true, status: 'CANCELLED' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/approval/requests/:id/action", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const userId = req.user!.id;
  const { status } = req.body;
  const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  if (normalizedStatus !== 'APPROVED' && normalizedStatus !== 'REJECTED') {
    res.status(400).json({
      error: 'INVALID_WORKFLOW_ACTION',
      message: 'Action status must be either APPROVED or REJECTED.'
    });
    return;
  }
  const targetStatus = normalizedStatus;
  try {
    const existing = await db
      .select()
      .from(schema.approvalWorkflowRequests)
      .where(and(eq(schema.approvalWorkflowRequests.id, req.params.id), eq(schema.approvalWorkflowRequests.companyId, companyId)))
      .get();

    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Approval request not found in active company.' });
      return;
    }

    if (existing.makerUserId === userId) {
      await AuditService.log({
        companyId,
        userId,
        action: 'APPROVAL_SOD_BLOCKED',
        entityType: 'approval_workflow_request',
        entityId: existing.id,
        afterData: { attemptedAction: targetStatus, reason: 'Segregation of Duties violation: Maker attempted own approval/rejection' },
        req
      });
      res.status(403).json({
        error: 'SOD_VIOLATION',
        message: 'Segregation of Duties violation: Maker cannot approve or reject their own request.'
      });
      return;
    }

    if (existing.status !== 'PENDING') {
      res.status(409).json({
        error: 'INVALID_WORKFLOW_STATE',
        message: `Approval request is already ${existing.status}.`
      });
      return;
    }

    const upd = await db
      .update(schema.approvalWorkflowRequests)
      .set({
        checkerUserId: userId,
        status: targetStatus
      })
      .where(and(
        eq(schema.approvalWorkflowRequests.id, req.params.id),
        eq(schema.approvalWorkflowRequests.companyId, companyId),
        eq(schema.approvalWorkflowRequests.status, 'PENDING')
      ));

    if ((upd as any)?.changes === 0) {
      res.status(409).json({ error: 'CONCURRENT_MODIFICATION_CONFLICT', message: 'Approval request was already actioned.' });
      return;
    }

    await AuditService.log({
      companyId,
      userId,
      action: targetStatus === 'APPROVED' ? 'APPROVAL_REQUEST_APPROVED' : 'APPROVAL_REQUEST_REJECTED',
      entityType: 'approval_workflow_request',
      entityId: existing.id,
      beforeData: { status: existing.status, checkerUserId: existing.checkerUserId },
      afterData: { status: targetStatus, checkerUserId: userId },
      req
    });

    res.json({ success: true, status: targetStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT WORKPAPERS API ---
router.get("/audit/workpapers", requireAuth, requirePermission('audit:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const engagementIds = await getCompanyEngagementIds(companyId);
    if (engagementIds.length === 0) {
      res.json([]);
      return;
    }
    const workpapers = await db
      .select()
      .from(schema.auditWorkpapers)
      .where(inArray(schema.auditWorkpapers.engagementId, engagementIds))
      .orderBy(desc(schema.auditWorkpapers.createdAt));
    res.json(workpapers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/workpapers", requireAuth, requirePermission('audit:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const actorId = req.user!.id;
  const actorName = req.user!.displayName || req.user!.email || actorId;
  const { title, referenceCode, category, preparedBy, notes, evidenceUrl } = req.body;
  try {
    const id = crypto.randomUUID();
    const engagementId = await getOrCreateCompanyAuditEngagementId(companyId);
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(schema.auditWorkpapers).values({
      id,
      engagementId,
      wpRef: referenceCode || 'A-1',
      title: title || 'Audit Working Paper',
      objective: category || 'Lead Schedule',
      procedure: notes || '',
      evidenceLinks: evidenceUrl ? JSON.stringify([evidenceUrl]) : JSON.stringify([]),
      status: 'DRAFT',
      preparerId: actorId,
      preparedDate: today,
      reviewNotes: preparedBy ? `Prepared by: ${preparedBy}` : `Prepared by: ${actorName}`
    });
    res.json({ success: true, id, preparerId: actorId, status: 'DRAFT' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/audit/workpapers/:id/signoff", requireAuth, requirePermission('audit:manage', 'audit:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const actorId = req.user!.id;
  const actorName = req.user!.displayName || req.user!.email || actorId;
  const { signOffStatus, notes, evidenceUrl } = req.body;
  try {
    const engagementIds = await getCompanyEngagementIds(companyId);
    if (engagementIds.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Audit workpaper not found in active company' });
      return;
    }

    const existing = await db
      .select()
      .from(schema.auditWorkpapers)
      .where(and(eq(schema.auditWorkpapers.id, req.params.id), inArray(schema.auditWorkpapers.engagementId, engagementIds)))
      .get();

    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Audit workpaper not found in active company' });
      return;
    }

    const nextStatus = signOffStatus || 'REVIEWED';
    const validation = validateWorkpaperSignOff({
      currentStatus: existing.status,
      targetStatus: nextStatus,
      preparerId: existing.preparerId,
      reviewerId: existing.reviewerId,
      actingUserId: actorId,
    });
    if (!validation.ok) {
      res.status(validation.status || 400).json({
        error: validation.code || 'VALIDATION_ERROR',
        message: validation.message,
      });
      return;
    }

    const existingNotes = existing.reviewNotes || '';
    const today = new Date().toISOString().slice(0, 10);
    const updateData: any = { status: nextStatus, updatedAt: new Date() };
    if (notes !== undefined) updateData.procedure = notes;
    if (evidenceUrl !== undefined) {
      updateData.evidenceLinks = JSON.stringify(evidenceUrl ? [evidenceUrl] : []);
    }
    if (nextStatus === 'PREPARED') {
      updateData.preparerId = actorId;
      updateData.preparedDate = today;
      updateData.reviewNotes = `Prepared by: ${actorName}`;
    } else if (nextStatus === 'REVIEWED') {
      updateData.reviewerId = actorId;
      updateData.reviewDate = today;
      updateData.reviewNotes = `${existingNotes ? existingNotes + ' | ' : ''}Reviewed: ${actorName}`;
    } else if (nextStatus === 'APPROVED') {
      updateData.reviewNotes = `${existingNotes ? existingNotes + ' | ' : ''}Approved: ${actorName}`;
    }

    const updateRes = db
      .update(schema.auditWorkpapers)
      .set(updateData)
      .where(and(eq(schema.auditWorkpapers.id, existing.id), eq(schema.auditWorkpapers.status, existing.status)))
      .run();

    if ((updateRes as any)?.changes === 0) {
      res.status(409).json({
        error: 'CONCURRENT_MODIFICATION_CONFLICT',
        message: 'Workpaper status was modified concurrently. Please refresh and try again.',
      });
      return;
    }

    await AuditService.log({
      req,
      companyId,
      userId: actorId,
      action: `AUDIT_WORKPAPER_${nextStatus}`,
      entityType: 'audit_workpapers',
      entityId: existing.id,
      module: 'Audit',
      beforeData: { status: existing.status, preparerId: existing.preparerId, reviewerId: existing.reviewerId },
      afterData: { status: nextStatus, actorId, actorName }
    });

    res.json({ success: true, status: nextStatus, actor: actorName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
