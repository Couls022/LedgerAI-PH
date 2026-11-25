import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  Search,
  Star,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  PlusCircle,
  FolderOpen,
  LogOut,
  X,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/apiClient';
import {
  CompanyPreferenceService,
  UserCompanyShortcutsState,
} from '../services/companyPreferenceService';
import { LedgerLogoIcon } from '../components/LedgerLogo';
import { useRuntimeMode } from '../services/runtimeModeService';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

interface AuthorizedCompanyItem {
  id: string;
  legalName: string;
  tradeName?: string | null;
  tin?: string | null;
  vatStatus?: string | null;
  taxpayerClassification?: string | null;
  role: string;
  roleCode?: string | null;
  status?: string;
  isCurrent?: boolean;
  lastOpenedAt?: string | null;
  storageScope?: string;
}

export default function CompanySelector() {
  const { user, activeCompany, loading: authLoading, switchCompany, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentMode = location.pathname.startsWith('/server') ? 'server' : 'client';

  const [companies, setCompanies] = useState<AuthorizedCompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<AuthorizedCompanyItem | null>(null);

  const [userPrefs, setUserPrefs] = useState<UserCompanyShortcutsState>({
    pinnedCompanyIds: [],
    recentCompanies: [],
  });

  const runtime = useRuntimeMode();

  const loadAuthorizedCompanies = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{ companies: AuthorizedCompanyItem[] }>('/api/companies/authorized');
      const list = Array.isArray(data?.companies) ? data.companies : [];
      setCompanies(list);
    } catch (err: any) {
      if (err?.status === 401) {
        navigate(currentMode === 'server' ? '/server/profile/open?switch=1' : '/client/launcher?switch=1', { replace: true });
        return;
      }
      setLoadError(err?.message || 'Unable to load authorized company workspaces from the central server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(currentMode === 'server' ? '/server/profile/open?switch=1' : '/client/launcher?switch=1', { replace: true });
      return;
    }
    setUserPrefs(CompanyPreferenceService.getUserCompanyShortcuts(user.email));
    loadAuthorizedCompanies();
  }, [authLoading, user?.email, currentMode]);

  const executeSwitch = async (target: AuthorizedCompanyItem) => {
    if (switchingId) return;
    const vanityDomain = getCompanyVanityDomain(target);
    if (activeCompany?.id === target.id) {
      navigate(`/${currentMode}/${vanityDomain}/dashboard`);
      return;
    }

    setSwitchingId(target.id);
    setSwitchError(null);
    setPendingSwitchTarget(null);

    const result = await switchCompany(target.id, target.legalName);
    setSwitchingId(null);

    if (result.switched) {
      if (user?.email) {
        setUserPrefs(CompanyPreferenceService.getUserCompanyShortcuts(user.email));
      }
      navigate(`/${currentMode}/${vanityDomain}/dashboard`, { replace: true });
      return;
    }

    if (result.requiresReauth) {
      navigate(`/${currentMode}/${vanityDomain}/login`);
      return;
    }

    setSwitchError(result.message || `Could not switch to ${target.legalName}.`);
  };

  const handleRequestSwitch = (target: AuthorizedCompanyItem) => {
    const vanityDomain = getCompanyVanityDomain(target);
    if (activeCompany?.id === target.id) {
      navigate(`/${currentMode}/${vanityDomain}/dashboard`);
      return;
    }
    const hasUnsaved = Boolean((window as any).__ledgeraiUnsavedChanges);
    if (hasUnsaved) {
      setPendingSwitchTarget(target);
      return;
    }
    executeSwitch(target);
  };

  const handleTogglePin = (companyId: string) => {
    if (!user?.email) return;
    const next = CompanyPreferenceService.togglePinnedCompany(user.email, companyId);
    setUserPrefs(next);
  };

  const handleRemoveFromShortcuts = (companyId: string) => {
    if (!user?.email) return;
    const next = CompanyPreferenceService.removeUserCompanyEntry(user.email, companyId);
    setUserPrefs(next);
  };

  const handleSignOutAndSwitchUser = async () => {
    await logout();
    navigate(`/${currentMode}/launcher?switch=1`, { replace: true });
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredCompanies = useMemo(() => {
    if (!normalizedQuery) return companies;
    return companies.filter((c) => {
      const hay = `${c.legalName} ${c.tradeName || ''} ${c.tin || ''} ${c.role || ''} ${c.vatStatus || ''}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [companies, normalizedQuery]);

  const pinnedCompanies = useMemo(
    () => filteredCompanies.filter((c) => userPrefs.pinnedCompanyIds.includes(c.id)),
    [filteredCompanies, userPrefs.pinnedCompanyIds]
  );

  const recentCompanies = useMemo(() => {
    const byId = new Map(filteredCompanies.map((c) => [c.id, c]));
    return userPrefs.recentCompanies
      .map((entry) => byId.get(entry.companyId))
      .filter((item): item is AuthorizedCompanyItem => Boolean(item))
      .filter((item) => !userPrefs.pinnedCompanyIds.includes(item.id))
      .slice(0, 6);
  }, [filteredCompanies, userPrefs.recentCompanies, userPrefs.pinnedCompanyIds]);

  const renderCompanyCard = (company: AuthorizedCompanyItem, section: 'pinned' | 'recent' | 'all') => {
    const isCurrent = activeCompany?.id === company.id || company.isCurrent;
    const isPinned = userPrefs.pinnedCompanyIds.includes(company.id);
    const isBusy = switchingId === company.id;

    return (
      <div
        key={`${section}-${company.id}`}
        data-testid={`company-selector-card-${company.id}`}
        className={`bg-white dark:bg-[#11192B] p-4 sm:p-5 rounded-2xl border transition-colors flex flex-col justify-between gap-4 ${
          isCurrent
            ? 'border-blue-500 dark:border-sky-500/80 ring-1 ring-blue-500/20'
            : 'border-slate-200/90 dark:border-[#1E2D45] hover:border-blue-300 dark:hover:border-sky-700/70'
        }`}
      >
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-slate-900 dark:text-slate-50 text-base truncate">
                  {company.legalName}
                </h3>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300 border border-blue-200 dark:border-blue-800 text-[10px] font-bold">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                )}
              </div>
              {company.tradeName && company.tradeName !== company.legalName && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  DBA: {company.tradeName}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleTogglePin(company.id)}
                title={isPinned ? 'Unpin shortcut' : 'Pin company shortcut'}
                aria-label={isPinned ? `Unpin ${company.legalName}` : `Pin ${company.legalName}`}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  isPinned
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400'
                    : 'bg-slate-50 dark:bg-[#162238] border-slate-200 dark:border-[#24344F] text-slate-400 hover:text-amber-600'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
              </button>

              {section === 'recent' && (
                <button
                  type="button"
                  onClick={() => handleRemoveFromShortcuts(company.id)}
                  title="Remove from your recent shortcuts only (does not delete company database)"
                  aria-label={`Remove ${company.legalName} from recent list`}
                  className="p-1.5 rounded-lg border bg-slate-50 dark:bg-[#162238] border-slate-200 dark:border-[#24344F] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/80 font-semibold">
              {company.role || 'Authorized User'}
            </span>
            {company.vatStatus && (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#162238] text-slate-700 dark:text-slate-300 font-medium">
                {company.vatStatus}
              </span>
            )}
            {company.tin && (
              <span className="font-mono text-slate-500 dark:text-slate-400 px-1.5 py-0.5">
                TIN {company.tin}
              </span>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 dark:border-[#1B2942] flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            Server-Managed
          </span>

          <button
            type="button"
            disabled={Boolean(switchingId)}
            onClick={() => handleRequestSwitch(company)}
            data-testid={`switch-company-btn-${company.id}`}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
              isCurrent
                ? 'bg-slate-100 dark:bg-[#162238] text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-[#1F2F4C]'
                : 'bg-blue-700 hover:bg-blue-800 text-white'
            }`}
          >
            {isBusy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Switching...</span>
              </>
            ) : isCurrent ? (
              <>
                <span>Continue Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Switch Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] dark:bg-[#0B1120] py-6 sm:py-9 px-4 sm:px-6 transition-colors">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {activeCompany ? (
              <button
                type="button"
                onClick={() => navigate('/')}
                data-testid="company-selector-back-btn"
                className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to {activeCompany.legalName}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/launcher?switch=1')}
                className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Launcher</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {runtime.canCreateCompany && (
              <button
                type="button"
                onClick={() => navigate('/profile/create')}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#11192B] border border-slate-200 dark:border-[#24344F] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162238] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                <span>Create Company</span>
              </button>
            )}

            {runtime.canOpenLocalFolder && (
              <button
                type="button"
                onClick={() => navigate('/profile/open?switch=1')}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#11192B] border border-slate-200 dark:border-[#24344F] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162238] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span>Open Local Folder</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSignOutAndSwitchUser}
              className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Title & Authenticated Account Context */}
        <div className="bg-white dark:bg-[#11192B] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <LedgerLogoIcon size={42} />
            <div>
              <h1 className="font-display text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">
                Select Company Workspace
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Signed in as <strong className="text-slate-800 dark:text-slate-200">{user?.email}</strong> &middot; Showing only companies your account is authorized to access.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search company, TIN, or role..."
                data-testid="company-selector-search"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
              />
            </div>
            <button
              type="button"
              onClick={loadAuthorizedCompanies}
              disabled={loading}
              aria-label="Refresh authorized companies"
              className="p-2 rounded-xl border border-slate-200 dark:border-[#24344F] bg-white dark:bg-[#162238] text-slate-600 dark:text-slate-300 hover:text-blue-700 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Unsaved Changes Inline Confirmation */}
        {pendingSwitchTarget && (
          <div
            role="alert"
            className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>
                You may have unsaved edits in <strong>{activeCompany?.legalName}</strong>. Switching to{' '}
                <strong>{pendingSwitchTarget.legalName}</strong> will reload the active company workspace.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => executeSwitch(pendingSwitchTarget)}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
              >
                Switch Anyway
              </button>
              <button
                type="button"
                onClick={() => setPendingSwitchTarget(null)}
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Errors */}
        {(loadError || switchError) && (
          <div
            role="alert"
            className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between gap-3 text-xs text-rose-800 dark:text-rose-200"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{switchError || loadError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSwitchError(null);
                if (loadError) loadAuthorizedCompanies();
              }}
              className="px-3 py-1 rounded-lg bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
            >
              {loadError ? 'Retry' : 'Dismiss'}
            </button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="bg-white dark:bg-[#11192B] p-12 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center">
            <Loader2 className="w-7 h-7 animate-spin text-blue-600 dark:text-sky-400 mx-auto mb-3" />
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Loading your authorized company workspaces from the central server...
            </p>
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="bg-white dark:bg-[#11192B] p-10 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center space-y-3">
            <Building2 className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {searchQuery ? 'No matching authorized companies' : 'No authorized companies found'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {searchQuery
                ? 'Try clearing your search filter to view all companies assigned to your account.'
                : 'Ask your Company Administrator to assign your account to additional company profiles, or sign in with another company account.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {pinnedCompanies.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-500 fill-current" />
                  <span>Pinned Shortcuts ({pinnedCompanies.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pinnedCompanies.map((c) => renderCompanyCard(c, 'pinned'))}
                </div>
              </section>
            )}

            {recentCompanies.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                  <span>Recently Opened ({recentCompanies.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recentCompanies.map((c) => renderCompanyCard(c, 'recent'))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span>All Authorized Companies ({filteredCompanies.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCompanies.map((c) => renderCompanyCard(c, 'all'))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
