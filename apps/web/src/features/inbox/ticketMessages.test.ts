import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { PagedResponse } from '../../lib/paged-query.js';
import {
  awaitsDelivery,
  canTryAgain,
  deliveryBadgeOf,
  ticketMessagesKey,
  withDelivery,
  withMessage,
} from './ticketMessages.js';
import type { TicketMessage } from './types.js';

function message(overrides: Partial<TicketMessage> = {}): TicketMessage {
  return {
    id: 'm1',
    ticket_id: 'TCK1',
    kind: 'agent_reply',
    author_type: 'agent',
    author_id: 'a1',
    author_name: 'Ada',
    body_text: 'Hello',
    body_text_full: null,
    attachments: [],
    delivery_status: 'queued',
    created_at: '2026-10-25T10:00:00.000Z',
    ...overrides,
  };
}

function thread(...pages: TicketMessage[][]): InfiniteData<PagedResponse<TicketMessage>> {
  return {
    pages: pages.map((items) => ({ items })),
    pageParams: pages.map(() => undefined),
  };
}

describe('ticket message cache', () => {
  it('keys a thread by its ticket under the shared prefix', () => {
    expect(ticketMessagesKey('TCK1')).toEqual(['ticket-messages', 'TCK1']);
  });

  it('draws a delivery badge only on a reply', () => {
    expect(deliveryBadgeOf(message({ delivery_status: 'sent' }))?.tone).toBe('success');
    expect(deliveryBadgeOf(message({ delivery_status: 'failed' }))?.tone).toBe('danger');
    expect(deliveryBadgeOf(message({ delivery_status: 'suppressed' }))?.hintKey).toBeTruthy();
    // A note never has a delivery state to show, whatever a malformed row says.
    expect(
      deliveryBadgeOf(
        message({ kind: 'internal_note', author_type: 'agent', delivery_status: 'sent' }),
      ),
    ).toBeNull();
    expect(
      deliveryBadgeOf(message({ kind: 'customer_message', delivery_status: null })),
    ).toBeNull();
  });

  it('offers "try again" only on a failed reply', () => {
    expect(canTryAgain(message({ delivery_status: 'failed' }))).toBe(true);
    for (const status of ['queued', 'sent', 'suppressed', null] as const) {
      expect(canTryAgain(message({ delivery_status: status }))).toBe(false);
    }
    expect(canTryAgain(message({ kind: 'internal_note', delivery_status: 'failed' }))).toBe(false);
  });

  it('polls only for a recent reply whose e-mail has not settled', () => {
    const created = Date.parse('2026-10-25T10:00:00.000Z');
    expect(awaitsDelivery([message()], created + 1_000)).toBe(true);
    expect(awaitsDelivery([message({ delivery_status: 'sent' })], created + 1_000)).toBe(false);
    expect(
      awaitsDelivery([message({ kind: 'customer_message', delivery_status: null })], created),
    ).toBe(false);
    // Queued for minutes is stuck, not on its way.
    expect(awaitsDelivery([message()], created + 10 * 60_000)).toBe(false);
  });

  it('redraws one badge in place and leaves every other message the same object', () => {
    const other = message({ id: 'm2', delivery_status: 'sent' });
    const before = thread([message()], [other]);
    const after = withDelivery(before, 'm1', 'failed');
    expect(after?.pages[0]?.items[0]?.delivery_status).toBe('failed');
    expect(after?.pages[1]).toBe(before.pages[1]);
  });

  it('leaves the cache untouched for an unknown message or an unchanged state', () => {
    const before = thread([message({ delivery_status: 'sent' })]);
    expect(withDelivery(before, 'nope', 'failed')).toBe(before);
    expect(withDelivery(before, 'm1', 'sent')).toBe(before);
    expect(withDelivery(undefined, 'm1', 'sent')).toBeUndefined();
  });

  it('replaces a whole message by id', () => {
    const before = thread([message(), message({ id: 'm2' })]);
    const after = withMessage(before, message({ delivery_status: 'queued', body_text: 'Again' }));
    expect(after?.pages[0]?.items[0]?.body_text).toBe('Again');
    expect(after?.pages[0]?.items[1]).toBe(before.pages[0]?.items[1]);
    expect(withMessage(before, message({ id: 'unknown' }))).toBe(before);
  });
});
