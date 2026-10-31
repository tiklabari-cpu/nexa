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
 *
 * Mail is the one action that is not applied here (tm 359 · HD-04): this runs
 * inside the creation transaction, and a message must not leave from a
 * transaction that can still roll back. The first matching rule that names a
 * template is handed back as a {@link PendingAck}; whoever created the ticket
 * settles it (`TicketAutoAck`) once the ticket has its first message, and
 * mails it after the commit.
 */
import type { Prisma } from '@prisma/client';
import type { TicketRuleActions, TicketRuleConditions } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { isOpenAt } from '../sla/business-hours.js';
import { readBusinessWeek } from '../sla/sla-service.js';
import { matchesTicketRule, type TicketRuleContext } from './ticket-rule-matching.js';

/** The automatic acknowledgement a matching rule asked for, not yet written or sent. */
export interface PendingAck {
  templateId: string;
  ruleName: string;
}

/**
 * Where an acknowledgement can go: a ticket the player started by e-mail or on
 * the offline form. A ticket opened from a chat or by an agent has a person
 * already in the conversation; "we received your request" there is noise, and
 * mailed to an address nobody at the keyboard chose, backscatter.
 */
const ACK_SOURCES: ReadonlySet<TicketRuleContext['source']> = new Set(['email', 'widget']);

export async function applyTicketRules(
  tx: TenantClient,
  licenseId: bigint,
  ticketId: string,
  ctx: TicketRuleContext,
): Promise<{ ack: PendingAck | null }> {
  const rules = await tx.ticketRule.findMany({
    where: { licenseId, enabled: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { name: true, conditions: true, actions: true },
  });
  if (rules.length === 0) return { ack: null };

  // The work schedules are read once, and only when a rule asks about hours.
  const asksHours = rules.some(
    (rule) =>
      typeof ((rule.conditions ?? {}) as TicketRuleConditions).outside_business_hours === 'boolean',
  );
  const context: TicketRuleContext =
    asksHours && ctx.outsideBusinessHours === undefined
      ? { ...ctx, outsideBusinessHours: await isOutsideBusinessHours(tx, licenseId) }
      : ctx;

  const update: Prisma.TicketUpdateInput = {};
  const tagNames = new Set<string>();
  let touched = false;
  let ack: PendingAck | null = null;

  for (const rule of rules) {
    const conditions = (rule.conditions ?? {}) as TicketRuleConditions;
    const actions = (rule.actions ?? {}) as TicketRuleActions;
    if (!matchesTicketRule(conditions, context)) continue;

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
    // One acknowledgement per ticket: the first matching rule's.
    if (!ack && actions.send_template_id && ACK_SOURCES.has(context.source)) {
      ack = { templateId: actions.send_template_id, ruleName: rule.name };
    }
  }

  if (touched) {
    await tx.ticket.update({ where: { id: ticketId }, data: update });
  }
  for (const name of tagNames) {
    await applyTag(tx, licenseId, ticketId, name);
  }
  return { ack };
}

/**
 * Whether the team is out of hours right now. A workspace where nobody has
 * saved a work schedule has no hours to be outside of, so it is never out —
 * the safe answer for a rule that mails customers.
 */
async function isOutsideBusinessHours(tx: TenantClient, licenseId: bigint): Promise<boolean> {
  const now = new Date();
  const week = await readBusinessWeek(tx, { licenseId }, now);
  return week !== null && !isOpenAt(week, now);
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
