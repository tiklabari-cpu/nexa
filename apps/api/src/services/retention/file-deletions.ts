/**
 * The files a customer erasure deletes from the object store (tm 423 · NFR-C8).
 *
 * Until tm 423 an erasure deleted every row that referred to the subject's
 * files and none of the files. That is worse than it sounds: the store is
 * reached only through those rows — the retention sweep finds an e-mailed file
 * through `ticket_messages.attachments`, a download needs a message to name
 * the key — so once the rows were gone nothing would ever find the files
 * again. An ID card a player uploaded stayed on disk, forever, after the
 * workspace had told them it was erased.
 *
 * ## Which files
 *
 * Every file the subject's conversations and tickets carried, collected while
 * the rows still exist ({@link collectSubjectFiles}): the attachments of the
 * events in their chats — what they uploaded, what an agent sent them, a
 * WhatsApp photo — and of the messages on their tickets — their e-mails' files
 * and the agents' replies. An e-mailed file the sweep already purged is skipped:
 * its bytes are gone and its entry only says so.
 *
 * Two guards decide what may go, and both are about other people's files:
 *
 *   - **Only this workspace's uploads and e-mailed files** ({@link
 *     isErasableKey}). The licence lives inside the key, so the check is the
 *     key's own prefix — a row planted with another workspace's key, or a
 *     knowledge document's or an invoice's, is never deleted from here. The
 *     table the keys are queued in repeats the rule as a CHECK.
 *   - **Not a file something else still shows** ({@link withoutSharedFiles}).
 *     A key is minted per upload, but the API does accept an existing upload
 *     path again, so an agent can send one file to two people. After the
 *     erasure's deletes, a key a surviving event or ticket message still names
 *     is not this person's alone; it stays. An e-mailed file's key cannot be
 *     attached anywhere else (`licenseOfKey` refuses its shape), so the check
 *     only ever spares uploads.
 *
 * ## When, and the retry
 *
 * The bytes cannot go inside the transaction — a store delete cannot be rolled
 * back, and deleting before the commit would lose files for an erasure that
 * then failed. They cannot simply go after it either, because a store that is
 * down at that moment would leave exactly the orphan this module exists to
 * prevent. So the erasure writes one `pending_file_deletions` row per file in
 * its own transaction ({@link queueFileDeletions}) — the debt commits with the
 * deletes or not at all — and after the commit the route deletes each file and
 * then its row ({@link deleteQueuedFiles}). Whatever the store would not
 * delete keeps its row, the receipt says how many (`files_pending`), and the
 * retention sweep deletes it on its next pass. There is no job queue in this
 * code base to hand it to; the sweep already runs per tenant, holds the
 * deployment's store, and is where the e-mailed-file purge already lives.
 *
 * Deleting is idempotent — the store treats an absent key as success — so a
 * pass cut short between the delete and the row, or two passes at once, only
 * delete again.
 */
import type { TenantClient } from '../../lib/tenant.js';
import type { ObjectStore } from '../storage/object-store.js';
import {
  keyFromAttachmentUrl,
  licenseOfKey,
  licenseOfMailKey,
  UPLOAD_PATH_PREFIX,
} from '../storage/upload-url.js';

/**
 * Whether erasure may delete `key` for `licenseId`: an upload or an e-mailed
 * file, of that workspace. Knowledge documents and invoices are the
 * workspace's own records, not a customer's, and are never deleted here.
 */
export function isErasableKey(key: string, licenseId: bigint): boolean {
  return licenseOfKey(key) === licenseId || licenseOfMailKey(key) === licenseId;
}

/**
 * The keys of every file the subject's conversations and tickets carry, read
 * before anything is deleted. Distinct, sorted, and already narrowed to
 * {@link isErasableKey}.
 */
