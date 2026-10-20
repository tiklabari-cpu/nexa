/**
 * The brand a member came in through — `chats.brand_id` (tm 309.1 · SiyahTuş
 * analysis AI-14 · `docs/adr/single-knowledge-store.md` §2.4).
 *
 * The knowledge filter (tm 309.2) answers a chat from its brand's sources and
 * the every-brand ones, so a chat's brand has to be the brand the member is
 * really talking through, and nothing when that is not one brand. Its single
 * definition, pinned here:
 *
 *   - the chat a visitor's message opens is the brand of the site the widget
 *     runs on — the brand its token was minted for (WG-01
 *     `resolveWidgetBrandId`: the website registered for the host, else the
 *     licence's default);
 *   - a connection that comes into the day's chat through another brand's site
 *     — or one whose brand is unknown — leaves the chat with no brand, for good;
 *   - an agent's own start names no brand; an agent reopening an earlier day
 *     brings that day's brand along;
 *   - it is a label, not a scope: an agent working under one brand's header
 *     still sees the other brand's chats (`brand-isolation.test.ts`
 *     BRAND_LABEL_TABLES proves the policy side).
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DAY_MS = 86_400_000;

describe("a chat's brand — the site the member came in through (AI-14 · tm 309.1)", () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  /** The licence's default brand: the widget on its trusted domain speaks for it. */
  let brandA: string;
  /** A second brand, with a website of its own on a subdomain. */
  let brandB: string;
  let brandBHost: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    brandB = (
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      })
    ).id;
    brandBHost = `b.${fx.a.trustedDomain}`;
    await owner.website.create({
      data: { licenseId: fx.a.licenseId, brandId: brandB, domain: brandBHost },
    });
    await clearRateLimits(server.app);

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

  /** A widget token for a site; `memberToken` makes it the same member's browser. */
  async function mint(host = fx.a.trustedDomain, memberToken?: string) {
    const response = await server.post(
      '/customer/token',
      {
        organization_id: fx.a.organizationId,
        host_origin: `https://${host}`,
        ...(memberToken ? { member_token: memberToken } : {}),
      },
      { origin: `https://${host}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string; member_token: string };
  }

  async function say(token: string, text: string): Promise<string> {
    const response = await server.post('/customer/chat/events', { text }, auth(token));
    expect(response.statusCode).toBe(201);
    return (response.json() as { chat_id: string }).chat_id;
  }

  async function archive(chatId: string): Promise<void> {
    const response = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(agentToken));
    expect(response.statusCode).toBe(200);
  }

  const brandOf = async (chatId: string) =>
    (await owner.chat.findUniqueOrThrow({ where: { id: chatId }, select: { brandId: true } }))
      .brandId;

  it('files the chat a visitor opens under the brand of the site the widget runs on', async () => {
    // The trusted domain has no website of its own: the licence default.
    const onA = await mint();
    expect(await brandOf(await say(onA.token, 'Hello from A'))).toBe(brandA);

    // A site registered for the second brand.
    const onB = await mint(brandBHost);
    const chatB = await say(onB.token, 'Hello from B');
    expect(await brandOf(chatB)).toBe(brandB);
    // The same brand's site talking on keeps it.
    await say(onB.token, 'Still me');
    expect(await brandOf(chatB)).toBe(brandB);
  });

  it("leaves the day's chat with no brand once the same member writes through another brand's site", async () => {
    const onA = await mint();
    const chatId = await say(onA.token, 'Deposit missing');
    expect(await brandOf(chatId)).toBe(brandA);

    // Same member (their member token), the other brand's site, same open connection.
    const onB = await mint(brandBHost, onA.member_token);
    expect(onB.customer_id).toBe(onA.customer_id);
    expect(await say(onB.token, 'Also on the other site')).toBe(chatId);
    expect(await brandOf(chatId)).toBeNull();

    // For good: the first brand's site coming back does not restore it.
    await say(onA.token, 'Back here');
    expect(await brandOf(chatId)).toBeNull();
  });

  it("clears it on a further connection the same day through another brand's site", async () => {
    const onA = await mint();
    const chatId = await say(onA.token, 'Morning');
    await archive(chatId);

    const onB = await mint(brandBHost, onA.member_token);
    expect(await say(onB.token, 'Afternoon, other site')).toBe(chatId);
    expect(await owner.thread.count({ where: { chatId } })).toBe(2);
    expect(await brandOf(chatId)).toBeNull();
  });

  it('files no brand when the token names none', async () => {
    // A licence whose sites resolve to no brand at all mints a brandless token.
    await owner.brand.deleteMany({ where: { licenseId: fx.a.licenseId } });
    const { token } = await mint();
    expect(await brandOf(await say(token, 'Hello'))).toBeNull();
  });

  it("names no brand on an agent's own start", async () => {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Vic' },
      select: { id: true },
    });
    const response = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      auth(agentToken),
    );
    expect(response.statusCode).toBe(201);
    expect(await brandOf((response.json() as { id: string }).id)).toBeNull();
  });

  it("brings an earlier day's brand into today's chat when an agent reopens it — and clears one it differs from", async () => {
    // Yesterday, through the second brand's site.
    const onB = await mint(brandBHost);
    const yesterday = await say(onB.token, 'Last night: bonus missing');
    await archive(yesterday);
    const filed = await owner.chat.findUniqueOrThrow({ where: { id: yesterday } });
    await owner.chat.update({
      where: { id: yesterday },
      data: { localDay: new Date(filed.localDay!.getTime() - DAY_MS) },
    });

    const reopened = await server.post(`/chats/${yesterday}/resume`, undefined, auth(agentToken));
    expect(reopened.statusCode).toBe(200);
    const today = (reopened.json() as { id: string }).id;
    expect(today).not.toBe(yesterday);
    expect(await brandOf(today)).toBe(brandB);

    // Another member: today through brand A, yesterday's through brand B.
    const onA = await mint();
    const earlier = await say(onA.token, 'Last night: limits');
    await archive(earlier);
    const before = await owner.chat.findUniqueOrThrow({ where: { id: earlier } });
    await owner.chat.update({
      where: { id: earlier },
      data: { brandId: brandB, localDay: new Date(before.localDay!.getTime() - DAY_MS) },
    });
    const todays = await say(onA.token, 'This morning');
    expect(await brandOf(todays)).toBe(brandA);
    await archive(todays);

    const again = await server.post(`/chats/${earlier}/resume`, undefined, auth(agentToken));
    expect(again.statusCode).toBe(200);
    expect((again.json() as { id: string }).id).toBe(todays);
    expect(await brandOf(todays)).toBeNull();
  });

  it("is a label, not a scope: an agent under one brand's header still sees the other brand's chat", async () => {
    const onB = await mint(brandBHost);
    const chatB = await say(onB.token, 'Hello from B');
    expect(await brandOf(chatB)).toBe(brandB);

    const underA = await server.get('/chats', { ...auth(agentToken), 'x-siyahtus-brand': brandA });
    expect(underA.statusCode).toBe(200);
    expect((underA.json() as { items: Array<{ id: string }> }).items.map((c) => c.id)).toContain(
      chatB,
    );
    const one = await server.get(`/chats/${chatB}`, {
      ...auth(agentToken),
      'x-siyahtus-brand': brandA,
    });
    expect(one.statusCode).toBe(200);
  });
});
