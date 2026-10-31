/**
 * "A ticket is yours to look at" — the push behind the console's new-ticket
 * alert (IN-10 · tm 367, `incoming_ticket`).
 *
 * Built inside the transaction that opened or handed over the ticket, so the
 * assignee and team are the ones the ticket rules just settled (a forwarded
 * e-mail is created unassigned and triaged a few statements later); published by
 * the caller after the commit, like every other push (`RealtimePublisher`).
 *
 * The audience is the assignee and the team — the people the ticket is
 * addressed to. Followers are not in it: a brand-new ticket has none, and
 * somebody who handed a ticket to a colleague follows it for the replies
 * (`ticket_message_created`), not for being told it exists. Ids only, as
 * {@link IncomingTicketPush} explains.
 */
import type { IncomingTicketPush, PushAudience } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

export interface TicketArrivalPush {
  audience: PushAudience;
  payload: IncomingTicketPush;
}

/**
 * The push for a ticket that was just opened (`created`) or whose assignee
 * changed (`assigned`), or null when nobody it is addressed to exists — an
 * unassigned ticket in no team is nobody's alert.
 *
 * `actorId` is the agent who did it, so the console does not alert them to
 * their own action; null for a ticket that arrived by e-mail or form.
 */
export async function ticketArrivalPush(
  tx: TenantClient,
  ticketId: string,
  options: { reason: IncomingTicketPush['reason']; actorId: string | null },
): Promise<TicketArrivalPush | null> {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, assigneeId: true, groupId: true },
  });
  if (!ticket) return null;
  const audience: PushAudience = {
    ...(ticket.assigneeId ? { agentIds: [ticket.assigneeId] } : {}),
    ...(ticket.groupId !== null ? { groupIds: [Number(ticket.groupId)] } : {}),
  };
  if (!audience.agentIds && !audience.groupIds) return null;
  return {
    audience,
    payload: {
      ticket_id: ticket.id,
      reason: options.reason,
      assignee_id: ticket.assigneeId,
      group_id: ticket.groupId !== null ? Number(ticket.groupId) : null,
      actor_id: options.actorId,
    },
  };
}
