/**
 * The unresolved questions' clustering (tm 317.2 · SiyahTuş analysis AI-22
 * §3–§8, AI-22-S2) — the scheduler's `ai_unresolved_cluster` job, every 15
 * minutes, and `ai_unresolved_merge`, nightly. Per workspace:
 *
 *   1. **Embed** the items that have no vector in the deployment's space
 *      (`EmbeddingProvider.space`): the turn's search reuses its own and costs
 *      nothing here; the rest (a hand-over before any search, an abandoned
 *      conversation, a space the deployment moved off) go in one batch,
 *      counted on the workspace's embedding allowance as `cluster` (AI-22 §3),
 *      only where the workspace's content may go to that provider (NFR-C4).
 *   2. **Rebuild** a cluster of an old space once all its items are in the new
 *      one (AI-16 re-embedding): its centre is their mean in the new space; it
 *      keeps its title, counts and state. A cluster whose items are all gone
 *      stays as it was — its title and counts are the record.
 *   3. **Assign** the unclustered items, oldest first, per agent: the nearest
 *      centre at τ or above (`UNRESOLVED_CLUSTER_SIMILARITY`, by kind of space)
 *      or a new cluster (`assign.ts`). The counts are the job's to keep —
 *      `item_count`, `handoff_count` (a hand-over reason, or a connection the
 *      AI handed over), `abandon_count`, `post_fix_count` (after the fix) —
 *      because the items' words go in 90 days and the counts stay.
 *      An ignored cluster still gathers and counts; it only never alarms.
 *   4. **Title** a cluster when it opens and when it has grown by half
 *      (`label.ts`): the `fast` model where it may run, the lexical labeller
 *      where it may not.
 *   5. **Count** the last seven days (`count_7d`).
 *   6. **Reopen** a fixed cluster that gathered `UNRESOLVED_REOPEN_AFTER_FIX`
 *      items since its fix, and say so.
 *   7. **Alarm** when a cluster gathered the workspace's threshold
 *      (`ai_unresolved_settings`, `UNRESOLVED_SPIKE_THRESHOLD_DEFAULT`) in the
 *      last `UNRESOLVED_SPIKE_WINDOW_MINUTES`: one UPDATE claims
 *      `alerted_at`, so a cluster alarms once in `UNRESOLVED_ALERT_REPEAT_HOURS`
 *      however many processes look.
 *
 * The notices (`ai_unresolved_alert`) go to the workspace's Team Leads and up —
 * admin and up until RL-01, as for a risk flag — in the console: a title and
 * numbers, never an item's words.
 *
 * The nightly pass merges the clusters the greedy pass split
 * (`planMerges`, `UNRESOLVED_MERGE_SIMILARITY`); {@link mergeUnresolvedClusters}
 * is the one merge, the report's "merge" (tm 317.3) included.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { toVectorLiteral } from '@siyahtus/ai-mock';
import {
  UNRESOLVED_ALERT_REPEAT_HOURS,
  UNRESOLVED_CLUSTER_BATCH,
  UNRESOLVED_CLUSTER_SIMILARITY,
  UNRESOLVED_HANDOFF_REASONS,
  UNRESOLVED_LABEL_SAMPLES,
  UNRESOLVED_MERGE_SIMILARITY,
  UNRESOLVED_RECENT_DAYS,
  UNRESOLVED_REOPEN_AFTER_FIX,
  UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
  UNRESOLVED_SPIKE_WINDOW_MINUTES,
  unresolvedSpaceKind,
  type AiUnresolvedAlertPush,
  type UnresolvedClusterStatus,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../../lib/tenant.js';
import type { RealtimePublisher } from '../../realtime/publisher.js';
import { AiDailyCapError } from '../ai-daily-budget.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from '../inference.js';
import type { MeteredEmbeddings } from '../metered-embeddings.js';
import { MeteredLlm } from '../metered-llm.js';
import { refuseOverlongPrompt, type LlmProvider } from '../provider/llm-provider.js';
import { completeStructured } from '../provider/structured-output.js';
import {
  assignToClusters,
  parseVector,
  planMerges,
  type ClusterableItem,
  type ClusterCentre,
} from './assign.js';
import {
  buildUnresolvedLabelPrompt,
  lexicalUnresolvedLabel,
  readUnresolvedLabelReply,
  UNRESOLVED_LABEL_MAX_OUTPUT_TOKENS,
  UNRESOLVED_LABEL_RESPONSE_FORMAT,
  type UnresolvedClusterTitle,
} from './label.js';

/** The roles told of a surge (AI-22's Team Lead and up: admin and up until RL-01). */
export const UNRESOLVED_ALERT_ROLES = ['owner', 'viceowner', 'admin'] as const;

