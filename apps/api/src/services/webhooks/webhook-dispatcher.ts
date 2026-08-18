/**
 * Outbound webhook delivery — FR-MOD-08.8.4-d (NFR-M5 / NFR-U4).
 *
 * A domain event is dispatched to every enabled webhook subscribed to its
 * action, and each attempt is signed, SSRF-checked, and logged:
 *
 *   1. Re-resolve the target and refuse a private/loopback/link-local address
 *      (`assertPublicHttpUrlResolved`). DNS is re-checked here, not trusted from
 *      registration, because it can change underneath a stored URL (TOCTOU).
 *   2. Sign the body (HMAC-SHA256 + timestamp + nonce). The secret never leaves
 *      this process — only the signature is sent.
 *   3. POST it, following no redirects (a 3xx could point inward), with a short
 *      timeout.
 *   4. Write one `webhook_deliveries` row for the attempt — the complete,
 *      auditable trail NFR-M5 requires — carrying the queue state that decides
 *      what happens next.
 *
 * ## Where the retries live (M-SCHED-e)
 *
 * The fast path is unchanged: up to three attempts with exponential backoff,
 * inside the caller's request. That is what recovers a receiver that blinked,
 * and it recovers it in seconds rather than on a sweep's timetable.
 *
 * What changed is what happens when those three are used up. The delivery used
 * to end there, flagged `permanent` — "gave up" after ten-odd seconds of
 * trying, and gone entirely if the process died mid-burst. Now the last
 * in-request attempt leaves its row `pending` with the body to re-send and a
 * `next_attempt_at`, and `services/webhooks/redelivery.ts` carries it the rest
 * of the way on the scheduler's clock, up to `WEBHOOK_MAX_ATTEMPTS` in total.
 * `permanent` therefore now means what its name says — the delivery is
 * genuinely over — and only the attempt that reaches the cap sets it.
 *
 * Network access is mocked across Nexa, so the sender is injectable: a real
 * HTTP sender in production (`createHttpWebhookSender`), a controllable one in
 * tests. `attempt` is public for the same reason redelivery is a separate
 * module and not a second sender: there is exactly one way a webhook leaves
 * this process, SSRF re-check and signature included, and a retry has to go
 * through it rather than around it.
 */
import { randomUUID } from 'node:crypto';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { assertPublicHttpUrlResolved, type HostResolver } from '../../lib/ssrf.js';
import { isApiError } from '../../lib/api-error.js';
import { signWebhook } from './signature.js';

/**
 * Attempts made inside the triggering request before the row is handed to the
 * scheduler. Three, unchanged: this is the burst that rides out a blip, and
 * making it longer only means holding a request open for a receiver that is
 * plainly down.
 */
export const WEBHOOK_REQUEST_ATTEMPTS = 3;

/**
 * Attempts in total, across the request burst *and* every scheduled
 * redelivery, before a delivery is declared exhausted. The default of
 * `WEBHOOK_MAX_ATTEMPTS` (env) — eight, i.e. five more than the burst — covers
 * roughly four hours of the backoff curve below.
 */
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * How the queue reads a row.
 *
 * - `pending`   — this attempt failed, another is owed at `next_attempt_at`.
 *                 The only queued value, and only ever on the newest row of a
 *                 delivery (a partial unique index enforces the "only").
 * - `delivered` — this attempt succeeded. Terminal.
 * - `failed`    — this attempt failed and a later one has already superseded
 *                 it. History, not a queue entry.
 * - `exhausted` — this attempt failed and no further one will be made.
 */
export type WebhookDeliveryState = 'pending' | 'delivered' | 'failed' | 'exhausted';

/**
 * Backoff before the *scheduled* retry after `attempt`, in milliseconds.
 *
 * A minute-scale curve rather than the burst's second-scale one, because the
 * two answer different questions: three failures in a row already ruled out a
 * blip, so what is left is an outage, and hammering an outage every four
 * seconds for hours is how a receiver's operator learns to block us. From the
 * end of the burst that is 4 min, 8, 16, 32, 64, 128 — about four hours to
 * reach attempt eight. The sweep's interval is the real floor: a due time in
 * the past is only acted on at the next tick.
 */
export const WEBHOOK_REDELIVERY_BACKOFF_BASE_MS = 60_000;
export const WEBHOOK_REDELIVERY_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

export function redeliveryBackoffMs(attempt: number): number {
  const uncapped = WEBHOOK_REDELIVERY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(uncapped, WEBHOOK_REDELIVERY_BACKOFF_CAP_MS);
}

