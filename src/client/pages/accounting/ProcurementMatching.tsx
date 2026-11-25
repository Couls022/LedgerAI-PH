import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ShoppingCart, Plus, RefreshCw, CheckCircle2, ShieldAlert, 
  FileCheck, ArrowRightLeft, Building, AlertCircle, Truck, UserPlus, Edit3,
  Clock, Layers, Activity, Search, Check, ExternalLink, ArrowRight, Receipt
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import ExportButton, { ExportData } from '../../components/ExportButton';
import VendorModal from '../../components/VendorModal';
import SearchBar from '../../components/shared/SearchBar';
import RecordActivityModal from '../../components/RecordActivityModal';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';
import TableRecencyFilterBadge from '../../components/shared/TableRecencyFilterBadge';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter } from '../../components/shared/TableFilterToolbar';
import { isIsoDateInRecentOneMonth } from '../../utils/dateFilterUtils';
import { TableScrollContainer, TableDensity } from '../../components/shared/TableScrollContainer';
import { PaginationControls } from '../../components/PaginationControls';

export default function ProcurementMatching() {
  const { activeCompany } = useAuth();
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [poSummary, setPoSummary] = useState<{
    totalPoCount: number;
    openPoCount: number;
    closedPoCount: number;
    cancelledPoCount: number;
    totalCumulativeCommitmentsCentavos: number;
    totalOpenCommitmentsCentavos: number;
    pendingMatchCount: number;
    readyForMatchCount: number;
    pendingGrnCount: number;
    matchedAndBilledCount: number;
    pendingGlPostingBillCount: number;
    pendingGlPostingCentavos: number;
    postedApBillCount: number;
    postedApOpenCentavos: number;
    paidBillCount: number;
    paidBillCentavos: number;
    totalCompanyApOutstandingCentavos: number;
    totalActiveBillsCount?: number;
    poLinkedActiveBillsCount?: number;
    directNonPoActiveBillsCount?: number;
    poLinkedOpenApCentavos?: number;
    directNonPoOpenApCentavos?: number;
    glAp2010BalanceCentavos: number;
    isGlReconciled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPoModal, setShowPoModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [matchResult, setMatchResult] = useState<any>(null);
  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);
  const [postingBillId, setPostingBillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [poFilter, setPoFilter] = useState<'ALL' | 'PENDING_MATCH' | 'MATCHED' | 'OPEN'>('ALL');
  const [poDateFilterMode, setPoDateFilterMode] = useState<'RECENT_1_MONTH' | 'ALL'>('ALL');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('ALL');
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  // Pagination & Density State (Default 20 per page)
  const [poPage, setPoPage] = useState(1);
  const [poPageSize, setPoPageSize] = useState(20);
  const [poDensity, setPoDensity] = useState<TableDensity>('comfortable');

  const [vendorPage, setVendorPage] = useState(1);
  const [vendorPageSize, setVendorPageSize] = useState(20);
  const [vendorDensity, setVendorDensity] = useState<TableDensity>('comfortable');

  const [newPo, setNewPo] = useState({
    poNumber: `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`,
    vendorId: '',
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    expectedTotal: 15000,
    items: [
      { description: 'Security Hardware / Office Assets', quantity: 1, unitPrice: 15000, isVatInclusive: true }
    ]
  });

  const [matchParams, setMatchParams] = useState({
    poId: '',
    poNumber: '',
    vendorInvoiceNumber: '',
    poAmount: 0,
    grnAmount: 0,
    vendorInvoiceAmount: 0,
    receivedQuantity: 1,
    billedQuantity: 1,
    autoCreateBill: true,
    atcCode: 'WC158', // Official BIR RR 11-2018 ATC: WC158 1% Goods
    vatOption: 'VAT_12_INCLUSIVE' as 'VAT_12_INCLUSIVE' | 'NON_VAT_EXEMPT'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [venData, poData] = await Promise.all([
        apiFetch<any>('/api/master-data/vendors'),
        apiFetch<any>('/api/operations/procurement/purchase-orders?limit=1000')
      ]);
      setVendors(Array.isArray(venData) ? venData : (venData.data || []));
      if (Array.isArray(poData)) {
        setPurchaseOrders(poData);
        setPoSummary(null);
      } else {
        setPurchaseOrders(poData.items || poData.data || []);
        setPoSummary(poData.summary || null);
      }
    } catch (err: any) {
      console.error('Failed to load procurement data', err);
      setError(err.message || 'Failed to load procurement data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeCompany?.id]);

  const handleVendorCreated = (newVendor: any) => {
    setVendors(prev => {
      const idx = prev.findIndex(v => v.id === newVendor.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newVendor;
        return copy;
      }
      return [newVendor, ...prev];
    });
    setNewPo(prev => ({
      ...prev,
      vendorId: newVendor.id
    }));
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch<any>('/api/operations/procurement/purchase-orders', {
        method: 'POST',
        body: newPo as any
      });
      setShowPoModal(false);
      setSuccessMsg(`Purchase Order ${newPo.poNumber} issued successfully.`);
      setNewPo({
        poNumber: `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`,
        vendorId: '',
        orderDate: new Date().toISOString().slice(0, 10),
        expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        expectedTotal: 15000,
        items: [{ description: 'Security Hardware / Office Assets', quantity: 1, unitPrice: 15000, isVatInclusive: true }]
      });
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Error creating purchase order');
    }
  };

  const openMatchModalForPo = (po: any) => {
    const phpAmt = (po.totalAmount || 0) / 100;
    const isNonVatVendor = String(po.vendorTaxClassification || '').toUpperCase().includes('NON_VAT') ||
      String(activeCompany?.vatStatus || 'VAT').toUpperCase() !== 'VAT';
    setMatchParams({
      poId: po.id,
      poNumber: po.poNumber,
      vendorInvoiceNumber: po.linkedBillNumber || po.linkedBillNumbers?.[0] || `BILL-${po.poNumber}`,
      poAmount: phpAmt,
      grnAmount: phpAmt,
      vendorInvoiceAmount: phpAmt,
      receivedQuantity: 1,
      billedQuantity: 1,
      autoCreateBill: true,
      atcCode: 'WC158',
      vatOption: isNonVatVendor ? 'NON_VAT_EXEMPT' : 'VAT_12_INCLUSIVE'
    });
    setMatchResult(null);
    setShowMatchModal(true);
  };

  const handleRecordGrn = async (po: any) => {
    setError(null);
    setSuccessMsg(null);
    setReceivingPoId(po.id);
    try {
      const data = await apiFetch<any>(`/api/operations/procurement/purchase-orders/${po.id}/receive`, {
        method: 'POST',
        body: {} as any
      });
      setSuccessMsg(data.message || `Goods Receipt Note ${data.grnNumber} recorded for ${po.poNumber}.`);
      fetchData();
    } catch (err: any) {
      setError(err.message || `Failed to record GRN for ${po.poNumber}`);
    } finally {
      setReceivingPoId(null);
    }
  };

  const handlePostLinkedBillToGl = async (po: any) => {
    if (!po.linkedBillId) return;
    setError(null);
    setSuccessMsg(null);
    setPostingBillId(po.linkedBillId);
    try {
      const data = await apiFetch<any>(`/api/accounting/purchase-bills/${po.linkedBillId}/post`, {
        method: 'POST',
        body: {} as any
      });
      setSuccessMsg(data.message || `Linked Purchase Bill #${po.linkedBillNumber} posted to General Ledger (GL Account 2010 & 1120 Input VAT).`);
      fetchData();
    } catch (err: any) {
      setError(err.message || `Failed to post linked bill #${po.linkedBillNumber} to GL`);
    } finally {
      setPostingBillId(null);
    }
  };

  const handleRun3WayMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMatchResult(null);
    setMatchingInProgress(true);
    try {
      const data = await apiFetch<any>('/api/operations/procurement/3-way-match', {
        method: 'POST',
        body: matchParams as any
      });
      setMatchResult(data);
      if (data.matched) {
        if (data.alreadyMatched) {
          setSuccessMsg(`PO ${matchParams.poNumber} is already linked to Purchase Bill #${data.generatedBillNumber} (${data.generatedBillStatus}). Duplicate billing prevented.`);
        } else if (data.generatedBillNumber) {
          setSuccessMsg(`3-Way Match Passed! Verified ${data.generatedGrnNumber || 'GRN'} and auto-created Purchase Bill #${data.generatedBillNumber} (APPROVED — ready to Post to GL).`);
        } else {
          setSuccessMsg(`3-Way Match Passed within 2.0% statutory tolerance.`);
        }
      }
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Error running 3-way match');
    } finally {
      setMatchingInProgress(false);
    }
  };

  const safeVendors = Array.isArray(vendors) ? vendors : [];
  const filteredVendors = safeVendors.filter(v => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const code = (v?.code || '').toLowerCase();
    const name = (v?.legalName || v?.name || '').toLowerCase();
    const dba = (v?.tradeName || '').toLowerCase();
    const tin = (v?.tin || '').toLowerCase();
    const taxClass = (v?.taxClassification || '').toLowerCase();
    return code.includes(q) || name.includes(q) || dba.includes(q) || tin.includes(q) || taxClass.includes(q);
  });

  const vendorDropdownOptions = React.useMemo(() => {
    return safeVendors.map((v: any) => ({
      value: v.id,
      label: v.legalName || v.name || v.code || 'Unnamed Vendor'
    }));
  }, [safeVendors]);

  // Mutually Exclusive PO Filter, Recency Filter, Search & Sort
  const safePos = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const filteredPos = safePos
    .filter(po => {
      if (selectedVendorId && selectedVendorId !== 'ALL' && po.vendorId !== selectedVendorId) {
        return false;
      }
      if (fromDate) {
        const d = (po.orderDate || po.poDate || po.createdAt || '').slice(0, 10);
        if (d && d < fromDate) return false;
      }
      if (toDate) {
        const d = (po.orderDate || po.poDate || po.createdAt || '').slice(0, 10);
        if (d && d > toDate) return false;
      }
      if (poDateFilterMode === 'RECENT_1_MONTH' && !fromDate && !toDate) {
        const d = po.orderDate || po.poDate || po.createdAt;
        if (!isIsoDateInRecentOneMonth(d)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const num = (po.poNumber || '').toLowerCase();
        const vName = (po.vendorName || '').toLowerCase();
        const notes = (po.notes || '').toLowerCase();
        if (!num.includes(q) && !vName.includes(q) && !notes.includes(q)) return false;
      }
      if (poFilter === 'PENDING_MATCH') return po.matchStatus !== 'MATCHED_AND_BILLED' && po.status !== 'CANCELLED';
      if (poFilter === 'MATCHED') return po.matchStatus === 'MATCHED_AND_BILLED';
      if (poFilter === 'OPEN') return po.status !== 'CLOSED' && po.status !== 'CANCELLED';
      return true;
    })
    .sort((a, b) => {
      const dateA = new Date(a.orderDate || a.poDate || a.createdAt || 0).getTime();
      const dateB = new Date(b.orderDate || b.poDate || b.createdAt || 0).getTime();
      return sortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
    });

  const paginatedPos = filteredPos.slice((poPage - 1) * poPageSize, poPage * poPageSize);
  const paginatedVendors = filteredVendors.slice((vendorPage - 1) * vendorPageSize, vendorPage * vendorPageSize);

  // Authoritative Database-Wide Metrics (Zero 200-row truncation, zero overlapping counts)
  const totalPoCount = poSummary?.totalPoCount ?? safePos.length;
  const totalCumulativeCentavos = poSummary?.totalCumulativeCommitmentsCentavos ?? safePos.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
  const totalOpenCommitmentCentavos = poSummary?.totalOpenCommitmentsCentavos ?? safePos
    .filter(p => p.status !== 'CLOSED' && p.status !== 'CANCELLED')
    .reduce((sum, p) => sum + (p.totalAmount || 0), 0);
  const openPoCount = poSummary?.openPoCount ?? safePos.filter(p => p.status !== 'CLOSED' && p.status !== 'CANCELLED').length;
  const pendingMatchCount = poSummary?.pendingMatchCount ?? safePos.filter(p => p.matchStatus !== 'MATCHED_AND_BILLED' && p.status !== 'CANCELLED').length;
  const readyForMatchCount = poSummary?.readyForMatchCount ?? safePos.filter(p => p.matchStatus === 'READY_FOR_MATCH').length;
  const pendingGrnCount = poSummary?.pendingGrnCount ?? safePos.filter(p => p.matchStatus === 'PENDING_GRN').length;
  const matchedAndBilledCount = poSummary?.matchedAndBilledCount ?? safePos.filter(p => p.matchStatus === 'MATCHED_AND_BILLED').length;

  const exportData: ExportData = {
    filename: `Procurement_Register_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Procurement & Purchase Orders Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | 3-Way Match Audit Log`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['PO Number', 'Order Date', 'Vendor Name', 'Vendor TIN', 'Authorized Total (PHP)', 'Receiving Status', '3-Way Match', 'Status'],
    rows: safePos.map(po => [
      po.poNumber || '',
      po.poDate || po.orderDate || '',
      po.vendorName || '-',
      po.vendorTin || 'N/A',
      ((po.totalAmount || 0) / 100).toFixed(2),
      po.grnStatus || 'PENDING',
      po.matchStatus || 'PENDING',
      po.status || 'APPROVED'
    ])
  };

  return (
    <div className="space-y-5">
      {successMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:underline">Dismiss</button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-rose-600" /> {error}</span>
          <button onClick={() => setError(null)} className="text-rose-600 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3.5 bg-white dark:bg-[#11192B] p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs">
        <div className="min-w-0">
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-sky-400 shrink-0" />
            <span>Procurement &amp; 3-Way Matching Engine</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 leading-relaxed">
            Purchase Order creation, Goods Receipt Notes (GRN), 3-Way Matching tolerance verification, and auto-AP bill creation.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/accounting/purchase-bills')}
            className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Purchase Bills (AP)</span>
            {poSummary?.totalActiveBillsCount !== undefined && (
              <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                {poSummary.totalActiveBillsCount}
              </span>
            )}
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <ModuleArchiveInbox
            entityTypes={['PURCHASE_REQUISITION', 'PURCHASE_ORDER', 'GOODS_RECEIPT_NOTE', 'PURCHASE_BILL', 'VENDOR']}
            moduleTitle="Procurement & 3-Way Matching"
            description="Archived Purchase Requisitions, Purchase Orders, Goods Receipt Notes, Bills, and Suppliers."
            onRestored={fetchData}
          />
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => {
              const firstUnbilled = safePos.find(p => !p.linkedBillId) || safePos[0];
              if (firstUnbilled) {
                openMatchModalForPo(firstUnbilled);
              } else {
                setShowMatchModal(true);
              }
            }}
            className="bg-amber-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-amber-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 shrink-0" /> Run 3-Way Match Tool
          </button>
          <button
            onClick={() => setShowPoModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" /> Issue Purchase Order
          </button>
        </div>
      </div>

      {/* Top Authoritative Financial KPI Cards (Database-Wide & Mutually Exclusive) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs card-hover relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total Procurement Commitments
            </span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400 flex items-center justify-center w-8 h-8">
              <span className="font-bold text-base leading-none">₱</span>
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
            ₱{(totalCumulativeCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 space-y-0.5">
            <div>
              {totalPoCount.toLocaleString()} cumulative authorized POs ({openPoCount} Open · {poSummary?.closedPoCount ?? (totalPoCount - openPoCount)} Closed)
            </div>
            {openPoCount > 0 && (
              <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                Open PO Balance: ₱{(totalOpenCommitmentCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              Pending 3-Way Match (Unbilled POs)
            </span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
            {pendingMatchCount.toLocaleString()}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            <span>{readyForMatchCount.toLocaleString()} GRN received &amp; ready for supplier bill match · {pendingGrnCount.toLocaleString()} awaiting GRN</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Matched &amp; Billed (AP Linked)
            </span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {matchedAndBilledCount.toLocaleString()}
            </span>
            {poSummary && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                poSummary.isGlReconciled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
              }`}>
                {poSummary.isGlReconciled ? '✓ AP ↔ GL 2010 Reconciled' : 'GL 2010 Variance'}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 space-y-1">
            {poSummary ? (
              <>
                <div>
                  {poSummary.paidBillCount} Paid · {poSummary.postedApBillCount} Posted Open AP · {poSummary.pendingGlPostingBillCount} Approved (Pending GL Post)
                </div>
                <div className="pt-1.5 mt-1.5 border-t border-slate-100 dark:border-slate-700/70 text-[11px] space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">PO-Linked Open AP:</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                      ₱{((poSummary.poLinkedOpenApCentavos ?? poSummary.postedApOpenCentavos ?? 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">
                      Direct Non-PO Bills AP ({poSummary.directNonPoActiveBillsCount ?? 0} bills):
                    </span>
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                      ₱{((poSummary.directNonPoOpenApCentavos ?? 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-0.5 font-bold text-indigo-700 dark:text-sky-400">
                    <span>Total Company AP (GL 2010):</span>
                    <button
                      type="button"
                      onClick={() => navigate('/accounting/purchase-bills')}
                      className="font-mono hover:underline inline-flex items-center gap-1 cursor-pointer"
                      title="Open Purchase Bills & Accounts Payable Register"
                    >
                      <span>₱{((poSummary.totalCompanyApOutstandingCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <span>Passed 2.0% tolerance · Linked to Purchase Bills &amp; AP Subledger</span>
            )}
          </div>
        </div>
      </div>

      {/* 3-Way Matching Architecture Diagram Card */}
      <div className="bg-slate-900 text-slate-100 p-6 rounded-xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
            <FileCheck className="w-4 h-4" />
            Automated 3-Way Matching Architecture
          </h3>
          <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700">
            Statutory Tolerance Threshold: ≤ 2.0%
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700/60 space-y-1">
            <div className="font-bold text-indigo-400 flex items-center justify-between">
              <span>1. Purchase Order (PO)</span>
              <span className="text-[10px] bg-indigo-950/80 text-indigo-300 px-1.5 py-0.5 rounded">Contracted</span>
            </div>
            <p className="text-slate-400">Authorized items & contracted prices agreed with registered vendor.</p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700/60 space-y-1">
            <div className="font-bold text-emerald-400 flex items-center justify-between">
              <span>2. Goods Receipt Note (GRN)</span>
              <span className="text-[10px] bg-emerald-950/80 text-emerald-300 px-1.5 py-0.5 rounded">Physical</span>
            </div>
            <p className="text-slate-400">Physical inventory inspected and received at warehouse / site.</p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700/60 space-y-1">
            <div className="font-bold text-amber-400 flex items-center justify-between">
              <span>3. Supplier Invoice</span>
              <span className="text-[10px] bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded">Financial</span>
            </div>
            <p className="text-slate-400">Vendor bill verified within 2.0% tolerance before posting Accounts Payable.</p>
          </div>
        </div>
      </div>

      {/* Unified Filter, Sort, Vendor & Search Toolbar */}
      <TableFilterToolbar
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => {
          setSortOrder(ord);
          setPoPage(1);
        }}
        datePeriod={datePeriod}
        onDatePeriodChange={(p) => {
          setDatePeriod(p);
          setPoPage(1);
        }}
        fromDate={fromDate}
        toDate={toDate}
        onDateRangeChange={({ fromDate: f, toDate: t }) => {
          setFromDate(f);
          setToDate(t);
          setPoPage(1);
        }}
        entityLabel="Vendor"
        selectedEntityId={selectedVendorId}
        entityOptions={vendorDropdownOptions}
        onEntityChange={(vId) => {
          setSelectedVendorId(vId);
          setPoPage(1);
        }}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPoPage(1);
        }}
        searchPlaceholder="Search PO #, vendor name, notes..."
        filteredCount={filteredPos.length}
        totalCount={totalPoCount}
        pageSize={poPageSize}
        onPageSizeChange={(newSize) => {
          setPoPageSize(newSize);
          setPoPage(1);
        }}
        onResetFilters={() => {
          setSortOrder('DESC');
          setDatePeriod('ALL');
          setPoDateFilterMode('ALL');
          setFromDate('');
          setToDate('');
          setSelectedVendorId('ALL');
          setSearchQuery('');
          setPoFilter('ALL');
          setPoPage(1);
        }}
      />

      {/* Issued Purchase Orders Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Issued Purchase Orders</span>
            <span className="text-xs text-slate-400">({filteredPos.length} records)</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center bg-slate-100 dark:bg-slate-700/60 p-0.5 rounded-lg text-xs font-semibold">
              <button
                onClick={() => { setPoFilter('ALL'); setPoPage(1); }}
                className={`px-2.5 py-1 rounded-md transition-colors ${poFilter === 'ALL' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
              >
                All ({totalPoCount})
              </button>
              <button
                onClick={() => { setPoFilter('PENDING_MATCH'); setPoPage(1); }}
                className={`px-2.5 py-1 rounded-md transition-colors ${poFilter === 'PENDING_MATCH' ? 'bg-white dark:bg-slate-800 text-amber-600 shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Pending Match ({pendingMatchCount})
              </button>
              <button
                onClick={() => { setPoFilter('MATCHED'); setPoPage(1); }}
                className={`px-2.5 py-1 rounded-md transition-colors ${poFilter === 'MATCHED' ? 'bg-white dark:bg-slate-800 text-emerald-600 shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Matched &amp; Billed ({matchedAndBilledCount})
              </button>
              <button
                onClick={() => { setPoFilter('OPEN'); setPoPage(1); }}
                className={`px-2.5 py-1 rounded-md transition-colors ${poFilter === 'OPEN' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Open ({openPoCount})
              </button>
            </div>
          </div>
        </div>

        <TableScrollContainer
          title="Purchase Orders Register"
          totalRecordsCount={filteredPos.length}
          density={poDensity}
          onDensityChange={setPoDensity}
          footer={
            <PaginationControls
              totalCount={filteredPos.length}
              itemCount={paginatedPos.length}
              pageIndex={poPage - 1}
              pageSize={poPageSize}
              pageSizeOptions={[20, 50, 100]}
              onPageSizeChange={(newSize) => {
                setPoPageSize(newSize);
                setPoPage(1);
              }}
              hasNextPage={poPage * poPageSize < filteredPos.length}
              onNextPage={() => setPoPage(p => p + 1)}
              onPrevPage={() => setPoPage(p => Math.max(1, p - 1))}
            />
          }
        >
          <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[1040px]">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900/90 text-slate-500 uppercase font-semibold border-b border-slate-100 dark:border-slate-700 shadow-xs">
              <tr>
                <th className="py-3 px-4">PO Number</th>
                <th className="py-3 px-4">Order Date</th>
                <th className="py-3 px-4">Vendor</th>
                <th className="py-3 px-4 text-right">Authorized Total</th>
                <th className="py-3 px-4 text-center">GRN Receiving</th>
                <th className="py-3 px-4 text-center">3-Way Match &amp; Linked AP Bill</th>
                <th className="py-3 px-4 text-center">PO Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {paginatedPos.map((po) => {
                const formattedDate = po.poDate 
                  ? new Date(po.poDate).toLocaleDateString() 
                  : (po.orderDate || po.createdAt ? new Date(po.createdAt).toLocaleDateString() : '-');
                const hasLinkedBill = Boolean(po.linkedBillId);
                const billStatusUpper = String(po.linkedBillStatus || '').toUpperCase();
                const needsGrn = (po.linkedGrnCount || 0) === 0;

                return (
                  <tr key={po.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      <button
                        onClick={() => setJourneyTarget({ entityType: 'PURCHASE_ORDER', entityId: po.id, title: `Purchase Order ${po.poNumber}` })}
                        className="hover:underline flex items-center gap-1"
                        title="Click to inspect 360° Journey"
                      >
                        {po.poNumber}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">
                      {formattedDate}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800 dark:text-slate-100">
                        {po.vendorName || 'Approved Enterprise Vendor'}
                      </div>
                      {po.vendorTin && (
                        <div className="text-[10px] font-mono text-slate-400">
                          TIN: {po.vendorTin}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      ₱{((po.totalAmount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          po.grnStatus === 'GRN_RECEIVED' 
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : po.grnStatus === 'PARTIALLY_RECEIVED'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                          {po.grnStatus === 'GRN_RECEIVED' ? 'GRN RECEIVED' : (po.grnStatus?.replace(/_/g, ' ') || 'PENDING INSPECTION')}
                        </span>
                        {po.linkedGrnNumbers?.[0] && (
                          <span className="text-[10px] font-mono text-slate-400">
                            {po.linkedGrnNumbers[0]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          po.matchStatus === 'MATCHED_AND_BILLED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : po.matchStatus === 'READY_FOR_MATCH'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                          {po.matchStatus === 'MATCHED_AND_BILLED'
                            ? 'MATCHED & BILLED'
                            : po.matchStatus === 'READY_FOR_MATCH'
                            ? 'READY FOR MATCH'
                            : 'AWAITING GRN'}
                        </span>
                        {hasLinkedBill && (
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                            billStatusUpper === 'PAID'
                              ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
                              : ['POSTED', 'PARTIAL'].includes(billStatusUpper)
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}>
                            {po.linkedBillNumber} · {billStatusUpper === 'APPROVED' ? 'PENDING GL POST' : billStatusUpper}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full ${
                        String(po.status || '').toUpperCase() === 'CLOSED'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                      }`}>
                        {po.status || 'APPROVED'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => setJourneyTarget({ entityType: 'PURCHASE_ORDER', entityId: po.id, title: `Purchase Order ${po.poNumber}` })}
                          className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-1 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                          title="Inspect PO 360° Record Journey"
                        >
                          <Activity className="w-3.5 h-3.5" /> 360° View
                        </button>
                        {needsGrn && (
                          <button
                            type="button"
                            disabled={receivingPoId === po.id}
                            onClick={() => handleRecordGrn(po)}
                            className="px-2.5 py-1 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-lg font-semibold hover:bg-teal-100 transition-colors disabled:opacity-50"
                            title="Record Warehouse Inspection / Goods Receipt Note (GRN)"
                          >
                            {receivingPoId === po.id ? 'Recording...' : 'Record GRN'}
                          </button>
                        )}
                        {hasLinkedBill ? (
                          <>
                            {['POSTED', 'PARTIAL'].includes(billStatusUpper) && Number(po.linkedBillBalanceDueCentavos || 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => navigate(`/accounting/purchase-bills?source=PO_LINKED&search=${encodeURIComponent(po.linkedBillNumber || '')}&payBillId=${encodeURIComponent(po.linkedBillId)}`)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors inline-flex items-center gap-1"
                                title="Open linked bill in Purchase Bills (AP) to settle balance via Disbursement Voucher"
                              >
                                <span>Pay in AP</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                            {billStatusUpper === 'APPROVED' && (
                              <button
                                type="button"
                                disabled={postingBillId === po.linkedBillId}
                                onClick={() => handlePostLinkedBillToGl(po)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                                title="Post Linked AP Purchase Bill to General Ledger (GL 2010 & 1120 Input VAT)"
                              >
                                {postingBillId === po.linkedBillId ? 'Posting...' : 'Post Bill to GL'}
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            onClick={() => openMatchModalForPo(po)}
                            className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg font-semibold hover:bg-amber-100 transition-colors"
                          >
                            3-Way Match
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginatedPos.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No purchase orders found matching this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScrollContainer>
      </div>

      {/* Registered Vendors Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Truck className="w-4 h-4 text-amber-600" /> Approved Vendors List
          </div>
          <div className="flex items-center gap-3">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search vendors by code, name, TIN..."
            />
            <button
              onClick={() => {
                setEditingVendor(null);
                setShowVendorModal(true);
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors shadow-sm shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" /> + Create New Vendor
            </button>
          </div>
        </div>
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading vendors...
          </div>
        ) : (
          <TableScrollContainer
            title="Approved Vendors Directory"
            totalRecordsCount={filteredVendors.length}
            density={vendorDensity}
            onDensityChange={setVendorDensity}
            footer={
              <PaginationControls
                totalCount={filteredVendors.length}
                itemCount={paginatedVendors.length}
                pageIndex={vendorPage - 1}
                pageSize={vendorPageSize}
                pageSizeOptions={[20, 50, 100]}
                onPageSizeChange={(newSize) => {
                  setVendorPageSize(newSize);
                  setVendorPage(1);
                }}
                hasNextPage={vendorPage * vendorPageSize < filteredVendors.length}
                onNextPage={() => setVendorPage(p => p + 1)}
                onPrevPage={() => setVendorPage(p => Math.max(1, p - 1))}
              />
            }
          >
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900/90 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700 shadow-xs">
                <tr>
                  <th className="py-3.5 px-4">Vendor Code</th>
                  <th className="py-3.5 px-4">Legal Name / DBA</th>
                  <th className="py-3.5 px-4">BIR TIN</th>
                  <th className="py-3.5 px-4">Tax Classification</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {paginatedVendors.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                      {v.code || '-'}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100">
                      {v.legalName || v.name}
                      {v.tradeName && <span className="block text-[10px] text-slate-400 font-normal">DBA: {v.tradeName}</span>}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-500">
                      {v.tin || 'N/A'}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {v.taxClassification || 'VAT'}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[11px] font-bold rounded-full">
                        APPROVED VENDOR
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setJourneyTarget({ entityType: 'VENDOR', entityId: v.id, title: `Vendor: ${v.legalName || v.name}` })}
                          className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-1 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                          title="Inspect 360° Record Journey"
                        >
                          <Activity className="w-3.5 h-3.5" /> 360° View
                        </button>
                        <button
                          onClick={() => {
                            setEditingVendor(v);
                            setShowVendorModal(true);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-amber-500" /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredVendors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No matching vendors found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        )}
      </div>

      {/* Create Purchase Order Modal */}
      {showPoModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-indigo-600" /> Issue Purchase Order
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreatePo} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">Select Vendor</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingVendor(null);
                      setShowVendorModal(true);
                    }}
                    className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:underline flex items-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> + Create Vendor
                  </button>
                </div>
                <select
                  required
                  value={newPo.vendorId}
                  onChange={(e) => {
                    if (e.target.value === '__NEW_VENDOR__') {
                      setEditingVendor(null);
                      setShowVendorModal(true);
                    } else {
                      setNewPo({ ...newPo, vendorId: e.target.value });
                    }
                  }}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select vendor...</option>
                  <option value="__NEW_VENDOR__" className="font-semibold text-amber-600">+ Create New Vendor...</option>
                  {safeVendors.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.code ? `[${v.code}] ` : ''}{v.legalName || v.name} {v.tin ? `(TIN: ${v.tin})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">PO Number</label>
                  <input
                    type="text"
                    required
                    value={newPo.poNumber}
                    onChange={(e) => setNewPo({ ...newPo, poNumber: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Order Date</label>
                  <input
                    type="date"
                    required
                    value={newPo.orderDate}
                    onChange={(e) => setNewPo({ ...newPo, orderDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Expected Delivery Date</label>
                  <input
                    type="date"
                    value={newPo.expectedDeliveryDate}
                    onChange={(e) => setNewPo({ ...newPo, expectedDeliveryDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Authorized Total (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newPo.expectedTotal}
                    onChange={(e) => setNewPo({ ...newPo, expectedTotal: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Item Description</label>
                <input
                  type="text"
                  required
                  value={newPo.items[0]?.description || ''}
                  onChange={(e) => {
                    const desc = e.target.value;
                    setNewPo(prev => ({
                      ...prev,
                      items: [{ ...prev.items[0], description: desc, unitPrice: prev.expectedTotal, quantity: 1 }]
                    }));
                  }}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  placeholder="e.g. IT Equipment, Surveillance System, Warehouse Pallets..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowPoModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Create & Approve PO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3-Way Matching Engine Modal */}
      {showMatchModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                Automated 3-Way Matching Verification Tool
              </h3>
              <span className="text-[11px] font-mono bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 px-2.5 py-0.5 rounded-full border border-amber-200 font-bold">
                2.0% Statutory Tolerance
              </span>
            </div>

            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs font-semibold">{error}</div>}

            <form onSubmit={handleRun3WayMatch} className="space-y-4">
              {/* Select PO to match */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Select Purchase Order to Verify
                </label>
                <select
                  value={matchParams.poNumber}
                  onChange={(e) => {
                    const selPo = safePos.find(p => p.poNumber === e.target.value);
                    if (selPo) {
                      openMatchModalForPo(selPo);
                    } else {
                      setMatchParams(prev => ({ ...prev, poNumber: e.target.value }));
                    }
                  }}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                >
                  <option value="">Choose an issued Purchase Order...</option>
                  {safePos.map(po => (
                    <option key={po.id} value={po.poNumber}>
                      {po.poNumber} — {po.vendorName || 'Vendor'} (₱{((po.totalAmount || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })})
                    </option>
                  ))}
                </select>
              </div>

              {/* 3 Documents Side by Side */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. PO Document */}
                <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl border border-indigo-200 dark:border-indigo-900/60 space-y-2">
                  <div className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center justify-between">
                    <span>1. Purchase Order</span>
                    <span className="text-[10px] font-mono text-indigo-600">AUTH</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">PO Number</label>
                    <input
                      type="text"
                      required
                      value={matchParams.poNumber}
                      onChange={(e) => setMatchParams({ ...matchParams, poNumber: e.target.value })}
                      className="w-full text-xs p-1.5 border border-indigo-200 dark:border-indigo-800 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Authorized Total (PHP)</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      value={matchParams.poAmount}
                      onChange={(e) => setMatchParams({ ...matchParams, poAmount: parseFloat(e.target.value) || 0 })}
                      className="w-full text-xs p-1.5 border border-indigo-200 dark:border-indigo-800 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                    />
                  </div>
                </div>

                {/* 2. GRN Document */}
                <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-900/60 space-y-2">
                  <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center justify-between">
                    <span>2. Goods Receipt (GRN)</span>
                    <span className="text-[10px] font-mono text-emerald-600">INSPECTED</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">GRN Received Qty</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={matchParams.receivedQuantity}
                      onChange={(e) => setMatchParams({ ...matchParams, receivedQuantity: parseInt(e.target.value) || 1 })}
                      className="w-full text-xs p-1.5 border border-emerald-200 dark:border-emerald-800 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">GRN Value (PHP)</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      value={matchParams.grnAmount}
                      onChange={(e) => setMatchParams({ ...matchParams, grnAmount: parseFloat(e.target.value) || 0 })}
                      className="w-full text-xs p-1.5 border border-emerald-200 dark:border-emerald-800 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                    />
                  </div>
                </div>

                {/* 3. Vendor Invoice */}
                <div className="p-3.5 bg-amber-50/60 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-900/60 space-y-2">
                  <div className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center justify-between">
                    <span>3. Supplier Invoice</span>
                    <span className="text-[10px] font-mono text-amber-600">BILLED</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Vendor Bill / SI #</label>
                    <input
                      type="text"
                      required
                      value={matchParams.vendorInvoiceNumber}
                      onChange={(e) => setMatchParams({ ...matchParams, vendorInvoiceNumber: e.target.value })}
                      className="w-full text-xs p-1.5 border border-amber-200 dark:border-amber-800 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Billed Amount (PHP)</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      value={matchParams.vendorInvoiceAmount}
                      onChange={(e) => setMatchParams({ ...matchParams, vendorInvoiceAmount: parseFloat(e.target.value) || 0 })}
                      className="w-full text-xs p-1.5 border border-amber-200 dark:border-amber-800 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Auto AP Creation & Philippine BIR Tax Mapping */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={matchParams.autoCreateBill}
                    onChange={(e) => setMatchParams({ ...matchParams, autoCreateBill: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span>Upon Successful 3-Way Match, verify GRN and automatically generate Accounts Payable Bill</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200 dark:border-slate-700">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      BIR VAT Treatment (NIRC Sec. 110)
                    </label>
                    <select
                      value={matchParams.vatOption}
                      onChange={(e) => setMatchParams({ ...matchParams, vatOption: e.target.value as 'VAT_12_INCLUSIVE' | 'NON_VAT_EXEMPT' })}
                      className="w-full text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-semibold"
                    >
                      <option value="VAT_12_INCLUSIVE">12% Creditable Input VAT Inclusive (VAT Supplier)</option>
                      <option value="NON_VAT_EXEMPT">Non-VAT / VAT-Exempt Purchase (0% Input VAT)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      BIR Form 2307 EWT ATC (RR 11-2018)
                    </label>
                    <select
                      value={matchParams.atcCode}
                      onChange={(e) => setMatchParams({ ...matchParams, atcCode: e.target.value })}
                      className="w-full text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-semibold"
                    >
                      <option value="WC158">WC158 — Top Withholding Agent: Goods (1%)</option>
                      <option value="WC160">WC160 — Top Withholding Agent: Services (2%)</option>
                      <option value="WC100">WC100 — Rental of Real/Personal Property (5%)</option>
                      <option value="WC010">WC010 — Corp. Professional / Talent Fees (10%)</option>
                      <option value="WI010">WI010 — Ind. Professional Fees (5% / 10%)</option>
                      <option value="WC120">WC120 — Prime Contractors / Subcontractors (2%)</option>
                      <option value="NONE">NONE — Exempt / 0% EWT Withholding</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 bg-white dark:bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span>
                    Projected GL Split on Post:
                  </span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                    {matchParams.vatOption === 'VAT_12_INCLUSIVE'
                      ? `Base ₱${(matchParams.vendorInvoiceAmount / 1.12).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + 12% Input VAT ₱${(matchParams.vendorInvoiceAmount - (matchParams.vendorInvoiceAmount / 1.12)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : `Gross Expense ₱${matchParams.vendorInvoiceAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (0% Input VAT)`}
                  </span>
                </div>
              </div>

              {/* Match Result Display */}
              {matchResult && (
                <div className={`p-4 rounded-xl border text-xs space-y-2 ${
                  matchResult.matched ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800' : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800'
                }`}>
                  <div className="font-bold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      {matchResult.matched ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                      3-Way Matching Result: {matchResult.matched ? 'PASS (PASSED STATUTORY TOLERANCE)' : 'FAILED / DISCREPANCY DETECTED'}
                    </span>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900/80">
                      Variance: {matchResult.variancePercent !== undefined ? `${matchResult.variancePercent}%` : '0%'}
                    </span>
                  </div>
                  <p>{matchResult.message || matchResult.validationNotes}</p>
                  {matchResult.generatedBillNumber && (
                    <div className="mt-1 pt-2 border-t border-emerald-200 dark:border-emerald-800 font-bold flex items-center gap-2 flex-wrap">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>{matchResult.alreadyMatched ? 'Linked Accounts Payable Bill:' : 'Accounts Payable Bill created:'}</span>
                      <span className="font-mono underline">{matchResult.generatedBillNumber}</span>
                      {matchResult.generatedGrnNumber && (
                        <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                          (GRN: {matchResult.generatedGrnNumber})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowMatchModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={matchingInProgress}
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {matchingInProgress ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                  Verify Match & Auto-Bill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vendor Creation Modal */}
      <VendorModal
        isOpen={showVendorModal}
        onClose={() => {
          setShowVendorModal(false);
          setEditingVendor(null);
        }}
        onVendorCreated={handleVendorCreated}
        initialData={editingVendor}
      />

      {/* Enterprise 360° Record Journey Modal */}
      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={() => fetchData()}
        />
      )}
    </div>
  );
}
