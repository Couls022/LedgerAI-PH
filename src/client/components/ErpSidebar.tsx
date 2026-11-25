import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, ShoppingCart, Truck, Boxes, Landmark, BookOpen, Building2,
  Users, FileText, PieChart, FolderOpen, BarChart3, CheckSquare,
  Activity, ShieldCheck, Database, Settings,
  Search, ChevronRight, ChevronLeft, Key, LogOut, ArrowRight, X, PanelLeftOpen, Crown
} from 'lucide-react';
import { LedgerLogoIcon } from './LedgerLogo';
import { useAuth } from '../context/AuthContext';
import EnterpriseFeatureModal from './licensing/EnterpriseFeatureModal';
import {
  PrimaryModuleDefinition,
  SubmoduleDefinition,
  getCanonicalModuleForRoute
} from '../../shared/moduleRegistry';
import { computeFlyoutTop } from '../utils/uiLayoutUtils';

const ICON_MAP: Record<string, any> = {
  Home,
  ShoppingCart,
  Truck,
  Boxes,
  Landmark,
  BookOpen,
  Building2,
  Users,
  FileText,
  PieChart,
  FolderOpen,
  BarChart3,
  CheckSquare,
  Activity,
  ShieldCheck,
  Database,
  Settings
};

interface ErpSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onChangePasswordOpen: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  onOpenMobile?: () => void;
}

interface RailFlyoutState {
  mod: PrimaryModuleDefinition;
  top: number;
  left: number;
  arrowOffset: number;
  source: 'desktop-rail' | 'tablet-rail';
}

