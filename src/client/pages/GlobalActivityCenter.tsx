import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Activity, Search, Filter, RefreshCw, Clock, User, ShieldCheck,
  ArrowRight, Calendar, Eye, CheckCircle2, AlertTriangle, RotateCcw,
  Ban, Archive, Trash2, GitCompare, Layers, FileText, Download,
  Users, ArrowUpRight, ShieldAlert, BarChart3, CheckSquare
} from 'lucide-react';
import RecordActivityModal from '../components/RecordActivityModal';
import ExportButton, { ExportData } from '../components/ExportButton';
import { useAuth } from '../context/AuthContext';
import { TableScrollContainer, TableDensity } from '../components/shared/TableScrollContainer';
import { PaginationControls } from '../components/PaginationControls';
import TableFilterToolbar, {
  DatePeriodFilter,
  computePeriodDates,
  SortOrderDirection,
} from '../components/shared/TableFilterToolbar';
import { apiFetch } from '../utils/api';

const CATEGORIES = [
  { id: 'ALL', label: 'Recent Activity' },
  { id: 'MY_ACTIVITIES', label: 'My Activities' },
  { id: 'CREATED', label: 'Created Records' },
  { id: 'UPDATED', label: 'Edited Records' },
  { id: 'PENDING_APPROVAL', label: 'Pending Approvals' },
  { id: 'APPROVED', label: 'Approval History' },
  { id: 'REJECTED', label: 'Rejected Records' },
  { id: 'RETURNED', label: 'Returned for Correction' },
  { id: 'CANCELLED', label: 'Cancelled Records' },
  { id: 'ARCHIVED', label: 'Archived Records' },
  { id: 'DELETED', label: 'Deleted Records' },
  { id: 'RESTORED', label: 'Restored Records' },
  { id: 'REVERSED', label: 'Reversed Transactions' },
  { id: 'FAILED_ACTIONS', label: 'Failed Actions' },
  { id: 'SECURITY_EVENTS', label: 'Security & Permission Events' }
];

const INVESTIGATION_MODES = [
  { id: 'USER_ACTIVITY', label: 'User Activity Investigation' },
  { id: 'RECORD_HISTORY', label: 'Record History Search' },
  { id: 'TRANSACTION_REFERENCE', label: 'Transaction Reference Search' },
  { id: 'APPROVAL_INVESTIGATION', label: 'Approval Accountability Investigation' },
  { id: 'DELETION_RESTORATION', label: 'Deletion & Restoration Investigation' },
  { id: 'FAILED_ACTIONS', label: 'Failed Action Investigation' },
  { id: 'SECURITY_EVENTS', label: 'Security Event Investigation' },
];

import { getAuthorizedERPModules } from '../../shared/moduleRegistry';

