/**
 * The public edge's input bounds (tm 419 · tm 451 · `input-bounds.ts`).
 *
 * The property that matters for GHSA-mrhx-c7xc-m3w5 is not the 400 — zod's own
 * `.max()` gives that — but that the elements are never parsed when the
 * collection is over its bound. That is pinned with a spy on the element
 * schema: past the bound it is called zero times, and there is one issue.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  boundedArray,
  boundedRecord,
  httpUrl,
  isHttpUrl,
  keptReferrer,
  visitorReferrer,
} from './input-bounds.js';

/** An element schema that counts how often zod asks it about a value. */
function spiedElement() {
  const seen = vi.fn();
  const schema = z.custom<string>((value) => {
    seen(value);
    return typeof value === 'string';
  });
  return { schema, seen };
}

describe('boundedArray', () => {
  it('never parses an element of an array over its bound — one issue, not one per element', () => {
    const { schema, seen } = spiedElement();
    const result = boundedArray(schema, 10).safeParse(Array(500_000).fill(1));

    expect(result.success).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_big',
      maximum: 10,
      message: 'Array must contain at most 10 element(s)',
    });
  });

  it('refuses max + 1 without parsing, and parses every element at max', () => {
    const over = spiedElement();
    expect(boundedArray(over.schema, 10).safeParse(Array(11).fill('x')).success).toBe(false);
    expect(over.seen).not.toHaveBeenCalled();

    const at = spiedElement();
    expect(boundedArray(at.schema, 10).safeParse(Array(10).fill('x')).success).toBe(true);
    expect(at.seen).toHaveBeenCalledTimes(10);
  });

  it('validates the elements of an array within its bound as z.array would', () => {
    const schema = boundedArray(z.string().max(3), 5);

    expect(schema.parse(['a', 'bcd'])).toEqual(['a', 'bcd']);
    const result = schema.safeParse(['a', 'toolong', 7]);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[1], [2]]);
  });

  it('answers a value that is not an array the way z.array does', () => {
    const result = boundedArray(z.string(), 5).safeParse('en');
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'array', received: 'string' }),
    ]);
  });

  it('keeps `.optional()`, `.default()` and a minimum working', () => {
    expect(boundedArray(z.string(), 5).optional().parse(undefined)).toBeUndefined();
    expect(boundedArray(z.string(), 5).default([]).parse(undefined)).toEqual([]);
    const atLeastOne = boundedArray(z.string(), 5, { min: 1 });
    expect(atLeastOne.safeParse([]).success).toBe(false);
    expect(atLeastOne.parse(['a'])).toEqual(['a']);
  });

  it('keeps an issue path under an object field', () => {
    const result = z.object({ langs: boundedArray(z.string(), 2) }).safeParse({ langs: [1, 1, 1] });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['langs']]);
  });
});

describe('boundedRecord', () => {
  it('never parses a value of a record over its key bound', () => {
    const { schema, seen } = spiedElement();
    const keys = Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [`k${i}`, 1]));
    const result = boundedRecord(z.record(schema), 200, 'at most 200 fields').safeParse(keys);

    expect(seen).not.toHaveBeenCalled();
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'custom', message: 'at most 200 fields' }),
    ]);
  });

  it('parses every value of a record at its bound', () => {
    const { schema, seen } = spiedElement();
    const keys = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, 'v']));

    expect(boundedRecord(z.record(schema), 200).safeParse(keys).success).toBe(true);
    expect(seen).toHaveBeenCalledTimes(200);
  });

  it('leaves a non-object to the record schema', () => {
    const result = boundedRecord(z.record(z.string()), 2).safeParse([1, 2, 3]);
    expect(result.error?.issues[0]).toMatchObject({ code: 'invalid_type', expected: 'object' });
  });
});

describe('httpUrl (tm 451)', () => {
  it('keeps an http or https page address', () => {
    expect(httpUrl().parse('https://shop.example/bikes?x=1')).toBe(
      'https://shop.example/bikes?x=1',
    );
    expect(httpUrl().parse('http://shop.example/')).toBe('http://shop.example/');
  });

  it('drops anything that is not one, however it is spelled', () => {
    for (const value of [
      'javascript:alert(document.domain)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '/relative/path',
      'not a url',
    ]) {
      expect(httpUrl().parse(value), value).toBeUndefined();
    }
  });

  it('still refuses an address over its length — that bounds the body', () => {
    expect(httpUrl(20).safeParse(`https://a.example/${'x'.repeat(20)}`).success).toBe(false);
  });

  it('agrees with isHttpUrl', () => {
    expect(isHttpUrl('https://a.example')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('keptReferrer (tm 451)', () => {
  it('keeps http(s), an Android app referrer and text with no scheme', () => {
    expect(keptReferrer('https://www.google.com/')).toBe('https://www.google.com/');
    expect(keptReferrer('android-app://com.google.android.gm/')).toBe(
      'android-app://com.google.android.gm/',
    );
    expect(keptReferrer('some-opaque-source')).toBe('some-opaque-source');
  });

  it('drops a scheme a script could run from', () => {
    expect(keptReferrer('javascript:alert(document.domain)')).toBeUndefined();
    expect(keptReferrer('  JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(keptReferrer('data:text/html,hi')).toBeUndefined();
    expect(visitorReferrer(2048).parse('vbscript:x')).toBeUndefined();
  });
});
