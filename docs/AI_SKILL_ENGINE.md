# LedgerAI PH — AI Skill Engine Documentation

## Core Architectural Principle
**"AI IS NOT THE AUTHORITATIVE SOURCE OF TRUTH FOR ACCOUNTING DATA."**

LedgerAI PH remains **offline-first, secure, accounting-first, auditable, role-aware, and modular**.
The authoritative sources of truth remain:
- Database (SQLite / Drizzle ORM)
- Accounting Domain Services
- Philippine Tax Engine (BIR Rules, EOPT Act, 2550Q / 1701Q)
- Audit System
- Workflow & Segregation-of-Duties (SoD) Engine

AI acts strictly as an assistant and orchestrator. AI cannot directly mutate or override accounting records.

---

## 1. Provider Abstraction
- `IAIProvider` interface defines contract for text generation, structured JSON generation, availability checking, and usage metrics.
- `BaseAIProvider` normalizes provider errors (timeouts, rate limits, missing keys).
- `GeminiProvider` implements Google Gemini API using `@google/genai` SDK (`gemini-3.6-flash`).
- Secrets and API keys are strictly server-side (`process.env.GEMINI_API_KEY`) and NEVER exposed to the browser.

---

## 2. AI Skill Registry & Manager
- Centralized `SkillRegistry` manages independent skill definitions.
- Skills define identity, category, required RBAC permissions, required context, risk level, prompt templates, and execution logic.
- `SkillManager` handles:
  - RBAC verification against user permissions before execution.
  - Context building (company-scoped context).
  - Input sanitization against prompt injection.
  - Safe error handling and offline fallbacks.
  - Execution logging to `ai_execution_logs`.

---

## 3. Core Skills (Read-Only)
1. `explainAccount` — Explains account normal balances, usage, and debit/credit rules.
2. `explainJournalEntry` — Analyzes journal entry balance and status.
3. `explainTrialBalance` — Verifies total debits = total credits.
4. `analyzeAccountingAnomaly` — Highlights unposted drafts or unbalanced entries.
5. `explainComplianceRule` — Explains Philippine BIR tax regulations and form requirements.
6. `summarizeDocument` — Summarizes receipt and invoice metadata.
7. `summarizeReport` — Summarizes financial report KPIs (Balance Sheet, P&L).
8. `generalAccountingQuestion` — Answers general bookkeeping and platform navigation questions.

---

## 4. Intent Router
- `IntentRouter` classifies user prompts into available skill IDs.
- Uses Gemini structured output or heuristic fallback for deterministic routing.

---

## 5. Security & Isolation
- **Tenant Isolation**: Context is built strictly using company-scoped queries (`dbContext.getCompanyDb`). Company A users cannot access Company B data.
- **RBAC Enforcement**: Users missing required permissions (e.g. `ACCOUNTING_VIEW`) receive an immediate `403 Permission Denied` error.
- **Mutation Boundary**: All Phase 4 AI skills are `READ_ONLY`. AI cannot create, approve, or post entries.
- **Prompt Injection Defense**: Sanitizes malicious prompt instructions attempting to override system prompts or dump databases.

---

## 6. Audit & Usage Tracking
- Every execution logs: `company_id`, `user_id`, `user_role`, `skill_id`, `provider`, `model`, `status`, `latency_ms`, `tokens`, and summary metadata to `ai_execution_logs`.
- Usage tracking API endpoint: `GET /api/ai/usage`.
