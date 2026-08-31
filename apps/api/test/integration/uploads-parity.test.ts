/**
 * The upload security boundary, run against both storage providers (M-STORE-d).
 *
 * M-STORE-a added a second `ObjectStore`, M-STORE-b a MinIO to point it at, and
 * M-STORE-c proved bytes written by one pod come back out of another. What none
 * of those asked is the question that decides whether the migration is safe to
 * make: **does the security boundary still hold when the bytes go somewhere
 * else?** A provider swap that quietly stopped remembering a content type, or
 * stored a file the scanner never saw, would pass every test written so far —
 * `s3-store.test.ts` is about what the store does with an answer, `two-pod` is
 * about which process can read an object, and `uploads.test.ts` runs the
 * security suite against exactly one provider, the shipped default.
 *
 * ## How parity is claimed here
 *
 * One list of expectations, run unchanged twice — same assertions, same
 * literals, only `STORAGE_PROVIDER` differs. That is the whole mechanism, and
 * it is deliberately not "assert local, assert s3, compare": a comparison test
 * passes when both providers are wrong in the same way. These expectations are
 * written from the security property, so a provider that diverges fails on its
 * own side, and *both* fail if the property is broken in shared code.
 *
 * The four families are the ones a storage change can plausibly break:
 *
 *   1. **fail closed on the scanner** — an infected file, and an upload the
 *      scanner could not reach at all, must both end with nothing stored
 *   2. **the signed PUT** — a forged signature, an expired grant, and a grant
 *      replayed against something other than what it authorised
 *   3. **allow-list and ceiling** — the type and size rules, at the grant step
 *      and again at the PUT, where the bytes can contradict the grant
 *   4. **nosniff, and the type that gets served** — a stored file must come
 *      back inert and typed as the grant vetted it
 *
 * ## One assertion here is weaker than it looks
 *
 * `x-content-type-options: nosniff` is checked on the way out, and this file
 * cannot tell you *who* set it. `@fastify/helmet` sets it on every response
 * (`server.ts`), so deleting the upload route's own header changes nothing
 * observable — measured, and it is the one survivor of the twelve mutations run
 * against this suite. The assertion is still the property that matters, because
 * a browser only ever sees the header; it is simply not evidence about that
 * line of the route. `content-disposition: attachment` has no second source,
 * and removing it does fail here.
 *
 * ## What is deliberately not doubled
 *
 * Not the whole upload suite. The cross-tenant rules (`never serves another
 * licence's file`, the traversal key, `attachment_url` on another host) are
 * decided by `licenseOfKey` before any store is touched — they are string
 * comparisons over a key, identical by construction, and running them twice
 * would buy gate time rather than confidence. The rules that *route through the
 * store* are the ones below.
 *
 * ## Reading the storage out of band
 *
 * Every refusal asserts the key is absent from the provider's own storage, read
 * directly — the filesystem for `local`, the bucket's object list for `s3` —
 * not through `GET /uploads/:key`. A 404 from the API is the weaker claim: it
 * is also what a stored-but-unreadable file looks like, and "the scanner
 * refused it" has to mean the bytes are not there, not that one route declines
 * to hand them back. `local` is given a private temp root and `s3` one too, so
 * a fall-through to pod-local disk cannot borrow objects from a previous run
 * (the mutation that fooled M-STORE-c's first draft).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { startFakeBucket } from '../helpers/s3-bucket.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { UploadSigner } from '../../src/services/storage/upload-url.js';
import { EICAR_SIGNATURE } from '../../src/services/storage/virus-scanner.js';

/** A provider, plus a way to see what it is holding without asking the API. */
interface Backend {
  /** The `STORAGE_*` block that selects this provider. */
  env: NodeJS.ProcessEnv;
  /** Keys the provider currently holds, `<uuid>`-form, licence prefix stripped. */
  stored: () => Promise<string[]>;
  close: () => Promise<void>;
}

