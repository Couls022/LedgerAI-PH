import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

export interface AppNotification {
  id: string;
  companyId: string;
  userId?: string | null;
  title: string;
  message: string;
  type: 'DOCUMENT_UPLOAD' | 'AUDIT_LOG' | 'JOURNAL_CREATED' | 'TAX_RETURN' | 'SYSTEM';
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, any> | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  isConnected: boolean;
  latestToast: AppNotification | null;
  dismissToast: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  triggerTestNotification: (title?: string, message?: string, type?: AppNotification['type']) => Promise<void>;
  addNotification: (title: string, message: string, type?: AppNotification['type']) => Promise<void>;
  fetchNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Web Audio API simple soft chime sound synthesizer
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (err) {
    // Ignore audio autoplay restrictions
  }
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeCompany, user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [latestToast, setLatestToast] = useState<AppNotification | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const fetchNotifications = async () => {
    if (!activeCompany?.id) return;
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [activeCompany?.id]);

  // Establish real-time WebSocket connection
  useEffect(() => {
    if (!activeCompany?.id || !user?.id) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    let isMounted = true;

    const connectWebSocket = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/notifications?companyId=${activeCompany.id}&userId=${user.id}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        setIsConnected(true);
        console.log('[WebSocket] Real-time notifications connected');
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.event === 'NOTIFICATION') {
            const newNotif: AppNotification = payload.data;
            setNotifications(prev => [newNotif, ...prev]);
            setLatestToast(newNotif);
            playNotificationChime();
          }
        } catch (err) {
          console.error('[WebSocket] Message parse error:', err);
        }
      };

      ws.onclose = () => {
        if (!isMounted) return;
        setIsConnected(false);
        // Attempt reconnect after 4 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMounted) connectWebSocket();
        }, 4000);
      };

      ws.onerror = (err) => {
        console.warn('[WebSocket] Connection error:', err);
        ws.close();
      };
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeCompany?.id, user?.id]);

  const dismissToast = () => setLatestToast(null);

  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const markAllAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    try {
      await fetch('/api/notifications/read-all', { method: 'PATCH' });
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    }
  };

  const triggerTestNotification = async (title?: string, message?: string, type?: AppNotification['type']) => {
    try {
      await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, type }),
      });
    } catch (err) {
      console.error('Failed to trigger test notification:', err);
    }
  };

  const addNotification = async (title: string, message: string, type: AppNotification['type'] = 'SYSTEM') => {
    await triggerTestNotification(title, message, type);
  };

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      isConnected,
      latestToast,
      dismissToast,
      markAsRead,
      markAllAsRead,
      triggerTestNotification,
      addNotification,
      fetchNotifications
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
};
