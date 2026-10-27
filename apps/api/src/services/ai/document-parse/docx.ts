/**
 * A Word document read into blocks (tm 313.2 · SiyahTuş analysis AI-18) — in
 * the worker process, never the API's.
 *
 * The archive is opened under AI-18's ZIP ceilings (`zip.ts`: 2,000 entries,
 * 100 MB unpacked, 100:1) and only three parts are inflated: the body
 * (`word/document.xml`), its styles and its numbering. Nothing else in the
 * package is read — headers and footers (page furniture), footnotes,
 * comments, embedded objects, images and the macro project a `.docm` would
 * carry (the upload refuses those anyway; here it is simply never opened, and
 * nothing is ever run).
 *
 * What the body keeps:
 *
 * - **Headings** — a paragraph whose style is a heading: by the style's name
 *   (`heading 1`…`9`, `Title`) followed through `basedOn`, or an outline level.
 *   Names, not ids: Turkish Word saves "Heading 1" with the id `Balk1`.
 * - **Lists** — a numbered paragraph (its own `w:numPr` or its style's) is a
 *   list item, `1.` / `a.` / `i.` for numbered formats and `-` for bullets.
 * - **Tables** — one block per row, `| a | b |`; a table inside a cell is
 *   read into that cell.
 * - Text of insertions, hyperlinks, fields' results and content controls.
 *
 * What it drops: deleted and moved-away text (tracked changes), field codes
 * (`PAGE`, `HYPERLINK "…"`), drawings, pictures and text boxes, the
 * pre-change copies of tracked formatting, and a table of contents (its lines
 * repeat the headings with page numbers).
 *
 * **Pages.** A Word file has no pages, only the layout Word last saved: each
 * `w:lastRenderedPageBreak` marks where a page began. When a document carries
 * them, they number its blocks; when it carries none (a file never laid out by
 * Word), explicit breaks do — page breaks, "page break before" and section
 * breaks that start a new page.
 */
import { KNOWLEDGE_DOCUMENT_DOCX } from '@siyahtus/types';
import { CharacterBudget, finishDocument, normalizeInline, tableRow } from './normalize.js';
import {
  DocumentParseError,
  MAX_HEADING_LEVEL,
  type DocumentBlock,
  type DocumentBlockKind,
  type DocumentParseLimits,
  type ParsedDocument,
} from './types.js';
import { scanXml } from './xml.js';
import { DOCX_ZIP_LIMITS, openZipArchive, type ZipArchive } from './zip.js';

const W_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/**
 * The prefixes the root element binds the WordprocessingML and
 * markup-compatibility namespaces to — `w` and `mc` in everything Word,
 * LibreOffice and Google Docs write, but a namespace is what the name means.
 */
function prefixes(attributes: Readonly<Record<string, string>>): { w: string; mc: string } {
  let w = 'w:';
  let mc = 'mc:';
  for (const [key, value] of Object.entries(attributes)) {
    if (key !== 'xmlns' && !key.startsWith('xmlns:')) continue;
    const prefix = key === 'xmlns' ? '' : `${key.slice(6)}:`;
    if (W_NAMESPACES.has(value)) w = prefix;
    if (value === MC_NAMESPACE) mc = prefix;
  }
  return { w, mc };
}

/** An attribute in the WordprocessingML namespace (`w:val`), by local name. */
function wAttr(
  attributes: Readonly<Record<string, string>>,
  w: string,
  local: string,
): string | undefined {
  return attributes[`${w}${local}`];
}

/** `w:val` read as an OOXML on/off value: absent means on. */
function isOn(value: string | undefined): boolean {
  return value === undefined || !['0', 'false', 'off'].includes(value);
}

function partXml(archive: ZipArchive, name: string): Buffer | null {
  const entry = archive.find(name);
  return entry ? archive.read(entry) : null;
}

// ---------------------------------------------------------------------------
// Styles and numbering

interface StyleInfo {
  name: string;
  basedOn?: string;
  outlineLevel?: number;
  numId?: string;
  ilvl?: number;
}

