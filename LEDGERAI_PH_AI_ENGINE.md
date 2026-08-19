# LedgerAI PH - AI Engine Architecture

## 1. Overview
The AI Business Assistant (powered by the Gemini API) is a read-only, analytical, and advisory layer sitting on top of the deterministic accounting and tax engines. It does NOT perform core financial calculations or write to the database directly.

## 2. Abstraction & Provider
The system uses a Provider pattern (e.g., `GeminiProvider`) to allow flexibility. API keys are strictly managed on the local server via `.env` and are never exposed to the client browser.

## 3. Skill & Tool Manager
The AI operates using a "Skill Manager" that provides constrained, functional tools it can call.
- **Read-Only Tools**: `query_account_balance`, `get_tax_deadline`, `summarize_compliance_findings`.
- **Workflow Tools**: If the AI needs to create a record, it uses a tool that prepares a *draft* (e.g., `prepare_draft_journal_entry`). The actual creation requires explicit human approval through the standard UI.

## 4. Graceful Degradation (Offline Mode)
Because LedgerAI PH is offline-first, if the internet connection is lost, the AI Assistant module will display a controlled "Offline Mode" state. Core accounting functionality remains 100% operational.

## 5. Security & Context
The AI is scoped strictly to the current user's authenticated `company_id`. It cannot query or reason about data outside the active tenant's context.
