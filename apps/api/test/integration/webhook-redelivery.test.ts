/**
 * Durable webhook redelivery — M-SCHED-e (FR-MOD-08.8.4 / NFR-S7 · §D113/K1).
 *
 * The claim under test is narrow and, before this slice, false: a webhook whose
 * receiver was down when the event fired still gets delivered once the receiver
 * comes back, even though the request that fired it ended long ago and the
 * process may have restarted in between. The in-request burst is a fast path,
 * not the whole promise.
 *
 * The four properties, in the order they matter:
 *
 *   1. **It resumes.** A failed burst leaves a queued row; a later sweep sends
 *      it and the delivery completes. Nothing about the sweep depends on the
 *      original request still existing — it reads state, not memory.
 *   2. **It gives up, visibly.** Attempts are capped, and the row that reaches
 *      the cap ends the delivery *and* writes an audit entry, because an
 *      integration that silently stopped receiving is otherwise indiscoverable.
 *   3. **It never delivers an event twice.** Two sweeps racing the same due row
 *      produce one send, and a settled delivery is never queued again — proven
 *      against the database's own constraints, not just the application's.
 *   4. **It cannot cross a tenant.** Every read, claim and settle runs under
 *      RLS, so one workspace's sweep neither sees nor takes another's rows.
 *
 * No real network: the sender is injected, and the SSRF guard's resolver is
 * pinned to a public address so DNS is never consulted.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { WebhookRedeliverer } from '../../src/services/webhooks/redelivery.js';
import {
  WebhookDispatcher,
  redeliveryBackoffMs,
  type DeliverableWebhook,
  type WebhookSendResult,
  type WebhookSender,
} from '../../src/services/webhooks/webhook-dispatcher.js';
import { verifyWebhook } from '../../src/services/webhooks/signature.js';
import { ownerClient, seedFixtures, testEnv, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** A public IP the SSRF guard allows, so the resolver never needs real DNS. */
const PUBLIC_IP = '93.184.216.34';

/** Records every send, and answers with whatever the test scripted. */
function recordingSender(reply: (call: number) => WebhookSendResult): {
  sender: WebhookSender;
  calls: () => Array<{ url: URL; headers: Record<string, string>; body: string }>;
} {
  const calls: Array<{ url: URL; headers: Record<string, string>; body: string }> = [];
  const sender: WebhookSender = async (url, request) => {
    calls.push({ url, headers: request.headers, body: request.body });
    return reply(calls.length);
  };
  return { sender, calls: () => calls };
}

const ALWAYS_FAILS = (): WebhookSendResult => ({ ok: false, statusCode: 503, error: 'http_503' });
const ALWAYS_OK = (): WebhookSendResult => ({ ok: true, statusCode: 200 });

