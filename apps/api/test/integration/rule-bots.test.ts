/**
 * The rule bot, running on real customer messages (FR-MOD-06.6).
 *
 * PRD:577's KK is one sentence with two halves, and this file is organised
 * around them because that is what closing the row means:
 *
 *   1. **"Kural bazlı bot"** — a rule fires on the visitor's own words and the
 *      bot answers, without a model, an embedding or the knowledge base being
 *      consulted. The structural half of that claim is
 *      `src/services/bots/rule-bot-isolation.test.ts`, which reads the import
 *      graph; this file is the behavioural half, and it pins the answer to the
 *      byte, because a deterministic engine is one whose output you can write
 *      down in advance.
 *   2. **"gruplara priority ile atanır"** — the assignment has to make an
 *      OBSERVABLE difference, not merely be storable. Two bots, both matching,
 *      different tiers: the stronger tier answers.
 *
 * Around those sit the guards: a rule with no condition or no action is refused,
 * a disabled bot does nothing, a rule cannot transfer to nobody, and — the
 * failure most easily shipped unseen — a bot never reaches another tenant.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface RuleBotRule {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  enabled: boolean;
  position: number;
}

interface RuleBot {
  id: string;
  name: string;
  enabled: boolean;
  groups: Array<{ group_id: number; priority: string }>;
  rules: RuleBotRule[];
}

describe('rule bots (FR-MOD-06.6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let supportGroupId: bigint;
  let salesGroupId: bigint;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const createBot = (token: string, body: unknown) =>
    server.post('/settings/bots', body, auth(token));

  const listBots = async (token: string): Promise<RuleBot[]> => {
    const response = await server.get('/settings/bots', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: RuleBot[] }).items;
  };

  const addRule = (token: string, botId: string, body: unknown) =>
    server.post(`/settings/bots/${botId}/rules`, body, auth(token));

  /** A bot on the Support team with one rule, the shape most tests want. */
  async function seedBot(options: {
    name?: string;
    priority?: string;
    groupId?: bigint;
    conditions: Record<string, unknown>;
    actions: Record<string, unknown>;
    enabled?: boolean;
    ruleEnabled?: boolean;
  }): Promise<string> {
    const created = await createBot(adminToken, {
      name: options.name ?? 'FAQ',
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
      groups: [
        {
          group_id: Number(options.groupId ?? supportGroupId),
          priority: options.priority ?? 'normal',
        },
      ],
    });
    expect(created.statusCode).toBe(201);
    const botId = (created.json() as RuleBot).id;

    const rule = await addRule(adminToken, botId, {
      name: 'Rule',
      conditions: options.conditions,
      actions: options.actions,
      ...(options.ruleEnabled === undefined ? {} : { enabled: options.ruleEnabled }),
    });
    expect(rule.statusCode).toBe(201);
    return botId;
  }

  async function visitorToken(tenant = fx.a): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  async function writeIn(
    text: string,
    options: { tenant?: Fixtures['a']; url?: string } = {},
  ): Promise<string> {
    const headers = await visitorToken(options.tenant ?? fx.a);
    const response = await server.post(
      '/customer/chat/events',
      { text, ...(options.url ? { url: options.url } : {}) },
      headers,
    );
    expect(response.statusCode).toBe(201);
    return (response.json() as { chat_id: string }).chat_id;
  }

  async function events(chatId: string) {
    return owner.event.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true, authorId: true, properties: true },
    });
  }

  const botReplies = async (chatId: string): Promise<string[]> =>
    (await events(chatId)).filter((e) => e.authorType === 'bot').map((e) => e.text ?? '');

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

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    supportGroupId = support.id;
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    salesGroupId = sales.id;

    // Somebody has to be accepting in Sales, or a transfer there is refused for
    // stranding the customer — which is a different rule from the one under test.
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: sales.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
        priority: 100,
      },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
  });

  // --- Validation: condition + action required ------------------------------

  describe('a rule has to be finished before it is saved', () => {
    let botId: string;

    beforeEach(async () => {
      const created = await createBot(adminToken, { name: 'Greeter' });
      botId = (created.json() as RuleBot).id;
    });

    it('rejects a rule with no condition', async () => {
      // An empty predicate is not "answer everything" — that reading would turn
      // an unfinished rule into a bot that replies to every visitor.
      const response = await addRule(adminToken, botId, {
        name: 'No condition',
        conditions: {},
        actions: { send_message: 'Hello' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a rule with no action', async () => {
      const response = await addRule(adminToken, botId, {
        name: 'No action',
        conditions: { message_contains: 'hello' },
        actions: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown condition key rather than ignoring it', async () => {
      // A silently dropped key is a rule that matches nobody and looks saved.
      const response = await addRule(adminToken, botId, {
        name: 'Typo',
        conditions: { message_regex: '.*' },
        actions: { send_message: 'Hello' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a transfer to a team that is not on this licence', async () => {
      const response = await addRule(adminToken, botId, {
        name: 'Nowhere',
        conditions: { message_contains: 'sales' },
        actions: { transfer_to_group_id: 999_999 },
      });
      expect(response.statusCode).toBe(400);
    });

    it('refuses to strip the action out of a rule by editing it', async () => {
      const created = await addRule(adminToken, botId, {
        name: 'Real rule',
        conditions: { message_contains: 'hello' },
        actions: { send_message: 'Hi there' },
      });
      const ruleId = (created.json() as RuleBotRule).id;

      const response = await server.patch(
        `/settings/bots/${botId}/rules/${ruleId}`,
        { actions: {} },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });
  });

  describe('bot configuration', () => {
    it('refuses a second bot with the same name', async () => {
      expect((await createBot(adminToken, { name: 'FAQ' })).statusCode).toBe(201);
      expect((await createBot(adminToken, { name: 'FAQ' })).statusCode).toBe(400);
    });

    it("refuses to attach a bot to another tenant's team", async () => {
      const theirs = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Their team' },
        select: { id: true },
      });
      const response = await createBot(adminToken, {
        name: 'Reacher',
        groups: [{ group_id: Number(theirs.id), priority: 'normal' }],
      });
      expect(response.statusCode).toBe(400);
    });

    it('replaces the whole team list on edit, so a team can be removed', async () => {
      const created = await createBot(adminToken, {
        name: 'FAQ',
        groups: [
          { group_id: Number(supportGroupId), priority: 'first' },
          { group_id: Number(salesGroupId), priority: 'last' },
        ],
      });
      const botId = (created.json() as RuleBot).id;

      const updated = await server.patch(
        `/settings/bots/${botId}`,
        { groups: [{ group_id: Number(salesGroupId), priority: 'primary' }] },
        auth(adminToken),
      );
      expect(updated.statusCode).toBe(200);
      expect((updated.json() as RuleBot).groups).toEqual([
        { group_id: Number(salesGroupId), priority: 'primary' },
      ]);
    });

    it('returns the rules in evaluation order, not insertion order', async () => {
      const created = await createBot(adminToken, { name: 'FAQ' });
      const botId = (created.json() as RuleBot).id;
      await addRule(adminToken, botId, {
        name: 'Second',
        conditions: { message_contains: 'b' },
        actions: { send_message: 'b' },
        position: 5,
      });
      await addRule(adminToken, botId, {
        name: 'First',
        conditions: { message_contains: 'a' },
        actions: { send_message: 'a' },
        position: 1,
      });

      const [bot] = await listBots(adminToken);
      expect(bot?.rules.map((r) => r.name)).toEqual(['First', 'Second']);
    });
  });

  // --- The KK's first half: a rule answers the visitor ----------------------

  describe('a rule answers the visitor', () => {
    it('replies with the workspace’s own words, to the byte', async () => {
      // The point of the row: the answer is the sentence somebody typed into
      // the editor, not something shaped by a model. Written down here in
      // advance, which is what "deterministic" has to mean to be testable.
      const answer = 'We are open Monday to Friday, 09:00–18:00 (CET).';
      const botId = await seedBot({
        conditions: { message_word: 'hours' },
        actions: { send_message: answer },
      });

      const chatId = await writeIn('what are your opening hours?');
      expect(await botReplies(chatId)).toEqual([answer]);

      // Authored as a *bot*, and as WHICH bot — a workspace with two of them
      // needs the transcript to say which one spoke.
      const reply = (await events(chatId)).find((e) => e.authorType === 'bot');
      expect(reply?.authorId).toBe(botId);
      expect((await events(chatId)).some((e) => e.authorType === 'agent')).toBe(false);
    });

    it('says nothing when no rule matches', async () => {
      await seedBot({
        conditions: { message_word: 'hours' },
        actions: { send_message: 'We are open 09:00-18:00.' },
      });
      expect(await botReplies(await writeIn('my parcel is late'))).toEqual([]);
    });

    it('says nothing while the bot is switched off', async () => {
      await seedBot({
        enabled: false,
        conditions: { message_word: 'hours' },
        actions: { send_message: 'We are open 09:00-18:00.' },
      });
      expect(await botReplies(await writeIn('what are your hours?'))).toEqual([]);
    });

    it('says nothing while the rule is switched off', async () => {
      await seedBot({
        ruleEnabled: false,
        conditions: { message_word: 'hours' },
        actions: { send_message: 'We are open 09:00-18:00.' },
      });
      expect(await botReplies(await writeIn('what are your hours?'))).toEqual([]);
    });

    it('says nothing when the bot serves no team the chat belongs to', async () => {
      // Reach is the assignment: a bot parked on Sales does not answer a chat
      // routed to Support.
      await seedBot({
        groupId: salesGroupId,
        conditions: { message_word: 'hours' },
        actions: { send_message: 'We are open 09:00-18:00.' },
      });
      expect(await botReplies(await writeIn('what are your hours?'))).toEqual([]);
    });

    it('applies only the FIRST matching rule, not every matching rule', async () => {
      // Two replies to one question is the defect this ordering exists to
      // prevent; it is also what makes "which rule answered?" answerable.
      const created = await createBot(adminToken, {
        name: 'FAQ',
        groups: [{ group_id: Number(supportGroupId), priority: 'normal' }],
      });
      const botId = (created.json() as RuleBot).id;
      await addRule(adminToken, botId, {
        name: 'Specific',
        conditions: { message_word: 'refund' },
        actions: { send_message: 'Refunds take 5 days.' },
        position: 0,
      });
      await addRule(adminToken, botId, {
        name: 'Catch-all',
        conditions: { message_contains: 'e' },
        actions: { send_message: 'Someone will be with you.' },
        position: 1,
      });

      expect(await botReplies(await writeIn('i want a refund please'))).toEqual([
        'Refunds take 5 days.',
      ]);
    });

    it('matches on the page the visitor is writing from', async () => {
      await seedBot({
        conditions: { page_url_contains: '/pricing' },
        actions: { send_message: 'Happy to talk pricing.' },
      });

      expect(
        await botReplies(await writeIn('hello', { url: 'https://shop.example.com/pricing' })),
      ).toEqual(['Happy to talk pricing.']);
      expect(
        await botReplies(await writeIn('hello', { url: 'https://shop.example.com/blog' })),
      ).toEqual([]);
    });

    it('matches on the page of a LATER message in an open conversation', async () => {
      // The widget sends to one endpoint by two paths — open a chat, or add to
      // the one already open — and the second is where a visitor spends most of
      // a conversation. A URL plumbed on only the first would make a
      // page-scoped rule fire once and then never again.
      await seedBot({
        conditions: { page_url_contains: '/pricing' },
        actions: { send_message: 'Happy to talk pricing.' },
      });

      const headers = await visitorToken();
      const opened = await server.post(
        '/customer/chat/events',
        { text: 'hello', url: 'https://shop.example.com/blog' },
        headers,
      );
      expect(opened.statusCode).toBe(201);
      const chatId = (opened.json() as { chat_id: string }).chat_id;
      expect(await botReplies(chatId)).toEqual([]);

      await server.post(
        '/customer/chat/events',
        { text: 'still me', url: 'https://shop.example.com/pricing' },
        headers,
      );
      expect(await botReplies(chatId)).toEqual(['Happy to talk pricing.']);
    });

    it('tags the conversation and transfers it to the named team', async () => {
      await seedBot({
        conditions: { message_word: 'buy' },
        actions: { add_tag: 'lead', transfer_to_group_id: Number(salesGroupId) },
      });

      const chatId = await writeIn('i want to buy the pro plan');

      const tags = await owner.threadTag.findMany({
        where: { thread: { chatId } },
        select: { tag: { select: { name: true } } },
      });
      expect(tags.map((t) => t.tag.name)).toContain('lead');

      const access = await owner.chatAccess.findMany({ where: { chatId } });
      expect(access.map((a) => a.groupId)).toEqual([salesGroupId]);
    });

    it('files its transfer as bot_handoff, never as ai_handoff', async () => {
      // `ai_handoff` is what the AI Agent report counts as an AI transfer
      // (FR-MOD-06.5's "Transferred %"). A deterministic rule filed under that
      // name would inflate a figure about a model nobody consulted.
      await seedBot({
        conditions: { message_word: 'buy' },
        actions: { transfer_to_group_id: Number(salesGroupId) },
      });

      const chatId = await writeIn('i want to buy the pro plan');
      const reasons = (await events(chatId))
        .map((e) => (e.properties as { reason?: string } | null)?.reason)
        .filter(Boolean);
      expect(reasons).toContain('bot_handoff');
      expect(reasons).not.toContain('ai_handoff');
    });
  });

  // --- The KK's second half: priority within a team is observable -----------

  describe('a bot is assigned to a team WITH A PRIORITY, and the priority decides', () => {
    async function twoBotsBothMatching(first: string, second: string): Promise<void> {
      await seedBot({
        name: 'Early bot',
        priority: first,
        conditions: { message_contains: 'help' },
        actions: { send_message: 'Answered by the early bot.' },
      });
      await seedBot({
        name: 'Late bot',
        priority: second,
        conditions: { message_contains: 'help' },
        actions: { send_message: 'Answered by the late bot.' },
      });
    }

    it('tries the stronger tier first', async () => {
      await twoBotsBothMatching('primary', 'last');
      expect(await botReplies(await writeIn('i need help'))).toEqual([
        'Answered by the early bot.',
      ]);
    });

    it('changes its answer when the priorities are swapped — nothing else moves', async () => {
      // The same two bots, the same rules, the same message: only the tier is
      // different, and the observable result follows it. Without this pairing a
      // passing test could just be reporting creation order.
      await twoBotsBothMatching('last', 'primary');
      expect(await botReplies(await writeIn('i need help'))).toEqual(['Answered by the late bot.']);
    });

    it('takes a bot at its best tier across the teams it shares with the chat', async () => {
      // `Broad bot` is `last` in Support but `primary` in Sales; the chat
      // belongs to both, so it is tried at `primary`.
      const created = await createBot(adminToken, {
        name: 'Broad bot',
        groups: [
          { group_id: Number(supportGroupId), priority: 'last' },
          { group_id: Number(salesGroupId), priority: 'primary' },
        ],
      });
      const botId = (created.json() as RuleBot).id;
      await addRule(adminToken, botId, {
        name: 'Rule',
        conditions: { message_contains: 'help' },
        actions: { send_message: 'Answered by the broad bot.' },
      });
      await seedBot({
        name: 'Narrow bot',
        priority: 'first',
        conditions: { message_contains: 'help' },
        actions: { send_message: 'Answered by the narrow bot.' },
      });

      // Put the chat in both teams, the way a transfer or a multi-team routing
      // rule would. One visitor throughout: a second token would be a second
      // person and therefore a second conversation.
      const headers = await visitorToken();
      const opened = await server.post('/customer/chat/events', { text: 'hello there' }, headers);
      expect(opened.statusCode).toBe(201);
      const chatId = (opened.json() as { chat_id: string }).chat_id;
      await owner.chatAccess.create({ data: { chatId, groupId: salesGroupId } });

      await server.post('/customer/chat/events', { text: 'i need help' }, headers);
      expect(await botReplies(chatId)).toEqual(['Answered by the broad bot.']);
    });
  });

  // --- The one condition that is not a property of the request --------------

  describe('business hours come from the workspace’s own calendar', () => {
    /** Save a plan for the tenant's agent. An empty `schedule` is never open. */
    async function saveSchedule(slots: unknown[]): Promise<void> {
      await owner.workSchedule.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: fx.a.agentAccountId,
          timezone: 'UTC',
          schedule: slots as object,
          updatedAt: new Date(),
        },
      });
    }

    it('fires a `closed` rule when every saved day is off', async () => {
      // The calendar is the union of the agents' saved `work_schedules`, the
      // same one the SLA clock uses (§C-A27). Every day present and every day
      // off is a workspace that has said, deliberately, that it is never open —
      // so a `closed` rule fires at any hour the suite happens to run at.
      await saveSchedule(
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
          (day) => ({ day, start: '09:00', end: '18:00', enabled: false }),
        ),
      );
      await seedBot({
        conditions: { office_hours: 'closed' },
        actions: { send_message: 'We are closed right now.' },
      });

      expect(await botReplies(await writeIn('anybody there?'))).toEqual([
        'We are closed right now.',
      ]);
    });

    it('does not fire an `open` rule against that same calendar', async () => {
      await saveSchedule(
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
          (day) => ({ day, start: '09:00', end: '18:00', enabled: false }),
        ),
      );
      await seedBot({
        conditions: { office_hours: 'open' },
        actions: { send_message: 'We are open.' },
      });

      expect(await botReplies(await writeIn('anybody there?'))).toEqual([]);
    });

    it('treats a workspace that saved no plan at all as open', async () => {
      // No rows is "nothing is known", and an invented 09:00-18:00 would close a
      // team that never said it closes — the SLA module's own reading, kept
      // rather than a second one invented here.
      await seedBot({
        conditions: { office_hours: 'open' },
        actions: { send_message: 'We are open.' },
      });

      expect(await botReplies(await writeIn('anybody there?'))).toEqual(['We are open.']);
    });
  });

  // --- Where the deterministic pass stops and the AI begins ------------------

  describe('the rule bot runs before the AI Agent', () => {
    /** An AI that would answer everything, so its silence is meaningful. */
    async function activeAiThatAlwaysAnswers(): Promise<void> {
      const agent = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: agent.id,
          name: 'Always',
          kind: 'ai_agent',
          steps: [{ type: 'send_message', source: 'text', text: 'The AI answered.' }] as object,
          active: true,
          updatedAt: new Date(),
        },
      });
    }

    it('answers instead of the AI when a rule replies', async () => {
      await activeAiThatAlwaysAnswers();
      await seedBot({
        conditions: { message_word: 'hours' },
        actions: { send_message: 'We are open 09:00-18:00.' },
      });

      expect(await botReplies(await writeIn('what are your hours?'))).toEqual([
        'We are open 09:00-18:00.',
      ]);
    });

    it('still lets the AI answer when the rule only tags', async () => {
      // A tag is an annotation, not an answer. "Tag anything containing
      // 'refund' with billing" must not silently switch the AI off for every
      // refund question.
      await activeAiThatAlwaysAnswers();
      await seedBot({
        conditions: { message_word: 'refund' },
        actions: { add_tag: 'billing' },
      });

      const chatId = await writeIn('i would like a refund');
      expect(await botReplies(chatId)).toEqual(['The AI answered.']);
      const tags = await owner.threadTag.findMany({
        where: { thread: { chatId } },
        select: { tag: { select: { name: true } } },
      });
      expect(tags.map((t) => t.tag.name)).toContain('billing');
    });

    it('leaves the AI its turn when no rule matches at all', async () => {
      await activeAiThatAlwaysAnswers();
      await seedBot({
        conditions: { message_word: 'hours' },
        actions: { send_message: 'We are open 09:00-18:00.' },
      });
      expect(await botReplies(await writeIn('where is my parcel?'))).toEqual(['The AI answered.']);
    });
  });

  // --- Cross-tenant isolation -----------------------------------------------

  describe('cross-tenant', () => {
    let bToken: string;

    beforeEach(async () => {
      bToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      });
    });

    it("never answers another tenant's visitor, and is not even visible there", async () => {
      await seedBot({
        conditions: { message_contains: 'hello' },
        actions: { send_message: 'Leaked across tenants.' },
      });
      // B needs a team and a route of its own, or its visitor has no
      // conversation for a bot to be reachable from either way.
      const theirGroup = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Their support' },
        select: { id: true },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.b.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: theirGroup.id,
          priority: 100,
        },
      });

      expect(await botReplies(await writeIn('hello there', { tenant: fx.b }))).toEqual([]);
      expect(await listBots(bToken)).toHaveLength(0);
    });

    it("answers 404 for another tenant's bot id rather than 403", async () => {
      // A 403 would confirm the id names something real (NFR-S5).
      const botId = await seedBot({
        conditions: { message_contains: 'hello' },
        actions: { send_message: 'Hi' },
      });

      expect(
        (await server.patch(`/settings/bots/${botId}`, { enabled: false }, auth(bToken)))
          .statusCode,
      ).toBe(404);
      expect((await server.del(`/settings/bots/${botId}`, auth(bToken))).statusCode).toBe(404);
      expect(
        (
          await server.post(
            `/settings/bots/${botId}/rules`,
            {
              name: 'Theirs',
              conditions: { message_contains: 'x' },
              actions: { send_message: 'x' },
            },
            auth(bToken),
          )
        ).statusCode,
      ).toBe(404);

      // And the refusal really left the bot alone.
      const [bot] = await listBots(adminToken);
      expect(bot?.enabled).toBe(true);
      expect(bot?.rules).toHaveLength(1);
    });

    it('cannot reach a rule by pairing it with a bot the caller may see', async () => {
      // B owns `theirBot`; A owns the rule. Asking for A's rule under B's bot
      // must not resolve just because each id is real on its own.
      await seedBot({
        conditions: { message_contains: 'hello' },
        actions: { send_message: 'Hi' },
      });
      const [mine] = await listBots(adminToken);
      const ruleId = mine!.rules[0]!.id;

      const theirs = await server.post('/settings/bots', { name: 'Theirs' }, auth(bToken));
      const theirBotId = (theirs.json() as RuleBot).id;

      const response = await server.del(
        `/settings/bots/${theirBotId}/rules/${ruleId}`,
        auth(bToken),
      );
      expect(response.statusCode).toBe(404);
      expect((await listBots(adminToken))[0]?.rules).toHaveLength(1);
    });
  });

  // --- A rule belongs to ONE bot, inside the tenant as well as across it ----

  describe('a rule is reachable only under the bot that owns it', () => {
    let ownerBotId: string;
    let otherBotId: string;
    let ruleId: string;

    beforeEach(async () => {
      ownerBotId = await seedBot({
        name: 'Owning bot',
        conditions: { message_contains: 'hello' },
        actions: { send_message: 'Hi' },
      });
      const other = await createBot(adminToken, { name: 'Other bot' });
      otherBotId = (other.json() as RuleBot).id;
      ruleId = (await listBots(adminToken)).find((b) => b.id === ownerBotId)!.rules[0]!.id;
    });

    it('refuses a delete addressed through the wrong bot', async () => {
      // Same workspace, so RLS says yes to both ids — what must stop this is the
      // `bot_id` in the WHERE clause. Without it the URL says "delete rule R of
      // bot B" and quietly deletes a rule belonging to bot A.
      const response = await server.del(
        `/settings/bots/${otherBotId}/rules/${ruleId}`,
        auth(adminToken),
      );
      expect(response.statusCode).toBe(404);
      expect((await listBots(adminToken)).find((b) => b.id === ownerBotId)?.rules).toHaveLength(1);
    });

    it('refuses an edit addressed through the wrong bot', async () => {
      const response = await server.patch(
        `/settings/bots/${otherBotId}/rules/${ruleId}`,
        { enabled: false },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(404);
      expect((await listBots(adminToken)).find((b) => b.id === ownerBotId)?.rules[0]?.enabled).toBe(
        true,
      );
    });
  });

  // --- Scope split -----------------------------------------------------------

  describe('scopes', () => {
    it('lets a read-only holder list but not create', async () => {
      const readToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents-bot--all:ro'],
      });
      expect((await server.get('/settings/bots', auth(readToken))).statusCode).toBe(200);
      expect((await createBot(readToken, { name: 'Nope' })).statusCode).toBe(403);
    });

    it('refuses a caller with no bot scope at all', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      expect((await server.get('/settings/bots', auth(token))).statusCode).toBe(403);
    });
  });
});
