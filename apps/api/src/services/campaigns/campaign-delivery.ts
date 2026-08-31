/**
 * Campaign delivery — actually carrying a proactive message to the visitor
 * (FR-MOD-03.3.2, audit finding K2).
 *
 * The trigger engine (`campaign-service.ts`) decides *who* gets a campaign and
 * writes one `campaign_sends` row per matched visitor. Until this file existed
 * that was the end of it: nothing ever told the widget, so the module's whole
 * promise — a targeted message reaching the person it was aimed at — was never
 * kept. This is the other half: the widget's poll (`GET /customer/chat`) asks
 * "anything for me?", and a still-owed send (`delivered_at IS NULL`) is answered
 * with the message and stamped delivered in the same transaction.
 *
 * No new transport. The widget already polls every 4 seconds and already knows
 * how to show a proactive card (the greeting); a socket for the customer side
 * would be a far larger change for a message that is not time-critical to the
 * second.
 *
 * ## Delivery guarantee: at-most-once, deliberately
 *
 * The stamp commits before the response bytes leave the server, so a connection
 * that dies in between loses the message: the row says delivered, the visitor
 * never saw a card. That is the choice, not an oversight. The alternative — hold
 * the stamp until the widget acknowledges — makes delivery at-least-once, and
 * "at least once" on a 4-second poll means an unacknowledged campaign card
 * reappearing every 4 seconds until the ack lands.
 *
 * Weigh the two failure modes as the visitor experiences them. A lost campaign
 * message is invisible: nobody misses a proactive nudge they never knew was
 * coming, and the visitor can still open the widget and talk to somebody. A
 * repeated one is the opposite of invisible — it is the pop-up that will not go
 * away, on the surface whose entire job is to make a stranger feel like talking
 * to this company. For a message the visitor never asked for, duplicate delivery
 * is strictly worse than no delivery, so the guarantee is set to the side that
 * fails quietly.
 *
 * The cost lands on the numbers rather than the visitor: `delivered_at` means
 * "the server handed this to the visitor's widget", which is the strongest claim
 * anything can make without an ack round-trip, and can over-count by the rare
 * dropped response. Said plainly in the OpenAPI description so nobody reads the
 * card's figures as "seen by a human".
 *
 * ## One at a time, oldest first
 *
 * A visitor who matches three campaigns is nudged three times across three
 * polls, not shown three cards at once. Two reasons and they point the same way:
 * the widget has one proactive card slot (the greeting's), and three
 * simultaneous unsolicited messages is the behaviour that makes people install
 * blockers. Oldest first because the alternative — newest first — lets a busy
 * workspace's fresh campaigns starve the ones already owed.
 */
import type { CampaignContent } from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { trialState } from '../billing/metering.js';
import { computeCampaignStatus } from './campaign-matching.js';

/**
 * How many still-owed sends to look at before giving up for this poll.
 *
 * Candidates are read rather than just the single oldest because a pending send
 * can be undeliverable — its campaign was switched off, or its window closed —
 * and one of those must not wedge the queue for every campaign behind it.
 * Bounded so a visitor who somehow accumulated a large backlog cannot turn the
 * hottest read path in the product into an unbounded scan; ten is far more
 * campaigns than one visitor plausibly matches, and anything past it is picked
 * up by the next poll four seconds later once the ones in front are stamped.
 */
const PENDING_CANDIDATE_LIMIT = 10;

/** A still-owed send with the campaign that produced it, as the poll reads it. */
export interface PendingSend {
  id: string;
  campaign: {
    id: string;
    status: string;
    content: unknown;
    startsAt: Date | null;
    endsAt: Date | null;
  };
}

/** What the poll response carries when a campaign is owed. */
export interface DeliverableCampaign {
  /** The `campaign_sends` row to stamp. */
  sendId: string;
  /** The campaign — the widget's dismissal key, and what 03.3.2's card is about. */
  campaignId: string;
  message: string;
}

/**
 * The first candidate that is still worth delivering, or null.
 *
 * Pure and separately tested: this is where "should this visitor see this
 * message right now" is decided, and it is worth being able to pin that down
 * without a database.
 *
 * A campaign is only delivered while it is *running at this moment*, not merely
 * because it was running when the trigger matched. An owner who switches a
 * campaign off, or whose end date has passed, has said stop — and a send that
 * was queued before that must not sneak out afterwards. The window is
 * re-evaluated here from `starts_at`/`ends_at` rather than trusted from the
 * stored `status`, which is only recomputed on write and therefore goes stale
 * (that staleness is its own known defect, tm 176.6; this path does not depend
 * on it being fixed). `status !== 'inactive'` is the stored on/off intent —
 * the same reading `CampaignService.update` uses.
 *
 * An undeliverable candidate is skipped, never stamped: it stays owed, so a
 * campaign paused for a week and switched back on still reaches the visitors it
 * had already matched.
 */
