import React, { useState, useEffect } from 'react';
import { 
  UploadCloud, File, Search, Trash2, Eye, FileText, CheckCircle2, 
  AlertCircle, RefreshCw, Filter, Sparkles, Save, RotateCcw, Clock,
  Check, Info, X, Camera, ArrowRight, Download, ShieldCheck, Tag,
  AlertTriangle, DollarSign, ExternalLink, Printer, HardDrive, Cpu
} from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { useAutoSaveForm } from '../hooks/useAutoSaveForm';
import { useAuth } from '../context/AuthContext';
import ReceiptScannerModal from '../components/ReceiptScannerModal';
import RecordActivityModal from '../components/RecordActivityModal';
import DocumentViewerModal from '../components/DocumentViewerModal';
import PostToAccountingModal from '../components/PostToAccountingModal';
import HardwareDeviceManager from '../components/HardwareDeviceManager';
import { PaginationControls } from '../components/PaginationControls';

interface DocumentItem {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  documentType: string;
  fileName: string;
  originalFileName?: string;
  fileType: string;
  fileSize: number;
  fileHash?: string;
  filePath: string;
  source: string;
  linkedTransactionType?: string;
  linkedTransactionId?: string;
  linkedVendorId?: string;
  linkedCustomerId?: string;
  status: string;
  ocrStatus?: string;
  verificationStatus: string;
  confidenceScore?: number;
  extractedMerchant?: string;
  extractedCustomer?: string;
  extractedTin?: string;
  extractedAddress?: string;
  extractedInvoiceNumber?: string;
  extractedDate?: string;
  extractedTotalAmount?: number;
  extractedVatAmount?: number;
  extractedVatableSales?: number;
  extractedPaymentMethod?: string;
  extractedCategory?: string;
  validationErrors?: string;
  validationWarnings?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  uploadedBy: string;
  uploaderName?: string;
  uploaderEmail?: string;
}

interface DocumentDraft {
  fileName: string;
  documentType: string;
  entityType: string;
  referenceNumber: string;
  partyName: string;
  notes: string;
}

const INITIAL_DRAFT: DocumentDraft = {
  fileName: '',
  documentType: 'RECEIPT',
  entityType: 'PURCHASE_BILL',
  referenceNumber: '',
  partyName: '',
  notes: '',
};

