import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { 
  Home, BookOpen, FileText, FolderOpen, BarChart3, 
  ShieldCheck, Settings, LogOut, PanelLeftClose, PanelLeftOpen, Repeat, Sun, Moon, Mail, PieChart, Printer,
  X, Key, Database, Activity, Sparkles, Building2
} from 'lucide-react';
import { LedgerLogo, LedgerLogoIcon } from './LedgerLogo';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { RoleBadge } from './ProtectedRoute';
import { NotificationBell, LiveNotificationToast } from './NotificationCenter';
import GlobalSearch from './GlobalSearch';
import BackupReminder from './BackupReminder';
import OnboardingTour from './OnboardingTour';
import EmailReminderModal from './EmailReminderModal';
import PrintCustomizerModal from './PrintCustomizerModal';
import LicensingBanner from './licensing/LicensingBanner';
import { LedgerAgentOverlay } from './LedgerAgentOverlay';

function LicenseStatusBadge() {
  const [license, setLicense] = useState<any>(null);

  const fetchLicense = async () => {
    try {
      const res = await fetch('/api/licenses/status?t=' + Date.now());
      if (res.ok) {
        setLicense(await res.json());
      }
    } catch (e) {}
  };

  React.useEffect(() => {
    fetchLicense();
    window.addEventListener('refresh-license-banner', fetchLicense);
    return () => window.removeEventListener('refresh-license-banner', fetchLicense);
  }, []);

  if (!license) return null;

  const isActive = license.status === 'ACTIVE' || license.status === 'ACTIVATED';
  const displayStatus = isActive ? 'ACTIVE' : 'TRIAL';
  
  const baseClasses = "flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wider uppercase whitespace-nowrap";
  const colors = isActive 
    ? "bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
    : "bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800";

  return (
    <div className={`${baseClasses} ${colors}`} title={`License Status: ${license.status}`}>
      <ShieldCheck className="w-3 h-3" />
      <span>{displayStatus}</span>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [isPrintCustomizerOpen, setIsPrintCustomizerOpen] = useState(false);

  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{type: 'success' | 'error', message: string}>({type: 'success', message: ''});

  const { user, activeCompany, userRole, hasPermission, logout, updateUser } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/launcher');
  };

  const handleSwitchCompany = async () => {
    await logout();
    navigate('/profile/open');
  };

  const toggleTheme = async () => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    await setTheme(nextTheme, true);
    if (user) {
      await updateUser({ theme: nextTheme });
    }
  };

  const submitChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }
    setIsChangingPassword(true);
    setPasswordStatus({ type: 'success', message: '' });
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordStatus({ type: 'success', message: 'Password changed successfully.' });
        setTimeout(() => {
          setIsChangePasswordOpen(false);
          setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
          setPasswordStatus({ type: 'success', message: '' });
        }, 1500);
      } else {
        setPasswordStatus({ type: 'error', message: data.message || 'Failed to change password.' });
      }
    } catch (e) {
      setPasswordStatus({ type: 'error', message: 'An error occurred.' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const submitLogoutAll = async () => {
    if (!confirm('Are you sure you want to sign out of all devices?')) return;
    try {
      await fetch('/api/auth/logout-all', { method: 'POST' });
      await logout();
      navigate('/launcher');
    } catch (e) {
      console.error(e);
    }
  };

  const navConfig = [
    {
      id: 'dashboard',
      name: 'Dashboard',
      path: '/',
      icon: Home,
      permission: 'dashboard:view'
    },
    {
      id: 'operations',
      name: 'Operations',
      path: '/operations',
      icon: Activity,
      permission: 'operations:view'
    },
    {
      id: 'accounting',
      name: 'Accounting',
      path: '/accounting',
      icon: BookOpen,
      permission: 'accounting:view'
    },
    {
      id: 'tax',
      name: 'Tax & Compliance',
      path: '/tax',
      icon: FileText,
      permission: 'tax:view'
    },
    {
      id: 'budget',
      name: 'Budget Planning',
      path: '/budget',
      icon: PieChart,
      permission: 'budget:view'
    },
    {
      id: 'documents',
      name: 'Documents',
      path: '/documents',
      icon: FolderOpen,
      permission: 'documents:view'
    },
    {
      id: 'reports',
      name: 'Reports',
      path: '/reports',
      icon: BarChart3,
      permission: 'reports:view'
    },
    {
      id: 'audit',
      name: 'Audit',
      path: '/audit',
      icon: ShieldCheck,
      permission: 'audit:view'
    },
    {
      id: 'master-data',
      name: 'Master Data',
      path: '/master-data',
      icon: Database,
      permission: 'masterdata:view'
    },
    {
      id: 'settings',
      name: 'Settings',
      path: '/settings',
      icon: Settings,
      permission: 'settings:view'
    }
  ];

  return (
    <div className="flex h-screen w-full bg-[#f4f6fb] dark:bg-[#090d16] font-sans text-slate-800 dark:text-slate-100 transition-colors">
      {/* Redesigned Sidebar with Distinctive LedgerAI PH identity */}
      <aside className={`bg-[#0c1322] dark:bg-[#0d1424] border-r border-[#1a253c] flex flex-col shrink-0 transition-all duration-300 ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}>
        {/* Brand Header */}
        <div className="p-4 flex items-center justify-between border-b border-[#1a253c]/80">
          <div className="flex items-center space-x-3 overflow-hidden">
            <LedgerLogoIcon size={28} className="shrink-0" />
            {!isSidebarCollapsed && (
              <div className="flex flex-col truncate">
                <div className="flex items-center gap-1.5 leading-tight">
                  <span className="text-white font-extrabold text-base tracking-tight">Ledger<span className="text-indigo-400">AI</span></span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">PH</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">Enterprise ERP</span>
              </div>
            )}
          </div>
          <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a253c] transition-colors"
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="w-4.5 h-4.5" /> : <PanelLeftClose className="w-4.5 h-4.5" />}
          </button>
        </div>
        
        {/* Navigation List */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
          {navConfig.filter(item => {
            if (item.permission) {
              return hasPermission(item.permission);
            }
            return true;
          }).map((item) => {
            const isItemActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));

            return (
              <div key={item.id}>
                <NavLink
                  to={item.path || '#'}
                  title={isSidebarCollapsed ? item.name : undefined}
                  className={
                    `relative flex items-center justify-between px-3 py-2.5 h-[42px] rounded-xl transition-all text-sm ${
                      isItemActive 
                        ? 'bg-indigo-600 text-white shadow-xs font-semibold' 
                        : 'text-slate-300 hover:bg-[#162136] hover:text-white font-medium'
                    }`
                  }
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <item.icon className={`w-[21px] h-[21px] shrink-0 ${isItemActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />
                    {!isSidebarCollapsed && <span className="truncate tracking-wide text-sm">{item.name}</span>}
                  </div>
                  {isItemActive && !isSidebarCollapsed && (
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-xs shrink-0" />
                  )}
                </NavLink>
              </div>
            );
          })}
        </nav>

        {/* User Card & Security Controls */}
        <div className="p-3.5 border-t border-[#1a253c]/80 bg-[#090e1a]">
          <div className="flex items-center justify-between">
            {!isSidebarCollapsed && (
              <div className="flex items-center space-x-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs text-white font-bold shrink-0 shadow-inner">
                  {user?.displayName?.[0] || 'U'}
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-slate-100 truncate">{user?.displayName || 'Active User'}</p>
                  <p className="text-[11px] font-medium text-slate-400 truncate">{userRole || 'Member'}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsChangePasswordOpen(true)} 
                className="p-1.5 text-slate-400 hover:text-indigo-300 transition-colors rounded-lg hover:bg-[#1a253c]" 
                title="Change Password"
                aria-label="Change Password"
              >
                <Key className="w-4 h-4" />
              </button>
              <button 
                onClick={handleLogout} 
                className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors rounded-lg hover:bg-[#1a253c]" 
                title="Logout"
                aria-label="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#f4f6fb] dark:bg-[#090d16]">
        {/* Eye-Comfort Top Header */}
        <header className="h-16 shrink-0 bg-white/80 dark:bg-[#101726]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-[#1e293d] flex items-center justify-between px-6 transition-colors shadow-xs z-10">
          {/* Breadcrumb Workspace Indicator */}
          <div className="flex items-center text-xs font-semibold text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
              <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="font-bold text-slate-900 dark:text-slate-100 max-w-[220px] truncate">
                {activeCompany?.legalName || 'LedgerAI Active Workspace'}
              </span>
            </div>
            <span className="mx-2 text-slate-300 dark:text-slate-600">/</span>
            <RoleBadge role={userRole} size="sm" />
            <span className="mx-2 text-slate-300 dark:text-slate-600">/</span>
            <LicenseStatusBadge />
          </div>

          {/* Quick Actions & Utility Tools */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsPrintCustomizerOpen(true)}
              className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 px-2.5 py-1.5 rounded-xl transition-colors bg-white dark:bg-slate-800"
              title="Customize Print Layouts with Brand Logo & Info"
            >
              <Printer className="w-3.5 h-3.5 text-indigo-500" />
              <span>Print Layouts</span>
            </button>

            <button
              onClick={() => setIsReminderModalOpen(true)}
              className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600 px-2.5 py-1.5 rounded-xl transition-colors bg-white dark:bg-slate-800"
              title="Automated Friendly Overdue Invoice Reminders"
            >
              <Mail className="w-3.5 h-3.5 text-amber-500" />
              <span>Reminders</span>
            </button>

            <OnboardingTour />
            <GlobalSearch />
            <NotificationBell />

            {/* Accessible Theme Switcher */}
            <button
              onClick={toggleTheme}
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800 rounded-xl transition-colors bg-white dark:bg-slate-800"
              title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
              aria-label={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {resolvedTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {/* Switch Company Profile */}
            <button 
              onClick={handleSwitchCompany}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 px-3 py-1.5 rounded-xl transition-colors bg-white dark:bg-slate-800"
              title="Switch to another company profile"
            >
              <Repeat className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span className="hidden xl:inline">Switch Company</span>
            </button>
          </div>
        </header>

        {/* Informative Banners & System Overlays */}
        <LicensingBanner />
        <BackupReminder />
        <LiveNotificationToast />

        <EmailReminderModal
          isOpen={isReminderModalOpen}
          onClose={() => setIsReminderModalOpen(false)}
        />

        <PrintCustomizerModal
          isOpen={isPrintCustomizerOpen}
          onClose={() => setIsPrintCustomizerOpen(false)}
        />

        <LedgerAgentOverlay />

        {/* Scrollable Viewport with Optimal Eye-Comfort Padding */}
        <div className="flex-1 overflow-auto p-6 md:p-8">
          {children}
        </div>
      </main>

      {/* Password Change Dialog */}
      {isChangePasswordOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/40">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Change Account Password</h2>
              </div>
              <button 
                onClick={() => setIsChangePasswordOpen(false)} 
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitChangePassword} className="p-5 space-y-4">
              {passwordStatus.message && (
                <div className={`p-3 text-xs font-semibold rounded-xl border ${
                  passwordStatus.type === 'error' 
                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' 
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                }`}>
                  {passwordStatus.message}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Current Password</label>
                <input 
                  type="password" 
                  required 
                  minLength={8} 
                  value={passwordForm.currentPassword} 
                  onChange={e => setPasswordForm({...passwordForm, currentPassword: e.target.value})} 
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">New Password</label>
                <input 
                  type="password" 
                  required 
                  minLength={8} 
                  value={passwordForm.newPassword} 
                  onChange={e => setPasswordForm({...passwordForm, newPassword: e.target.value})} 
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Confirm New Password</label>
                <input 
                  type="password" 
                  required 
                  minLength={8} 
                  value={passwordForm.confirmPassword} 
                  onChange={e => setPasswordForm({...passwordForm, confirmPassword: e.target.value})} 
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                />
              </div>
              <button 
                type="submit" 
                disabled={isChangingPassword} 
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs disabled:opacity-50 transition-colors"
              >
                {isChangingPassword ? 'Updating Password...' : 'Update Password'}
              </button>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button 
                  type="button" 
                  onClick={submitLogoutAll} 
                  className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:hover:bg-rose-900/50 dark:text-rose-400 rounded-xl font-semibold text-xs transition-colors border border-rose-200 dark:border-rose-900/50"
                >
                  Sign out of all devices
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

