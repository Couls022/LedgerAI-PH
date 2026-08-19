import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, Plus, RefreshCw, CheckCircle2, ShieldAlert, 
  FileCheck, ArrowRightLeft, Building, AlertCircle, Truck, UserPlus, Edit3
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import VendorModal from '../../components/VendorModal';
import SearchBar from '../../components/shared/SearchBar';

export default function ProcurementMatching() {
  const { activeCompany } = useAuth();
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPoModal, setShowPoModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [matchResult, setMatchResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [newPo, setNewPo] = useState({
    poNumber: `PO-${Date.now().toString().slice(-5)}`,
    vendorId: '',
    orderDate: new Date().toISOString().slice(0, 10),
    expectedTotal: 15000,
    items: [
      { description: 'Office Supplies & Stationeries', quantity: 10, unitPrice: 1500 }
    ]
  });

  const [matchParams, setMatchParams] = useState({
    poNumber: 'PO-10023',
    vendorInvoiceNumber: 'INV-VEN-998',
    poAmount: 15000,
    grnAmount: 15000,
    vendorInvoiceAmount: 15000
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/master-data/vendors');
      if (res.ok) {
        const data = await res.json();
        setVendors(Array.isArray(data) ? data : (data.data || []));
      }
    } catch (err) {
      console.error('Failed to load vendors', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    try {
      const res = await fetch('/api/operations/procurement/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPo)
      });
      if (res.ok) {
        setShowPoModal(false);
        alert('Purchase Order created successfully!');
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to create PO');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating purchase order');
    }
  };

  const handleRun3WayMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMatchResult(null);
    try {
      const res = await fetch('/api/operations/procurement/3-way-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(matchParams)
      });
      const data = await res.json();
      if (res.ok) {
        setMatchResult(data);
      } else {
        setError(data.error || data.message || 'Matching failed');
      }
    } catch (err: any) {
      setError(err.message || 'Error running 3-way match');
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

  const exportData: ExportData = {
    filename: `Procurement_3WayMatch_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Procurement & 3-Way Matching Verification Log',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | PO vs GRN vs Invoice Verification`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Vendor Name', 'TIN', 'Tax Classification', 'Status'],
    rows: safeVendors.map(v => [
      v?.legalName || v?.name || '-',
      v?.tin || '-',
      v?.taxClassification || 'VAT',
      'ACTIVE'
    ])
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            Procurement & 3-Way Matching Engine
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Purchase Order creation, Goods Receipt Notes (GRN), 3-Way Matching tolerance verification, and auto-AP bill creation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setShowMatchModal(true)}
            className="bg-amber-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-amber-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <ShieldAlert className="w-4 h-4" /> Run 3-Way Match Tool
          </button>
          <button
            onClick={() => setShowPoModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Issue Purchase Order
          </button>
        </div>
      </div>

      {/* 3-Way Matching Diagram Card */}
      <div className="bg-slate-900 text-slate-100 p-6 rounded-xl border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
          <FileCheck className="w-4 h-4" />
          Automated 3-Way Matching Architecture
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700/60 space-y-1">
            <div className="font-bold text-indigo-400">1. Purchase Order (PO)</div>
            <p className="text-slate-400">Authorized items & contracted prices agreed with registered vendor.</p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700/60 space-y-1">
            <div className="font-bold text-emerald-400">2. Goods Receipt Note (GRN)</div>
            <p className="text-slate-400">Physical inventory inspected and received at warehouse / site.</p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700/60 space-y-1">
            <div className="font-bold text-amber-400">3. Supplier Invoice</div>
            <p className="text-slate-400">Vendor bill verified within 2.0% tolerance before posting Accounts Payable.</p>
          </div>
        </div>
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
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
                {filteredVendors.map((v) => (
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
                      <button
                        onClick={() => {
                          setEditingVendor(v);
                          setShowVendorModal(true);
                        }}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1 ml-auto"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-amber-500" /> Edit
                      </button>
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
          </div>
        )}
      </div>

      {/* Create PO Modal */}
      {showPoModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
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
                      {v.code ? `[${v.code}] ` : ''}{v.legalName || v.name}
                    </option>
                  ))}
                  <option value="GENERIC-VENDOR">Generic Approved Vendor</option>
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
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Expected Total (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newPo.expectedTotal}
                    onChange={(e) => setNewPo({ ...newPo, expectedTotal: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
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
                  Create Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3-Way Matching Engine Modal */}
      {showMatchModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" /> Run 3-Way Matching Verification
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleRun3WayMatch} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">PO Number</label>
                  <input
                    type="text"
                    required
                    value={matchParams.poNumber}
                    onChange={(e) => setMatchParams({ ...matchParams, poNumber: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Vendor Invoice #</label>
                  <input
                    type="text"
                    required
                    value={matchParams.vendorInvoiceNumber}
                    onChange={(e) => setMatchParams({ ...matchParams, vendorInvoiceNumber: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">PO Amount</label>
                  <input
                    type="number"
                    required
                    value={matchParams.poAmount}
                    onChange={(e) => setMatchParams({ ...matchParams, poAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">GRN Received</label>
                  <input
                    type="number"
                    required
                    value={matchParams.grnAmount}
                    onChange={(e) => setMatchParams({ ...matchParams, grnAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Invoice Bill</label>
                  <input
                    type="number"
                    required
                    value={matchParams.vendorInvoiceAmount}
                    onChange={(e) => setMatchParams({ ...matchParams, vendorInvoiceAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
              </div>

              {matchResult && (
                <div className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                  matchResult.matched ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
                }`}>
                  <div className="font-bold flex items-center gap-1.5">
                    {matchResult.matched ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-red-600" />}
                    3-Way Matching Result: {matchResult.matched ? 'PASS (PASSED TOLERANCE)' : 'FAILED / DISCREPANCY'}
                  </div>
                  <p>{matchResult.message || (matchResult.matched ? 'Purchase Order, Goods Receipt Note, and Supplier Invoice match within tolerance.' : 'Discrepancy exceeds allowed tolerance threshold.')}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMatchModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 rounded-lg shadow-sm"
                >
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
    </div>
  );
}
