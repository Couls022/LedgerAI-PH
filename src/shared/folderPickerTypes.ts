export type FolderSelectionPurpose =
  | 'COMPANY_DATA'
  | 'BACKUP'
  | 'DOCUMENT_STORAGE'
  | 'RESTORE_DESTINATION'
  | 'OPEN_COMPANY'
  | 'ARCHIVE_DESTINATION'
  | 'IMPORT_SOURCE'
  | 'EXPORT_DESTINATION'
  | 'OCR_INPUT'
  | 'DIAGNOSTICS_EXPORT'
  | 'AI_KNOWLEDGE_BASE'
  | 'GENERAL';

export interface SelectDirectoryOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  purpose?: FolderSelectionPurpose;
  requireWrite?: boolean;
  allowNonExistent?: boolean;
  minFreeBytes?: number;
  companyId?: string;
  skipServerValidation?: boolean;
}

export interface SelectFileFilter {
  name: string;
  extensions: string[];
}

export interface SelectFileOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: SelectFileFilter[];
}

export type DirectoryValidationIssueCode =
  | 'EMPTY_PATH'
  | 'NULL_BYTE'
  | 'INVALID_CHARACTERS'
  | 'ROOT_DIRECTORY_BLOCKED'
  | 'RESERVED_OS_DIRECTORY'
  | 'RESTRICTED_SECURITY_PATH'
  | 'PATH_TRAVERSAL_BLOCKED'
  | 'RELATIVE_PATH_NOT_ALLOWED'
  | 'PATH_TOO_LONG'
  | 'DIRECTORY_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'PERMISSION_DENIED_READ'
  | 'PERMISSION_DENIED_WRITE'
  | 'LOW_DISK_SPACE'
  | 'EXISTING_COMPANY_DATABASE_CONFLICT'
  | 'TENANT_DIRECTORY_COLLISION'
  | 'OUTSIDE_APPROVED_ROOT'
  | 'UNAVAILABLE_DRIVE'
  | 'VALIDATION_ERROR';

export interface DirectoryValidationResult {
  valid: boolean;
  normalizedPath: string;
  exists?: boolean;
  isDirectory?: boolean;
  readable?: boolean;
  writable?: boolean;
  parentWritable?: boolean;
  isNetworkOrRemovable?: boolean;
  containsExistingCompanyDb?: boolean;
  availableBytes?: number | null;
  errorCode?: DirectoryValidationIssueCode;
  message?: string;
  warnings?: string[];
}

export type FolderSelectionStatus =
  | 'SELECTED'
  | 'CANCELLED'
  | 'BUSY'
  | 'UNSUPPORTED_RUNTIME'
  | 'ERROR';

export type FolderPickerSource =
  | 'ELECTRON_NATIVE'
  | 'BROWSER_FSA_API'
  | 'BROWSER_WEBKITDIRECTORY'
  | 'BROWSER_UNSUPPORTED';

export type FolderPathResolutionMode =
  | 'ELECTRON_EXACT'
  | 'EXACT_LOCAL_MATCH'
  | 'MAPPED_UNDER_BASE_ROOT'
  | 'SERVER_MANAGED_VIRTUAL'
  | 'BROWSER_HANDLE_ONLY';

export interface BrowserDirectoryFileEntry {
  name: string;
  relativePath: string;
  size: number;
  type: string;
  lastModified: number;
  extension: string;
}

export interface PickedFolderSummary {
  folderName: string;
  fileCount: number;
  totalBytes: number;
  entries: BrowserDirectoryFileEntry[];
  files?: File[];
  detectedLedgerFiles: string[];
  hasDirectoryHandle: boolean;
  hasAbsolutePath: boolean;
}

export interface SelectDirectoryResult {
  status: FolderSelectionStatus;
  path?: string;
  folderName?: string;
  source?: FolderPickerSource;
  resolutionMode?: FolderPathResolutionMode;
  errorCode?: string;
  message?: string;
  validation?: DirectoryValidationResult;
  localDirectory?: PickedFolderSummary;
  directoryHandle?: any;
}

