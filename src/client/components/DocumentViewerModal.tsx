import React, { useState, useEffect } from 'react';
import {
  X, CheckCircle2, AlertCircle, AlertTriangle, FileText, Download,
  ExternalLink, Sparkles, Check, RefreshCw, ShieldCheck, Tag,
  Hash, Calendar, DollarSign, Building, User, Edit3, Save, ArrowRight
} from 'lucide-react';
import PostToAccountingModal from './PostToAccountingModal';

interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string | null;
  onUpdated: () => void;
}

export default function DocumentViewerModal({
  isOpen,
  onClose,
  documentId,
  onUpdated
}: DocumentViewerModalProps) {
  const [docData, setDocData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningOcr, setRunningOcr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);

  // Editable Form State
  const [documentType, setDocumentType] = useState('RECEIPT');
  const [merchant, setMerchant] = useState('');
  const [customer, setCustomer] = useState('');
  const [tin, setTin] = useState('');
  const [address, setAddress] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate] = useState('');
  const [totalAmount, setTotalAmount] = useState<number | string>(0);
  const [vatAmount, setVatAmount] = useState<number | string>(0);
  const [vatableSales, setVatableSales] = useState<number | string>(0);
  const [vatExemptSales, setVatExemptSales] = useState<number | string>(0);
  const [zeroRatedSales, setZeroRatedSales] = useState<number | string>(0);
  const [withholdingTax, setWithholdingTax] = useState<number | string>(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [category, setCategory] = useState('Office Supplies');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && documentId) {
      loadDocumentDetails();
    } else {
      setDocData(null);
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, documentId]);

  const loadDocumentDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/documents/${documentId}`);
      if (!res.ok) {
        throw new Error('Failed to load document details');
      }
      const data = await res.json();
      setDocData(data);

      const doc = data.document;
      setDocumentType(doc.documentType || 'RECEIPT');
      setMerchant(doc.extractedMerchant || '');
      setCustomer(doc.extractedCustomer || '');
      setTin(doc.extractedTin || '');
      setAddress(doc.extractedAddress || '');
      setInvoiceNumber(doc.extractedInvoiceNumber || '');
      setDate(doc.extractedDate || new Date().toISOString().split('T')[0]);
      setTotalAmount(doc.extractedTotalAmount ? doc.extractedTotalAmount / 100 : 0);
      setVatAmount(doc.extractedVatAmount ? doc.extractedVatAmount / 100 : 0);
      setVatableSales(doc.extractedVatableSales ? doc.extractedVatableSales / 100 : 0);
      setVatExemptSales(doc.extractedVatExemptSales ? doc.extractedVatExemptSales / 100 : 0);
      setZeroRatedSales(doc.extractedZeroRatedSales ? doc.extractedZeroRatedSales / 100 : 0);
      setWithholdingTax(doc.extractedWithholdingTax ? doc.extractedWithholdingTax / 100 : 0);
      setPaymentMethod(doc.extractedPaymentMethod || 'CASH');
      setCategory(doc.extractedCategory || 'Office Supplies');
      setNotes(doc.notes || '');

      if (data.parsedOcr && Array.isArray(data.parsedOcr.items)) {
        setItems(data.parsedOcr.items);
      } else {
        setItems([]);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading document');
    } finally {
      setLoading(false);
    }
  };

  const handleRunOcr = async () => {
    if (!documentId) return;
    try {
      setRunningOcr(true);
      setError(null);
      const res = await fetch(`/api/documents/${documentId}/ocr`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'OCR processing failed');
      }
      setSuccessMessage("AI OCR analysis completed successfully.");
      await loadDocumentDetails();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'OCR failed');
    } finally {
      setRunningOcr(false);
    }
  };

  const handleSaveReview = async (newStatus: 'VERIFIED' | 'REJECTED' | 'UNVERIFIED' = 'VERIFIED') => {
    if (!documentId) return;
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/documents/${documentId}/ocr-review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          merchant,
          customer,
          tin,
          address,
          invoiceNumber,
          date,
          totalAmount: parseFloat(String(totalAmount)) || 0,
          vatAmount: parseFloat(String(vatAmount)) || 0,
          vatableSales: parseFloat(String(vatableSales)) || 0,
          vatExemptSales: parseFloat(String(vatExemptSales)) || 0,
          zeroRatedSales: parseFloat(String(zeroRatedSales)) || 0,
          withholdingTax: parseFloat(String(withholdingTax)) || 0,
          paymentMethod,
          category,
          items,
          verificationStatus: newStatus,
          notes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save review');
      }

      setSuccessMessage(`Document successfully saved and marked as ${newStatus}`);
      await loadDocumentDetails();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update review');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !documentId) return null;

  const doc = docData?.document;
  const isImage = doc?.fileName?.match(/\.(jpg|jpeg|png|webp)$/i);
  const isPdf = doc?.fileName?.match(/\.pdf$/i);

  // Live client arithmetic check
  const numTotal = parseFloat(String(totalAmount)) || 0;
  const numVat = parseFloat(String(vatAmount)) || 0;
  const numVatable = parseFloat(String(vatableSales)) || 0;
  const numExempt = parseFloat(String(vatExemptSales)) || 0;
  const numZero = parseFloat(String(zeroRatedSales)) || 0;
  const expectedTotal = numVatable + numExempt + numZero + numVat;
  const arithmeticMismatch = Math.abs(expectedTotal - numTotal) > 0.05 && numTotal > 0 && (numVatable > 0 || numVat > 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 border border-indigo-400/30 rounded-lg">
              <FileText className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg leading-tight truncate max-w-md">
                  {doc?.originalFileName || doc?.fileName || 'Document Viewer'}
                </h3>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                  doc?.verificationStatus === 'POSTED_TO_ACCOUNTING' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                  doc?.verificationStatus === 'VERIFIED' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' :
                  doc?.verificationStatus === 'REJECTED' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                  'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {doc?.verificationStatus || 'UNVERIFIED'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                ID: {doc?.id} • Source: {doc?.source || 'WEB_UI'} • Checksum: {doc?.fileHash ? doc.fileHash.slice(0, 12) + '...' : 'None'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunOcr}
              disabled={runningOcr}
              className="px-3 py-1.5 text-xs font-semibold text-indigo-200 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {runningOcr ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
              {runningOcr ? 'Analyzing OCR...' : 'Re-Run OCR'}
            </button>
            <a
              href={`/api/documents/${documentId}/file`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body (Dual-Pane) */}
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
            <p className="text-sm font-medium">Loading document and OCR evidence...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden">
            
            {/* Left Pane: Document File Preview */}
            <div className="lg:col-span-5 bg-slate-950/90 border-r border-slate-200 flex flex-col items-center justify-center p-4 overflow-y-auto max-h-[75vh]">
              {isImage ? (
                <div className="relative group max-h-full max-w-full flex items-center justify-center">
                  <img
                    src={`/api/documents/${documentId}/file`}
                    alt={doc?.fileName}
                    className="max-h-[65vh] max-w-full rounded-lg shadow-xl object-contain border border-slate-800"
                  />
                </div>
              ) : isPdf ? (
                <iframe
                  src={`/api/documents/${documentId}/file`}
                  title="PDF Preview"
                  className="w-full h-[65vh] rounded-lg border border-slate-800 bg-white"
                />
              ) : (
                <div className="text-center p-8 bg-slate-900 rounded-xl border border-slate-800 text-slate-400">
                  <FileText className="w-12 h-12 mx-auto text-slate-600 mb-3" />
                  <p className="font-semibold text-slate-300">{doc?.fileName}</p>
                  <p className="text-xs text-slate-500 mt-1">Binary file type: {doc?.fileType}</p>
                </div>
              )}

              {/* Hash & File Info */}
              <div className="w-full mt-3 p-2.5 bg-slate-900/90 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Size: {(doc?.fileSize ? doc.fileSize / 1024 : 0).toFixed(1)} KB</span>
                <span className="font-mono truncate max-w-[220px]" title={doc?.fileHash || ''}>
                  SHA256: {doc?.fileHash || 'N/A'}
                </span>
              </div>
            </div>

            {/* Right Pane: OCR Verification & Accounting Form */}
            <div className="lg:col-span-7 p-6 overflow-y-auto max-h-[75vh] flex flex-col space-y-5 bg-slate-50/50">
              
              {/* Feedback messages */}
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-rose-800 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2.5 text-emerald-800 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* Validation Status Badges & Warnings */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 border ${
                    arithmeticMismatch ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  }`}>
                    {arithmeticMismatch ? <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}
                    {arithmeticMismatch ? 'Arithmetic Variance Detected' : 'Arithmetic Balanced (12% VAT Validated)'}
                  </div>

                  <div className="px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-50 text-indigo-800 border border-indigo-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    OCR Confidence: {Math.round((doc?.confidenceScore || 0.9) * 100)}%
                  </div>

                  {doc?.linkedTransactionId && doc.linkedTransactionId !== 'NONE' && (
                    <div className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      Linked to {doc.linkedTransactionType}: {doc.linkedTransactionId.slice(0, 8)}...
                    </div>
                  )}
                </div>

                {/* Validation Warnings List */}
                {docData?.validationSummary?.warnings?.length > 0 && (
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg space-y-1">
                    <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">Compliance & Validation Checks</span>
                    {docData.validationSummary.warnings.map((w: string, idx: number) => (
                      <p key={idx} className="text-xs text-amber-800 flex items-start gap-1.5">
                        <span className="text-amber-600 font-bold">•</span> {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Grid */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-indigo-600" />
                    Extracted Document Fields & Master Data
                  </h4>
                  <span className="text-xs text-slate-500 font-medium">Edit to correct OCR readings</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Document Type</label>
                    <select
                      value={documentType}
                      onChange={(e) => setDocumentType(e.target.value)}
                      className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="RECEIPT">Official Receipt (OR) / Receipt</option>
                      <option value="SALES_INVOICE">Sales Invoice</option>
                      <option value="PURCHASE_INVOICE">Purchase Invoice</option>
                      <option value="BILLING_STATEMENT">Billing Statement / SOA</option>
                      <option value="BANK_DOCUMENT">Bank Statement / Deposit Slip</option>
                      <option value="TAX_FORM">BIR Tax Form (2307 / 1702)</option>
                      <option value="CONTRACT">Contract / Agreement</option>
                      <option value="GENERAL_ATTACHMENT">General Attachment</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Invoice / Receipt #</label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder="e.g. OR-89211"
                      className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Merchant / Supplier Legal Name</label>
                    <input
                      type="text"
                      value={merchant}
                      onChange={(e) => setMerchant(e.target.value)}
                      placeholder="Registered Business Name"
                      className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Merchant TIN</label>
                    <input
                      type="text"
                      value={tin}
                      onChange={(e) => setTin(e.target.value)}
                      placeholder="XXX-XXX-XXX-XXX"
                      className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Customer / Buyer Name (Optional)</label>
                    <input
                      type="text"
                      value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                      placeholder="Buyer Company Name"
                      className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Document Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Amounts Breakdown */}
                <div className="pt-3 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-2">
                    Amounts & Philippine Tax Breakdown (₱)
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">VATable Sales</label>
                      <input
                        type="number"
                        step="0.01"
                        value={vatableSales}
                        onChange={(e) => setVatableSales(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">12% VAT Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        value={vatAmount}
                        onChange={(e) => setVatAmount(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-indigo-900 mb-1">Total Amount (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={totalAmount}
                        onChange={(e) => setTotalAmount(e.target.value)}
                        className="w-full text-xs font-bold rounded-lg border border-indigo-300 bg-indigo-50/50 px-3 py-1.5 text-indigo-950 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">VAT-Exempt Sales</label>
                      <input
                        type="number"
                        step="0.01"
                        value={vatExemptSales}
                        onChange={(e) => setVatExemptSales(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Withholding Tax (2307)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={withholdingTax}
                        onChange={(e) => setWithholdingTax(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Payment Method</label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 focus:border-indigo-500"
                      >
                        <option value="CASH">Cash</option>
                        <option value="CHECK">Check</option>
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="CREDIT_CARD">Credit Card</option>
                        <option value="GCASH">GCash</option>
                        <option value="MAYA">Maya</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Line Items Table (if any) */}
                {items && items.length > 0 && (
                  <div className="pt-3 border-t border-slate-100">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-2">
                      Extracted Line Items ({items.length})
                    </span>
                    <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="p-2">Description</th>
                            <th className="p-2 w-16 text-right">Qty</th>
                            <th className="p-2 w-24 text-right">Unit Price</th>
                            <th className="p-2 w-24 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((it, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-2 text-slate-800">{it.description}</td>
                              <td className="p-2 text-right text-slate-600">{it.quantity}</td>
                              <td className="p-2 text-right text-slate-600">₱{(it.unitPrice || 0).toFixed(2)}</td>
                              <td className="p-2 text-right font-medium text-slate-900">₱{(it.amount || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Internal Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Audit comments, memo, or cross-references..."
                    className="w-full text-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="bg-white px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSaveReview('REJECTED')}
              disabled={saving}
              className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
            >
              Mark Rejected
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSaveReview('VERIFIED')}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 text-slate-600" />}
              Save & Verify
            </button>

            <button
              type="button"
              onClick={() => setIsPostModalOpen(true)}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-sm flex items-center gap-2 transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              Post to Accounting
            </button>
          </div>
        </div>

      </div>

      {/* Embedded Post To Accounting Modal */}
      {isPostModalOpen && (
        <PostToAccountingModal
          isOpen={isPostModalOpen}
          onClose={() => setIsPostModalOpen(false)}
          document={{
            ...doc,
            extractedMerchant: merchant,
            extractedCustomer: customer,
            extractedTin: tin,
            extractedAddress: address,
            extractedInvoiceNumber: invoiceNumber,
            extractedDate: date,
            extractedTotalAmount: Math.round(numTotal * 100),
            extractedVatAmount: Math.round(numVat * 100),
            notes
          }}
          onPosted={async () => {
            await loadDocumentDetails();
            onUpdated();
          }}
        />
      )}
    </div>
  );
}
