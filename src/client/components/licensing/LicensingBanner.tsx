import React, { useEffect, useState } from 'react';
import { ShieldCheck, Key, AlertTriangle, CheckCircle2, Lock, RefreshCw } from 'lucide-react';
import LicenseActivation from './LicenseActivation';

import { apiFetch } from '../../utils/apiClient';

export default function LicensingBanner() {
  const [license, setLicense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchLicense = async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`/api/licensing/status?t=${Date.now()}`);
      setLicense(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicense();
    
    // Listen for custom event to trigger refresh from other components
    const handleRefresh = () => fetchLicense();
    window.addEventListener('refresh-license-banner', handleRefresh);
    return () => window.removeEventListener('refresh-license-banner', handleRefresh);
  }, []);

  if (loading || !license) return null;

  // HIDE WARNING BANNER IF ENTERPRISE + LIFETIME + ACTIVE
  const planName = (license.planType || license.plan || '').toUpperCase();
  const isLifetime = Boolean(
    license.isLifetime || 
    license.expirationDate === 'LIFETIME' || 
    license.licenseType === 'LIFETIME' || 
    license.type === 'LIFETIME'
  );
  const isActive = license.status === 'ACTIVE' || license.status === 'ACTIVATED';

  // Enterprise Lifetime Active -> Warning/Banner completely disappears
  if (planName === 'ENTERPRISE' && isLifetime && isActive) {
    return null;
  }

  // Determine display label for duration/cycle
  let cycleLabel = 'TRIAL';
  if (isLifetime) {
    cycleLabel = 'LIFETIME';
  } else if (license.expirationDate && license.expirationDate !== 'N/A') {
    cycleLabel = `EXPIRES ${license.expirationDate}`;
  }

  return (
    <div className="bg-[#F1F5F9] dark:bg-slate-950 text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg border ${isActive ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400' : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400'}`}>
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold ${isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700'}`}>
            STATUS: {license.status}
          </span>
          <span className="text-slate-600 dark:text-slate-300 font-medium text-xs">
            Expiration: <strong className="text-slate-800 dark:text-slate-100">{isLifetime ? 'LIFETIME' : (license.expirationDate || 'N/A')}</strong>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm transition-all text-xs"
        >
          {isActive ? 'Manage / Upgrade License' : 'Activate Production License'}
        </button>
      </div>

      {isModalOpen && (
        <LicenseActivation
          isModal={true}
          onSuccess={() => {
            setIsModalOpen(false);
            fetchLicense();
          }}
          onCancel={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}

