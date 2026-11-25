# LedgerAI PH — Multi-User Concurrency Test Matrix

**Document Status:** Authoritative Baseline (November 2026)  
**Automated Test Suite:** `src/server/services/clientServerArchitecture.test.ts`

---

| Test Case ID | Scenario | Expected Outcome | Execution Method | Status |
| :--- | :--- | :--- | :--- | :--- |
| **CONC-01** | Single-instance server lock prevents duplicate central server process on same data directory | Second `acquire()` throws `SERVER_INSTANCE_LOCKED`; stale dead PID lock is recovered automatically | `node:test` (`clientServerArchitecture.test.ts`) | IMPLEMENTED AND VERIFIED |
| **CONC-02** | Multi-company concurrent DB pool (User A in Company A, User B in Company B simultaneously) | Opening Company B does NOT close Company A's active SQLite handle; `closeOtherCompanyDbs({ force: false })` preserves active/recent companies | `node:test` (`clientServerArchitecture.test.ts`) | IMPLEMENTED AND VERIFIED |
| **CONC-03** | Per-company write serialization lock (`withCompanyWriteLock`) under parallel writes | Writes to same company execute atomically in FIFO order with `SQLITE_BUSY` retry; writes to different companies run concurrently | `node:test` (`clientServerArchitecture.test.ts`) | IMPLEMENTED AND VERIFIED |
| **CONC-04** | User A switches from Company A to Company B while User C stays signed in to Company A | User A receives fresh Company B session; User C's Company A session & DB handle remain completely uninterrupted | `node:test` (`clientServerArchitecture.test.ts`) | IMPLEMENTED AND VERIFIED |
| **CONC-05** | Unauthorized user attempts `POST /api/auth/switch-company` to Company B | Returns HTTP `403 UNAUTHORIZED_COMPANY_ACCESS`; User's Company A session remains valid | `node:test` (`clientServerArchitecture.test.ts`) | IMPLEMENTED AND VERIFIED |
| **CONC-06** | Independent browser profiles selecting different companies | Browser Profile 1 persists Company A while Browser Profile 2 persists Company B independently via `CompanyPreferenceService` | `node:test` + Chromium Playwright verification | IMPLEMENTED AND VERIFIED |
| **CONC-07** | Multi-PC physical Windows LAN stress test (PC 1 Windows Service + PC 2..PC 5 Edge/Chrome clients) | Full LAN multi-workstation concurrency over `http://ledgerai.local` | Native Windows LAN lab | BLOCKED BY EXECUTION ENVIRONMENT |
