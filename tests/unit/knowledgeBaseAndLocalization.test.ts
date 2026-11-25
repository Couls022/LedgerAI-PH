import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CANONICAL_KNOWLEDGE_BASE, searchKnowledgeBase, getKnowledgeRecordByModule } from '../../src/shared/knowledgeBase';
import { EnterpriseAiAgentService } from '../../src/server/services/enterpriseAiAgentService';
import { CompanyManager } from '../../src/server/services/companyManager';

test('REQ-KB-001: Knowledge Base covers all 16 canonical ERP modules and 36 submodules', () => {
  assert.ok(CANONICAL_KNOWLEDGE_BASE.length >= 36);
  const expectedModules = [
    'dashboard', 'sales', 'procurement', 'inventory', 'cash-banking',
    'accounting', 'fixed-assets', 'payroll', 'tax', 'budget',
    'documents', 'reports', 'approvals', 'activity-center', 'audit', 'master-data'
  ];
  const uniqueModules = new Set(CANONICAL_KNOWLEDGE_BASE.map(r => r.moduleId));
  assert.equal(uniqueModules.size, 16);
  for (const modId of expectedModules) {
    const record = getKnowledgeRecordByModule(modId);
    assert.ok(record, `Knowledge record missing for module: ${modId}`);
    assert.equal(record.verificationStatus, 'VERIFIED');
    assert.ok(record.navigationPath);
    assert.ok(record.userInstructions.length > 0);
  }
});

test('REQ-KB-002: Knowledge base search retrieves accurate submodule guides', () => {
  const salesResults = searchKnowledgeBase('sales invoice');
  assert.ok(salesResults.length > 0);
  assert.equal(salesResults[0].moduleId, 'sales');

  const payrollResults = searchKnowledgeBase('payroll');
  assert.ok(payrollResults.length > 0);
  assert.equal(payrollResults[0].moduleId, 'payroll');

  const auditResults = searchKnowledgeBase('audit trail');
  assert.ok(auditResults.length > 0);
  assert.equal(auditResults[0].moduleId, 'audit');
});

test('REQ-KB-003: Ledger Agent answers manual and how-to queries using knowledge base', async () => {
  const tempCompanyId = 'LGR-PH-KB-TEST-' + Date.now();
  await CompanyManager.createCompanyProfile(tempCompanyId, 'KB Knowledge Test Corp');

  try {
    const response = await EnterpriseAiAgentService.executeInquiry({
      companyId: tempCompanyId,
      companyName: 'KB Knowledge Test Corp',
      userId: 'usr-admin',
      userRole: 'Company Owner',
      permissions: ['*'],
      deniedPermissions: [],
      prompt: 'How do I create a sales invoice?',
      forceOffline: true,
    });

    assert.ok(response);
    assert.ok(response.answer.includes('Sales Invoices & Billing'));
    assert.ok(response.answer.includes('Create Sales Invoice'));
    assert.equal(response.skillId, 'knowledgeBaseQuery');
    assert.equal(response.provenance.confidenceState, 'VERIFIED_AUTHORITATIVE');
  } finally {
    try {
      await CompanyManager.deleteCompany(tempCompanyId);
    } catch {}
  }
});

test('REQ-LOC-001: English-only localization audit confirms zero disallowed Tagalog strings in knowledge base', () => {
  for (const rec of CANONICAL_KNOWLEDGE_BASE) {
    assert.ok(rec.moduleName);
    assert.ok(rec.purpose);
    for (const step of rec.userInstructions) {
      assert.doesNotMatch(step, /^Kumusta|Mangyaring|Pindutin|I-click/i);
    }
  }
});
