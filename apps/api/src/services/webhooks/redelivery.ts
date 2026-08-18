/**
 * Scheduled webhook redelivery (M-SCHED-e · FR-MOD-08.8.4 / NFR-S7 · §D113/K1).
 *
 * `webhook-dispatcher.ts` retries three times inside the request that fired the
 * event, and that is the right thing for a receiver that blinked. It is the
 * wrong thing — and until now the *only* thing — for a receiver that is down
 * for ten minutes: the burst ended, the row said "gave up", and if the process
 * happened to restart mid-burst the delivery vanished with no record that
 * anything was still owed. NFR-S7's "retry" was a promise the storage layer did
 * not keep.
 *
 * This closes that. The last in-request attempt now leaves its row `pending`
 * with the exact body to re-send, and this sweep carries it the rest of the way
 * on the scheduler's clock, up to `WEBHOOK_MAX_ATTEMPTS` in total.
 *
 * ## Why an event cannot be delivered twice
 *
 * Three independent things have to hold, and only the first is application
 * logic:
 *
 *   1. **The storage layer allows one queued attempt per event.** A partial
 *      unique index on `(license_id, event_id) WHERE state = 'pending'` means a
 *      second queue entry for an event is a refused write, not a race.
 *   2. **A row is claimed before it is sent.** The claim is a conditional
 *      update — `state = 'pending' AND next_attempt_at <= now` — that pushes
 *      `next_attempt_at` a lease into the future. It affects one row or none,
 *      and "none" means somebody else has it, so this pass leaves it alone.
 *   3. **Settling is conditional too.** The attempt row is only written if the
 *      claimed row is still `pending` when the result comes back.
 *
 * The lease is what makes this survive a crash rather than just a concurrent
 * worker: a claimed row whose process died is picked up again once the lease
 * expires, where a "claimed" flag with no clock would strand it forever. The
 * cost is honest and stated: a process that dies *after* the POST and before
 * the settle sends that event twice. There is no exactly-once across a network
 * boundary without the receiver's cooperation, and the far end has the
 * signature's nonce to deduplicate on.
 *
 * ## Boundaries
 *
 * Sending happens outside every transaction. A `withTenant` transaction is
 * capped at ten seconds and a webhook POST is allowed the same ten, so holding
 * one open across the send would trade a stuck receiver for a stuck connection
 * — and would hold the claim invisible to the rest of the fleet until commit.
 * Each row therefore takes two short transactions (claim, settle) with the
 * network in between, and every one of them runs under RLS: a tenant's queued
 * deliveries are not merely filtered out of another tenant's sweep, they are
 * invisible to it.
 */
import type { PrismaClient } from '@prisma/client';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import type { HostResolver } from '../../lib/ssrf.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import {
  deliveryState,
  WEBHOOK_MAX_ATTEMPTS,
  WebhookDispatcher,
  writeableAttempt,
  type DeliverableWebhook,
  type WebhookSender,
} from './webhook-dispatcher.js';

/**
 * How long a claim holds a row before another pass may take it.
 *
 * Comfortably longer than one attempt can take (the POST is bounded at ten
 * seconds) so a healthy pass never has its own row stolen mid-flight, and short
 * enough that a crashed one costs minutes rather than the whole backoff curve.
 */
export const REDELIVERY_LEASE_MS = 60_000;

/**
 * Rows one pass takes per tenant. A sweep is not a drain: a workspace whose
 * receiver has been down all night has thousands owed, and working through them
 * in one tick would spend the interval on one tenant and starve the rest. What
 * is left is still due and is taken next tick.
 */
export const REDELIVERY_BATCH_SIZE = 100;

export interface TenantRedeliveryResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** Rows this pass actually sent for. */
  attempted: number;
  delivered: number;
  /** Failed and re-queued for a later pass. */
  requeued: number;
  /** Failed with no attempts left, or abandoned because the webhook is off. */
  exhausted: number;
  /** Due rows another worker had already taken. */
  skipped: number;
}

export interface WebhookRedeliveryReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantRedeliveryResult[];
  totals: {
    tenants: number;
    attempted: number;
    delivered: number;
    requeued: number;
    exhausted: number;
    skipped: number;
  };
}

export interface WebhookRedelivererDeps {
  /** The HTTP sender — real in production, controllable in tests. */
  sender: WebhookSender;
  /** DNS resolver for the send-time SSRF re-check. Defaults to real DNS. */
  resolver?: HostResolver;
  /** Needed to record an exhausted delivery in the append-only trail. */
  auditChainSecret: string;
  maxAttempts?: number;
  timeoutMs?: number;
  leaseMs?: number;
  batchSize?: number;
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/** A queued delivery, with everything a retry needs. */
interface DueRow {
  id: string;
  webhookId: string;
  eventId: string;
  action: string;
  attempt: number;
  payload: string;
}

export class WebhookRedeliverer {
  readonly #db: PrismaClient;
  readonly #dispatcher: WebhookDispatcher;
  readonly #auditChainSecret: string;
  readonly #maxAttempts: number;
  readonly #leaseMs: number;
  readonly #batchSize: number;

