/**
 * Campaign targeting rules (EN-03 · tm 352): a campaign's trigger is a list of
 * rules joined by "all" (AND) or "any" (OR), each one a field, an operator and
 * a value.
 *
 * Two kinds of field, decided in two places. The server knows where the visitor
 * is and has been, where they came from, their country, whether they have been
 * here before and the variables the site set (`CAMPAIGN_SERVER_RULE_FIELDS`):
 * it evaluates those when a page view is written. How long the visitor has
 * been on the page and whether they are about to leave it only the browser
 * knows (`CAMPAIGN_CLIENT_RULE_FIELDS`): the server hands the card over with
 * those rules still to hold (`show_when`), and the widget shows it once they
 * do.
 *
 * The first shape (`{ url_contains }`, the one condition v1 shipped) is still
 * read: `normalizeCampaignConditions` turns it into one `current_url contains`
 * rule, the meaning EN-04 gave it.
 */

/** Every field a rule can test. */
export const CAMPAIGN_RULE_FIELDS = [
  'current_url',
  'session_url',
  'referrer',
  'country',
  'visitor_type',
  'time_on_page',
  'exit_intent',
  'custom_var',
] as const;
export type CampaignRuleField = (typeof CAMPAIGN_RULE_FIELDS)[number];

/** Fields only the visitor's browser can decide; the widget waits for them. */
export const CAMPAIGN_CLIENT_RULE_FIELDS = ['time_on_page', 'exit_intent'] as const;
export type CampaignClientRuleField = (typeof CAMPAIGN_CLIENT_RULE_FIELDS)[number];

export const CAMPAIGN_RULE_OPS = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;
export type CampaignRuleOp = (typeof CAMPAIGN_RULE_OPS)[number];

/** How the rules combine: every one must hold, or one is enough. */
export const CAMPAIGN_MATCH_MODES = ['all', 'any'] as const;
export type CampaignMatchMode = (typeof CAMPAIGN_MATCH_MODES)[number];

/** `visitor_type` values: no earlier visit, or at least one. */
export const CAMPAIGN_VISITOR_TYPES = ['new', 'returning'] as const;
export type CampaignVisitorType = (typeof CAMPAIGN_VISITOR_TYPES)[number];

/** At most this many rules per campaign — they are evaluated on every page view. */
export const CAMPAIGN_RULES_MAX = 10;

/** A text rule's value, at most (a URL fits). */
export const CAMPAIGN_RULE_TEXT_MAX = 2048;

/** `time_on_page` is counted in seconds, up to an hour. */
export const CAMPAIGN_TIME_ON_PAGE_MAX_SECONDS = 3600;

/**
 * Variables a site sets for the session (`siyahtus('setSessionVariables')`):
 * at most this many keys, each key and value at most `SESSION_VARIABLE_MAX_LENGTH`
 * characters. They come from the visitor's browser, so they are unverified —
 * used for campaign targeting only, never for access or by the AI (EN-03 karar 2).
 */
export const SESSION_VARIABLES_MAX = 20;
export const SESSION_VARIABLE_MAX_LENGTH = 100;

/**
 * One rule. `key` names the variable for `custom_var` and is absent otherwise.
 * `value` is a string for the text fields, a number of seconds for
 * `time_on_page`, `true` for `exit_intent`, `new`/`returning` for
 * `visitor_type`; `custom_var` takes a string or a number.
 */
export interface CampaignRule {
  field: CampaignRuleField;
  op: CampaignRuleOp;
  value: string | number | boolean;
  key?: string;
}

/** The rules as the engine reads them, whatever shape was stored. */
export interface CampaignRuleSet {
  match: CampaignMatchMode;
  rules: CampaignRule[];
}

/** The browser-side rules a card waits for, handed to the widget with it. */
export interface CampaignShowWhen {
  match: CampaignMatchMode;
  rules: CampaignRule[];
}

const TEXT_OPS: readonly CampaignRuleOp[] = ['contains', 'not_contains', 'equals', 'not_equals'];
const EQUALITY_OPS: readonly CampaignRuleOp[] = ['equals', 'not_equals'];

/** The operators a field accepts, in the order a rule builder lists them. */
export function campaignRuleOps(field: CampaignRuleField): readonly CampaignRuleOp[] {
  switch (field) {
    case 'current_url':
    case 'session_url':
    case 'referrer':
      return TEXT_OPS;
    case 'country':
    case 'visitor_type':
      return EQUALITY_OPS;
    case 'time_on_page':
      return ['gte', 'gt'];
    case 'exit_intent':
      return ['equals'];
    case 'custom_var':
      return CAMPAIGN_RULE_OPS;
  }
}

