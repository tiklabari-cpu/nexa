/**
 * A bucket two pods can both reach (M-STORE-c · NFR-R1).
 *
 * The claim under test is a property of a *fleet*: bytes that arrive at one API
 * process have to be readable from another one. Proving it needs object storage
 * that is genuinely outside both processes, so this is an S3-compatible HTTP
 * server the test owns, holding objects in a `Map`, addressed by both pods over
 * loopback. `s3-store.test.ts` stubs `fetch` because its subject is what the
 * store does with an answer; here nothing is stubbed, because the subject is
 * whether two operating-system processes see the same object.
 *
 * **Why not MinIO.** M-STORE-b put a real MinIO in both compose files, and this
 * scenario was run against it by hand (HANDOFF, tm 177.3). It is deliberately
 * not what the suite talks to: that service sits behind the `storage` profile,
 * so a plain `docker compose up` does not start it, and a gate that is green or
 * red depending on which profile a developer happened to bring up is not the
 * objective gate CONVENTIONS §1 asks for. The trade is stated rather than
 * hidden — a double can only be as faithful as it was written to be, which is
 * why the two things a wrong pod would actually get wrong are checked below
 * rather than waved through.
 *
 * ## What it verifies, and what that is worth
 *
 * Every request must carry a SigV4 signature this bucket can reproduce from
 * what arrived on the wire, and a `PUT` must carry the payload hash it signed.
 * Those are not decoration: an unauthenticated double would accept a pod
 * configured with no credentials at all, and a double that ignored the payload
 * hash would accept a signature that does not cover the bytes.
 *
 * It reuses `authorizationHeader` from the production module, so it cannot tell
 * you the signer is *correct* — that is `s3-store.test.ts`'s job and it is
 * settled there, against AWS's own published vectors. What it does tell you is
 * that the request the store put on the wire is the request it signed, which is
 * a different question and the one a hand-built signer usually fails: a `host`
 * header the agent rewrote, a path encoded twice, a header signed and not sent.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authorizationHeader } from '../../src/services/storage/s3-store.js';

/** Credentials the bucket issues. Placeholders, in MinIO's own default shape. */
const ACCESS_KEY_ID = 'nexatestaccesskey';
const SECRET_ACCESS_KEY = 'nexa-test-secret-key';
const REGION = 'us-east-1';
const BUCKET = 'nexa-uploads-test';

const AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/;

interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export interface FakeBucket {
  /** `http://127.0.0.1:<port>` — an origin, which is all `STORAGE_S3_ENDPOINT` accepts. */
  readonly origin: string;
  readonly bucket: string;
  /** Object paths (`<licence>/<key>`) the bucket is currently holding. */
  keys: () => string[];
  /** Every request it answered, `PUT /bucket/9/9-….pdf → 200`. For failure messages. */
  log: () => string[];
  /** The `STORAGE_S3_*` block a pod needs to talk to it. */
  env: () => NodeJS.ProcessEnv;
  close: () => Promise<void>;
}

