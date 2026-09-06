/**
 * Uploaded-file parsing (FR-MOD-06.3.2).
 *
 * The negative half comes first and carries the weight, because this function
 * is the only thing standing between an admin-supplied byte string and the
 * indexer: an unsupported type, a file over budget, and bytes that are not text
 * at all must each refuse without producing a single character. Only then the
 * positive half — the same bytes always producing the same text, which is what
 * makes the integration test's "the upload produced chunks" assertion a claim
 * about behaviour rather than about a fixture.
 */
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_FILE_MAX_BYTES } from '@nexa/types';
import {
  isKnowledgeFileParseError,
  parseKnowledgeFile,
  titleFromFilename,
  type KnowledgeFileParseErrorCode,
} from './knowledge-file-parse.js';

function parse(
  contentType: string,
  body: string | Buffer,
  limits?: { maxBytes: number; maxChars: number },
) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return parseKnowledgeFile({ contentType, bytes }, limits);
}

function refusal(
  contentType: string,
  body: string | Buffer,
  limits?: { maxBytes: number; maxChars: number },
) {
  try {
    parse(contentType, body, limits);
  } catch (error) {
    if (isKnowledgeFileParseError(error)) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a refusal, got a parse');
}

describe('parseKnowledgeFile — refusals (FR-MOD-06.3.2)', () => {
  it('refuses every type outside the allow-list, naming what is accepted', () => {
    for (const type of ['application/pdf', 'text/html', 'image/png', 'application/octet-stream']) {
      const { code, message } = refusal(type, 'Delivery takes three days.');
      expect(code).toBe<KnowledgeFileParseErrorCode>('unsupported_type');
      expect(message).toContain(type);
      expect(message).toContain('text/plain, text/markdown, text/csv');
    }
  });

  it('refuses an absent content type rather than guessing one', () => {
    expect(refusal('', 'Delivery takes three days.').code).toBe('unsupported_type');
  });

  it('refuses a file over the byte budget instead of indexing a prefix of it', () => {
    const limits = { maxBytes: 64, maxChars: 100_000 };
    const { code, message } = refusal('text/plain', 'x'.repeat(65), limits);
    expect(code).toBe('file_too_large');
    expect(message).toContain('65 bytes');
    expect(message).toContain('64-byte limit');
  });

  it('refuses text over the character budget', () => {
    const limits = { maxBytes: KNOWLEDGE_FILE_MAX_BYTES, maxChars: 10 };
    expect(refusal('text/plain', 'this is more than ten characters', limits).code).toBe(
      'text_too_long',
    );
  });

  /**
   * The gate that actually stops binary. A `.png` declared `text/plain` passes
   * the type check by construction — that is the point of asserting it here.
   */
  it('refuses bytes that are not valid UTF-8, whatever the caller declared', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0xfd]);
    const { code, message } = refusal('text/plain', png);
    expect(code).toBe('not_text');
    expect(message).toContain('UTF-8');
  });

  it('refuses valid UTF-8 that is still binary, by its control characters', () => {
    // A ZIP's local file header decodes as UTF-8 quite happily; what gives it
    // away is the NUL and the other C0 bytes around it.
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
    expect(refusal('text/plain', zip).code).toBe('not_text');
  });

  it('refuses a file whose text is empty once parsed', () => {
    expect(refusal('text/plain', '   \n\n\t  ').code).toBe('empty');
    // Markdown that is nothing but decoration parses to nothing at all.
    expect(refusal('text/markdown', '# \n\n---\n\n***\n').code).toBe('empty');
  });

  it('reports a malformed CSV as a refusal rather than throwing something else', () => {
    const { code, message } = refusal('text/csv', 'name,note\n"unclosed,cell\n');
    expect(code).toBe('not_text');
    expect(message).toContain('csv:');
  });
});

describe('parseKnowledgeFile — plain text (FR-MOD-06.3.2)', () => {
  it('normalises line endings and blank runs while keeping paragraph breaks', () => {
    const parsed = parse('text/plain', 'Returns\r\n\r\n\r\n\r\nWithin 30 days.   \r\n');
    expect(parsed.mimeType).toBe('text/plain');
    expect(parsed.text).toBe('Returns\n\nWithin 30 days.');
  });

  it('accepts a charset parameter and a leading byte-order mark', () => {
    const parsed = parse('text/plain; charset=UTF-8', '﻿Hours: 9 to 5.');
    expect(parsed.text).toBe('Hours: 9 to 5.');
  });

  it('is deterministic — the same bytes always give the same text', () => {
    const body = 'Warranty covers cracked welds for ten years.\r\n';
    expect(parse('text/plain', body).text).toBe(parse('text/plain', body).text);
  });
});

