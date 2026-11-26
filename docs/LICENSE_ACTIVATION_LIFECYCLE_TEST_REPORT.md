# LEDGERAI PH — LICENSE ACTIVATION LIFECYCLE TEST REPORT

**Test Suite File:** [dualFileOneTimeLicensing.test.tsx](file:///C:/Users/Couls/antigravity/LedgerAI-PH/tests/licensing/dualFileOneTimeLicensing.test.tsx)  
**Regression Suites:** `antiRollback.test.ts`, `licensingLifecycle.test.ts`, `lrqWorkflow.test.ts`, `lanResolution.test.ts`, `installersVerification.test.ts`  
**Execution Result:** **74 / 74 Tests PASSED (100% Pass Rate)**  
**TypeScript Check (`npx tsc --noEmit`):** **0 Errors**

---

## 30-Scenario Dual-File Verification Matrix (Browser UI + Authoritative Server)

| # | Scenario | UI Verification (JSDOM React Component) | Server Verification (API / DB / Registry) | Status |
|---|---|---|---|---|
| 1 | Both files missing | State shows `Both files missing`; `Activate License` disabled | `POST /api/licensing/activate` returns `400 BOTH_FILES_REQUIRED` | **PASS** |
| 2 | License Key File missing | Selecting `.lai` only shows `Key License File selected`; button disabled | Returns `400 LICENSE_KEY_FILE_REQUIRED` | **PASS** |
| 3 | Key License File missing | Selecting `.lkey` only shows `License Key File selected`; button disabled | Returns `400 KEY_LICENSE_FILE_REQUIRED` | **PASS** |
| 4 | Both files valid & matching | Shows `Both files selected` -> `Activation successful` | Returns `200`, marks `REDEEMED`, writes `company_licenses`, `license_redemption_records`, & registry | **PASS** |
| 5 | Both files valid but mismatched | Displays `License pair mismatch` | Returns `403 LICENSE_PAIR_MISMATCH` | **PASS** |
| 6 | Invalid License Key File | Rejects non-conformant/corrupt `.lkey`, displays `Activation failed` | Returns `403 INVALID_LICENSE_KEY_FILE` | **PASS** |
| 7 | Invalid Key License File | Rejects non-conformant/corrupt `.lai`, displays `Activation failed` | Returns `403 INVALID_KEY_LICENSE_FILE` | **PASS** |
| 8 | Invalid digital signature | Displays `Invalid signature` | Returns `403 INVALID_SIGNATURE` | **PASS** |
| 9 | Modified license contents | Plan/seat tampering breaks signature; displays `Invalid signature` | Returns `403 INVALID_SIGNATURE` | **PASS** |
| 10 | Incorrect Company ID | Displays `Company identity mismatch` | Returns `403 COMPANY_IDENTITY_MISMATCH` | **PASS** |
| 11 | Expired license | Displays `License expired` | Returns `403 LICENSE_EXPIRED` | **PASS** |
| 12 | Revoked license | Displays `License revoked` | Returns `403 LICENSE_REVOKED` | **PASS** |
| 13 | Suspended license | Displays suspended failure notice (`Activation failed`) | Returns `403 LICENSE_SUSPENDED` | **PASS** |
| 14 | Already redeemed pair | Displays `License already redeemed` | Returns `403 LICENSE_ALREADY_REDEEMED` | **PASS** |
| 15 | Reuse of pair for another company | Displays `Company identity mismatch` | Blocked (`403 COMPANY_IDENTITY_MISMATCH` / `LICENSE_ALREADY_REDEEMED`) | **PASS** |
| 16 | Pair replay (outdated restore) | UI rejection confirmed on replay | Pre-activation snapshot restore cannot replay consumed pair (`403 LICENSE_ALREADY_REDEEMED`) | **PASS** |
| 17 | Duplicate activation request | Idempotent verification returns `Activation successful` | Returns `200 idempotent: true`, zero duplicate rows in `license_redemption_records` | **PASS** |
| 18 | Repeated company opening | No file prompt required on reopen | `/api/licensing/status` remains `ACTIVE` across `closeCompanyDb` -> `open-database` | **PASS** |
| 19 | Browser restart | Clears cookies/localStorage; fetches state dynamically | Fresh session returns `ACTIVE` `ENTERPRISE` directly from server | **PASS** |
| 20 | Local server restart | Fresh session against restarted Express server reads active license | Re-instantiated `createApp()` returns `ACTIVE` `PRO` | **PASS** |
| 21 | Company switching | Displays per-company licensing state cleanly | Company A=`ENTERPRISE`, Company B=`TRIAL`, zero bleed | **PASS** |
| 22 | Company backup & restore | Same-company restore preserves license without re-activation | Same-company restore `ACTIVE`; clone (`cloneAsNew`) stripped of `ENTERPRISE` (`TRIAL`); tampered injection fails closed | **PASS** |
| 23 | Missing activation metadata | Status reflects `RECOVERY_REQUIRED` | `validateActiveLicenseForCompany` fails (`MISSING_ACTIVATION_METADATA`) | **PASS** |
| 24 | Corrupted activation metadata | Status reflects `RECOVERY_REQUIRED` | HMAC verification fails (`CORRUPTED_ACTIVATION_METADATA`) | **PASS** |
| 25 | Registry mismatch | Status reflects `RECOVERY_REQUIRED` / `REGISTRY_MISMATCH` | Tampered/mismatched `trusted-license-registry.json` fails closed | **PASS** |
| 26 | Anti-rollback behavior | Fails activation cleanly | Future timestamp triggers `TAMPERED` lock and `403 TAMPERED` | **PASS** |
| 27 | Authorized recovery | Replacement pair with `recoveryReference` activates cleanly | Logs `AUTHORIZED_RECOVERY`, updates DB & registry; unreferenced recovery blocked (`403`) | **PASS** |
| 28 | Unauthorized license replacement | Different valid pair rejected | `POST /api/licensing/activate` returns `403 UNAUTHORIZED_LICENSE_REPLACEMENT` | **PASS** |
| 29 | Frontend manipulation attempts | `LicensingBanner` ignores forged `localStorage` & renders `15-DAY TRIAL` | Forged body flags rejected (`400 BOTH_FILES_REQUIRED`) | **PASS** |
| 30 | Unauthorized API activation attempts | Non-admin / unauth blocked cleanly | Unauthenticated -> `401`; Bookkeeper lacking `settings:manage` -> `403 PERMISSION_DENIED` | **PASS** |
