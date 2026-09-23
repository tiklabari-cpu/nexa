/**
 * The knowledge-source freshness sweep (FR-MOD-06.3.3, "expiry + automatic
 * re-crawl" — tm 198.4).
 *
 * Three things have to hold, and each fails in a way invisible from the
 * outside if it does not:
 *
 *   1. **Only what is actually due moves.** A `website` source with no
 *      `refresh_after_days`, or one whose `next_refresh_at` has not arrived
 *      yet, must survive a pass completely untouched — content, chunks and
 *      `updated_at` alike. A sweep that "refreshes" everything it sees would
 *      pass every other test here and still be a bug.
 *   2. **A failed refresh must not look like data loss.** When the stored URL
 *      is refused by the SSRF guard, the old content and chunks have to
 *      survive exactly as `POST …/reindex` leaves them on the same refusal —
 *      only `last_refresh_error` moves, and the next attempt is still
 *      scheduled rather than abandoned.
 *   3. **RLS, not just a WHERE clause.** The sweep runs as `nexa_app`
 *      (`DATABASE_APP_URL`), the same role a request runs as, so a query that
 *      forgot to scope by tenant would be caught by the database refusing the
 *      row, not by a lucky test fixture.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveEmbeddingInferenceProvider } from '../../src/services/ai/inference.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MockEmbeddingProvider } from '../../src/services/ai/provider/mock-embedding-provider.js';
import type { TenantClient, TenantContext } from '../../src/lib/tenant.js';
import {
  KnowledgeRefreshSweeper,
  REFRESH_REFUSED_RESIDENCY,
} from '../../src/services/ai/knowledge-refresh-sweep.js';
import { EmbeddingProviderError } from '../../src/services/ai/provider/embedding-error.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface SourceView {
  id: string;
  chunk_count: number;
}

describe('knowledge-source freshness sweep (FR-MOD-06.3.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  const knowledge = new KnowledgeService({ embeddings: new MockEmbeddingProvider() });
  /** The sweep as the scheduler builds it: the stub, in this process's region. */
  const sweeper = () =>
    new KnowledgeRefreshSweeper(appRole, {
      knowledge,
      embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
    });

  const auth = async (tenant: 'a' | 'b') => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    })}`,
  });

  async function agentId(tenant: 'a' | 'b'): Promise<string> {
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx[tenant].licenseId, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    return agent.id;
  }

  async function createWebsite(
    tenant: 'a' | 'b',
    aiAgentId: string,
    url = 'https://help.example.com/refunds',
  ): Promise<SourceView> {
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: aiAgentId, name: 'Help centre', type: 'website', source_url: url },
      await auth(tenant),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  }

  /** Opts a source into automatic refresh and backdates it, so a sweep finds it overdue right away. */
  async function makeOverdue(id: string, refreshAfterDays = 30): Promise<void> {
    await owner.knowledgeSource.update({
      where: { id },
      data: { refreshAfterDays, nextRefreshAt: new Date(Date.now() - 60_000) },
    });
  }

  async function stored(id: string) {
    return owner.knowledgeSource.findUniqueOrThrow({
      where: { id },
      select: {
        content: true,
        updatedAt: true,
        refreshAfterDays: true,
        nextRefreshAt: true,
        lastRefreshError: true,
        licenseId: true,
      },
    });
  }

  async function chunkCount(id: string): Promise<number> {
    return owner.knowledgeChunk.count({ where: { sourceId: id } });
  }

  async function retrievedTexts(tenant: 'a' | 'b', question: string): Promise<string[]> {
    const context: TenantContext = {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
    };
    const hits = await knowledge.retrieve(
      owner as TenantClient,
      context,
      await knowledge.embedQuery(question),
      { limit: 10 },
    );
    return hits.map((hit) => hit.text);
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  it('refreshes an overdue website source and reports it in the tally', async () => {
    const source = await createWebsite('a', await agentId('a'));
    await makeOverdue(source.id);

    const report = await sweeper().run();

    expect(report.totals).toEqual({ tenants: 2, checked: 1, refreshed: 1, failed: 0 });
    const after = await stored(source.id);
    expect(after.lastRefreshError).toBeNull();
    expect(after.nextRefreshAt?.getTime()).toBeGreaterThan(Date.now());
    expect(await chunkCount(source.id)).toBeGreaterThan(0);
  });

  it('leaves a source with no schedule, and one not yet due, completely untouched', async () => {
    const neverScheduled = await createWebsite(
      'a',
      await agentId('a'),
      'https://help.example.com/a',
    );
    const notYetDue = await createWebsite('a', await agentId('a'), 'https://help.example.com/b');
    // Opted in, but the window has not elapsed — `next_refresh_at` is in the future.
    await owner.knowledgeSource.update({
      where: { id: notYetDue.id },
      data: {
        refreshAfterDays: 30,
        nextRefreshAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const before = await Promise.all([stored(neverScheduled.id), stored(notYetDue.id)]);

    const report = await sweeper().run();

    expect(report.totals).toEqual({ tenants: 2, checked: 0, refreshed: 0, failed: 0 });
    const after = await Promise.all([stored(neverScheduled.id), stored(notYetDue.id)]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
  });

  it('keeps the old content and chunks when the stored URL is refused, and records why', async () => {
    const source = await createWebsite('a', await agentId('a'));
    await makeOverdue(source.id);
    // The row now names a target the create path would have refused — the
    // same "not trusted just because it exists" scenario `reindex` covers.
    await owner.knowledgeSource.update({
      where: { id: source.id },
      data: { sourceUrl: 'http://169.254.169.254/latest/meta-data/' },
    });
    const before = await stored(source.id);
    const chunksBefore = await chunkCount(source.id);
    expect(chunksBefore).toBeGreaterThan(0);

    const report = await sweeper().run();

    expect(report.totals).toEqual({ tenants: 2, checked: 1, refreshed: 0, failed: 1 });
    const after = await stored(source.id);
    // The claim a failed refresh makes is about content and chunks, not the
    // row's own `updated_at` — `lastRefreshError` genuinely changed, and
    // Prisma's `@updatedAt` moves the timestamp for any write to the row,
    // exactly as it would for a real edit.
    expect(after.content).toBe(before.content);
    expect(await chunkCount(source.id)).toBe(chunksBefore);
    // Not left forever: the next attempt is still scheduled, just not now.
    expect(after.lastRefreshError).not.toBeNull();
    expect(after.nextRefreshAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('clears a stale error on the next successful pass', async () => {
    const source = await createWebsite('a', await agentId('a'));
    await makeOverdue(source.id);
    await owner.knowledgeSource.update({
      where: { id: source.id },
      data: { lastRefreshError: 'a previous attempt failed' },
    });

    await sweeper().run();

    expect((await stored(source.id)).lastRefreshError).toBeNull();
  });

  it('sweeps two tenants in one pass without crossing streams (RLS, not just a WHERE clause)', async () => {
    const sourceA = await createWebsite(
      'a',
      await agentId('a'),
      'https://help.example.com/refunds',
    );
    const sourceB = await createWebsite(
      'b',
      await agentId('b'),
      'https://help.example.com/warranty',
    );
    await makeOverdue(sourceA.id);
    await makeOverdue(sourceB.id);

    const report = await sweeper().run();

    expect(report.totals).toEqual({ tenants: 2, checked: 2, refreshed: 2, failed: 0 });
    const byLicense = new Map(report.tenants.map((t) => [t.licenseId, t]));
    expect(byLicense.get(fx.a.licenseId.toString())).toMatchObject({ checked: 1, refreshed: 1 });
    expect(byLicense.get(fx.b.licenseId.toString())).toMatchObject({ checked: 1, refreshed: 1 });

    // Each tenant's retrieval still finds only its own refreshed page.
    const foundA = (await retrievedTexts('a', 'refunds')).join(' ');
    const foundB = (await retrievedTexts('b', 'warranty')).join(' ');
    expect(foundA).toContain('refunds');
    expect(foundA).not.toContain('warranty');
    expect(foundB).toContain('warranty');
    expect(foundB).not.toContain('refunds');
  });

  /**
   * The embedding provider is the refresh's second way to fail (tm 255.7), and
   * it is held to the first one's promise: a refresh that did not land keeps
   * the old text and chunks, and says why. Where a covered workspace's content
   * may not go, it does not go — no request carries this work, so the sweep
   * asks the residency rule itself (NFR-C4).
   */
  describe('when the embedding provider cannot take the refresh (FR-MOD-06.3.2)', () => {
    it('keeps the old content and chunks when the provider fails, and records why', async () => {
      const source = await createWebsite('a', await agentId('a'));
      await makeOverdue(source.id);
      const before = await stored(source.id);
      const chunksBefore = await chunkCount(source.id);
      const failing = new FakeEmbeddingProvider({ fail: new EmbeddingProviderError('timeout') });

      const report = await new KnowledgeRefreshSweeper(appRole, {
        knowledge: new KnowledgeService({ embeddings: failing }),
        embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
      }).run();

      expect(report.totals).toEqual({ tenants: 2, checked: 1, refreshed: 0, failed: 1 });
      expect(failing.calls).toHaveLength(1);
      const after = await stored(source.id);
      expect(after.content).toBe(before.content);
      expect(await chunkCount(source.id)).toBe(chunksBefore);
      expect(after.lastRefreshError).toBe(
        'Not refreshed: the embedding provider did not answer (timeout). The previous text still answers.',
      );
      expect(after.nextRefreshAt?.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not send a covered workspace’s content to an out-of-region provider (NFR-C4)', async () => {
      // A workspace under a signed BAA — which only a US workspace can hold
      // (`licenses_baa_requires_us_region`) — with an overdue website source.
      const organization = await owner.organization.create({
        data: { name: 'Covered', region: 'us' },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: {
          organizationId: organization.id,
          plan: 'growth',
          status: 'active',
          hipaaBaaSignedAt: new Date(),
        },
        select: { id: true },
      });
      const agent = await owner.aiAgent.create({
        data: { licenseId: license.id, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      });
      const content = 'Appointments can be moved up to a day in advance.';
      const source = await owner.knowledgeSource.create({
        data: {
          aiAgentId: agent.id,
          licenseId: license.id,
          type: 'website',
          name: 'Clinic',
          sourceUrl: 'https://help.example.com/appointments',
          content,
        },
        select: { id: true },
      });
      await knowledge.index(
        owner as TenantClient,
        { licenseId: license.id, organizationId: organization.id },
        source.id,
        await knowledge.prepare(content),
      );
      await makeOverdue(source.id);
      const chunksBefore = await chunkCount(source.id);
      const embeddings = new FakeEmbeddingProvider();

      const report = await new KnowledgeRefreshSweeper(appRole, {
        knowledge: new KnowledgeService({ embeddings }),
        embeddingInference: { id: 'openai', region: 'eu' },
      }).run();

      const covered = report.tenants.find((t) => t.licenseId === license.id.toString());
      expect(covered).toMatchObject({ checked: 1, refreshed: 0, failed: 1 });
      // Not crawled into, not embedded, not touched — only the reason moves.
      expect(embeddings.calls).toHaveLength(0);
      const after = await stored(source.id);
      expect(after.content).toBe(content);
      expect(await chunkCount(source.id)).toBe(chunksBefore);
      expect(after.lastRefreshError).toBe(REFRESH_REFUSED_RESIDENCY);
    });
  });
});
