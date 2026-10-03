/**
 * The public pilot has no Apps marketplace and no sample data (tm 257.18 · ADR
 * docs/adr/pilot-public-readiness.md K-d).
 *
 * The marketplace is mock all the way down: 46 cards "connect" through an OAuth
 * flow whose code the client invents, 52 hash an API key nothing ever uses, and
 * a connected card shows deterministic made-up fields about a real customer in
 * the Details panel. `POST /onboarding/seed-demo` writes invented rows into a
 * real workspace. With `PILOT_MODE=true` the four marketplace writes and the
 * seed are refused at the pilot gate; the two reads answer with nothing rather
 * than 403, because Developers → Webhook subscriptions lists
 * `?category=productivity` for its app picker and the Details panel reads
 * `/chats/:id/apps` for every open conversation — neither may break.
 *
 * Every refusal is paired with its twin on an ordinary deployment, where the
 * same request reaches the handler. The flag-off behaviour itself is pinned by
 * `apps` and `onboarding`, which are untouched.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PILOT = { PILOT_MODE: 'true', PILOT_CONTACT_EMAIL: 'pilot-contact@example.test' };
const ORDINARY = { PILOT_MODE: 'false' };

const OAUTH_APP = 'hubspot';
const KEY_APP = 'zendesk';
const API_KEY = 'zd-live-never-logged-2f9c41';

function expectPilotRefusal(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(403);
  const { error } = response.json();
  expect(error.type).toBe('not_allowed');
  expect(error.details).toStrictEqual({ reason: 'pilot_mode' });
}

describe('pilot mode: Apps marketplace and sample data (tm 257.18)', () => {
  let owner: PrismaClient;
  let pilot: TestServer;
  let ordinary: TestServer;
  let fx: Fixtures;
  let token: string;

  const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

  /** Everything the refused writes could have touched. */
  async function state(licenseId: bigint) {
    const [installations, audit, canned, tags, chats, customers, flags] = await Promise.all([
      owner.appInstallation.findMany({ where: { licenseId }, orderBy: { appId: 'asc' } }),
      owner.auditLogEntry.count({ where: { licenseId } }),
      owner.cannedResponse.count({ where: { licenseId } }),
      owner.tag.count({ where: { licenseId } }),
      owner.chat.count({ where: { licenseId } }),
      owner.customer.count({ where: { organizationId: fx.a.organizationId } }),
      owner.license.findUnique({ where: { id: licenseId }, select: { demoSeededAt: true } }),
    ]);
    return { installations, audit, canned, tags, chats, customers, flags };
  }

  beforeAll(async () => {
    owner = ownerClient();
    [pilot, ordinary] = await Promise.all([startTestServer(PILOT), startTestServer(ORDINARY)]);
  });

  afterAll(async () => {
    await Promise.all([pilot.close(), ordinary.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await Promise.all([clearRateLimits(pilot.app), clearRateLimits(ordinary.app)]);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw', 'properties.configuration:rw'],
    });
  });

  describe('the marketplace writes', () => {
    it('refuses OAuth start and callback — with an empty body or a plausible one', async () => {
      const before = await state(fx.a.licenseId);
      expectPilotRefusal(await pilot.post(`/settings/apps/${OAUTH_APP}/oauth/start`, {}, auth()));
      expectPilotRefusal(
        await pilot.post(`/settings/apps/${OAUTH_APP}/oauth/callback`, {}, auth()),
      );
      expectPilotRefusal(
        await pilot.post(
          `/settings/apps/${OAUTH_APP}/oauth/callback`,
          { state: 'x.y', code: 'mock-auth-code' },
          auth(),
        ),
      );
      expect(await state(fx.a.licenseId)).toStrictEqual(before);
    });

    it('refuses the API-key connect and stores no hash', async () => {
      const before = await state(fx.a.licenseId);
      expectPilotRefusal(await pilot.post(`/settings/apps/${KEY_APP}/connect`, {}, auth()));
      expectPilotRefusal(
        await pilot.post(`/settings/apps/${KEY_APP}/connect`, { api_key: API_KEY }, auth()),
      );
      expect(await state(fx.a.licenseId)).toStrictEqual(before);
    });

    it('refuses a disconnect — a connection made before the flag is left as it was', async () => {
      await owner.appInstallation.create({
        data: { licenseId: fx.a.licenseId, appId: OAUTH_APP, externalAccount: 'acct_before' },
      });
      const before = await state(fx.a.licenseId);
      expectPilotRefusal(await pilot.del(`/settings/apps/${OAUTH_APP}`, auth()));
      expect(await state(fx.a.licenseId)).toStrictEqual(before);
    });

    it('answers before the body is read: a malformed body gets the 403, not a 400', async () => {
      const response = await pilot.app.inject({
        method: 'POST',
        url: pilot.url(`/settings/apps/${OAUTH_APP}/oauth/callback`),
        headers: { ...auth(), 'content-type': 'application/json' },
        payload: '{not json',
      });
      expectPilotRefusal(response);
    });

    it('the same requests reach the handler on an ordinary deployment', async () => {
      const started = await ordinary.post(`/settings/apps/${OAUTH_APP}/oauth/start`, {}, auth());
      expect(started.statusCode).toBe(200);
      const connected = await ordinary.post(
        `/settings/apps/${KEY_APP}/connect`,
        { api_key: API_KEY },
        auth(),
      );
      expect(connected.statusCode).toBe(200);
      expect((await ordinary.del(`/settings/apps/${KEY_APP}`, auth())).statusCode).toBe(204);
    });
  });

  describe('the reads answer with nothing, not with a refusal', () => {
    it('lists no apps — with or without the category the webhook picker asks for', async () => {
      for (const query of ['', '?category=productivity', '?limit=5&query=hub']) {
        const response = await pilot.get(`/settings/apps${query}`, auth());
        expect(response.statusCode).toBe(200);
        expect(response.json()).toStrictEqual({ items: [], total: 0 });
      }
      // The twin: the catalogue is there on an ordinary deployment.
      const twin = await ordinary.get('/settings/apps?category=productivity', auth());
      expect(twin.statusCode).toBe(200);
      expect(twin.json().total).toBeGreaterThan(0);
    });

    it('shows no app data in a conversation, even for a connection made before the flag', async () => {
      await owner.appInstallation.create({
        data: { licenseId: fx.a.licenseId, appId: OAUTH_APP, externalAccount: 'acct_before' },
      });
      const opened = await ordinary.post('/chats', { customer_id: fx.a.customerId }, auth());
      expect([200, 201]).toContain(opened.statusCode);
      const chatId = (opened.json() as { id: string }).id;

      const response = await pilot.get(`/chats/${chatId}/apps`, auth());
      expect(response.statusCode).toBe(200);
      expect(response.json()).toStrictEqual({ items: [] });

      const twin = await ordinary.get(`/chats/${chatId}/apps`, auth());
      expect(twin.statusCode).toBe(200);
      expect(twin.json().items.length).toBeGreaterThan(0);
    });
  });

  describe('sample data', () => {
    it('refuses POST /onboarding/seed-demo and writes no row', async () => {
      const before = await state(fx.a.licenseId);
      expectPilotRefusal(await pilot.post('/onboarding/seed-demo', undefined, auth()));
      expectPilotRefusal(await pilot.post('/onboarding/seed-demo', {}, auth()));
      expect(await state(fx.a.licenseId)).toStrictEqual(before);
      expect(before.flags?.demoSeededAt).toBeNull();
    });

    it('seeds on an ordinary deployment', async () => {
      const response = await ordinary.post('/onboarding/seed-demo', undefined, auth());
      expect(response.statusCode).toBe(200);
      expect(response.json().seeded).toBe(true);
    });
  });
});
