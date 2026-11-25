import React from 'react';
import { Users, Truck, FileText, Database, Building2, HardDrive, Network, Settings as SettingsIcon } from 'lucide-react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import CustomersList from './master-data/CustomersList';
import VendorsList from './master-data/VendorsList';
import CostCentersList from './master-data/CostCentersList';
import TaxCodesList from './master-data/TaxCodesList';
import RbacMatrixWorkspace from './master-data/RbacMatrixWorkspace';
import BackupManager from './BackupManager';
import LanServerDashboard from '../components/lan/LanServerDashboard';

function MasterDataOverview() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">Master Data & Administration Hub</h2>
            <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
              Governance & Core Registries
            </span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Authoritative single-source registries for trading partners, organizational dimensions, BIR tax classifications, RBAC security matrix, database vault, and LAN workstation governance.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Link 
          to="/master-data/customers" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl w-fit mb-3.5 border border-indigo-100 dark:border-indigo-900/40 group-hover:scale-105 transition-transform">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Customer Master Registry</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Client master profiles, billing addresses, verified TINs, credit limits, and receivables terms.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
            <span>Open Registry</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/master-data/vendors" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-amber-500 dark:hover:border-amber-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl w-fit mb-3.5 border border-amber-100 dark:border-amber-900/40 group-hover:scale-105 transition-transform">
              <Truck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">Vendor & Supplier Registry</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Accredited supplier profiles, EWT/ATC default rates, payment terms, and vendor TIN directory.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <span>Open Registry</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/master-data/cost-centers" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl w-fit mb-3.5 border border-emerald-100 dark:border-emerald-900/40 group-hover:scale-105 transition-transform">
              <Building2 className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Organizational Dimensions & Cost Centers</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Unified enterprise hierarchy for Cost Centers, Operating Departments, and Capital Projects.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <span>Manage Dimensions</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/master-data/tax-codes" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-rose-500 dark:hover:border-rose-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl w-fit mb-3.5 border border-rose-100 dark:border-rose-900/40 group-hover:scale-105 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">Statutory Tax Codes & ATC Rates</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              12% VAT, Percentage Tax, BIR Alphanumeric Tax Codes (ATC), and GL tax account mappings.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-rose-600 dark:text-rose-400">
            <span>Configure Tax Matrix</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/master-data/rbac" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 rounded-xl w-fit mb-3.5 border border-purple-100 dark:border-purple-900/40 group-hover:scale-105 transition-transform">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Role & Permission Access Matrix</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              User account provisioning, role-based access control, and 16-module security entitlement matrix.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-purple-600 dark:text-purple-400">
            <span>Manage Users & RBAC</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/master-data/backup-vault" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-sky-500 dark:hover:border-sky-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 rounded-xl w-fit mb-3.5 border border-sky-100 dark:border-sky-900/40 group-hover:scale-105 transition-transform">
              <HardDrive className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">Database Vault & Disaster Recovery</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Encrypted ledger snapshots, SHA-256 integrity verification, point-in-time recovery, and retention policies.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-sky-600 dark:text-sky-400">
            <span>Open Backup Vault</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/master-data/lan-network" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-teal-500 dark:hover:border-teal-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 rounded-xl w-fit mb-3.5 border border-teal-100 dark:border-teal-900/40 group-hover:scale-105 transition-transform">
              <Network className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">Multi-Workstation LAN & Concurrency</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Local area network server host status, active client workstations, record locks, and sync telemetry.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-teal-600 dark:text-teal-400">
            <span>Inspect LAN Cluster</span>
            <span>&rarr;</span>
          </div>
        </Link>

        <Link 
          to="/settings" 
          className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-slate-500 dark:hover:border-slate-400 hover:shadow-xs transition-all group flex flex-col justify-between"
        >
          <div>
            <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl w-fit mb-3.5 border border-slate-200 dark:border-slate-700 group-hover:scale-105 transition-transform">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Company Profile & System Settings</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              BIR registration profile, CAS/CBA authority parameters, licensing, and global ERP preferences.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
            <span>System Configuration</span>
            <span>&rarr;</span>
          </div>
        </Link>
      </div>
    </div>
  );
}

export default function MasterData() {
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/^\/(?:client|server)\/[^\/]+/, '') || '/';
  const isRoot = normalizedPath === '/master-data' || normalizedPath === '/master-data/';

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-500 dark:text-slate-400">
          Master Data & Administration
        </span>
        {!isRoot && <span>/</span>}
        {!isRoot && (
          <span className="text-slate-800 dark:text-slate-200 font-bold capitalize">
            {normalizedPath.split('/').pop()?.replace(/-/g, ' ')}
          </span>
        )}
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="customers" replace />} />
        <Route path="customers" element={<CustomersList />} />
        <Route path="vendors" element={<VendorsList />} />
        <Route path="cost-centers" element={<CostCentersList />} />
        <Route path="departments" element={<CostCentersList />} />
        <Route path="projects" element={<CostCentersList />} />
        <Route path="tax-codes" element={<TaxCodesList />} />
        <Route path="rbac" element={<RbacMatrixWorkspace />} />
        <Route path="users" element={<RbacMatrixWorkspace />} />
        <Route path="backup-vault" element={<BackupManager />} />
        <Route path="lan-network" element={<LanServerDashboard />} />
      </Routes>
    </div>
  );
}

