import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import {
  DirectoryValidationResult,
  FolderSelectionPurpose,
  normalizeDirectoryPath,
  validateDirectoryPathSyntax,
} from '../../shared/folderPickerTypes';
import { paths } from './paths';

export interface ServerDirectoryValidationOptions {
  purpose?: FolderSelectionPurpose;
  requireWrite?: boolean;
  allowNonExistent?: boolean;
  minFreeBytes?: number;
  activeCompanyId?: string | null;
  registeredCompanyDirectories?: Array<{ companyId: string; directory: string }>;
  allowedRootsOverride?: string[];
}

const COMPANY_DB_MARKERS = ['database.lai', 'company.json', 'ledger.sqlite'];

function isPathInsideRoot(resolvedTarget: string, baseDir: string | null | undefined): boolean {
  if (!baseDir) return false;
  const baseResolved = path.resolve(baseDir);
  const rel = path.relative(baseResolved, resolvedTarget);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function getApprovedStorageRoots(override?: string[]): string[] {
  if (override && override.length > 0) {
    return override;
  }

  const allowedRoots: string[] = [
    paths.getCompaniesRootDir(),
    paths.getDataDir(),
    path.join(os.homedir(), 'Documents'),
    path.join(process.cwd(), 'data'),
  ];

  if (process.env.LEDGERAI_ISOLATED_TEST_ROOT) {
    allowedRoots.push(process.env.LEDGERAI_ISOLATED_TEST_ROOT);
  }
  if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
    allowedRoots.push(os.tmpdir());
  }
  if (process.platform === 'win32') {
    for (const drive of paths.getAvailableActiveDrives()) {
      if (drive?.path) {
        allowedRoots.push(drive.path);
      }
    }
  }

  return allowedRoots;
}

/**
 * Strictly non-mutating server-side directory validation.
 * NEVER creates folders, temp files, or modifies existing company data.
 */
