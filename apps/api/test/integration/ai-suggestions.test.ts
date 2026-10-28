/**
 * The AI coaching and suggestion queue (tm 318.1 · SiyahTuş analysis AI-23 ·
 * `paths/ai-suggestions.yaml`), through the real server and a real database:
 *
 *   - **Making one.** A team member marks the AI's message "wrong": it is in
 *     their Team Lead's queue at once, the badge is pushed with the open count,
 *     the excerpt is a masked copy, and the player's question is on the
 *     unresolved list (`agent_flagged`). The marked message must be the AI's
 *     (an offered answer: an agent's); the same mark twice is 409; 50 a day,
 *     then 429; a conversation the caller cannot see is 404; the matrix can
 *     take `ai.suggest` away.
 *   - **Reach.** A Team Lead sees their led teams' suggestions and not
 *     another team's — list, read and review; an administrator all; a member
 *     their own; another workspace nothing (NFR-S4).
 *   - **Review.** A rejection without a note is 400; the author is told; a
 *     decided suggestion is not decided again. Accepting writes into the
 *     AI-20 draft — the draft's diff shows it, the published version does not
 *     carry it — and names the AI-21 change.
 *   - **The drafting job.** An offered answer with "ali123" and "2.500 TL"
 *     becomes a draft without them; an answer the knowledge base already has
 *     comes back `already_known` with the passage's source; a cluster agents
 *     kept answering opens one suggestion (AI-23-S2).
 *   - **AI-19.** The suggestion's conversation as a scripted scenario.
 *   - **The table.** The CHECKs are `@siyahtus/types`' lists; RLS keeps a
 *     workspace to its rows.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_BOT_ID,
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  DEFAULT_AGENT_SCOPES,
  SUGGESTIONS_PER_AGENT_PER_DAY,
  SUGGESTION_KINDS,
  SUGGESTION_SOURCES,
  SUGGESTION_STATUSES,
  buildEventId,
  generateShortId,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import {
  resolveEmbeddingInferenceProvider,
  resolveInferenceProvider,
} from '../../src/services/ai/inference.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MockEmbeddingProvider } from '../../src/services/ai/provider/mock-embedding-provider.js';
import { MockLlmProvider } from '../../src/services/ai/provider/mock-llm-provider.js';
import { SuggestionDrafter } from '../../src/services/ai/suggestion-drafting.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;
type Headers = Record<string, string>;

interface SuggestionBody {
  id: string;
  kind: string;
  status: string;
  team_id: number | null;
  excerpt: Array<{
    event_id: string;
    author_type: string;
    is_ai: boolean;
    text: string;
    marked: boolean;
  }>;
  proposed_change: { target: string; title: string; body: string; source_id: string | null } | null;
  removed_specifics: string[];
  drafted_by: string | null;
  already_known: boolean;
  similar_sources: Array<{ chunk_id: string; source_id: string; source_name: string }>;
  review_note: string | null;
  resulting_change_id: string | null;
  cluster_id: string | null;
}

const ANSWER =
  'Merhaba, ali123 hesabınıza 2.500 TL çekiminiz gönderildi. Papara çekimleri artık 7/24 değil, yalnız hafta içi işleniyor.';
const KNOWN =
  'Kripto yatırımları yalnız TRC20 ağında kabul edilir ve en geç bir saatte hesaba geçer.';

describe('the AI coaching and suggestion queue (tm 318.1 · AI-23)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let teamA: bigint;
  let teamB: bigint;
  let seq = 0;
  const pushes: Array<{ action: string; audience: unknown; payload: Json }> = [];

  const tenant = (t: TenantFixture = fx.a): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const asTenant = <T>(t: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, tenant(t), fn);

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    server = await startTestServer();
    vi.spyOn(RealtimePublisher.prototype, 'publish').mockImplementation(
      async (_tenant, action, audience, payload) => {
        pushes.push({ action, audience, payload: payload as Json });
      },
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  afterEach(() => {
    pushes.length = 0;
  });

  async function team(t: TenantFixture, name: string): Promise<bigint> {
    return (
      await owner.group.create({ data: { licenseId: t.licenseId, name }, select: { id: true } })
    ).id;
  }

  /** A member of `t` in `teams` (leading `leads`), with a session-like PAT of their role. */
  async function member(
    role: 'admin' | 'team_lead' | 'agent',
    teams: bigint[] = [],
    leads: bigint[] = [],
    t: TenantFixture = fx.a,
  ): Promise<{ accountId: string; auth: Headers }> {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `sug-${role}-${seq}-${Date.now()}@example.test`, name: `Üye ${role} ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: t.licenseId, agentId: account.id, role },
    });
    for (const groupId of teams) {
      await owner.groupAgent.create({
        data: {
          licenseId: t.licenseId,
          groupId,
          agentId: account.id,
          isLead: leads.includes(groupId),
        },
      });
    }
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: account.id,
      scopes: [...DEFAULT_AGENT_SCOPES, 'agents-bot--all:rw', 'chats--all:rw'].filter(
        (scope) =>
          role === 'admin' || (!scope.startsWith('chats--all') && scope !== 'agents-bot--all:rw'),
      ),
    });
    return { accountId: account.id, auth: { authorization: `Bearer ${token}` } };
  }

  /**
   * A conversation of `t` routed to `groupId`: the player asks, the AI answers,
   * an agent answers — `[player, ai, agent]` event ids, oldest first.
   */
  async function conversation(
    t: TenantFixture,
    groupId: bigint,
    lines: { player?: string; ai?: string; agent?: string } = {},
  ) {
    const chatId = generateShortId();
    const threadId = generateShortId();
    // One active chat per player: each conversation has its own, named like the fixture's.
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Ali Veli', username: 'ali123' },
      select: { id: true },
    });
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id },
    });
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: t.licenseId, groupId } });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    const at = Date.now() - 60_000;
    const rows = [
      {
        authorType: 'customer',
        authorId: customer.id,
        text: lines.player ?? 'Papara ile çekim yapabilir miyim? Kartım 4111 1111 1111 1111',
      },
      {
        authorType: 'bot',
        authorId: AI_BOT_ID,
        text: lines.ai ?? 'Evet, Papara çekimleri 7/24 işlenir.',
      },
      { authorType: 'agent', authorId: t.agentAccountId, text: lines.agent ?? ANSWER },
    ];
    const ids: string[] = [];
    for (const [index, row] of rows.entries()) {
      const id = buildEventId(threadId, index + 1);
      ids.push(id);
      await owner.event.create({
        data: {
          id,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          recipients: 'all',
          createdAt: new Date(at + index * 1000),
          ...row,
        },
      });
    }
    return { chatId, threadId, player: ids[0]!, ai: ids[1]!, agent: ids[2]! };
  }

  const suggest = (auth: Headers, body: Json) => server.post('/ai/suggestions', body, auth);
  const review = (auth: Headers, id: string, body: Json) =>
    server.patch(`/ai/suggestions/${id}`, body, auth);
  const list = async (auth: Headers, query = '') => {
    const response = await server.get(`/ai/suggestions${query}`, auth);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { suggestions: SuggestionBody[]; total: number; open_count: number };
  };

  const drafter = () =>
    new SuggestionDrafter(owner, {
      knowledge: new KnowledgeService({ embeddings: new MockEmbeddingProvider() }),
      llm: new MockLlmProvider(),
      llmLimits: { maxOutputTokens: 1000, timeoutMs: 5000, maxPromptChars: 50_000 },
      llmInference: resolveInferenceProvider(testEnv()),
      embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
      publisher: null,
    });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    aiAgentId = (
      await owner.aiAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'ai_agent',
          name: 'Ada',
          active: true,
          languages: ['tr'],
        },
        select: { id: true },
      })
    ).id;
    teamA = await team(fx.a, 'Finans');
    teamB = await team(fx.a, 'VIP');
  });

  it('a "wrong" mark is in the Team Lead’s queue at once, badge pushed, excerpt masked, question on the unresolved list (AI-23 KK 1)', async () => {
    const lead = await member('team_lead', [teamA], [teamA]);
    const agent = await member('agent', [teamA]);
    const chat = await conversation(fx.a, teamA);

    const made = await suggest(agent.auth, {
      chat_id: chat.chatId,
      thread_id: chat.threadId,
      event_id: chat.ai,
      kind: 'wrong_answer',
      note: 'Papara artık 7/24 değil.',
    });
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json() as SuggestionBody;
    expect(body).toMatchObject({ kind: 'wrong_answer', status: 'new', team_id: Number(teamA) });
    // The excerpt: up to the marked message, masked when made.
    expect(body.excerpt.map((m) => [m.author_type, m.is_ai, m.marked])).toEqual([
      ['customer', false, false],
      ['bot', true, true],
    ]);
    expect(body.excerpt[0]!.text).not.toContain('4111 1111 1111 1111');

    const queue = await list(lead.auth);
    expect(queue.suggestions.map((s) => s.id)).toEqual([body.id]);
    expect(queue.open_count).toBe(1);
    const badge = pushes.find(
      (p) =>
        p.action === 'ai_suggestion_created' &&
        JSON.stringify(p.audience) === JSON.stringify({ agentIds: [lead.accountId] }),
    );
    expect(badge?.payload).toMatchObject({
      suggestion_id: body.id,
      open_count: 1,
      team_id: Number(teamA),
    });
    // An owner reviews every team: told too, with the workspace's count.
    expect(
      pushes.filter((p) => p.action === 'ai_suggestion_created').map((p) => p.audience),
    ).toContainEqual({ agentIds: [fx.a.ownerAccountId] });

    const flagged = await owner.aiUnresolvedItem.findMany({ where: { chatId: chat.chatId } });
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ reason: 'agent_flagged', eventId: chat.player });
    expect(flagged[0]!.textMasked).not.toContain('4111 1111 1111 1111');
  });

  it('refuses a mark on the wrong message, a second identical one, an unseen conversation and a role without ai.suggest', async () => {
    const agent = await member('agent', [teamA]);
    const chat = await conversation(fx.a, teamA);
    const base = { chat_id: chat.chatId, thread_id: chat.threadId };

    expect(
      (await suggest(agent.auth, { ...base, event_id: chat.agent, kind: 'wrong_answer' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await suggest(agent.auth, { ...base, event_id: chat.ai, kind: 'promote_agent_answer' }))
        .statusCode,
    ).toBe(400);
    expect((await suggest(agent.auth, { ...base, kind: 'tone' })).statusCode).toBe(400);

    const first = await suggest(agent.auth, { ...base, event_id: chat.ai, kind: 'tone' });
    expect(first.statusCode, first.body).toBe(201);
    const again = await suggest(agent.auth, { ...base, event_id: chat.ai, kind: 'tone' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: {
        type: 'ai_suggestion_state',
        details: { reason: 'duplicate', suggestion_id: (first.json() as SuggestionBody).id },
      },
    });
    // Another kind on the same message is another suggestion.
    expect(
      (await suggest(agent.auth, { ...base, event_id: chat.ai, kind: 'wrong_answer' })).statusCode,
    ).toBe(201);

    // Team B's conversation: not visible to a team A member — absent.
    const other = await conversation(fx.a, teamB);
    const unseen = await suggest(agent.auth, {
      chat_id: other.chatId,
      thread_id: other.threadId,
      event_id: other.ai,
      kind: 'wrong_answer',
    });
    expect(unseen.statusCode).toBe(404);

    await owner.roleCapabilityOverride.create({
      data: { licenseId: fx.a.licenseId, role: 'agent', capability: 'ai.suggest', value: 'off' },
    });
    server.app.permissionMatrix.cache.invalidate();
    const off = await member('agent', [teamA]);
    const refused = await suggest(off.auth, { ...base, event_id: chat.ai, kind: 'other' });
    expect(refused.statusCode).toBe(403);
  });

  it(`allows ${SUGGESTIONS_PER_AGENT_PER_DAY} suggestions a day per person, then 429`, async () => {
    const agent = await member('agent', [teamA]);
    const chat = await conversation(fx.a, teamA);
    await owner.aiSuggestion.createMany({
      data: Array.from({ length: SUGGESTIONS_PER_AGENT_PER_DAY }, () => ({
        id: crypto.randomUUID(),
        licenseId: fx.a.licenseId,
        aiAgentId,
        kind: 'other',
        createdBy: agent.accountId,
      })),
    });
    const over = await suggest(agent.auth, {
      chat_id: chat.chatId,
      thread_id: chat.threadId,
      event_id: chat.ai,
      kind: 'wrong_answer',
    });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({
      error: { details: { reason: 'ai_suggestions_daily_limit' } },
    });
    // A day later the allowance is back.
    await owner.aiSuggestion.updateMany({
      where: { createdBy: agent.accountId },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    const back = await suggest(agent.auth, {
      chat_id: chat.chatId,
      thread_id: chat.threadId,
      event_id: chat.ai,
      kind: 'wrong_answer',
    });
    expect(back.statusCode, back.body).toBe(201);
  });

  it('a Team Lead of A never sees B’s suggestions — list, read, review; an admin sees both; a member their own; workspace B nothing (AI-23 KK 5)', async () => {
    const leadA = await member('team_lead', [teamA], [teamA]);
    const agentA = await member('agent', [teamA]);
    const agentB = await member('agent', [teamB]);
    const admin = await member('admin');
    const chatA = await conversation(fx.a, teamA);
    const chatB = await conversation(fx.a, teamB);
    const a = (
      await suggest(agentA.auth, {
        chat_id: chatA.chatId,
        thread_id: chatA.threadId,
        event_id: chatA.ai,
        kind: 'wrong_answer',
      })
    ).json() as SuggestionBody;
    const b = (
      await suggest(agentB.auth, {
        chat_id: chatB.chatId,
        thread_id: chatB.threadId,
        event_id: chatB.ai,
        kind: 'wrong_answer',
      })
    ).json() as SuggestionBody;

    expect((await list(leadA.auth)).suggestions.map((s) => s.id)).toEqual([a.id]);
    expect((await list(leadA.auth)).open_count).toBe(1);
    expect((await server.get(`/ai/suggestions/${b.id}`, leadA.auth)).statusCode).toBe(404);
    expect(
      (await review(leadA.auth, b.id, { action: 'reject', review_note: 'Hayır.' })).statusCode,
    ).toBe(404);

    const all = await list(admin.auth);
    expect(all.suggestions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(all.open_count).toBe(2);

    // A member sees their own and reviews nothing.
    const own = await list(agentA.auth);
    expect(own.suggestions.map((s) => s.id)).toEqual([a.id]);
    expect(own.open_count).toBe(0);
    expect((await server.get(`/ai/suggestions/${a.id}`, agentA.auth)).statusCode).toBe(200);
    expect(
      (await review(agentA.auth, a.id, { action: 'reject', review_note: 'x' })).statusCode,
    ).toBe(404);

    const stranger = await member('admin', [], [], fx.b);
    expect((await list(stranger.auth)).suggestions).toEqual([]);
    expect((await server.get(`/ai/suggestions/${a.id}`, stranger.auth)).statusCode).toBe(404);
  });

  it('a rejection needs a note (400), tells the author, and a decided suggestion is not decided again (AI-23 KK 4)', async () => {
    const lead = await member('team_lead', [teamA], [teamA]);
    const agent = await member('agent', [teamA]);
    const chat = await conversation(fx.a, teamA);
    const made = (
      await suggest(agent.auth, {
        chat_id: chat.chatId,
        thread_id: chat.threadId,
        event_id: chat.ai,
        kind: 'tone',
      })
    ).json() as SuggestionBody;

    const bare = await review(lead.auth, made.id, { action: 'reject' });
    expect(bare.statusCode).toBe(400);
    const rejected = await review(lead.auth, made.id, {
      action: 'reject',
      review_note: 'Ton uygun.',
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'rejected', review_note: 'Ton uygun.' });
    const told = pushes.find((p) => p.action === 'ai_suggestion_reviewed');
    expect(told?.audience).toEqual({ agentIds: [agent.accountId] });
    expect(told?.payload).toMatchObject({
      suggestion_id: made.id,
      status: 'rejected',
      review_note: 'Ton uygun.',
    });

    const again = await review(lead.auth, made.id, { action: 'reject', review_note: 'Yine.' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: { type: 'ai_suggestion_state', details: { reason: 'already_reviewed' } },
    });
  });

  it('drafts an offered answer without "ali123" and "2.500 TL", then a Team Lead’s acceptance is in the AI-20 diff and not in the published version (AI-23 KK 2 · KK 3)', async () => {
    const lead = await member('team_lead', [teamA], [teamA]);
    const agent = await member('agent', [teamA]);
    const admin = await member('admin');
    const admin2 = await member('admin');
    const chat = await conversation(fx.a, teamA);

    const made = await suggest(agent.auth, {
      chat_id: chat.chatId,
      thread_id: chat.threadId,
      event_id: chat.agent,
      kind: 'promote_agent_answer',
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as SuggestionBody).id;
    expect((made.json() as SuggestionBody).status).toBe('drafting');

    const pass = await drafter().draftTenant(tenant(), new Date());
    expect(pass).toMatchObject({ drafted: 1, llm: 0 });
    const drafted = (await server.get(`/ai/suggestions/${id}`, lead.auth)).json() as SuggestionBody;
    expect(drafted.status).toBe('new');
    expect(drafted.drafted_by).toBe('lexical');
    expect(drafted.proposed_change?.target).toBe('knowledge_snippet');
    expect(drafted.proposed_change?.body).not.toContain('ali123');
    expect(drafted.proposed_change?.body).not.toContain('2.500 TL');
    expect(drafted.proposed_change?.body).toContain('Papara çekimleri artık 7/24 değil');
    expect(drafted.removed_specifics).toEqual(expect.arrayContaining(['username', 'amount']));

    // A published version first, so "live" is a version and not the tables.
    await owner.aiTestRun.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        configTarget: 'draft',
        draftRevision: Number(
          (await owner.aiAgent.findUniqueOrThrow({ where: { id: aiAgentId } })).draftRevision,
        ),
        trigger: 'pre_publish',
        status: 'completed',
        scenarioCount: AI_COMPLIANCE_PACK_SIZE,
        passed: AI_COMPLIANCE_PACK_SIZE,
        failed: 0,
        compliancePackVersion: AI_COMPLIANCE_PACK_VERSION,
        compliancePassed: AI_COMPLIANCE_PACK_SIZE,
        complianceFailed: 0,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    const submitted = await server.post(
      '/ai/config/versions',
      { ai_agent_id: aiAgentId },
      admin.auth,
    );
    expect(submitted.statusCode, submitted.body).toBe(201);
    const { version } = submitted.json() as { version: { id: string } };
    const approved = await server.post(
      `/ai/config/versions/${version.id}/approve`,
      {},
      admin2.auth,
    );
    expect(approved.statusCode, approved.body).toBe(200);

    const accepted = await review(lead.auth, id, {
      action: 'accept',
      proposed_change: { ...drafted.proposed_change!, title: 'Papara çekim günleri' },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const body = accepted.json() as SuggestionBody;
    expect(body.status).toBe('accepted');
    expect(body.resulting_change_id).not.toBeNull();

    const source = await owner.knowledgeSource.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, type: 'faq', name: 'Papara çekim günleri' },
    });
    expect(source.content).not.toContain('ali123');
    const change = await owner.aiConfigChange.findUniqueOrThrow({
      where: { id: body.resulting_change_id! },
    });
    expect(change).toMatchObject({
      entityId: source.id,
      entityType: 'knowledge_source',
      action: 'created',
    });

    const diff = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin.auth);
    expect(diff.statusCode, diff.body).toBe(200);
    const sections = (
      diff.json() as { diff: { sections: Array<{ section: string; added: number }> } }
    ).diff.sections;
    expect(sections.find((s) => s.section === 'knowledge')?.added).toBeGreaterThanOrEqual(1);
    const published = await owner.aiConfigVersion.findFirst({
      where: { aiAgentId, status: 'published' },
      select: { knowledgeManifest: true },
    });
    expect(JSON.stringify(published?.knowledgeManifest ?? [])).not.toContain(source.id);
  });

  it('an answer the knowledge base already has is drafted "already known", with the passage’s source (AI-23 KK 6)', async () => {
    const lead = await member('team_lead', [teamA], [teamA]);
    const agent = await member('agent', [teamA]);
    const knowledge = new KnowledgeService({ embeddings: new MockEmbeddingProvider() });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'faq',
        name: 'Kripto yatırımı',
        content: KNOWN,
        status: 'ready',
        updatedAt: new Date(),
      },
    });
    const prepared = await knowledge.prepare(KNOWN);
    await asTenant(fx.a, (tx) => knowledge.index(tx, tenant(), source.id, prepared));

    const chat = await conversation(fx.a, teamA, { agent: KNOWN });
    const fresh = await conversation(fx.a, teamA, {
      agent: 'Bonus çevrim şartı 30 kattır ve slot oyunlarında geçerlidir.',
    });
    const known = (
      await suggest(agent.auth, {
        chat_id: chat.chatId,
        thread_id: chat.threadId,
        event_id: chat.agent,
        kind: 'promote_agent_answer',
      })
    ).json() as SuggestionBody;
    const other = (
      await suggest(agent.auth, {
        chat_id: fresh.chatId,
        thread_id: fresh.threadId,
        event_id: fresh.agent,
        kind: 'promote_agent_answer',
      })
    ).json() as SuggestionBody;

    expect(await drafter().draftTenant(tenant(), new Date())).toMatchObject({
      drafted: 2,
      duplicates: 1,
    });
    const dup = (
      await server.get(`/ai/suggestions/${known.id}`, lead.auth)
    ).json() as SuggestionBody;
    expect(dup.already_known).toBe(true);
    expect(dup.similar_sources.map((s) => s.source_name)).toContain('Kripto yatırımı');
    const plain = (
      await server.get(`/ai/suggestions/${other.id}`, lead.auth)
    ).json() as SuggestionBody;
    expect(plain.already_known).toBe(false);
  });

  it('opens one suggestion from a cluster agents kept answering, once a week (AI-23-S2)', async () => {
    const lead = await member('team_lead', [teamA], [teamA]);
    const cluster = await owner.aiUnresolvedCluster.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        label: 'Papara çekim saatleri',
        embeddingSpace: 'mock:lexical',
        firstSeen: new Date(),
        lastSeen: new Date(),
      },
    });
    for (let i = 0; i < 3; i += 1) {
      const chat = await conversation(fx.a, teamA, {
        player: `Papara çekimi ne zaman gelir ${i}?`,
      });
      await owner.aiUnresolvedItem.create({
        data: {
          id: crypto.randomUUID(),
          licenseId: fx.a.licenseId,
          aiAgentId,
          chatId: chat.chatId,
          threadId: chat.threadId,
          eventId: chat.player,
          textMasked: `Papara çekimi ne zaman gelir ${i}?`,
          reason: 'no_knowledge',
          clusterId: cluster.id,
          createdAt: new Date(Date.now() - 120_000),
        },
      });
    }
    const first = await drafter().draftTenant(tenant(), new Date());
    expect(first).toMatchObject({ opened: 1, drafted: 1 });
    const queue = await list(lead.auth);
    expect(queue.suggestions).toHaveLength(1);
    expect(queue.suggestions[0]).toMatchObject({
      kind: 'promote_agent_answer',
      cluster_id: cluster.id,
      status: 'new',
      team_id: Number(teamA),
    });
    expect(queue.suggestions[0]!.proposed_change?.body).not.toContain('ali123');
    expect((await drafter().draftTenant(tenant(), new Date())).opened).toBe(0);
  });

  it('keeps the suggestion’s conversation as a scripted AI-19 scenario expecting a hand-over', async () => {
    const admin = await member('admin');
    const agent = await member('agent', [teamA]);
    const chat = await conversation(fx.a, teamA);
    const made = (
      await suggest(agent.auth, {
        chat_id: chat.chatId,
        thread_id: chat.threadId,
        event_id: chat.ai,
        kind: 'should_have_handed_off',
      })
    ).json() as SuggestionBody;
    const saved = await server.post(
      `/ai/suggestions/${made.id}/to-scenario`,
      { name: 'Papara devri' },
      admin.auth,
    );
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json()).toMatchObject({
      ai_agent_id: aiAgentId,
      name: 'Papara devri',
      origin: 'from_chat',
      origin_ref: made.id,
      mode: 'scripted',
      expectations: { outcome: 'handoff' },
    });
    const turns = (saved.json() as { turns: string[] }).turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]).not.toContain('4111 1111 1111 1111');
    // A Team Lead reviews it but holds no scenario scope.
    const lead = await member('team_lead', [teamA], [teamA]);
    expect(
      (await server.post(`/ai/suggestions/${made.id}/to-scenario`, {}, lead.auth)).statusCode,
    ).toBe(403);
  });

  it('checks the same lists @siyahtus/types names, and RLS keeps a workspace to its rows', async () => {
    const constraint = async (name: string) =>
      (
        await owner.$queryRaw<Array<{ def: string }>>`
          SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`
      )[0]!.def;
    const listed = (def: string) =>
      [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!).sort();
    expect(listed(await constraint('ai_suggestions_kind_check'))).toEqual(
      [...SUGGESTION_KINDS].sort(),
    );
    expect(listed(await constraint('ai_suggestions_source_check'))).toEqual(
      [...SUGGESTION_SOURCES].sort(),
    );
    expect(listed(await constraint('ai_suggestions_status_check'))).toEqual(
      [...SUGGESTION_STATUSES].sort(),
    );

    const agent = await member('agent', [teamA]);
    const chat = await conversation(fx.a, teamA);
    expect(
      (
        await suggest(agent.auth, {
          chat_id: chat.chatId,
          thread_id: chat.threadId,
          event_id: chat.ai,
          kind: 'other',
        })
      ).statusCode,
    ).toBe(201);
    expect(await asTenant(fx.a, (tx) => tx.aiSuggestion.count())).toBe(1);
    expect(await asTenant(fx.b, (tx) => tx.aiSuggestion.count())).toBe(0);
    // Another workspace's agent is not this suggestion's to name.
    const foreign = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'B', active: true },
      select: { id: true },
    });
    await expect(
      asTenant(
        fx.a,
        (tx) =>
          tx.$executeRaw`INSERT INTO ai_suggestions (id, license_id, ai_agent_id, kind)
                       VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${foreign.id}::uuid, 'other')`,
      ),
    ).rejects.toThrow();
    // Retention takes the connection; the suggestion and its excerpt stay.
    await owner.thread.delete({ where: { id: chat.threadId } });
    expect(await owner.aiSuggestion.count({ where: { threadId: chat.threadId } })).toBe(1);
  });
});
