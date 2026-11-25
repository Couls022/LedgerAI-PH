import React from 'react';

interface LogoProps {
  className?: string;
  size?: number | string;
  variant?: 'full' | 'icon' | 'badge';
  dark?: boolean;
}

/**
 * LedgerAI PH Brand Emblem — Sovereign Slate, Oceanic Cobalt & Philippine Emerald-Gold
 */
export const LedgerLogoIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 32,
  className = '',
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
        <linearGradient id="ledgerSovereignBorder" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="55%" stopColor="#0EA5E9" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
        <linearGradient id="ledgerEmeraldGold" x1="22" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#14B8A6" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
        <linearGradient id="ledgerCobaltSheet" x1="10" y1="10" x2="26" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>

      <rect x="3" y="3" width="42" height="42" rx="12" fill="#0F1C2E" />
      <rect x="3" y="3" width="42" height="42" rx="12" stroke="url(#ledgerSovereignBorder)" strokeWidth="1.5" strokeOpacity="0.65" />

      {/* Left Ledger Leaf */}
      <path
        d="M12 12C12 10.8954 12.8954 10 14 10H22C23.1046 10 24 10.8954 24 12V36C24 37.1046 23.1046 38 22 38H14C12.8954 38 12 37.1046 12 36V12Z"
        fill="url(#ledgerCobaltSheet)"
      />
      <line x1="15" y1="16" x2="21" y2="16" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.92" />
      <line x1="15" y1="22" x2="21" y2="22" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.72" />
      <line x1="15" y1="28" x2="19" y2="28" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.52" />

      {/* Right Verification Leaf */}
      <path
        d="M26 12C26 10.8954 26.8954 10 28 10H34C35.1046 10 36 10.8954 36 12V24L26 34V12Z"
        fill="url(#ledgerEmeraldGold)"
      />
      <path
        d="M28 26.5L31.5 30L37.5 22.5"
        stroke="#FFFFFF"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Precision Balance Node */}
      <circle cx="25" cy="24" r="2.75" fill="#F8FAFC" />
      <circle cx="25" cy="24" r="4.25" stroke="#38BDF8" strokeWidth="1" strokeOpacity="0.75" />
    </svg>
  );
};

export const LedgerLogo: React.FC<LogoProps> = ({
  className = '',
  size = 36,
  variant = 'full',
  dark = false,
}) => {
  if (variant === 'icon') {
    return <LedgerLogoIcon size={typeof size === 'number' ? size : 36} className={className} />;
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LedgerLogoIcon size={typeof size === 'number' ? size : 36} />
      {variant === 'full' && (
        <div className="flex flex-col">
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className={`font-display font-extrabold tracking-tight text-base ${dark ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
              Ledger<span className="text-blue-600 dark:text-sky-400">AI</span>
            </span>
            <span className={`font-display text-xs font-bold tracking-wider ${dark ? 'text-teal-300' : 'text-teal-700 dark:text-teal-400'}`}>
              PH
            </span>
          </div>
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tracking-wide mt-0.5">
            Philippine Accounting Suite
          </span>
        </div>
      )}
    </div>
  );
};

export default LedgerLogo;
