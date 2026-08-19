import React from 'react';
import { useAuth, LedgerRole } from '../context/AuthContext';
import { ShieldAlert, ArrowLeft, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: LedgerRole[];
  minRole?: LedgerRole;
  requiredPermission?: string;
}

const ROLE_LEVELS: Record<LedgerRole, number> = {
  'Company Owner': 90,
  'Company Administrator': 80,
  'Approver': 70,
  'Reviewer': 60,
  'Accountant': 50,
  'Bookkeeper': 40,
  'Auditor': 30,
  'Read-only User': 10,
};

export const RoleBadge: React.FC<{ role: LedgerRole; size?: 'sm' | 'md' }> = ({ role, size = 'md' }) => {
  const badgeStyles: Record<LedgerRole, string> = {
  'Company Owner': 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  'Company Administrator': 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  'Approver': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  'Reviewer': 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
  'Accountant': 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  'Bookkeeper': 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  'Auditor': 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  'Read-only User': 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
};

  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${padding} ${badgeStyles[role]}`}>
      <Lock className="w-3 h-3" />
      {role}
    </span>
  );
};

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, minRole, requiredPermission }) => {
  const { user, userRole, hasPermission, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-gray-500 dark:text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12 bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Authentication Required</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Please log in to access this page.</p>
        <Link to="/login" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm">
          Go to Login
        </Link>
      </div>
    );
  }

  let isAuthorized = true;

  if (allowedRoles && allowedRoles.length > 0) {
    isAuthorized = allowedRoles.includes(userRole);
  }

  if (minRole && isAuthorized) {
    const userLevel = ROLE_LEVELS[userRole] || 1;
    const requiredLevel = ROLE_LEVELS[minRole] || 1;
    if (userLevel < requiredLevel) {
      isAuthorized = false;
    }
  }

  if (requiredPermission && isAuthorized) {
    isAuthorized = hasPermission(requiredPermission);
  }

  if (!isAuthorized) {
    const requiredDesc = requiredPermission
      ? `Permission '${requiredPermission}'`
      : minRole
        ? `Minimum '${minRole}' role`
        : allowedRoles
          ? allowedRoles.join(' or ')
          : 'Higher privileges';

    return (
      <div className="p-8 max-w-lg mx-auto my-12 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-2">Access Restricted</h2>
        <p className="text-sm text-center text-gray-600 dark:text-gray-400 mb-6">
          You do not have the required role permissions to view or perform actions on this route.
        </p>

        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-100 dark:border-gray-700/50 space-y-3 mb-6">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500 dark:text-gray-400">Your Current Role:</span>
            <RoleBadge role={userRole} />
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500 dark:text-gray-400">Required Authorization:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{requiredDesc}</span>
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
