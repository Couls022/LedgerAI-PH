import crypto from 'crypto';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DomainError } from '../db/domain';
import { canonicalizeJson } from './canonicalJson';

export interface StatutoryRulePayload {
  agency: 'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR' | 'OTHER';
  ruleCode: string;
  ruleName: string;
  regulatorySourceRef: string;
  officialPublicationDate: string; // YYYY-MM-DD
  effectiveStartDate: string; // YYYY-MM-DD
  effectiveEndDate?: string | null; // YYYY-MM-DD
  versionNumber: number;
  calculationMethodology: string;
  parameters: Record<string, any>;
  goldenTestCases: Array<{
    testName: string;
    grossSalaryCentavos: number;
    expectedEmployeeContribCentavos: number;
    expectedEmployerContribCentavos: number;
    expectedWithholdingTaxCentavos?: number;
  }>;
}

export interface StatutoryUpdatePackageFile {
  manifest: {
    packageCode: string;
    packageName: string;
    packageVersion: string;
    publisherIdentity: string;
    publishedDate: string;
    minAppVersionSupported: string;
    signerKeyFingerprint: string;
  };
  rules: StatutoryRulePayload[];
  payloadSha256?: string;
  digitalSignature?: string;
}

export interface PackageValidationResult {
  isValid: boolean;
  signerKeyFingerprint: string;
  publisherIdentity: string;
  signatureOrigin: 'INTERNAL_LEDGERAI_PUBLISHER' | 'EXTERNAL_GOVERNMENT_PKI';
  sha256Match: boolean;
  signatureVerified: boolean;
  trustAnchorValid: boolean;
  rulesCount: number;
  diffSummary: Array<{
    agency: string;
    ruleCode: string;
    ruleName: string;
    versionNumber: number;
    effectiveStartDate: string;
    changeType: 'NEW_RULE' | 'UPDATE_RULE' | 'REPLACEMENT';
    parameterDiffs: Record<string, { oldVal: any; newVal: any }>;
  }>;
  goldenTestResults: Array<{
    ruleCode: string;
    testName: string;
    passed: boolean;
    expectedEe: number;
    actualEe: number;
    expectedEr: number;
    actualEr: number;
    errorDetails?: string;
  }>;
  errors: string[];
  warnings: string[];
}

// Built-in trusted root key pair for offline verification
let defaultKeyPair: { publicKeyPem: string; privateKeyPem: string; keyFingerprint: string } | null = null;

export function getDefaultTrustAnchorKeyPair() {
  if (!defaultKeyPair) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const keyFingerprint = crypto
      .createHash('sha256')
      .update(publicKey)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();

    defaultKeyPair = {
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
      keyFingerprint: `ANCHOR-GOV-PH-${keyFingerprint}`
    };
  }
  return defaultKeyPair;
}

export class StatutoryPackageService {
  /**
   * Ensures default internal LedgerAI statutory release public key anchor exists in DB.
   * Explicitly distinguishes internal LedgerAI PH publisher signatures from external government PKI.
   */
  static async ensureDefaultTrustAnchors(dbClient: any = db) {
    const defaultAnchor = getDefaultTrustAnchorKeyPair();
    const internalOwnerName = 'LedgerAI PH Internal Statutory Release Publisher (Non-Government PKI)';
    const existing = await dbClient
      .select()
      .from(schema.statutoryTrustAnchors)
      .where(eq(schema.statutoryTrustAnchors.keyFingerprint, defaultAnchor.keyFingerprint))
      .get();

    if (!existing) {
      await dbClient.insert(schema.statutoryTrustAnchors).values({
        id: crypto.randomUUID(),
        keyFingerprint: defaultAnchor.keyFingerprint,
        ownerName: internalOwnerName,
        publicKeyPem: defaultAnchor.publicKeyPem,
        isTrusted: true,
        validFrom: '2024-01-01',
        validTo: '2035-12-31',
        createdAt: new Date()
      }).onConflictDoNothing();
    } else if (existing.ownerName !== internalOwnerName) {
      await dbClient
        .update(schema.statutoryTrustAnchors)
        .set({ ownerName: internalOwnerName })
        .where(eq(schema.statutoryTrustAnchors.keyFingerprint, defaultAnchor.keyFingerprint));
    }

    return defaultAnchor;
  }

