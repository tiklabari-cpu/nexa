/**
 * The procedure engine's HTTP surface (tm 296.4 · SiyahTuş analysis AI-03
 * §11, §13; AI-19's preview inputs):
 *
 *   1. `POST /skills/compile` with `mode: procedure` — an SOP drafted into a
 *      definition: by the rule-based skeleton on the `mock` provider, by the
 *      model otherwise (and the skeleton again when the model cannot answer),
 *      judged as a save would judge it, never stored.
 *   2. `POST /skills/preview` — a procedure previewed from its unsaved
 *      definition, the earlier exchange as history, the state the turn leaves.
 *   3. `GET /chats/{chatId}/ai-conversation` — the AI's state on a live
 *      connection, behind the chat's visibility: a chat the caller may not see
 *      is a 404, the widget's token never reaches it.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import type { SopModelDraft } from '../../src/services/ai/conversation/procedure/sop-draft.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SOP = [
  'Yatırım geçmedi:',
  'Oyuncu "param yatmadı" der.',
  'Oyuncuya hemen bakacağımızı söyle.',
  'Ödeme yöntemini ve işlem saatini sor.',
  'Eğer süre geçtiyse dekontu iste.',
  'Finans ekibine devret.',
].join('\n');

/** A fact-free procedure: the live path runs it end to end before the AI-13 tables (#310). */
function deposit(aiAgentId: string) {
  return {
    name: 'Yatırım geçmedi',
    mode: 'procedure',
    ai_agent_id: aiAgentId,
    when_to_use: 'Oyuncu yatırımının hesabına geçmediğini söylüyor.',
    examples: ['param yatmadı', 'yatırımım gelmedi'],
    slots: [
      {
        name: 'yontem',
        label: 'Ödeme yöntemi',
        type: 'enum',
        ask: 'Hangi yöntemle yatırdınız?',
        validate: { enum_values: ['Papara', 'Havale'] },
      },
      {
        name: 'islem_zamani',
        label: 'İşlem zamanı',
        type: 'datetime',
        ask: 'Ne zaman yatırdınız?',
      },
    ],
    procedure: {
      steps: [
        { id: 'giris', type: 'say', template_key: 'giris' },
        { id: 'sor', type: 'collect', slots: ['yontem', 'islem_zamani'] },
        { id: 'bitti', type: 'resolve', outcome: 'resolved_waiting' },
      ],
      templates: [{ key: 'giris', text: 'Hemen bakalım.' }],
    },
  };
}

interface Workspace {
  owner: PrismaClient;
  fx: Fixtures;
  aiAgentId: string;
  writeToken: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedWorkspace(owner: PrismaClient, server: TestServer): Promise<Workspace> {
  const fx = await seedFixtures(owner);
  await clearRateLimits(server.app);
  const writeToken = await tokenFor(owner, fx.a, ['agents-bot--all:rw']);
  const aiAgentId = (
    await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    })
  ).id;
  return { owner, fx, aiAgentId, writeToken };
}

function tokenFor(
  owner: PrismaClient,
  tenant: TenantFixture,
  scopes: string[],
  ownerId = tenant.ownerAccountId,
): Promise<string> {
  return grantToken(owner, {
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    ownerId,
    scopes,
  });
}

