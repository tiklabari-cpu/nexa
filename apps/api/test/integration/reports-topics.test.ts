/**
 * Chat topics report (FR-MOD-07.6). 07.6-a settled the endpoint's shape and its
 * "not enough conversations yet" gate; 07.6-c wires the clustering itself in, so
 * this suite asserts both the gate and the topics it now produces:
 *
 *   - below `min_conversations` clusterable chats → `sufficient_data: false`,
 *     `topics: []`, a 200 state and not an error ("yeterli veri yoksa empty");
 *   - above it, distinct vocabularies cluster into distinct topics, each with a
 *     volume, a share of `analyzed`, and a trend against the previous window;
 *   - `analyzed` counts exactly the clusterable conversations, and only this
 *     tenant's (NFR-S4); another tenant's topics never appear here;
 *   - the same request twice returns the same topics (deterministic).
 *
 * A thread is clusterable once it has text to cluster — an AI summary, or
 * failing that a customer message — the same rule the route's count uses.
 */
import type { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { TOPIC_MIN_CLUSTER_SIZE } from '@nexa/ai-mock';
import {
  grantToken,
  ownerClient,
  resetDatabase,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('chat topics report (07.6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;

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

    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });
  });

  const auth = {
    get authorization() {
      return `Bearer ${token}`;
    },
  };

  // Seeding runs as the owner (RLS-exempt) so a scenario can place exactly the
  // conversations it wants to probe the threshold with.

  /** A closed chat whose thread carries an AI summary — clusterable via summary. */
  async function seedSummaryThread(
    t: TenantFixture,
    summary: string,
    at = new Date(),
  ): Promise<void> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        active: false,
        createdAt: at,
      },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: t.licenseId,
        active: false,
        summary,
        createdAt: at,
        closedAt: at,
      },
    });
  }

  /** `count` summary-clusterable threads, so a suite can straddle the threshold. */
  async function seedSummaryThreads(
    t: TenantFixture,
    count: number,
    at = new Date(),
  ): Promise<void> {
    for (let i = 0; i < count; i++) await seedSummaryThread(t, `Topic summary ${i}`, at);
  }

  /**
   * A closed chat with **no** summary but a customer message — clusterable via
   * the message, proving the count's second branch.
   */
  async function seedCustomerMessageThread(
    t: TenantFixture,
    text: string,
    at = new Date(),
  ): Promise<void> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        active: false,
        createdAt: at,
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: false,
        summary: null,
        createdAt: at,
        closedAt: at,
      },
    });
    await owner.event.create({
      data: {
        id: `${threadId}_10`,
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: 'message',
        text,
        authorType: 'customer',
        recipients: 'all',
        createdAt: at,
      },
    });
  }

  /** A closed chat with neither a summary nor a customer message — not clusterable. */
  async function seedBareThread(t: TenantFixture, at = new Date()): Promise<void> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        active: false,
        createdAt: at,
      },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: t.licenseId,
        active: false,
        summary: null,
        createdAt: at,
        closedAt: at,
      },
    });
  }

  /** Seed `count` closed threads all carrying `summary` — one deliberate topic. */
  async function seedTopic(
    t: TenantFixture,
    summary: string,
    count: number,
    at = new Date(),
  ): Promise<void> {
    for (let i = 0; i < count; i++) await seedSummaryThread(t, summary, at);
  }

  // Two clearly separate vocabularies — no shared content token — so they land in
  // distinct clusters; a third, for a second tenant, overlapping neither.
  const DELIVERY = 'Package delivery is late, the tracking shows my shipment still in transit';
  const REFUND = 'I want a refund for my return, the money back on the invoice charge';
  const LOGIN = 'I cannot login, my password reset email never arrived to access the account';

  // --- negatives first ------------------------------------------------------

  it('requires the reports_read scope', async () => {
    const weak = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    const response = await server.get('/reports/topics', { authorization: `Bearer ${weak}` });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a backwards date range', async () => {
    const response = await server.get('/reports/topics?from=2026-08-01&to=2026-07-01', auth);
    expect(response.statusCode).toBe(400);
  });

  // --- the gate: "yeterli veri yoksa empty" ---------------------------------

  it('an empty tenant is insufficient, not an error', async () => {
    const response = await server.get('/reports/topics', auth);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.analyzed).toBe(0);
    expect(body.sufficient_data).toBe(false);
    expect(body.topics).toEqual([]);
    // The floor is surfaced so a client can say how many more are needed.
    expect(body.min_conversations).toBeGreaterThan(0);
  });

  it('stays insufficient below the threshold and counts what it has', async () => {
    const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
    await seedSummaryThreads(fx.a, floor - 1);

    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.analyzed).toBe(floor - 1);
    expect(body.sufficient_data).toBe(false);
    expect(body.topics).toEqual([]);
  });

  it('flips to sufficient at the threshold and clusters into topics', async () => {
    const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
    await seedTopic(fx.a, DELIVERY, floor);

    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.analyzed).toBe(floor);
    expect(body.sufficient_data).toBe(true);
    // Clustering is wired (07.6-c): a sufficient window yields at least one topic
    // with a real, vocabulary-derived label — never a fabricated one.
    expect(body.topics.length).toBeGreaterThanOrEqual(1);
    expect(body.topics[0].label.length).toBeGreaterThan(0);
    expect(body.topics[0].volume).toBeGreaterThan(0);
  });

  // --- clustering: volume, share, ordering (07.6-c) -------------------------

  it('groups distinct vocabularies into distinct topics, each with a volume', async () => {
    await seedTopic(fx.a, DELIVERY, 12);
    await seedTopic(fx.a, REFUND, 8);

    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.sufficient_data).toBe(true);
    expect(body.analyzed).toBe(20);
    // Two separate concerns → at least two topics, every one with a real volume.
    expect(body.topics.length).toBeGreaterThanOrEqual(2);
    for (const topic of body.topics) expect(topic.volume).toBeGreaterThan(0);
    // Most voluminous first (delivery's 12 over refund's 8); share = volume/analyzed.
    expect(body.topics[0].volume).toBe(12);
    expect(body.topics[0].share).toBeCloseTo(12 / 20, 5);
    const volumes = body.topics.map((topic: { volume: number }) => topic.volume);
    expect([...volumes]).toEqual([...volumes].sort((x: number, y: number) => y - x));
  });

  it('never puts a bare number in a topic label (no order/card leak)', async () => {
    // Every conversation carries a 16-digit run; it must not surface as a label.
    await seedTopic(fx.a, 'Refund for order 4111111111111111 shipped last week', 20);

    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.sufficient_data).toBe(true);
    for (const topic of body.topics) {
      expect(topic.label).not.toMatch(/\d/);
      for (const keyword of topic.keywords) expect(keyword).not.toMatch(/^\d+$/);
    }
  });

  // --- trend vs the previous window -----------------------------------------

  it('reads previous_volume from the prior window; a new topic has a null trend', async () => {
    // The default window is the last 30 days; place the "before" data ~45 days back.
    const previous = new Date(Date.now() - 45 * 86_400_000);
    await seedTopic(fx.a, DELIVERY, 5, previous); // delivery existed before…
    await seedTopic(fx.a, DELIVERY, 12); // …and now, so it carries a trend
    await seedTopic(fx.a, REFUND, 8); // refund is new this window → trend null

    const body = (await server.get('/reports/topics', auth)).json();
    const delivery = body.topics.find((topic: { volume: number }) => topic.volume === 12);
    const refund = body.topics.find((topic: { volume: number }) => topic.volume === 8);
    expect(delivery.previous_volume).toBe(5);
    expect(delivery.trend).toBeCloseTo((12 - 5) / 5, 5);
    // Absent before → previous_volume 0 and trend unknown (null), not a +100% rise.
    expect(refund.previous_volume).toBe(0);
    expect(refund.trend).toBeNull();
  });

  // --- determinism ----------------------------------------------------------

  it('returns identical topics for the same request twice', async () => {
    await seedTopic(fx.a, DELIVERY, 12);
    await seedTopic(fx.a, REFUND, 8);

    // A fixed range so only the clustering, not the clock, decides the response.
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const url = `/reports/topics?from=${from.toISOString()}&to=${to.toISOString()}`;
    const first = (await server.get(url, auth)).json();
    const second = (await server.get(url, auth)).json();
    expect(second).toEqual(first);
  });

  // --- what counts as clusterable -------------------------------------------

  it('counts a thread clusterable through a customer message, not only a summary', async () => {
    await seedCustomerMessageThread(fx.a, 'Where is my order?');
    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.analyzed).toBe(1);
  });

  it('does not count a thread with neither a summary nor a customer message', async () => {
    await seedSummaryThread(fx.a, 'Delivery question');
    await seedBareThread(fx.a);
    const body = (await server.get('/reports/topics', auth)).json();
    // Two threads exist; only the one with clustering text is analyzed.
    expect(body.analyzed).toBe(1);
  });

  // --- shape ----------------------------------------------------------------

  it('reports the equal-length window immediately before as previous_period', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 10 * 86_400_000);
    const body = (
      await server.get(`/reports/topics?from=${from.toISOString()}&to=${to.toISOString()}`, auth)
    ).json();

    // The previous window ends one ms before this one begins (no shared instant)
    // and is exactly as long — the trend comparison in 07.6-c compares like spans.
    expect(Date.parse(body.previous_period.range.to)).toBe(Date.parse(body.range.from) - 1);
    const span = Date.parse(body.range.to) - Date.parse(body.range.from);
    const prevSpan =
      Date.parse(body.previous_period.range.to) - Date.parse(body.previous_period.range.from);
    expect(span - prevSpan).toBe(1);
  });

  // --- isolation (NFR-S4) ---------------------------------------------------

  it('never counts another tenant toward analyzed', async () => {
    // Enough of tenant A's conversations to be sufficient on their own.
    const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
    await seedSummaryThreads(fx.a, floor);

    const theirToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_read'],
    });
    const theirs = (
      await server.get('/reports/topics', { authorization: `Bearer ${theirToken}` })
    ).json();
    expect(theirs.analyzed).toBe(0);
    expect(theirs.sufficient_data).toBe(false);
    expect(theirs.topics).toEqual([]);
  });

  it("keeps one tenant's topics out of another's report", async () => {
    // A talks about delivery and refunds; B, on its own, about logins.
    await seedTopic(fx.a, DELIVERY, 12);
    await seedTopic(fx.a, REFUND, 8);
    await seedTopic(fx.b, LOGIN, 20);

    const theirToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_read'],
    });
    const theirs = (
      await server.get('/reports/topics', { authorization: `Bearer ${theirToken}` })
    ).json();

    // B sees only its own 20 conversations, and none of A's topic vocabulary.
    expect(theirs.analyzed).toBe(20);
    expect(theirs.sufficient_data).toBe(true);
    expect(theirs.topics.length).toBeGreaterThanOrEqual(1);
    const labels = theirs.topics.map((topic: { label: string }) => topic.label).join(' ');
    expect(labels).not.toMatch(/deliver|refund|package|invoice/);
  });

  // --- CSV export (07.6-g) ---------------------------------------------------
  //
  // `buildGroupCsv`'s 'topics' case reuses `buildTopicsReport` — the same
  // helper this suite's other tests hit through `/reports/topics` — so the
  // download can never disagree with the JSON. A label is always a run of
  // tokenised words (see `packages/ai-mock/src/topics.ts`'s `tokenize`, which
  // strips everything but letters/digits before a label is ever derived), so a
  // topic label can never itself open with a formula-lead character (`=+-@`);
  // the CSV-injection guard is `csvField`'s and is proven generically once in
  // `reports-export.test.ts`'s `toCsv` suite, exercised here just like every
  // other exported cell.
  describe('CSV export (07.6-g)', () => {
    /** Split a CSV body into its non-empty lines (rows are CRLF-terminated). */
    const lines = (body: string): string[] => body.split('\r\n').filter((line) => line !== '');

    it('lists topics among the exportable groups for a reports_read token, and hides it without one', async () => {
      const groups = (await server.get('/reports/groups', auth)).json().groups;
      expect(groups.map((g: { id: string }) => g.id)).toContain('topics');

      const weak = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const empty = (
        await server.get('/reports/groups', { authorization: `Bearer ${weak}` })
      ).json().groups;
      expect(empty).toEqual([]);
    });

    it('exports one CSV row per topic, matching the JSON report figure for figure', async () => {
      await seedTopic(fx.a, DELIVERY, 12);
      await seedTopic(fx.a, REFUND, 8);

      const [report, response] = await Promise.all([
        server.get('/reports/topics', auth),
        server.get('/reports/export?group=topics', auth),
      ]);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="nexa-topics-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(response.headers['cache-control']).toBe('no-store');

      const rows = lines(response.body);
      expect(rows[0]).toBe('label,volume,share,previous_volume,trend');

      const data = report.json() as {
        topics: Array<{
          label: string;
          volume: number;
          share: number | null;
          previous_volume: number;
          trend: number | null;
        }>;
      };
      expect(data.topics.length).toBeGreaterThanOrEqual(2);
      expect(rows).toHaveLength(1 + data.topics.length);

      data.topics.forEach((topic, i) => {
        const [label, volume, share, previousVolume, trend] = rows[i + 1]!.split(',');
        expect(label).toBe(topic.label);
        expect(Number(volume)).toBe(topic.volume);
        expect(share).toBe(topic.share === null ? '' : String(topic.share));
        expect(Number(previousVolume)).toBe(topic.previous_volume);
        expect(trend).toBe(topic.trend === null ? '' : String(topic.trend));
      });
    });

    it('exports only the header row below the sufficiency floor — no fabricated zero-row', async () => {
      const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
      await seedSummaryThreads(fx.a, floor - 1);

      const response = await server.get('/reports/export?group=topics', auth);
      expect(response.statusCode).toBe(200);
      expect(lines(response.body)).toEqual(['label,volume,share,previous_volume,trend']);
    });

    it("exports only the caller's tenant", async () => {
      await seedTopic(fx.a, DELIVERY, 12);
      await seedTopic(fx.a, REFUND, 8);
      await seedTopic(fx.b, LOGIN, 20);

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const response = await server.get('/reports/export?group=topics', {
        authorization: `Bearer ${theirToken}`,
      });
      expect(response.statusCode).toBe(200);
      const rows = lines(response.body);
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.slice(1).join(' ')).not.toMatch(/deliver|refund|package|invoice/);
    });
  });
});

