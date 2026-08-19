import React, { useState, useEffect } from 'react';
import { Search, Plus, Building2, X } from 'lucide-react';

export default function CostCentersList() {
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCostCenter, setEditingCostCenter] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    status: 'ACTIVE'
  });

  const fetchCostCenters = () => {
    setLoading(true);
    fetch('/api/master-data/cost-centers')
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

  const handleOpenAdd = () => {
    setEditingCostCenter(null);
    setFormData({
      code: '',
      name: '',
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
      status: costCenter.status || 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    // In a real app, you might have PUT for update, but typically POST handles creation.
    // If the backend handles PUT for cost-centers, adjust accordingly.
    const url = '/api/master-data/cost-centers';
    const method = 'POST'; // Assuming the backend only has POST or we handle it uniformly

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save cost center');
      
      setShowModal(false);
      fetchCostCenters();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Cost Centers
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Total {costCenters.length} cost centers</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleOpenAdd}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2 whitespace-nowrap shadow-xs"
          >
            <Plus className="w-4 h-4" /> Add Cost Center
          </button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
            <span className="animate-spin text-indigo-600 font-bold">●</span> Loading cost centers...
          </div>
        ) : costCenters.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Building2 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-600 dark:text-slate-300 font-medium">No cost centers found</p>
            <p className="text-slate-400 text-sm mt-1">Add your first cost center for tracking.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm min-w-[750px]">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800 text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3.5 font-bold">Code</th>
                  <th className="px-4 py-3.5 font-bold">Name</th>
                  <th className="px-4 py-3.5 font-bold">Status</th>
                  <th className="px-4 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {costCenters.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-200">{c.code}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{c.name}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.status === 'ACTIVE' 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button 
                      onClick={() => handleOpenEdit(c)}
                      className="text-indigo-600 dark:text-indigo-400 font-medium text-xs hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg my-8">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {editingCostCenter ? 'Edit Cost Center' : 'Add Cost Center'}
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
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Code *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.code} 
                    onChange={e => setFormData({...formData, code: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. CC-001"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Name *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
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
                  {saving ? 'Saving...' : 'Save Cost Center'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
