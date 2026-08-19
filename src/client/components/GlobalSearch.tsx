import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, FileText, BookOpen, FolderOpen, ShieldCheck, 
  UserCheck, X, Command, ArrowRight, Loader2, Sparkles,
  LayoutDashboard, BarChart3, Settings as SettingsIcon, Building2, Download, Moon, Sun, ArrowUpRight
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  status?: string;
  url: string;
}

interface SearchResults {
  transactions: SearchResultItem[];
  documents: SearchResultItem[];
  taxRecords: SearchResultItem[];
  contacts: SearchResultItem[];
}

interface QuickAction {
  id: string;
  title: string;
  subtitle: string;
  category: 'Navigation' | 'System Action';
  icon: React.ReactNode;
  action: () => void;
}

import { apiFetch } from '../utils/apiClient';

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setResults(null);
    }
  }, [isOpen]);

  // Debounced search query
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then(data => {
          if (data && data.results) {
            setResults(data.results);
          }
        })
        .catch(err => console.error("Search error:", err))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Define Quick Actions
  const quickActions: QuickAction[] = [
    {
      id: 'nav-dashboard',
      title: 'Go to Executive Dashboard',
      subtitle: 'Overview of BIR Tax Compliance, Financial Metrics & Liquidity',
      category: 'Navigation',
      icon: <LayoutDashboard className="w-4 h-4 text-indigo-500" />,
      action: () => navigate('/dashboard')
    },
    {
      id: 'nav-accounting',
      title: 'Go to Accounting & Ledger',
      subtitle: 'Journals, Chart of Accounts, Invoices & Supplier Bills',
      category: 'Navigation',
      icon: <BookOpen className="w-4 h-4 text-blue-500" />,
      action: () => navigate('/accounting')
    },
    {
      id: 'nav-tax',
      title: 'Go to BIR Tax Schedule',
      subtitle: 'Tax Schedule Codes, BIR 2550M/Q & EWT 2307 Calculations',
      category: 'Navigation',
      icon: <FileText className="w-4 h-4 text-emerald-500" />,
      action: () => navigate('/tax')
    },
    {
      id: 'nav-reports',
      title: 'Go to Financial Reports',
      subtitle: 'Trial Balance, AR/AP Aging Summaries & Balance Sheet',
      category: 'Navigation',
      icon: <BarChart3 className="w-4 h-4 text-purple-500" />,
      action: () => navigate('/reports')
    },
    {
      id: 'nav-documents',
      title: 'Go to Document Repository',
      subtitle: 'Source receipts, attachments, and uploaded tax filings',
      category: 'Navigation',
      icon: <FolderOpen className="w-4 h-4 text-amber-500" />,
      action: () => navigate('/documents')
    },
    {
      id: 'nav-audit',
      title: 'Go to Compliance Audit Log',
      subtitle: 'Immutable record of workspace actions and changes',
      category: 'Navigation',
      icon: <ShieldCheck className="w-4 h-4 text-rose-500" />,
      action: () => navigate('/audit')
    },
    {
      id: 'nav-settings',
      title: 'Go to Company Settings',
      subtitle: 'Manage BIR TIN, Taxpayer Type & Export Company Database',
      category: 'Navigation',
      icon: <SettingsIcon className="w-4 h-4 text-slate-500" />,
      action: () => navigate('/settings')
    },
    {
      id: 'nav-launcher',
      title: 'Switch Active Profile',
      subtitle: 'Open profile selector or create a new company workspace',
      category: 'Navigation',
      icon: <Building2 className="w-4 h-4 text-cyan-500" />,
      action: () => navigate('/launcher')
    },
    {
      id: 'action-theme',
      title: `Toggle Theme (Currently ${theme === 'dark' ? 'Dark' : 'Light'})`,
      subtitle: 'Switch application color palette',
      category: 'System Action',
      icon: theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />,
      action: () => toggleTheme()
    },
    {
      id: 'action-backup',
      title: 'Download Proprietary .lai Company Database Backup',
      subtitle: 'Generate and save a complete offline binary .lai database package of company data',
      category: 'System Action',
      icon: <Download className="w-4 h-4 text-emerald-500" />,
      action: async () => {
        try {
          const res = await fetch('/api/restore/export');
          if (res.ok) {
            const blob = await res.blob();
            const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'LedgerAI_Database_Backup.lai';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }
  ];

  // Filter quick actions if query matches
  const filteredQuickActions = query.trim() 
    ? quickActions.filter(a => 
        a.title.toLowerCase().includes(query.toLowerCase()) || 
        a.subtitle.toLowerCase().includes(query.toLowerCase())
      )
    : quickActions;

  const allFlatResults: { id: string; title: string; subtitle: string; url?: string; action?: () => void; type: string; status?: string }[] = [];

  if (query.trim() && results) {
    if (results.transactions) {
      results.transactions.forEach(t => allFlatResults.push({ ...t }));
    }
    if (results.documents) {
      results.documents.forEach(d => allFlatResults.push({ ...d }));
    }
    if (results.taxRecords) {
      results.taxRecords.forEach(tr => allFlatResults.push({ ...tr }));
    }
    if (results.contacts) {
      results.contacts.forEach(c => allFlatResults.push({ ...c }));
    }
  }

  filteredQuickActions.forEach(qa => {
    allFlatResults.push({
      id: qa.id,
      title: qa.title,
      subtitle: qa.subtitle,
      action: qa.action,
      type: qa.category
    });
  });

  const handleSelectResultItem = (item: typeof allFlatResults[0]) => {
    setIsOpen(false);
    if (item.action) {
      item.action();
    } else if (item.url) {
      navigate(item.url);
    }
  };

  // Keyboard navigation Up/Down/Enter
  const handleKeyDownInput = (e: React.KeyboardEvent) => {
    if (allFlatResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % allFlatResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + allFlatResults.length) % allFlatResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = allFlatResults[selectedIndex] || allFlatResults[0];
      if (current) {
        handleSelectResultItem(current);
      }
    }
  };

  const getItemIcon = (type: string) => {
    if (type.includes('Invoice') || type.includes('Bill') || type.includes('Journal') || type.includes('Cash')) {
      return <BookOpen className="w-4 h-4 text-indigo-500" />;
    } else if (type.includes('Document')) {
      return <FolderOpen className="w-4 h-4 text-amber-500" />;
    } else if (type.includes('Tax')) {
      return <FileText className="w-4 h-4 text-emerald-500" />;
    } else if (type.includes('Customer') || type.includes('Vendor')) {
      return <UserCheck className="w-4 h-4 text-blue-500" />;
    }
    return <Search className="w-4 h-4 text-slate-400" />;
  };

  return (
    <>
      {/* Header Search Input Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-lg transition-all w-48 sm:w-64 justify-between group"
      >
        <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300 truncate">
          <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
          <span className="truncate">Search transactions, tax, docs...</span>
        </span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded shadow-2xs">
          <Command className="w-2.5 h-2.5" /> K
        </kbd>
      </button>

      {/* Global Search Dialog Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
          <div 
            ref={containerRef}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[80vh]"
          >
            {/* Search Input Bar */}
            <div className="flex items-center px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 gap-3">
              <Search className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDownInput}
                placeholder="Type to search transactions, documents, tax schedule, or navigation commands..."
                className="w-full bg-transparent text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
              />
              {loading && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
              {query && !loading && (
                <button onClick={() => setQuery('')} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              )}
              <button 
                onClick={() => setIsOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded px-2 py-1"
              >
                ESC
              </button>
            </div>

            {/* Results Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {!query.trim() && (
                <div className="mb-2">
                  <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2 px-2 flex items-center justify-between">
                    <span>Quick Navigation & Actions</span>
                    <span className="text-[10px] font-normal lowercase text-slate-400">or type to search transactions</span>
                  </div>
                  <div className="space-y-1">
                    {quickActions.map((qa, index) => (
                      <div
                        key={qa.id}
                        onClick={() => {
                          setIsOpen(false);
                          qa.action();
                        }}
                        className={`p-3 rounded-xl cursor-pointer transition-colors flex items-center justify-between group border ${
                          selectedIndex === index 
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800' 
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 shadow-2xs">
                            {qa.icon}
                          </div>
                          <div>
                            <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 flex items-center gap-2">
                              {qa.title}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{qa.subtitle}</p>
                          </div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {query.trim() && !loading && allFlatResults.length === 0 && (
                <div className="py-10 text-center text-slate-400 text-sm">
                  No matching transactions, tax records, or documents found for <span className="font-semibold text-slate-600 dark:text-slate-300">"{query}"</span>.
                </div>
              )}

              {query.trim() && (
                <>
                  {/* Category: Matching Transactions / Documents / Tax */}
                  {results && (
                    <>
                      {results.transactions && results.transactions.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2 px-2 flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-indigo-500" /> Accounting Transactions ({results.transactions.length})
                          </div>
                          <div className="space-y-1">
                            {results.transactions.map((item, idx) => (
                              <div
                                key={item.id}
                                onClick={() => handleSelectResultItem(item)}
                                className={`p-3 rounded-xl cursor-pointer transition-colors flex items-center justify-between group border ${
                                  selectedIndex === idx
                                    ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/50'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 shrink-0">
                                    {getItemIcon(item.type)}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                        {item.title}
                                      </span>
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                        {item.type}
                                      </span>
                                      {item.status && (
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                          {item.status}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.subtitle}</p>
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {results.documents && results.documents.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2 px-2 flex items-center gap-1.5">
                            <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> Documents & Source Files ({results.documents.length})
                          </div>
                          <div className="space-y-1">
                            {results.documents.map(item => (
                              <div
                                key={item.id}
                                onClick={() => handleSelectResultItem(item)}
                                className="p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-amber-100 dark:hover:border-amber-900/50"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 shrink-0">
                                    {getItemIcon(item.type)}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                                      {item.title}
                                    </span>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.subtitle}</p>
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {results.taxRecords && results.taxRecords.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2 px-2 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-emerald-500" /> BIR Tax Schedule Records ({results.taxRecords.length})
                          </div>
                          <div className="space-y-1">
                            {results.taxRecords.map(item => (
                              <div
                                key={item.id}
                                onClick={() => handleSelectResultItem(item)}
                                className="p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-emerald-100 dark:hover:border-emerald-900/50"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 shrink-0">
                                    {getItemIcon(item.type)}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                                      {item.title}
                                    </span>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.subtitle}</p>
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {results.contacts && results.contacts.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2 px-2 flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-blue-500" /> Customers & Suppliers ({results.contacts.length})
                          </div>
                          <div className="space-y-1">
                            {results.contacts.map(item => (
                              <div
                                key={item.id}
                                onClick={() => handleSelectResultItem(item)}
                                className="p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-blue-100 dark:hover:border-blue-900/50"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 shrink-0">
                                    {getItemIcon(item.type)}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                      {item.title}
                                    </span>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.subtitle}</p>
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Matching Navigation Commands */}
                  {filteredQuickActions.length > 0 && (
                    <div>
                      <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2 px-2 flex items-center gap-1.5">
                        <Command className="w-3.5 h-3.5 text-slate-400" /> Navigation Commands ({filteredQuickActions.length})
                      </div>
                      <div className="space-y-1">
                        {filteredQuickActions.map(qa => (
                          <div
                            key={qa.id}
                            onClick={() => {
                              setIsOpen(false);
                              qa.action();
                            }}
                            className="p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                                {qa.icon}
                              </div>
                              <div>
                                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                  {qa.title}
                                </span>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{qa.subtitle}</p>
                              </div>
                            </div>
                            <ArrowUpRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 bg-slate-100/70 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span><kbd className="font-mono bg-white dark:bg-slate-800 px-1 rounded border border-slate-200 dark:border-slate-700">↑↓</kbd> Navigate</span>
                <span><kbd className="font-mono bg-white dark:bg-slate-800 px-1 rounded border border-slate-200 dark:border-slate-700">↵</kbd> Select</span>
                <span><kbd className="font-mono bg-white dark:bg-slate-800 px-1 rounded border border-slate-200 dark:border-slate-700">ESC</kbd> Close</span>
              </div>
              <span className="hidden sm:inline font-semibold text-slate-500 dark:text-slate-400">Command Palette</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

