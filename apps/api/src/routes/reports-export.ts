/**
 * Report groups and CSV/PDF export (FR-MOD-07.7).
 *
 * Two concerns share this module because they share one catalogue:
 *
 *   1. Permission-based visibility — a report is a *group* with a required
 *      scope, and a caller sees only the groups their token satisfies. The
 *      catalogue is the single source of truth for both what `/reports/groups`
 *      lists and what `/reports/export` will hand out, so the two can never
 *      disagree about who may read what.
 *   2. Export — each group serialises to CSV, and (07.7-f) to PDF. Both
 *      serialisers live here, apart from the route, because their correctness
 *      (quoting, the spreadsheet formula-injection guard, PDF byte offsets) is
 *      worth testing without a server.
 *
 * Benchmark comparison remains out of scope for v1 (PLAN §4.4.8, PRD 07.7 marks
 * it v2).
 */
import { hasAnyScope, type Scope } from '@nexa/types';

/** A report group: a named, scope-gated slice of the reports surface. */
export interface ReportGroup {
  id: string;
  label: string;
  /**
   * Scopes that grant this group, OR semantics. Every group today needs
   * `reports_read` — the whole reports surface is one permission — but the
   * catalogue carries the requirement per group so a future group gated on a
   * different scope (a billing export, say) drops in without reworking the
   * visibility or the guard.
   */
  scopes: Scope[];
}

/**
 * The catalogue, in the order the Reports page shows its tabs. Each id is the
 * `group` an export is requested for and the tab the web client renders, so the
 * three surfaces (tabs, groups list, export) speak one vocabulary.
 */
export const REPORT_GROUPS: readonly ReportGroup[] = [
  { id: 'overview', label: 'Overview', scopes: ['reports_read'] },
  { id: 'breakdown', label: 'Breakdown', scopes: ['reports_read'] },
  { id: 'ai-agent', label: 'AI Agent', scopes: ['reports_read'] },
  { id: 'reviews', label: 'Reviews', scopes: ['reports_read'] },
  { id: 'topics', label: 'Chat topics', scopes: ['reports_read'] },
  { id: 'cases', label: 'Cases', scopes: ['reports_read'] },
  { id: 'leads', label: 'Leads', scopes: ['reports_read'] },
  { id: 'team-performance', label: 'Team performance', scopes: ['reports_read'] },
  { id: 'sales', label: 'Sales', scopes: ['reports_read'] },
  { id: 'goals', label: 'Goals', scopes: ['reports_read'] },
] as const;

export type ReportGroupId = (typeof REPORT_GROUPS)[number]['id'];

/**
 * Every scope that grants *some* group — the route-level requirement for the
 * export endpoint, so a token holding none of them is refused at the guard
 * before any group is even resolved. Kept in sync with the catalogue by
 * construction rather than hand-listed.
 */
export const EXPORT_SCOPES: Scope[] = [...new Set(REPORT_GROUPS.flatMap((group) => group.scopes))];

/** The group with this id, or undefined — the caller turns undefined into a 400. */
export function reportGroup(id: string): ReportGroup | undefined {
  return REPORT_GROUPS.find((group) => group.id === id);
}

/**
 * The groups a caller with these granted scopes may see. This *is* the
 * permission-based visibility rule (FR-MOD-07.7): a token missing `reports_read`
 * gets an empty list, not a 403 — "here is what you can see" answers honestly
 * with nothing rather than refusing to answer.
 */
export function visibleReportGroups(granted: readonly string[]): ReportGroup[] {
  return REPORT_GROUPS.filter((group) => hasAnyScope(granted, group.scopes));
}

/** A single CSV cell before serialisation. Null/undefined render as empty. */
export type CsvCell = string | number | null | undefined;