  constructor(db: PrismaClient, deps: WebhookRedelivererDeps) {
    this.#db = db;
    this.#maxAttempts = deps.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
    this.#auditChainSecret = deps.auditChainSecret;
    this.#leaseMs = deps.leaseMs ?? REDELIVERY_LEASE_MS;
    this.#batchSize = deps.batchSize ?? REDELIVERY_BATCH_SIZE;
    // The dispatcher is here only for `attempt` — the one signed, SSRF-checked
    // way out of this process. Its own retry loop is never entered: a scheduled
    // pass makes exactly one attempt and lets the next tick be the retry.
    this.#dispatcher = new WebhookDispatcher({
      sender: deps.sender,
      ...(deps.resolver ? { resolver: deps.resolver } : {}),
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      maxAttempts: this.#maxAttempts,
      requestAttempts: 1,
    });
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<WebhookRedeliveryReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants: TenantRedeliveryResult[] = [];
    for (const tenant of await this.#listTenants()) {
      if (options.signal?.aborted) break;
      tenants.push(await this.#sweepTenant(tenant, now, options.signal));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants,
      totals: {
        tenants: tenants.length,
        attempted: sum(tenants, (t) => t.attempted),
        delivered: sum(tenants, (t) => t.delivered),
        requeued: sum(tenants, (t) => t.requeued),
        exhausted: sum(tenants, (t) => t.exhausted),
        skipped: sum(tenants, (t) => t.skipped),
      },
    };
  }

