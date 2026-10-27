/**
 * Small, real document files built in memory (tm 313 · AI-18) — so the
 * fixtures are readable code rather than opaque binaries in the tree, and a
 * test can make exactly the file it is about (a PDF with an EICAR string in
 * it, a DOCX with a VBA project, a ZIP that is a spreadsheet).
 *
 * `pdf` writes a valid PDF 1.4 — one page per string, Helvetica text, a
 * correct cross-reference table — that a real reader opens. `zip` writes
 * stored (uncompressed) entries with correct CRCs; `docx` builds the three
 * parts a Word document needs on it.
 */
import { createHash } from 'node:crypto';
import { constants, crc32, deflateRawSync } from 'node:zlib';

/** A PDF whose page `n` shows `pages[n]`. Parentheses and backslashes are escaped. */
export function pdf(pages: readonly string[], options: { trailer?: string } = {}): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, index) => {
    const pageId = pageIds[index]!;
    const escaped = text.replace(/[\\()]/g, (c) => `\\${c}`);
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  if (options.trailer) body += options.trailer;
  return Buffer.from(body, 'latin1');
}

export interface ZipEntry {
  name: string;
  data: string | Buffer;
  /** Deflate the entry (method 8) instead of storing it. */
  deflate?: boolean;
  /** The uncompressed size to declare instead of the true one — how a bomb lies about itself. */
  declaredSize?: number;
}

/** A ZIP of stored (or deflated) entries, local headers then the central directory then the end record. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(raw);
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const method = entry.deflate ? 8 : 0;
    const size = entry.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/** The parts of a Word document whose body is `paragraphs`, one `<w:p>` each — plus `extra` entries. */
export function docxEntries(
  paragraphs: readonly string[],
  extra: readonly ZipEntry[] = [],
): ZipEntry[] {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`)
    .join('');
  return [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    {
      name: 'word/document.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`,
    },
    ...extra,
  ];
}

/** A Word document whose body is `paragraphs`. */
export function docx(paragraphs: readonly string[]): Buffer {
  return zip(docxEntries(paragraphs));
}

/** A Word document carrying a VBA project — what Word saves as `.docm`. */
export function docm(paragraphs: readonly string[]): Buffer {
  return zip(
    docxEntries(paragraphs, [{ name: 'word/vbaProject.bin', data: Buffer.from([0xcc, 0x61]) }]),
  );
}

/** The start of a Windows executable — what "rename setup.exe to terms.pdf" uploads. */
export const EXE = Buffer.concat([
  Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff', 'latin1'),
  Buffer.alloc(64, 0),
  Buffer.from('This program cannot be run in DOS mode.', 'latin1'),
]);

// ---------------------------------------------------------------------------
// The worker's fixtures (tm 313.2): PDFs laid out line by line, encrypted, made
// of images, carrying JavaScript or inflating without end; Word documents with
// styles, lists, tables and tracked changes.

/** One line of a PDF page, in Helvetica: `size` points, at (`x`, `y`) from the bottom left. */
export interface PdfLine {
  text: string;
  size?: number;
  x?: number;
  y: number;
}

/** A content stream that shows `lines`. Parentheses and backslashes are escaped. */
export function pdfText(lines: readonly PdfLine[]): string {
  return lines
    .map(({ text, size = 12, x = 72, y }) => {
      const escaped = text.replace(/[\\()]/g, (c) => `\\${c}`);
      return `BT /F1 ${size} Tf ${x} ${y} Td (${escaped}) Tj ET`;
    })
    .join('\n');
}

export interface PdfPage {
  /** The content stream: operators, or bytes already encoded with `filter`. */
  content: string | { bytes: Buffer; filter: string };
  /** An image the content may draw as `/Im1`: raw RGB samples, which no text reader decodes. */
  image?: { width: number; height: number; rgb: Buffer };
  /** More entries for the page dictionary (an `/AA` action, say). */
  extra?: string;
}

export interface PdfOptions {
  /** More entries for the catalog (an `/OpenAction`, a `/Names` tree). */
  catalog?: string;
  /** Encrypt with the standard security handler, revision 2 (RC4, 40-bit key). */
  encrypt?: { userPassword: string; ownerPassword: string };
}

/** The standard security handler's password padding (ISO 32000-1, 7.6.3.3). */
const PASSWORD_PAD = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest();
const padPassword = (password: string) =>
  Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PAD]).subarray(0, 32);

/**
 * A PDF of `pages`, object by object, with a correct cross-reference table.
 * Encrypted, it is a real revision-2 file — O, U and every stream computed as
 * the standard prescribes — that pdf.js opens with the user password (or
 * none, when that is empty) and refuses otherwise.
 */
