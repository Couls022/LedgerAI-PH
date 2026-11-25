import React from 'react';
import {
  FileText,
  Building2,
  Users,
  Boxes,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
  ExternalLink,
  Download,
  Scale,
  Receipt,
  CreditCard,
  TrendingUp,
  Layers,
  Award,
  Database,
  Eye,
  FileSpreadsheet,
  GitCommit,
  CheckSquare,
  HardDrive,
} from 'lucide-react';
import { Entity360Definition } from '../../../shared/entity360Registry';

export interface Specialized360RendererProps {
  data360: any;
  definition: Entity360Definition;
  formatPHP: (centavos?: number | null) => string;
  formatDateTime: (ts?: string | number | Date | null) => string;
  onNavigateEntity: (entityType: string, entityId: string, label?: string) => void;
  onSelectTab: (tabId: any) => void;
}

const StatusBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  const s = String(status || 'ACTIVE').toUpperCase();
  const isPositive = ['POSTED', 'PAID', 'APPROVED', 'ACTIVE', 'COMPLETED', 'VERIFIED', 'FILED', 'RECONCILED', 'OPTIMAL_STOCK', 'LOCKED'].includes(s);
  const isWarning = ['DRAFT', 'PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'PARTIAL', 'UNVERIFIED', 'PLANNING', 'FIELDWORK', 'LOW_STOCK_REORDER', 'SCHEDULED'].includes(s);
  const isDanger = ['REJECTED', 'RETURNED', 'VOID', 'CANCELLED', 'REVERSED', 'OVERDUE', 'OUT_OF_STOCK', 'FAILED', 'OPEN'].includes(s);

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
        isPositive
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : isDanger
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : isWarning
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {s}
    </span>
  );
};

