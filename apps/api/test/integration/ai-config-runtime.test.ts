/**
 * The AI configuration at run time (tm 316.3 · SiyahTuş analysis AI-20 ·
 * ADR-14b §2.6–§2.8): the live widget answers from the published version and
 * the draft — what a simulation plays — has the change; a connection keeps
 * the version it opened on and the next takes the new one; the pause switch is
 * live whatever the pin; every decision record names the version; knowledge is
 * searched as the version published it, so a draft reindex or delete does not
 * reach the widget and a rollback brings a removed passage back; the
 * migration's baseline v1 is the tables until the draft first changes, then
 * sealed; a publication is announced to the agents.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  licenseChannel,
  type AiConfigKnowledgeManifestEntry,
  type BusEnvelope,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { publishedConfig } from '../../src/services/ai/config-source.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

interface Version {
  id: string;
  label: string;
  number: number;
  seq: number | null;
  status: string;
}

const OLD_PASSAGE = 'Every delivery travels with the Kestrel courier service.';
const NEW_PASSAGE = 'Every delivery travels with the Osprey courier service.';
const QUESTION = 'Which courier takes my delivery?';

/** What the fake model answers: which passage the knowledge search put in front of it. */
function answerFrom(request: { system: string; messages: Array<{ content: string }> }): string {
  const prompt = [request.system, ...request.messages.map((message) => message.content)].join('\n');
  if (prompt.includes('Kestrel')) return 'Kestrel carries it.';
  if (prompt.includes('Osprey')) return 'Osprey carries it.';
  return 'Nothing to go on.';
}

