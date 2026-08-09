/**
 * RFC 4180 CSV reader for bulk knowledge-base import (FR-MOD-06.3.2 · NFR-S9 ·
 * NFR-S8).
 *
 * This is the inbound counterpart of `routes/reports-export.ts`, which writes
 * CSV. Nothing in the repo *read* CSV before this module, so the state machine
 * below is written from the grammar rather than adapted from a caller.
 *
 * Three properties are load-bearing, and each is pinned by a test:
 *
 * 1. **No silent corruption.** A quoted field may hold commas, doubled quotes
 *    and line breaks; a file may mix CRLF and LF and open with a BOM. Getting
 *    any of that wrong shifts values into the wrong columns, and a wrong column
 *    here becomes a wrong answer from the AI later. Anything the grammar cannot
 *    explain — a quote that never closes, text after a closing quote — is a
 *    typed error naming the line and column, never a best guess.
 *
 * 2. **Formula injection is neutralised on the way in.** A cell that opens with
 *    `=` `+` `-` `@` TAB or CR is executed when a spreadsheet opens the file;
 *    that is the same class `reports-export.ts` guards on the way out, and the
 *    round trip is real — text imported here can leave again through the 07.7
 *    export. So the guard is applied to the *decoded* cell (a payload hidden
 *    inside quotes is caught too) and to every cell including the header, so no
 *    cell escapes it by being classified "not stored".
 *
 * 3. **Linear time.** Parsing is a single left-to-right walk over the input
 *    using index arithmetic and `indexOf`; there is no backtracking regex
 *    anywhere on the path. This repo has already been bitten once by an
 *    O(n²) scanner reachable from user text (`services/security/spam-filter.ts`
 *    normaliseToken), and here the attacker supplies a whole file, so the
 *    linearity is a regression test, not a comment.
 *
 * Deliberately NOT here (06.3.2-bulk-b owns it): mapping columns to fields and
 * validating a row. This module has no opinion on what the columns mean, and a
 * row whose width differs from the header is returned as-is rather than padded,
 * truncated or rejected — row shape is a validation verdict, and inventing one
 * here would hide it from the per-row report the import result table shows.
 */

/** A cell's first character, when it makes a spreadsheet evaluate the cell. */
const FORMULA_LEAD_CODES = new Set([
  0x3d, // =
  0x2b, // +
  0x2d, // -
  0x40, // @
  0x09, // TAB
  0x0d, // CR
]);

/** The prefix spreadsheets strip on display and never execute. */
const FORMULA_GUARD = "'";

const CHAR_QUOTE = 0x22; // "
const CHAR_COMMA = 0x2c; // ,
const CHAR_LF = 0x0a;
const CHAR_CR = 0x0d;

/** Byte-order mark some editors write at the head of a UTF-8 file. */
const BOM = '\uFEFF';

/** Why a document was refused. Each maps to a distinct message for the user. */
export type CsvParseErrorCode =
  /** The whole payload is over `maxBytes` — refused before any parsing. */
  | 'file_too_large'
  /** More data rows than `maxRows`; the file is not truncated to fit. */
  | 'too_many_rows'
  /** One cell is over `maxCellChars`. */
  | 'cell_too_long'
  /** A field opens with `"` and the file ends before the closing `"`. */
  | 'unclosed_quote'
  /** `"ab"cd` — a quoted field followed by characters instead of a separator. */
  | 'text_after_closing_quote';

/**
 * A refusal to parse, positioned so the caller can point the user at the place
 * in their file. `line` and `column` are 1-based and count the text *after* a
 * BOM is removed, so they address the first character the user can actually see.
 */
export class CsvParseError extends Error {
  readonly code: CsvParseErrorCode;
  readonly line: number;
  readonly column: number;

