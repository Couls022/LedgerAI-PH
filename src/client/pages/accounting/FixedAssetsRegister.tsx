import React, { useState, useEffect } from 'react';
import { 
  Building2, Plus, RefreshCw, Calculator, TrendingDown, 
  Clock, ShieldCheck, DollarSign, Search, Activity
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import { PaginationControls } from '../../components/PaginationControls';
import TableFilterToolbar, { SortOrderDirection, DropdownOption } from '../../components/shared/TableFilterToolbar';
import RecordActivityModal from '../../components/RecordActivityModal';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';

export default function FixedAssetsRegister() {
  const { activeCompany } = useAuth();
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [journeyTarget, setJourneyTarget] = useState<{ entityType: string; entityId: string; title: string } | null>(null);

  // Pagination State (Default 20 per page)
  const [pageSize, setPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);

  const [depPeriodMonth, setDepPeriodMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [postingDep, setPostingDep] = useState(false);
  const [depError, setDepError] = useState<string | null>(null);
  const [depSuccess, setDepSuccess] = useState<string | null>(null);

  const [isCustomCategory, setIsCustomCategory] = useState(false);

  const handlePostDepreciation = async () => {
    setPostingDep(true);
    setDepError(null);
    setDepSuccess(null);
    try {
      const res = await fetch('/api/operations/depreciation/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodMonth: depPeriodMonth })
      });
      const data = await res.json();
      if (res.ok) {
        setDepSuccess(data.message || `Successfully posted monthly depreciation schedules for ${depPeriodMonth}.`);
        fetchAssets();
      } else {
        setDepError(data.error || 'Failed to post depreciation schedules');
      }
    } catch (err: any) {
      setDepError(err.message || 'Error executing depreciation run');
    } finally {
      setPostingDep(false);
    }
  };

  const [newAsset, setNewAsset] = useState({
    assetCode: `FA-${Date.now().toString().slice(-4)}`,
    assetName: '',
    category: 'Equipment',
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionCost: 100000,
    salvageValue: 10000,
    usefulLifeYears: 5,
    depreciationMethod: 'STRAIGHT_LINE'
  });

  const fetchAssets = async (cursor?: string | null, customLimit?: number) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const activeLimit = customLimit || pageSize;
      const params = new URLSearchParams();
      params.set('limit', String(activeLimit));
      if (activeCurr) params.set('cursor', activeCurr);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/operations/fixed-assets?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setAssets(data);
          setPaginationMeta(null);
        } else {
          setAssets(data.data || []);
          setPaginationMeta(data.pagination || null);
        }
      }
    } catch (err) {
      console.error('Failed to load fixed assets', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    fetchAssets(null);
  }, [activeCompany?.id, searchQuery]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      fetchAssets(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevStack = [...cursorStack];
      const prevCursor = prevStack.pop() || null;
      setCursorStack(prevStack);
      setCurrentCursor(prevCursor);
      fetchAssets(prevCursor);
    }
  };

  const rawAssets = Array.isArray(assets) ? assets : [];
  
  const defaultCategories = ['Equipment', 'Vehicles', 'Furniture & Fixtures', 'Leasehold Improvements', 'Buildings'];
  const existingCategories = Array.from(new Set(rawAssets.map(a => a.category).filter(Boolean))) as string[];
  const allCategories = Array.from(new Set([...defaultCategories, ...existingCategories]));

  const categoryOptions: DropdownOption[] = React.useMemo(() => {
    return allCategories.map(c => ({ value: c, label: c }));
  }, [allCategories]);

  const safeAssets = React.useMemo(() => {
    const list = rawAssets.filter(a => !['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes((a?.status || '').toUpperCase()));
    return list
      .filter(a => {
        if (selectedCategory && selectedCategory !== 'ALL' && a.category !== selectedCategory) {
          return false;
        }
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          (a.assetCode || '').toLowerCase().includes(q) ||
          (a.assetName || '').toLowerCase().includes(q) ||
          (a.category || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const costA = Number(a.acquisitionCost || 0);
        const costB = Number(b.acquisitionCost || 0);
        return sortOrder === 'DESC' ? costB - costA : costA - costB;
      });
  }, [rawAssets, selectedCategory, searchQuery, sortOrder]);

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/operations/fixed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAsset)
      });
      if (res.ok) {
        setShowAssetModal(false);
        setIsCustomCategory(false);
        fetchAssets();
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to add asset');
      }
    } catch (err: any) {
      setError(err.message || 'Error adding asset');
    }
  };

  const filteredAssets = safeAssets.filter(a => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const code = (a?.assetCode || '').toLowerCase();
    const name = (a?.assetName || '').toLowerCase();
    const cat = (a?.category || '').toLowerCase();
    return code.includes(q) || name.includes(q) || cat.includes(q);
  });

  const totalCost = safeAssets.reduce((acc, a) => acc + (a.acquisitionCost || 0), 0);
  const totalDepreciation = safeAssets.reduce((acc, a) => acc + (a.accumulatedDepreciation || 0), 0);
  const totalNetBookValue = totalCost - totalDepreciation;

  const exportData: ExportData = {
    filename: `Fixed_Assets_Register_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Fixed Assets & Depreciation Schedule Register',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Property, Plant & Equipment`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Asset Code', 'Asset Name', 'Category', 'Acquisition Cost', 'Accumulated Depr.', 'Net Book Value'],
    rows: safeAssets.map(a => {
      const cost = a?.acquisitionCost || 0;
      const dep = a?.accumulatedDepreciation || 0;
      return [
        a?.assetCode || '-',
        a?.assetName || '-',
        a?.category || '-',
        `₱${cost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        `₱${dep.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        `₱${(cost - dep).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
      ];
    })
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Fixed Assets Register (Depreciation Schedules)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Capitalization of Property, Plant & Equipment (PPE), straight-line depreciation schedules, and monthly GL posting.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <ModuleArchiveInbox
            entityTypes={['FIXED_ASSET']}
            moduleTitle="Fixed Assets Register"
            description="Archived Property, Plant & Equipment (PPE) assets with 30-day retention and state-preserving restore."
            onRestored={() => fetchAssets(null)}
          />
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => {
              setIsCustomCategory(false);
              setShowAssetModal(true);
            }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Capitalize Fixed Asset
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Total Asset Acquisition Cost</span>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-1">
            ₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Accumulated Depreciation</span>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 font-mono mt-1">
            ₱{totalDepreciation.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Net Book Value (NBV)</span>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-1">
            ₱{totalNetBookValue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Post Monthly Depreciation Section */}
      <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Monthly Depreciation General Ledger Posting
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Execute straight-line depreciation calculations and post adjusting entries directly to the General Ledger.
          </p>
          {depError && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-2.5 rounded-lg text-xs text-red-700 dark:text-red-400 mt-2 font-medium">
              Error: {depError}
            </div>
          )}
          {depSuccess && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 p-2.5 rounded-lg text-xs text-emerald-700 dark:text-emerald-400 mt-2 font-medium">
              Success: {depSuccess}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Target Month:</label>
            <input
              type="month"
              value={depPeriodMonth}
              onChange={(e) => {
                setDepPeriodMonth(e.target.value);
                setDepError(null);
                setDepSuccess(null);
              }}
              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
            />
          </div>

          <button
            onClick={handlePostDepreciation}
            disabled={postingDep || !depPeriodMonth}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
          >
            {postingDep ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Posting to GL...
              </>
            ) : (
              <>
                <Calculator className="w-3.5 h-3.5" />
                Post Monthly Depreciation
              </>
            )}
          </button>
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
        searchPlaceholder="Search fixed assets by code, name, category..."
        filteredCount={safeAssets.length}
        totalCount={paginationMeta?.totalCount}
        pageSize={pageSize}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setCursorStack([]);
          setCurrentCursor(null);
          fetchAssets(null, newSize);
        }}
        onResetFilters={() => {
          setSortOrder('DESC');
          setSelectedCategory('ALL');
          setSearchQuery('');
        }}
      />

      {/* Assets Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching fixed assets register...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[850px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Asset Code</th>
                  <th className="py-3.5 px-4">Asset Description</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4 text-center">Life (Yrs)</th>
                  <th className="py-3.5 px-4 text-right">Cost (PHP)</th>
                  <th className="py-3.5 px-4 text-right">Accumulated Depr.</th>
                  <th className="py-3.5 px-4 text-right">Net Book Value</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredAssets.map((asset) => {
                  const cost = asset.acquisitionCost || 0;
                  const accDep = asset.accumulatedDepreciation || 0;
                  const nbv = cost - accDep;
                  return (
                    <tr key={asset.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        {asset.assetCode}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100">
                        {asset.assetName}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">{asset.category}</td>
                      <td className="py-3.5 px-4 text-center font-mono text-xs">{asset.usefulLifeYears || 5} yrs</td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                        ₱{cost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-amber-600 dark:text-amber-400">
                        ₱{accDep.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        ₱{nbv.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setJourneyTarget({
                            entityType: 'FIXED_ASSET',
                            entityId: asset.id,
                            title: `Fixed Asset — ${asset.assetName} (${asset.assetCode})`
                          })}
                          className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1 transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5" /> 360° Journey
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredAssets.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No matching fixed assets found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {paginationMeta && (
          <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50/50 dark:bg-slate-900/40">
            <PaginationControls
              totalCount={paginationMeta.totalCount}
              itemCount={filteredAssets.length}
              pageIndex={cursorStack.length}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setCursorStack([]);
                setCurrentCursor(null);
                fetchAssets(null, newSize);
              }}
              hasNextPage={paginationMeta.hasNextPage}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
              loading={loading}
            />
          </div>
        )}
      </div>

      {/* Capitalize Asset Modal */}
      {showAssetModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" /> Capitalize Fixed Asset
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateAsset} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Asset Name / Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Delivery Truck / Office Laptop"
                  value={newAsset.assetName}
                  onChange={(e) => setNewAsset({ ...newAsset, assetName: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Asset Code</label>
                  <input
                    type="text"
                    required
                    value={newAsset.assetCode}
                    onChange={(e) => setNewAsset({ ...newAsset, assetCode: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Category</label>
                  {!isCustomCategory ? (
                    <select
                      value={newAsset.category}
                      onChange={(e) => {
                        if (e.target.value === '__ADD_NEW__') {
                          setIsCustomCategory(true);
                          setNewAsset({ ...newAsset, category: '' });
                        } else {
                          setNewAsset({ ...newAsset, category: e.target.value });
                        }
                      }}
                      className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    >
                      {allCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="__ADD_NEW__" className="font-bold text-indigo-600 dark:text-indigo-400">+ Add New Category...</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter custom category"
                        required
                        value={newAsset.category}
                        onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value })}
                        className="w-full text-xs p-2.5 border border-indigo-300 dark:border-indigo-600 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(false);
                          setNewAsset({ ...newAsset, category: 'Equipment' });
                        }}
                        className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Acquisition Cost (PHP)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newAsset.acquisitionCost}
                    onChange={(e) => setNewAsset({ ...newAsset, acquisitionCost: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Useful Life (Years)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newAsset.usefulLifeYears}
                    onChange={(e) => setNewAsset({ ...newAsset, usefulLifeYears: parseInt(e.target.value) || 5 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAssetModal(false);
                    setIsCustomCategory(false);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Capitalize Asset
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
          onActionSuccess={() => fetchAssets()}
        />
      )}
    </div>
  );
}
