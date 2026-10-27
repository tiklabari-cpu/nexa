/**
 * The root panel's AI settings (tm 389.17 · docs/platform-admin/design.md §B2, §C settings,
 * §D, §F), driven through the platform API and judged from a running tenant API on the same
 * database and Redis: the key stored sealed and shown as `…last4` only — in no response, log
 * line or audit entry in the clear; a change reaching the tenant's providers within five
 * seconds over `ai.settings_changed`, without a restart (the captured `Authorization` header
 * carries the new key); a removed row handing the tenant back to its environment; the
 * save-time rules (region, `PILOT_MODE` and the stub, the 1536 width); the re-embedding
 * warning; the connection test (stub, success, failure, the deployment's meter, three a
 * minute); re-embedding as a background job that refuses a second start; the role and fresh
 * code gates.
 *
 * Every provider is a recorder: no request leaves the process, and every key here is a label.
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPS_AI_REEMBED_KEY, OPS_AI_REEMBED_LOCK_KEY, type PlatformRole } from '@siyahtus/types';
import { assertPlatformEnv } from '../../src/config/platform-env.js';
import { buildPlatformServer, PLATFORM_PREFIX } from '../../src/platform-server.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MockEmbeddingProvider } from '../../src/services/ai/provider/mock-embedding-provider.js';
import type { TenantClient } from '../../src/lib/tenant.js';
import {
  openAiCompletion,
  openAiEmbeddings,
  openAiProblem,
  type OpenAiHandler,
} from '../helpers/fake-openai.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; message: string; details?: Record<string, unknown> } };

const REASON = 'Moving the deployment to the EU model';
const MINUTE = 60_000;
const KEY_ONE = 'sk-test-only-first-panel-key-R7m2';
const KEY_TWO = 'sk-test-only-second-panel-key-W4k9';
const FAKE_BASE = 'https://llm.fake.test/v1';

/** The forms a careless log or payload might carry a key in. */
const traces = (key: string): string[] => [
  key,
  key.slice(0, 14),
  Buffer.from(key).toString('base64'),
];

/** Every line a server wrote. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
  get text(): string {
    return this.lines.join('\n');
  }
}

/** A recorder that routes by path: chat completions and embeddings, each with its own answer. */
function providerNet() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const net = {
    calls,
    chat: openAiCompletion('OK') as OpenAiHandler,
    embeddings: openAiEmbeddings(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
    impl: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return url.endsWith('/embeddings') ? net.embeddings(init ?? {}) : net.chat(init ?? {});
    }) as typeof fetch,
  };
  return net;
}

