import React, { useEffect, useState } from 'react';
import { ShieldCheck, Key, AlertTriangle, CheckCircle2, Lock, RefreshCw } from 'lucide-react';
import LicenseActivation from './LicenseActivation';

import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';

export default function LicensingBanner() {
  const { activeCompany, hasPermission } = useAuth();
  const [license, setLicense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const canManageLicense = hasPermission(['settings:manage']);

  const fetchLicense = async () => {
    if (!activeCompany) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await apiFetch(`/api/licensing/status?t=${Date.now()}`);
      setLicense(data);
    } catch (err: any) {
      // Quietly ignore unauthenticated or invalid session states
      if (err?.status !== 401 && !err?.message?.includes('Company not found') && !err?.message?.includes('session')) {
        console.warn('Licensing banner status check:', err?.message || err);
      }
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
  }, [activeCompany?.id]);

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
  const inGracePeriod = Boolean(license.inGracePeriod || license.status === 'GRACE_PERIOD');
  const isExpired = license.status === 'EXPIRED';
  const isRevokedOrSuspended = license.status === 'REVOKED' || license.status === 'SUSPENDED';
  const isRecoveryRequired = Boolean(license.recoveryRequired || license.status === 'RECOVERY_REQUIRED' || license.status === 'TAMPERED');

  // Enterprise Lifetime Active -> Warning/Banner completely disappears
  if (planName === 'ENTERPRISE' && isLifetime && isActive && !isRecoveryRequired) {
    return null;
  }

  return (
    <div
      className={`border-b px-3 sm:px-5 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs transition-colors ${
        inGracePeriod
          ? 'bg-amber-500/10 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800/80'
          : isExpired || isRevokedOrSuspended || isRecoveryRequired
          ? 'bg-rose-500/10 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 border-rose-300 dark:border-rose-800/80'
          : planName === 'TRIAL'
          ? 'bg-sky-500/10 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 border-sky-300 dark:border-sky-800/80'
          : 'bg-slate-50/90 dark:bg-[#0D1524] text-slate-900 dark:text-slate-100 border-slate-200/80 dark:border-[#1E2D45]'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
            inGracePeriod
              ? 'bg-amber-100 dark:bg-amber-900/60 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
              : isExpired || isRevokedOrSuspended || isRecoveryRequired
              ? 'bg-rose-100 dark:bg-rose-900/60 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300'
              : planName === 'TRIAL'
              ? 'bg-sky-100 dark:bg-sky-900/60 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300'
              : 'bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800/80 text-teal-700 dark:text-teal-300'
          }`}
        >
          {inGracePeriod ? (
            <AlertTriangle className="w-4 h-4 animate-pulse" />
          ) : isExpired || isRevokedOrSuspended || isRecoveryRequired ? (
            <Lock className="w-4 h-4" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold whitespace-nowrap border ${
              inGracePeriod
                ? 'bg-amber-200/70 text-amber-900 dark:bg-amber-900/80 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                : isExpired || isRevokedOrSuspended || isRecoveryRequired
                ? 'bg-rose-200/70 text-rose-900 dark:bg-rose-900/80 dark:text-rose-200 border-rose-300 dark:border-rose-700'
                : planName === 'TRIAL'
                ? 'bg-sky-200/70 text-sky-900 dark:bg-sky-900/80 dark:text-sky-200 border-sky-300 dark:border-sky-700'
                : 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200 dark:border-teal-800'
            }`}
          >
            {inGracePeriod ? 'GRACE PERIOD' : isRecoveryRequired ? 'RECOVERY REQUIRED' : isRevokedOrSuspended ? license.status : isExpired ? 'EXPIRED' : planName === 'TRIAL' ? '15-DAY TRIAL' : license.status}
          </span>
          <span className="text-xs whitespace-nowrap">
            {inGracePeriod ? (
              <span>
                Trial Expired &middot; <strong className="font-bold underline">{license.graceDaysRemaining ?? 15} Day(s) Remaining</strong> in Grace Period (Lock Date: {license.graceExpirationDate || 'Soon'})
              </span>
            ) : isRecoveryRequired ? (
              <span className="font-semibold text-rose-700 dark:text-rose-300">
                {license.verificationError || 'License verification / metadata recovery required before full operations.'}
              </span>
            ) : isRevokedOrSuspended ? (
              <span className="font-semibold text-rose-700 dark:text-rose-300">
                License {license.status} &middot; Contact your License Authority.
              </span>
            ) : isExpired ? (
              <span className="font-semibold text-rose-700 dark:text-rose-300">
                15-Day Trial and 15-Day Grace Period Have Ended &middot; Workspace Locked
              </span>
            ) : planName === 'TRIAL' ? (
              <span>
                15-Day Free Trial &middot; <strong className="font-mono font-bold">{license.trialDaysRemaining ?? 15} Day(s) Remaining</strong> (Valid until {license.expirationDate})
              </span>
            ) : (
              <span>
                Valid until{' '}
                <strong className="font-mono text-slate-800 dark:text-slate-100">
                  {isLifetime ? 'LIFETIME' : license.expirationDate || 'N/A'}
                </strong>
              </span>
            )}
          </span>
        </div>
      </div>

      {canManageLicense && (
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className={`px-3 py-1.5 rounded-lg font-semibold transition-colors text-xs whitespace-nowrap shrink-0 cursor-pointer shadow-xs ${
            inGracePeriod
              ? 'bg-amber-600 hover:bg-amber-700 text-white'
              : isExpired
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-[#0F1C2E] hover:bg-[#172A45] dark:bg-blue-600 dark:hover:bg-blue-500 text-white'
          }`}
        >
          {inGracePeriod || isExpired ? 'Activate License Key' : isActive ? 'Manage License' : 'Activate License'}
        </button>
      )}

      {isModalOpen && canManageLicense && (
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

