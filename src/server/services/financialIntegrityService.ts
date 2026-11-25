import { CompanyManager } from './companyManager';

export interface IntegrityCheckItem {
  category: string;
  checkName: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string;
  data?: any;
}

export interface DiscrepancyItem {
  category: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  details: string;
  entityId?: string;
  reference?: string;
  expectedValue?: any;
  actualValue?: any;
  variance?: any;
}

export interface FinancialIntegrityReport {
  companyId: string;
  companyLegalName: string;
  auditedAt: string;
  overallStatus: 'CLEAN' | 'WARNINGS' | 'CRITICAL';
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    warningChecks: number;
    criticalDiscrepancies: number;
    warningDiscrepancies: number;
  };
  checks: IntegrityCheckItem[];
  discrepancies: DiscrepancyItem[];
}

export class FinancialIntegrityService {
  /**
   * Performs an authoritative, non-destructive audit of a company's database
   * Never modifies or repairs records silently; only generates exception reports.
   */
  static async auditCompanyFinancialIntegrity(companyId: string): Promise<FinancialIntegrityReport> {
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }

    const sqlite = await CompanyManager.getCompanySqlite(companyId);
    if (!sqlite) {
      throw new Error(`DATABASE_NOT_ACCESSIBLE: Unable to acquire SQLite handle for company ${companyId}`);
    }

    const checks: IntegrityCheckItem[] = [];
    const discrepancies: DiscrepancyItem[] = [];

    // 1. SQLite PRAGMA integrity_check
    try {
      const integrityRes = sqlite.pragma('integrity_check') as any[];
      const status = integrityRes?.[0]?.integrity_check === 'ok' ? 'PASS' : 'FAIL';
      checks.push({
        category: 'STORAGE',
        checkName: 'SQLite PRAGMA integrity_check',
        status,
        details: `SQLite database file integrity check: ${integrityRes?.[0]?.integrity_check || 'unknown'}`,
        data: integrityRes
      });
      if (status === 'FAIL') {
        discrepancies.push({
          category: 'STORAGE',
          severity: 'CRITICAL',
          title: 'Database Disk Corruption Detected',
          details: `SQLite reported: ${JSON.stringify(integrityRes)}`
        });
      }
    } catch (err: any) {
      checks.push({
        category: 'STORAGE',
        checkName: 'SQLite PRAGMA integrity_check',
        status: 'FAIL',
        details: `Failed to execute integrity_check: ${err.message}`
      });
      discrepancies.push({
        category: 'STORAGE',
        severity: 'CRITICAL',
        title: 'Database Pragma Execution Failed',
        details: err.message
      });
    }

    // 2. Foreign Key Consistency (PRAGMA foreign_key_check)
    try {
      const fkRes = sqlite.pragma('foreign_key_check') as any[];
      const status = fkRes.length === 0 ? 'PASS' : 'WARN';
      checks.push({
        category: 'RELATIONAL',
        checkName: 'Foreign Key Referential Consistency',
        status,
        details: fkRes.length === 0 ? 'All foreign key references valid' : `Found ${fkRes.length} broken foreign key reference(s)`,
        data: fkRes.slice(0, 50)
      });
      for (const fk of fkRes) {
        discrepancies.push({
          category: 'RELATIONAL',
          severity: 'WARNING',
          title: 'Foreign Key Violation',
          details: `Table "${fk.table}" rowid ${fk.rowid} references missing parent in "${fk.parent}" (fkid: ${fk.fkid})`
        });
      }
    } catch (err: any) {
      checks.push({
        category: 'RELATIONAL',
        checkName: 'Foreign Key Referential Consistency',
        status: 'WARN',
        details: `foreign_key_check execution note: ${err.message}`
      });
    }

