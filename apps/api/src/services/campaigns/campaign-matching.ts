/**
 * The campaign trigger engine's pure core (FR-MOD-03.3.2/.3).
 *
 * Kept free of Prisma and clocks so the parts most worth trusting — does this
 * visitor match, and what do the numbers say — are decided by functions a unit
 * test can pin down exactly. The service around this reads the visitors, writes
 * the sends, and hands the clock in.
 */
import {
  campaignRuleProblem,
  isCampaignClientRule,
  isCampaignNumericOp,
  legacyUrlContains,
  normalizeCampaignConditions,
  type CampaignConditions,
  type CampaignPerformance,
  type CampaignRule,
  type CampaignRuleOp,
  type CampaignShowWhen,
  type CampaignStatus,
  type CampaignVisitorType,
} from '@siyahtus/types';

/** A page entry inside a visit's `pages` JSON (`{ url, at }`). */
interface VisitPage {
  url?: unknown;
}

/**
 * The URLs a visitor has been seen on.
 *
 * Deliberately defensive: `pages` is stored as free-form JSON, and one malformed
 * row must not throw the whole evaluation and stop a campaign firing at everyone
 * else — a non-string url is simply skipped.
 */
export function visitorPageUrls(pages: unknown): string[] {
  if (!Array.isArray(pages)) return [];
  const urls: string[] = [];
  for (const page of pages) {
    const url = (page as VisitPage | null)?.url;
    if (typeof url === 'string' && url.trim()) urls.push(url);
  }
  return urls;
}

/**
 * A visit's page views, in the shape the Inbox Details panel and the Traffic
 * visitor 360° panel both render (`{ url, at? }`). The single reader for
 * `pages` both surfaces go through (chat-service's Details visitor, customer-
 * service's `GET /customers/:id` visits) — a second, independently written
 * parser here would let the two panels drift apart on the same underlying
 * visit (FR-MOD-13.2).
 *
 * `pages` is free-form JSON (a manually edited row is possible), so this is
 * defensive the same way `visitorPageUrls` is: a malformed entry is dropped
 * rather than allowed to break the panel reading it — an unreadable entry is
 * an empty result, not an error.
 */
export function visitedPagesOf(pages: unknown): Array<{ url: string; at?: string }> {
  if (!Array.isArray(pages)) return [];
  const result: Array<{ url: string; at?: string }> = [];
  for (const entry of pages) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { url?: unknown }).url === 'string'
    ) {
      const { url, at } = entry as { url: string; at?: unknown };
      result.push(typeof at === 'string' ? { url, at } : { url });
    }
  }
  return result;
}

/**
 * True when the trigger has something to match on and every rule in it is one
 * the engine can read (EN-03). A row that fails this matches nobody; the write
 * path refuses to switch such a campaign on.
 */
export function hasTrigger(conditions: unknown): boolean {
  const { rules } = normalizeCampaignConditions(conditions);
  return rules.length > 0 && rules.every((rule) => campaignRuleProblem(rule) === null);
}

/**
 * Where a visitor is, and where they have been this session (EN-04).
 *
 * `currentUrl` is the last entry of the visit's `pages`, the page they are on
 * now; `sessionUrls` is every readable entry in order, that one included. A
 * trigger about "the page they are on" reads the first, never the second — a
 * visitor who passed `/withdraw` and is now on `/casino` is on `/casino`.
 * "Any page this session" is its own rule (`session_url`, EN-03), which is
 * what the second field is kept for.
 */
export interface VisitorPages {
  currentUrl: string | null;
  sessionUrls: readonly string[];
}

/**
 * Everything the server-side rules read about a visitor (EN-03). The pages
 * always; the rest only when a campaign has a rule about it — the caller
 * fills them (`loadVisitorDetails`, `campaign-trigger.ts`) only then, so a
 * workspace whose campaigns are all about pages pays no extra read. A field
 * left out reads as "not known": `contains`/`equals` fail, `not_*` hold.
 */
export interface VisitorContext extends VisitorPages {
  /** The visit's `came_from` (origin + path, `sanitizeReferrer`). */
  referrer?: string | null;
  /** ISO alpha-2, upper case: the visit's, else the contact's. */
  country?: string | null;
  visitorType?: CampaignVisitorType | null;
  /** The visit's session variables, as stored (text). */
  variables?: Readonly<Record<string, string>>;
}

