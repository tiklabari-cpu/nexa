/**
 * A PDF read into blocks (tm 313.2 · AI-18), in this process — what the
 * worker process runs. Pages numbered, layout rebuilt, page furniture gone,
 * every refusal AI-18 names.
 */
import { describe, expect, it } from 'vitest';
import {
  imagePage,
  linesPdf,
  pdfDocument,
  pdfText,
  type PdfLine,
} from '../../../../test/helpers/document-fixtures.js';
import { parsePdf } from './pdf.js';
import { DocumentParseError, type DocumentBlock } from './types.js';

const limits = { maxPages: 300, maxChars: 1_000_000 };
const shape = (blocks: readonly DocumentBlock[]) =>
  blocks.map((b) => [b.kind, b.level ?? null, b.text, b.pageFrom]);

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DocumentParseError) return `${error.code}:${error.detail}`;
    throw error;
  }
  throw new Error('expected a refusal');
}

/** WinAnsi's bullet: what "•" is in a Helvetica content stream. */
const BULLET = String.fromCharCode(0x95);

/** A body of `count` distinct sentences, one per line, from `top` down. */
function body(page: number, count: number, top = 690): PdfLine[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `Line ${String.fromCharCode(97 + i)} of the body on this page tells the reader something.`,
    y: top - i * 40, // paragraph spacing: each line its own paragraph
  })).map((line) => ({ ...line, text: `${line.text} (${'xyz'[page % 3]})` }));
}

describe('parsePdf — layout', () => {
  it('numbers every block with its page, headings by size (FR-MOD-06.3.2)', async () => {
    const doc = await parsePdf(
      linesPdf([
        [
          { text: 'Bonus Terms', size: 20, y: 740 },
          { text: 'Wagering', size: 15, y: 710 },
          { text: 'A bonus must be wagered thirty times before a with-', y: 690 },
          { text: 'drawal. Free spins expire after seven days.', y: 676 },
          { text: 'Deposits made by card count in full toward the requirement.', y: 640 },
        ],
        [
          { text: 'Withdrawals', size: 15, y: 740 },
          { text: `${BULLET} Verified accounts only, never to a third party.`, y: 710 },
          { text: '2. Pending withdrawals may be reversed within 24 hours.', y: 696 },
          { text: 'Processing takes up to three business days in most cases.', y: 660 },
        ],
      ]),
      limits,
    );
    expect(doc.pageCount).toBe(2);
    expect(shape(doc.blocks)).toEqual([
      ['heading', 1, 'Bonus Terms', 1],
      ['heading', 2, 'Wagering', 1],
      [
        'paragraph',
        null,
        'A bonus must be wagered thirty times before a withdrawal. Free spins expire after seven days.',
        1,
      ],
      ['paragraph', null, 'Deposits made by card count in full toward the requirement.', 1],
      ['heading', 2, 'Withdrawals', 2],
      ['list_item', null, '- Verified accounts only, never to a third party.', 2],
      ['list_item', null, '2. Pending withdrawals may be reversed within 24 hours.', 2],
      ['paragraph', null, 'Processing takes up to three business days in most cases.', 2],
    ]);
    expect(doc.characterCount).toBe(doc.blocks.reduce((n, b) => n + b.text.length, 0));
  });

  it('writes a line split by wide gaps as a table row', async () => {
    const row = (y: number, cells: string[]) =>
      `BT /F1 11 Tf 72 ${y} Td ${cells.map((cell, i) => `${i === 0 ? '' : '150 0 Td '}(${cell}) Tj`).join(' ')} ET`;
    const doc = await parsePdf(
      pdfDocument([
        {
          content: [
            pdfText([
              { text: 'Deposit limits by plan, as of this year, for every market.', y: 740 },
            ]),
            row(700, ['Plan', 'Daily', 'Fee']),
            row(686, ['Gold', '5000 TRY', '0%']),
          ].join('\n'),
        },
      ]),
      limits,
    );
    expect(doc.blocks.map((b) => [b.kind, b.text])).toEqual([
      ['paragraph', 'Deposit limits by plan, as of this year, for every market.'],
      ['table_row', '| Plan | Daily | Fee |'],
      ['table_row', '| Gold | 5000 TRY | 0% |'],
    ]);
  });

  it('removes running headers and footers on 60%+ of the pages, keeping headings set at their top', async () => {
    const pages = [1, 2, 3, 4, 5].map((n) => [
      { text: 'ACME Gaming Ltd. Internal', size: 8, y: 770 },
      { text: `Article ${n}`, size: 16, y: 730 },
      ...body(n, 3),
      { text: `Page ${n} of 5`, size: 8, x: 280, y: 30 },
    ]);
    const doc = await parsePdf(linesPdf(pages), limits);
    const all = doc.blocks.map((b) => b.text).join('\n');
    expect(all).not.toContain('ACME Gaming');
    expect(all).not.toMatch(/Page \d of 5/);
    expect(doc.blocks.filter((b) => b.kind === 'heading').map((b) => [b.text, b.pageFrom])).toEqual(
      [
        ['Article 1', 1],
        ['Article 2', 2],
        ['Article 3', 3],
        ['Article 4', 4],
        ['Article 5', 5],
      ],
    );
    expect(doc.blocks.filter((b) => b.kind === 'paragraph')).toHaveLength(15);
  });
});

