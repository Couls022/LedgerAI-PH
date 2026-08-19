export interface FilingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FilingPackageResult {
  packageReady: boolean;
  checksum: string;
  metadata: {
    version: string;
    schemaVersion: string;
    timestamp: string;
    companyId: string;
    filingType: string;
    reportingPeriod: string;
    recordCount: number;
    checksum?: string;
  };
}

export interface SubmissionResponse {
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'NOT_CONFIGURED' | 'DEFERRED_EXTERNAL_INTEGRATION';
  externalReference?: string;
  receiptReference?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
}

export interface TaxFilingAdapter {
  name: string;
  validate(payload: any): FilingValidationResult;
  preparePackage(payload: any): FilingPackageResult;
  submitFiling(submissionId: string, payload: any): Promise<SubmissionResponse>;
  getStatus(externalReference: string): Promise<SubmissionResponse>;
  retrieveReceipt(externalReference: string): Promise<any>;
}

export class OfficialBirAdapter implements TaxFilingAdapter {
  public name = 'OfficialBirAdapter';

  public validate(payload: any): FilingValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!payload) {
      errors.push('Filing payload is missing.');
      return { valid: false, errors, warnings };
    }

    if (!payload.companyId) errors.push('Company ID is required.');
    if (!payload.tin || !/^\d{3}-\d{3}-\d{3}-\d{3,5}$/.test(payload.tin)) {
      errors.push('Valid taxpayer TIN in format XXX-XXX-XXX-XXX is required.');
    }
    if (!payload.filingType) errors.push('Filing tax form / type is required.');
    if (!payload.reportingPeriod) errors.push('Reporting period is required.');

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  public preparePackage(payload: any): FilingPackageResult {
    const val = this.validate(payload);
    if (!val.valid) {
      throw new Error(`VALIDATION_FAILED: ${val.errors.join(', ')}`);
    }

    const dataString = JSON.stringify(payload);
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256').update(dataString).digest('hex');

    return {
      packageReady: true,
      checksum,
      metadata: {
        version: '1.0',
        schemaVersion: 'BIR-EOPT-2026-V1',
        timestamp: new Date().toISOString(),
        companyId: payload.companyId,
        filingType: payload.filingType,
        reportingPeriod: payload.reportingPeriod,
        recordCount: payload.records?.length || 0,
        checksum
      }
    };
  }

  public async submitFiling(submissionId: string, payload: any): Promise<SubmissionResponse> {
    // CRITICAL COMPLIANCE RULE:
    // No direct official public open API exists for automated direct electronic submission 
    // without accredited ESSP / Tax Intermediary gateway integration.
    // Per strict instructions: DO NOT simulate successful filing or fabricate receipts.
    return {
      status: 'DEFERRED_EXTERNAL_INTEGRATION',
      errorCode: 'NOT_CONFIGURED',
      errorMessage: 'Official BIR direct automated API submission is currently in DEFERRED_EXTERNAL_INTEGRATION status. Awaiting official BIR/ESSP gateway accreditation and API endpoint release.',
      timestamp: new Date().toISOString()
    };
  }

  public async getStatus(externalReference: string): Promise<SubmissionResponse> {
    return {
      status: 'DEFERRED_EXTERNAL_INTEGRATION',
      externalReference,
      errorCode: 'NOT_CONFIGURED',
      errorMessage: 'External integration is deferred. No active status check available.',
      timestamp: new Date().toISOString()
    };
  }

  public async retrieveReceipt(externalReference: string): Promise<any> {
    throw new Error('RECEIPT_NOT_AVAILABLE: No external receipt exists because electronic filing submission is in DEFERRED_EXTERNAL_INTEGRATION status.');
  }
}
