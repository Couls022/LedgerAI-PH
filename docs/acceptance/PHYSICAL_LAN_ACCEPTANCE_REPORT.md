# LEDGERAI PH — PHYSICAL LAN ACCEPTANCE REPORT (PHASE 2)

**Document ID:** `ACC-PH2-PHYSICAL-LAN`  
**Release Baseline:** `LedgerAI PH v1.0.0-rc.2`  
**Audit / Evaluation Date:** `2026-11-20`  
**Target Physical Topology:**
- **PC 1:** LedgerAI PH Central Server (Windows 10/11, Ethernet/Static LAN IP)
- **PC 2:** Browser Client Workstation (Ethernet, Edge/Chrome)
- **Laptop 1:** Browser Client Workstation (Office Wi-Fi, Chrome/Edge)
- **Laptop 2:** Browser Client Workstation (Office Wi-Fi, Firefox/Chrome)

**Current Execution Environment:** Linux x64 Cloud Container (No Physical Office Wi-Fi/Ethernet LAN)  
**Overall Phase 2 Verdict:** **`BLOCKED — PENDING PHYSICAL MULTI-PC OFFICE LAN VALIDATION`** *(LAN interface filtering, firewall script policies, outage banner hooks, and cookie/CORS logic verified in automated tests; physical Wi-Fi/Ethernet connectivity, mDNS/DNS resolution, Windows Firewall live blocking, and multi-PC simultaneous browser testing MUST NOT be marked verified without physical LAN execution.)*

---

## 1. Critical Pre-Deployment Architectural Finding on mDNS (`.local`)

During live codebase audit (`grep` across `server.ts`, `src/server/`, and `package.json` on `2026-11-20`):
- **Finding `GAP-LAN-01`:** LedgerAI PH does **not** currently embed an active UDP 5353 mDNS/Bonjour broadcast responder (`bonjour-service` / `multicast-dns`) inside `server.ts`.
- **Practical Operational Consequence on Physical Office LANs:**
  - Windows native mDNS (`dnscache`) only resolves `<WINDOWS-COMPUTER-NAME>.local` — it will **not** automatically broadcast custom aliases `ledgerai.local` and `ledgerai-server.local` unless:
    1. **Option 1 (Recommended Enterprise Standard):** Office router / local DNS server defines A-records mapping `ledgerai.local` and `ledgerai-server.local` to PC 1's static LAN IPv4 address (zero client workstation configuration), **OR**
    2. **Option 2 (Zero-Router-Admin Fallback):** Administrator runs `configure-lan-client.ps1 -ServerIp <PC1_LAN_IP>` on PC 2, Laptop 1, and Laptop 2 to populate `drivers\etc\hosts` and create Desktop shortcuts, **OR**
    3. **Option 3 (Future Code Enhancement):** Add an optional mDNS/Bonjour advertiser to `server.ts` after physical office router multicast testing.
- **Remediation Applied in This Turn:** Updated `configure-ledgerai-domain.ps1` to explicitly warn operators of this mDNS requirement, check for existing TCP Port 80 conflicts (e.g. IIS/W3SVC), align Direct IP Fallback URL output with the active firewall rule, and restore 100% pass rate on `tests/licensing/lanResolution.test.ts` (**14/14 PASS**).

---

## 2. Phase 2 Acceptance Test Matrix

