/**
 * Console layout preferences on the membership (tm 255.10).
 *
 * The Settings side navigation's "Unpin side navigation" switch has to follow
 * the user, not the browser, so it is stored where the notification
 * preferences are. What that is worth is proved here:
 *
 *   - It starts pinned and a write survives a fresh read.
 *   - It is per user *and* per license.
 *   - An unknown key or a non-boolean is refused rather than dropped.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_UI_PREFERENCES } from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('Settings navigation pin is kept per user and per license (FR-MOD-08.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  let colleagueToken: string;
  let readOnlyToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const PATH = '/agents/me/ui-preferences';

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
    await clearRateLimits(server.app);

    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });
    colleagueToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--my:rw'],
    });
    readOnlyToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:ro'],
    });
  });

  it('starts pinned', async () => {
    const res = await server.get(PATH, auth(agentToken));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_UI_PREFERENCES);
    expect(DEFAULT_UI_PREFERENCES.settings_nav_pinned).toBe(true);
  });

  it('keeps an unpin across a fresh read', async () => {
    const res = await server.put(PATH, { settings_nav_pinned: false }, auth(agentToken));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ settings_nav_pinned: false });

    const again = await server.get(PATH, auth(agentToken));
    expect(again.json()).toEqual({ settings_nav_pinned: false });

    const back = await server.put(PATH, { settings_nav_pinned: true }, auth(agentToken));
    expect(back.json()).toEqual({ settings_nav_pinned: true });
  });

  it('refuses an unknown key, an empty body and a non-boolean value', async () => {
    for (const body of [
      {},
      { settings_nav_pined: false },
      { settings_nav_pinned: 'no' },
      { settings_nav_pinned: null },
      { settings_nav_pinned: false, theme: 'dark' },
    ]) {
      const res = await server.put(PATH, body, auth(agentToken));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const unchanged = await server.get(PATH, auth(agentToken));
    expect(unchanged.json()).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it('requires a write scope to change anything', async () => {
    expect((await server.get(PATH, auth(readOnlyToken))).statusCode).toBe(200);
    const res = await server.put(PATH, { settings_nav_pinned: false }, auth(readOnlyToken));
    expect(res.statusCode).toBe(403);
  });

  it('is one member’s own — a colleague is unaffected', async () => {
    await server.put(PATH, { settings_nav_pinned: false }, auth(agentToken));
    const colleague = await server.get(PATH, auth(colleagueToken));
    expect(colleague.json()).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it('is per license — the same person’s other workspace keeps its own pin', async () => {
    await owner.agentMembership.create({
      data: { licenseId: fx.b.licenseId, agentId: fx.a.agentAccountId, role: 'agent' },
    });
    const elsewhere = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });

    await server.put(PATH, { settings_nav_pinned: false }, auth(agentToken));
    expect((await server.get(PATH, auth(elsewhere))).json()).toEqual(DEFAULT_UI_PREFERENCES);
    expect((await server.get(PATH, auth(agentToken))).json()).toEqual({
      settings_nav_pinned: false,
    });
  });
});
