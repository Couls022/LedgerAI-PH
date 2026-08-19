import React, { useState, useEffect } from 'react';
import { 
  PieChart, DollarSign, TrendingUp, AlertTriangle, CheckCircle2, 
  Sparkles, Save, RefreshCw, Search, Calendar, Filter, Plus, 
  ArrowUpRight, ArrowDownRight, Sliders, Info, ShieldAlert, BarChart3, Trash2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';

interface BudgetItem {
  id: string | null;
  category: string;
  monthlyLimit: number; // centavos
  actualSpent: number; // centavos
  variance: number; // centavos
  percentageUsed: number;
  status: 'UNDER_BUDGET' | 'NEAR_LIMIT' | 'OVER_BUDGET';
  notes: string | null;
}

interface BudgetSummary {
  totalBudget: number;
  totalActual: number;
  netVariance: number;
  totalCategories: number;
  overBudgetCount: number;
  nearLimitCount: number;
  percentageUsed: number;
}

export default function BudgetPlanning() {
  const { activeCompany, userRole } = useAuth();
  const { addNotification } = useNotifications();

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const [selectedMonth, setSelectedMonth] = useState(defaultPeriod);
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSuggesting, setAutoSuggesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OVER_BUDGET' | 'NEAR_LIMIT' | 'UNDER_BUDGET'>('ALL');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Custom new category modal/state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryLimit, setNewCategoryLimit] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchBudgets = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/budgets?periodMonth=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        setBudgets(data.budgets || []);
        setSummary(data.summary || null);
      }
    } catch (err) {
      console.error('Failed to fetch budgets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBudgets();
  }, [selectedMonth]);

  const handleLimitChange = (index: number, newLimitPhp: number) => {
    const updated = [...budgets];
    const newCentavos = Math.max(0, Math.round(newLimitPhp * 100));
    const item = updated[index];
    
    item.monthlyLimit = newCentavos;
    item.variance = newCentavos - item.actualSpent;
    item.percentageUsed = newCentavos > 0 ? Math.round((item.actualSpent / newCentavos) * 100) : 0;
    
    if (item.percentageUsed > 100) {
      item.status = 'OVER_BUDGET';
    } else if (item.percentageUsed >= 80) {
      item.status = 'NEAR_LIMIT';
    } else {
      item.status = 'UNDER_BUDGET';
    }

    setBudgets(updated);
    recalculateSummary(updated);
  };

  const handleRemoveCategory = (index: number) => {
    
    const updated = [...budgets];
    updated.splice(index, 1);
    setBudgets(updated);
    recalculateSummary(updated);
  };

  const handleNotesChange = (index: number, text: string) => {
    const updated = [...budgets];
    updated[index].notes = text;
    setBudgets(updated);
  };

  const recalculateSummary = (items: BudgetItem[]) => {
    const totalBudget = items.reduce((acc, curr) => acc + curr.monthlyLimit, 0);
    const totalActual = items.reduce((acc, curr) => acc + curr.actualSpent, 0);
    const netVariance = totalBudget - totalActual;
    const overBudgetCount = items.filter(i => i.status === 'OVER_BUDGET').length;
    const nearLimitCount = items.filter(i => i.status === 'NEAR_LIMIT').length;
    const percentageUsed = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

    setSummary({
      totalBudget,
      totalActual,
      netVariance,
      totalCategories: items.length,
      overBudgetCount,
      nearLimitCount,
      percentageUsed
    });
  };

  const handleSaveAll = async () => {
    try {
      setSaving(true);
      const payload = {
        periodMonth: selectedMonth,
        items: budgets.map(b => ({
          category: b.category,
          monthlyLimit: b.monthlyLimit,
          notes: b.notes
        }))
      };

      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast(`Budget targets successfully saved for ${selectedMonth}!`);
        addNotification("Budget Updated", `Monthly spending limits saved for ${selectedMonth}`, "SYSTEM");
        fetchBudgets();
      } else {
        throw new Error("Failed to save budget allocation");
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAutoSuggest = async () => {
    try {
      setAutoSuggesting(true);
      const res = await fetch('/api/budgets/auto-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodMonth: selectedMonth })
      });

      if (res.ok) {
        const data = await res.json();
        const suggestedMap = new Map<string, number>();
        data.suggested.forEach((s: any) => suggestedMap.set(s.category, s.monthlyLimit));

        const updated = budgets.map(item => {
          const sug = suggestedMap.get(item.category);
          if (sug !== undefined) {
            const limit = sug;
            const variance = limit - item.actualSpent;
            const pct = limit > 0 ? Math.round((item.actualSpent / limit) * 100) : 0;
            let status: 'UNDER_BUDGET' | 'NEAR_LIMIT' | 'OVER_BUDGET' = 'UNDER_BUDGET';
            if (pct > 100) status = 'OVER_BUDGET';
            else if (pct >= 80) status = 'NEAR_LIMIT';

            return {
              ...item,
              monthlyLimit: limit,
              variance,
              percentageUsed: pct,
              status,
              notes: item.notes || "Auto-budgeted from historical average + 10% buffer"
            };
          }
          return item;
        });

        setBudgets(updated);
        recalculateSummary(updated);
        showToast("Auto-budget suggestions applied! Review and click Save.");
      }
    } catch (err) {
      console.error("Auto suggest error:", err);
    } finally {
      setAutoSuggesting(false);
    }
  };

  const handleAddCustomCategory = () => {
    if (!newCategoryName.trim() || !newCategoryLimit) return;
    const limitCentavos = Math.round(parseFloat(newCategoryLimit) * 100);
    const newCat = newCategoryName.trim();

    const existingIndex = budgets.findIndex(b => b.category.toLowerCase() === newCat.toLowerCase());
    if (existingIndex >= 0) {
      handleLimitChange(existingIndex, parseFloat(newCategoryLimit));
    } else {
      const newItem: BudgetItem = {
        id: null,
        category: newCat,
        monthlyLimit: limitCentavos,
        actualSpent: 0,
        variance: limitCentavos,
        percentageUsed: 0,
        status: 'UNDER_BUDGET',
        notes: 'Custom budget limit'
      };
      const updated = [newItem, ...budgets];
      setBudgets(updated);
      recalculateSummary(updated);
    }

    setNewCategoryName('');
    setNewCategoryLimit('');
    setShowAddModal(false);
    showToast(`Added category: ${newCat}`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const formatCurrency = (amountCentavos: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amountCentavos / 100);
  };

  const filteredBudgets = budgets.filter(b => {
    const matchesSearch = b.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 pb-12">
      
      {/* Toast Feedback Banner */}
      {toastMessage && (
        <div className="fixed top-20 right-8 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-indigo-500/30 animate-in slide-in-from-top duration-300">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{toastMessage}</span>
        </div>
      )}

      {/* Page Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <PieChart className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Category Budget & Spending Variance
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">
            Establish monthly expense targets per category and monitor real-time ledger variance against budget limits
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Period Selector */}
          <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
            <Calendar className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Month:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
            />
          </div>

          {/* AI Auto-Suggest Button */}
          <button
            onClick={handleAutoSuggest}
            disabled={autoSuggesting}
            className="px-3.5 py-2.5 bg-indigo-50 dark:bg-indigo-950/80 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold transition-all border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 shadow-2xs"
            title="Auto-calculate budget targets using 3-month expense averages + 10% buffer"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-amber-300 animate-pulse" />
            <span>{autoSuggesting ? 'Calculating...' : 'AI Budget Suggest'}</span>
          </button>

          {/* Add Custom Category Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Category</span>
          </button>

          {/* Save Budget Button */}
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-sm hover:shadow-indigo-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save Allocations</span>
          </button>
        </div>
      </div>

      {/* Top Overview KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Total Budget */}
          <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Total Monthly Budget</span>
              <DollarSign className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {formatCurrency(summary.totalBudget)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Allocated across {summary.totalCategories} expense categories
            </p>
          </div>

          {/* Actual Spending */}
          <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Actual MTD Spending</span>
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {formatCurrency(summary.totalActual)}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    summary.percentageUsed > 100 ? 'bg-rose-500' :
                    summary.percentageUsed >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, summary.percentageUsed)}%` }}
                />
              </div>
              <span className="text-xs font-bold font-mono text-slate-700 dark:text-slate-300">
                {summary.percentageUsed}%
              </span>
            </div>
          </div>

          {/* Net Variance */}
          <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Net Variance (Remaining)</span>
              {summary.netVariance >= 0 ? (
                <ArrowDownRight className="w-4 h-4 text-emerald-500" />
              ) : (
                <ArrowUpRight className="w-4 h-4 text-rose-500" />
              )}
            </div>
            <div className={`text-2xl font-black font-mono ${
              summary.netVariance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {formatCurrency(summary.netVariance)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.netVariance >= 0 ? 'Under total budget threshold' : 'Exceeded total budget threshold'}
            </p>
          </div>

          {/* Over Budget Alert Count */}
          <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Alert Status</span>
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
                {summary.overBudgetCount}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Over Budget</span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <span className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
                {summary.nearLimitCount}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Near Limit</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.overBudgetCount > 0 ? "Requires review & management action" : "All spending within safe boundaries"}
            </p>
          </div>

        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search category name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Status:</span>
          {(['ALL', 'OVER_BUDGET', 'NEAR_LIMIT', 'UNDER_BUDGET'] as const).map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                statusFilter === st
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All' : st === 'OVER_BUDGET' ? 'Over Budget' : st === 'NEAR_LIMIT' ? 'Near Limit' : 'On Track'}
            </button>
          ))}
        </div>
      </div>

      {/* Category Budget Items Grid / List */}
      {loading ? (
        <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Loading budget allocations & expense variance...</p>
        </div>
      ) : filteredBudgets.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <Info className="w-10 h-10 text-slate-400 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No matching categories found</p>
          <p className="text-xs text-slate-500 mt-1">Try clearing your search query or status filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBudgets.map((item) => {
            // Find index in main budgets array
            const realIdx = budgets.findIndex(b => b.category === item.category);

            return (
              <div
                key={item.category}
                className={`p-5 bg-white dark:bg-slate-800 rounded-2xl border transition-all ${
                  item.status === 'OVER_BUDGET'
                    ? 'border-rose-300 dark:border-rose-900/80 shadow-xs'
                    : item.status === 'NEAR_LIMIT'
                    ? 'border-amber-300 dark:border-amber-900/80'
                    : 'border-slate-200 dark:border-slate-700/80'
                }`}
              >
                {/* Header: Category Name & Badge */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-indigo-500" />
                      {item.category}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold flex items-center gap-1 ${
                      item.status === 'OVER_BUDGET'
                        ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        : item.status === 'NEAR_LIMIT'
                        ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    }`}>
                      {item.status === 'OVER_BUDGET' && <AlertTriangle className="w-3 h-3 text-rose-600" />}
                      {item.status === 'NEAR_LIMIT' && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                      {item.status === 'UNDER_BUDGET' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                      <span>
                        {item.status === 'OVER_BUDGET' ? 'Over Budget' : item.status === 'NEAR_LIMIT' ? 'Near Limit' : 'On Track'}
                      </span>
                    </span>
                    <button 
                      onClick={() => handleRemoveCategory(realIdx)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
                      title="Remove category limit"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Percentage */}
                <div className="space-y-1.5 mb-4">
                  <div className="flex justify-between text-xs font-mono font-bold text-slate-600 dark:text-slate-400">
                    <span>Spent: {formatCurrency(item.actualSpent)}</span>
                    <span className={item.percentageUsed > 100 ? 'text-rose-600 dark:text-rose-400' : ''}>
                      {item.percentageUsed}% of limit
                    </span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        item.percentageUsed > 100 ? 'bg-rose-500' :
                        item.percentageUsed >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, item.percentageUsed)}%` }}
                    />
                  </div>
                </div>

                {/* Inputs: Monthly Limit & Variance */}
                <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                  <div>
                    <label className="block text-slate-500 font-bold mb-1">Monthly Budget Limit (₱)</label>
                    <input
                      type="number"
                      step="100"
                      value={item.monthlyLimit / 100}
                      onChange={(e) => handleLimitChange(realIdx, parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono font-bold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 font-bold mb-1">Variance (Remaining)</label>
                    <div className={`w-full px-3 py-2 rounded-xl font-mono font-extrabold bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 ${
                      item.variance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {formatCurrency(item.variance)}
                    </div>
                  </div>
                </div>

                {/* Notes Input */}
                <div>
                  <input
                    type="text"
                    placeholder="Notes / justification..."
                    value={item.notes || ''}
                    onChange={(e) => handleNotesChange(realIdx, e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 rounded-lg text-slate-600 dark:text-slate-400 focus:outline-none"
                  />
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Add Custom Category Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Add Category Spending Target</h3>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Expense Category Name</label>
              <input
                type="text"
                placeholder="e.g. Software Subscriptions"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Monthly Limit (PHP ₱)</label>
              <input
                type="number"
                placeholder="50000"
                value={newCategoryLimit}
                onChange={(e) => setNewCategoryLimit(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCustomCategory}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold"
              >
                Add Category Limit
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
