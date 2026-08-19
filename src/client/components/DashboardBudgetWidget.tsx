import React, { useEffect, useState } from 'react';
import { PieChart, ArrowUpRight, AlertTriangle, CheckCircle2, ChevronRight, Sliders } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';

interface BudgetWidgetProps {
  formatCurrency: (amountCentavos: number) => string;
}

export default function DashboardBudgetWidget({ formatCurrency }: BudgetWidgetProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>('/api/budgets')
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching budget summary widget:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4"></div>
        <div className="h-8 bg-slate-100 dark:bg-slate-700/50 rounded w-full"></div>
      </div>
    );
  }

  const summary = data?.summary;
  const topBudgets = (data?.budgets || [])
    .slice()
    .sort((a: any, b: any) => b.percentageUsed - a.percentageUsed)
    .slice(0, 4);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs space-y-4">
      
      {/* Widget Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
              Monthly Budget & Spending Variance
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Expense targets & real-time MTD variance tracking
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate('/budget')}
          className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1 bg-indigo-50/80 dark:bg-indigo-950/40 px-3 py-1.5 rounded-xl border border-indigo-100 dark:border-indigo-900/40 transition-colors"
        >
          <span>Manage Limits</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* KPI Overview Bar */}
      {summary && (
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Allocated Budget</p>
            <p className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono">
              {formatCurrency(summary.totalBudget)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Actual MTD Spend</p>
            <p className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono">
              {formatCurrency(summary.totalActual)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Remaining / Variance</p>
            <p className={`text-lg font-black font-mono ${
              summary.netVariance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {formatCurrency(summary.netVariance)}
            </p>
          </div>
        </div>
      )}

      {/* Top Categories Progress Breakdown */}
      <div className="space-y-3 pt-1">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Highest Budget Utilization Categories:
        </p>

        {topBudgets.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {topBudgets.map((b: any) => (
              <div 
                key={b.category} 
                className="p-3 bg-slate-50/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200">
                  <span className="truncate">{b.category}</span>
                  <span className={b.percentageUsed > 100 ? 'text-rose-600 font-mono' : 'font-mono'}>
                    {b.percentageUsed}%
                  </span>
                </div>

                <div className="bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      b.percentageUsed > 100 ? 'bg-rose-500' :
                      b.percentageUsed >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, b.percentageUsed)}%` }}
                  />
                </div>

                <div className="flex justify-between text-[11px] font-mono text-slate-500">
                  <span>Spent: {formatCurrency(b.actualSpent)}</span>
                  <span>Limit: {formatCurrency(b.monthlyLimit)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">No budget targets set yet for this month.</p>
        )}
      </div>

    </div>
  );
}
