/**
 * What an operator signed in as a member may write (tm 389.15 · FR-ADMIN-21).
 *
 * The rule is held to the published tenant contract: every mutating
 * operation has a verdict, every forbidden and every allowed pattern names at
 * least one real operation (a pattern that matches nothing is a door nobody
 * guards), and the acceptance criterion's two refusals read as written.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import { describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  IMPERSONATION_ALLOWED_WRITES,
  IMPERSONATION_EXIT_PATHS,
  IMPERSONATION_FORBIDDEN_PATHS,
  impersonationWriteVerdict,
} from '@siyahtus/types';
import { impersonationRefusal } from './impersonation-gate.js';

const MUTATING = ['post', 'put', 'patch', 'delete'] as const;

/** Every mutating operation the tenant contract publishes, as `METHOD /path`. */
function contractWrites(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const [path, item] of Object.entries(loadOpenApiDocument().paths)) {
    for (const method of MUTATING) {
      if ((item as Record<string, unknown>)[method]) out.push({ method, path });
    }
  }
  return out;
}

const normalize = (path: string) => path.replace(/\{[^/}]+\}/g, 'x');

describe('impersonation write verdicts against the tenant contract (tm 389.15)', () => {
  const writes = contractWrites();

  it('reads a real contract, not an empty one', () => {
    expect(writes.length).toBeGreaterThan(200);
  });

  it('classifies every mutating operation — none is left to chance', () => {
    const unclassified = writes
      .filter(({ path }) => impersonationWriteVerdict(path).verdict === 'unclassified')
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(unclassified).toEqual([]);
  });

  it('guards something real with every forbidden rule', () => {
    for (const rule of IMPERSONATION_FORBIDDEN_PATHS) {
      const hits = writes.filter(({ path }) => rule.pattern.test(normalize(path)));
      expect(hits.length, String(rule.pattern)).toBeGreaterThan(0);
    }
  });

  it('opens something real with every allowed pattern', () => {
    for (const pattern of IMPERSONATION_ALLOWED_WRITES) {
      const hits = writes.filter(
        ({ path }) =>
          pattern.test(normalize(path)) && impersonationWriteVerdict(path).verdict === 'allowed',
      );
      expect(hits.length, String(pattern)).toBeGreaterThan(0);
    }
  });

  it('names exit paths the contract publishes', () => {
    const paths = new Set(writes.map(({ path }) => path));
    for (const exit of IMPERSONATION_EXIT_PATHS) expect(paths.has(exit), exit).toBe(true);
  });

  it('closes every category the requirement names (§3.10)', () => {
    const verdictOf = (path: string) => impersonationWriteVerdict(path);
    expect(verdictOf('/auth/password-reset')).toEqual({
      verdict: 'forbidden',
      category: 'password',
    });
    expect(verdictOf('/auth/password')).toEqual({ verdict: 'forbidden', category: 'password' });
    expect(verdictOf('/auth/2fa/enroll')).toEqual({ verdict: 'forbidden', category: 'two_factor' });
    expect(verdictOf('/auth/2fa')).toEqual({ verdict: 'forbidden', category: 'two_factor' });
    expect(verdictOf('/auth/personal-access-tokens')).toMatchObject({ category: 'credentials' });
    expect(verdictOf('/settings/scim-tokens/{tokenId}')).toMatchObject({ category: 'credentials' });
    expect(verdictOf('/scim/v2/Users')).toMatchObject({ category: 'credentials' });
    expect(verdictOf('/settings/security')).toMatchObject({ category: 'security' });
    expect(verdictOf('/settings/ip-allowlist')).toMatchObject({ category: 'security' });
    expect(verdictOf('/billing/payment-method')).toMatchObject({ category: 'payment' });
    expect(verdictOf('/billing/subscription')).toMatchObject({ category: 'subscription' });
    expect(verdictOf('/settings/compliance/baa')).toMatchObject({ category: 'baa' });
    expect(verdictOf('/customers/{customerId}/erase')).toMatchObject({ category: 'data_deletion' });
    expect(verdictOf('/settings/sandbox/reset')).toMatchObject({ category: 'sandbox' });
    // New standing access and new data egress, on top of the requirement's list.
    expect(verdictOf('/invitations')).toMatchObject({ category: 'membership' });
    expect(verdictOf('/agents/{agentId}/role')).toMatchObject({ category: 'membership' });
    expect(verdictOf('/agents/me')).toMatchObject({ category: 'membership' });
    expect(verdictOf('/webhooks')).toMatchObject({ category: 'data_egress' });
  });

  it('lets the forbidden list win inside an allowed resource', () => {
    expect(impersonationWriteVerdict('/customers/{customerId}').verdict).toBe('allowed');
    expect(impersonationWriteVerdict('/customers/{customerId}/erase').verdict).toBe('forbidden');
    expect(impersonationWriteVerdict('/agents/{agentId}/chat-limit').verdict).toBe('allowed');
    expect(impersonationWriteVerdict('/agents/{agentId}/suspension').verdict).toBe('forbidden');
  });

  it('closes a resource nobody has classified', () => {
    expect(impersonationWriteVerdict('/settings/brand-new-section')).toEqual({
      verdict: 'unclassified',
    });
    expect(impersonationWriteVerdict('/something-new')).toEqual({ verdict: 'unclassified' });
  });
});

describe('impersonationRefusal — the gate on the route pattern', () => {
  const messages = '/api/v1/chats/:chatId/messages';

  it('refuses a write in a read-only session and lets the full one through', () => {
    expect(impersonationRefusal('read_only', 'POST', messages)).toEqual({
      type: 'impersonation_read_only',
    });
    expect(impersonationRefusal('full', 'POST', messages)).toBeNull();
  });

  it('refuses the forbidden paths in both modes, with the category', () => {
    for (const mode of ['read_only', 'full'] as const) {
      expect(impersonationRefusal(mode, 'POST', '/api/v1/auth/2fa/enroll')).toEqual({
        type: 'impersonation_forbidden_path',
        category: 'two_factor',
      });
      expect(
        impersonationRefusal(mode, 'DELETE', '/api/v1/auth/personal-access-tokens/:tokenId'),
      ).toMatchObject({ type: 'impersonation_forbidden_path', category: 'credentials' });
    }
  });

  it('refuses an unclassified write in both modes (fail closed)', () => {
    for (const mode of ['read_only', 'full'] as const) {
      expect(impersonationRefusal(mode, 'POST', '/api/v1/brand-new/:id')).toEqual({
        type: 'impersonation_forbidden_path',
        category: 'unclassified',
      });
    }
  });

  it('lets a read-only session leave', () => {
    expect(impersonationRefusal('read_only', 'POST', '/api/v1/auth/revoke')).toBeNull();
    expect(impersonationRefusal('read_only', 'POST', '/api/v1/auth/impersonation/end')).toBeNull();
  });

  it('reads every read, HEAD included, and leaves an unmatched address to its 404', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(impersonationRefusal('read_only', method, '/api/v1/settings/security')).toBeNull();
    }
    expect(impersonationRefusal('read_only', 'POST', undefined)).toBeNull();
  });
});
