import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  FolderOpen,
  Trash2,
  Clock,
  Database,
  AlertCircle,
  RefreshCcw,
  Search
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function OpenProfile() {
  const { user, loading: authLoading } = useAuth();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [folderPath, setFolderPath] = useState('');
  const [registeringFolder, setRegisteringFolder] = useState(false);
  const [registerStatus, setRegisterStatus] = useState<{ success?: boolean; text?: string } | null>(null);
  
  const [companyToRemove, setCompanyToRemove] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchCompanies = async () => {
    try {
      const r = await fetch('/api/companies');
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      }
      const contentType = r.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await r.json();
        if (Array.isArray(data)) setCompanies(data);
      } else {
        const text = await r.text();
        throw new Error(text.slice(0, 100) || 'Non-JSON response received');
      }
    } catch (err: any) {
      console.error('Error fetching companies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Get the path of the selected folder
      // Note: we can't get the absolute path directly in the browser,
      // but we can pass the top-level directory name to the server,
      // and the server can resolve it if it's in the allowed roots.
      // Alternatively, we just use the directory name as the identifier.
      const firstFile = files[0];
      const folderPath = firstFile.webkitRelativePath.split('/')[0];
      setFolderPath(folderPath); // Update the state
      // Immediately register if desired, but user asked for "Validate & Open"
    }
  };

  const handleRegisterFolder = async (pathOverride?: string) => {
    const pathToRegister = pathOverride || folderPath;
    if (!pathToRegister.trim()) {
      setRegisterStatus({ success: false, text: "Path required." });
      return;
    }
    setRegisteringFolder(true);
    setRegisterStatus(null);
    try {
      const res = await fetch('/api/companies/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: pathToRegister.trim() })
      });
      
      let data: any = {};
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = { message: await res.text() };
      }

      if (!res.ok) {
        throw new Error(data.message || 'Invalid folder.');
      }
      setRegisterStatus({ success: true, text: `Registered "${data.company?.legalName || 'Company'}"!` });
      setFolderPath('');
      fetchCompanies();
    } catch (err: any) {
      setRegisterStatus({ success: false, text: err.message || 'Error.' });
    } finally {
      setRegisteringFolder(false);
    }
  };

  const handleRemove = async (id: string) => {
    console.log("Removing company:", id);
    try {
      const res = await fetch(`/api/companies/${id}`, { 
        method: 'DELETE'
      });
      console.log("Remove response:", res.status);
      if (res.ok) {
        setCompanies(prev => prev.filter(c => c.id !== id));
        setCompanyToRemove(null);
      } else {
        let data: any = {};
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          data = await res.json();
        } else {
          data = { message: await res.text() };
        }
        console.error("Remove failed:", data);
        alert(`Error removing company: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Remove exception:", err);
      alert("Error.");
    }
  };

  const handleClearAll = async () => {
    console.log("Clearing all registry");
    try {
      const res = await fetch('/api/companies/clear-all', { 
        method: 'DELETE'
      });
      console.log("Clear all response:", res.status);
      if (res.ok) {
        setCompanies([]);
        setConfirmDeleteAll(false);
      } else {
        let data: any = {};
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          data = await res.json();
        } else {
          data = { message: await res.text() };
        }
        console.error("Clear all failed:", data);
        alert(`Error clearing registry: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Clear all exception:", err);
      alert("Error.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6fb] dark:bg-[#090d16] py-12 px-4 transition-colors">
      <div className="w-full max-w-3xl mx-auto">
        
        {/* Navigation & Utilities */}
        <div className="flex justify-between items-center mb-6">
          <button 
            onClick={() => navigate('/launcher')}
            className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Launcher
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/profile/restore')}
              className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> Restore Company Profile
            </button>

            {companies.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-3 py-1.5 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors"
                >
                  Clear Registry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Global Warnings / Confirmations */}

        {companyToRemove && (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">Remove company from access list?</h4>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Are you sure you want to remove <strong>{companyToRemove.name}</strong>? Its files will stay on disk, but it will not appear in the select list.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleRemove(companyToRemove.id)}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors"
              >
                Remove from List
              </button>
              <button 
                onClick={() => setCompanyToRemove(null)}
                className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {confirmDeleteAll && (
          <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-rose-900 dark:text-rose-200">Clear complete companies registry?</h4>
                <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">Are you sure you want to unregister <strong>all</strong> {companies.length} companies? Their physical databases will remain safe on disk, but they will be cleared from this list.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleClearAll}
                className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition-colors"
              >
                Clear All Registry
              </button>
              <button 
                onClick={() => setConfirmDeleteAll(false)}
                className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 flex items-center gap-2.5 tracking-tight">
            <Building2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400" /> Local Company Registry
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Open, register, or browse portable company accounting databases and localized workspace profiles.</p>
        </div>

        <div className="bg-white dark:bg-[#111827] p-6 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 mb-8 space-y-5 transition-colors">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Browse & Open Company Profile Folder
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Select or specify a folder containing an existing LedgerAI PH database (`database.lai`) or company workspace folder.
            </p>
          </div>

          <div className="flex gap-3">
            <input 
              type="text"
              value={folderPath}
              onChange={e => setFolderPath(e.target.value)}
              placeholder="E.g., /data/companies/company_name"
              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-[#182234] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
            />
            <input 
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                {...{ webkitdirectory: "", directory: "" }}
                className="hidden"
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
                Browse
            </button>
            <button
              onClick={() => handleRegisterFolder()}
              disabled={registeringFolder}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50 transition-colors shadow-xs"
            >
              {registeringFolder ? 'Opening...' : 'Validate & Open Folder'}
            </button>
          </div>
          {registerStatus && (
            <div className={`text-xs p-3.5 rounded-xl border flex items-center gap-2 ${registerStatus.success ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'}`}>
              <span className="text-sm">{registerStatus.success ? '✓' : '⚠️'}</span>
              <span className="font-semibold leading-relaxed">{registerStatus.text}</span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Registered Companies</h3>
            <span className="text-xs bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2.5 py-0.5 rounded-full font-bold">{companies.length} Found</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-500 bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs">
              <Clock className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Querying active local ledger configurations...</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {companies.length === 0 ? (
                <div className="bg-white dark:bg-[#111827] p-12 rounded-2xl border border-slate-200/90 dark:border-slate-800 text-center shadow-xs">
                  <Building2 className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">No Registered Workspaces</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto">Create a brand-new profile, restore a ledger backup file, or browse to open an existing directory to register it immediately on this machine.</p>
                </div>
              ) : (
                companies.map(c => (
                  <div key={c.id} className="bg-white dark:bg-[#111827] p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 flex items-center justify-between shadow-xs hover:border-indigo-300 dark:hover:border-indigo-800/80 transition-all">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-slate-900 dark:text-slate-100 truncate">{c.legalName}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1 select-all">{c.id}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{c.location || 'Primary Drive'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => navigate(`/login/${c.id}`)}
                        className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        OPEN WORKSPACE <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log("Remove button clicked for company:", c.id);
                          setCompanyToRemove({ id: c.id, name: c.legalName });
                        }}
                        className="bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 p-2 rounded-xl border border-rose-200 dark:border-rose-800 transition-colors"
                        title="Unregister"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}