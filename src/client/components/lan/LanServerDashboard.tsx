import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users,
  Server,
  Lock,
  Activity,
  RefreshCw,
  Globe,
  Terminal,
  Copy,
  Check,
  Info,
  Network,
  AlertCircle,
  ShieldAlert,
  Database,
  HardDrive,
  Clock,
  FolderArchive,
  Building2,
  AlertTriangle,
  Monitor,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/apiClient';
import TableFilterToolbar, { SortOrderDirection, DatePeriodFilter, computePeriodDates } from '../shared/TableFilterToolbar';
import { TableScrollContainer } from '../shared/TableScrollContainer';

export interface LanConcurrencyInfo {
  planType: string;
  maxWorkstations: number | 'UNLIMITED';
  activeWorkstations: number;
  activeIps: string[];
  activeSessions: number;
  isLimitReached: boolean;
}

export interface ClassifiedLanInterface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
  classification: 'LOOPBACK' | 'LINK_LOCAL' | 'PRIVATE_LAN' | 'CGNAT' | 'PUBLIC' | 'INVALID';
  usableForLan: boolean;
  reason: string;
}

export interface ServerErrorLogEntry {
  timestamp: string;
  code: string;
  message: string;
  path?: string;
  method?: string;
  statusCode?: number;
}

export interface ServerDashboardSnapshot {
  serverStatus: 'ONLINE' | 'DEGRADED';
  deploymentMode: 'SERVER' | 'SINGLE_PC' | 'SERVER_AND_DESKTOP';
  startedAt: string;
  uptimeSeconds: number;
  serverHostname: string;
  localIpAddress: string | null;
  effectiveBindAddress: string;
  configuredLanHostname: string;
  alternateLanHostname: string;
  listeningPort: number;
  internalPort: number;
  port80ProxyActive: boolean;
  accessUrls: {
    primaryLanUrl: string | null;
    alternateLanUrl: string | null;
    directIpUrl: string | null;
    localUrl: string;
  };
  activeClientConnections: number;
  activeAuthenticatedSessions: number;
  registeredCompanyCount: number;
  openDatabaseCount: number;
  databaseStorageBytes: number;
  documentStorageBytes: number;
  availableDiskBytes: number | null;
  totalDiskBytes: number | null;
  backupStatus: 'HEALTHY' | 'NO_BACKUPS_YET' | 'ATTENTION_REQUIRED';
  lastSuccessfulBackupAt: string | null;
  backupCount: number;
  serverHealth: 'HEALTHY' | 'DEGRADED';
  networkConnectivity: 'USABLE_PRIVATE_LAN_DETECTED' | 'NO_USABLE_LAN_INTERFACE';
  networkDiagnosticMessage: string;
  lanInterfaces: ClassifiedLanInterface[];
  excludedInterfaces: ClassifiedLanInterface[];
  dnsRecordGuide: {
    host: string;
    type: string;
    value: string;
  } | null;
  clientSetupCommand: string | null;
  recentServerErrors: ServerErrorLogEntry[];
  topology?: {
    topology?: string;
    isSingleInstanceServer?: boolean;
    warnings?: string[];
  };
  timestamp: string;
}

