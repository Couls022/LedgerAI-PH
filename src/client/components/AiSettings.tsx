import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Save,
  Loader2,
  Key,
  Trash2,
  Plus,
  RefreshCw,
  Cpu,
  Layers,
  ShieldCheck,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Power,
  Lock,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

export interface CustomKeyItem {
  id: string;
  name: string;
  provider: 'gemini' | 'openai' | 'grok';
  modelId?: string;
  apiKey?: string;
  maskedKey?: string;
  enabled?: boolean;
  priorityOrder?: number;
  roleDesignation?: string;
  credentialStatus?: string;
  validationStatus?: string;
  availabilityState?: string;
  lastSuccessfulConnection?: string | null;
  lastHealthCheckAt?: string | null;
  lastHealthCheckResult?: string | null;
  rateLimitStatus?: string;
  createdAt: string;
}

export default function AiSettings() {
  const [keysList, setKeysList] = useState<CustomKeyItem[]>([]);
  const [providersOverview, setProvidersOverview] = useState<any[]>([]);
  const [primaryKeyId, setPrimaryKeyId] = useState<string>('system_default');
  const [secondaryKeyId, setSecondaryKeyId] = useState<string>('offline_local');
  const [executionModeOverride, setExecutionModeOverride] = useState<'AUTO' | 'FORCE_OFFLINE'>('AUTO');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateKeyValue, setRotateKeyValue] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New key form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyProvider, setNewKeyProvider] = useState<'gemini' | 'openai' | 'grok'>('gemini');
  const [newKeyModel, setNewKeyModel] = useState('gemini-2.5-flash');
  const [newKeyValue, setNewKeyValue] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>('/api/ai/settings');
      if (data) {
        const custom = Array.isArray(data.customKeys) ? data.customKeys : [];
        setKeysList(custom);
        setProvidersOverview(Array.isArray(data.providers) ? data.providers : []);
        setPrimaryKeyId(data.primaryKeyId || 'system_default');
        setSecondaryKeyId(data.secondaryKeyId || 'offline_local');
        setExecutionModeOverride(data.executionModeOverride || 'AUTO');
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.message || 'Unable to load AI provider settings.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleAddKey = () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) {
      setMessage({
        type: 'error',
        text: 'Please provide both a Label Name and an API Key value.',
      });
      return;
    }

    const rawTrimmed = newKeyValue.trim();
    const maskedPreview =
      rawTrimmed.length > 8
        ? `${rawTrimmed.slice(0, 6)}••••••••••••${rawTrimmed.slice(-4)}`
        : `${rawTrimmed.slice(0, 2)}••••••••`;

    const newKey: CustomKeyItem = {
      id: 'key_' + Date.now(),
      name: newKeyName.trim(),
      provider: newKeyProvider,
      modelId:
        newKeyModel.trim() ||
        (newKeyProvider === 'openai'
          ? 'gpt-4o-mini'
          : newKeyProvider === 'grok'
          ? 'grok-2-latest'
          : 'gemini-2.5-flash'),
      apiKey: rawTrimmed,
      maskedKey: maskedPreview,
      enabled: true,
      priorityOrder: keysList.length + 1,
      credentialStatus: 'CONFIGURED_ENCRYPTED',
      validationStatus: 'UNTESTED',
      availabilityState: 'AVAILABLE',
      createdAt: new Date().toISOString(),
    };

    const updatedKeys = [...keysList, newKey];
    setKeysList(updatedKeys);

    if (updatedKeys.length === 1 && primaryKeyId === 'system_default') {
      setPrimaryKeyId(newKey.id);
    } else if (updatedKeys.length === 2 && secondaryKeyId === 'offline_local') {
      setSecondaryKeyId(newKey.id);
    }

    setNewKeyName('');
    setNewKeyValue('');
    setShowAddForm(false);
    setMessage({
      type: 'success',
      text: `Added encrypted credential profile "${newKey.name}". Click "Save Configuration" to persist.`,
    });
  };

  const handleRotateKeyConfirm = (id: string) => {
    if (!rotateKeyValue.trim()) {
      setMessage({ type: 'error', text: 'Please enter a new replacement API key.' });
      return;
    }
    const rawTrimmed = rotateKeyValue.trim();
    const maskedPreview =
      rawTrimmed.length > 8
        ? `${rawTrimmed.slice(0, 6)}••••••••••••${rawTrimmed.slice(-4)}`
        : `${rawTrimmed.slice(0, 2)}••••••••`;

    setKeysList((prev) =>
      prev.map((k) =>
        k.id === id
          ? {
              ...k,
              apiKey: rawTrimmed,
              maskedKey: maskedPreview,
              validationStatus: 'UNTESTED',
              availabilityState: 'AVAILABLE',
            }
          : k
      )
    );
    setRotatingId(null);
    setRotateKeyValue('');
    setMessage({
      type: 'success',
      text: 'Credential rotated in staging. Click "Save Configuration" to encrypt & commit.',
    });
  };

  const handleToggleKeyEnabled = (id: string) => {
    setKeysList((prev) =>
      prev.map((k) => {
        if (k.id !== id) return k;
        const nextEnabled = !(k.enabled !== false);
        return {
          ...k,
          enabled: nextEnabled,
          availabilityState: nextEnabled ? 'AVAILABLE' : 'DISABLED',
        };
      })
    );
  };

  const handleDeleteKey = (id: string) => {
    const updatedKeys = keysList.filter((k) => k.id !== id);
    setKeysList(updatedKeys);

    if (primaryKeyId === id) {
      setPrimaryKeyId('system_default');
    }
    if (secondaryKeyId === id) {
      setSecondaryKeyId('offline_local');
    }

    setMessage({
      type: 'success',
      text: 'Key removed from hierarchy. Click "Save Configuration" to persist.',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch<any>('/api/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          primaryProvider: primaryKeyId === 'offline_local' ? 'local' : 'gemini',
          fallbackProvider: 'local',
          primaryKeyId,
          secondaryKeyId,
          executionModeOverride,
          customKeys: keysList,
        }),
      });
      if (res?.settings) {
        setKeysList(res.settings.customKeys || []);
        setProvidersOverview(res.settings.providers || []);
      }
      setMessage({
        type: 'success',
        text: 'AI Provider Hierarchy & Encrypted Credentials saved successfully!',
      });
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.message || 'Failed to save AI configuration.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setTestingId(providerId);
    setMessage(null);
    try {
      const res = await apiFetch<any>('/api/ai/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, keyId: providerId }),
      });
      setMessage({
        type: res.success ? 'success' : 'error',
        text: `[${res.providerName}] ${res.message} (${res.latencyMs}ms • Status: ${res.status})`,
      });
      await fetchSettings();
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.message || 'Provider connection test failed.',
      });
    } finally {
      setTestingId(null);
    }
  };

  const getKeyLabel = (id: string) => {
    if (id === 'system_default') return 'System Default (Cloud AI)';
    if (id === 'offline_local') return 'Main Offline Rule Engine (Local)';
    const item = keysList.find((k) => k.id === id);
    return item ? `${item.name} (${item.provider.toUpperCase()})` : 'System Default (Cloud AI)';
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              AI Agent Multi-Key & Provider Hierarchy
            </h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <Lock className="w-3 h-3" /> AES-256-GCM Credential Vault
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Configure encrypted API credentials, health checks, and deterministic Primary → Secondary → Local Offline Rule Engine failover.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleTestProvider('offline_local')}
            disabled={testingId === 'offline_local'}
            data-testid="test-offline-engine-btn"
            className="flex items-center gap-1.5 px-3 py-2 border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            {testingId === 'offline_local' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Activity className="w-3.5 h-3.5" />
            )}
            Verify Offline Engine
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            data-testid="add-custom-key-btn"
            className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Custom API Key
          </button>
        </div>
      </div>

      {message && (
        <div
          data-testid="ai-settings-message"
          className={`p-4 rounded-lg text-sm font-medium border flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
          }`}
        >
          <span>{message.text}</span>
        </div>
      )}

      {/* Failover Chain Diagram */}
      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" /> Active Failover Sequence
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Execution Policy:</span>
            <select
              value={executionModeOverride}
              onChange={(e) => setExecutionModeOverride(e.target.value as 'AUTO' | 'FORCE_OFFLINE')}
              data-testid="execution-mode-select"
              className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              <option value="AUTO">Automatic Failover (Online → Offline)</option>
              <option value="FORCE_OFFLINE">Strict Offline Local Mode Only</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Step 1 */}
          <div className="bg-white dark:bg-slate-800 border-2 border-indigo-500/40 p-3.5 rounded-lg shadow-sm space-y-1 relative">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-full">
                1. Primary AI
              </span>
              <button
                onClick={() => handleTestProvider(primaryKeyId)}
                disabled={testingId === primaryKeyId}
                className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
              >
                {testingId === primaryKeyId ? 'Testing...' : 'Test'}
              </button>
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
              {executionModeOverride === 'FORCE_OFFLINE'
                ? 'Main Offline Rule Engine (Forced)'
                : getKeyLabel(primaryKeyId)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              First line of response for all queries
            </p>
          </div>

          {/* Step 2 */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 rounded-lg shadow-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded-full">
                2. Secondary Fallback
              </span>
              <button
                onClick={() => handleTestProvider(secondaryKeyId)}
                disabled={testingId === secondaryKeyId}
                className="text-[10px] font-bold text-amber-600 hover:underline cursor-pointer"
              >
                {testingId === secondaryKeyId ? 'Testing...' : 'Test'}
              </button>
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
              {getKeyLabel(secondaryKeyId)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Activated automatically if Primary hits quota or fails
            </p>
          </div>

          {/* Step 3 */}
          <div className="bg-white dark:bg-slate-800 border border-emerald-500/40 p-3.5 rounded-lg shadow-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded-full">
                3. Main Offline Engine
              </span>
              <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" /> READY
              </span>
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
              Local Deterministic Rule Engine
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Guaranteed 100% offline company ledger & BIR compliance logic
            </p>
          </div>
        </div>
      </div>

      {/* Role Selection Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-indigo-500" /> Designated Primary AI
          </label>
          <select
            value={primaryKeyId}
            onChange={(e) => setPrimaryKeyId(e.target.value)}
            data-testid="primary-ai-select"
            className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 dark:text-white"
          >
            <option value="system_default">System Default Key (Cloud AI)</option>
            <option value="offline_local">Main Offline Rule Engine (Local)</option>
            {keysList
              .filter((k) => k.enabled !== false)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  Custom Key: {k.name} ({k.provider.toUpperCase()})
                </option>
              ))}
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            The primary provider called for LedgerAI agent responses.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4 text-amber-500" /> Designated Secondary AI (Fallback)
          </label>
          <select
            value={secondaryKeyId}
            onChange={(e) => setSecondaryKeyId(e.target.value)}
            data-testid="secondary-ai-select"
            className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 dark:text-white"
          >
            <option value="offline_local">Main Offline Rule Engine (Local)</option>
            <option value="system_default">System Default Key (Cloud AI)</option>
            {keysList
              .filter((k) => k.enabled !== false)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  Custom Key: {k.name} ({k.provider.toUpperCase()})
                </option>
              ))}
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Automatically activated if the Primary AI is unavailable or rate-limited.
          </p>
        </div>
      </div>

      {/* Add New Key Form Modal/Card */}
      {showAddForm && (
        <div className="p-5 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Add Encrypted Custom API Key Profile
            </h3>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Profile Label
              </label>
              <input
                type="text"
                placeholder="e.g. Enterprise Cloud AI Key"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                data-testid="new-key-name-input"
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Provider Type
              </label>
              <select
                value={newKeyProvider}
                onChange={(e) => {
                  const p = e.target.value as 'gemini' | 'openai' | 'grok';
                  setNewKeyProvider(p);
                  setNewKeyModel(
                    p === 'openai' ? 'gpt-4o-mini' : p === 'grok' ? 'grok-2-latest' : 'gemini-2.5-flash'
                  );
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-white font-medium"
              >
                <option value="gemini">Standard Cloud AI</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="grok">Grok / xAI</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Model Identifier
              </label>
              <input
                type="text"
                value={newKeyModel}
                onChange={(e) => setNewKeyModel(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                API Key Secret (Encrypted on Save)
              </label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                data-testid="new-key-value-input"
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono dark:text-white"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleAddKey}
              data-testid="confirm-add-key-btn"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              Confirm & Stage Encrypted Key
            </button>
          </div>
        </div>
      )}

      {/* Keys List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Registered API Keys ({keysList.length})
          </h3>
          <span className="text-[11px] text-slate-400">
            Secrets are masked and encrypted at rest using AES-256-GCM
          </span>
        </div>

        {keysList.length === 0 ? (
          <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
            <Key className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              No custom API keys added yet.
            </p>
            <p className="text-[11px] text-slate-400">
              System automatically routes through System Default or the 100% Local Offline Rule Engine.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {keysList.map((item) => {
              const isEnabled = item.enabled !== false;
              const isRotating = rotatingId === item.id;
              return (
                <div
                  key={item.id}
                  className={`p-4 bg-slate-50 dark:bg-slate-900/60 border rounded-xl transition-all space-y-3 ${
                    isEnabled
                      ? 'border-slate-200 dark:border-slate-700/80'
                      : 'border-slate-200/50 opacity-60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-950/60 rounded-lg text-indigo-600 dark:text-indigo-400 mt-0.5">
                        <Key className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                            {item.name}
                          </p>
                          <span className="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">
                            {item.provider} • {item.modelId || 'default'}
                          </span>
                          {primaryKeyId === item.id && (
                            <span className="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-indigo-600 text-white rounded">
                              Primary
                            </span>
                          )}
                          {secondaryKeyId === item.id && (
                            <span className="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-amber-500 text-white rounded">
                              Secondary
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 text-[10px] uppercase font-extrabold rounded ${
                              !isEnabled
                                ? 'bg-slate-200 text-slate-600'
                                : item.validationStatus === 'VALID'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : item.validationStatus === 'INVALID'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                : item.validationStatus === 'RATE_LIMITED'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            }`}
                          >
                            {!isEnabled ? 'DISABLED' : item.validationStatus || 'ENCRYPTED'}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                          Credential Reference: <strong>{item.maskedKey || 'Configured (Encrypted)'}</strong>
                        </p>
                        {item.lastHealthCheckResult && (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Last Health Check: {item.lastHealthCheckResult}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => handleTestProvider(item.id)}
                        disabled={testingId === item.id}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
                      >
                        {testingId === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Activity className="w-3.5 h-3.5 text-indigo-500" />
                        )}
                        Test
                      </button>

                      <button
                        onClick={() => {
                          setRotatingId(isRotating ? null : item.id);
                          setRotateKeyValue('');
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
                        title="Rotate API Key"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                        Rotate
                      </button>

                      <button
                        onClick={() => handleToggleKeyEnabled(item.id)}
                        className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                        title={isEnabled ? 'Disable Profile' : 'Enable Profile'}
                      >
                        <Power className={`w-4 h-4 ${isEnabled ? 'text-emerald-500' : 'text-slate-400'}`} />
                      </button>

                      <button
                        onClick={() => handleDeleteKey(item.id)}
                        className="p-1.5 text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-800/60 bg-white dark:bg-slate-800 cursor-pointer"
                        title="Delete Key Profile"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isRotating && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
                      <input
                        type="password"
                        placeholder="Enter replacement API key..."
                        value={rotateKeyValue}
                        onChange={(e) => setRotateKeyValue(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono dark:text-white"
                      />
                      <button
                        onClick={() => handleRotateKeyConfirm(item.id)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Stage New Key
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 flex justify-between items-center flex-wrap gap-4">
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          Grounding: 100% Internal Encrypted Company Ledger + Philippine BIR Statutory Engine
        </p>
        <button
          onClick={handleSave}
          disabled={saving}
          data-testid="save-ai-config-btn"
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Encrypting & Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
