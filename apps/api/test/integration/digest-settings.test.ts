/**
 * The summary-e-mail switches and the workspace default behind them (RP-05 ·
 * tm 372).
 *
 * A member's switch is `null` until they choose: the answer they read is their
 * own choice, or while they have made none the default for their role in this
 * workspace. That is what keeps the Founder's default honest for people who join
 * later, and what this file holds:
 *
 *   - the shipped default (managers: daily, nobody: weekly) reads through
 *     `/agents/me/notification-preferences` and `/auth/me` alike;
 *   - an own choice is stored as given and survives the default changing;
 *   - only the Founder and the Administrators change the default, and every
 *     change is in the audit trail;
 *   - the default is per workspace.
 */
import type { PrismaClient } from '@prisma/client';
import { defaultScopesForRole } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('summary e-mail settings (RP-05)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let ownerAuth: { authorization: string };
  let agentAuth: { authorization: string };

  const PREFS = '/agents/me/notification-preferences';
  const DEFAULTS = '/settings/digests';

  async function authFor(accountId: string, role: string): Promise<{ authorization: string }> {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

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
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    ownerAuth = await authFor(fx.a.ownerAccountId, 'owner');
    agentAuth = await authFor(fx.a.agentAccountId, 'agent');
  });

  it('reads the shipped default by role: the Founder gets the daily summary, an Agent nothing', async () => {
    const founder = (await server.get(PREFS, ownerAuth)).json() as Record<string, unknown>;
    expect(founder).toMatchObject({ digest_daily: true, digest_weekly: false });
    const agent = (await server.get(PREFS, agentAuth)).json() as Record<string, unknown>;
    expect(agent).toMatchObject({ digest_daily: false, digest_weekly: false });
    expect((await server.get(DEFAULTS, agentAuth)).json()).toEqual({
      daily_roles: ['owner', 'viceowner', 'admin', 'team_lead'],
      weekly_roles: [],
    });
  });

  it('ships the effective switches with the profile', async () => {
    const me = (await server.get('/auth/me', ownerAuth)).json() as {
      notification_preferences: Record<string, unknown>;
    };
    expect(me.notification_preferences).toMatchObject({ digest_daily: true, digest_weekly: false });
  });

  it('stores an own choice as given, and keeps it when the workspace default changes', async () => {
    const off = await server.put(PREFS, { digest_daily: false }, ownerAuth);
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ digest_daily: false });

    // The Founder moves the default so the weekly summary is on for Administrators…
    const saved = await server.put(DEFAULTS, { weekly_roles: ['admin', 'owner'] }, ownerAuth);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      daily_roles: ['owner', 'viceowner', 'admin', 'team_lead'],
      weekly_roles: ['owner', 'admin'],
    });

    // …the Founder who switched the daily one off still has it off, and — having
    // chosen nothing for the weekly one — now follows the new default.
    const prefs = (await server.get(PREFS, ownerAuth)).json();
    expect(prefs).toMatchObject({ digest_daily: false, digest_weekly: true });
    const stored = await owner.agentMembership.findUniqueOrThrow({
      where: {
        licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId },
      },
    });
    expect(stored.notifyDigestDaily).toBe(false);
    expect(stored.notifyDigestWeekly).toBeNull();
  });

  it('lets an Agent switch a summary on for themselves (the sweep still needs report access)', async () => {
    const res = await server.put(PREFS, { digest_weekly: true }, agentAuth);
    expect(res.json()).toMatchObject({ digest_weekly: true });
  });

  it('refuses a misspelt key and an empty body rather than dropping the toggle', async () => {
    expect((await server.put(PREFS, { digest_dailly: true }, ownerAuth)).statusCode).toBe(400);
    expect((await server.put(DEFAULTS, {}, ownerAuth)).statusCode).toBe(400);
    expect((await server.put(DEFAULTS, { daily_roles: ['janitor'] }, ownerAuth)).statusCode).toBe(
      400,
    );
    expect((await server.put(DEFAULTS, { nightly_roles: [] }, ownerAuth)).statusCode).toBe(400);
  });

  it('lets only the Founder and the Administrators change the default', async () => {
    const refused = await server.put(DEFAULTS, { daily_roles: ['agent'] }, agentAuth);
    expect(refused.statusCode).toBe(403);
    expect((await server.get(DEFAULTS, agentAuth)).json()).toMatchObject({
      daily_roles: ['owner', 'viceowner', 'admin', 'team_lead'],
    });
  });

  it('records a change of the default in the audit trail, with the roles and no address', async () => {
    await server.put(
      DEFAULTS,
      { daily_roles: ['owner'], weekly_roles: ['owner', 'admin'] },
      ownerAuth,
    );
    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'digest_settings.updated' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({
      daily_roles: ['owner'],
      weekly_roles: ['owner', 'admin'],
    });
    expect(JSON.stringify(entries[0]?.metadata)).not.toContain('@');
  });

  it('keeps the default per workspace', async () => {
    await server.put(DEFAULTS, { daily_roles: [] }, ownerAuth);
    // Workspace B never saved, so it has no row and reads the shipped default.
    const rows = await owner.digestSettings.findMany();
    expect(rows.map((r) => r.licenseId)).toEqual([fx.a.licenseId]);
  });
});