export interface SelectFileResult {
  status: FolderSelectionStatus;
  path?: string;
  source?: FolderPickerSource;
  errorCode?: string;
  message?: string;
}

export const PURPOSE_DEFAULT_TITLES: Record<FolderSelectionPurpose, string> = {
  COMPANY_DATA: 'Select Company Data Folder',
  BACKUP: 'Select Backup Folder',
  DOCUMENT_STORAGE: 'Select Document Storage Folder',
  RESTORE_DESTINATION: 'Select Restore Destination Folder',
  OPEN_COMPANY: 'Select Company Workspace Folder',
  ARCHIVE_DESTINATION: 'Select Archive Destination',
  IMPORT_SOURCE: 'Select Import Source Folder',
  EXPORT_DESTINATION: 'Select Export Destination Folder',
  OCR_INPUT: 'Select OCR Input Directory',
  DIAGNOSTICS_EXPORT: 'Select Diagnostic Logs Export Folder',
  AI_KNOWLEDGE_BASE: 'Select AI Knowledge Base Folder',
  GENERAL: 'Select Folder',
};

const LEDGER_FILE_EXTENSIONS = new Set(['lai', 'lgb', 'sqlite', 'db']);
const MAX_SUMMARY_ENTRIES = 500;

/**
 * Sanitizes a single folder leaf name returned by a browser OS folder picker
 * (FileSystemDirectoryHandle.name or webkitRelativePath root segment).
 * Strips path separators, traversal sequences, null bytes, and illegal OS characters.
 */
export function sanitizePickedFolderName(rawName: string): string {
  const cleaned = String(rawName || '')
    .replace(/[\0\r\n]/g, '')
    .replace(/[\\/]/g, '')
    .replace(/[<>"|?*:]/g, '_')
    .trim();

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return '';
  }

  return cleaned.slice(0, 180);
}

/**
 * Computes a clean, valid destination directory path from a browser-picked folder name
 * combined with an approved default/base path. Never produces relative paths, traversal,
 * or bare root paths.
 */
export function buildMappedDestinationPath(
  rawFolderName: string,
  defaultPath?: string,
  fallbackRoot: string = '/data/companies'
): string {
  const safeName = sanitizePickedFolderName(rawFolderName);
  const safeFallback = normalizeDirectoryPath(fallbackRoot || '/data/companies') || '/data/companies';
  if (!safeName) return safeFallback;

  const normalizedDefault = normalizeDirectoryPath(defaultPath || '');
  if (normalizedDefault) {
    const syntax = validateDirectoryPathSyntax(normalizedDefault);
    if (syntax.valid) {
      const segments = syntax.normalizedPath.split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1] || '';
      if (lastSeg.toLowerCase() === safeName.toLowerCase()) {
        return syntax.normalizedPath;
      }

      // Compute parent directory cleanly while preserving POSIX leading slash, Windows drive, or UNC prefix
      const lastSlashIdx = syntax.normalizedPath.lastIndexOf('/');
      if (lastSlashIdx > 0) {
        const parent = syntax.normalizedPath.slice(0, lastSlashIdx);
        const parentSyntax = validateDirectoryPathSyntax(parent);
        if (parentSyntax.valid) {
          return normalizeDirectoryPath(`${parentSyntax.normalizedPath}/${safeName}`);
        }
      }
      return normalizeDirectoryPath(`${syntax.normalizedPath}/${safeName}`);
    }
  }

  return normalizeDirectoryPath(`${safeFallback}/${safeName}`);
}

/**
 * Pure helper to summarize files returned by `<input type="file" webkitdirectory>`.
 * Extracts exact selected root folder name, total size, file count, and detected LedgerAI files.
 */
