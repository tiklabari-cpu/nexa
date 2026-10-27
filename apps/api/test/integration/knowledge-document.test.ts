/**
 * PDF and Word knowledge sources, the upload half (tm 313.1 · AI-18) — from
 * `POST /uploads` with `purpose: knowledge_document` to a `processing` source
 * with its `document` job, and the original's way back out.
 *
 * Every refusal makes the same second claim as `knowledge-file.test.ts`:
 * nothing was written — here, nothing *stored* either. The storage is read
 * out of band (the local store's directory), not through an API route, since
 * "the route will not hand it back" is also what a stored-but-unreadable file
 * looks like.
 *
 * The document itself is read by the worker of tm 313.2–313.3; until it
 * exists a `document` job ends `unsupported_kind`, which one test pins so the
 * interim state is a known one, not a source stuck `processing`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_DOCUMENT_DOCX, KNOWLEDGE_DOCUMENT_LIMITS } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { EXE, docm, docx, pdf } from '../helpers/document-fixtures.js';
import { LocalStore } from '../../src/services/storage/local-store.js';
import {
  KnowledgeDownloadSigner,
  buildKnowledgeKey,
} from '../../src/services/storage/upload-url.js';
import { EICAR_SIGNATURE } from '../../src/services/storage/virus-scanner.js';

const PDF = 'application/pdf';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('knowledge documents — upload and source (FR-MOD-06.3.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentA: string;
  let agentB: string;
  const storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-documents-'));

  type Tenant = 'a' | 'b';
  const headers = async (tenant: Tenant, scopes: string[]) => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes,
    })}`,
  });
  const editor = (tenant: Tenant) => headers(tenant, ['agents-bot--all:rw']);

  /** Whether the bytes are in the store, read from its directory rather than through the API. */
  const storedAt = (tenant: Tenant, key: string) =>
    existsSync(join(storageDir, String(fx[tenant].licenseId), 'knowledge', key));

  async function grant(
    auth: Record<string, string>,
    contentType: string,
    size: number,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await server.post(
      '/uploads',
      { content_type: contentType, size_bytes: size, purpose: 'knowledge_document' },
      auth,
    );
    return { status: response.statusCode, body: response.json() };
  }

  /** Grant → PUT. The grant must succeed; the PUT's answer is the caller's to judge. */
  async function upload(tenant: Tenant, bytes: Buffer, contentType = PDF) {
    const granted = await grant(await editor(tenant), contentType, bytes.byteLength);
    expect(granted.status).toBe(201);
    const uploadId = granted.body.upload_id as string;
    const put = await server.app.inject({
      method: 'PUT',
      url: granted.body.upload_url as string,
      headers: { 'content-type': contentType },
      payload: bytes,
    });
    return { uploadId, grant: granted.body, put };
  }

  async function createSource(tenant: Tenant, body: Record<string, unknown>) {
    return server.post(
      '/knowledge-sources/document',
      { ai_agent_id: tenant === 'a' ? agentA : agentB, ...body },
      await editor(tenant),
    );
  }

  const sourceCount = (tenant: Tenant) =>
    owner.knowledgeSource.count({ where: { licenseId: fx[tenant].licenseId } });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({ STORAGE_LOCAL_DIR: storageDir });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const [a, b] = await Promise.all(
      (['a', 'b'] as const).map((tenant) =>
        owner.aiAgent.create({
          data: { licenseId: fx[tenant].licenseId, kind: 'ai_agent', name: 'Ada' },
          select: { id: true },
        }),
      ),
    );
    agentA = a!.id;
    agentB = b!.id;
  });

  // A created source's job is claimed in the background; the next test's
  // reset must not race it.
  afterEach(async () => {
    await server.app.knowledgeJobs.idle();
  });

  // --- The upload ------------------------------------------------------------

  it('stores a document under its own prefix with a key GET /uploads never serves', async () => {
    const bytes = pdf(['Bonus şartları: çevrim 35 kat.']);
    const { uploadId, grant: granted, put } = await upload('a', bytes);

    expect(uploadId).toMatch(new RegExp(`^${fx.a.licenseId}-k-[0-9a-f-]{36}\\.pdf$`));
    expect(granted).not.toHaveProperty('file_url');
    expect(put.statusCode).toBe(201);
    expect(put.json()).toEqual({
      upload_id: uploadId,
      size_bytes: bytes.byteLength,
      checksum_sha256: sha256(bytes),
    });
    expect(storedAt('a', uploadId)).toBe(true);

    // Not an attachment: the attachment URL answers 404 even to a member of
    // the workspace it belongs to.
    const served = await server.get(`/uploads/${uploadId}`, await headers('a', ['chats--all:rw']));
    expect(served.statusCode).toBe(404);
    expect(served.body).not.toContain('%PDF-');
  });

  it('grants a document only to a member holding the knowledge scope', async () => {
    const chatsOnly = await grant(await headers('a', ['chats--all:rw']), PDF, 1024);
    expect(chatsOnly.status).toBe(403);
    expect(chatsOnly.body).not.toHaveProperty('upload_url');

    // The other way round: the knowledge scope alone grants no attachment.
    const attachment = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 1024 },
      await editor('a'),
    );
    expect(attachment.statusCode).toBe(403);

    const visitor = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(visitor.statusCode).toBe(200);
    const byVisitor = await grant(
      { authorization: `Bearer ${visitor.json().token as string}` },
      PDF,
      1024,
    );
    expect(byVisitor.status).toBe(403);
  });

  it('refuses at the grant a type that is not a document and a size past 20 MiB', async () => {
    const auth = await editor('a');
    for (const type of [
      'image/png',
      'application/vnd.ms-word.document.macroenabled.12',
      'text/plain',
    ]) {
      const refused = await grant(auth, type, 1024);
      expect(refused.status, type).toBe(400);
      expect(refused.body).toMatchObject({ error: { details: { reason: 'unsupported_type' } } });
      expect(refused.body).not.toHaveProperty('upload_url');
    }
    const tooLarge = await grant(auth, PDF, KNOWLEDGE_DOCUMENT_LIMITS.maxBytes + 1);
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body).toMatchObject({
      error: { details: { reason: 'file_too_large', max_bytes: 20_971_520 } },
    });
    // The ceiling itself is allowed.
    expect((await grant(auth, PDF, KNOWLEDGE_DOCUMENT_LIMITS.maxBytes)).status).toBe(201);
  });

  it('refuses a renamed executable and a .docm by their bytes, storing nothing', async () => {
    const cases: Array<{ bytes: Buffer; declared: string }> = [
      { bytes: EXE, declared: PDF },
      { bytes: EXE, declared: KNOWLEDGE_DOCUMENT_DOCX },
      { bytes: docm(['Makroyu etkinleştirin']), declared: KNOWLEDGE_DOCUMENT_DOCX },
      // A real PDF is still not the Word document its grant was for.
      { bytes: pdf(['x']), declared: KNOWLEDGE_DOCUMENT_DOCX },
    ];
    for (const { bytes, declared } of cases) {
      const { uploadId, put } = await upload('a', bytes, declared);
      expect(put.statusCode, declared).toBe(400);
      expect(put.json()).toMatchObject({ error: { details: { reason: 'unsupported_type' } } });
      expect(storedAt('a', uploadId)).toBe(false);
    }
  });

  it('refuses an EICAR file, inside a PDF or on its own, storing nothing (FR-MOD-08.9.4)', async () => {
    for (const bytes of [
      pdf(['Bonus'], { trailer: EICAR_SIGNATURE }),
      Buffer.from(EICAR_SIGNATURE, 'latin1'),
    ]) {
      const { uploadId, put } = await upload('a', bytes);
      expect(put.statusCode).toBe(400);
      expect(put.json()).toMatchObject({ error: { details: { reason: 'virus_detected' } } });
      expect(storedAt('a', uploadId)).toBe(false);
    }
  });

  // --- The source ------------------------------------------------------------

  it('creates a processing file source with its document job from a stored PDF', async () => {
    const bytes = pdf(['Para çekme en geç 24 saat sürer.', 'İkinci sayfa.']);
    const { uploadId } = await upload('a', bytes);
    const brandId = await seedDefaultBrand(owner, fx.a.licenseId);

    const response = await createSource('a', {
      upload_id: uploadId,
      filename: 'C:\\Belgeler\\Ödeme Rehberi.pdf',
      brand_id: brandId,
    });
    expect(response.statusCode).toBe(201);
    const source = response.json();
    expect(source).toMatchObject({
      type: 'file',
      name: 'Ödeme Rehberi.pdf',
      status: 'processing',
      chunk_count: 0,
      page_count: 0,
      file_mime: PDF,
      file_size: bytes.byteLength,
      file_sha256: sha256(bytes),
      brand_ids: [brandId],
    });
    expect(source.job_id).toEqual(expect.any(String));

    const job = await server.get(`/knowledge-jobs/${source.job_id}`, await editor('a'));
    expect(job.statusCode).toBe(200);
    expect(job.json()).toMatchObject({ kind: 'document', source_id: source.id });

    const row = await owner.knowledgeSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(row).toMatchObject({ fileKey: uploadId, content: null, licenseId: fx.a.licenseId });
  });

  it('takes a DOCX the same way, titled by name', async () => {
    const bytes = docx(['Hesap doğrulama için kimlik ön ve arka yüzü gerekir.']);
    const { uploadId, put } = await upload('a', bytes, KNOWLEDGE_DOCUMENT_DOCX);
    expect(put.statusCode).toBe(201);
    const response = await createSource('a', { upload_id: uploadId, name: 'KYC kuralları' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'KYC kuralları',
      file_mime: KNOWLEDGE_DOCUMENT_DOCX,
      status: 'processing',
    });
  });

  it('until the document worker exists, ends the job unsupported_kind and writes nothing to the knowledge base', async () => {
    const { uploadId } = await upload('a', pdf(['Bonus']));
    const created = (await createSource('a', { upload_id: uploadId, name: 'Bonus' })).json();

    server.app.knowledgeJobs.wake();
    await server.app.knowledgeJobs.idle();

    const job = await owner.knowledgeJob.findUniqueOrThrow({ where: { id: created.job_id } });
    expect(job).toMatchObject({ status: 'failed', error: 'unsupported_kind' });
    const source = await owner.knowledgeSource.findUniqueOrThrow({ where: { id: created.id } });
    // Failed, and none of a website's crawl bookkeeping written onto it.
    expect(source).toMatchObject({ status: 'failed', lastCrawledAt: null, lastRefreshError: null });
    expect(await owner.knowledgeChunk.count({ where: { sourceId: created.id } })).toBe(0);
  });

  it('answers 409 knowledge_source_exists for the same file twice in a workspace, and not across workspaces', async () => {
    const bytes = pdf(['Aynı belge.']);
    const first = (
      await createSource('a', { upload_id: (await upload('a', bytes)).uploadId, name: 'Bir' })
    ).json();

    const again = await createSource('a', {
      upload_id: (await upload('a', bytes)).uploadId,
      name: 'İki',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: { type: 'knowledge_source_exists', details: { source_id: first.id } },
    });
    expect(await sourceCount('a')).toBe(1);

    // Another workspace holding the same file is its own business.
    const elsewhere = await createSource('b', {
      upload_id: (await upload('b', bytes)).uploadId,
      name: 'Bir',
    });
    expect(elsewhere.statusCode).toBe(201);
  });

  it('refuses an upload_id that is not a stored document of this workspace, writing nothing', async () => {
    const theirs = (await upload('b', pdf(['B']))).uploadId;

    // An attachment's key, stored through the ordinary path.
    const attachmentGrant = await server.post(
      '/uploads',
      { content_type: 'image/png', size_bytes: 8 },
      await headers('a', ['chats--all:rw']),
    );
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await server.app.inject({
      method: 'PUT',
      url: attachmentGrant.json().upload_url,
      headers: { 'content-type': 'image/png' },
      payload: png,
    });

    // Granted and never sent.
    const neverSent = (await grant(await editor('a'), PDF, 100)).body.upload_id as string;

    for (const uploadId of [theirs, attachmentGrant.json().upload_id, neverSent, '../etc/passwd']) {
      const refused = await createSource('a', { upload_id: uploadId, name: 'x' });
      expect(refused.statusCode, uploadId).toBe(400);
      expect(refused.json()).toMatchObject({ error: { details: { reason: 'unknown_upload' } } });
    }
    expect(await sourceCount('a')).toBe(0);
  });

  it('reads the type again from the stored object, not from the upload that stored it', async () => {
    // An object that reached the store some other way — written straight in.
    const key = buildKnowledgeKey(fx.a.licenseId, PDF);
    await new LocalStore(storageDir).put(key, EXE, PDF);

    const refused = await createSource('a', { upload_id: key, name: 'setup' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: { details: { reason: 'unsupported_type' } } });
    expect(await sourceCount('a')).toBe(0);
  });

  it('needs a name or a filename', async () => {
    const { uploadId } = await upload('a', pdf(['x']));
    const refused = await createSource('a', { upload_id: uploadId });
    expect(refused.statusCode).toBe(400);
    expect(await sourceCount('a')).toBe(0);
  });

  it('reindexes a document by queueing its read again, never by embedding empty text', async () => {
    const { uploadId } = await upload('a', pdf(['Bonus']));
    const created = (await createSource('a', { upload_id: uploadId, name: 'Bonus' })).json();
    server.app.knowledgeJobs.wake();
    await server.app.knowledgeJobs.idle();

    const again = await server.post(
      `/knowledge-sources/${created.id}/reindex`,
      {},
      await editor('a'),
    );
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: 'processing', chunk_count: 0 });
    expect(again.json().job_id).not.toBe(created.job_id);
    const job = await owner.knowledgeJob.findUniqueOrThrow({ where: { id: again.json().job_id } });
    expect(job.kind).toBe('document');
  });

  // --- The original ------------------------------------------------------------

  it('hands out a five-minute link to the original, and no other door opens it', async () => {
    const bytes = pdf(['Sorumlu oyun politikası.']);
    const { uploadId } = await upload('a', bytes);
    const created = (
      await createSource('a', { upload_id: uploadId, name: 'Sorumlu "oyun" politikası' })
    ).json();

    const before = Math.floor(Date.now() / 1000);
    const linked = await server.get(
      `/knowledge-sources/${created.id}/file`,
      await headers('a', ['agents-bot--all:ro']),
    );
    expect(linked.statusCode).toBe(200);
    const link = linked.json();
    expect(link).toMatchObject({
      filename: 'Sorumlu "oyun" politikası.pdf',
      content_type: PDF,
      size_bytes: bytes.byteLength,
    });
    const expiresAt = Date.parse(link.expires_at) / 1000;
    expect(expiresAt - before).toBeGreaterThanOrEqual(299);
    expect(expiresAt - before).toBeLessThanOrEqual(301);
    expect(link.url).toMatch(new RegExp(`^/api/v1/knowledge-files/${uploadId}\\?`));

    // No session: the link is the authorisation.
    const fetched = await server.app.inject({ method: 'GET', url: link.url });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.rawPayload.equals(bytes)).toBe(true);
    expect(fetched.headers['content-type']).toBe(PDF);
    expect(fetched.headers['content-disposition']).toBe(
      `attachment; filename="Sorumlu _oyun_ politikas_.pdf"; filename*=UTF-8''${encodeURIComponent(
        'Sorumlu "oyun" politikası.pdf',
      )}`,
    );
    expect(fetched.headers['cache-control']).toBe('no-store');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');

    // A changed filename, a changed signature, and an expired link all fail alike.
    const url = new URL(link.url, 'http://api.test');
    const tampered = [
      (() => {
        const u = new URL(url);
        u.searchParams.set('filename', 'other.pdf');
        return u;
      })(),
      (() => {
        const u = new URL(url);
        u.searchParams.set('signature', `${u.searchParams.get('signature')}A`);
        return u;
      })(),
    ];
    const signer = new KnowledgeDownloadSigner(testEnv().UPLOAD_SIGNING_KEY);
    const stale = { key: uploadId, filename: 'x.pdf', expiresAt: before - 1 };
    tampered.push(
      new URL(
        `/api/v1/knowledge-files/${uploadId}?filename=x.pdf&expires_at=${stale.expiresAt}&signature=${signer.sign(stale)}`,
        'http://api.test',
      ),
    );
    for (const u of tampered) {
      const refused = await server.app.inject({ method: 'GET', url: `${u.pathname}${u.search}` });
      expect(refused.statusCode, u.search).toBe(403);
      expect(refused.rawPayload.includes(Buffer.from('%PDF-'))).toBe(false);
    }

    // Another workspace cannot even get a link.
    const foreign = await server.get(`/knowledge-sources/${created.id}/file`, await editor('b'));
    expect(foreign.statusCode).toBe(404);
  });

  it('has no original for any other source', async () => {
    const article = await server.post(
      '/knowledge-sources',
      { ai_agent_id: agentA, name: 'SSS', type: 'faq', content: 'Soru? Cevap.' },
      await editor('a'),
    );
    expect(article.statusCode).toBe(201);
    const response = await server.get(
      `/knowledge-sources/${article.json().id}/file`,
      await editor('a'),
    );
    expect(response.statusCode).toBe(404);
    expect(article.json()).toMatchObject({ file_mime: null, file_size: null, file_sha256: null });
  });

  // --- The schema --------------------------------------------------------------

  describe('schema', () => {
    const uuid = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const row = (licenseId: bigint, aiAgentId: string, file: Record<string, unknown>) =>
      owner.knowledgeSource.create({
        data: { licenseId, aiAgentId, type: 'file', name: 'x', status: 'processing', ...file },
      });

    it("refuses an original under another workspace's key, a mismatched type, or half the fields", async () => {
      const good = {
        fileKey: `${fx.a.licenseId}-k-${uuid}.pdf`,
        fileMime: PDF,
        fileSize: 10,
        fileSha256: 'a'.repeat(64),
      };
      for (const bad of [
        { ...good, fileKey: `${fx.b.licenseId}-k-${uuid}.pdf` },
        { ...good, fileMime: KNOWLEDGE_DOCUMENT_DOCX },
        { ...good, fileKey: `${fx.a.licenseId}-k-${uuid}.docx` },
        { ...good, fileSize: KNOWLEDGE_DOCUMENT_LIMITS.maxBytes + 1 },
        { ...good, fileSha256: 'A'.repeat(64) },
        { fileKey: good.fileKey },
      ]) {
        await expect(row(fx.a.licenseId, agentA, bad), JSON.stringify(bad)).rejects.toThrow(
          /knowledge_sources_file_check/,
        );
      }
      await expect(row(fx.a.licenseId, agentA, good)).resolves.toMatchObject({
        fileKey: good.fileKey,
      });
      // A website cannot carry an original.
      await expect(
        owner.knowledgeSource.create({
          data: {
            licenseId: fx.a.licenseId,
            aiAgentId: agentA,
            type: 'website',
            name: 'y',
            ...good,
            fileKey: `${fx.a.licenseId}-k-${uuid.replace('0f', '1f')}.pdf`,
            fileSha256: 'b'.repeat(64),
          },
        }),
      ).rejects.toThrow(/knowledge_sources_file_check/);
    });

    it('holds one source per file per workspace, and a chunk to an ordered page range', async () => {
      const file = (key: string) => ({
        fileKey: `${fx.a.licenseId}-k-${key}.pdf`,
        fileMime: PDF,
        fileSize: 10,
        fileSha256: 'c'.repeat(64),
      });
      const kept = await row(fx.a.licenseId, agentA, file(uuid));
      await expect(row(fx.a.licenseId, agentA, file(uuid.replace('0f', '2f')))).rejects.toThrow(
        /Unique constraint/,
      );

      const chunk = (pages: Record<string, unknown>) =>
        owner.knowledgeChunk.create({
          data: { sourceId: kept.id, licenseId: fx.a.licenseId, chunkText: 't', ...pages },
        });
      await expect(chunk({ pageFrom: 3, pageTo: 2 })).rejects.toThrow(
        /knowledge_chunks_pages_check/,
      );
      await expect(chunk({ pageFrom: 0, pageTo: 1 })).rejects.toThrow(
        /knowledge_chunks_pages_check/,
      );
      await expect(chunk({ pageFrom: 2 })).rejects.toThrow(/knowledge_chunks_pages_check/);
      await expect(chunk({ heading: '' })).rejects.toThrow(/knowledge_chunks_heading_check/);
      await expect(chunk({ pageFrom: 2, pageTo: 4, heading: 'Çekim' })).resolves.toMatchObject({
        pageFrom: 2,
        pageTo: 4,
      });
    });
  });
});
