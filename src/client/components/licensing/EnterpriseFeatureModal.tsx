import React from 'react';
import { Crown, Sparkles, Check, ArrowRight, X, ShieldCheck, Key } from 'lucide-react';

interface EnterpriseFeatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
  onOpenLicenseModal?: () => void;
}

export const ENTERPRISE_FEATURES_LIST = [
  { title: "Unlimited Multi-Workstation LAN Cluster", desc: "Uncapped simultaneous PC concurrency and multi-branch networking (Pro tier is limited to 3 concurrent workstations)." },
  { title: "Departmental Budgeting & Variance", desc: "Multi-department cost center allocations and variance forecasting analysis." },
  { title: "Multi-Level Corporate Approval Workflows", desc: "Executive signing hierarchies, threshold delegation, and SLA tracking." },
  { title: "Forensic & Fraud Anomaly Detection", desc: "Benford's Law distribution analysis, abnormal hour alerts, and duplicate payment detection." },
  { title: "PSA Working Papers & Audit Lead Sheets", desc: "Philippine Standards on Auditing (PSA 230/500) compliance workpaper binders." },
  { title: "Foreign Exchange (Forex) Multi-Currency", desc: "Multi-currency revaluation and statutory Philippine Forex gain/loss tracking." },
  { title: "Enterprise Custom RBAC Matrix", desc: "Granular custom role overrides and organizational cost center dimensions." },
  { title: "Cryptographic Disaster Recovery Vault", desc: "10-year statutory retention inbox and automated database snapshot archives." }
];

export default function EnterpriseFeatureModal({
  isOpen,
  onClose,
  featureName,
  onOpenLicenseModal
}: EnterpriseFeatureModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white dark:bg-[#0D1524] rounded-2xl border border-indigo-200 dark:border-indigo-900/60 shadow-2xl overflow-hidden">
        {/* Top Header Glow */}
        <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 p-6 text-white relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-[11px] font-bold uppercase tracking-wider text-white">
              <Crown className="w-3.5 h-3.5 text-amber-300" />
              Enterprise Plan Exclusive
            </span>
          </div>
          <h2 className="text-xl font-bold font-display text-white">
            {featureName ? `${featureName}` : 'Exclusive Enterprise Module'}
          </h2>
          <p className="text-xs text-indigo-100 mt-1 leading-relaxed">
            Your active company workspace is currently running on the <strong className="text-white underline">Pro Plan</strong>. This advanced enterprise capability is available on the <strong className="text-amber-200">Enterprise Plan</strong>.
          </p>
        </div>

        {/* Feature Highlights Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            What's included in the Enterprise Tier:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ENTERPRISE_FEATURES_LIST.map((feat, idx) => (
              <div 
                key={idx}
                className="p-3 rounded-xl bg-slate-50 dark:bg-[#141F36] border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-semibold text-xs mb-1">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>{feat.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
                    {feat.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>Notice:</strong> All core Philippine accounting, bookkeeping, inventory, payroll, and BIR statutory tax compliance (Forms 2550Q, 1702, 2307, SAWT, SLSP) and the <strong>Ledger Agent AI Assistant</strong> remain 100% fully active in your <strong>Pro Plan</strong>.
            </p>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 bg-slate-50 dark:bg-[#0A101C] border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Continue in Pro Plan
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              if (onOpenLicenseModal) {
                onOpenLicenseModal();
              } else {
                window.dispatchEvent(new CustomEvent('open-license-modal'));
              }
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold text-xs shadow-md shadow-indigo-600/25 transition-all cursor-pointer"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Enter Enterprise License Key</span>
          </button>
        </div>
      </div>
    </div>
  );
}
