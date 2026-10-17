/**
 * The context loader (tm 292.3 · SiyahTuş analysis AI-01), against the real
 * database and through the live turn.
 *
 * What only the database can show:
 *
 *   - an internal note (`recipients = 'agents'`) never enters a turn's context
 *     — not as a message, not as a note — because the query never returns it;
 *   - another connection's events never enter, whether it is another chat of
 *     the same workspace, a reference whose halves disagree, or another
 *     workspace's (row level security);
 *   - the budget's opening message is found by the index from the other end
 *     when the conversation is longer than the window, and the window's query
 *     is an index scan of `(thread_id, event_sequence)` as `siyahtus_app` —
 *     no sort, no sequential scan.
 *
 * And through the server, the model's own request: the second turn of
 * "Param yatmadı" → question → "Papara 13:40" carries the three messages in
 * order and role, an internal note posted between them appears in no request,
 * and a forty-message conversation keeps its opening message and fits
 * `LLM_MAX_PROMPT_CHARS` instead of being refused as `prompt_too_long`.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { generateShortId } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import {
  GAP_MARKER,
  loadConnectionContext,
  loadConnectionEvents,
} from '../../src/services/ai/conversation/context-loader.js';
import type { ConnectionRef } from '../../src/services/ai/conversation/state-store.js';
import { emptyTurnState } from '../../src/services/ai/conversation/turn.js';
import { promptLength } from '../../src/services/ai/provider/llm-provider.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const NOTE = 'NOTE: VIP oyuncu, iade önceden onaylı';
const ASKED = 'Hangi yöntemle ve saat kaçta yatırdınız?';
const PASSAGE =
  'Papara: param yatmadı diyorsanız yöntem ve saati yazın; Papara yatırımları 15 dakikada geçer, 13:40 gibi saatle kontrol ederiz.';
/** Low enough that forty long messages cannot all fit beside the passage. */
const MAX_PROMPT_CHARS = 6_000;

