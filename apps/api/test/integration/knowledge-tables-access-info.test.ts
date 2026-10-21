/**
 * The access information (tm 310.4 · SiyahTuş analysis AI-13, owner decision
 * K13 · AI-08 G14), against Postgres:
 *
 *   1. **The setting** — `GET`/`PUT /ai-access-info`: one per brand and one
 *      for every brand, replaced whole, every refusal in `details.problems`
 *      (another workspace's brand or source, a Copilot-only source, plain
 *      http or an internal host to fetch), a new URL dropping the last value,
 *      the scopes, and another workspace never seeing it.
 *   2. **The turn** — the engine with the server's resolver and no knowledge
 *      search at all (an access question is never a passage): a fixed link
 *      said and nothing else; a rule row's value; a fetched value said and
 *      kept, the last value when the fetch fails, a hand-over when there is
 *      none; an internal URL never fetched; the brand's own setting over the
 *      every-brand one, the every-brand setting never saying one brand's
 *      source to another brand; G14 letting the workspace's own words through
 *      and nothing else.
 *   3. **The live path** — a visitor's "site açılmıyor" answered by the AI
 *      job worker from the fetched value (`routes/customer.ts` wires the
 *      resolver, `accessInfoHttp` pins the fetch to a local HTTPS fake).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateShortId,
  splitSkillProcedure,
  validateProcedure,
  type KnowledgeTableProblem,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { ConversationEngine } from '../../src/services/ai/conversation/conversation-engine.js';
import {
  loadConversation,
  openConversation,
  saveConversation,
  type ConnectionRef,
} from '../../src/services/ai/conversation/state-store.js';
import { readAndCompile } from '../../src/services/ai/conversation/turn-config.js';
import {
  toTurnState,
  turnStatePatch,
  type TurnResult,
} from '../../src/services/ai/conversation/turn.js';
import type { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MockLlmProvider } from '../../src/services/ai/provider/mock-llm-provider.js';
import {
  AccessInfoResolver,
  createAccessInfoFetcher,
} from '../../src/services/knowledge-tables/access-info.js';
import { json, startFakeProvider, type FakeProvider } from '../helpers/fake-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const ADDRESS = 'https://giris7.ornek.com';

interface AccessView {
  id: string;
  brand_id: string | null;
  source_type: string;
  kb_source_id: string | null;
  url: string | null;
  cache_seconds: number;
  fixed_text: string | null;
  last_value: string | null;
  last_fetched_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

/** An access question is never a search: a turn that searched fails the test. */
const NO_KNOWLEDGE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('the turn searched the knowledge base');
    },
  },
) as KnowledgeService;

/** A one-message skill no question here is about — the agent's knowledge path stays open. */
async function storeRefunds(db: PrismaClient, licenseId: bigint, aiAgentId: string): Promise<void> {
  await db.skill.create({
    data: {
      licenseId,
      aiAgentId,
      name: 'İadeler',
      kind: 'ai_agent',
      steps: [
        { type: 'detect_intent', intent: 'refund', phrases: ['iade'] },
        { type: 'send_message', source: 'text', text: 'İadeler bir hafta sürer.' },
      ],
      active: true,
      updatedAt: new Date(),
    },
  });
}

// ===========================================================================
// 1. The setting
// ===========================================================================

