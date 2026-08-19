import React, { useState, useEffect } from 'react';
import { Shield, Key, RefreshCw, History, CheckCircle, Download, LogOut, Loader2, AlertCircle, Search } from 'lucide-react';
import { ThemeProvider, useTheme } from './client/context/ThemeContext';

function ForceDarkMode({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme('light');
  }, []);
  return <>{children}</>;
}

function AuthorityLogin({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('cpenaflor@ledgerai.ph');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center border border-indigo-200 shadow-sm">
            <Shield className="w-8 h-8 text-indigo-600" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight text-slate-900">
          LedgerAI PH Authority
        </h2>
        <p className="mt-2 text-center text-sm text-slate-500">
          Offline Master Key Generator
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl border border-slate-200 sm:rounded-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-lg flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-slate-700">
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
                  className="block w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm font-medium"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
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
                  className="block w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm font-medium"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-xl bg-indigo-600 py-2.5 px-4 text-sm font-bold text-white shadow hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'SIGN IN TO KEY GENERATOR'}
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
    
    // Enhanced Fallback Polling (15 seconds)
    const interval = setInterval(() => {
      fetchDashboard();
    }, 15000);

    // WebSocket Real-time Activation Stream
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
  const [durationType, setDurationType] = useState('lifetime');
  
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
    
    setLoading(true);
    try {
      const res = await fetch('/api/authority/generate-license', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ 
          companyId: targetCompanyId.trim(), 
          planType: planInput,
          durationType,
          customDays: undefined
        })
      });
      const json = await res.json();
      if (res.ok) {
        showToast('License generated successfully!', 'success');
        setCompanyIdInput('');
        setManualCompanyId('');
        
        // Auto download the file
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
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Admin License Management</h1>
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
              Issue cryptographically signed production license keys, manage duration, and monitor tenant activations in real-time.
              {lastStreamUpdate && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">Last stream update: {lastStreamUpdate}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
                <option value="yearly">Yearly (365 Days)</option>
                <option value="lifetime">Lifetime (Perpetual)</option>
              </select>
            </div>

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
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Key</th>
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
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 max-w-[150px] truncate" title={lic.licenseKey}>
                        {lic.licenseKey}
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
                      <td className="px-4 py-3 text-right space-x-2">
                        <button onClick={() => handleCopy(lic.licenseKey)} className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer" title="Copy Key">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={() => handleDownload(lic.signedFileContent)} className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer" title="Download License File">
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
