/**
 * The widget's human check (tm 339.2 · SiyahTuş analysis GV-01), through the
 * real server, Postgres and Redis, with the offline mock provider — and
 * Turnstile over a stubbed fetch, so no test reaches Cloudflare:
 *
 *   - a normal visitor (one address, one visitor, a few messages) never sees
 *     a check at the deployment's defaults;
 *   - a script opening new visitors from one address past the threshold is
 *     answered `challenge_required` at the token mint, and no customer is
 *     created; a passing token gets through and is remembered for 12 hours, a
 *     refused one is `challenge_failed`; another address is not affected; a
 *     member back with the member token this workspace signed is never asked;
 *   - the message that opens a conversation is screened the same way — mode
 *     `always_on_chat_start`, a burst of messages, many AI turns today, many
 *     new visitors from the address — and opens nothing until it passes;
 *   - a provider that cannot be reached lets the visitor through, and the AI
 *     does not answer them: the player is told a person is coming, the agents
 *     see a note, the decision record says `blocked`;
 *   - mode `off` asks nobody; `PATCH /settings/security` sets the mode.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CHALLENGE_UNVERIFIED_SYSTEM_EVENT,
  type CaptchaMode,
  DEFAULT_HANDOFF_MESSAGES,
  localDayKey,
  MOCK_CAPTCHA_PASS_TOKEN,
  MOCK_CAPTCHA_UNAVAILABLE_TOKEN,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { CHALLENGE_UNVERIFIED_NOTE_TEXT } from '../../src/services/ai/ai-responder.js';
import { TURNSTILE_VERIFY_URL } from '../../src/services/security/captcha.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const BONUS = 'Bonus kurallarını kısaca anlat.';
/** Low thresholds, so a test reaches each signal in a few requests. */
const LOW = {
  CAPTCHA_PROVIDER: 'mock',
  CAPTCHA_RISK_NEW_CUSTOMERS_PER_IP: '2',
  CAPTCHA_RISK_MESSAGES_PER_MIN: '3',
  CAPTCHA_RISK_AI_TURNS_TODAY: '5',
  LOG_LEVEL: 'fatal',
};

/** A fresh documentation-range address per call, so no two tests share a window. */
let nextHost = 1;
const freshIp = () => `198.51.100.${nextHost++}`;

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

interface Visitor {
  headers: Record<string, string>;
  customerId: string;
  memberToken: string | undefined;
}

