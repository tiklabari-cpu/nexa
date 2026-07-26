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
 * The lifecycle status to store for a campaign (PRD §8.4 `campaigns.status`),
 * resolved from the owner's on/off intent and the schedule window at write time:
 * off is `inactive`, on-but-not-started-yet is `scheduled`, on-and-past-its-end
 * is `inactive`, otherwise `ongoing`. Computed on save rather than derived on
 * read so it filters directly and matches the table's status check constraint.
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
