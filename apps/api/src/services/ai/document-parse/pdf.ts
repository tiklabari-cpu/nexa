/**
 * A PDF read into blocks (tm 313.2 · SiyahTuş analysis AI-18) — in the worker
 * process, never the API's.
 *
 * **The reader** is Mozilla's pdf.js (`pdfjs-dist`, Apache-2.0), the parser
 * Firefox ships to every user and the one with the most hostile-input
 * exposure behind it. Its one code-execution advisory (CVE-2024-4367, a font
 * matrix reaching `new Function`) was fixed in 4.2.67, and 6.x has no eval
 * path left at all. It is configured to touch nothing outside the bytes it is
 * given: no system fonts, no font loading, no fetching (CMaps and the
 * standard fonts' metrics are read from the package's own directories — the
 * names a PDF can ask for are a fixed list pdf.js checks), no XFA forms, no
 * WebAssembly or image decoders (text extraction decodes no image). A PDF's
 * JavaScript is never run: pdf.js only executes it through a scripting
 * sandbox a viewer has to install, and this reads text and nothing else.
 *
 * **Refusals:** a password-protected PDF is `encrypted` (one whose user
 * password is empty — "restrictions only" — opens and is read, as every
 * viewer does); past 300 pages `too_many_pages`, checked before a page is
 * read; under 50 readable characters a page on average `no_text_layer` (a
 * scan: there is no OCR); damaged beyond reading `parse_failed`.
 *
 * **Layout** is rebuilt from positions, page by page (nothing crosses a page,
 * so a block's page is exact):
 *
 * - text items on one baseline make a line; a gap wider than 1.5× the font
 *   size between them is a column break, and a line with one is a table row,
 *   `| a | b |`;
 * - running headers and footers (a margin line on 60%+ of the pages, set
 *   no larger than the body) go;
 * - a line set at least 1.2× the body size (the size most characters are set
 *   in) is a heading, the largest size level 1;
 * - a line starting with a bullet or `1.` / `a)` starts a list item;
 * - other lines join the paragraph above when they are the same size and
 *   close under it, a word hyphenated across the break joined back.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { KNOWLEDGE_DOCUMENT_PDF } from '@siyahtus/types';
import {
  CharacterBudget,
  finishDocument,
  hasTextLayer,
  nonSpaceLength,
  normalizeInline,
  stripRepeatedMargins,
  tableRow,
} from './normalize.js';
import {
  DocumentParseError,
  MAX_HEADING_LEVEL,
  type DocumentBlock,
  type DocumentParseLimits,
  type ParsedDocument,
} from './types.js';

/** The part of pdf.js' `TextItem` a line is built from. */
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

/** A gap wider than this many font sizes between two items on a line separates columns. */
const COLUMN_GAP = 1.5;
/** Items whose baselines differ by less than this share of the font size are one line (a superscript stays on it). */
const SAME_LINE = 0.5;
/** A line set at least this many times the body size is a heading. */
const HEADING_SCALE = 1.2;
/** A heading is a line, not a paragraph set large. */
const HEADING_MAX_LENGTH = 150;
/** Lines this close (in font sizes, baseline to baseline) belong to one paragraph. */
const PARAGRAPH_LEADING = 1.8;

const BULLET = /^[•◦▪▫‣∙·●○■□–—-]\s+/u;
const NUMBERED = /^(\d{1,3}|[a-z])[.)]\s/iu;

interface PdfLine {
  /** One string per column; a single column is ordinary text. */
  cells: string[];
  size: number;
  y: number;
}

/** The directory of the pdf.js package, for its CMaps and standard font metrics. */
function packageDirectory(): string {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
}

/** pdf.js wants a directory "URL" with a trailing slash; on Node it reads it with `fs`. */
function directoryUrl(...parts: string[]): string {
  return `${join(...parts)}/`;
}

