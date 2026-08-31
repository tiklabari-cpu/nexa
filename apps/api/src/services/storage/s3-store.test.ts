/**
 * The `s3` object store (M-STORE-a · NFR-R1).
 *
 * Three things are worth testing here and they are not the same thing.
 *
 * **1. The signature is real.** A hand-rolled SigV4 checked against its own
 * output proves only that it is deterministic. So the two vectors below come
 * from AWS: the signing key from the "deriving a signing key" example, and
 * `get-vanilla` from the published `aws-sig-v4-test-suite`. If either drifts,
 * this signer stopped being SigV4 — which a bucket would tell us much later, in
 * production, as `SignatureDoesNotMatch`.
 *
 * **2. The wire is real.** The round trips run against an in-process HTTP
 * server that speaks enough S3 to store and return an object. A stubbed `fetch`
 * would let a wrong URL, a missing header or a mis-encoded key pass unnoticed,
 * because the assertion and the code would share the same misunderstanding.
 *
 * **3. Absence is a statement.** The largest block below is failure handling,
 * because that is what this task is about: `404` is the only thing that may
 * come back as "not there". A 403, a 500, a redirect, a refused connection and
 * a timeout all have to throw, since `attachment.ts` renders `false` to the
 * caller as "that is not a file this workspace uploaded" — an accusation the
 * store has no business making about a bucket it could not reach.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizationHeader, deriveSigningKey, S3Store, type S3StoreOptions } from './s3-store.js';
import { StorageUnavailableError } from './storage-error.js';
import { buildKey } from './upload-url.js';

/** `licenseOfKey` only accepts keys `buildKey` could have produced. */
const KEY = buildKey(7n, 'text/plain');

// --- AWS's own vectors ------------------------------------------------------