export default function ErpSidebar({
  isCollapsed,
  onToggleCollapse,
  onChangePasswordOpen,
  isMobileOpen = false,
  onCloseMobile,
  onOpenMobile,
}: ErpSidebarProps) {
  const { user, userRole, authorizedModules, logout, isEnterprise, planType } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeExpandedModuleId, setActiveExpandedModuleId] = useState<string | null>(null);
  const [railFlyout, setRailFlyout] = useState<RailFlyoutState | null>(null);
  const [lockedFeatureName, setLockedFeatureName] = useState<string | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  const tenantPrefix = (location.pathname.match(/^(\/(?:client|server)\/[^\/]+)/) || [])[1] || '';
  const toPrefixedRoute = (route: string) => tenantPrefix ? (tenantPrefix + (route === '/' ? '' : route)) : route;
  const normalizedPath = location.pathname.replace(/^\/(?:client|server)\/[^\/]+/, '') || '/';
  const normalizedFullPath = normalizedPath + location.search;

  useEffect(() => {
    const canonicalMod = getCanonicalModuleForRoute(location.pathname, location.search);
    if (canonicalMod) {
      setActiveExpandedModuleId(canonicalMod.id);
    }
    setRailFlyout(null);
  }, [location.pathname, location.search]);

  // Close flyout when sidebar expands or mobile drawer opens
  useEffect(() => {
    if (!isCollapsed || isMobileOpen) {
      setRailFlyout(null);
    }
  }, [isCollapsed, isMobileOpen]);

  // Close flyout on click outside, Escape key, or window resize
  useEffect(() => {
    if (!railFlyout) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (flyoutRef.current && target && flyoutRef.current.contains(target)) return;
      if (target?.closest('[data-rail-module-btn="true"]')) return;
      setRailFlyout(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRailFlyout(null);
    };

    const handleResize = () => setRailFlyout(null);

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [railFlyout]);

  const effectiveCollapsed = isCollapsed && !isMobileOpen;

  const openOrToggleRailFlyout = (
    mod: PrimaryModuleDefinition,
    buttonEl: HTMLElement,
    source: 'desktop-rail' | 'tablet-rail'
  ) => {
    // If clicking the same module that already has the flyout open, toggle it closed
    if (railFlyout?.mod.id === mod.id && railFlyout.source === source) {
      setRailFlyout(null);
      return;
    }

    // Single-submodule modules (e.g., Dashboard) navigate immediately without extra friction
    if (mod.submodules.length <= 1) {
      setRailFlyout(null);
      const targetRoute = mod.submodules[0]?.route || mod.baseRoute;
      if (targetRoute) navigate(toPrefixedRoute(targetRoute));
      return;
    }

    const rect = buttonEl.getBoundingClientRect();
    const estimatedPanelHeight = Math.min(440, 118 + mod.submodules.length * 42);
    const computedTop = computeFlyoutTop(rect.top - 8, estimatedPanelHeight, window.innerHeight, 12);
    const arrowOffset = Math.max(18, Math.min(estimatedPanelHeight - 24, rect.top + rect.height / 2 - computedTop));

    setRailFlyout({
      mod,
      top: computedTop,
      left: Math.round(rect.right + 10),
      arrowOffset: Math.round(arrowOffset),
      source,
    });
  };

  const handleModuleClick = (mod: PrimaryModuleDefinition, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (mod.minPlan === 'ENTERPRISE' && !isEnterprise) {
      setLockedFeatureName(mod.label);
      return;
    }

    const defaultRoute = mod.submodules[0]?.route || mod.baseRoute;

    if (effectiveCollapsed) {
      openOrToggleRailFlyout(mod, e.currentTarget, 'desktop-rail');
      return;
    }

    if (activeExpandedModuleId === mod.id) {
      setActiveExpandedModuleId(null);
    } else {
      setActiveExpandedModuleId(mod.id);
      const canonicalMod = getCanonicalModuleForRoute(location.pathname, location.search);
      if (canonicalMod?.id !== mod.id && defaultRoute) {
        navigate(toPrefixedRoute(defaultRoute));
        if (onCloseMobile) onCloseMobile();
      }
    }
  };

  const handleChevronToggle = (modId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveExpandedModuleId((prev) => (prev === modId ? null : modId));
  };

  const handleLogout = async () => {
    setRailFlyout(null);
    if (onCloseMobile) onCloseMobile();
    await logout();
    const currentMode = location.pathname.startsWith('/server') ? 'server' : 'client';
    navigate(`/${currentMode}/launcher`);
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    const results: Array<{
      type: 'MODULE' | 'SUBMODULE';
      id: string;
      label: string;
      route: string;
      parentModuleId: string;
      parentModuleName: string;
    }> = [];

    const seenSubmoduleRoutes = new Set<string>();

    authorizedModules.forEach((mod) => {
      if (mod.label.toLowerCase().includes(q) || mod.description.toLowerCase().includes(q)) {
        results.push({
          type: 'MODULE',
          id: mod.id,
          label: mod.label,
          route: mod.submodules[0]?.route || mod.baseRoute,
          parentModuleId: mod.id,
          parentModuleName: mod.label,
        });
      }

      mod.submodules.forEach((sub) => {
        if (sub.label.toLowerCase().includes(q)) {
          const routeKey = `${sub.label.toLowerCase()}::${sub.route}`;
          if (!seenSubmoduleRoutes.has(routeKey)) {
            seenSubmoduleRoutes.add(routeKey);
            results.push({
              type: 'SUBMODULE',
              id: sub.id,
              label: sub.label,
              route: sub.route,
              parentModuleId: mod.id,
              parentModuleName: mod.label,
            });
          }
        }
      });
    });

    return results;
  }, [authorizedModules, searchQuery]);

  const handleSearchResultClick = (result: { route: string; parentModuleId: string }) => {
    setSearchQuery('');
    setActiveExpandedModuleId(result.parentModuleId);
    navigate(toPrefixedRoute(result.route));
    if (onCloseMobile) onCloseMobile();
  };

  const currentCanonicalMod = getCanonicalModuleForRoute(location.pathname, location.search);
  const currentFullPath = location.pathname + location.search;

  const renderRailFlyoutPortal = () => {
    if (!railFlyout || typeof document === 'undefined') return null;
    const { mod, top, left, arrowOffset, source } = railFlyout;
    const IconComp = ICON_MAP[mod.iconName] || Home;
    const isModActive = currentCanonicalMod?.id === mod.id;
    const activeSubmodule =
      mod.submodules.find((s) => normalizedFullPath === s.route) ||
      mod.submodules.find((s) => normalizedPath === s.route.split('?')[0]);

    return createPortal(
      <div
        ref={flyoutRef}
        data-testid="rail-submodule-flyout"
        role="menu"
        aria-label={`${mod.label} submodules`}
        style={{ top: `${top}px`, left: `${left}px` }}
        className="fixed z-[9990] w-[292px] max-w-[calc(100vw-88px)] rounded-2xl bg-[#0F1A2E] border border-[#24385A] shadow-2xl shadow-slate-950/50 text-slate-100 motion-flyout-enter"
      >
        {/* Subtle Directional Arrow Notch */}
        <span
          aria-hidden="true"
          style={{ top: `${arrowOffset - 6}px` }}
          className="absolute -left-[6px] w-3 h-3 rotate-45 bg-[#0F1A2E] border-l border-b border-[#24385A]"
        />

        {/* Flyout Header */}
        <div className="px-3.5 py-3 border-b border-[#1E304F] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-sky-400/25 flex items-center justify-center text-sky-300 shrink-0">
              <IconComp className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xs font-bold text-white truncate">{mod.label}</p>
              <p className="text-[10px] text-slate-400 font-medium">
                {mod.submodules.length} {mod.submodules.length === 1 ? 'submodule' : 'submodules'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRailFlyout(null)}
            aria-label="Close submodule flyout"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Submodule Items */}
        <div className="p-2 max-h-[300px] overflow-y-auto space-y-1 custom-scrollbar">
          {mod.submodules.map((sub: SubmoduleDefinition) => {
            const isSubActive = isModActive && activeSubmodule?.id === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                role="menuitem"
                data-testid={`flyout-sub-${sub.id}`}
                onClick={() => {
                  if (sub.minPlan === 'ENTERPRISE' && !isEnterprise) {
                    setRailFlyout(null);
                    setLockedFeatureName(`${mod.label} — ${sub.label}`);
                    return;
                  }
                  setActiveExpandedModuleId(mod.id);
                  setRailFlyout(null);
                  navigate(toPrefixedRoute(sub.route));
                }}
                className={`group w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left text-xs transition-all cursor-pointer ${
                  isSubActive
                    ? 'bg-blue-600 text-white font-semibold shadow-xs'
                    : 'text-slate-200 hover:bg-[#192844] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 transition-transform ${
                      isSubActive ? 'bg-teal-300 scale-110' : 'bg-slate-500 group-hover:bg-sky-400'
                    }`}
                  />
                  <span className="truncate">{sub.label}</span>
                  {sub.minPlan === 'ENTERPRISE' && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                      ENT
                    </span>
                  )}
                </span>
                <ArrowRight
                  className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                    isSubActive
                      ? 'text-sky-200 translate-x-0.5'
                      : 'text-slate-500 group-hover:text-sky-300 group-hover:translate-x-0.5'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Footer Quick Expand Action */}
        <div className="px-2.5 py-2 border-t border-[#1E304F] bg-[#0B1323]/80 rounded-b-2xl flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveExpandedModuleId(mod.id);
              setRailFlyout(null);
              if (source === 'tablet-rail' && onOpenMobile) {
                onOpenMobile();
              } else {
                onToggleCollapse();
              }
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-sky-300 hover:text-white hover:bg-[#192844] transition-colors cursor-pointer"
          >
            <PanelLeftOpen className="w-3.5 h-3.5" />
            <span>{source === 'tablet-rail' ? 'Open Full Navigation Drawer' : 'Expand Navigation Sidebar'}</span>
          </button>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <>
      {/* Mobile & Tablet Overlay Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/65 backdrop-blur-xs lg:hidden motion-backdrop-enter"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Tablet-Dedicated Permanent Slim Rail (md only: 768px-1023px) when drawer is closed */}
      {!isMobileOpen && (
        <aside
          aria-label="Tablet navigation rail"
          data-testid="tablet-nav-rail"
          className="hidden md:flex lg:hidden flex-col w-[68px] shrink-0 bg-[#0D1524] border-r border-[#1B2840] select-none items-center py-3 justify-between z-20"
        >
          <div className="flex flex-col items-center gap-2 w-full">
            <button
              type="button"
              onClick={onOpenMobile}
              aria-label="Open full navigation drawer"
              title="Expand modules drawer"
              className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-[#192640] transition-colors cursor-pointer"
            >
              <LedgerLogoIcon size={30} />
            </button>
            <button
              type="button"
              onClick={onOpenMobile}
              aria-label="Expand menu"
              title="Expand menu"
              className="w-10 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#192640] transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 w-full overflow-y-auto px-2 py-2 space-y-1.5 flex flex-col items-center custom-scrollbar">
            {authorizedModules.map((mod) => {
              const IconComp = ICON_MAP[mod.iconName] || Home;
              const isPrimaryActive = currentCanonicalMod?.id === mod.id;
              const isFlyoutOpen = railFlyout?.mod.id === mod.id && railFlyout.source === 'tablet-rail';
              const hasMultipleSubs = mod.submodules.length > 1;
              return (
                <button
                  key={mod.id}
                  type="button"
                  data-rail-module-btn="true"
                  data-testid={`tablet-rail-mod-${mod.id}`}
                  onClick={(e) => openOrToggleRailFlyout(mod, e.currentTarget, 'tablet-rail')}
                  title={hasMultipleSubs ? `${mod.label} (${mod.submodules.length} submodules)` : mod.label}
                  aria-label={mod.label}
                  aria-haspopup={hasMultipleSubs ? 'menu' : undefined}
                  aria-expanded={hasMultipleSubs ? isFlyoutOpen : undefined}
                  className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0 ${
                    isFlyoutOpen
                      ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/60'
                      : isPrimaryActive
                      ? 'bg-blue-600/90 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white hover:bg-[#192640]'
                  }`}
                >
                  <IconComp className="w-[18px] h-[18px]" />
                </button>
              );
            })}
          </nav>

          <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-[#1B2840] w-full">
            <button
              type="button"
              onClick={onChangePasswordOpen}
              title="Account security"
              aria-label="Change Password"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-sky-300 hover:bg-[#192640] transition-colors cursor-pointer"
            >
              <Key className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Logout"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-[#192640] transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* Primary Desktop Sidebar (Wide & Compact Laptop) + Mobile/Tablet Slide-Over Drawer */}
      <aside
        data-testid="erp-sidebar"
        className={`bg-[#0D1524] border-r border-[#1B2840] flex flex-col shrink-0 select-none group/sidebar ${
          isMobileOpen
            ? 'fixed inset-y-0 left-0 z-50 w-[280px] max-w-[86vw] shadow-2xl flex motion-drawer-left'
            : 'hidden lg:flex transition-[width] duration-200 ease-out'
        } ${
          !isMobileOpen && effectiveCollapsed ? 'lg:w-[72px]' : 'lg:w-[264px]'
        }`}
      >
        {/* Brand Header */}
        <div
          className={`px-3.5 flex items-center border-b border-[#1B2840] h-16 shrink-0 group/header relative ${
            effectiveCollapsed ? 'justify-center px-2' : 'justify-between'
          }`}
        >
          <button
            type="button"
            onClick={isMobileOpen ? onCloseMobile : onToggleCollapse}
            aria-expanded={!effectiveCollapsed}
            aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center gap-2.5 overflow-hidden group/logo cursor-pointer text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            title={effectiveCollapsed ? 'Expand sidebar (show full labels)' : 'Collapse to icon rail'}
          >
            <div className="shrink-0 transition-transform duration-200 group-hover/logo:scale-105">
              <LedgerLogoIcon size={30} className="shrink-0" />
            </div>
            {!effectiveCollapsed && (
              <div className="flex flex-col truncate">
                <div className="flex items-baseline gap-1.5 leading-none whitespace-nowrap">
                  <span className="font-display text-white font-extrabold text-[15px] tracking-tight">
                    Ledger<span className="text-sky-400">AI</span>
                  </span>
                  <span className="font-display text-[11px] font-bold text-teal-400 tracking-wider">
                    PH
                  </span>
                </div>
                <span className="text-[10px] font-medium text-slate-400 tracking-wide mt-0.5 whitespace-nowrap">
                  Philippine Ledger
                </span>
              </div>
            )}
          </button>

          {!effectiveCollapsed && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-expanded={!effectiveCollapsed}
                className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#192640] cursor-pointer shrink-0 transition-colors"
                title="Collapse sidebar to icon rail"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {isMobileOpen && onCloseMobile && (
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#192640] transition-colors cursor-pointer shrink-0"
                  title="Close menu"
                  aria-label="Close navigation menu"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Module Quick Search (Expanded state only) */}
        {!effectiveCollapsed && (
          <div className="px-3 pt-3 pb-1 shrink-0 relative">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Jump to module..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-[#131E33] border border-[#223250] rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-sky-500 transition-colors"
              />
            </div>

            {searchQuery.trim() && (
              <div className="absolute left-3 right-3 top-12 bg-[#10192C] border border-[#243656] rounded-xl shadow-2xl z-30 max-h-72 overflow-y-auto divide-y divide-[#1D2C47] motion-modal-enter">
                {searchResults.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-400">
                    No matching modules found.
                  </div>
                ) : (
                  searchResults.map((res) => (
                    <button
                      key={`${res.parentModuleId}-${res.id}`}
                      onClick={() => handleSearchResultClick(res)}
                      className="w-full text-left p-2.5 hover:bg-blue-600/20 hover:text-white transition-colors flex items-center justify-between group cursor-pointer"
                    >
                      <div className="truncate mr-2">
                        <div className="text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                          {res.label}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {res.parentModuleName}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation List */}
        <nav className="flex-1 px-2.5 py-2 overflow-y-auto space-y-1 custom-scrollbar">
          {authorizedModules.map((mod) => {
            const IconComp = ICON_MAP[mod.iconName] || Home;
            const isExpanded = !effectiveCollapsed && activeExpandedModuleId === mod.id;
            const isPrimaryActive = currentCanonicalMod?.id === mod.id;
            const isFlyoutOpen = effectiveCollapsed && railFlyout?.mod.id === mod.id && railFlyout.source === 'desktop-rail';
            const hasMultipleSubs = mod.submodules.length > 1;

            const activeSubmodule =
              mod.submodules.find((s) => normalizedFullPath === s.route) ||
              mod.submodules.find((s) => normalizedPath === s.route.split('?')[0]);

            return (
              <div key={mod.id} className="space-y-0.5">
                <div className="relative group/item">
                  <button
                    type="button"
                    data-rail-module-btn={effectiveCollapsed ? 'true' : undefined}
                    data-testid={`sidebar-mod-${mod.id}`}
                    onClick={(e) => handleModuleClick(mod, e)}
                    title={
                      effectiveCollapsed
                        ? hasMultipleSubs
                          ? `${mod.label} — Click to view ${mod.submodules.length} submodules`
                          : mod.label
                        : undefined
                    }
                    aria-label={mod.label}
                    aria-haspopup={effectiveCollapsed && hasMultipleSubs ? 'menu' : undefined}
                    aria-expanded={effectiveCollapsed ? (hasMultipleSubs ? isFlyoutOpen : undefined) : isExpanded}
                    className={`relative w-full flex items-center justify-between min-h-[40px] lg:min-h-[38px] px-2.5 py-2 rounded-xl transition-all duration-150 text-xs cursor-pointer ${
                      isFlyoutOpen
                        ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/60 font-semibold'
                        : isPrimaryActive
                        ? isExpanded
                          ? 'bg-[#17253F] text-white font-semibold border border-sky-500/25'
                          : 'bg-blue-600 text-white font-semibold shadow-xs'
                        : 'text-slate-300 font-medium hover:bg-[#162238] hover:text-white'
                    }`}
                  >
                    <div
                      className={`flex items-center overflow-hidden ${
                        effectiveCollapsed ? 'justify-center w-full' : 'gap-2.5 min-w-0'
                      }`}
                    >
                      <IconComp
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isPrimaryActive || isFlyoutOpen
                            ? 'text-sky-200'
                            : 'text-slate-400 group-hover/item:text-slate-200'
                        }`}
                      />
                      {!effectiveCollapsed && (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                          <span className="truncate text-xs font-medium tracking-tight">
                            {mod.label}
                          </span>
                          {mod.minPlan === 'ENTERPRISE' && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                              ENT
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {!effectiveCollapsed && mod.submodules.length > 0 && (
                      <span
                        onClick={(e) => handleChevronToggle(mod.id, e)}
                        className="p-1 hover:bg-white/10 rounded-md transition-colors text-slate-400 hover:text-white shrink-0 ml-1"
                        title={isExpanded ? 'Collapse section' : 'Expand section'}
                      >
                        <ChevronRight
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${
                            isExpanded ? 'rotate-90 text-sky-300' : ''
                          }`}
                        />
                      </span>
                    )}
                  </button>
                </div>

                {/* Smooth Animated Submodules Nested Accordion (Expanded Sidebar) */}
                {!effectiveCollapsed && mod.submodules.length > 0 && (
                  <div
                    className={`grid transition-all duration-200 ease-out ${
                      isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="pl-3 pr-1 py-1 space-y-0.5 border-l border-[#223454] ml-4 my-0.5">
                        {mod.submodules.map((sub: SubmoduleDefinition) => {
                          const isSubActive = isPrimaryActive && activeSubmodule?.id === sub.id;

                          return (
                            <NavLink
                              key={sub.id}
                              to={toPrefixedRoute(sub.route)}
                              onClick={(e) => {
                                if (sub.minPlan === 'ENTERPRISE' && !isEnterprise) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setLockedFeatureName(`${mod.label} — ${sub.label}`);
                                  return;
                                }
                                e.stopPropagation();
                                if (onCloseMobile) onCloseMobile();
                              }}
                              className={`flex items-center justify-between min-h-[36px] lg:min-h-[30px] px-2.5 py-1.5 rounded-lg text-xs transition-all duration-150 ${
                                isSubActive
                                  ? 'bg-sky-500/15 text-sky-200 font-semibold translate-x-0.5'
                                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#162238] hover:translate-x-0.5'
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
                              {sub.minPlan === 'ENTERPRISE' && (
                                <span className="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-bold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                                  ENT
                                </span>
                              )}
                            </NavLink>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {authorizedModules.length === 0 && (
            <div className="p-4 text-center text-xs text-slate-500">
              No modules authorized for your role.
            </div>
          )}
        </nav>

        {/* User Profile & Security Footer */}
        <div
          className={`p-3 border-t border-[#1B2840] bg-[#0A101D] shrink-0 ${
            effectiveCollapsed ? 'flex flex-col items-center' : ''
          }`}
        >
          <div
            className={`flex items-center ${
              effectiveCollapsed ? 'flex-col gap-2.5 w-full items-center' : 'justify-between gap-2'
            }`}
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div
                className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-teal-600 flex items-center justify-center text-xs text-white font-bold shrink-0"
                title={user?.displayName || 'Active User'}
              >
                {user?.displayName?.[0]?.toUpperCase() || 'U'}
              </div>
              {!effectiveCollapsed && (
                <div className="truncate">
                  <p className="text-xs font-semibold text-slate-100 truncate">
                    {user?.displayName || 'Active User'}
                  </p>
                  <p className="text-[11px] font-medium text-teal-400 truncate">
                    {userRole || 'Member'}
                  </p>
                </div>
              )}
            </div>
            <div className={`flex items-center gap-1 ${effectiveCollapsed ? 'flex-col' : ''}`}>
              <button
                onClick={onChangePasswordOpen}
                className="p-2 text-slate-400 hover:text-sky-300 transition-colors rounded-lg hover:bg-[#192640] cursor-pointer"
                title="Change Password"
                aria-label="Change Password"
              >
                <Key className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-rose-400 transition-colors rounded-lg hover:bg-[#192640] cursor-pointer"
                title="Sign Out"
                aria-label="Logout"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Portal-Mounted Floating Submodule Flyout for Collapsed Desktop Rail & Tablet Rail */}
      {renderRailFlyoutPortal()}

      {/* Enterprise Upgrade & Feature Access Modal */}
      <EnterpriseFeatureModal
        isOpen={Boolean(lockedFeatureName)}
        featureName={lockedFeatureName || ''}
        onClose={() => setLockedFeatureName(null)}
      />
    </>
  );
}
