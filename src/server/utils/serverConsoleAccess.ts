import type { Request } from 'express';

export interface ServerConsoleAccessInput {
  remoteAddress?: string | null;
  hostHeader?: string | null;
  forwardedFor?: string | null;
  forwardedHeader?: string | null;
  hostedPreviewAllowed?: boolean;
  isCloudRunRuntime?: boolean;
}

const PRIVATE_LAN_IPV4_PATTERNS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
];

function stripIpv6Prefix(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '').toLowerCase();
}

export function isLoopbackIp(ip?: string | null): boolean {
  if (!ip) return false;
  const cleaned = stripIpv6Prefix(ip);
  return cleaned === '127.0.0.1' || cleaned === '::1' || cleaned === 'localhost';
}

export function isPrivateLanIp(ip?: string | null): boolean {
  if (!ip) return false;
  const cleaned = stripIpv6Prefix(ip);
  if (PRIVATE_LAN_IPV4_PATTERNS.some((re) => re.test(cleaned))) {
    return true;
  }
  // IPv6 ULA (fc00::/7) and link-local (fe80::/10)
  if (/^(fc|fd|fe[89ab])[0-9a-f]*:/i.test(cleaned)) {
    return true;
  }
  return false;
}

function extractHostWithoutPort(rawHost?: string | null): string {
  const hostHeader = String(rawHost || '').trim().toLowerCase();
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) {
    const closeIdx = hostHeader.indexOf(']');
    return closeIdx >= 0 ? hostHeader.slice(0, closeIdx + 1) : hostHeader;
  }
  return hostHeader.split(':')[0];
}

function isLoopbackHost(hostWithoutPort: string): boolean {
  return (
    hostWithoutPort === '' ||
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '[::1]' ||
    hostWithoutPort === '::1'
  );
}

/**
 * Matches hosted single-tenant Cloud Run preview URLs (e.g. Google AI Studio preview)
 * so the owner inspecting the preview can exercise the live PC Server Console end-to-end
 * while strict RFC-1918 LAN clients remain blocked as BROWSER_CLIENT.
 */
export function isCloudRunPreviewHost(hostWithoutPort: string): boolean {
  if (!hostWithoutPort) return false;
  return (
    /^ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/i.test(hostWithoutPort) ||
    /^[a-z0-9-]+\.a\.run\.app$/i.test(hostWithoutPort) ||
    /^[a-z0-9-]+\.run\.app$/i.test(hostWithoutPort)
  );
}

function parseForwardedIps(forwardedFor?: string | null, forwardedHeader?: string | null): string[] {
  const ips: string[] = [];
  if (forwardedFor && forwardedFor.trim()) {
    for (const part of forwardedFor.split(',')) {
      const token = part.trim();
      if (token) ips.push(token);
    }
  }
  if (forwardedHeader && forwardedHeader.trim()) {
    const matches = forwardedHeader.matchAll(/for=([^;,\s]+)/gi);
    for (const match of matches) {
      const cleaned = match[1].replace(/^"?\[?/, '').replace(/\]?"?$/, '').split(':')[0];
      if (cleaned) ips.push(cleaned);
    }
  }
  return ips;
}

/**
 * Determines whether an incoming HTTP request originates from the authoritative
 * PC Server Console (local loopback / desktop host, or hosted Cloud Run single-tenant preview)
 * versus a remote LAN Browser Client.
 *
 * Security invariants:
 * 1. Originating private LAN client IP (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) in
 *    `X-Forwarded-For[0]` is ALWAYS FALSE (strictly enforced as BROWSER_CLIENT).
 * 2. Direct loopback (`127.0.0.1` / `::1` / `localhost`) with no forwarding headers -> TRUE.
 * 3. Hosted Cloud Run preview ingress (`*.run.app` OR Cloud Run `K_SERVICE` runtime where
 *    Envoy/GFE connects from internal proxy IP `169.254.x.x`/`10.x.x.x` forwarding a
 *    non-private public client IP) -> TRUE so the hosted server console is live end-to-end.
 * 4. On-premise non-Cloud-Run servers: any private LAN socket IP or non-loopback host -> FALSE.
 */
export function evaluateServerConsoleAccess(input: ServerConsoleAccessInput): boolean {
  const remote = stripIpv6Prefix(input.remoteAddress || '');
  const hostWithoutPort = extractHostWithoutPort(input.hostHeader);
  const forwardedIps = parseForwardedIps(input.forwardedFor, input.forwardedHeader);
  const hasForwarding = forwardedIps.length > 0;
  const originatingClientIp = forwardedIps[0] || '';

  const allowHostedPreview = input.hostedPreviewAllowed !== false;
  const isCloudRunHost = isCloudRunPreviewHost(hostWithoutPort);
  const isCloudRunEnv = Boolean(input.isCloudRunRuntime);

  // Explicit office LAN client ranges (192.168.x.x / 172.16-31.x.x) are ALWAYS treated as remote Browser Clients.
  if (
    originatingClientIp &&
    (/^192\.168\./.test(stripIpv6Prefix(originatingClientIp)) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(stripIpv6Prefix(originatingClientIp)))
  ) {
    return false;
  }

  // Case 1: Hosted Cloud Run preview ingress (ais-dev-*.run.app / ais-pre-*.run.app / *.run.app).
  // Google Frontend / Envoy sidecar connects from GCP internal IPs (169.254.x.x / 10.x.x.x) and may
  // forward internal proxy hops in X-Forwarded-For.
  if (allowHostedPreview && isCloudRunHost) {
    return true;
  }
  if (allowHostedPreview && isCloudRunEnv && isLoopbackHost(hostWithoutPort)) {
    // Inside Cloud Run container with proxy-rewritten loopback host: allow unless originating IP is RFC-1918 LAN.
    if (originatingClientIp && /^10\./.test(stripIpv6Prefix(originatingClientIp)) && isLoopbackIp(remote)) {
      return false;
    }
    return true;
  }

  // Case 2: On-premise / local workstation / Electron PC Server Console.
  // Any private LAN IP or proxy forwarding header on an on-premise server is a remote Browser Client.
  if (isPrivateLanIp(remote) || (originatingClientIp && isPrivateLanIp(originatingClientIp)) || hasForwarding) {
    return false;
  }

  if (isLoopbackIp(remote) && isLoopbackHost(hostWithoutPort)) {
    return true;
  }

  return false;
}

export function isAuthorizedServerConsoleRequest(req: Request): boolean {
  const remoteAddress = req.socket?.remoteAddress || req.ip || '';
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
  const forwardedHeader = typeof req.headers['forwarded'] === 'string' ? req.headers['forwarded'] : '';
  const isCloudRunRuntime = Boolean(process.env.K_SERVICE || process.env.K_REVISION);

  return evaluateServerConsoleAccess({
    remoteAddress,
    hostHeader,
    forwardedFor,
    forwardedHeader,
    hostedPreviewAllowed: process.env.LEDGERAI_DISABLE_HOSTED_CONSOLE !== 'true',
    isCloudRunRuntime,
  });
}
