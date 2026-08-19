import React, { useState, useEffect } from 'react';
import { Mail, Server, Lock, User, CheckCircle2, Save, Send, Eye, X } from 'lucide-react';

export default function EmailSettings() {
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [useSsl, setUseSsl] = useState(false);
  const [senderEmail, setSenderEmail] = useState('');
  const [subjectTemplate, setSubjectTemplate] = useState('LedgerAI Backup Notification - {{STATUS}}');
  const [bodyTemplate, setBodyTemplate] = useState('A local backup was completed on {{TIMESTAMP}}.\nStatus: {{STATUS}}');
  
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const previewTimestamp = new Date().toLocaleString();
  const previewStatus = "SUCCESS";
  
  const renderedSubject = subjectTemplate
    ? subjectTemplate.replace(/\{\{TIMESTAMP\}\}/g, previewTimestamp).replace(/\{\{STATUS\}\}/g, previewStatus)
    : '';
    
  const renderedBody = bodyTemplate
    ? bodyTemplate.replace(/\{\{TIMESTAMP\}\}/g, previewTimestamp).replace(/\{\{STATUS\}\}/g, previewStatus)
    : '';

  useEffect(() => {
    // Load from local storage for now (simulating API fetch)
    try {
      const stored = localStorage.getItem('smtp_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        setSmtpHost(parsed.host || '');
        setSmtpPort(parsed.port || '587');
        setSmtpUser(parsed.user || '');
        setSmtpPass(parsed.pass || '');
        setUseSsl(parsed.ssl || false);
        setSenderEmail(parsed.sender || '');
        if (parsed.subjectTemplate) setSubjectTemplate(parsed.subjectTemplate);
        if (parsed.bodyTemplate) setBodyTemplate(parsed.bodyTemplate);
      }
    } catch (e) {
      console.warn('Failed to load SMTP settings from local storage:', e);
    }
  }, []);

  const validateForm = () => {
    if (!smtpHost.trim()) return 'SMTP Host is required.';
    if (!/^[\w.-]+$/.test(smtpHost.trim())) return 'SMTP Host contains invalid characters.';
    
    if (!smtpPort.trim()) return 'SMTP Port is required.';
    const portNum = parseInt(smtpPort, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) return 'SMTP Port must be a valid number between 1 and 65535.';
    
    if (!smtpUser.trim()) return 'SMTP Username is required.';
    if (!smtpPass) return 'SMTP Password is required.';
    
    if (senderEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail.trim())) {
      return 'Sender Email Address is not a valid email format.';
    }
    
    if (!subjectTemplate.trim()) return 'Subject Template is required.';
    if (!bodyTemplate.trim()) return 'Message Body Template is required.';
    
    return null;
  };

  const handleSave = () => {
    const errorMsg = validateForm();
    if (errorMsg) {
      setMessage({ type: 'error', text: errorMsg });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    
    // Simulate API call
    setTimeout(() => {
      localStorage.setItem('smtp_settings', JSON.stringify({
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        pass: smtpPass,
        ssl: useSsl,
        sender: senderEmail,
        subjectTemplate,
        bodyTemplate
      }));
      setIsSaving(false);
      setMessage({ type: 'success', text: 'SMTP server configuration saved successfully.' });
      setTimeout(() => setMessage(null), 3000);
    }, 800);
  };

  const handleTest = async () => {
    const errorMsg = validateForm();
    if (errorMsg) {
      setMessage({ type: 'error', text: errorMsg });
      return;
    }
    
    setIsTesting(true);
    setMessage(null);
    
    try {
      const res = await fetch('/api/settings/test-smtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          ssl: useSsl,
          sender: senderEmail,
          subjectTemplate,
          bodyTemplate
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setMessage({ type: 'success', text: 'Test email sent successfully! Connection is working.' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to connect to SMTP server.' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: 'A network error occurred while testing the connection.' });
    } finally {
      setIsTesting(false);
      setTimeout(() => setMessage(null), 8000);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-8">
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
        <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
          <Mail className="w-5 h-5 text-violet-600 dark:text-violet-400" /> Email Notifications & SMTP Server
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Configure the outgoing mail server (SMTP) used for system notifications, backup alerts, and automated reports.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-center gap-2 text-sm font-bold shadow-sm ${
          message.type === 'success' 
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400' 
            : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400'
        }`}>
          <CheckCircle2 className="w-4 h-4" />
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">SMTP Host</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Server className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="smtp.example.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">SMTP Port</label>
            <input
              type="text"
              placeholder="587, 465, or 25"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">SMTP Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="user@example.com"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">SMTP Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="password"
                placeholder="••••••••••••"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Sender Email Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="noreply@example.com"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium"
              />
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">The "From" address used in the emails sent by the system.</p>
          </div>

          <div className="flex items-center pt-6">
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={useSsl}
                onChange={(e) => setUseSsl(e.target.checked)}
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-violet-600"></div>
              <span className="ml-3 text-sm font-bold text-slate-700 dark:text-slate-300">
                Require SSL/TLS Encryption
              </span>
            </label>
          </div>
        </div>
        
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6 space-y-6">
          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              Notification Templates
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize the email subject and body. Available placeholders: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-violet-600 dark:text-violet-400 font-mono">{"{{TIMESTAMP}}"}</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-violet-600 dark:text-violet-400 font-mono">{"{{STATUS}}"}</code>
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Subject Line</label>
              <input
                type="text"
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                placeholder="Backup Alert: {{STATUS}}"
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Message Body</label>
              <textarea
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                placeholder={"System backup completed at {{TIMESTAMP}}.\nStatus: {{STATUS}}"}
                rows={4}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 dark:text-slate-100 font-medium resize-y"
              />
            </div>

            <div className="flex justify-end mt-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                {showPreview ? 'Hide Preview' : 'Preview Email'}
              </button>
            </div>
            
            {showPreview && (
              <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-top-2">
                <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mb-1">Subject:</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{renderedSubject}</div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mb-2">Message:</div>
                  <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-100 dark:border-slate-800">
                    {renderedBody}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all disabled:opacity-70"
        >
          {isSaving ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save SMTP Configuration
        </button>

        <button
          onClick={handleTest}
          disabled={isTesting || isSaving}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-bold shadow-sm transition-all disabled:opacity-70"
        >
          {isTesting ? (
            <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
          ) : (
            <Send className="w-4 h-4" />
          )}
          Test Connection
        </button>
      </div>
    </div>
  );
}
