/**
 * Per-Browser-Profile Persistent Company Preference Service
 *
 * Security & Architecture Contract:
 * - Stores ONLY non-sensitive preference metadata (companyId, companyName, timestamp, user-specific pinned/recent IDs).
 * - NEVER stores authentication tokens, passwords, roles, permissions, or server filesystem paths.
 * - Scoped strictly to the local browser profile / workstation so concurrent users on different workstations
 *   can work in completely different companies without ever colliding.
 * - Never wipes saved company preference on transient server downtime (network / 5xx errors).
 */

export const LAST_COMPANY_PREF_KEY = 'ledgerai_client_company_pref_v1';
export const USER_COMPANY_SHORTCUTS_KEY = 'ledgerai_client_user_companies_v1';
export const LEGACY_LAST_COMPANY_KEY = 'ledgerai_last_company_id';
export const LEGACY_TOKEN_KEY = 'ledgerai_token';

export interface SavedCompanyPreference {
  companyId: string;
  companyName: string;
  lastOpenedAt: string;
}

export interface UserRecentCompanyEntry {
  companyId: string;
  companyName: string;
  lastOpenedAt: string;
}

export interface UserCompanyShortcutsState {
  pinnedCompanyIds: string[];
  recentCompanies: UserRecentCompanyEntry[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MAX_RECENT_COMPANIES = 12;

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage contexts
  }
  return null;
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function purgeLegacyLocalStorageTokens(storage?: StorageLike | null): void {
  const store = storage ?? getDefaultStorage();
  if (!store) return;
  try {
    store.removeItem(LEGACY_TOKEN_KEY);
    store.removeItem('auth_token');
    store.removeItem('token');
  } catch {
    // Ignore storage errors
  }
}

export function getLastSelectedCompany(storage?: StorageLike | null): SavedCompanyPreference | null {
  const store = storage ?? getDefaultStorage();
  if (!store) return null;

  try {
    const raw = store.getItem(LAST_COMPANY_PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.companyId === 'string' && parsed.companyId.trim()) {
        return {
          companyId: parsed.companyId.trim(),
          companyName: typeof parsed.companyName === 'string' ? parsed.companyName : '',
          lastOpenedAt:
            typeof parsed.lastOpenedAt === 'string' ? parsed.lastOpenedAt : new Date().toISOString(),
        };
      }
    }

    // Seamless one-time migration from legacy key
    const legacyId = store.getItem(LEGACY_LAST_COMPANY_KEY);
    if (legacyId && legacyId.trim()) {
      const migrated: SavedCompanyPreference = {
        companyId: legacyId.trim(),
        companyName: '',
        lastOpenedAt: new Date().toISOString(),
      };
      store.setItem(LAST_COMPANY_PREF_KEY, JSON.stringify(migrated));
      store.removeItem(LEGACY_LAST_COMPANY_KEY);
      return migrated;
    }
  } catch {
    return null;
  }

  return null;
}

export function setLastSelectedCompany(
  companyId: string,
  companyName = '',
  storage?: StorageLike | null
): SavedCompanyPreference | null {
  const cleanId = String(companyId || '').trim();
  if (!cleanId) return null;

  const store = storage ?? getDefaultStorage();
  const entry: SavedCompanyPreference = {
    companyId: cleanId,
    companyName: String(companyName || '').trim(),
    lastOpenedAt: new Date().toISOString(),
  };

  if (store) {
    try {
      store.setItem(LAST_COMPANY_PREF_KEY, JSON.stringify(entry));
      store.removeItem(LEGACY_LAST_COMPANY_KEY);
    } catch {
      // Ignore quota / privacy mode errors
    }
  }

  return entry;
}

export function clearLastSelectedCompany(storage?: StorageLike | null): void {
  const store = storage ?? getDefaultStorage();
  if (!store) return;
  try {
    store.removeItem(LAST_COMPANY_PREF_KEY);
    store.removeItem(LEGACY_LAST_COMPANY_KEY);
  } catch {
    // Ignore storage errors
  }
}

