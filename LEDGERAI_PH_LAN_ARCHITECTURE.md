# LedgerAI PH - LAN Architecture

## 1. Overview
LedgerAI PH is designed to be installed on a single host machine (the Server) and accessed by multiple clients across the Local Area Network (LAN) via a standard web browser.

## 2. Network Binding
- **Host Binding**: The Node.js Express server is configured to bind to `0.0.0.0` (all IPv4 interfaces) rather than just `127.0.0.1` (localhost). This allows incoming connections from other devices on the same subnet.
- **Port Allocation**: Runs on a designated port (e.g., `3000`).

## 3. Client Access
Users on the network access the system by navigating to the host's IP address (e.g., `http://192.168.1.50:3000`). No client-side installation is required other than a modern web browser.

## 4. Concurrency and Sessions
- The SQLite database handles concurrent reads and serializes writes automatically.
- Session management (via JWTs or HTTP-only cookies) identifies individual users regardless of the physical machine they are connecting from.

## 5. Security Considerations
- As the system transmits financial data over LAN, running behind a reverse proxy (like Nginx or Caddy) with local TLS certificates (HTTPS) is highly recommended for production setups to prevent packet sniffing on the local network.