/**
 * Characters that make a spreadsheet treat a cell as a formula. A field a user
 * influenced (an agent name, a tag) that begins with one of these would run on
 * open — the classic CSV-injection path. `\t` and `\r` are here because Excel
 * treats a leading tab/carriage-return the same way.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One field, RFC 4180 quoted and injection-guarded.
 *
 * A string that opens with a formula lead gets a `'` prefix first — the standard
 * neutralisation, which spreadsheets strip on display but never execute. Then any
 * field containing a comma, quote, CR or LF is wrapped in double quotes with its
 * own quotes doubled. Numbers are emitted bare; null/undefined as empty.
 */
function csvField(cell: CsvCell): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';

  const guarded = FORMULA_LEAD.test(cell) ? `'${cell}` : cell;
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/**
 * A header row plus data rows as RFC 4180 CSV. Lines end CRLF (what the spec and
 * Excel expect); the whole document ends with a trailing CRLF so a POSIX tool
 * that counts lines agrees with the row count.
 */
export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const line = (cells: readonly CsvCell[]): string => cells.map(csvField).join(',');
  return [line(headers), ...rows.map(line)].map((row) => `${row}\r\n`).join('');
}

/** A download format the export endpoint can hand out. */
export type ExportFormat = 'csv' | 'pdf';

/**
 * A stable, filesystem-safe download name — `nexa-<group>-<from>-<to>.<ext>`,
 * dates as UTC `YYYY-MM-DD`. Encodes the window so two exports of the same group
 * over different ranges do not overwrite each other in a downloads folder, and
 * the extension so the CSV and the PDF of one window are distinct files too.
 * Defaults to `csv` — the format that shipped in v1, so existing callers keep
 * their names byte-for-byte.
 */
export function exportFilename(
  groupId: string,
  from: Date,
  to: Date,
  format: ExportFormat = 'csv',
): string {
  const day = (date: Date): string => date.toISOString().slice(0, 10);
  return `nexa-${groupId}-${day(from)}-${day(to)}.${format}`;
}

/* -------------------------------------------------------------------------- *
 * PDF serialiser (07.7-f) — `toCsv`'s counterpart.
 *
 * Written by hand, against the PDF 1.7 file structure, for two reasons: the repo
 * carries no PDF dependency and adding one for a table of numbers is not worth
 * the supply-chain surface; and every PDF library we would reach for stamps a
 * wall-clock creation date into the output, which would make two exports of the
 * same window differ. Everything below is a pure function of its arguments —
 * same input, byte-identical output — so the route can cache it, a test can
 * compare two calls, and a reviewer can diff two runs.
 *
 * Deliberately NOT carried over from the CSV path: the `FORMULA_LEAD` guard. It
 * exists because a spreadsheet *executes* a cell that opens with `=`/`+`/`-`/`@`.
 * A PDF has no formula evaluator — a page is drawn text — so prefixing a `'`
 * here would corrupt the reader's data (an agent named `-Acme` would print as
 * `'-Acme`) to defend against an attack this format cannot suffer. The guard
 * stays where the threat is.
 * -------------------------------------------------------------------------- */

/** Metadata a caller supplies; nothing here is invented, so output stays stable. */
export interface PdfMeta {
  /** Second line under the title — typically the reporting window. */
  subtitle?: string;
  /**
   * `/CreationDate` and `/ModDate`. Omitted entirely when absent rather than
   * defaulted to "now": a generated timestamp is exactly the non-determinism
   * this serialiser exists to avoid.
   */
  createdAt?: Date;
  /** `/Author`, omitted when absent. */
  author?: string;
}

/**
 * The 0x80–0x9F window of WinAnsi (CP1252), the only codes that are not simply
 * their own Latin-1 byte. Codes 0x20–0x7E and 0xA0–0xFF encode as themselves.
 */
const WIN_ANSI_HIGH: ReadonlyMap<string, number> = new Map([
  ['€', 0x80],
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85],
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8a],
  ['‹', 0x8b],
  ['Œ', 0x8c],
  ['Ž', 0x8e],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9a],
  ['›', 0x9b],
  ['œ', 0x9c],
  ['ž', 0x9e],
  ['Ÿ', 0x9f],
]);

