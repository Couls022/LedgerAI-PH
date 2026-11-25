import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Mail, Send, X, CheckCircle2, AlertCircle, RefreshCw,
  User, Sparkles, AlertTriangle
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface OverdueInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  contactPerson?: string;
  contactDetails?: string;
  recipientEmail?: string | null;
  totalAmount: number;
  balanceDue: number;
  dueDate: string;
  invoiceDate: string;
  status: string;
  isOverdue?: boolean;
  daysOverdue?: number;
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
  const [includeUpcoming, setIncludeUpcoming] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [customNote, setCustomNote] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchOverdueInvoices();
      apiFetch<any>('/api/settings/smtp')
        .then((cfg) => setSmtpConfigured(Boolean(cfg?.configured)))
        .catch(() => setSmtpConfigured(null));
    }
  }, [isOpen, includeUpcoming]);

  useEffect(() => {
    if (selectedInvoiceId) {
      setTargetInvoiceId(selectedInvoiceId);
    }
  }, [selectedInvoiceId]);

  const fetchOverdueInvoices = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<OverdueInvoice[]>(
        `/api/notifications/overdue-invoices${includeUpcoming ? '?includeUpcoming=1' : ''}`
      );
      if (Array.isArray(data)) {
        setInvoices(data);
        if (data.length > 0 && (!targetInvoiceId || !data.some((d) => d.id === targetInvoiceId))) {
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

  const extractRecipientEmail = (inv?: OverdueInvoice): string | null => {
    if (!inv) return null;
    if (inv.recipientEmail) return inv.recipientEmail;
    const raw = String(inv.contactDetails || '');
    const m = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : null;
  };
  const currentRecipientEmail = extractRecipientEmail(currentInvoice);

  const formatPHP = (centavos: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((centavos || 0) / 100);
  };

  const handleSendReminder = async (sendAll: boolean = false) => {
    setSending(true);
    setFeedback(null);

    try {
      const data = await apiFetch<any>('/api/notifications/reminders/send', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: sendAll ? undefined : targetInvoiceId,
          sendAll,
          includeUpcoming,
          customMessage: customNote.trim() ? customNote : undefined
        })
      });

      if (data?.sentCount > 0 && !data?.failedCount) {
        setFeedback({
          type: 'success',
          message: data.message || `Sent ${data.sentCount} email reminder(s).`
        });
        if (onReminderSent) onReminderSent();
        setTimeout(() => {
          onClose();
          setFeedback(null);
        }, 2200);
      } else if (data?.smtpConfigured === false) {
        setFeedback({
          type: 'warning',
          message: data.message || 'SMTP is not configured. Go to Settings → Email Notifications to configure your mail server.'
        });
      } else {
        setFeedback({
          type: data?.failedCount ? 'error' : 'warning',
          message: data?.message || 'No email reminders were delivered.'
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

  if (!isOpen) return null;

  return typeof document !== 'undefined' ? createPortal(
    <div 
      className="fixed inset-0 z-[99999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl max-w-2xl w-full my-auto border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30 shrink-0">
              <Mail className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base flex items-center gap-2 truncate">
                Automated Overdue Invoice Reminders
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Trigger friendly email payment collection notices to clients
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

          {smtpConfigured === false && (
            <div className="p-3.5 rounded-xl text-xs font-medium flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                SMTP server is not configured for this company yet. Configure outgoing mail under <strong>Settings → Email Notifications</strong> to send live emails; reminders without SMTP will only be logged in-app.
              </span>
            </div>
          )}

          {feedback && (
            <div className={`p-4 rounded-xl text-sm font-medium flex items-center gap-3 ${
              feedback.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : feedback.type === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}>
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : feedback.type === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
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
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Select Target Client Invoice ({invoices.length} {includeUpcoming ? 'Open' : 'Overdue'})
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeUpcoming}
                      onChange={(e) => setIncludeUpcoming(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    Include upcoming open invoices
                  </label>
                </div>
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
                  <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <span>Email Template Preview</span>
                    {currentRecipientEmail ? (
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono truncate">
                        Recipient: {currentRecipientEmail}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        No email address in customer contact details
                      </span>
                    )}
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
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => handleSendReminder(true)}
            disabled={sending || invoices.length === 0}
            className="w-full sm:w-auto text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-colors hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" /> 
            <span>Auto-Send All ({invoices.length} Clients)</span>
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSendReminder(false)}
              disabled={sending || !currentInvoice}
              className="flex-1 sm:flex-none text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl shadow-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {sending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> 
                  <span>Dispatching...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 shrink-0" /> 
                  <span>Send Reminder Email</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  ) : null;
}
