/**
 * Operator sign-in, sessions and RBAC of the root panel (tm 389.4 ·
 * FR-ADMIN-01…04 · docs/platform-admin/design.md §A, §C auth/admins).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3); the letters (a)–(i) are the task's
 * acceptance list.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadPlatformOpenApiDocument } from '@siyahtus/contract';
import {
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  platformRoleHas,
  type PlatformRole,
} from '@siyahtus/types';
import { buildPlatformServer, PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  bootstrapPlatformAdmin,
  PlatformBootstrapRefused,
} from '../../src/services/platform/bootstrap-admin.js';
import { ownerClient, platformClient, resetDatabase, testEnv } from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  MINUTE,
  nextCode,
  openActiveSession,
  TestClock,
  type TestOperator,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { HTTP_METHODS } from '../helpers/route-inventory.js';

type Headers = Record<string, string>;

interface Harness {
  server: PlatformTestServer;
  clock: TestClock;
  mailer: MemoryMailer;
  request: (
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; headers?: Headers },
  ) => Promise<LightMyRequestResponse>;
}

async function harness(env: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  const clock = new TestClock();
  const mailer = new MemoryMailer();
  const server = await buildPlatformTestServer(env, { now: clock.read, mailer });
  return {
    server,
    clock,
    mailer,
    request: (method, path, options = {}) =>
      server.app.inject({
        method: method.toUpperCase() as 'GET',
        url: `${PLATFORM_PREFIX}${path}`,
        headers: {
          ...(options.token ? bearer(options.token) : {}),
          ...(options.headers ?? {}),
        },
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      }),
  };
}

async function clearRateLimits(app: FastifyInstance): Promise<void> {
  const keys = await app.redis.keys('rl:*');
  if (keys.length > 0) await app.redis.del(...keys);
}

function errorType(response: LightMyRequestResponse): string | undefined {
  try {
    return (response.json() as { error?: { type?: string } }).error?.type;
  } catch {
    return undefined;
  }
}

/** Password, then a code: an active session's token, the way the SPA gets one. */
async function signIn(h: Harness, operator: TestOperator): Promise<string> {
  const login = await h.request('POST', '/auth/login', {
    body: { email: operator.email, password: operator.password },
  });
  expect(login.statusCode, login.body).toBe(200);
  const verify = await h.request('POST', '/auth/totp/verify', {
    token: login.json().token,
    body: { code: nextCode(operator, h.clock) },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  return verify.json().token as string;
}

const reason = { reason: 'tm 389.4 test' };

// TRUNCATE needs the owner; everything else in this file runs as the platform role.
const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('operator sign-in (tm 389.4)', () => {
  let h: Harness;
  let db: PrismaClient;

  beforeAll(async () => {
    db = platformClient();
    h = await harness();
  });
  afterAll(async () => {
    await h?.server.close();
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(h.server.app);
    h.mailer.clear();
  });

  it('(a) a password alone opens a password-stage session that reaches no business route; the code makes it active under a new token', async () => {
    const operator = await createOperator(db, { clock: h.clock });

    const login = await h.request('POST', '/auth/login', {
      body: { email: operator.email.toUpperCase(), password: operator.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json()).toMatchObject({ next: 'totp_verify', session: { stage: 'password' } });
    const passwordToken = login.json().token as string;

    for (const [method, path] of [
      ['GET', '/admins'],
      ['GET', '/auth/me'],
      ['GET', '/auth/sessions'],
    ] as const) {
      const refused = await h.request(method, path, { token: passwordToken });
      expect(refused.statusCode, path).toBe(403);
      expect(refused.json().error).toMatchObject({
        type: 'platform_totp_required',
        details: { next: 'totp_verify' },
      });
    }

    const verify = await h.request('POST', '/auth/totp/verify', {
      token: passwordToken,
      body: { code: nextCode(operator, h.clock) },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    expect(verify.json()).toMatchObject({ method: 'totp', session: { stage: 'active' } });
    const activeToken = verify.json().token as string;
    expect(activeToken).not.toBe(passwordToken);

    expect((await h.request('GET', '/admins', { token: passwordToken })).statusCode).toBe(401);
    const admins = await h.request('GET', '/admins', { token: activeToken });
    expect(admins.statusCode).toBe(200);
    expect(admins.json().data.map((a: { email: string }) => a.email)).toEqual([operator.email]);

    // The session row stores a hash, never the token.
    const rows = await db.platformSession.findMany({ where: { adminId: operator.id } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(activeToken);
  });

  it('(a) refuses a wrong password, an unknown address and a disabled operator with one answer', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const disabled = await createOperator(db, { clock: h.clock, disabled: true });
    for (const body of [
      { email: operator.email, password: 'not-the-password' },
      { email: 'nobody@ops.siyahtus.test', password: operator.password },
      { email: disabled.email, password: disabled.password },
    ]) {
      const response = await h.request('POST', '/auth/login', { body });
      expect(response.statusCode, body.email).toBe(401);
      expect(response.json().error.message).toBe('Invalid email or password.');
    }
  });

  it('(a) an operator without an authenticator can only enroll one, then is active with ten recovery codes', async () => {
    const operator = await createOperator(db, { clock: h.clock, enrolled: false });
    const login = await h.request('POST', '/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    expect(login.json().next).toBe('totp_enroll');
    const token = login.json().token as string;

    const verify = await h.request('POST', '/auth/totp/verify', {
      token,
      body: { code: '123456' },
    });
    expect(verify.statusCode).toBe(403);
    expect(verify.json().error).toMatchObject({
      type: 'platform_totp_required',
      details: { next: 'totp_enroll' },
    });

    const enroll = await h.request('POST', '/auth/totp/enroll', { token });
    expect(enroll.statusCode, enroll.body).toBe(200);
    const { secret, otpauth_uri } = enroll.json() as { secret: string; otpauth_uri: string };
    expect(otpauth_uri).toContain('SiyahTu%C5%9F%20Platform');
    const stored = await db.platformAdmin.findUniqueOrThrow({ where: { id: operator.id } });
    expect(stored.totpEnrolledAt).toBeNull();
    expect(stored.totpSecretCiphertext).not.toContain(secret);

    const wrong = await h.request('POST', '/auth/totp/activate', {
      token,
      body: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);

    const enrolled = { ...operator, secret };
    const activate = await h.request('POST', '/auth/totp/activate', {
      token,
      body: { code: nextCode(enrolled, h.clock) },
    });
    expect(activate.statusCode, activate.body).toBe(200);
    expect(activate.json().session.stage).toBe('active');
    expect(activate.json().recovery_codes).toHaveLength(10);
    const active = activate.json().token as string;
    expect((await h.request('GET', '/auth/me', { token: active })).statusCode).toBe(200);

    // Enrolled now: a second password session cannot swap the authenticator.
    const again = await h.request('POST', '/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    expect(again.json().next).toBe('totp_verify');
    const swap = await h.request('POST', '/auth/totp/enroll', { token: again.json().token });
    expect(swap.statusCode).toBe(409);
    expect(errorType(swap)).toBe('two_factor_already_enabled');
  });

  it('(a) accepts a code once: the same code on a second sign-in is refused', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const code = nextCode(operator, h.clock);
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const login = await h.request('POST', '/auth/login', {
        body: { email: operator.email, password: operator.password },
      });
      tokens.push(login.json().token);
    }
    const first = await h.request('POST', '/auth/totp/verify', {
      token: tokens[0],
      body: { code },
    });
    const second = await h.request('POST', '/auth/totp/verify', {
      token: tokens[1],
      body: { code },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
  });

  it('(a) lets one of several simultaneous presentations of a code win — the database decides, not the read', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) {
      const login = await h.request('POST', '/auth/login', {
        body: { email: operator.email, password: operator.password },
      });
      tokens.push(login.json().token);
    }
    const code = nextCode(operator, h.clock);
    const auth = h.server.app.platformAuth;
    const sessions = await Promise.all(tokens.map((token) => auth.resolve(token)));
    // Started in one tick, so every verification reads the same replay floor
    // (none yet) before any of them writes; only the conditional UPDATE can
    // tell them apart. Over HTTP the requests drift apart and a read-then-write
    // bug would hide behind the timing.
    const outcomes = await Promise.all(
      sessions.map((resolution) => {
        if (!resolution.ok) throw new Error(`session did not resolve: ${resolution.reason}`);
        return auth.verify(resolution.session, { code });
      }),
    );
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
  });

  it('(b) ends a session after fifteen idle minutes, and every request moves the idle clock', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const token = await signIn(h, operator);

    h.clock.advance(14 * MINUTE);
    expect((await h.request('GET', '/auth/me', { token })).statusCode).toBe(200);
    h.clock.advance(14 * MINUTE);
    expect((await h.request('GET', '/auth/me', { token })).statusCode).toBe(200);

    h.clock.advance(16 * MINUTE);
    const idle = await h.request('GET', '/auth/me', { token });
    expect(idle.statusCode).toBe(401);
    expect(idle.json().error.message).toMatch(/session has ended/);
    // Deleted, not merely refused: it cannot come back.
    expect(await db.platformSession.count({ where: { adminId: operator.id } })).toBe(0);
  });

  it('(c) a destructive route refuses a six-minute-old code; reverify, and it goes through', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const other = await createOperator(db, { clock: h.clock });
    const token = await signIn(h, operator);

    h.clock.advance(6 * MINUTE);
    const stale = await h.request('POST', `/admins/${other.id}/disable`, { token, body: reason });
    expect(stale.statusCode).toBe(403);
    expect(errorType(stale)).toBe('platform_recent_totp_required');

    const wrong = await h.request('POST', '/auth/totp/reverify', {
      token,
      body: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    const reverify = await h.request('POST', '/auth/totp/reverify', {
      token,
      body: { code: nextCode(operator, h.clock) },
    });
    expect(reverify.statusCode, reverify.body).toBe(200);

    const fresh = await h.request('POST', `/admins/${other.id}/disable`, { token, body: reason });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json().disabled_at).not.toBeNull();
  });

  it('(d) a recovery code signs in once; a new sheet retires the old one', async () => {
    const operator = await createOperator(db, { clock: h.clock, enrolled: false });
    // Enrol through the API so the sheet is real.
    const login = await h.request('POST', '/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    const enroll = await h.request('POST', '/auth/totp/enroll', { token: login.json().token });
    const enrolled = { ...operator, secret: enroll.json().secret as string };
    const activate = await h.request('POST', '/auth/totp/activate', {
      token: login.json().token,
      body: { code: nextCode(enrolled, h.clock) },
    });
    const sheet = activate.json().recovery_codes as string[];
    const active = activate.json().token as string;

    const useCode = async (code: string): Promise<LightMyRequestResponse> => {
      const again = await h.request('POST', '/auth/login', {
        body: { email: operator.email, password: operator.password },
      });
      return h.request('POST', '/auth/totp/verify', {
        token: again.json().token,
        body: { recovery_code: code.toLowerCase().replace('-', ' ') },
      });
    };

    const first = await useCode(sheet[0]!);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ method: 'recovery_code', recovery_codes_remaining: 9 });
    expect((await useCode(sheet[0]!)).statusCode).toBe(401);

    const regenerate = await h.request('POST', '/auth/recovery/regenerate', { token: active });
    expect(regenerate.statusCode, regenerate.body).toBe(200);
    const fresh = regenerate.json().recovery_codes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(sheet[1]);
    expect((await useCode(sheet[1]!)).statusCode).toBe(401);
    expect((await useCode(fresh[0]!)).statusCode).toBe(200);
  });

  it('(f) ten failed sign-ins from one address close the door for that address — a correct password included', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < 10; i++) {
      const failed = await h.request('POST', '/auth/login', {
        headers: from('198.51.100.20'),
        body: { email: operator.email, password: `wrong-${i}` },
      });
      expect(failed.statusCode, `attempt ${i + 1}`).toBe(401);
    }
    const locked = await h.request('POST', '/auth/login', {
      headers: from('198.51.100.20'),
      body: { email: operator.email, password: operator.password },
    });
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    const elsewhere = await h.request('POST', '/auth/login', {
      headers: from('198.51.100.21'),
      body: { email: operator.email, password: operator.password },
    });
    expect(elsewhere.statusCode).toBe(200);
  });

  it('(f) a successful sign-in gives its slot back', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    for (let i = 0; i < 12; i++) {
      const ok = await h.request('POST', '/auth/login', {
        body: { email: operator.email, password: operator.password },
      });
      expect(ok.statusCode, `sign-in ${i + 1}`).toBe(200);
    }
  });

  it('(h) an invitation is mailed, accepted with a password, and still demands an authenticator before anything opens', async () => {
    const inviter = await createOperator(db, { clock: h.clock });
    const token = await signIn(h, inviter);

    const invite = await h.request('POST', '/admins/invites', {
      token,
      body: { email: 'New.Operator@ops.siyahtus.test', role: 'support', ...reason },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    expect(invite.json()).toMatchObject({
      mail: 'sent',
      invite: { email: 'new.operator@ops.siyahtus.test', role: 'support', invited_by: inviter.id },
    });
    expect(invite.json()).not.toHaveProperty('accept_url');

    const mail = h.mailer.sent.find((m) => m.kind === 'platform_invitation');
    expect(mail?.to).toBe('new.operator@ops.siyahtus.test');
    const link = /https?:\/\/\S+\/invite#token=([A-Za-z0-9_-]+)/.exec(mail!.body);
    expect(link, mail!.body).not.toBeNull();
    const inviteToken = link![1]!;
    // Only the hash is stored.
    expect(JSON.stringify(await db.platformAdminInvite.findMany())).not.toContain(inviteToken);

    const short = await h.request('POST', '/auth/invite/accept', {
      body: { token: inviteToken, password: 'short' },
    });
    expect(short.statusCode).toBe(400);

    const accept = await h.request('POST', '/auth/invite/accept', {
      body: { token: inviteToken, password: 'a-good-long-operator-password' },
    });
    expect(accept.statusCode, accept.body).toBe(200);
    expect(accept.json()).toMatchObject({ next: 'totp_enroll', session: { stage: 'password' } });
    const pending = accept.json().token as string;
    const refused = await h.request('GET', '/auth/me', { token: pending });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toEqual({ next: 'totp_enroll' });

    const enroll = await h.request('POST', '/auth/totp/enroll', { token: pending });
    const newcomer: TestOperator = {
      id: '',
      email: 'new.operator@ops.siyahtus.test',
      password: 'a-good-long-operator-password',
      role: 'support',
      secret: enroll.json().secret,
    };
    const activate = await h.request('POST', '/auth/totp/activate', {
      token: pending,
      body: { code: nextCode(newcomer, h.clock) },
    });
    expect(activate.statusCode, activate.body).toBe(200);
    const me = await h.request('GET', '/auth/me', { token: activate.json().token });
    expect(me.json().admin).toMatchObject({ email: newcomer.email, role: 'support' });
    expect(me.json().permissions).toContain('accounts.support');
    expect(me.json().permissions).not.toContain('admins.manage');

    // Single use.
    const twice = await h.request('POST', '/auth/invite/accept', {
      body: { token: inviteToken, password: 'a-good-long-operator-password' },
    });
    expect(twice.statusCode).toBe(401);
  });

  it('(h) refuses an expired or withdrawn invitation, and an address that is already an operator', async () => {
    const inviter = await createOperator(db, { clock: h.clock });
    const token = await signIn(h, inviter);

    const exists = await h.request('POST', '/admins/invites', {
      token,
      body: { email: inviter.email, role: 'readonly', ...reason },
    });
    expect(exists.statusCode).toBe(409);
    expect(errorType(exists)).toBe('account_exists');

    const tokenOf = async (email: string): Promise<string> => {
      const response = await h.request('POST', '/admins/invites', {
        token,
        body: { email, role: 'readonly', ...reason },
      });
      expect(response.statusCode, response.body).toBe(201);
      const mail = h.mailer.sent.filter((m) => m.to === email).at(-1)!;
      return /#token=([A-Za-z0-9_-]+)/.exec(mail.body)![1]!;
    };

    const first = await tokenOf('late@ops.siyahtus.test');
    const second = await tokenOf('late@ops.siyahtus.test');
    // The newer invitation withdrew the older one.
    const old = await h.request('POST', '/auth/invite/accept', {
      body: { token: first, password: 'a-good-long-operator-password' },
    });
    expect(old.statusCode).toBe(401);

    h.clock.advance(73 * 60 * MINUTE);
    const expired = await h.request('POST', '/auth/invite/accept', {
      body: { token: second, password: 'a-good-long-operator-password' },
    });
    expect(expired.statusCode).toBe(401);
  });

  it('(i) never leaves the platform without an active superadmin — even when two demote each other at once', async () => {
    const only = await createOperator(db, { clock: h.clock });
    const token = await signIn(h, only);

    for (const [path, body] of [
      [`/admins/${only.id}/disable`, reason],
      [`/admins/${only.id}/role`, { role: 'readonly', ...reason }],
    ] as const) {
      const refused = await h.request('POST', path, { token, body });
      expect(refused.statusCode, path).toBe(409);
      expect(errorType(refused)).toBe('platform_last_superadmin');
    }

    const second = await createOperator(db, { clock: h.clock });
    const secondToken = await openActiveSession(db, second, h.clock);
    const [a, b] = await Promise.all([
      h.request('POST', `/admins/${second.id}/disable`, { token, body: reason }),
      h.request('POST', `/admins/${only.id}/disable`, { token: secondToken, body: reason }),
    ]);
    // One wins. The other is refused by the guard (409) — or, had the winner
    // disabled its caller first, by the ended session (401). Never both 200.
    expect([a.statusCode, b.statusCode].filter((status) => status === 200)).toHaveLength(1);
    const loser = [a.statusCode, b.statusCode].find((status) => status !== 200);
    expect([401, 409]).toContain(loser);
    expect(await db.platformAdmin.count({ where: { role: 'superadmin', disabledAt: null } })).toBe(
      1,
    );
  });

  it('a disabled operator, a changed role and a reset authenticator all end the sessions that held the old facts', async () => {
    const boss = await createOperator(db, { clock: h.clock });
    const bossToken = await openActiveSession(db, boss, h.clock);
    const target = await createOperator(db, { clock: h.clock, role: 'support' });

    let targetToken = await signIn(h, target);
    expect((await h.request('GET', '/admins', { token: targetToken })).statusCode).toBe(200);
    const role = await h.request('POST', `/admins/${target.id}/role`, {
      token: bossToken,
      body: { role: 'billing', ...reason },
    });
    expect(role.statusCode, role.body).toBe(200);
    expect(role.json().role).toBe('billing');
    expect((await h.request('GET', '/admins', { token: targetToken })).statusCode).toBe(401);
    targetToken = await signIn(h, { ...target, role: 'billing' });
    // Billing may not read the operator list.
    const billing = await h.request('GET', '/admins', { token: targetToken });
    expect(billing.statusCode).toBe(403);
    expect(billing.json().error).toMatchObject({
      type: 'authorization',
      details: { permission: 'admins.read' },
    });

    const reset = await h.request('POST', `/admins/${target.id}/reset-two-factor`, {
      token: bossToken,
      body: reason,
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json()).toMatchObject({ totp_enrolled: false, active_sessions: 0 });
    expect((await h.request('GET', '/auth/me', { token: targetToken })).statusCode).toBe(401);
    const relogin = await h.request('POST', '/auth/login', {
      body: { email: target.email, password: target.password },
    });
    expect(relogin.json().next).toBe('totp_enroll');

    await h.request('POST', `/admins/${target.id}/disable`, { token: bossToken, body: reason });
    const blocked = await h.request('POST', '/auth/login', {
      body: { email: target.email, password: target.password },
    });
    expect(blocked.statusCode).toBe(401);
    const enabled = await h.request('POST', `/admins/${target.id}/enable`, {
      token: bossToken,
      body: reason,
    });
    expect(enabled.json().disabled_at).toBeNull();
    expect(
      (
        await h.request('POST', '/auth/login', {
          body: { email: target.email, password: target.password },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('lists the operator’s own sessions, ends the others, and signs out', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const one = await signIn(h, operator);
    const two = await signIn(h, operator);

    const list = await h.request('GET', '/auth/sessions', { token: one });
    expect(list.json().data).toHaveLength(2);
    expect(list.json().data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const ended = await h.request('DELETE', '/auth/sessions', { token: one });
    expect(ended.json()).toEqual({ ended: 1 });
    expect((await h.request('GET', '/auth/me', { token: two })).statusCode).toBe(401);

    const logout = await h.request('POST', '/auth/logout', { token: one });
    expect(logout.statusCode).toBe(204);
    expect((await h.request('GET', '/auth/me', { token: one })).statusCode).toBe(401);

    // Sign-out works from the password stage too.
    const login = await h.request('POST', '/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    expect(
      (await h.request('POST', '/auth/logout', { token: login.json().token })).statusCode,
    ).toBe(204);
  });

  it('charges tokens nobody holds to the address and refuses it before the lookup once spent', async () => {
    const limit = testEnv().RATE_LIMIT_AUTH_FAILURES_PER_MIN;
    const forged = 'A'.repeat(43);
    const from = { 'x-forwarded-for': '198.51.100.40' };
    for (let i = 0; i < limit; i++) {
      const response = await h.request('GET', '/auth/me', { token: forged, headers: from });
      expect(response.statusCode).toBe(401);
    }
    const refused = await h.request('GET', '/auth/me', { token: forged, headers: from });
    expect(refused.statusCode).toBe(429);
  });

  it('binds the operator to the log line that closes the request', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const token = await openActiveSession(db, operator, h.clock);
    const lines: string[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n')));
    const logged = await buildPlatformTestServer(
      { LOG_LEVEL: 'info' },
      { now: h.clock.read, logStream: stream },
    );
    try {
      const response = await logged.get('/auth/me', bearer(token));
      expect(response.statusCode).toBe(200);
    } finally {
      await logged.close();
    }
    const completed = lines
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line['msg'] === 'request completed');
    expect(completed?.['platform_admin_id']).toBe(operator.id);
    expect(lines.join('\n')).not.toContain(token);
  });
});

describe('the permission matrix over every documented route (tm 389.4 · (e))', () => {
  let h: Harness;
  let db: PrismaClient;

  beforeAll(async () => {
    db = platformClient();
    h = await harness();
  });
  afterAll(async () => {
    await h?.server.close();
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(h.server.app);
  });

  interface DocumentedOperation {
    method: string;
    path: string;
    isPublic: boolean;
    permission: string | undefined;
    stage: string | undefined;
    recentTotp: boolean;
    /** A POST that changes nothing (tm 389.5) — a read permission may guard it. */
    safe: boolean;
  }

  function documented(): DocumentedOperation[] {
    const out: DocumentedOperation[] = [];
    for (const [path, item] of Object.entries(loadPlatformOpenApiDocument().paths)) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Record<string, unknown> | undefined>)[method];
        if (!op) continue;
        out.push({
          method,
          path,
          isPublic: Array.isArray(op['security']) && (op['security'] as unknown[]).length === 0,
          permission: op['x-platform-permission'] as string | undefined,
          stage: op['x-platform-stage'] as string | undefined,
          recentTotp: op['x-platform-recent-totp'] === true,
          safe: op['x-platform-safe'] === true,
        });
      }
    }
    return out;
  }

  const concrete = (path: string): string => path.replace(/\{[^}]+\}/g, () => randomUUID());
  const send = (op: DocumentedOperation, token?: string) =>
    h.request(op.method, concrete(op.path), {
      ...(token ? { token } : {}),
      ...(op.method === 'get' ? {} : { body: {} }),
    });

  it('documents a gate for every operation, and every gate is a real permission', () => {
    const ops = documented();
    expect(ops.length).toBeGreaterThanOrEqual(23);
    for (const op of ops) {
      const where = `${op.method} ${op.path}`;
      if (op.isPublic) {
        expect(op.permission, where).toBeUndefined();
        continue;
      }
      expect(op.permission, where).toBeDefined();
      if (op.permission !== 'self') {
        expect(Object.keys(PLATFORM_PERMISSIONS), where).toContain(op.permission);
        if (op.method !== 'get' && !op.safe) {
          expect(
            PLATFORM_PERMISSIONS[op.permission as keyof typeof PLATFORM_PERMISSIONS].kind,
            where,
          ).toBe('write');
        }
      }
    }
  });

  it('answers each role on each permission route exactly as the matrix says — readonly gets no 2xx on any mutation', async () => {
    const ops = documented().filter((op) => !op.isPublic && op.permission !== 'self');
    expect(ops.length).toBeGreaterThanOrEqual(10);
    const tokens = new Map<PlatformRole, string>();
    for (const role of PLATFORM_ROLES) {
      tokens.set(
        role,
        await openActiveSession(db, await createOperator(db, { role, clock: h.clock }), h.clock),
      );
    }

    const mismatches: string[] = [];
    for (const role of PLATFORM_ROLES) {
      // Every request comes from one address, and four roles over every documented route are
      // more than `rl:platform:<ip>`'s 300 a minute (tm 389.15 took it past): each role's pass
      // gets its own budget, so a 429 here is a real answer and not the suite's own volume.
      await clearRateLimits(h.server.app);
      for (const op of ops) {
        const response = await send(op, tokens.get(role));
        const where = `${role} ${op.method.toUpperCase()} ${op.path} → ${response.statusCode} ${errorType(response) ?? ''}`;
        const allowed = platformRoleHas(role, op.permission!);
        const forbidden = response.statusCode === 403 && errorType(response) === 'authorization';
        if (allowed === forbidden) mismatches.push(where);
        if (response.statusCode === 401) mismatches.push(where);
        if (role === 'readonly' && op.method !== 'get' && !op.safe && response.statusCode < 300) {
          mismatches.push(`${where} (readonly mutation succeeded)`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('asks every recent-TOTP route, and only those, for a fresh code once five minutes have passed', async () => {
    const superadmin = await createOperator(db, { clock: h.clock });
    const token = await openActiveSession(db, superadmin, h.clock);
    h.clock.advance(6 * MINUTE);
    const ops = documented().filter((op) => !op.isPublic && !op.stage);
    expect(ops.filter((op) => op.recentTotp).length).toBeGreaterThanOrEqual(6);
    const wrong: string[] = [];
    for (const op of ops) {
      const response = await send(op, token);
      const asked = errorType(response) === 'platform_recent_totp_required';
      if (asked !== op.recentTotp) wrong.push(`${op.method} ${op.path} → ${response.statusCode}`);
    }
    expect(wrong).toEqual([]);
  });

  it('refuses a password-stage session on every route that does not name its stage, and every route without a session', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const login = await h.request('POST', '/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    const passwordToken = login.json().token as string;

    const wrong: string[] = [];
    for (const op of documented()) {
      if (op.isPublic) continue;
      const anonymous = await send(op);
      if (anonymous.statusCode !== 401)
        wrong.push(`anonymous ${op.method} ${op.path} → ${anonymous.statusCode}`);
      if (op.stage) continue;
      const response = await send(op, passwordToken);
      if (errorType(response) !== 'platform_totp_required') {
        wrong.push(`password-stage ${op.method} ${op.path} → ${response.statusCode}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the platform network allow-list (tm 389.4 · (f))', () => {
  let h: Harness;
  let db: PrismaClient;

  beforeAll(async () => {
    db = platformClient();
    h = await harness({ PLATFORM_IP_ALLOWLIST: '203.0.113.0/24' });
  });
  afterAll(async () => {
    await h?.server.close();
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(h.server.app);
  });

  it('refuses every address outside the list — before the sign-in — and leaves the probes open', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const body = { email: operator.email, password: operator.password };

    const outside = await h.request('POST', '/auth/login', { body });
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error).toMatchObject({
      type: 'not_allowed',
      details: { reason: 'ip_not_allowed' },
    });
    expect((await h.request('GET', '/meta')).statusCode).toBe(403);
    expect((await h.request('GET', '/health/live')).statusCode).toBe(200);
    expect((await h.request('GET', '/health/ready')).statusCode).toBe(200);

    const inside = await h.request('POST', '/auth/login', {
      body,
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(inside.statusCode, inside.body).toBe(200);
    // A token from inside does not carry the caller outside.
    const token = inside.json().token as string;
    expect((await h.request('POST', '/auth/logout', { token })).statusCode).toBe(403);
  });
});

describe('the absolute session lifetime (tm 389.4 · (b))', () => {
  let h: Harness;
  let db: PrismaClient;

  beforeAll(async () => {
    db = platformClient();
    h = await harness({ PLATFORM_SESSION_TTL: '1800', PLATFORM_IDLE_TTL: '900' });
  });
  afterAll(async () => {
    await h?.server.close();
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(h.server.app);
  });

  it('ends a busy session at PLATFORM_SESSION_TTL however recently it was used', async () => {
    const operator = await createOperator(db, { clock: h.clock });
    const loginAt = h.clock.now;
    const token = await signIn(h, operator);
    const me = await h.request('GET', '/auth/me', { token });
    expect(Date.parse(me.json().session.expires_at)).toBe(loginAt + 1800 * 1000);

    while (h.clock.now + 10 * MINUTE < loginAt + 1800 * 1000) {
      h.clock.advance(10 * MINUTE);
      expect((await h.request('GET', '/auth/me', { token })).statusCode).toBe(200);
    }
    h.clock.advance(10 * MINUTE);
    expect((await h.request('GET', '/auth/me', { token })).statusCode).toBe(401);
  });
});

describe('route declarations are checked at boot (tm 389.4)', () => {
  it('refuses a public route that also names a permission, and a route that names neither', async () => {
    const app = await buildPlatformServer({ env: testEnv() });
    try {
      expect(() =>
        app.get(
          '/platform/v1/contradiction',
          { config: { public: true, platform: { permission: 'admins.read' } } },
          async () => ({}),
        ),
      ).toThrow(/public route cannot also declare/);
      expect(() => app.get('/platform/v1/forgotten', async () => ({}))).toThrow(
        /declares config.platform.permission/,
      );
      expect(() =>
        app.post(
          '/platform/v1/read-guarded-write',
          { config: { platform: { permission: 'admins.read' } } },
          async () => ({}),
        ),
      ).toThrow(/write permission/);
    } finally {
      await app.close();
    }
  });
});

describe('the first superadmin, from the CLI only (tm 389.4 · (g))', () => {
  let db: PrismaClient;
  const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

  beforeAll(() => {
    db = platformClient();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(owner);
  });

  function runCli(
    email: string,
    stdin: string,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'src/services/platform/bootstrap-admin-run.ts', '--email', email],
        { cwd: apiRoot, env: { ...process.env, PLATFORM_BOOTSTRAP_PASSWORD: '' } },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(stdin);
    });
  }

  it('creates one superadmin, then refuses every later call — two at once included', async () => {
    const first = await bootstrapPlatformAdmin(db, {
      email: ' Root@Ops.Siyahtus.Test ',
      password: 'a-long-bootstrap-password',
    });
    expect(first.email).toBe('root@ops.siyahtus.test');
    const row = await db.platformAdmin.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({ role: 'superadmin', totpEnrolledAt: null, disabledAt: null });

    await expect(
      bootstrapPlatformAdmin(db, {
        email: 'second@ops.siyahtus.test',
        password: 'a-long-bootstrap-password',
      }),
    ).rejects.toBeInstanceOf(PlatformBootstrapRefused);

    await resetDatabase(owner);
    const racing = await Promise.allSettled([
      bootstrapPlatformAdmin(db, {
        email: 'a@ops.siyahtus.test',
        password: 'a-long-bootstrap-password',
      }),
      bootstrapPlatformAdmin(db, {
        email: 'b@ops.siyahtus.test',
        password: 'a-long-bootstrap-password',
      }),
    ]);
    expect(racing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.platformAdmin.count()).toBe(1);
  });

  it('runs as a command: the password from stdin (a Windows line ending trimmed), a second run refused', async () => {
    const created = await runCli('cli@ops.siyahtus.test', 'a-long-bootstrap-password\r\n');
    expect(created.code, created.stderr).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({
      email: 'cli@ops.siyahtus.test',
      role: 'superadmin',
    });
    expect(created.stdout + created.stderr).not.toContain('a-long-bootstrap-password');

    // The trimmed password is the one that signs in.
    const h = await harness();
    try {
      const login = await h.request('POST', '/auth/login', {
        body: { email: 'cli@ops.siyahtus.test', password: 'a-long-bootstrap-password' },
      });
      expect(login.statusCode, login.body).toBe(200);
      expect(login.json().next).toBe('totp_enroll');
    } finally {
      await h.server.close();
    }

    const refused = await runCli('other@ops.siyahtus.test', 'a-long-bootstrap-password\n');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/already exists/);
    expect(await db.platformAdmin.count()).toBe(1);
  }, 60_000);
});
