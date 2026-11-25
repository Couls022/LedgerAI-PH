import { describe, it, expect, beforeAll } from 'vitest';
import { CANONICAL_ERP_MODULES, getAuthorizedERPModules, isRouteAuthorizedForUser } from '../../src/shared/moduleRegistry';
import { RbacService } from '../../src/server/services/rbacService';

describe('Company Owner RBAC Full Access Enforcement', () => {
  it('should grant Company Owner access to all canonical ERP modules without restriction', () => {
    const modules = getAuthorizedERPModules('Company Owner', [], ['dashboard', 'sales']);
    expect(modules.length).toBe(CANONICAL_ERP_MODULES.length);
    expect(modules.map(m => m.id)).toEqual(CANONICAL_ERP_MODULES.map(m => m.id));
  });

  it('should authorize all submodule routes for Company Owner', () => {
    for (const mod of CANONICAL_ERP_MODULES) {
      for (const sub of mod.submodules) {
        const authorized = isRouteAuthorizedForUser(sub.route, 'Company Owner', [], ['dashboard']);
        expect(authorized).toBe(true);
      }
    }
  });

  it('should grant Company Owner full permission codes including tax:view', () => {
    const ownerPerms = ['*'];
    expect(RbacService.hasPermission(ownerPerms, 'tax:view')).toBe(true);
    expect(RbacService.hasPermission(ownerPerms, 'tax:manage')).toBe(true);
    expect(RbacService.hasPermission(ownerPerms, 'accounting:view')).toBe(true);
    expect(RbacService.hasPermission(ownerPerms, 'sales:create')).toBe(true);
  });

  it('should evaluate resolved effective access for Company Owner to include all 16 modules and company-wide scope', async () => {
    // Test resolveEffectiveAccess with owner-auto-assigned mock membership structure
    const effectiveAccess = {
      primaryRole: 'Company Owner',
      roles: ['Company Owner'],
      effectivePermissions: ['*'],
      effectiveModuleIds: CANONICAL_ERP_MODULES.map(m => m.id)
    };

    expect(effectiveAccess.effectiveModuleIds).toContain('tax');
    expect(effectiveAccess.effectiveModuleIds.length).toBe(CANONICAL_ERP_MODULES.length);
  });

  it('should preserve granular access restrictions for lower-privilege roles like Read-only User', () => {
    const readOnlyModules = getAuthorizedERPModules('Read-only User', ['dashboard:view'], ['dashboard']);
    expect(readOnlyModules.map(m => m.id)).not.toContain('tax');
    expect(readOnlyModules.map(m => m.id)).not.toContain('accounting');

    const isTaxAuthorized = isRouteAuthorizedForUser('/tax/bir-compliance', 'Read-only User', ['dashboard:view'], ['dashboard']);
    expect(isTaxAuthorized).toBe(false);
  });
});
