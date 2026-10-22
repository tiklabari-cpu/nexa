/**
 * The unresolved questions report (tm 317.3 · SiyahTuş analysis AI-22 §6–§7,
 * `routes/ai-unresolved.ts`): the clusters of one AI agent as the list shows
 * them, one cluster with its newest masked examples and its trend, and the
 * moves a person makes on a cluster — ignore, bring back, mark fixed, merge.
 *
 * Everything here runs in the caller's tenant transaction (RLS is per
 * licence). The counts are the clustering job's (tm 317.2) and are read as
 * they stand: a report never recounts, so the list and the job cannot
 * disagree. A move changes only the cluster's state:
 *
 *   - **ignore** — out of the default view, never alarms; the job still
 *     counts what arrives (AI-22 KK 4);
 *   - **resolve** — `resolved_at` is now and `post_fix_count` starts from
 *     zero, so "düzeltmeden sonra: N" counts what comes after *this* fix and
 *     the job's reopening at five (`UNRESOLVED_REOPEN_AFTER_FIX`) starts again;
 *   - **reopen** — back to `open`, with the fix's marks cleared;
 *   - **merge** — {@link mergeUnresolvedClusters}, the nightly pass's own
 *     merge, for clusters of one agent in one embedding space.
 */
import type { Prisma } from '@prisma/client';
import {
  UNRESOLVED_EXAMPLES_PER_CLUSTER,
  UNRESOLVED_KNOWLEDGE_QUESTIONS_MAX,
  UNRESOLVED_TREND_DAYS,
  unresolvedIsNew,
  unresolvedRate,
  type UnresolvedListSort,
  type UnresolvedListStatus,
  type UnresolvedReason,
  type UnresolvedSuggestedAction,
} from '@siyahtus/types';
import { ApiError } from '../../../lib/api-error.js';
import type { TenantClient } from '../../../lib/tenant.js';
import { mergeUnresolvedClusters } from './cluster-job.js';

const DAY = 24 * 3_600_000;

/** The most clusters one list reads before it sorts and cuts a page. */
const LIST_READ_CAP = 2000;

/** The items a list or a detail may be narrowed by — the clusters that have one. */
export interface UnresolvedItemFilter {
  from?: Date;
  to?: Date;
  brandId?: string;
  reason?: UnresolvedReason;
  language?: string;
}

export interface UnresolvedListQuery extends UnresolvedItemFilter {
  aiAgentId: string;
  status: UnresolvedListStatus;
  sort: UnresolvedListSort;
  limit: number;
  offset: number;
}

const CLUSTER_SELECT = {
  id: true,
  aiAgentId: true,
  label: true,
  labelSource: true,
  suggestedAction: true,
  status: true,
  ignoreReason: true,
  itemCount: true,
  count7d: true,
  handoffCount: true,
  abandonCount: true,
  postFixCount: true,
  firstSeen: true,
  lastSeen: true,
  resolvedAt: true,
  linkedChangeId: true,
  embeddingSpace: true,
} satisfies Prisma.AiUnresolvedClusterSelect;

type ClusterRow = Prisma.AiUnresolvedClusterGetPayload<{ select: typeof CLUSTER_SELECT }>;

export interface UnresolvedReasonCount {
  reason: UnresolvedReason;
  count: number;
}

/** A cluster as the API sends it (`AiUnresolvedCluster`). */
export function serialiseUnresolvedCluster(
  row: ClusterRow,
  reasons: UnresolvedReasonCount[],
  matchingCount: number | null,
  now: Date = new Date(),
) {
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    label: row.label,
    label_source: row.labelSource,
    suggested_action: row.suggestedAction as UnresolvedSuggestedAction | null,
    status: row.status,
    ignore_reason: row.ignoreReason,
    item_count: row.itemCount,
    count_7d: row.count7d,
    handoff_count: row.handoffCount,
    abandon_count: row.abandonCount,
    handoff_rate: unresolvedRate(row.handoffCount, row.itemCount),
    abandon_rate: unresolvedRate(row.abandonCount, row.itemCount),
    post_fix_count: row.postFixCount,
    is_new: unresolvedIsNew(row.firstSeen, now),
    first_seen: row.firstSeen.toISOString(),
    last_seen: row.lastSeen.toISOString(),
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    linked_change_id: row.linkedChangeId,
    reasons,
    matching_count: matchingCount,
  };
}

function itemWhere(filter: UnresolvedItemFilter): Prisma.AiUnresolvedItemWhereInput | null {
  const where: Prisma.AiUnresolvedItemWhereInput = {};
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.brandId) where.brandId = filter.brandId;
  if (filter.reason) where.reason = filter.reason;
  if (filter.language) where.language = filter.language;
  return Object.keys(where).length > 0 ? where : null;
}

