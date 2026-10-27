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
import { crc32 } from 'node:zlib';

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
}

/** A ZIP of stored entries, local headers then the central directory then the end record. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
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