/**
 * The pages of a visit, as the trigger engine reads them: `urls` in the order
 * the visitor reached them, as `visitorPageUrls` hands them back. The current
 * page is the last readable one, so an entry the sanitiser dropped does not
 * leave the visitor "nowhere".
 */
export function visitorPagesOf(urls: readonly string[]): VisitorPages {
  return { currentUrl: urls.at(-1) ?? null, sessionUrls: urls };
}

/** True when a campaign has a rule about more than the visitor's pages. */
export function needsVisitorDetails(conditions: unknown): boolean {
  return normalizeCampaignConditions(conditions).rules.some(
    (rule) =>
      rule.field === 'referrer' ||
      rule.field === 'country' ||
      rule.field === 'visitor_type' ||
      rule.field === 'custom_var',
  );
}

/**
 * What the engine says about a campaign and a visitor (EN-03):
 *   - `match` — fire, and the card is shown on the next poll;
 *   - `wait`  — fire, but the card waits in the widget for the browser-side
 *               rules in `showWhen` (time on the page, exit intent);
 *   - `none`  — not this visitor, not now.
 */
export type CampaignVerdict =
  { kind: 'match' } | { kind: 'wait'; showWhen: CampaignShowWhen } | { kind: 'none' };

const NONE: CampaignVerdict = { kind: 'none' };
const MATCH: CampaignVerdict = { kind: 'match' };

function textHolds(op: CampaignRuleOp, actual: string | undefined, expected: string): boolean {
  const needle = expected.trim().toLowerCase();
  const value = actual?.toLowerCase();
  switch (op) {
    case 'contains':
      return value !== undefined && value.includes(needle);
    case 'not_contains':
      return value === undefined || !value.includes(needle);
    case 'equals':
      return value !== undefined && value === needle;
    case 'not_equals':
      return value === undefined || value !== needle;
    default:
      return false;
  }
}

function numberOf(value: string | number | boolean): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function variableHolds(rule: CampaignRule, actual: string | undefined): boolean {
  if (isCampaignNumericOp(rule.op)) {
    const left = actual === undefined ? null : numberOf(actual);
    const right = numberOf(rule.value);
    if (left === null || right === null) return false;
    switch (rule.op) {
      case 'gt':
        return left > right;
      case 'gte':
        return left >= right;
      case 'lt':
        return left < right;
      default:
        return left <= right;
    }
  }
  // "10" equals "10.0": two numbers are compared as numbers, anything else as
  // text, ignoring case.
  if ((rule.op === 'equals' || rule.op === 'not_equals') && actual !== undefined) {
    const left = numberOf(actual);
    const right = numberOf(rule.value);
    if (left !== null && right !== null) {
      return rule.op === 'equals' ? left === right : left !== right;
    }
  }
  return textHolds(rule.op, actual, String(rule.value));
}

/**
 * Does one server-side rule hold for this visitor? Pure. A browser-side rule
 * (`time_on_page`, `exit_intent`) is never decided here: it answers false, and
 * `evaluateCampaign` keeps such rules apart before it asks.
 */
export function serverRuleHolds(rule: CampaignRule, visitor: VisitorContext): boolean {
  const expected = String(rule.value);
  switch (rule.field) {
    case 'current_url':
      return textHolds(rule.op, visitor.currentUrl ?? undefined, expected);
    case 'session_url': {
      // "Any page this session": a positive operator holds when one page
      // does, a negative one only when no page would match its positive twin.
      const negative = rule.op === 'not_contains' || rule.op === 'not_equals';
      const positive: CampaignRuleOp =
        rule.op === 'not_contains' ? 'contains' : rule.op === 'not_equals' ? 'equals' : rule.op;
      const some = visitor.sessionUrls.some((url) => textHolds(positive, url, expected));
      return negative ? !some : some;
    }
    case 'referrer':
      return textHolds(rule.op, visitor.referrer ?? undefined, expected);
    case 'country':
      return textHolds(rule.op, visitor.country ?? undefined, expected);
    case 'visitor_type':
      return textHolds(rule.op, visitor.visitorType ?? undefined, expected);
    case 'custom_var': {
      const key = rule.key?.trim() ?? '';
      const variables = visitor.variables ?? {};
      const actual = Object.prototype.hasOwnProperty.call(variables, key)
        ? variables[key]
        : undefined;
      return variableHolds(rule, actual);
    }
    case 'time_on_page':
    case 'exit_intent':
      return false;
  }
}