export function pickDeliverableSend(
  candidates: readonly PendingSend[],
  now: Date,
): DeliverableCampaign | null {
  for (const send of candidates) {
    const message = (send.campaign.content as CampaignContent | null)?.message?.trim();
    // A campaign with no message cannot be created or activated, so this is a
    // row that was switched off and emptied, or one from before the rule. Skip
    // rather than deliver an empty card.
    if (!message) continue;

    const status = computeCampaignStatus(
      {
        active: send.campaign.status !== 'inactive',
        startsAt: send.campaign.startsAt,
        endsAt: send.campaign.endsAt,
      },
      now,
    );
    if (status !== 'ongoing') continue;

    return { sendId: send.id, campaignId: send.campaign.id, message };
  }
  return null;
}

/**
 * Deliver the campaign message this visitor is owed, if any.
 *
 * Runs inside the poll's own tenant transaction, so the read that finds the send
 * and the write that stamps it cannot be split: the message is never handed over
 * without the row that says it was.
 *
 * `hasOpenChat` suppresses delivery entirely, and that is a product decision
 * rather than a performance one. A campaign exists to *start* a conversation;
 * somebody already in one has started it, and the widget has nowhere sensible to
 * put a proactive card over a live transcript. Stamping anyway would burn the
 * send on a card that was never going to be shown — precisely the dishonesty
 * `delivered_at` was introduced to stop. Left owed instead, so it can still be
 * delivered once the conversation is over.
 *
 * Cross-tenant safety is structural rather than checked: `tx` is the caller's
 * RLS-scoped client, and both the send and its campaign are read through it with
 * an explicit `license_id` filter on top. Another workspace's campaign cannot be
 * selected here even if the customer id somehow collided — measured by deleting
 * the filter and planting a B-licence send against an A visitor, which RLS
 * refused on its own. The filter stays as the second lock, and the suite's
 * isolation test should be read as proving the policy rather than the predicate.
 */
export async function deliverPendingCampaign(
  tx: TenantClient,
  tenant: TenantContext,
  input: { customerId: string; hasOpenChat: boolean; bannedAt: Date | null },
  now: Date,
): Promise<{ id: string; message: string } | null> {
  if (input.hasOpenChat) return null;
  // A banned visitor cannot open a conversation (`chat-service` refuses on
  // `banned_at`), so inviting them into one would burn the send on a promise
  // the product then breaks. Free to check — the poll already reads this
  // customer row. The address-based half of the ban is deliberately not checked
  // here: `isIpBanned` is a query, and adding one to every four-second poll of
  // every open widget to catch a case the identity ban already covers for
  // anyone who has been here before is not a trade worth making.
  if (input.bannedAt) return null;

  const candidates = await tx.campaignSend.findMany({
    where: { licenseId: tenant.licenseId, customerId: input.customerId, deliveredAt: null },
    // Oldest first; the id breaks ties so two sends written by the same
    // `createMany` cannot swap places between polls.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: PENDING_CANDIDATE_LIMIT,
    select: {
      id: true,
      campaign: {
        select: { id: true, status: true, content: true, startsAt: true, endsAt: true },
      },
    },
  });
  // The common case, and the reason everything expensive below is behind it:
  // almost every poll finds nothing owed, and the partial index on
  // `(license_id, customer_id) WHERE delivered_at IS NULL` answers that in
  // microseconds (measured, tm 176.1).
  if (candidates.length === 0) return null;

  const deliverable = pickDeliverableSend(candidates, now);
  if (!deliverable) return null;

  // An expired trial is read-only (ADR-10): existing conversations stay
  // readable, new ones are refused with `license_expired`. A campaign card is an
  // invitation to start one, so delivering it here would hand the visitor a
  // button that 402s. The `license-gate` hook cannot catch this — it only
  // guards mutating methods, and this write rides on a GET — so the same rule is
  // applied by hand. Read only once a send is actually deliverable, so the poll
  // that finds nothing owed pays nothing for it.
  const { access } = await trialState(tx, tenant);
  if (access === 'read_only') return null;

  // The stamp *is* the claim. `delivered_at: null` in the predicate makes it a
  // compare-and-set: two polls racing (a reconnect firing while the previous
  // request is still in flight) both read the same candidate, but the second
  // blocks on the row lock, re-reads after the first commits and matches
  // nothing. Exactly one of them may answer with the message.
  const stamped = await tx.campaignSend.updateMany({
    where: { id: deliverable.sendId, deliveredAt: null },
    data: { deliveredAt: now },
  });
  if (stamped.count !== 1) return null;

  return { id: deliverable.campaignId, message: deliverable.message };
}
