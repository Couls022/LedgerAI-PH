import {
  DirectoryValidationResult,
  FolderPathResolutionMode,
  FolderSelectionPurpose,
  PURPOSE_DEFAULT_TITLES,
  PickedFolderSummary,
  SelectDirectoryOptions,
  SelectDirectoryResult,
  SelectFileOptions,
  SelectFileResult,
  buildMappedDestinationPath,
  normalizeDirectoryPath,
  sanitizePickedFolderName,
  summarizePickedFiles,
  validateDirectoryPathSyntax,
} from '../../shared/folderPickerTypes';

export interface ElectronPickerBridge {
  isElectron?: boolean;
  platform?: string;
  selectDirectory?: (options?: SelectDirectoryOptions) => Promise<SelectDirectoryResult>;
  selectFile?: (options?: SelectFileOptions) => Promise<SelectFileResult>;
  selectFolder?: (options?: { title?: string; defaultPath?: string; buttonLabel?: string }) => Promise<string | null>;
  getAppPaths?: () => Promise<{
    userData: string;
    documents: string;
    appPath: string;
    defaultCompaniesRoot: string;
  }>;
}

export interface BrowserDirectoryHandleLike {
  name: string;
  kind?: 'directory';
  values?: () => AsyncIterable<{ name: string; kind: string }>;
}

export interface BrowserWindowLike {
  self?: unknown;
  top?: unknown;
  isSecureContext?: boolean;
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }) => Promise<BrowserDirectoryHandleLike>;
  addEventListener?: (type: string, listener: (...args: any[]) => void, options?: any) => void;
  removeEventListener?: (type: string, listener: (...args: any[]) => void) => void;
}

export interface BrowserDocumentLike {
  createElement: (tagName: string) => any;
  body?: {
    appendChild: (node: any) => any;
    removeChild?: (node: any) => any;
  } | null;
}

export interface NativeFolderPickerCapabilities {
  isElectronDesktop: boolean;
  supportsShowDirectoryPicker: boolean;
  supportsWebkitDirectory: boolean;
  isInsideIframe: boolean;
  canOpenNativeFolderDialog: boolean;
}

export interface NativeFolderPickerDeps {
  getBridge?: () => ElectronPickerBridge | undefined;
  fetchImpl?: typeof fetch;
  windowImpl?: BrowserWindowLike | null;
  documentImpl?: BrowserDocumentLike | null;
}

const defaultGetBridge = (): ElectronPickerBridge | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as any).electronAPI as ElectronPickerBridge | undefined;
};

const PURPOSE_PICKER_IDS: Record<FolderSelectionPurpose, string> = {
  COMPANY_DATA: 'ledgerai-company-data',
  BACKUP: 'ledgerai-backup-folder',
  DOCUMENT_STORAGE: 'ledgerai-document-storage',
  RESTORE_DESTINATION: 'ledgerai-restore-destination',
  OPEN_COMPANY: 'ledgerai-open-company',
  ARCHIVE_DESTINATION: 'ledgerai-archive-destination',
  IMPORT_SOURCE: 'ledgerai-import-source',
  EXPORT_DESTINATION: 'ledgerai-export-destination',
  OCR_INPUT: 'ledgerai-ocr-input',
  DIAGNOSTICS_EXPORT: 'ledgerai-diagnostics-export',
  AI_KNOWLEDGE_BASE: 'ledgerai-ai-kb',
  GENERAL: 'ledgerai-folder',
};

function detectInsideIframe(win: BrowserWindowLike | null | undefined): boolean {
  if (!win) return false;
  try {
    return Boolean(win.top && win.self && win.self !== win.top);
  } catch {
    // Accessing win.top across origins throws SecurityError — definitely inside a cross-origin iframe
    return true;
  }
}

function detectWebkitDirectorySupport(doc: BrowserDocumentLike | null | undefined): boolean {
  if (!doc || typeof doc.createElement !== 'function') return false;
  try {
    const probe = doc.createElement('input');
    return Boolean(probe && ('webkitdirectory' in probe || 'directory' in probe || 'mozdirectory' in probe));
  } catch {
    return false;
  }
}

