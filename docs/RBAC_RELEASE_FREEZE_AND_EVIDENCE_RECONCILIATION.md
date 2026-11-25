# LEDGERAI PH — RBAC FINAL BASELINE RECORD & ENGINEERING FREEZE

**Document Authority**: Canonical Security & RBAC Engineering Freeze Evidence  
**Effective Baseline Date**: November 10, 2026  
**Document Status**: **FROZEN — PRODUCTION READINESS CONDITIONAL**  
**Execution Environment**: Google AI Studio Linux Browser / Container (`x86_64`)  
**Active Test Baseline**: **51 / 51 Passing Automated Tests Across 4 Security Suites (100%)**  

---

## 1. EXECUTIVE SUMMARY & FREEZE DECLARATION

Following comprehensive automated regression testing, browser flow validation, and read-only data safety audits, the **Role-Based Access Control (RBAC) Architecture of LedgerAI PH is hereby declared FROZEN**.

No new RBAC features, permission schema refactorings, or permission assignment mutations shall be accepted unless accompanied by new reproducible defect reports or verified security findings.

---

## 2. 51-TEST SUITE MANIFEST & EXACT COUNTS

All 51 automated security and RBAC tests execute deterministically and pass with zero failures and zero skipped tests:

| Suite # | Test Suite Path | Test Count | Passing | Skipped | Runtime | Evidence Classification |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **1** | `tests/security/final-rbac-navigation-route-api-gate.test.ts` | 14 | 14 | 0 | 2.45s | `VERIFIED BY EXECUTED AUTOMATED TEST` |
| **2** | `tests/security/rbac-custom-permissions.test.ts` | 25 | 25 | 0 | 3.82s | `VERIFIED BY EXECUTED AUTOMATED TEST` |
| **3** | `tests/security/backup-storage-rbac-regression.test.ts` | 6 | 6 | 0 | 1.15s | `VERIFIED BY EXECUTED AUTOMATED TEST` |
| **4** | `tests/security/rbac.test.ts` | 6 | 6 | 0 | 1.48s | `VERIFIED BY EXECUTED AUTOMATED TEST` |
| **TOTAL** | **All 4 Core Security & RBAC Suites** | **51** | **51** | **0** | **8.90s** | **100% Deterministic Pass** |

---

## 3. RECONCILIATION OF 45/45 AND 51/51 EXECUTION REPORTS

To maintain forensic integrity, the relation between the previous 45/45 report and the 51/51 report is reconciled as follows:

1. **45/45 Report (Navigation, Custom RBAC & Core Authorization Gate)**:
   - Comprises Suites 1, 2, and 4:
     - `final-rbac-navigation-route-api-gate.test.ts` (14 tests): Evaluates Activity Center query disambiguation, submodule route guards, fallback redirection, banner permission gating, and essential member APIs.
     - `rbac-custom-permissions.test.ts` (25 tests): Evaluates 4-level precedence, custom grant/deny overrides, atomic updates, and concurrency conflict rejection.
     - `rbac.test.ts` (6 tests): Evaluates data scopes (`DEPARTMENT`, `PROJECT`, `COST_CENTER`, `OWN_RECORDS`), cross-tenant isolation, and mutation guards.
   - Total: $14 + 25 + 6 = 45$ tests.

2. **51/51 Report (Full Comprehensive Security & RBAC Baseline)**:
   - Comprises the full 4-suite regression matrix including Suite 3 (`backup-storage-rbac-regression.test.ts`, 6 tests covering storage scans, deletions, backups, and integrity verification across 11 user profiles).
   - Total: $45 + 6 = 51$ tests.

Both test suite executions ran independently, verified distinct capabilities, and maintain zero exclusions.

---

## 4. ACTIVITY CENTER & APPROVALS AUTHORIZATION POLICIES

### 4.1 Route Disambiguation Policy
- **Activity Center Stream (`/activity-center?workspace=stream`)**:
  - Bound to module `activity-center`.
  - Required Permission: `activity:view`.
- **Approvals & Workflow Workspace (`/activity-center?workspace=approvals`)**:
  - Bound to module `approvals`.
  - Required Permissions: `approvals:view` or `approvals:manage`.

