/**
 * One use per upload grant (tm 446 · audit F43).
 *
 * A signed `PUT /uploads/{key}` used to take any bytes of its type and length
 * until the grant expired, each set replacing the last — under a key a
 * conversation may already show, while `GET /uploads/{key}` tells every cache
 * the file never changes (`immutable`, a year). Two agents could open the same
 * attachment and see two different files. The first PUT that stores bytes now
 * spends the key; any later one is `409 upload_already_written` and stores
 * nothing.
 *
 * Two records, for two failure modes:
 *
 * - **A Redis claim** (`SET NX`) is the one step two concurrent PUTs cannot
 *   both pass. It is held until the grant has expired, plus a minute for clock
 *   skew between replicas — past that the signature check refuses the URL on
 *   its own. An unreachable Redis refuses the upload (503), as an unreachable
 *   virus scanner does: no claim, no write.
 * - **The store** is the durable record. A key that already holds bytes was
 *   spent, whatever Redis remembers — a restart or an eviction inside the
 *   grant's window does not reopen it.
 *
 * Only a PUT that *stored* bytes spends the grant: when the write fails the
 * claim is released, so a retry of the same URL can still land. The caller
 * runs every check on the bytes (scan, type) before this, so a refused file
 * never claims anything at all.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ApiError } from '../../lib/api-error.js';
import type { ObjectStore } from './object-store.js';
import type { UploadGrant } from './upload-url.js';

/** The two Redis commands the claim needs (an `ioredis` client satisfies it). */
export interface ClaimRedis {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number, nx: 'NX'): Promise<string | null>;
  del(key: string): Promise<number>;
}

/** How long past its grant's expiry a spent key stays claimed — clock skew, nothing more. */
export const CLAIM_GRACE_SECONDS = 60;

/** The Redis key a grant's claim lives under. */
export function claimName(key: string): string {
  return `siyahtus:upload-claim:${key}`;
}

/** The 409 for a PUT to a key an earlier PUT already wrote. */
export function alreadyWritten(): ApiError {
  return new ApiError(
    'upload_already_written',
    'This upload URL has already been used. Ask for a new one to upload another file.',
  );
}

/**
 * Stores `bytes` under `grant.key` unless that key has been written before —
 * then 409, with nothing stored. Errors from the store propagate after the
 * claim is released.
 */
export async function writeOnce(
  deps: {
    redis: ClaimRedis;
    store: Pick<ObjectStore, 'exists' | 'put'>;
    log: Pick<FastifyBaseLogger, 'warn'>;
  },
  grant: UploadGrant,
  bytes: Buffer,
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  const name = claimName(grant.key);
  const ttl = Math.max(1, grant.expiresAt - now) + CLAIM_GRACE_SECONDS;
  let claimed: string | null;
  try {
    claimed = await deps.redis.set(name, '1', 'EX', ttl, 'NX');
  } catch (error) {
    throw new ApiError(
      'service_unavailable',
      'Uploads are unavailable right now. Please try again shortly.',
      { cause: error },
    );
  }
  if (claimed !== 'OK') throw alreadyWritten();

  let spent = false;
  try {
    if (await deps.store.exists(grant.key)) {
      spent = true;
      throw alreadyWritten();
    }
    await deps.store.put(grant.key, bytes, grant.contentType);
    spent = true;
  } finally {
    // A PUT that stored nothing must not spend the grant.
    if (!spent) {
      try {
        await deps.redis.del(name);
      } catch (error) {
        // The claim then lapses with the grant; a retry meanwhile is a 409,
        // which the clients answer by asking for a new grant.
        deps.log.warn({ err: error }, 'upload claim release failed');
      }
    }
  }
}
