/**
 * The weekly QA consistency job (tm 319.2 · SiyahTuş analysis AI-24 §6, CGA
 * consistency) — the scheduler's `qa_consistency`.
 *
 * The AI connections that closed in the workspace's previous week (Monday to
 * Sunday on its own clock) are grouped by what they were about: the procedure
 * the AI followed last and which details it collected (the slot keys — the
 * "temel bilgi kovaları"; never their values). Within a group, a connection
 * the AI settled and one it handed over answered the same kind of matter two
 * ways: the first of each (by connection id) is queued as a pair with the
 * reason `consistency`, at most {@link QA_CONSISTENCY_PAIRS_MAX} pairs a week.
 *
 * Left out: a connection without a procedure (a knowledge answer — the
 * questions differ too much to compare), one the player abandoned, and one a
 * compliance rule handed over (its player's situation, not the AI, decided).
 *
 * A pair queued again merges into its reviews (`ON CONFLICT`), and a
 * completed review is never touched: running the job twice over a week —
 * every tick does — changes nothing the first run did not.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  QA_CONSISTENCY_PAIRS_MAX,
  QA_MANDATORY_HANDOFF_REASONS,
  QA_PRIORITY_RANK,
  QA_REASONS,
  localDayKey,
  localDayStart,
  qaPriorityOf,
  shiftDayKey,
  type DayBoundary,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { ensureActiveQaRubric, qaDueAt, readQaExcerpt, readQaSettings } from './sampler.js';

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export interface QaConsistencyCandidate {
  thread_id: string;
  chat_id: string;
  group_id: bigint | null;
  brand_id: string | null;
  config_version_id: string | null;
  ending: 'settled' | 'handed_off';
  procedure_id: string | null;
  slot_keys: string;
}

export interface QaConsistencyReport {
  startedAt: string;
  finishedAt: string;
  totals: { tenants: number; groups: number; pairs: number; queued: number };
}

/**
 * The previous Monday–Sunday of the workspace's conversation days at `now`:
 * its first day and the day after its last.
 */
export function qaConsistencyWeek(now: Date, boundary: DayBoundary): { from: string; to: string } {
  const today = localDayKey(now, boundary.timezone, boundary.hour);
  // A day key is a calendar date; its weekday is the date's, wherever it is.
  const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  const thisMonday = shiftDayKey(today, -((weekday + 6) % 7));
  return { from: shiftDayKey(thisMonday, -7), to: thisMonday };
}

/**
 * The pairs to queue (pure): within each group — same procedure, same slot
 * keys — the first settled and the first handed-over connection, groups in
 * key order, at most {@link QA_CONSISTENCY_PAIRS_MAX}.
 */
export function qaConsistencyPairs(
  candidates: readonly QaConsistencyCandidate[],
): Array<{ group: string; settled: QaConsistencyCandidate; handedOff: QaConsistencyCandidate }> {
  const groups = new Map<string, QaConsistencyCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.procedure_id === null) continue;
    const key = `${candidate.procedure_id}|${candidate.slot_keys}`;
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }
  const pairs = [];
  for (const key of [...groups.keys()].sort()) {
    const list = [...groups.get(key)!].sort((a, b) => (a.thread_id < b.thread_id ? -1 : 1));
    const settled = list.find((c) => c.ending === 'settled');
    const handedOff = list.find((c) => c.ending === 'handed_off');
    if (settled && handedOff) pairs.push({ group: key, settled, handedOff });
    if (pairs.length >= QA_CONSISTENCY_PAIRS_MAX) break;
  }
  return pairs;
}

export class QaConsistency {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<QaConsistencyReport> {
    const startedAt = new Date().toISOString();
    const now = options.now ?? new Date();
    const totals = { tenants: 0, groups: 0, pairs: 0, queued: 0 };
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const context: TenantContext = {
        licenseId: tenant.license_id,
        organizationId: tenant.organization_id,
      };
      const result = await withTenant(this.#db, context, (tx) => checkWeek(tx, context, now), {
        timeoutMs: 60_000,
      });
      totals.tenants += 1;
      totals.groups += result.groups;
      totals.pairs += result.pairs;
      totals.queued += result.queued;
    }
    return { startedAt, finishedAt: new Date().toISOString(), totals };
  }
}