/** Clusters titled per workspace and pass — the model is asked at most this often. */
export const UNRESOLVED_LABELS_PER_PASS = 50;

/** The other questions a lexical title is told apart from. */
const LEXICAL_CORPUS = 200;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface UnresolvedClusteringLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const SILENT: UnresolvedClusteringLogger = { info() {}, warn() {}, error() {} };

export interface UnresolvedClusteringOptions {
  /** The deployment's embeddings, metered: the space clusters live in. */
  readonly embeddings: MeteredEmbeddings;
  /** The model that writes titles; `mock` writes none (the lexical labeller does). */
  readonly llm: LlmProvider | MeteredLlm;
  /** `LLM_MAX_OUTPUT_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_MAX_PROMPT_CHARS`. */
  readonly llmLimits: { maxOutputTokens: number; timeoutMs: number; maxPromptChars: number };
  /** Where each provider runs (`resolveInferenceProvider`, `resolveEmbeddingInferenceProvider`). */
  readonly llmInference: InferenceProvider;
  readonly embeddingInference: InferenceProvider;
  /** The console's notices; null where nothing listens. */
  readonly publisher: RealtimePublisher | null;
  readonly logger?: UnresolvedClusteringLogger;
}

export interface UnresolvedClusterTotals {
  tenants: number;
  embedded: number;
  rebuilt: number;
  assigned: number;
  opened: number;
  labelled: number;
  reopened: number;
  alerted: number;
}

export interface UnresolvedClusterReport {
  tenants: Array<{ licenseId: string } & Omit<UnresolvedClusterTotals, 'tenants'>>;
  totals: UnresolvedClusterTotals;
}

