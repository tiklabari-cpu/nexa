/**
 * Campaign engagement — flipping `engaged` when it is actually earned
 * (FR-MOD-03.3.2/.3, audit finding K2's last unclosed half).
 *
 * `campaign_sends.engaged` is the "Chats" half of the card's Displayed / Chats
 * / Conversion numbers (`campaignPerformance` counts it directly) and, in
 * production, it never turned true — nothing ever wrote it. This is that write.
 *
 * ## What "engaged" means here
 *
 * The reading that matches what the widget can actually tell the server: a
 * visitor is engaged the moment they open a chat while a campaign send is
 * still owed to them in the "shown but not yet acted on" sense — delivered,
 * not yet engaged. Delivery (`campaign-delivery.ts`) already guarantees that
 * can only be true while the visitor has *no* open conversation, so the only
 * place a chat-open can complete it is `POST /customer/chat/events`'s
 * new-chat branch — a reply into an already-open chat can never be the first
 * time this visitor engaged.
 *
 * ## Click-through vs. "opened anyway" — deliberately not distinguished
 *
 * The widget clears its local campaign card the instant the panel opens
 * (`setOpen`, `apps/widget/src/widget.ts`) whether the visitor clicked the
 * card's own CTA or the plain launcher, and a dismissed card's key lives only
 * in `sessionStorage` — the server is never told which one happened. Wiring
 * that distinction through would mean a new field on
 * `POST /customer/chat/events` and a contract change for a widget that
 * already shipped (tm 176.3); that is a bigger, separate decision, not this
 * task's to make unasked (CONVENTIONS §5). Until then, credit goes to the
 * visitor opening a chat at all: a nudge that still had a live invitation
 * outstanding when the visitor decided to talk to somebody counts, whether or
 * not the card was the reason they clicked.
 *
 * ## No time window; last delivered send wins
 *
 * A visitor can accumulate more than one delivered-but-unengaged send (each
 * poll delivers at most one, oldest first, and a dismissed card just lets the
 * next one through on the following poll — see `campaign-delivery.ts`), so
 * more than one campaign can be "still owed" when a chat finally opens.
 * Rather than crediting all of them — which would let one conversation
 * inflate every campaign that happened to reach this visitor — only the most
 * recently delivered one is credited: last touch, the same rule the widget's
 * own card slot already applies (`activeCard`, tm 176.3 — a newer pending
 * campaign is what the visitor actually saw last). No expiry is applied
 * either: a `delivered_at` with no chat yet stays eligible for as long as the
 * `campaign_sends` row exists — delivery itself has no retention sweep (see
 * the model's own doc comment) — so a visitor who ignores a nudge for a week
 * and then opens a chat still credits it. The PRD names no attribution
 * window, and inventing one here would be a guess dressed as a decision.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/**
 * Credit a freshly opened chat to this visitor's most recently delivered,
 * not-yet-engaged campaign send, if one exists. A no-op when nothing is
 * outstanding, which is nearly every chat — most conversations never had a
 * campaign behind them.
 *
 * `engaged: false` in both the read and the write is the same compare-and-set
 * shape `deliverPendingCampaign` uses for `delivered_at`: two racing
 * chat-opens for the same visitor cannot double-credit a send. In practice a
 * customer can only have one active chat at a time (`ChatService.start`
 * reuses an existing one), so this is defence in depth rather than a
 * reachable race.
 */
export async function markCampaignEngaged(
  tx: TenantClient,
  tenant: TenantContext,
  input: { customerId: string; chatId: string },
): Promise<void> {
  const outstanding = await tx.campaignSend.findFirst({
    where: {
      licenseId: tenant.licenseId,
      customerId: input.customerId,
      deliveredAt: { not: null },
      engaged: false,
    },
    orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (!outstanding) return;

  await tx.campaignSend.updateMany({
    where: { id: outstanding.id, engaged: false },
    data: { engaged: true, chatId: input.chatId },
  });
}
