import React, { createContext, useContext, useState, useEffect } from 'react';
import { setAuthToken, clearAuthToken } from '../utils/apiClient';

export type LedgerRole =
  | 'Company Owner'
  | 'Company Administrator'
  | 'Accountant'
  | 'Bookkeeper'
  | 'Auditor'
  | 'Reviewer'
  | 'Approver'
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
};

type AuthContextType = {
  user: User | null;
  activeCompany: Company | null;
  userRole: LedgerRole;
  permissions: string[];
  login: (data: any) => void;
  logout: () => void;
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

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch('/api/auth/session', { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.user) {
          if (data.token) setAuthToken(data.token);
          setUser(data.user);
          setActiveCompany(data.activeCompany);
          setPermissions(data.permissions || []);
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
        console.warn("Session refresh warning:", err.message);
      }
      clearAuthToken();
      setUser(null);
      setActiveCompany(null);
      setPermissions([]);
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
  };

  const updateUser = (updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.error("Logout request error", e);
    } finally {
      clearAuthToken();
      setUser(null);
      setActiveCompany(null);
      setPermissions([]);
    }
  };

  const userRole: LedgerRole = activeCompany?.role || 'Read-only User';

  const hasRole = (...roles: LedgerRole[]) => {
    return roles.includes(userRole);
  };

  const hasPermission = (perm: string | string[]) => {
    if (!perm) return true;
    if (permissions.includes('*')) return true;

    const targets = Array.isArray(perm) ? perm : [perm];
    return targets.some(target => {
      if (!target) return true;
      const lowerTarget = target.toLowerCase();
      const legacyTarget = lowerTarget.replace(':', '_').toUpperCase();

      return permissions.some(p => {
        if (p === '*') return true;
        const pLower = p.toLowerCase();
        return pLower === lowerTarget || pLower === legacyTarget;
      });
    });
  };

  const isAdmin = userRole === 'Company Owner' || userRole === 'Company Administrator' || hasPermission(['roles:manage', 'company:write', 'settings:manage']);
  const canCreate = hasPermission(['accounting:create', 'sales:create', 'purchases:create', 'customers:create', 'vendors:create', 'operations:create', 'documents:create']) || ['Company Owner', 'Company Administrator', 'Accountant', 'Bookkeeper'].includes(userRole);
  const canEdit = hasPermission(['accounting:edit', 'sales:edit', 'purchases:edit', 'customers:edit', 'vendors:edit', 'operations:edit', 'documents:edit']) || ['Company Owner', 'Company Administrator', 'Accountant', 'Bookkeeper'].includes(userRole);
  const canApprove = hasPermission(['accounting:approve', 'sales:approve', 'purchases:approve', 'bank_rec:approve', 'tax:approve', 'budget:approve', 'documents:verify']) || ['Company Owner', 'Company Administrator', 'Approver'].includes(userRole);
  const canReview = hasPermission(['accounting:view', 'reports:view', 'audit:view']);
  const isReadOnly = !canCreate && !canEdit && !canApprove;

  return (
    <AuthContext.Provider value={{ 
      user, 
      activeCompany, 
      userRole,
      permissions, 
      login, 
      logout, 
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
      loading 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

