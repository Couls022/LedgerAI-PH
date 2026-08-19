import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { CompanyManager } from './companyManager.js';
import { paths } from './paths.js';

export interface LaiFileInfo {
  path: string;
  name: string;
  sizeBytes: number;
  formattedSize: string;
  mtime: string;
  ageDays: number;
  category: 'DUPLICATE' | 'TEMP_CACHE' | 'OLD_STALE_BACKUP' | 'ORPHANED' | 'ACTIVE_DATABASE';
  categoryLabel: string;
  hash: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  recommendedAction: 'DELETE' | 'KEEP';
  reason: string;
  companyId?: string;
  companyName?: string;
}

export interface LaiCleanupScanResult {
  timestamp: string;
  summary: {
    totalFiles: number;
    totalSizeBytes: number;
    formattedTotalSize: string;
    cleanableFilesCount: number;
    cleanableSizeBytes: number;
    formattedCleanableSize: string;
    alertTriggered: boolean;
    alertMessage: string;
  };
  files: LaiFileInfo[];
}

export class LaiCleanupService {
  /**
   * Helper to format bytes into human readable MB/KB/GB strings
   */
  public static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Calculates fast SHA-256 hash for a file
   */
  private static async getFileHash(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Recursively finds all .lai files (including .lai.cache, .lai.tmp, .lai.bak) in a folder
   */
  private static async scanDirectoryForLaiFiles(dirPath: string, foundFiles: string[] = [], visitedDirs: Set<string> = new Set()): Promise<string[]> {
    if (!dirPath || visitedDirs.has(dirPath)) return foundFiles;
    visitedDirs.add(dirPath);

    try {
      if (!fsSync.existsSync(dirPath)) return foundFiles;
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules or system hidden dirs
          if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            await this.scanDirectoryForLaiFiles(fullPath, foundFiles, visitedDirs);
          }
        } else if (entry.isFile()) {
          const lowerName = entry.name.toLowerCase();
          if (
            lowerName.endsWith('.lai') ||
            lowerName.includes('.lai.') ||
            lowerName.endsWith('.lai.cache') ||
            lowerName.endsWith('.lai.tmp') ||
            lowerName.endsWith('.lai.bak')
          ) {
            foundFiles.push(fullPath);
          }
        }
      }
    } catch (e) {
      console.warn(`[LaiCleanupService] Unable to scan directory ${dirPath}:`, (e as Error).message);
    }

    return foundFiles;
  }

  /**
   * Conducts a full automated scan across server directories for .lai cache & duplicate files
   */
  public static async scanForLaiFiles(): Promise<LaiCleanupScanResult> {
    const scanPaths = new Set<string>();

    // 1. App data root
    const cwdData = path.resolve(paths.getDataDir());
    scanPaths.add(cwdData);

    // 2. Temp folder
    scanPaths.add(os.tmpdir());

    // 3. Registered Company Roots & Backups
    const registeredCompanies = await CompanyManager.listCompanies().catch(() => []);
    const activeDbPaths = new Set<string>();

    for (const comp of registeredCompanies) {
      if (comp.location) scanPaths.add(comp.location);
      if (comp.backupLocation) scanPaths.add(comp.backupLocation);
      if (comp.documentLocation) scanPaths.add(comp.documentLocation);
      if (comp.dbPath) {
        activeDbPaths.add(path.resolve(comp.dbPath));
        scanPaths.add(path.dirname(comp.dbPath));
      }
    }

    // Scan all target paths
    const rawFilePathsSet = new Set<string>();
    for (const p of scanPaths) {
      const files = await this.scanDirectoryForLaiFiles(p);
      files.forEach(f => rawFilePathsSet.add(path.resolve(f)));
    }

    const fileInfos: LaiFileInfo[] = [];
    const seenHashes = new Map<string, string>(); // hash -> first file path
    const now = Date.now();

    for (const filePath of rawFilePathsSet) {
      try {
        const stats = await fs.stat(filePath);
        const fileName = path.basename(filePath);
        const lowerName = fileName.toLowerCase();
        const mtimeMs = stats.mtimeMs;
        const ageDays = Math.floor((now - mtimeMs) / (1000 * 60 * 60 * 24));
        const hash = await this.getFileHash(filePath);

        // Check if active database file
        const isPrimaryDb = activeDbPaths.has(filePath) || lowerName === 'database.lai';

        let category: LaiFileInfo['category'] = 'ACTIVE_DATABASE';
        let categoryLabel = 'Active Production Database';
        let recommendedAction: LaiFileInfo['recommendedAction'] = 'KEEP';
        let reason = 'Primary active company database in use.';
        let isDuplicate = false;
        let duplicateOf: string | undefined = undefined;

        if (isPrimaryDb && !lowerName.includes('.cache') && !lowerName.includes('.tmp')) {
          category = 'ACTIVE_DATABASE';
          categoryLabel = 'Active Database';
          recommendedAction = 'KEEP';
          reason = 'Primary active company database. Protected from automatic deletion.';
        } else if (seenHashes.has(hash) && hash !== '') {
          isDuplicate = true;
          duplicateOf = seenHashes.get(hash);
          category = 'DUPLICATE';
          categoryLabel = 'Duplicate Dataset';
          recommendedAction = 'DELETE';
          reason = `Identical binary copy of ${path.basename(duplicateOf || '')}. Occupies redundant space.`;
        } else if (
          lowerName.endsWith('.cache') ||
          lowerName.endsWith('.tmp') ||
          lowerName.endsWith('.bak') ||
          lowerName.includes('.tmp.') ||
          filePath.includes(os.tmpdir())
        ) {
          category = 'TEMP_CACHE';
          categoryLabel = 'Temporary Cache/Backup';
          recommendedAction = 'DELETE';
          reason = `Temporary session cache or working backup file (${ageDays} days old). Safe to remove.`;
        } else if (ageDays >= 14 && (filePath.includes('/backups/') || filePath.includes('/exports/') || lowerName.includes('snapshot'))) {
          category = 'OLD_STALE_BACKUP';
          categoryLabel = 'Old Stale Backup File';
          recommendedAction = 'DELETE';
          reason = `Old snapshot/export created ${ageDays} days ago. Newer backups exist.`;
        } else {
          // Check if file is in an unregistered or orphaned company folder
          const hasCompanyContext = registeredCompanies.some(c => filePath.includes(c.id) || (c.location && filePath.includes(c.location)));
          if (!hasCompanyContext && filePath.includes('companies')) {
            category = 'ORPHANED';
            categoryLabel = 'Orphaned Workspace Dataset';
            recommendedAction = 'DELETE';
            reason = 'Associated with an unlinked or deleted company workspace profile.';
          }
        }

        // Record first seen hash for primary non-temp files
        if (hash && !isDuplicate) {
          seenHashes.set(hash, filePath);
        }

        fileInfos.push({
          path: filePath,
          name: fileName,
          sizeBytes: stats.size,
          formattedSize: this.formatBytes(stats.size),
          mtime: new Date(stats.mtime).toISOString(),
          ageDays,
          category,
          categoryLabel,
          hash,
          isDuplicate,
          duplicateOf,
          recommendedAction,
          reason
        });
      } catch (err) {
        console.warn(`[LaiCleanupService] Failed to inspect ${filePath}:`, (err as Error).message);
      }
    }

    // Sort files: Cleanable ones first, then by size descending
    fileInfos.sort((a, b) => {
      if (a.recommendedAction === 'DELETE' && b.recommendedAction !== 'DELETE') return -1;
      if (a.recommendedAction !== 'DELETE' && b.recommendedAction === 'DELETE') return 1;
      return b.sizeBytes - a.sizeBytes;
    });

    const totalFiles = fileInfos.length;
    const totalSizeBytes = fileInfos.reduce((sum, f) => sum + f.sizeBytes, 0);

    const cleanableFiles = fileInfos.filter(f => f.recommendedAction === 'DELETE');
    const cleanableFilesCount = cleanableFiles.length;
    const cleanableSizeBytes = cleanableFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

    const alertTriggered = cleanableSizeBytes >= 2 * 1024 * 1024 || cleanableFilesCount >= 2;
    let alertMessage = '';

    if (alertTriggered) {
      alertMessage = `Found ${cleanableFilesCount} redundant, duplicate, or stale .lai database file(s) occupying ${this.formatBytes(cleanableSizeBytes)}. Clean up to optimize server disk space.`;
    } else {
      alertMessage = 'No significant unused or duplicate .lai cache files detected. Server storage is optimal.';
    }

    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalFiles,
        totalSizeBytes,
        formattedTotalSize: this.formatBytes(totalSizeBytes),
        cleanableFilesCount,
        cleanableSizeBytes,
        formattedCleanableSize: this.formatBytes(cleanableSizeBytes),
        alertTriggered,
        alertMessage
      },
      files: fileInfos
    };
  }

  /**
   * Safely deletes specified .lai files from server storage
   */
  public static async deleteLaiFiles(filePaths: string[], forceDeletePrimary: boolean = false): Promise<{
    success: boolean;
    deletedCount: number;
    freedBytes: number;
    formattedFreedSize: string;
    errors: string[];
  }> {
    let deletedCount = 0;
    let freedBytes = 0;
    const errors: string[] = [];

    // Reload active database paths to protect active database files
    const registeredCompanies = await CompanyManager.listCompanies().catch(() => []);
    const activeDbPaths = new Set<string>();
    for (const comp of registeredCompanies) {
      if (comp.dbPath) activeDbPaths.add(path.resolve(comp.dbPath));
    }

    for (const targetPath of filePaths) {
      const resolved = path.resolve(targetPath);
      const fileName = path.basename(resolved).toLowerCase();

      // Guard: File must end in .lai or contain .lai.
      if (!fileName.endsWith('.lai') && !fileName.includes('.lai.')) {
        errors.push(`Refused deletion of non-.lai file: ${targetPath}`);
        continue;
      }

      // Guard: Protect active primary company database files unless force flag is explicitly true
      if (activeDbPaths.has(resolved) && !forceDeletePrimary) {
        errors.push(`Refused deletion of active production company database: ${path.basename(resolved)}`);
        continue;
      }

      try {
        if (fsSync.existsSync(resolved)) {
          const stats = await fs.stat(resolved);
          await fs.unlink(resolved);
          deletedCount++;
          freedBytes += stats.size;
        }
      } catch (err) {
        errors.push(`Failed to delete ${path.basename(resolved)}: ${(err as Error).message}`);
      }
    }

    return {
      success: errors.length === 0,
      deletedCount,
      freedBytes,
      formattedFreedSize: this.formatBytes(freedBytes),
      errors
    };
  }
}
