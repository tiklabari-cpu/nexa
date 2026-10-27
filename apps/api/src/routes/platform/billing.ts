/**
 * `/platform/v1/billing/*` — billing across every workspace (tm 389.12 ·
 * FR-ADMIN-12 · design.md §C billing).
 *
 *   GET  /billing/plans                          billing.read
 *   GET  /billing/subscriptions                  billing.read     ?plan&status&past_due, keyset
 *   GET  /billing/invoices                       billing.read     ?license_id&period&status, keyset
 *   GET  /billing/invoices/{invoiceId}/download  billing.read     CSV, the workspace's own
 *   GET  /billing/packages                       billing.read
 *   GET  /billing/revenue                        billing.read     ?months=1..36
 *   GET  /billing/credits                        billing.read     ?license_id&open, keyset
 *   POST /billing/credits                        billing.manage   billing.credit_granted
 *   POST /billing/manual-subscription            billing.manage   billing.manual_subscription_created
 *
 * `billing` writes and `support` only reads (decision 4): `billing.manage` is
 * superadmin + billing, `billing.read` every role. Both mutations take a
 * `{reason}` and write both audit trails in the transaction of the change —
 * the platform chain with the reason, the workspace's own trail without it.
 * A licence number that names no workspace is 404, like a malformed one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import {
  BILLING_CYCLES,
  PLAN_IDS,
  type PlanId,
} from '../../services/billing/subscription-service.js';
import {
  BILLING_LIST_MAX,
  BillingCursorError,
  createManualSubscription,
  CREDIT_MAX_MINOR,
  grantCredit,
  PlatformBilling,
  REVENUE_MONTHS_DEFAULT,
  REVENUE_MONTHS_MAX,
} from '../../services/platform/billing.js';
import { PlatformWorkspaces } from '../../services/platform/workspaces.js';
import { toCsv } from '../reports-export.js';
import { parse } from './auth.js';

const LICENSE_ID = z.string().regex(/^[1-9]\d{0,18}$/);
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const page = {
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(BILLING_LIST_MAX).optional(),
};

const subscriptionsQuery = z.object({
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  past_due: flag.optional(),
  ...page,
});

const invoicesQuery = z.object({
  license_id: LICENSE_ID.optional(),
  period: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  status: z.enum(['paid', 'trial']).optional(),
  ...page,
});

const revenueQuery = z.object({
  months: z.coerce.number().int().min(1).max(REVENUE_MONTHS_MAX).default(REVENUE_MONTHS_DEFAULT),
});

const creditsQuery = z.object({
  license_id: LICENSE_ID.optional(),
  open: flag.optional(),
  ...page,
});

const creditBody = z.object({
  license_id: LICENSE_ID,
  amount_minor: z.number().int().min(1).max(CREDIT_MAX_MINOR),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const manualSubscriptionBody = z.object({
  license_id: LICENSE_ID,
  plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
  period_end: z.string().datetime({ offset: true }),
  seats: z.number().int().min(1).max(100_000).optional(),
  billing_cycle: z.enum(BILLING_CYCLES).optional(),
});

const CURSOR_REFUSED =
  '`cursor` is not a cursor of this list with these filters. Start again without it.';

export default async function platformBillingRoutes(
  app: FastifyInstance,
  options: { env: Env; now?: () => number },
): Promise<void> {
  const { env } = options;
  const clock = options.now ?? Date.now;
  const billing = new PlatformBilling(app.platformDb, {
    env,
    ...(options.now ? { now: options.now } : {}),
  });
  const workspaces = new PlatformWorkspaces(app.platformDb, {
    env,
    ...(options.now ? { now: options.now } : {}),
  });
  const read = { platform: { permission: 'billing.read' as const } };

  async function paged<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BillingCursorError) throw ApiError.validation(CURSOR_REFUSED);
      throw error;
    }
  }

  /** The workspace a body names, or 404 — before anything is written. */
  async function workspaceOf(raw: string): Promise<bigint> {
    const tenant = await workspaces.tenant(BigInt(raw));
    if (!tenant) throw ApiError.notFound('Workspace not found.');
    return tenant.licenseId;
  }

  app.get('/billing/plans', { config: read }, async () => ({ data: await billing.plans() }));

  app.get('/billing/subscriptions', { config: read }, async (request, reply) => {
    const query = parse(subscriptionsQuery, request.query);
    const result = await paged(() =>
      billing.subscriptions({
        ...(query.plan ? { plan: query.plan } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.past_due !== undefined ? { pastDue: query.past_due } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    );
    return reply.header('cache-control', 'no-store').send(result);
  });

  app.get('/billing/invoices', { config: read }, async (request, reply) => {
    const query = parse(invoicesQuery, request.query);
    const result = await paged(() =>
      billing.invoices({
        ...(query.license_id ? { licenseId: BigInt(query.license_id) } : {}),
        ...(query.period ? { period: query.period } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    );
    return reply.header('cache-control', 'no-store').send(result);
  });

  app.get('/billing/invoices/:invoiceId/download', { config: read }, async (request, reply) => {
    const id = (request.params as Record<string, unknown>)['invoiceId'];
    const csv = typeof id === 'string' ? await billing.invoiceCsv(id) : null;
    if (!csv) throw ApiError.notFound('Invoice not found.');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${csv.filename}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
      .send(toCsv(csv.headers, csv.rows));
  });

  app.get('/billing/packages', { config: read }, async () => billing.packages());

  app.get('/billing/revenue', { config: read }, async (request, reply) => {
    const { months } = parse(revenueQuery, request.query);
    return reply.header('cache-control', 'no-store').send(await billing.revenue(months));
  });

  app.get('/billing/credits', { config: read }, async (request, reply) => {
    const query = parse(creditsQuery, request.query);
    const result = await paged(() =>
      billing.credits({
        ...(query.license_id ? { licenseId: BigInt(query.license_id) } : {}),
        ...(query.open !== undefined ? { open: query.open } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    );
    return reply.header('cache-control', 'no-store').send(result);
  });

  app.post(
    '/billing/credits',
    {
      config: {
        platform: {
          permission: 'billing.manage',
          audit: { action: 'billing.credit_granted', target: 'credit' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(creditBody, request.body);
      const licenseId = await workspaceOf(body.license_id);
      const reason = request.platformAudit!.reason!;
      const adminId = request.platformSession!.adminId;
      const credit = await app.platformAuditLog.run(
        (view: Awaited<ReturnType<typeof billing.credit>>) =>
          request.platformAuditEntry({
            targetId: view.id,
            licenseId,
            payload: {
              credit_id: view.id,
              amount_minor: view.amount_minor,
              currency: view.currency,
            },
          }),
        async (tx) => {
          const { id } = await grantCredit(tx, {
            licenseId,
            amountMinor: body.amount_minor,
            currency: body.currency,
            reason,
            adminId,
          });
          return billing.credit(tx, id);
        },
      );
      return reply.code(201).header('cache-control', 'no-store').send({ credit });
    },
  );

  app.post(
    '/billing/manual-subscription',
    {
      config: {
        platform: {
          permission: 'billing.manage',
          audit: { action: 'billing.manual_subscription_created', target: 'workspace' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(manualSubscriptionBody, request.body);
      const licenseId = await workspaceOf(body.license_id);
      const outcome = await app.platformDb.$transaction(
        async (tx) => {
          const result = await createManualSubscription(
            tx,
            licenseId,
            {
              plan: body.plan,
              periodEnd: new Date(body.period_end),
              ...(body.seats !== undefined ? { seats: body.seats } : {}),
              ...(body.billing_cycle ? { billingCycle: body.billing_cycle } : {}),
            },
            new Date(clock()),
          );
          await app.platformAuditLog.record(
            request.platformAuditEntry({
              targetId: licenseId.toString(),
              licenseId,
              payload: result.payload,
            }),
            tx,
          );
          return result;
        },
        { timeout: 30_000 },
      );
      const workspace = await workspaces.detail(licenseId);
      if (!workspace) throw ApiError.notFound('Workspace not found.');
      return reply
        .header('cache-control', 'no-store')
        .send({ unchanged: outcome.unchanged, workspace });
    },
  );
}
