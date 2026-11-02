/**
 * Event-bound suggested replies: what the server keeps (IN-07 · tm 364).
 *
 * The events themselves are detected in the panel; the server stores which saved
 * reply is bound to which event (`suggest_on`), in which order (`suggest_order`),
 * whether it is a promotion (`category`), how long a quiet player takes to count
 * as idle (`inbox_settings.customer_idle_seconds`) and each member's own switch
 * (`suggestions_event_enabled`). Every visibility claim is made through the list
 * as a particular caller, as `canned-private.test.ts` does.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_UI_PREFERENCES, defaultScopesForRole } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Reply {
  id: string;
  shortcut: string;
  visibility: string;
  suggest_on: string[];
  suggest_order: number;
  category: string;
}

describe('event-bound suggested replies (IN-07)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let curatorToken: string;
  let memberToken: string;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const list = async (token: string) => {
    const res = await server.get('/settings/canned-responses?scope=chat', auth(token));
    expect(res.statusCode).toBe(200);
    return res.json() as { items: Reply[]; customer_idle_seconds: number };
  };
  const save = (token: string, body: Record<string, unknown>) =>
    server.post('/settings/canned-responses', body, auth(token));

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
    // The inbox settings are brand-scoped; a real workspace always has its default brand.
    await seedDefaultBrand(owner, BigInt(fx.a.licenseId));
    await seedDefaultBrand(owner, BigInt(fx.b.licenseId));
    await clearRateLimits(server.app);
    const a = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    [curatorToken, memberToken, adminToken] = await Promise.all([
      grantToken(owner, {
        ...a,
        ownerId: fx.a.ownerAccountId,
        scopes: ['canned_responses--all:rw'],
      }),
      grantToken(owner, {
        ...a,
        ownerId: fx.a.agentAccountId,
        kind: 'oauth',
        clientId: fx.a.clientId,
        scopes: defaultScopesForRole('agent'),
      }),
      grantToken(owner, {
        ...a,
        ownerId: fx.a.ownerAccountId,
        scopes: ['access_rules:rw', 'access_rules:ro'],
      }),
    ]);
  });

  describe('the binding on a saved reply', () => {
    it('stores the events, their order and the category, and reads them back (IN-07)', async () => {
      const created = await save(curatorToken, {
        shortcut: 'devir',
        text: 'Sohbeti devraldım.',
        suggest_on: ['chat_transferred', 'chat_started'],
        suggest_order: 3,
        category: 'promotion',
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        suggest_on: ['chat_transferred', 'chat_started'],
        suggest_order: 3,
        category: 'promotion',
      });

      const row = (await list(curatorToken)).items.find((i) => i.shortcut === 'devir')!;
      expect(row).toMatchObject({
        suggest_on: ['chat_transferred', 'chat_started'],
        suggest_order: 3,
        category: 'promotion',
      });
    });

    it('a reply saved without them is never suggested, in order 0, and general (IN-07)', async () => {
      const created = await save(curatorToken, { shortcut: 'plain', text: 'Merhaba' });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        suggest_on: [],
        suggest_order: 0,
        category: 'general',
      });
    });

    it('changes them with a PATCH that names nothing else, and an empty list unbinds (IN-07)', async () => {
      const { id } = (await save(curatorToken, { shortcut: 'devir', text: 'Merhaba' })).json() as {
        id: string;
      };
      const bound = await server.patch(
        `/settings/canned-responses/${id}`,
        { suggest_on: ['customer_idle'] },
        auth(curatorToken),
      );
      expect(bound.statusCode).toBe(200);
      expect(bound.json()).toMatchObject({ text: 'Merhaba', suggest_on: ['customer_idle'] });

      const unbound = await server.patch(
        `/settings/canned-responses/${id}`,
        { suggest_on: [], suggest_order: 9 },
        auth(curatorToken),
      );
      expect(unbound.json()).toMatchObject({ suggest_on: [], suggest_order: 9 });
    });

    it.each([
      ['an unknown event', { suggest_on: ['chat_ended'] }],
      ['a repeated event', { suggest_on: ['chat_started', 'chat_started'] }],
      ['an order above 1000', { suggest_order: 1001 }],
      ['a negative order', { suggest_order: -1 }],
      ['a fractional order', { suggest_order: 1.5 }],
      ['an unknown category', { category: 'bonus' }],
    ])('refuses %s with a 400 and stores nothing (IN-07)', async (_name, patch) => {
      const { id } = (await save(curatorToken, { shortcut: 'devir', text: 'Merhaba' })).json() as {
        id: string;
      };
      const create = await save(curatorToken, { shortcut: 'other', text: 'Merhaba', ...patch });
      expect(create.statusCode).toBe(400);
      const update = await server.patch(
        `/settings/canned-responses/${id}`,
        patch,
        auth(curatorToken),
      );
      expect(update.statusCode).toBe(400);
      const row = (await list(curatorToken)).items.find((i) => i.id === id)!;
      expect(row).toMatchObject({ suggest_on: [], suggest_order: 0, category: 'general' });
    });

    it('the database refuses an unknown event even when the route is bypassed (IN-07)', async () => {
      await expect(
        owner.$executeRaw`
          INSERT INTO canned_responses (id, license_id, shortcut, text, suggest_on, updated_at)
          VALUES (gen_random_uuid(), ${BigInt(fx.a.licenseId)}, 'raw', 'x', ARRAY['nope']::text[], now())`,
      ).rejects.toThrow(/canned_responses_suggest_on_check/);
      await expect(
        owner.$executeRaw`
          INSERT INTO canned_responses (id, license_id, shortcut, text, category, updated_at)
          VALUES (gen_random_uuid(), ${BigInt(fx.a.licenseId)}, 'raw2', 'x', 'bonus', now())`,
      ).rejects.toThrow(/canned_responses_category_check/);
    });

    it('a shared binding reaches every agent’s list; only a curator may set it (IN-07)', async () => {
      await save(curatorToken, {
        shortcut: 'devir',
        text: 'Merhaba',
        suggest_on: ['chat_transferred'],
      });
      const seenByMember = (await list(memberToken)).items.find((i) => i.shortcut === 'devir');
      expect(seenByMember?.suggest_on).toEqual(['chat_transferred']);

      const refused = await server.patch(
        `/settings/canned-responses/${seenByMember!.id}`,
        { suggest_on: [] },
        auth(memberToken),
      );
      expect(refused.statusCode).toBe(403);
    });

    it('a member binds their own personal reply, and nobody else is sent it (IN-07)', async () => {
      const created = await save(memberToken, {
        shortcut: 'benim',
        text: 'Ben Mert',
        visibility: 'private',
        suggest_on: ['rated_good'],
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ suggest_on: ['rated_good'] });

      const mine = (await list(memberToken)).items.find((i) => i.shortcut === 'benim');
      expect(mine?.suggest_on).toEqual(['rated_good']);
      const theirs = (await list(curatorToken)).items.find((i) => i.shortcut === 'benim');
      expect(theirs).toBeUndefined();
    });
  });

  describe('how long a quiet player takes to count as idle', () => {
    it('is 180 seconds until the workspace sets it, on the list every agent reads (IN-07)', async () => {
      expect((await list(memberToken)).customer_idle_seconds).toBe(180);
      const settings = await server.get('/settings/chat-timeout', auth(adminToken));
      expect(settings.json()).toMatchObject({ customer_idle_seconds: null });
    });

    it('is set and reset through the chat-timeout settings, and the list follows (IN-07)', async () => {
      const set = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: null, customer_idle_seconds: 240 },
        auth(adminToken),
      );
      expect(set.statusCode).toBe(200);
      expect(set.json()).toMatchObject({ customer_idle_seconds: 240 });
      expect((await list(memberToken)).customer_idle_seconds).toBe(240);

      // A later save that does not mention it leaves it alone…
      await server.put('/settings/chat-timeout', { chat_timeout_seconds: null }, auth(adminToken));
      expect((await list(memberToken)).customer_idle_seconds).toBe(240);

      // …and null puts the default back.
      const reset = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: null, customer_idle_seconds: null },
        auth(adminToken),
      );
      expect(reset.json()).toMatchObject({ customer_idle_seconds: null });
      expect((await list(memberToken)).customer_idle_seconds).toBe(180);
    });

    it.each([9, 86_401, 0, -5, 90.5])('refuses %s seconds (IN-07)', async (seconds) => {
      const res = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: null, customer_idle_seconds: seconds },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(400);
    });

    it('is the workspace’s alone — another workspace still reads the default (IN-07)', async () => {
      await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: null, customer_idle_seconds: 600 },
        auth(adminToken),
      );
      const other = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['canned_responses--all:rw'],
      });
      expect((await list(other)).customer_idle_seconds).toBe(180);
    });
  });

  describe('the member’s own switch', () => {
    const PATH = '/agents/me/ui-preferences';

    it('is on until the member closes it, then kept for them alone (IN-07)', async () => {
      const mine = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--my:rw'],
      });
      const colleague = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents--my:rw'],
      });

      expect(DEFAULT_UI_PREFERENCES.suggestions_event_enabled).toBe(true);
      expect((await server.get(PATH, auth(mine))).json()).toMatchObject({
        suggestions_event_enabled: true,
      });

      const off = await server.put(PATH, { suggestions_event_enabled: false }, auth(mine));
      expect(off.statusCode).toBe(200);
      expect(off.json()).toEqual({ ...DEFAULT_UI_PREFERENCES, suggestions_event_enabled: false });
      expect((await server.get(PATH, auth(mine))).json()).toMatchObject({
        suggestions_event_enabled: false,
      });
      expect((await server.get(PATH, auth(colleague))).json()).toMatchObject({
        suggestions_event_enabled: true,
      });

      const on = await server.put(PATH, { suggestions_event_enabled: true }, auth(mine));
      expect(on.json()).toMatchObject({ suggestions_event_enabled: true });
    });

    it('refuses a non-boolean (IN-07)', async () => {
      const mine = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--my:rw'],
      });
      const res = await server.put(PATH, { suggestions_event_enabled: 'no' }, auth(mine));
      expect(res.statusCode).toBe(400);
    });
  });
});
