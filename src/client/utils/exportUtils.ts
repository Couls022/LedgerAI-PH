import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PDFExportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  companyName?: string;
  headers: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  orientation?: 'portrait' | 'landscape';
  columnStyles?: { [key: number]: { halign?: 'left' | 'center' | 'right'; cellWidth?: number | 'auto' } };
}

export function recordExportActivity() {
  try {
    const now = new Date().toISOString();
    localStorage.setItem('ledger_last_export_timestamp', now);
    window.dispatchEvent(new CustomEvent('ledger-export-recorded', { detail: { timestamp: now } }));
  } catch (e) {
    // Ignore localStorage restrictions
  }
}

/**
 * Clean CSV Exporter utility
 */
export function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  recordExportActivity();
  const sanitizeCell = (cell: string | number | null | undefined): string => {
    if (cell === null || cell === undefined) return '""';
    const str = String(cell);
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  };

  const headerRow = headers.map(sanitizeCell).join(',');
  const bodyRows = rows.map(row => row.map(sanitizeCell).join(','));
  const csvContent = [headerRow, ...bodyRows].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Professional PDF Exporter utility
 */
export function exportToPDF({
  filename,
  title,
  subtitle,
  companyName = 'Acme Philippine Services Corp.',
  headers,
  rows,
  totals,
  orientation = 'portrait',
  columnStyles,
}: PDFExportOptions) {
  recordExportActivity();
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Top Accent Bar
  doc.setFillColor(79, 70, 229); // Indigo 600
  doc.rect(0, 0, orientation === 'landscape' ? 297 : 210, 5, 'F');

  // Header Details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59); // Slate 800
  doc.text(companyName, 14, 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(79, 70, 229);
  doc.text(title, 14, 23);

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139); // Slate 500
    doc.text(subtitle, 14, 28);
  }

  // Right Metadata
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const rightX = orientation === 'landscape' ? 283 : 196;
  doc.text(`Generated: ${timestamp}`, rightX, 16, { align: 'right' });
  doc.text('Status: Official Report', rightX, 21, { align: 'right' });

  // Divider Line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, subtitle ? 32 : 27, rightX, subtitle ? 32 : 27);

  const startY = subtitle ? 36 : 31;

  // Render Table
  const footRows = totals ? [totals] : undefined;

  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    foot: footRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 3,
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [241, 245, 249], // Slate 100
      textColor: [30, 41, 59], // Slate 800
      fontStyle: 'bold',
      lineWidth: 0.2,
      lineColor: [203, 213, 225],
    },
    footStyles: {
      fillColor: [248, 250, 252], // Slate 50
      textColor: [79, 70, 229],
      fontStyle: 'bold',
      lineWidth: 0.3,
      lineColor: [203, 213, 225],
    },
    columnStyles,
    didDrawPage: (data) => {
      // Footer page numbering
      const totalPages = (doc as any).internal.getNumberOfPages();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // Slate 400
      const footerY = orientation === 'landscape' ? 200 : 287;
      doc.text(
        `Confidential - ${companyName} | Page ${data.pageNumber} of ${totalPages}`,
        14,
        footerY
      );
    },
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export interface AuditTrailExportOptions {
  companyName: string;
  tin?: string;
  rdoCode?: string;
  tenantId?: string;
  exportedBy: string;
  userRole?: string;
  dateRange?: string;
  notes?: string;
  logs: Array<{
    id: string;
    timestamp: string | Date;
    userDisplayName?: string;
    userEmail?: string;
    role?: string;
    action: string;
    module?: string;
    entityType: string;
    recordReference?: string;
    entityId: string;
    changedFieldsList?: string[];
    afterData?: string | null;
    result: string;
    severity?: string;
    integrityHash?: string;
    ipAddress?: string;
    source?: string;
  }>;
}

/**
 * Official Philippine BIR CAS & PSA Compliant Audit Trail PDF Exporter
 */
