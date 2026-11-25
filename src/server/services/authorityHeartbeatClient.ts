import { CompanyManager } from './companyManager';
import { paths } from './paths';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { broadcastAuthorityEvent } from '../ws';
import crypto from 'crypto';

export class AuthorityHeartbeatClient {
  private static timer: NodeJS.Timeout | null = null;
  private static authorityUrl: string = process.env.AUTHORITY_SERVER_URL || 'http://127.0.0.1:4000';

  public static setAuthorityUrl(url: string) {
    this.authorityUrl = url.replace(/\/+$/, '');
  }

  public static getAuthorityUrl(): string {
    return this.authorityUrl;
  }

  public static startHeartbeatLoop(intervalMs: number = 60000): void {
    if (this.timer) return;
    
    // Initial ping after 5 seconds of startup
    setTimeout(() => {
      this.pingAll().catch(() => {});
    }, 5000);

    this.timer = setInterval(() => {
      this.pingAll().catch(() => {});
    }, intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public static stopHeartbeatLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public static async pingCompany(companyId: string): Promise<{ success: boolean; error?: string; status?: string }> {
    try {
      const companyDb = await CompanyManager.getCompanyDb(companyId).catch(() => null);
      if (!companyDb) return { success: false, error: 'Database unavailable' };

      let license: any = null;
      try {
        license = companyDb.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyId)).get();
      } catch {}
      if (!license || !license.licenseKey) {
        return { success: false, error: 'No license registered' };
      }

      const companyMeta = await CompanyManager.getCompanyManifest(companyId).catch(() => null);
      const companyName = companyMeta?.legalName || 'Client Company';

      const installationId = paths.getMachineInstallationId();
      const deviceFingerprint = paths.getDeviceFingerprint();

      const payload = {
        companyId,
        licenseKey: license.licenseKey,
        installationId,
        deviceFingerprint,
        companyName,
        clientVersion: '1.0.0'
      };

      const url = `${this.authorityUrl}/authority/heartbeat`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 409) {
          // DUPLICATE INSTALLATION DETECTED!
          const errorData: any = await response.json().catch(() => ({}));
          console.warn(`[AuthorityHeartbeat] Duplicate installation detected for company ${companyId}. Locking license.`);
          
          await companyDb.update(schema.companyLicenses).set({
            status: 'TAMPERED',
            updatedAt: new Date()
          }).where(eq(schema.companyLicenses.companyId, companyId)).catch(() => {});

          await companyDb.insert(schema.licenseAuditLogs).values({
            id: crypto.randomUUID(),
            companyId,
            action: 'SUSPENDED_DUPLICATE_INSTALLATION',
            details: `Authority Server rejected heartbeat: License already claimed by another server (${errorData.error || 'Duplicate installation'})`
          }).catch(() => {});

          broadcastAuthorityEvent({
            type: 'LICENSE_TAMPERED',
            action: 'DUPLICATE_INSTALLATION',
            companyId,
            error: errorData.error
          });

          return { success: false, error: errorData.error || 'Duplicate installation detected.' };
        }

        if (response.ok) {
          const data: any = await response.json();
          if (data.status === 'REVOKED' && license.status !== 'REVOKED') {
            await companyDb.update(schema.companyLicenses).set({
              status: 'REVOKED',
              updatedAt: new Date()
            }).where(eq(schema.companyLicenses.companyId, companyId)).catch(() => {});

            broadcastAuthorityEvent({
              type: 'LICENSE_REVOKED',
              action: 'REVOKED',
              companyId
            });
          }
          return { success: true, status: data.status };
        }
      } catch (networkErr: any) {
        clearTimeout(timeoutId);
        // Completely offline-safe: If authority server cannot be reached, the system continues running offline seamlessly!
        return { success: true, status: 'OFFLINE_RUNNING' };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public static async pingAll(): Promise<void> {
    try {
      const companies = await CompanyManager.listCompanies().catch(() => []);
      for (const comp of companies) {
        await this.pingCompany(comp.id).catch(() => {});
      }
    } catch {
      // Non-fatal
    }
  }
}
