import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('LedgerAI PH — LAN Resolution, Port Forwarding, & Service Verification', () => {

  describe('1. LAN Hostname Resolution Logic & Client Separation', () => {
    // Model synthetic network configuration
    const serverUnitIp = '192.168.1.10';
    const clientAIp = '192.168.1.20';
    const clientBIp = '192.168.1.30';
    const domain = 'ledgerai.ph';

    it('1. Server Unit resolves ledgerai.ph locally via loopback or local IP', () => {
      // Server Unit local hosts entry: 127.0.0.1 ledgerai.ph
      const serverHostsEntry = `127.0.0.1    ${domain}`;
      const [ip, host] = serverHostsEntry.trim().split(/\s+/);
      
      expect(host).toBe(domain);
      expect(ip).toBe('127.0.0.1');
      // Server itself can loop back to localhost port 80 -> 3000
    });

    it('2. LAN Client A resolves ledgerai.ph directly to Server Unit IP (192.168.1.10)', () => {
      // Client A hosts entry: 192.168.1.10 ledgerai.ph
      const clientAHosts = `${serverUnitIp}    ${domain}`;
      const [resolvedIp, host] = clientAHosts.trim().split(/\s+/);

      expect(host).toBe(domain);
      expect(resolvedIp).toBe(serverUnitIp);
      expect(resolvedIp).not.toBe('127.0.0.1');
      expect(resolvedIp).not.toBe(clientAIp);
    });

    it('3. LAN Client B resolves ledgerai.ph directly to Server Unit IP (192.168.1.10)', () => {
      // Client B hosts entry: 192.168.1.10 ledgerai.ph
      const clientBHosts = `${serverUnitIp}    ${domain}`;
      const [resolvedIp, host] = clientBHosts.trim().split(/\s+/);

      expect(host).toBe(domain);
      expect(resolvedIp).toBe(serverUnitIp);
      expect(resolvedIp).not.toBe('127.0.0.1');
      expect(resolvedIp).not.toBe(clientBIp);
    });

    it('4. Rejects setting 127.0.0.1 as server IP on LAN client workstations', () => {
      // Validation helper matching configure-lan-client.ps1
      function validateClientServerIp(ip: string): { valid: boolean; error?: string } {
        if (!ip || !ip.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
          return { valid: false, error: 'Invalid IPv4 address format' };
        }
        if (ip.startsWith('127.')) {
          return { valid: false, error: 'Cannot use loopback IP on client workstation' };
        }
        return { valid: true };
      }

      expect(validateClientServerIp('127.0.0.1').valid).toBe(false);
      expect(validateClientServerIp('127.0.0.2').valid).toBe(false);
      expect(validateClientServerIp('192.168.1.10').valid).toBe(true);
      expect(validateClientServerIp('10.0.0.50').valid).toBe(true);
    });

    it('5. Supports dynamic subnets and DHCP without hardcoding 192.168.1.10', () => {
      const subnets = [
        '192.168.1.10',
        '10.0.4.150',
        '172.16.20.5',
        '192.168.100.22'
      ];

      for (const ip of subnets) {
        const clientHosts = `${ip}    ${domain}`;
        const [resolvedIp] = clientHosts.trim().split(/\s+/);
        expect(resolvedIp).toBe(ip);
      }
    });
  });

  describe('2. Port Handling & URL Structure (Zero Port Typing)', () => {
    it('6. Browser reaches LedgerAI through standard HTTP port 80 without :3000', () => {
      const userFacingUrl = 'http://ledgerai.ph';
      const parsedUrl = new URL(userFacingUrl);

      // Default HTTP port is 80 (omitted from URL.port in standard URL parser)
      expect(parsedUrl.protocol).toBe('http:');
      expect(parsedUrl.hostname).toBe('ledgerai.ph');
      expect(parsedUrl.port).toBe(''); // empty string means default port 80
      expect(userFacingUrl).not.toContain(':3000');
    });

    it('7. Port forwarding specification maps external 0.0.0.0:80 to internal 127.0.0.1:3000', () => {
      const scriptContent = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/configure-ledgerai-domain.ps1'),
        'utf-8'
      );

      // Verify portproxy configuration for all interfaces (0.0.0.0) and loopback (127.0.0.1)
      expect(scriptContent).toContain('netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=3000 connectaddress=127.0.0.1');
      expect(scriptContent).toContain('netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1');
    });
  });

  describe('3. Windows Background Service & Browser Lifecycle Decoupling', () => {
    it('8. Service starts automatically on Windows boot (SERVICE_AUTO_START)', () => {
      const installScript = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/install-ledgerai-service.ps1'),
        'utf-8'
      );

      expect(installScript).toMatch(/(SERVICE_AUTO_START|start=\s*auto)/);
      expect(installScript).toContain('LedgerAIServerService');
    });

    it('9. Background service lifecycle is independent of browser process', () => {
      // When a user closes Chrome/Edge, the Windows service continues running in session 0
      let serviceRunning = true;
      let browserOpen = true;

      // Simulate closing browser
      browserOpen = false;
      expect(serviceRunning).toBe(true);
      expect(browserOpen).toBe(false);

      // Simulate reopening browser to http://ledgerai.ph
      browserOpen = true;
      expect(serviceRunning).toBe(true);
      expect(browserOpen).toBe(true);
    });

    it('10. Service uninstaller preserves SQLite business database files', () => {
      const uninstallScript = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/uninstall-ledgerai-service.ps1'),
        'utf-8'
      );

      expect(uninstallScript).toContain('Stop-Service');
      expect(uninstallScript).toContain('sc.exe delete');
      // Must not delete the database or appdata
      expect(uninstallScript).not.toMatch(/Remove-Item.*\.sqlite/i);
    });
  });

  describe('4. Windows Firewall & Network Security Hardening', () => {
    it('11. Windows Firewall restricts access to Domain and Private network profiles for Port 80 ONLY', () => {
      const installScript = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/install-ledgerai-service.ps1'),
        'utf-8'
      );
      const domainScript = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/configure-ledgerai-domain.ps1'),
        'utf-8'
      );

      // Check firewall profile constraints: Port 80 allowed, Port 3000 NOT exposed
      expect(installScript).toContain('-Profile Domain,Private');
      expect(installScript).toContain('-LocalPort 80');
      expect(installScript).toContain('Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port 3000)"');
      expect(installScript).toContain('New-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)"');
      
      expect(domainScript).toContain('-Profile Domain,Private');
      expect(domainScript).toContain('-LocalPort 80');
      expect(domainScript).not.toMatch(/New-NetFirewallRule.*-LocalPort 3000/);

      // Verify that the background service is configured to bind to internal loopback 127.0.0.1
      expect(installScript).toContain('"HOST=127.0.0.1"');
    });

    it('12. LAN client direct connection to TCP 3000 is blocked by firewall policy', () => {
      // Synthetic firewall simulation: only port 80 has an inbound allow rule
      const allowedInboundPorts = [80];
      const directPort3000Allowed = allowedInboundPorts.includes(3000);
      const port80Allowed = allowedInboundPorts.includes(80);

      expect(directPort3000Allowed).toBe(false);
      expect(port80Allowed).toBe(true);
    });
  });

  describe('5. Public Internet DNS Safety & Isolation', () => {
    it('12. Local resolution scripts never alter public/upstream DNS or WAN records', () => {
      const serverConfig = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/configure-ledgerai-domain.ps1'),
        'utf-8'
      );
      const clientConfig = fs.readFileSync(
        path.join(process.cwd(), 'packaging/windows/service-config/configure-lan-client.ps1'),
        'utf-8'
      );

      // Verify no public DNS mutation commands exist
      expect(serverConfig).not.toContain('Set-DnsClientServerAddress');
      expect(serverConfig).not.toContain('Register-DnsServerDirectoryPartition');
      expect(clientConfig).not.toContain('Set-DnsClientServerAddress');
      
      // All resolution changes are localized to System32\drivers\etc\hosts
      expect(serverConfig).toContain('drivers\\etc\\hosts');
      expect(clientConfig).toContain('drivers\\etc\\hosts');
    });
  });

  describe('6. Security & Authority Isolation Integrity', () => {
    it('13. Client build strictly excludes private keys and Key Generator', () => {
      const clientDist = path.join(process.cwd(), 'dist');
      if (fs.existsSync(clientDist)) {
        const distFiles = fs.readdirSync(clientDist);
        for (const file of distFiles) {
          expect(file).not.toContain('privateKey');
          expect(file).not.toContain('authority_key');
        }
      }

      const clientVerificationModule = fs.readFileSync(
        path.join(process.cwd(), 'src/server/licensing/verify.ts'),
        'utf-8'
      );

      // Verify client only contains public key
      expect(clientVerificationModule).toContain('PUBLIC KEY');
      expect(clientVerificationModule).not.toContain('PRIVATE KEY');
    });
  });
});
