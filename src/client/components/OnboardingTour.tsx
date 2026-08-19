import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, Command, BookOpen, FileText, FolderOpen, 
  ShieldCheck, ArrowRight, ArrowLeft, CheckCircle2, X, HelpCircle, Play
} from 'lucide-react';

interface TourStep {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  description: string;
  highlightKey: string;
  tip: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Global Search & Command Palette',
    subtitle: 'Press CMD / CTRL + K from anywhere',
    icon: <Command className="w-6 h-6 text-indigo-500" />,
    description: 'Instantly find any journal entry, customer invoice, vendor bill, BIR tax schedule code, uploaded document, or navigate to any view without clicking.',
    highlightKey: 'Search bar in header & Ctrl+K shortcut',
    tip: 'Pro-tip: Try searching for "2550M" or invoice numbers in the top bar!'
  },
  {
    title: 'Financial Health & Interactive D3 Charts',
    subtitle: 'Real-time liquidity and cashflow analysis',
    icon: <BookOpen className="w-6 h-6 text-blue-500" />,
    description: 'Monitor real-time cash balance, accounts receivable, and payables. Interactive D3.js charts highlight cashflow trends over fiscal periods.',
    highlightKey: 'Dashboard Overview KPIs',
    tip: 'Your metrics auto-calculate from underlying double-entry journal vouchers.'
  },
  {
    title: 'BIR Tax Schedules & Automated Compliance',
    subtitle: 'Philippine tax regulations made effortless',
    icon: <FileText className="w-6 h-6 text-emerald-500" />,
    description: 'Manage BIR VAT (2550M/Q), Expanded Withholding Tax (2307/1601-EQ), and Official Tax Schedule Codes with automated computation.',
    highlightKey: 'Tax & Compliance Tab',
    tip: 'Every transaction line validates input/output tax directions.'
  },
  {
    title: 'Document Repository & Audit Logs',
    subtitle: 'Complete source document transparency',
    icon: <FolderOpen className="w-6 h-6 text-amber-500" />,
    description: 'Upload source receipts and documents linked directly to vouchers. Every edit and backup export is logged immutably in the Audit Log.',
    highlightKey: 'Documents & Audit Tabs',
    tip: 'Auditors can verify attached files alongside matching ledger entries.'
  },
  {
    title: 'Offline Database Snapshots & Profiles',
    subtitle: 'Your data stays under your control',
    icon: <ShieldCheck className="w-6 h-6 text-cyan-500" />,
    description: 'Easily switch between company profiles, create multi-tenant workspaces, or download full offline LedgerAI database (.lai) packages anytime.',
    highlightKey: 'Switch Company & Backup Reminders',
    tip: 'Download a backup before submitting tax periods for peace of mind.'
  }
];

export default function OnboardingTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Check if onboarding was completed previously
    try {
      const completed = localStorage.getItem('ledger_onboarding_completed');
      if (!completed) {
        // Auto trigger tour after 1 second for first-time visitors
        const timer = setTimeout(() => setIsOpen(true), 800);
        return () => clearTimeout(timer);
      }
    } catch (e) {
      console.warn('LocalStorage read blocked in onboarding tour:', e);
    }
  }, []);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    try {
      localStorage.setItem('ledger_onboarding_completed', 'true');
    } catch (e) {
      console.warn('LocalStorage write blocked in onboarding tour:', e);
    }
    setIsOpen(false);
    setCurrentStep(0);
  };

  const handleStartTour = () => {
    setCurrentStep(0);
    setIsOpen(true);
  };

  return (
    <>
      {/* Header Replay Button Trigger */}
      <button
        onClick={handleStartTour}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg transition-all shadow-2xs"
        title="Start Guided Tour"
      >
        <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
        <span className="hidden md:inline">Guided Tour</span>
      </button>

      {/* Tour Overlay Modal */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Welcome to LedgerAI • Step {currentStep + 1} of {TOUR_STEPS.length}
                  </span>
                </div>

                <button
                  onClick={handleComplete}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
                  title="Close tour"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Step Content */}
              <div className="p-6 space-y-5">
                {/* Step Icon & Title */}
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl shrink-0 border border-slate-200 dark:border-slate-700">
                    {TOUR_STEPS[currentStep].icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {TOUR_STEPS[currentStep].title}
                    </h3>
                    <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">
                      {TOUR_STEPS[currentStep].subtitle}
                    </p>
                  </div>
                </div>

                {/* Description Body */}
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {TOUR_STEPS[currentStep].description}
                </p>

                {/* Feature Highlight & Tip Box */}
                <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/60 text-xs space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                    <span>Focus Area: {TOUR_STEPS[currentStep].highlightKey}</span>
                  </div>
                  <p className="text-indigo-700 dark:text-indigo-300 leading-normal pl-4">
                    {TOUR_STEPS[currentStep].tip}
                  </p>
                </div>

                {/* Step Indicator Dots */}
                <div className="flex items-center justify-center gap-1.5 pt-2">
                  {TOUR_STEPS.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentStep(idx)}
                      className={`h-2 rounded-full transition-all ${
                        idx === currentStep 
                          ? 'w-6 bg-indigo-600 dark:bg-indigo-500' 
                          : 'w-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Footer Controls */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <button
                  onClick={handleComplete}
                  className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  Skip Walkthrough
                </button>

                <div className="flex items-center gap-2">
                  {currentStep > 0 && (
                    <button
                      onClick={handlePrev}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center gap-1"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>
                  )}

                  <button
                    onClick={handleNext}
                    className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-colors flex items-center gap-1.5"
                  >
                    {currentStep === TOUR_STEPS.length - 1 ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Start Exploring
                      </>
                    ) : (
                      <>
                        Next <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