function readAllUserShortcutMaps(store: StorageLike): Record<string, UserCompanyShortcutsState> {
  try {
    const raw = store.getItem(USER_COMPANY_SHORTCUTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Corrupted JSON fallback
  }
  return {};
}

function writeAllUserShortcutMaps(
  store: StorageLike,
  map: Record<string, UserCompanyShortcutsState>
): void {
  try {
    store.setItem(USER_COMPANY_SHORTCUTS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

export function getUserCompanyShortcuts(
  userEmail: string,
  storage?: StorageLike | null
): UserCompanyShortcutsState {
  const key = normalizeEmail(userEmail);
  const store = storage ?? getDefaultStorage();
  if (!key || !store) {
    return { pinnedCompanyIds: [], recentCompanies: [] };
  }

  const all = readAllUserShortcutMaps(store);
  const entry = all[key];
  if (!entry) {
    return { pinnedCompanyIds: [], recentCompanies: [] };
  }

  return {
    pinnedCompanyIds: Array.isArray(entry.pinnedCompanyIds)
      ? entry.pinnedCompanyIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [],
    recentCompanies: Array.isArray(entry.recentCompanies)
      ? entry.recentCompanies.filter(
          (item) => item && typeof item.companyId === 'string' && item.companyId.trim().length > 0
        )
      : [],
  };
}

export function recordUserRecentCompany(
  userEmail: string,
  companyId: string,
  companyName: string,
  storage?: StorageLike | null
): UserCompanyShortcutsState {
  const key = normalizeEmail(userEmail);
  const cleanId = String(companyId || '').trim();
  const store = storage ?? getDefaultStorage();
  if (!key || !cleanId || !store) {
    return { pinnedCompanyIds: [], recentCompanies: [] };
  }

  const all = readAllUserShortcutMaps(store);
  const current = getUserCompanyShortcuts(key, store);
  const updatedRecents: UserRecentCompanyEntry[] = [
    {
      companyId: cleanId,
      companyName: String(companyName || '').trim(),
      lastOpenedAt: new Date().toISOString(),
    },
    ...current.recentCompanies.filter((r) => r.companyId !== cleanId),
  ].slice(0, MAX_RECENT_COMPANIES);

  const nextState: UserCompanyShortcutsState = {
    pinnedCompanyIds: current.pinnedCompanyIds,
    recentCompanies: updatedRecents,
  };

  all[key] = nextState;
  writeAllUserShortcutMaps(store, all);
  return nextState;
}

export function togglePinnedCompany(
  userEmail: string,
  companyId: string,
  storage?: StorageLike | null
): UserCompanyShortcutsState {
  const key = normalizeEmail(userEmail);
  const cleanId = String(companyId || '').trim();
  const store = storage ?? getDefaultStorage();
  if (!key || !cleanId || !store) {
    return { pinnedCompanyIds: [], recentCompanies: [] };
  }

  const all = readAllUserShortcutMaps(store);
  const current = getUserCompanyShortcuts(key, store);
  const exists = current.pinnedCompanyIds.includes(cleanId);
  const nextPinned = exists
    ? current.pinnedCompanyIds.filter((id) => id !== cleanId)
    : [cleanId, ...current.pinnedCompanyIds];

  const nextState: UserCompanyShortcutsState = {
    pinnedCompanyIds: nextPinned,
    recentCompanies: current.recentCompanies,
  };

  all[key] = nextState;
  writeAllUserShortcutMaps(store, all);
  return nextState;
}

export function removeUserCompanyEntry(
  userEmail: string,
  companyId: string,
  storage?: StorageLike | null
): UserCompanyShortcutsState {
  const key = normalizeEmail(userEmail);
  const cleanId = String(companyId || '').trim();
  const store = storage ?? getDefaultStorage();
  if (!key || !cleanId || !store) {
    return { pinnedCompanyIds: [], recentCompanies: [] };
  }

  const all = readAllUserShortcutMaps(store);
  const current = getUserCompanyShortcuts(key, store);
  const nextState: UserCompanyShortcutsState = {
    pinnedCompanyIds: current.pinnedCompanyIds.filter((id) => id !== cleanId),
    recentCompanies: current.recentCompanies.filter((r) => r.companyId !== cleanId),
  };

  all[key] = nextState;
  writeAllUserShortcutMaps(store, all);

  // If this was also the browser's last selected company, clear it cleanly
  const last = getLastSelectedCompany(store);
  if (last && last.companyId === cleanId) {
    clearLastSelectedCompany(store);
  }

  return nextState;
}

export type StartupVerificationOutcome =
  | { action: 'REDIRECT_LOGIN'; companyId: string; companyName: string }
  | { action: 'SHOW_LAUNCHER'; clearedStalePreference: boolean; notice?: string }
  | { action: 'SERVER_UNREACHABLE'; preservedCompanyId: string; preservedCompanyName: string };

/**
 * Pure startup decision resolver:
 * - Preserves saved preference on transient network/5xx server outages (NEVER wipes preference when PC 1 is offline).
 * - Clears saved preference ONLY when server authoritatively reports 404/403/410 or ARCHIVED/MISSING.
 */
export function resolveStartupCompanyVerification(params: {
  saved: SavedCompanyPreference | null;
  httpStatus?: number | null;
  companyPayload?: { id?: string; legalName?: string; status?: string; archived?: boolean } | null;
  networkError?: boolean;
}): StartupVerificationOutcome {
  const { saved, httpStatus, companyPayload, networkError } = params;

  if (!saved || !saved.companyId) {
    return { action: 'SHOW_LAUNCHER', clearedStalePreference: false };
  }

  if (networkError || httpStatus === 0 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return {
      action: 'SERVER_UNREACHABLE',
      preservedCompanyId: saved.companyId,
      preservedCompanyName: saved.companyName || saved.companyId,
    };
  }

  if (httpStatus === 200 && companyPayload && !companyPayload.archived && companyPayload.status !== 'ARCHIVED') {
    return {
      action: 'REDIRECT_LOGIN',
      companyId: saved.companyId,
      companyName: companyPayload.legalName || saved.companyName || saved.companyId,
    };
  }

  if (httpStatus === 404 || httpStatus === 403 || httpStatus === 410 || companyPayload?.archived) {
    return {
      action: 'SHOW_LAUNCHER',
      clearedStalePreference: true,
      notice: `Your previously opened company (${saved.companyName || saved.companyId}) is no longer active or available on this server. Select another company to continue.`,
    };
  }

  return {
    action: 'SERVER_UNREACHABLE',
    preservedCompanyId: saved.companyId,
    preservedCompanyName: saved.companyName || saved.companyId,
  };
}

export const CompanyPreferenceService = {
  getLastSelectedCompany,
  setLastSelectedCompany,
  clearLastSelectedCompany,
  getUserCompanyShortcuts,
  recordUserRecentCompany,
  togglePinnedCompany,
  removeUserCompanyEntry,
  purgeLegacyLocalStorageTokens,
  resolveStartupCompanyVerification,
};
