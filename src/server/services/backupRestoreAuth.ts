import bcrypt from "bcryptjs";
import { LedgerRole, ROLE_HIERARCHY, normalizeRole } from "../auth";
import type { BackupPayload } from "./restoreService";

export interface BackupAuthCredentials {
  email: string;
  password: string;
}

export interface VerifiedBackupActor {
  userId: string;
  email: string;
  displayName: string;
  primaryRole: LedgerRole;
  roles: LedgerRole[];
  authSource: "BACKUP_CREDENTIALS";
}

export interface BackupAuthResult {
  ok: boolean;
  status?: 401 | 403;
  errorCode?:
    | "BACKUP_AUTH_REQUIRED"
    | "BACKUP_AUTH_INVALID"
    | "BACKUP_ACCOUNT_DISABLED"
    | "BACKUP_ACCOUNT_LOCKED"
    | "BACKUP_MEMBERSHIP_INACTIVE"
    | "BACKUP_RESTORE_FORBIDDEN";
  message?: string;
  actor?: VerifiedBackupActor;
}

// Precomputed valid bcrypt hash used only to equalize timing when a submitted email is absent
const DUMMY_BCRYPT_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8u9pQ9Z0C8z9F4Q3m9J6t8kY7w9b6e";

const RESTORE_PRIVILEGE_CODES = new Set([
  "*",
  "backup:restore",
  "backups:restore",
  "backup:manage",
  "backups:manage",
]);

function isEffectiveNow(effectiveFrom?: string | null, effectiveTo?: string | null): boolean {
  const now = Date.now();
  if (effectiveFrom) {
    const start = Date.parse(effectiveFrom);
    if (!Number.isNaN(start) && now < start) return false;
  }
  if (effectiveTo) {
    const end = Date.parse(effectiveTo);
    if (!Number.isNaN(end) && now > end) return false;
  }
  return true;
}

/**
 * Pure enterprise Cold / Disaster-Recovery authorization against a verified `.lai` backup payload.
 *
 * Used when restoring a company backup on a fresh machine or Zero-Data workspace where no
 * active authenticated company session exists yet (QuickBooks Enterprise-style restore).
 * Verifies the Company Owner / Administrator (or explicit `backup:restore` holder) directly
 * against the users, memberships, roles, rolePermissions, and userPermissionOverrides tables
 * stored inside the cryptographically verified backup archive itself.
 */
