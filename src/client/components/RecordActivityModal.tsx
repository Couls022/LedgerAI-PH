import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Clock, User, ShieldCheck, X, FileText, CheckCircle2, AlertTriangle,
  ArrowRight, Activity, Calendar, Edit3, Send, ThumbsUp, ThumbsDown,
  RotateCcw, Ban, Archive, Trash2, RefreshCw, Copy, Layers, Link2,
  FolderOpen, Lock, ChevronLeft, Eye, Check, GitCompare, Award, Hash, Banknote
} from 'lucide-react';
import { getEntity360Definition } from '../../shared/entity360Registry';
import {
  getCanonicalLifecycleStageState,
  isFinalizedLockedStatus,
  LifecycleStageKey,
} from '../../shared/workflowLifecycle';
import { EntitySpecific360Dispatcher } from './entity360/Specialized360Renderers';
import { apiFetch } from '../utils/apiClient';

export interface RecordActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  title?: string;
  initialTab?: 'overview' | 'details' | 'activity' | 'approvals' | 'changes' | 'related' | 'documents' | 'audit';
  initialAction?: string;
  onActionSuccess?: () => void;
}

type JourneyTab = 'overview' | 'details' | 'activity' | 'approvals' | 'changes' | 'related' | 'documents' | 'audit';

const formatPHP = (cents: number | undefined | null) => {
  if (cents === undefined || cents === null || isNaN(Number(cents))) return '₱0.00';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(cents) / 100);
};

const formatDateTime = (ts: string | null | undefined) => {
  if (!ts) return 'N/A';
  try {
    return new Date(ts).toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return ts;
  }
};

const getStatusBadgeStyle = (status: string) => {
  const s = (status || 'DRAFT').toUpperCase();
  if (s === 'POSTED' || s === 'PAID' || s === 'ACTIVE' || isFinalizedLockedStatus(s)) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
  }
  if (s === 'PARTIAL' || s === 'PARTIALLY_PAID') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-800';
  }
  if (s === 'APPROVED') {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300 dark:border-blue-800';
  }
  if (s === 'SUBMITTED' || s === 'UNDER_REVIEW' || s === 'PENDING_APPROVAL') {
    return 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border-purple-300 dark:border-purple-800';
  }
  if (s === 'RETURNED' || s === 'REJECTED') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-800';
  }
  if (s === 'CANCELLED' || s === 'VOIDED' || s === 'REVERSED' || s === 'SOFT_DELETED') {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300 dark:border-rose-800';
  }
  if (s === 'ARCHIVED' || s === 'REMOVED') {
    return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700';
  }
  return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700';
};