describe('SigV4', () => {
  const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

  it('derives the signing key AWS documents for its own example', () => {
    // https://docs.aws.amazon.com/ — "Examples of how to derive a version 4
    // signing key". Ground truth from outside this repository.
    expect(deriveSigningKey(SECRET, '20150830', 'us-east-1', 'iam').toString('hex')).toBe(
      'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9',
    );
  });

  it('signs the get-vanilla case from the published test suite byte for byte', () => {
    const header = authorizationHeader(
      {
        method: 'GET',
        path: '/',
        query: '',
        headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: SECRET,
        region: 'us-east-1',
        service: 'service',
      },
    );

    expect(header).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('refuses to sign a request with no timestamp', () => {
    // An unsigned-looking signature is worse than none: it would be sent, and
    // the failure would surface as a bucket rejecting every request.
    expect(() =>
      authorizationHeader(
        { method: 'GET', path: '/', query: '', headers: { host: 'x' }, payloadHash: 'abc' },
        { accessKeyId: 'a', secretAccessKey: 'b', region: 'us-east-1', service: 's3' },
      ),
    ).toThrow(/x-amz-date/);
  });
});

// --- A bucket, near enough --------------------------------------------------

interface Recorded {
  method: string;
  url: string;
  authorization: string;
  contentType: string | undefined;
  contentSha: string | undefined;
  body: Buffer;
}

/**
 * Enough S3 to store an object and hand it back, over a real socket.
 *
 * `respond` lets a test replace the whole behaviour with a fixed failure —
 * which is how the 403/500/redirect cases below are produced, since a
 * well-behaved bucket will not produce them on demand.
 */
class FakeS3 {
  readonly requests: Recorded[] = [];
  readonly #objects = new Map<string, { body: Buffer; contentType: string }>();
  readonly #server: Server;
  #port = 0;
  respond: ((request: Recorded, response: ServerResponse) => void) | null = null;

  constructor() {
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    this.#port = (this.#server.address() as AddressInfo).port;
    return this.origin;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const recorded: Recorded = {
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: String(request.headers.authorization ?? ''),
      contentType: request.headers['content-type'],
      contentSha: request.headers['x-amz-content-sha256'] as string | undefined,
      body: Buffer.concat(chunks),
    };
    this.requests.push(recorded);

    if (this.respond) {
      this.respond(recorded, response);
      return;
    }

    // Every real bucket refuses an unsigned request; so does this one, so a
    // signature that stopped being sent could not pass the round trips below.
    if (!recorded.authorization.startsWith('AWS4-HMAC-SHA256 Credential=')) {
      response.writeHead(403, { 'content-type': 'application/xml' });
      response.end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }

    const stored = this.#objects.get(recorded.url);
    if (recorded.method === 'PUT') {
      this.#objects.set(recorded.url, {
        body: recorded.body,
        contentType: recorded.contentType ?? 'application/octet-stream',
      });
      response.writeHead(200).end();
      return;
    }
    if (!stored) {
      response.writeHead(404, { 'content-type': 'application/xml' });
      response.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    response.writeHead(200, {
      'content-type': stored.contentType,
      'content-length': String(stored.body.byteLength),
    });
    // Node drops the body for HEAD on its own, which is what makes this one
    // handler serve both verbs the way a bucket does.
    response.end(stored.body);
  }
}

let bucket: FakeS3 | null = null;

afterEach(async () => {
  await bucket?.close();
  bucket = null;
});

function optionsFor(origin: string, overrides: Partial<S3StoreOptions> = {}): S3StoreOptions {
  return {
    endpoint: origin,
    bucket: 'nexa-uploads',
    region: 'eu-central-1',
    accessKeyId: 'test-key-id',
    secretAccessKey: 'test-secret-key',
    forcePathStyle: true,
    timeoutMs: 5_000,
    ...overrides,
  };
}

async function startStore(overrides: Partial<S3StoreOptions> = {}): Promise<S3Store> {
  bucket = new FakeS3();
  const origin = await bucket.listen();
  return new S3Store(optionsFor(origin, overrides));
}

describe('S3Store round trip', () => {
  it('stores bytes and hands them back with the content type they arrived with', async () => {
    const store = await startStore();

    expect(await store.exists(KEY)).toBe(false);
    await store.put(KEY, Buffer.from('hello bucket'), 'text/plain');

    expect(await store.exists(KEY)).toBe(true);
    expect(await store.get(KEY)).toEqual({
      bytes: Buffer.from('hello bucket'),
      contentType: 'text/plain',
    });
  });

  it('lays objects out under the licence in the key, path style', async () => {
    const store = await startStore();
    await store.put(KEY, Buffer.from('x'), 'text/plain');

    // `<bucket>/<licence>/<key>` — the fan-out `LocalStore` gets from
    // directories, so a bucket policy can still be written per licence.
    expect(bucket!.requests[0]!.url).toBe(`/nexa-uploads/7/${KEY}`);
  });

  it('addresses the bucket as a subdomain when path style is off', async () => {
    // Cannot be round-tripped without wildcard DNS, so what is checked is the
    // request line the bucket would see.
    bucket = new FakeS3();
    const origin = await bucket.listen();
    const host = new URL(origin).host;
    const store = new S3Store(optionsFor(origin, { forcePathStyle: false }), (input, init) =>
      // Send it to the same server, but with the URL the store built intact in
      // the path — `nexa-uploads.127.0.0.1` has nowhere to resolve to.
      fetch(new URL(new URL(input as string).pathname, `http://${host}`), init),
    );

    await store.put(KEY, Buffer.from('x'), 'text/plain');
    expect(bucket.requests[0]!.url).toBe(`/7/${KEY}`);
  });

  it('signs every request, including the hash of the body it is sending', async () => {
    const store = await startStore();
    await store.put(KEY, Buffer.from('abc'), 'text/plain');

    const put = bucket!.requests[0]!;
    expect(put.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/eu-central-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
    // sha256('abc') — S3 rejects a payload hash that does not match the body,
    // so this is the difference between a signature and a decoration.
    expect(put.contentSha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(put.authorization).toContain('content-type');
  });

  it('refuses a key that is not one of ours, before any request leaves', async () => {
    const store = await startStore();

    // The S3 analogue of `LocalStore`'s escape check: the key is not a path, so
    // there is nothing for `../` to traverse — the pattern refuses it outright.
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/not in our own format/);
    await expect(store.exists('7/../8-x.txt')).rejects.toThrow(/not in our own format/);
    await expect(store.put('', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /not in our own format/,
    );
    expect(bucket!.requests).toEqual([]);
  });
});

// --- The part that matters --------------------------------------------------

describe('S3Store tells absence apart from failure', () => {
  /** Fixes the bucket's answer, whatever is asked of it. */
  async function storeAnswering(
    status: number,
    body = '',
    headers: Record<string, string> = {},
  ): Promise<S3Store> {
    const store = await startStore();
    bucket!.respond = (_request, response) => {
      response.writeHead(status, { 'content-type': 'application/xml', ...headers });
      response.end(body);
    };
    return store;
  }

  it('reads 404 — and only 404 — as "not there"', async () => {
    const store = await storeAnswering(404, '<Error><Code>NoSuchKey</Code></Error>');

    expect(await store.exists(KEY)).toBe(false);
    expect(await store.get(KEY)).toBeNull();
  });

  it('throws on 403 rather than reporting the file missing', async () => {
    // The classic S3 mistake: a bucket without `s3:ListBucket` answers 403 for
    // an absent key, so treating 403 as absence looks right on that bucket and
    // is catastrophic on ours — a rotated credential would make every
    // attachment in the product look forged, with a 400 blaming the sender.
    const store = await storeAnswering(403, '<Error><Code>AccessDenied</Code></Error>');

    await expect(store.exists(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.get(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.get(KEY)).rejects.toMatchObject({
      detail: expect.stringContaining('403 (AccessDenied)'),
    });
  });

  it('names the S3 code on a HEAD too, where there is no body to read it from', async () => {
    // Written after this suite caught it: `exists` is the call that matters and
    // it is a HEAD, so the XML the code normally comes from does not exist —
    // an operator was getting a bare "403" for the one check that is a security
    // boundary. `AccessDenied`, `InvalidAccessKeyId` and `SignatureDoesNotMatch`
    // send them to three different places.
    const store = await storeAnswering(403, '', { 'x-amz-error-code': 'InvalidAccessKeyId' });

    await expect(store.exists(KEY)).rejects.toMatchObject({
      detail: expect.stringContaining('403 (InvalidAccessKeyId)'),
    });
  });

  it('still says something useful when the bucket names no code at all', async () => {
    const store = await storeAnswering(403, '');

    await expect(store.exists(KEY)).rejects.toMatchObject({
      detail: expect.stringContaining('answered 403'),
    });
  });

  it('throws on a 5xx', async () => {
    const store = await storeAnswering(500, '<Error><Code>InternalError</Code></Error>');

    await expect(store.exists(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.get(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.put(KEY, Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });

  it('throws on a redirect instead of following it with the credentials attached', async () => {
    // A 3xx points at another host; `fetch` would happily re-send the
    // Authorization header there. `redirect: 'manual'` is what stops it.
    //
    // The redirect deliberately points at a location that *would* succeed. An
    // unreachable one would make this pass either way — following it would fail
    // on DNS and still throw — which is a test that agrees with the code
    // without checking it.
    const store = await startStore();
    bucket!.respond = (request, response) => {
      if (request.url === '/followed') {
        response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
        response.end('ok');
        return;
      }
      response.writeHead(307, { location: `${bucket!.origin}/followed` }).end();
    };

    await expect(store.exists(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.exists(KEY)).rejects.toMatchObject({
      detail: expect.stringContaining('307'),
    });
    // Nothing reached the target of the redirect.
    expect(bucket!.requests.map((request) => request.url)).not.toContain('/followed');
  });

  it('throws when nothing is listening', async () => {
    // A port that was bound and released, so the refusal is certain rather
    // than a guess about what else might be running on this machine.
    const probe = new FakeS3();
    const origin = await probe.listen();
    await probe.close();
    const store = new S3Store(optionsFor(origin));

    await expect(store.exists(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.get(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('throws when the bucket never answers', async () => {
    const store = await startStore({ timeoutMs: 80 });
    bucket!.respond = () => {
      // Accept the request and say nothing — a hung bucket, not a refused one.
    };

    await expect(store.exists(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('never puts the secret key in the error it raises', async () => {
    const store = await storeAnswering(403, '<Error><Code>SignatureDoesNotMatch</Code></Error>');
    const error = await store.exists(KEY).catch((raised: unknown) => raised);

    const text = `${String(error)} ${(error as StorageUnavailableError).detail}`;
    expect(text).not.toContain('test-secret-key');
  });

  it('is a 503 with a message that does not accuse the caller', async () => {
    // The distinction the whole item turns on. `attachment.ts` renders `false`
    // as a 400 saying the file was never uploaded; an unreachable bucket has to
    // come out as "try again", or an outage is filed as a client mistake and
    // the message is dropped for good, because nobody retries a 400.
    const error = new StorageUnavailableError('HEAD x answered 500');

    expect(error.status).toBe(503);
    expect(error.type).toBe('service_unavailable');
    expect(error.message).toMatch(/try again/i);
    expect(error.message).not.toMatch(/upload/i);
  });
});
