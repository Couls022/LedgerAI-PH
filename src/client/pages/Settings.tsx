import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, Shield, Building2, Workflow, Sun, Moon, Laptop, Check, Loader2, Sparkles, CheckCircle2, Lock, Users, AlertCircle, AlertTriangle, X, Key, Copy, Database, Server, ShieldCheck, Mail, Edit2, Trash2, UserX, UserCheck, RefreshCw } from 'lucide-react';
import { useAuth, LedgerRole } from '../context/AuthContext';
import { useTheme, ThemeMode } from '../context/ThemeContext';
import { RoleBadge } from '../components/ProtectedRoute';
import { getDefaultVatStatusForClassification } from '../../shared/taxProfile';
import LicenseActivation from '../components/licensing/LicenseActivation';
import BackupManager from './BackupManager';
import LanServerDashboard from '../components/lan/LanServerDashboard';
import DirectoryExplorerModal from '../components/DirectoryExplorerModal';
import CompanyAuditPanel from '../components/CompanyAuditPanel';
import EmailSettings from '../components/EmailSettings';
import AiSettings from '../components/AiSettings';
import { ToastContainer, ToastItem, StatusConfirmationModal, RemoveMemberConfirmationModal, MemberStatusToggle } from '../components/settings/MemberManagementModals';


type Tab = 'user' | 'company' | 'roles' | 'periods' | 'backup' | 'lan' | 'audit' | 'email' | 'ai';

