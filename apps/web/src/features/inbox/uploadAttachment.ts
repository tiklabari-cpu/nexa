/**
 * Turn a picked file into an `attachment_url` an event can carry.
 *
 * Two steps, mirroring the server split (FR-MOD-08.9.4): `POST /uploads` asks
 * permission — this is where the licence's file-sharing rules refuse a type or
 * size — and only then does the signed `PUT` move the bytes. The returned
 * `file_url` is what belongs on the message's `attachment_url`.
 */
import { ApiClientError, errorMessageKey, type ApiClient } from '../../lib/api-client.js';
import type { TFunction } from '../../lib/i18n.js';

export interface UploadedAttachment {
  fileUrl: string;
  contentType: string;
  name: string;
}

/** The signed `PUT` was refused: carries the status, never a sentence. */
export class UploadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`upload PUT ${status}`);
    this.name = 'UploadHttpError';
    this.status = status;
  }
}

/**
 * The sentence for a failed upload, in the console's language (O14, tm 259.18).
 *
 * It used to print `error.message` as it came: the server's English, the
 * client's own "Upload failed with status 413.", and — with the network gone —
 * the browser's "Failed to fetch". The two refusals worth explaining carry
 * their numbers in `details` (`allowed_file_types`, `max_file_size_bytes`), so
 * the sentence is built from those; every other API refusal goes through the
 * error-type catalogue, and a dropped connection says so.
 */
export function uploadFailureMessage(t: TFunction, error: unknown, file?: File): string {
  if (error instanceof ApiClientError) {
    const allowed = error.details?.['allowed_file_types'];
    if (Array.isArray(allowed)) {
      return t('inbox.composer.upload.typeNotAllowed', {
        type: file?.type || file?.name || '?',
        allowed: allowed.map(String).join(', '),
      });
    }
    const max = error.details?.['max_file_size_bytes'];
    if (typeof max === 'number') {
      return t('inbox.composer.upload.tooLarge', { max: formatFileSize(max) });
    }
    return t(errorMessageKey(error));
  }
  if (error instanceof UploadHttpError) {
    return error.status === 413
      ? t('inbox.composer.upload.tooLargeUnknown')
      : t('inbox.composer.upload.failedStatus', { status: error.status });
  }
  // `fetch` rejects with a TypeError when the request never got an answer.
  if (error instanceof TypeError) return t('common.errors.network');
  return t('inbox.composer.attachError');
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function uploadAttachment(api: ApiClient, file: File): Promise<UploadedAttachment> {
  const grant = await api.post<{ upload_url: string; file_url: string }>('/uploads', {
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
  });

  // The PUT is authorised by the signature inside the URL, not the session, and
  // its body is raw bytes — so it bypasses the JSON client and goes to `fetch`
  // directly. The dev proxy sends `/api/...` to the API just the same.
  const response = await fetch(grant.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new UploadHttpError(response.status);
  }

  return { fileUrl: grant.file_url, contentType: file.type, name: file.name };
}
