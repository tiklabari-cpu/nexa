/**
 * Chat routing and queueing (ADR-08).
 *
 * Given a new conversation, decide which team owns it and which agent gets it:
 *
 *   1. match routing rules → target team (most specific first, then fallback)
 *   2. candidate pool = team members who are `accepting_chats` and below their
 *      concurrent limit
 *   3. take the fullest priority tier present (primary > first > normal > last)
 *   4. within that tier, the least loaded agent
 *   5. ties broken by who has waited longest (`last_assigned_at ASC`)
 *   6. nobody available → fallback team; still nobody → queue
 *
 * Steps 3–5 are where fairness lives. Priority alone would hammer the primary
 * agent; least-loaded alone would ignore the priority the workspace configured;
 * without the tie-break, `ORDER BY` returns rows in whatever order the planner
 * likes and the same agent wins every time a queue drains.
 *
 * Assignment happens inside the caller's transaction so the load count it reads
 * cannot go stale between the decision and the write.
 */
import { GROUP_PRIORITY_ORDER, type GroupPriority } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';

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
  /** 1-based position when nobody could take it; null when assigned. */
  queuePosition: number | null;
  reason: 'assigned' | 'queued' | 'no_group';
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
}

export class RoutingService {
  /**
   * Pick a team and an agent for a new conversation.
   *
   * Runs inside the caller's transaction on purpose: computing load in one
   * transaction and writing the assignment in another lets two chats arriving
   * together both pick the agent who had a free slot a moment ago.
   */
  async route(
    tx: TenantClient,
    licenseId: bigint,
    context: RoutingContext = {},
  ): Promise<RoutingDecision> {
    const groupId = await this.#selectGroup(tx, licenseId, context);
    if (groupId === null) {
      // No team at all — the conversation is still created so nothing is lost,
      // but only a `chats--all` holder will see it.
      return { groupIds: [], assigneeId: null, queuePosition: null, reason: 'no_group' };
    }

    const assignee = await this.#selectAgent(tx, licenseId, groupId);
    if (assignee) {
      await tx.agentMembership.update({
        where: { licenseId_agentId: { licenseId, agentId: assignee } },
        data: { lastAssignedAt: new Date() },
      });
      return { groupIds: [groupId], assigneeId: assignee, queuePosition: null, reason: 'assigned' };
    }

    // Everyone is at capacity or away. Queue rather than assign anyway: an
    // over-limit agent silently accumulating chats is how customers get ignored.
    const fallbackGroupId = await this.#fallbackGroup(tx, licenseId);
    if (fallbackGroupId !== null && fallbackGroupId !== groupId) {
      const fallbackAssignee = await this.#selectAgent(tx, licenseId, fallbackGroupId);
      if (fallbackAssignee) {
        await tx.agentMembership.update({
          where: { licenseId_agentId: { licenseId, agentId: fallbackAssignee } },
          data: { lastAssignedAt: new Date() },
        });
        return {
          groupIds: [fallbackGroupId],
          assigneeId: fallbackAssignee,
          queuePosition: null,
          reason: 'assigned',
        };
      }
    }

    return {
      groupIds: [groupId],
      assigneeId: null,
      queuePosition: await this.#nextQueuePosition(tx, licenseId),
      reason: 'queued',
    };
  }

