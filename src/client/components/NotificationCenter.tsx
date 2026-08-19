import React, { useState, useRef, useEffect } from 'react';
import { 
  Bell, FileText, ShieldAlert, BookOpen, Calculator, Sparkles, 
  Check, CheckCheck, X, Zap, Wifi, WifiOff, Clock 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotifications, AppNotification } from '../context/NotificationContext';

const getNotificationIcon = (type: AppNotification['type']) => {
  switch (type) {
    case 'DOCUMENT_UPLOAD':
      return <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
    case 'AUDIT_LOG':
      return <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
    case 'JOURNAL_CREATED':
      return <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />;
    case 'TAX_RETURN':
      return <Calculator className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
    case 'SYSTEM':
    default:
      return <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
  }
};

const formatTimeAgo = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const LiveNotificationToast: React.FC = () => {
  const { latestToast, dismissToast, markAsRead } = useNotifications();

  useEffect(() => {
    if (latestToast) {
      const timer = setTimeout(() => {
        dismissToast();
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [latestToast]);

  if (!latestToast) return null;

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm w-full">
      <motion.div 
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-indigo-100 dark:border-indigo-900/40 p-4 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 animate-pulse" />
        
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 shrink-0">
            {getNotificationIcon(latestToast.type)}
          </div>

          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Real-Time Alert
              </span>
              <span className="text-[10px] text-slate-400">• {formatTimeAgo(latestToast.createdAt)}</span>
            </div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5 truncate">{latestToast.title}</h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">{latestToast.message}</p>
          </div>

          <button 
            onClick={dismissToast}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, isConnected, markAsRead, markAllAsRead, triggerTestNotification } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'DOCUMENT_UPLOAD' | 'AUDIT_LOG' | 'JOURNAL_CREATED'>('ALL');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'ALL') return true;
    return n.type === filter;
  });

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none"
        title="Real-Time Notifications"
      >
        <Bell className="w-5 h-5" />
        
        {/* Unread Counter Badge */}
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-slate-900 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Live WebSocket Status Dot */}
        <span className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
      </button>

      {/* Notifications Popover Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/40">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">Notifications</h3>
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${isConnected ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                  {isConnected ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> Live
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3 h-3" /> Reconnecting
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Read All
                  </button>
                )}
                <button
                  onClick={() => triggerTestNotification('Real-Time Alert', 'Document upload event received via WebSocket stream.')}
                  className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-md transition-colors"
                  title="Simulate Event Notification"
                >
                  <Zap className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-700 px-2 pt-2 bg-white dark:bg-slate-800 text-xs overflow-x-auto">
              {(['ALL', 'DOCUMENT_UPLOAD', 'AUDIT_LOG', 'JOURNAL_CREATED'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-3 py-1.5 font-medium border-b-2 whitespace-nowrap transition-colors ${filter === tab ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                >
                  {tab === 'ALL' ? 'All' : tab === 'DOCUMENT_UPLOAD' ? 'Docs' : tab === 'AUDIT_LOG' ? 'Audit' : 'Accounting'}
                </button>
              ))}
            </div>

            {/* Notifications Feed */}
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-slate-500">
                  <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs font-medium">No notifications yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Events like document uploads or audit logs will stream live here.</p>
                </div>
              ) : (
                filteredNotifications.map(notif => (
                  <div
                    key={notif.id}
                    onClick={() => markAsRead(notif.id)}
                    className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${notif.isRead ? 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 opacity-75' : 'bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/70'}`}
                  >
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700/60 shrink-0 mt-0.5">
                      {getNotificationIcon(notif.type)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <h4 className={`text-xs font-semibold truncate ${notif.isRead ? 'text-slate-700 dark:text-slate-300' : 'text-slate-900 dark:text-slate-100'}`}>
                          {notif.title}
                        </h4>
                        <span className="text-[10px] text-slate-400 shrink-0 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTimeAgo(notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                    </div>

                    {!notif.isRead && (
                      <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0 mt-2" />
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 text-center">
              <span className="text-[11px] text-slate-400">
                Connected to Real-time Notification Engine
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
