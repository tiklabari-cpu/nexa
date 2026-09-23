/**
 * Re-embedding a stored knowledge base (tm 255.7 · PLAN §D182), against real
 * Postgres, through the runtime role with RLS on — the way `knowledge:reembed`
 * runs it.
 *
 * The knowledge base starts where every deployment's does: in the lexical
 * stub's space, written by `KnowledgeService.index`. The target is the fake
 * provider's space — the stub's geometry rotated, so within it retrieval finds
 * what the stub finds, and across spaces nothing lines up
 * (`fake-embedding-provider.ts`). What is held to account:
 *
 *   (5) atomic per source; an interrupted run resumes to the same result; a
 *       search made while it runs does not fail and does not cross spaces;
 *       reversible, back to the very same vectors;
 *   (6) the mixed state — a source partly in each space — is measured, and a
 *       search of it answers from its own space only, even when a chunk of
 *       the other space is the nearest vector there is.
 */
import { PrismaClient } from '@prisma/client';
import { LEXICAL_EMBEDDING_SPACE, embed, toVectorLiteral } from '@nexa/ai-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import type { InferenceProvider } from '../../src/services/ai/inference.js';
import {
  KnowledgeReembedder,
  type ReembedSourceEvent,
} from '../../src/services/ai/knowledge-reembed.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { EmbeddingProviderError } from '../../src/services/ai/provider/embedding-error.js';
import type {
  EmbeddingProvider,
  Embeddings,
} from '../../src/services/ai/provider/embedding-provider.js';
import { MockEmbeddingProvider } from '../../src/services/ai/provider/mock-embedding-provider.js';
import {
  FAKE_EMBEDDING_SPACE,
  FakeEmbeddingProvider,
  fakeEmbedding,
} from '../helpers/fake-embedding-provider.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** Where the fake provider runs in these tests: the fixtures' own region. */
const IN_REGION: InferenceProvider = { id: 'openai', region: 'eu' };

const SOURCES = {
  delivery: [
    'Standard delivery takes three to five working days across the EU.',
    'Express delivery arrives the next working day when ordered before noon.',
  ],
  refunds: [
    'Refunds are issued to the original payment method within five working days.',
    'A refund for a damaged item does not need the item to be returned.',
  ],
  vouchers: [
    'Gift vouchers never expire and can be spent online or in store.',
    'A voucher code can be used once, for any part of its value.',
  ],
} as const;
type SourceKey = keyof typeof SOURCES;

