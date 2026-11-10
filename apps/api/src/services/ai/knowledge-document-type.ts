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
 *   located from the end record and walked entry by entry — names only, by
 *   `readZipDirectory`, the same walk the worker's DOCX reader starts from
 *   (tm 313.2), so the check and the reader cannot disagree about which
 *   entries the archive holds. It must list `[Content_Types].xml` and `word/document.xml` (OPC part names
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
import { readZipDirectory } from './document-parse/zip.js';

/** The verdict, with the reason a refusal is logged under (never shown: the caller sees `unsupported_type`). */
export type KnowledgeDocumentType =
  | { ok: true; mime: KnowledgeDocumentMimeType }
  | {
      ok: false;
      why: 'not_pdf_or_zip' | 'zip_unreadable' | 'zip_unsupported' | 'not_word' | 'macro_enabled';
    };

const LOCAL_FILE_HEADER = 0x04034b50;

/** A VBA project — what makes a `.docm` (or a `.docx` renamed from one) run macros. */
const MACRO_PART = /(^|\/)vbaproject\.bin$/;

export function identifyKnowledgeDocument(bytes: Buffer): KnowledgeDocumentType {
  if (isPdf(bytes)) return { ok: true, mime: KNOWLEDGE_DOCUMENT_PDF };
  const office = readOfficePackage(bytes);
  if (!office.ok) {
    if (office.why === 'not_zip') return { ok: false, why: 'not_pdf_or_zip' };
    return { ok: false, why: office.why === 'not_office' ? 'not_word' : office.why };
  }
  if (!office.parts.has('word/document.xml')) return { ok: false, why: 'not_word' };
  return { ok: true, mime: KNOWLEDGE_DOCUMENT_DOCX };
}

/**
 * An Office Open XML package's part names, read from its central directory —
 * lower-cased, as OPC compares them — or why it is not one this API takes.
 * The walk a DOCX is read with above; an attachment granted as a Word, Excel
 * or PowerPoint file is held to the same one (`content-sniff.ts`, tm 446), so
 * the knowledge base and a conversation cannot disagree about what such a file
 * is. No name may appear twice and no part may be a VBA project, and
 * `[Content_Types].xml` must be listed; which main part the package must
 * carry is the caller's question.
 */
export type OfficePackage =
  | { ok: true; parts: ReadonlySet<string> }
  | {
      ok: false;
      why: 'not_zip' | 'zip_unreadable' | 'zip_unsupported' | 'not_office' | 'macro_enabled';
    };

export function readOfficePackage(bytes: Buffer): OfficePackage {
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    return { ok: false, why: 'not_zip' };
  }

  const directory = readZipDirectory(bytes);
  if (!directory.ok) return { ok: false, why: `zip_${directory.why}` };

  const seen = new Set<string>();
  for (const entry of directory.entries) {
    const name = entry.name.toLowerCase();
    if (seen.has(name)) return { ok: false, why: 'zip_unreadable' };
    seen.add(name);
    if (MACRO_PART.test(name)) return { ok: false, why: 'macro_enabled' };
  }
  if (!seen.has('[content_types].xml')) return { ok: false, why: 'not_office' };
  return { ok: true, parts: seen };
}

/** `%PDF-` and a version digit at offset 0 — the knowledge base's PDF rule, and an attachment's (tm 446). */
export function isPdf(bytes: Buffer): boolean {
  if (bytes.length < 8) return false;
  if (bytes.toString('latin1', 0, 5) !== '%PDF-') return false;
  const version = bytes[5]!;
  return version >= 0x30 && version <= 0x39;
}
