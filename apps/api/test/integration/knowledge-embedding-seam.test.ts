/**
 * The embedding seam, through the real server and database (tm 255.7).
 *
 * `buildServer({ embeddings })` takes a provider the way it takes a mailer or a
 * model. These suites hand it a recorder whose vectors live in their own space
 * (`fake-embedding-provider.ts`: the stub's geometry, rotated) and ask four
 * questions of it:
 *
 *   1. Does indexing go through the provider — one call per source — and does
 *      retrieval then find the same text, in that provider's space?
 *   2. When the provider cannot embed, does indexing fail *and say so*, with
 *      nothing written — on every path that indexes?
 *   3. When it cannot embed a customer's question, does retrieval come back
 *      empty and the conversation go to a human, with the model never asked?
 *   4. Does the residency gate stand in front of the embedding provider too
 *      (NFR-C4)? A covered workspace on an out-of-region embedder is refused
 *      with no call made.
 */
import type { PrismaClient } from '@prisma/client';
import { chunk, embed, toVectorLiteral } from '@nexa/ai-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantClient } from '../../src/lib/tenant.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { EmbeddingProviderError } from '../../src/services/ai/provider/embedding-error.js';
import {
  FAKE_EMBEDDING_SPACE,
  FakeEmbeddingProvider,
  fakeEmbedding,
} from '../helpers/fake-embedding-provider.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DELIVERY = 'Standard delivery takes three to five working days across the EU.';
const ARTICLE = [
  'Refunds are issued to the original payment method within five working days.',
  DELIVERY,
  'Returns are accepted within thirty days if the item is unused.',
].join('\n\n');
const QUESTION = 'How long does delivery take?';

/** A real embedder configured for Europe on a US deployment — the refusing shape. */
const OUT_OF_REGION_EMBEDDER = {
  NEXA_REGION: 'us',
  EMBEDDING_PROVIDER: 'openai',
  EMBEDDING_PROVIDER_REGION: 'eu',
  EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  // Not a credential: the injected recorder stands in for the adapter.
  EMBEDDING_API_KEY: 'test-only-not-a-key',
};

interface ErrorBody {
  error: { type: string; message: string; details?: Record<string, unknown> };
}

