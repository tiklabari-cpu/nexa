/**
 * Card masking at write time (FR-MOD-08.9.5 · NFR-C5/S9 · PCI SAQ A).
 *
 * The unit tests pin the detector; this suite pins the *boundary* — that a raw
 * PAN a visitor or agent types never comes to rest anywhere it could be read
 * back: `events.text`, a ticket subject, a rating comment, a contact custom
 * field, the transcript e-mail spool, or an audit row. It is proven end to end
 * through the real routes and read back straight from Postgres and the mail
 * spool, because "masked in the response" would pass even if the database still
 * held the raw number.
 *
 * The negative — a Luhn-invalid order number is left intact — is here too: a
 * privacy control that also destroyed order numbers would be its own incident.
 */
import { PrismaClient } from '@prisma/client';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SENSITIVE_WARNING_TEXTS } from '@siyahtus/types';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { AI_PASSAGE, AI_QUESTION, LineSink, seedAiWorkspace } from '../helpers/ai-workspace.js';
import { FAKE_LLM_REPLY, FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PAN = '4111111111111111';
const PAN_SPACED = '4111 1111 1111 1111';
const MASKED = '**** **** **** 1111';
/** 16 digits, but not a card — must survive untouched (the false-positive line). */
const ORDER_NO = '1234567890123456';
const DOMAIN = 'inbound.siyahtus.localhost';

describe('card masking at write time (FR-MOD-08.9.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let mailDir: string;
  let adminToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  // Routing so a first widget message is assigned to the tenant's agent — the
  // same fallback rule the customer-chat suite uses, extracted so both A and B
  // can send.
  async function setupRouting(t: TenantFixture): Promise<void> {
    const group = await owner.group.create({
      data: { licenseId: t.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: t.licenseId,
        groupId: group.id,
        agentId: t.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: { licenseId: t.licenseId, kind: 'chat', isFallback: true, targetGroupId: group.id },
    });
  }

  async function widgetToken(t: TenantFixture): Promise<{ token: string; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; customer_id: string };
    return { token: body.token, customerId: body.customer_id };
  }

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-ccmask-'));
    // A real FileMailer so the transcript side-channel can be read back from the
    // spool; the default test mailer is a NullMailer that keeps nothing.
    server = await startTestServer({}, { mailer: new FileMailer(mailDir) });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await setupRouting(fx.a);
    await setupRouting(fx.b);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'customers:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'chats--all:ro'],
    });
  });

  /** The raw PAN must appear in no event's text, for the whole licence. */
  async function rawPanEventCount(licenseId: bigint): Promise<number> {
    return owner.event.count({ where: { licenseId, text: { contains: PAN } } });
  }

  // --- The message write paths ---------------------------------------------

  it('masks a card in a widget message before it reaches the database', async () => {
    const { token } = await widgetToken(fx.a);

    const response = await server.post(
      '/customer/chat/events',
      { text: `please charge ${PAN_SPACED}` },
      auth(token),
    );
    expect(response.statusCode).toBe(201);

    // The value the widget/agent sees over the wire is already masked…
    expect(response.json().event.text).toBe(`please charge ${MASKED}`);

    // …and, the point of the requirement, so is the row in Postgres.
    const chatId = response.json().chat_id as string;
    const event = await owner.event.findFirstOrThrow({
      where: { chatId, type: 'message' },
      select: { text: true },
    });
    expect(event.text).toBe(`please charge ${MASKED}`);
    expect(await rawPanEventCount(fx.a.licenseId)).toBe(0);
  });

  it('masks a card in an agent message', async () => {
    const { token: customer } = await widgetToken(fx.a);
    const opened = await server.post('/customer/chat/events', { text: 'hello' }, auth(customer));
    const chatId = opened.json().chat_id as string;

    const response = await server.post(
      `/chats/${chatId}/events`,
      { text: `card on file: ${PAN}` },
      auth(agentToken),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().text).toBe(`card on file: ${MASKED}`);
    expect(await rawPanEventCount(fx.a.licenseId)).toBe(0);
  });

  it('leaves a Luhn-invalid order number in a message untouched', async () => {
    const { token } = await widgetToken(fx.a);

    const response = await server.post(
      '/customer/chat/events',
      { text: `order ${ORDER_NO} shipped` },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    // Not a card → stored verbatim. The Luhn boundary holds through the route.
    expect(response.json().event.text).toBe(`order ${ORDER_NO} shipped`);
  });

  it('applies in any tenant, not just the first (cross-tenant)', async () => {
    const { token } = await widgetToken(fx.b);
    const response = await server.post(
      '/customer/chat/events',
      { text: `pay with ${PAN}` },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().event.text).toBe(`pay with ${MASKED}`);
    expect(await rawPanEventCount(fx.b.licenseId)).toBe(0);
  });

  // --- The adjacent free-text write paths ----------------------------------

  it('masks a card in a pre-chat custom field', async () => {
    const field = await server.post(
      '/settings/custom-fields',
      { entity: 'contact', label: 'Card', type: 'text' },
      auth(adminToken),
    );
    expect(field.statusCode).toBe(201);
    const fieldId = field.json().id as string;

    const { token, customerId } = await widgetToken(fx.a);
    const send = await server.post(
      '/customer/chat/events',
      { text: 'hi', custom_fields: { [fieldId]: PAN } },
      auth(token),
    );
    expect(send.statusCode).toBe(201);

    const detail = await server.get(`/customers/${customerId}`, auth(adminToken));
    const stored = (
      detail.json().custom_fields as Array<{ definition_id: string; value: string }>
    ).find((f) => f.definition_id === fieldId);
    expect(stored?.value).toBe(MASKED);
    // And nothing raw in the values table.
    expect(await owner.customFieldValue.count({ where: { value: { contains: PAN } } })).toBe(0);
  });

  it('masks a card in a rating comment', async () => {
    const { token } = await widgetToken(fx.a);
    await server.post('/customer/chat/events', { text: 'thanks' }, auth(token));

    const rated = await server.post(
      '/customer/chat/rating',
      { value: 'good', comment: `you can keep ${PAN}` },
      auth(token),
    );
    expect(rated.statusCode).toBe(201);

    const rating = await owner.rating.findFirstOrThrow({ select: { comment: true } });
    expect(rating.comment).toBe(`you can keep ${MASKED}`);
    expect(await owner.rating.count({ where: { comment: { contains: PAN } } })).toBe(0);
  });

  it('masks a card in an inbound email subject', async () => {
    const response = await server.post('/channels/email/inbound', {
      to: `${fx.a.organizationId}@${DOMAIN}`,
      from: 'buyer@shopper.example',
      subject: `refund my card ${PAN}`,
      text: 'see subject',
    });
    expect(response.statusCode).toBe(200);
    const ticketId = response.json().ticket_id as string;

    const ticket = await owner.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { subject: true },
    });
    expect(ticket.subject).toBe(`refund my card ${MASKED}`);
    expect(await owner.ticket.count({ where: { subject: { contains: PAN } } })).toBe(0);
  });

  // The fifth inbound path — a provider webhook on a connected channel — is
  // masked in `ChannelService.ingestInbound` and asserted in
  // `channels-adapters.test.ts`, parametrically over all five adapters (the
  // event *and* the `channel_messages` log, which persists the text a second
  // time). It is named here because this file is the enumeration of write
  // paths, and that path was missing from it for as long as it was missing from
  // the code.

  // --- The side channels ----------------------------------------------------

  it('never writes a raw card to the transcript e-mail (agent-archive path)', async () => {
    // An e-mail on the customer means the visitor copy of the transcript sends,
    // rendered from the stored (already masked) events.
    const { token } = await widgetToken(fx.a);
    const opened = await server.post(
      '/customer/chat/events',
      { text: `my card is ${PAN}`, email: 'buyer@example.test' },
      auth(token),
    );
    const chatId = opened.json().chat_id as string;

    // The agent archive path is the one wired with the mailer.
    const archived = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(agentToken));
    expect(archived.statusCode).toBe(200);
    // The transcript is handed to `backgroundMail` after the answer (tm 256.4).
    await server.app.backgroundMail.settled();

    const names = await readdir(mailDir);
    const spool = (await Promise.all(names.map((n) => readFile(join(mailDir, n), 'utf8')))).join(
      '\n',
    );
    // The transcript carries the conversation — masked — and no copy anywhere in
    // the spool carries the raw number.
    expect(spool).not.toContain(PAN);
    expect(spool).toContain(MASKED);
  });

  it('leaves no raw card in the audit log after a card passes through', async () => {
    const { token } = await widgetToken(fx.a);
    await server.post('/customer/chat/events', { text: `charge ${PAN}` }, auth(token));

    const rows = await owner.auditLogEntry.findMany({ select: { metadata: true } });
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(PAN);
  });

  // --- The read paths (MCP summarize_chat, FR-MOD-08.8.3-f) ------------------

  it('masks a card in the summarize_chat tool response (read-path defence)', async () => {
    // Seed a chat whose transcript holds a RAW PAN straight in the database,
    // bypassing the write-time mask — the case the read-path mask exists for. A
    // tool that dumps transcript text to an LLM client must re-mask, so a PAN
    // that reached the DB by any path never leaves through the tool response.
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'CC read-path visitor' },
      select: { id: true },
    });
    const chatId = 'cc-sum-chat';
    const threadId = 'cc-sum-thr';
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: fx.a.licenseId, active: true },
    });
    await owner.event.create({
      data: {
        id: `${threadId}_10`,
        threadId,
        chatId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text: `my card is ${PAN}`,
        authorType: 'customer',
        recipients: 'all',
      },
    });

    // agentToken carries chats--all:ro, the scope summarize_chat requires.
    const res = await server.post(
      '/mcp/tools/summarize_chat',
      { arguments: { chat_id: chatId } },
      auth(agentToken),
    );
    expect(res.statusCode).toBe(200);

    const summary = (res.json() as { result: { summary: string } }).result.summary;
    expect(summary).toContain(MASKED);
    expect(summary).not.toContain(PAN);
    // Nowhere in the whole response envelope, not just the parsed field.
    expect(res.payload).not.toContain(PAN);
  });
});

