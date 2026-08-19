import path from "path";
import os from "os";
import fs from "fs";

/**
 * Centrally manages runtime directories for LedgerAI PH.
 * Ensures user/company data is strictly separated from application binaries (Program Files)
 * and safely written to user-accessible locations (AppData / Documents / Custom Paths).
 */
class PathService {
  private configDir: string;
  private dataDir: string;
  private isWindows: boolean;

  constructor() {
    this.isWindows = os.platform() === "win32";

    // 1. Determine safe, writable base configuration directory
    if (process.env.LEDGERAI_CONFIG_DIR) {
      this.configDir = path.resolve(process.env.LEDGERAI_CONFIG_DIR);
    } else if (this.isWindows && process.env.APPDATA) {
      // Windows standard per-user application data
      this.configDir = path.join(process.env.APPDATA, "LedgerAI_Data");
    } else if (process.env.HOME) {
      this.configDir = path.join(process.env.HOME, ".ledgerai_data");
    } else {
      const installRoot = process.env.APP_PATH ? path.resolve(process.env.APP_PATH) : path.resolve(process.cwd());
      this.configDir = path.join(installRoot, "data");
    }

    // 2. Determine safe, writable default company data directory
    if (process.env.LEDGERAI_DATA_DIR) {
      this.dataDir = path.resolve(process.env.LEDGERAI_DATA_DIR);
    } else if (this.isWindows && process.env.USERPROFILE) {
      // Prefer User's Documents/LedgerAI Companies for clear visibility and backup
      const userDocs = path.join(process.env.USERPROFILE, "Documents", "LedgerAI Companies");
      this.dataDir = userDocs;
    } else if (this.isWindows && process.env.APPDATA) {
      this.dataDir = path.join(process.env.APPDATA, "LedgerAI_Data", "companies");
    } else if (process.env.HOME) {
      this.dataDir = path.join(process.env.HOME, "Documents", "LedgerAI Companies");
    } else {
      const installRoot = process.env.APP_PATH ? path.resolve(process.env.APP_PATH) : path.resolve(process.cwd());
      this.dataDir = path.join(installRoot, "data", "companies");
    }

    // Ensure base directories exist safely
    this.ensureDirSync(this.configDir);
    this.ensureDirSync(this.dataDir);
  }

  getDataDir(): string {
    if (process.env.LEDGERAI_DATA_DIR) {
      return path.resolve(process.env.LEDGERAI_DATA_DIR);
    }
    return this.dataDir;
  }

  getConfigDir(): string {
    if (process.env.LEDGERAI_CONFIG_DIR) {
      return path.resolve(process.env.LEDGERAI_CONFIG_DIR);
    }
    return this.configDir;
  }

  getCompaniesRootDir(): string {
    const dir = this.getDataDir();
    this.ensureDirSync(dir);
    return dir;
  }

  /**
   * Returns safe, recommended storage presets for Windows and local environments
   */
  getAvailableActiveDrives(): Array<{ label: string; path: string; isDefault?: boolean }> {
    const defaultCompaniesRoot = this.getCompaniesRootDir().replace(/\\/g, '/');
    const presets: Array<{ label: string; path: string; isDefault?: boolean }> = [
      {
        label: "User Documents LedgerAI Storage (Recommended)",
        path: defaultCompaniesRoot,
        isDefault: true
      }
    ];

    if (this.isWindows) {
      if (process.env.APPDATA) {
        presets.push({
          label: "Windows User AppData (Protected)",
          path: path.join(process.env.APPDATA, "LedgerAI_Data", "companies").replace(/\\/g, '/')
        });
      }
      presets.push(
        { label: "Dedicated Secondary Volume (D:)", path: "D:/LedgerAI Companies" },
        { label: "Primary Windows Root (C:)", path: "C:/LedgerAI Companies" }
      );
    } else {
      presets.push(
        { label: "App Local Directory", path: defaultCompaniesRoot }
      );
    }

    return presets;
  }

  getRegistryFilePath(): string {
    // Registry is config-level metadata stored in protected user config folder
    return path.join(this.getConfigDir(), "registry.json");
  }

  getCompanyDir(companyId: string): string {
    const dir = path.join(this.getCompaniesRootDir(), companyId);
    this.ensureDirSync(dir);
    return dir;
  }

  getCompanyDatabasePath(companyId: string): string {
    const companyDir = this.getCompanyDir(companyId);
    const laiPath = path.join(companyDir, "database.lai");
    if (fs.existsSync(laiPath)) return laiPath;
    return path.join(companyDir, "database.sqlite");
  }

  getCompanyBackupDir(companyId: string): string {
    const dir = path.join(this.getCompanyDir(companyId), "backups");
    this.ensureDirSync(dir);
    return dir;
  }

  getCompanyDocumentDir(companyId: string): string {
    const dir = path.join(this.getCompanyDir(companyId), "documents");
    this.ensureDirSync(dir);
    return dir;
  }

  getLogsDir(): string {
    const dir = path.join(this.configDir, "logs");
    this.ensureDirSync(dir);
    return dir;
  }

  getTempDir(): string {
    const dir = path.join(this.getConfigDir(), "temp");
    this.ensureDirSync(dir);
    return dir;
  }

  getTimeStateFilePath(companyId?: string): string {
    if (companyId) {
      return path.join(this.getCompanyDir(companyId), ".time_state.bin");
    }
    return path.join(this.getConfigDir(), ".time_state.bin");
  }

  private ensureDirSync(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (err) {
      console.error(`Error ensuring directory exists at ${dirPath}`, err);
    }
  }
}

export const paths = new PathService();
