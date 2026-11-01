/**
 * A ticket's life after it opened (AU-03 · tm 374): the rules that answer a
 * change or a new message, and what the change says outside the panel.
 *
 * ## One pass, depth 1
 *
 * A person's change (`PATCH`, a bulk action, the composer's "send and solve")
 * or a new message is one *event*. The event's moments — `updated`,
 * `status_changed`, `message_added` — select the rules that run, once, in
 * `position` order, exactly as the opening runs the `created` ones
 * (`applyTicketRules`). What the rules write is part of the event; it is never
 * a new one: a rule's own change runs no rule (`triggeredByRule`). So "when
 * solved, tag it" tags once, and a rule that sets the priority on `updated`
 * cannot feed itself — the loop is cut by construction, not by a counter.
 *
 * ## Signals, after the commit
 *
 * The webhook deliveries (`ticket_updated`, `ticket_status_changed`,
 * `ticket_assigned`, `ticket_message_added`) are worked out inside the
 * transaction — the before and the final state are both in hand there — and
 * handed back in a {@link TicketSignals} for the route to emit after the
 * commit, like every other workspace event (`workspace-events.ts`). A change
 * that changes nothing says nothing: the audit trail's rule.
 */
import {
  TICKET_CHANGE_FIELDS,
  type TicketAssignedSignal,
  type TicketChangeField,
  type TicketMessageAddedSignal,
  type TicketMessageAuthorType,
  type TicketMessageKind,
  type TicketRuleEvent,
  type TicketStatus,
  type TicketStatusChangedSignal,
  type TicketUpdatedSignal,
} from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { WebhookAction } from '../webhooks/webhook-service.js';
import type { WorkspaceEventDispatcher } from '../webhooks/workspace-events.js';
import {
  applyTicketRules,
  type TicketRuleChanges,
  type TicketRuleRow,
} from './apply-ticket-rules.js';
import type { TicketRuleContext } from './ticket-rule-matching.js';

/** The ticket fields an event compares — what every caller's row carries. */
export interface TicketEventState {
  id: string;
  subject: string;
  status: string;
  priority: number;
  assigneeId: string | null;
  groupId: bigint | null;
  sourceChatId: string | null;
  inboundAddressId?: string | null;
}

/** The message an event is about, when it is about one. */
export interface TicketEventMessage {
  id: string;
  kind: TicketMessageKind;
  authorType: TicketMessageAuthorType;
  createdAt: Date;
}

/** One delivery to make once the transaction committed. */
interface PendingSignal {
  action: WebhookAction;
  payload: unknown;
}

/**
 * The deliveries an event earned, collected inside the transaction and sent
 * after it (`emit`). A route passes one to the service and emits it once the
 * work committed; a service called without one simply has nobody listening.
 */
export class TicketSignals {
  readonly #pending: PendingSignal[] = [];

  push(action: WebhookAction, payload: unknown): void {
    this.#pending.push({ action, payload });
  }

  /** What is waiting, in order — for a test. */
  get pending(): readonly PendingSignal[] {
    return this.#pending;
  }

  /** Send them, in order. `emit` never throws, so neither does this. */
  async emit(automations: WorkspaceEventDispatcher | undefined, tenant: TenantContext) {
    if (!automations) return;
    for (const signal of this.#pending) {
      await automations.emit(tenant, signal.action, signal.payload);
    }
  }
}

/**
 * Where a ticket came from, as a `source` condition reads it after the
 * opening. The opening knows exactly; later, the row says: a forwarding
 * address is `email`, a conversation `chat`, anything else `manual` — which no
 * `source` condition names, as at the opening.
 */
export function ticketOrigin(ticket: TicketEventState): TicketRuleContext['source'] {
  if (ticket.inboundAddressId) return 'email';
  if (ticket.sourceChatId) return 'chat';
  return 'manual';
}

const groupNumber = (groupId: bigint | null): number | null =>
  groupId != null ? Number(groupId) : null;

/** What moved between two states, in `TICKET_CHANGE_FIELDS` order. */
export function changedFields(
  before: TicketEventState,
  after: TicketEventState,
): TicketChangeField[] {
  const moved: Record<TicketChangeField, boolean> = {
    subject: before.subject !== after.subject,
    status: before.status !== after.status,
    priority: before.priority !== after.priority,
    assignee_id: before.assigneeId !== after.assigneeId,
    group_id: groupNumber(before.groupId) !== groupNumber(after.groupId),
  };
  return TICKET_CHANGE_FIELDS.filter((field) => moved[field]);
}

