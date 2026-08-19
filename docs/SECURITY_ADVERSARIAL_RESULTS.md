# LEDGERAI PH — ADVERSARIAL SECURITY AUDIT RESULTS

Penetration, Boundary, and Authorization Tests Executed on LedgerAI PH.

---

### Test Scenarios & Results:

1. **Cross-Tenant Entity Access (IDOR)**:
   - *Attempt*: User authenticates with Company A token and queries `/api/customers` or `/api/accounting/journals` with `?companyId=Company_B_ID`.
   - *Result*: **BLOCKED**. Backend route middleware ignores query parameters and enforces `req.activeCompany.id` from the authenticated session context.
   - *Status*: **PASS**

2. **Privilege Escalation (Role Bypass)**:
   - *Attempt*: User with role `DATA_ENTRY` sends `POST /api/users` or `POST /api/licensing/authority/generate-key`.
   - *Result*: **BLOCKED** with `403 Forbidden` (`Insufficient role permissions`).
   - *Status*: **PASS**

3. **Cryptographic License Tampering**:
   - *Attempt*: User modifies the JSON payload in a `.lai` license file (e.g. changes `plan` from `PRO` to `ENTERPRISE` or extends `validUntil`) while keeping the original RSA signature.
   - *Result*: **BLOCKED**. Verification fails with `Invalid cryptographic signature or tampered license data`.
   - *Status*: **PASS**

4. **Replay & Cross-Company License Application**:
   - *Attempt*: License generated for `Company_A` attempted on `Company_B`.
   - *Result*: **BLOCKED**. License engine validates that `payload.companyId === activeCompany.id`.
   - *Status*: **PASS**

5. **AI Assistant Boundary Protection**:
   - *Attempt*: Prompt injection to Ledger Agent requesting database dumps or cross-company records.
   - *Result*: **BLOCKED**. AI execution engine scopes all RAG context strictly within the active company's database session and rejects requests outside of authorized capabilities.
   - *Status*: **PASS**

6. **Source Code & Secrets Audit**:
   - *Attempt*: Search for unmasked API keys, RSA private keys, or plaintext database passwords committed to the repository.
   - *Result*: **CLEAN**. `.env.example` provides parameter definitions with empty values; private signing key is maintained only on the Authority instance.
   - *Status*: **PASS**
