/**
 * An Ekip Lideri configures the AI Agent by default (owner's decision S20 ·
 * 04 K49 · tm 476): `ai.manage` is `on` in the Ekip Lideri column, which is
 * `agents-bot--all:rw` on their session. The whole scope — the owner answered
 * the sub-question "Evet, hepsi": the AI-20 draft and its submission, and what
 * writes to the live AI at once (rule bots, the knowledge base, a knowledge
 * document upload). What stays above them is role-gated on the route:
 * publishing, rejecting, rolling back and pausing a version (`minimumRole:
 * 'admin'`), compliance rules (`exactRole: 'owner'`, `ai.guardrails.edit`).
 * The Founder switches the row off in the matrix, and every one of those
 * routes refuses the lead at the next request.
 *
 * Sessions here are panel sessions (`oauth` on the workspace's sign-in
 * client, the role's default scope set), the credential that follows the
 * matrix both ways (`credential-scopes.ts`).
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  defaultScopesForRole,
} from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;
type Role = 'team_lead' | 'agent';

describe('Ekip Lideri configures the AI Agent by default (RL-03 · FR-MOD-04.RBAC · tm 476)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let seq = 0;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', tone: 'friendly' },
        select: { id: true },
      })
    ).id;
  });

  /** A member of workspace A signed in to the panel, holding their role's default set. */
  async function session(role: Role): Promise<Headers> {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `${role}-${seq}-${Date.now()}@example.test`, name: `Üye ${role} ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      kind: 'oauth',
      clientId: fx.a.clientId,
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

  async function switchOffForLeads(): Promise<void> {
    await owner.roleCapabilityOverride.create({
      data: { licenseId: fx.a.licenseId, role: 'team_lead', capability: 'ai.manage', value: 'off' },
    });
    server.app.permissionMatrix.cache.invalidate();
  }

  /** A completed pre-publish run of the agent's current draft revision. */
  async function packRun(): Promise<void> {
    const { draftRevision } = await owner.aiAgent.findUniqueOrThrow({
      where: { id: aiAgentId },
      select: { draftRevision: true },
    });
    await owner.aiTestRun.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        configTarget: 'draft',
        draftRevision: Number(draftRevision),
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
  }

  /** A rule bot and a KB article in workspace A, for the edits to aim at. */
  async function liveTargets(): Promise<{ botId: string; ruleId: string; articleId: string }> {
    const bot = await owner.bot.create({
      data: { licenseId: fx.a.licenseId, name: 'Karşılama' },
      select: { id: true },
    });
    const rule = await owner.botRule.create({
      data: {
        licenseId: fx.a.licenseId,
        botId: bot.id,
        name: 'Merhaba',
        conditions: { message_contains: 'merhaba' },
        actions: { send_message: 'Merhaba, nasıl yardımcı olabiliriz?' },
      },
      select: { id: true },
    });
    const article = await owner.kbArticle.create({
      data: {
        licenseId: fx.a.licenseId,
        title: 'Para çekme',
        slug: `para-cekme-${seq}`,
        body: 'Çekim talepleri iş günü içinde işlenir.',
      },
      select: { id: true },
    });
    return { botId: bot.id, ruleId: rule.id, articleId: article.id };
  }

  /**
   * Every write the scope opens that this suite probes, as `[label, call,
   * status when allowed]`. Rule bots and the knowledge base write to the live
   * AI at once; guidance moves the AI-20 draft.
   */
  function scopeWrites(
    who: Headers,
    targets: { botId: string; ruleId: string; articleId: string },
  ): Array<[string, () => ReturnType<TestServer['post']>, number]> {
    return [
      [
        'POST /ai-guidance (draft)',
        () =>
          server.post(
            '/ai-guidance',
            {
              ai_agent_id: aiAgentId,
              title: 'Ödeme bilgisi',
              body: 'Ödeme sorunlarında yöntemi ve tutarı öğrenmeden çözüm önerme.',
              category: 'clarification',
            },
            who,
          ),
        201,
      ],
      [
        'POST /settings/bots (live)',
        () => server.post('/settings/bots', { name: 'Lider botu' }, who),
        201,
      ],
      [
        'PATCH /settings/bots/:id (live)',
        () => server.patch(`/settings/bots/${targets.botId}`, { name: 'Karşılama 2' }, who),
        200,
      ],
      [
        'POST /settings/bots/:id/rules (live)',
        () =>
          server.post(
            `/settings/bots/${targets.botId}/rules`,
            {
              name: 'Çekim',
              conditions: { message_contains: 'çekim' },
              actions: { send_message: 'Çekimler iş günü içinde işlenir.' },
            },
            who,
          ),
        201,
      ],
      [
        'PATCH /settings/bots/:id/rules/:id (live)',
        () =>
          server.patch(
            `/settings/bots/${targets.botId}/rules/${targets.ruleId}`,
            { enabled: false },
            who,
          ),
        200,
      ],
      [
        'POST /kb-articles (live)',
        () => server.post('/kb-articles', { title: 'Bonus', body: 'Bonus koşulları burada.' }, who),
        201,
      ],
      [
        'PATCH /kb-articles/:id (live)',
        () => server.patch(`/kb-articles/${targets.articleId}`, { title: 'Para çekme 2' }, who),
        200,
      ],
      [
        'POST /kb-categories (live)',
        () => server.post('/kb-categories', { name: 'Payments' }, who),
        201,
      ],
      [
        'POST /uploads knowledge_document (live)',
        () =>
          server.post(
            '/uploads',
            { content_type: 'application/pdf', size_bytes: 1024, purpose: 'knowledge_document' },
            who,
          ),
        201,
      ],
    ];
  }

  it('prepares the draft and submits it, but never publishes, rejects, rolls back or pauses', async () => {
    const lead = await session('team_lead');

    const guidance = await server.post(
      '/ai-guidance',
      {
        ai_agent_id: aiAgentId,
        title: 'Ödeme bilgisi',
        body: 'Ödeme sorunlarında yöntemi ve tutarı öğrenmeden çözüm önerme.',
        category: 'clarification',
      },
      lead,
    );
    expect(guidance.statusCode, guidance.body).toBe(201);
    const { draftRevision } = await owner.aiAgent.findUniqueOrThrow({
      where: { id: aiAgentId },
      select: { draftRevision: true },
    });
    expect(draftRevision).toBe(1n);

    await packRun();
    const submitted = await server.post('/ai/config/versions', { ai_agent_id: aiAgentId }, lead);
    expect(submitted.statusCode, submitted.body).toBe(201);
    const version = (submitted.json() as { version: { id: string; status: string } }).version;
    expect(version.status).toBe('in_review');

    for (const [path, body] of [
      [`/ai/config/versions/${version.id}/approve`, {}],
      [`/ai/config/versions/${version.id}/reject`, {}],
      [`/ai/config/versions/${version.id}/rollback`, {}],
      ['/ai/pause', { ai_agent_id: aiAgentId }],
    ] as const) {
      const refused = await server.post(path, body, lead);
      expect(refused.statusCode, path).toBe(403);
    }
    // Nor does the lead change the agent itself or create one (admin routes).
    const tone = await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, lead);
    expect(tone.statusCode).toBe(403);
  });

  it('creates and edits rule bots and writes the knowledge base, live, with the default matrix', async () => {
    const lead = await session('team_lead');
    const targets = await liveTargets();
    for (const [label, call, status] of scopeWrites(lead, targets)) {
      const response = await call();
      expect(response.statusCode, `${label}: ${response.body}`).toBe(status);
    }
    expect(await owner.bot.count({ where: { licenseId: fx.a.licenseId } })).toBe(2);
    expect(
      await owner.bot.findUniqueOrThrow({ where: { id: targets.botId }, select: { name: true } }),
    ).toEqual({ name: 'Karşılama 2' });
  });

  it('keeps compliance rules with the Founder: a lead writes no guardrail', async () => {
    const lead = await session('team_lead');
    const rule = await server.post(
      '/ai-guardrails/rules',
      {
        ai_agent_id: aiAgentId,
        title: 'Bonus yok',
        body: 'Sorumlu oyun bayrağı olan oyuncuya hiçbir kampanyadan söz etme.',
        category: 'responsible_gaming',
      },
      lead,
    );
    expect(rule.statusCode, rule.body).toBe(403);
    const settings = await server.put(
      '/ai-guardrails/settings',
      { ai_agent_id: aiAgentId, crisis_text: 'Destek hattı: 112.' },
      lead,
    );
    expect(settings.statusCode, settings.body).toBe(403);
    const phrase = await server.post(
      '/ai-guardrails/phrases',
      { ai_agent_id: aiAgentId, phrase: 'garanti kazanç' },
      lead,
    );
    expect(phrase.statusCode, phrase.body).toBe(403);
    expect(await owner.aiGuardrailRule.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    // Reading them is part of configuring the AI.
    expect((await server.get('/ai-guardrails/rules', lead)).statusCode).toBe(200);
  });

  it('the Founder switches it off: the same session is refused submit, bots and knowledge at once', async () => {
    const lead = await session('team_lead');
    const targets = await liveTargets();
    await packRun();
    await switchOffForLeads();

    const submitted = await server.post('/ai/config/versions', { ai_agent_id: aiAgentId }, lead);
    expect(submitted.statusCode, submitted.body).toBe(403);
    for (const [label, call] of scopeWrites(lead, targets)) {
      const response = await call();
      expect(response.statusCode, `${label}: ${response.body}`).toBe(403);
    }
    expect((await server.get('/settings/bots', lead)).statusCode).toBe(403);
    expect(await owner.bot.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    expect(await owner.aiConfigVersion.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('an Ekip Üyesi still configures nothing by default', async () => {
    const member = await session('agent');
    const targets = await liveTargets();
    await packRun();
    const submitted = await server.post('/ai/config/versions', { ai_agent_id: aiAgentId }, member);
    expect(submitted.statusCode).toBe(403);
    for (const [label, call] of scopeWrites(member, targets)) {
      const response = await call();
      expect(response.statusCode, `${label}: ${response.body}`).toBe(403);
    }
  });
});
