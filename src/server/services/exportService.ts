import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { AuditService } from './auditService';

export interface ServerExportOptions {
  companyId?: string;
  companyName: string;
  reportTitle: string;
  subtitle?: string;
  generatedBy: string; // Prepared-by user details
  generatedAt?: string; // Generated timestamp
  reportPeriod?: string;
  headers: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  metadata?: Record<string, any>;
  userRole?: string;
  requiredRole?: string; // Minimum role required (e.g. 'Accountant', 'Auditor', 'Company Administrator')
  isSensitive?: boolean;
  req?: any; // Express request for audit logging and context
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
  static async recordExportAudit(options: ServerExportOptions, format: string): Promise<void> {
    try {
      await AuditService.log({
        req: options.req,
        companyId: options.companyId || options.req?.activeCompany?.id,
        userId: options.req?.user?.id,
        userEmail: options.req?.user?.email,
        userDisplayName: options.generatedBy,
        role: options.userRole || options.req?.activeCompany?.role,
        action: 'EXPORT_REPORT',
        entityType: 'Report',
        entityId: options.reportTitle,
        entityName: options.reportTitle,
        recordReference: `Format: ${format.toUpperCase()} | Period: ${options.reportPeriod || 'All'} | Rows: ${options.rows.length}`,
        result: 'SUCCESS',
        module: 'Reports',
        severity: options.isSensitive ? 'WARN' : 'INFO',
        metadata: {
          format,
          reportTitle: options.reportTitle,
          companyName: options.companyName,
          generatedBy: options.generatedBy,
          generatedAt: options.generatedAt || new Date().toISOString(),
          totalRows: options.rows.length,
          isSensitive: !!options.isSensitive
        }
      });
    } catch (err) {
      console.error('Failed to record export audit log:', err);
    }
  }

  /**
   * Generate structured JSON export with complete metadata, timestamps, pagination, and prepared-by details
   */
  static async generateJSON(options: ServerExportOptions): Promise<string> {
    this.verifyAccess(options);
    const generatedAt = options.generatedAt || new Date().toISOString();
    await this.recordExportAudit(options, 'json');

    const exportPackage = {
      meta: {
        companyName: options.companyName,
        reportTitle: options.reportTitle,
        subtitle: options.subtitle || '',
        preparedBy: options.generatedBy,
        generatedAt,
        reportPeriod: options.reportPeriod || 'All Periods',
        securityLevel: options.isSensitive ? 'RESTRICTED / SENSITIVE' : 'STANDARD',
        requiredRole: options.requiredRole || (options.isSensitive ? 'Accountant' : 'Read-only User'),
        version: '1.0',
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
    const generatedAt = options.generatedAt || new Date().toLocaleString();
    await this.recordExportAudit(options, 'csv');

    const comments = [
      `# Company: ${options.companyName}`,
      `# Report: ${options.reportTitle}`,
      `# Subtitle: ${options.subtitle || 'N/A'}`,
      `# Prepared By: ${options.generatedBy}`,
      `# Generated At: ${generatedAt}`,
      `# Period: ${options.reportPeriod || 'All Periods'}`,
      `# Security Classification: ${options.isSensitive ? 'RESTRICTED / SENSITIVE' : 'STANDARD'}`,
      `# Total Records: ${options.rows.length}`,
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
    const generatedAt = options.generatedAt || new Date().toISOString();
    await this.recordExportAudit(options, 'xlsx');

    const wb = XLSX.utils.book_new();

    // 1. Metadata Sheet
    const metaData = [
      ['Report Property', 'Value'],
      ['Company Name', options.companyName],
      ['Report Title', options.reportTitle],
      ['Subtitle', options.subtitle || 'N/A'],
      ['Prepared By (User)', options.generatedBy],
      ['Generated At', generatedAt],
      ['Report Period', options.reportPeriod || 'All Periods'],
      ['Security Classification', options.isSensitive ? 'RESTRICTED / SENSITIVE' : 'STANDARD'],
      ['Minimum Role Required', options.requiredRole || (options.isSensitive ? 'Accountant' : 'Read-only User')],
      ['Total Records', options.rows.length]
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Audit Metadata');

    // 2. Data Sheet
    const dataSheetRows = [
      options.headers,
      ...options.rows
    ];
    if (options.totals) {
      dataSheetRows.push(options.totals);
    }
    const wsData = XLSX.utils.aoa_to_sheet(dataSheetRows);
    XLSX.utils.book_append_sheet(wb, wsData, 'Report Data');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buf;
  }

  /**
   * Generate PDF Buffer using jsPDF and autotable with company header, prepared-by, and audit metadata
   */
  static async generatePDF(options: ServerExportOptions): Promise<Buffer> {
    this.verifyAccess(options);
    const generatedAt = options.generatedAt || new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    await this.recordExportAudit(options, 'pdf');

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Top Accent Bar (Indigo for standard, Amber/Red if sensitive)
    if (options.isSensitive) {
      doc.setFillColor(217, 119, 6); // Amber
    } else {
      doc.setFillColor(79, 70, 229); // Indigo
    }
    doc.rect(0, 0, 210, 5, 'F');

    // Header Details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(30, 41, 59);
    doc.text(options.companyName, 14, 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(options.isSensitive ? 180 : 79, options.isSensitive ? 83 : 70, options.isSensitive ? 9 : 229);
    doc.text(options.reportTitle, 14, 23);

    if (options.subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(options.subtitle, 14, 28);
    }

    // Right Metadata: Prepared By & Timestamp
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Prepared By: ${options.generatedBy}`, 196, 14, { align: 'right' });
    doc.text(`Generated: ${generatedAt}`, 196, 19, { align: 'right' });
    doc.text(`Period: ${options.reportPeriod || 'All Periods'}`, 196, 24, { align: 'right' });
    if (options.isSensitive) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(217, 119, 6);
      doc.text(`[RESTRICTED / SENSITIVE]`, 196, 29, { align: 'right' });
    }

    // Divider Line
    const dividerY = options.isSensitive ? 31 : (options.subtitle ? 32 : 27);
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
        fontSize: 8.5,
        cellPadding: 3,
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
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Official Audit & Financial Package - ${options.companyName} | Prepared by: ${options.generatedBy} | Page ${data.pageNumber} of ${totalPages}`,
          14,
          287
        );
      }
    });

    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
  }
}