interface PlanNode {
  'Node Type': string;
  'Index Cond'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

describe('the context loader (AI-01)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  const tenantOf = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  /** A chat with one connection, seeded as the owner so RLS is not in the way. */
  async function seedConnection(t: TenantFixture): Promise<ConnectionRef> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Vic' },
      select: { id: true },
    });
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: true },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: true },
    });
    return { chatId, threadId };
  }

  /** One event, its id minted the way the chat service mints it. Returns its sequence. */
  async function append(
    t: TenantFixture,
    ref: ConnectionRef,
    event: {
      authorType: 'customer' | 'bot' | 'agent' | 'system';
      text: string | null;
      type?: 'message' | 'file' | 'system_message';
      recipients?: 'all' | 'agents';
      attachmentUrl?: string;
      properties?: Record<string, unknown>;
    },
  ): Promise<number> {
    const [row] = await owner.$queryRaw<Array<{ event_sequence: number }>>`
      UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${ref.threadId}
      RETURNING event_sequence
    `;
    const sequence = Number(row!.event_sequence);
    await owner.$executeRaw`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type,
                          recipients, attachment_url, properties)
      VALUES (${`${ref.threadId}_${sequence}`}, ${ref.threadId}, ${ref.chatId}, ${t.licenseId},
              ${event.type ?? 'message'}, ${event.text}, ${event.authorType},
              ${event.recipients ?? 'all'}, ${event.attachmentUrl ?? null},
              ${JSON.stringify(event.properties ?? {})}::jsonb)
    `;
    return sequence;
  }

  const read = <T>(t: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, tenantOf(t), fn);

  beforeAll(() => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  it('reads the connection in order and role, and never an internal note (AI-01)', async () => {
    const ref = await seedConnection(fx.a);
    await append(fx.a, ref, { authorType: 'customer', text: 'Param yatmadı' });
    await append(fx.a, ref, { authorType: 'bot', text: ASKED });
    await append(fx.a, ref, { authorType: 'agent', text: NOTE, recipients: 'agents' });
    await append(fx.a, ref, {
      authorType: 'system',
      type: 'system_message',
      text: 'Chat taken over',
      recipients: 'agents',
      properties: { system_event: 'chat_taken_over' },
    });
    await append(fx.a, ref, {
      authorType: 'system',
      type: 'system_message',
      text: 'Chat transferred',
      properties: { system_event: 'chat_transferred' },
    });
    // A system line the turn is not told about.
    await append(fx.a, ref, {
      authorType: 'system',
      type: 'system_message',
      text: 'Rated good',
      properties: { system_event: 'chat_rated' },
    });
    await append(fx.a, ref, { authorType: 'agent', text: 'Kontrol ediyorum.' });
    await append(fx.a, ref, {
      authorType: 'customer',
      text: 'Dekont',
      attachmentUrl: `/api/v1/uploads/${fx.a.licenseId}-1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a.jpg`,
    });
    const last = await append(fx.a, ref, { authorType: 'customer', text: 'Papara 13:40' });

    const { events, gapAfter } = await read(fx.a, (tx) =>
      loadConnectionEvents(tx, ref, { through: last, maxMessages: 20 }),
    );
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 5, 7, 8, 9]);
    expect(gapAfter).toBeNull();

    const context = await read(fx.a, (tx) =>
      loadConnectionContext(tx, ref, emptyTurnState(), {
        through: last,
        processedThrough: last - 1,
      }),
    );
    expect(context.messages).toEqual([
      { role: 'user', content: 'Param yatmadı' },
      { role: 'assistant', content: `${ASKED}\n[Agent] Kontrol ediyorum.` },
      { role: 'user', content: 'Dekont\n[Attachment: image, .jpg]' },
    ]);
    expect(context.systemNotes).toEqual([expect.stringMatching(/ UTC — Chat transferred$/)]);
    expect(context.newCustomerText).toBe('Papara 13:40');
    expect(context.lastSeq).toBe(last);
    const all = JSON.stringify(context);
    expect(all).not.toContain('VIP');
    expect(all).not.toContain('taken over');
    expect(all).not.toContain('uploads');
  });

  it('reads nothing of another connection: another chat, a mismatched reference, another workspace', async () => {
    const mine = await seedConnection(fx.a);
    const other = await seedConnection(fx.a);
    const theirs = await seedConnection(fx.b);
    await append(fx.a, mine, { authorType: 'customer', text: 'mine' });
    await append(fx.a, other, { authorType: 'customer', text: 'other connection' });
    await append(fx.b, theirs, { authorType: 'customer', text: 'other workspace' });

    const texts = async (t: TenantFixture, ref: ConnectionRef) =>
      (
        await read(t, (tx) => loadConnectionEvents(tx, ref, { through: 100, maxMessages: 20 }))
      ).events.map((event) => event.text);

    expect(await texts(fx.a, mine)).toEqual(['mine']);
    // The chat of one connection and the thread of another.
    expect(await texts(fx.a, { chatId: mine.chatId, threadId: other.threadId })).toEqual([]);
    // Another workspace's connection, asked for by its exact ids.
    expect(await texts(fx.a, theirs)).toEqual([]);
  });

  it('keeps the opening message of a long conversation, found from the other end of the index', async () => {
    const ref = await seedConnection(fx.a);
    await append(fx.a, ref, { authorType: 'customer', text: 'OPENING Param yatmadı' });
    let last = 0;
    for (let index = 2; index <= 40; index += 1) {
      last = await append(fx.a, ref, {
        authorType: index % 2 === 0 ? 'bot' : 'customer',
        text: `message ${index}`,
      });
    }

    const { events, gapAfter } = await read(fx.a, (tx) =>
      loadConnectionEvents(tx, ref, { through: last, maxMessages: 20 }),
    );
    expect(events).toHaveLength(21);
    expect(events[0]).toMatchObject({ sequence: 1, text: 'OPENING Param yatmadı' });
    expect(events[1]!.sequence).toBe(21);
    expect(gapAfter).toBe(1);

    const context = await read(fx.a, (tx) =>
      loadConnectionContext(tx, ref, emptyTurnState(), {
        through: last,
        processedThrough: last - 1,
      }),
    );
    // The window opens on a visitor message, which joins the opening one past the marker.
    expect(context.messages[0]).toEqual({
      role: 'user',
      content: `OPENING Param yatmadı\n${GAP_MARKER}\nmessage 21`,
    });
    expect(context.messages[1]).toEqual({ role: 'assistant', content: 'message 22' });
    expect(context.omitted).toBe(true);
    expect(context.newCustomerText).toBe('');
  });

  it('pages the window from the (thread_id, event_sequence) index under row level security', async () => {
    const ref = await seedConnection(fx.a);
    // Enough rows that the planner has a real choice to make.
    await owner.$executeRaw`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, recipients)
      SELECT ${ref.threadId} || '_' || g, ${ref.threadId}, ${ref.chatId}, ${fx.a.licenseId},
             'message', 'message ' || g,
             CASE WHEN g % 2 = 0 THEN 'bot' ELSE 'customer' END,
             CASE WHEN g % 10 = 0 THEN 'agents' ELSE 'all' END
      FROM generate_series(1, 2000) g
    `;
    await owner.$executeRaw`UPDATE threads SET event_sequence = 2000 WHERE id = ${ref.threadId}`;
    await owner.$executeRawUnsafe('ANALYZE events');

    const plans: PlanNode[] = [];
    await read(fx.a, async (tx) => {
      // Explains every statement the loader sends, with its own parameters
      // and the transaction's tenant context, then lets it run.
      const explaining = new Proxy(tx, {
        get(target, property, receiver): unknown {
          if (property !== '$queryRaw') return Reflect.get(target, property, receiver);
          return async (statement: Prisma.Sql) => {
            const rows = await target.$queryRaw<Array<Record<string, unknown>>>(
              Prisma.sql`EXPLAIN (FORMAT JSON) ${statement}`,
            );
            const raw = Object.values(rows[0] ?? {})[0];
            const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{
              Plan: PlanNode;
            }>;
            plans.push(parsed[0]!.Plan);
            return target.$queryRaw(statement);
          };
        },
      }) as TenantClient;
      await loadConnectionEvents(explaining, ref, { through: 2000, maxMessages: 20 });
    });

    // The window, then the opening message.
    expect(plans).toHaveLength(2);
    plans.forEach((plan, index) => {
      const nodes = flatten(plan);
      const types = nodes.map((node) => node['Node Type']);
      expect(types).not.toContain('Seq Scan');
      expect(types).not.toContain('Sort');
      const scans = nodes.filter((node) => node['Node Type'] === 'Index Scan');
      expect(scans.length).toBeGreaterThan(0);
      for (const scan of scans) {
        expect(scan['Index Name']).toMatch(/thread_id_event_sequence_idx$/);
        expect(scan['Index Cond']).toMatch(/\(thread_id\)(::text)? = /);
        // The opening message's bound rides into the index rather than
        // filtering what it returns; the window walks back from the newest.
        if (index === 1) expect(scan['Index Cond']).toMatch(/event_sequence [<>]=? /);
      }
    });
  });

  it('reads the answer to an earlier message written after the visitor wrote again, and no later visitor message', async () => {
    const ref = await seedConnection(fx.a);
    await append(fx.a, ref, { authorType: 'customer', text: 'Param yatmadı' });
    const answering = await append(fx.a, ref, { authorType: 'customer', text: 'Papara 13:40' });
    await append(fx.a, ref, { authorType: 'bot', text: ASKED });
    await append(fx.a, ref, { authorType: 'customer', text: 'Hâlâ yok' });

    const context = await read(fx.a, (tx) =>
      loadConnectionContext(tx, ref, emptyTurnState(), {
        through: answering,
        processedThrough: answering - 1,
      }),
    );
    // Not one unanswered "Param yatmadı / Papara 13:40" turn: the first was answered.
    expect(context.messages).toEqual([
      { role: 'user', content: 'Param yatmadı' },
      { role: 'assistant', content: ASKED },
    ]);
    expect(context.newCustomerText).toBe('Papara 13:40');
    expect(JSON.stringify(context)).not.toContain('Hâlâ yok');
  });
});

