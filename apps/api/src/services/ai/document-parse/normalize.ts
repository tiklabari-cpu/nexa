/**
 * The rules both readers share (tm 313.2 · AI-18): what a block's text looks
 * like, how a table row is written, which repeated lines are page furniture,
 * and the ceilings a finished document must sit under.
 *
 * Over a ceiling is a refusal naming it — never a document cut down to fit
 * (`knowledge-file-parse.ts` rule 4: a knowledge base that quietly indexed
 * the first half of a policy would answer confidently from the half it kept).
 */
import type { KnowledgeDocumentMimeType } from '@siyahtus/types';
import {
  DocumentParseError,
  type DocumentBlock,
  type DocumentParseLimits,
  type ParsedDocument,
} from './types.js';

const LIGATURES: Readonly<Record<string, string>> = {
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'st',
  '\ufb06': 'st',
};

/**
 * One line of readable text: composed (NFC), typographic ligatures spelled
 * out (a PDF's "ﬁ" would otherwise never match a search for "fi"), soft
 * hyphens and zero-width characters dropped, control characters and every
 * kind of space folded into single spaces, trimmed.
 */
export function normalizeInline(text: string): string {
  return (
    text
      .normalize('NFC')
      .replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c)
      .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
      // eslint-disable-next-line no-control-regex -- folding control characters is the point.
      .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .trim()
  );
}

/** A table row as AI-18 writes it, `| a | b |` — a `|` inside a cell escaped so the row still splits. */
export function tableRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => normalizeInline(cell).replace(/\|/g, '\\|')).join(' | ')} |`;
}

/** Lines from the top and from the bottom of a page that may be a running header or footer. */
export const MARGIN_LINES = 2;
/** A margin line repeated on at least this share of pages is furniture (AI-18: "%60+"). */
export const MARGIN_REPEAT_SHARE = 0.6;
/** Fewer pages than this and repetition proves nothing: two pages sharing a first line is a coincidence. */
export const MARGIN_MIN_PAGES = 3;
/** Margin lines that would take more than this share of the text are not furniture — nothing is stripped. */
export const MARGIN_MAX_SHARE_OF_TEXT = 0.5;

/** What two margin lines are compared by: case and whitespace folded, every digit run one `#` ("Page 3 of 9" ≡ "Page 4 of 9"). */
export function marginKey(text: string): string {
  return normalizeInline(text).toLowerCase().replace(/\d+/g, '#');
}

/**
 * `pages` with their running headers and footers taken out: a line among a
 * page's first or last {@link MARGIN_LINES} whose {@link marginKey} appears in
 * that zone on at least {@link MARGIN_REPEAT_SHARE} of the pages. Only the
 * zones are touched — the same words in a page's body stay.
 *
 * `keep` exempts lines from the zones. The PDF reader keeps heading-sized
 * lines: with digits folded, "Article 2" atop page 2 and "Article 3" atop
 * page 3 look like "Page 2" and "Page 3", and a policy that starts each
 * article on a new page would lose every heading. Running heads are set at
 * or below the body size; headings are not.
 */
export function stripRepeatedMargins<T>(
  pages: readonly T[][],
  textOf: (line: T) => string,
  keep: (line: T) => boolean = () => false,
): T[][] {
  if (pages.length < MARGIN_MIN_PAGES) return pages.map((lines) => [...lines]);

  const zoneOf = (lines: readonly T[]): number[] => {
    const indexes = new Set<number>();
    for (let i = 0; i < Math.min(MARGIN_LINES, lines.length); i += 1) {
      indexes.add(i);
      indexes.add(lines.length - 1 - i);
    }
    return [...indexes].filter((i) => !keep(lines[i]!));
  };

  const pagesWith = new Map<string, number>();
  for (const lines of pages) {
    const keys = new Set(zoneOf(lines).map((i) => marginKey(textOf(lines[i]!))));
    for (const key of keys) {
      if (key !== '') pagesWith.set(key, (pagesWith.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length * MARGIN_REPEAT_SHARE);
  const repeated = new Set([...pagesWith].filter(([, n]) => n >= threshold).map(([key]) => key));
  if (repeated.size === 0) return pages.map((lines) => [...lines]);

  let total = 0;
  let removed = 0;
  const stripped = pages.map((lines) => {
    const zone = new Set(zoneOf(lines));
    return lines.filter((line, i) => {
      const length = textOf(line).length;
      total += length;
      const furniture = zone.has(i) && repeated.has(marginKey(textOf(line)));
      if (furniture) removed += length;
      return !furniture;
    });
  });
  // Furniture is a small share of a document. When "repeated margin lines"
  // are most of it, they are its content (a page per entry, one line each):
  // keep everything rather than index nothing.
  return removed > total * MARGIN_MAX_SHARE_OF_TEXT ? pages.map((lines) => [...lines]) : stripped;
}

/** AI-18: a PDF averaging fewer readable characters per page than this has no text layer — most likely a scan. */
export const MIN_AVERAGE_CHARS_PER_PAGE = 50;

/** Whether `nonSpaceChars` over `pageCount` pages is a text layer, or a scan with a page number on it. */
export function hasTextLayer(nonSpaceChars: number, pageCount: number): boolean {
  return pageCount > 0 && nonSpaceChars / pageCount >= MIN_AVERAGE_CHARS_PER_PAGE;
}

/** The count of non-whitespace characters in `text`. */
export function nonSpaceLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x20 && code !== 0xa0) count += 1;
  }
  return count;
}

/**
 * A running count that refuses as soon as it passes `max` — so a reader stops
 * at the character past the ceiling instead of holding a document many times
 * over it before counting.
 */
export class CharacterBudget {
  #used = 0;
  constructor(readonly max: number) {}

  take(count: number): void {
    this.#used += count;
    if (this.#used > this.max) throw new DocumentParseError('too_many_characters', 'over_limit');
  }
}

/**
 * The finished document: blocks with no text dropped, the character ceiling
 * checked on what is left, and a document with nothing left refused as
 * `no_text_layer` — there is nothing in it to answer from.
 */
export function finishDocument(
  mime: KnowledgeDocumentMimeType,
  pageCount: number,
  drafts: readonly DocumentBlock[],
  limits: DocumentParseLimits,
): ParsedDocument {
  if (pageCount > limits.maxPages) throw new DocumentParseError('too_many_pages', 'over_limit');
  const blocks = drafts.filter((block) => block.text !== '');
  let characterCount = 0;
  for (const block of blocks) characterCount += block.text.length;
  if (characterCount > limits.maxChars) {
    throw new DocumentParseError('too_many_characters', 'over_limit');
  }
  if (blocks.length === 0) throw new DocumentParseError('no_text_layer', 'no_text');
  return { mime, pageCount, characterCount, blocks };
}
