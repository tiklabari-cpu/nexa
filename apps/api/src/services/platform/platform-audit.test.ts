/**
 * The platform audit vocabulary (tm 389.5) — the closed lists and the rule
 * that turns a workspace-touching platform action into the workspace's own
 * wording. The writer, the double entry and the verifier need a database and
 * are `test/integration/platform-audit.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../audit/audit-log.js';
import {
  decodePlatformAuditCursor,
  normalizeReason,
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_DOMAINS,
  PLATFORM_SELF_ACTIONS,
  PLATFORM_TENANT_ACTIONS,
  tenantActionOf,
} from './platform-audit.js';

describe('the platform audit vocabulary (tm 389.5)', () => {
  it('is closed, unique, and every action is <module>.<verb> of a known module', () => {
    expect(new Set(PLATFORM_AUDIT_ACTIONS).size).toBe(PLATFORM_AUDIT_ACTIONS.length);
    for (const action of PLATFORM_AUDIT_ACTIONS) {
      // The shape `platform_audit_log_action_check` holds the column to.
      expect(action).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/);
      expect(PLATFORM_AUDIT_DOMAINS as readonly string[]).toContain(action.split('.')[0]);
    }
  });

  it('lets only the operator’s own session go without a reason', () => {
    for (const action of PLATFORM_SELF_ACTIONS) expect(action.startsWith('admin.')).toBe(true);
    expect(PLATFORM_SELF_ACTIONS.has('admin.disabled')).toBe(false);
    expect(PLATFORM_SELF_ACTIONS.has('workspace.suspended')).toBe(false);
  });

  it('gives every workspace-touching action a wording in the workspace’s own trail', () => {
    expect(PLATFORM_TENANT_ACTIONS.size).toBeGreaterThan(0);
    for (const action of PLATFORM_TENANT_ACTIONS) {
      const tenant = tenantActionOf(action);
      expect(tenant, action).toBe(`platform.${action.replace('.', '_')}`);
      expect(AUDIT_ACTIONS as readonly string[], action).toContain(tenant);
    }
    expect(tenantActionOf('admin.disabled')).toBeNull();
    expect(tenantActionOf('settings.updated')).toBeNull();
  });

  it('writes no platform.* entry in a workspace that no platform action produces', () => {
    const produced = new Set([...PLATFORM_TENANT_ACTIONS].map((action) => tenantActionOf(action)));
    const orphans = AUDIT_ACTIONS.filter((a) => a.startsWith('platform.') && !produced.has(a));
    expect(orphans).toEqual([]);
  });

  it('takes a reason of 3 to 500 characters, trimmed', () => {
    expect(normalizeReason('  why  ')).toBe('why');
    expect(normalizeReason('ab')).toBeNull();
    expect(normalizeReason('   ')).toBeNull();
    expect(normalizeReason('x'.repeat(500))).toHaveLength(500);
    expect(normalizeReason('x'.repeat(501))).toBeNull();
    expect(normalizeReason(42)).toBeNull();
    expect(normalizeReason(undefined)).toBeNull();
  });

  it('reads back only the cursors it writes', () => {
    const cursor = Buffer.from('42', 'utf8').toString('base64url');
    expect(decodePlatformAuditCursor(cursor)).toBe(42n);
    expect(decodePlatformAuditCursor(undefined)).toBeNull();
    expect(decodePlatformAuditCursor('not-a-cursor')).toBeNull();
    expect(decodePlatformAuditCursor(Buffer.from('0').toString('base64url'))).toBeNull();
    expect(decodePlatformAuditCursor(Buffer.from('-1').toString('base64url'))).toBeNull();
  });
});
