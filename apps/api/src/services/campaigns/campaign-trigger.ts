/**
 * Campaign triggering on the visit write path — the other direction
 * (FR-MOD-03.3.2, audit finding K2).
 *
 * `CampaignService.#fireIfRunning` evaluates **one campaign against every live
 * visitor**, and it runs when the owner saves. That covers exactly one order of
 * events: the visitor was already here when the campaign was written. The
 * reverse order — the campaign has been running for a week and somebody new
 * lands on the page it targets — matched nobody at all, because nothing
 * re-evaluated after the save. A targeted message that only reaches people who
 * happened to be on the site during the thirty minutes around its creation is
 * not a campaign; it is a broadcast to whoever was in the room.
 *
 * This is the dual: **one visitor against every running campaign**, evaluated
 * where the visitor's pages are actually written (`recordPageView`). Between the
 * two, a match is found whichever of the pair arrived second.
 *
 * ## Where the work goes: synchronous, inside the visit's own transaction
 *
 * The alternatives were a post-commit fire-and-forget and a short per-tenant
 * cache of the running set. Both were rejected on measurement rather than
 * taste — synthetic `campaigns` table, 203k rows across 20.2k workspaces
 * (`EXPLAIN ANALYZE`, tm 176.5):
 *
 * | read                                          | measured   |
 * | --------------------------------------------- | ---------- |
 * | typical workspace (10 campaigns, 7 running)   | 0.067 ms   |
 * | busy workspace (130 campaigns, 87 running)    | 0.159 ms   |
 * | pathological (309 running), `LIMIT 100`       | 0.162 ms   |
 * | same read with the index refused              | 10.7 ms    |
 * | 200 consecutive reads, different tenants      | 3.96 ms total (~0.02 ms each) |
 *
 * The existing `campaigns(license_id, status)` index already serves it — a
 * bitmap scan, ~160x faster than the parallel seq scan it replaces — so the
 * whole addition to the write path is **~0.07 ms against NFR-P2's 300 ms p99
 * write budget: about 0.02% of it**. A cache cannot buy back a number that
 * small, and it would be paid for in the one currency this feature cannot
 * afford: staleness on the owner's on/off switch and on the schedule window,
 * i.e. a campaign that keeps firing after somebody switched it off. Deferring
 * the work past the commit buys as little and costs the atomicity below.
 *
 * Inside the visit's transaction, then — which also makes "this visitor was
 * seen on this page" and "this campaign fired at them" a single fact. Split
 * across two transactions, a failure between them leaves either a visit that
 * will never be re-evaluated (nothing re-reads old visits) or a send justified
 * by a page view the database has no record of.
 *
 * ## Idempotency
 *
 * Every reported page is an evaluation — including a reload, and including a
 * fifth message from the same page. That is deliberate: the *campaigns* change
 * under a visitor who is standing still, so "only re-evaluate when they
 * navigate" would miss a scheduled campaign whose window opens while they are
 * mid-conversation. It is affordable only because re-firing is a no-op, and
 * that no-op is a database guarantee rather than a check: the unique
 * `(campaign_id, customer_id)` pair turns the insert into `ON CONFLICT DO
 * NOTHING`. Measured on the same table, a visitor already owed 68 sends:
 * first fire **2.4 ms** (68 real inserts), every repeat after it **0.22 ms**.
 * The repeat is what a chatty visitor actually pays.
 *
 * Two windows racing (a visitor with two tabs) cannot double-send for the same
 * reason — the second insert conflicts and is dropped, so `sent` is honest
 * about how many *fresh* sends this evaluation produced.
 */
import type { Prisma } from '@prisma/client';
import type { CampaignConditions } from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { matchesConditions, resolveCampaignStatus } from './campaign-matching.js';

/**
 * How many of a workspace's campaigns one page view will evaluate.
 *
 * A bound rather than a product rule: this runs on the visit write path, and an
 * unbounded read there is the shape NFR-P2 rules out — one workspace with a
 * runaway campaign list must not be able to slow every other workspace's
 * visitors down. It is set far past plausible use (a workspace nudging its
 * visitors with a hundred simultaneous proactive messages has a bigger problem
 * than this limit) and costs nothing at the cap: the `LIMIT 100` read of a
 * 309-campaign workspace measured 0.162 ms against 0.151 ms unbounded.
 *
 * Oldest first, so which campaigns fall past the cap is stable rather than
 * shuffling between page views. What a workspace past the cap loses is narrow
 * and worth naming: its newest campaigns still fire at everyone live when they
 * are saved (`CampaignService.#fireIfRunning`) — they just stop being matched
 * against visitors who arrive later.
 */