  constructor(code: CsvParseErrorCode, detail: string, line: number, column: number) {
    super(`Line ${line}, column ${column}: ${detail}`);
    this.name = 'CsvParseError';
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

/** True when `error` came from `parseCsv` — narrows for a caller's `catch`. */
export function isCsvParseError(error: unknown): error is CsvParseError {
  return error instanceof CsvParseError;
}

/**
 * The DoS budget (NFR-S8). Every field is required: a caller that forgets one
 * would otherwise parse an unbounded upload, so there is no default to inherit
 * by accident. Exceeding any of them is a typed error — this module never
 * truncates to fit, because a silently shortened import looks like a successful
 * one.
 */
export interface CsvLimits {
  /** Maximum data rows, header excluded. */
  maxRows: number;
  /** Maximum characters in one cell, measured before the formula guard. */
  maxCellChars: number;
  /** Maximum UTF-8 size of the whole document. */
  maxBytes: number;
}

/** A parsed document: the first non-blank line, then the data rows under it. */
export interface CsvDocument {
  header: string[];
  rows: string[][];
}

/**
 * Parse `text` as RFC 4180 CSV, or throw {@link CsvParseError}.
 *
 * An empty document — no text, or only blank lines — is `{ header: [], rows: [] }`
 * rather than an error; so is a file holding nothing but a header. Blank lines
 * are skipped wherever they appear (the trailing newline every editor writes is
 * the common case) while a line holding `""` is a real row with one empty cell.
 *
 * Because a quoted cell may contain line breaks, a row's index is its index
 * among data rows — not a physical line number in the file.
 */
export function parseCsv(text: string, limits: CsvLimits): CsvDocument {
  assertUsableLimits(limits);

  // Cheapest rejection first: the byte cap bounds everything measured below it.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > limits.maxBytes) {
    throw new CsvParseError(
      'file_too_large',
      `the file is ${bytes} bytes, over the ${limits.maxBytes}-byte limit.`,
      1,
      1,
    );
  }

  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const length = body.length;

  let header: string[] = [];
  let headerTaken = false;
  const rows: string[][] = [];

  let record: string[] = [];
  let recordQuoted = false;
  let recordStart = 0;

  /**
   * Close the record built so far. A blank physical line is one empty unquoted
   * field and carries no data, so it is dropped rather than handed on as a row
   * that every downstream validator would reject for being empty.
   */
  const endRecord = (): void => {
    const blankLine = record.length === 1 && record[0] === '' && !recordQuoted;
    if (!blankLine) {
      if (!headerTaken) {
        header = record;
        headerTaken = true;
      } else {
        if (rows.length >= limits.maxRows) {
          const at = positionOf(body, recordStart);
          throw new CsvParseError(
            'too_many_rows',
            `the file holds more than ${limits.maxRows} rows.`,
            at.line,
            at.column,
          );
        }
        rows.push(record);
      }
    }
    record = [];
    recordQuoted = false;
  };

  let i = 0;
  while (i < length) {
    if (record.length === 0) recordStart = i;

    // --- one field ------------------------------------------------------
    let value = '';
    if (body.charCodeAt(i) === CHAR_QUOTE) {
      recordQuoted = true;
      const openedAt = i;
      i += 1;

      let start = i;
      let parts: string[] | null = null;
      let taken = 0;
      for (;;) {
        // Each search resumes where the last one stopped, so the scans over the
        // whole field sum to one pass across it.
        const quote = body.indexOf('"', i);
        if (quote === -1) {
          const at = positionOf(body, openedAt);
          throw new CsvParseError(
            'unclosed_quote',
            'a quoted value opens here but never closes.',
            at.line,
            at.column,
          );
        }

        if (body.charCodeAt(quote + 1) === CHAR_QUOTE) {
          // `""` inside a quoted field is one literal quote: keep the first of
          // the pair by slicing through it, then resume after the second.
          taken += quote + 1 - start;
          assertCellFits(taken, limits, body, openedAt);
          (parts ??= []).push(body.slice(start, quote + 1));
          i = quote + 2;
          start = i;
          continue;
        }

        taken += quote - start;
        assertCellFits(taken, limits, body, openedAt);
        const tail = body.slice(start, quote);
        value = parts === null ? tail : parts.join('') + tail;
        i = quote + 1;
        break;
      }
    } else {
      const start = i;
      while (i < length) {
        const code = body.charCodeAt(i);
        if (code === CHAR_COMMA || code === CHAR_LF || code === CHAR_CR) break;
        i += 1;
      }
      assertCellFits(i - start, limits, body, start);
      value = body.slice(start, i);
    }

    record.push(neutraliseFormula(value));

    // --- what follows the field ------------------------------------------
    if (i >= length) {
      endRecord();
      break;
    }

    const code = body.charCodeAt(i);
    if (code === CHAR_COMMA) {
      i += 1;
      // A comma is the last character of the file: `a,` is two fields, the
      // second empty. Nothing follows to open the next field, so close here.
      if (i >= length) {
        record.push('');
        endRecord();
      }
      continue;
    }

    if (code === CHAR_LF || code === CHAR_CR) {
      // CRLF, LF and a lone CR all end a record. Treating a lone CR as data
      // would collapse a CR-only file into a single enormous row; inside quotes
      // it stays data, which is where an embedded line break belongs.
      i += code === CHAR_CR && body.charCodeAt(i + 1) === CHAR_LF ? 2 : 1;
      endRecord();
      continue;
    }

    // The unquoted scan above stops only at a separator or EOF, so anything
    // else can only sit after a closing quote: `"ab"cd`. RFC 4180 has no
    // reading for that, and guessing one is how a value silently changes.
    const at = positionOf(body, i);
    throw new CsvParseError(
      'text_after_closing_quote',
      'a quoted value ends here but the field continues; quote the whole value or double the inner quotes.',
      at.line,
      at.column,
    );
  }

  return { header, rows };
}

/**
 * Prefix a cell that a spreadsheet would evaluate. The character class mirrors
 * `FORMULA_LEAD` in `routes/reports-export.ts` — the same threat, the other
 * direction — but is tested by character code rather than by a regex so the
 * check is a single comparison with nothing to backtrack over.
 *
 * Exported because not every value that lands in a knowledge source arrives
 * through `parseCsv`: a `website` row's text is fetched from a page
 * (`services/ai/knowledge-bulk-crawl.ts`), and it reaches the same store, the
 * same export and therefore the same spreadsheet. One rule, one implementation.
 */
export function neutraliseFormula(cell: string): string {
  // charCodeAt on an empty string is NaN, which no code in the set matches.
  return FORMULA_LEAD_CODES.has(cell.charCodeAt(0)) ? FORMULA_GUARD + cell : cell;
}

/** Refuse a cell over budget, positioned at the character the cell starts on. */
function assertCellFits(taken: number, limits: CsvLimits, body: string, start: number): void {
  if (taken <= limits.maxCellChars) return;
  const at = positionOf(body, start);
  throw new CsvParseError(
    'cell_too_long',
    `this value is longer than the ${limits.maxCellChars}-character limit.`,
    at.line,
    at.column,
  );
}

/**
 * Line and column of `index`, 1-based. Only the error path pays for this, so
 * the parse loop carries no line bookkeeping: one pass, once, when a document
 * is already being refused.
 */
function positionOf(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    const code = text.charCodeAt(i);
    if (code === CHAR_LF) {
      line += 1;
      lineStart = i + 1;
    } else if (code === CHAR_CR) {
      line += 1;
      if (text.charCodeAt(i + 1) === CHAR_LF) i += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

/**
 * A limit that is NaN or zero would disable the guard it names without saying
 * so — comparisons against NaN are always false. That is a caller bug, not a
 * bad file, so it fails as one.
 */
function assertUsableLimits(limits: CsvLimits): void {
  for (const key of ['maxRows', 'maxCellChars', 'maxBytes'] as const) {
    const value = limits[key];
    if (!Number.isFinite(value) || value < 1) {
      throw new RangeError(`csv limits.${key} must be a positive number, got ${String(value)}.`);
    }
  }
}
