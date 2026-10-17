/**
 * The stalled-AI watchdog (tm 293.6 · SiyahTuş analysis AI-11 §5; owner
 * decision K9).
 *
 * "Önce AI" (`ai-first.ts`) opens a visitor's connection with nobody assigned
 * and nothing queued: the AI is the only one answering it, and a person is
 * routed only when it leaves the AI. That takes away the safety net a
 * `parallel` connection has — an assigned agent who sees the message anyway.
 * When the AI does not answer — the worker died, the job went missing (GV-02),
 * the daily caps or residency refused the turn, the provider failed — the
 * visitor would wait on nobody. So this job looks for exactly that:
 *
 *   an open connection in `ai` mode, nobody assigned and nothing queued,
 *   with a visitor message older than the AI agent's
 *   `ai_stall_timeout_seconds` that nothing from the AI has followed
 *
 * and sends a person: `ChatService.handOverStalledAi` moves the connection to
 * `human` with reason `ai_failure` through `#changeAiMode`, which routes it
 * (`#routeHandover` — the agent the member had earlier today if they can take
 * it, else the routing engine in the connection's team, the queue included),
 * leaves the agents-only line ("AI stopped: no answer in time") and pushes
 * `chat_ai_mode_changed`, as every other change of mode does.
 *
 * What it leaves alone, on purpose:
 *
 *   - a connection somebody holds or that waits in the queue — a person is
 *     already its safety net (every `parallel` connection, and an AI-first one
 *     already handed over);
 *   - `paused` — a supervisor held the AI back and chose not to send a person
 *     (tm 293.3); the connection is theirs to decide;
 *   - `null` mode — the AI never took part, which in AI-first cannot happen
 *     (the connection opens `ai`) and elsewhere means a person was routed.
 *
 * The clock starts at the **oldest** visitor message the AI has not followed
 * with an event of its own: a visitor who keeps writing to a dead AI is still
 * waiting since their first message. The batch window (at most
 * `BATCH_WINDOW_SECONDS_MAX`, below the timeout's floor) cannot be mistaken
 * for a stall.
 *
 * Race with a late answer: both sides take the thread's row lock — every mode
 * write does (`ai-mode.ts`), the AI's commit does (`claimAiTurn`). An answer
 * that commits first leaves a bot event the hand-over's re-check, run under
 * the lock, then sees; a hand-over that commits first makes the AI's own check
 * fail and its draft roll back unsent. The visitor never gets both.
 *
 * Like the idle-chat sweep (`chat-timeout.ts`): the tenant list comes from
 * `retention_list_tenants()`, every read and write runs inside `withTenant`,
 * and a pass is idempotent — a connection it handed over is `human` and no
 * longer a candidate.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { DEFAULT_AI_STALL_TIMEOUT_SECONDS } from '@siyahtus/types';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { type ChatService } from './chat-service.js';

/**
 * The predicate over a `threads` row aliased `t`: the connection is stalled as
 * of `cutoff`. One spelling, read by the pass that lists candidates and by the
 * hand-over that re-checks one under its lock.
 *
 * A visitor message is what the AI's own turn answers (`context-loader.ts`
 * `newestVisitorEvent`): the customer's, to everyone, a message or a file.
 * "From the AI" is any bot-authored event after it, by the connection's own
 * event counter, so two events in the same millisecond are still ordered.
 */
function stalledSql(cutoff: Date): Prisma.Sql {
  return Prisma.sql`(
    t.active
    AND t.ai_mode = 'ai'
    AND t.assignee_id IS NULL
    AND t.queue_position IS NULL
    AND EXISTS (
      SELECT 1 FROM events v
      WHERE v.thread_id = t.id
        AND v.author_type = 'customer'
        AND v.recipients = 'all'
        AND v.type IN ('message', 'file')
        AND v.created_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM events b
          WHERE b.thread_id = t.id
            AND b.author_type = 'bot'
            AND b.event_sequence > v.event_sequence
        )
    )
  )`;
}

/**
 * The window for this workspace: the shortest any of its active AI agents set,
 * an agent with no settings row counting as the default. v1 has one
 * customer-facing agent per workspace (tm 390), so this is that agent's value;
 * with several, the soonest is the safe side — a visitor waits no longer than
 * any of them would allow. A workspace with no active agent gets the default:
 * its AI-first connections are answered by nobody, which is a stall too.
 */
export async function readAiStallTimeoutSeconds(tx: TenantClient): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ seconds: number | null }>>`
    SELECT min(COALESCE(h.ai_stall_timeout_seconds, ${DEFAULT_AI_STALL_TIMEOUT_SECONDS}))::int
             AS seconds
      FROM ai_agents a
      LEFT JOIN ai_handoff_settings h ON h.ai_agent_id = a.id
     WHERE a.active AND a.kind = 'ai_agent'`;
  return row?.seconds ?? DEFAULT_AI_STALL_TIMEOUT_SECONDS;
}

/** Whether this connection is stalled as of `cutoff` — the hand-over's re-check. */
export async function aiStalled(
  tx: TenantClient,
  threadId: string,
  cutoff: Date,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ stalled: boolean }>>`
    SELECT ${stalledSql(cutoff)} AS stalled FROM threads t WHERE t.id = ${threadId}`;
  return rows[0]?.stalled === true;
}

export interface TenantStallResult {
  /** Stringified: a bigint cannot be JSON-serialised. */
  licenseId: string;
  timeoutSeconds: number;
  /** Connections the listing found stalled. */
  stalled: number;
  /** Of those, the ones handed to a person — the rest were answered or taken meanwhile. */
  handedOver: number;
}

export interface AiStallReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantStallResult[];
  totals: { tenants: number; stalled: number; handedOver: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class AiStallWatchdog {
  readonly #db: PrismaClient;
  readonly #chats: ChatService;

  constructor(db: PrismaClient, chats: ChatService) {
    this.#db = db;
    this.#chats = chats;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<AiStallReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    const results: TenantStallResult[] = [];
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      results.push(await this.#watchTenant(tenant, now));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        stalled: results.reduce((sum, r) => sum + r.stalled, 0),
        handedOver: results.reduce((sum, r) => sum + r.handedOver, 0),
      },
    };
  }

  async #watchTenant(tenant: TenantRow, now: Date): Promise<TenantStallResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const { timeoutSeconds, cutoff, candidates } = await withTenant(
      this.#db,
      context,
      async (tx) => {
        const seconds = await readAiStallTimeoutSeconds(tx);
        const cutoff = new Date(now.getTime() - seconds * 1000);
        // `(license_id, active, ai_mode)` narrows this to the workspace's open
        // AI connections before any event is looked at.
        const rows = await tx.$queryRaw<Array<{ chat_id: string; thread_id: string }>>`
          SELECT t.chat_id, t.id AS thread_id FROM threads t
           WHERE t.license_id = ${tenant.license_id} AND ${stalledSql(cutoff)}`;
        return { timeoutSeconds: seconds, cutoff, candidates: rows };
      },
    );

    let handedOver = 0;
    for (const row of candidates) {
      const ref = { chatId: row.chat_id, threadId: row.thread_id };
      if (await this.#chats.handOverStalledAi(context, ref, cutoff)) handedOver += 1;
    }

    return {
      licenseId: tenant.license_id.toString(),
      timeoutSeconds,
      stalled: candidates.length,
      handedOver,
    };
  }
}
