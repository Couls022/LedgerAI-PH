# LedgerAI PH — Centralized Database Architecture

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/services/companyManager.ts`, `src/server/services/serverInstanceLock.ts`, `src/server/middleware/companyContext.ts`, `src/server/db/context.ts`

---

## 1. Storage Layout on Central Server (PC 1)

All company databases, document vaults, and encrypted backups live exclusively on the central server's local filesystem (`LEDGERAI_DATA_DIR`, default `C:\ProgramData\LedgerAI\data` in Server Mode):

```text
<LEDGERAI_DATA_DIR>/
├── companies.json                 # Central company registry (server-managed only)
├── ledgerai-server.lock           # Atomic PID single-instance server lock
└── companies/
    ├── <company-a-id>/
    │   ├── database.lai           # Isolated SQLite / SQLCipher WAL database
    │   ├── database.lai-wal
    │   ├── database.lai-shm
    │   ├── documents/             # Isolated supporting documents & receipts
    │   └── backups/               # Isolated encrypted .lai backup archives
    └── <company-b-id>/
        ├── database.lai
        ├── documents/
        └── backups/
```

## 2. Database-Per-Company Isolation

- Every company has its own isolated SQLite/SQLCipher database file.
- Every incoming authenticated API request is routed through `companyContextMiddleware` (`src/server/middleware/companyContext.ts`) using Node `AsyncLocalStorage` (`dbContext`), binding all Drizzle ORM queries strictly to the active session's company database.
- No SQLite file is ever shared over SMB/UNC. Client PCs hold zero database files.

## 3. Multi-Company Concurrency & Pool Management

- **Non-Destructive Multi-Company Pool:** `CompanyManager.closeOtherCompanyDbs(keepId, { force: false })` NEVER closes another company's active SQLite handle if it has in-flight requests (`inFlightRequests > 0`) or was accessed within the idle threshold (5 minutes). This guarantees User A working on Company A and User B working on Company B operate simultaneously without closing each other's handles.
- **Per-Company Write Serialization (`withCompanyWriteLock`):** Concurrent write transactions targeting the same company are serialized per `companyId` with automatic `SQLITE_BUSY` / `SQLITE_LOCKED` exponential backoff retries, while writes to different companies proceed in full parallel.
- **WAL & Busy Timeout:** Every company DB connection opens with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, and busy timeout configured for concurrent readers + serialized writers.
- **Single-Instance Server Lock:** `ServerInstanceLock` atomically acquires `<configDir>/ledgerai-server.lock` using `O_CREAT | O_EXCL` (`wx`) and recovers stale locks if the recorded PID is no longer alive, preventing accidental multi-process DB corruption (Topology C).
