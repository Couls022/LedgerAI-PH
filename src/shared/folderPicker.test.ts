import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import {
  normalizeDirectoryPath,
  validateDirectoryPathSyntax,
  sanitizePickedFolderName,
  buildMappedDestinationPath,
  summarizePickedFiles,
  PURPOSE_DEFAULT_TITLES,
  SelectDirectoryResult,
} from './folderPickerTypes';
import {
  createNativeDialogController,
  NativeDialogFsLike,
} from '../../electron/nativeFolderPickerIpc';
import { validateDirectoryOnServer } from '../server/services/directoryValidationService';
import {
  NativeFolderPickerController,
  ElectronPickerBridge,
  BrowserWindowLike,
  BrowserDocumentLike,
} from '../client/services/nativeFolderPickerService';
import companiesRouter from '../server/routes/companies';
import { paths } from '../server/services/paths';

/**
 * Automated Regression Suite for Centralized NativeFolderPickerService Architecture.
 *
 * NOTE: Electron OS dialog interactions use mocked dialog.showOpenDialog responses in this
 * headless Linux/Node test harness. Passing mocked tests validates architecture, IPC contracts,
 * concurrency guards, validation, and tenant isolation — it does NOT substitute for native
 * Windows Explorer desktop acceptance testing on a real Windows workstation.
 */