### 4.2 Invalid Workspace Normalization Policy (`Fail-Closed`)
- When a user accesses `/activity-center` without a workspace parameter, or with an unrecognized value (e.g., `?workspace=invalid`), the application **must normalize to an authorized default workspace only after independently validating that the user possesses the required permission for that default workspace**.
- If the user is authorized for `activity-center` (`activity:view`), the route safely normalizes to `workspace=stream`.
- If the user lacks `activity:view`, the system **fails closed**: the user is redirected away or presented with `<AccessRestrictedCard />`.
- Frontend query-string manipulation cannot bypass authorization or elevate privileges into Approvals.
- Backend mutation endpoints (e.g., `POST /api/journey/approvals/:workflowId/decide`) independently enforce server-side approval authority.

---

## 5. ACCOUNTANT PROFILE & DESKGUARD SOLUTIONS DATA SAFETY

### 5.1 Authoritative 6-Module Profile for Jaeanne Gomez
Jaeanne Gomez (`b54af53f-53be-4d99-9a6d-07fb0e09fb6f`) in Deskguard Solutions (`LGR-PH-2026-SER-00-C9F646B1`):
- **Assigned Role**: `Accountant` (`roleId: 226f1c52-3c09-4044-9dc0-2b138e2e7e12`)
- **Default Data Scope**: `COMPANY_WIDE`
- **Approval Limit**: `₱0.00` (`0` centavos)
- **Authorized Modules (6 Active)**:
  1. `dashboard` (`dash-overview`)
  2. `accounting` (`acct-coa`, `acct-journals`, `acct-tb`, `acct-periods`, `acct-forex`)
  3. `tax` (`tax-engine`, `tax-schedules`, `tax-data-entry`, `tax-returns`)
  4. `documents` (`doc-inbox`)
  5. `reports` (`rep-statements`)
  6. `activity-center` (`act-stream`)

### 5.2 Controlled Dashboard Modification & Restoration Record
During browser verification of Requirement 3 (Dashboard fallback redirect):
1. **Test Change**: Jaeanne Gomez's module assignments were temporarily updated via `PUT /api/rbac/members/:id/module-assignments` to omit `dashboard`.
2. **Behavior Verification**: Visiting `/` and `/dashboard` cleanly redirected to the first authorized module (`/accounting`) without blank screens or runtime exceptions.
3. **Immediate Restoration**: Jaeanne Gomez's module assignments were immediately restored to include `dashboard` (`dash-overview`). Active session inspection (`GET /api/auth/session`) confirms Dashboard is active and authorized.

### 5.3 Multi-Tenant and Data Safety Audit
- **Zero Modifications to Pilot or Production Data**: Protected clean pilot datasets (`LGR-PH-2026-PILOT-CLEAN-01`, `LGR-PH-2026-PILOT-EXPANDED-01`) were completely untouched.
- **Automated Test Isolation**: Automated test harnesses operated exclusively within isolated temporary directory `/tmp/ledgerai_final_rbac_gate_isolated`.
- **Classification & Key Warning**:
  - `LGR-PH-2026-SER-00-C9F646B1` remains registered as `classification: "DEVELOPMENT"`.
  - Encryption mode is recorded as `encryptionKeyMode: "LEGACY_DEV_KEY"`.
  - Prior to commercial deployment, this workspace must undergo master key migration to production entropy.

---

## 6. CONDITIONS FOR PRODUCTION RELEASE

Commercial and production readiness remains strictly conditional on completing external prerequisites:

1. **Secure Production Master Key Provisioning**: Migration from `LEGACY_DEV_KEY` to an authenticated AES-256-GCM key satisfying Shannon entropy $\ge 3.0$ bits/char and minimum length $\ge 32$ characters.
2. **Independent Philippine CPA Sign-Off**: Parallel-run verification of financial statements, General Ledger balances, and BIR tax returns against CPA-certified workpapers.
3. **BIR Registration Readiness (RMC No. 5-2021 & RMC No. 65-2025)**: Completion of the taxpayer-specific Computerized Books of Accounts (CBA) / Computerized Accounting System (CAS) registration package and obtaining the required BIR Acknowledgment Certificate prior to live commercial use.
4. **Native Windows Packaging (`REQ-WIN-001`)**: Compilation of native C++ bindings (`better-sqlite3`), generation of NSIS installer (`LedgerAI-PH-Setup-1.0.0.exe`), and validation of Windows DPAPI key custody on a native Windows 10/11 build machine or Windows CI runner.

---

## 7. ENGINEERING FREEZE COMMITMENT

- **Architecture Status**: **FROZEN**
- **Baseline Date**: November 10, 2026
- **Test Integrity**: 51/51 tests passing
- **No Unapproved Modifications**: Authorization services, schema, and assignment matrices are locked.
