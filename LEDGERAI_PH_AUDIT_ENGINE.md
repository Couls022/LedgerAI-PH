# LedgerAI PH - Audit Engine Architecture

## 1. Overview
The Audit Engine provides an immutable, comprehensive log of all significant activities within the LedgerAI PH system. It is designed to be read-only for auditors and administrators to trace the "who, what, when, and where" of financial data modifications.

## 2. Immutability
Audit logs are written to the database (and optionally to flat files for offline backup integrity) and cannot be deleted or modified through the application.

## 3. Scope of Auditing
The engine captures:
- **Authentication Events**: Logins, logouts, failed login attempts.
- **Data Modifications**: Any `INSERT`, `UPDATE`, or `DELETE` on critical tables (journal entries, tax rules, user roles, company settings).
- **State Changes**: Approvals, rejections, postings, and reversals.
- **Administrative Actions**: Role changes, permission updates, tax rule modifications.

## 4. Log Structure
Each audit entry includes:
- `id`: UUID
- `timestamp`: UTC Timestamp
- `company_id`: Tenant context
- `user_id`: The actor performing the action
- `action`: E.g., `UPDATE_JOURNAL_ENTRY`
- `entity_type`: E.g., `journal_entries`
- `entity_id`: The ID of the modified record
- `before_state`: JSON representation of the data before the change (if applicable)
- `after_state`: JSON representation of the data after the change
- `ip_address` / `session_id`: Network context (if available)

## 5. Audit Dashboard
A dedicated interface allows filtering by date range, user, action type, or entity ID, enabling rapid reconstruction of a transaction's history.
