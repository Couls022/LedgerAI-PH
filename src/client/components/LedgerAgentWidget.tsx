import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Bot, Sparkles, Send, X, RefreshCw, User, HelpCircle, 
  ShieldCheck, Database, Compass, RotateCcw, Shield, Crown, UserCheck,
  ExternalLink, ArrowRight, LayoutDashboard, ShoppingBag, BookOpen, 
  FileCheck, Folder, BarChart3, Calculator, Settings, Users,
  CheckCircle2, AlertTriangle, AlertCircle, Info, Zap
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';

export interface PendingActionProposal {
  actionId: string;
  actionType: string;
  description: string;
  riskLevel: 'READ_ONLY' | 'LOW_MUTATION' | 'HIGH_MUTATION';
  payload: Record<string, any>;
  warningMessage?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  isOffline?: boolean;
  citations?: string[];
  authoritativeSource?: string;
  warnings?: string[];
  suggestedActions?: Array<{ label: string; action: string; params?: Record<string, any> }>;
  pendingAction?: PendingActionProposal;
  needsReview?: boolean;
}

const systemModules = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Operations', path: '/operations', icon: ShoppingBag },
  { name: 'Accounts & GL', path: '/accounting', icon: BookOpen },
  { name: 'BIR Tax & Forms', path: '/tax', icon: FileCheck },
  { name: 'Documents', path: '/documents', icon: Folder },
  { name: 'Reports', path: '/reports', icon: BarChart3 },
  { name: 'Budget', path: '/budget', icon: Calculator },
  { name: 'Audit & Logs', path: '/audit', icon: ShieldCheck },
  { name: 'Master Data', path: '/master-data', icon: Users },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export default function LedgerAgentWidget() {
  const navigate = useNavigate();
  const { user, activeCompany, userRole } = useAuth();
  const companyDisplayName = activeCompany?.legalName || activeCompany?.tradeName || (activeCompany as any)?.name || 'Active Company';
  const companyId = activeCompany?.id || 'default';

  // Role Determination for RBAC
  const normalizedRole = (userRole || 'Company Owner').toLowerCase();
  const isOwner = normalizedRole.includes('owner');
  const isAdmin = normalizedRole.includes('admin');
  const roleTitle = isOwner ? 'Company Owner' : isAdmin ? 'Administrator' : userRole || 'Staff User';

  // Session Storage Keys for persistence across navigation routes
  const storageKey = `ledger_agent_chat_${companyId}_${user?.id || 'guest'}`;
  const isOpenStorageKey = `ledger_agent_is_open_${companyId}`;

  // Persisted Drawer State
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(isOpenStorageKey) === 'true';
    } catch {
      return false;
    }
  });

  const getInitialWelcomeMessage = (): ChatMessage => ({
    id: 'welcome-agent',
    sender: 'agent',
    text: `### Kumusta! I'm **Ledger Agent** 🤖✨
Your Philippine AI Accounting, BIR Tax & Business Intelligence Assistant for **${companyDisplayName}**.

I answer questions in **English**, **Filipino**, or **Taglish** with zero hallucinations, backed directly by your General Ledger, Philippine Tax Engine, and Compliance Rule Engine.

You can ask me questions like:
- *"Magkano kinita ko this month?"*
- *"May utang ba si Juan?"*
- *"Magkano VAT ko?"*
- *"May problema ba sa books ko?"*
- *"Why did expenses increase?"*
- *"Kailan deadline ng filing?"*

How can I assist you today?`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    authoritativeSource: 'LedgerAI Core Engine'
  });

  // Persisted Messages State
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
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Save messages to sessionStorage on change
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (e) {
      console.error('Error saving agent chat session:', e);
    }
  }, [messages, storageKey]);

  // Save drawer open state to sessionStorage on change
  useEffect(() => {
    try {
      sessionStorage.setItem(isOpenStorageKey, String(isOpen));
    } catch (e) {
      console.error('Error saving agent drawer state:', e);
    }
  }, [isOpen, isOpenStorageKey]);

  useEffect(() => {
    if (isOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  const quickPrompts = [
    { label: "Magkano kinita ko this month?", query: "Magkano kinita ko this month?" },
    { label: "May utang ba mga customer?", query: "Show unpaid customer invoices and accounts receivable" },
    { label: "Magkano VAT ko?", query: "Magkano VAT ko under BIR Form 2550Q?" },
    { label: "May problema ba sa books ko?", query: "May problema ba sa books ko? Check compliance and missing receipts." },
    { label: "Why did expenses increase?", query: "Why did expenses increase? Perform financial analytics and trend breakdown." },
    { label: "Kailan deadline ng filing?", query: "Kailan deadline ng filing? Show upcoming BIR tax deadlines." },
  ];

  const handleResetChat = () => {
    const freshWelcome = getInitialWelcomeMessage();
    setMessages([freshWelcome]);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([freshWelcome]));
    } catch {}
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSubmit = (customText || inputPrompt).trim();
    if (!textToSubmit || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSubmit,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setLoading(true);

    try {
      const historyForApi = messages.slice(-6).map(m => ({
        sender: m.sender,
        text: m.text
      }));

      const res = await apiFetch('/api/ai/ledger-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToSubmit,
          history: historyForApi
        })
      });

      if (res && (res.answer || res.text)) {
        setIsOfflineMode(!!res.isOffline);
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
        };
        setMessages(prev => [...prev, agentMsg]);
      } else {
        throw new Error(res?.error || 'Unable to connect to Ledger Agent engine.');
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `agent-err-${Date.now()}`,
        sender: 'agent',
        text: `### ⚠️ Error\n${err.message || 'Retrying connection to Ledger Agent server.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async (msgId: string, actionId: string, confirmed: boolean) => {
    setActionLoadingId(actionId);
    try {
      const res = await apiFetch('/api/ai/confirm-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, confirmed })
      });

      setMessages(prev => prev.map(m => {
        if (m.id === msgId && m.pendingAction) {
          return {
            ...m,
            pendingAction: {
              ...m.pendingAction,
              status: confirmed ? 'CONFIRMED' : 'CANCELLED'
            }
          };
        }
        return m;
      }));

      const notificationMsg: ChatMessage = {
        id: `action-status-${Date.now()}`,
        sender: 'agent',
        text: confirmed 
          ? `✅ **Action Confirmed & Executed**\n${res.message || 'The operation was safely committed and recorded to the immutable audit trail.'}`
          : `🛑 **Action Cancelled**\nThe proposed operation was aborted. No changes were made.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        authoritativeSource: 'AI Action Safety Guard'
      };
      setMessages(prev => [...prev, notificationMsg]);
    } catch (err: any) {
      alert(`Action confirmation failed: ${err.message}`);
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
      const [fullMatch, linkText, linkUrl] = match;
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
            } else {
              window.open(linkUrl, '_blank');
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
    const parts = textChunk.split('**');
    return parts.map((part, pIdx) =>
      pIdx % 2 === 1 ? (
        <strong key={pIdx} className="font-bold text-slate-900 dark:text-slate-100">
          {part}
        </strong>
      ) : (
        part
      )
    );
  };

  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed">
        {lines.map((line, idx) => {
          if (line.startsWith('### ')) {
            return (
              <h4 key={idx} className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-2 mb-1">
                {line.replace('### ', '')}
              </h4>
            );
          }
          if (line.startsWith('- ') || line.startsWith('* ')) {
            const cleanLine = line.replace(/^[-*]\s+/, '');
            return (
              <div key={idx} className="flex items-start gap-2 pl-2 text-slate-700 dark:text-slate-300">
                <span className="text-indigo-500 font-bold">•</span>
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
      {/* Floating Overlay Button Fixed at Bottom Right */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`group relative flex items-center justify-center p-3.5 rounded-2xl shadow-2xl transition-all duration-300 ${
            isOpen 
              ? 'bg-indigo-700 text-white scale-95' 
              : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-500 hover:to-purple-600 text-white hover:scale-105 active:scale-95'
          } border border-indigo-400/40 ring-4 ring-indigo-500/20 cursor-pointer`}
          title="Open Ledger Agent AI Assistant"
          aria-label="Open Ledger Agent AI Assistant"
        >
          <div className="relative">
            <div className="p-1 bg-white/20 rounded-xl">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-indigo-900"></span>
          </div>
        </button>
      </div>

      {/* Interactive Floating Chat Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg sm:max-w-xl h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col justify-between animate-in slide-in-from-right duration-300">
            
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-950 text-white flex items-center justify-between border-b border-indigo-900 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-600/30 rounded-2xl text-indigo-300 border border-indigo-400/30 shadow-inner">
                  <Bot className="w-6 h-6 text-indigo-300" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                    Ledger Agent 
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">AI Assistant</span>
                    {isOfflineMode && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                        <Database className="w-3 h-3" /> Offline Mode
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-indigo-200/80 flex items-center gap-1 mt-0.5">
                    <Database className="w-3 h-3 text-indigo-400" /> {companyDisplayName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleResetChat}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Reset Chat Session"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close Assistant"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Role-based RBAC Banner */}
            <div className={`px-4 py-2 border-b flex items-center justify-between text-xs shrink-0 ${
              isOwner 
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-900 dark:text-amber-200' 
                : isAdmin 
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-900 dark:text-blue-200' 
                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}>
              <div className="flex items-center gap-2 font-medium text-[11px]">
                {isOwner ? (
                  <>
                    <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>Role: <strong>Company Owner</strong> (Unrestricted Scope)</span>
                  </>
                ) : isAdmin ? (
                  <>
                    <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>Role: <strong>Administrator</strong> (Operations & Master Data Scope)</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Role: <strong>{roleTitle}</strong> (Assigned Tasks Scope)</span>
                  </>
                )}
              </div>
              <span className="text-[10px] font-mono opacity-80 uppercase tracking-wider">Zero-Hallucination Guard</span>
            </div>

            {/* Quick Prompts Bar */}
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-center gap-2 overflow-x-auto text-xs no-scrollbar">
              <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="font-semibold text-slate-600 dark:text-slate-400 shrink-0 text-[11px]">Quick Prompts:</span>
              {quickPrompts.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(item.query)}
                  className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-medium transition-all shrink-0 hover:shadow-xs whitespace-nowrap cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Quick System Modules Navigation Strip */}
            <div className="px-4 py-2 bg-indigo-950/20 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
              <span className="font-bold text-indigo-600 dark:text-indigo-400 shrink-0 text-[10px] tracking-wide uppercase mr-1">Modules:</span>
              {systemModules.map((mod, idx) => {
                const IconComponent = mod.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => navigate(mod.path)}
                    className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-semibold transition-all shrink-0 cursor-pointer shadow-2xs"
                    title={`Jump to ${mod.name}`}
                  >
                    <IconComponent className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span>{mod.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Chat Messages Body */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'agent' && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div className={`max-w-[88%] rounded-2xl p-4 shadow-xs ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none'
                  }`}>
                    {msg.sender === 'user' ? (
                      <p className="text-xs sm:text-sm font-medium leading-relaxed">{msg.text}</p>
                    ) : (
                      <>
                        {renderFormattedText(msg.text)}

                        {/* Authoritative Source Badge & Citations */}
                        {(msg.authoritativeSource || (msg.citations && msg.citations.length > 0)) && (
                          <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center gap-1.5 text-[11px]">
                            {msg.authoritativeSource && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Source: {msg.authoritativeSource}</span>
                              </span>
                            )}
                            {msg.citations?.map((cit, cIdx) => (
                              <span key={cIdx} className="px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px]">
                                {cit}
                              </span>
                            ))}
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
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                msg.pendingAction.riskLevel === 'HIGH_MUTATION'
                                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300'
                                  : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
                              }`}>
                                {msg.pendingAction.riskLevel === 'HIGH_MUTATION' ? 'High-Risk Operation' : 'Mutation Proposal'}
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
                                  onClick={() => handleConfirmAction(msg.id, msg.pendingAction!.actionId, true)}
                                  disabled={actionLoadingId === msg.pendingAction.actionId}
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                                >
                                  {actionLoadingId === msg.pendingAction.actionId ? 'Processing...' : 'Confirm Action'}
                                </button>
                                <button
                                  onClick={() => handleConfirmAction(msg.id, msg.pendingAction!.actionId, false)}
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

                    <span className={`block text-[10px] mt-2 font-mono ${
                      msg.sender === 'user' ? 'text-indigo-200 text-right' : 'text-slate-400'
                    }`}>
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
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 rounded-bl-none flex items-center gap-2 text-xs text-slate-500">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" /> Analyzing General Ledger & Philippine Tax Engine...
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input Footer */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
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
                  placeholder="Ask in English, Filipino or Taglish..."
                  className="flex-1 px-4 py-3 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={loading || !inputPrompt.trim()}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
