import { describe, expect, it } from 'vitest';
import {
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  isPlatformPermission,
  isPlatformRole,
  platformPermissionsFor,
  platformRoleHas,
  type PlatformPermission,
} from './platform.js';

const permissions = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];
const writes = permissions.filter((p) => PLATFORM_PERMISSIONS[p].kind === 'write');

describe('the platform permission matrix (tm 389.4)', () => {
  it('names four roles and only those in every row', () => {
    expect(PLATFORM_ROLES).toEqual(['superadmin', 'support', 'billing', 'readonly']);
    for (const permission of permissions) {
      for (const role of PLATFORM_PERMISSIONS[permission].roles) {
        expect(isPlatformRole(role), `${permission}: ${role}`).toBe(true);
      }
    }
  });

  it('gives readonly no write at all', () => {
    expect(writes.length).toBeGreaterThan(5);
    for (const permission of writes) expect(platformRoleHas('readonly', permission)).toBe(false);
    expect(
      platformPermissionsFor('readonly').every((p) => PLATFORM_PERMISSIONS[p].kind === 'read'),
    ).toBe(true);
  });

  it('gives superadmin every permission, and keeps operator management to it alone', () => {
    expect(platformPermissionsFor('superadmin')).toEqual(permissions);
    for (const role of PLATFORM_ROLES) {
      expect(platformRoleHas(role, 'admins.manage'), role).toBe(role === 'superadmin');
      expect(platformRoleHas(role, 'settings.manage'), role).toBe(role === 'superadmin');
      expect(platformRoleHas(role, 'workspaces.lifecycle'), role).toBe(role === 'superadmin');
    }
  });

  it('splits the desks along requirements §2: support acts on accounts, billing on plans', () => {
    expect(platformRoleHas('support', 'accounts.support')).toBe(true);
    expect(platformRoleHas('support', 'billing.manage')).toBe(false);
    expect(platformRoleHas('billing', 'billing.manage')).toBe(true);
    expect(platformRoleHas('billing', 'accounts.support')).toBe(false);
    expect(platformRoleHas('billing', 'accounts.read')).toBe(false);
    expect(platformRoleHas('support', 'support.impersonate')).toBe(true);
    expect(platformRoleHas('support', 'support.impersonate_full')).toBe(false);
  });

  it('says no to an unknown role or permission rather than throwing', () => {
    expect(platformRoleHas('owner', 'admins.read')).toBe(false);
    expect(platformRoleHas('superadmin', 'admins.delete')).toBe(false);
    expect(platformRoleHas('superadmin', 'toString')).toBe(false);
    expect(isPlatformPermission('constructor')).toBe(false);
    expect(platformPermissionsFor('root')).toEqual([]);
  });
});
