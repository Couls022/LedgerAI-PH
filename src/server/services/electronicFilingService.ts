import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { OfficialBirAdapter, TaxFilingAdapter } from './taxFilingAdapter';
import { DocumentSigner } from './documentSigner';
import { AuditService } from './auditService';
import { OperationalLogger } from './operationalLogger';

export type FilingStatus =
  | 'DRAFT'
  | 'VALIDATED'
  | 'PACKAGE_READY'
  | 'QUEUED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'VALIDATION_FAILED'
  | 'SUBMISSION_FAILED'
  | 'REJECTED'
  | 'RETRY_PENDING'
  | 'CANCELLED'
  | 'NOT_CONFIGURED'
  | 'DEFERRED_EXTERNAL_INTEGRATION';

export class ElectronicFilingService {
  private static adapter: TaxFilingAdapter = new OfficialBirAdapter();

  public static async createFiling(
    companyId: string,
    filingType: string,
    reportingPeriod: string,
    payloadData: any,
    userId: string
  ): Promise<any> {
    const existing = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(
        and(
          eq(schema.electronicFilingSubmissions.companyId, companyId),
          eq(schema.electronicFilingSubmissions.filingType, filingType),
          eq(schema.electronicFilingSubmissions.reportingPeriod, reportingPeriod)
        )
      );

    if (existing && existing.length > 0) {
      const activeSubmission = existing[0];
      if (!['CANCELLED', 'REJECTED', 'VALIDATION_FAILED'].includes(activeSubmission.status)) {
        throw new Error(`DUPLICATE_SUBMISSION_PREVENTION: An active or completed filing for ${filingType} and period ${reportingPeriod} already exists (ID: ${activeSubmission.id}, Status: ${activeSubmission.status}).`);
      }
    }

    const id = crypto.randomUUID();
    const artifactDataJson = JSON.stringify(payloadData);
    const artifactChecksum = crypto.createHash('sha256').update(artifactDataJson).digest('hex');

    const [newFiling] = await db.insert(schema.electronicFilingSubmissions).values({
      id,
      companyId,
      filingType,
      reportingPeriod,
      status: 'DRAFT',
      adapterProvider: this.adapter.name,
      artifactChecksum,
      artifactDataJson,
      attemptCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    await AuditService.log({
      companyId,
      userId,
      action: 'CREATE_FILING',
      entityType: 'ELECTRONIC_FILING',
      entityId: id,
      recordReference: `Filing Type: ${filingType} | Period: ${reportingPeriod}`,
      result: 'SUCCESS'
    });

    OperationalLogger.info('Filing created', { filingId: id, filingType, reportingPeriod }, { companyId });
    return newFiling;
  }

  public static async validateFiling(filingId: string, companyId: string, userId: string): Promise<any> {
    const [filing] = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(and(eq(schema.electronicFilingSubmissions.id, filingId), eq(schema.electronicFilingSubmissions.companyId, companyId)));

    if (!filing) throw new Error('FILING_NOT_FOUND: Filing record does not exist or access denied.');

    const payload = filing.artifactDataJson ? JSON.parse(filing.artifactDataJson) : {};
    const validationRes = this.adapter.validate(payload);

    const newStatus: FilingStatus = validationRes.valid ? 'VALIDATED' : 'VALIDATION_FAILED';

    const [updated] = await db
      .update(schema.electronicFilingSubmissions)
      .set({
        status: newStatus,
        errorCode: validationRes.valid ? null : 'VALIDATION_ERROR',
        errorMessage: validationRes.valid ? null : validationRes.errors.join('; '),
        updatedAt: new Date()
      })
      .where(eq(schema.electronicFilingSubmissions.id, filingId))
      .returning();

    await AuditService.log({
      companyId,
      userId,
      action: 'VALIDATE_FILING',
      entityType: 'ELECTRONIC_FILING',
      entityId: filingId,
      recordReference: `Status: ${newStatus}`,
      result: validationRes.valid ? 'SUCCESS' : 'FAILED'
    });

    return { ...updated, validation: validationRes };
  }

  public static async generatePackage(filingId: string, companyId: string, userId: string): Promise<any> {
    const [filing] = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(and(eq(schema.electronicFilingSubmissions.id, filingId), eq(schema.electronicFilingSubmissions.companyId, companyId)));

    if (!filing) throw new Error('FILING_NOT_FOUND');
    if (filing.status !== 'VALIDATED' && filing.status !== 'DRAFT') {
      throw new Error(`INVALID_STATUS_FOR_PACKAGE: Filing must be in VALIDATED state before package generation (Current: ${filing.status})`);
    }

    const payload = filing.artifactDataJson ? JSON.parse(filing.artifactDataJson) : {};
    const pkg = this.adapter.preparePackage(payload);

    if (pkg.checksum !== filing.artifactChecksum) {
      throw new Error('INTEGRITY_CHECK_FAILED: Artifact checksum verification failed during package generation.');
    }

    const [updated] = await db
      .update(schema.electronicFilingSubmissions)
      .set({
        status: 'PACKAGE_READY',
        artifactChecksum: pkg.checksum,
        updatedAt: new Date()
      })
      .where(eq(schema.electronicFilingSubmissions.id, filingId))
      .returning();

    await AuditService.log({
      companyId,
      userId,
      action: 'GENERATE_FILING_PACKAGE',
      entityType: 'ELECTRONIC_FILING',
      entityId: filingId,
      recordReference: `Checksum: ${pkg.checksum.slice(0, 12)}`,
      result: 'SUCCESS'
    });

    return { ...updated, packageMetadata: pkg.metadata };
  }

  public static async signFiling(filingId: string, companyId: string, certData: string, userId: string): Promise<any> {
    const [filing] = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(and(eq(schema.electronicFilingSubmissions.id, filingId), eq(schema.electronicFilingSubmissions.companyId, companyId)));

    if (!filing) throw new Error('FILING_NOT_FOUND');

    const payload = {
      filingId: filing.id,
      companyId: filing.companyId,
      filingType: filing.filingType,
      reportingPeriod: filing.reportingPeriod,
      artifactChecksum: filing.artifactChecksum,
      data: filing.artifactDataJson ? JSON.parse(filing.artifactDataJson) : {}
    };

    const signatureResult = DocumentSigner.sign(payload, certData);

    const [updated] = await db
      .update(schema.electronicFilingSubmissions)
      .set({
        signatureDataJson: JSON.stringify(signatureResult),
        updatedAt: new Date()
      })
      .where(eq(schema.electronicFilingSubmissions.id, filingId))
      .returning();

    await AuditService.log({
      companyId,
      userId,
      action: 'SIGN_FILING',
      entityType: 'ELECTRONIC_FILING',
      entityId: filingId,
      recordReference: `Provider: ${signatureResult.provider}`,
      result: 'SUCCESS'
    });

    return { ...updated, signature: signatureResult };
  }

  public static async submitFiling(filingId: string, companyId: string, userId: string): Promise<any> {
    const [filing] = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(and(eq(schema.electronicFilingSubmissions.id, filingId), eq(schema.electronicFilingSubmissions.companyId, companyId)));

    if (!filing) throw new Error('FILING_NOT_FOUND');
    if (!['PACKAGE_READY', 'VALIDATED', 'RETRY_PENDING', 'QUEUED'].includes(filing.status)) {
      throw new Error(`INVALID_STATUS_FOR_SUBMISSION: Filing cannot be submitted in state ${filing.status}`);
    }

    if (!filing.artifactChecksum || !filing.artifactDataJson) {
      throw new Error('INTEGRITY_CHECK_FAILED: Missing filing artifact or checksum.');
    }
    const recalculatedChecksum = crypto.createHash('sha256').update(filing.artifactDataJson).digest('hex');
    if (recalculatedChecksum !== filing.artifactChecksum) {
      throw new Error('INTEGRITY_CHECK_FAILED: Artifact checksum mismatch. Data may have been unexpectedly modified.');
    }

    await db
      .update(schema.electronicFilingSubmissions)
      .set({
        status: 'SUBMITTING',
        attemptCount: (filing.attemptCount || 0) + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.electronicFilingSubmissions.id, filingId));

    const payload = JSON.parse(filing.artifactDataJson);
    const subResponse = await this.adapter.submitFiling(filingId, payload);

    const newStatus: FilingStatus = subResponse.status as FilingStatus;

    const [updated] = await db
      .update(schema.electronicFilingSubmissions)
      .set({
        status: newStatus,
        externalReference: subResponse.externalReference || null,
        receiptReference: subResponse.receiptReference || null,
        errorCode: subResponse.errorCode || null,
        errorMessage: subResponse.errorMessage || null,
        submittedAt: newStatus === 'SUBMITTED' || newStatus === 'ACCEPTED' ? new Date() : null,
        updatedAt: new Date()
      })
      .where(eq(schema.electronicFilingSubmissions.id, filingId))
      .returning();

    await AuditService.log({
      companyId,
      userId,
      action: 'SUBMIT_FILING',
      entityType: 'ELECTRONIC_FILING',
      entityId: filingId,
      recordReference: `Result Status: ${newStatus}`,
      result: ['SUBMITTED', 'ACCEPTED', 'DEFERRED_EXTERNAL_INTEGRATION'].includes(newStatus) ? 'SUCCESS' : 'FAILED'
    });

    OperationalLogger.info('Filing submission attempted', { filingId, status: newStatus, errorCode: subResponse.errorCode }, { companyId });
    return updated;
  }

  public static async retryFiling(filingId: string, companyId: string, userId: string): Promise<any> {
    const [filing] = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(and(eq(schema.electronicFilingSubmissions.id, filingId), eq(schema.electronicFilingSubmissions.companyId, companyId)));

    if (!filing) throw new Error('FILING_NOT_FOUND');

    if (!['SUBMISSION_FAILED', 'RETRY_PENDING', 'DEFERRED_EXTERNAL_INTEGRATION', 'NOT_CONFIGURED'].includes(filing.status)) {
      throw new Error(`RETRY_NOT_ALLOWED: Filing in status ${filing.status} cannot be retried.`);
    }

    if (filing.attemptCount >= 3) {
      throw new Error('MAX_RETRY_EXCEEDED: Bounded retry limit (3 attempts) reached. Please re-validate or contact support.');
    }

    await db
      .update(schema.electronicFilingSubmissions)
      .set({
        status: 'QUEUED',
        updatedAt: new Date()
      })
      .where(eq(schema.electronicFilingSubmissions.id, filingId))
      .returning();

    await AuditService.log({
      companyId,
      userId,
      action: 'FILING_RETRY',
      entityType: 'ELECTRONIC_FILING',
      entityId: filingId,
      recordReference: `Retry Attempt: ${(filing.attemptCount || 0) + 1}`,
      result: 'SUCCESS'
    });

    return this.submitFiling(filingId, companyId, userId);
  }

  public static async getFiling(filingId: string, companyId: string): Promise<any> {
    const [filing] = await db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(and(eq(schema.electronicFilingSubmissions.id, filingId), eq(schema.electronicFilingSubmissions.companyId, companyId)));

    if (!filing) throw new Error('FILING_NOT_FOUND');
    return filing;
  }

  public static async listFilings(companyId: string): Promise<any[]> {
    return db
      .select()
      .from(schema.electronicFilingSubmissions)
      .where(eq(schema.electronicFilingSubmissions.companyId, companyId))
      .orderBy(desc(schema.electronicFilingSubmissions.createdAt));
  }
}
