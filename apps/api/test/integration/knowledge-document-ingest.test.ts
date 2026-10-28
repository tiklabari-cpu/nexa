/**
 * PDF and Word knowledge sources, the reading half (tm 313.3 · AI-18) — the
 * `document` job from a `processing` source to chunks that carry their pages,
 * and the original's life after: replaced on a re-read, removed with its
 * source, swept when nothing holds it.
 *
 * Documents are read by the real isolated worker (`parseDocumentInWorker`) — a
 * process per document — and embedded by a recording fake provider, so what is
 * asserted is the whole path from the stored bytes to `knowledge_chunks`.
 *
 * What has to hold:
 *
 *   - a text PDF becomes `ready` with chunks whose `page_from`/`page_to` name
 *     the pages their text is on, and the source's `page_count`;
 *   - a Word document keeps its headings (on the chunk) and its tables
 *     (`| a | b |` lines);
 *   - an encrypted or scanned PDF ends the job and the source with the code the
 *     panel has a sentence for, and writes nothing to the knowledge base;
 *   - a re-read that cannot read keeps the chunks of the last one (`partial`);
 *   - the day's AI allowance parks the job before anything is embedded, and the
 *     source goes on `processing` until it is read;
 *   - a provider that does not answer is retried later, not failed;
 *   - deleting the source deletes the original; an object nothing holds is
 *     swept once it is a day old, and not before.
 */
import { mkdtempSync, existsSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_DOCUMENT_DOCX } from '@siyahtus/types';
import { AiDailyCapError, nextUtcMidnight } from '../../src/services/ai/ai-daily-budget.js';
import { KnowledgeDocumentObjectSweeper } from '../../src/services/ai/knowledge-document-sweep.js';
import { EmbeddingProviderError } from '../../src/services/ai/provider/embedding-error.js';
import { LocalStore } from '../../src/services/storage/local-store.js';
import { buildKnowledgeKey } from '../../src/services/storage/upload-url.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import {
  imagePage,
  linesPdf,
  pdfDocument,
  wParagraph,
  wStyles,
  wTable,
  wordDocument,
} from '../helpers/document-fixtures.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const PDF = 'application/pdf';

/** A page of lines, top to bottom, in the body size. */
const page = (...texts: string[]) => texts.map((text, index) => ({ text, y: 700 - index * 18 }));

/** A line a text layer is made of: over the 50 characters a page needs to count as text. */
const SHORT = 'Çevrim şartı bonus tutarının 35 katıdır ve yalnızca slot oyunlarında geçerlidir.';

/** Twelve lines of rules — a page of more than one chunk. */
const rules = (word: string) =>
  page(
    ...Array.from(
      { length: 12 },
      (_, i) => `${word} kurali ${i + 1}: oyuncu sarti yerine getirmelidir.`,
    ),
  );

