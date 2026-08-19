import React, { useState, useEffect } from 'react';
import { 
  X, CheckCircle2, AlertCircle, FileText, ArrowRight, 
  Building2, CreditCard, DollarSign, RefreshCw, Send, Check 
} from 'lucide-react';

interface PostToAccountingModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: any;
  onPosted: () => void;
}

export default function PostToAccountingModal({
  isOpen,
  onClose,
  document,
  onPosted
}: PostToAccountingModalProps) {
  const [transactionType, setTransactionType] = useState<'PURCHASE_BILL' | 'SALES_INVOICE' | 'EXPENSE' | 'JOURNAL_ENTRY'>('PURCHASE_BILL');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedExpenseAccountId, setSelectedExpenseAccountId] = useState<string>('');
  const [selectedRevenueAccountId, setSelectedRevenueAccountId] = useState<string>('');
  const [selectedCashAccountId, setSelectedCashAccountId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (isOpen && document) {
      // Auto-select transaction type based on document type
      if (document.documentType === 'SALES_INVOICE') {
        setTransactionType('SALES_INVOICE');
      } else if (document.documentType === 'RECEIPT' && document.extractedPaymentMethod === 'CASH') {
        setTransactionType('EXPENSE');
      } else {
        setTransactionType('PURCHASE_BILL');
      }

      setNotes(document.notes || `Created from OCR Document ${document.fileName}`);
      loadMasterData();
    }
  }, [isOpen, document]);

  const loadMasterData = async () => {
    try {
      setLoading(true);
      const [accRes, vendRes, custRes] = await Promise.all([
        fetch('/api/accounting/accounts'),
        fetch('/api/master-data/vendors'),
        fetch('/api/master-data/customers')
      ]);

      if (accRes.ok) {
        const accs = await accRes.json();
        setAccounts(accs);
        
        // Auto-select sensible default accounts
        const defaultExp = accs.find((a: any) => a.accountType === 'EXPENSE');
        if (defaultExp) setSelectedExpenseAccountId(defaultExp.id);

        const defaultRev = accs.find((a: any) => a.accountType === 'REVENUE');
        if (defaultRev) setSelectedRevenueAccountId(defaultRev.id);

        const defaultCash = accs.find((a: any) => a.isCashAccount || a.accountCode === '1100' || a.accountCode === '1010');
        if (defaultCash) setSelectedCashAccountId(defaultCash.id);
      }

      if (vendRes.ok) {
        const vends = await vendRes.json();
        setVendors(vends);
        if (document.linkedVendorId) {
          setSelectedVendorId(document.linkedVendorId);
        } else if (document.extractedMerchant) {
          const match = vends.find((v: any) => 
            v.legalName.toLowerCase().includes(document.extractedMerchant.toLowerCase()) ||
            (document.extractedTin && v.tin === document.extractedTin)
          );
          if (match) setSelectedVendorId(match.id);
        }
      }

      if (custRes.ok) {
        const custs = await custRes.json();
        setCustomers(custs);
        if (document.linkedCustomerId) {
          setSelectedCustomerId(document.linkedCustomerId);
        } else if (document.extractedCustomer) {
          const match = custs.find((c: any) => 
            c.legalName.toLowerCase().includes(document.extractedCustomer.toLowerCase()) ||
            (document.extractedTin && c.tin === document.extractedTin)
          );
          if (match) setSelectedCustomerId(match.id);
        }
      }
    } catch (err: any) {
      console.error("Failed to load master data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!document) return;

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch(`/api/documents/${document.id}/post-accounting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTransactionType: transactionType,
          vendorId: selectedVendorId || undefined,
          customerId: selectedCustomerId || undefined,
          expenseAccountId: selectedExpenseAccountId || undefined,
          revenueAccountId: selectedRevenueAccountId || undefined,
          cashAccountId: selectedCashAccountId || undefined,
          notes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to post document to accounting');
      }

      onPosted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during posting.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !document) return null;

  const totalAmountPhp = (document.extractedTotalAmount ? document.extractedTotalAmount / 100 : 0);
  const vatAmountPhp = (document.extractedVatAmount ? document.extractedVatAmount / 100 : 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 border border-indigo-400/30 rounded-lg">
              <FileText className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Post to Accounting Records</h3>
              <p className="text-xs text-indigo-200 mt-0.5">
                Convert verified source document into an official Philippine accounting transaction
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handlePost} className="p-6 space-y-5">
          
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-3 text-rose-800 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* Document Summary Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Merchant / Source</span>
              <span className="font-bold text-slate-900 truncate block mt-0.5">{document.extractedMerchant || 'General Supplier'}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Invoice / OR #</span>
              <span className="font-medium text-slate-800 block mt-0.5">{document.extractedInvoiceNumber || 'Auto-generated'}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Doc Date</span>
              <span className="font-medium text-slate-800 block mt-0.5">{document.extractedDate || 'Today'}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Amount</span>
              <span className="font-bold text-indigo-900 text-base block mt-0.5">
                ₱{totalAmountPhp.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Transaction Type Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Select Accounting Transaction Type
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { type: 'PURCHASE_BILL', label: 'Purchase Bill', desc: 'Accounts Payable (AP)' },
                { type: 'EXPENSE', label: 'Cash Expense', desc: 'Disbursement from Bank' },
                { type: 'SALES_INVOICE', label: 'Sales Invoice', desc: 'Accounts Receivable (AR)' },
                { type: 'JOURNAL_ENTRY', label: 'Journal Entry', desc: 'Direct Double-Entry' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.type}
                  onClick={() => setTransactionType(item.type as any)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    transactionType === item.type
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 ring-1 ring-indigo-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="block font-bold text-xs">{item.label}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Conditional Field Mappings */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            {transactionType === 'PURCHASE_BILL' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Vendor (Supplier)
                  </label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Auto-create / Select Vendor --</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.legalName} ({v.tin || 'No TIN'})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Expense / Purchases Account
                  </label>
                  <select
                    value={selectedExpenseAccountId}
                    onChange={(e) => setSelectedExpenseAccountId(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {accounts.filter((a) => a.accountType === 'EXPENSE' || a.accountType === 'COST_OF_SALES').map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {transactionType === 'SALES_INVOICE' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Customer (Buyer)
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Auto-create / Select Customer --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legalName} ({c.tin || 'No TIN'})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Revenue / Sales Account
                  </label>
                  <select
                    value={selectedRevenueAccountId}
                    onChange={(e) => setSelectedRevenueAccountId(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {accounts.filter((a) => a.accountType === 'REVENUE' || a.accountType === 'OTHER_INCOME').map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {(transactionType === 'EXPENSE' || transactionType === 'JOURNAL_ENTRY') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Expense Account (Debit)
                  </label>
                  <select
                    value={selectedExpenseAccountId}
                    onChange={(e) => setSelectedExpenseAccountId(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {accounts.filter((a) => a.accountType === 'EXPENSE' || a.accountType === 'COST_OF_SALES').map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Settlement Cash / Bank Account (Credit)
                  </label>
                  <select
                    value={selectedCashAccountId}
                    onChange={(e) => setSelectedCashAccountId(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {accounts.filter((a) => a.isCashAccount || a.accountType === 'ASSET').map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Transaction Notes & Reference
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal memo / reference"
                className="w-full text-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Posting...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Confirm & Post to Accounting
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
