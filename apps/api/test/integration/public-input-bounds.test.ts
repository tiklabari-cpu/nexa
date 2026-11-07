/**
 * What the public edge reads, and how much of it (tm 419 · tm 451).
 *
 * **Collections (GHSA-mrhx-c7xc-m3w5, 2026-11-06 audit F02).** zod 3 parses
 * every element of an array before it checks `.max()`, one issue per bad
 * element, and the error handler listed them all: the unauthenticated
 * `POST /customer/token` with a 1 MB `browser_languages` of 500k numbers cost
 * ~160 MB of heap and answered with 72 MB. Pinned here on the response — size
 * and issue count — rather than on time or memory, which flake under the
 * gate's load:
 *   - over the route's 16 KiB ceiling, the body is not parsed at all;
 *   - under it, an oversized list is one issue (`input-bounds.ts` checks the
 *     length first) — the case that goes red if the pre-check is removed;
 *   - a real mint, at every field's own maximum, still fits.
 * The same holds for the visitor's form maps and the inbound mail's lists,
 * which sit behind the 1 MiB and 36 MiB limits.
 *
 * **Visitor page addresses (F30).** A `javascript:` URL sent as the page the
 * visitor is on was stored and drawn as a link in the agent's panel. It is now
 * dropped — the message still arrives — and an http(s) one is kept.
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

interface ValidationBody {
  error: {
    type: string;
    message: string;
    details?: {
      fields?: Array<{ field: string; message: string }>;
      fields_truncated?: boolean;
      fields_total?: number;
    };
  };
}

/** The test strategy's ceiling for a refusal's answer. */
const SMALL_ANSWER = 8 * 1024;

