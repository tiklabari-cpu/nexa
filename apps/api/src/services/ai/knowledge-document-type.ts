/**
 * What a knowledge document's bytes are (tm 313.1 · SiyahTuş analysis AI-18).
 *
 * The type is read from the bytes — never from a filename, and never from the
 * type a caller declared, which is only checked against this answer. A
 * renamed executable, a ZIP that is not a Word document and a `.docm` with a
 * macro project are all `unsupported_type` before anything is stored.
 *
 * **This reads headers, it does not parse documents.** Parsing a PDF or a
 * DOCX is what the isolated worker does (`document-parse/`, tm 313.2), outside
 * the API process. What runs here is pure, has no dependency, decompresses
 * nothing and touches only fixed-size records at offsets it checks against
 * the buffer first:
 *
 * - **PDF:** `%PDF-` and a version digit at offset 0. Not "somewhere in the
 *   first kilobyte", as some readers allow: an executable carrying a PDF
 *   header a little way in is exactly the file this exists to refuse.
 * - **DOCX:** a ZIP local file header at offset 0, then the central directory
 *   located from the end record and walked entry by entry — names only. It
 *   must list `[Content_Types].xml` and `word/document.xml` (OPC part names
 *   compare case-insensitively) and no VBA project; no name may appear twice,
 *   which is how one archive shows two readers two different documents.
 *   Multi-disk and ZIP64 archives are refused: no Word document under the
 *   20 MiB ceiling needs either.
 */
import {
  KNOWLEDGE_DOCUMENT_DOCX,
  KNOWLEDGE_DOCUMENT_PDF,
  type KnowledgeDocumentMimeType,
} from '@siyahtus/types';

/** The verdict, with the reason a refusal is logged under (never shown: the caller sees `unsupported_type`). */
export type KnowledgeDocumentType =
  | { ok: true; mime: KnowledgeDocumentMimeType }
  | {
      ok: false;
      why: 'not_pdf_or_zip' | 'zip_unreadable' | 'zip_unsupported' | 'not_word' | 'macro_enabled';
    };

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** The end record's fixed part; a comment of up to 65535 bytes may follow it. */
const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;

/** A VBA project — what makes a `.docm` (or a `.docx` renamed from one) run macros. */
const MACRO_PART = /(^|\/)vbaproject\.bin$/;

export function identifyKnowledgeDocument(bytes: Buffer): KnowledgeDocumentType {
  if (isPdf(bytes)) return { ok: true, mime: KNOWLEDGE_DOCUMENT_PDF };
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    return { ok: false, why: 'not_pdf_or_zip' };
  }

  const names = centralDirectoryNames(bytes);
  if (names === 'unreadable') return { ok: false, why: 'zip_unreadable' };
  if (names === 'unsupported') return { ok: false, why: 'zip_unsupported' };

  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.toLowerCase();
    if (seen.has(name)) return { ok: false, why: 'zip_unreadable' };
    seen.add(name);
    if (MACRO_PART.test(name)) return { ok: false, why: 'macro_enabled' };
  }
  if (!seen.has('[content_types].xml') || !seen.has('word/document.xml')) {
    return { ok: false, why: 'not_word' };
  }
  return { ok: true, mime: KNOWLEDGE_DOCUMENT_DOCX };
}

function isPdf(bytes: Buffer): boolean {
  if (bytes.length < 8) return false;
  if (bytes.toString('latin1', 0, 5) !== '%PDF-') return false;
  const version = bytes[5]!;
  return version >= 0x30 && version <= 0x39;
}

/**
 * The entry names the central directory lists, in order — or why it cannot
 * be read. Every offset is checked against the buffer before it is read.
 */
function centralDirectoryNames(bytes: Buffer): string[] | 'unreadable' | 'unsupported' {
  const eocd = findEndRecord(bytes);
  if (eocd === null) return 'unreadable';

  const disk = bytes.readUInt16LE(eocd + 4);
  const directoryDisk = bytes.readUInt16LE(eocd + 6);
  const entriesHere = bytes.readUInt16LE(eocd + 8);
  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);

  if (disk !== 0 || directoryDisk !== 0 || entriesHere !== entries) return 'unsupported';
  // ZIP64 says so with saturated fields.
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return 'unsupported';
  }
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd > eocd) return 'unreadable';

  const names: string[] = [];
  let at = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (at + CENTRAL_HEADER_SIZE > directoryEnd) return 'unreadable';
    if (bytes.readUInt32LE(at) !== CENTRAL_FILE_HEADER) return 'unreadable';
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const nameStart = at + CENTRAL_HEADER_SIZE;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > directoryEnd) return 'unreadable';
    names.push(bytes.toString('utf8', nameStart, nameStart + nameLength));
    at = next;
  }
  return names;
}

/**
 * The offset of the end-of-central-directory record: searched backwards over
 * the last 22 + 65535 bytes (the record plus the longest comment), and taken
 * only when its comment ends exactly at the end of the file — a candidate
 * that leaves bytes over is a signature inside the comment, not the record.
 */
function findEndRecord(bytes: Buffer): number | null {
  const last = bytes.length - EOCD_SIZE;
  const first = Math.max(0, last - 0xffff);
  for (let at = last; at >= first; at -= 1) {
    if (bytes.readUInt32LE(at) !== END_OF_CENTRAL_DIRECTORY) continue;
    if (at + EOCD_SIZE + bytes.readUInt16LE(at + 20) === bytes.length) return at;
  }
  return null;
}
