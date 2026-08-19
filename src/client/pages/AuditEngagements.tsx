import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, Plus, Search, Calendar, Users, FileText, CheckCircle2, 
  Clock, AlertCircle, Archive, ArrowRight, RefreshCw, Layers, DollarSign, Edit3, Check, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ExportButton, { ExportData } from '../components/ExportButton';
import AuditChatPanel from '../components/ai/AuditChatPanel';
import { Sparkles } from 'lucide-react';
import AuditPlanning from './AuditPlanning';
import AuditWorkpapersView from '../components/audit/AuditWorkpapersView';
import AuditFindingsAndAdjustmentsView from '../components/audit/AuditFindingsAndAdjustmentsView';
import InternalControlsView from '../components/audit/InternalControlsView';
import FraudDetectionView from '../components/audit/FraudDetectionView';
import DocumentVaultView from '../components/audit/DocumentVaultView';
import BackupRestoreView from '../components/audit/BackupRestoreView';

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((val || 0) / 100);
};

export default function AuditEngagements() {
  const { activeCompany, user } = useAuth();
  const [engagements, setEngagements] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  // Selected engagement detail state
  const [selectedEngagement, setSelectedEngagement] = useState<any>(null);
  const [engagementDetails, setEngagementDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [isPlanningOpen, setIsPlanningOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'planning' | 'workpapers' | 'findings' | 'controls' | 'fraud' | 'vault' | 'backup'>('overview');
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);

  // New Engagement Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    clientCompanyId: '',
    engagementName: '',
    auditPeriod: 'FY 2025',
    engagementType: 'STATUTORY_AUDIT',
    materiality: '50000000', // 500k PHP in centavos
    performanceMateriality: '37500000', // 375k PHP
    trivialThreshold: '2500000', // 25k PHP
    fieldworkDeadline: '',
    signOffDeadline: '',
    reportDeadline: '',
    notes: ''
  });

  // New Item Form in detail view
  const [newItemForm, setNewItemForm] = useState({ itemCategory: 'PBC', title: '', description: '', dueDate: '' });
  const [isAddingItem, setIsAddingItem] = useState(false);

  const fetchEngagements = async () => {
    try {
      setLoading(true);
      const [engRes, compRes, userRes] = await Promise.all([
        fetch('/api/audit-engagements').then(r => r.json()),
        fetch('/api/companies').then(r => r.json()),
        fetch('/api/users').then(r => r.json()).catch(() => [])
      ]);
      setEngagements(Array.isArray(engRes) ? engRes : []);
      setCompanies(Array.isArray(compRes) ? compRes : (compRes.companies || []));
      setUsersList(Array.isArray(userRes) ? userRes : []);
    } catch (err) {
      console.error('Failed to load audit engagements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEngagements();
  }, []);

  const fetchEngagementDetails = async (id: string) => {
    try {
      setLoadingDetails(true);
      const res = await fetch(`/api/audit-engagements/${id}`);
      const data = await res.json();
      if (res.ok) {
        setEngagementDetails(data);
      }
    } catch (err) {
      console.error('Failed to load engagement details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSelectEngagement = (eng: any) => {
    setSelectedEngagement(eng);
    fetchEngagementDetails(eng.id);
  };

  const handleCreateEngagement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/audit-engagements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm)
      });
      const data = await res.json();
      if (res.ok) {
        setIsCreateOpen(false);
        setNewForm({
          clientCompanyId: '',
          engagementName: '',
          auditPeriod: 'FY 2025',
          engagementType: 'STATUTORY_AUDIT',
          materiality: '50000000',
          performanceMateriality: '37500000',
          trivialThreshold: '2500000',
          fieldworkDeadline: '',
          signOffDeadline: '',
          reportDeadline: '',
          notes: ''
        });
        fetchEngagements();
      } else {
        alert(data.error || 'Failed to create engagement');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating engagement');
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEngagement || !newItemForm.title) return;
    try {
      const res = await fetch(`/api/audit-engagements/${selectedEngagement.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItemForm)
      });
      if (res.ok) {
        setNewItemForm({ itemCategory: 'PBC', title: '', description: '', dueDate: '' });
        setIsAddingItem(false);
        fetchEngagementDetails(selectedEngagement.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateItemStatus = async (itemId: string, status: string) => {
    try {
      const res = await fetch(`/api/audit-engagements/items/${itemId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok && selectedEngagement) {
        fetchEngagementDetails(selectedEngagement.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedEngagement) return;
    try {
      const res = await fetch(`/api/audit-engagements/${selectedEngagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedEngagement,
          status: newStatus
        })
      });
      if (res.ok) {
        fetchEngagements();
        fetchEngagementDetails(selectedEngagement.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('Are you sure you want to archive this engagement?')) return;
    try {
      const res = await fetch(`/api/audit-engagements/${id}/archive`, { method: 'POST' });
      if (res.ok) {
        fetchEngagements();
        if (selectedEngagement?.id === id) {
          setSelectedEngagement(null);
          setEngagementDetails(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredEngagements = engagements.filter(e => {
    const matchesSearch = (e.engagementName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (e.clientCompanyName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (e.auditPeriod || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalActive = engagements.filter(e => e.status !== 'ARCHIVED' && e.status !== 'COMPLETED').length;
  const totalCompleted = engagements.filter(e => e.status === 'COMPLETED').length;
  const totalArchived = engagements.filter(e => e.status === 'ARCHIVED').length;

  const exportData: ExportData = {
    filename: `Audit_Engagements_${activeCompany?.legalName || 'Firm'}_${new Date().toISOString().slice(0, 10)}`,
    title: 'Audit Engagements Portfolio Report',
    subtitle: `Managing Firm: ${activeCompany?.legalName || 'Active Workspace'} | Freelance Audit Work`,
    companyName: activeCompany?.legalName || 'Audit Firm',
    headers: ['Engagement Name', 'Client Company', 'Audit Period', 'Type', 'Status', 'Materiality (PHP)', 'Fieldwork Deadline'],
    rows: engagements.map(e => [
      e.engagementName,
      e.clientCompanyName || 'N/A',
      e.auditPeriod,
      e.engagementType,
      e.status,
      (e.materiality / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 }),
      e.fieldworkDeadline || 'None'
    ]),
    orientation: 'landscape'
  };

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" /> Audit Engagement Management
          </h2>
          <p className="text-slate-500 text-xs mt-1">Manage freelance audit engagements, materiality thresholds, PBC open items, and sign-offs.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAiChatOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Sparkles className="w-4 h-4" /> Ask Ledger AI
          </button>
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" /> New Engagement
          </button>
        </div>
      </div>

      <AuditChatPanel isOpen={isAiChatOpen} onClose={() => setIsAiChatOpen(false)} />

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase">Active Engagements</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{totalActive}</p>
          <p className="text-xs text-emerald-600 mt-1 font-medium">In planning, fieldwork, or review</p>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase">Completed / Signed-Off</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{totalCompleted}</p>
          <p className="text-xs text-indigo-600 mt-1 font-medium">Ready for final archive</p>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase">Archived Engagements</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{totalArchived}</p>
          <p className="text-xs text-slate-400 mt-1 font-medium">Fully readable archive records</p>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Engagement List (Left 1 or 2 cols) */}
        <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4 ${selectedEngagement ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input 
                type="text" 
                placeholder="Search engagements or clients..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            >
              <option value="ALL">All Statuses</option>
              <option value="PLANNING">Planning</option>
              <option value="FIELDWORK">Fieldwork</option>
              <option value="REVIEW">Review</option>
              <option value="PARTNER_SIGN_OFF">Partner Sign-Off</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" /> Loading engagements...
            </div>
          ) : filteredEngagements.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              No audit engagements found matching criteria. Click "New Engagement" to start.
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1">
              {filteredEngagements.map(eng => {
                const isSelected = selectedEngagement?.id === eng.id;
                return (
                  <div
                    key={eng.id}
                    onClick={() => handleSelectEngagement(eng)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-sm' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {eng.engagementType.replace('_', ' ')}
                        </span>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">{eng.engagementName}</h3>
                        <p className="text-xs text-slate-500 font-medium">{eng.clientCompanyName} • <span className="font-mono">{eng.auditPeriod}</span></p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                        eng.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                        eng.status === 'ARCHIVED' ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' :
                        eng.status === 'FIELDWORK' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                        'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      }`}>
                        {eng.status}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-700/60 pt-2">
                      <span>Materiality: <strong className="font-mono text-slate-600 dark:text-slate-300">{formatCurrency(eng.materiality)}</strong></span>
                      {eng.fieldworkDeadline && (
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Due: {eng.fieldworkDeadline}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detailed Engagement Panel (Right 2 cols when selected) */}
        {selectedEngagement && (
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-6">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 px-2.5 py-0.5 rounded">
                    {selectedEngagement.engagementType.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">Period: {selectedEngagement.auditPeriod}</span>
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1">{selectedEngagement.engagementName}</h3>
                <p className="text-xs text-slate-500 font-medium">Client: {selectedEngagement.clientCompanyName}</p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={selectedEngagement.status}
                  onChange={e => handleUpdateStatus(e.target.value)}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                >
                  <option value="PLANNING">Planning</option>
                  <option value="FIELDWORK">Fieldwork</option>
                  <option value="REVIEW">Review</option>
                  <option value="PARTNER_SIGN_OFF">Partner Sign-Off</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                {selectedEngagement.status !== 'ARCHIVED' && (
                  <button
                    onClick={() => handleArchive(selectedEngagement.id)}
                    className="p-1.5 border border-red-200 hover:bg-red-50 text-red-600 rounded-lg text-xs"
                    title="Archive Engagement"
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => { setSelectedEngagement(null); setEngagementDetails(null); }}
                  className="p-1.5 border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700 rounded-lg text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {isPlanningOpen ? (
              <AuditPlanning engagementId={selectedEngagement.id} onBack={() => setIsPlanningOpen(false)} />
            ) : loadingDetails ? (
              <div className="p-12 text-center text-slate-400">Loading audit engagement workspace...</div>
            ) : engagementDetails ? (
              <div className="space-y-6">
                {/* Phase Navigation Tabs */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200 dark:border-slate-700">
                  <button onClick={() => setWorkspaceTab('overview')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'overview' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Overview</button>
                  <button onClick={() => setWorkspaceTab('planning')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'planning' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Planning</button>
                  <button onClick={() => setWorkspaceTab('workpapers')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'workpapers' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Workpapers</button>
                  <button onClick={() => setWorkspaceTab('findings')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'findings' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Findings & Adj</button>
                  <button onClick={() => setWorkspaceTab('controls')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'controls' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Controls</button>
                  <button onClick={() => setWorkspaceTab('fraud')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'fraud' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Fraud</button>
                  <button onClick={() => setWorkspaceTab('vault')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'vault' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Vault</button>
                  <button onClick={() => setWorkspaceTab('backup')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${workspaceTab === 'backup' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>Backup</button>
                </div>

                {workspaceTab === 'planning' ? (
                  <AuditPlanning engagementId={selectedEngagement.id} onBack={() => setWorkspaceTab('overview')} />
                ) : workspaceTab === 'workpapers' ? (
                  <AuditWorkpapersView engagementId={selectedEngagement.id} />
                ) : workspaceTab === 'findings' ? (
                  <AuditFindingsAndAdjustmentsView engagementId={selectedEngagement.id} />
                ) : workspaceTab === 'controls' ? (
                  <InternalControlsView />
                ) : workspaceTab === 'fraud' ? (
                  <FraudDetectionView />
                ) : workspaceTab === 'vault' ? (
                  <DocumentVaultView />
                ) : workspaceTab === 'backup' ? (
                  <BackupRestoreView />
                ) : (
                  <div className="space-y-6">
                {/* Audit Planning & Risk Assessment Banner Button */}
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-xs text-emerald-900 dark:text-emerald-200 uppercase">Audit Planning & Risk Assessment</h4>
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">Entity understanding, significant accounts, risk assessment, and risk-to-procedure mapping.</p>
                  </div>
                  <button
                    onClick={() => setWorkspaceTab('planning')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                  >
                    Open Audit Planning →
                  </button>
                </div>
                {/* Materiality & Thresholds Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Overall Materiality</span>
                    <p className="text-base font-bold font-mono text-emerald-600 mt-0.5">{formatCurrency(engagementDetails.materiality)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Performance Materiality</span>
                    <p className="text-base font-bold font-mono text-blue-600 mt-0.5">{formatCurrency(engagementDetails.performanceMateriality)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Trivial Misstatement</span>
                    <p className="text-base font-bold font-mono text-slate-700 dark:text-slate-300 mt-0.5">{formatCurrency(engagementDetails.trivialThreshold)}</p>
                  </div>
                </div>

                {/* Deadlines & Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <span className="text-slate-400 block font-medium">Fieldwork Deadline</span>
                    <strong className="text-slate-700 dark:text-slate-200 mt-1 block">{engagementDetails.fieldworkDeadline || 'Not set'}</strong>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <span className="text-slate-400 block font-medium">Sign-Off Deadline</span>
                    <strong className="text-slate-700 dark:text-slate-200 mt-1 block">{engagementDetails.signOffDeadline || 'Not set'}</strong>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <span className="text-slate-400 block font-medium">Report Deadline</span>
                    <strong className="text-slate-700 dark:text-slate-200 mt-1 block">{engagementDetails.reportDeadline || 'Not set'}</strong>
                  </div>
                </div>

                {/* Open-Items / PBC Checklist Tracker */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-emerald-600" /> Open Items & PBC Checklist ({engagementDetails.items?.length || 0})
                    </h4>
                    <button
                      onClick={() => setIsAddingItem(!isAddingItem)}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Open Item
                    </button>
                  </div>

                  {isAddingItem && (
                    <form onSubmit={handleAddItem} className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">Category</label>
                          <select
                            value={newItemForm.itemCategory}
                            onChange={e => setNewItemForm({...newItemForm, itemCategory: e.target.value})}
                            className="w-full px-3 py-1.5 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                          >
                            <option value="PBC">PBC Document Request</option>
                            <option value="WORKING_PAPER">Working Paper</option>
                            <option value="ADJUSTMENT">Audit Adjustment / AJE</option>
                            <option value="CONTROL_DEFICIENCY">Control Deficiency</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">Item Title</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Bank Confirmation Letter - BPI"
                            value={newItemForm.title}
                            onChange={e => setNewItemForm({...newItemForm, title: e.target.value})}
                            className="w-full px-3 py-1.5 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={() => setIsAddingItem(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200 rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-1.5 text-xs bg-emerald-600 text-white font-bold rounded-lg">Save Item</button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {engagementDetails.items?.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-xs">
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                            item.itemCategory === 'PBC' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                            item.itemCategory === 'ADJUSTMENT' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          }`}>
                            {item.itemCategory}
                          </span>
                          <span className={`font-medium ${item.status === 'CLEARED' || item.status === 'REVIEWED' ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                            {item.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={item.status}
                            onChange={e => handleUpdateItemStatus(item.id, e.target.value)}
                            className="px-2 py-1 text-[11px] font-bold border rounded bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700"
                          >
                            <option value="OPEN">Open</option>
                            <option value="IN_PROGRESS">In Progress</option>
                            <option value="CLEARED">Cleared</option>
                            <option value="REVIEWED">Reviewed</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Audit Trail Log */}
                <div className="space-y-2 border-t pt-4">
                  <h4 className="font-bold text-xs text-slate-500 uppercase">Engagement Audit Trail</h4>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 font-mono text-[11px]">
                    {engagementDetails.logs?.map((log: any) => (
                      <div key={log.id} className="p-2 rounded bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 flex items-center justify-between">
                        <span><strong>[{log.action}]</strong> {log.details}</span>
                        <span className="text-[10px] text-slate-400">{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
            ) : null}
          </div>
        )}
      </div>

      {/* New Engagement Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">Create New Audit Engagement</h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-500"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateEngagement} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Client Company</label>
                  <select
                    required
                    value={newForm.clientCompanyId}
                    onChange={e => setNewForm({...newForm, clientCompanyId: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  >
                    <option value="">Select Client Company...</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.legalName || c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Engagement Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. FY 2025 Statutory Audit"
                    value={newForm.engagementName}
                    onChange={e => setNewForm({...newForm, engagementName: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Audit Period</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. FY 2025"
                    value={newForm.auditPeriod}
                    onChange={e => setNewForm({...newForm, auditPeriod: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Engagement Type</label>
                  <select
                    value={newForm.engagementType}
                    onChange={e => setNewForm({...newForm, engagementType: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  >
                    <option value="STATUTORY_AUDIT">Statutory Audit</option>
                    <option value="TAX_COMPLIANCE">Tax Compliance Review</option>
                    <option value="INTERNAL_AUDIT">Internal Audit</option>
                    <option value="SPECIAL_REVIEW">Special Agreed-Upon Procedures</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Materiality (Centavos)</label>
                  <input
                    type="number"
                    value={newForm.materiality}
                    onChange={e => setNewForm({...newForm, materiality: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Performance Mat. (Centavos)</label>
                  <input
                    type="number"
                    value={newForm.performanceMateriality}
                    onChange={e => setNewForm({...newForm, performanceMateriality: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Trivial Threshold (Centavos)</label>
                  <input
                    type="number"
                    value={newForm.trivialThreshold}
                    onChange={e => setNewForm({...newForm, trivialThreshold: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Fieldwork Deadline</label>
                  <input
                    type="date"
                    value={newForm.fieldworkDeadline}
                    onChange={e => setNewForm({...newForm, fieldworkDeadline: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Sign-Off Deadline</label>
                  <input
                    type="date"
                    value={newForm.signOffDeadline}
                    onChange={e => setNewForm({...newForm, signOffDeadline: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Report Deadline</label>
                  <input
                    type="date"
                    value={newForm.reportDeadline}
                    onChange={e => setNewForm({...newForm, reportDeadline: e.target.value})}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Engagement Notes / Scope</label>
                <textarea
                  rows={3}
                  placeholder="Additional scope notes, key risk areas..."
                  value={newForm.notes}
                  onChange={e => setNewForm({...newForm, notes: e.target.value})}
                  className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700"
                ></textarea>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
                >
                  Create Engagement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