describe('the live turn reads the conversation (AI-01)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  const model = new FakeLlmProvider({
    reply: (request) =>
      request.messages.length === 1 ? ASKED : 'Kontrol ediyorum, birkaç dakika içinde dönüyorum.',
  });

  const customerAuth = async (): Promise<Record<string, string>> => {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const { token } = response.json() as { token: string };
    return { authorization: `Bearer ${token}` };
  };

  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    return response.json() as { chat_id: string; event: { id: string; thread_id: string } };
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      { LLM_MAX_PROMPT_CHARS: String(MAX_PROMPT_CHARS) },
      { llm: model },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    model.reset();
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
    // A catch-all knowledge answer: every message is a turn that asks the model.
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Deposits',
        kind: 'ai_agent',
        steps: [{ type: 'send_message', source: 'knowledge' }] as object,
        active: true,
        updatedAt: new Date(),
      },
    });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'article',
        name: 'Deposits',
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
      PASSAGE,
      toVectorLiteral(embed(PASSAGE)),
    );
  });

  it('asks the second turn with the three messages before it, in order and role, and no internal note (AI-01)', async () => {
    const headers = await customerAuth();
    const first = await send(headers, 'Param yatmadı');
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.messages).toEqual([{ role: 'user', content: 'Param yatmadı' }]);

    // An agent's internal note between the two turns.
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
    const note = await server.post(
      `/chats/${first.chat_id}/events`,
      { type: 'message', text: NOTE, recipients: 'agents' },
      { authorization: `Bearer ${token}` },
    );
    expect(note.statusCode).toBe(201);

    const second = await send(headers, 'Papara 13:40');
    expect(second.event.thread_id).toBe(first.event.thread_id);

    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.messages).toEqual([
      { role: 'user', content: 'Param yatmadı' },
      { role: 'assistant', content: ASKED },
      { role: 'user', content: 'Papara 13:40' },
    ]);
    expect(JSON.stringify(model.calls)).not.toContain('VIP');
  });

  it('keeps the opening message of a forty-message conversation and fits the prompt ceiling (AI-01)', async () => {
    const headers = await customerAuth();
    const first = await send(headers, 'OPENING Param yatmadı');
    const ref = { chatId: first.chat_id, threadId: first.event.thread_id };
    // Thirty-eight more, written straight into the connection: long enough
    // that the whole conversation would not fit beside the passage.
    for (let index = 0; index < 38; index += 1) {
      const [row] = await owner.$queryRaw<Array<{ event_sequence: number }>>`
        UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${ref.threadId}
        RETURNING event_sequence
      `;
      const sequence = Number(row!.event_sequence);
      await owner.$executeRaw`
        INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, recipients)
        VALUES (${`${ref.threadId}_${sequence}`}, ${ref.threadId}, ${ref.chatId}, ${fx.a.licenseId},
                'message', ${`${index} ${'Papara yatırımı '.repeat(30)}`},
                ${index % 2 === 0 ? 'bot' : 'customer'}, 'all')
      `;
    }
    model.reset();

    await send(headers, 'Papara 13:40');

    expect(model.calls).toHaveLength(1);
    const [request] = model.calls;
    expect(request!.messages[0]!.content.startsWith('OPENING Param yatmadı')).toBe(true);
    expect(request!.messages.at(-1)!.content.endsWith('Papara 13:40')).toBe(true);
    expect(promptLength(request!)).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    const decisions = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'desc' },
      select: { decision: true, errorType: true },
      take: 1,
    });
    expect(decisions).toEqual([{ decision: 'answered', errorType: null }]);
  });
  it('reads as much of the conversation as AI_HISTORY_MAX_MESSAGES and AI_HISTORY_MAX_CHARS allow, the opening message always (tm 292.5)', async () => {
    const small = await startTestServer(
      { AI_HISTORY_MAX_MESSAGES: '4', AI_HISTORY_MAX_CHARS: '800' },
      { llm: model },
    );
    try {
      await clearRateLimits(small.app);
      const minted = await small.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const headers = { authorization: `Bearer ${(minted.json() as { token: string }).token}` };
      const sendSmall = async (text: string) => {
        const response = await small.post('/customer/chat/events', { text }, headers);
        expect(response.statusCode).toBe(201);
        return response.json() as { chat_id: string; event: { id: string; thread_id: string } };
      };
      const first = await sendSmall('OPENING Param yatmadı');
      const ref = { chatId: first.chat_id, threadId: first.event.thread_id };
      for (let index = 0; index < 20; index += 1) {
        const [row] = await owner.$queryRaw<Array<{ event_sequence: number }>>`
          UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${ref.threadId}
          RETURNING event_sequence
        `;
        const sequence = Number(row!.event_sequence);
        await owner.$executeRaw`
          INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, recipients)
          VALUES (${`${ref.threadId}_${sequence}`}, ${ref.threadId}, ${ref.chatId}, ${fx.a.licenseId},
                  'message', ${`MSG-${index} ${'Papara yatırımı '.repeat(10)}`},
                  ${index % 2 === 0 ? 'bot' : 'customer'}, 'all')
        `;
      }
      model.reset();

      await sendSmall('Papara 13:40');

      expect(model.calls).toHaveLength(1);
      const sent = model.calls[0]!.messages.map((message) => message.content).join(' ');
      expect(sent.startsWith('OPENING Param yatmadı')).toBe(true);
      expect(sent.endsWith('Papara 13:40')).toBe(true);
      // The newest of the twenty are in, the earliest are not.
      expect(sent).toContain('MSG-19');
      expect(sent).not.toContain('MSG-1 ');
      expect(sent.match(/MSG-\d+/g)!.length).toBeLessThanOrEqual(4);
    } finally {
      await small.close();
    }
  });
});