export async function parsePdf(
  bytes: Buffer,
  limits: DocumentParseLimits,
): Promise<ParsedDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = packageDirectory();
  const task = pdfjs.getDocument({
    // A copy: pdf.js transfers the buffer it is given.
    data: new Uint8Array(bytes),
    cMapUrl: directoryUrl(root, 'cmaps'),
    cMapPacked: true,
    standardFontDataUrl: directoryUrl(root, 'standard_fonts'),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });

  try {
    let document: Awaited<typeof task.promise>;
    try {
      document = await task.promise;
    } catch (error) {
      if (error instanceof pdfjs.PasswordException) {
        throw new DocumentParseError('encrypted', 'password_required');
      }
      throw new DocumentParseError('parse_failed', 'pdf_unreadable');
    }

    const pageCount = document.numPages;
    if (pageCount > limits.maxPages) throw new DocumentParseError('too_many_pages', 'over_limit');
    if (pageCount === 0) throw new DocumentParseError('parse_failed', 'pdf_no_pages');

    // Raw text may run past the ceiling by what the margins and spacing will
    // shed; twice it is past any document that would fit.
    const budget = new CharacterBudget(limits.maxChars * 2);
    const pages: PdfLine[][] = [];
    let readable = 0;
    for (let number = 1; number <= pageCount; number += 1) {
      let items: PdfTextItem[];
      try {
        const page = await document.getPage(number);
        const content = await page.getTextContent({ includeMarkedContent: false });
        items = content.items.flatMap((item): PdfTextItem[] => ('str' in item ? [item] : []));
        page.cleanup();
      } catch {
        throw new DocumentParseError('parse_failed', 'pdf_page_unreadable');
      }
      const lines = buildLines(items);
      for (const line of lines) {
        const length = nonSpaceLength(line.cells.join(''));
        readable += length;
        budget.take(length);
      }
      pages.push(lines);
    }
    if (!hasTextLayer(readable, pageCount)) {
      throw new DocumentParseError('no_text_layer', 'below_average');
    }

    const body = bodySize(pages);
    const kept = stripRepeatedMargins(
      pages,
      (line) => line.cells.join(' '),
      (line) => isHeadingSized(line, body),
    );
    return finishDocument(KNOWLEDGE_DOCUMENT_PDF, pageCount, buildBlocks(kept, body), limits);
  } finally {
    await task.destroy();
  }
}

/** The font size an item is set in: the length of its matrix's vertical axis. */
function sizeOf(item: PdfTextItem): number {
  const [, , c = 0, d = 0] = item.transform;
  return Math.hypot(c, d) || Math.abs(item.height) || 1;
}

/** One page's items, in the order the page draws them, folded into lines and columns. */
export function buildLines(items: readonly PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let line: (PdfLine & { endX: number; space: boolean }) | null = null;

  const finish = () => {
    if (line) {
      const cells = line.cells.map(normalizeInline).filter((cell) => cell !== '');
      if (cells.length > 0) lines.push({ cells, size: line.size, y: line.y });
    }
    line = null;
  };

  for (const item of items) {
    const size = sizeOf(item);
    const x = Number(item.transform[4] ?? 0);
    const y = Number(item.transform[5] ?? 0);
    if (line !== null && Math.abs(y - line.y) > Math.max(line.size, size) * SAME_LINE) finish();

    if (item.str.trim() === '') {
      // A space item: remember it, but keep measuring the gap from the last
      // word — pdf.js draws a column gap as one wide space.
      if (line) line.space = true;
    } else if (line === null) {
      line = { cells: [item.str], size, y, endX: x + item.width, space: false };
    } else {
      const current: PdfLine & { endX: number; space: boolean } = line;
      const gap = x - current.endX;
      const unit = Math.max(current.size, size);
      if (gap > unit * COLUMN_GAP) {
        current.cells.push(item.str);
      } else {
        const last = current.cells.length - 1;
        const before = current.cells[last]!;
        // The last character only: an end-anchored expression is tried from
        // every position, and a page of a million one-letter items would make
        // the line it builds quadratic.
        const needsSpace =
          (current.space || gap > unit * 0.2) &&
          !/\s/u.test(before.slice(-1)) &&
          !/^\s/u.test(item.str);
        current.cells[last] = needsSpace ? `${before} ${item.str}` : before + item.str;
      }
      current.size = Math.max(current.size, size);
      current.endX = x + item.width;
      current.space = false;
    }
    if (item.hasEOL) finish();
  }
  finish();
  return lines;
}

