import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Home, BookOpen, BarChart3, ShoppingCart,
  ShieldCheck, Sun, Moon, Mail, Printer, Repeat,
  X, Key, Building2, Menu, Calendar, MoreHorizontal, SlidersHorizontal
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useWorkspaceFilter } from '../context/WorkspaceFilterContext';
import { NotificationBell, LiveNotificationToast } from './NotificationCenter';
import GlobalSearch from './GlobalSearch';
import BackupReminder from './BackupReminder';
import OnboardingTour from './OnboardingTour';
import EmailReminderModal from './EmailReminderModal';
import PrintCustomizerModal from './PrintCustomizerModal';
import LicensingBanner from './licensing/LicensingBanner';
import { LedgerAgentOverlay } from './LedgerAgentOverlay';
import ErpSidebar from './ErpSidebar';
import WorkspaceDateTimeFilterBar from './shared/WorkspaceDateTimeFilterBar';
import { BackToTop } from './shared/BackToTop';
import { getCanonicalModuleForRoute } from '../../shared/moduleRegistry';
import { attachResizableTableColumns } from '../utils/uiLayoutUtils';

function LicenseStatusIndicator() {
  const [license, setLicense] = useState<any>(null);
  const { activeCompany } = useAuth();

  const fetchLicense = async () => {
    if (!activeCompany) return;
    try {
      const res = await fetch('/api/licenses/status?t=' + Date.now());
      if (res.ok) {
        setLicense(await res.json());
      }
    } catch {}
  };

  useEffect(() => {
    if (activeCompany) {
      fetchLicense();
    }
    window.addEventListener('refresh-license-banner', fetchLicense);
    return () => window.removeEventListener('refresh-license-banner', fetchLicense);
  }, [activeCompany?.id]);

  if (!license || !activeCompany) return null;

  const isActive = license.status === 'ACTIVE' || license.status === 'ACTIVATED';
  const displayStatus = isActive ? 'Active' : 'Trial';

  return (
    <span
      className={`hidden 2xl:inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
        isActive ? 'text-teal-700 dark:text-teal-400' : 'text-amber-700 dark:text-amber-400'
      }`}
      title={`Workspace License: ${license.status}`}
    >
      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
      <span>{displayStatus}</span>
    </span>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  // Auto-adapt sidebar for Compact Laptop (1024px-1399px) vs Wide Desktop (>=1400px)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= 1024 && window.innerWidth < 1400;
  });
  const [userManuallyToggledSidebar, setUserManuallyToggledSidebar] = useState(false);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [isPrintCustomizerOpen, setIsPrintCustomizerOpen] = useState(false);

  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{ type: 'success' | 'error'; message: string }>({
    type: 'success',
    message: '',
  });
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const mainViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = mainViewportRef.current;
    if (!viewport) return;
    const handle = attachResizableTableColumns(viewport, undefined, {
      skipInsideTableScrollContainer: true,
    });
    return () => handle.cleanup();
  }, []);

  const { user, activeCompany, userRole, workspaceSessionEpoch, logout, updateUser } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const { isFilterActive, summaryLabel, isBarOpen, toggleBarOpen, setIsBarOpen } = useWorkspaceFilter();
  const navigate = useNavigate();
  const location = useLocation();

  // Keep Compact Laptop vs Wide Desktop sidebar auto-responsive unless manually overridden
  useEffect(() => {
    const handleResize = () => {
      if (userManuallyToggledSidebar) return;
      if (window.innerWidth >= 1024 && window.innerWidth < 1400) {
        setIsSidebarCollapsed(true);
      } else if (window.innerWidth >= 1400) {
        setIsSidebarCollapsed(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [userManuallyToggledSidebar]);

  // Close tools popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    };
    if (isToolsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isToolsMenuOpen]);

  // Auto-hide scrollbars during idle (REQ-UX-SCROLLBAR-001)
  useEffect(() => {
    const scrollTimers = new WeakMap<HTMLElement, NodeJS.Timeout>();

    const handleGlobalScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && target.classList) {
        target.classList.add('is-scrolling');
        const existingTimer = scrollTimers.get(target);
        if (existingTimer) clearTimeout(existingTimer);
        const newTimer = setTimeout(() => {
          target.classList.remove('is-scrolling');
          scrollTimers.delete(target);
        }, 800);
        scrollTimers.set(target, newTimer);
      }
    };

    window.addEventListener('scroll', handleGlobalScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', handleGlobalScroll, { capture: true });
    };
  }, []);

  const handleToggleSidebar = () => {
    setUserManuallyToggledSidebar(true);
    setIsSidebarCollapsed((prev) => !prev);
  };

  const handleSwitchCompany = () => {
    const currentMode = location.pathname.startsWith('/server') ? 'server' : 'client';
    navigate(`/${currentMode}/select-company`);
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
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
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
    } catch {
      setPasswordStatus({ type: 'error', message: 'An error occurred.' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const submitLogoutAll = async () => {
    setLoggingOutAll(true);
    try {
      await fetch('/api/auth/logout-all', { method: 'POST' });
      await logout();
      setConfirmLogoutAll(false);
      const currentMode = location.pathname.startsWith('/server') ? 'server' : 'client';
      navigate(`/${currentMode}/launcher`);
    } catch (e) {
      console.error(e);
      setPasswordStatus({ type: 'error', message: 'Failed to sign out of all devices.' });
    } finally {
      setLoggingOutAll(false);
    }
  };

  const tenantPrefix = (location.pathname.match(/^(\/(?:client|server)\/[^\/]+)/) || [])[1] || '';
  const toPrefixedRoute = (route: string) => tenantPrefix ? (tenantPrefix + (route === '/' ? '' : route)) : route;

  useEffect(() => {
    const handleOpenLicenseModal = () => {
      const target = tenantPrefix ? `${tenantPrefix}/settings?tab=license` : '/settings?tab=license';
      navigate(target);
    };
    window.addEventListener('open-license-modal', handleOpenLicenseModal);
    return () => window.removeEventListener('open-license-modal', handleOpenLicenseModal);
  }, [tenantPrefix, navigate]);
  const normalizedPath = location.pathname.replace(/^\/(?:client|server)\/[^\/]+/, '') || '/';
  const normalizedFullPath = normalizedPath + location.search;

  const currentCanonicalMod = getCanonicalModuleForRoute(location.pathname, location.search);
  const currentSubmodule =
    currentCanonicalMod?.submodules.find((s) => normalizedFullPath === s.route) ||
    currentCanonicalMod?.submodules.find((s) => normalizedPath === s.route.split('?')[0]);

  const mobileNavItems = [
    { id: 'home', label: 'Home', to: toPrefixedRoute('/'), icon: Home, match: (p: string) => p === '/' || p.endsWith('/dashboard') },
    { id: 'sales', label: 'Sales', to: toPrefixedRoute('/accounting/invoices'), icon: ShoppingCart, match: (p: string) => p.includes('/invoices') || p.includes('/customers') },
    { id: 'ledger', label: 'Ledger', to: toPrefixedRoute('/accounting/journals'), icon: BookOpen, match: (p: string) => p.includes('/accounting') && !p.includes('/invoices') },
    { id: 'reports', label: 'Reports', to: toPrefixedRoute('/reports/trial-balance'), icon: BarChart3, match: (p: string) => p.includes('/reports') || p.includes('/tax') },
  ];

  return (
    <div className="flex h-screen w-full bg-[#F5F7FA] dark:bg-[#0B1120] font-sans text-slate-800 dark:text-slate-100 transition-colors overflow-hidden">
      {/* Adaptive Sidebar (Wide Desktop / Compact Laptop Rail / Tablet Rail / Mobile Drawer) */}
      <ErpSidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        onChangePasswordOpen={() => setIsChangePasswordOpen(true)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenMobile={() => setIsMobileSidebarOpen(true)}
      />

      {/* Main Workspace Frame */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#F5F7FA] dark:bg-[#0B1120]">
        {/* Crisp Unboxed Top Header — 56px Mobile / 64px Desktop */}
        <header className="h-14 md:h-16 shrink-0 bg-white/90 dark:bg-[#11192B]/95 backdrop-blur-md border-b border-slate-200/90 dark:border-[#1E2D45] flex items-center justify-between px-3 sm:px-5 lg:px-6 transition-colors z-20 gap-2">
          {/* Left: Mobile Menu Trigger & Clean Editorial Breadcrumb */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden p-2 -ml-1 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1B2942] transition-colors shrink-0 cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <nav aria-label="Workspace breadcrumb" className="flex items-center text-xs min-w-0 overflow-hidden">
              <div className="flex items-center gap-1.5 min-w-0">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0 hidden sm:block" />
                <span className="font-display font-bold text-slate-900 dark:text-slate-100 truncate max-w-[140px] sm:max-w-[180px] lg:max-w-[210px]">
                  {activeCompany?.legalName || 'LedgerAI PH'}
                </span>
              </div>

              {currentCanonicalMod && (
                <div className="hidden sm:flex items-center min-w-0">
                  <span className="mx-2 text-slate-300 dark:text-slate-600 shrink-0">/</span>
                  <span className="font-semibold text-blue-700 dark:text-sky-400 truncate max-w-[130px] lg:max-w-[170px]">
                    {currentCanonicalMod.label}
                  </span>
                </div>
              )}

              {currentSubmodule && (
                <div className="hidden xl:flex items-center min-w-0">
                  <span className="mx-2 text-slate-300 dark:text-slate-600 shrink-0">/</span>
                  <span className="font-medium text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
                    {currentSubmodule.label}
                  </span>
                </div>
              )}

              {userRole && (
                <div className="hidden 2xl:flex items-center shrink-0">
                  <span className="mx-2 text-slate-300 dark:text-slate-600">/</span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {userRole}
                  </span>
                </div>
              )}

              <div className="hidden 2xl:flex items-center shrink-0">
                <span className="mx-2 text-slate-300 dark:text-slate-600">/</span>
                <LicenseStatusIndicator />
              </div>
            </nav>
          </div>

          {/* Right: Period Filter Toggle + Search + Notifications + Theme + Compact Tools */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Global Date/Time Period Filter Trigger */}
            <button
              type="button"
              onClick={toggleBarOpen}
              data-testid="toggle-period-filter-btn"
              className={`inline-flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-xs font-semibold border whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                isBarOpen || isFilterActive
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300 border-blue-200 dark:border-blue-800'
                  : 'bg-white dark:bg-[#162238] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#24344F] hover:border-slate-300 dark:hover:border-[#334766]'
              }`}
              title={`Date & Time Filter (${summaryLabel})`}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline max-w-[120px] xl:max-w-[160px] truncate">
                {isFilterActive ? summaryLabel : 'Period'}
              </span>
              {isFilterActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" aria-hidden="true" />
              )}
            </button>

            {/* Wide Desktop Direct Actions (>= 1536px only so compact laptops never crowd) */}
            <button
              type="button"
              onClick={() => setIsPrintCustomizerOpen(true)}
              className="hidden 2xl:inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-sky-300 border border-slate-200 dark:border-[#24344F] rounded-xl transition-colors bg-white dark:bg-[#162238] whitespace-nowrap shrink-0 cursor-pointer"
              title="Customize print templates and company letterhead"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Print Layouts</span>
            </button>

            <button
              type="button"
              onClick={() => setIsReminderModalOpen(true)}
              className="hidden 2xl:inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-sky-300 border border-slate-200 dark:border-[#24344F] rounded-xl transition-colors bg-white dark:bg-[#162238] whitespace-nowrap shrink-0 cursor-pointer"
              title="Overdue invoice email reminders"
            >
              <Mail className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Reminders</span>
            </button>

            <div className="hidden xl:flex items-center">
              <OnboardingTour />
            </div>
            <div className="hidden sm:flex items-center">
              <GlobalSearch />
            </div>

            <NotificationBell />

            {/* Light / Dark Mode Switch */}
            <button
              type="button"
              onClick={toggleTheme}
              className="w-9 h-9 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-sky-300 border border-slate-200 dark:border-[#24344F] rounded-xl transition-colors bg-white dark:bg-[#162238] shrink-0 cursor-pointer"
              title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
              aria-label={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>

            {/* Switch Company (Desktop — seamless authenticated switching) */}
            <button
              type="button"
              onClick={handleSwitchCompany}
              data-testid="header-switch-company-btn"
              className="hidden lg:inline-flex items-center gap-1.5 h-9 px-2.5 xl:px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-sky-300 border border-slate-200 dark:border-[#24344F] rounded-xl transition-colors bg-white dark:bg-[#162238] whitespace-nowrap shrink-0 cursor-pointer"
              title="Switch Company Workspace"
            >
              <Repeat className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
              <span className="hidden xl:inline">Switch Company</span>
            </button>

            {/* Compact Laptop / Tablet / Mobile Overflow Tools Menu */}
            <div className="relative 2xl:hidden" ref={toolsMenuRef}>
              <button
                type="button"
                onClick={() => setIsToolsMenuOpen((prev) => !prev)}
                aria-label="Workspace tools"
                title="More workspace tools"
                className="w-9 h-9 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-sky-300 border border-slate-200 dark:border-[#24344F] rounded-xl transition-colors bg-white dark:bg-[#162238] cursor-pointer shrink-0"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {isToolsMenuOpen && (
                <div className="absolute right-0 top-11 w-52 bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] rounded-xl shadow-lg py-1.5 z-40">
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsMenuOpen(false);
                      setIsPrintCustomizerOpen(true);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1F2F4C] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-slate-400" />
                    Print Layouts
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsMenuOpen(false);
                      setIsReminderModalOpen(true);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1F2F4C] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Mail className="w-4 h-4 text-slate-400" />
                    Invoice Reminders
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsMenuOpen(false);
                      setIsBarOpen(true);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1F2F4C] flex items-center gap-2.5 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-4 h-4 text-slate-400" />
                    Date &amp; Time Filter
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-[#24344F] lg:hidden" />
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsMenuOpen(false);
                      handleSwitchCompany();
                    }}
                    className="lg:hidden w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1F2F4C] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Repeat className="w-4 h-4 text-slate-400" />
                    Switch Company
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Global Cross-Module Date/Time Filter Bar (collapsible on demand) */}
        {isBarOpen && <WorkspaceDateTimeFilterBar onClose={() => setIsBarOpen(false)} />}

        {/* System Banners & Overlays */}
        <LicensingBanner />
        <BackupReminder />
        <LiveNotificationToast />

        <EmailReminderModal isOpen={isReminderModalOpen} onClose={() => setIsReminderModalOpen(false)} />
        <PrintCustomizerModal isOpen={isPrintCustomizerOpen} onClose={() => setIsPrintCustomizerOpen(false)} />
        <LedgerAgentOverlay />

        {/* Main Scrollable Viewport — Safe bottom clearance for Mobile Fixed Bottom Tab Bar */}
        <div
          ref={mainViewportRef}
          id="main-scroll-viewport"
          className="flex-1 overflow-auto px-3 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6 lg:px-7 lg:py-6 pb-20 md:pb-6 scroll-smooth"
        >
          <div
            key={`${activeCompany?.id || 'none'}-${workspaceSessionEpoch}-${normalizedFullPath}`}
            className="page-container motion-page-enter"
          >
            {children}
          </div>
        </div>

        <BackToTop scrollContainerId="main-scroll-viewport" />

        {/* Dedicated Mobile Phone Bottom Navigation Bar (< 768px only, 5 thumb-zone items) */}
        <nav
          aria-label="Mobile quick navigation"
          data-testid="mobile-bottom-nav"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 h-[60px] pb-safe bg-white/95 dark:bg-[#11192B]/95 backdrop-blur-md border-t border-slate-200/90 dark:border-[#1E2D45] grid grid-cols-5 items-center px-1"
        >
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active = item.match(location.pathname);
            return (
              <NavLink
                key={item.id}
                to={item.to}
                className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 rounded-lg transition-colors ${
                  active
                    ? 'text-blue-700 dark:text-sky-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-[19px] h-[19px]" />
                <span className="text-[10px] leading-none">{item.label}</span>
              </NavLink>
            );
          })}

          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(true)}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 rounded-lg transition-colors cursor-pointer ${
              isMobileSidebarOpen
                ? 'text-blue-700 dark:text-sky-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Menu className="w-[19px] h-[19px]" />
            <span className="text-[10px] leading-none">Modules</span>
          </button>
        </nav>
      </main>

      {/* Password Change Dialog */}
      {isChangePasswordOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white dark:bg-[#11192B] rounded-2xl shadow-2xl border border-slate-200 dark:border-[#24344F] w-full max-w-sm my-auto overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-[#1E2D45] flex justify-between items-center bg-slate-50/60 dark:bg-[#0F172A]">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-blue-600 dark:text-sky-400" />
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Change Account Password
                  </h2>
                </div>
                <button
                  onClick={() => {
                    setIsChangePasswordOpen(false);
                    setConfirmLogoutAll(false);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1B2942] cursor-pointer"
                  aria-label="Close dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={submitChangePassword} className="p-5 space-y-4">
                {passwordStatus.message && (
                  <div
                    className={`p-3 text-xs font-semibold rounded-xl border ${
                      passwordStatus.type === 'error'
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        : 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                    }`}
                  >
                    {passwordStatus.message}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Current Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                    className="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-600/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-600/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    className="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-600/30 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-semibold text-xs disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isChangingPassword ? 'Updating Password...' : 'Update Password'}
                </button>
                <div className="pt-2 border-t border-slate-100 dark:border-[#1E2D45]">
                  {!confirmLogoutAll ? (
                    <button
                      type="button"
                      onClick={() => setConfirmLogoutAll(true)}
                      className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:hover:bg-rose-900/50 dark:text-rose-300 rounded-xl font-semibold text-xs transition-colors border border-rose-200 dark:border-rose-900/50 cursor-pointer"
                    >
                      Sign out of all devices
                    </button>
                  ) : (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-2">
                      <p className="text-[11px] font-semibold text-rose-800 dark:text-rose-200">
                        Sign out from all active sessions across devices?
                      </p>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={loggingOutAll}
                          onClick={() => setConfirmLogoutAll(false)}
                          className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={loggingOutAll}
                          onClick={submitLogoutAll}
                          className="px-3 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          {loggingOutAll ? 'Signing out...' : 'Confirm Sign Out All'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
