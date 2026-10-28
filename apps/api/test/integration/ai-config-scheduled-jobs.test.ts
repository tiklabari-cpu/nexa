/**
 * The AI configuration's two scheduled jobs (tm 316.6 · SiyahTuş analysis
 * AI-20-S4 · ADR-14b §2.8 (7), §2.10 (5)), against Postgres.
 *
 * `ai_scheduled_publish`: an approval with `publish_at` goes live once its time
 * has come — through the same publication an immediate approval makes, the
 * approval, the compliance pack and the base checked again at that moment; a
 * version withdrawn meanwhile is not published, one whose approval or pack no
 * longer holds is rejected with the system's reason and its people mailed, and
 * two overlapping passes publish it once.
 *
 * `knowledge_chunk_gc`: generations no version published go unless the draft
 * or an open version holds them; a range closed by a publication older than
 * the workspace's last five and thirty days goes unless a kept version names
 * it; a retired source left with nothing goes with it — and a rollback to a
 * version whose knowledge went is then refused.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_COMPLIANCE_PACK_SIZE, AI_COMPLIANCE_PACK_VERSION } from '@siyahtus/types';
import { ScheduledAiConfigPublisher } from '../../src/services/ai/config-schedule.js';
import { KnowledgeChunkCollector } from '../../src/services/ai/knowledge-chunk-gc.js';
import type { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

interface Version {
  id: string;
  label: string;
  seq: number | null;
  status: string;
  review_note: string | null;
  scheduled_at: string | null;
  published_by: string | null;
}

const APP_URL = process.env['DATABASE_APP_URL'];
const DAY = 86_400_000;

describe('AI configuration scheduled jobs (AI-20-S4 · tm 316.6)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let admin: { accountId: string; email: string; auth: Headers };
  let admin2: { accountId: string; email: string; auth: Headers };
  let seq = 0;
  const mailer = new MemoryMailer();
  const pushes: Array<{ action: string; payload: unknown }> = [];
  const publisher = {
    publish: async (_tenant: unknown, action: string, _to: unknown, payload: unknown) => {
      pushes.push({ action, payload });
    },
  } as unknown as RealtimePublisher;

  const scheduler = () =>
    new ScheduledAiConfigPublisher(app, {
      auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
      publisher,
      mailer,
      appUrl: 'https://panel.example.test',
    });
  const ours = <T extends { licenseId: string }>(tenants: T[]): T | undefined =>
    tenants.find((tenant) => tenant.licenseId === fx.a.licenseId.toString());

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  async function member(role: 'admin') {
    seq += 1;
    const email = `${role}-${seq}-${Date.now()}@example.test`;
    const account = await owner.account.create({
      data: { email, name: `Üye ${role} ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['agents-bot--all:rw'],
    });
    return { accountId: account.id, email, auth: { authorization: `Bearer ${token}` } };
  }

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    mailer.clear();
    pushes.length = 0;
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', tone: 'friendly' },
        select: { id: true },
      })
    ).id;
    admin = await member('admin');
    admin2 = await member('admin');
  });

  const agentRow = () =>
    owner.aiAgent.findUniqueOrThrow({
      where: { id: aiAgentId },
      select: { draftRevision: true, publishedVersionId: true },
    });

  /** A completed pre-publish run of the current draft revision that passed the pack. */
  async function packRun(): Promise<{ id: string }> {
    const revision = Number((await agentRow()).draftRevision);
    return owner.aiTestRun.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        configTarget: 'draft',
        draftRevision: revision,
        trigger: 'pre_publish',
        status: 'completed',
        scenarioCount: AI_COMPLIANCE_PACK_SIZE,
        passed: AI_COMPLIANCE_PACK_SIZE,
        failed: 0,
        compliancePackVersion: AI_COMPLIANCE_PACK_VERSION,
        compliancePassed: AI_COMPLIANCE_PACK_SIZE,
        complianceFailed: 0,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
      select: { id: true },
    });
  }

  let toneTurn = 0;
  /** Change the draft (a new tone each time), pass the pack and submit as `admin`. */
  async function submitted(): Promise<Version> {
    toneTurn += 1;
    const tone = toneTurn % 2 === 0 ? 'casual' : 'formal';
    const patched = await server.patch(`/ai-agents/${aiAgentId}`, { tone }, admin.auth);
    expect(patched.statusCode, patched.body).toBe(200);
    await packRun();
    const response = await server.post(
      '/ai/config/versions',
      { ai_agent_id: aiAgentId },
      admin.auth,
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { version: Version }).version;
  }

  const approve = (id: string, body: Record<string, unknown> = {}) =>
    server.post(`/ai/config/versions/${id}/approve`, body, admin2.auth);

  /** Submitted by `admin`, approved by `admin2` for an hour from now. */
  async function scheduled(): Promise<{ version: Version; at: Date }> {
    const version = await submitted();
    const at = new Date(Date.now() + 3_600_000);
    const response = await approve(version.id, { publish_at: at.toISOString() });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'approved', seq: null });
    return { version, at };
  }

  async function published(): Promise<Version> {
    const version = await submitted();
    const response = await approve(version.id);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Version;
  }

  const versionRow = (id: string) => owner.aiConfigVersion.findUniqueOrThrow({ where: { id } });

  describe('ai_scheduled_publish', () => {
    it('publishes an approved version once its time has come — not before — and announces it (AI-20 acceptance 6)', async () => {
      const { version, at } = await scheduled();

      const early = await scheduler().run({ now: new Date(at.getTime() - 1_000) });
      expect(ours(early.tenants)).toBeUndefined();
      expect((await versionRow(version.id)).status).toBe('approved');

      const report = await scheduler().run({ now: new Date(at.getTime() + 1_000) });
      expect(ours(report.tenants)).toMatchObject({
        due: 1,
        published: 1,
        refused: 0,
        skipped: 0,
        failed: 0,
      });
      const row = await versionRow(version.id);
      expect(row).toMatchObject({ status: 'published', publishedBy: admin2.accountId });
      expect(row.seq).not.toBeNull();
      expect((await agentRow()).publishedVersionId).toBe(version.id);

      // The same AI-21 row and audit entry as an immediate publication, by the job.
      const changes = await owner.aiConfigChange.findMany({
        where: { licenseId: fx.a.licenseId, entityId: version.id },
        orderBy: { at: 'asc' },
        select: { action: true, actorType: true, actorId: true },
      });
      expect(changes.map((change) => change.action)).toEqual([
        'submitted',
        'approved',
        'published',
      ]);
      expect(changes[2]).toMatchObject({ actorType: 'system', actorId: 'ai_scheduled_publish' });
      const audit = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'ai.config_published' },
        select: { actorType: true },
      });
      expect(audit).toEqual([{ actorType: 'system' }]);

      expect(pushes).toEqual([
        {
          action: 'ai_config_published',
          payload: expect.objectContaining({ ai_agent_id: aiAgentId, version_id: version.id }),
        },
      ]);

      // Published once: the next pass finds nothing due.
      const again = await scheduler().run({ now: new Date(at.getTime() + 60_000) });
      expect(ours(again.tenants)).toBeUndefined();
    });

    it('does not publish a scheduled version whose approval was withdrawn', async () => {
      const { version, at } = await scheduled();
      const withdrawn = await server.post(
        `/ai/config/versions/${version.id}/reject`,
        { note: 'Bekleyelim.' },
        admin2.auth,
      );
      expect(withdrawn.statusCode, withdrawn.body).toBe(200);

      const report = await scheduler().run({ now: new Date(at.getTime() + 1_000) });
      expect(ours(report.tenants)).toBeUndefined();
      expect(await versionRow(version.id)).toMatchObject({
        status: 'rejected',
        reviewNote: 'Bekleyelim.',
      });
      expect((await agentRow()).publishedVersionId).toBeNull();
      expect(pushes).toEqual([]);
    });

    it('two passes at once publish it once: the agent row lock makes the second find it published', async () => {
      const { version, at } = await scheduled();
      const now = new Date(at.getTime() + 1_000);

      const reports = await Promise.all([scheduler().run({ now }), scheduler().run({ now })]);
      const results = reports.map((report) => ours(report.tenants));
      expect(results.reduce((sum, result) => sum + (result?.published ?? 0), 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + (result?.failed ?? 0), 0)).toBe(0);

      const publications = await owner.aiConfigChange.count({
        where: { licenseId: fx.a.licenseId, entityId: version.id, action: 'published' },
      });
      expect(publications).toBe(1);
      expect(await owner.aiConfigVersion.count({ where: { aiAgentId, seq: { not: null } } })).toBe(
        1,
      );
      expect(pushes).toHaveLength(1);
    });

    it('rejects one whose approver can no longer publish it, and mails the submitter — not the suspended approver', async () => {
      const { version, at } = await scheduled();
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: admin2.accountId },
        },
        data: { suspended: true },
      });

      const report = await scheduler().run({ now: new Date(at.getTime() + 1_000) });
      expect(ours(report.tenants)).toMatchObject({ due: 1, published: 0, refused: 1, mailed: 1 });
      expect(await versionRow(version.id)).toMatchObject({
        status: 'rejected',
        reviewNote: 'approval_lapsed',
      });
      expect((await agentRow()).publishedVersionId).toBeNull();
      expect(pushes).toEqual([]);

      const mails = mailer.sent.filter((mail) => mail.kind === 'notification');
      expect(mails.map((mail) => mail.to)).toEqual([admin.email]);
      expect(mails[0]?.body).toContain('v1');
      expect(mails[0]?.body).toContain(
        `https://panel.example.test/app/playbook?view=versions&version=${version.id}`,
      );

      // Rejected once: nothing left to retry.
      const again = await scheduler().run({ now: new Date(at.getTime() + 60_000) });
      expect(ours(again.tenants)).toBeUndefined();
    });

    it('rejects one whose approver lost the publish row of the matrix since', async () => {
      const { version, at } = await scheduled();
      await owner.roleCapabilityOverride.create({
        data: {
          licenseId: fx.a.licenseId,
          role: 'admin',
          capability: 'ai.config.publish',
          value: 'off',
        },
      });

      const report = await scheduler().run({ now: new Date(at.getTime() + 1_000) });
      expect(ours(report.tenants)).toMatchObject({ refused: 1, published: 0 });
      expect(await versionRow(version.id)).toMatchObject({
        status: 'rejected',
        reviewNote: 'approval_lapsed',
      });
    });

    it('rejects one whose compliance pack is no longer current', async () => {
      const { version, at } = await scheduled();
      const row = await versionRow(version.id);
      await owner.aiTestRun.update({
        where: { id: row.testRunId! },
        data: { compliancePackVersion: AI_COMPLIANCE_PACK_VERSION + 1 },
      });

      const report = await scheduler().run({ now: new Date(at.getTime() + 1_000) });
      expect(ours(report.tenants)).toMatchObject({ refused: 1, published: 0, mailed: 2 });
      expect(await versionRow(version.id)).toMatchObject({
        status: 'rejected',
        reviewNote: 'compliance_pack',
      });
      expect(
        mailer.sent
          .filter((mail) => mail.kind === 'notification')
          .map((mail) => mail.to)
          .sort(),
      ).toEqual([admin.email, admin2.email].sort());
    });
  });

  describe('knowledge_chunk_gc', () => {
    const collect = (at: Date = new Date()) =>
      new KnowledgeChunkCollector(app).run({ now: at }).then((report) => ours(report.tenants));

    async function source(name: string, generation = 1) {
      const row = await owner.knowledgeSource.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          type: 'article',
          name,
          content: `${name} metni.`,
          chunkGeneration: generation,
        },
        select: { id: true },
      });
      return row.id;
    }

    async function chunks(sourceId: string, generation: number, count = 2) {
      for (let position = 0; position < count; position += 1) {
        await owner.$executeRaw`
          INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, position, generation)
          VALUES (gen_random_uuid(), ${sourceId}::uuid, ${fx.a.licenseId},
                  ${`parça ${generation}.${position}`}, ${position}, ${generation})`;
      }
    }

    const generations = async (sourceId: string) =>
      (
        await owner.knowledgeChunk.findMany({
          where: { sourceId },
          orderBy: [{ generation: 'asc' }, { position: 'asc' }],
          select: { generation: true },
        })
      ).map((chunk) => chunk.generation);

    it('drops a generation nobody published unless the draft or an open version holds it', async () => {
      const id = await source('Bonus kuralları');
      await chunks(id, 1);
      const open = await submitted();

      // The draft moves on to generation 2; the open version still names 1.
      await chunks(id, 2);
      await owner.knowledgeSource.update({ where: { id }, data: { chunkGeneration: 2 } });
      // A retired source nobody named.
      const retired = await source('Eski SSS');
      await chunks(retired, 1);
      await owner.knowledgeSource.update({
        where: { id: retired },
        data: { retiredAt: new Date() },
      });

      expect(await collect()).toMatchObject({ unpublished: 2, hidden: 0, sources: 1 });
      expect(await generations(id)).toEqual([1, 1, 2, 2]);
      expect(await owner.knowledgeSource.count({ where: { id: retired } })).toBe(0);

      // The open version is rejected: generation 1 is nobody's now; 2 is the draft's.
      const rejected = await server.post(`/ai/config/versions/${open.id}/reject`, {}, admin2.auth);
      expect(rejected.statusCode, rejected.body).toBe(200);
      expect(await collect()).toMatchObject({ unpublished: 2, sources: 0 });
      expect(await generations(id)).toEqual([2, 2]);
      expect(await collect()).toMatchObject({ unpublished: 0, hidden: 0, sources: 0 });
    });

    it('keeps a closed range for five publications and thirty days, then drops it and its retired source; a rollback to it is then refused', async () => {
      const kept = await source('Para çekme süreleri');
      await chunks(kept, 1);
      const gone = await source('Kaldırılan kampanya');
      await chunks(gone, 1);
      const v1 = await published();

      // v2 no longer has the campaign: its chunks close at v2.
      await owner.knowledgeSource.update({ where: { id: gone }, data: { retiredAt: new Date() } });
      const v2 = await published();
      const closed = await owner.knowledgeChunk.findMany({
        where: { sourceId: gone },
        select: { hiddenFromVersion: true },
      });
      expect(closed.map((chunk) => chunk.hiddenFromVersion)).toEqual([
        BigInt(v2.seq!),
        BigInt(v2.seq!),
      ]);

      const later = new Date(Date.now() + 31 * DAY);
      // Four publications after it: v2 is still among the last five.
      for (let i = 0; i < 4; i += 1) await published();
      expect(await collect(later)).toMatchObject({ hidden: 0, sources: 0 });
      expect(await generations(gone)).toEqual([1, 1]);

      // The fifth: v2 is older than the last five, but not yet thirty days.
      await published();
      expect(await collect()).toMatchObject({ hidden: 0, sources: 0 });
      expect(await generations(gone)).toEqual([1, 1]);

      // Thirty-one days on: the chunks go, then the retired source with nothing left.
      expect(await collect(later)).toMatchObject({ hidden: 2, sources: 1 });
      expect(await owner.knowledgeSource.count({ where: { id: gone } })).toBe(0);
      // The draft's source, open in every version, is untouched.
      expect(await generations(kept)).toEqual([1, 1]);

      const rollback = await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, admin.auth);
      expect(rollback.statusCode).toBe(409);
      expect((rollback.json() as { error: { details: unknown } }).error.details).toMatchObject({
        reason: 'knowledge_purged',
        source_ids: [gone],
      });
    });

    it("never touches another workspace's chunks", async () => {
      const otherAgent = await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Bea', kind: 'ai_agent', tone: 'friendly' },
        select: { id: true },
      });
      const other = await owner.knowledgeSource.create({
        data: {
          licenseId: fx.b.licenseId,
          aiAgentId: otherAgent.id,
          type: 'article',
          name: 'B kaynağı',
          content: 'B.',
          chunkGeneration: 2,
          retiredAt: new Date(),
        },
        select: { id: true },
      });
      await owner.$executeRaw`
        INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, position, generation)
        VALUES (gen_random_uuid(), ${other.id}::uuid, ${fx.b.licenseId}, 'B', 0, 1)`;

      const report = await new KnowledgeChunkCollector(app).run();
      const b = report.tenants.find((tenant) => tenant.licenseId === fx.b.licenseId.toString());
      // B's own pass collects B's — inside B's transaction, never A's.
      expect(b).toMatchObject({ unpublished: 1, sources: 1 });
      expect(ours(report.tenants)).toMatchObject({ unpublished: 0, sources: 0 });
    });
  });
});