const roundSize = (size: number) => Math.round(size * 2) / 2;

/** A paragraph or list item still taking lines. */
interface OpenParagraph {
  kind: 'paragraph' | 'list_item';
  text: string;
  size: number;
  y: number;
}

/** The body size: the one most characters are set in. */
function bodySize(pages: readonly PdfLine[][]): number {
  const charsAt = new Map<number, number>();
  for (const lines of pages) {
    for (const line of lines) {
      const size = roundSize(line.size);
      charsAt.set(size, (charsAt.get(size) ?? 0) + line.cells.join(' ').length);
    }
  }
  return [...charsAt].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function isHeadingSized(line: PdfLine, body: number): boolean {
  return body > 0 && line.size >= body * HEADING_SCALE;
}

/** Lines into blocks, page by page; nothing joins across a page. */
function buildBlocks(pages: readonly PdfLine[][], body: number): DocumentBlock[] {
  const isHeading = (line: PdfLine) => {
    const text = line.cells.join(' ');
    return (
      line.cells.length === 1 &&
      isHeadingSized(line, body) &&
      text.length <= HEADING_MAX_LENGTH &&
      /\p{L}/u.test(text)
    );
  };
  const headingSizes = [
    ...new Set(
      pages.flatMap((lines) => lines.filter(isHeading).map((line) => roundSize(line.size))),
    ),
  ].sort((a, b) => b - a);

  const blocks: DocumentBlock[] = [];
  pages.forEach((lines, index) => {
    const page = index + 1;
    const open: { paragraph: OpenParagraph | null } = { paragraph: null };
    const flush = () => {
      const { paragraph } = open;
      if (paragraph) {
        blocks.push({ kind: paragraph.kind, text: paragraph.text, pageFrom: page, pageTo: page });
      }
      open.paragraph = null;
    };

    for (const line of lines) {
      if (line.cells.length > 1) {
        flush();
        blocks.push({
          kind: 'table_row',
          text: tableRow(line.cells),
          pageFrom: page,
          pageTo: page,
        });
        continue;
      }
      const text = line.cells[0]!;
      if (isHeading(line)) {
        flush();
        const level = headingSizes.indexOf(roundSize(line.size)) + 1;
        blocks.push({
          kind: 'heading',
          level: Math.min(Math.max(level, 1), MAX_HEADING_LEVEL),
          text,
          pageFrom: page,
          pageTo: page,
        });
        continue;
      }
      if (BULLET.test(text) || NUMBERED.test(text)) {
        flush();
        open.paragraph = {
          kind: 'list_item',
          text: text.replace(BULLET, '- '),
          size: line.size,
          y: line.y,
        };
        continue;
      }
      const current = open.paragraph;
      const continues =
        current !== null &&
        Math.abs(current.size - line.size) <= current.size * 0.1 &&
        current.y > line.y &&
        current.y - line.y <= line.size * PARAGRAPH_LEADING;
      if (current !== null && continues) {
        current.text =
          /\p{L}-/u.test(current.text.slice(-2)) && /^\p{Ll}/u.test(text)
            ? current.text.slice(0, -1) + text
            : `${current.text} ${text}`;
        current.y = line.y;
      } else {
        flush();
        open.paragraph = { kind: 'paragraph', text, size: line.size, y: line.y };
      }
    }
    flush();
  });
  return blocks;
}
