/**
 * Attachment uploads.
 *
 * The property that matters is that a refusal happens *before* a URL exists.
 * Enforcing the file-sharing rules only on the way in would leave a signed
 * grant sitting in a client for a file the licence never allowed, and a grant
 * is exactly the thing that stops being checked later.
 *
 * The second property is that the licence lives inside the key. Cross-tenant
 * reads are not prevented by remembering to filter — there is nothing to
 * filter, the prefix either matches the caller or it does not.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { EICAR_SIGNATURE } from '../../src/services/storage/virus-scanner.js';

describe('uploads', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({
      STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'nexa-uploads-')),
    });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    tokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'access_rules:rw'],
    });
    tokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['chats--all:rw', 'access_rules:rw'],
    });
  });

  /** Walks the whole grant → PUT → stored path and hands back both URLs. */
  async function upload(
    token: string,
    body = PNG,
    contentType = 'image/png',
  ): Promise<{ fileUrl: string; uploadUrl: string; putStatus: number }> {
    const granted = await server.post(
      '/uploads',
      { content_type: contentType, size_bytes: body.byteLength },
      auth(token),
    );
    expect(granted.statusCode).toBe(201);
    const grant = granted.json();

    const put = await server.app.inject({
      method: 'PUT',
      url: grant.upload_url,
      headers: { 'content-type': contentType },
      payload: body,
    });

    return { fileUrl: grant.file_url, uploadUrl: grant.upload_url, putStatus: put.statusCode };
  }

  // --- The refusals, before any URL exists -----------------------------------

  it('issues no grant for a type outside the allow list', async () => {
    const refused = await server.post(
      '/uploads',
      { content_type: 'application/x-msdownload', size_bytes: 1024 },
      auth(tokenA),
    );

    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.type).toBe('validation');
    // The rule that refused it travels with the refusal, so a client can say
    // what is allowed instead of guessing.
    expect(refused.json().error.details.allowed_file_types).toContain('image/png');
    expect(refused.json()).not.toHaveProperty('upload_url');
  });

  it('issues no grant for a size above the licence ceiling', async () => {
    const refused = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 10_485_761 },
      auth(tokenA),
    );

    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details.max_file_size_bytes).toBe(10_485_760);
  });

  it('issues no grant at all once file sharing is switched off', async () => {
    await server.patch('/settings/security', { file_sharing_enabled: false }, auth(tokenA));

    const refused = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 1024 },
      auth(tokenA),
    );

    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.type).toBe('authorization');
  });

  it("follows the licence's own list rather than the shipped default", async () => {
    // text/csv is not in the schema default; an admin who adds it should be
    // able to send one immediately.
    await server.patch(
      '/settings/security',
      { allowed_file_types: ['text/csv'] },
      auth(tokenA),
    );

    const csv = await server.post(
      '/uploads',
      { content_type: 'text/csv', size_bytes: 12 },
      auth(tokenA),
    );
    const png = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 12 },
      auth(tokenA),
    );

    expect(csv.statusCode).toBe(201);
    expect(png.statusCode).toBe(400);
  });

  // --- The signed PUT --------------------------------------------------------

  it('stores the bytes and reads them back', async () => {
    const { fileUrl, putStatus } = await upload(tokenA);
    expect(putStatus).toBe(201);

    const fetched = await server.get(fileUrl.replace('/api/v1', ''), auth(tokenA));
    expect(fetched.statusCode).toBe(200);
    expect(Buffer.from(fetched.rawPayload).equals(PNG)).toBe(true);
    expect(fetched.headers['content-type']).toContain('image/png');
    // Never inline: an allowed text/plain rendered in our own origin is stored
    // XSS given away for free.
    expect(fetched.headers['content-disposition']).toBe('attachment');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses a tampered signature', async () => {
    const granted = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: PNG.byteLength },
      auth(tokenA),
    );
    const forged = granted.json().upload_url.replace(/signature=.{4}/, 'signature=AAAA');

    const put = await server.app.inject({
      method: 'PUT',
      url: forged,
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    });

    expect(put.statusCode).toBe(403);
  });

  it('refuses bytes that do not match the length the grant was signed for', async () => {
    const granted = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: PNG.byteLength },
      auth(tokenA),
    );

    const put = await server.app.inject({
      method: 'PUT',
      url: granted.json().upload_url,
      headers: { 'content-type': 'image/png' },
      payload: Buffer.concat([PNG, Buffer.alloc(64)]),
    });

    // A grant for a small file must not deliver a large one — otherwise the
    // ceiling checked at the grant step buys nothing.
    expect(put.statusCode).toBe(403);
  });

  it('refuses an expired grant', async () => {
    const brief = await startTestServer({
      STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'nexa-uploads-')),
      UPLOAD_URL_TTL: '1',
    });
    try {
      const granted = await brief.post(
        '/uploads',
        { content_type: 'image/png', size_bytes: PNG.byteLength },
        auth(tokenA),
      );
      expect(granted.statusCode).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 1_200));

      const put = await brief.app.inject({
        method: 'PUT',
        url: granted.json().upload_url,
        headers: { 'content-type': 'image/png' },
        payload: PNG,
      });
      expect(put.statusCode).toBe(403);
    } finally {
      await brief.close();
    }
  });

  // --- Tenancy ---------------------------------------------------------------

  it("never serves another licence's file", async () => {
    const { fileUrl } = await upload(tokenA);

    const asB = await server.get(fileUrl.replace('/api/v1', ''), auth(tokenB));

    // 404 rather than 403: whether another licence's file exists is not
    // something this caller gets to learn.
    expect(asB.statusCode).toBe(404);
    expect(asB.json().error.type).toBe('not_found');
  });

  it('puts the licence inside the key, so there is nothing to forget to filter', async () => {
    const granted = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 16 },
      auth(tokenA),
    );

    expect(granted.json().file_url).toContain(`/uploads/${fx.a.licenseId}-`);
  });

  it('refuses a key that is not in our own format', async () => {
    const traversal = await server.get('/uploads/..%2F..%2Fetc%2Fpasswd', auth(tokenA));
    expect(traversal.statusCode).toBe(404);
  });

  // --- attachment_url: what an event is allowed to point at --------------------

  /**
   * `attachment_url` was `z.string().url()` and nothing more. Any agent could
   * hang any URL on an event and every recipient's browser would fetch it —
   * a tracker, an exploit, or a file belonging to another licence, rendered
   * inside our own conversation as though we had served it.
   *
   * These four are written before the check exists and are expected to fail
   * first ([MAX], MASTER-PROMPT). The rule they pin down: an attachment may
   * only be something this licence uploaded through `/uploads`, and that we
   * can still find.
   */
  describe('attachment_url', () => {
    async function startChat(token: string, licenseCustomer: string) {
      const response = await server.post('/chats', { customer_id: licenseCustomer }, auth(token));
      expect([200, 201]).toContain(response.statusCode);
      return response.json() as { id: string };
    }

    const send = async (token: string, chatId: string, attachmentUrl: string) =>
      server.post(
        `/chats/${chatId}/events`,
        { type: 'message', attachment_url: attachmentUrl },
        auth(token),
      );

    it('(a) refuses a URL on someone else\'s host', async () => {
      const chat = await startChat(tokenA, fx.a.customerId);

      const sent = await send(tokenA, chat.id, 'https://evil.example/tracker.png');

      expect(sent.statusCode).toBe(400);
      expect(sent.json().error.type).toBe('validation');
    });

    it('(b) refuses a path that only looks like one of ours', async () => {
      const chat = await startChat(tokenA, fx.a.customerId);

      // Right prefix, key that was never minted here — the shape is not the
      // authorisation.
      const spoofed = await send(tokenA, chat.id, '/api/v1/uploads/evil.html');

      expect(spoofed.statusCode).toBe(400);
    });

    it('(c) refuses a key that was granted but never uploaded', async () => {
      const chat = await startChat(tokenA, fx.a.customerId);
      const granted = await server.post(
        '/uploads',
        { content_type: 'image/png', size_bytes: PNG.byteLength },
        auth(tokenA),
      );

      // No PUT. Nothing is stored, so nothing may be referenced: a grant is
      // permission to upload, not permission to claim.
      const sent = await send(tokenA, chat.id, granted.json().file_url);

      expect(sent.statusCode).toBe(400);
    });

    it("(d) refuses another licence's file key", async () => {
      const { fileUrl } = await upload(tokenB); // stored under licence B
      const chat = await startChat(tokenA, fx.a.customerId);

      const sent = await send(tokenA, chat.id, fileUrl);

      expect(sent.statusCode).toBe(400);
    });

    it('accepts a file this licence really uploaded', async () => {
      const { fileUrl, putStatus } = await upload(tokenA);
      expect(putStatus).toBe(201);
      const chat = await startChat(tokenA, fx.a.customerId);

      const sent = await send(tokenA, chat.id, fileUrl);

      expect(sent.statusCode).toBe(201);
      expect(sent.json().attachment_url).toBe(fileUrl);
    });
  });

  // --- Virus scanning (FR-MOD-08.9.4) ----------------------------------------

  describe('virus scanning', () => {
    // The EICAR anti-virus test file — harmless, but every scanner flags it.
    const eicar = Buffer.from(EICAR_SIGNATURE, 'latin1');

    it('refuses an infected file, and never stores it', async () => {
      const granted = await server.post(
        '/uploads',
        { content_type: 'image/png', size_bytes: eicar.byteLength },
        auth(tokenA),
      );
      const grant = granted.json();

      const put = await server.app.inject({
        method: 'PUT',
        url: grant.upload_url,
        headers: { 'content-type': 'image/png' },
        payload: eicar,
      });
      expect(put.statusCode).toBe(400);
      expect(put.json().error.type).toBe('validation');

      // Nothing was stored, so nothing can be served — to the uploader or anyone.
      const get = await server.get(grant.file_url.replace('/api/v1', ''), auth(tokenA));
      expect(get.statusCode).toBe(404);
    });

    it('does not let an infected file become a message event', async () => {
      const chat = await server.post('/chats', { customer_id: fx.a.customerId }, auth(tokenA));
      const chatId = (chat.json() as { id: string }).id;

      const granted = await server.post(
        '/uploads',
        { content_type: 'image/png', size_bytes: eicar.byteLength },
        auth(tokenA),
      );
      const grant = granted.json();
      // Rejected at the PUT, so the key was never stored.
      await server.app.inject({
        method: 'PUT',
        url: grant.upload_url,
        headers: { 'content-type': 'image/png' },
        payload: eicar,
      });

      // Referencing a file that does not exist cannot make an event.
      const sent = await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', attachment_url: grant.file_url },
        auth(tokenA),
      );
      expect(sent.statusCode).toBe(400);
    });

    it('refuses the upload when the scanner is unreachable (fail closed)', async () => {
      const down = await startTestServer({
        STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'nexa-uploads-')),
        VIRUS_SCANNER: 'unavailable',
      });
      try {
        const granted = await down.post(
          '/uploads',
          { content_type: 'image/png', size_bytes: PNG.byteLength },
          auth(tokenA),
        );
        expect(granted.statusCode).toBe(201);

        // A perfectly clean file — but one we could not scan is still refused.
        const put = await down.app.inject({
          method: 'PUT',
          url: granted.json().upload_url,
          headers: { 'content-type': 'image/png' },
          payload: PNG,
        });
        expect(put.statusCode).toBe(503);
        expect(put.json().error.type).toBe('service_unavailable');

        const get = await down.get(granted.json().file_url.replace('/api/v1', ''), auth(tokenA));
        expect(get.statusCode).toBe(404);
      } finally {
        await down.close();
      }
    });
  });

  // --- Regression ------------------------------------------------------------

  it('leaves the 1 MiB body limit alone for ordinary routes', async () => {
    // The per-route ceiling on the signed PUT must not have loosened the limit
    // `server.ts` sets for every JSON endpoint.
    const huge = await server.post(
      '/settings/trusted-domains',
      { domain: 'x'.repeat(2_000_000) },
      auth(tokenA),
    );

    expect([400, 413]).toContain(huge.statusCode);
  });
});
