import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Send,
  X,
  RefreshCw,
  User,
  ShieldCheck,
  Database,
  Compass,
  RotateCcw,
  Shield,
  Crown,
  UserCheck,
  ArrowRight,
  LayoutDashboard,
  ShoppingBag,
  BookOpen,
  FileCheck,
  Folder,
  BarChart3,
  Calculator,
  Settings,
  Users,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Cpu,
  Copy,
  Check,
  Layers,
  StopCircle,
  Calendar,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';
import { useActiveModuleContext } from '../context/ActiveModuleContext';
import RecordActivityModal from './RecordActivityModal';
import {
  LEDGER_AGENT_DATE_RANGE_PRESETS,
  resolveDateRangeFilter,
  ResolvedDateRangeFilter,
} from '../../shared/dateRangeFilter';

export interface PendingActionProposal {
  actionId: string;
  actionType: string;
  description: string;
  riskLevel: 'READ_ONLY' | 'LOW_MUTATION' | 'HIGH_MUTATION';
  payload: Record<string, any>;
  warningMessage?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
}

export interface SourceRecordRef {
  entityType: string;
  entityId: string;
  recordReference: string;
  label: string;
  amountFormatted?: string;
  status?: string;
  modulePath?: string;
}

export interface MessageProvenance {
  engineUsed: string;
  providerId: string;
  providerType: string;
  modelName: string;
  executionMode: 'OFFLINE_LOCAL' | 'ONLINE_GROUNDED' | 'FAILOVER_OFFLINE';
  failoverOccurred: boolean;
  failoverReason: string | null;
  companyId: string;
  companyName: string;
  reportingPeriod: string;
  dataSource: string[];
  responseTimestamp: string;
  confidenceState: string;
  sourceRecords: SourceRecordRef[];
  activeModuleContext?: {
    moduleId: string;
    moduleName: string;
    submoduleId: string;
    submoduleName: string;
    activePath: string;
    systemPromptContext: string;
  };
  dateRangeFilter?: ResolvedDateRangeFilter;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  isOffline?: boolean;
  isError?: boolean;
  retryPrompt?: string;
  citations?: string[];
  authoritativeSource?: string;
  warnings?: string[];
  suggestedActions?: Array<{ label: string; action: string; params?: Record<string, any> }>;
  pendingAction?: PendingActionProposal;
  needsReview?: boolean;
  provenance?: MessageProvenance;
}