export default function GlobalActivityCenter() {
  const { activeCompany, user, userRole, permissions, hasPermission } = useAuth();
  const location = useLocation();

  const authorizedMods = React.useMemo(
    () => getAuthorizedERPModules(userRole, permissions, activeCompany?.assignedModules, activeCompany?.assignedSubmodules),
    [userRole, permissions, activeCompany?.assignedModules, activeCompany?.assignedSubmodules]
  );

  const canAccessStream = authorizedMods.some(m => m.id === 'activity-center') || hasPermission('activity:view');
  const canAccessApprovals = authorizedMods.some(m => m.id === 'approvals') || hasPermission('approvals:view');
  const canAccessInvestigation = authorizedMods.some(m => m.id === 'audit') || hasPermission('audit:view');

  const initialParams = new URLSearchParams(location.search);
  const initialWsParam = (initialParams.get('workspace') || '').toUpperCase();
  const isApprovalsRoute = location.pathname.startsWith('/approvals');
  const defaultWorkspace: 'STREAM' | 'APPROVALS' | 'INVESTIGATION' | 'COVERAGE' | 'ANALYTICS' =
    (initialWsParam === 'APPROVALS' || isApprovalsRoute) && canAccessApprovals
      ? 'APPROVALS'
      : canAccessStream
      ? 'STREAM'
      : canAccessApprovals
      ? 'APPROVALS'
      : 'INVESTIGATION';

  const [activeWorkspace, setActiveWorkspace] = useState<'STREAM' | 'APPROVALS' | 'INVESTIGATION' | 'COVERAGE' | 'ANALYTICS'>(defaultWorkspace);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ws = (params.get('workspace') || '').toUpperCase();
    if ((ws === 'APPROVALS' || location.pathname.startsWith('/approvals')) && canAccessApprovals) {
      setActiveWorkspace('APPROVALS');
    } else if ((ws === 'STREAM' || location.pathname.startsWith('/activity-center')) && canAccessStream) {
      setActiveWorkspace('STREAM');
    } else if (ws === 'INVESTIGATION' && canAccessInvestigation) {
      setActiveWorkspace('INVESTIGATION');
    } else if (ws === 'COVERAGE' && canAccessStream) {
      setActiveWorkspace('COVERAGE');
    } else if (ws === 'ANALYTICS' && canAccessStream) {
      setActiveWorkspace('ANALYTICS');
    }
  }, [location.pathname, location.search, canAccessApprovals, canAccessStream, canAccessInvestigation]);

  // Approval Inbox states
  const [approvalSubView, setApprovalSubView] = useState<'QUEUE' | 'POLICIES' | 'DELEGATIONS'>('QUEUE');
  const [approvalQueueFilter, setApprovalQueueFilter] = useState<
    | 'MY_PENDING'
    | 'ALL_AUTHORIZED_PENDING'
    | 'AWAITING_MY_APPROVAL'
    | 'DELEGATED'
    | 'OVERDUE'
    | 'RETURNED'
    | 'REJECTED'
    | 'APPROVED'
    | 'HISTORY'
  >('ALL_AUTHORIZED_PENDING');
  const [approvalSearch, setApprovalSearch] = useState('');
  const [approvalTypeFilter, setApprovalTypeFilter] = useState('ALL');
  const [approvalSortOrder, setApprovalSortOrder] = useState<SortOrderDirection>('DESC');
  const [approvalDatePeriod, setApprovalDatePeriod] = useState<DatePeriodFilter>('ALL');
  const [approvalFromDate, setApprovalFromDate] = useState('');
  const [approvalToDate, setApprovalToDate] = useState('');
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<Record<string, boolean>>({});
  const [approvalQueueCounts, setApprovalQueueCounts] = useState<Record<string, number>>({});
  const [approvalPolicies, setApprovalPolicies] = useState<any[]>([]);
  const [approvalDelegations, setApprovalDelegations] = useState<any[]>([]);

  // Interactive Approval Decision Modal state
  const [decisionModal, setDecisionModal] = useState<{
    workflow: any;
    stepId?: string;
    stepName?: string;
    actionType: 'APPROVE' | 'REJECT' | 'RETURN' | 'DELEGATE' | 'REASSIGN' | 'ESCALATE' | 'CANCEL';
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [approveAllSteps, setApproveAllSteps] = useState(true);
  const [modalError, setModalError] = useState<string | null>(null);
  const [companyMembers, setCompanyMembers] = useState<Array<{ id: string; displayName: string; rawName?: string; role: string }>>([]);
  const [delegateTargetUserId, setDelegateTargetUserId] = useState('');
  const [delegateTargetUserName, setDelegateTargetUserName] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Interactive Policy Matrix & Delegation Creation Modals
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState<{
    id?: string;
    policyCode: string;
    policyName: string;
    entityType: string;
    minAmountPhp: string;
    maxAmountPhp: string;
    workflowType: string;
    minApprovalsRequired: number;
    slaHours: number;
    requiredRole1: string;
    requiredRole2: string;
    allowDelegation: boolean;
    enforceSod: boolean;
  }>({
    policyCode: 'POL-CUSTOM-01',
    policyName: '',
    entityType: 'ALL',
    minAmountPhp: '0',
    maxAmountPhp: '500000',
    workflowType: 'SEQUENTIAL',
    minApprovalsRequired: 1,
    slaHours: 24,
    requiredRole1: 'Approver',
    requiredRole2: '',
    allowDelegation: true,
    enforceSod: true,
  });
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [delegationModalOpen, setDelegationModalOpen] = useState(false);
  const [delegationForm, setDelegationForm] = useState<{
    toUserId: string;
    toUserName: string;
    moduleScope: string;
    maxAmountPhp: string;
    reason: string;
    isTemporary: boolean;
    validUntil: string;
  }>({
    toUserId: '',
    toUserName: '',
    moduleScope: 'ALL',
    maxAmountPhp: '250000',
    reason: '',
    isTemporary: true,
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  });
  const [savingDelegation, setSavingDelegation] = useState(false);

  const [category, setCategory] = useState('ALL');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [userFilter, setUserFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // System-Wide Pagination & Density States (Default 20 per page, configurable)
  const [approvalPageIndex, setApprovalPageIndex] = useState(0);
  const [approvalPageSize, setApprovalPageSize] = useState(20);
  const [approvalDensity, setApprovalDensity] = useState<TableDensity>('comfortable');

  const [streamPageIndex, setStreamPageIndex] = useState(0);
  const [streamPageSize, setStreamPageSize] = useState(20);
  const [streamDensity, setStreamDensity] = useState<TableDensity>('comfortable');

  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    setApprovalPageIndex(0);
  }, [approvalQueueFilter, approvalTypeFilter, approvalSearch]);

  useEffect(() => {
    setStreamPageIndex(0);
  }, [category, userFilter, roleFilter, moduleFilter, searchQuery, startDate, endDate]);

  const [items, setItems] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Phase 2 states
  const [approvalWorkflows, setApprovalWorkflows] = useState<any[]>([]);
  const [investigationMode, setInvestigationMode] = useState('USER_ACTIVITY');
  const [investigationItems, setInvestigationItems] = useState<any[]>([]);
  const [investigationSteps, setInvestigationSteps] = useState<any[]>([]);
  const [coverageMatrix, setCoverageMatrix] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [selectedRecord, setSelectedRecord] = useState<{
    entityType: string;
    entityId: string;
    title?: string;
    initialTab?: 'overview' | 'details' | 'activity' | 'approvals' | 'changes' | 'related' | 'documents' | 'audit';
  } | null>(null);

  const fetchActivityCenter = async () => {
    if (!canAccessStream) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('category', category);
      if (moduleFilter !== 'ALL') params.set('module', moduleFilter);
      if (userFilter.trim()) params.set('userId', userFilter.trim());
      if (roleFilter.trim()) params.set('role', roleFilter.trim());
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (statusFilter.trim()) params.set('status', statusFilter.trim());
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (startDate) params.set('dateFrom', startDate);
      if (endDate) params.set('dateTo', endDate);

      const res = await apiFetch(`/api/journey/activity-center?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setCounts(data.counts || {});
      }
    } catch (err) {
      console.error('Failed to fetch Global Activity Center:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPhase2Data = async () => {
    try {
      if (canAccessApprovals) {
        const [wfRes, polRes, delRes, usrRes] = await Promise.all([
          apiFetch('/api/journey/approvals'),
          apiFetch('/api/journey/approvals/policies'),
          apiFetch('/api/journey/approvals/delegations'),
          apiFetch('/api/journey/approvals/eligible-approvers').catch(() => null),
        ]);
        if (wfRes.ok) {
          const d = await wfRes.json();
          setApprovalWorkflows(d.items || []);
          setApprovalQueueCounts(d.queueCounts || {});
        }
        if (polRes.ok) {
          const pd = await polRes.json();
          setApprovalPolicies(pd.items || []);
        }
        if (delRes.ok) {
          const dd = await delRes.json();
          setApprovalDelegations(dd.items || []);
        }
        if (usrRes && usrRes.ok) {
          const ud = await usrRes.json();
          const rawUsers = Array.isArray(ud) ? ud : ud.items || ud.users || [];
          const mapped = rawUsers
            .map((u: any) => ({
              id: u.id || u.userId,
              displayName: u.displayName || `${u.rawName || u.name || u.email} (${u.role || 'Approver'})`,
              rawName: u.rawName || u.name || u.displayName,
              role: u.role || u.roleName || 'Approver',
            }))
            .filter((u: any) => Boolean(u.id));
          setCompanyMembers(mapped);
        }
      }
      if (activeWorkspace === 'INVESTIGATION' && canAccessInvestigation) {
        const params = new URLSearchParams({ mode: investigationMode });
        if (searchQuery.trim()) {
          params.set('search', searchQuery.trim());
          params.set('recordReference', searchQuery.trim());
        }
        if (userFilter.trim()) params.set('userId', userFilter.trim());
        const res = await apiFetch(`/api/journey/investigation?${params.toString()}`);
        if (res.ok) {
          const d = await res.json();
          setInvestigationItems(d.items || []);
          setInvestigationSteps(d.approvalAccountabilitySteps || []);
        }
      } else if (activeWorkspace === 'COVERAGE' && canAccessStream) {
        const res = await apiFetch('/api/journey/module-coverage');
        if (res.ok) {
          const d = await res.json();
          setCoverageMatrix(d.matrix || []);
        }
      } else if (activeWorkspace === 'ANALYTICS' && canAccessStream) {
        const res = await apiFetch('/api/journey/management-analytics');
        if (res.ok) {
          const d = await res.json();
          setAnalytics(d);
        }
      }
    } catch (e) {
      console.error('Failed to load Phase 2 workspace data:', e);
    }
  };

  useEffect(() => {
    fetchActivityCenter();
  }, [activeCompany?.id, category, moduleFilter, roleFilter, actionFilter, statusFilter, startDate, endDate, canAccessStream]);

  useEffect(() => {
    fetchPhase2Data();
  }, [activeCompany?.id, activeWorkspace, investigationMode, searchQuery, userFilter, canAccessApprovals, canAccessInvestigation, canAccessStream]);

  const openDecisionDialog = (
    workflow: any,
    actionType: 'APPROVE' | 'REJECT' | 'RETURN' | 'DELEGATE' | 'REASSIGN' | 'ESCALATE' | 'CANCEL',
    stepId?: string,
    stepName?: string
  ) => {
    setModalError(null);
    setDecisionModal({ workflow, stepId, stepName, actionType });
    setApproveAllSteps(true);

    // Pick a valid active non-submitter target user from companyMembers
    const validTargets = companyMembers.filter((m) => m.id !== workflow.submittedBy);
    if (validTargets.length > 0) {
      setDelegateTargetUserId(validTargets[0].id);
      setDelegateTargetUserName(validTargets[0].rawName || validTargets[0].displayName);
    } else {
      setDelegateTargetUserId('');
      setDelegateTargetUserName('');
    }

    if (actionType === 'APPROVE') {
      setDecisionReason('Verified supporting documents, tax computation, and account coding.');
    } else if (actionType === 'RETURN') {
      setDecisionReason('Returned for correction: Please verify supporting schedules and tax computation before resubmitting.');
    } else if (actionType === 'REJECT') {
      setDecisionReason('Rejected: Transaction does not comply with approved budget and internal control policy.');
    } else if (actionType === 'DELEGATE') {
      setDecisionReason('Delegated to authorized reviewer for immediate verification and sign-off.');
    } else if (actionType === 'REASSIGN') {
      setDecisionReason('Reassigned to alternate authorized approver for workload balancing.');
    } else if (actionType === 'ESCALATE') {
      setDecisionReason('Escalated to executive authority for priority SLA sign-off.');
    } else if (actionType === 'CANCEL') {
      setDecisionReason('Cancelled workflow per requester/management governance instruction.');
    } else {
      setDecisionReason('');
    }
  };

  const executeModalDecision = async () => {
    if (!decisionModal) return;
    const { workflow, stepId, actionType } = decisionModal;
    const trimmedReason = decisionReason.trim();
    setModalError(null);

    if (['REJECT', 'RETURN', 'DELEGATE', 'REASSIGN', 'CANCEL'].includes(actionType) && !trimmedReason) {
      const msg = `Mandatory reason/remarks required for ${actionType}.`;
      setModalError(msg);
      setActionFeedback({ type: 'error', message: msg });
      return;
    }

    if (['DELEGATE', 'REASSIGN'].includes(actionType) && !delegateTargetUserId) {
      const msg = 'Please select an active non-submitter approver in this company.';
      setModalError(msg);
      setActionFeedback({ type: 'error', message: msg });
      return;
    }

    setSubmittingDecision(true);
    try {
      let res: Response;
      if (actionType === 'APPROVE' || actionType === 'REJECT' || actionType === 'RETURN') {
        const effectiveComment = trimmedReason || 'Approved via Approval Inbox & Workflow Orchestration';
        res = await apiFetch(`/api/journey/approvals/${encodeURIComponent(workflow.id)}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepId,
            decision: actionType,
            reason: effectiveComment,
            comments: effectiveComment,
            approveAllSteps: actionType === 'APPROVE' ? approveAllSteps : false,
          }),
        });
      } else if (actionType === 'DELEGATE') {
        res = await apiFetch(`/api/journey/approvals/${encodeURIComponent(workflow.id)}/delegate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepId,
            toUserId: delegateTargetUserId,
            toUserName: delegateTargetUserName,
            reason: trimmedReason,
          }),
        });
      } else if (actionType === 'REASSIGN') {
        res = await apiFetch(`/api/journey/approvals/${encodeURIComponent(workflow.id)}/reassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepId,
            newApproverId: delegateTargetUserId,
            newApproverName: delegateTargetUserName,
            reason: trimmedReason,
          }),
        });
      } else if (actionType === 'CANCEL') {
        res = await apiFetch(`/api/journey/approvals/${encodeURIComponent(workflow.id)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: trimmedReason }),
        });
      } else {
        res = await apiFetch(`/api/journey/approvals/${encodeURIComponent(workflow.id)}/escalate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepId,
            ...(delegateTargetUserId
              ? { escalatedToId: delegateTargetUserId, escalatedToName: delegateTargetUserName }
              : {}),
            escalatedToRole: 'OWNER',
            reason: trimmedReason || 'Escalated due to SLA priority review',
          }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = `Action blocked (${data.error || res.status}): ${data.message || 'Permission or policy violation.'}`;
        setModalError(errMsg);
        setActionFeedback({ type: 'error', message: errMsg });
      } else {
        const newStatus = data.workflow?.status || data.step?.status || 'Updated';
        setActionFeedback({
          type: 'success',
          message:
            data.message ||
            `${actionType} executed on ${workflow.recordReference} (Status: ${newStatus}).`,
        });
        setDecisionModal(null);
        setDecisionReason('');
        setModalError(null);
      }
      await fetchPhase2Data();
      await fetchActivityCenter();
    } catch (e: any) {
      const errMsg = e.message || 'Workflow action failed.';
      setModalError(errMsg);
      setActionFeedback({ type: 'error', message: errMsg });
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handlePostApprovedRecord = async (wf: any) => {
    try {
      const res = await apiFetch(
        `/api/journey/action/${encodeURIComponent(wf.entityType)}/${encodeURIComponent(wf.entityId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'POST',
            reason: `Posted approved ${wf.entityType} (${wf.recordReference}) from Approval Inbox`,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionFeedback({ type: 'error', message: `Posting blocked: ${data.message || data.error}` });
      } else {
        setActionFeedback({ type: 'success', message: `Posted ${wf.recordReference} to authoritative General Ledger (${data.newStatus || data.status || 'POSTED'}).` });
      }
      await fetchPhase2Data();
      await fetchActivityCenter();
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err.message || 'Failed to post approved transaction.' });
    }
  };

  const handleResubmitReturnedRecord = async (wf: any) => {
    try {
      const res = await apiFetch('/api/journey/approvals/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: wf.entityType,
          entityId: wf.entityId,
          recordReference: wf.recordReference,
          amountCentavos: wf.amountCentavos,
          departmentId: wf.departmentId,
          branchCode: wf.branchCode,
          comments: `Corrected and resubmitted ${wf.recordReference} from Approval Inbox`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionFeedback({ type: 'error', message: `Resubmission blocked: ${data.message || data.error}` });
      } else {
        setActionFeedback({ type: 'success', message: `Resubmitted ${wf.recordReference} for approval (Resubmission #${data.workflow?.resubmissionCount || 1}).` });
      }
      await fetchPhase2Data();
      await fetchActivityCenter();
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err.message || 'Failed to resubmit transaction.' });
    }
  };

  const handleExportForensicEvidence = async (format: 'JSON' | 'CSV') => {
    try {
      const res = await apiFetch(`/api/journey/investigation/export?format=${format}&mode=${investigationMode}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionFeedback({ type: 'error', message: d.message || 'Failed to export audit evidence.' });
        return;
      }
      if (format === 'CSV') {
        const csvText = await res.text();
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LedgerAI_Forensic_Audit_Evidence_${investigationMode}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const json = await res.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LedgerAI_Forensic_Audit_Evidence_${investigationMode}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setActionFeedback({ type: 'success', message: `Exported tamper-evident ${format} audit evidence package.` });
    } catch (e: any) {
      setActionFeedback({ type: 'error', message: e.message || 'Failed to export audit evidence.' });
    }
  };

  const filteredItems = items.filter(item => {
    const actorName = item.userDisplayName || item.actorName || item.userEmail || 'System';
    const actorRole = item.role || item.actorRole || 'Member';
    if (userFilter.trim()) {
      const u = userFilter.toLowerCase();
      const actorMatch = actorName.toLowerCase().includes(u) || (item.userId || '').toLowerCase().includes(u);
      if (!actorMatch) return false;
    }
    if (roleFilter.trim()) {
      if (!actorRole.toLowerCase().includes(roleFilter.toLowerCase())) return false;
    }
    if (actionFilter.trim()) {
      if (!(item.action || '').toLowerCase().includes(actionFilter.toLowerCase())) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${item.entityType} ${item.entityId} ${item.recordReference || ''} ${item.entityName || ''} ${item.action} ${actorName} ${item.reason || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredApprovalWorkflows = React.useMemo(() => {
    const dateRange = approvalDatePeriod === 'CUSTOM'
      ? { fromDate: approvalFromDate, toDate: approvalToDate }
      : computePeriodDates(approvalDatePeriod);
    const from = dateRange.fromDate;
    const to = dateRange.toDate;

    const list = approvalWorkflows.filter((wf) => {
      const qf = wf.queueFlags || {};
      if (approvalQueueFilter === 'MY_PENDING' && !qf.isMyPending) return false;
      if (approvalQueueFilter === 'ALL_AUTHORIZED_PENDING' && !qf.isAllAuthorizedPending) return false;
      if (approvalQueueFilter === 'AWAITING_MY_APPROVAL' && !qf.isAwaitingMyApproval) return false;
      if (approvalQueueFilter === 'DELEGATED' && !qf.isDelegated) return false;
      if (approvalQueueFilter === 'OVERDUE' && !qf.isOverdue) return false;
      if (approvalQueueFilter === 'RETURNED' && !qf.isReturned) return false;
      if (approvalQueueFilter === 'REJECTED' && !qf.isRejected) return false;
      if (approvalQueueFilter === 'APPROVED' && !qf.isApproved) return false;

      if (approvalTypeFilter !== 'ALL' && wf.entityType !== approvalTypeFilter) return false;

      const subDate = (wf.submittedAt || wf.createdAt || '').slice(0, 10);
      if (from && subDate && subDate < from) return false;
      if (to && subDate && subDate > to) return false;

      if (approvalSearch.trim()) {
        const q = approvalSearch.toLowerCase();
        const hay = `${wf.entityType} ${wf.recordReference || ''} ${wf.requesterName || ''} ${wf.departmentId || ''} ${wf.branchCode || ''} ${wf.status || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      const dateA = a.submittedAt || a.createdAt || '';
      const dateB = b.submittedAt || b.createdAt || '';
      if (approvalSortOrder === 'ASC') {
        return dateA.localeCompare(dateB);
      }
      return dateB.localeCompare(dateA);
    });
  }, [approvalWorkflows, approvalQueueFilter, approvalTypeFilter, approvalSearch, approvalDatePeriod, approvalFromDate, approvalToDate, approvalSortOrder]);

  const paginatedApprovalWorkflows = React.useMemo(() => {
    const start = approvalPageIndex * approvalPageSize;
    return filteredApprovalWorkflows.slice(start, start + approvalPageSize);
  }, [filteredApprovalWorkflows, approvalPageIndex, approvalPageSize]);

  const paginatedStreamItems = React.useMemo(() => {
    const start = streamPageIndex * streamPageSize;
    return filteredItems.slice(start, start + streamPageSize);
  }, [filteredItems, streamPageIndex, streamPageSize]);

  const QUEUE_SECTIONS: Array<{
    id: typeof approvalQueueFilter;
    label: string;
    count: number;
    badgeTone: string;
  }> = [
    {
      id: 'MY_PENDING',
      label: 'My Pending Approvals',
      count: approvalQueueCounts.myPending ?? approvalWorkflows.filter((w) => w.queueFlags?.isMyPending).length,
      badgeTone: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
    },
    {
      id: 'ALL_AUTHORIZED_PENDING',
      label: 'All Authorized Pending Approvals',
      count: approvalQueueCounts.allAuthorizedPending ?? approvalWorkflows.filter((w) => w.queueFlags?.isAllAuthorizedPending).length,
      badgeTone: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    },
    {
      id: 'AWAITING_MY_APPROVAL',
      label: 'Awaiting My Approval',
      count: approvalQueueCounts.awaitingMyApproval ?? approvalWorkflows.filter((w) => w.queueFlags?.isAwaitingMyApproval).length,
      badgeTone: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
    },
    {
      id: 'DELEGATED',
      label: 'Delegated Approvals',
      count: approvalQueueCounts.delegated ?? approvalWorkflows.filter((w) => w.queueFlags?.isDelegated).length,
      badgeTone: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
    },
    {
      id: 'OVERDUE',
      label: 'Overdue Approvals',
      count: approvalQueueCounts.overdue ?? approvalWorkflows.filter((w) => w.queueFlags?.isOverdue).length,
      badgeTone: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
    },
    {
      id: 'RETURNED',
      label: 'Returned for Correction',
      count: approvalQueueCounts.returned ?? approvalWorkflows.filter((w) => w.queueFlags?.isReturned).length,
      badgeTone: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    },
    {
      id: 'REJECTED',
      label: 'Rejected Records',
      count: approvalQueueCounts.rejected ?? approvalWorkflows.filter((w) => w.queueFlags?.isRejected).length,
      badgeTone: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
    },
    {
      id: 'APPROVED',
      label: 'Approved Records',
      count: approvalQueueCounts.approved ?? approvalWorkflows.filter((w) => w.queueFlags?.isApproved).length,
      badgeTone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    },
    {
      id: 'HISTORY',
      label: 'Approval History',
      count: approvalQueueCounts.totalHistory ?? approvalWorkflows.length,
      badgeTone: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    },
  ];

  const exportData: ExportData =
    activeWorkspace === 'APPROVALS'
      ? {
          filename: `Approval_Workflow_Matrix_${activeCompany?.legalName || 'LedgerAI'}_${new Date().toISOString().slice(0, 10)}`,
          title: 'Approval Inbox & Multi-Level Workflow Register',
          subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Filter: ${approvalQueueFilter}`,
          companyName: activeCompany?.legalName || 'LedgerAI PH',
          headers: [
            'Transaction Type',
            'Reference',
            'Requester',
            'Request Date',
            'Amount (PHP)',
            'Approval Level',
            'Required Role',
            'SLA Status',
            'Workflow Status',
            'Governance Policy',
          ],
          rows: filteredApprovalWorkflows.map((wf) => {
            const activeStep = wf.activeStep || (wf.steps || []).find((s: any) => s.status === 'PENDING');
            return [
              wf.entityType || '-',
              wf.recordReference || wf.entityId || '-',
              `${wf.requesterName || wf.submittedByName || wf.submittedBy || '-'} (${wf.requesterRole || 'Requester'})`,
              wf.requestDate ? new Date(wf.requestDate).toLocaleString('en-PH') : '-',
              `₱${((wf.amountCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
              `Level ${wf.currentStepOrder} of ${wf.totalSteps} (${wf.workflowType})`,
              wf.requiredApproverRole || activeStep?.requiredRole || 'MANAGER',
              wf.slaStatus || 'ON_TRACK',
              wf.status || 'PENDING',
              wf.policyCode || wf.whyApprovalNeeded || '-',
            ];
          }),
        }
      : {
          filename: `Global_Activity_Center_${activeCompany?.legalName || 'LedgerAI'}_${new Date().toISOString().slice(0, 10)}`,
          title: 'Global Activity Center & Lifecycle Register',
          subtitle: `Company: ${activeCompany?.legalName || 'Active Workspace'} | Workspace: ${activeWorkspace}`,
          companyName: activeCompany?.legalName || 'LedgerAI PH',
          headers: ['Timestamp', 'Category', 'Action', 'Entity Type', 'Record Ref', 'Actor (Role)', 'Status Transition', 'Remarks / Changes'],
          rows: filteredItems.map((i) => {
            const actorName = i.userDisplayName || i.actorName || i.userEmail || 'System';
            const actorRole = i.role || i.actorRole || 'Member';
            const primaryCat = i.categories?.[0] || i.category || 'ACTIVITY';
            return [
              i.timestamp ? new Date(i.timestamp).toLocaleString('en-PH') : '-',
              primaryCat,
              i.action || '-',
              i.canonicalEntityType || i.entityType || '-',
              i.recordReference || i.entityName || i.entityId || '-',
              `${actorName} (${actorRole})`,
              i.previousStatus || i.newStatus ? `${i.previousStatus || '—'} -> ${i.newStatus || '—'}` : '-',
              i.reason || (i.fieldDiffs?.length ? `Changed: ${i.fieldDiffs.map((d: any) => d.field).join(', ')}` : '-'),
            ];
          }),
        };

  return (
    <div className="space-y-5">
      {/* Header Banner — Dynamically distinguishes Approval Inbox & Workflows from Global Activity Center */}
      <div className="bg-white dark:bg-[#111827] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {activeWorkspace === 'APPROVALS'
                ? 'Approval Matrix, SoD & Multi-Level Workflow Engine'
                : 'Activity & Record Tracking Hub'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              {activeWorkspace === 'APPROVALS'
                ? `${approvalQueueCounts.allAuthorizedPending ?? 0} Pending Approvals • ${approvalPolicies.length || 4} Active Matrix Policies`
                : `27/27 Modules Verified • ${activeCompany?.legalName || 'Active Tenant'}`}
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mt-1.5 flex items-center gap-2.5">
            {activeWorkspace === 'APPROVALS' ? (
              <>
                <CheckSquare className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                Approval Inbox & Workflow Orchestration
              </>
            ) : (
              <>
                <Activity className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                Global Activity Center & Forensic Traceability
              </>
            )}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {activeWorkspace === 'APPROVALS'
              ? 'Actionable Approval Queue, Multi-Level Sequential & Parallel Routing, Segregation of Duties (SoD) Enforcement, Delegation Rules, and SLA Governance.'
              : 'Centralized 360° Record Journey, Chronological Activity Stream, Forensic Audit Investigation, and 27-Module Governance.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <ExportButton data={exportData} disabled={loading} />
          <button
            onClick={() => { fetchActivityCenter(); fetchPhase2Data(); }}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Hub</span>
          </button>
        </div>
      </div>

      {/* Top-Level Enterprise Governance Workspaces */}
      <div className="bg-white dark:bg-[#111827] p-2 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-wrap items-center gap-2">
        {[
          { id: 'STREAM', label: '1. Activity Journey Stream', icon: Activity, allowed: canAccessStream },
          {
            id: 'APPROVALS',
            label: `2. Approval Inbox & Workflows (${approvalQueueCounts.allAuthorizedPending ?? 0} Pending)`,
            icon: CheckSquare,
            allowed: canAccessApprovals,
          },
          { id: 'INVESTIGATION', label: '3. Forensic Audit Investigation', icon: ShieldAlert, allowed: canAccessInvestigation },
          { id: 'COVERAGE', label: '4. 27-Module Coverage Matrix', icon: Layers, allowed: canAccessStream },
          { id: 'ANALYTICS', label: '5. Management Governance Analytics', icon: BarChart3, allowed: canAccessStream },
        ].filter(ws => ws.allowed).map(ws => {
          const Icon = ws.icon;
          const active = activeWorkspace === ws.id;
          return (
            <button
              key={ws.id}
              data-testid={`workspace-tab-${ws.id.toLowerCase()}`}
              onClick={() => setActiveWorkspace(ws.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                active
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{ws.label}</span>
            </button>
          );
        })}
      </div>

      {actionFeedback && (
        <>
          <div
            data-testid="approval-action-feedback"
            role={actionFeedback.type === 'error' ? 'alert' : 'status'}
            className={`px-4 py-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-3 ${
              actionFeedback.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
            }`}
          >
            <span>{actionFeedback.message}</span>
            <button onClick={() => setActionFeedback(null)} className="text-[11px] underline shrink-0">Dismiss</button>
          </div>
          <div
            data-testid="approval-toast-feedback"
            role={actionFeedback.type === 'error' ? 'alert' : 'status'}
            className={`fixed top-5 right-5 z-50 max-w-md px-4 py-3 rounded-xl border shadow-xl text-xs font-bold flex items-center justify-between gap-3 ${
              actionFeedback.type === 'error'
                ? 'bg-rose-600 border-rose-700 text-white'
                : 'bg-emerald-600 border-emerald-700 text-white'
            }`}
          >
            <span>{actionFeedback.message}</span>
            <button onClick={() => setActionFeedback(null)} className="text-[11px] underline shrink-0 text-white/90 hover:text-white">
              Dismiss
            </button>
          </div>
        </>
      )}

      {/* WORKSPACE 2: DEDICATED APPROVAL INBOX & WORKFLOW ORCHESTRATION */}
      {activeWorkspace === 'APPROVALS' && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-5">
          {/* Sub-Navigation: Queue vs Policy Matrix vs Delegations */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="subview-approval-queue"
                onClick={() => setApprovalSubView('QUEUE')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                  approvalSubView === 'QUEUE'
                    ? 'bg-slate-900 text-white dark:bg-indigo-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Actionable Approval Queue ({approvalWorkflows.length})
              </button>
              <button
                type="button"
                data-testid="subview-approval-policies"
                onClick={() => setApprovalSubView('POLICIES')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                  approvalSubView === 'POLICIES'
                    ? 'bg-slate-900 text-white dark:bg-indigo-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Approval Policy Matrix & Thresholds ({approvalPolicies.length})
              </button>
              <button
                type="button"
                data-testid="subview-approval-delegations"
                onClick={() => setApprovalSubView('DELEGATIONS')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                  approvalSubView === 'DELEGATIONS'
                    ? 'bg-slate-900 text-white dark:bg-indigo-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Standing & Temporary Delegations ({approvalDelegations.length})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="btn-evaluate-sla"
                onClick={async () => {
                  try {
                    const r = await apiFetch('/api/journey/approvals/check-sla', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: '{}',
                    });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) {
                      setActionFeedback({ type: 'error', message: d.message || 'SLA sweep blocked.' });
                    } else {
                      setActionFeedback({
                        type: 'success',
                        message: `SLA & Escalation Sweep Completed: Evaluated ${d.checkedCount ?? 0} active workflows.`,
                      });
                    }
                    await fetchPhase2Data();
                  } catch (err: any) {
                    setActionFeedback({ type: 'error', message: err.message || 'SLA sweep failed.' });
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-xs font-bold hover:bg-amber-100 transition-colors cursor-pointer"
              >
                Evaluate SLA Timers
              </button>
            </div>
          </div>

          {approvalSubView === 'QUEUE' && (
            <>
              {/* 9 Required Approval Inbox Queue Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5" data-testid="approval-queue-filter-bar">
                {QUEUE_SECTIONS.map((sec) => {
                  const isActive = approvalQueueFilter === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      data-testid={`queue-tab-${sec.id.toLowerCase()}`}
                      onClick={() => setApprovalQueueFilter(sec.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border ${
                        isActive
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span>{sec.label}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                          isActive ? 'bg-white/20 text-white' : sec.badgeTone
                        }`}
                      >
                        {sec.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <TableFilterToolbar
                searchQuery={approvalSearch}
                onSearchChange={(q) => {
                  setApprovalSearch(q);
                  setApprovalPageIndex(0);
                }}
                searchPlaceholder="Search reference, requester, status..."
                sortOrder={approvalSortOrder}
                onSortOrderChange={(ord) => {
                  setApprovalSortOrder(ord);
                  setApprovalPageIndex(0);
                }}
                datePeriod={approvalDatePeriod}
                onDatePeriodChange={(p) => {
                  setApprovalDatePeriod(p);
                  setApprovalPageIndex(0);
                }}
                fromDate={approvalFromDate}
                toDate={approvalToDate}
                onDateRangeChange={({ fromDate, toDate }) => {
                  setApprovalFromDate(fromDate);
                  setApprovalToDate(toDate);
                  setApprovalPageIndex(0);
                }}
                productLabel="Type"
                selectedProductId={approvalTypeFilter}
                onProductChange={(val) => {
                  setApprovalTypeFilter(val);
                  setApprovalPageIndex(0);
                }}
                productOptions={[
                  { label: 'All Transaction Types', value: 'ALL' },
                  { label: 'Manual Journal Entries (GL)', value: 'JOURNAL_ENTRY' },
                  { label: 'Sales Invoices (AR)', value: 'SALES_INVOICE' },
                  { label: 'Supplier Bills (AP)', value: 'PURCHASE_BILL' },
                  { label: 'Purchase Requisitions (PR)', value: 'PURCHASE_REQUISITION' },
                  { label: 'Purchase Orders (PO)', value: 'PURCHASE_ORDER' },
                  { label: 'Goods Receipt Notes (GRN)', value: 'GOODS_RECEIPT_NOTE' },
                  { label: 'Supplier Payments (AP)', value: 'SUPPLIER_PAYMENT' },
                  { label: 'Customer Collections (AR)', value: 'CUSTOMER_PAYMENT' },
                  { label: 'Credit Memos', value: 'CREDIT_MEMO' },
                  { label: 'Debit Memos', value: 'DEBIT_MEMO' },
                  { label: 'Cash Transactions', value: 'CASH_TRANSACTION' },
                  { label: 'Inventory Adjustments', value: 'STOCK_ADJUSTMENT' },
                  { label: 'Payroll Runs', value: 'PAYROLL_RUN' },
                  { label: 'Tax Returns (BIR)', value: 'TAX_FILING' },
                  { label: 'Bank Reconciliations', value: 'BANK_RECONCILIATION' },
                  { label: 'Departmental Budgets', value: 'BUDGET' },
                ]}
                pageSize={approvalPageSize}
                onPageSizeChange={(sz) => {
                  setApprovalPageSize(sz);
                  setApprovalPageIndex(0);
                }}
                totalCount={approvalWorkflows.length}
                filteredCount={filteredApprovalWorkflows.length}
                onResetFilters={() => {
                  setApprovalSearch('');
                  setApprovalTypeFilter('ALL');
                  setApprovalSortOrder('DESC');
                  setApprovalDatePeriod('ALL');
                  setApprovalFromDate('');
                  setApprovalToDate('');
                  setApprovalPageSize(20);
                  setApprovalPageIndex(0);
                }}
              />

              {/* Standardized 12-Column Enterprise Approval Queue Table */}
              {filteredApprovalWorkflows.length === 0 ? (
                <div className="py-12 text-center bg-slate-50/60 dark:bg-slate-900/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                  <CheckSquare className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    No approval workflows match the selected queue filter ({QUEUE_SECTIONS.find(s => s.id === approvalQueueFilter)?.label}).
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Switch to "All Authorized Pending Approvals" or "Approval History" to inspect all workflow records.
                  </p>
                </div>
              ) : (
                <TableScrollContainer
                  title={`Actionable Approval Queue (${filteredApprovalWorkflows.length} total)`}
                  totalRecordsCount={filteredApprovalWorkflows.length}
                  density={approvalDensity}
                  onDensityChange={setApprovalDensity}
                  maxHeight="calc(100vh - 310px)"
                  footer={
                    <PaginationControls
                      totalCount={filteredApprovalWorkflows.length}
                      itemCount={paginatedApprovalWorkflows.length}
                      pageIndex={approvalPageIndex}
                      pageSize={approvalPageSize}
                      pageSizeOptions={[20, 50, 100]}
                      hasNextPage={(approvalPageIndex + 1) * approvalPageSize < filteredApprovalWorkflows.length}
                      onNextPage={() => setApprovalPageIndex((p) => p + 1)}
                      onPrevPage={() => setApprovalPageIndex((p) => Math.max(0, p - 1))}
                      onFirstPage={() => setApprovalPageIndex(0)}
                      onLastPage={() => setApprovalPageIndex(Math.max(0, Math.ceil(filteredApprovalWorkflows.length / approvalPageSize) - 1))}
                      onPageSizeChange={(newSize) => {
                        setApprovalPageSize(newSize);
                        setApprovalPageIndex(0);
                      }}
                      loading={loading}
                    />
                  }
                >
                  <table className="w-full text-left border-collapse" data-testid="approval-inbox-table">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-3">Transaction Type</th>
                        <th className="py-3 px-3">Transaction Reference</th>
                        <th className="py-3 px-3">Requester</th>
                        <th className="py-3 px-3">Request Date</th>
                        <th className="py-3 px-3 text-right">Transaction Amount</th>
                        <th className="py-3 px-2 text-center">Currency</th>
                        <th className="py-3 px-3">Current Approval Level</th>
                        <th className="py-3 px-3">Required Approver Role</th>
                        <th className="py-3 px-3">SLA Status</th>
                        <th className="py-3 px-3">Current Status</th>
                        <th className="py-3 px-3 text-right">Available Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                      {paginatedApprovalWorkflows.map((wf) => {
                        const isExpanded = Boolean(expandedWorkflowIds[wf.id]);
                        const activeStep = wf.activeStep || (wf.steps || []).find((s: any) => s.status === 'PENDING');
                        const isPending = wf.status === 'IN_PROGRESS' || wf.status === 'PENDING';
                        return (
                          <React.Fragment key={wf.id}>
                            <tr
                              data-testid={`approval-row-${wf.recordReference || wf.id}`}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors align-top"
                            >
                              {/* 1. Transaction Type */}
                              <td className="py-3 px-3">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] uppercase border border-indigo-200/60 dark:border-indigo-800">
                                  {wf.entityType}
                                </span>
                                <div className="text-[10px] text-slate-500 mt-0.5">{wf.moduleName}</div>
                              </td>

                              {/* 2. Transaction Reference */}
                              <td className="py-3 px-3">
                                <button
                                  type="button"
                                  onClick={() => setSelectedRecord({ entityType: wf.entityType, entityId: wf.entityId, initialTab: 'overview' })}
                                  className="font-mono font-black text-indigo-600 dark:text-indigo-400 hover:underline text-xs"
                                >
                                  {wf.recordReference || wf.entityId}
                                </button>
                                <div className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] truncate" title={wf.whyApprovalNeeded}>
                                  {wf.whyApprovalNeeded}
                                </div>
                              </td>

                              {/* 3. Requester */}
                              <td className="py-3 px-3">
                                <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                                  {wf.requesterName || wf.submittedByName || wf.submittedBy}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {wf.requesterRole || 'Requester'}
                                  {wf.departmentId && wf.departmentId !== 'GENERAL' ? ` • ${wf.departmentId}` : ''}
                                </div>
                              </td>

                              {/* 4. Request Date */}
                              <td className="py-3 px-3 whitespace-nowrap text-[11px] text-slate-600 dark:text-slate-300">
                                {wf.requestDate ? new Date(wf.requestDate).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                              </td>

                              {/* 6. Transaction Amount */}
                              <td className="py-3 px-3 text-right font-mono font-black text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                ₱{((wf.amountCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>

                              {/* 7. Currency */}
                              <td className="py-3 px-2 text-center">
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono font-bold text-[10px] text-slate-700 dark:text-slate-300">
                                  {wf.currency || 'PHP'}
                                </span>
                              </td>

                              {/* 8. Current Approval Level */}
                              <td className="py-3 px-3">
                                <div className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">
                                  Level {wf.currentStepOrder} of {wf.totalSteps} ({wf.workflowType})
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {activeStep ? activeStep.stepName : 'Completed All Stages'}
                                </div>
                              </td>

                              {/* 9. Required Approver Role */}
                              <td className="py-3 px-3">
                                <span className="px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-mono font-bold text-[10px]">
                                  {wf.requiredApproverRole || activeStep?.requiredRole || 'MANAGER'}
                                </span>
                                {activeStep?.assignedApproverName && (
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    Assigned: {activeStep.assignedApproverName}
                                  </div>
                                )}
                              </td>

                              {/* 10. SLA Status */}
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                    wf.slaStatus === 'OVERDUE' || wf.slaStatus === 'EXPIRED' || wf.slaStatus === 'ESCALATED'
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                      : wf.slaStatus === 'AT_RISK'
                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                  }`}
                                >
                                  {wf.slaStatus || 'ON_TRACK'}
                                </span>
                                {wf.slaDueAt && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    Due: {new Date(wf.slaDueAt).toLocaleDateString('en-PH')}
                                  </div>
                                )}
                              </td>

                              {/* 11. Current Status */}
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                    wf.status === 'APPROVED'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                      : wf.status === 'REJECTED' || wf.status === 'CANCELLED'
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                      : wf.status === 'RETURNED'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                                      : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                                  }`}
                                >
                                  {wf.status}
                                </span>
                                {wf.status === 'IN_PROGRESS' && wf.currentStepOrder > 1 && (
                                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">
                                    Step {wf.currentStepOrder - 1}/{wf.totalSteps} Approved
                                  </div>
                                )}
                                {wf.resubmissionCount > 0 && (
                                  <div className="text-[10px] text-indigo-600 font-bold mt-0.5">
                                    Resubmitted #{wf.resubmissionCount}
                                  </div>
                                )}
                              </td>

                              {/* 12. Available Actions */}
                              <td className="py-3 px-3 text-right">
                                <div className="flex flex-wrap items-center justify-end gap-1 min-w-[240px]">
                                  {isPending && activeStep && (
                                    <>
                                      <button
                                        type="button"
                                        data-testid={`btn-approve-${wf.recordReference || wf.id}`}
                                        onClick={() => openDecisionDialog(wf, 'APPROVE', activeStep.id, activeStep.stepName)}
                                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] transition-colors"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        data-testid={`btn-return-${wf.recordReference || wf.id}`}
                                        onClick={() => openDecisionDialog(wf, 'RETURN', activeStep.id, activeStep.stepName)}
                                        className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] transition-colors"
                                      >
                                        Return for Correction
                                      </button>
                                      <button
                                        type="button"
                                        data-testid={`btn-reject-${wf.recordReference || wf.id}`}
                                        onClick={() => openDecisionDialog(wf, 'REJECT', activeStep.id, activeStep.stepName)}
                                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] transition-colors"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}

                                  {wf.status === 'RETURNED' && (
                                    <button
                                      type="button"
                                      data-testid={`btn-resubmit-${wf.recordReference || wf.id}`}
                                      onClick={() => handleResubmitReturnedRecord(wf)}
                                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] transition-colors"
                                      title="Resubmit Returned Transaction for Approval"
                                    >
                                      Resubmit for Approval
                                    </button>
                                  )}

                                  {wf.status === 'APPROVED' && wf.entityType === 'PURCHASE_REQUISITION' && (
                                    <button
                                      type="button"
                                      data-testid={`btn-convert-po-${wf.recordReference || wf.id}`}
                                      onClick={async () => {
                                        try {
                                          const r = await apiFetch(`/api/journey/requisitions/${wf.entityId}/convert-to-po`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({}),
                                          });
                                          const d = await r.json().catch(() => ({}));
                                          if (!r.ok) {
                                            setActionFeedback({ type: 'error', message: `PO Conversion Blocked (${d.error || r.status}): ${d.message}` });
                                          } else {
                                            setActionFeedback({ type: 'success', message: d.message || `Converted ${wf.recordReference} to Purchase Order.` });
                                            await fetchPhase2Data();
                                            await fetchActivityCenter();
                                          }
                                        } catch (err: any) {
                                          setActionFeedback({ type: 'error', message: `PO Conversion Error: ${err.message}` });
                                        }
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] transition-colors"
                                      title="Convert Approved Requisition to Purchase Order"
                                    >
                                      Convert to PO
                                    </button>
                                  )}

                                  {wf.status === 'APPROVED' && wf.entityType !== 'PURCHASE_REQUISITION' && (
                                    <button
                                      type="button"
                                      data-testid={`btn-post-${wf.recordReference || wf.id}`}
                                      onClick={() => handlePostApprovedRecord(wf)}
                                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] transition-colors"
                                      title="Post Approved Record to General Ledger"
                                    >
                                      Post to GL
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    data-testid={`btn-details-${wf.recordReference || wf.id}`}
                                    onClick={() => setSelectedRecord({ entityType: wf.entityType, entityId: wf.entityId, initialTab: 'details' })}
                                    className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[10px]"
                                  >
                                    View Details
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`btn-history-${wf.recordReference || wf.id}`}
                                    onClick={() =>
                                      setExpandedWorkflowIds((prev) => ({
                                        ...prev,
                                        [wf.id]: !prev[wf.id],
                                      }))
                                    }
                                    className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-[10px]"
                                  >
                                    {isExpanded ? 'Hide History' : 'Approval History'}
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`btn-docs-${wf.recordReference || wf.id}`}
                                    onClick={() => setSelectedRecord({ entityType: wf.entityType, entityId: wf.entityId, initialTab: 'documents' })}
                                    className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[10px]"
                                  >
                                    Supporting Docs ({wf.supportingDocumentsCount ?? 0})
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`btn-360-${wf.recordReference || wf.id}`}
                                    onClick={() => setSelectedRecord({ entityType: wf.entityType, entityId: wf.entityId, initialTab: 'approvals' })}
                                    className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-indigo-600 text-white font-bold text-[10px]"
                                  >
                                    Entity Journey 360°
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* Expandable Multi-Step Approval History & Governance Drawer */}
                            {isExpanded && (
                              <tr className="bg-slate-50/90 dark:bg-slate-900/70">
                                <td colSpan={11} className="p-4">
                                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <h4 className="text-xs font-black text-slate-900 dark:text-white">
                                          Multi-Level Approval Chain & Accountability Log — {wf.recordReference}
                                        </h4>
                                        <p className="text-[11px] text-slate-500">
                                          Policy Rule: <span className="font-mono font-bold">{wf.policyCode || 'POL-TIER-DEFAULT'} (v{wf.policyVersion || 1})</span> • {wf.whyApprovalNeeded}
                                        </p>
                                      </div>
                                      {isPending && activeStep && (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            data-testid={`btn-delegate-${wf.recordReference || wf.id}`}
                                            onClick={() => openDecisionDialog(wf, 'DELEGATE', activeStep.id, activeStep.stepName)}
                                            className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold transition-colors"
                                          >
                                            Delegate Step
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`btn-reassign-${wf.recordReference || wf.id}`}
                                            onClick={() => openDecisionDialog(wf, 'REASSIGN', activeStep.id, activeStep.stepName)}
                                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[10px] font-bold transition-colors"
                                          >
                                            Reassign Step
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`btn-escalate-${wf.recordReference || wf.id}`}
                                            onClick={() => openDecisionDialog(wf, 'ESCALATE', activeStep.id, activeStep.stepName)}
                                            className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-bold transition-colors"
                                          >
                                            Escalate Step
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`btn-cancel-wf-${wf.recordReference || wf.id}`}
                                            onClick={() => openDecisionDialog(wf, 'CANCEL')}
                                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold transition-colors"
                                          >
                                            Cancel Workflow
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <div className="overflow-x-auto">
                                      <table className="w-full text-left text-[11px] border-t border-slate-200 dark:border-slate-800">
                                        <thead className="text-slate-400 uppercase text-[10px]">
                                          <tr>
                                            <th className="py-2 pr-3">Level</th>
                                            <th className="py-2 pr-3">Required Role</th>
                                            <th className="py-2 pr-3">Original Assigned Approver</th>
                                            <th className="py-2 pr-3">Current / Actual Approver</th>
                                            <th className="py-2 pr-3">Decision & Status</th>
                                            <th className="py-2 pr-3">Remarks / Audit Trail</th>
                                            <th className="py-2 text-right">Responded At</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                                          {(wf.steps || []).map((st: any) => {
                                            const stepAuditRemarks =
                                              st.comments ||
                                              st.rejectionReason ||
                                              (st.escalationReason
                                                ? `Escalated (L${st.escalationLevel || 1}) to ${st.assignedApproverName || st.assignedApproverId}: ${st.escalationReason}`
                                                : st.reassignmentReason
                                                ? `Reassigned to ${st.assignedApproverName || st.assignedApproverId}: ${st.reassignmentReason}`
                                                : st.delegationReason
                                                ? `Delegated from ${st.delegatedFromName || 'Approver'} to ${st.assignedApproverName || st.assignedApproverId}: ${st.delegationReason}`
                                                : 'Awaiting decision');
                                            return (
                                              <tr key={st.id}>
                                                <td className="py-2 pr-3 font-bold text-slate-900 dark:text-white">
                                                  Level {st.stepOrder}: {st.stepName}
                                                </td>
                                                <td className="py-2 pr-3 font-mono text-[10px]">
                                                  {st.approvalMode} • {st.requiredRole}
                                                </td>
                                                <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                                                  {st.originalAssignedApproverName || st.originalAssignedApproverId}
                                                </td>
                                                <td className="py-2 pr-3">
                                                  <div className="font-bold text-slate-900 dark:text-white">
                                                    {st.actualApproverName || st.assignedApproverName || st.assignedApproverId}
                                                  </div>
                                                  {st.actualApproverRole && (
                                                    <div className="text-[10px] text-emerald-600 font-bold">
                                                      Verified Role: {st.actualApproverRole}
                                                    </div>
                                                  )}
                                                </td>
                                                <td className="py-2 pr-3">
                                                  <span className="font-bold">{st.status}</span>
                                                  {st.durationSeconds != null && (
                                                    <span className="block text-[10px] text-slate-400">
                                                      Turnaround: {st.durationSeconds}s
                                                    </span>
                                                  )}
                                                </td>
                                                <td className="py-2 pr-3 text-[11px] text-slate-600 dark:text-slate-300">
                                                  {stepAuditRemarks}
                                                </td>
                                                <td className="py-2 text-right text-[10px] text-slate-500">
                                                  {st.respondedAt ? new Date(st.respondedAt).toLocaleString('en-PH') : 'Pending'}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScrollContainer>
              )}
            </>
          )}

          {/* SUBVIEW: APPROVAL POLICY MATRIX & THRESHOLD RULES */}
          {approvalSubView === 'POLICIES' && (
            <div className="space-y-4" data-testid="approval-policies-matrix">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    Approval Matrix & Threshold Governance
                  </h3>
                  <p className="text-xs text-slate-500">
                    Determines automatic multi-level routing by Transaction Type, Amount Threshold (PHP), Branch/Department Scope, Sequential/Parallel Quorum, and Segregation of Duties (SoD).
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="btn-new-approval-policy"
                  onClick={() => {
                    setPolicyForm({
                      id: undefined,
                      policyCode: `POL-TIER-${approvalPolicies.length + 1}`,
                      policyName: '',
                      entityType: 'ALL',
                      minAmountPhp: '0',
                      maxAmountPhp: '250000',
                      workflowType: 'SEQUENTIAL',
                      minApprovalsRequired: 1,
                      slaHours: 24,
                      requiredRole1: 'Approver',
                      requiredRole2: '',
                      allowDelegation: true,
                      enforceSod: true,
                    });
                    setPolicyModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-colors"
                >
                  + Configure Approval Policy
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {approvalPolicies.map((pol: any) => (
                  <div
                    key={pol.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono font-bold text-[10px]">
                        {pol.policyCode} • v{pol.version || 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black">
                          {pol.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const roles = pol.requiredRoles || [];
                            setPolicyForm({
                              id: pol.id,
                              policyCode: pol.policyCode || 'POL-TIER',
                              policyName: pol.policyName || '',
                              entityType: pol.entityType || 'ALL',
                              minAmountPhp: String(Math.round((pol.minAmountCentavos || 0) / 100)),
                              maxAmountPhp: pol.maxAmountCentavos ? String(Math.round(pol.maxAmountCentavos / 100)) : '',
                              workflowType: pol.workflowType || 'SEQUENTIAL',
                              minApprovalsRequired: Number(pol.minApprovalsRequired || 1),
                              slaHours: Number(pol.slaHours || 24),
                              requiredRole1: roles[0]?.requiredRole || 'Approver',
                              requiredRole2: roles[1]?.requiredRole || '',
                              allowDelegation: Boolean(pol.allowDelegation ?? true),
                              enforceSod: Boolean(pol.enforceSod ?? true),
                            });
                            setPolicyModalOpen(true);
                          }}
                          className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50"
                        >
                          Edit Rule
                        </button>
                      </div>
                    </div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs">{pol.policyName}</h4>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Amount Threshold & Scope</span>
                        <span className="font-mono font-bold">
                          ₱{((pol.minAmountCentavos || 0) / 100).toLocaleString('en-PH')} —{' '}
                          {pol.maxAmountCentavos ? `₱${(pol.maxAmountCentavos / 100).toLocaleString('en-PH')}` : 'Unlimited'}
                        </span>
                        <span className="block text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                          Entity: {pol.entityType || 'ALL'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Routing Mode & SLA</span>
                        <span className="font-bold">
                          {pol.workflowType} (Min {pol.minApprovalsRequired} level/quorum) • {pol.slaHours}h SLA
                        </span>
                        <span className="block text-[10px] text-emerald-600 font-bold">
                          {pol.enforceSod ? 'SoD Enforced' : 'Standard'} • {pol.allowDelegation ? 'Delegation Allowed' : 'No Delegation'}
                        </span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Required Approval Chain:</div>
                      {(pol.requiredRoles || []).map((r: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {r.stepName || `Level ${r.stepOrder}`}
                          </span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            Role: {r.requiredRole}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SUBVIEW: DELEGATION & OUT-OF-OFFICE RULES */}
          {approvalSubView === 'DELEGATIONS' && (
            <div className="space-y-4" data-testid="approval-delegations-view">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    Active Approval Delegations & Audit Lineage
                  </h3>
                  <p className="text-xs text-slate-500">
                    All delegations preserve <code>originalAssignedApproverId</code> while routing actionable queue items to the authorized delegatee. Self-delegation to the transaction requester is blocked by SoD.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="btn-new-delegation"
                  onClick={() => {
                    const defaultTarget = companyMembers.find((m) => m.id !== user?.id) || companyMembers[0];
                    setDelegationForm({
                      toUserId: defaultTarget?.id || '',
                      toUserName: defaultTarget?.rawName || defaultTarget?.displayName || '',
                      moduleScope: 'ALL',
                      maxAmountPhp: '250000',
                      reason: 'Authorized temporary delegation for BIR & month-end closing review',
                      isTemporary: true,
                      validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
                    });
                    setDelegationModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-colors"
                >
                  + Create Delegation Rule
                </button>
              </div>
              {approvalDelegations.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800">
                  No standing delegation rules configured. Click "+ Create Delegation Rule" or delegate individual approval steps directly from the Approval Queue.
                </div>
              ) : (
                <div className="space-y-2">
                  {approvalDelegations.map((del: any) => (
                    <div key={del.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50/40 dark:bg-slate-900/30">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>{del.fromUserName || del.fromUserId} → {del.toUserName || del.toUserId}</span>
                          <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-[10px]">
                            {del.isTemporary ? 'TEMPORARY' : 'STANDING'} • Scope: {del.moduleScope || 'ALL'}
                          </span>
                          {del.maxAmountCentavos && (
                            <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                              Cap: ₱{(Number(del.maxAmountCentavos) / 100).toLocaleString('en-PH')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Reason: {del.reason} • Valid Until:{' '}
                          {del.validUntil ? new Date(del.validUntil).toLocaleDateString('en-PH') : 'Standing'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            del.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {del.status}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const nextStatus = del.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE';
                              const r = await apiFetch(`/api/journey/approvals/delegations/${del.id}/revoke`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: nextStatus }),
                              });
                              if (r.ok) {
                                setActionFeedback({
                                  type: 'success',
                                  message: `Delegation ${nextStatus === 'ACTIVE' ? 'reactivated' : 'revoked'} and logged to immutable audit trail.`,
                                });
                                await fetchPhase2Data();
                                await fetchActivityCenter();
                              }
                            } catch (err: any) {
                              setActionFeedback({ type: 'error', message: err.message });
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                        >
                          {del.status === 'ACTIVE' ? 'Revoke' : 'Reactivate'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Create / Edit Approval Policy Matrix Rule */}
      {policyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {policyForm.id ? 'Edit Approval Policy Rule' : 'Configure New Approval Policy Rule'}
              </h3>
              <button type="button" onClick={() => setPolicyModalOpen(false)} className="text-xs font-bold text-slate-400">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Policy Code</label>
                <input
                  type="text"
                  value={policyForm.policyCode}
                  onChange={(e) => setPolicyForm({ ...policyForm, policyCode: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Entity / Module Scope</label>
                <select
                  value={policyForm.entityType}
                  onChange={(e) => setPolicyForm({ ...policyForm, entityType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="ALL">ALL Transaction Types</option>
                  <option value="JOURNAL_ENTRY">Manual Journal Entries</option>
                  <option value="SALES_INVOICE">Sales Invoices (AR)</option>
                  <option value="PURCHASE_BILL">Purchase Bills (AP)</option>
                  <option value="PURCHASE_REQUISITION">Purchase Requisitions</option>
                  <option value="PURCHASE_ORDER">Purchase Orders</option>
                  <option value="SUPPLIER_PAYMENT">Supplier Payments</option>
                  <option value="PAYROLL_RUN">Payroll Runs</option>
                  <option value="TAX_FILING">BIR Tax Filings</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Policy Name / Description</label>
                <input
                  type="text"
                  value={policyForm.policyName}
                  onChange={(e) => setPolicyForm({ ...policyForm, policyName: e.target.value })}
                  placeholder="e.g. Tier 2 Mid-Market Disbursements & Payables (₱100k - ₱500k)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Min Amount (PHP)</label>
                <input
                  type="number"
                  value={policyForm.minAmountPhp}
                  onChange={(e) => setPolicyForm({ ...policyForm, minAmountPhp: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Max Amount (PHP, blank=Unlimited)</label>
                <input
                  type="number"
                  value={policyForm.maxAmountPhp}
                  onChange={(e) => setPolicyForm({ ...policyForm, maxAmountPhp: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Level 1 Approver Role</label>
                <select
                  value={policyForm.requiredRole1}
                  onChange={(e) => setPolicyForm({ ...policyForm, requiredRole1: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Approver">Approver / Department Manager</option>
                  <option value="Accountant">Chief Accountant</option>
                  <option value="Company Owner">Company Owner / CFO</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Level 2 Approver Role (Optional)</label>
                <select
                  value={policyForm.requiredRole2}
                  onChange={(e) => setPolicyForm({ ...policyForm, requiredRole2: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="">Single-Level Only</option>
                  <option value="Company Owner">Company Owner / Executive Sign-Off</option>
                  <option value="Approver">Approver / Finance Controller</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Routing Mode</label>
                <select
                  value={policyForm.workflowType}
                  onChange={(e) => setPolicyForm({ ...policyForm, workflowType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="SEQUENTIAL">SEQUENTIAL</option>
                  <option value="PARALLEL">PARALLEL</option>
                  <option value="ROLE_ROUTED">ROLE_ROUTED</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">SLA Turnaround (Hours)</label>
                <input
                  type="number"
                  value={policyForm.slaHours}
                  onChange={(e) => setPolicyForm({ ...policyForm, slaHours: Number(e.target.value || 24) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPolicyModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingPolicy || !policyForm.policyName.trim()}
                onClick={async () => {
                  setSavingPolicy(true);
                  try {
                    const requiredRoles: any[] = [
                      { stepOrder: 1, stepName: 'Level 1 Department / Accounting Review', requiredRole: policyForm.requiredRole1, slaHours: policyForm.slaHours },
                    ];
                    if (policyForm.requiredRole2) {
                      requiredRoles.push({
                        stepOrder: 2,
                        stepName: 'Level 2 Executive Authorization',
                        requiredRole: policyForm.requiredRole2,
                        slaHours: policyForm.slaHours,
                      });
                    }
                    const r = await apiFetch('/api/journey/approvals/policies', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: policyForm.id,
                        policyCode: policyForm.policyCode,
                        policyName: policyForm.policyName.trim(),
                        entityType: policyForm.entityType,
                        minAmountCentavos: Math.round(Number(policyForm.minAmountPhp || 0) * 100),
                        maxAmountCentavos: policyForm.maxAmountPhp ? Math.round(Number(policyForm.maxAmountPhp) * 100) : null,
                        workflowType: policyForm.workflowType,
                        minApprovalsRequired: requiredRoles.length,
                        requiredRoles,
                        slaHours: policyForm.slaHours,
                        allowDelegation: policyForm.allowDelegation,
                        enforceSod: policyForm.enforceSod,
                      }),
                    });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) {
                      setActionFeedback({ type: 'error', message: d.message || 'Failed to save approval policy.' });
                    } else {
                      setActionFeedback({ type: 'success', message: `Saved approval policy "${policyForm.policyName}".` });
                      setPolicyModalOpen(false);
                      await fetchPhase2Data();
                      await fetchActivityCenter();
                    }
                  } finally {
                    setSavingPolicy(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {savingPolicy ? 'Saving...' : 'Save Policy Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Standing / Temporary Delegation Rule */}
      {delegationModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Create Approval Delegation Rule
              </h3>
              <button type="button" onClick={() => setDelegationModalOpen(false)} className="text-xs font-bold text-slate-400">
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Delegate Approval Authority To</label>
                <select
                  value={delegationForm.toUserId}
                  onChange={(e) => {
                    const m = companyMembers.find((c) => c.id === e.target.value);
                    setDelegationForm({
                      ...delegationForm,
                      toUserId: e.target.value,
                      toUserName: m?.rawName || m?.displayName || e.target.value,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  {companyMembers
                    .filter((m) => m.id !== user?.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Module Scope</label>
                  <select
                    value={delegationForm.moduleScope}
                    onChange={(e) => setDelegationForm({ ...delegationForm, moduleScope: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  >
                    <option value="ALL">ALL Modules</option>
                    <option value="PROCUREMENT">Procurement & Payables</option>
                    <option value="SALES">Sales & Receivables</option>
                    <option value="ACCOUNTING">General Ledger & Journals</option>
                    <option value="PAYROLL">Payroll & HR</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Max Amount Cap (PHP)</label>
                  <input
                    type="number"
                    value={delegationForm.maxAmountPhp}
                    onChange={(e) => setDelegationForm({ ...delegationForm, maxAmountPhp: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Valid Until</label>
                  <input
                    type="date"
                    value={delegationForm.validUntil}
                    onChange={(e) => setDelegationForm({ ...delegationForm, validUntil: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={delegationForm.isTemporary}
                      onChange={(e) => setDelegationForm({ ...delegationForm, isTemporary: e.target.checked })}
                    />
                    <span>Temporary Out-of-Office Rule</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mandatory Audit Justification</label>
                <textarea
                  rows={2}
                  value={delegationForm.reason}
                  onChange={(e) => setDelegationForm({ ...delegationForm, reason: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDelegationModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingDelegation || !delegationForm.toUserId || !delegationForm.reason.trim()}
                onClick={async () => {
                  setSavingDelegation(true);
                  try {
                    const r = await apiFetch('/api/journey/approvals/delegations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        toUserId: delegationForm.toUserId,
                        toUserName: delegationForm.toUserName,
                        moduleScope: delegationForm.moduleScope,
                        maxAmountCentavos: delegationForm.maxAmountPhp ? Math.round(Number(delegationForm.maxAmountPhp) * 100) : null,
                        reason: delegationForm.reason.trim(),
                        isTemporary: delegationForm.isTemporary,
                        validUntil: delegationForm.validUntil,
                      }),
                    });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) {
                      setActionFeedback({ type: 'error', message: d.message || 'Failed to create delegation.' });
                    } else {
                      setActionFeedback({ type: 'success', message: `Created approval delegation to ${delegationForm.toUserName}.` });
                      setDelegationModalOpen(false);
                      await fetchPhase2Data();
                      await fetchActivityCenter();
                    }
                  } finally {
                    setSavingDelegation(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {savingDelegation ? 'Saving...' : 'Create Delegation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Approval Decision / Delegation / Cancellation Modal */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            data-testid="approval-decision-modal"
            className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] font-black uppercase">
                  {decisionModal.actionType} WORKFLOW ACTION
                </span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-1">
                  {decisionModal.workflow.entityType} • {decisionModal.workflow.recordReference}
                </h3>
                <p className="text-xs text-slate-500">
                  Amount: ₱{((decisionModal.workflow.amountCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} •{' '}
                  {decisionModal.stepName || `Step ${decisionModal.workflow.currentStepOrder} of ${decisionModal.workflow.totalSteps}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div
                data-testid="decision-modal-error"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300"
              >
                {modalError}
              </div>
            )}

            {(decisionModal.actionType === 'DELEGATE' ||
              decisionModal.actionType === 'REASSIGN' ||
              decisionModal.actionType === 'ESCALATE') && (() => {
              const validTargets = companyMembers.filter((m) => m.id !== decisionModal.workflow.submittedBy);
              return (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Target Authorized Approver
                  </label>
                  {validTargets.length > 0 ? (
                    <select
                      data-testid="delegate-target-select"
                      value={delegateTargetUserId}
                      onChange={(e) => {
                        const chosen = validTargets.find((m) => m.id === e.target.value);
                        if (chosen) {
                          setDelegateTargetUserId(chosen.id);
                          setDelegateTargetUserName(chosen.rawName || chosen.displayName);
                        } else {
                          setDelegateTargetUserId('');
                          setDelegateTargetUserName('');
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
                    >
                      {validTargets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                      No other active non-submitter company members available to select.
                    </div>
                  )}
                </div>
              );
            })()}

            {decisionModal.actionType === 'APPROVE' &&
              decisionModal.workflow.totalSteps > decisionModal.workflow.currentStepOrder && (
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-xs font-bold text-emerald-900 dark:text-emerald-200 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="approve-all-steps-checkbox"
                    checked={approveAllSteps}
                    onChange={(e) => setApproveAllSteps(e.target.checked)}
                    className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    Approve & Finalize All Remaining Levels (Level {decisionModal.workflow.currentStepOrder} through Level{' '}
                    {decisionModal.workflow.totalSteps})
                  </span>
                </label>
              )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                {decisionModal.actionType === 'APPROVE'
                  ? 'Approval Remarks & Audit Note'
                  : decisionModal.actionType === 'RETURN'
                  ? 'Mandatory Correction Instructions (Required)'
                  : decisionModal.actionType === 'REJECT'
                  ? 'Mandatory Rejection Reason (Required)'
                  : 'Mandatory Governance Justification (Required)'}
              </label>
              <textarea
                rows={3}
                data-testid="decision-reason-input"
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                placeholder="Enter audit remarks, verification notes, or reason..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDecisionModal(null);
                  setModalError(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-decision-submit"
                disabled={submittingDecision}
                onClick={executeModalDecision}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold shadow-xs disabled:opacity-50 ${
                  decisionModal.actionType === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : decisionModal.actionType === 'RETURN'
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : decisionModal.actionType === 'REJECT' || decisionModal.actionType === 'CANCEL'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {submittingDecision ? 'Processing...' : `Confirm ${decisionModal.actionType}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKSPACE 3: FORENSIC AUDIT INVESTIGATION & EVIDENCE EXPORT */}
      {activeWorkspace === 'INVESTIGATION' && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {INVESTIGATION_MODES.map(m => (
                <button
                  key={m.id}
                  onClick={() => setInvestigationMode(m.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    investigationMode === m.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExportForensicEvidence('JSON')}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Signed JSON Evidence</span>
              </button>
              <button
                onClick={() => handleExportForensicEvidence('CSV')}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV Evidence</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase font-bold">
                <tr>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">User & Role</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Entity / Reference</th>
                  <th className="py-2.5 px-3">Result / Severity</th>
                  <th className="py-2.5 px-3">Forensic Remarks</th>
                  <th className="py-2.5 px-3">SHA-256 Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {investigationItems.map((it: any) => (
                  <tr key={it.id}>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{it.timestamp ? new Date(it.timestamp).toLocaleString() : '-'}</td>
                    <td className="py-2.5 px-3 font-bold">{it.userDisplayName} <span className="text-[10px] text-slate-400">({it.role})</span></td>
                    <td className="py-2.5 px-3 font-mono font-bold">{it.action}</td>
                    <td className="py-2.5 px-3 font-mono">{it.entityType} • {it.recordReference || it.entityId}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        it.result === 'FAILED' || it.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {it.result} / {it.severity}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">{it.reason}</td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400">{it.hashShort}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WORKSPACE 4: 27-MODULE COVERAGE MATRIX */}
      {activeWorkspace === 'COVERAGE' && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">Complete 27-Module System Journey & RBAC/SoD Coverage Matrix</h2>
              <p className="text-xs text-slate-500">Live verification of backend persistence, lifecycle transitions, field-level change history, and 360° drill-down across all 27 entities.</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 text-xs font-black">
              {coverageMatrix.filter((m: any) => Number(m.activeRecordCount || 0) > 0).length} / {coverageMatrix.length || 0} Entities With Active Records ({coverageMatrix.length} Registered)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase font-bold">
                <tr>
                  <th className="py-2.5 px-3">Entity Type</th>
                  <th className="py-2.5 px-3">Module Name</th>
                  <th className="py-2.5 px-3">Records</th>
                  <th className="py-2.5 px-3">Audit Events</th>
                  <th className="py-2.5 px-3">Create/Edit</th>
                  <th className="py-2.5 px-3">Approve/Reject/Return</th>
                  <th className="py-2.5 px-3">Archive/SoftDelete/Restore</th>
                  <th className="py-2.5 px-3">16-Field Ownership & Diff</th>
                  <th className="py-2.5 px-3">360° & RBAC/SoD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {coverageMatrix.map((m: any) => (
                  <tr key={m.entityType}>
                    <td className="py-2.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">{m.entityType}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{m.moduleName}</td>
                    <td className="py-2.5 px-3 font-mono">{m.activeRecordCount}</td>
                    <td className="py-2.5 px-3 font-mono">{m.auditEventCount}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">{m.capabilities?.createEdit !== false ? 'ENABLED' : 'READ_ONLY'}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">{m.capabilities?.approveRejectReturn ? 'MAKER_CHECKER' : 'MASTER_GOV'}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">{m.capabilities?.archiveRestore !== false ? 'ENABLED' : 'IMMUTABLE'}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">{Number(m.auditEventCount || 0) > 0 ? 'RECORDED' : 'NO_EVENTS_YET'}</td>
                    <td className={`py-2.5 px-3 font-bold ${Number(m.activeRecordCount || 0) > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {Number(m.activeRecordCount || 0) > 0 ? 'ACTIVE_RECORDS' : 'NO_RECORDS'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WORKSPACE 5: MANAGEMENT GOVERNANCE ANALYTICS */}
      {activeWorkspace === 'ANALYTICS' && analytics && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-bold uppercase text-slate-400">Pending & Overdue Approvals</div>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                {analytics.approvalsSummary?.pendingApprovalsCount || 0}
                <span className="text-xs font-bold text-rose-600 ml-2">
                  ({analytics.approvalsSummary?.overdueApprovalsCount || 0} Overdue/Escalated)
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Avg Approval Time: {analytics.approvalsSummary?.averageApprovalTimeSeconds || 0}s across {analytics.approvalsSummary?.completedStepsCount || 0} steps
              </div>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-bold uppercase text-slate-400">Rejected / Returned / Cancelled</div>
              <div className="text-2xl font-black text-amber-600 mt-1">
                {(analytics.transactionExceptionCounts?.rejected || 0) +
                  (analytics.transactionExceptionCounts?.returnedForCorrection || 0) +
                  (analytics.transactionExceptionCounts?.cancelled || 0)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Rejected: {analytics.transactionExceptionCounts?.rejected || 0} • Returned: {analytics.transactionExceptionCounts?.returnedForCorrection || 0} • Cancelled: {analytics.transactionExceptionCounts?.cancelled || 0}
              </div>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-bold uppercase text-slate-400">Unresolved Governance Exceptions</div>
              <div className="text-2xl font-black text-rose-600 mt-1">
                {analytics.unresolvedExceptionsCount || 0}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Critical Events: {analytics.auditEventsSummary?.criticalEvents || 0} • Total Audit Events: {analytics.auditEventsSummary?.totalEvents || 0}
              </div>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-bold uppercase text-slate-400">Document Vault & OCR Lineage</div>
              <div className="text-2xl font-black text-indigo-600 mt-1">
                {analytics.documentProcessingStatus?.totalDocuments || 0} Docs ({analytics.documentProcessingStatus?.totalVersionsPreserved || 0} Versions)
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                OCR Verified: {analytics.documentProcessingStatus?.ocrCompletedOrVerified || 0} • Linked: {analytics.documentProcessingStatus?.linkedToTransactions || 0}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 15 Standardized Lifecycle Category Pills */}
      {activeWorkspace === 'STREAM' && (
      <>
      <div className="bg-white dark:bg-[#111827] p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-1.5 overflow-x-auto">
        {CATEGORIES.map(cat => {
          const active = category === cat.id;
          const count = counts[cat.id] ?? 0;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 ${
                active
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>{cat.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                active ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Multi-Dimension Filters (Company/Tenant, Module, Record Type, User, Role, Action, Status, Date Range, Record Reference) */}
      <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Record ref, action, remarks..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="relative">
          <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="User name or ID..."
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Roles</option>
            <option value="OWNER">Owner / Super Admin</option>
            <option value="ADMIN">Company Administrator</option>
            <option value="APPROVER">Approver / Manager</option>
            <option value="ACCOUNTANT">Accountant / Bookkeeper</option>
            <option value="AUDITOR">Auditor</option>
          </select>
        </div>

        <div>
          <select
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Modules / Record Types</option>
            <option value="JOURNAL_ENTRY">General Journal (JOURNAL_ENTRY)</option>
            <option value="SALES_INVOICE">Sales Invoices (SALES_INVOICE)</option>
            <option value="PURCHASE_BILL">Purchase Bills (PURCHASE_BILL)</option>
            <option value="CUSTOMER_PAYMENT">Customer Payments (AR)</option>
            <option value="SUPPLIER_PAYMENT">Supplier Payments (AP)</option>
            <option value="PURCHASE_REQUISITION">Purchase Requisitions (PR)</option>
            <option value="PURCHASE_ORDER">Purchase Orders (PO)</option>
            <option value="GOODS_RECEIPT_NOTE">Goods Receipt Notes (GRN)</option>
            <option value="CASH_TRANSACTION">Cash & Banking (CASH_TRANSACTION)</option>
            <option value="BANK_RECONCILIATION">Bank Reconciliations</option>
            <option value="PAYROLL_RUN">Payroll Runs (PAYROLL_RUN)</option>
            <option value="FIXED_ASSET">Fixed Assets (FIXED_ASSET)</option>
            <option value="TAX_FILING">BIR Tax Filings (TAX_FILING)</option>
            <option value="BUDGET">Budgets (BUDGET)</option>
            <option value="ACCOUNT">Chart of Accounts (ACCOUNT)</option>
            <option value="CUSTOMER">Customers (CUSTOMER)</option>
            <option value="VENDOR">Suppliers / Vendors (VENDOR)</option>
            <option value="DOCUMENT">Documents & OCR (DOCUMENT)</option>
            <option value="LEDGER_DATA_ENTRY">Ledger Data Entry (BIR)</option>
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="UNDER_REVIEW">UNDER REVIEW</option>
            <option value="APPROVED">APPROVED</option>
            <option value="POSTED">POSTED</option>
            <option value="RETURNED">RETURNED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="ARCHIVED">ARCHIVED</option>
            <option value="SOFT_DELETED">SOFT DELETED</option>
            <option value="REVERSED">REVERSED</option>
          </select>
        </div>

        <div>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            title="Start Date"
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100"
          />
        </div>

        <div>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            title="End Date"
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Activity Stream Table */}
      {loading ? (
        <div className="p-14 text-center text-slate-400 flex items-center justify-center gap-2 text-sm bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
          <span>Loading activity journey stream...</span>
        </div>
      ) : (
        <TableScrollContainer
          title={`Activity Journey Stream (${filteredItems.length} records)`}
          totalRecordsCount={filteredItems.length}
          density={streamDensity}
          onDensityChange={setStreamDensity}
          maxHeight="calc(100vh - 340px)"
          footer={
            <PaginationControls
              totalCount={filteredItems.length}
              itemCount={paginatedStreamItems.length}
              pageIndex={streamPageIndex}
              pageSize={streamPageSize}
              pageSizeOptions={[20, 50, 100]}
              hasNextPage={(streamPageIndex + 1) * streamPageSize < filteredItems.length}
              onNextPage={() => setStreamPageIndex((p) => p + 1)}
              onPrevPage={() => setStreamPageIndex((p) => Math.max(0, p - 1))}
              onFirstPage={() => setStreamPageIndex(0)}
              onLastPage={() => setStreamPageIndex(Math.max(0, Math.ceil(filteredItems.length / streamPageSize) - 1))}
              onPageSizeChange={(newSize) => {
                setStreamPageSize(newSize);
                setStreamPageIndex(0);
              }}
              loading={loading}
            />
          }
        >
          <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300 min-w-[980px]">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase font-bold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-3">Timestamp</th>
                <th className="py-3 px-3">Lifecycle Category</th>
                <th className="py-3 px-3">Action</th>
                <th className="py-3 px-3">Module / Record Ref</th>
                <th className="py-3 px-3">Actor & Role</th>
                <th className="py-3 px-3">Before & After / Remarks</th>
                <th className="py-3 px-3 text-right">Record Details (360°)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {paginatedStreamItems.map((item) => {
                const primaryCat = item.categories?.[0] || item.category || 'ACTIVITY';
                const actorName = item.userDisplayName || item.actorName || item.userEmail || 'System';
                const actorRole = item.role || item.actorRole || 'Member';
                const recordRef = item.recordReference || item.entityName || item.entityId;
                const canonicalType = item.canonicalEntityType || item.entityType;
                return (
                <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString('en-PH', {
                      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                    }) : '-'}
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                      primaryCat === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' :
                      primaryCat === 'PENDING_APPROVAL' ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300' :
                      primaryCat === 'REJECTED' || primaryCat === 'RETURNED' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300' :
                      primaryCat === 'CANCELLED' || primaryCat === 'DELETED' || primaryCat === 'REVERSED' || primaryCat === 'FAILED_ACTIONS' || primaryCat === 'SECURITY_EVENTS' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300' :
                      primaryCat === 'UPDATED' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300' :
                      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      {primaryCat.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-slate-800 dark:text-slate-100">
                    {item.action?.replace(/_/g, ' ')}
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-[10px] font-extrabold uppercase text-indigo-600 dark:text-indigo-400 block">
                      {canonicalType}
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {recordRef}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-900 dark:text-white">{actorName}</div>
                    <div className="text-[10px] text-slate-400">{actorRole} • {item.companyId?.slice(0, 14)}</div>
                  </td>
                  <td className="py-3 px-3 max-w-md">
                    {item.previousStatus && item.newStatus && item.previousStatus !== item.newStatus && (
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold mb-1 mr-2">
                        <span>{item.previousStatus}</span>
                        <ArrowRight className="w-3 h-3 text-indigo-500" />
                        <span className="text-indigo-600 dark:text-indigo-400">{item.newStatus}</span>
                      </div>
                    )}
                    {item.reason && (
                      <div className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                        {item.reason}
                      </div>
                    )}
                    {item.fieldDiffs && item.fieldDiffs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.fieldDiffs.slice(0, 3).map((d: any, idx: number) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[10px] font-mono text-amber-800 dark:text-amber-300"
                          >
                            <strong>{d.field}:</strong> {String(d.before).slice(0, 18)} &rarr; {String(d.after).slice(0, 18)}
                          </span>
                        ))}
                        {item.fieldDiffs.length > 3 && (
                          <span className="text-[10px] text-slate-400 font-bold">+{item.fieldDiffs.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    {item.entityType && item.entityId && (
                      <div className="inline-flex items-center gap-1.5">
                        {item.fieldDiffs && item.fieldDiffs.length > 0 && (
                          <button
                            onClick={() => setSelectedRecord({
                              entityType: item.entityType,
                              entityId: item.entityId,
                              initialTab: 'changes'
                            })}
                            className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[11px] font-bold hover:bg-amber-100 flex items-center gap-1"
                            title="View Before-and-After Comparison"
                          >
                            <GitCompare className="w-3.5 h-3.5" /> Diff
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedRecord({
                            entityType: item.entityType,
                            entityId: item.entityId,
                            initialTab: 'overview'
                          })}
                          className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold hover:bg-indigo-100 flex items-center gap-1.5"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          <span>360° Journey</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-slate-400">
                    No activity records match the selected category and filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScrollContainer>
      )}
      </>
      )}

      {/* 360° Record Journey Modal */}
      {selectedRecord && (
        <RecordActivityModal
          isOpen={!!selectedRecord}
          onClose={() => setSelectedRecord(null)}
          entityType={selectedRecord.entityType}
          entityId={selectedRecord.entityId}
          initialTab={selectedRecord.initialTab}
          onActionSuccess={() => { fetchActivityCenter(); fetchPhase2Data(); }}
        />
      )}
    </div>
  );
}

