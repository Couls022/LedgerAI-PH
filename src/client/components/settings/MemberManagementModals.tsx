import React, { useState } from 'react';
import { 
  CheckCircle2, AlertCircle, AlertTriangle, X, Loader2, UserX, UserCheck, 
  Trash2, ShieldAlert, KeyRound, Eye, EyeOff, UserMinus, ShieldCheck, Mail
} from 'lucide-react';
import { LedgerRole } from '../../context/AuthContext';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

export interface Member {
  membershipId?: string;
  userId: string;
  displayName: string;
  email: string;
  status: string;
  role: LedgerRole;
  roleName: string;
  roles?: LedgerRole[];
  overrides?: Array<{ id: string; permissionCode: string; effect: 'ALLOW' | 'DENY'; reason?: string }>;
  createdAt?: string;
}

// ==========================================
// TOAST CONTAINER & NOTIFICATION COMPONENT
// ==========================================
export function ToastContainer({
  toasts,
  onDismiss
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-3 duration-200 ${
              isSuccess
                ? 'bg-emerald-950/90 dark:bg-emerald-950/95 border-emerald-500/30 text-emerald-100'
                : isError
                ? 'bg-rose-950/90 dark:bg-rose-950/95 border-rose-500/30 text-rose-100'
                : 'bg-slate-900/90 dark:bg-slate-900/95 border-slate-700 text-slate-100'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {isError && <AlertCircle className="w-5 h-5 text-rose-400" />}
              {!isSuccess && !isError && <AlertTriangle className="w-5 h-5 text-amber-400" />}
            </div>

            <div className="flex-1 text-xs">
              {toast.title && (
                <h4 className="font-bold text-sm mb-0.5 tracking-tight text-white">
                  {toast.title}
                </h4>
              )}
              <p className="leading-relaxed opacity-95">{toast.message}</p>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 text-slate-400 hover:text-white transition-colors p-1 -mr-1 rounded-lg"
              title="Close notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// MEMBER STATUS TOGGLE SWITCH
// ==========================================
export function MemberStatusToggle({
  status,
  onToggle,
  disabled = false,
  isChanging = false,
  size = 'md'
}: {
  status: 'ACTIVE' | 'DISABLED' | string;
  onToggle: () => void;
  disabled?: boolean;
  isChanging?: boolean;
  size?: 'sm' | 'md';
}) {
  const isActive = status === 'ACTIVE';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      disabled={disabled || isChanging}
      onClick={onToggle}
      title={isActive ? 'Click to disable member account' : 'Click to activate member account'}
      className={`relative inline-flex items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        isActive
          ? 'bg-emerald-600 dark:bg-emerald-500'
          : 'bg-slate-300 dark:bg-slate-600'
      } ${size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'}`}
    >
      <span className="sr-only">Toggle Member Status</span>
      <span
        className={`inline-block transform rounded-full bg-white shadow-md transition-transform flex items-center justify-center ${
          size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'
        } ${
          isActive
            ? size === 'sm'
              ? 'translate-x-4.5'
              : 'translate-x-5.5'
            : 'translate-x-1'
        }`}
      >
        {isChanging && <Loader2 className="w-2.5 h-2.5 animate-spin text-slate-600" />}
      </span>
    </button>
  );
}

// ==========================================
// MEMBER STATUS CONFIRMATION MODAL
// ==========================================
export function StatusConfirmationModal({
  isOpen,
  onClose,
  member,
  targetStatus,
  onConfirm,
  isLoading
}: {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  targetStatus: 'ACTIVE' | 'DISABLED';
  onConfirm: (reason?: string) => Promise<void>;
  isLoading: boolean;
}) {
  const [reason, setReason] = useState('');

  if (!isOpen || !member) return null;

  const isDisabling = targetStatus === 'DISABLED';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className={`p-6 border-b ${isDisabling ? 'bg-amber-500/10 border-amber-200 dark:border-amber-900/40' : 'bg-emerald-500/10 border-emerald-200 dark:border-emerald-900/40'} flex items-start gap-4`}>
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isDisabling ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
            {isDisabling ? <UserX className="w-6 h-6" /> : <UserCheck className="w-6 h-6" />}
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isDisabling ? 'Disable Member Account' : 'Activate Member Account'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Confirm status change for <span className="font-semibold text-slate-700 dark:text-slate-200">{member.displayName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Email Address:</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{member.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Assigned Role:</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">{member.role}</span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700/60">
              <span className="text-slate-500">New Status:</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[11px] ${isDisabling ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'}`}>
                {isDisabling ? 'DISABLED' : 'ACTIVE'}
              </span>
            </div>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-100/70 dark:bg-slate-800/80 p-3 rounded-lg">
            {isDisabling ? (
              <p>
                ⚠️ <strong>Disabling this account</strong> will immediately terminate any active sign-in sessions and block all access to the company ledger. Historical journal entries, audit trails, and records remain completely preserved.
              </p>
            ) : (
              <p>
                ✨ <strong>Activating this account</strong> will immediately restore login privileges and allow the user to sign in with their existing credentials.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Reason for Status Change <span className="text-slate-400 font-normal">(Optional, recorded in audit trail)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isDisabling ? "e.g. Employee on leave, contract ended" : "e.g. Account reactivated upon request"}
              className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onConfirm(reason)}
            className={`px-5 py-2 text-xs font-bold text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors ${
              isDisabling
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isDisabling ? 'Confirm Disable' : 'Confirm Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// REMOVE MEMBER ACCOUNT CONFIRMATION MODAL
// ==========================================
export function RemoveMemberConfirmationModal({
  isOpen,
  onClose,
  member,
  companyName,
  onConfirm,
  isLoading
}: {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  companyName?: string;
  onConfirm: () => Promise<void>;
  isLoading: boolean;
}) {
  if (!isOpen || !member) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-rose-200 dark:border-rose-900/50 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-6 border-b bg-rose-500/10 border-rose-200 dark:border-rose-900/40 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
            <Trash2 className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-rose-950 dark:text-rose-100">
              Remove Member Account
            </h3>
            <p className="text-xs text-rose-700 dark:text-rose-300/80 mt-0.5">
              Permanent removal from company membership
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-rose-50/70 dark:bg-rose-950/20 p-4 rounded-xl border border-rose-200 dark:border-rose-800/40 text-xs space-y-2">
            <p className="text-slate-700 dark:text-slate-200 leading-relaxed font-medium">
              Are you sure you want to remove <strong className="text-rose-900 dark:text-rose-200">{member.displayName}</strong> ({member.email}) from <strong className="text-slate-900 dark:text-slate-100">{companyName || 'this company'}</strong>?
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-1 pt-1">
              <li>All company roles and permissions will be permanently revoked.</li>
              <li>Active sessions will be immediately terminated.</li>
              <li>Past audit logs and recorded transactions will remain preserved.</li>
            </ul>
          </div>

          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span>This action cannot be undone. To grant access again, you will need to re-invite this member.</span>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Remove Account
          </button>
        </div>
      </div>
    </div>
  );
}