export function summarizePickedFiles(
  fileList: ArrayLike<{
    name?: string;
    size?: number;
    type?: string;
    lastModified?: number;
    webkitRelativePath?: string;
  }>,
  fallbackFolderName: string = ''
): PickedFolderSummary {
  const count = fileList ? fileList.length : 0;
  let folderName = sanitizePickedFolderName(fallbackFolderName);
  let totalBytes = 0;
  const entries: BrowserDirectoryFileEntry[] = [];
  const detectedLedgerFiles: string[] = [];
  const rawFiles: File[] = [];

  for (let i = 0; i < count; i++) {
    const f = fileList[i];
    if (!f) continue;
    const rel = String(f.webkitRelativePath || f.name || '').replace(/\\/g, '/');
    if (!folderName && rel.includes('/')) {
      folderName = sanitizePickedFolderName(rel.split('/')[0]);
    }
    const name = String(f.name || rel.split('/').pop() || '');
    const size = typeof f.size === 'number' && Number.isFinite(f.size) ? f.size : 0;
    totalBytes += size;

    const dotIdx = name.lastIndexOf('.');
    const extension = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
    if (LEDGER_FILE_EXTENSIONS.has(extension) && detectedLedgerFiles.length < 50) {
      detectedLedgerFiles.push(rel || name);
    }

    if (entries.length < MAX_SUMMARY_ENTRIES) {
      entries.push({
        name,
        relativePath: rel || name,
        size,
        type: String(f.type || ''),
        lastModified: typeof f.lastModified === 'number' ? f.lastModified : 0,
        extension,
      });
    }

    if (typeof File !== 'undefined' && f instanceof File) {
      rawFiles.push(f);
    }
  }

  return {
    folderName,
    fileCount: count,
    totalBytes,
    entries,
    files: rawFiles.length > 0 ? rawFiles : undefined,
    detectedLedgerFiles,
    hasDirectoryHandle: false,
    hasAbsolutePath: false,
  };
}

export const WINDOWS_SAFE_PATH_WARNING_LENGTH = 240;
export const ABSOLUTE_MAX_PATH_LENGTH = 4096;

const RESERVED_OS_PREFIXES = [
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/lib',
  '/lib64',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/var/log',
  '/var/run',
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata/microsoft',
];

const RESTRICTED_SECURITY_SEGMENTS = [
  '/.ssh',
  '/.gnupg',
  '/.aws',
  '/.keystore_vault',
  '/.audit_hmac.json',
];

/**
 * Normalizes a directory path for consistent cross-platform display and storage
 * while preserving UNC network share prefixes (//server/share/...).
 */