/**
 * The two-stage decision (EN-03). The server decides its rules now; the
 * browser-side ones go to the widget as `showWhen`:
 *
 *   - `all`: one failing server rule is `none`. All of them holding with no
 *     browser rule is `match`; with browser rules, `wait` for every one of them.
 *   - `any`: one server rule holding is `match` — the card needs nothing
 *     else. None holding, with browser rules, is `wait` for any one of them;
 *     without, `none`.
 *
 * A trigger with no rules, or with a rule the engine cannot read (a row
 * written by hand, a field from a newer release), matches nobody — the
 * failure worth being explicit about on a path that sends unsolicited
 * messages. Pure, and the decision every fire and delivery path goes through.
 */
export function evaluateCampaign(conditions: unknown, visitor: VisitorContext): CampaignVerdict {
  const { match, rules } = normalizeCampaignConditions(conditions);
  if (rules.length === 0) return NONE;
  if (rules.some((rule) => campaignRuleProblem(rule) !== null)) return NONE;

  const browser = rules.filter(isCampaignClientRule);
  const server = rules.filter((rule) => !isCampaignClientRule(rule));

  if (match === 'all') {
    if (!server.every((rule) => serverRuleHolds(rule, visitor))) return NONE;
    return browser.length === 0 ? MATCH : { kind: 'wait', showWhen: { match, rules: browser } };
  }
  if (server.some((rule) => serverRuleHolds(rule, visitor))) return MATCH;
  return browser.length === 0 ? NONE : { kind: 'wait', showWhen: { match, rules: browser } };
}

/**
 * Should this campaign fire at this visitor — shown now or waiting in the
 * widget? The yes/no every fire path asks; `evaluateCampaign` says which.
 *
 * `url_contains` (the first shape) looks at the current page only (EN-04).
 */
export function matchesConditions(conditions: unknown, visitor: VisitorContext): boolean {
  return evaluateCampaign(conditions, visitor).kind !== 'none';
}

/** True when a campaign's card would wait for the browser (it has such a rule). */
export function hasBrowserRules(conditions: unknown): boolean {
  return normalizeCampaignConditions(conditions).rules.some(isCampaignClientRule);
}

/**
 * The trigger as it is stored and answered: the rules, plus `url_contains`
 * while they say exactly what the first shape could (`legacyUrlContains`) —
 * kept for the builder and for a replica of the previous release, which read
 * only that key. Values are trimmed and a country upper-cased once, here.
 */
export function storedConditions(conditions: unknown): CampaignConditions {
  const set = normalizeCampaignConditions(conditions);
  const rules = set.rules.map((rule): CampaignRule => {
    const value =
      typeof rule.value !== 'string'
        ? rule.value
        : rule.field === 'country'
          ? rule.value.trim().toUpperCase()
          : rule.value.trim();
    const key = rule.field === 'custom_var' ? rule.key?.trim() : undefined;
    return key !== undefined
      ? { field: rule.field, op: rule.op, value, key }
      : { field: rule.field, op: rule.op, value };
  });
  const normalised = { match: set.match, rules };
  const legacy = legacyUrlContains(normalised);
  return legacy !== undefined ? { ...normalised, url_contains: legacy } : normalised;
}

/**
 * The lifecycle status of a campaign (PRD §8.4 `campaigns.status`), resolved
 * from the owner's on/off intent and the schedule window: off is `inactive`,
 * on-but-not-started-yet is `scheduled`, on-and-past-its-end is `inactive`,
 * otherwise `ongoing`.
 *
 * A function of `now`, which is exactly why the stored column cannot be left to
 * the write path alone: nothing happens at the instant a start time arrives, so
 * a campaign saved as `scheduled` stays `scheduled` for ever unless something
 * asks the question again. `resolveCampaignStatus` below is that question.
 */
