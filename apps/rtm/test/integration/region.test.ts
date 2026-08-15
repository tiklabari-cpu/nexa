/**
 * Data residency on the socket (NFR-C4 · C4-b).
 *
 * The API refuses a misdirected request at its own edge. That is worth nothing
 * on its own: the gateway is a *separate process*, and a workspace whose REST
 * calls are being turned away while its socket keeps streaming events is a
 * workspace whose data is still leaving its region — over the connection that
 * carries every message, no less. So the same rule is proved here, against a
 * real gateway, and separately from the API's suite rather than by assuming the
 * two share code.
 *
 * The lever is `NEXA_REGION`: the harness starts a second gateway configured
 * for `us` against the same fixtures, which is exactly what a US deployment is.
 * The tokens are unchanged — the same credential is accepted at one door and
 * refused at the other, which is the property.
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  customerToken,
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';

describe('region enforcement (C4-b)', () => {
  let db: PrismaClient;
  /** The gateway every other suite runs: `NEXA_REGION` defaults to `eu`. */
  let eu: Awaited<ReturnType<typeof startRtm>>;
  /** The same build, configured as a US deployment. */
  let us: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  const customerSecret = process.env['CUSTOMER_TOKEN_SECRET'] ?? '';

  const sockets: TestSocket[] = [];

  beforeAll(async () => {
    db = ownerClient();
    eu = await startRtm({ NEXA_REGION: 'eu' });
    us = await startRtm({ NEXA_REGION: 'us' });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await Promise.all([eu.close(), us.close()]);
    await db.$disconnect();
  });

  beforeEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    fx = await seedRtmFixtures(db);
  });

  async function connect(
    gateway: { port: number },
    tenant: { organizationId: string },
    side: 'agent' | 'customer' = 'agent',
  ) {
    const socket = await TestSocket.connect(gateway.port, {
      organizationId: tenant.organizationId,
      side,
    });
    sockets.push(socket);
    return socket;
  }

  async function agentLogin(gateway: { port: number }, tenant: RtmTenant) {
    const token = await grantToken(db, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.agentAccountId,
      scopes: ['chats--access:rw'],
    });
    const socket = await connect(gateway, tenant);
    return socket.request('login', { token: `Bearer ${token}` });
  }

  /**
   * A workspace that genuinely lives in `us`, built here rather than in the
   * shared fixtures: the production direction of this rule is a US workspace
   * arriving at a European gateway, and a suite that only ever moved the
   * *gateway* would never test it.
   */
  async function seedUsTenant(): Promise<{ tenant: RtmTenant; token: string }> {
    const organization = await db.organization.create({
      data: { name: `Org us ${randomUUID().slice(0, 8)}`, region: 'us' },
      select: { id: true },
    });
    const license = await db.license.create({
      data: { organizationId: organization.id },
      select: { id: true },
    });
    const account = await db.account.create({
      data: { email: `agent-us-${randomUUID()}@example.test`, name: 'US agent' },
      select: { id: true },
    });
    await db.agentMembership.create({
      data: {
        licenseId: license.id,
        agentId: account.id,
        role: 'owner',
        routingStatus: 'accepting_chats',
      },
    });
    const customer = await db.customer.create({
      data: { organizationId: organization.id, name: 'US customer' },
      select: { id: true },
    });

    const raw = `test_${randomUUID()}`;
    await db.apiToken.create({
      data: {
        licenseId: license.id,
        organizationId: organization.id,
        ownerId: account.id,
        kind: 'pat',
        tokenHash: createHash('sha256').update(raw, 'utf8').digest('base64url'),
        scopes: ['chats--access:rw'],
      },
    });

    return {
      tenant: {
        organizationId: organization.id,
        licenseId: license.id,
        ownerAccountId: account.id,
        agentAccountId: account.id,
        outsiderAccountId: account.id,
        supportGroupId: 0n,
        salesGroupId: 0n,
        customerId: customer.id,
      },
      token: raw,
    };
  }

  // =========================================================================
  // Agents
  // =========================================================================

  describe('agent login', () => {
    it('refuses a token whose workspace lives in another region', async () => {
      const response = await agentLogin(us, fx.a);

      expect(response.success).toBe(false);
      const error = response.payload['error'] as { type: string; details?: { region?: string } };
      // Not `authentication`: the token is genuine, and answering as if it were
      // not would send a correctly configured client hunting for a credential
      // problem it does not have.
      expect(error.type).toBe('misdirected_request');
      // The workspace's region, so the client knows which gateway is theirs.
      expect(error.details?.region).toBe('eu');
    });

    it('accepts the very same token at the gateway that serves its region', async () => {
      // The pair matters more than either half: it is what shows the refusal is
      // about *where*, not about the credential.
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
      });

      const refused = await (await connect(us, fx.a)).request('login', { token });
      expect(refused.success).toBe(false);

      const accepted = await (await connect(eu, fx.a)).request('login', { token });
      expect(accepted.success).toBe(true);
    });

    it('refuses a US workspace at the European gateway', async () => {
      const { tenant, token } = await seedUsTenant();

      const socket = await connect(eu, tenant);
      const response = await socket.request('login', { token });

      expect(response.success).toBe(false);
      const error = response.payload['error'] as { type: string; details?: { region?: string } };
      expect(error.type).toBe('misdirected_request');
      expect(error.details?.region).toBe('us');
    });

    it('leaves the socket unauthenticated, so nothing else can be sent', async () => {
      // A refused login must not half-succeed. `subscribe` is the cheapest proof
      // that the connection never entered the authenticated state.
      const socket = await connect(us, fx.a);
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
      });
      await socket.request('login', { token });

      const subscribe = await socket.request('subscribe', { pushes: { '3.6': ['incoming_chat'] } });
      expect(subscribe.success).toBe(false);
      expect((subscribe.payload['error'] as { type: string }).type).toBe('authentication');
    });

    it('still refuses a token from another tenant, region or not', async () => {
      // Residency is a new gate, not a replacement for the old one: tenant B's
      // token on tenant A's socket stays undifferentiated, at the gateway that
      // serves both.
      const token = await grantToken(db, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.agentAccountId,
        scopes: ['chats--access:rw'],
      });

      const socket = await connect(eu, fx.a);
      const response = await socket.request('login', { token });

      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('authentication');
    });
  });

  // =========================================================================
  // Visitors
  // =========================================================================

  describe('customer login', () => {
    it('refuses a customer token minted for another region', async () => {
      const token = customerToken({
        customerId: fx.a.customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        secret: customerSecret,
        region: 'eu',
      });

      const socket = await connect(us, fx.a, 'customer');
      const response = await socket.request('login', { token });

      expect(response.success).toBe(false);
      const error = response.payload['error'] as { type: string; details?: { region?: string } };
      expect(error.type).toBe('misdirected_request');
      expect(error.details?.region).toBe('eu');
    });

    it('accepts it at the gateway its region names', async () => {
      const token = customerToken({
        customerId: fx.a.customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        secret: customerSecret,
        region: 'eu',
      });

      const socket = await connect(eu, fx.a, 'customer');
      const response = await socket.request('login', { token });
      expect(response.success).toBe(true);
    });

    it('refuses a token with no region claim at all', async () => {
      // Every customer token minted before C4-b. Read as "must be local" it
      // would sail through the gate this suite exists to prove; the claim is
      // required, and these expire within the token TTL.
      const token = customerToken({
        customerId: fx.a.customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        secret: customerSecret,
        region: null,
      });

      const socket = await connect(eu, fx.a, 'customer');
      const response = await socket.request('login', { token });

      expect(response.success).toBe(false);
      // Malformed, not misdirected: a token that says nothing about where it
      // belongs is not a token that ended up at the wrong door — it is one this
      // gateway cannot reason about at all, so it says as little as possible.
      expect((response.payload['error'] as { type: string }).type).toBe('authentication');
    });

    it('cannot have its region rewritten by the holder', async () => {
      // `rgn` is inside the HMAC. Editing it to name the gateway that happens to
      // have been reached breaks the signature instead of passing the gate.
      const minted = customerToken({
        customerId: fx.a.customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        secret: customerSecret,
        region: 'eu',
      });
      const [prefix, body, signature] = minted.split('.');
      const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      payload['rgn'] = 'us';
      const edited = Buffer.from(JSON.stringify(payload)).toString('base64url');

      const socket = await connect(us, fx.a, 'customer');
      const response = await socket.request('login', { token: `${prefix}.${edited}.${signature}` });

      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('authentication');
    });
  });
});