export function pdfDocument(pages: readonly PdfPage[], options: PdfOptions = {}): Buffer {
  const objects: { dict: string; stream?: Buffer }[] = [];
  const reserve = () => objects.push({ dict: '' });
  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = reserve();
  objects[fontId - 1] = {
    dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  };
  const pageIds = pages.map((page) => {
    const pageId = reserve();
    const contentId = reserve();
    const content =
      typeof page.content === 'string'
        ? { bytes: Buffer.from(page.content, 'latin1'), filter: '' }
        : page.content;
    objects[contentId - 1] = {
      dict: content.filter ? `<< /Filter ${content.filter} >>` : '<< >>',
      stream: content.bytes,
    };
    let xobject = '';
    if (page.image) {
      const imageId = reserve();
      objects[imageId - 1] = {
        dict:
          `<< /Type /XObject /Subtype /Image /Width ${page.image.width} ` +
          `/Height ${page.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 >>`,
        stream: page.image.rgb,
      };
      xobject = ` /XObject << /Im1 ${imageId} 0 R >>`;
    }
    objects[pageId - 1] = {
      dict:
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >>${xobject} >> /Contents ${contentId} 0 R` +
        `${page.extra ? ` ${page.extra}` : ''} >>`,
    };
    return pageId;
  });
  objects[pagesId - 1] = {
    dict: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  };
  objects[catalogId - 1] = {
    dict: `<< /Type /Catalog /Pages ${pagesId} 0 R${options.catalog ? ` ${options.catalog}` : ''} >>`,
  };

  let trailerExtra = '';
  if (options.encrypt) {
    const { userPassword, ownerPassword } = options.encrypt;
    const id = Buffer.from('5349594148545553444f43554d454e54', 'hex');
    const permissions = Buffer.alloc(4);
    permissions.writeInt32LE(-44);
    const owner = rc4(
      md5(padPassword(ownerPassword || userPassword)).subarray(0, 5),
      padPassword(userPassword),
    );
    const key = md5(padPassword(userPassword), owner, permissions, id).subarray(0, 5);
    const user = rc4(key, PASSWORD_PAD);
    objects.forEach((object, index) => {
      if (!object.stream) return;
      const number = Buffer.alloc(5);
      number.writeUIntLE(index + 1, 0, 3); // object number, then generation 0
      object.stream = rc4(md5(key, number).subarray(0, 10), object.stream);
    });
    const encryptId = reserve();
    objects[encryptId - 1] = {
      dict:
        `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> ` +
        `/U <${user.toString('hex')}> /P -44 >>`,
    };
    trailerExtra = ` /Encrypt ${encryptId} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]`;
  }

  const chunks: Buffer[] = [
    Buffer.from('%PDF-1.4\n%', 'latin1'),
    Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  ];
  let length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const push = (chunk: Buffer) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    if (object.stream) {
      const dict = `${object.dict.slice(0, -2)}/Length ${object.stream.length} >>`;
      push(Buffer.from(`${index + 1} 0 obj\n${dict}\nstream\n`, 'latin1'));
      push(object.stream);
      push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else {
      push(Buffer.from(`${index + 1} 0 obj\n${object.dict}\nendobj\n`, 'latin1'));
    }
  });
  const xref = length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.length; id += 1) {
    table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  table +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${trailerExtra} >>\n` +
    `startxref\n${xref}\n%%EOF\n`;
  push(Buffer.from(table, 'latin1'));
  return Buffer.concat(chunks);
}

/** A PDF whose page `n` shows the lines `pages[n]`. */
export function linesPdf(pages: readonly (readonly PdfLine[])[], options: PdfOptions = {}): Buffer {
  return pdfDocument(
    pages.map((lines) => ({ content: pdfText(lines) })),
    options,
  );
}

/** A scanned page: an image and not one character of text. */
export function imagePage(): PdfPage {
  return {
    content: 'q 200 0 0 200 72 500 cm /Im1 Do Q',
    image: { width: 4, height: 4, rgb: Buffer.alloc(4 * 4 * 3, 0x80) },
  };
}

function adler32(parts: readonly { byte?: number; bytes?: Buffer; count?: number }[]): Buffer {
  const MOD = 65521n;
  let a = 1n;
  let b = 0n;
  for (const part of parts) {
    if (part.bytes) {
      for (const byte of part.bytes) {
        a = (a + BigInt(byte)) % MOD;
        b = (b + a) % MOD;
      }
    } else {
      // `count` copies of one byte, summed in closed form.
      const n = BigInt(part.count!);
      const v = BigInt(part.byte!);
      b = (b + n * a + (v * n * (n + 1n)) / 2n) % MOD;
      a = (a + n * v) % MOD;
    }
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE(Number((b << 16n) | a));
  return out;
}

/**
 * A FlateDecode content stream that inflates to `mebibytes` MiB — a line of
 * text, then spaces — from a few hundred bytes per MiB: one compressed MiB
 * repeated, each copy ending on a sync flush so the copies chain into one
 * valid stream. A compression bomb in the form a text reader must inflate.
 */
export function inflatingContent(mebibytes: number): { bytes: Buffer; filter: string } {
  const head = Buffer.from('BT /F1 12 Tf 72 720 Td (Inflating) Tj ET\n', 'latin1');
  const flush = { finishFlush: constants.Z_SYNC_FLUSH };
  const mebibyte = deflateRawSync(Buffer.alloc(1024 * 1024, 0x20), flush);
  return {
    bytes: Buffer.concat([
      Buffer.from([0x78, 0x9c]),
      deflateRawSync(head, flush),
      ...Array.from({ length: mebibytes }, () => mebibyte),
      deflateRawSync(Buffer.alloc(0)),
      adler32([{ bytes: head }, { byte: 0x20, count: mebibytes * 1024 * 1024 }]),
    ]),
    filter: '/FlateDecode',
  };
}

const W_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xmlEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface WordParagraphProps {
  style?: string;
  numId?: number;
  ilvl?: number;
}

/** A `<w:p>` showing `text` in one run. */
export function wParagraph(text: string, props: WordParagraphProps = {}): string {
  const style = props.style ? `<w:pStyle w:val="${props.style}"/>` : '';
  const numPr =
    props.numId !== undefined
      ? `<w:numPr><w:ilvl w:val="${props.ilvl ?? 0}"/><w:numId w:val="${props.numId}"/></w:numPr>`
      : '';
  const pPr = style || numPr ? `<w:pPr>${style}${numPr}</w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

/** A `<w:tbl>` of `rows`, one paragraph per cell. */
export function wTable(rows: readonly (readonly string[])[]): string {
  const cells = (row: readonly string[]) =>
    row.map((cell) => `<w:tc><w:tcPr/>${wParagraph(cell)}</w:tc>`).join('');
  return `<w:tbl><w:tblPr/><w:tblGrid/>${rows.map((row) => `<w:tr>${cells(row)}</w:tr>`).join('')}</w:tbl>`;
}

export interface WordStyle {
  id: string;
  name: string;
  basedOn?: string;
  outlineLevel?: number;
}

/** A `styles.xml` defining these paragraph styles. */
export function wStyles(styles: readonly WordStyle[]): string {
  const body = styles
    .map(
      (style) =>
        `<w:style w:type="paragraph" w:styleId="${style.id}"><w:name w:val="${style.name}"/>` +
        (style.basedOn ? `<w:basedOn w:val="${style.basedOn}"/>` : '') +
        (style.outlineLevel !== undefined
          ? `<w:pPr><w:outlineLvl w:val="${style.outlineLevel}"/></w:pPr>`
          : '') +
        '</w:style>',
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NAMESPACE}">${body}</w:styles>`;
}

export interface WordList {
  numId: number;
  /** `numFmt` per level: `decimal`, `lowerLetter`, `bullet`… */
  formats: readonly string[];
  start?: number;
}

/** A `numbering.xml` defining these lists, each on its own abstract definition. */
export function wNumbering(lists: readonly WordList[]): string {
  const abstracts = lists
    .map(
      (list) =>
        `<w:abstractNum w:abstractNumId="${list.numId}">` +
        list.formats
          .map(
            (format, ilvl) =>
              `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${list.start ?? 1}"/><w:numFmt w:val="${format}"/></w:lvl>`,
          )
          .join('') +
        '</w:abstractNum>',
    )
    .join('');
  const nums = lists
    .map(
      (list) => `<w:num w:numId="${list.numId}"><w:abstractNumId w:val="${list.numId}"/></w:num>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NAMESPACE}">${abstracts}${nums}</w:numbering>`;
}

export interface WordParts {
  /** The inside of `<w:body>`. */
  body: string;
  styles?: string;
  numbering?: string;
  /** More package entries (a header part, a macro project). */
  extra?: readonly ZipEntry[];
  /** Deflate every part, as Word does (default); `false` stores them. */
  deflate?: boolean;
}

/** A Word document made of these parts. */
export function wordDocument(parts: WordParts): Buffer {
  const deflate = parts.deflate ?? true;
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NAMESPACE}" ` +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    `<w:body>${parts.body}</w:body></w:document>`;
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES, deflate },
    { name: '_rels/.rels', data: ROOT_RELS, deflate },
    { name: 'word/document.xml', data: document, deflate },
  ];
  if (parts.styles) entries.push({ name: 'word/styles.xml', data: parts.styles, deflate });
  if (parts.numbering) entries.push({ name: 'word/numbering.xml', data: parts.numbering, deflate });
  return zip([...entries, ...(parts.extra ?? [])]);
}
