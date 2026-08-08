import { describe, expect, it } from 'vitest';
import { type CsvLimits, type CsvParseError, isCsvParseError, parseCsv } from './csv-import.js';

/**
 * FR-MOD-06.3.2 — CSV reading for bulk knowledge-base import.
 *
 * The negatives lead because they are the reason this module exists. A parser
 * that guesses turns a bad file into plausible-looking rows, and a wrong row
 * becomes a wrong answer from the AI weeks later; a parser that misses the
 * formula guard hands the next person to open the export a live payload; a
 * parser that backtracks turns one upload into an event-loop stall. Only after
 * those three hold does "it parses a normal file" mean anything.
 */

/** Generous limits, so a test that is not about budgets never trips one. */
const LIMITS: CsvLimits = { maxRows: 1_000, maxCellChars: 10_000, maxBytes: 5_000_000 };

/** The refusal a call produced, or a failure if it did not refuse at all. */
function refusalOf(run: () => unknown): CsvParseError {
  try {
    run();
  } catch (error) {
    if (isCsvParseError(error)) return error;
    throw error;
  }
  throw new Error('expected parseCsv to refuse, but it returned');
}

describe('parseCsv — refusals', () => {
  it('refuses a quoted value that never closes, pointing at the opening quote', () => {
    const error = refusalOf(() => parseCsv('title,body\nhello,"never ends\n', LIMITS));

    expect(error.code).toBe('unclosed_quote');
    expect(error.line).toBe(2);
    expect(error.column).toBe(7); // `hello,` is six characters
  });

  it('refuses text after a closing quote instead of guessing which half is the value', () => {
    // `"ab"cd` has no reading in RFC 4180. Silently keeping `ab` (or `abcd`)
    // would change the imported value without anyone being told.
    const error = refusalOf(() => parseCsv('a,b\n"ab"cd,x\n', LIMITS));

    expect(error.code).toBe('text_after_closing_quote');
    expect(error.line).toBe(2);
    expect(error.column).toBe(5);
  });

  it('refuses a file over the row budget rather than importing the first N rows', () => {
    const text = ['title', 'one', 'two', 'three'].join('\n');
    const error = refusalOf(() => parseCsv(text, { ...LIMITS, maxRows: 2 }));

    expect(error.code).toBe('too_many_rows');
    expect(error.message).toContain('2');
    // Two rows fit exactly; the refusal is about the third, not about the cap.
    expect(parseCsv('title\none\ntwo\n', { ...LIMITS, maxRows: 2 }).rows).toEqual([
      ['one'],
      ['two'],
    ]);
  });

  it('refuses an over-long cell rather than truncating it', () => {
    const long = 'x'.repeat(51);
    const error = refusalOf(() => parseCsv(`title\n${long}\n`, { ...LIMITS, maxCellChars: 50 }));

    expect(error.code).toBe('cell_too_long');
    expect(error.line).toBe(2);
    expect(error.column).toBe(1);
  });

  it('applies the cell budget to a quoted value too, decoded quotes included', () => {
    // `""` decodes to one character, so `""""""""""` is a quoted field holding
    // four of them. The budget is about the value that gets stored, not the
    // characters on the line — a three-character budget must refuse it, and a
    // four-character one must not.
    const cell = 't\n"""""""""",x\n';
    const error = refusalOf(() => parseCsv(cell, { ...LIMITS, maxCellChars: 3 }));
    expect(parseCsv(cell, { ...LIMITS, maxCellChars: 4 }).rows).toEqual([['""""', 'x']]);

    expect(error.code).toBe('cell_too_long');
    expect(error.line).toBe(2); // the quoted cell, not the header above it
    expect(error.column).toBe(1);
  });

  it('refuses a payload over the byte budget, counting UTF-8 bytes not characters', () => {
    // 'ş' is two bytes: ten characters are twenty bytes.
    const error = refusalOf(() => parseCsv('ş'.repeat(10), { ...LIMITS, maxBytes: 19 }));

    expect(error.code).toBe('file_too_large');
    expect(error.message).toContain('20 bytes');
    expect(parseCsv('ş'.repeat(10), { ...LIMITS, maxBytes: 20 }).header).toEqual(['ş'.repeat(10)]);
  });

  it('rejects a limit that would silently disable its own guard', () => {
    // NaN loses every comparison, so a NaN cap is no cap. That is a caller bug,
    // and it fails as one rather than parsing an unbounded upload.
    expect(() => parseCsv('a', { ...LIMITS, maxBytes: Number.NaN })).toThrow(RangeError);
    expect(() => parseCsv('a', { ...LIMITS, maxRows: 0 })).toThrow(RangeError);
    expect(() => parseCsv('a', { ...LIMITS, maxCellChars: -1 })).toThrow(RangeError);
  });
});

