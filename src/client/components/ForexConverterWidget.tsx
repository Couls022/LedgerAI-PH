import React, { useState, useEffect } from 'react';
import { DollarSign, ArrowRightLeft, RefreshCw, Info } from 'lucide-react';

interface ForexConverterWidgetProps {
  onApplyPhpAmount?: (amountPhp: number, currency: string, rate: number, foreignAmount: number) => void;
  defaultCurrency?: string;
  defaultForeignAmount?: number;
}

export default function ForexConverterWidget({
  onApplyPhpAmount,
  defaultCurrency = 'USD',
  defaultForeignAmount = 1000
}: ForexConverterWidgetProps) {
  const [currency, setCurrency] = useState(defaultCurrency);
  const [foreignAmount, setForeignAmount] = useState<number>(defaultForeignAmount);
  const [spotRate, setSpotRate] = useState<number>(56.50);
  const [settlementRate, setSettlementRate] = useState<number>(57.20);
  const [loading, setLoading] = useState(false);
  const [fxCalculation, setFxCalculation] = useState<any>(null);

  const fetchSpotRates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/operations/forex/rates');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const match = data.find((r: any) => r.currency === currency) || data[0];
          if (match && match.bspSpotRate) {
            setSpotRate(match.bspSpotRate);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load spot rates', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpotRates();
  }, [currency]);

  const calculateFx = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        invoiceRate: String(spotRate),
        paymentRate: String(settlementRate),
        foreignAmountUsd: String(foreignAmount)
      });
      const res = await fetch(`/api/operations/forex/calculate-realized?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setFxCalculation(data);
      }
    } catch (err) {
      console.error('Error calculating FX', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    calculateFx();
  }, [spotRate, settlementRate, foreignAmount, currency]);

  const convertedPhp = Math.round(foreignAmount * spotRate * 100) / 100;

  return (
    <div className="bg-slate-50 dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
            Forex Currency Converter (BIR RMC 12-2024)
          </h4>
        </div>
        <button
          type="button"
          onClick={fetchSpotRates}
          disabled={loading}
          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          title="Refresh BSP Spot Rates"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
          >
            <option value="USD">USD - US Dollar</option>
            <option value="EUR">EUR - Euro</option>
            <option value="JPY">JPY - Japanese Yen</option>
            <option value="SGD">SGD - Singapore Dollar</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Foreign Amount ({currency})</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={foreignAmount}
            onChange={(e) => setForeignAmount(parseFloat(e.target.value) || 0)}
            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">BSP Spot Rate (PHP/{currency})</label>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={spotRate}
            onChange={(e) => setSpotRate(parseFloat(e.target.value) || 0)}
            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono font-bold text-emerald-600 dark:text-emerald-400"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 gap-2">
        <div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Converted Local Valuation (PHP):</span>
          <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
            ₱{convertedPhp.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {onApplyPhpAmount && (
          <button
            type="button"
            onClick={() => onApplyPhpAmount(convertedPhp, currency, spotRate, foreignAmount)}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1 shrink-0"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Apply ₱{convertedPhp.toFixed(2)}
          </button>
        )}
      </div>

      {fxCalculation && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-800">
          <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
          <span>
            <strong>BIR RMC 12-2024 Note:</strong> Realized FX fluctuations are included in ITR taxable income. Unrealized FX differences are tracked separately.
          </span>
        </div>
      )}
    </div>
  );
}