/**
 * The state an attempt's row is written with — the single place the queue's
 * transitions are decided, shared by the request burst and the sweep so the two
 * cannot drift into disagreeing about when a delivery is over.
 *
 * `moreInThisPass` is what distinguishes a failure the caller is about to retry
 * itself (history: `failed`) from one it is handing on (`pending`). A scheduled
 * redelivery always makes exactly one attempt, so it never sets it.
 */
export function deliveryState(input: {
  ok: boolean;
  attempt: number;
  maxAttempts: number;
  moreInThisPass?: boolean;
}): WebhookDeliveryState {
  if (input.ok) return 'delivered';
  if (input.attempt >= input.maxAttempts) return 'exhausted';
  return input.moreInThisPass ? 'failed' : 'pending';
}

export interface WebhookSendResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

/** Performs the actual HTTP POST. Replaceable so tests need no network. */
export type WebhookSender = (url: URL, request: WebhookRequest) => Promise<WebhookSendResult>;

/** The webhook fields delivery needs — includes the secret, so never logged. */
export interface DeliverableWebhook {
  id: string;
  url: string;
  action: string;
  secretKey: string;
}

export interface DeliveryOutcome {
  webhookId: string;
  delivered: boolean;
  attempts: number;
  /** Groups this delivery's attempt rows; what redelivery retries against. */
  eventId: string;
}

