import React, { useState, useEffect } from 'react';
import { 
  Folder, FolderPlus, FolderUp, HardDrive, Check, X, 
  ChevronRight, CornerDownRight, ShieldCheck, Search, Loader2, AlertCircle
} from 'lucide-react';

interface DirectoryExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPath: string;
  onSelectPath: (selectedPath: string) => void;
  title?: string;
  companyName?: string;
}

export default function DirectoryExplorerModal({
  isOpen,
  onClose,
  initialPath,
  onSelectPath,
  title = "Select Storage Directory",
  companyName = ""
}: DirectoryExplorerModalProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/data/companies');
  const [inputPath, setInputPath] = useState(initialPath || '/data/companies');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devicePresets, setDevicePresets] = useState<Array<{ label: string; path: string }>>([]);
  
  // New folder creation state
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderMsg, setFolderMsg] = useState('');

  // Fetch directory contents whenever currentPath changes
  const loadDirectory = async (pathTarget: string) => {
    setLoading(true);
    setError('');
    setFolderMsg('');
    try {
      const res = await fetch('/api/companies/explore-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: pathTarget })
      });

      if (res.ok) {
        const data = await res.json();
        setCurrentPath(data.currentPath);
        setInputPath(data.currentPath);
        setParentPath(data.parentPath);
        setFolders(data.folders || []);
      } else {
        const errData = await res.json();
        setError(errData.message || 'Failed to read folder contents.');
      }
    } catch (err: any) {
      setError('Error connecting to system directory explorer.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Fetch dynamic active device presets
      fetch('/api/companies/storage-environment')
        .then(res => res.json())
        .then(data => {
          if (data && data.presets) {
            setDevicePresets(data.presets);
          }
          const startPath = initialPath?.trim() || data?.companiesRoot || '/data/companies';
          setCurrentPath(startPath);
          setInputPath(startPath);
          loadDirectory(startPath);
        })
        .catch(() => {
          const startPath = initialPath?.trim() || '/data/companies';
          setCurrentPath(startPath);
          setInputPath(startPath);
          loadDirectory(startPath);
        });
    }
  }, [isOpen, initialPath]);

  if (!isOpen) return null;

  // Handle manual input path navigation
  const handleManualNavigate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inputPath.trim()) {
      loadDirectory(inputPath.trim());
    }
  };

  // Handle new subfolder creation
  const handleCreateSubfolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setCreatingFolder(true);
    setFolderMsg('');
    try {
      const res = await fetch('/api/companies/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: currentPath,
          folderName: newFolderName.trim()
        })
      });

      if (res.ok) {
        const data = await res.json();
        setNewFolderName('');
        setFolderMsg(`Folder "${data.folderName}" created successfully!`);
        // Immediately navigate into the newly created folder
        loadDirectory(data.newPath);
      } else {
        const errData = await res.json();
        setFolderMsg(`Failed: ${errData.message || 'Could not create directory'}`);
      }
    } catch (err) {
      setFolderMsg('Error creating directory.');
    } finally {
      setCreatingFolder(false);
    }
  };

  // Preset quick roots
  const quickPresets = devicePresets.length > 0 ? devicePresets : [
    { label: 'Active App Storage', path: '/data/companies' },
    { label: 'Documents LedgerAI', path: '~/Documents/LedgerAI_Data/companies' },
    { label: 'Drive C: (C:/LedgerAI_Data)', path: 'C:/LedgerAI_Data/companies' },
    { label: 'Drive D: (D:/LedgerAI_Data)', path: 'D:/LedgerAI_Data/companies' }
  ];

  // Helper safe slug for company name
  const safeCompanySlug = companyName
    ? companyName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')
    : 'company_profile';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center">
              <Folder className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400">Browse folders or manually enter custom storage path location.</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Path Input Bar & Manual Entry */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 shrink-0 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Folder className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleManualNavigate();
                  }
                }}
                placeholder="e.g. D:/CompanyLedgers/test or /data/companies/acme"
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>
            <button
              type="button"
              onClick={() => handleManualNavigate()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" /> Go / Open
            </button>
            {typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const selected = await (window as any).electronAPI.selectFolder({
                      title: 'Browse Folder in Windows Explorer',
                      defaultPath: currentPath
                    });
                    if (selected) {
                      const normalized = selected.replace(/\\/g, '/');
                      onSelectPath(normalized);
                      onClose();
                    }
                  } catch (e) {
                    console.warn('Native picker invocation error:', e);
                  }
                }}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 shadow-sm"
                title="Open native Windows Folder Dialog"
              >
                <FolderPlus className="w-3.5 h-3.5" /> Windows Explorer...
              </button>
            )}
          </div>

          {/* Quick Jump Root Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            <span className="text-slate-400 font-bold uppercase tracking-wider shrink-0 mr-1">Quick Roots:</span>
            {quickPresets.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => loadDirectory(preset.path)}
                className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 rounded-lg text-slate-700 dark:text-slate-300 font-semibold transition-all whitespace-nowrap"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Directory Explorer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Controls: Up Parent Folder & Current Location Info */}
          <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-2 overflow-hidden mr-2">
              <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider shrink-0">Path:</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate">{currentPath}</span>
            </div>
            {parentPath && (
              <button
                type="button"
                onClick={() => loadDirectory(parentPath)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-700 dark:text-slate-300 rounded-lg font-bold transition-all shrink-0 text-xs"
              >
                <FolderUp className="w-3.5 h-3.5" /> Up Level
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Subfolders List */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Subdirectories in this Location:
            </div>

            {loading ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs font-medium">Scanning directory contents...</span>
              </div>
            ) : folders.length === 0 ? (
              <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                <Folder className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                <p className="font-bold text-slate-600 dark:text-slate-400">No subdirectories found inside this folder.</p>
                <p className="text-[11px] mt-1 text-slate-400">You can select this location directly or create a new subfolder below.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                {folders.map((f, i) => (
                  <div 
                    key={i}
                    className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-slate-200 dark:border-slate-700/60 rounded-xl transition-all group"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <Folder className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                        {f.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => loadDirectory(f.path)}
                      className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 group-hover:bg-indigo-600 group-hover:text-white text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 shrink-0"
                    >
                      Open <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inline Create New Subfolder Form */}
          <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl space-y-2">
            <span className="text-xs font-bold text-indigo-950 dark:text-indigo-300 flex items-center gap-1.5">
              <FolderPlus className="w-4 h-4 text-indigo-500" /> Create New Folder in Current Path
            </span>
            <div className="flex items-center gap-2">
              <input 
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    // simulate create subfolder click or call function directly
                    const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
                    handleCreateSubfolder(syntheticEvent);
                  }
                }}
                placeholder={`e.g. ${safeCompanySlug}`}
                className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800/60 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={(e) => {
                  const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
                  handleCreateSubfolder(syntheticEvent);
                }}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1"
              >
                {creatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                Create Subfolder
              </button>
            </div>
            {folderMsg && (
              <p className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 mt-1">
                {folderMsg}
              </p>
            )}
          </div>

          {/* Dedicated Isolated Storage Notice */}
          <div className="p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 text-xs space-y-1">
            <div className="flex items-center justify-between text-emerald-400 font-bold">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> Company Data Isolation Active
              </span>
              <span className="text-[10px] bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                Isolated Ledger Folder
              </span>
            </div>
            <p className="text-slate-300 text-[11px]">
              Every created company profile maintains its own dedicated folder and database file. Data from different company profiles will never be mixed or overwritten.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-medium">
            Location: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{currentPath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectPath(currentPath);
                onClose();
              }}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Select & Use This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
