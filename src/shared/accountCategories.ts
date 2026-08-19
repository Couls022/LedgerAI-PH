export interface DetailTypeDefinition {
  code: string;
  label: string;
  description: string;
  birNote?: string;
  defaultCodePrefix?: string;
  suggestedBirTaxCategory?: string;
}

export interface AccountTypeDefinition {
  code: string;
  categoryGroup: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  label: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  detailTypes: DetailTypeDefinition[];
}

export const BIR_TAX_CATEGORIES = [
  { code: 'OUTPUT_VAT_12', label: 'Output VAT 12% (BIR Form 2550Q - Goods/Services)' },
  { code: 'INPUT_VAT_12', label: 'Input VAT 12% (BIR Form 2550Q - Creditable Purchases)' },
  { code: 'DEFERRED_INPUT_VAT', label: 'Deferred Input VAT (Capital Goods > ₱1M / Unbilled)' },
  { code: 'PERCENTAGE_TAX_3', label: 'Percentage Tax 3% (BIR Form 2551Q - Non-VAT)' },
  { code: 'CWT_2307', label: 'Creditable Withholding Tax / Form 2307 Asset (Income Tax Credit)' },
  { code: 'EWT_1601EQ', label: 'Expanded Withholding Tax / Form 1601-EQ Payable' },
  { code: 'WT_COMPENSATION_1601C', label: 'Withholding Tax on Compensation / Form 1601-C Payable' },
  { code: 'FINAL_TAX_1601FQ', label: 'Final Withholding Tax / Form 1601-FQ Payable' },
  { code: 'FRINGE_BENEFITS_1603Q', label: 'Fringe Benefits Tax / Form 1603Q Payable' },
  { code: 'INCOME_TAX_1702', label: 'Corporate / Individual Income Tax (BIR Form 1702 / 1701)' },
  { code: 'LOCAL_TAX_LBT', label: 'Local Business Tax (LBT) & Mayor\'s Permit' },
  { code: 'NON_TAXABLE_EXEMPT', label: 'VAT-Exempt / Non-Taxable Item' },
  { code: 'ZERO_RATED', label: '0% Zero-Rated Ecozone / Export Category' },
  { code: 'NOT_APPLICABLE', label: 'N/A - General Ledger Balance Account' }
];