/** The lifecycle deliveries one change earns — none for a change that changed nothing. */
export function ticketChangeSignals(
  before: TicketEventState,
  after: TicketEventState,
  at: Date,
): PendingSignal[] {
  const changed = changedFields(before, after);
  if (changed.length === 0) return [];
  const iso = at.toISOString();
  const signals: PendingSignal[] = [
    {
      action: 'ticket_updated',
      payload: {
        ticket_id: after.id,
        changed,
        status: after.status as TicketStatus,
        priority: after.priority,
        assignee_id: after.assigneeId,
        group_id: groupNumber(after.groupId),
        updated_at: iso,
      } satisfies TicketUpdatedSignal,
    },
  ];
  if (changed.includes('status')) {
    signals.push({
      action: 'ticket_status_changed',
      payload: {
        ticket_id: after.id,
        from: before.status as TicketStatus,
        to: after.status as TicketStatus,
        changed_at: iso,
      } satisfies TicketStatusChangedSignal,
    });
  }
  if (changed.includes('assignee_id') || changed.includes('group_id')) {
    signals.push({
      action: 'ticket_assigned',
      payload: {
        ticket_id: after.id,
        assignee_id: after.assigneeId,
        group_id: groupNumber(after.groupId),
        previous_assignee_id: before.assigneeId,
        previous_group_id: groupNumber(before.groupId),
        assigned_at: iso,
      } satisfies TicketAssignedSignal,
    });
  }
  return signals;
}

/** The moments an event is, given what a person changed and whether a message landed. */
export function eventMoments(
  changed: readonly TicketChangeField[],
  message: boolean,
): TicketRuleEvent[] {
  const moments: TicketRuleEvent[] = [];
  if (changed.length > 0) moments.push('updated');
  if (changed.includes('status')) moments.push('status_changed');
  if (message) moments.push('message_added');
  return moments;
}

/** `after` with what the rules wrote on top. */
function withRuleChanges(after: TicketEventState, changes: TicketRuleChanges): TicketEventState {
  return {
    ...after,
    ...(changes.assigneeId !== undefined ? { assigneeId: changes.assigneeId } : {}),
    ...(changes.groupId !== undefined ? { groupId: changes.groupId } : {}),
    ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
  };
}

export interface TicketEventInput {
  /** The ticket as it stood before the person's change (or the message). */
  before: TicketEventState;
  /** As the person's change left it — `before` itself for a message alone. */
  after: TicketEventState;
  /** The message the event brought, if any. */
  message?: TicketEventMessage;
  /**
   * The change being answered was a rule's own (AU-03 · depth 1). Nothing
   * runs; the deliveries are still earned — a subscriber hears of every change.
   */
  triggeredByRule?: boolean;
  /** When it happened — one stamp for a whole bulk gesture. */
  at?: Date;
  /** The rules, read once for a bulk gesture (`readTicketRules`). */
  rules?: readonly TicketRuleRow[];
}

export interface TicketEventOutcome {
  /** The ticket as the event left it, the rules' changes included. */
  final: TicketEventState;
  /** True when a rule wrote something, so a caller re-reads the row it returns. */
  ruleChanged: boolean;
}

/**
 * Answer one event: run the rules of its moments once, then record what it
 * says outside. Inside the caller's transaction, after the person's write.
 */
export async function answerTicketEvent(
  tx: TenantClient,
  tenant: TenantContext,
  input: TicketEventInput,
  signals: TicketSignals | undefined,
): Promise<TicketEventOutcome> {
  const at = input.at ?? new Date();
  const changed = changedFields(input.before, input.after);
  const moments = eventMoments(changed, input.message !== undefined);
  if (moments.length === 0) return { final: input.after, ruleChanged: false };

  let final = input.after;
  let ruleChanged = false;
  if (!input.triggeredByRule) {
    const { changes } = await applyTicketRules(
      tx,
      tenant.licenseId,
      input.after.id,
      {
        subject: input.after.subject,
        source: ticketOrigin(input.after),
        priority: input.after.priority,
        ...(changed.includes('status') ? { statusTo: input.after.status as TicketStatus } : {}),
        ...(input.message ? { fromRequester: input.message.kind === 'customer_message' } : {}),
      },
      {
        on: moments,
        triggeredByRule: false,
        ...(input.rules ? { rules: input.rules } : {}),
      },
    );
    final = withRuleChanges(input.after, changes);
    ruleChanged = changes.touched;
  }

  if (signals) {
    if (input.message) {
      signals.push('ticket_message_added', {
        ticket_id: input.after.id,
        message_id: input.message.id,
        kind: input.message.kind,
        author_type: input.message.authorType,
        created_at: input.message.createdAt.toISOString(),
      } satisfies TicketMessageAddedSignal);
    }
    for (const signal of ticketChangeSignals(input.before, final, at)) {
      signals.push(signal.action, signal.payload);
    }
  }
  return { final, ruleChanged };
}