describe('parseCsv — formula injection is neutralised on the way in', () => {
  it('neutralises the KK payload verbatim', () => {
    // The canonical spreadsheet-injection cell: opening a CSV holding this in
    // Excel runs a command. The `'` prefix is stripped on display and never
    // executed — the same neutralisation reports-export.ts applies outbound.
    const { rows } = parseCsv("title,body\nnote,=cmd|' /C calc'!A0\n", LIMITS);

    expect(rows).toEqual([['note', "'=cmd|' /C calc'!A0"]]);
  });

  it('neutralises every lead character in the class', () => {
    const leads = ['=SUM(A1)', '+1+1', '-2+3', '@SUM(A1)', '\tvalue', '\rvalue'];
    const { rows } = parseCsv(`title\n${leads.map((lead) => `"${lead}"`).join('\n')}\n`, LIMITS);

    expect(rows).toEqual(leads.map((lead) => [`'${lead}`]));
  });

  it('neutralises a payload hidden inside quotes, because the guard reads the decoded cell', () => {
    // Quoting is not an escape from the guard: the cell still *starts* with `=`
    // once the quotes come off, which is what the spreadsheet will see.
    const { rows } = parseCsv('title\n"=HYPERLINK(""http://evil"",""click"")"\n', LIMITS);

    expect(rows).toEqual([['\'=HYPERLINK("http://evil","click")']]);
  });

  it('neutralises header cells too, so no cell escapes by being "not stored"', () => {
    const { header } = parseCsv('=title,body\nx,y\n', LIMITS);

    expect(header).toEqual(["'=title", 'body']);
  });

  it('leaves an ordinary value alone, including one with = inside it', () => {
    // Over-guarding is a data-loss bug of its own: `a=b` would become `'a=b` in
    // the knowledge base and then in every answer quoting it.
    const { header, rows } = parseCsv('title,body\nq,a=b\nprice,3-4\n', LIMITS);

    expect(header).toEqual(['title', 'body']);
    expect(rows).toEqual([
      ['q', 'a=b'],
      ['price', '3-4'],
    ]);
  });
});