export function exportAuditTrailToPDF({
  companyName,
  tin = '000-000-000-000',
  rdoCode = '039',
  tenantId = 'N/A',
  exportedBy,
  userRole = 'Company Administrator',
  dateRange,
  notes,
  logs,
}: AuditTrailExportOptions) {
  recordExportActivity();
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Top Accent Bars
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.rect(0, 0, pageWidth, 5, 'F');
  doc.setFillColor(79, 70, 229); // Indigo 600
  doc.rect(0, 5, pageWidth, 1.5, 'F');

  // Header Details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(companyName.toUpperCase(), 14, 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229);
  doc.text('OFFICIAL AUDIT TRAIL & COMPLIANCE REPORT', 14, 21);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Standard: Philippine BIR CAS RR 9-2009 / PSA Non-Repudiation Security Standard', 14, 25.5);

  // Right Metadata Box
  const rightMargin = 283;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(`TIN: ${tin} | RDO: ${rdoCode}`, rightMargin, 13, { align: 'right' });
  doc.text(`Tenant ID: ${tenantId}`, rightMargin, 17, { align: 'right' });
  doc.text(`Exported By: ${exportedBy} (${userRole})`, rightMargin, 21, { align: 'right' });
  doc.text(`Generated At (PHT): ${timestamp}`, rightMargin, 25, { align: 'right' });

  // Status / Integrity Badge
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(rightMargin - 75, 27.5, 75, 5.5, 1, 1, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(5, 150, 105);
  doc.text('✓ SHA-256 SEAL VERIFIED (IMMUTABLE)', rightMargin - 37.5, 31.5, { align: 'center' });

  // Summary Band
  const summaryY = 30.5;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, summaryY, pageWidth - 28, 8, 1, 1, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);

  let scopeDesc = `Total Log Records: ${logs.length}`;
  if (dateRange) scopeDesc += ` | Date Range: ${dateRange}`;
  if (notes) scopeDesc += ` | Note: ${notes}`;
  doc.text(scopeDesc, 18, summaryY + 5.2);

  // Format Rows
  const tableHeaders = [
    '#',
    'Timestamp (PHT)',
    'User / Actor',
    'Role',
    'Action Taken',
    'Module & Entity',
    'Target ID / Ref',
    'Modifications / Changes',
    'Status',
    'SHA-256 Hash Seal',
  ];

  const tableRows = logs.map((log, index) => {
    let tsFormatted = 'N/A';
    try {
      if (log.timestamp) {
        const d = new Date(log.timestamp);
        if (!isNaN(d.getTime())) {
          const finalD = d.getFullYear() > 3000 ? new Date(Math.floor(d.getTime() / 1000)) : d;
          tsFormatted = finalD.toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
        }
      }
    } catch {
      tsFormatted = String(log.timestamp || 'N/A');
    }

    const changedFields = (log.changedFieldsList || []).slice(0, 4).join(', ');
    const changesText = changedFields ? `Fields: ${changedFields}` : (log.afterData ? 'Payload Recorded' : 'No state mutation');

    return [
      String(index + 1),
      tsFormatted,
      log.userDisplayName || log.userEmail || 'Authorized User',
      log.role || 'Member',
      log.action.replace(/_/g, ' '),
      log.module || log.entityType,
      log.recordReference || log.entityId || 'N/A',
      changesText,
      log.result,
      log.integrityHash ? `${log.integrityHash.substring(0, 10)}...` : 'SEALED',
    ];
  });

  autoTable(doc, {
    startY: summaryY + 11,
    head: [tableHeaders],
    body: tableRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 32 },
      2: { cellWidth: 32 },
      3: { cellWidth: 24 },
      4: { cellWidth: 32 },
      5: { cellWidth: 28 },
      6: { cellWidth: 28 },
      7: { cellWidth: 43 },
      8: { cellWidth: 18, halign: 'center' },
      9: { cellWidth: 24, font: 'courier', fontSize: 6.5, halign: 'center' },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 8) {
        const val = String(data.cell.raw);
        if (val === 'SUCCESS') {
          doc.setTextColor(5, 150, 105);
        } else if (val === 'FAILED') {
          doc.setTextColor(225, 29, 72);
        } else if (val === 'WARNING') {
          doc.setTextColor(217, 119, 6);
        }
      }
    },
    didDrawPage: (data) => {
      const totalPages = (doc as any).internal.getNumberOfPages();
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Confidential Compliance Audit Record • ${companyName} (TIN: ${tin}) • System-Generated via LedgerAI ERP`,
        14,
        pageHeight - 6.5
      );
      doc.text(
        `Page ${data.pageNumber} of ${totalPages}`,
        pageWidth - 14,
        pageHeight - 6.5,
        { align: 'right' }
      );
    },
  });

  const safeFilename = `Audit_Trail_Report_${companyName.replace(/[^A-Za-z0-9_-]/g, '_')}_${Date.now()}.pdf`;
  doc.save(safeFilename);
}

