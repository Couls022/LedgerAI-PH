import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Info,
  Lock,
  Unlock,
  RefreshCw,
  FileCheck2,
  History,
  Sliders,
  Layers,
  ExternalLink,
  Activity,
  X,
  Check,
  Hash,
  Clock,
  UserCheck,
  ArrowRight,
} from 'lucide-react';
import { formatEnterpriseTimestamp } from '../../../shared/timestampUtils';
import RecordActivityModal from '../RecordActivityModal';
import { apiFetch } from '../../utils/apiClient';

interface PeriodCloseWorkspaceModalProps {
  periodId: string;
  initialTab?: 'OVERVIEW' | 'CHECKLIST' | 'EXECUTE' | 'CERTIFICATIONS' | 'HISTORY' | 'POLICY';
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
  onPeriodUpdated: () => void;
  onNavigateModule?: (route: string) => void;
}

const formatPhp = (centavos: number | undefined | null): string => {
  const val = Number(centavos || 0) / 100;
  return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const PeriodCloseWorkspaceModal: React.FC<PeriodCloseWorkspaceModalProps> = ({
  periodId,
  initialTab = 'OVERVIEW',
  canEdit,
  canApprove,
  onClose,
  onPeriodUpdated,
  onNavigateModule,
}) => {
  const [activeTab, setActiveTab] = useState<
    'OVERVIEW' | 'CHECKLIST' | 'EXECUTE' | 'CERTIFICATIONS' | 'HISTORY' | 'POLICY'
  >(initialTab);
  const [closeTarget, setCloseTarget] = useState<'SOFT_CLOSE' | 'HARD_CLOSE'>('HARD_CLOSE');
  const [workspace, setWorkspace] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [validating, setValidating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Checklist filter
  const [checklistFilter, setChecklistFilter] = useState<
    'ALL' | 'BLOCKING' | 'WARNING' | 'INFORMATIONAL' | 'PASSED'
  >('ALL');

  // Execution form state
  const [closingReason, setClosingReason] = useState<string>('');
  const [warningJustification, setWarningJustification] = useState<string>('');
  const [reopenReason, setReopenReason] = useState<string>('');
  const [reopenApproverName, setReopenApproverName] = useState<string>('');
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);

  // Policy editor state
  const [policyDraft, setPolicyDraft] = useState<any | null>(null);
  const [savingPolicy, setSavingPolicy] = useState<boolean>(false);

  // 360° modal state for inspecting sample exception records directly
  const [selected360Record, setSelected360Record] = useState<{
    entityType: string;
    entityId: string;
    title: string;
  } | null>(null);

  const fetchWorkspace = useCallback(
    async (target: 'SOFT_CLOSE' | 'HARD_CLOSE' = closeTarget) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<any>(
          `/api/accounting/periods/${periodId}/workspace?closeTarget=${target}`
        );
        setWorkspace(data);
        setPolicyDraft(data.policy);
      } catch (err: any) {
        setError(err.message || 'Error loading Period Close Workspace');
      } finally {
        setLoading(false);
      }
    },
    [periodId, closeTarget]
  );

  useEffect(() => {
    fetchWorkspace(closeTarget);
  }, [fetchWorkspace, closeTarget]);

  const handleRunValidation = async () => {
    setValidating(true);
    setActionMessage(null);
    try {
      const data = await apiFetch<any>(`/api/accounting/periods/${periodId}/validate`, {
        method: 'POST',
        body: { closeTarget } as any,
      });
      setWorkspace(data.workspace);
      setPolicyDraft(data.workspace.policy);
      setActionMessage({
        type: 'success',
        text: `Live validation snapshot (${data.validationSnapshotId}) recorded. Readiness: ${data.workspace.readinessSummary.readinessScore}%.`,
      });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setValidating(false);
    }
  };

  const handleExecuteSoftClose = async () => {
    if (!closingReason.trim()) {
      setActionMessage({
        type: 'error',
        text: 'Please provide a Closing Reason before executing Soft Close.',
      });
      return;
    }
    setSubmittingAction(true);
    setActionMessage(null);
    try {
      const data = await apiFetch<any>(`/api/accounting/periods/${periodId}/soft-close`, {
        method: 'POST',
        body: {
          reason: closingReason.trim(),
          warningJustification: warningJustification.trim() || undefined,
          expectedVersion: workspace?.periodInfo?.version,
          enforceEvidenceChecks: true,
        } as any,
      });
      setActionMessage({
        type: 'success',
        text: `Period '${workspace?.periodInfo?.name}' soft-closed with validation snapshot ${data.validationSnapshotId}.`,
      });
      setClosingReason('');
      setWarningJustification('');
      await fetchWorkspace('SOFT_CLOSE');
      onPeriodUpdated();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleExecuteHardClose = async () => {
    if (!closingReason.trim()) {
      setActionMessage({
        type: 'error',
        text: 'Please provide a Closing Reason before executing Hard Close & Certification.',
      });
      return;
    }
    setSubmittingAction(true);
    setActionMessage(null);
    try {
      const data = await apiFetch<any>(`/api/accounting/periods/${periodId}/hard-close`, {
        method: 'POST',
        body: {
          reason: closingReason.trim(),
          warningJustification: warningJustification.trim() || undefined,
          expectedVersion: workspace?.periodInfo?.version,
          enforceEvidenceChecks: true,
        } as any,
      });
      setActionMessage({
        type: 'success',
        text: `Period '${workspace?.periodInfo?.name}' hard-closed! Immutable Certification Snapshot ${data.certification?.id} generated (SHA-256: ${data.certification?.sha256Hash?.slice(0, 16)}...).`,
      });
      setClosingReason('');
      setWarningJustification('');
      await fetchWorkspace('HARD_CLOSE');
      setActiveTab('CERTIFICATIONS');
      onPeriodUpdated();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleExecuteReopen = async () => {
    if (!reopenReason.trim()) {
      setActionMessage({
        type: 'error',
        text: 'A mandatory audit reason is required to reopen a closed period.',
      });
      return;
    }
    setSubmittingAction(true);
    setActionMessage(null);
    try {
      const data = await apiFetch<any>(`/api/accounting/periods/${periodId}/reopen`, {
        method: 'POST',
        body: {
          reason: reopenReason.trim(),
          approvedByUserName: reopenApproverName.trim() || undefined,
          expectedVersion: workspace?.periodInfo?.version,
        } as any,
      });
      setActionMessage({
        type: 'success',
        text: `Period reopened. ${data.preservedCertificationsCount} prior certification snapshot(s) preserved. Revalidation is required before re-closing.`,
      });
      setReopenReason('');
      await fetchWorkspace(closeTarget);
      onPeriodUpdated();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSavePolicy = async () => {
    if (!policyDraft) return;
    setSavingPolicy(true);
    setActionMessage(null);
    try {
      const data = await apiFetch<any>('/api/accounting/period-close-policy', {
        method: 'PUT',
        body: policyDraft as any,
      });
      setActionMessage({
        type: 'success',
        text: `Company Period Close Policy updated to v${data.policy.policyVersion}.`,
      });
      await fetchWorkspace(closeTarget);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSavingPolicy(false);
    }
  };

  const renderSeverityBadge = (status: string) => {
    switch (status) {
      case 'PASSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 rounded">
            <CheckCircle2 className="w-3.5 h-3.5" /> PASSED
          </span>
        );
      case 'BLOCKING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold bg-red-100 text-red-800 border border-red-200 rounded">
            <XCircle className="w-3.5 h-3.5" /> BLOCKING
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200 rounded">
            <AlertTriangle className="w-3.5 h-3.5" /> WARNING
          </span>
        );
      case 'INFORMATIONAL':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200 rounded">
            <Info className="w-3.5 h-3.5" /> INFORMATIONAL
          </span>
        );
    }
  };

  const periodInfo = workspace?.periodInfo;
  const readiness = workspace?.readinessSummary;
  const fin = workspace?.financialOverview;
  const sections: any[] = workspace?.checklistSections || [];
  const certifications: any[] = workspace?.certifications || [];
  const historyList: any[] = workspace?.history || [];
  const postReopenList: any[] = workspace?.postReopenActivity || [];

  const filteredSections = sections.filter((sec) => {
    if (checklistFilter === 'ALL') return true;
    return sec.validationStatus === checklistFilter;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      data-testid="period-close-workspace-modal"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-400/30 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 rounded">
                  Evidence-Driven Period Close Workspace
                </span>
                {periodInfo && (
                  <span
                    data-testid="workspace-period-status-badge"
                    className={`text-xs font-bold px-2.5 py-0.5 rounded ${
                      periodInfo.status === 'OPEN'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : periodInfo.status === 'SOFT_CLOSED'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-red-500/20 text-red-300 border border-red-500/30'
                    }`}
                  >
                    {periodInfo.status}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white mt-0.5">
                {periodInfo
                  ? `${periodInfo.name} (${periodInfo.startDate} to ${periodInfo.endDate}) — FY ${periodInfo.fiscalYear}`
                  : 'Loading Accounting Period...'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Target Mode Switcher */}
            <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setCloseTarget('SOFT_CLOSE')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  closeTarget === 'SOFT_CLOSE'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Soft Close Rules
              </button>
              <button
                type="button"
                onClick={() => setCloseTarget('HARD_CLOSE')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  closeTarget === 'HARD_CLOSE'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Hard Close Rules
              </button>
            </div>

            <button
              type="button"
              onClick={handleRunValidation}
              disabled={validating || loading}
              data-testid="btn-run-period-validation"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${validating ? 'animate-spin' : ''}`} />
              {validating ? 'Validating...' : 'Run Live Revalidation'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              title="Close Workspace"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-header Metadata Strip */}
        {periodInfo && readiness && (
          <div className="bg-slate-50 px-6 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-4">
              <span>
                <strong>Period ID:</strong> <code className="text-slate-800">{periodInfo.id}</code>
              </span>
              <span>
                <strong>Company Lock Date:</strong>{' '}
                <span className="font-semibold text-slate-800">
                  {periodInfo.companyLockDate || 'None'}
                </span>
              </span>
              {periodInfo.closedByName && (
                <span>
                  <strong>Last Closed By:</strong> {periodInfo.closedByName} (
                  {formatEnterpriseTimestamp(periodInfo.closedAt)})
                </span>
              )}
              {periodInfo.reopenedByName && (
                <span className="text-amber-700 font-medium">
                  <strong>Reopened By:</strong> {periodInfo.reopenedByName} (
                  {formatEnterpriseTimestamp(periodInfo.reopenedAt)})
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span>
                <strong>Readiness Score:</strong>{' '}
                <span
                  className={`font-bold ${
                    readiness.readinessScore >= 90
                      ? 'text-emerald-700'
                      : readiness.readinessScore >= 70
                        ? 'text-amber-700'
                        : 'text-red-700'
                  }`}
                >
                  {readiness.readinessScore}%
                </span>
              </span>
              <span className="text-red-700 font-bold">
                {readiness.totalBlockingCount} Blocking
              </span>
              <span className="text-amber-700 font-bold">
                {readiness.totalWarningCount} Warning
              </span>
              <span className="text-sky-700 font-bold">
                {readiness.totalInformationalCount} Info
              </span>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="px-6 bg-white border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'OVERVIEW', label: '1. Financial Overview', icon: Layers },
            {
              id: 'CHECKLIST',
              label: `2. 12-Section Checklist (${readiness?.passedSectionsCount || 0}/12 Passed)`,
              icon: CheckCircle2,
            },
            { id: 'EXECUTE', label: '3. Close & Reopen Controls', icon: Lock },
            {
              id: 'CERTIFICATIONS',
              label: `4. Certifications (${certifications.length})`,
              icon: FileCheck2,
            },
            {
              id: 'HISTORY',
              label: `5. Audit History (${historyList.length})`,
              icon: History,
            },
            { id: 'POLICY', label: '6. Closing Policy Rules', icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`workspace-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as any)}
                className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Action / Status Banner */}
        {actionMessage && (
          <div
            className={`px-6 py-3 text-xs font-medium flex items-center justify-between border-b ${
              actionMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-800 border-red-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{actionMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              className="text-slate-500 hover:text-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-6">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              Evaluating period-scoped General Ledger, Trial Balance, Subledgers, and 12-Section
              Closing Checklist...
            </div>
          ) : error ? (
            <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <strong>Error loading workspace:</strong> {error}
            </div>
          ) : (
            <>
              {/* TAB 1: FINANCIAL OVERVIEW */}
              {activeTab === 'OVERVIEW' && fin && (
                <div className="space-y-6" data-testid="workspace-overview-panel">
                  {/* Reopen Revalidation Alert if applicable */}
                  {readiness?.requiresRevalidationAfterReopen && (
                    <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-900">
                          <p className="font-bold text-sm">
                            Reopened Period Requires Live Revalidation Before Closing
                          </p>
                          <p className="mt-0.5">
                            This period was previously reopened ({periodInfo.reopenReason}).{' '}
                            {readiness.postReopenJournalCount} journal entry touch(es) occurred on
                            or after reopen. Click <strong>Run Live Revalidation</strong> to
                            certify current balances.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRunValidation}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer"
                      >
                        Revalidate Now
                      </button>
                    </div>
                  )}

                  {/* Primary GL & Trial Balance Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase text-slate-400">
                        Period Total Debit (GL)
                      </div>
                      <div
                        className="text-xl font-black text-slate-900 mt-1"
                        data-testid="overview-total-debit"
                      >
                        {formatPhp(fin.totalDebitCentavos)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Across {fin.postedJournalCount} posted journals
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase text-slate-400">
                        Period Total Credit (GL)
                      </div>
                      <div
                        className="text-xl font-black text-slate-900 mt-1"
                        data-testid="overview-total-credit"
                      >
                        {formatPhp(fin.totalCreditCentavos)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Variance: {formatPhp(fin.varianceCentavos)}
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase text-slate-400">
                        Trial Balance Status
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span
                          data-testid="overview-tb-status"
                          className={`px-2.5 py-1 text-xs font-black rounded ${
                            fin.trialBalanceStatus === 'BALANCED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : fin.trialBalanceStatus === 'NO_POSTED_ACTIVITY'
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {fin.trialBalanceStatus}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-2">
                        {fin.unpostedJournalCount === 0
                          ? 'Zero unposted journals in queue'
                          : `${fin.unpostedJournalCount} unposted (${fin.draftJournalCount} draft, ${fin.submittedJournalCount} submitted, ${fin.approvedUnpostedJournalCount} approved)`}
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase text-slate-400">
                        Period Net Income Summary
                      </div>
                      <div
                        className={`text-xl font-black mt-1 ${
                          fin.netIncomeSummaryCentavos >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {formatPhp(fin.netIncomeSummaryCentavos)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Rev: {formatPhp(fin.revenueSummaryCentavos)} • Exp:{' '}
                        {formatPhp(fin.expenseSummaryCentavos)}
                      </div>
                    </div>
                  </div>

                  {/* Subledger & Operational Readiness Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          Accounts Receivable & Payable
                        </span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                          Subledgers
                        </span>
                      </div>
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">
                            AR Open Balance ({fin.arOpenInvoiceCount} invoices):
                          </span>
                          <span className="font-bold text-slate-900">
                            {formatPhp(fin.arOutstandingCentavos)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">
                            AP Open Balance ({fin.apOpenBillCount} bills):
                          </span>
                          <span className="font-bold text-slate-900">
                            {formatPhp(fin.apOutstandingCentavos)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          Bank Reconciliation & Cash
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            fin.bankReconciliation.status === 'RECONCILED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {fin.bankReconciliation.status}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Bank Accounts / Reconciled Sessions:</span>
                          <span className="font-bold text-slate-900">
                            {fin.bankReconciliation.totalBankAccounts} /{' '}
                            {fin.bankReconciliation.reconciledSessionCount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Open Sessions / Unmatched Lines:</span>
                          <span className="font-bold text-slate-900">
                            {fin.bankReconciliation.openSessionCount} /{' '}
                            {fin.bankReconciliation.unreconciledBankTxCount}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          Inventory Valuation & COGS
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            fin.inventoryValuation.status === 'VALUED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {fin.inventoryValuation.status}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Active SKUs ({fin.inventoryValuation.activeSkuCount}):</span>
                          <span className="font-bold text-slate-900">
                            {formatPhp(fin.inventoryValuation.totalValuationCentavos)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Negative Stock / Unposted Adj:</span>
                          <span className="font-bold text-slate-900">
                            {fin.inventoryValuation.negativeStockCount} /{' '}
                            {fin.inventoryValuation.unpostedAdjustmentCount}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          Payroll & Statutory Posting
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            fin.payrollPosting.status === 'POSTED' ||
                            fin.payrollPosting.status === 'NO_PAYROLL_RUNS'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {fin.payrollPosting.status}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Posted / Unposted Payroll Runs:</span>
                          <span className="font-bold text-slate-900">
                            {fin.payrollPosting.postedRunCount} /{' '}
                            {fin.payrollPosting.unpostedRunCount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Period Gross Payroll:</span>
                          <span className="font-bold text-slate-900">
                            {formatPhp(fin.payrollPosting.totalGrossPayCentavos)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          Philippine Tax Compliance
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            fin.taxCompliance.status === 'COMPLIANT'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {fin.taxCompliance.status}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Net VAT Payable / EWT Payable:</span>
                          <span className="font-bold text-slate-900">
                            {formatPhp(fin.taxCompliance.netVatPayableCentavos)} /{' '}
                            {formatPhp(fin.taxCompliance.ewtPayableCentavos)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Filed Returns / Draft Returns:</span>
                          <span className="font-bold text-slate-900">
                            {fin.taxCompliance.filedReturnsCount} /{' '}
                            {fin.taxCompliance.draftReturnsCount}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          Fixed Asset Depreciation
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            fin.fixedAssetDepreciation.status === 'DEPRECIATED' ||
                            fin.fixedAssetDepreciation.status === 'NO_DEPRECIABLE_ASSETS'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {fin.fixedAssetDepreciation.status}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Depreciated / Missing Assets:</span>
                          <span className="font-bold text-slate-900">
                            {fin.fixedAssetDepreciation.depreciationRecordedCount} /{' '}
                            {fin.fixedAssetDepreciation.missingDepreciationCount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Period Depreciation Expense:</span>
                          <span className="font-bold text-slate-900">
                            {formatPhp(fin.fixedAssetDepreciation.periodDepreciationCentavos)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: 12-SECTION CLOSING CHECKLIST */}
              {activeTab === 'CHECKLIST' && (
                <div className="space-y-4" data-testid="workspace-checklist-panel">
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        12-Section Period Close Checklist ({closeTarget.replace('_', ' ')} Mode)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Live verification of underlying records across all 12 accounting,
                        operational, tax, and governance controls.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['ALL', 'BLOCKING', 'WARNING', 'INFORMATIONAL', 'PASSED'] as const).map(
                        (flt) => (
                          <button
                            key={flt}
                            type="button"
                            onClick={() => setChecklistFilter(flt)}
                            className={`px-3 py-1 text-xs font-bold rounded-lg border cursor-pointer ${
                              checklistFilter === flt
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {flt}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredSections.map((sec) => (
                      <div
                        key={sec.sectionCode}
                        data-testid={`checklist-section-${sec.sectionNumber}`}
                        className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                          <div>
                            <div className="flex items-center gap-2.5">
                              <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
                                {sec.sectionNumber}
                              </span>
                              <h4 className="text-sm font-bold text-slate-900">
                                {sec.sectionName}
                              </h4>
                              {renderSeverityBadge(sec.validationStatus)}
                              <span className="text-[11px] font-medium px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                Source: {sec.sourceModule}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">{sec.summaryText}</p>
                          </div>

                          <div className="flex items-center gap-4 text-xs">
                            <div className="text-right">
                              <div className="text-slate-400 font-medium">Records / Amount</div>
                              <div className="font-bold text-slate-800">
                                {sec.relevantCount} records •{' '}
                                {formatPhp(sec.relevantAmountCentavos)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-slate-400 font-medium">Exceptions</div>
                              <div
                                className={`font-bold ${
                                  sec.unresolvedExceptionCount > 0
                                    ? 'text-red-600'
                                    : 'text-emerald-600'
                                }`}
                              >
                                {sec.unresolvedExceptionCount} unresolved
                              </div>
                            </div>
                            {onNavigateModule && (
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onNavigateModule(sec.navigationRoute);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer"
                              >
                                Open Module <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 space-y-2">
                          {sec.checks.map((chk: any) => (
                            <div
                              key={chk.checkCode}
                              className={`p-3 rounded-lg border text-xs flex flex-col gap-2 ${
                                chk.passed
                                  ? 'bg-slate-50/70 border-slate-200/80'
                                  : chk.severity === 'BLOCKING'
                                    ? 'bg-red-50/60 border-red-200'
                                    : chk.severity === 'WARNING'
                                      ? 'bg-amber-50/60 border-amber-200'
                                      : 'bg-sky-50/60 border-sky-200'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {chk.passed ? (
                                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                                  ) : chk.severity === 'BLOCKING' ? (
                                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                                  ) : (
                                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                  )}
                                  <span className="font-bold text-slate-900">{chk.title}</span>
                                  <code className="text-[10px] px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500">
                                    {chk.checkCode}
                                  </code>
                                </div>
                                <div className="flex items-center gap-2">
                                  {!chk.passed && renderSeverityBadge(chk.severity)}
                                  {chk.count > 0 && (
                                    <span className="font-bold text-slate-700">
                                      Count: {chk.count}
                                    </span>
                                  )}
                                  {chk.amountCentavos > 0 && (
                                    <span className="font-bold text-slate-700">
                                      {formatPhp(chk.amountCentavos)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-slate-600 pl-6">{chk.description}</p>

                              {chk.sampleRecords && chk.sampleRecords.length > 0 && (
                                <div className="pl-6 pt-1 flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-semibold text-slate-500">
                                    Underlying Records:
                                  </span>
                                  {chk.sampleRecords.map((rec: any) => (
                                    <button
                                      key={rec.id}
                                      type="button"
                                      onClick={() =>
                                        setSelected360Record({
                                          entityType: rec.entityType,
                                          entityId: rec.id,
                                          title: `${rec.reference} (${rec.status || ''})`,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[11px] font-semibold cursor-pointer"
                                    >
                                      <Activity className="w-3 h-3" />
                                      {rec.reference}
                                      {rec.amountCentavos ? ` (${formatPhp(rec.amountCentavos)})` : ''}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: CLOSE & REOPEN EXECUTION */}
              {activeTab === 'EXECUTE' && periodInfo && readiness && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="workspace-execute-panel">
                  {/* Left Column: Soft Close & Hard Close */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Execute Period Closing
                        </h3>
                        <p className="text-xs text-slate-500">
                          Transition period to SOFT_CLOSED or generate an immutable HARD_CLOSED
                          certification.
                        </p>
                      </div>
                      <Lock className="w-5 h-5 text-indigo-600" />
                    </div>

                    {readiness.totalBlockingCount > 0 && (
                      <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
                        <div className="font-bold flex items-center gap-1.5">
                          <XCircle className="w-4 h-4 text-red-600" />
                          {readiness.totalBlockingCount} Unresolved BLOCKING Exception(s) Detected
                        </div>
                        <p>
                          Period close transitions cannot proceed while BLOCKING items remain
                          unresolved. Review Tab 2 (12-Section Checklist) to resolve or revalidate.
                        </p>
                      </div>
                    )}

                    {readiness.totalWarningCount > 0 && (
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          {readiness.totalWarningCount} Active WARNING Item(s) Require Justification
                        </div>
                        <p>
                          Company closing policy allows proceeding with WARNING items only when an
                          explicit audit justification is recorded below.
                        </p>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Closing Reason / Audit Narrative <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        rows={2}
                        value={closingReason}
                        onChange={(e) => setClosingReason(e.target.value)}
                        data-testid="input-closing-reason"
                        placeholder="e.g., Monthly accounting close completed after GL, TB, VAT, and subledger reconciliation..."
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {readiness.totalWarningCount > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-amber-800 mb-1">
                          Mandatory Warning Override Justification{' '}
                          <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          rows={2}
                          value={warningJustification}
                          onChange={(e) => setWarningJustification(e.target.value)}
                          data-testid="input-warning-justification"
                          placeholder="Explain why closing is authorized despite active WARNING items (e.g., draft invoices belong to next billing cycle)..."
                          className="w-full px-3 py-2 text-xs border border-amber-300 bg-amber-50/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    )}

                    <div className="pt-2 flex flex-wrap items-center gap-3">
                      {canEdit && periodInfo.status === 'OPEN' && (
                        <button
                          type="button"
                          disabled={submittingAction || !readiness.canSoftClose}
                          onClick={handleExecuteSoftClose}
                          data-testid="btn-execute-soft-close"
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-xs disabled:opacity-40 cursor-pointer"
                        >
                          Execute Soft Close
                        </button>
                      )}

                      {canApprove &&
                        periodInfo.status !== 'HARD_CLOSED' &&
                        periodInfo.status !== 'LOCKED' && (
                          <button
                            type="button"
                            disabled={submittingAction || !readiness.canHardClose}
                            onClick={handleExecuteHardClose}
                            data-testid="btn-execute-hard-close"
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-xs disabled:opacity-40 cursor-pointer"
                          >
                            Execute Hard Close & Generate Certification
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Right Column: Controlled Reopen */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Controlled Period Reopen
                        </h3>
                        <p className="text-xs text-slate-500">
                          Reopen a closed period with mandatory reason, maker-checker governance,
                          and preserved historical certifications.
                        </p>
                      </div>
                      <Unlock className="w-5 h-5 text-amber-600" />
                    </div>

                    {periodInfo.status === 'OPEN' ? (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                        Period <strong>{periodInfo.name}</strong> is currently{' '}
                        <strong>OPEN</strong>. Reopen controls become active when the period is in{' '}
                        <code>SOFT_CLOSED</code>, <code>HARD_CLOSED</code>, or <code>CLOSED</code>{' '}
                        status.
                      </div>
                    ) : (
                      <>
                        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-900">
                          <strong>Immutable Snapshot Preservation:</strong> Reopening this period
                          will preserve all {certifications.length} existing Period Close
                          Certification snapshot(s). Subsequent postings will be tracked as
                          post-reopen activity and will require fresh revalidation before
                          re-closing.
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Mandatory Reopen Reason <span className="text-red-500">*</span>
                          </label>
                          <textarea
                            rows={2}
                            value={reopenReason}
                            onChange={(e) => setReopenReason(e.target.value)}
                            data-testid="input-reopen-reason"
                            placeholder="State the audit or adjusting entry reason for reopening this closed period..."
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Secondary Approver / Maker-Checker Reference (Optional)
                          </label>
                          <input
                            type="text"
                            value={reopenApproverName}
                            onChange={(e) => setReopenApproverName(e.target.value)}
                            placeholder="e.g., CPA Controller / Finance Director"
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        {canApprove ? (
                          <button
                            type="button"
                            disabled={submittingAction}
                            onClick={handleExecuteReopen}
                            data-testid="btn-execute-reopen"
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs disabled:opacity-50 cursor-pointer"
                          >
                            Authorize & Reopen Period
                          </button>
                        ) : (
                          <div className="text-xs text-red-600 font-semibold">
                            You require <code>accounting:approve</code> privileges to reopen a
                            closed period.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: IMMUTABLE CERTIFICATIONS */}
              {activeTab === 'CERTIFICATIONS' && (
                <div className="space-y-4" data-testid="workspace-certifications-panel">
                  {certifications.length === 0 ? (
                    <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-500 text-sm">
                      No Period Close Certification snapshots have been generated for this period
                      yet. Execute a <strong>Hard Close</strong> to generate an immutable
                      SHA-256-sealed certification snapshot.
                    </div>
                  ) : (
                    certifications.map((cert) => (
                      <div
                        key={cert.id}
                        data-testid={`certification-card-${cert.id}`}
                        className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-0.5 text-xs font-bold bg-indigo-100 text-indigo-800 rounded">
                                {cert.id}
                              </span>
                              <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800 rounded inline-flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5" /> IMMUTABLE DB TRIGGER SEALED
                              </span>
                              <span className="text-xs text-slate-500">
                                Policy v{cert.closingPolicyVersion}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 mt-1">
                              Period Close Certification — {cert.periodName} ({cert.startDate} to{' '}
                              {cert.endDate})
                            </h4>
                          </div>

                          <div className="text-right text-xs">
                            <div className="font-bold text-slate-800">
                              Closed At: {cert.formattedClosedAt}
                            </div>
                            <div className="text-slate-500">
                              Closed By: {cert.closedByUserName} ({cert.closedByUserRole})
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 text-xs">
                          <div>
                            <div className="text-slate-400 font-semibold">Certified Total Debit</div>
                            <div className="font-bold text-slate-900 text-sm">
                              {formatPhp(cert.trialBalanceTotals?.totalDebitCentavos)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-semibold">
                              Certified Total Credit
                            </div>
                            <div className="font-bold text-slate-900 text-sm">
                              {formatPhp(cert.trialBalanceTotals?.totalCreditCentavos)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-semibold">
                              Trial Balance Equilibrium
                            </div>
                            <div className="font-bold text-emerald-700 text-sm">
                              {cert.trialBalanceTotals?.trialBalanceStatus || 'BALANCED'}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-semibold">
                              Posted Journals Sealed
                            </div>
                            <div className="font-bold text-slate-900 text-sm">
                              {cert.trialBalanceTotals?.postedJournalCount ?? 0} entries
                            </div>
                          </div>
                        </div>

                        <div className="text-xs space-y-1.5">
                          <div>
                            <strong>Closing Reason:</strong> {cert.closingReason}
                          </div>
                          {cert.warningJustification && (
                            <div className="text-amber-800">
                              <strong>Recorded Warning Justification:</strong>{' '}
                              {cert.warningJustification}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-slate-500 pt-1">
                            <Hash className="w-3.5 h-3.5 text-indigo-600" />
                            <span>
                              <strong>SHA-256 Digest:</strong>{' '}
                              <code className="bg-slate-100 px-2 py-0.5 rounded text-slate-800">
                                {cert.sha256Hash}
                              </code>
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 5: AUDIT HISTORY & POST-REOPEN ACTIVITY */}
              {activeTab === 'HISTORY' && (
                <div className="space-y-6" data-testid="workspace-history-panel">
                  {/* Post-Reopen Activity Section */}
                  {postReopenList.length > 0 && (
                    <div className="bg-white rounded-xl border border-amber-200 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-600" />
                          Post-Reopen Journal Activity ({postReopenList.length} entry/entries)
                        </h4>
                        <span className="text-xs font-semibold text-amber-700">
                          Recorded since last period reopen
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs divide-y divide-slate-200">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-bold text-slate-600">
                                Journal #
                              </th>
                              <th className="px-3 py-2 text-left font-bold text-slate-600">
                                Entry Date
                              </th>
                              <th className="px-3 py-2 text-left font-bold text-slate-600">
                                Source
                              </th>
                              <th className="px-3 py-2 text-left font-bold text-slate-600">
                                Status
                              </th>
                              <th className="px-3 py-2 text-left font-bold text-slate-600">
                                Timestamp
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {postReopenList.map((item) => (
                              <tr key={item.id}>
                                <td className="px-3 py-2 font-bold text-indigo-700">
                                  {item.journalNumber}
                                </td>
                                <td className="px-3 py-2">{item.entryDate}</td>
                                <td className="px-3 py-2">{item.sourceType}</td>
                                <td className="px-3 py-2 font-semibold">{item.status}</td>
                                <td className="px-3 py-2 text-slate-500">
                                  {item.formattedUpdatedAt}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Period Status History Timeline */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                    <h4 className="text-sm font-bold text-slate-900">
                      Authoritative Period Status & Governance Timeline
                    </h4>

                    {historyList.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No status transitions recorded for this period.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {historyList.map((h) => (
                          <div
                            key={h.id}
                            data-testid="period-history-entry"
                            className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 text-xs space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 font-bold bg-indigo-100 text-indigo-800 rounded">
                                  {h.action}
                                </span>
                                <span className="font-semibold text-slate-600">
                                  {h.previousStatus || 'NONE'}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                                <span className="font-bold text-slate-900">{h.newStatus}</span>
                              </div>
                              <span
                                className="text-slate-500 font-medium"
                                data-testid="period-history-timestamp"
                              >
                                {h.formattedTimestamp}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-600">
                              <div className="flex items-center gap-1.5">
                                <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                                <span>
                                  <strong>Executed By:</strong> {h.changedByName} ({h.changedByRole}
                                  )
                                </span>
                              </div>
                              {h.approvedByName && (
                                <div>
                                  <strong>Approved By:</strong> {h.approvedByName}
                                </div>
                              )}
                            </div>

                            {h.reason && (
                              <div className="text-slate-700">
                                <strong>Reason:</strong> {h.reason}
                              </div>
                            )}

                            {h.warningJustification && (
                              <div className="text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded border border-amber-200">
                                <strong>Warning Justification:</strong> {h.warningJustification}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-500">
                              {h.validationSnapshotId && (
                                <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">
                                  Validation Snapshot: <code>{h.validationSnapshotId}</code>
                                </span>
                              )}
                              {h.certificationSnapshotId && (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded font-semibold">
                                  Certification: <code>{h.certificationSnapshotId}</code>
                                </span>
                              )}
                              {h.certificationSha256 && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                                  SHA-256: <code>{h.certificationSha256.slice(0, 16)}...</code>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 6: CLOSING POLICY RULES */}
              {activeTab === 'POLICY' && policyDraft && (
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4" data-testid="workspace-policy-panel">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Company Period Closing Policy (Version v{policyDraft.policyVersion})
                      </h3>
                      <p className="text-xs text-slate-500">
                        Configure company-level controls for warning justifications, maker-checker
                        reopen governance, and materiality thresholds. Core double-entry & hash
                        integrity checks remain strictly BLOCKING.
                      </p>
                    </div>
                    {canApprove && (
                      <button
                        type="button"
                        disabled={savingPolicy}
                        onClick={handleSavePolicy}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                      >
                        {savingPolicy ? 'Saving...' : 'Save Policy Rules'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-lg bg-slate-50">
                      <input
                        type="checkbox"
                        checked={Boolean(policyDraft.requireWarningJustification)}
                        disabled={!canApprove}
                        onChange={(e) =>
                          setPolicyDraft({
                            ...policyDraft,
                            requireWarningJustification: e.target.checked,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-bold text-slate-900">
                          Require Warning Justification
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          Mandate a recorded audit explanation whenever closing a period with
                          active WARNING items.
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-lg bg-slate-50">
                      <input
                        type="checkbox"
                        checked={Boolean(policyDraft.requireMakerCheckerReopen)}
                        disabled={!canApprove}
                        onChange={(e) =>
                          setPolicyDraft({
                            ...policyDraft,
                            requireMakerCheckerReopen: e.target.checked,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-bold text-slate-900">
                          Enforce Maker-Checker on Reopen
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          Require a secondary approver different from the closing user when
                          reopening a closed period.
                        </div>
                      </div>
                    </label>

                    <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                      <div className="font-bold text-slate-900">
                        Supporting Document Materiality Threshold (PHP)
                      </div>
                      <input
                        type="number"
                        disabled={!canApprove}
                        value={Math.round(
                          Number(policyDraft.supportingDocThresholdCentavos || 5000000) / 100
                        )}
                        onChange={(e) =>
                          setPolicyDraft({
                            ...policyDraft,
                            supportingDocThresholdCentavos: Math.max(
                              0,
                              Number(e.target.value || 0) * 100
                            ),
                          })
                        }
                        className="mt-1.5 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Nested 360° Record Activity Modal for Underlying Checklist Sample Records */}
      {selected360Record && (
        <RecordActivityModal
          isOpen={true}
          onClose={() => setSelected360Record(null)}
          entityType={selected360Record.entityType}
          entityId={selected360Record.entityId}
          title={selected360Record.title}
        />
      )}
    </div>
  );
};
