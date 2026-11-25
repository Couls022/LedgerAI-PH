# LedgerAI PH — LAN Network Access Configuration

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/routes/licensingAndLan.ts`, `src/server/services/serverTelemetryService.ts`, `src/client/components/lan/LanServerDashboard.tsx`, `packaging/windows/service-config/configure-ledgerai-domain.ps1`, `packaging/windows/service-config/configure-lan-client.ps1`

---

## 1. Supported Client Access URLs

| Priority | Access URL | Resolution Mechanism | Target Use Case |
| :--- | :--- | :--- | :--- |
| **Primary** | `http://ledgerai.local` (or `:3000` if port 80 proxy disabled) | Office Router DNS A-Record / mDNS / Client hosts fallback | Standard friendly URL for all office workstations |
| **Alternate** | `http://ledgerai-server.local` | Office Router DNS / mDNS / Client hosts fallback | Environments where `ledgerai.local` is already reserved |
| **Direct Fallback** | `http://<PRIVATE_LAN_IP>:3000` (e.g., `http://192.168.1.10:3000`) | Direct RFC 1918 IPv4 | Immediate access without DNS/hosts configuration |
| **Server Local Loopback** | `http://127.0.0.1:3000` | Local loopback | Direct access on PC 1 or Single-PC Standalone mode |

## 2. Network Interface Classification Policy

`inspectLanNetworkInterfaces()` (`src/server/routes/licensingAndLan.ts`) strictly filters network interfaces:
- **Advertised:** Verified RFC 1918 Private LAN IPv4 addresses only (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- **Excluded:** Loopback (`127.0.0.0/8`), APIPA link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), and Public IPv4 interfaces are explicitly excluded from LAN advertisement and shown transparently under `excludedInterfaces` diagnostics.

## 3. Firewall & Session Cookie Behavior Over Office LAN

- **Firewall Policy:** PowerShell installer scripts exclusively open inbound TCP 80 (or TCP 3000) on Windows `Domain` and `Private` profiles. The `Public` network profile is never opened.
- **Session Cookies on HTTP LAN:** `src/server/routes/auth.ts` sets `secure: process.env.NODE_ENV === 'production' && req.secure` with `httpOnly: true` and `sameSite: 'lax'`, allowing secure cookie sessions to function cleanly across both `http://ledgerai.local` on internal office LANs and HTTPS reverse proxies.

## 4. Network Resilience Behavior

- `src/client/utils/apiClient.ts` dispatches `ledgerai:server-unavailable` on network failure or HTTP 502/503/504 and `ledgerai:server-available` upon recovery.
- `ServerConnectionBanner.tsx` displays an immediate enterprise outage banner across all routes, auto-polls `GET /api/health` every 6 seconds, provides a manual `Retry Connection` button, and NEVER falls back to an alternate or stale local database.
