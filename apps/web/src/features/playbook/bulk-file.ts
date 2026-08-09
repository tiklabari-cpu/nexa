/**
 * File selection → text, with pre-upload checks (FR-MOD-06.3.2).
 *
 * These checks are UX only. The server re-validates everything (`parseCsv` /
 * `resolveKnowledgeBulkColumns` in `apps/api`) and is the sole authority — a
 * check here that a clever caller bypasses costs nothing but a slower error
 * message, never a wrong import. The point is to name the reason before a
 * slow upload starts, not to guard anything.
 *
 * {@link precheckBulkFile} runs synchronously on `File.name`/`.type`/`.size`
 * alone, so a selection can be rejected the instant it is made, before a
 * single byte is read into memory. {@link readBulkFile} runs the same
 * precheck and then reads the file, catching the one thing size and name
 * cannot: a file that is technically non-empty but holds only whitespace.
 */

export type BulkFileRejectionReason = 'invalid_type' | 'empty_file' | 'too_large';

export interface BulkFileRejection {
  readonly ok: false;
  readonly reason: BulkFileRejectionReason;
  readonly message: string;
}

export interface BulkFileAccepted {
  readonly ok: true;
  readonly text: string;
}

export type BulkFilePrecheckResult = { readonly ok: true } | BulkFileRejection;
export type BulkFileReadResult = BulkFileAccepted | BulkFileRejection;

export interface BulkFileLimits {
  readonly maxBytes: number;
}

/**
 * Mirrors `BULK_CSV_LIMITS.maxBytes` in `apps/api/src/routes/playbook.ts` —
 * the server's real ceiling on CSV content. Deliberately not the server's
 * 12 MiB *body* limit: that number is padded for JSON-string escaping
 * overhead and is not a size an admin picking a file should reason about. A
 * file this module accepts stays under the content ceiling the server
 * actually enforces, and by construction under its body limit too.
 */
export const BULK_FILE_MAX_BYTES = 5_242_880; // 5 MiB

export const DEFAULT_BULK_FILE_LIMITS: BulkFileLimits = { maxBytes: BULK_FILE_MAX_BYTES };

const CSV_EXTENSION = '.csv';

/**
 * Browsers and operating systems report wildly different MIME types for a
 * `.csv` file (Excel-exported files often arrive as `application/vnd.ms-excel`,
 * some platforms report nothing at all). The extension is the reliable signal;
 * this list only rules out a type that is unambiguously not CSV-shaped.
 */
const ACCEPTABLE_MIME_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', '']);

function hasCsvExtension(filename: string): boolean {
  return filename.toLowerCase().endsWith(CSV_EXTENSION);
}

function hasAcceptableMimeType(type: string): boolean {
  return ACCEPTABLE_MIME_TYPES.has(type.toLowerCase());
}

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}

/**
 * Extension/MIME and size checks only — no read. Lets a UI reject an obviously
 * wrong or oversized selection immediately, before spending time reading it.
 */
export function precheckBulkFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  limits: BulkFileLimits = DEFAULT_BULK_FILE_LIMITS,
): BulkFilePrecheckResult {
  if (!hasCsvExtension(file.name) || !hasAcceptableMimeType(file.type)) {
    return {
      ok: false,
      reason: 'invalid_type',
      message: 'Choose a .csv file exported from a spreadsheet.',
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
 * `FileReader` rather than `Blob.text()` — broader support across the
 * browser/jsdom environments this module runs in, and it is the one File
 * read API every target here implements consistently.
 */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}

/**
 * Precheck, then read `file` to text. Never throws: a rejection at any stage
 * — bad extension/MIME, empty, over budget, or blank once decoded — comes
 * back as a typed {@link BulkFileRejection} like any other outcome.
 */
export async function readBulkFile(
  file: File,
  limits: BulkFileLimits = DEFAULT_BULK_FILE_LIMITS,
): Promise<BulkFileReadResult> {
  const precheck = precheckBulkFile(file, limits);
  if (!precheck.ok) return precheck;

  const text = await readAsText(file);
  if (text.trim() === '') {
    return { ok: false, reason: 'empty_file', message: 'This file is empty.' };
  }
  return { ok: true, text };
}
