import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import express from "express";
import type { Server } from "http";

// Isolate all config, registry, shortcut history, and company data inside a dedicated tmp workspace
const TEST_ROOT = fsSync.mkdtempSync(path.join(os.tmpdir(), "ledgerai-portable-lifecycle-"));
const TEST_CONFIG_DIR = path.join(TEST_ROOT, "config");
const TEST_DATA_DIR = path.join(TEST_ROOT, "companies");
const TEST_EXTERNAL_DIR = path.join(TEST_DATA_DIR, "_external_usb");
fsSync.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
fsSync.mkdirSync(TEST_DATA_DIR, { recursive: true });
fsSync.mkdirSync(TEST_EXTERNAL_DIR, { recursive: true });

process.env.LEDGERAI_CONFIG_DIR = TEST_CONFIG_DIR;
process.env.LEDGERAI_DATA_DIR = TEST_DATA_DIR;

// Dynamic imports AFTER env isolation so PathService and CompanyManager bind to TEST_ROOT
const { CompanyManager } = await import("./companyManager");
const { CompanyLifecycleService } = await import("./companyLifecycleService");
const { RestoreService } = await import("./restoreService");
const { DatabaseEncryptionService } = await import("./databaseEncryptionService");
const {
  PORTABLE_META_FILENAME,
  PORTABLE_FORMAT_VERSION,
  assessCompanyIdentityDuplicate,
  auditPortableAttachmentsSync,
  inspectPortableMetadataFilesSync,
  remapRelocatedDocumentPathsSync,
  sanitizePortableImportRelativePath,
  stageUploadedPortablePackage,
  stripPortableSecrets,
  verifyDestinationDiskSpace,
  writePortableMetadataSync,
} = await import("./portableCompanyService");
const { CompanyPreferenceService } = await import("../../client/services/companyPreferenceService");
const { default: companiesRouter } = await import("../routes/companies");
const { default: restoreRouter } = await import("../routes/restore");

/**
 * Helper: Creates an authentic, fully migrated portable company folder on disk
 * via CompanyManager.createCompanyProfile(..., skipRegistry = true), optionally
 * inserts document attachment rows, and syncs database.lai + portable_meta.json.
 */
async function createPortableCompanyFixture(params: {
  dir: string;
  companyId: string;
  legalName: string;
  encrypt?: boolean;
  includePortableMeta?: boolean;
  includeManifest?: boolean;
  documentFiles?: Array<{ id: string; fileName: string; createOnDisk: boolean; storedPathMode?: "ABSOLUTE" | "RELATIVE" }>;
}): Promise<{
  dir: string;
  dbPath: string;
  companyId: string;
  legalName: string;
}> {
  const {
    dir,
    companyId,
    legalName,
    encrypt = true,
    includePortableMeta = true,
    includeManifest = false,
    documentFiles = [],
  } = params;

  await CompanyManager.createCompanyProfile(companyId, legalName, dir, undefined, true, {
    classification: "TEST",
    encryptionKeyMode: "LEGACY_DEV_KEY",
  });

  // Insert document attachment records directly into the active SQLite DB if requested
  const activeSqlitePath = path.join(dir, ".db_active.sqlite");
  if (documentFiles.length > 0 && fsSync.existsSync(activeSqlitePath)) {
    const sqlite = new Database(activeSqlitePath);
    await fs.mkdir(path.join(dir, "documents"), { recursive: true });
    const uploaderId = `u-uploader-${companyId}`;
    const existingUser = sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
    const effectiveUserId = existingUser?.id || uploaderId;
    if (!existingUser) {
      sqlite
        .prepare("INSERT INTO users (id, email, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'ACTIVE')")
        .run(uploaderId, `uploader.${companyId.toLowerCase()}@ledgerai.ph`, bcrypt.hashSync("Pass!2026", 4), "Test Uploader");
    }
    for (const doc of documentFiles) {
      const absDocPath = path.join(dir, "documents", doc.fileName);
      if (doc.createOnDisk) {
        await fs.writeFile(absDocPath, Buffer.from(`PDF-RECEIPT-${doc.id}`, "utf8"));
      }
      const storedPath = doc.storedPathMode === "RELATIVE" ? `documents/${doc.fileName}` : absDocPath;
      sqlite
        .prepare(
          `INSERT INTO documents (id, company_id, entity_type, entity_id, document_type, file_name, original_file_name, file_type, file_size, file_path, uploaded_by, status)
           VALUES (?, ?, 'GENERAL', ?, 'RECEIPT', ?, ?, 'application/pdf', 32, ?, ?, 'ACTIVE')`
        )
        .run(doc.id, companyId, `ent-${doc.id}`, doc.fileName, doc.fileName, storedPath, effectiveUserId);
    }
    sqlite.close();
  }

  // Close live DB handle and re-encrypt database.lai from active SQLite cleanly
  await CompanyManager.closeCompanyDb(companyId).catch(() => {});
  const dbPath = path.join(dir, encrypt ? "database.lai" : "database.sqlite");
  if (encrypt && fsSync.existsSync(activeSqlitePath)) {
    DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, dbPath, {
      keyMode: "LEGACY_DEV_KEY",
    });
    await fs.rm(activeSqlitePath, { force: true });
    await fs.rm(`${activeSqlitePath}-wal`, { force: true });
    await fs.rm(`${activeSqlitePath}-shm`, { force: true });
  } else if (!encrypt && fsSync.existsSync(activeSqlitePath)) {
    await fs.rename(activeSqlitePath, dbPath);
    await fs.rm(path.join(dir, "database.lai"), { force: true });
  }

  if (includePortableMeta) {
    writePortableMetadataSync({
      companyDirectory: dir,
      companyId,
      legalName,
      dbPath,
      schemaVersion: 15,
      encryptionFormat: encrypt ? "LAISENC1" : "SQLITE_RAW",
      encryptionKeyRef: encrypt ? "LEGACY_DEV_KEY" : null,
      attachmentCount: documentFiles.length,
    });
  } else {
    await fs.rm(path.join(dir, PORTABLE_META_FILENAME), { force: true });
  }

  if (includeManifest) {
    const sanitized = stripPortableSecrets({
      id: companyId,
      legalName,
      createdAt: new Date().toISOString(),
      dbPath,
      location: dir,
      documentLocation: path.join(dir, "documents"),
      backupLocation: path.join(dir, "backups"),
      recoveryKey: "SHOULD_BE_STRIPPED_NEVER_SAVED",
      dek: "SHOULD_BE_STRIPPED",
    });
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(sanitized, null, 2), "utf8");
  } else {
    await fs.rm(path.join(dir, "manifest.json"), { force: true });
  }

  return { dir, dbPath, companyId, legalName };
}

