import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, FileText, X, Archive } from 'lucide-react';
import { filterEligibleTaxControlAccounts, formatAccountOptionLabel } from '../../../shared/coaAccountUtils';
import ModuleArchiveInbox from '../../components/ModuleArchiveInbox';
import { apiFetch } from '../../utils/apiClient';
import TableFilterToolbar, { SortOrderDirection } from '../../components/shared/TableFilterToolbar';
import { PaginationControls } from '../../components/PaginationControls';

export default function TaxCodesList() {
  const [taxCodes, setTaxCodes] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTaxCode, setEditingTaxCode] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaxType, setSelectedTaxType] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<SortOrderDirection>('DESC');
  const [pageSize, setPageSize] = useState(20);
  const [pageIndex, setPageIndex] = useState(0);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    taxType: 'VAT',
    inputOutputDirection: 'INPUT',
    accountId: '',
    description: '',
    status: 'ACTIVE'
  });

  const eligibleTaxAccounts = useMemo(
    () => filterEligibleTaxControlAccounts(accounts, formData.taxType, formData.inputOutputDirection),
    [accounts, formData.taxType, formData.inputOutputDirection]
  );

  const fetchAccounts = () => {
    apiFetch<any[]>('/api/master-data/accounts?raw=true')
      .then(data => {
        if (Array.isArray(data)) setAccounts(data);
      })
      .catch(() => setAccounts([]));
  };

  const fetchTaxCodes = () => {
    setLoading(true);
    apiFetch<any[]>('/api/master-data/tax-codes')
      .then(data => {
        if (Array.isArray(data)) setTaxCodes(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err?.message || 'Unable to load tax codes.');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTaxCodes();
    fetchAccounts();
    const handleCoaUpdated = () => fetchAccounts();
    window.addEventListener('coa:updated', handleCoaUpdated);
    return () => window.removeEventListener('coa:updated', handleCoaUpdated);
  }, []);

  const handleOpenAdd = () => {
    fetchAccounts();
    setEditingTaxCode(null);
    setFormData({
      code: '',
      name: '',
      taxType: 'VAT',
      inputOutputDirection: 'INPUT',
      accountId: '',
      description: '',
      status: 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleOpenEdit = (taxCode: any) => {
    fetchAccounts();
    setEditingTaxCode(taxCode);
    setFormData({
      code: taxCode.code || '',
      name: taxCode.name || '',
      taxType: taxCode.taxType || 'VAT',
      inputOutputDirection: taxCode.inputOutputDirection || 'INPUT',
      accountId: taxCode.accountId || '',
      description: taxCode.description || '',
      status: taxCode.status || 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const url = editingTaxCode 
      ? `/api/master-data/tax-codes/${editingTaxCode.id}` 
      : '/api/master-data/tax-codes';
    const method = editingTaxCode ? 'PUT' : 'POST';

    try {
      await apiFetch(url, {
        method,
        body: JSON.stringify(formData)
      });
      setShowModal(false);
      fetchTaxCodes();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const visibleTaxCodes = useMemo(
    () => taxCodes.filter((c) => String(c.status || 'ACTIVE').toUpperCase() !== 'ARCHIVED'),
    [taxCodes]
  );

  const taxTypeOptions = useMemo(() => {
    const set = new Set<string>();
    visibleTaxCodes.forEach((c) => {
      if (c.taxType) set.add(c.taxType);
    });
    return [
      { label: 'All Tax Types', value: 'ALL' },
      ...Array.from(set).sort().map((t) => ({ label: t, value: t }))
    ];
  }, [visibleTaxCodes]);

  const filteredTaxCodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = visibleTaxCodes.filter((c) => {
      if (selectedTaxType !== 'ALL' && c.taxType !== selectedTaxType) return false;
      if (!q) return true;
      const code = (c.code || '').toLowerCase();
      const name = (c.name || '').toLowerCase();
      const desc = (c.description || '').toLowerCase();
      const acc = (c.accountCode || '').toLowerCase() + ' ' + (c.accountName || '').toLowerCase();
      return code.includes(q) || name.includes(q) || desc.includes(q) || acc.includes(q);
    });

    return list.sort((a, b) => {
      const codeA = (a.code || '').toUpperCase();
      const codeB = (b.code || '').toUpperCase();
      if (sortOrder === 'ASC') {
        return codeA.localeCompare(codeB);
      }
      return codeB.localeCompare(codeA);
    });
  }, [visibleTaxCodes, searchQuery, selectedTaxType, sortOrder]);

  const paginatedTaxCodes = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredTaxCodes.slice(start, start + pageSize);
  }, [filteredTaxCodes, pageIndex, pageSize]);

  const handleArchiveTaxCode = async (taxCode: any) => {
    try {
      await apiFetch(`/api/master-data/tax-codes/${taxCode.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...taxCode, status: 'ARCHIVED' }),
      });
      fetchTaxCodes();
    } catch (err: any) {
      setError(err?.message || 'Failed to archive tax code.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Tax Codes
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Total {visibleTaxCodes.length} active/inactive tax codes</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ModuleArchiveInbox
            entityTypes={['TAX_CODE']}
            moduleTitle="Tax Codes"
            description="Archived BIR VAT and withholding tax codes with 30-day retention and COA-validated restore."
            onRestored={fetchTaxCodes}
          />
          <button 
            onClick={handleOpenAdd}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2 whitespace-nowrap shadow-xs"
          >
            <Plus className="w-4 h-4" /> Add Tax Code
          </button>
        </div>
      </div>
      
      {error && !showModal && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs font-medium">
          {error}
        </div>
      )}

      <TableFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPageIndex(0);
        }}
        searchPlaceholder="Search tax code, name, description..."
        sortOrder={sortOrder}
        onSortOrderChange={(ord) => {
          setSortOrder(ord);
          setPageIndex(0);
        }}
        productLabel="Tax Type"
        selectedProductId={selectedTaxType}
        onProductChange={(val) => {
          setSelectedTaxType(val);
          setPageIndex(0);
        }}
        productOptions={taxTypeOptions}
        pageSize={pageSize}
        onPageSizeChange={(sz) => {
          setPageSize(sz);
          setPageIndex(0);
        }}
        totalCount={visibleTaxCodes.length}
        filteredCount={filteredTaxCodes.length}
        onResetFilters={() => {
          setSearchQuery('');
          setSortOrder('DESC');
          setSelectedTaxType('ALL');
          setPageSize(20);
          setPageIndex(0);
        }}
      />

      <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
            <span className="animate-spin text-indigo-600 font-bold">●</span> Loading tax codes...
          </div>
        ) : visibleTaxCodes.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-600 dark:text-slate-300 font-medium">No tax codes found</p>
            <p className="text-slate-400 text-sm mt-1">Add your first tax code to manage your taxes.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm min-w-[850px]">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800 text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3.5 font-bold">Code</th>
                  <th className="px-4 py-3.5 font-bold">Name</th>
                  <th className="px-4 py-3.5 font-bold">Tax Type</th>
                  <th className="px-4 py-3.5 font-bold">Direction</th>
                  <th className="px-4 py-3.5 font-bold">GL Control Account</th>
                  <th className="px-4 py-3.5 font-bold">Status</th>
                  <th className="px-4 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {paginatedTaxCodes.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-200">{c.code}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{c.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{c.taxType}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{c.inputOutputDirection}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-600 dark:text-slate-300">
                    {c.accountCode ? `${c.accountCode} — ${c.accountName}` : c.accountId ? c.accountId : <span className="text-amber-600 font-sans">Unmapped</span>}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.status === 'ACTIVE' 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right space-x-3 whitespace-nowrap">
                    <button 
                      type="button"
                      onClick={() => handleOpenEdit(c)}
                      className="text-indigo-600 dark:text-indigo-400 font-medium text-xs hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchiveTaxCode(c)}
                      className="text-purple-600 dark:text-purple-400 font-medium text-xs hover:underline inline-flex items-center gap-1"
                    >
                      <Archive className="w-3 h-3" /> Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        <PaginationControls
          totalCount={filteredTaxCodes.length}
          itemCount={paginatedTaxCodes.length}
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[20, 50, 100]}
          hasNextPage={(pageIndex + 1) * pageSize < filteredTaxCodes.length}
          onNextPage={() => setPageIndex((p) => p + 1)}
          onPrevPage={() => setPageIndex((p) => Math.max(0, p - 1))}
          onFirstPage={() => setPageIndex(0)}
          onLastPage={() => setPageIndex(Math.max(0, Math.ceil(filteredTaxCodes.length / pageSize) - 1))}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPageIndex(0);
          }}
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {editingTaxCode ? 'Edit Tax Code' : 'Add Tax Code'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Code *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.code} 
                    onChange={e => setFormData({...formData, code: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. VAT12"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                  <select 
                    value={formData.status} 
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Name *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. 12% Value Added Tax"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tax Type *</label>
                  <select 
                    required
                    value={formData.taxType} 
                    onChange={e => {
                      const nextType = e.target.value;
                      const nextEligible = filterEligibleTaxControlAccounts(accounts, nextType, formData.inputOutputDirection);
                      const keepId = nextEligible.some(a => a.id === formData.accountId) ? formData.accountId : '';
                      setFormData({...formData, taxType: nextType, accountId: keepId});
                    }}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="VAT">Value Added Tax (VAT)</option>
                    <option value="EWT">Expanded Withholding Tax (EWT)</option>
                    <option value="PT">Percentage Tax (PT)</option>
                    <option value="EXEMPT">Exempt</option>
                    <option value="ZERO_RATED">Zero Rated</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Direction</label>
                  <select 
                    value={formData.inputOutputDirection} 
                    onChange={e => {
                      const nextDir = e.target.value;
                      const nextEligible = filterEligibleTaxControlAccounts(accounts, formData.taxType, nextDir);
                      const keepId = nextEligible.some(a => a.id === formData.accountId) ? formData.accountId : '';
                      setFormData({...formData, inputOutputDirection: nextDir, accountId: keepId});
                    }}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="INPUT">Input (Purchases)</option>
                    <option value="OUTPUT">Output (Sales)</option>
                    <option value="BOTH">Both</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">GL Control Account Mapping</label>
                  <select
                    value={formData.accountId}
                    onChange={e => setFormData({...formData, accountId: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Select GL Control Account --</option>
                    {eligibleTaxAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {formatAccountOptionLabel(acc, true)}
                      </option>
                    ))}
                  </select>
                  {eligibleTaxAccounts.length === 0 && (
                    <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                      No eligible active Tax Control accounts found in Chart of Accounts for {formData.taxType} ({formData.inputOutputDirection}).{' '}
                      <Link to="/accounting/accounts" onClick={() => setShowModal(false)} className="font-bold underline">
                        Configure in Chart of Accounts &rarr;
                      </Link>
                    </p>
                  )}
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                  <textarea 
                    rows={2}
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  ></textarea>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800 mt-6">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Tax Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
