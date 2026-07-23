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
  const NEXA_ADDED_TYPES = ['ticket_exists'];

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
