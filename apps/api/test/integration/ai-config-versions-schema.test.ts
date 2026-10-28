/**
 * AI configuration versions, the schema half (tm 316.1 · SiyahTuş analysis
 * AI-20 · ADR-14b `docs/adr/ai-config-versioning.md` §2.3, §2.8; migration
 * 20261115090000_ai_config_versions).
 *
 * Nothing reads a version yet — the workflow (316.2), the compiler (316.5)
 * and the run time (316.3) come next. What is pinned here is what they lean on:
 *
 *   - **The backfill.** Every customer-facing agent that existed is bound to a
 *     published v1 (`seq` 1, the baseline package); Copilot is not versioned.
 *   - **A published package never changes.** Its package, manifest, hash and
 *     record are frozen by trigger, except the baseline's one seal; a status
 *     only moves forward; one open and one published version per agent.
 *   - **The workspace's own.** RLS, and the agent, base version and test run a
 *     version names are looked up as the writer — a foreign key alone would
 *     accept another workspace's ids.
 *   - **Chunk ranges.** A visibility range is opened once, closed once, never
 *     reopened; a chunk's generation never changes; a new chunk waits for a
 *     publication.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_CONFIG_PACKAGE_FORMAT_BASELINE, AI_CONFIG_VERSION_STATUSES } from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import { snapshotConfigRow } from '../../src/services/ai/config-history.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const MIGRATION = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261115090000_ai_config_versions/migration.sql',
    import.meta.url,
  ),
);

const EMPTY_HASH = createHash('sha256').update('{}', 'utf8').digest('hex');

/** The migration's marked backfill, held to the given licences. */
function backfill(licenseIds: readonly bigint[]): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const section = sql.slice(sql.indexOf('-- backfill:begin'), sql.indexOf('-- backfill:end'));
  const scope = `a.license_id IN (${licenseIds.join(', ')}) AND a.kind = 'ai_agent'`;
  const scoped = section.replaceAll("a.kind = 'ai_agent'", scope);
  expect(scoped.split(scope)).toHaveLength(3);
  return scoped;
}

