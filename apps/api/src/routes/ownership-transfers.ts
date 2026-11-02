/**
 * Handing the workspace over (RL-05 · tm 328).
 *
 *   POST   /ownership-transfers                     owner      { target_agent_id, password?, totp? }
 *   GET    /ownership-transfers/current             any member (owner, admins, the member offered)
 *   DELETE /ownership-transfers/{transferId}        owner
 *   POST   /ownership-transfers/{transferId}/accept the member offered  { token }
 *
 * The owner re-proves who they are to start one — the password, and the
 * second factor when one is on — because a stolen session alone must not be
 * able to give the workspace away. The member accepts signed in to this
 * workspace *and* holding the mailed token: either alone takes nothing over.
 *
 * Every write is a signed-in session's (a personal access token or a support
 * session is refused, and `impersonation-gate` refuses the path besides) and
 * stays open while the workspace is read-only — a workspace that stopped
 * paying may be exactly the one whose owner is leaving. Mail goes after the
 * commit and never undoes it. The state rules live in
 * `services/team/ownership-transfer.ts`.
 *
 * When the owner cannot be reached there is no path here: SiyahTuş support's
 * verified manual process forces the transfer from the root panel
 * (RL-05-S3 · `POST /platform/v1/workspaces/{id}/force-ownership-transfer`).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { generateToken, hashToken, verifyPassword } from '../lib/crypto.js';
import { requestLocale } from '../lib/request-locale.js';
import type { AgentPrincipal } from '../services/auth/principal.js';
import { roleAtLeast } from '../services/auth/principal.js';
import { TwoFactorService, badCode } from '../services/auth/two-factor-service.js';
import { deliver, isCapRefusal, mailFailureFields } from '../services/mail/delivery.js';
import type { Mailer, Message } from '../services/mail/mailer.js';
import { isMailLocale, type MailLocale } from '../services/mail/templates/layout.js';
import { ownershipTransferMail } from '../services/mail/templates/messages.js';
import {
  OWNERSHIP_TRANSFER_TTL_HOURS,
  acceptTransfer,
  acceptanceRecipients,
  cancelTransfer,
  currentTransfer,
  startTransfer,
  transferRefused,
  viewTransfer,
  type TargetFactorFacts,
} from '../services/team/ownership-transfer.js';

/** Attempts to start a transfer, right or wrong, per account per hour. */
const STARTS_PER_HOUR = 10;
const HOUR_MS = 3_600_000;

const OWNER_WRITE = {
  scopes: ['accounts--all:rw'],
  exactRole: 'owner' as const,
  principals: ['agent' as const],
  allowWhenReadOnly: true,
};

const startBody = z
  .object({
    target_agent_id: z.string().uuid(),
    password: z.string().max(512).optional(),
    totp: z.string().max(64).optional(),
  })
  .strict();

const acceptBody = z.object({ token: z.string().min(1).max(256) }).strict();

const transferParams = z.object({ transferId: z.string().uuid() });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

function mailLocale(value: string | null | undefined): MailLocale {
  return isMailLocale(value) ? value : 'en';
}

export interface OwnershipTransferRoutesOptions {
  env: Env;
  mailer?: Mailer;
}

