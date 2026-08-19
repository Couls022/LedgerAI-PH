/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Activity, 
  BarChart3, 
  BookOpen, 
  Briefcase, 
  Calendar,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  FolderOpen,
  Home,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  TrendingDown,
  Search,
  Plus,
  Filter,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock
} from 'lucide-react';

export default function App() {
  const [dateRange, setDateRange] = useState('This Month');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [activityFilter, setActivityFilter] = useState('All');
  
  const [activities, setActivities] = useState([
    { id: 1, type: 'journal', title: 'Journal Posted', time: '12:44', desc: 'JV-2023-0102 posted by Accountant', color: 'indigo-600' },
    { id: 2, type: 'alert', title: 'Compliance Alert', time: '12:38', desc: 'Missing TIN for Vendor A in AP-002', color: 'rose-500' },
    { id: 3, type: 'success', title: 'Invoice Paid', time: '12:15', desc: 'Payment received for INV-2023-144', color: 'emerald-600' },
    { id: 4, type: 'system', title: 'Tax Engine', time: '11:59', desc: 'Q3 VAT computation completed', color: 'slate-400' },
  ]);

  const filteredActivities = activityFilter === 'All' ? activities : activities.filter(a => a.type === activityFilter.toLowerCase());

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F1F5F9] font-sans antialiased text-slate-800">
      {/* Sidebar */}
      <aside className={`bg-[#0F172A] flex flex-col shrink-0 transition-all duration-300 ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
              <div className="w-4 h-4 bg-white rounded-sm"></div>
            </div>
            {!isSidebarCollapsed && <span className="text-white font-bold text-xl tracking-tight whitespace-nowrap">LedgerAI PH</span>}
          </div>
          <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        </div>
        
        <nav className="mt-6 px-4 space-y-1 flex-1 overflow-y-auto">
          <div 
            onClick={() => setActiveView('dashboard')}
            className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors cursor-pointer overflow-hidden ${activeView === 'dashboard' ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800'}`} 
            title="Dashboard"
          >
            <Home className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Dashboard</span>}
          </div>
          
          <div className="flex items-center justify-between text-slate-400 px-4 py-3 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer mt-4 overflow-hidden" title="Accounting">
            <div className="flex items-center space-x-3">
              <BookOpen className="w-4 h-4 shrink-0" />
              {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Accounting</span>}
            </div>
            {!isSidebarCollapsed && <ChevronRight className="w-4 h-4 shrink-0" />}
          </div>

          <div className="flex flex-col mt-4">
            <div 
              onClick={() => setActiveView('tax')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors cursor-pointer overflow-hidden ${activeView === 'tax' ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800'}`}
              title="Tax & Compliance"
            >
              <FileText className="w-4 h-4 shrink-0" />
              {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Tax & Compliance</span>}
            </div>
            {!isSidebarCollapsed && (
              <div className="mx-4 mt-1 mb-2 px-3 py-2 bg-indigo-900/30 rounded-lg border border-indigo-500/20">
                <p className="text-[10px] text-indigo-300 font-semibold uppercase tracking-wider mb-0.5">Active BIR Rule</p>
                <p className="text-xs text-indigo-100 font-medium truncate">RR 11-2018 (v2.1)</p>
                <p className="text-[10px] text-indigo-400 mt-0.5">Effective: Jan 1, 2018</p>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-3 text-slate-400 px-4 py-3 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer overflow-hidden" title="Documents">
            <FolderOpen className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Documents</span>}
          </div>

          <div className="flex items-center justify-between text-slate-400 px-4 py-3 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer mt-4 overflow-hidden" title="Reports">
            <div className="flex items-center space-x-3">
              <BarChart3 className="w-4 h-4 shrink-0" />
              {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Reports</span>}
            </div>
            {!isSidebarCollapsed && <ChevronRight className="w-4 h-4 shrink-0" />}
          </div>

          <div className="flex items-center space-x-3 text-slate-400 px-4 py-3 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer mt-4 overflow-hidden" title="Audit Log">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Audit Log</span>}
          </div>

          <div className="flex items-center space-x-3 text-slate-400 px-4 py-3 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer overflow-hidden" title="Settings">
            <Settings className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">Settings</span>}
          </div>
        </nav>

        <div className="p-6 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="w-10 h-10 rounded-full bg-slate-700 flex-shrink-0 border border-slate-600 flex items-center justify-center text-slate-300 font-bold shrink-0">
                JD
              </div>
              {!isSidebarCollapsed && (
                <div className="overflow-hidden">
                  <p className="text-white text-sm font-medium truncate">John Doe</p>
                  <p className="text-slate-500 text-xs truncate">Super Admin</p>
                </div>
              )}
            </div>
            {!isSidebarCollapsed && <LogOut className="w-4 h-4 text-slate-500 hover:text-white cursor-pointer transition-colors shrink-0" />}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center space-x-6 flex-1">
            <div className="flex items-center space-x-4 shrink-0">
              <Briefcase className="w-4 h-4 text-slate-400" />
              <span className="text-slate-400 text-sm hidden sm:inline">Acme Corp</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="text-slate-800 text-sm font-semibold">{activeView === 'tax' ? 'Tax & Compliance' : 'Dashboard Overview'}</span>
            </div>
            
            {/* Global Search Bar */}
            <div className="flex-1 max-w-md hidden md:flex items-center relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3" />
              <input 
                type="text" 
                placeholder="Search transactions, vendors, logs..." 
                className="w-full pl-9 pr-4 py-1.5 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-4 shrink-0">
            {/* New Transaction Button */}
            <button 
              onClick={() => setIsTransactionModalOpen(true)}
              className="hidden lg:flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New Entry</span>
            </button>
            {/* Date Range Picker */}
            <div className="relative">
              <button 
                onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                className="flex items-center space-x-2 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg text-sm text-slate-600 transition-colors shadow-sm"
              >
                <Calendar className="w-4 h-4 text-slate-400" />
                <span className="font-medium">{dateRange}</span>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>
              
              {isDatePickerOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                  {['Today', 'Last 7 Days', 'Last 30 Days', 'This Month', 'This Quarter', 'This Year'].map((range) => (
                    <button
                      key={range}
                      onClick={() => {
                        setDateRange(range);
                        setIsDatePickerOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${
                        dateRange === range ? 'text-indigo-600 font-semibold bg-indigo-50/50' : 'text-slate-600'
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                  <div className="border-t border-slate-100 my-1"></div>
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    onClick={() => setIsDatePickerOpen(false)}
                  >
                    Custom Range...
                  </button>
                </div>
              )}
            </div>
            
            {/* Export Button */}
            <button className="hidden sm:flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-sm">
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>

            <div className="relative">
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white"></div>
              <Activity className="w-5 h-5 text-slate-400" />
            </div>
            <div className="bg-slate-100 rounded-full px-4 py-1.5 flex items-center space-x-2 border border-slate-200 shadow-sm">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">System Online</span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-8 flex-1 overflow-y-auto flex flex-col gap-6">
          {activeView === 'dashboard' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer">
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Cash Balance</p>
                  <p className="text-2xl font-bold text-slate-900">₱1,245,000</p>
                  <div className="mt-4 flex items-center text-emerald-600 text-xs font-bold">
                    <TrendingUp className="w-4 h-4 mr-1" /> 12.5% vs last month
                  </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer">
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Accounts Receivable</p>
                  <p className="text-2xl font-bold text-slate-900">₱450,200</p>
                  <div className="mt-4 flex items-center text-emerald-600 text-xs font-bold">
                    <TrendingDown className="w-4 h-4 mr-1" /> 5.2% vs last month
                  </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer">
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Accounts Payable</p>
                  <p className="text-2xl font-bold text-slate-900">₱215,800</p>
                  <div className="mt-4 flex items-center text-rose-500 text-xs font-bold">
                    <TrendingUp className="w-4 h-4 mr-1" /> 8.4% vs last month
                  </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer">
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Compliance Status</p>
                  <p className="text-2xl font-bold text-slate-900">CLEAR</p>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center text-emerald-600 text-xs font-bold">
                      <TrendingUp className="w-4 h-4 mr-1" /> 2.1% improvement
                    </div>
                    <span className="text-slate-400 text-xs">2h ago</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
                {/* Cash Flow Empty State */}
                <div className="col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-slate-800 text-lg">Cash Flow Trend</h3>
                    <div className="flex space-x-2">
                      <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg cursor-pointer hover:bg-slate-200 transition">30 Days</span>
                      <span className="px-3 py-1 text-slate-400 text-xs font-bold rounded-lg cursor-pointer hover:text-slate-600 transition">YTD</span>
                    </div>
                  </div>
                  <div className="flex-1 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center p-6 text-center min-h-[250px]">
                    <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-3">
                      <BarChart3 className="w-6 h-6 text-slate-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-600 mb-1">No Data Available</p>
                    <p className="text-xs text-slate-400">Cash flow visualization will generate once transactions are recorded in the current period.</p>
                  </div>
                </div>
                
                {/* Recent Activities */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 text-lg">Recent Activities</h3>
                    <div className="relative">
                      <button className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                        <Filter className="w-4 h-4" />
                      </button>
                      <select 
                        value={activityFilter}
                        onChange={(e) => setActivityFilter(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      >
                        <option value="All">All Types</option>
                        <option value="Journal">Journal</option>
                        <option value="Alert">Alert</option>
                        <option value="Success">Success</option>
                        <option value="System">System</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto flex flex-col p-2">
                    {filteredActivities.length > 0 ? (
                      filteredActivities.map((activity) => (
                        <div key={activity.id} className="p-4 hover:bg-slate-50 rounded-xl border border-transparent hover:border-slate-100 transition-all cursor-pointer">
                          <div className="flex justify-between mb-1">
                            <span className={`text-xs font-bold text-${activity.color} uppercase tracking-tighter`}>{activity.title}</span>
                            <span className="text-xs text-slate-400">{activity.time}</span>
                          </div>
                          <p className="text-sm text-slate-700 leading-tight">{activity.desc}</p>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-8">
                        <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
                          <Activity className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm font-semibold text-slate-600 mb-1">No Activities Match</p>
                        <p className="text-xs text-slate-400">Try changing the filter to see more results.</p>
                      </div>
                    )}
                  </div>
                  <div className="p-4 mt-auto border-t border-slate-100">
                    <button className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-lg shadow-slate-200 transition-colors">
                      View Full Audit Log
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Tax & Compliance View */
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-indigo-900/5">
                  <h3 className="font-bold text-slate-800 text-lg">BIR Compliance Overview</h3>
                  <p className="text-xs text-slate-500 mt-1">Upcoming tax filing deadlines and compliance checks.</p>
                </div>
                <div className="flex-1 p-6 flex flex-col gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 flex items-start space-x-4">
                    <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-5 h-5 text-rose-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-bold text-slate-800 text-sm">2550Q - Quarterly Value-Added Tax</h4>
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold uppercase rounded-md tracking-wider">Due Soon</span>
                      </div>
                      <p className="text-xs text-slate-500 mb-2">Q3 2026 Filing</p>
                      <div className="flex items-center text-[10px] font-medium text-slate-400">
                        <Clock className="w-3 h-3 mr-1" /> Deadline: Oct 25, 2026
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-xl border border-slate-200 flex items-start space-x-4">
                    <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-bold text-slate-800 text-sm">1601-EQ - Creditable Withholding Tax</h4>
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase rounded-md tracking-wider">Pending</span>
                      </div>
                      <p className="text-xs text-slate-500 mb-2">Q3 2026 Filing</p>
                      <div className="flex items-center text-[10px] font-medium text-slate-400">
                        <Clock className="w-3 h-3 mr-1" /> Deadline: Oct 31, 2026
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 opacity-60 flex items-start space-x-4 bg-slate-50">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-bold text-slate-800 text-sm line-through">0619-E - Expanded Withholding Tax</h4>
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase rounded-md tracking-wider">Filed</span>
                      </div>
                      <p className="text-xs text-slate-500 mb-2">September 2026</p>
                      <div className="flex items-center text-[10px] font-medium text-slate-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Filed on: Oct 10, 2026
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Reports Placeholder */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800 text-lg">Tax Reporting Engine</h3>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-50/50">
                  <div className="w-16 h-16 bg-white border border-slate-200 rounded-2xl shadow-sm flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-sm font-semibold text-slate-600 mb-2">No Reports Generated</p>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    The deterministic tax reporting engine requires recorded transactions and finalized tax mappings to produce valid BIR forms.
                  </p>
                  <button className="mt-6 px-4 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-sm font-medium rounded-lg shadow-sm transition-colors">
                    Configure Tax Mappings
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Overlay */}
        {isTransactionModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 text-lg">New Transaction</h3>
                <button 
                  onClick={() => setIsTransactionModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Type</label>
                  <select className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none">
                    <option>General Journal Entry</option>
                    <option>Sales Invoice</option>
                    <option>Purchase / Expense</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Reference No.</label>
                  <input type="text" placeholder="e.g. JV-2026-001" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Description</label>
                  <textarea rows={3} placeholder="Transaction details..." className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"></textarea>
                </div>
                <div className="pt-2">
                  <button className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 transition-all">
                    Continue to Line Items
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
