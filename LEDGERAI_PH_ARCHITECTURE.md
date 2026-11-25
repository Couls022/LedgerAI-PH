# LedgerAI PH - System Architecture

## 1. Overview
LedgerAI PH is designed as a standalone, offline-first accounting, compliance, and document management platform. It operates via a local server architecture, allowing access from browsers over a Local Area Network (LAN).

## 2. Core Architectural Principles
*   **Offline-First**: All core functionalities (accounting, tax, RBAC, etc.) execute entirely locally without requiring internet access.
*   **Local Server Deployment**: A single Node.js instance serves both the API and the React frontend.
*   **Modular Monolith**: The codebase is logically divided into domain-specific modules (`accounting`, `tax`, `audit`, etc.) to enforce strict boundaries and prevent business logic from leaking into UI components.
*   **Multi-Tenancy**: Strict company-level data isolation via `company_id` enforcement at the database abstraction layer.

## 3. Technology Stack
*   **Runtime**: Node.js
*   **Backend**: Express.js (REST API, Role-based middleware, Domain services)
*   **Database**: SQLite (via `better-sqlite3` or `libsql`) for robust local, file-based relational data storage.
*   **ORM**: Drizzle ORM for type-safe schema definitions, migrations, and query building.
*   **Frontend**: React 19, Vite, Tailwind CSS, Lucide React (Icons).
*   **AI Integration**: `@google/genai` (Server-side, graceful degradation when offline).
*   **OCR**: Local OCR engine (e.g., Tesseract.js) for offline receipt/invoice scanning.

## 4. System Topography
```text
[ Browser Clients (LAN/Localhost) ]
        |
        v (HTTP/REST via Port 3000)
[ Express Server (server.ts) ]
        |-- API Router
        |-- Auth & RBAC Middleware
        |-- Tenant Isolation Layer
        |
        +-- [ Domain Modules ]
             |-- Accounting Engine (Double-entry validation, Ledger)
             |-- Tax Engine (PH tax rules, VAT, Withholding)
             |-- Compliance Engine
             |-- Document & OCR Engine
             |-- AI Business Assistant (Tools & Routing)
             |-- Audit Logger
        |
        +-- [ Database Access (Drizzle ORM) ]
             |-- local_database.sqlite
```

## 5. Directory Structure Strategy
We will transition the current Vite template into a full-stack modular monolith:
*   `server.ts`: Entry point for Express API and Vite middleware.
*   `src/server/`: Backend modules, API routes, middleware.
*   `src/server/modules/`: Domain-specific business logic (accounting, tax, auth).
*   `src/server/db/`: Database schemas, connections, and migrations.
*   `src/client/`: React frontend components, pages, hooks, and API clients.
*   `src/shared/`: Shared TypeScript types, enums, and validation schemas (Zod).

## 6. Offline vs Online Modes
*   **Offline (Default)**: Full accounting, DB reads/writes, local OCR, rule-based compliance, local RBAC, and local PDF generation.
*   **Online (Optional)**: Cloud backup sync, Gemini AI Assistant processing, tax rate updates. When offline, AI features will display a controlled "Offline Mode" state.