/** A closed (`rejected`) version written raw, so a trigger's refusal keeps its text. */
function insertVersion(
  tx: TenantClient,
  licenseId: bigint,
  aiAgentId: string,
  data: { number: number; rollbackOf?: string },
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO ai_config_versions
      (id, license_id, ai_agent_id, number, status, snapshot, snapshot_hash, package_format,
       draft_revision, rollback_of)
    VALUES (gen_random_uuid(), ${licenseId}, ${aiAgentId}::uuid, ${data.number}, 'rejected', '{}',
            ${'b'.repeat(64)}, 1, 0, ${data.rollbackOf ?? null}::uuid)`;
}

/** What the statement threw, or null when it went through. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('AI configuration versions — schema (AI-20 · tm 316.1)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let agentA: string;
  let agentB: string;
  let copilotA: string;

  const asA = <T>(fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(appRole, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, fn);
  const asB = <T>(fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(appRole, { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId }, fn);

  /** Replays the backfill for both workspaces; returns A's baseline. */
  const baseline = async () => {
    for (const statement of backfill([fx.a.licenseId, fx.b.licenseId]).split(';')) {
      const body = statement
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim();
      if (body) await owner.$executeRawUnsafe(body);
    }
    return owner.aiConfigVersion.findFirstOrThrow({ where: { aiAgentId: agentA } });
  };

  /** An open version of A's agent, written as the workspace would. */
  const submit = (data: { number?: number; status?: string } = {}) =>
    asA((tx) =>
      tx.aiConfigVersion.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: agentA,
          number: data.number ?? 2,
          status: data.status ?? 'in_review',
          snapshot: { agent: { tone: 'friendly' } },
          snapshotHash: 'a'.repeat(64),
          packageFormat: 1,
          draftRevision: 3n,
          submittedAt: new Date(),
        },
      }),
    );

  beforeAll(() => {
    owner = ownerClient();
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    const agent = (licenseId: bigint, kind: string, name: string) =>
      owner.aiAgent.create({ data: { licenseId, kind, name }, select: { id: true } });
    agentA = (await agent(fx.a.licenseId, 'ai_agent', 'Ada')).id;
    agentB = (await agent(fx.b.licenseId, 'ai_agent', 'Bea')).id;
    copilotA = (await agent(fx.a.licenseId, 'copilot', 'Copilot')).id;
  });

  // ==========================================================================

  describe('the backfill', () => {
    it('binds every customer-facing agent to a published v1 — Copilot gets none', async () => {
      const v1 = await baseline();
      expect(v1).toMatchObject({
        licenseId: fx.a.licenseId,
        number: 1,
        minor: 0,
        seq: 1n,
        status: 'published',
        snapshot: {},
        snapshotHash: EMPTY_HASH,
        packageFormat: AI_CONFIG_PACKAGE_FORMAT_BASELINE,
        knowledgeManifest: [],
        draftRevision: 0n,
        baseVersionId: null,
        submittedBy: null,
        reviewedBy: null,
        publishedBy: null,
      });
      // toMatchObject reads {} as "any object"; the package is the empty one.
      expect(v1.snapshot).toEqual({});
      expect(v1.publishedAt).toBeInstanceOf(Date);

      const agents = await owner.aiAgent.findMany({
        where: { id: { in: [agentA, agentB, copilotA] } },
        select: { id: true, publishedVersionId: true, publishedVersion: { select: { seq: true } } },
      });
      const byId = new Map(agents.map((row) => [row.id, row]));
      expect(byId.get(agentA)?.publishedVersionId).toBe(v1.id);
      // Each licence's first: `seq` is per licence.
      expect(byId.get(agentB)?.publishedVersion?.seq).toBe(1n);
      expect(byId.get(copilotA)?.publishedVersionId).toBeNull();
      expect(await owner.aiConfigVersion.count({ where: { aiAgentId: copilotA } })).toBe(0);

      // Run again, nothing more: an agent already pointing somewhere keeps it.
      await baseline();
      expect(await owner.aiConfigVersion.count({ where: { aiAgentId: agentA } })).toBe(1);
    });

    it('the CHECK is the status list; a new agent starts at draft revision 0', async () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql).toContain(
        `CHECK (status IN (\n    ${AI_CONFIG_VERSION_STATUSES.map((s) => `'${s}'`).join(', ')}\n  ))`,
      );
      const row = await owner.aiAgent.findUniqueOrThrow({
        where: { id: agentA },
        select: { draftRevision: true, publishedVersionId: true },
      });
      expect(row).toEqual({ draftRevision: 0n, publishedVersionId: null });
    });

    it('a chunk written now waits for a publication; the column default that opened the old ones is gone', async () => {
      const source = await owner.knowledgeSource.create({
        data: { licenseId: fx.a.licenseId, aiAgentId: agentA, type: 'faq', name: 'SSS' },
      });
      expect(source).toMatchObject({ chunkGeneration: 1, retiredAt: null });
      const chunk = await owner.knowledgeChunk.create({
        data: { sourceId: source.id, licenseId: fx.a.licenseId, chunkText: 'Para çekme 24 saat.' },
      });
      expect(chunk).toMatchObject({
        generation: 1,
        visibleFromVersion: null,
        hiddenFromVersion: null,
      });
      const [column] = await owner.$queryRaw<Array<{ value: string | null }>>`
        SELECT column_default AS value FROM information_schema.columns
         WHERE table_name = 'knowledge_chunks' AND column_name = 'visible_from_version'`;
      expect(column?.value).toBeNull();
    });
  });

  // ==========================================================================

  describe('the workspace’s own', () => {
    it('RLS hides another workspace’s versions; a version for its agent, or for Copilot, is refused', async () => {
      await baseline();
      expect(await asA((tx) => tx.aiConfigVersion.count())).toBe(1);
      expect(await asB((tx) => tx.aiConfigVersion.count())).toBe(1);
      expect(await asB((tx) => tx.aiConfigVersion.count({ where: { aiAgentId: agentA } }))).toBe(0);

      // Raw: Prisma reports the trigger's foreign_key_violation as P2003, without its text.
      const write = (aiAgentId: string) =>
        asA((tx) => insertVersion(tx, fx.a.licenseId, aiAgentId, { number: 2 }));
      expect(await refusal(() => write(agentB))).toMatch(/not this workspace's customer-facing/);
      expect(await refusal(() => write(copilotA))).toMatch(/not this workspace's customer-facing/);
    });

    it('a base version, a rolled-back version or a test run of another workspace is refused', async () => {
      await baseline();
      const foreign = await owner.aiConfigVersion.findFirstOrThrow({
        where: { aiAgentId: agentB },
      });
      const foreignRun = await owner.aiTestRun.create({
        data: {
          licenseId: fx.b.licenseId,
          aiAgentId: agentB,
          configTarget: 'draft',
          trigger: 'manual',
        },
      });
      const open = await submit();
      const set = (column: string, value: string) =>
        asA((tx) =>
          tx.$executeRawUnsafe(
            `UPDATE ai_config_versions SET ${column} = $1::uuid WHERE id = $2::uuid`,
            value,
            open.id,
          ),
        );
      expect(await refusal(() => set('base_version_id', foreign.id))).toMatch(/base version/);
      expect(await refusal(() => set('test_run_id', foreignRun.id))).toMatch(/test run/);
      const rollback = await refusal(() =>
        asA((tx) =>
          insertVersion(tx, fx.a.licenseId, agentA, { number: 3, rollbackOf: foreign.id }),
        ),
      );
      expect(rollback).toMatch(/rolled-back version/);

      // Its own test run is fine, and its deletion leaves the version, unlinked.
      const run = await owner.aiTestRun.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: agentA,
          configTarget: 'draft',
          trigger: 'manual',
        },
      });
      expect(await set('test_run_id', run.id)).toBe(1);
      await owner.aiTestRun.delete({ where: { id: run.id } });
      expect(
        (await owner.aiConfigVersion.findUniqueOrThrow({ where: { id: open.id } })).testRunId,
      ).toBeNull();
    });

    it('the pointer names only one of its own published versions', async () => {
      const v1 = await baseline();
      const open = await submit();
      const point = (versionId: string, agentId = agentA) =>
        asA(
          (tx) =>
            tx.$executeRaw`
              UPDATE ai_agents SET published_version_id = ${versionId}::uuid WHERE id = ${agentId}::uuid`,
        );
      expect(await refusal(() => point(open.id))).toMatch(/is not a published version/);
      // Copilot's row cannot borrow the customer-facing agent's version.
      expect(await refusal(() => point(v1.id, copilotA))).toMatch(/is not a published version/);
      expect(await refusal(() => point(v1.id))).toBeNull();
    });

    it('the workspace may read, write and update a version but never delete one; the root panel only reads', async () => {
      const privileges = await owner.$queryRaw<Array<Record<string, boolean>>>`
        SELECT has_table_privilege('siyahtus_app', 'ai_config_versions', 'SELECT') AS app_select,
               has_table_privilege('siyahtus_app', 'ai_config_versions', 'INSERT') AS app_insert,
               has_table_privilege('siyahtus_app', 'ai_config_versions', 'UPDATE') AS app_update,
               has_table_privilege('siyahtus_app', 'ai_config_versions', 'DELETE') AS app_delete,
               has_table_privilege('siyahtus_app', 'ai_config_versions', 'TRUNCATE') AS app_truncate,
               has_table_privilege('siyahtus_platform', 'ai_config_versions', 'SELECT') AS platform_select,
               has_table_privilege('siyahtus_platform', 'ai_config_versions', 'UPDATE') AS platform_update`;
      expect(privileges[0]).toEqual({
        app_select: true,
        app_insert: true,
        app_update: true,
        app_delete: false,
        app_truncate: false,
        platform_select: true,
        platform_update: false,
      });
    });

    it('the versions go with their agent, pointer and all', async () => {
      const v1 = await baseline();
      await owner.aiConfigVersion.update({
        where: { id: v1.id },
        data: { status: 'superseded' },
      });
      const v2 = await owner.aiConfigVersion.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: agentA,
          number: 2,
          seq: 2n,
          status: 'published',
          snapshot: { agent: {} },
          snapshotHash: 'd'.repeat(64),
          packageFormat: 1,
          draftRevision: 1n,
          baseVersionId: v1.id,
          publishedAt: new Date(),
        },
      });
      await owner.aiAgent.update({ where: { id: agentA }, data: { publishedVersionId: v2.id } });
      await owner.aiAgent.delete({ where: { id: agentA } });
      expect(await owner.aiConfigVersion.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });
  });

  // ==========================================================================

  describe('a published package never changes', () => {
    it('the baseline is sealed once with its compiled package, then frozen', async () => {
      const v1 = await baseline();
      const write = (sql: string, ...values: unknown[]) =>
        refusal(() =>
          asA((tx) =>
            tx.$executeRawUnsafe(
              `UPDATE ai_config_versions SET ${sql} WHERE id = $1::uuid`,
              v1.id,
              ...values,
            ),
          ),
        );
      // Not without a format: an unsealed baseline's package is empty by CHECK.
      expect(await write(`snapshot = '{"agent": {}}'`)).toMatch(/never changes|baseline_check/);
      expect(
        await write(
          `package_format = 1, snapshot = '{"agent": {"tone": "warm"}}', snapshot_hash = $2,
           knowledge_manifest = '[{"source_id": "s", "generation": 1}]'`,
          'e'.repeat(64),
        ),
      ).toBeNull();
      expect(await write(`snapshot = '{"agent": {"tone": "cold"}}'`)).toMatch(
        /a published package never changes/,
      );
      expect(await write(`knowledge_manifest = '[]'`)).toMatch(/a published package never changes/);
      expect(await write(`snapshot_hash = $2`, 'f'.repeat(64))).toMatch(
        /a published package never changes/,
      );
      expect(await write(`package_format = 0`)).toMatch(/a published package never changes/);
      expect(await write(`seq = 7`)).toMatch(/a published version's record never changes/);
      expect(await write(`published_at = now() - interval '1 day'`)).toMatch(
        /a published version's record never changes/,
      );
      expect(await write(`draft_revision = 9`)).toMatch(
        /a published version's record never changes/,
      );
      expect(await write(`number = 4`)).toMatch(/identity never changes/);
      // What is not the package may still be written: the review note.
      expect(await write(`review_note = 'Kurucu onayı arşivde.'`)).toBeNull();
    });

    it('a status only moves forward', async () => {
      const v1 = await baseline();
      const status = (id: string, to: string) =>
        refusal(() =>
          asA(
            (tx) =>
              tx.$executeRaw`UPDATE ai_config_versions SET status = ${to} WHERE id = ${id}::uuid`,
          ),
        );
      expect(await status(v1.id, 'in_review')).toMatch(/status published cannot become in_review/);
      const open = await submit();
      expect(await status(open.id, 'approved')).toBeNull();
      expect(await status(open.id, 'in_review')).toBeNull(); // approval withdrawn
      expect(await status(open.id, 'rejected')).toBeNull();
      expect(await status(open.id, 'in_review')).toMatch(/status rejected cannot become/);
      expect(await status(v1.id, 'superseded')).toBeNull();
      expect(await status(v1.id, 'published')).toMatch(/status superseded cannot become/);
    });

    it('one open and one published version per agent; a published one has its order', async () => {
      const v1 = await baseline();
      const open = await submit();
      expect(await refusal(() => submit({ number: 3 }))).toMatch(/Unique constraint|unique/i);
      expect(await refusal(() => submit({ number: 3, status: 'approved' }))).toMatch(
        /Unique constraint|unique/i,
      );

      const publish = (seq: bigint | null) =>
        refusal(() =>
          asA((tx) =>
            tx.aiConfigVersion.update({
              where: { id: open.id },
              data: { status: 'published', seq, publishedAt: new Date() },
            }),
          ),
        );
      expect(await publish(null)).toMatch(/ai_config_versions_seq_check/);
      // v1 still published: the publish transaction supersedes it first.
      expect(await publish(2n)).toMatch(/Unique constraint|unique/i);
      await asA((tx) =>
        tx.aiConfigVersion.update({ where: { id: v1.id }, data: { status: 'superseded' } }),
      );
      // `seq` is the licence's order, so it cannot repeat v1's.
      expect(await publish(1n)).toMatch(/Unique constraint|unique/i);
      expect(await publish(2n)).toBeNull();
    });

    it('the baseline is the migration’s v1 and nothing else', async () => {
      const write = (number: number, snapshot: object) =>
        refusal(() =>
          owner.aiConfigVersion.create({
            data: {
              licenseId: fx.a.licenseId,
              aiAgentId: agentA,
              number,
              status: 'in_review',
              snapshot,
              snapshotHash: EMPTY_HASH,
              packageFormat: AI_CONFIG_PACKAGE_FORMAT_BASELINE,
              draftRevision: 0n,
            },
          }),
        );
      expect(await write(2, {})).toMatch(/ai_config_versions_baseline_check/);
      expect(await write(1, { agent: {} })).toMatch(/ai_config_versions_baseline_check/);
    });
  });

  // ==========================================================================

  describe('chunk ranges', () => {
    let chunkId: string;

    beforeEach(async () => {
      const source = await owner.knowledgeSource.create({
        data: { licenseId: fx.a.licenseId, aiAgentId: agentA, type: 'faq', name: 'SSS' },
      });
      chunkId = (
        await owner.knowledgeChunk.create({
          data: { sourceId: source.id, licenseId: fx.a.licenseId, chunkText: 'Bonus çevrimi 10x.' },
        })
      ).id;
    });

    const set = (sql: string) =>
      refusal(() =>
        asA((tx) =>
          tx.$executeRawUnsafe(`UPDATE knowledge_chunks SET ${sql} WHERE id = $1::uuid`, chunkId),
        ),
      );

    it('a range is opened once, closed once, and never reopened', async () => {
      expect(await set('hidden_from_version = 4')).toMatch(/knowledge_chunks_visibility_check/);
      expect(await set('visible_from_version = 3')).toBeNull();
      expect(await set('visible_from_version = 3')).toBeNull(); // the same value is no move
      expect(await set('visible_from_version = 2')).toMatch(
        /opened visibility range is never moved/,
      );
      expect(await set('hidden_from_version = 3')).toMatch(/knowledge_chunks_visibility_check/);
      expect(await set('hidden_from_version = 5')).toBeNull();
      expect(await set('hidden_from_version = NULL')).toMatch(/never reopened/);
      expect(await set('hidden_from_version = 6')).toMatch(/never reopened/);
      expect(await set('generation = 2')).toMatch(/generation never changes/);
      // Re-embedding rewrites the vector's row in place, untouched by the guard.
      expect(await set(`embedding_space = 'mock:lexical-v2'`)).toBeNull();
    });
  });

  // ==========================================================================

  describe('the change history', () => {
    it('does not record versioning’s own counters and pointer as configuration', async () => {
      await baseline();
      const source = await owner.knowledgeSource.create({
        data: { licenseId: fx.a.licenseId, aiAgentId: agentA, type: 'faq', name: 'SSS' },
      });
      const [agent, kept] = await asA(async (tx) => [
        await snapshotConfigRow(tx, 'ai_agents', agentA),
        await snapshotConfigRow(tx, 'knowledge_sources', source.id),
      ]);
      expect(agent).toMatchObject({ name: 'Ada' });
      expect(agent).not.toHaveProperty('draft_revision');
      expect(agent).not.toHaveProperty('published_version_id');
      expect(kept).not.toHaveProperty('chunk_generation');
      // Taking a source out of the draft is a change of the configuration.
      expect(kept).toHaveProperty('retired_at', null);
    });
  });
});
