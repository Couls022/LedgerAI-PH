import { dbContext } from "../db/context";
import * as schema from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { RestoreService } from "./restoreService";
import { OperationalLogger } from "./operationalLogger";
import { CompanyManager } from "./companyManager";

export class AutomatedBackupScheduler {
  private static timerHandle: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static isAutoBackupEnabled = true;
  private static inFlightCompanyChecks = new Set<string>();

  /**
   * Check if automated backups are enabled by default on this server installation
   */
  public static isEnabled(): boolean {
    return this.isAutoBackupEnabled;
  }

  /**
   * Enable or disable automated backup scheduler
   */
  public static setEnabled(enabled: boolean): void {
    this.isAutoBackupEnabled = enabled;
  }

  private static isConcurrencyLockError(err: any): boolean {
    const msg = String(err?.message || err || "");
    return msg.includes("CONCURRENCY_LOCK") || msg.includes("CONCURRENT_SERVER_LOCK_CONFLICT");
  }

  /**
   * Runs an immediate backup check for a specific company or all active companies.
   * Creates an automated encrypted baseline snapshot if no backups exist or if last backup > 24 hours ago.
   */
  public static async runBackupCheckForCompany(companyId: string): Promise<boolean> {
    if (!this.isAutoBackupEnabled) return false;
    if (this.inFlightCompanyChecks.has(companyId)) return false;

    if (
      RestoreService.isBackupLocked(companyId) ||
      (companyId === "LGR-PH-2026-STRESS-DG-PREVIEW" && CompanyManager.isStressPreviewSeedingInProgress())
    ) {
      OperationalLogger.info("AutomatedBackupScheduler", {
        message: "Skipped backup check because another backup or seeding operation is already in progress",
        companyId
      });
      return false;
    }

    this.inFlightCompanyChecks.add(companyId);

    try {
      const companyDb = await CompanyManager.getCompanyDb(companyId);
      if (!companyDb) return false;

      return await dbContext.run(companyDb as any, async () => {
        // Find latest backup for company
        const latestBackup = await companyDb
          .select()
          .from(schema.systemBackups)
          .where(eq(schema.systemBackups.companyId, companyId))
          .orderBy(desc(schema.systemBackups.createdAt))
          .limit(1)
          .get();

        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;

        let needsBackup = false;
        if (!latestBackup) {
          needsBackup = true;
        } else {
          const lastCreatedTime = new Date(latestBackup.createdAt).getTime();
          if (now - lastCreatedTime > twentyFourHours) {
            needsBackup = true;
          }
        }

        if (needsBackup) {
          if (RestoreService.isBackupLocked(companyId)) {
            OperationalLogger.info("AutomatedBackupScheduler", {
              message: "Skipped backup creation due to active backup lock",
              companyId
            });
            return false;
          }

          const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
          const backupName = `AUTO-SYSTEM-DAILY-${timestampStr}`;

          OperationalLogger.info("AutomatedBackupScheduler", {
            message: "Triggering automated background snapshot",
            companyId,
            backupName
          });

          await RestoreService.createAtomicBackup(companyId, "SYSTEM", backupName);
          return true;
        }

        return false;
      });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      if (this.isConcurrencyLockError(err)) {
        OperationalLogger.info("AutomatedBackupScheduler", {
          message: "Skipped backup check due to active lock contention",
          companyId,
          reason: err?.message
        });
        return false;
      }
      if (
        msg.includes("COMPANY_LOCATION_MISSING") ||
        msg.includes("ENOENT") ||
        msg.includes("not accessible") ||
        msg.includes("CORRUPT_DATABASE_QUARANTINED") ||
        msg.includes("QUARANTINED") ||
        msg.includes("RECOVERY_READ_ONLY")
      ) {
        OperationalLogger.info("AutomatedBackupScheduler", {
          message: "Skipped backup check because company workspace is missing, quarantined, or in recovery mode",
          companyId,
          reason: msg
        });
        return false;
      }
      OperationalLogger.error("AutomatedBackupScheduler Error", err, { companyId });
      return false;
    } finally {
      this.inFlightCompanyChecks.delete(companyId);
    }
  }

