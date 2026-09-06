/**
 * Where a conversion happens — the trigger points behind FR-MOD-13.3.
 *
 * ## What was missing
 *
 * `GoalService.evaluate` had exactly one caller: the visitor's page view. That
 * was enough while `url_contains` was the only predicate, and it is the reason
 * the PRD's **sale / lead / resolution** funnel could not be expressed — a sale
 * is reported to a different endpoint, a lead is captured by an agent editing a
 * contact, and a resolution happens when a conversation is archived. None of
 * the three is a page view, so none of them ever reached the matcher.
 *
 * This module is the single caller all four moments now go through. Keeping it
 * in one place is the point: a trigger wired ad hoc at each site would drift —
 * one would forget the visit lookup, another would hold a transaction open, a
 * third would let a failure take the visitor's request down with it.
 *
 * ## Three properties it has to have
 *
 *   * **It never breaks what triggered it.** Recording a conversion is
 *     bookkeeping; the sale, the message and the archived chat are already
 *     committed and none of them may fail because a goal could not be written.
 *     `record` resolves — with 0 — even when everything about the evaluation
 *     went wrong. Same contract as `ChannelDispatcher.dispatchAgentReply` and
 *     `WorkspaceEventDispatcher.emit` beside it.
 *   * **It runs after the caller's transaction, not inside it.** Every trigger
 *     is "this has now happened", and the facts `evaluate` reads back
 *     (`tracked_sales`, `customers.is_lead`, an archived `chats` row) are
 *     precisely the caller's own writes — so it must see them committed. Its
 *     own short `withTenant` also keeps a slow evaluation from holding the
 *     locks of the write that triggered it.
 *   * **It reads the visitor, not the event.** The pages come from the latest
 *     visit rather than from whatever the caller happened to know, so a goal
 *     that requires a page *and* a sale is judged the same way from all four
 *     entry points.
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { visitorPageUrls } from '../campaigns/campaign-matching.js';
import { GoalService } from './goal-service.js';

/** The narrow log surface this needs — satisfied by Fastify's logger. */
export interface GoalTriggerLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * Records the goals a visitor has now reached.
 *
 * A structural interface, like `ChannelDispatcher` and
 * `WorkspaceEventDispatcher`, so the chat core depends on the verb rather than
 * on the goals service. Contract: **never throws.**
 */
export interface GoalConversionRecorder {
  /** How many goals this visitor reached that were not already recorded. */
  record(tenant: TenantContext, customerId: string, now?: Date): Promise<number>;
}

export interface GoalConversionRecorderOptions {
  logger?: GoalTriggerLogger;
  /** Overridable so a test can drive the recorder without the real service. */
  goals?: GoalService;
}

/**
 * Build the recorder. `db` is the app-role client — everything inside goes
 * through `withTenant`, so RLS confines both the goals read and the achievement
 * written to the workspace the conversion happened in.
 */
export function createGoalConversionRecorder(
  db: PrismaClient,
  options: GoalConversionRecorderOptions = {},
): GoalConversionRecorder {
  const goals = options.goals ?? new GoalService();

  return {
    async record(tenant, customerId, now = new Date()): Promise<number> {
      try {
        return await withTenant(db, tenant, async (tx) => {
          // The visit, not this request's page: someone who passed /thank-you
          // and then wrote in from /support has still converted, and a sale or
          // an archived chat carries no page of its own at all.
          const visit = await tx.visit.findFirst({
            where: { customerId, licenseId: tenant.licenseId },
            orderBy: { startedAt: 'desc' },
            select: { pages: true },
          });
          return goals.evaluate(tx, tenant, customerId, visitorPageUrls(visit?.pages), now);
        });
      } catch (error) {
        options.logger?.warn({ err: error, customer_id: customerId }, 'could not evaluate goals');
        return 0;
      }
    },
  };
}