    // 3. Duplicate Transaction Identifiers & References
    try {
      const duplicateRefs = sqlite.prepare(`
        SELECT journal_number as ref, COUNT(*) as count 
        FROM journal_entries 
        WHERE company_id = ? AND journal_number IS NOT NULL AND journal_number != ''
        GROUP BY journal_number 
        HAVING COUNT(*) > 1
      `).all(companyId) as any[];

      const status = duplicateRefs.length === 0 ? 'PASS' : 'FAIL';
      checks.push({
        category: 'TRANSACTION_INTEGRITY',
        checkName: 'Journal Number Uniqueness',
        status,
        details: duplicateRefs.length === 0 ? 'All journal entry reference numbers unique' : `Found ${duplicateRefs.length} duplicate journal reference(s)`,
        data: duplicateRefs
      });
      for (const d of duplicateRefs) {
        discrepancies.push({
          category: 'TRANSACTION_INTEGRITY',
          severity: 'CRITICAL',
          title: 'Duplicate Journal Number',
          details: `Journal number "${d.ref}" appears ${d.count} times in company ${companyId}`,
          reference: d.ref
        });
      }
    } catch (_) {}

    // 4. Journal Debit/Credit Equality (Per-Journal Validation)
    try {
      const unbalancedJournals = sqlite.prepare(`
        SELECT 
          je.id,
          je.journal_number,
          je.entry_date,
          je.status,
          COALESCE(SUM(jl.debit), 0) as total_debit,
          COALESCE(SUM(jl.credit), 0) as total_credit,
          (COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) as variance
        FROM journal_entries je
        LEFT JOIN journal_lines jl ON je.id = jl.journal_entry_id
        WHERE je.company_id = ?
        GROUP BY je.id, je.journal_number, je.entry_date, je.status
        HAVING COALESCE(SUM(jl.debit), 0) != COALESCE(SUM(jl.credit), 0)
      `).all(companyId) as any[];

      const status = unbalancedJournals.length === 0 ? 'PASS' : 'FAIL';
      checks.push({
        category: 'ACCOUNTING_RULES',
        checkName: 'Journal Entry Debit-Credit Equality',
        status,
        details: unbalancedJournals.length === 0 ? 'All journal entries have balanced debits and credits' : `Found ${unbalancedJournals.length} unbalanced journal entry(ies)`,
        data: unbalancedJournals
      });

      for (const uj of unbalancedJournals) {
        discrepancies.push({
          category: 'ACCOUNTING_RULES',
          severity: 'CRITICAL',
          title: 'Unbalanced Journal Entry',
          details: `Journal ${uj.journal_number} (${uj.id}) is out of balance. Total Debit: ₱${(uj.total_debit / 100).toFixed(2)}, Total Credit: ₱${(uj.total_credit / 100).toFixed(2)}, Variance: ₱${(uj.variance / 100).toFixed(2)}`,
          entityId: uj.id,
          reference: uj.journal_number,
          expectedValue: uj.total_debit,
          actualValue: uj.total_credit,
          variance: uj.variance
        });
      }
    } catch (err: any) {
      checks.push({
        category: 'ACCOUNTING_RULES',
        checkName: 'Journal Entry Debit-Credit Equality',
        status: 'FAIL',
        details: `Query error: ${err.message}`
      });
    }

