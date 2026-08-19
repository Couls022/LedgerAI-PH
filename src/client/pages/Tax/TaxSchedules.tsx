import React, { useEffect, useState } from 'react';
import { Calculator, Search, RefreshCw, Filter, Calendar } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import { apiFetch } from '../../utils/apiClient';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

export default function TaxSchedules() {
  const { activeCompany } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const [sRes, pRes] = await Promise.all([
        apiFetch<any>(`/api/tax/schedules/vat-sales?${params.toString()}`),
        apiFetch<any>(`/api/tax/schedules/vat-purchases?${params.toString()}`)
      ]);

      setSales(sRes.data || []);
      setPurchases(pRes.data || []);
    } catch (err) {
      console.error('Failed to fetch VAT schedules:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const totalSalesBase = sales.reduce((acc, x) => acc + (x.taxBase || 0), 0);
  const totalOutputVat = sales.reduce((acc, x) => acc + (x.outputVat || 0), 0);
  const totalPurchasesBase = purchases.reduce((acc, x) => acc + (x.taxBase || 0), 0);
  const totalInputVat = purchases.reduce((acc, x) => acc + (x.inputVat || 0), 0);

  const filteredSales = sales.filter(s => 
    (s.invoiceNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.tin || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPurchases = purchases.filter(p => 
    (p.billNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.vendorName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.tin || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const exportData: ExportData = {
    filename: `VAT_Schedule_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'VAT Sales & Purchases Schedule (BIR Form 2550M/Q)',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Audit Verified`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Schedule Type', 'Document #', 'Date', 'Entity Name', 'TIN', 'Tax Base (PHP)', 'VAT Amount (PHP)'],
    rows: [
      ...sales.map(s => ['OUTPUT VAT SALES', s.invoiceNumber, s.invoiceDate, s.customerName, s.tin || 'N/A', (s.taxBase / 100).toFixed(2), (s.outputVat / 100).toFixed(2)]),
      ...purchases.map(p => ['INPUT VAT PURCHASES', p.billNumber, p.billDate, p.vendorName, p.tin || 'N/A', (p.taxBase / 100).toFixed(2), (p.inputVat / 100).toFixed(2)]),
    ],
    totals: ['NET VAT PAYABLE', '', '', '', '', ((totalSalesBase - totalPurchasesBase) / 100).toFixed(2), ((totalOutputVat - totalInputVat) / 100).toFixed(2)],
    orientation: 'landscape'
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calculator className="w-5 h-5 text-emerald-600" /> VAT Sales & Purchases Schedules
          </h2>
          <p className="text-slate-500 text-xs mt-1">Detailed statutory schedules of Output VAT on Sales and Input VAT on Purchases with traceable source documents.</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            />
            <span className="text-slate-400">to</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            />
          </div>
          <button
            onClick={fetchData}
            className="p-2 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <ExportButton data={exportData} disabled={loading} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase">Total Output VAT (Sales)</p>
          <p className="text-2xl font-bold text-emerald-600 font-mono mt-1">{formatCurrency(totalOutputVat)}</p>
          <p className="text-xs text-slate-400 mt-1">Tax Base: {formatCurrency(totalSalesBase)} ({sales.length} Invoices)</p>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase">Total Input VAT (Purchases)</p>
          <p className="text-2xl font-bold text-indigo-600 font-mono mt-1">{formatCurrency(totalInputVat)}</p>
          <p className="text-xs text-slate-400 mt-1">Tax Base: {formatCurrency(totalPurchasesBase)} ({purchases.length} Bills)</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('sales')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'sales' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'}`}
            >
              VAT Sales Schedule ({sales.length})
            </button>
            <button
              onClick={() => setActiveTab('purchases')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'purchases' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'}`}
            >
              VAT Purchases Schedule ({purchases.length})
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder={activeTab === 'sales' ? "Search by invoice # or customer..." : "Search by bill # or vendor..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg w-72 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading VAT schedules...
          </div>
        ) : activeTab === 'sales' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[750px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b">
                <tr>
                  <th className="py-3 px-3">Invoice #</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Customer Name</th>
                  <th className="py-3 px-3">Customer TIN</th>
                  <th className="py-3 px-3 text-right">Tax Base</th>
                  <th className="py-3 px-3 text-right">Output VAT (12%)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredSales.map(s => (
                  <tr key={s.invoiceId} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-mono font-bold text-xs">{s.invoiceNumber}</td>
                    <td className="py-3 px-3 text-xs">{s.invoiceDate}</td>
                    <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-100">{s.customerName}</td>
                    <td className="py-3 px-3 font-mono text-xs text-slate-500">{s.tin || 'N/A'}</td>
                    <td className="py-3 px-3 text-right font-mono">{formatCurrency(s.taxBase)}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-600">{formatCurrency(s.outputVat)}</td>
                  </tr>
                ))}
                {filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">No matching sales invoices found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[750px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b">
                <tr>
                  <th className="py-3 px-3">Bill #</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Vendor Name</th>
                  <th className="py-3 px-3">Vendor TIN</th>
                  <th className="py-3 px-3 text-right">Tax Base</th>
                  <th className="py-3 px-3 text-right">Input VAT (12%)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredPurchases.map(p => (
                  <tr key={p.billId} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-mono font-bold text-xs">{p.billNumber}</td>
                    <td className="py-3 px-3 text-xs">{p.billDate}</td>
                    <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-100">{p.vendorName}</td>
                    <td className="py-3 px-3 font-mono text-xs text-slate-500">{p.tin || 'N/A'}</td>
                    <td className="py-3 px-3 text-right font-mono">{formatCurrency(p.taxBase)}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-indigo-600">{formatCurrency(p.inputVat)}</td>
                  </tr>
                ))}
                {filteredPurchases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">No matching purchase bills found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
