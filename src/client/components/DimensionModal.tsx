import React, { useState } from 'react';
import { Layers, X, Plus } from 'lucide-react';

interface DimensionModalProps {
  isOpen: boolean;
  type: 'DEPARTMENT' | 'PROJECT' | 'COST_CENTER';
  onClose: () => void;
  onCreated: (item: any) => void;
}

export default function DimensionModal({
  isOpen,
  type,
  onClose,
  onCreated
}: DimensionModalProps) {
  const title = type === 'DEPARTMENT' 
    ? 'Create New Department' 
    : type === 'PROJECT' 
    ? 'Create New Project' 
    : 'Create New Cost Center';

  const defaultCodePrefix = type === 'DEPARTMENT' ? 'DEPT-' : type === 'PROJECT' ? 'PRJ-' : 'CC-';

  const [code, setCode] = useState(`${defaultCodePrefix}${Math.floor(100 + Math.random() * 900)}`);
  const [name, setName] = useState('');
  const [extraField, setExtraField] = useState(''); // managerName or budgetAmount
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setError('Code and Name are required fields.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let endpoint = '/api/master-data/departments';
      let bodyData: any = { code: code.trim(), name: name.trim() };

      if (type === 'DEPARTMENT') {
        endpoint = '/api/master-data/departments';
        bodyData.managerName = extraField.trim() || undefined;
      } else if (type === 'PROJECT') {
        endpoint = '/api/master-data/projects';
        bodyData.budgetAmount = extraField ? Number(extraField) * 100 : undefined;
      } else {
        endpoint = '/api/master-data/cost-centers';
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create dimension.');
      }

      onCreated(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-md">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Add a tracking dimension for cost & revenue analysis.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-2.5 bg-red-50 dark:bg-red-950/50 border border-red-200 text-xs font-semibold text-red-700 dark:text-red-300 rounded-xl">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Code *</label>
              <input
                type="text"
                required
                value={code}
                onChange={e => setCode(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 font-mono text-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={type === 'DEPARTMENT' ? 'e.g. Marketing' : type === 'PROJECT' ? 'e.g. Website Overhaul' : 'e.g. IT Operations'}
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {type === 'DEPARTMENT' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Department Manager / Head</label>
              <input
                type="text"
                value={extraField}
                onChange={e => setExtraField(e.target.value)}
                placeholder="e.g. Juan dela Cruz"
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
              />
            </div>
          )}

          {type === 'PROJECT' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Budget Allocation (PHP)</label>
              <input
                type="number"
                value={extraField}
                onChange={e => setExtraField(e.target.value)}
                placeholder="e.g. 500000"
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Save Dimension
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
