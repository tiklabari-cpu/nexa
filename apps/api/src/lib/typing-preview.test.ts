/**
 * The visitor's draft as an agent sees it (tm 417 · K5): the cut, the
 * characters dropped, the half-typed card masked, and the cost bounded.
 */
import { describe, expect, it } from 'vitest';
import { SNEAK_PEEK_MAX_LENGTH } from '@siyahtus/types';
import { PARTIAL_CARD_DIGIT, sanitizeTypingPreview } from './typing-preview.js';

const dots = (count: number) => PARTIAL_CARD_DIGIT.repeat(count);

describe('sanitizeTypingPreview (FR-MOD-11.8)', () => {
  it.each([
    [
      'a group of four, a space, more digits',
      'kart 4111 1111 11',
      `kart ${dots(4)} ${dots(4)} ${dots(2)}`,
    ],
    ['dots as separators', 'kart 4111.1111.11', `kart ${dots(4)}.${dots(4)}.${dots(2)}`],
    ['hyphens and slashes', 'no: 4111-1111/1', `no: ${dots(4)}-${dots(4)}/${dots(1)}`],
    ['the very first digit after a group', 'kart 4111 1', `kart ${dots(4)} ${dots(1)}`],
    ['twelve digits in a row', 'abc 411111111112', `abc ${dots(12)}`],
    ['full-width digits, after NFKC', 'kart ４１１１ １１', `kart ${dots(4)} ${dots(2)}`],
    ['a trailing space still part of the run', 'kart 4111 1111 ', `kart ${dots(4)} ${dots(4)}`],
  ])('masks a half-typed card at the end: %s', (_label, input, expected) => {
    expect(sanitizeTypingPreview(input)).toBe(expected);
  });

  it.each([
    ['an order number', 'siparişim 1234567'],
    ['four digits on their own', 'kart 4111'],
    ['four digits and a separator, nothing after', 'kart 4111.'],
    ['a time', 'saat 12.30'],
    ['digits in the middle of the text', 'kart 4111 11 dedim'],
  ])('leaves a number that is not card-shaped readable: %s', (_label, input) => {
    expect(sanitizeTypingPreview(input)).toBe(input);
  });

  it('masks a whole card the way a sent message is masked, keeping the last four', () => {
    expect(sanitizeTypingPreview('kart 4111 1111 1111 1111')).toBe('kart **** **** **** 1111');
  });

  it('masks a card the 500 limit cut through, however few digits are left', () => {
    // Starting at the 499th character: two digits survive the cut.
    const starting = sanitizeTypingPreview('a'.repeat(498) + '4111 1111 1111 1111');
    expect(starting).toBe('a'.repeat(498) + dots(2));
    // Straddling the limit: a group of four and a few more survive.
    const straddling = sanitizeTypingPreview('a'.repeat(489) + '4111 1111 1111 1111');
    expect(straddling).toBe(`${'a'.repeat(489)}${dots(4)} ${dots(4)} ${dots(1)}`);
  });

  it('does not mask what the limit cut when the cut fell outside a number', () => {
    const text = sanitizeTypingPreview('a'.repeat(496) + ' 12 bcdef');
    expect(text).toBe('a'.repeat(496) + ' 12');
  });

  it('drops control characters and bidi overrides, keeping a tab and a newline', () => {
    const input = 'a‮b\u0007c⁦d\u0085e\u007F\nf\tg⁩‪';
    expect(sanitizeTypingPreview(input)).toBe('abcde\nf\tg');
  });

  it('trims, and an all-control draft comes back empty', () => {
    expect(sanitizeTypingPreview('   merhaba  ')).toBe('merhaba');
    expect(sanitizeTypingPreview('‮\u0000 ⁦')).toBe('');
    expect(sanitizeTypingPreview('')).toBe('');
  });

  it('cuts to 500 code points, before and after NFKC lengthens the text', () => {
    // An astral character is one code point and two UTF-16 units.
    const astral = sanitizeTypingPreview('😀'.repeat(600));
    expect(Array.from(astral)).toHaveLength(SNEAK_PEEK_MAX_LENGTH);
    // U+FDFA expands to 18 characters under NFKC.
    const expanded = sanitizeTypingPreview('ﷺ'.repeat(400));
    expect(Array.from(expanded).length).toBeLessThanOrEqual(SNEAK_PEEK_MAX_LENGTH);
  });

  it('stays linear on a 1M-character input', () => {
    const inputs = ['1' + 'a'.repeat(999_999), '4111 '.repeat(200_000), '1'.repeat(1_000_000)];
    for (const input of inputs) {
      const started = performance.now();
      const text = sanitizeTypingPreview(input);
      expect(performance.now() - started).toBeLessThan(200);
      expect(Array.from(text).length).toBeLessThanOrEqual(SNEAK_PEEK_MAX_LENGTH);
    }
  });
});
