/**
 * A visitor's message is answered after its response (tm 256.10).
 *
 * The rule bot, the AI Agent and the assignee's notice used to run inside
 * `POST /customer/chat/events`, so the visitor's send waited out the model —
 * up to `EMBEDDING_TIMEOUT_MS` + `LLM_TIMEOUT_MS` — with the widget's send
 * button locked. They now run through `app.followUps`. Every test here holds
 * the model (the fake's `hold`) for as long as it needs to, and asks the
 * questions the move must not change the answer to:
 *
 *   - the response arrives while the model is still writing, and the answer
 *     is stored afterwards, as a bot event, the way it always was;
 *   - a replay is not answered a second time, even while the first answer is
 *     still being written;
 *   - one chat's messages are answered one at a time, in the order they came;
 *   - an AI Agent that is switched off still answers nothing;
 *   - a shutdown waits for an answer already on its way.
 *
 * `app.inject` directly wherever the gap matters: the `TestServer` helpers
 * settle the follow-ups before they return (`helpers/server.ts`), which would
 * hide it.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_QUESTION,
  LineSink,
  seedAiWorkspace,
  type AiWorkspace,
} from '../helpers/ai-workspace.js';
import { MAX_FOLLOW_UPS_PER_KEY } from '../../src/services/chat/follow-ups.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/**
 * A second question the seeded passage answers. Not `AI_QUESTION` plus a
 * suffix: the lexical stub's similarity for that falls under the retrieval
 * threshold (0.239 against 0.25), and the model is never asked.
 */
const SECOND_QUESTION = 'Is standard delivery across the EU tracked?';

/** Longer than any of these requests takes; far shorter than a model left waiting. */
const PROMPTLY_MS = 5_000;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A model each of whose calls waits until the test releases it. The reply
 * names the message it answers, so a test can tell whose answer is whose.
 * Calls past `held` are answered at once.
 */
function heldModel(held = Number.POSITIVE_INFINITY) {
  const started: Deferred[] = [];
  const released: Deferred[] = [];
  const at = (list: Deferred[], call: number): Deferred => (list[call] ??= deferred());
  const fake = new FakeLlmProvider({
    reply: (request) => `Answer to: ${request.messages.at(-1)?.content ?? ''}`,
    hold: async (_request, call) => {
      at(started, call).resolve();
      if (call < held) await at(released, call).promise;
    },
  });
  return {
    fake,
    /** Resolves once call `n` (0-based) has reached the model. */
    started: (call: number) => at(started, call).promise,
    release: (call: number) => at(released, call).resolve(),
    reset: () => {
      fake.reset();
      started.length = 0;
      released.length = 0;
    },
  };
}

/** `promise`, or a failure naming `what` if it has not settled within `ms`. */
async function within<T>(promise: Promise<T>, what: string, ms = PROMPTLY_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether `promise` is still pending after `ms` — a close that must be waiting. */
async function stillPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const marker = Symbol('pending');
  const outcome = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise<symbol>((resolve) => setTimeout(() => resolve(marker), ms)),
  ]);
  return outcome === marker;
}