function readStyles(xml: Buffer | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  let ns = { w: 'w:', mc: 'mc:' };
  let root = true;
  let current: StyleInfo | null = null;
  let inPPr = 0;
  scanXml(xml, {
    open(name, attributes, selfClosing) {
      if (root) {
        ns = prefixes(attributes);
        root = false;
      }
      const { w } = ns;
      if (name === `${w}style`) {
        const id = wAttr(attributes, w, 'styleId');
        const type = wAttr(attributes, w, 'type');
        current = null;
        if (id !== undefined && (type === undefined || type === 'paragraph') && !selfClosing) {
          current = { name: '' };
          styles.set(id, current);
        }
        return;
      }
      if (!current) return;
      if (name === `${w}pPr` && !selfClosing) inPPr += 1;
      const val = wAttr(attributes, w, 'val');
      if (name === `${w}name`) current.name = val ?? '';
      else if (name === `${w}basedOn` && val) current.basedOn = val;
      else if (inPPr > 0 && name === `${w}outlineLvl`) current.outlineLevel = Number(val);
      else if (inPPr > 0 && name === `${w}numId` && val) current.numId = val;
      else if (inPPr > 0 && name === `${w}ilvl`) current.ilvl = Number(val);
    },
    close(name) {
      if (name === `${ns.w}style`) current = null;
      else if (name === `${ns.w}pPr` && inPPr > 0) inPPr -= 1;
    },
    text() {},
  });
  return styles;
}

interface ResolvedStyle {
  headingLevel: number | null;
  numId?: string;
  ilvl?: number;
  tableOfContents: boolean;
}

/** A style with what its `basedOn` chain contributes; the chain is followed at most 16 links (a cycle stops it). */
function resolveStyle(styles: Map<string, StyleInfo>, id: string | undefined): ResolvedStyle {
  const resolved: ResolvedStyle = { headingLevel: null, tableOfContents: false };
  if (id === undefined) return resolved;
  let nameLevel: number | null = null;
  let outlineLevel: number | null = null;
  let current: string | undefined = id;
  for (let hops = 0; current !== undefined && hops < 16; hops += 1) {
    const style = styles.get(current);
    if (!style) {
      // No styles part, or an id it does not define: the built-in ids are the names.
      if (hops === 0)
        nameLevel = headingLevelOfName(current.replace(/^heading(\d)$/i, 'heading $1'));
      break;
    }
    const name = style.name.trim().toLowerCase();
    if (hops === 0 && /^(toc \d|toc heading)$/.test(name)) resolved.tableOfContents = true;
    nameLevel ??= headingLevelOfName(name);
    if (outlineLevel === null && style.outlineLevel !== undefined) {
      outlineLevel = headingLevelOfOutline(style.outlineLevel);
    }
    if (resolved.numId === undefined && style.numId !== undefined) {
      resolved.numId = style.numId;
      resolved.ilvl = style.ilvl;
    }
    current = style.basedOn;
  }
  resolved.headingLevel = nameLevel ?? outlineLevel;
  return resolved;
}

function headingLevelOfName(name: string): number | null {
  const lower = name.toLowerCase();
  if (lower === 'title') return 1;
  const match = /^heading (\d)$/.exec(lower);
  return match ? Math.min(Number(match[1]), MAX_HEADING_LEVEL) : null;
}

/** `w:outlineLvl` 0–8 is a heading level 1–9; 9 is body text. */
function headingLevelOfOutline(level: number): number | null {
  return Number.isInteger(level) && level >= 0 && level <= 8
    ? Math.min(level + 1, MAX_HEADING_LEVEL)
    : null;
}

interface ListLevel {
  format: string;
  start: number;
}

interface Numbering {
  /** numId → abstractNumId. */
  nums: Map<string, string>;
  /** numId → ilvl → start override. */
  startOverrides: Map<string, Map<number, number>>;
  /** abstractNumId → ilvl → level. */
  abstracts: Map<string, Map<number, ListLevel>>;
}

