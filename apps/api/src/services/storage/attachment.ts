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
 */
import { ApiError } from '../../lib/api-error.js';
import type { LocalStore } from './local-store.js';
import { keyFromAttachmentUrl, licenseOfKey } from './upload-url.js';

export async function assertUploadedAttachment(
  store: LocalStore,
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