type Member = {
  membershipId?: string;
  userId: string;
  displayName: string;
  email: string;
  status: string;
  role: LedgerRole;
  roleName: string;
  roles?: LedgerRole[];
  overrides?: Array<{ id: string; permissionCode: string; effect: 'ALLOW' | 'DENY'; reason?: string }>;
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('user');
  const { user, activeCompany, userRole, isAdmin, updateUser, refreshSession, hasPermission, permissions } = useAuth();
  const { theme, setTheme, isSyncing, syncSuccess, syncError, resolvedTheme } = useTheme();

  const showUser = true;
  const showCompany = hasPermission('company:read') || hasPermission('company:write') || isAdmin;
  const showRoles = hasPermission('roles:manage') || isAdmin;
  const showPeriods = hasPermission('accounting:view') || isAdmin;
  const showBackup = hasPermission('backups:view') || isAdmin;
  const showLan = hasPermission('lan:view') || isAdmin;
  const showAudit = hasPermission('audit:view') || isAdmin;
  const showEmail = hasPermission('settings:view') || hasPermission('settings:manage') || isAdmin;
  const showAi = hasPermission('settings:view') || hasPermission('settings:manage') || isAdmin;

  // Company Settings Form State
  const [companyDetails, setCompanyDetails] = useState<any>(null);
  const [legalName, setLegalName] = useState(activeCompany?.legalName || '');
  const [tradeName, setTradeName] = useState(activeCompany?.legalName || '');
  const [tin, setTin] = useState('');
  const [address, setAddress] = useState('');
  const [branchCode, setBranchCode] = useState('00000');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [industry, setIndustry] = useState('');
  const [taxpayerClassification, setTaxpayerClassification] = useState('CORPORATION');
  const [vatStatus, setVatStatus] = useState('VAT');
  const [rdoCode, setRdoCode] = useState('039');
  const [birRegistrationNo, setBirRegistrationNo] = useState('');
  const [birDateRegistered, setBirDateRegistered] = useState('');
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [accountingMethod, setAccountingMethod] = useState('ACCRUAL');
  const [documentLocationPath, setDocumentLocationPath] = useState('');
  const [backupLocationPath, setBackupLocationPath] = useState('');
  const [showSettingsExplorer, setShowSettingsExplorer] = useState<'document' | 'backup' | null>(null);

  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Safe Tab Fallback
  useEffect(() => {
    if (activeTab === 'company' && !showCompany) setActiveTab('user');
    else if (activeTab === 'roles' && !showRoles) setActiveTab('user');
    else if (activeTab === 'periods' && !showPeriods) setActiveTab('user');
    else if (activeTab === 'backup' && !showBackup) setActiveTab('user');
    else if (activeTab === 'lan' && !showLan) setActiveTab('user');
    else if (activeTab === 'audit' && !showAudit) setActiveTab('user');
    else if (activeTab === 'email' && !showEmail) setActiveTab('user');
    else if (activeTab === 'ai' && !showAi) setActiveTab('user');
  }, [activeTab, showCompany, showRoles, showPeriods, showBackup, showLan, showAudit, showEmail, showAi]);

  const fetchCompanyDetails = async () => {
    try {
      const res = await fetch('/api/companies/current/details');
      if (res.ok) {
        const data = await res.json();
        setCompanyDetails(data);
        if (data.legalName) setLegalName(data.legalName);
        if (data.tradeName) setTradeName(data.tradeName);
        if (data.tin) setTin(data.tin);
        if (data.address) setAddress(data.address);
        if (data.branchCode) setBranchCode(data.branchCode);
        if (data.contactPerson) setContactPerson(data.contactPerson);
        if (data.contactEmail) setContactEmail(data.contactEmail);
        if (data.contactPhone) setContactPhone(data.contactPhone);
        if (data.industry) setIndustry(data.industry);
        if (data.taxpayerClassification) setTaxpayerClassification(data.taxpayerClassification);
        if (data.vatStatus) setVatStatus(data.vatStatus);
        if (data.rdoCode) setRdoCode(data.rdoCode);
        if (data.birRegistrationNo) setBirRegistrationNo(data.birRegistrationNo);
        if (data.birDateRegistered) setBirDateRegistered(data.birDateRegistered);
        if (data.fiscalYear) setFiscalYear(data.fiscalYear);
        if (data.accountingMethod) setAccountingMethod(data.accountingMethod);
        if (data.documentLocationPath) setDocumentLocationPath(data.documentLocationPath);
        if (data.backupLocationPath) setBackupLocationPath(data.backupLocationPath);
      }
    } catch (err) {
      console.error('Failed to fetch company details', err);
    }
  };

  const [licenseStatus, setLicenseStatus] = useState<any>(null);
  const [copiedCompanyId, setCopiedCompanyId] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMember, setNewMember] = useState({ email: '', displayName: '', password: '', role: 'Read-only User' as LedgerRole });
  const [roleMsg, setRoleMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  
  // Toast notifications & modal dialogs
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const addToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 4);
    setToasts(prev => [...prev, { id, type, message, title }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };
  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Status & Delete confirmation modals state
  const [statusModal, setStatusModal] = useState<{
    isOpen: boolean;
    member: Member | null;
    targetStatus: 'ACTIVE' | 'DISABLED';
  }>({ isOpen: false, member: null, targetStatus: 'DISABLED' });
  const [isProcessingStatus, setIsProcessingStatus] = useState(false);

  const [removeModal, setRemoveModal] = useState<{
    isOpen: boolean;
    member: Member | null;
  }>({ isOpen: false, member: null });
  const [isProcessingRemove, setIsProcessingRemove] = useState(false);

  // RBAC Permission Matrix States
  const DEFAULT_ROLE_PERMISSIONS_MAP: Record<LedgerRole, string[]> = {
    'Company Owner': [
      'dashboard:view', 'operations:view', 'operations:manage',
      'sales:view', 'sales:create', 'sales:edit', 'sales:delete',
      'purchases:view', 'purchases:create', 'purchases:edit', 'purchases:delete',
      'inventory:view', 'inventory:manage',
      'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:post',
      'gl:view',
      'master_data:view', 'master_data:manage', 'master_data:delete',
      'payroll:view', 'payroll:process',
      'tax:view', 'tax:manage',
      'budget:view', 'budget:manage',
      'documents:view', 'documents:create', 'documents:delete',
      'reports:view', 'reports:export',
      'audit:view', 'audit:manage',
      'settings:view', 'settings:manage',
      'users:view', 'users:create', 'users:edit', 'users:deactivate',
      'backup:view', 'backup:create', 'backup:restore',
      'lan:view', 'lan:manage'
    ],
    'Company Administrator': [
      'dashboard:view', 'operations:view', 'operations:manage',
      'sales:view', 'sales:create', 'sales:edit', 'sales:delete',
      'purchases:view', 'purchases:create', 'purchases:edit', 'purchases:delete',
      'inventory:view', 'inventory:manage',
      'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:post',
      'gl:view',
      'master_data:view', 'master_data:manage', 'master_data:delete',
      'payroll:view', 'payroll:process',
      'tax:view', 'tax:manage',
      'budget:view', 'budget:manage',
      'documents:view', 'documents:create', 'documents:delete',
      'reports:view', 'reports:export',
      'audit:view', 'audit:manage',
      'settings:view', 'settings:manage',
      'users:view', 'users:create', 'users:edit', 'users:deactivate',
      'backups:view', 'backups:create', 'backups:download', 'backups:restore', 'backups:cleanup',
      'storage:view', 'storage:cleanup',
      'lan:view', 'lan:manage', 'lan:sessions:terminate', 'lan:lock'
    ],
    'Accountant': [
      'dashboard:view', 'operations:view',
      'sales:view', 'sales:create', 'sales:edit',
      'purchases:view', 'purchases:create', 'purchases:edit',
      'inventory:view', 'inventory:manage',
      'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:post',
      'gl:view',
      'master_data:view', 'master_data:manage',
      'payroll:view', 'payroll:process',
      'tax:view', 'tax:manage',
      'budget:view', 'budget:manage',
      'documents:view', 'documents:create',
      'reports:view', 'reports:export',
      'audit:view', 'settings:view',
      'backups:view', 'backups:create', 'backups:download',
      'storage:view',
      'lan:view', 'lan:lock'
    ],
    'Bookkeeper': [
      'dashboard:view', 'operations:view',
      'sales:view', 'sales:create',
      'purchases:view', 'purchases:create',
      'inventory:view', 'inventory:manage',
      'accounting:view', 'accounting:create',
      'gl:view',
      'master_data:view',
      'payroll:view',
      'documents:view', 'documents:create',
      'reports:view',
      'lan:view', 'lan:lock'
    ],
    'Auditor': [
      'dashboard:view', 'operations:view',
      'sales:view', 'purchases:view', 'inventory:view',
      'accounting:view', 'gl:view', 'master_data:view',
      'tax:view', 'reports:view', 'reports:export',
      'audit:view', 'audit:manage',
      'backups:view', 'storage:view', 'lan:view'
    ],
    'Reviewer': [
      'dashboard:view', 'operations:view',
      'sales:view', 'purchases:view', 'inventory:view',
      'accounting:view', 'gl:view', 'reports:view',
      'documents:view', 'audit:view', 'lan:view'
    ],
    'Approver': [
      'dashboard:view', 'operations:view',
      'sales:view', 'purchases:view', 'inventory:view',
      'accounting:view', 'gl:view', 'budget:view', 'reports:view', 'lan:view'
    ],
    'Read-only User': [
      'dashboard:view', 'operations:view',
      'sales:view', 'purchases:view', 'inventory:view',
      'accounting:view', 'gl:view', 'master_data:view',
      'reports:view', 'documents:view'
    ]
  };

  const ALL_MODULE_PERMISSIONS = [
    {
      category: 'Dashboard & Core Operations',
      permissions: [
        { code: 'dashboard:view', label: 'View Dashboard & Analytics' },
        { code: 'operations:view', label: 'View Operations Summary' },
        { code: 'operations:manage', label: 'Manage Operations & Workflows' }
      ]
    },
    {
      category: 'Sales & Invoicing',
      permissions: [
        { code: 'sales:view', label: 'View Sales & Invoices' },
        { code: 'sales:create', label: 'Create Sales Invoices' },
        { code: 'sales:edit', label: 'Edit / Update Invoices' },
        { code: 'sales:delete', label: 'Void / Delete Invoices' }
      ]
    },
    {
      category: 'Purchases & Bills',
      permissions: [
        { code: 'purchases:view', label: 'View Purchases & Bills' },
        { code: 'purchases:create', label: 'Create Bills / POs' },
        { code: 'purchases:edit', label: 'Edit Purchase Bills' },
        { code: 'purchases:delete', label: 'Void / Delete Bills' }
      ]
    },
    {
      category: 'Inventory',
      permissions: [
        { code: 'inventory:view', label: 'View Items & Stock Level' },
        { code: 'inventory:manage', label: 'Manage Stock Adjustments' }
      ]
    },
    {
      category: 'Journal Entries & Accounting',
      permissions: [
        { code: 'accounting:view', label: 'View Journal Entries' },
        { code: 'accounting:create', label: 'Create Draft Vouchers' },
        { code: 'accounting:edit', label: 'Edit Unposted Journals' },
        { code: 'accounting:post', label: 'Post / Approve Journals' }
      ]
    },
    {
      category: 'General Ledger & COA',
      permissions: [
        { code: 'gl:view', label: 'View General Ledger & Accounts' },
        { code: 'master_data:view', label: 'View Master Records (Customers/Suppliers)' },
        { code: 'master_data:manage', label: 'Create / Edit Master Records' },
        { code: 'master_data:delete', label: 'Delete Master Records' }
      ]
    },
    {
      category: 'Payroll & Tax (BIR)',
      permissions: [
        { code: 'payroll:view', label: 'View Payroll Registers' },
        { code: 'payroll:process', label: 'Process & Post Payroll' },
        { code: 'tax:view', label: 'View Tax Reports' },
        { code: 'tax:manage', label: 'Manage Tax & BIR Filings' }
      ]
    },
    {
      category: 'Reports & Audit',
      permissions: [
        { code: 'reports:view', label: 'View Financial Reports' },
        { code: 'reports:export', label: 'Export Reports (PDF/Excel)' },
        { code: 'audit:view', label: 'View Audit Logs' },
        { code: 'audit:manage', label: 'Manage Audit Trailing' }
      ]
    },
    {
      category: 'Settings & Security Administration',
      permissions: [
        { code: 'settings:view', label: 'View Company Settings' },
        { code: 'settings:manage', label: 'Modify Company Settings' },
        { code: 'users:view', label: 'View Company Members' },
        { code: 'users:create', label: 'Create New Members' },
        { code: 'users:edit', label: 'Modify Member Roles & Matrix' },
        { code: 'users:deactivate', label: 'Deactivate Members' }
      ]
    },
    {
      category: 'Backup, Storage & LAN Management',
      permissions: [
        { code: 'backups:view', label: 'View Backups' },
        { code: 'backups:create', label: 'Create Database Backups' },
        { code: 'backups:download', label: 'Download Backups & Export .lai' },
        { code: 'backups:restore', label: 'Restore Backups' },
        { code: 'storage:view', label: 'View Database Storage & .lai Cache' },
        { code: 'storage:cleanup', label: 'Clean Up Database Storage & .lai Cache' },
        { code: 'lan:view', label: 'View Local LAN Server & Sessions' },
        { code: 'lan:manage', label: 'Manage Local LAN Server' },
        { code: 'lan:sessions:terminate', label: 'Terminate Active LAN Workstation Sessions' },
        { code: 'lan:lock', label: 'Acquire Concurrency Record Locks' }
      ]
    }
  ];

  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(DEFAULT_ROLE_PERMISSIONS_MAP['Read-only User']);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<string[]>([]);
  const [isSavingMatrix, setIsSavingMatrix] = useState(false);

  // Edit Member Profile Modal State
  const [editingMemberDetails, setEditingMemberDetails] = useState<Member | null>(null);
  const [editForm, setEditForm] = useState<{
    displayName: string;
    email: string;
    role: LedgerRole;
    password?: string;
    status: 'ACTIVE' | 'DISABLED';
  }>({
    displayName: '',
    email: '',
    role: 'Read-only User',
    password: '',
    status: 'ACTIVE'
  });
  const [isUpdatingMember, setIsUpdatingMember] = useState(false);

  const togglePermission = (permCode: string, isEditingModal = false) => {
    if (isEditingModal) {
      setEditingPermissions(prev => 
        prev.includes(permCode) ? prev.filter(p => p !== permCode) : [...prev, permCode]
      );
    } else {
      setSelectedPermissions(prev => 
        prev.includes(permCode) ? prev.filter(p => p !== permCode) : [...prev, permCode]
      );
    }
  };

  const handleCreateRoleSelect = (role: LedgerRole) => {
    setNewMember(prev => ({ ...prev, role }));
    setSelectedPermissions(DEFAULT_ROLE_PERMISSIONS_MAP[role] || []);
  };

  const openEditMatrixModal = (member: Member) => {
    setEditingMember(member);
    const initialPerms = member.overrides
      ? member.overrides.filter(o => o.effect === 'ALLOW').map(o => o.permissionCode)
      : (DEFAULT_ROLE_PERMISSIONS_MAP[member.role] || []);
    setEditingPermissions(initialPerms);
  };

  const handleOpenEditMember = (member: Member) => {
    setEditingMemberDetails(member);
    setEditForm({
      displayName: member.displayName || '',
      email: member.email || '',
      role: member.role || 'Read-only User',
      password: '',
      status: (member.status as 'ACTIVE' | 'DISABLED') || 'ACTIVE'
    });
  };

  const handleSaveEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMemberDetails) return;
    setIsUpdatingMember(true);
    setRoleMsg(null);
    try {
      const targetId = editingMemberDetails.membershipId || editingMemberDetails.userId;
      const payload: any = {
        displayName: editForm.displayName.trim(),
        email: editForm.email.trim(),
        role: editForm.role,
        status: editForm.status
      };
      if (editForm.password && editForm.password.trim()) {
        payload.password = editForm.password.trim();
      }

      const res = await fetch(`/api/companies/current/members/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text || 'Server returned invalid response' };
      }

      if (res.ok) {
        const successMsg = `Member "${editForm.displayName}" updated successfully.`;
        setRoleMsg({ type: 'success', text: successMsg });
        addToast('success', successMsg, 'Member Updated');
        setEditingMemberDetails(null);
        fetchMembers();
      } else {
        setRoleMsg({ type: 'error', text: data.message || 'Failed to update member' });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || 'Network error occurred' });
    } finally {
      setIsUpdatingMember(false);
    }
  };

  const handleSaveMemberMatrix = async () => {
    if (!editingMember) return;
    setIsSavingMatrix(true);
    setRoleMsg(null);
    try {
      const targetId = editingMember.membershipId || editingMember.userId;
      const res = await fetch(`/api/users/${targetId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPermissions: editingPermissions })
      });
      if (res.ok) {
        setRoleMsg({ type: 'success', text: `Permission matrix updated for ${editingMember.displayName}` });
        setEditingMember(null);
        fetchMembers();
      } else {
        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch (_) { data = { message: text }; }
        setRoleMsg({ type: 'error', text: data.message || 'Failed to update permission matrix' });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || 'Network error' });
    } finally {
      setIsSavingMatrix(false);
    }
  };

  const fetchLicenseStatus = async () => {
    try {
      const res = await fetch(`/api/licensing/status?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setLicenseStatus(data);
        window.dispatchEvent(new Event('refresh-license-banner'));
      }
    } catch (e) {}
  };

  const getCanonicalLicenseState = (lic: any): 'NOT ACTIVATED' | 'ACTIVATED' | 'EXPIRED' | 'REVOKED' | 'REACTIVATION REQUIRED' => {
    if (!lic || lic.status === 'NO_COMPANY') return 'NOT ACTIVATED';
    if (lic.status === 'REVOKED') return 'REVOKED';
    if (lic.needsReactivation) return 'REACTIVATION REQUIRED';
    if (lic.status === 'EXPIRED') return 'EXPIRED';
    if (!lic.isLifetime && lic.expirationDate && new Date(lic.expirationDate) < new Date()) {
      return 'EXPIRED';
    }
    if (lic.status === 'ACTIVE' || lic.status === 'ACTIVATED') return 'ACTIVATED';
    return 'NOT ACTIVATED';
  };

  useEffect(() => {
    fetchCompanyDetails();
    fetchLicenseStatus();
    fetchMembers();
  }, [activeCompany?.id]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingMember(true);
    setRoleMsg(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newMember,
          customPermissions: selectedPermissions
        })
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text || 'Server returned invalid response' };
      }

      if (res.ok) {
        const successMsg = `Member "${newMember.displayName}" created successfully with role "${newMember.role}".`;
        setRoleMsg({ type: 'success', text: successMsg });
        addToast('success', successMsg, 'Member Created');
        setShowAddMember(false);
        setNewMember({ email: '', displayName: '', password: '', role: 'Read-only User' });
        setSelectedPermissions(DEFAULT_ROLE_PERMISSIONS_MAP['Read-only User']);
        fetchMembers();
      } else {
        setRoleMsg({ type: 'error', text: data.message || 'Failed to add member' });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || 'Network error occurred' });
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleOpenStatusModal = (member: Member, targetStatus: 'ACTIVE' | 'DISABLED') => {
    setStatusModal({ isOpen: true, member, targetStatus });
  };

  const handleConfirmStatusChange = async (reason?: string) => {
    if (!statusModal.member) return;
    const member = statusModal.member;
    const targetStatus = statusModal.targetStatus;
    const actionLabel = targetStatus === 'ACTIVE' ? 'activate' : 'disable';

    setIsProcessingStatus(true);
    setUpdatingUserId(member.userId);
    setRoleMsg(null);
    try {
      const targetId = member.membershipId || member.userId;
      const res = await fetch(`/api/companies/current/members/${targetId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus, reason })
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text };
      }

      if (res.ok) {
        setStatusModal({ isOpen: false, member: null, targetStatus: 'DISABLED' });
        fetchMembers();
        const successMsg = `Account for ${member.displayName} is now ${targetStatus === 'ACTIVE' ? 'Active' : 'Disabled'}.`;
        setRoleMsg({ type: 'success', text: successMsg });
        addToast('success', successMsg, targetStatus === 'ACTIVE' ? 'Account Activated' : 'Account Disabled');
      } else {
        const errorMsg = data.message || `Failed to ${actionLabel} account`;
        setRoleMsg({ type: 'error', text: errorMsg });
        addToast('error', errorMsg, 'Status Update Failed');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Network error occurred';
      setRoleMsg({ type: 'error', text: errorMsg });
      addToast('error', errorMsg, 'Network Error');
    } finally {
      setIsProcessingStatus(false);
      setUpdatingUserId(null);
    }
  };

  const handleOpenRemoveModal = (member: Member) => {
    setRemoveModal({ isOpen: true, member });
  };

  const handleConfirmRemoveMember = async () => {
    if (!removeModal.member) return;
    const member = removeModal.member;

    setIsProcessingRemove(true);
    setUpdatingUserId(member.userId);
    setRoleMsg(null);
    try {
      const targetId = member.membershipId || member.userId;
      const res = await fetch(`/api/companies/current/members/${targetId}`, {
        method: 'DELETE'
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text };
      }

      if (res.ok) {
        setRemoveModal({ isOpen: false, member: null });
        fetchMembers();
        const successMsg = `Member "${member.displayName}" (${member.email}) was removed from the company.`;
        setRoleMsg({ type: 'success', text: successMsg });
        addToast('success', successMsg, 'Member Removed');
      } else {
        const errorMsg = data.message || 'Failed to delete member';
        setRoleMsg({ type: 'error', text: errorMsg });
        addToast('error', errorMsg, 'Remove Failed');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Network error occurred';
      setRoleMsg({ type: 'error', text: errorMsg });
      addToast('error', errorMsg, 'Network Error');
    } finally {
      setIsProcessingRemove(false);
      setUpdatingUserId(null);
    }
  };

  const handleResetPassword = async (userId: string) => {
    const newPassword = prompt("Enter new temporary password for user:");
    if (!newPassword || !newPassword.trim()) return;
    
    setUpdatingUserId(userId);
    setRoleMsg(null);
    try {
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPassword.trim() })
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text };
      }

      if (res.ok) {
        setRoleMsg({ type: 'success', text: 'Password reset successfully. User will be required to change it on next login.' });
      } else {
        setRoleMsg({ type: 'error', text: data.message || 'Failed to reset password' });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || 'Network error occurred' });
    } finally {
      setUpdatingUserId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'roles') {
      fetchMembers();
    }
  }, [activeTab]);

  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch('/api/companies/current/members');
      if (res.ok) {
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load members", err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleAddRole = async (memberId: string, roleToAdd: string) => {
    setUpdatingUserId(memberId);
    setRoleMsg(null);
    try {
      const res = await fetch(`/api/companies/current/members/${memberId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleToAdd }),
      });
      const data = await res.json();
      if (res.ok) {
        setRoleMsg({ type: 'success', text: `Role ${roleToAdd} added successfully.` });
        fetchMembers();
      } else {
        setRoleMsg({ type: 'error', text: data.message || "Failed to add role" });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || "Error adding role" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleRemoveRole = async (memberId: string, roleToRemove: string) => {
    setUpdatingUserId(memberId);
    setRoleMsg(null);
    try {
      const res = await fetch(`/api/companies/current/members/${memberId}/roles/${encodeURIComponent(roleToRemove)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        setRoleMsg({ type: 'success', text: `Role ${roleToRemove} removed successfully.` });
        fetchMembers();
      } else {
        setRoleMsg({ type: 'error', text: data.message || "Failed to remove role" });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || "Error removing role" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleRoleChange = async (member: Member, newRole: LedgerRole) => {
    const targetId = member.membershipId || member.userId;
    setUpdatingUserId(member.userId);
    setRoleMsg(null);
    try {
      const res = await fetch(`/api/companies/current/members/${targetId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetRole: newRole }),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text };
      }

      if (res.ok) {
        setRoleMsg({ type: 'success', text: `Role for ${member.displayName} updated to ${newRole}` });
        fetchMembers();
      } else {
        setRoleMsg({ type: 'error', text: data.message || "Failed to update role" });
      }
    } catch (err: any) {
      setRoleMsg({ type: 'error', text: err.message || "Error updating role" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setIsSavingCompany(true);
    setCompanyMsg(null);
    try {
      const res = await fetch('/api/companies/current/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          legalName, 
          tradeName, 
          tin, 
          address, 
          branchCode, 
          contactPerson, 
          contactEmail, 
          contactPhone, 
          industry, 
          taxpayerClassification, 
          vatStatus, 
          rdoCode, 
          birRegistrationNo, 
          birDateRegistered, 
          fiscalYear, 
          accountingMethod, 
          documentLocationPath, 
          backupLocationPath 
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCompanyMsg({ type: 'success', text: 'Company settings updated successfully' });
        fetchCompanyDetails();
        await refreshSession();
      } else {
        setCompanyMsg({ type: 'error', text: data.message || 'Failed to save settings' });
      }
    } catch (err: any) {
      setCompanyMsg({ type: 'error', text: err.message || 'Error saving settings' });
    } finally {
      setIsSavingCompany(false);
    }
  };

  const handleThemeChange = async (newTheme: ThemeMode) => {
    await setTheme(newTheme, true);
    if (user) {
      updateUser({ theme: newTheme });
    }
  };

  return (
    <div className="w-full space-y-6">
      {showAddMember && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">CREATE MEMBER</h2>
              <button onClick={() => setShowAddMember(false)} className="text-slate-400 hover:text-slate-500"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleAddMember} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Basic Details */}
                <div className="grid grid-cols-1 gap-4">
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Full Name</label>
                    <input type="text" required placeholder="Juan" value={newMember.displayName} onChange={e => setNewMember({...newMember, displayName: e.target.value})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                    <input type="email" required placeholder="juan@company.com" value={newMember.email} onChange={e => setNewMember({...newMember, email: e.target.value})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                    <input type="password" required placeholder="********" value={newMember.password} onChange={e => setNewMember({...newMember, password: e.target.value})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Role Preset</label>
                    <select 
                      value={newMember.role} 
                      onChange={e => handleCreateRoleSelect(e.target.value as LedgerRole)} 
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                    >
                      <option value="Company Owner">Company Owner (Full System Access)</option>
                      <option value="Company Administrator">Company Administrator</option>
                      <option value="Accountant">Accountant</option>
                      <option value="Bookkeeper">Bookkeeper</option>
                      <option value="Auditor">Auditor</option>
                      <option value="Reviewer">Reviewer</option>
                      <option value="Approver">Approver</option>
                      <option value="Read-only User">Read-only User</option>
                    </select>
                  </div>
                </div>

                <hr className="border-slate-200 dark:border-slate-700" />

                {/* Module Permissions Matrix */}
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-wider uppercase">System Module & Permission Matrix</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Toggle granular access for each system module for this specific user account.</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedPermissions(ALL_MODULE_PERMISSIONS.flatMap(cat => cat.permissions.map(p => p.code)))}
                        className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded font-semibold border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPermissions(DEFAULT_ROLE_PERMISSIONS_MAP[newMember.role] || [])}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                      >
                        Reset Defaults
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPermissions([])}
                        className="px-2.5 py-1 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 rounded font-semibold border border-red-200 dark:border-red-800 hover:bg-red-100"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-6">
                    {ALL_MODULE_PERMISSIONS.map(cat => (
                      <div key={cat.category} className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700/70">
                        <div className="font-bold text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-3 flex items-center justify-between">
                          <span>{cat.category}</span>
                          <span className="text-[10px] text-slate-500 font-normal">
                            {cat.permissions.filter(p => selectedPermissions.includes(p.code)).length} of {cat.permissions.length} granted
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {cat.permissions.map(p => {
                            const isChecked = selectedPermissions.includes(p.code);
                            return (
                              <label key={p.code} className={`flex items-center gap-2.5 p-2 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${isChecked ? 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100'}`}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => togglePermission(p.code)}
                                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>{p.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex gap-3 justify-end shrink-0">
                <button type="button" onClick={() => setShowAddMember(false)} className="px-6 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg uppercase tracking-wide">Cancel</button>
                <button type="submit" disabled={isAddingMember} className="px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg uppercase tracking-wide disabled:opacity-50">
                  {isAddingMember ? 'Creating Member...' : 'Create Member with Matrix'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MEMBER PERMISSION MATRIX MODAL */}
      {editingMember && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0 bg-slate-50 dark:bg-slate-900/40">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-600" /> EDIT PERMISSION MATRIX
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Member: <strong className="text-slate-700 dark:text-slate-200">{editingMember.displayName}</strong> ({editingMember.email}) • Primary Role: <strong className="text-indigo-600">{editingMember.role}</strong>
                </p>
              </div>
              <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-500"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-950/40 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-xs">
                <div className="text-indigo-900 dark:text-indigo-300 font-medium">
                  Modifying custom overrides for this account. Active permissions take effect instantly across all modules.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPermissions(ALL_MODULE_PERMISSIONS.flatMap(cat => cat.permissions.map(p => p.code)))}
                    className="px-2.5 py-1 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPermissions(DEFAULT_ROLE_PERMISSIONS_MAP[editingMember.role] || [])}
                    className="px-2.5 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border rounded font-bold hover:bg-slate-100"
                  >
                    Reset Role Defaults
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {ALL_MODULE_PERMISSIONS.map(cat => (
                  <div key={cat.category} className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700/70">
                    <div className="font-bold text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-3 flex items-center justify-between">
                      <span>{cat.category}</span>
                      <span className="text-[10px] text-slate-500 font-normal">
                        {cat.permissions.filter(p => editingPermissions.includes(p.code)).length} of {cat.permissions.length} granted
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cat.permissions.map(p => {
                        const isChecked = editingPermissions.includes(p.code);
                        return (
                          <label key={p.code} className={`flex items-center gap-2.5 p-2 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${isChecked ? 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePermission(p.code, true)}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>{p.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex gap-3 justify-end shrink-0">
              <button type="button" onClick={() => setEditingMember(null)} className="px-5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg uppercase">Cancel</button>
              <button type="button" onClick={handleSaveMemberMatrix} disabled={isSavingMatrix} className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg uppercase disabled:opacity-50 flex items-center gap-2">
                {isSavingMatrix && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Permission Matrix
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MEMBER PROFILE MODAL */}
      {editingMemberDetails && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Edit Member Account
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Update name, email, primary role, status, or set a new password.
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setEditingMemberDetails(null)} 
                className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditMember} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editForm.displayName}
                  onChange={e => setEditForm(prev => ({ ...prev, displayName: e.target.value }))}
                  placeholder="e.g. Juan dela Cruz"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="juan@company.com"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Primary Role
                  </label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value as LedgerRole }))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="Company Owner">Company Owner</option>
                    <option value="Company Administrator">Company Administrator</option>
                    <option value="Approver">Approver</option>
                    <option value="Reviewer">Reviewer</option>
                    <option value="Accountant">Accountant</option>
                    <option value="Bookkeeper">Bookkeeper</option>
                    <option value="Auditor">Auditor</option>
                    <option value="Read-only User">Read-only User</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Account Status
                    </label>
                    <div className="flex items-center gap-1.5">
                      <MemberStatusToggle
                        status={editForm.status}
                        onToggle={() => setEditForm(prev => ({ ...prev, status: prev.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }))}
                        size="sm"
                      />
                      <span className={`text-[11px] font-bold ${editForm.status === 'DISABLED' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {editForm.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  <select
                    value={editForm.status}
                    onChange={e => setEditForm(prev => ({ ...prev, status: e.target.value as 'ACTIVE' | 'DISABLED' }))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="ACTIVE">ACTIVE (Enabled)</option>
                    <option value="DISABLED">DISABLED (Suspended)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  New Password <span className="text-slate-400 font-normal">(Leave blank to keep unchanged)</span>
                </label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={e => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const m = editingMemberDetails;
                      setEditingMemberDetails(null);
                      openEditMatrixModal(m);
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-4 h-4" /> Permissions Matrix
                  </button>

                  {editingMemberDetails.userId !== user?.id && (
                    <button
                      type="button"
                      onClick={() => {
                        const m = editingMemberDetails;
                        setEditingMemberDetails(null);
                        handleOpenRemoveModal(m);
                      }}
                      className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 font-semibold flex items-center gap-1 hover:underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove Account
                    </button>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingMemberDetails(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdatingMember}
                    className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
                  >
                    {isUpdatingMember && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Settings & Configuration</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage user profile, visual preferences, company environment, and Role-Based Access Control (RBAC).</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Your Current Role:</span>
          <RoleBadge role={userRole} />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Navigation Sidebar */}
        <div className="space-y-2">
           {showUser && (
             <button
               onClick={() => setActiveTab('user')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'user' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <User className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'user' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">User Profile & Appearance</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Theme settings & profile details</p>
               </div>
             </button>
           )}

           {showCompany && (
             <button
               onClick={() => setActiveTab('company')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'company' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Building2 className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'company' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Company Profile</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage details for {activeCompany?.legalName}</p>
               </div>
             </button>
           )}
           
           {showRoles && (
             <button
               onClick={() => setActiveTab('roles')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'roles' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Shield className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'roles' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Roles & Permissions</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Owner, Company Administrator, Approver, Accountant RBAC matrix</p>
               </div>
             </button>
           )}
           
           {showPeriods && (
             <button
               onClick={() => setActiveTab('periods')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'periods' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Workflow className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'periods' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Accounting Periods</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Open/Close month-end books</p>
               </div>
             </button>
           )}

           {showBackup && (
             <button
               onClick={() => setActiveTab('backup')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'backup' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Database className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'backup' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Backup Manager</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Automated snapshots & data recovery</p>
               </div>
             </button>
           )}

           {showLan && (
             <button
               onClick={() => setActiveTab('lan')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'lan' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Server className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'lan' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">LAN Server & Sync</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Local network node & device sync</p>
               </div>
             </button>
           )}

           {showAudit && (
             <button
               onClick={() => setActiveTab('audit')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'audit' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <ShieldCheck className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'audit' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Audit Trail & Activity</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Who modified files, tax & data</p>
               </div>
             </button>
           )}

           {showEmail && (
             <button
               onClick={() => setActiveTab('email')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'email' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Mail className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'email' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Email Notifications</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">SMTP server configuration</p>
               </div>
             </button>
           )}

           {showAi && (
             <button
               onClick={() => setActiveTab('ai')}
               className={`w-full text-left flex gap-3 p-3.5 rounded-xl transition-all border ${
                 activeTab === 'ai' 
                   ? 'bg-white dark:bg-slate-800 shadow-sm border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold' 
                   : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60'
               }`}
             >
               <Sparkles className={`w-5 h-5 shrink-0 mt-0.5 ${activeTab === 'ai' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
               <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Ledger Agent</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Configure AI Intelligence engine</p>
               </div>
             </button>
           )}
        </div>
        
        {/* Main Details Panel */}
        <div className="md:col-span-2 space-y-6">
          {activeTab === 'user' && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-8 space-y-8">
              <div>
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <User className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> User Profile & Preferences
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure your personal account preferences and theme mode.</p>
                  </div>
                  {isSyncing && (
                    <span className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1 rounded-full font-medium border border-indigo-200 dark:border-indigo-800">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                    </span>
                  )}
                  {syncSuccess && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 rounded-full font-medium border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Saved to Profile
                    </span>
                  )}
                </div>

                {/* Account Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Display Name</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">{user?.displayName || 'Unknown User'}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Email Address</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">{user?.email || 'N/A'}</p>
                  </div>
                </div>

                {/* Visual Theme Mode */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" /> Interface Theme
                    </h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      Active: <strong className="text-slate-700 dark:text-slate-300 capitalize">{resolvedTheme} Mode</strong>
                    </span>
                  </div>
                  
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Choose your preferred visual theme. Your selection is automatically synced with your profile settings.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Light Mode Option */}
                    <button
                      type="button"
                      onClick={() => handleThemeChange('light')}
                      className={`relative flex flex-col items-center p-4 rounded-xl border text-left transition-all ${
                        theme === 'light'
                          ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {theme === 'light' && (
                        <span className="absolute top-3 right-3 text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/80 p-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center mb-3 shrink-0">
                        <Sun className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Light Mode</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">
                        Clean off-white canvas with optimal daylight contrast
                      </span>
                    </button>

                    {/* Dark Mode Option */}
                    <button
                      type="button"
                      onClick={() => handleThemeChange('dark')}
                      className={`relative flex flex-col items-center p-4 rounded-xl border text-left transition-all ${
                        theme === 'dark'
                          ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {theme === 'dark' && (
                        <span className="absolute top-3 right-3 text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/80 p-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <div className="w-10 h-10 rounded-lg bg-indigo-900 text-indigo-300 flex items-center justify-center mb-3 shrink-0">
                        <Moon className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Dark Mode</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">
                        High-contrast dark canvas for eye comfort in low light
                      </span>
                    </button>

                    {/* System Default Option */}
                    <button
                      type="button"
                      onClick={() => handleThemeChange('system')}
                      className={`relative flex flex-col items-center p-4 rounded-xl border text-left transition-all ${
                        theme === 'system'
                          ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {theme === 'system' && (
                        <span className="absolute top-3 right-3 text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/80 p-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center mb-3 shrink-0">
                        <Laptop className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">System Default</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">
                        Automatically matches your OS dark mode schedule
                      </span>
                    </button>
                  </div>

                  {syncError && (
                    <p className="text-xs text-rose-500 mt-3 font-medium">{syncError}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'company' && showCompany && (
            <>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-6">
               <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
                 <div>
                   <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                     <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Company Profile & Tax Registration
                   </h2>
                   <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage company details for {activeCompany?.legalName}.</p>
                 </div>
                 <div className="flex items-center gap-2">
                   <button
                     type="button"
                     onClick={() => setActiveTab('audit')}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors"
                   >
                     <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> View Company Activity Log
                   </button>
                   {!isAdmin && (
                     <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-semibold rounded-full border border-amber-200 dark:border-amber-800">
                       <Lock className="w-3 h-3" /> Read-Only ({userRole})
                     </span>
                   )}
                 </div>
               </div>

               {companyMsg && (
                 <div className={`p-3 rounded-lg text-sm ${companyMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                   {companyMsg.text}
                 </div>
               )}

               <form onSubmit={handleSaveCompany} className="space-y-6 max-w-2xl">
                 {/* Read-Only Unique Company ID */}
                 <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Unique Company ID (Immutable Read-Only)
                    </label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        readOnly 
                        disabled
                        value={activeCompany?.id || companyDetails?.id || ''} 
                        className="flex-1 px-3 py-2 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none"
                      />
                      <button 
                        type="button"
                        onClick={() => navigator.clipboard.writeText(activeCompany?.id || companyDetails?.id || '')}
                        className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-300 transition-colors"
                      >
                        Copy ID
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">This ID is permanently bound to this company's isolated database environment.</p>
                 </div>

                 {/* Identity & Contacts */}
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Legal Name</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={legalName} 
                        onChange={e => setLegalName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Trade Name / Brand</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={tradeName} 
                        onChange={e => setTradeName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">TIN</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={tin} 
                        onChange={e => setTin(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Branch Code</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={branchCode} 
                        onChange={e => setBranchCode(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Industry</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={industry} 
                        onChange={e => setIndustry(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Person</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={contactPerson} 
                        onChange={e => setContactPerson(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Email</label>
                      <input 
                        type="email" 
                        disabled={!isAdmin} 
                        value={contactEmail} 
                        onChange={e => setContactEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Phone</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={contactPhone} 
                        onChange={e => setContactPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                 </div>

                 <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Business Address</label>
                    <textarea 
                      disabled={!isAdmin} 
                      value={address} 
                      onChange={e => setAddress(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                    />
                 </div>

                 {/* Tax & BIR Profile */}
                 <div className="border-t border-slate-200 dark:border-slate-700 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Taxpayer Classification</label>
                      <select 
                        disabled={!isAdmin}
                        value={taxpayerClassification} 
                        onChange={e => {
                          const selectedClass = e.target.value;
                          setTaxpayerClassification(selectedClass);
                          setVatStatus(getDefaultVatStatusForClassification(selectedClass));
                        }}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                      >
                        <option value="CORPORATION">Domestic Corporation</option>
                        <option value="INDIVIDUAL">Individual / Sole Proprietorship</option>
                        <option value="OPC">One Person Corporation (OPC)</option>
                        <option value="PARTNERSHIP">General Partnership (Commercial)</option>
                        <option value="GPP">General Professional Partnership (GPP)</option>
                        <option value="COOPERATIVE">Cooperative</option>
                        <option value="NON_PROFIT">Non-Profit / Non-Stock Corporation</option>
                        <option value="GOCC">Government Entity / GOCC</option>
                      </select>
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">VAT Status</label>
                      <select 
                        disabled={!isAdmin}
                        value={vatStatus} 
                        onChange={e => setVatStatus(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                      >
                        <option value="VAT">Value-Added Tax (VAT) Registered - 12%</option>
                        <option value="NON_VAT">Non-VAT Registered (Percentage Tax - Form 2551Q / 3%)</option>
                        <option value="EXEMPT">VAT Exempt / Non-Taxable Seller</option>
                        <option value="BMBE">BMBE Registered (Barangay Micro Business Enterprise)</option>
                        <option value="PEZA_BOI">PEZA / BOI Registered (Ecozone Tax Exempt)</option>
                        <option value="ZERO_RATED">Zero-Rated / Exempt Export Taxpayer (0% VAT)</option>
                      </select>
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">RDO Code</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={rdoCode} 
                        onChange={e => setRdoCode(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">BIR Registration No. (COR)</label>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={birRegistrationNo} 
                        onChange={e => setBirRegistrationNo(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                 </div>

                 {/* Storage & Backup Paths */}
                 <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4">
                   <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Document Storage Directory Path</label>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setShowSettingsExplorer('document')}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                          >
                            <Server className="w-3.5 h-3.5" /> Browse Folder...
                          </button>
                        )}
                      </div>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={documentLocationPath} 
                        onChange={e => setDocumentLocationPath(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                   <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Backup Directory Path</label>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setShowSettingsExplorer('backup')}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                          >
                            <Server className="w-3.5 h-3.5" /> Browse Folder...
                          </button>
                        )}
                      </div>
                      <input 
                        type="text" 
                        disabled={!isAdmin} 
                        value={backupLocationPath} 
                        onChange={e => setBackupLocationPath(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200" 
                      />
                   </div>
                 </div>

                 {/* Directory Explorer Modal for Settings */}
                 <DirectoryExplorerModal 
                   isOpen={showSettingsExplorer !== null}
                   onClose={() => setShowSettingsExplorer(null)}
                   initialPath={
                     showSettingsExplorer === 'document'
                       ? documentLocationPath
                       : showSettingsExplorer === 'backup'
                       ? backupLocationPath
                       : '/data/companies'
                   }
                   title={
                     showSettingsExplorer === 'document'
                       ? "Browse & Select Document Storage Folder"
                       : "Browse & Select Backup Directory Folder"
                   }
                   companyName={legalName || activeCompany?.legalName}
                   onSelectPath={(selectedPath) => {
                     if (showSettingsExplorer === 'document') {
                       setDocumentLocationPath(selectedPath);
                     } else if (showSettingsExplorer === 'backup') {
                       setBackupLocationPath(selectedPath);
                     }
                   }}
                 />
                 
                 <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                    {isAdmin ? (
                      <button 
                        type="submit" 
                        disabled={isSavingCompany}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                      >
                        {isSavingCompany && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Company Settings
                      </button>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        Editing company settings requires a <strong>Company Administrator</strong> or higher role. You currently hold the <strong>{userRole}</strong> role.
                      </p>
                    )}
                 </div>
               </form>
            </div>

            {/* LICENSING SECTION */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-6">
               <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                    <Key className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> Company License
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage cryptographic license activation for this company profile.</p>
                </div>
               
               <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Unique Company ID (Read-only)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        readOnly 
                        disabled
                        value={activeCompany?.id || ''} 
                        className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none cursor-not-allowed"
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          if (activeCompany?.id) {
                            navigator.clipboard.writeText(activeCompany.id);
                            setCopiedCompanyId(true);
                            setTimeout(() => setCopiedCompanyId(false), 2000);
                          }
                        }}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex items-center gap-1.5"
                      >
                        {copiedCompanyId ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedCompanyId ? 'Copied!' : 'Copy ID'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">This ID is automatically generated and immutable. Provide this to your License Authority.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">License Status</label>
                    {(() => {
                      const canonical = getCanonicalLicenseState(licenseStatus);
                      let badgeStyle = 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400';
                      let text = 'NOT ACTIVATED';
                      let Icon = AlertCircle;

                      if (canonical === 'ACTIVATED') {
                        badgeStyle = 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400';
                        text = `ACTIVATED (${licenseStatus?.planType || 'PRO'} PLAN)`;
                        Icon = CheckCircle2;
                      } else if (canonical === 'REACTIVATION REQUIRED') {
                        badgeStyle = 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-400';
                        text = 'REACTIVATION REQUIRED (HARDWARE CHANGE)';
                        Icon = AlertCircle;
                      } else if (canonical === 'EXPIRED') {
                        badgeStyle = 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400';
                        text = 'EXPIRED';
                        Icon = AlertCircle;
                      } else if (canonical === 'REVOKED') {
                        badgeStyle = 'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/40 dark:border-rose-800 dark:text-rose-300';
                        text = 'REVOKED';
                        Icon = AlertCircle;
                      }

                      let daysRemaining: number | null = null;
                      const isLifetime = Boolean(
                        licenseStatus?.isLifetime === true ||
                        licenseStatus?.isLifetime === 'true' ||
                        licenseStatus?.expirationDate === 'LIFETIME'
                      );

                      if (licenseStatus?.expirationDate && !isLifetime && typeof licenseStatus.expirationDate === 'string' && licenseStatus.expirationDate !== 'LIFETIME') {
                        try {
                          const expDate = new Date(licenseStatus.expirationDate);
                          if (!isNaN(expDate.getTime())) {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const expZero = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());
                            const diffMs = expZero.getTime() - today.getTime();
                            daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                          }
                        } catch (err) {
                          daysRemaining = null;
                        }
                      }

                      const isExpiringSoon = 
                        canonical === 'ACTIVATED' &&
                        !isLifetime &&
                        daysRemaining !== null &&
                        !isNaN(daysRemaining) &&
                        daysRemaining >= 0 && 
                        daysRemaining <= 30;

                      return (
                        <div className="space-y-2">
                          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${badgeStyle}`}>
                            <Icon className="w-4 h-4" />
                            {text}
                          </div>
                          {licenseStatus?.expirationDate && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Expiration Date: <span className="font-semibold">{licenseStatus.expirationDate}</span> {licenseStatus.isLifetime ? '(Lifetime License)' : ''}
                            </p>
                          )}
                          {isExpiringSoon && (
                            <div id="license-expiration-alert" className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 flex items-start gap-3 mt-2">
                              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-100">License Expiring Soon</h4>
                                <p className="text-xs mt-0.5 leading-relaxed">
                                  Your active license will expire in <span className="font-bold">{daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}</span> (on {licenseStatus.expirationDate}). Please contact your License Authority or import a new license key before expiration to avoid interruption.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
               </div>

               <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                 <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 mb-4">Import Cryptographic License</h3>
                 <LicenseActivation onSuccess={() => fetchLicenseStatus()} />
               </div>
            </div>
            </>
          )}
          
          {activeTab === 'roles' && showRoles && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-8">
               <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                 <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                   <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Role-Based Access Control (RBAC) Matrix
                 </h2>
                 <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                   Company data access is partitioned into eight standardized security tiers.
                 </p>
               </div>

               {/* Role Definition Matrix Cards */}
               
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <div className="p-4 rounded-xl border border-violet-200 dark:border-violet-800/50 bg-violet-50/40 dark:bg-violet-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-violet-900 dark:text-violet-300">Company Owner</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Protected company ownership. Full system access.</p>
                 </div>
                 
                 <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50/40 dark:bg-purple-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-purple-900 dark:text-purple-300">Company Administrator</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Administrative company & user management.</p>
                 </div>
                 
                 <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50/40 dark:bg-blue-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-blue-900 dark:text-blue-300">Approver</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Transaction approval authority.</p>
                 </div>
                 
                 <div className="p-4 rounded-xl border border-cyan-200 dark:border-cyan-800/50 bg-cyan-50/40 dark:bg-cyan-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-cyan-900 dark:text-cyan-300">Reviewer</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Transaction/document review.</p>
                 </div>
                 
                 <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-emerald-900 dark:text-emerald-300">Accountant</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Accounting operations & general ledger access.</p>
                 </div>
                 
                 <div className="p-4 rounded-xl border border-teal-200 dark:border-teal-800/50 bg-teal-50/40 dark:bg-teal-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-teal-900 dark:text-teal-300">Bookkeeper</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Bookkeeping & basic transaction entry.</p>
                 </div>
                 

                 <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-amber-900 dark:text-amber-300">Auditor</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">Audit & compliance read-only access.</p>
                 </div>
                 
                 <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800/50 bg-slate-50/40 dark:bg-slate-950/20 space-y-2">
                   <div className="flex items-center justify-between">
                     <span className="font-bold text-sm text-slate-900 dark:text-slate-300">Read-only User</span>
                   </div>
                   <p className="text-xs text-slate-600 dark:text-slate-300">View-only access. No modifications.</p>
                 </div>
               </div>


               {/* Team Members List */}
               <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                 <div className="flex items-center justify-between">
                   <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                     <Users className="w-4 h-4 text-indigo-600" /> Company Members
                   </h3>
                   {isAdmin ? (
                     <button type="button" onClick={() => setShowAddMember(true)} className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-medium rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors">
                       + Add Member
                     </button>
                   ) : (
                     <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                       <AlertCircle className="w-3.5 h-3.5" /> Company Administrators can reassign member roles
                     </span>
                   )}
                 </div>

                 {roleMsg && (
                   <div className={`p-3 rounded-lg text-sm ${roleMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                     {roleMsg.text}
                   </div>
                 )}

                  {loadingMembers ? (
                    <div className="py-8 text-center text-slate-400">Loading members...</div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800 shadow-sm">
                      {members.map(m => (
                        <div key={m.userId || m.membershipId} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-750 transition-colors">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{m.displayName}</p>
                              {m.status === 'DISABLED' ? (
                                <span className="text-[10px] bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800 px-2 py-0.5 rounded-full font-bold">
                                  DISABLED
                                </span>
                              ) : (
                                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full font-semibold">
                                  ACTIVE
                                </span>
                              )}
                              {m.userId === user?.id && (
                                <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 px-1.5 py-0.5 rounded font-medium">
                                  (You)
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Mail className="w-3.5 h-3.5" /> {m.email}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              {(m.roles && m.roles.length > 0 ? m.roles : [m.role]).map(r => (
                                <div key={r} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 px-2 py-0.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300">
                                  <RoleBadge role={r} />
                                  {isAdmin && (m.roles?.length || 1) > 1 && (
                                    <button
                                      type="button"
                                      title={`Remove role ${r}`}
                                      disabled={updatingUserId === (m.membershipId || m.userId)}
                                      onClick={() => handleRemoveRole(m.membershipId || m.userId, r)}
                                      className="text-slate-400 hover:text-red-500 p-0.5 ml-0.5"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 shrink-0">
                            {isAdmin && (
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  disabled={updatingUserId === m.userId}
                                  value={m.role}
                                  onChange={(e) => handleRoleChange(m, e.target.value as LedgerRole)}
                                  className="text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 font-medium"
                                  title="Change primary role"
                                >
                                  <option value="Company Owner">Company Owner</option>
                                  <option value="Company Administrator">Company Administrator</option>
                                  <option value="Approver">Approver</option>
                                  <option value="Reviewer">Reviewer</option>
                                  <option value="Accountant">Accountant</option>
                                  <option value="Bookkeeper">Bookkeeper</option>
                                  <option value="Auditor">Auditor</option>
                                  <option value="Read-only User">Read-only User</option>
                                </select>

                                <button
                                  type="button"
                                  onClick={() => handleOpenEditMember(m)}
                                  className="px-2.5 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-1 transition-colors"
                                  title="Edit Member Account & Credentials"
                                >
                                  <Edit2 className="w-3.5 h-3.5" /> Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openEditMatrixModal(m)}
                                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg flex items-center gap-1 transition-colors"
                                  title="Fine-tune granular feature permissions"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Permissions
                                </button>

                                {m.userId !== user?.id && (
                                  <>
                                    {/* Member Status Toggle Switch */}
                                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-750 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-650" title="Toggle Member Status (Active/Disabled)">
                                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Status:</span>
                                      <MemberStatusToggle
                                        status={m.status || 'ACTIVE'}
                                        disabled={updatingUserId === m.userId}
                                        isChanging={updatingUserId === m.userId}
                                        onToggle={() => handleOpenStatusModal(m, m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                                        size="sm"
                                      />
                                      <span className={`text-[10px] font-bold ${m.status === 'DISABLED' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        {m.status === 'DISABLED' ? 'Disabled' : 'Active'}
                                      </span>
                                    </div>

                                    {/* Remove Account Button */}
                                    <button
                                      type="button"
                                      disabled={updatingUserId === m.userId}
                                      onClick={() => handleOpenRemoveModal(m)}
                                      className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-1 transition-colors"
                                      title="Remove Member Account from Company"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /> Remove Account
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
             </div>
           )}
          {activeTab === 'periods' && showPeriods && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center py-12">
               <Workflow className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
               <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Accounting Periods</h3>
               <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 max-w-md mx-auto">Manage financial year lock-dates, tax period status, and month-end closing locks.</p>
            </div>
          )}

          {activeTab === 'backup' && showBackup && <BackupManager />}
          {activeTab === 'lan' && showLan && <LanServerDashboard />}
          {activeTab === 'audit' && showAudit && <CompanyAuditPanel />}
          {activeTab === 'email' && showEmail && <EmailSettings />}
          {activeTab === 'ai' && showAi && <AiSettings />}
        </div>
        
        {/* MEMBER STATUS CONFIRMATION MODAL */}
        <StatusConfirmationModal
          isOpen={statusModal.isOpen}
          onClose={() => setStatusModal(prev => ({ ...prev, isOpen: false, member: null }))}
          member={statusModal.member}
          targetStatus={statusModal.targetStatus}
          onConfirm={handleConfirmStatusChange}
          isLoading={isProcessingStatus}
        />

        {/* REMOVE MEMBER ACCOUNT CONFIRMATION MODAL */}
        <RemoveMemberConfirmationModal
          isOpen={removeModal.isOpen}
          onClose={() => setRemoveModal(prev => ({ ...prev, isOpen: false, member: null }))}
          member={removeModal.member}
          companyName={legalName || activeCompany?.legalName}
          onConfirm={handleConfirmRemoveMember}
          isLoading={isProcessingRemove}
        />

        {/* TOAST NOTIFICATION CONTAINER */}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </div>
  );
}

