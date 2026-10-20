/**
 * Chat routing and queueing (ADR-08, ADR-08a).
 *
 * Given a new conversation, decide which team owns it and which agent gets it:
 *
 *   1. match routing rules → target team (most specific first, then fallback)
 *   2. candidate pool = team members who are `accepting_chats`, below their
 *      concurrent limit and holding every expertise the rule and the team
 *      require
 *   3. take the fullest priority tier present (primary > first > normal > last)
 *   4. within that tier, the least loaded agent
 *   5. ties broken by who has waited longest (`last_assigned_at ASC`)
 *   6. nobody available → fallback team (never for the Responsible Gambling
 *      team); still nobody → that team's queue
 *
 * Steps 3–5 are where fairness lives. Priority alone would hammer the primary
 * agent; least-loaded alone would ignore the priority the workspace configured;
 * without the tie-break, `ORDER BY` returns rows in whatever order the planner
 * likes and the same agent wins every time a queue drains.
 *
 * **The queue is a team** (ADR-08a §2.1–§2.3 · tm 305.2). A connection waits
 * in one team's queue (`threads.queue_group_id`); positions, renumbering and
 * the drain go team by team. Within a team the most pressing waits first
 * (`threads.priority DESC`, a rank), then the longest waiting
 * (`queued_at ASC`). The drain stops at a team's first conversation nobody can
 * take — and only that team's: a Responsible Gambling chat waiting for a
 * trained agent no longer holds up a Finance chat behind it.
 *
 * **Locks**, so that concurrent writers stay honest without one lock over the
 * whole workspace:
 *
 *   - a team's queue is numbered, renumbered and drained under that team's
 *     advisory lock (`#lockTeam`), held to the caller's commit: two
 *     transactions never number one team's queue at once, two teams never wait
 *     for each other;
 *   - an agent is claimed under their membership row (`#claim`, `FOR UPDATE
 *     SKIP LOCKED`) and their load counted again once the row is held, so two
 *     drains (or a drain and a new chat) cannot both give the last free slot;
 *   - waiting rows are taken `FOR UPDATE SKIP LOCKED`: a drain or a renumber
 *     never waits for a connection another transaction is changing — that
 *     transaction may itself be waiting for the team's lock.
 *
 * Assignment happens inside the caller's transaction so the load count it reads
 * cannot go stale between the decision and the write.
 */