const authorization = (init: RequestInit): string =>
  new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).get('authorization') ?? '';

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform AI settings (tm 389.17)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  const platformNet = providerNet();
  const tenantNet = providerNet();
  const platformLog = new LineSink();
  const tenantLog = new LineSink();
  const tokens = new Map<PlatformRole, string>();

  const call = (
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    role: PlatformRole = 'superadmin',
    server: FastifyInstance = platform.app,
  ): Promise<LightMyRequestResponse> =>
    server.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      ...(body === undefined ? {} : { payload: body }),
    });
  const put = (body: Record<string, unknown>, role: PlatformRole = 'superadmin') =>
    call('PUT', '/settings/ai', { reason: REASON, ...body }, role);
  const ok = async (response: Promise<LightMyRequestResponse>, status = 200) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    return settled.json() as Record<string, unknown>;
  };
  const errorOf = (response: LightMyRequestResponse) => (response.json() as ErrorBody).error;

  const openAiLlm = (key: string | null | undefined, extra: Record<string, unknown> = {}) => ({
    provider: 'openai',
    base_url: FAKE_BASE,
    model: 'gpt-test',
    region: 'eu',
    ...(key === undefined ? {} : { api_key: key }),
    ...extra,
  });

  /** One model call through the tenant server's own visitor provider — what its routes hold. */
  const tenantCall = () =>
    tenant.app.aiProviders.llm('visitor').complete({
      system: 'Connection check.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxOutputTokens: 400,
      timeoutMs: 20_000,
    });

  /**
   * Call the tenant's model until a request reaches the recorder with `key`,
   * for at most five seconds — the time the requirement allows. The safety-net
   * re-read is a minute, so only the announcement can make this pass.
   */
  async function untilTenantUses(key: string): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < 5_000) {
      const before = tenantNet.calls.length;
      if (tenant.app.aiProviders.config().llm.provider === 'openai') {
        await tenantCall().catch(() => undefined);
        const sent = tenantNet.calls.slice(before);
        if (sent.some((sentCall) => authorization(sentCall.init) === `Bearer ${key}`)) {
          return Date.now() - started;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`the tenant API did not use the key ending ${key.slice(-4)} within 5 s`);
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000', LOG_LEVEL: 'debug' },
      {
        now: clock.read,
        aiFetch: platformNet.impl,
        logStream: platformLog as unknown as NodeJS.WritableStream,
      },
    );
    tenant = await startTestServer(
      { LOG_LEVEL: 'debug' },
      { llmFetch: tenantNet.impl, logStream: tenantLog as unknown as NodeJS.WritableStream },
    );
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    clock.now = Date.now();
    fx = await seedFixtures(owner);
    await platform.app.redis.del(OPS_AI_REEMBED_KEY, OPS_AI_REEMBED_LOCK_KEY);
    // The previous test's settings are gone with the reset; the tenant learns so now.
    await tenant.app.aiProviders.reload();
    platformNet.chat = openAiCompletion('OK');
    platformNet.calls.length = 0;
    tenantNet.calls.length = 0;
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  it('reads nothing stored as the environment, with no re-embedding yet', async () => {
    expect(await ok(call('GET', '/settings/ai'))).toEqual({
      llm: null,
      embedding: null,
      caps: null,
      prices: null,
      source: { llm: 'env', embedding: 'env' },
      reembed: expect.objectContaining({ state: 'idle', sources: 0 }),
      updated_at: null,
    });
  });

  it('stores the key sealed and shows only its last four characters — in no response, row, log or audit entry in the clear', async () => {
    const saved = await ok(put({ llm: openAiLlm(KEY_ONE) }));
    expect(saved['llm']).toEqual({
      provider: 'openai',
      base_url: FAKE_BASE,
      model: 'gpt-test',
      model_fast: null,
      region: 'eu',
      timeout_ms: null,
      max_output_tokens: null,
      api_key_last4: KEY_ONE.slice(-4),
    });
    expect(saved['source']).toEqual({ llm: 'db', embedding: 'env' });
    const read = await call('GET', '/settings/ai');
    expect((read.json() as { llm: unknown }).llm).toEqual(saved['llm']);

    const row = await owner.platformSetting.findUniqueOrThrow({ where: { key: 'ai.llm' } });
    expect((row.value as Record<string, unknown>)['api_key_ciphertext']).toMatch(/^v1:/);

    const [entry] = await owner.platformAuditLog.findMany({
      where: { action: 'ai_settings.updated' },
    });
    expect(entry).toMatchObject({ targetType: 'settings', targetId: 'ai.llm', reason: REASON });
    expect(entry!.payload).toEqual({
      changed: ['llm.provider', 'llm.base_url', 'llm.model', 'llm.region', 'llm.api_key'],
    });

    // The tenant uses it, so the key went through its logs' path too.
    await untilTenantUses(KEY_ONE);
    const everything = [
      JSON.stringify(saved),
      read.body,
      JSON.stringify(row.value),
      JSON.stringify(entry, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
      platformLog.text,
      tenantLog.text,
    ].join('\n');
    for (const trace of traces(KEY_ONE)) expect(everything).not.toContain(trace);
  });

  it('reaches a running tenant API within five seconds of each change, a new key replacing the old', async () => {
    await ok(put({ llm: openAiLlm(KEY_ONE) }));
    expect(await untilTenantUses(KEY_ONE)).toBeLessThan(5_000);

    // Only the key: the rest of the row stays as it was.
    await ok(put({ llm: openAiLlm(KEY_TWO) }));
    expect(await untilTenantUses(KEY_TWO)).toBeLessThan(5_000);
    const [, second] = await owner.platformAuditLog.findMany({
      where: { action: 'ai_settings.updated' },
      orderBy: { chainSeq: 'asc' },
    });
    expect(second!.payload).toEqual({ changed: ['llm.api_key'] });
  });

  it('hands the tenant back to its environment when the row is removed, and keeps the key when none is sent', async () => {
    await ok(put({ llm: openAiLlm(KEY_ONE) }));
    await untilTenantUses(KEY_ONE);
    // No `api_key`: the stored one stays.
    const kept = await ok(put({ llm: openAiLlm(undefined, { model: 'gpt-test-2' }) }));
    expect((kept['llm'] as Record<string, unknown>)['api_key_last4']).toBe(KEY_ONE.slice(-4));

    const removed = await ok(put({ llm: null }));
    expect(removed['llm']).toBeNull();
    expect(removed['source']).toEqual({ llm: 'env', embedding: 'env' });
    const started = Date.now();
    while (tenant.app.aiProviders.config().llm.source !== 'env' && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(tenant.app.aiProviders.config().llm).toMatchObject({ source: 'env', provider: 'mock' });
    expect(tenant.app.aiProviders.llm('visitor').id).toBe('mock');
  });

  it('refuses a remote provider without base URL, model or region, any width but 1536, and an unknown field', async () => {
    const missing = await put({ llm: { provider: 'openai', api_key: KEY_ONE } });
    expect(missing.statusCode).toBe(400);
    expect(errorOf(missing).message).toMatch(/base_url, model, region required/);
    const wide = await put({
      embedding: {
        provider: 'openai',
        base_url: FAKE_BASE,
        model: 'e',
        region: 'eu',
        dimensions: 1024,
      },
    });
    expect(wide.statusCode).toBe(400);
    expect(errorOf(wide).message).toMatch(/must be 1536/);
    expect((await put({ llm: { provider: 'mock', temperature: 1 } })).statusCode).toBe(400);
    expect(await owner.platformSetting.count({ where: { key: { startsWith: 'ai.' } } })).toBe(0);
  });

  it('holds production to the regional host of the declared region, and the pilot to a real provider in SIYAHTUS_REGION', async () => {
    const base = testEnv({ RATE_LIMIT_PLATFORM_PER_MIN: '100000', SIYAHTUS_REGION: 'eu' });
    const production = await buildPlatformServer({
      env: { ...base, isProduction: true, PILOT_MODE: true },
      platform: assertPlatformEnv(base),
      now: clock.read,
    });
    await production.ready();
    try {
      const putThere = (body: Record<string, unknown>) =>
        call('PUT', '/settings/ai', { reason: REASON, ...body }, 'superadmin', production);
      const global = await putThere({
        llm: openAiLlm(KEY_ONE, { base_url: 'https://api.openai.com/v1' }),
      });
      expect(global.statusCode).toBe(400);
      expect(errorOf(global).message).toMatch(/api\.openai\.com/);
      const crossed = await putThere({
        embedding: {
          provider: 'openai',
          base_url: 'https://us.api.openai.com/v1',
          model: 'text-embedding-3-small',
          region: 'us',
        },
      });
      expect(crossed.statusCode).toBe(400);
      expect(errorOf(crossed).message).toMatch(/SIYAHTUS_REGION \(eu\)/);
      const stub = await putThere({ llm: { provider: 'mock' } });
      expect(stub.statusCode).toBe(400);
      expect(errorOf(stub).message).toMatch(/real provider .*PILOT_MODE=true/);
      expect(await owner.platformSetting.count({ where: { key: { startsWith: 'ai.' } } })).toBe(0);

      const regional = await putThere({
        llm: openAiLlm(KEY_ONE, { base_url: 'https://eu.api.openai.com/v1' }),
      });
      expect(regional.statusCode, regional.body).toBe(200);
    } finally {
      await production.close();
    }
  });

  it('warns that the knowledge must be re-embedded when the embedding model changes, and not otherwise', async () => {
    const embedding = {
      provider: 'openai',
      base_url: FAKE_BASE,
      model: 'text-embedding-test',
      region: 'eu',
      dimensions: 1536,
      api_key: KEY_ONE,
    };
    const first = await ok(put({ embedding }));
    expect(first['warning']).toBe('reembed_required');
    expect(first['embedding']).toMatchObject({
      dimensions: 1536,
      api_key_last4: KEY_ONE.slice(-4),
    });
    // Same space, new key: nothing to move.
    const rekeyed = await ok(put({ embedding: { ...embedding, api_key: KEY_TWO } }));
    expect(rekeyed['warning']).toBeUndefined();
    const caps = {
      llm: { workspace: 1000, global: 9000 },
      embedding: { workspace: 2000, global: 8000 },
    };
    const capped = await ok(put({ caps }));
    expect(capped['caps']).toEqual(caps);
    expect(capped['warning']).toBeUndefined();
  });

  it('writes the deployment caps beside the plans’ defaults and the tenant applies them', async () => {
    await owner.platformSetting.create({
      data: { key: 'ai.caps', value: { plans: { growth: { llm: 123 } } } },
    });
    const caps = {
      llm: { workspace: 1111, global: 9999 },
      embedding: { workspace: 2222, global: 8888 },
    };
    await ok(
      put({
        caps,
        prices: {
          llm_input_usd_per_mtok: 0.4,
          llm_output_usd_per_mtok: 1.6,
          embedding_usd_per_mtok: 0.02,
        },
      }),
    );
    const row = await owner.platformSetting.findUniqueOrThrow({ where: { key: 'ai.caps' } });
    expect(row.value).toEqual({ plans: { growth: { llm: 123 } }, deployment: caps });

    const started = Date.now();
    while (tenant.app.aiProviders.config().capsSource !== 'db' && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(tenant.app.aiProviders.config().caps).toEqual(caps);
    expect(tenant.app.aiProviders.config().prices).toEqual({
      llm: { input: 0.4, output: 1.6 },
      embedding: 0.02,
    });

    await ok(put({ caps: null }));
    const kept = await owner.platformSetting.findUniqueOrThrow({ where: { key: 'ai.caps' } });
    expect(kept.value).toEqual({ plans: { growth: { llm: 123 } } });
  });

  describe('the connection test', () => {
    const test = (target: 'llm' | 'embedding', role: PlatformRole = 'superadmin') =>
      call('POST', '/settings/ai/test-connection', { reason: REASON, target }, role);

    it('succeeds on the stub without a request, and says the environment decided', async () => {
      const result = await ok(test('llm'));
      expect(result).toEqual({
        target: 'llm',
        provider: 'mock',
        source: 'env',
        model: null,
        ok: true,
        latency_ms: expect.any(Number),
        error: null,
      });
      expect(platformNet.calls).toHaveLength(0);
    });

    it('sends one small completion with the stored key, counted on the deployment’s row and no workspace’s', async () => {
      await ok(put({ llm: openAiLlm(KEY_ONE) }));
      const result = await ok(test('llm'));
      expect(result).toMatchObject({
        provider: 'openai',
        source: 'db',
        model: 'gpt-test',
        ok: true,
      });
      expect(platformNet.calls).toHaveLength(1);
      expect(authorization(platformNet.calls[0]!.init)).toBe(`Bearer ${KEY_ONE}`);
      const usage = await owner.aiDailyUsage.findMany({ where: { meter: 'llm' } });
      expect(usage).toHaveLength(1);
      expect(usage[0]!.licenseId).toBeNull();
      expect(usage[0]!.used).toBeGreaterThan(0n);

      const entries = await owner.platformAuditLog.findMany({
        where: { action: 'ai_settings.connection_tested' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.payload).toMatchObject({ target: 'llm', ok: true, error: null });
    });

    it('reports a failure by its kind, never the provider’s message', async () => {
      await ok(put({ llm: openAiLlm(KEY_ONE) }));
      platformNet.chat = openAiProblem(401, 'invalid_api_key', {
        message: `Incorrect API key provided: ${KEY_ONE}`,
      });
      const response = await test('llm');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: false, error: 'auth' });
      for (const trace of traces(KEY_ONE)) expect(response.body).not.toContain(trace);
    });

    it('embeds one text on the stored embedding provider', async () => {
      await ok(
        put({
          embedding: {
            provider: 'openai',
            base_url: FAKE_BASE,
            model: 'text-embedding-test',
            region: 'eu',
            api_key: KEY_TWO,
          },
        }),
      );
      expect(await ok(test('embedding'))).toMatchObject({ provider: 'openai', ok: true });
      expect(platformNet.calls.map((sent) => sent.url)).toEqual([`${FAKE_BASE}/embeddings`]);
    });

    it('calls a stored model it cannot use misconfigured, rather than testing the environment’s stub', async () => {
      // No key here and none in the environment: the tenant API would run on its stub.
      await ok(put({ llm: openAiLlm(undefined) }));
      const result = await ok(test('llm'));
      expect(result).toMatchObject({
        provider: 'openai',
        source: 'db',
        ok: false,
        error: 'misconfigured',
      });
      expect(platformNet.calls).toHaveLength(0);
    });

    it('allows three a minute per operator', async () => {
      for (let i = 0; i < 3; i++) await ok(test('llm'));
      const fourth = await test('llm');
      expect(fourth.statusCode).toBe(429);
      expect(fourth.headers['retry-after']).toBeDefined();
    });
  });

  describe('re-embedding', () => {
    it('moves the knowledge into the stored model’s space in the background, and refuses a second start while it runs', async () => {
      const lexical = new KnowledgeService({ embeddings: new MockEmbeddingProvider() });
      const context = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      const agent = await owner.aiAgent.create({
        data: { licenseId: context.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      });
      const content = 'Standard delivery takes three to five working days.';
      const source = await owner.knowledgeSource.create({
        data: {
          aiAgentId: agent.id,
          licenseId: context.licenseId,
          type: 'article',
          name: 'Delivery',
          content,
        },
        select: { id: true },
      });
      await lexical.index(
        owner as TenantClient,
        context,
        source.id,
        await lexical.prepare(content),
      );

      await ok(
        put({
          embedding: {
            provider: 'openai',
            base_url: FAKE_BASE,
            model: 'text-embedding-test',
            region: 'eu',
            api_key: KEY_ONE,
          },
        }),
      );
      // The provider answers only once the test lets it: the run is still going.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const answer = platformNet.embeddings;
      platformNet.embeddings = async (init) => {
        await gate;
        return answer(init);
      };
      try {
        const started = await ok(call('POST', '/settings/ai/reembed', { reason: REASON }), 202);
        expect(started).toMatchObject({ state: 'running', target: 'openai:text-embedding-test' });

        const second = await call('POST', '/settings/ai/reembed', { reason: REASON });
        expect(second.statusCode).toBe(409);
        expect(errorOf(second).type).toBe('platform_operation_running');
        const running = await ok(call('GET', '/settings/ai'));
        expect((running['reembed'] as Record<string, unknown>)['state']).toBe('running');
      } finally {
        release();
        platformNet.embeddings = answer;
      }
      await platform.app.platformAiOperations.idle();

      const done = await ok(call('GET', '/settings/ai'));
      expect(done['reembed']).toMatchObject({
        state: 'finished',
        target: 'openai:text-embedding-test',
        sources: 1,
        failed: 0,
        capped: false,
      });
      const spaces = await owner.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        select: { embeddingSpace: true },
      });
      expect(new Set(spaces.map((chunk) => chunk.embeddingSpace))).toEqual(
        new Set(['openai:text-embedding-test']),
      );
      const deployment = await owner.aiDailyUsage.findMany({ where: { meter: 'embedding' } });
      expect(deployment.map((row) => row.licenseId)).toEqual([null]);
      expect(
        await owner.platformAuditLog.count({ where: { action: 'ai_settings.reembed_started' } }),
      ).toBe(1);
      // Over: a new run may start.
      expect((await call('POST', '/settings/ai/reembed', { reason: REASON })).statusCode).toBe(202);
      await platform.app.platformAiOperations.idle();
    });
  });

  describe('who may', () => {
    it('lets support and readonly read, refuses billing, and keeps every change to the superadmin', async () => {
      for (const role of ['support', 'readonly'] as const) {
        expect((await call('GET', '/settings/ai', undefined, role)).statusCode).toBe(200);
      }
      const billing = await call('GET', '/settings/ai', undefined, 'billing');
      expect(billing.statusCode).toBe(403);
      for (const role of ['support', 'billing', 'readonly'] as const) {
        expect((await put({ llm: { provider: 'mock' } }, role)).statusCode).toBe(403);
        expect(
          (
            await call(
              'POST',
              '/settings/ai/test-connection',
              { reason: REASON, target: 'llm' },
              role,
            )
          ).statusCode,
        ).toBe(403);
        expect(
          (await call('POST', '/settings/ai/reembed', { reason: REASON }, role)).statusCode,
        ).toBe(403);
      }
    });

    it('needs a code younger than five minutes to change the settings, and a reason', async () => {
      clock.advance(6 * MINUTE);
      const stale = await put({ llm: { provider: 'mock' } });
      expect(stale.statusCode).toBe(403);
      expect(errorOf(stale).type).toBe('platform_recent_totp_required');
      clock.advance(-6 * MINUTE);
      const noReason = await call('PUT', '/settings/ai', { llm: { provider: 'mock' } });
      expect(noReason.statusCode).toBe(400);
      expect(errorOf(noReason).type).toBe('platform_reason_required');
      expect(await owner.platformSetting.count({ where: { key: { startsWith: 'ai.' } } })).toBe(0);
    });
  });

  it('is not served by the tenant API', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
    const response = await tenant.get('/platform/v1/settings/ai', {
      authorization: `Bearer ${token}`,
    });
    expect(response.statusCode).toBe(404);
  });
});
