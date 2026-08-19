import React, { useEffect, useState } from 'react';
import { Users, Server, Lock, Activity, RefreshCw, Globe, Terminal, Copy, Check, Info, ShieldCheck, Network } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ServerInfo {
  hostname: string;
  primaryIp: string;
  lanIps: { name: string; address: string; family: string; internal: boolean }[];
  domain: string;
  port: number;
  internalPort: number;
  dnsRecordGuide: {
    host: string;
    type: string;
    value: string;
  };
  clientSetupCommand: string;
}

export default function LanServerDashboard() {
  const { hasPermission } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const [sessionsRes, serverRes] = await Promise.all([
        fetch('/api/lan/sessions', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }),
        fetch('/api/lan/server-info', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        })
      ]);

      if (sessionsRes.ok) {
        const sessData = await sessionsRes.json();
        setSessions(sessData);
      }

      if (serverRes.ok) {
        const srvData = await serverRes.json();
        setServerInfo(srvData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const killSession = async (id: string) => {
    if (!confirm('Are you sure you want to forcibly terminate this user session? Any unsaved data will be lost.')) return;
    try {
      const res = await fetch(`/api/lan/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        fetchStatus();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to terminate session.');
      }
    } catch (e: any) {
      alert(e.message || 'Failed to terminate session.');
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const serverIp = serverInfo?.primaryIp || '192.168.1.10';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <Server className="w-6 h-6 text-emerald-600" /> Multi-User Local LAN Server Unit
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time multi-workstation concurrency, localized <code className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">http://ledgerai.ph</code> resolution, and automated record locks.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Status
        </button>
      </div>

      {/* Network & Hostname Resolution Status Card */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white p-6 rounded-2xl border border-slate-800 shadow-lg space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100">http://ledgerai.ph</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active Port 80 Proxy
                </span>
              </div>
              <p className="text-xs text-slate-400">Zero-port typing required. Automatically mapped to background service port 3000.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700 text-xs font-mono text-slate-300">
              Server Hostname: <span className="font-bold text-white">{serverInfo?.hostname || 'LOCAL-SERVER'}</span>
            </div>
            <div className="px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700 text-xs font-mono text-emerald-400">
              Server LAN IP: <span className="font-bold text-white">{serverIp}</span>
            </div>
          </div>
        </div>

        {/* Resolution Architecture Methods */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Method A: Router / LAN DNS */}
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wide">
                <Network className="w-3.5 h-3.5" /> Option A: Enterprise Router / DNS (Zero Client Setup)
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(`ledgerai.ph IN A ${serverIp}`, 'dns')}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
              >
                {copiedKey === 'dns' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedKey === 'dns' ? 'Copied' : 'Copy DNS Record'}
              </button>
            </div>
            <p className="text-[11px] text-slate-300">
              Add a DNS A-record to your local router (e.g. pfSense, Pi-hole, Windows Server DNS, Mikrotik). All LAN devices can open <code className="text-emerald-300 font-bold">http://ledgerai.ph</code> immediately with zero software configuration.
            </p>
            <div className="p-2.5 bg-slate-950 rounded-lg font-mono text-xs text-slate-200 border border-slate-800 flex items-center justify-between">
              <span>Host: <strong className="text-emerald-400">ledgerai.ph</strong> &nbsp;→&nbsp; IP: <strong className="text-emerald-400">{serverIp}</strong></span>
            </div>
          </div>

          {/* Method B: Workstation Setup Script */}
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-400 flex items-center gap-1.5 uppercase tracking-wide">
                <Terminal className="w-3.5 h-3.5" /> Option B: Client Workstation Setup Script
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(`.\\configure-lan-client.ps1 -ServerIp ${serverIp}`, 'cmd')}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
              >
                {copiedKey === 'cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedKey === 'cmd' ? 'Copied' : 'Copy Command'}
              </button>
            </div>
            <p className="text-[11px] text-slate-300">
              Run this one-line command as Administrator on each LAN workstation PC to point <code className="text-indigo-300 font-bold">ledgerai.ph</code> directly to this Server Unit:
            </p>
            <div className="p-2.5 bg-slate-950 rounded-lg font-mono text-xs text-indigo-300 border border-slate-800 flex items-center justify-between truncate">
              <span>.\configure-lan-client.ps1 -ServerIp {serverIp}</span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400 pt-1">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <span>
            <strong>Server Unit Local vs. LAN Client Resolution:</strong> The Server Unit resolves <code className="text-slate-200">ledgerai.ph</code> via local loopback (<code className="text-slate-200">127.0.0.1</code>), while other LAN workstations resolve <code className="text-slate-200">ledgerai.ph</code> directly to the Server Unit LAN IP (<code className="text-emerald-300 font-bold">{serverIp}</code>). Windows Defender Firewall is pre-configured for TCP 80 & 3000.
          </span>
        </div>
      </div>

      {/* Top 3 Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border shadow-sm flex items-center gap-4">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{sessions.length}</div>
            <div className="text-xs text-slate-500">Connected LAN Workstations</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border shadow-sm flex items-center gap-4">
          <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 rounded-xl">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">Active / Synced</div>
            <div className="text-xs text-slate-500">Posting Serialization Engine</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border shadow-sm flex items-center gap-4">
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 text-amber-600 rounded-xl">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">Enforced</div>
            <div className="text-xs text-slate-500">Optimistic Concurrency & Locks</div>
          </div>
        </div>
      </div>

      {/* Connected Users Table */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Connected Sessions on Local LAN</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[650px]">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="p-3">Session ID</th>
                <th className="p-3">User ID</th>
                <th className="p-3">Client IP</th>
                <th className="p-3">Last Active</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">No active LAN sessions recorded yet. Active user sessions will appear here.</td>
                </tr>
              ) : (
                sessions.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="p-3 font-mono">{s.id.slice(0, 8)}...</td>
                    <td className="p-3 font-mono">{s.userId}</td>
                    <td className="p-3 font-mono text-emerald-600">{s.clientIp}</td>
                    <td className="p-3 text-slate-500">{new Date(s.lastActiveAt).toLocaleTimeString()}</td>
                    <td className="p-3 text-right">
                      {hasPermission('lan:sessions:terminate') ? (
                        <button onClick={() => killSession(s.id)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[11px] font-bold cursor-pointer">
                          Force Logout
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">Protected</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