describe('the access information setting — GET/PUT /ai-access-info (K13 · tm 310.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeA: string;
  let readA: string;
  let writeB: string;
  let aiAgentA: string;
  let brandA: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const token = (t: Fixtures['a'], scopes: string[]) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });
  const put = (body: unknown, as = writeA) =>
    server.app.inject({
      method: 'PUT',
      url: server.url('/ai-access-info'),
      payload: body as object,
      headers: auth(as),
    });
  const list = async (as = readA) => {
    const response = await server.app.inject({
      method: 'GET',
      url: server.url('/ai-access-info'),
      headers: auth(as),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: AccessView[] }).items;
  };
  const refusal = (response: { json: () => unknown }) =>
    (
      response.json() as {
        error: { type: string; details: { reason: string; problems: KnowledgeTableProblem[] } };
      }
    ).error;
  const problemsOf = (response: { json: () => unknown }) =>
    refusal(response).details.problems.map((problem) => `${problem.field}:${problem.code}`);

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
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
    writeA = await token(fx.a, ['agents-bot--all:rw']);
    readA = await token(fx.a, ['agents-bot--all:ro']);
    writeB = await token(fx.b, ['agents-bot--all:rw']);
    aiAgentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    brandA = (
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'A', slug: 'a', isDefault: true },
        select: { id: true },
      })
    ).id;
  });

  it('one setting for every brand and one per brand, each replaced whole', async () => {
    expect(await list()).toEqual([]);
    const first = await put({
      source_type: 'fixed_link',
      url: ADDRESS,
      fixed_text: ' Adresimiz: ',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      brand_id: null,
      source_type: 'fixed_link',
      url: ADDRESS,
      fixed_text: 'Adresimiz:',
      cache_seconds: 300,
      last_value: null,
      created_by: fx.a.ownerAccountId,
      updated_by: fx.a.ownerAccountId,
    });
    const brand = await put({
      brand_id: brandA,
      source_type: 'dynamic_url',
      url: 'https://api.ornek.com/adres.json',
      cache_seconds: 60,
    });
    expect(brand.statusCode).toBe(200);
    // Replaced whole: the fixed text left out is cleared, the row is the same.
    const again = await put({ source_type: 'fixed_link', url: 'https://yeni.ornek.com' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as AccessView).id).toBe((first.json() as AccessView).id);
    const items = await list();
    expect(
      items.map((item) => [item.brand_id, item.source_type, item.url, item.fixed_text]),
    ).toEqual([
      [null, 'fixed_link', 'https://yeni.ornek.com', null],
      [brandA, 'dynamic_url', 'https://api.ornek.com/adres.json', null],
    ]);
    expect(await owner.aiAccessInfo.count({ where: { licenseId: fx.a.licenseId } })).toBe(2);
  });

  it('refuses with every problem at once — fields, references and an internal host to fetch', async () => {
    const otherBrand = (
      await owner.brand.create({
        data: { licenseId: fx.b.licenseId, name: 'B', slug: 'b', isDefault: true },
        select: { id: true },
      })
    ).id;
    const response = await put({
      brand_id: otherBrand,
      source_type: 'kb_row',
      cache_seconds: 5,
      colour: 'red',
    });
    expect(response.statusCode).toBe(400);
    expect(refusal(response)).toMatchObject({
      type: 'validation',
      details: { reason: 'ai_access_info_invalid' },
    });
    expect(problemsOf(response)).toEqual([
      'colour:invalid',
      'kb_source_id:required',
      'cache_seconds:out_of_range',
      'brand_id:invalid',
    ]);

    for (const url of [
      'http://api.ornek.com/adres',
      'https://169.254.169.254/latest/meta-data',
      'https://127.0.0.1:6379/',
      'https://[::1]/',
      'https://localhost/adres',
      'https://10.0.0.8/adres',
    ]) {
      const refused = await put({ source_type: 'dynamic_url', url });
      expect(refused.statusCode, url).toBe(400);
      expect(problemsOf(refused), url).toEqual(['url:invalid']);
    }
    // Only said, never fetched: a fixed link may be plain http.
    expect(
      (await put({ source_type: 'fixed_link', url: 'http://giris.ornek.com' })).statusCode,
    ).toBe(200);
  });

  it('a knowledge source must be this workspace’s and the AI’s', async () => {
    const source = (licenseId: bigint, aiAgentId: string, audiences: string[]) =>
      owner.knowledgeSource.create({
        data: { licenseId, aiAgentId, type: 'faq', name: 'Adres', content: ADDRESS, audiences },
        select: { id: true },
      });
    const mine = await source(fx.a.licenseId, aiAgentA, ['ai_agent', 'copilot']);
    const copilotOnly = await source(fx.a.licenseId, aiAgentA, ['copilot']);
    const agentB = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, name: 'Bo', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    const theirs = await source(fx.b.licenseId, agentB.id, ['ai_agent']);
    expect((await put({ source_type: 'kb_row', kb_source_id: mine.id })).statusCode).toBe(200);
    for (const id of [copilotOnly.id, theirs.id, '0f0e0d0c-0000-4000-8000-000000000000']) {
      const refused = await put({ source_type: 'kb_row', kb_source_id: id });
      expect(problemsOf(refused)).toEqual(['kb_source_id:invalid']);
    }
  });

  it('a new URL or source type drops the last fetched value; the same URL keeps it', async () => {
    const saved = await put({ source_type: 'dynamic_url', url: 'https://api.ornek.com/a.json' });
    const id = (saved.json() as AccessView).id;
    const keep = async () =>
      owner.aiAccessInfo.update({
        where: { id },
        data: { lastValue: ADDRESS, lastFetchedAt: new Date() },
      });
    await keep();
    await put({
      source_type: 'dynamic_url',
      url: 'https://api.ornek.com/a.json',
      cache_seconds: 90,
    });
    expect(await owner.aiAccessInfo.findUniqueOrThrow({ where: { id } })).toMatchObject({
      lastValue: ADDRESS,
      cacheSeconds: 90,
    });
    await put({ source_type: 'dynamic_url', url: 'https://api.ornek.com/b.json' });
    expect(await owner.aiAccessInfo.findUniqueOrThrow({ where: { id } })).toMatchObject({
      lastValue: null,
      lastFetchedAt: null,
    });
    await keep();
    await put({ source_type: 'fixed_link', url: 'https://api.ornek.com/b.json' });
    expect((await owner.aiAccessInfo.findUniqueOrThrow({ where: { id } })).lastValue).toBeNull();
  });

  it('reads with :ro, writes with :rw; another workspace neither sees nor overwrites it (NFR-S4)', async () => {
    expect((await put({ source_type: 'fixed_link', url: ADDRESS }, readA)).statusCode).toBe(403);
    expect((await put({ source_type: 'fixed_link', url: ADDRESS })).statusCode).toBe(200);
    expect(await list(writeB)).toEqual([]);
    expect(
      (await put({ source_type: 'fixed_link', url: 'https://b.ornek.com' }, writeB)).statusCode,
    ).toBe(200);
    const [mine] = await list();
    expect(mine?.url).toBe(ADDRESS);
    expect(await owner.aiAccessInfo.count()).toBe(2);
  });
});

