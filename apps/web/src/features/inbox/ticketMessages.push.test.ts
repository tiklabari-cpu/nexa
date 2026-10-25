/**
 * The two ticket pushes (tm 356.4 · HD-01). A message landing carries ids only,
 * so the console re-reads; a delivery change carries the status and nothing
 * else, so one badge is redrawn in place and no request is made.
 */
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { PagedResponse } from '../../lib/paged-query.js';
import { ticketMessagesKey } from './ticketMessages.js';
import type { TicketMessage } from './types.js';
import { applyPush } from './useInbox.js';

const REPLY: TicketMessage = {
  id: '00000000-0000-4000-8000-000000000001',
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
};

function seeded(): QueryClient {
  const client = new QueryClient();
  const data: InfiniteData<PagedResponse<TicketMessage>> = {
    pages: [{ items: [REPLY] }],
    pageParams: [undefined],
  };
  client.setQueryData(ticketMessagesKey('TCK1'), data);
  return client;
}

describe('ticket pushes', () => {
  it('re-reads the thread, the ticket and the lists on `ticket_message_created`', () => {
    const client = seeded();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    applyPush(client, 'ticket_message_created', {
      ticket_id: 'TCK1',
      message_id: REPLY.id,
      kind: 'customer_message',
      author_type: 'customer',
      author_id: 'c1',
      created_at: REPLY.created_at,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ticket-messages'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ticket'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] });
  });

  it('redraws one badge on `ticket_message_delivery_changed` without a request', () => {
    const client = seeded();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    applyPush(client, 'ticket_message_delivery_changed', {
      ticket_id: 'TCK1',
      message_id: REPLY.id,
      delivery_status: 'failed',
    });
    const data = client.getQueryData<InfiniteData<PagedResponse<TicketMessage>>>(
      ticketMessagesKey('TCK1'),
    );
    expect(data?.pages[0]?.items[0]?.delivery_status).toBe('failed');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores a delivery push with a status it does not know', () => {
    const client = seeded();
    applyPush(client, 'ticket_message_delivery_changed', {
      ticket_id: 'TCK1',
      message_id: REPLY.id,
      delivery_status: 'bounced',
    });
    const data = client.getQueryData<InfiniteData<PagedResponse<TicketMessage>>>(
      ticketMessagesKey('TCK1'),
    );
    expect(data?.pages[0]?.items[0]?.delivery_status).toBe('queued');
  });
});
