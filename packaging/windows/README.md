# LedgerAI PH — Windows Packaging, LAN Resolution & Background Service Architecture

This directory contains configuration templates, automation scripts, and installation specifications designed to package LedgerAI PH into a standalone Windows Server Unit installation and facilitate multi-workstation LAN access.

---

## 1. LAN Hostname Resolution Architecture (`http://ledgerai.ph`)

The application is accessed across the local network via `http://ledgerai.ph` without requiring users to specify port `:3000` or memorize internal IP addresses.

### A. Server Unit Local Access
* **Hosts File (`C:\Windows\System32\drivers\etc\hosts`)**:
  ```text
  127.0.0.1    ledgerai.ph
  ```
* **Local Portproxy Forwarding**:
  `netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1`
* **Behavior**: When the browser on the Server Unit navigates to `http://ledgerai.ph`, it resolves to `127.0.0.1:80`, which is forwarded internally to `127.0.0.1:3000`.

### B. LAN Client Workstation Access
Client workstations (e.g. `192.168.1.20`, `192.168.1.30`) must resolve `ledgerai.ph` to the **Server Unit's LAN IP** (e.g. `192.168.1.10`), **NEVER** `127.0.0.1`.

Two deployment methods are supported:

#### Option A: Enterprise Router / LAN DNS (Recommended — Zero Client Setup)
* **Configuration**: Add a local DNS A-Record in the company router/gateway (e.g., pfSense, Pi-hole, Windows Server DNS, Mikrotik, OpenWrt):
  ```text
  Host: ledgerai.ph
  Type: A
  Target IP: <Server-Unit-LAN-IP> (e.g. 192.168.1.10)
  ```
* **Client Experience**: Any device on the LAN opens `http://ledgerai.ph` immediately with **zero** software installation or configuration.

#### Option B: Workstation Setup Script (`configure-lan-client.ps1`)
* For environments without managed router DNS, run this script once on each client PC as Administrator:
  ```powershell
  .\configure-lan-client.ps1 -ServerIp 192.168.1.10
  ```
* **What it does**:
  1. Tests network connectivity to the Server Unit on Port 80 / 3000.
  2. Adds `<ServerIp> ledgerai.ph` to the client's `C:\Windows\System32\drivers\etc\hosts`.
  3. Flushes the local DNS resolver cache (`ipconfig /flushdns`).
  4. Creates a desktop shortcut pointing to `http://ledgerai.ph`.

---

## 2. Port Forwarding & Routing Engine

* **Internal Application Binding**: The Express server binds internally to `127.0.0.1:3000` (loopback only).
* **Port 80 Forwarding (`netsh interface portproxy`)**:
  ```powershell
  # Forwards incoming LAN client traffic on port 80 to internal port 3000
  netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=3000 connectaddress=127.0.0.1

  # Forwards local Server Unit loopback traffic on port 80 to internal port 3000
  netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1
  ```
* **Result**: All HTTP requests to `http://ledgerai.ph` (default port 80) seamlessly arrive at the Express application. No `:3000` is required or exposed.

---

## 3. Windows Defender Firewall Security & Network Hardening

Inbound firewall rules are strictly hardened:
* **TCP Port 80 (LedgerAI HTTP Proxy)**: Inbound Allow (Domain & Private profiles only).
* **TCP Port 3000 (Internal Node Engine)**: **BLOCKED / NOT EXPOSED** to LAN. All inbound rules for Port 3000 are deleted, and the engine binds strictly to internal loopback `127.0.0.1:3000`.
* **Public Profile**: Blocked by default to prevent exposure on untrusted public Wi-Fi networks.

---

## 4. Windows Background Service (`LedgerAIServerService`)

* **Service Type**: Automatic system service (`SERVICE_AUTO_START`), started during Windows boot before user login.
* **Lifecycle Decoupling**: Runs headlessly in the background. Closing the web browser on the Server Unit or any client workstation does **NOT** terminate or interrupt the background service.
* **Reboot Persistence**: Automatically restarts and rebinds ports on server reboot.
* **Database Concurrency**: The SQLite engine is hosted exclusively on the Server Unit with WAL mode and serialized transactions for multi-user safety.

---

## 5. Domain Safety & Public DNS Isolation

* **Strict Local Scoping**: All resolution changes are confined to local LAN router DNS or local `hosts` entries.
* **Zero Public Hijacking**: Global Internet DNS records, authoritative nameservers, and external ISP DNS resolvers are untouched.
* **Traffic Isolation**: Users outside the customer's private LAN will resolve public records normally (or NXDOMAIN if unconfigured globally) and cannot route to the customer's internal server.

---

## 6. Directory Layout

* `/packaging/windows/`
  * `README.md` - Complete LAN resolution, service, and security architecture.
  * `build-windows.ps1` - PowerShell build and bundling automation script.
  * `service-config/`
    * `install-ledgerai-service.ps1` - Windows Background Service registration & firewall setup.
    * `uninstall-ledgerai-service.ps1` - Service teardown (preserves SQLite business database).
    * `configure-ledgerai-domain.ps1` - Server Unit local resolution & portproxy configuration.
    * `configure-lan-client.ps1` - Client workstation setup script with dynamic Server IP mapping.
    * `create-desktop-shortcut.ps1` - Creates `http://ledgerai.ph` desktop shortcut.
  * `installer-config/`
    * `installer-specification.iss` - Inno Setup specification for future installer generation.