// ===========================================================================
// 2. The turn
// ===========================================================================

describe('an access question in a turn, against Postgres (K13 · G14 · tm 310.4)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let provider: FakeProvider;
  let fx: Fixtures;
  let aiAgentId: string;
  let brandA: string;
  let brandB: string;
  let clock = new Date('2026-10-21T10:00:00Z');
  let resolver: AccessInfoResolver;
  let engine: ConversationEngine;

  const tenant = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  function engineWith(access: AccessInfoResolver): ConversationEngine {
    return new ConversationEngine({
      llm: new MockLlmProvider(),
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      maxPromptChars: 16_000,
      knowledge: NO_KNOWLEDGE,
      access,
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    await app.$connect();
    provider = await startFakeProvider((_request, response) =>
      json(response, 200, { url: ADDRESS }),
    );
  });

  afterAll(async () => {
    await provider.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    clock = new Date('2026-10-21T10:00:00Z');
    provider.handle((_request, response) => json(response, 200, { url: ADDRESS }));
    provider.requests.length = 0;
    resolver = new AccessInfoResolver({
      fetcher: createAccessInfoFetcher(provider.http({ timeoutMs: 1_000 })),
      clock: () => clock,
      failureBackoffMs: 0,
    });
    engine = engineWith(resolver);
    const licenseId = fx.a.licenseId;
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    await storeRefunds(owner, licenseId, aiAgentId);
    brandA = (
      await owner.brand.create({
        data: { licenseId, name: 'A', slug: 'a', isDefault: true },
        select: { id: true },
      })
    ).id;
    brandB = (
      await owner.brand.create({
        data: { licenseId, name: 'B', slug: 'b' },
        select: { id: true },
      })
    ).id;
  });

  const access = (data: Record<string, unknown>, licenseId = fx.a.licenseId) =>
    owner.aiAccessInfo.create({ data: { licenseId, ...data } as never });

  async function connection(brandId: string | null = null): Promise<ConnectionRef> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: fx.a.licenseId,
        customerId: customer.id,
        brandId,
        localDay: new Date('2026-10-21T00:00:00Z'),
        dayTz: 'Europe/Istanbul',
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: fx.a.licenseId } });
    return { chatId, threadId };
  }

  async function turn(
    text: string,
    brandId: string | null = null,
    using: ConversationEngine = engine,
  ): Promise<TurnResult> {
    const ref = await connection(brandId);
    const read = await withTenant(app, tenant(), async (tx) => ({
      row:
        (await loadConversation(tx, ref)) ??
        (await openConversation(tx, ref, { configVersionId: null })),
      config: await readAndCompile.forTurn(tx, { aiAgentId: null, pinnedVersionId: null }),
    }));
    const state = toTurnState(read.row);
    const result = await using.runTurn(
      state,
      { text },
      {
        tenant: tenant(),
        db: (fn) => withTenant(app, tenant(), fn),
        now: new Date('2026-10-21T10:00:00Z'),
        mode: 'live',
        chatId: ref.chatId,
        brandId,
        configVersionId: null,
        config: read.config.pkg,
        toolStubs: {},
        timeZone: 'Europe/Istanbul',
        aiMode: 'ai',
      },
    );
    const patch = turnStatePatch(state, result.nextState);
    if (Object.keys(patch).length > 0) {
      await withTenant(app, tenant(), (tx) => saveConversation(tx, read.row, patch));
    }
    return result;
  }

  const handedOver = (result: TurnResult) =>
    result.sideEffects.filter((effect) => effect.kind === 'handoff');
  const accessLine = (result: TurnResult) =>
    result.decisions.log.find((line) => line.step === 'access_info')?.detail;

  it('a fixed link is said, and nothing else (K13 acceptance)', async () => {
    await access({ sourceType: 'fixed_link', url: ADDRESS, fixedText: 'Yeni giriş adresimiz:' });
    const result = await turn('site açılmıyor güncel adres nedir');
    // "yeni giriş adresimiz" is a G14 phrase: the workspace's own, so it goes as it is.
    expect(result.reply).toBe(`Yeni giriş adresimiz: ${ADDRESS}`);
    expect(result.decisions.outcome).toBe('answered');
    expect(handedOver(result)).toEqual([]);
    expect(result.decisions.guardrails?.hits ?? []).toEqual([]);
    expect(accessLine(result)).toBe(
      'answered from the access information (fixed_link, the fixed link)',
    );
    expect(provider.requests).toEqual([]);
  });

  it('a rule row’s value through its knowledge source (kb_row)', async () => {
    const rule = await owner.kbRule.create({
      data: {
        licenseId: fx.a.licenseId,
        key: 'guncel_adres',
        category: 'account',
        title: 'Güncel giriş adresi',
        valueText: ADDRESS,
      },
      select: { id: true },
    });
    const source = await owner.knowledgeSource.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        type: 'table_row',
        sourceTable: 'kb_rules',
        sourceRowId: rule.id,
        name: 'Güncel giriş adresi',
        content: `Kural (Hesap): Güncel giriş adresi.\nDeğer: ${ADDRESS}`,
      },
      select: { id: true },
    });
    await access({ sourceType: 'kb_row', kbSourceId: source.id });
    const result = await turn('Siteye giremiyorum');
    expect(result.reply).toBe(`Güncel giriş adresi: ${ADDRESS}`);
    expect(accessLine(result)).toBe(
      'answered from the access information (kb_row, its knowledge source)',
    );
  });

  it('the every-brand setting never says one brand’s source to another brand’s player', async () => {
    const source = await owner.knowledgeSource.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        type: 'faq',
        name: 'A adresi',
        content: `A markasının adresi ${ADDRESS}`,
        brandIds: [brandA],
      },
      select: { id: true },
    });
    await access({ sourceType: 'kb_row', kbSourceId: source.id });
    expect((await turn('güncel adres nedir', brandA)).reply).toBe(`A markasının adresi ${ADDRESS}`);
    for (const brandId of [brandB, null]) {
      const other = await turn('güncel adres nedir', brandId);
      expect(other.decisions.outcome).toBe('handed_off');
      expect(accessLine(other)).toBe(
        'no access information to give (source_not_served) — handed to a human',
      );
      expect(other.reply).not.toContain(ADDRESS);
    }
    await owner.knowledgeSource.delete({ where: { id: source.id } });
    expect(accessLine(await turn('güncel adres nedir', brandA))).toBe(
      'no access information to give (source_gone) — handed to a human',
    );
  });

  it('a brand’s own setting over the every-brand one', async () => {
    await access({ sourceType: 'fixed_link', url: 'https://tum.ornek.com' });
    await access({ brandId: brandA, sourceType: 'fixed_link', url: 'https://a.ornek.com' });
    expect((await turn('güncel adres nedir', brandA)).reply).toBe(
      'Güncel erişim bilgisi: https://a.ornek.com',
    );
    expect((await turn('güncel adres nedir', brandB)).reply).toBe(
      'Güncel erişim bilgisi: https://tum.ornek.com',
    );
  });

  it('a dynamic URL: fetched, said and kept; within the window not asked again', async () => {
    const setting = await access({
      sourceType: 'dynamic_url',
      url: `${provider.base}/adres.json`,
      cacheSeconds: 60,
    });
    const first = await turn('Siteniz açılmıyor, yeni adresiniz ne?');
    expect(first.reply).toBe(`Güncel erişim bilgisi: ${ADDRESS}`);
    expect(accessLine(first)).toBe(
      'answered from the access information (dynamic_url, fetched now)',
    );
    const kept = await owner.aiAccessInfo.findUniqueOrThrow({ where: { id: setting.id } });
    expect(kept.lastValue).toBe(ADDRESS);
    expect(kept.lastFetchedAt).toEqual(clock);
    // The cache is not a change of the setting.
    expect(kept.updatedAt).toEqual(setting.updatedAt);

    clock = new Date(clock.getTime() + 30_000);
    const second = await turn('site açılmıyor');
    expect(second.reply).toBe(`Güncel erişim bilgisi: ${ADDRESS}`);
    expect(accessLine(second)).toContain('the cached value');
    expect(provider.requests).toHaveLength(1);
  });

  it('a fetch that fails says the last known value; with none, a person answers (K13 acceptance)', async () => {
    const setting = await access({
      sourceType: 'dynamic_url',
      url: `${provider.base}/adres.json`,
      lastValue: 'https://eski.ornek.com',
      lastFetchedAt: new Date('2026-10-01T00:00:00Z'),
    });
    provider.handle((_request, response) => json(response, 503, {}));
    const stale = await turn('site açılmıyor');
    expect(stale.reply).toBe('Güncel erişim bilgisi: https://eski.ornek.com');
    expect(stale.decisions.outcome).toBe('answered');
    expect(accessLine(stale)).toBe(
      'answered from the access information (dynamic_url, the last known value) — the fetch failed (status)',
    );
    // A failed fetch keeps the last value as it was.
    expect(
      (await owner.aiAccessInfo.findUniqueOrThrow({ where: { id: setting.id } })).lastValue,
    ).toBe('https://eski.ornek.com');

    await owner.aiAccessInfo.update({
      where: { id: setting.id },
      data: { lastValue: null, lastFetchedAt: null },
    });
    provider.handle(() => new Promise<void>(() => {}));
    const none = await turn('güncel giriş linki nedir');
    expect(none.decisions.outcome).toBe('handed_off');
    expect(none.decisions.handoffReason).toBe('no_knowledge');
    expect(none.reply).toBe(
      'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.',
    );
    expect(handedOver(none)).toEqual([
      expect.objectContaining({ kind: 'handoff', team: null, reason: 'no_knowledge' }),
    ]);
    expect(accessLine(none)).toBe(
      'no access information to give (fetch_failed) — the fetch failed (timeout) — handed to a human',
    );
  });

  it('an internal URL is never fetched, whatever the row says (SSRF)', async () => {
    // Written past the API's own check: the fetch-time guard is the one that counts.
    const real = engineWith(new AccessInfoResolver({ failureBackoffMs: 0 }));
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'https://127.0.0.1:5433/',
      'https://localhost/adres',
    ]) {
      await owner.aiAccessInfo.deleteMany({ where: { licenseId: fx.a.licenseId } });
      await access({ sourceType: 'dynamic_url', url });
      const refused = await turn('site açılmıyor', null, real);
      expect(refused.decisions.outcome, url).toBe('handed_off');
      expect(accessLine(refused), url).toBe(
        'no access information to give (fetch_failed) — the fetch failed (blocked) — handed to a human',
      );
    }
    // …and with a last value, that is what is said.
    await owner.aiAccessInfo.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { lastValue: ADDRESS, lastFetchedAt: new Date('2026-01-01T00:00:00Z') },
    });
    expect((await turn('site açılmıyor', null, real)).reply).toBe(
      `Güncel erişim bilgisi: ${ADDRESS}`,
    );
  });

  it('no setting: an access question is handed over, and nothing is searched', async () => {
    const result = await turn('VPN ile mi girmem gerekiyor?');
    expect(result.decisions.outcome).toBe('handed_off');
    expect(result.decisions.unanswered).toMatchObject({
      policy: 'handoff',
      reason: 'nothing_answered',
    });
    expect(accessLine(result)).toBe(
      'no access information to give (no_setting) — handed to a human',
    );
  });

  it('reads under the tenant: another workspace’s setting is never the answer (NFR-S4)', async () => {
    await access({ sourceType: 'fixed_link', url: 'https://b.ornek.com' }, fx.b.licenseId);
    const result = await turn('güncel adres nedir');
    expect(result.reply).not.toContain('b.ornek.com');
    expect(accessLine(result)).toBe(
      'no access information to give (no_setting) — handed to a human',
    );
  });

  it('G14 still stops what the access information did not say', async () => {
    // The workspace's own text names a VPN: its words, its responsibility (K13).
    await access({
      sourceType: 'fixed_link',
      url: ADDRESS,
      fixedText: 'Erişim için VPN kullanabilirsiniz, adresimiz:',
    });
    expect((await turn('site açılmıyor')).reply).toBe(
      `Erişim için VPN kullanabilirsiniz, adresimiz: ${ADDRESS}`,
    );
    // A procedure that says it on its own is the safe text and a hand-over.
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Ayna',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'mirror', phrases: ['bonus kodu'] },
          { type: 'send_message', source: 'text', text: 'Alternatif link: https://ayna.ornek.com' },
        ],
        active: true,
        updatedAt: new Date(),
      },
    });
    const blocked = await turn('bonus kodu');
    expect(blocked.reply).toBe('Bilgilerinizi ilgili ekibimize iletiyorum.');
    expect(blocked.decisions.handoffReason).toBe('guardrail_output_block');
  });

  it('a procedure’s answer_from_knowledge step answers an access question the same way', async () => {
    await access({ sourceType: 'fixed_link', url: ADDRESS });
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Erişim',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'access', phrases: ['giremiyorum'] },
          { type: 'send_message', source: 'knowledge' },
        ],
        active: true,
        updatedAt: new Date(),
      },
    });
    const result = await turn('siteye giremiyorum');
    expect(result.reply).toBe(`Güncel erişim bilgisi: ${ADDRESS}`);
    expect(result.decisions.skillName).toBe('Erişim');
  });

  it('so does a procedure’s answer_from_knowledge part, and with nothing to say it hands over', async () => {
    const checked = validateProcedure({
      when_to_use: 'Oyuncu siteye erişemiyor ya da güncel adresi soruyor.',
      examples: ['site açılmıyor', 'güncel adres nedir'],
      steps: [{ id: 'cevap', type: 'answer_from_knowledge' }],
    });
    if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
    const { procedure: body, ...own } = splitSkillProcedure(checked.procedure);
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Site erişimi',
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
    const none = await turn('site açılmıyor');
    expect(none.decisions.skillName).toBe('Site erişimi');
    expect(none.decisions.outcome).toBe('handed_off');
    expect(none.decisions.log).toContainEqual({
      step: 'cevap',
      detail: 'no access information to give (no_setting) — handed to a human',
      ok: true,
    });

    await access({ sourceType: 'fixed_link', url: ADDRESS });
    const answered = await turn('site açılmıyor');
    expect(answered.reply).toContain(`Güncel erişim bilgisi: ${ADDRESS}`);
    expect(answered.decisions.log).toContainEqual({
      step: 'cevap',
      detail: 'answered from the access information (fixed_link, the fixed link)',
      ok: true,
    });
  });
});

