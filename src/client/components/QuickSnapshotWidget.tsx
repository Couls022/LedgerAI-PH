import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Clock, FileText, ArrowUpRight, Calculator, ShieldAlert, 
  ChevronRight, Building2, Calendar, AlertCircle, CheckCircle2, DollarSign, Mail
} from 'lucide-react';

interface PendingInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  balanceDue: number;
  dueDate: string;
  status: string;
  invoiceDate: string;
}

interface TaxEstimate {
  currentMonth: string;
  outputVat: number;
  inputVat: number;
  ewtWithheld: number;
  netVatPayable: number;
  estimatedTaxLiability: number;
  dueDateNotice: string;
}

interface QuickSnapshotWidgetProps {
  pendingInvoices?: PendingInvoice[];
  taxEstimate?: TaxEstimate;
  formatCurrency: (val: number) => string;
  onSendReminder?: (invoiceId?: string) => void;
}

export default function QuickSnapshotWidget({ 
  pendingInvoices = [], 
  taxEstimate, 
  formatCurrency,
  onSendReminder
}: QuickSnapshotWidgetProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Pending Invoices Widget (Spans 2 columns on lg) */}
      <div className="lg:col-span-2 bg-white dark:bg-[#111827] rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/40">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  Top Pending Customer Invoices
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Most recent receivables awaiting payment collection
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onSendReminder && pendingInvoices.length > 0 && (
                <button
                  onClick={() => onSendReminder()}
                  className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800/80 flex items-center gap-1.5 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" /> Send Reminders
                </button>
              )}
              <button
                onClick={() => navigate('/accounting')}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                Manage Ledger <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Pending Invoices List */}
          {pendingInvoices.length > 0 ? (
            <div className="space-y-2.5">
              {pendingInvoices.map((inv) => (
                <div 
                  key={inv.id}
                  className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#141d2e] border border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div 
                    onClick={() => navigate('/accounting')}
                    className="flex items-center gap-3 cursor-pointer flex-1"
                  >
                    <div className="p-2 bg-white dark:bg-[#111827] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                      <Building2 className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {inv.invoiceNumber}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                          inv.status === 'POSTED' 
                            ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}>
                          {inv.status}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5">
                        {inv.customerName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-slate-200 dark:border-slate-800 pt-2 sm:pt-0">
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] text-slate-400 flex items-center sm:justify-end gap-1">
                        <Calendar className="w-3 h-3" /> Due {inv.dueDate}
                      </p>
                      <p className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                        {formatCurrency(inv.balanceDue)}
                      </p>
                    </div>

                    {onSendReminder && (
                      <button
                        onClick={() => onSendReminder(inv.id)}
                        className="p-1.5 rounded-xl text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800/80 transition-colors shrink-0"
                        title={`Send friendly email reminder for ${inv.invoiceNumber}`}
                      >
                        <Mail className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">No pending customer invoices found.</p>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <span>Real-time receivables balance due</span>
          <span className="font-semibold text-slate-600 dark:text-slate-300">Updated automatically</span>
        </div>
      </div>

      {/* Tax Liability Estimate Widget */}
      <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40">
                <Calculator className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Estimated Tax Liability
                </h3>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {taxEstimate?.currentMonth || 'Current Month'} BIR Estimate
                </p>
              </div>
            </div>

            <button
              onClick={() => navigate('/tax')}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              Tax Schedule <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Big Number Highlight */}
          <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 mb-4 text-center sm:text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Estimated Net Tax Payable
            </span>
            <p className="text-2xl font-bold font-mono text-emerald-800 dark:text-emerald-200 mt-1">
              {formatCurrency(taxEstimate?.estimatedTaxLiability || 0)}
            </p>
            <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 inline shrink-0" />
              {taxEstimate?.dueDateNotice || 'BIR Form 2550M Monthly VAT'}
            </p>
          </div>

          {/* Tax Breakdown */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>Output VAT (12% Sales)</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(taxEstimate?.outputVat || 0)}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span>Input VAT Credit (-12%)</span>
              <span className="font-mono text-rose-500">-{formatCurrency(taxEstimate?.inputVat || 0)}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span>EWT Creditable (-2%)</span>
              <span className="font-mono text-rose-500">-{formatCurrency(taxEstimate?.ewtWithheld || 0)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" /> Auto-calculated from ledger
          </span>
          <button
            onClick={() => navigate('/tax')}
            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            Review 2550M
          </button>
        </div>
      </div>
    </div>
  );
}
