/**
 * Just enough of a TrueType reader to embed a font in a PDF (tm 383 · K24).
 *
 * The report export (`reports-export.ts`) writes PDFs with the built-in
 * Helvetica in WinAnsi, which has no ğ, ı, İ, ş, Ş or Ğ — a Turkish company
 * name comes out with holes in it. An invoice cannot ship that way, so the
 * invoice PDF embeds a real font and addresses its glyphs directly
 * (`Identity-H`), which needs four facts per font: which glyph a character is
 * (`cmap`), how wide each glyph is (`hmtx`), and the metrics the font
 * descriptor states (`head`, `hhea`, `OS/2`, `post`).
 *
 * The font is Liberation Sans (SIL Open Font License 1.1, which permits
 * embedding), read from the copy `pdfjs-dist` already ships — the API depends
 * on that package for document parsing, so this adds no dependency and no
 * binary to the repository.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface TrueTypeFont {
  /** The whole file, embedded as `FontFile2`. */
  bytes: Buffer;
  /** PostScript-ish name for `BaseFont`, without spaces. */
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  bbox: [number, number, number, number];
  /** Glyph id for a code point; 0 (`.notdef`) when the font has none. */
  glyphFor(codePoint: number): number;
  /** Advance width of a glyph, in font units. */
  advance(glyph: number): number;
}

interface TableRecord {
  offset: number;
  length: number;
}

function tables(bytes: Buffer): Map<string, TableRecord> {
  const count = bytes.readUInt16BE(4);
  const found = new Map<string, TableRecord>();
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    found.set(bytes.toString('latin1', at, at + 4), {
      offset: bytes.readUInt32BE(at + 8),
      length: bytes.readUInt32BE(at + 12),
    });
  }
  return found;
}

function required(map: Map<string, TableRecord>, tag: string): TableRecord {
  const table = map.get(tag);
  if (!table) throw new Error(`font has no ${tag} table`);
  return table;
}

/**
 * The Unicode character map: format 4 (the Basic Multilingual Plane) from the
 * Windows Unicode subtable. Every character an invoice prints is in the BMP.
 */
function readCmap(bytes: Buffer, cmap: TableRecord): Map<number, number> {
  const count = bytes.readUInt16BE(cmap.offset + 2);
  let subtable = -1;
  for (let i = 0; i < count; i += 1) {
    const at = cmap.offset + 4 + i * 8;
    const platform = bytes.readUInt16BE(at);
    const encoding = bytes.readUInt16BE(at + 2);
    const offset = cmap.offset + bytes.readUInt32BE(at + 4);
    if (bytes.readUInt16BE(offset) !== 4) continue;
    if ((platform === 3 && encoding === 1) || (platform === 0 && subtable < 0)) subtable = offset;
  }
  if (subtable < 0) throw new Error('font has no Unicode format-4 cmap');

  const segments = bytes.readUInt16BE(subtable + 6) / 2;
  const ends = subtable + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  const map = new Map<number, number>();
  for (let s = 0; s < segments; s += 1) {
    const end = bytes.readUInt16BE(ends + s * 2);
    const start = bytes.readUInt16BE(starts + s * 2);
    const delta = bytes.readInt16BE(deltas + s * 2);
    const rangeAt = rangeOffsets + s * 2;
    const range = bytes.readUInt16BE(rangeAt);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph: number;
      if (range === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphAt = rangeAt + range + (code - start) * 2;
        const raw = bytes.readUInt16BE(glyphAt);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(code, glyph);
    }
  }
  return map;
}

export function parseTrueType(bytes: Buffer, name: string): TrueTypeFont {
  const map = tables(bytes);
  const head = required(map, 'head');
  const hhea = required(map, 'hhea');
  const hmtx = required(map, 'hmtx');
  const post = required(map, 'post');
  const os2 = map.get('OS/2');

  const unitsPerEm = bytes.readUInt16BE(head.offset + 18);
  const bbox: [number, number, number, number] = [
    bytes.readInt16BE(head.offset + 36),
    bytes.readInt16BE(head.offset + 38),
    bytes.readInt16BE(head.offset + 40),
    bytes.readInt16BE(head.offset + 42),
  ];
  const ascent = bytes.readInt16BE(hhea.offset + 4);
  const descent = bytes.readInt16BE(hhea.offset + 6);
  const metrics = bytes.readUInt16BE(hhea.offset + 34);
  const capHeight =
    os2 && bytes.readUInt16BE(os2.offset) >= 2 && os2.length >= 90
      ? bytes.readInt16BE(os2.offset + 88)
      : Math.round(ascent * 0.7);
  const italicAngle = bytes.readInt32BE(post.offset + 4) / 65536;

  const widths: number[] = [];
  for (let i = 0; i < metrics; i += 1) widths.push(bytes.readUInt16BE(hmtx.offset + i * 4));
  const lastWidth = widths[widths.length - 1] ?? 0;

  const cmap = readCmap(bytes, required(map, 'cmap'));

  return {
    bytes,
    name,
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    italicAngle,
    bbox,
    glyphFor: (codePoint) => cmap.get(codePoint) ?? 0,
    advance: (glyph) => widths[glyph] ?? lastWidth,
  };
}

/** The two invoice faces, read once per process. */
export interface InvoiceFonts {
  regular: TrueTypeFont;
  bold: TrueTypeFont;
}

let cached: InvoiceFonts | null = null;

/** Where `pdfjs-dist` keeps its standard fonts. */
function standardFontsDirectory(): string {
  return join(
    dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
    'standard_fonts',
  );
}

export function invoiceFonts(): InvoiceFonts {
  if (cached) return cached;
  const dir = standardFontsDirectory();
  cached = {
    regular: parseTrueType(readFileSync(join(dir, 'LiberationSans-Regular.ttf')), 'LiberationSans'),
    bold: parseTrueType(readFileSync(join(dir, 'LiberationSans-Bold.ttf')), 'LiberationSans-Bold'),
  };
  return cached;
}
