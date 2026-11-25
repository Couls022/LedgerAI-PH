import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Layout from './client/components/Layout';
import Dashboard from './client/pages/Dashboard';
import Operations from './client/pages/Operations';
import Accounting from './client/pages/Accounting';
import Tax from './client/pages/Tax';
import Documents from './client/pages/Documents';
import Reports from './client/pages/Reports';
import Audit from './client/pages/Audit';
import AuditLog from './client/pages/AuditLog';
import GlobalActivityCenter from './client/pages/GlobalActivityCenter';
import AuditEngagements from './client/pages/AuditEngagements';
import Settings from './client/pages/Settings';
import MasterData from './client/pages/MasterData';
import BudgetPlanning from './client/pages/BudgetPlanning';
import Login from './client/pages/Login';
import Launcher from './client/pages/Launcher';
import CreateProfile from './client/pages/CreateProfile';
import OpenProfile from './client/pages/OpenProfile';
import RestoreProfile from './client/pages/RestoreProfile';
import CompanySelector from './client/pages/CompanySelector';
import ServerConnectionBanner from './client/components/ServerConnectionBanner';
import { AuthProvider, useAuth, LedgerRole } from './client/context/AuthContext';
import { ThemeProvider, useTheme, ThemeMode } from './client/context/ThemeContext';
import { NotificationProvider } from './client/context/NotificationContext';
import { ActiveModuleProvider } from './client/context/ActiveModuleContext';
import { WorkspaceFilterProvider } from './client/context/WorkspaceFilterContext';
import { ProtectedRoute } from './client/components/ProtectedRoute';
import ErrorBoundary from './client/components/ErrorBoundary';
import { Loader2 } from 'lucide-react';

import { getAuthToken } from './client/utils/apiClient';
import { getCompanyVanityDomain } from './shared/vanityDomainUtils';

const AuthGuard = ({ children, minRole, allowedRoles, requiredPermission }: { children: React.ReactNode; minRole?: LedgerRole; allowedRoles?: LedgerRole[]; requiredPermission?: string | string[] }) => {
  const { user, activeCompany, loading } = useAuth();
  const token = getAuthToken();
  const location = useLocation();
  const navigate = useNavigate();

  // Normalize URL to branded vanity format (e.g. /client/ledgeraiph.<company>.com/dashboard)
  useEffect(() => {
    if (user && activeCompany && !loading) {
      const isPrefixed = /^\/(?:client|server)\/[^\/]+/.test(location.pathname);
      if (!isPrefixed) {
        const mode = (typeof window !== 'undefined' && window.location.hash.includes('/server')) ? 'server' : 'client';
        const domain = getCompanyVanityDomain(activeCompany);
        const subPath = location.pathname === '/' || location.pathname === '/dashboard' ? '/dashboard' : location.pathname;
        navigate(`/${mode}/${domain}${subPath}${location.search}`, { replace: true });
      }
    }
  }, [user, activeCompany, loading, location.pathname, location.search, navigate]);
  
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-2.5 font-semibold text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-sky-400" />
          <span>Verifying secure workspace session...</span>
        </div>
      </div>
    );
  }
  
  if (!user || !activeCompany) {
    if (token) {
      return (
        <div className="flex h-screen items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2.5 font-semibold text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-sky-400" />
            <span>Loading company profile session...</span>
          </div>
        </div>
      );
    }
    const mode = (typeof window !== 'undefined' && window.location.hash.includes('/server')) ? 'server' : 'client';
    return <Navigate to={`/${mode}/launcher`} replace />;
  }
  
  return (
    <ErrorBoundary>
      <Layout>
        <ProtectedRoute minRole={minRole} allowedRoles={allowedRoles} requiredPermission={requiredPermission}>
          {children}
        </ProtectedRoute>
      </Layout>
    </ErrorBoundary>
  );
};

function ThemeSyncBridge({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    if (user?.theme && user.theme !== theme) {
      setTheme(user.theme as ThemeMode, false);
    }
  }, [user?.theme]);

  return <>{children}</>;
}

