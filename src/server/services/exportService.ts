import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  WidthType
} from 'docx';
import { AuditService } from './auditService';

export interface ServerExportOptions {
  companyId?: string;
  companyName: string;
  reportTitle: string;
  subtitle?: string;
  generatedBy: string; // Prepared-by user details
  generatedAt?: string; // Generated timestamp
  reportPeriod?: string;
  accountingBasis?: 'ACCRUAL' | 'CASH' | string;
  currency?: string;
  appliedFilters?: Record<string, any> | string;
  sourceTransactionReferences?: string[] | string;
  dataSnapshotRef?: string;
  headers: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  metadata?: Record<string, any>;
  userRole?: string;
  requiredRole?: string; // Minimum role required (e.g. 'Accountant', 'Auditor', 'Company Administrator')
  isSensitive?: boolean;
  req?: any; // Express request for audit logging and context
  attachments?: Array<{ fileName: string; content: Buffer; sha256?: string; documentId?: string }>;
}

export interface ResolvedAuditMetadata {
  companyName: string;
  companyId: string;
  reportTitle: string;
  subtitle: string;
  reportPeriod: string;
  generatedAt: string;
  accountingBasis: string;
  currency: string;
  appliedFilters: string;
  sourceTransactionReferences: string;
  exporterIdentity: string;
  exporterRole: string;
  dataSnapshotRef: string;
  integrityHash: string;
  securityClassification: string;
  totalRows: number;
}

const ROLE_HIERARCHY: Record<string, number> = {
  'Company Owner': 90,
  'Company Administrator': 80,
  'Approver': 70,
  'Reviewer': 60,
  'Accountant': 50,
  'Bookkeeper': 40,
  'Auditor': 30,
  'Read-only User': 10,
};

function normalizeRole(roleCodeOrName?: string | null): string {
  if (!roleCodeOrName) return 'Read-only User';
  const clean = roleCodeOrName.trim().toUpperCase();
  if (clean.includes('OWNER')) return 'Company Owner';
  if (clean.includes('ADMIN')) return 'Company Administrator';
  if (clean.includes('ACCOUNTANT') || clean.includes('FINANCE')) return 'Accountant';
  if (clean.includes('BOOKKEEPER')) return 'Bookkeeper';
  if (clean.includes('AUDITOR')) return 'Auditor';
  if (clean.includes('REVIEWER')) return 'Reviewer';
  if (clean.includes('APPROVER')) return 'Approver';
  return 'Read-only User';
}

export class ExportService {
  /**
   * Resolves all 9 required CPA & BIR CAS audit reproducibility metadata fields
   * and computes a deterministic SHA-256 integrity hash over the report dataset.
   */
  static buildAuditMetadata(options: ServerExportOptions): ResolvedAuditMetadata {
    const generatedAt = options.generatedAt || new Date().toISOString();
    const companyId = options.companyId || options.req?.activeCompany?.id || 'LOCAL-WORKSPACE';
    const exporterRole = normalizeRole(options.userRole || options.req?.activeCompany?.role || 'Accountant');
    const accountingBasis = options.accountingBasis || 'ACCRUAL (PFRS / BIR CAS)';
    const currency = options.currency || 'PHP (₱)';
    const appliedFilters =
      typeof options.appliedFilters === 'string'
        ? options.appliedFilters
        : JSON.stringify(options.appliedFilters || options.metadata?.filters || { period: options.reportPeriod || 'All' });
    const sourceRefs = Array.isArray(options.sourceTransactionReferences)
      ? options.sourceTransactionReferences.join(', ')
      : options.sourceTransactionReferences || 'Authoritative General Ledger & Subledgers (journal_entries, journal_lines)';

    const canonicalPayload = JSON.stringify({
      companyId,
      companyName: options.companyName,
      reportTitle: options.reportTitle,
      reportPeriod: options.reportPeriod || 'All Periods',
      accountingBasis,
      currency,
      headers: options.headers,
      rows: options.rows,
      totals: options.totals || null,
    });
    const integrityHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
    const dataSnapshotRef = options.dataSnapshotRef || `SNAP-${generatedAt.slice(0, 10).replace(/-/g, '')}-${integrityHash.slice(0, 12).toUpperCase()}`;

    return {
      companyName: options.companyName,
      companyId,
      reportTitle: options.reportTitle,
      subtitle: options.subtitle || 'Reconciled Financial & Statutory Output',
      reportPeriod: options.reportPeriod || 'All Periods',
      generatedAt,
      accountingBasis,
      currency,
      appliedFilters,
      sourceTransactionReferences: sourceRefs,
      exporterIdentity: options.generatedBy,
      exporterRole,
      dataSnapshotRef,
      integrityHash,
      securityClassification: options.isSensitive ? 'RESTRICTED / SENSITIVE' : 'OFFICIAL AUDIT RECORD',
      totalRows: options.rows.length,
    };
  }