function readNumbering(xml: Buffer | null): Numbering {
  const numbering: Numbering = { nums: new Map(), startOverrides: new Map(), abstracts: new Map() };
  if (!xml) return numbering;
  let ns = { w: 'w:', mc: 'mc:' };
  let root = true;
  let abstract: Map<number, ListLevel> | null = null;
  let level: ListLevel | null = null;
  let numId: string | null = null;
  let overrideLevel: number | null = null;
  scanXml(xml, {
    open(name, attributes) {
      if (root) {
        ns = prefixes(attributes);
        root = false;
      }
      const { w } = ns;
      const val = wAttr(attributes, w, 'val');
      if (name === `${w}abstractNum`) {
        abstract = new Map();
        numbering.abstracts.set(wAttr(attributes, w, 'abstractNumId') ?? '', abstract);
      } else if (name === `${w}lvl` && abstract) {
        level = { format: 'decimal', start: 1 };
        abstract.set(Number(wAttr(attributes, w, 'ilvl') ?? 0), level);
      } else if (name === `${w}start` && level) {
        level.start = Number(val ?? 1);
      } else if (name === `${w}numFmt` && level) {
        level.format = val ?? 'decimal';
      } else if (name === `${w}num`) {
        numId = wAttr(attributes, w, 'numId') ?? null;
      } else if (name === `${w}abstractNumId` && numId !== null && val !== undefined) {
        numbering.nums.set(numId, val);
      } else if (name === `${w}lvlOverride` && numId !== null) {
        overrideLevel = Number(wAttr(attributes, w, 'ilvl') ?? 0);
      } else if (name === `${w}startOverride` && numId !== null && overrideLevel !== null) {
        const overrides = numbering.startOverrides.get(numId) ?? new Map<number, number>();
        overrides.set(overrideLevel, Number(val ?? 1));
        numbering.startOverrides.set(numId, overrides);
      }
    },
    close(name) {
      const { w } = ns;
      if (name === `${w}abstractNum`) abstract = null;
      else if (name === `${w}lvl`) level = null;
      else if (name === `${w}num`) numId = null;
      else if (name === `${w}lvlOverride`) overrideLevel = null;
    },
    text() {},
  });
  return numbering;
}

