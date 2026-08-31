/**
 * The `s3` storage provider — an `ObjectStore` backed by any S3-compatible
 * bucket (M-STORE-a · NFR-R1).
 *
 * `LocalStore` writes under `STORAGE_LOCAL_DIR`, which is a directory inside
 * one pod. The Helm chart scales the API to four replicas, and `attachment.ts`
 * refuses an attachment whose bytes it cannot find — so under horizontal scale
 * an upload that landed on pod A is, to pod B, a file nobody uploaded. That is
 * the NFR-R1 "stateless" claim being false in the one place it is expensive to
 * be false. This provider is the shared surface that makes it true.
 *
 * ## Why there is no SDK here
 *
 * `@aws-sdk/client-s3` is ninety-odd packages to send three requests, and every
 * external service in this repo is reached through code we own so it can be
 * exercised without a network (MASTER-PROMPT). What S3 actually requires is one
 * signature scheme, and this codebase already signs HMAC-SHA256 canonical
 * strings in two other places (`upload-url.ts`, `webhooks/signature.ts`). So
 * SigV4 lives here, as a pure function over a request description, checked in
 * the tests against AWS's own published vectors rather than against itself.
 *
 * `fetch` is injectable for the reason `createHttpWebhookSender`'s is: the
 * interesting behaviour of this module is what it does with the *answers*, and
 * that has to be testable without standing anything up.
 *
 * ## The rule this module is really about
 *
 * Every method separates an answer from a failure to answer. `404` is the only
 * absence there is: `get` returns `null` and `exists` returns `false` for it and
 * for nothing else. A refused connection, a timeout, a redirect, a 403 from a
 * bucket policy, a 500 from the provider — none of those is evidence that the
 * object is missing, and `attachment.ts` treats "missing" as grounds to reject
 * a message, so all of them throw `StorageUnavailableError` instead. The full
 * argument is in `storage-error.ts`.
 *
 * A 403 deserves its own sentence, because conflating it is the classic S3
 * mistake: a bucket that does not grant `s3:ListBucket` answers `403` rather
 * than `404` for a key that is not there. Reading that as "absent" would be
 * right by accident on such a bucket and badly wrong on ours, where a 403 means
 * our credentials are wrong and *every* attachment would suddenly look forged.
 * Unknown is unknown.
 *
 * ## Traversal
 *
 * `local-store.ts` resolves the key against its root and refuses a path that
 * escapes. The S3 analogue is that the key is not a path at all: `licenseOfKey`
 * accepts `<licenceId>-<uuid><ext>` and nothing else, so `../` cannot survive
 * the pattern — and the request path is checked once more after it is built,
 * the same belt and braces, for the same reason ("the caller cannot reach it"
 * stops being true the first time someone adds a caller).
 *
 * No SSRF check, deliberately: the endpoint is operator configuration, not
 * caller input, and the guard would refuse exactly the deployment this is first
 * used in (MinIO on a private address). It is validated as an origin at boot
 * instead (`config/env.ts`).
 */
import { createHash, createHmac } from 'node:crypto';
import type { ObjectStore, StoredFile } from './object-store.js';
import { StorageUnavailableError } from './storage-error.js';
import { licenseOfKey } from './upload-url.js';

/** Everything the `s3` provider needs. Assembled once, in `parseEnv`. */
export interface S3StoreOptions {
  /** Origin only — `https://s3.eu-central-1.amazonaws.com`, `http://localhost:9000`. */
  endpoint: string;
  bucket: string;
  /** Signed into every request; S3 rejects a signature scoped to another region. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * `<endpoint>/<bucket>/<key>` rather than `<bucket>.<endpoint>/<key>`.
   *
   * Defaults on, because the deployment this ships with is MinIO, which serves
   * one host and cannot answer a bucket subdomain without wildcard DNS. AWS
   * still accepts path style; virtual-host style is here for the buckets that
   * require it.
   */
  forcePathStyle: boolean;
  /**
   * Ceiling on one request, sized for the 25 MiB the PUT route will buffer.
   *
   * There is no retry here on purpose. A retry belongs to whoever knows whether
   * the operation is safe to repeat, and hiding one inside `put` would multiply
   * the request timeout by an amount the caller never agreed to.
   */
  timeoutMs: number;
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
/** Computed rather than pasted: a mistyped constant would fail every request. */
const EMPTY_BODY_SHA256 = createHash('sha256').update('').digest('hex');

export class S3Store implements ObjectStore {
  readonly #options: S3StoreOptions;
  readonly #fetch: typeof fetch;

