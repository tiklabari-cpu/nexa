import { describe, expect, it } from 'vitest';
import { SCOPES, expandScope, hasAnyScope, isScope } from './scopes.js';
import { ERROR_STATUS, ERROR_TYPES } from './errors.js';

/**
 * Scopes Nexa adds to the transcribed catalogue.
 *
 * Listed explicitly rather than folded into the count so the guard keeps
 * working: an addition nobody decided on still fails the test below.
 */
const NEXA_ADDED_SCOPES = [
  // Ticketing is a separate product in the source platform, with its own API
  // and no scopes in v2-03 §8.5. Nexa merges it into one inbox (PLAN §D).
  'tickets--all:ro',
  'tickets--access:ro',
  'tickets--all:rw',
  'tickets--access:rw',
  // Connected channels are managed through account settings in the source
  // platform, not a scoped resource. The v1 omnichannel adapters make them a
  // first-class resource (FR-MOD-08.5.4-.6), so Nexa adds channel scopes.
  'channels--all:ro',
  'channels--all:rw',
  // The source platform has no audit resource; Nexa keeps a security trail
  // (NFR-S12) and gates reading it with a scope of its own (PLAN §D).
  'audit_log--all:ro',
  // Bulk egress of that trail to a SIEM (NFR-C6 · C6-b) is a separate
  // authority from paging through it on a screen.
  'audit_log--export:ro',
  // The source platform is single-tenant-per-license with no brand concept;
  // Multibrand (PRD §5.3) makes brands a first-class resource with its own scope.
  'brands--all:ro',
  'brands--all:rw',
  // The source platform's reports surface is read-only, so `reports_read` covered
  // it. Scheduled exports (PRD §5.3-Reports) add a mutation — which report leaves
  // the workspace, how often, to whom — that a read scope must not carry.
  'reports_manage',
];

const SOURCE_SCOPE_COUNT = 58;

describe('scope catalogue', () => {
  // v2-03 §8.5 is headed "~63 scopes" but its table enumerates 58. The table is
  // the authority — the heading is an approximation. Transcribed verbatim.
  it('carries every scope enumerated in v2-03 §8.5, plus Nexa additions', () => {
    expect(SCOPES).toHaveLength(SOURCE_SCOPE_COUNT + NEXA_ADDED_SCOPES.length);
    expect(new Set(SCOPES).size).toBe(SCOPES.length);
    for (const scope of NEXA_ADDED_SCOPES) expect(SCOPES).toContain(scope);
  });

  it('recognises real scopes and rejects invented ones', () => {
    expect(isScope('chats--all:rw')).toBe(true);
    expect(isScope('chats--all:delete')).toBe(false);
    expect(isScope('')).toBe(false);
  });
});

describe('expandScope', () => {
  it('lets read/write imply read', () => {
    expect(expandScope('chats--all:rw')).toContain('chats--all:ro');
  });

  it('lets tenant-wide access imply the narrower variants', () => {
    const expanded = expandScope('chats--all:rw');
    expect(expanded).toContain('chats--access:rw');
    expect(expanded).toContain('chats--access:ro');
  });

  it('does not let a narrow scope imply a wider one', () => {
    // The whole point of `--access` is that it must NOT reach other groups' chats.
    expect(expandScope('chats--access:rw')).not.toContain('chats--all:rw');
    expect(expandScope('chats--access:rw')).not.toContain('chats--all:ro');
  });

  it('does not let read imply write', () => {
    expect(expandScope('chats--all:ro')).not.toContain('chats--all:rw');
    expect(expandScope('agents--all:ro')).not.toContain('agents--all:rw');
  });

  it('leaves non-conforming scopes alone', () => {
    expect(expandScope('reports_read')).toEqual(['reports_read']);
  });

  it('does not let reading the audit log imply exporting it', () => {
    // The separation C6-b rests on. `--all` widens along the access axis
    // (all → access/groups/my); `--export` is a different authority on the same
    // resource, so no amount of read scope reaches it. If this ever inverts, a
    // dashboard integration holding `audit_log--all:ro` silently gains the
    // right to stream the entire trail into a system Nexa does not control.
    expect(expandScope('audit_log--all:ro')).not.toContain('audit_log--export:ro');
    expect(hasAnyScope(['audit_log--all:ro'], ['audit_log--export:ro'])).toBe(false);
    // Nor the other way round: a SIEM connector is not a log browser.
    expect(hasAnyScope(['audit_log--export:ro'], ['audit_log--all:ro'])).toBe(false);
  });
});

describe('hasAnyScope', () => {
  it('grants when an implied scope satisfies the requirement', () => {
    expect(hasAnyScope(['chats--all:rw'], ['chats--all:ro'])).toBe(true);
  });

  it('denies when nothing matches', () => {
    expect(hasAnyScope(['chats--all:ro'], ['chats--all:rw'])).toBe(false);
    expect(hasAnyScope([], ['chats--all:ro'])).toBe(false);
  });

  it('treats an empty requirement as public', () => {
    expect(hasAnyScope([], [])).toBe(true);
  });

  it('ignores unknown scope strings rather than trusting them', () => {
    expect(hasAnyScope(['chats--all:superuser'], ['chats--all:rw'])).toBe(false);
  });
});

describe('error taxonomy', () => {
  // Same rule as the scopes above: the source's 24, plus additions that are
  // named here so an unplanned one still fails.
  const NEXA_ADDED_TYPES = [
    'ticket_exists',
    'account_exists',
    'website_exists',
    'message_rejected',
    // Multibrand (PRD §5.3): a 404 for an un-enumerable brand and a 409 for a
    // duplicate slug within a license.
    'brand_not_found',
    'brand_exists',
    // Supervisor takeover (FR-MOD-08.6.3): the 409 a second, concurrent
    // supervisor gets when they lose the race to seize a chat.
    'takeover_conflict',
    // The sandbox workspace (FR-MOD-11.5 · 11.5-f): the 409 for asking a
    // licence that already has one for a second.
    'sandbox_exists',
    // Two-factor authentication (NFR-S11 · FR-MOD-00.1): the second login
    // step's answer when the password was right and a TOTP/recovery code is
    // still owed, and the 409 for setting up a factor over a live one.
    'two_factor_required',
    'two_factor_already_enabled',
    // Teams (FR-MOD-04.5): the 409 for deleting a team a routing rule still
    // targets, or one an open conversation is reachable through. Neither
    // reference is a foreign key, so this refusal is the only thing between a
    // delete and silently unroutable chats.
    'group_in_use',
  ];

  it('carries the 24 documented types, plus Nexa additions', () => {
    expect(ERROR_TYPES).toHaveLength(24 + NEXA_ADDED_TYPES.length);
    expect(new Set(ERROR_TYPES).size).toBe(ERROR_TYPES.length);
    for (const type of NEXA_ADDED_TYPES) expect(ERROR_TYPES).toContain(type);
  });

  it('maps every type to an HTTP status', () => {
    for (const type of ERROR_TYPES) {
      expect(ERROR_STATUS[type], type).toBeGreaterThanOrEqual(400);
      expect(ERROR_STATUS[type], type).toBeLessThan(600);
    }
  });

  it('returns 404 for not_found so resources cannot be enumerated (NFR-S5)', () => {
    expect(ERROR_STATUS.not_found).toBe(404);
    expect(ERROR_STATUS.authorization).toBe(403);
    expect(ERROR_STATUS.authentication).toBe(401);
    expect(ERROR_STATUS.too_many_requests).toBe(429);
  });
});
