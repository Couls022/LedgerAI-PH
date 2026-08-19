import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock } from 'lucide-react';
import { Building2, ArrowLeft } from 'lucide-react';
import { LedgerLogo, LedgerLogoIcon } from '../components/LedgerLogo';

export default function Login() {
  const { companyId } = useParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    if (companyId) {
      fetch(`/api/companies/${companyId}`)
        .then(async r => {
          if (!r.ok) throw new Error("Fetch failed");
          const contentType = r.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            return r.json();
          }
          throw new Error("Invalid content type");
        })
        .then(data => {
          if (data.error) {
            navigate('/launcher');
          } else {
            setCompany(data);
          }
        })
        .catch(() => navigate('/launcher'));
    } else {
      navigate('/launcher');
    }
  }, [companyId, navigate]);

  
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: password, newPassword })
      });
      
      let data: any = {};
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = { message: await res.text() };
      }

      if (res.ok) {
        setRequirePasswordChange(false);
        setPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        
        // try to refresh session by calling session api
        const sessRes = await fetch('/api/auth/session');
        let sessData: any = null;
        const sessContentType = sessRes.headers.get('content-type');
        if (sessContentType && sessContentType.includes('application/json')) {
          sessData = await sessRes.json();
        }

        if (sessRes.ok && sessData) {
          login(sessData);
        } else {
          navigate('/launcher');
        }

      } else {
        setError(data.message || 'Failed to change password');
      }
    } catch (err) {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, companyId })
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
        navigate('/');
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred during login.');
    }
  };


  const handleDemoLogin = (demoEmail: string, role: string) => {
    setEmail(demoEmail);
    setPassword('demo123!');
  };

  const handlePrimaryDemoCompanyOwner = () => {
    setEmail('superadmin@bsystem.com');
    setPassword('@dM1n2025Couls');
  };

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f6fb] dark:bg-[#090d16] text-slate-500 dark:text-slate-400 text-xs font-semibold">
        Loading company profile...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f6fb] dark:bg-[#090d16] py-12 px-4 transition-colors">
      <div className="w-full max-w-md">
        <button 
          onClick={() => navigate('/profile/open')}
          className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-6 font-semibold text-xs transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Company Profiles
        </button>
        
        <div className="bg-white dark:bg-[#111827] p-8 rounded-2xl shadow-xs border border-slate-200/90 dark:border-slate-800 transition-colors">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <LedgerLogoIcon size={44} />
            </div>
            <h1 className="text-xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
              Ledger<span className="text-indigo-600 dark:text-indigo-400">AI</span> PH
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Secure Double-Entry & Tax Compliance Terminal</p>
            
            <div className="mt-5 p-3.5 bg-slate-50 dark:bg-[#141d2e] rounded-xl border border-slate-200/80 dark:border-slate-800 inline-flex flex-col items-center justify-center w-full">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Target Company</span>
              <span className="text-base font-bold text-indigo-700 dark:text-indigo-400 flex items-center justify-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> {company.legalName}
              </span>
            </div>
          </div>
          
          {error && (
            <div className="mb-5 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-xs text-center font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Email / Username</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                className="w-full px-3.5 py-2.5 bg-slate-50/70 dark:bg-[#182234] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium" 
                placeholder="name@company.com"
                required 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full px-3.5 py-2.5 bg-slate-50/70 dark:bg-[#182234] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium" 
                placeholder="••••••••"
                required 
              />
            </div>
            <button 
              type="submit" 
              className="w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white py-2.5 rounded-xl font-bold text-xs transition-colors mt-2 shadow-xs"
            >
              Sign In to Company
            </button>
          </form>

          {company.isDemo && (
            <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
               <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2.5 text-center">Quick Demo Credentials</p>
               <div className="flex flex-wrap justify-center gap-1.5">
                 <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.owner@demo.com' : 'companyb.owner@demo.com', 'Company Owner')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] rounded-lg font-medium transition-colors">Owner</button>
                 <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.admin@demo.com' : 'companyb.admin@demo.com', 'Company Administrator')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] rounded-lg font-medium transition-colors">Admin</button>
                 <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.accountant@demo.com' : 'companyb.accountant@demo.com', 'Accountant')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] rounded-lg font-medium transition-colors">Accountant</button>
                 <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.auditor@demo.com' : 'companyb.auditor@demo.com', 'Auditor')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] rounded-lg font-medium transition-colors">Auditor</button>
                 <button type="button" onClick={() => handleDemoLogin(company.legalName.includes('Acme') ? 'companya.staff@demo.com' : 'companyb.staff@demo.com', 'Staff')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] rounded-lg font-medium transition-colors">Staff</button>
                 <button type="button" onClick={handlePrimaryDemoCompanyOwner} className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] rounded-lg font-bold transition-colors w-full mt-1">Super Admin / Primary Owner</button>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