/**
 * Helper: Creates a signed, checksum-valid BackupPayload and serializes it into
 * either LAIPH1 (.lai) or legacy LGBPH1 (.lgb) binary archive format.
 */
function createSignedBackupArchive(params: {
  companyId: string;
  companyName: string;
  formatMagic?: "LAIPH1" | "LGBPH1";
  extraData?: Record<string, any[]>;
}): { payload: any; buffer: Buffer } {
  const { companyId, companyName, formatMagic = "LAIPH1", extraData = {} } = params;
  const ownerHash = bcrypt.hashSync("OwnerRestore!2026", 4);
  const createdIso = "2026-11-16T08:00:00.000Z";
  const data: Record<string, any[]> = {
    companies: [
      {
        id: companyId,
        legalName: companyName,
        tradeName: companyName,
        tin: "234-567-890-000",
        rdoCode: "044",
        baseCurrency: "PHP",
        fiscalYearStartMonth: 1,
        taxType: "VAT",
        businessType: "CORPORATION",
      },
    ],
    users: [
      {
        id: `u-owner-${companyId}`,
        email: `owner.${companyId.toLowerCase()}@company.ph`,
        passwordHash: ownerHash,
        displayName: "Juan Dela Cruz",
        status: "ACTIVE",
      },
    ],
    roles: [
      {
        id: `r-owner-${companyId}`,
        code: "COMPANY_OWNER",
        name: "Company Owner",
      },
    ],
    companyUsers: [
      {
        id: `cu-owner-${companyId}`,
        companyId,
        userId: `u-owner-${companyId}`,
        roleId: `r-owner-${companyId}`,
        role: "Company Owner",
        status: "ACTIVE",
        membershipStatus: "ACTIVE",
      },
    ],
    accounts: [
      {
        id: `acc-1010-${companyId}`,
        companyId,
        accountCode: "1010",
        accountName: "Cash in Bank",
        accountType: "ASSET",
        normalBalance: "DEBIT",
        isCashAccount: true,
        isActive: true,
      },
    ],
    ...extraData,
  };
  void createdIso;

  const { deterministicStringify } = restoreServiceExports;
  const serializedData = deterministicStringify(data);
  const checksum = crypto.createHash("sha256").update(serializedData).digest("hex");
  const signature = RestoreService.generateSignature(data);

  const payload: any = {
    metadata: {
      version: "1.0",
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      checksum,
      signature,
      format: "LAI_DATABASE_V1",
      companyId,
      companyName,
    },
    data,
  };

  let buffer = RestoreService.serializeLai(payload);
  if (formatMagic === "LGBPH1") {
    buffer = Buffer.concat([Buffer.from("LGBPH1", "ascii"), buffer.subarray(6)]);
  }
  return { payload, buffer };
}

const restoreServiceExports = await import("./restoreService");

let server: Server;
let baseUrl = "";

before(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/api/companies", companiesRouter);
  app.use("/api/restore", restoreRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await CompanyManager.closeAllConnections().catch(() => {});
  await fs.rm(TEST_ROOT, { recursive: true, force: true }).catch(() => {});
});

// ============================================================================
// OPEN EXISTING COMPANY TESTS (1 – 10)
// ============================================================================