  /**
   * Iterate active non-synthetic companies and verify/create backup snapshots
   */
  public static async runAllCompaniesCheck(): Promise<void> {
    if (this.isRunning || !this.isAutoBackupEnabled) return;
    this.isRunning = true;

    try {
      const companies = await CompanyManager.listCompanies({ includeSynthetic: false });

      for (const comp of companies) {
        // Skip frozen reference test companies so their static SHA-256 fixtures remain untouched
        if (
          comp.id === "LGR-PH-2026-TEST-00-ABC12345" ||
          comp.id === "LGR-PH-DESKGUARD-SOLUTIONS" ||
          comp.id.includes("OP-AUDIT") ||
          comp.id.includes("PILOT") ||
          comp.id.includes("DEFECT") ||
          comp.id.includes("LGR-LAN-SEC-") ||
          comp.id.includes("LGR-PH-STRESS-") ||
          comp.status === "RECOVERY_READ_ONLY" ||
          (comp.location?.includes("deskguard_solutions") && !comp.location?.includes("stress_preview"))
        ) {
          continue;
        }
        await this.runBackupCheckForCompany(comp.id);
      }
    } catch (err: any) {
      OperationalLogger.error("AutomatedBackupScheduler Sweep Error", err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the background automated backup scheduler daemon
   */
  public static startScheduler(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.timerHandle) return;

    OperationalLogger.info("AutomatedBackupScheduler", {
      message: "Starting server-side automated backup scheduler daemon",
      intervalHours: intervalMs / (1000 * 60 * 60)
    });

    // Run initial sweep after startup delay (10s)
    const initTimeout = setTimeout(() => {
      this.runAllCompaniesCheck().catch((err) =>
        OperationalLogger.error("AutomatedBackupScheduler initial run failed", err)
      );
    }, 10000);
    if (typeof initTimeout.unref === "function") {
      initTimeout.unref();
    }

    // Schedule recurring daily check
    this.timerHandle = setInterval(() => {
      this.runAllCompaniesCheck().catch((err) =>
        OperationalLogger.error("AutomatedBackupScheduler interval run failed", err)
      );
    }, intervalMs);
    if (typeof this.timerHandle.unref === "function") {
      this.timerHandle.unref();
    }
  }

  /**
   * Stop the background scheduler (useful for tests/graceful shutdown)
   */
  public static stopScheduler(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /**
   * Get server backup status for a company
   */
  public static async getCompanyBackupStatus(companyId: string) {
    try {
      const companyDb = await CompanyManager.getCompanyDb(companyId);
      if (!companyDb) {
        return {
          enabled: this.isAutoBackupEnabled,
          mode: "AUTOMATIC_SCHEDULED",
          totalBackups: 0,
          lastBackupTime: null,
          lastBackupName: null,
          isOverdue: true,
          status: "UNAVAILABLE",
          message: "Company database is unavailable; no verified backup snapshots could be queried."
        };
      }

      return await dbContext.run(companyDb as any, async () => {
        const backups = await companyDb
          .select({
            id: schema.systemBackups.id,
            createdAt: schema.systemBackups.createdAt,
            backupName: schema.systemBackups.backupName
          })
          .from(schema.systemBackups)
          .where(eq(schema.systemBackups.companyId, companyId))
          .orderBy(desc(schema.systemBackups.createdAt));

        const latest = backups[0] || null;
        const latestTimeMs = latest?.createdAt ? new Date(latest.createdAt).getTime() : 0;
        const isOverdue = !latest || !Number.isFinite(latestTimeMs) || (Date.now() - latestTimeMs > 24 * 60 * 60 * 1000);

        return {
          enabled: this.isAutoBackupEnabled,
          mode: "AUTOMATIC_SCHEDULED",
          totalBackups: backups.length,
          lastBackupTime: latest ? latest.createdAt : null,
          lastBackupName: latest ? latest.backupName : null,
          isOverdue,
          status: latest ? (isOverdue ? "OVERDUE" : "CURRENT") : "NO_BACKUPS",
          message: latest
            ? (isOverdue
                ? "Last automated backup snapshot is more than 24 hours old; a fresh backup is recommended."
                : "Automated server-side database snapshots are active and up to date.")
            : "No backup snapshots recorded yet for this company."
        };
      });
    } catch (err: any) {
      return {
        enabled: this.isAutoBackupEnabled,
        mode: "AUTOMATIC_SCHEDULED",
        totalBackups: 0,
        lastBackupTime: null,
        lastBackupName: null,
        isOverdue: true,
        status: "ERROR",
        message: `Unable to verify backup status: ${err?.message || "database query failed"}`
      };
    }
  }
}
