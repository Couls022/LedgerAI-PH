import React, { useState } from 'react';
import ClientApp from './ClientApp';
import LicenseAuthorityApp from './LicenseAuthorityApp';

export default function DevAppSwitcher() {
  const [activeApp, setActiveApp] = useState<'CLIENT' | 'AUTHORITY'>('CLIENT');

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Dev Switcher Header */}
      <div className="bg-[#F1F5F9] text-slate-800 border-b border-slate-200 p-2 relative z-50 flex items-center justify-center text-xs shrink-0">
        <div className="flex items-center gap-6">
          <div className="font-bold text-slate-900 tracking-widest text-[11px]">LEDGERAI PH <span className="text-emerald-600 font-black">DEV PREVIEW</span></div>
          <div className="flex bg-slate-100 rounded-lg p-1 gap-1 border border-slate-200">
            <button 
              onClick={() => setActiveApp('CLIENT')}
              className={`px-4 py-1.5 rounded-md font-bold transition-colors ${activeApp === 'CLIENT' ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-200 text-slate-600'}`}
            >
              CLIENT
            </button>
            <button 
              onClick={() => setActiveApp('AUTHORITY')}
              className={`px-4 py-1.5 rounded-md font-bold transition-colors ${activeApp === 'AUTHORITY' ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-200 text-slate-600'}`}
            >
              KEY GENERATOR
            </button>
          </div>
        </div>
      </div>
      
      {/* Active App */}
      <div className="flex-1 relative overflow-auto">
        {activeApp === 'CLIENT' ? <ClientApp /> : <LicenseAuthorityApp />}
      </div>
    </div>
  );
}
