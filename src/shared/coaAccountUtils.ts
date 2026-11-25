export interface CoaAccountLike {
  id: string;
  companyId?: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  detailType?: string | null;
  birTaxCategory?: string | null;
  parentAccountId?: string | null;
  isSubAccount?: boolean | number | null;
  normalBalance?: string | null;
  isCashAccount?: boolean | number | null;
  isControlAccount?: boolean | number | null;
  isTaxAccount?: boolean | number | null;
  isRetainedEarnings?: boolean | number | null;
  isHeader?: boolean | number | null;
  isActive?: boolean | number | null;
  status?: string | null;
  openingBalance?: number | null;
  currency?: string | null;
}

export interface BankRegistryAccountLike {
  id: string;
  companyId?: string;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  accountNumberEncrypted?: string | null;
  accountType?: string | null;
  currency?: string | null;
  glAccountId?: string | null;
  isActive?: boolean | number | null;
}

export const CASH_BANK_DETAIL_TYPES = new Set([
  'CHECKING',
  'SAVINGS',
  'CASH_ON_HAND',
  'PETTY_CASH',
  'PAYROLL_BANK',
  'DOLLAR_ACCOUNT',
  'CASH',
  'BANK',
]);

export const STRICT_BANK_DETAIL_TYPES = new Set([
  'CHECKING',
  'SAVINGS',
  'PAYROLL_BANK',
  'DOLLAR_ACCOUNT',
  'BANK',
]);

export const STRICT_PHYSICAL_CASH_DETAIL_TYPES = new Set([
  'CASH_ON_HAND',
  'PETTY_CASH',
  'CASH',
]);

const BANK_OR_CASH_NAME_PATTERN =
  /\b(cash in bank|cash on hand|cash and cash equivalents|petty cash|revolving fund|undeposited|checking|savings|current account|payroll bank|dollar account|bank account|depository|settlement|clearing|bdo|bpi|metrobank|landbank|unionbank|rcbc|pnb|security bank|chinabank|eastwest|maybank|psbank|aub|pbcom|robinsons bank|citibank|hsbc|standard chartered)\b/i;

const STRICT_BANK_NAME_PATTERN =
  /\b(cash in bank|checking|savings|current account|payroll bank|dollar account|bank account|depository|settlement|clearing|bdo|bpi|metrobank|landbank|unionbank|rcbc|pnb|security bank|chinabank|eastwest|maybank|psbank|aub|pbcom|robinsons bank|citibank|hsbc|standard chartered)\b/i;

const PHYSICAL_CASH_OR_PETTY_PATTERN =
  /\b(petty cash|cash on hand|revolving fund|undeposited|change fund|cashier fund)\b/i;

