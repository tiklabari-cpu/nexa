/**
 * The knowledge chunks' clean-up (tm 316.6 · SiyahTuş analysis AI-20 ·
 * ADR-14b `docs/adr/ai-config-versioning.md` §2.8 (7)). The scheduler's
 * `knowledge_chunk_gc` job.
 *
 * Since versioning, indexing and deleting a source no longer delete chunks a
 * version may answer from (§2.8 (1)): a re-index writes a new generation, a
 * source taken out of the draft is retired, a publication closes the ranges
 * it no longer shows. Something has to take them away in the end; this does,
 * per workspace:
 *
 *   - **never published** — a generation no version opened (`visible_from`
 *     null) that is not the draft's (a retired source, or one the draft moved
 *     past while an open version named it and that version was then rejected);
 *   - **long hidden** — a chunk whose range was closed by a publication older
 *     than the workspace's last {@link KNOWLEDGE_GC_KEEP_VERSIONS}
 *     publications, and more than {@link KNOWLEDGE_GC_HIDDEN_DAYS} days ago;
 *   - **a retired source left with no chunks** — its row goes too.
 *
 * And never, whatever the above says:
 *
 *   - the draft's chunks — a source not retired, its current generation (the
 *     simulation answers from them, and a publication may copy them);
 *   - a generation named in the manifest of an open version (it publishes
 *     them), of a version in production, or of one of each agent's last
 *     {@link KNOWLEDGE_GC_KEEP_VERSIONS} publications — the ones a rollback is
 *     expected to reach. An older one whose chunks are gone is refused by the
 *     rollback with `knowledge_purged`, which is what that reason is for.
 *
 * Concurrency: the pass takes the workspace's customer-facing agents' rows
 * `FOR NO KEY UPDATE` first — every review step (submit, approve, publish,
 * rollback) takes one of them `FOR UPDATE`, so none of them reads a manifest or
 * counts chunks while this deletes; the AI's own writes, which only reference
 * the agent, are not held up. Then the sources it would touch, `SKIP LOCKED`:
 * one being indexed right now is left for the next pass rather than waited on,
 * and an index that starts after waits for this transaction on the source's
 * row (`KnowledgeService.index`). The predicates are evaluated again inside
 * each `DELETE`, under those locks.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { AI_CONFIG_OPEN_VERSION_STATUSES } from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';

/** Publications whose knowledge is kept for a rollback — per agent, and the age floor's workspace count. */
export const KNOWLEDGE_GC_KEEP_VERSIONS = 5;

/** How long a closed range is kept after the publication that closed it. */
export const KNOWLEDGE_GC_HIDDEN_DAYS = 30;

const DAY_MS = 86_400_000;

export interface TenantKnowledgeGcResult {
  licenseId: string;
  /** Chunks of generations no version ever published. */
  unpublished: number;
  /** Chunks hidden by a publication past both limits. */
  hidden: number;
  /** Retired sources deleted once nothing was left of them. */
  sources: number;
  /** Sources left alone because another transaction held them. */
  busy: number;
}

