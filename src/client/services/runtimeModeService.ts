import { useEffect, useState } from 'react';

export type RuntimeConsoleMode = 'PC_SERVER_CONSOLE' | 'BROWSER_CLIENT';

export interface RuntimeModeInfo {
  mode: RuntimeConsoleMode;
  isServerConsole: boolean;
  isBrowserClient: boolean;
  canCreateCompany: boolean;
  canOpenLocalFolder: boolean;
  canRestoreCompany: boolean;
  serverHostname?: string;
  deploymentMode?: string;
}

function getInitialHeuristic(): RuntimeModeInfo {
  if (typeof window === 'undefined') {
    return {
      mode: 'PC_SERVER_CONSOLE',
      isServerConsole: true,
      isBrowserClient: false,
      canCreateCompany: true,
      canOpenLocalFolder: true,
      canRestoreCompany: true,
    };
  }
  const isElectron = Boolean((window as any).electronAPI?.isElectron);
  const hostname = window.location.hostname.toLowerCase();
  const isHostedPreview = /^ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/i.test(hostname);
  const isLocalHost =
    isElectron || isHostedPreview || ['localhost', '127.0.0.1', '::1'].includes(hostname);

  return {
    mode: isLocalHost ? 'PC_SERVER_CONSOLE' : 'BROWSER_CLIENT',
    isServerConsole: isLocalHost,
    isBrowserClient: !isLocalHost,
    canCreateCompany: isLocalHost,
    canOpenLocalFolder: isLocalHost,
    canRestoreCompany: isLocalHost,
  };
}

let cachedRuntimeMode: RuntimeModeInfo | null = null;
let inflightPromise: Promise<RuntimeModeInfo> | null = null;

export async function fetchRuntimeMode(forceRefresh = false): Promise<RuntimeModeInfo> {
  if (cachedRuntimeMode && !forceRefresh) {
    return cachedRuntimeMode;
  }
  if (inflightPromise && !forceRefresh) {
    return inflightPromise;
  }

  const fallback = getInitialHeuristic();
  inflightPromise = fetch('/api/companies/runtime-mode', {
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (res) => {
      if (!res.ok) return fallback;
      const data = await res.json().catch(() => null);
      if (!data || typeof data.isServerConsole !== 'boolean') return fallback;
      const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI?.isElectron);
      const isServerConsole = Boolean(data.isServerConsole || isElectron);
      const resolved: RuntimeModeInfo = {
        mode: isServerConsole ? 'PC_SERVER_CONSOLE' : 'BROWSER_CLIENT',
        isServerConsole,
        isBrowserClient: !isServerConsole,
        canCreateCompany: Boolean(data.canCreateCompany ?? isServerConsole),
        canOpenLocalFolder: Boolean(data.canOpenLocalFolder ?? isServerConsole),
        canRestoreCompany: Boolean(data.canRestoreCompany ?? isServerConsole),
        serverHostname: data.serverHostname,
        deploymentMode: data.deploymentMode,
      };
      cachedRuntimeMode = resolved;
      return resolved;
    })
    .catch(() => fallback)
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

export function clearRuntimeModeCache() {
  cachedRuntimeMode = null;
}

export function useRuntimeMode(): RuntimeModeInfo & { loading: boolean } {
  const [info, setInfo] = useState<RuntimeModeInfo>(() => cachedRuntimeMode || getInitialHeuristic());
  const [loading, setLoading] = useState<boolean>(() => !cachedRuntimeMode);

  useEffect(() => {
    let active = true;
    fetchRuntimeMode()
      .then((resolved) => {
        if (active) {
          setInfo(resolved);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { ...info, loading };
}
