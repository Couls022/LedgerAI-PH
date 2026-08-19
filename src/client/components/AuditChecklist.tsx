import React, { useState, useEffect } from 'react';
import { CheckCircle2, Circle, AlertCircle, ShieldCheck, ClipboardCheck, Play } from 'lucide-react';
import PenTestModal from './PenTestModal';
import UserSignoffModal from './UserSignoffModal';

interface AuditTask {
  id: string;
  label: string;
  status: 'VERIFIED' | 'PENDING' | 'IN_PROGRESS';
  category: string;
}

const DEFAULT_AUDIT_TASKS: AuditTask[] = [
  { id: 't1', label: 'Core Accounting Logic', status: 'VERIFIED', category: 'Backend' },
  { id: 't2', label: 'BIR Tax Rules & Forms', status: 'VERIFIED', category: 'Backend' },
  { id: 't3', label: 'Security & Isolation', status: 'VERIFIED', category: 'Backend' },
  { id: 't4', label: '32/32 Application Routes', status: 'VERIFIED', category: 'UI/UX Gate' },
  { id: 't5', label: 'Responsive Layouts', status: 'VERIFIED', category: 'UI/UX Gate' },
  { id: 't6', label: 'Error & Loading States', status: 'VERIFIED', category: 'UI/UX Gate' },
  { id: 't7', label: 'Accessibility Standards', status: 'VERIFIED', category: 'UI/UX Gate' },
  { id: 't8', label: 'Final Penetration Testing', status: 'PENDING', category: 'Pre-Flight' },
  { id: 't9', label: 'Production Build Artifacts', status: 'VERIFIED', category: 'Pre-Flight' },
  { id: 't10', label: 'End-to-End User Sign-off', status: 'PENDING', category: 'Pre-Flight' },
];

export default function AuditChecklist() {
  const [tasks, setTasks] = useState<AuditTask[]>(() => {
    try {
      const saved = localStorage.getItem('audit_tasks_state');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_AUDIT_TASKS;
  });

  const [showPenTestModal, setShowPenTestModal] = useState(false);
  const [showSignoffModal, setShowSignoffModal] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('audit_tasks_state', JSON.stringify(tasks));
    } catch (e) {
      console.error(e);
    }
  }, [tasks]);

  const toggleTaskStatus = (id: string) => {
    if (id === 't8') {
      setShowPenTestModal(true);
      return;
    }
    if (id === 't10') {
      setShowSignoffModal(true);
      return;
    }

    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          status: t.status === 'VERIFIED' ? 'PENDING' : 'VERIFIED'
        };
      }
      return t;
    }));
  };

  const markTaskVerified = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'VERIFIED' } : t));
  };

  const verifiedCount = tasks.filter(t => t.status === 'VERIFIED').length;
  const totalCount = tasks.length;
  const progressPercentage = Math.round((verifiedCount / totalCount) * 100);

  const isPenTestVerified = tasks.find(t => t.id === 't8')?.status === 'VERIFIED';
  const isSignoffVerified = tasks.find(t => t.id === 't10')?.status === 'VERIFIED';

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 p-5 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
          <ClipboardCheck className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Audit &amp; Launch Gates</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Production readiness tracking</p>
        </div>
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Completion Progress</span>
          <span className="font-bold text-indigo-600 dark:text-indigo-400">{progressPercentage}%</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-200 dark:border-slate-700/50">
          <div 
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500" 
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4">
        {['Backend', 'UI/UX Gate', 'Pre-Flight'].map(category => {
          const categoryTasks = tasks.filter(t => t.category === category);
          if (categoryTasks.length === 0) return null;
          
          return (
            <div key={category} className="space-y-2">
              <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-1">
                {category}
              </h3>
              <div className="space-y-1.5">
                {categoryTasks.map(task => {
                  const isHighlightedInteractive = task.id === 't8' || task.id === 't10';

                  return (
                    <div 
                      key={task.id} 
                      onClick={() => toggleTaskStatus(task.id)}
                      className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        task.status === 'VERIFIED' 
                          ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800/60' 
                          : isHighlightedInteractive
                            ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 hover:border-indigo-500 ring-1 ring-indigo-500/30'
                            : 'bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {task.status === 'VERIFIED' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : task.status === 'IN_PROGRESS' ? (
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                        )}
                        <span className={`text-xs font-medium ${
                          task.status === 'VERIFIED' 
                            ? 'text-slate-500 dark:text-slate-400 line-through decoration-slate-300 dark:decoration-slate-600' 
                            : 'text-slate-800 dark:text-slate-100 font-bold'
                        }`}>
                          {task.label}
                        </span>
                      </div>

                      {task.status !== 'VERIFIED' && isHighlightedInteractive && (
                        <span className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-bold transition-all shadow-2xs flex items-center gap-1">
                          <Play className="w-2.5 h-2.5" /> Execute
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals for Penetration Testing and End-to-End Signoff */}
      <PenTestModal
        isOpen={showPenTestModal}
        onClose={() => setShowPenTestModal(false)}
        onVerify={() => markTaskVerified('t8')}
        isVerified={!!isPenTestVerified}
      />

      <UserSignoffModal
        isOpen={showSignoffModal}
        onClose={() => setShowSignoffModal(false)}
        onVerify={() => markTaskVerified('t10')}
        isVerified={!!isSignoffVerified}
      />
    </div>
  );
}
