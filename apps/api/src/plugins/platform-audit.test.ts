/**
 * The audit declaration rules of the platform routes (tm 389.5) — what
 * `onRoute` refuses at boot. Recording itself is
 * `test/integration/platform-audit.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { platformAuditRouteProblem } from './platform-audit.js';

const audit = { action: 'admin.disabled' as const, target: 'admin' as const };

describe('platformAuditRouteProblem (tm 389.5)', () => {
  it('admits an audited mutation, a declared-safe POST and an unaudited read', () => {
    expect(
      platformAuditRouteProblem('POST', '/admins/:adminId/disable', {
        permission: 'admins.manage',
        audit: { ...audit, targetParam: 'adminId' },
      }),
    ).toBeNull();
    expect(
      platformAuditRouteProblem('POST', '/audit/verify', { permission: 'audit.read', safe: true }),
    ).toBeNull();
    expect(platformAuditRouteProblem('GET', '/audit', { permission: 'audit.read' })).toBeNull();
    expect(platformAuditRouteProblem('GET', '/health', undefined)).toBeNull();
  });

  it('refuses a mutation that writes nothing — public ones included', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        platformAuditRouteProblem(method, '/x', { permission: 'admins.manage' }),
        method,
      ).toMatch(/declares config.platform.audit/);
    }
    expect(platformAuditRouteProblem('POST', '/auth/login', undefined)).toMatch(
      /declares config.platform.audit/,
    );
  });

  it('refuses an audited read, a safe read and a safe route that also audits', () => {
    expect(platformAuditRouteProblem('GET', '/x', { permission: 'audit.read', audit })).toMatch(
      /read is not audited/,
    );
    expect(
      platformAuditRouteProblem('GET', '/x', { permission: 'audit.read', safe: true }),
    ).toMatch(/only a non-GET/);
    expect(
      platformAuditRouteProblem('POST', '/x', { permission: 'audit.read', safe: true, audit }),
    ).toMatch(/changes nothing/);
  });

  it('holds the entry to the closed lists and the target to a real path parameter', () => {
    expect(
      platformAuditRouteProblem('POST', '/x', {
        permission: 'admins.manage',
        audit: { action: 'admin.deleted' as never, target: 'admin' },
      }),
    ).toMatch(/unknown audit action/);
    expect(
      platformAuditRouteProblem('POST', '/x', {
        permission: 'admins.manage',
        audit: { action: 'admin.disabled', target: 'operator' as never },
      }),
    ).toMatch(/unknown audit target/);
    expect(
      platformAuditRouteProblem('POST', '/admins/:adminId/disable', {
        permission: 'admins.manage',
        audit: { ...audit, targetParam: 'id' },
      }),
    ).toMatch(/not a path parameter/);
  });
});
