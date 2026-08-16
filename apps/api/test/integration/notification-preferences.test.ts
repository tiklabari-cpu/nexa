/**
 * Notification preferences on the account (FR-MOD-13.8 · FR-MOD-08.2).
 *
 * Sound, desktop and the master switch lived in one `localStorage` key per
 * browser until 13.7-c. They moved here because push moved the decision: the
 * server picks which handset to deliver to, so a preference it cannot read does
 * not apply to the one channel that reaches somebody who has closed their
 * laptop.
 *
 * What that move has to be worth is proved here rather than in the UI:
 *
 *   - The value survives the browser. `/auth/me` carries it, which is what lets
 *     the console re-read it after a reload on a different machine.
 *   - It is per user *and* per license. Going quiet for one workspace must not
 *     go quiet for the other, and one member's choice must not touch another's.
 *   - A partial write changes only what it names, and a misspelled channel is
 *     refused rather than dropped — the failure where a switch says "off" and
 *     the server goes on interrupting.
 *   - `enabled` does not gate `email`. Both are stored as given; the rule that
 *     the master switch covers only the interruptive channels is `pushAllowed`'s
 *     to apply, and 13.7-d's to obey.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES, pushAllowed } from '@nexa/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('notification preferences', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  let colleagueToken: string;
  let readOnlyToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const PATH = '/agents/me/notification-preferences';

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

  it('starts reachable on every channel', async () => {
    // A fresh membership opts *out*, never in: the failure this product cannot
    // afford is an agent who never learns a visitor is waiting.
    const res = await server.get(PATH, auth(agentToken));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('applies a partial write and answers with the complete set', async () => {
    const res = await server.put(PATH, { sound: false }, auth(agentToken));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...DEFAULT_NOTIFICATION_PREFERENCES, sound: false });

    // The other four are untouched, not re-defaulted.
    const second = await server.put(PATH, { push: false }, auth(agentToken));
    expect(second.json()).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      sound: false,
      push: false,
    });
  });

  it('survives the browser — the profile carries it', async () => {
    await server.put(PATH, { enabled: false, email: false }, auth(agentToken));

    const me = await server.get('/auth/me', auth(agentToken));
    expect(me.statusCode).toBe(200);
    expect((me.json() as { notification_preferences: unknown }).notification_preferences).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: false,
      email: false,
    });
  });

  it('refuses an unknown channel rather than dropping it', async () => {
    // A dropped toggle is the failure where the switch on screen says "off" and
    // the server goes on interrupting — silent, and blamed on the phone.
    const res = await server.put(PATH, { despktop: false }, auth(agentToken));
    expect(res.statusCode).toBe(400);

    const unchanged = await server.get(PATH, auth(agentToken));
    expect(unchanged.json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('refuses an empty body and a non-boolean value', async () => {
    for (const body of [{}, { sound: 'off' }, { enabled: 1 }, { push: null }]) {
      const res = await server.put(PATH, body, auth(agentToken));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('requires a write scope to change anything', async () => {
    expect((await server.get(PATH, auth(readOnlyToken))).statusCode).toBe(200);
    expect((await server.put(PATH, { sound: false }, auth(readOnlyToken))).statusCode).toBe(403);
  });

  it('is one member’s own — a colleague is unaffected', async () => {
    await server.put(PATH, { enabled: false }, auth(agentToken));

    const colleague = await server.get(PATH, auth(colleagueToken));
    expect(colleague.json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('is per license — the same person stays reachable on their other workspace', async () => {
    // FR-MOD-08.2, and the reason the columns sit on the membership rather than
    // the account. The same account is given a membership in workspace B, so
    // this is genuinely one person in two places rather than two people.
    await owner.agentMembership.create({
      data: { licenseId: fx.b.licenseId, agentId: fx.a.agentAccountId, role: 'agent' },
    });
    const elsewhere = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });

    await server.put(PATH, { enabled: false, email: false }, auth(agentToken));

    const other = await server.get(PATH, auth(elsewhere));
    expect(other.json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('stores email independently of the master switch', async () => {
    // `enabled` covers the channels that interrupt *now*; e-mail is the fallback
    // for somebody who is not at a screen at all, so switching off the first has
    // never been a request to stop the second. The storage says nothing about
    // it either way — the rule is `pushAllowed`'s, and only push is gated.
    const res = await server.put(PATH, { enabled: false }, auth(agentToken));
    const prefs = res.json() as typeof DEFAULT_NOTIFICATION_PREFERENCES;
    expect(prefs.email).toBe(true);
    expect(prefs.push).toBe(true);
    expect(pushAllowed(prefs)).toBe(false);
  });

  it('turns a bot token away — a credential with no person has no preferences', async () => {
    // 404, not 403: the principal-kind gate answers "no such resource" so a
    // credential that may not reach a surface cannot be used to map it either
    // (the same rule that keeps a customer token out of the agent API).
    // Registering a *device* is the same question — a bot owns no handset — so
    // both surfaces are pinned here rather than only the one being changed.
    const bot = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      kind: 'bot',
      scopes: ['agents--my:rw'],
    });
    expect((await server.get(PATH, auth(bot))).statusCode).toBe(404);
    expect((await server.put(PATH, { sound: false }, auth(bot))).statusCode).toBe(404);
    expect((await server.get('/notifications/devices', auth(bot))).statusCode).toBe(404);
    expect(
      (await server.post('/notifications/devices', { token: 'x', platform: 'ios' }, auth(bot)))
        .statusCode,
    ).toBe(404);
  });
});
