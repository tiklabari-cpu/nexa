/**
 * The Zapier/Make automation leg — FR-MOD-09.4.
 *
 * The audit's finding was that Zapier and Make were two catalogue cards and
 * nothing else: the numbers they showed ("Active zaps", "Last run") were fixed
 * option lists, and no code path connected a workspace event to a zap. The
 * webhook stack (08.8.4) had a registry, a signed SSRF-guarded sender and a
 * redelivery sweep — but no *caller*, so a subscription could be registered and
 * would never fire.
 *
 * What this file pins, end to end against real Postgres + Redis + Fastify, with
 * a **mock receiver** in place of `hooks.zapier.com` (MASTER-PROMPT §5 — nothing
 * leaves the process):
 *
 *   - the negative gate first: a trigger cannot be registered for a card that is
 *     not connected, or for a card that is not an automation platform at all;
 *   - a connected card's trigger actually fires on a workspace event, exactly
 *     once, signed (HMAC-SHA256 + timestamp + nonce) so the receiver can verify
 *     it — and the same for `ticket_created` on the `api_key` card, which has to
 *     use the identical path;
 *   - disconnecting the card takes its triggers with it, so the same event that
 *     used to reach the zap now reaches nothing;
 *   - a receiver that fails does not break the flow that triggered it;
 *   - the card's two figures are read from that registry, so they are `0` with
 *     nothing wired and `1` after one trigger is registered.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyWebhook } from '../../src/services/webhooks/signature.js';
import type {
  WebhookRequest,
  WebhookSendResult,
} from '../../src/services/webhooks/webhook-dispatcher.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/**
 * A literal public IP, so the SSRF guard's DNS re-check short-circuits (see
 * `assertPublicHttpUrlResolved`) and the suite needs no network — not even to
 * resolve a name. The sender below never opens a socket either way.
 */
const RECEIVER = 'https://93.184.216.34/zap/catch';
const MAKE_RECEIVER = 'https://93.184.216.34/make/scenario';

/** A `provider: 'oauth'` automation card, and a `provider: 'api_key'` one. */
const ZAPIER = 'zapier';
const MAKE = 'make';
/** A card that is connectable but is not an automation platform. */
const NOT_AN_AUTOMATION = 'hubspot';
const MAKE_API_KEY = 'make-live-never-logged-77af';

interface Received {
  url: string;
  request: WebhookRequest;
}

interface Webhook {
  id: string;
  url: string;
  action: string;
  app_id: string | null;
}
interface WebhookRegistration extends Webhook {
  secret: string;
}

interface AppListItem {
  id: string;
  name: string;
  installed: boolean;
  installation: {
    automation: { triggers: number; last_run_at: string | null } | null;
  } | null;
}