describe('a visitor message is answered after its response (tm 256.10)', () => {
  let owner: PrismaClient;
  const model = heldModel();
  let server: TestServer;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm: model.fake });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(owner);
    await clearRateLimits(server.app);
    model.reset();
  });

  async function visitorToken(app: FastifyInstance, ws: AiWorkspace): Promise<string> {
    const minted = await app.inject({
      method: 'POST',
      url: server.url('/customer/token'),
      headers: { origin: `https://${ws.trustedDomain}` },
      payload: { organization_id: ws.organizationId },
    });
    expect(minted.statusCode).toBe(200);
    return (minted.json() as { token: string }).token;
  }

  /** The send itself — not settled, so the test sees what the visitor sees. */
  function send(
    app: FastifyInstance,
    token: string,
    body: { text: string; idempotency_key?: string },
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'POST',
      url: server.url('/customer/chat/events'),
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
  }

  function eventsOf(chatId: string) {
    return owner.event.findMany({
      where: { chatId, type: 'message' },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true },
    });
  }

  it('answers 201 while the model is still writing, and stores the answer after (NFR-P2)', async () => {
    const ws = await seedAiWorkspace(owner);
    const token = await visitorToken(server.app, ws);

    const sending = send(server.app, token, { text: AI_QUESTION });
    // The answer is under way: the model has the question and is holding it.
    await within(model.started(0), 'the model call');
    const sent = await within(sending, 'the send, with the model still writing');

    expect(sent.statusCode).toBe(201);
    const chatId = (sent.json() as { chat_id: string }).chat_id;
    // The event the response carries is the visitor's own message.
    expect((sent.json() as { event: { text: string } }).event.text).toBe(AI_QUESTION);
    expect(await eventsOf(chatId)).toEqual([{ text: AI_QUESTION, authorType: 'customer' }]);

    model.release(0);
    await within(server.app.followUps.settled(), 'the follow-up');

    expect(await eventsOf(chatId)).toEqual([
      { text: AI_QUESTION, authorType: 'customer' },
      { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
    ]);
    expect(model.fake.calls).toHaveLength(1);
  });

  it('answers a replay once, even while the first answer is still being written', async () => {
    const ws = await seedAiWorkspace(owner);
    const token = await visitorToken(server.app, ws);

    // The message that opens the chat, replayed while its answer is held.
    const first = await within(
      send(server.app, token, { text: AI_QUESTION, idempotency_key: 'k-open' }),
      'the first send',
    );
    expect(first.statusCode).toBe(201);
    const chatId = (first.json() as { chat_id: string }).chat_id;
    await within(model.started(0), 'the first model call');
    const replay = await within(
      send(server.app, token, { text: AI_QUESTION, idempotency_key: 'k-open' }),
      'the replay',
    );
    expect(replay.statusCode).toBe(200);
    model.release(0);
    await within(server.app.followUps.settled(), 'the follow-ups');

    // …and a later message in the same chat, replayed straight after it.
    const second = SECOND_QUESTION;
    const sent = await within(
      send(server.app, token, { text: second, idempotency_key: 'k-second' }),
      'the second send',
    );
    expect(sent.statusCode).toBe(201);
    await within(model.started(1), 'the second model call');
    const again = await within(
      send(server.app, token, { text: second, idempotency_key: 'k-second' }),
      'the second replay',
    );
    expect(again.statusCode).toBe(200);
    model.release(1);
    await within(server.app.followUps.settled(), 'the follow-ups');

    expect(model.fake.calls).toHaveLength(2);
    expect(await eventsOf(chatId)).toEqual([
      { text: AI_QUESTION, authorType: 'customer' },
      { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
      { text: second, authorType: 'customer' },
      { text: `Answer to: ${second}`, authorType: 'bot' },
    ]);
  });

  it("answers one chat's messages one at a time, in the order they came", async () => {
    const ws = await seedAiWorkspace(owner);
    const token = await visitorToken(server.app, ws);
    const second = SECOND_QUESTION;

    const first = await within(send(server.app, token, { text: AI_QUESTION }), 'the first send');
    const chatId = (first.json() as { chat_id: string }).chat_id;
    await within(model.started(0), 'the first model call');

    // The send button is free again: the visitor writes while the first
    // answer is still being written, and is answered 201 at once.
    const next = await within(send(server.app, token, { text: second }), 'the second send');
    expect(next.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The second message's answer has not gone to the model yet.
    expect(model.fake.calls).toHaveLength(1);

    model.release(0);
    await within(model.started(1), 'the second model call');
    // It went once the first answer was stored, not merely produced.
    const atSecondCall = await eventsOf(chatId);
    expect(atSecondCall.filter((event) => event.authorType === 'bot')).toEqual([
      { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
    ]);
    model.release(1);
    await within(server.app.followUps.settled(), 'the follow-ups');

    expect(model.fake.maxInFlight).toBe(1);
    expect(await eventsOf(chatId)).toEqual([
      { text: AI_QUESTION, authorType: 'customer' },
      { text: second, authorType: 'customer' },
      { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
      { text: `Answer to: ${second}`, authorType: 'bot' },
    ]);
  });

  it('answers nothing while the AI Agent is switched off', async () => {
    const ws = await seedAiWorkspace(owner);
    await owner.aiAgent.update({ where: { id: ws.aiAgentId }, data: { active: false } });
    const token = await visitorToken(server.app, ws);

    const sent = await within(send(server.app, token, { text: AI_QUESTION }), 'the send');
    expect(sent.statusCode).toBe(201);
    await within(server.app.followUps.settled(), 'the follow-up');

    const chatId = (sent.json() as { chat_id: string }).chat_id;
    expect(model.fake.calls).toHaveLength(0);
    expect(await eventsOf(chatId)).toEqual([{ text: AI_QUESTION, authorType: 'customer' }]);
  });

  it('leaves a message for a human once its chat is too far behind', async () => {
    // Only the first call is held: it keeps the chat's queue from moving while
    // the rest of the messages pile up behind it.
    const backlog = heldModel(1);
    const sink = new LineSink();
    const busy = await startTestServer(
      { LOG_LEVEL: 'warn' },
      { llm: backlog.fake, logStream: sink as unknown as NodeJS.WritableStream },
    );
    try {
      const ws = await seedAiWorkspace(owner);
      await clearRateLimits(busy.app);
      const token = await visitorToken(busy.app, ws);

      const first = await within(send(busy.app, token, { text: AI_QUESTION }), 'the first send');
      const chatId = (first.json() as { chat_id: string }).chat_id;
      await within(backlog.started(0), 'the first model call');

      // The running answer counts towards the bound, so the chat holds
      // MAX_FOLLOW_UPS_PER_KEY - 1 more, and the message after them is refused.
      for (let i = 1; i <= MAX_FOLLOW_UPS_PER_KEY; i += 1) {
        const sent = await within(
          send(busy.app, token, { text: `${SECOND_QUESTION} #${i}` }),
          `send ${i}`,
        );
        // Refused or not, the message itself is stored and the visitor told so.
        expect(sent.statusCode).toBe(201);
      }
      const refusals = sink.withMessage(
        'visitor follow-ups backed up; leaving this message for a human',
      );
      expect(refusals).toHaveLength(1);
      expect(refusals[0]).toMatchObject({ chat_id: chatId, pending: MAX_FOLLOW_UPS_PER_KEY });

      backlog.release(0);
      await within(busy.app.followUps.settled(), 'the backlog');

      const events = await eventsOf(chatId);
      expect(events.filter((event) => event.authorType === 'customer')).toHaveLength(
        MAX_FOLLOW_UPS_PER_KEY + 1,
      );
      const answers = events.filter((event) => event.authorType === 'bot').map((e) => e.text);
      expect(answers).toHaveLength(MAX_FOLLOW_UPS_PER_KEY);
      // The last message is the one nobody answered.
      expect(answers).not.toContain(`Answer to: ${SECOND_QUESTION} #${MAX_FOLLOW_UPS_PER_KEY}`);
      expect(answers.at(-1)).toBe(`Answer to: ${SECOND_QUESTION} #${MAX_FOLLOW_UPS_PER_KEY - 1}`);
    } finally {
      backlog.release(0);
      await busy.close();
    }
  });

  it('waits on close for an answer already on its way, and stores it', async () => {
    const closing = heldModel();
    const doomed = await startTestServer({}, { llm: closing.fake });
    let closed = false;
    try {
      const ws = await seedAiWorkspace(owner);
      await clearRateLimits(doomed.app);
      const token = await visitorToken(doomed.app, ws);

      const sent = await within(send(doomed.app, token, { text: AI_QUESTION }), 'the send');
      expect(sent.statusCode).toBe(201);
      const chatId = (sent.json() as { chat_id: string }).chat_id;
      await within(closing.started(0), 'the model call');

      const close = doomed.app.close().then(() => {
        closed = true;
      });
      // The close is waiting on the answer, not cutting it off.
      expect(await stillPending(close, 300)).toBe(true);
      expect(await eventsOf(chatId)).toEqual([{ text: AI_QUESTION, authorType: 'customer' }]);

      closing.release(0);
      await within(close, 'the close');

      expect(await eventsOf(chatId)).toEqual([
        { text: AI_QUESTION, authorType: 'customer' },
        { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
      ]);
    } finally {
      // Whatever failed above, nothing is left holding the server open.
      closing.release(0);
      if (!closed) await doomed.close().catch(() => undefined);
    }
  });
});