  constructor(options: S3StoreOptions, fetchImpl: typeof fetch = fetch) {
    this.#options = options;
    this.#fetch = fetchImpl;
  }

  /**
   * Resolves only once the bucket has the bytes — the same contract
   * `SiemTarget.deliver` states, and for the same reason: the caller records an
   * `attachment_url` on an event the moment this resolves, so "the request
   * left" is not good enough.
   */
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.#send('PUT', key, {
      body: bytes,
      // Stored by S3 and handed back on the way out, which is what lets this
      // provider skip the `.type` sidecar `LocalStore` has to keep. Guessing it
      // from the extension is how a text/plain becomes a text/html in someone's
      // browser.
      contentType,
      payloadHash: createHash('sha256').update(bytes).digest('hex'),
    });

    if (response.status !== 200 && response.status !== 201) {
      throw await unavailable('PUT', key, response);
    }
    await drain(response);
  }

  async get(key: string): Promise<StoredFile | null> {
    const response = await this.#send('GET', key, {});

    if (response.status === 404) {
      await drain(response);
      return null;
    }
    if (response.status !== 200) {
      throw await unavailable('GET', key, response);
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      // The fallback is only reachable for an object stored outside this API;
      // everything `put` writes carries the type the upload grant vetted.
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /**
   * Whether the bytes are actually there.
   *
   * `false` means the bucket said `404`. It never means "we could not ask" —
   * that throws (`storage-error.ts`), because `attachment.ts` turns `false`
   * into a 400 telling the caller their upload never happened.
   */
  async exists(key: string): Promise<boolean> {
    const response = await this.#send('HEAD', key, {});

    if (response.status === 200) {
      await drain(response);
      return true;
    }
    if (response.status === 404) {
      await drain(response);
      return false;
    }
    throw await unavailable('HEAD', key, response);
  }

  /** One signed request. Transport failures become `StorageUnavailableError`. */
  async #send(
    method: 'GET' | 'PUT' | 'HEAD',
    key: string,
    payload: { body?: Buffer; contentType?: string; payloadHash?: string },
  ): Promise<Response> {
    const { url, canonicalPath } = this.#locate(key);
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payload.payloadHash ?? EMPTY_BODY_SHA256,
      'x-amz-date': amzDate(new Date()),
    };
    if (payload.contentType) headers['content-type'] = payload.contentType;

    const authorization = authorizationHeader(
      {
        method,
        path: canonicalPath,
        // Nothing this provider sends carries a query string; the signature
        // still commits to its emptiness.
        query: '',
        headers,
        payloadHash: headers['x-amz-content-sha256']!,
      },
      {
        accessKeyId: this.#options.accessKeyId,
        secretAccessKey: this.#options.secretAccessKey,
        region: this.#options.region,
        service: SERVICE,
      },
    );

    // `host` is signed because S3 verifies the one it receives, but it is not
    // sent by hand: the agent derives it from the URL, and setting it twice is
    // how a signature and a request start disagreeing.
    const { host: _signedOnly, ...sent } = headers;

    try {
      return await this.#fetch(url, {
        method,
        headers: { ...sent, authorization },
        body: payload.body,
        // Never follow one. A 3xx from a bucket points somewhere else, and
        // `fetch` would re-send the Authorization header to whatever it names.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      });
    } catch (error) {
      // DNS, refused connection, TLS, timeout. None of them is an answer.
      throw new StorageUnavailableError(
        `${method} ${this.#options.bucket}/${key} could not reach ${url.origin}`,
        { cause: error },
      );
    }
  }

  /**
   * Where a key lives, and the canonical path its signature commits to.
   *
   * Objects are laid out `<licenceId>/<key>` — the fan-out `LocalStore` gets
   * from directories, kept here so a bucket policy or a lifecycle rule can be
   * written per licence.
   */
  #locate(key: string): { url: URL; canonicalPath: string } {
    const license = licenseOfKey(key);
    if (license === null) {
      throw new Error('refusing to touch a key that is not in our own format');
    }

    const { endpoint, bucket, forcePathStyle } = this.#options;
    const objectPath = `${license}/${key}`;
    const canonicalPath = forcePathStyle
      ? `/${uriEncodePath(bucket)}/${uriEncodePath(objectPath)}`
      : `/${uriEncodePath(objectPath)}`;

    // Belt and braces, exactly like `LocalStore`'s check that a resolved path is
    // still under its root: the pattern above already refuses every key that
    // could produce one of these, and this is what keeps the guarantee if the
    // pattern is ever loosened.
    if (canonicalPath.split('/').includes('..')) {
      throw new Error('refusing a key that escapes the bucket prefix');
    }

    const base = new URL(endpoint);
    const url = new URL(base);
    url.pathname = canonicalPath;
    if (!forcePathStyle) url.host = `${bucket}.${base.host}`;
    return { url, canonicalPath };
  }
}

