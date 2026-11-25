import React, { useState, useEffect } from 'react';
import { X, Info, FileText, CheckCircle2, AlertCircle, Building2, HelpCircle } from 'lucide-react';
import {
  ACCOUNT_TYPE_DEFINITIONS,
  BIR_TAX_CATEGORIES,
  getAccountTypeDefinition,
  getDetailTypeDefinition,
  AccountTypeDefinition,
  DetailTypeDefinition
} from '../../shared/accountCategories';
import { inferAccountDetailAndBirCategory } from '../../shared/coaAccountUtils';
import { apiFetch } from '../utils/apiClient';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingAccount?: any;
  accountsList?: any[];
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingAccount,
  accountsList = []
}) => {
  const isEditing = Boolean(existingAccount?.id);

  // Form State
  const [accountType, setAccountType] = useState<string>('ASSET');
  const [detailType, setDetailType] = useState<string>('CHECKING');
  const [accountName, setAccountName] = useState<string>('');
  const [accountCode, setAccountCode] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubAccount, setIsSubAccount] = useState<boolean>(false);
  const [parentAccountId, setParentAccountId] = useState<string>('');
  const [birTaxCategory, setBirTaxCategory] = useState<string>('NOT_APPLICABLE');
  const [normalBalance, setNormalBalance] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [openingBalance, setOpeningBalance] = useState<number | string>(0);
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const [glObInfo, setGlObInfo] = useState<{
    glPostedOpeningBalancePhp: number;
    postedEntryCount: number;
    version: number;
  } | null>(null);
  const [showObAdjust, setShowObAdjust] = useState(false);
  const [adjNewBalance, setAdjNewBalance] = useState<string>('0');
  const [adjDate, setAdjDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [adjReason, setAdjReason] = useState<string>('');
  const [adjLoading, setAdjLoading] = useState(false);
  const [adjSuccess, setAdjSuccess] = useState<string | null>(null);

  const BALANCE_SHEET_TYPES = new Set([
    'ASSET', 'RECEIVABLE', 'OTHER_CURRENT_ASSET', 'INVENTORY', 'FIXED_ASSET',
    'PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'LIABILITY', 'EQUITY'
  ]);
  const isBalanceSheetType = BALANCE_SHEET_TYPES.has(String(accountType || '').toUpperCase());

  // Initialize form state
  useEffect(() => {
    setError(null);
    setShowObAdjust(false);
    setAdjSuccess(null);
    setAdjReason('');
    if (existingAccount) {
      const normalized = inferAccountDetailAndBirCategory(existingAccount);
      const acctTypeVal = existingAccount.accountType || 'ASSET';
      const resolvedDetail = getDetailTypeDefinition(acctTypeVal, normalized.detailType)
        ? normalized.detailType
        : (getAccountTypeDefinition(acctTypeVal)?.detailTypes[0]?.code || 'CHECKING');
      const rawBir = String(existingAccount.birTaxCategory || '').trim();
      const resolvedBir = rawBir && rawBir !== '-' && rawBir !== 'NONE'
        ? rawBir
        : (normalized.birTaxCategory && normalized.birTaxCategory !== 'NONE' ? normalized.birTaxCategory : 'NOT_APPLICABLE');
      setAccountType(acctTypeVal);
      setDetailType(resolvedDetail);
      setAccountName(existingAccount.accountName || '');
      setAccountCode(existingAccount.accountCode || '');
      setDescription(existingAccount.description || '');
      setIsSubAccount(Boolean(existingAccount.isSubAccount || existingAccount.parentAccountId));
      setParentAccountId(existingAccount.parentAccountId || '');
      setBirTaxCategory(resolvedBir);
      setNormalBalance(existingAccount.normalBalance || 'DEBIT');
      setOpeningBalance(existingAccount.openingBalance || 0);
      setAsOfDate(existingAccount.asOfDate || new Date().toISOString().slice(0, 10));
      setAdjNewBalance(String(existingAccount.openingBalance || 0));

      if (isOpen && existingAccount.id) {
        apiFetch<any>(`/api/master-data/accounts/${existingAccount.id}/opening-balance`)
          .then((data) => {
            if (data) {
              setGlObInfo({
                glPostedOpeningBalancePhp: Number(data.glPostedOpeningBalancePhp || 0),
                postedEntryCount: Number(data.postedEntryCount || 0),
                version: Number(data.version || existingAccount.version || 1),
              });
              setAdjNewBalance(String(data.glPostedOpeningBalancePhp ?? existingAccount.openingBalance ?? 0));
            }
          })
          .catch(() => setGlObInfo(null));
      }
    } else {
      setGlObInfo(null);
      // Default to Cash & Checking
      const initialTypeDef = ACCOUNT_TYPE_DEFINITIONS[0];
      setAccountType(initialTypeDef.code);
      const initialDetail = initialTypeDef.detailTypes[0];
      setDetailType(initialDetail.code);
      setNormalBalance(initialTypeDef.normalBalance);
      setBirTaxCategory(initialDetail.suggestedBirTaxCategory || 'NOT_APPLICABLE');
      setAccountCode(initialDetail.defaultCodePrefix || '1010');
      setAccountName('');
      setDescription('');
      setIsSubAccount(false);
      setParentAccountId('');
      setOpeningBalance(0);
      setAsOfDate(new Date().toISOString().slice(0, 10));
    }
  }, [existingAccount, isOpen]);

  if (!isOpen) return null;

  // Active Type & Detail Definitions
  const currentTypeDef = getAccountTypeDefinition(accountType) || ACCOUNT_TYPE_DEFINITIONS[0];
  const availableDetailTypes = currentTypeDef.detailTypes;
  const currentDetailDef = getDetailTypeDefinition(accountType, detailType) || availableDetailTypes[0];

  // Handle Account Type Change
  const handleAccountTypeChange = (newType: string) => {
    setAccountType(newType);
    if (!BALANCE_SHEET_TYPES.has(String(newType || '').toUpperCase())) {
      setOpeningBalance(0);
    }
    const typeDef = getAccountTypeDefinition(newType);
    if (typeDef) {
      setNormalBalance(typeDef.normalBalance);
      const firstDetail = typeDef.detailTypes[0];
      if (firstDetail) {
        setDetailType(firstDetail.code);
        setBirTaxCategory(firstDetail.suggestedBirTaxCategory || 'NOT_APPLICABLE');
        if (!isEditing && firstDetail.defaultCodePrefix) {
          setAccountCode(firstDetail.defaultCodePrefix);
        }
      }
    }
  };

  // Handle Detail Type Change
  const handleDetailTypeChange = (newDetail: string) => {
    setDetailType(newDetail);
    const detailDef = getDetailTypeDefinition(accountType, newDetail);
    if (detailDef) {
      setBirTaxCategory(detailDef.suggestedBirTaxCategory || 'NOT_APPLICABLE');
      if (!isEditing && detailDef.defaultCodePrefix) {
        setAccountCode(detailDef.defaultCodePrefix);
      }
    }
  };

  // Handle Submit
  const handleSubmit = async (e: React.FormEvent, closeModal = true) => {
    e.preventDefault();
    setError(null);

    if (!accountName.trim()) {
      setError('Please enter a valid Account Name.');
      return;
    }
    if (!accountCode.trim()) {
      setError('Please enter a valid Account Code.');
      return;
    }

    const numericOb = isBalanceSheetType ? (Number(openingBalance) || 0) : 0;
    if (!isBalanceSheetType && Number(openingBalance) !== 0) {
      setError('Opening balances are restricted to Balance Sheet accounts (Asset, Liability, Equity).');
      return;
    }

    setLoading(true);

    try {
      const payload: Record<string, any> = {
        accountCode: accountCode.trim(),
        accountName: accountName.trim(),
        accountType,
        detailType,
        normalBalance,
        parentAccountId: isSubAccount && parentAccountId ? parentAccountId : null,
        description: description.trim() || null,
        isSubAccount,
        birTaxCategory,
        isCashAccount: ['CHECKING', 'SAVINGS', 'CASH_ON_HAND', 'PETTY_CASH', 'PAYROLL_BANK', 'DOLLAR_ACCOUNT'].includes(detailType),
        isTaxAccount: !['NOT_APPLICABLE', 'NONE', ''].includes(String(birTaxCategory || '').trim())
      };

      if (!isEditing) {
        payload.openingBalance = numericOb;
        payload.asOfDate = asOfDate;
      } else if (existingAccount?.version) {
        payload.expectedVersion = existingAccount.version;
      }

      const url = isEditing ? `/api/master-data/accounts/${existingAccount.id}` : '/api/master-data/accounts';
      const method = isEditing ? 'PUT' : 'POST';

      const data = await apiFetch<any>(url, {
        method,
        body: payload as any
      });

      window.dispatchEvent(new CustomEvent('coa:updated', { detail: data }));
      onSuccess();
      if (closeModal) {
        onClose();
      } else {
        // Reset form for "Save and New"
        setAccountName('');
        setAccountCode(currentDetailDef?.defaultCodePrefix || '1000');
        setDescription('');
        setOpeningBalance(0);
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpeningBalanceAdjustment = async () => {
    if (!existingAccount?.id) return;
    setError(null);
    setAdjSuccess(null);
    if (!adjReason.trim()) {
      setError('Please enter an audit reason for the Opening Balance Adjustment.');
      return;
    }
    setAdjLoading(true);
    try {
      const data = await apiFetch<any>(`/api/master-data/accounts/${existingAccount.id}/opening-balance-adjustment`, {
        method: 'POST',
        body: {
          newOpeningBalance: Number(adjNewBalance),
          adjustmentDate: adjDate,
          reason: adjReason.trim(),
          expectedVersion: glObInfo?.version ?? existingAccount.version,
        } as any,
      });
      setAdjSuccess(`Posted adjustment journal ${data.journalNumber} (Δ ₱${Number(data.deltaPhp).toLocaleString('en-PH', { minimumFractionDigits: 2 })}).`);
      setOpeningBalance(data.newOpeningBalancePhp);
      setGlObInfo({
        glPostedOpeningBalancePhp: Number(data.newOpeningBalancePhp),
        postedEntryCount: (glObInfo?.postedEntryCount || 0) + 1,
        version: Number(data.version || (glObInfo?.version || 1) + 1),
      });
      setShowObAdjust(false);
      setAdjReason('');
      window.dispatchEvent(new CustomEvent('coa:updated', { detail: data }));
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to post opening balance adjustment.');
    } finally {
      setAdjLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-4xl w-full overflow-hidden flex flex-col my-8">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {isEditing ? 'Edit General Ledger Account' : 'Account Setup & BIR Mapping'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure account chart classifications per BIR Philippine accounting rules.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={(e) => handleSubmit(e, true)} className="p-6 space-y-6 flex-1">
          {error && (
            <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* Left Side: Selectors & Guidance Box */}
            <div className="md:col-span-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Account Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={accountType}
                  onChange={(e) => handleAccountTypeChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 font-medium focus:ring-2 focus:ring-indigo-500"
                >
                  {ACCOUNT_TYPE_DEFINITIONS.map((typeGroup) => (
                    <option key={typeGroup.code} value={typeGroup.code}>
                      {typeGroup.label} ({typeGroup.normalBalance})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Detail Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={detailType}
                  onChange={(e) => handleDetailTypeChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 font-medium focus:ring-2 focus:ring-indigo-500"
                >
                  {availableDetailTypes.map((dt) => (
                    <option key={dt.code} value={dt.code}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* QuickBooks-Style Guidance Box */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                  <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>{currentDetailDef?.label || 'Account Guidance'}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {currentDetailDef?.description}
                </p>
                {currentDetailDef?.birNote && (
                  <div className="p-2.5 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-[11px] text-amber-800 dark:text-amber-300">
                    <span className="font-bold">BIR & PH Compliance: </span>
                    {currentDetailDef.birNote}
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Account Details, Parent, BIR Tax & Balance */}
            <div className="md:col-span-7 space-y-4">
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Account Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BDO Peso Checking 1234"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Account Code / No. <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 1010"
                    value={accountCode}
                    onChange={(e) => setAccountCode(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional memo describing the purpose of this account..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Sub-account Configuration */}
              <div className="p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/40 dark:bg-slate-800/40 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSubAccount}
                    onChange={(e) => setIsSubAccount(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Is sub-account
                  </span>
                </label>

                {isSubAccount && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Parent Account
                    </label>
                    <select
                      value={parentAccountId}
                      onChange={(e) => setParentAccountId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                    >
                      <option value="">-- Select Parent Account --</option>
                      {accountsList
                        .filter(a => a.id !== existingAccount?.id)
                        .map(a => (
                          <option key={a.id} value={a.id}>
                            {a.accountCode} - {a.accountName} ({a.accountType})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {/* BIR Tax Category Mapping */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>BIR Tax Profile & Return Classification</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">PH BIR Aligned</span>
                </label>
                <select
                  value={birTaxCategory}
                  onChange={(e) => setBirTaxCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                >
                  {BIR_TAX_CATEGORIES.map(cat => (
                    <option key={cat.code} value={cat.code}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Opening Balance Setup */}
              {!isEditing ? (
                <div className="space-y-2 p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-indigo-50/20 dark:bg-indigo-950/20">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Opening Balance (PHP)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        disabled={!isBalanceSheetType}
                        value={isBalanceSheetType ? openingBalance : 0}
                        onChange={(e) => setOpeningBalance(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        As of Date
                      </label>
                      <input
                        type="date"
                        disabled={!isBalanceSheetType}
                        value={asOfDate}
                        onChange={(e) => setAsOfDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isBalanceSheetType
                      ? 'Non-zero opening balances atomically post a balanced OPENING_BALANCE journal entry (offset to Opening Balance Equity) into the General Ledger.'
                      : 'Opening balances are disabled for Income, Cost of Sales, and Expense accounts.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/60 dark:bg-slate-800/40">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        GL-Posted Opening Balance (Immutable Master)
                      </p>
                      <p className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100">
                        ₱{Number(glObInfo?.glPostedOpeningBalancePhp ?? existingAccount?.openingBalance ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {glObInfo ? ` (${glObInfo.postedEntryCount} GL opening entry${glObInfo.postedEntryCount === 1 ? '' : 's'})` : ''}
                      </p>
                    </div>
                    {isBalanceSheetType && (
                      <button
                        type="button"
                        onClick={() => setShowObAdjust((v) => !v)}
                        className="px-3 py-1.5 text-[11px] font-semibold border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors"
                      >
                        {showObAdjust ? 'Hide Adjustment' : 'Record Adjustment'}
                      </button>
                    )}
                  </div>
                  {adjSuccess && (
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[11px] text-emerald-700 dark:text-emerald-300">
                      {adjSuccess}
                    </div>
                  )}
                  {showObAdjust && isBalanceSheetType && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            New Target Opening Balance (PHP)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={adjNewBalance}
                            onChange={(e) => setAdjNewBalance(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Adjustment Date
                          </label>
                          <input
                            type="date"
                            value={adjDate}
                            onChange={(e) => setAdjDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Audit Reason <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Prior year audit tie-out adjustment"
                          value={adjReason}
                          onChange={(e) => setAdjReason(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={adjLoading}
                        onClick={handleOpeningBalanceAdjustment}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                      >
                        {adjLoading ? 'Posting Adjustment...' : 'Post Delta Opening Adjustment'}
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>Normal Balance: <strong className="text-slate-700 dark:text-slate-200">{normalBalance}</strong></span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Cancel
              </button>

              {!isEditing && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={(e) => handleSubmit(e, false)}
                  className="px-4 py-2.5 text-xs font-semibold border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl transition-colors disabled:opacity-50"
                >
                  Save and New
                </button>
              )}

              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save and Close'}
              </button>
            </div>
          </div>
        </form>

      </div>
    </div>
  );
};
