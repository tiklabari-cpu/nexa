/**
 * `/platform/v1/accounts/*` — the people behind the memberships (tm 389.11 ·
 * FR-ADMIN-11 · design.md §C accounts).
 *
 *   GET  /accounts                              accounts.read     ?q (address or name prefix, id), keyset
 *   GET  /accounts/{accountId}                  accounts.read     memberships, roles, last sign-in, 2FA
 *   POST /accounts/{accountId}/resend-verification     accounts.support
 *   POST /accounts/{accountId}/force-password-reset    accounts.support  sessions end + reset mail
 *   POST /accounts/{accountId}/revoke-sessions         accounts.support
 *   POST /accounts/{accountId}/revoke-tokens           accounts.support  sessions + personal tokens
 *   POST /accounts/{accountId}/reset-two-factor        accounts.manage   recentTotp
 *   POST /accounts/{accountId}/suspend                 accounts.manage   every workspace, sessions end
 *   POST /accounts/{accountId}/unsuspend               accounts.manage
 *   POST /accounts/{accountId}/export                  accounts.manage   the account's data, JSON
 *   POST /accounts/{accountId}/erase                   accounts.manage   recentTotp, {confirm_email}
 *
 * Every action takes `{reason}` and is recorded twice, in one transaction with
 * the change: one platform entry (`account.<verb>`, with the reason) and the
 * tenant half (`platform.account_<verb>`, without it) in every workspace the
 * person belongs to. Asking for what is already so answers `unchanged: true`
 * and records nothing. Mail goes after the commit; the answer says
 * `mail: sent | failed`.
 *
 * The export is a POST: a GET cannot write the audit entry a copy of a
 * person's data leaving the platform deserves (`plugins/platform-audit.ts`).
 *
 * An id that is not a UUID is the same 404 as an unknown one.
 */
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { hashToken, RESET_TTL_MS } from '../../services/auth/lifecycle-service.js';
import { deliver, logUnsentMail } from '../../services/mail/delivery.js';
import type { Mailer, Message } from '../../services/mail/mailer.js';
import { isMailLocale } from '../../services/mail/templates/layout.js';
import { passwordResetMail, verifyEmailMail } from '../../services/mail/templates/messages.js';
import {
  AccountCursorError,
  accountDetail,
  eraseAccount,
  exportAccount,
  forcePasswordReset,
  isAccountId,
  issueVerification,
  resetTwoFactor,
  revokeCredentials,
  revokeSessions,
  searchAccounts,
  suspendAccount,
  unsuspendAccount,
  type AccountActionOutcome,
  type AccountMailTarget,
} from '../../services/platform/accounts.js';
import type { PlatformAuditAction } from '../../services/platform/platform-audit.js';
import { parse } from './auth.js';

