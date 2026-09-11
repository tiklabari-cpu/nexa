/**
 * The rule bot's pure core (FR-MOD-06.6).
 *
 * Free of Prisma, of clocks, and — the part the requirement is actually about —
 * of `@nexa/ai-mock`, embeddings and retrieval. PRD:577 asks for a bot that is
 * deterministic *by design* rather than deterministic because the LLM behind it
 * happens to be a stub, and this module is where that claim is checkable: every
 * function here is total, side-effect free, and decided by a unit test on paper
 * values. `rule-bot-isolation.test.ts` walks this file's import graph and fails
 * if an AI module ever appears in it.
 *
 * The service around this reads the rows, decides which bots a chat can reach
 * and in what order, and applies the winning rule's actions.
 */
import type { RuleBotActions, RuleBotConditions } from '@nexa/types';

/**
 * What an incoming customer message looks like to a rule.
 *
 * Everything here is known before any row is read, which is what keeps a match
 * cheap: no rule can ask a question that costs a query per rule.
 */
export interface RuleBotContext {
  /** The visitor's message, already masked (FR-MOD-08.9.5) exactly as stored. */
  message: string;
  /** The page they wrote from, when the widget sent one. */
  pageUrl: string | null;
  /**
   * Whether the workspace is inside its business hours right now.
   *
   * `null` means the caller did not work it out — the engine skips the calendar
   * read when no rule asks about it — and an `office_hours` condition then
   * matches nothing, which is the fail-closed direction for a predicate that has
   * no answer. It is NOT "the workspace saved no schedules": that case is a
   * decided `true`, because a workspace that never said it closes is open, the
   * same reading the SLA clock takes of an absent calendar.
   */
  withinBusinessHours: boolean | null;
}

/**
 * Letters, digits and underscore, as one fixed character class.
 *
 * A character class is not the "regex condition" this engine refuses to offer.
 * The ban is on *caller-supplied* patterns: a rule author who could write a
 * regex could write a backtracking one, and the string it would run against is
 * the visitor's own message. This runs once per character, in constant time, on
 * a pattern that ships with the code.
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * True when the trigger has at least one usable condition.
 *
 * A rule with an empty predicate is not "reply to every message" — it is a rule
 * nobody finished — so the service refuses to save it and {@link matchesRuleBot}
 * refuses to fire it. Both halves matter: the first keeps the editor honest, the
 * second covers a row written around the service.
 */
export function hasRuleBotCondition(conditions: RuleBotConditions): boolean {
  if (conditions.message_equals?.trim()) return true;
  if (conditions.message_contains?.trim()) return true;
  if (conditions.message_word?.trim()) return true;
  if (conditions.page_url_contains?.trim()) return true;
  if (conditions.office_hours) return true;
  return false;
}

/** True when the rule does at least one thing. A rule with no action is refused. */
export function hasRuleBotAction(actions: RuleBotActions): boolean {
  if (actions.send_message?.trim()) return true;
  if (actions.add_tag?.trim()) return true;
  if (actions.transfer_to_group_id != null) return true;
  return false;
}

/**
 * Does this message match the rule?
 *
 * Every condition that is set must hold (AND). A predicate with nothing set
 * matches nobody, for the reason above.
 */
export function matchesRuleBot(conditions: RuleBotConditions, ctx: RuleBotContext): boolean {
  const checks: boolean[] = [];
  const message = ctx.message.toLowerCase();

  const equals = conditions.message_equals?.trim().toLowerCase();
  if (equals) checks.push(message.trim() === equals);

  const contains = conditions.message_contains?.trim().toLowerCase();
  if (contains) checks.push(message.includes(contains));

  const word = conditions.message_word?.trim().toLowerCase();
  if (word) checks.push(containsWord(message, word));

  const url = conditions.page_url_contains?.trim().toLowerCase();
  if (url) {
    // A rule that keys on the page cannot fire on a message that arrived
    // without one. Treating "no URL" as a match would make a page-scoped rule
    // the widest rule in the bot.
    checks.push(ctx.pageUrl != null && ctx.pageUrl.toLowerCase().includes(url));
  }

  if (conditions.office_hours) {
    // `null` is "the calendar was not consulted", which no `office_hours` value
    // answers. Fail closed: a rule that asks a question nobody answered does
    // not fire.
    checks.push(
      ctx.withinBusinessHours === null
        ? false
        : conditions.office_hours === (ctx.withinBusinessHours ? 'open' : 'closed'),
    );
  }

  if (checks.length === 0) return false;
  return checks.every(Boolean);
}

/**
 * Does `haystack` contain `needle` as a whole word?
 *
 * Both are already lower-cased. Implemented as a scan rather than a built
 * `RegExp`, so the needle — which a rule author types — is never compiled as a
 * pattern: a needle of `.*` is a literal two-character word here, and a needle
 * that would make a catastrophic pattern is just a long word that does not
 * match. The walk is O(haystack) per occurrence check and allocates nothing.
 */
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;

    const before = at === 0 ? '' : haystack[at - 1]!;
    const afterAt = at + needle.length;
    const after = afterAt >= haystack.length ? '' : haystack[afterAt]!;

    if (!isWordChar(before) && !isWordChar(after)) return true;

    // Overlapping occurrences count: "ab" is a word inside "aab ab".
    from = at + 1;
  }
}

function isWordChar(ch: string): boolean {
  return ch !== '' && WORD_CHAR.test(ch);
}