export function computeCampaignStatus(
  input: { active: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): CampaignStatus {
  if (!input.active) return 'inactive';
  if (input.startsAt && input.startsAt.getTime() > now.getTime()) return 'scheduled';
  if (input.endsAt && input.endsAt.getTime() < now.getTime()) return 'inactive';
  return 'ongoing';
}

/**
 * The owner's on/off intent behind a stored status.
 *
 * There is no `active` column: intent and schedule are folded into the one
 * `status` value, so reading the intent back out is an inference rather than a
 * lookup. `ongoing` and `scheduled` are unambiguous — the owner has it on.
 * `inactive` is not: it means *either* "switched off" *or* "was on and its end
 * date has passed", because `computeCampaignStatus` collapses both into the
 * same word.
 *
 * The tie is broken towards "on" when the window explains the `inactive` — an
 * end date already in the past. That reading matters in exactly one place, and
 * it is the one that would otherwise regress: extending the schedule of a
 * finished campaign. Read the other way, `update` would derive "off", recompute
 * `inactive`, and the owner's edit would be a silent no-op — a campaign that
 * cannot be restarted by the only control the builder offers.
 *
 * The price, said plainly: a campaign that was switched off *and* has an end
 * date in the past is indistinguishable from one that simply finished, so
 * extending its window turns it back on. Both look identical in the store and
 * both read `Inactive` in the list; the difference only surfaces when someone
 * deliberately moves the end date into the future, where "run it again" is the
 * likelier request. Storing the intent in its own column is the fix that would
 * remove the guess, and it is a schema change this task does not need.
 */
export function deriveActiveIntent(
  campaign: { status: string; endsAt: Date | null },
  now: Date,
): boolean {
  if (campaign.status !== 'inactive') return true;
  return Boolean(campaign.endsAt && campaign.endsAt.getTime() < now.getTime());
}

/**
 * What a stored campaign's status *is* right now, whatever the column says.
 *
 * The one reading of a stored row, shared by every path that has to decide
 * whether a campaign is running: the list (which also heals the column with the
 * answer), delivery, and the visit-time trigger. Before this existed each of
 * those spelled the same two lines out for itself, which is how three copies of
 * one rule start to drift apart.
 *
 * Invariant worth naming because another path leans on it: a stored `inactive`
 * always resolves to `inactive`. Off stays off, and a finished campaign stays
 * finished (the end date that made the intent read "on" also closes the
 * window). That is what lets `fireCampaignsAtVisitor` exclude `inactive` in SQL
 * — an index-served filter it could not use if this function could turn one of
 * those rows back on.
 */
export function resolveCampaignStatus(
  campaign: { status: string; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): CampaignStatus {
  return computeCampaignStatus(
    {
      active: deriveActiveIntent(campaign, now),
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
    },
    now,
  );
}

/**
 * Displayed / Chats / Conversion over a campaign's sends (FR-MOD-03.3.1-.3).
 *
 * Counted from the sends every time, never cached on the campaign, so the card's
 * numbers can never drift from the rows that produced them.
 *
 * A `campaign_sends` row is written the instant a visitor matches — delivery
 * only happens later, off the widget's own poll (`deliverPendingCampaign`,
 * `campaign-delivery.ts`). Counting every row as `displayed` therefore counted
 * visitors who never saw the message, inflating the denominator the card's
 * conversion rate is read against; `delivered_at` (`M-CAMP-a`) exists precisely
 * to tell the two cases apart, so `displayed` counts only sends that carry one.
 *
 * `conversion` is gated the same way, on purpose: `GoalService.evaluate` marks
 * every one of a customer's sends `converted` on a goal hit without checking
 * delivery (a separate, already-recorded write-side decision — see
 * `campaign-trigger.ts`'s M-CAMP-e note), so an undelivered send can carry
 * `converted: true`. Counting it here would let `conversion` exceed `displayed`
 * and make the ratio the card reports meaningless. Gating both on the same
 * fact keeps `conversion` a subset of `displayed` — a converted-but-undelivered
 * send simply joins the count once its own delivery poll lands, rather than
 * ever being subtracted or corrected after the fact.
 *
 * `chats` needs no such gate in practice — `markCampaignEngaged` only ever
 * credits a send that is already delivered (`campaign-engagement.ts`) — but
 * reading it from the same filtered pass costs nothing and keeps all three
 * numbers answering "of the ones actually displayed" rather than two of them
 * quietly answering a different question.
 *
 * `suppressed` (EN-01 · tm 350) counts the sends a risk flag held back — the
 * card's "Not shown due to risk". A suppressed send is never delivered, so it
 * is never in the other three.
 */
export function campaignPerformance(
  sends: ReadonlyArray<{
    deliveredAt: Date | null;
    suppressedAt?: Date | null;
    engaged: boolean;
    converted: boolean;
  }>,
): CampaignPerformance {
  let displayed = 0;
  let chats = 0;
  let conversion = 0;
  let suppressed = 0;
  for (const send of sends) {
    if (send.suppressedAt) suppressed += 1;
    if (!send.deliveredAt) continue;
    displayed += 1;
    if (send.engaged) chats += 1;
    if (send.converted) conversion += 1;
  }
  return { displayed, chats, conversion, suppressed };
}
