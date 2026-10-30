/**
 * A card's `send_message` button, pressed by a player (EN-02 · tm 353).
 *
 * The press becomes an ordinary player message — the button's label as its
 * text — so the AI, routing and the rule bot read it exactly as if it had
 * been typed; there is no second path for them to get wrong. What the message
 * carries besides is `properties.postback`: which button, on which card. The
 * Inbox draws the card and the button from it; the campaign counts the click.
 *
 * The label is the card's, read from the server's copy, never the request's:
 * a visitor can press only a button that exists, on a card they were sent
 * (a campaign send of theirs, not held back for a risk flag) or that sits in
 * one of their own conversations (a `rich_message` addressed to them). A
 * button that does not send a message — a link, a coupon — has no message to
 * write and is refused here too.
 */
import { readRichCard, type CardPostback, type RichCard } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { offeredCampaignCard } from './campaign-delivery.js';

/** What the widget sends: one of the two sources, and the button's position. */
export interface CardPostbackInput {
  campaign_id?: string;
  event_id?: string;
  button: number;
}

export interface PressedCardButton {
  /** The message's text: the button's label. */
  label: string;
  /** `properties.postback` for the message. */
  postback: CardPostback;
  /** The campaign send to count as clicked once the message is in. */
  sendId: string | null;
}

/** Event ids are `<thread_id>_<sequence>` — the thread narrows the lookup to its partition key. */
const EVENT_ID = /^([A-Za-z0-9]{1,12})_\d{1,10}$/;

function pressable(card: RichCard | null, button: number): string {
  const pressed = card?.buttons[button];
  if (!pressed) throw ApiError.validation('postback.button: the card has no such button.');
  if (pressed.action.type !== 'send_message') {
    throw ApiError.validation('postback.button: that button does not send a message.');
  }
  return pressed.label;
}

/** The button a postback names, checked against the card it is on; a 400 otherwise. */
export async function resolveCardPostback(
  tx: TenantClient,
  tenant: TenantContext,
  customerId: string,
  input: CardPostbackInput,
): Promise<PressedCardButton> {
  if (input.campaign_id) {
    const offered = await offeredCampaignCard(tx, tenant, {
      customerId,
      campaignId: input.campaign_id,
    });
    if (!offered) throw ApiError.validation('postback.campaign_id: no such campaign card.');
    const label = pressable(offered.card, input.button);
    return {
      label,
      postback: {
        source: 'campaign',
        campaign_id: input.campaign_id,
        button: input.button,
        label,
        // As it was when pressed: the Inbox shows what the player saw, even
        // after the campaign is edited.
        card: offered.card,
      },
      sendId: offered.sendId,
    };
  }

  const threadId = EVENT_ID.exec(input.event_id ?? '')?.[1];
  const event = threadId
    ? await tx.event.findFirst({
        where: {
          id: input.event_id!,
          threadId,
          licenseId: tenant.licenseId,
          type: 'rich_message',
          recipients: 'all',
          thread: { chat: { customerId } },
        },
        select: { properties: true },
      })
    : null;
  if (!event) throw ApiError.validation('postback.event_id: no such card in your conversation.');
  const card = readRichCard((event.properties as Record<string, unknown> | null)?.['card']);
  const label = pressable(card, input.button);
  return {
    label,
    postback: { source: 'event', event_id: input.event_id!, button: input.button, label },
    sendId: null,
  };
}
