/**
 * The rules both readers share (tm 313.2 · AI-18): text cleanup, table rows,
 * running headers and footers, the ceilings.
 */
import { describe, expect, it } from 'vitest';
import {
  CharacterBudget,
  MIN_AVERAGE_CHARS_PER_PAGE,
  finishDocument,
  hasTextLayer,
  marginKey,
  normalizeInline,
  stripRepeatedMargins,
  tableRow,
} from './normalize.js';
import { DocumentParseError, type DocumentBlock } from './types.js';

const limits = { maxPages: 300, maxChars: 1_000_000 };
const paragraph = (text: string, page = 1): DocumentBlock => ({
  kind: 'paragraph',
  text,
  pageFrom: page,
  pageTo: page,
});

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DocumentParseError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('normalizeInline', () => {
  it('spells out ligatures, drops invisible characters and folds every space', () => {
    const ligature = String.fromCharCode(0xfb01); // fi
    const softHyphen = String.fromCharCode(0xad);
    const zeroWidth = String.fromCharCode(0x200b);
    const noBreak = String.fromCharCode(0xa0);
    const bell = String.fromCharCode(7);
    expect(
      normalizeInline(
        `  re${ligature}nance${softHyphen}  ${zeroWidth}rate${noBreak}\t\n${bell}x  `,
      ),
    ).toBe('refinance rate x');
  });

  it('composes decomposed letters', () => {
    const cedilla = String.fromCharCode(0x327); // ş written as s + a combining cedilla
    expect(normalizeInline(`s${cedilla}`)).toBe('ş');
  });
});

describe('tableRow', () => {
  it('writes AI-18 rows, a pipe inside a cell escaped', () => {
    expect(tableRow(['Plan', ' Gold | VIP ', ''])).toBe('| Plan | Gold \\| VIP |  |');
  });
});

describe('stripRepeatedMargins', () => {
  // Body lines differ by letters: digit runs fold, so numbered body lines would compare equal.
  const letter = (i: number) => String.fromCharCode(65 + i);
  const pages = (count: number, top: (n: number) => string, bottom: (n: number) => string) =>
    Array.from({ length: count }, (_, i) => [
      top(i + 1),
      `Body of page ${letter(i)}, first line`,
      'Shared body line',
      `Body of page ${letter(i)}, last line`,
      bottom(i + 1),
    ]);

  it('takes out a header and a page-numbered footer on 60%+ of the pages, and nothing else', () => {
    const out = stripRepeatedMargins(
      pages(
        5,
        () => 'ACME Corp — Confidential',
        (n) => `Page ${n} of 5`,
      ),
      (line) => line,
    );
    expect(out[0]).toEqual([
      'Body of page A, first line',
      'Shared body line',
      'Body of page A, last line',
    ]);
    // "Shared body line" repeats on every page but sits outside the margin zones.
    expect(out.every((lines) => lines.includes('Shared body line'))).toBe(true);
  });

  it('keeps a line repeated on fewer than 60% of the pages', () => {
    const out = stripRepeatedMargins(
      pages(
        5,
        (n) => (n <= 2 ? 'Draft' : `Chapter title ${String.fromCharCode(64 + n)}`),
        () => 'x',
      ),
      (line) => line,
    );
    expect(out[0]![0]).toBe('Draft');
    expect(out[2]![0]).toBe('Chapter title C');
  });

  it('touches nothing in a document of fewer than three pages', () => {
    const two = pages(
      2,
      () => 'Header',
      () => 'Footer',
    );
    expect(stripRepeatedMargins(two, (line) => line)).toEqual(two);
  });

  it('strips nothing when the "furniture" would be most of the text — a page per entry, one line each', () => {
    const entries = Array.from({ length: 10 }, (_, i) => [
      `Entry ${i + 1}: the rule this page states.`,
    ]);
    expect(stripRepeatedMargins(entries, (line) => line)).toEqual(entries);
  });

  it('spares the lines `keep` names, however often they repeat', () => {
    const out = stripRepeatedMargins(
      pages(
        4,
        (n) => `Article ${n}`,
        () => 'Footer',
      ),
      (line) => line,
      (line) => line.startsWith('Article'),
    );
    expect(out.map((lines) => lines[0])).toEqual([
      'Article 1',
      'Article 2',
      'Article 3',
      'Article 4',
    ]);
    expect(out.every((lines) => !lines.includes('Footer'))).toBe(true);
  });

  it('compares lines with digit runs folded', () => {
    expect(marginKey('  Page 3 of 120 ')).toBe(marginKey('page 14 OF 120'));
  });
});

describe('ceilings', () => {
  it('reads 50 characters a page on average as a text layer, fewer as none', () => {
    expect(MIN_AVERAGE_CHARS_PER_PAGE).toBe(50);
    expect(hasTextLayer(500, 10)).toBe(true);
    expect(hasTextLayer(499, 10)).toBe(false);
    expect(hasTextLayer(0, 0)).toBe(false);
  });

  it('refuses past the character ceiling, as it is reached', () => {
    const budget = new CharacterBudget(10);
    budget.take(10);
    expect(code(() => budget.take(1))).toBe('too_many_characters');
  });

  it('finishes a document within its ceilings and refuses one past them', () => {
    const doc = finishDocument(
      'application/pdf',
      2,
      [paragraph('abc'), paragraph(''), paragraph('de', 2)],
      limits,
    );
    expect(doc).toEqual({
      mime: 'application/pdf',
      pageCount: 2,
      characterCount: 5,
      blocks: [paragraph('abc'), paragraph('de', 2)],
    });
    expect(code(() => finishDocument('application/pdf', 301, [paragraph('a')], limits))).toBe(
      'too_many_pages',
    );
    expect(
      code(() => finishDocument('application/pdf', 1, [paragraph('a'.repeat(1_000_001))], limits)),
    ).toBe('too_many_characters');
    expect(code(() => finishDocument('application/pdf', 1, [paragraph('')], limits))).toBe(
      'no_text_layer',
    );
  });
});