describe('POST /skills/compile — an SOP drafted into a procedure (AI-03 §11)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: Workspace;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    ws = await seedWorkspace(owner, server);
  });

  it('drafts the skeleton on the mock provider, judged as a save would, and stores nothing', async () => {
    const before = await owner.skill.count({ where: { licenseId: ws.fx.a.licenseId } });
    const response = await server.post(
      '/skills/compile',
      { mode: 'procedure', sop_text: SOP },
      auth(ws.writeToken),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      mode: string;
      steps: unknown[];
      unrecognised: string[];
      draft: Record<string, unknown> & {
        source: string;
        problems: unknown[];
        procedure: { steps: Array<{ type: string }> };
      };
    };
    expect(body.mode).toBe('procedure');
    expect(body.steps).toEqual([]);
    expect(body.draft.source).toBe('rules');
    expect(body.draft.problems).toEqual([]);
    expect(body.draft.procedure.steps.map((step) => step.type)).toEqual([
      'say',
      'collect',
      'handoff',
    ]);
    expect(body.unrecognised).toEqual([
      'Oyuncu "param yatmadı" der.',
      'Eğer süre geçtiyse dekontu iste.',
    ]);
    expect(await owner.skill.count({ where: { licenseId: ws.fx.a.licenseId } })).toBe(before);

    // The draft is what POST /skills takes — and a skill made from it is off.
    const { source: _source, problems: _problems, warnings: _warnings, ...fields } = body.draft;
    const created = await server.post(
      '/skills',
      { ...fields, mode: 'procedure', ai_agent_id: ws.aiAgentId },
      auth(ws.writeToken),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ mode: 'procedure', active: false });
  });

  it('still compiles an instruction into one-message steps, and says which it compiled', async () => {
    const response = await server.post(
      '/skills/compile',
      { instruction: 'when the customer asks about refunds, reply with our policy' },
      auth(ws.writeToken),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { mode: string; steps: unknown[]; draft?: unknown };
    expect(body.mode).toBe('single');
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.draft).toBeUndefined();
  });

  it('refuses an empty SOP, an over-long one, and a read-only token', async () => {
    for (const sop_text of ['   ', 'x'.repeat(20_001)]) {
      const response = await server.post(
        '/skills/compile',
        { mode: 'procedure', sop_text },
        auth(ws.writeToken),
      );
      expect(response.statusCode).toBe(400);
    }
    const readOnly = await tokenFor(owner, ws.fx.a, ['agents-bot--all:ro']);
    const response = await server.post(
      '/skills/compile',
      { mode: 'procedure', sop_text: SOP },
      auth(readOnly),
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /skills/compile — the model drafts when one is configured (ADR §6a)', () => {
  let owner: PrismaClient;

  const answer: SopModelDraft = {
    name: 'Yatırım geçmedi',
    when_to_use: 'Oyuncu yatırımının hesaba geçmediğini söylüyor.',
    examples: ['param yatmadı'],
    slots: [{ name: 'yontem', label: 'Ödeme yöntemi', type: 'text', ask: 'Hangi yöntemle?' }],
    steps: [
      {
        id: 'sor',
        type: 'collect',
        instruction: null,
        slots: ['yontem'],
        template_key: null,
        reason_code: null,
        outcome: null,
        tag: null,
      },
      {
        id: 'devir',
        type: 'handoff',
        instruction: null,
        slots: [],
        template_key: null,
        reason_code: 'finance_check',
        outcome: null,
        tag: null,
      },
    ],
    templates: [],
    unrecognised: ['Beklenen süreyle karşılaştır.'],
  };

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  it('asks the model for the schema with the SOP as the message, and returns its draft judged', async () => {
    const fake = new FakeLlmProvider({ reply: JSON.stringify(answer) });
    const server = await startTestServer({}, { llm: fake });
    try {
      const ws = await seedWorkspace(owner, server);
      const response = await server.post(
        '/skills/compile',
        { mode: 'procedure', sop_text: SOP },
        auth(ws.writeToken),
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        unrecognised: string[];
        draft: { source: string; problems: unknown[]; procedure: { steps: unknown[] } };
      };
      expect(body.draft.source).toBe('model');
      expect(body.draft.problems).toEqual([]);
      expect(body.draft.procedure.steps).toEqual([
        { id: 'sor', type: 'collect', slots: ['yontem'] },
        { id: 'devir', type: 'handoff', reason_code: 'finance_check' },
      ]);
      expect(body.unrecognised).toEqual(['Beklenen süreyle karşılaştır.']);

      expect(fake.calls).toHaveLength(1);
      const [call] = fake.calls;
      expect(call!.responseFormat?.name).toBe('sop_procedure_draft');
      expect(call!.messages).toEqual([{ role: 'user', content: SOP }]);
      // Counted against today's AI allowance like any model call (tm 257.8).
      expect(
        await owner.aiUsageEvent.count({ where: { licenseId: ws.fx.a.licenseId } }),
      ).toBeGreaterThan(0);
      // Still nothing stored.
      expect(await owner.skill.count({ where: { licenseId: ws.fx.a.licenseId } })).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('falls back to the skeleton when the model cannot answer, rather than failing the author', async () => {
    const fake = new FakeLlmProvider({ fail: new LlmProviderError('timeout') });
    const server = await startTestServer({}, { llm: fake });
    try {
      const ws = await seedWorkspace(owner, server);
      const response = await server.post(
        '/skills/compile',
        { mode: 'procedure', sop_text: SOP },
        auth(ws.writeToken),
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as { draft: { source: string; problems: unknown[] } };
      expect(body.draft.source).toBe('rules');
      expect(body.draft.problems).toEqual([]);
      expect(fake.calls.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});

describe('POST /skills/preview — a procedure, an earlier exchange, the state it leaves (FR-MOD-06.2.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: Workspace;
  // The stub's own replies, recorded: what the compose call was given.
  const fake = new FakeLlmProvider({ id: 'mock', reply: 'Yazılan yanıt.' });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm: fake });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fake.reset();
    ws = await seedWorkspace(owner, server);
  });

  function preview(body: Record<string, unknown>) {
    return server.post('/skills/preview', body, auth(ws.writeToken));
  }

  it('runs the unsaved procedure and returns the state the turn leaves — nothing written', async () => {
    const { name: _name, ...definition } = deposit(ws.aiAgentId);
    const response = await preview({ ...definition, message: 'param yatmadı' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      outcome: string;
      reply: string;
      procedure_problems: unknown[];
      state: {
        procedure: { skill_id: string; step_id: string; step_status: string };
        slots: Array<{ name: string; status: string }>;
        turns: number;
      };
    };
    expect(body.outcome).toBe('answered');
    expect(body.reply).toBe('Hemen bakalım.\nHangi yöntemle yatırdınız? Ne zaman yatırdınız?');
    expect(body.procedure_problems).toEqual([]);
    expect(body.state.procedure).toMatchObject({
      skill_id: 'preview',
      step_id: 'sor',
      step_status: 'awaiting_answer',
    });
    expect(body.state.slots.map((slot) => [slot.name, slot.status])).toEqual([
      ['yontem', 'missing'],
      ['islem_zamani', 'missing'],
    ]);
    expect(body.state.turns).toBe(1);
    expect(await owner.skill.count({ where: { licenseId: ws.fx.a.licenseId } })).toBe(0);
    expect(await owner.aiConversation.count({ where: { licenseId: ws.fx.a.licenseId } })).toBe(0);
  });

  it('writes the reply with the earlier exchange as the live path would (history, not replay)', async () => {
    const { name: _name, ...definition } = deposit(ws.aiAgentId);
    definition.procedure.steps[0] = {
      id: 'giris',
      type: 'say',
      instruction: 'Özür dile.',
    } as never;
    const response = await preview({
      ...definition,
      conversation: [
        { role: 'visitor', text: 'merhaba' },
        { role: 'ai', text: 'Merhaba, nasıl yardımcı olabilirim?' },
      ],
      message: 'param yatmadı',
    });
    expect(response.statusCode).toBe(200);
    expect(fake.calls).toHaveLength(1);
    const prompt = JSON.stringify(fake.calls[0]);
    expect(prompt).toContain('merhaba');
    expect(prompt).toContain('Merhaba, nasıl yardımcı olabilirim?');
    // Not replayed: the procedure starts with this message.
    expect((response.json() as { state: { turns: number } }).state.turns).toBe(1);
  });

  it('does not run a definition a save would refuse, and says why as codes', async () => {
    const { name: _name, ...definition } = deposit(ws.aiAgentId);
    definition.procedure.steps.push({
      id: 'devir',
      type: 'handoff',
      reason_code: 'x',
      target: { group_id: 999_999 },
    } as never);
    const response = await preview({ ...definition, message: 'param yatmadı' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      outcome: string;
      reply: string | null;
      errors: string[];
      procedure_problems: Array<{ reason: string }>;
      state: { procedure: unknown };
    };
    expect(body.outcome).toBe('skipped');
    expect(body.reply).toBeNull();
    expect(body.procedure_problems.map((problem) => problem.reason)).toContain(
      'procedure_unknown_target',
    );
    expect(body.errors.length).toBe(body.procedure_problems.length);
    expect(body.state.procedure).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('says why a message that does not select the procedure ran nothing', async () => {
    const { name: _name, ...definition } = deposit(ws.aiAgentId);
    const response = await preview({ ...definition, message: 'şifremi unuttum' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { outcome: string; log: Array<{ step: string; ok: boolean }> };
    expect(body.outcome).toBe('skipped');
    expect(body.log).toEqual([expect.objectContaining({ step: 'procedure', ok: false })]);
  });

  it('a one-message preview carries its state too, and still needs its steps', async () => {
    const response = await preview({
      steps: [{ type: 'send_message', source: 'text', text: 'Merhaba.' }],
      message: 'hi',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'answered',
      state: { procedure: null, slots: [], turns: 1 },
    });
    expect((await preview({ message: 'hi' })).statusCode).toBe(400);
  });
});

describe('GET /chats/{chatId}/ai-conversation — the AI state, behind the chat visibility (AI-03 §13)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: Workspace;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    ws = await seedWorkspace(owner, server);
  });

  async function liveProcedureChat(): Promise<{
    chatId: string;
    threadId: string;
    customer: string;
  }> {
    const created = await server.post('/skills', deposit(ws.aiAgentId), auth(ws.writeToken));
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect(
      (await server.patch(`/skills/${id}`, { active: true }, auth(ws.writeToken))).statusCode,
    ).toBe(200);
    const minted = await server.post(
      '/customer/token',
      { organization_id: ws.fx.a.organizationId },
      { origin: `https://${ws.fx.a.trustedDomain}` },
    );
    const customer = (minted.json() as { token: string }).token;
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'param yatmadı' },
      auth(customer),
    );
    expect(sent.statusCode).toBe(201);
    const body = sent.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: body.chat_id, threadId: body.event.thread_id, customer };
  }

  /** An agent of the workspace in no team and in no conversation. */
  async function outsider(): Promise<{ token: string; accountId: string }> {
    const account = await owner.account.create({
      data: { email: `outsider-${randomUUID()}@example.test`, name: 'Outsider' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: ws.fx.a.licenseId,
        agentId: account.id,
        role: 'agent',
        routingStatus: 'not_accepting_chats',
      },
    });
    return {
      token: await tokenFor(owner, ws.fx.a, ['chats--access:ro'], account.id),
      accountId: account.id,
    };
  }

  it('shows an agent the procedure, its step, what was collected and what is still missing', async () => {
    const live = await liveProcedureChat();
    const reader = await tokenFor(owner, ws.fx.a, ['chats--all:ro']);
    const response = await server.get(`/chats/${live.chatId}/ai-conversation`, auth(reader));
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      chat_id: string;
      thread_id: string;
      conversation: Record<string, unknown> & {
        procedure: Record<string, unknown>;
        slots: Array<{ name: string; label: string; status: string }>;
      };
    };
    expect(body.chat_id).toBe(live.chatId);
    expect(body.thread_id).toBe(live.threadId);
    expect(body.conversation).toMatchObject({
      mode: 'ai',
      turns: 1,
      outcome: null,
      suspended: null,
      closed_at: null,
      procedure: { skill_name: 'Yatırım geçmedi', step_id: 'sor', step_status: 'awaiting_answer' },
    });
    expect(typeof body.conversation['updated_at']).toBe('string');
    const row = await owner.aiConversation.findFirstOrThrow({ where: { threadId: live.threadId } });
    expect(body.conversation.procedure['snapshot_hash']).toBe(row.procedureSnapshotHash);
    expect(body.conversation.slots.map((slot) => [slot.name, slot.label, slot.status])).toEqual([
      ['yontem', 'Ödeme yöntemi', 'missing'],
      ['islem_zamani', 'İşlem zamanı', 'missing'],
    ]);

    // The connection named by id reads the same; a thread of nowhere is a 404.
    const named = await server.get(
      `/chats/${live.chatId}/ai-conversation?thread_id=${live.threadId}`,
      auth(reader),
    );
    expect(named.json()).toEqual(body);
    expect(
      (await server.get(`/chats/${live.chatId}/ai-conversation?thread_id=NOPE000000`, auth(reader)))
        .statusCode,
    ).toBe(404);
  });

  it('is a 404 to an agent who may not see the chat, and to another workspace (NFR-S5)', async () => {
    const live = await liveProcedureChat();
    const { token: outsiderToken, accountId } = await outsider();
    expect(
      (await server.get(`/chats/${live.chatId}/ai-conversation`, auth(outsiderToken))).statusCode,
    ).toBe(404);
    // The same agent can read it the moment the chat is theirs through a team.
    const team = await owner.group.create({
      data: { licenseId: ws.fx.a.licenseId, name: 'Finans' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: { licenseId: ws.fx.a.licenseId, groupId: team.id, agentId: accountId },
    });
    await owner.chatAccess.create({ data: { chatId: live.chatId, groupId: team.id } });
    expect(
      (await server.get(`/chats/${live.chatId}/ai-conversation`, auth(outsiderToken))).statusCode,
    ).toBe(200);

    const otherWorkspace = await tokenFor(owner, ws.fx.b, ['chats--all:ro']);
    expect(
      (await server.get(`/chats/${live.chatId}/ai-conversation`, auth(otherWorkspace))).statusCode,
    ).toBe(404);
  });

  it('is never served to the widget: the visitor’s own token finds no such route', async () => {
    const live = await liveProcedureChat();
    const response = await server.get(`/chats/${live.chatId}/ai-conversation`, auth(live.customer));
    // A customer token on an agent route is a 404, not a 403 (auth plugin I4):
    // the widget surface must not map the agent API.
    expect(response.statusCode).toBe(404);
  });

  it('a chat the AI never took part in has no conversation', async () => {
    const minted = await server.post(
      '/customer/token',
      { organization_id: ws.fx.a.organizationId },
      { origin: `https://${ws.fx.a.trustedDomain}` },
    );
    const customer = (minted.json() as { token: string }).token;
    // No AI skill is on: nobody answers but a person.
    const sent = await server.post('/customer/chat/events', { text: 'merhaba' }, auth(customer));
    const chatId = (sent.json() as { chat_id: string }).chat_id;
    const reader = await tokenFor(owner, ws.fx.a, ['chats--all:ro']);
    const response = await server.get(`/chats/${chatId}/ai-conversation`, auth(reader));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ chat_id: chatId, conversation: null });
  });
});
