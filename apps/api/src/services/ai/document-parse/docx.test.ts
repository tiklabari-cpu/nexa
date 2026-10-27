/**
 * A Word document read into blocks (tm 313.2 · AI-18): headings, lists and
 * tables kept, tracked deletions, field codes, drawings and page furniture
 * dropped, pages numbered from Word's own layout, the ceilings held.
 */
import { describe, expect, it } from 'vitest';
import {
  wNumbering,
  wParagraph,
  wStyles,
  wTable,
  wordDocument,
  zip,
} from '../../../../test/helpers/document-fixtures.js';
import { parseDocx } from './docx.js';
import { DocumentParseError, type DocumentBlock } from './types.js';

const limits = { maxPages: 300, maxChars: 1_000_000 };
const read = (
  body: string,
  parts: { styles?: string; numbering?: string; deflate?: boolean } = {},
) => parseDocx(wordDocument({ body, ...parts }), limits);
const texts = (blocks: readonly DocumentBlock[]) => blocks.map((block) => block.text);

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DocumentParseError) return `${error.code}:${error.detail}`;
    throw error;
  }
  throw new Error('expected a refusal');
}

const STYLES = wStyles([
  { id: 'Normal', name: 'Normal' },
  { id: 'Title', name: 'Title' },
  // Turkish Word: the id is translated, the name is not.
  { id: 'Balk1', name: 'heading 1' },
  { id: 'Balk2', name: 'heading 2', basedOn: 'Balk1' },
  { id: 'PolicyHeading', name: 'Policy Heading', basedOn: 'Balk2' },
  { id: 'Outlined', name: 'Outlined', outlineLevel: 2 },
  { id: 'BodyText', name: 'Body Text', basedOn: 'Normal', outlineLevel: 9 },
  { id: 'TOC1', name: 'toc 1' },
]);