| Test ID | Environment | Procedure | Expected Result | Actual Result | Evidence | Pass / Fail / Blocked | Corrective Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **LAN-01** | Physical LAN: PC 2 (Ethernet) + Laptop 1 & 2 (Wi-Fi) -> PC 1 | Open `http://<PC1_LAN_IP>` (Port 80 proxy mode) or `http://<PC1_LAN_IP>:3000` (direct port mode) from PC 2, Laptop 1, and Laptop 2. | All 3 client browsers load LedgerAI PH launcher/login cleanly; `GET /api/health` returns `200 OK`; `GET /api/companies/storage-environment` returns `403 SERVER_FILESYSTEM_PROTECTED`. | **Code/Security Logic Verified in Linux** (`lan-dashboard-security-review.test.ts` PASS, `SEC-01` PASS); physical Ethernet/Wi-Fi LAN execution not run in Linux. | `tests/security/lan-dashboard-security-review.test.ts` (PASS); `clientServerArchitecture.test.ts` (`SEC-01` PASS); `verify-windows-acceptance.ps1` checks `LAN-CLI-01`, `LAN-CLI-04`. | **BLOCKED** | Run `verify-windows-acceptance.ps1 -Role Client -ServerIp <PC1_IP>` on PC 2, Laptop 1, and Laptop 2 over both Ethernet and Wi-Fi. |
| **LAN-02** | Physical LAN: PC 2, Laptop 1, Laptop 2 | Resolve `ledgerai.local` (`Resolve-DnsName ledgerai.local`) and open `http://ledgerai.local` in Chrome/Edge on all 3 client computers. | `ledgerai.local` resolves to PC 1's RFC 1918 LAN IPv4 (never `127.0.0.1`); full app loads and authenticates cleanly with `httpOnly` session cookie. | **NOT TESTED ON PHYSICAL LAN.** Code audit confirmed no embedded mDNS responder (`GAP-LAN-01`); relies on Router DNS A-record or `configure-lan-client.ps1` hosts mapping. | `configure-ledgerai-domain.ps1`, `configure-lan-client.ps1`, `lanResolution.test.ts` (14/14 PASS for script/policy logic). | **BLOCKED** | Configure Router DNS A-record (`ledgerai.local -> <PC1_IP>`) or run `configure-lan-client.ps1` on clients, then verify live via `LAN-CLI-02`. |
| **LAN-03** | Physical LAN: PC 2, Laptop 1, Laptop 2 | Resolve `ledgerai-server.local` (`Resolve-DnsName ledgerai-server.local`) and open `http://ledgerai-server.local` in browser. | `ledgerai-server.local` resolves to PC 1's LAN IPv4 and reaches `/api/health` (`200 OK`) and login screen identically. | **NOT TESTED ON PHYSICAL LAN.** | `configure-ledgerai-domain.ps1` lines 17 & 59; `configure-lan-client.ps1` lines 21 & 84; `verify-windows-acceptance.ps1` check `LAN-CLI-03`. | **BLOCKED** | Add Router DNS A-record or run `configure-lan-client.ps1` and verify live on all 3 client devices via `LAN-CLI-03`. |
| **LAN-04** | Physical Windows Firewall on PC 1 + External/Public Profile Test | Inspect `Get-NetFirewallRule -DisplayName "LedgerAI PH*"`; temporarily switch PC 1 network profile to **Public** and test ingress from PC 2; verify TCP 3000 is blocked when Port 80 proxy is active. | Only `Domain,Private` profiles allow inbound TCP 80 (or configured port); `Public` profile strictly blocks ingress; direct TCP 3000 is blocked when Port 80 proxy is active. | Script rules verified (`lanResolution.test.ts` Tests 11 & 12 PASS); live Windows Defender Firewall packet filtering not tested in Linux. | `install-ledgerai-service.ps1` lines 118–132; `tests/licensing/lanResolution.test.ts` (14/14 PASS); `verify-windows-acceptance.ps1` check `WIN-SRV-06`. | **BLOCKED** | Execute live Windows Firewall Private vs Public ingress test between PC 1 and PC 2; capture `Get-NetFirewallRule` & blocked `Test-NetConnection` output. |
| **LAN-05** | Physical LAN: PC 2 (Ethernet) + Laptop 1 & 2 (Wi-Fi) | Open authenticated sessions on PC 2, Laptop 1, and Laptop 2 simultaneously; verify navigation, live API queries, WebSocket/polling updates, and zero cross-session bleed. | All 3 browser workstations operate smoothly over Ethernet & Wi-Fi with independent session cookies and zero `401`/CORS/cookie rejections. | Multi-session concurrent HTTP auth verified on loopback in Linux (`INT-01` PASS); physical Wi-Fi/Ethernet latency and multi-device browsers not tested. | `clientServerArchitecture.test.ts` (`INT-01` PASS); `src/server/routes/auth.ts` (`sameSite: 'lax'`, `httpOnly: true`). | **BLOCKED** | Execute simultaneous 4-device office LAN test (PC 1 + PC 2 + Laptop 1 + Laptop 2) and record HAR/network logs. |
| **LAN-06** | Physical LAN: PC 1 Server Stop + PC 2 / Laptop 1 Active Browsers | While PC 2 and Laptop 1 have active screens open, execute `Stop-Service LedgerAIServerService` on PC 1 (or unplug PC 1 Ethernet). | Client browsers display `ServerConnectionBanner` outage alert immediately via `ledgerai:server-unavailable`; no silent fallback to local/stale data; saved company preference remains preserved. | Preference preservation on network error & HTTP 503 verified in unit tests (`PREF-01` PASS); live physical network disconnect not tested. | `clientServerArchitecture.test.ts` (`PREF-01` PASS); `src/client/utils/apiClient.ts` & `ServerConnectionBanner.tsx`. | **BLOCKED** | Perform live server stop / Ethernet unplug test with PC 2 & Laptop 1 and capture screenshot of outage banner. |
| **LAN-07** | Physical LAN: PC 1 Server Restart + PC 2 / Laptop 1 Recovery | Restart `LedgerAIServerService` on PC 1 (or reconnect Ethernet) while outage banner is visible on PC 2 and Laptop 1; wait up to 10 seconds without manual page reload. | `ServerConnectionBanner` auto-polls `GET /api/health` every 6s, clears outage banner automatically upon `200 OK`, and clients resume normal operation cleanly. | Logic implemented in `ServerConnectionBanner.tsx`; physical network recovery timing not executed on physical LAN. | `docs/client-server/LAN_NETWORK_ACCESS_CONFIGURATION.md` Section 4. | **BLOCKED** | Capture timestamped reconnection test video/screenshots on PC 2 and Laptop 1. |
| **LAN-08** | Physical LAN: 4 Simultaneous Browser Sessions Across Different Companies | Connect PC 1 (Edge), PC 2 (Chrome), Laptop 1 (Edge), Laptop 2 (Firefox) simultaneously across 2+ companies and execute concurrent reads/writes. | All 4 independent browser sessions stay authenticated, isolated by company context, with zero session collisions or `SQLITE_BUSY` failures. | Multi-session & cross-company isolation verified in Linux (`INT-01` + `lan_concurrency.test.ts` 14/14 PASS); physical 4-machine LAN test pending. | `tests/integration/lan_concurrency.test.ts` (14/14 PASS); `clientServerArchitecture.test.ts` (`INT-01` PASS). | **BLOCKED** | Run concurrent 4-device physical LAN test during Phase 4 execution and archive server telemetry snapshot. |

---

## 3. Open Phase 2 Blockers & Recommendations

- **Blocker `BLK-LAN-01` (Environment):** Physical 4-device office LAN testing (PC 1 + PC 2 + Laptop 1 + Laptop 2 over Ethernet & Wi-Fi) is mandatory before clearing Phase 2.
- **Architectural Advisory `GAP-LAN-01` (mDNS):** Do not assume `ledgerai.local` or `ledgerai-server.local` will auto-resolve over raw mDNS without either Router DNS A-records, client `configure-lan-client.ps1` execution, or adding a native UDP 5353 mDNS responder module to `server.ts`.
- **Phase 2 Certification Status:** **NOT PASSED (BLOCKED)**.