export const ACCOUNT_TYPE_DEFINITIONS: AccountTypeDefinition[] = [
  {
    code: 'ASSET',
    categoryGroup: 'ASSET',
    label: 'Bank & Cash Equivalents',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'CHECKING',
        label: 'Checking Account',
        description: 'Use Checking accounts to track all checking activity, including debit card transactions and PDCs issued to suppliers.',
        birNote: 'Must reconcile with bank statements for BIR audit trail and CAS (Computerized Accounting System) compliance.',
        defaultCodePrefix: '1010',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'SAVINGS',
        label: 'Savings Account',
        description: 'Use Savings accounts to track company interest-bearing savings deposits at registered commercial banks.',
        birNote: 'Interest earned is subject to 20% Final Withholding Tax collected directly by the bank.',
        defaultCodePrefix: '1020',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'CASH_ON_HAND',
        label: 'Cash on Hand / Undeposited Funds',
        description: 'Track physical cash and checks received from sales collections prior to official bank deposit.',
        birNote: 'Must match daily Official Receipts (OR) or Sales Invoices (SI) cash collections.',
        defaultCodePrefix: '1000',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'PETTY_CASH',
        label: 'Petty Cash Fund',
        description: 'Track fixed revolving cash funds used for small day-to-day office disbursements.',
        birNote: 'Disbursements require supporting BIR-compliant official receipts or petty cash vouchers.',
        defaultCodePrefix: '1030',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'PAYROLL_BANK',
        label: 'Payroll Bank Account',
        description: 'Dedicated bank account used strictly for disbursing employee net salaries.',
        birNote: 'Must correspond with BIR Form 1601-C payroll registers and bank debit advice.',
        defaultCodePrefix: '1040',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'DOLLAR_ACCOUNT',
        label: 'Dollar / Foreign Currency Account',
        description: 'Foreign currency bank accounts (USD/EUR) held at local FCDU or offshore banks.',
        birNote: 'Revalued at transaction date and period-end BSP reference exchange rates per PAS 21.',
        defaultCodePrefix: '1050',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'RECEIVABLE',
    categoryGroup: 'ASSET',
    label: 'Accounts Receivable',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'TRADE_RECEIVABLE',
        label: 'Accounts Receivable - Trade',
        description: 'Track amounts due from customers for goods sold or services rendered on credit terms.',
        birNote: 'Subject to 12% Output VAT or 3% Percentage Tax upon billing or collection per BIR regulations.',
        defaultCodePrefix: '1200',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'ALLOWANCE_DOUBTFUL',
        label: 'Allowance for Doubtful Accounts',
        description: 'Contra-asset account tracking estimated uncollectible customer receivables.',
        birNote: 'Bad debts expense is tax-deductible only upon actual write-off with proven BIR compliance effort.',
        defaultCodePrefix: '1290',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'NOTES_RECEIVABLE',
        label: 'Notes Receivable',
        description: 'Formal written promissory notes from customers or third parties.',
        defaultCodePrefix: '1210',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'OTHER_CURRENT_ASSET',
    categoryGroup: 'ASSET',
    label: 'Other Current Assets',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'INPUT_VAT',
        label: 'Input VAT (12%)',
        description: 'Track 12% creditable input tax paid on domestic purchases of goods and services.',
        birNote: 'Reported in BIR Form 2550Q Schedule 3 & 4. Must be supported by valid VAT Sales Invoices.',
        defaultCodePrefix: '1310',
        suggestedBirTaxCategory: 'INPUT_VAT_12'
      },
      {
        code: 'DEFERRED_INPUT_VAT',
        label: 'Deferred Input VAT',
        description: 'Input VAT on capital purchases exceeding ₱1M or unbilled vendor services.',
        birNote: 'Amortized over useful life or 60 months per BIR RR 12-2012 / RR 13-2018.',
        defaultCodePrefix: '1320',
        suggestedBirTaxCategory: 'DEFERRED_INPUT_VAT'
      },
      {
        code: 'CWT_2307_ASSET',
        label: 'Creditable Withholding Tax (CWT / Form 2307)',
        description: 'Track creditable taxes withheld by customers on income payments received.',
        birNote: 'Claimable as tax credit against BIR Form 1702Q / 1701Q quarterly income tax payable.',
        defaultCodePrefix: '1330',
        suggestedBirTaxCategory: 'CWT_2307'
      },
      {
        code: 'PREPAID_EXPENSES',
        label: 'Prepaid Expenses & Rent',
        description: 'Advance payments for lease, insurance policies, software, or local permits.',
        defaultCodePrefix: '1400',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'ADVANCES_EMPLOYEES',
        label: 'Advances to Employees & Officers',
        description: 'Temporary cash advances for liquidation or SSS/Pag-IBIG emergency salary loans.',
        defaultCodePrefix: '1420',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'SECURITY_DEPOSITS_SHORT',
        label: 'Security Deposits (Short Term)',
        description: 'Refundable lease and utility deposits due within 12 months.',
        defaultCodePrefix: '1430',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'INVENTORY',
    categoryGroup: 'ASSET',
    label: 'Inventory',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'MERCHANDISE_INVENTORY',
        label: 'Merchandise Inventory',
        description: 'Track purchased finished goods available for resale to trading customers.',
        birNote: 'Requires annual inventory list submission to BIR RDO on or before Jan 30 (BIR Annex A).',
        defaultCodePrefix: '1500',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'FINISHED_GOODS',
        label: 'Finished Goods Inventory',
        description: 'Manufactured products completed and held for sale.',
        defaultCodePrefix: '1510',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'RAW_MATERIALS',
        label: 'Raw Materials Inventory',
        description: 'Materials held for manufacturing or assembly into finished products.',
        defaultCodePrefix: '1520',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'WORK_IN_PROCESS',
        label: 'Work in Process (WIP)',
        description: 'Unfinished products currently in the manufacturing pipeline.',
        defaultCodePrefix: '1530',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'FIXED_ASSET',
    categoryGroup: 'ASSET',
    label: 'Fixed Assets (PPE)',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'OFFICE_EQUIPMENT',
        label: 'Office Equipment & Computers',
        description: 'Computers, laptops, servers, printers, and office equipment.',
        birNote: 'Subject to BIR depreciation schedules (typically 3-5 years straight-line).',
        defaultCodePrefix: '1600',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'FURNITURE_FIXTURES',
        label: 'Furniture & Fixtures',
        description: 'Office desks, ergonomic chairs, conference tables, and partitions.',
        defaultCodePrefix: '1610',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'LEASEHOLD_IMPROVEMENTS',
        label: 'Leasehold Improvements',
        description: 'Architectural renovations on rented commercial or office spaces.',
        birNote: 'Amortized over lease period or useful life, whichever is shorter.',
        defaultCodePrefix: '1620',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'MOTOR_VEHICLES',
        label: 'Transportation / Motor Vehicles',
        description: 'Company vans, trucks, and delivery vehicles.',
        birNote: 'Land Transportation Office (LTO) registration and BIR depreciation restrictions apply.',
        defaultCodePrefix: '1630',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'LAND_BUILDINGS',
        label: 'Land & Commercial Buildings',
        description: 'Company-owned real property and physical structures.',
        defaultCodePrefix: '1640',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'ACCUMULATED_DEPRECIATION',
        label: 'Accumulated Depreciation',
        description: 'Contra-asset account tracking total depreciation claimed to date.',
        defaultCodePrefix: '1690',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'PAYABLE',
    categoryGroup: 'LIABILITY',
    label: 'Accounts Payable',
    normalBalance: 'CREDIT',
    detailTypes: [
      {
        code: 'TRADE_PAYABLE',
        label: 'Accounts Payable - Trade',
        description: 'Amounts owed to suppliers for purchases of goods, materials, or services on credit.',
        birNote: 'Subject to EWT withholding upon accrual or payment per BIR RR 11-2018.',
        defaultCodePrefix: '2000',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'ACCRUED_TRADE_PAYABLE',
        label: 'Trade Accruals',
        description: 'Unbilled vendor obligations for goods/services already received.',
        defaultCodePrefix: '2010',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'OTHER_CURRENT_LIABILITY',
    categoryGroup: 'LIABILITY',
    label: 'Other Current Liabilities & BIR Taxes',
    normalBalance: 'CREDIT',
    detailTypes: [
      {
        code: 'OUTPUT_VAT_LIABILITY',
        label: 'Output VAT (12%) Payable',
        description: 'Track 12% Output tax collected on sales of goods and services.',
        birNote: 'Reported in BIR Form 2550Q. Remitted quarterly after deducting Input VAT.',
        defaultCodePrefix: '2110',
        suggestedBirTaxCategory: 'OUTPUT_VAT_12'
      },
      {
        code: 'PERCENTAGE_TAX_LIABILITY',
        label: 'Percentage Tax (3%) Payable',
        description: '3% Percentage tax payable on gross quarterly sales for Non-VAT taxpayers.',
        birNote: 'Filed under BIR Form 2551Q every quarter.',
        defaultCodePrefix: '2120',
        suggestedBirTaxCategory: 'PERCENTAGE_TAX_3'
      },
      {
        code: 'EWT_PAYABLE',
        label: 'Expanded Withholding Tax (EWT) Payable',
        description: 'Creditable taxes withheld from supplier payments (1%, 2%, 5%, 10%, 15%).',
        birNote: 'Remitted via BIR Form 0619E (Monthly) and Form 1601-EQ (Quarterly with SAWT).',
        defaultCodePrefix: '2130',
        suggestedBirTaxCategory: 'EWT_1601EQ'
      },
      {
        code: 'WITHHOLDING_TAX_COMPENSATION',
        label: 'Withholding Tax on Compensation Payable',
        description: 'Income taxes withheld from employee compensation and salaries.',
        birNote: 'Filed monthly under BIR Form 1601-C and annualized at year-end (Form 1604-C).',
        defaultCodePrefix: '2140',
        suggestedBirTaxCategory: 'WT_COMPENSATION_1601C'
      },
      {
        code: 'STATUTORY_PAYABLES_SSS',
        label: 'SSS / PhilHealth / Pag-IBIG Contributions Payable',
        description: 'Combined mandatory employee and employer government premium payables.',
        birNote: 'Must be paid monthly to avoid SSS/HDMF penalties.',
        defaultCodePrefix: '2150',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'ACCRUED_SALARIES',
        label: 'Accrued Salaries & Wages',
        description: 'Earned employee wages unpaid at accounting cutoff date.',
        defaultCodePrefix: '2200',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'INCOME_TAX_PAYABLE_LIAB',
        label: 'Income Tax Payable',
        description: 'Corporate or individual income tax liability accrued for the period.',
        birNote: 'Filed under BIR Form 1702-RT / 1702-EX / 1701.',
        defaultCodePrefix: '2100',
        suggestedBirTaxCategory: 'INCOME_TAX_1702'
      }
    ]
  },
  {
    code: 'LONG_TERM_LIABILITY',
    categoryGroup: 'LIABILITY',
    label: 'Long Term Liabilities',
    normalBalance: 'CREDIT',
    detailTypes: [
      {
        code: 'BANK_LOAN_LONG',
        label: 'Bank Loans Payable - Long Term',
        description: 'Mortgages, bank term loans, and credit facilities due beyond 12 months.',
        defaultCodePrefix: '2500',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'DEFERRED_TAX_LIABILITY',
        label: 'Deferred Tax Liability',
        description: 'Income tax payable in future periods per PAS 12 due to temporary differences.',
        defaultCodePrefix: '2510',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'EQUITY',
    categoryGroup: 'EQUITY',
    label: 'Equity',
    normalBalance: 'CREDIT',
    detailTypes: [
      {
        code: 'PAID_IN_CAPITAL',
        label: 'Paid-in Capital / Capital Stock',
        description: 'Capital contributed by stockholders or sole proprietor to the corporation.',
        birNote: 'Must agree with SEC Articles of Incorporation or DTI Registration.',
        defaultCodePrefix: '3000',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'RETAINED_EARNINGS',
        label: 'Retained Earnings',
        description: 'Cumulative net income retained in the business over fiscal years.',
        birNote: 'Subject to Improperly Accumulated Earnings Tax (IAET) rules if retained in excess of 100% paid-in capital.',
        defaultCodePrefix: '3100',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'DIVIDENDS_PAID',
        label: 'Dividends Paid / Owner Drawings',
        description: 'Distributions of earnings paid out to shareholders or sole proprietor.',
        birNote: 'Subject to 10% Final Withholding Tax on domestic individual stockholders.',
        defaultCodePrefix: '3200',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'REVENUE',
    categoryGroup: 'REVENUE',
    label: 'Sales Revenue & Income',
    normalBalance: 'CREDIT',
    detailTypes: [
      {
        code: 'SALES_GOODS',
        label: 'Sales Revenue - Goods',
        description: 'Gross revenue from selling physical merchandise or manufactured products.',
        birNote: 'Subject to 12% Output VAT or 3% Percentage Tax.',
        defaultCodePrefix: '4000',
        suggestedBirTaxCategory: 'OUTPUT_VAT_12'
      },
      {
        code: 'SERVICE_INCOME',
        label: 'Service Revenue / Professional Fees',
        description: 'Revenue earned from professional services, contracting, or consulting.',
        birNote: 'Subject to 12% Output VAT or 3% Percentage Tax upon collection or billing.',
        defaultCodePrefix: '4010',
        suggestedBirTaxCategory: 'OUTPUT_VAT_12'
      },
      {
        code: 'ZERO_RATED_SALES',
        label: 'Zero-Rated Ecozone / Export Sales',
        description: '0% VAT sales to PEZA ecozone enterprises or foreign direct exports.',
        birNote: 'Must be supported by PEZA Certificate of Tax Exemption or Export Bill of Lading.',
        defaultCodePrefix: '4020',
        suggestedBirTaxCategory: 'ZERO_RATED'
      },
      {
        code: 'EXEMPT_SALES',
        label: 'VAT-Exempt Sales',
        description: 'Sales of exempt agricultural goods, medical services, or cooperatives.',
        birNote: 'Exempt under NIRC Section 109.',
        defaultCodePrefix: '4030',
        suggestedBirTaxCategory: 'NON_TAXABLE_EXEMPT'
      }
    ]
  },
  {
    code: 'COST_OF_SALES',
    categoryGroup: 'REVENUE',
    label: 'Cost of Goods Sold',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'COGS_FINISHED_GOODS',
        label: 'Cost of Goods Sold - Products',
        description: 'Direct merchandise and inventory costs matched against product sales.',
        defaultCodePrefix: '5000',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'DIRECT_LABOR',
        label: 'Direct Labor',
        description: 'Salaries and wages of factory workers and direct service personnel.',
        defaultCodePrefix: '5010',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'MANUFACTURING_OVERHEAD',
        label: 'Manufacturing Overhead & Freight',
        description: 'Factory utilities, freight-in, and factory indirect expenses.',
        defaultCodePrefix: '5020',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'EXPENSE',
    categoryGroup: 'EXPENSE',
    label: 'Operating Expenses',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'SALARIES_EXPENSE',
        label: 'Salaries and Wages Expense',
        description: 'Employee salaries, basic pay, and wage compensations.',
        birNote: 'Must match BIR Form 1601-C & 1604-C annual alphabetical list.',
        defaultCodePrefix: '6000',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'RENT_EXPENSE',
        label: 'Rent & Lease Expense',
        description: 'Office, warehouse, and machinery rental expenses.',
        birNote: 'Subject to 5% Expanded Withholding Tax (EWT) under BIR RR 11-2018.',
        defaultCodePrefix: '6010',
        suggestedBirTaxCategory: 'EWT_1601EQ'
      },
      {
        code: 'UTILITIES_EXPENSE',
        label: 'Utilities Expense (Power/Water)',
        description: 'Electricity (Meralco), water (Maynilad), and utility bills.',
        defaultCodePrefix: '6020',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'TELECOM_EXPENSE',
        label: 'Telecommunications & Internet',
        description: 'Phone, mobile, broadband, and cloud communication services.',
        defaultCodePrefix: '6030',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'PROFESSIONAL_FEES',
        label: 'Professional & Consultancy Fees',
        description: 'Audit, legal, accounting, and technical consulting fees.',
        birNote: 'Subject to 10% / 15% EWT withholding for individuals/corporations.',
        defaultCodePrefix: '6040',
        suggestedBirTaxCategory: 'EWT_1601EQ'
      },
      {
        code: 'REPRESENTATION_EXPENSE',
        label: 'Representation & Entertainment',
        description: 'Client meetings, dining, and business entertainment.',
        birNote: 'Tax deductible cap: 0.5% of Net Sales (Goods) or 1.0% of Net Revenue (Services) per BIR RR 10-2002.',
        defaultCodePrefix: '6050',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'TAXES_LICENSES',
        label: 'Taxes and Licenses',
        description: 'Local Business Tax (LBT), Mayor\'s Permit, BIR Annual Reg (0605), RPT.',
        birNote: 'Fully tax-deductible expense for BIR income tax computation.',
        defaultCodePrefix: '6060',
        suggestedBirTaxCategory: 'LOCAL_TAX_LBT'
      },
      {
        code: 'DEPRECIATION_EXPENSE',
        label: 'Depreciation & Amortization Expense',
        description: 'Periodic depreciation charges on fixed assets and equipment.',
        defaultCodePrefix: '6070',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'SUPPLIES_EXPENSE',
        label: 'Office Supplies & Stationeries',
        description: 'Office paper, printer toner, and consumable office supplies.',
        defaultCodePrefix: '6080',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  },
  {
    code: 'OTHER_EXPENSE',
    categoryGroup: 'EXPENSE',
    label: 'Other Non-Operating Expenses',
    normalBalance: 'DEBIT',
    detailTypes: [
      {
        code: 'INTEREST_BANK_FEES',
        label: 'Interest & Bank Charges',
        description: 'Loan interest charges, wire transfer fees, and credit card processing charges.',
        defaultCodePrefix: '7000',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'FOREX_LOSS',
        label: 'Loss on Foreign Exchange',
        description: 'Realized and unrealized foreign exchange losses on dollar transactions.',
        defaultCodePrefix: '7010',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      },
      {
        code: 'BIR_PENALTIES',
        label: 'BIR Tax Penalties & Surcharges',
        description: 'Late filing penalties, compromise fees, and interest surcharges.',
        birNote: 'STRICTLY NON-DEDUCTIBLE for BIR Income Tax computation (NIRC Sec. 34).',
        defaultCodePrefix: '7020',
        suggestedBirTaxCategory: 'NOT_APPLICABLE'
      }
    ]
  }
];

export function getAccountTypeDefinition(accountTypeCode: string): AccountTypeDefinition | undefined {
  return ACCOUNT_TYPE_DEFINITIONS.find(def => def.code === accountTypeCode);
}

export function getDetailTypeDefinition(accountTypeCode: string, detailTypeCode: string): DetailTypeDefinition | undefined {
  const accountTypeDef = getAccountTypeDefinition(accountTypeCode);
  if (!accountTypeDef) return undefined;
  return accountTypeDef.detailTypes.find(dt => dt.code === detailTypeCode);
}
