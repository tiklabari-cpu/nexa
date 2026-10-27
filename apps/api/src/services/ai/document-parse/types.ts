/**
 * What the document worker reads a PDF or a DOCX into (tm 313.2 · SiyahTuş
 * analysis AI-18), and how it says no.
 *
 * A document comes out as **blocks in reading order** — a heading, a
 * paragraph, a list item or a table row — each carrying the pages it sits on.
 * Chunking is not done here: the job branch (tm 313.3) packs blocks into
 * ~600-character chunks without crossing a heading and writes each chunk's
 * `page_from` / `page_to` / `heading` from the blocks it took.
 */
import type { KnowledgeDocumentError, KnowledgeDocumentMimeType } from '@siyahtus/types';

export const DOCUMENT_BLOCK_KINDS = ['heading', 'paragraph', 'list_item', 'table_row'] as const;
export type DocumentBlockKind = (typeof DOCUMENT_BLOCK_KINDS)[number];

/** The deepest heading level a block reports; Word's 7–9 are folded into it. */
export const MAX_HEADING_LEVEL = 6;

export interface DocumentBlock {
  kind: DocumentBlockKind;
  /** 1 (largest) – {@link MAX_HEADING_LEVEL}, on a `heading` only. */
  level?: number;
  /** Normalised text: one line, single spaces; a table row is `| a | b |`. */
  text: string;
  /** The 1-based page the block starts on, and the one it ends on. */
  pageFrom: number;
  pageTo: number;
}

export interface ParsedDocument {
  mime: KnowledgeDocumentMimeType;
  /**
   * A PDF's page count; a Word document's from the layout Word last saved
   * (`w:lastRenderedPageBreak`), or from its explicit page breaks when it
   * carries none.
   */
  pageCount: number;
  /** The total length of every block's text — what `maxChars` limits. */
  characterCount: number;
  blocks: DocumentBlock[];
}

/** The worker's ceilings: `KNOWLEDGE_DOCUMENT_LIMITS`' page and character counts, unless a test lowers them. */
export interface DocumentParseLimits {
  maxPages: number;
  maxChars: number;
}

/**
 * The refusals reading a document can end in. `virus_detected` is not one:
 * the upload is scanned before anything is stored, and the worker never sees
 * a file that failed it.
 */
export type DocumentParseErrorCode = Exclude<KnowledgeDocumentError, 'virus_detected'>;

/** What the API process gives the worker process, as its one argument. */
export interface DocumentWorkerJob {
  /** The document, in the job's own temporary directory. */
  path: string;
  /** Where the worker writes its {@link DocumentWorkerReply}, in the same directory. */
  replyPath: string;
  mime: KnowledgeDocumentMimeType;
  limits: DocumentParseLimits;
  /** The worker's resident-memory ceiling, which its watchdog enforces. */
  memoryBytes: number;
  /**
   * The worker's own deadline, which its watchdog enforces too: the API
   * process kills it then, but a worker whose API process died ends itself.
   */
  timeoutMs: number;
}

/**
 * What the worker's watchdog writes to stderr before it kills the process —
 * how the API process tells a document that ran out of memory or time from a
 * worker that crashed.
 */
export const MEMORY_EXCEEDED_MARKER = 'document_worker_memory_exceeded';
export const DEADLINE_PASSED_MARKER = 'document_worker_deadline_passed';

/** What the worker process answers — checked by the API process before anything trusts it. */
export type DocumentWorkerReply =
  | { ok: true; document: ParsedDocument }
  | { ok: false; error: DocumentParseErrorCode; detail: string };

/**
 * A refusal raised while reading: `code` is what the job records and the panel
 * words, `detail` a snake_case reason for the log only (`zip_ratio`,
 * `xml_doctype`, …) — never shown, and never carrying document text.
 */
export class DocumentParseError extends Error {
  constructor(
    readonly code: DocumentParseErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'DocumentParseError';
  }
}
