import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { verifyBackupRestoreCredentials } from "./backupRestoreAuth";
import type { BackupPayload } from "./restoreService";

const OWNER_PASS = "OwnerStrong!2026";
const ADMIN_PASS = "AdminStrong!2026";
const VIEWER_PASS = "ViewerStrong!2026";
const CUSTOM_PASS = "CustomStrong!2026";

const ownerHash = bcrypt.hashSync(OWNER_PASS, 4);
const adminHash = bcrypt.hashSync(ADMIN_PASS, 4);
const viewerHash = bcrypt.hashSync(VIEWER_PASS, 4);
const customHash = bcrypt.hashSync(CUSTOM_PASS, 4);

function makeSampleBackupPayload(overrides?: Partial<BackupPayload["data"]>): BackupPayload {
  return {
    metadata: {
      version: "1.0",
      schemaVersion: "1.0",
      timestamp: "2026-11-19T10:00:00.000Z",
      checksum: "sample-checksum",
      signature: "sample-signature",
      format: "LAI_DATABASE_V1",
      companyId: "LGR-PH-2026-CORP-01",
      companyName: "Maharlika Trading Corp.",
    },
    data: {
      companies: [{ id: "LGR-PH-2026-CORP-01", legalName: "Maharlika Trading Corp." }],
      users: [
        {
          id: "u-owner",
          email: "owner@maharlika.ph",
          passwordHash: ownerHash,
          displayName: "Ricardo Santos",
          status: "ACTIVE",
        },
        {
          id: "u-admin",
          email: "admin@maharlika.ph",
          passwordHash: adminHash,
          displayName: "Elena Mendoza",
          status: "ACTIVE",
        },
        {
          id: "u-viewer",
          email: "viewer@maharlika.ph",
          passwordHash: viewerHash,
          displayName: "Junior Viewer",
          status: "ACTIVE",
        },
        {
          id: "u-disabled",
          email: "disabled@maharlika.ph",
          passwordHash: ownerHash,
          displayName: "Disabled Owner",
          status: "DISABLED",
        },
        {
          id: "u-custom",
          email: "accountant@maharlika.ph",
          passwordHash: customHash,
          displayName: "Senior CPA",
          status: "ACTIVE",
        },
      ],
      roles: [
        { id: "r-owner", code: "COMPANY_OWNER", name: "Company Owner" },
        { id: "r-admin", code: "COMPANY_ADMIN", name: "Company Administrator" },
        { id: "r-viewer", code: "VIEWER", name: "Read-only User" },
        { id: "r-acct", code: "ACCOUNTANT", name: "Accountant" },
      ],
      permissions: [{ id: "p-restore", code: "backup:restore" }],
      rolePermissions: [],
      companyUsers: [
        {
          id: "cu-owner",
          companyId: "LGR-PH-2026-CORP-01",
          userId: "u-owner",
          roleId: "r-owner",
          status: "ACTIVE",
          membershipStatus: "ACTIVE",
        },
        {
          id: "cu-admin",
          companyId: "LGR-PH-2026-CORP-01",
          userId: "u-admin",
          roleId: "r-admin",
          status: "ACTIVE",
          membershipStatus: "ACTIVE",
        },
        {
          id: "cu-viewer",
          companyId: "LGR-PH-2026-CORP-01",
          userId: "u-viewer",
          roleId: "r-viewer",
          status: "ACTIVE",
          membershipStatus: "ACTIVE",
        },
        {
          id: "cu-custom",
          companyId: "LGR-PH-2026-CORP-01",
          userId: "u-custom",
          roleId: "r-acct",
          status: "ACTIVE",
          membershipStatus: "ACTIVE",
        },
      ],
      companyUserRoles: [],
      userPermissionOverrides: [],
      ...overrides,
    },
  };
}

test("rejects missing or empty backupAuth credentials with 401", async () => {
  const payload = makeSampleBackupPayload();
  const r1 = await verifyBackupRestoreCredentials(payload, null);
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 401);
  assert.equal(r1.errorCode, "BACKUP_AUTH_REQUIRED");

  const r2 = await verifyBackupRestoreCredentials(payload, { email: "owner@maharlika.ph", password: "" });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 401);
  assert.equal(r2.errorCode, "BACKUP_AUTH_REQUIRED");
});