const textSkill = (text: string) => [
  { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
  { type: 'send_message', source: 'text', text },
];

const knowledgeSkill = [
  { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
  { type: 'send_message', source: 'knowledge' },
];

describe('AI configuration at run time (AI-20 · tm 316.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let skillId: string;
  let admin: Headers;
  let admin2: Headers;
  let seq = 0;
  const model = new FakeLlmProvider({ reply: answerFrom });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm: model });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  async function member(): Promise<Headers> {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `runtime-admin-${seq}-${Date.now()}@example.test`, name: `Yönetici ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role: 'admin' },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['agents-bot--all:rw'],
    });
    return { authorization: `Bearer ${token}` };
  }

  const tenant = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    model.reset();
    aiAgentId = (
      await owner.aiAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'ai_agent',
          name: 'Ada',
          active: true,
          tone: 'formal',
          languages: ['en'],
        },
        select: { id: true },
      })
    ).id;
    skillId = (
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          name: 'Delivery',
          kind: 'ai_agent',
          steps: textSkill('Answer one.'),
          active: true,
          updatedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    admin = await member();
    admin2 = await member();
  });

  /** The pre-publish run of the draft as it is now, submitted by `admin`, approved by `admin2`. */
  async function publish(): Promise<Version> {
    const agent = await owner.aiAgent.findUniqueOrThrow({
      where: { id: aiAgentId },
      select: { draftRevision: true },
    });
    await owner.aiTestRun.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        configTarget: 'draft',
        draftRevision: Number(agent.draftRevision),
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
    const submitted = await server.post('/ai/config/versions', { ai_agent_id: aiAgentId }, admin);
    expect(submitted.statusCode, submitted.body).toBe(201);
    const { version } = submitted.json() as { version: Version };
    const approved = await server.post(`/ai/config/versions/${version.id}/approve`, {}, admin2);
    expect(approved.statusCode, approved.body).toBe(200);
    return approved.json() as Version;
  }

  const editSkill = async (steps: unknown) => {
    const response = await server.patch(`/skills/${skillId}`, { steps }, admin);
    expect(response.statusCode, response.body).toBe(200);
  };

  /** A visitor of workspace A; `ask` writes in their one connection. */
  async function visitor() {
    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const { token } = minted.json() as { token: string };
    let chatId: string | null = null;
    return {
      async ask(text: string): Promise<string[]> {
        const sent = await server.post(
          '/customer/chat/events',
          { text },
          { authorization: `Bearer ${token}` },
        );
        expect(sent.statusCode, sent.body).toBe(201);
        chatId = (sent.json() as { chat_id: string }).chat_id;
        const replies = await owner.event.findMany({
          where: { chatId, authorType: 'bot', type: 'message' },
          orderBy: { createdAt: 'asc' },
          select: { text: true },
        });
        return replies.map((reply) => reply.text ?? '');
      },
      get chatId(): string {
        if (chatId === null) throw new Error('nothing asked yet');
        return chatId;
      },
    };
  }

  const conversationOf = (chatId: string) =>
    owner.aiConversation.findFirstOrThrow({ where: { chatId }, select: { configVersionId: true } });

  const decisionsOf = (chatId: string) =>
    owner.aiDecisionLog.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, configVersionId: true, procedureVersion: true },
    });

  async function source(content: string): Promise<string> {
    const created = await server.post(
      '/knowledge-sources',
      { ai_agent_id: aiAgentId, name: 'Couriers', type: 'article', content },
      admin,
    );
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  const chunksOf = (sourceId: string) =>
    owner.knowledgeChunk.findMany({
      where: { sourceId },
      orderBy: [{ generation: 'asc' }, { position: 'asc' }],
      select: {
        chunkText: true,
        generation: true,
        visibleFromVersion: true,
        hiddenFromVersion: true,
      },
    });

  it('the widget answers from the published version; the draft and its simulation have the change (AI-20 acceptance 1)', async () => {
    const v1 = await publish();
    await editSkill(textSkill('Answer two.'));

    const player = await visitor();
    expect(await player.ask('Where is my delivery?')).toEqual(['Answer one.']);

    const [draft, published] = await withTenant(server.app.db, tenant(), async (tx) => [
      await publishedConfig.forSimulation(tx, { aiAgentId, target: 'draft' }),
      await publishedConfig.forSimulation(tx, { aiAgentId, target: 'published' }),
    ]);
    expect(draft.versionId).toBeNull();
    expect(JSON.stringify(draft.pkg.skills[0]?.steps)).toContain('Answer two.');
    expect(published.versionId).toBe(v1.id);
    expect(JSON.stringify(published.pkg.skills[0]?.steps)).toContain('Answer one.');

    // The decision record and the conversation name the version (AI-20 acceptance 5).
    expect(await conversationOf(player.chatId)).toEqual({ configVersionId: v1.id });
    expect(await decisionsOf(player.chatId)).toEqual([
      { decision: 'answered', configVersionId: v1.id, procedureVersion: 1 },
    ]);
  });

  it('a connection keeps the version it opened on, the next one takes the new one, and the agents hear of it', async () => {
    const v1 = await publish();
    const first = await visitor();
    expect(await first.ask('Where is my delivery?')).toEqual(['Answer one.']);

    const subscriber = server.app.redis.duplicate();
    const heard: BusEnvelope[] = [];
    subscriber.on('message', (_channel: string, message: string) => {
      heard.push(JSON.parse(message) as BusEnvelope);
    });
    await subscriber.subscribe(licenseChannel(fx.a.licenseId));
    try {
      await editSkill(textSkill('Answer two.'));
      const v2 = await publish();
      await expect
        .poll(() => heard.map((envelope) => envelope.action))
        .toContain('ai_config_published');
      const announced = heard.find((envelope) => envelope.action === 'ai_config_published');
      expect(announced).toMatchObject({
        audience: { allAgents: true },
        payload: {
          ai_agent_id: aiAgentId,
          version_id: v2.id,
          label: 'v2',
          seq: v2.seq,
          rollback_of: null,
        },
      });

      // The open connection is pinned to v1; a new one opens on v2.
      expect(await first.ask('And my other delivery?')).toEqual(['Answer one.', 'Answer one.']);
      const second = await visitor();
      expect(await second.ask('Where is my delivery?')).toEqual(['Answer two.']);
      expect(await conversationOf(first.chatId)).toEqual({ configVersionId: v1.id });
      expect(await conversationOf(second.chatId)).toEqual({ configVersionId: v2.id });
      expect((await decisionsOf(first.chatId)).map((row) => row.configVersionId)).toEqual([
        v1.id,
        v1.id,
      ]);
      expect(await decisionsOf(second.chatId)).toEqual([
        { decision: 'answered', configVersionId: v2.id, procedureVersion: 2 },
      ]);

      // A rollback is announced too, naming what it copied.
      heard.length = 0;
      const rolled = await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, admin);
      expect(rolled.statusCode, rolled.body).toBe(201);
      await expect.poll(() => heard.length).toBeGreaterThan(0);
      expect(heard[0]).toMatchObject({
        action: 'ai_config_published',
        payload: { label: 'v3', rollback_of: v1.id },
      });
      const third = await visitor();
      expect(await third.ask('Where is my delivery?')).toEqual(['Answer one.']);
    } finally {
      await subscriber.unsubscribe(licenseChannel(fx.a.licenseId));
      subscriber.disconnect();
    }
  });

  it('a conversation opened before the agent had a version takes the first one it meets, once', async () => {
    const player = await visitor();
    expect(await player.ask('Where is my delivery?')).toEqual(['Answer one.']);
    expect(await conversationOf(player.chatId)).toEqual({ configVersionId: null });
    expect(await decisionsOf(player.chatId)).toEqual([
      { decision: 'answered', configVersionId: null, procedureVersion: null },
    ]);

    await editSkill(textSkill('Answer two.'));
    const v1 = await publish();
    await editSkill(textSkill('Answer three.'));
    expect(await player.ask('Another delivery?')).toEqual(['Answer one.', 'Answer two.']);
    expect(await conversationOf(player.chatId)).toEqual({ configVersionId: v1.id });
  });

  it('a paused agent answers nothing on a pinned connection, and answers again once resumed', async () => {
    await publish();
    const player = await visitor();
    expect(await player.ask('Where is my delivery?')).toEqual(['Answer one.']);

    const paused = await server.post('/ai/pause', { ai_agent_id: aiAgentId }, admin);
    expect(paused.statusCode, paused.body).toBe(200);
    expect(await player.ask('Is my delivery late?')).toEqual(['Answer one.']);

    await owner.aiGuardrailSettings.upsert({
      where: { aiAgentId },
      create: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        crisisText: 'Please reach out to a support line.',
        approvedAt: new Date(),
      },
      update: { crisisText: 'Please reach out to a support line.', approvedAt: new Date() },
    });
    const resumed = await server.post('/ai/resume', { ai_agent_id: aiAgentId }, admin);
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(await player.ask('My delivery, please?')).toEqual(['Answer one.', 'Answer one.']);
  });

  it('knowledge is searched as the version published it: a draft reindex stays in the draft, and a rollback brings the removed passage back (AI-20 acceptance 4)', async () => {
    await editSkill(knowledgeSkill);
    const sourceId = await source(OLD_PASSAGE);
    const v1 = await publish();
    const [opened] = await chunksOf(sourceId);
    expect(opened).toMatchObject({ chunkText: OLD_PASSAGE, visibleFromVersion: BigInt(v1.seq!) });

    // The draft's text changes: a new generation, and the published one stays.
    const edited = await server.patch(
      `/knowledge-sources/${sourceId}`,
      { content: NEW_PASSAGE },
      admin,
    );
    expect(edited.statusCode, edited.body).toBe(200);
    const kept = await chunksOf(sourceId);
    expect(kept.map((chunk) => [chunk.chunkText, chunk.visibleFromVersion])).toEqual([
      [OLD_PASSAGE, BigInt(v1.seq!)],
      [NEW_PASSAGE, null],
    ]);
    const live = await visitor();
    expect(await live.ask(QUESTION)).toEqual(['Kestrel carries it.']);

    // Published: the new text answers, the old range is closed.
    const v2 = await publish();
    expect(await (await visitor()).ask(QUESTION)).toEqual(['Osprey carries it.']);
    expect((await chunksOf(sourceId)).map((chunk) => chunk.hiddenFromVersion)).toEqual([
      BigInt(v2.seq!),
      null,
    ]);

    // Back to v1: its closed generation is copied, opened at the rollback's seq.
    const rolled = await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, admin);
    expect(rolled.statusCode, rolled.body).toBe(201);
    const v3 = rolled.json() as Version;
    expect(await (await visitor()).ask(QUESTION)).toEqual(['Kestrel carries it.']);
    const copies = (await chunksOf(sourceId)).filter(
      (chunk) => chunk.visibleFromVersion === BigInt(v3.seq!),
    );
    expect(copies.map((chunk) => chunk.chunkText)).toEqual([OLD_PASSAGE]);

    // The usage ledger names the version a knowledge turn ran on (ADR-14b §2.7 (2)).
    const metered = await owner.aiUsageEvent.findMany({
      where: { licenseId: fx.a.licenseId, configVersionId: { not: null } },
      select: { configVersionId: true },
    });
    expect(new Set(metered.map((row) => row.configVersionId))).toEqual(
      new Set([v1.id, v2.id, v3.id]),
    );
  });

  it('a source deleted from the draft is retired while a version answers from it, and gone otherwise', async () => {
    await editSkill(knowledgeSkill);
    const sourceId = await source(OLD_PASSAGE);
    const v1 = await publish();
    const never = await source(NEW_PASSAGE);

    expect((await server.del(`/knowledge-sources/${sourceId}`, admin)).statusCode).toBe(204);
    expect((await server.del(`/knowledge-sources/${never}`, admin)).statusCode).toBe(204);
    // In no version: gone, as before versioning. In v1: retired, chunks kept.
    expect(await owner.knowledgeSource.count({ where: { id: never } })).toBe(0);
    const retired = await owner.knowledgeSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { retiredAt: true },
    });
    expect(retired.retiredAt).not.toBeNull();
    expect((await chunksOf(sourceId)).map((chunk) => chunk.chunkText)).toEqual([OLD_PASSAGE]);
    // The editor no longer sees it…
    expect((await server.get(`/knowledge-sources/${sourceId}`, admin)).statusCode).toBe(404);
    const listed = (await server.get('/knowledge-sources', admin)).json() as {
      items: Array<{ id: string }>;
    };
    expect(listed.items.map((item) => item.id)).not.toContain(sourceId);
    // …the widget still answers from it…
    expect(await (await visitor()).ask(QUESTION)).toEqual(['Kestrel carries it.']);

    // …until a version without it is published.
    await publish();
    expect(await (await visitor()).ask(QUESTION)).not.toEqual(['Kestrel carries it.']);
    const back = await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, admin);
    expect(back.statusCode, back.body).toBe(201);
    expect(await (await visitor()).ask(QUESTION)).toEqual(['Kestrel carries it.']);
  });

  it("the migration's baseline v1 is the tables until the draft first changes, then sealed with them", async () => {
    // A knowledge source from before the migration (its chunk opened at 1) and
    // one written after it (not opened), then the backfill as 20261115090000 runs it.
    const before = await source(OLD_PASSAGE);
    const after = await source(NEW_PASSAGE);
    await owner.$executeRaw`UPDATE knowledge_chunks SET visible_from_version = 1 WHERE source_id = ${before}::uuid`;
    await owner.$executeRaw`
      INSERT INTO ai_config_versions
        (id, license_id, ai_agent_id, number, minor, seq, status, snapshot, snapshot_hash,
         package_format, knowledge_manifest, draft_revision, published_at)
      SELECT gen_random_uuid(), a.license_id, a.id, 1, 0, 1, 'published', '{}'::jsonb,
             encode(sha256(convert_to('{}', 'UTF8')), 'hex'), 0, '[]'::jsonb, a.draft_revision,
             CURRENT_TIMESTAMP
        FROM ai_agents a WHERE a.id = ${aiAgentId}::uuid`;
    await owner.$executeRaw`
      UPDATE ai_agents a SET published_version_id = v.id
        FROM ai_config_versions v WHERE v.ai_agent_id = a.id AND a.id = ${aiAgentId}::uuid`;
    const v1 = await owner.aiConfigVersion.findFirstOrThrow({ where: { aiAgentId } });

    // Unsealed: the tables answer, the conversation pins v1, nothing to submit.
    const player = await visitor();
    expect(await player.ask('Where is my delivery?')).toEqual(['Answer one.']);
    expect(await conversationOf(player.chatId)).toEqual({ configVersionId: v1.id });
    const diff = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin);
    expect(diff.statusCode, diff.body).toBe(200);
    expect(diff.json()).toMatchObject({ diff: { changes: 0 }, submittable: false });

    // The first change seals v1 with the tables as they were, then applies.
    await editSkill(textSkill('Answer two.'));
    const sealed = await owner.aiConfigVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(sealed.packageFormat).toBe(1);
    expect(JSON.stringify(sealed.snapshot)).toContain('Answer one.');
    const manifest = sealed.knowledgeManifest as unknown as AiConfigKnowledgeManifestEntry[];
    expect(manifest.map((entry) => [entry.source_id, entry.chunk_count]).sort()).toEqual(
      [
        [before, 1],
        [after, 1],
      ].sort(),
    );
    expect((await chunksOf(after)).map((chunk) => chunk.visibleFromVersion)).toEqual([1n]);

    // v1 answers now; the draft has the change.
    expect(await (await visitor()).ask('Where is my delivery?')).toEqual(['Answer one.']);
    const drafted = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin);
    expect((drafted.json() as { diff: { changes: number } }).diff.changes).toBeGreaterThan(0);
  });
});
