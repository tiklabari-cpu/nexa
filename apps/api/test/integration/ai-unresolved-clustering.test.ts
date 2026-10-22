/**
 * The unresolved questions' clustering (tm 317.2 · SiyahTuş analysis AI-22
 * §3–§8, AI-22-S2), against a real database:
 *
 *   - a message nothing answers is in a cluster after one pass of the
 *     scheduler's own `ai_unresolved_cluster` job — every 15 minutes, so on
 *     the list within 15 minutes (AI-22 acceptance);
 *   - in a model's space (the fixture vectors) 30 wordings of "Papara ile
 *     yatırdım gözükmüyor" land in one cluster, embedded in one batch, the
 *     neighbouring question and an unrelated one apart (AI-22 acceptance);
 *   - a cluster is titled by the model when it opens and when it has grown by
 *     half, by the lexical labeller when the model is off or fails;
 *   - an ignored cluster keeps gathering and counting, and never alarms
 *     (AI-22 acceptance); a surge alarms exactly once, again only after six
 *     hours (AI-22 acceptance · AI-22-S2); a fixed cluster that comes back
 *     opens again, with a notice;
 *   - the counts: hand-overs, abandons, the last seven days;
 *   - a new embedding space rebuilds a cluster in place; the nightly pass
 *     merges what the greedy pass split, never across states;
 *   - each workspace's items cluster into its own clusters (RLS), and the
 *     new CHECKs are `@siyahtus/types`' lists.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import {
  UNRESOLVED_SPIKE_THRESHOLD_MAX,
  UNRESOLVED_SPIKE_THRESHOLD_MIN,
  UNRESOLVED_SUGGESTED_ACTIONS,
  type AiUnresolvedAlertPush,
  splitSkillProcedure,
  type UnresolvedReason,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import { mockKnowledgeAnswer } from '../../src/services/ai/conversation/knowledge-answer.js';
import { MeteredEmbeddings } from '../../src/services/ai/metered-embeddings.js';
import { readAnswerGrounding } from '../../src/services/ai/provider/answer-prompt.js';
import type { EmbeddingProvider } from '../../src/services/ai/provider/embedding-provider.js';
import type { LlmProvider } from '../../src/services/ai/provider/llm-provider.js';
import {
  UnresolvedClusterer,
  UnresolvedClusterMerger,
  mergeUnresolvedClusters,
} from '../../src/services/ai/unresolved/cluster-job.js';
import { readUnresolvedLabelSamples } from '../../src/services/ai/unresolved/label.js';
import { writeUnresolvedItem } from '../../src/services/chat/ai-unresolved.js';
import { NullMailer } from '../../src/services/mail/mailer.js';
import type { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import { buildSchedulerJobs } from '../../src/services/scheduler/jobs.js';
import { FakeEmbeddingProvider, fakeEmbedding } from '../helpers/fake-embedding-provider.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { depositProcedure } from '../helpers/procedure-fixtures.js';
import { silentLogger } from '../helpers/scheduler.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import {
  BONUS,
  PAPARA_DEPOSIT,
  PAPARA_WITHDRAWAL,
  fixtureSpace,
} from '../helpers/unresolved-vectors.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const UNANSWERED = 'Canlı casino masaları hangi saatlerde açık?';
const FAQ = 'Çekim talepleri genellikle 24 saat içinde işlenir.';
const LEXICAL = 'mock:lexical-v1';
const MODEL_SPACE = 'openai:fake-embedding-model';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const REGION = { id: 'mock' as const, region: 'eu' as const };

interface Pushed {
  action: string;
  agentIds: string[];
  payload: AiUnresolvedAlertPush;
}

describe('unresolved questions — clustering, titles, counts and the alarm (AI-22 · tm 317.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  /** The conversation the written items hang on. */
  let conversation: { chatId: string; threadId: string };
  let pushes: Pushed[];
  const publisher = {
    async publish(
      _tenant: unknown,
      action: string,
      audience: { agentIds: string[] },
      payload: unknown,
    ) {
      pushes.push({
        action,
        agentIds: audience.agentIds,
        payload: payload as AiUnresolvedAlertPush,
      });
    },
  } as unknown as RealtimePublisher;
  const serverLlm = new FakeLlmProvider({
    reply: (request) => {
      const grounding = readAnswerGrounding(request.system);
      if (!grounding) throw new Error('a knowledge answer request without its grounding');
      return JSON.stringify(mockKnowledgeAnswer(grounding));
    },
  });

  const asTenant = <T>(t: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, { licenseId: t.licenseId, organizationId: t.organizationId }, fn);
  const tenantOf = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  /** A clusterer on `embeddings` (the stub's space by default) and `llm` (none by default). */
  function clusterer(
    options: { embeddings?: EmbeddingProvider; llm?: LlmProvider } = {},
  ): UnresolvedClusterer {
    return new UnresolvedClusterer(app, {
      embeddings: MeteredEmbeddings.wrap(
        options.embeddings ??
          new FakeEmbeddingProvider({ id: 'mock', space: LEXICAL, vector: embed }),
      ),
      llm: options.llm ?? new FakeLlmProvider({ id: 'mock' }),
      llmLimits: { maxOutputTokens: 400, timeoutMs: 5_000, maxPromptChars: 48_000 },
      llmInference: REGION,
      embeddingInference: REGION,
      publisher,
    });
  }

  /** The fixture space, with the stub's geometry rotated for any other text. */
  function modelSpace(): FakeEmbeddingProvider {
    const space = fixtureSpace();
    return new FakeEmbeddingProvider({
      space: MODEL_SPACE,
      vector: (text) => {
        try {
          return space.vectorFor(text);
        } catch {
          return fakeEmbedding(text);
        }
      },
    });
  }

  async function write(
    texts: readonly string[],
    reason: UnresolvedReason = 'no_procedure_match',
    t: TenantFixture = fx.a,
    agentId = aiAgentId,
    at = conversation,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const text of texts) {
      const id = await asTenant(t, (tx) =>
        writeUnresolvedItem(tx, t.licenseId, {
          aiAgentId: agentId,
          brandId: null,
          chatId: at.chatId,
          threadId: at.threadId,
          eventId: null,
          text,
          reason,
          language: 'tr',
          intentGuess: null,
          configVersionId: null,
          embedding: null,
        }),
      );
      if (id) ids.push(id);
    }
    return ids;
  }

  async function visitorSays(t: TenantFixture, text: string) {
    const token = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(token.statusCode).toBe(200);
    const response = await server.post(
      '/customer/chat/events',
      { text },
      { authorization: `Bearer ${(token.json() as { token: string }).token}` },
    );
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  async function aiFirstAgent(t: TenantFixture, name: string): Promise<string> {
    const id = (
      await owner.aiAgent.create({
        data: { licenseId: t.licenseId, name, kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    const mode = await server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${id}/handoff-settings`),
      payload: { assignment_mode: 'ai_first' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mode.statusCode).toBe(200);
    // An agent with no procedure takes no turn: one procedure and one FAQ,
    // as the capture's own test has them (tm 317.1).
    const { procedure: body, ...own } = splitSkillProcedure(depositProcedure());
    await owner.skill.create({
      data: {
        licenseId: t.licenseId,
        aiAgentId: id,
        name: 'Yatırım geçmedi',
        kind: 'ai_agent',
        mode: 'procedure',
        whenToUse: own.when_to_use,
        examples: own.examples,
        priority: own.priority,
        slots: own.slots as object,
        procedure: body as object,
        active: true,
        updatedAt: new Date(),
      },
    });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId: id,
        licenseId: t.licenseId,
        type: 'faq',
        name: 'Çekim SSS',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      source.id,
      t.licenseId.toString(),
      FAQ,
      toVectorLiteral(embed(FAQ)),
    );
    return id;
  }

  const clusters = () =>
    owner.$queryRaw<
      Array<{
        id: string;
        license_id: bigint;
        ai_agent_id: string;
        label: string;
        label_source: string;
        suggested_action: string | null;
        embedding_space: string;
        has_centroid: boolean;
        item_count: number;
        count_7d: number;
        handoff_count: number;
        abandon_count: number;
        post_fix_count: number;
        labelled_count: number;
        status: string;
        resolved_at: Date | null;
        alerted_at: Date | null;
      }>
    >`SELECT id::text, license_id, ai_agent_id::text, label, label_source, suggested_action,
             embedding_space, centroid IS NOT NULL AS has_centroid, item_count, count_7d,
             handoff_count, abandon_count, post_fix_count, labelled_count, status,
             resolved_at, alerted_at
        FROM ai_unresolved_clusters ORDER BY item_count DESC, first_seen, id`;
  const itemsOf = (ids: readonly string[]) =>
    owner.$queryRaw<
      Array<{
        id: string;
        text_masked: string;
        cluster_id: string | null;
        embedding_space: string | null;
      }>
    >`SELECT id::text, text_masked, cluster_id::text, embedding_space
        FROM ai_unresolved_items WHERE id = ANY(${[...ids]}::uuid[]) ORDER BY created_at, id`;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL is not set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({}, { llm: serverLlm });
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    serverLlm.reset();
    pushes = [];
    aiAgentId = await aiFirstAgent(fx.a, 'Ada');
    conversation = await visitorSays(fx.a, UNANSWERED);
    // The live turn listed it (tm 317.1): every test starts from that one item.
    expect(await owner.aiUnresolvedItem.count()).toBe(1);
  });

  it('lists a message no procedure takes in a cluster after one pass of the 15-minute job (AI-22 acceptance)', async () => {
    const env = testEnv();
    expect(env.SCHEDULE_AI_UNRESOLVED_CLUSTER_MS).toBe(15 * 60_000);
    const job = buildSchedulerJobs({ db: app, env, mailer: new NullMailer() }).find(
      (candidate) => candidate.name === 'ai_unresolved_cluster',
    );
    const outcome = await job!.run({
      signal: new AbortController().signal,
      logger: silentLogger(),
    });
    expect(outcome?.counts).toMatchObject({ assigned: 1, opened: 1, labelled: 1, embedded: 0 });

    const [item] = await owner.$queryRaw<Array<{ reason: string; cluster_id: string | null }>>`
      SELECT reason, cluster_id::text FROM ai_unresolved_items`;
    expect(item?.reason).toBe('no_procedure_match');
    const [cluster] = await clusters();
    expect(item?.cluster_id).toBe(cluster?.id);
    expect(cluster).toMatchObject({
      ai_agent_id: aiAgentId,
      label_source: 'lexical',
      suggested_action: null,
      embedding_space: LEXICAL,
      has_centroid: true,
      item_count: 1,
      count_7d: 1,
      labelled_count: 1,
      status: 'open',
    });
    expect(cluster!.label).not.toMatch(/\d/);
  });

  it('puts 30 wordings of one question in one cluster in a model’s space, embedded in one batch on the cluster meter (AI-22 acceptance)', async () => {
    const deposit = await write(PAPARA_DEPOSIT);
    const withdrawal = await write(PAPARA_WITHDRAWAL);
    const bonus = await write(BONUS);
    const embeddings = modelSpace();

    const report = await clusterer({ embeddings }).run();
    const mine = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
    // The live turn's item had the stub's vector: a new space embeds it too.
    expect(mine).toMatchObject({ embedded: 39, assigned: 39 });
    expect(embeddings.calls).toHaveLength(1);

    const clusterOf = async (ids: string[]) =>
      new Set((await itemsOf(ids)).map((i) => i.cluster_id));
    const depositClusters = await clusterOf(deposit);
    expect(depositClusters.size).toBe(1);
    expect((await clusterOf(withdrawal)).size).toBe(1);
    expect((await clusterOf(bonus)).size).toBe(1);
    expect(
      new Set([...depositClusters, ...(await clusterOf(withdrawal)), ...(await clusterOf(bonus))])
        .size,
    ).toBe(3);
    const [biggest] = await clusters();
    expect(biggest).toMatchObject({ item_count: 30, embedding_space: MODEL_SPACE });
    expect(depositClusters.has(biggest!.id)).toBe(true);
    expect(biggest!.label_source).toBe('lexical');
    expect(biggest!.label).toMatch(/^\p{L}+( \p{L}+){0,2}$/u);
  });

  describe('titles (AI-22 §5)', () => {
    it('asks the fast model when a cluster opens and again once it has grown by half', async () => {
      const llm = new FakeLlmProvider({
        reply: JSON.stringify({ label: 'Papara yatırımı hesaba geçmedi', action: 'add_knowledge' }),
      });
      const embeddings = modelSpace();
      await write(PAPARA_DEPOSIT.slice(0, 4));
      await clusterer({ embeddings, llm }).run();
      const titled = (await clusters()).find((c) => c.item_count === 4)!;
      expect(titled).toMatchObject({
        label: 'Papara yatırımı hesaba geçmedi',
        label_source: 'llm',
        suggested_action: 'add_knowledge',
        labelled_count: 4,
      });
      // The live turn's lone item and the four: one call each, `fast`, masked samples.
      expect(llm.calls).toHaveLength(2);
      expect(llm.calls.every((call) => call.tier === 'fast')).toBe(true);
      const samples = llm.calls.map((call) => readUnresolvedLabelSamples(call.system) ?? []);
      expect(samples.flat()).toEqual(expect.arrayContaining([...PAPARA_DEPOSIT.slice(0, 4)]));

      llm.reset();
      await write(PAPARA_DEPOSIT.slice(4, 5));
      await clusterer({ embeddings, llm }).run();
      expect(llm.calls).toHaveLength(0);

      await write(PAPARA_DEPOSIT.slice(5, 6));
      await clusterer({ embeddings, llm }).run();
      expect(llm.calls).toHaveLength(1);
      expect((await clusters()).find((c) => c.id === titled.id)).toMatchObject({
        item_count: 6,
        labelled_count: 6,
      });
    });

    it('falls back to the lexical title when the model answers with something that is not one', async () => {
      const llm = new FakeLlmProvider({
        reply: JSON.stringify({ label: 'Kart 4111 1111 1111 1111 sorunu', action: 'review' }),
      });
      await write(PAPARA_DEPOSIT.slice(0, 3));
      await clusterer({ embeddings: modelSpace(), llm }).run();
      const [cluster] = await clusters();
      expect(cluster).toMatchObject({ label_source: 'lexical', suggested_action: null });
      expect(cluster!.label).not.toMatch(/[\d*]/);
      expect(llm.calls.length).toBeGreaterThan(0);
    });
  });

  describe('counts and states (AI-22 §6–§7)', () => {
    it('counts hand-overs, abandons and the last seven days', async () => {
      const embeddings = modelSpace();
      const ids = [
        ...(await write(PAPARA_DEPOSIT.slice(0, 2))),
        ...(await write(PAPARA_DEPOSIT.slice(2, 3), 'not_understood_handoff')),
        ...(await write(PAPARA_DEPOSIT.slice(3, 4), 'player_abandoned')),
      ];
      await owner.$executeRaw`
        UPDATE ai_unresolved_items SET created_at = now() - interval '8 days'
         WHERE id = ${ids[0]!}::uuid`;
      await clusterer({ embeddings }).run();
      const cluster = (await clusters()).find((c) => c.item_count === 4);
      expect(cluster).toMatchObject({ handoff_count: 1, abandon_count: 1, count_7d: 3 });
    });

    it('keeps counting what joins an ignored cluster, and never alarms for it (AI-22 acceptance)', async () => {
      const embeddings = modelSpace();
      await write(PAPARA_DEPOSIT.slice(0, 3));
      await clusterer({ embeddings }).run();
      const ignored = (await clusters()).find((c) => c.item_count === 3)!;
      await owner.$executeRaw`
        UPDATE ai_unresolved_clusters SET status = 'ignored', ignore_reason = 'Bilinen sorun'
         WHERE id = ${ignored.id}::uuid`;
      await owner.aiUnresolvedSettings.create({
        data: { licenseId: fx.a.licenseId, spikeThreshold: UNRESOLVED_SPIKE_THRESHOLD_MIN },
      });

      await write(PAPARA_DEPOSIT.slice(3, 10));
      await clusterer({ embeddings }).run();
      expect((await clusters()).find((c) => c.id === ignored.id)).toMatchObject({
        status: 'ignored',
        item_count: 10,
        count_7d: 10,
        alerted_at: null,
      });
      expect(pushes).toEqual([]);
    });

    it('opens a fixed cluster again once it gathers five after its fix, and says so (AI-22 §7)', async () => {
      const embeddings = modelSpace();
      await write(PAPARA_DEPOSIT.slice(0, 3));
      await clusterer({ embeddings }).run();
      const fixed = (await clusters()).find((c) => c.item_count === 3)!;
      await owner.$executeRaw`
        UPDATE ai_unresolved_clusters SET status = 'resolved', resolved_at = now()
         WHERE id = ${fixed.id}::uuid`;

      await write(PAPARA_DEPOSIT.slice(3, 7));
      await clusterer({ embeddings }).run();
      expect((await clusters()).find((c) => c.id === fixed.id)).toMatchObject({
        status: 'resolved',
        post_fix_count: 4,
      });
      expect(pushes).toEqual([]);

      await write(PAPARA_DEPOSIT.slice(7, 8));
      await clusterer({ embeddings }).run();
      expect((await clusters()).find((c) => c.id === fixed.id)).toMatchObject({
        status: 'open',
        resolved_at: null,
        post_fix_count: 5,
      });
      expect(pushes.map((p) => p.payload)).toEqual([
        expect.objectContaining({ kind: 'reopened', cluster_id: fixed.id, count: 5 }),
      ]);
    });
  });

  describe('the surge alarm (AI-22 §8 · AI-22-S2)', () => {
    it('alarms exactly once past the threshold, to the Team Leads and up, and again only after six hours (AI-22 acceptance)', async () => {
      const embeddings = modelSpace();
      await owner.aiUnresolvedSettings.create({
        data: { licenseId: fx.a.licenseId, spikeThreshold: 5 },
      });
      await write(PAPARA_DEPOSIT.slice(0, 4));
      await clusterer({ embeddings }).run();
      expect(pushes).toEqual([]);

      await write(PAPARA_DEPOSIT.slice(4, 5));
      await clusterer({ embeddings }).run();
      const surging = (await clusters()).find((c) => c.item_count === 5)!;
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({
        action: 'ai_unresolved_alert',
        payload: {
          kind: 'spike',
          cluster_id: surging.id,
          ai_agent_id: aiAgentId,
          label: surging.label,
          count: 5,
          threshold: 5,
          window_minutes: 60,
        },
      });
      // The owner, never the plain agent.
      expect(pushes[0]!.agentIds).toContain(fx.a.ownerAccountId);
      expect(pushes[0]!.agentIds).not.toContain(fx.a.agentAccountId);
      expect(surging.alerted_at).not.toBeNull();

      // More of the same, and a second pass, within six hours: nothing new.
      await write(PAPARA_DEPOSIT.slice(5, 10));
      await clusterer({ embeddings }).run();
      await clusterer({ embeddings }).run();
      expect(pushes).toHaveLength(1);

      // Six hours on, still surging: once more.
      await owner.$executeRaw`
        UPDATE ai_unresolved_clusters SET alerted_at = alerted_at - interval '6 hours'
         WHERE id = ${surging.id}::uuid`;
      await clusterer({ embeddings }).run();
      expect(pushes).toHaveLength(2);
      expect(pushes[1]!.payload).toMatchObject({ kind: 'spike', count: 10 });
    });

    it('holds to AI-22-S2’s default of 20 in the hour without a setting', async () => {
      const embeddings = modelSpace();
      await write(PAPARA_DEPOSIT.slice(0, 19));
      await clusterer({ embeddings }).run();
      expect(pushes).toEqual([]);
      await write(PAPARA_DEPOSIT.slice(19, 20));
      await clusterer({ embeddings }).run();
      expect(pushes.map((p) => p.payload.count)).toEqual([20]);
    });

    it('counts only the last hour', async () => {
      const embeddings = modelSpace();
      await owner.aiUnresolvedSettings.create({
        data: { licenseId: fx.a.licenseId, spikeThreshold: 5 },
      });
      const old = await write(PAPARA_DEPOSIT.slice(0, 4));
      await owner.$executeRaw`
        UPDATE ai_unresolved_items SET created_at = now() - interval '2 hours'
         WHERE id = ANY(${old}::uuid[])`;
      await write(PAPARA_DEPOSIT.slice(4, 6));
      await clusterer({ embeddings }).run();
      expect(pushes).toEqual([]);
    });
  });

  describe('spaces and merges (AI-22 §4)', () => {
    it('rebuilds a cluster in place when the deployment’s space changes', async () => {
      // Wordings the lexical stub groups: they share their words.
      const ids = await write([
        'Papara ile yatırdım gözükmüyor',
        'Papara ile yatırdım hesapta gözükmüyor',
        'papara yatırdım gözükmüyor hala',
      ]);
      await clusterer().run();
      const before = (await clusters()).find((c) => c.item_count === 3)!;
      expect(before.embedding_space).toBe(LEXICAL);
      await owner.$executeRaw`
        UPDATE ai_unresolved_clusters SET status = 'ignored' WHERE id = ${before.id}::uuid`;

      await clusterer({ embeddings: modelSpace() }).run();
      const after = (await clusters()).find((c) => c.id === before.id);
      expect(after).toMatchObject({
        embedding_space: MODEL_SPACE,
        has_centroid: true,
        status: 'ignored',
        item_count: 3,
      });
      expect((await itemsOf(ids)).every((i) => i.embedding_space === MODEL_SPACE)).toBe(true);
      expect((await itemsOf(ids)).every((i) => i.cluster_id === before.id)).toBe(true);
    });

    it('merges two clusters of one question overnight, adding their counts — and never an ignored one into an open one', async () => {
      const space = fixtureSpace();
      const centre = space.vectorFor(PAPARA_DEPOSIT[0]);
      const cluster = async (status: string, items: number) =>
        (
          await owner.aiUnresolvedCluster.create({
            data: {
              licenseId: fx.a.licenseId,
              aiAgentId,
              label: 'Papara',
              embeddingSpace: MODEL_SPACE,
              itemCount: items,
              handoffCount: 1,
              status,
              ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
              firstSeen: new Date(Date.now() - DAY),
              lastSeen: new Date(),
            },
            select: { id: true },
          })
        ).id;
      const big = await cluster('open', 5);
      const small = await cluster('open', 2);
      const ignored = await cluster('ignored', 4);
      await owner.$executeRaw`
        UPDATE ai_unresolved_clusters SET centroid = CAST(${toVectorLiteral(centre)} AS vector)`;
      const [moved] = await write(PAPARA_DEPOSIT.slice(0, 1));
      await owner.$executeRaw`
        UPDATE ai_unresolved_items
           SET cluster_id = ${small}::uuid, embedding_space = ${MODEL_SPACE},
               embedding = CAST(${toVectorLiteral(centre)} AS vector)
         WHERE id = ${moved!}::uuid`;

      const report = await new UnresolvedClusterMerger(app, { space: MODEL_SPACE }).mergeTenant(
        tenantOf(fx.a),
      );
      expect(report).toEqual({ merged: 1, absorbed: 1 });
      const left = (await clusters()).filter((c) => c.embedding_space === MODEL_SPACE);
      expect(left.map((c) => c.id).sort()).toEqual([big, ignored].sort());
      expect(left.find((c) => c.id === big)).toMatchObject({ item_count: 7, handoff_count: 2 });
      expect((await itemsOf([moved!]))[0]?.cluster_id).toBe(big);
    });

    it('merges by hand too, and only within the workspace', async () => {
      const a = await owner.aiUnresolvedCluster.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          label: 'Bir',
          embeddingSpace: MODEL_SPACE,
          itemCount: 1,
          firstSeen: new Date(),
          lastSeen: new Date(),
        },
        select: { id: true },
      });
      const b = await owner.aiUnresolvedCluster.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          label: 'İki',
          embeddingSpace: MODEL_SPACE,
          itemCount: 2,
          firstSeen: new Date(),
          lastSeen: new Date(),
        },
        select: { id: true },
      });
      // Another workspace sees neither: nothing moves, nothing is deleted.
      expect(await asTenant(fx.b, (tx) => mergeUnresolvedClusters(tx, a.id, [b.id]))).toBe(0);
      expect(await owner.aiUnresolvedCluster.count()).toBe(2);
      expect(await asTenant(fx.a, (tx) => mergeUnresolvedClusters(tx, a.id, [b.id]))).toBe(1);
      expect(await clusters()).toEqual([expect.objectContaining({ id: a.id, item_count: 3 })]);
    });
  });

  describe('the tables', () => {
    it('clusters each workspace’s items into its own clusters (RLS)', async () => {
      const agentB = await aiFirstAgent(fx.b, 'Bora');
      const conversationB = await visitorSays(fx.b, UNANSWERED);
      await write(PAPARA_DEPOSIT.slice(0, 2), 'no_procedure_match', fx.b, agentB, conversationB);
      await write(PAPARA_DEPOSIT.slice(0, 2));
      await clusterer({ embeddings: modelSpace() }).run();

      const all = await clusters();
      const byLicense = (t: TenantFixture) => all.filter((c) => c.license_id === t.licenseId);
      expect(byLicense(fx.a).every((c) => c.ai_agent_id === aiAgentId)).toBe(true);
      expect(byLicense(fx.b).every((c) => c.ai_agent_id === agentB)).toBe(true);
      expect(byLicense(fx.a).reduce((n, c) => n + c.item_count, 0)).toBe(3);
      expect(byLicense(fx.b).reduce((n, c) => n + c.item_count, 0)).toBe(3);
      expect(await asTenant(fx.b, (tx) => tx.aiUnresolvedCluster.count())).toBe(
        byLicense(fx.b).length,
      );
      expect(await asTenant(fx.b, (tx) => tx.aiUnresolvedSettings.count())).toBe(0);
    });

    it('checks the same lists and bounds @siyahtus/types names', async () => {
      const constraint = async (name: string): Promise<string> => {
        const [row] = await owner.$queryRaw<Array<{ def: string }>>`
          SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
        return row?.def ?? '';
      };
      const listed = [
        ...(await constraint('ai_unresolved_clusters_suggested_action_check')).matchAll(
          /'([a-z_]+)'::text/g,
        ),
      ].map((m) => m[1]);
      expect(listed.sort()).toEqual([...UNRESOLVED_SUGGESTED_ACTIONS].sort());
      expect(await constraint('ai_unresolved_settings_spike_threshold_check')).toContain(
        `>= ${UNRESOLVED_SPIKE_THRESHOLD_MIN}`,
      );
      expect(await constraint('ai_unresolved_settings_spike_threshold_check')).toContain(
        `<= ${UNRESOLVED_SPIKE_THRESHOLD_MAX}`,
      );
      await expect(
        owner.aiUnresolvedSettings.create({
          data: { licenseId: fx.a.licenseId, spikeThreshold: UNRESOLVED_SPIKE_THRESHOLD_MIN - 1 },
        }),
      ).rejects.toThrow(/ai_unresolved_settings_spike_threshold_check/);
      // The app writes its own workspace's setting, and cannot delete it.
      await asTenant(fx.a, (tx) =>
        tx.aiUnresolvedSettings.create({ data: { licenseId: fx.a.licenseId, spikeThreshold: 30 } }),
      );
      await expect(
        asTenant(fx.a, (tx) => tx.$executeRaw`DELETE FROM ai_unresolved_settings`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(fx.a, (tx) =>
          tx.aiUnresolvedSettings.create({
            data: { licenseId: fx.b.licenseId, spikeThreshold: 30 },
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
