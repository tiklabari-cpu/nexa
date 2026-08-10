/**
 * Outbound webhooks — FR-MOD-08.8.4 (v1, Must). The highest-risk egress surface
 * (NFR-S7, R1/R2), so the properties under test are security properties first.
 *
 *   - Registration is guarded: only `webhooks--all:rw` may register, and a
 *     private/loopback/link-local/non-http(s) target is refused (SSRF) before it
 *     is ever stored.
 *   - The signing secret is returned exactly once and never re-exposed by list.
 *   - Isolation: another tenant cannot see, list or delete a webhook, and cannot
 *     read its delivery log.
 *   - Delivery signs every attempt (HMAC-SHA256), retries up to three times, and
 *     writes one delivery-log row per attempt — the last of a failed run flagged
 *     `permanent`.
 *
 * Negative cases lead: refusing a forged, cross-tenant or SSRF request is the
 * point of the feature, so those assertions come before the happy path.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isScope, type IntegrationAction, type IntegrationTrigger } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  WebhookDispatcher,
  type DeliverableWebhook,
  type WebhookSender,
} from '../../src/services/webhooks/webhook-dispatcher.js';
import { WEBHOOK_ACTIONS } from '../../src/services/webhooks/webhook-service.js';
import { verifyWebhook } from '../../src/services/webhooks/signature.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface Webhook {
  id: string;
  url: string;
  action: string;
  type: string;
  enabled: boolean;
  created_at: string;
}
interface WebhookRegistration extends Webhook {
  secret: string;
}

/** A public IP the SSRF guard allows, so the resolver never needs real DNS. */
const PUBLIC_IP = '93.184.216.34';