describe('parsePdf — refusals', () => {
  const text = [
    { text: 'This text is long enough to be a real text layer on a real page.', y: 700 },
  ];

  it('refuses a password-protected PDF as encrypted, and reads one restricted by an owner password only', async () => {
    const locked = linesPdf([text], {
      encrypt: { userPassword: 'secret', ownerPassword: 'owner' },
    });
    expect(await refusal(() => parsePdf(locked, limits))).toBe('encrypted:password_required');

    const restricted = linesPdf([text], { encrypt: { userPassword: '', ownerPassword: 'owner' } });
    expect(locked.includes(Buffer.from('real text layer'))).toBe(false); // the content is RC4'd
    const doc = await parsePdf(restricted, limits);
    expect(doc.blocks.map((b) => b.text)).toEqual([text[0]!.text]);
  });

  it('refuses a scan — images only, or images with a page number — as having no text layer', async () => {
    expect(await refusal(() => parsePdf(pdfDocument([imagePage(), imagePage()]), limits))).toBe(
      'no_text_layer:below_average',
    );
    const numbered = [1, 2, 3].map((n) => ({
      ...imagePage(),
      content: `${imagePage().content as string}\n${pdfText([{ text: `Scanned page ${n} of 3`, size: 8, y: 30 }])}`,
    }));
    expect(await refusal(() => parsePdf(pdfDocument(numbered), limits))).toBe(
      'no_text_layer:below_average',
    );
  });

  it('refuses more than 300 pages before reading one, and reads 300', async () => {
    const pages = (n: number) =>
      Array.from({ length: n }, (_, i) => [
        { text: `Page ${i + 1}: ${'words '.repeat(12)}`, y: 700 },
      ]);
    expect(await refusal(() => parsePdf(linesPdf(pages(301)), limits))).toBe(
      'too_many_pages:over_limit',
    );
    const doc = await parsePdf(linesPdf(pages(300)), limits);
    expect(doc.pageCount).toBe(300);
    expect(doc.blocks.at(-1)!.pageFrom).toBe(300);
  });

  it('refuses a document past the character ceiling', async () => {
    const doc = linesPdf([body(1, 10), body(2, 10)]);
    const within = await parsePdf(doc, limits);
    expect(
      await refusal(() => parsePdf(doc, { ...limits, maxChars: within.characterCount - 1 })),
    ).toBe('too_many_characters:over_limit');
  });

  it('reads a PDF carrying JavaScript as text, and runs none of it', async () => {
    const doc = await parsePdf(
      pdfDocument(
        [
          {
            content: pdfText(text),
            extra: '/AA << /O << /S /JavaScript /JS (app.alert\\("page open"\\);) >> >>',
          },
        ],
        {
          catalog:
            '/OpenAction << /S /JavaScript /JS (this.exportDataObject\\({cName: "x", nLaunch: 2}\\);) >> ' +
            '/Names << /JavaScript << /Names [(boot) << /S /JavaScript /JS (app.launchURL\\("https://evil.example"\\);) >>] >> >>',
        },
      ),
      limits,
    );
    expect(doc.blocks.map((b) => b.text)).toEqual([text[0]!.text]);
    expect(JSON.stringify(doc)).not.toMatch(/alert|launch|exportDataObject/);
  });

  it('refuses a damaged file', async () => {
    expect(await refusal(() => parsePdf(Buffer.from('%PDF-1.7\nnot really a pdf\n'), limits))).toBe(
      'parse_failed:pdf_unreadable',
    );
  });
});
