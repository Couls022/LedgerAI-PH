# LedgerAI PH - Test Plan

## 1. Testing Strategy
Given the critical nature of financial data, testing must be rigorous and automated where possible.

## 2. Unit Testing
*   **Domain Logic**: The core accounting engine, tax calculator, and compliance evaluator must have 100% test coverage.
*   **Accounting Validations**:
    *   Test: Ensure a journal entry with unequal debits and credits throws a specific error.
    *   Test: Ensure negative debits/credits are rejected.
    *   Test: Ensure posting to a closed accounting period is rejected.
*   **Tax Calculations**: Test standard PH VAT calculations, mixed income logic, and withholding tax derivations.

## 3. Integration Testing
*   **API Layer**: Test API endpoints with mock authentication to verify input validation, correct status codes, and expected JSON responses.
*   **Database Integration**: Spin up in-memory SQLite instances to test complex queries (e.g., Trial Balance aggregation, General Ledger filtering).

## 4. Multi-Tenant Security Testing
*   **Isolation Tests**:
    *   Authenticate as User A in Company A.
    *   Attempt to access/modify a record ID belonging to Company B.
    *   Expect: 403 Forbidden or 404 Not Found.
*   **Role Tests**: Ensure a `VIEWER` role receives a 403 Forbidden when attempting to POST a journal entry.

## 5. End-to-End (E2E) & Manual Testing
*   **Offline Mode**: Disconnect the host machine from the internet. Verify login, ledger viewing, and report generation continue to function.
*   **LAN Connectivity**: Start the server on Machine A. Connect via browser from Machine B on the same network. Verify real-time responsiveness and session stability.
*   **Concurrency**: Simulate two users attempting to post/modify the same journal entry simultaneously.

## 6. Audit & Compliance Checks
*   Verify that performing a critical action (e.g., Reversing an entry) generates the corresponding exact log in the audit trail system.