describe('workspace event → zap (FR-MOD-09.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;

  /** Everything the mock receiver was sent, in order. */
  let received: Received[];
  /** What the mock receiver answers with. A test flips it to fail a delivery. */
  let status: number;

  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      {},
      {
        // The mock provider (MASTER-PROMPT §5): records the signed request and
        // answers from `status`. No request ever reaches hooks.zapier.com — in
        // this suite or anywhere else in the repo.
        webhookSender: async (url, request): Promise<WebhookSendResult> => {
          received.push({ url: url.toString(), request });
          return status >= 200 && status < 300
            ? { ok: true, statusCode: status }
            : { ok: false, statusCode: status, error: `http_${status}` };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    received = [];
    status = 200;
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      // Connect a card, register a subscription, open a chat, open a ticket.
      scopes: ['access_rules:rw', 'webhooks--all:rw', 'chats--all:rw', 'tickets--all:rw'],
    });
  });

  // --- helpers ---------------------------------------------------------------

  /** Connect the OAuth automation card through the mock handshake. */
  async function connectZapier(): Promise<void> {
    const started = await server.post(`/settings/apps/${ZAPIER}/oauth/start`, undefined, auth());
    expect(started.statusCode).toBe(200);
    const { state } = started.json() as { state: string };
    const done = await server.post(
      `/settings/apps/${ZAPIER}/oauth/callback`,
      { state, code: 'mock-code' },
      auth(),
    );
    expect(done.statusCode).toBe(200);
  }

  /** Connect the API-key automation card by pasting a key (09.2's other path). */
  async function connectMake(): Promise<void> {
    const done = await server.post(
      `/settings/apps/${MAKE}/connect`,
      { api_key: MAKE_API_KEY },
      auth(),
    );
    expect(done.statusCode).toBe(200);
  }

  async function subscribe(body: Record<string, unknown>): Promise<WebhookRegistration> {
    const response = await server.post('/webhooks', body, auth());
    expect(response.statusCode).toBe(201);
    return response.json() as WebhookRegistration;
  }

  /** Open a chat for the tenant's seeded visitor. Returns its id. */
  async function startChat(): Promise<string> {
    const response = await server.post('/chats', { customer_id: fx.a.customerId }, auth());
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }

  /** The card as the marketplace shows it — where the two figures live. */
  async function card(appId: string): Promise<AppListItem> {
    const response = await server.get(`/settings/apps?category=productivity&limit=100`, auth());
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: AppListItem[] }).items;
    const found = items.find((item) => item.id === appId);
    expect(found).toBeDefined();
    return found!;
  }

  // --- The negative gate, first ---------------------------------------------

  it('refuses a trigger for a card this workspace has not connected (FR-MOD-09.4)', async () => {
    const response = await server.post(
      '/webhooks',
      { url: RECEIVER, action: 'chat_started', app_id: ZAPIER },
      auth(),
    );

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { message: string } }).error.message).toContain('app_id');
    // Nothing was stored, so nothing can fire later either.
    expect(await owner.webhook.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('refuses a trigger for a card that is not an automation platform (FR-MOD-09.4)', async () => {
    // Connected — so the refusal is about *what kind* of card it is, not about
    // the connection, which is the check the previous test already covered.
    const started = await server.post(
      `/settings/apps/${NOT_AN_AUTOMATION}/oauth/start`,
      undefined,
      auth(),
    );
    const { state } = started.json() as { state: string };
    await server.post(
      `/settings/apps/${NOT_AN_AUTOMATION}/oauth/callback`,
      { state, code: 'mock-code' },
      auth(),
    );

    const response = await server.post(
      '/webhooks',
      { url: RECEIVER, action: 'chat_started', app_id: NOT_AN_AUTOMATION },
      auth(),
    );
    expect(response.statusCode).toBe(400);
    expect(await owner.webhook.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('fires nothing at all when no trigger is registered (FR-MOD-09.4)', async () => {
    await connectZapier();
    await startChat();
    expect(received).toEqual([]);
  });

  // --- The requirement: a workspace event reaches the zap --------------------

  it('delivers a signed trigger to the zap exactly once when a chat starts (FR-MOD-09.4)', async () => {
    await connectZapier();
    const registration = await subscribe({
      url: RECEIVER,
      action: 'chat_started',
      app_id: ZAPIER,
    });
    expect(registration.app_id).toBe(ZAPIER);

    const chatId = await startChat();

    // Exactly one: a retried burst or a second subscription would show here.
    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.url).toBe(RECEIVER);

    // The receiver can verify it — HMAC-SHA256 over `{timestamp}.{nonce}.{body}`,
    // which is the whole point of a signed hook: the zap can tell a real
    // delivery from anything else that found its catch URL.
    const headers = delivery!.request.headers;
    expect(
      verifyWebhook(registration.secret, {
        body: delivery!.request.body,
        timestamp: headers['X-Webhook-Timestamp'],
        nonce: headers['X-Webhook-Nonce'],
        signature: headers['X-Webhook-Signature'],
      }),
    ).toEqual({ ok: true });
    // A tampered body no longer verifies under the same headers.
    expect(
      verifyWebhook(registration.secret, {
        body: `${delivery!.request.body} `,
        timestamp: headers['X-Webhook-Timestamp'],
        nonce: headers['X-Webhook-Nonce'],
        signature: headers['X-Webhook-Signature'],
      }).ok,
    ).toBe(false);

    // And it carries the event, in the envelope the manifest advertises.
    const body = JSON.parse(delivery!.request.body) as {
      action: string;
      data: { chat_id: string; customer_id: string; active: boolean };
    };
    expect(body.action).toBe('chat_started');
    expect(body.data.chat_id).toBe(chatId);
    expect(body.data.customer_id).toBe(fx.a.customerId);
    expect(body.data.active).toBe(true);
  });

  it('delivers only the event the trigger subscribed to (FR-MOD-09.4)', async () => {
    await connectZapier();
    await subscribe({ url: RECEIVER, action: 'ticket_created', app_id: ZAPIER });

    // A chat start is a workspace event, but not *this* trigger's.
    const chatId = await startChat();
    expect(received).toEqual([]);

    const ticket = await server.post(
      '/tickets',
      { subject: 'Refund request', source_chat_id: chatId },
      auth(),
    );
    expect(ticket.statusCode).toBe(201);

    expect(received).toHaveLength(1);
    const body = JSON.parse(received[0]!.request.body) as {
      action: string;
      data: { ticket_id: string; subject: string };
    };
    expect(body.action).toBe('ticket_created');
    expect(body.data.subject).toBe('Refund request');
    expect(body.data.ticket_id).toBe((ticket.json() as { id: string }).id);
  });

  it('gives the api_key card (Make) the same path as the OAuth one (FR-MOD-09.4)', async () => {
    await connectMake();
    const registration = await subscribe({
      url: MAKE_RECEIVER,
      action: 'chat_started',
      app_id: MAKE,
    });
    expect(registration.app_id).toBe(MAKE);

    await startChat();

    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe(MAKE_RECEIVER);
    expect(
      verifyWebhook(registration.secret, {
        body: received[0]!.request.body,
        timestamp: received[0]!.request.headers['X-Webhook-Timestamp'],
        nonce: received[0]!.request.headers['X-Webhook-Nonce'],
        signature: received[0]!.request.headers['X-Webhook-Signature'],
      }),
    ).toEqual({ ok: true });
  });

  it('stops firing once the card is disconnected (FR-MOD-09.4)', async () => {
    await connectZapier();
    await subscribe({ url: RECEIVER, action: 'chat_started', app_id: ZAPIER });
    await startChat();
    expect(received).toHaveLength(1);

    const disconnected = await server.del(`/settings/apps/${ZAPIER}`, auth());
    expect(disconnected.statusCode).toBe(204);
    // The subscription went with the connection — there is no disabled row left
    // for a later reconnect to silently resurrect.
    expect(await owner.webhook.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);

    // Close the first chat so the next start creates a second one rather than
    // returning the existing active chat (`start` is idempotent on that).
    const chats = await owner.chat.findMany({ where: { licenseId: fx.a.licenseId } });
    await server.post(`/chats/${chats[0]!.id}/deactivate`, undefined, auth());
    received = [];

    await startChat();
    expect(received).toEqual([]);
  });

  // --- The receiver's problems stay the receiver's ---------------------------

  it('keeps the triggering flow successful when the receiver fails (FR-MOD-09.4)', async () => {
    await connectZapier();
    const registration = await subscribe({
      url: RECEIVER,
      action: 'chat_started',
      app_id: ZAPIER,
    });
    status = 500;

    // The chat still opens. That is the contract: the visitor is waiting, and a
    // third party having a bad minute is not their problem.
    const chatId = await startChat();
    expect(chatId).toBeTruthy();
    expect(received).toHaveLength(1);

    // And the failure is recorded rather than swallowed silently: one attempt
    // inside the request, left `pending` for the scheduled sweep to carry on.
    const attempts = await owner.webhookDelivery.findMany({
      where: { webhookId: registration.id },
      orderBy: { attempt: 'asc' },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.ok).toBe(false);
    expect(attempts[0]!.statusCode).toBe(500);
    expect(attempts[0]!.state).toBe('pending');
    expect(attempts[0]!.nextAttemptAt).not.toBeNull();
  });

  // --- The card's figures are read, not invented -----------------------------

  it('reads the card’s trigger count and last run from the registry (FR-MOD-09.4)', async () => {
    await connectZapier();

    // Connected, nothing wired: an honest zero, and no run to report. This is
    // the figure that used to be drawn from a fixed option list.
    const fresh = await card(ZAPIER);
    expect(fresh.installation?.automation).toEqual({ triggers: 0, last_run_at: null });

    await subscribe({ url: RECEIVER, action: 'chat_started', app_id: ZAPIER });

    // One trigger registered, still nothing delivered — the two figures are
    // independent, and a card with a zap wired but no run yet must say so.
    const wired = await card(ZAPIER);
    expect(wired.installation?.automation?.triggers).toBe(1);
    expect(wired.installation?.automation?.last_run_at).toBeNull();

    await startChat();

    const ran = await card(ZAPIER);
    expect(ran.installation?.automation?.triggers).toBe(1);
    expect(ran.installation?.automation?.last_run_at).not.toBeNull();
  });

  it('surfaces those same figures in-chat instead of a plausible constant (FR-MOD-09.4)', async () => {
    await connectZapier();
    const chatId = await startChat();

    const before = await server.get(`/chats/${chatId}/apps`, auth());
    expect(before.statusCode).toBe(200);
    const zeroed = (
      before.json() as {
        items: Array<{ app_id: string; fields: Array<{ label: string; value: string }> }>;
      }
    ).items.find((item) => item.app_id === ZAPIER);
    expect(zeroed?.fields).toEqual([
      { label: 'Active zaps', value: '0' },
      { label: 'Last zap run', value: 'Never run' },
    ]);

    await subscribe({ url: RECEIVER, action: 'chat_started', app_id: ZAPIER });

    const after = await server.get(`/chats/${chatId}/apps`, auth());
    const counted = (
      after.json() as {
        items: Array<{ app_id: string; fields: Array<{ label: string; value: string }> }>;
      }
    ).items.find((item) => item.app_id === ZAPIER);
    expect(counted?.fields[0]).toEqual({ label: 'Active zaps', value: '1' });
  });

  // --- Isolation -------------------------------------------------------------

  it('never delivers one workspace’s event to another’s zap (NFR-S5 · FR-MOD-09.4)', async () => {
    await connectZapier();
    await subscribe({ url: RECEIVER, action: 'chat_started', app_id: ZAPIER });

    // Tenant B opens a chat of its own. Its licence has no subscription, and
    // A's row is invisible to it under RLS.
    const tokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
    const response = await server.post(
      '/chats',
      { customer_id: fx.b.customerId },
      { authorization: `Bearer ${tokenB}` },
    );
    expect(response.statusCode).toBe(201);

    expect(received).toEqual([]);
  });
});
