/**
 * The owner cancels the subscription and takes it back (tm 384 · BL-03).
 *
 *   POST /billing/subscription/cancel   { reason, confirmation }
 *   POST /billing/subscription/resume
 *
 * Both answer the full subscription view (`GET /billing/subscription`), whose
 * `cancellation` says what was set. The owner's alone (K7: `exactRole:
 * 'owner'` on a billing scope — an admin gets 403) and open while the
 * workspace is read-only, as every billing write is: a workspace the dunning
 * plan made read-only can still say it is leaving. The pilot refuses every
 * `/billing/` write (`pilot-gate.ts`).
 *
 * Idempotent: cancelling a cancelled subscription, or resuming one that is
 * not cancelled, changes nothing, writes no audit entry and sends no mail.
 * The period end itself is the period-close job's (`subscription-cancel.ts`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CANCEL_REASONS } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { buildSubscriptionView } from '../services/billing/billing-views.js';
import {
  cancelSubscription,
  readCancellationRecipients,
  resumeSubscription,
  sendCancellationMail,
  type CancellationMailFacts,
  type CancellationMailPlan,
} from '../services/billing/subscription-cancel.js';
import type { Mailer } from '../services/mail/mailer.js';

const OWNER_WRITE = {
  scopes: ['billing_manage', 'billing_admin'],
  exactRole: 'owner' as const,
  allowWhenReadOnly: true,
};

const cancelBody = z
  .object({
    reason: z.enum(CANCEL_REASONS),
    // The workspace's name, typed as the confirmation (organization names are
    // at most 200 characters).
    confirmation: z.string().max(200),
  })
  .strict();

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

export interface BillingCancelRoutesOptions {
  env: Env;
  mailer?: Mailer;
}

export default async function billingCancelRoutes(
  app: FastifyInstance,
  options: BillingCancelRoutesOptions,
): Promise<void> {
  const { env, mailer } = options;
  const mail = { ...(mailer ? { mailer } : {}), appUrl: env.WEB_APP_URL, log: app.log };

  app.post('/billing/subscription/cancel', { config: OWNER_WRITE }, async (request, reply) => {
    const body = parse(cancelBody, request.body);
    const tenant = request.tenant();
    const now = new Date();
    const { view, notice } = await request.withTenant(async (tx) => {
      const outcome = await cancelSubscription(tx, tenant, {
        reason: body.reason,
        confirmation: body.confirmation,
        audit: request.auditContext(),
        now,
      });
      const plan: CancellationMailPlan | null = outcome.changed
        ? await readCancellationRecipients(tx, tenant)
        : null;
      const facts: CancellationMailFacts = {
        kind: 'scheduled',
        takesEffectAt: outcome.takesEffectAt,
      };
      return {
        view: await buildSubscriptionView(tx, tenant, env),
        notice: plan ? { plan, facts } : null,
      };
    });
    if (notice) await sendCancellationMail(tenant, notice.plan, notice.facts, mail);
    return reply.send(view);
  });

  app.post('/billing/subscription/resume', { config: OWNER_WRITE }, async (request, reply) => {
    const tenant = request.tenant();
    const { view, plan } = await request.withTenant(async (tx) => {
      const outcome = await resumeSubscription(tx, tenant, {
        audit: request.auditContext(),
        now: new Date(),
      });
      return {
        view: await buildSubscriptionView(tx, tenant, env),
        plan: outcome.changed ? await readCancellationRecipients(tx, tenant) : null,
      };
    });
    if (plan) await sendCancellationMail(tenant, plan, { kind: 'resumed' }, mail);
    return reply.send(view);
  });
}