export default function Documents() {
  const { activeCompany } = useAuth();
  const { isConnected } = useNotifications();

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [showHardwareHub, setShowHardwareHub] = useState(false);
  
  // Modals for viewer and posting
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [postingDoc, setPostingDoc] = useState<DocumentItem | null>(null);
  const [selectedDocForHistory, setSelectedDocForHistory] = useState<DocumentItem | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING' | 'VERIFIED' | 'POSTED' | 'ARCHIVED'>('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [showDraftRestoredBanner, setShowDraftRestoredBanner] = useState(false);

  // Pagination State
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);

  // Auto-save form draft hook
  const storageKey = `doc_creation_draft_${activeCompany?.id || 'default'}`;
  const {
    formData,
    updateField,
    isDirty,
    isSaving,
    hasDraft,
    lastSavedAt,
    restoreDraft,
    clearDraft,
    resetForm,
  } = useAutoSaveForm<DocumentDraft>(storageKey, INITIAL_DRAFT);

  const fetchDocuments = async (cursor?: string | null) => {
    try {
      setLoading(true);
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (activeCurr) params.set('cursor', activeCurr);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/documents?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setDocuments(data);
          setPaginationMeta(null);
        } else {
          setDocuments(data.data || []);
          setPaginationMeta(data.pagination || null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    fetchDocuments(null);
  }, [activeCompany?.id, searchQuery]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      fetchDocuments(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevCursor = cursorStack[cursorStack.length - 1];
      setCursorStack(prev => prev.slice(0, -1));
      setCurrentCursor(prevCursor || null);
      fetchDocuments(prevCursor || null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!formData.fileName) {
        updateField('fileName', file.name);
      }

      // Convert to base64 for OCR upload
      const reader = new FileReader();
      reader.onloadend = () => {
        setFileBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fileName && !selectedFile) return;

    const nameToUse = formData.fileName || selectedFile?.name || 'Evidence_Document.pdf';

    try {
      setUploading(true);
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: nameToUse,
          fileType: selectedFile?.type || 'application/pdf',
          documentType: formData.documentType || 'RECEIPT',
          entityType: formData.entityType,
          entityId: formData.referenceNumber || `REF-${Math.floor(100000 + Math.random() * 900000)}`,
          fileSize: selectedFile?.size || 1024 * 250,
          fileContentBase64: fileBase64,
          autoOcr: true,
          notes: formData.notes,
        }),
      });

      if (res.ok) {
        setShowUploadModal(false);
        resetForm(); // Clears auto-saved draft upon successful creation
        setSelectedFile(null);
        setFileBase64(null);
        await fetchDocuments();
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action will generate a real-time audit alert.`)) return;

    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchDocuments();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleRestoreDraftClick = () => {
    const restored = restoreDraft();
    if (restored) {
      setShowDraftRestoredBanner(true);
      setShowUploadModal(true);
      setTimeout(() => setShowDraftRestoredBanner(false), 4000);
    }
  };

  const handleDiscardDraft = () => {
    resetForm();
    setSelectedFile(null);
    setFileBase64(null);
  };

  // Stats Counters
  const totalCount = documents.length;
  const pendingCount = documents.filter(d => d.verificationStatus === 'UNVERIFIED' || d.ocrStatus === 'PENDING' || d.ocrStatus === 'PROCESSING').length;
  const verifiedCount = documents.filter(d => d.verificationStatus === 'VERIFIED').length;
  const postedCount = documents.filter(d => d.verificationStatus === 'POSTED_TO_ACCOUNTING').length;

  // Multi-Criteria Filtering
  const filteredDocuments = documents.filter(doc => {
    // 1. Tab filter
    if (activeTab === 'PENDING' && (doc.verificationStatus !== 'UNVERIFIED' && doc.ocrStatus !== 'PENDING')) return false;
    if (activeTab === 'VERIFIED' && doc.verificationStatus !== 'VERIFIED') return false;
    if (activeTab === 'POSTED' && doc.verificationStatus !== 'POSTED_TO_ACCOUNTING') return false;
    if (activeTab === 'ARCHIVED' && doc.status !== 'DELETED') return false;

    // 2. Type filter
    if (filterType !== 'ALL' && doc.documentType !== filterType && doc.entityType !== filterType) {
      return false;
    }

    // 3. Search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const matchName = doc.fileName?.toLowerCase().includes(q) || false;
      const matchMerchant = doc.extractedMerchant?.toLowerCase().includes(q) || false;
      const matchCustomer = doc.extractedCustomer?.toLowerCase().includes(q) || false;
      const matchInvoice = doc.extractedInvoiceNumber?.toLowerCase().includes(q) || false;
      const matchTin = doc.extractedTin?.toLowerCase().includes(q) || false;
      const matchNotes = doc.notes?.toLowerCase().includes(q) || false;
      if (!matchName && !matchMerchant && !matchCustomer && !matchInvoice && !matchTin && !matchNotes) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Document Management & OCR</h1>
            {isConnected && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Real-Time OCR Active
              </span>
            )}
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Philippine BIR-compliant source document capture, AI optical character recognition, arithmetic validation, and 1-click accounting posting.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowScannerModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 shadow-sm shrink-0"
          >
            <Printer className="w-4 h-4 text-amber-300" />
            <span>Direct Hardware &amp; Camera Scan</span>
          </button>

          <button
            onClick={() => setShowHardwareHub(!showHardwareHub)}
            className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 border shrink-0 ${
              showHardwareHub
                ? 'bg-slate-900 text-white border-slate-800'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4 text-indigo-500" />
            <span>Hardware Devices</span>
          </button>

          {hasDraft && !showUploadModal && (
            <button
              onClick={handleRestoreDraftClick}
              className="bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-3.5 py-2.5 rounded-xl text-xs font-semibold hover:bg-amber-100 transition-colors flex items-center gap-2"
              title="Resume unsaved document draft"
            >
              <RotateCcw className="w-4 h-4 text-amber-600" />
              Resume Draft
            </button>
          )}

          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-slate-900 dark:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-xs shrink-0"
          >
            <UploadCloud className="w-4 h-4" /> Upload Document
          </button>
        </div>
      </div>

      {showHardwareHub && <HardwareDeviceManager />}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Documents</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">{totalCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Stored in encrypted tenant volume</p>
          </div>
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <FileText className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Pending Review / OCR</p>
            <p className="text-2xl font-bold text-amber-900 dark:text-amber-200 mt-1">{pendingCount}</p>
            <p className="text-[11px] text-amber-600/80 mt-0.5">Awaiting verification</p>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Verified Ready</p>
            <p className="text-2xl font-bold text-indigo-950 dark:text-indigo-200 mt-1">{verifiedCount}</p>
            <p className="text-[11px] text-indigo-600/80 mt-0.5">Ready for 1-click posting</p>
          </div>
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Posted to Accounting</p>
            <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-200 mt-1">{postedCount}</p>
            <p className="text-[11px] text-emerald-600/80 mt-0.5">Linked to General Ledger</p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Auto-Save Persistent Draft Resume Alert Banner */}
      {hasDraft && !showUploadModal && (
        <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/60 rounded-lg shrink-0">
              <Clock className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                Unsaved Draft Detected
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                You have an auto-saved document draft from {lastSavedAt ? lastSavedAt.toLocaleTimeString() : 'earlier'}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={handleDiscardDraft}
              className="px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
            >
              Discard Draft
            </button>
            <button
              onClick={handleRestoreDraftClick}
              className="px-4 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Resume Draft
            </button>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <UploadCloud className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Upload Source Evidence & Run OCR
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  {isSaving ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Saving draft...
                    </span>
                  ) : lastSavedAt ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Save className="w-3 h-3" /> Auto-saved at {lastSavedAt.toLocaleTimeString()}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      <Info className="w-3 h-3" /> Auto-save active
                    </span>
                  )}
                </div>
              </div>

              <button 
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {showDraftRestoredBanner && (
              <div className="mt-3 p-2.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                <Check className="w-4 h-4 text-emerald-600" /> Auto-saved draft successfully restored!
              </div>
            )}

            <form onSubmit={handleUpload} className="space-y-4 mt-4">
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-5 text-center hover:border-indigo-500 transition-colors bg-slate-50/50 dark:bg-slate-900/30">
                <UploadCloud className="w-8 h-8 text-indigo-500 mx-auto mb-1.5" />
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {selectedFile ? selectedFile.name : 'Click or drag source document here'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">JPEG, PNG, WEBP, or PDF up to 25MB (Auto SHA-256 Hashed)</p>
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*,application/pdf"
                  className="hidden"
                  id="file-upload-input"
                />
                <label
                  htmlFor="file-upload-input"
                  className="inline-block mt-2.5 px-3 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-semibold rounded-lg cursor-pointer hover:bg-indigo-100"
                >
                  Choose File
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Document Title / File Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sales_Invoice_Acme_2026.pdf"
                  value={formData.fileName}
                  onChange={(e) => updateField('fileName', e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Document Type
                  </label>
                  <select
                    value={formData.documentType}
                    onChange={(e) => updateField('documentType', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="RECEIPT">Official Receipt (OR) / Receipt</option>
                    <option value="SALES_INVOICE">Sales Invoice</option>
                    <option value="PURCHASE_INVOICE">Purchase Invoice</option>
                    <option value="BILLING_STATEMENT">Billing Statement / SOA</option>
                    <option value="BANK_DOCUMENT">Bank Statement</option>
                    <option value="TAX_FORM">BIR Tax Form (2307 / 1702)</option>
                    <option value="CONTRACT">Contract / Agreement</option>
                    <option value="GENERAL_ATTACHMENT">General Attachment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Invoice / Reference #
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. OR-2026-908"
                    value={formData.referenceNumber}
                    onChange={(e) => updateField('referenceNumber', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Audit Notes & Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional compliance or cross-reference notes..."
                  value={formData.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/60 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-900 dark:text-indigo-300 leading-relaxed">
                  <strong>Instant AI OCR Analysis:</strong> Upon upload, the document will automatically be parsed for merchant, TIN, line items, 12% VAT calculations, and duplicate detection.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                {isDirty ? (
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-800 dark:text-rose-400 transition-colors"
                  >
                    Clear Draft
                  </button>
                ) : <div />}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-2 shadow-xs disabled:opacity-50"
                  >
                    {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    Upload & Extract
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Table Card with Tabs */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700 overflow-hidden">
        
        {/* Navigation Filter Tabs */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-slate-100 dark:border-slate-700 overflow-x-auto">
          {[
            { id: 'ALL', label: 'All Documents', count: totalCount },
            { id: 'PENDING', label: 'Pending Review / OCR', count: pendingCount },
            { id: 'VERIFIED', label: 'Verified Ready', count: verifiedCount },
            { id: 'POSTED', label: 'Posted to Accounting', count: postedCount },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] ${
                activeTab === tab.id ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search Bar & Filters */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1 relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by Merchant, TIN, Invoice #, Document name, or Notes..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-slate-400" />
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              <option value="ALL">All Types</option>
              <option value="RECEIPT">Official Receipt (OR)</option>
              <option value="SALES_INVOICE">Sales Invoice</option>
              <option value="PURCHASE_INVOICE">Purchase Invoice</option>
              <option value="BILLING_STATEMENT">Billing Statement / SOA</option>
              <option value="BANK_DOCUMENT">Bank Statement</option>
              <option value="TAX_FORM">BIR Tax Form</option>
              <option value="GENERAL_ATTACHMENT">General Evidence</option>
            </select>
          </div>
        </div>

        {/* Documents Table */}
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" /> Loading source documents...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-700 dark:text-slate-300 font-bold text-base">No documents in this view</p>
            <p className="text-slate-400 text-xs mt-1 max-w-md">
              Upload invoices, official receipts, or tax certificates to begin automated AI OCR processing and verification.
            </p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="mt-4 px-4 py-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100"
            >
              Upload New Document
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[950px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Document / Source</th>
                  <th className="py-3.5 px-4">Merchant & TIN</th>
                  <th className="py-3.5 px-4">Invoice # & Date</th>
                  <th className="py-3.5 px-4 text-right">Extracted Amount</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredDocuments.map((doc) => {
                  const amountPhp = doc.extractedTotalAmount ? (doc.extractedTotalAmount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00';
                  const vatPhp = doc.extractedVatAmount ? (doc.extractedVatAmount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00';

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors">
                      {/* Document Name & Type */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-slate-100 truncate max-w-xs">{doc.fileName}</p>
                            <span className="inline-block text-[11px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded mt-0.5">
                              {doc.documentType || 'RECEIPT'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Merchant & TIN */}
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-xs">
                          {doc.extractedMerchant || 'Unknown Merchant'}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono">
                          TIN: {doc.extractedTin || 'Not Extracted'}
                        </p>
                      </td>

                      {/* Invoice & Date */}
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {doc.extractedInvoiceNumber || '—'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {doc.extractedDate || new Date(doc.createdAt).toISOString().split('T')[0]}
                        </p>
                      </td>

                      {/* Amount & VAT */}
                      <td className="py-3.5 px-4 text-right">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          ₱{amountPhp}
                        </p>
                        <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                          VAT: ₱{vatPhp}
                        </p>
                      </td>

                      {/* Status Badges */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            doc.verificationStatus === 'POSTED_TO_ACCOUNTING' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                            doc.verificationStatus === 'VERIFIED' ? 'bg-indigo-100 text-indigo-800 border border-indigo-300' :
                            doc.verificationStatus === 'REJECTED' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
                            'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                            {doc.verificationStatus === 'POSTED_TO_ACCOUNTING' ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> :
                             doc.verificationStatus === 'VERIFIED' ? <ShieldCheck className="w-3 h-3 text-indigo-600" /> :
                             <Clock className="w-3 h-3 text-amber-600" />}
                            {doc.verificationStatus.replace(/_/g, ' ')}
                          </span>

                          {doc.linkedTransactionId && doc.linkedTransactionId !== 'NONE' && (
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              {doc.linkedTransactionType || 'TX'}: {doc.linkedTransactionId.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Review & OCR Modal */}
                          <button
                            onClick={() => setViewingDocId(doc.id)}
                            className="px-2.5 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors flex items-center gap-1"
                            title="Inspect OCR & Verify Fields"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Review OCR</span>
                          </button>

                          {/* Post to Accounting */}
                          {doc.verificationStatus !== 'POSTED_TO_ACCOUNTING' && (
                            <button
                              onClick={() => setPostingDoc(doc)}
                              className="px-2.5 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                              title="Post to Accounting"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              <span>Post</span>
                            </button>
                          )}

                          {/* History */}
                          <button
                            onClick={() => setSelectedDocForHistory(doc)}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100"
                            title="Activity Log"
                          >
                            <Clock className="w-4 h-4" />
                          </button>

                          {/* Delete */}
                          <button 
                            onClick={() => handleDelete(doc.id, doc.fileName)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100"
                            title="Delete Document"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {paginationMeta && (
          <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50/50 dark:bg-slate-900/40">
            <PaginationControls
              totalCount={paginationMeta.totalCount}
              itemCount={filteredDocuments.length}
              pageIndex={cursorStack.length}
              hasNextPage={paginationMeta.hasNextPage}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
              loading={loading}
            />
          </div>
        )}
      </div>

      {/* Embedded Modals */}
      <DocumentViewerModal
        isOpen={!!viewingDocId}
        onClose={() => setViewingDocId(null)}
        documentId={viewingDocId}
        onUpdated={fetchDocuments}
      />

      {postingDoc && (
        <PostToAccountingModal
          isOpen={!!postingDoc}
          onClose={() => setPostingDoc(null)}
          document={postingDoc}
          onPosted={fetchDocuments}
        />
      )}

      <ReceiptScannerModal
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onReceiptSaved={fetchDocuments}
      />

      <RecordActivityModal
        isOpen={!!selectedDocForHistory}
        onClose={() => setSelectedDocForHistory(null)}
        entityType="DOCUMENT"
        entityId={selectedDocForHistory?.id || ''}
        title={selectedDocForHistory ? `Activity Trail for "${selectedDocForHistory.fileName}"` : undefined}
      />
    </div>
  );
}