export default async function ownershipTransferRoutes(
  app: FastifyInstance,
  options: OwnershipTransferRoutesOptions,
): Promise<void> {
  const { env, mailer } = options;
  const twoFactor = new TwoFactorService(app.db);
  const appUrl = env.WEB_APP_URL.replace(/\/+$/, '');

  /** The signed-in member behind the request — never a token or a support session. */
  function sessionPrincipal(request: FastifyRequest): AgentPrincipal {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'agent') throw ApiError.authorization();
    if (principal.tokenKind !== 'oauth') {
      throw new ApiError('not_allowed', 'Hand the workspace over from a signed-in session.', {
        details: { reason: 'session_required' },
      });
    }
    return principal;
  }

  /**
   * The owner proves it again: the password when the account has one, and the
   * second factor (a current code, or a recovery code — spent) when it is on.
   * An account without a password proves the factor instead, as removing
   * two-factor authentication does (`routes/auth.ts` `reauthenticate`).
   */
  async function reauthenticate(
    request: FastifyRequest,
    principal: AgentPrincipal,
    body: { password?: string | undefined; totp?: string | undefined },
  ): Promise<void> {
    const account = await request.withTenant((tx) =>
      tx.account.findUnique({
        where: { id: principal.accountId },
        select: { passwordHash: true },
      }),
    );
    if (!account) throw ApiError.notFound('Resource not found.');

    if (account.passwordHash !== null) {
      if (body.password === undefined) {
        throw ApiError.validation(
          'password: your password is required to hand over the workspace.',
          {
            fields: [{ field: 'password', message: 'Required.' }],
          },
        );
      }
      if (!(await verifyPassword(body.password, account.passwordHash))) {
        throw ApiError.authentication('That password is not correct.');
      }
    }
    const factorOn = await twoFactor.isActive(principal.accountId);
    if (!factorOn && account.passwordHash !== null) return;
    if (!factorOn) {
      throw new ApiError(
        'not_allowed',
        'This account has no password and no second factor to prove it with. Set up two-factor authentication first.',
        { details: { reason: 'reauthentication_unavailable' } },
      );
    }
    if (body.totp === undefined || body.totp.trim() === '') {
      throw new ApiError(
        'two_factor_required',
        'Enter a code from your authenticator app, or a recovery code.',
      );
    }
    const code = body.totp.trim();
    if (await twoFactor.verifyTotpCode(principal.accountId, code, Date.now())) return;
    if (await twoFactor.consumeRecoveryCode(principal.accountId, code)) return;
    throw badCode();
  }

  /** What the second-factor service says about the member (outside any transaction). */
  async function factorFacts(licenseId: bigint, accountId: string): Promise<TargetFactorFacts> {
    const [active, enforcing] = await Promise.all([
      twoFactor.isActive(accountId),
      twoFactor.enforcingWorkspaces(accountId),
    ]);
    return {
      twoFactorActive: active,
      workspaceRequiresTwoFactor: enforcing.some((w) => w.licenseId === licenseId),
    };
  }

  async function workspaceName(request: FastifyRequest): Promise<string> {
    const organizationId = request.tenant().organizationId;
    const organization = await request.withTenant((tx) =>
      tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    );
    return organization?.name ?? 'SiyahTuş';
  }

  /** After the commit, never awaited, never fatal. */
  function mailLater(request: FastifyRequest, message: Message, event: string): void {
    app.backgroundMail.send(message, (outcome) => {
      if (outcome.status === 'sent' || isCapRefusal(outcome)) return;
      request.log.warn(
        { event, outcome: outcome.status, mail: mailFailureFields(outcome.error) },
        'ownership transfer mail not confirmed as sent',
      );
    });
  }

  // --- Start -----------------------------------------------------------------

  app.post('/ownership-transfers', { config: OWNER_WRITE }, async (request, reply) => {
    const principal = sessionPrincipal(request);
    const body = parse(startBody, request.body);

    // Charged per attempt, right or wrong, before anything is read: a budget
    // charged only on failures would let a caller past it keep guessing.
    let allowed = true;
    try {
      allowed = (
        await app.rateLimiter.consume(`rl:ownxfer:${principal.accountId}`, STARTS_PER_HOUR, HOUR_MS)
      ).allowed;
    } catch (error) {
      request.log.error({ err: error, bucket: 'ownxfer' }, 'budget unavailable — allowing');
    }
    if (!allowed) {
      throw ApiError.tooManyRequests(
        3600,
        'Too many attempts to hand over the workspace. Wait an hour before trying again.',
      );
    }

    await reauthenticate(request, principal, body);
    if (body.target_agent_id === principal.accountId) {
      throw ApiError.validation('target_agent_id: you already own the workspace.', {
        reason: 'target_is_owner',
      });
    }

    const facts = await factorFacts(principal.licenseId, body.target_agent_id);
    const token = generateToken(32);
    const now = new Date();
    const { view, target, ownerName } = await request.withTenant(async (tx) => {
      const started = await startTransfer(tx, request.auditContext(), {
        fromAccountId: principal.accountId,
        toAccountId: body.target_agent_id,
        tokenHash: hashToken(token),
        facts,
        now,
      });
      const owner = await tx.account.findUnique({
        where: { id: principal.accountId },
        select: { name: true },
      });
      return {
        view: await viewTransfer(tx, started.row),
        target: started.target,
        ownerName: owner?.name ?? '',
      };
    });

    // Awaited, unlike the other two: the owner is told whether the link went,
    // and can cancel and offer again if it did not.
    let mail: 'sent' | 'failed' = 'failed';
    if (mailer) {
      const url =
        `${appUrl}/app/ownership-transfer?transfer=${encodeURIComponent(view.id)}` +
        `&token=${encodeURIComponent(token)}`;
      const outcome = await deliver(mailer, {
        to: target.email,
        licenseId: principal.licenseId,
        kind: 'notification',
        ...ownershipTransferMail(
          { locale: mailLocale(target.locale), appUrl: env.WEB_APP_URL },
          {
            kind: 'offer',
            workspaceName: await workspaceName(request),
            ownerName: ownerName || view.from_agent.email,
            url,
            hours: OWNERSHIP_TRANSFER_TTL_HOURS,
          },
        ),
      });
      mail = outcome.status === 'failed' ? 'failed' : 'sent';
      if (outcome.status !== 'sent' && !isCapRefusal(outcome)) {
        request.log.warn(
          {
            event: 'ownership_transfer.offer_mail',
            outcome: outcome.status,
            ...(outcome.status === 'failed' ? { mail: mailFailureFields(outcome.error) } : {}),
          },
          'ownership transfer offer not confirmed as sent',
        );
      }
    }
    return reply.code(201).send({ transfer: view, mail });
  });

  // --- Read ------------------------------------------------------------------

  app.get(
    '/ownership-transfers/current',
    { config: { scopes: ['accounts--my:ro'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();
      const transfer = await request.withTenant(async (tx) => {
        const row = await currentTransfer(tx, request.auditContext(), new Date());
        if (!row) return null;
        // The band is the owner's, the admins' and the offered member's;
        // anyone else reads that nothing is pending.
        const sees =
          roleAtLeast(principal.role, 'admin') || row.toAccountId === principal.accountId;
        return sees ? viewTransfer(tx, row) : null;
      });
      return reply.send({ transfer });
    },
  );

  // --- Cancel ----------------------------------------------------------------

  app.delete<{ Params: { transferId: string } }>(
    '/ownership-transfers/:transferId',
    { config: OWNER_WRITE },
    async (request, reply) => {
      const principal = sessionPrincipal(request);
      const { transferId } = parse(transferParams, request.params);
      const { target, ownerName } = await request.withTenant(async (tx) => {
        const cancelled = await cancelTransfer(tx, request.auditContext(), {
          id: transferId,
          now: new Date(),
        });
        const owner = await tx.account.findUnique({
          where: { id: principal.accountId },
          select: { name: true, email: true },
        });
        return { target: cancelled.target, ownerName: owner?.name || owner?.email || '' };
      });
      if (target && mailer) {
        mailLater(
          request,
          {
            to: target.email,
            licenseId: principal.licenseId,
            kind: 'notification',
            ...ownershipTransferMail(
              { locale: mailLocale(target.locale), appUrl: env.WEB_APP_URL },
              { kind: 'cancelled', workspaceName: await workspaceName(request), ownerName },
            ),
          },
          'ownership_transfer.cancel_mail',
        );
      }
      return reply.code(204).send();
    },
  );

  // --- Accept ----------------------------------------------------------------

  app.post<{ Params: { transferId: string } }>(
    '/ownership-transfers/:transferId/accept',
    {
      config: {
        scopes: ['accounts--my:rw'],
        principals: ['agent'],
        allowWhenReadOnly: true,
      },
    },
    async (request, reply) => {
      const principal = sessionPrincipal(request);
      const { transferId } = parse(transferParams, request.params);
      const body = parse(acceptBody, request.body);
      const facts = await factorFacts(principal.licenseId, principal.accountId);

      let result;
      try {
        result = await request.withTenant(async (tx) => {
          const outcome = await acceptTransfer(tx, request.auditContext(), {
            id: transferId,
            accountId: principal.accountId,
            token: body.token,
            facts,
            now: new Date(),
          });
          if (outcome.kind === 'owner_changed') return { outcome, view: null, recipients: [] };
          return {
            outcome,
            view: await viewTransfer(tx, outcome.row),
            recipients: await acceptanceRecipients(
              tx,
              principal.licenseId,
              outcome.fromAccountId,
              principal.accountId,
            ),
          };
        });
      } catch (error) {
        // A forced transfer from the root panel won the race for the owner
        // seat: the single-owner index refused this one's swap.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw transferRefused(
            'owner_changed',
            "The workspace's owner changed while this transfer was pending.",
          );
        }
        throw error;
      }

      if (result.outcome.kind === 'owner_changed' || result.view === null) {
        throw transferRefused(
          'owner_changed',
          "The workspace's owner changed while this transfer was pending; the transfer was cancelled.",
        );
      }

      const view = result.view;
      if (mailer) {
        const name = await workspaceName(request);
        const label = (party: { name: string; email: string }) => party.name || party.email;
        for (const person of result.recipients) {
          mailLater(
            request,
            {
              to: person.email,
              licenseId: principal.licenseId,
              kind: 'notification',
              ...ownershipTransferMail(
                {
                  locale:
                    person.accountId === principal.accountId
                      ? requestLocale(request)
                      : mailLocale(person.locale),
                  appUrl: env.WEB_APP_URL,
                },
                {
                  kind: 'accepted',
                  workspaceName: name,
                  newOwner: label(view.to_agent),
                  previousOwner: label(view.from_agent),
                  part: person.part,
                  ssoEnforced: result.outcome.ssoEnforced,
                },
              ),
            },
            'ownership_transfer.accepted_mail',
          );
        }
      }
      return reply.send({ transfer: view, billing_contact: result.outcome.billingContact });
    },
  );
}