const listQuery = z.object({
  q: z.string().trim().max(320).optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const eraseBody = z.object({ confirm_email: z.string().max(320) });

export default async function platformAccountsRoutes(
  app: FastifyInstance,
  options: { env: Env; mailer: Mailer; now?: () => number },
): Promise<void> {
  const { env, mailer } = options;
  const clock = options.now ?? Date.now;
  const read = { platform: { permission: 'accounts.read' as const } };
  const gate = (
    permission: 'accounts.support' | 'accounts.manage',
    action: PlatformAuditAction,
    recentTotp = false,
  ) => ({
    platform: {
      permission,
      ...(recentTotp ? { recentTotp: true } : {}),
      audit: { action, target: 'account' as const, targetParam: 'accountId' },
    },
  });

  /** The path's account id, or a 404 — malformed and unknown alike. */
  function accountIdOf(request: FastifyRequest): string {
    const raw = (request.params as Record<string, unknown>)['accountId'];
    if (!isAccountId(raw)) throw ApiError.notFound('Account not found.');
    return raw.toLowerCase();
  }

  /**
   * Run one action and its audit entries in one transaction — the platform
   * entry and the tenant half in each of the person's workspaces. An
   * unchanged outcome writes nothing and marks the request recorded.
   */
  async function perform<T extends AccountActionOutcome>(
    request: FastifyRequest,
    action: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
  ): Promise<T> {
    const outcome = await app.platformDb.$transaction(
      async (tx) => {
        const result = await action(tx, new Date(clock()));
        if (!result.unchanged) {
          await app.platformAuditLog.record(
            request.platformAuditEntry({ workspaces: result.workspaces, payload: result.payload }),
            tx,
          );
        }
        return result;
      },
      { timeout: 30_000 },
    );
    request.platformAudit!.recorded = true;
    return outcome;
  }

  async function answer(
    reply: FastifyReply,
    accountId: string,
    outcome: AccountActionOutcome,
    extra: Record<string, unknown> = {},
  ) {
    const account = await accountDetail(app.platformDb, accountId, new Date(clock()));
    return reply
      .header('cache-control', 'no-store')
      .send({ unchanged: outcome.unchanged, account, ...extra });
  }

  /** Mail one message after the commit; the action stands whatever the mail does. */
  async function mail(request: FastifyRequest, event: string, message: Message) {
    const outcome = await deliver(mailer, message);
    logUnsentMail(request.log, event, outcome);
    return outcome.status === 'sent' ? 'sent' : 'failed';
  }

  const mailContext = (to: AccountMailTarget) => ({
    locale: isMailLocale(to.locale) ? to.locale : ('en' as const),
    appUrl: env.WEB_APP_URL,
  });

  const newLink = (ttlMs: number, now: Date) => {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token), expiresAt: new Date(now.getTime() + ttlMs) };
  };

  app.get('/accounts', { config: read }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    try {
      const page = await searchAccounts(app.platformDb, {
        ...(query.q ? { q: query.q } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
      return reply.header('cache-control', 'no-store').send(page);
    } catch (error) {
      if (error instanceof AccountCursorError) {
        throw ApiError.validation('`cursor` is not a cursor of this list. Start again without it.');
      }
      throw error;
    }
  });

  app.get('/accounts/:accountId', { config: read }, async (request, reply) => {
    const account = await accountDetail(app.platformDb, accountIdOf(request), new Date(clock()));
    if (!account) throw ApiError.notFound('Account not found.');
    return reply.header('cache-control', 'no-store').send({ account });
  });

  app.post(
    '/accounts/:accountId/resend-verification',
    { config: gate('accounts.support', 'account.verification_resent') },
    async (request, reply) => {
      const accountId = accountIdOf(request);
      const hours = env.SIGNUP_VERIFICATION_TTL_HOURS;
      let token = '';
      const outcome = await perform(request, (tx, now) => {
        const link = newLink(hours * 3_600_000, now);
        token = link.token;
        return issueVerification(tx, accountId, link);
      });
      if (!outcome.mailTo) return answer(reply, accountId, outcome);
      const url = `${env.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
      const status = await mail(request, 'account_verification.mail', {
        to: outcome.mailTo.email,
        // Account mail (`account-lifecycle.ts`): no workspace's daily cap.
        licenseId: null,
        kind: 'email_verification',
        ...verifyEmailMail(mailContext(outcome.mailTo), { url, hours }),
      });
      return answer(reply, accountId, outcome, { mail: status });
    },
  );

  app.post(
    '/accounts/:accountId/force-password-reset',
    { config: gate('accounts.support', 'account.password_reset_forced') },
    async (request, reply) => {
      const accountId = accountIdOf(request);
      let token = '';
      const outcome = await perform(request, (tx, now) => {
        const link = newLink(RESET_TTL_MS, now);
        token = link.token;
        return forcePasswordReset(tx, accountId, link, now);
      });
      const status = await mail(request, 'account_password_reset.mail', {
        to: outcome.mailTo.email,
        licenseId: null,
        kind: 'password_reset',
        ...passwordResetMail(mailContext(outcome.mailTo), {
          url: `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
        }),
      });
      return answer(reply, accountId, outcome, { mail: status });
    },
  );

  for (const [path, action, permission, fresh, run] of [
    [
      'revoke-sessions',
      'account.sessions_revoked',
      'accounts.support',
      false,
      (tx, id, now) => revokeSessions(tx, id, now),
    ],
    [
      'revoke-tokens',
      'account.tokens_revoked',
      'accounts.support',
      false,
      (tx, id, now) => revokeCredentials(tx, id, now),
    ],
    [
      'reset-two-factor',
      'account.two_factor_reset',
      'accounts.manage',
      true,
      (tx, id) => resetTwoFactor(tx, id),
    ],
    [
      'unsuspend',
      'account.unsuspended',
      'accounts.manage',
      false,
      (tx, id) => unsuspendAccount(tx, id),
    ],
  ] as const satisfies ReadonlyArray<
    readonly [
      string,
      PlatformAuditAction,
      'accounts.support' | 'accounts.manage',
      boolean,
      (tx: Prisma.TransactionClient, accountId: string, now: Date) => Promise<AccountActionOutcome>,
    ]
  >) {
    app.post(
      `/accounts/:accountId/${path}`,
      { config: gate(permission, action, fresh) },
      async (request, reply) => {
        const accountId = accountIdOf(request);
        const outcome = await perform(request, (tx, now) => run(tx, accountId, now));
        return answer(reply, accountId, outcome);
      },
    );
  }

  app.post(
    '/accounts/:accountId/suspend',
    { config: gate('accounts.manage', 'account.suspended') },
    async (request, reply) => {
      const accountId = accountIdOf(request);
      const reason = request.platformAudit!.reason!;
      const outcome = await perform(request, (tx, now) =>
        suspendAccount(tx, accountId, reason, now),
      );
      return answer(reply, accountId, outcome);
    },
  );

  app.post(
    '/accounts/:accountId/export',
    { config: gate('accounts.manage', 'account.exported') },
    async (request, reply) => {
      const accountId = accountIdOf(request);
      const outcome = await perform(request, (tx, now) => exportAccount(tx, accountId, now));
      return reply
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="account-${accountId}.json"`)
        .send(outcome.document);
    },
  );

  app.post(
    '/accounts/:accountId/erase',
    { config: gate('accounts.manage', 'account.erased', true) },
    async (request, reply) => {
      const accountId = accountIdOf(request);
      const { confirm_email: confirmEmail } = parse(eraseBody, request.body);
      const outcome = await perform(request, (tx) => eraseAccount(tx, accountId, confirmEmail));
      return reply
        .header('cache-control', 'no-store')
        .send({ erased: true, account_id: accountId, license_ids: outcome.payload['license_ids'] });
    },
  );
}
