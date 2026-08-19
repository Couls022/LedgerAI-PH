import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, RefreshCw, X, FileEdit, Check, ArrowRight, Trash2, Copy, Play, Layers, Info } from 'lucide-react';
import ExportButton from '../../components/ExportButton';
import DimensionModal from '../../components/DimensionModal';
import SearchBar from '../../components/shared/SearchBar';
import { PaginationControls } from '../../components/PaginationControls';
import { useAuth } from '../../context/AuthContext';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const StatusBadge = ({ status }: { status: string }) => {
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
      status === 'POSTED' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 
      status === 'VOIDED' || status === 'REVERSED' ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800' : 
      status === 'APPROVED' ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
      status === 'SUBMITTED' ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800' :
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
    }`}>
      {status || 'DRAFT'}
    </span>
  );
};

export default function Journals() {
  const { activeCompany, user, hasPermission } = useAuth();
  const [journals, setJournals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showForm, setShowForm] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Quick Dimension Modal
  const [dimensionModalOpen, setDimensionModalOpen] = useState(false);
  const [dimensionType, setDimensionType] = useState<'DEPARTMENT' | 'PROJECT' | 'COST_CENTER'>('DEPARTMENT');
  const [activeLineForDimension, setActiveLineForDimension] = useState<{ id: number; field: string } | null>(null);
  
  // Pagination State
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);

  // Form state
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [journalNumber, setJournalNumber] = useState(`JE-${Date.now().toString().slice(-6)}`);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<any[]>([
    { id: 1, accountId: '', debit: '', credit: '', description: '', departmentId: '', projectId: '', costCenterId: '' },
    { id: 2, accountId: '', debit: '', credit: '', description: '', departmentId: '', projectId: '', costCenterId: '' }
  ]);

  const loadData = async (cursor?: string | null) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (activeCurr) params.set('cursor', activeCurr);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const [jRes, aRes, dRes, pRes, cRes] = await Promise.all([
        fetch(`/api/accounting/journals?${params.toString()}`),
        fetch('/api/accounting/accounts'),
        fetch('/api/master-data/departments'),
        fetch('/api/master-data/projects'),
        fetch('/api/master-data/cost-centers')
      ]);
      
      if (jRes.ok) {
        const jData = await jRes.json();
        if (Array.isArray(jData)) {
          setJournals(jData);
          setPaginationMeta(null);
        } else {
          setJournals(jData.data || []);
          setPaginationMeta(jData.pagination || null);
        }
      }
      if (aRes.ok) setAccounts(await aRes.json());
      if (dRes.ok) setDepartments(await dRes.json());
      if (pRes.ok) setProjects(await pRes.json());
      if (cRes.ok) setCostCenters(await cRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    loadData(null);
  }, [activeCompany?.id, searchQuery]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      loadData(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevStack = [...cursorStack];
      const prevCursor = prevStack.pop() || null;
      setCursorStack(prevStack);
      setCurrentCursor(prevCursor);
      loadData(prevCursor);
    }
  };

  const openDimensionModal = (type: 'DEPARTMENT' | 'PROJECT' | 'COST_CENTER', lineId?: number, field?: string) => {
    setDimensionType(type);
    if (lineId && field) {
      setActiveLineForDimension({ id: lineId, field });
    } else {
      setActiveLineForDimension(null);
    }
    setDimensionModalOpen(true);
  };

  const handleDimensionCreated = (newItem: any) => {
    if (dimensionType === 'DEPARTMENT') {
      setDepartments(prev => [newItem, ...prev]);
      if (activeLineForDimension) {
        handleLineChange(activeLineForDimension.id, 'departmentId', newItem.id);
      }
    } else if (dimensionType === 'PROJECT') {
      setProjects(prev => [newItem, ...prev]);
      if (activeLineForDimension) {
        handleLineChange(activeLineForDimension.id, 'projectId', newItem.id);
      }
    } else {
      setCostCenters(prev => [newItem, ...prev]);
      if (activeLineForDimension) {
        handleLineChange(activeLineForDimension.id, 'costCenterId', newItem.id);
      }
    }
  };

  const handleAddLine = () => {
    setLines([...lines, { id: Date.now(), accountId: '', debit: '', credit: '', description: '', departmentId: '', projectId: '', costCenterId: '' }]);
  };

  const handleRemoveLine = (id: number) => {
    if (lines.length > 2) setLines(lines.filter(l => l.id !== id));
  };

  const handleLineChange = (id: number, field: string, value: any) => {
    setLines(lines.map(l => {
      if (l.id === id) {
        let updated = { ...l, [field]: value };
        if (field === 'debit') {
          const debVal = parseFloat(value) || 0;
          if (debVal > 0) {
            updated.credit = '';
          }
        } else if (field === 'credit') {
          const credVal = parseFloat(value) || 0;
          if (credVal > 0) {
            updated.debit = '';
          }
        }
        return updated;
      }
      return l;
    }));
  };

  const getActiveLines = () => {
    return lines.filter(l => l.accountId || (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0);
  };

  const calculateTotal = (field: 'debit' | 'credit') => {
    return lines.reduce((sum, l) => sum + (parseFloat(l[field]) || 0), 0);
  };

  const isJournalValid = () => {
    const activeLines = getActiveLines();
    if (activeLines.length < 2) return false;

    const debits = activeLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
    const credits = activeLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);

    if (Math.abs(debits - credits) >= 0.001) return false;
    if (debits <= 0) return false;
    
    // Every line must have an account selected and either debit or credit > 0 (not both)
    for (const l of activeLines) {
      if (!l.accountId) return false;
      const deb = parseFloat(l.debit) || 0;
      const cred = parseFloat(l.credit) || 0;
      if (deb === 0 && cred === 0) return false;
      if (deb > 0 && cred > 0) return false;
    }
    return true;
  };

  const handleAction = async (id: string, action: string, payload?: any) => {
    setListError(null);
    try {
      const res = await fetch(`/api/accounting/journals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Action failed');
      loadData();
    } catch (err: any) {
      setListError(err.message);
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    
    if (!isJournalValid()) {
      setFormError("Journal entry must have at least two valid lines, must be balanced, and must not contain negative values or both debit and credit on any line.");
      return;
    }

    try {
      const activeLines = getActiveLines();
      const payload = {
        entryDate,
        journalNumber,
        description,
        lines: activeLines.map(l => ({
          accountId: l.accountId,
          debit: Math.round((parseFloat(l.debit) || 0) * 100),
          credit: Math.round((parseFloat(l.credit) || 0) * 100),
          description: l.description,
          departmentId: l.departmentId || undefined,
          projectId: l.projectId || undefined,
          costCenterId: l.costCenterId || undefined
        }))
      };

      const res = await fetch('/api/accounting/journals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create journal');
      
      setShowForm(false);
      setLines([
        { id: 1, accountId: '', debit: '', credit: '', description: '', departmentId: '', projectId: '', costCenterId: '' },
        { id: 2, accountId: '', debit: '', credit: '', description: '', departmentId: '', projectId: '', costCenterId: '' }
      ]);
      setJournalNumber(`JE-${Date.now().toString().slice(-6)}`);
      setDescription('');
      loadData();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {showForm ? (
        <div className="bg-white dark:bg-[#111827] p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <FileEdit className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Create Journal Voucher Entry
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Double-entry balanced transaction posting with Philippine dimension tagging.
              </p>
            </div>
            <button 
              onClick={() => setShowForm(false)} 
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {formError && (
            <div className="bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 p-4 rounded-xl border border-rose-200 dark:border-rose-800 text-sm font-medium">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmitForm} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Entry Date</label>
                <input 
                  type="date" 
                  required 
                  value={entryDate} 
                  onChange={e => setEntryDate(e.target.value)} 
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-slate-50/50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Journal Number</label>
                <input 
                  type="text" 
                  required 
                  value={journalNumber} 
                  onChange={e => setJournalNumber(e.target.value)} 
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono bg-slate-50/50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Description / Narration</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. Monthly Accrual of Utilities" 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-slate-50/50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                />
              </div>
            </div>

            {/* Informative Dimensions Explainer Banner */}
            <div className="bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 p-4 rounded-xl text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-3">
              <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold">Ano ang Dimensions? (Department, Project, Cost Center):</span>
                <p className="text-[11px] text-indigo-800/90 dark:text-indigo-300/90 leading-relaxed">
                  Ang <strong>Dimensions</strong> ay ginagamit para i-tag ang bawat transaction sa partikular na <strong>Department</strong> (hal. Finance, Sales), <strong>Project</strong> (hal. Client Alpha), o <strong>Cost Center</strong> (hal. Head Office Overhead). Nagbibigay ito ng detalyadong reporting nang hindi dumadami ang accounts sa Chart of Accounts.
                </p>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto shadow-xs">
              <table className="w-full text-left text-sm min-w-[800px]">
                <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-3.5">Account (Chart of Accounts)</th>
                    <th className="py-3 px-3.5">Debit (PHP)</th>
                    <th className="py-3 px-3.5">Credit (PHP)</th>
                    <th className="py-3 px-3.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> Dimensions</span>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 lowercase">
                          <button type="button" onClick={() => openDimensionModal('DEPARTMENT')} className="hover:underline">+ Dept</button>
                          <span>•</span>
                          <button type="button" onClick={() => openDimensionModal('PROJECT')} className="hover:underline">+ Proj</button>
                          <span>•</span>
                          <button type="button" onClick={() => openDimensionModal('COST_CENTER')} className="hover:underline">+ CC</button>
                        </div>
                      </div>
                    </th>
                    <th className="py-3 px-3.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-[#111827]">
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2.5 px-3.5">
                        <select 
                          required 
                          value={line.accountId} 
                          onChange={e => handleLineChange(line.id, 'accountId', e.target.value)} 
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          <option value="">Select Account...</option>
                          {accounts.filter(a => a.status === 'ACTIVE').map(a => (
                            <option key={a.id} value={a.id}>
                              {a.accountCode} - {a.accountName} ({a.accountType})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          placeholder="0.00"
                          value={line.debit || ''} 
                          onChange={e => handleLineChange(line.id, 'debit', e.target.value)} 
                          disabled={parseFloat(line.credit) > 0}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs disabled:bg-slate-100 dark:disabled:bg-slate-800/60 disabled:text-slate-400 font-mono text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900" 
                        />
                      </td>
                      <td className="py-2.5 px-3.5">
                        <input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          placeholder="0.00"
                          value={line.credit || ''} 
                          onChange={e => handleLineChange(line.id, 'credit', e.target.value)} 
                          disabled={parseFloat(line.debit) > 0}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs disabled:bg-slate-100 dark:disabled:bg-slate-800/60 disabled:text-slate-400 font-mono text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900" 
                        />
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="flex gap-1.5">
                          <select 
                            value={line.departmentId} 
                            onChange={e => {
                              if (e.target.value === '__NEW_DEPT__') {
                                openDimensionModal('DEPARTMENT', line.id, 'departmentId');
                              } else {
                                handleLineChange(line.id, 'departmentId', e.target.value);
                              }
                            }} 
                            className="w-1/3 px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                          >
                            <option value="">Dept...</option>
                            <option value="__NEW_DEPT__" className="font-semibold text-indigo-600 dark:text-indigo-400">+ Add Dept...</option>
                            {departments.filter(d => d.status === 'ACTIVE').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>

                          <select 
                            value={line.projectId} 
                            onChange={e => {
                              if (e.target.value === '__NEW_PROJ__') {
                                openDimensionModal('PROJECT', line.id, 'projectId');
                              } else {
                                handleLineChange(line.id, 'projectId', e.target.value);
                              }
                            }} 
                            className="w-1/3 px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                          >
                            <option value="">Proj...</option>
                            <option value="__NEW_PROJ__" className="font-semibold text-indigo-600 dark:text-indigo-400">+ Add Proj...</option>
                            {projects.filter(p => p.status === 'ACTIVE').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>

                          <select 
                            value={line.costCenterId} 
                            onChange={e => {
                              if (e.target.value === '__NEW_CC__') {
                                openDimensionModal('COST_CENTER', line.id, 'costCenterId');
                              } else {
                                handleLineChange(line.id, 'costCenterId', e.target.value);
                              }
                            }} 
                            className="w-1/3 px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                          >
                            <option value="">CC...</option>
                            <option value="__NEW_CC__" className="font-semibold text-indigo-600 dark:text-indigo-400">+ Add CC...</option>
                            {costCenters.filter(c => c.status === 'ACTIVE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-center">
                        <button 
                          type="button" 
                          onClick={() => handleRemoveLine(line.id)} 
                          className="p-1 text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 dark:bg-slate-900/80 font-bold border-t border-slate-200 dark:border-slate-800 text-xs">
                    <td className="py-3 px-3.5 text-right text-slate-600 dark:text-slate-400">Totals:</td>
                    <td className="py-3 px-3.5 font-mono text-slate-900 dark:text-slate-100">{formatCurrency(calculateTotal('debit') * 100)}</td>
                    <td className="py-3 px-3.5 font-mono text-slate-900 dark:text-slate-100">{formatCurrency(calculateTotal('credit') * 100)}</td>
                    <td colSpan={2} className="py-3 px-3.5">
                      {Math.abs(calculateTotal('debit') - calculateTotal('credit')) < 0.001 && calculateTotal('debit') > 0 ? (
                        <span className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Balanced
                        </span>
                      ) : (
                        <span className="bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                          <X className="w-3.5 h-3.5" /> Unbalanced
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Preview Box per Rule 14 */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-bold">
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                <span className="text-slate-600 dark:text-slate-400">Total Debit: <span className="text-slate-900 dark:text-slate-100 font-mono text-sm ml-1">{formatCurrency(calculateTotal('debit') * 100)}</span></span>
                <span className="text-slate-600 dark:text-slate-400">Total Credit: <span className="text-slate-900 dark:text-slate-100 font-mono text-sm ml-1">{formatCurrency(calculateTotal('credit') * 100)}</span></span>
              </div>
              <div>
                {Math.abs(calculateTotal('debit') - calculateTotal('credit')) < 0.001 && calculateTotal('debit') > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Check className="w-4 h-4" /> Entry is balanced and ready</span>
                ) : (
                  <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><X className="w-4 h-4" /> Debits and credits must equal</span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button 
                type="button" 
                onClick={handleAddLine} 
                className="text-indigo-600 dark:text-indigo-400 text-xs font-bold flex items-center gap-1.5 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Line
              </button>
              <div className="flex gap-2">
                <button 
                  type="button" 
                  onClick={() => setShowForm(false)} 
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!isJournalValid()} 
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors disabled:opacity-50 shadow-xs"
                >
                  Save Draft
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2.5">
                <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                General Journal Entries
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                Official General Journal register, vouchers, draft workflow, and approval logs.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {hasPermission(['accounting:create', 'accounting:edit']) && (
                <button 
                  onClick={() => setShowForm(true)} 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="w-4 h-4" /> New Entry
                </button>
              )}
            </div>
          </div>

          {/* Search Bar */}
          <div>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by journal #, description, or status..."
            />
          </div>

          {listError && (
            <div className="bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 p-4 rounded-xl border border-rose-200 dark:border-rose-800 text-sm font-medium">
              {listError}
            </div>
          )}
          
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-slate-200/90 dark:border-slate-800 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
                <RefreshCw className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                <span>Loading journal entries...</span>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[800px]">
                    <thead className="bg-slate-50/80 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider font-bold border-b border-slate-100 dark:border-slate-800">
                      <tr>
                        <th className="py-3.5 px-4">Date</th>
                        <th className="py-3.5 px-4">Journal #</th>
                        <th className="py-3.5 px-4">Description</th>
                        <th className="py-3.5 px-4 text-center">Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {journals.filter(j => {
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        const num = (j?.journalNumber || '').toLowerCase();
                        const desc = (j?.description || '').toLowerCase();
                        const status = (j?.status || '').toLowerCase();
                        return num.includes(q) || desc.includes(q) || status.includes(q);
                      }).map((j, idx) => (
                        <tr key={j?.id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4 text-xs font-mono text-slate-500 dark:text-slate-400">{j?.entryDate ? new Date(j.entryDate).toLocaleDateString() : '-'}</td>
                          <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">{j?.journalNumber || '-'}</td>
                          <td className="py-3.5 px-4 text-slate-800 dark:text-slate-200 font-medium">{j?.description || '-'}</td>
                          <td className="py-3.5 px-4 text-center"><StatusBadge status={j?.status} /></td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {j.status === 'DRAFT' && hasPermission(['accounting:create', 'accounting:edit']) && (
                                <button 
                                  onClick={() => handleAction(j.id, 'submit')} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800"
                                >
                                  Submit
                                </button>
                              )}
                              {j.status === 'SUBMITTED' && hasPermission('accounting:approve') && (
                                <button 
                                  onClick={() => handleAction(j.id, 'approve')} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800"
                                >
                                  Approve
                                </button>
                              )}
                              {j.status === 'SUBMITTED' && hasPermission('accounting:approve') && (
                                <button 
                                  onClick={() => { const r = prompt("Reason:"); if (r) handleAction(j.id, 'reject', { reason: r }); }} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800"
                                >
                                  Reject
                                </button>
                              )}
                              {j.status === 'APPROVED' && hasPermission(['accounting:post', 'accounting:approve']) && (
                                <button 
                                  onClick={() => handleAction(j.id, 'post')} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800"
                                >
                                  Post
                                </button>
                              )}
                              {j.status === 'POSTED' && hasPermission(['accounting:reverse', 'accounting:approve']) && (
                                <button 
                                  onClick={() => { const r = prompt("Reverse date:"); if (r) handleAction(j.id, 'reverse', { reverseDate: r, newPeriodId: j.accountingPeriodId }); }} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800"
                                >
                                  Reverse
                                </button>
                              )}
                              {j.status !== 'POSTED' && j.status !== 'VOIDED' && j.status !== 'REVERSED' && hasPermission(['accounting:delete', 'accounting:edit']) && (
                                <button 
                                  onClick={() => { const r = prompt("Reason:"); if (r) handleAction(j.id, 'void', { reason: r }); }} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800"
                                >
                                  Void
                                </button>
                              )}
                              {hasPermission(['accounting:create', 'accounting:edit']) && (
                                <button 
                                  onClick={() => handleAction(j.id, 'copy', { entryDate: new Date().toISOString().split('T')[0] })} 
                                  className="text-xs font-semibold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                                >
                                  Copy
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {journals.length === 0 && (
                        <tr><td colSpan={5} className="py-12 text-center text-slate-400">No journal entries found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  totalCount={paginationMeta?.totalCount}
                  itemCount={journals.length}
                  pageIndex={cursorStack.length}
                  hasNextPage={!!paginationMeta?.hasNextPage}
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  loading={loading}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* Quick Dimension Creation Modal */}
      <DimensionModal
        isOpen={dimensionModalOpen}
        type={dimensionType}
        onClose={() => setDimensionModalOpen(false)}
        onCreated={handleDimensionCreated}
      />
    </div>
  );
}
