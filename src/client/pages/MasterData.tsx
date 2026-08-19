import React from 'react';
import { Users, Truck, FileText, Database, Building2 } from 'lucide-react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import CustomersList from './master-data/CustomersList';
import VendorsList from './master-data/VendorsList';
import CostCentersList from './master-data/CostCentersList';
import TaxCodesList from './master-data/TaxCodesList';

function MasterDataOverview() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">Master Data Directory</h2>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
          Trading partners, customers, supplier registers, cost centers, and BIR statutory tax classification codes.
        </p>
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
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Customers</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Client records, billing addresses, TINs, and credit terms.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
            <span>Manage Directory</span>
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
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">Vendors</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Supplier profiles, payment terms, and vendor TIN registers.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <span>Manage Suppliers</span>
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
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Cost Centers</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Departmental tracking and operational expense allocation.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <span>Manage Centers</span>
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
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">Tax Codes</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              12% VAT, ATC codes, withholding tables, and statutory rates.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-rose-600 dark:text-rose-400">
            <span>Configure Rates</span>
            <span>&rarr;</span>
          </div>
        </Link>
      </div>
    </div>
  );
}

export default function MasterData() {
  const location = useLocation();
  const isRoot = location.pathname === '/master-data' || location.pathname === '/master-data/';

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
        <Link to="/master-data" className="hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold">
          Master Data
        </Link>
        {!isRoot && <span>/</span>}
        {!isRoot && (
          <span className="text-slate-800 dark:text-slate-200 font-bold capitalize">
            {location.pathname.split('/').pop()?.replace('-', ' ')}
          </span>
        )}
      </div>

      <Routes>
        <Route path="/" element={<MasterDataOverview />} />
        <Route path="customers" element={<CustomersList />} />
        <Route path="vendors" element={<VendorsList />} />
        <Route path="cost-centers" element={<CostCentersList />} />
        <Route path="tax-codes" element={<TaxCodesList />} />
      </Routes>
    </div>
  );
}