describe('webhooks (FR-MOD-08.8.4)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let readToken: string;
  let adminTokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const contextA = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });
  const contextB = () => ({ licenseId: fx.b.licenseId, organizationId: fx.b.organizationId });

  const deliveriesFor = (webhookId: string) =>
    owner.webhookDelivery.findMany({ where: { webhookId }, orderBy: { attempt: 'asc' } });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['webhooks--all:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['webhooks--all:ro'],
    });
    adminTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['webhooks--all:rw'],
    });
  });

  const register = (
    body: Record<string, unknown>,
    token = adminToken,
  ): ReturnType<TestServer['post']> => server.post('/webhooks', body, auth(token));

  // --- SSRF guard on registration (negative first, NFR-S7) -------------------

  describe('registration refuses an SSRF target', () => {
    it('rejects loopback, private, link-local and metadata addresses', async () => {
      for (const url of [
        'http://127.0.0.1/hook',
        'http://127.0.0.1:6379/hook',
        'http://10.0.0.5/hook',
        'http://192.168.1.1/hook',
        'http://169.254.169.254/latest/meta-data/',
      ]) {
        const res = await register({ url, action: 'chat_started' });
        expect(res.statusCode, url).toBe(400);
      }
    });

    it('rejects a non-http(s) scheme and embedded credentials', async () => {
      expect(
        (await register({ url: 'file:///etc/passwd', action: 'chat_started' })).statusCode,
      ).toBe(400);
      expect(
        (await register({ url: 'ftp://example.com/x', action: 'chat_started' })).statusCode,
      ).toBe(400);
      expect(
        (await register({ url: 'http://user:pass@example.com/', action: 'chat_started' }))
          .statusCode,
      ).toBe(400);
    });

    it('rejects an unknown action', async () => {
      const res = await register({ url: 'https://hooks.example.test/h', action: 'nope' });
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Scope enforcement -----------------------------------------------------

  it('refuses to register without the write scope', async () => {
    const res = await register(
      { url: 'https://hooks.example.test/h', action: 'chat_started' },
      readToken,
    );
    expect(res.statusCode).toBe(403);
  });

  // --- Register / list / unregister + secret shown once ----------------------

  it('registers a webhook and returns the secret exactly once', async () => {
    const res = await register({
      url: 'https://hooks.example.test/receiver',
      action: 'chat_started',
    });
    expect(res.statusCode).toBe(201);

    const body = res.json() as WebhookRegistration;
    expect(body.url).toBe('https://hooks.example.test/receiver');
    expect(body.action).toBe('chat_started');
    expect(body.type).toBe('license');
    expect(body.enabled).toBe(true);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    // The secret is present here…
    expect(body.secret).toMatch(/^whsec_/);

    // …and never again: not from list.
    const list = await server.get('/webhooks', auth(readToken));
    expect(list.statusCode).toBe(200);
    const { items } = list.json() as { items: Webhook[] };
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('secret');
    expect(items[0]!.id).toBe(body.id);
    // Nor is the stored key ever the empty string — it really was persisted.
    const row = await owner.webhook.findUnique({ where: { id: body.id } });
    expect(row?.secretKey).toBe(body.secret);
  });

  it('lists webhooks oldest-first and unregisters one', async () => {
    const first = (
      await register({ url: 'https://a.example.test/h', action: 'chat_started' })
    ).json() as WebhookRegistration;
    const second = (
      await register({ url: 'https://b.example.test/h', action: 'ticket_created' })
    ).json() as WebhookRegistration;

    const list = await server.get('/webhooks', auth(adminToken));
    const { items } = list.json() as { items: Webhook[] };
    expect(items.map((w) => w.id)).toEqual([first.id, second.id]);

    const removed = await server.del(`/webhooks/${first.id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);

    const after = await server.get('/webhooks', auth(adminToken));
    expect((after.json() as { items: Webhook[] }).items.map((w) => w.id)).toEqual([second.id]);
  });

  // --- Cross-tenant isolation (NFR-S5) ---------------------------------------

  it("hides another license's webhook behind a 404 and an empty list", async () => {
    const mine = (
      await register({ url: 'https://a-only.example.test/h', action: 'chat_started' })
    ).json() as WebhookRegistration;

    const listB = await server.get('/webhooks', auth(adminTokenB));
    expect((listB.json() as { items: Webhook[] }).items).toHaveLength(0);

    const delB = await server.del(`/webhooks/${mine.id}`, auth(adminTokenB));
    expect(delB.statusCode).toBe(404);

    // Untouched by the failed cross-tenant delete.
    const stillMine = await server.get('/webhooks', auth(readToken));
    expect((stillMine.json() as { items: Webhook[] }).items).toHaveLength(1);
  });

  // --- Integration manifest (FR-MOD-09.4) -------------------------------------

  describe('GET /integrations/manifest', () => {
    interface Manifest {
      triggers: IntegrationTrigger[];
      actions: IntegrationAction[];
      subscribe: { method: string; path: string };
      unsubscribe: { method: string; path: string };
    }

    it('refuses an unauthenticated caller with 401', async () => {
      const res = await server.get('/integrations/manifest');
      expect(res.statusCode).toBe(401);
    });

    it('refuses a caller without a webhooks scope with 403', async () => {
      const noScope = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: [],
      });
      const res = await server.get('/integrations/manifest', auth(noScope));
      expect(res.statusCode).toBe(403);
    });

    // The sync test: an action added to WEBHOOK_ACTIONS without a matching
    // INTEGRATION_TRIGGERS entry (or vice versa) fails right here.
    it('lists exactly the same triggers as WEBHOOK_ACTIONS, each with a sample payload', async () => {
      const res = await server.get('/integrations/manifest', auth(readToken));
      expect(res.statusCode).toBe(200);

      const body = res.json() as Manifest;
      const triggerActions = body.triggers.map((t) => t.action).sort();
      expect(triggerActions).toEqual([...WEBHOOK_ACTIONS].sort());

      for (const trigger of body.triggers) {
        expect(trigger.label).toBeTruthy();
        expect(trigger.description).toBeTruthy();
        expect(trigger.sample_payload).toBeTruthy();
      }
    });

    it('lists a non-empty actions catalogue whose required_scopes are all real scopes', async () => {
      const res = await server.get('/integrations/manifest', auth(readToken));
      const body = res.json() as Manifest;

      expect(body.actions.length).toBeGreaterThan(0);
      for (const action of body.actions) {
        expect(action.label).toBeTruthy();
        expect(action.required_scopes.length).toBeGreaterThan(0);
        for (const scope of action.required_scopes) {
          expect(isScope(scope)).toBe(true);
        }
      }
    });

    it('advertises subscribe/unsubscribe as the existing webhook endpoints', async () => {
      const res = await server.get('/integrations/manifest', auth(readToken));
      const body = res.json() as Manifest;

      expect(body.subscribe).toEqual({ method: 'POST', path: '/webhooks' });
      expect(body.unsubscribe).toEqual({ method: 'DELETE', path: '/webhooks/{webhookId}' });
    });

    it('returns the same document to two licenses, with no tenant identifier', async () => {
      const resA = await server.get('/integrations/manifest', auth(readToken));
      const resB = await server.get('/integrations/manifest', auth(adminTokenB));
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      // Byte-for-byte identical — the catalogue is static, not derived from who asked.
      expect(resA.json()).toEqual(resB.json());

      for (const raw of [resA.payload, resB.payload]) {
        expect(raw).not.toContain('license_id');
        expect(raw).not.toContain('organization_id');
        expect(raw).not.toContain(fx.a.organizationId);
        expect(raw).not.toContain(fx.b.organizationId);
        expect(raw).not.toContain(String(fx.a.licenseId));
        expect(raw).not.toContain(String(fx.b.licenseId));
      }
    });
  });

  // --- Delivery: signing + retry + logging (34.4, NFR-M5) --------------------

  describe('delivery signs, retries and logs every attempt', () => {
    /**
     * A sender that fails its first `failFirst` calls, then succeeds. Captures
     * the last request so the signature can be verified end to end.
     */
    function scriptedSender(failFirst: number): {
      sender: WebhookSender;
      calls: () => number;
      lastRequest: () => { url: URL; headers: Record<string, string>; body: string } | null;
    } {
      let count = 0;
      let last: { url: URL; headers: Record<string, string>; body: string } | null = null;
      const sender: WebhookSender = async (url, request) => {
        count += 1;
        last = { url, headers: request.headers, body: request.body };
        if (count <= failFirst) return { ok: false, statusCode: 500, error: 'http_500' };
        return { ok: true, statusCode: 200 };
      };
      return { sender, calls: () => count, lastRequest: () => last };
    }

    function dispatcher(sender: WebhookSender): WebhookDispatcher {
      return new WebhookDispatcher({
        sender,
        // No real DNS: the test host resolves to a public IP.
        resolver: async () => [PUBLIC_IP],
        // No real waiting between retries.
        sleep: async () => {},
        backoffMs: () => 0,
      });
    }

    async function registerDeliverable(action = 'chat_started'): Promise<DeliverableWebhook> {
      const body = (
        await register({ url: 'https://hooks.example.test/receiver', action })
      ).json() as WebhookRegistration;
      return { id: body.id, url: body.url, action: body.action, secretKey: body.secret };
    }

    it('recovers on the third attempt after two failures, logging all three', async () => {
      const webhook = await registerDeliverable();
      const script = scriptedSender(2);

      const outcome = await withTenant(appRole, contextA(), (tx) =>
        dispatcher(script.sender).deliver(tx, contextA(), webhook, { chat_id: 'TJ1H8CFKRV' }),
      );

      expect(outcome).toEqual({ webhookId: webhook.id, delivered: true, attempts: 3 });
      expect(script.calls()).toBe(3);

      const rows = await deliveriesFor(webhook.id);
      expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3]);
      expect(rows.map((r) => r.ok)).toEqual([false, false, true]);
      // A recovered delivery is never flagged permanent.
      expect(rows.every((r) => r.permanent === false)).toBe(true);

      // The last attempt was genuinely signed: its headers verify.
      const req = script.lastRequest()!;
      const result = verifyWebhook(webhook.secretKey, {
        body: req.body,
        timestamp: req.headers['X-Webhook-Timestamp'],
        nonce: req.headers['X-Webhook-Nonce'],
        signature: req.headers['X-Webhook-Signature'],
      });
      expect(result).toEqual({ ok: true });
    });

    it('gives up after three failures and marks the last attempt permanent', async () => {
      const webhook = await registerDeliverable();
      const script = scriptedSender(Number.POSITIVE_INFINITY);

      const outcome = await withTenant(appRole, contextA(), (tx) =>
        dispatcher(script.sender).deliver(tx, contextA(), webhook, { chat_id: 'X' }),
      );

      expect(outcome).toEqual({ webhookId: webhook.id, delivered: false, attempts: 3 });
      expect(script.calls()).toBe(3);

      const rows = await deliveriesFor(webhook.id);
      expect(rows.map((r) => r.ok)).toEqual([false, false, false]);
      // Exactly one row — the last — carries the "gave up" flag.
      expect(rows.map((r) => r.permanent)).toEqual([false, false, true]);
      expect(rows.every((r) => r.statusCode === 500)).toBe(true);
    });

    it('dispatches to every enabled webhook subscribed to the action', async () => {
      const a = await registerDeliverable('chat_deactivated');
      const b = await registerDeliverable('chat_deactivated');
      // A different action must not receive this event.
      const other = await registerDeliverable('ticket_created');
      const script = scriptedSender(0);

      const outcomes = await withTenant(appRole, contextA(), (tx) =>
        dispatcher(script.sender).dispatch(tx, contextA(), {
          action: 'chat_deactivated',
          payload: { chat_id: 'Z' },
        }),
      );

      expect(new Set(outcomes.map((o) => o.webhookId))).toEqual(new Set([a.id, b.id]));
      expect(outcomes.every((o) => o.delivered)).toBe(true);
      expect(await deliveriesFor(other.id)).toHaveLength(0);
    });

    it('refuses at send time if the URL now resolves to a private address', async () => {
      const webhook = await registerDeliverable();
      const neverSend: WebhookSender = async () => {
        throw new Error('sender must not be reached when SSRF blocks the URL');
      };
      // The resolver now points the (public-looking) host at an internal address.
      const rebinding = new WebhookDispatcher({
        sender: neverSend,
        resolver: async () => ['169.254.169.254'],
        sleep: async () => {},
        backoffMs: () => 0,
      });

      const outcome = await withTenant(appRole, contextA(), (tx) =>
        rebinding.deliver(tx, contextA(), webhook, { chat_id: 'Y' }),
      );
      expect(outcome.delivered).toBe(false);

      const rows = await deliveriesFor(webhook.id);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.ok === false && r.error === 'ssrf_blocked')).toBe(true);
    });

    it("keeps a tenant's delivery log invisible to another tenant", async () => {
      const webhook = await registerDeliverable();
      await withTenant(appRole, contextA(), (tx) =>
        dispatcher(scriptedSender(0).sender).deliver(tx, contextA(), webhook, { chat_id: 'A' }),
      );

      const visibleToB = await withTenant(appRole, contextB(), (tx) =>
        tx.webhookDelivery.findMany({ where: { webhookId: webhook.id } }),
      );
      expect(visibleToB).toHaveLength(0);

      // The rows really exist for A.
      const visibleToA = await withTenant(appRole, contextA(), (tx) =>
        tx.webhookDelivery.findMany({ where: { webhookId: webhook.id } }),
      );
      expect(visibleToA.length).toBeGreaterThan(0);
    });
  });
});
