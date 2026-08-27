/**
 * What the trusted proxy hop count does to an authorization decision
 * (M-PROD-CFG-b).
 *
 * `request.ip` is not a log field. It is the anonymous rate-limit bucket
 * (`plugins/rate-limit.ts`), the customer IP ban (`lib/banned-ip.ts`) and the
 * agent IP allow-list (FR-MOD-08.9.6, `plugins/auth.ts`). It is derived from
 * `X-Forwarded-For` by counting hops in from the right, and until this slice the
 * count was the literal `1` in `server.ts` under a comment that *declared* the
 * assumption it rested on: "the API is reached through exactly one trusted
 * reverse proxy". A deployment that puts a CDN in front of an ingress has two,
 * and could not say so.
 *
 * Both ways of being wrong are silent, and this file makes both of them visible
 * against a real allow-list rather than against `request.ip` in isolation:
 *
 *   too high — proxy-addr walks past the hops that really exist and returns an
 *     entry the *caller* wrote. An attacker prepends an allow-listed address and
 *     walks through the gate. This is the one that matters.
 *   too low  — every request appears to come from our own proxy, so an allowed
 *     client is refused and a banned one is not. The allow-list still runs; it
 *     just decides about the wrong address.
 *
 * The topology below is fixed and real: a customer's browser reaches an edge
 * (CDN), which reaches an ingress, which reaches this process. Two hops append
 * to the header, so `TRUST_PROXY_HOPS=2` is the correct value and every other
 * value in this file is a deployment mistake being measured.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Inside the range the workspace allow-lists. */
const ALLOWED = '203.0.113.9';
/** Where the caller really is. Nothing on the list covers it. */
const CLIENT = '198.51.100.7';
/** The outer hop — a CDN edge. It appends the client. */
const EDGE = '192.0.2.10';
/** What `app.inject` gives as the socket peer: the inner hop, our own ingress. */
const SOCKET = '127.0.0.1';

/**
 * The header as it arrives after two honest hops.
 *
 * The edge appends whoever connected to it; the ingress appends the edge. So the
 * right-most entry is always the address our innermost proxy attested, and the
 * one before it is the address the edge attested — the client.
 */
const forwarded = (...prepended: string[]): string => [...prepended, EDGE].join(', ');

