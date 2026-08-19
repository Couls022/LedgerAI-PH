import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusCircle, FolderOpen, RefreshCcw, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LedgerLogoIcon } from '../components/LedgerLogo';

export default function Launcher() {
  const navigate = useNavigate();
  const { user, activeCompany, loading } = useAuth();

  useEffect(() => {
    if (!loading && user && activeCompany) {
      navigate('/');
    }
  }, [user, activeCompany, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f6fb] dark:bg-[#090d16] text-slate-700 dark:text-slate-300">
        <div className="mb-4">
          <LedgerLogoIcon size={52} />
        </div>
        <div className="flex items-center gap-2 font-semibold text-xs text-slate-600 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span>Starting LedgerAI PH Workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f6fb] dark:bg-[#090d16] py-12 px-4 transition-colors">
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center mb-4">
          <LedgerLogoIcon size={56} />
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
          Ledger<span className="text-indigo-600 dark:text-indigo-400">AI</span> PH
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1.5 text-xs font-medium max-w-md mx-auto">
          Philippine Multi-Company Financial Ledger & BIR Statutory Compliance Engine
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl w-full">
        <div 
          onClick={() => navigate('/profile/create')}
          className="bg-white dark:bg-[#111827] p-7 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 hover:shadow-sm cursor-pointer transition-all flex flex-col items-center text-center group"
        >
          <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform border border-indigo-100 dark:border-indigo-900/40">
            <PlusCircle className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Create Company</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            Initialize new legal entity profile, Chart of Accounts, and admin credentials.
          </p>
        </div>

        <div 
          onClick={() => navigate('/profile/open')}
          className="bg-white dark:bg-[#111827] p-7 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-500 hover:shadow-sm cursor-pointer transition-all flex flex-col items-center text-center group"
        >
          <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform border border-emerald-100 dark:border-emerald-900/40">
            <FolderOpen className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Open Existing Profile</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            Select a local company database to authenticate and resume accounting operations.
          </p>
        </div>

        <div 
          onClick={() => navigate('/profile/restore')}
          className="bg-white dark:bg-[#111827] p-7 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 hover:border-amber-500 dark:hover:border-amber-500 hover:shadow-sm cursor-pointer transition-all flex flex-col items-center text-center group"
        >
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/60 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform border border-amber-100 dark:border-amber-900/40">
            <RefreshCcw className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Restore from Backup</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            Restore company ledger from an encrypted snapshot or archive archive file.
          </p>
        </div>
      </div>
    </div>
  );
}
