/**
 * `/platform/v1/auth/*` — operator sign-in, second factor and own sessions
 * (tm 389.4 · FR-ADMIN-01/02/03 · design.md §C auth).
 *
 *   POST /auth/login              password → a `password`-stage session          public
 *   POST /auth/totp/enroll        a secret for an operator with no authenticator  enrollment
 *   POST /auth/totp/activate      confirm it: active session + recovery sheet     enrollment
 *   POST /auth/totp/verify        a code (or a recovery code) → active session    challenge
 *   POST /auth/totp/reverify      a fresh code for the destructive routes         active
 *   POST /auth/recovery/regenerate a new recovery sheet                           active, recentTotp
 *   GET  /auth/me                 who, which role, which permissions              active
 *   GET  /auth/sessions           this operator's live sessions                   active
 *   DELETE /auth/sessions         end every other one                             active
 *   POST /auth/logout             end this one                                    any stage
 *   POST /auth/invite/accept      an invitation + password → `password` session   public
 *
 * Every response that carries a token carries a new one: verify and activate
 * rotate it, so the password-stage token is worthless once a code is shown.
 *
 * Two budgets, both charged before the credential is checked so a caller past
 * its limit never reaches the comparison:
 *
 *   `rl:platform:signin:<ip>`   failed sign-ins and invitation acceptances,
 *                               10 per 15 minutes. Reserved per attempt and
 *                               handed back on success — so ten failures from
 *                               one address lock the door for the window, a
 *                               correct password included.
 *   `rl:platform:totp:<admin>`  every code presented by one operator,
 *                               `RATE_LIMIT_TWO_FACTOR_PER_HOUR` an hour.
 *
 * Every one of them writes the platform audit chain (tm 389.5) on success,
 * without a reason — they are the operator's own session; a refused password
 * or code is recorded by the handler (`admin.sign_in_failed`,
 * `admin.totp_failed`), since a failed request writes nothing on its own.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformPermissionsFor } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { RateLimiter, type RateLimitReservation } from '../../plugins/rate-limit.js';
import {
  badPlatformCode,
  PLATFORM_PASSWORD_MAX,
  type ClientMeta,
  type PlatformSessionContext,
  type SignedIn,
} from '../../services/platform/admin-auth.js';
import type {
  PlatformAuditAction,
  PlatformAuditRouteConfig,
} from '../../services/platform/platform-audit.js';

/** Ten failed sign-ins from one address per fifteen minutes (FR-ADMIN-03). */
export const PLATFORM_SIGNIN_FAILURES = 10;
export const PLATFORM_SIGNIN_WINDOW_MS = 15 * 60_000;

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(1).max(512);
const codeSchema = z.string().trim().min(1).max(32);

const loginBody = z.object({ email: emailSchema, password: passwordSchema });
const codeBody = z.object({ code: codeSchema });
const verifyBody = z.union([
  z.object({ code: codeSchema }).strict(),
  z.object({ recovery_code: codeSchema }).strict(),
]);
const acceptBody = z.object({
  token: z.string().min(1).max(128),
  password: z.string().max(PLATFORM_PASSWORD_MAX * 4),
});

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

function clientMeta(request: FastifyRequest): ClientMeta {
  const agent = request.headers['user-agent'];
  return { ip: request.ip ?? null, userAgent: typeof agent === 'string' ? agent : null };
}

/** The audit half of a route's config: the operator's own session, as an `admin` target. */
function audited(action: PlatformAuditAction, target: 'admin' | 'session' = 'admin') {
  return { action, target } satisfies PlatformAuditRouteConfig;
}

function signedInBody(signedIn: SignedIn) {
  return { token: signedIn.token, next: signedIn.next, session: signedIn.session };
}