/** The truncation marker, written as the byte it already is: WinAnsi 0x85 is the ellipsis. */
const ELLIPSIS = '\u0085';

/**
 * Text as WinAnsi bytes, carried in a string whose char codes are all ≤ 0xFF so
 * `latin1` round-trips it byte-for-byte.
 *
 * A core font addresses 256 glyphs, so a code point outside WinAnsi has no glyph
 * to draw and becomes `?`. That is a *rendering* limit, not a corruption one:
 * the substitution is one byte wide, so every offset in the file stays correct
 * and a Turkish or CJK cell degrades legibly instead of tearing the document.
 * Escaping this limit needs an embedded font, which needs a dependency — out of
 * scope here (07.7-f explicitly forbids one).
 *
 * Control characters collapse to a space: a table cell is one line, and a raw
 * newline inside a `Tj` string would draw nothing while shifting nothing.
 */
function toWinAnsi(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += ' ';
    } else if (code <= 0x7e || (code >= 0xa0 && code <= 0xff)) {
      out += character;
    } else {
      const mapped = WIN_ANSI_HIGH.get(character);
      out += mapped === undefined ? '?' : String.fromCharCode(mapped);
    }
  }
  return out;
}

/** Helvetica advance widths (units per 1000 em) for 0x20–0x7E, from the AFM. */
const ASCII_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Helvetica advances that differ markedly from the fallback, by WinAnsi byte. */
const SPECIAL_WIDTHS: ReadonlyMap<number, number> = new Map([
  [0x85, 1000],
  [0x89, 1000],
  [0x8c, 1000],
  [0x91, 222],
  [0x92, 222],
  [0x93, 333],
  [0x94, 333],
  [0x95, 350],
  [0x97, 1000],
  [0x99, 1000],
  [0xa0, 278],
  [0xa9, 737],
  [0xac, 584],
  [0xad, 333],
  [0xae, 737],
  [0xb0, 400],
  [0xb1, 584],
  [0xbc, 834],
  [0xbd, 834],
  [0xbe, 834],
  [0xd7, 584],
  [0xdf, 611],
  [0xf7, 584],
]);

/**
 * One glyph's advance. Accented capitals fall back to 722 and everything else to
 * 556 — the commonest advances in each band. The fallback only ever skews column
 * proportions by a point or two, which is cosmetic; it can never desynchronise
 * the file, because widths are used for layout and never for byte accounting.
 */
function glyphWidth(code: number): number {
  if (code >= 0x20 && code <= 0x7e) return ASCII_WIDTHS[code - 0x20] ?? 556;
  const special = SPECIAL_WIDTHS.get(code);
  if (special !== undefined) return special;
  if (code >= 0xc0 && code <= 0xde) return 722;
  return 556;
}

/** Width of already-encoded text at a point size. */
function textWidth(encoded: string, size: number): number {
  let total = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    total += glyphWidth(encoded.charCodeAt(index));
  }
  return (total * size) / 1000;
}

/**
 * Encoded text shortened to fit, with an ellipsis when anything was dropped. A
 * column too narrow even for the ellipsis renders empty rather than overflowing
 * into its neighbour.
 */
function fitText(encoded: string, size: number, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  // A column sized to its own widest cell computes that cell's width as
  // `(w + padding) - padding`, which in binary floating point can land a
  // hundred-trillionth of a point over `w` and truncate text that exactly fits.
  // Coordinates are emitted rounded to 1/100 pt, so slack below that is not
  // representable in the output, let alone visible.
  const limit = maxWidth + 0.005;
  if (textWidth(encoded, size) <= limit) return encoded;

  const ellipsisWidth = textWidth(ELLIPSIS, size);
  if (ellipsisWidth > limit) return '';

  let used = ellipsisWidth;
  let out = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const advance = (glyphWidth(encoded.charCodeAt(index)) * size) / 1000;
    if (used + advance > limit) break;
    used += advance;
    out += encoded.charAt(index);
  }
  return out + ELLIPSIS;
}