describe('parseKnowledgeFile — markdown (FR-MOD-06.3.2)', () => {
  it('strips syntax down to the prose underneath', () => {
    const markdown = [
      '# Returns policy',
      '',
      'Items can be returned within **30 days** of _delivery_.',
      '',
      '- Unused and in its [original packaging](https://example.com/packaging)',
      '- Proof of purchase required',
      '',
      '> Shipping is refunded only when the item was faulty.',
      '',
      '---',
      '',
      '| Region | Window |',
      '| ------ | ------ |',
      '| EU     | 30 days |',
    ].join('\n');

    expect(parse('text/markdown', markdown).text).toBe(
      [
        'Returns policy',
        '',
        'Items can be returned within 30 days of delivery.',
        '',
        'Unused and in its original packaging',
        'Proof of purchase required',
        '',
        'Shipping is refunded only when the item was faulty.',
        '',
        'Region Window',
        'EU 30 days',
      ].join('\n'),
    );
  });

  it('keeps a fenced code sample and drops only its fences', () => {
    const markdown = '## Webhook\n\n```json\n{ "event": "chat.closed" }\n```\n';
    expect(parse('text/markdown', markdown).text).toBe('Webhook\n\n{ "event": "chat.closed" }');
  });

  it('keeps an image’s alt text and drops its source', () => {
    expect(parse('text/markdown', '![Warranty card](https://cdn.example.com/w.png)').text).toBe(
      'Warranty card',
    );
  });

  it('does not mistake a mid-word underscore for emphasis', () => {
    expect(parse('text/markdown', 'Use the order_id field.').text).toBe('Use the order_id field.');
  });
});

describe('parseKnowledgeFile — csv (FR-MOD-06.3.2)', () => {
  it('labels every cell with its column so the text says what the numbers are', () => {
    const csv = 'size,frame,price\n48,steel,299\n62,carbon,899\n';
    expect(parse('text/csv', csv).text).toBe(
      'size: 48 · frame: steel · price: 299\nsize: 62 · frame: carbon · price: 899',
    );
  });

  it('drops a blank cell instead of indexing its column name once per row', () => {
    expect(parse('text/csv', 'size,frame\n48,\n').text).toBe('size: 48');
  });

  it('indexes a header-only file as its column names', () => {
    expect(parse('text/csv', 'size,frame,price\n').text).toBe('size · frame · price');
  });

  /**
   * The reason `parseCsv` is reused rather than a `split(',')` written here:
   * this text can leave again through the 07.7 CSV export and open in a
   * spreadsheet, so a cell that would execute there is neutralised on the way
   * in — one rule, one implementation.
   */
  it('neutralises a formula cell on the way in', () => {
    expect(parse('text/csv', 'name,note\nSum,=1+1\n').text).toBe("name: Sum · note: '=1+1");
  });

  it('reads a quoted cell holding commas and line breaks as one value', () => {
    const csv = 'name,note\nDelivery,"Three to five days, then a text\nmessage"\n';
    expect(parse('text/csv', csv).text).toBe(
      'name: Delivery · note: Three to five days, then a text\nmessage',
    );
  });
});

describe('titleFromFilename (FR-MOD-06.3.2)', () => {
  it('keeps the file name and drops every directory segment before it', () => {
    expect(titleFromFilename('returns-policy.md')).toBe('returns-policy.md');
    expect(titleFromFilename('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(titleFromFilename('C:\\Users\\admin\\price list.csv')).toBe('price list.csv');
  });

  it('flattens control characters so a name cannot carry a newline into a log', () => {
    expect(titleFromFilename('policy\n\u0000v2.txt')).toBe('policy v2.txt');
  });

  it('caps the length, because a title is a label and not content', () => {
    expect(titleFromFilename(`${'a'.repeat(300)}.txt`, 200)).toHaveLength(200);
  });
});
