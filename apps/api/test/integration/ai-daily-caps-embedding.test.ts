/**
 * The daily AI caps on the embedding meter (tm 257.20 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(3)) — every path that turns text
 * into vectors, through the real server and the real OpenAI embedding adapter
 * over a `fetch` recorder, with the caps shrunk through the environment.
 *
 *   1. The panel's indexing routes — a source, a file, an edit, a reindex,
 *      Copilot's own source — count what the provider billed under the cap and
 *      answer 429 `ai_daily_cap` (never the 503 a provider failure gets) at it,
 *      with no provider call and nothing written. An unknown AI agent is a 400
 *      that costs nothing: the agent is checked before the text is embedded.
 *   2. The bulk import reserves the whole file before its first row: a file
 *      the day cannot afford is one 429, a dry run is free, a file that fits
 *      settles to what its rows cost, and a crawled row that does not fit is
 *      skipped with the reason.
 *   3. A Copilot draft at the cap is empty and says why (`reason`).
 *   4. The freshness sweep defers a refresh the cap refuses: the text stays,
 *      the reason is recorded, the next attempt is the next UTC midnight.
 *   5. `knowledge:reembed` spends no workspace's allowance — only the
 *      deployment's, and stops when that is used up.
 *   6. `knowledge-refresh:run`, a separate process, counts on the same rows.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { chunk, embed, LEXICAL_EMBEDDING_SPACE } from '@siyahtus/ai-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantClient, TenantContext } from '../../src/lib/tenant.js';
import {
  AiDailyBudget,
  aiDailyCaps,
  nextUtcMidnight,
  secondsUntilUtcMidnight,
  utcDayKey,
} from '../../src/services/ai/ai-daily-budget.js';
import type { InferenceProvider } from '../../src/services/ai/inference.js';
import { KnowledgeReembedder } from '../../src/services/ai/knowledge-reembed.js';
import {
  KnowledgeRefreshSweeper,
  REFRESH_DEFERRED_AI_CAP,
} from '../../src/services/ai/knowledge-refresh-sweep.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MeteredEmbeddings } from '../../src/services/ai/metered-embeddings.js';
import { embeddingSpace } from '../../src/services/ai/provider/embedding-provider.js';
import { MockEmbeddingProvider } from '../../src/services/ai/provider/mock-embedding-provider.js';
import { OpenAiEmbeddingProvider } from '../../src/services/ai/provider/openai-embedding-provider.js';
import { LineSink } from '../helpers/ai-workspace.js';
import { fakeOpenAiFetch, openAiEmbeddings } from '../helpers/fake-openai.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The workspace and deployment embedding caps this suite runs under. */
const CAP = 2_000;
const GLOBAL_CAP = 20_000;
/** What `openAiEmbeddings` bills: 7 tokens an input. */
const PER_INPUT = 7;

const EMBEDDING_ENV = {
  EMBEDDING_PROVIDER: 'openai',
  EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_API_KEY: 'sk-test-only-embedding-label',
};
const CAPS_ENV = {
  AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE: String(CAP),
  AI_DAILY_EMBEDDING_TOKENS_GLOBAL: String(GLOBAL_CAP),
};
const OPENAI_SPACE = embeddingSpace('openai', 'text-embedding-3-small');
const IN_REGION: InferenceProvider = { id: 'openai', region: 'eu' };

const ARTICLE = [
  'Refunds are issued to the original payment method within five working days.',
  'Standard delivery takes three to five working days.',
].join('\n\n');
const COPILOT_PASSAGE = 'Refunds over 500 go to finance for approval.';
const CAPPED_ROW =
  "This row was not indexed: today's AI allowance is used up; it renews at 00:00 UTC.";

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

interface SourceView {
  id: string;
  chunk_count: number;
}

/** A CSV of `rows` short article rows — each one chunk. */
function articlesCsv(rows: number, word = 'answer'): string {
  const lines = ['name,type,content,source_url'];
  for (let i = 1; i <= rows; i += 1) lines.push(`Row ${i},article,The ${word} for question ${i}.,`);
  return lines.join('\n');
}

/** The bytes `prepare(content)` reserves: its chunks, as sent. */
const estimateOf = (content: string): number =>
  chunk(content).reduce((sum, piece) => sum + Buffer.byteLength(piece, 'utf8'), 0);

