/**
 * The ticket-rule engine's pure core (FR-MOD-08.6.2).
 *
 * Kept free of Prisma and clocks so the parts most worth trusting — is a rule
 * even valid, and does this ticket match — are decided by functions a unit test
 * can pin down exactly. The service around this reads the rules, loads the
 * ticket, and writes the assignment / priority / tag.
 */
import type { TicketRuleActions, TicketRuleConditions, TicketRuleSource } from '@nexa/types';

/**
 * What a ticket looks like to a rule at the moment it is opened. `source` widens
 * the two rule-visible origins (`chat`, `email`) with `manual` — a ticket
 * created directly through the API — so a `source` condition simply never
 * matches one, rather than the engine having to special-case it.
 */
export interface TicketRuleContext {
  subject: string;
  source: TicketRuleSource | 'manual';
}

/**
 * True when the trigger has at least one usable condition to match on. A rule
 * with an empty predicate is not "apply to every ticket" — it is not ready, and
 * the service refuses to save it (the "condition required" half of the KK).
 */
export function hasCondition(conditions: TicketRuleConditions): boolean {
  if (conditions.subject_contains && conditions.subject_contains.trim()) return true;
  if (conditions.source) return true;
  return false;
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

  if (checks.length === 0) return false;
  return checks.every(Boolean);
}