test('1 & 2. Native directory dialog invocation uses properties: ["openDirectory"] and succeeds on valid selection', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerai-fp-'));
  try {
    let capturedArgs: any[] = [];
    const controller = createNativeDialogController({
      platform: 'win32',
      getMainWindow: () => ({ isDestroyed: () => false }),
      dialog: {
        showOpenDialog: async (...args: any[]) => {
          capturedArgs = args;
          return { canceled: false, filePaths: [tempRoot] };
        },
      },
    });

    const result = await controller.selectDirectory({
      title: 'Select Company Data Folder',
      defaultPath: tempRoot,
      purpose: 'COMPANY_DATA',
      requireWrite: true,
    });

    assert.equal(result.status, 'SELECTED');
    assert.equal(result.source, 'ELECTRON_NATIVE');
    assert.equal(result.path, normalizeDirectoryPath(tempRoot));
    assert.equal(result.validation?.valid, true);
    assert.equal(result.validation?.exists, true);
    assert.equal(result.validation?.isDirectory, true);
    assert.equal(result.validation?.readable, true);
    assert.equal(result.validation?.writable, true);

    // Verify Electron dialog.showOpenDialog invoked with parentWin + properties: ['openDirectory']
    assert.equal(capturedArgs.length, 2);
    assert.deepEqual(capturedArgs[1].properties, ['openDirectory']);
    assert.equal(capturedArgs[1].title, 'Select Company Data Folder');
    assert.equal(capturedArgs[1].defaultPath, path.resolve(tempRoot));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('3 & 10. User cancellation returns CANCELLED, preserves existing path, and creates no directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerai-fp-cancel-'));
  const nonExistentChild = path.join(tempRoot, 'should_never_be_created');
  try {
    const electronController = createNativeDialogController({
      platform: 'win32',
      getMainWindow: () => ({ isDestroyed: () => false }),
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      },
    });

    const picker = new NativeFolderPickerController({
      getBridge: () => ({
        isElectron: true,
        selectDirectory: (opts) => electronController.selectDirectory(opts),
      }),
    });

    const previousPath = '/data/companies/existing_company';
    let currentPath = previousPath;

    const result = await picker.selectDirectory({
      title: 'Select Backup Folder',
      defaultPath: nonExistentChild,
      purpose: 'BACKUP',
    });

    if (result.status === 'SELECTED' && result.path) {
      currentPath = result.path;
    }

    assert.equal(result.status, 'CANCELLED');
    assert.equal(currentPath, previousPath);
    assert.equal(fsSync.existsSync(nonExistentChild), false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('4. Rejects invalid directories (empty, null bytes, illegal chars, root, reserved OS paths, traversal)', () => {
  assert.equal(validateDirectoryPathSyntax('').errorCode, 'EMPTY_PATH');
  assert.equal(validateDirectoryPathSyntax('/data/bad\0path').errorCode, 'NULL_BYTE');
  assert.equal(validateDirectoryPathSyntax('C:\\Bad<Folder>*Name').errorCode, 'INVALID_CHARACTERS');
  assert.equal(validateDirectoryPathSyntax('/').errorCode, 'ROOT_DIRECTORY_BLOCKED');
  assert.equal(validateDirectoryPathSyntax('C:\\').errorCode, 'ROOT_DIRECTORY_BLOCKED');
  assert.equal(validateDirectoryPathSyntax('/etc/ledger').errorCode, 'RESERVED_OS_DIRECTORY');
  assert.equal(validateDirectoryPathSyntax('C:\\Windows\\System32').errorCode, 'RESERVED_OS_DIRECTORY');
  assert.equal(validateDirectoryPathSyntax('/home/user/.ssh/keys').errorCode, 'RESTRICTED_SECURITY_PATH');
  assert.equal(validateDirectoryPathSyntax('/data/companies/../secrets').errorCode, 'PATH_TRAVERSAL_BLOCKED');
  assert.equal(validateDirectoryPathSyntax('relative/path/only').errorCode, 'RELATIVE_PATH_NOT_ALLOWED');
});

test('5 & 6. Detects inaccessible directories, unavailable drives, and read/write permission denials', async () => {
  const unavailableFs: NativeDialogFsLike = {
    existsSync: () => true,
    statSync: () => {
      const err: any = new Error('Device not ready');
      err.code = 'ENODEV';
      throw err;
    },
    accessSync: () => {},
    constants: { R_OK: 4, W_OK: 2 },
  };

  const unavailableCtrl = createNativeDialogController({
    platform: 'win32',
    getMainWindow: () => null,
    fsImpl: unavailableFs,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/mnt/usb_offline/LedgerAI'] }),
    },
  });
  const unavailableRes = await unavailableCtrl.selectDirectory({ purpose: 'BACKUP' });
  assert.equal(unavailableRes.status, 'ERROR');
  assert.equal(unavailableRes.errorCode, 'UNAVAILABLE_DRIVE');

  // Read-only directory denied when requireWrite: true
  const readOnlyFs: NativeDialogFsLike = {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true }),
    accessSync: (_p, mode) => {
      if (mode === 2) {
        const err: any = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      }
    },
    constants: { R_OK: 4, W_OK: 2 },
  };

  const readOnlyCtrl = createNativeDialogController({
    platform: 'win32',
    getMainWindow: () => null,
    fsImpl: readOnlyFs,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/data/companies/readonly_dir'] }),
    },
  });
  const writeDeniedRes = await readOnlyCtrl.selectDirectory({ purpose: 'BACKUP', requireWrite: true });
  assert.equal(writeDeniedRes.status, 'ERROR');
  assert.equal(writeDeniedRes.errorCode, 'PERMISSION_DENIED_WRITE');

  // Same directory passes when requireWrite: false (e.g., read-only Open Company / Import inspection)
  const readOnlyAllowedRes = await readOnlyCtrl.selectDirectory({ purpose: 'OPEN_COMPANY', requireWrite: false });
  assert.equal(readOnlyAllowedRes.status, 'SELECTED');
  assert.equal(readOnlyAllowedRes.validation?.readable, true);
  assert.equal(readOnlyAllowedRes.validation?.writable, false);

  // Read-denied directory fails completely
  const noReadFs: NativeDialogFsLike = {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true }),
    accessSync: () => {
      const err: any = new Error('EACCES');
      err.code = 'EACCES';
      throw err;
    },
    constants: { R_OK: 4, W_OK: 2 },
  };
  const noReadCtrl = createNativeDialogController({
    platform: 'win32',
    getMainWindow: () => null,
    fsImpl: noReadFs,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/data/companies/no_read'] }),
    },
  });
  const readDeniedRes = await noReadCtrl.selectDirectory({ purpose: 'OPEN_COMPANY', requireWrite: false });
  assert.equal(readDeniedRes.status, 'ERROR');
  assert.equal(readDeniedRes.errorCode, 'PERMISSION_DENIED_READ');
});

