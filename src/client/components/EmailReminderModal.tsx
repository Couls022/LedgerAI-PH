import React, { useState, useEffect } from 'react';
import { 
  Mail, Send, X, Clock, CheckCircle2, AlertCircle, RefreshCw, 
  User, DollarSign, Calendar, FileText, Sparkles
} from 'lucide-react';

interface OverdueInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  contactPerson?: string;
  contactDetails?: string;
  totalAmount: number;
  balanceDue: number;
  dueDate: string;
  invoiceDate: string;
  status: string;
}

interface EmailReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInvoiceId?: string;
  onReminderSent?: () => void;
}

export default function EmailReminderModal({ 
  isOpen, 
  onClose, 
  selectedInvoiceId,
  onReminderSent 
}: EmailReminderModalProps) {
  const [invoices, setInvoices] = useState<OverdueInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [targetInvoiceId, setTargetInvoiceId] = useState<string | null>(selectedInvoiceId || null);
  const [customNote, setCustomNote] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchOverdueInvoices();
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedInvoiceId) {
      setTargetInvoiceId(selectedInvoiceId);
    }
  }, [selectedInvoiceId]);

  const fetchOverdueInvoices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/overdue-invoices');
      if (res.ok) {
        const data = await res.json();
        setInvoices(data);
        if (!targetInvoiceId && data.length > 0) {
          setTargetInvoiceId(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load overdue invoices", err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentInvoice = invoices.find(inv => inv.id === targetInvoiceId) || invoices[0];

  const formatPHP = (centavos: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((centavos || 0) / 100);
  };

  const handleSendReminder = async (sendAll: boolean = false) => {
    setSending(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/notifications/reminders/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: sendAll ? undefined : targetInvoiceId,
          sendAll,
          customMessage: customNote.trim() ? customNote : undefined
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          message: data.message || `Dispatched automated friendly email reminder(s).`
        });
        if (onReminderSent) onReminderSent();
        setTimeout(() => {
          onClose();
          setFeedback(null);
        }, 2200);
      } else {
        setFeedback({
          type: 'error',
          message: data.message || 'Failed to dispatch email reminder.'
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Server connection error during reminder dispatch.'
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                Automated Overdue Invoice Reminders
              </h3>
              <p className="text-xs text-slate-400">
                Trigger friendly email payment collection notices to clients
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

          {feedback && (
            <div className={`p-4 rounded-xl text-sm font-medium flex items-center gap-3 ${
              feedback.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}>
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" /> Fetching overdue receivables...
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-bold text-slate-800 dark:text-slate-200">No Overdue Invoices!</p>
              <p className="text-xs text-slate-500 mt-1">All sales invoices are currently paid or up to date.</p>
            </div>
          ) : (
            <>
              {/* Select Target Overdue Invoice */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
                  Select Target Client Invoice ({invoices.length} Pending)
                </label>
                <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto p-1 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
                  {invoices.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setTargetInvoiceId(inv.id)}
                      className={`p-3 rounded-lg text-left text-xs transition-all flex items-center justify-between border ${
                        (targetInvoiceId === inv.id || (!targetInvoiceId && currentInvoice?.id === inv.id))
                          ? 'bg-indigo-50 dark:bg-indigo-950/80 border-indigo-300 dark:border-indigo-700 font-semibold text-indigo-900 dark:text-indigo-200 shadow-xs'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <User className="w-4 h-4 text-indigo-500 shrink-0" />
                        <div>
                          <p className="font-bold text-slate-800 dark:text-slate-100">{inv.customerName}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{inv.invoiceNumber} • Due: {inv.dueDate}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100 block">
                          {formatPHP(inv.balanceDue)}
                        </span>
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold uppercase">
                          {inv.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Email Live Preview Card */}
              {currentInvoice && (
                <div className="bg-slate-50 dark:bg-slate-900/80 rounded-xl p-4 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <span>Email Template Preview</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-mono">Recipient: {currentInvoice.contactDetails || `${currentInvoice.customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@client-domain.ph`}</span>
                  </div>

                  <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 font-sans text-xs space-y-2 leading-relaxed text-slate-700 dark:text-slate-300 shadow-xs">
                    <p className="font-bold text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2">
                      Subject: Friendly Reminder: Outstanding Payment for Invoice #{currentInvoice.invoiceNumber}
                    </p>
                    <p>Dear {currentInvoice.contactPerson || currentInvoice.customerName},</p>
                    <p>We hope this email finds you well.</p>
                    <p>
                      This is a gentle reminder regarding Invoice <strong className="font-mono">{currentInvoice.invoiceNumber}</strong> issued on {currentInvoice.invoiceDate} for the outstanding balance of <strong className="text-indigo-600 dark:text-indigo-400">{formatPHP(currentInvoice.balanceDue)}</strong>, which was due on {currentInvoice.dueDate}.
                    </p>
                    {customNote.trim() && (
                      <p className="p-2.5 bg-indigo-50/80 dark:bg-indigo-950/40 rounded-lg text-indigo-900 dark:text-indigo-200 border-l-2 border-indigo-500 italic">
                        "{customNote.trim()}"
                      </p>
                    )}
                    <p>If payment has already been initiated, please disregard this notice. Otherwise, kindly send us your payment confirmation at your earliest convenience.</p>
                    <p className="pt-2 text-slate-500">Best regards,<br /><strong className="text-slate-800 dark:text-slate-200">Accounting Team</strong></p>
                  </div>
                </div>
              )}

              {/* Optional Custom Note */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Optional Additional Note (Appended to reminder)
                </label>
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="e.g., Please note our updated BDO bank account details for wire transfers..."
                  className="w-full px-3.5 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => handleSendReminder(true)}
            disabled={sending || invoices.length === 0}
            className="w-full sm:w-auto text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl transition-colors hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Auto-Send All ({invoices.length} Clients)
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 px-4 py-2.5 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSendReminder(false)}
              disabled={sending || !currentInvoice}
              className="flex-1 sm:flex-none text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Dispatching...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Send Reminder Email
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
