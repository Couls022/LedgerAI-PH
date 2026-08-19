import React from 'react';

interface LogoProps {
  className?: string;
  size?: number | string;
  variant?: 'full' | 'icon' | 'badge';
  dark?: boolean;
}

/**
 * LedgerAI PH Unique Brand Emblem
 * Represents modern Philippine Accounting & Financial Intelligence:
 * - Interlocking geometric ledger leaves / balance sheets (Left & Right Debit/Credit symmetry)
 * - Intelligent AI data node / neural dot at the core
 * - Philippine archipelago tricolor / warm golden-emerald financial accents
 */
export const LedgerLogoIcon: React.FC<{ size?: number; className?: string }> = ({ 
  size = 32, 
  className = "" 
}) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 48 48" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ledgerGradPrimary" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="ledgerGradGold" x1="20" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="ledgerGradSheet" x1="8" y1="12" x2="28" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>

      {/* Rounded Modern App Shield / Ledger Base */}
      <rect x="3" y="3" width="42" height="42" rx="12" fill="#0f172a" />
      <rect x="3" y="3" width="42" height="42" rx="12" stroke="url(#ledgerGradPrimary)" strokeWidth="1.5" strokeOpacity="0.4" />

      {/* Left Sheet: The Accounting Ledger Book (Debit Column / Structured Rows) */}
      <path 
        d="M12 12C12 10.8954 12.8954 10 14 10H22C23.1046 10 24 10.8954 24 12V36C24 37.1046 23.1046 38 22 38H14C12.8954 38 12 37.1046 12 36V12Z" 
        fill="url(#ledgerGradSheet)" 
        fillOpacity="0.85" 
      />
      {/* Ledger Spine & Ruled Accounting lines */}
      <line x1="15" y1="16" x2="21" y2="16" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.9" />
      <line x1="15" y1="22" x2="21" y2="22" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.7" />
      <line x1="15" y1="28" x2="19" y2="28" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5" />

      {/* Right Modern Diamond: The AI Intelligence & Growth Vector */}
      <path 
        d="M26 12C26 10.8954 26.8954 10 28 10H34C35.1046 10 36 10.8954 36 12V24L26 34V12Z" 
        fill="url(#ledgerGradGold)" 
      />

      {/* Growth Trend Bar / Tax Clearance Check */}
      <path 
        d="M28 26L32 30L38 22" 
        stroke="#ffffff" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
      />

      {/* Synchronized Core Neural Pulse (The AI Synapse) */}
      <circle cx="25" cy="24" r="3" fill="#ffffff" />
      <circle cx="25" cy="24" r="4.5" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.8" />
    </svg>
  );
};

export const LedgerLogo: React.FC<LogoProps> = ({ 
  className = "", 
  size = 36, 
  variant = 'full',
  dark = false
}) => {
  if (variant === 'icon') {
    return <LedgerLogoIcon size={typeof size === 'number' ? size : 36} className={className} />;
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LedgerLogoIcon size={typeof size === 'number' ? size : 36} />
      {variant === 'full' && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 leading-none">
            <span className={`font-black tracking-tight text-base ${dark ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
              Ledger<span className="text-indigo-600 dark:text-indigo-400">AI</span>
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
              PH
            </span>
          </div>
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">
            Accounting & Tax Engine
          </span>
        </div>
      )}
    </div>
  );
};

export default LedgerLogo;
