/**
 * A ticket reply's `delivery_status`, written from the mail outbox (tm 464.2).
 *
 * A reply is stored `queued` and its mail goes through the outbox. Until the
 * outbox, the request's own send was the only one, so the request wrote the
 * outcome back (tm 356.3). Now a first try that fails retryably is retried by
 * the `mail_outbox` job minutes later, in another process perhaps — so the
 * outcome is written by the outbox's settle hook, which hears every row's end
 * whichever sender reached it. `unconfirmed` is written `sent`, as before: the
 * message may well have arrived, and "try again" would mail the same answer
 * twice.
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import type { MailOutboxSettledEvent } from '../mail/outbox.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { TicketMessageService } from './ticket-message-service.js';

export function ticketReplySettledHook(
  db: PrismaClient,
  publisher: Pick<RealtimePublisher, 'publish'>,
): (event: MailOutboxSettledEvent) => Promise<void> {
  const messages = new TicketMessageService();
  return async (event) => {
    if (event.kind !== 'ticket_reply' || event.licenseId === null) return;
    const emailMessageId = event.message?.messageId;
    if (!emailMessageId) return;
    // The one cross-tenant read: the licence's organisation, for the context.
    const rows = await db.$queryRaw<Array<{ organization_id: string }>>`
      SELECT organization_id FROM retention_list_tenants() WHERE license_id = ${event.licenseId}`;
    const organizationId = rows[0]?.organization_id;
    if (!organizationId) return;
    const tenant: TenantContext = { licenseId: event.licenseId, organizationId };
    const status = event.status === 'failed' ? 'failed' : 'sent';
    const push = await withTenant(db, tenant, (tx) =>
      messages.recordDeliveryOf(tx, emailMessageId, status),
    );
    if (push) {
      await publisher.publish(
        tenant,
        'ticket_message_delivery_changed',
        push.audience,
        push.payload,
      );
    }
  };
}
