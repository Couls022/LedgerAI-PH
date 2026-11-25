import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { db } from './db';
import * as schema from './db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { authenticateSessionToken, type AuthenticatedWsSession } from './auth';

interface NotificationPayload {
  companyId: string;
  userId?: string | null;
  title: string;
  message: string;
  type: 'DOCUMENT_UPLOAD' | 'AUDIT_LOG' | 'JOURNAL_CREATED' | 'TAX_RETURN' | 'SYSTEM';
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, any>;
}

interface ClientMeta {
  ws: WebSocket;
  companyId?: string;
  userId?: string;
  isAuthority?: boolean;
  isAlive: boolean;
}

const clients = new Set<ClientMeta>();

let wss: WebSocketServer | null = null;

export function getWsConnectionStats(): {
  totalConnections: number;
  authenticatedClients: number;
  byCompany: Record<string, number>;
} {
  let totalConnections = 0;
  let authenticatedClients = 0;
  const byCompany: Record<string, number> = {};

  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      totalConnections += 1;
      if (!client.isAuthority && client.companyId && client.userId) {
        authenticatedClients += 1;
        byCompany[client.companyId] = (byCompany[client.companyId] || 0) + 1;
      }
    }
  });

  return { totalConnections, authenticatedClients, byCompany };
}

function extractWsToken(request: any, url: URL): string | null {
  const authHeader = request.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieHeader = request.headers?.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    if (match?.[1]) return match[1];
  }
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  return null;
}

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws/authority') {
        wss?.handleUpgrade(request, socket, head, (ws) => {
          (request as any).__wsAuth = { isAuthority: true };
          wss?.emit('connection', ws, request);
        });
        return;
      }

      if (url.pathname === '/ws/notifications' || url.pathname === '/ws') {
        const token = extractWsToken(request, url);
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const session = await authenticateSessionToken(token);
        if (!session) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const requestedCompanyId = url.searchParams.get('companyId');
        if (requestedCompanyId && requestedCompanyId !== session.companyId) {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        (request as any).__wsAuth = { isAuthority: false, session };
        wss?.handleUpgrade(request, socket, head, (ws) => {
          wss?.emit('connection', ws, request);
        });
      }
    } catch {
      try {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
      } catch {}
    }
  });

  wss.on('connection', (ws: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const wsAuth = (request as any).__wsAuth as { isAuthority: boolean; session?: AuthenticatedWsSession } | undefined;
    const isAuthority = Boolean(wsAuth?.isAuthority && url.pathname === '/ws/authority');
    const companyId = isAuthority ? undefined : wsAuth?.session?.companyId;
    const userId = isAuthority ? undefined : wsAuth?.session?.userId;

    const client: ClientMeta = { ws, companyId, userId, isAuthority, isAlive: true };
    clients.add(client);

    // Send connection ACK
    ws.send(JSON.stringify({
      event: 'CONNECTED',
      data: { message: isAuthority ? 'Authority real-time stream connected' : 'Real-time notification engine connected', companyId }
    }));

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.action === 'SUBSCRIBE') {
          if (isAuthority) {
            ws.send(JSON.stringify({ event: 'ERROR', error: 'FORBIDDEN_SUBSCRIBE' }));
            return;
          }
          if (parsed.companyId && parsed.companyId !== client.companyId) {
            ws.send(JSON.stringify({ event: 'ERROR', error: 'CROSS_TENANT_SUBSCRIBE_DENIED' }));
            return;
          }
          if (parsed.userId && parsed.userId !== client.userId) {
            ws.send(JSON.stringify({ event: 'ERROR', error: 'CROSS_USER_SUBSCRIBE_DENIED' }));
            return;
          }
          ws.send(JSON.stringify({
            event: 'SUBSCRIBED',
            data: { companyId: client.companyId, userId: client.userId }
          }));
        } else if (parsed.action === 'PING') {
          ws.send(JSON.stringify({ event: 'PONG' }));
        }
      } catch (err) {
        // Ignore invalid client messages
      }
    });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });

  // Keep-alive heartbeat interval (ping clients every 30s)
  const interval = setInterval(() => {
    clients.forEach((client) => {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
        return;
      }
      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('[WebSocket] Real-time notification server initialized');
}

export async function broadcastNotification(payload: NotificationPayload) {
  const notificationId = crypto.randomUUID();
  const createdAt = new Date();

  // 1. Validate companyId matches payload strictly; never fall back to persisting under a different company
  let validCompanyId: string | null = null;
  if (payload.companyId) {
    try {
      const comp = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.id, payload.companyId)).get();
      if (comp) validCompanyId = payload.companyId;
    } catch {}
  }

  let notificationRecord: any = null;

  if (validCompanyId) {
    notificationRecord = {
      id: notificationId,
      companyId: validCompanyId,
      userId: payload.userId || null,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      entityType: payload.entityType || null,
      entityId: payload.entityId || null,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      isRead: false,
      createdAt,
    };

    try {
      await db.insert(schema.notifications).values(notificationRecord);
    } catch (err) {
      console.error('[Notification] DB Save Error:', err);
    }
  }

  const broadcastRecord = notificationRecord || {
    id: notificationId,
    companyId: payload.companyId || 'system',
    userId: payload.userId || null,
    title: payload.title,
    message: payload.message,
    type: payload.type,
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    isRead: false,
    createdAt,
  };

  // 2. Broadcast via WebSocket to connected clients of the company
  const eventPayload = JSON.stringify({
    event: 'NOTIFICATION',
    data: {
      ...broadcastRecord,
      createdAt: createdAt.toISOString(),
      metadata: payload.metadata || null,
    }
  });

  let sentCount = 0;
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (client.companyId === payload.companyId) {
        if (!payload.userId || client.userId === payload.userId) {
          client.ws.send(eventPayload);
          sentCount++;
        }
      }
    }
  });

  if (sentCount > 0) {
    console.log(`[Notification] Broadcasted "${payload.title}" to ${sentCount} active client(s)`);
  }
  return notificationRecord;
}

export function broadcastAuthorityEvent(data: Record<string, any>) {
  const eventPayload = JSON.stringify({
    event: 'AUTHORITY_ACTIVATION_UPDATE',
    data: {
      ...data,
      timestamp: new Date().toISOString(),
    }
  });

  let sentCount = 0;
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (client.isAuthority || !client.companyId || client.companyId === data.companyId) {
        client.ws.send(eventPayload);
        sentCount++;
      }
    }
  });

  console.log(`[Authority WS] Broadcasted activation update for company ${data.companyId || 'ALL'} to ${sentCount} subscriber(s)`);
}