test("01. Open Existing: valid portable company folder inspects, registers, and opens cleanly", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case01_valid_portable");
  await createPortableCompanyFixture({
    dir,
    companyId: "PORTABLE-CASE-01",
    legalName: "Manila Bay Hardware Corp.",
    encrypt: true,
    includePortableMeta: true,
    documentFiles: [{ id: "doc-01", fileName: "si-0001.pdf", createOnDisk: true }],
  });

  const inspection = await CompanyLifecycleService.inspectDatabaseTarget(dir);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.companyId, "PORTABLE-CASE-01");
  assert.equal(inspection.legalName, "Manila Bay Hardware Corp.");
  assert.equal(inspection.portableMetadata?.portableFormatVersion, PORTABLE_FORMAT_VERSION);
  assert.equal(inspection.attachmentAudit?.totalReferences, 1);
  assert.equal(inspection.attachmentAudit?.presentCount, 1);
  assert.equal(inspection.attachmentAudit?.missingCount, 0);

  const manifest = await CompanyManager.browseAndRegisterCompanyFolder(dir, { operation: "OPENED" });
  assert.equal(manifest.id, "PORTABLE-CASE-01");
  assert.equal(manifest.registrationAction, "REGISTERED_NEW");
  assert.equal(fsSync.existsSync(path.join(dir, PORTABLE_META_FILENAME)), true);

  // Verify database can actually be opened for queries
  const dbHandle = await CompanyManager.getCompanyDb("PORTABLE-CASE-01");
  assert.ok(dbHandle);
});

test("02. Open Existing: invalid folder containing unrelated files is rejected cleanly", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case02_invalid_folder");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "notes.txt"), "Not a company database", "utf8");
  await fs.writeFile(path.join(dir, "budget.csv"), "col1,col2\n1,2\n", "utf8");

  const inspection = await CompanyLifecycleService.inspectDatabaseTarget(dir);
  assert.equal(inspection.valid, false);
  assert.equal(inspection.errorCode, "DATABASE_NOT_FOUND");
});

test("03. Open Existing: folder with metadata/documents but missing database file is rejected", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case03_missing_db");
  await fs.mkdir(path.join(dir, "documents"), { recursive: true });
  await fs.writeFile(
    path.join(dir, PORTABLE_META_FILENAME),
    JSON.stringify({
      formatVersion: PORTABLE_FORMAT_VERSION,
      companyId: "MISSING-DB-03",
      legalName: "Ghost Books Inc.",
      relativeDbPath: "database.lai",
    }),
    "utf8"
  );

  const inspection = await CompanyLifecycleService.inspectDatabaseTarget(dir);
  assert.equal(inspection.valid, false);
  assert.equal(inspection.errorCode, "DATABASE_NOT_FOUND");
});

test("04. Open Existing: invalid/corrupted portable metadata or mismatched companyId is rejected with INVALID_METADATA", async () => {
  const dirCorruptJson = path.join(TEST_EXTERNAL_DIR, "case04_corrupt_meta");
  await createPortableCompanyFixture({
    dir: dirCorruptJson,
    companyId: "META-CORRUPT-04",
    legalName: "Corrupt Meta Co.",
    includePortableMeta: false,
  });
  await fs.writeFile(path.join(dirCorruptJson, PORTABLE_META_FILENAME), "{invalid-json", "utf8");

  const metaCheck = inspectPortableMetadataFilesSync(dirCorruptJson);
  assert.equal(metaCheck.valid, false);
  assert.equal(metaCheck.errorCode, "INVALID_METADATA");

  const inspection1 = await CompanyLifecycleService.inspectDatabaseTarget(dirCorruptJson);
  assert.equal(inspection1.valid, false);
  assert.equal(inspection1.errorCode, "INVALID_METADATA");

  // Also test companyId mismatch between portable_meta.json and SQLite database
  const dirMismatch = path.join(TEST_EXTERNAL_DIR, "case04_mismatch_meta");
  await createPortableCompanyFixture({
    dir: dirMismatch,
    companyId: "REAL-COMPANY-04",
    legalName: "Real Books Corp.",
    includePortableMeta: true,
  });
  const metaFile = path.join(dirMismatch, PORTABLE_META_FILENAME);
  const parsed = JSON.parse(await fs.readFile(metaFile, "utf8"));
  parsed.companyId = "DIFFERENT-COMPANY-99";
  await fs.writeFile(metaFile, JSON.stringify(parsed, null, 2), "utf8");

  const inspection2 = await CompanyLifecycleService.inspectDatabaseTarget(dirMismatch);
  assert.equal(inspection2.valid, false);
  assert.ok(
    inspection2.errorCode === "IDENTITY_MISMATCH" || inspection2.errorCode === "INVALID_METADATA",
    `Unexpected errorCode: ${inspection2.errorCode}`
  );
});

test("05. Open Existing: corrupted database file is rejected safely without crashing", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case05_corrupt_db");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "database.lai"), Buffer.from("LAISENC1\x00\x01\x02CORRUPTED_BYTES_XYZ"));

  const inspection = await CompanyLifecycleService.inspectDatabaseTarget(dir);
  assert.equal(inspection.valid, false);
  assert.ok(
    inspection.errorCode === "CORRUPT_DATABASE" ||
      inspection.errorCode === "INVALID_DATABASE_FORMAT" ||
      inspection.errorCode === "INVALID_ENCRYPTION_KEY",
    `Unexpected errorCode: ${inspection.errorCode}`
  );
});