/** The order the report reads in: the sort's key, then the busiest and the freshest. */
function compare(sort: UnresolvedListSort) {
  const rate = (row: ClusterRow, kind: 'handoff' | 'abandon') =>
    unresolvedRate(kind === 'handoff' ? row.handoffCount : row.abandonCount, row.itemCount);
  return (a: ClusterRow, b: ClusterRow): number => {
    let primary = 0;
    if (sort === 'handoff_rate') primary = rate(b, 'handoff') - rate(a, 'handoff');
    else if (sort === 'abandon_rate') primary = rate(b, 'abandon') - rate(a, 'abandon');
    else if (sort === 'first_seen') primary = b.firstSeen.getTime() - a.firstSeen.getTime();
    else if (sort === 'last_seen') primary = b.lastSeen.getTime() - a.lastSeen.getTime();
    if (primary !== 0) return primary;
    return (
      b.count7d - a.count7d ||
      b.lastSeen.getTime() - a.lastSeen.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  };
}

async function reasonsOf(
  tx: TenantClient,
  clusterIds: string[],
): Promise<Map<string, UnresolvedReasonCount[]>> {
  const out = new Map<string, UnresolvedReasonCount[]>();
  if (clusterIds.length === 0) return out;
  const groups = await tx.aiUnresolvedItem.groupBy({
    by: ['clusterId', 'reason'],
    where: { clusterId: { in: clusterIds } },
    _count: { _all: true },
  });
  for (const group of groups) {
    if (group.clusterId === null) continue;
    const list = out.get(group.clusterId) ?? [];
    list.push({ reason: group.reason as UnresolvedReason, count: group._count._all });
    out.set(group.clusterId, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.count - a.count);
  return out;
}

async function matchingCounts(
  tx: TenantClient,
  clusterIds: string[],
  where: Prisma.AiUnresolvedItemWhereInput | null,
): Promise<Map<string, number> | null> {
  if (where === null) return null;
  const out = new Map<string, number>();
  if (clusterIds.length === 0) return out;
  const groups = await tx.aiUnresolvedItem.groupBy({
    by: ['clusterId'],
    where: { ...where, clusterId: { in: clusterIds } },
    _count: { _all: true },
  });
  for (const group of groups) if (group.clusterId) out.set(group.clusterId, group._count._all);
  return out;
}

/** One page of an AI agent's clusters, ordered, and how many matched. */
export async function listUnresolvedClusters(tx: TenantClient, query: UnresolvedListQuery) {
  const items = itemWhere(query);
  const where: Prisma.AiUnresolvedClusterWhereInput = {
    aiAgentId: query.aiAgentId,
    ...(query.status === 'all' ? {} : { status: query.status }),
    ...(items ? { items: { some: items } } : {}),
  };
  const rows = await tx.aiUnresolvedCluster.findMany({
    where,
    select: CLUSTER_SELECT,
    orderBy: [{ count7d: 'desc' }, { lastSeen: 'desc' }],
    take: LIST_READ_CAP,
  });
  const page = [...rows].sort(compare(query.sort)).slice(query.offset, query.offset + query.limit);
  const ids = page.map((row) => row.id);
  const [reasons, matching, unclustered] = await Promise.all([
    reasonsOf(tx, ids),
    matchingCounts(tx, ids, items),
    tx.aiUnresolvedItem.count({ where: { aiAgentId: query.aiAgentId, clusterId: null } }),
  ]);
  const now = new Date();
  return {
    clusters: page.map((row) =>
      serialiseUnresolvedCluster(
        row,
        reasons.get(row.id) ?? [],
        matching ? (matching.get(row.id) ?? 0) : null,
        now,
      ),
    ),
    total: rows.length,
    unclusteredCount: unclustered,
  };
}

async function requireCluster(tx: TenantClient, id: string): Promise<ClusterRow> {
  const row = await tx.aiUnresolvedCluster.findFirst({ where: { id }, select: CLUSTER_SELECT });
  if (!row) throw ApiError.notFound('Cluster not found.');
  return row;
}

/** A cluster, serialised with its reasons — what every move answers with. */
async function readCluster(tx: TenantClient, id: string) {
  const row = await requireCluster(tx, id);
  const reasons = await reasonsOf(tx, [id]);
  return serialiseUnresolvedCluster(row, reasons.get(id) ?? [], null);
}

/** One cluster with its newest masked examples, its trend and its languages. */
export async function readUnresolvedClusterDetail(tx: TenantClient, id: string, now = new Date()) {
  const row = await requireCluster(tx, id);
  const since = new Date(now.getTime() - (UNRESOLVED_TREND_DAYS - 1) * DAY);
  const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const [reasons, examples, perDay, languages] = await Promise.all([
    reasonsOf(tx, [id]),
    tx.aiUnresolvedItem.findMany({
      where: { clusterId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: UNRESOLVED_EXAMPLES_PER_CLUSTER,
      select: {
        id: true,
        textMasked: true,
        contextMasked: true,
        reason: true,
        language: true,
        brandId: true,
        chatId: true,
        threadId: true,
        createdAt: true,
      },
    }),
    tx.$queryRaw<Array<{ day: string; n: number }>>`
      SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM ai_unresolved_items
       WHERE cluster_id = ${id}::uuid AND created_at >= ${start}
       GROUP BY 1`,
    tx.aiUnresolvedItem.groupBy({
      by: ['language'],
      where: { clusterId: id },
      _count: { _all: true },
    }),
  ]);
  const counted = new Map(perDay.map((entry) => [entry.day, entry.n]));
  const trend = Array.from({ length: UNRESOLVED_TREND_DAYS }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY).toISOString().slice(0, 10);
    return { date, count: counted.get(date) ?? 0 };
  });
  return {
    ...serialiseUnresolvedCluster(row, reasons.get(id) ?? [], null, now),
    examples: examples.map((item) => ({
      id: item.id,
      text: item.textMasked,
      context: item.contextMasked,
      reason: item.reason as UnresolvedReason,
      language: item.language,
      brand_id: item.brandId,
      chat_id: item.chatId,
      thread_id: item.threadId,
      created_at: item.createdAt.toISOString(),
    })),
    trend,
    languages: languages
      .map((entry) => ({ language: entry.language, count: entry._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Ignore: out of the default view and the alarm, still counted. */
export async function ignoreUnresolvedCluster(tx: TenantClient, id: string, reason: string | null) {
  await requireCluster(tx, id);
  await tx.aiUnresolvedCluster.update({
    where: { id },
    data: { status: 'ignored', ignoreReason: reason, resolvedAt: null, postFixCount: 0 },
  });
  return readCluster(tx, id);
}

/** Back to the list: the ignore reason and the fix's marks are cleared. */
export async function reopenUnresolvedCluster(tx: TenantClient, id: string) {
  await requireCluster(tx, id);
  await tx.aiUnresolvedCluster.update({
    where: { id },
    data: {
      status: 'open',
      ignoreReason: null,
      resolvedAt: null,
      postFixCount: 0,
      linkedChangeId: null,
    },
  });
  return readCluster(tx, id);
}

/** Fixed now; what arrives after this is "after the fix". */
export async function resolveUnresolvedCluster(
  tx: TenantClient,
  id: string,
  linkedChangeId: string | null,
  now: Date = new Date(),
) {
  await requireCluster(tx, id);
  await tx.aiUnresolvedCluster.update({
    where: { id },
    data: {
      status: 'resolved',
      ignoreReason: null,
      resolvedAt: now,
      postFixCount: 0,
      linkedChangeId,
    },
  });
  return readCluster(tx, id);
}

/**
 * Fold `sourceIds` into `survivorId`. Refused as a whole (400 validation, 404
 * for a cluster that is not there) unless every one is the survivor's agent's
 * and in the survivor's embedding space — the centre of two spaces means
 * nothing.
 */
export async function mergeUnresolvedClustersByHand(
  tx: TenantClient,
  survivorId: string,
  sourceIds: readonly string[],
) {
  const survivor = await requireCluster(tx, survivorId);
  const unique = [...new Set(sourceIds)];
  if (unique.includes(survivorId)) {
    throw ApiError.validation('source_ids: a cluster cannot be merged into itself.');
  }
  const sources = await tx.aiUnresolvedCluster.findMany({
    where: { id: { in: unique } },
    select: { id: true, aiAgentId: true, embeddingSpace: true },
  });
  if (sources.length !== unique.length) throw ApiError.notFound('Cluster not found.');
  const stray = sources.find(
    (source) =>
      source.aiAgentId !== survivor.aiAgentId || source.embeddingSpace !== survivor.embeddingSpace,
  );
  if (stray) {
    throw ApiError.validation(
      'source_ids: clusters merge only within one AI agent and one embedding space.',
      { cluster_id: stray.id },
    );
  }
  const absorbed = await mergeUnresolvedClusters(tx, survivorId, unique);
  return { cluster: await readCluster(tx, survivorId), absorbed };
}

/** What "add knowledge" opens the editor with: the title and the newest distinct questions. */
export async function suggestUnresolvedKnowledge(tx: TenantClient, id: string) {
  const row = await requireCluster(tx, id);
  const items = await tx.aiUnresolvedItem.findMany({
    where: { clusterId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: UNRESOLVED_KNOWLEDGE_QUESTIONS_MAX * 4,
    select: { textMasked: true },
  });
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const item of items) {
    const text = item.textMasked.trim();
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(text);
    if (questions.length >= UNRESOLVED_KNOWLEDGE_QUESTIONS_MAX) break;
  }
  return {
    cluster_id: row.id,
    ai_agent_id: row.aiAgentId,
    target: 'knowledge_snippet' as const,
    title: row.label,
    questions,
    body: questions.map((question) => `- ${question}`).join('\n'),
  };
}

/** The AI agent a cluster belongs to — for the route's skill check. */
export async function unresolvedClusterAgent(tx: TenantClient, id: string): Promise<string> {
  const row = await tx.aiUnresolvedCluster.findFirst({
    where: { id },
    select: { aiAgentId: true },
  });
  if (!row) throw ApiError.notFound('Cluster not found.');
  return row.aiAgentId;
}
