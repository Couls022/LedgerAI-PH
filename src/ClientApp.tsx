import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './client/components/Layout';
import Dashboard from './client/pages/Dashboard';
import Operations from './client/pages/Operations';
import Accounting from './client/pages/Accounting';
import Tax from './client/pages/Tax';
import Documents from './client/pages/Documents';
import Reports from './client/pages/Reports';
import Audit from './client/pages/Audit';
import AuditLog from './client/pages/AuditLog';
import AuditEngagements from './client/pages/AuditEngagements';
import Settings from './client/pages/Settings';
import MasterData from './client/pages/MasterData';
import BudgetPlanning from './client/pages/BudgetPlanning';
import Login from './client/pages/Login';
import Launcher from './client/pages/Launcher';
import CreateProfile from './client/pages/CreateProfile';
import OpenProfile from './client/pages/OpenProfile';
import RestoreProfile from './client/pages/RestoreProfile';
import LicenseAuthorityApp from '../internal/authority-ui/LicenseAuthorityApp';
import { AuthProvider, useAuth, LedgerRole } from './client/context/AuthContext';
import { ThemeProvider, useTheme, ThemeMode } from './client/context/ThemeContext';
import { NotificationProvider } from './client/context/NotificationContext';
import { ProtectedRoute } from './client/components/ProtectedRoute';
import ErrorBoundary from './client/components/ErrorBoundary';
import { Loader2 } from 'lucide-react';

const AuthGuard = ({ children, minRole, allowedRoles, requiredPermission }: { children: React.ReactNode; minRole?: LedgerRole; allowedRoles?: LedgerRole[]; requiredPermission?: string }) => {
  const { user, activeCompany, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-2.5 font-semibold text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span>Verifying secure workspace session...</span>
        </div>
      </div>
    );
  }
  
  if (!user || !activeCompany) {
    return <Navigate to="/launcher" />;
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
              <Routes>
                <Route path="/launcher" element={<Launcher />} />
                <Route path="/key-generator" element={<LicenseAuthorityApp />} />
                <Route path="/authority" element={<LicenseAuthorityApp />} />
                <Route path="/profile/create" element={<CreateProfile />} />
                <Route path="/profile/open" element={<OpenProfile />} />
                <Route path="/profile/restore" element={<RestoreProfile />} />
                <Route path="/login/:companyId" element={<Login />} />
                <Route path="/login" element={<Navigate to="/launcher" />} />
                
                <Route path="/" element={<AuthGuard requiredPermission="dashboard:view"><Dashboard /></AuthGuard>} />
                <Route path="/operations/*" element={<AuthGuard requiredPermission="operations:view"><Operations /></AuthGuard>} />
                <Route path="/accounting/*" element={<AuthGuard requiredPermission="accounting:view"><Accounting /></AuthGuard>} />
                <Route path="/tax/*" element={<AuthGuard requiredPermission="tax:view"><Tax /></AuthGuard>} />
                <Route path="/documents/*" element={<AuthGuard requiredPermission="documents:view"><Documents /></AuthGuard>} />
                <Route path="/reports/*" element={<AuthGuard requiredPermission="reports:view"><Reports /></AuthGuard>} />
                <Route path="/budget/*" element={<AuthGuard requiredPermission="budget:view"><BudgetPlanning /></AuthGuard>} />
                <Route path="/audit/*" element={<AuthGuard requiredPermission="audit:view"><Audit /></AuthGuard>} />
                <Route path="/audit-engagements/*" element={<Navigate to="/audit" replace />} />
                <Route path="/audit-workpapers/*" element={<Navigate to="/audit" replace />} />
                <Route path="/audit-findings/*" element={<Navigate to="/audit" replace />} />
                <Route path="/approval-workflow/*" element={<Navigate to="/audit" replace />} />
                <Route path="/fraud-detection/*" element={<Navigate to="/audit" replace />} />
                <Route path="/backup-manager/*" element={<Navigate to="/settings" replace />} />
                <Route path="/audit-log/*" element={<Navigate to="/audit/logs" replace />} />
                <Route path="/lan-server/*" element={<Navigate to="/settings" replace />} />
                <Route path="/admin/licenses" element={<Navigate to="/settings" replace />} />
                <Route path="/settings/licenses" element={<Navigate to="/settings" replace />} />
                <Route path="/settings/*" element={<AuthGuard requiredPermission="settings:view"><Settings /></AuthGuard>} />
                <Route path="/master-data/*" element={<AuthGuard requiredPermission="masterdata:view"><MasterData /></AuthGuard>} />
                
                <Route path="*" element={<Navigate to="/launcher" />} />
              </Routes>
            </HashRouter>
          </ThemeSyncBridge>
        </NotificationProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