describe('the widget’s human check (GV-01 · tm 339.2)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  /** One request from `ip`, returned once the AI jobs it set off have run. */
  async function call(
    server: TestServer,
    ip: string,
    method: 'POST' | 'GET' | 'PATCH',
    path: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    const response = await server.app.inject({
      method,
      url: server.url(path),
      headers,
      remoteAddress: ip,
      ...(payload ? { payload } : {}),
    });
    await server.app.aiJobs.idle();
    await server.app.aiUsageAlerts.idle();
    await server.app.riskFlags.idle();
    return response;
  }

  function mint(server: TestServer, t: TenantFixture, ip: string, extra: object = {}) {
    return call(
      server,
      ip,
      'POST',
      '/customer/token',
      { organization_id: t.organizationId, ...extra },
      { origin: `https://${t.trustedDomain}` },
    );
  }

  async function visitor(
    server: TestServer,
    t: TenantFixture,
    ip: string,
    extra: object = {},
  ): Promise<Visitor> {
    const response = await mint(server, t, ip, extra);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { token: string; customer_id: string; member_token?: string };
    return {
      headers: { authorization: `Bearer ${body.token}` },
      customerId: body.customer_id,
      memberToken: body.member_token,
    };
  }

  function say(server: TestServer, ip: string, who: Visitor, text: string, extra: object = {}) {
    return call(server, ip, 'POST', '/customer/chat/events', { text, ...extra }, who.headers);
  }

  async function close(server: TestServer, ip: string, who: Visitor) {
    expect(
      (await call(server, ip, 'POST', '/customer/chat/close', undefined, who.headers)).statusCode,
    ).toBe(204);
  }

  async function setMode(t: TenantFixture, captchaMode: CaptchaMode) {
    const brand = (await owner.brand.findFirst({
      where: { licenseId: t.licenseId, isDefault: true },
      select: { id: true },
    })) ?? { id: await seedDefaultBrand(owner, t.licenseId) };
    await owner.securitySettings.upsert({
      where: { licenseId_brandId: { licenseId: t.licenseId, brandId: brand.id } },
      create: { licenseId: t.licenseId, brandId: brand.id, captchaMode },
      update: { captchaMode },
    });
  }

  const customersOf = (t: TenantFixture) =>
    owner.customer.count({ where: { organizationId: t.organizationId } });
  const passedAt = async (customerId: string) =>
    (await owner.customer.findUniqueOrThrow({ where: { id: customerId } })).challengePassedAt;
  const chatsOf = (customerId: string) => owner.chat.count({ where: { customerId } });

  const asked = (reason: string, provider = 'mock', siteKey = 'mock-site-key') => ({
    error: expect.objectContaining({
      type: 'challenge_required',
      details: { reason, provider, site_key: siteKey },
    }) as unknown,
  });

  describe('at the deployment’s defaults', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer({
        CAPTCHA_PROVIDER: 'mock',
        CAPTCHA_RISK_NEW_CUSTOMERS_PER_IP: '30',
        CAPTCHA_RISK_MESSAGES_PER_MIN: '20',
        CAPTCHA_RISK_AI_TURNS_TODAY: '20',
        LOG_LEVEL: 'fatal',
      });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
    });

    it('never asks a normal visitor: one address, one visitor, a conversation and a return (GV-01 acceptance)', async () => {
      const ip = freshIp();
      const member = await visitor(server, fx.a, ip);
      for (const text of ['merhaba', 'bonusum nerede', 'teşekkürler']) {
        expect((await say(server, ip, member, text)).statusCode).toBe(201);
      }
      await close(server, ip, member);
      expect((await say(server, ip, member, 'bir sorum daha var')).statusCode).toBe(201);
      // Back on another page load, with the member token.
      await visitor(server, fx.a, ip, { member_token: member.memberToken });
      expect(await passedAt(member.customerId)).toBeNull();
    });
  });

  describe('with low thresholds and the mock provider', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer(LOW, { llm: new FakeLlmProvider({ reply: BONUS }) });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await seedDefaultBrand(owner, fx.a.licenseId);
      await clearRateLimits(server.app);
    });

    it('asks a script opening visitors from one address at the mint, before any customer is created (GV-01 acceptance)', async () => {
      const ip = freshIp();
      await visitor(server, fx.a, ip);
      await visitor(server, fx.a, ip);
      const before = await customersOf(fx.a);

      const third = await mint(server, fx.a, ip);
      expect(third.statusCode).toBe(403);
      expect(third.json()).toEqual(asked('new_customers_per_ip'));
      expect(await customersOf(fx.a)).toBe(before);

      // A refused token is named as such; still nobody created.
      const wrong = await mint(server, fx.a, ip, { challenge_token: 'made-up' });
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json()).toEqual(asked('challenge_failed'));
      expect(await customersOf(fx.a)).toBe(before);

      // Another address is not this one's script.
      await visitor(server, fx.a, freshIp());

      // A pass gets the visitor through and is remembered on the member.
      const passed = await visitor(server, fx.a, ip, { challenge_token: MOCK_CAPTCHA_PASS_TOKEN });
      expect(await passedAt(passed.customerId)).toBeInstanceOf(Date);
      // ... who opens a conversation from the same busy address without being asked again.
      expect((await say(server, ip, passed, 'merhaba')).statusCode).toBe(201);
    });

    it('never asks a member back with the member token this workspace signed (K4), however busy the address', async () => {
      const ip = freshIp();
      const member = await visitor(server, fx.a, ip);
      await visitor(server, fx.a, ip);
      expect((await mint(server, fx.a, ip)).statusCode).toBe(403);

      const back = await visitor(server, fx.a, ip, { member_token: member.memberToken });
      expect(back.customerId).toBe(member.customerId);
      expect((await say(server, ip, back, 'merhaba')).statusCode).toBe(201);
    });

    it('asks nobody while the workspace’s mode is off', async () => {
      await setMode(fx.a, 'off');
      const ip = freshIp();
      for (let i = 0; i < 4; i += 1) await visitor(server, fx.a, ip);
    });

    it('opens no conversation until the visitor passes, in mode always_on_chat_start — then spares them 12 hours', async () => {
      await setMode(fx.a, 'always_on_chat_start');
      const ip = freshIp();
      const member = await visitor(server, fx.a, ip);

      const refused = await say(server, ip, member, 'merhaba');
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual(asked('always_on_chat_start'));
      expect(await chatsOf(member.customerId)).toBe(0);

      const failed = await say(server, ip, member, 'merhaba', { challenge_token: 'nope' });
      expect(failed.json()).toEqual(asked('challenge_failed'));

      const opened = await say(server, ip, member, 'merhaba', {
        challenge_token: MOCK_CAPTCHA_PASS_TOKEN,
      });
      expect(opened.statusCode).toBe(201);
      expect(await passedAt(member.customerId)).toBeInstanceOf(Date);

      // A message into the open conversation is not screened; a new one is,
      // and the pass still holds.
      expect((await say(server, ip, member, 'devam')).statusCode).toBe(201);
      await close(server, ip, member);
      expect((await say(server, ip, member, 'yine ben')).statusCode).toBe(201);

      // A pass 12 hours old no longer does.
      await owner.customer.update({
        where: { id: member.customerId },
        data: { challengePassedAt: new Date(Date.now() - 12 * 3_600_000) },
      });
      await close(server, ip, member);
      expect((await say(server, ip, member, 'ertesi')).json()).toEqual(
        asked('always_on_chat_start'),
      );

      // The member token's holder is never asked, even in this mode.
      const other = await visitor(server, fx.a, freshIp());
      const back = await visitor(server, fx.a, ip, { member_token: other.memberToken });
      expect((await say(server, ip, back, 'merhaba')).statusCode).toBe(201);
    });

    it('asks at the opening message when a risk signal fires: a burst of messages, many AI turns today, a busy address', async () => {
      // A burst: three messages in the minute are fine, the fourth opens and is asked.
      const ip = freshIp();
      const chatty = await visitor(server, fx.a, ip);
      for (const text of ['bir', 'iki', 'üç']) {
        expect((await say(server, ip, chatty, text)).statusCode).toBe(201);
      }
      await close(server, ip, chatty);
      expect((await say(server, ip, chatty, 'dört')).json()).toEqual(asked('messages_per_minute'));

      // Five AI turns today already.
      const busy = await visitor(server, fx.a, freshIp());
      await owner.aiCustomerDailyUsage.create({
        data: {
          licenseId: fx.a.licenseId,
          customerId: busy.customerId,
          day: new Date(`${localDayKey(new Date())}T00:00:00.000Z`),
          aiTurns: 5,
        },
      });
      expect((await say(server, ip, busy, 'merhaba')).json()).toEqual(asked('ai_turns_today'));

      // The address opened its two visitors since: the first one's opening is asked.
      const shared = freshIp();
      const first = await visitor(server, fx.a, shared);
      await visitor(server, fx.a, shared);
      expect((await say(server, shared, first, 'merhaba')).json()).toEqual(
        asked('new_customers_per_ip'),
      );
    });

    it('lets the visitor in when the provider cannot be reached, and the AI does not answer them (GV-01)', async () => {
      await setMode(fx.a, 'always_on_chat_start');
      await agentOf(fx.a);
      const ip = freshIp();
      const member = await visitor(server, fx.a, ip);

      const opened = await say(server, ip, member, 'bonus nedir', {
        challenge_token: MOCK_CAPTCHA_UNAVAILABLE_TOKEN,
      });
      expect(opened.statusCode).toBe(201);
      const { chat_id: chatId } = opened.json() as { chat_id: string };
      const said = await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        select: { text: true },
      });
      // Told a person is coming — not answered by the AI.
      expect(said.map((event) => event.text)).toEqual([DEFAULT_HANDOFF_MESSAGES.ai_failure.tr]);
      const notes = await owner.event.findMany({
        where: {
          chatId,
          type: 'system_message',
          properties: { path: ['system_event'], equals: AI_CHALLENGE_UNVERIFIED_SYSTEM_EVENT },
        },
        select: { text: true, recipients: true },
      });
      expect(notes).toEqual([{ text: CHALLENGE_UNVERIFIED_NOTE_TEXT, recipients: 'agents' }]);
      const records = await owner.aiDecisionLog.findMany({
        where: { chatId },
        select: { decision: true, details: true },
      });
      expect(records).toEqual([
        {
          decision: 'blocked',
          details: {
            reason: 'challenge_unverified',
            handoff_id: expect.any(String),
            reason_codes: ['ai_failure'],
          },
        },
      ]);
      // Not passed: asked again next time.
      expect(await passedAt(member.customerId)).toBeNull();

      // A visitor who passed is answered by the AI as usual.
      const human = await visitor(server, fx.a, freshIp());
      const answered = await say(server, ip, human, 'bonus nedir', {
        challenge_token: MOCK_CAPTCHA_PASS_TOKEN,
      });
      const replies = await owner.event.findMany({
        where: { chatId: (answered.json() as { chat_id: string }).chat_id, authorType: 'bot' },
        select: { text: true },
      });
      expect(replies.map((event) => event.text)).toEqual([expect.stringContaining(BONUS)]);
    });

    it('withholds the AI from a visitor the mint could not check either', async () => {
      const ip = freshIp();
      await visitor(server, fx.a, ip);
      await visitor(server, fx.a, ip);
      const unchecked = await visitor(server, fx.a, ip, {
        challenge_token: MOCK_CAPTCHA_UNAVAILABLE_TOKEN,
      });
      expect(await server.app.abuseGuard.isAiWithheld(fx.a.licenseId, unchecked.customerId)).toBe(
        true,
      );
      expect(await passedAt(unchecked.customerId)).toBeNull();
    });

    it('is set on Settings › Security: risk until saved, one of three modes', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['access_rules:rw'],
      });
      const admin = { authorization: `Bearer ${token}` };
      const ip = freshIp();
      expect(
        (await call(server, ip, 'GET', '/settings/security', undefined, admin)).json(),
      ).toMatchObject({
        captcha_mode: 'risk',
      });
      const saved = await call(
        server,
        ip,
        'PATCH',
        '/settings/security',
        { captcha_mode: 'always_on_chat_start' },
        admin,
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ captcha_mode: 'always_on_chat_start' });
      for (const bad of ['always', '', null, true]) {
        const refused = await call(
          server,
          ip,
          'PATCH',
          '/settings/security',
          { captcha_mode: bad },
          admin,
        );
        expect(refused.statusCode).toBe(400);
      }
    });
  });

  describe('with Turnstile over a stubbed fetch', () => {
    let server: TestServer;
    const siteverify = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    beforeAll(async () => {
      server = await startTestServer(
        {
          ...LOW,
          CAPTCHA_PROVIDER: 'turnstile',
          TURNSTILE_SITE_KEY: '0x4AAAAAAA-test-site',
          TURNSTILE_SECRET_KEY: '0x4AAAAAAA-test-secret',
        },
        { captchaFetch: siteverify },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
      siteverify.mockClear();
    });

    it('announces Turnstile’s site key, checks the token at siteverify, and asks nothing of a quiet visitor', async () => {
      const ip = freshIp();
      await visitor(server, fx.a, ip);
      await visitor(server, fx.a, ip);
      expect(siteverify).not.toHaveBeenCalled();

      expect((await mint(server, fx.a, ip)).json()).toEqual(
        asked('new_customers_per_ip', 'turnstile', '0x4AAAAAAA-test-site'),
      );
      const passed = await visitor(server, fx.a, ip, { challenge_token: 'cf-token' });
      expect(await passedAt(passed.customerId)).toBeInstanceOf(Date);
      expect(siteverify).toHaveBeenCalledTimes(1);
      const [url, init] = siteverify.mock.calls[0]!;
      expect(url).toBe(TURNSTILE_VERIFY_URL);
      expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
        secret: '0x4AAAAAAA-test-secret',
        response: 'cf-token',
        remoteip: ip,
      });
    });

    it('lets the visitor through without AI when siteverify cannot be reached', async () => {
      siteverify.mockImplementationOnce(async () => {
        throw new TypeError('fetch failed');
      });
      const ip = freshIp();
      await visitor(server, fx.a, ip);
      await visitor(server, fx.a, ip);
      const unchecked = await visitor(server, fx.a, ip, { challenge_token: 'cf-token' });
      expect(await server.app.abuseGuard.isAiWithheld(fx.a.licenseId, unchecked.customerId)).toBe(
        true,
      );
    });
  });

  /** An AI agent with one topic — "bonus nedir" — answering first. */
  async function agentOf(t: TenantFixture): Promise<void> {
    const { id } = await owner.aiAgent.create({
      data: { licenseId: t.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    const { procedure: body, ...own } = splitSkillProcedure(
      build({
        when_to_use: 'Oyuncu bonus nedir diyor.',
        examples: ['bonus nedir'],
        steps: [
          { id: 'anlat', type: 'say', instruction: BONUS },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
      }),
    );
    await owner.skill.create({
      data: {
        licenseId: t.licenseId,
        aiAgentId: id,
        name: 'bonus nedir',
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
    await owner.aiHandoffSettings.create({
      data: { aiAgentId: id, licenseId: t.licenseId, assignmentMode: 'ai_first' },
    });
  }
});
