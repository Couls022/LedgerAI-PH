import React, { useEffect, useState, useCallback } from 'react';
import { WifiOff, RefreshCw, CheckCircle2, ServerCrash } from 'lucide-react';

export default function ServerConnectionBanner() {
  const [serverUnavailable, setServerUnavailable] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const [justRecovered, setJustRecovered] = useState(false);

  const checkHealth = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        setServerUnavailable(false);
        setReason('');
        setJustRecovered(true);
        window.dispatchEvent(new CustomEvent('ledgerai:server-available'));
        setTimeout(() => setJustRecovered(false), 4000);
      }
    } catch {
      // Remain in unavailable state
    } finally {
      setChecking(false);
    }
  }, [checking]);

  useEffect(() => {
    const onUnavailable = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      setServerUnavailable(true);
      setJustRecovered(false);
      setReason(
        detail?.message ||
          'Cannot reach the LedgerAI PH central server. Verify that the central server PC is powered on and connected to the office network.'
      );
    };

    const onAvailable = () => {
      setServerUnavailable((prev) => {
        if (prev) {
          setJustRecovered(true);
          setTimeout(() => setJustRecovered(false), 3500);
        }
        return false;
      });
      setReason('');
    };

    window.addEventListener('ledgerai:server-unavailable', onUnavailable);
    window.addEventListener('ledgerai:server-available', onAvailable);
    window.addEventListener('online', checkHealth);

    return () => {
      window.removeEventListener('ledgerai:server-unavailable', onUnavailable);
      window.removeEventListener('ledgerai:server-available', onAvailable);
      window.removeEventListener('online', checkHealth);
    };
  }, [checkHealth]);

  // Automatic background health poll while central server is unreachable
  useEffect(() => {
    if (!serverUnavailable) return;
    const interval = setInterval(() => {
      checkHealth();
    }, 6000);
    return () => clearInterval(interval);
  }, [serverUnavailable, checkHealth]);

  if (justRecovered && !serverUnavailable) {
    return (
      <div
        role="status"
        data-testid="server-reconnected-banner"
        className="w-full bg-teal-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 z-50"
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>Connection to the LedgerAI PH central server has been restored.</span>
      </div>
    );
  }

  if (!serverUnavailable) return null;

  return (
    <div
      role="alert"
      data-testid="server-unavailable-banner"
      className="w-full bg-rose-700 dark:bg-rose-900 text-white px-4 py-2.5 border-b border-rose-800 dark:border-rose-700 z-50"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="flex items-start sm:items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-white/15 shrink-0 mt-0.5 sm:mt-0">
            {navigator.onLine === false ? (
              <WifiOff className="w-4 h-4 text-rose-100" />
            ) : (
              <ServerCrash className="w-4 h-4 text-rose-100" />
            )}
          </div>
          <div>
            <p className="font-bold text-white">Central Server Unreachable</p>
            <p className="text-rose-100 leading-snug mt-0.5">
              {reason ||
                'Cannot connect to the LedgerAI PH central server. Your saved company preference is preserved and no data source was switched.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={checkHealth}
          disabled={checking}
          data-testid="server-retry-connection-btn"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white text-rose-800 hover:bg-rose-50 disabled:opacity-70 font-bold text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'Checking Server...' : 'Retry Connection'}</span>
        </button>
      </div>
    </div>
  );
}