export function inferAccountDetailAndBirCategory(account: {
  accountCode?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  detailType?: string | null;
  birTaxCategory?: string | null;
  isCashAccount?: boolean | number | null;
  isTaxAccount?: boolean | number | null;
}): { detailType: string; birTaxCategory: string } {
  const existingDetail = String(account.detailType || '').trim();
  const rawExistingBir = String(account.birTaxCategory || '').trim();
  const existingBir = rawExistingBir && rawExistingBir !== '-' && rawExistingBir.toUpperCase() !== 'NONE' ? rawExistingBir : '';
  if (existingDetail && existingDetail !== '-' && existingBir) {
    return { detailType: existingDetail, birTaxCategory: existingBir };
  }

  const code = String(account.accountCode || '').trim();
  const name = String(account.accountName || '').trim().toLowerCase();
  const acctType = String(account.accountType || '').trim().toUpperCase();

  let detailType = existingDetail && existingDetail !== '-' ? existingDetail : '';
  let birTaxCategory = existingBir;

  if (!detailType) {
    if (/\b(petty cash|revolving fund)\b/i.test(name)) {
      detailType = 'PETTY_CASH';
    } else if (/\b(cash on hand|undeposited|change fund|cashier fund)\b/i.test(name)) {
      detailType = 'CASH_ON_HAND';
    } else if (/\b(savings)\b/i.test(name)) {
      detailType = 'SAVINGS';
    } else if (/\b(payroll bank|payroll account)\b/i.test(name)) {
      detailType = 'PAYROLL_BANK';
    } else if (/\b(dollar|usd|foreign currency)\b/i.test(name)) {
      detailType = 'DOLLAR_ACCOUNT';
    } else if (STRICT_BANK_NAME_PATTERN.test(name) || acctType === 'BANK') {
      detailType = 'CHECKING';
    } else if (code === '1020') {
      detailType = 'PETTY_CASH';
    } else if (
      code === '1010' ||
      acctType === 'CASH' ||
      account.isCashAccount === 1 ||
      account.isCashAccount === true
    ) {
      detailType = 'CHECKING';
    } else if (code === '1040' || /\b(allowance for doubtful|allowance for bad debt)\b/i.test(name)) {
      detailType = 'ALLOWANCE_DOUBTFUL';
    } else if (acctType === 'RECEIVABLE' && (code === '1085' || /\b(employee|officer)\b/i.test(name))) {
      detailType = 'ADVANCES_EMPLOYEES';
    } else if (acctType === 'RECEIVABLE' || code === '1030' || /\b(accounts receivable|trade receivable)\b/i.test(name)) {
      detailType = 'TRADE_RECEIVABLE';
    } else if (code === '1050' || /\b(deferred input vat)\b/i.test(name) || /\b(input vat)\b/i.test(name)) {
      detailType = /\b(deferred)\b/i.test(name) ? 'DEFERRED_INPUT_VAT' : 'INPUT_VAT';
    } else if (code === '1060' || /\b(creditable withholding|2307)\b/i.test(name)) {
      detailType = 'CWT_2307_ASSET';
    } else if (code === '1070' || /\b(prepaid)\b/i.test(name)) {
      detailType = 'PREPAID_EXPENSES';
    } else if (acctType === 'INVENTORY' || code === '1080' || /\b(inventory|merchandise)\b/i.test(name)) {
      detailType = 'MERCHANDISE_INVENTORY';
    } else if (code === '1520' || /\b(accumulated depreciation)\b/i.test(name)) {
      detailType = 'ACCUMULATED_DEPRECIATION';
    } else if (acctType === 'FIXED_ASSET' || code === '1510' || /\b(equipment|machinery|furniture|building|vehicle)\b/i.test(name)) {
      detailType = 'OFFICE_EQUIPMENT';
    } else if (acctType === 'PAYABLE' && (code === '2030' || /\b(expanded withholding|ewt payable)\b/i.test(name))) {
      detailType = 'EWT_PAYABLE';
    } else if (acctType === 'PAYABLE' && (code === '2035' || /\b(compensation)\b/i.test(name))) {
      detailType = 'WITHHOLDING_TAX_COMPENSATION';
    } else if (acctType === 'PAYABLE' && (code === '2040' || /\b(sss|philhealth|pag-ibig|hdmf|statutory)\b/i.test(name))) {
      detailType = 'STATUTORY_PAYABLES_SSS';
    } else if (acctType === 'PAYABLE' && (code === '2120' || /\b(percentage tax|2551)\b/i.test(name))) {
      detailType = 'PERCENTAGE_TAX_LIABILITY';
    } else if (acctType === 'PAYABLE' && (code === '2140' || /\b(income tax|git)\b/i.test(name))) {
      detailType = 'INCOME_TAX_PAYABLE_LIAB';
    } else if (acctType === 'PAYABLE' && (code === '2036' || /\b(accrued|salaries|refund)\b/i.test(name))) {
      detailType = 'ACCRUED_SALARIES';
    } else if (acctType === 'PAYABLE' || code === '2010' || /\b(accounts payable|trade payable)\b/i.test(name)) {
      detailType = 'TRADE_PAYABLE';
    } else if (code === '2020' || /\b(output vat|vat payable)\b/i.test(name)) {
      detailType = 'OUTPUT_VAT_LIABILITY';
    } else if (code === '2030' || /\b(withholding tax payable|ewt payable|expanded withholding)\b/i.test(name)) {
      detailType = 'EWT_PAYABLE';
    } else if (code === '2035' || /\b(withholding tax.*compensation)\b/i.test(name)) {
      detailType = 'WITHHOLDING_TAX_COMPENSATION';
    } else if (code === '2040' || code === '2050' || code === '2060' || /\b(sss|philhealth|pag-ibig|hdmf|statutory)\b/i.test(name)) {
      detailType = 'STATUTORY_PAYABLES_SSS';
    } else if (code === '2120' || /\b(percentage tax|2551)\b/i.test(name)) {
      detailType = 'PERCENTAGE_TAX_LIABILITY';
    } else if (code === '2070' || code === '2080' || code === '2036' || /\b(accrued|salaries payable|wages payable|refund payable)\b/i.test(name)) {
      detailType = 'ACCRUED_SALARIES';
    } else if (code === '2100' || code === '2140' || /\b(income tax|git)\b/i.test(name)) {
      detailType = 'INCOME_TAX_PAYABLE_LIAB';
    } else if (acctType === 'LONG_TERM_LIABILITY' || /\b(loan|notes payable|mortgage)\b/i.test(name)) {
      detailType = 'BANK_LOAN_LONG';
    } else if (code === '3020' || /\b(retained earnings)\b/i.test(name)) {
      detailType = 'RETAINED_EARNINGS';
    } else if (/\b(opening balance equity)\b/i.test(name)) {
      detailType = 'OPENING_BALANCE_EQUITY';
    } else if (acctType === 'EQUITY' || code === '3010' || code === '3030') {
      detailType = 'PAID_IN_CAPITAL';
    } else if (code === '4010' || /\b(service revenue|professional fee|consulting)\b/i.test(name)) {
      detailType = 'SERVICE_INCOME';
    } else if (code === '4020' || code === '4030' || /\b(discount|return|allowance)\b/i.test(name)) {
      detailType = 'EXEMPT_SALES';
    } else if (acctType === 'REVENUE' || /\b(sales revenue|merchandise sales|product sales)\b/i.test(name)) {
      detailType = 'SALES_GOODS';
    } else if (acctType === 'OTHER_INCOME' || /\b(interest income|other income|gain)\b/i.test(name)) {
      detailType = 'INTEREST_INCOME';
    } else if (acctType === 'COST_OF_SALES' || code === '5010' || /\b(cost of goods sold|cogs|cost of sales)\b/i.test(name)) {
      detailType = 'COGS_FINISHED_GOODS';
    } else if (code === '6010' || /\b(salaries|wages|13th month|benefits|payroll)\b/i.test(name)) {
      detailType = 'SALARIES_EXPENSE';
    } else if (code === '6020' || /\b(rent|lease)\b/i.test(name)) {
      detailType = 'RENT_EXPENSE';
    } else if (code === '6030' || /\b(utilities|electricity|water|internet)\b/i.test(name)) {
      detailType = 'UTILITIES_EXPENSE';
    } else if (code === '6040' || /\b(supplies|office expense)\b/i.test(name)) {
      detailType = 'SUPPLIES_EXPENSE';
    } else if (code === '6050' || /\b(professional fee|consultancy|audit|legal)\b/i.test(name)) {
      detailType = 'PROFESSIONAL_FEES';
    } else if (code === '6060' || /\b(depreciation)\b/i.test(name)) {
      detailType = 'DEPRECIATION_EXPENSE';
    } else if (code === '6070' || code === '6075' || /\b(taxes and licenses|permits|bir fee|tax adjustment)\b/i.test(name)) {
      detailType = 'TAXES_LICENSES';
    } else if (acctType === 'OTHER_EXPENSE' && /\b(penalt|surcharge)\b/i.test(name)) {
      detailType = 'BIR_PENALTIES';
    } else if (acctType === 'OTHER_EXPENSE' || /\b(bank.*charge|interest expense)\b/i.test(name)) {
      detailType = 'INTEREST_BANK_FEES';
    } else if (acctType === 'EXPENSE') {
      detailType = 'SUPPLIES_EXPENSE';
    } else if (acctType === 'LIABILITY' || acctType === 'OTHER_CURRENT_LIABILITY') {
      detailType = 'ACCRUED_SALARIES';
    } else {
      detailType = 'PREPAID_EXPENSES';
    }
  }

  if (!birTaxCategory) {
    if (detailType === 'OUTPUT_VAT_LIABILITY' || detailType === 'VAT_PAYABLE' || code === '2020' || /\b(output vat)\b/i.test(name)) {
      birTaxCategory = 'OUTPUT_VAT_12';
    } else if (detailType === 'INPUT_VAT' || code === '1050' || /\b(input vat)\b/i.test(name)) {
      birTaxCategory = /\b(deferred)\b/i.test(name) ? 'DEFERRED_INPUT_VAT' : 'INPUT_VAT_12';
    } else if (detailType === 'CWT_2307_ASSET' || code === '1060' || /\b(creditable withholding|2307)\b/i.test(name)) {
      birTaxCategory = 'CWT_2307';
    } else if (detailType === 'EWT_PAYABLE' || code === '2030' || /\b(expanded withholding|ewt payable)\b/i.test(name)) {
      birTaxCategory = 'EWT_1601EQ';
    } else if (detailType === 'WITHHOLDING_TAX_COMPENSATION' || code === '2035' || /\b(compensation)\b/i.test(name)) {
      birTaxCategory = 'WT_COMPENSATION_1601C';
    } else if (detailType === 'PERCENTAGE_TAX_LIABILITY' || code === '2120' || /\b(percentage tax|2551)\b/i.test(name)) {
      birTaxCategory = 'PERCENTAGE_TAX_3';
    } else if (detailType === 'INCOME_TAX_PAYABLE_LIAB' || code === '2140' || /\b(income tax|git)\b/i.test(name)) {
      birTaxCategory = 'INCOME_TAX_1702';
    } else if (acctType === 'REVENUE' && detailType !== 'EXEMPT_SALES' && detailType !== 'SALES_DISCOUNTS') {
      birTaxCategory = detailType === 'ZERO_RATED_SALES' ? 'ZERO_RATED' : 'OUTPUT_VAT_12';
    } else if (detailType === 'RENT_EXPENSE' || detailType === 'PROFESSIONAL_FEES') {
      birTaxCategory = 'EWT_1601EQ';
    } else if (detailType === 'TAXES_LICENSES') {
      birTaxCategory = 'LOCAL_TAX_LBT';
    } else {
      birTaxCategory = 'NOT_APPLICABLE';
    }
  }

  return { detailType, birTaxCategory };
}