// ===========================================================================
// 3. The live path
// ===========================================================================

describe('an access question on the live path (tm 310.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let provider: FakeProvider;
  let fx: Fixtures;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  beforeAll(async () => {
    owner = ownerClient();
    provider = await startFakeProvider((_request, response) =>
      json(response, 200, { message: `Yeni adresimiz ${ADDRESS}` }),
    );
    server = await startTestServer({}, { accessInfoHttp: provider.http({ timeoutMs: 1_000 }) });
  });

  afterAll(async () => {
    await server.close();
    await provider.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    await storeRefunds(owner, fx.a.licenseId, aiAgentId);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    const settings = await server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload: { assignment_mode: 'ai_first' },
      headers: auth(),
    });
    expect(settings.statusCode).toBe(200);
  });

  it('a visitor’s "site açılmıyor" is answered from the fetched value by the AI job worker', async () => {
    // The API refuses a loopback URL; the fake's name is public-looking and pinned to it.
    const saved = await server.app.inject({
      method: 'PUT',
      url: server.url('/ai-access-info'),
      payload: { source_type: 'dynamic_url', url: `${provider.base}/adres.json` },
      headers: auth(),
    });
    expect(saved.statusCode).toBe(200);
    const response = await server.post(
      '/customer/chat/events',
      { text: 'Merhaba, site açılmıyor' },
      await visitor(),
    );
    expect(response.statusCode).toBe(201);
    const { chat_id: chatId } = response.json() as { chat_id: string };
    const said = await owner.event.findMany({
      where: { chatId, authorType: 'bot', recipients: 'all' },
      orderBy: { createdAt: 'asc' },
      select: { text: true },
    });
    // "Yeni adresimiz" is a G14 phrase: the fetched value is the workspace's word.
    expect(said.map((event) => event.text)).toEqual([
      `Güncel erişim bilgisi: Yeni adresimiz ${ADDRESS}`,
    ]);
    expect(provider.requests.map((request) => request.path)).toEqual(['/adres.json']);
    const row = await owner.aiAccessInfo.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } });
    expect(row.lastValue).toBe(`Yeni adresimiz ${ADDRESS}`);
  });
});
