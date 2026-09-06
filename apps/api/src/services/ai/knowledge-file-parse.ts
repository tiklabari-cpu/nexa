/**
 * Turning an uploaded file into indexable text (FR-MOD-06.3.2, "File").
 *
 * This is the `file` counterpart of `web-crawler.ts`: the same seam, one step
 * earlier. A website source is *fetched* then parsed; a file source arrives
 * already fetched — the admin's browser did it — and only needs the parse. So
 * the shape is deliberately the same as `htmlToText`: a pure function, no I/O,
 * no subprocess, no dependency, the same bytes always yielding the same text.
 * That is what lets an integration test assert "the upload produced chunks"
 * without a fixture file on disk, and it is also the security argument — the
 * only code an admin-supplied byte string reaches here is a handful of string
 * transformations.
 *
 * Four rules carry the module, and each is a refusal:
 *
 * 1. **The declared type chooses the parser; the filename never does.** A
 *    filename is attacker-controlled text with path semantics. It is used for
 *    the source's title and for nothing else — never joined to a path, never
 *    written to disk (nothing here touches a filesystem), never consulted to
 *    decide what the bytes are. `content_type` must be one of
 *    {@link KNOWLEDGE_FILE_MIME_TYPES}; everything else is a 400.
 *
 * 2. **A claim about the bytes is not evidence about the bytes.** A PDF renamed
 *    `.txt` and declared `text/plain` passes the type gate, so the gate is not
 *    where binary is stopped: the bytes must decode as strict UTF-8 and must
 *    hold no control characters outside tab/newline/carriage-return. That is
 *    what actually separates "a text file" from "a file someone said was text",
 *    and it runs on every type.
 *
 * 3. **Budgets before work.** Bytes are checked before decoding and characters
 *    before chunking, because an upload is user-chosen size and everything
 *    downstream of it (decode, parse, chunk, embed, one row per chunk) is
 *    proportional to that size. `knowledge-bulk-row.ts` bounds a CSV import for
 *    the same reason; the ceilings live in `@nexa/types` so the form and the
 *    route cannot drift apart on what they are.
 *
 * 4. **Nothing is truncated to fit.** Over a limit is a typed error naming the
 *    limit, never a silently shortened source — a knowledge base that quietly
 *    indexed the first half of a policy would answer confidently from the part
 *    it kept.
 *
 * Deliberately NOT here: PDF, DOCX or anything else needing a real document
 * parser. Every one of those is a CVE history reachable from an admin-supplied
 * byte string, and none can be done as a pure function. The list is short on
 * purpose and the refusal is explicit, which is exactly the acceptance
 * criterion's "invalid type rejection".
 */
import {
  KNOWLEDGE_FILE_MAX_BYTES,
  KNOWLEDGE_FILE_MAX_CHARS,
  KNOWLEDGE_FILE_MIME_TYPES,
  normalizeKnowledgeFileMime,
  type KnowledgeFileMimeType,
} from '@nexa/types';
import { isCsvParseError, parseCsv, type CsvLimits } from '../../lib/csv-import.js';

export type KnowledgeFileParseErrorCode =
  'unsupported_type' | 'file_too_large' | 'not_text' | 'text_too_long' | 'empty';

/** A refusal with a reason the route can turn into a 400 that names what was wrong. */
export class KnowledgeFileParseError extends Error {
  readonly code: KnowledgeFileParseErrorCode;

  constructor(code: KnowledgeFileParseErrorCode, message: string) {
    super(message);
    this.name = 'KnowledgeFileParseError';
    this.code = code;
  }
}

/** True when `error` came from {@link parseKnowledgeFile} — narrows for a caller's `catch`. */
export function isKnowledgeFileParseError(error: unknown): error is KnowledgeFileParseError {
  return error instanceof KnowledgeFileParseError;
}

export interface KnowledgeFileLimits {
  /** Maximum size of the decoded upload, in bytes. */
  maxBytes: number;
  /** Maximum length of the parsed text, in characters. */
  maxChars: number;
}

/** The shipped budget. Passed explicitly everywhere so a test can shrink it without shrinking the product's. */
export const KNOWLEDGE_FILE_LIMITS: KnowledgeFileLimits = {
  maxBytes: KNOWLEDGE_FILE_MAX_BYTES,
  maxChars: KNOWLEDGE_FILE_MAX_CHARS,
};

export interface KnowledgeFileInput {
  /** The media type the caller declared. The only thing that selects a parser. */
  contentType: string;
  /** The file's bytes, already base64-decoded by the route. */
  bytes: Buffer;
}

export interface ParsedKnowledgeFile {
  /** The type the bytes were parsed as — the normalised form of what was declared. */
  mimeType: KnowledgeFileMimeType;
  /** Text ready for `KnowledgeService.index`. */
  text: string;
}

/** Byte-order mark some editors write at the head of a UTF-8 file. */
const BOM = '\uFEFF';

