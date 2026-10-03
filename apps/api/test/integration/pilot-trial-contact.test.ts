/**
 * What a workspace is told when its trial runs out in the public pilot (tm 257.15
 * · ADR docs/adr/pilot-public-readiness.md K-d §3.1).
 *
 * Two API halves of one fix. `GET /auth/me` now carries `license: { access,
 * trial_ends_at }` for every role — the trial strip used to read
 * `/billing/subscription`, which sits behind a billing scope an agent does not
 * have, so an agent never saw it. And the 402 an expired workspace's writes get
 * says `details.reason: 'pilot_trial_ended'` on a pilot deployment, which is
 * what lets the panel stop telling people to subscribe to something that is
 * not on sale there. On every other deployment that 402 is byte-for-byte what
 * it always was; `reports-billing.test.ts` pins that, unchanged.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PILOT = { PILOT_MODE: 'true', PILOT_CONTACT_EMAIL: 'pilot-contact@example.test' };
const ORDINARY = { PILOT_MODE: 'false' };

const DAY = 86_400_000;

describe('trial state for every role, and the pilot read-only refusal (tm 257.15)', () => {
  let owner: PrismaClient;
  let pilot: TestServer;
  let ordinary: TestServer;
  let fx: Fixtures;
  let ownerAuth: Record<string, string>;
  let agentAuth: Record<string, string>;

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
    const ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'reports_read', 'billing_manage'],
    });
    // No billing scope at all: the caller `/billing/subscription` turns away.
    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
    ownerAuth = { authorization: `Bearer ${ownerToken}` };
    agentAuth = { authorization: `Bearer ${agentToken}` };
  });

  const setTrialEnd = (endsAt: Date): Promise<unknown> =>
    owner.license.update({ where: { id: fx.a.licenseId }, data: { trialEndsAt: endsAt } });

  /** The checklist's hand activation: the licence leaves the trial. */
  const activateByHand = (): Promise<number> =>
    owner.$executeRaw`
      UPDATE licenses SET status = 'active', trial_ends_at = NULL WHERE id = ${fx.a.licenseId}`;

  describe('GET /auth/me → license', () => {
    it('reports a running trial to an agent and to an owner, with its end date', async () => {
      const endsAt = new Date(Date.now() + 9 * DAY);
      await setTrialEnd(endsAt);

      for (const [server, auth] of [
        [ordinary, agentAuth],
        [ordinary, ownerAuth],
        [pilot, agentAuth],
        [pilot, ownerAuth],
      ] as const) {
        const me = (await server.get('/auth/me', auth)).json();
        expect(me.license).toStrictEqual({
          access: 'trialing',
          trial_ends_at: endsAt.toISOString(),
        });
      }
    });

    it('reports an expired trial as read_only, to an agent as to an owner', async () => {
      const endsAt = new Date(Date.now() - DAY);
      await setTrialEnd(endsAt);

      for (const auth of [agentAuth, ownerAuth]) {
        const me = (await pilot.get('/auth/me', auth)).json();
        expect(me.license).toStrictEqual({
          access: 'read_only',
          trial_ends_at: endsAt.toISOString(),
        });
      }
    });

    it('reports an activated workspace as active, with no end date', async () => {
      await activateByHand();

      for (const auth of [agentAuth, ownerAuth]) {
        const me = (await pilot.get('/auth/me', auth)).json();
        expect(me.license).toStrictEqual({ access: 'active', trial_ends_at: null });
      }
    });

    it('is what the billing scope guards: the agent cannot read the subscription, but learns the state here', async () => {
      await setTrialEnd(new Date(Date.now() - DAY));

      expect((await pilot.get('/billing/subscription', agentAuth)).statusCode).toBe(403);
      expect((await pilot.get('/auth/me', agentAuth)).json().license.access).toBe('read_only');
    });

    it('agrees with GET /billing/subscription for the caller who can read both', async () => {
      await setTrialEnd(new Date(Date.now() - DAY));

      const subscription = (await ordinary.get('/billing/subscription', ownerAuth)).json();
      const me = (await ordinary.get('/auth/me', ownerAuth)).json();
      expect(me.license.access).toBe(subscription.access);
    });
  });

  describe('the 402 a read-only workspace gets on a write', () => {
    const write = (server: TestServer, auth: Record<string, string>) =>
      server.post('/chats', { customer_id: fx.a.customerId }, auth);

    it('names the pilot trial on a pilot deployment — for an agent and for an owner', async () => {
      await setTrialEnd(new Date(Date.now() - DAY));

      for (const auth of [agentAuth, ownerAuth]) {
        const response = await write(pilot, auth);
        expect(response.statusCode).toBe(402);
        const { error } = response.json();
        expect(error.type).toBe('license_expired');
        expect(error.details).toStrictEqual({ access: 'read_only', reason: 'pilot_trial_ended' });
        // Nothing to subscribe to, so the sentence does not say to.
        expect(error.message).not.toMatch(/subscribe/i);
      }
    });

    it('is unchanged on an ordinary deployment: details are only { access }', async () => {
      await setTrialEnd(new Date(Date.now() - DAY));

      const response = await write(ordinary, ownerAuth);
      expect(response.statusCode).toBe(402);
      const { error } = response.json();
      expect(error.type).toBe('license_expired');
      expect(error.details).toStrictEqual({ access: 'read_only' });
      expect(error.message).toMatch(/subscribe/i);
    });

    it('does not fire while the trial runs, pilot or not', async () => {
      await setTrialEnd(new Date(Date.now() + 5 * DAY));

      expect((await write(pilot, ownerAuth)).statusCode).not.toBe(402);
      expect((await write(ordinary, ownerAuth)).statusCode).not.toBe(402);
    });
  });
});