/**
 * A PDF literal string. `\`, `(` and `)` are escaped because they delimit and
 * escape the string itself — an unescaped `)` in an agent's name would end the
 * string early and turn the rest of the cell into malformed operators. Every
 * other non-printable or high byte goes out as a `\ooo` octal escape, which
 * leaves content streams pure ASCII and immune to any transport that rewrites
 * eight-bit data.
 */
function pdfLiteral(encoded: string): string {
  let out = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded.charAt(index);
    const code = encoded.charCodeAt(index);
    if (character === '\\' || character === '(' || character === ')') {
      out += `\\${character}`;
    } else if (code < 0x20 || code > 0x7e) {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    } else {
      out += character;
    }
  }
  return `(${out})`;
}

/** A coordinate, trimmed to two decimals so identical layouts serialise identically. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** A cell as display text — the CSV rules for null and non-finite, no formula guard. */
function pdfCellText(cell: CsvCell): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  return cell;
}

// A4 at 72 dpi, rounded to whole points: every reader accepts it and whole
// numbers keep the content stream short and diffable.
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const TITLE_SIZE = 14;
const SUBTITLE_SIZE = 9;
const BODY_SIZE = 9;
const FOOTER_SIZE = 8;
const ROW_HEIGHT = 14;
const CELL_PAD = 4;
/** Baseline sits this far above the bottom rule of its row band. */
const BASELINE_LIFT = 4;
/** Shown in place of the body when there is nothing to tabulate. */
const EMPTY_TABLE_NOTE = 'No data.';

interface Placement {
  /** Left edge of each column, and its width. */
  columns: { x: number; width: number }[];
  /** Top edge of the header band. */
  tableTop: number;
  /** Rows that fit on one page, at least one. */
  rowsPerPage: number;
  subtitleBaseline: number | null;
  titleBaseline: number;
}

/**
 * Splits the page across columns by max-min fair share: a column narrower than
 * its equal share is settled at the width it actually needs and hands the
 * surplus back, and only the columns still asking for more divide what is left.
 *
 * Scaling every column proportionally instead would let one long free-text cell
 * take the page — a 500-character note next to `date` and `count` squeezes both
 * of them down to a bare ellipsis, which is what the first cut of this did.
 */
function fairWidths(natural: readonly number[], usable: number): number[] {
  const count = natural.length;
  if (count === 0) return [];

  const widths = new Array<number>(count).fill(0);
  const pending = new Set(natural.keys());
  let remaining = usable;

  while (pending.size > 0) {
    const share = remaining / pending.size;
    const settled = [...pending].filter((index) => (natural[index] ?? 0) <= share);
    if (settled.length === 0) {
      // Everyone left wants more than their share — split it evenly and stop.
      for (const index of pending) widths[index] = share;
      break;
    }
    for (const index of settled) {
      const width = natural[index] ?? 0;
      widths[index] = width;
      remaining -= width;
      pending.delete(index);
    }
  }

  // Everything fitted with room to spare: spread the slack so a two-column table
  // still spans the page rather than huddling in the left third.
  const used = widths.reduce((sum, width) => sum + width, 0);
  if (used < usable) {
    const bonus = (usable - used) / count;
    for (let index = 0; index < count; index += 1) widths[index] = (widths[index] ?? 0) + bonus;
  }
  return widths;
}

