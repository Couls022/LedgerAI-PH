import React, { useState, useEffect, useMemo } from 'react';
import { 
  Boxes, Plus, RefreshCw, ArrowUpRight, ArrowDownRight, 
  TrendingUp, AlertTriangle, Layers, Tag, Activity
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import { PaginationControls } from '../../components/PaginationControls';
import { TableScrollContainer, TableDensity } from '../../components/shared/TableScrollContainer';
import TableFilterToolbar, { SortOrderDirection, DropdownOption } from '../../components/shared/TableFilterToolbar';
import RecordActivityModal from '../../components/RecordActivityModal';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';

export default function InventoryManagement() {
  const { activeCompany } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  const [newItem, setNewItem] = useState({
    itemCode: `SKU-${Date.now().toString().slice(-5)}`,
    itemName: '',
    category: 'Finished Goods',
    unitOfMeasure: 'pcs',
    unitCost: 100,
    unitPrice: 150,
    costingMethod: 'FIFO',
    reorderLevel: 10,
    initialQty: 50
  });

  const [newAdj, setNewAdj] = useState({
    itemId: '',
    adjustmentType: 'STOCK_IN',
    quantity: 10,
    unitCost: 100,
    reason: 'Inventory restock'
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Pagination & Density State (Default 20 records per page, configurable)
  const [pageSize, setPageSize] = useState(20);
  const [density, setDensity] = useState<TableDensity>('comfortable');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);

  const fetchInventory = async (cursor?: string | null, customLimit?: number) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const activeLimit = customLimit || pageSize;
      const params = new URLSearchParams();
      params.set('limit', String(activeLimit));
      if (activeCurr) params.set('cursor', activeCurr);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/operations/inventory/items?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setItems(data);
          setPaginationMeta(null);
        } else {
          setItems(data.data || []);
          setPaginationMeta(data.pagination || null);
        }
      }
    } catch (err) {
      console.error('Failed to load inventory', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    fetchInventory(null);
  }, [activeCompany?.id, searchQuery]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      fetchInventory(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevStack = [...cursorStack];
      const prevCursor = prevStack.pop() || null;
      setCursorStack(prevStack);
      setCurrentCursor(prevCursor);
      fetchInventory(prevCursor);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCursorStack([]);
    setCurrentCursor(null);
    fetchInventory(null, newSize);
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        sku: newItem.itemCode,
        name: newItem.itemName,
        description: newItem.itemName,
        category: newItem.category,
        unitOfMeasure: newItem.unitOfMeasure,
        costingMethod: newItem.costingMethod,
        unitCost: Math.round(newItem.unitCost * 100),
        sellingPrice: Math.round(newItem.unitPrice * 100),
        quantityOnHand: newItem.initialQty,
        reorderPoint: newItem.reorderLevel
      };
      
      const res = await fetch('/api/operations/inventory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowItemModal(false);
        fetchInventory();
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to create item');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating inventory item');
    }
  };

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/operations/inventory/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAdj)
      });
      if (res.ok) {
        setShowAdjModal(false);
        fetchInventory();
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to post adjustment');
      }
    } catch (err: any) {
      setError(err.message || 'Error posting stock adjustment');
    }
  };

  const categoryOptions: DropdownOption[] = useMemo(() => {
    const cats = Array.from(new Set(items.map((i: any) => i.category).filter(Boolean)));
    return cats.map(c => ({ value: c, label: c }));
  }, [items]);

  const safeItems = useMemo(() => {
    const list = Array.isArray(items)
      ? items.filter(item => !['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes((item?.status || '').toUpperCase()))
      : [];
    return list
      .filter(item => {
        if (selectedCategory && selectedCategory !== 'ALL' && item.category !== selectedCategory) {
          return false;
        }
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          (item.itemCode && item.itemCode.toLowerCase().includes(q)) ||
          (item.itemName && item.itemName.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const dateA = new Date(a.createdAt || a.updatedAt || 0).getTime();
        const dateB = new Date(b.createdAt || b.updatedAt || 0).getTime();
        if (dateA !== dateB && (dateA > 0 || dateB > 0)) {
          return sortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
        }
        const valA = (a.quantityOnHand || 0) * (a.unitCost || 0);
        const valB = (b.quantityOnHand || 0) * (b.unitCost || 0);
        return sortOrder === 'DESC' ? valB - valA : valA - valB;
      });
  }, [items, selectedCategory, searchQuery, sortOrder]);

  const totalInventoryValuation = safeItems.reduce((acc, i) => acc + ((i.quantityOnHand || 0) * ((i.unitCost || 0) / 100)), 0);

  const exportData: ExportData = {
    filename: `Inventory_Stock_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Inventory Stock Levels & Valuation Summary',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Costing Method: FIFO / Weighted Avg`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['SKU Code', 'Item Name', 'Category', 'Costing Method', 'On Hand Qty', 'Unit Cost', 'Total Valuation'],
    rows: safeItems.map(i => [
      i?.itemCode || '-',
      i?.itemName || '-',
      i?.category || '-',
      i?.costingMethod || 'FIFO',
      (i?.quantityOnHand || 0).toString(),
      `₱${((i?.unitCost || 0) / 100).toFixed(2)}`,
      `₱${((i?.quantityOnHand || 0) * ((i?.unitCost || 0) / 100)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
    ])
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Inventory Management (Stock Levels & Costing)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            FIFO & Weighted Average stock valuation, stock adjustments, and auto-generated COGS journal entries.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <ModuleArchiveInbox
            entityTypes={['INVENTORY_ITEM', 'STOCK_ADJUSTMENT']}
            moduleTitle="Inventory & Warehousing"
            description="Archived inventory SKUs and stock adjustments with 30-day retention and state-preserving restore."
            onRestored={() => fetchInventory(null)}
          />
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setShowAdjModal(true)}
            className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-xl text-xs font-semibold hover:bg-slate-200 transition-colors flex items-center gap-1.5"
          >
            <ArrowUpRight className="w-4 h-4 text-emerald-600" /> Adjust Stock / COGS
          </button>
          <button
            onClick={() => setShowItemModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Total Inventory Valuation</span>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-1">
            ₱{totalInventoryValuation.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Total SKUs Registered</span>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-1">
            {safeItems.length}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Low Stock Alerts</span>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 font-mono mt-1">
            {safeItems.filter(i => (i.quantityOnHand || 0) <= (i.reorderLevel || 5)).length}
          </div>
        </div>
      </div>

      {/* Unified Filter, Sort, Category & Search Toolbar */}
      <TableFilterToolbar
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => setSortOrder(ord)}
        productLabel="Category"
        selectedProductId={selectedCategory}
        productOptions={categoryOptions}
        onProductChange={(cat) => setSelectedCategory(cat)}
        searchQuery={searchQuery}
        onSearchChange={(q) => setSearchQuery(q)}
        searchPlaceholder="Search SKU code, item name, category..."
        filteredCount={safeItems.length}
        totalCount={paginationMeta?.totalCount}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        onResetFilters={() => {
          setSortOrder('DESC');
          setSelectedCategory('ALL');
          setSearchQuery('');
        }}
      />

      {/* Items Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching inventory items...
          </div>
        ) : (
          <TableScrollContainer
            title="Registered Inventory SKUs"
            totalRecordsCount={paginationMeta?.totalCount ?? safeItems.length}
            density={density}
            onDensityChange={setDensity}
            footer={
              <PaginationControls
                totalCount={paginationMeta?.totalCount}
                itemCount={safeItems.length}
                pageIndex={cursorStack.length}
                pageSize={pageSize}
                pageSizeOptions={[20, 50, 100]}
                onPageSizeChange={handlePageSizeChange}
                hasNextPage={!!paginationMeta?.hasNextPage}
                onNextPage={handleNextPage}
                onPrevPage={handlePrevPage}
                loading={loading}
              />
            }
          >
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900/90 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700 shadow-xs">
                <tr>
                  <th className="py-3.5 px-4">SKU Code</th>
                  <th className="py-3.5 px-4">Item Name</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4 text-center">Costing Method</th>
                  <th className="py-3.5 px-4 text-right">On Hand Qty</th>
                  <th className="py-3.5 px-4 text-right">Unit Cost</th>
                  <th className="py-3.5 px-4 text-right">Total Valuation</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {safeItems.map((item) => {
                  const val = (item.quantityOnHand || 0) * ((item.unitCost || 0) / 100);
                  const isLow = (item.quantityOnHand || 0) <= (item.reorderLevel || 5);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        {item.itemCode}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        {item.itemName}
                        {isLow && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded font-bold">
                            Low Stock
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">{item.category || 'Finished Goods'}</td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-mono rounded">
                          {item.costingMethod || 'FIFO'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                        {item.quantityOnHand || 0} {item.unitOfMeasure || 'pcs'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                        ₱{((item.unitCost || 0) / 100).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        ₱{val.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setJourneyTarget({
                            entityType: 'INVENTORY_ITEM',
                            entityId: item.id,
                            title: `Inventory Item — ${item.itemName} (${item.itemCode})`
                          })}
                          className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1 transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5" /> 360° Journey
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {safeItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No inventory items registered. Click "Add Item" to start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        )}
      </div>

      {/* Add Item Modal */}
      {showItemModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Boxes className="w-5 h-5 text-indigo-600" /> Register Inventory Item
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateItem} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Item Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Office Computer Desk"
                  value={newItem.itemName}
                  onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">SKU / Item Code</label>
                  <input
                    type="text"
                    required
                    value={newItem.itemCode}
                    onChange={(e) => setNewItem({ ...newItem, itemCode: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Costing Method</label>
                  <select
                    value={newItem.costingMethod}
                    onChange={(e) => setNewItem({ ...newItem, costingMethod: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="FIFO">FIFO (First-In, First-Out)</option>
                    <option value="WEIGHTED_AVERAGE">Weighted Average Cost</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Unit Cost (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newItem.unitCost}
                    onChange={(e) => setNewItem({ ...newItem, unitCost: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Initial Stock Qty</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newItem.initialQty}
                    onChange={(e) => setNewItem({ ...newItem, initialQty: parseInt(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-emerald-600" /> Stock Adjustment & COGS Entry
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateAdjustment} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Select Item</label>
                <select
                  required
                  value={newAdj.itemId}
                  onChange={(e) => setNewAdj({ ...newAdj, itemId: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="">Select inventory item...</option>
                  {safeItems.map(i => (
                    <option key={i.id} value={i.id}>{i.itemCode} - {i.itemName} (On Hand: {i.quantityOnHand})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Type</label>
                  <select
                    value={newAdj.adjustmentType}
                    onChange={(e) => setNewAdj({ ...newAdj, adjustmentType: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="STOCK_IN">Stock In (+)</option>
                    <option value="STOCK_OUT">Stock Out (- COGS)</option>
                    <option value="SCRAP">Scrap / Loss (- Exp)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newAdj.quantity}
                    onChange={(e) => setNewAdj({ ...newAdj, quantity: parseInt(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Reason / Reference</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sales dispatch COGS or Stock Take"
                  value={newAdj.reason}
                  onChange={(e) => setNewAdj({ ...newAdj, reason: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdjModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-sm"
                >
                  Post Adjustment & GL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enterprise 360° Record Journey Modal */}
      {journeyTarget && (
        <RecordActivityModal
          isOpen={!!journeyTarget}
          onClose={() => setJourneyTarget(null)}
          entityType={journeyTarget.entityType}
          entityId={journeyTarget.entityId}
          title={journeyTarget.title}
          onActionSuccess={() => fetchInventory()}
        />
      )}
    </div>
  );
}
