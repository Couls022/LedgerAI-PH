# LEDGERAI PH — PRODUCTION AUTHORITY KEY LIFECYCLE & DISTRIBUTION ARTIFACT AUDIT (`v1.0.0-rc.1-remediated`)

**Document Authority**: Canonical Authority Key Lifecycle, Rotation, Revocation & Distribution Artifact Security Audit  
**Target Modules**: `src/server/licensing/verify.ts`, `src/server/licensing/crypto.ts`, `internal/key-generator/signer.ts`  
**Verification Suites**: `tests/licensing/licensingLifecycle.test.ts` (8 tests), `tests/licensing/installersVerification.test.ts` (9 tests), `tests/licensing/lrqWorkflow.test.ts` (6 tests)  
**Audit Date**: November 7, 2026  
**Verification Evidence Classification**: `AUTOMATED_TEST_VERIFIED`, `RUNTIME_VERIFIED` & `SOURCE_INSPECTED`

---

## 1. Executive Summary of the Authority Key Lifecycle

Section 5 and Section 6 of the Final Pre-Production Gate require strict cryptographic and operational separation between the development/test authority signing key (`LGR-AUTH-KEY-DEV-2026-V1` in `internal/key-generator/signer.ts`) and commercial production signing keys, alongside a complete scan of all customer distribution artifacts (`dist/`).

### Key Governance Controls Implemented & Verified

1. **Strict Separation of Signing (`internal/key-generator/`) vs. Verification (`src/server/licensing/`)**:
   - Customer builds (`src/server/licensing/verify.ts` and `src/server/licensing/crypto.ts`) contain **only** public-key verification logic (`crypto.createVerify('SHA256')`).
   - All private-key signing logic (`signLicense`, `createSign`) was removed from `src/server/licensing/crypto.ts` so `src/` has zero signing capability.
2. **Explicit Classification of `DEFAULT_AUTHORITY_PRIVATE_KEY` (`LGR-AUTH-KEY-DEV-2026-V1`)**:
   - Tagged with `keyId: 'LGR-AUTH-KEY-DEV-2026-V1'`, `keyVersion: 1`, and `environment: 'DEVELOPMENT_TEST_ONLY'`.
   - Public Key SHA-256 Fingerprint (`computePublicKeyFingerprint(RSA_PUBLIC_KEY)`): auditable and tracked in the Authority Public Key Ring (`getAuthorityPublicKeyRing()`).
3. **Production Enforcement Gate (`LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY=true`)**:
   - When `LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY=true` or `LEDGERAI_AUTHORITY_MODE=PRODUCTION`:
     - `AuthoritySigner.getPrivateKey()` **refuses** to fall back to `DEFAULT_AUTHORITY_PRIVATE_KEY` and throws `PRODUCTION_SIGNING_KEY_REQUIRED: Refusing to sign with development/test authority key LGR-AUTH-KEY-DEV-2026-V1 when production key enforcement is active.`
     - `verifyLicense()` **rejects** any license signed by a `DEVELOPMENT_TEST_ONLY` key (`LGR-AUTH-KEY-DEV-2026-V1`) and accepts **only** active `PRODUCTION` public keys.
4. **Multi-Version Public Key Ring, Seamless Key Rotation & Explicit Revocation**:
   - `registerAuthorityPublicKey(...)` and `getAuthorityPublicKeyRing()` maintain a versioned public key ring (`keyId`, `keyVersion`, `environment`, `status: 'ACTIVE' | 'RETIRED' | 'REVOKED'`, `sha256Fingerprint`, `effectiveFrom`, `retiredAt`, `revokedAt`).
   - `revokeAuthorityKeyId(keyId, reason)` and `LEDGERAI_REVOKED_AUTHORITY_KEY_IDS` immediately block both signing (`REVOKED_SIGNING_KEY`) and verification (`false`) for any revoked key ID while preserving verification for licenses signed by active rotated keys (`LGR-AUTH-KEY-PROD-2026-V2`).
5. **Zero Logging of Private Key Material**:
   - `AuthoritySigner` never logs or prints `privateKey` contents or raw JSON key files on parse errors, and maintains an in-memory signing audit log (`getKeyUsageAuditHistory()`) recording `{ timestamp, keyId, keyVersion, environment, companyId, licenseId, action }`.

