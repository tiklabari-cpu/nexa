/**
 * The LLM seam, through the real server (tm 255.5).
 *
 * `buildServer({ llm })` takes a provider the way it takes a mailer. These
 * suites hand it a recorder and ask two questions of it:
 *
 *   1. Does a skill's knowledge answer actually come from the provider? The
 *      customer must receive the provider's text, and the provider must have
 *      been given the passage and the persona — otherwise a real model would be
 *      writing blind.
 *   2. Does the residency gate still stand in front of it (NFR-C4 · C4-e)? A
 *      covered workspace on an out-of-region *real* provider must be refused
 *      with no call made at all — the recorder's count is the proof, because a
 *      refusal after the prompt left is not a refusal.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { FAKE_LLM_REPLY, FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';

/** A real provider, configured for Europe, on a US deployment — the refusing shape. */
const OUT_OF_REGION_OPENAI = {
  SIYAHTUS_REGION: 'us',
  LLM_PROVIDER: 'openai',
  LLM_PROVIDER_REGION: 'eu',
  LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
  LLM_MODEL: 'test-model',
  // Not a credential: nothing is ever sent, and the factory that would read it
  // is bypassed by the injected recorder.
  LLM_API_KEY: 'test-only-not-a-key',
};

describe('LLM provider seam', () => {
  let owner: PrismaClient;
  let seq = 0;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  /**
   * A workspace with an AI agent, a knowledge passage, an active knowledge
   * skill and a token for the authoring routes. `region`/`baaSigned` shape the
   * residency half; the default is the fixture's ordinary workspace.
   */
  async function seedWorkspace(
    options: { region?: 'eu' | 'us'; baaSigned?: boolean; tone?: string } = {},
  ) {
    seq += 1;
    const slug = `llm${seq}-${Date.now()}`;
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
      data: {
        licenseId: license.id,
        kind: 'ai_agent',
        name: 'Ada',
        active: true,
        ...(options.tone ? { tone: options.tone, languages: ['en'] } : {}),
      },
      select: { id: true },
    });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId: aiAgent.id,
        licenseId: license.id,
        type: 'article',
        name: 'Delivery',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      source.id,
      license.id.toString(),
      PASSAGE,
      toVectorLiteral(embed(PASSAGE)),
    );
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
      skillId: skill.id,
      token,
    };
  }

  type Workspace = Awaited<ReturnType<typeof seedWorkspace>>;

  /** A customer writes in through the widget; returns the stored chat's events. */
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
    return owner.event.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true },
    });
  }

  function preview(server: TestServer, ws: Workspace, message: string) {
    return server.post(
      '/skills/preview',
      {
        steps: [{ type: 'send_message', source: 'knowledge' }],
        message,
        ai_agent_id: ws.aiAgentId,
      },
      { authorization: `Bearer ${ws.token}` },
    );
  }

  describe('a skill answers through the injected provider (FR-05-06.EK1)', () => {
    const fake = new FakeLlmProvider();
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer({}, { llm: fake });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(server.app);
      fake.reset();
    });

    it("sends the customer the provider's text, not the stub's", async () => {
      const ws = await seedWorkspace();

      const events = await customerAsks(server, ws, 'How long does delivery take?');

      expect(fake.calls).toHaveLength(1);
      const bot = events.filter((e) => e.authorType === 'bot');
      expect(bot.map((e) => e.text)).toEqual([FAKE_LLM_REPLY]);
      // The stub would have sent the passage itself.
      expect(events.some((e) => e.text === PASSAGE)).toBe(false);

      const run = await owner.skillRun.findFirst({ where: { skillId: ws.skillId } });
      expect(run?.status).toBe('succeeded');
      const entries = (run?.log as { entries: Array<{ step: string; detail: string }> }).entries;
      expect(entries.find((e) => e.step === 'send_message')?.detail).toContain('written by openai');
    });

    it('gives the provider the passage, the persona, the message and the configured limits (FR-MOD-06.4)', async () => {
      const ws = await seedWorkspace({ tone: 'formal' });

      await customerAsks(server, ws, 'How long does delivery take?');

      expect(fake.calls).toHaveLength(1);
      const request = fake.calls[0]!;
      expect(request.messages).toEqual([{ role: 'user', content: 'How long does delivery take?' }]);
      expect(request.system).toContain(PASSAGE);
      expect(request.system).toContain('Tone: formal.');
      expect(request.system).toContain('Reply in this language: en.');
      // `testEnv()` leaves both at their schema defaults.
      expect(request.maxOutputTokens).toBe(400);
      expect(request.timeoutMs).toBe(20_000);
    });

    it('asks nothing of the provider when retrieval finds nothing', async () => {
      // No passage, no prompt: a model must not be asked to answer from nothing.
      const ws = await seedWorkspace();
      await owner.knowledgeChunk.deleteMany({ where: { licenseId: ws.licenseId } });

      const events = await customerAsks(server, ws, 'How long does delivery take?');

      expect(fake.calls).toHaveLength(0);
      expect(events.some((e) => e.authorType === 'bot')).toBe(false);
    });

    it('runs the preview through the same provider (FR-MOD-06.2.5)', async () => {
      const ws = await seedWorkspace();

      const response = await preview(server, ws, 'How long does delivery take?');

      expect(response.statusCode).toBe(200);
      expect((response.json() as { reply: string | null }).reply).toBe(FAKE_LLM_REPLY);
      expect(fake.calls).toHaveLength(1);
    });

    it('leaves the message for a human when the provider fails', async () => {
      const failing = new FakeLlmProvider({ fail: new Error('provider unavailable') });
      const failingServer = await startTestServer({}, { llm: failing });
      try {
        const ws = await seedWorkspace();

        const events = await customerAsks(failingServer, ws, 'How long does delivery take?');

        expect(failing.calls).toHaveLength(1);
        // Stored before the AI ran, and still there: a human picks it up.
        expect(events.some((e) => e.text === 'How long does delivery take?')).toBe(true);
        expect(events.some((e) => e.authorType === 'bot')).toBe(false);
      } finally {
        await failingServer.close();
      }
    });
  });

  describe('the residency gate stands in front of a real provider (NFR-C4)', () => {
    const fake = new FakeLlmProvider();
    let outOfRegion: TestServer;

    beforeAll(async () => {
      outOfRegion = await startTestServer(OUT_OF_REGION_OPENAI, { llm: fake });
    });

    afterAll(async () => {
      await outOfRegion.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(outOfRegion.app);
      fake.reset();
    });

    it('refuses a covered workspace with an ApiError and makes no call at all', async () => {
      const covered = await seedWorkspace({ region: 'us', baaSigned: true });

      const refused = await preview(outOfRegion, covered, 'How long does delivery take?');
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as { error: { type: string } }).error.type).toBe('not_allowed');

      const events = await customerAsks(outOfRegion, covered, 'How long does delivery take?');
      expect(events.some((e) => e.authorType === 'bot')).toBe(false);

      expect(fake.calls).toHaveLength(0);
      const blocked = await owner.auditLogEntry.findMany({
        where: { licenseId: covered.licenseId, action: 'compliance.ai_region_blocked' },
      });
      expect(blocked).toHaveLength(2);
      expect(blocked[0]?.metadata).toMatchObject({
        provider: 'openai',
        provider_region: 'eu',
        region: 'us',
      });
    });

    it('lets an uncovered workspace on the same deployment reach the provider', async () => {
      // The pair that makes the refusal above mean "covered", not "broken".
      const plain = await seedWorkspace({ region: 'us', baaSigned: false });

      const events = await customerAsks(outOfRegion, plain, 'How long does delivery take?');

      expect(fake.calls).toHaveLength(1);
      expect(events.some((e) => e.authorType === 'bot' && e.text === FAKE_LLM_REPLY)).toBe(true);
    });
  });
});
