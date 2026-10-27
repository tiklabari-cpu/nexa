/**
 * A PDF or Word knowledge source's upload and original (tm 313.1 · SiyahTuş
 * analysis AI-18) — what `POST /knowledge-sources/document` and
 * `GET /knowledge-sources/{id}/file` share, kept out of the route file.
 *
 * The bytes are judged twice. `PUT /uploads/{key}` scanned them and read their
 * type before storing them; the source is created from what is *stored*, so
 * the size and the type are read again here from the object itself — the
 * object is what the worker will read, whatever any earlier request said
 * about it. Only then is its sha256 taken: one source per file per workspace.
 */
import { Prisma } from '@prisma/client';
import {
  KNOWLEDGE_DOCUMENT_LIMITS,
  KNOWLEDGE_DOCUMENT_PDF,
  type KnowledgeDocumentMimeType,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { digestBytes, type ObjectStore } from '../storage/object-store.js';
import {
  KNOWLEDGE_DOWNLOAD_TTL_SECONDS,
  type KnowledgeDownloadSigner,
  licenseOfKnowledgeKey,
} from '../storage/upload-url.js';
import { identifyKnowledgeDocument } from './knowledge-document-type.js';

/** A stored document, judged: what a `file` source records about its original. */
export interface UploadedDocument {
  key: string;
  mime: KnowledgeDocumentMimeType;
  size: number;
  sha256: string;
}

/**
 * 400 `unknown_upload`: not a document uploaded to this workspace — an
 * attachment's key, another workspace's, or one granted and never sent. One
 * answer for all three: which of them it is says whether a key exists
 * elsewhere.
 */
function unknownUpload(): ApiError {
  return ApiError.validation('upload_id: not a document uploaded to this workspace.', {
    reason: 'unknown_upload',
  });
}

/**
 * The upload `uploadId` names, read back from the store and judged: this
 * workspace's knowledge key, stored, at most `maxBytes`, and — from its bytes
 * — a PDF or a DOCX that is the type it was stored as. Throws the 400 that
 * says which rule refused it; an unreachable store is a 503
 * (`StorageUnavailableError`) with nothing written.
 */
export async function readUploadedDocument(
  store: ObjectStore,
  licenseId: bigint,
  uploadId: string,
): Promise<UploadedDocument> {
  if (licenseOfKnowledgeKey(uploadId) !== licenseId) throw unknownUpload();
  const stored = await store.get(uploadId);
  if (!stored) throw unknownUpload();
  if (stored.bytes.length > KNOWLEDGE_DOCUMENT_LIMITS.maxBytes) {
    throw ApiError.validation('A knowledge document may be at most 20 MiB.', {
      reason: 'file_too_large',
      max_bytes: KNOWLEDGE_DOCUMENT_LIMITS.maxBytes,
    });
  }
  const read = identifyKnowledgeDocument(stored.bytes);
  if (!read.ok || read.mime !== stored.contentType) {
    throw ApiError.validation('This file is not a PDF or a Word (.docx) document.', {
      reason: 'unsupported_type',
    });
  }
  return {
    key: uploadId,
    mime: read.mime,
    size: stored.bytes.length,
    sha256: digestBytes(stored.bytes),
  };
}

/** 409 `knowledge_source_exists`: the workspace already holds this file, in `details.source_id`. */
export function knowledgeSourceExists(sourceId: string | null): ApiError {
  return new ApiError('knowledge_source_exists', 'This file is already in the knowledge base.', {
    details: { source_id: sourceId },
  });
}

/**
 * Whether `error` is the insert one of the two unique indexes on a source's
 * original refused (`knowledge_sources_license_id_file_sha256_key`,
 * `knowledge_sources_file_key_key`) — the same file added twice at once.
 */
export function isDuplicateDocument(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((field) => /file_sha256|fileSha256|file_key|fileKey/.test(field));
}

/**
 * The name a person saves the original as: the source's title with directory
 * separators and control characters taken out, and the type's extension when
 * the title does not already end in it.
 */
export function documentDownloadName(title: string, mime: KnowledgeDocumentMimeType): string {
  const extension = mime === KNOWLEDGE_DOCUMENT_PDF ? '.pdf' : '.docx';
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point.
  const cleaned = title.replace(/[\u0000-\u001f\u007f/\\]+/g, ' ');
  const base = cleaned.trim().slice(0, 200) || 'document';
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

/** What `GET /knowledge-sources/{id}/file` answers — the contract's `KnowledgeFileLink`. */
export function knowledgeFileLink(
  signer: KnowledgeDownloadSigner,
  original: { key: string; mime: KnowledgeDocumentMimeType; size: number; title: string },
  now = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const filename = documentDownloadName(original.title, original.mime);
  const expiresAt = now + KNOWLEDGE_DOWNLOAD_TTL_SECONDS;
  const query = new URLSearchParams({
    filename,
    expires_at: String(expiresAt),
    signature: signer.sign({ key: original.key, filename, expiresAt }),
  });
  return {
    url: `/api/v1/knowledge-files/${original.key}?${query.toString()}`,
    expires_at: new Date(expiresAt * 1000).toISOString(),
    filename,
    content_type: original.mime,
    size_bytes: original.size,
  };
}
