import React, { createContext, useContext, useState, useEffect } from 'react';
import { getAuthToken, setAuthToken, clearAuthToken, apiFetch } from '../utils/apiClient';
import { CompanyPreferenceService } from '../services/companyPreferenceService';
import { getAuthorizedERPModules, CANONICAL_ERP_MODULES, PrimaryModuleDefinition } from '../../shared/moduleRegistry';

export type LedgerRole =
  | 'Company Owner'
  | 'Company Administrator'
  | 'Accountant'
  | 'Bookkeeper'
  | 'Auditor'
  | 'Reviewer'
  | 'Approver'
  | 'Tax & AP Specialist'
  | 'Read-only User';

export type User = {
  id: string;
  email: string;
  displayName: string;
  theme?: 'light' | 'dark' | 'system';
};

export type Company = {
  id: string;
  legalName: string;
  tradeName?: string | null;
  tin?: string | null;
  vatStatus?: string | null;
  taxpayerClassification?: string | null;
  taxpayerType?: string | null;
  rdoCode?: string | null;
  roleId?: string | null;
  roleCode?: string | null;
  roleName?: string | null;
  role?: LedgerRole;
  assignedModules?: string[] | null;
  assignedSubmodules?: Record<string, string[]> | null;
  roleTemplateVersion?: number;
  defaultDataScope?: string;
  approvalLimitCentavos?: number;
  planType?: 'PRO' | 'ENTERPRISE' | 'TRIAL';
  isLifetime?: boolean;
};

export interface SwitchCompanyResult {
  switched: boolean;
  requiresReauth?: boolean;
  targetCompanyId?: string;
  message?: string;
}