const systemModules = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Sales & Billing', path: '/accounting/sales-invoicing', icon: ShoppingBag },
  { name: 'General Ledger', path: '/accounting/journals', icon: BookOpen },
  { name: 'BIR Tax & Forms', path: '/tax/bir-compliance', icon: FileCheck },
  { name: 'Documents', path: '/documents', icon: Folder },
  { name: 'Reports', path: '/reports', icon: BarChart3 },
  { name: 'Budget', path: '/budget', icon: Calculator },
  { name: 'Audit & Logs', path: '/audit/logs', icon: ShieldCheck },
  { name: 'Master Data', path: '/master-data/customers', icon: Users },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export default function LedgerAgentWidget() {
  const navigate = useNavigate();
  const activeModuleCtx = useActiveModuleContext();
  const activeScreenPath = activeModuleCtx.activePath || '/';
  const activeScreenKnowledge = activeModuleCtx.knowledgeRecord;
  const { user, activeCompany, userRole } = useAuth();
  const companyDisplayName =
    activeCompany?.legalName ||
    activeCompany?.tradeName ||
    (activeCompany as any)?.name ||
    'Active Company';
  const companyId = activeCompany?.id || 'default';

  const normalizedRole = (userRole || 'Company Owner').toLowerCase();
  const isOwner = normalizedRole.includes('owner');
  const isAdmin = normalizedRole.includes('admin');
  const roleTitle = isOwner ? 'Company Owner' : isAdmin ? 'Administrator' : userRole || 'Staff User';

  const storageKey = `ledger_agent_chat_${companyId}_${user?.id || 'guest'}`;
  const isOpenStorageKey = `ledger_agent_is_open_${companyId}`;
  const dateFilterStorageKey = `ledger_agent_date_filter_${companyId}`;

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(isOpenStorageKey) === 'true';
    } catch {
      return false;
    }
  });

  const [selectedDatePreset, setSelectedDatePreset] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem(dateFilterStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.preset) return String(parsed.preset);
      }
    } catch {}
    return 'ALL';
  });

  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem(dateFilterStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.startDate) return String(parsed.startDate);
      }
    } catch {}
    return '2026-10-01';
  });

  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem(dateFilterStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.endDate) return String(parsed.endDate);
      }
    } catch {}
    return '2026-10-31';
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(
        dateFilterStorageKey,
        JSON.stringify({
          preset: selectedDatePreset,
          startDate: customStartDate,
          endDate: customEndDate,
        })
      );
    } catch {}
  }, [selectedDatePreset, customStartDate, customEndDate, dateFilterStorageKey]);

  const resolvedDateRange: ResolvedDateRangeFilter = useMemo(() => {
    if (selectedDatePreset === 'CUSTOM') {
      return resolveDateRangeFilter({
        preset: 'CUSTOM',
        startDate: customStartDate,
        endDate: customEndDate,
        label: `Custom Range (${customStartDate} to ${customEndDate})`,
      });
    }
    return resolveDateRangeFilter({ preset: selectedDatePreset });
  }, [selectedDatePreset, customStartDate, customEndDate]);

  const getInitialWelcomeMessage = (): ChatMessage => ({
    id: 'welcome-agent',
    sender: 'agent',
    text: `### Hello! I'm **Ledger Agent** 🤖✨
Your Philippine AI Accounting, BIR Tax & Business Intelligence Assistant for **${companyDisplayName}**.

I answer your accounting and compliance questions with zero hallucinations, backed directly by your General Ledger, Philippine Tax Engine, Compliance Rule Engine, and verified Operational Knowledge Base — **100% operational both Online and Offline**.

Use the **Date-Range Selector** above (e.g., **Last Month**, **February 2026**, **Q1 2024**) or ask directly by **Target Date, Target Week, or Target Month**:
- *"Show sales invoices for October 2026"* vs *"Show sales invoices for February 2026"*
- *"4th week of October 2026"* or *"1st week of October 2026"* or *"2026-10-25"*
- *"What is my revenue in October?"* vs *"How much were sales in February?"*
- *"How much VAT did I record in October?"* vs *"VAT summary for February"*
- *"Show Trial Balance summary"* or *"Explain this module"*

How can I assist you today?`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    authoritativeSource: 'LedgerAI Core Engine',
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Error loading persisted agent chat session:', e);
    }
    return [getInitialWelcomeMessage()];
  });

  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [forceOfflineToggle, setForceOfflineToggle] = useState<boolean>(false);
  const [executionBadge, setExecutionBadge] = useState<
    'ONLINE_GROUNDED' | 'OFFLINE_LOCAL' | 'FAILOVER_OFFLINE'
  >('OFFLINE_LOCAL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected360Record, setSelected360Record] = useState<{
    entityType: string;
    entityId: string;
    entityName: string;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (e) {
      console.error('Error saving agent chat session:', e);
    }
  }, [messages, storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(isOpenStorageKey, String(isOpen));
    } catch (e) {
      console.error('Error saving agent drawer state:', e);
    }
  }, [isOpen, isOpenStorageKey]);

  useEffect(() => {
    if (isOpen && messages.length > 1) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  const quickPrompts = [
    ...(activeScreenKnowledge
      ? [
          {
            label: `Explain: ${activeScreenKnowledge.submoduleName}`,
            query: `Explain this module (${activeScreenKnowledge.submoduleName})`,
          },
        ]
      : []),
    { label: 'Sales & AR Summary', query: 'Show sales invoices and AR' },
    { label: 'AR: October 2026', query: 'Show sales invoices and AR for October 2026' },
    { label: 'AR: February 2026', query: 'Show sales invoices and AR for February 2026' },
    { label: '4th Week of Oct', query: 'Show sales invoices for 4th week of October 2026' },
    { label: 'VAT Payable (2550Q)', query: 'What is my VAT payable under BIR Form 2550Q?' },
    { label: 'Trial Balance Summary', query: 'Show Trial Balance summary' },
  ];

  const handleResetChat = () => {
    const freshWelcome = getInitialWelcomeMessage();
    setMessages([freshWelcome]);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([freshWelcome]));
    } catch {}
  };

  const handleCancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendMessage = async (
    customText?: string,
    overrideDateRange?: ResolvedDateRangeFilter
  ) => {
    const textToSubmit = (customText || inputPrompt).trim();
    if (!textToSubmit || loading) return;

    const effectiveDateFilter = overrideDateRange || resolvedDateRange;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSubmit,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const historyForApi = messages.slice(-6).map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const res = await apiFetch<any>('/api/ai/ledger-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: textToSubmit,
          history: historyForApi,
          forceOffline: forceOfflineToggle,
          activePath: activeScreenPath,
          activeModuleId: activeModuleCtx.activeModuleId,
          activeSubmoduleId: activeModuleCtx.activeSubmoduleId,
          systemPromptContext: activeModuleCtx.systemPromptContext,
          dateRangeFilter: effectiveDateFilter,
        }),
      });

      if (res && (res.answer || res.text)) {
        const mode = res.provenance?.executionMode || (res.isOffline ? 'OFFLINE_LOCAL' : 'ONLINE_GROUNDED');
        setExecutionBadge(mode);
        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          sender: 'agent',
          text: res.answer || res.text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isOffline: res.isOffline,
          citations: res.citations,
          authoritativeSource: res.authoritativeSource,
          warnings: res.warnings,
          suggestedActions: res.suggestedActions,
          pendingAction: res.pendingAction,
          needsReview: res.needsReview,
          provenance: res.provenance,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } else {
        throw new Error(res?.error || 'Unable to connect to Ledger Agent engine.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const errorMsg: ChatMessage = {
        id: `agent-err-${Date.now()}`,
        sender: 'agent',
        isError: true,
        retryPrompt: textToSubmit,
        text: `### ⚠️ Inquiry Refused or Interrupted\n${err.message || 'Unable to complete Ledger Agent query.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleConfirmAction = async (msgId: string, actionId: string, confirmed: boolean) => {
    setActionLoadingId(actionId);
    try {
      const res = await apiFetch<any>('/api/ai/confirm-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, confirmed }),
      });

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msgId && m.pendingAction) {
            return {
              ...m,
              pendingAction: {
                ...m.pendingAction,
                status: confirmed ? 'CONFIRMED' : 'CANCELLED',
              },
            };
          }
          return m;
        })
      );

      const notificationMsg: ChatMessage = {
        id: `action-status-${Date.now()}`,
        sender: 'agent',
        text: confirmed
          ? `✅ **Action Confirmed & Logged**\n${res.message || 'The operation was recorded to the immutable audit trail.'}`
          : `🛑 **Action Cancelled**\nThe proposed operation was aborted. No changes were made.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        authoritativeSource: 'AI Action Safety Guard',
      };
      setMessages((prev) => [...prev, notificationMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `action-err-${Date.now()}`,
        sender: 'agent',
        isError: true,
        text: `### ⚠️ Action Confirmation Error\n${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setActionLoadingId(null);
    }
  };

  const renderInlineContent = (content: string) => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const [, linkText, linkUrl] = match;
      const startIndex = match.index;

      if (startIndex > lastIndex) {
        const textChunk = content.substring(lastIndex, startIndex);
        elements.push(renderBoldText(textChunk));
      }

      const isInternalRoute = linkUrl.startsWith('/') || linkUrl.startsWith('#');
      elements.push(
        <button
          key={`link-${startIndex}`}
          onClick={() => {
            if (isInternalRoute) {
              const cleanPath = linkUrl.replace(/^#/, '');
              navigate(cleanPath);
            }
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 my-0.5 rounded-md text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-all cursor-pointer mx-1"
        >
          <span>{linkText}</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      );

      lastIndex = linkRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      elements.push(renderBoldText(content.substring(lastIndex)));
    }

    return <>{elements}</>;
  };

  const renderBoldText = (textChunk: string) => {
    const boldParts = textChunk.split('**');
    return boldParts.map((part, pIdx) => {
      if (pIdx % 2 === 1) {
        return (
          <strong key={pIdx} className="font-bold text-slate-900 dark:text-slate-100">
            {part}
          </strong>
        );
      }
      // Render single-asterisk italics cleanly (e.g., *"Show sales invoices..."*)
      const italicParts = part.split(/\*([^*\n]+)\*/g);
      return (
        <React.Fragment key={pIdx}>
          {italicParts.map((iPart, iIdx) =>
            iIdx % 2 === 1 ? (
              <em key={iIdx} className="italic text-slate-800 dark:text-slate-200">
                {iPart}
              </em>
            ) : (
              iPart
            )
          )}
        </React.Fragment>
      );
    });
  };

  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed">
        {lines.map((line, idx) => {
          if (line.startsWith('### ')) {
            return (
              <h4 key={idx} className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 mt-1.5 mb-1">
                {renderInlineContent(line.replace('### ', ''))}
              </h4>
            );
          }
          if (line.startsWith('- ') || line.startsWith('* ')) {
            const cleanLine = line.replace(/^[-*]\s+/, '');
            return (
              <div key={idx} className="flex items-start gap-2 pl-1.5 text-slate-700 dark:text-slate-300">
                <span className="text-blue-600 dark:text-sky-400 font-bold">•</span>
                <span>{renderInlineContent(cleanLine)}</span>
              </div>
            );
          }
          if (line.trim() === '') return <div key={idx} className="h-1" />;

          return (
            <p key={idx} className="text-slate-700 dark:text-slate-300">
              {renderInlineContent(line)}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Floating Overlay Button — Positioned above Mobile Bottom Nav on <768px */}
      <div className="fixed bottom-[76px] right-4 md:bottom-5 md:right-5 z-40">
        <button
          onClick={() => setIsOpen(!isOpen)}
          data-testid="open-ledger-agent-btn"
          className={`group relative flex items-center justify-center w-12 h-12 rounded-2xl shadow-lg transition-all duration-200 ${
            isOpen
              ? 'bg-blue-700 text-white scale-95'
              : 'bg-[#0F1C2E] hover:bg-[#172A45] dark:bg-blue-600 dark:hover:bg-blue-500 text-white hover:-translate-y-0.5 active:scale-95'
          } border border-white/15 cursor-pointer`}
          title="Open Ledger Agent AI Assistant"
          aria-label="Open Ledger Agent AI Assistant"
        >
          <div className="relative flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
            <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-teal-400 rounded-full border-2 border-[#0F1C2E] dark:border-blue-700" />
          </div>
        </button>
      </div>

      {/* Interactive Floating Chat Drawer */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex justify-end motion-backdrop-enter"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div
            data-testid="ledger-agent-drawer"
            className="bg-white dark:bg-[#11192B] w-full max-w-lg sm:max-w-[540px] h-full shadow-2xl border-l border-slate-200 dark:border-[#1E2D45] flex flex-col justify-between motion-drawer-right"
          >
            {/* Compact, Vertically Centered Sovereign Header (Zero wasted blank space) */}
            <div className="px-4 py-2.5 bg-[#0F1C2E] text-white flex items-center justify-between gap-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-teal-300" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h3 className="font-display font-bold text-sm text-white truncate leading-tight">
                      Ledger Agent
                    </h3>
                    <span
                      data-testid="ledger-agent-mode-badge"
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap shrink-0 ${
                        forceOfflineToggle || executionBadge === 'OFFLINE_LOCAL'
                          ? 'bg-teal-500/15 text-teal-300 border-teal-500/30'
                          : executionBadge === 'FAILOVER_OFFLINE'
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                      }`}
                    >
                      <Cpu className="w-2.5 h-2.5 shrink-0" />
                      <span>
                        {forceOfflineToggle
                          ? 'Offline'
                          : executionBadge === 'FAILOVER_OFFLINE'
                          ? 'Local Fallback'
                          : executionBadge === 'OFFLINE_LOCAL'
                          ? 'Local Engine'
                          : 'Online'}
                      </span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300/85 flex items-center gap-1 truncate mt-0.5 leading-none">
                    <Database className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                    <span className="truncate">{companyDisplayName}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setForceOfflineToggle((prev) => !prev)}
                  data-testid="toggle-offline-agent-btn"
                  className={`px-2 py-1 rounded-lg text-[10px] font-semibold border whitespace-nowrap transition-colors cursor-pointer ${
                    forceOfflineToggle
                      ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                      : 'bg-white/5 text-slate-200 border-white/15 hover:bg-white/10 hover:text-white'
                  }`}
                  title="Toggle Local Offline Execution Mode"
                >
                  {forceOfflineToggle ? 'Offline Lock' : 'Auto'}
                </button>

                <button
                  type="button"
                  onClick={handleResetChat}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Reset Chat Session"
                  aria-label="Reset Chat Session"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Close Assistant"
                  aria-label="Close Assistant"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Slim Single-Line Role & Accuracy Scope Strip */}
            <div
              className={`px-4 py-1.5 border-b flex items-center justify-between gap-2 text-[11px] shrink-0 ${
                isOwner
                  ? 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-200/70 dark:border-amber-900/40 text-amber-900 dark:text-amber-200'
                  : isAdmin
                  ? 'bg-blue-50/70 dark:bg-blue-950/25 border-blue-200/70 dark:border-blue-900/40 text-blue-900 dark:text-sky-200'
                  : 'bg-slate-50 dark:bg-[#0D1524] border-slate-200/80 dark:border-[#1E2D45] text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium min-w-0 truncate">
                {isOwner ? (
                  <>
                    <Crown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="truncate">
                      <strong>Company Owner</strong> · Full Scope
                    </span>
                  </>
                ) : isAdmin ? (
                  <>
                    <Shield className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                    <span className="truncate">
                      <strong>Administrator</strong> · Operations Scope
                    </span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">
                      <strong>{roleTitle}</strong> · Assigned Scope
                    </span>
                  </>
                )}
              </div>
              <span className="text-[10px] font-mono font-semibold text-teal-700 dark:text-teal-400 whitespace-nowrap shrink-0">
                GL-Grounded
              </span>
            </div>

            {/* Compact Unified Context + Period Controls */}
            <div
              data-testid="active-screen-knowledge-banner"
              className="px-3.5 py-2 bg-slate-50/80 dark:bg-[#0D1524]/90 border-b border-slate-200/80 dark:border-[#1E2D45] space-y-2 text-[11px] shrink-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 min-w-0 flex-1">
                  <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                  {activeModuleCtx.siblingSubmodules.length > 1 ? (
                    <select
                      aria-label="Active Sub-Module Context"
                      data-testid="ledger-agent-submodule-select"
                      value={activeModuleCtx.activeSubmoduleId}
                      onChange={(e) => activeModuleCtx.setActiveSubmoduleOverride(e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-slate-800 dark:text-slate-100 text-[11px] font-semibold focus:outline-none focus:border-blue-600 cursor-pointer truncate"
                    >
                      {activeModuleCtx.siblingSubmodules.map((sub) => (
                        <option key={sub.submoduleId} value={sub.submoduleId}>
                          {sub.submoduleName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                      {activeModuleCtx.activeSubmoduleName || activeModuleCtx.activeModuleName}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage(
                      `Explain this module (${activeModuleCtx.activeSubmoduleName})`
                    )
                  }
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  Explain Module
                </button>
              </div>

              {/* Date-Range Selector Row */}
              <div
                data-testid="ledger-agent-date-range-bar"
                className="flex items-center justify-between gap-2 flex-wrap"
              >
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-semibold min-w-0 flex-1">
                  <Calendar className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  <select
                    aria-label="LedgerAI Date-Range Selector"
                    data-testid="ledger-agent-date-range-select"
                    value={selectedDatePreset}
                    onChange={(e) => setSelectedDatePreset(e.target.value)}
                    className="flex-1 min-w-[140px] max-w-[230px] px-2 py-1 rounded-lg bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-slate-800 dark:text-slate-100 text-[11px] font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
                  >
                    {LEDGER_AGENT_DATE_RANGE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    data-testid="ledger-agent-active-date-badge"
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] border whitespace-nowrap ${
                      resolvedDateRange.hasFilter
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300 border-blue-200 dark:border-blue-800 font-semibold'
                        : 'bg-white dark:bg-[#162238] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-[#24344F]'
                    }`}
                  >
                    {resolvedDateRange.hasFilter
                      ? `${resolvedDateRange.startDate} → ${resolvedDateRange.endDate}`
                      : 'All Periods'}
                  </span>
                  {resolvedDateRange.hasFilter && (
                    <button
                      type="button"
                      data-testid="ledger-agent-reset-date-range-btn"
                      onClick={() => setSelectedDatePreset('ALL')}
                      className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#1B2942] hover:bg-slate-300 dark:hover:bg-[#243656] text-slate-700 dark:text-slate-200 text-[10px] font-semibold cursor-pointer"
                      title="Reset Date Filter to All Periods"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {selectedDatePreset === 'CUSTOM' && (
                <div
                  data-testid="ledger-agent-custom-date-inputs"
                  className="flex items-center gap-2 pt-0.5 flex-wrap"
                >
                  <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                    <span>From:</span>
                    <input
                      type="date"
                      data-testid="ledger-agent-date-start"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="px-2 py-0.5 rounded-md bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-slate-800 dark:text-slate-100 text-[11px] font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                    <span>To:</span>
                    <input
                      type="date"
                      data-testid="ledger-agent-date-end"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="px-2 py-0.5 rounded-md bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-slate-800 dark:text-slate-100 text-[11px] font-mono"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Single-Row Horizontally Scrollable Quick Prompts & Shortcuts */}
            <div className="px-3.5 py-1.5 bg-white dark:bg-[#11192B] border-b border-slate-200/80 dark:border-[#1E2D45] shrink-0 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
              <Compass className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
              {quickPrompts.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(item.query)}
                  className="px-2.5 py-1 bg-slate-50 dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] hover:border-blue-500 dark:hover:border-sky-400 hover:bg-blue-50/60 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
              <span className="h-4 w-px bg-slate-200 dark:bg-[#24344F] shrink-0 mx-0.5" aria-hidden="true" />
              {systemModules.map((mod, idx) => {
                const IconComponent = mod.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      navigate(mod.path);
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-slate-50 dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] hover:border-teal-500 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                    title={`Jump to ${mod.name}`}
                  >
                    <IconComponent className="w-3 h-3 text-teal-600 dark:text-teal-400 shrink-0" />
                    <span>{mod.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Chat Messages Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'agent' && (
                    <div className="w-7 h-7 rounded-xl bg-[#0F1C2E] dark:bg-blue-600 text-teal-300 dark:text-white flex items-center justify-center shrink-0 mt-0.5 border border-white/10">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div
                    className={`max-w-[88%] rounded-2xl p-3.5 shadow-2xs ${
                      msg.sender === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-slate-50/90 dark:bg-[#162238] border border-slate-200/80 dark:border-[#24344F] text-slate-800 dark:text-slate-100 rounded-bl-sm'
                    }`}
                  >
                    {msg.sender === 'user' ? (
                      <p className="text-xs sm:text-sm font-medium leading-relaxed">{msg.text}</p>
                    ) : (
                      <>
                        {renderFormattedText(msg.text)}

                        {/* Retry button if error */}
                        {msg.isError && msg.retryPrompt && (
                          <div className="mt-2.5">
                            <button
                              onClick={() => handleSendMessage(msg.retryPrompt)}
                              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                            >
                              Retry Inquiry
                            </button>
                          </div>
                        )}

                        {/* Source Records 360° Drill-Down Links */}
                        {msg.provenance?.sourceRecords && msg.provenance.sourceRecords.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700/80 space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <Layers className="w-3 h-3 text-indigo-500" /> Source Records (Click for 360° Inspection):
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {msg.provenance.sourceRecords.map((sr, sIdx) => (
                                <button
                                  key={sIdx}
                                  onClick={() =>
                                    setSelected360Record({
                                      entityType: sr.entityType,
                                      entityId: sr.entityId,
                                      entityName: sr.recordReference || sr.label,
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  <span>{sr.label}</span>
                                  {sr.amountFormatted && (
                                    <span className="font-mono text-[10px] opacity-80">
                                      ({sr.amountFormatted})
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Enterprise Provenance & Citations Footer */}
                        {(msg.provenance ||
                          msg.authoritativeSource ||
                          (msg.citations && msg.citations.length > 0)) && (
                          <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700/80 space-y-1.5 text-[11px]">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              {msg.authoritativeSource && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Source: {msg.authoritativeSource}</span>
                                </span>
                              )}

                              <button
                                onClick={() => handleCopyMessage(msg.id, msg.text)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] hover:bg-slate-300 cursor-pointer"
                                title="Copy response"
                              >
                                {copiedId === msg.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-500" /> Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" /> Copy
                                  </>
                                )}
                              </button>
                            </div>

                            {msg.provenance && (
                              <div
                                data-testid="message-provenance-block"
                                className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/60 p-2 rounded-lg space-y-0.5"
                              >
                                <div>
                                  Engine: <strong>{msg.provenance.engineUsed}</strong> • Mode:{' '}
                                  <strong>{msg.provenance.executionMode}</strong>
                                </div>
                                <div>
                                  Period: {msg.provenance.reportingPeriod} • Tables:{' '}
                                  {(msg.provenance.dataSource || []).join(', ')}
                                </div>
                                {msg.provenance.activeModuleContext && (
                                  <div>
                                    Active Module Context:{' '}
                                    <strong>
                                      {msg.provenance.activeModuleContext.moduleName} →{' '}
                                      {msg.provenance.activeModuleContext.submoduleName}
                                    </strong>
                                  </div>
                                )}
                                {msg.provenance.dateRangeFilter &&
                                  msg.provenance.dateRangeFilter.hasFilter && (
                                    <div>
                                      Date-Range Scope:{' '}
                                      <strong>
                                        {msg.provenance.dateRangeFilter.label}
                                      </strong>
                                    </div>
                                  )}
                                {msg.provenance.failoverOccurred && msg.provenance.failoverReason && (
                                  <div className="text-amber-600 dark:text-amber-400">
                                    Failover: {msg.provenance.failoverReason}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Warnings if present */}
                        {msg.warnings && msg.warnings.length > 0 && (
                          <div className="mt-2.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              {msg.warnings.map((w, wIdx) => (
                                <p key={wIdx}>{w}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Interactive Pending Action Card (WRITE or HIGH-RISK Confirmation) */}
                        {msg.pendingAction && (
                          <div className="mt-3 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-indigo-600" /> Action Proposal
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  msg.pendingAction.riskLevel === 'HIGH_MUTATION'
                                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300'
                                    : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
                                }`}
                              >
                                {msg.pendingAction.riskLevel === 'HIGH_MUTATION'
                                  ? 'High-Risk Operation'
                                  : 'Mutation Proposal'}
                              </span>
                            </div>

                            <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                              {msg.pendingAction.description}
                            </p>

                            {msg.pendingAction.warningMessage && (
                              <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/60 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                                {msg.pendingAction.warningMessage}
                              </p>
                            )}

                            {msg.pendingAction.status === 'CONFIRMED' ? (
                              <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 pt-1">
                                <CheckCircle2 className="w-4 h-4" /> Action Confirmed & Recorded
                              </div>
                            ) : msg.pendingAction.status === 'CANCELLED' ? (
                              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 pt-1">
                                <X className="w-4 h-4" /> Action Cancelled
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() =>
                                    handleConfirmAction(msg.id, msg.pendingAction!.actionId, true)
                                  }
                                  disabled={actionLoadingId === msg.pendingAction.actionId}
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                                >
                                  {actionLoadingId === msg.pendingAction.actionId
                                    ? 'Processing...'
                                    : 'Confirm Action'}
                                </button>
                                <button
                                  onClick={() =>
                                    handleConfirmAction(msg.id, msg.pendingAction!.actionId, false)
                                  }
                                  disabled={actionLoadingId === msg.pendingAction.actionId}
                                  className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-medium transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Suggested Action Pills */}
                        {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {msg.suggestedActions.map((act, aIdx) => (
                              <button
                                key={aIdx}
                                onClick={() => handleSendMessage(act.label)}
                                className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                              >
                                {act.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    <span
                      className={`block text-[10px] mt-2 font-mono ${
                        msg.sender === 'user' ? 'text-indigo-200 text-right' : 'text-slate-400'
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>

                  {msg.sender === 'user' && (
                    <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Bot className="w-4 h-4 animate-spin" />
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 rounded-bl-none flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                      Analyzing General Ledger & Philippine Tax Engine...
                    </span>
                    <button
                      onClick={handleCancelRequest}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold cursor-pointer"
                    >
                      <StopCircle className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input Footer */}
            <div className="p-3.5 bg-white dark:bg-[#11192B] border-t border-slate-200 dark:border-[#1E2D45] shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  data-testid="ledger-agent-input"
                  placeholder="Ask about your accounting, tax compliance, or financial records..."
                  className="flex-1 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600 dark:focus:border-sky-400"
                />
                <button
                  type="submit"
                  disabled={loading || !inputPrompt.trim()}
                  data-testid="ledger-agent-send-btn"
                  className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-45 shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 360° Record Activity Modal launched from chat provenance */}
      {selected360Record && (
        <RecordActivityModal
          isOpen={true}
          onClose={() => setSelected360Record(null)}
          entityType={selected360Record.entityType}
          entityId={selected360Record.entityId}
          title={selected360Record.entityName}
        />
      )}
    </>
  );
}
