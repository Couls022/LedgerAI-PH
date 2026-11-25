import { test } from "vitest";
import assert from "node:assert/strict";
import { AutomatedBackupScheduler } from "../../src/server/services/automatedBackupScheduler";
import { RestoreService } from "../../src/server/services/restoreService";
import { CompanyManager } from "../../src/server/services/companyManager";
import { OperationalLogger } from "../../src/server/services/operationalLogger";

test("RestoreService.isBackupLocked tracks lock lifecycle", () => {
  const companyId = "TEST-LOCK-TRACKING";
  RestoreService.releaseBackupLock(companyId);

  assert.equal(RestoreService.isBackupLocked(companyId), false);
  assert.equal(RestoreService.acquireBackupLock(companyId), true);
  assert.equal(RestoreService.isBackupLocked(companyId), true);
  assert.equal(RestoreService.acquireBackupLock(companyId), false);

  RestoreService.releaseBackupLock(companyId);
  assert.equal(RestoreService.isBackupLocked(companyId), false);
});

test("AutomatedBackupScheduler skips silently without error log when backup lock is already active", async () => {
  const companyId = "TEST-LOCK-PRECHECK";
  RestoreService.releaseBackupLock(companyId);
  assert.equal(RestoreService.acquireBackupLock(companyId), true);

  const origGetDb = CompanyManager.getCompanyDb;
  const origError = OperationalLogger.error;
  const origInfo = OperationalLogger.info;

  let getDbCalled = false;
  const errorCalls: any[] = [];
  const infoCalls: any[] = [];

  (CompanyManager as any).getCompanyDb = async () => {
    getDbCalled = true;
    return null;
  };
  (OperationalLogger as any).error = (...args: any[]) => {
    errorCalls.push(args);
  };
  (OperationalLogger as any).info = (...args: any[]) => {
    infoCalls.push(args);
  };

  try {
    const result = await AutomatedBackupScheduler.runBackupCheckForCompany(companyId);
    assert.equal(result, false);
    assert.equal(getDbCalled, false);
    assert.equal(errorCalls.length, 0);
    assert.ok(infoCalls.some((c) => c[0] === "AutomatedBackupScheduler"));
  } finally {
    RestoreService.releaseBackupLock(companyId);
    (CompanyManager as any).getCompanyDb = origGetDb;
    (OperationalLogger as any).error = origError;
    (OperationalLogger as any).info = origInfo;
  }
});

test("AutomatedBackupScheduler handles CONCURRENCY_LOCK thrown during race without OperationalLogger.error", async () => {
  const companyId = "LGR-PH-2026-STRESS-DG-PREVIEW-RACE";
  RestoreService.releaseBackupLock(companyId);

  const origGetDb = CompanyManager.getCompanyDb;
  const origCreateBackup = RestoreService.createAtomicBackup;
  const origError = OperationalLogger.error;
  const origInfo = OperationalLogger.info;

  const errorCalls: any[] = [];
  const infoCalls: any[] = [];

  // Minimal Drizzle-like mock returning no prior backups so needsBackup = true
  const mockChain = {
    from: () => mockChain,
    where: () => mockChain,
    orderBy: () => mockChain,
    limit: () => mockChain,
    get: async () => null
  };
  (CompanyManager as any).getCompanyDb = async () => ({
    select: () => mockChain
  });
  (RestoreService as any).createAtomicBackup = async () => {
    throw new Error("CONCURRENCY_LOCK: A backup operation is already in progress for this company. Please wait until it completes.");
  };
  (OperationalLogger as any).error = (...args: any[]) => {
    errorCalls.push(args);
  };
  (OperationalLogger as any).info = (...args: any[]) => {
    infoCalls.push(args);
  };

  try {
    const result = await AutomatedBackupScheduler.runBackupCheckForCompany(companyId);
    assert.equal(result, false);
    assert.equal(errorCalls.length, 0);
    assert.ok(
      infoCalls.some(
        (c) =>
          c[0] === "AutomatedBackupScheduler" &&
          String(c[1]?.message || "").includes("lock contention")
      )
    );
  } finally {
    (CompanyManager as any).getCompanyDb = origGetDb;
    (RestoreService as any).createAtomicBackup = origCreateBackup;
    (OperationalLogger as any).error = origError;
    (OperationalLogger as any).info = origInfo;
  }
});

test("AutomatedBackupScheduler deduplicates overlapping concurrent checks for the same company", async () => {
  const companyId = "TEST-OVERLAPPING-CHECKS";
  RestoreService.releaseBackupLock(companyId);

  const origGetDb = CompanyManager.getCompanyDb;
  const origCreateBackup = RestoreService.createAtomicBackup;
  const origInfo = OperationalLogger.info;
  const origError = OperationalLogger.error;

  let backupCalls = 0;
  let releaseFirstCheck!: () => void;
  const firstCheckGate = new Promise<void>((resolve) => {
    releaseFirstCheck = resolve;
  });

  const mockChain = {
    from: () => mockChain,
    where: () => mockChain,
    orderBy: () => mockChain,
    limit: () => mockChain,
    get: async () => null
  };
  (CompanyManager as any).getCompanyDb = async () => ({
    select: () => mockChain
  });
  (RestoreService as any).createAtomicBackup = async () => {
    backupCalls += 1;
    await firstCheckGate;
    return { id: "b1", filename: "b1.lai", backupPath: "/tmp/b1.lai", checksum: "abc", sizeBytes: 10, payload: {} as any };
  };
  (OperationalLogger as any).info = () => {};
  const errorCalls: any[] = [];
  (OperationalLogger as any).error = (...args: any[]) => errorCalls.push(args);

  try {
    const firstPromise = AutomatedBackupScheduler.runBackupCheckForCompany(companyId);
    // Allow microtasks to enter createAtomicBackup
    await new Promise((r) => setTimeout(r, 15));
    const secondResult = await AutomatedBackupScheduler.runBackupCheckForCompany(companyId);

    assert.equal(secondResult, false);
    assert.equal(backupCalls, 1);

    releaseFirstCheck();
    const firstResult = await firstPromise;
    assert.equal(firstResult, true);
    assert.equal(errorCalls.length, 0);
  } finally {
    (CompanyManager as any).getCompanyDb = origGetDb;
    (RestoreService as any).createAtomicBackup = origCreateBackup;
    (OperationalLogger as any).info = origInfo;
    (OperationalLogger as any).error = origError;
  }
});

test("AutomatedBackupScheduler still logs unexpected non-lock errors via OperationalLogger.error", async () => {
  const companyId = "TEST-UNEXPECTED-ERR";
  RestoreService.releaseBackupLock(companyId);

  const origGetDb = CompanyManager.getCompanyDb;
  const origError = OperationalLogger.error;
  const errorCalls: any[] = [];

  (CompanyManager as any).getCompanyDb = async () => {
    throw new Error("DISK_IO_FAILURE");
  };
  (OperationalLogger as any).error = (...args: any[]) => {
    errorCalls.push(args);
  };

  try {
    const result = await AutomatedBackupScheduler.runBackupCheckForCompany(companyId);
    assert.equal(result, false);
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0][0], "AutomatedBackupScheduler Error");
  } finally {
    (CompanyManager as any).getCompanyDb = origGetDb;
    (OperationalLogger as any).error = origError;
  }
});
