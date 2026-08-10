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
 * True when the goal has at least one usable predicate to be reached by.
 *
 * Takes `unknown` rather than `GoalDefinition` because the column is free-form
 * jsonb: the route validates what it writes, but a goal already in the table
 * may hold anything.
 */
export function hasGoalTrigger(definition: unknown): boolean {
  return urlNeedle(definition) !== null;
}

/**
 * Has a visitor seen on these pages reached the goal?
 *
 * Every predicate that is set must hold (AND). A definition with nothing set
 * matches nobody — an empty goal is not "everyone converts", it is a target
 * that can never be reached — which keeps the rule the route enforces on write
 * true for a row that somehow reached the matcher without one.
 *
 * `pageUrls` is what `visitorPageUrls` pulled out of the visit's `pages` json,
 * so it is already free of the malformed entries that column can hold.
 */
export function matchesGoal(definition: unknown, pageUrls: readonly string[]): boolean {
  const checks: boolean[] = [];

  const needle = urlNeedle(definition);
  if (needle) {
    checks.push(pageUrls.some((url) => url.toLowerCase().includes(needle)));
  }

  // Future predicate kinds (event fired, order value, …) push their own check
  // here; 13.5 e-commerce tracking is where the next one arrives.
  if (checks.length === 0) return false;
  return checks.every(Boolean);
}