export default async function platformAuthRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const limiter = new RateLimiter(app.redis);
  const auth = app.platformAuth;

  /**
   * Take one slot of the address's sign-in budget, or refuse. The slot is the
   * attempt's; `release` hands it back when the attempt turned out honest.
   * Fails open without Redis, like every bucket here — the password, the
   * second factor and the edge do not depend on it.
   */
  async function reserveSignIn(
    request: FastifyRequest,
  ): Promise<(RateLimitReservation & { key: string }) | null> {
    const key = `rl:platform:signin:${request.ip}`;
    let reservation: RateLimitReservation;
    try {
      reservation = await limiter.reserve(key, PLATFORM_SIGNIN_FAILURES, PLATFORM_SIGNIN_WINDOW_MS);
    } catch (error) {
      request.log.error({ err: error }, 'platform sign-in budget unavailable — allowing attempt');
      return null;
    }
    if (!reservation.allowed) {
      throw ApiError.tooManyRequests(
        reservation.resetMs / 1000,
        'Too many failed sign-in attempts from this address. Retry after the interval in the Retry-After header.',
      );
    }
    return { ...reservation, key };
  }

  async function release(
    request: FastifyRequest,
    reservation: (RateLimitReservation & { key: string }) | null,
  ): Promise<void> {
    if (!reservation) return;
    try {
      await limiter.release(reservation.key, reservation.member);
    } catch (error) {
      request.log.error({ err: error }, 'platform sign-in budget unavailable');
    }
  }

  /**
   * A refusal worth keeping — a wrong password, a wrong code. Never fails the
   * request it describes: the caller gets the answer they were due either way.
   */
  async function recordRefusal(
    request: FastifyRequest,
    action: 'admin.sign_in_failed' | 'admin.totp_failed',
    adminId: string | null,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await app.platformAuditLog.record({
        adminId,
        action,
        targetType: 'admin',
        targetId: adminId,
        payload,
        ip: request.ip ?? null,
        requestId: request.id,
      });
    } catch (error) {
      request.log.error(
        { err: error, event: 'platform_audit.write_failed', action },
        'platform audit entry could not be written',
      );
    }
  }

  /** One code presented by `session`'s operator; refused past the hourly budget. */
  async function spendCodeAttempt(
    request: FastifyRequest,
    session: PlatformSessionContext,
  ): Promise<void> {
    let allowed = true;
    let resetMs = 0;
    try {
      const decision = await limiter.consume(
        `rl:platform:totp:${session.adminId}`,
        options.env.RATE_LIMIT_TWO_FACTOR_PER_HOUR,
        3_600_000,
      );
      allowed = decision.allowed;
      resetMs = decision.resetMs;
    } catch (error) {
      request.log.error({ err: error }, 'platform code budget unavailable — allowing attempt');
    }
    if (!allowed) {
      throw ApiError.tooManyRequests(
        resetMs / 1000,
        'Too many codes entered for this operator. Retry after the interval in the Retry-After header.',
      );
    }
  }

  // --- Sign-in ---------------------------------------------------------------

  app.post(
    '/auth/login',
    { config: { public: true, platform: { audit: audited('admin.signed_in') } } },
    async (request) => {
      const body = parse(loginBody, request.body);
      const reservation = await reserveSignIn(request);
      const signedIn = await auth.signIn(body.email, body.password, clientMeta(request));
      // One message for an unknown address, a wrong password and a disabled
      // operator; the slot stays spent. The entry names nobody either: which
      // of the three it was is exactly what the answer does not tell.
      if (!signedIn) {
        await recordRefusal(request, 'admin.sign_in_failed', null);
        throw ApiError.authentication('Invalid email or password.');
      }
      await release(request, reservation);
      request.platformAudit!.adminId = signedIn.adminId;
      return signedInBody(signedIn);
    },
  );

  app.post(
    '/auth/invite/accept',
    { config: { public: true, platform: { audit: audited('admin.invite_accepted') } } },
    async (request) => {
      const body = parse(acceptBody, request.body);
      const reservation = await reserveSignIn(request);
      const signedIn = await auth.acceptInvite(body.token, body.password, clientMeta(request));
      if (!signedIn) {
        throw ApiError.authentication('This invitation is not valid. Ask for a new one.');
      }
      await release(request, reservation);
      request.platformAudit!.adminId = signedIn.adminId;
      return signedInBody(signedIn);
    },
  );

  // --- Enrolment -------------------------------------------------------------

  app.post(
    '/auth/totp/enroll',
    {
      config: {
        platform: {
          self: true,
          stage: 'enrollment',
          audit: audited('admin.totp_enrollment_started'),
        },
      },
    },
    async (request) => {
      const enrollment = await auth.beginEnrollment(request.requirePlatformSession());
      return { secret: enrollment.secret, otpauth_uri: enrollment.otpauthUri };
    },
  );

  app.post(
    '/auth/totp/activate',
    {
      config: {
        platform: { self: true, stage: 'enrollment', audit: audited('admin.totp_enrolled') },
      },
    },
    async (request) => {
      const body = parse(codeBody, request.body);
      const session = request.requirePlatformSession();
      await spendCodeAttempt(request, session);
      const activated = await auth.activate(session, body.code);
      if (!activated) {
        await recordRefusal(request, 'admin.totp_failed', session.adminId, { step: 'activate' });
        throw badPlatformCode();
      }
      return {
        token: activated.token,
        session: activated.session,
        recovery_codes: activated.recoveryCodes,
      };
    },
  );

  // --- The second step -------------------------------------------------------

  app.post(
    '/auth/totp/verify',
    {
      config: {
        platform: { self: true, stage: 'challenge', audit: audited('admin.totp_verified') },
      },
    },
    async (request) => {
      const body = parse(verifyBody, request.body);
      const session = request.requirePlatformSession();
      await spendCodeAttempt(request, session);
      const verified = await auth.verify(
        session,
        'code' in body ? { code: body.code } : { recoveryCode: body.recovery_code },
      );
      if (!verified) {
        await recordRefusal(request, 'admin.totp_failed', session.adminId, {
          step: 'verify',
          method: 'code' in body ? 'totp' : 'recovery_code',
        });
        throw badPlatformCode();
      }
      request.platformAudit!.payload = { method: verified.method };
      return {
        token: verified.token,
        session: verified.session,
        method: verified.method,
        recovery_codes_remaining: verified.recoveryCodesRemaining,
      };
    },
  );

  app.post(
    '/auth/totp/reverify',
    { config: { platform: { self: true, audit: audited('admin.totp_reverified') } } },
    async (request) => {
      const body = parse(codeBody, request.body);
      const session = request.requirePlatformSession();
      await spendCodeAttempt(request, session);
      const refreshed = await auth.reverify(session, body.code);
      if (!refreshed) {
        await recordRefusal(request, 'admin.totp_failed', session.adminId, { step: 'reverify' });
        throw badPlatformCode();
      }
      return { session: refreshed };
    },
  );

  app.post(
    '/auth/recovery/regenerate',
    {
      config: {
        platform: {
          self: true,
          recentTotp: true,
          audit: audited('admin.recovery_codes_regenerated'),
        },
      },
    },
    async (request) => {
      const session = request.requirePlatformSession();
      return { recovery_codes: await auth.regenerateRecoveryCodes(session.adminId) };
    },
  );

  // --- Who, and their sessions -----------------------------------------------

  app.get('/auth/me', { config: { platform: { self: true } } }, async (request) => {
    const session = request.requirePlatformSession();
    const admin = await app.platformAdmins.get(session.adminId);
    return {
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        totp_enrolled_at: admin.totp_enrolled_at,
        created_at: admin.created_at,
      },
      permissions: platformPermissionsFor(session.role),
      session: auth.viewOf(session),
      recovery_codes_remaining: await auth.countRecoveryCodes(session.adminId),
    };
  });

  app.get('/auth/sessions', { config: { platform: { self: true } } }, async (request) => {
    const session = request.requirePlatformSession();
    const sessions = await auth.listSessions(session.adminId);
    return { data: sessions.map((s) => ({ ...s, current: s.id === session.sessionId })) };
  });

  app.delete(
    '/auth/sessions',
    { config: { platform: { self: true, audit: audited('admin.other_sessions_ended') } } },
    async (request) => {
      const session = request.requirePlatformSession();
      const ended = await auth.endOtherSessions(session.adminId, session.sessionId);
      request.platformAudit!.payload = { ended };
      return { ended };
    },
  );

  app.post(
    '/auth/logout',
    {
      config: {
        platform: { self: true, stage: 'any', audit: audited('admin.signed_out', 'session') },
      },
    },
    async (request, reply) => {
      await auth.endSession(request.requirePlatformSession().sessionId);
      return reply.status(204).send();
    },
  );
}
