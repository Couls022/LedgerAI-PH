# LedgerAI PH — Backup & Disaster Recovery Plan (Client-Server)

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/services/backupService.ts`, `src/server/services/serverTelemetryService.ts`, `src/client/pages/RestoreProfile.tsx`, `src/client/components/lan/LanServerDashboard.tsx`

---

## 1. Centralized Backup Strategy

Because all company databases and supporting documents reside on the Central Server (PC 1), backup administration is centralized and deterministic:

- **Encrypted Archive Format (`.lai`):** Each company backup package includes the point-in-time SQLite database snapshot, supporting documents, SHA-256 integrity manifest, and encryption envelope.
- **Live Telemetry Monitoring:** `ServerTelemetryService.getServerDashboardSnapshot()` continuously inspects every registered company's backup directory and surfaces `backupStatus` (`HEALTHY`, `ATTENTION_REQUIRED`, `NO_BACKUPS_YET`), `backupCount`, and `lastSuccessfulBackupAt` on the Server Management Dashboard.
- **Recommended 3-2-1 Office Retention Policy:**
  1. Automated daily local backups inside PC 1's backup directory.
  2. Scheduled copy of encrypted `.lai` archives to an external USB drive or secondary NAS/cloud vault (never share live `.sqlite`/`.lai` active database folders over SMB).
  3. Monthly restore drill verifying decryption, integrity hash, and post-restore credential authentication.

## 2. Enterprise Restore Workflow (Zero Silent Auto-Login)

1. On a replacement server PC (or existing PC 1), open **Restore from Backup** (`#/profile/restore`).
2. Upload or select the encrypted `.lai` backup archive.
3. LedgerAI PH validates archive structure, cryptographic checksums, and company metadata atomically with rollback protection.
4. Once extracted and registered into the central server registry, LedgerAI PH routes strictly to `/login/:companyId` — requiring valid company user credentials before granting access to financial records.
5. Client workstations on the office LAN automatically reconnect to the restored server once `http://ledgerai.local` is online; their per-browser-profile saved company preferences remain preserved throughout outage and recovery.
