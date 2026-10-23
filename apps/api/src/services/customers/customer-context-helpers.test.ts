/**
 * The player card's pure parts (tm 331.1): reading a `filled_form` event's
 * answers, and the history cursor that pages without naming a chat. The read
 * itself is `test/integration/customer-context.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api-error.js';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  formAnswers,
  nextCursor,
} from './customer-context.js';

describe('formAnswers', () => {
  it('reads labelled answers, as `value` or LiveChat’s `answer`, trimmed', () => {
    expect(
      formAnswers({
        fields: [
          { label: ' Konu ', value: ' Yatırım ' },
          { label: 'Tutar', answer: '500 TL' },
        ],
      }),
    ).toEqual([
      { label: 'Konu', value: 'Yatırım' },
      { label: 'Tutar', value: '500 TL' },
    ]);
  });

  it('leaves out what is not a labelled, non-blank string', () => {
    expect(
      formAnswers({
        fields: [
          { label: '', value: 'x' },
          { label: 'Boş', value: '   ' },
          { label: 'Sayı', value: 5 },
          { value: 'etiketsiz' },
          null,
          'düz metin',
          { label: 'Tamam', value: 'evet' },
        ],
      }),
    ).toEqual([{ label: 'Tamam', value: 'evet' }]);
  });

  it('reads anything that is not a form as no answers', () => {
    for (const properties of [null, undefined, 'x', 3, [], {}, { fields: 'x' }, { fields: {} }]) {
      expect(formAnswers(properties)).toEqual([]);
    }
  });

  it('reads at most 50 answers off one event', () => {
    const fields = Array.from({ length: 80 }, (_, i) => ({ label: `S${i}`, value: `C${i}` }));
    expect(formAnswers({ fields })).toHaveLength(50);
  });
});

describe('the history cursor', () => {
  const at = (ms: number) => new Date(ms);

  it('counts the rows of the last row’s millisecond, and carries the count across pages', () => {
    expect(nextCursor(null, [at(500), at(400), at(300)])).toEqual({ at: 300, seen: 1 });
    expect(nextCursor(null, [at(500), at(300), at(300)])).toEqual({ at: 300, seen: 2 });
    // A tie that spans pages: the earlier page's count is added.
    expect(nextCursor({ at: 300, seen: 2 }, [at(300), at(300)])).toEqual({ at: 300, seen: 4 });
    // A new millisecond starts a new count.
    expect(nextCursor({ at: 300, seen: 2 }, [at(300), at(200)])).toEqual({ at: 200, seen: 1 });
  });

  it('round-trips, and holds a time and a count only', () => {
    const encoded = encodeHistoryCursor({ at: 1_760_000_000_123, seen: 3 });
    expect(decodeHistoryCursor(encoded)).toEqual({ at: 1_760_000_000_123, seen: 3 });
    expect(Object.keys(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))).toEqual([
      'at',
      'seen',
    ]);
  });

  it('refuses a cursor it did not write', () => {
    const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const bad of [
      'not-base64-json',
      json(null),
      json({ at: 1 }),
      json({ at: 'yesterday', seen: 1 }),
      json({ at: -1, seen: 1 }),
      json({ at: 1.5, seen: 1 }),
      // A time past the last representable date — `at + 1` would be no date.
      json({ at: 8_640_000_000_000_000, seen: 1 }),
      json({ at: 1, seen: 0 }),
      json({ at: 1, seen: 10_001 }),
    ]) {
      expect(() => decodeHistoryCursor(bad), bad).toThrow(ApiError);
    }
  });
});
