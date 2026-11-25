import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, Users, CheckCircle2, RefreshCw, 
  Save, Eye, History, Plus, X, Loader2, Power,
  Lock, AlertTriangle, RotateCcw, Search, GitCompare,
  FileCheck2, ShieldAlert, Layers, UserMinus, Crown,
  Edit3, Copy, Trash2, ArrowUpRight, Sliders
} from 'lucide-react';
import { useAuth, LedgerRole } from '../../context/AuthContext';
import { CANONICAL_ERP_MODULES, PrimaryModuleDefinition } from '../../../shared/moduleRegistry';
import { 
  CANONICAL_ROLES_ORDER, 
  CANONICAL_PERMISSION_CATALOG,
  ROLE_TEMPLATES_CATALOG,
  DATA_SCOPE_LABELS,
  CanonicalDataScope,
  PermissionOrigin
} from '../../../shared/rbacCatalog';
import ExportButton, { ExportData } from '../../components/ExportButton';
import { TableScrollContainer } from '../../components/shared/TableScrollContainer';

const CANONICAL_ROLES: LedgerRole[] = CANONICAL_ROLES_ORDER as LedgerRole[];

const ORIGIN_BADGE_STYLES: Record<PermissionOrigin, { label: string; className: string }> = {
  INHERITED_FROM_ROLE: {
    label: 'INHERITED FROM ROLE',
    className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
  },
  COMBINED_ROLES: {
    label: 'COMBINED FROM MULTIPLE ROLES',
    className: 'bg-violet-100 text-violet-800 dark:bg-violet-950/80 dark:text-violet-300 border border-violet-200 dark:border-violet-800'
  },
  USER_SPECIFIC_GRANT: {
    label: 'USER-SPECIFIC GRANT',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
  },
  USER_SPECIFIC_DENY: {
    label: 'USER-SPECIFIC DENY',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
  },
  SYSTEM_RESTRICTION: {
    label: 'ROLE RESTRICTION',
    className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700'
  },
  SOD_RESTRICTION: {
    label: 'SoD RESTRICTION',
    className: 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
  },
  ACCOUNT_DISABLED: {
    label: 'ACCOUNT DISABLED',
    className: 'bg-rose-600 text-white border border-rose-700'
  }
};

