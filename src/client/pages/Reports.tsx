import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  FileText, TrendingUp, Users, ShoppingBag, Search, Filter, 
  BarChart3, RefreshCw, Layers, Calendar, Activity, CheckCircle, ShieldCheck, Printer, ArrowRight
} from 'lucide-react';
import ExportButton, { ExportData } from '../components/ExportButton';
import { useAuth } from '../context/AuthContext';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

const ReportsOverview = () => {
  const reportCards = [
    { title: 'Trial Balance', path: '/reports/trial-balance', desc: 'Consolidated debits and credits for all company accounts.', icon: BarChart3, color: 'indigo' },
    { title: 'General Ledger', path: '/reports/general-ledger', desc: 'Chronological account activity and running ledger balances.', icon: FileText, color: 'blue' },
    { title: 'General Journal', path: '/reports/general-journal', desc: 'All journal entries and line-level accounting records.', icon: Layers, color: 'emerald' },
    { title: 'Balance Sheet', path: '/reports/balance-sheet', desc: 'Statement of financial position (Assets = Liabilities + Equity).', icon: TrendingUp, color: 'violet' },
    { title: 'Income Statement', path: '/reports/income-statement', desc: 'Revenues, expenses, and net income performance report.', icon: Activity, color: 'green' },
    { title: 'Statement of Cash Flows', path: '/reports/cash-flow', desc: 'Operating, investing, and financing cash movement analysis.', icon: Calendar, color: 'amber' },
    { title: 'Changes in Equity', path: '/reports/changes-in-equity', desc: 'Statement of changes in equity and retained earnings.', icon: ShieldCheck, color: 'rose' },
    { title: 'Comparative Balance Sheet', path: '/reports/comparative-balance-sheet', desc: 'Period-over-period comparative statement of financial position.', icon: BarChart3, color: 'indigo' },
    { title: 'Comparative Income Statement', path: '/reports/comparative-income-statement', desc: 'Period-over-period comparative revenue and expense performance.', icon: TrendingUp, color: 'blue' },
    { title: 'Account Schedule', path: '/reports/account-schedule', desc: 'Detailed schedule breakdown for specified accounts.', icon: FileText, color: 'emerald' },
    { title: 'Transaction Detail', path: '/reports/transaction-detail', desc: 'Granular transaction log with source references.', icon: Layers, color: 'violet' },
    { title: 'Cashbook', path: '/reports/cashbook', desc: 'Cash receipts and disbursements cashbook ledger.', icon: Activity, color: 'green' },
    { title: 'AR Aging Summary', path: '/reports/ar-aging', desc: 'Accounts receivable aging breakdown by customer due dates.', icon: Users, color: 'emerald' },
    { title: 'AP Aging Summary', path: '/reports/ap-aging', desc: 'Accounts payable aging breakdown by vendor bill due dates.', icon: ShoppingBag, color: 'amber' },
    { title: 'Bank Reconciliation Report', path: '/reports/bank-reconciliation-report', desc: 'Bank statement reconciliation and unexplained differences audit.', icon: CheckCircle, color: 'blue' },
    { title: 'Department Report', path: '/reports/department-report', desc: 'Financial performance and expense breakdown by department.', icon: Layers, color: 'indigo' },
    { title: 'Project Report', path: '/reports/project-report', desc: 'Project budgets, revenues, and costs tracking.', icon: BarChart3, color: 'violet' },
    { title: 'Branch Report', path: '/reports/branch-report', desc: 'Branch and location-specific financial reporting.', icon: FileText, color: 'rose' },
    { title: 'Audit Trail Report', path: '/reports/audit-trail-report', desc: 'Immutable audit logs and security event tracking.', icon: ShieldCheck, color: 'amber' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight">Financial Reports & Statements</h2>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
          Derive real-time financial statements, tax schedules, and management reports directly from the company ledger.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportCards.map((rc, idx) => {
          const Icon = rc.icon;
          return (
            <Link 
              key={idx}
              to={rc.path} 
              className="p-5 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-xs transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl w-fit mb-3.5 border border-indigo-100 dark:border-indigo-900/40 group-hover:scale-105 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{rc.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                  {rc.desc}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                <span>View Report</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

// Generic Report Viewer Component for dynamic data
const GenericReportView = ({ title, endpoint, headersMapper, rowMapper }: { title: string, endpoint: string, headersMapper: string[], rowMapper: (item: any) => (string | number)[] }) => {
  const { activeCompany } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [signedOff, setSignedOff] = useState(false);
  const [signNote, setSignNote] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(Array.isArray(json) ? json : (json.data || json.comparison || []));
        setMetadata(json.metadata || null);
      }
    } catch (err) {
      console.error(`Failed to fetch ${title}:`, err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const handleSignOff = async () => {
    try {
      const res = await fetch('/api/reports/sign-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportName: title, notes: signNote })
      });
      if (res.ok) {
        setSignedOff(true);
      }
    } catch (err) {
      console.error('Sign off failed:', err);
    }
  };

  const exportData: ExportData = {
    filename: `${title.replace(/\s+/g, '_')}_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: title,
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Generated: ${metadata?.generatedAt || new Date().toLocaleString()}`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: headersMapper,
    rows: data.map(rowMapper),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/reports" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">&larr; Back to Reports</Link>
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">{title}</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Generated by <span className="font-medium text-slate-700 dark:text-slate-300">{metadata?.generatedBy || 'System'}</span> at {metadata?.generatedAt ? new Date(metadata.generatedAt).toLocaleString() : 'Just now'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <input 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            />
            <span className="text-slate-400">to</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            />
          </div>
          <button
            onClick={fetchData}
            className="p-2 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <ExportButton data={exportData} disabled={loading} />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading report data...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[800px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                <tr>
                  {headersMapper.map((h, i) => (
                    <th key={i} className="py-3.5 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {data.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                    {rowMapper(item).map((cell, cIdx) => (
                      <td key={cIdx} className="py-3.5 px-4 text-xs font-medium text-slate-800 dark:text-slate-100">{cell}</td>
                    ))}
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={headersMapper.length} className="py-12 text-center text-slate-400">
                      No records found for this report.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Report Sign-off & Certification */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Report Certification & Sign-off
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {signedOff ? 'This report has been officially certified and signed off.' : 'Certify this financial report for audit and compliance review.'}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {!signedOff ? (
            <>
              <input 
                type="text" 
                placeholder="Enter sign-off notes / reviewer comments..."
                value={signNote}
                onChange={e => setSignNote(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 flex-1 sm:w-64"
              />
              <button
                onClick={handleSignOff}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shrink-0"
              >
                Sign Off & Seal
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <CheckCircle className="w-4 h-4" />
              Certified & Signed
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function Reports() {
  const location = useLocation();
  const isRoot = location.pathname === '/reports' || location.pathname === '/reports/';

  return (
    <div className="w-full space-y-4">
      <div className="flex space-x-2 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/reports" className="hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">Reports</Link>
        {!isRoot && <span>/</span>}
        {!isRoot && <span className="text-slate-800 dark:text-slate-200 font-semibold capitalize">{location.pathname.split('/').pop()?.replace(/-/g, ' ')}</span>}
      </div>

      <Routes>
        <Route path="/" element={<ReportsOverview />} />
        
        <Route path="trial-balance" element={
          <GenericReportView 
            title="Trial Balance"
            endpoint="/api/reports/trial-balance"
            headersMapper={['Account Code', 'Account Name', 'Type', 'Debit (PHP)', 'Credit (PHP)']}
            rowMapper={(b) => [
              b.accountCode,
              b.accountName,
              b.accountType,
              b.debitTotal > 0 ? formatCurrency(b.debitTotal) : '₱0.00',
              b.creditTotal > 0 ? formatCurrency(b.creditTotal) : '₱0.00'
            ]}
          />
        } />

        <Route path="general-ledger" element={
          <GenericReportView 
            title="General Ledger"
            endpoint="/api/reports/general-ledger"
            headersMapper={['Date', 'Journal #', 'Account', 'Description', 'Debit', 'Credit']}
            rowMapper={(l) => [
              l.entryDate,
              l.journalNumber,
              `${l.accountCode} - ${l.accountName}`,
              l.description || l.lineDescription || '-',
              l.debit > 0 ? formatCurrency(l.debit) : '-',
              l.credit > 0 ? formatCurrency(l.credit) : '-'
            ]}
          />
        } />

        <Route path="general-journal" element={
          <GenericReportView 
            title="General Journal"
            endpoint="/api/reports/general-journal"
            headersMapper={['Date', 'Journal #', 'Account', 'Description', 'Debit', 'Credit']}
            rowMapper={(j) => [
              j.entryDate,
              j.journalNumber,
              `${j.accountCode} - ${j.accountName}`,
              j.lineDescription || j.description || '-',
              j.debit > 0 ? formatCurrency(j.debit) : '-',
              j.credit > 0 ? formatCurrency(j.credit) : '-'
            ]}
          />
        } />

        <Route path="balance-sheet" element={
          <GenericReportView 
            title="Balance Sheet"
            endpoint="/api/reports/balance-sheet"
            headersMapper={['Account Code', 'Account Name', 'Type', 'Balance (PHP)']}
            rowMapper={(acc) => [
              acc.accountCode,
              acc.accountName,
              acc.accountType,
              formatCurrency(acc.balance)
            ]}
          />
        } />

        <Route path="income-statement" element={
          <GenericReportView 
            title="Income Statement"
            endpoint="/api/reports/income-statement"
            headersMapper={['Account Code', 'Account Name', 'Type', 'Balance (PHP)']}
            rowMapper={(acc) => [
              acc.accountCode,
              acc.accountName,
              acc.accountType,
              formatCurrency(acc.balance)
            ]}
          />
        } />

        <Route path="cash-flow" element={
          <GenericReportView 
            title="Statement of Cash Flows"
            endpoint="/api/reports/cash-flow"
            headersMapper={['Date', 'Account', 'Description', 'Net Cash (PHP)']}
            rowMapper={(cf) => [
              cf.entryDate,
              cf.accountName,
              cf.description || '-',
              formatCurrency((cf.debit || 0) - (cf.credit || 0))
            ]}
          />
        } />

        <Route path="changes-in-equity" element={
          <GenericReportView 
            title="Statement of Changes in Equity"
            endpoint="/api/reports/changes-in-equity"
            headersMapper={['Equity Component', 'Amount (PHP)']}
            rowMapper={(item) => [item.component, formatCurrency(item.amount)]}
          />
        } />

        <Route path="comparative-balance-sheet" element={
          <GenericReportView 
            title="Comparative Balance Sheet"
            endpoint="/api/reports/comparative-balance-sheet"
            headersMapper={['Code', 'Account Name', 'Type', 'Current Balance', 'Prior Balance', 'Variance', 'Variance %']}
            rowMapper={(item) => [
              item.accountCode, 
              item.accountName, 
              item.accountType, 
              formatCurrency(item.currentPeriodBalance), 
              formatCurrency(item.priorPeriodBalance), 
              formatCurrency(item.varianceAmount), 
              item.variancePercent
            ]}
          />
        } />

        <Route path="comparative-income-statement" element={
          <GenericReportView 
            title="Comparative Income Statement"
            endpoint="/api/reports/comparative-income-statement"
            headersMapper={['Financial Line Item', 'Current Period', 'Prior Period', 'Variance', 'Variance %']}
            rowMapper={(item) => [
              item.lineItem, 
              formatCurrency(item.currentPeriod), 
              formatCurrency(item.priorPeriod), 
              formatCurrency(item.varianceAmount), 
              item.variancePercent
            ]}
          />
        } />

        <Route path="account-schedule" element={
          <GenericReportView 
            title="Account Schedule"
            endpoint="/api/reports/account-schedule"
            headersMapper={['Account Code', 'Account Name', 'Type', 'Total Debit', 'Total Credit', 'Net Movement', 'Closing Balance']}
            rowMapper={(item) => [
              item.accountCode, 
              item.accountName, 
              item.accountType, 
              formatCurrency(item.totalDebit), 
              formatCurrency(item.totalCredit), 
              formatCurrency(item.netMovement), 
              formatCurrency(item.closingBalance)
            ]}
          />
        } />

        <Route path="transaction-detail" element={
          <GenericReportView 
            title="Transaction Detail"
            endpoint="/api/reports/transaction-detail"
            headersMapper={['Journal Number', 'Date', 'Status', 'Description']}
            rowMapper={(tx) => [tx.journalNumber, tx.entryDate, tx.status, tx.description || '-']}
          />
        } />

        <Route path="cashbook" element={
          <GenericReportView 
            title="Cashbook"
            endpoint="/api/reports/cashbook"
            headersMapper={['Date', 'Journal #', 'Account', 'Description', 'Debit', 'Credit']}
            rowMapper={(cb) => [
              cb.entryDate,
              cb.journalNumber,
              cb.accountName,
              cb.description || '-',
              cb.debit > 0 ? formatCurrency(cb.debit) : '-',
              cb.credit > 0 ? formatCurrency(cb.credit) : '-'
            ]}
          />
        } />

        <Route path="ar-aging" element={
          <GenericReportView 
            title="AR Aging Summary"
            endpoint="/api/reports/ar-aging"
            headersMapper={['Customer', 'Invoice #', 'Due Date', 'Balance Due']}
            rowMapper={(ar) => [ar.customerName, ar.invoiceNumber, ar.dueDate, formatCurrency(ar.balanceDue)]}
          />
        } />

        <Route path="ap-aging" element={
          <GenericReportView 
            title="AP Aging Summary"
            endpoint="/api/reports/ap-aging"
            headersMapper={['Vendor', 'Bill #', 'Due Date', 'Balance Due']}
            rowMapper={(ap) => [ap.vendorName, ap.billNumber, ap.dueDate, formatCurrency(ap.balanceDue)]}
          />
        } />

        <Route path="bank-reconciliation-report" element={
          <GenericReportView 
            title="Bank Reconciliation Report"
            endpoint="/api/reports/bank-reconciliation-report"
            headersMapper={['Statement Date', 'Statement Ending Balance', 'Book Ending Balance', 'Status']}
            rowMapper={(br) => [br.statementDate, formatCurrency(br.statementEndingBalance), formatCurrency(br.bookEndingBalance), br.status]}
          />
        } />

        <Route path="department-report" element={
          <GenericReportView 
            title="Department Report"
            endpoint="/api/reports/department-report"
            headersMapper={['Code', 'Department Name', 'Manager', 'Status']}
            rowMapper={(d) => [d.code, d.name, d.managerName || '-', d.status]}
          />
        } />

        <Route path="project-report" element={
          <GenericReportView 
            title="Project Report"
            endpoint="/api/reports/project-report"
            headersMapper={['Code', 'Project Name', 'Budget', 'Status']}
            rowMapper={(p) => [p.code, p.name, p.budgetAmount ? formatCurrency(p.budgetAmount) : '-', p.status]}
          />
        } />

        <Route path="branch-report" element={
          <GenericReportView 
            title="Branch Report"
            endpoint="/api/reports/branch-report"
            headersMapper={['Branch Code', 'Branch Name', 'Address', 'Main Branch']}
            rowMapper={(b) => [b.code, b.name, b.address || '-', b.isMainBranch ? 'Yes' : 'No']}
          />
        } />

        <Route path="audit-trail-report" element={
          <GenericReportView 
            title="Audit Trail Report"
            endpoint="/api/reports/audit-trail-report"
            headersMapper={['Timestamp', 'User Email', 'Action', 'Entity Type', 'Result']}
            rowMapper={(a) => [new Date(a.timestamp).toLocaleString(), a.userEmail || 'System', a.action, a.entityType, a.result]}
          />
        } />
      </Routes>
    </div>
  );
}
