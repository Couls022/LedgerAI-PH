# LedgerAI PH — Native Folder Picker Coverage Matrix

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/client/services/nativeFolderPickerService.ts`, `electron/main.ts`, `electron/preload.ts`, `src/server/routes/companies.ts` (`POST /api/companies/validate-folder`)

---

## 1. System-Wide Folder Picker Architecture

Custom in-app folder browser modals (`DirectoryExplorerModal.tsx`) have been permanently removed across the entire application. Every directory-selection action routes through `NativeFolderPickerService.selectDirectory(...)`:

| Module / Screen | Purpose | Native OS Dialog Trigger | Remote LAN Browser Behavior | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| Create Company (`CreateProfile.tsx`) | Select local data folder (Standalone / Server Console) | `window.electronAPI.selectDirectory()` via Electron IPC (`dialog.showOpenDialog`) | Server-managed storage; no raw server filesystem browsing | IMPLEMENTED AND VERIFIED (IPC & API); Native Windows Explorer UI: BLOCKED BY EXECUTION ENVIRONMENT |
| Open Existing Profile (`OpenProfile.tsx`) | Browse & locate company workspace folder | `NativeFolderPickerService.selectDirectory({ purpose: 'OPEN_COMPANY' })` | Hidden on non-loopback LAN clients (`isLocalHost` guard) | IMPLEMENTED AND VERIFIED |
| Restore Backup (`RestoreProfile.tsx`) | Choose extraction destination folder | `NativeFolderPickerService.selectDirectory({ purpose: 'RESTORE_DESTINATION' })` | Uses server-managed default destination when accessed via browser | IMPLEMENTED AND VERIFIED |
| Backup & Storage Settings (`Settings.tsx` / `BackupManager.tsx`) | Choose custom backup/storage folder | `NativeFolderPickerService.selectDirectory()` | Admin server-managed path protection | IMPLEMENTED AND VERIFIED |
| Non-Mutating Folder Validation | `POST /api/companies/validate-folder` | Validates readability, writability, disk space without creating stray folders or company records | Localhost/authenticated admin only | IMPLEMENTED AND VERIFIED |

## 2. Cancellation & Error Guarantees

- Clicking **Cancel** in the native OS dialog returns `{ status: 'CANCELLED' }` and preserves the existing selected path untouched.
- When invoked from a standard web browser without Electron preload, returns `{ status: 'UNSUPPORTED_RUNTIME' }` with clear guidance — never falls back to a fabricated custom modal.
