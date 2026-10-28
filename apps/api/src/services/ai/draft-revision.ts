/**
 * The draft revision (tm 316.2 · SiyahTuş analysis AI-20 · ADR-14b
 * `docs/adr/ai-config-versioning.md` §2.5 step 2).
 *
 * Every save that changes what a customer-facing agent would answer moves
 * that agent's `ai_agents.draft_revision` by one, in the save's transaction.
 * The revision is what a pre-publish run is recorded against, what a version
 * is submitted from, and what an editor sends back as `If-Match`: a save made
 * against a revision someone else's save has moved past is
 * `409 ai_config_revision_conflict`, so the second of two people editing the
 * same draft does not silently overwrite the first.
 *
 * One save is one step. A save that writes several rows (an article and its
 * knowledge source, a table row and its mirror) reaches this more than once in
 * the same transaction; the first call moves the revision and every later one
 * is judged against the revision the save started from. The bookkeeping is
 * keyed by the transaction client, so a transaction that rolls back takes its
 * step with it and the next one starts clean.
 *
 * Concurrency: the agents' rows are read `FOR NO KEY UPDATE` before the check,
 * so two saves against the same revision queue on the row, and the second
 * reads the first's committed revision and is refused. Not `FOR UPDATE`: a
 * save that inserts a row naming the agent holds a `KEY SHARE` lock on it
 * (the foreign key), and two such saves asking for `FOR UPDATE` would wait on
 * each other. The caller moves the revision before it writes the audit entry,
 * so the agent's row is always taken before the audit chain's head.
 */
import { isAiConfigMetaOnly, type AiConfigDiffEntry } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { ConfigTable } from './config-history.js';

/** Whose drafts a write reaches: every customer-facing agent of the workspace, or these. */
export type DraftReach = { readonly all: true } | { readonly all: false; readonly ids: string[] };

export const EVERY_DRAFT: DraftReach = { all: true };

/** Per transaction: agent id → the revision the save started from. */
const started = new WeakMap<object, Map<string, bigint>>();

/** `409 ai_config_revision_conflict`: the draft is no longer at the revision the caller saw. */
export function revisionConflict(aiAgentId: string, current: bigint, expected: bigint): ApiError {
  return new ApiError(
    'ai_config_revision_conflict',
    'Someone else saved this AI configuration after you loaded it. Reload it and make your change again.',
    {
      details: {
        ai_agent_id: aiAgentId,
        current_revision: Number(current),
        expected_revision: Number(expected),
      },
    },
  );
}

/**
 * Move the drafts `reach` names by one — once per transaction — after
 * checking each is at `expected` when that is given. Copilot is never moved:
 * it is not versioned (§2.2).
 */
export async function moveDraftRevision(
  tx: TenantClient,
  reach: DraftReach,
  expected: bigint | null,
): Promise<void> {
  if (!reach.all && reach.ids.length === 0) return;
  const ids = reach.all ? [] : [...new Set(reach.ids)];
  const rows = await tx.$queryRaw<Array<{ id: string; draft_revision: bigint }>>`
    SELECT id::text AS id, draft_revision
      FROM ai_agents
     WHERE kind = 'ai_agent' AND (${reach.all}::boolean OR id = ANY(${ids}::uuid[]))
     ORDER BY id
       FOR NO KEY UPDATE`;
  let seen = started.get(tx);
  if (!seen) {
    seen = new Map();
    started.set(tx, seen);
  }
  const move: string[] = [];
  for (const row of rows) {
    const from = seen.get(row.id) ?? row.draft_revision;
    if (expected !== null && from !== expected) throw revisionConflict(row.id, from, expected);
    if (!seen.has(row.id)) {
      seen.set(row.id, row.draft_revision);
      move.push(row.id);
    }
  }
  if (move.length === 0) return;
  await tx.$executeRaw`
    UPDATE ai_agents SET draft_revision = draft_revision + 1 WHERE id = ANY(${move}::uuid[])`;
}

/**
 * Whether a recorded change moves the draft: anything but a meta field (§2.2 —
 * an owner, a review date) and the agent's pause switch, which is read live
 * and never versioned.
 */
export function changesDraft(table: ConfigTable, diff: readonly AiConfigDiffEntry[]): boolean {
  if (isAiConfigMetaOnly(diff)) return false;
  if (table === 'ai_agents' && diff.length > 0) {
    return diff.some((entry) => entry.path.split(/[.[]/, 1)[0] !== 'active');
  }
  return true;
}

/** Tables whose rows belong to the workspace rather than to one agent. */
const WORKSPACE_TABLES: ReadonlySet<ConfigTable> = new Set([
  'kb_payment_methods',
  'kb_bonuses',
  'kb_kyc_documents',
  'kb_rules',
  'handoff_routes',
  'ai_access_info',
]);

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * The drafts a row of `table` reaches, before or after the write: its own
 * agent; every agent for a workspace-wide table; for a knowledge source, the
 * agents it is scoped to when customer-facing agents read it at all
 * (`audiences`), every one when it names none (`ai_agent_ids = '{}'`).
 */
export function draftReachOf(
  table: ConfigTable,
  rows: ReadonlyArray<Record<string, unknown> | null>,
): DraftReach {
  const present = rows.filter((row): row is Record<string, unknown> => row !== null);
  if (WORKSPACE_TABLES.has(table)) return EVERY_DRAFT;
  if (table === 'knowledge_sources') {
    const read = present.filter((row) => strings(row['audiences']).includes('ai_agent'));
    if (read.some((row) => strings(row['ai_agent_ids']).length === 0)) return EVERY_DRAFT;
    return { all: false, ids: read.flatMap((row) => strings(row['ai_agent_ids'])) };
  }
  const column = table === 'ai_agents' ? 'id' : 'ai_agent_id';
  return {
    all: false,
    ids: present.map((row) => text(row[column])).filter((id): id is string => id !== null),
  };
}
