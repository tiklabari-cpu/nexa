/**
 * Signed upload URLs.
 *
 * Two steps rather than one: the caller asks for permission, the API answers
 * with a URL that carries its own proof, and the bytes travel separately. The
 * ceremony looks redundant against the `local` provider — the same process
 * receives the file either way — but it is what keeps the file surface off the
 * JSON API. `server.ts` fixes `bodyLimit` at 1 MiB for every route because of
 * it, and only the signed PUT lifts that ceiling for itself. Swapping in object
 * storage later becomes a provider change; the contract does not move.
 *
 * The licence id lives *inside* the key rather than beside it. A caller cannot
 * ask for someone else's file without asking for a key whose licence prefix is
 * not theirs, and that comparison is one `===` the route cannot forget to make.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { constantTimeEqual } from '../../lib/crypto.js';

/** What a signature commits to. Changing any of it invalidates the URL. */
export interface UploadGrant {
  key: string;
  contentType: string;
  sizeBytes: number;
  /** Seconds since epoch. */
  expiresAt: number;
}

export type UploadRejection =
  'malformed' | 'bad_signature' | 'expired' | 'content_type_mismatch' | 'size_mismatch';

export type UploadVerification =
  { ok: true; grant: UploadGrant } | { ok: false; reason: UploadRejection };

/**
 * `<licenseId>-<uuid><ext>` — no user-supplied path segment ever reaches it.
 *
 * Flat rather than nested: a key with a `/` in it cannot be a single path
 * parameter, and `/uploads/*` instead of `/uploads/{key}` would put the route
 * out of step with the contract — which `contract-parity.test.ts` is there to
 * catch. The licence prefix does the same work either way.
 *
 * The original filename is deliberately dropped: it is attacker-controlled,
 * carries traversal (`../`) and encoding tricks, and nothing downstream needs
 * it. The extension is rebuilt from the *declared* content type, which the
 * allow-list has already vetted, so a `.png` on disk cannot be a `.html`.
 */
export function buildKey(licenseId: bigint, contentType: string): string {
  return `${licenseId}-${randomUUID()}${extensionFor(contentType)}`;
}

const KEY = /^(\d{1,19})-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(\.[a-z0-9]{1,8})?$/;

/** The licence a key belongs to, or null if the key is not one of ours. */
export function licenseOfKey(key: string): bigint | null {
  const match = KEY.exec(key);
  if (!match) return null;
  try {
    return BigInt(match[1]!);
  } catch {
    return null;
  }
}

/** Where `POST /uploads` says the file will live. Kept next to `buildKey`. */
export const UPLOAD_PATH_PREFIX = '/api/v1/uploads/';

/**
 * The key an `attachment_url` refers to, or null if it refers to anything else.
 *
 * Deliberately not a URL parse. An event's attachment may only ever be a file
 * this API stored, so the accepted shape is one exact prefix and one key — no
 * host, no scheme, no query, no second path segment. Everything a parser would
 * have to normalise away (`//evil.example`, `@`, percent-encoded separators,
 * backslashes) simply fails the prefix or the key pattern instead.
 */
export function keyFromAttachmentUrl(url: string): string | null {
  if (!url.startsWith(UPLOAD_PATH_PREFIX)) return null;
  const key = url.slice(UPLOAD_PATH_PREFIX.length);
  return licenseOfKey(key) === null ? null : key;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.toLowerCase()] ?? '';
}

export class UploadSigner {
  readonly #secret: string;

  constructor(secret: string) {
    this.#secret = secret;
  }

  sign(grant: UploadGrant): string {
    return createHmac('sha256', this.#secret).update(canonical(grant)).digest('base64url');
  }

  /**
   * Verifies a PUT against the grant its URL claims.
   *
   * `actual` is what the request really carries — the header it set and the
   * bytes it actually sent. A grant for a 2 KB PNG does not authorise a 9 MB
   * one, so both are compared rather than trusted from the query string.
   */
  verify(
    grant: Partial<UploadGrant> & { signature?: string },
    actual: { contentType: string; sizeBytes: number },
    now = Math.floor(Date.now() / 1000),
  ): UploadVerification {
    const { key, contentType, sizeBytes, expiresAt, signature } = grant;
    if (
      !key ||
      !contentType ||
      typeof sizeBytes !== 'number' ||
      typeof expiresAt !== 'number' ||
      !signature ||
      licenseOfKey(key) === null
    ) {
      return { ok: false, reason: 'malformed' };
    }

    const full: UploadGrant = { key, contentType, sizeBytes, expiresAt };
    // Signature before expiry: an unsigned URL should not be able to learn
    // anything from the difference between "expired" and "forged".
    if (!constantTimeEqual(this.sign(full), signature)) {
      return { ok: false, reason: 'bad_signature' };
    }
    if (expiresAt <= now) return { ok: false, reason: 'expired' };
    if (actual.contentType.toLowerCase() !== contentType.toLowerCase()) {
      return { ok: false, reason: 'content_type_mismatch' };
    }
    if (actual.sizeBytes !== sizeBytes) return { ok: false, reason: 'size_mismatch' };

    return { ok: true, grant: full };
  }
}

function canonical(grant: UploadGrant): string {
  // Length-prefixed rather than delimiter-joined: a content type containing the
  // delimiter must not be able to shift a field boundary.
  return [grant.key, grant.contentType.toLowerCase(), grant.sizeBytes, grant.expiresAt]
    .map((part) => `${String(part).length}:${part}`)
    .join('');
}
