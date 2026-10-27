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
import { KNOWLEDGE_DOCUMENT_PDF, type KnowledgeDocumentMimeType } from '@siyahtus/types';
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
  return licenceIn(KEY, key);
}

/**
 * `<licenseId>-m-<uuid><ext>` — a file a player e-mailed (tm 357 · HD-02).
 *
 * Its own shape, so it is *not* an upload key: `GET /uploads/{key}` answers
 * any member of the licence, and a sensitive file — an ID card — must open
 * only through the ticket's door, which checks the role and writes the audit
 * entry. `licenseOfKey` refuses this shape, so the uploads route, the
 * composer's `attachment_keys` and a chat's `attachment_url` all refuse it
 * without a line of their own. The stores take both shapes
 * ({@link licenseOfStoredKey}).
 */
export function buildMailKey(licenseId: bigint, contentType: string): string {
  return `${licenseId}-m-${randomUUID()}${extensionFor(contentType)}`;
}

const MAIL_KEY = /^(\d{1,19})-m-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(\.[a-z0-9]{1,8})?$/;

/** The licence an e-mailed file's key belongs to, or null if it is not one. */
export function licenseOfMailKey(key: string): bigint | null {
  return licenceIn(MAIL_KEY, key);
}

/**
 * `<licenseId>-k-<uuid>.pdf|.docx` — a PDF or Word document uploaded for the
 * knowledge base (tm 313 · AI-18).
 *
 * Its own shape for the mail key's reason: `GET /uploads/{key}` answers any
 * member of the licence, and serves what it holds back to the browser. A
 * knowledge document is read by the document worker and handed to a person
 * only through `GET /knowledge-sources/{id}/file`, a short-lived signed link.
 * `licenseOfKey` refuses this shape, so that route, the composer's
 * `attachment_keys` and a chat's `attachment_url` all refuse it with no line
 * of their own; the stores keep it under `<licence>/knowledge/`
 * ({@link storedObjectPath}). The extension is rebuilt from the type the
 * grant vetted, never from a filename.
 */
export function buildKnowledgeKey(
  licenseId: bigint,
  contentType: KnowledgeDocumentMimeType,
): string {
  return `${licenseId}-k-${randomUUID()}${contentType === KNOWLEDGE_DOCUMENT_PDF ? '.pdf' : '.docx'}`;
}

const KNOWLEDGE_KEY = /^(\d{1,19})-k-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|docx)$/;

/** The licence a knowledge document's key belongs to, or null if it is not one. */
export function licenseOfKnowledgeKey(key: string): bigint | null {
  return licenceIn(KNOWLEDGE_KEY, key);
}

/**
 * The licence of anything the object store holds — an upload, an e-mailed
 * file or a knowledge document — or null for a key in none of those shapes.
 * What the stores lay their paths out by; never what a route authorises by.
 */
export function licenseOfStoredKey(key: string): bigint | null {
  return licenseOfKey(key) ?? licenseOfMailKey(key) ?? licenseOfKnowledgeKey(key);
}

/**
 * Where a key lives inside the store, or null for a key in none of our shapes:
 * `<licence>/<key>`, and `<licence>/knowledge/<key>` for a knowledge document
 * — a prefix of its own, so a bucket policy or lifecycle rule can treat the
 * documents a workspace keeps apart from what its conversations carry. Both
 * stores derive their paths here, so the two cannot disagree.
 */
export function storedObjectPath(key: string): string | null {
  const license = licenseOfStoredKey(key);
  if (license === null) return null;
  return licenseOfKnowledgeKey(key) === null ? `${license}/${key}` : `${license}/knowledge/${key}`;
}

function licenceIn(pattern: RegExp, key: string): bigint | null {
  const match = pattern.exec(key);
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
      // An attachment or a knowledge document — the two shapes `POST /uploads`
      // grants. Never a mail key: nothing uploads one.
      (licenseOfKey(key) ?? licenseOfKnowledgeKey(key)) === null
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
  return lengthPrefixed([
    grant.key,
    grant.contentType.toLowerCase(),
    grant.sizeBytes,
    grant.expiresAt,
  ]);
}

function lengthPrefixed(parts: ReadonlyArray<string | number>): string {
  return parts.map((part) => `${String(part).length}:${part}`).join('');
}

/** How long a knowledge document's download link works (`GET /knowledge-sources/{id}/file`). */
export const KNOWLEDGE_DOWNLOAD_TTL_SECONDS = 300;

/** What a download link commits to. Changing any of it invalidates the link. */
export interface KnowledgeDownloadGrant {
  key: string;
  /** The name the browser saves the file as. */
  filename: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

/**
 * Short-lived links to a knowledge document's original (tm 313 · AI-18-S2).
 *
 * The link is the authorisation, like an upload URL — a browser following a
 * link sends no bearer token — and narrower than a session: one object, one
 * filename, five minutes. `GET /knowledge-sources/{id}/file` mints it for a
 * member allowed to read the source; `GET /knowledge-files/{key}` honours it.
 *
 * The HMAC key is derived from `UPLOAD_SIGNING_KEY` under its own label, so
 * no upload grant is ever a valid download signature, or the other way round,
 * whatever the two canonical forms happen to share.
 */
export class KnowledgeDownloadSigner {
  readonly #secret: Buffer;

  constructor(uploadSigningKey: string) {
    this.#secret = createHmac('sha256', uploadSigningKey)
      .update('siyahtus/knowledge-download/v1')
      .digest();
  }

  sign(grant: KnowledgeDownloadGrant): string {
    return createHmac('sha256', this.#secret)
      .update(lengthPrefixed([grant.key, grant.filename, grant.expiresAt]))
      .digest('base64url');
  }

  /** The grant when the link is genuine, for a knowledge document, and not yet expired; else null. */
  verify(
    grant: Partial<KnowledgeDownloadGrant> & { signature?: string },
    now = Math.floor(Date.now() / 1000),
  ): KnowledgeDownloadGrant | null {
    const { key, filename, expiresAt, signature } = grant;
    if (
      !key ||
      typeof filename !== 'string' ||
      typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      !signature ||
      licenseOfKnowledgeKey(key) === null
    ) {
      return null;
    }
    const full: KnowledgeDownloadGrant = { key, filename, expiresAt };
    // Signature before expiry, as for uploads: a forged link learns nothing
    // from the difference.
    if (!constantTimeEqual(this.sign(full), signature)) return null;
    if (expiresAt <= now) return null;
    return full;
  }
}
