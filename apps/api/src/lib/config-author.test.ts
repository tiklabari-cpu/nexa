import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error.js';
import { draftRevisionOf } from './config-author.js';

describe('If-Match → the draft revision a save was made against (tm 316.2 · AI-20)', () => {
  it('reads the ETag the draft gave, quoted, weak or bare', () => {
    expect(draftRevisionOf('"12"')).toBe(12n);
    expect(draftRevisionOf('W/"12"')).toBe(12n);
    expect(draftRevisionOf('12')).toBe(12n);
    expect(draftRevisionOf(' "0" ')).toBe(0n);
  });

  it('is no condition without a header or with *', () => {
    expect(draftRevisionOf(undefined)).toBeNull();
    expect(draftRevisionOf('')).toBeNull();
    expect(draftRevisionOf('*')).toBeNull();
  });

  it('refuses anything else rather than saving without the condition the client meant', () => {
    for (const value of ['"12', '12"', '"a"', '"1", "2"', '-1', '1.5', '"99999999999999999999"']) {
      expect(() => draftRevisionOf(value), value).toThrow(ApiError);
    }
    expect(() => draftRevisionOf(['"1"', '"2"'])).toThrow(ApiError);
  });
});
