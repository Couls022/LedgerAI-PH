# LedgerAI PH — Windows Server & Client Installer Requirements

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `packaging/windows/service-config/install-ledgerai-service.ps1`, `packaging/windows/service-config/configure-ledgerai-domain.ps1`, `packaging/windows/service-config/configure-lan-client.ps1`, `electron-builder.yml`  
**Verification Classification:** `IMPLEMENTED BUT NOT RUNTIME VERIFIED` / `BLOCKED BY EXECUTION ENVIRONMENT` (Windows host/CI required to run NSIS/EXE build and test Windows Service Controller).

---

## 1. Supported Installation Modes

| Mode | Target Machine | Background Service | Bind Host | Firewall Profile | Local Databases |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Mode A — Server** (`-InstallMode Server`) | Dedicated Office Server PC (PC 1) | `LedgerAIServerService` (Auto-start + Auto-restart) | `0.0.0.0` | Domain & Private ONLY (Public blocked) | Central `C:\ProgramData\LedgerAI\data` |
| **Mode B — Server + Desktop** (`-InstallMode ServerAndDesktop`) | Main Accounting PC acting as Central Server (PC 1) | `LedgerAIServerService` (Auto-start + Auto-restart) | `0.0.0.0` | Domain & Private ONLY (Public blocked) | Central `C:\ProgramData\LedgerAI\data` |
| **Mode C — Single-PC Standalone** (`-InstallMode SinglePC`) | Solo Accountant / Laptop | Local-only service or Electron process | `127.0.0.1` | None (No inbound LAN ports opened) | Local user-selected directory |
| **Mode D — Client Workstation Access** (`configure-lan-client.ps1`) | Staff PCs (PC 2 .. PC N) | None | N/A (Browser only) | None | **NONE** (Zero local DB files) |

## 2. Windows Service Reliability & Recovery

- Registered via NSSM or `sc.exe create` with `start= auto` so the central server starts on Windows boot before any user logs in.
- Automatic crash recovery configured via:
  ```powershell
  sc.exe failure LedgerAIServerService reset= 86400 actions= restart/5000/restart/15000/restart/60000
  sc.exe failureflag LedgerAIServerService 1
  ```
- Log rotation enabled under `C:\ProgramData\LedgerAI\logs\`.
- Single-instance lock (`ledgerai-server.lock`) prevents simultaneous desktop + service instances from corrupting SQLite files.

## 3. Native Windows Release Gate (Deferred to Windows Build Host)

Before shipping commercial `.exe` installers, execute on a Windows 10/11 build machine:
1. Build Electron + NSIS package (`npm run electron:build`).
2. Test fresh install in Mode A, Mode B, Mode C, and Mode D.
3. Verify reboot persistence of `LedgerAIServerService` prior to Windows login.
4. Verify Windows Defender Firewall blocks Public profile ingress while allowing Private/Domain LAN clients.
