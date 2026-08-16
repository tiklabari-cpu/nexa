/**
 * Registered handsets (FR-MOD-13.7 · 13.7-c).
 *
 * The table holds a delivery credential in plain text, so what is worth proving
 * here is not the CRUD — it is the four properties that were chosen *instead* of
 * hashing, plus the two invariants the lifecycle on the phone depends on:
 *
 *   - The token never comes back out. Asserted against the whole response body,
 *     not against a list of fields, because a field added later is exactly how
 *     this would regress.
 *   - Re-registering the same handset does not multiply rows. A phone that
 *     re-registers on every launch would otherwise be sent one copy of every
 *     message per launch it has ever made.
 *   - Cross-tenant: another workspace's device cannot be read, revoked or
 *     collided with — including through the unique index, which is why it is
 *     license-scoped rather than global.
 *   - A colleague's device is invisible too. RLS alone would not do that; they
 *     share a license, so the caller's own account id is the guard.
 *
 * Run against real Postgres with RLS on, because three of those four are
 * database behaviour and a mocked client would agree with whatever the handler
 * believed.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** The application role — RLS-enforced, the way the API itself reaches the row. */
const APP_URL = process.env['DATABASE_APP_URL'];

describe('device tokens', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** The workspace-A agent whose phone this is. */
  let agentToken: string;
  /** A colleague in the same workspace — the "not RLS" half of isolation. */
  let colleagueToken: string;
  /** Workspace B, for the cross-tenant half. */
  let otherToken: string;
  /** Read-only scope, to pin that registering is a write. */
  let readOnlyToken: string;

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
    otherToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.agentAccountId,
      scopes: ['agents--my:rw'],
    });
    readOnlyToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:ro'],
    });
  });

  const register = (token: string, body: { token: string; platform: string }) =>
    server.post('/notifications/devices', body, auth(token));

  // --- The plaintext column's compensating controls ---------------------------

  it('never returns the token, on any of the three read paths', async () => {
    const created = await register(agentToken, { token: 'apns-abc-123', platform: 'ios' });
    expect(created.statusCode).toBe(201);
    // Against the serialised body, so a column added to `deviceSelect` later
    // cannot slip through a field-by-field assertion.
    expect(JSON.stringify(created.json())).not.toContain('apns-abc-123');
    expect(created.json()).toEqual({
      id: expect.any(String),
      platform: 'ios',
      created_at: expect.any(String),
      last_seen_at: expect.any(String),
      revoked_at: null,
    });

    const refreshed = await register(agentToken, { token: 'apns-abc-123', platform: 'ios' });
    expect(refreshed.statusCode).toBe(200);
    expect(JSON.stringify(refreshed.json())).not.toContain('apns-abc-123');

    const listed = await server.get('/notifications/devices', auth(agentToken));
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain('apns-abc-123');

    // The row itself does hold the plaintext — that is the point of the
    // decision, and the reason the assertions above matter.
    const stored = await owner.deviceToken.findFirst({ where: { licenseId: fx.a.licenseId } });
    expect(stored?.token).toBe('apns-abc-123');
  });

  it('keeps the token out of the audit trail while still recording the grant', async () => {
    const created = await register(agentToken, { token: 'fcm-secret-token', platform: 'android' });
    const deviceId = (created.json() as { id: string }).id;

    const revoked = await server.del(`/notifications/devices/${deviceId}`, auth(agentToken));
    expect(revoked.statusCode).toBe(204);

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: { in: ['device.registered', 'device.revoked'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action)).toEqual(['device.registered', 'device.revoked']);
    expect(entries.map((e) => e.target)).toEqual([`device:${deviceId}`, `device:${deviceId}`]);
    for (const entry of entries) {
      expect(JSON.stringify(entry.metadata)).toContain('android');
      expect(JSON.stringify(entry.metadata)).not.toContain('fcm-secret-token');
    }
  });

  it('keeps the token out of the log, at the noisiest level the server has', async () => {
    // The third of the plaintext column's four compensating controls. Asserted
    // end to end rather than by reading the redaction list, because what has to
    // hold is "no line contains it" — a future handler that logged the body for
    // debugging would pass a config check and fail this one. `trace` is chosen
    // deliberately: a level nobody runs in production is exactly where a
    // credential gets left behind.
    class LineSink {
      readonly lines: string[] = [];
      write(chunk: string): boolean {
        this.lines.push(chunk);
        return true;
      }
      end(): void {}
      on(): void {}
      once(): void {}
      emit(): boolean {
        return false;
      }
    }

    const sink = new LineSink();
    const loud = await startTestServer(
      { LOG_LEVEL: 'trace' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    try {
      const res = await loud.post(
        '/notifications/devices',
        { token: 'apns-never-logged-9f3a', platform: 'ios' },
        auth(agentToken),
      );
      expect(res.statusCode).toBe(201);

      const written = sink.lines.join('\n');
      expect(written).not.toContain('apns-never-logged-9f3a');
      // Still debuggable — the route is in the line, only the credential is gone.
      expect(written).toContain('/notifications/devices');
    } finally {
      await loud.close();
    }
  });

  it('does not write an audit entry for a re-registration', async () => {
    // The app re-registers on every launch. One entry per launch per phone would
    // turn the security trail into a launch log, which is how the entries that
    // matter stop being found.
    await register(agentToken, { token: 'apns-launch', platform: 'ios' });
    await register(agentToken, { token: 'apns-launch', platform: 'ios' });
    await register(agentToken, { token: 'apns-launch', platform: 'ios' });

    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'device.registered' },
      }),
    ).toBe(1);
  });

  // --- Registration and refresh ----------------------------------------------

  it('does not multiply rows when the same handset registers again', async () => {
    const first = await register(agentToken, { token: 'apns-same', platform: 'ios' });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { id: string; last_seen_at: string };

    const second = await register(agentToken, { token: 'apns-same', platform: 'ios' });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { id: string; last_seen_at: string };

    // Same row, moved forward in time.
    expect(secondBody.id).toBe(firstBody.id);
    expect(Date.parse(secondBody.last_seen_at)).toBeGreaterThanOrEqual(
      Date.parse(firstBody.last_seen_at),
    );
    expect(await owner.deviceToken.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
  });

  it('lets a colleague take over a handed-down handset, and moves the row', async () => {
    // The app revokes before it registers when accounts are switched (§C-A31),
    // but a crash between the two would leave the previous person's
    // registration live. Taking it over is what stops one phone being addressed
    // as two people.
    await register(agentToken, { token: 'apns-shared', platform: 'ios' });
    const taken = await register(colleagueToken, { token: 'apns-shared', platform: 'android' });
    expect(taken.statusCode).toBe(200);

    const rows = await owner.deviceToken.findMany({ where: { licenseId: fx.a.licenseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountId).toBe(fx.a.ownerAccountId);
    expect(rows[0]?.platform).toBe('android');

    // And the previous holder no longer sees it.
    const previous = await server.get('/notifications/devices', auth(agentToken));
    expect((previous.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('revives a revoked registration rather than refusing it', async () => {
    const created = await register(agentToken, { token: 'apns-back', platform: 'ios' });
    const deviceId = (created.json() as { id: string }).id;
    await server.del(`/notifications/devices/${deviceId}`, auth(agentToken));

    const again = await register(agentToken, { token: 'apns-back', platform: 'ios' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { id: string }).id).toBe(deviceId);

    const row = await owner.deviceToken.findUnique({ where: { id: deviceId } });
    expect(row?.revokedAt).toBeNull();
  });

  it('refuses a platform it cannot deliver to, and an empty token', async () => {
    for (const body of [
      { token: 'x', platform: 'web' },
      { token: 'x', platform: 'IOS' },
      { token: '', platform: 'ios' },
      { token: '   ', platform: 'ios' },
      { token: 'x'.repeat(513), platform: 'ios' },
    ]) {
      const res = await register(agentToken, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await owner.deviceToken.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('requires a write scope to register or revoke', async () => {
    const refused = await register(readOnlyToken, { token: 'apns-ro', platform: 'ios' });
    expect(refused.statusCode).toBe(403);

    const created = await register(agentToken, { token: 'apns-ro2', platform: 'ios' });
    const deviceId = (created.json() as { id: string }).id;
    const refusedDelete = await server.del(
      `/notifications/devices/${deviceId}`,
      auth(readOnlyToken),
    );
    expect(refusedDelete.statusCode).toBe(403);
    expect((await owner.deviceToken.findUnique({ where: { id: deviceId } }))?.revokedAt).toBeNull();
  });

  // --- Revocation -------------------------------------------------------------

  it('marks a device revoked, drops it from the list, and keeps the row', async () => {
    const created = await register(agentToken, { token: 'apns-gone', platform: 'ios' });
    const deviceId = (created.json() as { id: string }).id;

    const revoked = await server.del(`/notifications/devices/${deviceId}`, auth(agentToken));
    expect(revoked.statusCode).toBe(204);

    const listed = await server.get('/notifications/devices', auth(agentToken));
    expect((listed.json() as { items: unknown[] }).items).toHaveLength(0);

    const row = await owner.deviceToken.findUnique({ where: { id: deviceId } });
    expect(row).not.toBeNull();
    expect(row?.revokedAt).toBeInstanceOf(Date);
  });

  it('answers 404 to a second revoke — the shape a retry takes', async () => {
    const created = await register(agentToken, { token: 'apns-twice', platform: 'ios' });
    const deviceId = (created.json() as { id: string }).id;

    expect(
      (await server.del(`/notifications/devices/${deviceId}`, auth(agentToken))).statusCode,
    ).toBe(204);
    expect(
      (await server.del(`/notifications/devices/${deviceId}`, auth(agentToken))).statusCode,
    ).toBe(404);
  });

  // --- Isolation --------------------------------------------------------------

  it('hides a colleague’s device from reads and revokes, inside one workspace', async () => {
    const created = await register(colleagueToken, { token: 'apns-colleague', platform: 'ios' });
    const deviceId = (created.json() as { id: string }).id;

    // RLS would let this through — same license. The account filter is the guard.
    const listed = await server.get('/notifications/devices', auth(agentToken));
    expect((listed.json() as { items: unknown[] }).items).toHaveLength(0);

    const revoked = await server.del(`/notifications/devices/${deviceId}`, auth(agentToken));
    expect(revoked.statusCode).toBe(404);
    expect((await owner.deviceToken.findUnique({ where: { id: deviceId } }))?.revokedAt).toBeNull();
  });

  it('cannot read or revoke another workspace’s device', async () => {
    const created = await register(otherToken, { token: 'apns-tenant-b', platform: 'ios' });
    const deviceId = (created.json() as { id: string }).id;

    const listed = await server.get('/notifications/devices', auth(agentToken));
    expect((listed.json() as { items: unknown[] }).items).toHaveLength(0);

    const revoked = await server.del(`/notifications/devices/${deviceId}`, auth(agentToken));
    expect(revoked.statusCode).toBe(404);
    expect((await owner.deviceToken.findUnique({ where: { id: deviceId } }))?.revokedAt).toBeNull();
  });

  it('lets two workspaces hold the same token without colliding', async () => {
    // The unique index is license-scoped on purpose: a global one would answer
    // "is this device registered elsewhere?" with a constraint violation, to a
    // caller with no right to the answer.
    const a = await register(agentToken, { token: 'apns-duplicate', platform: 'ios' });
    const b = await register(otherToken, { token: 'apns-duplicate', platform: 'ios' });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(await owner.deviceToken.count({ where: { token: 'apns-duplicate' } })).toBe(2);
  });

  it('is invisible to another tenant even through the application role', async () => {
    await register(agentToken, { token: 'apns-rls', platform: 'ios' });

    // Not the route — the database. `nexa_app` is the role the API connects as,
    // so this is the last line if a handler ever forgot its filter.
    const app = new PrismaClient({ datasourceUrl: APP_URL });
    try {
      const asOther = await withTenant(
        app,
        { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
        (tx) => tx.deviceToken.findMany(),
      );
      expect(asOther).toHaveLength(0);

      const asOwn = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.deviceToken.findMany(),
      );
      expect(asOwn).toHaveLength(1);
    } finally {
      await app.$disconnect();
    }
  });

  it('drops a device when the membership it belongs to is removed', async () => {
    // NFR-C8: taking somebody off the team has to also mean their phone stops
    // receiving the workspace's conversations. The composite foreign key is what
    // makes that automatic rather than a cleanup somebody has to remember.
    await register(agentToken, { token: 'apns-leaver', platform: 'ios' });
    expect(await owner.deviceToken.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);

    await owner.agentMembership.delete({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
    });
    expect(await owner.deviceToken.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });
});
