/**
 * The root panel's sign-in and second-factor budgets fail closed (tm 452 ·
 * audit F31).
 *
 * Both budgets live in Redis. They used to let an attempt through when Redis
 * could not be reached ("allowing attempt"), so whoever held an operator's
 * password had unlimited tries at the TOTP or recovery code for as long as
 * the outage lasted. Now the attempt is refused with 503
 * `rate_limit_unavailable` before the password or the code is compared. The
 * tenant API's buckets still fail open (`login-attempts.test.ts`).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one
 * (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { ownerClient, platformClient, resetDatabase } from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  nextCode,
  openActiveSession,
  TestClock,
  type TestOperator,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';

const owner = ownerClient();

describe('the root panel sign-in without Redis (tm 452)', () => {
  let server: PlatformTestServer;
  let db: PrismaClient;
  const clock = new TestClock();

  beforeAll(async () => {
    db = platformClient();
    server = await buildPlatformTestServer({}, { now: clock.read, mailer: new MemoryMailer() });
  });

  afterAll(async () => {
    await server?.close();
    await db?.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(server.app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function request(
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<LightMyRequestResponse> {
    return server.app.inject({
      method: 'POST',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: options.token ? bearer(options.token) : {},
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
  }

  /** Every limiter call from here on fails as an unreachable Redis does. */
  function redisDown(): void {
    vi.spyOn(server.app.redis, 'evalsha').mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6380'),
    );
  }

  function expectUnavailable(response: LightMyRequestResponse): void {
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json().error.type).toBe('rate_limit_unavailable');
    expect(response.headers['retry-after']).toBe('30');
  }

  async function passwordStage(operator: TestOperator): Promise<string> {
    const login = await request('/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    return login.json().token as string;
  }

  it('refuses a sign-in with 503 before the password is compared, and signs in again once Redis is back', async () => {
    const operator = await createOperator(db, { clock });
    const signIn = vi.spyOn(server.app.platformAuth, 'signIn');
    redisDown();

    for (const password of [operator.password, 'not-the-password']) {
      expectUnavailable(
        await request('/auth/login', { body: { email: operator.email, password } }),
      );
    }
    expect(signIn).not.toHaveBeenCalled();
    // No failed sign-in either: nothing was compared.
    expect(await db.platformAuditLog.count({ where: { action: 'admin.sign_in_failed' } })).toBe(0);

    vi.mocked(server.app.redis.evalsha).mockRestore();
    expect((await passwordStage(operator)).length).toBeGreaterThan(0);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('refuses a TOTP code and a recovery code with 503 before either is compared', async () => {
    const operator = await createOperator(db, { clock });
    const token = await passwordStage(operator);
    const verify = vi.spyOn(server.app.platformAuth, 'verify');
    redisDown();

    expectUnavailable(
      await request('/auth/totp/verify', { token, body: { code: nextCode(operator, clock) } }),
    );
    expectUnavailable(
      await request('/auth/totp/verify', { token, body: { recovery_code: 'ABCDE-FGHJK' } }),
    );
    expect(verify).not.toHaveBeenCalled();
    expect(await db.platformAuditLog.count({ where: { action: 'admin.totp_failed' } })).toBe(0);

    // With Redis back, the same session finishes signing in.
    vi.mocked(server.app.redis.evalsha).mockRestore();
    const verified = await request('/auth/totp/verify', {
      token,
      body: { code: nextCode(operator, clock) },
    });
    expect(verified.statusCode, verified.body).toBe(200);
  });

  it('refuses the enrolment code and the re-verification code with 503', async () => {
    const newcomer = await createOperator(db, { clock, enrolled: false });
    const enrolling = await passwordStage(newcomer);
    expect((await request('/auth/totp/enroll', { token: enrolling })).statusCode).toBe(200);
    const active = await openActiveSession(db, await createOperator(db, { clock }), clock);
    const activate = vi.spyOn(server.app.platformAuth, 'activate');
    const reverify = vi.spyOn(server.app.platformAuth, 'reverify');
    redisDown();

    expectUnavailable(
      await request('/auth/totp/activate', { token: enrolling, body: { code: '123456' } }),
    );
    expectUnavailable(
      await request('/auth/totp/reverify', { token: active, body: { code: '123456' } }),
    );
    expect(activate).not.toHaveBeenCalled();
    expect(reverify).not.toHaveBeenCalled();
  });
});

async function clearRateLimits(app: FastifyInstance): Promise<void> {
  const keys = await app.redis.keys('rl:*');
  if (keys.length > 0) await app.redis.del(...keys);
}