describe('parseDocx — structure', () => {
  it('reads headings from style names through basedOn, not from style ids (FR-MOD-06.3.2)', () => {
    const doc = read(
      wParagraph('Contents ........ 1', { style: 'TOC1' }) +
        wParagraph('Bonus Terms', { style: 'Title' }) +
        wParagraph('Withdrawals', { style: 'Balk1' }) +
        wParagraph('Limits', { style: 'Balk2' }) +
        wParagraph('Weekly limit', { style: 'PolicyHeading' }) +
        wParagraph('Outlined line', { style: 'Outlined' }) +
        wParagraph('Plain body text.', { style: 'BodyText' }),
      { styles: STYLES },
    );
    expect(doc.blocks.map((b) => [b.kind, b.level ?? null, b.text])).toEqual([
      ['heading', 1, 'Bonus Terms'],
      ['heading', 1, 'Withdrawals'],
      ['heading', 2, 'Limits'],
      ['heading', 2, 'Weekly limit'],
      ['heading', 3, 'Outlined line'],
      ['paragraph', null, 'Plain body text.'],
    ]);
  });

  it('falls back to the built-in style ids when the package has no styles part', () => {
    const doc = read(wParagraph('Section', { style: 'Heading2' }) + wParagraph('Body.'));
    expect(doc.blocks[0]).toMatchObject({ kind: 'heading', level: 2, text: 'Section' });
  });

  it('numbers list items the way Word does, bullets as "-"', () => {
    const numbering = wNumbering([
      { numId: 1, formats: ['decimal', 'lowerLetter', 'lowerRoman'], start: 3 },
      { numId: 2, formats: ['bullet'] },
    ]);
    const doc = read(
      wParagraph('Verify the account', { numId: 1 }) +
        wParagraph('ID document', { numId: 1, ilvl: 1 }) +
        wParagraph('Proof of address', { numId: 1, ilvl: 1 }) +
        wParagraph('Scanned', { numId: 1, ilvl: 2 }) +
        wParagraph('Approve', { numId: 1 }) +
        wParagraph('Then the deeper level starts over', { numId: 1, ilvl: 1 }) +
        wParagraph('A bullet', { numId: 2 }) +
        wParagraph('Not a list: numId 0', { numId: 0 }),
      { numbering },
    );
    expect(doc.blocks.map((b) => [b.kind, b.text])).toEqual([
      ['list_item', '3. Verify the account'],
      ['list_item', 'c. ID document'],
      ['list_item', 'd. Proof of address'],
      ['list_item', 'iii. Scanned'],
      ['list_item', '4. Approve'],
      ['list_item', 'c. Then the deeper level starts over'],
      ['list_item', '- A bullet'],
      ['paragraph', 'Not a list: numId 0'],
    ]);
  });

  it('writes each table row as "| a | b |" (FR-MOD-06.3.2)', () => {
    const nested = `<w:tbl><w:tr><w:tc>${wParagraph('inner A')}</w:tc><w:tc>${wParagraph('inner B')}</w:tc></w:tr></w:tbl>`;
    const doc = read(
      wParagraph('Deposit limits') +
        wTable([
          ['Plan', 'Daily limit', 'Fee'],
          ['Gold | VIP', '5 000 TRY', '0%'],
          ['', '', ''],
        ]) +
        `<w:tbl><w:tr><w:tc>${wParagraph('two')}${wParagraph('paragraphs')}</w:tc><w:tc>${nested}</w:tc></w:tr></w:tbl>` +
        wParagraph('After the table.'),
    );
    expect(doc.blocks.map((b) => [b.kind, b.text])).toEqual([
      ['paragraph', 'Deposit limits'],
      ['table_row', '| Plan | Daily limit | Fee |'],
      ['table_row', '| Gold \\| VIP | 5 000 TRY | 0% |'],
      ['table_row', '| two paragraphs | inner A inner B |'],
      ['paragraph', 'After the table.'],
    ]);
  });

  it('keeps runs, insertions, hyperlinks and field results; drops deletions, field codes and drawings', () => {
    const body =
      '<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r><w:r><w:tab/><w:t>world</w:t></w:r>' +
      '<w:r><w:noBreakHyphen/><w:t>wide</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Fee is </w:t></w:r>' +
      '<w:del w:id="1"><w:r><w:delText>10%</w:delText></w:r></w:del>' +
      // Not what Word writes, but what a generator could: a deletion is dropped whatever it holds.
      '<w:del w:id="4"><w:r><w:t>8%</w:t></w:r></w:del>' +
      '<w:ins w:id="2"><w:r><w:t>5%</w:t></w:r></w:ins>' +
      '<w:moveFrom w:id="3"><w:r><w:t>moved away</w:t></w:r></w:moveFrom></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> HYPERLINK "https://evil.example" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>the terms page</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:hyperlink><w:r><w:t> and help</w:t></w:r></w:hyperlink>' +
      '<w:fldSimple w:instr="PAGE"><w:r><w:t> (p. 4)</w:t></w:r></w:fldSimple></w:p>' +
      '<w:p><w:r><w:t>Logo:</w:t></w:r><w:r><w:drawing><wp:inline><w:txbxContent>' +
      '<w:p><w:r><w:t>text box words</w:t></w:r></w:p></w:txbxContent></wp:inline></w:drawing></w:r>' +
      '<mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:t> chosen</w:t></w:r></mc:Choice>' +
      '<mc:Fallback><w:r><w:t> fallback copy</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>' +
      '<w:p><w:pPr><w:pPrChange><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange></w:pPr>' +
      '<w:r><w:t>Not a heading any more</w:t></w:r></w:p>';
    expect(texts(read(body).blocks)).toEqual([
      'Hello world-wide',
      'Fee is 5%',
      'the terms page and help (p. 4)',
      'Logo: chosen',
      'Not a heading any more',
    ]);
  });

  it('never reads headers, footers or a macro project, and runs nothing', () => {
    const doc = parseDocx(
      wordDocument({
        body: wParagraph('The policy body.'),
        extra: [
          {
            name: 'word/header1.xml',
            data: `<w:hdr xmlns:w="x">${wParagraph('Running header')}</w:hdr>`,
          },
          { name: 'word/vbaProject.bin', data: Buffer.from([0xcc, 0x61, 0x00]) },
        ],
      }),
      limits,
    );
    expect(texts(doc.blocks)).toEqual(['The policy body.']);
  });
});