export default function RecordActivityModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  title,
  initialTab = 'overview',
  initialAction,
  onActionSuccess
}: RecordActivityModalProps) {
  const [activeEntity, setActiveEntity] = useState<{ entityType: string; entityId: string; title?: string }>({
    entityType,
    entityId,
    title
  });
  const [breadcrumbStack, setBreadcrumbStack] = useState<Array<{ entityType: string; entityId: string; title?: string }>>([]);
  const [activeTab, setActiveTab] = useState<JourneyTab>(initialTab);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRawLog, setSelectedRawLog] = useState<string | null>(null);
  const [inspectedUser, setInspectedUser] = useState<{ label: string; name: string; id?: string | null; role?: string | null; timestamp?: string | null } | null>(null);

  // Action execution state
  const [viewMode, setViewMode] = useState<'workspace' | 'drawer'>('workspace');
  const [pendingAction, setPendingAction] = useState<string | null>(initialAction || null);
  const [actionReason, setActionReason] = useState('');
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectionCashPhp, setCollectionCashPhp] = useState('');
  const [collectionCwtPhp, setCollectionCwtPhp] = useState('0.00');
  const [collectionOrNumber, setCollectionOrNumber] = useState('');
  const [collectionDate, setCollectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectionMethod, setCollectionMethod] = useState('BANK_TRANSFER');
  const [collectionCashAccountId, setCollectionCashAccountId] = useState('');
  const [collectionReference, setCollectionReference] = useState('');
  const [disbursementCashPhp, setDisbursementCashPhp] = useState('');
  const [disbursementEwtPhp, setDisbursementEwtPhp] = useState('0.00');
  const [disbursementDvNumber, setDisbursementDvNumber] = useState('');
  const [disbursementDate, setDisbursementDate] = useState(new Date().toISOString().slice(0, 10));
  const [disbursementMethod, setDisbursementMethod] = useState('BANK_TRANSFER');
  const [disbursementCashAccountId, setDisbursementCashAccountId] = useState('');
  const [disbursementReference, setDisbursementReference] = useState('');
  const [editFields, setEditFields] = useState<Record<string, any>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const pageLimit = 50;

  useEffect(() => {
    if (isOpen) {
      setActiveEntity({ entityType, entityId, title });
      setBreadcrumbStack([]);
      setActiveTab(initialTab);
      setPendingAction(initialAction || null);
      setActionFeedback(null);
      setInspectedUser(null);
      setPageOffset(0);
    }
  }, [isOpen, entityType, entityId, title, initialTab, initialAction]);

  const fetch360Data = async (targetType: string, targetId: string, offset = pageOffset) => {
    if (!targetType || !targetId) return;
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch(
        `/api/journey/360/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}?limit=${pageLimit}&offset=${offset}`
      );
      setData(json);

      // Initialize editable fields from current record
      if (json.record) {
        const r = json.record;
        const initEdit: Record<string, any> = {};
        if (r.description !== undefined) initEdit.description = r.description || '';
        if (r.notes !== undefined) initEdit.notes = r.notes || '';
        if (r.reference !== undefined) initEdit.reference = r.reference || '';
        if (r.entryDate !== undefined) initEdit.entryDate = r.entryDate || '';
        if (r.invoiceDate !== undefined) initEdit.invoiceDate = r.invoiceDate || '';
        if (r.dueDate !== undefined) initEdit.dueDate = r.dueDate || '';
        if (r.billDate !== undefined) initEdit.billDate = r.billDate || '';
        if (r.paymentDate !== undefined) initEdit.paymentDate = r.paymentDate || '';
        if (r.totalAmount !== undefined) initEdit.totalAmountPhp = ((Number(r.totalAmount) || 0) / 100).toFixed(2);
        if (r.amount !== undefined) initEdit.amountPhp = ((Number(r.amount) || 0) / 100).toFixed(2);
        if (r.monthlyLimit !== undefined) initEdit.monthlyLimitPhp = ((Number(r.monthlyLimit) || 0) / 100).toFixed(2);
        if (r.unitPrice !== undefined) initEdit.unitPricePhp = ((Number(r.unitPrice) || 0) / 100).toFixed(2);
        if (r.unitCost !== undefined) initEdit.unitCostPhp = ((Number(r.unitCost) || 0) / 100).toFixed(2);
        if (r.basicSalary !== undefined) initEdit.basicSalaryPhp = ((Number(r.basicSalary) || 0) / 100).toFixed(2);
        if (r.acquisitionCost !== undefined) initEdit.acquisitionCostPhp = ((Number(r.acquisitionCost) || 0) / 100).toFixed(2);
        if (r.category !== undefined) initEdit.category = r.category || '';
        if (r.periodMonth !== undefined) initEdit.periodMonth = r.periodMonth || '';
        if (r.legalName !== undefined) initEdit.legalName = r.legalName || '';
        if (r.tradeName !== undefined) initEdit.tradeName = r.tradeName || '';
        if (r.accountName !== undefined) initEdit.accountName = r.accountName || '';
        if (r.name !== undefined) initEdit.name = r.name || '';
        if (r.title !== undefined) initEdit.title = r.title || '';
        if (r.tin !== undefined) initEdit.tin = r.tin || '';
        if (r.address !== undefined) initEdit.address = r.address || '';
        if (r.contactPerson !== undefined) initEdit.contactPerson = r.contactPerson || '';
        if (r.paymentTerms !== undefined) initEdit.paymentTerms = r.paymentTerms || '';
        if (r.quantityOnHand !== undefined) initEdit.quantityOnHand = String(r.quantityOnHand ?? 0);
        if (r.payeeName !== undefined) initEdit.payeeName = r.payeeName || '';
        if (r.custodianName !== undefined) initEdit.custodianName = r.custodianName || '';
        setEditFields(initEdit);
        const balDueCent = Number(r.balanceDue ?? 0);
        setCollectionCashPhp((balDueCent / 100).toFixed(2));
        setCollectionCwtPhp('0.00');
        setCollectionOrNumber(`CR-${new Date().toISOString().slice(0, 4)}-${Date.now().toString().slice(-6)}`);
        setCollectionDate(new Date().toISOString().slice(0, 10));
        setCollectionReference('');
        setDisbursementCashPhp((balDueCent / 100).toFixed(2));
        setDisbursementEwtPhp('0.00');
        setDisbursementDvNumber(`DV-${new Date().toISOString().slice(0, 4)}-${Date.now().toString().slice(-6)}`);
        setDisbursementDate(new Date().toISOString().slice(0, 10));
        setDisbursementReference('');
        const colAccounts = json?.entitySpecificContext?.collectionAccounts || [];
        if (colAccounts.length > 0) {
          setCollectionCashAccountId(colAccounts[0].id);
          setDisbursementCashAccountId(colAccounts[0].id);
        }
      }
    } catch (err: any) {
      console.error('Error loading 360 journey:', err);
      setError(err.message || 'Unable to load record journey.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeEntity.entityType && activeEntity.entityId) {
      fetch360Data(activeEntity.entityType, activeEntity.entityId, pageOffset);
    }
  }, [isOpen, activeEntity.entityType, activeEntity.entityId, pageOffset]);

  if (!isOpen) return null;

  const handleDrillDown = (rel: any) => {
    const targetId = rel.entityId || rel.id;
    if (!rel.entityType || !targetId) return;
    setBreadcrumbStack(prev => [...prev, activeEntity]);
    setActiveEntity({
      entityType: rel.entityType,
      entityId: targetId,
      title: rel.title || `${rel.entityType}: ${rel.reference || targetId}`
    });
    setActiveTab('overview');
    setPendingAction(null);
    setActionFeedback(null);
  };

  const handleNavigateEntity = (targetEntityType: string, targetEntityId: string, label?: string) => {
    if (!targetEntityType || !targetEntityId) return;
    setBreadcrumbStack(prev => [...prev, activeEntity]);
    setActiveEntity({
      entityType: targetEntityType,
      entityId: targetEntityId,
      title: label || `${targetEntityType} #${targetEntityId}`
    });
    setActiveTab('overview');
    setPendingAction(null);
    setActionFeedback(null);
  };

  const handleBreadcrumbBack = () => {
    if (breadcrumbStack.length === 0) return;
    const nextStack = [...breadcrumbStack];
    const prev = nextStack.pop()!;
    setBreadcrumbStack(nextStack);
    setActiveEntity(prev);
    setPendingAction(null);
    setActionFeedback(null);
  };

  const [conflictData, setConflictData] = useState<{
    message: string;
    currentVersion?: number;
    clientVersion?: number;
    updatedAt?: string;
    updatedBy?: string;
  } | null>(null);

  const executeWorkflowAction = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pendingAction) return;

    const mandatoryReasonActions = ['REJECT', 'RETURN', 'CANCEL', 'SOFT_DELETE', 'REVERSE'];
    if (mandatoryReasonActions.includes(pendingAction) && !actionReason.trim()) {
      setActionFeedback({
        type: 'error',
        message: `A mandatory reason/remarks is required to ${pendingAction.replace('_', ' ').toLowerCase()} this record.`
      });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);
    try {
      const currentVer = record?.version || 1;
      const payload: any = {
        action: pendingAction,
        reason: actionReason.trim() || undefined,
        reverseDate: pendingAction === 'REVERSE' ? reverseDate : undefined,
        expectedVersion: conflictData?.currentVersion ?? currentVer
      };

      if (pendingAction === 'EDIT') {
        const updates: Record<string, any> = { ...editFields };
        const phpMap: Array<[string, string]> = [
          ['totalAmountPhp', 'totalAmount'],
          ['amountPhp', 'amount'],
          ['monthlyLimitPhp', 'monthlyLimit'],
          ['unitPricePhp', 'unitPrice'],
          ['unitCostPhp', 'unitCost'],
          ['basicSalaryPhp', 'basicSalary'],
          ['acquisitionCostPhp', 'acquisitionCost'],
        ];
        for (const [phpKey, centKey] of phpMap) {
          if (updates[phpKey] !== undefined) {
            updates[centKey] = Math.round((parseFloat(updates[phpKey]) || 0) * 100);
            delete updates[phpKey];
          }
        }
        if (updates.quantityOnHand !== undefined) {
          updates.quantityOnHand = Math.round(Number(updates.quantityOnHand) || 0);
        }
        payload.updates = updates;
      }

      if (pendingAction === 'RECORD_COLLECTION') {
        const cashCentavos = Math.round((parseFloat(collectionCashPhp) || 0) * 100);
        const cwtCentavos = Math.round((parseFloat(collectionCwtPhp) || 0) * 100);
        const balDueCent = Number(record?.balanceDue ?? 0);
        if (cashCentavos < 0 || cwtCentavos < 0 || cashCentavos + cwtCentavos <= 0) {
          setActionFeedback({
            type: 'error',
            message: 'Enter a valid collection amount greater than ₱0.00.'
          });
          setActionLoading(false);
          return;
        }
        if (cashCentavos + cwtCentavos > balDueCent) {
          setActionFeedback({
            type: 'error',
            message: `Cash + CWT (${formatPHP(cashCentavos + cwtCentavos)}) exceeds the remaining invoice Balance Due (${formatPHP(balDueCent)}).`
          });
          setActionLoading(false);
          return;
        }
        payload.amount = cashCentavos;
        payload.withholdingTaxAmount = cwtCentavos;
        payload.officialReceiptNumber = collectionOrNumber.trim() || undefined;
        payload.paymentDate = collectionDate;
        payload.paymentMethod = collectionMethod;
        payload.cashAccountId = collectionCashAccountId || undefined;
        payload.reference = collectionReference.trim() || undefined;
      }

      if (pendingAction === 'RECORD_DISBURSEMENT') {
        const cashCentavos = Math.round((parseFloat(disbursementCashPhp) || 0) * 100);
        const ewtCentavos = Math.round((parseFloat(disbursementEwtPhp) || 0) * 100);
        const balDueCent = Number(record?.balanceDue ?? 0);
        if (cashCentavos < 0 || ewtCentavos < 0 || cashCentavos + ewtCentavos <= 0) {
          setActionFeedback({
            type: 'error',
            message: 'Enter a valid disbursement amount greater than ₱0.00.'
          });
          setActionLoading(false);
          return;
        }
        if (cashCentavos + ewtCentavos > balDueCent) {
          setActionFeedback({
            type: 'error',
            message: `Disbursement + EWT (${formatPHP(cashCentavos + ewtCentavos)}) exceeds the remaining bill Balance Due (${formatPHP(balDueCent)}).`
          });
          setActionLoading(false);
          return;
        }
        payload.amount = cashCentavos;
        payload.withholdingTaxAmount = ewtCentavos;
        payload.paymentNumber = disbursementDvNumber.trim() || undefined;
        payload.paymentDate = disbursementDate;
        payload.paymentMethod = disbursementMethod;
        payload.cashAccountId = disbursementCashAccountId || undefined;
        payload.reference = disbursementReference.trim() || undefined;
      }

      const resData = await apiFetch(
        `/api/journey/action/${encodeURIComponent(activeEntity.entityType)}/${encodeURIComponent(activeEntity.entityId)}`,
        {
          method: 'POST',
          body: payload
        }
      );

      setConflictData(null);
      setActionFeedback({
        type: 'success',
        message: resData.message || `Action ${pendingAction} completed and logged to the immutable audit trail.`
      });
      setPendingAction(null);
      setActionReason('');
      await fetch360Data(activeEntity.entityType, activeEntity.entityId);
      if (onActionSuccess) onActionSuccess();
    } catch (err: any) {
      const errData = err?.data || {};
      if (err?.status === 409 || errData?.error === 'CONCURRENT_MODIFICATION_CONFLICT') {
        const currentVer = record?.version || 1;
        setConflictData({
          message: errData.message || err.message || 'CONCURRENT_MODIFICATION_CONFLICT: Record was modified by another user.',
          currentVersion: errData.details?.currentVersion,
          clientVersion: errData.details?.clientVersion || currentVer,
          updatedAt: errData.details?.updatedAt,
          updatedBy: errData.details?.updatedBy
        });
        setActionFeedback({
          type: 'error',
          message: `CONCURRENT MODIFICATION CONFLICT: Record '${activeEntity.entityId}' was modified by another user (Current server version: v${errData.details?.currentVersion || 'latest'}, your expected version: v${currentVer}). Your unsaved local changes have been preserved.`
        });
        return;
      }
      setActionFeedback({
        type: 'error',
        message: err.message || 'Workflow action failed'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const ownership = data?.ownership || {};
  const record = data?.record;
  const rawCurrentStatus = (data?.currentStatus || record?.status || 'DRAFT').toUpperCase();
  const currentStatus = rawCurrentStatus === 'PARTIALLY_PAID' ? 'PARTIAL' : rawCurrentStatus;
  const allowedActions: string[] = data?.allowedActions || [];
  const activityHistory: any[] = data?.activityHistory || [];
  const approvalHistory: any[] = data?.approvalHistory || [];
  const changeHistory: any[] = data?.changeHistory || [];
  const relatedRecords: any[] = data?.relatedRecords || [];
  const documentsList: any[] = data?.documents || [];
  const linesList: any[] = data?.lines || [];
  const approvalOrchestration: any[] = data?.approvalOrchestration || [];
  const documentVersions: any[] = data?.documentVersions || [];
  const documentOcrHistory: any[] = data?.documentOcrHistory || [];
  const lifecycleCheckpoints: any[] = data?.lifecycleCheckpoints || [];
  const missingReferences: any[] = data?.missingReferences || [];
  const paginationInfo = data?.pagination || { total: activityHistory.length, limit: pageLimit, offset: pageOffset, hasMore: false };

  // Build canonical 5-step Transaction Journey summary matching the user's specification (excluding FAILED events)
  const nonFailedHistory = activityHistory.filter(a => a.result !== 'FAILED');
  const chronologicalAsc = [...nonFailedHistory].reverse();
  const createdEvt = chronologicalAsc.find(a =>
    a.action?.includes('CREATE') || a.action?.includes('DRAFT')
  ) || chronologicalAsc[0];
  const editedEvents = chronologicalAsc.filter(a =>
    (a.action?.includes('EDIT') || a.action?.includes('UPDATE')) && !a.action?.includes('CREATE')
  );
  const latestEditEvt = editedEvents.length > 0 ? editedEvents[editedEvents.length - 1] : null;
  const submittedEvt = [...chronologicalAsc].reverse().find(a => a.action?.includes('SUBMIT'));
  const approvedEvt = [...chronologicalAsc].reverse().find(a => a.action?.includes('APPROVE') && !a.action?.includes('POST'));
  const postedEvt = [...chronologicalAsc].reverse().find(a => a.action?.startsWith('POST_'));
  const lastActivityEvt = nonFailedHistory[0];

  const isFinalizedLocked = isFinalizedLockedStatus(currentStatus);

  useEffect(() => {
    if (pendingAction && data && !allowedActions.includes(pendingAction)) {
      setPendingAction(null);
    }
  }, [pendingAction, data, allowedActions]);

  const lifecycleStages: Array<{ key: LifecycleStageKey; label: string; sub: string }> = [
    { key: 'DRAFT', label: '1. DRAFT', sub: 'Created / Editable' },
    { key: 'SUBMITTED', label: '2. SUBMITTED', sub: 'Under Review / Locked' },
    { key: 'APPROVED', label: '3. APPROVED', sub: 'SoD Verified' },
    { key: 'POSTED', label: '4. POSTED / LOCKED', sub: 'Authoritative GL' }
  ];

  const getStageState = (stageKey: LifecycleStageKey) => {
    return getCanonicalLifecycleStageState(currentStatus, stageKey);
  };

  const actionButtonsConfig: Array<{
    action: string;
    label: string;
    icon: any;
    style: string;
    requiresPrompt?: boolean;
  }> = [
    { action: 'EDIT', label: 'Edit Record', icon: Edit3, style: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50', requiresPrompt: true },
    { action: 'SUBMIT', label: 'Submit for Approval', icon: Send, style: 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700', requiresPrompt: true },
    { action: 'REVIEW', label: 'Start Review', icon: Eye, style: 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700', requiresPrompt: true },
    { action: 'APPROVE', label: 'Approve', icon: ThumbsUp, style: 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700', requiresPrompt: true },
    { action: 'POST', label: 'Post to GL', icon: CheckCircle2, style: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700', requiresPrompt: true },
    { action: 'RECORD_COLLECTION', label: 'Record Collection (OR)', icon: Banknote, style: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700', requiresPrompt: true },
    { action: 'RECORD_DISBURSEMENT', label: 'Disbursement Voucher (DV)', icon: Banknote, style: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700', requiresPrompt: true },
    { action: 'RETURN', label: 'Return for Correction', icon: RotateCcw, style: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100', requiresPrompt: true },
    { action: 'REJECT', label: 'Reject', icon: ThumbsDown, style: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-100', requiresPrompt: true },
    { action: 'REVERSE', label: 'Reverse Entry', icon: RefreshCw, style: 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700', requiresPrompt: true },
    { action: 'ADJUST', label: 'Adjust / Correcting Entry', icon: GitCompare, style: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100', requiresPrompt: true },
    { action: 'CANCEL', label: 'Cancel', icon: Ban, style: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100', requiresPrompt: true },
    { action: 'COPY', label: 'Copy to Draft', icon: Copy, style: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-200', requiresPrompt: true },
    { action: 'ARCHIVE', label: 'Archive', icon: Archive, style: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-200', requiresPrompt: true },
    { action: 'REMOVE', label: 'Remove from List', icon: Eye, style: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-200', requiresPrompt: true },
    { action: 'SOFT_DELETE', label: 'Soft Delete', icon: Trash2, style: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-rose-100', requiresPrompt: true },
    { action: 'RESTORE', label: 'Restore Record', icon: RotateCcw, style: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700', requiresPrompt: true },
    { action: 'DEACTIVATE', label: 'Deactivate', icon: Ban, style: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100', requiresPrompt: true },
    { action: 'REACTIVATE', label: 'Reactivate', icon: CheckCircle2, style: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700', requiresPrompt: true }
  ];

  const entityDef = data?.entity360Definition || getEntity360Definition(activeEntity.entityType);

  const badgeCountMap: Record<string, number | undefined> = {
    details: linesList.length || undefined,
    activity: activityHistory.length,
    approvals: approvalHistory.length || approvalOrchestration.length,
    changes: changeHistory.length,
    related: relatedRecords.length,
    documents: documentsList.length,
  };

  const tabs: Array<{ id: JourneyTab; label: string; badge?: number }> = (
    entityDef?.applicableTabs || [
      { id: 'overview', label: '1. Overview' },
      { id: 'details', label: '2. Details' },
      { id: 'activity', label: '3. Activity Journey', badgeKey: 'activity' },
      { id: 'related', label: '4. Related Records', badgeKey: 'related' },
      { id: 'documents', label: '5. Documents', badgeKey: 'documents' },
    ]
  ).map((t: any) => ({
    id: t.id as JourneyTab,
    label: t.label,
    badge: t.badgeKey ? badgeCountMap[t.badgeKey] : t.id === 'details' ? badgeCountMap.details : undefined,
  }));

  if (!isOpen) return null;

  return typeof document !== 'undefined' ? createPortal(
    <div
      className={`fixed inset-0 z-[99999] flex ${viewMode === 'drawer' ? 'justify-end' : 'items-center justify-center p-2 sm:p-4 md:p-6'} bg-slate-950/70 backdrop-blur-xs motion-backdrop-enter overflow-y-auto`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white dark:bg-[#11192B] border border-slate-200 dark:border-[#1E2D45] shadow-2xl flex flex-col overflow-hidden my-auto ${
          viewMode === 'drawer'
            ? 'w-full max-w-2xl h-full rounded-l-2xl motion-drawer-right'
            : 'rounded-2xl sm:rounded-3xl max-w-6xl w-full max-h-[94vh] motion-modal-enter'
        }`}
      >
        {/* Top Modal Header */}
        <div className="shrink-0 px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-[#1E2D45] flex flex-wrap items-center justify-between gap-3 bg-slate-50/90 dark:bg-[#0D1524]">
          <div className="flex items-center gap-3 min-w-0">
            {breadcrumbStack.length > 0 && (
              <button
                onClick={handleBreadcrumbBack}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-xs font-semibold text-blue-700 dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-[#1E2D45] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                title="Back to previous record in 360° chain"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            )}
            <div className="w-9 h-9 bg-[#0F1C2E] dark:bg-blue-600 text-teal-300 dark:text-white rounded-xl flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap">
                  {entityDef?.headerConfig?.workspaceBadge || (viewMode === 'drawer' ? 'Quick View 360° Drawer' : 'Record Details Workspace')}
                </span>
                <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base truncate">
                  {activeEntity.title || record?.journalNumber || record?.invoiceNumber || record?.billNumber || record?.legalName || record?.accountName || record?.name || record?.assetName || record?.engagementName || record?.fileName || `${activeEntity.entityType} #${activeEntity.entityId}`}
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${getStatusBadgeStyle(currentStatus)}`}>
                  {currentStatus.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 truncate">
                {entityDef?.moduleLabel} • {entityDef?.submoduleLabel} • ID: {activeEntity.entityId} • Touches: {ownership.totalTouches || activityHistory.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode(prev => (prev === 'workspace' ? 'drawer' : 'workspace'))}
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#162238] border border-slate-200 dark:border-[#24344F] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-500 dark:hover:border-sky-400 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Switch between Quick View Drawer and Full 360° Workspace"
            >
              <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
              <span>{viewMode === 'workspace' ? 'Quick Drawer' : 'Full Workspace'}</span>
            </button>
            <button
              onClick={() => fetch360Data(activeEntity.entityType, activeEntity.entityId)}
              className="p-2 text-slate-500 hover:text-blue-600 dark:hover:text-sky-400 rounded-xl hover:bg-slate-200/60 dark:hover:bg-[#1B2942] transition-colors cursor-pointer"
              title="Refresh 360° Record Journey"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Entity-Specific Header Banner OR Canonical Accounting Workflow Stepper */}
        <div className="shrink-0 px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-3">
          {entityDef?.headerConfig?.showsAccountingWorkflowStepper ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {lifecycleStages.map((st) => {
                const state = getStageState(st.key);
                return (
                  <div
                    key={st.key}
                    className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between transition-all ${
                      state === 'completed'
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300'
                        : state === 'current'
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-400 dark:border-indigo-500 text-indigo-900 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-400'
                    }`}
                  >
                    <div>
                      <div className="font-extrabold tracking-tight">{st.label}</div>
                      <div className="text-[10px] opacity-80">{st.sub}</div>
                    </div>
                    {state === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                    {state === 'current' && <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 dark:text-slate-100">{entityDef?.displayName}</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {entityDef?.headerConfig?.primaryRefLabel}:{' '}
                  <strong className="font-mono">{record?.referenceNumber || activeEntity.entityId}</strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(entityDef?.mainInformationSections || []).slice(0, 3).map((sec: string, idx: number) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                  >
                    {sec}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Finalized / Closed / Locked operational state notice */}
          {isFinalizedLocked && (
            <div className="px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Completed &amp; Locked State: <strong>{currentStatus.replace(/_/g, ' ')}</strong> — This record is finalized and locked for audit integrity. Editing and resubmission are disabled; use Copy to Draft to start a new record.
                </span>
              </div>
            </div>
          )}

          {/* Non-standard controlled state banner if Returned, Rejected, Cancelled, Inactive, Archived, Soft Deleted, Reversed */}
          {['RETURNED', 'REJECTED', 'CANCELLED', 'VOIDED', 'INACTIVE', 'ARCHIVED', 'SOFT_DELETED', 'REMOVED', 'REVERSED'].includes(currentStatus) && (
            <div className="px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Controlled Lifecycle State: <strong>{currentStatus.replace(/_/g, ' ')}</strong>
                  {currentStatus === 'RETURNED' || currentStatus === 'REJECTED'
                    ? ' — Record is open for authorized correction and resubmission.'
                    : currentStatus === 'REVERSED'
                    ? ' — Accounting reversal entry has been generated; original posted entry remains immutable.'
                    : currentStatus === 'INACTIVE'
                    ? ' — Record is deactivated from new postings; historical BIR ledger records remain preserved.'
                    : ' — Historical record and audit trail are preserved.'}
                </span>
              </div>
            </div>
          )}

          {/* Standardized Action Buttons */}
          {allowedActions.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-indigo-500" /> Authorized Workflow Actions:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {actionButtonsConfig
                  .filter(btn => allowedActions.includes(btn.action))
                  .map(btn => {
                    const Icon = btn.icon;
                    const isSelected = pendingAction === btn.action;
                    return (
                      <button
                        key={btn.action}
                        type="button"
                        onClick={() => {
                          setPendingAction(isSelected ? null : btn.action);
                          setActionFeedback(null);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 shadow-2xs ${
                          isSelected ? 'ring-2 ring-indigo-500 ' + btn.style : btn.style
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{btn.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Action Feedback Banner */}
          {actionFeedback && (
            <div className={`p-3 rounded-xl border text-xs font-semibold flex flex-wrap items-center justify-between gap-2 ${
              actionFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
            }`}>
              <span>{actionFeedback.message}</span>
              <div className="flex items-center gap-3 ml-auto">
                {conflictData && (
                  <button
                    type="button"
                    onClick={async () => {
                      setConflictData(null);
                      setActionFeedback(null);
                      await fetch360Data(activeEntity.entityType, activeEntity.entityId);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold"
                  >
                    Reload Latest Record
                  </button>
                )}
                <button type="button" onClick={() => setActionFeedback(null)} className="text-xs underline">Dismiss</button>
              </div>
            </div>
          )}

          {/* Inline Action Execution Drawer (No window.prompt / window.alert) */}
          {pendingAction && (
            <form onSubmit={executeWorkflowAction} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/90 border border-indigo-200 dark:border-indigo-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Confirm Workflow Transition: {pendingAction.replace(/_/g, ' ')}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>

              {pendingAction === 'EDIT' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {editFields.description !== undefined && (
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Description / Narration</label>
                      <input
                        type="text"
                        value={editFields.description}
                        onChange={e => setEditFields({ ...editFields, description: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.notes !== undefined && (
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Notes / Particulars</label>
                      <input
                        type="text"
                        value={editFields.notes}
                        onChange={e => setEditFields({ ...editFields, notes: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.reference !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Reference</label>
                      <input
                        type="text"
                        value={editFields.reference}
                        onChange={e => setEditFields({ ...editFields, reference: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.totalAmountPhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Total Amount (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.totalAmountPhp}
                        onChange={e => setEditFields({ ...editFields, totalAmountPhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.amountPhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Amount (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.amountPhp}
                        onChange={e => setEditFields({ ...editFields, amountPhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.monthlyLimitPhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Monthly Limit (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.monthlyLimitPhp}
                        onChange={e => setEditFields({ ...editFields, monthlyLimitPhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.unitPricePhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Unit Price (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.unitPricePhp}
                        onChange={e => setEditFields({ ...editFields, unitPricePhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.unitCostPhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Unit Cost (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.unitCostPhp}
                        onChange={e => setEditFields({ ...editFields, unitCostPhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.basicSalaryPhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Basic Salary (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.basicSalaryPhp}
                        onChange={e => setEditFields({ ...editFields, basicSalaryPhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.acquisitionCostPhp !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Acquisition Cost (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFields.acquisitionCostPhp}
                        onChange={e => setEditFields({ ...editFields, acquisitionCostPhp: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.entryDate !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Entry Date</label>
                      <input
                        type="date"
                        value={editFields.entryDate}
                        onChange={e => setEditFields({ ...editFields, entryDate: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.invoiceDate !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Invoice Date</label>
                      <input
                        type="date"
                        value={editFields.invoiceDate}
                        onChange={e => setEditFields({ ...editFields, invoiceDate: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.billDate !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Bill Date</label>
                      <input
                        type="date"
                        value={editFields.billDate}
                        onChange={e => setEditFields({ ...editFields, billDate: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.paymentDate !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Payment Date</label>
                      <input
                        type="date"
                        value={editFields.paymentDate}
                        onChange={e => setEditFields({ ...editFields, paymentDate: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.dueDate !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Due Date</label>
                      <input
                        type="date"
                        value={editFields.dueDate}
                        onChange={e => setEditFields({ ...editFields, dueDate: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.category !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Category</label>
                      <input
                        type="text"
                        value={editFields.category}
                        onChange={e => setEditFields({ ...editFields, category: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.periodMonth !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Period Month</label>
                      <input
                        type="text"
                        value={editFields.periodMonth}
                        onChange={e => setEditFields({ ...editFields, periodMonth: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.legalName !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Legal Name</label>
                      <input
                        type="text"
                        value={editFields.legalName}
                        onChange={e => setEditFields({ ...editFields, legalName: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.tradeName !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Trade Name</label>
                      <input
                        type="text"
                        value={editFields.tradeName}
                        onChange={e => setEditFields({ ...editFields, tradeName: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.accountName !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Account Name</label>
                      <input
                        type="text"
                        value={editFields.accountName}
                        onChange={e => setEditFields({ ...editFields, accountName: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.name !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Name</label>
                      <input
                        type="text"
                        value={editFields.name}
                        onChange={e => setEditFields({ ...editFields, name: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.title !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Title</label>
                      <input
                        type="text"
                        value={editFields.title}
                        onChange={e => setEditFields({ ...editFields, title: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.tin !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">BIR TIN</label>
                      <input
                        type="text"
                        value={editFields.tin}
                        onChange={e => setEditFields({ ...editFields, tin: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.contactPerson !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Contact Person</label>
                      <input
                        type="text"
                        value={editFields.contactPerson}
                        onChange={e => setEditFields({ ...editFields, contactPerson: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.paymentTerms !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Payment Terms</label>
                      <input
                        type="text"
                        value={editFields.paymentTerms}
                        onChange={e => setEditFields({ ...editFields, paymentTerms: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.address !== undefined && (
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Address</label>
                      <input
                        type="text"
                        value={editFields.address}
                        onChange={e => setEditFields({ ...editFields, address: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.payeeName !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Payee Name</label>
                      <input
                        type="text"
                        value={editFields.payeeName}
                        onChange={e => setEditFields({ ...editFields, payeeName: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.custodianName !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Custodian Name</label>
                      <input
                        type="text"
                        value={editFields.custodianName}
                        onChange={e => setEditFields({ ...editFields, custodianName: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {editFields.quantityOnHand !== undefined && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Quantity On Hand</label>
                      <input
                        type="number"
                        step="1"
                        value={editFields.quantityOnHand}
                        onChange={e => setEditFields({ ...editFields, quantityOnHand: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                </div>
              )}

              {pendingAction === 'REVERSE' && (
                <div className="max-w-xs">
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Reversal Entry Date</label>
                  <input
                    type="date"
                    required
                    value={reverseDate}
                    onChange={e => setReverseDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </div>
              )}

              {pendingAction === 'RECORD_COLLECTION' && (!record ? (
                <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                  Loading authoritative AR balance and Cash/Bank COA accounts...
                </div>
              ) : (() => {
                const balCent = Number(record?.balanceDue ?? 0);
                const cashCent = Math.round((parseFloat(collectionCashPhp) || 0) * 100);
                const cwtCent = Math.round((parseFloat(collectionCwtPhp) || 0) * 100);
                const totalSettledCent = cashCent + cwtCent;
                const remainingAfter = Math.max(0, balCent - totalSettledCent);
                const resultingState = totalSettledCent <= 0 ? 'UNSETTLED' : remainingAfter === 0 ? 'PAID' : 'PARTIAL';
                const colAccounts: Array<{ id: string; accountCode: string; accountName: string }> = data?.entitySpecificContext?.collectionAccounts || [];
                const isVatCompany = (data?.entitySpecificContext?.companyVatStatus || 'VAT') === 'VAT';
                const taxBasePhp = isVatCompany ? (balCent / 100) / 1.12 : (balCent / 100);

                return (
                  <div className="space-y-3 bg-white dark:bg-slate-900/80 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Remaining AR Balance Due: <strong className="font-mono text-amber-700 dark:text-amber-400">{formatPHP(balCent)}</strong>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const halfCent = Math.round(balCent / 2);
                            setCollectionCashPhp((halfCent / 100).toFixed(2));
                            setCollectionCwtPhp('0.00');
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                        >
                          50% Partial ({formatPHP(Math.round(balCent / 2))})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const cwt = Math.round((parseFloat(collectionCwtPhp) || 0) * 100);
                            setCollectionCashPhp((Math.max(0, balCent - cwt) / 100).toFixed(2));
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                        >
                          Full Balance
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const cwtCentCalc = Math.round(taxBasePhp * 0.01 * 100);
                            setCollectionCwtPhp((cwtCentCalc / 100).toFixed(2));
                            setCollectionCashPhp((Math.max(0, balCent - cwtCentCalc) / 100).toFixed(2));
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                          title="BIR Form 2307: 1% Goods Creditable Withholding Tax on Net-of-VAT base"
                        >
                          + 1% CWT (Goods)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const cwtCentCalc = Math.round(taxBasePhp * 0.02 * 100);
                            setCollectionCwtPhp((cwtCentCalc / 100).toFixed(2));
                            setCollectionCashPhp((Math.max(0, balCent - cwtCentCalc) / 100).toFixed(2));
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                          title="BIR Form 2307: 2% Services Creditable Withholding Tax on Net-of-VAT base"
                        >
                          + 2% CWT (Services)
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Cash / Bank Collected (PHP) *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={collectionCashPhp}
                          onChange={e => setCollectionCashPhp(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">BIR Form 2307 CWT Withheld (PHP)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={collectionCwtPhp}
                          onChange={e => setCollectionCwtPhp(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Official / Collection Receipt #</label>
                        <input
                          type="text"
                          value={collectionOrNumber}
                          onChange={e => setCollectionOrNumber(e.target.value)}
                          placeholder="OR / CR Number"
                          className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Deposit To (Cash / Bank COA)</label>
                        <select
                          value={collectionCashAccountId}
                          onChange={e => setCollectionCashAccountId(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        >
                          {colAccounts.length === 0 && <option value="">Default Cash/Bank Control Account</option>}
                          {colAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {acc.accountCode} — {acc.accountName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Payment Method</label>
                        <select
                          value={collectionMethod}
                          onChange={e => setCollectionMethod(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        >
                          <option value="BANK_TRANSFER">Bank Transfer / InstaPay / PESONet</option>
                          <option value="CHECK">Check Payment</option>
                          <option value="CASH">Cash</option>
                          <option value="E_WALLET">E-Wallet / GCash / Maya</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Collection Date</label>
                        <input
                          type="date"
                          required
                          value={collectionDate}
                          onChange={e => setCollectionDate(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
                        <span>AR Reduction: <strong className="font-mono text-indigo-700 dark:text-indigo-400">{formatPHP(totalSettledCent)}</strong></span>
                        <span>•</span>
                        <span>New Balance Due: <strong className="font-mono text-amber-700 dark:text-amber-400">{formatPHP(remainingAfter)}</strong></span>
                      </div>
                      <div>
                        Resulting Status:{' '}
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold border ${getStatusBadgeStyle(resultingState)}`}>
                          {resultingState}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })())}

              {pendingAction === 'RECORD_DISBURSEMENT' && (!record ? (
                <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                  Loading authoritative AP balance and Cash/Bank COA accounts...
                </div>
              ) : (() => {
                const balCent = Number(record?.balanceDue ?? 0);
                const cashCent = Math.round((parseFloat(disbursementCashPhp) || 0) * 100);
                const ewtCent = Math.round((parseFloat(disbursementEwtPhp) || 0) * 100);
                const totalSettledCent = cashCent + ewtCent;
                const remainingAfter = Math.max(0, balCent - totalSettledCent);
                const resultingState = totalSettledCent <= 0 ? 'UNSETTLED' : remainingAfter === 0 ? 'PAID' : 'PARTIAL';
                const colAccounts: Array<{ id: string; accountCode: string; accountName: string }> = data?.entitySpecificContext?.collectionAccounts || [];
                const isVatCompany = (data?.entitySpecificContext?.companyVatStatus || 'VAT') === 'VAT';
                const taxBasePhp = isVatCompany ? (balCent / 100) / 1.12 : (balCent / 100);

                return (
                  <div className="space-y-3 bg-white dark:bg-slate-900/80 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Remaining AP Balance Due: <strong className="font-mono text-amber-700 dark:text-amber-400">{formatPHP(balCent)}</strong>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const halfCent = Math.round(balCent / 2);
                            setDisbursementCashPhp((halfCent / 100).toFixed(2));
                            setDisbursementEwtPhp('0.00');
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                        >
                          50% Partial ({formatPHP(Math.round(balCent / 2))})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ewt = Math.round((parseFloat(disbursementEwtPhp) || 0) * 100);
                            setDisbursementCashPhp((Math.max(0, balCent - ewt) / 100).toFixed(2));
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                        >
                          Full Balance
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ewtCentCalc = Math.round(taxBasePhp * 0.01 * 100);
                            setDisbursementEwtPhp((ewtCentCalc / 100).toFixed(2));
                            setDisbursementCashPhp((Math.max(0, balCent - ewtCentCalc) / 100).toFixed(2));
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                          title="BIR Form 2307: WB010 1% Goods Creditable Withholding Tax on Net-of-VAT base"
                        >
                          + 1% EWT (WB010 Goods)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ewtCentCalc = Math.round(taxBasePhp * 0.02 * 100);
                            setDisbursementEwtPhp((ewtCentCalc / 100).toFixed(2));
                            setDisbursementCashPhp((Math.max(0, balCent - ewtCentCalc) / 100).toFixed(2));
                          }}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                          title="BIR Form 2307: WB020 2% Services Creditable Withholding Tax on Net-of-VAT base"
                        >
                          + 2% EWT (WB020 Services)
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Cash / Check Disbursed (PHP) *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={disbursementCashPhp}
                          onChange={e => setDisbursementCashPhp(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">BIR Form 2307 EWT Withheld (PHP)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={disbursementEwtPhp}
                          onChange={e => setDisbursementEwtPhp(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Disbursement Voucher # (DV #)</label>
                        <input
                          type="text"
                          value={disbursementDvNumber}
                          onChange={e => setDisbursementDvNumber(e.target.value)}
                          placeholder="DV / CV Number"
                          className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Disburse From (Cash / Bank COA)</label>
                        <select
                          value={disbursementCashAccountId}
                          onChange={e => setDisbursementCashAccountId(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        >
                          {colAccounts.length === 0 && <option value="">Default Cash/Bank Control Account</option>}
                          {colAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {acc.accountCode} — {acc.accountName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Payment Method</label>
                        <select
                          value={disbursementMethod}
                          onChange={e => setDisbursementMethod(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        >
                          <option value="BANK_TRANSFER">Bank Transfer / InstaPay / PESONet</option>
                          <option value="CHECK">Corporate Check Voucher</option>
                          <option value="CASH">Petty Cash</option>
                          <option value="ONLINE">Online Remittance / Direct AP</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Disbursement Date</label>
                        <input
                          type="date"
                          required
                          value={disbursementDate}
                          onChange={e => setDisbursementDate(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
                        <span>AP Liability Settled: <strong className="font-mono text-emerald-700 dark:text-emerald-400">{formatPHP(totalSettledCent)}</strong></span>
                        <span>•</span>
                        <span>Remaining Balance Due: <strong className="font-mono text-amber-700 dark:text-amber-400">{formatPHP(remainingAfter)}</strong></span>
                      </div>
                      <div>
                        Resulting Status:{' '}
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold border ${getStatusBadgeStyle(resultingState)}`}>
                          {resultingState}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })())}

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {['REJECT', 'RETURN', 'CANCEL', 'SOFT_DELETE', 'REVERSE'].includes(pendingAction)
                    ? 'Mandatory Reason / Audit Remarks *'
                    : 'Audit Remarks / Comments (Optional)'}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required={['REJECT', 'RETURN', 'CANCEL', 'SOFT_DELETE', 'REVERSE'].includes(pendingAction)}
                    placeholder={
                      pendingAction === 'RETURN'
                        ? 'Specify required corrections for the preparer...'
                        : pendingAction === 'REJECT'
                        ? 'Specify reason for rejection...'
                        : pendingAction === 'CANCEL'
                        ? 'Specify authorization and reason for cancellation...'
                        : pendingAction === 'SOFT_DELETE'
                        ? 'Specify controlled deletion reason (retained in audit history)...'
                        : 'Enter remarks for the audit trail...'
                    }
                    value={actionReason}
                    onChange={e => setActionReason(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 whitespace-nowrap"
                  >
                    {actionLoading ? 'Recording...' : `Confirm ${pendingAction.replace(/_/g, ' ')}`}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* 8 Standardized Record-Level Journey Tabs */}
        <div className="shrink-0 px-6 bg-slate-100/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === t.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-[#0f172a] rounded-t-lg'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>{t.label}</span>
              {t.badge !== undefined && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                  activeTab === t.id
                    ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Main Scrollable Content Area */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-6">
          {loading ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <Clock className="w-7 h-7 animate-spin text-indigo-600" />
              <span className="text-sm font-semibold">Loading Record Details (360°) & Lineage...</span>
            </div>
          ) : error ? (
            <div className="p-6 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-center space-y-2">
              <AlertTriangle className="w-7 h-7 text-rose-600 mx-auto" />
              <p className="text-sm font-bold text-rose-800 dark:text-rose-200">{error}</p>
            </div>
          ) : (
            <>
              {/* TAB 1: SPECIALIZED ENTITY-SPECIFIC 360° WORKSPACE + OWNERSHIP & LINEAGE */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Broken / Missing Reference Warning Banner */}
                  {missingReferences.length > 0 && (
                    <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Referential Integrity Alert: Broken Cross-Module Reference Detected ({missingReferences.length})</span>
                      </div>
                      <ul className="text-xs text-rose-800 dark:text-rose-200 list-disc list-inside space-y-0.5">
                        {missingReferences.map((m: any, idx: number) => (
                          <li key={idx}>
                            Field <code className="font-mono font-bold">{m.field}</code> points to missing {m.targetEntityType} ID <code className="font-mono font-bold">{m.targetId}</code> — {m.reason || m.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Registry-Driven Specialized 360° Domain Experience */}
                  <EntitySpecific360Dispatcher
                    data360={data}
                    definition={entityDef}
                    formatPHP={formatPHP}
                    formatDateTime={formatDateTime}
                    onNavigateEntity={handleNavigateEntity}
                    onSelectTab={setActiveTab}
                  />

                  {/* 6 Key Ownership & Touch Cards (Distinct Created, Modified, Submitted, Approved, Posted, Last Touched) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {[
                      {
                        label: 'Created By',
                        name: ownership.createdBy || 'Not Recorded',
                        id: ownership.createdById,
                        role: ownership.createdByRole || 'Preparer / Creator',
                        timestamp: ownership.createdAt,
                        accent: 'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20',
                        badgeColor: 'text-indigo-600 dark:text-indigo-400'
                      },
                      {
                        label: 'Last Modified By (Data Fields)',
                        name: ownership.lastModifiedBy || ownership.createdBy || 'No Edits',
                        id: ownership.lastModifiedById,
                        role: ownership.lastModifiedByRole || 'Data Field Editor',
                        timestamp: ownership.lastModifiedAt || ownership.createdAt,
                        accent: 'border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20',
                        badgeColor: 'text-amber-600 dark:text-amber-400'
                      },
                      {
                        label: 'Submitted By',
                        name: ownership.submittedBy || 'Not Submitted',
                        id: ownership.submittedById,
                        role: ownership.submittedByRole || (ownership.submittedBy ? 'Workflow Submitter' : 'Awaiting Submission'),
                        timestamp: ownership.submittedAt,
                        accent: 'border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20',
                        badgeColor: 'text-sky-600 dark:text-sky-400'
                      },
                      {
                        label: 'Approved By',
                        name: ownership.approvedBy || ownership.lastApprovedBy || 'Pending Approval',
                        id: ownership.approvedById,
                        role: ownership.approvedByRole || (ownership.approvedBy || ownership.lastApprovedBy ? 'Authorized Approver' : 'Awaiting Review'),
                        timestamp: ownership.approvedAt || ownership.lastApprovedAt,
                        accent: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20',
                        badgeColor: 'text-emerald-600 dark:text-emerald-400'
                      },
                      {
                        label: 'Posted By (GL Authority)',
                        name: ownership.postedBy || 'Unposted',
                        id: ownership.postedById,
                        role: ownership.postedByRole || (ownership.postedBy ? 'Ledger Poster' : 'Pending GL Post'),
                        timestamp: ownership.postedAt,
                        accent: 'border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/20',
                        badgeColor: 'text-teal-600 dark:text-teal-400'
                      },
                      {
                        label: 'Last Touched / Action By',
                        name: ownership.lastTouchedBy || ownership.lastActionBy || 'Not Recorded',
                        id: ownership.lastActionById,
                        role: ownership.lastActionByRole || 'Latest Workflow Action',
                        timestamp: ownership.lastTouchedAt || ownership.lastActionAt,
                        accent: 'border-purple-200 dark:border-purple-900/60 bg-purple-50/50 dark:bg-purple-950/20',
                        badgeColor: 'text-purple-600 dark:text-purple-400'
                      }
                    ].map((card, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setInspectedUser(card)}
                        className={`p-3.5 rounded-2xl border text-left transition-all hover:shadow-md group ${card.accent}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-extrabold uppercase tracking-wider ${card.badgeColor}`}>
                            {card.label}
                          </span>
                          <User className={`w-4 h-4 ${card.badgeColor} group-hover:scale-110 transition-transform`} />
                        </div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1 truncate">
                          {card.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">
                          {card.role}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                          {card.timestamp ? formatDateTime(card.timestamp) : '—'}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Clickable User Inspector Drawer */}
                  {inspectedUser && (
                    <div className="p-4 rounded-2xl bg-slate-900 text-white border border-slate-700 space-y-3 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-xs">
                            {inspectedUser.name?.[0] || 'U'}
                          </div>
                          <div>
                            <div className="text-xs font-extrabold uppercase tracking-wider text-indigo-400">
                              {inspectedUser.label} — User Touch Inspector
                            </div>
                            <div className="text-sm font-bold">
                              {inspectedUser.name} <span className="text-xs font-normal text-slate-400">({inspectedUser.role})</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => setInspectedUser(null)}
                          className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
                        >
                          Close
                        </button>
                      </div>
                      <div className="text-xs text-slate-300 space-y-1">
                        <p>
                          <strong>Important Distinction:</strong> <em>Last Modified By</em> ({ownership.lastModifiedBy || 'None'}) tracks the last user who altered record data fields, whereas <em>Last Touched / Action By</em> ({ownership.lastActionBy || 'None'}) tracks the user who performed the latest workflow action (such as Approval or Posting).
                        </p>
                      </div>
                      <div className="border-t border-slate-800 pt-2">
                        <div className="text-[11px] font-bold text-slate-400 uppercase mb-1.5">
                          Actions Performed by {inspectedUser.name} on this Record:
                        </div>
                        <div className="space-y-1 max-h-36 overflow-y-auto">
                          {activityHistory
                            .filter(a => (a.userDisplayName || a.userEmail || 'System') === inspectedUser.name)
                            .map(a => (
                              <div key={a.id} className="text-xs flex items-center justify-between bg-slate-800/70 px-3 py-1.5 rounded-lg">
                                <span className="font-bold text-indigo-300">{a.action}</span>
                                <span className="text-slate-300">{a.reason || a.source}</span>
                                <span className="font-mono text-[11px] text-slate-400">{formatDateTime(a.timestamp)}</span>
                              </div>
                            ))}
                          {activityHistory.filter(a => (a.userDisplayName || a.userEmail || 'System') === inspectedUser.name).length === 0 && (
                            <div className="text-xs text-slate-400 italic">No individual touch events matched for this user label.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Two-Column Split: Canonical Transaction Journey Step-by-Step + 360° Record Summary */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Step-by-Step Transaction Journey (Matching User Sample) */}
                    <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                        <div>
                          <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                            <Clock className="w-4 h-4 text-indigo-600" />
                            Complete Transaction Journey
                          </h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Authoritative milestone progression from creation to latest touch
                          </p>
                        </div>
                        <button
                          onClick={() => setActiveTab('activity')}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Full Timeline ({activityHistory.length}) &rarr;
                        </button>
                      </div>

                      <div className="relative border-l-2 border-indigo-200 dark:border-indigo-900/60 ml-3 space-y-5 py-1">
                        {/* Step 1: Created */}
                        <div className="relative pl-6">
                          <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                            1
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100">1. Created</span>
                              <span className="text-xs font-mono text-slate-500">{formatDateTime(ownership.createdAt || createdEvt?.timestamp)}</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                              Created by: <strong className="text-slate-900 dark:text-white">{ownership.createdBy || createdEvt?.userDisplayName || 'System'}</strong>
                              {ownership.createdByRole && <span className="text-slate-400"> ({ownership.createdByRole})</span>}
                            </p>
                          </div>
                        </div>

                        {/* Step 2: Edited */}
                        <div className="relative pl-6">
                          <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                            latestEditEvt ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                          }`}>
                            2
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100">
                                2. Edited {editedEvents.length > 0 ? `(${editedEvents.length} modification${editedEvents.length > 1 ? 's' : ''})` : ''}
                              </span>
                              <span className="text-xs font-mono text-slate-500">
                                {latestEditEvt ? formatDateTime(latestEditEvt.timestamp) : 'No modifications'}
                              </span>
                            </div>
                            {latestEditEvt ? (
                              <>
                                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                                  Edited by: <strong className="text-slate-900 dark:text-white">{latestEditEvt.userDisplayName || ownership.lastModifiedBy}</strong>
                                </p>
                                {latestEditEvt.fieldDiffs && latestEditEvt.fieldDiffs.length > 0 && (
                                  <p className="text-xs text-amber-700 dark:text-amber-300 font-medium mt-1">
                                    Changes: {latestEditEvt.fieldDiffs.map((d: any) => d.field).join(', ')}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-slate-400 mt-1">Original record values preserved without field edits.</p>
                            )}
                          </div>
                        </div>

                        {/* Step 3: Submitted for Approval */}
                        <div className="relative pl-6">
                          <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                            submittedEvt ? 'bg-purple-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                          }`}>
                            3
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100">3. Submitted for Approval</span>
                              <span className="text-xs font-mono text-slate-500">
                                {submittedEvt ? formatDateTime(submittedEvt.timestamp) : 'Not yet submitted'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                              {submittedEvt ? (
                                <>Submitted by: <strong className="text-slate-900 dark:text-white">{submittedEvt.userDisplayName || ownership.createdBy}</strong></>
                              ) : (
                                <span className="text-slate-400">Awaiting submission into review workflow</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Step 4: Approved / Posted */}
                        <div className="relative pl-6">
                          <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                            approvedEvt || ownership.lastApprovedBy ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                          }`}>
                            4
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100">4. Approved</span>
                              <span className="text-xs font-mono text-slate-500">
                                {ownership.lastApprovedAt ? formatDateTime(ownership.lastApprovedAt) : approvedEvt ? formatDateTime(approvedEvt.timestamp) : 'Pending decision'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                              {ownership.lastApprovedBy || approvedEvt ? (
                                <>Approved by: <strong className="text-slate-900 dark:text-white">{ownership.lastApprovedBy || approvedEvt?.userDisplayName}</strong></>
                              ) : (
                                <span className="text-slate-400">Requires authorized approver validation</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Step 5: Last Activity */}
                        <div className="relative pl-6">
                          <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                            5
                          </div>
                          <div className="bg-indigo-50/60 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-indigo-950 dark:text-indigo-200">5. Last Activity</span>
                              <span className="text-xs font-mono text-indigo-700 dark:text-indigo-300">
                                {formatDateTime(ownership.lastTouchedAt || lastActivityEvt?.timestamp)}
                              </span>
                            </div>
                            <p className="text-xs text-indigo-900 dark:text-indigo-200 mt-1">
                              Last touched by: <strong>{ownership.lastTouchedBy || lastActivityEvt?.userDisplayName || 'System'}</strong>
                              {lastActivityEvt?.action && (
                                <span className="ml-1.5 px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-[10px] font-mono font-bold">
                                  {lastActivityEvt.action}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Enterprise 360° Record Context & Connected Modules */}
                    <div className="lg:col-span-5 space-y-4">
                      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
                        <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                          <FileText className="w-4 h-4 text-indigo-600" />
                          Authoritative Record Summary
                        </h4>
                        {record ? (
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                              <span className="text-slate-500">Reference Number:</span>
                              <span className="font-mono font-bold text-slate-900 dark:text-white">
                                {record.journalNumber || record.invoiceNumber || record.billNumber || record.code || record.accountCode || record.id}
                              </span>
                            </div>
                            {(record.customerName || record.vendorName || record.legalName || record.accountName) && (
                              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                                <span className="text-slate-500">Counterparty / Name:</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {record.customerName || record.vendorName || record.legalName || record.accountName}
                                </span>
                              </div>
                            )}
                            {(record.totalAmount !== undefined || record.amount !== undefined) && (
                              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                                <span className="text-slate-500">Amount (PHP):</span>
                                <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400 text-sm">
                                  {formatPHP(record.totalAmount ?? record.amount)}
                                </span>
                              </div>
                            )}
                            {record.balanceDue !== undefined && (
                              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                                <span className="text-slate-500">Balance Due:</span>
                                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                  {formatPHP(record.balanceDue)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                              <span className="text-slate-500">Date:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">
                                {record.entryDate || record.invoiceDate || record.billDate || record.transactionDate || formatDateTime(record.createdAt)}
                              </span>
                            </div>
                            {(record.description || record.notes) && (
                              <div className="pt-1">
                                <span className="text-slate-500 block mb-1">Description / Narration:</span>
                                <p className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                                  {record.description || record.notes}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">Record metadata loaded from audit history.</p>
                        )}
                      </div>

                      {/* Connected Records Preview */}
                      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-indigo-600" />
                            Connected 360° Records ({relatedRecords.length})
                          </h4>
                          <button
                            onClick={() => setActiveTab('related')}
                            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            Explore All &rarr;
                          </button>
                        </div>
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {relatedRecords.slice(0, 5).map((rel, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleDrillDown(rel)}
                              className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 hover:border-indigo-400 cursor-pointer transition-all flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="text-[10px] font-extrabold uppercase text-indigo-600 dark:text-indigo-400 block">
                                  {rel.module} • {rel.type}
                                </span>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate block">
                                  {rel.reference} — {rel.title}
                                </span>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                            </div>
                          ))}
                          {relatedRecords.length === 0 && (
                            <p className="text-xs text-slate-400">No cross-module linked records yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 14-Stage Accounting & Compliance Lifecycle Checkpoints */}
                  {lifecycleCheckpoints.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <span className="font-extrabold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          14-Stage Accounting & Compliance Lifecycle Verification Matrix
                        </span>
                        <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                          {lifecycleCheckpoints.filter((c: any) => c.status === 'COMPLETED').length} / {lifecycleCheckpoints.length} Checkpoints Verified
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800">
                            <tr>
                              <th className="py-2.5 px-4">#</th>
                              <th className="py-2.5 px-4">Lifecycle Stage</th>
                              <th className="py-2.5 px-4">Status</th>
                              <th className="py-2.5 px-4">Verified Actor</th>
                              <th className="py-2.5 px-4">Reference / Evidence</th>
                              <th className="py-2.5 px-4">Timestamp</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {lifecycleCheckpoints.map((cp: any) => (
                              <tr key={cp.stageNumber} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="py-2.5 px-4 font-mono font-bold text-slate-400">{cp.stageNumber}</td>
                                <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-slate-100">{cp.stageLabel}</td>
                                <td className="py-2.5 px-4">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                    cp.status === 'COMPLETED'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                      : cp.status === 'BROKEN_REFERENCE' || cp.status === 'REJECTED_OR_RETURNED'
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                      : cp.status === 'PENDING'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                  }`}>
                                    {cp.status}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300">{cp.actor || '—'}</td>
                                <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                                  {cp.reference && <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 mr-1.5">[{cp.reference}]</span>}
                                  <span>{cp.evidenceSummary}</span>
                                </td>
                                <td className="py-2.5 px-4 font-mono text-slate-500">{cp.timestamp ? formatDateTime(cp.timestamp) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: DETAILS */}
              {activeTab === 'details' && (
                <div className="space-y-6">
                  {linesList.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 font-extrabold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        Transaction Line Items ({linesList.length})
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800">
                            <tr>
                              <th className="py-3 px-4">Account / Item</th>
                              <th className="py-3 px-4">Description</th>
                              <th className="py-3 px-4 text-right">Debit / Qty</th>
                              <th className="py-3 px-4 text-right">Credit / Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {linesList.map((line: any, i: number) => (
                              <tr key={line.id || i}>
                                <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                  {line.accountCode ? `${line.accountCode} - ${line.accountName}` : line.accountId || `Line #${i + 1}`}
                                </td>
                                <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{line.description || '-'}</td>
                                <td className="py-3 px-4 text-right font-mono">
                                  {line.debit !== undefined ? formatPHP(line.debit) : line.quantity ?? '-'}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-bold">
                                  {line.credit !== undefined ? formatPHP(line.credit) : formatPHP(line.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
                    <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm mb-3">
                      Complete Record Fields
                    </h4>
                    {record ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                        {Object.entries(record).map(([k, v]) => (
                          <div key={k} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">{k}</span>
                            <span className="font-mono text-slate-800 dark:text-slate-100 font-semibold break-all">
                              {v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No active record row found (record may have been permanently purged or is virtual).</p>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: COMPLETE ACTIVITY JOURNEY */}
              {activeTab === 'activity' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-xs">
                    <span className="font-bold text-slate-600 dark:text-slate-300">
                      Showing {activityHistory.length > 0 ? paginationInfo.offset + 1 : 0}–{paginationInfo.offset + activityHistory.length} of {paginationInfo.total} audit events
                    </span>
                    {paginationInfo.total > paginationInfo.limit && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={pageOffset === 0 || loading}
                          onClick={() => setPageOffset(Math.max(0, pageOffset - pageLimit))}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                        >
                          &larr; Newer
                        </button>
                        <button
                          type="button"
                          disabled={!paginationInfo.hasMore || loading}
                          onClick={() => setPageOffset(pageOffset + pageLimit)}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                        >
                          Older &rarr;
                        </button>
                      </div>
                    )}
                  </div>
                  {activityHistory.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-sm">
                      No audit events recorded for this record yet.
                    </div>
                  ) : (
                    <div className="relative border-l-2 border-indigo-200 dark:border-indigo-900/60 ml-3 space-y-5">
                      {activityHistory.map((log) => (
                        <div key={log.id} className="relative pl-6">
                          <div className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 bg-white dark:bg-slate-900 ${
                            log.result === 'FAILED' ? 'border-rose-500' :
                            log.result === 'WARNING' ? 'border-amber-500' : 'border-indigo-600'
                          }`} />

                          <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-700/80 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 uppercase">
                                  {log.action?.replace(/_/g, ' ')}
                                </span>
                                {log.previousStatus && log.newStatus && log.previousStatus !== log.newStatus && (
                                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                    {log.previousStatus} <ArrowRight className="w-3 h-3" /> {log.newStatus}
                                  </span>
                                )}
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                  log.result === 'FAILED' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                }`}>
                                  {log.result}
                                </span>
                              </div>
                              <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {formatDateTime(log.timestamp)}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900/70 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
                              <div>
                                <span className="text-[10px] uppercase text-slate-400 block font-bold">Actor & Role</span>
                                <strong className="text-slate-900 dark:text-white">{log.userDisplayName || log.userEmail || 'System'}</strong> ({log.role || 'User'})
                              </div>
                              <div>
                                <span className="text-[10px] uppercase text-slate-400 block font-bold">User ID & Tenant</span>
                                <span className="font-mono text-[11px]">{log.userId || 'SYSTEM'} • {log.companyId}</span>
                              </div>
                              <div>
                                <span className="text-[10px] uppercase text-slate-400 block font-bold">Source & Request Ref</span>
                                <span className="font-mono text-[11px]">{log.source || 'API'} • {log.requestId || log.id.slice(0, 10)}</span>
                              </div>
                            </div>

                            {log.reason && (
                              <div className="text-xs text-slate-800 dark:text-slate-200 font-medium bg-amber-50/80 dark:bg-amber-950/30 p-2.5 rounded-xl border border-amber-200/70 dark:border-amber-800/50">
                                <strong className="text-amber-700 dark:text-amber-400">Reason / Remarks:</strong> {log.reason}
                              </div>
                            )}

                            {/* Inline Field Diffs */}
                            {log.fieldDiffs && log.fieldDiffs.length > 0 && (
                              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] uppercase text-slate-500 font-bold">
                                    <tr>
                                      <th className="py-1.5 px-3">Field Changed</th>
                                      <th className="py-1.5 px-3">Previous Value (Before)</th>
                                      <th className="py-1.5 px-3">New Value (After)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                                    {log.fieldDiffs.map((diff: any, dIdx: number) => (
                                      <tr key={dIdx}>
                                        <td className="py-1.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">{diff.field}</td>
                                        <td className="py-1.5 px-3 font-mono text-rose-600 dark:text-rose-400">{String(diff.before)}</td>
                                        <td className="py-1.5 px-3 font-mono text-emerald-600 dark:text-emerald-400 font-bold">{String(diff.after)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
                              <span className="font-mono flex items-center gap-1">
                                <Hash className="w-3 h-3 text-indigo-500" /> SHA-256 Seal: {log.integrityHash}
                              </span>
                              {(log.beforeData || log.afterData || log.metadata) && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedRawLog(selectedRawLog === log.id ? null : log.id)}
                                  className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold"
                                >
                                  {selectedRawLog === log.id ? 'Hide JSON Payload' : 'Inspect JSON Payload'}
                                </button>
                              )}
                            </div>

                            {selectedRawLog === log.id && (
                              <div className="pt-2 text-xs font-mono space-y-2 border-t border-slate-200 dark:border-slate-700">
                                {log.beforeData && (
                                  <div>
                                    <span className="font-bold text-slate-400 uppercase text-[10px]">Before JSON:</span>
                                    <pre className="p-2 bg-slate-900 text-slate-200 rounded-lg text-[11px] overflow-x-auto mt-1">{log.beforeData}</pre>
                                  </div>
                                )}
                                {log.afterData && (
                                  <div>
                                    <span className="font-bold text-slate-400 uppercase text-[10px]">After JSON:</span>
                                    <pre className="p-2 bg-slate-900 text-slate-200 rounded-lg text-[11px] overflow-x-auto mt-1">{log.afterData}</pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: APPROVAL HISTORY & MULTI-LEVEL ORCHESTRATION */}
              {activeTab === 'approvals' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/50 flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                        <Award className="w-4 h-4" /> Segregation of Duties (SoD) & Multi-Level Approval Accountability
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Creator: <strong>{ownership.createdBy || 'System'}</strong> • Latest Reviewer/Approver: <strong>{ownership.lastApprovedBy || ownership.lastReviewedBy || 'Pending'}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiFetch('/api/journey/approvals/initiate', {
                              method: 'POST',
                              body: {
                                entityType: activeEntity.entityType,
                                entityId: activeEntity.entityId,
                                workflowType: 'SEQUENTIAL',
                                reason: 'Initiated multi-level sequential approval routing',
                              } as any,
                            });
                            setActionFeedback({ type: 'success', message: 'Multi-level sequential approval workflow initiated.' });
                            if (onActionSuccess) onActionSuccess();
                            await fetch360Data(activeEntity.entityType, activeEntity.entityId);
                          } catch (err: any) {
                            setActionFeedback({ type: 'error', message: err?.data?.message || err.message || 'Failed to initiate approval workflow.' });
                          }
                        }}
                        className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                      >
                        + Initiate Multi-Level Approval
                      </button>
                      <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        SoD Enforced
                      </span>
                    </div>
                  </div>

                  {approvalOrchestration.length > 0 && (
                    <div className="space-y-3">
                      {approvalOrchestration.map((wf: any) => (
                        <div key={wf.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-extrabold text-slate-900 dark:text-white">
                              Workflow ({wf.workflowType}) • Step {wf.currentStepOrder} of {wf.totalSteps}
                            </span>
                            <span className="font-mono font-bold text-indigo-600">
                              Status: {wf.status} • SLA: {wf.slaStatus}
                            </span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[11px]">
                              <thead className="text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                                <tr>
                                  <th className="py-1.5 pr-2">Step</th>
                                  <th className="py-1.5 pr-2">Original Assigned</th>
                                  <th className="py-1.5 pr-2">Current / Actual Approver</th>
                                  <th className="py-1.5 pr-2">Status & Duration</th>
                                  <th className="py-1.5 pr-2">Delegation / Reassignment / Escalation</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {(wf.steps || []).map((st: any) => (
                                  <tr key={st.id}>
                                    <td className="py-1.5 pr-2 font-bold">#{st.stepOrder} {st.stepName}</td>
                                    <td className="py-1.5 pr-2">{st.originalAssignedApproverName || st.originalAssignedApproverId}</td>
                                    <td className="py-1.5 pr-2 font-bold">{st.actualApproverName || st.assignedApproverName}</td>
                                    <td className="py-1.5 pr-2">{st.status} {st.durationSeconds != null ? `(${st.durationSeconds}s)` : ''}</td>
                                    <td className="py-1.5 pr-2 text-[10px]">
                                      {st.delegationReason && <div>Delegated: {st.delegationReason}</div>}
                                      {st.reassignmentReason && <div>Reassigned: {st.reassignmentReason}</div>}
                                      {st.escalationReason && <div>Escalated (L{st.escalationLevel}): {st.escalationReason}</div>}
                                      {!st.delegationReason && !st.reassignmentReason && !st.escalationReason && 'Direct'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {approvalHistory.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                      No submission, approval, return, or rejection decisions recorded for this record yet.
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase font-bold border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="py-3 px-4">Timestamp</th>
                            <th className="py-3 px-4">Workflow Decision</th>
                            <th className="py-3 px-4">Authorized User</th>
                            <th className="py-3 px-4">Role</th>
                            <th className="py-3 px-4">Status Transition</th>
                            <th className="py-3 px-4">Remarks / Instructions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {approvalHistory.map((item, i) => (
                            <tr key={item.id || i}>
                              <td className="py-3 px-4 font-mono text-slate-500">{formatDateTime(item.timestamp)}</td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-0.5 rounded font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                  {item.action}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{item.userDisplayName || item.actor}</td>
                              <td className="py-3 px-4 text-slate-500">{item.role}</td>
                              <td className="py-3 px-4 font-mono">
                                {item.previousStatus || '—'} &rarr; {item.newStatus || '—'}
                              </td>
                              <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{item.reason || 'Verified and authorized'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: CHANGE HISTORY (Before-and-After Field Comparison) */}
              {activeTab === 'changes' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                        <GitCompare className="w-4 h-4 text-indigo-600" />
                        Field-Level Before & After Comparison
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Exact field diffs captured on every modification, correction, and state transition
                      </p>
                    </div>
                  </div>

                  {changeHistory.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                      No field-level modifications have been made since initial creation.
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase font-bold border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="py-3.5 px-4">Field / Action</th>
                            <th className="py-3.5 px-4">Before</th>
                            <th className="py-3.5 px-4">After</th>
                            <th className="py-3.5 px-4">Updated By</th>
                            <th className="py-3.5 px-4">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {changeHistory.flatMap((chg: any, idx: number) => {
                            if (Array.isArray(chg.fieldDiffs) && chg.fieldDiffs.length > 0) {
                              return chg.fieldDiffs.map((fd: any, fIdx: number) => (
                                <tr key={`${idx}-${fIdx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                  <td className="py-3 px-4 font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                                    {fd.field}
                                  </td>
                                  <td className="py-3 px-4 font-mono text-rose-600 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/10">
                                    {String(fd.before)}
                                  </td>
                                  <td className="py-3 px-4 font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10">
                                    {String(fd.after)}
                                  </td>
                                  <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                                    {chg.userDisplayName || chg.updatedBy} <span className="text-slate-400 font-normal">({chg.role})</span>
                                  </td>
                                  <td className="py-3 px-4 font-mono text-slate-500">
                                    {formatDateTime(chg.timestamp)}
                                  </td>
                                </tr>
                              ));
                            }
                            return [(
                              <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                <td className="py-3 px-4 font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                                  {chg.field || chg.action}
                                </td>
                                <td className="py-3 px-4 font-mono text-rose-600 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/10">
                                  {String(chg.before ?? chg.previousStatus ?? '—')}
                                </td>
                                <td className="py-3 px-4 font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10">
                                  {String(chg.after ?? chg.newStatus ?? chg.reason ?? '—')}
                                </td>
                                <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                                  {chg.userDisplayName || chg.updatedBy} <span className="text-slate-400 font-normal">({chg.role})</span>
                                </td>
                                <td className="py-3 px-4 font-mono text-slate-500">
                                  {formatDateTime(chg.timestamp)}
                                </td>
                              </tr>
                            )];
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 6: RELATED RECORDS (Enterprise 360° Cross-Module Lineage) */}
              {activeTab === 'related' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">
                        Canonical Cross-Module Lineage: Source &rarr; Transaction &rarr; Journal &rarr; Ledger &rarr; Report &rarr; Tax &rarr; Audit
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Click any connected record below to drill down directly into its 360° Journey.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {relatedRecords.map((rel, i) => (
                      <div
                        key={i}
                        onClick={() => handleDrillDown({ ...rel, entityId: rel.id || rel.entityId })}
                        className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 cursor-pointer transition-all shadow-2xs flex items-center justify-between gap-4 group"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                              {rel.module}
                            </span>
                            <span className="text-xs font-bold text-slate-500">{rel.relationship || rel.type}</span>
                          </div>
                          <div className="text-sm font-extrabold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {rel.reference} — {rel.title}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                            {(rel.amountCentavos !== undefined && rel.amountCentavos !== null) && (
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatPHP(rel.amountCentavos)}</span>
                            )}
                            {rel.date && <span>Date: {formatDateTime(rel.date)}</span>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadgeStyle(rel.status)}`}>
                            {rel.status}
                          </span>
                          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                            Open 360° <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    ))}
                    {relatedRecords.length === 0 && (
                      <div className="col-span-2 py-12 text-center text-slate-400 text-sm">
                        No linked records found for this entity.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 7: DOCUMENTS, VERSION JOURNEY & OCR HISTORY */}
              {activeTab === 'documents' && (
                <div className="space-y-4">
                  {documentVersions.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="px-5 py-3.5 bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <span className="font-extrabold text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                          Immutable Document Version Journey ({documentVersions.length} Versions Preserved)
                        </span>
                        <span className="text-[11px] font-bold text-emerald-600">
                          Original Version 1 Preserved • SHA-256 Verified
                        </span>
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase">
                          <tr>
                            <th className="py-2.5 px-4">Version</th>
                            <th className="py-2.5 px-4">File Name</th>
                            <th className="py-2.5 px-4">Change Type / Reason</th>
                            <th className="py-2.5 px-4">Uploaded By</th>
                            <th className="py-2.5 px-4">SHA-256 Hash</th>
                            <th className="py-2.5 px-4 text-right">Status / Restore</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {documentVersions.map((ver: any) => (
                            <tr key={ver.id}>
                              <td className="py-2.5 px-4 font-mono font-black text-indigo-600">v{ver.versionNumber}</td>
                              <td className="py-2.5 px-4 font-bold">{ver.fileName}</td>
                              <td className="py-2.5 px-4">{ver.changeType}: {ver.changeReason}</td>
                              <td className="py-2.5 px-4">{ver.uploadedByName || ver.uploadedBy}</td>
                              <td className="py-2.5 px-4 font-mono text-[10px] text-slate-400">{(ver.fileHash || '').slice(0, 16)}...</td>
                              <td className="py-2.5 px-4 text-right">
                                {ver.status === 'ACTIVE' ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">ACTIVE</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const d = await apiFetch(`/api/journey/documents/${activeEntity.entityId}/versions/${ver.id}/restore`, {
                                          method: 'POST',
                                          body: { reason: `Restored historical version v${ver.versionNumber}` } as any,
                                        });
                                        setActionFeedback({ type: 'success', message: d.message || `Restored version v${ver.versionNumber}.` });
                                        if (onActionSuccess) onActionSuccess();
                                        await fetch360Data(activeEntity.entityType, activeEntity.entityId);
                                      } catch (err: any) {
                                        setActionFeedback({ type: 'error', message: err?.data?.message || err.message || 'Failed to restore document version.' });
                                      }
                                    }}
                                    className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold"
                                  >
                                    Restore v{ver.versionNumber}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="font-extrabold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-indigo-600" /> Supporting Evidence & OCR Documents ({documentsList.length})
                      </span>
                    </div>
                    {documentsList.length === 0 ? (
                      <div className="p-12 text-center text-slate-400 text-xs">
                        No supporting documents recorded in the vault yet.
                      </div>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-3 px-4">File Name</th>
                            <th className="py-3 px-4">Type</th>
                            <th className="py-3 px-4">OCR Status</th>
                            <th className="py-3 px-4">Uploaded At</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {documentsList.map((doc: any) => (
                            <tr key={doc.id}>
                              <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">{doc.fileName}</td>
                              <td className="py-3 px-4 font-mono text-slate-500">{doc.fileType}</td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                                  {doc.ocrStatus || 'PROCESSED'}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono text-slate-500">{formatDateTime(doc.uploadedAt)}</td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => handleDrillDown({ entityType: 'DOCUMENT', entityId: doc.id, type: 'Document', reference: doc.fileName, title: doc.ocrStatus })}
                                  className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                                >
                                  Inspect Doc 360°
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 8: AUDIT INFORMATION (Standardized 12-Field Ownership & Touch Matrix) */}
              {activeTab === 'audit' && (
                <div className="space-y-6">
                  <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 text-xs text-indigo-950 dark:text-indigo-200 space-y-1">
                    <div className="font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      Standardized Ownership & Touch Distinction Rule
                    </div>
                    <p>
                      <strong>Last Modified By</strong> ({ownership.lastModifiedBy || 'None'}) identifies the last user who changed record data fields. <strong>Last Action By / Last Touched By</strong> ({ownership.lastActionBy || 'None'}) identifies the user who performed the latest recorded workflow action (e.g., Approval, Posting, Cancellation).
                    </p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 font-extrabold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Canonical 20-Field Ownership & Touch Tracking Matrix (Phase 3)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:gap-px bg-slate-200 dark:bg-slate-800">
                      {[
                        { field: 'Created By', value: ownership.createdBy || '—', meaning: 'Original creator identity' },
                        { field: 'Created At', value: formatDateTime(ownership.createdAt), meaning: 'Original creation timestamp' },
                        { field: 'Last Modified By', value: ownership.lastModifiedBy || ownership.createdBy || '—', meaning: 'Last user who changed record data fields' },
                        { field: 'Last Modified At', value: formatDateTime(ownership.lastModifiedAt || ownership.createdAt), meaning: 'Last data modification timestamp' },
                        { field: 'Submitted By', value: ownership.submittedBy || '—', meaning: 'User who submitted record for approval' },
                        { field: 'Submitted At', value: formatDateTime(ownership.submittedAt), meaning: 'Submission timestamp' },
                        { field: 'Approved By', value: ownership.approvedBy || ownership.lastApprovedBy || '—', meaning: 'Authorized approver identity' },
                        { field: 'Approved At', value: formatDateTime(ownership.approvedAt || ownership.lastApprovedAt), meaning: 'Approval decision timestamp' },
                        { field: 'Posted By', value: ownership.postedBy || '—', meaning: 'Authorized user who posted to GL' },
                        { field: 'Posted At', value: formatDateTime(ownership.postedAt), meaning: 'General Ledger posting timestamp' },
                        { field: 'Reversed By', value: ownership.reversedBy || '—', meaning: 'Authorized user who reversed posted entry' },
                        { field: 'Reversed At', value: formatDateTime(ownership.reversedAt), meaning: 'Accounting reversal timestamp' },
                        { field: 'Last Action By', value: ownership.lastActionBy || '—', meaning: 'User who performed latest non-failed action' },
                        { field: 'Last Action At', value: formatDateTime(ownership.lastActionAt), meaning: 'Timestamp of latest workflow action' },
                        { field: 'Cancelled By', value: ownership.cancelledBy || '—', meaning: 'User who authorized cancellation' },
                        { field: 'Cancelled At', value: formatDateTime(ownership.cancelledAt), meaning: 'Cancellation timestamp' },
                        { field: 'Deleted By', value: ownership.deletedBy || '—', meaning: 'User who executed controlled soft-delete' },
                        { field: 'Deleted At', value: formatDateTime(ownership.deletedAt), meaning: 'Controlled soft-delete timestamp' },
                        { field: 'Restored By', value: ownership.restoredBy || '—', meaning: 'User who restored archived/deleted record' },
                        { field: 'Restored At', value: formatDateTime(ownership.restoredAt), meaning: 'Restoration event timestamp' }
                      ].map((row, idx) => (
                        <div key={idx} className="bg-white dark:bg-slate-900 p-4 space-y-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                            {row.field}
                          </span>
                          <div className="font-bold text-xs text-slate-900 dark:text-white font-mono">
                            {row.value}
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {row.meaning}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="shrink-0 px-6 py-3.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
            <ShieldCheck className="w-4 h-4" />
            <span>Immutable Append-Only Audit Ledger • Tenant-Scoped Integrity Verified</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            Close 360° Workspace
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;
}
