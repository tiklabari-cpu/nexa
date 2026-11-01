/**
 * The ticket-rule engine's pure core (FR-MOD-08.6.2).
 *
 * Kept free of Prisma and clocks so the parts most worth trusting — is a rule
 * even valid, and does this ticket match — are decided by functions a unit test
 * can pin down exactly. The service around this reads the rules, loads the
 * ticket, and writes the assignment / priority / tag.
 */
import type {
  TicketRuleActions,
  TicketRuleConditions,
  TicketRuleEvent,
  TicketRuleSource,
  TicketStatus,
} from '@siyahtus/types';

/**
 * What a ticket looks like to a rule at the moment it is opened. `source` widens
 * the two rule-visible origins (`chat`, `email`) with the ones a `source`
 * condition cannot name: `manual`, a ticket created directly through the API,
 * and `widget`, one a visitor left on the offline form (FR-MOD-08.7.7). Both
 * are carried rather than faked as `chat`/`email` so a `source` condition simply
 * never matches them — the engine special-cases nothing, and a rule that says
 * "forwarded by email" cannot fire on a ticket that was not.
 */
export interface TicketRuleContext {
  subject: string;
  source: TicketRuleSource | 'manual' | 'widget';
  /**
   * Whether the team is out of hours at the moment the ticket opens (tm 359 ·
   * HD-04). The engine reads the work schedules once and only when a rule asks;
   * the matcher just compares. Absent, no `outside_business_hours` condition
   * can match.
   */
  outsideBusinessHours?: boolean;
  /** The ticket's priority after the event (AU-03); absent, no `priority_at_least` matches. */
  priority?: number;
  /**
   * The status this event moved the ticket to (AU-03) — set only when the
   * status actually changed in it. Absent, no `status_to` condition matches.
   */
  statusTo?: TicketStatus;
  /** On `message_added`: whether the player wrote it (AU-03). */
  fromRequester?: boolean;
}

/**
 * True when the trigger has at least one usable condition to match on. A rule
 * with an empty predicate is not "apply to every ticket" — it is not ready, and
 * the service refuses to save it (the "condition required" half of the KK).
 */
export function hasCondition(conditions: TicketRuleConditions): boolean {
  if (conditions.subject_contains && conditions.subject_contains.trim()) return true;
  if (conditions.source) return true;
  // `false` is a condition too: "while the team is in".
  if (typeof conditions.outside_business_hours === 'boolean') return true;
  if (conditions.status_to) return true;
  if (conditions.priority_at_least != null) return true;
  if (typeof conditions.from_requester === 'boolean') return true;
  return false;
}

/**
 * Why a rule cannot run at its moment (AU-03 · tm 374), or null when it can.
 * A condition the moment never carries would match nobody, silently; an
 * acknowledgement belongs to the ticket's opening only. Refused at save so the
 * settings screen says so rather than the rule doing nothing.
 */
export function ruleShapeProblem(
  on: TicketRuleEvent,
  conditions: TicketRuleConditions,
  actions: TicketRuleActions,
): string | null {
  if (conditions.status_to && (on === 'created' || on === 'message_added')) {
    return 'conditions.status_to: only an "updated" or "status_changed" rule sees a status change.';
  }
  if (typeof conditions.from_requester === 'boolean' && on !== 'message_added') {
    return 'conditions.from_requester: only a "message_added" rule has a message to ask about.';
  }
  if (actions.send_template_id && on !== 'created') {
    return 'actions.send_template_id: an acknowledgement is sent only when a ticket opens.';
  }
  return null;
}

/**
 * True when the rule does at least one thing. A rule with no action is refused
 * rather than saved inert (the "action required" half of the KK). A priority of
 * 0 counts — it is a deliberate value, not an absent field.
 */
export function hasAction(actions: TicketRuleActions): boolean {
  if (actions.assign_agent_id) return true;
  if (actions.assign_group_id != null) return true;
  if (actions.priority != null) return true;
  if (actions.add_tag && actions.add_tag.trim()) return true;
  if (actions.send_template_id) return true;
  return false;
}

/**
 * Does a ticket match the rule's conditions?
 *
 * Every condition that is set must hold (AND). A predicate with nothing set
 * matches nobody — the same discipline campaign triggers use — so a rule that
 * somehow reached the engine without a condition fires at no one rather than
 * everyone.
 */
export function matchesTicketRule(
  conditions: TicketRuleConditions,
  ctx: TicketRuleContext,
): boolean {
  const checks: boolean[] = [];

  const needle = conditions.subject_contains?.trim().toLowerCase();
  if (needle) {
    checks.push(ctx.subject.toLowerCase().includes(needle));
  }
  if (conditions.source) {
    checks.push(conditions.source === ctx.source);
  }
  if (typeof conditions.outside_business_hours === 'boolean') {
    checks.push(ctx.outsideBusinessHours === conditions.outside_business_hours);
  }
  if (conditions.status_to) {
    checks.push(ctx.statusTo === conditions.status_to);
  }
  if (conditions.priority_at_least != null) {
    checks.push(ctx.priority !== undefined && ctx.priority >= conditions.priority_at_least);
  }
  if (typeof conditions.from_requester === 'boolean') {
    checks.push(ctx.fromRequester === conditions.from_requester);
  }

  if (checks.length === 0) return false;
  return checks.every(Boolean);
}
