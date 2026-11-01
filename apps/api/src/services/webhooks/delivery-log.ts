/**
 * The webhook delivery log screen's backend — KN-03 (tm 375).
 *
 * `webhook_deliveries` has been written since the dispatcher existed and read by
 * nobody: the operator's developer could not see why a delivery fell over. This
 * is the read side (`list`), the two actions the screen offers on it
 * (`redeliver`, `sendTest`) and the cleaning every error text goes through on
 * the way out.
 *
 * ## Nothing here opens a second way out of the process
 *
 * Both actions send through `WebhookDispatcher.attempt` — the DNS re-check,
 * the pinned connection, the HMAC signature and a fresh nonce — exactly as a
 * real delivery and the redelivery sweep do (`redelivery.ts`). A guard that only
 * the first attempt goes through is not a guard.
 *
 * ## What "Redeliver" can send, and why only that
 *
 * The log keeps a payload only where a retry is still possible: `pending` rows
 * (the queue) and — the retention decision of this task — `exhausted` rows for
 * `WEBHOOK_PAYLOAD_KEEP_MS` (72 hours), so an operator who fixes their receiver
 * on Monday morning can replay Friday night's failures. A `delivered` row keeps
 * nothing ("a delivered payload leaves no lasting copy"), and the same
 * deadline clears an exhausted row's payload (`pruneDeliveryLog`), after which
 * the row is history and `can_redeliver` is false.
 *
 * A redelivery is one attempt, written as a new row; the row it replaces is
 * marked `failed` (superseded) in the same transaction, so the invariant the
 * queue relies on — only the newest row of an event is live — still holds, and
 * the partial unique index on `pending` rows is never asked to hold two.
 *
 * ## Isolation
 *
 * Every read and write runs in the caller's tenant transaction (RLS). Another
 * workspace's webhook or delivery id reads as absent, which is a 404 — never a
 * 403 that would confirm the id exists.
 */
import { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { randomUUID } from 'node:crypto';
import {
  deliveryState,
  WEBHOOK_MAX_ATTEMPTS,
  writeableAttempt,
  type WebhookDispatcher,
  type WebhookDeliveryState,
} from './webhook-dispatcher.js';
import { sanitizeDeliveryError } from './delivery-error.js';

export { DELIVERY_ERROR_MAX_LENGTH, sanitizeDeliveryError } from './delivery-error.js';

/** How long an exhausted delivery keeps its payload for "Redeliver". */
export const WEBHOOK_PAYLOAD_KEEP_MS = 72 * 60 * 60 * 1000;

/** How long a settled attempt row stays in the log before the sweep deletes it. */
export const WEBHOOK_LOG_KEEP_DAYS = 30;

export const DELIVERY_STATES = ['pending', 'delivered', 'failed', 'exhausted'] as const;

export interface WebhookDeliveryView {
  id: string;
  event_id: string | null;
  action: string;
  attempt: number;
  state: WebhookDeliveryState;
  ok: boolean;
  status_code: number | null;
  error: string | null;
  test: boolean;
  created_at: string;
  next_attempt_at: string | null;
  can_redeliver: boolean;
}

export interface WebhookDeliveryPage {
  items: WebhookDeliveryView[];
  next_cursor: string | null;
}

interface RawRow {
  id: string;
  event_id: string | null;
  action: string;
  attempt: number;
  state: string;
  ok: boolean;
  status_code: number | null;
  error: string | null;
  is_test: boolean;
  created_at: Date;
  next_attempt_at: Date | null;
  has_payload: boolean;
}

/**
 * Whether "Redeliver" would work on a row. The same predicate the action
 * enforces, so the button can never offer something the server then refuses.
 */
function redeliverable(row: {
  state: string;
  isTest: boolean;
  hasPayload: boolean;
  eventId: string | null;
}): boolean {
  return (
    !row.isTest &&
    row.hasPayload &&
    row.eventId !== null &&
    (row.state === 'pending' || row.state === 'exhausted')
  );
}

function view(row: {
  id: string;
  eventId: string | null;
  action: string;
  attempt: number;
  state: string;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  isTest: boolean;
  createdAt: Date;
  nextAttemptAt: Date | null;
  hasPayload: boolean;
}): WebhookDeliveryView {
  return {
    id: row.id,
    event_id: row.eventId,
    action: row.action,
    attempt: row.attempt,
    state: row.state as WebhookDeliveryState,
    ok: row.ok,
    status_code: row.statusCode,
    error: sanitizeDeliveryError(row.error),
    test: row.isTest,
    created_at: row.createdAt.toISOString(),
    next_attempt_at: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
    can_redeliver: redeliverable(row),
  };
}

function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(raw: string): string {
  const id = Buffer.from(raw, 'base64url').toString('utf8');
  if (!UUID.test(id)) throw ApiError.validation('cursor: invalid.');
  return id;
}

export interface DeliveryLogDeps {
  dispatcher: WebhookDispatcher;
  /** Total attempts a delivery is allowed (defaults to `WEBHOOK_MAX_ATTEMPTS`). */
  maxAttempts?: number;
}

/** What a failed claim/settle means to the caller. */
function notRedeliverable(): ApiError {
  return ApiError.validation('This delivery can no longer be sent again.', {
    reason: 'not_redeliverable',
  });
}

export class WebhookDeliveryLog {
  readonly #dispatcher: WebhookDispatcher;
  readonly #maxAttempts: number;

  constructor(deps: DeliveryLogDeps) {
    this.#dispatcher = deps.dispatcher;
    this.#maxAttempts = deps.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
  }

  /** The webhook exists in this workspace, or 404 (RLS hides another tenant's). */
  async #requireWebhook(tx: TenantClient, webhookId: string): Promise<void> {
    const found = await tx.webhook.findUnique({ where: { id: webhookId }, select: { id: true } });
    if (!found) throw ApiError.notFound('Webhook not found.');
  }

  /**
   * One page of attempts, newest first.
   *
   * Keyset on `(created_at, id)` compared **in SQL against the cursor row's own
   * values**: a JS `Date` carries milliseconds and the column microseconds, so a
   * cursor that travelled through one would skip the rows sharing the page
   * boundary's millisecond. The cursor is only the row id.
   */
  async list(
    tx: TenantClient,
    webhookId: string,
    query: { state?: WebhookDeliveryState; limit: number; cursor?: string },
  ): Promise<WebhookDeliveryPage> {
    await this.#requireWebhook(tx, webhookId);

    const cursorId = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const stateFilter =
      query.state === undefined ? Prisma.empty : Prisma.sql`AND d.state = ${query.state}`;
    const after =
      cursorId === null
        ? Prisma.empty
        : Prisma.sql`AND (d.created_at, d.id) < (
            SELECT c.created_at, c.id FROM webhook_deliveries c
             WHERE c.id = ${cursorId}::uuid AND c.webhook_id = ${webhookId}::uuid)`;

    const rows = await tx.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT d.id, d.event_id, d.action, d.attempt, d.state, d.ok, d.status_code,
             d.error, d.is_test, d.created_at, d.next_attempt_at,
             (d.payload IS NOT NULL) AS has_payload
        FROM webhook_deliveries d
       WHERE d.webhook_id = ${webhookId}::uuid
         ${stateFilter}
         ${after}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ${query.limit + 1}`);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) =>
        view({
          id: row.id,
          eventId: row.event_id,
          action: row.action,
          attempt: row.attempt,
          state: row.state,
          ok: row.ok,
          statusCode: row.status_code,
          error: row.error,
          isTest: row.is_test,
          createdAt: row.created_at,
          nextAttemptAt: row.next_attempt_at,
          hasPayload: row.has_payload,
        }),
      ),
      next_cursor: rows.length > query.limit && last ? encodeCursor(last.id) : null,
    };
  }

  /**
   * Send a queued or exhausted delivery again.
   *
   * Three short steps with the network in between, never a transaction held
   * across the POST (a tenant transaction is capped at ten seconds and a send is
   * allowed the same ten):
   *
   *   1. **Read** the row and its webhook; refuse what cannot be sent. A
   *      `pending` row is leased (its due time pushed a minute out) so the sweep
   *      does not send it at the same moment.
   *   2. **Send** through the dispatcher's guarded path.
   *   3. **Settle**: the row becomes `failed` (superseded) *only if it is still
   *      the state step 1 saw*, and the result is written as the new newest
   *      row. If somebody settled it first, the send has already gone out and
   *      cannot be taken back, but no second row — and no second queue entry —
   *      is written, so one duplicate stays one duplicate.
   */
  async redeliver(
    withTenant: <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>,
    tenant: TenantContext,
    webhookId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryView> {
    const claimed = await withTenant(async (tx) => {
      await this.#requireWebhook(tx, webhookId);
      const row = await tx.webhookDelivery.findFirst({
        where: { id: deliveryId, webhookId },
        select: {
          id: true,
          eventId: true,
          action: true,
          attempt: true,
          state: true,
          isTest: true,
          payload: true,
        },
      });
      if (!row) throw ApiError.notFound('Delivery not found.');
      if (
        !redeliverable({
          state: row.state,
          isTest: row.isTest,
          hasPayload: row.payload !== null,
          eventId: row.eventId,
        }) ||
        row.payload === null ||
        row.eventId === null
      ) {
        throw notRedeliverable();
      }

      // Only the newest attempt of an event is live; replaying an older one
      // would resurrect a superseded body next to a newer outcome.
      const newer = await tx.webhookDelivery.findFirst({
        where: { webhookId, eventId: row.eventId, attempt: { gt: row.attempt } },
        select: { id: true },
      });
      if (newer) throw notRedeliverable();

      const webhook = await tx.webhook.findUnique({
        where: { id: webhookId },
        select: { id: true, url: true, action: true, secretKey: true, enabled: true },
      });
      if (!webhook) throw ApiError.notFound('Webhook not found.');
      if (!webhook.enabled) {
        throw ApiError.validation('Switch the webhook on before sending a delivery again.', {
          reason: 'webhook_disabled',
        });
      }

      if (row.state === 'pending') {
        const { count } = await tx.webhookDelivery.updateMany({
          where: { id: row.id, state: 'pending' },
          data: { nextAttemptAt: new Date(Date.now() + 60_000) },
        });
        if (count === 0) throw notRedeliverable();
      }

      return {
        row: { ...row, payload: row.payload, eventId: row.eventId },
        webhook: {
          id: webhook.id,
          url: webhook.url,
          action: webhook.action,
          secretKey: webhook.secretKey,
        },
      };
    });

    // Outside every transaction, through the one guarded way out.
    const result = await this.#dispatcher.attempt(claimed.webhook, claimed.row.payload);
    const attempt = claimed.row.attempt + 1;
    const state = deliveryState({ ok: result.ok, attempt, maxAttempts: this.#maxAttempts });

    return withTenant(async (tx) => {
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: claimed.row.id, state: claimed.row.state },
        data: { state: 'failed', permanent: false, nextAttemptAt: null, payload: null },
      });
      if (count === 0) throw notRedeliverable();

      const created = await tx.webhookDelivery.create({
        data: writeableAttempt(tenant.licenseId, claimed.webhook, {
          eventId: claimed.row.eventId,
          attempt,
          result,
          state,
          body: claimed.row.payload,
          now: new Date(),
        }),
      });
      return view({
        id: created.id,
        eventId: created.eventId,
        action: created.action,
        attempt: created.attempt,
        state: created.state,
        ok: created.ok,
        statusCode: created.statusCode,
        error: created.error,
        isTest: created.isTest,
        createdAt: created.createdAt,
        nextAttemptAt: created.nextAttemptAt,
        hasPayload: created.payload !== null,
      });
    });
  }

  /**
   * A signed ping to the webhook's URL. Logged as a test row (never queued,
   * never an automation run), and never throws on a receiver that is down —
   * the answer *is* the result.
   */
  async sendTest(
    withTenant: <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>,
    tenant: TenantContext,
    webhookId: string,
  ): Promise<WebhookDeliveryView> {
    const webhook = await withTenant(async (tx) => {
      const found = await tx.webhook.findUnique({
        where: { id: webhookId },
        select: { id: true, url: true, action: true, secretKey: true },
      });
      if (!found) throw ApiError.notFound('Webhook not found.');
      return found;
    });

    const body = JSON.stringify({
      action: webhook.action,
      test: true,
      data: { test: true, webhook_id: webhook.id, sent_at: new Date().toISOString() },
    });
    const result = await this.#dispatcher.attempt(webhook, body);

    return withTenant(async (tx) => {
      const base = writeableAttempt(tenant.licenseId, webhook, {
        eventId: randomUUID(),
        attempt: 1,
        result,
        // 'failed' rather than 'exhausted' for a miss: nobody gave up on a
        // delivery, and `exhausted` is the state the audit trail and the
        // redelivery button attach meaning to.
        state: result.ok ? 'delivered' : 'failed',
        body,
        now: new Date(),
      });
      const created = await tx.webhookDelivery.create({ data: { ...base, isTest: true } });
      return view({
        id: created.id,
        eventId: created.eventId,
        action: created.action,
        attempt: created.attempt,
        state: created.state,
        ok: created.ok,
        statusCode: created.statusCode,
        error: created.error,
        isTest: created.isTest,
        createdAt: created.createdAt,
        nextAttemptAt: created.nextAttemptAt,
        hasPayload: false,
      });
    });
  }
}

/**
 * The retention step for one workspace, run by the redelivery sweep (which
 * already walks every tenant under RLS): an exhausted row's payload goes after
 * {@link WEBHOOK_PAYLOAD_KEEP_MS}, and any settled row goes after
 * {@link WEBHOOK_LOG_KEEP_DAYS}. A `pending` row is never touched — it is a
 * queue entry, and the sweep's own attempt cap ends it.
 */
export async function pruneDeliveryLog(
  tx: TenantClient,
  now: Date,
): Promise<{ payloadsCleared: number; rowsDeleted: number }> {
  const payloads = await tx.webhookDelivery.updateMany({
    where: {
      state: 'exhausted',
      payload: { not: null },
      createdAt: { lt: new Date(now.getTime() - WEBHOOK_PAYLOAD_KEEP_MS) },
    },
    data: { payload: null },
  });
  const rows = await tx.webhookDelivery.deleteMany({
    where: {
      state: { not: 'pending' },
      createdAt: { lt: new Date(now.getTime() - WEBHOOK_LOG_KEEP_DAYS * 86_400_000) },
    },
  });
  return { payloadsCleared: payloads.count, rowsDeleted: rows.count };
}
