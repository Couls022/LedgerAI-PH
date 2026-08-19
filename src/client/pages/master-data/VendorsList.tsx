import React, { useState, useEffect } from 'react';
import { Search, Plus, Truck, X } from 'lucide-react';

export default function VendorsList() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    code: '',
    legalName: '',
    tradeName: '',
    tin: '',
    address: '',
    contactPerson: '',
    contactDetails: '',
    status: 'ACTIVE'
  });

  const fetchVendors = () => {
    setLoading(true);
    fetch('/api/master-data/vendors')
      .then(res => res.json())
      .then(data => {
        setVendors(Array.isArray(data) ? data : (data.data || []));
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  const handleOpenAdd = () => {
    setEditingVendor(null);
    setFormData({
      code: '',
      legalName: '',
      tradeName: '',
      tin: '',
      address: '',
      contactPerson: '',
      contactDetails: '',
      status: 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleOpenEdit = (vendor: any) => {
    setEditingVendor(vendor);
    setFormData({
      code: vendor.code || '',
      legalName: vendor.legalName || '',
      tradeName: vendor.tradeName || '',
      tin: vendor.tin || '',
      address: vendor.address || '',
      contactPerson: vendor.contactPerson || '',
      contactDetails: vendor.contactDetails || '',
      status: vendor.status || 'ACTIVE'
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const url = editingVendor 
      ? `/api/master-data/vendors/${editingVendor.id}` 
      : '/api/master-data/vendors';
    const method = editingVendor ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save vendor');
      
      setShowModal(false);
      fetchVendors();
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
            <Truck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Vendors Directory
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Total {vendors.length} registered vendors</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleOpenAdd}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2 whitespace-nowrap shadow-xs"
          >
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
            <span className="animate-spin text-indigo-600 font-bold">●</span> Loading vendors...
          </div>
        ) : vendors.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Truck className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-600 dark:text-slate-300 font-medium">No vendors found</p>
            <p className="text-slate-400 text-sm mt-1">Add your first vendor to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm min-w-[750px]">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800 text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3.5 font-bold">Code</th>
                  <th className="px-4 py-3.5 font-bold">Legal Name</th>
                  <th className="px-4 py-3.5 font-bold">TIN</th>
                  <th className="px-4 py-3.5 font-bold">Contact</th>
                  <th className="px-4 py-3.5 font-bold">Status</th>
                  <th className="px-4 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {vendors.map(v => (
                <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-200">{v.code}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{v.legalName}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{v.tin || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{v.contactPerson || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      v.status === 'ACTIVE' 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {v.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button 
                      onClick={() => handleOpenEdit(v)}
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
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {editingVendor ? 'Edit Vendor' : 'Add Vendor'}
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
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Vendor Code *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.code} 
                    onChange={e => setFormData({...formData, code: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. VEND-001"
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
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Legal Name *</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.legalName} 
                    onChange={e => setFormData({...formData, legalName: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Trade Name / DBA</label>
                  <input 
                    type="text" 
                    value={formData.tradeName} 
                    onChange={e => setFormData({...formData, tradeName: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">TIN (Tax ID)</label>
                  <input 
                    type="text" 
                    value={formData.tin} 
                    onChange={e => setFormData({...formData, tin: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Full Address</label>
                  <input 
                    type="text" 
                    value={formData.address} 
                    onChange={e => setFormData({...formData, address: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Person</label>
                  <input 
                    type="text" 
                    value={formData.contactPerson} 
                    onChange={e => setFormData({...formData, contactPerson: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Email / Phone</label>
                  <input 
                    type="text" 
                    value={formData.contactDetails} 
                    onChange={e => setFormData({...formData, contactDetails: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
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
                  {saving ? 'Saving...' : 'Save Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
