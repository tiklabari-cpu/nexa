/**
 * The HIPAA scope predicate (NFR-C4 · C4-e).
 *
 * Small, but it is the single input to three different constraints, so the two
 * decisions it encodes are pinned here rather than left to be re-derived: an
 * unsigned licence is out of scope, and a licence nobody can find is too.
 */
import { describe, expect, it } from 'vitest';
import { inHipaaScope } from './hipaa.js';

describe('inHipaaScope', () => {
  it('is true once the agreement has a date', () => {
    expect(inHipaaScope({ hipaaBaaSignedAt: new Date('2026-08-15T00:00:00.000Z') })).toBe(true);
  });

  it('is false while the agreement is unsigned', () => {
    expect(inHipaaScope({ hipaaBaaSignedAt: null })).toBe(false);
  });

  it('is false — not an error — for a licence that is not there', () => {
    // Every caller is deciding whether to *tighten* something. A workspace
    // nobody can find is not one to relax a constraint for, but it is also not
    // one to crash a retention sweep over.
    expect(inHipaaScope(null)).toBe(false);
    expect(inHipaaScope(undefined)).toBe(false);
  });
});