export interface UnresolvedMergeReport {
  totals: { tenants: number; merged: number; absorbed: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/** What one pass learned about the deployment: a cap that refused it refuses every workspace. */
interface PassState {
  embeddingCapped: boolean;
  llmCapped: boolean;
}

/** The workspaces, read through the shared SECURITY DEFINER enumerator (`retention.ts`'s). */
async function listTenants(db: PrismaClient): Promise<TenantContext[]> {
  const rows = await db.$queryRaw<TenantRow[]>`
    SELECT license_id, organization_id FROM retention_list_tenants()`;
  return rows.map((row) => ({ licenseId: row.license_id, organizationId: row.organization_id }));
}

export class UnresolvedClusterer {
  readonly #db: PrismaClient;
  readonly #options: UnresolvedClusteringOptions;
  readonly #log: UnresolvedClusteringLogger;

  constructor(db: PrismaClient, options: UnresolvedClusteringOptions) {
    this.#db = db;
    this.#options = options;
    this.#log = options.logger ?? SILENT;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<UnresolvedClusterReport> {
    const now = options.now ?? new Date();
    const pass: PassState = { embeddingCapped: false, llmCapped: false };
    const tenants: UnresolvedClusterReport['tenants'] = [];
    for (const tenant of await listTenants(this.#db)) {
      if (options.signal?.aborted) break;
      try {
        const result = await this.clusterTenant(tenant, now, pass);
        tenants.push({ licenseId: tenant.licenseId.toString(), ...result });
      } catch (error) {
        this.#log.error(
          {
            err: error,
            event: 'ai.unresolved_cluster_failed',
            license_id: tenant.licenseId.toString(),
          },
          'unresolved questions could not be clustered; the next pass tries again',
        );
      }
    }
    const sum = (key: keyof Omit<UnresolvedClusterTotals, 'tenants'>) =>
      tenants.reduce((total, row) => total + row[key], 0);
    return {
      tenants,
      totals: {
        tenants: tenants.length,
        embedded: sum('embedded'),
        rebuilt: sum('rebuilt'),
        assigned: sum('assigned'),
        opened: sum('opened'),
        labelled: sum('labelled'),
        reopened: sum('reopened'),
        alerted: sum('alerted'),
      },
    };
  }

  /** One workspace's pass — steps 1–7 of the file header. */
  async clusterTenant(
    tenant: TenantContext,
    now: Date,
    pass: PassState = { embeddingCapped: false, llmCapped: false },
  ): Promise<Omit<UnresolvedClusterTotals, 'tenants'>> {
    const result = {
      embedded: 0,
      rebuilt: 0,
      assigned: 0,
      opened: 0,
      labelled: 0,
      reopened: 0,
      alerted: 0,
    };
    const present = await withTenant(this.#db, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ items: boolean; clusters: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM ai_unresolved_items) AS items,
               EXISTS (SELECT 1 FROM ai_unresolved_clusters) AS clusters`;
      return row ?? { items: false, clusters: false };
    });
    if (!present.items && !present.clusters) return result;

    const space = this.#options.embeddings.space;
    if (present.items) {
      result.embedded = await this.#embedPending(tenant, space, pass);
      result.rebuilt = await withTenant(this.#db, tenant, (tx) => rebuildClusters(tx, space));
      const assigned = await this.#assign(tenant, space);
      result.assigned = assigned.assigned;
      result.opened = assigned.opened;
      result.labelled = await this.#label(tenant, space, pass);
    }
    await withTenant(this.#db, tenant, (tx) => countRecent(tx, now));
    const reopened = await withTenant(this.#db, tenant, (tx) => reopenFixed(tx, now));
    result.reopened = reopened.length;
    const spikes = await withTenant(this.#db, tenant, (tx) => claimSpikes(tx, now));
    result.alerted = spikes.length;
    if (reopened.length > 0 || spikes.length > 0) {
      await this.#announce(tenant, [...reopened, ...spikes]);
    }
    return result;
  }

  /** Step 1: vectors for the items that have none in `space`. */
  async #embedPending(tenant: TenantContext, space: string, pass: PassState): Promise<number> {
    const pending = await withTenant(
      this.#db,
      tenant,
      (tx) => tx.$queryRaw<Array<{ id: string; text_masked: string }>>`
        SELECT id::text, text_masked FROM ai_unresolved_items
         WHERE embedding_space IS DISTINCT FROM ${space}
         ORDER BY created_at, id
         LIMIT ${UNRESOLVED_CLUSTER_BATCH}`,
    );
    if (pending.length === 0 || pass.embeddingCapped) return 0;
    const embeddings = this.#options.embeddings;
    if (!(await this.#mayInfer(tenant, this.#options.embeddingInference))) return 0;
    let vectors: number[][];
    try {
      vectors = (
        await embeddings.embed(
          pending.map((row) => row.text_masked),
          tenant,
          { surface: 'cluster' },
        )
      ).vectors;
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        if (error.scope !== 'workspace') pass.embeddingCapped = true;
        return 0;
      }
      this.#log.warn(
        {
          err: error,
          event: 'ai.unresolved_embed_failed',
          license_id: tenant.licenseId.toString(),
        },
        'unresolved questions could not be embedded; the next pass tries again',
      );
      return 0;
    }
    await withTenant(this.#db, tenant, async (tx) => {
      for (const [index, row] of pending.entries()) {
        await tx.$executeRaw`
          UPDATE ai_unresolved_items
             SET embedding = CAST(${toVectorLiteral(vectors[index]!)} AS vector),
                 embedding_space = ${space}
           WHERE id = ${row.id}::uuid`;
      }
    });
    return pending.length;
  }

  /** Step 3: the unclustered items with a vector in `space`, per agent. */
  async #assign(
    tenant: TenantContext,
    space: string,
  ): Promise<{ assigned: number; opened: number }> {
    const threshold = UNRESOLVED_CLUSTER_SIMILARITY[unresolvedSpaceKind(space)];
    return withTenant(this.#db, tenant, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          ai_agent_id: string;
          thread_id: string;
          reason: string;
          text_masked: string;
          created_at: Date;
          vector: string;
        }>
      >`
        SELECT id::text, ai_agent_id::text, thread_id, reason, text_masked, created_at,
               embedding::text AS vector
          FROM ai_unresolved_items
         WHERE cluster_id IS NULL AND embedding_space = ${space}
         ORDER BY created_at, id
         LIMIT ${UNRESOLVED_CLUSTER_BATCH}`;
      if (rows.length === 0) return { assigned: 0, opened: 0 };

      const threads = [...new Set(rows.map((row) => row.thread_id))];
      const handedOver = new Set(
        (
          await tx.$queryRaw<Array<{ thread_id: string }>>`
            SELECT DISTINCT thread_id FROM ai_handoffs WHERE thread_id = ANY(${threads})`
        ).map((row) => row.thread_id),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      const agents = [...new Set(rows.map((row) => row.ai_agent_id))].sort();

      let assigned = 0;
      let opened = 0;
      for (const agentId of agents) {
        const mine = rows.filter((row) => row.ai_agent_id === agentId);
        const centres = (
          await tx.$queryRaw<Array<{ id: string; centroid: string; item_count: number }>>`
            SELECT id::text, centroid::text, item_count FROM ai_unresolved_clusters
             WHERE ai_agent_id = ${agentId}::uuid AND embedding_space = ${space}
               AND centroid IS NOT NULL
             ORDER BY first_seen, id`
        ).map((row): ClusterCentre => ({
          id: row.id,
          centroid: parseVector(row.centroid),
          weight: row.item_count,
        }));
        const items = mine.map((row): ClusterableItem => ({
          id: row.id,
          createdAt: row.created_at,
          vector: parseVector(row.vector),
        }));
        const outcome = assignToClusters(items, centres, threshold, randomUUID);
        const members = new Map<string, string[]>();
        for (const assignment of outcome.assignments) {
          members.set(assignment.clusterId, [
            ...(members.get(assignment.clusterId) ?? []),
            assignment.itemId,
          ]);
        }
        const others = mine.map((row) => row.text_masked);
        for (const clusterId of outcome.opened) {
          const ids = members.get(clusterId) ?? [];
          const first = byId.get(ids[0]!)!;
          const texts = ids.map((id) => byId.get(id)!.text_masked);
          const title = lexicalUnresolvedLabel(
            texts,
            others.filter((text) => !texts.includes(text)),
          );
          await tx.$executeRaw`
            INSERT INTO ai_unresolved_clusters (
              id, license_id, ai_agent_id, label, label_source, embedding_space,
              first_seen, last_seen
            ) VALUES (
              ${clusterId}::uuid, ${tenant.licenseId}, ${agentId}::uuid, ${title.label},
              'lexical', ${space}, ${first.created_at}, ${first.created_at}
            )`;
        }
        const centreOf = new Map(outcome.centres.map((centre) => [centre.id, centre]));
        for (const [clusterId, ids] of members) {
          const joined = ids.map((id) => byId.get(id)!);
          const handoffs = joined.filter(
            (row) =>
              (UNRESOLVED_HANDOFF_REASONS as readonly string[]).includes(row.reason) ||
              handedOver.has(row.thread_id),
          ).length;
          const abandoned = joined.filter((row) => row.reason === 'player_abandoned').length;
          const times = joined.map((row) => row.created_at.getTime());
          await tx.$executeRaw`
            UPDATE ai_unresolved_items SET cluster_id = ${clusterId}::uuid
             WHERE id = ANY(${ids}::uuid[])`;
          await tx.$executeRaw`
            UPDATE ai_unresolved_clusters c
               SET centroid = CAST(${toVectorLiteral(centreOf.get(clusterId)!.centroid)} AS vector),
                   item_count = c.item_count + ${ids.length},
                   handoff_count = c.handoff_count + ${handoffs},
                   abandon_count = c.abandon_count + ${abandoned},
                   post_fix_count = c.post_fix_count + (
                     CASE WHEN c.status = 'resolved' THEN (
                       SELECT count(*)::int FROM ai_unresolved_items i
                        WHERE i.id = ANY(${ids}::uuid[]) AND i.created_at > c.resolved_at
                     ) ELSE 0 END
                   ),
                   first_seen = LEAST(c.first_seen, ${new Date(Math.min(...times))}),
                   last_seen = GREATEST(c.last_seen, ${new Date(Math.max(...times))}),
                   updated_at = now()
             WHERE c.id = ${clusterId}::uuid`;
        }
        assigned += outcome.assignments.length;
        opened += outcome.opened.length;
      }
      return { assigned, opened };
    });
  }

  /** Step 4: the clusters that opened or grew by half since their title. */
  async #label(tenant: TenantContext, space: string, pass: PassState): Promise<number> {
    const due = await withTenant(
      this.#db,
      tenant,
      (tx) => tx.$queryRaw<Array<{ id: string; ai_agent_id: string }>>`
        SELECT id::text, ai_agent_id::text FROM ai_unresolved_clusters
         WHERE embedding_space = ${space} AND item_count > 0
           AND (labelled_count = 0 OR item_count * 2 >= labelled_count * 3)
         ORDER BY item_count DESC, id
         LIMIT ${UNRESOLVED_LABELS_PER_PASS}`,
    );
    if (due.length === 0) return 0;
    const model =
      this.#options.llm.id !== 'mock' &&
      !pass.llmCapped &&
      (await this.#mayInfer(tenant, this.#options.llmInference));
    let workspaceCapped = false;
    let labelled = 0;
    for (const cluster of due) {
      const { samples, others } = await withTenant(this.#db, tenant, async (tx) => ({
        samples: (
          await tx.$queryRaw<Array<{ text_masked: string }>>`
            SELECT text_masked FROM ai_unresolved_items WHERE cluster_id = ${cluster.id}::uuid
             ORDER BY created_at DESC, id LIMIT ${UNRESOLVED_LABEL_SAMPLES}`
        ).map((row) => row.text_masked),
        others: (
          await tx.$queryRaw<Array<{ text_masked: string }>>`
            SELECT text_masked FROM ai_unresolved_items
             WHERE ai_agent_id = ${cluster.ai_agent_id}::uuid
               AND cluster_id IS DISTINCT FROM ${cluster.id}::uuid
             ORDER BY created_at DESC, id LIMIT ${LEXICAL_CORPUS}`
        ).map((row) => row.text_masked),
      }));
      let title: UnresolvedClusterTitle | null = null;
      if (samples.length > 0) {
        if (model && !pass.llmCapped && !workspaceCapped) {
          try {
            title = await this.#modelTitle(tenant, samples);
          } catch (error) {
            if (error instanceof AiDailyCapError) {
              if (error.scope === 'workspace') workspaceCapped = true;
              else pass.llmCapped = true;
            } else {
              this.#log.warn(
                {
                  err: error,
                  event: 'ai.unresolved_label_failed',
                  license_id: tenant.licenseId.toString(),
                },
                'a cluster could not be titled by the model; the lexical title stands',
              );
            }
          }
        }
        title ??= lexicalUnresolvedLabel(samples, others);
      }
      await withTenant(this.#db, tenant, async (tx) => {
        // No words left to read (the items went): the title stands, the count moves on.
        if (title === null) {
          await tx.$executeRaw`
            UPDATE ai_unresolved_clusters SET labelled_count = item_count, updated_at = now()
             WHERE id = ${cluster.id}::uuid`;
          return;
        }
        await tx.$executeRaw`
          UPDATE ai_unresolved_clusters
             SET label = ${title.label}, label_source = ${title.source},
                 suggested_action = ${title.action}, labelled_count = item_count,
                 updated_at = now()
           WHERE id = ${cluster.id}::uuid`;
      });
      if (title !== null) labelled += 1;
    }
    return labelled;
  }

  /** The `fast` model's title, or null when its reply is not one. Throws a cap refusal. */
  async #modelTitle(
    tenant: TenantContext,
    samples: readonly string[],
  ): Promise<UnresolvedClusterTitle | null> {
    const { llmLimits } = this.#options;
    const prompt = buildUnresolvedLabelPrompt(samples);
    refuseOverlongPrompt(prompt, llmLimits.maxPromptChars);
    const metered = MeteredLlm.wrap(this.#options.llm);
    const { value } = await completeStructured(
      metered.forTenant(tenant, { surface: 'cluster', chatId: null, configVersionId: null }),
      {
        ...prompt,
        maxOutputTokens: Math.min(llmLimits.maxOutputTokens, UNRESOLVED_LABEL_MAX_OUTPUT_TOKENS),
        timeoutMs: llmLimits.timeoutMs,
        tier: 'fast',
        responseFormat: UNRESOLVED_LABEL_RESPONSE_FORMAT,
      },
    );
    return readUnresolvedLabelReply(value);
  }

  /** Whether the workspace's content may go to `provider` (NFR-C4). */
  async #mayInfer(tenant: TenantContext, provider: InferenceProvider): Promise<boolean> {
    return withTenant(this.#db, tenant, async (tx) => {
      const residency = await readInferenceResidency(tx, tenant);
      return (
        residency !== null &&
        inferenceAllowed({
          provider,
          workspaceRegion: residency.region,
          hipaaScope: residency.hipaaScope,
        })
      );
    });
  }

  /** The notices, to the Team Leads and up. Never throws. */
  async #announce(tenant: TenantContext, alerts: readonly AiUnresolvedAlertPush[]): Promise<void> {
    try {
      const recipients = await withTenant(this.#db, tenant, (tx) =>
        tx.agentMembership.findMany({
          where: {
            licenseId: tenant.licenseId,
            suspended: false,
            role: { in: [...UNRESOLVED_ALERT_ROLES] },
          },
          orderBy: { createdAt: 'asc' },
          select: { agentId: true },
        }),
      );
      for (const alert of alerts) {
        if (recipients.length > 0) {
          await this.#options.publisher?.publish(
            tenant,
            'ai_unresolved_alert',
            { agentIds: recipients.map((row) => row.agentId) },
            alert,
          );
        }
        this.#log.info(
          {
            event: 'ai.unresolved_alert',
            license_id: tenant.licenseId.toString(),
            cluster_id: alert.cluster_id,
            kind: alert.kind,
            count: alert.count,
            recipients: recipients.length,
          },
          'unresolved questions alert sent',
        );
      }
    } catch (error) {
      this.#log.error(
        {
          err: error,
          event: 'ai.unresolved_alert_failed',
          license_id: tenant.licenseId.toString(),
        },
        'an unresolved questions alert could not be sent',
      );
    }
  }
}

/** Step 2: an old space's clusters whose items are all in `space` now. */
async function rebuildClusters(tx: TenantClient, space: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE ai_unresolved_clusters c
       SET centroid = (
             SELECT avg(i.embedding) FROM ai_unresolved_items i WHERE i.cluster_id = c.id
           ),
           embedding_space = ${space},
           updated_at = now()
     WHERE c.embedding_space <> ${space}
       AND EXISTS (SELECT 1 FROM ai_unresolved_items i WHERE i.cluster_id = c.id)
       AND NOT EXISTS (
             SELECT 1 FROM ai_unresolved_items i
              WHERE i.cluster_id = c.id AND i.embedding_space IS DISTINCT FROM ${space}
           )`;
}

/** Step 5: `count_7d`, where it moved. */
async function countRecent(tx: TenantClient, now: Date): Promise<void> {
  const since = new Date(now.getTime() - UNRESOLVED_RECENT_DAYS * DAY);
  await tx.$executeRaw`
    UPDATE ai_unresolved_clusters c
       SET count_7d = recent.n, updated_at = now()
      FROM (
        SELECT c2.id, (
          SELECT count(*)::int FROM ai_unresolved_items i
           WHERE i.cluster_id = c2.id AND i.created_at > ${since}
        ) AS n
          FROM ai_unresolved_clusters c2
      ) recent
     WHERE c.id = recent.id AND c.count_7d <> recent.n`;
}

/** Step 6: a fixed cluster that came back — open again, and the notice for it. */
async function reopenFixed(tx: TenantClient, now: Date): Promise<AiUnresolvedAlertPush[]> {
  const rows = await tx.$queryRaw<
    Array<{ id: string; ai_agent_id: string; label: string; post_fix_count: number }>
  >`
    UPDATE ai_unresolved_clusters
       SET status = 'open', resolved_at = NULL, updated_at = ${now}
     WHERE status = 'resolved' AND post_fix_count >= ${UNRESOLVED_REOPEN_AFTER_FIX}
    RETURNING id::text, ai_agent_id::text, label, post_fix_count`;
  return rows.map((row) => ({
    kind: 'reopened',
    cluster_id: row.id,
    ai_agent_id: row.ai_agent_id,
    label: row.label,
    count: row.post_fix_count,
    threshold: UNRESOLVED_REOPEN_AFTER_FIX,
    window_minutes: null,
  }));
}

/** The workspace's surge threshold. */
export async function readUnresolvedSpikeThreshold(tx: TenantClient): Promise<number> {
  const row = await tx.aiUnresolvedSettings.findFirst({ select: { spikeThreshold: true } });
  return row?.spikeThreshold ?? UNRESOLVED_SPIKE_THRESHOLD_DEFAULT;
}

/** Step 7: the clusters past the threshold in the window, each claimed by one UPDATE. */
async function claimSpikes(tx: TenantClient, now: Date): Promise<AiUnresolvedAlertPush[]> {
  const threshold = await readUnresolvedSpikeThreshold(tx);
  const windowStart = new Date(now.getTime() - UNRESOLVED_SPIKE_WINDOW_MINUTES * 60_000);
  const repeatBefore = new Date(now.getTime() - UNRESOLVED_ALERT_REPEAT_HOURS * HOUR);
  const surging = await tx.$queryRaw<
    Array<{ id: string; ai_agent_id: string; label: string; n: number }>
  >`
    SELECT c.id::text, c.ai_agent_id::text, c.label, count(i.id)::int AS n
      FROM ai_unresolved_clusters c
      JOIN ai_unresolved_items i ON i.cluster_id = c.id
     WHERE c.status <> 'ignored' AND i.created_at > ${windowStart}
       AND (c.alerted_at IS NULL OR c.alerted_at <= ${repeatBefore})
     GROUP BY c.id
    HAVING count(i.id) >= ${threshold}
     ORDER BY c.id`;
  const claimed: AiUnresolvedAlertPush[] = [];
  for (const cluster of surging) {
    const won = await tx.$executeRaw`
      UPDATE ai_unresolved_clusters SET alerted_at = ${now}, updated_at = now()
       WHERE id = ${cluster.id}::uuid
         AND (alerted_at IS NULL OR alerted_at <= ${repeatBefore})`;
    if (won === 0) continue;
    claimed.push({
      kind: 'spike',
      cluster_id: cluster.id,
      ai_agent_id: cluster.ai_agent_id,
      label: cluster.label,
      count: cluster.n,
      threshold,
      window_minutes: UNRESOLVED_SPIKE_WINDOW_MINUTES,
    });
  }
  return claimed;
}

/**
 * Fold `absorbedIds` into `survivorId`, in the caller's transaction: the items
 * move, the counts add up, the earliest first sighting and the latest last
 * one stay, the absorbed rows go. The survivor keeps its title, state and fix.
 * Its centre is `centroid` when given (the nightly pass computed it), otherwise
 * the mean of its items in its space. Returns the absorbed clusters removed.
 */
export async function mergeUnresolvedClusters(
  tx: TenantClient,
  survivorId: string,
  absorbedIds: readonly string[],
  centroid: readonly number[] | null = null,
): Promise<number> {
  const absorbed = absorbedIds.filter((id) => id !== survivorId);
  if (absorbed.length === 0) return 0;
  await tx.$executeRaw`
    UPDATE ai_unresolved_items SET cluster_id = ${survivorId}::uuid
     WHERE cluster_id = ANY(${absorbed}::uuid[])`;
  const centre = centroid
    ? Prisma.sql`CAST(${toVectorLiteral([...centroid])} AS vector)`
    : Prisma.sql`COALESCE((
        SELECT avg(i.embedding) FROM ai_unresolved_items i
         WHERE i.cluster_id = s.id AND i.embedding_space = s.embedding_space
      ), s.centroid)`;
  await tx.$executeRaw`
    UPDATE ai_unresolved_clusters s
       SET item_count = s.item_count + agg.item_count,
           count_7d = s.count_7d + agg.count_7d,
           handoff_count = s.handoff_count + agg.handoff_count,
           abandon_count = s.abandon_count + agg.abandon_count,
           post_fix_count = s.post_fix_count + agg.post_fix_count,
           first_seen = LEAST(s.first_seen, agg.first_seen),
           last_seen = GREATEST(s.last_seen, agg.last_seen),
           alerted_at = GREATEST(s.alerted_at, agg.alerted_at),
           centroid = ${centre},
           updated_at = now()
      FROM (
        SELECT sum(item_count)::int AS item_count, sum(count_7d)::int AS count_7d,
               sum(handoff_count)::int AS handoff_count,
               sum(abandon_count)::int AS abandon_count,
               sum(post_fix_count)::int AS post_fix_count,
               min(first_seen) AS first_seen, max(last_seen) AS last_seen,
               max(alerted_at) AS alerted_at
          FROM ai_unresolved_clusters WHERE id = ANY(${absorbed}::uuid[])
      ) agg
     WHERE s.id = ${survivorId}::uuid`;
  return tx.$executeRaw`
    DELETE FROM ai_unresolved_clusters WHERE id = ANY(${absorbed}::uuid[])`;
}

/** The nightly merge of the clusters the 15-minute pass split. */
export class UnresolvedClusterMerger {
  readonly #db: PrismaClient;
  readonly #space: string;
  readonly #log: UnresolvedClusteringLogger;

  constructor(db: PrismaClient, options: { space: string; logger?: UnresolvedClusteringLogger }) {
    this.#db = db;
    this.#space = options.space;
    this.#log = options.logger ?? SILENT;
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<UnresolvedMergeReport> {
    const totals = { tenants: 0, merged: 0, absorbed: 0 };
    for (const tenant of await listTenants(this.#db)) {
      if (options.signal?.aborted) break;
      try {
        const result = await this.mergeTenant(tenant);
        totals.tenants += 1;
        totals.merged += result.merged;
        totals.absorbed += result.absorbed;
      } catch (error) {
        this.#log.error(
          {
            err: error,
            event: 'ai.unresolved_merge_failed',
            license_id: tenant.licenseId.toString(),
          },
          'unresolved clusters could not be merged; the next night tries again',
        );
      }
    }
    return { totals };
  }

  async mergeTenant(tenant: TenantContext): Promise<{ merged: number; absorbed: number }> {
    const space = this.#space;
    const threshold = UNRESOLVED_MERGE_SIMILARITY[unresolvedSpaceKind(space)];
    return withTenant(this.#db, tenant, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          ai_agent_id: string;
          centroid: string;
          item_count: number;
          status: UnresolvedClusterStatus;
          first_seen: Date;
        }>
      >`
        SELECT id::text, ai_agent_id::text, centroid::text, item_count, status, first_seen
          FROM ai_unresolved_clusters
         WHERE embedding_space = ${space} AND centroid IS NOT NULL
         ORDER BY ai_agent_id, id`;
      let merged = 0;
      let absorbed = 0;
      for (const agentId of [...new Set(rows.map((row) => row.ai_agent_id))]) {
        const plans = planMerges(
          rows
            .filter((row) => row.ai_agent_id === agentId)
            .map((row) => ({
              id: row.id,
              centroid: parseVector(row.centroid),
              weight: row.item_count,
              status: row.status,
              firstSeen: row.first_seen,
            })),
          threshold,
        );
        for (const plan of plans) {
          absorbed += await mergeUnresolvedClusters(
            tx,
            plan.survivorId,
            plan.absorbedIds,
            plan.centroid,
          );
          merged += 1;
        }
      }
      return { merged, absorbed };
    });
  }
}