/** Column geometry and vertical rhythm for the whole document. */
function planLayout(
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  hasSubtitle: boolean,
): Placement {
  const usable = PAGE_WIDTH - MARGIN * 2;
  const natural = headers.map((header, index) => {
    let widest = textWidth(toWinAnsi(header), BODY_SIZE);
    for (const row of rows) {
      widest = Math.max(widest, textWidth(toWinAnsi(pdfCellText(row[index])), BODY_SIZE));
    }
    return widest + CELL_PAD * 2;
  });

  const columns: Placement['columns'] = [];
  let x = MARGIN;
  for (const width of fairWidths(natural, usable)) {
    columns.push({ x, width });
    x += width;
  }

  const titleBaseline = PAGE_HEIGHT - MARGIN - TITLE_SIZE;
  const subtitleBaseline = hasSubtitle ? titleBaseline - 13 : null;
  const tableTop = (subtitleBaseline ?? titleBaseline) - 18;
  // The footer lives inside the bottom margin; the body stops above it.
  const tableBottom = MARGIN + 14;
  const bodyHeight = tableTop - ROW_HEIGHT - tableBottom;
  const rowsPerPage = Math.max(1, Math.floor(bodyHeight / ROW_HEIGHT));

  return { columns, tableTop, rowsPerPage, subtitleBaseline, titleBaseline };
}

/** The content stream for one page. */
function renderPage(
  title: string,
  subtitle: string | undefined,
  headers: readonly string[],
  pageRows: readonly (readonly CsvCell[])[],
  layout: Placement,
  pageNumber: number,
  pageCount: number,
): string {
  const ops: string[] = [];
  const text = (font: string, size: number, x: number, baseline: number, value: string): void => {
    ops.push(
      `BT /${font} ${num(size)} Tf ${num(x)} ${num(baseline)} Td ${pdfLiteral(value)} Tj ET`,
    );
  };
  const rule = (y: number, grey: number): void => {
    ops.push(
      `${num(grey)} G 0.5 w ${num(MARGIN)} ${num(y)} m ${num(PAGE_WIDTH - MARGIN)} ${num(y)} l S`,
    );
  };

  // Every page repeats the title so a page torn out of the stack still says what
  // it is and over which window.
  text('F2', TITLE_SIZE, MARGIN, layout.titleBaseline, toWinAnsi(title));
  if (subtitle !== undefined && layout.subtitleBaseline !== null) {
    ops.push('0.35 0.35 0.35 rg');
    text('F1', SUBTITLE_SIZE, MARGIN, layout.subtitleBaseline, toWinAnsi(subtitle));
    ops.push('0 0 0 rg');
  }

  const headerBottom = layout.tableTop - ROW_HEIGHT;
  rule(layout.tableTop, 0.7);
  for (const [index, header] of headers.entries()) {
    const column = layout.columns[index];
    if (column === undefined) continue;
    const fitted = fitText(toWinAnsi(header), BODY_SIZE, column.width - CELL_PAD * 2);
    text('F2', BODY_SIZE, column.x + CELL_PAD, headerBottom + BASELINE_LIFT, fitted);
  }
  rule(headerBottom, 0.7);

  if (headers.length === 0 || pageRows.length === 0) {
    // A table with no body is still a document: the reader learns the export ran
    // and found nothing, which an empty file would not tell them.
    ops.push('0.35 0.35 0.35 rg');
    text(
      'F1',
      BODY_SIZE,
      MARGIN + CELL_PAD,
      headerBottom - ROW_HEIGHT + BASELINE_LIFT,
      toWinAnsi(EMPTY_TABLE_NOTE),
    );
    ops.push('0 0 0 rg');
  }

  let bandBottom = headerBottom;
  for (const row of pageRows) {
    bandBottom -= ROW_HEIGHT;
    for (const [index, column] of layout.columns.entries()) {
      const cell = row[index];
      const fitted = fitText(toWinAnsi(pdfCellText(cell)), BODY_SIZE, column.width - CELL_PAD * 2);
      if (fitted === '') continue;
      // Numbers right-align against their column edge so a column of counts reads
      // as a column; text stays left-aligned.
      const x =
        typeof cell === 'number'
          ? column.x + column.width - CELL_PAD - textWidth(fitted, BODY_SIZE)
          : column.x + CELL_PAD;
      text('F1', BODY_SIZE, x, bandBottom + BASELINE_LIFT, fitted);
    }
  }
  if (pageRows.length > 0) rule(bandBottom, 0.85);

  const footer = toWinAnsi(`Page ${pageNumber} of ${pageCount}`);
  ops.push('0.35 0.35 0.35 rg');
  text(
    'F1',
    FOOTER_SIZE,
    PAGE_WIDTH - MARGIN - textWidth(footer, FOOTER_SIZE),
    MARGIN - 16,
    footer,
  );
  ops.push('0 0 0 rg');

  return `${ops.join('\n')}\n`;
}

