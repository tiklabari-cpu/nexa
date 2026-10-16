/**
 * Every log line says whose request it is and which conversation it is about
 * (ID-08 · tm 288.1 · NFR-M5).
 *
 * Read off the lines the server actually wrote, through `logStream`: a helper
 * that exists proves nothing about the line an operator greps for. The suite
 * drives the path the requirement names — a widget message, the AI's turn on
 * it — and asks of each line what `plugins/log-context.ts` promises: licence,
 * workspace, actor and request id once the caller is authenticated, and the
 * day's chat (`chat_id`, the panel's "Thread ID"), the connection
 * (`thread_id`, its "Chat ID") and the member once the route knows them. Plus
 * the two things the module exists to avoid: a camelCase twin, and a key
 * written twice because a child was stacked on a child.
 *
 * "Incoming request" is the one line that cannot carry the workspace: Fastify
 * writes it on arrival, before authentication has read the token. It carries
 * `request_id`, which is what ties it to the rest.
 */
import { embed } from '@siyahtus/ai-mock';
import { LOG_KEY_LIST } from '@siyahtus/types';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embeddingSpace } from '../../src/services/ai/provider/embedding-provider.js';
import { AI_QUESTION, LineSink, seedAiWorkspace } from '../helpers/ai-workspace.js';
import {
  fakeOpenAiFetch,
  openAiEmbeddings,
  openAiProblem,
  type FakeOpenAiFetch,
} from '../helpers/fake-openai.js';
import { grantToken, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const AI_ENV = {
  LOG_LEVEL: 'info',
  LLM_PROVIDER: 'openai',
  LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
  LLM_MODEL: 'test-model',
  LLM_API_KEY: 'sk-proj-test-only-llm-log-context-0001',
  EMBEDDING_PROVIDER: 'openai',
  EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_API_KEY: 'sk-proj-test-only-emb-log-context-0001',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CAMEL_TWINS = [
  'licenseId',
  'organizationId',
  'requestId',
  'reqId',
  'actorType',
  'actorId',
  'chatId',
  'threadId',
  'customerId',
];

/** Each top-level key of a raw JSON line, as many times as it was written. */
function keyCounts(raw: string): Map<string, number> {
  const counts = new Map<string, number>();
  // Top-level keys only: depth-1 `"key":` tokens. pino writes no whitespace.
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') {
        inString = false;
        if (depth === 1 && raw[i + 1] === ':') {
          const key = raw.slice(start + 1, i);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    } else if (c === '"') {
      inString = true;
      start = i;
    } else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') depth -= 1;
  }
  return counts;
}

function linesFor(sink: LineSink, requestId: string) {
  return sink.lines
    .map((raw) => ({ raw, entry: JSON.parse(raw) as Record<string, unknown> }))
    .filter(({ entry }) => entry['request_id'] === requestId);
}

describe('log context on every line (ID-08 · NFR-M5)', () => {
  let owner: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(owner);
  });

  async function boot(
    env: Partial<NodeJS.ProcessEnv>,
    nets?: { llm: FakeOpenAiFetch; embeddings: FakeOpenAiFetch },
  ): Promise<{ server: TestServer; sink: LineSink }> {
    const sink = new LineSink();
    const server = await startTestServer(env, {
      logStream: sink as unknown as NodeJS.WritableStream,
      ...(nets ? { llmFetch: nets.llm.impl, embeddingFetch: nets.embeddings.impl } : {}),
    });
    await clearRateLimits(server.app);
    return { server, sink };
  }

  it('a widget message and the AI turn it sets off: every line names the workspace, the member, the chat and the connection (NFR-M5)', async () => {
    // The model refuses, so the AI path writes its own line through the
    // request's logger — the line an operator reads to learn why a visitor
    // got a human instead of an answer.
    const llm = fakeOpenAiFetch(openAiProblem(401, 'invalid_api_key'));
    const embeddings = fakeOpenAiFetch(openAiEmbeddings((text) => embed(text)));
    const { server, sink } = await boot(AI_ENV, { llm, embeddings });
    try {
      const ws = await seedAiWorkspace(owner, {
        embeddingSpace: embeddingSpace('openai', 'text-embedding-3-small'),
      });
      const minted = await server.post(
        '/customer/token',
        { organization_id: ws.organizationId },
        { origin: `https://${ws.trustedDomain}` },
      );
      expect(minted.statusCode).toBe(200);
      const { token, customer_id: customerId } = minted.json() as {
        token: string;
        customer_id: string;
      };

      const sent = await server.post(
        '/customer/chat/events',
        { text: AI_QUESTION },
        { authorization: `Bearer ${token}` },
      );
      expect(sent.statusCode).toBe(201);
      const body = sent.json() as { chat_id: string; event: { thread_id: string } };
      const requestId = sent.headers['x-request-id'] as string;
      expect(llm.calls).toHaveLength(1);

      const expected = {
        license_id: ws.licenseId.toString(),
        organization_id: ws.organizationId,
        actor_type: 'customer',
        actor_id: customerId,
        customer_id: customerId,
        chat_id: body.chat_id,
        thread_id: body.event.thread_id,
      };

      const lines = linesFor(sink, requestId);
      const aiLine = lines.find(
        ({ entry }) =>
          entry['msg'] === 'ai model could not answer; the conversation stays with a human',
      );
      expect(aiLine?.entry).toMatchObject({ ...expected, request_id: requestId, provider: 'llm' });

      const completed = lines.find(({ entry }) => entry['msg'] === 'request completed');
      expect(completed?.entry).toMatchObject({ ...expected, request_id: requestId });

      // Every line of this request after its arrival — not only the two above.
      const afterArrival = lines.filter(({ entry }) => entry['msg'] !== 'incoming request');
      expect(afterArrival.length).toBeGreaterThanOrEqual(2);
      for (const { entry, raw } of afterArrival) {
        expect(entry).toMatchObject(expected);
        const counts = keyCounts(raw);
        for (const key of [...LOG_KEY_LIST]) expect(counts.get(key) ?? 0).toBeLessThanOrEqual(1);
        for (const twin of CAMEL_TWINS) expect(counts.has(twin)).toBe(false);
      }
      // The arrival line still correlates by the id.
      expect(lines.some(({ entry }) => entry['msg'] === 'incoming request')).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("binds an agent route's chat param and the agent's identity, once each (NFR-M5)", async () => {
    const fixtures = await seedFixtures(owner);
    const { server, sink } = await boot({ LOG_LEVEL: 'info' });
    try {
      const token = await grantToken(owner, {
        licenseId: fixtures.a.licenseId,
        organizationId: fixtures.a.organizationId,
        ownerId: fixtures.a.agentAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.get('/chats/TJ1H8CFKRV', {
        authorization: `Bearer ${token}`,
      });
      expect(response.statusCode).toBe(404);
      const requestId = response.headers['x-request-id'] as string;

      const lines = linesFor(sink, requestId).filter(
        ({ entry }) => entry['msg'] !== 'incoming request',
      );
      expect(lines.length).toBeGreaterThanOrEqual(2); // the 404's own line + completion
      for (const { entry, raw } of lines) {
        expect(entry).toMatchObject({
          license_id: fixtures.a.licenseId.toString(),
          organization_id: fixtures.a.organizationId,
          actor_type: 'agent',
          actor_id: fixtures.a.agentAccountId,
          chat_id: 'TJ1H8CFKRV',
        });
        expect(entry).not.toHaveProperty('customer_id');
        expect(keyCounts(raw).get('request_id')).toBe(1);
      }
    } finally {
      await server.close();
    }
  });

  it('keeps a well-formed X-Request-Id and replaces anything else with a fresh UUID (NFR-M5)', async () => {
    const { server, sink } = await boot({ LOG_LEVEL: 'info' });
    try {
      const kept = await server.get('/health', { 'x-request-id': 'trace.ID_0042-abc' });
      expect(kept.headers['x-request-id']).toBe('trace.ID_0042-abc');

      for (const bad of [
        'abc1234',
        'x'.repeat(65),
        'has spaces in it',
        '{"level":60,"msg":"forged"}',
        'ümlaut-id-12345',
      ]) {
        const response = await server.get('/health', { 'x-request-id': bad });
        const id = response.headers['x-request-id'] as string;
        expect(id).not.toBe(bad);
        expect(id).toMatch(UUID_RE);
        // The line is filed under the replacement, and the bad value is nowhere.
        expect(linesFor(sink, id).some(({ entry }) => entry['msg'] === 'request completed')).toBe(
          true,
        );
        expect(sink.text).not.toContain(bad);
      }
    } finally {
      await server.close();
    }
  });
});
