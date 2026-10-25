/**
 * A ticket's conversation in the console (tm 356.4 · HD-01) — the pure half:
 * the cache key, how a delivery state lands in a loaded thread, and which
 * states draw which badge.
 *
 * The thread is the one place an internal note and a reply sit side by side, so
 * the rule that keeps them apart lives here as data, not as a colour someone
 * might forget: a note is drawn with its own label and never with a delivery
 * badge, because it has none to show.
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { TicketMessageDeliveryStatus } from '@siyahtus/types';
import type { PagedResponse } from '../../lib/paged-query.js';
import type { TicketMessage } from './types.js';

/** One ticket's conversation. Every ticket's thread shares the first element. */
export const TICKET_MESSAGES_KEY = ['ticket-messages'] as const;

export function ticketMessagesKey(ticketId: string): readonly [string, string] {
  return [TICKET_MESSAGES_KEY[0], ticketId];
}

/** The `t()` key and tone of a reply's delivery badge. */
export interface DeliveryBadge {
  labelKey: string;
  /** A sentence under the badge, for the state that needs one. */
  hintKey?: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

const BADGES: Record<TicketMessageDeliveryStatus, DeliveryBadge> = {
  queued: { labelKey: 'inbox.ticket.thread.delivery.queued', tone: 'neutral' },
  sent: { labelKey: 'inbox.ticket.thread.delivery.sent', tone: 'success' },
  failed: { labelKey: 'inbox.ticket.thread.delivery.failed', tone: 'danger' },
  // Not an error: the deployment keeps ticket e-mail off (K23) and the reply is
  // stored. Drawn as a plain fact so nobody reads it as a fault to chase.
  suppressed: {
    labelKey: 'inbox.ticket.thread.delivery.suppressed',
    hintKey: 'inbox.ticket.thread.delivery.suppressedHint',
    tone: 'warning',
  },
};

/** Null for anything that was never mailed — a note, the player's own message. */
export function deliveryBadgeOf(message: TicketMessage): DeliveryBadge | null {
  if (message.kind !== 'agent_reply' || message.delivery_status === null) return null;
  return BADGES[message.delivery_status];
}

/** How often an open thread re-reads while one of its replies is still `queued`. */
export const QUEUED_POLL_MS = 2_000;

/** A `queued` reply older than this is stuck, not on its way: polling it forever helps nobody. */
const QUEUED_POLL_WINDOW_MS = 2 * 60_000;

/** Whether a reply was saved moments ago and its e-mail has not settled. */
export function awaitsDelivery(messages: readonly TicketMessage[], now: number): boolean {
  return messages.some(
    (message) =>
      message.kind === 'agent_reply' &&
      message.delivery_status === 'queued' &&
      now - Date.parse(message.created_at) < QUEUED_POLL_WINDOW_MS,
  );
}

/** Only a reply whose e-mail failed offers "try again". */
export function canTryAgain(message: TicketMessage): boolean {
  return message.kind === 'agent_reply' && message.delivery_status === 'failed';
}

/** The loaded thread with one message replaced by `next`; anything else untouched. */
export function withMessage(
  data: InfiniteData<PagedResponse<TicketMessage>> | undefined,
  next: TicketMessage,
): InfiniteData<PagedResponse<TicketMessage>> | undefined {
  if (!data) return data;
  let touched = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((item) => item.id === next.id)) return page;
    touched = true;
    return { ...page, items: page.items.map((item) => (item.id === next.id ? next : item)) };
  });
  return touched ? { ...data, pages } : data;
}

/**
 * The loaded thread with one message's delivery state changed — what the
 * `ticket_message_delivery_changed` push means. A message not loaded (yet) is
 * left alone: the next read of the thread carries its state.
 */
export function withDelivery(
  data: InfiniteData<PagedResponse<TicketMessage>> | undefined,
  messageId: string,
  status: TicketMessageDeliveryStatus,
): InfiniteData<PagedResponse<TicketMessage>> | undefined {
  if (!data) return data;
  let touched = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((item) => item.id === messageId && item.delivery_status !== status)) {
      return page;
    }
    touched = true;
    return {
      ...page,
      items: page.items.map((item) =>
        item.id === messageId ? { ...item, delivery_status: status } : item,
      ),
    };
  });
  return touched ? { ...data, pages } : data;
}