test("06. Open Existing: already registered company reuses existing registry entry without creating duplicates", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case06_reuse");
  await createPortableCompanyFixture({
    dir,
    companyId: "PORTABLE-REUSE-06",
    legalName: "Cebu Logistics Trading",
  });

  const first = await CompanyManager.browseAndRegisterCompanyFolder(dir, { operation: "OPENED" });
  assert.equal(first.registrationAction, "REGISTERED_NEW");

  const second = await CompanyManager.browseAndRegisterCompanyFolder(dir, { operation: "OPENED" });
  assert.equal(second.registrationAction, "REUSED_EXISTING");

  const all = await CompanyManager.listCompanies({ includeSynthetic: true });
  const matches = all.filter((c) => c.id === "PORTABLE-REUSE-06");
  assert.equal(matches.length, 1);
});

test("07. Open Existing: duplicate company identity across two active folders triggers HTTP 409 conflict until explicitly resolved", async () => {
  const dirA = path.join(TEST_EXTERNAL_DIR, "case07_copy_a");
  const dirB = path.join(TEST_EXTERNAL_DIR, "case07_copy_b");
  await createPortableCompanyFixture({
    dir: dirA,
    companyId: "DUP-IDENTITY-07",
    legalName: "Davao Agro Ventures Inc.",
  });
  await createPortableCompanyFixture({
    dir: dirB,
    companyId: "DUP-IDENTITY-07",
    legalName: "Davao Agro Ventures Inc.",
  });

  await CompanyManager.browseAndRegisterCompanyFolder(dirA, { operation: "OPENED" });

  // Attempt opening duplicate copy via HTTP API without explicit conflictResolution -> must return 409
  const conflictRes = await fetch(`${baseUrl}/api/companies/open-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dirB }),
  });
  assert.equal(conflictRes.status, 409);
  const conflictBody = await conflictRes.json();
  assert.equal(conflictBody.error, "DUPLICATE_COMPANY_IDENTITY_CONFLICT");
  assert.equal(conflictBody.conflict?.companyId, "DUP-IDENTITY-07");

  // Verify registry still points to dirA (zero silent overwrite)
  const manifestBefore = await CompanyManager.getCompanyManifest("DUP-IDENTITY-07");
  assert.equal(path.resolve(manifestBefore!.location), path.resolve(dirA));

  // Explicit user decision to switch registry to dirB -> succeeds with SWITCHED_REGISTRY
  const switchRes = await fetch(`${baseUrl}/api/companies/open-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dirB, conflictResolution: "SWITCH_REGISTRY_TO_SELECTED" }),
  });
  assert.equal(switchRes.status, 200);
  const switchBody = await switchRes.json();
  assert.equal(switchBody.registrationAction, "SWITCHED_REGISTRY");

  const manifestAfter = await CompanyManager.getCompanyManifest("DUP-IDENTITY-07");
  assert.equal(path.resolve(manifestAfter!.location), path.resolve(dirB));
});

test("08. Open Existing: relocated portable folder (PC1 -> USB -> PC2) updates registry and remaps stale document paths", async () => {
  const pc1Dir = path.join(TEST_EXTERNAL_DIR, "case08_pc1_folder");
  const pc2Dir = path.join(TEST_EXTERNAL_DIR, "case08_pc2_relocated");
  await createPortableCompanyFixture({
    dir: pc1Dir,
    companyId: "RELOCATE-CASE-08",
    legalName: "Iloilo Builders Corp.",
    documentFiles: [{ id: "doc-reloc-1", fileName: "bir-2307.pdf", createOnDisk: true, storedPathMode: "ABSOLUTE" }],
  });

  await CompanyManager.browseAndRegisterCompanyFolder(pc1Dir, { operation: "OPENED" });
  await CompanyManager.closeCompanyDb("RELOCATE-CASE-08");

  // Simulate physical move from PC1 to PC2 (original folder no longer exists)
  await fs.cp(pc1Dir, pc2Dir, { recursive: true });
  await fs.rm(pc1Dir, { recursive: true, force: true });

  const relocated = await CompanyManager.browseAndRegisterCompanyFolder(pc2Dir, { operation: "OPENED" });
  assert.equal(relocated.registrationAction, "RELOCATED");
  assert.equal(path.resolve(relocated.location), path.resolve(pc2Dir));
  assert.equal(relocated.relocatedDocumentsUpdated, 1);

  // Verify portable_meta.json records relocation and has zero absolute path dependency
  const meta = JSON.parse(await fs.readFile(path.join(pc2Dir, PORTABLE_META_FILENAME), "utf8"));
  assert.equal(meta.relativeDbPath, "database.lai");
  assert.ok(meta.lastRelocatedAt);
});

test("09. Open Existing: encrypted company database verifies cleanly and never leaks plaintext keys into portable metadata", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case09_encrypted");
  await createPortableCompanyFixture({
    dir,
    companyId: "ENC-CASE-09",
    legalName: "Makati FinTech Services Inc.",
    encrypt: true,
    includePortableMeta: true,
    includeManifest: true,
  });

  const manifestRaw = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifestRaw.recoveryKey, undefined);
  assert.equal(manifestRaw.dek, undefined);

  const metaRaw = JSON.parse(await fs.readFile(path.join(dir, PORTABLE_META_FILENAME), "utf8"));
  assert.equal(metaRaw.encryptionFormat, "LAISENC1");
  assert.equal((metaRaw as any).recoveryKey, undefined);
  assert.equal((metaRaw as any).passwordHash, undefined);
  assert.equal((metaRaw as any).dek, undefined);

  const inspection = await CompanyLifecycleService.inspectDatabaseTarget(dir);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.versionMetadata.containerFormat, "LAISENC1");
});

