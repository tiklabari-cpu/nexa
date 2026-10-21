/**
 * The unresolved questions' capture (tm 317.1 · SiyahTuş analysis AI-22),
 * through the real server, the AI job worker and a real knowledge base (mock
 * embeddings):
 *
 *   - a question nothing answers is on the list at once as
 *     `no_procedure_match`, with the turn's own embedding and no second
 *     provider call; a card number and a code in it are masked;
 *   - a self-exclusion message never is, nor a greeting;
 *   - a conversation the player left on the AI's question is
 *     `player_abandoned` when it closes — the player's close and the
 *     inactivity sweep alike;
 *   - an erasure takes the items (the clusters keep only titles and counts),
 *     and the retention sweep takes them after 90 days;
 *   - the tables: the CHECKs are `@siyahtus/types`' lists, RLS keeps a
 *     workspace to its own rows, and an item joins only its own workspace's
 *     agent, thread and cluster.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import {
  UNRESOLVED_CLUSTER_STATUSES,
  UNRESOLVED_LABEL_SOURCES,
  UNRESOLVED_REASONS,
  splitSkillProcedure,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import { writeUnresolvedItem } from '../../src/services/chat/ai-unresolved.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { mockKnowledgeAnswer } from '../../src/services/ai/conversation/knowledge-answer.js';
import { readAnswerGrounding } from '../../src/services/ai/provider/answer-prompt.js';
import { eraseCustomer } from '../../src/services/retention/erasure.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  auditContextFor,
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { depositProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const FAQ = 'Çekim talepleri genellikle 24 saat içinde işlenir.';
const UNANSWERED = 'Canlı casino masaları hangi saatlerde açık?';
const DAY = 86_400_000;
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

describe('unresolved questions — capture, masking, erasure, retention (AI-22 · tm 317.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let token: string;
  const llm = new FakeLlmProvider({
    reply: (request) => {
      const grounding = readAnswerGrounding(request.system);
      if (!grounding) throw new Error('a knowledge answer request without its grounding');
      return JSON.stringify(mockKnowledgeAnswer(grounding));
    },
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const asTenant = <T>(t: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, { licenseId: t.licenseId, organizationId: t.organizationId }, fn);

  async function seedFaq(text: string): Promise<void> {
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
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
      fx.a.licenseId.toString(),
      text,
      toVectorLiteral(embed(text)),
    );
  }

  async function storeProcedure(): Promise<void> {
    const { procedure: body, ...own } = splitSkillProcedure(depositProcedure());
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
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
  }

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  async function say(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as {
      chat_id: string;
      event: { id: string; thread_id: string };
    };
    const thread = await owner.thread.findUniqueOrThrow({
      where: { id: sent.event.thread_id },
      select: { aiMode: true },
    });
    return {
      chatId: sent.chat_id,
      threadId: sent.event.thread_id,
      eventId: sent.event.id,
      aiMode: thread.aiMode,
    };
  }

  const items = () =>
    owner.$queryRaw<
      Array<{
        id: string;
        ai_agent_id: string;
        chat_id: string;
        thread_id: string;
        event_id: string | null;
        text_masked: string;
        context_masked: string | null;
        language: string | null;
        reason: string;
        embedding_space: string | null;
        has_vector: boolean;
        cluster_id: string | null;
      }>
    >`SELECT id, ai_agent_id::text, chat_id, thread_id, event_id, text_masked, context_masked,
             language, reason, embedding_space, embedding IS NOT NULL AS has_vector,
             cluster_id::text
        FROM ai_unresolved_items ORDER BY created_at, id`;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL is not set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({}, { llm });
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    llm.reset();
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    const mode = await server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload: { assignment_mode: 'ai_first' },
      headers: auth(),
    });
    expect(mode.statusCode).toBe(200);
    await storeProcedure();
    await seedFaq(FAQ);
  });

  describe('the live turn', () => {
    it('lists a message no procedure takes and nothing answers as no_procedure_match, at once, with the turn’s own embedding (AI-22 acceptance)', async () => {
      const turn = await say(await visitor(), UNANSWERED);

      const [item] = await items();
      expect(item).toMatchObject({
        ai_agent_id: aiAgentId,
        chat_id: turn.chatId,
        thread_id: turn.threadId,
        event_id: turn.eventId,
        text_masked: UNANSWERED,
        context_masked: null,
        reason: 'no_procedure_match',
        embedding_space: 'mock:lexical-v1',
        has_vector: true,
        cluster_id: null,
      });
      expect(await items()).toHaveLength(1);
    });

    it('keeps the player’s message before it as the context, masked like the question', async () => {
      const headers = await visitor();
      await say(headers, 'Selam, bir sorum olacaktı sizlere');
      const turn = await say(headers, 'Poker turnuvası saat kaçta başlıyor acaba?');

      const listed = (await items()).filter((row) => row.event_id === turn.eventId);
      expect(listed).toEqual([
        expect.objectContaining({
          reason: 'no_procedure_match',
          text_masked: 'Poker turnuvası saat kaçta başlıyor acaba?',
          context_masked: 'Selam, bir sorum olacaktı sizlere',
        }),
      ]);
    });

    it('stores a card number and a one-time code masked (AI-22 acceptance · AI-26)', async () => {
      await say(
        await visitor(),
        'Canlı casino turnuvasına 4111 1111 1111 1111 kartımla katılabilir miyim, SMS kodu 482913 geldi',
      );

      const [item] = await items();
      expect(item?.text_masked).toBeDefined();
      expect(item!.text_masked).not.toContain('4111 1111 1111 1111');
      expect(item!.text_masked).not.toContain('482913');
      expect(item!.text_masked).toMatch(/^Canlı casino turnuvasına (\*{4} ){3}\*{4,8} kartımla/);
      expect(item!.text_masked).not.toMatch(/\d{4}/);
    });

    it('masks the words again whoever hands them over — the second line (AI-26)', async () => {
      const turn = await say(await visitor(), UNANSWERED);
      const id = await asTenant(fx.a, (tx) =>
        writeUnresolvedItem(tx, fx.a.licenseId, {
          aiAgentId,
          brandId: null,
          chatId: turn.chatId,
          threadId: turn.threadId,
          eventId: null,
          text: 'Kartım 4111 1111 1111 1111 neden reddedildi bilmiyorum',
          reason: 'said_dont_know',
          language: 'xx-YY',
          intentGuess: null,
          configVersionId: null,
          embedding: null,
        }),
      );
      const row = (await items()).find((r) => r.id === id);
      expect(row).toMatchObject({
        text_masked: 'Kartım **** **** **** 1111 neden reddedildi bilmiyorum',
        language: null,
        embedding_space: null,
        has_vector: false,
      });
    });

    it('never lists a self-exclusion message, nor a greeting (AI-22 acceptance)', async () => {
      const headers = await visitor();
      const excluded = await say(headers, 'artık oynamak istemiyorum, hesabımı kapatın');
      expect(excluded.aiMode).toBe('human');
      await say(await visitor(), 'merhaba');

      expect(await items()).toEqual([]);
    });
  });

  describe('the close', () => {
    it('lists the player who left on the AI’s question as player_abandoned when they close it', async () => {
      const headers = await visitor();
      const asked = await say(headers, UNANSWERED);
      // The group "other" is asked once whether to hand over: a question.
      expect(asked.aiMode).toBe('ai');

      const closed = await server.post('/customer/chat/close', undefined, headers);
      expect(closed.statusCode).toBe(204);

      expect((await items()).map((row) => [row.reason, row.event_id, row.text_masked])).toEqual([
        ['no_procedure_match', asked.eventId, UNANSWERED],
        ['player_abandoned', asked.eventId, UNANSWERED],
      ]);
    });

    it('lists one the inactivity sweep closes the same way', async () => {
      const asked = await say(await visitor(), UNANSWERED);
      const closed = await new ChatService(app, NO_REDIS).deactivateByTimeout(
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        asked.chatId,
        new Date(Date.now() + 60_000),
        auditContextFor(fx.a),
      );
      expect(closed).not.toBeNull();
      expect((await items()).map((row) => row.reason)).toEqual([
        'no_procedure_match',
        'player_abandoned',
      ]);
    });

    it('lists nothing when a person had it, or the AI answered', async () => {
      const handedOverHeaders = await visitor();
      const handedOver = await say(handedOverHeaders, 'USDT cüzdan adresimi nasıl değiştiririm?');
      expect(handedOver.aiMode).toBe('human');
      const answeredHeaders = await visitor();
      await say(answeredHeaders, 'Çekim talepleri ne kadar sürede işlenir?');
      expect((await items()).map((row) => row.reason)).toEqual(['no_procedure_match']);

      for (const headers of [handedOverHeaders, answeredHeaders]) {
        expect((await server.post('/customer/chat/close', undefined, headers)).statusCode).toBe(
          204,
        );
      }
      expect((await items()).map((row) => row.reason)).toEqual(['no_procedure_match']);
    });
  });

  describe('erasure and retention', () => {
    it('an erasure takes the player’s items; the cluster keeps its title and counts (AI-22 acceptance · AI-22-S1)', async () => {
      const headers = await visitor();
      const turn = await say(headers, UNANSWERED);
      expect((await server.post('/customer/chat/close', undefined, headers)).statusCode).toBe(204);
      const cluster = await owner.aiUnresolvedCluster.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          label: 'Canlı casino saatleri',
          embeddingSpace: 'mock:lexical-v1',
          itemCount: 2,
          firstSeen: new Date(),
          lastSeen: new Date(),
        },
        select: { id: true },
      });
      await owner.$executeRaw`UPDATE ai_unresolved_items SET cluster_id = ${cluster.id}::uuid`;
      const chat = await owner.chat.findUniqueOrThrow({
        where: { id: turn.chatId },
        select: { customerId: true },
      });

      await asTenant(fx.a, (tx) => eraseCustomer(tx, chat.customerId, new Date()));

      expect(await items()).toEqual([]);
      expect(
        await owner.aiUnresolvedCluster.findUniqueOrThrow({
          where: { id: cluster.id },
          select: { label: true, itemCount: true },
        }),
      ).toEqual({ label: 'Canlı casino saatleri', itemCount: 2 });
    });

    it('the retention sweep takes the words after 90 days, whatever the conversation’s window (AI-22-S1)', async () => {
      const turn = await say(await visitor(), UNANSWERED);
      await say(await visitor(), 'Poker turnuvası saat kaçta başlıyor acaba?');
      await owner.$executeRaw`
        UPDATE ai_unresolved_items SET created_at = ${new Date(Date.now() - 91 * DAY)}
         WHERE thread_id = ${turn.threadId}`;
      const mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-unresolved-mail-'));
      try {
        const runner = new RetentionRunner(app, {
          // An unlimited-looking thread window: the list's own ceiling still applies.
          policy: { threadDays: 3650, visitDays: 3650, mailDays: 30, auditDays: 30 },
          mailDir,
          auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
        });
        const dry = await runner.run({ dryRun: true });
        expect(dry.totals.unresolvedItems).toBe(1);
        expect(await items()).toHaveLength(2);

        const report = await runner.run({ dryRun: false });
        const mine = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
        expect(mine?.unresolvedItems).toBe(1);
        expect((await items()).map((row) => row.text_masked)).toEqual([
          'Poker turnuvası saat kaçta başlıyor acaba?',
        ]);
        expect((await runner.run({ dryRun: false })).totals.unresolvedItems).toBe(0);
      } finally {
        await rm(mailDir, { recursive: true, force: true });
      }
    });
  });

  describe('the tables', () => {
    const constraint = async (name: string): Promise<string> => {
      const [row] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
      return row?.def ?? '';
    };
    const listed = (def: string): string[] =>
      [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);

    it('checks the same lists @siyahtus/types names', async () => {
      expect(listed(await constraint('ai_unresolved_items_reason_check')).sort()).toEqual(
        [...UNRESOLVED_REASONS].sort(),
      );
      expect(listed(await constraint('ai_unresolved_clusters_status_check')).sort()).toEqual(
        [...UNRESOLVED_CLUSTER_STATUSES].sort(),
      );
      expect(listed(await constraint('ai_unresolved_clusters_label_source_check')).sort()).toEqual(
        [...UNRESOLVED_LABEL_SOURCES].sort(),
      );
    });

    it('keeps a workspace to its own rows (RLS), and an item to its own agent, thread and cluster', async () => {
      const turn = await say(await visitor(), UNANSWERED);
      expect(await asTenant(fx.a, (tx) => tx.aiUnresolvedItem.count())).toBe(1);
      expect(await asTenant(fx.b, (tx) => tx.aiUnresolvedItem.count())).toBe(0);

      const agentB = (
        await owner.aiAgent.create({
          data: { licenseId: fx.b.licenseId, name: 'Bora', kind: 'ai_agent', active: true },
          select: { id: true },
        })
      ).id;
      const write = (over: { aiAgentId?: string; threadId?: string }) =>
        asTenant(fx.a, (tx) =>
          writeUnresolvedItem(tx, fx.a.licenseId, {
            aiAgentId: over.aiAgentId ?? aiAgentId,
            brandId: null,
            chatId: turn.chatId,
            threadId: over.threadId ?? turn.threadId,
            eventId: null,
            text: UNANSWERED,
            reason: 'no_knowledge',
            language: 'tr',
            intentGuess: null,
            configVersionId: null,
            embedding: null,
          }),
        );
      await expect(write({ aiAgentId: agentB })).rejects.toThrow(/not this workspace/);

      // Another agent's cluster of the same workspace is not this item's.
      const otherAgent = (
        await owner.aiAgent.create({
          data: { licenseId: fx.a.licenseId, name: 'Cem', kind: 'ai_agent', active: true },
          select: { id: true },
        })
      ).id;
      const cluster = await owner.aiUnresolvedCluster.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: otherAgent,
          label: 'Başka ajan',
          embeddingSpace: 'mock:lexical-v1',
          firstSeen: new Date(),
          lastSeen: new Date(),
        },
        select: { id: true },
      });
      await expect(
        asTenant(
          fx.a,
          (tx) => tx.$executeRaw`UPDATE ai_unresolved_items SET cluster_id = ${cluster.id}::uuid`,
        ),
      ).rejects.toThrow(/not this agent/);

      // The words and the reason are written once (grants).
      await expect(
        asTenant(
          fx.a,
          (tx) => tx.$executeRaw`UPDATE ai_unresolved_items SET reason = 'agent_flagged'`,
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('holds a vector to a space, and a fixed cluster to its date (CHECK)', async () => {
      const turn = await say(await visitor(), UNANSWERED);
      await expect(
        owner.$executeRaw`UPDATE ai_unresolved_items SET embedding_space = NULL WHERE thread_id = ${turn.threadId}`,
      ).rejects.toThrow(/ai_unresolved_items_embedding_check/);
      await expect(
        owner.aiUnresolvedCluster.create({
          data: {
            licenseId: fx.a.licenseId,
            aiAgentId,
            label: 'x',
            embeddingSpace: 'mock:lexical-v1',
            status: 'resolved',
            firstSeen: new Date(),
            lastSeen: new Date(),
          },
        }),
      ).rejects.toThrow(/ai_unresolved_clusters_resolved_check/);
    });
  });
});