export interface KnowledgeGcReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantKnowledgeGcResult[];
  totals: { tenants: number; unpublished: number; hidden: number; sources: number; busy: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class KnowledgeChunkCollector {
  readonly #db: PrismaClient;
  readonly #keepVersions: number;
  readonly #hiddenDays: number;

  constructor(db: PrismaClient, options: { keepVersions?: number; hiddenDays?: number } = {}) {
    this.#db = db;
    this.#keepVersions = options.keepVersions ?? KNOWLEDGE_GC_KEEP_VERSIONS;
    this.#hiddenDays = options.hiddenDays ?? KNOWLEDGE_GC_HIDDEN_DAYS;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<KnowledgeGcReport> {
    const startedAt = new Date().toISOString();
    const now = options.now ?? new Date();
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    const results: TenantKnowledgeGcResult[] = [];
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const context: TenantContext = {
        licenseId: tenant.license_id,
        organizationId: tenant.organization_id,
      };
      results.push(await withTenant(this.#db, context, (tx) => this.#collect(tx, context, now)));
    }
    const sum = (pick: (r: TenantKnowledgeGcResult) => number) =>
      results.reduce((total, r) => total + pick(r), 0);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        unpublished: sum((r) => r.unpublished),
        hidden: sum((r) => r.hidden),
        sources: sum((r) => r.sources),
        busy: sum((r) => r.busy),
      },
    };
  }

  async #collect(
    tx: TenantClient,
    context: TenantContext,
    now: Date,
  ): Promise<TenantKnowledgeGcResult> {
    const licenseId = context.licenseId;
    const result: TenantKnowledgeGcResult = {
      licenseId: licenseId.toString(),
      unpublished: 0,
      hidden: 0,
      sources: 0,
      busy: 0,
    };

    // The review line waits for this pass (and this pass for it).
    await tx.$queryRaw`
      SELECT id FROM ai_agents
       WHERE license_id = ${licenseId} AND kind = 'ai_agent'
       ORDER BY id
         FOR NO KEY UPDATE`;

    // The fifth newest publication of the workspace: a range closed before it is old enough.
    const floorRows = await tx.$queryRaw<Array<{ seq: bigint }>>`
      SELECT seq FROM ai_config_versions
       WHERE license_id = ${licenseId} AND seq IS NOT NULL
       ORDER BY seq DESC
      OFFSET ${this.#keepVersions - 1} LIMIT 1`;
    const floor = floorRows[0]?.seq ?? null;
    const cutoff = new Date(now.getTime() - this.#hiddenDays * DAY_MS);

    const kept = keptGenerations(licenseId, this.#keepVersions);
    const unpublished = Prisma.sql`c.visible_from_version IS NULL`;
    const hidden =
      floor === null
        ? Prisma.sql`FALSE`
        : Prisma.sql`c.hidden_from_version < ${floor}::bigint
            AND EXISTS (SELECT 1 FROM ai_config_versions h
                         WHERE h.license_id = ${licenseId}
                           AND h.seq = c.hidden_from_version
                           AND h.published_at < ${cutoff})`;
    const collectable = (which: Prisma.Sql) => Prisma.sql`
          c.license_id = ${licenseId}
      AND NOT (s.retired_at IS NULL AND c.generation = s.chunk_generation)
      AND NOT EXISTS (SELECT 1 FROM kept k
                       WHERE k.source_id = c.source_id AND k.generation = c.generation)
      AND (${which})`;

    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      WITH kept AS (${kept})
      SELECT DISTINCT c.source_id::text AS id
        FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id
       WHERE ${collectable(Prisma.sql`${unpublished} OR (${hidden})`)}
      UNION
      SELECT s.id::text FROM knowledge_sources s
       WHERE s.license_id = ${licenseId} AND s.retired_at IS NOT NULL`;
    if (candidates.length === 0) return result;

    const locked = (
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM knowledge_sources
         WHERE id = ANY (${candidates.map((row) => row.id)}::uuid[])
           FOR NO KEY UPDATE SKIP LOCKED`
    ).map((row) => row.id);
    result.busy = candidates.length - locked.length;
    if (locked.length === 0) return result;

    const deleteChunks = (which: Prisma.Sql) => tx.$executeRaw`
      WITH kept AS (${kept})
      DELETE FROM knowledge_chunks c
       USING knowledge_sources s
       WHERE s.id = c.source_id
         AND c.source_id = ANY (${locked}::uuid[])
         AND ${collectable(which)}`;
    result.unpublished = await deleteChunks(unpublished);
    result.hidden = await deleteChunks(hidden);

    result.sources = await tx.$executeRaw`
      WITH kept AS (${kept})
      DELETE FROM knowledge_sources s
       WHERE s.license_id = ${licenseId}
         AND s.id = ANY (${locked}::uuid[])
         AND s.retired_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.source_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.source_id = s.id)`;
    return result;
  }
}

/**
 * The `(source_id, generation)` pairs no clean-up may take: those named by an
 * open version, the version in production, or one of each agent's last
 * `keep` publications. The migration's baseline v1 holds `{}`, not a list,
 * and names nothing.
 */
function keptGenerations(licenseId: bigint, keep: number): Prisma.Sql {
  return Prisma.sql`
    SELECT (e.entry->>'source_id')::uuid AS source_id,
           (e.entry->>'generation')::int AS generation
      FROM (SELECT v.status, v.knowledge_manifest,
                   -- Publications only: an open version is kept by its status.
                   CASE WHEN v.seq IS NOT NULL
                        THEN row_number() OVER (PARTITION BY v.ai_agent_id, v.seq IS NULL
                                                ORDER BY v.seq DESC)
                   END AS recent
              FROM ai_config_versions v
             WHERE v.license_id = ${licenseId}
               AND v.status <> 'rejected') r,
           jsonb_array_elements(CASE WHEN jsonb_typeof(r.knowledge_manifest) = 'array'
                                     THEN r.knowledge_manifest
                                     ELSE '[]'::jsonb END) AS e(entry)
     WHERE r.status = ANY (${[...AI_CONFIG_OPEN_VERSION_STATUSES, 'published']}::text[])
        OR r.recent <= ${keep}`;
}
