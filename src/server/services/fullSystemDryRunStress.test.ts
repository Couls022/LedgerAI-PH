import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runFullDryRunStressSuite, PROVISIONED_COMPANIES } from './dryRunStressProvisioner';

describe('LedgerAI PH Full-System Dry-Run Stress & Server/Client Enforcement Suite', () => {
  it('enforces PC Server-only company creation, provisions 2 persistent companies, passes all 16 modules, notifications, AI assistant, and 40-request concurrent burst', async () => {
    const { passed, failed, results, tokensByCompany } = await runFullDryRunStressSuite();

    const failures = results.filter((r) => r.status === 'FAIL');
    if (failures.length > 0) {
      console.error('Dry-run failures:', failures);
    }

    assert.equal(failed, 0, `Expected 0 failures across all modules, got ${failed}: ${failures.map((f) => `${f.module}:${f.scenario}`).join('; ')}`);
    assert.ok(passed >= 130, `Expected at least 130 passing checks, got ${passed}`);

    for (const comp of PROVISIONED_COMPANIES) {
      assert.ok(tokensByCompany[comp.id], `Expected active authenticated token for ${comp.id}`);
    }
  });
});
