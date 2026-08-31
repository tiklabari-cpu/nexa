/**
 * The one check that decides whether an `attachment_url` may ride on an event.
 *
 * Shared by the agent (`chats`) and customer (`customer`) send paths on purpose:
 * this is the rule from task 3 (FR-MOD-08.9.4) that an attachment must be a file
 * *this workspace* uploaded through `/uploads`, and two copies of a security
 * boundary is one copy too many — they drift, and the weaker one is the one an
 * attacker finds.
 *
 * Three things are checked and none is optional:
 *   1. the value is one of our own upload paths, not a URL at all
 *   2. the licence inside the key is the caller's own
 *   3. the bytes are really there — a grant is permission to upload, not
 *      permission to claim
 *
 * The message is the same for all three. Which part refused is not something a
 * caller probing for another tenant's keys gets to learn.
 *
 * There is a fourth outcome and it is deliberately not one of the three: the
 * store may be unable to answer at all. `exists` throws `StorageUnavailableError`
 * for that (a 503, "try again shortly") rather than returning `false`, so an
 * unreachable bucket cannot come out of here as "you never uploaded that file".
 * It carries no per-key information — the bucket is down for every caller and
 * every key alike — so it is not an oracle, and no `try/catch` is needed here:
 * the error is already the right answer, and catching it could only make it a
 * worse one.
 */
import { ApiError } from '../../lib/api-error.js';
import type { ObjectStore } from './object-store.js';
import { keyFromAttachmentUrl, licenseOfKey } from './upload-url.js';

export async function assertUploadedAttachment(
  store: ObjectStore,
  licenseId: bigint,
  url: string,
): Promise<void> {
  const refuse = (): never => {
    throw ApiError.validation(
      'attachment_url must be a file this workspace uploaded through /uploads.',
    );
  };

  const key = keyFromAttachmentUrl(url);
  if (key === null || licenseOfKey(key) !== licenseId) refuse();
  if (!(await store.exists(key!))) refuse();
}