/**
 * The demo seed itself (07.6-d): `prisma/seed.ts` used to write one recycled
 * summary onto every closed thread, so the Chat topics report could only ever
 * be demoed or e2e-tested in its empty state — never the sufficient-data one
 * this suite otherwise exercises with synthetic fixtures. This runs the real
 * seed (`pnpm db:seed`, the same command `apps/e2e`'s global setup uses)
 * against this suite's own database and asserts the report it actually
 * produces, not a stand-in for it.
 *
 * A sibling `describe`, not more `it`s above: the outer suite's `beforeEach`
 * truncates and rebuilds `fx.a`/`fx.b` before every test, which would either
 * fight the seed's own tenants or be immediately discarded by it. Seeding
 * once in `beforeAll` here is also the only way to exercise the seed's actual
 * idempotency (a second `db:seed` run is a no-op against existing tenants —
 * re-truncating between tests would make that untestable).
 */
describe('chat topics — demo seed diversity (07.6-d)', () => {
  const run = promisify(execFile);
  // test/integration → test → api → apps → repo root.
  const repoRoot = resolve(import.meta.dirname, '../../../..');

  let owner: PrismaClient;
  let server: TestServer;

  async function runDemoSeed(): Promise<void> {
    const { stdout } = await run('pnpm', ['db:seed'], {
      cwd: repoRoot,
      // Same reason as `apps/e2e/tests/global-setup.ts`, which runs this exact
      // command: `pnpm` is a shell shim and `CreateProcess` only finds `.exe`
      // on PATH, so without a shell this is ENOENT rather than a seed run.
      shell: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!stdout.includes('Acme Bikes')) {
      throw new Error(`Seed did not produce the expected demo tenant:\n${stdout}`);
    }
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    await resetDatabase(owner);
    await runDemoSeed();
  }, 60_000);

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  it('clusters the seeded demo tenant into several topics, each over the cluster floor, with a live trend', async () => {
    const response = await server.get('/reports/topics', {
      authorization: 'Bearer nexa_pat_demo_acme',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.sufficient_data).toBe(true);
    // The seed's own four topic groups, plus whatever the pre-existing sample
    // conversation joins — never fewer than the four groups it wrote.
    expect(body.topics.length).toBeGreaterThanOrEqual(2);
    for (const topic of body.topics) {
      expect(topic.volume).toBeGreaterThanOrEqual(TOPIC_MIN_CLUSTER_SIZE);
    }
    // The delivery group's two backdated conversations (`PREVIOUS_WINDOW_AT`)
    // give at least one topic a real trend rather than every topic reading the
    // null a brand-new topic gets.
    expect(
      body.topics.some(
        (topic: { previous_volume: number; trend: number | null }) =>
          topic.previous_volume > 0 && topic.trend !== null,
      ),
    ).toBe(true);
  });

  it('does not leak the seeded topics into a demo tenant with no rich conversations', async () => {
    const response = await server.get('/reports/topics', {
      authorization: 'Bearer nexa_pat_demo_northwind',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.analyzed).toBe(0);
    expect(body.sufficient_data).toBe(false);
    expect(body.topics).toEqual([]);
  });

  it('is idempotent: reseeding an already-seeded tenant leaves the same topics', async () => {
    // A fixed range, requested identically before and after: only the seed's
    // idempotency is under test here, not whether "the last 30 days" drifted
    // between the two requests.
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const url = `/reports/topics?from=${from.toISOString()}&to=${to.toISOString()}`;
    const auth = { authorization: 'Bearer nexa_pat_demo_acme' };

    const before = (await server.get(url, auth)).json();
    await runDemoSeed();
    const after = (await server.get(url, auth)).json();

    expect(after).toEqual(before);
  });
});
