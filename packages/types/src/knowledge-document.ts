/**
 * PDF and Word knowledge sources (tm 313 · SiyahTuş analysis AI-18) — the
 * vocabulary the upload (`POST /uploads` with `purpose: knowledge_document`),
 * the source (`POST /knowledge-sources/document`), the schema
 * (`20261112090000_knowledge_documents`) and the panel share.
 *
 * A document is not a `KNOWLEDGE_FILE_MIME_TYPES` text file. Those are parsed
 * inside the request by a pure function; a PDF or a DOCX is a parser with a
 * CVE history, so its bytes go to the object store first (under a key
 * `GET /uploads/{key}` never serves), and an isolated worker process reads
 * them in a `document` knowledge job (tm 313.2–313.3). The text path is
 * unchanged.
 *
 * Literals only: this module is part of the widget loader's import graph, and
 * a top-level call would land in its 8 KB budget.
 */

/** A PDF, recognised by its `%PDF-` header. */
export const KNOWLEDGE_DOCUMENT_PDF = 'application/pdf';

/** A Word document: a ZIP holding `word/document.xml` and no macro project (`.docm` is refused). */
export const KNOWLEDGE_DOCUMENT_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The types a knowledge document may be uploaded as. A declared type is only a
 * claim: the server reads the type from the bytes and refuses a file whose
 * bytes are not the type it was declared as (`unsupported_type`).
 */
export const KNOWLEDGE_DOCUMENT_MIME_TYPES = [
  KNOWLEDGE_DOCUMENT_PDF,
  KNOWLEDGE_DOCUMENT_DOCX,
] as const;

export type KnowledgeDocumentMimeType = (typeof KNOWLEDGE_DOCUMENT_MIME_TYPES)[number];

/**
 * A document's ceilings (AI-18-S1). `maxBytes` is checked when the upload is
 * granted, when its bytes arrive and when the source is created; `maxPages`
 * and `maxChars` by the worker that reads it, which refuses a document past
 * either rather than indexing a prefix of it.
 */
export const KNOWLEDGE_DOCUMENT_LIMITS = {
  /** 20 MiB of file. */
  maxBytes: 20 * 1024 * 1024,
  maxPages: 300,
  maxChars: 1_000_000,
} as const;

/** Filename extension → type, for a client that has to guess. Never consulted by the server. */
export const KNOWLEDGE_DOCUMENT_EXTENSIONS: Readonly<Record<string, KnowledgeDocumentMimeType>> = {
  '.pdf': KNOWLEDGE_DOCUMENT_PDF,
  '.docx': KNOWLEDGE_DOCUMENT_DOCX,
};

/**
 * Why a document was refused — a snake_case code the panel words:
 *
 * - `unsupported_type` — the bytes are neither a PDF nor a DOCX (a renamed
 *   executable, a `.docm` with macros, an encrypted Office file), or not the
 *   type they were declared as;
 * - `file_too_large` — past {@link KNOWLEDGE_DOCUMENT_LIMITS}' `maxBytes`;
 * - `virus_detected` — the virus scan refused it;
 * - `encrypted` — a password-protected PDF;
 * - `no_text_layer` — no text to read, most likely a scanned document (there
 *   is no OCR);
 * - `too_many_pages`, `too_many_characters` — past the worker's ceilings;
 * - `parse_timeout` — reading it took longer than 30 seconds or more than
 *   256 MB, and was stopped;
 * - `parse_failed` — the file is damaged or not one the reader understands.
 *
 * The first three refuse the upload or the source with a 400
 * (`details.reason`), with nothing stored; the rest end the source's
 * `document` job (`KnowledgeJob.error`), with nothing written to the
 * knowledge base.
 */
export const KNOWLEDGE_DOCUMENT_ERRORS = [
  'unsupported_type',
  'file_too_large',
  'virus_detected',
  'encrypted',
  'no_text_layer',
  'too_many_pages',
  'too_many_characters',
  'parse_timeout',
  'parse_failed',
] as const;
export type KnowledgeDocumentError = (typeof KNOWLEDGE_DOCUMENT_ERRORS)[number];

/**
 * What an upload is for (`POST /uploads` `purpose`): `attachment` — a file in
 * a conversation, under the workspace's file-sharing rules and served back by
 * `GET /uploads/{key}`; `knowledge_document` — a PDF or DOCX for the knowledge
 * base, which that route never serves.
 */
export const UPLOAD_PURPOSES = ['attachment', 'knowledge_document'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** The lower-cased extension of `filename`, including the dot, or `''` when it has none. */
function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * A declared media type, `; charset=…` and case dropped, when it is one of
 * {@link KNOWLEDGE_DOCUMENT_MIME_TYPES}; `null` for anything else.
 */
export function normalizeKnowledgeDocumentMime(
  value: string | null | undefined,
): KnowledgeDocumentMimeType | null {
  if (typeof value !== 'string') return null;
  const base = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return (KNOWLEDGE_DOCUMENT_MIME_TYPES as readonly string[]).includes(base)
    ? (base as KnowledgeDocumentMimeType)
    : null;
}

/**
 * A client's best guess at the document it is about to upload: the type the
 * browser declared when it is one we take, otherwise the one the extension
 * implies, otherwise `null`. The server decides from the bytes either way.
 */
export function knowledgeDocumentMimeFor(
  filename: string,
  declared?: string | null,
): KnowledgeDocumentMimeType | null {
  return (
    normalizeKnowledgeDocumentMime(declared) ??
    KNOWLEDGE_DOCUMENT_EXTENSIONS[extensionOf(filename)] ??
    null
  );
}