describe('parseCsv — linear time (NFR-S8)', () => {
  /**
   * A field built from doubled quotes and zero-width fillers: the shape that
   * makes a backtracking or re-scanning parser go quadratic, while staying a
   * perfectly valid CSV cell. Half the characters are quote pairs, so a parser
   * that rebuilds the field on every escape pays for it here.
   */
  function pathological(pairs: number): string {
    const filler = '\u200B\u200C'.repeat(pairs);
    return `title\n"${'""'.repeat(pairs)}${filler}",tail\n`;
  }

  function millis(run: () => unknown): number {
    const started = performance.now();
    run();
    return performance.now() - started;
  }

  it('parses a ~100k pathological cell without a super-linear blow-up', () => {
    const limits: CsvLimits = { ...LIMITS, maxCellChars: 200_000 };
    const small = pathological(6_250); // ~25k characters
    const large = pathological(25_000); // ~100k characters

    // Correctness first — a fast wrong answer is not the property under test.
    expect(parseCsv(large, limits).rows[0]?.[1]).toBe('tail');

    const smallMs = millis(() => parseCsv(small, limits));
    const largeMs = millis(() => parseCsv(large, limits));

    // Four times the input. Quadratic would be ~16x growth and, at this size,
    // seconds of blocked event loop; the linear form is a couple of ms. Both
    // bounds are deliberately loose — the 50 ms floor absorbs timer noise on a
    // measurement this small — so a busy machine cannot fail them for being
    // slow, only for being wrong about the growth rate.
    expect(largeMs).toBeLessThan(300);
    expect(largeMs).toBeLessThan(Math.max(smallMs * 10, 50));
  });

  it('stays linear when the pathological shape is unquoted instead', () => {
    // The other half of the walk: a long unquoted field scanned character by
    // character, ended only at the very last comma.
    const limits: CsvLimits = { ...LIMITS, maxCellChars: 200_000 };
    const field = 'a\u200B\u200C'.repeat(33_333);
    const started = performance.now();

    expect(parseCsv(`title\n${field},tail\n`, limits).rows[0]?.[1]).toBe('tail');
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('parseCsv — RFC 4180 documents', () => {
  it('parses a realistic file: BOM, CRLF, embedded comma, quote and line break', () => {
    const text =
      '\uFEFFtitle,body,url\r\n' +
      '"Refunds, returns","He said ""no"" twice",https://example.com/a\r\n' +
      '"Multi\r\nline","plain",\r\n';

    expect(parseCsv(text, LIMITS)).toEqual({
      header: ['title', 'body', 'url'],
      rows: [
        ['Refunds, returns', 'He said "no" twice', 'https://example.com/a'],
        ['Multi\r\nline', 'plain', ''],
      ],
    });
  });

  it('keeps rows aligned when CRLF, LF and a lone CR are mixed in one file', () => {
    // The classic corruption is a stray `\r` riding along on the last cell of a
    // CRLF row, or a CR-only file collapsing into one enormous row.
    const { header, rows } = parseCsv('a,b\r\n1,2\n3,4\r5,6\r\n', LIMITS);

    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('treats an empty file and a header-only file as zero rows, not as errors', () => {
    expect(parseCsv('', LIMITS)).toEqual({ header: [], rows: [] });
    expect(parseCsv('\r\n\n', LIMITS)).toEqual({ header: [], rows: [] });
    expect(parseCsv('title,body\n', LIMITS)).toEqual({ header: ['title', 'body'], rows: [] });
    expect(parseCsv('title,body', LIMITS)).toEqual({ header: ['title', 'body'], rows: [] });
  });

  it('tolerates blank lines, including the trailing newline editors add', () => {
    expect(parseCsv('a,b\n\n1,2\n\n\n', LIMITS).rows).toEqual([['1', '2']]);
  });

  it('keeps empty cells, and tells a blank line apart from a quoted empty value', () => {
    const { rows } = parseCsv('a,b,c\n,,\n1,,3\n""\n', LIMITS);

    expect(rows).toEqual([
      ['', '', ''], // three empty cells is data, not a blank line
      ['1', '', '3'],
      [''], // `""` is a row with one empty value
    ]);
  });

  it('reads a trailing comma as an empty last field', () => {
    expect(parseCsv('a,b\n1,', LIMITS).rows).toEqual([['1', '']]);
  });

  it('keeps a bare quote inside an unquoted field as data', () => {
    // Not valid RFC 4180, but unambiguous: nothing is quoted, so nothing is
    // being escaped and the character is part of the value.
    expect(parseCsv('a\n5" pipe\n', LIMITS).rows).toEqual([['5" pipe']]);
  });

  it('returns a row whose width differs from the header untouched', () => {
    // Row shape belongs to the row validator (06.3.2-bulk-b); padding or
    // trimming here would hide the problem from the per-row import report.
    const { rows } = parseCsv('a,b,c\n1,2\n1,2,3,4\n', LIMITS);

    expect(rows).toEqual([
      ['1', '2'],
      ['1', '2', '3', '4'],
    ]);
  });
});