/** The current workspace's previous week, in the caller's transaction. */
export async function checkWeek(
  tx: TenantClient,
  context: TenantContext,
  now: Date,
): Promise<{ groups: number; pairs: number; queued: number }> {
  const boundary = await readDayBoundary(tx);
  const week = qaConsistencyWeek(now, boundary);
  const from = localDayStart(week.from, boundary.timezone, boundary.hour);
  const to = localDayStart(week.to, boundary.timezone, boundary.hour);
  const candidates = await tx.$queryRaw<QaConsistencyCandidate[]>`
    SELECT t.id AS thread_id, t.chat_id, t.group_id, c.brand_id::text AS brand_id,
           ac.config_version_id::text AS config_version_id,
           CASE WHEN ac.outcome = 'handed_off' THEN 'handed_off' ELSE 'settled' END AS ending,
           (SELECT d.procedure_id::text FROM ai_decision_logs d
             WHERE d.thread_id = t.id AND d.procedure_id IS NOT NULL
             ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS procedure_id,
           COALESCE((
             SELECT string_agg(k, ',' ORDER BY k)
               FROM jsonb_object_keys(
                 CASE WHEN jsonb_typeof(ac.slots) = 'object' THEN ac.slots ELSE '{}'::jsonb END
               ) AS k
           ), '') AS slot_keys
      FROM threads t
      JOIN chats c ON c.id = t.chat_id
      JOIN ai_conversations ac ON ac.thread_id = t.id
     WHERE NOT t.active
       AND t.closed_at >= ${from} AND t.closed_at < ${to}
       AND ac.outcome IN ('resolved', 'resolved_waiting', 'handed_off')
       AND NOT EXISTS (
         SELECT 1 FROM ai_handoffs ho
          WHERE ho.thread_id = t.id
            AND ho.reason_codes && ${[...QA_MANDATORY_HANDOFF_REASONS]}::text[]
       )
     ORDER BY t.id`;
  const pairs = qaConsistencyPairs(candidates);
  const groups = new Set(
    candidates
      .filter((c) => c.procedure_id !== null)
      .map((c) => `${c.procedure_id}|${c.slot_keys}`),
  ).size;
  if (pairs.length === 0) return { groups, pairs: 0, queued: 0 };

  const agent = await tx.aiAgent.findFirst({
    where: { kind: 'ai_agent' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!agent) return { groups, pairs: 0, queued: 0 };
  const settings = await readQaSettings(tx);
  const rubric = await ensureActiveQaRubric(tx, context.licenseId);
  const priority = qaPriorityOf(['consistency']);
  const dueAt = qaDueAt(now, priority, boundary.timezone);
  let queued = 0;
  for (const pair of pairs) {
    for (const row of [pair.settled, pair.handedOff]) {
      const excerpt = await readQaExcerpt(tx, row.thread_id);
      queued += await tx.$executeRaw`
        INSERT INTO qa_reviews (
          id, license_id, chat_id, thread_id, ai_agent_id, config_version_id, team_id, brand_id,
          reasons, priority, status, due_at, rubric_id, excerpt_masked
        ) VALUES (
          ${randomUUID()}::uuid, ${context.licenseId}, ${row.chat_id}, ${row.thread_id},
          ${agent.id}::uuid, ${row.config_version_id}::uuid, ${row.group_id}, ${row.brand_id}::uuid,
          ${['consistency']}::text[], ${QA_PRIORITY_RANK[priority]},
          ${settings.prescoreEnabled ? 'pending_prescore' : 'ready'}, ${dueAt},
          ${rubric.id}::uuid, ${JSON.stringify(excerpt)}::jsonb
        )
        ON CONFLICT (license_id, thread_id) DO UPDATE SET
          reasons = ARRAY(
            SELECT merged.reason FROM (
              SELECT DISTINCT unnest(qa_reviews.reasons || EXCLUDED.reasons) AS reason
            ) merged
            ORDER BY array_position(${[...QA_REASONS]}::text[], merged.reason)
          ),
          updated_at = now()
        WHERE qa_reviews.status <> 'completed'
          AND NOT ('consistency' = ANY (qa_reviews.reasons))`;
    }
  }
  return { groups, pairs: pairs.length, queued };
}
