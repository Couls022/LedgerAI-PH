import React, { useState, useEffect } from 'react';
import { Coins, ArrowRightLeft, RefreshCw, Info, AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface MonetaryAccountOption {
  id?: string;
  accountId?: string;
  accountCode: string;
  accountName: string;
  currency?: string;
}

interface ForexConverterWidgetProps {
  onApplyPhpAmount?: (amountPhp: number, currency: string, rate: number, foreignAmount: number) => void;
  defaultCurrency?: string;
  defaultForeignAmount?: number;
  refreshKey?: number;
  monetaryAccounts?: MonetaryAccountOption[];
  onRealizedPosted?: () => void;
}

export default function ForexConverterWidget({
  onApplyPhpAmount,
  defaultCurrency = 'USD',
  defaultForeignAmount = 1000,
  refreshKey = 0,
  monetaryAccounts = [],
  onRealizedPosted
}: ForexConverterWidgetProps) {
  const [currency, setCurrency] = useState(defaultCurrency);
  const [foreignAmount, setForeignAmount] = useState<number>(defaultForeignAmount);
  const [spotRate, setSpotRate] = useState<string>('');
  const [settlementRate, setSettlementRate] = useState<string>('');
  const [missingRateNotice, setMissingRateNotice] = useState<string | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fxCalculation, setFxCalculation] = useState<any>(null);

  // Realized FX GL Posting panel state (BIR RMC 12-2024)
  const [showPostPanel, setShowPostPanel] = useState(false);
  const [postDate, setPostDate] = useState(new Date().toISOString().slice(0, 10));
  const [postRef, setPostRef] = useState(`FX-REAL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
  const [postTargetAccountId, setPostTargetAccountId] = useState('');
  const [postingRealized, setPostingRealized] = useState(false);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const fetchSpotRates = async () => {
    setLoading(true);
    setMissingRateNotice(null);
    try {
      const data = await apiFetch<any[]>('/api/operations/forex/rates');
      const matches = Array.isArray(data)
        ? data.filter((r: any) => String(r.currency || '').toUpperCase() === currency.toUpperCase())
        : [];
      if (matches.length > 0 && Number(matches[0].bspSpotRate) > 0) {
        const latest = Number(matches[0].bspSpotRate);
        const formattedRate = Number(latest.toFixed(6)).toString();
        setSpotRate(formattedRate);
        setSettlementRate(formattedRate);
      } else {
        setSpotRate('');
        setSettlementRate('');
        setFxCalculation(null);
        setMissingRateNotice(`No recorded BSP spot rate found for ${currency}. Record an official BSP spot rate or enter a rate explicitly.`);
      }
    } catch (err) {
      console.error('Failed to load spot rates', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpotRates();
  }, [currency, refreshKey]);

  const numericSpotRate = Number(spotRate);
  const numericSettlementRate = Number(settlementRate || spotRate);

  const calculateFx = async () => {
    if (
      !Number.isFinite(foreignAmount) ||
      foreignAmount <= 0 ||
      !Number.isFinite(numericSpotRate) ||
      numericSpotRate <= 0 ||
      !Number.isFinite(numericSettlementRate) ||
      numericSettlementRate <= 0
    ) {
      setFxCalculation(null);
      return;
    }
    setCalcError(null);
    try {
      const query = new URLSearchParams({
        currency,
        invoiceRate: String(numericSpotRate),
        paymentRate: String(numericSettlementRate),
        foreignAmountUsd: String(foreignAmount)
      });
      const data = await apiFetch<any>(`/api/operations/forex/calculate-realized?${query.toString()}`);
      setFxCalculation(data);
    } catch (err: any) {
      setFxCalculation(null);
      setCalcError(err?.message || 'Error calculating FX');
    }
  };

  useEffect(() => {
    calculateFx();
  }, [spotRate, settlementRate, foreignAmount, currency]);

  const handlePostRealizedFx = async (e: React.FormEvent) => {
    e.preventDefault();
    setPostError(null);
    setPostSuccess(null);
    setPostingRealized(true);
    try {
      const res = await apiFetch<any>('/api/operations/forex/revalue-and-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionNumber: postRef.trim() || `FX-REAL-${Date.now()}`,
          transactionDate: postDate,
          foreignAmount,
          recordedRate: numericSpotRate,
          settlementRate: numericSettlementRate,
          currency,
          targetAccountId: postTargetAccountId || undefined,
          revaluationType: 'REALIZED',
          sourceType: 'MANUAL_SETTLEMENT',
        }),
      });
      setPostSuccess(res?.message || 'Realized FX Gain/Loss JE posted to General Ledger.');
      setShowPostPanel(false);
      onRealizedPosted?.();
    } catch (err: any) {
      setPostError(err?.message || 'Failed to post Realized FX journal entry.');
    } finally {
      setPostingRealized(false);
    }
  };

  const convertedPhp =
    Number.isFinite(foreignAmount) && Number.isFinite(numericSpotRate) && numericSpotRate > 0
      ? Math.round(foreignAmount * numericSpotRate * 100) / 100
      : null;

  const hasNonZeroRealizedVariance =
    fxCalculation && Number(fxCalculation.realizedFxAmountPhp || 0) > 0;

  return (
    <div className="bg-slate-50 dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
            Forex Currency Converter (PHP / BIR RMC 12-2024)
          </h4>
        </div>
        <button
          type="button"
          onClick={fetchSpotRates}
          disabled={loading}
          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          title="Refresh BSP Spot Rates"
          aria-label="Refresh BSP Spot Rates"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {missingRateNotice && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
          <span>{missingRateNotice}</span>
        </div>
      )}

      {calcError && (
        <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
          {calcError}
        </div>
      )}

      {postSuccess && (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-200">
          <span className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {postSuccess}
          </span>
          <button type="button" onClick={() => setPostSuccess(null)} className="underline">Dismiss</button>
        </div>
      )}

      {postError && (
        <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
          {postError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
            <option value="GBP">GBP - British Pound</option>
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
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Recorded BSP Rate (₱/{currency})</label>
          <input
            type="number"
            min="0"
            step="0.0001"
            placeholder="Enter official BSP rate"
            value={spotRate}
            onChange={(e) => setSpotRate(e.target.value)}
            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 font-mono font-bold text-emerald-600 dark:text-emerald-400"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Settlement Rate (₱/{currency})</label>
          <input
            type="number"
            min="0"
            step="0.0001"
            placeholder="Settlement rate"
            value={settlementRate}
            onChange={(e) => setSettlementRate(e.target.value)}
            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono font-bold"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 gap-2">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Converted Valuation (PHP @ Recorded):</span>
            <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
              {convertedPhp !== null
                ? `₱${convertedPhp.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </div>
          </div>

          {fxCalculation && (() => {
            const varianceAmt = Number(fxCalculation.realizedFxAmountPhp || 0);
            const isGain = varianceAmt > 0 && fxCalculation.type === 'REALIZED_FX_GAIN';
            const isLoss = varianceAmt > 0 && fxCalculation.type === 'REALIZED_FX_LOSS';
            return (
              <div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Realized Variance ({isGain ? 'Realized FX Gain' : isLoss ? 'Realized FX Loss' : 'No Variance'}):
                </span>
                <div
                  className={`text-sm font-bold font-mono ${
                    isGain
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isLoss
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {isGain ? '+' : isLoss ? '-' : ''}₱
                  {varianceAmt.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {hasNonZeroRealizedVariance && !onApplyPhpAmount && (
            <button
              type="button"
              onClick={() => {
                setShowPostPanel((prev) => !prev);
                setPostError(null);
              }}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {showPostPanel ? 'Hide GL Posting' : 'Post Realized FX JE'}
            </button>
          )}

          {onApplyPhpAmount && convertedPhp !== null && (
            <button
              type="button"
              onClick={() => onApplyPhpAmount(convertedPhp, currency, numericSpotRate, foreignAmount)}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Apply ₱{convertedPhp.toFixed(2)}
            </button>
          )}
        </div>
      </div>

      {showPostPanel && hasNonZeroRealizedVariance && (
        <form
          onSubmit={handlePostRealizedFx}
          className="bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/70 rounded-lg p-3 space-y-2.5"
        >
          <div className="text-[11px] font-bold text-indigo-800 dark:text-indigo-200 uppercase tracking-wider">
            Post Realized FX Settlement Journal Entry (Taxable under BIR RMC 12-2024)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Settlement Date</label>
              <input
                type="date"
                required
                value={postDate}
                onChange={(e) => setPostDate(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Reference #</label>
              <input
                type="text"
                required
                value={postRef}
                onChange={(e) => setPostRef(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Offset Monetary Account (Optional)</label>
              <select
                value={postTargetAccountId}
                onChange={(e) => setPostTargetAccountId(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              >
                <option value="">Auto-resolve default Cash/Bank</option>
                {monetaryAccounts.map((acc) => {
                  const idVal = acc.accountId || acc.id || '';
                  return (
                    <option key={idVal} value={idVal}>
                      {acc.accountCode} — {acc.accountName}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPostPanel(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={postingRealized}
              className="px-3.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
            >
              {postingRealized ? 'Posting JE...' : 'Confirm & Post to GL'}
            </button>
          </div>
        </form>
      )}

      {fxCalculation && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-800">
          <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
          <span>
            <strong>BIR RMC 12-2024 Note:</strong> Realized FX fluctuations are included in ITR taxable income. Period-end unrealized FX differences are tracked separately and excluded from ITR until realized.
          </span>
        </div>
      )}
    </div>
  );
}