import { Prisma } from '@prisma/client';
import {
  GROUP_PRIORITY_ORDER,
  RESPONSIBLE_GAMBLING_ROLE,
  THREAD_PRIORITY_RANK,
  type GroupPriority,
  type ThreadPriority,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { enterQueue, leaveQueue } from './queue-entries.js';

export interface RoutingContext {
  /** Page the visitor was on — matched against rule conditions. */
  url?: string;
  /** ISO country code from the visitor's geolocation. */
  countryCode?: string;
  /** Explicit team request, e.g. from a widget configured per department. */
  requestedGroupId?: bigint;
}

export interface RoutingDecision {
  groupIds: bigint[];
  assigneeId: string | null;
  /** 1-based position in its team's queue when nobody could take it; null when assigned. */
  queuePosition: number | null;
  /**
   * The team whose queue it waits in (`threads.queue_group_id`, ADR-08a §2.1)
   * — the team routing chose, also when its fallback team had nobody either.
   * Null unless queued.
   */
  queueGroupId: bigint | null;
  reason: 'assigned' | 'queued' | 'no_group';
}

/** What a drain is told about the transaction it runs in (`drainQueue`). */
export interface DrainOptions {
  /**
   * Agents this transaction freed a slot for — closed their chat, came
   * online, gave one back to the AI. Their teams' queues are drained under a
   * waiting lock, so the slot cannot be lost to a drain running alongside that
   * did not see it. Every other team is drained only if no other transaction
   * is draining it at this moment: nothing this one changed is in it, and the
   * one that holds it sees what this one would. Omitted: every team is waited
   * for.
   */
  readonly freed?: readonly string[];
  /**
   * Teams a waiting connection of this transaction just left (closed, given
   * back to the AI): renumbered under a waiting lock, assigned or not.
   */
  readonly left?: readonly (bigint | null)[];
  /** How many connections one team's drain hands out at most. */
  readonly limit?: number;
}

interface CandidateRow {
  agent_id: string;
  priority: string;
  active_chats: number;
  last_assigned_at: Date | null;
}

interface RuleRow {
  target_group_id: bigint | null;
  conditions: RoutingConditions;
  is_fallback: boolean;
  priority: number;
}

interface RoutingConditions {
  url_contains?: string[];
  url_equals?: string[];
  country_codes?: string[];
  /**
   * Areas of expertise an agent must hold to receive this rule's chats
   * (FR-MOD-08.6.3). Stored as plain numbers because jsonb has no bigint; the
   * ids are small per-license integers. Not a *match* condition — it never
   * decides which team wins, only which agents inside that team qualify.
   */
  expertise_ids?: number[];
}

/**
 * A chosen team, together with any expertise the matched rule demands of its
 * agents. The requirement is a property of the *rule*, so it is decided once
 * and carried through every candidate query in `route()` — the primary team and
 * the fallback team alike. That is what makes "an agent without the expertise is
 * never chosen" hold at every stage rather than only the first.
 */
interface GroupSelection {
  groupId: bigint;
  requiredExpertiseIds: bigint[];
}

/**
 * A team as routing applies it (AU-01 · tm 305.1's columns): its topic, and
 * the expertise it requires — every area — of each agent it gives a
 * conversation to (`group_expertise`). The team's requirement holds wherever
 * the team is the pool: routing, the fallback, the drain, a same-day return.
 */
interface TeamRules {
  groupId: bigint;
  topicRole: string | null;
  expertiseIds: bigint[];
}

/** What a hand-off to a team came to (`assignWithinGroup`). */
export type TeamHandOff =
  { outcome: 'assigned'; assigneeId: string } | { outcome: 'queued'; assigneeId: null };

/** The waiting connection at the front of a team's queue (`#drainTeam`). */
interface HeadRow {
  id: string;
  chat_id: string;
  customer_id: string;
}

/**
 * One chat the queue drain just handed to an agent.
 *
 * `customerId` is here rather than left for the caller to fetch because both
 * callers announce this assignment on two channels at once — `incoming_chat` to
 * the agent who now owns it, and the traffic board's own visitor signal
 * (FR-MOD-03.1.1), which is keyed on the person waiting rather than on the
 * chat. Neither caller is inside the transaction any more by the time it
 * publishes, so a second read would be a second query per drained chat.
 */
export interface DrainedAssignment {
  chatId: string;
  threadId: string;
  assigneeId: string;
  customerId: string;
}

/** How many waiting connections one team's drain hands out by default. */
const DRAIN_LIMIT_PER_TEAM = 20;

/** The expertise a matched rule demands, as bigints for the candidate query. */
function requiredExpertise(conditions: RoutingConditions): bigint[] {
  const ids = conditions.expertise_ids;
  if (!ids?.length) return [];
  return ids.map((id) => BigInt(id));
}

/** Both requirements at once — the rule's and the team's — each area once. */
function allOf(...lists: readonly bigint[][]): bigint[] {
  return [...new Set(lists.flat())];
}

/** Ascending, each once: the order team locks are taken in. */
function teamOrder(ids: Iterable<bigint | null>): bigint[] {
  const unique = [...new Set([...ids].filter((id): id is bigint => id !== null))];
  return unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export class RoutingService {
  /**
   * Pick a team and an agent for a new conversation.
   *
   * Runs inside the caller's transaction on purpose: computing load in one
   * transaction and writing the assignment in another lets two chats arriving
   * together both pick the agent who had a free slot a moment ago.
   *
   * Queued, the decision holds the team's queue lock to the caller's commit,
   * so the position it hands out is still the next one when the caller writes
   * the row.
   */
  async route(
    tx: TenantClient,
    licenseId: bigint,
    context: RoutingContext = {},
  ): Promise<RoutingDecision> {
    const selection = await this.#selectGroup(tx, licenseId, context);
    if (selection === null) {
      // No team at all — the conversation is still created so nothing is lost,
      // but only a `chats--all` holder will see it.
      return {
        groupIds: [],
        assigneeId: null,
        queuePosition: null,
        queueGroupId: null,
        reason: 'no_group',
      };
    }
    const { groupId, requiredExpertiseIds } = selection;
    const team = await this.#team(tx, licenseId, groupId);

    const assignee = await this.#claimFromTeam(
      tx,
      licenseId,
      groupId,
      allOf(requiredExpertiseIds, team.expertiseIds),
    );
    if (assignee) {
      return {
        groupIds: [groupId],
        assigneeId: assignee,
        queuePosition: null,
        queueGroupId: null,
        reason: 'assigned',
      };
    }

    // Everyone is at capacity or away. Queue rather than assign anyway: an
    // over-limit agent silently accumulating chats is how customers get ignored.
    //
    // A Responsible Gambling conversation has no fallback (ADR-08a §2.6): it
    // waits for the team's own trained agents rather than overflow to a desk
    // that is not trained for it.
    if (team.topicRole !== RESPONSIBLE_GAMBLING_ROLE) {
      const fallbackGroupId = await this.#fallbackGroup(tx, licenseId);
      if (fallbackGroupId !== null && fallbackGroupId !== groupId) {
        // The expertise requirement follows the chat into the fallback team: a
        // billing question overflowing to another desk still needs a billing
        // agent, not just any free one — and the fallback team's own
        // requirement holds there too.
        const fallback = await this.#team(tx, licenseId, fallbackGroupId);
        const fallbackAssignee = await this.#claimFromTeam(
          tx,
          licenseId,
          fallbackGroupId,
          allOf(requiredExpertiseIds, fallback.expertiseIds),
        );
        if (fallbackAssignee) {
          return {
            groupIds: [fallbackGroupId],
            assigneeId: fallbackAssignee,
            queuePosition: null,
            queueGroupId: null,
            reason: 'assigned',
          };
        }
      }
    }

    // It waits in the team routing chose — not the fallback's, which had
    // nobody either (ADR-08a §2.1).
    await this.#lockTeam(tx, licenseId, groupId, true);
    return {
      groupIds: [groupId],
      assigneeId: null,
      queuePosition: await this.#nextQueuePosition(tx, licenseId, groupId),
      queueGroupId: groupId,
      reason: 'queued',
    };
  }

  /**
   * The team a new conversation belongs to, with nobody chosen in it: the
   * first step of `route()` alone — the rules, the fallback rule, the only
   * team. For a connection the AI answers first (tm 293.2 · `ai-first.ts`):
   * that team sees it while nobody is assigned, and `route()` runs when it
   * leaves the AI. Writes nothing, so no `last_assigned_at` moves either.
   */
  async team(tx: TenantClient, licenseId: bigint, context: RoutingContext = {}): Promise<bigint[]> {
    const selection = await this.#selectGroup(tx, licenseId, context);
    return selection ? [selection.groupId] : [];
  }

  /**
   * Give a returning member's new connection back to the agent who had their
   * earlier one that day (ID-02-S5), if that agent can take a chat right now.
   *
   * "Can" is exactly `#claim`'s rule, asked about one named agent: accepting
   * chats, not suspended, not awaiting approval, below their own concurrent
   * limit. Asked inside the caller's transaction for `route`'s reason — a load
   * count read in one transaction and acted on in another lets two arrivals
   * both take the last free slot. On a yes the assignment is recorded the way
   * `route` records one (`last_assigned_at`), so the least-recently-assigned
   * tie-break stays honest; on a no nothing is written and the caller routes
   * normally.
   *
   * Continuity does not outrank the Responsible Gambling team's rule
   * (ADR-08a §2.6): when `context` routes the connection to that team, the
   * earlier agent gets it back only as one of its members holding everything
   * it requires — otherwise it is routed into the team like any other.
   */
  async assignIfAvailable(
    tx: TenantClient,
    licenseId: bigint,
    agentId: string,
    context: RoutingContext = {},
  ): Promise<boolean> {
    const selection = await this.#selectGroup(tx, licenseId, context);
    if (selection) {
      const team = await this.#team(tx, licenseId, selection.groupId);
      if (team.topicRole === RESPONSIBLE_GAMBLING_ROLE) {
        const qualified = await this.#candidates(
          tx,
          licenseId,
          team.groupId,
          allOf(selection.requiredExpertiseIds, team.expertiseIds),
        );
        if (!qualified.includes(agentId)) return false;
      }
    }
    return this.#claim(tx, licenseId, agentId);
  }

  /**
   * Re-evaluate the queues after capacity frees up.
   *
   * Called when an agent closes a chat, comes back online or gives one back to
   * the AI. Team by team (ADR-08a §2.2): each team's waiting conversations are
   * handed to its own agents — the team's required expertise applied — most
   * pressing first, then oldest, as many as there is capacity for; then what
   * is left is renumbered so positions stay contiguous — a queue that reads
   * "you are number 4" with three people in it erodes trust fast.
   *
   * A queued connection that names no team, or a team since deleted, is first
   * given one (`#adoptStrays`): an old replica mid-rollout queues without
   * `queue_group_id`, and a deleted team's queue would otherwise wait forever.
   */
  async drainQueue(
    tx: TenantClient,
    licenseId: bigint,
    options: DrainOptions = {},
  ): Promise<DrainedAssignment[]> {
    await this.#adoptStrays(tx, licenseId);

    const waiting = await tx.$queryRaw<Array<{ queue_group_id: bigint }>>`
      SELECT DISTINCT queue_group_id
      FROM threads
      WHERE license_id = ${licenseId}
        AND active AND assignee_id IS NULL AND queue_position IS NOT NULL
        AND queue_group_id IS NOT NULL
    `;
    const left = teamOrder(options.left ?? []);
    const freedTeams =
      options.freed === undefined ? null : await this.#teamsOf(tx, licenseId, options.freed);
    const limit = options.limit ?? DRAIN_LIMIT_PER_TEAM;

    const assigned: DrainedAssignment[] = [];
    for (const groupId of teamOrder([...waiting.map((r) => r.queue_group_id), ...left])) {
      const wait = freedTeams === null || freedTeams.has(groupId) || left.includes(groupId);
      if (!(await this.#lockTeam(tx, licenseId, groupId, wait))) continue;
      assigned.push(...(await this.#drainTeam(tx, licenseId, groupId, limit)));
      await this.#renumber(tx, licenseId, groupId);
    }
    return assigned;
  }

  /**
   * Close the gaps left by chats that were assigned or abandoned, and put the
   * team's queue in its order: most pressing first, then the longest waiting
   * (ADR-08a §2.3). One team, or every team with someone waiting.
   */
  async renumberQueue(tx: TenantClient, licenseId: bigint, groupId?: bigint): Promise<void> {
    const teams =
      groupId !== undefined
        ? [groupId]
        : teamOrder(
            (
              await tx.$queryRaw<Array<{ queue_group_id: bigint }>>`
                SELECT DISTINCT queue_group_id
                FROM threads
                WHERE license_id = ${licenseId}
                  AND active AND assignee_id IS NULL AND queue_position IS NOT NULL
                  AND queue_group_id IS NOT NULL
              `
            ).map((r) => r.queue_group_id),
          );
    for (const team of teams) {
      await this.#lockTeam(tx, licenseId, team, true);
      await this.#renumber(tx, licenseId, team);
    }
  }

  /**
   * Hand a connection to a team (IN-04 · `POST /chats/{id}/transfer`, the
   * AI's and a rule bot's hand-off to a named team): one of its members by
   * the order `route()` uses — the team's required expertise applied — or,
   * with nobody free, the back of its priority in that team's queue, which
   * the drain hands out when someone is (`drainQueue`). Never refused for
   * being unstaffed, and never the fallback team: the hand-off named this
   * team, so this team's people answer it (IN-04-S1).
   *
   * `exclude` are agents not to give it to — whoever handed it off and
   * whoever held it: a hand-off to one's own team means "someone else". It
   * may still reach them later through the queue.
   *
   * Writes the connection's assignment or its place in the queue, its
   * queue stay (the one it leaves, the one it starts) and the assignee's
   * presence, in the caller's transaction. Both teams' queue locks are taken
   * in ascending order (`#lockTeam`) when it was waiting in another.
   */
  async assignWithinGroup(
    tx: TenantClient,
    licenseId: bigint,
    groupId: bigint,
    threadId: string,
    options: { exclude?: readonly string[]; at?: Date } = {},
  ): Promise<TeamHandOff> {
    const at = options.at ?? new Date();
    const [row] = await tx.$queryRaw<
      Array<{ chat_id: string; queue_group_id: bigint | null; queued: boolean }>
    >`
      SELECT chat_id, queue_group_id,
             (assignee_id IS NULL AND queue_position IS NOT NULL) AS queued
      FROM threads
      WHERE id = ${threadId} AND license_id = ${licenseId}
      FOR UPDATE
    `;
    if (!row) throw new Error(`assignWithinGroup: no connection ${threadId}`);
    const left = row.queued ? row.queue_group_id : null;
    const teams = teamOrder([left, groupId]);
    for (const team of teams) await this.#lockTeam(tx, licenseId, team, true);

    // The stay it waited out ends with this hand-off, whatever comes next.
    await leaveQueue(tx, threadId, 'transferred', at);

    const team = await this.#team(tx, licenseId, groupId);
    const assignee = await this.#claimFromTeam(
      tx,
      licenseId,
      groupId,
      team.expertiseIds,
      options.exclude,
    );
    if (assignee) {
      await tx.thread.update({
        where: { id: threadId },
        data: {
          assigneeId: assignee,
          groupId,
          queuePosition: null,
          queuedAt: null,
          queueGroupId: null,
        },
      });
      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: row.chat_id, userId: assignee } },
        create: { chatId: row.chat_id, userId: assignee, userType: 'agent', present: true },
        update: { present: true },
      });
      if (left !== null) await this.#renumber(tx, licenseId, left);
      return { outcome: 'assigned', assigneeId: assignee };
    }

    await tx.thread.update({
      where: { id: threadId },
      data: {
        assigneeId: null,
        groupId,
        queueGroupId: groupId,
        // Behind everyone already waiting; the renumber below puts it in its
        // priority's place.
        queuePosition: await this.#nextQueuePosition(tx, licenseId, groupId),
        queuedAt: at,
      },
    });
    await enterQueue(tx, { licenseId, threadId, groupId, enteredAt: at });
    for (const team of teams) await this.#renumber(tx, licenseId, team);
    return { outcome: 'queued', assigneeId: null };
  }

  /**
   * Raise how pressing a connection is (ADR-08a §2.3) — never lower it: a
   * hand-over's priority (AI-09 · the guardrails, the workspace's rules) is a
   * floor. Waiting already, the connection moves up its own team's queue and
   * no other.
   */
  async raisePriority(
    tx: TenantClient,
    licenseId: bigint,
    threadId: string,
    priority: ThreadPriority,
  ): Promise<void> {
    const rank = THREAD_PRIORITY_RANK[priority];
    const [raised] = await tx.$queryRaw<Array<{ queue_group_id: bigint | null; queued: boolean }>>`
      UPDATE threads
      SET priority = ${rank}
      WHERE id = ${threadId} AND license_id = ${licenseId} AND priority < ${rank}
      RETURNING queue_group_id,
                (active AND assignee_id IS NULL AND queue_position IS NOT NULL) AS queued
    `;
    if (raised?.queued && raised.queue_group_id !== null) {
      await this.renumberQueue(tx, licenseId, raised.queue_group_id);
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Hand out one team's queue, front first, while its agents have room.
   *
   * Stop at the first miss rather than skipping ahead: taking a later chat
   * because an earlier one cannot be served would reorder the queue. Inside a
   * team every waiting chat asks the same pool, so a miss means the team is
   * full — and the stop is this team's alone (ADR-08a §2.2).
   *
   * The team's own required expertise is applied here (`group_expertise`). A
   * routing rule's requirement is not: a queued chat does not carry the rule
   * that matched it, so that one narrows the initial decision (`route()`)
   * only.
   */
  async #drainTeam(
    tx: TenantClient,
    licenseId: bigint,
    groupId: bigint,
    limit: number,
  ): Promise<DrainedAssignment[]> {
    const team = await this.#team(tx, licenseId, groupId);
    const assigned: DrainedAssignment[] = [];

    while (assigned.length < limit) {
      // `customer_id` rides along because a drained chat is a row on the
      // real-time board too: it leaves `queued` for `chatting` the moment this
      // assignment lands, and the board's signal is keyed on the visitor
      // rather than on the chat (FR-MOD-03.1.1).
      const [head] = await tx.$queryRaw<HeadRow[]>`
        SELECT t.id, t.chat_id, c.customer_id::text AS customer_id
        FROM threads t
        JOIN chats c ON c.id = t.chat_id
        WHERE t.license_id = ${licenseId}
          AND t.active AND t.assignee_id IS NULL AND t.queue_position IS NOT NULL
          AND t.queue_group_id = ${groupId}
        ORDER BY t.priority DESC, t.queued_at ASC NULLS LAST, t.created_at ASC, t.id ASC
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED
      `;
      if (!head) break;

      const assignee = await this.#claimFromTeam(tx, licenseId, groupId, team.expertiseIds);
      if (!assignee) break;

      await tx.thread.update({
        where: { id: head.id },
        data: { assigneeId: assignee, queuePosition: null, queuedAt: null },
      });
      // The wait it ends goes on the record in the same write (RP-04).
      await leaveQueue(tx, head.id, 'assigned');
      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: head.chat_id, userId: assignee } },
        create: { chatId: head.chat_id, userId: assignee, userType: 'agent', present: true },
        update: { present: true },
      });

      assigned.push({
        chatId: head.chat_id,
        threadId: head.id,
        assigneeId: assignee,
        customerId: head.customer_id,
      });
    }
    return assigned;
  }

  /**
   * Number one team's waiting connections 1…n in queue order, writing only the
   * rows whose number changes. A row another transaction holds is left as it
   * is — that transaction is changing it, and may be waiting for this team's
   * lock — and is numbered by the next renumber.
   */
  async #renumber(tx: TenantClient, licenseId: bigint, groupId: bigint): Promise<void> {
    await tx.$executeRaw`
      WITH ranked AS (
        SELECT q.id,
               ROW_NUMBER() OVER (
                 ORDER BY q.priority DESC, q.queued_at ASC NULLS LAST, q.created_at ASC, q.id ASC
               )::int AS position
        FROM threads q
        WHERE q.license_id = ${licenseId}
          AND q.active AND q.assignee_id IS NULL AND q.queue_position IS NOT NULL
          AND q.queue_group_id = ${groupId}
      ),
      movable AS (
        SELECT t.id
        FROM threads t
        JOIN ranked r ON r.id = t.id
        WHERE t.queue_position IS DISTINCT FROM r.position
        FOR UPDATE OF t SKIP LOCKED
      )
      UPDATE threads t
      SET queue_position = r.position
      FROM ranked r
      WHERE t.id = r.id
        AND t.id IN (SELECT id FROM movable)
        AND t.active AND t.assignee_id IS NULL AND t.queue_position IS NOT NULL
    `;
  }

  /**
   * Give a queued connection with no live team one: the rule
   * `20261020120100_threads_queue_group_backfill` applied — the team routing
   * gave it (`threads.group_id`), else the chat's first access group — then
   * the workspace's fallback team. Either must still exist. A connection none
   * of them fits keeps no team and waits outside every team's queue; it holds
   * up nobody.
   */
  async #adoptStrays(tx: TenantClient, licenseId: bigint): Promise<void> {
    await tx.$executeRaw`
      UPDATE threads t
      SET queue_group_id = COALESCE(
        (SELECT g.id FROM groups g WHERE g.license_id = t.license_id AND g.id = t.group_id),
        (SELECT MIN(ca.group_id) FROM chat_access ca
           JOIN groups g ON g.license_id = t.license_id AND g.id = ca.group_id
         WHERE ca.chat_id = t.chat_id),
        (SELECT r.target_group_id FROM routing_rules r
           JOIN groups g ON g.license_id = r.license_id AND g.id = r.target_group_id
         WHERE r.license_id = t.license_id AND r.kind = 'chat' AND r.is_fallback AND r.enabled
         ORDER BY r.priority ASC
         LIMIT 1)
      )
      WHERE t.id IN (
        SELECT s.id
        FROM threads s
        WHERE s.license_id = ${licenseId}
          AND s.active AND s.assignee_id IS NULL AND s.queue_position IS NOT NULL
          AND (
            s.queue_group_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM groups g WHERE g.license_id = s.license_id AND g.id = s.queue_group_id
            )
          )
        FOR UPDATE SKIP LOCKED
      )
    `;
  }

  /** The teams these agents are members of. */
  async #teamsOf(
    tx: TenantClient,
    licenseId: bigint,
    agentIds: readonly string[],
  ): Promise<Set<bigint>> {
    if (agentIds.length === 0) return new Set();
    const rows = await tx.groupAgent.findMany({
      where: { licenseId, agentId: { in: [...agentIds] } },
      select: { groupId: true },
    });
    return new Set(rows.map((r) => r.groupId));
  }

  /**
   * Take a team's queue lock: transaction-scoped, keyed on (licence, team) in
   * a namespace of its own. `wait` false only tries — false back when another
   * transaction holds it. Taken in ascending team order wherever a transaction
   * takes more than one, so two of them cannot each hold the lock the other
   * waits for.
   */
  async #lockTeam(
    tx: TenantClient,
    licenseId: bigint,
    groupId: bigint,
    wait: boolean,
  ): Promise<boolean> {
    const key = `${licenseId}:${groupId}`;
    if (wait) {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('siyahtus.team-queue'), hashtext(${key}))`;
      return true;
    }
    const [row] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext('siyahtus.team-queue'), hashtext(${key})) AS locked`;
    return row?.locked === true;
  }

  /** A team's topic and required expertise (`TeamRules`); a deleted team requires nothing. */
  async #team(tx: TenantClient, licenseId: bigint, groupId: bigint): Promise<TeamRules> {
    const row = await tx.group.findUnique({
      where: { licenseId_id: { licenseId, id: groupId } },
      select: {
        topicRole: true,
        requiredExpertise: { select: { expertiseId: true }, orderBy: { expertiseId: 'asc' } },
      },
    });
    return {
      groupId,
      topicRole: row?.topicRole ?? null,
      expertiseIds: row?.requiredExpertise.map((r) => r.expertiseId) ?? [],
    };
  }

  async #selectGroup(
    tx: TenantClient,
    licenseId: bigint,
    context: RoutingContext,
  ): Promise<GroupSelection | null> {
    if (context.requestedGroupId !== undefined) {
      const exists = await tx.group.findUnique({
        where: { licenseId_id: { licenseId, id: context.requestedGroupId } },
        select: { id: true },
      });
      // An explicit team request bypasses the rules, so it carries no rule's
      // expertise requirement — it is a deliberate "send it here", not a
      // routed match. The team's own requirement still holds (`#team`).
      if (exists) return { groupId: exists.id, requiredExpertiseIds: [] };
      // An unknown team id is ignored rather than fatal — the widget may be
      // configured with a team that was since deleted, and refusing the chat
      // would punish the customer for a stale snippet.
    }

    const rules = await tx.$queryRaw<RuleRow[]>`
      SELECT target_group_id, conditions, is_fallback, priority
      FROM routing_rules
      WHERE license_id = ${licenseId} AND kind = 'chat' AND enabled
      ORDER BY is_fallback ASC, priority ASC
    `;

    for (const rule of rules) {
      if (rule.is_fallback) continue; // considered last, below
      if (rule.target_group_id === null) continue;
      if (matches(rule.conditions, context)) {
        return {
          groupId: rule.target_group_id,
          requiredExpertiseIds: requiredExpertise(rule.conditions),
        };
      }
    }

    const fallback = rules.find((r) => r.is_fallback && r.target_group_id !== null);
    if (fallback?.target_group_id != null) {
      return {
        groupId: fallback.target_group_id,
        requiredExpertiseIds: requiredExpertise(fallback.conditions),
      };
    }

    // No rules configured at all — use the only team, if there is one, so a
    // workspace works before anyone visits the routing settings.
    const only = await tx.group.findFirst({
      where: { licenseId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return only ? { groupId: only.id, requiredExpertiseIds: [] } : null;
  }

  async #fallbackGroup(tx: TenantClient, licenseId: bigint): Promise<bigint | null> {
    const rule = await tx.routingRule.findFirst({
      where: { licenseId, kind: 'chat', isFallback: true, enabled: true },
      select: { targetGroupId: true },
    });
    return rule?.targetGroupId ?? null;
  }

  /**
   * The agent who takes this chat in this team, or null when nobody can: the
   * candidates in ADR-08 order, the first one `#claim` holds.
   */
  async #claimFromTeam(
    tx: TenantClient,
    licenseId: bigint,
    groupId: bigint,
    requiredExpertiseIds: bigint[],
    exclude: readonly string[] = [],
  ): Promise<string | null> {
    for (const agentId of await this.#candidates(tx, licenseId, groupId, requiredExpertiseIds)) {
      if (exclude.includes(agentId)) continue;
      if (await this.#claim(tx, licenseId, agentId)) return agentId;
    }
    return null;
  }

  /**
   * Take an agent for one chat: hold their membership row, count their load
   * again with it held, and record the assignment (`last_assigned_at`).
   *
   * Every routed assignment goes through here, so a second transaction about
   * to give the same agent a chat is either holding the row — and this one
   * passes them over (`SKIP LOCKED`) rather than wait on a transaction that
   * may be waiting on it — or has committed, and the count sees its chat.
   * False when the agent is not accepting chats, is suspended or awaiting
   * approval, is at their limit, or is being given a chat elsewhere right now.
   */
  async #claim(tx: TenantClient, licenseId: bigint, agentId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ has_capacity: boolean }>>`
      SELECT (
               SELECT COUNT(*)
               FROM threads t
               WHERE t.license_id = m.license_id AND t.assignee_id = m.agent_id AND t.active
             ) < m.concurrent_chats_limit AS has_capacity
      FROM agent_memberships m
      WHERE m.license_id = ${licenseId}
        AND m.agent_id = ${agentId}::uuid
        AND m.routing_status = 'accepting_chats'
        AND NOT m.suspended
        AND NOT m.awaiting_approval
      FOR UPDATE OF m SKIP LOCKED
    `;
    if (!row?.has_capacity) return false;

    await tx.agentMembership.update({
      where: { licenseId_agentId: { licenseId, agentId } },
      data: { lastAssignedAt: new Date() },
    });
    return true;
  }

  /**
   * The agents who could take this chat, best first — one query so the load
   * count and the order cannot disagree. `#claim` makes the choice stick.
   *
   * When the matched rule or the team demands expertise
   * (`requiredExpertiseIds`), the pool is narrowed to agents who hold *every*
   * listed area. This is a hard filter, never a preference: a rule wanting
   * "Billing" must never fall through to a general agent — that is the "expert
   * chat handed to the wrong desk" failure this feature exists to prevent. If
   * nobody qualifies, `route()`'s existing fallback-team → queue chain runs
   * unchanged (the same filter is applied there too), so the requirement is
   * narrowed but never quietly dropped.
   *
   * The expertise test is an `IN (subquery)`, not a join, on purpose: joining
   * `agent_expertise` would multiply the candidate rows and corrupt
   * `COUNT(t.id)` — an agent holding two required areas would read as twice the
   * load. The subquery keeps the capacity count exactly as it was.
   *
   * The order: the highest-priority tier that actually has someone available
   * first (if the primary agent is full, `first` should get the chat rather
   * than it going to the queue), within a tier the least loaded, then never
   * assigned yet, then longest since last assignment. Without the last two the
   * planner's row order decides, and one agent wins every time a queue drains.
   */
  async #candidates(
    tx: TenantClient,
    licenseId: bigint,
    groupId: bigint,
    requiredExpertiseIds: bigint[] = [],
  ): Promise<string[]> {
    const expertiseClause =
      requiredExpertiseIds.length > 0
        ? Prisma.sql`
          AND ga.agent_id IN (
            SELECT ae.agent_id
            FROM agent_expertise ae
            WHERE ae.license_id = ${licenseId}
              AND ae.expertise_id IN (${Prisma.join(requiredExpertiseIds)})
            GROUP BY ae.agent_id
            HAVING COUNT(DISTINCT ae.expertise_id) = ${requiredExpertiseIds.length}
          )`
        : Prisma.empty;

    const candidates = await tx.$queryRaw<CandidateRow[]>`
      SELECT ga.agent_id::text AS agent_id,
             ga.priority,
             COUNT(t.id)::int AS active_chats,
             m.last_assigned_at
      FROM group_agents ga
      JOIN agent_memberships m
        ON m.license_id = ga.license_id AND m.agent_id = ga.agent_id
      LEFT JOIN threads t
        ON t.assignee_id = ga.agent_id AND t.active AND t.license_id = ${licenseId}
      WHERE ga.license_id = ${licenseId}
        AND ga.group_id = ${groupId}
        AND m.routing_status = 'accepting_chats'
        AND NOT m.suspended
        AND NOT m.awaiting_approval
        ${expertiseClause}
      GROUP BY ga.agent_id, ga.priority, m.last_assigned_at, m.concurrent_chats_limit
      -- Capacity is checked in HAVING, after the count exists.
      HAVING COUNT(t.id) < m.concurrent_chats_limit
    `;

    const tierOf = (c: CandidateRow) => GROUP_PRIORITY_ORDER[c.priority as GroupPriority] ?? 99;
    candidates.sort((a, b) => {
      if (tierOf(a) !== tierOf(b)) return tierOf(a) - tierOf(b);
      if (a.active_chats !== b.active_chats) return a.active_chats - b.active_chats;
      const aTime = a.last_assigned_at?.getTime() ?? 0;
      const bTime = b.last_assigned_at?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.agent_id.localeCompare(b.agent_id);
    });
    return candidates.map((c) => c.agent_id);
  }

  /** The next number in one team's queue — read under the team's lock. */
  async #nextQueuePosition(tx: TenantClient, licenseId: bigint, groupId: bigint): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ next: number }>>`
      SELECT (COALESCE(MAX(queue_position), 0) + 1)::int AS next
      FROM threads
      WHERE license_id = ${licenseId}
        AND active AND assignee_id IS NULL AND queue_position IS NOT NULL
        AND queue_group_id = ${groupId}
    `;
    return rows[0]?.next ?? 1;
  }
}

/**
 * Whether a rule's conditions hold for this visit.
 *
 * A rule with no conditions matches everything — that is how a catch-all is
 * expressed without marking it the fallback.
 */
function matches(conditions: RoutingConditions, context: RoutingContext): boolean {
  const checks: boolean[] = [];

  if (conditions.url_contains?.length) {
    const url = context.url ?? '';
    checks.push(conditions.url_contains.some((fragment) => url.includes(fragment)));
  }
  if (conditions.url_equals?.length) {
    checks.push(conditions.url_equals.some((candidate) => candidate === context.url));
  }
  if (conditions.country_codes?.length) {
    const country = context.countryCode?.toUpperCase() ?? '';
    checks.push(conditions.country_codes.some((code) => code.toUpperCase() === country));
  }

  // All stated conditions must hold: a rule reading "pricing pages, from the UK"
  // should not fire for a UK visitor on the home page.
  return checks.every(Boolean);
}
