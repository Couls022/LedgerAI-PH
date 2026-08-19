# LedgerAI PH - Security Plan

## 1. Authentication
*   **Mechanism**: Local credential-based authentication using hashed passwords (bcrypt/Argon2).
*   **Session Management**: HTTP-only, secure cookies (or secure JWTs stored in memory/HTTP-only cookies) to prevent XSS exfiltration.
*   **Offline Capability**: Auth runs entirely against the local SQLite database. No external identity providers required for core access.

## 2. Authorization & RBAC
*   **Roles**: Define strict roles (`SUPER_ADMIN`, `COMPANY_ADMIN`, `ACCOUNTANT`, `VIEWER`, etc.).
*   **Permissions Matrix**: Granular permissions (e.g., `accounting:post`, `tax:edit`).
*   **Middleware Enforcement**: All Express API routes MUST pass through an RBAC middleware that verifies:
    1. The user has a valid session.
    2. The user belongs to the requested `company_id`.
    3. The user holds the necessary permissions for the endpoint's action.

## 3. Data Isolation (Multi-Tenancy)
*   **Never Trust the Client**: The frontend must send `company_id` via headers or URL parameters, but the backend must verify the user's membership to that company before executing ANY query.
*   **Query Scoping**: Database calls must strictly scope to `company_id`.

## 4. Immutable Audit Log
*   Every state-changing API request (POST, PUT, DELETE) must trigger an asynchronous write to the `audit_logs` table.
*   Logs must capture the User ID, Company ID, Action, Entity, and a JSON diff of the before/after state.
*   Audit logs cannot be updated or deleted through the application interface.

## 5. Security Hardening
*   **Input Validation**: Use `zod` schemas for all incoming API payloads to prevent injection and malformed data.
*   **SQL Injection**: Prevented inherently by using Drizzle ORM parameterized queries.
*   **XSS Protection**: React escapes rendering by default. API responses must enforce correct `Content-Type` headers.
*   **Network**: The server runs locally, but binding to `0.0.0.0` exposes it to the LAN. TLS/HTTPS is recommended if deployed beyond an isolated LAN.
