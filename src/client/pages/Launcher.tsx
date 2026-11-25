import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  PlusCircle,
  FolderOpen,
  RefreshCcw,
  ShieldCheck,
  ArrowRight,
  Sun,
  Moon,
  AlertTriangle,
  Building2,
  Repeat,
  Search,
  Lock,
  Server,
  Monitor,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LedgerLogoIcon } from '../components/LedgerLogo';
import { CompanyPreferenceService } from '../services/companyPreferenceService';
import { useRuntimeMode } from '../services/runtimeModeService';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

interface PublicCompanyProfile {
  id: string;
  legalName: string;
  tradeName?: string | null;
  tin?: string | null;
  vatStatus?: string | null;
  taxpayerClassification?: string | null;
  status?: string;
  classification?: string;
  lastOpenedAt?: string | null;
  createdAt?: string | null;
  storageScope?: string;
}

export default function Launcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const switchMode = searchParams.get('switch') === '1';
  const requestedView = searchParams.get('view'); // 'server' | 'client' | null
  const { user, activeCompany, loading } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const runtime = useRuntimeMode();

  // Remote LAN browser clients ALWAYS see only the Client Side Landing Page.
  // Authorized PC Server Console hosts default to Server Side and may toggle to Client Side to inspect/sign in.
  const isServerRoute = location.pathname.startsWith('/server');
  const isClientRoute = location.pathname.startsWith('/client');
  const showingServerLanding = runtime.isServerConsole && (requestedView === 'server' || (requestedView !== 'client' && (isServerRoute || !isClientRoute)));

  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  const [preservedOfflineCompany, setPreservedOfflineCompany] = useState<{
    companyId: string;
    companyName: string;
  } | null>(null);
  const [checkingSavedCompany, setCheckingSavedCompany] = useState(false);

  const [availableCompanies, setAvailableCompanies] = useState<PublicCompanyProfile[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadAvailableCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    setCompaniesError(null);
    try {
      const res = await fetch('/api/companies?availableOnly=true', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Unable to reach central server (HTTP ${res.status}).`);
      }
      const list = await res.json();
      setAvailableCompanies(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setCompaniesError(
        err?.message || 'Unable to load available company profiles from the central server.'
      );
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  useEffect(() => {
    loadAvailableCompanies();
  }, [loadAvailableCompanies]);

  const verifySavedCompany = useCallback(async () => {
    const saved = CompanyPreferenceService.getLastSelectedCompany();
    if (!saved) return;

    setCheckingSavedCompany(true);
    setStartupNotice(null);
    setPreservedOfflineCompany(null);

    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(saved.companyId)}`, {
        credentials: 'include',
      });
      const payload = res.headers.get('content-type')?.includes('application/json')
        ? await res.json().catch(() => null)
        : null;

      const decision = CompanyPreferenceService.resolveStartupCompanyVerification({
        saved,
        httpStatus: res.status,
        companyPayload: payload,
        networkError: false,
      });

      if (decision.action === 'REDIRECT_LOGIN') {
        CompanyPreferenceService.setLastSelectedCompany(decision.companyId, decision.companyName);
        const targetMode = location.pathname.startsWith('/server') && runtime.isServerConsole ? 'server' : 'client';
        const vanity = getCompanyVanityDomain({ id: decision.companyId, legalName: decision.companyName });
        navigate(`/${targetMode}/${vanity}/login`, { replace: true });
        return;
      }

      if (decision.action === 'SHOW_LAUNCHER') {
        if (decision.clearedStalePreference) {
          CompanyPreferenceService.clearLastSelectedCompany();
        }
        if (decision.notice) {
          setStartupNotice(decision.notice);
        }
        return;
      }

      setPreservedOfflineCompany({
        companyId: decision.preservedCompanyId,
        companyName: decision.preservedCompanyName,
      });
    } catch {
      const decision = CompanyPreferenceService.resolveStartupCompanyVerification({
        saved,
        networkError: true,
      });
      if (decision.action === 'SERVER_UNREACHABLE') {
        setPreservedOfflineCompany({
          companyId: decision.preservedCompanyId,
          companyName: decision.preservedCompanyName,
        });
      }
    } finally {
      setCheckingSavedCompany(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (switchMode || loading || runtime.loading) return;
    // On the PC Server Console landing, stay on the Server Side launcher unless user explicitly clicks a profile.
    if (runtime.isServerConsole) return;
    if (user && activeCompany) return;
    verifySavedCompany();
  }, [switchMode, loading, runtime.loading, runtime.isServerConsole, user, activeCompany, verifySavedCompany]);

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark', true);
  };

  const handleOpenCompanyLogin = (company: PublicCompanyProfile) => {
    CompanyPreferenceService.setLastSelectedCompany(company.id, company.legalName);
    const vanityDomain = getCompanyVanityDomain(company);
    const mode = showingServerLanding ? 'server' : 'client';
    navigate(`/${mode}/${vanityDomain}/login`);
  };

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableCompanies;
    return availableCompanies.filter((c) => {
      const hay = `${c.legalName} ${c.tradeName || ''} ${c.id} ${c.tin || ''} ${c.vatStatus || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableCompanies, searchQuery]);

  if (loading || checkingSavedCompany || runtime.loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] text-slate-700 dark:text-slate-300 px-4">
        <div className="mb-4">
          <LedgerLogoIcon size={48} />
        </div>
        <p className="font-medium text-xs text-slate-500 dark:text-slate-400">
          {checkingSavedCompany ? 'Opening your saved company workspace...' : 'Starting LedgerAI PH...'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA] dark:bg-[#0B1120] transition-colors">
      {/* Minimal Top Utility Bar */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-2 flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          {showingServerLanding && (
            <button
              type="button"
              data-testid="go-to-client-side-btn"
              onClick={() => navigate('/client/launcher')}
              title="Go to Client Side Landing Page"
              className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#24344F] bg-white dark:bg-[#11192B] hover:bg-slate-50 dark:hover:bg-[#162238] text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Monitor className="w-4 h-4 text-blue-600 dark:text-sky-400" />
              <span>Client Side</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
            title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
            className="h-9 px-3 rounded-xl border border-slate-200 dark:border-[#24344F] bg-white dark:bg-[#11192B] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-2 text-xs font-semibold transition-colors cursor-pointer"
          >
          {resolvedTheme === 'dark' ? (
            <>
              <Sun className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">Dark</span>
            </>
          )}
          </button>
        </div>
      </header>

      {/* Main Centered Welcome Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 pb-12 pt-4 sm:pt-6">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-9 sm:mb-11">
            <div className="inline-flex items-center justify-center mb-4">
              <LedgerLogoIcon size={56} />
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">
              Ledger<span className="text-blue-600 dark:text-sky-400">AI</span> PH
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2.5 text-sm sm:text-[15px] max-w-xl mx-auto leading-relaxed">
              {showingServerLanding
                ? 'Philippine Multi-Company Financial Ledger & BIR Statutory Compliance Engine'
                : 'Select an available company workspace below to open its login page and sign in securely.'}
            </p>
          </div>

          {startupNotice && (
            <div
              role="status"
              data-testid="launcher-stale-company-notice"
              className="mb-5 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{startupNotice}</p>
            </div>
          )}

          {preservedOfflineCompany && (
            <div
              role="alert"
              data-testid="launcher-offline-preserved-notice"
              className="mb-5 p-4 bg-white dark:bg-[#11192B] border border-rose-200 dark:border-rose-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-start gap-2.5 text-slate-700 dark:text-slate-200">
                <Building2 className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    Saved company preserved: {preservedOfflineCompany.companyName}
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    The central server is temporarily unreachable. Your saved company selection was kept intact.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={verifySavedCompany}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                Retry Saved Company
              </button>
            </div>
          )}

          {user && activeCompany && (
            <div className="mb-6 p-4 bg-white dark:bg-[#11192B] border border-blue-200 dark:border-blue-900/60 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                <span>
                  Signed in to <strong className="text-slate-900 dark:text-white">{activeCompany.legalName}</strong>{' '}
                  <span className="text-slate-500 dark:text-slate-400">({user.email})</span>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate(`/${showingServerLanding ? 'server' : 'client'}/select-company`)}
                  className="px-3.5 py-2 bg-slate-100 dark:bg-[#162238] hover:bg-slate-200 dark:hover:bg-[#1F2F4C] text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Switch Company</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const mode = showingServerLanding ? 'server' : 'client';
                    const vanity = getCompanyVanityDomain(activeCompany);
                    navigate(`/${mode}/${vanity}/dashboard`);
                  }}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  Return to Active Workspace
                </button>
              </div>
            </div>
          )}

          {showingServerLanding ? (
            /* PC SERVER SIDE LANDING PAGE: Create Company, Open Existing Profile, Restore from Backup */
            <div className="space-y-6">
              <div
                data-testid="server-console-landing"
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
              >
              <button
                type="button"
                onClick={() => navigate('/server/profile/create')}
                data-testid="launcher-create-card"
                className="group bg-white dark:bg-[#11192B] px-7 py-9 rounded-2xl border border-slate-200/80 dark:border-[#1E2D45] shadow-xs hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:-translate-y-0.5 flex flex-col items-center text-center transition-all duration-150 cursor-pointer"
              >
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100/80 dark:border-indigo-900/60 flex items-center justify-center mb-5 text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition-transform">
                  <PlusCircle className="w-6 h-6" />
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                  Create Company
                </h2>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed max-w-[235px]">
                  Initialize new legal entity profile, Chart of Accounts, and admin credentials.
                </p>
              </button>

              <button
                type="button"
                onClick={() => navigate('/server/profile/open')}
                data-testid="launcher-open-card"
                className="group bg-white dark:bg-[#11192B] px-7 py-9 rounded-2xl border border-slate-200/80 dark:border-[#1E2D45] shadow-xs hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-500/60 hover:-translate-y-0.5 flex flex-col items-center text-center transition-all duration-150 cursor-pointer"
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100/80 dark:border-emerald-900/60 flex items-center justify-center mb-5 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform">
                  <FolderOpen className="w-6 h-6" />
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                  Open Existing Profile
                </h2>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed max-w-[235px]">
                  Select a local company database to authenticate and resume accounting operations.
                </p>
              </button>

              <button
                type="button"
                onClick={() => navigate('/server/profile/restore')}
                data-testid="launcher-restore-card"
                className="group bg-white dark:bg-[#11192B] px-7 py-9 rounded-2xl border border-slate-200/80 dark:border-[#1E2D45] shadow-xs hover:shadow-md hover:border-amber-300 dark:hover:border-amber-500/60 hover:-translate-y-0.5 flex flex-col items-center text-center transition-all duration-150 cursor-pointer"
              >
                <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-100/80 dark:border-amber-900/60 flex items-center justify-center mb-5 text-amber-600 dark:text-amber-400 group-hover:scale-105 transition-transform">
                  <RefreshCcw className="w-6 h-6" />
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                  Restore from Backup
                </h2>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed max-w-[235px]">
                  Restore company ledger from an encrypted snapshot or backup archive file.
                </p>
              </button>
            </div>
          </div>
          ) : (
            /* CLIENT SIDE LANDING PAGE: Available Company Profiles & Direct Login Pages ONLY */
            <div data-testid="client-company-directory" className="space-y-5">
              <div className="bg-white dark:bg-[#11192B] p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-700 dark:text-sky-400" />
                    <span>Available Company Profiles</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Choose your company workspace to proceed to its dedicated login page.
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      aria-label="Search company or TIN"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search company or TIN..."
                      data-testid="client-company-search"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-[#24344F] rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={loadAvailableCompanies}
                    aria-label="Refresh company list"
                    title="Refresh company list"
                    className="p-2 rounded-xl border border-slate-200 dark:border-[#24344F] bg-slate-50 dark:bg-[#162238] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingCompanies ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {companiesError && (
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3">
                  <span>{companiesError}</span>
                  <button
                    type="button"
                    onClick={loadAvailableCompanies}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {loadingCompanies ? (
                <div className="bg-white dark:bg-[#11192B] p-10 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-sky-400" />
                  <span className="text-xs font-medium">Loading registered company profiles...</span>
                </div>
              ) : filteredCompanies.length === 0 ? (
                <div className="bg-white dark:bg-[#11192B] p-10 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center space-y-2">
                  <Building2 className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
                  <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 text-base">
                    {searchQuery ? 'No matching company profile found' : 'No company profiles mapped on server yet'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                    {searchQuery
                      ? 'Try a different company name or clear your search filter.'
                      : 'No active company workspaces are currently opened or mapped on the central server. Please open or register an existing company profile on the Server Console to make it available here.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredCompanies.map((company) => (
                    <div
                      key={company.id}
                      data-testid={`client-company-card-${company.id}`}
                      onClick={() => handleOpenCompanyLogin(company)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenCompanyLogin(company);
                        }
                      }}
                      className="group bg-white dark:bg-[#11192B] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] hover:border-blue-400 dark:hover:border-sky-500/70 card-hover flex flex-col justify-between gap-4 cursor-pointer transition-all"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/60 flex items-center justify-center text-blue-700 dark:text-sky-400 shrink-0">
                            <Building2 className="w-5 h-5" />
                          </div>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/80 text-[11px] font-semibold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Active Workspace
                          </span>
                        </div>

                        <div>
                          <h3 className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-slate-50 leading-snug">
                            {company.legalName}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Philippine Accounting Workspace
                          </p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 dark:border-[#1B2942] flex items-center justify-between gap-3">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-slate-400" />
                          <span>Protected Login</span>
                        </span>
                        <button
                          type="button"
                          data-testid={`client-company-signin-${company.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenCompanyLogin(company);
                          }}
                          className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <span>Sign In</span>
                          <ArrowRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-center text-[11px] text-slate-500 dark:text-slate-400 pt-2">
                New company creation, local folder registration, and backup restoration are restricted to the LedgerAI PH PC Server console.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
