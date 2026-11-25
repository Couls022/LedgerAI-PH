# LedgerAI PH — Ledger Agent AI Engine Architecture (`v1.0.0-rc.2`)

## 1. Architectural Role & Grounding
**Ledger Agent** (`EnterpriseAiAgentService`, `/api/ai/ledger-agent`, `LedgerAgentWidget.tsx`) is LedgerAI PH's dual-mode **ERP Functional Guide & Live Financial Intelligence Assistant**:
1. **Strict Grounding & Zero Fabrication**: Ledger Agent never invents account balances, tax liabilities, BIR permits, or statutory rates. Quantitative figures are queried live from the active company's isolated SQLite database or computed deterministically via `TaxEngine`; procedural/how-to answers retrieve verified guidance from `CANONICAL_KNOWLEDGE_BASE` (`src/shared/knowledgeBase.ts`).
2. **Offline-First Resilience & Provider Failover**:
   - **Online Provider Layer (`aiProviderService.ts`)**: Supports configured **Gemini** (`gemini-2.5-flash`), **OpenAI**, and **Grok** providers via server-managed environment secrets (never exposed to browser JavaScript), automatically failing over cleanly if quota/network errors occur.
   - **Local Deterministic Fallback Engine (`enterpriseAiAgentService.ts`)**: Operates 100% offline with zero network calls across 14 deterministic domain branches, SQLite analytics, `TaxEngine` statutory computations, and full-text + Taglish/Filipino synonym search across all **16 modules / 36 submodules**.

---

## 2. Canonical ERP Functional Knowledge Base (`src/shared/knowledgeBase.ts`)
- Contains structured `KnowledgeRecord` entries with exact 1-to-1 coverage of all **16 primary modules** and **36 canonical submodules** defined in `CANONICAL_ERP_MODULES`, plus cross-module guides for:
  - Financial Report Data Collection & Single Source of Truth
  - Company Owner Full Authority & 9-Role RBAC Policy
  - Philippine BIR Statutory Tax Guide (`VAT12`, `NON_VAT Sec. 116 2551Q`, `8% Flat Tax`, `EWT 2307`, `FWT`, `1601-C`, `RA 11976 EOPT`)
  - Zero-Data Clean Start & Non-Destructive Shortcuts
- Every `KnowledgeRecord` carries canonical `navigationPath` routes verified 1-to-1 against `ClientApp.tsx` so Ledger Agent navigation links and `sourceRecord` deep links never 404 or hit stale routes.

---

## 3. Regime-Aware Philippine Tax Computation (`DEF-AGENT-TAX-001`)
- **Zero Blanket `12/112` or `2/112` Fabrication**: Both `EnterpriseAiAgentService` (Branch 7) and `financialSkills.ts` (`getVatPayable`) inspect the company's authoritative tax regime (`vat_status` and `taxpayer_classification` from `companies` + `company_tax_profiles`):
  - **VAT-Registered (`VAT_REGISTERED`)**: Computes Output VAT exclusively from `VAT12` line items and posted GL Output VAT accounts (`2020`/`2120`), excluding Zero-Rated (`VAT0`) and VAT-Exempt (`VATEX`) sales; computes Input VAT from `VAT12` purchases and `1150`/`1160` GL lines.
  - **Non-VAT (`NON_VAT` / Percentage Tax)** & **`8%` Flat Income Tax**: Always reports **`₱0.00` Output VAT, `₱0.00` Input VAT, and `₱0.00` Net VAT Payable**, and computes **Percentage Tax (`BIR Form 2551Q`, Sec. 116)** (`3%` standard / `1%` CREATE Act transition) or **8% Optional Flat Income Tax** via `TaxEngine`.
  - **Withholding Tax (EWT / CWT)**: Sums actual `supplier_payments.withholding_tax_amount`, `tax_calculations`, and posted EWT GL lines (`2120`/`2130`) — never fabricating `amount * 2 / 112`.

---

## 4. Security, Domain RBAC & Action Confirmation Hardening (`DEF-AGENT-RBAC-001`)
- **Strict Company Isolation**: Every query binds `dbContext = CompanyManager.getCompanyDb(companyId)` from the authenticated session (`req.activeCompanyId`).
- **Per-Domain RBAC Enforcement**:
  - `POST /api/ai/ledger-agent` and `EnterpriseAiAgentService` enforce domain permissions across Payroll (`payroll:view` / `payroll:manage`, preserving `payrollInquiryMasked` response for unauthorized salary queries), Fixed Assets (`fixedassets:view`), Approvals (`approvals:view`), Periods (`accounting:view`/`periods:close`), Trial Balance / COA / Journals (`accounting:view`/`reports:view`), Inventory (`inventory:view`), AR/AP (`sales:view`/`purchases:view`), Tax (`tax:view`), and Audit/Compliance (`audit:view`).
  - Executive fallback summaries (Branch 11) filter visible GL, AR, and AP rows strictly according to the caller's granted permissions.
  - System Knowledge / How-To guide queries remain accessible for navigation help while respecting `Company Owner` (`['*']`) unrestricted authority.
- **Draft-First Workflow & Hardened `POST /api/ai/confirm-action`**:
  - Mutating AI actions (`create_journal_entry`, `submit_invoice`, `approve_record`, etc.) stage pending human-in-the-loop proposals (`pendingActions`).
  - `POST /api/ai/confirm-action` verifies:
    1. Authenticated active user ownership (`action.userId === user.id`), rejecting cross-user confirmation (`403`).
    2. Quarantine write lock (`RECOVERY_READ_ONLY` blocked via `requireWriteAccess`).
    3. Explicit action permission (`accounting:create`, `sales:create`, `sales:approve`, etc. via `RbacService.hasPermission`, honoring active `Company Owner` immunity).
    4. Immutable forensic sealing via `AuditService.log` on every executed confirmation.

