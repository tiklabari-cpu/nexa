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
 *      auditable trail NFR-M5 requires. On the attempt that exhausts the retries
 *      the row is flagged `permanent`, the one signal that says "gave up".
 *
 * Retries are up to three attempts with exponential backoff. Network access is
 * mocked across Nexa, so the sender is injectable: a real HTTP sender in
 * production (`createHttpWebhookSender`), a controllable one in tests. The
 * "queue" is modelled as this in-process dispatch-with-retry; a durable queue
 * (Redis/BullMQ) is the production swap-in and changes only where `dispatch` is
 * called from, not the delivery logic here.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { assertPublicHttpUrlResolved, type HostResolver } from '../../lib/ssrf.js';
import { isApiError } from '../../lib/api-error.js';
import { signWebhook } from './signature.js';

export const WEBHOOK_MAX_ATTEMPTS = 3;
export const WEBHOOK_TIMEOUT_MS = 10_000;

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
}

export interface WebhookDispatcherDeps {
  sender: WebhookSender;
  /** DNS resolver for the send-time SSRF re-check. Defaults to real DNS. */
  resolver?: HostResolver;
  /** Backoff between retries. Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
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
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(deps: WebhookDispatcherDeps) {
    this.sender = deps.sender;
    this.resolver = deps.resolver;
    this.sleep = deps.sleep ?? defaultSleep;
    this.maxAttempts = deps.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
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

  /** Deliver to a single webhook, retrying and logging each attempt. */
  async deliver(
    tx: TenantClient,
    tenant: TenantContext,
    webhook: DeliverableWebhook,
    payload: unknown,
  ): Promise<DeliveryOutcome> {
    const body = JSON.stringify({ action: webhook.action, data: payload });

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const result = await this.attempt(webhook, body);
      const isLastAttempt = attempt >= this.maxAttempts;
      await this.log(tx, tenant, webhook, attempt, result, !result.ok && isLastAttempt);

      if (result.ok) return { webhookId: webhook.id, delivered: true, attempts: attempt };
      if (!isLastAttempt) await this.sleep(this.backoffMs(attempt));
    }

    return { webhookId: webhook.id, delivered: false, attempts: this.maxAttempts };
  }

  /** One signed, SSRF-guarded POST. Never throws — a failure is a result. */
  private async attempt(webhook: DeliverableWebhook, body: string): Promise<WebhookSendResult> {
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
    attempt: number,
    result: WebhookSendResult,
    permanent: boolean,
  ): Promise<void> {
    await tx.webhookDelivery.create({
      data: {
        licenseId: tenant.licenseId,
        webhookId: webhook.id,
        action: webhook.action,
        attempt,
        ok: result.ok,
        statusCode: result.statusCode ?? null,
        // The secret is never part of a result, so it cannot reach the log here.
        error: result.error ?? null,
        permanent,
      },
    });
  }
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
