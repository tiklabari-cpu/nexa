/**
 * The inactivity sweep (WG-03 · tm 340.2): what happens to a live connection
 * as it goes quiet, before the idle auto-close (`chat-timeout.ts`) ends it.
 * Two windows on `inbox_settings`, both off until a workspace sets them, kept
 * in that order by the settings endpoint (`chatInactivityOrderProblem`):
 *
 *   1. **Unanswered transfer** — `unanswered_transfer_seconds`. An open
 *      connection that has an agent, has had no first reply to the player
 *      (`first_response_at`, the first reply only — LC's "applies only if the
 *      chat has just started") and was given to that agent before the window
 *      (`assigned_at`, which the AI's hand-over moves to the hand-over) goes to
 *      someone else in its team, reason `agent_unresponsive`
 *      (`ChatService.passOnUnanswered`): the team's and the connection's
 *      expertise kept, the silent agent left out; nobody free, or passed on
 *      `UNRESPONSIVE_TRANSFER_LIMIT` times already, and it goes to the front
 *      of the team's queue and the team's leads are told. The silent agent
 *      stops receiving chats unless the workspace turned that off
 *      (`pause_unresponsive_agents`).
 *   2. **Inactive** — `inactive_after_seconds`. An open connection with no
 *      event for that long is marked inactive (`threads.inactive_since`,
 *      `ChatService.settleInactivity`): it stops counting against its
 *      agent's concurrent limit — the drain hands the freed slot out at once
 *      — until its next event, which clears the mark (`#appendEvent`).
 *
 * What the transfer leaves alone, on purpose:
 *
 *   - a connection the AI is answering (`ai_mode = 'ai'`): its agent is the
 *     safety net, not the one keeping the player waiting. When the AI hands
 *     over, the agent's wait starts then (`assigned_at`).
 *   - a connection with no recorded assignment moment (`assigned_at` NULL):
 *     assigned before the column existed (tm 340.1 wrote no backfill). It has
 *     waited since before the deployment; passing it on the first pass after
 *     it would be a burst nobody chose, and the idle auto-close ends it.
 *   - a connection with no team: "someone else in the team" has no meaning.
 *
 * The settings are read the way the idle auto-close reads its window — the
 * most recently saved row (`readChatTimeoutSeconds`) — so the three windows a
 * pass applies are the three one save checked against each other. Brands
 * have no conversations of their own yet (the analysis' brand note): this is
 * the workspace's setting.
 *
 * Races, each settled by a lock the other side takes too:
 *
 *   - **a last-second reply** — the transfer takes the chat row and then the
 *     thread's, the order every append takes them (`#appendEvent`), and asks
 *     its question again under them (`unansweredSql`). A reply that committed
 *     first spares the connection; one still being written waits and lands
 *     after the transfer.
 *   - **a message while it is marked inactive** — the mark is one statement
 *     that sets it only on a row whose event counter is still the one it read;
 *     every append moves the counter.
 *
 * Like the other sweeps: the tenant list comes from
 * `retention_list_tenants()`, every read and write runs inside `withTenant`,
 * and a pass is idempotent — a connection it passed on has a new agent and a
 * fresh `assigned_at`, one it marked is inactive already.
 *
 * Still to come on this sweep: a team in manual assignment mode (WG-07 ·
 * tm 346) turns the transfer into a "nobody took it" notice, and asking the
 * player for an e-mail (WG-08 · tm 342) runs before the transfer in the same
 * pass.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { type ChatService } from './chat-service.js';

/**
 * The predicate over a `threads` row aliased `t`: its agent has left it
 * unanswered since before `cutoff`. One spelling, read by the pass that lists
 * candidates and by the transfer that asks again under the locks.
 */
export function unansweredSql(cutoff: Date): Prisma.Sql {
  return Prisma.sql`(
    t.active
    AND t.assignee_id IS NOT NULL
    AND t.queue_position IS NULL
    AND t.first_response_at IS NULL
    AND t.assigned_at < ${cutoff}
    AND t.ai_mode IS DISTINCT FROM 'ai'
  )`;
}

/**
 * When a `threads` row aliased `t` last moved: its newest event, or its own
 * start when it has none — the idle auto-close's measure too (`lastActivityAt`).
 */
export const LAST_ACTIVITY_SQL = Prisma.sql`COALESCE(
  (SELECT max(e.created_at) FROM events e WHERE e.thread_id = t.id),
  t.created_at
)`;

