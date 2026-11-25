import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CANONICAL_ERP_MODULES,
  getAuthorizedERPModules,
  isRouteAuthorizedForUser,
  validateFunctionalDestinations,
  validateModuleRegistry,
} from '../../src/shared/moduleRegistry';
import {
  CANONICAL_KNOWLEDGE_BASE,
  getKnowledgeRecordBySubmodule,
  searchKnowledgeBase,
} from '../../src/shared/knowledgeBase';
import {
  CANONICAL_ROLES_ORDER,
  ROLE_TEMPLATES_CATALOG,
} from '../../src/shared/rbacCatalog';

test('TRACE-01: Module Registry contains exactly 16 primary modules and 38 unique submodules with zero conflicts', () => {
  const reg = validateModuleRegistry();
  assert.equal(reg.valid, true, `Registry errors: ${reg.errors.join('; ')}`);
  assert.equal(reg.totalModules, 16);
  assert.equal(reg.totalSubmodules, 38);
  assert.equal(reg.duplicateSubmoduleIds.length, 0);

  const fnAudit = validateFunctionalDestinations();
  assert.equal(fnAudit.valid, true, `Functional destination issues: ${fnAudit.issues.join('; ')}`);
  assert.equal(fnAudit.totalPrimaryModules, 16);
  assert.equal(fnAudit.totalSubmodules, 38);
});

test('TRACE-02: 100% of all 38 canonical submodules map 1-to-1 to CANONICAL_KNOWLEDGE_BASE with matching routes', () => {
  let verifiedCount = 0;
  for (const mod of CANONICAL_ERP_MODULES) {
    for (const sub of mod.submodules) {
      const kb = getKnowledgeRecordBySubmodule(sub.id);
      assert.ok(kb, `Missing Knowledge Base entry for submodule "${sub.id}" (${sub.label})`);
      assert.equal(kb.moduleId, mod.id);
      assert.equal(kb.navigationPath, sub.route, `Navigation route mismatch on "${sub.id}"`);
      assert.ok(kb.userInstructions.length >= 2);
      assert.ok(kb.purpose.length >= 20);
      assert.equal(kb.verificationStatus, 'VERIFIED');
      verifiedCount++;
    }
  }
  assert.equal(verifiedCount, 38);
});

test('TRACE-03: Knowledge Base contains zero legacy typos (2511Q) and covers cross-module enterprise guides', () => {
  const serialized = JSON.stringify(CANONICAL_KNOWLEDGE_BASE);
  assert.equal(serialized.includes('2511Q'), false, 'Disallowed BIR form typo "2511Q" must not exist');
  assert.ok(serialized.includes('2551Q'), 'Correct BIR Percentage Tax Form "2551Q" must exist');

  assert.ok(getKnowledgeRecordBySubmodule('rep-data-sources'));
  assert.ok(getKnowledgeRecordBySubmodule('sec-owner-authority'));
  assert.ok(getKnowledgeRecordBySubmodule('tax-statutory-guide'));
  assert.ok(getKnowledgeRecordBySubmodule('sys-clean-start'));
});

test('TRACE-04: Knowledge Base search resolves English, Taglish, Owner RBAC, and Clean Start queries accurately', () => {
  const taglishSales = searchKnowledgeBase('paano gumawa ng sales invoice');
  assert.ok(taglishSales.length > 0);
  assert.equal(taglishSales[0].moduleId, 'sales');

  const ownerHits = searchKnowledgeBase('why is company owner unrestricted across all modules');
  assert.ok(ownerHits.length > 0);
  assert.ok(ownerHits.some((r) => r.submoduleId === 'rbac-owner-authority' || r.submoduleId === 'md-roles'));

  const cleanStartHits = searchKnowledgeBase('how does zero-data clean start work');
  assert.ok(cleanStartHits.length > 0);
  assert.ok(cleanStartHits.some((r) => r.submoduleId === 'sys-clean-start'));

  const reportSourceHits = searchKnowledgeBase('where do financial reports get their data');
  assert.ok(reportSourceHits.length > 0);
  assert.ok(reportSourceHits.some((r) => r.submoduleId === 'rep-data-collection' || r.moduleId === 'reports'));
});

test('TRACE-05: 9 Canonical Roles including Tax & AP Specialist exist and Company Owner is unconditionally immune to narrow filters', () => {
  assert.equal(CANONICAL_ROLES_ORDER.length, 9);
  assert.ok(CANONICAL_ROLES_ORDER.includes('Tax & AP Specialist'));
  assert.ok(ROLE_TEMPLATES_CATALOG['Tax & AP Specialist']);
  assert.ok(ROLE_TEMPLATES_CATALOG['Company Owner']);
  assert.equal(ROLE_TEMPLATES_CATALOG['Company Owner'].defaultApprovalLimitCentavos, -1);
  assert.equal(ROLE_TEMPLATES_CATALOG['Company Owner'].defaultPrimaryModules.length, 16);

  // Even when passed intentionally narrow module/permission lists, Company Owner still resolves 16/16 modules & all 36 routes
  const ownerModules = getAuthorizedERPModules('Company Owner', ['dashboard:view'], ['dashboard']);
  assert.equal(ownerModules.length, 16);
  for (const mod of CANONICAL_ERP_MODULES) {
    for (const sub of mod.submodules) {
      assert.equal(
        isRouteAuthorizedForUser(sub.route, 'Company Owner', [], ['dashboard']),
        true,
        `Company Owner must always reach ${sub.route}`
      );
    }
  }
});