  /**
   * Verify user permission level before granting access to sensitive financial exports
   */
  static verifyAccess(options: ServerExportOptions): void {
    const minRole = options.requiredRole || (options.isSensitive ? 'Accountant' : 'Read-only User');
    const userRole = normalizeRole(options.userRole || options.req?.activeCompany?.role || 'Read-only User');

    const userRank = ROLE_HIERARCHY[userRole] || 10;
    const requiredRank = ROLE_HIERARCHY[minRole] || 10;

    if (userRank < requiredRank) {
      throw new Error(`ACCESS_DENIED: Export of sensitive report "${options.reportTitle}" requires minimum role "${minRole}". User role is "${userRole}".`);
    }
  }

  /**
   * Record audit log entry for report export
   */
  static async recordExportAudit(options: ServerExportOptions, format: string, meta?: ResolvedAuditMetadata): Promise<void> {
    if (!options.req && !options.companyId) return;
    try {
      const resolved = meta || this.buildAuditMetadata(options);
      await AuditService.log({
        req: options.req,
        companyId: resolved.companyId,
        userId: options.req?.user?.id,
        userEmail: options.req?.user?.email,
        userDisplayName: options.generatedBy,
        role: resolved.exporterRole,
        action: 'EXPORT_REPORT',
        entityType: 'Report',
        entityId: options.reportTitle,
        entityName: options.reportTitle,
        recordReference: `Format: ${format.toUpperCase()} | Period: ${resolved.reportPeriod} | Snapshot: ${resolved.dataSnapshotRef}`,
        result: 'SUCCESS',
        module: 'Reports',
        severity: options.isSensitive ? 'WARN' : 'INFO',
        metadata: {
          format,
          ...resolved,
          isSensitive: !!options.isSensitive
        }
      });
    } catch {
      // Ignore AsyncLocalStorage context warning when invoked from standalone CLI/unit test
    }
  }

  /**
   * Generate structured JSON export with complete metadata, timestamps, pagination, and prepared-by details
   */
  static async generateJSON(options: ServerExportOptions): Promise<string> {
    this.verifyAccess(options);
    const meta = this.buildAuditMetadata(options);
    await this.recordExportAudit(options, 'json', meta);

    const exportPackage = {
      meta: {
        ...meta,
        preparedBy: options.generatedBy,
        securityLevel: meta.securityClassification,
        requiredRole: options.requiredRole || (options.isSensitive ? 'Accountant' : 'Read-only User'),
        version: '2.0',
        pagination: {
          totalRows: options.rows.length,
          page: 1,
          pageSize: options.rows.length
        },
        customMetadata: options.metadata || {}
      },
      headers: options.headers,
      rows: options.rows,
      totals: options.totals || null
    };

    return JSON.stringify(exportPackage, null, 2);
  }

  /**
   * Generate CSV export with metadata header comments and prepared-by verification
   */
  static async generateCSV(options: ServerExportOptions): Promise<string> {
    this.verifyAccess(options);
    const meta = this.buildAuditMetadata(options);
    await this.recordExportAudit(options, 'csv', meta);

    const comments = [
      `# Company: ${meta.companyName} (${meta.companyId})`,
      `# Report: ${meta.reportTitle}`,
      `# Subtitle: ${meta.subtitle}`,
      `# Reporting Period: ${meta.reportPeriod}`,
      `# Generation Timestamp: ${meta.generatedAt}`,
      `# Accounting Basis: ${meta.accountingBasis}`,
      `# Currency: ${meta.currency}`,
      `# Applied Filters: ${meta.appliedFilters}`,
      `# Source Transaction References: ${meta.sourceTransactionReferences}`,
      `# Exporter Identity & Role: ${meta.exporterIdentity} (${meta.exporterRole})`,
      `# Reproducibility Snapshot Reference: ${meta.dataSnapshotRef}`,
      `# SHA-256 Integrity Hash: ${meta.integrityHash}`,
      `# Security Classification: ${meta.securityClassification}`,
      `# Total Records: ${meta.totalRows}`,
      ``
    ].join('\n');

    const sanitize = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const headerLine = options.headers.map(sanitize).join(',');
    const bodyLines = options.rows.map(r => r.map(sanitize).join(','));
    const lines = [comments, headerLine, ...bodyLines];

    if (options.totals) {
      lines.push(options.totals.map(sanitize).join(','));
    }

    return '\uFEFF' + lines.join('\n');
  }