/** The windows a pass applies, from the workspace's most recently saved row. */
export interface InactivitySettings {
  unansweredTransferSeconds: number | null;
  inactiveAfterSeconds: number | null;
  pauseUnresponsiveAgents: boolean;
}

export async function readInactivitySettings(tx: TenantClient): Promise<InactivitySettings> {
  const row = await tx.inboxSettings.findFirst({
    select: {
      unansweredTransferSeconds: true,
      inactiveAfterSeconds: true,
      pauseUnresponsiveAgents: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  // A stored non-positive window cannot pass the CHECK; read as off all the
  // same, so it can never become "act on every live connection now".
  const positive = (value: number | null | undefined) =>
    typeof value === 'number' && value > 0 ? value : null;
  return {
    unansweredTransferSeconds: positive(row?.unansweredTransferSeconds),
    inactiveAfterSeconds: positive(row?.inactiveAfterSeconds),
    pauseUnresponsiveAgents: row?.pauseUnresponsiveAgents ?? true,
  };
}

export interface TenantInactivityResult {
  /** Stringified: a bigint cannot be JSON-serialised. */
  licenseId: string;
  /** Connections the listing found unanswered. */
  unanswered: number;
  /** Of those, the ones given to someone else in the team. */
  transferred: number;
  /** Of those, the ones put at the front of the team's queue. */
  queued: number;
  /** Connections marked inactive this pass. */
  markedInactive: number;
  /** Connections whose mark this pass took back (the window turned off or grew). */
  clearedInactive: number;
}

export interface ChatInactivityReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantInactivityResult[];
  totals: {
    tenants: number;
    transferred: number;
    queued: number;
    markedInactive: number;
    clearedInactive: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class ChatInactivitySweeper {
  readonly #db: PrismaClient;
  readonly #chats: ChatService;

  constructor(db: PrismaClient, chats: ChatService) {
    this.#db = db;
    this.#chats = chats;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<ChatInactivityReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    const results: TenantInactivityResult[] = [];
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      results.push(await this.#sweepTenant(tenant, now));
    }

    const sum = (key: keyof Omit<TenantInactivityResult, 'licenseId'>) =>
      results.reduce((total, r) => total + r[key], 0);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        transferred: sum('transferred'),
        queued: sum('queued'),
        markedInactive: sum('markedInactive'),
        clearedInactive: sum('clearedInactive'),
      },
    };
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantInactivityResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const { settings, transferCutoff, candidates } = await withTenant(
      this.#db,
      context,
      async (tx) => {
        const settings = await readInactivitySettings(tx);
        const seconds = settings.unansweredTransferSeconds;
        if (seconds === null) return { settings, transferCutoff: null, candidates: [] };
        const cutoff = new Date(now.getTime() - seconds * 1000);
        // `(license_id, active, created_at)` narrows this to the workspace's
        // open connections before any column of theirs is read.
        const rows = await tx.$queryRaw<
          Array<{ chat_id: string; thread_id: string; agent_id: string }>
        >`
          SELECT t.chat_id, t.id AS thread_id, t.assignee_id::text AS agent_id
            FROM threads t
           WHERE t.license_id = ${tenant.license_id} AND ${unansweredSql(cutoff)}
           ORDER BY t.assigned_at ASC, t.id ASC`;
        return { settings, transferCutoff: cutoff, candidates: rows };
      },
    );

    // Longest waiting first: when a team has one free agent and two
    // connections to pass on, the player who has waited longer gets them.
    let transferred = 0;
    let queued = 0;
    for (const row of candidates) {
      const outcome = await this.#chats.passOnUnanswered(
        context,
        { chatId: row.chat_id, threadId: row.thread_id, agentId: row.agent_id },
        transferCutoff!,
        { pauseAgent: settings.pauseUnresponsiveAgents },
      );
      if (outcome?.outcome === 'assigned') transferred += 1;
      else if (outcome?.outcome === 'queued') queued += 1;
    }

    // After the transfers: a connection passed on just now has an event, so
    // it is not quiet, whatever the windows.
    const inactiveSeconds = settings.inactiveAfterSeconds;
    const inactivity = await this.#chats.settleInactivity(
      context,
      inactiveSeconds === null ? null : new Date(now.getTime() - inactiveSeconds * 1000),
    );

    return {
      licenseId: tenant.license_id.toString(),
      unanswered: candidates.length,
      transferred,
      queued,
      markedInactive: inactivity.marked,
      clearedInactive: inactivity.cleared,
    };
  }
}