describe('trusted proxy hops (TRUST_PROXY_HOPS)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;
  let agentToken: string;

  /** One server per hop count, so a single request can be asked of each. */
  const servers = new Map<string, TestServer>();
  const HOP_COUNTS = ['0', '1', '2', '3'] as const;
  const at = (hops: (typeof HOP_COUNTS)[number]): TestServer => servers.get(hops)!;

  const auth = () => ({ authorization: `Bearer ${agentToken}` });
  const from = (chain: string) => ({ ...auth(), 'x-forwarded-for': chain });

  /** Switch enforcement on for a tenant and seed its list, as tm 08.9.6-e's own suite does. */
  async function enforce(tenant: TenantFixture, entries: string[]): Promise<void> {
    const brand = await owner.brand.findFirstOrThrow({
      where: { licenseId: tenant.licenseId, isDefault: true },
      select: { id: true },
    });
    await owner.securitySettings.upsert({
      where: { licenseId_brandId: { licenseId: tenant.licenseId, brandId: brand.id } },
      create: { licenseId: tenant.licenseId, brandId: brand.id, ipAllowlistEnforced: true },
      update: { ipAllowlistEnforced: true },
    });
    for (const entry of entries) {
      await owner.ipAllowlistEntry.create({
        data: { organizationId: tenant.organizationId, licenseId: tenant.licenseId, entry },
      });
    }
  }

  beforeAll(async () => {
    owner = ownerClient();
    for (const hops of HOP_COUNTS) {
      servers.set(hops, await startTestServer({ TRUST_PROXY_HOPS: hops }));
    }
  });

  afterAll(async () => {
    await Promise.all([...servers.values()].map((server) => server.close()));
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await seedDefaultBrand(owner, fx.a.licenseId);
    await Promise.all([...servers.values()].map((server) => clearRateLimits(server.app)));
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    });
  });

  // --- Too many hops: the bypass ---------------------------------------------

  it('lets a caller name their own address once the count exceeds the real hops', async () => {
    // The finding, reproduced. Three trusted hops in a two-hop deployment means
    // proxy-addr steps one entry too far left — onto the value the client wrote
    // — and the allow-list happily matches it. Nothing logs a warning; the
    // request is simply allowed.
    await enforce(fx.a, ['203.0.113.0/24']);

    const res = await at('3').get('/auth/me', from(forwarded(ALLOWED, CLIENT)));

    expect(res.statusCode).toBe(200);
  });

  it('refuses that same spoofed chain at the correct count', async () => {
    // Identical request, identical workspace, one environment variable apart.
    // Two hops stops on the address the edge attested — the real client — so the
    // prepended value is never read.
    await enforce(fx.a, ['203.0.113.0/24']);

    const res = await at('2').get('/auth/me', from(forwarded(ALLOWED, CLIENT)));

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { type: string } }).error.type).toBe('not_allowed');
  });

  it('still admits the genuine client at the correct count — the gate is narrowed, not broken', async () => {
    // Without this the test above would pass just as well if two hops refused
    // everybody, and "refuses the spoof" would mean nothing.
    await enforce(fx.a, ['203.0.113.0/24']);

    const res = await at('2').get('/auth/me', from(forwarded(ALLOWED)));

    expect(res.statusCode).toBe(200);
  });

  // --- Too few hops: every caller becomes the proxy ---------------------------

  it('collapses every caller onto our own proxy when the count is short', async () => {
    // One hop in a two-hop deployment: `request.ip` is the edge, for everyone.
    // A workspace with an allow-list locks out its own agents — and, on the
    // surfaces that ban rather than allow, one abusive visitor would take the
    // whole edge with them.
    await enforce(fx.a, ['203.0.113.0/24']);

    const allowedClient = await at('1').get('/auth/me', from(forwarded(ALLOWED)));
    expect(allowedClient.statusCode).toBe(403);

    // And the mirror: the address it actually decided about is the edge's.
    await owner.ipAllowlistEntry.create({
      data: {
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        entry: `${EDGE}/32`,
      },
    });
    const anybody = await at('1').get('/auth/me', from(forwarded(CLIENT)));
    expect(anybody.statusCode).toBe(200);
  });

  // --- Zero hops: a process reached directly ---------------------------------

  it('ignores the header entirely at zero, believing only the socket', async () => {
    // The right value for a process nothing sits in front of. Fastify skips the
    // proxy decoration altogether, so `request.ip` is the peer — and a caller
    // who writes an allow-listed address into the header gets nowhere.
    await enforce(fx.a, ['203.0.113.0/24']);

    const spoofed = await at('0').get('/auth/me', from(forwarded(ALLOWED, CLIENT)));
    expect(spoofed.statusCode).toBe(403);

    // Not "denies everything": the peer address is what it reads, and it admits
    // the peer. Same request, same hostile header, one allow-list entry apart.
    await owner.ipAllowlistEntry.create({
      data: {
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        entry: `${SOCKET}/32`,
      },
    });
    const peer = await at('0').get('/auth/me', from(forwarded(ALLOWED, CLIENT)));
    expect(peer.statusCode).toBe(200);
  });

  // --- The default ------------------------------------------------------------

  it('defaults to one hop, so the behaviour every other suite pins is unchanged', async () => {
    // `ip-allowlist.test.ts` reads the right-most forwarded entry as the client
    // and nothing in this slice may move that: the default is the deployment the
    // hard-coded `1` described, and an unset variable has to reproduce it.
    await enforce(fx.a, ['203.0.113.0/24']);
    const unset = await startTestServer();
    try {
      await clearRateLimits(unset.app);
      const rightMostAllowed = await unset.get('/auth/me', {
        ...auth(),
        'x-forwarded-for': `${CLIENT}, ${ALLOWED}`,
      });
      expect(rightMostAllowed.statusCode).toBe(200);

      const rightMostDenied = await unset.get('/auth/me', {
        ...auth(),
        'x-forwarded-for': `${ALLOWED}, ${CLIENT}`,
      });
      expect(rightMostDenied.statusCode).toBe(403);
    } finally {
      await unset.close();
    }
  });
});