  /**
   * Classifies whether a trust anchor represents an internal LedgerAI PH publisher key
   * or an external government-issued PKI key.
   */
  static classifySignatureOrigin(
    keyFingerprint: string,
    ownerName?: string
  ): 'INTERNAL_LEDGERAI_PUBLISHER' | 'EXTERNAL_GOVERNMENT_PKI' {
    const defaultAnchor = getDefaultTrustAnchorKeyPair();
    if (
      keyFingerprint === defaultAnchor.keyFingerprint ||
      keyFingerprint.startsWith('ANCHOR-LEDGERAI-') ||
      (ownerName && ownerName.toUpperCase().includes('LEDGERAI')) ||
      (ownerName && ownerName.toUpperCase().includes('NON-GOVERNMENT'))
    ) {
      return 'INTERNAL_LEDGERAI_PUBLISHER';
    }
    return 'EXTERNAL_GOVERNMENT_PKI';
  }

  /**
   * Rotates a statutory trust anchor key by revoking the old key fingerprint and registering a new trusted public key,
   * recording an immutable audit trail entry.
   */
  static async rotateTrustAnchorKey(
    params: {
      companyId: string;
      oldKeyFingerprint: string;
      newKeyFingerprint: string;
      newOwnerName: string;
      newPublicKeyPem: string;
      validFrom: string;
      validTo: string;
      userId: string;
      userName: string;
      userRole: string;
      reason: string;
    },
    dbClient: any = db
  ): Promise<{ revokedKeyFingerprint: string; newKeyFingerprint: string }> {
    const allowedRoles = ['Company Owner', 'Company Administrator', 'Statutory Approver', 'OWNER', 'ADMIN'];
    if (!allowedRoles.includes(params.userRole)) {
      throw new DomainError(
        `RBAC Access Denied: Role '${params.userRole}' cannot rotate statutory trust anchor keys.`,
        'UNAUTHORIZED_KEY_ROTATION'
      );
    }
    if (!params.reason || params.reason.trim().length < 10) {
      throw new DomainError('Key rotation requires a documented security/governance reason.', 'INVALID_ROTATION_REASON');
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    await dbClient
      .update(schema.statutoryTrustAnchors)
      .set({
        isTrusted: false,
        validTo: todayStr
      })
      .where(eq(schema.statutoryTrustAnchors.keyFingerprint, params.oldKeyFingerprint));

    await dbClient
      .insert(schema.statutoryTrustAnchors)
      .values({
        id: crypto.randomUUID(),
        keyFingerprint: params.newKeyFingerprint,
        ownerName: params.newOwnerName,
        publicKeyPem: params.newPublicKeyPem,
        isTrusted: true,
        validFrom: params.validFrom,
        validTo: params.validTo,
        createdAt: now
      })
      .onConflictDoNothing();

    await dbClient.insert(schema.statutoryAuditLogs).values({
      id: crypto.randomUUID(),
      companyId: params.companyId,
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      action: 'ROTATE_TRUST_ANCHOR_KEY',
      previousStatus: 'TRUSTED',
      newStatus: 'ROTATED',
      detailsJson: JSON.stringify({
        oldKeyFingerprint: params.oldKeyFingerprint,
        newKeyFingerprint: params.newKeyFingerprint,
        newOwnerName: params.newOwnerName,
        validFrom: params.validFrom,
        validTo: params.validTo,
        reason: params.reason
      }),
      createdAt: now
    });

    return {
      revokedKeyFingerprint: params.oldKeyFingerprint,
      newKeyFingerprint: params.newKeyFingerprint
    };
  }

  /**
   * Revokes a statutory trust anchor key immediately so future package imports signed by it are rejected.
   */
  static async revokeTrustAnchorKey(
    params: {
      companyId: string;
      keyFingerprint: string;
      userId: string;
      userName: string;
      userRole: string;
      reason: string;
    },
    dbClient: any = db
  ): Promise<void> {
    const allowedRoles = ['Company Owner', 'Company Administrator', 'Statutory Approver', 'OWNER', 'ADMIN'];
    if (!allowedRoles.includes(params.userRole)) {
      throw new DomainError(
        `RBAC Access Denied: Role '${params.userRole}' cannot revoke statutory trust anchor keys.`,
        'UNAUTHORIZED_KEY_REVOCATION'
      );
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    await dbClient
      .update(schema.statutoryTrustAnchors)
      .set({
        isTrusted: false,
        validTo: todayStr
      })
      .where(eq(schema.statutoryTrustAnchors.keyFingerprint, params.keyFingerprint));

    await dbClient.insert(schema.statutoryAuditLogs).values({
      id: crypto.randomUUID(),
      companyId: params.companyId,
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      action: 'REVOKE_TRUST_ANCHOR_KEY',
      previousStatus: 'TRUSTED',
      newStatus: 'REVOKED',
      detailsJson: JSON.stringify({
        keyFingerprint: params.keyFingerprint,
        reason: params.reason
      }),
      createdAt: now
    });
  }

  /**
   * Computes deterministic SHA-256 payload digest for package rules & manifest
   * using RFC 8785 JSON Canonicalization Scheme (JCS).
   */
  static computePayloadDigest(pkgData: StatutoryUpdatePackageFile): string {
    const payloadObject = {
      manifest: {
        packageCode: pkgData.manifest.packageCode,
        packageName: pkgData.manifest.packageName,
        packageVersion: pkgData.manifest.packageVersion,
        publisherIdentity: pkgData.manifest.publisherIdentity,
        publishedDate: pkgData.manifest.publishedDate,
        minAppVersionSupported: pkgData.manifest.minAppVersionSupported,
        signerKeyFingerprint: pkgData.manifest.signerKeyFingerprint
      },
      rules: pkgData.rules
    };

    const canonicalJson = canonicalizeJson(payloadObject);
    return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  }

  /**
   * Signs a statutory update package using private key.
   */
  static createSignedPackage(
    packageCode: string,
    packageName: string,
    packageVersion: string,
    publisherIdentity: string,
    rules: StatutoryRulePayload[],
    customPrivateKeyPem?: string,
    customKeyFingerprint?: string
  ): StatutoryUpdatePackageFile {
    const defaultAnchor = getDefaultTrustAnchorKeyPair();
    const privateKey = customPrivateKeyPem || defaultAnchor.privateKeyPem;
    const keyFingerprint = customKeyFingerprint || defaultAnchor.keyFingerprint;

    const unsignedPkg: StatutoryUpdatePackageFile = {
      manifest: {
        packageCode,
        packageName,
        packageVersion,
        publisherIdentity,
        publishedDate: new Date().toISOString().slice(0, 10),
        minAppVersionSupported: '1.0.0',
        signerKeyFingerprint: keyFingerprint
      },
      rules
    };

    const payloadDigest = this.computePayloadDigest(unsignedPkg);
    const digitalSignature = crypto.sign('SHA256', Buffer.from(payloadDigest), privateKey).toString('hex');

    return {
      ...unsignedPkg,
      payloadSha256: payloadDigest,
      digitalSignature
    };
  }

  /**
   * Cryptographically verifies update package integrity, signature, and trust anchor.
   */
  static async verifyPackageIntegrity(
    pkg: StatutoryUpdatePackageFile,
    companyId: string,
    dbClient: any = db
  ): Promise<{
    isValid: boolean;
    sha256Match: boolean;
    signatureVerified: boolean;
    trustAnchorValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    if (!pkg.manifest || !pkg.rules || !Array.isArray(pkg.rules) || pkg.rules.length === 0) {
      errors.push('Package is malformed or contains zero statutory rules.');
      return { isValid: false, sha256Match: false, signatureVerified: false, trustAnchorValid: false, errors };
    }

    if (!pkg.digitalSignature || !pkg.payloadSha256) {
      errors.push('Package is unsigned or missing cryptographic payload SHA-256 digest.');
      return { isValid: false, sha256Match: false, signatureVerified: false, trustAnchorValid: false, errors };
    }

    // 1. Verify SHA-256 Digest
    const calculatedDigest = this.computePayloadDigest(pkg);
    const sha256Match = calculatedDigest === pkg.payloadSha256;
    if (!sha256Match) {
      errors.push(`Cryptographic Integrity Failure: Payload SHA-256 digest mismatch. Computed: ${calculatedDigest}, Package: ${pkg.payloadSha256}. Package has been tampered with or modified.`);
    }

    // 2. Resolve Trust Anchor Key & Verify Key Custody / Expiry Window
    await this.ensureDefaultTrustAnchors(dbClient);
    const trustAnchor = await dbClient
      .select()
      .from(schema.statutoryTrustAnchors)
      .where(
        and(
          eq(schema.statutoryTrustAnchors.keyFingerprint, pkg.manifest.signerKeyFingerprint),
          eq(schema.statutoryTrustAnchors.isTrusted, true)
        )
      )
      .get();

    let trustAnchorValid = !!trustAnchor;
    if (!trustAnchorValid) {
      errors.push(`Untrusted Signer Error (Untrusted or Revoked Signer): Signer public key fingerprint '${pkg.manifest.signerKeyFingerprint}' is not trusted or has been revoked in the local statutory trust anchors repository.`);
    } else {
      const pubDate = pkg.manifest.publishedDate || new Date().toISOString().slice(0, 10);
      if (trustAnchor.validFrom && pubDate < trustAnchor.validFrom) {
        trustAnchorValid = false;
        errors.push(`Trust Anchor Validity Error: Package publishedDate (${pubDate}) precedes key validFrom (${trustAnchor.validFrom}).`);
      }
      if (trustAnchor.validTo && pubDate > trustAnchor.validTo) {
        trustAnchorValid = false;
        errors.push(`Trust Anchor Expired Error: Signer key '${trustAnchor.keyFingerprint}' expired on ${trustAnchor.validTo}.`);
      }
    }

    // 3. Cryptographic Digital Signature Verification
    let signatureVerified = false;
    if (trustAnchorValid) {
      try {
        const verifier = crypto.createVerify('SHA256');
        verifier.update(calculatedDigest);
        verifier.end();
        signatureVerified = verifier.verify(trustAnchor.publicKeyPem, pkg.digitalSignature, 'hex');

        if (!signatureVerified) {
          errors.push('Digital Signature Verification Failed: Cryptographic signature mismatch. Package signature could not be verified against the trusted public key.');
        }
      } catch (e: any) {
        errors.push(`Digital Signature Exception: ${e.message}`);
      }
    }

    const isValid = sha256Match && trustAnchorValid && signatureVerified && errors.length === 0;
    return { isValid, sha256Match, signatureVerified, trustAnchorValid, errors };
  }

  /**
   * Imports a statutory update package into local SQLite database.
   */
  static async importPackage(
    companyId: string,
    rawPackageJson: string,
    userId: string,
    userName: string,
    dbClient: any = db
  ): Promise<{ packageRecord: any; validationResult: PackageValidationResult }> {
    let parsedPkg: StatutoryUpdatePackageFile;
    try {
      parsedPkg = typeof rawPackageJson === 'string' ? JSON.parse(rawPackageJson) : rawPackageJson;
    } catch (e: any) {
      throw new DomainError(`Failed to parse statutory update package JSON: ${e.message}`, 'MALFORMED_PACKAGE');
    }

    // 1. Verify Cryptographic Integrity
    const verification = await this.verifyPackageIntegrity(parsedPkg, companyId, dbClient);
    if (!verification.isValid) {
      throw new DomainError(
        `Statutory Update Package Security Rejection:\n${verification.errors.join('\n')}`,
        'INVALID_PACKAGE_SIGNATURE'
      );
    }

    // 2. Check Duplicate Package Code / Version
    const existingPkg = await dbClient
      .select()
      .from(schema.statutoryUpdatePackages)
      .where(
        and(
          eq(schema.statutoryUpdatePackages.companyId, companyId),
          eq(schema.statutoryUpdatePackages.packageCode, parsedPkg.manifest.packageCode),
          eq(schema.statutoryUpdatePackages.packageVersion, parsedPkg.manifest.packageVersion)
        )
      )
      .get();

    if (existingPkg) {
      throw new DomainError(
        `Duplicate Statutory Package: Package '${parsedPkg.manifest.packageCode}' version '${parsedPkg.manifest.packageVersion}' has already been imported.`,
        'DUPLICATE_PACKAGE'
      );
    }

    // 3. Execute Golden Test Verification & Diff Generation
    const validationResult = await this.validatePackageAndRules(companyId, parsedPkg, dbClient);
    if (validationResult.errors.some(e => e.includes('[CONFLICTING_STATUTORY_SCHEDULE]'))) {
      throw new DomainError(
        `Statutory Update Package Schedule Conflict:\n${validationResult.errors.join('\n')}`,
        'CONFLICTING_STATUTORY_SCHEDULE'
      );
    }

    // 4. Save Package Record
    const packageId = crypto.randomUUID();
    const packageRecord = {
      id: packageId,
      companyId,
      packageCode: parsedPkg.manifest.packageCode,
      packageName: parsedPkg.manifest.packageName,
      packageVersion: parsedPkg.manifest.packageVersion,
      publisherIdentity: parsedPkg.manifest.publisherIdentity,
      signerKeyFingerprint: parsedPkg.manifest.signerKeyFingerprint,
      payloadSha256: parsedPkg.payloadSha256 || '',
      digitalSignature: parsedPkg.digitalSignature || '',
      status: validationResult.isValid ? 'VALIDATED' : 'IMPORTED',
      rulesCount: parsedPkg.rules.length,
      validationReportJson: JSON.stringify(validationResult),
      rawPackageJson: JSON.stringify(parsedPkg),
      importedBy: userId,
      importedByName: userName,
      importedAt: new Date()
    };

    await dbClient.insert(schema.statutoryUpdatePackages).values(packageRecord);

    // 5. Insert Individual Statutory Rule Records
    for (const rulePayload of parsedPkg.rules) {
      const ruleId = crypto.randomUUID();
      await dbClient.insert(schema.statutoryRules).values({
        id: ruleId,
        companyId,
        packageId,
        agency: rulePayload.agency,
        ruleCode: rulePayload.ruleCode,
        ruleName: rulePayload.ruleName,
        regulatorySourceRef: rulePayload.regulatorySourceRef,
        officialPublicationDate: rulePayload.officialPublicationDate,
        effectiveStartDate: rulePayload.effectiveStartDate,
        effectiveEndDate: rulePayload.effectiveEndDate || null,
        versionNumber: rulePayload.versionNumber,
        calculationMethodology: rulePayload.calculationMethodology,
        ruleDefinitionJson: JSON.stringify(rulePayload),
        status: validationResult.isValid ? 'VALIDATED' : 'IMPORTED',
        digitalSignature: parsedPkg.digitalSignature,
        signerPublicKeyFingerprint: parsedPkg.manifest.signerKeyFingerprint,
        validationStatus: validationResult.isValid ? 'PASSED' : 'FAILED',
        createdBy: userId,
        createdByName: userName,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // 6. Audit Trail Logging
    await dbClient.insert(schema.statutoryAuditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      userName,
      action: 'IMPORT_PACKAGE',
      packageId,
      detailsJson: JSON.stringify({
        packageCode: parsedPkg.manifest.packageCode,
        version: parsedPkg.manifest.packageVersion,
        rulesCount: parsedPkg.rules.length,
        isValid: validationResult.isValid
      }),
      createdAt: new Date()
    });

    return { packageRecord, validationResult };
  }

  /**
   * Validates package rules by comparing against existing active rules & executing golden test cases.
   */
  static async validatePackageAndRules(
    companyId: string,
    pkg: StatutoryUpdatePackageFile,
    dbClient: any = db
  ): Promise<PackageValidationResult> {
    const diffSummary: PackageValidationResult['diffSummary'] = [];
    const goldenTestResults: PackageValidationResult['goldenTestResults'] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    // 0. Check for inverted or conflicting/overlapping effective-date schedules within the package
    for (let i = 0; i < pkg.rules.length; i++) {
      const r1 = pkg.rules[i];
      const start1 = r1.effectiveStartDate;
      const end1 = r1.effectiveEndDate || '9999-12-31';
      if (r1.effectiveEndDate && r1.effectiveEndDate < r1.effectiveStartDate) {
        errors.push(
          `[CONFLICTING_STATUTORY_SCHEDULE] Rule '${r1.ruleCode}' (${r1.agency}) has effectiveEndDate (${r1.effectiveEndDate}) earlier than effectiveStartDate (${r1.effectiveStartDate}).`
        );
      }
      for (let j = i + 1; j < pkg.rules.length; j++) {
        const r2 = pkg.rules[j];
        if (r1.agency === r2.agency && r1.ruleCode === r2.ruleCode) {
          const start2 = r2.effectiveStartDate;
          const end2 = r2.effectiveEndDate || '9999-12-31';
          if (start1 <= end2 && end1 >= start2) {
            errors.push(
              `[CONFLICTING_STATUTORY_SCHEDULE] Conflicting or overlapping effective-date schedules in package for agency '${r1.agency}' ruleCode '${r1.ruleCode}': [${start1}..${end1}] overlaps with [${start2}..${end2}].`
            );
          }
        }
      }
    }

    for (const rule of pkg.rules) {
      // Find existing active rule for agency & ruleCode
      const existingActiveRule = await dbClient
        .select()
        .from(schema.statutoryRules)
        .where(
          and(
            eq(schema.statutoryRules.companyId, companyId),
            eq(schema.statutoryRules.agency, rule.agency),
            eq(schema.statutoryRules.ruleCode, rule.ruleCode),
            eq(schema.statutoryRules.status, 'ACTIVE')
          )
        )
        .get();

      let changeType: 'NEW_RULE' | 'UPDATE_RULE' | 'REPLACEMENT' = 'NEW_RULE';
      const parameterDiffs: Record<string, { oldVal: any; newVal: any }> = {};

      if (existingActiveRule) {
        changeType = 'UPDATE_RULE';
        try {
          const oldDef = JSON.parse(existingActiveRule.ruleDefinitionJson);
          for (const key of Object.keys(rule.parameters || {})) {
            if (JSON.stringify(oldDef.parameters?.[key]) !== JSON.stringify(rule.parameters[key])) {
              parameterDiffs[key] = {
                oldVal: oldDef.parameters?.[key],
                newVal: rule.parameters[key]
              };
            }
          }
        } catch {}
      }

      diffSummary.push({
        agency: rule.agency,
        ruleCode: rule.ruleCode,
        ruleName: rule.ruleName,
        versionNumber: rule.versionNumber,
        effectiveStartDate: rule.effectiveStartDate,
        changeType,
        parameterDiffs
      });

      // Execute Golden Test Cases
      if (rule.goldenTestCases && Array.isArray(rule.goldenTestCases)) {
        for (const testCase of rule.goldenTestCases) {
          let actualEe = 0;
          let actualEr = 0;
          let passed = true;
          let errorDetails: string | undefined;

          try {
            // Formula Execution for SSS / PhilHealth / Pag-IBIG
            if (rule.agency === 'SSS') {
              const mscCap = rule.parameters?.maxMscCentavos || 3500000;
              const rateEe = rule.parameters?.eeRate || 0.05;
              const rateEr = rule.parameters?.erRate || 0.10;
              const clampedBase = Math.min(mscCap, testCase.grossSalaryCentavos * 2);

              actualEe = Math.round((clampedBase * rateEe) / 2);
              actualEr = Math.round((clampedBase * rateEr) / 2);
            } else if (rule.agency === 'PAGIBIG') {
              const mfsCap = rule.parameters?.mfsCeilingCentavos || 1000000;
              const rate = rule.parameters?.rate || 0.02;
              const clampedBase = Math.min(mfsCap, testCase.grossSalaryCentavos);
              actualEe = Math.round(clampedBase * rate);
              actualEr = actualEe;
            } else if (rule.agency === 'PHILHEALTH') {
              const floor = rule.parameters?.monthlyFloorCentavos || 1000000;
              const ceiling = rule.parameters?.monthlyCeilingCentavos || 10000000;
              const rate = rule.parameters?.eeRate || 0.025;
              const clamped = Math.min(ceiling, Math.max(floor, testCase.grossSalaryCentavos * 2));
              actualEe = Math.round((clamped * rate) / 2);
              actualEr = actualEe;
            }

            if (
              Math.abs(actualEe - testCase.expectedEmployeeContribCentavos) > 1 ||
              Math.abs(actualEr - testCase.expectedEmployerContribCentavos) > 1
            ) {
              passed = false;
              errorDetails = `Golden Test Mismatch: Test '${testCase.testName}' expected EE ${testCase.expectedEmployeeContribCentavos} / ER ${testCase.expectedEmployerContribCentavos}, computed EE ${actualEe} / ER ${actualEr}.`;
              errors.push(errorDetails);
            }
          } catch (e: any) {
            passed = false;
            errorDetails = `Golden Test Execution Exception: ${e.message}`;
            errors.push(errorDetails);
          }

          goldenTestResults.push({
            ruleCode: rule.ruleCode,
            testName: testCase.testName,
            passed,
            expectedEe: testCase.expectedEmployeeContribCentavos,
            actualEe,
            expectedEr: testCase.expectedEmployerContribCentavos,
            actualEr,
            errorDetails
          });
        }
      }
    }

    const isValid = errors.length === 0;
    const signatureOrigin = this.classifySignatureOrigin(
      pkg.manifest.signerKeyFingerprint,
      pkg.manifest.publisherIdentity
    );

    return {
      isValid,
      signerKeyFingerprint: pkg.manifest.signerKeyFingerprint,
      publisherIdentity: pkg.manifest.publisherIdentity,
      signatureOrigin,
      sha256Match: true,
      signatureVerified: true,
      trustAnchorValid: true,
      rulesCount: pkg.rules.length,
      diffSummary,
      goldenTestResults,
      errors,
      warnings
    };
  }

  /**
   * Approves and Activates a Statutory Update Package & its contained rules.
   */
  static async approveAndActivatePackage(
    companyId: string,
    packageId: string,
    userId: string,
    userName: string,
    userRole: string,
    dbClient: any = db,
    options: { enforceSoD?: boolean; cpaApprovalRef?: string } = {}
  ): Promise<{ packageRecord: any; activatedRulesCount: number }> {
    // RBAC Check: Must be Statutory Approver / Company Administrator / Owner
    const isAuthorized = ['Company Owner', 'Company Administrator', 'Statutory Approver', 'ADMIN', 'OWNER'].includes(userRole);
    if (!isAuthorized) {
      throw new DomainError(
        `RBAC Access Denied: User role '${userRole}' lacks statutory package approval privileges. Statutory update activation requires Company Administrator or Statutory Approver authorization.`,
        'UNAUTHORIZED_APPROVAL'
      );
    }

    const pkg = await dbClient
      .select()
      .from(schema.statutoryUpdatePackages)
      .where(
        and(
          eq(schema.statutoryUpdatePackages.companyId, companyId),
          eq(schema.statutoryUpdatePackages.id, packageId)
        )
      )
      .get();

    if (!pkg) {
      throw new DomainError(`Statutory update package '${packageId}' not found.`, 'PACKAGE_NOT_FOUND');
    }

    if (options.enforceSoD && pkg.importedBy === userId) {
      throw new DomainError(
        `[SOD_VIOLATION_PACKAGE_APPROVAL] Separation of Duties Violation: User '${userId}' imported package '${pkg.packageCode}' and cannot self-approve its activation under strict governance controls.`,
        'SOD_VIOLATION_PACKAGE_APPROVAL'
      );
    }

    const rules = await dbClient
      .select()
      .from(schema.statutoryRules)
      .where(
        and(
          eq(schema.statutoryRules.companyId, companyId),
          eq(schema.statutoryRules.packageId, packageId)
        )
      );

    const now = new Date();

    // Activate each rule and supersede prior active rules for the same agency/ruleCode
    for (const rule of rules) {
      // Supersede prior active rules for this agency and ruleCode
      await dbClient
        .update(schema.statutoryRules)
        .set({
          status: 'SUPERSEDED',
          effectiveEndDate: rule.effectiveStartDate,
          updatedAt: now
        })
        .where(
          and(
            eq(schema.statutoryRules.companyId, companyId),
            eq(schema.statutoryRules.agency, rule.agency),
            eq(schema.statutoryRules.ruleCode, rule.ruleCode),
            eq(schema.statutoryRules.status, 'ACTIVE')
          )
        );

      // Activate new rule
      await dbClient
        .update(schema.statutoryRules)
        .set({
          status: 'ACTIVE',
          approvedBy: userId,
          approvedByName: userName,
          approvedAt: now,
          activatedAt: now,
          updatedAt: now
        })
        .where(eq(schema.statutoryRules.id, rule.id));
    }

    // Update package status to ACTIVE
    await dbClient
      .update(schema.statutoryUpdatePackages)
      .set({
        status: 'ACTIVE',
        approvedBy: userId,
        approvedByName: userName,
        approvedAt: now
      })
      .where(eq(schema.statutoryUpdatePackages.id, packageId));

    // Log Audit Trail
    await dbClient.insert(schema.statutoryAuditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      userName,
      userRole,
      action: 'APPROVE_PACKAGE_AND_ACTIVATE',
      packageId,
      previousStatus: pkg.status,
      newStatus: 'ACTIVE',
      detailsJson: JSON.stringify({
        packageCode: pkg.packageCode,
        packageVersion: pkg.packageVersion,
        activatedRulesCount: rules.length
      }),
      createdAt: now
    });

    const updatedPkg = await dbClient
      .select()
      .from(schema.statutoryUpdatePackages)
      .where(eq(schema.statutoryUpdatePackages.id, packageId))
      .get();

    return { packageRecord: updatedPkg, activatedRulesCount: rules.length };
  }

  /**
   * Rolls back an active package to prior superseded rules.
   */
  static async rollbackPackage(
    companyId: string,
    packageId: string,
    userId: string,
    userName: string,
    userRole: string,
    reason: string,
    dbClient: any = db
  ): Promise<void> {
    const isAuthorized = ['Company Owner', 'Company Administrator', 'Statutory Approver', 'ADMIN', 'OWNER'].includes(userRole);
    if (!isAuthorized) {
      throw new DomainError(`RBAC Access Denied: Rollback requires Statutory Approver authorization.`, 'UNAUTHORIZED_ROLLBACK');
    }

    const pkg = await dbClient
      .select()
      .from(schema.statutoryUpdatePackages)
      .where(
        and(
          eq(schema.statutoryUpdatePackages.companyId, companyId),
          eq(schema.statutoryUpdatePackages.id, packageId)
        )
      )
      .get();

    if (!pkg) throw new DomainError(`Package '${packageId}' not found.`, 'PACKAGE_NOT_FOUND');

    const rules = await dbClient
      .select()
      .from(schema.statutoryRules)
      .where(
        and(
          eq(schema.statutoryRules.companyId, companyId),
          eq(schema.statutoryRules.packageId, packageId)
        )
      );

    const now = new Date();

    for (const rule of rules) {
      // Mark current rule as ROLLED_BACK / REJECTED
      await dbClient
        .update(schema.statutoryRules)
        .set({ status: 'REJECTED', updatedAt: now })
        .where(eq(schema.statutoryRules.id, rule.id));

      // Re-activate most recent SUPERSEDED rule for agency & ruleCode
      const priorSuperseded = await dbClient
        .select()
        .from(schema.statutoryRules)
        .where(
          and(
            eq(schema.statutoryRules.companyId, companyId),
            eq(schema.statutoryRules.agency, rule.agency),
            eq(schema.statutoryRules.ruleCode, rule.ruleCode),
            eq(schema.statutoryRules.status, 'SUPERSEDED')
          )
        )
        .orderBy(desc(schema.statutoryRules.versionNumber))
        .get();

      if (priorSuperseded) {
        await dbClient
          .update(schema.statutoryRules)
          .set({
            status: 'ACTIVE',
            effectiveEndDate: null,
            updatedAt: now
          })
          .where(eq(schema.statutoryRules.id, priorSuperseded.id));
      }
    }

    await dbClient
      .update(schema.statutoryUpdatePackages)
      .set({ status: 'ROLLED_BACK' })
      .where(eq(schema.statutoryUpdatePackages.id, packageId));

    await dbClient.insert(schema.statutoryAuditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      userName,
      userRole,
      action: 'ROLLBACK_PACKAGE',
      packageId,
      detailsJson: JSON.stringify({ reason }),
      createdAt: now
    });
  }
}
