import { db } from '../src/server/db';
import { CompanyManager } from '../src/server/services/companyManager';
import { dbContext } from '../src/server/db/context';
import * as schema from '../src/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { computeAuditSealHash } from '../src/server/db/auditSeal';

const uuid = () => crypto.randomUUID();
const pad = (n: number, len = 4) => String(n).padStart(len, '0');

async function upgradeDualCompanyGovernance() {
  console.log('================================================================================');
  console.log(' UPGRADING DUAL-COMPANY MODULES 13, 14 & 15 (APPROVALS, ACTIVITY & AUDIT TRAIL)');
  console.log('================================================================================');

  const companyIds = [
    'LGR-PH-2026-WHO-00-A9BDA5F1', // Maharlika Pacific Trading & Logistics Corp.
    'LGR-PH-2026-AGR-00-A0145336', // Visayas Highland Agri-Tech & Services Inc.
  ];

  for (const companyId of companyIds) {
    const compDb = await CompanyManager.getCompanyDb(companyId);
    await dbContext.run(compDb, async () => {
      const companies = await db.select().from(schema.companies);
      const company = companies.find((c) => c.id === companyId) || companies[0];
      if (!company) return;
      const isVat =
        String(company.vatStatus || '').toUpperCase().includes('VAT') &&
        !String(company.vatStatus || '').toUpperCase().includes('NON');
      console.log(`\n[Company] ${company.legalName} (${companyId}) | VAT: ${company.vatStatus}`);

    // Load company members from schema.users
    const dbUsers = await db.select().from(schema.users);
    const memberships = dbUsers.map((u) => {
      const em = String(u.email || '').toLowerCase();
      const role = em.startsWith('owner@')
        ? 'Company Owner'
        : em.startsWith('accountant@')
        ? 'Accountant'
        : em.startsWith('approver@')
        ? 'Approver'
        : em.startsWith('auditor@')
        ? 'Auditor'
        : em.startsWith('bookkeeper@')
        ? 'Bookkeeper'
        : (u as any).role || 'Member';
      return {
        userId: u.id,
        role,
        email: u.email,
        displayName: u.displayName || u.email,
      };
    });

    const owner = memberships.find((m) => m.role.toLowerCase().includes('owner')) || memberships[0];
    const accountant = memberships.find((m) => m.role.toLowerCase().includes('accountant')) || memberships[1] || owner;
    const approver = memberships.find((m) => m.role.toLowerCase().includes('approver')) || memberships[2] || owner;
    const fourthStaff = memberships.find((m) => m.role.toLowerCase().includes('auditor') || m.role.toLowerCase().includes('bookkeeper')) || memberships[3] || accountant;

    // Load real entities across all modules for this company
    const [
      invoices,
      bills,
      journals,
      prs,
      pos,
      grns,
      custPayments,
      supPayments,
      creditMemos,
      debitMemos,
      cashTxs,
      recons,
      payrollRuns,
      fixedAssets,
      taxFilings,
      budgets,
      accounts,
      customers,
      vendors,
      docs,
      depts,
    ] = await Promise.all([
      db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.companyId, companyId)),
      db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.companyId, companyId)),
      db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, companyId)),
      db.select().from(schema.purchaseRequisitions).where(eq(schema.purchaseRequisitions.companyId, companyId)),
      db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.companyId, companyId)),
      db.select().from(schema.goodsReceiptNotes).where(eq(schema.goodsReceiptNotes.companyId, companyId)),
      db.select().from(schema.customerPayments).where(eq(schema.customerPayments.companyId, companyId)),
      db.select().from(schema.supplierPayments).where(eq(schema.supplierPayments.companyId, companyId)),
      db.select().from(schema.creditMemos).where(eq(schema.creditMemos.companyId, companyId)),
      db.select().from(schema.debitMemos).where(eq(schema.debitMemos.companyId, companyId)),
      db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.companyId, companyId)),
      db.select().from(schema.bankReconciliations).where(eq(schema.bankReconciliations.companyId, companyId)),
      db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.companyId, companyId)),
      db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, companyId)),
      db.select().from(schema.taxFilings).where(eq(schema.taxFilings.companyId, companyId)),
      db.select().from(schema.budgets).where(eq(schema.budgets.companyId, companyId)),
      db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId)),
      db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId)),
      db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId)),
      db.select().from(schema.documents).where(eq(schema.documents.companyId, companyId)),
      db.select().from(schema.departments).where(eq(schema.departments.companyId, companyId)),
    ]);

    const finDeptId = depts[0]?.id || 'FINANCE';

    // -------------------------------------------------------------------------
    // 1. UPGRADE MODULE 13: APPROVAL WORKFLOWS, STEPS, DELEGATIONS & SUPPORTING DOCS
    // -------------------------------------------------------------------------
    const existingWfs = await db
      .select()
      .from(schema.approvalWorkflows)
      .where(eq(schema.approvalWorkflows.companyId, companyId));
    const existingWfEntityIds = new Set(existingWfs.map((w) => w.entityId));

    const newWfs: any[] = [];
    const newSteps: any[] = [];

    const addWorkflowRecord = (opts: {
      entityType: string;
      entityId: string;
      recordReference: string;
      amountCentavos: number;
      status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'RETURNED' | 'REJECTED';
      workflowType: 'ROLE_ROUTED' | 'AMOUNT_THRESHOLD' | 'SEQUENTIAL';
      slaStatus: 'ON_TRACK' | 'AT_RISK' | 'OVERDUE';
      isDelegated?: boolean;
      whyApprovalNeeded: string;
      daysAgo: number;
      comments?: string;
    }) => {
      if (existingWfEntityIds.has(opts.entityId)) return;
      existingWfEntityIds.add(opts.entityId);

      const wfId = uuid();
      const submittedAt = new Date(Date.now() - opts.daysAgo * 86400000);
      const slaDueAt =
        opts.slaStatus === 'OVERDUE'
          ? new Date(Date.now() - 12 * 3600000)
          : new Date(Date.now() + 24 * 3600000);
      const completedAt =
        opts.status === 'APPROVED' || opts.status === 'REJECTED' || opts.status === 'RETURNED'
          ? new Date(submittedAt.getTime() + 4 * 3600000)
          : null;

      newWfs.push({
        id: wfId,
        companyId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        recordReference: opts.recordReference,
        workflowType: opts.workflowType,
        status: opts.status,
        currentStepOrder: 1,
        totalSteps: opts.workflowType === 'SEQUENTIAL' ? 2 : 1,
        amountCentavos: opts.amountCentavos,
        departmentId: finDeptId,
        submittedBy: accountant.userId,
        submittedByName: accountant.displayName,
        submittedAt,
        completedAt,
        slaDueAt,
        slaStatus: opts.slaStatus,
        escalationCount: opts.slaStatus === 'OVERDUE' ? 1 : 0,
        resubmissionCount: opts.status === 'RETURNED' ? 1 : 0,
        metadata: JSON.stringify({
          branchCode: 'HQ-MNL',
          currency: 'PHP',
          requesterRole: accountant.role,
          whyApprovalNeeded: opts.whyApprovalNeeded,
          policyVersion: 1,
        }),
        createdAt: submittedAt,
        updatedAt: completedAt || submittedAt,
      });

      const stepStatus =
        opts.status === 'PENDING' || opts.status === 'IN_PROGRESS' ? 'PENDING' : opts.status;
      newSteps.push({
        id: uuid(),
        workflowId: wfId,
        companyId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        stepOrder: 1,
        stepName:
          opts.workflowType === 'SEQUENTIAL'
            ? 'Level 1: Chief Accountant & Finance Manager Verification'
            : 'Level 1: Maker-Checker SoD Authorization',
        approvalMode: 'SEQUENTIAL',
        requiredRole: 'Approver',
        departmentId: finDeptId,
        thresholdMinCentavos: 0,
        thresholdMaxCentavos: 500_000_000,
        originalAssignedApproverId: opts.isDelegated ? approver.userId : approver.userId,
        originalAssignedApproverName: approver.displayName,
        assignedApproverId: opts.isDelegated ? owner.userId : approver.userId,
        assignedApproverName: opts.isDelegated ? owner.displayName : approver.displayName,
        actualApproverId: stepStatus === 'PENDING' ? null : approver.userId,
        actualApproverName: stepStatus === 'PENDING' ? null : approver.displayName,
        actualApproverRole: stepStatus === 'PENDING' ? null : approver.role,
        status: stepStatus,
        decision: stepStatus === 'PENDING' ? null : stepStatus,
        comments:
          opts.comments ||
          (stepStatus === 'APPROVED'
            ? 'Verified against BIR Form 2307 & 3-way match supporting documents.'
            : null),
        rejectionReason: stepStatus === 'REJECTED' ? opts.comments || 'Policy variance detected' : null,
        delegatedFromId: opts.isDelegated ? approver.userId : null,
        delegatedFromName: opts.isDelegated ? approver.displayName : null,
        delegationReason: opts.isDelegated
          ? 'Delegated under Standing Procurement & Tax Cutoff Delegation Rule'
          : null,
        delegationHistory: opts.isDelegated
          ? JSON.stringify([
              {
                fromUserId: approver.userId,
                fromUserName: approver.displayName,
                toUserId: owner.userId,
                toUserName: owner.displayName,
                reason: 'Delegated under Standing Procurement & Tax Cutoff Delegation Rule',
                timestamp: submittedAt.toISOString(),
              },
            ])
          : JSON.stringify([]),
        escalationLevel: opts.slaStatus === 'OVERDUE' ? 1 : 0,
        escalationHistory: JSON.stringify([]),
        assignedAt: submittedAt,
        respondedAt: completedAt,
        durationSeconds: completedAt ? 14400 : null,
        slaDueAt,
        slaStatus: opts.slaStatus,
        createdAt: submittedAt,
      });
    };

    // Add APPROVED workflows from already-approved/posted records so "Approved Records" tab is populated
    invoices
      .filter((r) => r.status === 'APPROVED' || r.status === 'POSTED')
      .slice(0, 6)
      .forEach((inv, idx) => {
        addWorkflowRecord({
          entityType: 'SALES_INVOICE',
          entityId: inv.id,
          recordReference: inv.invoiceNumber,
          amountCentavos: inv.totalAmount,
          status: 'APPROVED',
          workflowType: 'AMOUNT_THRESHOLD',
          slaStatus: 'ON_TRACK',
          isDelegated: idx === 0,
          whyApprovalNeeded: `Tier 2 AR Commercial Billing (${isVat ? '12% Output VAT' : '3% Non-VAT'})`,
          daysAgo: 8 - idx,
          comments: 'Approved for BIR Sales Invoice issuance and AR subledger posting.',
        });
      });

    bills
      .filter((r) => r.status === 'APPROVED' || r.status === 'POSTED')
      .slice(0, 6)
      .forEach((bill, idx) => {
        addWorkflowRecord({
          entityType: 'PURCHASE_BILL',
          entityId: bill.id,
          recordReference: bill.billNumber,
          amountCentavos: bill.totalAmount,
          status: 'APPROVED',
          workflowType: 'SEQUENTIAL',
          slaStatus: 'ON_TRACK',
          isDelegated: idx === 0,
          whyApprovalNeeded: 'Tier 2 AP Voucher Verification & BIR Form 2307 EWT Computation',
          daysAgo: 7 - idx,
          comments: '3-Way Match (PO/GRN/Supplier Invoice) & EWT withholding verified.',
        });
      });

    // Add diverse transaction types to Approval Queue (PR, PO, GRN, SUPPLIER_PAYMENT, CREDIT_MEMO, DEBIT_MEMO, CASH_TRANSACTION, PAYROLL_RUN, TAX_FILING, BANK_RECONCILIATION, BUDGET)
    prs.slice(0, 4).forEach((pr, idx) => {
      addWorkflowRecord({
        entityType: 'PURCHASE_REQUISITION',
        entityId: pr.id,
        recordReference: pr.prNumber,
        amountCentavos: pr.totalEstimatedAmount || 185_000_00,
        status: idx < 2 ? 'PENDING' : 'APPROVED',
        workflowType: 'ROLE_ROUTED',
        slaStatus: idx === 1 ? 'OVERDUE' : 'ON_TRACK',
        isDelegated: idx === 0,
        whyApprovalNeeded: 'Departmental Requisition Budget Check & Procurement Authorization',
        daysAgo: 4 - idx,
      });
    });

    pos.slice(0, 4).forEach((po, idx) => {
      addWorkflowRecord({
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        recordReference: po.poNumber,
        amountCentavos: po.totalAmount || 340_000_00,
        status: idx < 2 ? 'PENDING' : 'APPROVED',
        workflowType: 'AMOUNT_THRESHOLD',
        slaStatus: 'ON_TRACK',
        isDelegated: idx === 1,
        whyApprovalNeeded: 'Tier 2 Purchase Order Commercial Commitment Sign-Off',
        daysAgo: 5 - idx,
      });
    });

    grns.slice(0, 2).forEach((grn, idx) => {
      addWorkflowRecord({
        entityType: 'GOODS_RECEIPT_NOTE',
        entityId: grn.id,
        recordReference: grn.grnNumber,
        amountCentavos: 210_000_00,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'ROLE_ROUTED',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Warehouse Receiving & Physical Count QA Verification',
        daysAgo: 3,
      });
    });

    supPayments.slice(0, 3).forEach((sp, idx) => {
      addWorkflowRecord({
        entityType: 'SUPPLIER_PAYMENT',
        entityId: sp.id,
        recordReference: sp.paymentNumber,
        amountCentavos: sp.amount,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'SEQUENTIAL',
        slaStatus: 'ON_TRACK',
        isDelegated: idx === 0,
        whyApprovalNeeded: 'Treasury Check / Bank Disbursement Dual-Signatory Release',
        daysAgo: 3 - idx,
      });
    });

    creditMemos.slice(0, 2).forEach((cm, idx) => {
      addWorkflowRecord({
        entityType: 'CREDIT_MEMO',
        entityId: cm.id,
        recordReference: cm.creditMemoNumber,
        amountCentavos: cm.totalAmount,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'ROLE_ROUTED',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Customer Sales Return & Output Tax Adjustment Authorization',
        daysAgo: 2,
      });
    });

    debitMemos.slice(0, 2).forEach((dm, idx) => {
      addWorkflowRecord({
        entityType: 'DEBIT_MEMO',
        entityId: dm.id,
        recordReference: dm.debitMemoNumber,
        amountCentavos: dm.totalAmount,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'ROLE_ROUTED',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Supplier Purchase Return & Input Tax Reversal Authorization',
        daysAgo: 2,
      });
    });

    cashTxs.slice(0, 2).forEach((ct, idx) => {
      addWorkflowRecord({
        entityType: 'CASH_TRANSACTION',
        entityId: ct.id,
        recordReference: ct.referenceNo || `CT-2026-${pad(idx + 1, 4)}`,
        amountCentavos: ct.amount,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'ROLE_ROUTED',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Petty Cash & Direct Treasury Voucher Verification',
        daysAgo: 2,
      });
    });

    payrollRuns.slice(0, 2).forEach((prun, idx) => {
      addWorkflowRecord({
        entityType: 'PAYROLL_RUN',
        entityId: prun.id,
        recordReference: prun.runNumber || `PAY-2026-${pad(idx + 1, 3)}`,
        amountCentavos: prun.totalNetPay || 480_000_00,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'SEQUENTIAL',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Statutory Payroll Register, SSS/PhilHealth/Pag-IBIG & BIR 1601-C Sign-Off',
        daysAgo: 4,
      });
    });

    taxFilings.slice(0, 2).forEach((tf, idx) => {
      addWorkflowRecord({
        entityType: 'TAX_FILING',
        entityId: tf.id,
        recordReference: `${tf.formType}-${tf.period}`,
        amountCentavos: tf.taxDue || 125_000_00,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'SEQUENTIAL',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: `Statutory BIR Form ${tf.formType} Return Certification (${tf.period})`,
        daysAgo: 5,
      });
    });

    recons.slice(0, 2).forEach((rec, idx) => {
      addWorkflowRecord({
        entityType: 'BANK_RECONCILIATION',
        entityId: rec.id,
        recordReference: `RECON-${rec.statementDate}`,
        amountCentavos: rec.statementEndingBalance,
        status: idx === 0 ? 'PENDING' : 'APPROVED',
        workflowType: 'ROLE_ROUTED',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Monthly Bank Statement to GL 1010 Tie-Out Certification',
        daysAgo: 3,
      });
    });

    budgets.slice(0, 2).forEach((b, idx) => {
      addWorkflowRecord({
        entityType: 'BUDGET',
        entityId: b.id,
        recordReference: `BUD-${b.fiscalYear}-${pad(idx + 1, 2)}`,
        amountCentavos: b.totalBudget,
        status: 'APPROVED',
        workflowType: 'SEQUENTIAL',
        slaStatus: 'ON_TRACK',
        whyApprovalNeeded: 'Annual Departmental OPEX & CAPEX Budget Allocation Sign-Off',
        daysAgo: 10,
      });
    });

    if (newWfs.length > 0) {
      await db.insert(schema.approvalWorkflows).values(newWfs);
      await db.insert(schema.approvalSteps).values(newSteps);
    }

    // Mark 6 existing PENDING steps as DELEGATED so "Delegated Approvals" filter pill is well-populated
    const allCompSteps = await db
      .select()
      .from(schema.approvalSteps)
      .where(and(eq(schema.approvalSteps.companyId, companyId), eq(schema.approvalSteps.status, 'PENDING')));

    for (let i = 0; i < Math.min(6, allCompSteps.length); i++) {
      const st = allCompSteps[i];
      if (!st.delegatedFromId) {
        await db
          .update(schema.approvalSteps)
          .set({
            delegatedFromId: approver.userId,
            delegatedFromName: approver.displayName,
            delegationReason: 'Delegated under Active Out-of-Office & Month-End Cutoff Rule',
            delegationHistory: JSON.stringify([
              {
                fromUserId: approver.userId,
                fromUserName: approver.displayName,
                toUserId: owner.userId,
                toUserName: owner.displayName,
                reason: 'Delegated under Active Out-of-Office & Month-End Cutoff Rule',
                timestamp: new Date(Date.now() - 3600000 * (i + 2)).toISOString(),
              },
            ]),
          })
          .where(eq(schema.approvalSteps.id, st.id));
      }
    }

    // Ensure at least 3 standing/temporary delegations exist per company
    const existingDels = await db
      .select()
      .from(schema.approvalDelegations)
      .where(eq(schema.approvalDelegations.companyId, companyId));
    if (existingDels.length < 3) {
      await db.insert(schema.approvalDelegations).values([
        {
          id: uuid(),
          companyId,
          fromUserId: approver.userId,
          fromUserName: approver.displayName,
          toUserId: owner.userId,
          toUserName: owner.displayName,
          roleScope: 'Approver',
          moduleScope: 'ACCOUNTING',
          maxAmountCentavos: 1_000_000_00,
          reason: 'Temporary month-end closing & BIR tax filing review delegation',
          isTemporary: true,
          validFrom: new Date(Date.now() - 3 * 86400000),
          validUntil: new Date(Date.now() + 21 * 86400000),
          status: 'ACTIVE',
          createdBy: owner.userId,
        },
        {
          id: uuid(),
          companyId,
          fromUserId: owner.userId,
          fromUserName: owner.displayName,
          toUserId: approver.userId,
          toUserName: approver.displayName,
          roleScope: 'Company Owner',
          moduleScope: 'SALES',
          maxAmountCentavos: 350_000_00,
          reason: 'Standing commercial sales invoice & credit memo sign-off authority',
          isTemporary: false,
          validFrom: new Date(Date.now() - 30 * 86400000),
          validUntil: new Date(Date.now() + 180 * 86400000),
          status: 'ACTIVE',
          createdBy: owner.userId,
        },
      ]);
    }

    // Link supporting documents to the top 30 approval workflow entities so "Supporting Docs (1+)" is populated
    const refreshedWfs = await db
      .select()
      .from(schema.approvalWorkflows)
      .where(eq(schema.approvalWorkflows.companyId, companyId));
    const existingDocEntityIds = new Set(docs.map((d) => d.entityId).filter(Boolean));

    const wfDocRows: any[] = [];
    for (let i = 0; i < Math.min(35, refreshedWfs.length); i++) {
      const wf = refreshedWfs[i];
      if (!existingDocEntityIds.has(wf.entityId)) {
        existingDocEntityIds.add(wf.entityId);
        const docId = uuid();
        const fileHash = crypto.createHash('sha256').update(`${companyId}-wfdoc-${wf.id}`).digest('hex');
        wfDocRows.push({
          id: docId,
          companyId,
          entityType: wf.entityType,
          entityId: wf.entityId,
          documentType: 'SUPPORTING_VOUCHER',
          fileName: `${wf.recordReference}_Supporting_BIR_Voucher.pdf`,
          originalFileName: `${wf.recordReference}_Signed_Attachment.pdf`,
          fileType: 'application/pdf',
          fileSize: 154_200 + i * 1024,
          fileHash,
          filePath: `/vault/${companyId}/originals/${wf.recordReference}.pdf`,
          source: 'WEB_UI',
          linkedTransactionType: wf.entityType,
          linkedTransactionId: wf.entityId,
          uploadedBy: accountant.userId,
          status: 'ACTIVE',
          ocrStatus: 'COMPLETED',
          verificationStatus: 'VERIFIED',
          confidenceScore: 0.98,
          extractedMerchant: company.legalName,
          extractedInvoiceNumber: wf.recordReference,
          extractedDate: '2026-11-15',
          extractedTotalAmount: wf.amountCentavos,
          extractionEngine: 'TESSERACT_WASM',
          verifiedBy: approver.userId,
        });
      }
    }
    if (wfDocRows.length > 0) {
      await db.insert(schema.documents).values(wfDocRows);
    }

    // -------------------------------------------------------------------------
    // 2. UPGRADE MODULE 14 & 15: REPLACE PLACEHOLDER AUDIT LOGS WITH 360°-LINKED,
    //    CRYPTOGRAPHICALLY SEALED, MULTI-CATEGORY ENTERPRISE AUDIT TRAIL LOGS
    // -------------------------------------------------------------------------
    db.run(sql`DROP TRIGGER IF EXISTS trg_audit_logs_immutable_delete`);
    db.run(sql`DROP TRIGGER IF EXISTS trg_audit_logs_immutable_update`);
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyId));

    // Build a pool of real entities across all modules
    interface TargetRef {
      entityType: string;
      module: string;
      entityId: string;
      recordReference: string;
      entityName: string;
      amountCentavos: number;
    }

    const realTargets: TargetRef[] = [];

    invoices.slice(0, 35).forEach((inv) =>
      realTargets.push({
        entityType: 'SALES_INVOICE',
        module: 'SALES',
        entityId: inv.id,
        recordReference: inv.invoiceNumber,
        entityName: `Sales Invoice ${inv.invoiceNumber}`,
        amountCentavos: inv.totalAmount,
      })
    );
    bills.slice(0, 35).forEach((b) =>
      realTargets.push({
        entityType: 'PURCHASE_BILL',
        module: 'PROCUREMENT',
        entityId: b.id,
        recordReference: b.billNumber,
        entityName: `Purchase Bill ${b.billNumber}`,
        amountCentavos: b.totalAmount,
      })
    );
    journals.slice(0, 35).forEach((j) =>
      realTargets.push({
        entityType: 'JOURNAL_ENTRY',
        module: 'JOURNAL_ENTRY',
        entityId: j.id,
        recordReference: j.journalNumber,
        entityName: `Journal Voucher ${j.journalNumber}`,
        amountCentavos: 85_000_00,
      })
    );
    custPayments.slice(0, 15).forEach((cp) =>
      realTargets.push({
        entityType: 'CUSTOMER_PAYMENT',
        module: 'SALES',
        entityId: cp.id,
        recordReference: cp.paymentNumber,
        entityName: `Official Receipt ${cp.paymentNumber}`,
        amountCentavos: cp.amount,
      })
    );
    supPayments.slice(0, 15).forEach((sp) =>
      realTargets.push({
        entityType: 'SUPPLIER_PAYMENT',
        module: 'PROCUREMENT',
        entityId: sp.id,
        recordReference: sp.paymentNumber,
        entityName: `Disbursement Voucher ${sp.paymentNumber}`,
        amountCentavos: sp.amount,
      })
    );
    prs.slice(0, 12).forEach((pr) =>
      realTargets.push({
        entityType: 'PURCHASE_REQUISITION',
        module: 'PROCUREMENT',
        entityId: pr.id,
        recordReference: pr.prNumber,
        entityName: `Purchase Requisition ${pr.prNumber}`,
        amountCentavos: pr.totalEstimatedAmount || 150_000_00,
      })
    );
    pos.slice(0, 12).forEach((po) =>
      realTargets.push({
        entityType: 'PURCHASE_ORDER',
        module: 'PROCUREMENT',
        entityId: po.id,
        recordReference: po.poNumber,
        entityName: `Purchase Order ${po.poNumber}`,
        amountCentavos: po.totalAmount || 250_000_00,
      })
    );
    cashTxs.slice(0, 12).forEach((ct, idx) =>
      realTargets.push({
        entityType: 'CASH_TRANSACTION',
        module: 'CASH',
        entityId: ct.id,
        recordReference: ct.referenceNo || `CT-2026-${pad(idx + 1, 4)}`,
        entityName: `Cash Transaction ${ct.referenceNo || idx + 1}`,
        amountCentavos: ct.amount,
      })
    );
    payrollRuns.slice(0, 8).forEach((prun, idx) =>
      realTargets.push({
        entityType: 'PAYROLL_RUN',
        module: 'PAYROLL',
        entityId: prun.id,
        recordReference: prun.runNumber || `PAY-2026-${pad(idx + 1, 3)}`,
        entityName: `Payroll Run ${prun.runNumber || idx + 1}`,
        amountCentavos: prun.totalNetPay || 450_000_00,
      })
    );
    fixedAssets.slice(0, 10).forEach((fa) =>
      realTargets.push({
        entityType: 'FIXED_ASSET',
        module: 'FIXED_ASSETS',
        entityId: fa.id,
        recordReference: fa.assetTag,
        entityName: `Fixed Asset ${fa.assetName} (${fa.assetTag})`,
        amountCentavos: fa.acquisitionCost,
      })
    );
    taxFilings.slice(0, 10).forEach((tf) =>
      realTargets.push({
        entityType: 'TAX_FILING',
        module: 'TAX',
        entityId: tf.id,
        recordReference: `${tf.formType}-${tf.period}`,
        entityName: `BIR Form ${tf.formType} (${tf.period})`,
        amountCentavos: tf.taxDue || 95_000_00,
      })
    );
    budgets.slice(0, 8).forEach((b, idx) =>
      realTargets.push({
        entityType: 'BUDGET',
        module: 'BUDGETS',
        entityId: b.id,
        recordReference: `BUD-${b.fiscalYear}-${pad(idx + 1, 2)}`,
        entityName: `Department Budget ${b.name || b.fiscalYear}`,
        amountCentavos: b.totalBudget,
      })
    );
    accounts.slice(0, 12).forEach((acc) =>
      realTargets.push({
        entityType: 'ACCOUNT',
        module: 'ACCOUNTING',
        entityId: acc.id,
        recordReference: `COA-${acc.accountCode}`,
        entityName: `${acc.accountCode} - ${acc.accountName}`,
        amountCentavos: 0,
      })
    );
    docs.slice(0, 20).forEach((d) =>
      realTargets.push({
        entityType: 'DOCUMENT',
        module: 'DOCUMENTS',
        entityId: d.id,
        recordReference: d.extractedInvoiceNumber || d.fileName,
        entityName: `Vault Document ${d.fileName}`,
        amountCentavos: d.extractedTotalAmount || 50_000_00,
      })
    );
    customers.slice(0, 10).forEach((c) =>
      realTargets.push({
        entityType: 'CUSTOMER',
        module: 'SALES',
        entityId: c.id,
        recordReference: c.code || `CUST-${c.id.slice(0, 6)}`,
        entityName: `Customer ${c.name}`,
        amountCentavos: 0,
      })
    );
    vendors.slice(0, 10).forEach((v) =>
      realTargets.push({
        entityType: 'VENDOR',
        module: 'PROCUREMENT',
        entityId: v.id,
        recordReference: v.code || `VEND-${v.id.slice(0, 6)}`,
        entityName: `Supplier ${v.legalName}`,
        amountCentavos: 0,
      })
    );

    // Add Company Profile & User Membership targets so all 5 Category Tabs in Module 15 have rich records
    for (let i = 0; i < 15; i++) {
      realTargets.push({
        entityType: i % 2 === 0 ? 'COMPANY' : 'TAX_FILING',
        module: 'COMPANY',
        entityId: i % 2 === 0 ? companyId : taxFilings[i % Math.max(1, taxFilings.length)]?.id || companyId,
        recordReference: i % 2 === 0 ? `TIN-${company.tin}` : `BIR-${isVat ? '2550Q' : '2551Q'}-2026`,
        entityName: i % 2 === 0 ? `${company.legalName} Tax & CAS Profile` : `BIR Statutory Tax Configuration`,
        amountCentavos: 0,
      });
    }
    for (let i = 0; i < 15; i++) {
      const m = memberships[i % memberships.length];
      realTargets.push({
        entityType: 'MEMBERSHIP',
        module: 'MEMBERSHIP',
        entityId: m.userId,
        recordReference: `RBAC-${m.role.toUpperCase().replace(/\s+/g, '_')}`,
        entityName: `${m.displayName} (${m.role})`,
        amountCentavos: 0,
      });
    }

    // Lifecycle Scenarios covering ALL 15 lifecycle categories in Module 14 + ALL 5 category tabs in Module 15
    const lifecycleTemplates = [
      {
        action: 'CREATE_RECORD',
        prevStatus: null,
        newStatus: 'DRAFT',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: null,
          after: {
            reference: t.recordReference,
            status: 'DRAFT',
            amountPhp: (t.amountCentavos / 100).toFixed(2),
            taxRegime: isVat ? 'VAT_12%' : 'NON_VAT_3%',
            branch: 'HQ-MNL',
          },
          changed: ['reference', 'status', 'amountPhp', 'taxRegime'],
          reason: `Created ${t.entityName} (${t.recordReference}) in draft state with BIR tax coding.`,
        }),
      },
      {
        action: 'UPDATE_FIELD_VALUES',
        prevStatus: 'DRAFT',
        newStatus: 'DRAFT',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: {
            reference: t.recordReference,
            status: 'DRAFT',
            amountPhp: ((t.amountCentavos * 0.9) / 100).toFixed(2),
            atcCode: isVat ? 'WC158 (1% EWT Goods)' : 'PT010 (3% Percentage Tax)',
            costCenter: 'OPS-GENERAL',
          },
          after: {
            reference: t.recordReference,
            status: 'DRAFT',
            amountPhp: (t.amountCentavos / 100).toFixed(2),
            atcCode: isVat ? 'WC160 (2% EWT Services)' : 'PT010 (3% Percentage Tax)',
            costCenter: 'FIN-HQ-MNL',
          },
          changed: ['amountPhp', 'atcCode', 'costCenter'],
          reason: `Updated line amount, BIR ATC tax classification, and cost center allocation on ${t.recordReference}.`,
        }),
      },
      {
        action: 'SUBMIT_FOR_APPROVAL',
        prevStatus: 'DRAFT',
        newStatus: 'SUBMITTED',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'DRAFT', approvalQueue: 'NONE', lockedForEdit: false },
          after: { status: 'SUBMITTED', approvalQueue: 'TIER_1_APPROVER', lockedForEdit: true },
          changed: ['status', 'approvalQueue', 'lockedForEdit'],
          reason: `Submitted ${t.recordReference} to Maker-Checker Approval Queue with supporting voucher attached.`,
        }),
      },
      {
        action: 'APPROVE_WORKFLOW_STEP',
        prevStatus: 'SUBMITTED',
        newStatus: 'APPROVED',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'SUBMITTED', sodVerified: false, approvedBy: null },
          after: { status: 'APPROVED', sodVerified: true, approvedBy: approver.displayName },
          changed: ['status', 'sodVerified', 'approvedBy'],
          reason: `Maker-Checker SoD verified and approved ${t.recordReference} for authoritative GL posting.`,
        }),
      },
      {
        action: 'POST_TO_GL',
        prevStatus: 'APPROVED',
        newStatus: 'POSTED',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'APPROVED', glPosted: false, birCasSealed: false },
          after: { status: 'POSTED', glPosted: true, birCasSealed: true, fiscalPeriod: '2026-11' },
          changed: ['status', 'glPosted', 'birCasSealed', 'fiscalPeriod'],
          reason: `Posted ${t.recordReference} to General Ledger under BIR RR 9-2009 CAS double-entry rules.`,
        }),
      },
      {
        action: 'RETURN_FOR_CORRECTION',
        prevStatus: 'SUBMITTED',
        newStatus: 'RETURNED',
        result: 'WARNING',
        severity: 'WARN',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'SUBMITTED', reviewerNotes: null },
          after: { status: 'RETURNED', reviewerNotes: 'Verify vendor 12-digit BIR TIN and attach signed Delivery Receipt.' },
          changed: ['status', 'reviewerNotes'],
          reason: `Returned ${t.recordReference} to maker for correction: verify vendor BIR TIN & supporting receipt.`,
        }),
      },
      {
        action: 'REJECT_TRANSACTION',
        prevStatus: 'SUBMITTED',
        newStatus: 'REJECTED',
        result: 'WARNING',
        severity: 'WARN',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'SUBMITTED', rejectionCode: null },
          after: { status: 'REJECTED', rejectionCode: 'DUPLICATE_VOUCHER_OR_BUDGET_CAP' },
          changed: ['status', 'rejectionCode'],
          reason: `Rejected ${t.recordReference}: duplicate reference or exceeds departmental budget threshold.`,
        }),
      },
      {
        action: 'CANCEL_VOID_RECORD',
        prevStatus: 'DRAFT',
        newStatus: 'CANCELLED',
        result: 'SUCCESS',
        severity: 'WARN',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'DRAFT', active: true },
          after: { status: 'CANCELLED', active: false, voidReason: 'Superseded by revised commercial terms' },
          changed: ['status', 'active', 'voidReason'],
          reason: `Cancelled unposted voucher ${t.recordReference} while preserving sequential BIR document numbering.`,
        }),
      },
      {
        action: 'ARCHIVE_RETENTION_VAULT',
        prevStatus: 'POSTED',
        newStatus: 'ARCHIVED',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'POSTED', archiveTier: 'ACTIVE_OPERATIONAL' },
          after: { status: 'ARCHIVED', archiveTier: 'BIR_10YR_RETENTION_VAULT', retentionUntil: '2036-12-31' },
          changed: ['status', 'archiveTier', 'retentionUntil'],
          reason: `Moved ${t.recordReference} to System Archive Vault under BIR RR 17-2013 / RR 5-2014 10-year statutory retention.`,
        }),
      },
      {
        action: 'DELETE_SOFT_RECORD',
        prevStatus: 'CANCELLED',
        newStatus: 'SOFT_DELETED',
        result: 'SUCCESS',
        severity: 'WARN',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'CANCELLED', isDeleted: false },
          after: { status: 'SOFT_DELETED', isDeleted: true, preserveAuditLineage: true },
          changed: ['status', 'isDeleted'],
          reason: `Soft-deleted unposted draft ${t.recordReference} to Retention Inbox (recoverable by Company Owner).`,
        }),
      },
      {
        action: 'RESTORE_FROM_ARCHIVE',
        prevStatus: 'ARCHIVED',
        newStatus: 'POSTED',
        result: 'SUCCESS',
        severity: 'INFO',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'ARCHIVED', archiveTier: 'BIR_10YR_RETENTION_VAULT' },
          after: { status: 'POSTED', archiveTier: 'ACTIVE_OPERATIONAL', restoredBy: owner.displayName },
          changed: ['status', 'archiveTier', 'restoredBy'],
          reason: `Restored ${t.recordReference} from Archive Vault for external PSA audit inspection.`,
        }),
      },
      {
        action: 'REVERSE_GL_POSTING',
        prevStatus: 'POSTED',
        newStatus: 'REVERSED',
        result: 'SUCCESS',
        severity: 'WARN',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'POSTED', reversalJe: null },
          after: { status: 'REVERSED', reversalJe: `REV-${t.recordReference}` },
          changed: ['status', 'reversalJe'],
          reason: `Generated equal-and-opposite reversing journal entry for ${t.recordReference} per BIR CAS rules.`,
        }),
      },
      {
        action: 'SOD_POLICY_BLOCKED_FAILED',
        prevStatus: 'SUBMITTED',
        newStatus: 'SUBMITTED',
        result: 'FAILED',
        severity: 'ERROR',
        buildDiff: (t: TargetRef) => ({
          before: { status: 'SUBMITTED', attemptedApprover: accountant.displayName },
          after: { status: 'SUBMITTED', violation: 'SOD_MAKER_CHECKER_CONFLICT_BLOCKED' },
          changed: ['violation'],
          reason: `Blocked self-approval attempt on ${t.recordReference}: Maker (${accountant.displayName}) cannot approve own submission.`,
        }),
      },
      {
        action: 'SECURITY_PERMISSION_ROLE_AUDIT',
        prevStatus: 'ACTIVE',
        newStatus: 'ACTIVE',
        result: 'SUCCESS',
        severity: 'CRITICAL',
        buildDiff: (t: TargetRef) => ({
          before: { rbacPolicy: 'STANDARD_MEMBER', mfaVerified: true, sodEnforcement: 'STRICT' },
          after: { rbacPolicy: 'ENTERPRISE_CAS_ENFORCED', mfaVerified: true, sodEnforcement: 'STRICT_BIR_RR9_2009' },
          changed: ['rbacPolicy', 'sodEnforcement'],
          reason: `Verified RBAC permission matrix and Segregation of Duties (SoD) security policy on ${t.recordReference}.`,
        }),
      },
    ];

    const actors = [owner, accountant, approver, fourthStaff];
    const newAuditRows: any[] = [];
    const baseTimeMs = Date.now();

    for (let i = 0; i < realTargets.length; i++) {
      const target = realTargets[i];
      const tpl = lifecycleTemplates[i % lifecycleTemplates.length];
      // Actor selection: ensure ~35% belong to owner so "My Activities" is populated when logged in as Owner
      const actor = i % 3 === 0 ? owner : actors[i % actors.length];
      const tsDate = new Date(Math.floor((baseTimeMs - i * 42 * 60 * 1000) / 1000) * 1000); // whole seconds for SQLite timestamp_ms mode
      const diff = tpl.buildDiff(target);
      const logId = uuid();

      const beforeDataStr = diff.before ? JSON.stringify(diff.before) : null;
      const afterDataStr = diff.after ? JSON.stringify(diff.after) : null;
      const changedFieldsStr = JSON.stringify(diff.changed);
      const ipAddress = '192.168.10.24';

      const sealHash = computeAuditSealHash({
        id: logId,
        companyId,
        userId: actor.userId,
        userDisplayName: actor.displayName,
        userEmail: actor.email,
        role: actor.role,
        action: tpl.action,
        entityType: target.entityType,
        entityId: target.entityId,
        recordReference: target.recordReference,
        beforeData: beforeDataStr,
        afterData: afterDataStr,
        changedFields: changedFieldsStr,
        result: tpl.result,
        ipAddress,
        timestampIso: tsDate.toISOString(),
        chainVersion: 1,
        sequenceNumber: null,
        previousHash: null,
      });

      newAuditRows.push({
        id: logId,
        companyId,
        userId: actor.userId,
        userEmail: actor.email,
        userDisplayName: actor.displayName,
        role: actor.role,
        action: tpl.action,
        entityType: target.entityType,
        entityId: target.entityId,
        entityName: target.entityName,
        recordReference: target.recordReference,
        beforeData: beforeDataStr,
        afterData: afterDataStr,
        changedFields: changedFieldsStr,
        reason: diff.reason,
        result: tpl.result,
        severity: tpl.severity,
        source: 'WEB_UI',
        module: target.module,
        ipAddress,
        userAgent: 'LedgerAI-Enterprise-CAS/2026.11 (PH-BIR-RR9-2009)',
        requestId: `req-${logId.slice(0, 12)}`,
        metadata: JSON.stringify({
          integritySeal: sealHash,
          sealAlgorithm: 'SHA-256',
          sealVersion: 'BIR-CAS-RR9-2009-v1',
          sealedTimestampIso: tsDate.toISOString(),
          tenantIsolated: true,
        }),
        timestamp: tsDate,
      });
    }

    // Insert in chunks of 100
    for (let i = 0; i < newAuditRows.length; i += 100) {
      await db.insert(schema.auditLogs).values(newAuditRows.slice(i, i + 100));
    }

    // Re-install strict database-engine-level immutability triggers on audit_logs
    db.run(sql`
      CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_update
      BEFORE UPDATE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'SECURITY_VIOLATION: Audit trail records are strictly immutable and cannot be updated.');
      END;
    `);
    db.run(sql`
      CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_delete
      BEFORE DELETE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'SECURITY_VIOLATION: Audit trail records are strictly immutable and cannot be deleted.');
      END;
    `);

    console.log(
      `  [OK] ${company.legalName}: Added ${newWfs.length} new workflows (${refreshedWfs.length + newWfs.length} total), ${wfDocRows.length} supporting docs, and ${newAuditRows.length} cryptographically sealed 360° audit logs.`
    );
    });
  }

  console.log('\n================================================================================');
  console.log(' UPGRADE COMPLETE FOR BOTH COMPANIES');
  console.log('================================================================================');
}

upgradeDualCompanyGovernance().catch((err) => {
  console.error('Upgrade failed:', err);
  process.exit(1);
});