/**
 * Centralized frontend NativeFolderPickerService.
 * Single enterprise entry point across the entire LedgerAI PH application for OS-native folder/file selection.
 *
 * 3-Tier Native OS Dialog Resolution (NEVER opens a custom in-app folder modal):
 *   1. Electron Desktop: `window.electronAPI.selectDirectory()` -> `dialog.showOpenDialog({ properties: ['openDirectory'] })`
 *   2. Modern Top-Level Browser: `window.showDirectoryPicker()` -> Native OS "Select Folder" dialog (supports empty folders)
 *   3. Universal Browser / Iframe: `<input type="file" webkitdirectory directory multiple />` -> Native OS folder picker dialog
 */
export class NativeFolderPickerController {
  private readonly getBridge: () => ElectronPickerBridge | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly windowImpl: BrowserWindowLike | null | undefined;
  private readonly documentImpl: BrowserDocumentLike | null | undefined;
  private readonly lastHandles = new Map<FolderSelectionPurpose, BrowserDirectoryHandleLike>();
  private isDialogActive = false;

  constructor(deps: NativeFolderPickerDeps = {}) {
    this.getBridge = deps.getBridge || defaultGetBridge;
    this.fetchImpl = deps.fetchImpl || ((input, init) => fetch(input, init));
    this.windowImpl =
      deps.windowImpl !== undefined
        ? deps.windowImpl
        : typeof window !== 'undefined'
          ? (window as unknown as BrowserWindowLike)
          : null;
    this.documentImpl =
      deps.documentImpl !== undefined
        ? deps.documentImpl
        : typeof document !== 'undefined'
          ? (document as unknown as BrowserDocumentLike)
          : null;
  }

  public isDesktopNativePickerAvailable(): boolean {
    const bridge = this.getBridge();
    return Boolean(bridge && (typeof bridge.selectDirectory === 'function' || typeof bridge.selectFolder === 'function'));
  }

  public getCapabilities(): NativeFolderPickerCapabilities {
    const isElectronDesktop = this.isDesktopNativePickerAvailable();
    const isInsideIframe = detectInsideIframe(this.windowImpl);
    const supportsShowDirectoryPicker = Boolean(
      !isInsideIframe && this.windowImpl && typeof this.windowImpl.showDirectoryPicker === 'function'
    );
    const supportsWebkitDirectory = detectWebkitDirectorySupport(this.documentImpl);
    return {
      isElectronDesktop,
      supportsShowDirectoryPicker,
      supportsWebkitDirectory,
      isInsideIframe,
      canOpenNativeFolderDialog: isElectronDesktop || supportsShowDirectoryPicker || supportsWebkitDirectory,
    };
  }

  public isNativeFolderDialogAvailable(): boolean {
    return this.getCapabilities().canOpenNativeFolderDialog;
  }

  public getLastDirectoryHandle(purpose: FolderSelectionPurpose = 'GENERAL'): BrowserDirectoryHandleLike | undefined {
    return this.lastHandles.get(purpose);
  }

  public isDialogOpen(): boolean {
    return this.isDialogActive;
  }