export default function ClientApp() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <NotificationProvider>
          <ThemeSyncBridge>
            <HashRouter>
              <ServerConnectionBanner />
              <WorkspaceFilterProvider>
                <ActiveModuleProvider>
                  <Routes>
                    {/* Client Vanity & Landing Routes */}
                    <Route path="/client/launcher" element={<Launcher />} />
                    <Route path="/client" element={<Navigate to="/client/launcher" replace />} />
                    <Route path="/client/select-company" element={<CompanySelector />} />
                    <Route path="/client/:tenantDomain/login" element={<Login />} />
                    <Route path="/client/:tenantDomain/dashboard" element={<AuthGuard requiredPermission="dashboard:view"><Dashboard /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/operations/*" element={<AuthGuard requiredPermission={['operations:view', 'sales:view', 'purchases:view', 'inventory:view', 'payroll:view', 'fixedassets:view']}><Operations /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/accounting/*" element={<AuthGuard requiredPermission={['accounting:view', 'sales:view', 'purchases:view', 'inventory:view', 'cash:view', 'bank_rec:view', 'fixedassets:view', 'payroll:view']}><Accounting /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/tax/*" element={<AuthGuard requiredPermission="tax:view"><Tax /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/documents/*" element={<AuthGuard requiredPermission="documents:view"><Documents /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/reports/*" element={<AuthGuard requiredPermission={['reports:view', 'accounting:view']}><Reports /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/budget/*" element={<AuthGuard requiredPermission="budget:view"><BudgetPlanning /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/activity-center/*" element={<AuthGuard requiredPermission={['activity:view', 'approvals:view', 'audit:view']}><GlobalActivityCenter /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/approvals/*" element={<AuthGuard requiredPermission="approvals:view"><GlobalActivityCenter /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/audit/*" element={<AuthGuard requiredPermission="audit:view"><Audit /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/settings/*" element={<AuthGuard requiredPermission="settings:view"><Settings /></AuthGuard>} />
                    <Route path="/client/:tenantDomain/master-data/*" element={<AuthGuard requiredPermission={['masterdata:view', 'roles:manage', 'backups:view', 'backup:view', 'storage:view', 'settings:view']}><MasterData /></AuthGuard>} />
                    <Route path="/client/:tenantDomain" element={<AuthGuard requiredPermission="dashboard:view"><Dashboard /></AuthGuard>} />

                    {/* Server Vanity & Landing Routes */}
                    <Route path="/server/launcher" element={<Launcher />} />
                    <Route path="/server" element={<Navigate to="/server/launcher" replace />} />
                    <Route path="/server/profile/create" element={<CreateProfile />} />
                    <Route path="/server/profile/open" element={<OpenProfile />} />
                    <Route path="/server/profile/restore" element={<RestoreProfile />} />
                    <Route path="/server/select-company" element={<CompanySelector />} />
                    <Route path="/server/:tenantDomain/login" element={<Login />} />
                    <Route path="/server/:tenantDomain/dashboard" element={<AuthGuard requiredPermission="dashboard:view"><Dashboard /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/operations/*" element={<AuthGuard requiredPermission={['operations:view', 'sales:view', 'purchases:view', 'inventory:view', 'payroll:view', 'fixedassets:view']}><Operations /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/accounting/*" element={<AuthGuard requiredPermission={['accounting:view', 'sales:view', 'purchases:view', 'inventory:view', 'cash:view', 'bank_rec:view', 'fixedassets:view', 'payroll:view']}><Accounting /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/tax/*" element={<AuthGuard requiredPermission="tax:view"><Tax /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/documents/*" element={<AuthGuard requiredPermission="documents:view"><Documents /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/reports/*" element={<AuthGuard requiredPermission={['reports:view', 'accounting:view']}><Reports /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/budget/*" element={<AuthGuard requiredPermission="budget:view"><BudgetPlanning /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/activity-center/*" element={<AuthGuard requiredPermission={['activity:view', 'approvals:view', 'audit:view']}><GlobalActivityCenter /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/approvals/*" element={<AuthGuard requiredPermission="approvals:view"><GlobalActivityCenter /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/audit/*" element={<AuthGuard requiredPermission="audit:view"><Audit /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/settings/*" element={<AuthGuard requiredPermission="settings:view"><Settings /></AuthGuard>} />
                    <Route path="/server/:tenantDomain/master-data/*" element={<AuthGuard requiredPermission={['masterdata:view', 'roles:manage', 'backups:view', 'backup:view', 'storage:view', 'settings:view']}><MasterData /></AuthGuard>} />
                    <Route path="/server/:tenantDomain" element={<AuthGuard requiredPermission="dashboard:view"><Dashboard /></AuthGuard>} />

                    {/* Direct Unprefixed & Legacy Routes (100% Backward Compatible) */}
                    <Route path="/launcher" element={<Launcher />} />
                    <Route path="/profile/create" element={<CreateProfile />} />
                    <Route path="/profile/open" element={<OpenProfile />} />
                    <Route path="/profile/restore" element={<RestoreProfile />} />
                    <Route path="/select-company" element={<CompanySelector />} />
                    <Route path="/login/:companyId" element={<Login />} />
                    <Route path="/login" element={<Navigate to="/client/launcher" replace />} />
                    <Route path="/key-generator" element={<Navigate to="/client/launcher" replace />} />
                    <Route path="/authority" element={<Navigate to="/client/launcher" replace />} />

                    <Route path="/" element={<AuthGuard requiredPermission="dashboard:view"><Dashboard /></AuthGuard>} />
                    <Route path="/dashboard" element={<Navigate to="/" replace />} />
                    <Route path="/operations/*" element={<AuthGuard requiredPermission={['operations:view', 'sales:view', 'purchases:view', 'inventory:view', 'payroll:view', 'fixedassets:view']}><Operations /></AuthGuard>} />
                    <Route path="/accounting/*" element={<AuthGuard requiredPermission={['accounting:view', 'sales:view', 'purchases:view', 'inventory:view', 'cash:view', 'bank_rec:view', 'fixedassets:view', 'payroll:view']}><Accounting /></AuthGuard>} />
                    <Route path="/tax/*" element={<AuthGuard requiredPermission="tax:view"><Tax /></AuthGuard>} />
                    <Route path="/documents/*" element={<AuthGuard requiredPermission="documents:view"><Documents /></AuthGuard>} />
                    <Route path="/reports/*" element={<AuthGuard requiredPermission={['reports:view', 'accounting:view']}><Reports /></AuthGuard>} />
                    <Route path="/budget/*" element={<AuthGuard requiredPermission="budget:view"><BudgetPlanning /></AuthGuard>} />
                    <Route path="/activity-center/*" element={<AuthGuard requiredPermission={['activity:view', 'approvals:view', 'audit:view']}><GlobalActivityCenter /></AuthGuard>} />
                    <Route path="/approvals/*" element={<AuthGuard requiredPermission="approvals:view"><GlobalActivityCenter /></AuthGuard>} />
                    <Route path="/audit/*" element={<AuthGuard requiredPermission="audit:view"><Audit /></AuthGuard>} />
                    <Route path="/audit-engagements/*" element={<Navigate to="/audit/engagements" replace />} />
                    <Route path="/audit-workpapers/*" element={<Navigate to="/audit/workpapers" replace />} />
                    <Route path="/audit-findings/*" element={<Navigate to="/audit/findings" replace />} />
                    <Route path="/approval-workflow/*" element={<Navigate to="/activity-center?workspace=approvals" replace />} />
                    <Route path="/fraud-detection/*" element={<Navigate to="/audit/fraud" replace />} />
                    <Route path="/backup-manager/*" element={<Navigate to="/master-data/backup-vault" replace />} />
                    <Route path="/audit-log/*" element={<Navigate to="/audit/logs" replace />} />
                    <Route path="/lan-server/*" element={<Navigate to="/master-data/lan-network" replace />} />
                    <Route path="/admin/licenses" element={<Navigate to="/settings" replace />} />
                    <Route path="/settings/licenses" element={<Navigate to="/settings" replace />} />
                    <Route path="/settings/*" element={<AuthGuard requiredPermission="settings:view"><Settings /></AuthGuard>} />
                    <Route path="/master-data/*" element={<AuthGuard requiredPermission={['masterdata:view', 'roles:manage', 'backups:view', 'backup:view', 'storage:view', 'settings:view']}><MasterData /></AuthGuard>} />
                    
                    <Route path="*" element={<Navigate to="/client/launcher" replace />} />
                  </Routes>
                </ActiveModuleProvider>
              </WorkspaceFilterProvider>
            </HashRouter>
          </ThemeSyncBridge>
        </NotificationProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
