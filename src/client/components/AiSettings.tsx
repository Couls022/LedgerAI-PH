import React, { useState, useEffect } from 'react';
import { Sparkles, Save, Server, Loader2, AlertTriangle, Key, Eye, EyeOff, CheckCircle2, ShieldCheck, Trash2, Plus, ArrowRight, Check, RefreshCw, Cpu, Layers } from 'lucide-react';

export interface CustomKeyItem {
  id: string;
  name: string;
  provider: 'gemini' | 'openai' | 'grok';
  apiKey: string;
  createdAt: string;
}

export default function AiSettings() {
  const [keysList, setKeysList] = useState<CustomKeyItem[]>([]);
  const [primaryKeyId, setPrimaryKeyId] = useState<string>('system_default');
  const [secondaryKeyId, setSecondaryKeyId] = useState<string>('offline_local');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // New key form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyProvider, setNewKeyProvider] = useState<'gemini' | 'openai' | 'grok'>('gemini');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/ai/settings');
      const data = await res.json();
      if (res.ok && data) {
        let keys: CustomKeyItem[] = [];
        if (data.customKeysJson) {
          try {
            keys = JSON.parse(data.customKeysJson);
          } catch (e) {
            console.error('Failed to parse keys', e);
          }
        }
        
        // Migrate single legacy key if present and keysList empty
        if (data.geminiApiKey && keys.length === 0) {
          keys.push({
            id: 'key_' + Date.now(),
            name: 'Primary Gemini Key',
            provider: 'gemini',
            apiKey: data.geminiApiKey,
            createdAt: new Date().toISOString()
          });
        }

        setKeysList(keys);
        setPrimaryKeyId(data.primaryKeyId || (keys.length > 0 ? keys[0].id : 'system_default'));
        setSecondaryKeyId(data.secondaryKeyId || (keys.length > 1 ? keys[1].id : 'offline_local'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKey = () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) {
      setMessage({ type: 'error', text: 'Please provide both a Label Name and an API Key value.' });
      return;
    }

    const newKey: CustomKeyItem = {
      id: 'key_' + Date.now(),
      name: newKeyName.trim(),
      provider: newKeyProvider,
      apiKey: newKeyValue.trim(),
      createdAt: new Date().toISOString()
    };

    const updatedKeys = [...keysList, newKey];
    setKeysList(updatedKeys);

    // If it's the first key, set as primary automatically
    if (updatedKeys.length === 1 && primaryKeyId === 'system_default') {
      setPrimaryKeyId(newKey.id);
    } else if (updatedKeys.length === 2 && secondaryKeyId === 'offline_local') {
      setSecondaryKeyId(newKey.id);
    }

    // Reset form
    setNewKeyName('');
    setNewKeyValue('');
    setShowAddForm(false);
    setMessage({ type: 'success', text: `Added custom key "${newKey.name}". Click "Save Configuration" to apply changes.` });
  };

  const handleDeleteKey = (id: string) => {
    const updatedKeys = keysList.filter(k => k.id !== id);
    setKeysList(updatedKeys);
    
    if (primaryKeyId === id) {
      setPrimaryKeyId('system_default');
    }
    if (secondaryKeyId === id) {
      setSecondaryKeyId('offline_local');
    }

    setMessage({ type: 'success', text: 'Key removed from list. Click "Save Configuration" to persist.' });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const primaryObj = keysList.find(k => k.id === primaryKeyId);
      const res = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryProvider: primaryKeyId === 'offline_local' ? 'local' : 'gemini',
          fallbackProvider: 'local',
          primaryKeyId,
          secondaryKeyId,
          customKeysJson: JSON.stringify(keysList),
          geminiApiKey: primaryObj ? primaryObj.apiKey : ''
        })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'AI Agent Configuration updated successfully! Failover hierarchy is now live.' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to save configuration.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error occurred while saving.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeyIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getKeyLabel = (id: string) => {
    if (id === 'system_default') return 'System Default (Online Gemini)';
    if (id === 'offline_local') return 'Main Offline Rule Engine (Local)';
    const item = keysList.find(k => k.id === id);
    return item ? `${item.name} (${item.provider.toUpperCase()})` : 'None / Default';
  };

  if (loading) {
    return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500" /></div>;
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> AI Agent Multi-Key & Provider Hierarchy
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Configure unlimited custom API keys and define Primary, Secondary, or Main Offline AI engines for failover resilience.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Custom API Key
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg text-sm font-medium border flex items-center justify-between ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'}`}>
          <span>{message.text}</span>
        </div>
      )}

      {/* Failover Chain Diagram */}
      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-500" /> Active Failover Sequence
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Step 1 */}
          <div className="bg-white dark:bg-slate-800 border-2 border-indigo-500/40 p-3.5 rounded-lg shadow-sm space-y-1 relative">
            <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-full">
              1. Primary AI
            </span>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
              {getKeyLabel(primaryKeyId)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">First line of response for all queries</p>
          </div>

          {/* Step 2 */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 rounded-lg shadow-sm space-y-1">
            <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded-full">
              2. Secondary Fallback
            </span>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
              {getKeyLabel(secondaryKeyId)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Used if Primary key hits quota or fails</p>
          </div>

          {/* Step 3 */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 rounded-lg shadow-sm space-y-1">
            <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded-full">
              3. Main Offline Engine
            </span>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
              Local Heuristic Rule Engine
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Guaranteed 100% offline BIR compliance logic</p>
          </div>
        </div>
      </div>

      {/* Role Selection Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        {/* Primary Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-indigo-500" /> Designated Primary AI
          </label>
          <select
            value={primaryKeyId}
            onChange={(e) => setPrimaryKeyId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 dark:text-white"
          >
            <option value="system_default">System Default Key (Online Gemini)</option>
            <option value="offline_local">Main Offline Rule Engine (Offline)</option>
            {keysList.map(k => (
              <option key={k.id} value={k.id}>
                Custom Key: {k.name} ({k.provider.toUpperCase()})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">The primary model called for LedgerAI agent responses.</p>
        </div>

        {/* Secondary Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4 text-amber-500" /> Designated Secondary AI (Fallback)
          </label>
          <select
            value={secondaryKeyId}
            onChange={(e) => setSecondaryKeyId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 dark:text-white"
          >
            <option value="offline_local">Main Offline Rule Engine (Local)</option>
            <option value="system_default">System Default Key (Online Gemini)</option>
            {keysList.map(k => (
              <option key={k.id} value={k.id}>
                Custom Key: {k.name} ({k.provider.toUpperCase()})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Automatically activated if the Primary AI is unavailable.</p>
        </div>
      </div>

      {/* Add New Key Form Modal/Card */}
      {showAddForm && (
        <div className="p-5 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Add New Custom API Key
            </h3>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Key Label Name</label>
              <input
                type="text"
                placeholder="e.g. My Personal Gemini Key"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Provider Type</label>
              <select
                value={newKeyProvider}
                onChange={(e) => setNewKeyProvider(e.target.value as any)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-white font-medium"
              >
                <option value="gemini">Google Gemini AI</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="grok">Grok / xAI</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">API Key Value</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono dark:text-white"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleAddKey}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all"
            >
              Confirm & Add Key
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
        </div>

        {keysList.length === 0 ? (
          <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
            <Key className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">No custom API keys added yet.</p>
            <p className="text-[11px] text-slate-400">Add custom keys to assign Primary or Secondary AI responsibilities.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {keysList.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-xl transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-950/60 rounded-lg text-indigo-600 dark:text-indigo-400">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.name}</p>
                      <span className="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">
                        {item.provider}
                      </span>
                      {primaryKeyId === item.id && (
                        <span className="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-indigo-500 text-white rounded">
                          Primary
                        </span>
                      )}
                      {secondaryKeyId === item.id && (
                        <span className="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-amber-500 text-white rounded">
                          Secondary
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {visibleKeyIds[item.id] ? item.apiKey : `${item.apiKey.slice(0, 6)}••••••••••••••••`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleKeyVisibility(item.id)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md"
                    title={visibleKeyIds[item.id] ? "Hide" : "Show"}
                  >
                    {visibleKeyIds[item.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDeleteKey(item.id)}
                    className="p-1.5 text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 rounded-md"
                    title="Delete Key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 flex justify-between items-center">
        <p className="text-xs text-slate-400">Grounding: 100% Internal Database + BIR PH Compliance Logic</p>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}