/**
 * tm 300.2 · AI-26 — every sensitive type, on every write path.
 *
 * The block above pins the card; this one pins the rest of the catalogue the
 * same way — read back from Postgres, the log stream and the model's request
 * body, never from the response alone — and the two things a card never had:
 * the warning the player is shown, and the author policy that keeps an IBAN
 * an agent sends whole.
 */
describe('sensitive data masked on every write path (FR-MOD-08.9.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  const sink = new LineSink();
  /** What the model writes; a test sets it before the visitor asks. */
  let modelReply = FAKE_LLM_REPLY;
  const model = new FakeLlmProvider({ reply: () => modelReply });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const PASSWORD = 'Ali1234!';
  const OTP = '482913';
  const IBAN = 'TR33 0006 1005 1978 6457 8413 26';
  const IBAN_MIDDLE = '0006 1005 1978 6457 84';
  const SEED =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const SECRETS = [PASSWORD, OTP, IBAN_MIDDLE, SEED];

  async function visitor(
    t: { organizationId: string; trustedDomain: string } = fx.a,
  ): Promise<string> {
    const minted = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    return (minted.json() as { token: string }).token;
  }

  async function say(token: string, body: Record<string, unknown>) {
    const sent = await server.post('/customer/chat/events', body, auth(token));
    expect(sent.statusCode).toBeLessThan(300);
    return sent.json() as { chat_id: string; event: { id: string; text: string } };
  }

  function stored(chatId: string) {
    return owner.event.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, text: true, authorType: true, recipients: true, properties: true },
    });
  }

  async function warnings(chatId: string) {
    return (await stored(chatId)).filter(
      (e) =>
        e.type === 'system_message' &&
        (e.properties as Record<string, unknown>)['system_event'] === 'sensitive_data_warning',
    );
  }

  /** No raw secret anywhere in the licence's events. */
  async function rawEvents(licenseId: bigint): Promise<number> {
    let count = 0;
    for (const secret of SECRETS) {
      count += await owner.event.count({ where: { licenseId, text: { contains: secret } } });
    }
    return count;
  }

  beforeAll(async () => {
    owner = ownerClient();
    // Every line the server writes, down to debug: "not in the log" has to
    // mean not at any level an operator could turn on.
    server = await startTestServer(
      { LOG_LEVEL: 'debug' },
      { llm: model, logStream: sink as unknown as NodeJS.WritableStream },
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
    modelReply = FAKE_LLM_REPLY;
    sink.lines.length = 0;
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'chats--all:ro'],
    });
  });

  it('masks a password, an SMS code and an IBAN in a widget message and records what it hid', async () => {
    const token = await visitor();
    const sent = await say(token, {
      text: `Şifrem ${PASSWORD} SMS kodu ${OTP} IBAN ${IBAN}`,
    });
    expect(sent.event.text).toContain('Şifrem ********');
    expect(sent.event.text).toContain('SMS kodu ********');
    expect(sent.event.text).toMatch(/IBAN TR\*\* .*13 26$/);

    const [message] = await stored(sent.chat_id);
    expect(message!.text).toBe(sent.event.text);
    expect(message!.properties).toMatchObject({ sensitive_types: ['otp', 'password', 'iban'] });
    expect(await rawEvents(fx.a.licenseId)).toBe(0);
  });

  it('masks a 12-word seed phrase and leaves an ordinary Turkish sentence alone', async () => {
    const token = await visitor();
    const sent = await say(token, { text: `cüzdan kelimelerim ${SEED}` });
    expect(sent.event.text).not.toContain('abandon');
    const plain = 'Param yatmadı, iki saattir bekliyorum, lütfen yardım edin';
    const second = await say(token, { text: plain });
    expect(second.event.text).toBe(plain);
    const events = await stored(sent.chat_id);
    expect(events.at(-1)!.properties).not.toHaveProperty('sensitive_types');
  });

  it('leaves a reference, an amount, a phone number and a TXID exactly as typed, with no warning', async () => {
    const token = await visitor();
    const txid = 'ab'.repeat(32);
    const text = `İşlem no PPR-20261014-482913, 2.500 TL yatırdım, tel 05321234567, TXID ${txid}`;
    const sent = await say(token, { text });
    expect(sent.event.text).toBe(text);
    const events = await stored(sent.chat_id);
    expect(events.map((e) => e.text)).toEqual([text]);
    expect(events[0]!.properties).not.toHaveProperty('sensitive_types');
  });

  it("warns the player once per chat per type, in the player's language", async () => {
    const token = await visitor();
    const first = await say(token, { text: `my password: ${PASSWORD}`, locale: 'en' });
    let warned = await warnings(first.chat_id);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({
      text: SENSITIVE_WARNING_TEXTS.en,
      authorType: 'system',
      recipients: 'all',
      properties: { system_event: 'sensitive_data_warning', sensitive_types: ['password'] },
    });

    // The same kind again: no second warning. A new kind: one more, for it alone.
    await say(token, { text: `password: ${PASSWORD}` });
    expect(await warnings(first.chat_id)).toHaveLength(1);
    await say(token, { text: `SMS kodu ${OTP}` });
    warned = await warnings(first.chat_id);
    expect(warned).toHaveLength(2);
    expect(warned[1]!.properties).toMatchObject({ sensitive_types: ['otp'] });

    // An IBAN is masked but not warned about — sharing your own is how a
    // withdrawal is matched.
    await say(token, { text: `IBAN ${IBAN}` });
    expect(await warnings(first.chat_id)).toHaveLength(2);

    // The widget reads the warning like any other line addressed to the player.
    const widget = await server.get('/customer/chat', auth(token));
    const texts = (widget.json() as { events: Array<{ text: string | null }> }).events.map(
      (e) => e.text,
    );
    expect(texts.filter((t) => t === SENSITIVE_WARNING_TEXTS.en)).toHaveLength(2);
  });

  it('warns in Turkish when the player gave no language', async () => {
    const token = await visitor();
    const sent = await say(token, { text: `Şifrem ${PASSWORD}` });
    const [warning] = await warnings(sent.chat_id);
    expect(warning!.text).toBe(SENSITIVE_WARNING_TEXTS.tr);
  });

  it("shows the player an agent's IBAN whole and masks the agent's code (AI-26-S2)", async () => {
    const token = await visitor();
    const opened = await say(token, { text: 'Yatırım yapacağım, IBAN alabilir miyim?' });
    const sent = await server.post(
      `/chats/${opened.chat_id}/events`,
      { text: `IBAN: ${IBAN} · doğrulama kodu ${OTP}` },
      auth(agentToken),
    );
    expect(sent.statusCode).toBe(201);
    expect(sent.json().text).toBe(`IBAN: ${IBAN} · doğrulama kodu ********`);

    const widget = await server.get('/customer/chat', auth(token));
    const agentLine = (
      widget.json() as { events: Array<{ author_type: string; text: string | null }> }
    ).events.find((e) => e.author_type === 'agent');
    expect(agentLine!.text).toContain(IBAN);
    // A staff message warns nobody: the warning is the player's.
    expect(await warnings(opened.chat_id)).toHaveLength(0);
  });

  it('masks a correction under the agent policy and keeps the badge honest', async () => {
    const token = await visitor();
    const opened = await say(token, { text: 'merhaba' });
    const sent = await server.post(
      `/chats/${opened.chat_id}/events`,
      { text: 'Hoş geldiniz' },
      auth(agentToken),
    );
    const edited = await server.put(
      `/chats/${opened.chat_id}/events/${sent.json().id as string}`,
      { text: `şifreniz: ${PASSWORD}` },
      auth(agentToken),
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json().text).toBe('şifreniz: ********');
    expect(edited.json().properties).toMatchObject({ sensitive_types: ['password'] });
  });

  it('refuses a badge a client stamps on its own message', async () => {
    const token = await visitor();
    const opened = await say(token, { text: 'merhaba' });
    const sent = await server.post(
      `/chats/${opened.chat_id}/events`,
      {
        text: 'Nasıl yardımcı olabilirim?',
        properties: { sensitive_types: ['card'], tone: 'warm' },
      },
      auth(agentToken),
    );
    expect(sent.statusCode).toBe(201);
    expect(sent.json().properties).toEqual({ tone: 'warm' });
  });

  it('masks every type in a rating comment and an inbound e-mail subject too', async () => {
    const token = await visitor();
    await say(token, { text: 'teşekkürler' });
    const rated = await server.post(
      '/customer/chat/rating',
      { value: 'good', comment: `Şifrem ${PASSWORD} idi` },
      auth(token),
    );
    expect(rated.statusCode).toBe(201);
    expect(await owner.rating.count({ where: { comment: { contains: PASSWORD } } })).toBe(0);

    const mail = await server.post('/channels/email/inbound', {
      to: `${fx.a.organizationId}@${DOMAIN}`,
      from: 'buyer@shopper.example',
      subject: `SMS kodu ${OTP} geldi`,
      text: 'see subject',
    });
    expect(mail.statusCode).toBe(200);
    expect(await owner.ticket.count({ where: { subject: { contains: OTP } } })).toBe(0);
  });

  it('keeps every raw value out of the log, the AI records and the model request', async () => {
    // The passage shares the message's words, so the lexical stub retrieves it
    // and the model is asked to write the answer (AI_QUESTION alone is
    // load-bearing: anything appended to it can drop under the threshold).
    const ws = await seedAiWorkspace(owner, { passage: `${AI_PASSAGE} Şifrem SMS kodu IBAN TR` });
    const token = await visitor(ws);
    const sent = await say(token, {
      text: `${AI_QUESTION} Şifrem ${PASSWORD}, SMS kodu ${OTP}, IBAN ${IBAN}`,
    });

    // The model was asked — and never saw a secret, in any call.
    const requests = [...model.understandCalls, ...model.calls];
    expect(requests.length).toBeGreaterThan(0);
    const body = JSON.stringify(requests);
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain('********');

    // Nor did any AI table keep one.
    const rows = await Promise.all([
      owner.aiDecisionLog.findMany({ where: { licenseId: ws.licenseId } }),
      owner.aiConversation.findMany({ where: { licenseId: ws.licenseId } }),
      owner.aiJob.findMany({ where: { licenseId: ws.licenseId } }),
      owner.skillRun.findMany({ where: { chatId: sent.chat_id } }),
    ]);
    const records = JSON.stringify(rows, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const secret of SECRETS) expect(records).not.toContain(secret);

    // Nor did the log.
    expect(sink.lines.length).toBeGreaterThan(0);
    for (const secret of SECRETS) expect(sink.text).not.toContain(secret);
    expect(await rawEvents(ws.licenseId)).toBe(0);
  });

  it("masks the AI's own reply before it is sent, and tells the AI a code was shared", async () => {
    // A model that echoes a code back — the reply is masked under the bot's
    // policy on its way to the player, whatever the model wrote.
    modelReply = `Lütfen doğrulama kodunuzu (${OTP}) kimseyle paylaşmayın.`;
    const ws = await seedAiWorkspace(owner, { passage: `${AI_PASSAGE} Şifrem SMS kodu IBAN TR` });
    const token = await visitor(ws);
    const sent = await say(token, { text: `${AI_QUESTION} SMS kodu ${OTP}` });

    const bot = (await stored(sent.chat_id)).find((e) => e.authorType === 'bot');
    expect(bot?.text).toBe('Lütfen doğrulama kodunuzu (********) kimseyle paylaşmayın.');
    expect(bot!.properties).toMatchObject({ sensitive_types: ['otp'] });

    // The turn was told (AI-26 §5 → AI-08), and its record says so (AI-24).
    expect(JSON.stringify(model.calls)).toContain('sensitive_shared');
    const [decision] = await owner.aiDecisionLog.findMany({ where: { chatId: sent.chat_id } });
    expect(decision?.riskFlags).toContain('sensitive_shared');
  });
});
