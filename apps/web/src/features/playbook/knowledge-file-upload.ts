/**
 * File selection → an upload body, with pre-upload checks (FR-MOD-06.3.2).
 *
 * The sibling of `bulk-file.ts`, and it follows the same contract: **these
 * checks are UX only.** `POST /knowledge-sources/file` re-validates the type,
 * the size and — the part no client can do — whether the bytes are text at all.
 * A check here that a clever caller bypasses costs a slower error message and
 * nothing else. The point is to name the reason before a slow upload starts.
 *
 * What differs from `bulk-file.ts` is what is read. A bulk import sends the
 * file's *text*, because the server is going to parse it as a CSV document
 * either way. An upload sends the file's *bytes*, base64-encoded, because the
 * server has to decide whether they decode as text — and a browser that has
 * already decoded them for us has thrown away the evidence. Reading as a data
 * URL is how a `File` is turned into base64 without an intermediate binary
 * string, and `FileReader` is the one read API every environment this runs in
 * (browsers and jsdom) implements consistently.
 */
import {
  KNOWLEDGE_FILE_MAX_BYTES,
  KNOWLEDGE_FILE_MIME_TYPES,
  knowledgeFileMimeFor,
  type KnowledgeFileMimeType,
} from '@nexa/types';

export type KnowledgeFileRejectionReason =
  'invalid_type' | 'empty_file' | 'too_large' | 'unreadable';

export interface KnowledgeFileRejection {
  readonly ok: false;
  readonly reason: KnowledgeFileRejectionReason;
  readonly message: string;
}

export interface KnowledgeFileAccepted {
  readonly ok: true;
  /** The file's name, sent as a title and never as a path. */
  readonly filename: string;
  /** The type the server will parse the bytes as. */
  readonly contentType: KnowledgeFileMimeType;
  /** The file's bytes, base64-encoded, ready for the request body. */
  readonly data: string;
}

export type KnowledgeFilePrecheckResult = { readonly ok: true } | KnowledgeFileRejection;
export type KnowledgeFileReadResult = KnowledgeFileAccepted | KnowledgeFileRejection;

export interface KnowledgeFileLimits {
  readonly maxBytes: number;
}

export const DEFAULT_KNOWLEDGE_FILE_LIMITS: KnowledgeFileLimits = {
  maxBytes: KNOWLEDGE_FILE_MAX_BYTES,
};

/**
 * The `accept` attribute for the file input: extensions *and* media types.
 *
 * Both, because neither alone covers the pickers this has to work in — some
 * platforms filter on the extension, others on the type, and Markdown is the
 * case where they disagree most often.
 */
export const KNOWLEDGE_FILE_ACCEPT = ['.txt', '.text', '.md', '.markdown', '.csv']
  .concat(KNOWLEDGE_FILE_MIME_TYPES as readonly string[])
  .join(',');

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}

/**
 * Type and size checks on `File.name`/`.type`/`.size` alone — no read. Lets the
 * form reject a wrong or oversized selection the instant it is made, before a
 * byte is loaded into memory.
 */
export function precheckKnowledgeFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  limits: KnowledgeFileLimits = DEFAULT_KNOWLEDGE_FILE_LIMITS,
): KnowledgeFilePrecheckResult {
  if (!knowledgeFileMimeFor(file.name, file.type)) {
    return {
      ok: false,
      reason: 'invalid_type',
      message: 'Choose a .txt, .md or .csv file.',
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: 'empty_file', message: 'This file is empty.' };
  }
  if (file.size > limits.maxBytes) {
    return {
      ok: false,
      reason: 'too_large',
      message: `This file is over the ${formatMebibytes(limits.maxBytes)} limit.`,
    };
  }
  return { ok: true };
}

/**
 * `readAsDataURL` rather than `readAsArrayBuffer` + a hand-rolled encoder: the
 * browser does the base64 itself, so there is no chunked `String.fromCharCode`
 * loop to get wrong on a large file and no binary string held in memory beside
 * the buffer.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Precheck, then read `file` into an upload body. Never throws: every outcome —
 * a wrong type, an empty or oversized file, a read that failed — comes back as
 * a typed {@link KnowledgeFileRejection}.
 */
export async function readKnowledgeFile(
  file: File,
  limits: KnowledgeFileLimits = DEFAULT_KNOWLEDGE_FILE_LIMITS,
): Promise<KnowledgeFileReadResult> {
  const precheck = precheckKnowledgeFile(file, limits);
  if (!precheck.ok) return precheck;

  // Non-null by the precheck above, which refuses exactly when this is null.
  const contentType = knowledgeFileMimeFor(file.name, file.type) as KnowledgeFileMimeType;

  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch {
    return { ok: false, reason: 'unreadable', message: 'Could not read the file.' };
  }

  // `data:<type>;base64,<payload>`. Anything without the comma is not a data
  // URL, which means the read produced something this cannot send.
  const comma = dataUrl.indexOf(',');
  const data = comma === -1 ? '' : dataUrl.slice(comma + 1);
  if (data === '') {
    return { ok: false, reason: 'empty_file', message: 'This file is empty.' };
  }

  return { ok: true, filename: file.name, contentType, data };
}
