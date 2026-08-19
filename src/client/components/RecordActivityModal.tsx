import React, { useEffect, useState } from 'react';
import { Clock, User, ShieldCheck, X, FileText, CheckCircle2, AlertTriangle, ArrowRight, Activity, Calendar } from 'lucide-react';

interface RecordActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  title?: string;
}

export default function RecordActivityModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  title
}: RecordActivityModalProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [lastTouch, setLastTouch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);

  useEffect(() => {
    if (isOpen && entityType && entityId) {
      setLoading(true);
      Promise.all([
        fetch(`/api/audit/last-activity?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/audit/history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`).then(r => r.ok ? r.json() : [])
      ]).then(([lastData, histData]) => {
        setLastTouch(lastData);
        setHistory(Array.isArray(histData) ? histData : []);
        setLoading(false);
      }).catch(err => {
        console.error("Failed to load activity history:", err);
        setLoading(false);
      });
    }
  }, [isOpen, entityType, entityId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg flex items-center gap-2">
                Activity Audit Trail
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono font-normal">
                  {entityType} / {entityId}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {title || `Complete immutable history of who touched this record`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* Last Touch Summary Box */}
          {lastTouch && !lastTouch.message && (
            <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/40 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Created By</p>
                <div className="flex items-center gap-2 mt-1">
                  <User className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {lastTouch.createdBy || 'System'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  {lastTouch.createdAt ? new Date(lastTouch.createdAt).toLocaleString() : 'N/A'}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Last Modified By</p>
                <div className="flex items-center gap-2 mt-1">
                  <User className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {lastTouch.lastModifiedBy || 'System'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  {lastTouch.lastModifiedAt ? new Date(lastTouch.lastModifiedAt).toLocaleString() : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {/* Timeline Feed */}
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2">
              <Clock className="w-5 h-5 animate-spin" /> Fetching activity logs...
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              No audit events recorded for this record yet.
            </div>
          ) : (
            <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-3 space-y-6">
              {history.map((log, idx) => (
                <div key={log.id} className="relative pl-6">
                  {/* Circle Marker */}
                  <div className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 bg-white dark:bg-slate-900 ${
                    log.result === 'FAILED' ? 'border-rose-500 bg-rose-50 dark:bg-rose-950' :
                    log.result === 'WARNING' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950' : 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                  }`} />

                  <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/60 uppercase">
                          {log.action.replace(/_/g, ' ')}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                          log.result === 'FAILED' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}>
                          {log.result}
                        </span>
                      </div>

                      <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-medium">
                      <span>User: <strong className="text-slate-800 dark:text-slate-100">{log.userDisplayName || log.userEmail || log.userId || 'System'}</strong> ({log.role || 'User'})</span>
                      <span className="font-mono text-slate-400">Src: {log.source}</span>
                    </div>

                    {log.reason && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 font-medium bg-rose-50 dark:bg-rose-950/40 p-2 rounded border border-rose-200 dark:border-rose-900/40">
                        Reason: {log.reason}
                      </p>
                    )}

                    {(log.beforeData || log.afterData || log.metadata) && (
                      <button
                        onClick={() => setSelectedEntry(selectedEntry?.id === log.id ? null : log)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold flex items-center gap-1 pt-1"
                      >
                        {selectedEntry?.id === log.id ? 'Hide State Details' : 'View State Details'}
                      </button>
                    )}

                    {selectedEntry?.id === log.id && (
                      <div className="pt-2 text-xs font-mono space-y-2 border-t border-slate-200 dark:border-slate-700/80 mt-2">
                        {log.beforeData && (
                          <div>
                            <span className="font-bold text-slate-400 uppercase">Before State:</span>
                            <pre className="p-2 bg-slate-900 text-slate-200 rounded text-[11px] overflow-x-auto mt-1">
                              {log.beforeData}
                            </pre>
                          </div>
                        )}

                        {log.afterData && (
                          <div>
                            <span className="font-bold text-slate-400 uppercase">After State:</span>
                            <pre className="p-2 bg-slate-900 text-slate-200 rounded text-[11px] overflow-x-auto mt-1">
                              {log.afterData}
                            </pre>
                          </div>
                        )}

                        {log.metadata && (
                          <div>
                            <span className="font-bold text-slate-400 uppercase">Metadata:</span>
                            <pre className="p-2 bg-slate-900 text-slate-200 rounded text-[11px] overflow-x-auto mt-1">
                              {log.metadata}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            Append-Only Authoritative Ledger
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
