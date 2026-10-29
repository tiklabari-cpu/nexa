/**
 * A brand's own widget texts and the queue's estimated wait (tm 344 · WG-05).
 *
 *   - `/settings/widget/phrases?locale=` reads and replaces one language's
 *     texts of the active brand; a key outside the closed list, an unknown
 *     placeholder, markup or a line break is refused and nothing is saved;
 *   - the token mint hands the widget only the texts of the language it will
 *     show — picked from the snippet, the brand's language and the browser —
 *     so a Turkish text never reaches an English widget;
 *   - `GET /customer/chat` carries `chat.estimated_wait` for a queued visitor
 *     when the team's queue has at least 20 finished waits in 7 days and
 *     someone of the team accepts chats, else null.
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
import { queueWaitCacheKey } from '../../src/services/routing/queue-wait.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Phrases {
  brand_id: string;
  locale: string;
  phrases: Record<string, string>;
  updated_at: string | null;
}

const TR_OFFLINE = 'Değerli üyemiz, şu an kapalıyız. Mesajınızı bırakın.';

describe('widget texts per language (tm 344 · WG-05)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandA: string;
  let brandB: string;
  let adminToken: string;
  let readToken: string;
  let groupId: bigint;

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
    await seedDefaultBrand(owner, fx.b.licenseId);
    brandB = (
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      })
    ).id;
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    groupId = support.id;
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: groupId },
    });
    // Ids restart with every seed; a team's cached aggregate must not outlive its test.
    await server.app.redis.del(queueWaitCacheKey(fx.a.licenseId, groupId));

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
  });

  function put(locale: string, phrases: Record<string, string>, brandId?: string) {
    return server.put(
      `/settings/widget/phrases?locale=${locale}`,
      { phrases },
      { ...auth(adminToken), ...(brandId ? { 'x-siyahtus-brand': brandId } : {}) },
    );
  }

  async function get(locale: string, brandId?: string): Promise<Phrases> {
    const response = await server.get(`/settings/widget/phrases?locale=${locale}`, {
      ...auth(readToken),
      ...(brandId ? { 'x-siyahtus-brand': brandId } : {}),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Phrases;
  }

  async function mint(hints: { language?: string; browser_languages?: string[] }) {
    const response = await server.post(
      '/customer/token',
      {
        organization_id: fx.a.organizationId,
        host_origin: `https://${fx.a.trustedDomain}`,
        ...hints,
      },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as {
      token: string;
      widget_phrases: { locale: string; phrases: Record<string, string> };
    };
  }

  // =========================================================================

  describe('/settings/widget/phrases', () => {
    it('saves a language’s texts, reads them back, and leaves the other languages alone', async () => {
      expect(await get('tr')).toMatchObject({ brand_id: brandA, phrases: {}, updated_at: null });

      const saved = await put('tr', {
        'status.offline': `  ${TR_OFFLINE}  `,
        'status.queueWait': 'Sıranız {n} · yaklaşık {minutes} dk',
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        locale: 'tr',
        phrases: {
          'status.offline': TR_OFFLINE,
          'status.queueWait': 'Sıranız {n} · yaklaşık {minutes} dk',
        },
      });

      expect((await get('tr')).phrases['status.offline']).toBe(TR_OFFLINE);
      expect((await get('tr')).updated_at).not.toBeNull();
      expect((await get('en')).phrases).toEqual({});

      const audit = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'settings.widget_phrases_updated' },
        select: { metadata: true },
      });
      expect(audit?.metadata).toMatchObject({
        brand_id: brandA,
        locale: 'tr',
        changed: ['status.offline', 'status.queueWait'],
      });
    });

    it('goes back to the default for every key left out (reset)', async () => {
      await put('tr', { 'status.offline': TR_OFFLINE, 'input.placeholder': 'Yazın' });
      const reset = await put('tr', { 'input.placeholder': 'Yazın' });
      expect(reset.statusCode).toBe(200);
      expect((await get('tr')).phrases).toEqual({ 'input.placeholder': 'Yazın' });
      const rows = await owner.widgetPhrase.count({ where: { licenseId: fx.a.licenseId } });
      expect(rows).toBe(1);
    });

    it('refuses an unknown placeholder, an unknown key, markup and line breaks — saving nothing', async () => {
      await put('tr', { 'status.offline': TR_OFFLINE });

      const cases: Array<[Record<string, string>, string, string]> = [
        [{ 'status.queue': 'Sıranız {pos}' }, 'status.queue', 'unknown_placeholder'],
        [{ 'status.queue': '{n}. sıra, {minutes} dk' }, 'status.queue', 'unknown_placeholder'],
        [{ 'error.connect': 'Kapalı' }, 'error.connect', 'unknown_key'],
        [{ 'status.offline': '<b>Kapalı</b>' }, 'status.offline', 'markup'],
        [{ 'status.offline': 'iki\nsatır' }, 'status.offline', 'line_break'],
        [{ 'prechat.submit': 'x'.repeat(41) }, 'prechat.submit', 'too_long'],
      ];
      for (const [phrases, key, problem] of cases) {
        const refused = await put('tr', { 'input.placeholder': 'Yazın', ...phrases });
        expect(refused.statusCode, `${key} ${problem}`).toBe(400);
        expect(refused.json()).toMatchObject({ error: { details: { key, problem } } });
      }
      // The earlier save stands; none of the refused sets touched it.
      expect((await get('tr')).phrases).toEqual({ 'status.offline': TR_OFFLINE });

      expect((await put('ru', { 'status.offline': 'x' })).statusCode).toBe(400);
    });

    it('lets a read-only credential read but not write', async () => {
      const refused = await server.put(
        '/settings/widget/phrases?locale=tr',
        { phrases: { 'status.offline': TR_OFFLINE } },
        auth(readToken),
      );
      expect(refused.statusCode).toBe(403);
      expect(await owner.widgetPhrase.count()).toBe(0);
    });

    it('keeps each brand’s texts its own', async () => {
      expect((await put('tr', { 'status.offline': TR_OFFLINE }, brandA)).statusCode).toBe(200);
      expect((await get('tr', brandB)).phrases).toEqual({});
      expect((await put('tr', { 'status.offline': 'İkinci marka' }, brandB)).statusCode).toBe(200);
      expect((await get('tr', brandA)).phrases['status.offline']).toBe(TR_OFFLINE);
    });
  });

  // =========================================================================

  describe('the token mint', () => {
    beforeEach(async () => {
      expect((await put('tr', { 'status.offline': TR_OFFLINE })).statusCode).toBe(200);
    });

    it('hands a Turkish widget the Turkish text and an English widget none', async () => {
      const turkish = await mint({ browser_languages: ['tr-TR', 'en'] });
      expect(turkish.widget_phrases).toEqual({
        locale: 'tr',
        phrases: { 'status.offline': TR_OFFLINE },
      });

      const english = await mint({ browser_languages: ['en-GB'] });
      expect(english.widget_phrases).toEqual({ locale: 'en', phrases: {} });
    });

    it('picks the language the way the widget does — snippet, pinned panel language, browser', async () => {
      expect(
        (await mint({ language: 'tr', browser_languages: ['en'] })).widget_phrases.locale,
      ).toBe('tr');
      // A snippet language the widget does not ship falls through to the browser.
      expect(
        (await mint({ language: 'ru', browser_languages: ['de'] })).widget_phrases.locale,
      ).toBe('de');
      const pinned = await server.put('/settings/widget', { language: 'tr' }, auth(adminToken));
      expect(pinned.statusCode).toBe(200);
      expect((await mint({ browser_languages: ['en-GB'] })).widget_phrases).toEqual({
        locale: 'tr',
        phrases: { 'status.offline': TR_OFFLINE },
      });
    });
  });

  // =========================================================================

  describe('estimated wait in the queue', () => {
    /** A visitor whose newest connection waits third in Support's queue. */
    async function queuedVisitor(): Promise<{ headers: Record<string, string>; threadId: string }> {
      const { token } = await mint({ browser_languages: ['tr'] });
      const headers = auth(token);
      const sent = await server.post('/customer/chat/events', { text: 'Para çekme' }, headers);
      expect(sent.statusCode).toBeLessThan(300);
      const chatId = (sent.json() as { chat_id: string }).chat_id;
      const thread = await owner.thread.findFirstOrThrow({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      await owner.thread.update({
        where: { id: thread.id },
        data: { assigneeId: null, queuePosition: 3, queueGroupId: groupId, queuedAt: new Date() },
      });
      return { headers, threadId: thread.id };
    }

    /** `count` finished waits of Support's queue, 60 s, 120 s, … apart, within the week. */
    async function history(threadId: string, count: number, outcome = 'assigned'): Promise<void> {
      const now = Date.now();
      await owner.queueEntry.createMany({
        data: Array.from({ length: count }, (_, i) => {
          const enteredAt = new Date(now - 24 * 3600_000 - i * 600_000);
          return {
            licenseId: fx.a.licenseId,
            threadId,
            groupId,
            enteredAt,
            leftAt: new Date(enteredAt.getTime() + (i + 1) * 60_000),
            outcome,
          };
        }),
      });
    }

    async function accepting(on: boolean): Promise<void> {
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { routingStatus: on ? 'accepting_chats' : 'not_accepting_chats' },
      });
    }

    async function estimate(headers: Record<string, string>) {
      await server.app.redis.del(queueWaitCacheKey(fx.a.licenseId, groupId));
      const response = await server.get('/customer/chat', headers);
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        chat: { queue_position: number | null; estimated_wait: unknown } | null;
      };
      return body.chat;
    }

    it('gives "about X–Y min" with enough history and someone accepting', async () => {
      const { headers, threadId } = await queuedVisitor();
      await history(threadId, 20);
      await accepting(true);

      // Waits of 1..20 min: median 10.5 min, p80 ≈ 16.2 min; × position 3 / 1 agent.
      const chat = await estimate(headers);
      expect(chat?.queue_position).toBe(3);
      expect(chat?.estimated_wait).toEqual({ min_minutes: 32, max_minutes: 49 });
    });

    it('gives none with fewer than 20 finished waits, other outcomes not counting', async () => {
      const { headers, threadId } = await queuedVisitor();
      await history(threadId, 19);
      await history(threadId, 5, 'abandoned');
      await accepting(true);
      expect((await estimate(headers))?.estimated_wait).toBeNull();
    });

    it('gives none while nobody of the team accepts chats', async () => {
      const { headers, threadId } = await queuedVisitor();
      await history(threadId, 25);
      await accepting(false);
      expect((await estimate(headers))?.estimated_wait).toBeNull();
    });

    it('reads the team aggregate once per minute, not on every poll', async () => {
      const { headers, threadId } = await queuedVisitor();
      await history(threadId, 19);
      await accepting(true);
      expect((await estimate(headers))?.estimated_wait).toBeNull();
      // More history arrives, but the next poll inside the minute is served
      // from the cache (no `del` here): still no estimate.
      await history(threadId, 5);
      const cached = (await server.get('/customer/chat', headers)).json() as {
        chat: { estimated_wait: unknown };
      };
      expect(cached.chat.estimated_wait).toBeNull();
      expect(
        await server.app.redis.ttl(queueWaitCacheKey(fx.a.licenseId, groupId)),
      ).toBeGreaterThan(0);
    });
  });
});
