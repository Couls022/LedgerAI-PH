import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  ShieldCheck, FileCheck, FileText, UserCheck, ShieldAlert, Activity,
  Calculator, Table, Download
} from 'lucide-react';
import AuditEngagements from './AuditEngagements';
import AuditWorkpapers from './AuditWorkpapers';
import AuditFindings from './AuditFindings';
import ApprovalWorkflow from '../components/controls/ApprovalWorkflow';
import FraudDetection from './FraudDetection';
import AuditLog from './AuditLog';
import AuditIntegrity from './AuditIntegrity';
import AuditSampling from './AuditSampling';
import AuditLeadSheets from './AuditLeadSheets';
import AuditPackageExporter from './AuditPackageExporter';

const AuditOverview = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Audit & Controls Workspace</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Centralized hub for audit engagements, working papers, findings, sampling engine, lead sheets, approvals, fraud detection, and binder exports.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-5">
        <Link 
          to="/audit/engagements"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Engagements</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage audit projects, scopes, planning, risk assessments, and team assignments.
          </p>
        </Link>

        <Link 
          to="/audit/sampling"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <Calculator className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Sampling Engine</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            PSA 530 Monetary Unit Sampling (MUS), Cutoff testing, and statistical sample generation.
          </p>
        </Link>

        <Link 
          to="/audit/leadsheets"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <Table className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Lead Sheets</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Lead schedules A through I with Unadjusted Trial Balance and AJE net adjustments.
          </p>
        </Link>

        <Link 
          to="/audit/workpapers"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <FileCheck className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Workpapers</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Review lead schedules, test of controls, substantive testing, tick-marks, and attachments.
          </p>
        </Link>

        <Link 
          to="/audit/findings"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <FileText className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Findings & AJE</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Track internal control deficiencies, audit observations, and audit journal adjustments (AJE).
          </p>
        </Link>

        <Link 
          to="/audit/package"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <Download className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Package Exporter</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Export complete PSA working paper binder, opinion draft, and compliance packages.
          </p>
        </Link>

        <Link 
          to="/audit/approvals"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <UserCheck className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Approval Workflow</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Review and authorize high-value transactions, journal entries, and sensitive postings.
          </p>
        </Link>

        <Link 
          to="/audit/fraud"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Fraud Detection</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Automated anomaly detection, duplicate payments, unusual journal timing, and risk flags.
          </p>
        </Link>

        <Link 
          to="/audit/logs"
          className="p-5 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all group cursor-pointer"
        >
          <div className="p-3 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 rounded-xl w-fit mb-3 group-hover:scale-105 transition-transform">
            <Activity className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">Audit Log</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Immutable system audit trail tracking all user logins, record modifications, and security events.
          </p>
        </Link>
      </div>
    </div>
  );
};

export default function Audit() {
  const location = useLocation();
  const isRoot = location.pathname === '/audit' || location.pathname === '/audit/';

  return (
    <div className="w-full space-y-4">
      <div className="flex space-x-2 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/audit" className="hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">Audit Workspace</Link>
        {!isRoot && <span>/</span>}
        {!isRoot && <span className="text-slate-800 dark:text-slate-200 font-semibold capitalize">{location.pathname.split('/').pop()?.replace('-', ' ')}</span>}
      </div>

      <Routes>
        <Route path="/" element={<AuditOverview />} />
        <Route path="engagements" element={<AuditEngagements />} />
        <Route path="sampling" element={<AuditSampling />} />
        <Route path="leadsheets" element={<AuditLeadSheets />} />
        <Route path="workpapers" element={<AuditWorkpapers />} />
        <Route path="findings" element={<AuditFindings />} />
        <Route path="package" element={<AuditPackageExporter />} />
        <Route path="approvals" element={<ApprovalWorkflow />} />
        <Route path="fraud" element={<FraudDetection />} />
        <Route path="logs" element={<AuditLog />} />
        <Route path="integrity" element={<AuditIntegrity />} />
      </Routes>
    </div>
  );
}
