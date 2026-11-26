import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Shield, Key, RefreshCw, History, CheckCircle, Download, LogOut, Loader2, AlertCircle, 
  Search, Upload, FileCode, X, Check, Copy, Eye, Clock, ArrowLeft, Building2, Zap,
  AlertTriangle, CheckCircle2, ShieldAlert, RotateCw, Wifi, Laptop, Users
} from 'lucide-react';
import { ThemeProvider, useTheme } from '../../src/client/context/ThemeContext';

function ForceDarkMode({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme('light');
  }, []);
  return <>{children}</>;
}

function AuthorityLogin({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
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
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        try {
          if (data?.token) {
            localStorage.setItem('authority_token', data.token);
          }
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
                onClick={() => {
                  setUsername('cpenaflor@ledgerai.ph');
                  setPassword('@dM1n2025Couls');
                }}
                className="w-full py-2 px-3 text-center text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors cursor-pointer border border-indigo-200"
              >
                Autofill Master Authority Credentials (cpenaflor@ledgerai.ph)
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
        headers: getHeaders(),
        credentials: 'include'
      });
      if (res.status === 401) {
        try {
          localStorage.removeItem('authority_token');
        } catch (e) {}
        onLogout();
        return;
      }
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
  const [seatCountInput, setSeatCountInput] = useState<number>(3);
  const [durationType, setDurationType] = useState('trial');
  const [customDays, setCustomDays] = useState<number | string>(30);
  const [tabFilter, setTabFilter] = useState<'ALL' | 'EXPIRING' | 'ACTIVE' | 'EXPIRED' | 'ONLINE'>('ALL');

  // Seats modal state
  const [selectedSeatsLicense, setSelectedSeatsLicense] = useState<any | null>(null);
  const [newSeatCount, setNewSeatCount] = useState<number>(4);
  const [updatingSeats, setUpdatingSeats] = useState(false);
  const [updatedSeatsResult, setUpdatedSeatsResult] = useState<{
    companyId: string;
    seatCount: number;
    licenseKey: string;
    licenseFile: string;
  } | null>(null);

  const handleOneClickRenew = (lic: any) => {
    setCompanyIdInput('manual');
    setManualCompanyId(lic.companyId);
    setPlanInput(lic.planType || 'PRO');
    setDurationType('monthly');
    if (lic.seatCount && typeof lic.seatCount === 'number') {
      setSeatCountInput(lic.seatCount);
    }
    showToast(`Loaded ${lic.companyName || lic.companyId} for +30 Days Monthly renewal (${lic.seatCount || 3} Seats). Click "Generate & Sign License".`, 'success');
  };

  const handleOpenSeatsModal = (lic: any) => {
    setSelectedSeatsLicense(lic);
    setNewSeatCount(typeof lic.seatCount === 'number' && lic.seatCount > 0 ? lic.seatCount : 3);
    setUpdatedSeatsResult(null);
  };

  const handleUpdateSeats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeatsLicense) return;
    if (newSeatCount <= 0 || isNaN(newSeatCount)) {
      showToast('Please enter a valid seat count (1 or more)', 'error');
      return;
    }

    setUpdatingSeats(true);
    try {
      const res = await fetch(`/api/authority/licenses/${encodeURIComponent(selectedSeatsLicense.id)}/update-seats`, {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ seatCount: newSeatCount })
      });
      if (res.status === 401) {
        showToast('Authority session expired or unauthorized. Please sign in again.');
        try {
          localStorage.removeItem('authority_token');
        } catch (e) {}
        onLogout();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update workstation seats');
      }

      showToast(`Workstation seats updated to ${newSeatCount} for ${selectedSeatsLicense.companyId}!`, 'success');
      setUpdatedSeatsResult({
        companyId: selectedSeatsLicense.companyId,
        seatCount: newSeatCount,
        licenseKey: data.activationKey || data.shortKey || data.licenseKey,
        licenseFile: data.licenseFile
      });

      // Auto download updated key file
      if (data.licenseFile) {
        const blob = new Blob([data.licenseFile], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ledgerai-ph.lai';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      await fetchDashboard();
    } catch (err: any) {
      showToast(err.message || 'Error updating seats', 'error');
    } finally {
      setUpdatingSeats(false);
    }
  };
  const [generatedResult, setGeneratedResult] = useState<{
    licenseId: string;
    licensePairId?: string;
    keyFileId?: string;
    licenseKey: string;
    licenseFile: string;
    licenseKeyFile?: string;
    keyLicenseFile?: string;
    licenseKeyFileName?: string;
    keyLicenseFileName?: string;
    companyId: string;
    planType: string;
    seatCount?: number | string;
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
      await fetch('/api/authority/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
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
        credentials: 'include',
        body: JSON.stringify({ 
          companyId: targetCompanyId.trim(), 
          planType: planInput,
          durationType,
          seatCount: planInput === 'PRO' ? seatCountInput : undefined,
          customDays: durationType === 'custom' ? parseInt(String(customDays), 10) : undefined
        })
      });
      if (res.status === 401) {
        showToast('Authority session expired or unauthorized. Please sign in again.');
        try {
          localStorage.removeItem('authority_token');
        } catch (e) {}
        onLogout();
        return;
      }
      const json = await res.json();
      if (res.ok) {
        showToast('Dual-File License Pair (.lkey + .lai) issued successfully!', 'success');
        setGeneratedResult({
          ...json,
          durationType,
          customDays: durationType === 'custom' ? customDays : undefined,
          companyId: targetCompanyId.trim()
        });

        const baseSlug = targetCompanyId.trim().slice(-8).toLowerCase();
        if (json.licenseKeyFile) {
          handleDownload(json.licenseKeyFile, json.licenseKeyFileName || `ledgerai-ph-${baseSlug}.lkey`);
        }
        if (json.keyLicenseFile || json.licenseFile) {
          setTimeout(() => {
            handleDownload(json.keyLicenseFile || json.licenseFile, json.keyLicenseFileName || `ledgerai-ph-${baseSlug}.lai`);
          }, 250);
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
        credentials: 'include',
        body: JSON.stringify({ companyId })
      });
      if (res.status === 401) {
        showToast('Authority session expired or unauthorized. Please sign in again.');
        try {
          localStorage.removeItem('authority_token');
        } catch (e) {}
        onLogout();
        return;
      }
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

  const handleDownload = (content: string, filename = 'ledgerai-ph.lai') => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLicenses = (dashboardData.licenses || []).filter((lic: any) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (lic.companyId || '').toLowerCase().includes(q) ||
      (lic.companyName || '').toLowerCase().includes(q) ||
      (lic.planType || '').toLowerCase().includes(q) ||
      (lic.licenseKey || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (tabFilter === 'EXPIRING') return lic.isExpiringSoon;
    if (tabFilter === 'ACTIVE') return (lic.computedStatus || lic.status) === 'ACTIVE';
    if (tabFilter === 'EXPIRED') return lic.isExpired || (lic.computedStatus || lic.status) === 'EXPIRED';
    if (tabFilter === 'ONLINE') return lic.isOnline;

    return true;
  });

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

      {/* Central Authority Live Telemetry & Monitoring Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">
            <span>Total Licenses</span>
            <Key className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {dashboardData.summary?.totalCount ?? dashboardData.licenses?.length ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Registered tenant profiles</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase">
            <span>Active</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {dashboardData.summary?.activeCount ?? 0}
          </div>
          <div className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">Operating normally</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/20 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-400 font-bold uppercase">
            <span>Expiring Soon</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
            {dashboardData.summary?.expiringSoonCount ?? 0}
          </div>
          <div className="text-[11px] text-amber-600 font-medium mt-0.5">Within 7 days (Action required)</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-rose-600 dark:text-rose-400 font-semibold uppercase">
            <span>Expired</span>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
            {dashboardData.summary?.expiredCount ?? 0}
          </div>
          <div className="text-[11px] text-rose-400 mt-0.5">Needs renewal</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-xs text-indigo-600 dark:text-indigo-400 font-semibold uppercase">
            <span>Online Auto-detect</span>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
            {dashboardData.summary?.onlineCount ?? 0}
          </div>
          <div className="text-[11px] text-indigo-500/80 mt-0.5">Live heartbeat connected</div>
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

            {planInput === 'PRO' ? (
              <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl border border-indigo-200 dark:border-indigo-900/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-indigo-900 dark:text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    Licensed Workstation Seats
                  </label>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold font-mono">
                    1 Server + {Math.max(0, (seatCountInput || 3) - 1)} Clients
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={seatCountInput}
                    onChange={e => setSeatCountInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-3 py-1.5 text-sm font-bold font-mono border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-inner"
                  />
                  <div className="flex gap-1 shrink-0">
                    {[3, 5, 8, 10].map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSeatCountInput(s)}
                        className={`px-2 py-1 text-[11px] font-bold rounded border cursor-pointer transition-colors ${
                          seatCountInput === s
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Customizable concurrent office connections (default: 3). Not locked to 3 seats.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-900/50 text-xs text-purple-900 dark:text-purple-200 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                <span>Enterprise plan includes <strong>Unlimited Workstation Seats</strong> across LAN.</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">License Duration</label>
              <select 
                value={durationType}
                onChange={e => setDurationType(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm"
              >
                <option value="trial">Trial (15 Days - Default)</option>
                <option value="monthly">Monthly (30 Days)</option>
                <option value="quarterly">Quarterly (90 Days)</option>
                <option value="yearly">Yearly (365 Days)</option>
                <option value="lifetime">Lifetime (Perpetual)</option>
                <option value="custom">Custom Days</option>
              </select>
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                New company profiles default to a 15-Day Trial period + 15 Days Grace Period remaining.
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
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-[560px]">
          <div className="flex flex-col gap-3 border-b border-slate-100 dark:border-slate-700/50 pb-4 mb-3 shrink-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Active Tenant Licenses &amp; Live Monitoring
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Real-time status, single-device anti-piracy lock, days remaining, and renewal tracking.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Company ID, Name or Key..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Quick Status / Expiring Soon Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold pt-1">
              <button
                type="button"
                onClick={() => setTabFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  tabFilter === 'ALL'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                All ({dashboardData.licenses?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('EXPIRING')}
                className={`px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                  tabFilter === 'EXPIRING'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Expiring Soon ({dashboardData.summary?.expiringSoonCount || 0})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  tabFilter === 'ACTIVE'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                Active ({dashboardData.summary?.activeCount || 0})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('EXPIRED')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  tabFilter === 'EXPIRED'
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                Expired ({dashboardData.summary?.expiredCount || 0})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('ONLINE')}
                className={`px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                  tabFilter === 'ONLINE'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Online ({dashboardData.summary?.onlineCount || 0})
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto rounded-xl border border-slate-100 dark:border-slate-700">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[780px]">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Company Profile</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Plan</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Activation Key</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Status</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Days Remaining</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Auto-detect Online</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Expiration Date</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {filteredLicenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      No licenses found matching the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredLicenses.map((lic: any) => {
                    const daysRemaining = lic.daysRemaining;
                    const isExpired = lic.isExpired || (lic.computedStatus || lic.status) === 'EXPIRED';

                    return (
                      <tr key={lic.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{lic.companyName || 'Registered Enterprise Client'}</div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{lic.companyId}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-indigo-600 dark:text-indigo-400 text-xs">
                            {lic.planType}
                          </div>
                          {lic.planType === 'ENTERPRISE' ? (
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              Unlimited Seats
                            </span>
                          ) : (
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                              {lic.seatCount || 3} Seats
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                          <div className="flex items-center gap-1.5">
                            <span className="max-w-[120px] truncate" title={lic.licenseKey}>{lic.licenseKey}</span>
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
                            isExpired
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                              : lic.status === 'ACTIVE' 
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' 
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          }`}>
                            {isExpired ? 'EXPIRED' : lic.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {lic.isLifetime ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                              <Zap className="w-3 h-3" /> LIFETIME
                            </span>
                          ) : isExpired ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400">
                              <AlertTriangle className="w-3 h-3" /> Expired (0d)
                            </span>
                          ) : daysRemaining !== null && daysRemaining <= 3 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 animate-pulse">
                              <Clock className="w-3 h-3" /> {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} left!
                            </span>
                          ) : daysRemaining !== null && daysRemaining <= 7 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              <Clock className="w-3 h-3" /> {daysRemaining} days left
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              <Clock className="w-3 h-3" /> {daysRemaining ?? '—'} days left
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            {lic.isOnline ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400" title={`Heartbeat active from IP: ${lic.clientIp || '127.0.0.1'}`}>
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title={lic.lastHeartbeat ? `Last seen: ${new Date(lic.lastHeartbeat).toLocaleString()}` : 'No heartbeat reported yet'}>
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" /> Offline
                              </span>
                            )}
                            {lic.claimedByInstallationId && (
                              <span className="text-[10px] font-mono text-slate-400 truncate max-w-[120px]" title={`Locked to server installation: ${lic.claimedByInstallationId}`}>
                                Lock: {lic.claimedByInstallationId.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-medium">
                          {lic.expirationDate || 'LIFETIME'}
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleOneClickRenew(lic)}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-md text-[11px] font-bold transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title="1-Click Renew (+30 Days Monthly)"
                          >
                            <RotateCw className="w-3 h-3" /> Renew
                          </button>
                          {lic.planType === 'PRO' && (
                            <button
                              type="button"
                              onClick={() => handleOpenSeatsModal(lic)}
                              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-md text-[11px] font-bold transition-colors inline-flex items-center gap-1 cursor-pointer"
                              title="Add / Edit Seats (Preserves same license key, generates updated .lai file)"
                            >
                              <Users className="w-3 h-3" /> + Seats ({lic.seatCount || 3})
                            </button>
                          )}
                          <button 
                            onClick={() => setInspectLicense(lic)} 
                            className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer rounded hover:bg-slate-100 dark:hover:bg-slate-700" 
                            title="Inspect Key & File Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {lic.keyFileContent && (
                            <button 
                              onClick={() => handleDownload(lic.keyFileContent, `ledgerai-ph-${(lic.companyId || '').slice(-8).toLowerCase()}.lkey`)} 
                              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer rounded hover:bg-slate-100 dark:hover:bg-slate-700" 
                              title="Download License Key File (.lkey)"
                            >
                              <Key className="w-4 h-4" />
                            </button>
                          )}
                          {lic.signedFileContent && (
                            <button 
                              onClick={() => handleDownload(lic.signedFileContent, `ledgerai-ph-${(lic.companyId || '').slice(-8).toLowerCase()}.lai`)} 
                              className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer rounded hover:bg-slate-100 dark:hover:bg-slate-700" 
                              title="Download Key License File (.lai)"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button 
                            onClick={() => handleRevoke(lic.id, lic.companyId)}
                            disabled={lic.status === 'REVOKED'}
                            className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30 transition-colors cursor-pointer rounded hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="Revoke License"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
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
                  <span className="text-slate-400 font-medium">Plan Tier &amp; Seats:</span>
                  <p className="font-bold text-indigo-600 dark:text-indigo-400">
                    {generatedResult.planType} ({generatedResult.seatCount ? `${generatedResult.seatCount} Seats` : generatedResult.planType === 'ENTERPRISE' ? 'Unlimited Seats' : '3 Seats'})
                  </p>
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

              {/* 1. REQUIRED FILE A: LICENSE KEY FILE (.lkey) */}
              {generatedResult.licenseKeyFile && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      1. License Key File (.lkey)
                    </label>
                    <span className="text-[11px] text-slate-400">Authorized cryptographic key identity</span>
                  </div>
                  <div className="flex items-center justify-between p-3.5 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
                        <Key className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-mono font-bold text-xs text-emerald-950 dark:text-emerald-200">{generatedResult.licenseKeyFileName || 'ledgerai-ph.lkey'}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">Pair ID: {generatedResult.licensePairId || 'N/A'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(generatedResult.licenseKeyFile, generatedResult.licenseKeyFileName || 'ledgerai-ph.lkey')}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                    >
                      <Download className="w-3.5 h-3.5" /> Download .lkey
                    </button>
                  </div>
                </div>
              )}

              {/* 2. REQUIRED FILE B: KEY LICENSE FILE (.lai) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    2. Key License File (.lai)
                  </label>
                  <span className="text-[11px] text-slate-400">Cryptographically signed authorization file</span>
                </div>
                <div className="flex items-center justify-between p-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-lg">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-mono font-bold text-xs text-indigo-950 dark:text-indigo-200">{generatedResult.keyLicenseFileName || 'ledgerai-ph.lai'}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Paired entitlement &amp; company-bound signature</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(generatedResult.keyLicenseFile || generatedResult.licenseFile, generatedResult.keyLicenseFileName || 'ledgerai-ph.lai')}
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
                    const fullDetails = `LEDGERAI PH LICENSE ACTIVATION DETAILS\nCompany ID: ${generatedResult.companyId}\nPlan: ${generatedResult.planType}\nActivation Key: ${generatedResult.licenseKey}\nExpires: ${generatedResult.expirationDate || 'LIFETIME'}\n\nPlease enter this Activation Key or upload the ledgerai-ph.lai file under Settings > System Licensing.`;
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
                  <span className="text-slate-400 font-medium">Plan Tier &amp; Seats:</span>
                  <p className="font-bold text-indigo-600 dark:text-indigo-400">
                    {inspectLicense.planType} ({inspectLicense.planType === 'ENTERPRISE' ? 'Unlimited Seats' : `${inspectLicense.seatCount || 3} Seats`})
                  </p>
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
                      <p className="font-mono font-bold text-xs text-indigo-950 dark:text-indigo-200">ledgerai-ph.lai</p>
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

      {/* ADD / EDIT WORKSTATION SEATS MODAL */}
      {selectedSeatsLicense && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-indigo-50/50 dark:bg-indigo-950/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    Add / Edit Workstation Seats (PRO Plan)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Expand server workstation connections while preserving the exact same license key.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setSelectedSeatsLicense(null); setUpdatedSeatsResult(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Company & Current License Info */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Company Profile:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {selectedSeatsLicense.companyName || 'Registered Client'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Company ID:</span>
                  <span className="font-mono text-slate-600 dark:text-slate-300">
                    {selectedSeatsLicense.companyId}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Current Licensed Seats:</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                    {selectedSeatsLicense.seatCount || 3} Concurrent Workstations
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-400 font-medium">Activation Key:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                    {selectedSeatsLicense.licenseKey}
                  </span>
                </div>
              </div>

              {!updatedSeatsResult ? (
                <form onSubmit={handleUpdateSeats} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide flex items-center justify-between">
                      <span>New Total Workstation Seats</span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold text-xs">
                        1 Server + {Math.max(0, newSeatCount - 1)} Clients
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={newSeatCount}
                        onChange={e => setNewSeatCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full px-3.5 py-2.5 text-base font-bold font-mono border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm"
                        required
                      />
                      <div className="flex gap-1.5 shrink-0">
                        {[4, 5, 8, 10, 15].map(cnt => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => setNewSeatCount(cnt)}
                            className={`px-2.5 py-2 text-xs font-bold rounded-lg border cursor-pointer transition-colors ${
                              newSeatCount === cnt
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {cnt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Activation Key Remains Unchanged:</strong> Only the cryptographic signed key file (<code className="font-mono bg-white dark:bg-slate-900 px-1 py-0.5 rounded">ledgerai-ph.lai</code>) will be re-signed with the expanded seats. Future renewals will automatically maintain this updated seat count.
                    </span>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedSeatsLicense(null)}
                      className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={updatingSeats}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {updatingSeats ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                      <span>Save &amp; Generate Signed Key File</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200 text-xs space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                      Seats Updated to {updatedSeatsResult.seatCount} Workstations!
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                      The updated cryptographic license file has been signed. Download it and import into the client system via <strong>Settings &rarr; Manage License &rarr; Upload .lai Key File</strong>.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(updatedSeatsResult.licenseFile)}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4" /> Download Updated Key File (.lai)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSelectedSeatsLicense(null); setUpdatedSeatsResult(null); }}
                      className="px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
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
      const token = localStorage.getItem('authority_token');
      return Boolean(token && token.trim().length > 0);
    } catch (e) {
      console.warn('LocalStorage read blocked in LicenseAuthorityApp initialization:', e);
      return false;
    }
  });

  useEffect(() => {
    try {
      const token = localStorage.getItem('authority_token');
      if (token && token.trim().length > 0) {
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
