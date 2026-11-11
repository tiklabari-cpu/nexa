/**
 * Settings → "send a test e-mail" (tm 464.3 · G-05 / NY-44).
 *
 * An administrator checks that the deployment's mail carrier delivers by
 * mailing themselves. The recipient is never a choice — there is no body — so
 * the endpoint cannot be pointed at a stranger's inbox, and five an hour per
 * member keeps it from being a way to fill one's own.
 *
 * The message goes the way every other mail does: queued in the durable
 * outbox (`kind: smtp_test`) and its first try made at once (`OutboxMailer
 * .post`), so what the panel shows is what a real mail would have met — the
 * daily caps included. A failure is the answer, not an error: `202` with the
 * carrier's classification (`code`, `phase`, the SMTP reply code) and never
 * the server's reply text, which `mail-error.ts` scrubs for the log but which
 * still has no business in a browser.
 */
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { requestLocale } from '../lib/request-locale.js';
import { mailFailureFields } from '../services/mail/delivery.js';
import { isMailDeliveryError } from '../services/mail/mail-error.js';
import type { MailDispatchOutcome } from '../services/mail/outbox-mailer.js';
import { smtpTestMail } from '../services/mail/templates/messages.js';
import { isMailLocale } from '../services/mail/templates/layout.js';

/** Test mails one member may send per hour; the next is a 429. */
export const SMTP_TESTS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

export interface SmtpTestError {
  code: string;
  phase: string | null;
  smtp_code: number | null;
}

export interface SmtpTestResult {
  status: 'sent' | 'queued' | 'unconfirmed' | 'failed';
  to: string;
  provider: Env['MAIL_PROVIDER'];
  error: SmtpTestError | null;
}

/** The carrier's classification of a failure — never its reply text. */
export function smtpTestError(error: unknown): SmtpTestError {
  if (isMailDeliveryError(error)) {
    return { code: error.code, phase: error.phase, smtp_code: error.smtpCode ?? null };
  }
  return { code: 'unexpected', phase: null, smtp_code: null };
}

export function smtpTestResult(
  outcome: MailDispatchOutcome,
  to: string,
  provider: Env['MAIL_PROVIDER'],
): SmtpTestResult {
  // `queued` carries its first try's failure; one another sender holds has none.
  const failure = outcome.status === 'sent' ? undefined : outcome.error;
  return {
    status: outcome.status,
    to,
    provider,
    error: failure === undefined ? null : smtpTestError(failure),
  };
}

export interface SettingsEmailRoutesOptions {
  env: Env;
}

export default async function settingsEmailRoutes(
  app: FastifyInstance,
  { env }: SettingsEmailRoutesOptions,
): Promise<void> {
  app.post(
    '/settings/email/test',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();
      const { licenseId, organizationId } = request.tenant();

      // Charged before anything is sent, success or not: the budget is on
      // asking, so a carrier that fails cannot be hammered either.
      let allowed = true;
      let resetMs = HOUR_MS;
      try {
        const decision = await app.rateLimiter.consume(
          `rl:smtp-test:${licenseId}:${principal.accountId}`,
          SMTP_TESTS_PER_HOUR,
          HOUR_MS,
        );
        allowed = decision.allowed;
        resetMs = decision.resetMs;
      } catch (error) {
        request.log.error({ err: error, bucket: 'smtp_test' }, 'budget unavailable — allowing');
      }
      if (!allowed) {
        throw ApiError.tooManyRequests(
          resetMs / 1000,
          `At most ${SMTP_TESTS_PER_HOUR} test e-mails an hour. Wait before sending another.`,
        );
      }

      const found = await request.withTenant(async (tx) => {
        const membership = await tx.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId, agentId: principal.accountId } },
          select: { locale: true, agent: { select: { email: true } } },
        });
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        });
        return { membership, workspaceName: organization?.name ?? 'SiyahTuş' };
      });
      if (!found.membership) throw ApiError.authorization();

      const to = found.membership.agent.email;
      const locale = isMailLocale(found.membership.locale)
        ? found.membership.locale
        : requestLocale(request);
      const outcome = await app.mailOutbox.post({
        to,
        licenseId,
        kind: 'smtp_test',
        ...smtpTestMail(
          { locale, appUrl: env.WEB_APP_URL },
          { workspaceName: found.workspaceName },
        ),
      });

      const result = smtpTestResult(outcome, to, env.MAIL_PROVIDER);
      if (result.error) {
        request.log.warn(
          {
            event: 'smtp_test',
            outcome: outcome.status,
            mail: mailFailureFields(outcome.status === 'sent' ? undefined : outcome.error),
          },
          'test e-mail not sent on its first try',
        );
      }
      return reply.code(202).send(result);
    },
  );
}