// --- SigV4 -----------------------------------------------------------------
// Exported for the tests, which check these against AWS's published vectors. A
// signer verified only against its own output proves nothing.

export interface SigV4Request {
  method: string;
  /** Canonical (already percent-encoded) path, starting with `/`. */
  path: string;
  /** Canonical query string; `''` when there is none. */
  query: string;
  /** Every header that will be sent, `host` included. Names are lowercased here. */
  headers: Record<string, string>;
  /** Hex sha256 of the body, or of the empty string. */
  payloadHash: string;
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

/**
 * `HMAC(HMAC(HMAC(HMAC("AWS4" + secret, date), region), service), "aws4_request")`.
 *
 * The chain is what keeps the long-lived secret off the wire and puts a day, a
 * region and a service between it and any signature made from it.
 */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const date = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac('sha256', date).update(region).digest();
  const serviceKey = createHmac('sha256', regionKey).update(service).digest();
  return createHmac('sha256', serviceKey).update('aws4_request').digest();
}

/** The `Authorization` header for a request whose `x-amz-date` is already set. */
export function authorizationHeader(request: SigV4Request, credentials: SigV4Credentials): string {
  const headers = Object.entries(request.headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = headers.map(([name]) => name).join(';');

  const canonicalRequest = [
    request.method,
    request.path,
    request.query,
    // Each header line carries its own newline; the join then adds the blank
    // line the canonical form puts before `SignedHeaders`.
    headers.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    request.payloadHash,
  ].join('\n');

  const timestamp = headers.find(([name]) => name === 'x-amz-date')?.[1];
  if (!timestamp) throw new Error('cannot sign a request without x-amz-date');
  const dateStamp = timestamp.slice(0, 8);
  const scope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;

  const stringToSign = [
    ALGORITHM,
    timestamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signature = createHmac(
    'sha256',
    deriveSigningKey(
      credentials.secretAccessKey,
      dateStamp,
      credentials.region,
      credentials.service,
    ),
  )
    .update(stringToSign)
    .digest('hex');

  return `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** `YYYYMMDDTHHMMSSZ`, the only date format SigV4 accepts. */
export function amzDate(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Percent-encoding as SigV4 defines it, applied per path segment.
 *
 * `encodeURIComponent` leaves `!*'()` alone and AWS does not, so a key holding
 * one would be signed differently from the way it is sent. Our keys are hex and
 * digits, but an encoder has to be right for a signature to be verifiable
 * rather than merely working today.
 */
function uriEncodePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!*'()]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

// --- Answers that are not answers ------------------------------------------

/**
 * Turns a response that is not an answer into the error the interface promises.
 *
 * The S3 error code is pulled out of the XML body because the status alone
 * sends an operator to the wrong place — `AccessDenied`, `InvalidAccessKeyId`
 * and `SignatureDoesNotMatch` are three different mistakes behind one 403. Only
 * the code is kept; the body is not repeated into a log line.
 */
async function unavailable(
  method: string,
  key: string,
  response: Response,
): Promise<StorageUnavailableError> {
  const code = await errorCodeOf(response);
  return new StorageUnavailableError(
    `${method} ${key} answered ${response.status}${code ? ` (${code})` : ''}`,
  );
}

/**
 * The S3 error code, from the header if there is one and the body otherwise.
 *
 * The header is checked first because of `exists`: a HEAD response carries no
 * body by definition, so the XML is not merely absent by chance — the one call
 * that is a security boundary is the one that could never have had it. Several
 * S3 implementations put the code in `x-amz-error-code` for exactly that
 * reason; where none is sent the status stands on its own.
 */
async function errorCodeOf(response: Response): Promise<string | null> {
  const header = response.headers.get('x-amz-error-code');
  if (header) return sanitiseCode(header);

  try {
    const body = await response.text();
    const match = /<Code>([A-Za-z0-9_.-]{1,64})<\/Code>/.exec(body.slice(0, 2048));
    return match ? match[1]! : null;
  } catch {
    // A body that cannot be read tells us nothing extra; the status still does.
    return null;
  }
}

/** A remote-supplied string is never spliced into a log line unexamined. */
function sanitiseCode(value: string): string | null {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

/** Undici holds a connection open until the body is consumed or cancelled. */
async function drain(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already torn down — either way nothing is held.
  }
}