test("10. Open Existing: missing required attachments are audited, warned by default, and blocked in strict mode", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case10_missing_attachments");
  await createPortableCompanyFixture({
    dir,
    companyId: "ATTACH-CASE-10",
    legalName: "Taguig Retail Group",
    documentFiles: [
      { id: "doc-present", fileName: "present.pdf", createOnDisk: true },
      { id: "doc-missing", fileName: "missing-voucher.pdf", createOnDisk: false },
    ],
  });

  // Default mode: opens with warning audit metadata
  const softInspect = await CompanyLifecycleService.inspectDatabaseTarget(dir);
  assert.equal(softInspect.valid, true);
  assert.equal(softInspect.attachmentAudit?.totalReferences, 2);
  assert.equal(softInspect.attachmentAudit?.presentCount, 1);
  assert.equal(softInspect.attachmentAudit?.missingCount, 1);

  // Strict mode: blocks opening when required attachments are missing
  const strictInspect = await CompanyLifecycleService.inspectDatabaseTarget(dir, { requireAttachments: true });
  assert.equal(strictInspect.valid, false);
  assert.equal(strictInspect.errorCode, "MISSING_REQUIRED_ATTACHMENTS");
});

// ============================================================================
// RESTORE COMPANY TESTS (11 – 20)
// ============================================================================

test("11. Restore: valid .lai (LAIPH1) archive validates and restores cleanly", async () => {
  const { buffer } = createSignedBackupArchive({
    companyId: "RESTORE-LAI-11",
    companyName: "BGC Precision Corp.",
    formatMagic: "LAIPH1",
  });
  const parsed = RestoreService.deserializeLai(buffer);
  const validated = RestoreService.validateBackupFile(parsed);
  assert.equal(validated.metadata.companyId, "RESTORE-LAI-11");

  const dest = path.join(TEST_DATA_DIR, "restore_case_11");
  const restoredId = await RestoreService.restoreDatabase(validated, "RESTORE-LAI-11", "NEW", null, dest);
  assert.equal(restoredId, "RESTORE-LAI-11");
  assert.equal(fsSync.existsSync(path.join(dest, "database.lai")), true);
  assert.equal(fsSync.existsSync(path.join(dest, PORTABLE_META_FILENAME)), true);
});

test("12. Restore: valid legacy .lgb (LGBPH1) archive validates and restores cleanly", async () => {
  const { buffer } = createSignedBackupArchive({
    companyId: "RESTORE-LGB-12",
    companyName: "Legacy Books Trading",
    formatMagic: "LGBPH1",
  });
  const parsed = RestoreService.deserializeLai(buffer);
  const validated = RestoreService.validateBackupFile(parsed);
  const dest = path.join(TEST_DATA_DIR, "restore_case_12");
  const restoredId = await RestoreService.restoreDatabase(validated, "RESTORE-LGB-12", "NEW", null, dest);
  assert.equal(restoredId, "RESTORE-LGB-12");
  assert.equal(fsSync.existsSync(path.join(dest, "database.lai")), true);
});

test("13. Restore: corrupted archive fails checksum/decompression validation safely", async () => {
  const { buffer } = createSignedBackupArchive({
    companyId: "RESTORE-CORRUPT-13",
    companyName: "Corrupt Archive Co.",
  });
  const corrupted = Buffer.from(buffer);
  corrupted[corrupted.length - 5] ^= 0xff;
  corrupted[corrupted.length - 4] ^= 0xaa;

  assert.throws(() => {
    const parsed = RestoreService.deserializeLai(corrupted);
    RestoreService.validateBackupFile(parsed);
  });
});

test("14. Restore: tampered cryptographic HMAC signature is rejected with TAMPER_DETECTED", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "RESTORE-TAMPER-14",
    companyName: "Tamper Proof Inc.",
  });
  payload.metadata.signature = "0".repeat(64);

  assert.throws(() => {
    RestoreService.validateBackupFile(payload);
  }, /TAMPER_DETECTED|SIGNATURE/i);
});

test("15. Restore: wrong archive format (plain JSON and active workspace database.lai) is rejected", async () => {
  // Plain text / non-backup format
  assert.throws(() => {
    RestoreService.deserializeLai(Buffer.from('{"hello":"not a backup"}', "utf8"));
  }, /INVALID_BACKUP_FORMAT/i);

  // Active workspace database.lai (LAISENC1) passed into Restore -> explicitly rejected as WORKSPACE_DB_NOT_BACKUP
  const wsDir = path.join(TEST_EXTERNAL_DIR, "case15_workspace_not_backup");
  const fixture = await createPortableCompanyFixture({
    dir: wsDir,
    companyId: "WS-NOT-BACKUP-15",
    legalName: "Active Workspace Only",
    encrypt: true,
  });
  const wsBytes = await fs.readFile(fixture.dbPath);
  assert.throws(() => {
    RestoreService.deserializeLai(wsBytes);
  }, /WORKSPACE_DB_NOT_BACKUP/i);
});

