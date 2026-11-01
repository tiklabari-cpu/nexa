/**
 * What a player's judgement of a connection sets off once it committed
 * (AU-03 · tm 374):
 *
 *   - **a webhook delivery**, `chat_rated` (`ChatRatedSignal`): ids, the value,
 *     the team and the comment as stored — masked (AI-26). Only for a
 *     judgement: a new vote or a changed value. A comment added to a vote
 *     already sent is not a second one, so a subscriber hears of a vote once;
 *   - **for a bad vote, the brand's bad-rating automation**
 *     (`inbox_settings.bad_rating_actions`, defaults 05 AU-03 karar 1): the
 *     team's leads are told in the panel (`chat_bad_rating_alert`), the
 *     connection goes to the AI QA queue when the AI answered it alone
 *     (`queueBadRatingForQa`, reason `low_bsat`) and, when chosen, a
 *     follow-up ticket opens for it (`createFromBadRating`, announced as
 *     `ticket_created` and to its team like any ticket).
 *
 * Beside the player's request, never in its way: everything here is logged
 * and swallowed — the vote is stored whatever a subscriber or a lookup does.
 * The automation's writes (the review, the ticket) are one transaction; the
 * push and the deliveries go after it.
 */
import type { PrismaClient } from '@prisma/client';
import {
  readBadRatingActions,
  type ChatBadRatingAlertPush,
  type ChatRatedSignal,
  type RatingValue,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { teamLeads } from '../chat/chat-service.js';
import { queueBadRatingForQa } from '../qa/qa-service.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { ticketArrivalPush } from '../tickets/ticket-arrival.js';
import type { TicketService } from '../tickets/ticket-service.js';
import type { WorkspaceEventDispatcher } from '../webhooks/workspace-events.js';

export interface RatingAnnouncerLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface RatingAnnouncerOptions {
  db: PrismaClient;
  publisher: RealtimePublisher | null;
  automations: WorkspaceEventDispatcher | undefined;
  tickets: TicketService;
  logger: RatingAnnouncerLogger;
}

/** One judgement, as `recordRating` stored it. */
export interface RatingJudgement {
  id: string;
  chatId: string;
  threadId: string;
  value: RatingValue;
  comment: string | null;
  ratedAt: Date;
}

/** What the bad-rating automation did — for a test, and for the log. */
export interface BadRatingOutcome {
  notified: string[];
  queuedForQa: boolean;
  ticketId: string | null;
}

export class RatingAnnouncer {
  readonly #options: RatingAnnouncerOptions;

  constructor(options: RatingAnnouncerOptions) {
    this.#options = options;
  }

  /** Announce a judgement. Never throws. */
  async announce(tenant: TenantContext, rating: RatingJudgement): Promise<BadRatingOutcome | null> {
    try {
      return await this.#announce(tenant, rating);
    } catch (error) {
      this.#options.logger.warn(
        {
          err: error,
          license_id: String(tenant.licenseId),
          chat_id: rating.chatId,
          thread_id: rating.threadId,
        },
        'rating announcement failed',
      );
      return null;
    }
  }

  async #announce(
    tenant: TenantContext,
    rating: RatingJudgement,
  ): Promise<BadRatingOutcome | null> {
    const { db, automations, publisher, tickets } = this.#options;
    const context = await withTenant(db, tenant, async (tx) => {
      const thread = await tx.thread.findFirst({
        where: { id: rating.threadId, chatId: rating.chatId },
        select: {
          groupId: true,
          chat: {
            select: {
              customerId: true,
              brandId: true,
              access: { select: { groupId: true }, orderBy: { groupId: 'asc' }, take: 1 },
            },
          },
        },
      });
      if (!thread) return null;
      const groupId = thread.groupId ?? thread.chat.access[0]?.groupId ?? null;
      return { groupId, customerId: thread.chat.customerId, brandId: thread.chat.brandId };
    });
    if (!context) return null;

    await automations?.emit(tenant, 'chat_rated', {
      rating_id: rating.id,
      chat_id: rating.chatId,
      thread_id: rating.threadId,
      value: rating.value,
      comment: rating.comment,
      customer_id: context.customerId,
      group_id: context.groupId != null ? Number(context.groupId) : null,
      rated_at: rating.ratedAt.toISOString(),
    } satisfies ChatRatedSignal);

    if (rating.value !== 'bad') return null;

    const done = await withTenant(db, tenant, async (tx) => {
      // The chat's brand; a chat that names none is the default brand's, as the
      // settings screen reads it (`resolveBrandId`).
      const brandId =
        context.brandId ??
        (await tx.brand.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ??
        null;
      const settings = brandId
        ? await tx.inboxSettings.findFirst({
            where: { brandId },
            select: { badRatingActions: true },
          })
        : null;
      const actions = readBadRatingActions(settings?.badRatingActions);
      const queuedForQa = actions.add_to_qa_queue
        ? await queueBadRatingForQa(tx, tenant, {
            chatId: rating.chatId,
            threadId: rating.threadId,
          })
        : false;
      const ticket = actions.open_ticket
        ? await tickets.createFromBadRating(tx, tenant, {
            chatId: rating.chatId,
            threadId: rating.threadId,
            customerId: context.customerId,
            groupId: context.groupId,
          })
        : null;
      const arrival = ticket
        ? await ticketArrivalPush(tx, ticket.id, { reason: 'created', actorId: null })
        : null;
      const leads = actions.notify_team_leads
        ? await teamLeads(tx, tenant.licenseId, context.groupId)
        : [];
      return { queuedForQa, ticket, arrival, leads };
    });

    if (done.leads.length > 0) {
      await publisher?.publish(tenant, 'chat_bad_rating_alert', { agentIds: done.leads }, {
        chat_id: rating.chatId,
        thread_id: rating.threadId,
        rating_id: rating.id,
        group_id: context.groupId != null ? Number(context.groupId) : null,
        ticket_id: done.ticket?.id ?? null,
      } satisfies ChatBadRatingAlertPush);
    }
    if (done.arrival) {
      await publisher?.publish(
        tenant,
        'incoming_ticket',
        done.arrival.audience,
        done.arrival.payload,
      );
    }
    if (done.ticket) {
      await automations?.emit(tenant, 'ticket_created', {
        ticket_id: done.ticket.id,
        subject: done.ticket.subject,
        status: done.ticket.status,
        priority: done.ticket.priority,
        customer_id: done.ticket.customer_id,
        created_at: done.ticket.created_at,
      });
    }
    return {
      notified: done.leads,
      queuedForQa: done.queuedForQa,
      ticketId: done.ticket?.id ?? null,
    };
  }
}