async function startLocalBackend(): Promise<Backend> {
  const root = await mkdtemp(join(tmpdir(), 'nexa-parity-local-'));
  return {
    // `STORAGE_PROVIDER` explicitly, even though `local` is the default: the
    // repo's own `.env` is merged in under this, and a gate whose meaning
    // depends on a developer's file is not a gate.
    env: { STORAGE_PROVIDER: 'local', STORAGE_LOCAL_DIR: root },
    stored: async () => {
      // `<root>/<licence>/<key>`, with a `.type` sidecar beside each object.
      const licences = await readdir(root);
      const keys = await Promise.all(licences.map((licence) => readdir(join(root, licence))));
      return keys
        .flat()
        .filter((name) => !name.endsWith('.type'))
        .sort();
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}

async function startS3Backend(): Promise<Backend> {
  const bucket = await startFakeBucket();
  const root = await mkdtemp(join(tmpdir(), 'nexa-parity-s3-'));
  return {
    // A private `STORAGE_LOCAL_DIR` as well, and it is load-bearing: without
    // one, a provider that silently fell back to `LocalStore` would write to
    // the repo's `.data/uploads` and the API would keep answering correctly,
    // while `stored()` — reading the bucket — reported an empty bucket only in
    // the tests that happen to check it. With this, the fallback has nothing
    // to read either.
    env: { ...bucket.env(), STORAGE_LOCAL_DIR: root },
    stored: async () =>
      bucket
        .keys()
        .map((path) => path.slice(path.indexOf('/') + 1))
        .sort(),
    close: async () => {
      await bucket.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const PROVIDERS = [
  { name: 'local', start: startLocalBackend },
  { name: 's3', start: startS3Backend },
];

describe.each(PROVIDERS)('upload security with STORAGE_PROVIDER=$name', ({ start }) => {
  let owner: PrismaClient;
  let backend: Backend;
  let server: TestServer;
  /** The same provider, behind a scanner that can never answer (fail closed). */
  let blind: TestServer;
  let signer: UploadSigner;
  let fx: Fixtures;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  /** A real PNG header — nothing here depends on it being a whole image. */
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const EICAR = Buffer.from(EICAR_SIGNATURE, 'latin1');

  interface Grant {
    uploadUrl: string;
    fileUrl: string;
    key: string;
    query: URLSearchParams;
  }

  /** `POST /uploads` — permission, before a byte moves. */
  async function grant(contentType = 'image/png', sizeBytes = PNG.byteLength): Promise<Grant> {
    const granted = await server.post(
      '/uploads',
      { content_type: contentType, size_bytes: sizeBytes },
      auth(),
    );
    expect(granted.statusCode, granted.body).toBe(201);
    const body = granted.json() as { upload_url: string; file_url: string };
    const [path, query] = body.upload_url.split('?') as [string, string];
    return {
      uploadUrl: body.upload_url,
      fileUrl: body.file_url,
      key: path.slice('/api/v1/uploads/'.length),
      query: new URLSearchParams(query),
    };
  }

  /** `PUT /uploads/:key` — the bytes, authorised by the grant's signature. */
  const put = (
    url: string,
    payload: Buffer,
    contentType = 'image/png',
    target: TestServer = server,
  ) => target.app.inject({ method: 'PUT', url, headers: { 'content-type': contentType }, payload });

  const download = (fileUrl: string, target: TestServer = server) =>
    target.get(fileUrl.replace('/api/v1', ''), auth());

  beforeAll(async () => {
    owner = ownerClient();
    backend = await start();
    server = await startTestServer(backend.env);
    blind = await startTestServer({ ...backend.env, VIRUS_SCANNER: 'unavailable' });
    // The same key the servers signed with, so a grant can be re-issued with a
    // different expiry without going through the route that mints it.
    signer = new UploadSigner(testEnv(backend.env).UPLOAD_SIGNING_KEY);
  });

  afterAll(async () => {
    await Promise.all([server.close(), blind.close()]);
    await backend.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    // `/settings/security` resolves the licence's default brand; the file
    // rules are brand-scoped.
    await seedDefaultBrand(owner, fx.a.licenseId);
    await clearRateLimits(server.app);

    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'access_rules:rw'],
    });
  });

  // --- The control -----------------------------------------------------------

  it('stores a file the grant authorised and serves it back inert', async () => {
    const granted = await grant();

    const stored = await put(granted.uploadUrl, PNG);
    expect(stored.statusCode, stored.body).toBe(201);

    // Read from the provider itself. Without this the whole file would pass
    // against a store that fell back to local disk, since the API would answer
    // exactly the same either way.
    expect(await backend.stored()).toContain(granted.key);

    const fetched = await download(granted.fileUrl);
    expect(fetched.statusCode).toBe(200);
    expect(Buffer.from(fetched.rawPayload).equals(PNG)).toBe(true);
    expect(fetched.headers['content-type']).toContain('image/png');
    expect(fetched.headers['content-disposition']).toBe('attachment');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
  });

  // --- nosniff, and the type that gets served --------------------------------

  it('serves the type the grant vetted, not the one the uploading request claimed', async () => {
    await server.patch('/settings/security', { allowed_file_types: ['text/plain'] }, auth());
    const markup = Buffer.from('<script>alert(document.domain)</script>', 'utf8');
    const granted = await grant('text/plain', markup.byteLength);

    // The PUT declares `text/html` in its own header. The route signs and
    // stores the *granted* type, so the header is not a way to choose one.
    const stored = await put(granted.uploadUrl, markup, 'text/html');
    expect(stored.statusCode, stored.body).toBe(201);

    const fetched = await download(granted.fileUrl);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toContain('text/plain');
    expect(fetched.headers['content-type']).not.toContain('text/html');
    // Three things keep this file from executing in our own origin, and a
    // provider that lost the stored type would take out the first of them.
    // (The third also comes from helmet — see the note at the top.)
    expect(fetched.headers['content-disposition']).toBe('attachment');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
  });

  // --- The allow-list and the ceiling ----------------------------------------

  it('issues no grant for a type outside the licence allow-list', async () => {
    const refused = await server.post(
      '/uploads',
      { content_type: 'application/x-msdownload', size_bytes: 1024 },
      auth(),
    );

    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.type).toBe('validation');
    expect(refused.json().error.details.allowed_file_types).toContain('image/png');
    expect(refused.json()).not.toHaveProperty('upload_url');
  });

  it('issues no grant for a size above the licence ceiling', async () => {
    const refused = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 10_485_761 },
      auth(),
    );

    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details.max_file_size_bytes).toBe(10_485_760);
    expect(refused.json()).not.toHaveProperty('upload_url');
  });

  it('refuses bytes longer than the grant was signed for, and stores nothing', async () => {
    const granted = await grant();

    const oversized = await put(granted.uploadUrl, Buffer.concat([PNG, Buffer.alloc(64)]));

    // The ceiling checked at the grant step buys nothing if the PUT will take
    // whatever length turns up.
    expect(oversized.statusCode).toBe(403);
    expect(await backend.stored()).not.toContain(granted.key);
  });

  // --- The signed PUT --------------------------------------------------------

  it('refuses a tampered signature, and stores nothing', async () => {
    const granted = await grant();
    const forged = granted.uploadUrl.replace(/signature=.{4}/, 'signature=AAAA');

    const refused = await put(forged, PNG);

    expect(refused.statusCode).toBe(403);
    expect(await backend.stored()).not.toContain(granted.key);
  });

  it('refuses a grant past its expiry, and takes the same grant while it is live', async () => {
    const granted = await grant();
    const now = Math.floor(Date.now() / 1000);
    // Re-signed rather than slept out: this isolates expiry from every other
    // rejection, since the two URLs below differ in `expires_at` and nothing
    // else. The live one is half of the test — without it a re-signing bug
    // would make the expired case pass for the wrong reason.
    const reissue = (expiresAt: number): string => {
      const query = new URLSearchParams(granted.query);
      query.set('expires_at', String(expiresAt));
      query.set(
        'signature',
        signer.sign({
          key: granted.key,
          contentType: 'image/png',
          sizeBytes: PNG.byteLength,
          expiresAt,
        }),
      );
      return `/api/v1/uploads/${granted.key}?${query.toString()}`;
    };

    const expired = await put(reissue(now - 1), PNG);
    expect(expired.statusCode).toBe(403);
    expect(await backend.stored()).not.toContain(granted.key);

    const live = await put(reissue(now + 60), PNG);
    expect(live.statusCode, live.body).toBe(201);
    expect(await backend.stored()).toContain(granted.key);
  });

  it('refuses a grant replayed against a different key, and stores neither', async () => {
    const first = await grant();
    const second = await grant();

    // The signature commits to the key, so a captured URL cannot be pointed at
    // a key it was not issued for — including one this licence legitimately
    // holds a grant for.
    const replayed = await put(`/api/v1/uploads/${second.key}?${first.query.toString()}`, PNG);

    expect(replayed.statusCode).toBe(403);
    const objects = await backend.stored();
    expect(objects).not.toContain(first.key);
    expect(objects).not.toContain(second.key);
  });

  it('refuses a grant replayed with a different declared type, and stores nothing', async () => {
    const granted = await grant();
    const query = new URLSearchParams(granted.query);
    query.set('content_type', 'text/html');

    const replayed = await put(
      `/api/v1/uploads/${granted.key}?${query.toString()}`,
      PNG,
      'text/html',
    );

    // The type is inside the signature, so a grant for a PNG is not a grant
    // for markup — the allow-list check at the grant step cannot be walked
    // past on the way in.
    expect(replayed.statusCode).toBe(403);
    expect(await backend.stored()).not.toContain(granted.key);
  });

  it('lets a live grant be spent more than once, overwriting — the same either way', async () => {
    const granted = await grant();
    const other = Buffer.from('89504e470d0a1a0a0000000d49484453', 'hex');
    expect(other.byteLength).toBe(PNG.byteLength);

    expect((await put(granted.uploadUrl, PNG)).statusCode).toBe(201);
    const again = await put(granted.uploadUrl, other);

    // Measured, not desired. A grant is single-*key* but not single-use: until
    // it expires it will take any bytes of the signed type and length, and the
    // second set replaces the first. It is pinned here because this file's
    // question is whether the providers agree, and an overwrite is exactly
    // where they could stop agreeing — a versioned or object-locked bucket
    // would answer differently from a filesystem. Making the grant single-use
    // needs state neither provider has, and is its own item.
    expect(again.statusCode).toBe(201);
    const fetched = await download(granted.fileUrl);
    expect(Buffer.from(fetched.rawPayload).equals(other)).toBe(true);
  });

  // --- Fail closed on the scanner (FR-MOD-08.9.4) ----------------------------

  it('refuses an infected file, and stores nothing', async () => {
    const granted = await grant('image/png', EICAR.byteLength);

    const refused = await put(granted.uploadUrl, EICAR);

    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.type).toBe('validation');
    // The scan runs before the store is touched, so this is the property that
    // makes "the GET can never serve an unscanned file" true rather than lucky.
    expect(await backend.stored()).not.toContain(granted.key);
    expect((await download(granted.fileUrl)).statusCode).toBe(404);
  });

  it('refuses a clean file while the scanner is unreachable, and stores nothing', async () => {
    const granted = await grant();

    const refused = await put(granted.uploadUrl, PNG, 'image/png', blind);

    expect(refused.statusCode).toBe(503);
    expect(refused.json().error.type).toBe('service_unavailable');
    expect(await backend.stored()).not.toContain(granted.key);
    expect((await download(granted.fileUrl, blind)).statusCode).toBe(404);
  });

  // --- What an event may point at, via `store.exists` ------------------------

  it('lets an event carry a file that was uploaded and refuses one that was only granted', async () => {
    const chat = await server.post('/chats', { customer_id: fx.a.customerId }, auth());
    expect([200, 201]).toContain(chat.statusCode);
    const chatId = (chat.json() as { id: string }).id;
    const send = (attachmentUrl: string) =>
      server.post(
        `/chats/${chatId}/events`,
        { type: 'message', attachment_url: attachmentUrl },
        auth(),
      );

    // Granted and never PUT: a grant is permission to upload, not permission
    // to claim. This is the one security check that asks the store a question
    // (`exists`), so it is the one a provider can answer wrongly.
    const unused = await grant();
    expect((await send(unused.fileUrl)).statusCode).toBe(400);

    const real = await grant();
    expect((await put(real.uploadUrl, PNG)).statusCode).toBe(201);
    const sent = await send(real.fileUrl);
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().attachment_url).toBe(real.fileUrl);
  });
});
