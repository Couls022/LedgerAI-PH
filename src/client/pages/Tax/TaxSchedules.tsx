import React, { useEffect, useState, useMemo } from 'react';
import { Calculator, RefreshCw, Info } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import { apiFetch } from '../../utils/apiClient';
import { getBirTaxProfileRules } from '../../../shared/taxProfile';
import { TableScrollContainer } from '../../components/shared/TableScrollContainer';
import TableFilterToolbar, {
  DatePeriodFilter,
  computePeriodDates,
  SortOrderDirection,
} from '../../components/shared/TableFilterToolbar';

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
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [datePeriod, setDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Pagination state: Default 20 rows, customizable to 25, 50, 100, custom
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [sRes, pRes] = await Promise.all([
        apiFetch<any>('/api/tax/schedules/vat-sales'),
        apiFetch<any>('/api/tax/schedules/vat-purchases')
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
    setPageIndex(0);
    fetchData();
  }, [activeCompany?.id]);

  const vatStatus = activeCompany?.vatStatus || 'VAT';
  const profileRules = getBirTaxProfileRules(activeCompany?.taxpayerClassification, vatStatus);
  const isVatRegistered = profileRules.isVatRegistered && !profileRules.isVatExempt;

  const totalSalesBase = sales.reduce((acc, x) => acc + (x.taxBase || 0), 0);
  const totalOutputVat = sales.reduce((acc, x) => acc + (x.outputVat || 0), 0);
  const totalPurchasesBase = purchases.reduce((acc, x) => acc + (x.taxBase || 0), 0);
  const totalInputVat = purchases.reduce((acc, x) => acc + (x.inputVat || 0), 0);

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const dateRange = datePeriod === 'CUSTOM'
      ? { fromDate, toDate }
      : computePeriodDates(datePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;

    const list = sales.filter(s => {
      if (from && s.invoiceDate && s.invoiceDate < from) return false;
      if (to && s.invoiceDate && s.invoiceDate > to) return false;
      if (!q) return true;
      return (
        (s.invoiceNumber || '').toLowerCase().includes(q) ||
        (s.customerName || '').toLowerCase().includes(q) ||
        (s.tin || '').toLowerCase().includes(q)
      );
    });

    return list.sort((a, b) => {
      const dateA = a.invoiceDate || '';
      const dateB = b.invoiceDate || '';
      if (sortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [sales, searchQuery, datePeriod, fromDate, toDate, sortOrder]);

  const filteredPurchases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const dateRange = datePeriod === 'CUSTOM'
      ? { fromDate, toDate }
      : computePeriodDates(datePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;

    const list = purchases.filter(p => {
      if (from && p.billDate && p.billDate < from) return false;
      if (to && p.billDate && p.billDate > to) return false;
      if (!q) return true;
      return (
        (p.billNumber || '').toLowerCase().includes(q) ||
        (p.vendorName || '').toLowerCase().includes(q) ||
        (p.tin || '').toLowerCase().includes(q)
      );
    });

    return list.sort((a, b) => {
      const dateA = a.billDate || '';
      const dateB = b.billDate || '';
      if (sortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [purchases, searchQuery, datePeriod, fromDate, toDate, sortOrder]);

  const activeRecords = activeTab === 'sales' ? filteredSales : filteredPurchases;
  const pagedRecords = useMemo(() => {
    return activeRecords.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }, [activeRecords, pageIndex, pageSize]);

  const exportData: ExportData = {
    filename: `VAT_Schedule_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'VAT Sales & Purchases Schedule (BIR Form 2550M/Q)',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Audit Verified`,
    companyName: activeCompany?.legalName || 'Active Company',
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
          <button
            onClick={fetchData}
            className="p-2 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <ExportButton data={exportData} disabled={loading} />
        </div>
      </div>

      {!isVatRegistered && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            Active taxpayer profile is classified as <strong>{vatStatus}</strong> ({activeCompany?.taxpayerClassification || 'CORPORATION'}). Output/Input VAT amounts remain ₱0.00 unless VAT-registered.
          </span>
        </div>
      )}

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
              onClick={() => { setActiveTab('sales'); setPageIndex(0); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'sales' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'}`}
            >
              VAT Sales Schedule ({filteredSales.length})
            </button>
            <button
              onClick={() => { setActiveTab('purchases'); setPageIndex(0); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'purchases' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'}`}
            >
              VAT Purchases Schedule ({filteredPurchases.length})
            </button>
          </div>
        </div>

        <TableFilterToolbar
          searchQuery={searchQuery}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setPageIndex(0);
          }}
          searchPlaceholder={activeTab === 'sales' ? "Search by invoice #, customer name, TIN..." : "Search by bill #, vendor name, TIN..."}
          sortOrder={sortOrder}
          onSortOrderChange={(ord) => {
            setSortOrder(ord);
            setPageIndex(0);
          }}
          datePeriod={datePeriod}
          onDatePeriodChange={(p) => {
            setDatePeriod(p);
            setPageIndex(0);
          }}
          fromDate={fromDate}
          toDate={toDate}
          onDateRangeChange={({ fromDate, toDate }) => {
            setFromDate(fromDate);
            setToDate(toDate);
            setPageIndex(0);
          }}
          pageSize={pageSize}
          onPageSizeChange={(sz) => {
            setPageSize(sz);
            setPageIndex(0);
          }}
          totalCount={activeTab === 'sales' ? sales.length : purchases.length}
          filteredCount={activeRecords.length}
          onResetFilters={() => {
            setSearchQuery('');
            setSortOrder('DESC');
            setDatePeriod('ALL');
            setFromDate('');
            setToDate('');
            setPageSize(20);
            setPageIndex(0);
          }}
        />

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading VAT schedules...
          </div>
        ) : (
          <TableScrollContainer
            maxHeight="calc(100vh - 360px)"
            minHeight="280px"
            stickyHeader={true}
            title={activeTab === 'sales' ? `VAT Sales Schedule (${filteredSales.length})` : `VAT Purchases Schedule (${filteredPurchases.length})`}
            totalRecordsCount={activeRecords.length}
            pagination={{
              pageIndex,
              pageSize,
              pageSizeOptions: [20, 25, 50, 100],
              totalRecords: activeRecords.length,
              itemCount: pagedRecords.length,
              onPageChange: setPageIndex,
              onPageSizeChange: (newSize) => {
                setPageSize(newSize);
                setPageIndex(0);
              },
              loading,
            }}
          >
            {activeTab === 'sales' ? (
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[750px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b">
                  <tr>
                    <th className="py-3 px-3">Invoice #</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Customer Name</th>
                    <th className="py-3 px-3">Customer TIN</th>
                    <th className="py-3 px-3 text-right">Tax Base</th>
                    <th className="py-3 px-3 text-right">{isVatRegistered ? 'Output VAT (12%)' : 'Output VAT (Non-VAT)'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedRecords.map((s: any) => (
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
            ) : (
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[750px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold border-b">
                  <tr>
                    <th className="py-3 px-3">Bill #</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Vendor Name</th>
                    <th className="py-3 px-3">Vendor TIN</th>
                    <th className="py-3 px-3 text-right">Tax Base</th>
                    <th className="py-3 px-3 text-right">{isVatRegistered ? 'Input VAT (12%)' : 'Input VAT (Non-VAT)'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedRecords.map((p: any) => (
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
            )}
          </TableScrollContainer>
        )}
      </div>
    </div>
  );
}
