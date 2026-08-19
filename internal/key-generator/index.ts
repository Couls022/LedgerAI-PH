import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AuthoritySigner } from './signer';

// INTERNAL LICENSE GENERATOR CLI
// Usage: tsx internal/key-generator/index.ts generate --company <companyId> --plan <PRO|ENTERPRISE> --duration <1y|lifetime|custom>

export interface GenerateLicenseOptions {
  companyId: string;
  planType: 'PRO' | 'ENTERPRISE';
  duration?: 'trial' | '7days' | '1y' | 'yearly' | 'monthly' | 'quarterly' | 'lifetime' | 'custom' | string;
  customDays?: number;
  deviceFingerprint?: string;
}

export interface LicenseRequestPayload {
  requestType: 'LEDGERAI_LICENSE_REQUEST';
  version: number;
  companyId: string;
  companyName: string;
  tin?: string;
  requestedPlan?: 'PRO' | 'ENTERPRISE' | string;
  installationId: string;
  timestamp: string;
}

export function parseAndValidateLicenseRequest(contentOrPath: string): LicenseRequestPayload {
  let jsonString = contentOrPath.trim();
  if (fs.existsSync(contentOrPath)) {
    jsonString = fs.readFileSync(contentOrPath, 'utf8').trim();
  }

  const parsed = JSON.parse(jsonString);
  if (!parsed || parsed.requestType !== 'LEDGERAI_LICENSE_REQUEST') {
    throw new Error('Invalid requestType: Must be LEDGERAI_LICENSE_REQUEST');
  }
  if (!parsed.companyId || typeof parsed.companyId !== 'string') {
    throw new Error('Invalid LRQ: Missing or invalid companyId');
  }
  if (!parsed.companyName || typeof parsed.companyName !== 'string') {
    throw new Error('Invalid LRQ: Missing companyName');
  }
  if (!parsed.installationId || typeof parsed.installationId !== 'string') {
    throw new Error('Invalid LRQ: Missing installationId');
  }

  return {
    requestType: 'LEDGERAI_LICENSE_REQUEST',
    version: parsed.version || 1,
    companyId: parsed.companyId.trim(),
    companyName: parsed.companyName.trim(),
    tin: parsed.tin ? String(parsed.tin).trim() : 'N/A',
    requestedPlan: (parsed.requestedPlan === 'ENTERPRISE') ? 'ENTERPRISE' : 'PRO',
    installationId: parsed.installationId.trim(),
    timestamp: parsed.timestamp || new Date().toISOString()
  };
}

export function generateLicense({
  companyId,
  planType,
  duration = '1y',
  customDays,
  deviceFingerprint,
}: GenerateLicenseOptions) {
  const licenseId = crypto.randomUUID();
  const activationKey = `LGR-${planType}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  let expDate: string | null = null;
  let type = 'TERM';
  const now = new Date();

  if (duration === 'lifetime') {
    type = 'LIFETIME';
  } else if (duration === 'trial' || duration === '7days') {
    now.setDate(now.getDate() + 7);
    expDate = now.toISOString().slice(0, 10);
  } else if (duration === 'monthly') {
    now.setMonth(now.getMonth() + 1);
    expDate = now.toISOString().slice(0, 10);
  } else if (duration === 'quarterly') {
    now.setMonth(now.getMonth() + 3);
    expDate = now.toISOString().slice(0, 10);
  } else if (duration === 'yearly') {
    now.setFullYear(now.getFullYear() + 1);
    expDate = now.toISOString().slice(0, 10);
  } else if (duration === 'custom' && customDays) {
    now.setDate(now.getDate() + customDays);
    expDate = now.toISOString().slice(0, 10);
  } else {
    // Default 7-day trial
    now.setDate(now.getDate() + 7);
    expDate = now.toISOString().slice(0, 10);
  }

  const payload = {
    licenseId,
    companyId: companyId.trim(),
    productId: 'LEDGERAI-PH',
    activationKey,
    planType,
    type,
    expirationDate: expDate,
    deviceBindingHash: deviceFingerprint ? deviceFingerprint.trim() : null,
    issuedAt: new Date().toISOString(),
    version: '1.0',
  };

  const { signature, json } = AuthoritySigner.generateSignedLicenseArtifact(payload);

  return {
    licenseId,
    companyId: companyId.trim(),
    activationKey,
    planType,
    type,
    expirationDate: expDate,
    payload,
    signature,
    json,
  };
}

// CLI Execution Handler
if (process.argv[1] && process.argv[1].includes('key-generator')) {
  const args = process.argv.slice(2);
  const lrqArg = args.find((a, i) => args[i - 1] === '--lrq');
  
  let targetCompanyId = 'LGR-PH-2026-COR-00-58C7A29A';
  let targetPlan: 'PRO' | 'ENTERPRISE' = 'PRO';

  if (lrqArg && fs.existsSync(lrqArg)) {
    console.log(`[Authority Generator] Ingesting request from LRQ artifact: ${lrqArg}`);
    const lrq = parseAndValidateLicenseRequest(lrqArg);
    targetCompanyId = lrq.companyId;
    targetPlan = (lrq.requestedPlan === 'ENTERPRISE') ? 'ENTERPRISE' : 'PRO';
    console.log(`[Authority Generator] Target: ${lrq.companyName} (${lrq.companyId}), Requested Plan: ${lrq.requestedPlan}`);
  } else {
    targetCompanyId = args.find((a, i) => args[i - 1] === '--company') || targetCompanyId;
    targetPlan = (args.find((a, i) => args[i - 1] === '--plan') || 'PRO') as 'PRO' | 'ENTERPRISE';
  }

  const durationArg = (args.find((a, i) => args[i - 1] === '--duration') || '1y') as any;

  console.log(`[Authority Generator] Generating license for ${targetCompanyId} (${targetPlan}, ${durationArg})...`);
  const result = generateLicense({
    companyId: targetCompanyId,
    planType: targetPlan,
    duration: durationArg,
  });

  const outFilename = `license_${result.companyId.replace(/[^A-Za-z0-9_-]/g, '_')}.lai`;
  const outPath = path.resolve(process.cwd(), outFilename);
  fs.writeFileSync(outPath, result.json, 'utf8');

  console.log(`\n======================================================`);
  console.log(`✔ LICENSE GENERATED & SIGNED BY AUTHORITY`);
  console.log(`======================================================`);
  console.log(`Company ID:     ${result.companyId}`);
  console.log(`Activation Key: ${result.activationKey}`);
  console.log(`Plan Type:      ${result.planType}`);
  console.log(`Expiration:     ${result.expirationDate || 'LIFETIME'}`);
  console.log(`License File:   ${outFilename}`);
  console.log(`======================================================\n`);
}