  /**
   * Cross-tenant read through the shared SECURITY DEFINER enumerator — the one
   * place this job steps outside a single tenant, and it reads nothing but the
   * two ids the loop needs. Same enumerator the retention and SLA sweeps use.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(
    tenant: TenantRow,
    now: Date,
    signal: AbortSignal | undefined,
  ): Promise<TenantRedeliveryResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const result: TenantRedeliveryResult = {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      attempted: 0,
      delivered: 0,
      requeued: 0,
      exhausted: 0,
      skipped: 0,
    };

    for (const row of await this.#due(context, now)) {
      if (signal?.aborted) break;

      const claimed = await this.#claim(context, row, now);
      if (!claimed) {
        result.skipped += 1;
        continue;
      }

      // A webhook switched off after the event was queued is egress the
      // workspace has withdrawn consent for. Sending anyway because the row
      // predates the change would make "disabled" mean "disabled for new
      // events only", which is not what the switch says.
      if (!claimed.enabled) {
        await this.#abandon(context, row, 'webhook_disabled');
        result.exhausted += 1;
        continue;
      }

      result.attempted += 1;
      // Outside the transaction on purpose — see the module header.
      const sendResult = await this.#dispatcher.attempt(claimed.webhook, row.payload);
      const attempt = row.attempt + 1;
      const state = deliveryState({
        ok: sendResult.ok,
        attempt,
        maxAttempts: this.#maxAttempts,
      });

      const settled = await this.#settle(context, row, claimed.webhook, {
        attempt,
        result: sendResult,
        state,
      });
      if (!settled) {
        result.skipped += 1;
        continue;
      }
      if (state === 'delivered') result.delivered += 1;
      else if (state === 'exhausted') result.exhausted += 1;
      else result.requeued += 1;
    }

    return result;
  }

  /**
   * Deliveries this tenant owes, oldest due first.
   *
   * `attempt < max` is redundant with the settle path — a row that reached the
   * cap was written `exhausted`, not `pending` — but it is what makes lowering
   * `WEBHOOK_MAX_ATTEMPTS` take effect on rows queued under the old cap,
   * instead of leaving them to be retried past a limit the deployment has since
   * withdrawn.
   */
  async #due(context: TenantContext, now: Date): Promise<DueRow[]> {
    const rows = await withTenant(this.#db, context, (tx) =>
      tx.webhookDelivery.findMany({
        where: {
          state: 'pending',
          nextAttemptAt: { lte: now },
          attempt: { lt: this.#maxAttempts },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: this.#batchSize,
        select: {
          id: true,
          webhookId: true,
          eventId: true,
          action: true,
          attempt: true,
          payload: true,
        },
      }),
    );

    // The CHECK constraint guarantees a `pending` row has both, so this narrows
    // the types rather than tolerating a case that can occur.
    return rows.flatMap((row) =>
      row.eventId && row.payload
        ? [
            {
              id: row.id,
              webhookId: row.webhookId,
              eventId: row.eventId,
              action: row.action,
              attempt: row.attempt,
              payload: row.payload,
            },
          ]
        : [],
    );
  }

  /**
   * Take the row for this pass, or return null because somebody else has it.
   *
   * The conditional update is the whole mechanism: `updateMany` reports how
   * many rows matched, and matching zero means the state moved between the
   * read and here. Reading the webhook in the same transaction keeps the secret
   * out of the earlier, wider query — it is only fetched for a row this pass
   * actually owns.
   */
  async #claim(
    context: TenantContext,
    row: DueRow,
    now: Date,
  ): Promise<{ webhook: DeliverableWebhook; enabled: boolean } | null> {
    return withTenant(this.#db, context, async (tx) => {
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: row.id, state: 'pending', nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(now.getTime() + this.#leaseMs) },
      });
      if (count === 0) return null;

      const webhook = await tx.webhook.findUnique({
        where: { id: row.webhookId },
        select: { id: true, url: true, action: true, secretKey: true, enabled: true },
      });
      // Unregistering cascades the delivery rows away, so a claimed row without
      // its webhook cannot normally happen; treat it as nothing left to send.
      if (!webhook) return null;

      return {
        webhook: {
          id: webhook.id,
          url: webhook.url,
          action: webhook.action,
          secretKey: webhook.secretKey,
        },
        enabled: webhook.enabled,
      };
    });
  }

  /**
   * Record the attempt: the claimed row becomes history, the result becomes the
   * new newest row, and an exhausted delivery is written into the audit trail.
   *
   * Order matters. The claimed row leaves `pending` *before* the new row is
   * inserted, because the partial unique index allows only one queued row per
   * event — doing it the other way round would deadlock against the very
   * invariant this relies on. Both happen in one transaction, so the queue
   * never has zero or two entries for an event, only ever one.
   */
  async #settle(
    context: TenantContext,
    row: DueRow,
    webhook: DeliverableWebhook,
    outcome: {
      attempt: number;
      result: { ok: boolean; statusCode?: number; error?: string };
      state: ReturnType<typeof deliveryState>;
    },
  ): Promise<boolean> {
    return withTenant(this.#db, context, async (tx) => {
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: row.id, state: 'pending' },
        data: { state: 'failed', nextAttemptAt: null, payload: null },
      });
      // Somebody else settled it while the POST was in flight. The send has
      // already happened and cannot be taken back, but writing a second row —
      // and a second queue entry — would turn one duplicate into a loop.
      if (count === 0) return false;

      await tx.webhookDelivery.create({
        data: writeableAttempt(context.licenseId, webhook, {
          eventId: row.eventId,
          attempt: outcome.attempt,
          result: outcome.result,
          state: outcome.state,
          body: row.payload,
          // `nextAttemptAt` is computed from this; taken fresh rather than from
          // the pass's `now` so a long batch does not stack every requeue onto
          // the same instant and re-create the thundering herd jitter avoids.
          now: new Date(),
        }),
      });

      if (outcome.state === 'exhausted') {
        await this.#auditExhausted(tx, context, {
          webhookId: webhook.id,
          action: webhook.action,
          eventId: row.eventId,
          attempts: outcome.attempt,
          reason: outcome.result.error ?? 'delivery_failed',
        });
      }
      return true;
    });
  }

  /**
   * End a delivery without attempting it — the webhook was switched off after
   * the event was queued.
   *
   * No new attempt row, because no attempt was made: the queue fields are the
   * mutable part of a row and this only moves those, leaving the failed
   * attempt's own history (`attempt`, `ok`, `error`) exactly as it was written.
   */
  async #abandon(context: TenantContext, row: DueRow, reason: string): Promise<void> {
    await withTenant(this.#db, context, async (tx) => {
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: row.id, state: 'pending' },
        data: { state: 'exhausted', permanent: true, nextAttemptAt: null, payload: null },
      });
      if (count === 0) return;

      await this.#auditExhausted(tx, context, {
        webhookId: row.webhookId,
        action: row.action,
        eventId: row.eventId,
        attempts: row.attempt,
        reason,
      });
    });
  }

  /**
   * The one entry this job writes (NFR-S12). Giving up on an outbound delivery
   * is a fact the workspace has to be able to find later — an integration that
   * quietly stopped receiving is otherwise invisible until somebody notices the
   * data is missing. The payload is deliberately not in it: the audit log is
   * append-only and retained, and copying customer content there would outlive
   * every window that governs it.
   */
  async #auditExhausted(
    tx: Parameters<typeof writeAuditEntry>[0],
    context: TenantContext,
    entry: {
      webhookId: string;
      action: string;
      eventId: string;
      attempts: number;
      reason: string;
    },
  ): Promise<void> {
    await writeAuditEntry(
      tx,
      {
        licenseId: context.licenseId,
        chainSecret: this.#auditChainSecret,
        actorId: null,
        actorType: 'system',
      },
      {
        action: 'webhook.delivery_exhausted',
        target: `webhook:${entry.webhookId}`,
        metadata: {
          event_id: entry.eventId,
          webhook_action: entry.action,
          attempts: entry.attempts,
          reason: entry.reason,
        },
      },
    );
  }
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}