describe('knowledge:reembed — moving a knowledge base into another embedding space (FR-MOD-06.3.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let contextA: TenantContext;
  let contextB: TenantContext;
  let agentA: string;
  /** Source ids by key: `delivery` and `refunds` in tenant A, `vouchers` in B. */
  let sources: Record<SourceKey, string>;

  const lexical = new KnowledgeService({ embeddings: new MockEmbeddingProvider() });
  const fakeSpace = new KnowledgeService({ embeddings: new FakeEmbeddingProvider() });

  beforeAll(() => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  async function seedSource(
    context: TenantContext,
    agentId: string,
    name: string,
    paragraphs: readonly string[],
  ): Promise<string> {
    const content = paragraphs.join('\n\n');
    const source = await owner.knowledgeSource.create({
      data: { aiAgentId: agentId, licenseId: context.licenseId, type: 'article', name, content },
      select: { id: true },
    });
    // The writer the routes use: what production stores, in the stub's space.
    await lexical.index(owner as TenantClient, context, source.id, await lexical.prepare(content));
    return source.id;
  }

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    contextA = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    contextB = { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId };
    const agent = (licenseId: bigint) =>
      owner.aiAgent.create({
        data: { licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      });
    agentA = (await agent(contextA.licenseId)).id;
    const agentB = (await agent(contextB.licenseId)).id;
    sources = {
      delivery: await seedSource(contextA, agentA, 'Delivery', SOURCES.delivery),
      refunds: await seedSource(contextA, agentA, 'Refunds', SOURCES.refunds),
      vouchers: await seedSource(contextB, agentB, 'Vouchers', SOURCES.vouchers),
    };
  });

  const reembedder = (embeddings: EmbeddingProvider, inference: InferenceProvider = IN_REGION) =>
    new KnowledgeReembedder(app, { embeddings, embeddingInference: inference });

  /** Every chunk as stored: its id, text, space and vector text, keyed by id. */
  async function snapshot() {
    const rows = await owner.$queryRaw<
      Array<{ id: string; source_id: string; chunk_text: string; space: string; vector: string }>
    >`
      SELECT id, source_id, chunk_text, embedding_space AS space, embedding::text AS vector
      FROM knowledge_chunks ORDER BY source_id, position, id`;
    return rows;
  }

  async function spacesOf(sourceId: string): Promise<string[]> {
    const rows = await owner.$queryRaw<Array<{ space: string }>>`
      SELECT DISTINCT embedding_space AS space FROM knowledge_chunks
      WHERE source_id = ${sourceId}::uuid ORDER BY 1`;
    return rows.map((row) => row.space);
  }

  /** How close a stored chunk is to `vector` — 1 when it is that vector. */
  async function similarityTo(chunkId: string, vector: number[]): Promise<number> {
    const rows = await owner.$queryRaw<Array<{ similarity: number }>>`
      SELECT (1 - (embedding <=> ${toVectorLiteral(vector)}::vector))::float8 AS similarity
      FROM knowledge_chunks WHERE id = ${chunkId}::uuid`;
    return Number(rows[0]!.similarity);
  }

  /** A question as the product asks it: embedded first, then searched under RLS. */
  async function ask(service: KnowledgeService, question: string) {
    const asked = await service.embedQuery(question);
    return withTenant(app, contextA, (tx) =>
      service.search(tx, contextA, asked, { aiAgentId: agentA, limit: 3 }),
    );
  }

  it('moves every source into the target space, and a question in that space finds it', async () => {
    const before = await snapshot();
    const target = new FakeEmbeddingProvider();

    const report = await reembedder(target).run();

    expect(report).toMatchObject({
      target: FAKE_EMBEDDING_SPACE,
      finished: true,
      totals: { tenants: 2, pending: 3, reembedded: 3, chunks: 6, changed: 0, failed: 0 },
    });
    // One provider call per source, never one per chunk.
    expect(target.calls.map((call) => call.length)).toEqual([2, 2, 2]);

    const after = await snapshot();
    // The same rows — same ids, same text — with new vectors in the new space.
    expect(after.map(({ id, chunk_text }) => ({ id, chunk_text }))).toEqual(
      before.map(({ id, chunk_text }) => ({ id, chunk_text })),
    );
    for (const row of after) {
      expect(row.space).toBe(FAKE_EMBEDDING_SPACE);
      expect(await similarityTo(row.id, fakeEmbedding(row.chunk_text))).toBeCloseTo(1, 5);
    }

    expect((await ask(fakeSpace, 'How long does delivery take?')).chunks[0]?.text).toBe(
      SOURCES.delivery[0],
    );
    // The stub's questions no longer find anything: nothing is in their space.
    expect(await ask(lexical, 'How long does delivery take?')).toMatchObject({
      chunksInScope: 0,
      chunks: [],
    });
  });

  it('resumes an interrupted run where the data says, to the same result', async () => {
    const target = new FakeEmbeddingProvider();

    const first = await reembedder(target).run({ limit: 1 });
    expect(first).toMatchObject({ finished: false, totals: { reembedded: 1 } });
    const halfway = await reembedder(target).status();
    expect(halfway.totals).toMatchObject({ pendingSources: 2, pendingChunks: 4, mixedSources: 0 });

    const second = await reembedder(target).run();
    expect(second).toMatchObject({ finished: true, totals: { pending: 2, reembedded: 2 } });

    // The same end state an uninterrupted run reaches: every chunk in the
    // target space, carrying exactly the target provider's vector.
    for (const row of await snapshot()) {
      expect(row.space).toBe(FAKE_EMBEDDING_SPACE);
      expect(await similarityTo(row.id, fakeEmbedding(row.chunk_text))).toBeCloseTo(1, 5);
    }

    // And a run with nothing left does nothing — not even ask the provider.
    target.reset();
    expect(await reembedder(target).run()).toMatchObject({ totals: { tenants: 0, pending: 0 } });
    expect(target.calls).toHaveLength(0);
  });

  it('keeps retrieval working while it runs — each question answered from its own space only', async () => {
    const seen: Array<{ after: string; fake: string[]; lexical: string[] }> = [];
    // Close to a paragraph of each of tenant A's two sources, in either space.
    const question = 'delivery refund working days';

    await reembedder(new FakeEmbeddingProvider()).run({
      onSource: async (event: ReembedSourceEvent) => {
        // Searches between two sources' transactions: neither may fail, and
        // each may only return chunks of the space it was asked in.
        const [fake, stub] = await Promise.all([ask(fakeSpace, question), ask(lexical, question)]);
        seen.push({
          after: event.sourceId,
          fake: fake.chunks.map((hit) => hit.sourceId),
          lexical: stub.chunks.map((hit) => hit.sourceId),
        });
      },
    });

    expect(seen).toHaveLength(3);
    for (const [step, snapshotAt] of seen.entries()) {
      const movedSoFar = new Set(seen.slice(0, step + 1).map((s) => s.after));
      for (const sourceId of snapshotAt.fake) expect(movedSoFar.has(sourceId)).toBe(true);
      for (const sourceId of snapshotAt.lexical) expect(movedSoFar.has(sourceId)).toBe(false);
    }
    // At least one step answered from both spaces at once — the mixed state
    // was really exercised, not skipped over.
    expect(seen.some((step) => step.fake.length > 0 && step.lexical.length > 0)).toBe(true);
  });

  it('leaves a source wholly in its old space when the provider fails, and finishes it next run', async () => {
    const target = new FakeEmbeddingProvider({
      fail: new EmbeddingProviderError('rate_limited'),
      failFrom: 2,
    });

    const report = await reembedder(target).run();

    expect(report.totals).toMatchObject({ reembedded: 1, failed: 2 });
    const spaces = await Promise.all(Object.values(sources).map((id) => spacesOf(id)));
    // Each source is in exactly one space — never half moved.
    expect(spaces.every((list) => list.length === 1)).toBe(true);
    expect(spaces.flat().sort()).toEqual(
      [FAKE_EMBEDDING_SPACE, LEXICAL_EMBEDDING_SPACE, LEXICAL_EMBEDDING_SPACE].sort(),
    );

    target.failWith(undefined);
    expect((await reembedder(target).run()).totals).toMatchObject({ reembedded: 2, failed: 0 });
    for (const id of Object.values(sources)) {
      expect(await spacesOf(id)).toEqual([FAKE_EMBEDDING_SPACE]);
    }
  });

  it('writes a source in one transaction: a write that fails half way rolls the whole source back', async () => {
    // The second chunk of the delivery source gets a vector pgvector refuses
    // (NaN), after the first chunk's UPDATE has already run in the same
    // transaction. Either both move or neither does.
    const poisoned = new FakeEmbeddingProvider({
      vector: (text) =>
        text === SOURCES.delivery[1]
          ? fakeEmbedding(text).map((value, i) => (i === 0 ? Number.NaN : value))
          : fakeEmbedding(text),
    });

    await expect(reembedder(poisoned).run()).rejects.toThrow();

    expect(await spacesOf(sources.delivery)).toEqual([LEXICAL_EMBEDDING_SPACE]);
    const delivery = (await snapshot()).filter((row) => row.source_id === sources.delivery);
    for (const row of delivery) {
      expect(await similarityTo(row.id, embed(row.chunk_text))).toBeCloseTo(1, 5);
    }
  });

  it('leaves a source edited while it was being embedded to the edit', async () => {
    const edited = ['Delivery is free on every order over thirty euros.'];
    const target = new FakeEmbeddingProvider();
    let editedOnce = false;
    // A provider that, while embedding the delivery source, lets an admin's
    // edit land: the edit replaces the source's chunks (new ids, new text).
    const racing: EmbeddingProvider = {
      id: target.id,
      space: target.space,
      async embed(texts: readonly string[]): Promise<Embeddings> {
        if (!editedOnce && texts.includes(SOURCES.delivery[0])) {
          editedOnce = true;
          await lexical.index(
            owner as TenantClient,
            contextA,
            sources.delivery,
            await lexical.prepare(edited.join('\n\n')),
          );
        }
        return target.embed(texts);
      },
    };

    const report = await reembedder(racing).run();

    expect(report.totals).toMatchObject({ reembedded: 2, changed: 1 });
    const delivery = (await snapshot()).filter((row) => row.source_id === sources.delivery);
    // The edit's chunks, exactly as the edit wrote them — not overwritten
    // with vectors of the text they replaced.
    expect(delivery.map((row) => row.chunk_text)).toEqual(edited);
    expect(delivery.map((row) => row.space)).toEqual([LEXICAL_EMBEDDING_SPACE]);

    // The next run picks the edited source up.
    expect((await reembedder(target).run()).totals).toMatchObject({ reembedded: 1 });
    expect(await spacesOf(sources.delivery)).toEqual([FAKE_EMBEDDING_SPACE]);
  });

  it('is reversible — back to the stub, to the very same vectors', async () => {
    const original = await snapshot();

    await reembedder(new FakeEmbeddingProvider()).run();
    expect((await snapshot()).every((row) => row.space === FAKE_EMBEDDING_SPACE)).toBe(true);

    const back = await reembedder(new MockEmbeddingProvider()).run();
    expect(back).toMatchObject({ target: LEXICAL_EMBEDDING_SPACE, totals: { reembedded: 3 } });
    expect(await snapshot()).toEqual(original);
  });

  it('refuses a covered workspace whose content the provider would take out of region (NFR-C4)', async () => {
    // A US workspace under a signed BAA, next to the uncovered EU fixtures,
    // and a provider that embeds in the EU.
    const organization = await owner.organization.create({
      data: { name: 'Covered', region: 'us' },
      select: { id: true },
    });
    const license = await owner.license.create({
      data: {
        organizationId: organization.id,
        plan: 'growth',
        status: 'active',
        hipaaBaaSignedAt: new Date(),
      },
      select: { id: true },
    });
    const covered = { licenseId: license.id, organizationId: organization.id };
    const agent = await owner.aiAgent.create({
      data: { licenseId: license.id, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    const coveredSource = await seedSource(covered, agent.id, 'Clinic', [
      'Appointments can be moved up to a day in advance.',
    ]);
    const target = new FakeEmbeddingProvider();

    const report = await reembedder(target, { id: 'openai', region: 'eu' }).run();

    const coveredResult = report.tenants.find((t) => t.licenseId === license.id.toString());
    expect(coveredResult).toMatchObject({ refused: true, reembedded: 0 });
    expect(report.totals).toMatchObject({ refused: 1, reembedded: 3 });
    // Its text never reached the provider, and its chunks never moved.
    expect(target.texts).not.toContain('Appointments can be moved up to a day in advance.');
    expect(await spacesOf(coveredSource)).toEqual([LEXICAL_EMBEDDING_SPACE]);
  });

  describe('a source in two spaces at once — the state atomicity rules out, constructed', () => {
    /** Close to the first refunds paragraph, and the question the trap below is built on. */
    const TRAP_QUESTION = 'refund original payment method';

    /**
     * Half the refunds source moved by hand, and one delivery chunk planted in
     * the fake space with the stub's own vector for the question — the nearest
     * vector there could be to a stub question, in the wrong space.
     */
    beforeEach(async () => {
      const refunds = (await snapshot()).filter((row) => row.source_id === sources.refunds);
      const moving = refunds[1]!;
      await owner.$executeRaw`
        UPDATE knowledge_chunks
        SET embedding = ${toVectorLiteral(fakeEmbedding(moving.chunk_text))}::vector,
            embedding_space = ${FAKE_EMBEDDING_SPACE}
        WHERE id = ${moving.id}::uuid`;
      const trap = (await snapshot()).find((row) => row.source_id === sources.delivery)!;
      await owner.$executeRaw`
        UPDATE knowledge_chunks
        SET embedding = ${toVectorLiteral(embed(TRAP_QUESTION))}::vector,
            embedding_space = ${FAKE_EMBEDDING_SPACE}
        WHERE id = ${trap.id}::uuid`;
    });

    it('is measured: which spaces hold what, and which sources are mixed', async () => {
      const status = await reembedder(new FakeEmbeddingProvider()).status();

      expect(status.totals).toMatchObject({ mixedSources: 2, pendingSources: 3, pendingChunks: 4 });
      const tenantA = status.tenants.find((t) => t.licenseId === contextA.licenseId.toString())!;
      expect(tenantA.spaces).toEqual(
        [
          { space: LEXICAL_EMBEDDING_SPACE, sources: 2, chunks: 2 },
          { space: FAKE_EMBEDDING_SPACE, sources: 2, chunks: 2 },
        ].sort((a, b) => (a.space < b.space ? -1 : 1)),
      );
    });

    it('answers a question from its own space only, however close the other space is', async () => {
      // A stub question whose exact vector sits in the fake space: by raw
      // distance it is the best match there is (similarity 1), and it must not
      // come back, because it is not a stub vector. What does come back is the
      // stub-space passage it genuinely resembles.
      const trapped = await ask(lexical, TRAP_QUESTION);
      expect(trapped.chunks[0]?.text).toBe(SOURCES.refunds[0]);
      for (const hit of trapped.chunks) {
        expect(hit.score).toBeLessThan(0.999);
      }
      const stored = await snapshot();
      const spaceOf = new Map(stored.map((row) => [row.id, row.space]));
      expect(trapped.chunks.every((hit) => spaceOf.get(hit.id) === LEXICAL_EMBEDDING_SPACE)).toBe(
        true,
      );

      // The same partially moved source searched from the fake side: only its
      // moved half is visible there.
      const fromFake = await ask(
        fakeSpace,
        'Does a damaged item have to be returned for a refund?',
      );
      expect(fromFake.chunks.every((hit) => spaceOf.get(hit.id) === FAKE_EMBEDDING_SPACE)).toBe(
        true,
      );
      expect(fromFake.chunks.map((hit) => hit.text)).toContain(SOURCES.refunds[1]);
    });

    it('is healed by the next run: every source whole again, in the target space', async () => {
      const report = await reembedder(new FakeEmbeddingProvider()).run();

      expect(report.totals).toMatchObject({ reembedded: 3, chunks: 4 });
      const status = await reembedder(new FakeEmbeddingProvider()).status();
      expect(status.totals).toMatchObject({ mixedSources: 0, pendingSources: 0, pendingChunks: 0 });
    });
  });
});