export async function startFakeBucket(): Promise<FakeBucket> {
  const objects = new Map<string, StoredObject>();
  const log: string[] = [];

  const server: Server = createServer((request, response) => {
    response.on('finish', () =>
      log.push(`${request.method ?? '?'} ${request.url ?? '?'} → ${response.statusCode}`),
    );
    handle(objects, request, response).catch(() => {
      // A double that throws mid-request would hang the pod's fetch until its
      // own timeout, which reads as "storage is slow" rather than "the test
      // helper is broken".
      response.writeHead(500).end();
    });
  });

  await new Promise<void>((ready, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ready);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    bucket: BUCKET,
    keys: () => [...objects.keys()].sort(),
    log: () => [...log],
    env: () => ({
      STORAGE_PROVIDER: 's3',
      STORAGE_S3_ENDPOINT: origin,
      STORAGE_S3_BUCKET: BUCKET,
      STORAGE_S3_REGION: REGION,
      STORAGE_S3_ACCESS_KEY_ID: ACCESS_KEY_ID,
      STORAGE_S3_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
      STORAGE_S3_FORCE_PATH_STYLE: 'true',
    }),
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

async function handle(
  objects: Map<string, StoredObject>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = (request.url ?? '').split('?')[0] ?? '';
  const body = await readBody(request);

  const refusal = refuse(request, path, body);
  if (refusal) {
    // The header, not just the XML: `exists` sends HEAD, and a HEAD response has
    // no body to put a `<Code>` in. Real implementations set this for the same
    // reason (`s3-store.ts#errorCodeOf`).
    response.writeHead(refusal.status, { 'x-amz-error-code': refusal.code });
    response.end(errorXml(refusal.code));
    return;
  }

  // Path style only: `<endpoint>/<bucket>/<licence>/<key>`, which is what
  // `STORAGE_S3_FORCE_PATH_STYLE` above asks for.
  const prefix = `/${BUCKET}/`;
  if (!path.startsWith(prefix)) {
    response.writeHead(404, { 'x-amz-error-code': 'NoSuchBucket' });
    response.end(errorXml('NoSuchBucket'));
    return;
  }
  const objectPath = decodeURIComponent(path.slice(prefix.length));

  switch (request.method) {
    case 'PUT': {
      objects.set(objectPath, {
        bytes: body,
        contentType: request.headers['content-type'] ?? 'application/octet-stream',
      });
      response.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
      response.end();
      return;
    }
    case 'GET':
    case 'HEAD': {
      const stored = objects.get(objectPath);
      if (!stored) {
        response.writeHead(404, { 'x-amz-error-code': 'NoSuchKey' });
        response.end(request.method === 'HEAD' ? undefined : errorXml('NoSuchKey'));
        return;
      }
      response.writeHead(200, {
        'content-type': stored.contentType,
        'content-length': String(stored.bytes.byteLength),
      });
      response.end(request.method === 'HEAD' ? undefined : stored.bytes);
      return;
    }
    default: {
      response.writeHead(405, { 'x-amz-error-code': 'MethodNotAllowed' });
      response.end(errorXml('MethodNotAllowed'));
    }
  }
}

/** The S3 error code this request should be refused with, or null to serve it. */
function refuse(
  request: IncomingMessage,
  path: string,
  body: Buffer,
): { status: number; code: string } | null {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return { status: 403, code: 'AccessDenied' };
  }

  const parsed = AUTHORIZATION.exec(authorization);
  if (!parsed) return { status: 403, code: 'AuthorizationHeaderMalformed' };
  const accessKeyId = parsed[1]!;
  const region = parsed[3]!;
  const service = parsed[4]!;
  const signedHeaders = parsed[5]!;
  if (accessKeyId !== ACCESS_KEY_ID) return { status: 403, code: 'InvalidAccessKeyId' };
  // A signature scoped to another region or service verifies against a
  // different derived key; a real bucket refuses it before checking the digest.
  if (region !== REGION || service !== 's3') {
    return { status: 403, code: 'AuthorizationHeaderMalformed' };
  }

  // The hash the request *signed*, checked against the bytes it actually
  // carried: a signature that does not cover the payload is not a signature
  // over this request.
  const claimedHash = request.headers['x-amz-content-sha256'];
  if (typeof claimedHash !== 'string') return { status: 403, code: 'AccessDenied' };
  if (createHash('sha256').update(body).digest('hex') !== claimedHash) {
    return { status: 400, code: 'XAmzContentSHA256Mismatch' };
  }

  const headers: Record<string, string> = {};
  for (const name of signedHeaders.split(';')) {
    const value = name === 'host' ? request.headers.host : request.headers[name];
    // Signed and not sent. `fetch` supplies `host` itself, so this is the check
    // that the agent did not rewrite it out from under the signature.
    if (typeof value !== 'string') return { status: 403, code: 'SignatureDoesNotMatch' };
    headers[name] = value;
  }

  const expected = authorizationHeader(
    { method: request.method ?? '', path, query: '', headers, payloadHash: claimedHash },
    { accessKeyId, secretAccessKey: SECRET_ACCESS_KEY, region, service },
  );
  return expected === authorization ? null : { status: 403, code: 'SignatureDoesNotMatch' };
}

function errorXml(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