  /**
   * Validates a directory path through deterministic syntax rules and the non-mutating backend
   * `/api/companies/validate-folder` endpoint. Never silently creates directories.
   */
  public async validateDirectory(
    dirPath: string,
    options: Pick<SelectDirectoryOptions, 'purpose' | 'requireWrite' | 'allowNonExistent' | 'minFreeBytes' | 'companyId'> = {}
  ): Promise<DirectoryValidationResult> {
    const syntax = validateDirectoryPathSyntax(dirPath);
    if (!syntax.valid) {
      return syntax;
    }

    try {
      const response = await this.fetchImpl('/api/companies/validate-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          folderPath: syntax.normalizedPath,
          purpose: options.purpose || 'GENERAL',
          requireWrite: options.requireWrite !== false,
          allowNonExistent: Boolean(options.allowNonExistent),
          minFreeBytes: options.minFreeBytes,
          companyId: options.companyId,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (payload && typeof payload.valid === 'boolean') {
        return {
          ...syntax,
          ...payload,
          normalizedPath: payload.normalizedPath || payload.path || syntax.normalizedPath,
        };
      }

      if (!response.ok) {
        return {
          ...syntax,
          valid: false,
          errorCode: payload?.errorCode || payload?.error || 'VALIDATION_ERROR',
          message: payload?.message || `Folder validation failed (HTTP ${response.status}).`,
        };
      }

      return {
        ...syntax,
        valid: true,
        message: 'Folder validated.',
      };
    } catch (err: any) {
      return {
        ...syntax,
        valid: false,
        errorCode: 'VALIDATION_ERROR',
        message: err?.message || 'Unable to verify directory accessibility with server.',
      };
    }
  }

  /**
   * Resolves a browser-picked folder name through the non-mutating backend `/api/companies/resolve-picked-folder`
   * endpoint (with deterministic fallback mapping if offline/test) so destination paths stay valid and secure.
   */
  private async resolveBrowserPickedFolder(params: {
    folderName: string;
    source: 'BROWSER_FSA_API' | 'BROWSER_WEBKITDIRECTORY';
    options: SelectDirectoryOptions;
    sampleFileNames?: string[];
    summary: PickedFolderSummary;
    directoryHandle?: BrowserDirectoryHandleLike;
  }): Promise<SelectDirectoryResult> {
    const { folderName, source, options, sampleFileNames = [], summary, directoryHandle } = params;
    const safeName = sanitizePickedFolderName(folderName);
    if (!safeName) {
      return {
        status: 'ERROR',
        source,
        errorCode: 'INVALID_FOLDER_NAME',
        message: 'The selected folder name could not be read or contains invalid characters.',
      };
    }

    const fallbackMappedPath = buildMappedDestinationPath(safeName, options.defaultPath, '/data/companies');

    if (options.skipServerValidation) {
      const syntax = validateDirectoryPathSyntax(fallbackMappedPath);
      return {
        status: 'SELECTED',
        source,
        folderName: safeName,
        path: syntax.normalizedPath || fallbackMappedPath,
        resolutionMode: 'SERVER_MANAGED_VIRTUAL',
        validation: syntax,
        localDirectory: summary,
        directoryHandle,
        message: `Selected "${safeName}" via native OS folder picker.`,
      };
    }

    try {
      const response = await this.fetchImpl('/api/companies/resolve-picked-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          folderName: safeName,
          defaultPath: options.defaultPath,
          purpose: options.purpose || 'GENERAL',
          requireWrite: options.requireWrite !== false,
          sampleFileNames: sampleFileNames.slice(0, 25),
          companyId: options.companyId,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (response.ok && payload && typeof payload.path === 'string') {
        const resolutionMode: FolderPathResolutionMode = payload.resolutionMode || 'MAPPED_UNDER_BASE_ROOT';
        if (payload.resolved === false && options.purpose === 'OPEN_COMPANY') {
          return {
            status: 'SELECTED',
            source,
            folderName: safeName,
            path: normalizeDirectoryPath(payload.path),
            resolutionMode: 'BROWSER_HANDLE_ONLY',
            validation: payload.validation,
            localDirectory: summary,
            directoryHandle,
            message:
              payload.message ||
              `Selected folder "${safeName}". Verify the full path or open in LedgerAI PH Desktop for cross-drive access.`,
          };
        }

        return {
          status: 'SELECTED',
          source,
          folderName: safeName,
          path: normalizeDirectoryPath(payload.path),
          resolutionMode,
          validation: payload.validation || validateDirectoryPathSyntax(payload.path),
          localDirectory: summary,
          directoryHandle,
          message: payload.message || `Selected "${safeName}" via native OS folder picker.`,
        };
      }
    } catch {
      // Fallback to deterministic syntax-validated destination path if server probe is temporarily unavailable
    }

    const fallbackSyntax = validateDirectoryPathSyntax(fallbackMappedPath);
    return {
      status: 'SELECTED',
      source,
      folderName: safeName,
      path: fallbackSyntax.normalizedPath || fallbackMappedPath,
      resolutionMode: 'SERVER_MANAGED_VIRTUAL',
      validation: fallbackSyntax,
      localDirectory: summary,
      directoryHandle,
      message: `Selected "${safeName}" via native OS folder picker.`,
    };
  }

  /**
   * Opens the browser's native `<input type="file" webkitdirectory directory multiple />` OS folder picker.
   * Must be invoked synchronously inside a user click gesture before any `await` so browsers never block it.
   */
  private openWebkitDirectoryDialog(options: SelectDirectoryOptions): Promise<
    | { cancelled: true }
    | { cancelled: false; summary: PickedFolderSummary; sampleFileNames: string[] }
    | { error: string }
  > {
    const doc = this.documentImpl;
    const win = this.windowImpl;
    if (!doc || typeof doc.createElement !== 'function') {
      return Promise.resolve({ error: 'Browser document is unavailable.' });
    }

    return new Promise((resolve) => {
      const input = doc.createElement('input');
      input.type = 'file';
      input.multiple = true;
      try {
        input.webkitdirectory = true;
      } catch {
        // Fallback to attribute below
      }
      if (typeof input.setAttribute === 'function') {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.setAttribute('mozdirectory', '');
        input.setAttribute('aria-hidden', 'true');
        input.setAttribute('tabindex', '-1');
        input.setAttribute('data-ledgerai-folder-picker', options.purpose || 'GENERAL');
      }
      if (input.style) {
        input.style.position = 'fixed';
        input.style.top = '-9999px';
        input.style.left = '-9999px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
      }

      let settled = false;

      const cleanup = () => {
        try {
          input.removeEventListener?.('change', onChange);
          input.removeEventListener?.('cancel', onCancel);
        } catch {
          // Ignore listener cleanup errors
        }
        try {
          if (typeof input.remove === 'function') {
            input.remove();
          } else if (doc.body && typeof doc.body.removeChild === 'function' && input.parentNode === doc.body) {
            doc.body.removeChild(input);
          }
        } catch {
          // Ignore detach errors
        }
      };

      const finish = (
        payload:
          | { cancelled: true }
          | { cancelled: false; summary: PickedFolderSummary; sampleFileNames: string[] }
          | { error: string }
      ) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(payload);
      };

      const onChange = () => {
        const files = input.files;
        if (!files || files.length === 0) {
          finish({ cancelled: true });
          return;
        }
        const summary = summarizePickedFiles(files);
        if (!summary.folderName) {
          finish({ cancelled: true });
          return;
        }
        const sampleFileNames = summary.entries
          .filter((e) => e.relativePath.split('/').length === 2)
          .map((e) => e.name)
          .slice(0, 25);
        finish({ cancelled: false, summary, sampleFileNames });
      };

      const onCancel = () => {
        finish({ cancelled: true });
      };

      input.addEventListener?.('change', onChange, { once: true });
      input.addEventListener?.('cancel', onCancel, { once: true });

      try {
        doc.body?.appendChild(input);
        input.click();
      } catch (err: any) {
        finish({ error: err?.message || 'Unable to invoke native browser folder picker dialog.' });
      }
    });
  }

  /**
   * Immediately invokes the native OS directory selection dialog:
   *  - Electron Desktop -> `dialog.showOpenDialog({ properties: ['openDirectory'] })`
   *  - Top-Level Chrome/Edge -> `window.showDirectoryPicker()` (native OS "Select Folder" dialog, works on empty folders)
   *  - Iframe / Firefox / Safari -> `<input type="file" webkitdirectory directory multiple />` (native OS folder picker)
   * Never opens an in-app custom modal UI.
   */
  public async selectDirectory(options: SelectDirectoryOptions = {}): Promise<SelectDirectoryResult> {
    if (this.isDialogActive) {
      return {
        status: 'BUSY',
        errorCode: 'DIALOG_ALREADY_OPEN',
        message: 'A folder selection dialog is already open.',
      };
    }

    const bridge = this.getBridge();
    const purpose: FolderSelectionPurpose = options.purpose || 'GENERAL';
    const title = options.title || PURPOSE_DEFAULT_TITLES[purpose] || PURPOSE_DEFAULT_TITLES.GENERAL;
    const buttonLabel = options.buttonLabel || 'Select Folder';
    const requestOptions: SelectDirectoryOptions = {
      ...options,
      purpose,
      title,
      buttonLabel,
    };

    // -------------------------------------------------------------------------
    // TIER 1: Electron Desktop Native OS Dialog (dialog.showOpenDialog)
    // -------------------------------------------------------------------------
    if (bridge && (typeof bridge.selectDirectory === 'function' || typeof bridge.selectFolder === 'function')) {
      this.isDialogActive = true;
      try {
        let nativeResult: SelectDirectoryResult;

        if (typeof bridge.selectDirectory === 'function') {
          nativeResult = await bridge.selectDirectory(requestOptions);
        } else {
          const legacyPath = await bridge.selectFolder!({
            title,
            defaultPath: options.defaultPath,
            buttonLabel,
          });
          if (!legacyPath) {
            nativeResult = {
              status: 'CANCELLED',
              source: 'ELECTRON_NATIVE',
              message: 'Folder selection was cancelled.',
            };
          } else {
            nativeResult = {
              status: 'SELECTED',
              source: 'ELECTRON_NATIVE',
              path: normalizeDirectoryPath(legacyPath),
            };
          }
        }

        if (!nativeResult || nativeResult.status === 'CANCELLED') {
          return {
            status: 'CANCELLED',
            source: 'ELECTRON_NATIVE',
            message: nativeResult?.message || 'Folder selection cancelled.',
          };
        }

        if (nativeResult.status !== 'SELECTED' || !nativeResult.path) {
          return {
            status: nativeResult.status === 'BUSY' ? 'BUSY' : 'ERROR',
            source: 'ELECTRON_NATIVE',
            path: nativeResult.path,
            errorCode: nativeResult.errorCode || 'NATIVE_DIALOG_ERROR',
            message: nativeResult.message || 'Unable to select directory.',
            validation: nativeResult.validation,
          };
        }

        const normalizedPath = normalizeDirectoryPath(nativeResult.path);
        const syntax = validateDirectoryPathSyntax(normalizedPath);
        if (!syntax.valid) {
          return {
            status: 'ERROR',
            source: 'ELECTRON_NATIVE',
            path: normalizedPath,
            errorCode: syntax.errorCode,
            message: syntax.message,
            validation: syntax,
          };
        }

        const leafName = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;

        if (options.skipServerValidation) {
          return {
            status: 'SELECTED',
            source: 'ELECTRON_NATIVE',
            folderName: leafName,
            path: normalizedPath,
            resolutionMode: 'ELECTRON_EXACT',
            validation: nativeResult.validation || syntax,
          };
        }

        const serverValidation = await this.validateDirectory(normalizedPath, {
          purpose,
          requireWrite: options.requireWrite,
          allowNonExistent: options.allowNonExistent,
          minFreeBytes: options.minFreeBytes,
          companyId: options.companyId,
        });

        if (!serverValidation.valid) {
          return {
            status: 'ERROR',
            source: 'ELECTRON_NATIVE',
            folderName: leafName,
            path: serverValidation.normalizedPath || normalizedPath,
            errorCode: serverValidation.errorCode || 'VALIDATION_ERROR',
            message: serverValidation.message || 'Selected directory did not pass validation.',
            validation: serverValidation,
          };
        }

        return {
          status: 'SELECTED',
          source: 'ELECTRON_NATIVE',
          folderName: leafName,
          path: serverValidation.normalizedPath || normalizedPath,
          resolutionMode: 'ELECTRON_EXACT',
          validation: serverValidation,
        };
      } catch (err: any) {
        return {
          status: 'ERROR',
          source: 'ELECTRON_NATIVE',
          errorCode: 'IPC_ERROR',
          message: err?.message || 'Error communicating with native desktop folder dialog.',
        };
      } finally {
        this.isDialogActive = false;
      }
    }

    // -------------------------------------------------------------------------
    // TIER 2 & 3: Real Browser Native OS Folder Picker Dialogs
    // (Synchronous capability check preserves user click activation!)
    // -------------------------------------------------------------------------
    const caps = this.getCapabilities();
    if (!caps.supportsShowDirectoryPicker && !caps.supportsWebkitDirectory) {
      return {
        status: 'UNSUPPORTED_RUNTIME',
        source: 'BROWSER_UNSUPPORTED',
        errorCode: 'NATIVE_DIALOG_REQUIRES_DESKTOP_RUNTIME',
        message:
          'This runtime does not expose a native OS directory picker. Enter or paste the full folder path directly, or use LedgerAI PH Desktop.',
      };
    }

    this.isDialogActive = true;
    try {
      // TIER 2: Modern Top-Level Browser `window.showDirectoryPicker()` (Native OS "Select Folder" dialog)
      if (caps.supportsShowDirectoryPicker && this.windowImpl?.showDirectoryPicker) {
        try {
          const handle = await this.windowImpl.showDirectoryPicker({
            id: PURPOSE_PICKER_IDS[purpose] || 'ledgerai-folder',
            mode: options.requireWrite === false ? 'read' : 'readwrite',
            startIn: 'documents',
          });

          if (!handle || !handle.name) {
            return {
              status: 'CANCELLED',
              source: 'BROWSER_FSA_API',
              message: 'Folder selection was cancelled.',
            };
          }

          this.lastHandles.set(purpose, handle);

          // Non-fatal top-level entry inspection for exact local directory disambiguation & .lai detection
          const sampleFileNames: string[] = [];
          const detectedLedgerFiles: string[] = [];
          let fileCount = 0;
          if (typeof handle.values === 'function') {
            try {
              for await (const entry of handle.values()) {
                if (entry?.kind === 'file' && entry.name) {
                  fileCount++;
                  if (sampleFileNames.length < 25) sampleFileNames.push(entry.name);
                  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
                  if (['lai', 'lgb', 'sqlite', 'db'].includes(ext) && detectedLedgerFiles.length < 25) {
                    detectedLedgerFiles.push(entry.name);
                  }
                }
                if (fileCount >= 200) break;
              }
            } catch {
              // Permission or enumeration error is non-fatal; folder name is still valid
            }
          }

          const summary: PickedFolderSummary = {
            folderName: sanitizePickedFolderName(handle.name),
            fileCount,
            totalBytes: 0,
            entries: sampleFileNames.map((name) => ({
              name,
              relativePath: `${handle.name}/${name}`,
              size: 0,
              type: '',
              lastModified: 0,
              extension: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
            })),
            detectedLedgerFiles,
            hasDirectoryHandle: true,
            hasAbsolutePath: false,
          };

          return await this.resolveBrowserPickedFolder({
            folderName: handle.name,
            source: 'BROWSER_FSA_API',
            options: requestOptions,
            sampleFileNames,
            summary,
            directoryHandle: handle,
          });
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            return {
              status: 'CANCELLED',
              source: 'BROWSER_FSA_API',
              message: 'Folder selection was cancelled.',
            };
          }
          // If blocked by cross-origin iframe / policy SecurityError, fall through cleanly to Tier 3 webkitdirectory
          if (!caps.supportsWebkitDirectory) {
            return {
              status: 'ERROR',
              source: 'BROWSER_FSA_API',
              errorCode: 'BROWSER_PICKER_ERROR',
              message: err?.message || 'Unable to open browser native folder picker dialog.',
            };
          }
        }
      }

      // TIER 3: Universal Browser Native `<input type="file" webkitdirectory directory multiple />`
      const webkitResult = await this.openWebkitDirectoryDialog(requestOptions);
      if ('error' in webkitResult) {
        return {
          status: 'ERROR',
          source: 'BROWSER_WEBKITDIRECTORY',
          errorCode: 'BROWSER_PICKER_ERROR',
          message: webkitResult.error,
        };
      }
      if (webkitResult.cancelled === true || !('summary' in webkitResult)) {
        return {
          status: 'CANCELLED',
          source: 'BROWSER_WEBKITDIRECTORY',
          message: 'Folder selection was cancelled.',
        };
      }

      return await this.resolveBrowserPickedFolder({
        folderName: webkitResult.summary.folderName,
        source: 'BROWSER_WEBKITDIRECTORY',
        options: requestOptions,
        sampleFileNames: webkitResult.sampleFileNames,
        summary: webkitResult.summary,
      });
    } finally {
      this.isDialogActive = false;
    }
  }