test("rejects invalid email or wrong password with 401 BACKUP_AUTH_INVALID", async () => {
  const payload = makeSampleBackupPayload();
  const wrongEmail = await verifyBackupRestoreCredentials(payload, {
    email: "stranger@other.ph",
    password: OWNER_PASS,
  });
  assert.equal(wrongEmail.ok, false);
  assert.equal(wrongEmail.status, 401);
  assert.equal(wrongEmail.errorCode, "BACKUP_AUTH_INVALID");

  const wrongPass = await verifyBackupRestoreCredentials(payload, {
    email: "owner@maharlika.ph",
    password: "WrongPassword123!",
  });
  assert.equal(wrongPass.ok, false);
  assert.equal(wrongPass.status, 401);
  assert.equal(wrongPass.errorCode, "BACKUP_AUTH_INVALID");
});

test("rejects disabled user account inside backup", async () => {
  const payload = makeSampleBackupPayload();
  const res = await verifyBackupRestoreCredentials(payload, {
    email: "disabled@maharlika.ph",
    password: OWNER_PASS,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.errorCode, "BACKUP_ACCOUNT_DISABLED");
});

test("rejects removed or suspended company membership with 403", async () => {
  const payload = makeSampleBackupPayload({
    companyUsers: [
      {
        id: "cu-admin",
        companyId: "LGR-PH-2026-CORP-01",
        userId: "u-admin",
        roleId: "r-admin",
        status: "ACTIVE",
        membershipStatus: "REMOVED",
      },
    ],
  });
  const res = await verifyBackupRestoreCredentials(payload, {
    email: "admin@maharlika.ph",
    password: ADMIN_PASS,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(res.errorCode, "BACKUP_MEMBERSHIP_INACTIVE");
});

test("rejects Read-only Viewer account lacking backup:restore with 403 BACKUP_RESTORE_FORBIDDEN", async () => {
  const payload = makeSampleBackupPayload();
  const res = await verifyBackupRestoreCredentials(payload, {
    email: "viewer@maharlika.ph",
    password: VIEWER_PASS,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(res.errorCode, "BACKUP_RESTORE_FORBIDDEN");
});

test("authorizes Company Owner (case-insensitive email) inside backup archive", async () => {
  const payload = makeSampleBackupPayload();
  const res = await verifyBackupRestoreCredentials(payload, {
    email: "  OWNER@MAHARLIKA.PH ",
    password: OWNER_PASS,
  });
  assert.equal(res.ok, true);
  assert.equal(res.actor?.userId, "u-owner");
  assert.equal(res.actor?.primaryRole, "Company Owner");
  assert.equal(res.actor?.authSource, "BACKUP_CREDENTIALS");
});

test("authorizes Company Administrator unless explicitly denied via userPermissionOverrides", async () => {
  const allowedPayload = makeSampleBackupPayload();
  const okRes = await verifyBackupRestoreCredentials(allowedPayload, {
    email: "admin@maharlika.ph",
    password: ADMIN_PASS,
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.actor?.primaryRole, "Company Administrator");

  const deniedPayload = makeSampleBackupPayload({
    userPermissionOverrides: [
      {
        id: "ov-1",
        companyUserId: "cu-admin",
        permissionCode: "backup:restore",
        effect: "DENY",
      },
    ],
  });
  const deniedRes = await verifyBackupRestoreCredentials(deniedPayload, {
    email: "admin@maharlika.ph",
    password: ADMIN_PASS,
  });
  assert.equal(deniedRes.ok, false);
  assert.equal(deniedRes.status, 403);
  assert.equal(deniedRes.errorCode, "BACKUP_RESTORE_FORBIDDEN");
});

test("authorizes Accountant granted explicit backup:restore permission override inside backup", async () => {
  const defaultPayload = makeSampleBackupPayload();
  const denied = await verifyBackupRestoreCredentials(defaultPayload, {
    email: "accountant@maharlika.ph",
    password: CUSTOM_PASS,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);

  const allowedPayload = makeSampleBackupPayload({
    userPermissionOverrides: [
      {
        id: "ov-allow-1",
        companyUserId: "cu-custom",
        permissionCode: "backup:restore",
        effect: "ALLOW",
      },
    ],
  });
  const allowed = await verifyBackupRestoreCredentials(allowedPayload, {
    email: "accountant@maharlika.ph",
    password: CUSTOM_PASS,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.actor?.primaryRole, "Accountant");
});
