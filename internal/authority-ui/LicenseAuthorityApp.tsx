import React, { useState, useEffect, useRef } from 'react';
import { Shield, Key, RefreshCw, History, CheckCircle, Download, LogOut, Loader2, AlertCircle, Search, Upload, FileCode, X, Check, Copy, Eye, Clock, ArrowLeft, Building2, Zap } from 'lucide-react';
import { ThemeProvider, useTheme } from '../../src/client/context/ThemeContext';

function ForceDarkMode({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme('light');
  }, []);
  return <>{children}</>;
}

function AuthorityLogin({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('cpenaflor@ledgerai.ph');
  const [password, setPassword] = useState('@dM1n2025Couls');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleQuickLogin = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    setUsername('cpenaflor@ledgerai.ph');
    setPassword('@dM1n2025Couls');
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/authority/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'cpenaflor@ledgerai.ph', password: '@dM1n2025Couls' })
      });
      if (res.ok) {
        try {
          localStorage.setItem('authority_token', 'valid_authority_session');
        } catch (e) {
          console.warn('LocalStorage write blocked in AuthorityLogin:', e);
        }
        onLogin();
      } else {
        const json = await res.json();
        setError(json.error || 'Invalid credentials');
      }
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/authority/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        try {
          localStorage.setItem('authority_token', 'valid_authority_session');
        } catch (e) {
          console.warn('LocalStorage write blocked in AuthorityLogin:', e);
        }
        onLogin();
      } else {
        const json = await res.json();
        setError(json.error || 'Invalid credentials');
      }
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans text-slate-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-between mb-4 px-2">
          <a
            href="#/launcher"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to App Launcher</span>
          </a>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            Internal Portal
          </span>
        </div>

        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center border border-indigo-200 shadow-sm">
            <Shield className="w-8 h-8 text-indigo-600" />
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          LedgerAI PH Authority
        </h2>
        <p className="mt-1.5 text-center text-xs text-slate-500">
          Internal License Authority &amp; Key Generator Portal
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-4 shadow-xl border border-slate-200 sm:rounded-2xl sm:px-8">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-lg flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <div>
              <label htmlFor="username" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                Authority Account
              </label>
              <div className="mt-1">
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm font-medium"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                Master Security Key / Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  placeholder="Enter authority password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm font-medium"
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-xl bg-indigo-600 py-2.5 px-4 text-xs font-bold uppercase tracking-wider text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SIGN IN TO KEY GENERATOR'}
              </button>

              <button
                type="button"
                onClick={handleQuickLogin}
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 py-2 px-4 text-xs font-semibold text-slate-700 transition-colors border border-slate-200 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span>1-Click Fast Preview Sign In</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AuthorityDashboard({ onLogout }: { onLogout: () => void }) {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [lastStreamUpdate, setLastStreamUpdate] = useState<string | null>(null);
  
  const [dashboardData, setDashboardData] = useState<any>({
    companies: [],
    licenses: [],
    logs: []
  });

  const getHeaders = () => {
    let token = 'valid_authority_session';
    try {
      token = localStorage.getItem('authority_token') || 'valid_authority_session';
    } catch (e) {
      console.warn('LocalStorage read blocked in getHeaders:', e);
    }
    return {
      'Content-Type': 'application/json',
      'x-authority-token': token
    };
  };

  const fetchDashboard = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/authority/dashboard', {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    
    const interval = setInterval(() => {
      fetchDashboard();
    }, 15000);

    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/authority?role=authority`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          setWsConnected(true);
        };

        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'AUTHORITY_ACTIVATION_UPDATE' || msg.event === 'NOTIFICATION') {
              fetchDashboard();
              setLastStreamUpdate(new Date().toLocaleTimeString());
              if (msg.data?.action) {
                showToast(`Real-time update: License ${msg.data.action.toLowerCase()} for tenant ${msg.data.companyId || ''}`, 'success');
              }
            }
          } catch (e) {
            console.error('[Authority WS] Parse error:', e);
          }
        };

        socket.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWebSocket, 3000);
        };

        socket.onerror = () => {
          setWsConnected(false);
        };
      } catch (err) {
        setWsConnected(false);
      }
    };

    connectWebSocket();

    return () => {
      clearInterval(interval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  const [companyIdInput, setCompanyIdInput] = useState('');
  const [manualCompanyId, setManualCompanyId] = useState('');
  const [planInput, setPlanInput] = useState('PRO');
  const [durationType, setDurationType] = useState('trial');
  const [customDays, setCustomDays] = useState<number | string>(30);
  const [generatedResult, setGeneratedResult] = useState<{
    licenseId: string;
    licenseKey: string;
    licenseFile: string;
    companyId: string;
    planType: string;
    expirationDate: string | null;
    durationType: string;
    customDays?: number | string;
  } | null>(null);
  const [inspectLicense, setInspectLicense] = useState<any | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [importedLrq, setImportedLrq] = useState<{
    companyId: string;
    companyName: string;
    tin?: string;
    requestedPlan?: string;
    installationId?: string;
    timestamp?: string;
  } | null>(null);
  const [lrqDragOver, setLrqDragOver] = useState(false);
  const lrqFileInputRef = useRef<HTMLInputElement>(null);

  const handleLrqFile = (file: File) => {
    if (!file) return;
    if (!file.name.endsWith('.lrq') && !file.name.endsWith('.json')) {
      showToast('Please upload a valid .lrq license request file', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        if (!parsed || parsed.requestType !== 'LEDGERAI_LICENSE_REQUEST') {
          showToast('Invalid request type. Expected LEDGERAI_LICENSE_REQUEST', 'error');
          return;
        }

        if (!parsed.companyId || typeof parsed.companyId !== 'string') {
          showToast('Malformed LRQ: Missing or invalid companyId', 'error');
          return;
        }

        const validPlan = (parsed.requestedPlan === 'ENTERPRISE') ? 'ENTERPRISE' : 'PRO';
        setCompanyIdInput('manual');
        setManualCompanyId(parsed.companyId.trim());
        setPlanInput(validPlan);
        setImportedLrq({
          companyId: parsed.companyId,
          companyName: parsed.companyName || 'Unnamed Company',
          tin: parsed.tin || 'N/A',
          requestedPlan: parsed.requestedPlan || 'PRO',
          installationId: parsed.installationId || 'N/A',
          timestamp: parsed.timestamp || new Date().toISOString()
        });

        showToast(`Imported license request for ${parsed.companyName || parsed.companyId}`, 'success');
      } catch (err: any) {
        showToast(`Failed to parse LRQ file: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleClearLrq = () => {
    setImportedLrq(null);
    setManualCompanyId('');
    setCompanyIdInput('');
    if (lrqFileInputRef.current) lrqFileInputRef.current.value = '';
  };
  
  const handleLogout = async () => {
    try {
      localStorage.removeItem('authority_token');
      await fetch('/api/authority/logout', { method: 'POST' });
    } catch (e) {}
    onLogout();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetCompanyId = companyIdInput === 'manual' ? manualCompanyId : (companyIdInput || manualCompanyId);
    if (!targetCompanyId || targetCompanyId.trim() === '') {
      showToast('Please enter or select a valid Company ID');
      return;
    }

    if (durationType === 'custom') {
      const days = parseInt(String(customDays), 10);
      if (isNaN(days) || days <= 0) {
        showToast('Please enter a valid number of custom days (e.g. 14, 45, 60)');
        return;
      }
    }
    
    setLoading(true);
    try {
      const res = await fetch('/api/authority/generate-license', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ 
          companyId: targetCompanyId.trim(), 
          planType: planInput,
          durationType,
          customDays: durationType === 'custom' ? parseInt(String(customDays), 10) : undefined
        })
      });
      const json = await res.json();
      if (res.ok) {
        showToast('License & Activation Key issued successfully!', 'success');
        setGeneratedResult({
          ...json,
          durationType,
          customDays: durationType === 'custom' ? customDays : undefined,
          companyId: targetCompanyId.trim()
        });

        if (json.licenseFile) {
          const blob = new Blob([json.licenseFile], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ledgeria-ph.lai';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        setCompanyIdInput('');
        setManualCompanyId('');
        handleClearLrq();
        fetchDashboard();
      } else {
        showToast(json.error || 'Failed to create license');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to connect to Authority API');
    } finally {
      setLoading(false);
    }
  };
  
  const handleRevoke = async (id: string, companyId: string) => {
    if (!confirm('Are you sure you want to revoke this license?')) return;
    try {
      const res = await fetch(`/api/authority/licenses/${id}/revoke`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ companyId })
      });
      if (res.ok) {
        showToast('License revoked', 'success');
        fetchDashboard();
      } else {
        showToast('Failed to revoke license');
      }
    } catch (e) {
      showToast('Network error');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Key copied to clipboard!', 'success');
  };

  const handleDownload = (content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ledgeria-ph.lai';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLicenses = dashboardData.licenses.filter((lic: any) => 
    lic.companyId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lic.planType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 p-6 md:p-10 space-y-6">
      
      {/* HEADER CARD */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Admin License Management (Internal)</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                wsConnected 
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
              }`}>
                <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {wsConnected ? 'Real-Time WS Active' : 'Polling Mode (15s)'}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Issue cryptographically signed production license keys, manage duration, and monitor tenant activations.
              {lastStreamUpdate && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">Last stream update: {lastStreamUpdate}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a 
            href="#/launcher"
            className="flex items-center gap-2 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-sm font-semibold rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800"
            title="Return to System Launcher"
          >
            <Building2 className="w-4 h-4" />
            <span>Accounting Workspace</span>
          </a>
          <button 
            onClick={fetchDashboard}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-sm font-semibold rounded-lg transition-colors border border-rose-200 dark:border-rose-800/50 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: ISSUE FORM */}
        <div className="lg:col-span-1 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6">
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700/50 pb-4">
            <Key className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> Issue New License Key
          </h2>
          
          <form onSubmit={handleCreate} className="space-y-5">
            {/* LRQ License Request Import Dropzone */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5 text-indigo-500" /> Ingest Client Request (.lrq)
                </span>
                {importedLrq && (
                  <button
                    type="button"
                    onClick={handleClearLrq}
                    className="text-[11px] text-rose-500 hover:text-rose-600 font-semibold flex items-center gap-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </label>

              <input
                ref={lrqFileInputRef}
                type="file"
                accept=".lrq,.json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleLrqFile(e.target.files[0]);
                  }
                }}
              />

              {!importedLrq ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setLrqDragOver(true); }}
                  onDragLeave={() => setLrqDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setLrqDragOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleLrqFile(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => lrqFileInputRef.current?.click()}
                  className={`p-3.5 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${
                    lrqDragOver
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 hover:border-indigo-400 hover:bg-slate-100/50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <Upload className="w-5 h-5 text-indigo-500 mb-1" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Upload or Drop <span className="text-indigo-600 dark:text-indigo-400 font-mono">.lrq</span> file
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Auto-fills Company ID & requested plan tier</p>
                </div>
              ) : (
                <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-900 dark:text-indigo-200 truncate max-w-[200px]">
                      {importedLrq.companyName}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded">
                      {importedLrq.requestedPlan}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate">
                    ID: {importedLrq.companyId}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>Inst: {importedLrq.installationId}</span>
                    <span>TIN: {importedLrq.tin}</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">Select Active Tenant Profile</label>
              <select 
                value={companyIdInput}
                onChange={e => setCompanyIdInput(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all shadow-sm"
              >
                <option value="">-- Choose existing company --</option>
                {dashboardData.companies.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                ))}
                <option value="manual">-- Enter Manually --</option>
              </select>
            </div>
            
            {(companyIdInput === 'manual' || dashboardData.companies.length === 0 || !companyIdInput) && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">Target Company ID</label>
                <input
                  type="text"
                  placeholder="e.g. LGR-PH-2026-TEC-00-85CBBDAF"
                  value={manualCompanyId}
                  onChange={e => setManualCompanyId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder-slate-400 shadow-inner"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">Plan Tier</label>
              <select 
                value={planInput}
                onChange={e => setPlanInput(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm"
              >
                <option value="PRO">Pro Tier</option>
                <option value="ENTERPRISE">Enterprise Tier</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">License Duration</label>
              <select 
                value={durationType}
                onChange={e => setDurationType(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm"
              >
                <option value="trial">Trial (7 Days - Default)</option>
                <option value="monthly">Monthly (30 Days)</option>
                <option value="quarterly">Quarterly (90 Days)</option>
                <option value="yearly">Yearly (365 Days)</option>
                <option value="lifetime">Lifetime (Perpetual)</option>
                <option value="custom">Custom Days</option>
              </select>
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                New company profiles default to a 7-Day Trial period.
              </p>
            </div>

            {durationType === 'custom' && (
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    Custom Validity (Days)
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">1 - 3650 days</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    value={customDays}
                    onChange={e => setCustomDays(e.target.value)}
                    placeholder="e.g. 14, 45, 60"
                    className="w-full px-3 py-1.5 text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-inner"
                  />
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">Days</span>
                </div>
                {/* Presets */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[7, 14, 30, 60, 90, 180, 365].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCustomDays(d)}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors cursor-pointer ${
                        Number(customDays) === d
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading || (!companyIdInput && !manualCompanyId)}
              className="w-full py-3 mt-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-md shadow-emerald-600/20 disabled:opacity-50 transition-all flex justify-center items-center gap-2 cursor-pointer"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Key className="w-5 h-5" />}
              Generate & Sign License
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: ACTIVE LICENSES */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-[500px]">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-700/50 pb-4 mb-4 shrink-0">
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              Active Tenant Licenses
            </h2>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Company ID or Plan..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto rounded-xl border border-slate-100 dark:border-slate-700">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[650px]">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Company ID</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Plan</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Activation Key</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Status</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Expires</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {filteredLicenses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      No active licenses found.
                    </td>
                  </tr>
                ) : (
                  filteredLicenses.map((lic: any) => (
                    <tr key={lic.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                        {lic.companyId}
                      </td>
                      <td className="px-4 py-3 font-bold text-indigo-600 dark:text-indigo-400 text-xs">
                        {lic.planType}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <span className="max-w-[140px] truncate" title={lic.licenseKey}>{lic.licenseKey}</span>
                          <button
                            onClick={() => handleCopy(lic.licenseKey)}
                            className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                            title="Copy Activation Key"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase ${
                          lic.status === 'ACTIVE' 
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' 
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                        }`}>
                          {lic.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-medium">
                        {lic.expirationDate || 'LIFETIME'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5">
                        <button 
                          onClick={() => setInspectLicense(lic)} 
                          className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer rounded hover:bg-slate-100 dark:hover:bg-slate-700" 
                          title="Inspect Key & File Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDownload(lic.signedFileContent)} 
                          className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer rounded hover:bg-slate-100 dark:hover:bg-slate-700" 
                          title="Download Signed .lai File"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleRevoke(lic.id, lic.companyId)}
                          disabled={lic.status === 'REVOKED'}
                          className="px-2 py-1 text-[10px] font-bold rounded bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* GENERATED LICENSE SUCCESS MODAL */}
      {generatedResult && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-emerald-50/50 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    License & Key Issued Successfully!
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Both Activation Key and Signed License File are generated and ready for tenant activation.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setGeneratedResult(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Company & Plan Summary */}
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <div>
                  <span className="text-slate-400 font-medium">Company ID:</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate">{generatedResult.companyId}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Plan Tier:</span>
                  <p className="font-bold text-indigo-600 dark:text-indigo-400">{generatedResult.planType}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Duration:</span>
                  <p className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                    {generatedResult.durationType} {generatedResult.customDays ? `(${generatedResult.customDays} days)` : ''}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Expires:</span>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400">{generatedResult.expirationDate || 'LIFETIME'}</p>
                </div>
              </div>

              {/* 1. ACTIVATION KEY DISPLAY & COPY */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    1. Activation Key
                  </label>
                  <span className="text-[11px] text-slate-400">Can be entered directly in tenant activation</span>
                </div>
                <div className="flex items-center gap-2 p-3 bg-slate-900 text-emerald-400 rounded-xl font-mono text-sm font-bold border border-slate-700 shadow-inner justify-between">
                  <span className="select-all tracking-wider">{generatedResult.licenseKey}</span>
                  <button
                    type="button"
                    onClick={() => {
                      handleCopy(generatedResult.licenseKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2500);
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey ? 'Copied Key!' : 'Copy Key'}
                  </button>
                </div>
              </div>

              {/* 2. ACTIVATION FILE DOWNLOAD */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    2. Signed License File (.lai)
                  </label>
                  <span className="text-[11px] text-slate-400">Cryptographically signed RSA artifact</span>
                </div>
                <div className="flex items-center justify-between p-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-lg">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-mono font-bold text-xs text-indigo-950 dark:text-indigo-200">ledgeria-ph.lai</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Official license payload & digital signature</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(generatedResult.licenseFile)}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <Download className="w-3.5 h-3.5" /> Download .lai
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const fullDetails = `LEDGERAI PH LICENSE ACTIVATION DETAILS\nCompany ID: ${generatedResult.companyId}\nPlan: ${generatedResult.planType}\nActivation Key: ${generatedResult.licenseKey}\nExpires: ${generatedResult.expirationDate || 'LIFETIME'}\n\nPlease enter this Activation Key or upload the ledgeria-ph.lai file under Settings > System Licensing.`;
                    navigator.clipboard.writeText(fullDetails);
                    showToast('Complete license instructions copied to clipboard!', 'success');
                  }}
                  className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Key & Instructions
                </button>
                <button
                  type="button"
                  onClick={() => setGeneratedResult(null)}
                  className="w-full sm:w-auto px-5 py-2 text-xs font-bold text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INSPECT LICENSE MODAL */}
      {inspectLicense && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    Tenant License Details
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {inspectLicense.companyId}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setInspectLicense(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <div>
                  <span className="text-slate-400 font-medium">Company ID:</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate">{inspectLicense.companyId}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Plan Tier:</span>
                  <p className="font-bold text-indigo-600 dark:text-indigo-400">{inspectLicense.planType}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Status:</span>
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase ${
                    inspectLicense.status === 'ACTIVE' 
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' 
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                  }`}>
                    {inspectLicense.status}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Expiration:</span>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400">{inspectLicense.expirationDate || 'LIFETIME'}</p>
                </div>
              </div>

              {/* Activation Key */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Activation Key
                </label>
                <div className="flex items-center gap-2 p-3 bg-slate-900 text-emerald-400 rounded-xl font-mono text-sm font-bold border border-slate-700 shadow-inner justify-between">
                  <span className="select-all tracking-wider">{inspectLicense.licenseKey}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(inspectLicense.licenseKey)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Key
                  </button>
                </div>
              </div>

              {/* License File Download */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Signed Artifact (.lai)
                </label>
                <div className="flex items-center justify-between p-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-lg">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-mono font-bold text-xs text-indigo-950 dark:text-indigo-200">ledgeria-ph.lai</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Cryptographically signed key payload</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(inspectLicense.signedFileContent)}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <Download className="w-3.5 h-3.5" /> Download .lai
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                <button
                  type="button"
                  onClick={() => setInspectLicense(null)}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM LOGS */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 h-[300px] flex flex-col">
        <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700/50 pb-4 mb-4 shrink-0">
          <History className="w-5 h-5 text-slate-400" /> License Lifecycle Audit Log
        </h2>
        <div className="flex-1 overflow-auto rounded-xl border border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900/30">
          <table className="w-full text-left text-sm min-w-[600px]">
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {dashboardData.logs.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    No activity logs found.
                  </td>
                </tr>
              ) : (
                dashboardData.logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
                    <td className="px-4 py-3 w-48 font-bold text-xs text-slate-700 dark:text-slate-300 tracking-wider">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                      {log.details}
                    </td>
                    <td className="px-4 py-3 text-right text-[11px] font-mono text-slate-400 dark:text-slate-500 whitespace-nowrap w-48">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className={`flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border text-sm font-bold ${
            toast.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-400' 
              : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-400'
          }`}>
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LicenseAuthorityApp() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return localStorage.getItem('authority_token') === 'valid_authority_session';
    } catch (e) {
      console.warn('LocalStorage read blocked in LicenseAuthorityApp initialization:', e);
      return false;
    }
  });

  useEffect(() => {
    try {
      const token = localStorage.getItem('authority_token');
      if (token === 'valid_authority_session') {
        setIsAuthenticated(true);
      }
    } catch (e) {
      console.warn('LocalStorage read blocked in LicenseAuthorityApp effect:', e);
    }
  }, []);

  return (
    <ThemeProvider>
      <ForceDarkMode>
        {isAuthenticated ? (
          <AuthorityDashboard onLogout={() => setIsAuthenticated(false)} />
        ) : (
          <AuthorityLogin onLogin={() => setIsAuthenticated(true)} />
        )}
      </ForceDarkMode>
    </ThemeProvider>
  );
}
