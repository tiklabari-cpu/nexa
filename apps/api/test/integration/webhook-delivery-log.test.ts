/**
 * Webhook delivery log — KN-03 (tm 375).
 *
 * `webhook_deliveries` was written for a long time and readable by no one. The
 * claims under test are what the screen needs from the server:
 *
 *   - a failed delivery is visible with its HTTP status and a *cleaned* error;
 *   - "Redeliver" makes a real, signed, new attempt and the result is the new
 *     newest row — and it refuses what cannot be replayed;
 *   - "Test" sends a signed ping marked `test: true`, bounded per minute;
 *   - a switched-off webhook receives no event;
 *   - another workspace's webhook and deliveries are invisible (404, never 403).
 *
 * Negative cases lead, as in `webhooks.test.ts`. The receiver is a recording
 * sender (MASTER-PROMPT §5) — no request leaves the process.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  WEBHOOK_LOG_KEEP_DAYS,
  WEBHOOK_PAYLOAD_KEEP_MS,
  pruneDeliveryLog,
} from '../../src/services/webhooks/delivery-log.js';
import {
  WebhookDispatcher,
  type WebhookSendResult,
  type WebhookSender,
} from '../../src/services/webhooks/webhook-dispatcher.js';
import { verifyWebhook } from '../../src/services/webhooks/signature.js';
import { WEBHOOK_TESTS_PER_MINUTE } from '../../src/routes/webhooks.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** An IP-literal target: the SSRF guard accepts it and no DNS is consulted. */
const RECEIVER = 'https://93.184.216.34/hook';

interface Delivery {
  id: string;
  event_id: string | null;
  action: string;
  attempt: number;
  state: string;
  ok: boolean;
  status_code: number | null;
  error: string | null;
  test: boolean;
  created_at: string;
  next_attempt_at: string | null;
  can_redeliver: boolean;
}
interface Page {
  items: Delivery[];
  next_cursor: string | null;
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

describe('webhook delivery log (KN-03)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let admin: string;
  let readOnly: string;
  let adminB: string;

  /** Everything the mock receiver was sent, and what it answers with. */
  let sent: Sent[];
  let answer: WebhookSendResult;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const contextA = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer(
      {},
      {
        webhookSender: async (target, request): Promise<WebhookSendResult> => {
          sent.push({ url: target.url.toString(), headers: request.headers, body: request.body });
          return answer;
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    sent = [];
    answer = { ok: true, statusCode: 200 };
    const base = {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
    };
    admin = await grantToken(owner, { ...base, scopes: ['webhooks--all:rw'] });
    readOnly = await grantToken(owner, { ...base, scopes: ['webhooks--all:ro'] });
    adminB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['webhooks--all:rw'],
    });
  });

  /** A webhook with a known secret, written directly. */
  async function webhookFor(
    licenseId: bigint,
    overrides: { enabled?: boolean } = {},
  ): Promise<{ id: string; secret: string }> {
    const secret = `whsec_test_${Math.random().toString(36).slice(2)}`;
    const row = await owner.webhook.create({
      data: {
        licenseId,
        url: RECEIVER,
        action: 'chat_started',
        secretKey: secret,
        enabled: overrides.enabled ?? true,
      },
      select: { id: true },
    });
    return { id: row.id, secret };
  }

  let nextAt = Date.parse('2026-10-01T10:00:00.000Z');
  /** One attempt row. `createdAt` ascends so list order is predictable. */
  async function attemptRow(
    licenseId: bigint,
    webhookId: string,
    spec: {
      state: 'pending' | 'delivered' | 'failed' | 'exhausted';
      attempt?: number;
      eventId?: string;
      statusCode?: number | null;
      error?: string | null;
      payload?: string | null;
      createdAt?: Date;
      isTest?: boolean;
    },
  ): Promise<string> {
    nextAt += 1000;
    const row = await owner.webhookDelivery.create({
      data: {
        licenseId,
        webhookId,
        eventId: spec.eventId ?? crypto.randomUUID(),
        action: 'chat_started',
        attempt: spec.attempt ?? 1,
        ok: spec.state === 'delivered',
        statusCode: spec.statusCode ?? null,
        error: spec.error ?? null,
        permanent: spec.state === 'exhausted',
        state: spec.state,
        nextAttemptAt: spec.state === 'pending' ? new Date(Date.now() + 600_000) : null,
        payload: spec.payload ?? null,
        isTest: spec.isTest ?? false,
        createdAt: spec.createdAt ?? new Date(nextAt),
      },
      select: { id: true },
    });
    return row.id;
  }