export function computeParentAccountIds(accounts: ReadonlyArray<CoaAccountLike>): Set<string> {
  const parentIds = new Set<string>();
  for (const acc of accounts || []) {
    if (acc?.parentAccountId) {
      parentIds.add(String(acc.parentAccountId));
    }
  }
  return parentIds;
}

export function isAccountActive(account: CoaAccountLike | null | undefined): boolean {
  if (!account) return false;
  if (account.isActive === 0 || account.isActive === false) return false;
  const status = String(account.status || 'ACTIVE').trim().toUpperCase();
  return status === 'ACTIVE';
}

export function isAccountHeader(
  account: CoaAccountLike | null | undefined,
  parentIds?: ReadonlySet<string>
): boolean {
  if (!account) return false;
  if (account.isHeader === 1 || account.isHeader === true) return true;
  if (parentIds && account.id && parentIds.has(String(account.id))) return true;
  return false;
}

export function isPostableLeafAccount(
  account: CoaAccountLike | null | undefined,
  parentIds?: ReadonlySet<string>
): boolean {
  if (!account || !account.id) return false;
  if (!isAccountActive(account)) return false;
  if (isAccountHeader(account, parentIds)) return false;
  return true;
}

export function shouldAutoFlagAsCashAccount(input: {
  accountType?: string | null;
  detailType?: string | null;
  accountName?: string | null;
  accountCode?: string | null;
  isCashAccount?: boolean | number | null;
  isTaxAccount?: boolean | number | null;
}): boolean {
  if (input.isTaxAccount === true || input.isTaxAccount === 1) {
    return false;
  }
  const acctType = String(input.accountType || '').trim().toUpperCase();
  if (
    ['REVENUE', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE', 'COST_OF_SALES', 'EQUITY', 'RECEIVABLE', 'PAYABLE', 'INVENTORY', 'FIXED_ASSET', 'LONG_TERM_LIABILITY'].includes(acctType)
  ) {
    return false;
  }
  const detail = String(input.detailType || '').trim().toUpperCase();
  if (CASH_BANK_DETAIL_TYPES.has(detail)) {
    return true;
  }
  if (
    detail &&
    [
      'ACCOUNTS_RECEIVABLE',
      'TRADE_RECEIVABLE',
      'NOTES_RECEIVABLE',
      'ALLOWANCE_BAD_DEBTS',
      'ALLOWANCE_DOUBTFUL',
      'EMPLOYEE_ADVANCES',
      'ADVANCES_EMPLOYEES',
      'INVENTORY_ASSET',
      'MERCHANDISE_INVENTORY',
      'PREPAID_EXPENSES',
      'PREPAID_TAX',
      'INPUT_VAT',
      'DEFERRED_INPUT_VAT',
      'CWT_2307_ASSET',
      'MACHINERY_EQUIPMENT',
      'OFFICE_EQUIPMENT',
      'ACCUMULATED_DEPRECIATION',
      'ACCOUNTS_PAYABLE',
      'TRADE_PAYABLE',
      'VAT_PAYABLE',
      'OUTPUT_VAT_LIABILITY',
      'PERCENTAGE_TAX_LIABILITY',
      'EWT_PAYABLE',
      'WITHHOLDING_TAX_COMPENSATION',
      'STATUTORY_PAYABLES',
      'STATUTORY_PAYABLES_SSS',
      'ACCRUED_LIABILITIES',
      'ACCRUED_SALARIES',
      'INCOME_TAX_PAYABLE_LIAB',
      'TAX_PAYABLE',
    ].includes(detail)
  ) {
    return false;
  }
  if (input.isCashAccount === true || input.isCashAccount === 1) {
    return true;
  }
  if (acctType === 'CASH' || acctType === 'BANK') {
    return true;
  }
  const code = String(input.accountCode || '').trim();
  const name = String(input.accountName || '').trim();
  if (
    ['ASSET', 'OTHER_CURRENT_ASSET'].includes(acctType) &&
    (['1010', '1020', '1100'].includes(code) || BANK_OR_CASH_NAME_PATTERN.test(name))
  ) {
    return true;
  }
  if (
    BANK_OR_CASH_NAME_PATTERN.test(name) &&
    /\b(checking|savings|cash in bank|petty cash|bank account|bdo|bpi|metrobank|unionbank|landbank|rcbc|pnb|security bank|chinabank|eastwest)\b/i.test(name)
  ) {
    return true;
  }
  return false;
}

export function isStrictBankAccount(input: {
  accountType?: string | null;
  detailType?: string | null;
  accountName?: string | null;
  accountCode?: string | null;
  isCashAccount?: boolean | number | null;
  isTaxAccount?: boolean | number | null;
}): boolean {
  if (!shouldAutoFlagAsCashAccount(input)) return false;

  const detail = String(input.detailType || '').trim().toUpperCase();
  const code = String(input.accountCode || '').trim();
  const name = String(input.accountName || '').trim();

  // 1. Explicit detailType takes highest precedence
  if (STRICT_PHYSICAL_CASH_DETAIL_TYPES.has(detail)) {
    return false;
  }
  if (STRICT_BANK_DETAIL_TYPES.has(detail)) {
    return true;
  }

  // 2. Explicit account name semantics override generic numeric COA code defaults
  if (PHYSICAL_CASH_OR_PETTY_PATTERN.test(name)) {
    return false;
  }
  const acctType = String(input.accountType || '').trim().toUpperCase();
  if (acctType === 'BANK' || STRICT_BANK_NAME_PATTERN.test(name)) {
    return true;
  }

  // 3. Fallback to standard Philippine COA numbering only when detailType and name are ambiguous
  if (code === '1020') {
    return false;
  }
  if (code === '1010') {
    return true;
  }
  return false;
}

export function isEligibleCashBankAccount(
  account: CoaAccountLike | null | undefined,
  parentIds?: ReadonlySet<string>
): boolean {
  if (!isPostableLeafAccount(account, parentIds)) return false;
  return shouldAutoFlagAsCashAccount(account!);
}

export function isEligibleSourceCashAccount(
  account: CoaAccountLike | null | undefined,
  parentIds?: ReadonlySet<string>
): boolean {
  return isEligibleCashBankAccount(account, parentIds);
}

export function isEligibleDestinationBankAccount(
  account: CoaAccountLike | null | undefined,
  parentIds?: ReadonlySet<string>
): boolean {
  if (!isPostableLeafAccount(account, parentIds)) return false;
  return isStrictBankAccount(account!);
}

export function filterPostableLeafAccounts<T extends CoaAccountLike>(accounts: ReadonlyArray<T>): T[] {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  return safe
    .filter((a) => isPostableLeafAccount(a, parentIds))
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function filterEligibleCashBankAccounts<T extends CoaAccountLike>(accounts: ReadonlyArray<T>): T[] {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  return safe
    .filter((a) => isEligibleCashBankAccount(a, parentIds))
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function filterEligibleSourceCashAccounts<T extends CoaAccountLike>(accounts: ReadonlyArray<T>): T[] {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  return safe
    .filter((a) => isEligibleSourceCashAccount(a, parentIds))
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function filterEligibleDestinationBankAccounts<T extends CoaAccountLike>(
  accounts: ReadonlyArray<T>,
  bankRegistryAccounts?: ReadonlyArray<BankRegistryAccountLike>
): Array<T & { bankRegistryId?: string; bankName?: string | null; accountNumber?: string | null; displayLabel: string }> {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  const registryByGlId = new Map<string, BankRegistryAccountLike>();
  for (const reg of bankRegistryAccounts || []) {
    if (reg && reg.glAccountId && reg.isActive !== 0 && reg.isActive !== false) {
      registryByGlId.set(String(reg.glAccountId), reg);
    }
  }

  return safe
    .filter((a) => isEligibleDestinationBankAccount(a, parentIds))
    .map((a) => {
      const reg = registryByGlId.get(String(a.id));
      const baseLabel = formatAccountOptionLabel(a);
      const acctNum = reg?.accountNumber || reg?.accountNumberEncrypted;
      const bankMeta =
        reg?.bankName && acctNum
          ? ` (${reg.bankName} • ${acctNum})`
          : reg?.bankName
          ? ` (${reg.bankName})`
          : '';
      return {
        ...a,
        bankRegistryId: reg?.id,
        bankName: reg?.bankName || null,
        accountNumber: acctNum || null,
        displayLabel: `${baseLabel}${bankMeta}`,
      };
    })
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function isEligibleTaxControlAccount(
  account: CoaAccountLike | null | undefined,
  taxType?: string | null,
  direction?: string | null,
  parentIds?: ReadonlySet<string>
): boolean {
  if (!isPostableLeafAccount(account, parentIds)) return false;
  if (!account) return false;

  // Never allow cash, bank, petty cash, trade AR/AP, revenue, expense, COGS, inventory, fixed assets, or equity as a tax control account
  if (shouldAutoFlagAsCashAccount(account)) return false;

  const acctType = String(account.accountType || '').trim().toUpperCase();
  if (
    ['REVENUE', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE', 'COST_OF_SALES', 'EQUITY', 'INVENTORY', 'FIXED_ASSET', 'CASH', 'BANK'].includes(
      acctType
    )
  ) {
    return false;
  }

  const inferred = inferAccountDetailAndBirCategory(account);
  const detail = String(account.detailType || inferred.detailType || '').trim().toUpperCase();
  const code = String(account.accountCode || '').trim();
  const name = String(account.accountName || '').trim().toLowerCase();
  const isTaxFlagged = account.isTaxAccount === 1 || account.isTaxAccount === true;

  // Exclude trade AR (1030), Allowance for Doubtful Accounts (1040), Prepaid Expenses (1070), Trade AP (2010), Statutory Payables (2040-2060), Salaries Payable (2070)
  if (
    [
      'ACCOUNTS_RECEIVABLE',
      'TRADE_RECEIVABLE',
      'ALLOWANCE_BAD_DEBTS',
      'ALLOWANCE_DOUBTFUL',
      'PREPAID_EXPENSES',
      'ACCOUNTS_PAYABLE',
      'TRADE_PAYABLE',
      'STATUTORY_PAYABLES',
      'STATUTORY_PAYABLES_SSS',
      'ACCRUED_LIABILITIES',
      'ACCRUED_SALARIES',
    ].includes(detail) &&
    !isTaxFlagged &&
    !/\b(vat|tax|withholding|ewt|cwt|2307|2550|1601|2551)\b/i.test(name)
  ) {
    return false;
  }
  if (['1030', '1040', '1070', '1080', '1510', '1520', '2010', '2040', '2050', '2060', '2070', '2080', '2100'].includes(code) && !isTaxFlagged) {
    return false;
  }

  const normType = String(taxType || 'VAT').trim().toUpperCase();
  const normDir = String(direction || 'OUTPUT').trim().toUpperCase();

  const isLiabilitySide = ['LIABILITY', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'PAYABLE'].includes(acctType);
  const isAssetSide = ['ASSET', 'OTHER_CURRENT_ASSET', 'RECEIVABLE'].includes(acctType);

  if (normType === 'VAT') {
    if (normDir === 'INPUT') {
      if (!isAssetSide) return false;
      return (
        code === '1050' ||
        detail === 'INPUT_VAT' ||
        detail === 'DEFERRED_INPUT_VAT' ||
        detail === 'PREPAID_TAX' ||
        /\b(input vat|deferred input vat|vat input|prepaid vat|input tax)\b/i.test(name) ||
        (isTaxFlagged && !/\b(withholding|2307|ewt|cwt)\b/i.test(name))
      );
    }
    // OUTPUT VAT
    if (!isLiabilitySide) return false;
    return (
      code === '2020' ||
      detail === 'OUTPUT_VAT_LIABILITY' ||
      detail === 'VAT_PAYABLE' ||
      detail === 'TAX_PAYABLE' ||
      /\b(output vat|vat payable|deferred output vat|value added tax|output tax)\b/i.test(name) ||
      (isTaxFlagged && !/\b(withholding|ewt|1601)\b/i.test(name))
    );
  }

  if (normType === 'EWT' || normType === 'CWT') {
    if (normDir === 'INPUT' || (normType === 'CWT' && normDir !== 'OUTPUT')) {
      if (!isAssetSide) return false;
      return (
        code === '1060' ||
        code === '1085' ||
        detail === 'CWT_2307_ASSET' ||
        detail === 'PREPAID_TAX' ||
        /\b(creditable withholding|2307|cwt|prepaid tax|withholding tax receivable)\b/i.test(name) ||
        (isTaxFlagged && !/\b(input vat)\b/i.test(name))
      );
    }
    // OUTPUT / Payable EWT
    if (!isLiabilitySide) return false;
    return (
      code === '2030' ||
      code === '2035' ||
      detail === 'EWT_PAYABLE' ||
      detail === 'WITHHOLDING_TAX_COMPENSATION' ||
      detail === 'TAX_PAYABLE' ||
      /\b(withholding tax payable|expanded withholding|ewt payable|1601|withholding)\b/i.test(name) ||
      (isTaxFlagged && !/\b(output vat)\b/i.test(name))
    );
  }

  if (normType === 'FINAL_WHT') {
    if (normDir === 'INPUT') {
      if (!isAssetSide) return false;
      return (
        code === '1060' ||
        detail === 'CWT_2307_ASSET' ||
        detail === 'PREPAID_TAX' ||
        /\b(withholding|tax|2306|2307)\b/i.test(name) ||
        isTaxFlagged
      );
    }
    if (!isLiabilitySide) return false;
    return (
      code === '2030' ||
      detail === 'EWT_PAYABLE' ||
      detail === 'TAX_PAYABLE' ||
      /\b(withholding|final tax|ewt|tax payable|1601|1602|1603)\b/i.test(name) ||
      isTaxFlagged
    );
  }

  if (normType === 'PERCENTAGE' || normType === 'PERCENTAGE_TAX') {
    if (normDir === 'INPUT') {
      if (!isAssetSide) return false;
      return detail === 'PREPAID_TAX' || /\b(tax|prepaid)\b/i.test(name) || isTaxFlagged;
    }
    if (!isLiabilitySide) return false;
    return (
      code === '2120' ||
      code === '2020' ||
      code === '2030' ||
      detail === 'PERCENTAGE_TAX_LIABILITY' ||
      detail === 'TAX_PAYABLE' ||
      detail === 'VAT_PAYABLE' ||
      detail === 'OUTPUT_VAT_LIABILITY' ||
      detail === 'EWT_PAYABLE' ||
      /\b(percentage tax|tax payable|2551|output vat|withholding tax payable)\b/i.test(name) ||
      isTaxFlagged
    );
  }

  // Fallback for any other tax type: allow tax-flagged or tax-detail accounts matching direction
  if (normDir === 'INPUT') {
    return isAssetSide && (isTaxFlagged || ['PREPAID_TAX', 'INPUT_VAT', 'DEFERRED_INPUT_VAT', 'CWT_2307_ASSET'].includes(detail) || /\b(tax|vat|withholding|2307)\b/i.test(name));
  }
  return isLiabilitySide && (isTaxFlagged || ['VAT_PAYABLE', 'OUTPUT_VAT_LIABILITY', 'PERCENTAGE_TAX_LIABILITY', 'EWT_PAYABLE', 'WITHHOLDING_TAX_COMPENSATION', 'INCOME_TAX_PAYABLE_LIAB', 'TAX_PAYABLE'].includes(detail) || /\b(tax|vat|withholding)\b/i.test(name));
}

export function filterEligibleTaxControlAccounts<T extends CoaAccountLike>(
  accounts: ReadonlyArray<T>,
  taxType?: string | null,
  direction?: string | null
): T[] {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  return safe
    .filter((a) => isEligibleTaxControlAccount(a, taxType, direction, parentIds))
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function filterEligibleRevenueAccounts<T extends CoaAccountLike>(accounts: ReadonlyArray<T>): T[] {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  return safe
    .filter((a) => {
      if (!isPostableLeafAccount(a, parentIds)) return false;
      const acctType = String(a.accountType || '').trim().toUpperCase();
      return acctType === 'REVENUE' || acctType === 'OTHER_INCOME';
    })
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function filterEligibleExpenseAndPurchaseAccounts<T extends CoaAccountLike>(accounts: ReadonlyArray<T>): T[] {
  const safe = Array.isArray(accounts) ? accounts : [];
  const parentIds = computeParentAccountIds(safe);
  return safe
    .filter((a) => {
      if (!isPostableLeafAccount(a, parentIds)) return false;
      if (shouldAutoFlagAsCashAccount(a)) return false;
      const acctType = String(a.accountType || '').trim().toUpperCase();
      const code = String(a.accountCode || '').trim();
      if (['1030', '1040', '1050', '1060', '1520'].includes(code)) return false;
      return ['EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE', 'INVENTORY', 'FIXED_ASSET', 'OTHER_CURRENT_ASSET', 'ASSET'].includes(
        acctType
      );
    })
    .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || ''), undefined, { numeric: true }));
}

export function enrichCoaAccount<T extends CoaAccountLike>(account: T, parentIds?: ReadonlySet<string>): T & {
  detailType: string;
  birTaxCategory: string;
  isPostableLeaf: boolean;
  isCashAccount: number;
  isBankAccount: boolean;
  isSourceCashAccount: boolean;
} {
  const inferred = inferAccountDetailAndBirCategory(account);
  const enrichedBase = {
    ...account,
    detailType: inferred.detailType,
    birTaxCategory: inferred.birTaxCategory,
  };
  const postable = isPostableLeafAccount(enrichedBase, parentIds);
  const cashFlag = shouldAutoFlagAsCashAccount(enrichedBase) ? 1 : 0;
  const bankFlag = postable && isStrictBankAccount(enrichedBase);
  const sourceCashFlag = postable && Boolean(cashFlag);
  return {
    ...enrichedBase,
    isPostableLeaf: postable,
    isCashAccount: cashFlag,
    isBankAccount: bankFlag,
    isSourceCashAccount: sourceCashFlag,
  };
}

export function formatAccountOptionLabel(account: {
  accountCode?: string | null;
  accountName?: string | null;
  currency?: string | null;
}, includeCurrency = false): string {
  const code = String(account?.accountCode || '').trim();
  const name = String(account?.accountName || '').trim();
  const curr = includeCurrency && account?.currency ? ` (${account.currency})` : '';
  return `${code} — ${name}${curr}`;
}