function toRoman(n: number): string {
  const numerals: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  let rest = Math.min(Math.max(n, 1), 3999);
  for (const [value, numeral] of numerals) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

function toLetters(n: number): string {
  // Word's a…z, aa…zz, aaa…: the letter repeated, not base 26.
  const index = Math.max(n, 1) - 1;
  return String.fromCharCode(97 + (index % 26)).repeat(Math.floor(index / 26) + 1);
}

/** Counts list items per list and level, the way Word numbers them. */
class ListCounter {
  readonly #counters = new Map<string, number[]>();
  constructor(readonly numbering: Numbering) {}

  /** The marker for the next item of list `numId` at level `ilvl`: `1.`, `b.`, `iv.` or `-`. */
  next(numId: string, ilvl: number): string {
    const abstractId = this.numbering.nums.get(numId);
    const level = abstractId ? this.numbering.abstracts.get(abstractId)?.get(ilvl) : undefined;
    const format = level?.format ?? 'bullet';
    const start = this.numbering.startOverrides.get(numId)?.get(ilvl) ?? level?.start ?? 1;

    const counters = this.#counters.get(numId) ?? [];
    counters[ilvl] = (counters[ilvl] ?? start - 1) + 1;
    counters.length = ilvl + 1; // a new item restarts every deeper level
    this.#counters.set(numId, counters);
    const n = counters[ilvl]!;

    switch (format) {
      case 'decimal':
      case 'decimalZero':
        return `${n}.`;
      case 'lowerLetter':
        return `${toLetters(n)}.`;
      case 'upperLetter':
        return `${toLetters(n).toUpperCase()}.`;
      case 'lowerRoman':
        return `${toRoman(n)}.`;
      case 'upperRoman':
        return `${toRoman(n).toUpperCase()}.`;
      case 'none':
        return '';
      default:
        return '-';
    }
  }
}

// ---------------------------------------------------------------------------
// The body

/** Where a block began and ended, in both page counts — which one numbers it is decided once the body is read. */
interface PagePoint {
  rendered: number;
  explicit: number;
}

interface BlockDraft {
  kind: DocumentBlockKind;
  level?: number;
  text: string;
  from: PagePoint;
  to: PagePoint;
}

interface ParagraphState {
  style?: string;
  numId?: string;
  ilvl?: number;
  outlineLevel?: number;
  /** A section break in this paragraph's properties: the next paragraph starts a new page. */
  sectionBreak: boolean;
  text: string;
  from: PagePoint | null;
}

interface CellState {
  text: string[];
  from: PagePoint | null;
}

interface RowState {
  cells: string[];
  cell: CellState | null;
  from: PagePoint | null;
}

/** Elements whose content is never text the document shows (see the module comment). */
const SKIPPED = [
  'del',
  'moveFrom',
  'delText',
  'instrText',
  'delInstrText',
  'drawing',
  'pict',
  'object',
  'sdtPr',
  'rt',
  'pPrChange',
  'rPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'numberingChange',
];

export function parseDocx(bytes: Buffer, limits: DocumentParseLimits): ParsedDocument {
  const archive = openZipArchive(bytes, DOCX_ZIP_LIMITS);
  const body = partXml(archive, 'word/document.xml');
  if (!body) throw new DocumentParseError('parse_failed', 'docx_no_body');
  const styles = readStyles(partXml(archive, 'word/styles.xml'));
  const lists = new ListCounter(readNumbering(partXml(archive, 'word/numbering.xml')));

  // The running count stops a body far past the ceiling while it is read;
  // `finishDocument` checks the exact total. A paragraph's raw text may be
  // twice the ceiling before it is judged (whitespace it folds away).
  const budget = new CharacterBudget(limits.maxChars);
  const rawParagraphCap = limits.maxChars * 2;
  const drafts: BlockDraft[] = [];
  const page: PagePoint = { rendered: 0, explicit: 0 };
  const here = (): PagePoint => ({ ...page });

  let ns = { w: 'w:', mc: 'mc:' };
  let skipped = new Set<string>();
  let root = true;
  let skipDepth = 0;
  let skipName = '';
  let paragraph: ParagraphState | null = null;
  let paragraphDepth = 0;
  let pPrDepth = 0;
  let sectPrDepth = 0;
  let runDepth = 0;
  let inText = false;
  let tableDepth = 0;
  let row: RowState | null = null;

  const appendText = (text: string) => {
    if (!paragraph) return;
    if (paragraph.from === null && text.trim() !== '') {
      paragraph.from = here();
      if (row?.cell && row.cell.from === null) row.cell.from = paragraph.from;
      if (row && row.from === null) row.from = paragraph.from;
    }
    paragraph.text += text;
    if (paragraph.text.length > rawParagraphCap) {
      throw new DocumentParseError('too_many_characters', 'over_limit');
    }
  };

  const finishParagraph = (state: ParagraphState) => {
    const style = resolveStyle(styles, state.style);
    const text = normalizeInline(state.text);
    if (text === '' || state.from === null || style.tableOfContents) return;
    budget.take(text.length);

    if (tableDepth > 0) {
      row?.cell?.text.push(text);
      return;
    }
    const numId = state.numId ?? style.numId;
    const headingLevel =
      (state.outlineLevel !== undefined ? headingLevelOfOutline(state.outlineLevel) : null) ??
      style.headingLevel;
    if (headingLevel !== null) {
      drafts.push({ kind: 'heading', level: headingLevel, text, from: state.from, to: here() });
    } else if (numId !== undefined && numId !== '0') {
      const marker = lists.next(numId, state.ilvl ?? style.ilvl ?? 0);
      const item = marker === '' ? text : `${marker} ${text}`;
      drafts.push({ kind: 'list_item', text: item, from: state.from, to: here() });
    } else {
      drafts.push({ kind: 'paragraph', text, from: state.from, to: here() });
    }
  };

  scanXml(body, {
    open(name, attributes, selfClosing) {
      if (root) {
        ns = prefixes(attributes);
        skipped = new Set([...SKIPPED.map((local) => `${ns.w}${local}`), `${ns.mc}Fallback`]);
        root = false;
      }
      if (skipDepth > 0) {
        if (name === skipName && !selfClosing) skipDepth += 1;
        return;
      }
      if (skipped.has(name)) {
        if (!selfClosing) {
          skipName = name;
          skipDepth = 1;
        }
        return;
      }
      const { w } = ns;
      const local = name.startsWith(w) ? name.slice(w.length) : null;
      if (local === null) return;

      switch (local) {
        case 'p':
          if (paragraph) {
            paragraphDepth += 1; // a paragraph nested in one (a text box Word left inline): read into it
          } else if (!selfClosing) {
            paragraph = { sectionBreak: false, text: '', from: null };
            paragraphDepth = 1;
          }
          return;
        case 'pPr':
          if (!selfClosing) pPrDepth += 1;
          return;
        case 'sectPr':
          if (pPrDepth > 0 && paragraph) {
            paragraph.sectionBreak = true; // nextPage unless a `w:type` says otherwise
            if (!selfClosing) sectPrDepth += 1;
          }
          return;
        case 'type':
          if (sectPrDepth > 0 && paragraph) {
            const kind = wAttr(attributes, w, 'val');
            paragraph.sectionBreak = !(kind === 'continuous' || kind === 'nextColumn');
          }
          return;
        case 'pStyle':
          if (pPrDepth > 0 && paragraph) paragraph.style = wAttr(attributes, w, 'val');
          return;
        case 'numId':
          if (pPrDepth > 0 && paragraph) paragraph.numId = wAttr(attributes, w, 'val');
          return;
        case 'ilvl':
          if (pPrDepth > 0 && paragraph) paragraph.ilvl = Number(wAttr(attributes, w, 'val') ?? 0);
          return;
        case 'outlineLvl':
          if (pPrDepth > 0 && paragraph) {
            paragraph.outlineLevel = Number(wAttr(attributes, w, 'val'));
          }
          return;
        case 'pageBreakBefore':
          if (pPrDepth > 0 && isOn(wAttr(attributes, w, 'val'))) page.explicit += 1;
          return;
        case 'r':
          if (!selfClosing) runDepth += 1;
          return;
        case 't':
          inText = !selfClosing && runDepth > 0;
          return;
        case 'tab':
          if (runDepth > 0) appendText(' ');
          return;
        case 'br':
          if (runDepth === 0) return;
          if (wAttr(attributes, w, 'type') === 'page') page.explicit += 1;
          appendText(' ');
          return;
        case 'cr':
          if (runDepth > 0) appendText(' ');
          return;
        case 'noBreakHyphen':
          if (runDepth > 0) appendText('-');
          return;
        case 'lastRenderedPageBreak':
          page.rendered += 1;
          return;
        case 'tbl':
          if (!selfClosing) tableDepth += 1;
          return;
        case 'tr':
          if (tableDepth === 1 && !selfClosing) row = { cells: [], cell: null, from: null };
          return;
        case 'tc':
          if (tableDepth === 1 && row && !selfClosing) row.cell = { text: [], from: null };
          return;
        default:
          return;
      }
    },
    close(name) {
      if (skipDepth > 0) {
        if (name === skipName) skipDepth -= 1;
        return;
      }
      const { w } = ns;
      if (!name.startsWith(w)) return;
      switch (name.slice(w.length)) {
        case 'p':
          if (paragraphDepth > 1) {
            paragraphDepth -= 1;
          } else if (paragraph) {
            const state = paragraph;
            paragraph = null;
            paragraphDepth = 0;
            finishParagraph(state);
            if (state.sectionBreak) page.explicit += 1;
          }
          return;
        case 'pPr':
          if (pPrDepth > 0) pPrDepth -= 1;
          return;
        case 'sectPr':
          if (sectPrDepth > 0) sectPrDepth -= 1;
          return;
        case 'r':
          if (runDepth > 0) runDepth -= 1;
          return;
        case 't':
          inText = false;
          return;
        case 'tc':
          if (tableDepth === 1 && row?.cell) {
            row.cells.push(row.cell.text.join(' '));
            row.cell = null;
          }
          return;
        case 'tr':
          if (tableDepth === 1 && row) {
            const done = row;
            row = null;
            if (done.from !== null && done.cells.some((cell) => cell !== '')) {
              drafts.push({
                kind: 'table_row',
                text: tableRow(done.cells),
                from: done.from,
                to: here(),
              });
            }
          }
          return;
        case 'tbl':
          if (tableDepth > 0) tableDepth -= 1;
          return;
        default:
          return;
      }
    },
    text(text) {
      if (skipDepth === 0 && inText) appendText(text);
    },
  });

  // Word's own layout numbers the pages when the file carries it.
  const rendered = page.rendered > 0;
  const pageOf = (point: PagePoint) => (rendered ? point.rendered : point.explicit) + 1;
  const blocks: DocumentBlock[] = drafts.map((draft) => ({
    kind: draft.kind,
    ...(draft.level !== undefined ? { level: draft.level } : {}),
    text: draft.text,
    pageFrom: pageOf(draft.from),
    pageTo: Math.max(pageOf(draft.from), pageOf(draft.to)),
  }));
  const lastBlockPage = blocks.reduce((max, block) => Math.max(max, block.pageTo), 1);
  return finishDocument(
    KNOWLEDGE_DOCUMENT_DOCX,
    Math.max(pageOf(page), lastBlockPage),
    blocks,
    limits,
  );
}