export interface WebhookDispatcherDeps {
  sender: WebhookSender;
  /** DNS resolver for the send-time SSRF re-check. Defaults to real DNS. */
  resolver?: HostResolver;
  /** Backoff between retries. Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Attempts made inside the request (default {@link WEBHOOK_REQUEST_ATTEMPTS}). */
  requestAttempts?: number;
  /** Attempts in total, request plus scheduled (default {@link WEBHOOK_MAX_ATTEMPTS}). */
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: (attempt: number) => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class WebhookDispatcher {
  private readonly sender: WebhookSender;
  private readonly resolver: HostResolver | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly requestAttempts: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(deps: WebhookDispatcherDeps) {
    this.sender = deps.sender;
    this.resolver = deps.resolver;
    this.sleep = deps.sleep ?? defaultSleep;
    this.maxAttempts = deps.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
    // Never more attempts in the request than the delivery is allowed in total:
    // a deployment that lowers the cap below three lowers the burst with it,
    // rather than spending attempts it has already declared it will not honour.
    this.requestAttempts = Math.min(
      deps.requestAttempts ?? WEBHOOK_REQUEST_ATTEMPTS,
      this.maxAttempts,
    );
    this.timeoutMs = deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
    // 1s, 2s, 4s … — enough to ride out a brief receiver blip without holding a
    // delivery for minutes.
    this.backoffMs = deps.backoffMs ?? ((attempt) => 1000 * 2 ** (attempt - 1));
  }

  /**
   * Deliver `payload` to every enabled webhook subscribed to `action`. Runs
   * inside the caller's tenant transaction so the delivery log lands in the
   * right workspace under RLS.
   */
  async dispatch(
    tx: TenantClient,
    tenant: TenantContext,
    event: { action: string; payload: unknown },
  ): Promise<DeliveryOutcome[]> {
    const webhooks = await tx.webhook.findMany({
      where: { action: event.action, enabled: true },
      select: { id: true, url: true, action: true, secretKey: true },
    });

    const outcomes: DeliveryOutcome[] = [];
    for (const webhook of webhooks) {
      outcomes.push(await this.deliver(tx, tenant, webhook, event.payload));
    }
    return outcomes;
  }

  /**
   * Deliver to a single webhook, retrying and logging each attempt.
   *
   * Returning without `delivered` no longer means the delivery is over: unless
   * the burst also reached `maxAttempts`, its last row is left `pending` and
   * the scheduled sweep picks it up from there.
   */
  async deliver(
    tx: TenantClient,
    tenant: TenantContext,
    webhook: DeliverableWebhook,
    payload: unknown,
    options: { eventId?: string; now?: Date } = {},
  ): Promise<DeliveryOutcome> {
    const body = JSON.stringify({ action: webhook.action, data: payload });
    // One id for the whole delivery, minted here rather than derived from the
    // payload: two identical events really are two deliveries, and a content
    // hash would silently collapse them into one.
    const eventId = options.eventId ?? randomUUID();

    for (let attempt = 1; attempt <= this.requestAttempts; attempt++) {
      const result = await this.attempt(webhook, body);
      const moreInThisPass = attempt < this.requestAttempts;
      const state = deliveryState({
        ok: result.ok,
        attempt,
        maxAttempts: this.maxAttempts,
        moreInThisPass,
      });
      await this.log(tx, tenant, webhook, {
        eventId,
        attempt,
        result,
        state,
        body,
        now: options.now ?? new Date(),
      });

      if (result.ok) return { webhookId: webhook.id, delivered: true, attempts: attempt, eventId };
      if (moreInThisPass) await this.sleep(this.backoffMs(attempt));
    }

    return { webhookId: webhook.id, delivered: false, attempts: this.requestAttempts, eventId };
  }

  /**
   * One signed, SSRF-guarded POST. Never throws — a failure is a result.
   *
   * Public so a scheduled redelivery re-uses this exact path rather than
   * opening a second one: the DNS re-check and the signature are guards, and a
   * guard that only the first attempt goes through is not a guard.
   */
  async attempt(webhook: DeliverableWebhook, body: string): Promise<WebhookSendResult> {
    let url: URL;
    try {
      // Re-checked on every send, not trusted from registration (TOCTOU).
      url = await assertPublicHttpUrlResolved(webhook.url, this.resolver);
    } catch (error) {
      return {
        ok: false,
        error: isApiError(error) ? 'ssrf_blocked' : 'url_check_failed',
      };
    }

    const signed = signWebhook(webhook.secretKey, body);
    try {
      return await this.sender(url, {
        headers: { 'content-type': 'application/json', ...signed.headers },
        body,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.name : 'send_error' };
    }
  }

  private async log(
    tx: TenantClient,
    tenant: TenantContext,
    webhook: DeliverableWebhook,
    entry: {
      eventId: string;
      attempt: number;
      result: WebhookSendResult;
      state: WebhookDeliveryState;
      body: string;
      now: Date;
    },
  ): Promise<void> {
    await tx.webhookDelivery.create({
      data: writeableAttempt(tenant.licenseId, webhook, entry),
    });
  }
}

/**
 * The row one attempt writes — history plus queue state, in the one shape the
 * CHECK constraints will accept.
 *
 * Shared with `redelivery.ts` so the sweep's rows are indistinguishable from
 * the request's: the payload is carried only while another try is owed, and
 * dropped the moment the delivery settles, so a delivered webhook leaves no
 * lasting copy of a customer payload in the log.
 */
export function writeableAttempt(
  licenseId: bigint,
  webhook: Pick<DeliverableWebhook, 'id' | 'action'>,
  entry: {
    eventId: string;
    attempt: number;
    result: WebhookSendResult;
    state: WebhookDeliveryState;
    body: string;
    now: Date;
  },
): {
  licenseId: bigint;
  webhookId: string;
  eventId: string;
  action: string;
  attempt: number;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  permanent: boolean;
  state: WebhookDeliveryState;
  nextAttemptAt: Date | null;
  payload: string | null;
} {
  const queued = entry.state === 'pending';
  return {
    licenseId,
    webhookId: webhook.id,
    eventId: entry.eventId,
    action: webhook.action,
    attempt: entry.attempt,
    ok: entry.result.ok,
    statusCode: entry.result.statusCode ?? null,
    // The secret is never part of a result, so it cannot reach the log here.
    error: entry.result.error ?? null,
    // Kept in lockstep with the state a CHECK constraint ties it to.
    permanent: entry.state === 'exhausted',
    state: entry.state,
    nextAttemptAt: queued
      ? new Date(entry.now.getTime() + redeliveryBackoffMs(entry.attempt))
      : null,
    payload: queued ? entry.body : null,
  };
}

/**
 * The production HTTP sender: POST with the signature headers, following no
 * redirects and bounded by a timeout. `fetch` is a parameter so the redirect and
 * timeout behaviour can be unit-tested without a real network.
 */
export function createHttpWebhookSender(fetchImpl: typeof fetch = fetch): WebhookSender {
  return async (url, request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        // A 3xx is a redirect we refuse to follow: it could send the POST — and
        // its signature headers — to an internal address the SSRF check never saw.
        redirect: 'manual',
        signal: controller.signal,
      });
      // Only 2xx is a delivery. A 3xx (status preserved by redirect:'manual', or
      // 0 for an opaque redirect) and any 4xx/5xx are failures worth retrying.
      const ok = response.status >= 200 && response.status < 300;
      return ok
        ? { ok, statusCode: response.status }
        : { ok, statusCode: response.status, error: `http_${response.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.name : 'fetch_error' };
    } finally {
      clearTimeout(timer);
    }
  };
}