  const BODY = JSON.stringify({ action: 'chat_started', data: { chat_id: 'TJ1H8CFKRV' } });

  const list = async (webhookId: string, query = '', token = admin): Promise<Page> => {
    const res = await server.get(`/webhooks/${webhookId}/deliveries${query}`, auth(token));
    expect(res.statusCode).toBe(200);
    return res.json() as Page;
  };

  // --- isolation (negative first) -------------------------------------------

  describe("another workspace's webhook is invisible", () => {
    it('answers 404 — never 403 — for list, redeliver, test and switch (NFR-S5)', async () => {
      const mine = await webhookFor(fx.a.licenseId);
      const deliveryId = await attemptRow(fx.a.licenseId, mine.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
      });

      const asB = auth(adminB);
      expect((await server.get(`/webhooks/${mine.id}/deliveries`, asB)).statusCode).toBe(404);
      expect(
        (await server.post(`/webhooks/${mine.id}/deliveries/${deliveryId}/redeliver`, {}, asB))
          .statusCode,
      ).toBe(404);
      expect((await server.post(`/webhooks/${mine.id}/test`, {}, asB)).statusCode).toBe(404);
      expect((await server.patch(`/webhooks/${mine.id}`, { enabled: false }, asB)).statusCode).toBe(
        404,
      );

      // Nothing was sent and nothing changed.
      expect(sent).toHaveLength(0);
      expect((await owner.webhook.findUniqueOrThrow({ where: { id: mine.id } })).enabled).toBe(
        true,
      );
      expect(await owner.webhookDelivery.count({ where: { webhookId: mine.id } })).toBe(1);
    });

    it("B's own log never shows A's deliveries", async () => {
      const mine = await webhookFor(fx.a.licenseId);
      await attemptRow(fx.a.licenseId, mine.id, { state: 'delivered', statusCode: 200 });
      const theirs = await webhookFor(fx.b.licenseId);

      const page = await list(theirs.id, '', adminB);
      expect(page.items).toHaveLength(0);
      // A delivery id of A's, asked about under B's webhook, is just absent.
      const foreign = await attemptRow(fx.a.licenseId, mine.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
      });
      const res = await server.post(
        `/webhooks/${theirs.id}/deliveries/${foreign}/redeliver`,
        {},
        auth(adminB),
      );
      expect(res.statusCode).toBe(404);
      expect(sent).toHaveLength(0);
    });
  });

  describe('scopes', () => {
    it('a read-only token lists the log but cannot redeliver, test or switch', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const id = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
      });
      const ro = auth(readOnly);
      expect((await server.get(`/webhooks/${hook.id}/deliveries`, ro)).statusCode).toBe(200);
      expect(
        (await server.post(`/webhooks/${hook.id}/deliveries/${id}/redeliver`, {}, ro)).statusCode,
      ).toBe(403);
      expect((await server.post(`/webhooks/${hook.id}/test`, {}, ro)).statusCode).toBe(403);
      expect((await server.patch(`/webhooks/${hook.id}`, { enabled: false }, ro)).statusCode).toBe(
        403,
      );
      expect(sent).toHaveLength(0);
    });

    it('refuses an unauthenticated request', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      expect((await server.get(`/webhooks/${hook.id}/deliveries`)).statusCode).toBe(401);
    });
  });

  // --- the list ---------------------------------------------------------------

  describe('list', () => {
    it('shows a failed delivery with its HTTP status and a cleaned error, newest first', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      await attemptRow(fx.a.licenseId, hook.id, { state: 'delivered', statusCode: 200 });
      await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        statusCode: 503,
        error: 'http_503',
        payload: BODY,
      });
      // A row from an earlier release could hold anything. It must come out clean.
      const dirty =
        'upstream said Bearer abcDEF123456 at https://api.example.com/x?token=s3cret ' +
        'whsec_abcdefghijklmnop secret=hunter2\n' +
        'x'.repeat(2000);
      await attemptRow(fx.a.licenseId, hook.id, {
        state: 'failed',
        statusCode: 500,
        error: dirty,
      });

      const page = await list(hook.id);
      expect(page.items.map((d) => d.state)).toEqual(['failed', 'exhausted', 'delivered']);
      const [failed, exhausted] = page.items;
      expect(failed?.status_code).toBe(500);
      expect(failed?.error?.length ?? 0).toBeLessThanOrEqual(500);
      for (const secretish of ['abcDEF123456', 's3cret', 'whsec_abcdefghijklmnop', 'hunter2']) {
        expect(failed?.error).not.toContain(secretish);
      }
      expect(failed?.error).not.toContain('\n');
      expect(failed?.can_redeliver).toBe(false);
      expect(exhausted).toMatchObject({
        status_code: 503,
        error: 'http_503',
        attempt: 8,
        can_redeliver: true,
      });
      // The payload itself is never part of the response.
      expect(JSON.stringify(page)).not.toContain('TJ1H8CFKRV');
    });

    it('filters by state and pages newest-first without repeating or dropping a row', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      // Five rows sharing one instant: the id tiebreak has to hold the order.
      const same = new Date('2026-10-02T12:00:00.000Z');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          await attemptRow(fx.a.licenseId, hook.id, {
            state: 'delivered',
            statusCode: 200,
            createdAt: same,
          }),
        );
      }
      await attemptRow(fx.a.licenseId, hook.id, { state: 'failed', statusCode: 502 });

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Page = await list(
          hook.id,
          `?state=delivered&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((d) => d.id));
        cursor = page.next_cursor;
      } while (cursor);
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it('rejects a bad state, limit and cursor', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      for (const query of ['?state=nope', '?limit=0', '?limit=101', '?cursor=not-a-cursor']) {
        const res = await server.get(`/webhooks/${hook.id}/deliveries${query}`, auth(admin));
        expect(res.statusCode, query).toBe(400);
      }
    });
  });

  // --- redeliver --------------------------------------------------------------

  describe('redeliver', () => {
    it('sends a signed new attempt, supersedes the old row and returns the new one', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const eventId = crypto.randomUUID();
      const old = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        eventId,
        statusCode: 503,
        error: 'http_503',
        payload: BODY,
      });

      const res = await server.post(
        `/webhooks/${hook.id}/deliveries/${old}/redeliver`,
        {},
        auth(admin),
      );
      expect(res.statusCode).toBe(200);
      const created = res.json() as Delivery;
      expect(created).toMatchObject({
        event_id: eventId,
        attempt: 9,
        state: 'delivered',
        ok: true,
        status_code: 200,
        test: false,
        can_redeliver: false,
      });
      expect(created.id).not.toBe(old);

      // One real send, byte-for-byte the stored body, genuinely signed.
      expect(sent).toHaveLength(1);
      const request = sent[0]!;
      expect(request.body).toBe(BODY);
      expect(
        verifyWebhook(hook.secret, {
          body: request.body,
          timestamp: request.headers['X-Webhook-Timestamp'],
          nonce: request.headers['X-Webhook-Nonce'],
          signature: request.headers['X-Webhook-Signature'],
        }),
      ).toEqual({ ok: true });

      // The row it replaced is history now, and keeps no copy of the body.
      const replaced = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: old } });
      expect(replaced).toMatchObject({ state: 'failed', permanent: false, payload: null });
      const stored = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.payload).toBeNull();

      // The new attempt is the newest row of the log.
      expect((await list(hook.id)).items[0]?.id).toBe(created.id);
      // And the trail says a person did it, without the payload.
      const audit = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'webhook.redelivered' },
      });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit?.metadata)).not.toContain('TJ1H8CFKRV');

      // It cannot be replayed twice: the old row is superseded and the new one delivered.
      const again = await server.post(
        `/webhooks/${hook.id}/deliveries/${old}/redeliver`,
        {},
        auth(admin),
      );
      expect(again.statusCode).toBe(400);
      expect(sent).toHaveLength(1);
    });

    it('a failing redelivery lands as a new exhausted row that keeps the body for another try', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const old = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
      });
      answer = { ok: false, statusCode: 502, error: 'http_502' };

      const res = await server.post(
        `/webhooks/${hook.id}/deliveries/${old}/redeliver`,
        {},
        auth(admin),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        attempt: 9,
        state: 'exhausted',
        ok: false,
        status_code: 502,
        error: 'http_502',
        can_redeliver: true,
      });
      const page = await list(hook.id);
      expect(page.items.map((d) => d.state)).toEqual(['exhausted', 'failed']);
    });

    it('refuses what cannot be replayed with reason not_redeliverable', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const eventId = crypto.randomUUID();
      const delivered = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'delivered',
        statusCode: 200,
      });
      const aged = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: null,
      });
      const test = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'failed',
        isTest: true,
        payload: BODY,
      });
      const superseded = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 3,
        eventId,
        payload: BODY,
      });
      await attemptRow(fx.a.licenseId, hook.id, { state: 'delivered', attempt: 4, eventId });

      for (const id of [delivered, aged, test, superseded]) {
        const res = await server.post(
          `/webhooks/${hook.id}/deliveries/${id}/redeliver`,
          {},
          auth(admin),
        );
        expect(res.statusCode, id).toBe(400);
        expect(res.json()).toMatchObject({
          error: { type: 'validation', details: { reason: 'not_redeliverable' } },
        });
      }
      const unknown = await server.post(
        `/webhooks/${hook.id}/deliveries/${crypto.randomUUID()}/redeliver`,
        {},
        auth(admin),
      );
      expect(unknown.statusCode).toBe(404);
      expect(sent).toHaveLength(0);
    });

    it('refuses while the webhook is switched off — consent withdrawn — with reason webhook_disabled', async () => {
      const hook = await webhookFor(fx.a.licenseId, { enabled: false });
      const id = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
      });
      const res = await server.post(
        `/webhooks/${hook.id}/deliveries/${id}/redeliver`,
        {},
        auth(admin),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { details: { reason: 'webhook_disabled' } } });
      expect(sent).toHaveLength(0);
    });

    it('an SSRF-blocked target is a logged failure, not a send', async () => {
      const hook = await owner.webhook.create({
        data: {
          licenseId: fx.a.licenseId,
          url: 'http://127.0.0.1:9/hook',
          action: 'chat_started',
          secretKey: 'whsec_x',
        },
        select: { id: true },
      });
      const id = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
      });
      const res = await server.post(
        `/webhooks/${hook.id}/deliveries/${id}/redeliver`,
        {},
        auth(admin),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: false, error: 'ssrf_blocked', status_code: null });
      expect(sent).toHaveLength(0);
    });
  });

  // --- test ping --------------------------------------------------------------

  describe('test event', () => {
    it('sends a signed ping marked test:true, logs it as a test row, never queues it', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const res = await server.post(`/webhooks/${hook.id}/test`, {}, auth(admin));
      expect(res.statusCode).toBe(200);
      const created = res.json() as Delivery;
      expect(created).toMatchObject({
        test: true,
        ok: true,
        status_code: 200,
        state: 'delivered',
        attempt: 1,
        can_redeliver: false,
      });

      expect(sent).toHaveLength(1);
      const request = sent[0]!;
      expect(JSON.parse(request.body)).toMatchObject({ action: 'chat_started', test: true });
      expect(
        verifyWebhook(hook.secret, {
          body: request.body,
          timestamp: request.headers['X-Webhook-Timestamp'],
          nonce: request.headers['X-Webhook-Nonce'],
          signature: request.headers['X-Webhook-Signature'],
        }),
      ).toEqual({ ok: true });

      const stored = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored).toMatchObject({ isTest: true, payload: null, nextAttemptAt: null });
    });

    it('a ping the receiver refuses is a failed test row, with no retry queued', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      answer = { ok: false, statusCode: 410, error: 'http_410' };
      const res = await server.post(`/webhooks/${hook.id}/test`, {}, auth(admin));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        test: true,
        ok: false,
        status_code: 410,
        error: 'http_410',
        state: 'failed',
      });
      expect(await owner.webhookDelivery.count({ where: { state: 'pending' } })).toBe(0);
    });

    it('works on a switched-off webhook (check it before switching it on)', async () => {
      const hook = await webhookFor(fx.a.licenseId, { enabled: false });
      const res = await server.post(`/webhooks/${hook.id}/test`, {}, auth(admin));
      expect(res.statusCode).toBe(200);
      expect(sent).toHaveLength(1);
    });

    it(`allows ${WEBHOOK_TESTS_PER_MINUTE} a minute per webhook, then 429 with Retry-After`, async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const other = await webhookFor(fx.a.licenseId);
      for (let i = 0; i < WEBHOOK_TESTS_PER_MINUTE; i++) {
        expect((await server.post(`/webhooks/${hook.id}/test`, {}, auth(admin))).statusCode).toBe(
          200,
        );
      }
      const over = await server.post(`/webhooks/${hook.id}/test`, {}, auth(admin));
      expect(over.statusCode).toBe(429);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect(sent).toHaveLength(WEBHOOK_TESTS_PER_MINUTE);
      // The bound is per webhook: another one still answers.
      expect((await server.post(`/webhooks/${other.id}/test`, {}, auth(admin))).statusCode).toBe(
        200,
      );
    });

    it('does not count as an automation run', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      await server.post(`/webhooks/${hook.id}/test`, {}, auth(admin));
      const stats = await withTenant(appRole, contextA(), (tx) =>
        tx.webhookDelivery.groupBy({
          by: ['webhookId'],
          where: { webhookId: hook.id, ok: true, isTest: false },
          _max: { createdAt: true },
        }),
      );
      expect(stats).toHaveLength(0);
    });
  });

  // --- switching a webhook off ---------------------------------------------

  describe('enable / disable (PATCH)', () => {
    it('a switched-off webhook receives no event; switching it on again restores delivery', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const dispatcher = new WebhookDispatcher({
        sender: (async (_target, request) => {
          sent.push({ url: _target.url.toString(), headers: request.headers, body: request.body });
          return { ok: true, statusCode: 200 };
        }) satisfies WebhookSender,
        resolver: async () => ['93.184.216.34'],
        requestAttempts: 1,
      });
      const fire = (): Promise<unknown> =>
        withTenant(appRole, contextA(), (tx) =>
          dispatcher.dispatch(tx, contextA(), {
            action: 'chat_started',
            payload: { chat_id: 'TJ1H8CFKRV' },
          }),
        );

      const off = await server.patch(`/webhooks/${hook.id}`, { enabled: false }, auth(admin));
      expect(off.statusCode).toBe(200);
      expect(off.json()).toMatchObject({ id: hook.id, enabled: false });
      expect(JSON.stringify(off.json())).not.toContain(hook.secret);
      await fire();
      expect(sent).toHaveLength(0);
      expect((await list(hook.id)).items).toHaveLength(0);

      const on = await server.patch(`/webhooks/${hook.id}`, { enabled: true }, auth(admin));
      expect(on.json()).toMatchObject({ enabled: true });
      await fire();
      expect(sent).toHaveLength(1);
    });

    it('records a real change in the audit trail once, and not a no-op', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      await server.patch(`/webhooks/${hook.id}`, { enabled: false }, auth(admin));
      await server.patch(`/webhooks/${hook.id}`, { enabled: false }, auth(admin));
      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'webhook.updated' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.metadata).toMatchObject({ enabled: false, url_host: '93.184.216.34' });
      expect(JSON.stringify(entries[0]?.metadata)).not.toContain('/hook');
    });

    it('rejects a body that is not exactly { enabled: boolean }', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      for (const body of [{}, { enabled: 'no' }, { enabled: true, url: 'https://evil.test' }]) {
        const res = await server.patch(`/webhooks/${hook.id}`, body, auth(admin));
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      const row = await owner.webhook.findUniqueOrThrow({ where: { id: hook.id } });
      expect(row.url).toBe(RECEIVER);
    });
  });

  // --- retention -------------------------------------------------------------

  describe('retention', () => {
    it('clears an exhausted payload after 72 h and deletes settled rows after 30 days, never a queued one', async () => {
      const hook = await webhookFor(fx.a.licenseId);
      const now = new Date('2026-11-01T12:00:00.000Z');
      const ago = (ms: number): Date => new Date(now.getTime() - ms);

      const fresh = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
        createdAt: ago(WEBHOOK_PAYLOAD_KEEP_MS - 60_000),
      });
      const stale = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'exhausted',
        attempt: 8,
        payload: BODY,
        createdAt: ago(WEBHOOK_PAYLOAD_KEEP_MS + 60_000),
      });
      const oldDelivered = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'delivered',
        createdAt: ago((WEBHOOK_LOG_KEEP_DAYS * 86_400 + 60) * 1000),
      });
      const oldQueued = await attemptRow(fx.a.licenseId, hook.id, {
        state: 'pending',
        attempt: 2,
        payload: BODY,
        createdAt: ago((WEBHOOK_LOG_KEEP_DAYS * 86_400 + 60) * 1000),
      });
      // Another workspace's stale row is not this sweep's to touch.
      const theirs = await webhookFor(fx.b.licenseId);
      const foreign = await attemptRow(fx.b.licenseId, theirs.id, {
        state: 'delivered',
        createdAt: ago((WEBHOOK_LOG_KEEP_DAYS * 86_400 + 60) * 1000),
      });

      const result = await withTenant(appRole, contextA(), (tx) => pruneDeliveryLog(tx, now));
      expect(result).toEqual({ payloadsCleared: 1, rowsDeleted: 1 });

      const byId = async (id: string) =>
        owner.webhookDelivery.findUnique({ where: { id }, select: { payload: true } });
      expect((await byId(fresh))?.payload).toBe(BODY);
      expect((await byId(stale))?.payload).toBeNull();
      expect(await byId(oldDelivered)).toBeNull();
      expect((await byId(oldQueued))?.payload).toBe(BODY);
      expect(await byId(foreign)).not.toBeNull();
    });
  });
});
