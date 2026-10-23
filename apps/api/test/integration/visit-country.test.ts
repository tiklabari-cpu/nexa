/**
 * A widget visitor's country, from their address, inside the API (GEOIP-COUNTRY ·
 * tm 330 · SiyahTuş analysis IN-02, EN-03, AU-02).
 *
 *   - the token mint fills the contact's empty country, so a campaign or a
 *     routing rule can read it before the visitor writes anything (EN-03);
 *   - the page that starts a visit records country and city on the visit, and
 *     the Details panel's visit info carries them (IN-02-S1: no map);
 *   - a known country is never overwritten, a visit is located once rather
 *     than on every page, and an address the database does not hold changes
 *     nothing and fails nothing.
 *
 * The locator is the tests' fixed table (`StaticGeoLocator`): no file, no
 * network. The client address is set at the socket (`remoteAddress`), the way
 * a visitor's arrives.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StaticGeoLocator } from '../../src/services/geo/geo-locator.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ISTANBUL = '81.214.10.20';
const BERLIN = '5.9.200.1';
const UNKNOWN = '198.51.100.23';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('visitor country from the address (GEOIP-COUNTRY · tm 330)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  const geo = new StaticGeoLocator({
    [ISTANBUL]: { countryCode: 'TR', city: 'Istanbul' },
    [BERLIN]: { countryCode: 'DE', city: 'Berlin' },
  });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { geo });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    geo.calls.length = 0;

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
  });

  /** One request from `ip`, settled the way `server.post` settles its own. */
  async function from(
    ip: string,
    method: 'GET' | 'POST',
    path: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    const response = await server.app.inject({
      method,
      url: server.url(path),
      headers,
      remoteAddress: ip,
      ...(payload ? { payload } : {}),
    });
    await server.app.aiJobs.idle();
    await server.app.aiUsageAlerts.idle();
    await server.app.riskFlags.idle();
    return response;
  }

  async function mint(ip: string, memberToken?: string) {
    const host = `https://${fx.a.trustedDomain}`;
    const response = await from(
      ip,
      'POST',
      '/customer/token',
      {
        organization_id: fx.a.organizationId,
        host_origin: host,
        ...(memberToken ? { member_token: memberToken } : {}),
      },
      { origin: host },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string; member_token: string };
  }

  const send = (ip: string, token: string, url: string) =>
    from(ip, 'POST', '/customer/chat/events', { text: 'Para yatırma', url }, auth(token));

  const countryOf = async (customerId: string) =>
    (await owner.customer.findUniqueOrThrow({ where: { id: customerId } })).countryCode;

  const visitsOf = (customerId: string) =>
    owner.visit.findMany({
      where: { customerId },
      select: { countryCode: true, city: true, pages: true },
    });

  it('fills the contact country at mint, before the visitor writes anything (EN-03)', async () => {
    const { customer_id } = await mint(ISTANBUL);

    expect(await countryOf(customer_id)).toBe('TR');
    // Nothing else was written: the mint opens no visit.
    expect(await visitsOf(customer_id)).toEqual([]);
  });

  it('records country and city on the visit and shows them in visit info (FR-MOD-02.4.1–.6)', async () => {
    const { token, customer_id } = await mint(ISTANBUL);
    const response = await send(ISTANBUL, token, 'https://shop.example/deposit');
    expect(response.statusCode).toBe(201);

    const visits = await visitsOf(customer_id);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ countryCode: 'TR', city: 'Istanbul' });

    const chat = await owner.chat.findFirstOrThrow({ where: { customerId: customer_id } });
    const detail = await server.get(`/chats/${chat.id}`, auth(agentToken));
    expect(detail.statusCode).toBe(200);
    expect(detail.json().visitor.visit_info).toMatchObject({
      country_code: 'TR',
      city: 'Istanbul',
    });
  });

  it('locates a visit once: later pages of it neither look up nor rewrite', async () => {
    const { token, customer_id } = await mint(ISTANBUL);
    await send(ISTANBUL, token, 'https://shop.example/deposit');
    const lookupsAfterStart = geo.calls.length;

    // The same visit, a different address (a phone moving between networks).
    const second = await send(BERLIN, token, 'https://shop.example/withdraw');
    expect(second.statusCode).toBe(201);

    expect(geo.calls.length).toBe(lookupsAfterStart);
    const visits = await visitsOf(customer_id);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ countryCode: 'TR', city: 'Istanbul' });
    expect((visits[0]!.pages as Array<{ url: string }>).map((p) => p.url)).toEqual([
      'https://shop.example/deposit',
      'https://shop.example/withdraw',
    ]);
  });

  it('never overwrites a country the contact already has', async () => {
    const first = await mint(ISTANBUL);
    expect(await countryOf(first.customer_id)).toBe('TR');

    // The same member, back from another country: the token names them.
    const again = await mint(BERLIN, first.member_token);
    expect(again.customer_id).toBe(first.customer_id);
    expect(await countryOf(first.customer_id)).toBe('TR');

    // A country typed by an agent is not replaced by a visit either.
    const typed = await mint(UNKNOWN);
    await owner.customer.update({ where: { id: typed.customer_id }, data: { countryCode: 'GB' } });
    await send(BERLIN, typed.token, 'https://shop.example/');
    expect(await countryOf(typed.customer_id)).toBe('GB');
    // The visit still records where this visit came from.
    expect((await visitsOf(typed.customer_id))[0]).toMatchObject({
      countryCode: 'DE',
      city: 'Berlin',
    });
  });

  it('leaves everything empty, and fails nothing, for an address the database does not hold', async () => {
    const { token, customer_id } = await mint(UNKNOWN);
    expect(await countryOf(customer_id)).toBeNull();

    const response = await send(UNKNOWN, token, 'https://shop.example/');
    expect(response.statusCode).toBe(201);
    expect((await visitsOf(customer_id))[0]).toMatchObject({ countryCode: null, city: null });
  });

  it('keeps the answer, not the question: no contact column holds the address', async () => {
    const { customer_id } = await mint(ISTANBUL);
    const row = await owner.customer.findUniqueOrThrow({ where: { id: customer_id } });
    expect(
      JSON.stringify(row, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toContain(ISTANBUL);
  });
});
