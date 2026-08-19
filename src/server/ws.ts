import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { db } from './db';
import * as schema from './db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

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

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/ws/notifications' || url.pathname === '/ws' || url.pathname === '/ws/authority') {
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const companyId = url.searchParams.get('companyId') || undefined;
    const userId = url.searchParams.get('userId') || undefined;
    const role = url.searchParams.get('role') || undefined;
    const isAuthority = role === 'authority' || url.pathname === '/ws/authority';

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
          if (parsed.companyId) client.companyId = parsed.companyId;
          if (parsed.userId) client.userId = parsed.userId;
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

  // 1. Validate companyId exists in DB before historical persistence
  let validCompanyId: string | null = null;
  if (payload.companyId) {
    try {
      const comp = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.id, payload.companyId)).get();
      if (comp) validCompanyId = payload.companyId;
    } catch {}
  }

  if (!validCompanyId) {
    try {
      const firstComp = await db.select({ id: schema.companies.id }).from(schema.companies).limit(1).get();
      if (firstComp) validCompanyId = firstComp.id;
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

  console.log(`[Notification] Broadcasted "${payload.title}" to ${sentCount} active client(s)`);
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
