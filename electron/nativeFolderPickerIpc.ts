import path from 'path';
import fs from 'fs';
import {
  PURPOSE_DEFAULT_TITLES,
  SelectDirectoryOptions,
  SelectDirectoryResult,
  SelectFileOptions,
  SelectFileResult,
  DirectoryValidationResult,
  normalizeDirectoryPath,
  validateDirectoryPathSyntax,
} from '../src/shared/folderPickerTypes';

export interface ElectronDialogLike {
  showOpenDialog: (
    browserWindowOrOptions: any,
    options?: any
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface BrowserWindowLike {
  isDestroyed?: () => boolean;
}

export interface NativeDialogFsLike {
  existsSync: (targetPath: string) => boolean;
  statSync: (targetPath: string) => { isDirectory: () => boolean };
  accessSync: (targetPath: string, mode?: number) => void;
  statfsSync?: (targetPath: string) => { bavail: number; bsize: number };
  constants: { R_OK: number; W_OK: number };
}

export interface NativeDialogControllerDeps {
  dialog: ElectronDialogLike;
  getMainWindow: () => BrowserWindowLike | null | undefined;
  platform?: NodeJS.Platform;
  fsImpl?: NativeDialogFsLike;
  log?: (msg: string) => void;
}

const ALLOWED_FILE_EXTENSIONS = new Set([
  'lai',
  'lgb',
  'sqlite',
  'db',
  'csv',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'json',
  'xlsx',
]);

const COMPANY_DB_MARKERS = ['database.lai', 'company.json', 'ledger.sqlite'];

function sanitizeDialogTitle(rawTitle: unknown, fallback: string): string {
  if (typeof rawTitle !== 'string') return fallback;
  const clean = rawTitle.replace(/[\r\n\0]/g, ' ').trim().slice(0, 120);
  return clean || fallback;
}

function sanitizeButtonLabel(rawLabel: unknown, fallback: string): string {
  if (typeof rawLabel !== 'string') return fallback;
  const clean = rawLabel.replace(/[\r\n\0]/g, ' ').trim().slice(0, 40);
  return clean || fallback;
}

/**
 * Resolves a safe existing initial directory for Electron's dialog.showOpenDialog defaultPath.
 * Walks up parent directories if the suggested target path does not yet exist so the OS dialog
 * opens cleanly without ever creating directories on disk.
 */
function resolveSafeDefaultPath(rawDefaultPath: unknown, fsImpl: NativeDialogFsLike): string | undefined {
  if (typeof rawDefaultPath !== 'string' || !rawDefaultPath.trim() || rawDefaultPath.includes('\0')) {
    return undefined;
  }

  let candidate = path.resolve(rawDefaultPath.trim());
  for (let depth = 0; depth < 8; depth++) {
    try {
      if (fsImpl.existsSync(candidate) && fsImpl.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Fall through to parent
    }
    const parent = path.dirname(candidate);
    if (!parent || parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

/**
 * Performs non-mutating native filesystem validation on a directory chosen in Electron.
 * Never creates, overwrites, or deletes files or folders.
 */
export function inspectDirectoryNatively(
  selectedPath: string,
  options: SelectDirectoryOptions = {},
  fsImpl: NativeDialogFsLike = fs as unknown as NativeDialogFsLike
): DirectoryValidationResult {
  const syntax = validateDirectoryPathSyntax(selectedPath);
  if (!syntax.valid) {
    return syntax;
  }

  const resolved = path.resolve(selectedPath);
  const normalizedPath = normalizeDirectoryPath(selectedPath);
  const warnings = syntax.warnings ? [...syntax.warnings] : [];

  try {
    if (!fsImpl.existsSync(resolved)) {
      return {
        ...syntax,
        valid: false,
        exists: false,
        isDirectory: false,
        errorCode: 'DIRECTORY_NOT_FOUND',
        message: `Selected directory "${normalizedPath}" does not exist or is no longer available.`,
      };
    }

    const stat = fsImpl.statSync(resolved);
    if (!stat.isDirectory()) {
      return {
        ...syntax,
        valid: false,
        exists: true,
        isDirectory: false,
        errorCode: 'NOT_A_DIRECTORY',
        message: `Selected path "${normalizedPath}" is not a directory.`,
      };
    }
  } catch (err: any) {
    const code = err?.code;
    const isUnavailable = code === 'ENOENT' || code === 'ENODEV' || code === 'ENXIO' || code === 'ENOTCONN';
    return {
      ...syntax,
      valid: false,
      exists: false,
      errorCode: isUnavailable ? 'UNAVAILABLE_DRIVE' : 'PERMISSION_DENIED_READ',
      message: `Unable to access directory "${normalizedPath}": ${err?.message || 'Access error.'}`,
    };
  }

  let readable = false;
  try {
    fsImpl.accessSync(resolved, fsImpl.constants.R_OK);
    readable = true;
  } catch {
    return {
      ...syntax,
      valid: false,
      exists: true,
      isDirectory: true,
      readable: false,
      errorCode: 'PERMISSION_DENIED_READ',
      message: `Read permission denied for directory "${normalizedPath}". Choose a folder your account can read.`,
    };
  }

  let writable = false;
  try {
    fsImpl.accessSync(resolved, fsImpl.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  if (options.requireWrite && !writable) {
    return {
      ...syntax,
      valid: false,
      exists: true,
      isDirectory: true,
      readable,
      writable: false,
      errorCode: 'PERMISSION_DENIED_WRITE',
      message: `Write permission denied for directory "${normalizedPath}". Choose a writable folder.`,
    };
  }

  let availableBytes: number | null = null;
  if (typeof fsImpl.statfsSync === 'function') {
    try {
      const statfs = fsImpl.statfsSync(resolved);
      if (statfs && typeof statfs.bavail === 'number' && typeof statfs.bsize === 'number') {
        availableBytes = statfs.bavail * statfs.bsize;
        if (options.minFreeBytes && availableBytes < options.minFreeBytes) {
          return {
            ...syntax,
            valid: false,
            exists: true,
            isDirectory: true,
            readable,
            writable,
            availableBytes,
            errorCode: 'LOW_DISK_SPACE',
            message: `Insufficient free disk space in "${normalizedPath}".`,
          };
        }
      }
    } catch {
      availableBytes = null;
    }
  }

  const containsExistingCompanyDb = COMPANY_DB_MARKERS.some((marker) => {
    try {
      return fsImpl.existsSync(path.join(resolved, marker));
    } catch {
      return false;
    }
  });

  if (containsExistingCompanyDb && options.purpose === 'COMPANY_DATA') {
    warnings.push(
      'This directory already contains an existing LedgerAI PH company database. Existing company files will not be overwritten.'
    );
  }

  return {
    ...syntax,
    valid: true,
    normalizedPath,
    exists: true,
    isDirectory: true,
    readable,
    writable,
    availableBytes,
    containsExistingCompanyDb,
    warnings: warnings.length > 0 ? warnings : undefined,
    message: 'Directory verified and accessible.',
  };
}

/**
 * Centralized Electron Main-Process Native Folder & File Dialog Controller.
 * Enforces single-flight invocation, secure input sanitization, properties: ['openDirectory'],
 * window-lifecycle safety, and non-mutating post-selection validation.
 */
export function createNativeDialogController(deps: NativeDialogControllerDeps) {
  const {
    dialog,
    getMainWindow,
    platform = process.platform,
    fsImpl = fs as unknown as NativeDialogFsLike,
    log = () => {},
  } = deps;

  let isDialogOpen = false;

  const getSafeParentWindow = (): BrowserWindowLike | undefined => {
    try {
      const win = getMainWindow();
      if (!win) return undefined;
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) {
        return undefined;
      }
      return win;
    } catch {
      return undefined;
    }
  };

  async function selectDirectory(rawOptions?: SelectDirectoryOptions): Promise<SelectDirectoryResult> {
    if (isDialogOpen) {
      return {
        status: 'BUSY',
        source: 'ELECTRON_NATIVE',
        errorCode: 'DIALOG_ALREADY_OPEN',
        message: 'A native folder selection dialog is already open. Complete or cancel it first.',
      };
    }

    const opts: SelectDirectoryOptions = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const purpose = opts.purpose || 'GENERAL';
    const defaultTitle = PURPOSE_DEFAULT_TITLES[purpose] || PURPOSE_DEFAULT_TITLES.GENERAL;
    const title = sanitizeDialogTitle(opts.title, defaultTitle);
    const buttonLabel = sanitizeButtonLabel(opts.buttonLabel, 'Select Folder');
    const defaultPath = resolveSafeDefaultPath(opts.defaultPath, fsImpl);

    const properties: string[] = ['openDirectory'];
    if (platform === 'darwin') {
      properties.push('createDirectory');
    }

    isDialogOpen = true;
    try {
      const parentWin = getSafeParentWindow();
      const dialogConfig: Record<string, any> = {
        title,
        buttonLabel,
        properties,
      };
      if (defaultPath) {
        dialogConfig.defaultPath = defaultPath;
      }

      const result = parentWin
        ? await dialog.showOpenDialog(parentWin, dialogConfig)
        : await dialog.showOpenDialog(dialogConfig);

      if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return {
          status: 'CANCELLED',
          source: 'ELECTRON_NATIVE',
          message: 'Folder selection was cancelled by the user.',
        };
      }

      const selectedRaw = result.filePaths[0];
      const validation = inspectDirectoryNatively(selectedRaw, opts, fsImpl);
      if (!validation.valid) {
        return {
          status: 'ERROR',
          source: 'ELECTRON_NATIVE',
          path: validation.normalizedPath || normalizeDirectoryPath(selectedRaw),
          errorCode: validation.errorCode || 'VALIDATION_ERROR',
          message: validation.message || 'Selected directory failed validation.',
          validation,
        };
      }

      return {
        status: 'SELECTED',
        source: 'ELECTRON_NATIVE',
        path: validation.normalizedPath,
        validation,
      };
    } catch (err: any) {
      log(`Native folder dialog error: ${err?.message || err}`);
      return {
        status: 'ERROR',
        source: 'ELECTRON_NATIVE',
        errorCode: 'NATIVE_DIALOG_FAILURE',
        message: err?.message || 'Failed to open native operating system folder dialog.',
      };
    } finally {
      isDialogOpen = false;
    }
  }

  async function selectFile(rawOptions?: SelectFileOptions): Promise<SelectFileResult> {
    if (isDialogOpen) {
      return {
        status: 'BUSY',
        source: 'ELECTRON_NATIVE',
        errorCode: 'DIALOG_ALREADY_OPEN',
        message: 'A native file selection dialog is already open.',
      };
    }

    const opts: SelectFileOptions = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const title = sanitizeDialogTitle(opts.title, 'Select File');
    const buttonLabel = sanitizeButtonLabel(opts.buttonLabel, 'Open');
    const defaultPath = resolveSafeDefaultPath(opts.defaultPath, fsImpl);

    const sanitizedFilters = Array.isArray(opts.filters)
      ? opts.filters
          .map((f) => ({
            name: sanitizeDialogTitle(f?.name, 'Supported Files'),
            extensions: Array.isArray(f?.extensions)
              ? f.extensions
                  .map((e) => String(e || '').replace(/^\./, '').toLowerCase())
                  .filter((e) => ALLOWED_FILE_EXTENSIONS.has(e))
              : [],
          }))
          .filter((f) => f.extensions.length > 0)
      : [];

    isDialogOpen = true;
    try {
      const parentWin = getSafeParentWindow();
      const dialogConfig: Record<string, any> = {
        title,
        buttonLabel,
        properties: ['openFile'],
      };
      if (defaultPath) {
        dialogConfig.defaultPath = defaultPath;
      }
      if (sanitizedFilters.length > 0) {
        dialogConfig.filters = sanitizedFilters;
      }

      const result = parentWin
        ? await dialog.showOpenDialog(parentWin, dialogConfig)
        : await dialog.showOpenDialog(dialogConfig);

      if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return {
          status: 'CANCELLED',
          source: 'ELECTRON_NATIVE',
          message: 'File selection was cancelled by the user.',
        };
      }

      return {
        status: 'SELECTED',
        source: 'ELECTRON_NATIVE',
        path: normalizeDirectoryPath(result.filePaths[0]),
      };
    } catch (err: any) {
      log(`Native file dialog error: ${err?.message || err}`);
      return {
        status: 'ERROR',
        source: 'ELECTRON_NATIVE',
        errorCode: 'NATIVE_DIALOG_FAILURE',
        message: err?.message || 'Failed to open native operating system file dialog.',
      };
    } finally {
      isDialogOpen = false;
    }
  }

  return {
    selectDirectory,
    selectFile,
    isBusy: () => isDialogOpen,
  };
}
