import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, X, Bot, User, RefreshCw, 
  ChevronRight, ArrowRight, Lightbulb, ShieldCheck, HelpCircle, FileText
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
}

interface FinancialInsightChatProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenReminders?: () => void;
}

export default function FinancialInsightChat({
  isOpen,
  onClose,
  onOpenReminders
}: FinancialInsightChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'ai',
      text: `### Hello! I'm your Gemini Financial Insight Advisor 📊
I can analyze your live accounting ledger, BIR VAT tax estimates, receivables, and operating expenses.

How can I assist your business analysis today?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  if (!isOpen) return null;

  const suggestedPrompts = [
    "Summarize our current cashflow & liquidity status",
    "Which client invoices are overdue and total owed?",
    "Estimate our BIR VAT & EWT tax liability for this month",
    "How can we optimize our net profit margin?"
  ];

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSubmit = (customPrompt || inputPrompt).trim();
    if (!textToSubmit || loading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: textToSubmit,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setLoading(true);

    try {
      // Step 1: Route Intent
      const routeRes = await fetch('/api/ai/route-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('ledgerai_token') || ''}` },
        body: JSON.stringify({ prompt: textToSubmit })
      });

      const routeData = await routeRes.json();

      if (!routeRes.ok) {
        throw new Error(routeData.message || routeData.error || "Failed to analyze intent");
      }

      if (routeData.requiresConfirmation) {
        throw new Error("Action requires confirmation, which is not supported in this view yet.");
      }

      // Step 2: Execute Skill
      const execRes = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('ledgerai_token') || ''}` },
        body: JSON.stringify({
          skillId: routeData.skillId,
          input: { ...routeData.extractedParameters, query: textToSubmit },
          contextParams: {} // optional context
        })
      });

      const execData = await execRes.json();

      if (execRes.ok && execData.answer) {
        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: execData.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, aiMsg]);
      } else {
        throw new Error(execData.message || execData.error || "Failed to generate financial insight");
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `ai-err-${Date.now()}`,
        sender: 'ai',
        text: `### ⚠️ AI Processing Error\n${err.message || 'Unable to connect to financial analysis engine.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-2 leading-relaxed text-xs sm:text-sm">
        {lines.map((line, idx) => {
          if (line.startsWith('### ')) {
            return (
              <h4 key={idx} className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 mt-2 mb-1 flex items-center gap-1.5">
                {line.replace('### ', '')}
              </h4>
            );
          }
          if (line.startsWith('- ')) {
            const parts = line.replace('- ', '').split('**');
            return (
              <div key={idx} className="flex items-start gap-2 pl-2 text-slate-700 dark:text-slate-300">
                <span className="text-indigo-500 font-bold">•</span>
                <span>
                  {parts.map((part, pIdx) => (
                    pIdx % 2 === 1 ? <strong key={pIdx} className="font-extrabold text-slate-900 dark:text-slate-100">{part}</strong> : part
                  ))}
                </span>
              </div>
            );
          }
          if (line.trim() === '') return <div key={idx} className="h-1" />;
          
          const parts = line.split('**');
          return (
            <p key={idx} className="text-slate-700 dark:text-slate-300">
              {parts.map((part, pIdx) => (
                pIdx % 2 === 1 ? <strong key={pIdx} className="font-extrabold text-slate-900 dark:text-slate-100">{part}</strong> : part
              ))}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end">
      <div className="bg-white dark:bg-slate-900 w-full max-w-xl h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col justify-between animate-in slide-in-from-right duration-300">
        
        {/* Chat Drawer Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-900 via-slate-900 to-slate-900 text-white flex items-center justify-between border-b border-indigo-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/30 rounded-xl text-indigo-300 border border-indigo-400/30">
              <Sparkles className="w-5 h-5 text-indigo-300 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                Gemini Financial Insight AI
              </h3>
              <p className="text-xs text-indigo-200/80">
                Natural language analysis powered by @google/genai
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Suggested Prompts Header Bar */}
        <div className="px-6 py-3 bg-indigo-50/60 dark:bg-slate-800/80 border-b border-indigo-100 dark:border-slate-800 shrink-0 flex items-center gap-2 overflow-x-auto text-xs">
          <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">Quick Queries:</span>
          <div className="flex items-center gap-2 shrink-0">
            {suggestedPrompts.slice(0, 2).map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(prompt)}
                className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 hover:border-indigo-400 text-indigo-700 dark:text-indigo-300 rounded-lg text-[11px] font-medium transition-all shrink-0 hover:shadow-xs"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Chat Messages Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'ai' && (
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div className={`max-w-[85%] rounded-2xl p-4 shadow-xs ${
                msg.sender === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none'
                  : 'bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none'
              }`}>
                {msg.sender === 'user' ? (
                  <p className="text-xs sm:text-sm font-medium leading-relaxed">{msg.text}</p>
                ) : (
                  renderFormattedText(msg.text)
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
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" /> Analyzing live ledger accounts & BIR tax rules...
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Quick Action Suggestion Chips */}
        {onOpenReminders && (
          <div className="px-6 py-2 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Need to collect pending receivables?
            </span>
            <button
              onClick={() => {
                onClose();
                onOpenReminders();
              }}
              className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 text-[11px]"
            >
              Open Overdue Reminders <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

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
              placeholder="Ask Gemini about revenue, BIR taxes, overdue invoices..."
              className="flex-1 px-4 py-3 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading || !inputPrompt.trim()}
              className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