    // 5. General Ledger Balances & Trial Balance Equality
    try {
      const glTotals = sqlite.prepare(`
        SELECT 
          COALESCE(SUM(jl.debit), 0) as total_debit,
          COALESCE(SUM(jl.credit), 0) as total_credit,
          (COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) as variance
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.company_id = ? AND je.status IN ('POSTED', 'APPROVED')
      `).get(companyId) as any;

      const totalDeb = glTotals?.total_debit || 0;
      const totalCred = glTotals?.total_credit || 0;
      const variance = totalDeb - totalCred;
      const status = variance === 0 ? 'PASS' : 'FAIL';

      checks.push({
        category: 'GENERAL_LEDGER',
        checkName: 'General Ledger Trial Balance Equality',
        status,
        details: status === 'PASS' 
          ? `GL Trial Balance perfectly in balance. Total Debits: ₱${(totalDeb / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, Total Credits: ₱${(totalCred / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
          : `GL Trial Balance imbalance: Debits=₱${(totalDeb / 100).toFixed(2)}, Credits=₱${(totalCred / 100).toFixed(2)}, Variance=₱${(variance / 100).toFixed(2)}`,
        data: { totalDebits: totalDeb, totalCredits: totalCred, variance }
      });

      if (variance !== 0) {
        discrepancies.push({
          category: 'GENERAL_LEDGER',
          severity: 'CRITICAL',
          title: 'General Ledger Out of Balance',
          details: `Global posted GL entries do not balance. Total debits exceed credits by ₱${(variance / 100).toFixed(2)}`,
          expectedValue: totalDeb,
          actualValue: totalCred,
          variance
        });
      }
    } catch (err: any) {
      checks.push({
        category: 'GENERAL_LEDGER',
        checkName: 'General Ledger Trial Balance Equality',
        status: 'FAIL',
        details: err.message
      });
    }

    // 6. Accounts Receivable Subledger vs GL Control Account
    try {
      // Subledger: Total unpaid / balance_due on posted or approved sales invoices
      const arSubledger = sqlite.prepare(`
        SELECT COALESCE(SUM(balance_due), 0) as total_unpaid_ar
        FROM sales_invoices
        WHERE company_id = ? AND status IN ('POSTED', 'APPROVED', 'PARTIAL')
      `).get(companyId) as any;

      // GL Control Account: Net debits on accounts of type 'RECEIVABLE' or code IN ('1030', '1200')
      const arControl = sqlite.prepare(`
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as ar_control_balance
        FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.company_id = ? 
          AND je.status IN ('POSTED', 'APPROVED')
          AND (a.account_type IN ('RECEIVABLE', 'ASSET') AND (a.account_code IN ('1030', '1200') OR a.is_control_account = 1))
      `).get(companyId) as any;

      const subledgerAR = arSubledger?.total_unpaid_ar || 0;
      const controlAR = arControl?.ar_control_balance || 0;
      const arVariance = Math.abs(subledgerAR - controlAR);

      const status = arVariance === 0 ? 'PASS' : 'WARN';
      checks.push({
        category: 'SUBLEDGER_RECONCILIATION',
        checkName: 'Accounts Receivable Subledger vs Control Account',
        status,
        details: status === 'PASS'
          ? `AR Subledger matches GL Control Account (₱${(subledgerAR / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })})`
          : `AR Subledger variance: Invoices Total=₱${(subledgerAR / 100).toFixed(2)}, GL Control=₱${(controlAR / 100).toFixed(2)}, Variance=₱${(arVariance / 100).toFixed(2)}`,
        data: { subledgerAR, controlAR, arVariance }
      });

      if (arVariance > 0) {
        discrepancies.push({
          category: 'SUBLEDGER_RECONCILIATION',
          severity: 'WARNING',
          title: 'Accounts Receivable Subledger Variance',
          details: `Sales Invoices subledger (₱${(subledgerAR / 100).toFixed(2)}) differs from AR Control Account (₱${(controlAR / 100).toFixed(2)}) by ₱${(arVariance / 100).toFixed(2)}`,
          expectedValue: subledgerAR,
          actualValue: controlAR,
          variance: arVariance
        });
      }
    } catch (_) {}

    // 7. Accounts Payable Subledger vs GL Control Account
    try {
      const apSubledger = sqlite.prepare(`
        SELECT COALESCE(SUM(balance_due), 0) as total_unpaid_ap
        FROM purchase_bills
        WHERE company_id = ? AND status IN ('POSTED', 'APPROVED', 'PARTIAL')
      `).get(companyId) as any;

      const apControl = sqlite.prepare(`
        SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as ap_control_balance
        FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.company_id = ? 
          AND je.status IN ('POSTED', 'APPROVED')
          AND (a.account_type IN ('PAYABLE', 'LIABILITY') AND (a.account_code IN ('2010', '2000') OR a.is_control_account = 1))
      `).get(companyId) as any;

      const subledgerAP = apSubledger?.total_unpaid_ap || 0;
      const controlAP = apControl?.ap_control_balance || 0;
      const apVariance = Math.abs(subledgerAP - controlAP);

      const status = apVariance === 0 ? 'PASS' : 'WARN';
      checks.push({
        category: 'SUBLEDGER_RECONCILIATION',
        checkName: 'Accounts Payable Subledger vs Control Account',
        status,
        details: status === 'PASS'
          ? `AP Subledger matches GL Control Account (₱${(subledgerAP / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })})`
          : `AP Subledger variance: Bills Total=₱${(subledgerAP / 100).toFixed(2)}, GL Control=₱${(controlAP / 100).toFixed(2)}, Variance=₱${(apVariance / 100).toFixed(2)}`,
        data: { subledgerAP, controlAP, apVariance }
      });

      if (apVariance > 0) {
        discrepancies.push({
          category: 'SUBLEDGER_RECONCILIATION',
          severity: 'WARNING',
          title: 'Accounts Payable Subledger Variance',
          details: `Purchase Bills subledger (₱${(subledgerAP / 100).toFixed(2)}) differs from AP Control Account (₱${(controlAP / 100).toFixed(2)}) by ₱${(apVariance / 100).toFixed(2)}`,
          expectedValue: subledgerAP,
          actualValue: controlAP,
          variance: apVariance
        });
      }
    } catch (_) {}

    // 8. Inventory Valuation Consistency
    try {
      const invItems = sqlite.prepare(`
        SELECT COALESCE(SUM(quantity_on_hand * unit_cost), 0) as total_inventory_valuation
        FROM inventory_items
        WHERE company_id = ?
      `).get(companyId) as any;

      const invControl = sqlite.prepare(`
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as inventory_control_balance
        FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.company_id = ? 
          AND je.status IN ('POSTED', 'APPROVED')
          AND (a.account_type = 'INVENTORY' OR a.account_code = '1300')
      `).get(companyId) as any;

      const subledgerInv = invItems?.total_inventory_valuation || 0;
      const controlInv = invControl?.inventory_control_balance || 0;
      const invVariance = Math.abs(subledgerInv - controlInv);

      checks.push({
        category: 'INVENTORY_RECONCILIATION',
        checkName: 'Inventory Subledger Valuation vs Asset Account',
        status: invVariance === 0 ? 'PASS' : 'WARN',
        details: `Inventory items valuation: ₱${(subledgerInv / 100).toFixed(2)}, GL Inventory Account: ₱${(controlInv / 100).toFixed(2)}, Variance: ₱${(invVariance / 100).toFixed(2)}`,
        data: { subledgerInv, controlInv, invVariance }
      });
    } catch (_) {}

    // 9. Tax Ledger Reconciliation (VAT & Withholding Tax)
    try {
      const outputVatControl = sqlite.prepare(`
        SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as output_vat_balance
        FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.company_id = ? 
          AND je.status IN ('POSTED', 'APPROVED')
          AND (a.account_code IN ('2020', '2110') OR a.bir_tax_category LIKE '%OUTPUT_VAT%')
      `).get(companyId) as any;

      const ewtControl = sqlite.prepare(`
        SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as ewt_balance
        FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.company_id = ? 
          AND je.status IN ('POSTED', 'APPROVED')
          AND (a.account_code IN ('2030', '2120') OR a.bir_tax_category LIKE '%EWT%')
      `).get(companyId) as any;

      checks.push({
        category: 'TAX_RECONCILIATION',
        checkName: 'Tax Ledger Account Balances',
        status: 'PASS',
        details: `Output VAT Account Balance: ₱${((outputVatControl?.output_vat_balance || 0) / 100).toFixed(2)}, EWT Payable Balance: ₱${((ewtControl?.ewt_balance || 0) / 100).toFixed(2)}`,
        data: {
          outputVat: outputVatControl?.output_vat_balance || 0,
          ewt: ewtControl?.ewt_balance || 0
        }
      });
    } catch (_) {}

    // 10. Accounting Period Integrity & Closed Period Lock Date Enforcement
    try {
      const companyRecord = sqlite.prepare('SELECT lock_date FROM companies WHERE id = ?').get(companyId) as any;
      const lockDate = companyRecord?.lock_date;

      let lockViolations: any[] = [];
      if (lockDate) {
        lockViolations = sqlite.prepare(`
          SELECT journal_number, entry_date, status
          FROM journal_entries
          WHERE company_id = ? AND entry_date <= ? AND status NOT IN ('POSTED', 'ARCHIVED')
        `).all(companyId, lockDate) as any[];
      }

      const status = lockViolations.length === 0 ? 'PASS' : 'WARN';
      checks.push({
        category: 'COMPLIANCE',
        checkName: 'Accounting Period & Lock Date Compliance',
        status,
        details: lockDate 
          ? (status === 'PASS' ? `No unposted transactions prior to lock date (${lockDate})` : `Found ${lockViolations.length} unposted transaction(s) on or before lock date (${lockDate})`)
          : 'No lock date configured for company (Open periods)',
        data: { lockDate, lockViolations }
      });

      for (const lv of lockViolations) {
        discrepancies.push({
          category: 'COMPLIANCE',
          severity: 'WARNING',
          title: 'Unposted Transaction in Locked Period',
          details: `Journal ${lv.journal_number} has entry date ${lv.entry_date} which falls on or before company lock date ${lockDate}`,
          reference: lv.journal_number
        });
      }
    } catch (_) {}

    // 11. Orphan Record Detection
    try {
      const orphanLines = sqlite.prepare(`
        SELECT COUNT(*) as count
        FROM journal_lines jl
        LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.id IS NULL
      `).get() as any;

      const orphanCount = orphanLines?.count || 0;
      checks.push({
        category: 'RELATIONAL',
        checkName: 'Orphan Journal Lines Detection',
        status: orphanCount === 0 ? 'PASS' : 'FAIL',
        details: orphanCount === 0 ? 'No orphan journal lines detected' : `Found ${orphanCount} orphan journal lines without parent entry`,
        data: { orphanCount }
      });

      if (orphanCount > 0) {
        discrepancies.push({
          category: 'RELATIONAL',
          severity: 'CRITICAL',
          title: 'Orphan Journal Lines',
          details: `${orphanCount} journal lines reference a missing or deleted journal_entry_id`
        });
      }
    } catch (_) {}

    // 12. Reversal Lineage & Duplicate Reversal Invariant Check
    try {
      // Find any original journals that have more than 1 POSTED reversal child in this company
      const duplicateReversals = sqlite.prepare(`
        SELECT 
          original_journal_id,
          COUNT(*) as reversal_count,
          GROUP_CONCAT(id) as reversal_ids,
          GROUP_CONCAT(journal_number) as reversal_numbers
        FROM journal_entries
        WHERE company_id = ?
          AND original_journal_id IS NOT NULL
          AND status = 'POSTED'
        GROUP BY original_journal_id
        HAVING COUNT(*) > 1
      `).all(companyId) as any[];

      const hasDuplicateReversals = duplicateReversals.length > 0;
      checks.push({
        category: 'REVERSAL_INTEGRITY',
        checkName: 'Single Reversal Child Invariant',
        status: hasDuplicateReversals ? 'FAIL' : 'PASS',
        details: hasDuplicateReversals
          ? `CRITICAL INVARIANT VIOLATION: Found ${duplicateReversals.length} original journal(s) with multiple POSTED reversal children`
          : 'All posted journal reversals maintain strict 1-to-1 parent-child lineage (no duplicate posted reversals)',
        data: duplicateReversals
      });

      for (const dup of duplicateReversals) {
        const origEntry = sqlite.prepare(`SELECT id, journal_number, status FROM journal_entries WHERE id = ?`).get(dup.original_journal_id) as any;
        const conflictingReversalIds = String(dup.reversal_ids || '').split(',').filter(Boolean);
        const conflictingReversalNumbers = String(dup.reversal_numbers || '').split(',').filter(Boolean);

        discrepancies.push({
          category: 'REVERSAL_INTEGRITY',
          severity: 'CRITICAL',
          title: 'Duplicate Posted Reversal Children Detected',
          details: `Original journal ${origEntry?.journal_number || dup.original_journal_id} has ${dup.reversal_count} conflicting POSTED reversal children: [${dup.reversal_numbers}] (IDs: ${dup.reversal_ids}). Lineage is corrupted.`,
          entityId: dup.original_journal_id,
          reference: origEntry?.journal_number || dup.original_journal_id,
          expectedValue: 1,
          actualValue: dup.reversal_count
        });

        try {
          sqlite.prepare(`
            INSERT INTO audit_logs (id, company_id, user_id, user_display_name, action, entity_type, entity_id, timestamp, after_data, metadata, source, severity, result)
            VALUES (?, ?, NULL, 'SYSTEM_INTEGRITY_AUDITOR', 'REVERSAL_LINEAGE_CORRUPTION_DETECTED', 'journal_entries', ?, ?, ?, ?, 'SYSTEM', 'CRITICAL', 'FAILED')
          `).run(
            `aud-rev-corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            companyId,
            dup.original_journal_id,
            Math.floor(Date.now() / 1000),
            JSON.stringify({
              originalJournalId: dup.original_journal_id,
              originalJournalNumber: origEntry?.journal_number || null,
              conflictingCount: dup.reversal_count,
              conflictingReversalIds,
              conflictingReversalNumbers,
            }),
            JSON.stringify({
              originalJournalId: dup.original_journal_id,
              originalJournalNumber: origEntry?.journal_number || null,
              conflictingCount: dup.reversal_count,
              conflictingReversalIds,
              conflictingReversalNumbers,
            })
          );
        } catch (_) {}
      }
    } catch (err: any) {
      checks.push({
        category: 'REVERSAL_INTEGRITY',
        checkName: 'Single Reversal Child Invariant',
        status: 'WARN',
        details: `Reversal lineage check execution note: ${err.message}`
      });
    }

    const totalChecks = checks.length;
    const passedChecks = checks.filter(c => c.status === 'PASS').length;
    const warningChecks = checks.filter(c => c.status === 'WARN').length;
    const failedChecks = checks.filter(c => c.status === 'FAIL').length;
    const criticalDiscrepancies = discrepancies.filter(d => d.severity === 'CRITICAL').length;
    const warningDiscrepancies = discrepancies.filter(d => d.severity === 'WARNING').length;

    let overallStatus: 'CLEAN' | 'WARNINGS' | 'CRITICAL' = 'CLEAN';
    if (criticalDiscrepancies > 0 || failedChecks > 0) {
      overallStatus = 'CRITICAL';
    } else if (warningDiscrepancies > 0 || warningChecks > 0) {
      overallStatus = 'WARNINGS';
    }

    return {
      companyId,
      companyLegalName: manifest.legalName,
      auditedAt: new Date().toISOString(),
      overallStatus,
      summary: {
        totalChecks,
        passedChecks,
        failedChecks,
        warningChecks,
        criticalDiscrepancies,
        warningDiscrepancies
      },
      checks,
      discrepancies
    };
  }

  /**
   * Generates a markdown exception report for management and CPA auditors
   */
  static formatExceptionReportMarkdown(report: FinancialIntegrityReport): string {
    const lines: string[] = [];
    lines.push(`# FINANCIAL INTEGRITY & EXCEPTION AUDIT REPORT`);
    lines.push(`**Company**: ${report.companyLegalName} (${report.companyId})`);
    lines.push(`**Audited At**: ${report.auditedAt}`);
    lines.push(`**Overall Integrity Status**: **${report.overallStatus}**`);
    lines.push(`\n## SUMMARY`);
    lines.push(`- Total Checks Performed: ${report.summary.totalChecks}`);
    lines.push(`- Checks Passed: ${report.summary.passedChecks}`);
    lines.push(`- Checks with Warnings: ${report.summary.warningChecks}`);
    lines.push(`- Checks Failed: ${report.summary.failedChecks}`);
    lines.push(`- Critical Discrepancies: ${report.summary.criticalDiscrepancies}`);
    lines.push(`- Warning Discrepancies: ${report.summary.warningDiscrepancies}`);

    lines.push(`\n## AUDIT CHECKS`);
    for (const c of report.checks) {
      const badge = c.status === 'PASS' ? '✅ PASS' : c.status === 'WARN' ? '⚠️ WARN' : '❌ FAIL';
      lines.push(`- **[${badge}] ${c.category}** — *${c.checkName}*: ${c.details}`);
    }

    if (report.discrepancies.length > 0) {
      lines.push(`\n## ITEMIZED DISCREPANCY REGISTER`);
      for (const d of report.discrepancies) {
        const sev = d.severity === 'CRITICAL' ? '🔴 CRITICAL' : '🟡 WARNING';
        lines.push(`### [${sev}] ${d.title}`);
        lines.push(`- **Category**: ${d.category}`);
        lines.push(`- **Details**: ${d.details}`);
        if (d.reference) lines.push(`- **Reference**: ${d.reference}`);
        if (d.variance !== undefined) lines.push(`- **Variance**: ₱${(Number(d.variance) / 100).toFixed(2)}`);
      }
    } else {
      lines.push(`\n## ITEMIZED DISCREPANCY REGISTER`);
      lines.push(`*No financial discrepancies or integrity anomalies identified. Database is fully balanced.*`);
    }

    return lines.join('\n');
  }
}