/** `D:YYYYMMDDHHmmSSZ00'00'` — the PDF date form, in UTC, derived from the input. */
function pdfDate(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `D:${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z00'00'`
  );
}

/**
 * A header row plus data rows as a single-file PDF 1.7 document — `toCsv`'s
 * counterpart for the same tabular data.
 *
 * The layout is a paginated table set in Helvetica, a PDF core font, so no font
 * data is embedded and no dependency is needed. The title (and the column header
 * row) repeat on every page. Output is deterministic: given the same arguments it
 * is byte-for-byte identical, because nothing inside reads a clock, a random
 * source or the environment — a creation date, if wanted, comes from `meta`.
 *
 * Returns bytes rather than a string: `xref` carries byte offsets into the file,
 * so the caller must not be able to re-encode it and silently invalidate them.
 */
export function toPdf(
  title: string,
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  meta: PdfMeta = {},
): Buffer {
  const layout = planLayout(headers, rows, meta.subtitle !== undefined);
  // With no columns there is nothing to lay a row out in, so a caller that passes
  // rows anyway gets one honest empty page rather than N blank ones.
  const paginated = headers.length === 0 ? [] : rows;
  const pages: (readonly CsvCell[])[][] = [];
  for (let start = 0; start < paginated.length; start += layout.rowsPerPage) {
    pages.push(paginated.slice(start, start + layout.rowsPerPage));
  }
  // No rows still means one page — the empty-table note needs somewhere to live.
  if (pages.length === 0) pages.push([]);

  // Fixed object numbering: 1 catalogue, 2 page tree, 3–4 fonts, 5 info, then a
  // page and its content stream per sheet.
  const pageObject = (index: number): number => 6 + index * 2;
  const kids = pages.map((_, index) => `${pageObject(index)} 0 R`).join(' ');

  const bodies: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    [
      '<< /Title ',
      pdfLiteral(toWinAnsi(title)),
      ' /Producer (Nexa)',
      meta.author === undefined ? '' : ` /Author ${pdfLiteral(toWinAnsi(meta.author))}`,
      meta.createdAt === undefined
        ? ''
        : ` /CreationDate (${pdfDate(meta.createdAt)}) /ModDate (${pdfDate(meta.createdAt)})`,
      ' >>',
    ].join(''),
  ];

  for (const [index, pageRows] of pages.entries()) {
    const content = renderPage(
      title,
      meta.subtitle,
      headers,
      pageRows,
      layout,
      index + 1,
      pages.length,
    );
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObject(index) + 1} 0 R >>`,
    );
    // Uncompressed: `zlib` output is not guaranteed stable across Node versions,
    // and determinism is worth more here than a few kilobytes.
    bodies.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    );
  }

  const parts: string[] = [];
  let offset = 0;
  const push = (chunk: string): void => {
    parts.push(chunk);
    offset += Buffer.byteLength(chunk, 'latin1');
  };

  // The binary comment marks the file as binary for transports that would
  // otherwise mangle line endings.
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');

  const offsets: number[] = [];
  for (const [index, body] of bodies.entries()) {
    offsets.push(offset);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  }

  const startxref = offset;
  // Each xref entry is exactly 20 bytes, as the spec requires.
  const entries = ['0000000000 65535 f\r\n'];
  for (const objectOffset of offsets) {
    entries.push(`${String(objectOffset).padStart(10, '0')} 00000 n\r\n`);
  }
  push(`xref\n0 ${bodies.length + 1}\n${entries.join('')}`);
  push(
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R /Info 5 0 R >>\n` +
      `startxref\n${startxref}\n%%EOF\n`,
  );

  return Buffer.from(parts.join(''), 'latin1');
}
