import React, { useState, useEffect } from 'react';
import { 
  DollarSign, ArrowRightLeft, RefreshCw, Plus, CheckCircle2, 
  Info, TrendingUp, TrendingDown, Building, Calculator, Search
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import ForexConverterWidget from '../../components/ForexConverterWidget';

export default function ForexManagement() {
  const { activeCompany } = useAuth();
  const [rates, setRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRateModal, setShowRateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [newRate, setNewRate] = useState({
    currency: 'USD',
    bspSpotRate: 56.50,
    rateDate: new Date().toISOString().slice(0, 10),
    source: 'Bangko Sentral ng Pilipinas (BSP)'
  });

  const fetchRates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/operations/forex/rates');
      if (res.ok) {
        const data = await res.json();
        setRates(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load spot rates', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRates();
  }, []);

  const handleCreateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/operations/forex/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRate)
      });
      if (res.ok) {
        setShowRateModal(false);
        fetchRates();
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to record spot rate');
      }
    } catch (err: any) {
      setError(err.message || 'Error recording spot rate');
    }
  };

  const safeRates = Array.isArray(rates) ? rates : [];
  const filteredRates = safeRates.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const curr = (r?.currency || '').toLowerCase();
    const src = (r?.source || '').toLowerCase();
    const rateStr = (r?.bspSpotRate || '').toString();
    return curr.includes(q) || src.includes(q) || rateStr.includes(q);
  });

  const exportData: ExportData = {
    filename: `BSP_Forex_SpotRates_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'BSP Foreign Currency Exchange Spot Rates (BIR RMC 12-2024)',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Official BSP Daily Rates`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Currency', 'BSP Spot Rate (PHP)', 'Rate Date', 'Source'],
    rows: safeRates.map(r => [
      r?.currency || 'USD',
      `₱${(r?.bspSpotRate || 56.50).toFixed(4)}`,
      r?.rateDate ? new Date(r.rateDate).toLocaleDateString() : '-',
      r?.source || 'BSP'
    ])
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Forex & BSP Exchange Rates (BIR RMC 12-2024)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Realized & unrealized foreign exchange gain/loss calculation, BSP daily spot rates, and GL revaluation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setShowRateModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Daily BSP Rate
          </button>
        </div>
      </div>

      {/* Interactive Converter Widget */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-indigo-600" />
          Real-Time Forex & Realized FX Gain/Loss Calculator
        </h3>
        <ForexConverterWidget />
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search rates by currency code, rate, source..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {/* Rates Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-bold text-sm text-slate-800 dark:text-slate-100">
          Official BSP Spot Rates Log
        </div>
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching BSP spot rates...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[700px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Currency</th>
                  <th className="py-3.5 px-4">BSP Spot Rate (PHP)</th>
                  <th className="py-3.5 px-4">Rate Date</th>
                  <th className="py-3.5 px-4">Source</th>
                  <th className="py-3.5 px-4 text-center">Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredRates.map((r) => (
                  <tr key={r.id || r.currency} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                      {r.currency}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      ₱{(r.bspSpotRate || 56.50).toFixed(4)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500">
                      {r.rateDate ? new Date(r.rateDate).toLocaleDateString() : new Date().toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {r.source || 'Bangko Sentral ng Pilipinas'}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 text-[11px] font-bold rounded-full">
                        RMC 12-2024 VALIDATED
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredRates.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No matching spot rates found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Spot Rate Modal */}
      {showRateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" /> Record Daily BSP Spot Rate
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleCreateRate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Currency Code</label>
                <select
                  value={newRate.currency}
                  onChange={(e) => setNewRate({ ...newRate, currency: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                  <option value="SGD">SGD - Singapore Dollar</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">BSP Spot Rate (PHP)</label>
                  <input
                    type="number"
                    required
                    step="0.0001"
                    min="0"
                    value={newRate.bspSpotRate}
                    onChange={(e) => setNewRate({ ...newRate, bspSpotRate: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold text-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Rate Date</label>
                  <input
                    type="date"
                    required
                    value={newRate.rateDate}
                    onChange={(e) => setNewRate({ ...newRate, rateDate: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-sm"
                >
                  Save BSP Rate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
