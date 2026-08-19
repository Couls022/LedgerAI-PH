# LedgerAI PH - Implementation Plan

This document outlines the phased build order for LedgerAI PH.

## PHASE 0: Project Architecture and Setup
*   Initialize full-stack structure (`server.ts`).
*   Configure build scripts for Express + Vite.
*   Set up modular directory structure.

## PHASE 1: Database and Migration System
*   Install SQLite and Drizzle ORM.
*   Define initial schemas for System, Users, and Companies.
*   Establish migration pipeline.

## PHASE 2: Authentication and Authorization
*   Implement secure local auth (bcrypt hashing).
*   Session/JWT management.
*   RBAC middleware (Super Admin, System Admin, etc.).

## PHASE 3: Multi-Company and Multi-User Foundation
*   Company isolation middleware (tenant context).
*   User-Company mapping and role assignment.

## PHASE 4: Accounting Domain & Double-Entry Engine
*   Chart of Accounts (COA) schema and default PH templates.
*   Double-entry validation engine (Debits = Credits).

## PHASE 5: Journal, Posting, Ledger, Trial Balance
*   Journal Entry creation and posting workflow.
*   General Ledger and Trial Balance derivation logic.

## PHASE 6: AR/AP/Cash/Bank/Sales/Purchases/Expenses
*   Subsidiary ledgers.
*   Invoicing, receipting, and cash management modules.

## PHASE 7: Inventory and Fixed Assets
*   Asset tracking, depreciation scheduling, inventory valuation.

## PHASE 8: Philippine Tax Engine
*   Configurable tax rules (VAT, Non-VAT, Withholding).
*   Calculation engine decoupled from UI.

## PHASE 9: Compliance Rule Engine
*   Rule evaluator for TIN validation, missing data, and unbalanced anomalies.

## PHASE 10: Document Management
*   Local file storage architecture.
*   Linking documents to journals and transactions.

## PHASE 11: OCR Engine
*   Local offline OCR integration for receipts/invoices.

## PHASE 12: Reporting Engine
*   Financial Statements (Balance Sheet, Income Statement, Cash Flow).

## PHASE 13: Audit Platform
*   Immutable audit logging system for all financial and system operations.

## PHASE 14: Workflow and Approval Engine
*   Configurable state machines for document/transaction approvals.

## PHASE 15: AI Business Assistant
*   Gemini API integration with tool-calling for read-only analytics and guided assistance.

## PHASE 16: License Engine
*   Offline cryptographic license verification.

## PHASE 17: Backup/Restore
*   Local SQLite database snapshotting and file archiving.

## PHASE 18: LAN Browser Access & Configuration
*   Network binding (0.0.0.0:3000) verification and security hardening.

## PHASE 19: Windows Standalone Preparation
*   Packaging scripts and execution guidelines.

## PHASE 20: QA, Security Audit, and Hardening
*   E2E testing, multi-tenant leakage tests, accounting integrity validation.