---

## 2. Production Key Provisioning Assessment & Commercial Release Blocker

Per Section 5: *"Do not assume environment variables alone provide secure private-key storage. Evaluate the actual provisioning mechanism for production use... If a secure production key cannot be provisioned in the current environment, keep commercial production distribution blocked."*

### Evaluation of Current vs. Target Production Key Storage

| Storage / Provisioning Mechanism | Security Evaluation | Allowed Usage | Current Status |
|:---|:---|:---|:---:|
| **Committed Source Fallback (`DEFAULT_AUTHORITY_PRIVATE_KEY` in `internal/key-generator/signer.ts`)** | **INSECURE FOR PRODUCTION**: Exposed in repository history. Anyone with source access can mint test licenses if trusted in production. | Automated Vitest suites & isolated local sandbox only (`DEVELOPMENT_TEST_ONLY`). | **RESTRICTED TO DEV/TEST** |
| **Plaintext Process Environment Variable (`LICENSE_PRIVATE_KEY` / `LEDGERAI_AUTHORITY_PRIVATE_KEY`)** | **INSUFFICIENT ALONE FOR PRODUCTION**: Readable via `/proc/<pid>/environ` on Linux or process inspection tools on Windows if not backed by an OS secret store or HSM. | CI/CD ephemeral test runners or container secret mounts with restricted process namespace. | **NOT SUFFICIENT FOR COMMERCIAL CA** |
| **Dedicated Air-Gapped Authority Vault / HSM / Windows DPAPI-Protected Key Store (Target Production Architecture)** | **REQUIRED FOR COMMERCIAL PRODUCTION**: Offline Authority Key Generator host (`127.0.0.1:4000`) using PKCS#11 Hardware Security Module (YubiHSM 2 / Thales Luna) or Windows CNG/DPAPI `LocalMachine` key storage with NTFS `SYSTEM`/Authority-Admin DACL. | Commercial customer license issuance (`LGR-AUTH-KEY-PROD-2026-V2`). | **`EXTERNAL_VALIDATION_PENDING` / `BLOCKED` IN CONTAINER** |

- **Governance Decision**: Because the Google AI Studio Linux container is a shared development/build environment without a dedicated hardware security module (HSM) or air-gapped production signing vault, **commercial production key provisioning remains `BLOCKED` / `EXTERNAL_VALIDATION_PENDING`**. No production private key has been generated or exposed in this workspace.

---

## 3. Complete Distribution Artifact Scan (Section 6)

All distributable customer build artifacts, source maps, renderer assets, migrations, and packaging manifests were scanned for literal, encoded, or serialized private key markers and internal authority routes:

| Artifact / File Path | Artifact Type | Literal & Encoded Private Key Scan (`BEGIN (RSA )?PRIVATE KEY`, PKCS#8 header `MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKg`) | Authority Signer / Route Scan (`AuthoritySigner`, `DEFAULT_AUTHORITY_PRIVATE_KEY`, `/api/authority`, `LicenseAuthorityApp`) | Status |
|:---|:---|:---:|:---:|:---:|
| `dist/server.cjs` | Bundled Express API Server (`2.3 MB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/server.cjs.map` | Server Source Map (`3.8 MB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/main.cjs` | Electron Main Process (`8.4 KB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/main.cjs.map` | Electron Main Source Map (`11.9 KB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/preload.cjs` | Electron Context-Isolated Preload (`1.1 KB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/preload.cjs.map` | Electron Preload Source Map (`1.1 KB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/assets/index-BP_7l3mJ.js` | Customer React Renderer Bundle (`3.97 MB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/assets/index-3H7TEryw.css` | Customer Compiled Stylesheet (`206.9 KB`) | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `dist/migrations/**/*` | Bundled Drizzle SQL Migrations | `0` matches | `0` matches | **PASS (`CLEAN`)** |
| `electron-builder.json` & `electron-builder.client.json` | Customer NSIS Packaging Configs | Enforces `"!internal/**/*"` | Excludes `internal/key-generator` & `internal/authority-*` | **PASS (`CLEAN`)** |