describe('daily AI caps on the embedding meter (tm 257.20)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  const net = fakeOpenAiFetch(openAiEmbeddings((text) => embed(text)));
  const log = new LineSink();

  const today = () => utcDayKey(new Date());

  /** Today's `embedding` row for a workspace, or the deployment's (`null`). */
  async function usage(licenseId: bigint | null) {
    const row = await owner.aiDailyUsage.findFirst({
      where: { licenseId, day: today(), meter: 'embedding' },
    });
    return row ? { reserved: Number(row.reserved), used: Number(row.used) } : null;
  }

  /** Set today's `used` for a workspace's row or the deployment's. */
  async function fill(licenseId: bigint | null, used: number): Promise<void> {
    await owner.$executeRaw`
      INSERT INTO ai_daily_usage (id, license_id, day, meter, reserved, used, updated_at)
      VALUES (gen_random_uuid(), ${licenseId}, ${today()}, 'embedding', 0, ${BigInt(used)}, now())
      ON CONFLICT (license_id, day, meter) DO UPDATE SET used = EXCLUDED.used, reserved = 0`;
  }

  /** Inputs the provider was sent since the last reset — what it billed, at 7 each. */
  const inputsSent = (): number =>
    net.calls.reduce(
      (sum, call) => sum + (JSON.parse(String(call.init.body)) as { input: string[] }).input.length,
      0,
    );

  const auth = async (tenant: 'a' | 'b') => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    })}`,
  });

  async function aiAgent(tenant: 'a' | 'b'): Promise<string> {
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx[tenant].licenseId, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    return agent.id;
  }

  const contextOf = (tenant: 'a' | 'b'): TenantContext => ({
    licenseId: fx[tenant].licenseId,
    organizationId: fx[tenant].organizationId,
  });

  function expectEmbeddingCap(
    response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown },
    scope: 'workspace' | 'global',
    what = '',
  ): void {
    expect(response.statusCode, what).toBe(429);
    expect((response.json() as ErrorBody).error, what).toMatchObject({
      type: 'limit_reached',
      details: { reason: 'ai_daily_cap', meter: 'embedding', scope },
    });
    const retryAfter = Number(response.headers['retry-after']);
    expect(Math.abs(retryAfter - secondsUntilUtcMidnight(new Date())), what).toBeLessThanOrEqual(2);
  }

  function capLines(lines: Array<Record<string, unknown>> = log.events('ai.cap_reached')) {
    return lines.map((line) => ({
      license_id: line['license_id'],
      meter: line['meter'],
      scope: line['scope'],
    }));
  }

  async function chunkTexts(sourceId: string): Promise<string[]> {
    const rows = await owner.knowledgeChunk.findMany({
      where: { sourceId },
      orderBy: { position: 'asc' },
      select: { chunkText: true },
    });
    return rows.map((row) => row.chunkText);
  }

  const sourceCount = (tenant: 'a' | 'b') =>
    owner.knowledgeSource.count({ where: { licenseId: fx[tenant].licenseId } });

  const createArticle = async (agent: string, headers: Record<string, string>) => {
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: agent, name: 'Policies', type: 'article', content: ARTICLE },
      headers,
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  };

  const createWebsite = async (agent: string, headers: Record<string, string>, path: string) => {
    const response = await server.post(
      '/knowledge-sources',
      {
        ai_agent_id: agent,
        name: 'Help centre',
        type: 'website',
        source_url: `https://help.example.com/${path}`,
      },
      headers,
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  };

  /** Opts a source into automatic refresh and backdates it, so a sweep finds it due. */
  async function makeDue(id: string): Promise<void> {
    await owner.knowledgeSource.update({
      where: { id },
      data: { refreshAfterDays: 30, nextRefreshAt: new Date(Date.now() - 60_000) },
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer(
      { LOG_LEVEL: 'warn', ...EMBEDDING_ENV, ...CAPS_ENV },
      { embeddingFetch: net.impl, logStream: log as unknown as NodeJS.WritableStream },
    );
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    net.calls.length = 0;
    log.lines.length = 0;
  });

  // ==========================================================================
  // 1. The panel's indexing routes
  // ==========================================================================

  describe('the indexing routes', () => {
    it('index under the cap on every route and count what the provider billed, on the workspace and the deployment', async () => {
      const agent = await aiAgent('a');
      const headers = await auth('a');

      const source = await createArticle(agent, headers);
      const file = await server.post(
        '/knowledge-sources/file',
        {
          ai_agent_id: agent,
          filename: 'faq.txt',
          content_type: 'text/plain',
          data: Buffer.from(ARTICLE, 'utf8').toString('base64'),
        },
        headers,
      );
      const edited = await server.patch(
        `/knowledge-sources/${source.id}`,
        { content: 'Gift cards never expire and can be used online.' },
        headers,
      );
      const reindexed = await server.post(
        `/knowledge-sources/${source.id}/reindex`,
        undefined,
        headers,
      );
      const copilot = await server.post(
        '/copilot/knowledge',
        { name: 'Escalations', type: 'article', content: COPILOT_PASSAGE },
        headers,
      );
      const bulk = await server.post(
        '/knowledge-sources/bulk',
        { ai_agent_id: agent, csv: articlesCsv(3) },
        headers,
      );

      expect([file, edited, reindexed, copilot, bulk].map((r) => r.statusCode)).toEqual([
        201, 200, 200, 201, 200,
      ]);
      expect(bulk.json()).toMatchObject({ imported: 3, failed: 0 });
      // 2 + 2 + 1 + 1 + 1 + 3 chunks, each request billed by the provider.
      expect(inputsSent()).toBe(10);
      const billed = inputsSent() * PER_INPUT;
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: billed });
      expect(await usage(null)).toEqual({ reserved: 0, used: billed });
      expect(capLines()).toEqual([]);
    });

    it('refuses every route at the workspace cap with 429 ai_daily_cap — no provider call, nothing written, the old text kept', async () => {
      const agent = await aiAgent('a');
      const headers = await auth('a');
      const source = await createArticle(agent, headers);
      const chunksBefore = await chunkTexts(source.id);
      const sourcesBefore = await sourceCount('a');
      await fill(fx.a.licenseId, CAP);
      net.calls.length = 0;

      const responses = {
        create: await server.post(
          '/knowledge-sources',
          {
            ai_agent_id: agent,
            name: 'New',
            type: 'article',
            content: 'Opening hours are 9 to 5.',
          },
          headers,
        ),
        website: await server.post(
          '/knowledge-sources',
          {
            ai_agent_id: agent,
            name: 'Help',
            type: 'website',
            source_url: 'https://help.example.com/returns',
          },
          headers,
        ),
        file: await server.post(
          '/knowledge-sources/file',
          {
            ai_agent_id: agent,
            filename: 'hours.txt',
            content_type: 'text/plain',
            data: Buffer.from('Opening hours are 9 to 5.', 'utf8').toString('base64'),
          },
          headers,
        ),
        edit: await server.patch(
          `/knowledge-sources/${source.id}`,
          { name: 'Renamed', content: 'Replacement text.' },
          headers,
        ),
        reindex: await server.post(`/knowledge-sources/${source.id}/reindex`, undefined, headers),
        copilot: await server.post(
          '/copilot/knowledge',
          { name: 'Escalations', type: 'article', content: COPILOT_PASSAGE },
          headers,
        ),
        bulk: await server.post(
          '/knowledge-sources/bulk',
          { ai_agent_id: agent, csv: articlesCsv(3) },
          headers,
        ),
      };

      for (const [route, response] of Object.entries(responses)) {
        expectEmbeddingCap(response, 'workspace', route);
      }
      expect(net.calls).toHaveLength(0);
      expect(await sourceCount('a')).toBe(sourcesBefore);
      expect(
        await owner.knowledgeSource.findUniqueOrThrow({
          where: { id: source.id },
          select: { name: true, content: true },
        }),
      ).toEqual({ name: 'Policies', content: ARTICLE });
      expect(await chunkTexts(source.id)).toEqual(chunksBefore);
      expect(capLines()).toEqual(
        Object.keys(responses).map(() => ({
          license_id: fx.a.licenseId.toString(),
          meter: 'embedding',
          scope: 'workspace',
        })),
      );
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: CAP });
    });

    it('refuses at the deployment’s cap too, whichever workspace asks', async () => {
      const agent = await aiAgent('b');
      await fill(null, GLOBAL_CAP);

      const response = await server.post(
        '/knowledge-sources',
        { ai_agent_id: agent, name: 'Policies', type: 'article', content: ARTICLE },
        await auth('b'),
      );

      expectEmbeddingCap(response, 'global');
      expect(net.calls).toHaveLength(0);
      expect(await sourceCount('b')).toBe(0);
      expect(capLines()).toEqual([
        { license_id: fx.b.licenseId.toString(), meter: 'embedding', scope: 'global' },
      ]);
      // The workspace's reservation was handed back in the same transaction.
      expect(await usage(fx.b.licenseId)).toEqual({ reserved: 0, used: 0 });
    });

    it('checks the AI agent before embedding: an unknown agent is a 400 that cost nothing', async () => {
      const headers = await auth('a');
      const unknown = randomUUID();

      const created = await server.post(
        '/knowledge-sources',
        { ai_agent_id: unknown, name: 'Policies', type: 'article', content: ARTICLE },
        headers,
      );
      const uploaded = await server.post(
        '/knowledge-sources/file',
        {
          ai_agent_id: unknown,
          filename: 'faq.txt',
          content_type: 'text/plain',
          data: Buffer.from(ARTICLE, 'utf8').toString('base64'),
        },
        headers,
      );

      expect([created.statusCode, uploaded.statusCode]).toEqual([400, 400]);
      expect(net.calls).toHaveLength(0);
      expect(await usage(fx.a.licenseId)).toBeNull();
      expect(await sourceCount('a')).toBe(0);
    });
  });

  // ==========================================================================
  // 2. The bulk import
  // ==========================================================================

  describe('the bulk import', () => {
    it('refuses a file the day cannot afford whole: one 429, no row written, no provider call', async () => {
      const agent = await aiAgent('a');
      const csv = articlesCsv(200);
      // Two hundred rows, each well under the cap, together over it.
      expect(estimateOf('The answer for question 200.')).toBeLessThan(CAP);

      const response = await server.post(
        '/knowledge-sources/bulk',
        { ai_agent_id: agent, csv },
        await auth('a'),
      );

      expectEmbeddingCap(response, 'workspace');
      expect(net.calls).toHaveLength(0);
      expect(await sourceCount('a')).toBe(0);
      // Nothing was reserved: the estimate never fit, so no row was written.
      expect(await usage(fx.a.licenseId)).toBeNull();
      expect(capLines()).toHaveLength(1);
    });

    it('previews that same file for free', async () => {
      const agent = await aiAgent('a');
      const response = await server.post(
        '/knowledge-sources/bulk',
        { ai_agent_id: agent, csv: articlesCsv(200), dry_run: true },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ imported: 200, failed: 0, dry_run: true });
      expect(net.calls).toHaveLength(0);
      expect(await usage(fx.a.licenseId)).toBeNull();
    });

    it('imports a file that fits and settles to what its rows cost, not to the estimate', async () => {
      const agent = await aiAgent('a');
      const rows = 20;
      const csv = articlesCsv(rows);

      const response = await server.post(
        '/knowledge-sources/bulk',
        { ai_agent_id: agent, csv },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ imported: rows, failed: 0 });
      expect(net.calls).toHaveLength(rows);
      // Reserved at ~28 bytes a row, settled at the 7 tokens a row billed.
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: rows * PER_INPUT });
      expect(await usage(null)).toEqual({ reserved: 0, used: rows * PER_INPUT });
    });

    it('skips a crawled row the day cannot take, with the reason, and keeps the rows that fit', async () => {
      const agent = await aiAgent('a');
      const texts = [1, 2, 3].map((i) => `The answer for question ${i}.`);
      const csv = [
        'name,type,content,source_url',
        ...texts.map((text, i) => `Row ${i + 1},article,${text},`),
        'Help centre,website,,https://help.example.com/shipping-and-returns',
      ].join('\n');
      const held = texts.reduce((sum, text) => sum + estimateOf(text), 0);
      // Room for the pasted rows' estimate and five tokens more: the crawled
      // page, known only once fetched, is far more than that.
      await fill(fx.a.licenseId, CAP - held - 5);

      const response = await server.post(
        '/knowledge-sources/bulk',
        { ai_agent_id: agent, csv },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        imported: number;
        failed: number;
        results: Array<{ line: number; status: string; error: string | null }>;
      };
      expect(body).toMatchObject({ imported: 3, failed: 1 });
      expect(body.results.map((row) => [row.line, row.status, row.error])).toEqual([
        [1, 'imported', null],
        [2, 'imported', null],
        [3, 'imported', null],
        [4, 'skipped', CAPPED_ROW],
      ]);
      expect(net.calls).toHaveLength(3);
      expect(await usage(fx.a.licenseId)).toEqual({
        reserved: 0,
        used: CAP - held - 5 + 3 * PER_INPUT,
      });
      expect(capLines()).toEqual([
        { license_id: fx.a.licenseId.toString(), meter: 'embedding', scope: 'workspace' },
      ]);
    });
  });

  // ==========================================================================
  // 3. A Copilot draft
  // ==========================================================================

  describe('a Copilot draft', () => {
    /** An active chat whose customer last wrote `text`. */
    async function chatAsking(text: string, headers: Record<string, string>): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Visitor' },
        select: { id: true },
      });
      const started = await server.post(
        '/chats',
        { customer_id: customer.id, assign_to_me: true },
        headers,
      );
      expect([200, 201]).toContain(started.statusCode);
      const chatId = (started.json() as { id: string }).id;
      const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
      await owner.event.create({
        data: {
          id: `${thread.id}_101`,
          threadId: thread.id,
          chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text,
          authorType: 'customer',
          recipients: 'all',
          createdAt: new Date(Date.now() - 1_000),
        },
      });
      return chatId;
    }

    it('drafts under the cap; at the cap answers an empty draft that says why, asking nothing', async () => {
      const headers = await auth('a');
      const saved = await server.post(
        '/copilot/knowledge',
        { name: 'Escalations', type: 'article', content: COPILOT_PASSAGE },
        headers,
      );
      expect(saved.statusCode).toBe(201);
      const chatId = await chatAsking(COPILOT_PASSAGE, headers);

      const drafted = await server.post(`/copilot/chats/${chatId}/reply`, undefined, headers);
      expect(drafted.statusCode).toBe(200);
      expect(drafted.json()).toMatchObject({ draft: COPILOT_PASSAGE });
      expect(drafted.json()).not.toHaveProperty('reason');
      const assists = await owner.skillRun.count({ where: { chatId } });
      expect(assists).toBe(1);

      await fill(fx.a.licenseId, CAP);
      net.calls.length = 0;
      const capped = await server.post(`/copilot/chats/${chatId}/reply`, undefined, headers);

      expect(capped.statusCode).toBe(200);
      expect(capped.json()).toEqual({ draft: '', sources: [], reason: 'ai_daily_cap' });
      expect(net.calls).toHaveLength(0);
      // An empty suggestion helped no one: no second assist is recorded.
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(assists);
      expect(capLines()).toEqual([
        { license_id: fx.a.licenseId.toString(), meter: 'embedding', scope: 'workspace' },
      ]);
    });
  });

  // ==========================================================================
  // 4. The freshness sweep
  // ==========================================================================

  describe('the freshness sweep', () => {
    const warnings: Array<Record<string, unknown>> = [];

    /** The sweep as the scheduler builds it: the server's provider, metered over the app role. */
    const sweeper = () =>
      new KnowledgeRefreshSweeper(appRole, {
        knowledge: new KnowledgeService({
          embeddings: new MeteredEmbeddings(
            new OpenAiEmbeddingProvider(
              {
                baseUrl: EMBEDDING_ENV.EMBEDDING_API_BASE_URL,
                model: EMBEDDING_ENV.EMBEDDING_MODEL,
                apiKey: EMBEDDING_ENV.EMBEDDING_API_KEY,
                timeoutMs: 10_000,
              },
              { fetchImpl: net.impl, logger: quiet },
            ),
            new AiDailyBudget(appRole, aiDailyCaps(testEnv(CAPS_ENV)), {
              logger: { warn: (details) => warnings.push(details), error: () => {} },
            }),
          ),
        }),
        embeddingInference: IN_REGION,
      });

    beforeEach(() => {
      warnings.length = 0;
    });

    async function stored(id: string) {
      return owner.knowledgeSource.findUniqueOrThrow({
        where: { id },
        select: { content: true, lastRefreshError: true, nextRefreshAt: true },
      });
    }

    it('defers a due refresh at the cap: the reason recorded, text and chunks kept, the next attempt at 00:00 UTC, nothing asked', async () => {
      const agent = await aiAgent('a');
      const headers = await auth('a');
      const first = await createWebsite(agent, headers, 'refunds');
      const second = await createWebsite(agent, headers, 'delivery');
      await makeDue(first.id);
      await makeDue(second.id);
      const before = await Promise.all([first.id, second.id].map((id) => stored(id)));
      const chunksBefore = await Promise.all([first.id, second.id].map((id) => chunkTexts(id)));
      await fill(fx.a.licenseId, CAP);
      net.calls.length = 0;

      const now = new Date();
      const report = await sweeper().run({ now });

      expect(report.totals).toMatchObject({ checked: 2, refreshed: 0, failed: 2 });
      for (const [index, id] of [first.id, second.id].entries()) {
        expect(await stored(id)).toEqual({
          content: before[index]!.content,
          lastRefreshError: REFRESH_DEFERRED_AI_CAP,
          nextRefreshAt: nextUtcMidnight(now),
        });
        expect(await chunkTexts(id)).toEqual(chunksBefore[index]);
      }
      expect(net.calls).toHaveLength(0);
      // Refused once; the second source was deferred without being crawled or asked.
      expect(capLines(warnings)).toEqual([
        { license_id: fx.a.licenseId.toString(), meter: 'embedding', scope: 'workspace' },
      ]);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: CAP });
    });

    it('refreshes under the cap and counts it on the workspace', async () => {
      const agent = await aiAgent('a');
      const source = await createWebsite(agent, await auth('a'), 'refunds');
      await makeDue(source.id);
      const spent = (await usage(fx.a.licenseId))!.used;
      net.calls.length = 0;

      const report = await sweeper().run();

      expect(report.totals).toMatchObject({ checked: 1, refreshed: 1, failed: 0 });
      expect((await stored(source.id)).lastRefreshError).toBeNull();
      expect(inputsSent()).toBeGreaterThan(0);
      expect(await usage(fx.a.licenseId)).toEqual({
        reserved: 0,
        used: spent + inputsSent() * PER_INPUT,
      });
    });
  });

  // ==========================================================================
  // 5. knowledge:reembed
  // ==========================================================================

  describe('knowledge:reembed', () => {
    const warnings: Array<Record<string, unknown>> = [];
    const lexical = new KnowledgeService({ embeddings: new MockEmbeddingProvider() });

    const reembedder = () =>
      new KnowledgeReembedder(appRole, {
        embeddings: new MeteredEmbeddings(
          new OpenAiEmbeddingProvider(
            {
              baseUrl: EMBEDDING_ENV.EMBEDDING_API_BASE_URL,
              model: EMBEDDING_ENV.EMBEDDING_MODEL,
              apiKey: EMBEDDING_ENV.EMBEDDING_API_KEY,
              timeoutMs: 10_000,
            },
            { fetchImpl: net.impl, logger: quiet },
          ),
          new AiDailyBudget(appRole, aiDailyCaps(testEnv(CAPS_ENV)), {
            logger: { warn: (details) => warnings.push(details), error: () => {} },
          }),
        ),
        embeddingInference: IN_REGION,
      });

    /** Three sources in the stub's space: two in workspace A, one in B. */
    async function seedLexical(): Promise<string[]> {
      warnings.length = 0;
      const ids: string[] = [];
      for (const [tenant, name] of [
        ['a', 'Delivery'],
        ['a', 'Refunds'],
        ['b', 'Vouchers'],
      ] as const) {
        const agent = await aiAgent(tenant);
        const source = await owner.knowledgeSource.create({
          data: {
            aiAgentId: agent,
            licenseId: fx[tenant].licenseId,
            type: 'article',
            name,
            content: ARTICLE,
          },
          select: { id: true },
        });
        await lexical.index(
          owner as TenantClient,
          contextOf(tenant),
          source.id,
          await lexical.prepare(ARTICLE),
        );
        ids.push(source.id);
      }
      return ids;
    }

    const spacesOf = async (ids: string[]) =>
      (
        await owner.knowledgeChunk.findMany({
          where: { sourceId: { in: ids } },
          select: { embeddingSpace: true },
        })
      ).map((row) => row.embeddingSpace);

    it('moves a workspace whose own allowance is used up, and counts the run on the deployment alone', async () => {
      const ids = await seedLexical();
      await fill(fx.a.licenseId, CAP);

      const report = await reembedder().run();

      expect(report).toMatchObject({
        capped: false,
        totals: { pending: 3, reembedded: 3, failed: 0 },
      });
      expect(new Set(await spacesOf(ids))).toEqual(new Set([OPENAI_SPACE]));
      // No workspace paid: A's row is as it was and B has none.
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: CAP });
      expect(await usage(fx.b.licenseId)).toBeNull();
      expect(await usage(null)).toEqual({ reserved: 0, used: inputsSent() * PER_INPUT });
      expect(inputsSent()).toBe(6);
      expect(warnings).toEqual([]);
    });

    it('stops asking when the deployment’s allowance is used up: every source still pending fails, for the next run', async () => {
      const ids = await seedLexical();
      await fill(null, GLOBAL_CAP);
      const events: Array<{ outcome: string; kind?: string }> = [];

      const report = await reembedder().run({
        onSource: (event) => {
          events.push({ outcome: event.outcome, ...(event.kind ? { kind: event.kind } : {}) });
        },
      });

      expect(report).toMatchObject({
        capped: true,
        totals: { pending: 3, reembedded: 0, failed: 3 },
      });
      expect(events).toEqual(ids.map(() => ({ outcome: 'failed', kind: 'ai_daily_cap' })));
      expect(net.calls).toHaveLength(0);
      expect(new Set(await spacesOf(ids))).toEqual(new Set([LEXICAL_EMBEDDING_SPACE]));
      // Refused once, at the first source; the rest were not asked about.
      expect(capLines(warnings)).toEqual([
        { license_id: null, meter: 'embedding', scope: 'global' },
      ]);
      expect(await usage(null)).toEqual({ reserved: 0, used: GLOBAL_CAP });
    });
  });

  // ==========================================================================
  // 6. knowledge-refresh:run, in its own process
  // ==========================================================================

  describe('knowledge-refresh:run', () => {
    const run = promisify(execFile);
    const apiRoot = resolve(import.meta.dirname, '../..');
    let provider: Server;
    let baseUrl: string;
    const received: string[][] = [];

    beforeAll(async () => {
      // OpenAI's embeddings endpoint, as far as the adapter in the child
      // process can tell: one 1536-wide vector per input, 7 tokens an input.
      provider = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (part: string) => {
          body += part;
        });
        request.on('end', () => {
          const inputs = (JSON.parse(body) as { input: string[] }).input;
          received.push(inputs);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              object: 'list',
              model: EMBEDDING_ENV.EMBEDDING_MODEL,
              data: inputs.map((text, index) => ({
                object: 'embedding',
                index,
                embedding: embed(text),
              })),
              usage: { prompt_tokens: inputs.length * PER_INPUT, total_tokens: 0 },
            }),
          );
        });
      });
      await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
      baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
    });

    afterAll(async () => {
      await new Promise((done) => provider.close(done));
    });

    it(
      'defers a capped workspace’s refresh and counts another’s, on the rows the API spends from',
      { timeout: 120_000 },
      async () => {
        const capped = await createWebsite(await aiAgent('a'), await auth('a'), 'refunds');
        const open = await createWebsite(await aiAgent('b'), await auth('b'), 'delivery');
        await makeDue(capped.id);
        await makeDue(open.id);
        await fill(fx.a.licenseId, CAP);
        const spentByB = (await usage(fx.b.licenseId))!.used;
        const deployment = (await usage(null))!.used;
        received.length = 0;

        await run(
          process.execPath,
          ['--import', 'tsx', 'src/services/ai/knowledge-refresh-run.ts'],
          {
            cwd: apiRoot,
            env: {
              ...process.env,
              ...CAPS_ENV,
              EMBEDDING_PROVIDER: 'openai',
              EMBEDDING_API_BASE_URL: baseUrl,
              EMBEDDING_MODEL: EMBEDDING_ENV.EMBEDDING_MODEL,
              EMBEDDING_API_KEY: EMBEDDING_ENV.EMBEDDING_API_KEY,
              LOG_LEVEL: 'warn',
            },
            maxBuffer: 4 * 1024 * 1024,
          },
        );

        const sources = await owner.knowledgeSource.findMany({
          where: { id: { in: [capped.id, open.id] } },
          select: { id: true, lastRefreshError: true },
        });
        expect(Object.fromEntries(sources.map((s) => [s.id, s.lastRefreshError]))).toEqual({
          [capped.id]: REFRESH_DEFERRED_AI_CAP,
          [open.id]: null,
        });
        // Only B's text reached the provider, and B paid for it on its own row.
        const inputs = received.flat().length;
        expect(inputs).toBeGreaterThan(0);
        expect(await usage(fx.b.licenseId)).toEqual({
          reserved: 0,
          used: spentByB + inputs * PER_INPUT,
        });
        expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: CAP });
        expect(await usage(null)).toEqual({ reserved: 0, used: deployment + inputs * PER_INPUT });
      },
    );
  });
});