describe('public input bounds', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;

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
    await seedDefaultBrand(owner, fx.a.licenseId);
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

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  function mint(body: Record<string, unknown>) {
    return server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId, ...body },
      { origin: `https://${fx.a.trustedDomain}` },
    );
  }

  async function widgetToken(): Promise<{ token: string; customer_id: string }> {
    const response = await mint({});
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  function refusal(response: { statusCode: number; body: string; json: () => unknown }) {
    expect(response.statusCode).toBe(400);
    expect(response.body.length).toBeLessThan(SMALL_ANSWER);
    const { error } = response.json() as ValidationBody;
    expect(error.type).toBe('validation');
    return error;
  }

  const lastVisit = (customerId: string) =>
    owner.visit.findFirstOrThrow({ where: { customerId }, orderBy: { startedAt: 'desc' } });

  // =========================================================================

  describe('POST /customer/token (tm 419)', () => {
    it('refuses a 500k-element browser_languages unread, with a small answer', async () => {
      const response = await mint({ browser_languages: Array(500_000).fill(1) });

      const error = refusal(response);
      expect(error.message).toBe('Request body is larger than this endpoint accepts.');
    });

    it('answers an oversized list under the body ceiling with one issue, not one per element', async () => {
      // 5,000 numbers is ~10 KB: inside the route's 16 KiB, so zod sees it.
      // Without the length check first this was 5,001 issues.
      const response = await mint({ browser_languages: Array(5_000).fill(1) });

      const error = refusal(response);
      expect(error.details?.fields).toEqual([
        { field: 'browser_languages', message: 'Array must contain at most 10 element(s)' },
      ]);
      expect(error.details).not.toHaveProperty('fields_truncated');
    });

    it('answers eleven languages with the one issue zod always gave', async () => {
      const response = await mint({ browser_languages: Array(11).fill('en') });

      const error = refusal(response);
      expect(error.details?.fields).toHaveLength(1);
      expect(error.message).toBe('browser_languages: Array must contain at most 10 element(s)');
    });

    it('mints as before for ten languages', async () => {
      const response = await mint({
        browser_languages: ['tr-TR', 'tr', 'en-US', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt'],
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('token');
    });

    it('still mints for a body with every field at its own maximum (the 16 KiB margin)', async () => {
      const page = `https://${fx.a.trustedDomain}/${'p'.repeat(2048 - fx.a.trustedDomain.length - 9)}`;
      const body = {
        member_token: 'm'.repeat(4096),
        // Read only when the request is flagged; a plain mint ignores it.
        challenge_token: 'c'.repeat(2048),
        customer_id: '00000000-0000-4000-8000-000000000000',
        host_origin: `https://${fx.a.trustedDomain}`.padEnd(2048, '/'),
        host_url: page,
        host_referrer: page,
        identity: {
          user_id: 'u'.repeat(128),
          username: 'ç'.repeat(120),
          email: `${'e'.repeat(244)}@example.t`,
          ts: 1_790_000_000,
          user_hash: 'a'.repeat(64),
        },
        language: 'x'.repeat(35),
        browser_languages: Array.from({ length: 10 }, () => 'y'.repeat(35)),
      };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(13_000);

      const response = await mint(body);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('the other collections a visitor or a mail can send (tm 419)', () => {
    it("answers a 1 MB map of pre-chat answers with one issue, not the map's size", async () => {
      const { token } = await widgetToken();
      const custom_fields = Object.fromEntries(
        Array.from({ length: 80_000 }, (_, i) => [`k${i}`, 1]),
      );

      const response = await server.post(
        '/customer/chat/events',
        { text: 'Hi', custom_fields },
        auth(token),
      );

      const error = refusal(response);
      expect(error.message).toBe('custom_fields: at most 200 fields');
    });

    it('answers a page view with 80k variables with the one "at most" issue', async () => {
      const { token } = await widgetToken();
      const variables = Object.fromEntries(Array.from({ length: 80_000 }, (_, i) => [`v${i}`, {}]));

      const response = await server.post(
        '/customer/visit',
        { url: 'https://shop.test/', variables },
        auth(token),
      );

      const error = refusal(response);
      expect(error.message).toMatch(/^variables: at most \d+ variables$/);
    });

    it('answers a mail with 400k bogus attachments with one issue', async () => {
      const response = await server.post('/channels/email/inbound', {
        to: `support@${fx.a.trustedDomain}`,
        from: 'robin@example.test',
        attachments: Array(400_000).fill(1),
      });

      const error = refusal(response);
      expect(error.message).toBe('attachments: Array must contain at most 50 element(s)');
    });
  });

  // =========================================================================

  describe('the page a visitor reports (tm 451)', () => {
    it('stores no javascript: page, and the message still arrives', async () => {
      const { token, customer_id } = await widgetToken();

      const response = await server.post(
        '/customer/chat/events',
        { text: 'merhaba', url: 'javascript:alert(document.domain)' },
        auth(token),
      );
      expect(response.statusCode).toBe(201);
      const chatId = (response.json() as { chat_id: string }).chat_id;

      const stored = JSON.stringify(
        await owner.visit.findMany({ where: { customerId: customer_id }, select: { pages: true } }),
      );
      expect(stored).not.toContain('javascript');
      const chat = await server.get(`/chats/${chatId}`, auth(agentToken));
      expect(chat.statusCode).toBe(200);
      expect(JSON.stringify(chat.json())).not.toContain('javascript:');
      expect(await owner.event.count({ where: { chatId, text: 'merhaba' } })).toBe(1);
    });

    it('stores an https page', async () => {
      const { token, customer_id } = await widgetToken();

      await server.post(
        '/customer/chat/events',
        { text: 'merhaba', url: 'https://shop.test/bikes' },
        auth(token),
      );

      const pages = (await lastVisit(customer_id)).pages as Array<{ url: string }>;
      expect(pages.map((page) => page.url)).toEqual(['https://shop.test/bikes']);
    });

    it('drops a javascript: referrer and keeps an Android app one', async () => {
      const first = await widgetToken();
      await server.post(
        '/customer/chat/events',
        { text: 'Hi', url: 'https://shop.test/a', referrer: 'javascript:alert(1)' },
        auth(first.token),
      );
      expect((await lastVisit(first.customer_id)).cameFrom).toBeNull();

      const second = await widgetToken();
      await server.post(
        '/customer/visit',
        { url: 'https://shop.test/b', referrer: 'android-app://com.google.android.gm/' },
        auth(second.token),
      );
      expect((await lastVisit(second.customer_id)).cameFrom).toBe(
        'android-app://com.google.android.gm/',
      );
    });

    it("drops a javascript: host_referrer at the mint, keeping the visit's page", async () => {
      const response = await mint({
        host_origin: `https://${fx.a.trustedDomain}`,
        host_url: `https://${fx.a.trustedDomain}/pricing`,
        host_referrer: 'javascript:alert(document.domain)',
      });
      expect(response.statusCode).toBe(200);
      const { customer_id } = response.json() as { customer_id: string };

      const visit = await lastVisit(customer_id);
      expect(visit.cameFrom).toBeNull();
      expect((visit.pages as Array<{ url: string }>).map((page) => page.url)).toEqual([
        `https://${fx.a.trustedDomain}/pricing`,
      ]);
    });
  });
});