  /**
   * Re-evaluate the queue after capacity frees up.
   *
   * Called when an agent closes a chat or comes back online. Assigns as many
   * waiting conversations as there is capacity for, oldest first, then renumbers
   * what is left so positions stay contiguous — a queue that reads
   * "you are number 4" with three people in it erodes trust fast.
   */
  async drainQueue(
    tx: TenantClient,
    licenseId: bigint,
    limit = 20,
  ): Promise<Array<{ chatId: string; threadId: string; assigneeId: string }>> {
    const waiting = await tx.thread.findMany({
      where: { licenseId, active: true, assigneeId: null, queuePosition: { not: null } },
      orderBy: [{ queuePosition: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true, chatId: true },
    });
    if (waiting.length === 0) return [];

    const assigned: Array<{ chatId: string; threadId: string; assigneeId: string }> = [];

    for (const thread of waiting) {
      const access = await tx.chatAccess.findMany({
        where: { chatId: thread.chatId },
        select: { groupId: true },
      });

      let assignee: string | null = null;
      for (const { groupId } of access) {
        assignee = await this.#selectAgent(tx, licenseId, groupId);
        if (assignee) break;
      }
      // Stop at the first miss rather than skipping ahead: taking a later chat
      // because an earlier one has no available team would reorder the queue.
      if (!assignee) break;

      await tx.thread.update({
        where: { id: thread.id },
        data: { assigneeId: assignee, queuePosition: null, queuedAt: null },
      });
      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: thread.chatId, userId: assignee } },
        create: { chatId: thread.chatId, userId: assignee, userType: 'agent', present: true },
        update: { present: true },
      });
      await tx.agentMembership.update({
        where: { licenseId_agentId: { licenseId, agentId: assignee } },
        data: { lastAssignedAt: new Date() },
      });

      assigned.push({ chatId: thread.chatId, threadId: thread.id, assigneeId: assignee });
    }

    if (assigned.length > 0) await this.renumberQueue(tx, licenseId);
    return assigned;
  }

  /** Close the gaps left by chats that were assigned or abandoned. */
  async renumberQueue(tx: TenantClient, licenseId: bigint): Promise<void> {
    const waiting = await tx.thread.findMany({
      where: { licenseId, active: true, assigneeId: null, queuePosition: { not: null } },
      orderBy: [{ queuedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    for (const [index, thread] of waiting.entries()) {
      await tx.thread.update({
        where: { id: thread.id },
        data: { queuePosition: index + 1 },
      });
    }
  }

  // -------------------------------------------------------------------------

  async #selectGroup(
    tx: TenantClient,
    licenseId: bigint,
    context: RoutingContext,
  ): Promise<bigint | null> {
    if (context.requestedGroupId !== undefined) {
      const exists = await tx.group.findUnique({
        where: { licenseId_id: { licenseId, id: context.requestedGroupId } },
        select: { id: true },
      });
      if (exists) return exists.id;
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
      if (matches(rule.conditions, context)) return rule.target_group_id;
    }

    const fallback = rules.find((r) => r.is_fallback && r.target_group_id !== null);
    if (fallback?.target_group_id != null) return fallback.target_group_id;

    // No rules configured at all — use the only team, if there is one, so a
    // workspace works before anyone visits the routing settings.
    const only = await tx.group.findFirst({
      where: { licenseId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return only?.id ?? null;
  }

  async #fallbackGroup(tx: TenantClient, licenseId: bigint): Promise<bigint | null> {
    const rule = await tx.routingRule.findFirst({
      where: { licenseId, kind: 'chat', isFallback: true, enabled: true },
      select: { targetGroupId: true },
    });
    return rule?.targetGroupId ?? null;
  }

  /**
   * The agent who should take this chat, or null when nobody can.
   *
   * One query so the load count and the choice cannot disagree.
   */
  async #selectAgent(tx: TenantClient, licenseId: bigint, groupId: bigint): Promise<string | null> {
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
      GROUP BY ga.agent_id, ga.priority, m.last_assigned_at, m.concurrent_chats_limit
      -- Capacity is checked in HAVING, after the count exists.
      HAVING COUNT(t.id) < m.concurrent_chats_limit
    `;

    if (candidates.length === 0) return null;

    // The highest-priority tier that actually has someone available. Falling
    // through tiers matters: if the primary agent is full, `first` should get
    // the chat rather than it going to the queue.
    const bestTier = Math.min(
      ...candidates.map((c) => GROUP_PRIORITY_ORDER[c.priority as GroupPriority] ?? 99),
    );
    const tier = candidates.filter(
      (c) => (GROUP_PRIORITY_ORDER[c.priority as GroupPriority] ?? 99) === bestTier,
    );

    tier.sort((a, b) => {
      if (a.active_chats !== b.active_chats) return a.active_chats - b.active_chats;
      // Never assigned yet goes first, then longest since last assignment.
      // Without this the planner's row order decides, and one agent wins every
      // time a queue drains.
      const aTime = a.last_assigned_at?.getTime() ?? 0;
      const bTime = b.last_assigned_at?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.agent_id.localeCompare(b.agent_id);
    });

    return tier[0]?.agent_id ?? null;
  }

  async #nextQueuePosition(tx: TenantClient, licenseId: bigint): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ next: number }>>`
      SELECT COALESCE(MAX(queue_position), 0) + 1 AS next
      FROM threads
      WHERE license_id = ${licenseId} AND active AND queue_position IS NOT NULL
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
