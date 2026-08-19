# LEDGERAI PH — PRODUCTION FREEZE MANIFEST

**Freeze Date**: August 2026  
**Application Version**: `1.0.0-rc.1`  
**State**: Source Code Frozen — Release Candidate 1.0  
**Verification Level**: All Application Subsystems Verified; Windows Native Installer Execution Pending Windows Host.

---

## 1. Subsystem Verification Status

| Subsystem | Audit Status | Primary Guarantees |
|:---|:---|:---|
| **Accounting Core** | **LOCKED — VERIFIED** | `Debits == Credits` strictly enforced; posted journals immutable; period locking verified. |
| **Philippine Tax Suite** | **LOCKED — VERIFIED** | 12% VAT, Section 116 Percentage Tax, TRAIN 8% option, CREATE CIT, and EWT Form 2307. |
| **Licensing Engine** | **LOCKED — VERIFIED** | RSA-2048 signing; public key client runtime; live UI synchronization via custom events. |
| **Offline Key Authority** | **LOCKED — VERIFIED** | Hardware fingerprinting; plan tier assignment; export of `.lai` license files. |
| **Multi-Tenant Security** | **LOCKED — VERIFIED** | Strict `req.activeCompany.id` resolution; zero cross-tenant IDOR vulnerabilities. |
| **Role-Based Access Control** | **LOCKED — VERIFIED** | 8 tiers enforced server-side; direct API attempts return `403 Forbidden`. |
| **Document Vault & OCR** | **LOCKED — VERIFIED** | Tenant-scoped storage; MIME verification; line-item extraction with pre-posting review. |
| **Backup & Restoration** | **LOCKED — VERIFIED** | Checksum validation; atomic transactional rollback; zero data loss. |
| **Windows Desktop Wrapper** | **READY (BUILD SCRIPT)** | Electron main/preload bundled; native packaging script in `packaging/windows/`. |

---

## 2. Freeze Rules & Release Separation

1. **Code Freeze**: No further functional or schema alterations are permitted without an approved RFC.
2. **Client Packaging Rule**: The packaged client application must bundle **only the RSA Public Key** and **zero private keys or database passwords**.
3. **Data Boundary Rule**: The production distribution package contains only empty schema definitions, Philippine standard COA templates, and default role catalogs. Real tenant databases are generated dynamically on first boot.