  /**
   * Invokes the native OS file selection dialog in Electron for narrowly allowlisted
   * LedgerAI files (e.g., .lai, .lgb, .sqlite).
   */
  public async selectFile(options: SelectFileOptions = {}): Promise<SelectFileResult> {
    if (this.isDialogActive) {
      return {
        status: 'BUSY',
        errorCode: 'DIALOG_ALREADY_OPEN',
        message: 'A file or folder selection dialog is already open.',
      };
    }

    const bridge = this.getBridge();
    if (!bridge || typeof bridge.selectFile !== 'function') {
      return {
        status: 'UNSUPPORTED_RUNTIME',
        source: 'BROWSER_UNSUPPORTED',
        errorCode: 'NATIVE_DIALOG_REQUIRES_DESKTOP_RUNTIME',
        message: 'Native OS file path dialog requires the LedgerAI PH Desktop application.',
      };
    }

    this.isDialogActive = true;
    try {
      const result = await bridge.selectFile(options);
      if (!result || result.status === 'CANCELLED') {
        return {
          status: 'CANCELLED',
          source: 'ELECTRON_NATIVE',
          message: 'File selection cancelled.',
        };
      }
      return result;
    } catch (err: any) {
      return {
        status: 'ERROR',
        source: 'ELECTRON_NATIVE',
        errorCode: 'IPC_ERROR',
        message: err?.message || 'Error invoking native OS file dialog.',
      };
    } finally {
      this.isDialogActive = false;
    }
  }
}

export const NativeFolderPickerService = new NativeFolderPickerController();
export default NativeFolderPickerService;