describe('parseDocx — pages', () => {
  it('numbers blocks from the layout Word last saved', () => {
    const doc = read(
      wParagraph('Page one.') +
        '<w:p><w:r><w:t>Starts on one,</w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t> ends on two.</w:t></w:r></w:p>' +
        // An explicit break Word also rendered: counted once, as a rendered break.
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
        '<w:p><w:r><w:lastRenderedPageBreak/><w:t>Page three.</w:t></w:r></w:p>',
    );
    expect(doc.blocks.map((b) => [b.text, b.pageFrom, b.pageTo])).toEqual([
      ['Page one.', 1, 1],
      ['Starts on one, ends on two.', 1, 2],
      ['Page three.', 3, 3],
    ]);
    expect(doc.pageCount).toBe(3);
  });

  it('numbers them from explicit breaks when Word never laid the file out', () => {
    const doc = read(
      wParagraph('One.') +
        '<w:p><w:r><w:t>Still one</w:t><w:br/><w:t>after a line break.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:br w:type="page"/><w:t>Two.</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Three.</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr><w:r><w:t>Three still.</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Three, ends a section.</w:t></w:r></w:p>' +
        wParagraph('Four.'),
    );
    expect(doc.blocks.map((b) => [b.text, b.pageFrom])).toEqual([
      ['One.', 1],
      ['Still one after a line break.', 1],
      ['Two.', 2],
      ['Three.', 3],
      ['Three still.', 3],
      ['Three, ends a section.', 3],
      ['Four.', 4],
    ]);
    expect(doc.pageCount).toBe(4);
  });
});

describe('parseDocx — refusals', () => {
  it('refuses more than 300 pages', () => {
    const breaks = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `<w:p><w:r><w:lastRenderedPageBreak/><w:t>Page ${i + 2}</w:t></w:r></w:p>`,
      ).join('');
    expect(read(wParagraph('Page 1') + breaks(299)).pageCount).toBe(300);
    expect(refusal(() => read(wParagraph('Page 1') + breaks(300)))).toBe(
      'too_many_pages:over_limit',
    );
  });

  it('refuses more than 1,000,000 characters, as soon as it passes them', () => {
    // Stored: a million of one letter deflates far past 100:1 and would be refused as a bomb.
    const stored = { deflate: false };
    expect(read(wParagraph('a'.repeat(1_000_000)), stored).characterCount).toBe(1_000_000);
    const over = wParagraph('a'.repeat(600_000)) + wParagraph('b'.repeat(400_001));
    expect(refusal(() => read(over, stored))).toBe('too_many_characters:over_limit');
  });

  it('refuses a document with no text as having no text layer', () => {
    expect(refusal(() => read('<w:p/><w:p><w:r><w:t>   </w:t></w:r></w:p>'))).toBe(
      'no_text_layer:no_text',
    );
  });

  it('refuses a compression bomb before inflating it, and a lying one while inflating', () => {
    const bomb = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: Buffer.alloc(50 * 1024 * 1024, 0x20), deflate: true },
    ]);
    expect(refusal(() => parseDocx(bomb, limits))).toBe('parse_failed:zip_ratio');

    const lying = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      {
        name: 'word/document.xml',
        data: Buffer.alloc(8 * 1024 * 1024, 0x20),
        deflate: true,
        declaredSize: 80 * 1024,
      },
    ]);
    expect(refusal(() => parseDocx(lying, limits))).toBe('parse_failed:zip_inflate');
  });

  it('refuses a body with a document type (no entity expansion) and a package with no body', () => {
    const xxe = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      {
        name: 'word/document.xml',
        data: '<!DOCTYPE w:document [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    expect(refusal(() => parseDocx(xxe, limits))).toBe('parse_failed:xml_doctype');
    expect(refusal(() => parseDocx(zip([{ name: 'a.xml', data: '<a/>' }]), limits))).toBe(
      'parse_failed:docx_no_body',
    );
  });
});
