/**
 * The campaign trigger engine's pure core (FR-MOD-03.3.2/.3).
 *
 * Kept free of Prisma and clocks so the parts most worth trusting — does this
 * visitor match, and what do the numbers say — are decided by functions a unit
 * test can pin down exactly. The service around this reads the visitors, writes
 * the sends, and hands the clock in.
 */
import type { CampaignConditions, CampaignPerformance, CampaignStatus } from '@nexa/types';

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

/** True when the trigger has at least one usable condition to match on. */
export function hasTrigger(conditions: CampaignConditions): boolean {
  return Boolean(conditions.url_contains && conditions.url_contains.trim());
}

/**
 * Does a visitor on these pages match the campaign's trigger?
 *
 * Every condition that is set must hold (AND). A predicate with nothing set
 * matches nobody — a campaign with no trigger is not "send to everyone", it is
 * not ready to send — which is what keeps the "trigger required" rule honest
 * even for a row that somehow reached the engine without one.
 */
export function matchesConditions(conditions: CampaignConditions, pageUrls: string[]): boolean {
  const checks: boolean[] = [];

  const urlNeedle = conditions.url_contains?.trim().toLowerCase();
  if (urlNeedle) {
    checks.push(pageUrls.some((url) => url.toLowerCase().includes(urlNeedle)));
  }

  // Future condition kinds (geo, time-on-page, …) push their own check here.
  if (checks.length === 0) return false;
  return checks.every(Boolean);
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
 * Displayed / Chats / Conversion over a campaign's sends (FR-MOD-03.3.3).
 *
 * Counted from the sends every time, never cached on the campaign, so the card's
 * numbers can never drift from the rows that produced them.
 */
export function campaignPerformance(
  sends: ReadonlyArray<{ engaged: boolean; converted: boolean }>,
): CampaignPerformance {
  let chats = 0;
  let conversion = 0;
  for (const send of sends) {
    if (send.engaged) chats += 1;
    if (send.converted) conversion += 1;
  }
  return { displayed: sends.length, chats, conversion };
}
