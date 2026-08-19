import { Router } from "express";
import { requireAuth, requireMinRole } from "../auth";
import { BirComplianceService } from "../services/birComplianceService";
import { ExportService } from "../services/exportService";
import { db } from "../db";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// POST /api/compliance/bir/form-2307
router.post("/form-2307", requireAuth, requireMinRole('Accountant'), async (req, res, next) => {
  try {
    const companyId = req.activeCompany!.id;
    const compRecord = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyName = compRecord?.legalName || (req.activeCompany as any)?.legalName || "Active Company";
    const { startDate, endDate, format = 'json' } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "MISSING_DATES", message: "startDate and endDate are required for BIR Form 2307 generation." });
    }

    const data = await BirComplianceService.generateForm2307Data(companyId, startDate, endDate);

    const headers = ['Payee Name', 'Payee TIN', 'ATC', 'Month 1 Base', 'Month 1 Withheld', 'Month 2 Base', 'Month 2 Withheld', 'Month 3 Base', 'Month 3 Withheld', 'Total Tax Base', 'Total Withheld', 'Status'];
    const rows = data.lineItems.map(item => [
      item.payeeName,
      item.payeeTin || 'N/A',
      item.atc,
      item.month1Base / 100,
      item.month1Withheld / 100,
      item.month2Base / 100,
      item.month2Withheld / 100,
      item.month3Base / 100,
      item.month3Withheld / 100,
      item.totalTaxBase / 100,
      item.totalWithheld / 100,
      item.validationStatus,
    ]);

    const exportOptions = {
      companyId,
      companyName,
      reportTitle: 'BIR Form 2307 - Certificate of Creditable Tax Withheld At Source Summary',
      reportPeriod: `${startDate} to ${endDate}`,
      generatedBy: req.user?.displayName || req.user?.email || 'System Accountant',
      headers,
      rows,
      totals: [
        'Total', '', '', 
        '', data.lineItems.reduce((acc, i) => acc + i.month1Withheld, 0) / 100,
        '', data.lineItems.reduce((acc, i) => acc + i.month2Withheld, 0) / 100,
        '', data.lineItems.reduce((acc, i) => acc + i.month3Withheld, 0) / 100,
        data.summary.totalBase / 100,
        data.summary.totalWithheld / 100,
        ''
      ],
      userRole: req.activeCompany?.role,
      requiredRole: 'Accountant',
      isSensitive: true,
      req,
    };

    if (format === 'json') {
      const jsonStr = await ExportService.generateJSON(exportOptions);
      return res.json(JSON.parse(jsonStr));
    } else if (format === 'csv') {
      const csvStr = await ExportService.generateCSV(exportOptions);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="bir-form-2307-${startDate}-${endDate}.csv"`);
      return res.send(csvStr);
    } else {
      return res.json({ success: true, data });
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith('ACCESS_DENIED')) {
      return res.status(403).json({ error: 'ACCESS_DENIED', message: err.message });
    }
    next(err);
  }
});

// POST /api/compliance/bir/books
router.post("/books", requireAuth, requireMinRole('Accountant'), async (req, res, next) => {
  try {
    const companyId = req.activeCompany!.id;
    const compRecord = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyName = compRecord?.legalName || (req.activeCompany as any)?.legalName || "Active Company";
    const { bookType = 'GENERAL_LEDGER', startDate, endDate, accountId, format = 'json' } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "MISSING_DATES", message: "startDate and endDate are required for Books of Accounts generation." });
    }

    const entries = await BirComplianceService.generateBookOfAccounts(companyId, bookType, startDate, endDate, accountId);

    const headers = ['Date', 'Reference No.', 'Description', 'Account Code', 'Account Name', 'Debit (PHP)', 'Credit (PHP)', 'Running Balance (PHP)', 'Source'];
    const rows = entries.map(e => [
      e.date,
      e.referenceNo,
      e.description,
      e.accountCode,
      e.accountName,
      e.debit / 100,
      e.credit / 100,
      (e.runningBalance || 0) / 100,
      e.sourceType || 'GENERAL',
    ]);

    const exportOptions = {
      companyId,
      companyName,
      reportTitle: `Computerized Books of Accounts: ${bookType.replace(/_/g, ' ')}`,
      reportPeriod: `${startDate} to ${endDate}`,
      generatedBy: req.user?.displayName || req.user?.email || 'System Accountant',
      headers,
      rows,
      totals: [
        'Total', '', '', '', '',
        entries.reduce((acc, e) => acc + e.debit, 0) / 100,
        entries.reduce((acc, e) => acc + e.credit, 0) / 100,
        '', ''
      ],
      userRole: req.activeCompany?.role,
      requiredRole: 'Accountant',
      isSensitive: true,
      req,
    };

    if (format === 'json') {
      const jsonStr = await ExportService.generateJSON(exportOptions);
      return res.json(JSON.parse(jsonStr));
    } else if (format === 'csv') {
      const csvStr = await ExportService.generateCSV(exportOptions);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="book-${bookType.toLowerCase()}-${startDate}-${endDate}.csv"`);
      return res.send(csvStr);
    } else {
      return res.json({ success: true, bookType, entries });
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith('ACCESS_DENIED')) {
      return res.status(403).json({ error: 'ACCESS_DENIED', message: err.message });
    }
    next(err);
  }
});

// POST /api/compliance/bir/vat-summary
router.post("/vat-summary", requireAuth, requireMinRole('Accountant'), async (req, res, next) => {
  try {
    const companyId = req.activeCompany!.id;
    const compRecord = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyName = compRecord?.legalName || (req.activeCompany as any)?.legalName || "Active Company";
    const { startDate, endDate, format = 'json' } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "MISSING_DATES", message: "startDate and endDate are required for VAT Summary generation." });
    }

    const summary = await BirComplianceService.generateVatSummary(companyId, startDate, endDate);

    const headers = ['Supplier Name', 'Supplier TIN', 'Invoice/Ref', 'Date', 'Gross Amount', 'Taxable Amount', 'Exempt Amount', 'Input VAT', 'Validation Status'];
    const rows = summary.purchases.map(p => [
      p.partnerName,
      p.partnerTin || 'N/A',
      p.invoiceNumber,
      p.transactionDate,
      p.grossAmount / 100,
      p.taxableAmount / 100,
      p.exemptAmount / 100,
      p.inputOutputVat / 100,
      p.validationStatus,
    ]);

    const exportOptions = {
      companyId,
      companyName,
      reportTitle: 'VAT Relief & SADPGS Summary of Purchases',
      reportPeriod: `${startDate} to ${endDate}`,
      generatedBy: req.user?.displayName || req.user?.email || 'System Accountant',
      headers,
      rows,
      totals: [
        'Total', '', '', '',
        summary.totals.grossPurchases / 100,
        summary.totals.taxablePurchases / 100,
        summary.totals.exemptPurchases / 100,
        summary.totals.inputVat / 100,
        ''
      ],
      userRole: req.activeCompany?.role,
      requiredRole: 'Accountant',
      isSensitive: true,
      req,
    };

    if (format === 'json') {
      const jsonStr = await ExportService.generateJSON(exportOptions);
      return res.json(JSON.parse(jsonStr));
    } else if (format === 'csv') {
      const csvStr = await ExportService.generateCSV(exportOptions);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="vat-summary-${startDate}-${endDate}.csv"`);
      return res.send(csvStr);
    } else {
      return res.json({ success: true, summary });
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith('ACCESS_DENIED')) {
      return res.status(403).json({ error: 'ACCESS_DENIED', message: err.message });
    }
    next(err);
  }
});

export default router;