export function normalizeDirectoryPath(rawPath: string): string {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';

  const isUnc = trimmed.startsWith('\\\\') || trimmed.startsWith('//');
  let normalized = trimmed.replace(/\\/g, '/');

  if (isUnc) {
    // Collapse redundant slashes after the leading //
    normalized = '//' + normalized.slice(2).replace(/\/+/g, '/');
  } else {
    normalized = normalized.replace(/\/+/g, '/');
  }

  // Strip trailing slash unless root or drive root (e.g. "C:/")
  if (normalized.length > 1 && normalized.endsWith('/') && !/^[a-zA-Z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Detects whether a path targets a Windows UNC network share or non-system/removable drive letter.
 */
export function detectNetworkOrRemovablePath(normalizedPath: string): boolean {
  if (!normalizedPath) return false;
  if (normalizedPath.startsWith('//')) return true;
  if (/^[d-zD-Z]:\//.test(normalizedPath) || /^[d-zD-Z]:$/.test(normalizedPath)) return true;
  if (/^\/(mnt|media|volumes)\//i.test(normalizedPath)) return true;
  return false;
}

/**
 * Pure, deterministic syntax and security validator for directory paths.
 * Never touches the filesystem or creates directories.
 */
export function validateDirectoryPathSyntax(rawPath: string): DirectoryValidationResult {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return {
      valid: false,
      normalizedPath: '',
      errorCode: 'EMPTY_PATH',
      message: 'Directory path cannot be empty.',
    };
  }

  if (rawPath.includes('\0')) {
    return {
      valid: false,
      normalizedPath: '',
      errorCode: 'NULL_BYTE',
      message: 'Directory path contains an invalid null byte character.',
    };
  }

  const normalized = normalizeDirectoryPath(rawPath);
  const warnings: string[] = [];

  if (normalized.length > ABSOLUTE_MAX_PATH_LENGTH) {
    return {
      valid: false,
      normalizedPath: normalized,
      errorCode: 'PATH_TOO_LONG',
      message: `Directory path exceeds the maximum safe length (${ABSOLUTE_MAX_PATH_LENGTH} characters).`,
    };
  }

  if (normalized.length > WINDOWS_SAFE_PATH_WARNING_LENGTH) {
    warnings.push(
      `Directory path is ${normalized.length} characters long. On Windows systems without LongPathsEnabled, paths over 240 characters may cause nested file access errors.`
    );
  }

  // Disallow explicit path traversal segments ("..")
  const segments = normalized.split('/');
  if (segments.some((seg) => seg === '..')) {
    return {
      valid: false,
      normalizedPath: normalized,
      errorCode: 'PATH_TRAVERSAL_BLOCKED',
      message: "Path traversal ('..') is not permitted in directory paths.",
    };
  }

  // Disallow bare root "/" or bare drive root "C:" / "C:/"
  if (normalized === '/' || normalized === '//' || /^[a-zA-Z]:\/?$/.test(normalized)) {
    return {
      valid: false,
      normalizedPath: normalized,
      errorCode: 'ROOT_DIRECTORY_BLOCKED',
      message: 'Selecting a root filesystem or bare drive root is not allowed for company storage isolation.',
    };
  }

  // Must be an absolute POSIX path ("/..."), Windows drive path ("C:/..."), or UNC share ("//server/share/...")
  const isPosixAbsolute = normalized.startsWith('/') && !normalized.startsWith('//');
  const isWindowsDrive = /^[a-zA-Z]:\//.test(normalized);
  const isUncShare = /^\/\/[^/]+\/[^/]+/.test(normalized);

  if (!isPosixAbsolute && !isWindowsDrive && !isUncShare) {
    return {
      valid: false,
      normalizedPath: normalized,
      errorCode: 'RELATIVE_PATH_NOT_ALLOWED',
      message: 'Directory path must be an absolute path (e.g., C:\\LedgerAI\\Company, \\\\Server\\Share\\Folder, or /path/to/folder).',
    };
  }

  // Validate illegal filename/path characters (allow spaces, parentheses, &, #, ', -, _, ., +, Unicode)
  const pathBody = isWindowsDrive ? normalized.slice(2) : normalized;
  if (/[<>"|?*]/.test(pathBody) || pathBody.includes(':')) {
    return {
      valid: false,
      normalizedPath: normalized,
      errorCode: 'INVALID_CHARACTERS',
      message: 'Directory path contains invalid characters (< > : " | ? *).',
    };
  }

  const lower = normalized.toLowerCase();

  for (const prefix of RESERVED_OS_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) {
      return {
        valid: false,
        normalizedPath: normalized,
        errorCode: 'RESERVED_OS_DIRECTORY',
        message: 'Reserved operating system directories cannot be used for LedgerAI PH storage.',
      };
    }
  }

  for (const seg of RESTRICTED_SECURITY_SEGMENTS) {
    if (lower.includes(seg)) {
      return {
        valid: false,
        normalizedPath: normalized,
        errorCode: 'RESTRICTED_SECURITY_PATH',
        message: 'Restricted security or system vault directories cannot be selected.',
      };
    }
  }

  return {
    valid: true,
    normalizedPath: normalized,
    isNetworkOrRemovable: detectNetworkOrRemovablePath(normalized),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
