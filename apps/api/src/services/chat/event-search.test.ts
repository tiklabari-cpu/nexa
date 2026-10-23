/**
 * The API half of the message text search (ID-07 · tm 333.3) that needs no
 * database: the query rules (`messageSearchWords`, the function's own), the
 * date range, and the snippet cut from a found message.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  foldForMessageSearch,
  messageSearchWords,
  MESSAGE_SEARCH_MAX_DAYS,
  MESSAGE_SEARCH_MAX_QUERY_BYTES,
  MESSAGE_SEARCH_MAX_WORDS,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import {
  cutSnippet,
  messageSearchError,
  messageSearchRange,
  messageSearchWordsOrThrow,
} from './event-search.js';

const DAY = 24 * 60 * 60 * 1000;

/** The highlighted parts of a snippet, as text. */
function marked(result: { snippet: string; highlights: Array<{ start: number; end: number }> }) {
  return result.highlights.map((h) => result.snippet.slice(h.start, h.end));
}

function refusal(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return { type: error.type, details: error.details };
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('message search query rules', () => {
  it('folds case and Turkish letters the way siyahtus_search_fold does', () => {
    expect(foldForMessageSearch('İSTANBUL Çağrı ŞİMDİ Iğdır')).toBe('istanbul cagri simdi igdir');
    // The combining dot a Unicode lower-casing leaves behind folds to nothing.
    expect(foldForMessageSearch('i\u0307stanbul')).toBe('istanbul');
    // Only ASCII is lower-cased beyond the Turkish table (the C locale).
    expect(foldForMessageSearch('ÉLAN')).toBe('Élan');
  });

  it('collapses every Unicode space, folds and drops repeated words', () => {
    expect(messageSearchWords('  Papara\u00a0\u00a05000\tpapara ')).toEqual({
      ok: true,
      query: 'Papara 5000 papara',
      words: ['papara', '5000'],
    });
  });

  it('refuses what the function would refuse, naming the rule', () => {
    expect(messageSearchWords('ab')).toEqual({ ok: false, reason: 'too_short' });
    expect(messageSearchWords('a b c')).toEqual({ ok: false, reason: 'no_trigram' });
    expect(messageSearchWords('ç ğ ş')).toEqual({ ok: false, reason: 'no_trigram' });
    const nine = Array.from({ length: MESSAGE_SEARCH_MAX_WORDS + 1 }, (_, i) => `word${i}`);
    expect(messageSearchWords(nine.join(' '))).toEqual({ ok: false, reason: 'too_many_words' });
    expect(messageSearchWords(nine.slice(1).join(' ')).ok).toBe(true);
    expect(messageSearchWords('ş'.repeat(MESSAGE_SEARCH_MAX_QUERY_BYTES / 2 + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(refusal(() => messageSearchWordsOrThrow('ab'))).toEqual({
      type: 'validation',
      details: { reason: 'too_short' },
    });
  });

  it('keeps LIKE characters as words — the function escapes them', () => {
    expect(messageSearchWords('100% user_name')).toEqual({
      ok: true,
      query: '100% user_name',
      words: ['100%', 'user_name'],
    });
  });
});

describe('message search date range', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');

  it('defaults to the 90 days before the end, the end to now', () => {
    expect(messageSearchRange(undefined, undefined, now)).toEqual({
      from: new Date(now.getTime() - 90 * DAY),
      to: now,
    });
    const to = new Date('2026-06-01T00:00:00.000Z');
    expect(messageSearchRange(undefined, to, now).from).toEqual(new Date(to.getTime() - 90 * DAY));
  });

  it('refuses an empty or reversed range and more than the maximum', () => {
    expect(refusal(() => messageSearchRange(now, now, now))).toEqual({
      type: 'validation',
      details: { reason: 'range_order' },
    });
    const from = new Date(now.getTime() - MESSAGE_SEARCH_MAX_DAYS * DAY);
    expect(messageSearchRange(from, now, now).from).toEqual(from);
    expect(refusal(() => messageSearchRange(new Date(from.getTime() - 1), now, now))).toEqual({
      type: 'validation',
      details: { reason: 'range_too_long' },
    });
  });
});

describe('message search snippet', () => {
  it('returns a short message whole, every word highlighted where it is written', () => {
    const result = cutSnippet('Papara ile 5000 TL yatırdım', ['papara', '5000']);
    expect(result.snippet).toBe('Papara ile 5000 TL yatırdım');
    expect(marked(result)).toEqual(['Papara', '5000']);
  });

  it('highlights the original letters a folded word matched', () => {
    const result = cutSnippet('Şubeniz İSTANBUL Kadıköy’de mi?', ['istanbul', 'kadikoy']);
    expect(marked(result)).toEqual(['İSTANBUL', 'Kadıköy']);
  });

  it('cuts the radius either side of the first match and marks each cut', () => {
    const before = 'a'.repeat(100);
    const after = 'b'.repeat(100);
    const result = cutSnippet(`${before} TXID9F3 ${after}`, ['txid9f3']);
    expect(result.snippet).toBe(`…${'a'.repeat(59)} TXID9F3 ${'b'.repeat(59)}…`);
    expect(marked(result)).toEqual(['TXID9F3']);
    expect(result.highlights).toEqual([{ start: 61, end: 68 }]);
  });

  it('keeps a later word inside the window highlighted, and clips one at the edge', () => {
    const text = `iban son ${'x'.repeat(50)} 4421 ${'y'.repeat(100)} 4421`;
    const result = cutSnippet(text, ['iban', '4421']);
    expect(result.snippet.startsWith('iban son')).toBe(true);
    expect(marked(result)).toEqual(['iban', '4421']);
  });

  it('merges overlapping words and takes a word again after each occurrence', () => {
    expect(marked(cutSnippet('merhabalar merhaba', ['merhaba', 'haba']))).toEqual([
      'merhaba',
      'merhaba',
    ]);
    expect(marked(cutSnippet('aaaa', ['aa']))).toEqual(['aaaa']);
  });

  it('treats LIKE characters literally', () => {
    expect(marked(cutSnippet('indirim %100 değil 100% doğru', ['100%']))).toEqual(['100%']);
  });

  it('never splits a surrogate pair at the cut', () => {
    const text = `${'😀'.repeat(40)}kelime${'😀'.repeat(40)}`;
    const result = cutSnippet(text, ['kelime'], 5);
    expect(result.snippet).toBe(`…😀😀😀kelime😀😀😀…`);
    expect(marked(result)).toEqual(['kelime']);
  });

  it('falls back to the start of the text when no word is found in it', () => {
    const result = cutSnippet('x'.repeat(200), ['yok'], 10);
    expect(result.snippet).toBe(`${'x'.repeat(10)}…`);
    expect(result.highlights).toEqual([]);
  });
});

describe('message search errors', () => {
  const raised = (code: string) =>
    new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: ${code}`, {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code },
    });

  it('names a refusal of the function in the API words', () => {
    const tooBroad = messageSearchError(raised('54000'));
    expect(tooBroad).toBeInstanceOf(ApiError);
    expect(tooBroad).toMatchObject({ type: 'validation', details: { reason: 'too_broad' } });
    expect(messageSearchError(raised('57014'))).toMatchObject({
      type: 'service_unavailable',
      status: 503,
      details: { reason: 'search_timeout' },
    });
  });

  it('passes anything else through — a rule drift, a missing timeout or tenant is a programming error', () => {
    for (const code of ['22023', '55000', '42501', '23505']) {
      const error = raised(code);
      expect(messageSearchError(error)).toBe(error);
    }
    const plain = new Error('boom');
    expect(messageSearchError(plain)).toBe(plain);
  });
});