export function normalizeLanSessionsResponse(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.sessions)) return obj.sessions;
    if (Array.isArray(obj.data)) return obj.data;
  }
  return [];
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[idx]}`;
}

function formatUptime(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || seconds === undefined || seconds < 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatDeploymentMode(mode?: string): string {
  switch (mode) {
    case 'SERVER':
      return 'Central Server Mode';
    case 'SINGLE_PC':
      return 'Single-PC Standalone';
    case 'SERVER_AND_DESKTOP':
      return 'Central Server + Local Desktop';
    default:
      return 'Central Server';
  }
}

export default function LanServerDashboard() {
  const { hasPermission, planType, isEnterprise } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [concurrencyInfo, setConcurrencyInfo] = useState<LanConcurrencyInfo | null>(null);
  const [dashboard, setDashboard] = useState<ServerDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [confirmTerminateId, setConfirmTerminateId] = useState<string | null>(null);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);

  const inFlightRef = useRef(false);

  const canTerminateSessions = hasPermission('lan:sessions:terminate');

  const fetchStatus = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);

    try {
      const [sessionsResult, dashboardResult] = await Promise.allSettled([
        apiFetch<unknown>('/api/lan/sessions'),
        apiFetch<ServerDashboardSnapshot>('/api/lan/server-dashboard'),
      ]);

      const errors: string[] = [];

      if (sessionsResult.status === 'fulfilled') {
        const val = sessionsResult.value;
        setSessions(normalizeLanSessionsResponse(val));
        if (val && typeof val === 'object' && 'concurrency' in (val as Record<string, unknown>)) {
          setConcurrencyInfo((val as any).concurrency);
        }
      } else {
        setSessions([]);
        errors.push(sessionsResult.reason?.message || 'Failed to load connected LAN sessions');
      }

      if (dashboardResult.status === 'fulfilled' && dashboardResult.value && typeof dashboardResult.value === 'object') {
        setDashboard(dashboardResult.value);
      } else {
        setDashboard(null);
        const msg =
          dashboardResult.status === 'rejected'
            ? dashboardResult.reason?.message || 'Failed to load server dashboard telemetry'
            : 'Invalid telemetry response';
        if (!errors.includes(msg)) errors.push(msg);
      }

      setFetchError(errors.length > 0 ? errors.join(' | ') : null);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load central server information');
      setSessions([]);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  const executeKillSession = async (id: string) => {
    if (!id || terminatingId) return;
    setTerminatingId(id);
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiFetch(`/api/lan/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setConfirmTerminateId(null);
      setActionSuccess(`Session ${id.slice(0, 8)}... terminated.`);
      await fetchStatus();
    } catch (e: any) {
      setActionError(e?.message || 'Failed to terminate session.');
    } finally {
      setTerminatingId(null);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const distinctWorkstationIps = Array.from(new Set(safeSessions.map((s: any) => s?.clientIp || '127.0.0.1')));
  const activeWorkstationCount = concurrencyInfo?.activeWorkstations ?? distinctWorkstationIps.length;
  const isPlanEnterprise = isEnterprise || planType === 'ENTERPRISE' || concurrencyInfo?.planType === 'ENTERPRISE';
  const maxLicensedSeats = typeof concurrencyInfo?.maxWorkstations === 'number' && concurrencyInfo.maxWorkstations > 0
    ? concurrencyInfo.maxWorkstations
    : 3;
  const usableLanAvailable = dashboard?.networkConnectivity === 'USABLE_PRIVATE_LAN_DETECTED' && Boolean(dashboard?.localIpAddress);
  const usableServerIp = usableLanAvailable ? dashboard!.localIpAddress! : null;
  const effectivePort = dashboard?.internalPort || 3000;
  const configuredLanHostname = dashboard?.configuredLanHostname || 'ledgerai.local';
  const alternateLanHostname = dashboard?.alternateLanHostname || 'ledgerai-server.local';
  const excludedInterfaces = Array.isArray(dashboard?.excludedInterfaces) ? dashboard!.excludedInterfaces : [];
  const recentErrors = Array.isArray(dashboard?.recentServerErrors) ? dashboard!.recentServerErrors : [];

  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState<SortOrderDirection>('DESC');
  const [sessionPageIndex, setSessionPageIndex] = useState(0);
  const [sessionPageSize, setSessionPageSize] = useState(20);

  const filteredSessions = React.useMemo(() => {
    let result = [...safeSessions];
    if (sessionSearch.trim()) {
      const q = sessionSearch.toLowerCase();
      result = result.filter(s =>
        String(s?.id || '').toLowerCase().includes(q) ||
        String(s?.userId || '').toLowerCase().includes(q) ||
        String(s?.clientIp || '').toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const dateA = a?.lastActiveAt || '';
      const dateB = b?.lastActiveAt || '';
      const cmp = dateA.localeCompare(dateB);
      return sessionSortOrder === 'ASC' ? cmp : -cmp;
    });
    return result;
  }, [safeSessions, sessionSearch, sessionSortOrder]);

  const pagedSessions = React.useMemo(() => {
    return filteredSessions.slice(sessionPageIndex * sessionPageSize, (sessionPageIndex + 1) * sessionPageSize);
  }, [filteredSessions, sessionPageIndex, sessionPageSize]);

  const handleResetSessionFilters = () => {
    setSessionSearch('');
    setSessionSortOrder('DESC');
    setSessionPageIndex(0);
  };

  const diskUsedPct =
    dashboard?.totalDiskBytes && dashboard.availableDiskBytes !== null && dashboard.totalDiskBytes > 0
      ? Math.min(100, Math.max(0, Math.round(((dashboard.totalDiskBytes - dashboard.availableDiskBytes) / dashboard.totalDiskBytes) * 100)))
      : null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6" data-testid="server-management-dashboard">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-[#11192B] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Server className="w-6 h-6 text-teal-600 dark:text-teal-400 shrink-0" />
            <h1 className="font-display text-xl font-extrabold text-slate-900 dark:text-slate-100">
              Central Server &amp; LAN Management Dashboard
            </h1>
            <span
              data-testid="server-status-badge"
              className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${
                dashboard?.serverStatus === 'DEGRADED'
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                  : 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800'
              }`}
            >
              {dashboard?.serverStatus || 'ONLINE'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {formatDeploymentMode(dashboard?.deploymentMode)} &middot; Centralized multi-company database server, LAN browser access (<code className="font-mono text-teal-700 dark:text-teal-400 font-semibold">http://{configuredLanHostname}</code>), and concurrency health.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchStatus}
          disabled={loading}
          className="px-4 py-2 bg-slate-100 dark:bg-[#162238] hover:bg-slate-200 dark:hover:bg-[#1F2F4C] disabled:opacity-60 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {fetchError && (
        <div
          role="alert"
          data-testid="lan-fetch-error"
          className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-3 text-rose-800 dark:text-rose-200 text-xs"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>Server Telemetry Error: {fetchError}</span>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          data-testid="lan-action-error"
          className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center justify-between gap-3 text-rose-800 dark:text-rose-200 text-xs"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button type="button" onClick={() => setActionError(null)} className="text-[11px] font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {actionSuccess && (
        <div
          role="status"
          data-testid="lan-action-success"
          className="p-4 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 rounded-xl flex items-center justify-between gap-3 text-teal-800 dark:text-teal-200 text-xs"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-teal-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-[11px] font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Key Operational Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex items-center gap-3.5">
          <div className="p-3 bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div data-testid="server-uptime" className="text-xl font-black text-slate-900 dark:text-slate-50 font-mono">
              {formatUptime(dashboard?.uptimeSeconds)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Uptime &middot; Port {effectivePort}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex items-center gap-3.5">
          <div className={`p-3 rounded-xl ${
            isPlanEnterprise
              ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400'
              : activeWorkstationCount >= 3
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400'
              : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-sky-400'
          }`}>
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div data-testid="lan-session-count" className="text-xl font-black text-slate-900 dark:text-slate-50 font-mono">
              {isPlanEnterprise ? `${activeWorkstationCount} WS` : `${activeWorkstationCount} / 3 WS`}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {isPlanEnterprise ? 'Enterprise (Unlimited)' : 'Pro (Max 3 Workstations)'} &middot; {safeSessions.length} Session{safeSessions.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex items-center gap-3.5">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 rounded-xl">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div data-testid="server-company-count" className="text-xl font-black text-slate-900 dark:text-slate-50 font-mono">
              {dashboard?.registeredCompanyCount ?? 0}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Companies &middot; {dashboard?.openDatabaseCount ?? 0} Open DB Pool
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex items-center gap-3.5">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 rounded-xl">
            <FolderArchive className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div data-testid="server-backup-status" className="text-base font-black text-slate-900 dark:text-slate-50">
              {dashboard?.backupStatus === 'HEALTHY'
                ? 'Backups Ready'
                : dashboard?.backupStatus === 'ATTENTION_REQUIRED'
                ? 'No Backup Yet'
                : 'Standby'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {dashboard?.lastSuccessfulBackupAt
                ? `Last: ${new Date(dashboard.lastSuccessfulBackupAt).toLocaleDateString()}`
                : `${dashboard?.backupCount ?? 0} archive(s)`}
            </div>
          </div>
        </div>
      </div>

      {/* Storage & Disk Capacity Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <Database className="w-4 h-4 text-blue-600 dark:text-sky-400" />
            <span>Central Database Storage</span>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-slate-50">
            {formatBytes(dashboard?.databaseStorageBytes)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Encrypted company ledgers managed exclusively by the central server process.
          </p>
        </div>

        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <HardDrive className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>Document Vault Storage</span>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-slate-50">
            {formatBytes(dashboard?.documentStorageBytes)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Centralized invoices, official receipts, BIR certificates, and supporting attachments.
          </p>
        </div>

        <div className="bg-white dark:bg-[#11192B] p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Available Disk Space
            </span>
            {diskUsedPct !== null && (
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {diskUsedPct}% used
              </span>
            )}
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-slate-50">
            {formatBytes(dashboard?.availableDiskBytes)}
          </div>
          {diskUsedPct !== null && (
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  diskUsedPct > 90 ? 'bg-rose-500' : diskUsedPct > 75 ? 'bg-amber-500' : 'bg-teal-500'
                }`}
                style={{ width: `${diskUsedPct}%` }}
              />
            </div>
          )}
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Total volume: {formatBytes(dashboard?.totalDiskBytes)}
          </p>
        </div>
      </div>

      {/* Diagnostic Banner when no usable RFC 1918 Private LAN Interface exists */}
      {dashboard && !usableLanAvailable && (
        <div
          data-testid="lan-no-usable-interface-banner"
          className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2 text-amber-900 dark:text-amber-200 text-xs"
        >
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Diagnostic State: No Usable RFC 1918 Private LAN Interface Detected ({dashboard.networkConnectivity})
            </span>
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-300">{dashboard.networkDiagnosticMessage}</p>
          {excludedInterfaces.length > 0 && (
            <div className="pt-1 flex flex-wrap gap-2">
              {excludedInterfaces.map((iface) => (
                <span
                  key={`${iface.name}-${iface.address}`}
                  className="px-2 py-1 rounded-md bg-amber-100/80 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 font-mono text-[10px]"
                >
                  {iface.name}: {iface.address} [{iface.classification} — Excluded]
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Network & Browser Client Access Endpoints Card */}
      <div className="bg-slate-900 dark:bg-[#0D1627] text-white p-6 rounded-2xl border border-slate-800 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-500/20 text-teal-400 rounded-xl border border-teal-500/30">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-100 font-mono">
                  {dashboard?.accessUrls?.primaryLanUrl || `http://${configuredLanHostname}:${effectivePort}`}
                </h2>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                    dashboard?.port80ProxyActive
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {dashboard?.port80ProxyActive
                    ? 'Port 80 Proxy Active'
                    : `Service Port ${effectivePort}`}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Browser-based clients on the office LAN open this URL directly — no client database installation required.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700 text-xs font-mono text-slate-300">
              Host: <span className="font-bold text-white">{dashboard?.serverHostname || 'LOCAL-SERVER'}</span>
            </div>
            <div
              data-testid="lan-primary-ip-badge"
              className="px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700 text-xs font-mono text-teal-400"
            >
              LAN IP:{' '}
              <span className="font-bold text-white">
                {usableServerIp || 'Loopback 127.0.0.1'}
              </span>
            </div>
          </div>
        </div>

        {/* Access URLs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              key: 'primary-url',
              label: 'Primary LAN URL (mDNS / Router DNS)',
              value: dashboard?.accessUrls?.primaryLanUrl || `http://${configuredLanHostname}:${effectivePort}`,
            },
            {
              key: 'alt-url',
              label: 'Alternate LAN Hostname',
              value: dashboard?.accessUrls?.alternateLanUrl || `http://${alternateLanHostname}:${effectivePort}`,
            },
            {
              key: 'direct-url',
              label: 'Direct IP Fallback URL',
              value: dashboard?.accessUrls?.directIpUrl || dashboard?.accessUrls?.localUrl || `http://127.0.0.1:${effectivePort}`,
            },
          ].map((item) => (
            <div key={item.key} className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/80 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{item.label}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(item.value, item.key)}
                  className="text-[11px] text-slate-300 hover:text-white inline-flex items-center gap-1 cursor-pointer font-mono"
                >
                  {copiedKey === item.key ? <Check className="w-3 h-3 text-teal-400" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === item.key ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="font-mono text-xs text-teal-300 truncate">{item.value}</div>
            </div>
          ))}
        </div>

        {/* DNS & Workstation Setup Commands */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-teal-400 flex items-center gap-1.5 uppercase tracking-wide">
                <Network className="w-3.5 h-3.5" /> Option A: Local Router / Office DNS (Zero Client Setup)
              </span>
              {usableServerIp && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(`${configuredLanHostname} IN A ${usableServerIp}`, 'dns')}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
                >
                  {copiedKey === 'dns' ? <Check className="w-3 h-3 text-teal-400" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === 'dns' ? 'Copied' : 'Copy DNS Record'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-300">
              Assign a static DHCP lease to PC 1 and add an internal DNS A-record so every office workstation reaches{' '}
              <code className="text-teal-300">http://{configuredLanHostname}</code>.
            </p>
            <div className="p-2.5 bg-slate-950 rounded-lg font-mono text-xs text-slate-200 border border-slate-800">
              {usableServerIp ? (
                <span>
                  Host: <strong className="text-teal-400">{configuredLanHostname}</strong> &rarr; IP:{' '}
                  <strong className="text-teal-400">{usableServerIp}</strong>
                </span>
              ) : (
                <span className="text-amber-300">Awaiting private RFC 1918 LAN IPv4 address</span>
              )}
            </div>
          </div>

          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5 uppercase tracking-wide">
                <Terminal className="w-3.5 h-3.5" /> Option B: Client Workstation Setup Script
              </span>
              {dashboard?.clientSetupCommand && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(dashboard.clientSetupCommand!, 'cmd')}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
                >
                  {copiedKey === 'cmd' ? <Check className="w-3 h-3 text-teal-400" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === 'cmd' ? 'Copied' : 'Copy Command'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-300">
              Optional shortcut &amp; hosts fallback script for client PCs if router DNS or mDNS is unavailable:
            </p>
            <div className="p-2.5 bg-slate-950 rounded-lg font-mono text-xs text-sky-300 border border-slate-800 truncate">
              {dashboard?.clientSetupCommand || 'Awaiting private RFC 1918 LAN IPv4 address'}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400 pt-1">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <span>
            <strong>Single-Instance Database Protection:</strong> Only this central server process accesses company ledger files. Never share company data folders via SMB/UNC network shares.
          </span>
        </div>
      </div>

      {/* Connected Users Table & Recent Server Errors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-[#11192B] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Active Company LAN Sessions &amp; Concurrency</span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {isPlanEnterprise ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Enterprise: Unlimited Workstations
                </span>
              ) : (
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1.5 ${
                  activeWorkstationCount >= maxLicensedSeats
                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                    : 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${activeWorkstationCount >= maxLicensedSeats ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                  Pro Plan: {activeWorkstationCount} / {maxLicensedSeats} Workstation{maxLicensedSeats === 1 ? '' : 's'}
                </span>
              )}
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                ({safeSessions.length} active session{safeSessions.length === 1 ? '' : 's'})
              </span>
            </div>
          </div>

          {/* Workstation Concurrency Visual Slots */}
          {!isPlanEnterprise ? (
            <div className="p-3.5 bg-slate-50 dark:bg-[#0D1526] rounded-xl border border-slate-200 dark:border-[#1E2D45] space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  Pro Plan Workstation Slots (Limit: {maxLicensedSeats} Concurrent Machine{maxLicensedSeats === 1 ? '' : 's'})
                </span>
                <span className={`font-mono text-[11px] font-semibold px-2 py-0.5 rounded ${
                  activeWorkstationCount >= maxLicensedSeats
                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                    : 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300'
                }`}>
                  {maxLicensedSeats - activeWorkstationCount > 0 ? `${maxLicensedSeats - activeWorkstationCount} slot(s) available` : 'Full capacity'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {Array.from({ length: maxLicensedSeats }).map((_, slotIdx) => {
                  const ip = distinctWorkstationIps[slotIdx];
                  const isOccupied = Boolean(ip);
                  const isServer = ip === '127.0.0.1' || ip === dashboard?.localIpAddress;
                  return (
                    <div
                      key={slotIdx}
                      className={`p-2.5 rounded-lg border text-xs transition-all ${
                        isOccupied
                          ? 'bg-white dark:bg-[#11192B] border-teal-300 dark:border-teal-800/80 shadow-xs'
                          : 'bg-slate-100/70 dark:bg-[#162238]/40 border-dashed border-slate-300 dark:border-slate-700 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                          {slotIdx === 0 ? 'Primary / Server' : `Client PC ${slotIdx}`}
                        </span>
                        <span className={`w-2 h-2 rounded-full ${isOccupied ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      </div>
                      <div className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {isOccupied ? ip : 'Slot Available'}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {isOccupied ? (isServer ? 'Central Server / Local Host' : 'LAN Client Workstation') : 'Ready to connect'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeWorkstationCount >= maxLicensedSeats && (
                <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-lg text-amber-800 dark:text-amber-300 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Maximum {maxLicensedSeats} concurrent workstation{maxLicensedSeats === 1 ? '' : 's'} reached for Pro Plan. To connect more office computers simultaneously, terminate an idle session below or expand seats in Key Generator or upgrade to <strong>Enterprise Plan</strong> for unlimited concurrent workstations.
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3.5 bg-gradient-to-r from-indigo-50/70 to-purple-50/70 dark:from-indigo-950/40 dark:to-purple-950/40 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                  <Monitor className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    Enterprise Plan: Unlimited Concurrent Workstations Active
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    No workstation limit is enforced. All local workstations ({distinctWorkstationIps.length} currently active) enjoy full concurrent LAN access to the central database server.
                  </p>
                </div>
              </div>
              <span className="shrink-0 px-2.5 py-1 rounded-md bg-indigo-600 text-white font-bold text-[11px] shadow-xs">
                Unlimited Tier
              </span>
            </div>
          )}

          <div className="pt-2">
            <TableFilterToolbar
              searchQuery={sessionSearch}
              onSearchChange={setSessionSearch}
              searchPlaceholder="Search session ID, user ID, IP address..."
              sortOrder={sessionSortOrder}
              onSortOrderChange={setSessionSortOrder}
              pageSize={sessionPageSize}
              onPageSizeChange={(newSize) => {
                setSessionPageSize(newSize);
                setSessionPageIndex(0);
              }}
              totalCount={safeSessions.length}
              filteredCount={filteredSessions.length}
              onResetFilters={handleResetSessionFilters}
            />
          </div>

          <TableScrollContainer
            maxHeight="380px"
            minHeight="200px"
            stickyHeader={true}
            title={`Active LAN Sessions (${filteredSessions.length})`}
            totalRecordsCount={filteredSessions.length}
            pagination={{
              pageIndex: sessionPageIndex,
              pageSize: sessionPageSize,
              pageSizeOptions: [20, 25, 50, 100],
              totalRecords: filteredSessions.length,
              itemCount: pagedSessions.length,
              onPageChange: setSessionPageIndex,
              onPageSizeChange: (newSize) => {
                setSessionPageSize(newSize);
                setSessionPageIndex(0);
              },
            }}
          >
            <table className="w-full text-left text-xs min-w-[540px]">
              <thead className="bg-slate-50 dark:bg-[#0F172A] text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3">Session ID</th>
                  <th className="p-3">User ID</th>
                  <th className="p-3">Client IP</th>
                  <th className="p-3">Last Active</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1E2D45]">
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      No active LAN sessions found matching the filter.
                    </td>
                  </tr>
                ) : (
                  pagedSessions.map((s, idx) => {
                    const rowId = String(s?.id || `session-${idx}`);
                    const isConfirming = confirmTerminateId === rowId;
                    return (
                      <tr key={rowId} className="hover:bg-slate-50 dark:hover:bg-[#162238]/60">
                        <td className="p-3 font-mono">{s?.id ? `${String(s.id).slice(0, 8)}...` : 'Unknown'}</td>
                        <td className="p-3 font-mono">{s?.userId || 'N/A'}</td>
                        <td className="p-3 font-mono text-teal-700 dark:text-teal-400">{s?.clientIp || '127.0.0.1'}</td>
                        <td className="p-3 text-slate-500 dark:text-slate-400">
                          {s?.lastActiveAt ? new Date(s.lastActiveAt).toLocaleTimeString() : 'Active'}
                        </td>
                        <td className="p-3 text-right">
                          {canTerminateSessions && s?.id ? (
                            isConfirming ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={terminatingId === s.id}
                                  onClick={() => executeKillSession(String(s.id))}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                                >
                                  {terminatingId === s.id ? 'Terminating...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmTerminateId(null)}
                                  className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-bold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmTerminateId(rowId)}
                                className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-700 dark:text-rose-300 rounded-lg text-[11px] font-bold cursor-pointer"
                              >
                                Force Logout
                              </button>
                            )
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">Protected</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </TableScrollContainer>
        </div>

        {/* Recent Server Errors Log */}
        <div className="bg-white dark:bg-[#11192B] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Recent Server Events</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500">{recentErrors.length}</span>
          </div>

          {recentErrors.length === 0 ? (
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-[#0F172A] border border-slate-200/80 dark:border-[#1E2D45] text-center text-xs text-slate-500 dark:text-slate-400">
              No server errors recorded since startup.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {recentErrors.slice(0, 10).map((err, idx) => (
                <div
                  key={`${err.timestamp}-${idx}`}
                  className="p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/60 text-[11px] space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-rose-800 dark:text-rose-300 font-bold">
                    <span>{err.code}</span>
                    <span>{new Date(err.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 break-words">{err.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
