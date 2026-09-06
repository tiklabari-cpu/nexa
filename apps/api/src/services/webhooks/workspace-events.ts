/**
 * The path from a workspace event to a zap — FR-MOD-09.4.
 *
 * ## What was missing
 *
 * Everything a delivery needs already existed: a registry (`webhook-service`),
 * a signed, SSRF-guarded, logged sender (`webhook-dispatcher`) and a sweep that
 * carries a failed delivery on (`redelivery`). What did not exist was a
 * *caller*. `WebhookDispatcher.dispatch` was referenced only by the redelivery
 * module, so a workspace could register a `chat_started` subscription and it
 * would never fire — which is why the Zapier and Make cards could only ever
 * have shown invented numbers. This module is the missing caller, and it is
 * deliberately thin: it opens no second delivery path, it just calls the one.
 *
 * ## Three properties it has to have
 *
 *   * **It never breaks the flow that triggered it.** A chat has started; the
 *     customer is waiting. A provider that is down, a DNS failure, an SSRF
 *     refusal — all of them are logged and swallowed, exactly as
 *     `dispatchAgentReply` and the transcript mail already are. `emit` resolves
 *     even when everything about the delivery went wrong.
 *   * **It runs after the caller's transaction, not inside it.** Delivery makes
 *     an HTTP request; holding a Postgres transaction open across one would let
 *     a slow receiver pin a connection and its locks for as long as it liked.
 *     So `emit` takes a `TenantContext` and opens its own short transaction —
 *     the same arrangement `ChatService#emailTranscript` uses, for the same
 *     reason.
 *   * **It spends one attempt, not three.** The dispatcher's in-request burst
 *     is right for an operator calling an endpoint and wrong for a visitor
 *     opening a chat: three tries with backoff can hold a request for tens of
 *     seconds. Configured with `requestAttempts: 1`, a failed attempt leaves
 *     its row `pending` with a `next_attempt_at` and the scheduled sweep
 *     (`redelivery.ts`) carries it the rest of the way — up to the same
 *     `WEBHOOK_MAX_ATTEMPTS`. Nothing is lost; it is just not lost in front of
 *     the customer.
 *
 * The receiver is mocked in tests by injecting `sender` (MASTER-PROMPT §5) —
 * no request ever leaves for `hooks.zapier.com`, in this repo or its tests.
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import {
  WebhookDispatcher,
  createHttpWebhookSender,
  type WebhookSender,
} from './webhook-dispatcher.js';
import type { WebhookAction } from './webhook-service.js';

/** The narrow log surface this needs — satisfied by Fastify's logger. */
export interface WorkspaceEventLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * Fans a committed workspace event out to whatever subscribed to it.
 *
 * A structural interface, like `ChannelDispatcher` beside it, so the chat core
 * depends on the verb and not on the webhook stack. Contract: **never throws.**
 */
export interface WorkspaceEventDispatcher {
  emit(tenant: TenantContext, action: WebhookAction, payload: unknown): Promise<void>;
}

export interface WorkspaceEventOptions {
  /** How a delivery leaves the process. Defaults to the real HTTP sender. */
  sender?: WebhookSender;
  logger?: WorkspaceEventLogger;
}

/**
 * Build the emitter. `db` is the app-role client — every read and write inside
 * goes through `withTenant`, so RLS confines a delivery and its log to the
 * workspace the event happened in, exactly as a hand-triggered one would be.
 */
export function createWorkspaceEventDispatcher(
  db: PrismaClient,
  options: WorkspaceEventOptions = {},
): WorkspaceEventDispatcher {
  const dispatcher = new WebhookDispatcher({
    sender: options.sender ?? createHttpWebhookSender(),
    // See the header: one try here, the rest on the sweep's clock.
    requestAttempts: 1,
  });

  return {
    async emit(tenant, action, payload) {
      try {
        await withTenant(db, tenant, async (tx) => {
          // The registry's own index (`license_id, action, enabled`) answers
          // this, so an event nobody subscribed to costs one indexed lookup
          // that returns no rows — which is the case for every workspace that
          // has wired nothing up.
          await dispatcher.dispatch(tx, tenant, { action, payload });
        });
      } catch (error) {
        // The event already happened and is already committed. A subscriber
        // that cannot be reached is the subscriber's problem, never the
        // conversation's.
        options.logger?.warn(
          { err: error, action, license_id: String(tenant.licenseId) },
          'workspace event webhook dispatch failed',
        );
      }
    },
  };
}