describe('knowledge documents — the document job (AI-18 · tm 313.3)', () => {
  let owner: PrismaClient;
  let appDb: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentA: string;
  const embeddings = new FakeEmbeddingProvider();
  const storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-doc-ingest-'));
  const store = new LocalStore(storageDir);

  const auth = async () => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    })}`,
  });

  /** Grant → PUT → create the source; the job has run when this returns. */
  async function addDocument(bytes: Buffer, contentType = PDF, name = 'Belge') {
    const granted = (
      await server.post(
        '/uploads',
        { content_type: contentType, size_bytes: bytes.byteLength, purpose: 'knowledge_document' },
        await auth(),
      )
    ).json();
    const put = await server.app.inject({
      method: 'PUT',
      url: granted.upload_url as string,
      headers: { 'content-type': contentType },
      payload: bytes,
    });
    expect(put.statusCode).toBeLessThan(300);
    const response = await server.post(
      '/knowledge-sources/document',
      { ai_agent_id: agentA, upload_id: granted.upload_id, name },
      await auth(),
    );
    expect(response.statusCode).toBe(201);
    return { id: response.json().id as string, key: granted.upload_id as string };
  }

  const sourceRow = (id: string) => owner.knowledgeSource.findUniqueOrThrow({ where: { id } });
  const chunksOf = (id: string) =>
    owner.knowledgeChunk.findMany({ where: { sourceId: id }, orderBy: { position: 'asc' } });
  const lastJob = (sourceId: string) =>
    owner.knowledgeJob.findFirstOrThrow({ where: { sourceId }, orderBy: { createdAt: 'desc' } });
  const original = (key: string) =>
    existsSync(join(storageDir, String(fx.a.licenseId), 'knowledge', key));

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appDb = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({ STORAGE_LOCAL_DIR: storageDir }, { embeddings });
  });

  afterAll(async () => {
    await server.close();
    await appDb.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    embeddings.failWith(undefined);
    agentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      })
    ).id;
  });

  it('reads a text PDF into chunks that carry their pages and settles the source ready (FR-MOD-06.3.2)', async () => {
    const bytes = linesPdf([
      [{ text: 'Birinci sayfa', y: 740 }, ...rules('Bonus')],
      [{ text: 'İkinci sayfa', y: 740 }, ...rules('Cekim')],
    ]);

    const { id } = await addDocument(bytes);

    const source = await sourceRow(id);
    expect(source).toMatchObject({ status: 'ready', pageCount: 2, lastRefreshError: null });
    const chunks = await chunksOf(id);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.min(...chunks.map((c) => c.pageFrom!))).toBe(1);
    expect(Math.max(...chunks.map((c) => c.pageTo!))).toBe(2);
    // Each chunk's pages hold its text: the Çekim rules are on page 2 only.
    const withdrawal = chunks.filter((c) => c.chunkText.includes('Cekim kurali'));
    expect(withdrawal.length).toBeGreaterThan(0);
    for (const chunk of withdrawal) expect(chunk.pageFrom).toBe(2);
    for (const chunk of chunks) {
      expect(chunk.pageFrom).toBeLessThanOrEqual(chunk.pageTo!);
      expect(chunk.chunkText.length).toBeLessThanOrEqual(600);
    }
    const job = await lastJob(id);
    expect(job).toMatchObject({ status: 'done', error: null, pagesOk: 2, pagesDone: 2 });
  });

  it('keeps a Word document’s headings on its chunks and its tables as | a | b | lines', async () => {
    const bytes = wordDocument({
      styles: wStyles([{ id: 'Heading1', name: 'heading 1' }]),
      body:
        wParagraph('Çekim limitleri', { style: 'Heading1' }) +
        wParagraph('Limitler üyelik düzeyine göre değişir.') +
        wTable([
          ['Düzey', 'Günlük limit'],
          ['Gümüş', '5.000 TL'],
        ]),
    });

    const { id } = await addDocument(bytes, KNOWLEDGE_DOCUMENT_DOCX);

    expect(await sourceRow(id)).toMatchObject({ status: 'ready' });
    const chunks = await chunksOf(id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('Çekim limitleri');
    expect(chunks[0]!.chunkText).toContain('| Düzey | Günlük limit |');
    expect(chunks[0]!.chunkText).toContain('| Gümüş | 5.000 TL |');
  });

  it('ends an encrypted PDF and a scanned one with their code and writes nothing (AI-18)', async () => {
    const encrypted = await addDocument(
      pdfDocument([{ content: 'BT /F1 12 Tf 72 700 Td (Gizli) Tj ET' }], {
        encrypt: { userPassword: 'parola', ownerPassword: 'sahip' },
      }),
      PDF,
      'Şifreli',
    );
    const scanned = await addDocument(pdfDocument([imagePage()]), PDF, 'Taranmış');

    for (const [added, code] of [
      [encrypted, 'encrypted'],
      [scanned, 'no_text_layer'],
    ] as const) {
      expect(await sourceRow(added.id)).toMatchObject({ status: 'failed', lastRefreshError: code });
      expect(await lastJob(added.id)).toMatchObject({ status: 'failed', error: code });
      expect(await chunksOf(added.id)).toHaveLength(0);
    }
  });

  it('re-reads on reindex, replacing the chunks — and keeps them, partial, when the original cannot be read', async () => {
    const { id, key } = await addDocument(linesPdf([page(SHORT)]));
    const before = await chunksOf(id);
    expect(before).toHaveLength(1);

    const again = await server.post(`/knowledge-sources/${id}/reindex`, undefined, await auth());
    expect(again.statusCode).toBe(200);
    const after = await chunksOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(before[0]!.id);
    expect(await sourceRow(id)).toMatchObject({ status: 'ready' });

    // The original goes missing (a store restored from before it was written).
    await store.delete(key);
    await server.post(`/knowledge-sources/${id}/reindex`, undefined, await auth());
    expect(await sourceRow(id)).toMatchObject({
      status: 'partial',
      lastRefreshError: 'parse_failed',
    });
    expect(await lastJob(id)).toMatchObject({ status: 'failed', error: 'original_missing' });
    expect((await chunksOf(id)).map((c) => c.id)).toEqual(after.map((c) => c.id));
  });

  it('parks the job until UTC midnight when the day’s allowance is used up, with nothing embedded, then reads on', async () => {
    embeddings.failWith(new AiDailyCapError('embedding', 'workspace', 60));

    const { id } = await addDocument(linesPdf([page(SHORT)]));

    const job = await lastJob(id);
    expect(job.status).toBe('waiting_budget');
    expect(job.availableAt.getTime()).toBeGreaterThanOrEqual(
      nextUtcMidnight(new Date()).getTime() - 1000,
    );
    expect(await sourceRow(id)).toMatchObject({ status: 'processing' });
    expect(await chunksOf(id)).toHaveLength(0);

    embeddings.failWith(undefined);
    await owner.knowledgeJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    server.app.knowledgeJobs.wake();
    await server.app.knowledgeJobs.idle();

    expect(await sourceRow(id)).toMatchObject({ status: 'ready' });
    expect((await chunksOf(id)).length).toBeGreaterThan(0);
  });

  it('hands the job back for later when the embedding provider does not answer', async () => {
    embeddings.failWith(new EmbeddingProviderError('unavailable'));

    const { id } = await addDocument(linesPdf([page(SHORT)]));

    const job = await lastJob(id);
    expect(job.status).toBe('queued');
    expect(job.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(await sourceRow(id)).toMatchObject({ status: 'processing' });
  });

  it('removes the original with its source, and the chunks with it', async () => {
    const { id, key } = await addDocument(linesPdf([page(SHORT)]));
    expect(original(key)).toBe(true);
    expect((await chunksOf(id)).length).toBeGreaterThan(0);

    const deleted = await server.del(`/knowledge-sources/${id}`, await auth());

    expect(deleted.statusCode).toBe(204);
    expect(original(key)).toBe(false);
    expect(await owner.knowledgeSource.count({ where: { id } })).toBe(0);
    expect(await chunksOf(id)).toHaveLength(0);
  });

  it('sweeps an original no source holds once it is a day old, and nothing else', async () => {
    const held = await addDocument(linesPdf([page(SHORT)]));
    const license = fx.a.licenseId;
    const orphanOld = buildKnowledgeKey(license, PDF);
    const orphanYoung = buildKnowledgeKey(license, PDF);
    await store.put(orphanOld, Buffer.from('%PDF-1.4 old'), PDF);
    await store.put(orphanYoung, Buffer.from('%PDF-1.4 young'), PDF);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const key of [orphanOld, held.key]) {
      await utimes(join(storageDir, String(license), 'knowledge', key), twoDaysAgo, twoDaysAgo);
    }

    const report = await new KnowledgeDocumentObjectSweeper(appDb, store).run();

    const mine = report.tenants.find((t) => t.licenseId === String(license))!;
    expect(mine).toMatchObject({ removed: 1, failed: 0 });
    expect(original(orphanOld)).toBe(false);
    expect(original(orphanYoung)).toBe(true);
    // Old, but a source holds it.
    expect(original(held.key)).toBe(true);
  });
});
