import { describe, expect, it } from 'vitest';
import {
  buildEventId,
  compareEventIds,
  generateShortId,
  isEventId,
  isShortId,
  isUuid,
  parseEventId,
  SHORT_ID_LENGTH,
} from './ids.js';

describe('generateShortId', () => {
  it('produces a 10-character Crockford base32 token', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateShortId();
      expect(id).toHaveLength(SHORT_ID_LENGTH);
      expect(isShortId(id)).toBe(true);
    }
  });

  it('never emits the ambiguous symbols I, L, O or U', () => {
    const sample = Array.from({ length: 500 }, () => generateShortId()).join('');
    expect(sample).not.toMatch(/[ILOU]/);
  });

  it('fits the varchar(12) column', () => {
    expect(generateShortId().length).toBeLessThanOrEqual(12);
  });

  it('discards biased bytes instead of folding them onto low symbols', () => {
    // Feed only bytes in the rejection range, then a usable byte. If rejection
    // were not implemented the id would be all '0' (248 % 32 === 0).
    let call = 0;
    const bytes = () => {
      call += 1;
      return call === 1 ? new Uint8Array(Array(10).fill(0xf8)) : new Uint8Array(Array(10).fill(1));
    };
    expect(generateShortId(bytes)).toBe('1111111111');
  });

  it('is collision-free across a large batch', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => generateShortId()));
    expect(ids.size).toBe(20_000);
  });
});

describe('event ids', () => {
  const thread = 'TJ1H8CFKRV';

  it('round-trips thread id and sequence', () => {
    const id = buildEventId(thread, 7);
    expect(id).toBe('TJ1H8CFKRV_7');
    expect(isEventId(id)).toBe(true);
    expect(parseEventId(id)).toEqual({ threadId: thread, sequence: 7 });
  });

  it('stays inside varchar(40) for very long threads', () => {
    expect(buildEventId(thread, 999_999_999_999).length).toBeLessThanOrEqual(40);
  });

  it('rejects invalid thread ids and sequences', () => {
    expect(() => buildEventId('nope', 1)).toThrow(/invalid thread id/);
    expect(() => buildEventId(thread, 0)).toThrow(/positive integer/);
    expect(() => buildEventId(thread, 1.5)).toThrow(/positive integer/);
  });

  it('parses nothing out of malformed ids', () => {
    expect(parseEventId('TJ1H8CFKRV')).toBeNull();
    expect(parseEventId('TJ1H8CFKRV_')).toBeNull();
    expect(parseEventId('TJ1H8CFKRV_abc')).toBeNull();
    expect(isEventId('lowercase_1')).toBe(false);
  });

  it('orders events within a thread numerically, not lexically', () => {
    // '10' < '9' lexically — the comparator must not fall into that trap.
    expect(compareEventIds(buildEventId(thread, 9), buildEventId(thread, 10))).toBeLessThan(0);
    expect(compareEventIds(buildEventId(thread, 2), buildEventId(thread, 2))).toBe(0);
  });

  it('refuses to compare events from different threads', () => {
    expect(() => compareEventIds(buildEventId(thread, 1), buildEventId('K600PKZQN8', 2))).toThrow(
      /different threads/,
    );
  });
});

describe('isUuid', () => {
  it('accepts a v4 uuid and rejects short ids', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(isUuid('TJ1H8CFKRV')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