export async function collectSubjectFiles(
  tx: TenantClient,
  licenseId: bigint,
  customerId: string,
  chatIds: readonly string[],
): Promise<string[]> {
  const keys = new Set<string>();

  if (chatIds.length > 0) {
    // The `(chat_id, created_at)` index per partition: a lookup by conversation.
    const events = await tx.$queryRaw<Array<{ attachment_url: string }>>`
      SELECT DISTINCT attachment_url FROM events
       WHERE chat_id = ANY(${[...chatIds]}::text[])
         AND attachment_url IS NOT NULL`;
    for (const { attachment_url } of events) {
      const key = keyFromAttachmentUrl(attachment_url);
      if (key !== null) keys.add(key);
    }
  }

  // A purged entry's bytes are already gone (the sweep's sensitive-file step);
  // only its record of having been there is left, and that goes with the row.
  const attachments = await tx.$queryRaw<Array<{ key: string | null }>>`
    SELECT DISTINCT entry ->> 'key' AS key
      FROM ticket_messages AS m
      JOIN tickets AS t ON t.id = m.ticket_id AND t.license_id = m.license_id
     CROSS JOIN LATERAL jsonb_array_elements(m.attachments) AS entry
     WHERE t.customer_id = ${customerId}::uuid
       AND entry -> 'purged' IS DISTINCT FROM 'true'::jsonb`;
  for (const { key } of attachments) if (key) keys.add(key);

  return [...keys].filter((key) => isErasableKey(key, licenseId)).sort();
}

/**
 * `keys` minus the ones a surviving event or ticket message still names —
 * called after the erasure's deletes, so whatever is left referring to a key
 * belongs to someone else. Only uploads can be shared (see the header), so a
 * set with none skips both reads.
 */
export async function withoutSharedFiles(
  tx: TenantClient,
  keys: readonly string[],
): Promise<string[]> {
  const uploads = keys.filter((key) => licenseOfKey(key) !== null);
  if (uploads.length === 0) return [...keys];

  const shared = new Set<string>();
  const urls = uploads.map((key) => `${UPLOAD_PATH_PREFIX}${key}`);
  const events = await tx.$queryRaw<Array<{ attachment_url: string }>>`
    SELECT DISTINCT attachment_url FROM events WHERE attachment_url = ANY(${urls}::text[])`;
  for (const { attachment_url } of events) {
    const key = keyFromAttachmentUrl(attachment_url);
    if (key !== null) shared.add(key);
  }
  const messages = await tx.$queryRaw<Array<{ key: string }>>`
    SELECT DISTINCT entry ->> 'key' AS key
      FROM ticket_messages AS m
     CROSS JOIN LATERAL jsonb_array_elements(m.attachments) AS entry
     WHERE m.attachments <> '[]'::jsonb
       AND entry ->> 'key' = ANY(${uploads}::text[])`;
  for (const { key } of messages) shared.add(key);

  return keys.filter((key) => !shared.has(key));
}

/** Record the files this erasure owes the store, in the erasure's own transaction. */
export async function queueFileDeletions(
  tx: TenantClient,
  licenseId: bigint,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  await tx.pendingFileDeletion.createMany({
    data: keys.map((key) => ({ licenseId, key })),
    skipDuplicates: true,
  });
}

export interface QueuedFileDeletion {
  /** Files deleted from the store by this call. */
  deleted: number;
  /** Files still owed: `keys` minus `deleted`. Their rows stay. */
  pending: number;
  /**
   * Why it stopped short, or null when every file went: the store's error
   * (the first one stops the pass — a store that refused one key is not going
   * to take the next), or the error forgetting the rows of the deleted ones.
   */
  failure: unknown;
}

/**
 * Delete queued files from the store, then forget the rows of the ones that
 * went (`forget` runs a tenant transaction for it). Never throws: a caller
 * after the erasure's commit must not turn a done erasure into a 500, and the
 * sweep decides itself what a failure means. A key that is not
 * {@link isErasableKey} for `licenseId` is left alone — the table's CHECK
 * means it cannot happen, and if it ever did, keeping a file is the
 * recoverable mistake.
 */
export async function deleteQueuedFiles(
  store: ObjectStore,
  licenseId: bigint,
  keys: readonly string[],
  forget: (keys: string[]) => Promise<unknown>,
): Promise<QueuedFileDeletion> {
  const gone: string[] = [];
  let failure: unknown = null;
  for (const key of keys) {
    if (!isErasableKey(key, licenseId)) continue;
    try {
      await store.delete(key);
      gone.push(key);
    } catch (error) {
      failure = error;
      break;
    }
  }
  if (gone.length > 0) {
    try {
      await forget(gone);
    } catch (error) {
      // The files are gone either way; the rows stay and the next pass
      // deletes again (absence is success) and forgets them then.
      failure ??= error;
    }
  }
  return { deleted: gone.length, pending: keys.length - gone.length, failure };
}