test('7. Missing directory returns DIRECTORY_NOT_FOUND on server validation and NEVER silently creates folders', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerai-fp-missing-'));
  const missingTarget = path.join(tempRoot, 'non_existent_folder');
  try {
    const strictRes = await validateDirectoryOnServer(missingTarget, {
      allowedRootsOverride: [tempRoot],
      allowNonExistent: false,
      requireWrite: true,
    });
    assert.equal(strictRes.valid, false);
    assert.equal(strictRes.errorCode, 'DIRECTORY_NOT_FOUND');
    assert.equal(fsSync.existsSync(missingTarget), false, 'Validation MUST NOT silently create missing directories');

    const plannedRes = await validateDirectoryOnServer(missingTarget, {
      allowedRootsOverride: [tempRoot],
      allowNonExistent: true,
      requireWrite: true,
    });
    assert.equal(plannedRes.valid, true);
    assert.equal(plannedRes.exists, false);
    assert.equal(plannedRes.parentWritable, true);
    assert.equal(fsSync.existsSync(missingTarget), false, 'allowNonExistent validation MUST still not create directories');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('8 & 9. Handles spaces, special characters, UNC/removable drives, and long directory paths cleanly', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerai-fp-special-'));
  const specialDir = path.join(tempRoot, "Juan Dela Cruz & Co. (2026) - Mañana's Books #1");
  await fs.mkdir(specialDir, { recursive: true });
  try {
    const specialSyntax = validateDirectoryPathSyntax(specialDir);
    assert.equal(specialSyntax.valid, true);

    const serverCheck = await validateDirectoryOnServer(specialDir, {
      allowedRootsOverride: [tempRoot],
      requireWrite: true,
    });
    assert.equal(serverCheck.valid, true);
    assert.equal(serverCheck.exists, true);

    // UNC & removable drive detection
    const uncCheck = validateDirectoryPathSyntax('\\\\FILESERVER01\\Accounting Share\\Company A (2026)');
    assert.equal(uncCheck.valid, true);
    assert.equal(uncCheck.normalizedPath, '//FILESERVER01/Accounting Share/Company A (2026)');
    assert.equal(uncCheck.isNetworkOrRemovable, true);

    const removableCheck = validateDirectoryPathSyntax('E:\\LedgerAI Backups\\2026 Q4');
    assert.equal(removableCheck.valid, true);
    assert.equal(removableCheck.isNetworkOrRemovable, true);

    // Long path warning (> 240 chars) & hard block (> 4096 chars)
    const longPath = 'C:/LedgerAI/' + 'LongSegment_'.repeat(22) + 'Books';
    const longCheck = validateDirectoryPathSyntax(longPath);
    assert.equal(longCheck.valid, true);
    assert.ok(Array.isArray(longCheck.warnings) && longCheck.warnings.length > 0);

    const hugePath = 'C:/LedgerAI/' + 'a'.repeat(4200);
    const hugeCheck = validateDirectoryPathSyntax(hugePath);
    assert.equal(hugeCheck.valid, false);
    assert.equal(hugeCheck.errorCode, 'PATH_TOO_LONG');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('11. Duplicate dialog invocation prevention in both Electron main controller and frontend service', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerai-fp-dup-'));
  try {
    let releaseDialog!: () => void;
    const dialogGate = new Promise<void>((resolve) => {
      releaseDialog = resolve;
    });
    let invocationCount = 0;

    const mainCtrl = createNativeDialogController({
      platform: 'win32',
      getMainWindow: () => ({ isDestroyed: () => false }),
      dialog: {
        showOpenDialog: async () => {
          invocationCount += 1;
          await dialogGate;
          return { canceled: false, filePaths: [tempRoot] };
        },
      },
    });

    const firstMainCall = mainCtrl.selectDirectory({ purpose: 'COMPANY_DATA' });
    const duplicateMainCall = await mainCtrl.selectDirectory({ purpose: 'BACKUP' });
    assert.equal(duplicateMainCall.status, 'BUSY');
    assert.equal(duplicateMainCall.errorCode, 'DIALOG_ALREADY_OPEN');
    assert.equal(invocationCount, 1);

    releaseDialog();
    const firstMainResult = await firstMainCall;
    assert.equal(firstMainResult.status, 'SELECTED');

    // Frontend duplicate-click lock
    let releaseBridge!: () => void;
    const bridgeGate = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    const frontendPicker = new NativeFolderPickerController({
      getBridge: () => ({
        isElectron: true,
        selectDirectory: async () => {
          await bridgeGate;
          return { status: 'CANCELLED', source: 'ELECTRON_NATIVE' };
        },
      }),
    });

    const p1 = frontendPicker.selectDirectory({ purpose: 'COMPANY_DATA', skipServerValidation: true });
    const p2 = await frontendPicker.selectDirectory({ purpose: 'COMPANY_DATA', skipServerValidation: true });
    assert.equal(p2.status, 'BUSY');
    assert.equal(p2.errorCode, 'DIALOG_ALREADY_OPEN');
    releaseBridge();
    assert.equal((await p1).status, 'CANCELLED');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('12. Secure IPC handles destroyed parent window, sanitizes titles/extensions, and never exposes raw fs', async () => {
  let receivedConfig: any = null;
  const ctrl = createNativeDialogController({
    platform: 'win32',
    getMainWindow: () => ({ isDestroyed: () => true }),
    dialog: {
      showOpenDialog: async (arg1: any, arg2?: any) => {
        // When window is destroyed, dialog.showOpenDialog receives config directly without invalid BrowserWindow handle
        receivedConfig = arg2 || arg1;
        return { canceled: true, filePaths: [] };
      },
    },
  });

  await ctrl.selectFile({
    title: 'Select Backup\0\nInjected',
    filters: [
      { name: 'Archives', extensions: ['.lai', 'exe', 'bat', 'lgb', 'ps1'] },
    ],
  });

  assert.equal(receivedConfig.title.includes('\0'), false);
  assert.equal(receivedConfig.title.includes('\n'), false);
  assert.deepEqual(receivedConfig.filters, [{ name: 'Archives', extensions: ['lai', 'lgb'] }]);

  // Verify preload.ts keeps contextIsolation / does not expose raw fs or ipcRenderer
  const preloadSrc = await fs.readFile(path.resolve('electron/preload.ts'), 'utf8');
  assert.match(preloadSrc, /contextBridge\.exposeInMainWorld\('electronAPI'/);
  assert.doesNotMatch(preloadSrc, /require\(['"]fs['"]\)/);
  assert.doesNotMatch(preloadSrc, /from ['"]fs['"]/);

  const mainSrc = await fs.readFile(path.resolve('electron/main.ts'), 'utf8');
  assert.match(mainSrc, /nodeIntegration:\s*false/);
  assert.match(mainSrc, /contextIsolation:\s*true/);
});

test('13 & 14. Company tenant isolation blocks cross-company workspace collisions & existing DB overwrites', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerai-fp-tenant-'));
  const companyADir = path.join(tempRoot, 'company_a');
  const companyANested = path.join(companyADir, 'nested_sub');
  const companyBDir = path.join(tempRoot, 'company_b');
  await fs.mkdir(companyANested, { recursive: true });
  await fs.mkdir(companyBDir, { recursive: true });
  await fs.writeFile(path.join(companyADir, 'database.lai'), 'ENCRYPTED_MARKER');

  try {
    // Tenant B cannot choose Tenant A's workspace directory or nested folder
    const collisionRes = await validateDirectoryOnServer(companyANested, {
      allowedRootsOverride: [tempRoot],
      purpose: 'BACKUP',
      activeCompanyId: 'COMP-B',
      registeredCompanyDirectories: [{ companyId: 'COMP-A', directory: companyADir }],
    });
    assert.equal(collisionRes.valid, false);
    assert.equal(collisionRes.errorCode, 'TENANT_DIRECTORY_COLLISION');

    // Creating a new company inside a folder containing an existing database.lai is blocked
    const existingDbRes = await validateDirectoryOnServer(companyADir, {
      allowedRootsOverride: [tempRoot],
      purpose: 'COMPANY_DATA',
    });
    assert.equal(existingDbRes.valid, false);
    assert.equal(existingDbRes.errorCode, 'EXISTING_COMPANY_DATABASE_CONFLICT');

    // Tenant B selecting its own clean dedicated folder succeeds
    const cleanRes = await validateDirectoryOnServer(companyBDir, {
      allowedRootsOverride: [tempRoot],
      purpose: 'COMPANY_DATA',
      activeCompanyId: 'COMP-B',
      registeredCompanyDirectories: [{ companyId: 'COMP-A', directory: companyADir }],
    });
    assert.equal(cleanRes.valid, true);
    assert.equal(cleanRes.containsExistingCompanyDb, false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('15, 16 & 17. End-to-end service integration for Backup, Restore, Document Storage, Company Creation & Browser Mode', async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const mockBridge: ElectronPickerBridge = {
    isElectron: true,
    selectDirectory: async (opts): Promise<SelectDirectoryResult> => ({
      status: 'SELECTED',
      source: 'ELECTRON_NATIVE',
      path: `C:/LedgerAI/${opts?.purpose || 'GENERAL'}`,
    }),
  };

  const picker = new NativeFolderPickerController({
    getBridge: () => mockBridge,
    fetchImpl: (async (url: any, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calls.push({ url: String(url), body });
      return new Response(
        JSON.stringify({
          valid: true,
          normalizedPath: body.folderPath,
          exists: true,
          isDirectory: true,
          readable: true,
          writable: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch,
  });

  // Company Creation
  const companyRes = await picker.selectDirectory({ purpose: 'COMPANY_DATA', requireWrite: true });
  assert.equal(companyRes.status, 'SELECTED');
  assert.equal(companyRes.path, 'C:/LedgerAI/COMPANY_DATA');

  // Backup & Restore
  const backupRes = await picker.selectDirectory({ purpose: 'BACKUP', requireWrite: true, companyId: 'COMP-1' });
  const restoreRes = await picker.selectDirectory({ purpose: 'RESTORE_DESTINATION', requireWrite: true });
  assert.equal(backupRes.status, 'SELECTED');
  assert.equal(restoreRes.status, 'SELECTED');

  // Document Storage, OCR Input & Export Destination
  const docRes = await picker.selectDirectory({ purpose: 'DOCUMENT_STORAGE', requireWrite: true });
  const ocrRes = await picker.selectDirectory({ purpose: 'OCR_INPUT', requireWrite: false });
  const exportRes = await picker.selectDirectory({ purpose: 'EXPORT_DESTINATION', requireWrite: true });
  assert.equal(docRes.status, 'SELECTED');
  assert.equal(ocrRes.status, 'SELECTED');
  assert.equal(exportRes.status, 'SELECTED');
  assert.equal(calls.length, 6);
  assert.equal(calls[1].body.companyId, 'COMP-1');
  assert.equal(PURPOSE_DEFAULT_TITLES.COMPANY_DATA, 'Select Company Data Folder');
  assert.equal(PURPOSE_DEFAULT_TITLES.BACKUP, 'Select Backup Folder');
  assert.equal(PURPOSE_DEFAULT_TITLES.DOCUMENT_STORAGE, 'Select Document Storage Folder');

  // Browser-only environment cleanly returns UNSUPPORTED_RUNTIME (never opens custom modal)
  const browserPicker = new NativeFolderPickerController({
    getBridge: () => undefined,
  });
  assert.equal(browserPicker.isDesktopNativePickerAvailable(), false);
  const browserRes = await browserPicker.selectDirectory({ purpose: 'COMPANY_DATA' });
  assert.equal(browserRes.status, 'UNSUPPORTED_RUNTIME');
  assert.equal(browserRes.errorCode, 'NATIVE_DIALOG_REQUIRES_DESKTOP_RUNTIME');
});

test('18. Regression check: custom DirectoryExplorerModal is removed and all integrated modules use NativeFolderPickerService', async () => {
  assert.equal(
    fsSync.existsSync(path.resolve('src/client/components/DirectoryExplorerModal.tsx')),
    false,
    'Obsolete custom DirectoryExplorerModal.tsx must be deleted'
  );

  const integratedModules = [
    'src/client/pages/CreateProfile.tsx',
    'src/client/pages/Settings.tsx',
    'src/client/pages/OpenProfile.tsx',
    'src/client/pages/RestoreProfile.tsx',
    'src/client/pages/BackupManager.tsx',
  ];

  for (const relPath of integratedModules) {
    const content = await fs.readFile(path.resolve(relPath), 'utf8');
    assert.doesNotMatch(content, /DirectoryExplorerModal/, `${relPath} must not reference DirectoryExplorerModal`);
    assert.match(content, /NativeFolderPickerService/, `${relPath} must integrate centralized NativeFolderPickerService`);
  }
});

test('19. Pure browser folder picker helpers sanitize names, build valid destination paths, and summarize files', () => {
  assert.equal(sanitizePickedFolderName('  Deskguard Books (2026)  '), 'Deskguard Books (2026)');
  assert.equal(sanitizePickedFolderName('../secrets\\evil'), '..secretsevil');
  assert.equal(sanitizePickedFolderName('..'), '');
  assert.equal(sanitizePickedFolderName('.'), '');
  assert.equal(sanitizePickedFolderName('Bad<Name>:?*"|'), 'Bad_Name______');

  // Sibling destination path replacement preserves parent root
  assert.equal(
    buildMappedDestinationPath('Q4_Backups', '/data/companies/acme_corp/backups', '/data/companies'),
    '/data/companies/acme_corp/Q4_Backups'
  );
  // Same folder name keeps existing path cleanly
  assert.equal(
    buildMappedDestinationPath('backups', '/data/companies/acme_corp/backups', '/data/companies'),
    '/data/companies/acme_corp/backups'
  );
  // Windows drive defaultPath preserved cleanly
  assert.equal(
    buildMappedDestinationPath('Company_B', 'C:\\LedgerAI\\Companies\\Company_A', '/data/companies'),
    'C:/LedgerAI/Companies/Company_B'
  );
  // Invalid defaultPath falls back to safe fallbackRoot
  assert.equal(
    buildMappedDestinationPath('Ledger_2026', 'relative/invalid', '/data/companies'),
    '/data/companies/Ledger_2026'
  );

  // summarizePickedFiles detects root folder, counts bytes, and identifies .lai/.lgb/.sqlite files
  const summary = summarizePickedFiles([
    {
      name: 'database.lai',
      size: 4096,
      type: 'application/octet-stream',
      lastModified: 1700000000000,
      webkitRelativePath: 'Acme_Workspace/database.lai',
    },
    {
      name: 'backup_2026.lgb',
      size: 1024,
      type: 'application/octet-stream',
      lastModified: 1700000001000,
      webkitRelativePath: 'Acme_Workspace/backups/backup_2026.lgb',
    },
    {
      name: 'notes.txt',
      size: 128,
      type: 'text/plain',
      lastModified: 1700000002000,
      webkitRelativePath: 'Acme_Workspace/notes.txt',
    },
  ]);

  assert.equal(summary.folderName, 'Acme_Workspace');
  assert.equal(summary.fileCount, 3);
  assert.equal(summary.totalBytes, 5248);
  assert.deepEqual(summary.detectedLedgerFiles, [
    'Acme_Workspace/database.lai',
    'Acme_Workspace/backups/backup_2026.lgb',
  ]);
  assert.equal(summary.hasAbsolutePath, false);
});

test('20. Tier 2 Browser Native window.showDirectoryPicker() works for empty & populated folders, handles AbortError, and falls back on SecurityError', async () => {
  const selfRef = {};
  let pickerOptionsCaptured: any = null;
  const mockHandle = {
    name: 'LedgerAI_Empty_Destination',
    kind: 'directory' as const,
    values: async function* () {
      // Intentionally empty folder — Tier 2 supports empty directories natively!
    },
  };

  const mockWindow: BrowserWindowLike = {
    self: selfRef,
    top: selfRef, // Top-level browser tab (not inside iframe)
    isSecureContext: true,
    showDirectoryPicker: async (opts) => {
      pickerOptionsCaptured = opts;
      return mockHandle;
    },
  };

  const resolveCalls: any[] = [];
  const picker = new NativeFolderPickerController({
    getBridge: () => undefined,
    windowImpl: mockWindow,
    documentImpl: null,
    fetchImpl: (async (url: any, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      resolveCalls.push({ url: String(url), body });
      return new Response(
        JSON.stringify({
          resolved: true,
          resolutionMode: 'SERVER_MANAGED_VIRTUAL',
          folderName: body.folderName,
          path: `/data/companies/${body.folderName}`,
          validation: { valid: true, normalizedPath: `/data/companies/${body.folderName}`, readable: true, writable: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch,
  });

  const caps = picker.getCapabilities();
  assert.equal(caps.isElectronDesktop, false);
  assert.equal(caps.isInsideIframe, false);
  assert.equal(caps.supportsShowDirectoryPicker, true);
  assert.equal(caps.canOpenNativeFolderDialog, true);

  const selected = await picker.selectDirectory({
    purpose: 'COMPANY_DATA',
    defaultPath: '/data/companies/old_company',
    requireWrite: true,
  });

  assert.equal(selected.status, 'SELECTED');
  assert.equal(selected.source, 'BROWSER_FSA_API');
  assert.equal(selected.folderName, 'LedgerAI_Empty_Destination');
  assert.equal(selected.path, '/data/companies/LedgerAI_Empty_Destination');
  assert.equal(selected.localDirectory?.fileCount, 0);
  assert.equal(selected.localDirectory?.hasDirectoryHandle, true);
  assert.equal(picker.getLastDirectoryHandle('COMPANY_DATA'), mockHandle);
  assert.equal(pickerOptionsCaptured?.id, 'ledgerai-company-data');
  assert.equal(pickerOptionsCaptured?.mode, 'readwrite');
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0].url, '/api/companies/resolve-picked-folder');

  // AbortError maps cleanly to CANCELLED
  mockWindow.showDirectoryPicker = async () => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  };
  const cancelled = await picker.selectDirectory({ purpose: 'BACKUP' });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.source, 'BROWSER_FSA_API');

  // SecurityError falls through cleanly to Tier 3 <input type="file" webkitdirectory>
  let fallbackInputClicked = false;
  const mockBodyChildren: any[] = [];
  const createMockInput = () => {
    const listeners = new Map<string, Array<() => void>>();
    const el: any = {
      type: '',
      multiple: false,
      webkitdirectory: false,
      style: {},
      files: null,
      attributes: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      addEventListener(type: string, fn: () => void) {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener(type: string, fn: () => void) {
        listeners.set(
          type,
          (listeners.get(type) || []).filter((f) => f !== fn)
        );
      },
      remove() {
        const idx = mockBodyChildren.indexOf(el);
        if (idx >= 0) mockBodyChildren.splice(idx, 1);
      },
      click() {
        fallbackInputClicked = true;
        this.files = [
          {
            name: 'database.lai',
            size: 2048,
            webkitRelativePath: 'Fallback_Picked_Folder/database.lai',
          },
        ];
        for (const fn of listeners.get('change') || []) fn();
      },
    };
    return el;
  };

  const fallbackDoc: BrowserDocumentLike = {
    createElement: () => createMockInput(),
    body: {
      appendChild: (node) => {
        mockBodyChildren.push(node);
        return node;
      },
    },
  };

  const secWin: BrowserWindowLike = {
    self: selfRef,
    top: selfRef,
    showDirectoryPicker: async () => {
      const err = new Error('Cross origin sub frames aren\'t allowed to show a file picker.');
      err.name = 'SecurityError';
      throw err;
    },
  };

  const fallbackPicker = new NativeFolderPickerController({
    getBridge: () => undefined,
    windowImpl: secWin,
    documentImpl: fallbackDoc,
  });
  const fallbackRes = await fallbackPicker.selectDirectory({
    purpose: 'BACKUP',
    defaultPath: '/data/companies/acme/backups',
    skipServerValidation: true,
  });

  assert.equal(fallbackInputClicked, true);
  assert.equal(fallbackRes.status, 'SELECTED');
  assert.equal(fallbackRes.source, 'BROWSER_WEBKITDIRECTORY');
  assert.equal(fallbackRes.folderName, 'Fallback_Picked_Folder');
  assert.equal(fallbackRes.path, '/data/companies/acme/Fallback_Picked_Folder');
  assert.equal(mockBodyChildren.length, 0, 'Temporary hidden <input> must be removed from DOM after selection');
});

test('21. Tier 3 Universal Browser / Cross-Origin Iframe <input webkitdirectory> invokes synchronously, handles cancel & DOM cleanup, and enforces BUSY lock', async () => {
  const appendedNodes: any[] = [];
  let activeInput: any = null;
  let lastClickSync = false;

  const winListeners = new Map<string, Array<() => void>>();
  const iframeWindow: BrowserWindowLike = {
    self: { id: 'child-frame' },
    top: { id: 'parent-frame' }, // Inside iframe -> MUST bypass showDirectoryPicker synchronously!
    showDirectoryPicker: async () => {
      throw new Error('MUST NOT CALL showDirectoryPicker inside iframe');
    },
    addEventListener: (type, fn) => {
      const list = winListeners.get(type) || [];
      list.push(fn);
      winListeners.set(type, list);
    },
    removeEventListener: (type, fn) => {
      winListeners.set(
        type,
        (winListeners.get(type) || []).filter((f) => f !== fn)
      );
    },
  };

  const docImpl: BrowserDocumentLike = {
    createElement: () => {
      const listeners = new Map<string, Array<() => void>>();
      const el: any = {
        type: '',
        multiple: false,
        webkitdirectory: false,
        style: {},
        files: null,
        attributes: {} as Record<string, string>,
        setAttribute(k: string, v: string) {
          this.attributes[k] = v;
        },
        addEventListener(type: string, fn: () => void) {
          const list = listeners.get(type) || [];
          list.push(fn);
          listeners.set(type, list);
        },
        removeEventListener(type: string, fn: () => void) {
          listeners.set(
            type,
            (listeners.get(type) || []).filter((f) => f !== fn)
          );
        },
        emit(type: string) {
          for (const fn of [...(listeners.get(type) || [])]) fn();
        },
        remove() {
          const idx = appendedNodes.indexOf(el);
          if (idx >= 0) appendedNodes.splice(idx, 1);
        },
        click() {
          lastClickSync = true;
          activeInput = el;
        },
      };
      return el;
    },
    body: {
      appendChild: (node) => {
        appendedNodes.push(node);
        return node;
      },
    },
  };

  const picker = new NativeFolderPickerController({
    getBridge: () => undefined,
    windowImpl: iframeWindow,
    documentImpl: docImpl,
  });

  const caps = picker.getCapabilities();
  assert.equal(caps.isInsideIframe, true);
  assert.equal(caps.supportsShowDirectoryPicker, false);
  assert.equal(caps.supportsWebkitDirectory, true);
  assert.equal(caps.canOpenNativeFolderDialog, true);

  // Start selection — input.click() must have fired synchronously before promise resolves
  const pendingSelect = picker.selectDirectory({
    purpose: 'RESTORE_DESTINATION',
    defaultPath: '/data/companies/restored_acme',
    skipServerValidation: true,
  });
  assert.equal(lastClickSync, true, 'input.click() must execute synchronously inside user gesture');
  assert.equal(activeInput.attributes['webkitdirectory'], '');
  assert.equal(activeInput.attributes['data-ledgerai-folder-picker'], 'RESTORE_DESTINATION');
  assert.equal(appendedNodes.length, 1);

  // Duplicate click while dialog is open returns BUSY
  const dupRes = await picker.selectDirectory({ purpose: 'BACKUP', skipServerValidation: true });
  assert.equal(dupRes.status, 'BUSY');
  assert.equal(dupRes.errorCode, 'DIALOG_ALREADY_OPEN');

  // Emit native 'cancel' event -> resolves CANCELLED and removes input from DOM
  activeInput.emit('cancel');
  const cancelRes = await pendingSelect;
  assert.equal(cancelRes.status, 'CANCELLED');
  assert.equal(cancelRes.source, 'BROWSER_WEBKITDIRECTORY');
  assert.equal(appendedNodes.length, 0, 'Temporary input must be detached on cancel');
});

test('22. Backend POST /api/companies/resolve-picked-folder handles loopback exact match, mapped fallback, remote virtual isolation, and invalid names', async () => {
  const tempDirName = `ledgerai_resolve_test_${Date.now()}`;
  const companiesRoot = path.resolve(paths.getCompaniesRootDir());
  const existingLocalDir = path.join(companiesRoot, tempDirName);
  const nonExistentDirName = `ledgerai_never_created_${Date.now()}`;
  const nonExistentFullPath = path.join(companiesRoot, nonExistentDirName);

  await fs.mkdir(existingLocalDir, { recursive: true });
  await fs.writeFile(path.join(existingLocalDir, 'sample_marker.txt'), 'ok');

  const app = express();
  app.use(express.json());
  app.use('/api/companies', companiesRouter);

  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Loopback exact match under approved companies root
    const exactRes = await fetch(`${baseUrl}/api/companies/resolve-picked-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: tempDirName,
        purpose: 'BACKUP',
        requireWrite: true,
        sampleFileNames: ['sample_marker.txt'],
      }),
    });
    assert.equal(exactRes.status, 200);
    const exactData = await exactRes.json();
    assert.equal(exactData.resolved, true);
    assert.equal(exactData.resolutionMode, 'EXACT_LOCAL_MATCH');
    assert.equal(exactData.path, normalizeDirectoryPath(existingLocalDir));

    // 2. Loopback non-existent folder with virtual defaultPath (/data/companies/...) maps cleanly under companiesRootResolved without creating folder!
    const mappedRes = await fetch(`${baseUrl}/api/companies/resolve-picked-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: nonExistentDirName,
        defaultPath: '/data/companies/default_placeholder',
        purpose: 'COMPANY_DATA',
        requireWrite: true,
      }),
    });
    assert.equal(mappedRes.status, 200);
    const mappedData = await mappedRes.json();
    assert.equal(mappedData.resolved, true);
    assert.equal(mappedData.resolutionMode, 'MAPPED_UNDER_BASE_ROOT');
    assert.equal(mappedData.path, normalizeDirectoryPath(nonExistentFullPath));
    assert.equal(fsSync.existsSync(nonExistentFullPath), false, 'resolve-picked-folder MUST NOT silently create folders on disk');

    // 3. Remote / proxied client (x-forwarded-for present) NEVER leaks host OS paths
    const remoteRes = await fetch(`${baseUrl}/api/companies/resolve-picked-folder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.45',
      },
      body: JSON.stringify({
        folderName: tempDirName,
        defaultPath: '/data/companies/old_company',
        purpose: 'BACKUP',
      }),
    });
    assert.equal(remoteRes.status, 200);
    const remoteData = await remoteRes.json();
    assert.equal(remoteData.resolved, true);
    assert.equal(remoteData.resolutionMode, 'SERVER_MANAGED_VIRTUAL');
    assert.equal(remoteData.path, `/data/companies/${tempDirName}`);
    assert.equal(remoteData.path.includes(os.homedir()), false, 'Remote response must NEVER leak host home directory');

    // 4. Invalid folder name returns 400
    const badRes = await fetch(`${baseUrl}/api/companies/resolve-picked-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: '..' }),
    });
    assert.equal(badRes.status, 400);
    const badData = await badRes.json();
    assert.equal(badData.errorCode, 'INVALID_FOLDER_NAME');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(existingLocalDir, { recursive: true, force: true });
    await fs.rm(nonExistentFullPath, { recursive: true, force: true });
  }
});