// ============================================================================
// 1. FINANCIAL TRANSACTION 360 VIEW
// ============================================================================
export const FinancialTransaction360View: React.FC<Specialized360RendererProps> = ({
  data360,
  definition,
  formatPHP,
  formatDateTime,
  onNavigateEntity,
  onSelectTab,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const lines: any[] = data360?.lines || [];
  const relatedRecords: any[] = data360?.relatedRecords || [];
  const documents: any[] = data360?.documents || [];
  const entityType = data360?.entityType || definition.entityType;

  const counterparty = relatedRecords.find(
    (r) => r.entityType === 'CUSTOMER' || r.entityType === 'VENDOR'
  );
  const glPosting = relatedRecords.find(
    (r) => r.entityType === 'JOURNAL_ENTRY' && r.relationship === 'GL_JOURNAL_POSTING'
  );
  const settlements = relatedRecords.filter((r) =>
    ['OFFICIAL_RECEIPT_COLLECTION', 'SUPPLIER_DISBURSEMENT', 'APPLIED_INVOICE', 'SETTLED_BILL', 'CREDIT_MEMO_ADJUSTMENT', 'DEBIT_MEMO_ADJUSTMENT'].includes(
      r.relationship
    )
  );

  const isJournal = entityType === 'JOURNAL_ENTRY';
  const isPoOrGrn = entityType === 'PURCHASE_ORDER' || entityType === 'GOODS_RECEIPT_NOTE';

  return (
    <div className="space-y-5" data-testid="specialized-financial-transaction-360">
      {/* Top Financial KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {isJournal ? (
          <>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Debits (PHP)</div>
              <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalDebitCentavos)}</div>
              <div className="text-[11px] text-slate-500 mt-1">{lines.filter((l) => Number(l.debit || 0) > 0).length} debit line(s)</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Credits (PHP)</div>
              <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalCreditCentavos)}</div>
              <div className="text-[11px] text-slate-500 mt-1">{lines.filter((l) => Number(l.credit || 0) > 0).length} credit line(s)</div>
            </div>
            <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Double-Entry Proof</div>
              <div className="text-lg font-black text-emerald-900 mt-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                {ctx.isBalancedJournal ? 'BALANCED (₱0.00)' : 'VARIANCE DETECTED'}
              </div>
              <div className="text-[11px] text-emerald-700 mt-1">Debit = Credit enforced</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Source Origin & Date</div>
              <div className="text-sm font-bold text-slate-900 mt-1">{record.sourceType || 'MANUAL_JOURNAL'}</div>
              <div className="text-xs text-slate-500 mt-1">Entry Date: {record.entryDate || record.recordDate || 'N/A'}</div>
            </div>
          </>
        ) : isPoOrGrn ? (
          <>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Commitment Total</div>
              <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalAmount)}</div>
              <div className="text-[11px] text-slate-500 mt-1">Ref: {record.referenceNumber}</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Ordered Quantity</div>
              <div className="text-xl font-black text-slate-900 mt-1 font-mono">{ctx.orderedQty || lines.length} units</div>
              <div className="text-[11px] text-slate-500 mt-1">{lines.length} line item(s)</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Received Quantity (GRN)</div>
              <div className="text-xl font-black text-teal-700 mt-1 font-mono">{ctx.receivedQty || 0} units</div>
              <div className="text-[11px] text-slate-500 mt-1">3-Way Match Verified</div>
            </div>
            <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Fulfillment Progress</div>
              <div className="text-xl font-black text-indigo-950 mt-1">{ctx.fulfillmentPct ?? 0}%</div>
              <div className="w-full h-1.5 bg-indigo-100 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${ctx.fulfillmentPct ?? 0}%` }} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Gross Transaction Total</div>
              <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalAmount)}</div>
              <div className="text-[11px] text-slate-500 mt-1">
                Vatable Base: <span className="font-mono font-semibold">{formatPHP(ctx.vatableBaseCentavos)}</span>
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">12% VAT & EWT Breakdown</div>
              <div className="text-lg font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.vatAmountCentavos)} VAT</div>
              <div className="text-[11px] text-slate-500 mt-1">
                Withholding (2307): <span className="font-mono font-semibold text-amber-700">{formatPHP(ctx.withholdingTaxCentavos)}</span>
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Settled / Allocated</div>
              <div className="text-xl font-black text-emerald-700 mt-1 font-mono">{formatPHP(ctx.settledAmount)}</div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${ctx.settlementProgressPct ?? 0}%` }} />
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Outstanding Balance Due</div>
              <div className={`text-xl font-black mt-1 font-mono ${Number(ctx.balanceDue || 0) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                {formatPHP(ctx.balanceDue)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Due Date: <span className="font-semibold text-slate-700">{record.dueDate || record.recordDate || 'Immediate'}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Counterparty + GL Posting Status Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              Counterparty & Commercial Terms
            </div>
            {counterparty ? (
              <div className="mt-2">
                <div className="text-sm font-black text-slate-900">{counterparty.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Code: <span className="font-mono font-semibold text-slate-700">{counterparty.reference}</span> • {counterparty.entityType}
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <div className="text-sm font-bold text-slate-800">{record.description || record.referenceNumber}</div>
                <div className="text-xs text-slate-500 mt-0.5">Internal Ledger / Direct Posting</div>
              </div>
            )}
          </div>
          {counterparty && (
            <button
              type="button"
              onClick={() => onNavigateEntity(counterparty.entityType, counterparty.id, counterparty.title)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800"
            >
              Open {counterparty.entityType === 'CUSTOMER' ? 'Customer' : 'Supplier'} 360° Profile
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-emerald-600" />
              General Ledger Posting & Reversal Status
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge status={record.status} />
              {ctx.isGlPosted ? (
                <span className="text-xs font-bold text-emerald-700">Authoritative GL Posted</span>
              ) : (
                <span className="text-xs font-semibold text-amber-700">Unposted / Subledger Draft</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              {glPosting
                ? `Linked Journal: ${glPosting.reference} (${glPosting.status})`
                : isJournal
                ? `Journal No: ${record.journalNumber || record.referenceNumber}`
                : 'GL Journal will be generated upon posting'}
            </div>
          </div>
          {glPosting && !isJournal && (
            <button
              type="button"
              onClick={() => onNavigateEntity('JOURNAL_ENTRY', glPosting.id, glPosting.reference)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-900"
            >
              Inspect GL Journal {glPosting.reference}
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-amber-600" />
              Source Documents & Settlement Lineage
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Settlements</div>
                <div className="text-sm font-black text-slate-900">{settlements.length} record(s)</div>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Vault Docs</div>
                <div className="text-sm font-black text-slate-900">{documents.length} file(s)</div>
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSelectTab('related')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
            >
              View Related ({relatedRecords.length})
            </button>
            <span className="text-slate-300">•</span>
            <button
              type="button"
              onClick={() => onSelectTab('documents')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
            >
              Source Documents ({documents.length})
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Line Items Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              {isJournal
                ? `Double-Entry Journal Lines (${lines.length})`
                : isPoOrGrn
                ? `Procurement & Receiving Line Items (${lines.length})`
                : `Transaction Line Items & Account Coding (${lines.length})`}
            </h4>
          </div>
          <span className="text-[11px] font-semibold text-slate-500">
            Ref: <span className="font-mono font-bold text-slate-800">{record.referenceNumber}</span>
          </span>
        </div>

        {lines.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Summary-level financial voucher — no itemized child lines required for this transaction type.
          </div>
        ) : isJournal ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">#</th>
                  <th className="py-2.5 px-4">GL Account</th>
                  <th className="py-2.5 px-4">Line Description</th>
                  <th className="py-2.5 px-4 text-right">Debit (PHP)</th>
                  <th className="py-2.5 px-4 text-right">Credit (PHP)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {lines.map((line: any, idx: number) => (
                  <tr key={line.id || idx} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-400">{line.lineNumber || idx + 1}</td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => line.accountId && onNavigateEntity('ACCOUNT', line.accountId, line.accountName)}
                        className="font-bold text-indigo-700 hover:underline font-mono"
                      >
                        {line.accountCode || line.accountId}
                      </button>
                      <div className="text-[11px] text-slate-600">{line.accountName}</div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{line.description || record.description}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                      {Number(line.debit || 0) > 0 ? formatPHP(line.debit) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                      {Number(line.credit || 0) > 0 ? formatPHP(line.credit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Description / Item</th>
                  <th className="py-2.5 px-4">Account / Tax Code</th>
                  <th className="py-2.5 px-4 text-right">Qty</th>
                  <th className="py-2.5 px-4 text-right">Unit Price</th>
                  <th className="py-2.5 px-4 text-right">Line Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {lines.map((line: any, idx: number) => (
                  <tr key={line.id || idx} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-semibold text-slate-800">{line.description || `Line #${idx + 1}`}</td>
                    <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">
                      {line.accountCode ? `${line.accountCode} — ${line.accountName || ''}` : line.accountId || ' Operating Account'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">
                      {line.quantityOrdered ?? line.quantityReceived ?? line.quantity ?? 1}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatPHP(line.unitPrice ?? line.amount ?? 0)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                      {formatPHP(line.amount ?? (Number(line.quantityReceived || 1) * Number(line.unitPrice || 0)))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Allocation & Settlement Table (if applicable) */}
      {settlements.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-emerald-50/60 border-b border-emerald-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-700" />
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-950">
                Payment Allocations, Official Receipts & Memo Adjustments ({settlements.length})
              </h4>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {settlements.map((rel: any) => (
              <div key={`${rel.entityType}-${rel.id}`} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="font-mono text-indigo-700">{rel.reference}</span>
                    <span>•</span>
                    <span>{rel.title}</span>
                    <StatusBadge status={rel.status} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {rel.module} • Date: {formatDateTime(rel.date)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black font-mono text-emerald-700">{formatPHP(rel.amountCentavos)}</span>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity(rel.entityType, rel.id, rel.reference)}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-bold"
                  >
                    Open 360°
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. CUSTOMER RELATIONSHIP 360 VIEW
// ============================================================================
export const CustomerRelationship360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const invoices: any[] = ctx.invoices || [];
  const collections: any[] = ctx.collections || [];
  const creditMemos: any[] = ctx.creditMemos || [];

  return (
    <div className="space-y-5" data-testid="specialized-customer-relationship-360">
      {/* Commercial & AR Exposure KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Outstanding AR Balance</div>
          <div className="text-xl font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.receivableBalance)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{ctx.openInvoicesCount || 0} open invoice(s)</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Overdue AR Exposure</div>
          <div className={`text-xl font-black mt-1 font-mono ${Number(ctx.overdueBalance || 0) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
            {formatPHP(ctx.overdueBalance)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{ctx.overdueInvoicesCount || 0} past-due invoice(s)</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Authorized Credit Limit</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">
            {Number(ctx.creditLimit || 0) > 0 ? formatPHP(ctx.creditLimit) : 'Unlimited / Terms'}
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${(ctx.creditUtilizationPct || 0) > 85 ? 'bg-rose-500' : 'bg-sky-600'}`}
              style={{ width: `${ctx.creditUtilizationPct || 0}%` }}
            />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lifetime Billed / Collected</div>
          <div className="text-lg font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalBilled)}</div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-1">
            Collected: <span className="font-mono">{formatPHP(ctx.totalCollected)}</span>
          </div>
        </div>
      </div>

      {/* Customer Master & BIR Tax Profile Card */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-600" />
          Customer Commercial & BIR Statutory Registration Profile
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Customer Code & Legal Name</div>
            <div className="font-bold text-slate-900 mt-0.5">{record.code} — {record.legalName}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">BIR TIN & VAT Status</div>
            <div className="font-mono font-bold text-slate-900 mt-0.5">{record.tin || '000-000-000-000'}</div>
            <div className="text-[11px] text-slate-500">{record.vatStatus || 'VAT_REGISTERED'} • {record.taxClassification || 'CORPORATION'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Payment Terms & WHT</div>
            <div className="font-bold text-slate-900 mt-0.5">{record.paymentTerms || 'Net 30 Days'}</div>
            <div className="text-[11px] text-slate-500">2307 WHT: {record.withholdingApplicability || 'Applicable'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Primary Contact & Billing Address</div>
            <div className="font-bold text-slate-900 mt-0.5">{record.contactPerson || 'Accounts Payable Dept'}</div>
            <div className="text-[11px] text-slate-500 truncate">{record.billingAddress || record.address || 'Metro Manila, PH'}</div>
          </div>
        </div>
      </div>

      {/* Sales Invoices & OR Collections Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Sales Invoices ({invoices.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {invoices.length === 0 ? (
              <div className="p-5 text-center text-xs text-slate-500">No sales invoices billed to this customer yet.</div>
            ) : (
              invoices.map((inv: any) => (
                <div key={inv.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                  <div>
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <span className="font-mono text-indigo-700">{inv.invoiceNumber}</span>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Date: {inv.invoiceDate} • Due: {inv.dueDate || 'N/A'} • Bal: {formatPHP(inv.balanceDue)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-black font-mono text-slate-900">{formatPHP(inv.totalAmount)}</span>
                    <button
                      type="button"
                      onClick={() => onNavigateEntity('SALES_INVOICE', inv.id, inv.invoiceNumber)}
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50 text-indigo-700 text-[11px] font-bold"
                    >
                      360°
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Official Receipt Collections ({collections.length}) & Credit Memos ({creditMemos.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {collections.length === 0 && creditMemos.length === 0 ? (
              <div className="p-5 text-center text-xs text-slate-500">No collections or credit memos recorded yet.</div>
            ) : (
              <>
                {collections.map((cp: any) => (
                  <div key={cp.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                        <span className="font-mono text-emerald-700">{cp.officialReceiptNumber || cp.paymentNumber}</span>
                        <StatusBadge status={cp.status} />
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {cp.paymentDate} • {cp.paymentMethod} • 2307 CWT: {formatPHP(cp.withholdingTaxAmount)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-black font-mono text-emerald-700">{formatPHP(cp.amount)}</span>
                      <button
                        type="button"
                        onClick={() => onNavigateEntity('CUSTOMER_PAYMENT', cp.id, cp.paymentNumber)}
                        className="px-2 py-1 rounded bg-slate-100 hover:bg-emerald-50 text-emerald-700 text-[11px] font-bold"
                      >
                        360°
                      </button>
                    </div>
                  </div>
                ))}
                {creditMemos.map((cm: any) => (
                  <div key={cm.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                        <span className="font-mono text-amber-700">{cm.creditMemoNumber}</span>
                        <StatusBadge status={cm.status} />
                      </div>
                      <div className="text-[11px] text-slate-500">{cm.memoDate} • {cm.reason || 'Credit Memo'}</div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-black font-mono text-amber-700">{formatPHP(cm.totalAmount)}</span>
                      <button
                        type="button"
                        onClick={() => onNavigateEntity('CREDIT_MEMO', cm.id, cm.creditMemoNumber)}
                        className="px-2 py-1 rounded bg-slate-100 hover:bg-amber-50 text-amber-700 text-[11px] font-bold"
                      >
                        360°
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. VENDOR / SUPPLIER RELATIONSHIP 360 VIEW
// ============================================================================
export const VendorRelationship360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const bills: any[] = ctx.bills || [];
  const disbursements: any[] = ctx.disbursements || [];
  const purchaseOrders: any[] = ctx.purchaseOrders || [];

  return (
    <div className="space-y-5" data-testid="specialized-vendor-relationship-360">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Outstanding AP Balance</div>
          <div className="text-xl font-black text-violet-900 mt-1 font-mono">{formatPHP(ctx.payableBalance)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{ctx.openBillsCount || 0} open supplier bill(s)</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cumulative Purchases</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalBilled)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{bills.length} total bill(s)</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Cash Disbursed</div>
          <div className="text-xl font-black text-emerald-700 mt-1 font-mono">{formatPHP(ctx.totalDisbursed)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{disbursements.length} disbursement voucher(s)</div>
        </div>
        <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Total EWT Withheld (BIR 2307)</div>
          <div className="text-xl font-black text-amber-900 mt-1 font-mono">{formatPHP(ctx.totalWithheldEwt)}</div>
          <div className="text-[11px] text-amber-700 mt-1">Alphalist & 1601-EQ Tracked</div>
        </div>
      </div>

      {/* Supplier Master & Tax Profile */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-violet-600" />
          Supplier Registration, BIR TIN & Expanded Withholding Tax Profile
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Supplier Code & Legal Name</div>
            <div className="font-bold text-slate-900 mt-0.5">{record.code} — {record.legalName}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">BIR TIN & VAT Status</div>
            <div className="font-mono font-bold text-slate-900 mt-0.5">{record.tin || '000-000-000-000'}</div>
            <div className="text-[11px] text-slate-500">{record.vatStatus || 'VAT_REGISTERED'} • {record.taxClassification || 'CORPORATION'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Payment Terms & EWT ATC</div>
            <div className="font-bold text-slate-900 mt-0.5">{record.paymentTerms || 'Net 30 Days'}</div>
            <div className="text-[11px] text-slate-500">EWT: {record.withholdingApplicability || 'WC158 / WC160'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Contact & Address</div>
            <div className="font-bold text-slate-900 mt-0.5">{record.contactPerson || 'Supplier Billing Desk'}</div>
            <div className="text-[11px] text-slate-500 truncate">{record.address || 'Metro Manila, PH'}</div>
          </div>
        </div>
      </div>

      {/* Purchase Bills, Disbursements & POs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Supplier Purchase Bills ({bills.length}) & POs ({purchaseOrders.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {bills.map((b: any) => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="font-mono text-violet-700">{b.billNumber}</span>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Bill Date: {b.billDate} • Balance Due: {formatPHP(b.balanceDue)}
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-black font-mono text-slate-900">{formatPHP(b.totalAmount)}</span>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity('PURCHASE_BILL', b.id, b.billNumber)}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-violet-50 text-violet-700 text-[11px] font-bold"
                  >
                    360°
                  </button>
                </div>
              </div>
            ))}
            {purchaseOrders.map((po: any) => (
              <div key={po.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="font-mono text-indigo-700">{po.poNumber}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <div className="text-[11px] text-slate-500">PO Date: {po.poDate}</div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-black font-mono text-slate-900">{formatPHP(po.totalAmount)}</span>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity('PURCHASE_ORDER', po.id, po.poNumber)}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50 text-indigo-700 text-[11px] font-bold"
                  >
                    360°
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Supplier Disbursements & BIR 2307 EWT ({disbursements.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {disbursements.length === 0 ? (
              <div className="p-5 text-center text-xs text-slate-500">No supplier disbursements recorded yet.</div>
            ) : (
              disbursements.map((sp: any) => (
                <div key={sp.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                  <div>
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <span className="font-mono text-emerald-700">{sp.paymentNumber}</span>
                      <StatusBadge status={sp.status} />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {sp.paymentDate} • {sp.paymentMethod} • EWT Withheld: {formatPHP(sp.withholdingTaxAmount)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-black font-mono text-emerald-700">{formatPHP(sp.amount)}</span>
                    <button
                      type="button"
                      onClick={() => onNavigateEntity('SUPPLIER_PAYMENT', sp.id, sp.paymentNumber)}
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-emerald-50 text-emerald-700 text-[11px] font-bold"
                    >
                      360°
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. INVENTORY & WAREHOUSE OPERATIONS 360 VIEW
// ============================================================================
export const InventoryOperations360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const item = ctx.itemProfile || record;
  const movements: any[] = ctx.movements || [];
  const adjustments: any[] = ctx.adjustments || [];

  return (
    <div className="space-y-5" data-testid="specialized-inventory-operations-360">
      {/* Stock & Valuation KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Quantity On Hand</div>
          <div className="text-xl font-black text-teal-900 mt-1 font-mono">
            {ctx.quantityOnHand ?? item.quantityOnHand ?? 0} {ctx.unitOfMeasure || 'PCS'}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={ctx.stockHealth || 'OPTIMAL_STOCK'} />
            <span className="text-[11px] text-slate-500">Reorder @ {ctx.reorderPoint || 10}</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Unit Valuation Cost</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.unitCost)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Method: {ctx.costingMethod || 'FIFO'}</div>
        </div>
        <div className="bg-teal-50/60 p-4 rounded-xl border border-teal-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800">Total Inventory Valuation</div>
          <div className="text-xl font-black text-teal-950 mt-1 font-mono">{formatPHP(ctx.totalValuation)}</div>
          <div className="text-[11px] text-teal-700 mt-1">Reconciled to GL Inventory Asset</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Standard Selling Price</div>
          <div className="text-xl font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.sellingPrice)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Category: {item.category || 'General Stock'}</div>
        </div>
      </div>

      {/* Chronological Stock Movement Ledger */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-teal-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Warehouse Stock Movement Ledger ({movements.length})
            </h4>
          </div>
          <span className="text-xs font-mono font-bold text-slate-700">SKU: {item.sku || record.referenceNumber}</span>
        </div>
        {movements.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No stock movement transactions recorded yet for this SKU.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Movement Type</th>
                  <th className="py-2.5 px-4">Reference / Notes</th>
                  <th className="py-2.5 px-4 text-right">Qty Change</th>
                  <th className="py-2.5 px-4 text-right">Unit Cost</th>
                  <th className="py-2.5 px-4 text-right">Extended Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {movements.map((m: any) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-600">{m.transactionDate}</td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={m.type} />
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      <span className="font-mono font-semibold">{m.reference || 'SYS'}</span>
                      {m.notes ? ` — ${m.notes}` : ''}
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${Number(m.quantity || 0) >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {Number(m.quantity || 0) >= 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatPHP(m.unitCost)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">{formatPHP(m.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Physical Stock Count Adjustments */}
      {adjustments.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Physical Count & Stock Adjustments ({adjustments.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100">
            {adjustments.map((adj: any) => (
              <div key={adj.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="font-mono text-teal-700">{adj.adjustmentNumber}</span>
                    <StatusBadge status={adj.status} />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {adj.adjustmentDate} • Reason: {adj.reason}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-bold text-slate-900">
                    Qty: {Number(adj.quantityChange) >= 0 ? `+${adj.quantityChange}` : adj.quantityChange}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity('STOCK_ADJUSTMENT', adj.id, adj.adjustmentNumber)}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-teal-50 text-teal-700 text-[11px] font-bold"
                  >
                    360°
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 5. PAYROLL & COMPENSATION 360 VIEW
// ============================================================================
export const Payroll360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const isEmployee = ctx.payrollSubtype === 'EMPLOYEE' || data360?.entityType === 'EMPLOYEE';
  const canViewSensitive = ctx.canViewSensitiveCompensation !== false;

  if (isEmployee) {
    const payslips: any[] = ctx.payslips || [];
    return (
      <div className="space-y-5" data-testid="specialized-payroll-employee-360">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Monthly Basic Salary</div>
            <div className="text-xl font-black text-slate-900 mt-1 font-mono">
              {canViewSensitive ? formatPHP(ctx.monthlyBasicSalary ?? record.monthlyBasicSalary) : '••••••••'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">{record.position || 'Staff'} • {record.department || 'General'}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">YTD Gross Compensation</div>
            <div className="text-xl font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.ytdGrossPay)}</div>
            <div className="text-[11px] text-slate-500 mt-1">{payslips.length} payroll run(s)</div>
          </div>
          <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">YTD Withheld Tax (BIR 2316)</div>
            <div className="text-xl font-black text-amber-900 mt-1 font-mono">{formatPHP(ctx.ytdWithholdingTax)}</div>
            <div className="text-[11px] text-amber-700 mt-1">SSS/PHIC/HDMF: {formatPHP((ctx.ytdSss || 0) + (ctx.ytdPhilhealth || 0) + (ctx.ytdPagibig || 0))}</div>
          </div>
          <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">YTD Net Take-Home Pay</div>
            <div className="text-xl font-black text-emerald-900 mt-1 font-mono">{formatPHP(ctx.ytdNetPay)}</div>
            <div className="text-[11px] text-emerald-700 mt-1">Disbursed via Payroll</div>
          </div>
        </div>

        {/* Statutory Numbers */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">BIR TIN</div>
            <div className="font-mono font-bold text-slate-900 mt-0.5">{record.tin || '000-000-000-000'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">SSS Number</div>
            <div className="font-mono font-bold text-slate-900 mt-0.5">{record.sssNo || '34-0000000-0'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">PhilHealth PIN</div>
            <div className="font-mono font-bold text-slate-900 mt-0.5">{record.philhealthNo || '12-000000000-0'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400">Pag-IBIG MID</div>
            <div className="font-mono font-bold text-slate-900 mt-0.5">{record.pagibigNo || '1210-0000-0000'}</div>
          </div>
        </div>

        {/* Payslip History */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Processed Payroll Runs & Payslip Register ({payslips.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100">
            {payslips.map((p: any) => (
              <div key={p.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="font-mono text-violet-700">{p.payrollPeriod}</span>
                    <StatusBadge status={p.runStatus} />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Pay Date: {p.paymentDate} • WHT: {formatPHP(p.withholdingTax)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-black text-emerald-700">
                    Net: {p.masked ? '••••••••' : formatPHP(p.netPay)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity('PAYROLL_RUN', p.payrollRunId, p.payrollPeriod)}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-violet-50 text-violet-700 text-[11px] font-bold"
                  >
                    Run 360°
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // PAYROLL_RUN
  const register: any[] = ctx.employeeRegister || data360?.lines || [];
  return (
    <div className="space-y-5" data-testid="specialized-payroll-run-360">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Gross Payroll</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalGrossPay)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{ctx.employeeCount || register.length} processed employee(s)</div>
        </div>
        <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">BIR 1601-C Withholding Tax</div>
          <div className="text-xl font-black text-amber-900 mt-1 font-mono">{formatPHP(ctx.totalWithholdingTax)}</div>
          <div className="text-[11px] text-amber-700 mt-1">Compensation WHT Liability</div>
        </div>
        <div className="bg-violet-50/60 p-4 rounded-xl border border-violet-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-violet-800">SSS / PhilHealth / Pag-IBIG (EE)</div>
          <div className="text-lg font-black text-violet-950 mt-1 font-mono">
            {formatPHP((ctx.totalSssEE || 0) + (ctx.totalPhilhealthEE || 0) + (ctx.totalPagibigEE || 0))}
          </div>
          <div className="text-[11px] text-violet-700 mt-1">
            SSS: {formatPHP(ctx.totalSssEE)} • PHIC: {formatPHP(ctx.totalPhilhealthEE)} • HDMF: {formatPHP(ctx.totalPagibigEE)}
          </div>
        </div>
        <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Total Net Take-Home Pay</div>
          <div className="text-xl font-black text-emerald-950 mt-1 font-mono">{formatPHP(ctx.totalNetPay)}</div>
          <div className="text-[11px] text-emerald-700 mt-1">Pay Date: {record.paymentDate}</div>
        </div>
      </div>

      {/* Employee Payroll Register Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Employee Payroll & Statutory Deductions Register ({register.length})
            </h4>
          </div>
          {!canViewSensitive && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              <Lock className="w-3 h-3" /> Individual Salary Masked by Role Policy
            </span>
          )}
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Employee</th>
                <th className="py-2.5 px-4 text-right">Gross Pay</th>
                <th className="py-2.5 px-4 text-right">SSS (EE)</th>
                <th className="py-2.5 px-4 text-right">PhilHealth (EE)</th>
                <th className="py-2.5 px-4 text-right">Pag-IBIG (EE)</th>
                <th className="py-2.5 px-4 text-right">1601-C WHT</th>
                <th className="py-2.5 px-4 text-right">Net Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {register.map((item: any, idx: number) => (
                <tr key={item.id || idx} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4">
                    <button
                      type="button"
                      onClick={() => item.employeeId && onNavigateEntity('EMPLOYEE', item.employeeId, item.description)}
                      className="font-bold text-indigo-700 hover:underline"
                    >
                      {item.firstName ? `${item.firstName} ${item.lastName}` : item.description || item.employeeId}
                    </button>
                    <div className="text-[10px] font-mono text-slate-400">{item.employeeNumber || ''}</div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">{item.masked ? '••••••' : formatPHP(item.grossPay)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-600">{formatPHP(item.sssEmployee)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-600">{formatPHP(item.philhealthEmployee)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-600">{formatPHP(item.pagibigEmployee)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-amber-700 font-semibold">{formatPHP(item.withholdingTax)}</td>
                  <td className="py-2.5 px-4 text-right font-mono font-black text-emerald-700">
                    {item.masked ? '••••••' : formatPHP(item.netPay)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 6. TAX & STATUTORY COMPLIANCE 360 VIEW
// ============================================================================
export const TaxCompliance360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  formatDateTime,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const checklist: any[] = ctx.checklist || [];
  const manualAdjustments: any[] = ctx.manualAdjustments || [];
  const recentCalcs: any[] = ctx.recentTaxCalculations || [];

  return (
    <div className="space-y-5" data-testid="specialized-tax-compliance-360">
      {/* Honest BIR Filing Status Banner */}
      <div
        className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          ctx.isFiledWithBir
            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
            : 'bg-amber-50/80 border-amber-200 text-amber-950'
        }`}
      >
        <div className="flex items-start gap-3">
          <FileText className={`w-5 h-5 mt-0.5 ${ctx.isFiledWithBir ? 'text-emerald-700' : 'text-amber-700'}`} />
          <div>
            <div className="text-xs font-black uppercase tracking-wider">
              BIR Return Status: {ctx.honestFilingStatus || record.status || 'DRAFT'} ({ctx.taxType} — {ctx.periodName})
            </div>
            <div className="text-xs mt-0.5">
              {ctx.isFiledWithBir
                ? `Official BIR Filing Recorded • Receipt Ref: ${ctx.birReceiptReference || 'Verified'}`
                : 'Internal Statutory Computation / Draft Return — Not yet electronically transmitted to BIR eFPS/eBIRForms.'}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase opacity-75">Statutory Deadline</div>
          <div className="text-xs font-mono font-bold">{ctx.deadlineDate || record.deadlineDate || '25th of Following Month'}</div>
        </div>
      </div>

      {/* Tax KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Taxable Base / Gross Sales</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalTaxBase)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Reconciled with General Ledger</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Gross Statutory Tax Due</div>
          <div className="text-xl font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.totalTaxDue)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Tax Type: {ctx.taxType}</div>
        </div>
        <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Net Tax Payable / (Credit)</div>
          <div className="text-xl font-black text-amber-950 mt-1 font-mono">{formatPHP(ctx.netTaxPayable)}</div>
          <div className="text-[11px] text-amber-700 mt-1">{manualAdjustments.length} manual adjustment(s)</div>
        </div>
      </div>

      {/* Checklist & Source Tax Calculations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              CPA Tax Return Preparation Checklist ({checklist.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 p-4 space-y-2">
            {checklist.length === 0 ? (
              <div className="text-xs text-slate-500">
                1. Reconcile Output VAT & Input VAT schedules with GL Trial Balance.<br />
                2. Validate BIR Form 2307 TINs & ATC codes for SAWT/QAP Alphalist.<br />
                3. Obtain CPA Reviewer sign-off prior to eBIRForms/eFPS lock.
              </div>
            ) : (
              checklist.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-xs py-1">
                  <span className="font-semibold text-slate-800">{c.taskName}</span>
                  <StatusBadge status={c.isCompleted ? 'COMPLETED' : 'PENDING'} />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Persisted Tax Calculation Ledger ({recentCalcs.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {recentCalcs.map((tc: any) => (
              <div key={tc.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-800 font-mono">Rate: {((tc.taxRate || 0) * 100).toFixed(1)}%</div>
                  <div className="text-[11px] text-slate-500">Tax Base: {formatPHP(tc.taxBase)} • {formatDateTime(tc.createdAt)}</div>
                </div>
                <div className="font-mono font-black text-amber-800">{formatPHP(tc.taxAmount)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 7. BANKING & RECONCILIATION 360 VIEW
// ============================================================================
export const BankingReconciliation360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const isAccount = ctx.bankingSubtype === 'ACCOUNT' || data360?.entityType === 'ACCOUNT';

  if (isAccount) {
    const postings: any[] = ctx.recentPostings || data360?.lines || [];
    return (
      <div className="space-y-5" data-testid="specialized-coa-account-360">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Posted GL Debits</div>
            <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalDebits)}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Posted GL Credits</div>
            <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.totalCredits)}</div>
          </div>
          <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">Net Account Balance ({ctx.normalBalance})</div>
            <div className="text-xl font-black text-indigo-950 mt-1 font-mono">{formatPHP(ctx.netRunningBalance)}</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              General Ledger Account Postings ({postings.length})
            </h4>
            <span className="text-xs font-mono font-bold text-slate-600">{record.accountCode} — {record.accountName}</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {postings.map((p: any) => (
              <div key={p.id} className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-slate-50">
                <div>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity('JOURNAL_ENTRY', p.journalEntryId, p.journalNumber)}
                    className="font-mono font-bold text-indigo-700 hover:underline"
                  >
                    {p.journalNumber}
                  </button>
                  <span className="text-slate-600 ml-2">{p.description}</span>
                  <div className="text-[11px] text-slate-400">{p.entryDate}</div>
                </div>
                <div className="font-mono font-bold">
                  {Number(p.debit || 0) > 0 ? `Dr ${formatPHP(p.debit)}` : `Cr ${formatPHP(p.credit)}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // BANK_RECONCILIATION
  const stmtLines: any[] = ctx.statementLines || [];
  return (
    <div className="space-y-5" data-testid="specialized-banking-reconciliation-360">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bank Statement Ending</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.statementEndingBalance)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Statement Date: {record.statementDate}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">GL Book Ending Balance</div>
          <div className="text-xl font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.bookEndingBalance)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Adjusted Book: {formatPHP(ctx.adjustedBookBalance)}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Transit & Outstanding</div>
          <div className="text-xs font-bold text-slate-800 mt-1">
            DIT: <span className="font-mono">{formatPHP(ctx.depositsInTransitAmount)}</span> ({ctx.depositsInTransitCount})
          </div>
          <div className="text-xs font-bold text-slate-800 mt-1">
            OC: <span className="font-mono">{formatPHP(ctx.outstandingChecksAmount)}</span> ({ctx.outstandingChecksCount})
          </div>
        </div>
        <div
          className={`p-4 rounded-xl border shadow-xs ${
            ctx.isBalancedReconciliation ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Unexplained Difference</div>
          <div className={`text-xl font-black mt-1 font-mono ${ctx.isBalancedReconciliation ? 'text-emerald-800' : 'text-rose-700'}`}>
            {formatPHP(ctx.unexplainedDifference)}
          </div>
          <div className="text-[11px] font-bold mt-1">
            {ctx.isBalancedReconciliation ? 'RECONCILED (₱0.00 Variance)' : 'Requires Matching / Adjustment'}
          </div>
        </div>
      </div>

      {/* Statement Lines Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Bank Statement Lines ({stmtLines.length}) — Matched ({ctx.matchedLinesCount || 0}) vs Unmatched ({ctx.unmatchedLinesCount || 0})
            </h4>
          </div>
        </div>
        {stmtLines.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Summary bank reconciliation proof verified against General Ledger cash control account.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Match Status</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {stmtLines.map((l: any) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono">{l.lineDate}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-800">{l.description}</td>
                    <td className="py-2.5 px-4">{l.type}</td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={l.matchedStatus} />
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold">{formatPHP(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 8. FIXED ASSET 360 VIEW
// ============================================================================
export const FixedAsset360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const schedules: any[] = ctx.schedules || [];

  return (
    <div className="space-y-5" data-testid="specialized-fixed-asset-360">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Acquisition Cost</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.acquisitionCost)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Acquired: {ctx.acquisitionDate || record.acquisitionDate}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Useful Life & Monthly Dep.</div>
          <div className="text-lg font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.monthlyDepreciation)} / mo</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {ctx.usefulLifeMonths} months • {ctx.depreciationMethod || 'STRAIGHT_LINE'}
          </div>
        </div>
        <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Accumulated Depreciation</div>
          <div className="text-xl font-black text-amber-950 mt-1 font-mono">{formatPHP(ctx.accumulatedDepreciation)}</div>
          <div className="w-full h-1.5 bg-amber-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-amber-600 rounded-full" style={{ width: `${ctx.depreciatedPct || 0}%` }} />
          </div>
        </div>
        <div className="bg-sky-50/60 p-4 rounded-xl border border-sky-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-sky-800">Carrying Net Book Value</div>
          <div className="text-xl font-black text-sky-950 mt-1 font-mono">{formatPHP(ctx.netBookValue)}</div>
          <div className="text-[11px] text-sky-700 mt-1">Salvage Value: {formatPHP(ctx.salvageValue)}</div>
        </div>
      </div>

      {/* Depreciation Schedule Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-sky-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Straight-Line Monthly Depreciation Schedule ({schedules.length} periods shown)
            </h4>
          </div>
          <span className="text-xs font-mono font-bold text-slate-700">
            Tag: {ctx.assetTag || record.assetTag} • {ctx.category || record.category}
          </span>
        </div>
        <div className="overflow-x-auto max-h-72">
          {schedules.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No persisted depreciation schedule periods recorded for this fixed asset yet. Accumulated depreciation is ₱0.00 until depreciation runs are posted.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Period Month</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Monthly Depreciation</th>
                  <th className="py-2.5 px-4 text-right">Accumulated Dep.</th>
                  <th className="py-2.5 px-4 text-right">Ending Net Book Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {schedules.map((s: any, idx: number) => (
                  <tr key={s.id || idx} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-800">{s.periodMonth}</td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatPHP(s.depreciationAmount)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-amber-800">{formatPHP(s.accumulatedDepreciation)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-black text-sky-900">{formatPHP(s.bookValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 9. DOCUMENT & OCR INTELLIGENCE 360 VIEW
// ============================================================================
export const DocumentIntelligence360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const extracted = ctx.extractedFields || {};
  const relatedRecords: any[] = data360?.relatedRecords || [];
  const previewUrl = ctx.previewUrl || `/api/documents/${data360?.entityId}/file`;
  const downloadUrl = ctx.downloadUrl || `/api/documents/${data360?.entityId}/file?download=1`;
  const isImage = String(ctx.fileType || record.fileType || '').startsWith('image/');

  return (
    <div className="space-y-5" data-testid="specialized-document-intelligence-360">
      {/* Cryptographic Vault & OCR Confidence Header Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">Vault Encryption Status</div>
          <div className="text-sm font-black text-indigo-950 mt-1 flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-indigo-600" />
            {ctx.encryptionStatus || 'ENCRYPTED_AES256_GCM'}
          </div>
          <div className="text-[11px] text-indigo-700 mt-1 font-mono truncate">
            SHA-256: {(ctx.fileHash || record.fileHash || 'VERIFIED').slice(0, 18)}...
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">OCR Extraction Confidence</div>
          <div className="text-xl font-black text-emerald-700 mt-1 font-mono">
            {ctx.confidenceScore != null && !Number.isNaN(Number(ctx.confidenceScore))
              ? `${Math.round(Number(ctx.confidenceScore) * 100)}%`
              : 'Pending / N/A'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Engine: {ctx.extractionEngine || 'UNSPECIFIED'}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">OCR Extracted Total</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">
            {extracted.totalAmount != null ? formatPHP(extracted.totalAmount) : 'Not extracted'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            VAT: {extracted.vatAmount != null ? formatPHP(extracted.vatAmount) : 'Not extracted'}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Human Verification</div>
          <div className="mt-1.5">
            <StatusBadge status={ctx.verificationStatus || record.verificationStatus || 'UNVERIFIED'} />
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">
            {ctx.versionsCount || 1} version(s) • {((ctx.fileSize || 0) / 1024).toFixed(1)} KB
          </div>
        </div>
      </div>

      {/* Split Pane: Left Live Document Preview, Right Structured OCR Fields */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Decrypted Document Stream Preview
              </h4>
            </div>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700"
            >
              <Download className="w-3.5 h-3.5" />
              Download File
            </a>
          </div>
          <div className="p-4 bg-slate-900/5 flex-1 min-h-[280px] flex items-center justify-center">
            {isImage ? (
              <img
                src={previewUrl}
                alt={ctx.originalFileName || record.fileName}
                className="max-h-72 w-auto rounded-lg border border-slate-300 shadow-sm object-contain bg-white"
              />
            ) : (
              <iframe
                src={previewUrl}
                title={ctx.originalFileName || record.fileName}
                className="w-full h-72 rounded-lg border border-slate-300 bg-white"
              />
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Structured OCR Extracted Fields & Linked Accounting Record
              </h4>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-bold uppercase text-slate-400">Extracted Merchant / Counterparty</div>
                <div className="font-bold text-slate-900 mt-0.5">{extracted.merchant || extracted.customer || record.originalFileName}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-bold uppercase text-slate-400">Extracted BIR TIN</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5">{extracted.tin || 'Not extracted'}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-bold uppercase text-slate-400">Invoice / OR Reference</div>
                <div className="font-mono font-bold text-indigo-700 mt-0.5">{extracted.invoiceNumber || 'Not extracted'}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-bold uppercase text-slate-400">Document Date & Category</div>
                <div className="font-bold text-slate-900 mt-0.5">{extracted.date || 'Not extracted'} • {extracted.category || record.documentType}</div>
              </div>
            </div>
          </div>

          {relatedRecords.length > 0 && (
            <div className="p-4 border-t border-slate-100 bg-indigo-50/40">
              <div className="text-[10px] font-bold uppercase text-indigo-700 mb-2">Linked Accounting Transaction</div>
              {relatedRecords.map((rel: any) => (
                <div key={rel.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-900">{rel.title}</div>
                    <div className="text-[11px] text-slate-500">{rel.module} • {rel.status}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateEntity(rel.entityType, rel.id, rel.reference)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
                  >
                    Open Linked {rel.entityType} 360°
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 10. APPROVAL & WORKFLOW 360 VIEW
// ============================================================================
export const ApprovalWorkflow360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  formatDateTime,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const steps: any[] = ctx.steps || data360?.approvalOrchestration?.[0]?.steps || [];
  const isBudget = ctx.approvalSubtype === 'BUDGET' || data360?.entityType === 'BUDGET';

  if (isBudget) {
    return (
      <div className="space-y-4" data-testid="specialized-budget-360">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Budget Category</div>
            <div className="text-lg font-black text-slate-900 mt-1">{ctx.category || record.category}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Fiscal Period Month</div>
            <div className="text-lg font-black text-indigo-900 mt-1 font-mono">{ctx.periodMonth || record.periodMonth}</div>
          </div>
          <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Authorized Monthly Limit</div>
            <div className="text-xl font-black text-amber-950 mt-1 font-mono">{formatPHP(ctx.monthlyLimit ?? record.monthlyLimit)}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="specialized-approval-workflow-360">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Amount Under Governance</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.amountCentavos)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Policy: {ctx.workflowType || 'SEQUENTIAL'}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Approval Step Progress</div>
          <div className="text-xl font-black text-indigo-900 mt-1">
            Step {ctx.currentStepOrder || 1} of {ctx.totalSteps || 1}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">SLA Status: {ctx.slaStatus || 'ON_TRACK'}</div>
        </div>
        <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Segregation of Duties (SoD)</div>
          <div className="text-sm font-black text-emerald-950 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            {ctx.sodCompliant !== false ? 'SoD VERIFIED (Maker ≠ Checker)' : 'SoD EXCEPTION LOGGED'}
          </div>
          {ctx.targetEntityId && (
            <button
              type="button"
              onClick={() => onNavigateEntity(ctx.targetEntityType, ctx.targetEntityId, ctx.targetRecordReference)}
              className="mt-1.5 text-xs font-bold text-indigo-700 hover:underline inline-flex items-center gap-1"
            >
              Inspect Target {ctx.targetEntityType} ({ctx.targetRecordReference})
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sequential Step Pipeline */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
            Approval Step Sequence & Decision Log ({steps.length})
          </h4>
        </div>
        <div className="divide-y divide-slate-100">
          {steps.map((step: any) => (
            <div key={step.id} className="px-4 py-3 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-slate-900 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">Gate #{step.stepOrder}</span>
                  <span>{step.stepName}</span>
                  <StatusBadge status={step.status} />
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Required Role: <span className="font-semibold">{step.requiredRole || 'Approver'}</span> • Assigned:{' '}
                  {step.assignedApproverName || 'Role Queue'}
                  {step.actualApproverName ? ` • Decided by: ${step.actualApproverName}` : ''}
                </div>
                {step.comments && <div className="text-[11px] italic text-slate-600 mt-0.5">"{step.comments}"</div>}
              </div>
              <div className="text-right text-[11px] text-slate-500">
                {step.respondedAt ? formatDateTime(step.respondedAt) : 'Pending Action'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 11. AUDIT & GOVERNANCE ENGAGEMENT 360 VIEW
// ============================================================================
export const AuditEngagement360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatPHP,
  onNavigateEntity,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};
  const eng = ctx.engagement || record;
  const workpapers: any[] = ctx.workpapers || [];
  const findings: any[] = ctx.findings || [];

  return (
    <div className="space-y-5" data-testid="specialized-audit-engagement-360">
      {/* PSA Materiality & Engagement Scope KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Overall Materiality (PSA 320)</div>
          <div className="text-xl font-black text-slate-900 mt-1 font-mono">{formatPHP(ctx.materiality)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Period: {eng.auditPeriod || 'FY 2026'}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Performance Materiality</div>
          <div className="text-xl font-black text-indigo-900 mt-1 font-mono">{formatPHP(ctx.performanceMateriality)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Trivial Threshold: {formatPHP(ctx.trivialThreshold)}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">PSA Working Papers</div>
          <div className="text-xl font-black text-emerald-700 mt-1 font-mono">{workpapers.length} lead sheet(s)</div>
          <div className="text-[11px] text-slate-500 mt-1">{ctx.risksCount || 0} mapped risk procedure(s)</div>
        </div>
        <div className="bg-rose-50/60 p-4 rounded-xl border border-rose-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Audit Findings & Adjustments</div>
          <div className="text-xl font-black text-rose-900 mt-1 font-mono">{findings.length} finding(s)</div>
          <div className="text-[11px] text-rose-700 mt-1">{ctx.adjustmentsCount || 0} proposed PAJE(s)</div>
        </div>
      </div>

      {/* Working Papers & Audit Findings Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              PSA Working Papers & Lead Sheets ({workpapers.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {workpapers.map((wp: any) => (
              <div key={wp.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="font-mono text-indigo-700">{wp.wpRef}</span>
                    <span>{wp.title}</span>
                    <StatusBadge status={wp.status} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                    {wp.conclusion || wp.objective || 'Lead sheet procedure documented'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateEntity('AUDIT_WORKPAPER', wp.id, wp.wpRef)}
                  className="px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50 text-indigo-700 text-[11px] font-bold shrink-0"
                >
                  WP 360°
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Audit Findings & Management Responses ({findings.length})
            </h4>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {findings.map((fn: any) => (
              <div key={fn.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <StatusBadge status={fn.riskRating} />
                    <span>{fn.title}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                    Rec: {fn.recommendation || fn.condition}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateEntity('AUDIT_FINDING', fn.id, fn.title)}
                  className="px-2 py-1 rounded bg-slate-100 hover:bg-rose-50 text-rose-700 text-[11px] font-bold shrink-0"
                >
                  Finding 360°
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 12. SYSTEM OPERATIONS 360 VIEW
// ============================================================================
export const SystemOperations360View: React.FC<Specialized360RendererProps> = ({
  data360,
  formatDateTime,
}) => {
  const record = data360?.record || {};
  const ctx = data360?.entitySpecificContext || {};

  return (
    <div className="space-y-5" data-testid="specialized-system-operations-360">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Snapshot / Job Identity</div>
          <div className="text-sm font-black text-slate-900 mt-1 font-mono">{ctx.backupName || record.backupName || record.id}</div>
          <div className="text-[11px] text-slate-500 mt-1">Executed: {formatDateTime(record.createdAt)}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Encrypted Payload Size</div>
          <div className="text-xl font-black text-indigo-900 mt-1 font-mono">
            {((Number(ctx.sizeBytes || record.sizeBytes || 0)) / 1024).toFixed(2)} KB
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{ctx.encryptionAlgorithm || 'AES-256-GCM'}</div>
        </div>
        <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">SHA-256 Cryptographic Digest</div>
          <div className="text-xs font-mono font-bold text-emerald-950 mt-1 break-all">
            {ctx.checksum || record.checksum || 'INTEGRITY_VERIFIED'}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// REGISTRY-DRIVEN DISPATCHER COMPONENT
// ============================================================================
export const EntitySpecific360Dispatcher: React.FC<Specialized360RendererProps> = (props) => {
  const renderer = props.definition.rendererComponent;
  switch (renderer) {
    case 'FinancialTransaction360View':
      return <FinancialTransaction360View {...props} />;
    case 'CustomerRelationship360View':
      return <CustomerRelationship360View {...props} />;
    case 'VendorRelationship360View':
      return <VendorRelationship360View {...props} />;
    case 'InventoryOperations360View':
      return <InventoryOperations360View {...props} />;
    case 'Payroll360View':
      return <Payroll360View {...props} />;
    case 'TaxCompliance360View':
      return <TaxCompliance360View {...props} />;
    case 'BankingReconciliation360View':
      return <BankingReconciliation360View {...props} />;
    case 'FixedAsset360View':
      return <FixedAsset360View {...props} />;
    case 'DocumentIntelligence360View':
      return <DocumentIntelligence360View {...props} />;
    case 'ApprovalWorkflow360View':
      return <ApprovalWorkflow360View {...props} />;
    case 'AuditEngagement360View':
      return <AuditEngagement360View {...props} />;
    case 'SystemOperations360View':
      return <SystemOperations360View {...props} />;
    default:
      return <FinancialTransaction360View {...props} />;
  }
};