type AuthContextType = {
  user: User | null;
  activeCompany: Company | null;
  userRole: LedgerRole;
  permissions: string[];
  authorizedModules: PrimaryModuleDefinition[];
  workspaceSessionEpoch: number;
  planType: 'PRO' | 'ENTERPRISE' | 'TRIAL';
  isEnterprise: boolean;
  login: (data: any) => void;
  logout: () => Promise<void>;
  switchCompany: (targetCompanyId: string, targetCompanyName?: string) => Promise<SwitchCompanyResult>;
  switchWorkspaceCleanup: (targetCompanyId?: string) => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  refreshSession: () => Promise<void>;
  hasRole: (...roles: LedgerRole[]) => boolean;
  hasPermission: (perm: string | string[]) => boolean;
  isAdmin: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canReview: boolean;
  isReadOnly: boolean;
  loading: boolean;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [workspaceSessionEpoch, setWorkspaceSessionEpoch] = useState<number>(1);
  const [loading, setLoading] = useState(true);

  const refreshSession = async () => {
    const token = getAuthToken();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/auth/session', {
        headers,
        credentials: 'include',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.user) {
          if (data.token) setAuthToken(data.token);
          setUser(data.user);
          setActiveCompany(data.activeCompany);
          setPermissions(data.permissions || []);
          if (data.activeCompany?.id) {
            CompanyPreferenceService.setLastSelectedCompany(
              data.activeCompany.id,
              data.activeCompany.legalName || ''
            );
            if (data.user.email) {
              CompanyPreferenceService.recordUserRecentCompany(
                data.user.email,
                data.activeCompany.id,
                data.activeCompany.legalName || ''
              );
            }
          }
        } else {
          clearAuthToken();
          setUser(null);
          setActiveCompany(null);
          setPermissions([]);
        }
      } else if (res.status === 401 || res.status === 403) {
        clearAuthToken();
        setUser(null);
        setActiveCompany(null);
        setPermissions([]);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Session refresh warning:', err.message);
      }
      // Do NOT clearAuthToken on transient network glitches or aborts if token exists
      if (!token) {
        setUser(null);
        setActiveCompany(null);
        setPermissions([]);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Safety fallback timeout to ensure loading is never stuck
    const safetyTimer = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 4000);

    refreshSession().finally(() => {
      clearTimeout(safetyTimer);
      if (isMounted) setLoading(false);
    });

    const handleUnauthorized = () => {
      clearAuthToken();
      setUser(null);
      setActiveCompany(null);
      setPermissions([]);
    };

    window.addEventListener('ledgerai:unauthorized', handleUnauthorized);
    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
      window.removeEventListener('ledgerai:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = (data: any) => {
    if (data?.token) {
      setAuthToken(data.token);
    }
    setUser(data.user);
    setActiveCompany(data.activeCompany);
    setPermissions(data.permissions || []);
    setWorkspaceSessionEpoch((prev) => prev + 1);

    if (data?.activeCompany?.id) {
      CompanyPreferenceService.setLastSelectedCompany(
        data.activeCompany.id,
        data.activeCompany.legalName || ''
      );
      if (data?.user?.email) {
        CompanyPreferenceService.recordUserRecentCompany(
          data.user.email,
          data.activeCompany.id,
          data.activeCompany.legalName || ''
        );
      }
    }
  };

  const updateUser = (updates: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : null));
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Logout request error', e);
    } finally {
      // Clear authentication session ONLY; browser's saved company preference stays intact per client-server design
      clearAuthToken();
      setUser(null);
      setActiveCompany(null);
      setPermissions([]);
      setWorkspaceSessionEpoch((prev) => prev + 1);
    }
  };

  const switchCompany = async (
    targetCompanyId: string,
    targetCompanyName?: string
  ): Promise<SwitchCompanyResult> => {
    const cleanTargetId = String(targetCompanyId || '').trim();
    if (!cleanTargetId) {
      return { switched: false, message: 'Target company identifier is required.' };
    }

    try {
      const data = await apiFetch<any>('/api/auth/switch-company', {
        method: 'POST',
        body: { targetCompanyId: cleanTargetId } as any,
      });

      if (data?.requiresReauth) {
        return {
          switched: false,
          requiresReauth: true,
          targetCompanyId: cleanTargetId,
          message: data.message || 'Sign-in is required for the selected company.',
        };
      }

      if (data?.switched && data?.user && data?.activeCompany) {
        if (data.token) {
          setAuthToken(data.token);
        }
        setUser(data.user);
        setActiveCompany(data.activeCompany);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
        setWorkspaceSessionEpoch((prev) => prev + 1);

        const resolvedName = data.activeCompany.legalName || targetCompanyName || cleanTargetId;
        CompanyPreferenceService.setLastSelectedCompany(data.activeCompany.id, resolvedName);
        if (data.user.email) {
          CompanyPreferenceService.recordUserRecentCompany(
            data.user.email,
            data.activeCompany.id,
            resolvedName
          );
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('ledgerai:company-switched', {
              detail: {
                companyId: data.activeCompany.id,
                companyName: resolvedName,
              },
            })
          );
        }

        return { switched: true, targetCompanyId: data.activeCompany.id };
      }

      return {
        switched: false,
        message: data?.message || 'Unable to switch company workspace.',
      };
    } catch (err: any) {
      return {
        switched: false,
        message: err?.message || 'Failed to switch company workspace.',
      };
    }
  };

  const switchWorkspaceCleanup = async (targetCompanyId?: string) => {
    try {
      await fetch('/api/auth/switch-company-cleanup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCompanyId }),
      });
    } catch {}
    clearAuthToken();
    setUser(null);
    setActiveCompany(null);
    setPermissions([]);
    setWorkspaceSessionEpoch((prev) => prev + 1);
  };

  const userRole: LedgerRole = activeCompany?.role || 'Read-only User';

  const hasRole = (...roles: LedgerRole[]) => {
    return roles.includes(userRole);
  };

  const isOwner = userRole === 'Company Owner';

  const hasPermission = (perm: string | string[]) => {
    if (!perm) return true;
    if (isOwner) return true;
    if (permissions.includes('*')) return true;

    const targets = Array.isArray(perm) ? perm : [perm];
    return targets.some((target) => {
      if (!target) return true;
      const lowerTarget = target.toLowerCase();
      const legacyTarget = lowerTarget.replace(':', '_').toUpperCase();

      return permissions.some((p) => {
        if (p === '*') return true;
        const pLower = p.toLowerCase();
        return pLower === lowerTarget || pLower === legacyTarget;
      });
    });
  };

  const isAdmin =
    isOwner ||
    userRole === 'Company Administrator' ||
    hasPermission(['roles:manage', 'company:write', 'settings:manage']);
  const canCreate =
    isOwner ||
    (!['Auditor', 'Read-only User', 'Reviewer', 'Approver'].includes(userRole) &&
      hasPermission([
        'accounting:create',
        'sales:create',
        'purchases:create',
        'customers:create',
        'vendors:create',
        'operations:create',
        'documents:create',
      ]));
  const canEdit =
    isOwner ||
    (!['Auditor', 'Read-only User', 'Reviewer', 'Approver'].includes(userRole) &&
      hasPermission([
        'accounting:edit',
        'sales:edit',
        'purchases:edit',
        'customers:edit',
        'vendors:edit',
        'operations:edit',
        'documents:edit',
      ]));
  const canApprove =
    isOwner ||
    hasPermission([
      'approvals:approve',
      'accounting:approve',
      'sales:approve',
      'purchases:approve',
      'bank_rec:approve',
      'tax:approve',
      'budget:approve',
    ]);
  const canReview =
    isOwner ||
    hasPermission([
      'approvals:review',
      'accounting:review',
      'sales:review',
      'purchases:review',
      'documents:verify',
    ]);
  const isReadOnly =
    !isOwner &&
    (['Auditor', 'Read-only User'].includes(userRole) ||
      (!canCreate && !canEdit && !canApprove && !canReview && !isAdmin));

  const authorizedModules = isOwner
    ? CANONICAL_ERP_MODULES
    : getAuthorizedERPModules(
        userRole,
        permissions,
        activeCompany?.assignedModules,
        activeCompany?.assignedSubmodules
      );

  const planType = (activeCompany?.planType || 'PRO') as 'PRO' | 'ENTERPRISE' | 'TRIAL';
  const isEnterprise = planType === 'ENTERPRISE';

  return (
    <AuthContext.Provider
      value={{
        user,
        activeCompany,
        userRole,
        permissions,
        authorizedModules,
        workspaceSessionEpoch,
        planType,
        isEnterprise,
        login,
        logout,
        switchCompany,
        switchWorkspaceCleanup,
        updateUser,
        refreshSession,
        hasRole,
        hasPermission,
        isAdmin,
        canCreate,
        canEdit,
        canApprove,
        canReview,
        isReadOnly,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

