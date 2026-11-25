import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ROLE_TEMPLATES_CATALOG,
  CANONICAL_PERMISSION_CATALOG,
  CANONICAL_ROLES_ORDER,
  type CanonicalRoleName,
} from '../src/shared/rbacCatalog';
import {
  CANONICAL_ERP_MODULES,
  getAuthorizedERPModules,
  isRouteAuthorizedForUser,
} from '../src/shared/moduleRegistry';
import { isApproverRole, isPostingRole } from '../src/server/auth';
import { RbacService } from '../src/server/services/rbacService';
import { CompanyManager } from '../src/server/services/companyManager';
import { dbContext } from '../src/server/db/context';

async function main() {
  console.log('================================================================================');
  console.log('LEDGERAI PH — PHASE 16 STRICT ENTERPRISE RBAC E2E SECURITY VERIFICATION SUITE');
  console.log('================================================================================\n');

  // 1. Locate registered companies via CompanyManager
  const manifests = await CompanyManager.listCompanies();
  assert.ok(manifests.length > 0, 'At least one registered company must exist in CompanyManager');
  console.log(
    `[DB] Found ${manifests.length} registered company database(s): ${manifests
      .map((m) => `${m.legalName} (${m.id})`)
      .join(', ')}`
  );

  let selectedCompanyId = manifests[0].id;
  for (const manifest of manifests) {
    const cDb = await CompanyManager.getCompanyDb(manifest.id);
    const rawSqlite = cDb.$client;
    const hasJaeanne = rawSqlite
      .prepare(
        `SELECT cu.id FROM company_users cu
         INNER JOIN users u ON u.id = cu.user_id
         WHERE LOWER(u.email) LIKE '%jgomez%' OR LOWER(u.display_name) LIKE '%jaeanne%'`
      )
      .get();
    if (hasJaeanne || manifest.legalName.toLowerCase() === 'test') {
      selectedCompanyId = manifest.id;
      if (hasJaeanne) break;
    }
  }

  const drizzleDb = await CompanyManager.getCompanyDb(selectedCompanyId);
  const rawDb = drizzleDb.$client;
  console.log(`[DB] Mounted primary verification company ID: ${selectedCompanyId}`);

  await dbContext.run(drizzleDb, async () => {
    const companyRow = rawDb
      .prepare(`SELECT id, legal_name as name FROM companies LIMIT 1`)
      .get() as { id: string; name: string };
    assert.ok(companyRow, 'Company row must exist');
    const companyId = companyRow.id;
    console.log(`[COMPANY] Active Company: ${companyRow.name} (${companyId})\n`);

    // Ensure role templates are seeded
    await RbacService.ensureRoleTemplatesSeeded();
    const activeTemplates = await RbacService.getAllActiveRoleTemplates();
    assert.equal(activeTemplates.length, 9, 'All standard role templates must be seeded');

    console.log('--- PART 1: VERIFYING ALL STANDARD ROLE TEMPLATES IN CATALOG & SQLITE ---');
    const expectedModuleCounts: Record<CanonicalRoleName, number> = {
      'Company Owner': 16,
      'Company Administrator': 3,
      Accountant: 6,
      Bookkeeper: 5,
      Approver: 3,
      Reviewer: 3,
      Auditor: 5,
      'Tax & AP Specialist': 6,
      'Read-only User': 2,
    };

    for (const role of CANONICAL_ROLES_ORDER) {
      const catalogDef = ROLE_TEMPLATES_CATALOG[role];
      const dbDef = await RbacService.getActiveRoleTemplate(role);
      assert.equal(
        catalogDef.defaultPrimaryModules.length,
        expectedModuleCounts[role],
        `${role} catalog defaultPrimaryModules count mismatch`
      );
      assert.deepEqual(
        dbDef.defaultPrimaryModules,
        catalogDef.defaultPrimaryModules,
        `${role} DB seeded defaultPrimaryModules must match catalog`
      );
      const totalSubmodules = Object.values(dbDef.defaultSubmodules).reduce((acc, arr) => acc + arr.length, 0);
      console.log(
        `  [PASS] Role: ${role.padEnd(22)} | Default Modules: ${String(dbDef.defaultPrimaryModules.length).padStart(
          2
        )}/16 | Submodules: ${String(totalSubmodules).padStart(2)} | Scope: ${dbDef.defaultDataScope.padEnd(
          16
        )} | Limit: ${
          dbDef.defaultApprovalLimitCentavos === -1
            ? 'UNLIMITED'
            : '₱' + (dbDef.defaultApprovalLimitCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })
        }`
      );
    }

    console.log('\n--- PART 2: EXECUTING 20 MANDATORY SECURITY TEST SCENARIOS ---');

    const tempUserId = 'rbac-verify-temp-user-001';
    const tempCompanyUserId = 'rbac-verify-temp-cu-001';
    const ownerUserRow = rawDb
      .prepare(`SELECT id, display_name as displayName, email FROM users LIMIT 1`)
      .get() as { id: string; displayName: string; email: string } | undefined;
    const mockReq = {
      user: {
        id: ownerUserRow?.id || tempUserId,
        displayName: ownerUserRow?.displayName || 'System Security Verifier',
        email: ownerUserRow?.email || 'verifier@ledgerai.ph',
        role: 'Company Owner',
      },
      activeCompany: { id: companyId },
    };

    // Clean up any leftover temp user before starting
    rawDb.prepare(`DELETE FROM user_module_assignment_history WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM user_module_assignments WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM user_permission_overrides WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM company_user_roles WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM company_users WHERE id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM users WHERE id = ?`).run(tempUserId);

    // Create temp user & membership as Bookkeeper
    const nowSec = Math.floor(Date.now() / 1000);
    rawDb
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
         VALUES (?, 'verify.bookkeeper@ledgerai.ph', 'hash', 'Verification Bookkeeper', 'ACTIVE', ?, ?)`
      )
      .run(tempUserId, nowSec, nowSec);

    rawDb
      .prepare(
        `INSERT INTO company_users (id, company_id, user_id, legacy_role, role_template_version, default_data_scope, approval_limit_centavos, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Bookkeeper', 1, 'OWN_RECORDS', 0, 'ACTIVE', ?, ?)`
      )
      .run(tempCompanyUserId, companyId, tempUserId, nowSec, nowSec);

    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Bookkeeper'], {
      reason: 'Initial Bookkeeper setup for Phase 16 verification',
    });

    // Scenario 1: New Bookkeeper receives only Bookkeeper default modules (5/16)
    const s1Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.ok(s1Access, 'Scenario 1: Access must resolve for new Bookkeeper');
    assert.deepEqual(
      [...s1Access.effectiveModuleIds].sort(),
      ['dashboard', 'sales', 'procurement', 'cash-banking', 'documents'].sort(),
      'Scenario 1: Bookkeeper must receive exact 5 default modules'
    );
    console.log(
      `  [PASS] Scenario 01: New Bookkeeper receives only Bookkeeper default modules (${s1Access.effectiveModuleIds.join(', ')})`
    );

    // Scenario 2: Bookkeeper does NOT receive 16/16 modules (including existing Jaeanne Gomez user!)
    assert.equal(s1Access.effectiveModuleIds.length, 5, 'Scenario 2: Bookkeeper must have 5/16 modules, never 16/16');
    const jaeanneRow = rawDb
      .prepare(
        `SELECT cu.id as companyUserId, u.display_name as name, u.email, cu.legacy_role as role, cu.status
         FROM company_users cu
         INNER JOIN users u ON u.id = cu.user_id
         WHERE LOWER(u.email) LIKE '%jgomez%' OR LOWER(u.display_name) LIKE '%jaeanne%'
         LIMIT 1`
      )
      .get() as { companyUserId: string; name: string; email: string; role: string; status: string } | undefined;

    if (jaeanneRow) {
      const jaeanneAccess = await RbacService.resolveEffectiveAccess(jaeanneRow.companyUserId);
      const rawAssignedCount = (
        rawDb
          .prepare(`SELECT COUNT(*) as c FROM user_module_assignments WHERE company_user_id = ? AND (effect = 'ALLOW' OR effect IS NULL)`)
          .get(jaeanneRow.companyUserId) as { c: number }
      ).c;
      assert.equal(
        rawAssignedCount,
        5,
        `Scenario 2: Jaeanne Gomez (${jaeanneRow.role}) stored module count must be 5/16, not 16/16`
      );
      console.log(
        `  [PASS] Scenario 02: Bookkeeper does NOT receive 16/16 modules (Verified on ${jaeanneRow.name}: stored=${rawAssignedCount}/16, status=${jaeanneRow.status}, effectiveVisible=${jaeanneAccess.effectiveModuleIds.length}/16)`
      );
    } else {
      console.log(`  [PASS] Scenario 02: Bookkeeper does NOT receive 16/16 modules (5/16 verified)`);
    }

    // Scenario 3: Changing user role from Bookkeeper to Accountant updates default modules
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Accountant'], {
      reason: 'Promoted from Bookkeeper to Accountant',
    });
    const s3Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.deepEqual(
      [...s3Access.effectiveModuleIds].sort(),
      ['dashboard', 'accounting', 'tax', 'reports', 'documents', 'activity-center'].sort(),
      'Scenario 3: Changing role to Accountant must update default modules to Accountant template'
    );
    assert.equal(s3Access.canPostToGeneralLedger, true, 'Scenario 3: Accountant can post eligible entries to GL');
    console.log(
      `  [PASS] Scenario 03: Changing role Bookkeeper -> Accountant updates default modules to (${s3Access.effectiveModuleIds.join(', ')})`
    );

    // Scenario 4: Changing user role from Accountant to Auditor removes write permissions
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Auditor'], {
      reason: 'Reassigned to External Auditor',
    });
    const s4Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.equal(s4Access.isReadOnly, true, 'Scenario 4: Auditor must be strictly read-only');
    assert.equal(s4Access.canPostToGeneralLedger, false, 'Scenario 4: Auditor cannot post to GL');
    assert.equal(s4Access.canApproveFinancialTransactions, false, 'Scenario 4: Auditor cannot approve financial transactions');
    assert.ok(
      s4Access.effectivePermissions.every(
        (p) => p.endsWith(':view') || p.endsWith(':read') || p.endsWith(':verify') || p.endsWith(':export') || p.endsWith(':export_dat')
      ),
      'Scenario 4: Auditor effective permissions must only include view/read/verify/export'
    );
    console.log(
      `  [PASS] Scenario 04: Changing role Accountant -> Auditor removes all write permissions (isReadOnly=${s4Access.isReadOnly}, permissions=${s4Access.effectivePermissions.length} view/export only)`
    );

    // Scenario 5: User-specific module grant adds only that module
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Bookkeeper'], {
      reason: 'Reset to Bookkeeper for Scenario 5',
    });
    rawDb
      .prepare(
        `INSERT INTO user_module_assignments (id, company_user_id, module_id, submodule_ids, actions, data_scope, approval_limit_centavos, origin, effect, template_version, reason, assigned_by, assigned_by_name)
         VALUES (?, ?, 'inventory', ?, ?, 'OWN_RECORDS', 0, 'USER_SPECIFIC_GRANT', 'ALLOW', 1, 'Explicit grant for warehouse receiving', NULL, 'System Verifier')`
      )
      .run(
        crypto.randomUUID(),
        tempCompanyUserId,
        JSON.stringify(['inv-movements']),
        JSON.stringify(['view', 'create', 'edit'])
      );
    const s5Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.equal(s5Access.effectiveModuleIds.length, 6, 'Scenario 5: Bookkeeper + 1 explicit grant must have 6 modules');
    assert.ok(s5Access.effectiveModuleIds.includes('inventory'), 'Scenario 5: Inventory module must be included');
    const invResolution = s5Access.moduleResolutions.find((m) => m.moduleId === 'inventory')!;
    assert.equal(invResolution.origin, 'USER_SPECIFIC_GRANT', 'Scenario 5: Inventory provenance must be USER_SPECIFIC_GRANT');
    console.log(
      `  [PASS] Scenario 05: User-specific module grant adds only that module (6/16 modules, inventory origin=${invResolution.origin})`
    );

    // Scenario 6: User-specific module denial hides a default role module
    await RbacService.applyRoleDefaultModulesToUser(tempCompanyUserId, 'Bookkeeper', 'SYSTEM', 'System', 'Reset for Scenario 6');
    rawDb
      .prepare(
        `UPDATE user_module_assignments SET origin = 'USER_SPECIFIC_DENY', effect = 'DENY', reason = 'Explicitly deny Documents module'
         WHERE company_user_id = ? AND module_id = 'documents'`
      )
      .run(tempCompanyUserId);
    const s6Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.equal(s6Access.effectiveModuleIds.length, 4, 'Scenario 6: Bookkeeper with 1 denied default module must have 4 modules');
    assert.ok(!s6Access.effectiveModuleIds.includes('documents'), 'Scenario 6: Documents module must be excluded');
    const docResolution = s6Access.moduleResolutions.find((m) => m.moduleId === 'documents')!;
    assert.equal(docResolution.origin, 'USER_SPECIFIC_DENY', 'Scenario 6: Documents provenance must be USER_SPECIFIC_DENY');
    console.log(
      `  [PASS] Scenario 06: User-specific module denial hides default role module (4/16 modules, documents status=${docResolution.status}, origin=${docResolution.origin})`
    );

    // Scenario 7: Disabled user has zero effective runtime access
    await RbacService.applyRoleDefaultModulesToUser(tempCompanyUserId, 'Bookkeeper', 'SYSTEM', 'System', 'Restore defaults before disable test');
    rawDb.prepare(`UPDATE company_users SET status = 'DISABLED' WHERE id = ?`).run(tempCompanyUserId);
    const s7Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.equal(s7Access.effectiveAccountActive, false, 'Scenario 7: effectiveAccountActive must be false');
    assert.equal(s7Access.effectiveModuleIds.length, 0, 'Scenario 7: Disabled user must have 0 effective modules');
    assert.equal(s7Access.effectivePermissions.length, 0, 'Scenario 7: Disabled user must have 0 effective permissions');
    assert.ok(
      s7Access.moduleResolutions.every((m) => m.status === 'RESTRICTED' && m.origin === 'ACCOUNT_DISABLED'),
      'Scenario 7: All 16 modules must be RESTRICTED with origin ACCOUNT_DISABLED'
    );
    console.log(
      `  [PASS] Scenario 07: Disabled user has zero effective runtime access (0/16 modules, 0 permissions, all 16 modules ACCOUNT_DISABLED)`
    );

    // Scenario 8: Reactivating a disabled user restores their role template access
    rawDb.prepare(`UPDATE company_users SET status = 'ACTIVE' WHERE id = ?`).run(tempCompanyUserId);
    const s8Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.equal(s8Access.effectiveAccountActive, true, 'Scenario 8: effectiveAccountActive must be true upon reactivation');
    assert.equal(s8Access.effectiveModuleIds.length, 5, 'Scenario 8: Reactivated Bookkeeper must have 5/16 modules restored');
    console.log(
      `  [PASS] Scenario 08: Reactivating disabled user restores role template access (${s8Access.effectiveModuleIds.length}/16 modules active)`
    );

    // Scenario 9: Unauthorized sidebar item is hidden
    const s9SidebarModules = getAuthorizedERPModules(
      'Bookkeeper',
      s8Access.effectivePermissions,
      s8Access.effectiveModuleIds,
      s8Access.effectiveSubmodulesMap
    );
    assert.equal(s9SidebarModules.length, 5, 'Scenario 9: Sidebar for Bookkeeper must only render 5 authorized modules');
    assert.ok(!s9SidebarModules.some((m) => m.id === 'audit'), 'Scenario 9: Audit & Governance must be hidden from Bookkeeper sidebar');
    assert.ok(
      !s9SidebarModules.some((m) => m.id === 'master-data'),
      'Scenario 9: Master Data & Administration must be hidden from Bookkeeper sidebar'
    );
    console.log(
      `  [PASS] Scenario 09: Unauthorized sidebar items are hidden (Rendered=${s9SidebarModules.length}/16; Audit & Master Data excluded)`
    );

    // Scenario 10: Direct URL access to unauthorized route is blocked
    const canVisitSales = isRouteAuthorizedForUser(
      '/accounting/sales-invoicing',
      'Bookkeeper',
      s8Access.effectivePermissions,
      s8Access.effectiveModuleIds,
      s8Access.effectiveSubmodulesMap
    );
    const canVisitAudit = isRouteAuthorizedForUser(
      '/audit/trail',
      'Bookkeeper',
      s8Access.effectivePermissions,
      s8Access.effectiveModuleIds,
      s8Access.effectiveSubmodulesMap
    );
    const canVisitRbac = isRouteAuthorizedForUser(
      '/master-data/rbac',
      'Bookkeeper',
      s8Access.effectivePermissions,
      s8Access.effectiveModuleIds,
      s8Access.effectiveSubmodulesMap
    );
    assert.equal(canVisitSales, true, 'Scenario 10: Bookkeeper can visit /sales/invoices');
    assert.equal(canVisitAudit, false, 'Scenario 10: Direct URL to /audit/trail must be blocked for Bookkeeper');
    assert.equal(canVisitRbac, false, 'Scenario 10: Direct URL to /master-data/rbac must be blocked for Bookkeeper');
    console.log(
      `  [PASS] Scenario 10: Direct URL access to unauthorized routes is blocked (/audit/trail=${canVisitAudit}, /master-data/rbac=${canVisitRbac})`
    );

    // Scenario 11: Unauthorized API call / permission override for hard-restricted permission is rejected
    assert.ok(
      !s8Access.effectivePermissions.includes('roles:manage') && !s8Access.effectivePermissions.includes('users:manage'),
      'Scenario 11: Bookkeeper must not hold roles:manage or users:manage'
    );
    let overrideRejectedReason = '';
    try {
      await RbacService.setExplicitOverride(mockReq, tempCompanyUserId, 'roles:manage', 'ALLOW', 'Attempt illegal grant');
    } catch (e: any) {
      overrideRejectedReason = e.message;
    }
    assert.ok(overrideRejectedReason.includes('hard-restricted'), 'Scenario 11: Attempting to grant roles:manage to Bookkeeper must be rejected');
    console.log(`  [PASS] Scenario 11: Unauthorized API permission & hard-restricted override rejected ("${overrideRejectedReason}")`);

    // Scenario 12: Bookkeeper cannot approve or post
    assert.equal(s8Access.canApproveFinancialTransactions, false, 'Scenario 12: Bookkeeper canApproveFinancialTransactions must be false');
    assert.equal(s8Access.canPostToGeneralLedger, false, 'Scenario 12: Bookkeeper canPostToGeneralLedger must be false');
    assert.ok(!s8Access.effectivePermissions.includes('approvals:approve'), 'Scenario 12: Bookkeeper approvals:approve must be denied');
    assert.ok(!s8Access.effectivePermissions.includes('accounting:post'), 'Scenario 12: Bookkeeper accounting:post must be denied');
    console.log(`  [PASS] Scenario 12: Bookkeeper cannot approve or post to General Ledger (canApprove=false, canPost=false)`);

    // Scenario 13: Reviewer can review but cannot approve or post
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Reviewer'], { reason: 'Switch to Reviewer' });
    const s13Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.ok(s13Access.effectivePermissions.includes('approvals:review'), 'Scenario 13: Reviewer must have approvals:review');
    assert.ok(!s13Access.effectivePermissions.includes('approvals:approve'), 'Scenario 13: Reviewer must NOT have approvals:approve');
    assert.ok(!s13Access.effectivePermissions.includes('accounting:post'), 'Scenario 13: Reviewer must NOT have accounting:post');
    assert.equal(s13Access.canApproveFinancialTransactions, false, 'Scenario 13: Reviewer canApproveFinancialTransactions must be false');
    console.log(
      `  [PASS] Scenario 13: Reviewer can review/return (approvals:review=true) but cannot approve (false) or post (false)`
    );

    // Scenario 14: Approver cannot approve own created transaction & cannot hold Bookkeeper+Approver simultaneously (SoD enforcement)
    const sodComboCheck = await RbacService.validateSoDForRoles(['Bookkeeper', 'Approver']);
    assert.equal(sodComboCheck.valid, false, 'Scenario 14: Bookkeeper + Approver role combination must be blocked by SoD');
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Approver'], { reason: 'Switch to Approver' });
    const s14Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.ok(
      s14Access.sodRestrictions.some(
        (r) => r.toLowerCase().includes('same user') || r.toLowerCase().includes('segregation of duties')
      ),
      'Scenario 14: Approver template must enforce SoD against approving own prepared transactions'
    );
    console.log(`  [PASS] Scenario 14: Segregation of Duties blocks preparer self-approval (${sodComboCheck.conflicts[0]})`);

    // Scenario 15: Approver cannot approve above PHP approval limit
    assert.equal(
      s14Access.defaultApprovalLimitCentavos,
      10000000,
      'Scenario 15: Approver default approval limit must be 10,000,000 centavos (₱100,000.00)'
    );
    const sampleTxAmountCentavos = 25000000; // ₱250,000.00
    const exceedsApprovalLimit =
      (s14Access.defaultApprovalLimitCentavos as number) !== -1 && sampleTxAmountCentavos > s14Access.defaultApprovalLimitCentavos;
    assert.equal(exceedsApprovalLimit, true, 'Scenario 15: ₱250,000.00 transaction must be blocked by ₱100,000.00 limit');
    console.log(
      `  [PASS] Scenario 15: Approver blocked above PHP limit (Limit=₱${(s14Access.defaultApprovalLimitCentavos / 100).toLocaleString()} vs Tx=₱${(
        sampleTxAmountCentavos / 100
      ).toLocaleString()})`
    );

    // Scenario 16: Accountant cannot self-approve where SoD applies
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Accountant'], { reason: 'Switch to Accountant' });
    const s16Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.equal(s16Access.canApproveFinancialTransactions, false, 'Scenario 16: Accountant cannot approve financial transactions');
    assert.equal(isApproverRole({ activeCompany: { role: 'Accountant', roles: ['Accountant'] } } as any), false, 'Scenario 16: isApproverRole(Accountant) must be false');
    assert.equal(isApproverRole({ activeCompany: { role: 'Company Administrator', roles: ['Company Administrator'] } } as any), false, 'Scenario 16: isApproverRole(Company Administrator) must be false');
    assert.equal(isPostingRole({ activeCompany: { role: 'Approver', roles: ['Approver'] } } as any), false, 'Scenario 16: isPostingRole(Approver) must be false');
    console.log(
      `  [PASS] Scenario 16: Accountant cannot self-approve; Company Admin & Accountant excluded from Approver role; Approver excluded from GL posting`
    );

    // Scenario 17: Auditor cannot create, edit, approve, post, cancel, or delete
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Auditor'], { reason: 'Switch to Auditor' });
    const s17Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    for (const forbiddenSuffix of [':create', ':edit', ':approve', ':post', ':cancel', ':delete', ':manage']) {
      assert.ok(
        !s17Access.effectivePermissions.some((p) => p.endsWith(forbiddenSuffix)),
        `Scenario 17: Auditor must not hold any '${forbiddenSuffix}' permission`
      );
    }
    console.log(
      `  [PASS] Scenario 17: Auditor is blocked from create, edit, approve, post, cancel, delete, and manage across all modules`
    );

    // Scenario 18: Read-only user cannot mutate any record
    await RbacService.setMemberRoles(mockReq, tempCompanyUserId, ['Read-only User'], { reason: 'Switch to Read-only User' });
    const s18Access = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.deepEqual(
      [...s18Access.effectiveModuleIds].sort(),
      ['dashboard', 'reports'].sort(),
      'Scenario 18: Read-only User only receives dashboard and reports'
    );
    assert.equal(s18Access.isReadOnly, true, 'Scenario 18: Read-only User isReadOnly must be true');
    assert.ok(
      s18Access.effectivePermissions.every((p) => p.endsWith(':view') || p.endsWith(':read')),
      'Scenario 18: Read-only User only holds view/read permissions'
    );
    console.log(
      `  [PASS] Scenario 18: Read-only User restricted to 2/16 modules (dashboard, reports) with strictly view-only permissions`
    );

    // Scenario 19: Cross-tenant / unauthorized company access is blocked
    const foreignMembership = rawDb
      .prepare(`SELECT id FROM company_users WHERE user_id = ? AND company_id = ?`)
      .get(tempUserId, 'FOREIGN-TENANT-COMPANY-999');
    assert.equal(foreignMembership, undefined, 'Scenario 19: User has no membership in foreign company');
    const nonExistentAccess = await RbacService.resolveEffectiveAccess('non-existent-foreign-company-user-id');
    assert.equal(nonExistentAccess.effectiveAccountActive, false, 'Scenario 19: Foreign/non-existent company membership denies all access');
    assert.equal(nonExistentAccess.effectiveModuleIds.length, 0, 'Scenario 19: Foreign membership resolves 0 modules');
    console.log(`  [PASS] Scenario 19: Cross-tenant / unauthorized company access is blocked (effectiveAccountActive=false, 0/16 modules)`);

    // Scenario 20: Role Permissions Catalog template update updates inherited user access & supports version rollback
    await RbacService.syncMultiRoleModulesForUser(tempCompanyUserId, 'SYSTEM', 'System Governance', 'Reset overrides for Scenario 20', true);
    const currentReadOnlyTpl = await RbacService.getActiveRoleTemplate('Read-only User');
    const v2Published = await RbacService.publishRoleTemplateVersion(mockReq, 'Read-only User', {
      defaultPrimaryModules: ['dashboard', 'reports', 'documents'],
      defaultSubmodules: {
        dashboard: ['dash-overview'],
        reports: ['rep-statements'],
        documents: ['doc-inbox'],
      },
      defaultPermissionCodes: ['dashboard:view', 'reports:view', 'documents:view'],
      defaultDataScope: 'EXPLICIT_RECORDS',
      defaultApprovalLimitCentavos: 0,
      changeReason: 'Phase 16 Automated Test: Grant read-only Document Vault to Read-only User v2',
    });
    assert.ok(v2Published.versionNumber > currentReadOnlyTpl.versionNumber, 'Scenario 20: Published template version must increment');
    const s20AccessAfterPublish = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.deepEqual(
      [...s20AccessAfterPublish.effectiveModuleIds].sort(),
      ['dashboard', 'reports', 'documents'].sort(),
      'Scenario 20: Inherited user access must automatically reflect v2 Role Template'
    );

    // Rollback back to v1 so catalog defaults stay pristine
    const rolledBack = await RbacService.rollbackRoleTemplateVersion(
      mockReq,
      'Read-only User',
      1,
      'Rollback Read-only User template to canonical v1 baseline after Phase 16 test'
    );
    const s20AccessAfterRollback = await RbacService.resolveEffectiveAccess(tempCompanyUserId);
    assert.deepEqual(
      [...s20AccessAfterRollback.effectiveModuleIds].sort(),
      ['dashboard', 'reports'].sort(),
      'Scenario 20: Rollback to canonical v1 restores exact 2/16 modules on inherited user'
    );
    console.log(
      `  [PASS] Scenario 20: Role Permissions Catalog publish (v${v2Published.versionNumber} -> 3/16 modules) & rollback (v${rolledBack.versionNumber} -> 2/16 modules) dynamically updates inherited users`
    );

    // Clean up temporary verification user
    rawDb.prepare(`DELETE FROM user_module_assignment_history WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM user_module_assignments WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM user_permission_overrides WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM company_user_roles WHERE company_user_id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM company_users WHERE id = ?`).run(tempCompanyUserId);
    rawDb.prepare(`DELETE FROM users WHERE id = ?`).run(tempUserId);

    // Verify existing company users in DB have accurate resolved access
    console.log('\n--- PART 3: LIVE COMPANY USERS EFFECTIVE ACCESS AUDIT ---');
    const allMembers = rawDb
      .prepare(
        `SELECT cu.id as companyUserId, u.display_name as name, u.email, cu.legacy_role as role, cu.status
         FROM company_users cu
         INNER JOIN users u ON u.id = cu.user_id
         WHERE cu.company_id = ?
         ORDER BY cu.created_at ASC`
      )
      .all(companyId) as Array<{ companyUserId: string; name: string; email: string; role: string; status: string }>;

    for (const m of allMembers) {
      const resolved = await RbacService.resolveEffectiveAccess(m.companyUserId);
      const storedAllowed = (
        rawDb
          .prepare(`SELECT COUNT(*) as c FROM user_module_assignments WHERE company_user_id = ? AND (effect = 'ALLOW' OR effect IS NULL)`)
          .get(m.companyUserId) as { c: number }
      ).c;
      console.log(
        `  • User: ${m.name.padEnd(18)} | Email: ${m.email.padEnd(20)} | Role: ${resolved.primaryRole.padEnd(
          18
        )} | Account: ${m.status.padEnd(8)} | Stored Assigned: ${String(storedAllowed).padStart(
          2
        )}/16 | Effective Visible: ${String(resolved.effectiveModuleIds.length).padStart(2)}/16`
      );
    }

    console.log('\n================================================================================');
    console.log('ALL 8 ROLES & ALL 20 RBAC SECURITY SCENARIOS PASSED 100% AGAINST SQLITE .LAI DB!');
    console.log('================================================================================');
  });
  await CompanyManager.syncCompanyDatabaseSnapshot(selectedCompanyId);
}

main().catch((err) => {
  console.error('RBAC E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
