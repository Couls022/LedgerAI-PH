# LedgerAI PH — Chart of Accounts (COA) Selector & Postability Coverage Matrix

**Shared Enforcement Utility:** `src/shared/coaAccountUtils.ts` (`filterPostableLeafAccounts`, `computeParentAccountIds`, `isPostableLeafAccount`, `isEligibleCashBankAccount`, `isEligibleTaxControlAccount`, `isStrictBankAccount`)  
**Server Control Resolution:** `resolveCompanyControlAccount`, `validateCompanyCoaSelection` (`src/server/db/business_transactions.ts`)

---

## 1. Coverage Matrix Across UI Selectors & Server Endpoints

| Surface / Endpoint | Enforcement Mechanism | Header Accounts Excluded (`1000`/`2000`/`4000`/`5000`/`6000` or Any Parent Account) | Verification Status |
|---|---|---|---|
| **Master Data Accounts (`POST/PUT /api/master-data/accounts`, `/payment-methods`, `/tax-codes`)** | `isPostableLeafAccount`, `isEligibleCashBankAccount`, `isEligibleTaxControlAccount`, `isStrictBankAccount` | Enforced (`400 INVALID_ACCOUNT` / `INELIGIBLE_CASH_ACCOUNT`) | Verified via `masterData.ts` inspection & `coa-gl-engine-and-banking-remediation.test.ts` |
| **Manual Journals (`Journals.tsx` & `POST /api/accounting/journals`)** | `filterPostableLeafAccounts` in UI; active leaf account lookup on server | Enforced | Verified via COA integration suites |
| **Sales & AR / Procurement & AP (`business_transactions.ts`)** | `resolveCompanyControlAccount` + `validateCompanyCoaSelection` | Enforced | Verified across 100 SI + 100 PB stress run & `coa-gl-engine-and-banking-remediation.test.ts` |
| **Cash & Banking (`createCashTransaction`, `bankReconciliationService.ts`)** | `validateCompanyCoaSelection(..., 'CASH_OR_BANK')` & `isEligibleDestinationBankAccount` | Enforced | Verified in `cash-banking-and-reconciliation-e2e.test.ts` Test #6 |
| **OCR Document Posting (`src/server/routes/documents.ts` `POST /:id/post-accounting`)** | **FIXED:** Replaced hardcoded `'2000'`/`'6000'`/`'5000'`/`'4000'` fallbacks with `resolveCompanyControlAccount` | Enforced | Remediated in `documents.ts`, typechecked cleanly (`tsc --noEmit`) |
| **BIR Tax Form COA Mapping (`src/client/pages/Tax/TaxForms.tsx`)** | **FIXED:** Wrapped `accounts.map` with `filterPostableLeafAccounts(accounts)` | Enforced in UI selector | Remediated in `TaxForms.tsx`, verified via `tsc --noEmit` & `TaxForms.tsx` inspection |
| **Recurring Journal Templates (`src/server/services/recurringJournalService.ts`)** | **FIXED:** Builds `postableCoaRows` filtering `!parentIds.has(a.id) && !isHeader && ACTIVE` | Rejects `1000`..`6000` & parent accounts (`UNMAPPED_ACCOUNT`) | Verified in `erp-full-workflow-regression-and-stress.test.ts` Test #2 |
