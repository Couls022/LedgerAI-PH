import React, { useState, useEffect } from 'react';
import { 
  Users, Plus, RefreshCw, Calculator, FileCheck, 
  DollarSign, Building2, AlertCircle, CheckCircle2, Search,
  Edit2, Trash2, HelpCircle, ShieldAlert, Sliders, Info, Clock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ExportButton, { ExportData } from '../../components/ExportButton';
import { PaginationControls } from '../../components/PaginationControls';

export default function PayrollCompensation() {
  const { activeCompany } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [payrollResult, setPayrollResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const initialEmployeeForm = {
    employeeCode: `EMP-${Date.now().toString().slice(-4)}`,
    fullName: '',
    tin: '123-456-789-000',
    sssNo: '34-1234567-8',
    philhealthNo: '12-345678901-2',
    pagibigNo: '1234-5678-9012',
    position: 'Accountant',
    department: 'Finance',
    monthlyRate: 20000,
    deductionMode: 'AUTO', // 'AUTO' or 'MANUAL'
    customSssEE: 0,
    customSssER: 0,
    customPhilhealthEE: 0,
    customPhilhealthER: 0,
    customPagibigEE: 0,
    customPagibigER: 0,
    customWithholdingTax: 0,
  };

  const [employeeForm, setEmployeeForm] = useState(initialEmployeeForm);

  const [processParams, setProcessParams] = useState({
    employeeId: '',
    payPeriodStart: new Date().toISOString().slice(0, 8) + '01',
    payPeriodEnd: new Date().toISOString().slice(0, 10),
    paymentDate: new Date().toISOString().slice(0, 10),
    isMonthly: true,
    grossSalary: 20000,
    daysWorked: 11,
    overtimeHours: 0,
    restDayOtHours: 0,
    holidayOtHours: 0,
    nightDiffHours: 0,
    tardinessHours: 0,
    absentDays: 0,
    allowance: 0,
    sssEmployee: 0,
    philhealthEmployee: 0,
    pagibigEmployee: 0,
    withholdingTax: 0,
    isManualOverride: false,
  });

  // Pagination State
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ limit: number; hasNextPage: boolean; nextCursor: string | null; totalCount: number } | null>(null);

  const fetchEmployees = async (cursor?: string | null) => {
    setLoading(true);
    try {
      const activeCurr = cursor !== undefined ? cursor : currentCursor;
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (activeCurr) params.set('cursor', activeCurr);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/operations/payroll/employees?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setEmployees(data);
          setPaginationMeta(null);
        } else {
          setEmployees(data.data || []);
          setPaginationMeta(data.pagination || null);
        }
      }
    } catch (err) {
      console.error('Failed to load employees', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(null);
    fetchEmployees(null);
  }, [activeCompany?.id, searchQuery]);

  const handleNextPage = () => {
    if (paginationMeta?.nextCursor) {
      setCursorStack(prev => [...prev, currentCursor || '']);
      setCurrentCursor(paginationMeta.nextCursor);
      fetchEmployees(paginationMeta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prevStack = [...cursorStack];
      const prevCursor = prevStack.pop() || null;
      setCursorStack(prevStack);
      setCurrentCursor(prevCursor);
      fetchEmployees(prevCursor);
    }
  };

  const openAddEmployee = () => {
    setEditingEmployeeId(null);
    setEmployeeForm({
      ...initialEmployeeForm,
      employeeCode: `EMP-${Date.now().toString().slice(-4)}`,
    });
    setError(null);
    setShowEmployeeModal(true);
  };

  const openEditEmployee = (emp: any) => {
    setEditingEmployeeId(emp.id);
    const sss = (emp.customSssEE || 0) / 100;
    const ph = (emp.customPhilhealthEE || 0) / 100;
    const pag = (emp.customPagibigEE || 0) / 100;
    const tax = (emp.customWithholdingTax || 0) / 100;

    const hasCustom = sss > 0 || ph > 0 || pag > 0 || tax > 0;

    setEmployeeForm({
      employeeCode: emp.employeeNo || '',
      fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      tin: emp.tin || '',
      sssNo: emp.sssNo || '',
      philhealthNo: emp.philhealthNo || '',
      pagibigNo: emp.pagibigNo || '',
      position: emp.position || '',
      department: emp.department || '',
      monthlyRate: (emp.monthlyBasicSalary || 0) / 100,
      deductionMode: hasCustom ? 'MANUAL' : 'AUTO',
      customSssEE: sss,
      customSssER: (emp.customSssER || 0) / 100,
      customPhilhealthEE: ph,
      customPhilhealthER: (emp.customPhilhealthER || 0) / 100,
      customPagibigEE: pag,
      customPagibigER: (emp.customPagibigER || 0) / 100,
      customWithholdingTax: tax,
    });
    setError(null);
    setShowEmployeeModal(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const names = employeeForm.fullName.trim().split(' ');
      const firstName = names[0] || 'Unknown';
      const lastName = names.slice(1).join(' ') || 'Employee';

      const payload = {
        employeeNo: employeeForm.employeeCode,
        firstName,
        lastName,
        tin: employeeForm.tin,
        sssNo: employeeForm.sssNo,
        philhealthNo: employeeForm.philhealthNo,
        pagibigNo: employeeForm.pagibigNo,
        position: employeeForm.position,
        department: employeeForm.department,
        monthlyBasicSalary: employeeForm.monthlyRate,
        customSssEE: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customSssEE : 0,
        customSssER: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customSssER : 0,
        customPhilhealthEE: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customPhilhealthEE : 0,
        customPhilhealthER: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customPhilhealthER : 0,
        customPagibigEE: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customPagibigEE : 0,
        customPagibigER: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customPagibigER : 0,
        customWithholdingTax: employeeForm.deductionMode === 'MANUAL' ? employeeForm.customWithholdingTax : 0,
      };

      const url = editingEmployeeId 
        ? `/api/operations/payroll/employees/${editingEmployeeId}`
        : '/api/operations/payroll/employees';
      const method = editingEmployeeId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setShowEmployeeModal(false);
        fetchEmployees();
      } else {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to save employee profile');
      }
    } catch (err: any) {
      setError(err.message || 'Error saving employee profile');
    }
  };

  const handleDeactivateEmployee = async (empId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to deactivate ${name}?`)) return;
    try {
      const res = await fetch(`/api/operations/payroll/employees/${empId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchEmployees();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to deactivate employee');
      }
    } catch (err: any) {
      alert(err.message || 'Error deactivating employee');
    }
  };

  const handleProcessPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPayrollResult(null);
    try {
      const payload: any = {
        employeeId: processParams.employeeId,
        paymentDate: processParams.paymentDate,
        payPeriodStart: processParams.payPeriodStart,
        payPeriodEnd: processParams.payPeriodEnd,
        isMonthly: processParams.isMonthly,
      };

      if (processParams.employeeId && processParams.employeeId !== 'ALL_BATCH') {
        payload.grossSalary = processParams.grossSalary;
        payload.daysWorked = processParams.daysWorked;
        payload.overtimeHours = processParams.overtimeHours;
        payload.restDayOtHours = processParams.restDayOtHours;
        payload.holidayOtHours = processParams.holidayOtHours;
        payload.nightDiffHours = processParams.nightDiffHours;
        payload.tardinessHours = processParams.tardinessHours;
        payload.absentDays = processParams.absentDays;
        payload.allowance = processParams.allowance;
        if (processParams.isManualOverride) {
          payload.sssEmployee = processParams.sssEmployee;
          payload.philhealthEmployee = processParams.philhealthEmployee;
          payload.pagibigEmployee = processParams.pagibigEmployee;
          payload.withholdingTax = processParams.withholdingTax;
        }
      }

      const res = await fetch('/api/operations/payroll/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setPayrollResult(data);
      } else {
        setError(data.error || data.message || 'Payroll processing failed');
      }
    } catch (err: any) {
      setError(err.message || 'Error processing payroll');
    }
  };

  const safeEmployees = Array.isArray(employees) ? employees : [];
  const filteredEmployees = safeEmployees.filter(e => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const code = (e?.employeeNo || '').toLowerCase();
    const name = ((e?.firstName || '') + ' ' + (e?.lastName || '')).toLowerCase();
    const pos = (e?.position || '').toLowerCase();
    const dept = (e?.department || '').toLowerCase();
    const tin = (e?.tin || '').toLowerCase();
    const sss = (e?.sssNo || '').toLowerCase();
    return code.includes(q) || name.includes(q) || pos.includes(q) || dept.includes(q) || tin.includes(q) || sss.includes(q);
  });

  const exportData: ExportData = {
    filename: `Payroll_Roster_${activeCompany?.legalName || 'Company'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Employee Payroll & Statutory Contributions Roster',
    subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | BIR 1601-C & SSS/PhilHealth/Pag-IBIG`,
    companyName: activeCompany?.legalName || 'Acme Philippine Services Corp.',
    headers: ['Emp Code', 'Full Name', 'TIN', 'SSS No', 'PhilHealth No', 'Pag-IBIG No', 'Monthly Basic Salary', 'Custom SSS EE', 'Custom PhilHealth EE', 'Custom Pag-IBIG EE', 'Custom WTax'],
    rows: safeEmployees.map(e => [
      e?.employeeNo || '-',
      (e?.firstName || '') + ' ' + (e?.lastName || '') || '-',
      e?.tin || '-',
      e?.sssNo || '-',
      e?.philhealthNo || '-',
      e?.pagibigNo || '-',
      `₱${((e?.monthlyBasicSalary || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
      e?.customSssEE ? `₱${(e.customSssEE / 100).toFixed(2)}` : 'Auto (Table)',
      e?.customPhilhealthEE ? `₱${(e.customPhilhealthEE / 100).toFixed(2)}` : 'Auto (Table)',
      e?.customPagibigEE ? `₱${(e.customPagibigEE / 100).toFixed(2)}` : 'Auto (Table)',
      e?.customWithholdingTax ? `₱${(e.customWithholdingTax / 100).toFixed(2)}` : 'Auto (BIR Table)'
    ])
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Payroll & Compensation (1601-C & Statutory Deductions)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Setup monthly basic salary, manual or auto SSS / PhilHealth / Pag-IBIG deductions, BIR 1601-C withholding tax, and auto-posting GL journal entries.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => {
              setShowProcessModal(true);
              setError(null);
              setPayrollResult(null);
              if (safeEmployees.length > 0) {
                const emp = safeEmployees[0];
                const sal = (emp.monthlyBasicSalary || 0) / 100;
                setProcessParams({
                  ...processParams,
                  employeeId: emp.id,
                  grossSalary: sal,
                  sssEmployee: (emp.customSssEE || 0) / 100,
                  philhealthEmployee: (emp.customPhilhealthEE || 0) / 100,
                  pagibigEmployee: (emp.customPagibigEE || 0) / 100,
                  withholdingTax: (emp.customWithholdingTax || 0) / 100,
                  isManualOverride: false,
                });
              }
            }}
            className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Calculator className="w-4 h-4" /> Process Payroll Run
          </button>
          <button
            onClick={openAddEmployee}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Employee
          </button>
        </div>
      </div>

      {/* Info Explanation Card */}
      <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-start gap-3">
        <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-950 dark:text-indigo-200 space-y-1">
          <span className="font-bold block text-sm">💡 How are salaries and deductions computed (SSS, PhilHealth, Pag-IBIG)?</span>
          <p>
            1. <strong>Base Monthly Salary:</strong> The <strong>Monthly Basic Salary</strong> registered in the employee's Profile serves as the <strong>Gross Salary</strong> base.<br/>
            2. <strong>Statutory Deductions (SSS, PhilHealth, Pag-IBIG):</strong> These are the standard actual monthly deductions. They can be set to <strong>Auto-Compute</strong> or <strong>Manual Fixed Monthly Amounts</strong>.<br/>
            3. <strong>BIR Withholding Tax (Form 1601-C):</strong> Under the BIR TRAIN Law, employees earning ₱20,833/month and below (≤ ₱250,000/year) are <strong>Exempt (₱0 Tax)</strong> — therefore, only <strong>SSS, PhilHealth, and Pag-IBIG</strong> are deducted from the salary.<br/>
            4. <strong>Net Take-Home Pay:</strong> Net Salary = Gross Pay &minus; (SSS + PhilHealth + Pag-IBIG + BIR Tax). This is also automatically posted to the General Ledger.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Active Employee Count</span>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-1">
            {safeEmployees.length} {safeEmployees.length === 1 ? 'Employee' : 'Employees'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Est. Monthly Gross Payroll</span>
          <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 font-mono mt-1">
            ₱{safeEmployees.reduce((acc, e) => acc + ((e.monthlyBasicSalary || 0) / 100), 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">BIR 1601-C Tax Status</span>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 text-sm font-sans">
            <CheckCircle2 className="w-4 h-4" /> Ready for Monthly Filing
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search employees by code, name, dept, position, TIN..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {/* Employee List */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Fetching employee roster...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[900px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="py-3.5 px-4">Emp Code</th>
                    <th className="py-3.5 px-4">Employee Name</th>
                    <th className="py-3.5 px-4">Position / Dept</th>
                    <th className="py-3.5 px-4">Identifiers (TIN/SSS/PH/PAG)</th>
                    <th className="py-3.5 px-4 text-right">Monthly Basic Pay</th>
                    <th className="py-3.5 px-4">Statutory Setup</th>
                    <th className="py-3.5 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {filteredEmployees.map((e) => {
                    const sssEE = (e.customSssEE || 0) / 100;
                    const phEE = (e.customPhilhealthEE || 0) / 100;
                    const pagEE = (e.customPagibigEE || 0) / 100;
                    const tax = (e.customWithholdingTax || 0) / 100;
                    const isManual = sssEE > 0 || phEE > 0 || pagEE > 0 || tax > 0;

                    return (
                      <tr key={e.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                          {e.employeeNo}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-100">
                          {e.firstName} {e.lastName}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">
                          {e.position || 'Staff'} ({e.department || 'General'})
                        </td>
                        <td className="py-3.5 px-4 text-[11px] font-mono text-slate-600 dark:text-slate-400 leading-relaxed">
                          TIN: {e.tin || '-'}<br/>
                          SSS: {e.sssNo || '-'}<br/>
                          PH: {e.philhealthNo || '-'} | PAG: {e.pagibigNo || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                          ₱{((e.monthlyBasicSalary || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {isManual ? (
                            <div className="space-y-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                              <span className="font-semibold block uppercase text-[10px] text-amber-800 dark:text-amber-300">⚙️ Manual Deductions Setup</span>
                              <div>SSS: ₱{sssEE.toFixed(2)} | PH: ₱{phEE.toFixed(2)}</div>
                              <div>PAG: ₱{pagEE.toFixed(2)} | WTax: ₱{tax.toFixed(2)}</div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> Standard BIR / Statutory Auto
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => openEditEmployee(e)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 rounded-lg transition-colors"
                              title="Edit Employee & Setup Statutory Deductions"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeactivateEmployee(e.id, `${e.firstName} ${e.lastName}`)}
                              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                              title="Deactivate Employee"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        No matching employees found in roster.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalCount={paginationMeta?.totalCount}
              itemCount={filteredEmployees.length}
              pageIndex={cursorStack.length}
              hasNextPage={!!paginationMeta?.hasNextPage}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
              loading={loading}
            />
          </>
        )}
      </div>

      {/* Add / Edit Employee Modal */}
      {showEmployeeModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-xl w-full p-6 space-y-4 my-8">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              {editingEmployeeId ? 'Edit Employee & Statutory Setup' : 'Register New Employee'}
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs font-semibold">{error}</div>}

            <form onSubmit={handleSaveEmployee} className="space-y-4">
              {/* Basic Info Section */}
              <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                  1. Basic Profile & Compensation
                </span>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Juan dela Cruz"
                    value={employeeForm.fullName}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, fullName: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Emp Code *</label>
                    <input
                      type="text"
                      required
                      value={employeeForm.employeeCode}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, employeeCode: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Monthly Basic Salary (PHP) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={employeeForm.monthlyRate}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, monthlyRate: parseFloat(e.target.value) || 0 })}
                      className="w-full text-xs p-2.5 border border-indigo-300 dark:border-indigo-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono font-bold text-indigo-600 dark:text-indigo-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Position</label>
                    <input
                      type="text"
                      value={employeeForm.position}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, position: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Department</label>
                    <input
                      type="text"
                      value={employeeForm.department}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Statutory Numbers Section */}
              <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                  2. Government ID Numbers (TIN, SSS, PH, PAG)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">TIN</label>
                    <input
                      type="text"
                      value={employeeForm.tin}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, tin: e.target.value })}
                      className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">SSS Number</label>
                    <input
                      type="text"
                      value={employeeForm.sssNo}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, sssNo: e.target.value })}
                      className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">PhilHealth Number</label>
                    <input
                      type="text"
                      value={employeeForm.philhealthNo}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, philhealthNo: e.target.value })}
                      className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Pag-IBIG Number</label>
                    <input
                      type="text"
                      value={employeeForm.pagibigNo}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, pagibigNo: e.target.value })}
                      className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Monthly Statutory Deductions Setup Section */}
              <div className="bg-amber-50/60 dark:bg-amber-950/30 p-4 rounded-xl border border-amber-200 dark:border-amber-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-amber-600" />
                    3. Monthly Statutory Deductions Setup (SSS, Pag-IBIG, PhilHealth)
                  </span>
                </div>

                <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800 text-xs">
                  <label className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="deductionMode"
                      value="AUTO"
                      checked={employeeForm.deductionMode === 'AUTO'}
                      onChange={() => setEmployeeForm({ ...employeeForm, deductionMode: 'AUTO' })}
                      className="text-indigo-600"
                    />
                    Auto-Compute (BIR / Statutory Tables)
                  </label>
                  <label className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 cursor-pointer">
                    <input
                      type="radio"
                      name="deductionMode"
                      value="MANUAL"
                      checked={employeeForm.deductionMode === 'MANUAL'}
                      onChange={() => setEmployeeForm({ ...employeeForm, deductionMode: 'MANUAL' })}
                      className="text-amber-600"
                    />
                    Manual Fixed Monthly Deductions
                  </label>
                </div>

                {employeeForm.deductionMode === 'MANUAL' && (
                  <div className="space-y-3 pt-1">
                    <p className="text-[11px] text-amber-800 dark:text-amber-300">
                      💡 You can set the exact amount of SSS, PhilHealth, Pag-IBIG, and BIR Withholding Tax to be deducted monthly for this employee here:
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          SSS EE (Employee Share, ₱/mo)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={employeeForm.customSssEE}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, customSssEE: parseFloat(e.target.value) || 0 })}
                          className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          PhilHealth EE (Employee Share, ₱/mo)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={employeeForm.customPhilhealthEE}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, customPhilhealthEE: parseFloat(e.target.value) || 0 })}
                          className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Pag-IBIG EE (Employee Share, ₱/mo)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={employeeForm.customPagibigEE}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, customPagibigEE: parseFloat(e.target.value) || 0 })}
                          className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            BIR Withholding Tax (Form 1601-C, ₱/mo)
                          </label>
                          <span className="text-[9px] bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                            Auto-computed via BIR Tax Engine
                          </span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled
                          value={
                            employeeForm.monthlyRate <= 20833 ? 0 : 
                            employeeForm.monthlyRate <= 33333 ? (employeeForm.monthlyRate - 20833) * 0.15 :
                            employeeForm.monthlyRate <= 66667 ? 1875 + ((employeeForm.monthlyRate - 33333) * 0.20) :
                            employeeForm.monthlyRate <= 166667 ? 8541.80 + ((employeeForm.monthlyRate - 66667) * 0.25) :
                            employeeForm.monthlyRate <= 666667 ? 33541.80 + ((employeeForm.monthlyRate - 166667) * 0.30) :
                            183541.80 + ((employeeForm.monthlyRate - 666667) * 0.35)
                          }
                          className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-500 cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmployeeModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  {editingEmployeeId ? 'Update Profile & Deductions' : 'Save Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Process Payroll Modal */}
      {showProcessModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-4 my-8">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-600" /> Process Payroll Run & Post GL
            </h3>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs font-semibold">{error}</div>}

            <form onSubmit={handleProcessPayroll} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Select Employee / Batch</label>
                <select
                  required
                  value={processParams.employeeId}
                  onChange={(e) => {
                    const empId = e.target.value;
                    if (empId === 'ALL_BATCH') {
                      setProcessParams({
                        ...processParams,
                        employeeId: 'ALL_BATCH',
                        isManualOverride: false,
                      });
                    } else {
                      const emp = safeEmployees.find(x => x.id === empId);
                      const sal = (emp?.monthlyBasicSalary || 0) / 100 || 20000;
                      setProcessParams({
                        ...processParams,
                        employeeId: empId,
                        grossSalary: sal,
                        sssEmployee: (emp?.customSssEE || 0) / 100,
                        philhealthEmployee: (emp?.customPhilhealthEE || 0) / 100,
                        pagibigEmployee: (emp?.customPagibigEE || 0) / 100,
                        withholdingTax: (emp?.customWithholdingTax || 0) / 100,
                        isManualOverride: false,
                      });
                    }
                  }}
                  className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-semibold"
                >
                  <option value="">-- Select employee --</option>
                  {safeEmployees.map(e => (
                    <option key={e.id} value={e.id}>{e.employeeNo} - {e.firstName} {e.lastName} (₱{((e.monthlyBasicSalary || 0) / 100).toLocaleString()}/mo)</option>
                  ))}
                  <option value="ALL_BATCH">All Active Employees ({safeEmployees.length} {safeEmployees.length === 1 ? 'Employee' : 'Employees'})</option>
                </select>
              </div>

              {processParams.employeeId && processParams.employeeId !== 'ALL_BATCH' && (() => {
                const selectedEmp = safeEmployees.find(x => x.id === processParams.employeeId);
                const monthlySalary = (selectedEmp?.monthlyBasicSalary || 0) / 100;
                const dailyRate = selectedEmp?.dailyRate ? selectedEmp.dailyRate / 100 : Math.round((monthlySalary / 22) * 100) / 100;
                const hourlyRate = selectedEmp?.hourlyRate ? selectedEmp.hourlyRate / 100 : Math.round((dailyRate / 8) * 100) / 100;

                // Live computation preview
                const daysWorked = Number(processParams.daysWorked || 0);
                const regOtHrs = Number(processParams.overtimeHours || 0);
                const restOtHrs = Number(processParams.restDayOtHours || 0);
                const holOtHrs = Number(processParams.holidayOtHours || 0);
                const nightDiffHrs = Number(processParams.nightDiffHours || 0);
                const lateHrs = Number(processParams.tardinessHours || 0);
                const absentDays = Number(processParams.absentDays || 0);
                const allowance = Number(processParams.allowance || 0);

                const basicEarned = processParams.isMonthly ? monthlySalary : (daysWorked > 0 ? daysWorked * dailyRate : monthlySalary / 2);
                const regOtPay = regOtHrs * hourlyRate * 1.25;
                const restOtPay = restOtHrs * hourlyRate * 1.30;
                const holOtPay = holOtHrs * hourlyRate * 2.00;
                const totalOtPay = regOtPay + restOtPay + holOtPay;
                const nightDiffPay = nightDiffHrs * hourlyRate * 0.10;
                const tardinessDeduction = (lateHrs * hourlyRate) + (absentDays * dailyRate);

                const computedGross = basicEarned + totalOtPay + nightDiffPay - tardinessDeduction + allowance;

                return (
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
                    {/* Time & Attendance Calculator */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-indigo-600" /> Time & Attendance / Oras ng Pinasok
                        </span>
                        <div className="text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-400">
                          Rate: ₱{dailyRate.toFixed(2)}/day | ₱{hourlyRate.toFixed(2)}/hr
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Days Worked
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="31"
                            step="0.5"
                            value={processParams.daysWorked}
                            onChange={(e) => setProcessParams({ ...processParams, daysWorked: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Regular OT Hours (125%)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={processParams.overtimeHours}
                            onChange={(e) => setProcessParams({ ...processParams, overtimeHours: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold text-emerald-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Rest Day / Special OT (130%)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={processParams.restDayOtHours}
                            onChange={(e) => setProcessParams({ ...processParams, restDayOtHours: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold text-emerald-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Regular Holiday OT (200%)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={processParams.holidayOtHours}
                            onChange={(e) => setProcessParams({ ...processParams, holidayOtHours: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold text-emerald-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Night Diff Hours (10 PM-6 AM)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={processParams.nightDiffHours}
                            onChange={(e) => setProcessParams({ ...processParams, nightDiffHours: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Tardiness / Late Hours
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={processParams.tardinessHours}
                            onChange={(e) => setProcessParams({ ...processParams, tardinessHours: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold text-red-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Absent Days
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={processParams.absentDays}
                            onChange={(e) => setProcessParams({ ...processParams, absentDays: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold text-red-500"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Allowance / De Minimis (PHP)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={processParams.allowance}
                            onChange={(e) => setProcessParams({ ...processParams, allowance: parseFloat(e.target.value) || 0 })}
                            className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                          />
                        </div>
                      </div>

                      {/* Gross Earned Calculation Box */}
                      <div className="bg-indigo-50/80 dark:bg-indigo-950/50 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs space-y-1">
                        <div className="font-bold text-indigo-950 dark:text-indigo-200 flex justify-between">
                          <span>1. Total Gross Salary:</span>
                          <span className="text-sm text-indigo-700 dark:text-indigo-300 font-mono font-bold">
                            ₱{computedGross.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80 grid grid-cols-2 gap-1 font-mono">
                          <div>Basic Pay: ₱{basicEarned.toFixed(2)}</div>
                          <div>Total OT Pay: ₱{totalOtPay.toFixed(2)}</div>
                          <div>Night Diff: ₱{nightDiffPay.toFixed(2)}</div>
                          <div>Absences/Late: -₱{tardinessDeduction.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Isolated Statutory Deductions Panel */}
                    <div className="bg-amber-50/70 dark:bg-amber-950/40 p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-950 dark:text-amber-200 uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders className="w-4 h-4 text-amber-600" />
                          2. Mandatory Employee Deductions (Deducted from Gross Pay)
                        </span>
                        <button
                          type="button"
                          onClick={() => setProcessParams({ ...processParams, isManualOverride: !processParams.isManualOverride })}
                          className="text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline bg-white dark:bg-slate-900 px-2 py-1 rounded border border-amber-300 dark:border-amber-700"
                        >
                          {processParams.isManualOverride ? '🔄 Reset to Table Defaults' : '✏️ Manual Entry / Adjust Amounts'}
                        </button>
                      </div>

                      {processParams.isManualOverride ? (
                        <div className="grid grid-cols-2 gap-2.5 bg-white dark:bg-slate-900 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              SSS EE (Employee Share, ₱)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={processParams.sssEmployee}
                              onChange={(e) => setProcessParams({ ...processParams, sssEmployee: parseFloat(e.target.value) || 0 })}
                              className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              PhilHealth EE (Employee Share, ₱)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={processParams.philhealthEmployee}
                              onChange={(e) => setProcessParams({ ...processParams, philhealthEmployee: parseFloat(e.target.value) || 0 })}
                              className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              Pag-IBIG EE (Employee Share, ₱)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={processParams.pagibigEmployee}
                              onChange={(e) => setProcessParams({ ...processParams, pagibigEmployee: parseFloat(e.target.value) || 0 })}
                              className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              BIR Withholding Tax (Form 1601-C, ₱)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={processParams.withholdingTax}
                              onChange={(e) => setProcessParams({ ...processParams, withholdingTax: parseFloat(e.target.value) || 0 })}
                              className="w-full text-xs p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 font-mono font-bold text-red-600 dark:text-red-400"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-amber-200 dark:border-amber-800 text-xs space-y-1.5">
                          <div className="grid grid-cols-2 gap-2 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                            <div>SSS Employee Share: <span className="font-bold">₱{(processParams.sssEmployee || selectedEmp?.customSssEE ? (selectedEmp?.customSssEE || 0) / 100 : Math.min(1350, Math.max(180, computedGross * 0.045))).toFixed(2)}</span></div>
                            <div>PhilHealth EE Share: <span className="font-bold">₱{(processParams.philhealthEmployee || selectedEmp?.customPhilhealthEE ? (selectedEmp?.customPhilhealthEE || 0) / 100 : Math.min(2500, Math.max(500, computedGross * 0.05) / 2)).toFixed(2)}</span></div>
                            <div>Pag-IBIG EE Share: <span className="font-bold">₱{(processParams.pagibigEmployee || selectedEmp?.customPagibigEE ? (selectedEmp?.customPagibigEE || 0) / 100 : Math.min(200, Math.max(100, computedGross * 0.02))).toFixed(2)}</span></div>
                            <div>BIR Withholding Tax: <span className="font-bold text-red-600">
                              {computedGross <= 20833 ? '₱0.00 (EXEMPT)' : '₱' + (
                                computedGross <= 33333 ? (computedGross - 20833) * 0.15 :
                                computedGross <= 66667 ? 1875 + ((computedGross - 33333) * 0.20) :
                                computedGross <= 166667 ? 8541.80 + ((computedGross - 66667) * 0.25) :
                                computedGross <= 666667 ? 33541.80 + ((computedGross - 166667) * 0.30) :
                                183541.80 + ((computedGross - 666667) * 0.35)
                              ).toFixed(2)}
                            </span></div>
                          </div>
                          <p className="text-[10px] text-amber-800 dark:text-amber-300 pt-1 border-t border-slate-100 dark:border-slate-800">
                            ℹ️ Only these amounts will be deducted from the employee's Gross Pay monthly according to company policy and BIR regulations.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Isolated Employer Contributions Panel (Company Liability) */}
                    <div className="bg-slate-100/80 dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                      <div className="font-bold text-slate-800 dark:text-slate-200 flex justify-between items-center text-[11px]">
                        <span>🏢 Employer Statutory Share (Company Counterpart):</span>
                        <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-mono">
                          NOT deducted from salary
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 font-mono text-[10px] text-slate-600 dark:text-slate-400">
                        <div>SSS ER + EC: ₱{(Math.min(2850, Math.max(380, computedGross * 0.095)) + (computedGross > 14500 ? 30 : 10)).toFixed(2)}</div>
                        <div>PhilHealth ER: ₱{Math.min(2500, Math.max(500, computedGross * 0.05) / 2).toFixed(2)}</div>
                        <div>Pag-IBIG ER: ₱{Math.min(200, Math.max(100, computedGross * 0.02)).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {payrollResult && (
                <div className="bg-emerald-50 dark:bg-emerald-950/60 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs space-y-2">
                  <div className="font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Payroll Run Calculated & Posted to General Ledger!
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-700 dark:text-slate-300 font-mono">
                    <div>Gross Salary: ₱{((payrollResult.totalGross || payrollResult.grossSalary || processParams.grossSalary * 100) / 100).toFixed(2)}</div>
                    <div>SSS Employee: ₱{((payrollResult.totalSss || payrollResult.sssEmployee || 0) / 100).toFixed(2)}</div>
                    <div>PhilHealth EE: ₱{((payrollResult.totalPh || payrollResult.philhealthEmployee || 0) / 100).toFixed(2)}</div>
                    <div>Pag-IBIG EE: ₱{((payrollResult.totalPagibig || payrollResult.pagibigEmployee || 0) / 100).toFixed(2)}</div>
                    <div>BIR 1601-C Tax: ₱{((payrollResult.totalTax || payrollResult.withholdingTax || 0) / 100).toFixed(2)}</div>
                    <div className="font-bold text-emerald-700 dark:text-emerald-300 text-sm">
                      Net Pay: ₱{((payrollResult.totalNet || payrollResult.netSalary || 0) / 100).toFixed(2)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProcessModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-sm"
                >
                  Calculate & Post Payroll
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
