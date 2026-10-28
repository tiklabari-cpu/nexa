/**
 * A PDF or Word file as a knowledge source (tm 313.3 · AI-18) — what the Files
 * tab does before and around the two requests that add one.
 *
 * Unlike a text file (`knowledge-file-upload.ts`, which sends the bytes inside
 * the JSON), a document is added in two steps because it is big and it is read
 * afterwards by a worker:
 *
 *   1. **Upload** — `POST /uploads` (`purpose: knowledge_document`) grants a
 *      signed URL and the bytes go there with a raw `PUT`;
 *   2. **Process** — `POST /knowledge-sources/document` names that upload and
 *      the source appears `processing`; the panel looks again every few seconds
 *      until the job has read it (`ready`) or refused it (`failed`, with the
 *      code in `last_refresh_error`).
 *
 * The prechecks here are UX only, like the text file's: the server judges the
 * type from the bytes, the size, the virus scan and the page and character
 * limits. A check a clever caller bypasses costs a slower message.
 */
import {
  KNOWLEDGE_DOCUMENT_ERRORS,
  KNOWLEDGE_DOCUMENT_EXTENSIONS,
  KNOWLEDGE_DOCUMENT_LIMITS,
  KNOWLEDGE_DOCUMENT_MIME_TYPES,
  knowledgeDocumentMimeFor,
  type KnowledgeDocumentError,
  type KnowledgeDocumentMimeType,
} from '@siyahtus/types';
import { ApiClientError, type ApiClient } from '../../lib/api-client.js';

/** The Files tab's `accept`: the text types and the two documents. */
export function withDocumentAccept(textAccept: string): string {
  return [
    textAccept,
    ...Object.keys(KNOWLEDGE_DOCUMENT_EXTENSIONS),
    ...KNOWLEDGE_DOCUMENT_MIME_TYPES,
  ].join(',');
}

/** Whether `file` is a PDF or Word document — by its declared type, else its extension. */
export function isKnowledgeDocument(file: Pick<File, 'name' | 'type'>): boolean {
  return knowledgeDocumentMimeFor(file.name, file.type) !== null;
}

export type KnowledgeDocumentRejection = 'empty_file' | 'too_large';

/** Size checks on `File.size` alone — no read. Null: nothing to say against it. */
export function precheckKnowledgeDocument(
  file: Pick<File, 'size'>,
): KnowledgeDocumentRejection | null {
  if (file.size === 0) return 'empty_file';
  if (file.size > KNOWLEDGE_DOCUMENT_LIMITS.maxBytes) return 'too_large';
  return null;
}

/** The i18n key of the sentence for a refusal code the server (or a job) gave. */
export const KNOWLEDGE_DOCUMENT_ERROR_KEYS: Record<KnowledgeDocumentError, string> = {
  unsupported_type: 'playbook.knowledge.document.error.unsupported_type',
  file_too_large: 'playbook.knowledge.document.error.file_too_large',
  virus_detected: 'playbook.knowledge.document.error.virus_detected',
  encrypted: 'playbook.knowledge.document.error.encrypted',
  no_text_layer: 'playbook.knowledge.document.error.no_text_layer',
  too_many_pages: 'playbook.knowledge.document.error.too_many_pages',
  too_many_characters: 'playbook.knowledge.document.error.too_many_characters',
  parse_timeout: 'playbook.knowledge.document.error.parse_timeout',
  parse_failed: 'playbook.knowledge.document.error.parse_failed',
};

/** `value` as a document error code, or null (a free-text `last_refresh_error` is not one). */
export function knowledgeDocumentErrorCode(
  value: string | null | undefined,
): KnowledgeDocumentError | null {
  return (KNOWLEDGE_DOCUMENT_ERRORS as readonly string[]).includes(value ?? '')
    ? (value as KnowledgeDocumentError)
    : null;
}

/**
 * The key for a refusal of the upload or of `POST /knowledge-sources/document`
 * that names a document rule: the 400's `details.reason`. Null — anything else,
 * the 409 `knowledge_source_exists` included — is for `errorMessageKey`.
 */
export function documentRequestErrorKey(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  const reason = error.details?.['reason'];
  const code = knowledgeDocumentErrorCode(typeof reason === 'string' ? reason : null);
  return code ? KNOWLEDGE_DOCUMENT_ERROR_KEYS[code] : null;
}

/**
 * Stage one: the grant and the raw `PUT`. Returns the `upload_id` stage two
 * names. The PUT is authorised by the signature inside the URL, not the
 * session, and its body is raw bytes — so it goes to `fetch`, not the JSON
 * client; its 400 body carries the same `details.reason` the grant's would
 * (a renamed executable, the virus scan).
 */
export async function uploadKnowledgeDocument(api: ApiClient, file: File): Promise<string> {
  const mime = knowledgeDocumentMimeFor(file.name, file.type) as KnowledgeDocumentMimeType;
  const grant = await api.post<{ upload_url: string; upload_id: string }>('/uploads', {
    content_type: mime,
    size_bytes: file.size,
    purpose: 'knowledge_document',
  });
  const response = await fetch(grant.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: file,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { type?: string; message?: string; details?: Record<string, unknown> };
    } | null;
    throw new ApiClientError({
      // The envelope's type is read off the wire; `errorMessageKey` narrows it.
      type: (body?.error?.type ?? 'internal') as ApiClientError['type'],
      status: response.status,
      message: body?.error?.message ?? 'The document upload was refused.',
      requestId: response.headers.get('x-request-id') ?? '',
      ...(body?.error?.details ? { details: body.error.details } : {}),
    });
  }
  return grant.upload_id;
}
