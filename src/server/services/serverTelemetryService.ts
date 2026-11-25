import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { paths } from './paths';
import { CompanyManager } from './companyManager';
import { getWsConnectionStats } from '../ws';
import { inspectLanNetworkInterfaces } from '../routes/licensingAndLan';
import { db } from '../db';
import * as schema from '../db/schema';
import { dbContext } from '../db/context';
import { gt } from 'drizzle-orm';

export type ServerDeploymentMode = 'SERVER' | 'SINGLE_PC' | 'SERVER_AND_DESKTOP';

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
  deploymentMode: ServerDeploymentMode;
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
  lanInterfaces: ReturnType<typeof inspectLanNetworkInterfaces>['lanIps'];
  excludedInterfaces: ReturnType<typeof inspectLanNetworkInterfaces>['excludedInterfaces'];
  dnsRecordGuide: ReturnType<typeof inspectLanNetworkInterfaces>['dnsRecordGuide'];
  clientSetupCommand: string | null;
  recentServerErrors: ServerErrorLogEntry[];
  topology: ReturnType<typeof CompanyManager.getDeploymentTopologyInfo>;
  timestamp: string;
}

const MAX_ERROR_BUFFER = 25;

async function computeDirectoryBytesSafe(targetDir: string, maxFiles = 2000): Promise<number> {
  let total = 0;
  let visited = 0;

  async function walk(dir: string) {
    if (visited >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= maxFiles) return;
      visited++;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          total += stat.size;
        } catch {
          // Ignore transient vanished file
        }
      }
    }
  }

  await walk(targetDir);
  return total;
}

class ServerTelemetryManager {
  private readonly startedAt = new Date();
  private listeningPort: number = Number(process.env.PORT) || 3000;
  private bindHost: string = process.env.HOST || '0.0.0.0';
  private recentErrors: ServerErrorLogEntry[] = [];

  setListeningInfo(port: number, host: string) {
    this.listeningPort = port;
    this.bindHost = host;
  }

  getDeploymentMode(): ServerDeploymentMode {
    const raw = (process.env.LEDGERAI_DEPLOYMENT_MODE || '').trim().toUpperCase();
    if (raw === 'SERVER') return 'SERVER';
    if (raw === 'SINGLE_PC' || raw === 'STANDALONE') return 'SINGLE_PC';
    return 'SERVER_AND_DESKTOP';
  }

  getConfiguredLanHostname(): string {
    return (process.env.LEDGERAI_LAN_HOSTNAME || 'ledgerai.local').trim().toLowerCase();
  }

  getAlternateLanHostname(): string {
    const primary = this.getConfiguredLanHostname();
    return primary === 'ledgerai-server.local' ? 'ledgerai.local' : 'ledgerai-server.local';
  }

  getUptimeSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000));
  }

  getStartedAt(): string {
    return this.startedAt.toISOString();
  }

  recordError(entry: Omit<ServerErrorLogEntry, 'timestamp'>) {
    // Strip any potential bearer tokens or passwords from error messages
    const safeMessage = String(entry.message || 'Server error')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .slice(0, 240);

    this.recentErrors.unshift({
      timestamp: new Date().toISOString(),
      code: entry.code || 'INTERNAL_ERROR',
      message: safeMessage,
      path: entry.path,
      method: entry.method,
      statusCode: entry.statusCode,
    });

    if (this.recentErrors.length > MAX_ERROR_BUFFER) {
      this.recentErrors.length = MAX_ERROR_BUFFER;
    }
  }

  getRecentErrors(): ServerErrorLogEntry[] {
    return [...this.recentErrors];
  }

  async getServerDashboardSnapshot(): Promise<ServerDashboardSnapshot> {
    const lanInfo = inspectLanNetworkInterfaces(os.networkInterfaces(), this.listeningPort);
    const configuredLanHostname = this.getConfiguredLanHostname();
    const alternateLanHostname = this.getAlternateLanHostname();
    const wsStats = getWsConnectionStats();
    const poolMetrics = CompanyManager.getPoolMetrics();

    const companiesList = await CompanyManager.listCompanies({ includeSynthetic: false }).catch(() => []);
    let databaseStorageBytes = 0;
    let documentStorageBytes = 0;
    let backupCount = 0;
    let latestBackupMtime = 0;
    let activeAuthenticatedSessions = 0;

    const now = new Date();

    for (const comp of companiesList) {
      const compDir = comp.location || (comp.dbPath ? path.dirname(comp.dbPath) : null);
      if (compDir && fsSync.existsSync(compDir)) {
        // Measure DB files in company root (.lai, .sqlite, -wal, -shm)
        try {
          const rootEntries = await fs.readdir(compDir, { withFileTypes: true });
          for (const e of rootEntries) {
            if (e.isFile() && /\.(lai|sqlite|sqlite-wal|sqlite-shm)$/i.test(e.name)) {
              const st = await fs.stat(path.join(compDir, e.name)).catch(() => null);
              if (st) databaseStorageBytes += st.size;
            }
          }
        } catch {}

        // Measure document storage
        const docDir = comp.documentLocation || path.join(compDir, 'documents');
        if (fsSync.existsSync(docDir)) {
          documentStorageBytes += await computeDirectoryBytesSafe(docDir, 1000);
        }

        // Inspect backups
        const backupDir = comp.backupLocation || path.join(compDir, 'backups');
        if (fsSync.existsSync(backupDir)) {
          try {
            const bFiles = await fs.readdir(backupDir, { withFileTypes: true });
            for (const bf of bFiles) {
              if (bf.isFile() && /\.(lai|lgb|zip)$/i.test(bf.name)) {
                backupCount++;
                const st = await fs.stat(path.join(backupDir, bf.name)).catch(() => null);
                if (st && st.mtimeMs > latestBackupMtime) {
                  latestBackupMtime = st.mtimeMs;
                }
              }
            }
          } catch {}
        }
      }

      // Count active unexpired sessions in currently open company DBs (non-intrusive)
      if (poolMetrics.openCompanyIds.includes(comp.id)) {
        try {
          const compDb = await CompanyManager.getCompanyDb(comp.id);
          await dbContext.run(compDb, async () => {
            const liveSessions = await db
              .select({ id: schema.sessions.id })
              .from(schema.sessions)
              .where(gt(schema.sessions.expiresAt, now));
            activeAuthenticatedSessions += liveSessions.length;
          });
        } catch {}
      }
    }

    let availableDiskBytes: number | null = null;
    let totalDiskBytes: number | null = null;
    try {
      const companiesRoot = paths.getCompaniesRootDir();
      const statfs = await fs.statfs(companiesRoot);
      availableDiskBytes = Number(statfs.bavail) * Number(statfs.bsize);
      totalDiskBytes = Number(statfs.blocks) * Number(statfs.bsize);
    } catch {}

    const portSuffix = lanInfo.port80ProxyActive ? '' : `:${this.listeningPort}`;
    const primaryLanUrl = lanInfo.usableLanAvailable ? `http://${configuredLanHostname}${portSuffix}` : null;
    const alternateLanUrl = lanInfo.usableLanAvailable ? `http://${alternateLanHostname}${portSuffix}` : null;
    const directIpUrl = lanInfo.primaryIp ? `http://${lanInfo.primaryIp}:${this.listeningPort}` : null;

    const recentErrorsCountLast10Min = this.recentErrors.filter(
      (e) => Date.now() - new Date(e.timestamp).getTime() < 10 * 60 * 1000 && (e.statusCode || 500) >= 500
    ).length;

    const lowDisk = availableDiskBytes !== null && availableDiskBytes < 250 * 1024 * 1024;
    const serverHealth: 'HEALTHY' | 'DEGRADED' = lowDisk || recentErrorsCountLast10Min >= 10 ? 'DEGRADED' : 'HEALTHY';

    const backupStatus: ServerDashboardSnapshot['backupStatus'] =
      companiesList.length === 0
        ? 'NO_BACKUPS_YET'
        : backupCount > 0
        ? 'HEALTHY'
        : 'ATTENTION_REQUIRED';

    return {
      serverStatus: serverHealth === 'HEALTHY' ? 'ONLINE' : 'DEGRADED',
      deploymentMode: this.getDeploymentMode(),
      startedAt: this.getStartedAt(),
      uptimeSeconds: this.getUptimeSeconds(),
      serverHostname: lanInfo.hostname,
      localIpAddress: lanInfo.primaryIp,
      effectiveBindAddress: this.bindHost === '0.0.0.0' ? lanInfo.effectiveBindAddress : this.bindHost,
      configuredLanHostname,
      alternateLanHostname,
      listeningPort: lanInfo.port,
      internalPort: this.listeningPort,
      port80ProxyActive: lanInfo.port80ProxyActive,
      accessUrls: {
        primaryLanUrl,
        alternateLanUrl,
        directIpUrl,
        localUrl: `http://127.0.0.1:${this.listeningPort}`,
      },
      activeClientConnections: wsStats.authenticatedClients,
      activeAuthenticatedSessions,
      registeredCompanyCount: companiesList.length,
      openDatabaseCount: poolMetrics.openCompanyCount,
      databaseStorageBytes,
      documentStorageBytes,
      availableDiskBytes,
      totalDiskBytes,
      backupStatus,
      lastSuccessfulBackupAt: latestBackupMtime > 0 ? new Date(latestBackupMtime).toISOString() : null,
      backupCount,
      serverHealth,
      networkConnectivity: lanInfo.networkDiagnosticStatus as ServerDashboardSnapshot['networkConnectivity'],
      networkDiagnosticMessage: lanInfo.networkDiagnosticMessage,
      lanInterfaces: lanInfo.lanIps,
      excludedInterfaces: lanInfo.excludedInterfaces,
      dnsRecordGuide: lanInfo.primaryIp
        ? {
            host: configuredLanHostname,
            type: 'A',
            value: lanInfo.primaryIp,
          }
        : null,
      clientSetupCommand: lanInfo.primaryIp
        ? `.\\configure-lan-client.ps1 -ServerIp ${lanInfo.primaryIp} -Hostname ${configuredLanHostname}`
        : null,
      recentServerErrors: this.getRecentErrors(),
      topology: CompanyManager.getDeploymentTopologyInfo(),
      timestamp: new Date().toISOString(),
    };
  }
}

export const ServerTelemetryService = new ServerTelemetryManager();
