/**
 * The informational invoice PDF (tm 383 · BL-02 · K24).
 *
 * Rendered **once**, when the period-close sweep issues the statement, from the
 * statement's own frozen fields — its number, lines, totals, the two party
 * snapshots and how it was paid — and stored. Nothing here reads the database
 * or the clock: the same document always renders to the same bytes, and a
 * later edit to the billing profile cannot reach a PDF that already exists.
 *
 * It says on its face that it is for information only (K24): whether it can be
 * a legal invoice depends on the country of the issuing company, which is not
 * decided yet (07 open risk). Labels are bilingual, Turkish first.
 *
 * Text is set in an embedded TrueType font (`ttf-font.ts`) addressed by glyph
 * id (`Identity-H`), with a `ToUnicode` map so a reader can copy and search it
 * — the WinAnsi Helvetica of the report export cannot print ğ, ı, İ, ş.
 */
import { deflateSync } from 'node:zlib';
import {
  INVOICE_INFORMATIONAL_NOTICE,
  type InvoiceParty,
  type PaymentMethodId,
} from '@siyahtus/types';
import { invoiceFonts, type TrueTypeFont } from './ttf-font.js';

export interface InvoiceDocumentLine {
  description: string;
  amountCents: number;
}

/** Everything the PDF prints — the statement as issued. */
export interface InvoiceDocument {
  number: string;
  issuedAt: Date;
  /** `yyyymm`. */
  period: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  lineItems: InvoiceDocumentLine[];
  subtotalCents: number;
  totalCents: number;
  status: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  payment: { method: PaymentMethodId; reference: string | null } | null;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 70;

const PAYMENT_LABELS: Record<PaymentMethodId, string> = {
  swift_manual: 'Banka havalesi (SWIFT) / Bank transfer (SWIFT)',
  crypto_manual: 'Kripto para (USDT) / Crypto (USDT)',
  stripe: 'Kart (Stripe) / Card (Stripe)',
};

/** `1,234.56` — fixed separators, so the bytes never depend on the host's locale. */
export function formatAmount(cents: number, currency: string): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency.toUpperCase()} ${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** `2026-10-31`, UTC. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One embedded face and the glyphs this document used from it. */
class FontUse {
  readonly used = new Map<number, number>();

  constructor(
    readonly font: TrueTypeFont,
    readonly key: string,
  ) {}

  #glyph(codePoint: number): number {
    const glyph = this.font.glyphFor(codePoint);
    if (glyph !== 0) {
      if (!this.used.has(glyph)) this.used.set(glyph, codePoint);
      return glyph;
    }
    // No glyph: a question mark rather than an invisible hole.
    const fallback = this.font.glyphFor(0x3f);
    if (!this.used.has(fallback)) this.used.set(fallback, 0x3f);
    return fallback;
  }

  /** The text as a hex string of glyph ids. */
  encode(text: string): string {
    let hex = '';
    for (const char of text) {
      hex += this.#glyph(char.codePointAt(0) ?? 0x3f)
        .toString(16)
        .padStart(4, '0');
    }
    return `<${hex}>`;
  }

  width(text: string, size: number): number {
    let units = 0;
    for (const char of text) {
      const glyph = this.font.glyphFor(char.codePointAt(0) ?? 0x3f) || this.font.glyphFor(0x3f);
      units += this.font.advance(glyph);
    }
    return (units * size) / this.font.unitsPerEm;
  }
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Pages of drawing operators, with a cursor that opens a new page when one fills. */
class Layout {
  readonly pages: string[][] = [[]];
  y = PAGE_HEIGHT - MARGIN;

  constructor(
    readonly regular: FontUse,
    readonly bold: FontUse,
  ) {}

  get #ops(): string[] {
    return this.pages[this.pages.length - 1]!;
  }

  /** Make room for `height` points, starting a page if this one has less. */
  need(height: number): void {
    if (this.y - height >= BOTTOM) return;
    this.pages.push([]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  text(
    value: string,
    x: number,
    y: number,
    options: { size?: number; bold?: boolean; grey?: boolean; align?: 'left' | 'right' } = {},
  ): void {
    const size = options.size ?? 9;
    const face = options.bold ? this.bold : this.regular;
    const left = options.align === 'right' ? x - face.width(value, size) : x;
    const colour = options.grey ? '0.4 g' : '0 g';
    this.#ops.push(
      `BT ${colour} /${face.key} ${num(size)} Tf 1 0 0 1 ${num(left)} ${num(y)} Tm ${face.encode(value)} Tj ET`,
    );
  }

  rule(x1: number, x2: number, y: number, grey = 0.75): void {
    this.#ops.push(`${num(grey)} G 0.5 w ${num(x1)} ${num(y)} m ${num(x2)} ${num(y)} l S`);
  }

  box(x: number, y: number, width: number, height: number, grey: number): void {
    this.#ops.push(`${num(grey)} g ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f 0 g`);
  }

  /** Word-wrapped lines of `value` no wider than `width`. */
  wrap(value: string, width: number, size: number, bold = false): string[] {
    const face = bold ? this.bold : this.regular;
    const lines: string[] = [];
    let line = '';
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (face.width(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the column is cut, not allowed to overflow.
      let rest = word;
      while (face.width(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && face.width(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [''];
  }
}

/** The lines a party block prints, label first where the value needs one. */
function partyLines(party: InvoiceParty): { text: string; bold?: boolean; grey?: boolean }[] {
  const lines: { text: string; bold?: boolean; grey?: boolean }[] = [
    { text: party.legal_name, bold: true },
  ];
  for (const address of party.address_lines) lines.push({ text: address });
  if (party.country) lines.push({ text: `Ülke / Country: ${party.country}` });
  if (party.tax_office) lines.push({ text: `Vergi dairesi / Tax office: ${party.tax_office}` });
  if (party.tax_id) lines.push({ text: `Vergi no / Tax ID: ${party.tax_id}` });
  if (party.vat_id) lines.push({ text: `KDV no / VAT ID: ${party.vat_id}` });
  if (party.email) lines.push({ text: `E-posta / Email: ${party.email}` });
  // Each language on its own line, so a narrow column never splits one across two.
  if (party.placeholder) {
    lines.push({ text: 'Satıcı bilgileri henüz tanımlanmadı.', grey: true });
    lines.push({ text: 'Issuer details not set yet.', grey: true });
  }
  if (party.incomplete) {
    lines.push({ text: 'Fatura bilgileri girilmemişti.', grey: true });
    lines.push({ text: 'No billing details were on file.', grey: true });
  }
  return lines;
}

function drawDocument(layout: Layout, doc: InvoiceDocument): void {
  const right = MARGIN + CONTENT_WIDTH;

  layout.text('FATURA / INVOICE', MARGIN, layout.y - 18, { size: 18, bold: true });
  layout.text(`No: ${doc.number}`, right, layout.y - 18, { size: 12, bold: true, align: 'right' });
  layout.y -= 34;

  // The notice K24 requires, where nobody can miss it.
  layout.box(MARGIN, layout.y - 30, CONTENT_WIDTH, 30, 0.93);
  layout.text(INVOICE_INFORMATIONAL_NOTICE.tr, MARGIN + 8, layout.y - 12, { size: 9, bold: true });
  layout.text(INVOICE_INFORMATIONAL_NOTICE.en, MARGIN + 8, layout.y - 24, { size: 8 });
  layout.y -= 46;

  const period = `${doc.period.slice(0, 4)}-${doc.period.slice(4, 6)}`;
  const lastDay = new Date(doc.periodEnd.getTime() - 1);
  layout.text(`Düzenleme tarihi / Issue date: ${isoDate(doc.issuedAt)}`, MARGIN, layout.y);
  layout.text(
    `Dönem / Period: ${period} (${isoDate(doc.periodStart)} – ${isoDate(lastDay)})`,
    right,
    layout.y,
    { align: 'right' },
  );
  layout.y -= 26;

  // Seller and buyer side by side.
  const column = CONTENT_WIDTH / 2 - 10;
  const top = layout.y;
  const sides: [string, InvoiceParty, number][] = [
    ['SATICI / SELLER', doc.seller, MARGIN],
    ['ALICI / BILL TO', doc.buyer, MARGIN + CONTENT_WIDTH / 2 + 10],
  ];
  let lowest = top;
  for (const [heading, party, x] of sides) {
    let y = top;
    layout.text(heading, x, y, { size: 8, bold: true, grey: true });
    y -= 14;
    for (const line of partyLines(party)) {
      const size = line.bold ? 10 : 9;
      for (const wrapped of layout.wrap(line.text, column, size, line.bold)) {
        layout.text(wrapped, x, y, {
          size,
          ...(line.bold ? { bold: true } : {}),
          ...(line.grey ? { grey: true } : {}),
        });
        y -= size + 3;
      }
    }
    lowest = Math.min(lowest, y);
  }
  layout.y = lowest - 16;

  // Lines.
  layout.need(40);
  layout.text('Açıklama / Description', MARGIN, layout.y, { size: 8, bold: true, grey: true });
  layout.text('Tutar / Amount', right, layout.y, {
    size: 8,
    bold: true,
    grey: true,
    align: 'right',
  });
  layout.y -= 6;
  layout.rule(MARGIN, right, layout.y);
  layout.y -= 14;
  for (const item of doc.lineItems) {
    const wrapped = layout.wrap(item.description, CONTENT_WIDTH - 120, 9);
    layout.need(wrapped.length * 12 + 4);
    layout.text(formatAmount(item.amountCents, doc.currency), right, layout.y, { align: 'right' });
    for (const line of wrapped) {
      layout.text(line, MARGIN, layout.y);
      layout.y -= 12;
    }
    layout.y -= 4;
  }
  layout.rule(MARGIN, right, layout.y + 6);
  layout.y -= 10;

  layout.need(40);
  layout.text('Ara toplam / Subtotal', right - 130, layout.y, { align: 'right' });
  layout.text(formatAmount(doc.subtotalCents, doc.currency), right, layout.y, { align: 'right' });
  layout.y -= 16;
  layout.text('Toplam / Total', right - 130, layout.y, { size: 11, bold: true, align: 'right' });
  layout.text(formatAmount(doc.totalCents, doc.currency), right, layout.y, {
    size: 11,
    bold: true,
    align: 'right',
  });
  layout.y -= 28;

  // How it was paid (K16).
  layout.need(40);
  layout.text('ÖDEME / PAYMENT', MARGIN, layout.y, { size: 8, bold: true, grey: true });
  layout.y -= 14;
  if (doc.payment) {
    layout.text(`Yöntem / Method: ${PAYMENT_LABELS[doc.payment.method]}`, MARGIN, layout.y);
    layout.y -= 12;
    if (doc.payment.reference) {
      for (const line of layout.wrap(
        `Referans / Reference: ${doc.payment.reference}`,
        CONTENT_WIDTH,
        9,
      )) {
        layout.text(line, MARGIN, layout.y);
        layout.y -= 12;
      }
    }
  } else {
    layout.text(
      doc.status === 'trial' || doc.totalCents === 0
        ? 'Ödenecek tutar yok. / Nothing was due.'
        : 'Bu dönem için kayıtlı ödeme yok. / No payment is recorded for this period.',
      MARGIN,
      layout.y,
      { grey: true },
    );
    layout.y -= 12;
  }

  // The tax wording of the issuer's country — a template field until that is decided.
  if (doc.seller.tax_note) {
    layout.y -= 10;
    for (const line of layout.wrap(doc.seller.tax_note, CONTENT_WIDTH, 8)) {
      layout.need(12);
      layout.text(line, MARGIN, layout.y, { size: 8, grey: true });
      layout.y -= 11;
    }
  }
}

function footer(layout: Layout, doc: InvoiceDocument): void {
  const total = layout.pages.length;
  layout.pages.forEach((ops, index) => {
    const line = `${doc.number} · ${INVOICE_INFORMATIONAL_NOTICE.tr} · ${index + 1}/${total}`;
    const face = layout.regular;
    ops.push(`BT 0.4 g /${face.key} 7 Tf 1 0 0 1 ${num(MARGIN)} 40 Tm ${face.encode(line)} Tj ET`);
  });
}

/** A PDF text string for the Info dictionary: UTF-16BE with its byte-order mark. */
function utf16(value: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i += 1) {
    hex += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

function pdfDate(date: Date): string {
  const iso = date.toISOString();
  return `(D:${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z)`;
}

function toUnicodeCmap(use: FontUse): string {
  const entries = [...use.used.entries()].sort((a, b) => a[0] - b[0]);
  const hex = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk.map(([g, cp]) => `<${hex(g)}> <${hex(cp)}>`).join('\n')}\nendbfchar`,
    );
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

function widthsArray(use: FontUse): string {
  const scale = 1000 / use.font.unitsPerEm;
  const glyphs = [...use.used.keys()].sort((a, b) => a - b);
  return `[${glyphs.map((g) => `${g} [${Math.round(use.font.advance(g) * scale)}]`).join(' ')}]`;
}

/** Render the statement. Pure: the same document gives the same bytes. */
export function renderInvoicePdf(doc: InvoiceDocument): Buffer {
  const fonts = invoiceFonts();
  const regular = new FontUse(fonts.regular, 'F1');
  const bold = new FontUse(fonts.bold, 'F2');
  const layout = new Layout(regular, bold);
  drawDocument(layout, doc);
  footer(layout, doc);

  // Object numbers: 1 catalog, 2 pages, 3 info, then 5 per font, then 2 per page.
  const objects: (Buffer | string)[] = [];
  const fontBase = 4;
  const pageBase = fontBase + 10;
  const pageRefs = layout.pages.map((_, i) => `${pageBase + i * 2} 0 R`);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${layout.pages.length} >>`;
  objects[3] =
    `<< /Title ${utf16(`Fatura / Invoice ${doc.number}`)} /Producer ${utf16('SiyahTuş')}` +
    ` /CreationDate ${pdfDate(doc.issuedAt)} /ModDate ${pdfDate(doc.issuedAt)} >>`;

  [regular, bold].forEach((use, index) => {
    const at = fontBase + index * 5;
    const font = use.font;
    const scale = 1000 / font.unitsPerEm;
    const file = deflateSync(font.bytes);
    objects[at] =
      `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H` +
      ` /DescendantFonts [${at + 1} 0 R] /ToUnicode ${at + 4} 0 R >>`;
    objects[at + 1] =
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name}` +
      ` /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>` +
      ` /FontDescriptor ${at + 2} 0 R /CIDToGIDMap /Identity /DW 1000 /W ${widthsArray(use)} >>`;
    objects[at + 2] =
      `<< /Type /FontDescriptor /FontName /${font.name} /Flags 32` +
      ` /FontBBox [${font.bbox.map((v) => Math.round(v * scale)).join(' ')}]` +
      ` /ItalicAngle ${font.italicAngle} /Ascent ${Math.round(font.ascent * scale)}` +
      ` /Descent ${Math.round(font.descent * scale)} /CapHeight ${Math.round(font.capHeight * scale)}` +
      ` /StemV ${index === 0 ? 80 : 140} /FontFile2 ${at + 3} 0 R >>`;
    objects[at + 3] = Buffer.concat([
      Buffer.from(
        `<< /Length ${file.length} /Length1 ${font.bytes.length} /Filter /FlateDecode >>\nstream\n`,
        'latin1',
      ),
      file,
      Buffer.from('\nendstream', 'latin1'),
    ]);
    const cmap = deflateSync(Buffer.from(toUnicodeCmap(use), 'latin1'));
    objects[at + 4] = Buffer.concat([
      Buffer.from(`<< /Length ${cmap.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      cmap,
      Buffer.from('\nendstream', 'latin1'),
    ]);
  });

  layout.pages.forEach((ops, i) => {
    const pageAt = pageBase + i * 2;
    const content = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
    objects[pageAt] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}]` +
      ` /Resources << /Font << /F1 ${fontBase} 0 R /F2 ${fontBase + 5} 0 R >> >>` +
      ` /Contents ${pageAt + 1} 0 R >>`;
    objects[pageAt + 1] = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream', 'latin1'),
    ]);
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n += 1) {
    const body = objects[n]!;
    const chunk = Buffer.concat([
      Buffer.from(`${n} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    offsets[n] = offset;
    offset += chunk.length;
    chunks.push(chunk);
  }
  const xref = [
    'xref',
    `0 ${objects.length}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length} /Root 1 0 R /Info 3 0 R >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
