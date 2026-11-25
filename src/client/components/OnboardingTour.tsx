import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Command, BookOpen, FileText, FolderOpen,
  ShieldCheck, ArrowRight, ArrowLeft, CheckCircle2, X,
  Bot, Mail, ExternalLink
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getAuthorizedERPModules } from '../../shared/moduleRegistry';
import { apiFetch } from '../utils/apiClient';

interface TourStep {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  description: string;
  highlightKey: string;
  tip: string;
  targetRoute?: string;
  actionLabel?: string;
}

export default function OnboardingTour() {
  const { user, activeCompany, userRole, permissions } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const storageKey = `ledger_walkthrough_v2_${user?.id || 'anon'}_${activeCompany?.id || 'default'}`;

  const authorizedModuleIds = useMemo(() => {
    return new Set(
      getAuthorizedERPModules(
        userRole,
        permissions,
        activeCompany?.assignedModules,
        activeCompany?.assignedSubmodules
      ).map((m) => m.id)
    );
  }, [userRole, permissions, activeCompany]);

  const tourSteps: TourStep[] = useMemo(() => {
    const isNonVat =
      String(activeCompany?.vatStatus || '').toUpperCase().includes('NON_VAT') ||
      String(activeCompany?.vatStatus || '').toUpperCase().includes('EXEMPT');
    const taxpayerType = String(activeCompany?.taxpayerClassification || 'CORPORATION').toUpperCase();
    const birFormHint = isNonVat
      ? 'Form 2551Q Percentage Tax, 2307 EWT, & Income Tax (1701/1702)'
      : 'EOPT Form 2550Q VAT (12% Output vs Input), SLSP, & 2307 EWT';

    const steps: TourStep[] = [
      {
        id: 'dashboard-search',
        title: 'Live Financial Cockpit & Global Search',
        subtitle: 'Press CTRL + K or use the Header Search anywhere',
        icon: <Command className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" />,
        description:
          'Monitor real-time Cash on Hand, Receivables, Payables, and Cashflow curves computed directly from double-entry journal vouchers and active period filters.',
        highlightKey: 'Executive Dashboard & Header Command Search',
        tip: 'Click KPI totals or Press CTRL + K to inspect 360° source traceability down to invoices, bills, and journal lines.',
        targetRoute: '/dashboard',
        actionLabel: 'Open Dashboard',
      },
    ];

    if (authorizedModuleIds.has('sales') || authorizedModuleIds.has('procurement')) {
      steps.push({
        id: 'operations-reminders',
        title: 'Invoices, Bills & Overdue Email Reminders',
        subtitle: 'Full subledger sync + real SMTP reminder notifications',
        icon: <Mail className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />,
        description:
          'Issue BIR EOPT-compliant Sales Invoices, track Vendor Bills and Collections, and dispatch real overdue payment reminder emails backed by your company SMTP server.',
        highlightKey: 'Sales, Receivables & Email Notification Settings',
        tip: 'Configure your SMTP credentials in Settings → Email Notifications so overdue reminders deliver directly to customer emails on file.',
        targetRoute: '/operations/invoices',
        actionLabel: 'Go to Sales Invoices',
      });
    }

    if (authorizedModuleIds.has('accounting')) {
      steps.push({
        id: 'accounting-gl',
        title: 'General Ledger, COA & Period Close Controls',
        subtitle: 'Strict ACID posting & maker-checker approvals',
        icon: <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-violet-500" />,
        description:
          'Post balanced double-entry journal vouchers, run Soft/Hard fiscal period locks, and verify Trial Balance parity across all 16 ERP modules.',
        highlightKey: 'Accounting → Journals & Fiscal Periods',
        tip: 'Soft-closed periods warn before posting; Hard-closed periods lock posted history with cryptographic period certification.',
        targetRoute: '/accounting/journals',
        actionLabel: 'Open Journal Entries',
      });
    }

    if (authorizedModuleIds.has('tax')) {
      steps.push({
        id: 'tax-bir',
        title: `BIR Statutory Tax Engine (${isNonVat ? 'NON-VAT' : 'VAT'})`,
        subtitle: `${taxpayerType} compliance schedule & DAT exports`,
        icon: <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" />,
        description: `Automatically computes ${birFormHint} directly from posted GL entries, customer/vendor ATC codes, and SLSP/SAWT/QAP schedules.`,
        highlightKey: 'Tax & Compliance Hub',
        tip: 'Your tax forms automatically enforce EOPT rules and active entity tax classification.',
        targetRoute: '/tax',
        actionLabel: 'Open Tax Engine',
      });
    }

    if (authorizedModuleIds.has('documents') || authorizedModuleIds.has('audit')) {
      steps.push({
        id: 'docs-audit',
        title: 'Encrypted Document Vault & Audit Chain',
        subtitle: 'AES-256-GCM storage & immutable HMAC logs',
        icon: <FolderOpen className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500" />,
        description:
          'Upload source ORs, invoices, and bank statements with hybrid OCR extraction. Every create, post, approve, and backup action is sealed in the immutable audit chain.',
        highlightKey: 'Documents & Audit Activity Center',
        tip: 'Documents stay inside your portable company folder so switching or restoring workspaces keeps every file attached.',
        targetRoute: '/documents',
        actionLabel: 'Open Documents',
      });
    }

    steps.push({
      id: 'ledger-agent-ai',
      title: 'Zero-Guessing Ledger Agent AI Assistant',
      subtitle: 'Strictly grounded in live company SQLite records',
      icon: <Bot className="w-5 h-5 sm:w-6 sm:h-6 text-sky-500" />,
      description:
        'Ask in English or Taglish about any customer receivable ("May utang ba si..."), overdue bills, VAT/EWT totals, period close readiness, or specific voucher numbers—answers cite live database records with zero fabricated numbers.',
      highlightKey: 'Floating Ledger Agent Button (Bottom-Right)',
      tip: 'Works both offline (deterministic SQLite engine) and online with encrypted company AI keys in Settings → AI Settings.',
      targetRoute: '/settings?tab=ai',
      actionLabel: 'Configure AI Providers',
    });

    steps.push({
      id: 'portable-backup',
      title: 'Portable Workspaces, Launchers & .lai Backups',
      subtitle: 'Seamless Server & Client access anytime',
      icon: <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-500" />,
      description:
        'Every company has its own portable database folder, encrypted .lai backup archive, and desktop shortcut launcher synced in real time between Server and Client views.',
      highlightKey: 'Switch Company & Backup Vault',
      tip: 'Always verify or download a .lai snapshot in Master Data → Backup Vault before closing a tax quarter.',
      targetRoute: '/master-data/backup-vault',
      actionLabel: 'Open Backup Vault',
    });

    return steps;
  }, [authorizedModuleIds, activeCompany?.vatStatus, activeCompany?.taxpayerClassification]);

  useEffect(() => {
    if (!activeCompany?.id || !user?.id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const localDone = localStorage.getItem(storageKey) || localStorage.getItem('ledger_onboarding_completed');
        if (localDone) return;

        const serverState = await apiFetch<any>('/api/settings/walkthrough').catch(() => null);
        if (cancelled) return;
        if (serverState?.completed) {
          localStorage.setItem(storageKey, 'true');
          localStorage.setItem('ledger_onboarding_completed', 'true');
          return;
        }
        timer = setTimeout(() => {
          if (!cancelled) setIsOpen(true);
        }, 900);
      } catch {
        // Ignore storage / network errors for auto-tour
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeCompany?.id, user?.id, storageKey]);

  const persistProgress = async (completed: boolean, stepIdx: number) => {
    try {
      if (completed) {
        localStorage.setItem(storageKey, 'true');
        localStorage.setItem('ledger_onboarding_completed', 'true');
      }
      await apiFetch('/api/settings/walkthrough', {
        method: 'POST',
        body: JSON.stringify({ completed, lastStep: stepIdx }),
      }).catch(() => null);
    } catch {
      // Non-blocking
    }
  };

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      persistProgress(false, next);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
    }
  };

  const handleComplete = () => {
    persistProgress(true, tourSteps.length - 1);
    setIsOpen(false);
    setCurrentStep(0);
  };

  const handleStartTour = () => {
    setCurrentStep(0);
    setIsOpen(true);
  };

  const handleNavigateStep = (rawRoute: string) => {
    const prefix = (location.pathname.match(/^(\/(?:client|server)\/[^\/]+)/) || [])[1] || '';
    const finalRoute = prefix ? `${prefix}${rawRoute}` : rawRoute;
    persistProgress(true, currentStep);
    setIsOpen(false);
    navigate(finalRoute);
  };

  const activeStep = tourSteps[currentStep] || tourSteps[0];

  return (
    <>
      <button
        onClick={handleStartTour}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl transition-all shadow-2xs shrink-0 cursor-pointer"
        title="Start Interactive Walkthrough"
        aria-label="Start Guided Tour"
      >
        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        <span className="hidden sm:inline">Walkthrough</span>
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && activeStep && (
            <div
              className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto"
              onClick={(e) => {
                if (e.target === e.currentTarget) handleComplete();
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 12 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="w-full max-w-sm sm:max-w-lg md:max-w-xl mx-auto my-auto bg-white dark:bg-[#0f172a] rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 truncate">
                      {activeCompany?.legalName || 'LedgerAI PH'} • Step {currentStep + 1} of {tourSteps.length}
                    </span>
                  </div>

                  <button
                    onClick={handleComplete}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
                    title="Close walkthrough"
                    aria-label="Close walkthrough"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-5 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="p-2 sm:p-3 bg-indigo-50 dark:bg-slate-800 rounded-xl sm:rounded-2xl shrink-0 border border-indigo-100 dark:border-slate-700">
                      {activeStep.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm sm:text-base md:text-lg font-black text-slate-900 dark:text-slate-100 leading-snug break-words">
                        {activeStep.title}
                      </h3>
                      <p className="text-[11px] sm:text-xs font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5 break-words">
                        {activeStep.subtitle}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                    {activeStep.description}
                  </p>

                  <div className="p-3 sm:p-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/60 text-[11px] sm:text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2 text-indigo-900 dark:text-indigo-200 font-bold min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                        <span className="truncate">Focus Area: {activeStep.highlightKey}</span>
                      </span>
                      {activeStep.targetRoute && (
                        <button
                          type="button"
                          onClick={() => handleNavigateStep(activeStep.targetRoute!)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white transition-colors text-[11px] font-bold shrink-0 cursor-pointer"
                        >
                          <span>{activeStep.actionLabel || 'Open'}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-indigo-700 dark:text-indigo-300 leading-normal pl-4 break-words">
                      {activeStep.tip}
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 pt-1">
                    {tourSteps.map((step, idx) => (
                      <button
                        key={step.id}
                        onClick={() => setCurrentStep(idx)}
                        className={`h-2 rounded-full transition-all cursor-pointer ${
                          idx === currentStep
                            ? 'w-6 bg-indigo-600 dark:bg-indigo-500'
                            : 'w-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300'
                        }`}
                        aria-label={`Go to step ${idx + 1}: ${step.title}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 shrink-0">
                  <button
                    onClick={handleComplete}
                    className="text-xs sm:text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer py-1 truncate"
                  >
                    Skip Walkthrough
                  </button>

                  <div className="flex items-center gap-2 shrink-0 max-w-full">
                    {currentStep > 0 && (
                      <button
                        onClick={handlePrev}
                        className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center justify-center gap-1 cursor-pointer shrink-0"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">Back</span>
                      </button>
                    )}

                    <button
                      onClick={handleNext}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                    >
                      {currentStep === tourSteps.length - 1 ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span className="truncate">Finish Walkthrough</span>
                        </>
                      ) : (
                        <>
                          <span className="truncate">Next</span>
                          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