test("16. Restore: insufficient destination storage aborts pre-flight before mutating disk", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "RESTORE-NOSPACE-16",
    companyName: "Low Disk Space Corp.",
  });
  const dest = path.join(TEST_DATA_DIR, "restore_case_16_nospace");

  await assert.rejects(
    async () => {
      await RestoreService.restoreDatabase(payload, "RESTORE-NOSPACE-16", "NEW", null, dest, {
        availableBytesOverride: 1024, // 1 KB available
        minRequiredBytes: 10 * 1024 * 1024, // 10 MB required
      });
    },
    /INSUFFICIENT_DESTINATION_STORAGE/i
  );

  // Verify destination folder was NOT created or polluted
  assert.equal(fsSync.existsSync(dest), false);
});

test("17. Restore: non-empty destination folder conflict prevents silent overwrite", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "RESTORE-NONEMPTY-17",
    companyName: "Protected Target Co.",
  });
  const dest = path.join(TEST_DATA_DIR, "restore_case_17_nonempty");
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, "existing_important_file.txt"), "DO NOT OVERWRITE", "utf8");

  await assert.rejects(
    async () => {
      await RestoreService.restoreDatabase(payload, "RESTORE-NONEMPTY-17", "NEW", null, dest);
    },
    /TARGET_DIRECTORY_NOT_EMPTY|DESTINATION_EXISTS|already contains/i
  );

  // Existing file must remain completely untouched
  assert.equal(await fs.readFile(path.join(dest, "existing_important_file.txt"), "utf8"), "DO NOT OVERWRITE");
});

test("18. Restore: interrupted extraction performs atomic rollback without corrupting or registering partial state", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "RESTORE-ROLLBACK-18",
    companyName: "Atomic Rollback Corp.",
  });
  const dest = path.join(TEST_DATA_DIR, "restore_case_18_rollback");

  await assert.rejects(
    async () => {
      await RestoreService.restoreDatabase(payload, "RESTORE-ROLLBACK-18", "NEW", null, dest, {
        injectFailureStage: "BEFORE_COMMIT",
      });
    },
    /INJECTED_RESTORE_FAILURE|INJECTED_FAILURE/i
  );

  // Failed restore must NOT leave a broken registered company behind
  const manifest = await CompanyManager.getCompanyManifest("RESTORE-ROLLBACK-18");
  assert.ok(!manifest);
});

test("19. Restore: duplicate company identity blocks overwrite in NEW mode and supports explicit cloneAsNew", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "RESTORE-DUP-19",
    companyName: "Duplicate Restore Test Co.",
  });
  const dest1 = path.join(TEST_DATA_DIR, "restore_case_19_a");
  await RestoreService.restoreDatabase(payload, "RESTORE-DUP-19", "NEW", null, dest1);

  const dest2 = path.join(TEST_DATA_DIR, "restore_case_19_b");
  await assert.rejects(
    async () => {
      await RestoreService.restoreDatabase(payload, "RESTORE-DUP-19", "NEW", null, dest2);
    },
    /COMPANY_ALREADY_EXISTS/i
  );

  // Explicit cloneAsNew generates an isolated independent company ID
  const destClone = path.join(TEST_DATA_DIR, "restore_case_19_clone");
  const clonedId = await RestoreService.restoreDatabase(payload, "RESTORE-DUP-19", "NEW", null, destClone, {
    cloneAsNew: true,
  });
  assert.notEqual(clonedId, "RESTORE-DUP-19");
  assert.equal(fsSync.existsSync(path.join(destClone, PORTABLE_META_FILENAME)), true);
});

test("20. Restore -> Reopen: restored portable company folder reopens seamlessly via Open Existing Company", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "RESTORE-REOPEN-20",
    companyName: "Roundtrip Portable Corp.",
  });
  const dest = path.join(TEST_DATA_DIR, "restore_case_20_portable");
  const restoredId = await RestoreService.restoreDatabase(payload, "RESTORE-REOPEN-20", "NEW", null, dest);
  assert.equal(restoredId, "RESTORE-REOPEN-20");

  // Confirm standardized secret-free portable_meta.json exists
  const metaPath = path.join(dest, PORTABLE_META_FILENAME);
  assert.equal(fsSync.existsSync(metaPath), true);
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  assert.equal(meta.companyId, "RESTORE-REOPEN-20");
  assert.equal(meta.relativeDbPath, "database.lai");
  assert.equal(meta.restoredFromBackupChecksum, payload.metadata.checksum);

  // Unregister from registry (simulating moving to a fresh machine) — files remain intact
  await CompanyManager.unregisterCompany("RESTORE-REOPEN-20");
  assert.ok(!(await CompanyManager.getCompanyManifest("RESTORE-REOPEN-20")));
  assert.equal(fsSync.existsSync(path.join(dest, "database.lai")), true);

  // Now reopen directly via Open Existing Company (no backup archive needed!)
  const reopened = await CompanyManager.browseAndRegisterCompanyFolder(dest, { operation: "OPENED" });
  assert.equal(reopened.id, "RESTORE-REOPEN-20");
  assert.equal(reopened.registrationAction, "REGISTERED_NEW");
});

// ============================================================================
// INTEGRATION TESTS (21 – 28)
// ============================================================================

