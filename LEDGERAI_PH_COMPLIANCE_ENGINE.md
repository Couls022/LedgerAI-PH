# LedgerAI PH - Compliance Engine Architecture

## 1. Overview
The Philippine BIR Compliance Engine acts as an automated auditor that runs asynchronously or synchronously alongside transactions. It evaluates data against a configured set of BIR compliance rules.

## 2. Rule Evaluation
The compliance engine hooks into the lifecycle of transactions and master data:
- **TIN Validation**: Checks the format and presence of Tax Identification Numbers for vendors and customers based on BIR formatting rules.
- **Document Completeness**: Verifies that transactions meeting certain thresholds (e.g., VATable expenses) have an attached digital document (receipt/invoice).
- **Tax/Accounting Reconciliation**: Compares the derived VAT on an invoice with the recorded Journal Entry lines to flag discrepancies.

## 3. Finding Severities
- `FAIL`: Prevents posting or approval (e.g., Unbalanced entry, missing mandatory BIR fields).
- `WARNING`: Allows progression but requires review (e.g., Missing optional TIN).
- `REVIEW_REQUIRED`: An anomaly detected that needs a human eye (e.g., Duplicate invoice number).

## 4. Resolution Workflow
Findings are stored in the `compliance_findings` table. A user with appropriate permissions can resolve a finding by correcting the underlying data or explicitly dismissing it with a documented reason, which is written to the audit log.