describe('the embedding seam (FR-MOD-06.3.2)', () => {
  let owner: PrismaClient;
  let seq = 0;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  /** A workspace with an AI agent, a knowledge skill, a copilot and a token for all of it. */
  async function seedWorkspace(options: { region?: 'eu' | 'us'; baaSigned?: boolean } = {}) {
    seq += 1;
    const slug = `emb${seq}-${Date.now()}`;
    const organization = await owner.organization.create({
      data: { name: `Org ${slug}`, region: options.region ?? 'eu' },
      select: { id: true },
    });
    const license = await owner.license.create({
      data: {
        organizationId: organization.id,
        plan: 'growth',
        status: 'active',
        ...(options.baaSigned ? { hipaaBaaSignedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    const ownerAccount = await owner.account.create({
      data: { email: `owner-${slug}@example.test`, name: `Owner ${slug}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: license.id, agentId: ownerAccount.id, role: 'owner' },
    });
    const trustedDomain = `shop-${slug}.example.test`;
    await owner.trustedDomain.create({
      data: {
        organizationId: organization.id,
        licenseId: license.id,
        domain: trustedDomain,
        includeSubdomains: true,
      },
    });
    const aiAgent = await owner.aiAgent.create({
      data: { licenseId: license.id, kind: 'ai_agent', name: 'Ada', active: true },
      select: { id: true },
    });
    const copilot = await owner.aiAgent.create({
      data: { licenseId: license.id, kind: 'copilot', name: 'Copilot', active: true },
      select: { id: true },
    });
    const skill = await owner.skill.create({
      data: {
        licenseId: license.id,
        aiAgentId: aiAgent.id,
        name: 'Delivery',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
          { type: 'send_message', source: 'knowledge' },
        ],
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const token = await grantToken(owner, {
      licenseId: license.id,
      organizationId: organization.id,
      ownerId: ownerAccount.id,
      scopes: ['agents-bot--all:rw', 'agents-bot--all:ro', 'chats--all:rw'],
    });
    return {
      organizationId: organization.id,
      licenseId: license.id,
      trustedDomain,
      aiAgentId: aiAgent.id,
      copilotId: copilot.id,
      skillId: skill.id,
      auth: { authorization: `Bearer ${token}` },
    };
  }

  type Workspace = Awaited<ReturnType<typeof seedWorkspace>>;

  function addArticle(server: TestServer, ws: Workspace, content = ARTICLE) {
    return server.post(
      '/knowledge-sources',
      { ai_agent_id: ws.aiAgentId, name: 'Help centre', type: 'article', content },
      ws.auth,
    );
  }

  /** A customer writes in through the widget; returns the chat and its events. */
  async function customerAsks(server: TestServer, ws: Workspace, text: string) {
    const minted = await server.post(
      '/customer/token',
      { organization_id: ws.organizationId },
      { origin: `https://${ws.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const { token } = minted.json() as { token: string };
    const sent = await server.post(
      '/customer/chat/events',
      { text },
      { authorization: `Bearer ${token}` },
    );
    expect(sent.statusCode).toBe(201);
    const chatId = (sent.json() as { chat_id: string }).chat_id;
    const events = await owner.event.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true },
    });
    return { chatId, events };
  }

  async function chunksOf(licenseId: bigint) {
    return owner.$queryRaw<Array<{ id: string; chunk_text: string; embedding_space: string }>>`
      SELECT id, chunk_text, embedding_space FROM knowledge_chunks
      WHERE license_id = ${licenseId} ORDER BY position, id`;
  }

  /** Cosine similarity between a stored chunk's vector and `vector`. */
  async function similarityTo(chunkId: string, vector: number[]): Promise<number> {
    const rows = await owner.$queryRaw<Array<{ similarity: number }>>`
      SELECT (1 - (embedding <=> ${toVectorLiteral(vector)}::vector))::float8 AS similarity
      FROM knowledge_chunks WHERE id = ${chunkId}::uuid`;
    return Number(rows[0]!.similarity);
  }

  async function lastRun(ws: Workspace) {
    const run = await owner.skillRun.findFirst({
      where: { skillId: ws.skillId },
      orderBy: { ranAt: 'desc' },
    });
    return run as unknown as {
      status: string;
      log: { outcome: string; entries: Array<{ step: string; detail: string; ok: boolean }> };
    } | null;
  }

  describe('indexing and retrieval go through the provider', () => {
    const embeddings = new FakeEmbeddingProvider();
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer({}, { embeddings });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(server.app);
      embeddings.reset();
      embeddings.failWith(undefined);
    });

    it('embeds a source in one call and stores its vectors in the provider’s space', async () => {
      const ws = await seedWorkspace();

      const created = await addArticle(server, ws);

      expect(created.statusCode).toBe(201);
      expect((created.json() as { chunk_count: number }).chunk_count).toBe(3);
      // One request for the three chunks — never one per chunk.
      expect(embeddings.calls).toEqual([chunk(ARTICLE)]);

      const stored = await chunksOf(ws.licenseId);
      expect(stored.map((row) => row.chunk_text)).toEqual(chunk(ARTICLE));
      for (const row of stored) {
        expect(row.embedding_space).toBe(FAKE_EMBEDDING_SPACE);
        // The provider's vector, not the stub's.
        expect(await similarityTo(row.id, fakeEmbedding(row.chunk_text))).toBeCloseTo(1, 5);
        expect(await similarityTo(row.id, embed(row.chunk_text))).toBeLessThan(0.5);
      }
    });

    it('answers a customer from what was indexed, embedding the question with the same provider', async () => {
      const ws = await seedWorkspace();
      expect((await addArticle(server, ws)).statusCode).toBe(201);
      embeddings.reset();

      const { events } = await customerAsks(server, ws, QUESTION);

      expect(embeddings.calls).toEqual([[QUESTION]]);
      // The stub model stitches the retrieved passage: the delivery paragraph.
      const bot = events.filter((event) => event.authorType === 'bot');
      expect(bot).toHaveLength(1);
      expect(bot[0]!.text).toContain(DELIVERY);
      const run = await lastRun(ws);
      expect(run?.status).toBe('succeeded');
      expect(run?.log.outcome).toBe('answered');
    });

    it('finds the same text through the service, in the provider’s space only', async () => {
      const ws = await seedWorkspace();
      expect((await addArticle(server, ws)).statusCode).toBe(201);
      const context = { licenseId: ws.licenseId, organizationId: ws.organizationId };

      const sameSpace = new KnowledgeService({ embeddings: new FakeEmbeddingProvider() });
      const hits = await sameSpace.retrieve(
        owner as TenantClient,
        context,
        await sameSpace.embedQuery(QUESTION),
        { aiAgentId: ws.aiAgentId },
      );
      expect(hits[0]?.text).toBe(DELIVERY);

      // The stub asks in its own space, and this knowledge base is not in it.
      const lexical = new KnowledgeService({
        embeddings: new FakeEmbeddingProvider({ space: 'mock:lexical-v1', vector: embed }),
      });
      const search = await lexical.search(
        owner as TenantClient,
        context,
        await lexical.embedQuery(QUESTION),
        { aiAgentId: ws.aiAgentId },
      );
      expect(search).toMatchObject({ chunksInScope: 0, chunks: [] });
    });
  });

  describe('indexing fails and says so when the provider cannot embed — nothing is written', () => {
    const embeddings = new FakeEmbeddingProvider();
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer({}, { embeddings });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(server.app);
      embeddings.reset();
      embeddings.failWith(undefined);
    });

    const expect503 = (response: { statusCode: number; json: () => unknown }, kind: string) => {
      expect(response.statusCode).toBe(503);
      const body = response.json() as ErrorBody;
      expect(body.error.type).toBe('service_unavailable');
      expect(body.error.details).toEqual({ kind });
      expect(body.error.message).toContain('Nothing was saved');
    };

    it('refuses a new source, a file and a copilot source without creating any of them', async () => {
      const ws = await seedWorkspace();
      embeddings.failWith(new EmbeddingProviderError('unavailable'));

      expect503(await addArticle(server, ws), 'unavailable');
      expect503(
        await server.post(
          '/knowledge-sources/file',
          {
            ai_agent_id: ws.aiAgentId,
            filename: 'delivery.txt',
            content_type: 'text/plain',
            data: Buffer.from(ARTICLE).toString('base64'),
          },
          ws.auth,
        ),
        'unavailable',
      );
      expect503(
        await server.post('/copilot/knowledge', { name: 'Playbook', content: ARTICLE }, ws.auth),
        'unavailable',
      );

      expect(embeddings.calls).toHaveLength(3);
      expect(await owner.knowledgeSource.count({ where: { licenseId: ws.licenseId } })).toBe(0);
      expect(await owner.knowledgeChunk.count({ where: { licenseId: ws.licenseId } })).toBe(0);
    });

    it('refuses an edit and a reindex, leaving the source’s text and chunks as they were', async () => {
      const ws = await seedWorkspace();
      const created = await addArticle(server, ws);
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };
      const before = await chunksOf(ws.licenseId);
      embeddings.failWith(new EmbeddingProviderError('timeout'));

      expect503(
        await server.patch(
          `/knowledge-sources/${id}`,
          { name: 'Renamed', content: 'Everything ships next day now.' },
          ws.auth,
        ),
        'timeout',
      );
      expect503(await server.post(`/knowledge-sources/${id}/reindex`, {}, ws.auth), 'timeout');

      const source = await owner.knowledgeSource.findUniqueOrThrow({ where: { id } });
      // The rename was refused with the rest of the edit.
      expect(source).toMatchObject({ name: 'Help centre', content: ARTICLE, status: 'ready' });
      expect(await chunksOf(ws.licenseId)).toEqual(before);
    });

    it('fails a bulk row the provider cannot embed and imports the rest', async () => {
      const ws = await seedWorkspace();
      // The first row embeds; from the second call on, the provider is down.
      const failing = new FakeEmbeddingProvider({
        fail: new EmbeddingProviderError('rate_limited'),
        failFrom: 2,
      });
      const bulkServer = await startTestServer({}, { embeddings: failing });
      try {
        const response = await bulkServer.post(
          '/knowledge-sources/bulk',
          {
            ai_agent_id: ws.aiAgentId,
            csv: [
              'name,type,content,source_url',
              `Delivery,article,${DELIVERY},`,
              'Refunds,article,Refunds take five working days.,',
            ].join('\n'),
          },
          ws.auth,
        );

        expect(response.statusCode).toBe(200);
        const body = response.json() as {
          imported: number;
          failed: number;
          results: Array<{ name: string; status: string; error: string | null }>;
        };
        expect(body).toMatchObject({ imported: 1, failed: 1 });
        expect(body.results[1]).toMatchObject({
          name: 'Refunds',
          status: 'skipped',
          error:
            'This row could not be indexed: the embedding provider did not answer (rate_limited).',
        });
        const sources = await owner.knowledgeSource.findMany({
          where: { licenseId: ws.licenseId },
          select: { name: true },
        });
        expect(sources.map((source) => source.name)).toEqual(['Delivery']);
      } finally {
        await bulkServer.close();
      }
    });
  });

  describe('a question the provider cannot embed goes to a human (FR-MOD-06.3.2)', () => {
    const embeddings = new FakeEmbeddingProvider();
    const llm = new FakeLlmProvider();
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer({}, { embeddings, llm });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(server.app);
      embeddings.reset();
      embeddings.failWith(undefined);
      llm.reset();
    });

    it('returns nothing, never asks the model, and leaves the message for a human', async () => {
      const ws = await seedWorkspace();
      expect((await addArticle(server, ws)).statusCode).toBe(201);
      embeddings.reset();
      embeddings.failWith(new EmbeddingProviderError('timeout'));

      const { events } = await customerAsks(server, ws, QUESTION);

      // The question reached the provider, and nothing else happened after it.
      expect(embeddings.calls).toEqual([[QUESTION]]);
      expect(llm.calls).toHaveLength(0);
      expect(events.some((event) => event.text === QUESTION)).toBe(true);
      expect(events.some((event) => event.authorType === 'bot')).toBe(false);

      const run = await lastRun(ws);
      expect(run?.status).toBe('failed');
      expect(run?.log.outcome).toBe('handed_off');
      expect(run?.log.entries.find((entry) => entry.step === 'send_message')).toEqual({
        step: 'send_message',
        detail: 'the knowledge search could not run (timeout) — handed to a human',
        ok: false,
      });
    });

    it('drafts nothing for the agent rather than a draft from a search that did not run', async () => {
      const ws = await seedWorkspace();
      const created = await server.post(
        '/copilot/knowledge',
        { name: 'Playbook', content: ARTICLE },
        ws.auth,
      );
      expect(created.statusCode).toBe(201);
      const { chatId } = await customerAsks(server, ws, QUESTION);
      embeddings.reset();
      embeddings.failWith(new EmbeddingProviderError('unavailable'));

      const drafted = await server.post(`/copilot/chats/${chatId}/reply`, {}, ws.auth);

      expect(drafted.statusCode).toBe(200);
      expect(drafted.json()).toEqual({ draft: '', sources: [] });
      expect(embeddings.calls).toEqual([[QUESTION]]);
    });
  });

  describe('the residency gate stands in front of the embedding provider (NFR-C4)', () => {
    const embeddings = new FakeEmbeddingProvider();
    let outOfRegion: TestServer;

    beforeAll(async () => {
      outOfRegion = await startTestServer(OUT_OF_REGION_EMBEDDER, { embeddings });
    });

    afterAll(async () => {
      await outOfRegion.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(outOfRegion.app);
      embeddings.reset();
    });

    it('refuses a covered workspace before any text reaches the provider', async () => {
      const covered = await seedWorkspace({ region: 'us', baaSigned: true });

      const refused = await addArticle(outOfRegion, covered);
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as ErrorBody).error.type).toBe('not_allowed');

      const { events } = await customerAsks(outOfRegion, covered, QUESTION);
      expect(events.some((event) => event.authorType === 'bot')).toBe(false);

      // Neither the article nor the customer's question was embedded.
      expect(embeddings.calls).toHaveLength(0);
      expect(await owner.knowledgeSource.count({ where: { licenseId: covered.licenseId } })).toBe(
        0,
      );
      const blocked = await owner.auditLogEntry.findMany({
        where: { licenseId: covered.licenseId, action: 'compliance.ai_region_blocked' },
      });
      expect(blocked).toHaveLength(2);
      for (const entry of blocked) {
        expect(entry.metadata).toMatchObject({
          provider: 'openai',
          provider_kind: 'embedding',
          provider_region: 'eu',
          region: 'us',
        });
      }
    });

    it('lets an uncovered workspace on the same deployment embed', async () => {
      const plain = await seedWorkspace({ region: 'us', baaSigned: false });

      expect((await addArticle(outOfRegion, plain)).statusCode).toBe(201);
      expect(embeddings.calls).toEqual([chunk(ARTICLE)]);
    });
  });
});