describe('webhook redelivery (M-SCHED-e)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;

  const auditSecret = testEnv().AUDIT_CHAIN_SECRET;
  const contextA = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const contextB = (): TenantContext => ({
    licenseId: fx.b.licenseId,
    organizationId: fx.b.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  /** A registered webhook, with the secret the dispatcher needs to sign. */
  async function registerWebhook(
    context: TenantContext,
    overrides: { action?: string; enabled?: boolean } = {},
  ): Promise<DeliverableWebhook> {
    const row = await owner.webhook.create({
      data: {
        licenseId: context.licenseId,
        url: 'https://hooks.example.test/receiver',
        action: overrides.action ?? 'chat_started',
        secretKey: `whsec_${context.licenseId}_${Math.random().toString(36).slice(2)}`,
        enabled: overrides.enabled ?? true,
      },
      select: { id: true, url: true, action: true, secretKey: true },
    });
    return row;
  }

  /**
   * Drive a real in-request burst against a receiver that is down, which is the
   * only way a queued row is ever created. Building one by hand would prove the
   * sweep works against rows the dispatcher does not actually write.
   */
  async function queueFailedDelivery(
    context: TenantContext,
    webhook: DeliverableWebhook,
    payload: unknown = { chat_id: 'TJ1H8CFKRV' },
  ): Promise<string> {
    const dispatcher = new WebhookDispatcher({
      sender: async () => ALWAYS_FAILS(),
      resolver: async () => [PUBLIC_IP],
      sleep: async () => {},
      backoffMs: () => 0,
    });
    const outcome = await withTenant(appRole, context, (tx) =>
      dispatcher.deliver(tx, context, webhook, payload),
    );
    expect(outcome.delivered).toBe(false);
    return outcome.eventId;
  }

  /**
   * Built on the `nexa_app` connection, exactly as the scheduler builds it
   * (`app.db` is the app role) — the owner connection bypasses RLS, so a sweep
   * driven through it would prove nothing about isolation.
   */
  function redeliverer(
    sender: WebhookSender,
    overrides: { maxAttempts?: number; leaseMs?: number } = {},
  ): WebhookRedeliverer {
    return new WebhookRedeliverer(appRole, {
      sender,
      resolver: async () => [PUBLIC_IP],
      auditChainSecret: auditSecret,
      ...overrides,
    });
  }

  const rowsFor = (webhookId: string) =>
    owner.webhookDelivery.findMany({ where: { webhookId }, orderBy: { attempt: 'asc' } });

  /** A moment past everything the burst queued, so due rows are actually due. */
  const laterThanBackoff = (): Date => new Date(Date.now() + redeliveryBackoffMs(3) + 1000);

  // --- 1. It resumes ---------------------------------------------------------

  it('delivers an event the request gave up on, after the request is long gone', async () => {
    const webhook = await registerWebhook(contextA());
    const eventId = await queueFailedDelivery(contextA(), webhook, { chat_id: 'RESUMED' });

    const script = recordingSender(ALWAYS_OK);
    const report = await redeliverer(script.sender).run({ now: laterThanBackoff() });

    expect(script.calls()).toHaveLength(1);
    expect(report.totals).toMatchObject({ attempted: 1, delivered: 1, requeued: 0, exhausted: 0 });

    const rows = await rowsFor(webhook.id);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.state)).toEqual(['failed', 'failed', 'failed', 'delivered']);
    // One delivery throughout — the sweep continued it rather than starting a
    // second one.
    expect(new Set(rows.map((r) => r.eventId))).toEqual(new Set([eventId]));
    // Nothing is queued and no payload copy survives the delivery.
    expect(rows.every((r) => r.nextAttemptAt === null && r.payload === null)).toBe(true);
  });

  it('re-sends the original body, freshly signed and SSRF-checked', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook, { chat_id: 'SIGNED', nested: { a: 1 } });

    const script = recordingSender(ALWAYS_OK);
    await redeliverer(script.sender).run({ now: laterThanBackoff() });

    const [call] = script.calls();
    expect(JSON.parse(call?.body ?? 'null')).toEqual({
      action: 'chat_started',
      data: { chat_id: 'SIGNED', nested: { a: 1 } },
    });
    // The signature is computed for this send, not replayed from the first one.
    expect(
      verifyWebhook(webhook.secretKey, {
        body: call?.body ?? '',
        timestamp: call?.headers['X-Webhook-Timestamp'],
        nonce: call?.headers['X-Webhook-Nonce'],
        signature: call?.headers['X-Webhook-Signature'],
      }),
    ).toEqual({ ok: true });
    // The URL that was actually posted to is the one the SSRF check resolved.
    expect(call?.url.href).toBe(webhook.url);
  });

  it('leaves a row that is not due yet alone', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook);

    const script = recordingSender(ALWAYS_OK);
    // "Now" is the moment the burst ended: the backoff has not elapsed.
    const report = await redeliverer(script.sender).run({ now: new Date() });

    expect(script.calls()).toHaveLength(0);
    expect(report.totals.attempted).toBe(0);
    expect((await rowsFor(webhook.id)).map((r) => r.state)).toEqual([
      'failed',
      'failed',
      'pending',
    ]);
  });

  it('re-queues a failed retry further out, and keeps carrying it', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook);

    const script = recordingSender(ALWAYS_FAILS);
    const report = await redeliverer(script.sender).run({ now: laterThanBackoff() });

    expect(report.totals).toMatchObject({ attempted: 1, delivered: 0, requeued: 1, exhausted: 0 });

    const rows = await rowsFor(webhook.id);
    expect(rows.map((r) => r.state)).toEqual(['failed', 'failed', 'failed', 'pending']);
    const queued = rows.at(-1);
    expect(queued?.attempt).toBe(4);
    expect(queued?.payload).not.toBeNull();
    // Further out than the attempt before it — the curve widens, it does not
    // hammer a receiver that is plainly down.
    expect(queued?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now() + redeliveryBackoffMs(3));
  });

  // --- 2. It gives up, visibly ----------------------------------------------

  it('exhausts at the attempt cap, writing an audit entry and stopping', async () => {
    const webhook = await registerWebhook(contextA());
    const eventId = await queueFailedDelivery(contextA(), webhook);

    // Cap at four: the burst spent three, so this sweep is the last attempt.
    const script = recordingSender(ALWAYS_FAILS);
    const report = await redeliverer(script.sender, { maxAttempts: 4 }).run({
      now: laterThanBackoff(),
    });

    expect(report.totals).toMatchObject({ attempted: 1, exhausted: 1, requeued: 0 });

    const rows = await rowsFor(webhook.id);
    expect(rows.map((r) => r.state)).toEqual(['failed', 'failed', 'failed', 'exhausted']);
    // `permanent` finally means what its name says.
    expect(rows.map((r) => r.permanent)).toEqual([false, false, false, true]);
    expect(rows.every((r) => r.payload === null && r.nextAttemptAt === null)).toBe(true);

    const audit = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'webhook.delivery_exhausted' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.target).toBe(`webhook:${webhook.id}`);
    expect(audit[0]?.metadata).toMatchObject({
      event_id: eventId,
      webhook_action: 'chat_started',
      attempts: 4,
      reason: 'http_503',
    });
    // The payload never reaches the append-only trail.
    expect(JSON.stringify(audit[0]?.metadata)).not.toContain('TJ1H8CFKRV');

    // A second sweep has nothing left to do — the delivery is over.
    const after = recordingSender(ALWAYS_OK);
    await redeliverer(after.sender, { maxAttempts: 4 }).run({ now: laterThanBackoff() });
    expect(after.calls()).toHaveLength(0);
  });

  it('abandons a queued delivery whose webhook has since been switched off', async () => {
    const webhook = await registerWebhook(contextA());
    const eventId = await queueFailedDelivery(contextA(), webhook);
    await owner.webhook.update({ where: { id: webhook.id }, data: { enabled: false } });

    const script = recordingSender(ALWAYS_OK);
    const report = await redeliverer(script.sender).run({ now: laterThanBackoff() });

    // Disabled means disabled: nothing is posted, for an event queued before
    // the switch flipped as much as for one fired after it.
    expect(script.calls()).toHaveLength(0);
    expect(report.totals).toMatchObject({ attempted: 0, exhausted: 1 });

    const rows = await rowsFor(webhook.id);
    // No fourth row: no attempt was made, so no attempt is recorded. The queued
    // row's own history is untouched; only its queue state moved.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.state)).toEqual(['failed', 'failed', 'exhausted']);
    expect(rows.at(-1)).toMatchObject({ attempt: 3, ok: false, error: 'http_503' });

    const audit = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'webhook.delivery_exhausted' },
    });
    expect(audit[0]?.metadata).toMatchObject({ event_id: eventId, reason: 'webhook_disabled' });
  });

  it('stops retrying rows queued under a cap the deployment has since lowered', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook);

    // The row was queued at attempt 3 under the default cap of 8. A deployment
    // that drops the cap to 3 has withdrawn the allowance the row is holding.
    const script = recordingSender(ALWAYS_OK);
    const report = await redeliverer(script.sender, { maxAttempts: 3 }).run({
      now: laterThanBackoff(),
    });

    expect(script.calls()).toHaveLength(0);
    expect(report.totals.attempted).toBe(0);
  });

  // --- 3. It never delivers an event twice ----------------------------------

  it('sends once when two sweeps race the same due row', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook);

    const script = recordingSender(ALWAYS_OK);
    const now = laterThanBackoff();
    // Both sweeps see the same due row and start together — the case the Redis
    // leader lock normally prevents, run here without it so the row-level claim
    // is what is actually under test.
    const [first, second] = await Promise.all([
      redeliverer(script.sender).run({ now }),
      redeliverer(script.sender).run({ now }),
    ]);

    expect(script.calls()).toHaveLength(1);
    expect(first.totals.delivered + second.totals.delivered).toBe(1);
    // One sweep did the work and the other did none. Which way the loser fails
    // depends on where its scan lands relative to the winner's claim — the row
    // is either already not due (the claim pushed it out) or no longer
    // claimable — and both are the same outcome, so neither is asserted.
    expect([first.totals.attempted, second.totals.attempted].sort()).toEqual([0, 1]);

    const rows = await rowsFor(webhook.id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.state === 'delivered')).toHaveLength(1);
  });

  it('writes no second row when the delivery was settled while its send was in flight', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook);
    const queued = (await rowsFor(webhook.id)).at(-1);

    // The interleaving the claim's lease is meant to make rare, forced to
    // happen: this sweep is mid-POST when somebody else finishes the delivery.
    let release = (): void => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sends = 0;
    const sender: WebhookSender = async () => {
      sends += 1;
      await inFlight;
      return ALWAYS_OK();
    };

    const sweep = redeliverer(sender).run({ now: laterThanBackoff() });
    // Wait until the send is actually in flight, then settle the row underneath
    // it the way a second worker would have.
    while (sends === 0) await new Promise((r) => setTimeout(r, 5));
    await owner.webhookDelivery.update({
      where: { id: queued?.id ?? '' },
      data: { state: 'failed', nextAttemptAt: null, payload: null },
    });
    release();
    const report = await sweep;

    // The POST happened and cannot be taken back — that is the honest cost of
    // at-least-once. What must not happen is a *second* attempt row, which
    // would also be a second queue entry and so a delivery that never ends.
    expect(sends).toBe(1);
    expect(report.totals).toMatchObject({ attempted: 1, delivered: 0, skipped: 1 });
    const rows = await rowsFor(webhook.id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.state === 'pending')).toHaveLength(0);
  });

  it('never queues an event twice — the database refuses the second entry', async () => {
    const webhook = await registerWebhook(contextA());
    const eventId = await queueFailedDelivery(contextA(), webhook);

    // The application's own paths cannot produce this; the point is that even a
    // bug that tried would be a refused write rather than a duplicate delivery.
    await expect(
      owner.webhookDelivery.create({
        data: {
          licenseId: fx.a.licenseId,
          webhookId: webhook.id,
          eventId,
          action: 'chat_started',
          attempt: 4,
          ok: false,
          state: 'pending',
          nextAttemptAt: new Date(),
          payload: '{}',
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a queued row that carries nothing to send', async () => {
    const webhook = await registerWebhook(contextA());

    // `pending` is a promise to retry; a row with no payload cannot keep it.
    await expect(
      owner.webhookDelivery.create({
        data: {
          licenseId: fx.a.licenseId,
          webhookId: webhook.id,
          eventId: '11111111-1111-4111-8111-111111111111',
          action: 'chat_started',
          attempt: 1,
          ok: false,
          state: 'pending',
          nextAttemptAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('is a no-op the second time it runs over a delivered event', async () => {
    const webhook = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhook);

    const script = recordingSender(ALWAYS_OK);
    const sweep = redeliverer(script.sender);
    await sweep.run({ now: laterThanBackoff() });
    const second = await sweep.run({ now: laterThanBackoff() });

    expect(script.calls()).toHaveLength(1);
    expect(second.totals).toMatchObject({ attempted: 0, delivered: 0, skipped: 0 });
  });

  // --- 4. It cannot cross a tenant ------------------------------------------

  it("never touches another workspace's queued delivery", async () => {
    const webhookA = await registerWebhook(contextA());
    const webhookB = await registerWebhook(contextB());
    await queueFailedDelivery(contextA(), webhookA, { chat_id: 'A-ONLY' });
    await queueFailedDelivery(contextB(), webhookB, { chat_id: 'B-ONLY' });

    const script = recordingSender(ALWAYS_OK);
    const report = await redeliverer(script.sender).run({ now: laterThanBackoff() });

    // Both tenants are swept — in their own transactions, under their own RLS
    // context — and each sees exactly its own row.
    expect(script.calls()).toHaveLength(2);
    const perTenant = Object.fromEntries(report.tenants.map((t) => [t.licenseId, t]));
    expect(perTenant[fx.a.licenseId.toString()]).toMatchObject({ attempted: 1, delivered: 1 });
    expect(perTenant[fx.b.licenseId.toString()]).toMatchObject({ attempted: 1, delivered: 1 });

    // And the bodies did not cross: each webhook got its own payload.
    const bodies = script.calls().map((c) => c.body);
    expect(bodies.filter((b) => b.includes('A-ONLY'))).toHaveLength(1);
    expect(bodies.filter((b) => b.includes('B-ONLY'))).toHaveLength(1);
  });

  it("cannot claim another tenant's row even when handed its id", async () => {
    const webhookA = await registerWebhook(contextA());
    await queueFailedDelivery(contextA(), webhookA);

    const queued = (await rowsFor(webhookA.id)).at(-1);
    expect(queued?.state).toBe('pending');

    // B's context is the whole guard: the same statement the sweep's claim
    // issues, run as B, matches nothing.
    const claimed = await withTenant(appRole, contextB(), (tx) =>
      tx.webhookDelivery.updateMany({
        where: { id: queued?.id ?? '', state: 'pending' },
        data: { state: 'failed', nextAttemptAt: null, payload: null },
      }),
    );
    expect(claimed.count).toBe(0);

    // Still A's, still queued, still deliverable.
    const script = recordingSender(ALWAYS_OK);
    await redeliverer(script.sender).run({ now: laterThanBackoff() });
    expect(script.calls()).toHaveLength(1);
  });

  // --- Reporting -------------------------------------------------------------

  it('reports zero across every tenant when nothing is owed', async () => {
    const script = recordingSender(ALWAYS_OK);
    const report = await redeliverer(script.sender).run();

    expect(script.calls()).toHaveLength(0);
    expect(report.totals).toEqual({
      tenants: report.tenants.length,
      attempted: 0,
      delivered: 0,
      requeued: 0,
      exhausted: 0,
      skipped: 0,
    });
    expect(report.tenants.length).toBeGreaterThanOrEqual(2);
  });
});
