/**
 * The ticket-rule engine, applied when a ticket is opened (FR-MOD-08.6.2).
 *
 * Every enabled rule whose condition matches the new ticket runs, in `position`
 * order, and applies its action: assign the ticket, set its priority, tag it.
 * Later rules win over earlier ones for the single-valued actions (assignee,
 * team, priority); tags accumulate. The whole thing runs inside the caller's
 * creation transaction, so a ticket is never briefly visible unassigned before
 * a rule reaches it.
 *
 * A rule must never break ticket creation: an action that points at an agent or
 * team that has since gone away is skipped, not raised. The rule's targets were
 * validated when it was saved; this is the defence for the gap between then and
 * now.
 */
import type { Prisma } from '@prisma/client';
import type { TicketRuleActions, TicketRuleConditions } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';
import { matchesTicketRule, type TicketRuleContext } from './ticket-rule-matching.js';

export async function applyTicketRules(
  tx: TenantClient,
  licenseId: bigint,
  ticketId: string,
  ctx: TicketRuleContext,
): Promise<void> {
  const rules = await tx.ticketRule.findMany({
    where: { licenseId, enabled: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { conditions: true, actions: true },
  });
  if (rules.length === 0) return;

  const update: Prisma.TicketUpdateInput = {};
  const tagNames = new Set<string>();
  let touched = false;

  for (const rule of rules) {
    const conditions = (rule.conditions ?? {}) as TicketRuleConditions;
    const actions = (rule.actions ?? {}) as TicketRuleActions;
    if (!matchesTicketRule(conditions, ctx)) continue;

    if (actions.assign_agent_id && (await isActiveAgent(tx, licenseId, actions.assign_agent_id))) {
      update.assigneeId = actions.assign_agent_id;
      touched = true;
    }
    if (
      actions.assign_group_id != null &&
      (await groupExists(tx, licenseId, actions.assign_group_id))
    ) {
      update.groupId = BigInt(actions.assign_group_id);
      touched = true;
    }
    if (actions.priority != null) {
      update.priority = actions.priority;
      touched = true;
    }
    const tag = actions.add_tag?.trim();
    if (tag) tagNames.add(tag);
  }

  if (touched) {
    await tx.ticket.update({ where: { id: ticketId }, data: update });
  }
  for (const name of tagNames) {
    await applyTag(tx, licenseId, ticketId, name);
  }
}

/** An agent who is a member of this licence and can still be assigned work. */
async function isActiveAgent(
  tx: TenantClient,
  licenseId: bigint,
  agentId: string,
): Promise<boolean> {
  const membership = await tx.agentMembership.findFirst({
    where: { agentId, licenseId, suspended: false },
    select: { agentId: true },
  });
  return membership != null;
}

async function groupExists(tx: TenantClient, licenseId: bigint, groupId: number): Promise<boolean> {
  const group = await tx.group.findFirst({
    where: { id: BigInt(groupId), licenseId },
    select: { id: true },
  });
  return group != null;
}

/**
 * Apply a tag to the ticket, creating it in the shared library first if the
 * name is new — the same `tags` vocabulary the inbox and thread tagging use, so
 * a rule cannot invent a private label nobody else can see. Idempotent: a tag
 * the ticket already carries is a no-op.
 */
async function applyTag(
  tx: TenantClient,
  licenseId: bigint,
  ticketId: string,
  name: string,
): Promise<void> {
  const existing = await tx.tag.findFirst({ where: { licenseId, name }, select: { id: true } });
  const tag =
    existing ?? (await tx.tag.create({ data: { licenseId, name }, select: { id: true } }));
  await tx.ticketTag.createMany({ data: [{ ticketId, tagId: tag.id }], skipDuplicates: true });
}