export async function verifyBackupRestoreCredentials(
  payload: BackupPayload,
  credentials: unknown
): Promise<BackupAuthResult> {
  if (!credentials || typeof credentials !== "object") {
    return {
      ok: false,
      status: 401,
      errorCode: "BACKUP_AUTH_REQUIRED",
      message:
        "Company Owner or Administrator credentials from inside the backup archive are required to authorize Cold Restore.",
    };
  }

  const rawEmail = typeof (credentials as any).email === "string" ? (credentials as any).email.trim() : "";
  const rawPassword = typeof (credentials as any).password === "string" ? (credentials as any).password : "";

  if (!rawEmail || !rawPassword) {
    return {
      ok: false,
      status: 401,
      errorCode: "BACKUP_AUTH_REQUIRED",
      message: "Both email and password from an authorized account inside this backup archive are required.",
    };
  }

  const normalizedEmail = rawEmail.toLowerCase();
  const usersList = Array.isArray(payload?.data?.users) ? payload.data.users : [];
  const matchedUser = usersList.find(
    (u: any) => typeof u?.email === "string" && u.email.trim().toLowerCase() === normalizedEmail
  );

  if (!matchedUser || !matchedUser.passwordHash) {
    await bcrypt.compare(rawPassword, DUMMY_BCRYPT_HASH).catch(() => false);
    return {
      ok: false,
      status: 401,
      errorCode: "BACKUP_AUTH_INVALID",
      message: "Invalid Company Owner or Administrator email or password for this backup archive.",
    };
  }

  if (String(matchedUser.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
    return {
      ok: false,
      status: 401,
      errorCode: "BACKUP_ACCOUNT_DISABLED",
      message: "This user account is disabled inside the backup archive and cannot authorize restoration.",
    };
  }

  if (matchedUser.lockedUntil) {
    const lockedUntilMs =
      typeof matchedUser.lockedUntil === "number"
        ? matchedUser.lockedUntil
        : Date.parse(String(matchedUser.lockedUntil));
    if (!Number.isNaN(lockedUntilMs) && lockedUntilMs > Date.now()) {
      return {
        ok: false,
        status: 401,
        errorCode: "BACKUP_ACCOUNT_LOCKED",
        message: "This user account is locked inside the backup archive.",
      };
    }
  }

  const passwordValid = await bcrypt.compare(rawPassword, String(matchedUser.passwordHash));
  if (!passwordValid) {
    return {
      ok: false,
      status: 401,
      errorCode: "BACKUP_AUTH_INVALID",
      message: "Invalid Company Owner or Administrator email or password for this backup archive.",
    };
  }

  const backupCompanyId = String(payload?.metadata?.companyId || "");
  const companyUsersList = Array.isArray(payload?.data?.companyUsers) ? payload.data.companyUsers : [];
  const membership =
    companyUsersList.find(
      (m: any) =>
        m?.userId === matchedUser.id &&
        (!backupCompanyId || !m?.companyId || String(m.companyId) === backupCompanyId)
    ) || null;

  const rolesList = Array.isArray(payload?.data?.roles) ? payload.data.roles : [];
  const rolesById = new Map<string, any>(rolesList.map((r: any) => [String(r.id), r]));
  const companyUserRolesList = Array.isArray(payload?.data?.companyUserRoles) ? payload.data.companyUserRoles : [];
  const rolePermissionsList = Array.isArray(payload?.data?.rolePermissions) ? payload.data.rolePermissions : [];
  const permissionsList = Array.isArray(payload?.data?.permissions) ? payload.data.permissions : [];
  const permissionsById = new Map<string, any>(permissionsList.map((p: any) => [String(p.id), p]));
  const overridesList = Array.isArray(payload?.data?.userPermissionOverrides)
    ? payload.data.userPermissionOverrides
    : [];

  let resolvedRoles: LedgerRole[] = [];
  let assignedRoleIds = new Set<string>();

  if (membership) {
    const statusStr = String(membership.status || "ACTIVE").toUpperCase();
    const memStatusStr = String(membership.membershipStatus || membership.status || "ACTIVE").toUpperCase();
    if (statusStr !== "ACTIVE" || memStatusStr === "REMOVED" || memStatusStr === "SUSPENDED") {
      return {
        ok: false,
        status: 403,
        errorCode: "BACKUP_MEMBERSHIP_INACTIVE",
        message: "This account does not have an active company membership inside the backup archive.",
      };
    }

    const activeMultiRoles = companyUserRolesList.filter(
      (cur: any) =>
        cur?.companyUserId === membership.id &&
        String(cur?.assignmentStatus || "ACTIVE").toUpperCase() === "ACTIVE" &&
        isEffectiveNow(cur?.effectiveFrom, cur?.effectiveTo)
    );

    for (const cur of activeMultiRoles) {
      if (cur?.roleId) assignedRoleIds.add(String(cur.roleId));
      const roleRec = cur?.roleId ? rolesById.get(String(cur.roleId)) : null;
      const normalized = normalizeRole(roleRec?.code || roleRec?.name || cur?.roleCode);
      if (!resolvedRoles.includes(normalized)) resolvedRoles.push(normalized);
    }

    if (membership.roleId) {
      assignedRoleIds.add(String(membership.roleId));
      const primaryRoleRec = rolesById.get(String(membership.roleId));
      const normalized = normalizeRole(primaryRoleRec?.code || primaryRoleRec?.name || membership.legacyRole);
      if (!resolvedRoles.includes(normalized)) resolvedRoles.push(normalized);
    } else if (membership.legacyRole) {
      const normalized = normalizeRole(membership.legacyRole);
      if (!resolvedRoles.includes(normalized)) resolvedRoles.push(normalized);
    }
  } else {
    const userRoleUpper = String(matchedUser.role || "").toUpperCase();
    if (userRoleUpper === "OWNER" || userRoleUpper === "COMPANY_OWNER") {
      resolvedRoles = ["Company Owner"];
    } else {
      return {
        ok: false,
        status: 403,
        errorCode: "BACKUP_MEMBERSHIP_INACTIVE",
        message: "This account is not a member of the company inside this backup archive.",
      };
    }
  }

  if (resolvedRoles.length === 0) {
    resolvedRoles = ["Read-only User"];
  }

  const primaryRole = [...resolvedRoles].sort(
    (a, b) => (ROLE_HIERARCHY[b] || 0) - (ROLE_HIERARCHY[a] || 0)
  )[0];

  // Company Owner always retains unrestricted restore privileges
  const isOwner = resolvedRoles.includes("Company Owner");
  if (!isOwner) {
    const userOverrides = membership
      ? overridesList.filter((ov: any) => ov?.companyUserId === membership.id)
      : [];

    const explicitDenies = new Set(
      userOverrides
        .filter((ov: any) => String(ov?.effect || "").toUpperCase() === "DENY")
        .map((ov: any) => String(ov.permissionCode || "").toLowerCase())
    );
    const explicitAllows = new Set(
      userOverrides
        .filter((ov: any) => String(ov?.effect || "").toUpperCase() === "ALLOW")
        .map((ov: any) => String(ov.permissionCode || "").toLowerCase())
    );

    if (explicitDenies.has("backup:restore") || explicitDenies.has("backups:restore")) {
      return {
        ok: false,
        status: 403,
        errorCode: "BACKUP_RESTORE_FORBIDDEN",
        message: "Restore privileges were explicitly revoked for this account inside the backup archive.",
      };
    }

    const grantedByRole =
      resolvedRoles.includes("Company Administrator") ||
      rolePermissionsList.some((rp: any) => {
        if (!assignedRoleIds.has(String(rp?.roleId))) return false;
        const perm = permissionsById.get(String(rp?.permissionId));
        const code = String(perm?.code || "").toLowerCase();
        return RESTORE_PRIVILEGE_CODES.has(code);
      });

    const grantedByOverride = [...explicitAllows].some((code) => RESTORE_PRIVILEGE_CODES.has(code));

    if (!grantedByRole && !grantedByOverride) {
      return {
        ok: false,
        status: 403,
        errorCode: "BACKUP_RESTORE_FORBIDDEN",
        message: `Role '${primaryRole}' does not have 'backup:restore' privileges inside this backup archive. Please sign in with a Company Owner or Administrator account from this backup.`,
      };
    }
  }

  return {
    ok: true,
    actor: {
      userId: String(matchedUser.id),
      email: String(matchedUser.email),
      displayName: String(matchedUser.displayName || matchedUser.email),
      primaryRole,
      roles: resolvedRoles,
      authSource: "BACKUP_CREDENTIALS",
    },
  };
}
