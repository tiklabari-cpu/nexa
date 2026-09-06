/**
 * The goal matcher's pure core (FR-MOD-13.3).
 *
 * Shaped like the campaign trigger engine next door, and for the same reason:
 * the one decision worth trusting — did this visitor reach the goal — is made
 * by a function a unit test can pin down exactly, while the service around it
 * reads the goals, writes the achievements and hands the clock in.
 *
 * Both inputs originate in jsonb, so both are read defensively. That matters
 * more here than it does for a campaign: `evaluate` runs every active goal in
 * the workspace over one visitor, so a single row with a hand-edited definition
 * throwing would stop every *other* goal in that workspace from being recorded.
 * A definition this module cannot read is a goal nobody reaches, never an error.
 */

/**
 * The `url_contains` needle, lower-cased, or null when the definition carries
 * nothing usable — missing, blank, or not a string at all.
 */
function urlNeedle(definition: unknown): string | null {
  if (!definition || typeof definition !== 'object') return null;
  const value = (definition as { url_contains?: unknown }).url_contains;
  if (typeof value !== 'string') return null;
  return value.trim().toLowerCase() || null;
}

/**
 * The predicates a goal can be reached by that are *not* about a page — the
 * three funnel kinds the PRD row names (sale / lead / resolution).
 *
 * Each is a flag rather than a filter because each names a fact that either
 * happened to this visitor or did not, so there is nothing to compare against.
 */
export const GOAL_FLAG_PREDICATES = ['sale_completed', 'lead_captured', 'chat_resolved'] as const;

export type GoalFlagPredicate = (typeof GOAL_FLAG_PREDICATES)[number];

/**
 * What is known to have happened to the visitor being evaluated.
 *
 * Deliberately the visitor's *state* rather than "which event just fired": a
 * goal may require a sale **and** a resolved chat, and those happen minutes
 * apart. Reading state means whichever of the two arrives second finds the
 * first already true, so an AND across trigger points converges instead of
 * depending on the order the facts happened to arrive in.
 *
 * Absent is the same as false — a fact nobody asked about is never fetched
 * (`GoalService#factsFor`), so an unset key means "not required", not "no".
 */
export interface GoalFacts {
  /** A tracked sale has been recorded for this visitor (FR-MOD-13.5). */
  saleCompleted?: boolean;
  /** The visitor is held as a lead — they gave an e-mail address. */
  leadCaptured?: boolean;
  /** A conversation with this visitor has been archived. */
  chatResolved?: boolean;
}

/**
 * Does the definition require this predicate?
 *
 * Only a literal `true` counts. `false`, absent, `"yes"` and `1` all mean "not
 * required", which keeps a hand-edited row from turning into a goal that fires
 * on a fact the workspace never asked for.
 */
export function goalRequires(definition: unknown, predicate: GoalFlagPredicate): boolean {
  if (!definition || typeof definition !== 'object') return false;
  return (definition as Record<string, unknown>)[predicate] === true;
}

/**
 * True when the goal has at least one usable predicate to be reached by.
 *
 * Takes `unknown` rather than `GoalDefinition` because the column is free-form
 * jsonb: the route validates what it writes, but a goal already in the table
 * may hold anything.
 */
export function hasGoalTrigger(definition: unknown): boolean {
  if (urlNeedle(definition) !== null) return true;
  return GOAL_FLAG_PREDICATES.some((predicate) => goalRequires(definition, predicate));
}

/**
 * Has a visitor seen on these pages, of whom these facts are known, reached
 * the goal?
 *
 * Every predicate that is set must hold (AND). A definition with nothing set
 * matches nobody — an empty goal is not "everyone converts", it is a target
 * that can never be reached — which keeps the rule the route enforces on write
 * true for a row that somehow reached the matcher without one.
 *
 * `pageUrls` is what `visitorPageUrls` pulled out of the visit's `pages` json,
 * so it is already free of the malformed entries that column can hold.
 * `facts` stays optional because the page predicate is the only one that needs
 * nothing beyond the visit, and every caller that has none reads better
 * without an argument saying so.
 */
export function matchesGoal(
  definition: unknown,
  pageUrls: readonly string[],
  facts: GoalFacts = {},
): boolean {
  const checks: boolean[] = [];

  const needle = urlNeedle(definition);
  if (needle) {
    checks.push(pageUrls.some((url) => url.toLowerCase().includes(needle)));
  }
  if (goalRequires(definition, 'sale_completed')) checks.push(facts.saleCompleted === true);
  if (goalRequires(definition, 'lead_captured')) checks.push(facts.leadCaptured === true);
  if (goalRequires(definition, 'chat_resolved')) checks.push(facts.chatResolved === true);

  // Future predicate kinds (geo, order value, …) push their own check here.
  if (checks.length === 0) return false;
  return checks.every(Boolean);
}