function formatPhpLimit(centavos?: number | null): string {
  if (centavos === -1) return 'Unlimited (Executive Authority)';
  if (!centavos || centavos <= 0) return '₱0.00 (No Approval Authority)';
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RbacMatrixWorkspace() {
  const { user, userRole, refreshSession } = useAuth();
  
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [pendingMemberSwitch, setPendingMemberSwitch] = useState<any | null>(null);

  // New User Provisioning State
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [newUserForm, setNewUserForm] = useState({
    displayName: '',
    email: '',
    password: '',
    role: 'Accountant' as string,
    additionalRoles: [] as string[]
  });

  // Multi-Role Assignment Modal State
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [roleToAdd, setRoleToAdd] = useState<string>('Reviewer');
  const [roleAddPrimary, setRoleAddPrimary] = useState(false);
  const [roleAddEffectiveTo, setRoleAddEffectiveTo] = useState('');
  const [roleAddReason, setRoleAddReason] = useState('');
  const [compatibilityCheck, setCompatibilityCheck] = useState<any | null>(null);

  // Member Lifecycle Modals (Edit, Remove from Company, Transfer Ownership, Removal History)
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [editMemberForm, setEditMemberForm] = useState({
    displayName: '',
    email: '',
    password: ''
  });
  const [showRemoveMemberModal, setShowRemoveMemberModal] = useState(false);
  const [removalReason, setRemovalReason] = useState('');
  const [showTransferOwnershipModal, setShowTransferOwnershipModal] = useState(false);
  const [transferPhrase, setTransferPhrase] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [demoteSelfToAdmin, setDemoteSelfToAdmin] = useState(false);
  const [showRemovalHistoryModal, setShowRemovalHistoryModal] = useState(false);
  const [removalHistoryData, setRemovalHistoryData] = useState<{ removedMembers: any[]; lifecycleEvents: any[] }>({
    removedMembers: [],
    lifecycleEvents: []
  });

  // Authoritative Resolved Access from Backend (/api/rbac/members/:id/module-assignments)
  const [resolvedAccess, setResolvedAccess] = useState<any | null>(null);
  const [assignedModuleIds, setAssignedModuleIds] = useState<string[]>([]);
  const [submoduleMap, setSubmoduleMap] = useState<Record<string, string[]>>({});
  const [actionMap, setActionMap] = useState<Record<string, string[]>>({});
  const [dataScopeMap, setDataScopeMap] = useState<Record<string, CanonicalDataScope>>({});
  const [approvalLimitMap, setApprovalLimitMap] = useState<Record<string, number>>({});
  const [assignmentHistory, setAssignmentHistory] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [updatingRole, setUpdatingRole] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Matrix View Tab: 'MODULES' | 'PREVIEW' | 'ROLE_PERMISSIONS'
  const [activeTab, setActiveTab] = useState<'MODULES' | 'PREVIEW' | 'ROLE_PERMISSIONS'>('MODULES');

  // Tab 2 Interactive Customization Mode
  const [liveCustomizeMode, setLiveCustomizeMode] = useState(false);

  // Tab 3: Role Permissions Catalog, Custom Roles & Compatibility State
  const [matrixData, setMatrixData] = useState<any | null>(null);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [selectedCatalogRole, setSelectedCatalogRole] = useState<string>('Bookkeeper');
  const [catalogViewMode, setCatalogViewMode] = useState<'ROLE_EDITOR' | 'MATRIX_8_ROLES' | 'COMPARE_ROLES' | 'COMPATIBILITY_MATRIX'>('ROLE_EDITOR');
  const [compareRoleB, setCompareRoleB] = useState<string>('Accountant');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogModuleFilter, setCatalogModuleFilter] = useState<string>('ALL');

  // Create / Clone Custom Role Modal State
  const [showCustomRoleModal, setShowCustomRoleModal] = useState(false);
  const [customRoleForm, setCustomRoleForm] = useState({
    roleName: '',
    purpose: '',
    clonedFrom: 'Accountant',
    changeReason: ''
  });

  // New Compatibility Rule Form State
  const [compatRuleForm, setCompatRuleForm] = useState({
    roleA: 'Accountant',
    roleB: 'Reviewer',
    compatibilityType: 'RESTRICTED' as 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED',
    reason: ''
  });

  // Editable Role Template Draft State (Tab 3)
  const [draftRolePurpose, setDraftRolePurpose] = useState('');
  const [draftRoleModules, setDraftRoleModules] = useState<string[]>([]);
  const [draftRoleSubmodules, setDraftRoleSubmodules] = useState<Record<string, string[]>>({});
  const [draftRolePerms, setDraftRolePerms] = useState<string[]>([]);
  const [draftRoleScope, setDraftRoleScope] = useState<CanonicalDataScope>('COMPANY_WIDE');
  const [draftRoleLimitPhp, setDraftRoleLimitPhp] = useState<number>(0);
  const [publishReason, setPublishReason] = useState('');
  const [impactPreview, setImpactPreview] = useState<any | null>(null);
  const [publishingTemplate, setPublishingTemplate] = useState(false);

  const getMemberKey = (m: any): string => m?.membershipId || m?.id || m?.userId || '';

  const allAvailableRoles = useMemo<string[]>(() => {
    const names = new Set<string>(CANONICAL_ROLES);
    if (Array.isArray(matrixData?.roleTemplates)) {
      for (const t of matrixData.roleTemplates) {
        if (t?.roleName) names.add(t.roleName);
      }
    }
    return Array.from(names);
  }, [matrixData]);

  // Fetch company members from authoritative /api/users endpoint
  const fetchMembers = async (preferSelectId?: string) => {
    setLoadingMembers(true);
    try {
      const res = await fetch('/api/users', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.data || data.users || []);
        setMembers(list);
        if (list.length > 0) {
          const target =
            (preferSelectId && list.find((m: any) => getMemberKey(m) === preferSelectId || m.userId === preferSelectId)) ||
            (selectedMember && list.find((m: any) => getMemberKey(m) === getMemberKey(selectedMember))) ||
            list[0];
          if (target) {
            await handleSelectMember(target);
          }
        } else {
          setSelectedMember(null);
          setResolvedAccess(null);
        }
      }
    } catch (e) {
      console.error('Failed to fetch company members:', e);
    } finally {
      setLoadingMembers(false);
    }
  };

  // Fetch Role Permissions Catalog & active versioned templates
  const fetchMatrix = async () => {
    setLoadingMatrix(true);
    try {
      const res = await fetch('/api/rbac/matrix', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMatrixData(data);
      }
    } catch (e) {
      console.error('Failed to fetch RBAC matrix:', e);
    } finally {
      setLoadingMatrix(false);
    }
  };

  const fetchRemovalHistory = async () => {
    try {
      const res = await fetch('/api/users/removal-history', { credentials: 'include' });
      if (res.ok) {
        setRemovalHistoryData(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch removal history:', e);
    }
  };

  useEffect(() => {
    fetchMembers();
    fetchMatrix();
  }, []);

  // Unsaved changes warning (Scenario 25)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const getRoleTemplateByName = (rName: string) => {
    const fromApi = matrixData?.roleTemplates?.find((t: any) => t.roleName === rName);
    return fromApi || (ROLE_TEMPLATES_CATALOG as any)[rName] || ROLE_TEMPLATES_CATALOG['Read-only User'];
  };

  // Load selected role template into Tab 3 editor whenever selectedCatalogRole or matrixData changes
  const activeRoleTemplate = useMemo(() => {
    return getRoleTemplateByName(selectedCatalogRole);
  }, [matrixData, selectedCatalogRole]);

  useEffect(() => {
    if (activeRoleTemplate) {
      setDraftRolePurpose(activeRoleTemplate.purpose || '');
      setDraftRoleModules(activeRoleTemplate.defaultPrimaryModules || []);
      setDraftRoleSubmodules(activeRoleTemplate.defaultSubmodules || {});
      setDraftRolePerms(activeRoleTemplate.defaultPermissionCodes || []);
      setDraftRoleScope((activeRoleTemplate.defaultDataScope as CanonicalDataScope) || 'COMPANY_WIDE');
      setDraftRoleLimitPhp(
        activeRoleTemplate.defaultApprovalLimitCentavos === -1
          ? -1
          : Math.round((activeRoleTemplate.defaultApprovalLimitCentavos || 0) / 100)
      );
      setImpactPreview(null);
      setPublishReason('');
    }
  }, [activeRoleTemplate]);

  const handleSelectMember = async (member: any, bypassDirtyCheck = false) => {
    if (isDirty && !bypassDirtyCheck) {
      setPendingMemberSwitch(member);
      return;
    }
    setPendingMemberSwitch(null);
    setSelectedMember(member);
    setReason('');
    setIsDirty(false);
    const memberId = getMemberKey(member);
    if (!memberId) return;
    
    try {
      const res = await fetch(`/api/rbac/members/${memberId}/module-assignments`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAssignmentHistory(data.history || []);
        const resolved = data.resolvedAccess;
        setResolvedAccess(resolved || null);

        const roleName: string = resolved?.primaryRole || member.role || 'Read-only User';
        const roleTpl = getRoleTemplateByName(roleName);

        if (resolved && Array.isArray(resolved.moduleResolutions)) {
          const assignments = data.assignments || [];
          const allowedMods = resolved.effectiveAccountActive
            ? resolved.effectiveModuleIds
            : assignments.filter((a: any) => a.effect !== 'DENY').map((a: any) => a.moduleId);

          setAssignedModuleIds(allowedMods);

          const scopes: Record<string, CanonicalDataScope> = {};
          const limits: Record<string, number> = {};
          const subs: Record<string, string[]> = {};
          const acts: Record<string, string[]> = {};

          for (const mod of CANONICAL_ERP_MODULES) {
            const mr = resolved.moduleResolutions.find((r: any) => r.moduleId === mod.id);
            const row = assignments.find((a: any) => a.moduleId === mod.id);
            scopes[mod.id] = (row?.dataScope || mr?.dataScope || roleTpl.defaultDataScope) as CanonicalDataScope;
            const limitCentavos = row?.approvalLimitCentavos ?? mr?.approvalLimitCentavos ?? roleTpl.defaultApprovalLimitCentavos;
            limits[mod.id] = limitCentavos > 0 ? limitCentavos / 100 : 0;

            // Strict Submodules Resolution
            if (row && row.submoduleIds !== undefined && row.submoduleIds !== null) {
              try {
                subs[mod.id] = Array.isArray(row.submoduleIds) ? row.submoduleIds : JSON.parse(row.submoduleIds);
              } catch {
                subs[mod.id] = [];
              }
            } else if (mr && Array.isArray(mr.allowedSubmoduleIds)) {
              subs[mod.id] = mr.allowedSubmoduleIds;
            } else {
              subs[mod.id] = roleTpl.defaultSubmodules[mod.id] || mod.submodules.map(s => s.id);
            }

            // Strict Actions Resolution
            if (row && row.actions !== undefined && row.actions !== null) {
              try {
                acts[mod.id] = Array.isArray(row.actions) ? row.actions : JSON.parse(row.actions);
              } catch {
                acts[mod.id] = [];
              }
            } else if (mr && Array.isArray(mr.allowedActions)) {
              acts[mod.id] = mr.allowedActions;
            } else {
              const modPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === mod.id);
              const unionActs = new Set<string>(['view']);
              for (const p of modPerms) {
                if (roleTpl.defaultPermissionCodes.includes('*') || roleTpl.defaultPermissionCodes.includes(p.code)) {
                  unionActs.add(p.action);
                }
              }
              acts[mod.id] = Array.from(unionActs);
            }
          }
          setDataScopeMap(scopes);
          setApprovalLimitMap(limits);
          setSubmoduleMap(subs);
          setActionMap(acts);
          setIsDirty(false);
        } else {
          setAssignedModuleIds(roleTpl.defaultPrimaryModules);
          const scopes: Record<string, CanonicalDataScope> = {};
          const limits: Record<string, number> = {};
          const subs: Record<string, string[]> = {};
          const acts: Record<string, string[]> = {};
          for (const mod of CANONICAL_ERP_MODULES) {
            scopes[mod.id] = roleTpl.defaultDataScope;
            limits[mod.id] = roleTpl.defaultApprovalLimitCentavos > 0 ? roleTpl.defaultApprovalLimitCentavos / 100 : 0;
            subs[mod.id] = roleTpl.defaultSubmodules[mod.id] || mod.submodules.map(s => s.id);
            const modPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === mod.id);
            const unionActs = new Set<string>(['view']);
            for (const p of modPerms) {
              if (roleTpl.defaultPermissionCodes.includes('*') || roleTpl.defaultPermissionCodes.includes(p.code)) {
                unionActs.add(p.action);
              }
            }
            acts[mod.id] = Array.from(unionActs);
          }
          setDataScopeMap(scopes);
          setApprovalLimitMap(limits);
          setSubmoduleMap(subs);
          setActionMap(acts);
          setIsDirty(false);
        }
      }
    } catch (e) {
      console.error('Failed to load member module assignments:', e);
    }
  };

  // Validate compatibility dynamically when choosing an additional role
  useEffect(() => {
    if (!showAddRoleModal || !selectedMember) return;
    const currentRoles: string[] = resolvedAccess?.assignedRoles || selectedMember.assignedRoles || [selectedMember.role];
    const nextRoles = Array.from(new Set([...currentRoles, roleToAdd]));
    fetch('/api/rbac/validate-compatibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roles: nextRoles })
    })
      .then(r => r.json())
      .then(data => setCompatibilityCheck(data))
      .catch(() => setCompatibilityCheck(null));
  }, [showAddRoleModal, roleToAdd, selectedMember, resolvedAccess]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingUser(true);
    setAddUserError('');
    const createdName = newUserForm.displayName.trim();
    const allRolesToAssign = Array.from(new Set([newUserForm.role, ...newUserForm.additionalRoles]));
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          displayName: newUserForm.displayName,
          email: newUserForm.email,
          password: newUserForm.password,
          role: newUserForm.role,
          roles: allRolesToAssign
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddUserModal(false);
        setNewUserForm({
          displayName: '',
          email: '',
          password: '',
          role: 'Accountant',
          additionalRoles: []
        });
        await fetchMembers(data.membershipId || data.id || data.userId);
        setStatusMsg({
          type: 'success',
          text: `User "${createdName}" created with role(s): [${allRolesToAssign.join(', ')}].`
        });
      } else {
        setAddUserError(data.message || 'Failed to create user account');
      }
    } catch (err: any) {
      setAddUserError(err.message || 'Network error occurred');
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleAssignAdditionalRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;
    const memberId = getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/members/${memberId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          roleName: roleToAdd,
          isPrimary: roleAddPrimary,
          effectiveTo: roleAddEffectiveTo || null,
          reason: roleAddReason || `Assigned role ${roleToAdd} via RBAC Workspace`
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to assign role');
      setShowAddRoleModal(false);
      setRoleAddReason('');
      setRoleAddEffectiveTo('');
      setRoleAddPrimary(false);
      await fetchMembers(memberId);
      await refreshSession();
      setStatusMsg({
        type: 'success',
        text: `Assigned role "${roleToAdd}" to ${selectedMember.displayName || selectedMember.email}. Effective roles: [${(data.assignedRoles || []).join(', ')}].`
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleRevokeMemberRole = async (roleNameToRevoke: string) => {
    if (!selectedMember) return;
    const memberId = getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/members/${memberId}/roles/${encodeURIComponent(roleNameToRevoke)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: `Revoked role ${roleNameToRevoke} via RBAC Workspace`
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to revoke role');
      await fetchMembers(memberId);
      await refreshSession();
      setStatusMsg({
        type: 'success',
        text: `Revoked role "${roleNameToRevoke}". Remaining active roles: [${(data.assignedRoles || []).join(', ')}].`
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleSetPrimaryRole = async (targetPrimaryRole: string) => {
    if (!selectedMember) return;
    const memberId = getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/members/${memberId}/primary-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          roleName: targetPrimaryRole,
          reason: `Promoted ${targetPrimaryRole} to Primary Role`
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update primary role');
      await fetchMembers(memberId);
      await refreshSession();
      setStatusMsg({
        type: 'success',
        text: `Primary role for ${selectedMember.displayName || selectedMember.email} set to "${targetPrimaryRole}".`
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleRoleChange = async (newRole: string) => {
    if (!selectedMember) return;
    setUpdatingRole(true);
    setStatusMsg(null);
    const targetUserId = selectedMember.userId || getMemberKey(selectedMember);
    try {
      const res = await fetch(`/api/users/${targetUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole, roles: [newRole] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update member role');
      await fetchMembers(getMemberKey(selectedMember));
      await refreshSession();
      const modCount = getRoleTemplateByName(newRole)?.defaultPrimaryModules?.length || 0;
      setStatusMsg({
        type: 'success',
        text: `Updated primary role for ${selectedMember.displayName || selectedMember.email} to ${newRole} (${modCount} default modules).`
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleEditMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;
    const targetUserId = selectedMember.userId || getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const payload: any = {
        displayName: editMemberForm.displayName.trim(),
        email: editMemberForm.email.trim()
      };
      if (editMemberForm.password.trim()) {
        payload.password = editMemberForm.password.trim();
      }
      const res = await fetch(`/api/users/${targetUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update member details');
      setShowEditMemberModal(false);
      await fetchMembers(getMemberKey(selectedMember));
      setStatusMsg({ type: 'success', text: `Updated profile details for ${payload.displayName}.` });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleRemoveMemberFromCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;
    const targetUserId = selectedMember.userId || getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/users/${targetUserId}/remove-from-company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: removalReason.trim() || `Removed ${selectedMember.displayName || selectedMember.email} from company`
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to remove member from company');
      setShowRemoveMemberModal(false);
      setRemovalReason('');
      await fetchMembers();
      setStatusMsg({
        type: 'success',
        text: data.message || `Member removed from company. Historical transactions and audit logs preserved.`
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleTransferOwnershipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;
    const targetUserId = selectedMember.userId || getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/users/${targetUserId}/transfer-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: transferPhrase.trim(),
          reason: transferReason.trim(),
          demoteSelfToAdmin
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to transfer ownership');
      setShowTransferOwnershipModal(false);
      setTransferPhrase('');
      setTransferReason('');
      await fetchMembers(getMemberKey(selectedMember));
      await refreshSession();
      setStatusMsg({ type: 'success', text: data.message });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleResetToRoleDefault = async () => {
    if (!selectedMember) return;
    const memberId = getMemberKey(selectedMember);
    setSavingAssignments(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/members/${memberId}/reset-to-role-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: reason || `Reset ${selectedMember.displayName || selectedMember.email} to role default template(s)`
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to reset to role default');
      await fetchMembers(memberId);
      await refreshSession();
      setStatusMsg({ type: 'success', text: data.message });
      setReason('');
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setSavingAssignments(false);
    }
  };

  const handleToggleMemberStatus = async () => {
    if (!selectedMember) return;
    const nextStatus = selectedMember.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    const targetUserId = selectedMember.userId || getMemberKey(selectedMember);
    setUpdatingRole(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/users/${targetUserId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus, reason: `Status toggled to ${nextStatus} in RBAC Matrix` })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update member status');
      await fetchMembers(getMemberKey(selectedMember));
      setStatusMsg({
        type: 'success',
        text: nextStatus === 'DISABLED'
          ? `User ${selectedMember.displayName || selectedMember.email} is now DISABLED. All active sessions invalidated and all 16 modules locked.`
          : `User ${selectedMember.displayName || selectedMember.email} is now ACTIVE. Role template permissions restored.`
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingRole(false);
    }
  };

  const memberAssignedRoles: string[] = useMemo(() => {
    if (Array.isArray(resolvedAccess?.assignedRoles) && resolvedAccess.assignedRoles.length > 0) {
      return resolvedAccess.assignedRoles;
    }
    if (Array.isArray(selectedMember?.assignedRoles) && selectedMember.assignedRoles.length > 0) {
      return selectedMember.assignedRoles;
    }
    return [selectedMember?.role || 'Read-only User'];
  }, [resolvedAccess, selectedMember]);

  const memberRoleTemplates = useMemo(() => {
    return memberAssignedRoles.map(rName => getRoleTemplateByName(rName));
  }, [memberAssignedRoles, matrixData]);

  // Asymmetric Owner Protection check: true if target member holds Company Owner and current user is NOT Company Owner
  const isTargetProtectedOwner = useMemo(() => {
    const targetIsOwner = memberAssignedRoles.some(r => r === 'Company Owner');
    return targetIsOwner && userRole !== 'Company Owner';
  }, [memberAssignedRoles, userRole]);

  // Company Owner Unrestricted Policy: Company Owner holds immutable 16/16 full company access
  const isTargetOwnerRole = useMemo(() => {
    return memberAssignedRoles.some(r => r === 'Company Owner');
  }, [memberAssignedRoles]);

  const isMatrixControlsLocked = isTargetProtectedOwner || isTargetOwnerRole;

  const toggleModuleAssignment = (modId: string) => {
    if (isTargetProtectedOwner) {
      setStatusMsg({
        type: 'error',
        text: 'PERMISSION_DENIED: Company Administrators cannot modify a Company Owner’s module assignments.'
      });
      return;
    }
    if (isTargetOwnerRole) {
      setStatusMsg({
        type: 'error',
        text: 'OWNER_UNRESTRICTED_POLICY: Active Company Owner permanently holds unrestricted access to all 16 modules & 36 submodules.'
      });
      return;
    }

    const isHardRestrictedInAll = memberRoleTemplates.every(t => (t.hardRestrictedModuleIds || []).includes(modId));
    if (isHardRestrictedInAll) {
      setStatusMsg({
        type: 'error',
        text: `Security Restriction: "${modId}" is hard-restricted across [${memberAssignedRoles.join(', ')}] and cannot be assigned without adding a compatible role that permits it.`
      });
      return;
    }

    setIsDirty(true);
    if (assignedModuleIds.includes(modId)) {
      setAssignedModuleIds(assignedModuleIds.filter(id => id !== modId));
    } else {
      setAssignedModuleIds([...assignedModuleIds, modId]);
      const mod = CANONICAL_ERP_MODULES.find(m => m.id === modId);
      if (mod && (!submoduleMap[modId] || submoduleMap[modId].length === 0)) {
        const unionSubs = new Set<string>();
        for (const t of memberRoleTemplates) {
          const sList = t.defaultSubmodules?.[modId] || [];
          sList.forEach((s: string) => unionSubs.add(s));
        }
        setSubmoduleMap({
          ...submoduleMap,
          [modId]: unionSubs.size > 0 ? Array.from(unionSubs) : mod.submodules.map(s => s.id)
        });
      }
      if (mod && (!actionMap[modId] || actionMap[modId].length === 0)) {
        const modPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === modId);
        const unionActs = new Set<string>(['view']);
        for (const t of memberRoleTemplates) {
          for (const p of modPerms) {
            if (t.defaultPermissionCodes.includes('*') || t.defaultPermissionCodes.includes(p.code)) {
              unionActs.add(p.action);
            }
          }
        }
        setActionMap({
          ...actionMap,
          [modId]: Array.from(unionActs)
        });
      }
    }
  };

  const toggleSubmoduleAssignment = (modId: string, subId: string) => {
    if (isMatrixControlsLocked) return;
    setIsDirty(true);
    const current = submoduleMap[modId] || [];
    const next = current.includes(subId)
      ? current.filter(id => id !== subId)
      : [...current, subId];
    setSubmoduleMap({ ...submoduleMap, [modId]: next });
  };

  const toggleActionAssignment = (modId: string, act: string) => {
    if (isMatrixControlsLocked) return;
    setIsDirty(true);
    const current = actionMap[modId] || [];
    const next = current.includes(act)
      ? current.filter(a => a !== act)
      : [...current, act];
    setActionMap({ ...actionMap, [modId]: next });
  };

  const handleSaveAssignments = async () => {
    if (!selectedMember) return;
    const memberId = getMemberKey(selectedMember);
    setSavingAssignments(true);
    setStatusMsg(null);

    try {
      const payload = {
        reason: reason.trim() || `Updated module assignments for ${selectedMember.displayName || selectedMember.email}`,
        expectedUpdatedAt: selectedMember.updatedAt || resolvedAccess?.updatedAt,
        moduleAssignments: assignedModuleIds.map(modId => ({
          moduleId: modId,
          submoduleIds: submoduleMap[modId] !== undefined ? submoduleMap[modId] : CANONICAL_ERP_MODULES.find(m => m.id === modId)?.submodules.map(s => s.id) || [],
          actions: actionMap[modId] !== undefined ? actionMap[modId] : ['view'],
          dataScope: dataScopeMap[modId] || 'COMPANY_WIDE',
          approvalLimitCentavos: Math.round((approvalLimitMap[modId] || 0) * 100)
        }))
      };

      const res = await fetch(`/api/rbac/members/${memberId}/module-assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update module assignments');

      const persistedEffectiveIds: string[] = Array.isArray(data.resolvedAccess?.effectiveModuleIds)
        ? data.resolvedAccess.effectiveModuleIds
        : assignedModuleIds;
      if (data.resolvedAccess) {
        setResolvedAccess(data.resolvedAccess);
        setAssignedModuleIds(persistedEffectiveIds);
      }
      setIsDirty(false);
      await fetchMembers(memberId);
      await refreshSession();
      setStatusMsg({
        type: 'success',
        text: `Module assignments and provenance saved for ${selectedMember.displayName || selectedMember.email} (${persistedEffectiveIds.length} / 16 modules).`
      });
      setReason('');
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setSavingAssignments(false);
    }
  };

  // Tab 3 Handlers: Preview, Publish, Rollback, Custom Role, Compatibility Rule
  const handlePreviewTemplateImpact = async () => {
    try {
      const res = await fetch(`/api/rbac/role-templates/${encodeURIComponent(selectedCatalogRole)}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          defaultPrimaryModules: draftRoleModules,
          defaultSubmodules: draftRoleSubmodules,
          defaultPermissionCodes: draftRolePerms,
          defaultDataScope: draftRoleScope,
          defaultApprovalLimitCentavos: draftRoleLimitPhp === -1 ? -1 : Math.round(draftRoleLimitPhp * 100)
        })
      });
      if (res.ok) {
        setImpactPreview(await res.json());
      }
    } catch (e) {
      console.error('Failed to preview role template impact:', e);
    }
  };

  const handlePublishRoleTemplate = async () => {
    if (!publishReason.trim()) {
      setStatusMsg({ type: 'error', text: 'Please enter a mandatory Change Reason / Justification before publishing a new Role Template version.' });
      return;
    }
    setPublishingTemplate(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/role-templates/${encodeURIComponent(selectedCatalogRole)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          purpose: draftRolePurpose,
          defaultPrimaryModules: draftRoleModules,
          defaultSubmodules: draftRoleSubmodules,
          defaultPermissionCodes: draftRolePerms,
          defaultDataScope: draftRoleScope,
          defaultApprovalLimitCentavos: draftRoleLimitPhp === -1 ? -1 : Math.round(draftRoleLimitPhp * 100),
          changeReason: publishReason.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to publish role template');
      await fetchMatrix();
      await fetchMembers(selectedMember ? getMemberKey(selectedMember) : undefined);
      await refreshSession();
      setImpactPreview(null);
      setPublishReason('');
      setStatusMsg({ type: 'success', text: data.message });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setPublishingTemplate(false);
    }
  };

  const handleRollbackRoleTemplate = async (versionNumber: number) => {
    setPublishingTemplate(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/role-templates/${encodeURIComponent(selectedCatalogRole)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetVersionNumber: versionNumber,
          reason: `Restored ${selectedCatalogRole} template to v${versionNumber} snapshot`
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to rollback role template');
      await fetchMatrix();
      await fetchMembers(selectedMember ? getMemberKey(selectedMember) : undefined);
      await refreshSession();
      setStatusMsg({ type: 'success', text: data.message });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setPublishingTemplate(false);
    }
  };

  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishingTemplate(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/rbac/custom-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(customRoleForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create custom role');
      setShowCustomRoleModal(false);
      await fetchMatrix();
      setSelectedCatalogRole(data.template?.roleName || customRoleForm.roleName);
      setCustomRoleForm({
        roleName: '',
        purpose: '',
        clonedFrom: 'Accountant',
        changeReason: ''
      });
      setStatusMsg({ type: 'success', text: data.message });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setPublishingTemplate(false);
    }
  };

  const handleArchiveCustomRole = async (roleNameToArchive: string) => {
    setPublishingTemplate(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/rbac/custom-roles/${encodeURIComponent(roleNameToArchive)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: `Archived custom role ${roleNameToArchive}` })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to archive custom role');
      await fetchMatrix();
      setSelectedCatalogRole('Accountant');
      setStatusMsg({ type: 'success', text: data.message });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setPublishingTemplate(false);
    }
  };

  const handleSaveCompatibilityRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishingTemplate(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/rbac/compatibility-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(compatRuleForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update compatibility rule');
      await fetchMatrix();
      setCompatRuleForm({ ...compatRuleForm, reason: '' });
      setStatusMsg({ type: 'success', text: data.message });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setPublishingTemplate(false);
    }
  };

  const exportMatrixData: ExportData = {
    title: 'ERP Multi-Role & Module Assignment Matrix',
    filename: `rbac_matrix_${new Date().toISOString().slice(0, 10)}`,
    headers: ['Member Name', 'Email', 'Primary Role', 'Assigned Roles', 'Template Version', 'Status', 'Effective Visible Modules Count', 'Default Data Scope'],
    rows: members.map(m => [
      m.displayName || m.name || '-',
      m.email || '-',
      m.role || m.roleName || 'Member',
      (m.assignedRoles || m.roles || [m.role]).join(' + '),
      `v${m.roleTemplateVersion || 1}`,
      m.status || 'ACTIVE',
      m.status === 'DISABLED' ? '0 / 16 (DISABLED)' : `${(m.effectiveModuleIds || []).length} / 16`,
      m.defaultDataScope || 'COMPANY_WIDE'
    ])
  };

  const roleHasPerm = (roleName: string, code: string): boolean => {
    const sysMap = matrixData?.systemRolePermissions;
    if (sysMap && sysMap[roleName]) {
      const list = sysMap[roleName];
      return list.includes('*') || list.includes(code);
    }
    const tpl = getRoleTemplateByName(roleName);
    if (tpl) {
      return tpl.defaultPermissionCodes.includes('*') || tpl.defaultPermissionCodes.includes(code);
    }
    return false;
  };

  const filteredCatalogEntries = useMemo(() => {
    return CANONICAL_PERMISSION_CATALOG.filter(entry => {
      if (catalogModuleFilter !== 'ALL' && entry.primaryModuleId !== catalogModuleFilter) return false;
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          entry.code.toLowerCase().includes(q) ||
          entry.name.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q) ||
          entry.resource.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [catalogModuleFilter, catalogSearch]);

  const [catalogPage, setCatalogPage] = useState(0);
  const [catalogPageSize, setCatalogPageSize] = useState(20);

  const pagedCatalogEntries = useMemo(() => {
    return filteredCatalogEntries.slice(catalogPage * catalogPageSize, (catalogPage + 1) * catalogPageSize);
  }, [filteredCatalogEntries, catalogPage, catalogPageSize]);

  const selectedMemberRole: string = resolvedAccess?.primaryRole || selectedMember?.role || 'Read-only User';
  const selectedMemberRoleTpl = getRoleTemplateByName(selectedMemberRole);

  return (
    <div className="space-y-6">
      {/* Title & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#111827] p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Multi-Role Assignments • Full Customization • Owner Protection • Member Lifecycle</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">RBAC & ERP Module Assignment Matrix</h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Authoritative Role Permissions Catalog governing multi-role assignments, custom role templates, asymmetric Owner protection, and 16 ERP modules.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              fetchRemovalHistory();
              setShowRemovalHistoryModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <History className="w-3.5 h-3.5 text-indigo-600" />
            <span>Removal & Lifecycle History</span>
          </button>
          <button
            type="button"
            onClick={() => {
              fetchMembers(selectedMember ? getMemberKey(selectedMember) : undefined);
              fetchMatrix();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Refresh RBAC governance state"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMembers || loadingMatrix ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <ExportButton data={exportMatrixData} />
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
          statusMsg.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' 
            : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }`}>
          <div className="flex items-center gap-2">
            {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{statusMsg.text}</span>
          </div>
          <button type="button" onClick={() => setStatusMsg(null)} className="text-xs opacity-70 hover:opacity-100 px-2">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 dark:border-slate-800 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('MODULES')}
          className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'MODULES'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          1. User Module Assignments & Multi-Role Lifecycle
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('PREVIEW')}
          className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'PREVIEW'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          2. Live User Access Preview & Interactive Matrix
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ROLE_PERMISSIONS')}
          className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'ROLE_PERMISSIONS'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          3. Role Permissions Catalog & Compatibility Matrix
        </button>
      </div>

      {/* TAB 1: User Module Assignments & Multi-Role Lifecycle */}
      {activeTab === 'MODULES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Member Selection Panel */}
          <div className="lg:col-span-4 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                Company Users & Members ({members.length})
              </h3>
              <button
                type="button"
                onClick={() => { setShowAddUserModal(true); setAddUserError(''); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New User</span>
              </button>
            </div>
            
            {loadingMembers ? (
              <div className="p-8 text-center text-slate-400 text-xs">Loading members...</div>
            ) : members.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                No company users found. Click <strong>+ New User</strong> to provision an account.
              </div>
            ) : (
              <div className="space-y-2 max-h-[640px] overflow-y-auto">
                {members.map(m => {
                  const mKey = getMemberKey(m);
                  const isSelected = getMemberKey(selectedMember) === mKey;
                  const isDisabled = m.status === 'DISABLED';
                  const mRole: string = m.role || m.roleName || 'Read-only User';
                  const mRoles: string[] = Array.isArray(m.assignedRoles) && m.assignedRoles.length > 0
                    ? m.assignedRoles
                    : (Array.isArray(m.roles) && m.roles.length > 0 ? m.roles : [mRole]);
                  const extraCount = Math.max(0, mRoles.length - 1);
                  const defaultCount = getRoleTemplateByName(mRole)?.defaultPrimaryModules?.length || 0;
                  const effectiveCount = isDisabled ? 0 : (Array.isArray(m.effectiveModuleIds) ? m.effectiveModuleIds.length : defaultCount);

                  return (
                    <button
                      key={mKey}
                      type="button"
                      onClick={() => { setStatusMsg(null); handleSelectMember(m); }}
                      className={`w-full p-3 rounded-xl text-left transition-all border ${
                        isSelected 
                          ? 'bg-indigo-50/80 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-800 shadow-2xs' 
                          : 'bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/80 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                          {mRoles.includes('Company Owner') && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                          <span className="truncate">{m.displayName || m.email}</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {isDisabled && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                              DISABLED
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                            {mRole}
                          </span>
                          {extraCount > 0 && (
                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300">
                              +{extraCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
                        <span className="truncate">{m.email}</span>
                        <span className="font-semibold text-slate-600 dark:text-slate-300 shrink-0 ml-2">
                          {isDisabled ? '0 / 16 (Locked)' : `${effectiveCount} / 16 Modules`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Module Assignment Matrix & Multi-Role Panel */}
          <div className="lg:col-span-8 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            {selectedMember ? (
              <>
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                        Module Assignment Matrix — <span className="text-indigo-600 dark:text-indigo-400">{selectedMember.displayName || selectedMember.email}</span>
                      </h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        Template v{resolvedAccess?.roleTemplateVersion || 1}
                      </span>
                      {isTargetProtectedOwner && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                          <Crown className="w-3 h-3" />
                          <span>Protected Company Owner</span>
                        </span>
                      )}
                    </div>

                    {/* Member Lifecycle Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 mt-2.5 text-xs">
                      <button
                        type="button"
                        disabled={isTargetProtectedOwner || updatingRole}
                        onClick={() => {
                          setEditMemberForm({
                            displayName: selectedMember.displayName || '',
                            email: selectedMember.email || '',
                            password: ''
                          });
                          setShowEditMemberModal(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit Member</span>
                      </button>

                      {selectedMember.userId !== user?.id && (
                        <button
                          type="button"
                          disabled={updatingRole || isTargetProtectedOwner}
                          onClick={handleToggleMemberStatus}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-40 ${
                            selectedMember.status === 'DISABLED'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                              : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          <span>{selectedMember.status === 'DISABLED' ? 'Reactivate Account' : 'Disable Account'}</span>
                        </button>
                      )}

                      {selectedMember.userId !== user?.id && (
                        <button
                          type="button"
                          disabled={updatingRole || isTargetProtectedOwner}
                          onClick={() => {
                            setRemovalReason('');
                            setShowRemoveMemberModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-40"
                        >
                          <UserMinus className="w-3 h-3" />
                          <span>Remove from Company</span>
                        </button>
                      )}

                      {userRole === 'Company Owner' && !memberAssignedRoles.includes('Company Owner') && (
                        <button
                          type="button"
                          disabled={updatingRole}
                          onClick={() => {
                            setTransferPhrase('');
                            setTransferReason('');
                            setDemoteSelfToAdmin(false);
                            setShowTransferOwnershipModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100"
                        >
                          <Crown className="w-3 h-3" />
                          <span>Grant / Transfer Ownership</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResetToRoleDefault}
                      disabled={savingAssignments || isTargetProtectedOwner}
                      className="px-3 py-2 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-40"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset to Role Default</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAssignments}
                      disabled={savingAssignments || isTargetProtectedOwner}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingAssignments ? 'Saving...' : 'Save Module Assignments'}</span>
                    </button>
                  </div>
                </div>

                {/* Multi-Role Assignment Governance Bar */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                        Assigned Company Roles ({memberAssignedRoles.length}):
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Effective Modules: <strong className="text-slate-900 dark:text-slate-100">{assignedModuleIds.length} / 16</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Member Role"
                        disabled={updatingRole || isTargetProtectedOwner}
                        value={selectedMemberRole}
                        onChange={e => handleRoleChange(e.target.value)}
                        className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 disabled:opacity-50"
                      >
                        {allAvailableRoles.map(r => (
                          <option key={r} value={r} disabled={r === 'Company Owner' && userRole !== 'Company Owner'}>
                            Switch Single Primary Role: {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={updatingRole || isTargetProtectedOwner}
                        onClick={() => {
                          setRoleToAdd('Reviewer');
                          setRoleAddPrimary(false);
                          setRoleAddReason('');
                          setShowAddRoleModal(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Compatible Role</span>
                      </button>
                    </div>
                  </div>

                  {/* Active Role Badges with Primary / Additional Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {memberAssignedRoles.map((rName, idx) => {
                      const isPrimary = idx === 0 || rName === resolvedAccess?.primaryRole;
                      const ver = resolvedAccess?.activeRoleTemplateVersions?.[rName] || 1;
                      return (
                        <div
                          key={rName}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${
                            isPrimary
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                              : 'bg-violet-50 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 border-violet-200 dark:border-violet-800'
                          }`}
                        >
                          <span>{rName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            isPrimary ? 'bg-indigo-800 text-indigo-100' : 'bg-violet-200/70 dark:bg-violet-900 text-violet-800 dark:text-violet-200'
                          }`}>
                            {isPrimary ? `PRIMARY • v${ver}` : `ADDITIONAL • v${ver}`}
                          </span>
                          {!isPrimary && !isTargetProtectedOwner && (
                            <button
                              type="button"
                              onClick={() => handleSetPrimaryRole(rName)}
                              title={`Promote ${rName} to Primary Role`}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 hover:bg-white font-extrabold"
                            >
                              Make Primary
                            </button>
                          )}
                          {memberAssignedRoles.length > 1 && !isTargetProtectedOwner && (
                            <button
                              type="button"
                              onClick={() => handleRevokeMemberRole(rName)}
                              title={`Revoke ${rName} role`}
                              className="p-0.5 rounded hover:bg-black/10 text-current"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Restricted / Conditional Multi-Role Warnings */}
                  {Array.isArray(resolvedAccess?.incompatibleRoleWarnings) && resolvedAccess.incompatibleRoleWarnings.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                        <span>Multi-Role Conditional Safeguards Active:</span>
                      </div>
                      {resolvedAccess.incompatibleRoleWarnings.map((w: string, i: number) => (
                        <div key={i} className="pl-5">• {w}</div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-500">
                    <span>{selectedMemberRoleTpl.purpose}</span>
                    <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                      Effective Limit: {formatPhpLimit(resolvedAccess?.defaultApprovalLimitCentavos)} • Scope: {resolvedAccess?.defaultDataScope || selectedMemberRoleTpl.defaultDataScope}
                    </span>
                  </div>
                </div>

                {isTargetOwnerRole && selectedMember.status !== 'DISABLED' && (
                  <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 text-xs flex items-center gap-2.5">
                    <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
                    <div>
                      <p className="font-bold">Unrestricted Company Owner Authority — Immune to Employee Permission Checkboxes</p>
                      <p className="text-[11px] opacity-90">
                        Active Company Owner accounts permanently hold full access to all 16 Modules, 36 Submodules, COMPANY_WIDE Data Scope, and Unlimited (-1) Approval Authority. Preserved safeguards: Tenant Isolation, Immutable Audit Trail, Maker-Checker SoD, and Read-Only Recovery Quarantine.
                      </p>
                    </div>
                  </div>
                )}

                {selectedMember.status === 'DISABLED' && (
                  <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                    <div>
                      <p className="font-bold">Account is Currently DISABLED — Effective Runtime Access is DENY ALL (0 / 16 Modules)</p>
                      <p className="text-[11px] opacity-90">
                        Stored module assignments below are preserved for audit history and will only take effect if the user account is reactivated.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">Assignment Change Reason / Justification</label>
                  <input
                    type="text"
                    disabled={isMatrixControlsLocked}
                    placeholder={`Enter reason for customizing ${selectedMember.displayName || selectedMember.email}'s module assignments...`}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 disabled:opacity-50"
                  />
                </div>

                {/* 16 ERP Modules Assignment Checkboxes with Multi-Role Provenance & Submodules */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[540px] overflow-y-auto pr-1">
                  {CANONICAL_ERP_MODULES.map((mod: PrimaryModuleDefinition) => {
                    const grantingRoles = memberRoleTemplates.filter(
                      t => (t.defaultPrimaryModules || []).includes(mod.id) && !(t.hardRestrictedModuleIds || []).includes(mod.id)
                    );
                    const isHardRestricted =
                      memberRoleTemplates.every(t => (t.hardRestrictedModuleIds || []).includes(mod.id)) &&
                      grantingRoles.length === 0;
                    const isRoleDefault = grantingRoles.length > 0;
                    const isChecked = !isHardRestricted && assignedModuleIds.includes(mod.id);

                    let badgeLabel = 'INHERITED FROM ROLE';
                    let badgeClass = 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800';

                    const unionDefaultSubs = new Set<string>();
                    for (const t of grantingRoles) {
                      const sList = t.defaultSubmodules?.[mod.id] || mod.submodules.map(s => s.id);
                      sList.forEach((s: string) => unionDefaultSubs.add(s));
                    }
                    const defaultSubArray = unionDefaultSubs.size > 0 ? Array.from(unionDefaultSubs) : mod.submodules.map(s => s.id);

                    const modPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === mod.id);
                    const unionDefaultActs = new Set<string>(['view']);
                    for (const t of grantingRoles) {
                      for (const p of modPerms) {
                        if (t.defaultPermissionCodes.includes('*') || t.defaultPermissionCodes.includes(p.code)) {
                          unionDefaultActs.add(p.action);
                        }
                      }
                    }
                    const defaultActArray = Array.from(unionDefaultActs);

                    const selectedSubs = submoduleMap[mod.id] || [];
                    const currentActs = actionMap[mod.id] || [];
                    const allModActions = Array.from(new Set(modPerms.map(p => p.action)));
                    const canAnyAssignedRoleApprove = memberRoleTemplates.some(t => t.canApproveFinancialTransactions);

                    if (isHardRestricted) {
                      badgeLabel = 'HARD RESTRICTED';
                      badgeClass = 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
                    } else if (!isChecked) {
                      if (isRoleDefault) {
                        badgeLabel = 'CUSTOM DENY';
                        badgeClass = 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
                      } else {
                        badgeLabel = 'UNASSIGNED';
                        badgeClass = 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-slate-500 dark:border-slate-700';
                      }
                    } else {
                      const hasUncheckedSub = defaultSubArray.some(s => !selectedSubs.includes(s));
                      const hasUncheckedAct = defaultActArray.some(a => !currentActs.includes(a));
                      const hasAddedAct = currentActs.some(a => !defaultActArray.includes(a));
                      const hasAddedSub = selectedSubs.some(s => !defaultSubArray.includes(s));
                      const isCustomScope = dataScopeMap[mod.id] && dataScopeMap[mod.id] !== selectedMemberRoleTpl.defaultDataScope;
                      const isCustomLimit = approvalLimitMap[mod.id] !== undefined && approvalLimitMap[mod.id] !== (selectedMemberRoleTpl.defaultApprovalLimitCentavos > 0 ? selectedMemberRoleTpl.defaultApprovalLimitCentavos / 100 : 0);

                      if (hasUncheckedSub || hasUncheckedAct) {
                        badgeLabel = 'CUSTOM DENY';
                        badgeClass = 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
                      } else if (!isRoleDefault || hasAddedAct || hasAddedSub || isCustomScope || isCustomLimit) {
                        badgeLabel = 'CUSTOM GRANT';
                        badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
                      } else if (grantingRoles.length > 1) {
                        badgeLabel = 'COMBINED ROLES';
                        badgeClass = 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800';
                      } else {
                        badgeLabel = 'INHERITED FROM ROLE';
                        badgeClass = 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800';
                      }
                    }

                    return (
                      <div
                        key={mod.id}
                        className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                          isHardRestricted
                            ? 'bg-slate-100/60 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 opacity-75'
                            : isChecked 
                              ? 'bg-indigo-50/40 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/80' 
                              : 'bg-slate-50/30 dark:bg-slate-900/30 border-slate-200/80 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <label className={`flex items-center gap-2 font-bold text-xs ${isHardRestricted || isMatrixControlsLocked ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-800 dark:text-slate-100'}`}>
                            <input
                              type="checkbox"
                              disabled={isHardRestricted || isMatrixControlsLocked}
                              checked={isChecked}
                              onChange={() => toggleModuleAssignment(mod.id)}
                              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 disabled:opacity-40"
                            />
                            <span>{mod.label}</span>
                          </label>
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md border shrink-0 ${badgeClass}`}>
                            {badgeLabel}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-6 leading-relaxed">
                          {mod.description}
                        </p>

                        {grantingRoles.length > 0 && (
                          <div className="pl-6 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                            Granted by role(s): <strong>{grantingRoles.map(g => g.roleName).join(' + ')}</strong>
                          </div>
                        )}

                        {isHardRestricted && (
                          <div className="pl-6 text-[10px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                            <Lock className="w-3 h-3 shrink-0" />
                            <span>Blocked by [{memberAssignedRoles.join(', ')}] security policy</span>
                          </div>
                        )}

                        {isChecked && (
                          <div className="pl-6 pt-1 space-y-2.5 border-t border-slate-200/60 dark:border-slate-800/60">
                            {/* Submodules Checklist */}
                            <div>
                              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Authorized Submodules ({selectedSubs.length}/{mod.submodules.length}):
                              </span>
                              <div className="mt-1 space-y-1">
                                {mod.submodules.map(sub => {
                                  const subLocked = sub.id === 'md-roles' && !memberAssignedRoles.some(r => ['Company Owner', 'Company Administrator'].includes(r));
                                  const subChecked = !subLocked && selectedSubs.includes(sub.id);
                                  return (
                                    <label key={sub.id} className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                                      <span className="flex items-center gap-1.5 truncate">
                                        <input
                                          type="checkbox"
                                          disabled={subLocked || isMatrixControlsLocked}
                                          checked={subChecked}
                                          onChange={() => toggleSubmoduleAssignment(mod.id, sub.id)}
                                          className="w-3.5 h-3.5 rounded text-indigo-600 border-slate-300"
                                        />
                                        <span className="truncate">{sub.label}</span>
                                      </span>
                                      {subLocked && <span className="text-[9px] text-rose-500 font-bold">Admin Only</span>}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Interactive Action Permissions Checkboxes */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                  Allowed Actions ({currentActs.length}/{allModActions.length}):
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {allModActions.map(act => {
                                  const isActionLocked = isMatrixControlsLocked || (
                                    memberAssignedRoles.every(r => {
                                      const catEntry = modPerms.find(p => p.action === act);
                                      return catEntry && (catEntry.hardRestrictedRoles as string[]).includes(r);
                                    })
                                  );
                                  const isActChecked = currentActs.includes(act);
                                  return (
                                    <label
                                      key={act}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border select-none transition-all ${
                                        isActChecked
                                          ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700 font-bold'
                                          : 'bg-slate-100/70 text-slate-400 border-slate-200 dark:bg-slate-800/40 dark:text-slate-500 dark:border-slate-800'
                                      } ${isActionLocked ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:border-indigo-400'}`}
                                    >
                                      <input
                                        type="checkbox"
                                        disabled={isActionLocked}
                                        checked={isActChecked}
                                        onChange={() => toggleActionAssignment(mod.id, act)}
                                        className="w-3 h-3 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 disabled:opacity-40"
                                      />
                                      <span className="uppercase">{act}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Scope & Approval Limit Controls */}
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                              <div>
                                <span className="text-slate-400 font-medium">Data Scope:</span>
                                <select
                                  disabled={isMatrixControlsLocked}
                                  value={dataScopeMap[mod.id] || selectedMemberRoleTpl.defaultDataScope}
                                  onChange={e => {
                                    setIsDirty(true);
                                    setDataScopeMap({ ...dataScopeMap, [mod.id]: e.target.value as CanonicalDataScope });
                                  }}
                                  className="w-full mt-0.5 px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-[10px]"
                                >
                                  <option value="COMPANY_WIDE">Company-Wide</option>
                                  <option value="DEPARTMENT">Department-Scoped</option>
                                  <option value="PROJECT">Project-Scoped</option>
                                  <option value="COST_CENTER">Cost Center-Scoped</option>
                                  <option value="OWN_RECORDS">Own Records Only</option>
                                  <option value="ASSIGNED_RECORDS">Assigned Queue Only</option>
                                  <option value="EXPLICIT_RECORDS">Explicit Shared Only</option>
                                </select>
                              </div>
                              <div>
                                <span className="text-slate-400 font-medium">Approval Limit (PHP):</span>
                                {canAnyAssignedRoleApprove ? (
                                  <input
                                    type="number"
                                    disabled={isMatrixControlsLocked}
                                    placeholder="e.g. 100000"
                                    value={approvalLimitMap[mod.id] ?? ''}
                                    onChange={e => {
                                      setIsDirty(true);
                                      setApprovalLimitMap({ ...approvalLimitMap, [mod.id]: parseFloat(e.target.value) || 0 });
                                    }}
                                    className="w-full mt-0.5 px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono text-[10px]"
                                  />
                                ) : (
                                  <div className="w-full mt-0.5 px-2 py-1 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-100 dark:bg-slate-800/60 text-slate-400 font-mono text-[10px]">
                                    ₱0.00 (No Approval)
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {assignmentHistory.length > 0 && (
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Recent Assignment & Template Audit Trail ({assignmentHistory.length})</span>
                    </h4>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {assignmentHistory.slice(0, 6).map((h: any) => (
                        <div key={h.id} className="text-[11px] p-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{h.changedByName || 'System Governance'}</span>
                            <span className="text-slate-500"> — {h.reason || 'Module assignment update'}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {h.createdAt ? new Date(h.createdAt).toLocaleString() : 'Recorded'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="p-12 text-center text-slate-400">Select a company user member on the left to configure module assignments.</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Live User Access Preview & Interactive Matrix (Powered by Centralized Backend Permission Resolver) */}
      {activeTab === 'PREVIEW' && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6">
          {/* Quick Member Switcher & Interactive Customize Toggle inside Preview */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                  Live Effective Access Preview — {resolvedAccess?.displayName || selectedMember?.displayName || 'Select User'}
                </h3>
                <p className="text-xs text-slate-500">
                  Computed in real time by the Centralized Multi-Role Backend Permission Resolver (<code className="font-mono text-[11px]">RbacService.resolveEffectiveAccess</code>).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isMatrixControlsLocked}
                onClick={() => setLiveCustomizeMode(!liveCustomizeMode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-40 ${
                  liveCustomizeMode
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{liveCustomizeMode ? 'Interactive Customization Active' : 'Customize Live Access'}</span>
              </button>
              {liveCustomizeMode && (
                <button
                  type="button"
                  disabled={savingAssignments || isMatrixControlsLocked}
                  onClick={handleSaveAssignments}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingAssignments ? 'Saving...' : 'Save Customizations'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Member Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {members.map(m => {
              const mKey = getMemberKey(m);
              const active = getMemberKey(selectedMember) === mKey;
              const mRoles = m.assignedRoles || m.roles || [m.role];
              return (
                <button
                  key={mKey}
                  type="button"
                  onClick={() => handleSelectMember(m)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <span>{m.displayName || m.email}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${active ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                    {mRoles.join(' + ')}
                  </span>
                  {m.status === 'DISABLED' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-600 text-white">DISABLED</span>
                  )}
                </button>
              );
            })}
          </div>

          {resolvedAccess ? (
            <>
              {/* Effective Multi-Role Security Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Account & Membership</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-xs font-extrabold px-2 py-0.5 rounded ${
                      resolvedAccess.effectiveAccountActive
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-rose-600 text-white'
                    }`}>
                      {resolvedAccess.accountStatus}
                    </span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {resolvedAccess.effectiveAccountActive ? 'Active Membership' : 'DENY ALL'}
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Primary & Additional Roles</span>
                  <p className="mt-1 text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                    {(resolvedAccess.assignedRoles || [resolvedAccess.primaryRole]).join(' + ')}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Primary: {resolvedAccess.primaryRole} (v{resolvedAccess.roleTemplateVersion})
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Effective Sidebar Visibility</span>
                  <p className="mt-1 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                    {resolvedAccess.effectiveModuleIds.length} of {CANONICAL_ERP_MODULES.length} Modules Visible
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Effective Data Scope</span>
                  <p className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-200">
                    {DATA_SCOPE_LABELS[resolvedAccess.defaultDataScope as CanonicalDataScope] || resolvedAccess.defaultDataScope}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Non-Additive Approval Limit</span>
                  <p className="mt-1 text-xs font-mono font-extrabold text-emerald-700 dark:text-emerald-400">
                    {formatPhpLimit(resolvedAccess.defaultApprovalLimitCentavos)}
                  </p>
                </div>
              </div>

              {/* Multi-Role Breakdown Card */}
              {resolvedAccess.inheritedPermissionsByRole && Object.keys(resolvedAccess.inheritedPermissionsByRole).length > 0 && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Multi-Role Permission & Provenance Breakdown:
                    </span>
                    <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                      Combined Permissions: {(resolvedAccess.combinedRolePermissions || []).length} • Effective Active Permissions: {(resolvedAccess.effectivePermissions || []).length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {Object.entries(resolvedAccess.inheritedPermissionsByRole).map(([rName, perms]: [string, any]) => (
                      <div key={rName} className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs">
                        <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                          <span>{rName}</span>
                          <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                            v{resolvedAccess.activeRoleTemplateVersions?.[rName] || 1} • {Array.isArray(perms) ? perms.length : 0} perms
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!resolvedAccess.effectiveAccountActive && (
                <div className="p-4 rounded-xl bg-rose-600 text-white flex items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Lock className="w-6 h-6 shrink-0" />
                    <div>
                      <h4 className="font-extrabold text-sm">STRICT SECURITY PRECEDENCE #1: ACCOUNT DISABLED — ALL 16 ERP MODULES BLOCKED</h4>
                      <p className="text-xs opacity-90">
                        Because {resolvedAccess.displayName} ({resolvedAccess.email}) has status DISABLED, the centralized permission resolver returns 0 visible modules and 0 active permissions.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 16 Primary Modules Complete Resolution Grid (Supports Interactive Customization when liveCustomizeMode is ON) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {(resolvedAccess.moduleResolutions || []).map((mr: any) => {
                  const mod = CANONICAL_ERP_MODULES.find(m => m.id === mr.moduleId);
                  const badge = ORIGIN_BADGE_STYLES[(mr.origin as PermissionOrigin) || 'SYSTEM_RESTRICTION'] || ORIGIN_BADGE_STYLES.SYSTEM_RESTRICTION;
                  const isInteractiveChecked = assignedModuleIds.includes(mr.moduleId);
                  const isVisibleCard = liveCustomizeMode ? isInteractiveChecked : mr.visible;

                  return (
                    <div
                      key={mr.moduleId}
                      className={`p-4 rounded-xl border space-y-2.5 transition-all ${
                        isVisibleCard
                          ? 'bg-slate-50/90 dark:bg-slate-900/70 border-indigo-200 dark:border-indigo-900/70 shadow-2xs'
                          : 'bg-slate-100/50 dark:bg-slate-950/40 border-slate-200/70 dark:border-slate-800/70 opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                        <label className="flex items-center gap-2 truncate">
                          {liveCustomizeMode && (
                            <input
                              type="checkbox"
                              checked={isInteractiveChecked}
                              onChange={() => toggleModuleAssignment(mr.moduleId)}
                              className="w-3.5 h-3.5 rounded text-indigo-600 border-slate-300"
                            />
                          )}
                          <span className={`font-bold text-xs truncate ${isVisibleCard ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}>
                            {mr.moduleLabel}
                          </span>
                        </label>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded shrink-0 ${
                          isVisibleCard
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                        }`}>
                          {isVisibleCard ? 'VISIBLE' : 'HIDDEN'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badge.className}`}>
                          {badge.label}
                        </span>
                        {isVisibleCard && (
                          <span className="text-[10px] font-mono text-slate-500">
                            {dataScopeMap[mr.moduleId] || mr.dataScope}
                          </span>
                        )}
                      </div>

                      {Array.isArray(mr.grantedByRoles) && mr.grantedByRoles.length > 0 && (
                        <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">
                          Role Source: {mr.grantedByRoles.join(' + ')}
                        </div>
                      )}

                      {isVisibleCard && mod ? (
                        <>
                          <div className="space-y-1">
                            {mod.submodules.map(sub => {
                              const subAllowed = liveCustomizeMode
                                ? (submoduleMap[mr.moduleId] || []).includes(sub.id)
                                : (mr.allowedSubmoduleIds || []).includes(sub.id);
                              return (
                                <div key={sub.id} className={`text-[11px] flex items-center justify-between ${subAllowed ? 'text-slate-700 dark:text-slate-200 font-medium' : 'text-slate-400 line-through'}`}>
                                  <label className="flex items-center gap-1.5 truncate">
                                    {liveCustomizeMode && (
                                      <input
                                        type="checkbox"
                                        checked={subAllowed}
                                        onChange={() => toggleSubmoduleAssignment(mr.moduleId, sub.id)}
                                        className="w-3 h-3 rounded text-indigo-600 border-slate-300"
                                      />
                                    )}
                                    <span className="truncate">• {sub.label}</span>
                                  </label>
                                  <span className="text-[9px] font-bold ml-1 shrink-0">{subAllowed ? 'ALLOW' : 'DENY'}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60 flex flex-wrap gap-1">
                            {(mr.allowedActions || []).map((a: string) => (
                              <span key={a} className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 uppercase">
                                ✓ {a}
                              </span>
                            ))}
                            {(mr.deniedActions || []).slice(0, 4).map((a: string) => (
                              <span key={a} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 uppercase">
                                ✕ {a}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                          {mr.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Segregation of Duties & Security Restrictions Footer */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>Enforced Segregation of Duties (SoD) & Role Security Restrictions for [{(resolvedAccess.assignedRoles || [resolvedAccess.primaryRole]).join(' + ')}]</span>
                </h4>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                  {(resolvedAccess.sodRestrictions || []).map((rule: string, idx: number) => (
                    <li key={idx}>{rule}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-slate-400 text-xs">
              Select a company user above to preview their live ERP navigation and effective permissions.
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Authoritative Role Permissions Catalog, Custom Roles & Compatibility Matrix */}
      {activeTab === 'ROLE_PERMISSIONS' && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6">
          {/* Catalog Header & Mode Switcher */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-600" />
                <span>Single Authoritative Role Permissions Catalog</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure versioned default templates, custom roles, primary modules, submodules, actions, data scopes, PHP approval limits, and multi-role compatibility rules.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCustomRoleModal(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-2xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>+ Create / Clone Custom Role</span>
              </button>
              <button
                type="button"
                onClick={() => setCatalogViewMode('ROLE_EDITOR')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  catalogViewMode === 'ROLE_EDITOR'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                Role Template Editor
              </button>
              <button
                type="button"
                onClick={() => setCatalogViewMode('COMPATIBILITY_MATRIX')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  catalogViewMode === 'COMPATIBILITY_MATRIX'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                Multi-Role Compatibility Matrix
              </button>
              <button
                type="button"
                onClick={() => setCatalogViewMode('MATRIX_8_ROLES')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  catalogViewMode === 'MATRIX_8_ROLES'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                Master Permission Matrix
              </button>
              <button
                type="button"
                onClick={() => setCatalogViewMode('COMPARE_ROLES')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-colors ${
                  catalogViewMode === 'COMPARE_ROLES'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Compare Roles</span>
              </button>
            </div>
          </div>

          {/* Standard & Custom Role Selector Pills */}
          <div className="flex flex-wrap gap-2">
            {allAvailableRoles.map(rName => {
              const tpl = getRoleTemplateByName(rName);
              const isSelected = selectedCatalogRole === rName;
              const isCustom = Boolean(tpl?.isCustom) || !CANONICAL_ROLES.includes(rName as LedgerRole);
              return (
                <button
                  key={rName}
                  type="button"
                  onClick={() => setSelectedCatalogRole(rName)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <span>{rName}</span>
                  {isCustom && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                      CUSTOM
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}>
                    {tpl?.defaultPrimaryModules?.length || 0}/16 • v{tpl?.versionNumber || 1}
                  </span>
                </button>
              );
            })}
          </div>

          {catalogViewMode === 'ROLE_EDITOR' && activeRoleTemplate && (
            <div className="space-y-6">
              {/* Role Template Overview & Default Controls */}
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                        {selectedCatalogRole} — Authoritative Role Template
                      </h4>
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                        Active Version v{activeRoleTemplate.versionNumber || 1}
                      </span>
                      {activeRoleTemplate.isCustom && (
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          Custom Role (Cloned from {activeRoleTemplate.clonedFrom || 'Standard'})
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={draftRolePurpose}
                      onChange={e => setDraftRolePurpose(e.target.value)}
                      disabled={selectedCatalogRole === 'Company Owner' && userRole !== 'Company Owner'}
                      className="w-full mt-2 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                      placeholder="Role purpose description..."
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {activeRoleTemplate.isCustom && (
                      <button
                        type="button"
                        onClick={() => handleArchiveCustomRole(selectedCatalogRole)}
                        className="px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-100 flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Archive Custom Role</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePreviewTemplateImpact}
                      className="px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-50 transition-colors"
                    >
                      Preview Impact
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Default Primary Modules ({draftRoleModules.length} of 16)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {CANONICAL_ERP_MODULES.map(m => {
                        const isHardDenied = (activeRoleTemplate.hardRestrictedModuleIds || []).includes(m.id);
                        const checked = draftRoleModules.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            disabled={isHardDenied || (selectedCatalogRole === 'Company Owner' && userRole !== 'Company Owner')}
                            onClick={() => {
                              if (checked) {
                                setDraftRoleModules(draftRoleModules.filter(id => id !== m.id));
                              } else {
                                setDraftRoleModules([...draftRoleModules, m.id]);
                              }
                            }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                              checked
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : isHardDenied
                                  ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-400 border-rose-200 dark:border-rose-900 cursor-not-allowed'
                                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Default Data Scope
                    </label>
                    <select
                      aria-label="Role Template Default Data Scope"
                      value={draftRoleScope}
                      onChange={e => setDraftRoleScope(e.target.value as CanonicalDataScope)}
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                    >
                      {Object.entries(DATA_SCOPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Applied automatically to all records queried by {selectedCatalogRole} unless overridden.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Default Approval Monetary Limit (PHP)
                    </label>
                    <input
                      type="number"
                      disabled={selectedCatalogRole === 'Company Owner'}
                      value={draftRoleLimitPhp === -1 ? '' : draftRoleLimitPhp}
                      placeholder={selectedCatalogRole === 'Company Owner' ? 'Unlimited (-1)' : '0 = No Approval'}
                      onChange={e => setDraftRoleLimitPhp(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 disabled:opacity-60"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      {activeRoleTemplate.financialAuthoritySummary}
                    </p>
                  </div>
                </div>

                {/* Publish New Version Bar */}
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <input
                    type="text"
                    placeholder={`Mandatory reason to publish ${selectedCatalogRole} v${(activeRoleTemplate.versionNumber || 1) + 1} (e.g. Updated default scope or module access)...`}
                    value={publishReason}
                    onChange={e => setPublishReason(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={publishingTemplate}
                    onClick={handlePublishRoleTemplate}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span>{publishingTemplate ? 'Publishing...' : `Publish v${(activeRoleTemplate.versionNumber || 1) + 1} & Sync Users`}</span>
                  </button>
                </div>

                {impactPreview && (
                  <div className="p-3.5 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1">
                    <div className="font-bold text-indigo-900 dark:text-indigo-200">
                      Impact Preview for {impactPreview.roleName} (v{impactPreview.currentVersion} → v{impactPreview.nextVersion}):
                    </div>
                    <p className="text-indigo-800 dark:text-indigo-300">
                      • Affected Company Users: <strong>{impactPreview.affectedUsersCount}</strong> |
                      Modules Added: <strong>{impactPreview.addedModules.join(', ') || 'None'}</strong> |
                      Modules Removed: <strong>{impactPreview.removedModules.join(', ') || 'None'}</strong> |
                      Permissions Added: <strong>{impactPreview.addedPermissions.length}</strong> |
                      Permissions Removed: <strong>{impactPreview.removedPermissions.length}</strong>
                    </p>
                  </div>
                )}
              </div>

              {/* Filterable Hierarchical Permission Matrix for Selected Role */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search permission code, resource, or action..."
                      value={catalogSearch}
                      onChange={e => setCatalogSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </div>
                  <select
                    aria-label="Filter Catalog by Primary Module"
                    value={catalogModuleFilter}
                    onChange={e => setCatalogModuleFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="ALL">All 16 Primary ERP Modules ({CANONICAL_PERMISSION_CATALOG.length} Permissions)</option>
                    {CANONICAL_ERP_MODULES.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <TableScrollContainer
                  maxHeight="420px"
                  minHeight="220px"
                  stickyHeader={true}
                  title={`Role Permission Catalog (${filteredCatalogEntries.length})`}
                  totalRecordsCount={filteredCatalogEntries.length}
                  pagination={{
                    pageIndex: catalogPage,
                    pageSize: catalogPageSize,
                    pageSizeOptions: [20, 25, 50, 100],
                    totalRecords: filteredCatalogEntries.length,
                    itemCount: pagedCatalogEntries.length,
                    onPageChange: setCatalogPage,
                    onPageSizeChange: (newSize) => {
                      setCatalogPageSize(newSize);
                      setCatalogPage(0);
                    },
                  }}
                >
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Grant</th>
                        <th className="py-2.5 px-3">Permission Code</th>
                        <th className="py-2.5 px-3">Primary Module & Submodule</th>
                        <th className="py-2.5 px-3">Resource & Action</th>
                        <th className="py-2.5 px-3">Risk</th>
                        <th className="py-2.5 px-3">Governance Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {pagedCatalogEntries.map(entry => {
                        const isHardDenied =
                          entry.hardRestrictedRoles.includes(selectedCatalogRole as LedgerRole) ||
                          (activeRoleTemplate.hardDeniedPermissionCodes || []).includes(entry.code);
                        const isGranted = !isHardDenied && (draftRolePerms.includes('*') || draftRolePerms.includes(entry.code));

                        return (
                          <tr key={entry.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                            <td className="py-2 px-3">
                              <input
                                type="checkbox"
                                disabled={isHardDenied || selectedCatalogRole === 'Company Owner'}
                                checked={isGranted}
                                onChange={() => {
                                  if (isGranted) {
                                    setDraftRolePerms(draftRolePerms.filter(p => p !== entry.code));
                                  } else {
                                    setDraftRolePerms([...draftRolePerms, entry.code]);
                                  }
                                }}
                                className="w-4 h-4 rounded text-indigo-600 border-slate-300 disabled:opacity-40"
                              />
                            </td>
                            <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                              <div>{entry.code}</div>
                              <div className="font-sans font-normal text-[11px] text-slate-400">{entry.name}</div>
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                              <div className="font-semibold uppercase text-[10px] text-indigo-600 dark:text-indigo-400">{entry.primaryModuleId}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{entry.submoduleId}</div>
                            </td>
                            <td className="py-2 px-3 font-mono">
                              <span className="font-bold text-slate-700 dark:text-slate-300">{entry.resource}</span>
                              <span className="mx-1 text-slate-400">→</span>
                              <span className="uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-[10px]">
                                {entry.action}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                entry.riskLevel === 'CRITICAL'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                  : entry.riskLevel === 'HIGH'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                              }`}>
                                {entry.riskLevel}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              {isHardDenied ? (
                                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                                  <Lock className="w-3 h-3" /> Hard Restricted
                                </span>
                              ) : isGranted ? (
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">ALLOWED IN TEMPLATE</span>
                              ) : (
                                <span className="text-[10px] text-slate-400">DENIED BY DEFAULT</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScrollContainer>
              </div>

              {/* Role Template Version History & Rollback */}
              {Array.isArray(activeRoleTemplate.history) && activeRoleTemplate.history.length > 0 && (
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-indigo-600" />
                    <span>Published Role Template Version History ({activeRoleTemplate.history.length})</span>
                  </h4>
                  <div className="space-y-2">
                    {activeRoleTemplate.history.map((ver: any) => (
                      <div key={ver.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-indigo-600 dark:text-indigo-400">v{ver.versionNumber}</span>
                            {ver.isActive && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                ACTIVE
                              </span>
                            )}
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{ver.changeReason}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Published by {ver.changedByName || 'System'} • {ver.defaultPrimaryModules?.length || 0} Default Modules • Scope: {ver.defaultDataScope} • {ver.createdAt ? new Date(ver.createdAt).toLocaleString() : ''}
                          </div>
                        </div>
                        {!ver.isActive && (
                          <button
                            type="button"
                            disabled={publishingTemplate}
                            onClick={() => handleRollbackRoleTemplate(ver.versionNumber)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 shrink-0"
                          >
                            Rollback to v{ver.versionNumber}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MULTI-ROLE COMPATIBILITY MATRIX */}
          {catalogViewMode === 'COMPATIBILITY_MATRIX' && (
            <div className="space-y-5">
              <form onSubmit={handleSaveCompatibilityRule} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Role A</label>
                  <select
                    value={compatRuleForm.roleA}
                    onChange={e => setCompatRuleForm({ ...compatRuleForm, roleA: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    {allAvailableRoles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Role B</label>
                  <select
                    value={compatRuleForm.roleB}
                    onChange={e => setCompatRuleForm({ ...compatRuleForm, roleB: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    {allAvailableRoles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Compatibility Classification</label>
                  <select
                    value={compatRuleForm.compatibilityType}
                    onChange={e => setCompatRuleForm({ ...compatRuleForm, compatibilityType: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="ALLOWED">ALLOWED (Directly Compatible)</option>
                    <option value="RESTRICTED">RESTRICTED (Allowed w/ SoD Safeguards)</option>
                    <option value="PROHIBITED">PROHIBITED (Blocked SoD Conflict)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Governance Policy Reason</label>
                  <input
                    type="text"
                    required
                    placeholder="Explain SoD or compatibility rule..."
                    value={compatRuleForm.reason}
                    onChange={e => setCompatRuleForm({ ...compatRuleForm, reason: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <button
                  type="submit"
                  disabled={publishingTemplate}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                >
                  Save Rule
                </button>
              </form>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4">Role A</th>
                      <th className="py-2.5 px-4">Role B</th>
                      <th className="py-2.5 px-4">Classification</th>
                      <th className="py-2.5 px-4">Segregation of Duties (SoD) & Governance Rule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(matrixData?.compatibilityRules || []).map((rule: any) => (
                      <tr key={rule.id}>
                        <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">{rule.roleA}</td>
                        <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">{rule.roleB}</td>
                        <td className="py-2.5 px-4">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                            rule.compatibilityType === 'ALLOWED'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : rule.compatibilityType === 'RESTRICTED'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}>
                            {rule.compatibilityType}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{rule.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MASTER PERMISSION MATRIX */}
          {catalogViewMode === 'MATRIX_8_ROLES' && (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Permission Code</th>
                    <th className="py-2.5 px-3">Module</th>
                    <th className="py-2.5 px-3">Action</th>
                    {allAvailableRoles.map(r => (
                      <th key={r} className="py-2.5 px-3">{r.replace('Company ', '')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                  {CANONICAL_PERMISSION_CATALOG.map(entry => (
                    <tr key={entry.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">{entry.code}</td>
                      <td className="py-2 px-3 text-slate-500 uppercase">{entry.primaryModuleId}</td>
                      <td className="py-2 px-3 text-indigo-600 dark:text-indigo-400 uppercase">{entry.action}</td>
                      {allAvailableRoles.map(roleName => {
                        const granted = roleHasPerm(roleName, entry.code);
                        const hardRestricted = entry.hardRestrictedRoles.includes(roleName as LedgerRole);
                        return (
                          <td key={roleName} className={`py-2 px-3 ${granted ? 'text-emerald-600 dark:text-emerald-400 font-bold' : hardRestricted ? 'text-rose-400' : 'text-slate-300 dark:text-slate-600'}`}>
                            {granted ? 'ALLOW' : hardRestricted ? 'LOCKED' : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* SIDE-BY-SIDE ROLE TEMPLATE COMPARISON */}
          {catalogViewMode === 'COMPARE_ROLES' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold">Role A:</span>
                  <span className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold">{selectedCatalogRole}</span>
                </div>
                <span className="text-xs font-bold text-slate-400">VS</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold">Role B:</span>
                  <select
                    aria-label="Compare Role B"
                    value={compareRoleB}
                    onChange={e => setCompareRoleB(e.target.value)}
                    className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  >
                    {allAvailableRoles.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4">ERP Primary Module</th>
                      <th className="py-2.5 px-4">{selectedCatalogRole}</th>
                      <th className="py-2.5 px-4">{compareRoleB}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {CANONICAL_ERP_MODULES.map(mod => {
                      const aHas = (getRoleTemplateByName(selectedCatalogRole)?.defaultPrimaryModules || []).includes(mod.id);
                      const bHas = (getRoleTemplateByName(compareRoleB)?.defaultPrimaryModules || []).includes(mod.id);
                      return (
                        <tr key={mod.id}>
                          <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">{mod.label}</td>
                          <td className={`py-2.5 px-4 font-bold ${aHas ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {aHas ? '✓ DEFAULT ASSIGNED' : '✕ RESTRICTED / UNASSIGNED'}
                          </td>
                          <td className={`py-2.5 px-4 font-bold ${bHas ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {bHas ? '✓ DEFAULT ASSIGNED' : '✕ RESTRICTED / UNASSIGNED'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Compatible Role to Member */}
      {showAddRoleModal && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Assign Additional Role — {selectedMember.displayName || selectedMember.email}
              </h3>
              <button type="button" onClick={() => setShowAddRoleModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAssignAdditionalRole} className="space-y-4 text-xs">
              <div>
                <span className="font-semibold text-slate-500">Current Active Roles: </span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">{memberAssignedRoles.join(' + ')}</span>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Select Role to Assign</label>
                <select
                  value={roleToAdd}
                  onChange={e => setRoleToAdd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                >
                  {allAvailableRoles.map(r => (
                    <option key={r} value={r} disabled={r === 'Company Owner' && userRole !== 'Company Owner'}>
                      {r} ({getRoleTemplateByName(r)?.defaultPrimaryModules?.length || 0} Default Modules)
                    </option>
                  ))}
                </select>
              </div>

              {compatibilityCheck && (
                <div className={`p-3 rounded-xl border text-xs ${
                  compatibilityCheck.valid
                    ? compatibilityCheck.restrictedWarnings?.length > 0
                      ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-300'
                }`}>
                  {compatibilityCheck.valid ? (
                    compatibilityCheck.restrictedWarnings?.length > 0 ? (
                      <div>
                        <p className="font-bold">RESTRICTED COMPATIBLE (Allowed with SoD Safeguards):</p>
                        {compatibilityCheck.restrictedWarnings.map((w: any, i: number) => (
                          <p key={i} className="mt-0.5">• {w.reason}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="font-bold">✓ COMPATIBLE: Roles can be combined without Segregation of Duties conflict.</p>
                    )
                  ) : (
                    <div>
                      <p className="font-bold">✕ PROHIBITED ROLE COMBINATION:</p>
                      {(compatibilityCheck.prohibitedConflicts || []).map((c: any, i: number) => (
                        <p key={i} className="mt-0.5">• {c.reason}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={roleAddPrimary}
                  onChange={e => setRoleAddPrimary(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600"
                />
                <span>Set as Primary Role</span>
              </label>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Optional Expiration Date (Temporary Role)</label>
                <input
                  type="date"
                  value={roleAddEffectiveTo}
                  onChange={e => setRoleAddEffectiveTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Assignment Justification</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Granted Reviewer role for month-end closing review..."
                  value={roleAddReason}
                  onChange={e => setRoleAddReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddRoleModal(false)} className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingRole || (compatibilityCheck && !compatibilityCheck.valid)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-40"
                >
                  {updatingRole ? 'Assigning...' : 'Assign Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Member */}
      {showEditMemberModal && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Edit Member Profile</h3>
              <button type="button" onClick={() => setShowEditMemberModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditMemberSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={editMemberForm.displayName}
                  onChange={e => setEditMemberForm({ ...editMemberForm, displayName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={editMemberForm.email}
                  onChange={e => setEditMemberForm({ ...editMemberForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">New Password (leave blank to keep current)</label>
                <input
                  type="password"
                  placeholder="Optional new password..."
                  value={editMemberForm.password}
                  onChange={e => setEditMemberForm({ ...editMemberForm, password: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowEditMemberModal(false)} className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={updatingRole} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Controlled Remove Member from Company */}
      {showRemoveMemberModal && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-rose-200 dark:border-rose-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-rose-700 dark:text-rose-400 flex items-center gap-2">
                <UserMinus className="w-5 h-5" />
                <span>Remove Member from Company</span>
              </h3>
              <button type="button" onClick={() => setShowRemoveMemberModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRemoveMemberFromCompany} className="space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-1">
                <p className="font-bold">Controlled Member Removal Lifecycle:</p>
                <p>• Revokes company membership (<code className="font-mono">membershipStatus = REMOVED</code>) and all assigned roles.</p>
                <p>• Immediately invalidates active sessions and clears module assignments.</p>
                <p>• <strong>Preserves</strong> global user identity and all historical journals, invoices, approvals, and audit trail references.</p>
              </div>
              <div>
                <label className="block font-bold mb-1">Mandatory Removal Reason</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Completed external audit engagement / Resigned from finance team..."
                  value={removalReason}
                  onChange={e => setRemovalReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowRemoveMemberModal(false)} className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={updatingRole} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold">
                  Confirm Removal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Protected Ownership Transfer */}
      {showTransferOwnershipModal && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-amber-300 dark:border-amber-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Crown className="w-5 h-5" />
                <span>Protected Company Ownership Transfer</span>
              </h3>
              <button type="button" onClick={() => setShowTransferOwnershipModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleTransferOwnershipSubmit} className="space-y-4 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                You are granting <strong>Company Owner</strong> executive authority to <strong>{selectedMember.displayName || selectedMember.email}</strong>.
              </p>
              <div>
                <label className="block font-bold mb-1">Type <code className="font-mono text-rose-600">TRANSFER OWNERSHIP</code> to confirm</label>
                <input
                  type="text"
                  required
                  placeholder="TRANSFER OWNERSHIP"
                  value={transferPhrase}
                  onChange={e => setTransferPhrase(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Executive Governance Justification</label>
                <input
                  type="text"
                  required
                  placeholder="Board resolution / executive ownership succession..."
                  value={transferReason}
                  onChange={e => setTransferReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={demoteSelfToAdmin}
                  onChange={e => setDemoteSelfToAdmin(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600"
                />
                <span>Transition my own role to Company Administrator after transfer</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowTransferOwnershipModal(false)} className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={updatingRole} className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold">
                  Execute Ownership Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create / Clone Custom Role */}
      {showCustomRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Copy className="w-5 h-5 text-emerald-600" />
                <span>Create or Clone Custom Role Template</span>
              </h3>
              <button type="button" onClick={() => setShowCustomRoleModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomRole} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold mb-1">Custom Role Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Senior AP Specialist"
                  value={customRoleForm.roleName}
                  onChange={e => setCustomRoleForm({ ...customRoleForm, roleName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Clone Base Permissions & Modules From</label>
                <select
                  value={customRoleForm.clonedFrom}
                  onChange={e => setCustomRoleForm({ ...customRoleForm, clonedFrom: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                >
                  {CANONICAL_ROLES.filter(r => r !== 'Company Owner').map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">Role Purpose Description</label>
                <input
                  type="text"
                  required
                  placeholder="Specialized role for AP billing & vendor reconciliation..."
                  value={customRoleForm.purpose}
                  onChange={e => setCustomRoleForm({ ...customRoleForm, purpose: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCustomRoleModal(false)} className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={publishingTemplate} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  Create Custom Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Removal & Lifecycle History */}
      {showRemovalHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                <span>Company Member Removal & Governance Lifecycle History</span>
              </h3>
              <button type="button" onClick={() => setShowRemovalHistoryModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">
                  Removed Company Members ({removalHistoryData.removedMembers?.length || 0})
                </h4>
                {removalHistoryData.removedMembers?.length > 0 ? (
                  <div className="space-y-2">
                    {removalHistoryData.removedMembers.map((rm: any) => (
                      <div key={rm.membershipId} className="p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900 dark:text-slate-100">{rm.displayName} ({rm.email})</span>
                          <p className="text-[11px] text-slate-500">Reason: {rm.removalReason || 'Removed from company'}</p>
                        </div>
                        <span className="text-[10px] font-mono text-rose-600 dark:text-rose-400">
                          REMOVED • {rm.removedAt ? new Date(rm.removedAt).toLocaleString() : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">No members have been removed from this company.</p>
                )}
              </div>

              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">
                  Immutable RBAC & Member Lifecycle Audit Events ({removalHistoryData.lifecycleEvents?.length || 0})
                </h4>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {(removalHistoryData.lifecycleEvents || []).slice(0, 25).map((ev: any) => (
                    <div key={ev.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{ev.action}</span>
                        <span className="text-slate-600 dark:text-slate-300 ml-2">{ev.reason || ev.entityName || ''}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Provision New ERP User</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {addUserError && (
              <div className="p-3 text-xs bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl">
                {addUserError}
              </div>
            )}

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name / Display Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Maria Santos"
                  value={newUserForm.displayName}
                  onChange={e => setNewUserForm({ ...newUserForm, displayName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="maria.santos@company.ph"
                  value={newUserForm.email}
                  onChange={e => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Initial Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                  value={newUserForm.password}
                  onChange={e => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Primary Role
                </label>
                <select
                  value={newUserForm.role}
                  onChange={e => setNewUserForm({ ...newUserForm, role: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                >
                  {allAvailableRoles.map(r => (
                    <option key={r} value={r} disabled={r === 'Company Owner' && userRole !== 'Company Owner'}>
                      {r} ({getRoleTemplateByName(r)?.defaultPrimaryModules?.length || 0} Default Modules)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingUser}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
                >
                  {isAddingUser ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating User...</span>
                    </>
                  ) : (
                    <span>Create User</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingMemberSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Discard Unsaved Module Changes?</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              You have unsaved module customization changes for the current member. Discard changes and switch to{' '}
              <span className="font-bold">{pendingMemberSwitch.displayName || pendingMemberSwitch.email}</span>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingMemberSwitch(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={() => handleSelectMember(pendingMemberSwitch, true)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
              >
                Discard &amp; Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
