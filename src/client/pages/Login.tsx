import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Building2, ArrowLeft, AlertTriangle, Sun, Moon, Lock, Repeat, RefreshCw } from 'lucide-react';
import { LedgerLogoIcon } from '../components/LedgerLogo';
import { CompanyPreferenceService } from '../services/companyPreferenceService';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

export default function Login() {
  const { companyId: routeCompanyId, tenantDomain } = useParams();
  const activeParam = (tenantDomain || routeCompanyId || '').trim();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [isServerUnreachable, setIsServerUnreachable] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user, activeCompany, switchWorkspaceCleanup } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();

  const currentConsoleMode = location.pathname.startsWith('/server') ? 'server' : 'client';

  const loadCompanyDetails = useCallback(() => {
    if (!activeParam) {
      navigate(`/${currentConsoleMode}/launcher?switch=1`, { replace: true });
      return;
    }

    setLoadError('');
    setIsServerUnreachable(false);
    fetch(`/api/companies/${encodeURIComponent(activeParam)}`, { credentials: 'include' })
      .then(async (r) => {
        const contentType = r.headers.get('content-type');
        const data =
          contentType && contentType.includes('application/json')
            ? await r.json().catch(() => null)
            : null;
        if (r.status === 404 || r.status === 403 || r.status === 410) {
          CompanyPreferenceService.clearLastSelectedCompany();
          throw new Error(
            data?.message || `Company '${activeParam}' is no longer registered or active on this server.`
          );
        }
        if (r.status === 502 || r.status === 503 || r.status === 504) {
          setIsServerUnreachable(true);
          throw new Error(
            'The LedgerAI PH central server is temporarily unreachable. Your saved company preference has been preserved.'
          );
        }
        if (!r.ok) {
          throw new Error(data?.message || `Company '${activeParam}' could not be loaded (HTTP ${r.status}).`);
        }
        return data;
      })
      .then((data) => {
        if (!data || data.error) {
          setLoadError(data?.message || 'Company profile not found.');
        } else {
          setCompany(data);
          // Save per-browser-profile preference ONLY after server validates company exists
          CompanyPreferenceService.setLastSelectedCompany(data.id || activeParam, data.legalName || '');
        }
      })
      .catch((err: any) => {
        if (err instanceof TypeError || /failed to fetch|network/i.test(String(err?.message || ''))) {
          setIsServerUnreachable(true);
          setLoadError(
            'Cannot reach the LedgerAI PH central server. Verify the server PC is online and connected to the network.'
          );
        } else {
          setLoadError(err?.message || 'Unable to load company profile.');
        }
      });
  }, [activeParam, currentConsoleMode, navigate]);

  useEffect(() => {
    loadCompanyDetails();
  }, [loadCompanyDetails]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const resolvedCompanyId = company?.id || activeParam;
      if (activeCompany && activeCompany.id && activeCompany.id !== resolvedCompanyId) {
        await switchWorkspaceCleanup(resolvedCompanyId);
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, companyId: resolvedCompanyId }),
      });

      let data: any = {};
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = { message: await res.text() };
      }

      if (res.ok) {
        login(data);
        const vanityDomain = company
          ? getCompanyVanityDomain(company)
          : getCompanyVanityDomain({ id: resolvedCompanyId, legalName: data.company?.legalName });
        navigate(`/${currentConsoleMode}/${vanityDomain}/dashboard`, { replace: true });
      } else {
        setError(data.message || 'Sign in failed. Please check your credentials.');
      }
    } catch (err) {
      console.error(err);
      setError('Cannot connect to the central server. Please check your network connection and retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchCompany = () => {
    if (user && activeCompany) {
      navigate(`/${currentConsoleMode}/select-company`);
    } else {
      navigate(`/${currentConsoleMode}/launcher?switch=1`);
    }
  };

  const handleDemoLogin = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('demo123!');
  };

  const handlePrimaryDemoCompanyOwner = () => {
    setEmail('superadmin@bsystem.com');
    setPassword('@dM1n2025Couls');
  };

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] py-12 px-4">
        <div className="w-full max-w-md bg-white dark:bg-[#11192B] p-7 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-600 dark:text-amber-400 mx-auto" />
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            {isServerUnreachable ? 'Central Server Unreachable' : 'Company Workspace Unavailable'}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{loadError}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {isServerUnreachable && (
              <button
                type="button"
                onClick={loadCompanyDetails}
                className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Connection</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(`/${currentConsoleMode}/launcher?switch=1`)}
              className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold cursor-pointer"
            >
              Switch Company
            </button>
            <button
              type="button"
              onClick={() => navigate(`/${currentConsoleMode}/launcher?switch=1`)}
              className="px-4 py-2.5 bg-slate-100 dark:bg-[#162238] text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Launcher
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] text-slate-500 dark:text-slate-400 text-xs font-medium">
        Loading company workspace...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FA] dark:bg-[#0B1120] py-10 px-4 transition-colors">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <button
            type="button"
            onClick={handleSwitchCompany}
            data-testid="login-switch-company-btn"
            className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-blue-700 dark:hover:text-sky-400 font-semibold text-xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Switch Company</span>
          </button>

          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark', true)}
            aria-label="Toggle theme"
            className="p-2 rounded-xl border border-slate-200 dark:border-[#24344F] bg-white dark:bg-[#11192B] text-slate-600 dark:text-slate-300 cursor-pointer"
          >
            {resolvedTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className="bg-white dark:bg-[#11192B] p-6 sm:p-8 rounded-2xl border border-slate-200/90 dark:border-[#1E2D45] shadow-xs transition-colors">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <LedgerLogoIcon size={44} />
            </div>
            <h1 className="font-display text-xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">
              Ledger<span className="text-blue-700 dark:text-sky-400">AI</span> PH
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Sign in to access your accounting workspace
            </p>

            <div className="mt-5 p-3.5 bg-slate-50 dark:bg-[#0F172A] rounded-xl border border-slate-200/80 dark:border-[#1E2D45] flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Selected Company Workspace
              </span>
              <span
                data-testid="login-company-name"
                className="text-sm sm:text-base font-display font-bold text-slate-900 dark:text-slate-50 flex items-center justify-center gap-2"
              >
                <Building2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                <span className="truncate max-w-[280px]">{company.legalName}</span>
              </span>
              <button
                type="button"
                onClick={handleSwitchCompany}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                <Repeat className="w-3 h-3" />
                <span>Switch to a different company</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-xl text-xs text-center font-medium space-y-2">
              <p>{error}</p>
              {(error.includes('recovery') || error.includes('quarantine')) && (
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate(location.pathname.startsWith('/server') ? '/server/profile/restore' : '/client/launcher?switch=1')}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Open Backup Recovery &rarr;
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(location.pathname.startsWith('/server') ? '/server/profile/open' : '/client/launcher?switch=1')}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Locate Folder
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 min-h-[44px] bg-slate-50/80 dark:bg-[#0F172A] border border-slate-300/90 dark:border-[#24344F] rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600 transition-colors"
                placeholder="name@company.ph"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 min-h-[44px] bg-slate-50/80 dark:bg-[#0F172A] border border-slate-300/90 dark:border-[#24344F] rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors mt-1 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{submitting ? 'Signing In...' : 'Sign In'}</span>
            </button>
          </form>

          {company.isDemo && (
            <div className="mt-6 pt-5 border-t border-slate-100 dark:border-[#1E2D45]">
              <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2.5 text-center">
                Quick Demo Accounts
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.owner@demo.com' : 'companyb.owner@demo.com')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs rounded-lg font-medium cursor-pointer">Owner</button>
                <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.admin@demo.com' : 'companyb.admin@demo.com')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs rounded-lg font-medium cursor-pointer">Admin</button>
                <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.accountant@demo.com' : 'companyb.accountant@demo.com')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs rounded-lg font-medium cursor-pointer">Accountant</button>
                <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.auditor@demo.com' : 'companyb.auditor@demo.com')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs rounded-lg font-medium cursor-pointer">Auditor</button>
                <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.staff@demo.com' : 'companyb.staff@demo.com')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs rounded-lg font-medium cursor-pointer">Staff</button>
                <button type="button" onClick={handlePrimaryDemoCompanyOwner} className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-sky-300 border border-blue-200 dark:border-blue-800 text-xs rounded-lg font-semibold w-full mt-1 cursor-pointer">Primary Owner</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
