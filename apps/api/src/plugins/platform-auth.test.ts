/**
 * The route-declaration rules of the operator gate (tm 389.4) — what
 * `onRoute` refuses at boot. The gate's runtime behaviour is
 * `test/integration/platform-auth.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { platformRouteProblem } from './platform-auth.js';

describe('platformRouteProblem (tm 389.4)', () => {
  it('admits a public route, a permission route and a self route', () => {
    expect(platformRouteProblem('GET', '/health', { public: true })).toBeNull();
    expect(
      platformRouteProblem('GET', '/admins', { platform: { permission: 'admins.read' } }),
    ).toBeNull();
    expect(
      platformRouteProblem('POST', '/admins/x/disable', {
        platform: { permission: 'admins.manage', recentTotp: true },
      }),
    ).toBeNull();
    expect(
      platformRouteProblem('POST', '/auth/totp/enroll', {
        platform: { self: true, stage: 'enrollment' },
      }),
    ).toBeNull();
  });

  it('refuses a route that declares nothing — closed is the default, not open', () => {
    expect(platformRouteProblem('GET', '/x', undefined)).toMatch(/declares config.platform/);
    expect(platformRouteProblem('GET', '/x', {})).toMatch(/declares config.platform/);
    expect(platformRouteProblem('GET', '/x', { platform: {} })).toMatch(/permission or self/);
  });

  it('refuses contradictions instead of picking a side', () => {
    expect(
      platformRouteProblem('GET', '/x', { public: true, platform: { permission: 'admins.read' } }),
    ).toMatch(/public route cannot also/);
    expect(
      platformRouteProblem('GET', '/x', { platform: { permission: 'admins.read', self: true } }),
    ).toMatch(/not both/);
  });

  it('holds a mutation to a write permission and a known name', () => {
    expect(platformRouteProblem('POST', '/x', { platform: { permission: 'admins.read' } })).toMatch(
      /write permission/,
    );
    expect(
      platformRouteProblem('DELETE', '/x', { platform: { permission: 'audit.read' } }),
    ).toMatch(/write permission/);
    expect(
      platformRouteProblem('GET', '/x', {
        platform: { permission: 'admins.delete' as never },
      }),
    ).toMatch(/unknown permission/);
  });

  it('lets a public route name its audit entry, and a declared-safe POST be guarded by a read (tm 389.5)', () => {
    const audit = { action: 'admin.signed_in' as const, target: 'admin' as const };
    expect(
      platformRouteProblem('POST', '/auth/login', { public: true, platform: { audit } }),
    ).toBeNull();
    expect(
      platformRouteProblem('POST', '/auth/login', {
        public: true,
        platform: { audit, recentTotp: true },
      }),
    ).toMatch(/public route cannot also declare operator gates \(config\.platform\.recentTotp\)/);
    expect(
      platformRouteProblem('POST', '/audit/verify', {
        platform: { permission: 'audit.read', safe: true },
      }),
    ).toBeNull();
  });

  it('keeps the pre-code stages to self routes, and recentTotp to active sessions', () => {
    expect(
      platformRouteProblem('POST', '/x', {
        platform: { permission: 'admins.manage', stage: 'any' },
      }),
    ).toMatch(/only a self route/);
    expect(
      platformRouteProblem('POST', '/x', {
        platform: { self: true, stage: 'challenge', recentTotp: true },
      }),
    ).toMatch(/recentTotp needs an active session/);
  });
});