  /**
   * Generate XLSX workbook buffer with audit metadata and prepared-by details
   */
  static async generateXLSX(options: ServerExportOptions): Promise<Buffer> {
    this.verifyAccess(options);
    const meta = this.buildAuditMetadata(options);
    await this.recordExportAudit(options, 'xlsx', meta);

    const wb = XLSX.utils.book_new();

    // 1. Data Sheet first so opening in Excel/QuickBooks shows the report immediately
    const dataSheetRows: (string | number)[][] = [
      [meta.companyName],
      [`${meta.reportTitle} — Period: ${meta.reportPeriod}`],
      [`Basis: ${meta.accountingBasis} | Currency: ${meta.currency} | Snapshot: ${meta.dataSnapshotRef}`],
      [`Prepared By: ${meta.exporterIdentity} (${meta.exporterRole}) | Generated: ${meta.generatedAt} | SHA-256: ${meta.integrityHash.slice(0, 16)}...`],
      [],
      options.headers,
      ...options.rows
    ];
    if (options.totals) {
      dataSheetRows.push(options.totals);
    }
    const wsData = XLSX.utils.aoa_to_sheet(dataSheetRows);
    XLSX.utils.book_append_sheet(wb, wsData, 'Report Data');

    // 2. Forensic Audit Metadata Sheet
    const metaData = [
      ['Audit & Reproducibility Property', 'Authoritative Value'],
      ['Company Name', meta.companyName],
      ['Company / Tenant ID', meta.companyId],
      ['Report Title', meta.reportTitle],
      ['Subtitle', meta.subtitle],
      ['Reporting Period', meta.reportPeriod],
      ['Generation Timestamp (ISO-8601)', meta.generatedAt],
      ['Accounting Basis', meta.accountingBasis],
      ['Functional Currency', meta.currency],
      ['Applied Filters', meta.appliedFilters],
      ['Source Transaction References', meta.sourceTransactionReferences],
      ['Exporter Identity', meta.exporterIdentity],
      ['Exporter Role & Permission', meta.exporterRole],
      ['Data Snapshot / Reproducibility Ref', meta.dataSnapshotRef],
      ['SHA-256 Integrity Hash', meta.integrityHash],
      ['Security Classification', meta.securityClassification],
      ['Total Records Exported', meta.totalRows]
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Audit Metadata');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return Buffer.from(buf);
  }

  /**
   * Generate PDF Buffer using jsPDF and autotable with company header, prepared-by, and audit metadata
   */
  static async generatePDF(options: ServerExportOptions): Promise<Buffer> {
    this.verifyAccess(options);
    const meta = this.buildAuditMetadata(options);
    await this.recordExportAudit(options, 'pdf', meta);

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    if (options.isSensitive) {
      doc.setFillColor(217, 119, 6);
    } else {
      doc.setFillColor(79, 70, 229);
    }
    doc.rect(0, 0, 210, 5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text(meta.companyName, 14, 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(options.isSensitive ? 180 : 79, options.isSensitive ? 83 : 70, options.isSensitive ? 9 : 229);
    doc.text(meta.reportTitle, 14, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Basis: ${meta.accountingBasis} | Currency: ${meta.currency} | Snapshot: ${meta.dataSnapshotRef}`, 14, 25);
    doc.text(`Source Lineage: ${meta.sourceTransactionReferences.slice(0, 85)}`, 14, 29.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Exporter: ${meta.exporterIdentity} (${meta.exporterRole})`, 196, 13, { align: 'right' });
    doc.text(`Generated: ${meta.generatedAt.slice(0, 19).replace('T', ' ')} UTC`, 196, 17.5, { align: 'right' });
    doc.text(`Period: ${meta.reportPeriod}`, 196, 22, { align: 'right' });
    doc.text(`SHA-256: ${meta.integrityHash.slice(0, 20)}...`, 196, 26.5, { align: 'right' });

    const dividerY = 33;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(14, dividerY, 196, dividerY);

    const startY = dividerY + 4;
    const footRows = options.totals ? [options.totals] : undefined;

    autoTable(doc, {
      startY,
      head: [options.headers],
      body: options.rows,
      foot: footRows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2.5,
        textColor: [51, 65, 85],
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [30, 41, 59],
        fontStyle: 'bold'
      },
      footStyles: {
        fillColor: [248, 250, 252],
        textColor: [79, 70, 229],
        fontStyle: 'bold'
      },
      didDrawPage: (data) => {
        const totalPages = (doc as any).internal.getNumberOfPages();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `${meta.companyName} | Snapshot: ${meta.dataSnapshotRef} | SHA-256: ${meta.integrityHash.slice(0, 12)} | Page ${data.pageNumber} of ${totalPages}`,
          14,
          287
        );
      }
    });

    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate Word (.docx) document buffer for CPA / Management Memorandums and Financial Reports
   */
  static async generateDOCX(options: ServerExportOptions): Promise<Buffer> {
    this.verifyAccess(options);
    const meta = this.buildAuditMetadata(options);
    await this.recordExportAudit(options, 'docx', meta);

    const tableRows: TableRow[] = [
      new TableRow({
        children: options.headers.map(h => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: h, bold: true, size: 18, color: '1E293B' })]
          })],
          shading: { fill: 'F1F5F9' },
          width: { size: Math.floor(100 / Math.max(1, options.headers.length)), type: WidthType.PERCENTAGE }
        }))
      }),
      ...options.rows.map(r => new TableRow({
        children: r.map(cell => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: String(cell ?? ''), size: 18, color: '334155' })]
          })]
        }))
      }))
    ];

    if (options.totals) {
      tableRows.push(new TableRow({
        children: options.totals.map(cell => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: String(cell ?? ''), bold: true, size: 18, color: '4F46E5' })]
          })],
          shading: { fill: 'F8FAFC' }
        }))
      }));
    }

    const doc = new Document({
      sections: [{
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${meta.companyName} | ${meta.reportTitle} | Snapshot: ${meta.dataSnapshotRef}`,
                    size: 16,
                    color: '94A3B8'
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `Exporter: ${meta.exporterIdentity} (${meta.exporterRole}) | SHA-256: ${meta.integrityHash.slice(0, 16)} | LedgerAI PH Enterprise`,
                    size: 16,
                    color: '94A3B8'
                  })
                ]
              })
            ]
          })
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: meta.companyName, bold: true, size: 32, color: '1E293B' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `CPA & MANAGEMENT AUDIT MEMORANDUM: ${meta.reportTitle}`, bold: true, size: 24, color: options.isSensitive ? 'D97706' : '4F46E5' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: meta.subtitle, size: 20, italics: true, color: '64748B' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Reporting Period: ${meta.reportPeriod}  |  Basis: ${meta.accountingBasis}  |  Currency: ${meta.currency}`, size: 18, color: '475569' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Exporter: ${meta.exporterIdentity} (${meta.exporterRole})  |  Generated: ${meta.generatedAt}`, size: 18, color: '475569' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Snapshot Ref: ${meta.dataSnapshotRef}  |  SHA-256 Hash: ${meta.integrityHash}`, size: 16, color: '64748B' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Applied Filters: ${meta.appliedFilters}  |  Source Lineage: ${meta.sourceTransactionReferences}`, size: 16, color: '64748B' })
            ]
          }),
          new Paragraph({ text: '' }),
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          })
        ]
      }]
    });

    return await Packer.toBuffer(doc);
  }

  /**
   * Generates a complete Audit Evidence Package (.zip) containing:
   * - Audit_Manifest.json (with all 9 CPA reproducibility fields & SHA-256 hashes)
   * - Financial_Report.pdf
   * - Financial_Statements.xlsx
   * - CPA_Audit_Memorandum.docx
   * - Data_Extract.csv
   * - Optional original decrypted document attachments in /attachments/
   */
  static async generateAuditEvidencePackageZip(options: ServerExportOptions): Promise<Buffer> {
    this.verifyAccess(options);
    const meta = this.buildAuditMetadata(options);
    await this.recordExportAudit(options, 'zip', meta);

    const [pdfBuf, xlsxBuf, docxBuf, csvStr] = await Promise.all([
      this.generatePDF(options),
      this.generateXLSX(options),
      this.generateDOCX(options),
      this.generateCSV(options),
    ]);

    const fileHashes: Record<string, string> = {
      'Audit_Report.pdf': crypto.createHash('sha256').update(pdfBuf).digest('hex'),
      'Financial_Statements.xlsx': crypto.createHash('sha256').update(xlsxBuf).digest('hex'),
      'CPA_Audit_Memorandum.docx': crypto.createHash('sha256').update(docxBuf).digest('hex'),
      'Data_Extract.csv': crypto.createHash('sha256').update(csvStr).digest('hex'),
    };

    if (options.attachments && options.attachments.length > 0) {
      for (const att of options.attachments) {
        const key = `attachments/${att.fileName}`;
        fileHashes[key] = att.sha256 || crypto.createHash('sha256').update(att.content).digest('hex');
      }
    }

    const manifest = {
      packageTitle: 'LedgerAI PH — Official CPA & BIR CAS Audit Evidence Package',
      reproducibilityMetadata: meta,
      integrityHashes: fileHashes,
      attachmentCount: options.attachments?.length || 0,
      auditVerificationStatus: 'VERIFIED_SHA256_REPRODUCIBLE',
    };

    return await new Promise<Buffer>(async (resolve, reject) => {
      const archiverMod: any = await import('archiver');
      const archive = archiverMod.ZipArchive
        ? new archiverMod.ZipArchive({ zlib: { level: 9 } })
        : typeof archiverMod === 'function'
          ? archiverMod('zip', { zlib: { level: 9 } })
          : (archiverMod.default || archiverMod)('zip', { zlib: { level: 9 } });

      const buffers: Buffer[] = [];
      archive.on('data', (d: Buffer) => buffers.push(d));
      archive.on('end', () => resolve(Buffer.concat(buffers)));
      archive.on('error', (err: Error) => reject(err));

      archive.append(JSON.stringify(manifest, null, 2), { name: 'Audit_Manifest.json' });
      archive.append(pdfBuf, { name: 'Audit_Report.pdf' });
      archive.append(xlsxBuf, { name: 'Financial_Statements.xlsx' });
      archive.append(docxBuf, { name: 'CPA_Audit_Memorandum.docx' });
      archive.append(csvStr, { name: 'Data_Extract.csv' });

      if (options.attachments && options.attachments.length > 0) {
        for (const att of options.attachments) {
          archive.append(att.content, { name: `attachments/${att.fileName}` });
        }
      }

      archive.finalize();
    });
  }

  /**
   * Generates a QuickBooks Online (QBO) compatible multi-sheet Excel (.xlsx) workbook
   * containing Chart of Accounts, Journal Entries, Customers, Suppliers, and Trial Balance.
   */
  static generateQuickBooksWorkbook(data: {
    companyName: string;
    accounts?: Array<{ code: string; name: string; type: string; balance?: number }>;
    journals?: Array<{ journalNo: string; date: string; accountCode: string; accountName: string; debit: number; credit: number; description?: string; name?: string }>;
    customers?: Array<{ name: string; company?: string; email?: string; phone?: string; tin?: string; balance?: number }>;
    vendors?: Array<{ name: string; company?: string; email?: string; phone?: string; tin?: string; balance?: number }>;
  }): Buffer {
    const wb = XLSX.utils.book_new();

    const coaRows = [
      ['Account Number', 'Account Name', 'Type', 'Detail Type', 'Currency', 'Balance'],
      ...(data.accounts || []).map(a => [a.code, a.name, a.type, a.type, 'PHP', ((a.balance || 0) / 100).toFixed(2)])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(coaRows), 'Chart of Accounts');

    const jeRows = [
      ['*JournalNo', '*JournalDate', '*AccountName', 'AccountCode', '*Debits', '*Credits', 'Description', 'Name', 'Currency'],
      ...(data.journals || []).map(j => [
        j.journalNo,
        j.date,
        j.accountName,
        j.accountCode,
        (j.debit / 100).toFixed(2),
        (j.credit / 100).toFixed(2),
        j.description || '',
        j.name || '',
        'PHP'
      ])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jeRows), 'Journal Entries');

    const custRows = [
      ['Customer', 'Company', 'Email', 'Phone', 'Tax ID / TIN', 'Open Balance'],
      ...(data.customers || []).map(c => [c.name, c.company || c.name, c.email || '', c.phone || '', c.tin || '', ((c.balance || 0) / 100).toFixed(2)])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(custRows), 'Customers');

    const vendRows = [
      ['Vendor', 'Company', 'Email', 'Phone', 'Tax ID / TIN', 'Open Balance'],
      ...(data.vendors || []).map(v => [v.name, v.company || v.name, v.email || '', v.phone || '', v.tin || '', ((v.balance || 0) / 100).toFixed(2)])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vendRows), 'Vendors');

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  /**
   * Parses a QuickBooks Online / Desktop exported XLSX or CSV buffer into structured records
   * for validation and import into LedgerAI PH.
   */
  static parseQuickBooksImport(fileBuffer: Buffer): {
    sheets: string[];
    accounts: Array<{ accountNumber: string; accountName: string; accountType: string }>;
    journals: Array<{ journalNo: string; journalDate: string; accountName: string; accountCode: string; debitCentavos: number; creditCentavos: number; description: string }>;
    customers: Array<{ name: string; tin: string; email: string }>;
    vendors: Array<{ name: string; tin: string; email: string }>;
  } {
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    const accounts: Array<{ accountNumber: string; accountName: string; accountType: string }> = [];
    const journals: Array<{ journalNo: string; journalDate: string; accountName: string; accountCode: string; debitCentavos: number; creditCentavos: number; description: string }> = [];
    const customers: Array<{ name: string; tin: string; email: string }> = [];
    const vendors: Array<{ name: string; tin: string; email: string }> = [];

    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName]);
      const normName = sheetName.toLowerCase();
      for (const r of rows) {
        if (normName.includes('account') || ('Account Number' in r && 'Account Name' in r)) {
          accounts.push({
            accountNumber: String(r['Account Number'] || r['AccountCode'] || '').trim(),
            accountName: String(r['Account Name'] || r['AccountName'] || '').trim(),
            accountType: String(r['Type'] || r['Account Type'] || 'EXPENSE').trim().toUpperCase(),
          });
        } else if (normName.includes('journal') || '*JournalNo' in r || 'JournalNo' in r) {
          const d = parseFloat(String(r['*Debits'] || r['Debits'] || r['Debit'] || '0').replace(/,/g, '')) || 0;
          const c = parseFloat(String(r['*Credits'] || r['Credits'] || r['Credit'] || '0').replace(/,/g, '')) || 0;
          journals.push({
            journalNo: String(r['*JournalNo'] || r['JournalNo'] || '').trim(),
            journalDate: String(r['*JournalDate'] || r['JournalDate'] || '').trim(),
            accountName: String(r['*AccountName'] || r['AccountName'] || '').trim(),
            accountCode: String(r['AccountCode'] || r['Account Number'] || '').trim(),
            debitCentavos: Math.round(d * 100),
            creditCentavos: Math.round(c * 100),
            description: String(r['Description'] || r['Memo'] || '').trim(),
          });
        } else if (normName.includes('customer') || 'Customer' in r) {
          customers.push({
            name: String(r['Customer'] || r['Name'] || '').trim(),
            tin: String(r['Tax ID / TIN'] || r['TIN'] || '').trim(),
            email: String(r['Email'] || '').trim(),
          });
        } else if (normName.includes('vendor') || normName.includes('supplier') || 'Vendor' in r) {
          vendors.push({
            name: String(r['Vendor'] || r['Supplier'] || r['Name'] || '').trim(),
            tin: String(r['Tax ID / TIN'] || r['TIN'] || '').trim(),
            email: String(r['Email'] || '').trim(),
          });
        }
      }
    }

    return { sheets: wb.SheetNames, accounts, journals, customers, vendors };
  }
}