export async function validateDirectoryOnServer(
  rawPath: string,
  options: ServerDirectoryValidationOptions = {}
): Promise<DirectoryValidationResult> {
  const syntax = validateDirectoryPathSyntax(rawPath);
  if (!syntax.valid) {
    return syntax;
  }

  const resolved = path.resolve(rawPath.trim());
  const normalizedPath = normalizeDirectoryPath(resolved);
  const warnings = syntax.warnings ? [...syntax.warnings] : [];
  const requireWrite = options.requireWrite !== false;

  // Enforce approved storage root boundaries (preserving existing security model)
  const isUncShare = normalizedPath.startsWith('//');
  const allowedRoots = getApprovedStorageRoots(options.allowedRootsOverride);
  const isApprovedRoot =
    (process.platform === 'win32' && isUncShare) ||
    allowedRoots.some((root) => isPathInsideRoot(resolved, root));

  if (!isApprovedRoot) {
    return {
      ...syntax,
      valid: false,
      normalizedPath,
      errorCode: 'OUTSIDE_APPROVED_ROOT',
      message: `Directory "${normalizedPath}" is outside approved LedgerAI storage locations.`,
    };
  }

  // Enforce company tenant isolation: prevent colliding with another registered company's directory
  if (Array.isArray(options.registeredCompanyDirectories) && options.registeredCompanyDirectories.length > 0) {
    for (const reg of options.registeredCompanyDirectories) {
      if (!reg.directory) continue;
      if (options.activeCompanyId && reg.companyId === options.activeCompanyId) {
        continue;
      }
      const regResolved = path.resolve(reg.directory);
      if (
        resolved === regResolved ||
        isPathInsideRoot(resolved, regResolved) ||
        isPathInsideRoot(regResolved, resolved)
      ) {
        if (options.purpose !== 'OPEN_COMPANY') {
          return {
            ...syntax,
            valid: false,
            normalizedPath,
            containsExistingCompanyDb: true,
            errorCode: 'TENANT_DIRECTORY_COLLISION',
            message: `Selected directory overlaps with another company's isolated workspace (${reg.companyId}). Choose a separate dedicated folder.`,
          };
        }
      }
    }
  }

  // Check existence and type WITHOUT creating anything
  let exists = false;
  let isDirectory = false;
  try {
    const stat = await fs.stat(resolved);
    exists = true;
    isDirectory = stat.isDirectory();
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      exists = false;
    } else if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return {
        ...syntax,
        valid: false,
        normalizedPath,
        exists: true,
        readable: false,
        errorCode: 'PERMISSION_DENIED_READ',
        message: `Permission denied when inspecting directory "${normalizedPath}".`,
      };
    } else {
      return {
        ...syntax,
        valid: false,
        normalizedPath,
        exists: false,
        errorCode: 'UNAVAILABLE_DRIVE',
        message: `Unable to access directory "${normalizedPath}": ${err?.message || 'Unavailable location.'}`,
      };
    }
  }

  if (exists && !isDirectory) {
    return {
      ...syntax,
      valid: false,
      normalizedPath,
      exists: true,
      isDirectory: false,
      errorCode: 'NOT_A_DIRECTORY',
      message: `Path "${normalizedPath}" points to a file instead of a directory.`,
    };
  }

  if (!exists) {
    if (!options.allowNonExistent) {
      return {
        ...syntax,
        valid: false,
        normalizedPath,
        exists: false,
        isDirectory: false,
        errorCode: 'DIRECTORY_NOT_FOUND',
        message: `Directory "${normalizedPath}" does not exist. Select an existing folder or create one explicitly before proceeding.`,
      };
    }

    // Walk up to nearest existing ancestor and verify permissions WITHOUT creating the missing directory
    let ancestor = path.dirname(resolved);
    let ancestorFound = false;
    for (let depth = 0; depth < 12; depth++) {
      try {
        const st = await fs.stat(ancestor);
        if (st.isDirectory()) {
          ancestorFound = true;
          break;
        }
      } catch {
        // Keep walking up
      }
      const next = path.dirname(ancestor);
      if (!next || next === ancestor) break;
      ancestor = next;
    }

    if (!ancestorFound) {
      return {
        ...syntax,
        valid: false,
        normalizedPath,
        exists: false,
        parentWritable: false,
        errorCode: 'DIRECTORY_NOT_FOUND',
        message: `No accessible parent directory exists for "${normalizedPath}".`,
      };
    }

    try {
      await fs.access(ancestor, fsSync.constants.R_OK | (requireWrite ? fsSync.constants.W_OK : 0));
    } catch {
      return {
        ...syntax,
        valid: false,
        normalizedPath,
        exists: false,
        parentWritable: false,
        errorCode: requireWrite ? 'PERMISSION_DENIED_WRITE' : 'PERMISSION_DENIED_READ',
        message: `Parent directory "${normalizeDirectoryPath(ancestor)}" does not grant required permissions.`,
      };
    }

    return {
      ...syntax,
      valid: true,
      normalizedPath,
      exists: false,
      isDirectory: false,
      readable: true,
      writable: requireWrite,
      parentWritable: true,
      containsExistingCompanyDb: false,
      warnings: warnings.length > 0 ? warnings : undefined,
      message: 'Target directory does not exist yet; parent folder is accessible and will be initialized upon explicit save.',
    };
  }

  // Directory exists: verify read and optional write access non-destructively
  try {
    await fs.access(resolved, fsSync.constants.R_OK);
  } catch {
    return {
      ...syntax,
      valid: false,
      normalizedPath,
      exists: true,
      isDirectory: true,
      readable: false,
      errorCode: 'PERMISSION_DENIED_READ',
      message: `Read permission denied for "${normalizedPath}".`,
    };
  }

  let writable = false;
  try {
    await fs.access(resolved, fsSync.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  if (requireWrite && !writable) {
    return {
      ...syntax,
      valid: false,
      normalizedPath,
      exists: true,
      isDirectory: true,
      readable: true,
      writable: false,
      errorCode: 'PERMISSION_DENIED_WRITE',
      message: `Write permission denied for "${normalizedPath}". Select a writable directory.`,
    };
  }

  // Check available disk space when supported by Node runtime
  let availableBytes: number | null = null;
  if (typeof (fs as any).statfs === 'function') {
    try {
      const statfs = await (fs as any).statfs(resolved);
      if (statfs && typeof statfs.bavail === 'number' && typeof statfs.bsize === 'number') {
        availableBytes = Number(statfs.bavail) * Number(statfs.bsize);
        if (options.minFreeBytes && availableBytes < options.minFreeBytes) {
          return {
            ...syntax,
            valid: false,
            normalizedPath,
            exists: true,
            isDirectory: true,
            readable: true,
            writable,
            availableBytes,
            errorCode: 'LOW_DISK_SPACE',
            message: `Insufficient free storage space in "${normalizedPath}".`,
          };
        }
      }
    } catch {
      availableBytes = null;
    }
  }

  // Check whether this folder already hosts an existing LedgerAI company database
  const containsExistingCompanyDb = COMPANY_DB_MARKERS.some((marker) => {
    try {
      return fsSync.existsSync(path.join(resolved, marker));
    } catch {
      return false;
    }
  });

  if (containsExistingCompanyDb && options.purpose === 'COMPANY_DATA') {
    return {
      ...syntax,
      valid: false,
      normalizedPath,
      exists: true,
      isDirectory: true,
      readable: true,
      writable,
      availableBytes,
      containsExistingCompanyDb: true,
      errorCode: 'EXISTING_COMPANY_DATABASE_CONFLICT',
      message: `Directory "${normalizedPath}" already contains an existing company database. Choose an empty or dedicated folder to preserve company data isolation.`,
    };
  }

  return {
    ...syntax,
    valid: true,
    normalizedPath,
    exists: true,
    isDirectory: true,
    readable: true,
    writable,
    availableBytes,
    containsExistingCompanyDb,
    warnings: warnings.length > 0 ? warnings : undefined,
    message: 'Folder is accessible and verified.',
  };
}