export function isCampaignClientRule(rule: Pick<CampaignRule, 'field'>): boolean {
  return rule.field === 'time_on_page' || rule.field === 'exit_intent';
}

/** A `custom_var` comparison operator — both sides must read as numbers. */
export function isCampaignNumericOp(op: CampaignRuleOp): boolean {
  return op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte';
}

/**
 * What is wrong with a rule, in a few words for a 400, or null when it can be
 * saved. The single validator: the API refuses with it and the builder can
 * show the same sentence before saving.
 */
export function campaignRuleProblem(rule: CampaignRule): string | null {
  if (!(CAMPAIGN_RULE_FIELDS as readonly string[]).includes(rule.field)) return 'unknown field';
  if (!campaignRuleOps(rule.field).includes(rule.op)) {
    return `${rule.op} is not an operator for ${rule.field}`;
  }
  if (rule.field === 'custom_var') {
    const key = typeof rule.key === 'string' ? rule.key.trim() : '';
    if (!key) return 'custom_var needs a key';
    if (key.length > SESSION_VARIABLE_MAX_LENGTH) return 'key is too long';
  } else if (rule.key !== undefined) {
    return `${rule.field} takes no key`;
  }
  const { value } = rule;
  switch (rule.field) {
    case 'current_url':
    case 'session_url':
    case 'referrer':
      if (typeof value !== 'string' || !value.trim()) return 'value must be text';
      if (value.length > CAMPAIGN_RULE_TEXT_MAX) return 'value is too long';
      return null;
    case 'country':
      if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value.trim())) {
        return 'value must be a two-letter country code';
      }
      return null;
    case 'visitor_type':
      if (
        typeof value !== 'string' ||
        !(CAMPAIGN_VISITOR_TYPES as readonly string[]).includes(value)
      ) {
        return 'value must be new or returning';
      }
      return null;
    case 'time_on_page':
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > CAMPAIGN_TIME_ON_PAGE_MAX_SECONDS
      ) {
        return `value must be whole seconds from 1 to ${CAMPAIGN_TIME_ON_PAGE_MAX_SECONDS}`;
      }
      return null;
    case 'exit_intent':
      return value === true ? null : 'value must be true';
    case 'custom_var':
      if (typeof value === 'number') return Number.isFinite(value) ? null : 'value must be finite';
      if (typeof value !== 'string' || !value.trim()) return 'value must be text or a number';
      if (value.length > SESSION_VARIABLE_MAX_LENGTH) return 'value is too long';
      if (isCampaignNumericOp(rule.op) && !Number.isFinite(Number(value))) {
        return `${rule.op} needs a number`;
      }
      return null;
  }
}

function isRuleLike(value: unknown): value is CampaignRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { field?: unknown }).field === 'string' &&
    typeof (value as { op?: unknown }).op === 'string'
  );
}

/**
 * The rules of a stored or submitted trigger. `rules` wins when present; a row
 * with only `url_contains` (every campaign before EN-03) is one
 * `current_url contains` rule. Defensive the way every reader of a JSON
 * column here is: a malformed entry is dropped rather than thrown, and a
 * missing or unknown `match` is `all`.
 */
export function normalizeCampaignConditions(raw: unknown): CampaignRuleSet {
  const conditions = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    match?: unknown;
    rules?: unknown;
    url_contains?: unknown;
  };
  const match: CampaignMatchMode = conditions.match === 'any' ? 'any' : 'all';
  if (Array.isArray(conditions.rules)) {
    return { match, rules: conditions.rules.filter(isRuleLike) };
  }
  const needle = typeof conditions.url_contains === 'string' ? conditions.url_contains.trim() : '';
  return {
    match: 'all',
    rules: needle ? [{ field: 'current_url', op: 'contains', value: needle }] : [],
  };
}

/**
 * The single `current_url contains` needle when the rules say exactly what the
 * first shape could, else undefined. Kept beside the rules (stored and
 * answered) while the builder and any older reader still know only
 * `url_contains`; dropped once nothing reads it.
 */
export function legacyUrlContains(set: CampaignRuleSet): string | undefined {
  if (set.rules.length !== 1) return undefined;
  const [rule] = set.rules;
  if (rule?.field !== 'current_url' || rule.op !== 'contains') return undefined;
  return typeof rule.value === 'string' ? rule.value : undefined;
}