/**
 * The CSV budget for a file *source*.
 *
 * Not the same numbers as `BULK_CSV_LIMITS` in `routes/playbook.ts`, because
 * the two are not the same thing: there, one row becomes one source and 200 is
 * a spreadsheet an admin assembled by hand; here the whole file becomes one
 * source, so the rows are records inside a document — a price list or a
 * glossary — and the byte ceiling is what actually bounds them. The row cap
 * stays as a guard against a pathological file rather than as a product limit.
 */
const CSV_LIMITS: CsvLimits = {
  maxRows: 5_000,
  maxCellChars: KNOWLEDGE_FILE_MAX_CHARS,
  maxBytes: KNOWLEDGE_FILE_MAX_BYTES,
};

/**
 * Parse an uploaded file into text, or throw {@link KnowledgeFileParseError}.
 *
 * Never throws anything else for input reasons: every refusal a caller can
 * provoke is typed, so the route has one `catch` and one 400 shape.
 */
export function parseKnowledgeFile(
  input: KnowledgeFileInput,
  limits: KnowledgeFileLimits = KNOWLEDGE_FILE_LIMITS,
): ParsedKnowledgeFile {
  const mimeType = normalizeKnowledgeFileMime(input.contentType);
  if (!mimeType) {
    throw new KnowledgeFileParseError(
      'unsupported_type',
      `files of type ${describeType(input.contentType)} are not supported; upload one of ${KNOWLEDGE_FILE_MIME_TYPES.join(', ')}.`,
    );
  }

  // Cheapest rejection first, and the one that bounds every step below it.
  if (input.bytes.byteLength > limits.maxBytes) {
    throw new KnowledgeFileParseError(
      'file_too_large',
      `the file is ${input.bytes.byteLength} bytes, over the ${limits.maxBytes}-byte limit.`,
    );
  }

  const decoded = decodeUtf8(input.bytes);
  const body = decoded.startsWith(BOM) ? decoded.slice(BOM.length) : decoded;
  assertNoControlCharacters(body);

  const text = renderText(mimeType, body);

  // Measured on the parsed result rather than on the raw file: this is the
  // string that becomes the source's `content`, and it is the one that has to
  // obey the same ceiling pasted content obeys. The byte cap above already
  // bounded the work it took to get here.
  if (text.length > limits.maxChars) {
    throw new KnowledgeFileParseError(
      'text_too_long',
      `the file holds ${text.length} characters of text, over the ${limits.maxChars}-character limit.`,
    );
  }

  if (text.length === 0) {
    throw new KnowledgeFileParseError('empty', 'the file holds no text to index.');
  }

  return { mimeType, text };
}

function describeType(value: string): string {
  const trimmed = value.trim();
  return trimmed === '' ? '(none)' : trimmed;
}

/**
 * Decode as UTF-8 and refuse anything that is not.
 *
 * `fatal: true` is the whole point: `Buffer.toString('utf8')` replaces an
 * invalid sequence with U+FFFD, which turns a PNG into "text" made of
 * replacement characters and indexes it happily. A file that is not valid UTF-8
 * is not a text file, and saying so is cheaper than discovering it later as
 * gibberish in an answer.
 */
function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new KnowledgeFileParseError(
      'not_text',
      'the file is not valid UTF-8 text; only text files can be indexed.',
    );
  }
}

/**
 * Refuse control characters.
 *
 * Plenty of binary formats — UTF-16 text, a ZIP, a PDF's object streams — carry
 * byte runs that happen to be valid UTF-8, so the decoder alone lets some
 * through. What none of them survive is this: real text holds no NUL, no bell,
 * no escape. Tab, newline and carriage return are the exceptions because they
 * are text.
 */
function assertNoControlCharacters(text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const allowed = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!allowed && (code < 0x20 || code === 0x7f)) {
      throw new KnowledgeFileParseError(
        'not_text',
        'the file holds binary data; only text files can be indexed.',
      );
    }
  }
}

function renderText(mimeType: KnowledgeFileMimeType, body: string): string {
  switch (mimeType) {
    case 'text/markdown':
      return markdownToText(body);
    case 'text/csv':
      return csvToText(body);
    case 'text/plain':
      return normalizeText(body);
  }
}

/**
 * Line endings to `\n`, trailing spaces off each line, runs of blank lines down
 * to one, and the whole thing trimmed.
 *
 * Whitespace is *normalised*, not collapsed — unlike `htmlToText`, which flattens
 * everything to single spaces because HTML's own whitespace carries no meaning.
 * A text file's line breaks do carry meaning: they are the paragraph boundaries
 * the chunker splits on, and flattening them would hand the embedder one
 * undifferentiated blob.
 */
