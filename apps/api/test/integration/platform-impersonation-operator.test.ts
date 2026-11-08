/**
 * An "enter as the customer" session lasts no longer than the standing of the
 * operator who opened it (tm 430 · the 2026-11-06 audit's F12 · FR-ADMIN-21).
 *
 * The finding: a compromised superadmin opens a `full` session; another
 * superadmin disables them — and the workspace token goes on working until
 * the session's window runs out, because disabling deleted only root panel
 * sessions and `auth_resolve_token` never looked at the operator. Here:
 *
 *   - disabling, revoking the sessions of, and demoting an operator end their
 *     open sessions in the change's transaction — the token is 401, the
 *     session reads `ended` with the reason, its token rows are revoked, and
 *     both trails record each ended session — and touch nobody else's;
 *   - a role change ends only what the new role may not hold;
 *   - `auth_resolve_token` refuses a disabled operator's token on its own,
 *     whatever disabled them (the floor under the sweep);
 *   - a session being opened while one of those changes commits either sees
 *     the change or is swept by it — never neither.
 *
 * The sockets those tokens opened are closed by `revocation-points.test.ts`
 * (a real gateway). FR-ADMIN codes are not Ek A catalogue IDs, so no title
 * carries one as a requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  ownerClient,
  platformClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  openActiveSession,
  TestClock,
  type TestOperator,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const REASON = 'Operator account reported compromised';
const LOCK_WAIT_TIMEOUT_MS = 10_000;

interface Opened {
  id: string;
  code: string;
}

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('an operator’s standing bounds what they opened as a member (tm 430)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  /** A second owner connection, for holding a lock while the API runs into it. */
  let racer: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  /** The superadmin who acts. */
  let boss: TestOperator;
  let bossToken: string;
  /** The operator whose standing changes — a superadmin, so a `full` session is theirs to open. */
  let target: TestOperator;
  let targetToken: string;
  /** Another operator with a session of their own, which nothing here may touch. */
  let bystander: TestOperator;
  let bystanderToken: string;

  const platformCall = (
    path: string,
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<LightMyRequestResponse> =>
    // Promise.resolve dispatches now: an injected request left un-awaited
    // would otherwise not start until it is.
    Promise.resolve(
      platform.app.inject({
        method: 'POST',
        url: `${PLATFORM_PREFIX}${path}`,
        headers: bearer(token),
        payload: { reason: REASON, ...body },
      }),
    );

  const startRequest = (
    token: string,
    on: { tenant?: TenantFixture; accountId?: string; mode?: 'read_only' | 'full' } = {},
  ) => {
    const workspace = on.tenant ?? fx.a;
    return platformCall('/support/impersonations', token, {
      license_id: workspace.licenseId.toString(),
      account_id: on.accountId ?? workspace.agentAccountId,
      mode: on.mode ?? 'read_only',
    });
  };

  async function open(token: string, on: Parameters<typeof startRequest>[1] = {}): Promise<Opened> {
    const response = await startRequest(token, on);
    expect(response.statusCode, response.body).toBe(201);
    const json = response.json() as { impersonation: { id: string }; handoff_url: string };
    const code = decodeURIComponent(new URL(json.handoff_url).hash.replace(/^#code=/, ''));
    return { id: json.impersonation.id, code };
  }

  const exchange = (code: string) => tenant.post('/auth/impersonation/exchange', { code });

  /** Open a session and trade its code: the workspace token the operator's browser holds. */
  async function enter(
    token: string,
    on: Parameters<typeof startRequest>[1] = {},
  ): Promise<{ id: string; token: string }> {
    const session = await open(token, on);
    const traded = await exchange(session.code);
    expect(traded.statusCode, traded.body).toBe(200);
    return { id: session.id, token: (traded.json() as { access_token: string }).access_token };
  }

  /** What the token gets from the workspace's API now. */
  async function chatsStatus(token: string): Promise<number> {
    const response = await tenant.get('/chats', { authorization: `Bearer ${token}` });
    return response.statusCode;
  }

  const sessionRow = (id: string) =>
    owner.platformImpersonationSession.findUniqueOrThrow({ where: { id } });

  const tokenRows = (sessionId: string) =>
    owner.apiToken.findMany({ where: { impersonationSessionId: sessionId } });

  const platformEntries = (action: string) =>
    owner.platformAuditLog.findMany({ where: { action }, orderBy: { chainSeq: 'asc' } });

  const tenantEnds = (licenseId: bigint) =>
    owner.auditLogEntry.findMany({
      where: { action: 'platform.impersonation_ended', licenseId },
      orderBy: { createdAt: 'asc' },
    });

  /** The session ended with `reason`, and every token it was traded for is revoked. */
  async function expectEnded(id: string, reason: string): Promise<void> {
    const row = await sessionRow(id);
    expect(row.endedAt, id).not.toBeNull();
    expect(row.endReason).toBe(reason);
    for (const token of await tokenRows(id)) expect(token.revokedAt, token.id).not.toBeNull();
    const read = await platform.app.inject({
      method: 'GET',
      url: `${PLATFORM_PREFIX}/support/impersonations/${id}`,
      headers: bearer(bossToken),
    });
    expect(read.json()).toMatchObject({ impersonation: { active: false, end_reason: reason } });
  }

  async function expectOpen(id: string): Promise<void> {
    const row = await sessionRow(id);
    expect(row.endedAt, id).toBeNull();
    expect(row.endReason).toBeNull();
    for (const token of await tokenRows(id)) expect(token.revokedAt, token.id).toBeNull();
  }

  /**
   * Hold `lock` in a transaction on the second connection, run `act` into it,
   * and let go once `act` is waiting for it — so the API's statement and the
   * held change meet in the one order the test is about.
   */
  async function whileHeld<T>(
    lock: (tx: PrismaClient) => Promise<unknown>,
    act: () => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = racer.$transaction(
      async (tx) => {
        await lock(tx as unknown as PrismaClient);
        held();
        await released;
      },
      { timeout: 30_000 },
    );
    await holding;
    const acted = act();
    try {
      await waitForLockWaiter();
    } finally {
      release();
      await holder;
    }
    return acted;
  }

  /** Until a backend of this database waits on a lock — the request has run into the held one. */
  async function waitForLockWaiter(): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    for (;;) {
      const [row] = await owner.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((row?.waiting ?? 0) > 0) return;
      if (Date.now() > deadline) throw new Error('nothing ran into the held lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  beforeAll(async () => {
    db = platformClient();
    racer = ownerClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000' },
      { now: clock.read, mailer: new MemoryMailer() },
    );
    tenant = await startTestServer();
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
    await racer?.$disconnect();
  });

  beforeEach(async () => {
    clock.now = Date.now();
    fx = await seedFixtures(owner);
    await clearRateLimits(tenant.app);
    boss = await createOperator(db, { role: 'superadmin', clock });
    bossToken = await openActiveSession(db, boss, clock);
    target = await createOperator(db, { role: 'superadmin', clock });
    targetToken = await openActiveSession(db, target, clock);
    bystander = await createOperator(db, { role: 'support', clock });
    bystanderToken = await openActiveSession(db, bystander, clock);
  });

  describe('disabling the operator', () => {
    it('ends every open session of theirs: the token is refused, both trails record each end, and another operator’s session stays', async () => {
      const full = await enter(targetToken, { mode: 'full', accountId: fx.a.ownerAccountId });
      // Not traded yet: its code must die with the operator too.
      const pending = await open(targetToken, { accountId: fx.a.agentAccountId });
      const kept = await enter(bystanderToken);
      expect(await chatsStatus(full.token)).toBe(200);
      expect(await chatsStatus(kept.token)).toBe(200);

      const disabled = await platformCall(`/admins/${target.id}/disable`, bossToken);
      expect(disabled.statusCode, disabled.body).toBe(200);
      expect(disabled.json()).toMatchObject({ id: target.id, active_sessions: 0 });

      expect(await chatsStatus(full.token)).toBe(401);
      await expectEnded(full.id, 'operator_disabled');
      await expectEnded(pending.id, 'operator_disabled');
      expect((await exchange(pending.code)).statusCode).toBe(401);
      expect(await owner.apiToken.count({ where: { impersonationSessionId: pending.id } })).toBe(0);
      // The other operator's session is no business of this change.
      expect(await chatsStatus(kept.token)).toBe(200);
      await expectOpen(kept.id);

      // The platform chain: the action, then one entry per session it ended —
      // the acting operator, the action's reason, the session's workspace.
      const [action] = await platformEntries('admin.disabled');
      expect(action).toMatchObject({
        adminId: boss.id,
        targetId: target.id,
        reason: REASON,
        payload: { impersonations_ended: 2 },
      });
      const ends = await platformEntries('impersonation.ended');
      expect(ends.map((entry) => entry.targetId).sort()).toEqual([full.id, pending.id].sort());
      for (const entry of ends) {
        expect(entry).toMatchObject({
          adminId: boss.id,
          targetType: 'impersonation',
          licenseId: fx.a.licenseId,
          reason: REASON,
          payload: { end_reason: 'operator_disabled', opened_by: target.id },
        });
        expect(entry.chainSeq).toBeGreaterThan(action!.chainSeq);
      }
      // The workspace's own trail: as SiyahTuş, without the reason.
      const trail = await tenantEnds(fx.a.licenseId);
      expect(trail.map((entry) => entry.target).sort()).toEqual(
        [`impersonation:${full.id}`, `impersonation:${pending.id}`].sort(),
      );
      for (const entry of trail) {
        expect(entry).toMatchObject({ actorType: 'platform', actorId: boss.id });
        expect(JSON.stringify(entry.metadata)).not.toContain(REASON);
      }

      // Enabling the operator again brings no session back.
      const enabled = await platformCall(`/admins/${target.id}/enable`, bossToken);
      expect(enabled.statusCode, enabled.body).toBe(200);
      expect(await chatsStatus(full.token)).toBe(401);
    });

    it('ends nothing that is over already — ended earlier, or past its window — and still records the action alone', async () => {
      const ranOut = await enter(targetToken);
      await owner.$executeRaw`
        UPDATE platform_impersonation_sessions
           SET started_at = now() - interval '1 hour', ends_at = now() - interval '1 second'
         WHERE id = ${ranOut.id}::uuid`;
      const endedEarlier = await enter(targetToken, { accountId: fx.a.ownerAccountId });
      const end = await platformCall(
        `/support/impersonations/${endedEarlier.id}/end`,
        bystanderToken,
      );
      expect(end.statusCode, end.body).toBe(200);

      const disabled = await platformCall(`/admins/${target.id}/disable`, bossToken);
      expect(disabled.statusCode, disabled.body).toBe(200);
      expect((await sessionRow(ranOut.id)).endReason).toBeNull();
      expect((await sessionRow(endedEarlier.id)).endReason).toBe('ended_by_operator');
      expect(
        await platformEntries('impersonation.ended').then((rows) =>
          rows.filter((row) => row.adminId === boss.id),
        ),
      ).toEqual([]);
      expect(await tenantEnds(fx.a.licenseId)).toHaveLength(1);
      const [action] = await platformEntries('admin.disabled');
      expect(action?.payload).toMatchObject({ impersonations_ended: 0 });
    });

    it('ends what an operator disabled some other way left open, when the root panel disables them', async () => {
      const session = await enter(targetToken);
      await owner.platformAdmin.update({
        where: { id: target.id },
        data: { disabledAt: new Date() },
      });
      await expectOpen(session.id);

      const disabled = await platformCall(`/admins/${target.id}/disable`, bossToken);
      expect(disabled.statusCode, disabled.body).toBe(200);
      await expectEnded(session.id, 'operator_disabled');
    });
  });

  describe('the floor: auth_resolve_token reads the operator', () => {
    it('refuses every token of a disabled operator, whatever disabled them — with the session itself still open', async () => {
      const full = await enter(targetToken, { mode: 'full', accountId: fx.a.ownerAccountId });
      const readOnly = await enter(targetToken, { tenant: fx.b });
      const kept = await enter(bystanderToken);
      expect(await chatsStatus(full.token)).toBe(200);

      // Not through the root panel: nothing ends the sessions.
      await owner.platformAdmin.update({
        where: { id: target.id },
        data: { disabledAt: new Date() },
      });
      await expectOpen(full.id);
      await expectOpen(readOnly.id);

      expect(await chatsStatus(full.token)).toBe(401);
      expect(await chatsStatus(readOnly.token)).toBe(401);
      const me = await tenant.get('/auth/me', { authorization: `Bearer ${full.token}` });
      expect(me.statusCode).toBe(401);
      expect(await chatsStatus(kept.token)).toBe(200);

      const [resolved] = await owner.$queryRaw<Array<{ revoked_at: Date | null }>>`
        SELECT revoked_at FROM auth_resolve_token(${hashToken(full.token)})`;
      expect(resolved?.revoked_at).not.toBeNull();
    });
  });

  describe('revoking the operator’s sessions', () => {
    it('ends their sessions in every workspace, each recorded in its own trail, and keeps the operator', async () => {
      const inA = await enter(targetToken);
      const inB = await enter(targetToken, { tenant: fx.b });
      const kept = await enter(bystanderToken);

      const revoked = await platformCall(`/admins/${target.id}/revoke-sessions`, bossToken);
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(revoked.json()).toEqual({ ended: 1 });

      expect(await chatsStatus(inA.token)).toBe(401);
      expect(await chatsStatus(inB.token)).toBe(401);
      await expectEnded(inA.id, 'operator_sessions_revoked');
      await expectEnded(inB.id, 'operator_sessions_revoked');
      expect(await chatsStatus(kept.token)).toBe(200);
      await expectOpen(kept.id);

      const [action] = await platformEntries('admin.sessions_revoked');
      expect(action).toMatchObject({
        targetId: target.id,
        payload: { ended: 1, impersonations_ended: 2 },
      });
      const ends = await platformEntries('impersonation.ended');
      expect(ends.map((entry) => [entry.targetId, entry.licenseId])).toEqual(
        expect.arrayContaining([
          [inA.id, fx.a.licenseId],
          [inB.id, fx.b.licenseId],
        ]),
      );
      expect((await tenantEnds(fx.a.licenseId)).map((entry) => entry.target)).toEqual([
        `impersonation:${inA.id}`,
      ]);
      expect((await tenantEnds(fx.b.licenseId)).map((entry) => entry.target)).toEqual([
        `impersonation:${inB.id}`,
      ]);
      // Still an operator: not disabled, and a new sign-in opens sessions again.
      expect(
        (await owner.platformAdmin.findUniqueOrThrow({ where: { id: target.id } })).disabledAt,
      ).toBeNull();
      const again = await enter(await openActiveSession(db, target, clock));
      expect(await chatsStatus(again.token)).toBe(200);
    });
  });

  describe('changing the operator’s role', () => {
    it('ends only what the new role may not hold: superadmin → support ends a full session and keeps a read-only one', async () => {
      const full = await enter(targetToken, { mode: 'full', accountId: fx.a.ownerAccountId });
      const readOnly = await enter(targetToken);

      const demoted = await platformCall(`/admins/${target.id}/role`, bossToken, {
        role: 'support',
      });
      expect(demoted.statusCode, demoted.body).toBe(200);

      expect(await chatsStatus(full.token)).toBe(401);
      await expectEnded(full.id, 'operator_role_changed');
      expect(await chatsStatus(readOnly.token)).toBe(200);
      await expectOpen(readOnly.id);

      const [action] = await platformEntries('admin.role_changed');
      expect(action).toMatchObject({
        payload: { from: 'superadmin', to: 'support', impersonations_ended: 1 },
      });
      const ends = await platformEntries('impersonation.ended');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toMatchObject({
        targetId: full.id,
        payload: { mode: 'full', end_reason: 'operator_role_changed' },
      });
      expect(await tenantEnds(fx.a.licenseId)).toHaveLength(1);

      // support → readonly: the read-only session goes too.
      const again = await platformCall(`/admins/${target.id}/role`, bossToken, {
        role: 'readonly',
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(await chatsStatus(readOnly.token)).toBe(401);
      await expectEnded(readOnly.id, 'operator_role_changed');
    });

    it('ends nothing on a role that still holds every open session — a promotion, or the role they have', async () => {
      const readOnly = await enter(bystanderToken);

      const same = await platformCall(`/admins/${bystander.id}/role`, bossToken, {
        role: 'support',
      });
      expect(same.statusCode, same.body).toBe(200);
      const promoted = await platformCall(`/admins/${bystander.id}/role`, bossToken, {
        role: 'superadmin',
      });
      expect(promoted.statusCode, promoted.body).toBe(200);

      expect(await chatsStatus(readOnly.token)).toBe(200);
      await expectOpen(readOnly.id);
      expect(await platformEntries('impersonation.ended')).toEqual([]);
      const changes = await platformEntries('admin.role_changed');
      expect(changes.map((entry) => entry.payload)).toEqual([
        { from: 'support', to: 'support', impersonations_ended: 0 },
        { from: 'support', to: 'superadmin', impersonations_ended: 0 },
      ]);
    });

    it('ends every session below support: superadmin → billing', async () => {
      const full = await enter(targetToken, { mode: 'full', accountId: fx.a.ownerAccountId });
      const readOnly = await enter(targetToken);
      const demoted = await platformCall(`/admins/${target.id}/role`, bossToken, {
        role: 'billing',
      });
      expect(demoted.statusCode, demoted.body).toBe(200);
      await expectEnded(full.id, 'operator_role_changed');
      await expectEnded(readOnly.id, 'operator_role_changed');
      expect(await chatsStatus(readOnly.token)).toBe(401);
    });
  });

  describe('a session opened while its operator changes', () => {
    it('is refused when the operator is disabled while it waits', async () => {
      const response = await whileHeld(
        (tx) => tx.$executeRaw`
          UPDATE platform_admins SET disabled_at = now() WHERE id = ${target.id}::uuid`,
        () => startRequest(targetToken),
      );
      expect(response.statusCode, response.body).toBe(401);
      expect(await owner.platformImpersonationSession.count()).toBe(0);
    });

    it('is refused in a mode the role it waited for may not hold', async () => {
      const response = await whileHeld(
        (tx) => tx.$executeRaw`
          UPDATE platform_admins SET role = 'support' WHERE id = ${target.id}::uuid`,
        () => startRequest(targetToken, { mode: 'full', accountId: fx.a.ownerAccountId }),
      );
      expect(response.statusCode, response.body).toBe(403);
      expect((response.json() as { error: { type: string } }).error.type).toBe('authorization');
      expect(await owner.platformImpersonationSession.count()).toBe(0);
    });

    it('is refused when the operator’s sessions are revoked while it waits', async () => {
      const response = await whileHeld(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM platform_admins WHERE id = ${target.id}::uuid FOR NO KEY UPDATE`;
          await tx.$executeRaw`DELETE FROM platform_sessions WHERE admin_id = ${target.id}::uuid`;
        },
        () => startRequest(targetToken),
      );
      expect(response.statusCode, response.body).toBe(401);
      expect(await owner.platformImpersonationSession.count()).toBe(0);
    });

    for (const [path, reason] of [
      ['disable', 'operator_disabled'],
      ['revoke-sessions', 'operator_sessions_revoked'],
    ] as const) {
      it(`is ended by a ${path} that waited for it to commit`, async () => {
        // What `startImpersonation` holds while it writes: the operator's row
        // `FOR SHARE`, and the new session.
        let opened = '';
        const response = await whileHeld(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM platform_admins WHERE id = ${target.id}::uuid FOR SHARE`;
            const [row] = await tx.$queryRaw<Array<{ id: string }>>`
              INSERT INTO platform_impersonation_sessions
                (id, admin_id, license_id, account_id, mode, started_at, ends_at)
              VALUES (gen_random_uuid(), ${target.id}::uuid, ${fx.a.licenseId},
                      ${fx.a.agentAccountId}::uuid, 'read_only',
                      date_trunc('milliseconds', now()), now() + interval '30 minutes')
              RETURNING id::text AS id`;
            opened = row!.id;
          },
          () => platformCall(`/admins/${target.id}/${path}`, bossToken),
        );
        expect(response.statusCode, response.body).toBe(200);
        await expectEnded(opened, reason);
      });
    }
  });
});
