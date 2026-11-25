import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ISOLATED_TEST_ROOT = '/tmp/ledgerai_backup_storage_rbac_isolated';
process.env.LEDGERAI_DATA_DIR = path.join(ISOLATED_TEST_ROOT, 'companies');
process.env.LEDGERAI_CONFIG_DIR = path.join(ISOLATED_TEST_ROOT, 'config');

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { eq } from 'drizzle-orm';
import { getAuthorizedERPModules, isRouteAuthorizedForUser } from '../../src/shared/moduleRegistry';

describe('Backup & Storage RBAC Security Regression Gate (Sections 1–6)', () => {
  const app = createApp();
  const companyAId = 'LGR-PH-BK-GATE-A';
  const companyBId = 'LGR-PH-BK-GATE-B';
  let ownerAToken: string;
  let ownerAMembershipId: string;
  let ownerAUserId: string;
  let ownerBToken: string;
  let companyABackupId: string;
  let companyBBackupId: string;
  let companyADir: string;
  let companyBDir: string;

  async function createTestUserSession(
    companyId: string,
    userId: string,
    email: string,
    displayName: string,
    roleName: string
  ) {
    const companyDb = await CompanyManager.getCompanyDb(companyId);
    return await dbContext.run(companyDb, async () => {
      await db.insert(schema.users).values({
        id: userId,
        email,
        displayName,
        passwordHash: 'test_hash',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord(roleName);
      const memId = `mem-${companyId}-${userId}`;

      await db.insert(schema.companyUsers).values({
        id: memId,
        userId,
        companyId,
        roleId: roleRec.id,
        legacyRole: roleName,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
        approvalLimitCentavos: 0
      }).onConflictDoNothing();

      await RbacService.setMemberRoles(null, memId, [roleName], `Provisioned ${roleName} for Backup/Storage RBAC gate`);

      const rawToken = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawToken),
        userId,
        companyId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      return { token: `${companyId}.${rawToken}`, memId, userId };
    });
  }

  async function createMemberWithProfile(params: {
    companyId: string;
    emailPrefix: string;
    roleName: string;
    moduleAssignments?: Array<{
      moduleId: string;
      submoduleIds: string[];
      actions: string[];
      effect?: 'ALLOW' | 'DENY';
      origin?: string;
    }>;
    permissionOverrides?: Array<{
      permissionCode: string;
      effect: 'ALLOW' | 'DENY';
    }>;
  }): Promise<{ token: string; userId: string; membershipId: string; resolvedAccess: any }> {
    const uid = `usr-${params.emailPrefix.replace(/[^a-zA-Z0-9]/g, '-')}-${Math.floor(Math.random() * 10000)}`;
    const email = `${params.emailPrefix}.${Date.now()}.${Math.floor(Math.random() * 10000)}@test.ph`;

    const created = await createTestUserSession(
      params.companyId,
      uid,
      email,
      `Test ${params.emailPrefix}`,
      params.roleName
    );
    const membershipId = created.memId;

    if (params.moduleAssignments) {
      const putModRes = await request(app)
        .put(`/api/rbac/members/${membershipId}/module-assignments`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          reason: `Configure profile ${params.emailPrefix}`,
          moduleAssignments: params.moduleAssignments
        });
      expect(putModRes.status).toBe(200);
    }

    if (params.permissionOverrides) {
      for (const ov of params.permissionOverrides) {
        const ovRes = await request(app)
          .post(`/api/rbac/members/${membershipId}/overrides`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({
            permissionCode: ov.permissionCode,
            effect: ov.effect,
            reason: `Override ${ov.permissionCode}=${ov.effect} for ${params.emailPrefix}`
          });
        expect(ovRes.status).toBe(200);
      }
    }

    const companyDb = await CompanyManager.getCompanyDb(params.companyId);
    const resolvedAccess = await dbContext.run(companyDb, async () => {
      return await RbacService.resolveEffectiveAccess(membershipId);
    });

    return {
      token: created.token,
      userId: created.userId,
      membershipId,
      resolvedAccess
    };
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_TEST_ROOT)) {
      try { fs.rmSync(ISOLATED_TEST_ROOT, { recursive: true, force: true }); } catch {}
    }
    await CompanyManager.init();

    // 1. Provision Isolated Company A
    await CompanyManager.createCompanyProfile(
      companyAId,
      'RBAC Gate Company A Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    const dbA = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
    });

    const ownerA = await createTestUserSession(companyAId, 'usr-owner-a', 'owner.a@gate.ph', 'Owner A', 'Company Owner');
    ownerAToken = ownerA.token;
    ownerAMembershipId = ownerA.memId;
    ownerAUserId = ownerA.userId;

    const metaA = await CompanyManager.getCompanyManifest(companyAId);
    companyADir = metaA!.location || path.dirname(metaA!.dbPath);

    // Create initial backup in Company A
    const createBkA = await request(app)
      .post('/api/audit-advanced/backups/create')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ backupName: 'CompanyA_Baseline_Backup' });
    expect(createBkA.status).toBe(200);
    companyABackupId = createBkA.body.id;

    // Sync Company A encrypted snapshot so database.lai and manifest.dbChecksum are fresh
    await CompanyManager.syncCompanyDatabaseSnapshot(companyAId);

    // 2. Provision Isolated Company B
    await CompanyManager.createCompanyProfile(
      companyBId,
      'RBAC Gate Company B Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    const dbB = await CompanyManager.getCompanyDb(companyBId);
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
    });

    const ownerB = await createTestUserSession(companyBId, 'usr-owner-b', 'owner.b@gate.ph', 'Owner B', 'Company Owner');
    ownerBToken = ownerB.token;

    const metaB = await CompanyManager.getCompanyManifest(companyBId);
    companyBDir = metaB!.location || path.dirname(metaB!.dbPath);

    // Create initial backup in Company B
    const createBkB = await request(app)
      .post('/api/audit-advanced/backups/create')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ backupName: 'CompanyB_Baseline_Backup' });
    expect(createBkB.status).toBe(200);
    companyBBackupId = createBkB.body.id;

    await CompanyManager.syncCompanyDatabaseSnapshot(companyBId);
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_TEST_ROOT)) {
      try { fs.rmSync(ISOLATED_TEST_ROOT, { recursive: true, force: true }); } catch {}
    }
  });

  describe('1. PERMISSION SEPARATION', () => {
    it('strictly separates storage:view, storage:cleanup, backups:view, backups:create, backups:verify, backups:restore, backups:download and prevents broad legacy aliases', async () => {
      // Profile with masterdata:view and settings:view only (via master-data with md-customers & md-settings, WITHOUT md-backup-vault)
      const masterDataOnlyUser = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'sep.masterdata',
        roleName: 'Accountant',
        moduleAssignments: [
          {
            moduleId: 'master-data',
            submoduleIds: ['md-customers', 'md-settings'],
            actions: ['view', 'create', 'edit']
          }
        ]
      });

      const mdPerms = masterDataOnlyUser.resolvedAccess.effectivePermissions as string[];
      expect(mdPerms).toContain('masterdata:view');
      expect(mdPerms).toContain('settings:view');
      expect(mdPerms).not.toContain('backups:view');
      expect(mdPerms).not.toContain('backup:view');
      expect(mdPerms).not.toContain('backups:create');
      expect(mdPerms).not.toContain('backups:verify');
      expect(mdPerms).not.toContain('backups:restore');
      expect(mdPerms).not.toContain('backups:download');
      expect(mdPerms).not.toContain('storage:view');
      expect(mdPerms).not.toContain('storage:cleanup');
      expect(mdPerms).not.toContain('storage:manage');
    });
  });

  describe('2. ENDPOINT AUTHORIZATION MATRIX (Profiles A–K × 7 Endpoints)', () => {
    it('enforces exact authorization across all 7 endpoints for Profiles A through K without unintended state mutations', async () => {
      // Create a cleanable temp .lai file in Company A so delete/clean-all have a valid target when authorized
      const createTempLaiFile = (suffix: string) => {
        const p = path.join(companyADir, `temp_matrix_${suffix}.tmp.lai`);
        fs.writeFileSync(p, `temporary-lai-cache-${suffix}-${Date.now()}`);
        return p;
      };

      // Build Profiles A through K
      // Profile A: No relevant permissions (dashboard:view only)
      const profileA = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profA.none',
        roleName: 'Read-only User',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ]
      });

      // Profile B: masterdata:view only
      const profileB = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profB.masterdata',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'master-data', submoduleIds: ['md-customers'], actions: ['view'] }
        ]
      });
      expect(profileB.resolvedAccess.effectivePermissions).toContain('masterdata:view');
      expect(profileB.resolvedAccess.effectivePermissions).not.toContain('backups:view');
      expect(profileB.resolvedAccess.effectivePermissions).not.toContain('storage:view');

      // Profile C: storage:view only
      const profileC = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profC.storage.view',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ],
        permissionOverrides: [
          { permissionCode: 'storage:view', effect: 'ALLOW' }
        ]
      });
      expect(profileC.resolvedAccess.effectivePermissions).toContain('storage:view');
      expect(profileC.resolvedAccess.effectivePermissions).not.toContain('backups:view');
      expect(profileC.resolvedAccess.effectivePermissions).not.toContain('storage:cleanup');

      // Profile D: backups:view only
      const profileD = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profD.backups.view',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ],
        permissionOverrides: [
          { permissionCode: 'backups:view', effect: 'ALLOW' }
        ]
      });
      expect(profileD.resolvedAccess.effectivePermissions).toContain('backups:view');
      expect(profileD.resolvedAccess.effectivePermissions).not.toContain('storage:view');
      expect(profileD.resolvedAccess.effectivePermissions).not.toContain('backups:create');
      expect(profileD.resolvedAccess.effectivePermissions).not.toContain('backups:verify');
      expect(profileD.resolvedAccess.effectivePermissions).not.toContain('backups:restore');

      // Profile E: backups:create only
      const profileE = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profE.backups.create',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ],
        permissionOverrides: [
          { permissionCode: 'backups:create', effect: 'ALLOW' }
        ]
      });
      expect(profileE.resolvedAccess.effectivePermissions).toContain('backups:create');
      expect(profileE.resolvedAccess.effectivePermissions).not.toContain('backups:view');
      expect(profileE.resolvedAccess.effectivePermissions).not.toContain('backups:verify');
      expect(profileE.resolvedAccess.effectivePermissions).not.toContain('backups:restore');

      // Profile F: backups:verify only
      const profileF = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profF.backups.verify',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ],
        permissionOverrides: [
          { permissionCode: 'backups:verify', effect: 'ALLOW' }
        ]
      });
      expect(profileF.resolvedAccess.effectivePermissions).toContain('backups:verify');
      expect(profileF.resolvedAccess.effectivePermissions).not.toContain('backups:view');
      expect(profileF.resolvedAccess.effectivePermissions).not.toContain('backups:create');
      expect(profileF.resolvedAccess.effectivePermissions).not.toContain('backups:restore');

      // Profile G: backups:restore only
      const profileG = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profG.backups.restore',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ],
        permissionOverrides: [
          { permissionCode: 'backups:restore', effect: 'ALLOW' }
        ]
      });
      expect(profileG.resolvedAccess.effectivePermissions).toContain('backups:restore');
      expect(profileG.resolvedAccess.effectivePermissions).not.toContain('backups:view');
      expect(profileG.resolvedAccess.effectivePermissions).not.toContain('backups:create');
      expect(profileG.resolvedAccess.effectivePermissions).not.toContain('backups:verify');

      // Profile H: storage:cleanup only
      const profileH = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profH.storage.cleanup',
        roleName: 'Bookkeeper',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'] }
        ],
        permissionOverrides: [
          { permissionCode: 'storage:cleanup', effect: 'ALLOW' }
        ]
      });
      expect(profileH.resolvedAccess.effectivePermissions).toContain('storage:cleanup');
      expect(profileH.resolvedAccess.effectivePermissions).not.toContain('storage:view');
      expect(profileH.resolvedAccess.effectivePermissions).not.toContain('backups:view');

      // Profile I: Authorized Company Administrator (full default template)
      const profileI = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profI.company.admin',
        roleName: 'Company Administrator'
      });

      // Profile J: Company Administrator with explicit DENY on backup/storage permissions (via unchecked md-backup-vault + explicit DENY overrides)
      const profileJ = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profJ.explicit.deny',
        roleName: 'Company Administrator',
        moduleAssignments: [
          {
            moduleId: 'dashboard',
            submoduleIds: ['dash-overview'],
            actions: ['view']
          },
          {
            moduleId: 'master-data',
            submoduleIds: ['md-customers', 'md-settings'], // md-backup-vault unchecked!
            actions: ['view', 'create', 'edit']
          }
        ],
        permissionOverrides: [
          { permissionCode: 'backups:view', effect: 'DENY' },
          { permissionCode: 'backups:create', effect: 'DENY' },
          { permissionCode: 'backups:verify', effect: 'DENY' },
          { permissionCode: 'backups:restore', effect: 'DENY' },
          { permissionCode: 'storage:view', effect: 'DENY' },
          { permissionCode: 'storage:cleanup', effect: 'DENY' },
          { permissionCode: 'backup:manage', effect: 'DENY' },
          { permissionCode: 'storage:manage', effect: 'DENY' }
        ]
      });

      // Profile K: Accountant with explicit GRANT on md-backup-vault (view + verify + create)
      const profileK = await createMemberWithProfile({
        companyId: companyAId,
        emailPrefix: 'profK.explicit.grant',
        roleName: 'Accountant',
        moduleAssignments: [
          {
            moduleId: 'master-data',
            submoduleIds: ['md-backup-vault'],
            actions: ['view', 'verify', 'create']
          }
        ]
      });

      const profiles = [
        {
          id: 'A',
          name: 'No relevant permissions',
          token: profileA.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 403, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'B',
          name: 'masterdata:view only',
          token: profileB.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 403, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'C',
          name: 'storage:view only',
          token: profileC.token,
          expected: { scan: 200, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 403, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'D',
          name: 'backups:view only',
          token: profileD.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 200, createBackup: 403, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'E',
          name: 'backups:create only',
          token: profileE.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 200, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'F',
          name: 'backups:verify only',
          token: profileF.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 403, restoreBackup: 403, integrityCheck: 200 }
        },
        {
          id: 'G',
          name: 'backups:restore only',
          token: profileG.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 403, restoreBackup: 200, integrityCheck: 403 }
        },
        {
          id: 'H',
          name: 'storage:cleanup only',
          token: profileH.token,
          expected: { scan: 403, delete: 200, cleanAll: 200, listBackups: 403, createBackup: 403, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'I',
          name: 'Authorized Company Administrator',
          token: profileI.token,
          expected: { scan: 200, delete: 200, cleanAll: 200, listBackups: 200, createBackup: 200, restoreBackup: 200, integrityCheck: 200 }
        },
        {
          id: 'J',
          name: 'Custom user with explicit DENY',
          token: profileJ.token,
          expected: { scan: 403, delete: 403, cleanAll: 403, listBackups: 403, createBackup: 403, restoreBackup: 403, integrityCheck: 403 }
        },
        {
          id: 'K',
          name: 'Custom user with explicit GRANT (view, verify, create)',
          token: profileK.token,
          expected: { scan: 200, delete: 403, cleanAll: 403, listBackups: 200, createBackup: 200, restoreBackup: 403, integrityCheck: 200 }
        }
      ];

      const dbA = await CompanyManager.getCompanyDb(companyAId);

      for (const prof of profiles) {
        // 1. GET /api/lai-cleanup/scan
        const scanRes = await request(app)
          .get('/api/lai-cleanup/scan')
          .set('Authorization', `Bearer ${prof.token}`);
        expect(scanRes.status, `Profile ${prof.id} (${prof.name}) GET /api/lai-cleanup/scan`).toBe(prof.expected.scan);

        // 2. POST /api/lai-cleanup/delete
        const tempFileForDelete = createTempLaiFile(`del_${prof.id}`);
        const delRes = await request(app)
          .post('/api/lai-cleanup/delete')
          .set('Authorization', `Bearer ${prof.token}`)
          .send({ filePaths: [tempFileForDelete] });
        expect(delRes.status, `Profile ${prof.id} (${prof.name}) POST /api/lai-cleanup/delete`).toBe(prof.expected.delete);
        if (prof.expected.delete === 403) {
          // Verify file was NOT deleted on 403
          expect(fs.existsSync(tempFileForDelete)).toBe(true);
          fs.unlinkSync(tempFileForDelete);
        } else {
          expect(fs.existsSync(tempFileForDelete)).toBe(false);
        }

        // 3. POST /api/lai-cleanup/clean-all
        const tempFileForCleanAll = createTempLaiFile(`cleanall_${prof.id}`);
        const cleanAllRes = await request(app)
          .post('/api/lai-cleanup/clean-all')
          .set('Authorization', `Bearer ${prof.token}`);
        expect(cleanAllRes.status, `Profile ${prof.id} (${prof.name}) POST /api/lai-cleanup/clean-all`).toBe(prof.expected.cleanAll);
        if (prof.expected.cleanAll === 403) {
          expect(fs.existsSync(tempFileForCleanAll)).toBe(true);
          fs.unlinkSync(tempFileForCleanAll);
        } else {
          expect(fs.existsSync(tempFileForCleanAll)).toBe(false);
        }

        // 4. GET /api/audit-advanced/backups
        const listRes = await request(app)
          .get('/api/audit-advanced/backups')
          .set('Authorization', `Bearer ${prof.token}`);
        expect(listRes.status, `Profile ${prof.id} (${prof.name}) GET /api/audit-advanced/backups`).toBe(prof.expected.listBackups);

        // 5. POST /api/audit-advanced/backups/create
        const beforeBackupsCount = (await dbA.select().from(schema.systemBackups).where(eq(schema.systemBackups.companyId, companyAId))).length;
        const createRes = await request(app)
          .post('/api/audit-advanced/backups/create')
          .set('Authorization', `Bearer ${prof.token}`)
          .send({ backupName: `Prof_${prof.id}_Backup` });
        expect(createRes.status, `Profile ${prof.id} (${prof.name}) POST /api/audit-advanced/backups/create`).toBe(prof.expected.createBackup);
        const afterBackupsCount = (await dbA.select().from(schema.systemBackups).where(eq(schema.systemBackups.companyId, companyAId))).length;
        if (prof.expected.createBackup === 403) {
          expect(afterBackupsCount).toBe(beforeBackupsCount);
        } else {
          expect(afterBackupsCount).toBe(beforeBackupsCount + 1);
        }

        // 6. POST /api/audit-advanced/backups/:id/restore
        const restoreRes = await request(app)
          .post(`/api/audit-advanced/backups/${companyABackupId}/restore`)
          .set('Authorization', `Bearer ${prof.token}`);
        expect(restoreRes.status, `Profile ${prof.id} (${prof.name}) POST /api/audit-advanced/backups/:id/restore`).toBe(prof.expected.restoreBackup);

        // 7. POST /api/audit-advanced/backups/integrity-check
        await CompanyManager.syncCompanyDatabaseSnapshot(companyAId);
        const integrityRes = await request(app)
          .post('/api/audit-advanced/backups/integrity-check')
          .set('Authorization', `Bearer ${prof.token}`)
          .send({});
        expect(integrityRes.status, `Profile ${prof.id} (${prof.name}) POST /api/audit-advanced/backups/integrity-check`).toBe(prof.expected.integrityCheck);
        if (prof.expected.integrityCheck === 200) {
          expect(integrityRes.body.valid).toBe(true);
          expect(integrityRes.body.status).toBe('VALID');
        }
      }
    }, 60000);
  });

  describe('3. BACKUP INTEGRITY-CHECK ENDPOINT VALIDATION', () => {
    it('validates Valid, Mismatched, Corrupted, and Missing snapshots, logs audit events, and never modifies database.lai or system_backups', async () => {
      await CompanyManager.syncCompanyDatabaseSnapshot(companyAId);
      const metaA = await CompanyManager.getCompanyManifest(companyAId);
      const dbPath = metaA!.dbPath;
      const originalLaiBuffer = fs.readFileSync(dbPath);
      const originalSha256 = crypto.createHash('sha256').update(originalLaiBuffer).digest('hex');

      const dbA = await CompanyManager.getCompanyDb(companyAId);
      const backupsBefore = await dbA.select().from(schema.systemBackups).where(eq(schema.systemBackups.companyId, companyAId));

      // 1. Unauthenticated request -> 401
      const unauthRes = await request(app).post('/api/audit-advanced/backups/integrity-check').send({});
      expect(unauthRes.status).toBe(401);

      // 2. Invalid request body (expectedChecksum = "") -> 400
      const badBodyRes = await request(app)
        .post('/api/audit-advanced/backups/integrity-check')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ expectedChecksum: '   ' });
      expect(badBodyRes.status).toBe(400);
      expect(badBodyRes.body.error).toBe('VALIDATION_ERROR');

      // 3. Valid snapshot -> 200, valid: true, status: 'VALID'
      const validRes = await request(app)
        .post('/api/audit-advanced/backups/integrity-check')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ expectedChecksum: originalSha256 });
      expect(validRes.status).toBe(200);
      expect(validRes.body.valid).toBe(true);
      expect(validRes.body.status).toBe('VALID');
      expect(validRes.body.checksum).toBe(originalSha256);

      // Verify database.lai bytes and backup rows were NOT modified
      expect(crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex')).toBe(originalSha256);
      const backupsAfterValid = await dbA.select().from(schema.systemBackups).where(eq(schema.systemBackups.companyId, companyAId));
      expect(backupsAfterValid.length).toBe(backupsBefore.length);

      // 4. Mismatched snapshot -> 200, valid: false, status: 'MISMATCHED_SNAPSHOT'
      const mismatchRes = await request(app)
        .post('/api/audit-advanced/backups/integrity-check')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ expectedChecksum: '0000000000000000000000000000000000000000000000000000000000000000' });
      expect(mismatchRes.status).toBe(200);
      expect(mismatchRes.body.valid).toBe(false);
      expect(mismatchRes.body.status).toBe('MISMATCHED_SNAPSHOT');

      // 5. Corrupted snapshot -> 200, valid: false, status: 'CORRUPTED_SNAPSHOT'
      try {
        const corruptedBuf = Buffer.from(originalLaiBuffer);
        // Flip bytes at the end of ciphertext/authTag
        corruptedBuf[corruptedBuf.length - 1] ^= 0xff;
        corruptedBuf[corruptedBuf.length - 5] ^= 0xff;
        fs.writeFileSync(dbPath, corruptedBuf);
        // Align manifest dbChecksum to corrupted hash so decryption/PRAGMA corruption check runs
        const corruptedHash = crypto.createHash('sha256').update(corruptedBuf).digest('hex');
        await CompanyManager.updateCompanyManifest(companyAId, { dbChecksum: corruptedHash } as any);

        const corruptRes = await request(app)
          .post('/api/audit-advanced/backups/integrity-check')
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({});
        expect(corruptRes.status).toBe(200);
        expect(corruptRes.body.valid).toBe(false);
        expect(corruptRes.body.status).toBe('CORRUPTED_SNAPSHOT');

        // Verify integrity-check did NOT overwrite the corrupted file
        expect(crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex')).toBe(corruptedHash);
      } finally {
        fs.writeFileSync(dbPath, originalLaiBuffer);
        await CompanyManager.updateCompanyManifest(companyAId, { dbChecksum: originalSha256 } as any);
      }

      // 6. Missing snapshot -> 200, valid: false, status: 'MISSING_SNAPSHOT'
      const backupMovePath = `${dbPath}.bak_test`;
      try {
        fs.renameSync(dbPath, backupMovePath);
        const missingRes = await request(app)
          .post('/api/audit-advanced/backups/integrity-check')
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({});
        expect(missingRes.status).toBe(200);
        expect(missingRes.body.valid).toBe(false);
        expect(missingRes.body.status).toBe('MISSING_SNAPSHOT');
        // Verify missing database.lai was NOT recreated by integrity-check
        expect(fs.existsSync(dbPath)).toBe(false);
      } finally {
        if (fs.existsSync(backupMovePath)) {
          fs.renameSync(backupMovePath, dbPath);
        }
      }

      // 7. Verify audit log recorded BACKUP_INTEGRITY_CHECKED events
      const auditLogs = await dbA
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, 'BACKUP_INTEGRITY_CHECKED'));
      expect(auditLogs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('4. CROSS-COMPANY SECURITY (Company A vs Company B)', () => {
    it('prevents an authorized user in Company A from listing, verifying, creating, restoring, scanning, or deleting Company B backups and storage', async () => {
      // Create a cleanable .tmp.lai file inside Company B's workspace
      const compBTempLai = path.join(companyBDir, 'companyB_isolated_cache.tmp.lai');
      fs.writeFileSync(compBTempLai, 'company-b-isolated-data');

      // 1. Company A scan must ONLY return Company A files, never Company B files
      const scanARes = await request(app)
        .get('/api/lai-cleanup/scan')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(scanARes.status).toBe(200);
      const scannedPaths = (scanARes.body.files || []).map((f: any) => f.path);
      expect(scannedPaths.some((p: string) => p.includes(companyBId) || p === compBTempLai)).toBe(false);

      // 2. Company A passing ?companyId=companyBId on scan -> 403 CROSS_COMPANY_ACCESS_DENIED
      const crossScanRes = await request(app)
        .get(`/api/lai-cleanup/scan?companyId=${companyBId}`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(crossScanRes.status).toBe(403);
      expect(crossScanRes.body.error).toBe('CROSS_COMPANY_ACCESS_DENIED');

      // 3. Company A attempting to delete Company B's .lai file -> 403 CROSS_COMPANY_ACCESS_DENIED and file untouched
      const crossDeleteRes = await request(app)
        .post('/api/lai-cleanup/delete')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ filePaths: [compBTempLai] });
      expect(crossDeleteRes.status).toBe(403);
      expect(crossDeleteRes.body.error).toBe('CROSS_COMPANY_ACCESS_DENIED');
      expect(fs.existsSync(compBTempLai)).toBe(true);

      // 4. Company A running clean-all must NOT delete Company B's .tmp.lai file
      const cleanAllARes = await request(app)
        .post('/api/lai-cleanup/clean-all')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(cleanAllARes.status).toBe(200);
      expect(fs.existsSync(compBTempLai)).toBe(true);

      // Clean up Company B's temp file using Company B's own owner token
      const delBRes = await request(app)
        .post('/api/lai-cleanup/delete')
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ filePaths: [compBTempLai] });
      expect(delBRes.status).toBe(200);
      expect(fs.existsSync(compBTempLai)).toBe(false);

      // 5. Company A listing backups only sees Company A backups, and ?companyId=companyBId -> 403
      const listARes = await request(app)
        .get('/api/audit-advanced/backups')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(listARes.status).toBe(200);
      expect(listARes.body.every((b: any) => b.companyId === companyAId)).toBe(true);
      expect(listARes.body.some((b: any) => b.id === companyBBackupId)).toBe(false);

      const crossListRes = await request(app)
        .get(`/api/audit-advanced/backups?companyId=${companyBId}`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(crossListRes.status).toBe(403);
      expect(crossListRes.body.error).toBe('CROSS_COMPANY_ACCESS_DENIED');

      // 6. Company A attempting to verify Company B snapshot -> 403
      const crossVerifyRes = await request(app)
        .post('/api/audit-advanced/backups/integrity-check')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('x-company-id', companyBId)
        .send({});
      expect(crossVerifyRes.status).toBe(403);
      expect(crossVerifyRes.body.error).toBe('CROSS_COMPANY_ACCESS_DENIED');

      // 7. Company A attempting to restore Company B's backup ID -> 403 CROSS_COMPANY_ACCESS_DENIED
      const crossRestoreRes = await request(app)
        .post(`/api/audit-advanced/backups/${companyBBackupId}/restore`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(crossRestoreRes.status).toBe(403);
      expect(crossRestoreRes.body.error).toBe('CROSS_COMPANY_ACCESS_DENIED');
    });
  });

  describe('5. FRONTEND & BACKEND CONSISTENCY', () => {
    it('aligns BackupManager.tsx UI permission guards and moduleRegistry with backend route permissions', () => {
      const backupManagerSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/client/pages/BackupManager.tsx'),
        'utf8'
      );

      // Verify BackupManager does not grant UI actions via settings:view or masterdata:view
      expect(backupManagerSrc).not.toContain("hasPermission('settings:view')");
      expect(backupManagerSrc).not.toContain("hasPermission('masterdata:view')");
      expect(backupManagerSrc).not.toContain("hasPermission('settings:manage')");
      expect(backupManagerSrc).not.toContain("hasPermission('masterdata:manage')");

      // Verify granular permission checks exist in BackupManager.tsx
      expect(backupManagerSrc).toContain("hasPermission('backups:view')");
      expect(backupManagerSrc).toContain("hasPermission('backups:create')");
      expect(backupManagerSrc).toContain("hasPermission('backups:verify')");
      expect(backupManagerSrc).toContain("hasPermission('backups:restore')");
      expect(backupManagerSrc).toContain("hasPermission('storage:view')");
      expect(backupManagerSrc).toContain("hasPermission('storage:cleanup')");

      // Verify moduleRegistry requires backups:view / storage:view for md-backup-vault
      const modsWithMasterDataViewOnly = getAuthorizedERPModules(
        'Bookkeeper',
        ['masterdata:view', 'settings:view'],
        ['master-data']
      );
      const mdMod = modsWithMasterDataViewOnly.find(m => m.id === 'master-data');
      expect(mdMod?.submodules.some(s => s.id === 'md-backup-vault')).toBe(false);
      expect(
        isRouteAuthorizedForUser('/master-data/backup-vault', 'Bookkeeper', ['masterdata:view', 'settings:view'], ['master-data'])
      ).toBe(false);

      // Whereas with backups:view, md-backup-vault route IS authorized
      expect(
        isRouteAuthorizedForUser('/master-data/backup-vault', 'Bookkeeper', ['masterdata:view', 'backups:view'], ['master-data'])
      ).toBe(true);
    });
  });

  describe('6. PREVIOUS CUSTOM RBAC DEFECT RECHECK (10 / 16 vs 16 / 16) + OWNER IMMUNITY', () => {
    it('persists and enforces 10 / 16 custom module assignments for Company Administrator across DB, save response, user list, effective access, sidebar, route guard, reload, and login while keeping Company Owner permanently unrestricted (16 / 16)', async () => {
      const selectedTenModules = [
        'dashboard',
        'sales',
        'procurement',
        'inventory',
        'cash-banking',
        'accounting',
        'tax',
        'reports',
        'audit',
        'master-data'
      ];
      // Unchecked 6 modules: fixed-assets, payroll, budget, documents, approvals, activity-center

      // 0. Verify Company Owner is immune to 10 / 16 employee module restriction
      const ownerRestrictRes = await request(app)
        .put(`/api/rbac/members/${ownerAMembershipId}/module-assignments`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          reason: 'Attempt to restrict Company Owner to 10 modules (must be blocked by OWNER_UNRESTRICTED_POLICY)',
          moduleAssignments: selectedTenModules.map(modId => ({
            moduleId: modId,
            actions: ['view', 'create', 'edit', 'approve', 'post', 'manage']
          }))
        });
      expect(ownerRestrictRes.status).toBe(400);
      expect(ownerRestrictRes.body.error).toBe('OWNER_UNRESTRICTED_POLICY');
      const ownerSessionRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(ownerSessionRes.status).toBe(200);
      expect(ownerSessionRes.body.activeCompany.assignedModules.length).toBe(16);
      expect(ownerSessionRes.body.permissions).toContain('*');

      // 1. Provision a Company Administrator user and save 10 / 16 modules
      const adminTarget = await createTestUserSession(
        companyAId,
        'usr-admin-10mod',
        'admin.10mod@test.ph',
        'Scoped Company Admin',
        'Company Administrator'
      );

      const saveRes = await request(app)
        .put(`/api/rbac/members/${adminTarget.memId}/module-assignments`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          reason: 'Restrict Company Administrator to 10 active modules for RBAC regression verification',
          moduleAssignments: selectedTenModules.map(modId => ({
            moduleId: modId,
            submoduleIds:
              modId === 'master-data'
                ? ['md-customers', 'md-vendors', 'md-roles', 'md-backup-vault', 'md-settings']
                : undefined,
            actions: ['view', 'create', 'edit', 'approve', 'post', 'manage']
          }))
        });
      expect(saveRes.status).toBe(200);

      // Check 1: Save response effectiveModuleIds count is 10 / 16
      expect(saveRes.body.resolvedAccess.effectiveModuleIds.length).toBe(10);
      expect(saveRes.body.resolvedAccess.effectiveModuleIds.sort()).toEqual([...selectedTenModules].sort());

      // Check 2: Persisted database records in user_module_assignments
      const dbA = await CompanyManager.getCompanyDb(companyAId);
      const dbRows = await dbA
        .select()
        .from(schema.userModuleAssignments)
        .where(eq(schema.userModuleAssignments.companyUserId, adminTarget.memId));
      expect(dbRows.length).toBe(16);
      const allowRows = dbRows.filter(r => r.effect === 'ALLOW');
      const denyRows = dbRows.filter(r => r.effect === 'DENY' && r.origin === 'USER_SPECIFIC_DENY');
      expect(allowRows.length).toBe(10);
      expect(denyRows.length).toBe(6);

      // Check 3: User list (GET /api/users) shows 10 / 16 for this exact user
      const usersListRes = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(usersListRes.status).toBe(200);
      const adminInList = usersListRes.body.find((u: any) => u.membershipId === adminTarget.memId || u.id === adminTarget.userId);
      expect(adminInList).toBeDefined();
      expect(adminInList.assignedModuleIds.length).toBe(10);
      expect(adminInList.effectiveModuleIds.length).toBe(10);

      // Check 4: Effective permissions endpoint (GET /api/rbac/members/:id/module-assignments) shows 10 / 16
      const matrixGetRes = await request(app)
        .get(`/api/rbac/members/${adminTarget.memId}/module-assignments`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(matrixGetRes.status).toBe(200);
      expect(matrixGetRes.body.resolvedAccess.effectiveModuleIds.length).toBe(10);
      expect(matrixGetRes.body.resolvedAccess.effectivePermissions).not.toContain('*');
      expect(matrixGetRes.body.resolvedAccess.effectivePermissions).not.toContain('payroll:view');
      expect(matrixGetRes.body.resolvedAccess.effectivePermissions).not.toContain('budget:view');
      expect(matrixGetRes.body.resolvedAccess.effectivePermissions).not.toContain('fixedassets:view');

      // Check 5: Page reload (/api/auth/session) and fresh login session return 10 / 16
      const sessionRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${adminTarget.token}`);
      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.activeCompany.assignedModules.length).toBe(10);
      expect(sessionRes.body.activeCompany.assignedModuleIds.length).toBe(10);

      // Simulate fresh re-authentication session token for Admin
      const freshRawToken = crypto.randomBytes(32).toString('hex');
      await dbContext.run(dbA, async () => {
        await db.insert(schema.sessions).values({
          id: hashToken(freshRawToken),
          userId: adminTarget.userId,
          companyId: companyAId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      });
      const freshLoginToken = `${companyAId}.${freshRawToken}`;
      const freshSessionRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${freshLoginToken}`);
      expect(freshSessionRes.status).toBe(200);
      expect(freshSessionRes.body.activeCompany.assignedModules.length).toBe(10);

      // Check 6: Sidebar & Route Guard reflect 10 / 16 modules and block unchecked modules (e.g. /payroll, /budgets)
      const sidebarModules = getAuthorizedERPModules(
        'Company Administrator',
        sessionRes.body.permissions,
        sessionRes.body.activeCompany.assignedModules,
        sessionRes.body.activeCompany.assignedSubmodules
      );
      expect(sidebarModules.length).toBe(10);
      expect(
        isRouteAuthorizedForUser(
          '/payroll',
          'Company Administrator',
          sessionRes.body.permissions,
          sessionRes.body.activeCompany.assignedModules,
          sessionRes.body.activeCompany.assignedSubmodules
        )
      ).toBe(false);
      expect(
        isRouteAuthorizedForUser(
          '/budgets',
          'Company Administrator',
          sessionRes.body.permissions,
          sessionRes.body.activeCompany.assignedModules,
          sessionRes.body.activeCompany.assignedSubmodules
        )
      ).toBe(false);

      // Check 7: Backend API rejects unchecked module endpoints (GET /api/budgets -> 403)
      const budgetApiRes = await request(app)
        .get('/api/budgets')
        .set('Authorization', `Bearer ${adminTarget.token}`);
      expect(budgetApiRes.status).toBe(403);

      // Restore Administrator to its canonical Company Administrator role default (3 modules: dashboard, activity-center, master-data)
      const resetRes = await request(app)
        .post(`/api/rbac/members/${adminTarget.memId}/reset-to-role-default`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ reason: 'Restore canonical Company Administrator template default after test' });
      expect(resetRes.status).toBe(200);
      expect(resetRes.body.resolvedAccess.effectiveModuleIds).toEqual([
        'dashboard',
        'activity-center',
        'master-data'
      ]);
    });
  });
});
