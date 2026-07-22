import { describe, expect, it } from 'vitest';
import { SCOPES, expandScope, hasAnyScope, isScope } from './scopes.js';
import { ERROR_STATUS, ERROR_TYPES } from './errors.js';

describe('scope catalogue', () => {
  // v2-03 §8.5 is headed "~63 scopes" but its table enumerates 58. The table is
  // the authority — the heading is an approximation. Transcribed verbatim.
  it('carries every scope enumerated in v2-03 §8.5', () => {
    expect(SCOPES).toHaveLength(58);
    expect(new Set(SCOPES).size).toBe(58);
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
  it('carries the 24 documented types', () => {
    expect(ERROR_TYPES).toHaveLength(24);
    expect(new Set(ERROR_TYPES).size).toBe(24);
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