test("21. Integration: Company Registry stays strictly synchronized as single authoritative source", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case21_registry_sync");
  await createPortableCompanyFixture({
    dir,
    companyId: "REG-SYNC-21",
    legalName: "Registry Sync Enterprises",
  });
  await CompanyManager.browseAndRegisterCompanyFolder(dir, { operation: "OPENED" });

  const registryPath = path.join(TEST_CONFIG_DIR, "registry.json");
  assert.equal(fsSync.existsSync(registryPath), true);
  const registryData = JSON.parse(await fs.readFile(registryPath, "utf8"));
  const found = (registryData.companies || registryData).find((c: any) => c.id === "REG-SYNC-21");
  assert.ok(found);
  assert.equal(path.resolve(found.location), path.resolve(dir));
});

test("22. Integration: Recent history / shortcuts update automatically when portable companies open", async () => {
  const shortcuts = await CompanyLifecycleService.listShortcuts({ includeSynthetic: true });
  const entry = shortcuts.find((s) => s.companyId === "REG-SYNC-21");
  assert.ok(entry, "Expected REG-SYNC-21 in shortcut history");
  assert.equal(entry.availabilityStatus, "AVAILABLE");
  assert.equal(entry.validationStatus, "VALID");
});

test("23. Integration: Shortcut removal is non-destructive and preserves database & attachments on disk", async () => {
  const dir = path.join(TEST_EXTERNAL_DIR, "case23_shortcut_preserve");
  await createPortableCompanyFixture({
    dir,
    companyId: "SHORTCUT-SAFE-23",
    legalName: "Safe Shortcut Corp.",
    documentFiles: [{ id: "doc-23", fileName: "keep-me.pdf", createOnDisk: true }],
  });
  await CompanyManager.browseAndRegisterCompanyFolder(dir, { operation: "OPENED" });

  await CompanyLifecycleService.removeShortcutOnly("SHORTCUT-SAFE-23", { confirmProtectedUnregister: true });
  assert.equal(fsSync.existsSync(path.join(dir, "database.lai")), true);
  assert.equal(fsSync.existsSync(path.join(dir, PORTABLE_META_FILENAME)), true);
  assert.equal(fsSync.existsSync(path.join(dir, "documents", "keep-me.pdf")), true);
});

test("24. Integration: Company switching and per-browser-profile preference isolation work cleanly", () => {
  const storageA = new Map<string, string>();
  const storageB = new Map<string, string>();
  const makeStorage = (map: Map<string, string>) => ({
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  });

  // Workstation/Profile A selects Company 1; Workstation/Profile B selects Company 2 independently
  CompanyPreferenceService.setLastSelectedCompany("PORTABLE-CASE-01", "Manila Bay Hardware Corp.", makeStorage(storageA) as any);
  CompanyPreferenceService.setLastSelectedCompany("RESTORE-LAI-11", "BGC Precision Corp.", makeStorage(storageB) as any);

  const savedA = CompanyPreferenceService.getLastSelectedCompany(makeStorage(storageA) as any);
  const savedB = CompanyPreferenceService.getLastSelectedCompany(makeStorage(storageB) as any);
  assert.equal(savedA?.companyId, "PORTABLE-CASE-01");
  assert.equal(savedB?.companyId, "RESTORE-LAI-11");

  // Startup verification redirects to login when company exists, preserves on offline, clears on 404
  const okDecision = CompanyPreferenceService.resolveStartupCompanyVerification({
    saved: savedA!,
    httpStatus: 200,
    companyPayload: { id: "PORTABLE-CASE-01", legalName: "Manila Bay Hardware Corp." },
    networkError: false,
  });
  assert.equal(okDecision.action, "REDIRECT_LOGIN");
});

test("25. Integration: Central Server Mode supports secure portable package upload and blocks traversal & remote host path access", async () => {
  // 25a. Path traversal & executable upload blocked in staging
  assert.equal(sanitizePortableImportRelativePath("../etc/passwd").valid, false);
  assert.equal(sanitizePortableImportRelativePath("malware.exe").valid, false);
  assert.equal(sanitizePortableImportRelativePath("database.lai").valid, true);
  assert.equal(sanitizePortableImportRelativePath("database.lai").safeRelPath, "database.lai");
  assert.equal(sanitizePortableImportRelativePath("documents/or-1001.pdf").valid, true);
  assert.equal(sanitizePortableImportRelativePath("documents/or-1001.pdf").safeRelPath, "documents/or-1001.pdf");

  // 25b. Valid portable folder uploaded to POST /api/companies/import-portable
  const srcDir = path.join(TEST_EXTERNAL_DIR, "case25_upload_src");
  await createPortableCompanyFixture({
    dir: srcDir,
    companyId: "SERVER-IMPORT-25",
    legalName: "Remote Uploaded Books Corp.",
    encrypt: true,
    includePortableMeta: true,
    documentFiles: [{ id: "doc-25", fileName: "invoice-25.pdf", createOnDisk: true }],
  });

  const dbB64 = (await fs.readFile(path.join(srcDir, "database.lai"))).toString("base64");
  const metaB64 = (await fs.readFile(path.join(srcDir, PORTABLE_META_FILENAME))).toString("base64");
  const docB64 = (await fs.readFile(path.join(srcDir, "documents", "invoice-25.pdf"))).toString("base64");

  const importRes = await fetch(`${baseUrl}/api/companies/import-portable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [
        { relativePath: "database.lai", base64Content: dbB64 },
        { relativePath: PORTABLE_META_FILENAME, base64Content: metaB64 },
        { relativePath: "documents/invoice-25.pdf", base64Content: docB64 },
      ],
    }),
  });
  assert.equal(importRes.status, 200);
  const importBody = await importRes.json();
  assert.equal(importBody.success, true);
  assert.equal(importBody.company?.id, "SERVER-IMPORT-25");
  assert.equal(importBody.attachmentAudit?.missingCount, 0);

  // 25c. Duplicate upload triggers 409 conflict without silently overwriting
  const dupImportRes = await fetch(`${baseUrl}/api/companies/import-portable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [
        { relativePath: "database.lai", base64Content: dbB64 },
        { relativePath: PORTABLE_META_FILENAME, base64Content: metaB64 },
      ],
    }),
  });
  assert.equal(dupImportRes.status, 409);

  // 25d. Path traversal & executable upload blocked in staging
  await assert.rejects(
    async () => {
      await stageUploadedPortablePackage([{ relativePath: "../evil.sh", base64Content: Buffer.from("rm -rf /").toString("base64") }]);
    },
    /PATH_TRAVERSAL_BLOCKED|INVALID_PORTABLE_UPLOAD/i
  );
});