function normalizeText(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A fence line: ``` or ~~~, optionally indented, optionally with an info string. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
/** A setext underline or a horizontal rule — decoration, never content. */
const RULE = /^ {0,3}(?:=+|-{3,}|_{3,}|\*{3,})[ \t]*$/;
/** A markdown table's separator row: `| --- | :-: |`. */
const TABLE_RULE = /^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/;

/**
 * Strip Markdown syntax down to the prose underneath.
 *
 * Two decisions are worth naming. **Fenced code is kept, its fences dropped** —
 * a support manual's code sample is an answer, and deleting it would make the
 * knowledge base quietly worse at exactly the questions it was uploaded for.
 * **Link text survives, link targets do not** — `[returns policy](/r/12)` is
 * read by a customer as "returns policy", and indexing the URL would put
 * `/r/12` into the embedding as if it were a word.
 *
 * Every expression below is anchored or uses a negated character class, so the
 * pass is linear in the input. The repo has been bitten once by a quadratic
 * scanner reachable from user text (`spam-filter.ts`), and here the user
 * supplies a whole file.
 */
function markdownToText(body: string): string {
  const lines = normalizeText(body).split('\n');
  const out: string[] = [];

  for (const line of lines) {
    if (FENCE.test(line)) continue;
    if (RULE.test(line)) continue;
    if (TABLE_RULE.test(line)) continue;

    let text = line
      // Headings, blockquote markers and list bullets are structure, not words.
      // `$` as an alternative to the space: `#` on its own is an empty ATX
      // heading, which is decoration, not a word called "#".
      .replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '')
      .replace(/^ {0,3}(?:>[ \t]?)+/, '')
      .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/, '');

    // A table row becomes its cells, separated by spaces.
    if (/^[ \t]*\|/.test(text)) {
      text = text
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .join(' ');
    }

    text = inlineMarkdownToText(text);
    out.push(text.replace(/[ \t]+$/, ''));
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inlineMarkdownToText(line: string): string {
  return (
    line
      // Images first: `![alt](src)` keeps the alt text, which is the only part
      // of an image a text index can answer from.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Reference-style links and the bare autolink form.
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/<((?:https?|mailto):[^>]*)>/g, '$1')
      // Any remaining inline HTML is markup, like `htmlToText` treats it.
      .replace(/<[^>]*>/g, '')
      // Emphasis and code spans: the delimiters go, the words stay.
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
  );
}

/**
 * Render a CSV as one document: `column: value` pairs, one line per row.
 *
 * The rows are labelled rather than joined bare because retrieval here is over
 * text — a bare `48,62,steel` tells an embedder nothing, while `size: 48 · frame:
 * steel` says what the numbers are. Blank cells are dropped rather than
 * rendered as `column:`, which would put the column name into the index once
 * per empty row.
 *
 * `parseCsv` is reused rather than reimplemented, and not only for the RFC 4180
 * grammar: it neutralises formula injection on every cell on the way in, which
 * matters precisely because this text can leave again through the 07.7 CSV
 * export and land in a spreadsheet. One rule, one implementation.
 *
 * A CSV uploaded *here* becomes one source. A CSV posted to
 * `/knowledge-sources/bulk` becomes one source per row. Same file format, two
 * intents, and the endpoint is how the admin says which one they meant.
 */
function csvToText(body: string): string {
  let document;
  try {
    document = parseCsv(body, CSV_LIMITS);
  } catch (error) {
    // Every refusal this module can produce is a `KnowledgeFileParseError`, so
    // the route has one `catch` and one 400 shape. `parseCsv`'s own message
    // already names the line and column, or the limit it hit.
    if (isCsvParseError(error))
      throw new KnowledgeFileParseError(
        error.code === 'file_too_large' ||
          error.code === 'too_many_rows' ||
          error.code === 'cell_too_long'
          ? 'file_too_large'
          : 'not_text',
        `csv: ${error.message}`,
      );
    throw error;
  }
  if (document.header.length === 0) return '';

  const header = document.header.map((cell) => cell.trim());
  if (document.rows.length === 0) return header.filter((cell) => cell !== '').join(' · ');

  const lines = document.rows.map((row) =>
    row
      .map((cell, index) => {
        const value = cell.trim();
        if (value === '') return '';
        const label = header[index]?.trim();
        return label ? `${label}: ${value}` : value;
      })
      .filter((cell) => cell !== '')
      .join(' · '),
  );

  return lines
    .filter((line) => line !== '')
    .join('\n')
    .trim();
}

/**
 * The title an upload gets when the admin does not type one: the file's own
 * name, with everything that makes a name dangerous taken out of it.
 *
 * Three removals, and the first is the one that matters. **Directory
 * separators go**, so a `filename` of `../../etc/passwd.txt` becomes
 * `passwd.txt` — not because the title is ever used as a path (nothing in this
 * feature touches a filesystem) but because a title that *renders* as a path
 * is the first half of a bug someone adds later. **Control characters go**,
 * since a name carrying a newline lands in logs and in the audit trail.
 * **Length is capped**, because a title is a label: shortening it loses
 * nothing the index reads, unlike shortening content.
 */
export function titleFromFilename(filename: string, maxLength = 200): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, maxLength).trim();
}
