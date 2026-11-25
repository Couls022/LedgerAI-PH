import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  KnowledgeRecord,
  findKnowledgeRecordByPath,
  getKnowledgeRecordBySubmodule,
  getKnowledgeRecordsByModule,
  buildActiveModuleSystemPromptContext,
} from '../../shared/knowledgeBase';

export interface ActiveModuleContextValue {
  activePath: string;
  activeSearch: string;
  activeModuleId: string;
  activeModuleName: string;
  activeSubmoduleId: string;
  activeSubmoduleName: string;
  knowledgeRecord: KnowledgeRecord | undefined;
  siblingSubmodules: KnowledgeRecord[];
  systemPromptContext: string;
  setActiveSubmoduleOverride: (submoduleId: string | null) => void;
}

const ActiveModuleContext = createContext<ActiveModuleContextValue | null>(null);

export const ActiveModuleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const activePath = location.pathname || '/';
  const activeSearch = location.search || '';
  const [submoduleOverride, setSubmoduleOverride] = useState<string | null>(null);

  // Reset manual submodule tab override whenever route pathname changes
  useEffect(() => {
    setSubmoduleOverride(null);
  }, [activePath]);

  const knowledgeRecord = useMemo<KnowledgeRecord | undefined>(() => {
    if (submoduleOverride) {
      const overridden = getKnowledgeRecordBySubmodule(submoduleOverride);
      if (overridden) return overridden;
    }

    // Check URL search params for workspace/tab hints (e.g., ?workspace=approvals)
    if (activeSearch) {
      const params = new URLSearchParams(activeSearch);
      const ws = (params.get('workspace') || params.get('tab') || params.get('submodule') || '').toLowerCase();
      if (ws === 'approvals') {
        const rec = getKnowledgeRecordBySubmodule('appr-inbox');
        if (rec) return rec;
      }
      if (ws === 'stream') {
        const rec = getKnowledgeRecordBySubmodule('act-stream');
        if (rec) return rec;
      }
      if (ws) {
        const bySub = getKnowledgeRecordBySubmodule(ws);
        if (bySub) return bySub;
      }
    }

    return findKnowledgeRecordByPath(`${activePath}${activeSearch || ''}`);
  }, [activePath, activeSearch, submoduleOverride]);

  const siblingSubmodules = useMemo<KnowledgeRecord[]>(() => {
    if (!knowledgeRecord) return [];
    return getKnowledgeRecordsByModule(knowledgeRecord.moduleId);
  }, [knowledgeRecord]);

  const systemPromptContext = useMemo<string>(() => {
    return buildActiveModuleSystemPromptContext(knowledgeRecord, activePath);
  }, [knowledgeRecord, activePath]);

  const value = useMemo<ActiveModuleContextValue>(
    () => ({
      activePath,
      activeSearch,
      activeModuleId: knowledgeRecord?.moduleId || 'dashboard',
      activeModuleName: knowledgeRecord?.moduleName || '1. Dashboard',
      activeSubmoduleId: knowledgeRecord?.submoduleId || 'dash-overview',
      activeSubmoduleName: knowledgeRecord?.submoduleName || 'Executive & Financial Dashboard',
      knowledgeRecord,
      siblingSubmodules,
      systemPromptContext,
      setActiveSubmoduleOverride: setSubmoduleOverride,
    }),
    [activePath, activeSearch, knowledgeRecord, siblingSubmodules, systemPromptContext]
  );

  return <ActiveModuleContext.Provider value={value}>{children}</ActiveModuleContext.Provider>;
};

/**
 * Hook that tracks the active application module and sub-module and provides
 * the domain-specific system prompt context for the LedgerAI Agent.
 */
export function useActiveModuleContext(): ActiveModuleContextValue {
  const ctx = useContext(ActiveModuleContext);
  const location = useLocation();
  const fallbackPath = location.pathname || '/';

  const fallbackValue = useMemo<ActiveModuleContextValue>(() => {
    const rec = findKnowledgeRecordByPath(fallbackPath);
    const siblings = rec ? getKnowledgeRecordsByModule(rec.moduleId) : [];
    return {
      activePath: fallbackPath,
      activeSearch: location.search || '',
      activeModuleId: rec?.moduleId || 'dashboard',
      activeModuleName: rec?.moduleName || '1. Dashboard',
      activeSubmoduleId: rec?.submoduleId || 'dash-overview',
      activeSubmoduleName: rec?.submoduleName || 'Executive & Financial Dashboard',
      knowledgeRecord: rec,
      siblingSubmodules: siblings,
      systemPromptContext: buildActiveModuleSystemPromptContext(rec, fallbackPath),
      setActiveSubmoduleOverride: () => {},
    };
  }, [fallbackPath, location.search]);

  return ctx || fallbackValue;
}