test("26. Integration: Tenant isolation prevents cross-company contamination and identity collisions", async () => {
  const registered = await CompanyManager.listCompanies({ includeSynthetic: true });
  const a = registered.find((c) => c.id === "PORTABLE-CASE-01");
  const b = registered.find((c) => c.id === "RESTORE-LAI-11");
  assert.ok(a && b);
  assert.notEqual(path.resolve(a.location), path.resolve(b.location));

  // Verify duplicate detector never identifies companies by folder name alone
  const sameFolderNameCheck = assessCompanyIdentityDuplicate({
    companyId: "BRAND-NEW-TENANT-26",
    selectedDirectory: path.join(TEST_EXTERNAL_DIR, "different_parent", path.basename(a.location)),
    registeredCompanies: registered,
  });
  assert.equal(sameFolderNameCheck.status, "NEW_COMPANY");
});

test("27. Integration: Full backup & recovery regression preserves company data across restore -> export -> restore", async () => {
  const { payload } = createSignedBackupArchive({
    companyId: "REGRESSION-27",
    companyName: "Baguio Cold Storage Corp.",
  });
  const dest1 = path.join(TEST_DATA_DIR, "regression_27_first");
  await RestoreService.restoreDatabase(payload, "REGRESSION-27", "NEW", null, dest1);

  // Export live backup from restored database
  const exportedPayload = await RestoreService.exportBackup("REGRESSION-27");
  assert.equal(exportedPayload.metadata.companyId, "REGRESSION-27");
  assert.ok(exportedPayload.data.companies.length >= 1);

  const laiBuffer = RestoreService.serializeLai(exportedPayload);
  const reDeserialized = RestoreService.deserializeLai(laiBuffer);
  const reValidated = RestoreService.validateBackupFile(reDeserialized);
  assert.equal(reValidated.metadata.companyId, "REGRESSION-27");
});

test("28. Integration: Existing standalone legacy portable folder (no portable_meta.json or manifest.json) remains fully compatible", async () => {
  const legacyDir = path.join(TEST_EXTERNAL_DIR, "case28_legacy_standalone");
  await createPortableCompanyFixture({
    dir: legacyDir,
    companyId: "LEGACY-STANDALONE-28",
    legalName: "Classic Standalone Sari-Sari Corp.",
    encrypt: true,
    includePortableMeta: false,
    includeManifest: false,
  });

  // Confirm neither portable_meta.json nor manifest.json exists beforehand
  assert.equal(fsSync.existsSync(path.join(legacyDir, PORTABLE_META_FILENAME)), false);
  assert.equal(fsSync.existsSync(path.join(legacyDir, "manifest.json")), false);

  // Discovery & registration still succeeds seamlessly and upgrades folder with portable_meta.json
  const manifest = await CompanyManager.browseAndRegisterCompanyFolder(legacyDir, { operation: "OPENED" });
  assert.equal(manifest.id, "LEGACY-STANDALONE-28");
  assert.equal(manifest.legalName, "Classic Standalone Sari-Sari Corp.");
  assert.equal(fsSync.existsSync(path.join(legacyDir, PORTABLE_META_FILENAME)), true);

  // Also verify disk space checker pure utility directly
  const spaceOk = await verifyDestinationDiskSpace(legacyDir, 1024);
  assert.equal(spaceOk.sufficient, true);
  const spaceFail = await verifyDestinationDiskSpace(legacyDir, 1024 * 1024 * 1024, 512);
  assert.equal(spaceFail.sufficient, false);
  assert.match(spaceFail.message, /INSUFFICIENT_DESTINATION_STORAGE/i);

  // Also verify pure attachment audit & remap utilities exist
  assert.equal(typeof auditPortableAttachmentsSync, "function");
  assert.equal(typeof remapRelocatedDocumentPathsSync, "function");
});