const RUNNING_CAMPAIGN_LIMIT = 100;

/** A campaign as this path reads it — trigger, schedule, stored on/off intent. */
export interface TriggerableCampaign {
  id: string;
  status: string;
  conditions: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Which of these campaigns should fire at a visitor on these pages, right now.
 *
 * Pure and separately tested for the same reason `pickDeliverableSend` is: this
 * is the decision — who gets an unsolicited message — and it should be pinnable
 * without a database.
 *
 * "Running" is recomputed from `starts_at`/`ends_at` (`resolveCampaignStatus`)
 * rather than trusted from the stored `status`. The column is healed by the
 * campaigns list (tm 176.6), but a visitor arriving before anyone has opened
 * that page would still meet the value the owner's last save wrote — and this
 * decision, whether a stranger gets an unsolicited message, is not one to hang
 * on somebody having looked at a screen. That cuts both ways on purpose: a
 * campaign whose end date passed must not fire at a new arrival, and a
 * scheduled one whose start time has come must.
 */
export function selectTriggeredCampaigns(
  campaigns: readonly TriggerableCampaign[],
  pageUrls: readonly string[],
  now: Date,
): string[] {
  const fired: string[] = [];
  for (const campaign of campaigns) {
    if (resolveCampaignStatus(campaign, now) !== 'ongoing') continue;

    // `matchesConditions` already refuses a predicate with nothing set, so a
    // campaign that somehow lost its trigger matches nobody rather than
    // everybody — the failure worth being explicit about on a path that sends
    // unsolicited messages.
    if (matchesConditions((campaign.conditions ?? {}) as CampaignConditions, [...pageUrls])) {
      fired.push(campaign.id);
    }
  }
  return fired;
}

/**
 * Fire every running campaign this visitor's pages match, and return how many
 * *fresh* sends were written (0 on nearly every page view).
 *
 * Runs inside the caller's tenant transaction. Cross-tenant firing is
 * structurally impossible here twice over: `tx` is the RLS-scoped client, and
 * the read carries an explicit `license_id` filter on top of it — the same
 * belt-and-braces `deliverPendingCampaign` uses on the delivery side. Measured,
 * as it was there: deleting the filter breaks **no** test, because RLS refuses
 * the other workspace's campaigns on its own. The filter is the second lock,
 * and the suite's isolation test should be read as proving the policy rather
 * than the predicate.
 *
 * The visitor is not filtered on "is the widget open" or "is there a chat":
 * a match is a match, and whether the message is *shown* is delivery's decision
 * (`campaign-delivery.ts` holds a send back while a conversation is open rather
 * than burning it). Keeping the two apart is what lets a nudge earned during a
 * chat still arrive after it ends.
 */
export async function fireCampaignsAtVisitor(
  tx: TenantClient,
  tenant: TenantContext,
  input: { customerId: string; pageUrls: readonly string[] },
  now: Date,
): Promise<number> {
  // A visitor with no readable page cannot match any trigger the engine
  // supports (every condition kind is about where they are), so the read is
  // skipped entirely rather than run to produce an empty match.
  if (input.pageUrls.length === 0) return 0;

  const campaigns = await tx.campaign.findMany({
    where: {
      licenseId: tenant.licenseId,
      // Index-served (`campaigns_license_id_status_idx`). `inactive` is excluded
      // in SQL rather than in memory because it is the one status the recompute
      // below can never turn back on — a documented invariant of
      // `resolveCampaignStatus`, and pinned by its unit test — so reading those
      // rows would be work with no possible outcome.
      status: { in: ['ongoing', 'scheduled'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: RUNNING_CAMPAIGN_LIMIT,
    select: { id: true, status: true, conditions: true, startsAt: true, endsAt: true },
  });
  if (campaigns.length === 0) return 0;

  const matched = selectTriggeredCampaigns(campaigns, input.pageUrls, now);
  if (matched.length === 0) return 0;

  const result = await tx.campaignSend.createMany({
    data: matched.map((campaignId) => ({
      licenseId: tenant.licenseId,
      campaignId,
      customerId: input.customerId,
    })),
    // The idempotency this path is built on: the unique (campaign, customer)
    // pair means every page view after the first is a no-op, and a visitor is
    // never nudged twice by the same campaign.
    skipDuplicates: true,
  } satisfies Prisma.CampaignSendCreateManyArgs);
  return result.count;
}
