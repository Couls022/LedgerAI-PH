import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Building2, Layers, FolderKanban, Briefcase, X, CheckCircle2, Filter } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import TableFilterToolbar, { SortOrderDirection } from '../../components/shared/TableFilterToolbar';
import { PaginationControls } from '../../components/PaginationControls';

export default function CostCentersList() {
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCostCenter, setEditingCostCenter] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'COST_CENTER' | 'DEPARTMENT' | 'PROJECT'>('ALL');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [pageSize, setPageSize] = useState(20);
  const [pageIndex, setPageIndex] = useState(0);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    dimensionType: 'COST_CENTER',
    status: 'ACTIVE'
  });

  const fetchCostCenters = () => {
    setLoading(true);
    apiFetch('/api/master-data/cost-centers')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCostCenters(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchCostCenters();
  }, []);

  const inferDimensionType = (item: any): 'COST_CENTER' | 'DEPARTMENT' | 'PROJECT' => {
    if (item.dimensionType) return item.dimensionType;
    const code = (item.code || '').toUpperCase();
    const name = (item.name || '').toUpperCase();
    if (code.startsWith('DEP') || name.includes('DEPARTMENT') || name.includes('DEPT')) return 'DEPARTMENT';
    if (code.startsWith('PRJ') || code.startsWith('PROJ') || name.includes('PROJECT')) return 'PROJECT';
    return 'COST_CENTER';
  };

  const handleOpenAdd = (defaultType: 'COST_CENTER' | 'DEPARTMENT' | 'PROJECT' = 'COST_CENTER') => {
    setEditingCostCenter(null);
    const prefix = defaultType === 'DEPARTMENT' ? 'DEPT-' : defaultType === 'PROJECT' ? 'PRJ-' : 'CC-';
    setFormData({
      code: `${prefix}${String(costCenters.length + 1).padStart(3, '0')}`,
      name: '',
      dimensionType: defaultType,
      status: 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleOpenEdit = (costCenter: any) => {
    setEditingCostCenter(costCenter);
    setFormData({
      code: costCenter.code || '',
      name: costCenter.name || '',
      dimensionType: inferDimensionType(costCenter),
      status: costCenter.status || 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const endpoint = editingCostCenter?.id
        ? `/api/master-data/cost-centers/${encodeURIComponent(editingCostCenter.id)}`
        : '/api/master-data/cost-centers';
      const method = editingCostCenter?.id ? 'PUT' : 'POST';

      await apiFetch(endpoint, {
        method,
        body: JSON.stringify({
          code: formData.code,
          name: formData.name,
          status: formData.status
        })
      });
      setShowModal(false);
      fetchCostCenters();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const enrichedItems = useMemo(() => {
    return costCenters.map(c => ({
      ...c,
      inferredType: inferDimensionType(c)
    }));
  }, [costCenters]);

  const filteredItems = useMemo(() => {
    const list = enrichedItems.filter(item => {
      if (categoryFilter !== 'ALL' && item.inferredType !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          (item.code || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          item.inferredType.toLowerCase().includes(q)
        );
      }
      return true;
    });

    return list.sort((a, b) => {
      const codeA = (a.code || '').toUpperCase();
      const codeB = (b.code || '').toUpperCase();
      if (sortOrder === 'ASC') {
        return codeA.localeCompare(codeB);
      }
      return codeB.localeCompare(codeA);
    });
  }, [enrichedItems, categoryFilter, searchQuery, sortOrder]);

  const paginatedItems = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, pageIndex, pageSize]);

  const counts = useMemo(() => ({
    all: enrichedItems.length,
    costCenters: enrichedItems.filter(i => i.inferredType === 'COST_CENTER').length,
    departments: enrichedItems.filter(i => i.inferredType === 'DEPARTMENT').length,
    projects: enrichedItems.filter(i => i.inferredType === 'PROJECT').length,
  }), [enrichedItems]);

  return (
    <div className="space-y-5">
      {/* Enterprise Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-[#111827] p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">
            <Layers className="w-4 h-4" />
            <span>Organizational Dimensions & Cost Accounting</span>
          </div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
            Organizational Dimensions, Cost Centers & Projects
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Unified authoritative registry for Cost Centers, Operating Departments, and Capital Projects consumed by General Ledger & Budget Planning.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button 
            onClick={() => handleOpenAdd('DEPARTMENT')}
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Briefcase className="w-3.5 h-3.5 text-blue-500" /> + Department
          </button>
          <button 
            onClick={() => handleOpenAdd('PROJECT')}
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FolderKanban className="w-3.5 h-3.5 text-emerald-500" /> + Project
          </button>
          <button 
            onClick={() => handleOpenAdd('COST_CENTER')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Cost Center
          </button>
        </div>
      </div>

      {/* Dimension KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cost Centers</span>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{counts.costCenters}</p>
            <span className="text-[11px] text-slate-500">Responsibility & expense units</span>
          </div>
          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <Building2 className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Departments</span>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{counts.departments}</p>
            <span className="text-[11px] text-slate-500">Organizational divisions</span>
          </div>
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
            <Briefcase className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Projects</span>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{counts.projects}</p>
            <span className="text-[11px] text-slate-500">Capital & revenue initiatives</span>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <FolderKanban className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <TableFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPageIndex(0);
        }}
        searchPlaceholder="Search code, dimension name..."
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => {
          setSortOrder(ord);
          setPageIndex(0);
        }}
        productLabel="Dimension Type"
        selectedProductId={categoryFilter}
        onProductChange={(val) => {
          setCategoryFilter(val as any);
          setPageIndex(0);
        }}
        productOptions={[
          { label: `All Dimensions (${counts.all})`, value: 'ALL' },
          { label: `Cost Centers (${counts.costCenters})`, value: 'COST_CENTER' },
          { label: `Departments (${counts.departments})`, value: 'DEPARTMENT' },
          { label: `Projects (${counts.projects})`, value: 'PROJECT' },
        ]}
        pageSize={pageSize}
        onPageSizeChange={(sz) => {
          setPageSize(sz);
          setPageIndex(0);
        }}
        totalCount={enrichedItems.length}
        filteredCount={filteredItems.length}
        onResetFilters={() => {
          setSearchQuery('');
          setSortOrder('DESC');
          setCategoryFilter('ALL');
          setPageSize(20);
          setPageIndex(0);
        }}
      />
      
      {/* Dimensions Table */}
      <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
            <span className="animate-spin text-indigo-600 font-bold">●</span> Loading organizational dimensions...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Building2 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-600 dark:text-slate-300 font-bold text-sm">No matching organizational dimensions found</p>
            <p className="text-slate-400 text-xs mt-1">Create a Cost Center (`CC-`), Department (`DEPT-`), or Project (`PRJ-`) to begin tracking.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm min-w-[750px]">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800 text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3.5 font-bold">Dimension Code</th>
                  <th className="px-4 py-3.5 font-bold">Dimension Name</th>
                  <th className="px-4 py-3.5 font-bold">Classification</th>
                  <th className="px-4 py-3.5 font-bold">Status</th>
                  <th className="px-4 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {paginatedItems.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{c.code}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-800 dark:text-slate-200">{c.name}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      c.inferredType === 'DEPARTMENT'
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        : c.inferredType === 'PROJECT'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                    }`}>
                      {c.inferredType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.status === 'ACTIVE' 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-right">
                    <button 
                      onClick={() => handleOpenEdit(c)}
                      className="text-indigo-600 dark:text-indigo-400 font-bold text-xs hover:underline cursor-pointer"
                    >
                      Edit Dimension
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        <PaginationControls
          totalCount={filteredItems.length}
          itemCount={paginatedItems.length}
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[20, 50, 100]}
          hasNextPage={(pageIndex + 1) * pageSize < filteredItems.length}
          onNextPage={() => setPageIndex((p) => p + 1)}
          onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
          onFirstPage={() => setPageIndex(0)}
          onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredItems.length / pageSize) - 1))}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPageIndex(0);
          }}
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg my-8">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {editingCostCenter ? 'Edit Organizational Dimension' : 'Create Organizational Dimension'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-xs">
                  {error}
                </div>
              )}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Dimension Classification</label>
                  <select
                    value={formData.dimensionType}
                    onChange={e => {
                      const newType = e.target.value as 'COST_CENTER' | 'DEPARTMENT' | 'PROJECT';
                      const prefix = newType === 'DEPARTMENT' ? 'DEPT-' : newType === 'PROJECT' ? 'PRJ-' : 'CC-';
                      setFormData({
                        ...formData,
                        dimensionType: newType,
                        code: editingCostCenter ? formData.code : `${prefix}${String(costCenters.length + 1).padStart(3, '0')}`
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="COST_CENTER">Cost Center (CC-)</option>
                    <option value="DEPARTMENT">Operating Department (DEPT-)</option>
                    <option value="PROJECT">Capital / Client Project (PRJ-)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Dimension Code *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.code} 
                    onChange={e => setFormData({...formData, code: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. CC-001, DEPT-FIN, PRJ-2026"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Dimension Name *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. Finance & Treasury Division"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Status</label>
                  <select 
                    value={formData.status} 
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
              </div>
              
              <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200 dark:border-slate-800 mt-6">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Dimension'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

