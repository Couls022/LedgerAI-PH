# LEDGERAI PH — LICENSE PAIR ARCHITECTURE, COVERAGE MATRIX & SECURITY SPECIFICATION

**Document Version:** 2.0 (Browser-First & Dual-File One-Time Company-Bound Licensing)  
**Date:** 2026-11-26  
**Authoritative Standard:** RSA-SHA256 Pair Signatures + Canonical SHA-256 Pair Digest + HMAC Trusted Registry  

---

## 1. Browser-First Architecture

LedgerAI PH operates strictly as a browser-based ERP workstation served by a local application server:
- **Primary Client UI:** Supported modern web browsers connecting via `http://localhost:<port>` or `http://<host-ip>:<port>`.
- **Zero Per-Company EXE Requirement:** Creating, opening, switching, or restoring company workspaces never generates or requires per-company `.exe` launcher executables (`CompanyLauncherGenerator` is decoupled from company lifecycle flows).
- **Server-Side Authority:** All SQLite database access (`LAISENC2` encryption), licensing validation, cryptographic pair redemption, and anti-rollback clock enforcement reside exclusively on the local server. Browser `localStorage`, `sessionStorage`, and client JavaScript hold zero private signing keys or authoritative license status.

---

## 2. Dual-File License Pair Specification

Both separate files are **strictly mandatory** for activation. One file alone is never accepted.

| Artifact Slot | UI Field Name | Placeholder | Accepted Type | Payload `artifactType` | Purpose |
|---|---|---|---|---|---|
| **File A** | `License Key File` | `Select the authorized License Key File` | `.lkey` | `LEDGERAI_LICENSE_KEY_FILE` | Authoritative key identity, pair IDs, activation key string, target company ID, `pairDigest`, and Authority RSA-SHA256 signature. |
| **File B** | `Key License File` | `Select the corresponding Key License File` | `.lai` | `LEDGERAI_KEY_LICENSE_FILE` | Signed license authorization, tier entitlement (`PRO` / `ENTERPRISE`), seat limits, expiration policy, `recoveryReference`, `pairDigest`, and Authority RSA-SHA256 signature. |

### Shared Pair Binding Fields
Every issued pair binds both payloads using:
- `licensePairId`: Immutable UUID pair identifier (`PAIR-...`)
- `licenseId`: Unique license record UUID
- `keyFileId`: Unique key-file identifier (`KEYF-...`)
- `companyId`: Immutable target company ID (`LGR-PH-...`)
- `planType` & `expirationDate`
- `issuerIdentity`: `'LEDGERAI-PH-AUTHORITY'`
- `licenseVersion`: `'2.0'`
- `activationPolicy`: `'ONE_TIME_COMPANY_BOUND'`
- `revocationRef`: `'rev-<licensePairId>'`
- `pairDigest`: `SHA-256(licensePairId | licenseId | keyFileId | companyId | planType | expirationDate | issuedAt)`

---

## 3. One-Time Redemption & Persistence Matrix

| Component | Source File | Responsibility |
|---|---|---|
| **Offline Authority Signer** | [signer.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/internal/key-generator/signer.ts) | `generateSignedLicensePair()` signs both `.lkey` and `.lai` payloads independently using Authority RSA Private Key. |
| **Key Generator CLI & API** | [index.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/internal/key-generator/index.ts), [routes.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/internal/authority-server/routes.ts) | Tracks lifecycle `ISSUED -> REDEEMED -> ACTIVE` (and `EXPIRED`, `REVOKED`, `SUSPENDED`, `RECOVERY_REQUIRED`), issues `.lkey` + `.lai`, handles recovery issuance (`/authority/licenses/:id/recover`) and suspension (`/suspend`). |
| **Authority Web Console** | [LicenseAuthorityApp.tsx](file:///C:/Users/Couls/antigravity/LedgerAI-PH/internal/authority-ui/LicenseAuthorityApp.tsx) | Auto-downloads both `.lkey` and `.lai` on issuance and provides individual download controls per tenant row. |
| **Client Pair Verifier** | [verify.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/licensing/verify.ts) | `validateLicenseFilePair()` uses public key ring only (`RSA_PUBLIC_KEY` / rotated keys) to verify signatures, `artifactType`, `pairDigest`, and `companyId`. |
| **Trusted Local Licensing Registry** | [localLicenseRegistry.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/licensing/localLicenseRegistry.ts) | Stores HMAC-sealed redeemed pair bindings (`trusted-license-registry.json`) in host config vault; blocks cross-company reuse, replay across rolled-back DBs, and unauthorized replacement. |
| **Company DB Schema & Migration** | [schema.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/db/schema.ts), [migrationManager.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/services/migrationManager.ts) | Migration `v22` adds pair metadata columns to `company_licenses` and creates `license_redemption_records`. |
| **Auth Guard & Status/Activate APIs** | [auth.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/auth.ts), [licensingAndLan.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/routes/licensingAndLan.ts) | `validateActiveLicenseForCompany()`, `GET /api/licensing/status`, `POST /api/licensing/activate`, `POST /api/licensing/recover`. Enforces fail-closed validation and monotonic anti-rollback clock. |
| **Backup & Restore Preservation** | [restoreService.ts](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/server/services/restoreService.ts) | Preserves signed activation receipt & dual-file records when restoring the same company; blocks cloned companies (`cloneAsNew`) from acquiring source company licenses. |
| **Browser Activation UI** | [LicenseActivation.tsx](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/client/components/licensing/LicenseActivation.tsx), [LicensingBanner.tsx](file:///C:/Users/Couls/antigravity/LedgerAI-PH/src/client/components/licensing/LicensingBanner.tsx) | Strict two-file input screen (`License Key File`, `Key License File`), disabled `Activate License` button until both files are selected, and all 13 UI status states. |

---

## 4. Offline Security Limitation & Safeguards

In a completely air-gapped / offline installation with zero network connectivity to the central Authority Server, a disconnected local registry cannot observe a pair redeemed independently on a separate air-gapped machine. Within any single server and its connected LAN clients, LedgerAI PH enforces:
1. Immutable Company ID binding (`LGR-PH-...`).
2. Local HMAC-sealed redemption tracking (`trusted-license-registry.json`) + per-company `license_redemption_records`.
3. Detection of pre-activation DB replay restores and registry checksum tampering.
4. Anti-rollback monotonic clock timestamps (`.time_state.bin`).
5. Controlled Authority-signed `recoveryReference` checks for legitimate host/database recovery.
