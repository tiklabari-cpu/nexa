/**
 * The pure half of saved-reply team scope (FR-MOD-08.7.2).
 *
 * The end-to-end property — a team's reply reaches that team and nobody else —
 * is proved against a real database in `test/integration/settings.test.ts`,
 * because a filter that is right in isolation and wrong once Prisma composes it
 * with `?scope=chat` would pass here and fail in the product. What these
 * assertions add is the shape of the clause itself: the empty-membership case
 * has no safe default (an `IN ()` would be a syntax error, and dropping the
 * whole clause would show everything), so it is worth pinning on its own.
 */
import { describe, expect, it } from 'vitest';
import {
  cannedVisibilityFilter,
  hasUnrestrictedCannedScope,
  CANNED_VISIBILITIES,
} from './canned-response-access.js';
import type { Principal } from '../auth/principal.js';

function agent(scopes: string[]): Principal {
  return {
    kind: 'agent',
    accountId: '11111111-1111-1111-1111-111111111111',
    licenseId: 1n,
    organizationId: '22222222-2222-2222-2222-222222222222',
    role: 'agent',
    scopes,
    tokenId: '33333333-3333-3333-3333-333333333333',
    tokenKind: 'pat',
  };
}

describe('canned response visibility (FR-MOD-08.7.2)', () => {
  it('names exactly the two values the CHECK constraint allows', () => {
    expect([...CANNED_VISIBILITIES]).toEqual(['all', 'group']);
  });

  describe('who curates the library', () => {
    it('treats the tenant-wide read as unrestricted', () => {
      expect(hasUnrestrictedCannedScope(agent(['canned_responses--all:ro']))).toBe(true);
    });

    it('accepts the write scope, which implies the read one', () => {
      expect(hasUnrestrictedCannedScope(agent(['canned_responses--all:rw']))).toBe(true);
    });

    it('does not treat the group-scoped read as unrestricted', () => {
      expect(hasUnrestrictedCannedScope(agent(['canned_responses--groups:ro']))).toBe(false);
    });

    it('refuses a customer token outright', () => {
      const customer: Principal = {
        kind: 'customer',
        customerId: '44444444-4444-4444-4444-444444444444',
        organizationId: '22222222-2222-2222-2222-222222222222',
        licenseId: 1n,
      };
      expect(hasUnrestrictedCannedScope(customer)).toBe(false);
    });
  });

  describe('the where-clause', () => {
    it('adds nothing for a curator', () => {
      expect(cannedVisibilityFilter({ unrestricted: true, groupIds: [] })).toEqual({});
    });

    it("offers the workspace-wide replies plus the caller's teams", () => {
      expect(cannedVisibilityFilter({ unrestricted: false, groupIds: [7n, 9n] })).toEqual({
        OR: [{ visibility: 'all' }, { visibility: 'group', groupId: { in: [7n, 9n] } }],
      });
    });

    it('leaves an agent in no team with the workspace-wide replies alone', () => {
      // Not `{}` — that would be the curator's clause and would show every
      // team's private text to somebody in no team at all.
      expect(cannedVisibilityFilter({ unrestricted: false, groupIds: [] })).toEqual({
        OR: [{ visibility: 'all' }],
      });
    });
  });
});
