/**
 * `/platform/v1/workspaces/*` — the workspace read surface (tm 389.9 ·
 * FR-ADMIN-08 · design.md §C workspaces).
 *
 *   GET  /workspaces                                   workspaces.read     filters, sort, keyset
 *   GET  /workspaces/{licenseId}                       workspaces.read     organization, licence, Kurucu, counts
 *   GET  /workspaces/{licenseId}/members               workspaces.read
 *   GET  /workspaces/{licenseId}/brands                workspaces.read
 *   GET  /workspaces/{licenseId}/usage                 workspaces.read     ?days=1..90
 *   GET  /workspaces/{licenseId}/subscription          workspaces.read     the tenant's own view
 *   GET  /workspaces/{licenseId}/invoices              workspaces.read     the tenant's own list
 *   GET  /workspaces/{licenseId}/invoices/{period}/download                CSV
 *   GET  /workspaces/{licenseId}/sandbox               workspaces.read
 *   GET  /workspaces/{licenseId}/notes                 workspaces.read     keyset
 *   POST /workspaces/{licenseId}/notes                 workspaces.support  workspace.note_added
 *   GET  /workspaces/{licenseId}/impersonations        workspaces.read     389.15's sessions
 *   GET  /workspaces/{licenseId}/ai-summary            workspaces.read     counts and states (389.19)
 *
 * The actions (tm 389.10 · FR-ADMIN-09), each `{reason}` and both audit trails:
 *
 *   POST /workspaces/{licenseId}/extend-trial          workspaces.support  {days}
 *   POST /workspaces/{licenseId}/resend-owner-verification   workspaces.support
 *   POST /workspaces/{licenseId}/sandbox/reset         workspaces.support
 *   POST /workspaces/{licenseId}/activate              workspaces.billing
 *   POST /workspaces/{licenseId}/set-plan              workspaces.billing  {plan}
 *   GET  /workspaces/{licenseId}/overrides             workspaces.read
 *   PUT  /workspaces/{licenseId}/overrides             workspaces.billing  the whole row
 *   POST /workspaces/{licenseId}/suspend               workspaces.lifecycle  recentTotp
 *   POST /workspaces/{licenseId}/unsuspend             workspaces.lifecycle  recentTotp
 *   POST /workspaces/{licenseId}/set-read-only         workspaces.lifecycle
 *   POST /workspaces/{licenseId}/set-active            workspaces.lifecycle
 *   POST /workspaces/{licenseId}/subscription/cancel   workspaces.lifecycle
 *   POST /workspaces/{licenseId}/subscription/resume   workspaces.lifecycle
 *   POST /workspaces/{licenseId}/force-ownership-transfer  workspaces.lifecycle  recentTotp
 *   POST /workspaces/{licenseId}/delete                workspaces.lifecycle  recentTotp, {confirm_name}
 *   POST /workspaces/{licenseId}/delete/cancel         workspaces.lifecycle
 *   GET  /workspaces/purge-queue                       workspaces.read
 *
 * Every action answers `{unchanged, workspace}` — the detail as it now reads.
 * Asking for the state the workspace is already in is `unchanged: true`, not
 * an error, and records nothing; a state the action cannot start from is 409
 * `platform_workspace_state` (`services/platform/workspace-actions.ts`).
 * Mail goes after the commit and never undoes the action: the response says
 * `mail: sent | failed`.
 *
 * The workspace's own audit trail is `GET /audit/workspaces/{licenseId}`
 * (`routes/platform/audit.ts`, tm 389.5) — one route, not a second copy here.
 *
 * A licence number that is not one (`abc`, a UUID) is the same 404 as an
 * unknown one. Reads write no audit entry; the note does, in the same
 * transaction as the note — on the platform chain and on the workspace's own
 * trail, with the note's id and length, never its text.
 */
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENTITLEMENTS, SUBSCRIPTION_STATUSES, type Entitlement } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { hashToken } from '../../services/auth/lifecycle-service.js';
import { PLAN_IDS, type PlanId } from '../../services/billing/subscription-service.js';
import { invoiceCsvRows, invoiceFilename } from '../../services/billing/invoice-service.js';
import { deliver, logUnsentMail, type MailOutcome } from '../../services/mail/delivery.js';
import type { Mailer, Message } from '../../services/mail/mailer.js';
import { isMailLocale, type MailLocale } from '../../services/mail/templates/layout.js';
import {
  formatDay,
  ownershipTransferredMail,
  verifyEmailMail,
  workspacePurgeScheduledMail,
} from '../../services/mail/templates/messages.js';
import type {
  PlatformAuditAction,
  PlatformAuditRouteConfig,
} from '../../services/platform/platform-audit.js';
import {
  activate,
  cancelDeletion,
  extendTrial,
  forceOwnershipTransfer,
  issueOwnerVerification,
  purgeQueue,
  PURGE_COOLING_OFF_DAYS,
  putOverrides,
  readOverrides,
  resetSandbox,
  scheduleDeletion,
  setActive,
  setPlan,
  setReadOnly,
  setSubscriptionCancellation,
  suspend,
  TRIAL_EXTENSION_MAX_DAYS,
  unsuspend,
  type ActionOutcome,
} from '../../services/platform/workspace-actions.js';
import {
  addWorkspaceNote,
  PlatformWorkspaces,
  USAGE_DAYS_DEFAULT,
  USAGE_DAYS_MAX,
  WORKSPACE_SORTS,
  WorkspaceCursorError,
} from '../../services/platform/workspaces.js';
import { PlatformAiCatalogs } from '../../services/platform/ai-catalogs.js';
import { toCsv } from '../reports-export.js';
import { parse } from './auth.js';

const LICENSE_ID_RE = /^[1-9]\d{0,18}$/;

const listQuery = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  region: z.enum(['eu', 'us']).optional(),
  trial_ends_before: z.coerce.date().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(WORKSPACE_SORTS).default('created_desc'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const usageQuery = z.object({
  days: z.coerce.number().int().min(1).max(USAGE_DAYS_MAX).default(USAGE_DAYS_DEFAULT),
});

const notesQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const noteBody = z.object({
  body: z.string().trim().min(1).max(4000),
  reason: z.string(),
});

const extendTrialBody = z.object({
  days: z.number().int().min(1).max(TRIAL_EXTENSION_MAX_DAYS),
});

const setPlanBody = z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]) });

const entitlementOverrides = z
  .object(
    Object.fromEntries(ENTITLEMENTS.map((key) => [key, z.boolean().optional()])) as Record<
      Entitlement,
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

const overridesBody = z.object({
  entitlements: entitlementOverrides.default({}),
  seat_ceiling: z.number().int().min(1).max(100_000).nullable().default(null),
  mail_daily_cap: z.number().int().min(1).max(1_000_000).nullable().default(null),
  expires_at: z.string().datetime({ offset: true }).nullable().default(null),
});

const forceTransferBody = z.object({
  to_account_id: z.string().uuid(),
  // Every step, or no transfer (FR-ADMIN-09): the checklist is the evidence
  // the chain keeps of why a stranger was trusted with the workspace.
  verification_checklist: z.object({
    ticket_id: z.string().trim().min(1).max(100),
    signed_request: z.literal(true),
    phone_verified: z.literal(true),
  }),
});

const deleteBody = z.object({ confirm_name: z.string().max(255) });

const CURSOR_REFUSED =
  '`cursor` is not a cursor of this list with these filters. Start again without it.';

export default async function platformWorkspacesRoutes(
  app: FastifyInstance,
  options: { env: Env; mailer: Mailer; now?: () => number },
): Promise<void> {
  const { env, mailer } = options;
  const workspaces = new PlatformWorkspaces(app.platformDb, {
    env,
    ...(options.now ? { now: options.now } : {}),
  });
  const aiCatalogs = new PlatformAiCatalogs(
    app.platformDb,
    options.now ? { now: options.now } : {},
  );
  const clock = options.now ?? Date.now;
  const read = { platform: { permission: 'workspaces.read' as const } };
  const onWorkspace = (action: PlatformAuditAction): PlatformAuditRouteConfig => ({
    action,
    target: 'workspace',
    targetParam: 'licenseId',
  });
  const gate = (
    permission: 'workspaces.support' | 'workspaces.billing' | 'workspaces.lifecycle',
    action: PlatformAuditAction,
    recentTotp = false,
  ) => ({
    platform: {
      permission,
      ...(recentTotp ? { recentTotp: true } : {}),
      audit: onWorkspace(action),
    },
  });

  /** The path's licence number, or a 404 — malformed and unknown alike. */
  function licenseIdOf(request: FastifyRequest): bigint {
    const raw = (request.params as Record<string, unknown>)['licenseId'];
    if (typeof raw !== 'string' || !LICENSE_ID_RE.test(raw)) {
      throw ApiError.notFound('Workspace not found.');
    }
    return BigInt(raw);
  }

  async function tenantOf(request: FastifyRequest) {
    const tenant = await workspaces.tenant(licenseIdOf(request));
    if (!tenant) throw ApiError.notFound('Workspace not found.');
    return tenant;
  }

  app.get('/workspaces', { config: read }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    try {
      const page = await workspaces.list({
        sort: query.sort,
        ...(query.status ? { status: query.status } : {}),
        ...(query.plan ? { plan: query.plan } : {}),
        ...(query.region ? { region: query.region } : {}),
        ...(query.trial_ends_before ? { trialEndsBefore: query.trial_ends_before } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
      return reply.header('cache-control', 'no-store').send(page);
    } catch (error) {
      if (error instanceof WorkspaceCursorError) throw ApiError.validation(CURSOR_REFUSED);
      throw error;
    }
  });

  app.get('/workspaces/:licenseId', { config: read }, async (request, reply) => {
    const workspace = await workspaces.detail(licenseIdOf(request));
    if (!workspace) throw ApiError.notFound('Workspace not found.');
    return reply.header('cache-control', 'no-store').send({ workspace });
  });

  app.get('/workspaces/:licenseId/members', { config: read }, async (request, reply) => {
    const tenant = await tenantOf(request);
    return reply
      .header('cache-control', 'no-store')
      .send({ data: await workspaces.members(tenant.licenseId) });
  });

  app.get('/workspaces/:licenseId/brands', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    return { data: await workspaces.brands(tenant.licenseId) };
  });

  app.get('/workspaces/:licenseId/usage', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    const { days } = parse(usageQuery, request.query);
    return workspaces.usage(tenant, days);
  });

  app.get('/workspaces/:licenseId/subscription', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    return workspaces.subscription(tenant);
  });

  app.get('/workspaces/:licenseId/invoices', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    return { invoices: await workspaces.invoices(tenant) };
  });

  // The workspace's own download, byte for byte (`routes/reports.ts`).
  app.get(
    '/workspaces/:licenseId/invoices/:period/download',
    { config: read },
    async (request, reply) => {
      const tenant = await tenantOf(request);
      const period = (request.params as Record<string, unknown>)['period'];
      const invoice =
        typeof period === 'string' && /^\d{6}$/.test(period)
          ? (await workspaces.invoices(tenant)).find((item) => item.period === period)
          : undefined;
      if (!invoice) throw ApiError.notFound('No invoice for that period.');
      const { headers, rows } = invoiceCsvRows(invoice);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${invoiceFilename(invoice.period)}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .send(toCsv(headers, rows));
    },
  );

  app.get('/workspaces/:licenseId/sandbox', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    return workspaces.sandbox(tenant);
  });

  app.get('/workspaces/:licenseId/notes', { config: read }, async (request, reply) => {
    const tenant = await tenantOf(request);
    const query = parse(notesQuery, request.query);
    try {
      const page = await workspaces.notes(tenant.licenseId, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
      return reply.header('cache-control', 'no-store').send(page);
    } catch (error) {
      if (error instanceof WorkspaceCursorError) throw ApiError.validation(CURSOR_REFUSED);
      throw error;
    }
  });

  app.post(
    '/workspaces/:licenseId/notes',
    {
      config: {
        platform: {
          permission: 'workspaces.support',
          audit: { action: 'workspace.note_added', target: 'workspace', targetParam: 'licenseId' },
        },
      },
    },
    async (request, reply) => {
      const tenant = await tenantOf(request);
      const { body } = parse(noteBody, request.body);
      const adminId = request.platformSession!.adminId;
      const note = await app.platformAuditLog.run(
        (created: Awaited<ReturnType<typeof addWorkspaceNote>>) =>
          request.platformAuditEntry({
            licenseId: tenant.licenseId,
            payload: { note_id: created.id, length: created.body.length },
          }),
        (tx) => addWorkspaceNote(tx, { licenseId: tenant.licenseId, adminId, body }),
      );
      return reply.code(201).send(note);
    },
  );

  app.get('/workspaces/:licenseId/impersonations', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    return { data: await workspaces.impersonations(tenant.licenseId) };
  });

  app.get('/workspaces/:licenseId/ai-summary', { config: read }, async (request) => {
    const tenant = await tenantOf(request);
    return aiCatalogs.workspaceSummary(tenant.licenseId);
  });

  // --- Actions (tm 389.10) ---------------------------------------------------

  /**
   * Run one action and its audit entries in one transaction. An unchanged
   * outcome writes no entry — nothing happened — and marks the request
   * recorded so the response hook does not write one either.
   */
  async function perform<T extends ActionOutcome>(
    request: FastifyRequest,
    licenseId: bigint,
    action: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
  ): Promise<T> {
    const outcome = await app.platformDb.$transaction(
      async (tx) => {
        const result = await action(tx, new Date(clock()));
        if (!result.unchanged) {
          await app.platformAuditLog.record(
            request.platformAuditEntry({ licenseId, payload: result.payload }),
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
    licenseId: bigint,
    outcome: ActionOutcome,
    extra: Record<string, unknown> = {},
  ) {
    const workspace = await workspaces.detail(licenseId);
    if (!workspace) throw ApiError.notFound('Workspace not found.');
    return reply
      .header('cache-control', 'no-store')
      .send({ unchanged: outcome.unchanged, workspace, ...extra });
  }

  /** Mail one message after the commit; the action stands whatever the mail does. */
  async function mail(
    request: FastifyRequest,
    event: string,
    message: Message,
  ): Promise<MailOutcome['status']> {
    const outcome = await deliver(mailer, message);
    logUnsentMail(request.log, event, outcome);
    return outcome.status;
  }

  const mailLocale = (value: string | null | undefined): MailLocale =>
    isMailLocale(value) ? value : 'en';

  /** The simple status moves: a lock, a rule, the new state. */
  for (const [path, action, permission, fresh, run] of [
    ['activate', 'workspace.activated', 'workspaces.billing', false, (tx, id) => activate(tx, id)],
    [
      'set-read-only',
      'workspace.read_only_set',
      'workspaces.lifecycle',
      false,
      (tx, id) => setReadOnly(tx, id),
    ],
    [
      'set-active',
      'workspace.active_set',
      'workspaces.lifecycle',
      false,
      (tx, id) => setActive(tx, id),
    ],
    [
      'unsuspend',
      'workspace.unsuspended',
      'workspaces.lifecycle',
      true,
      (tx, id) => unsuspend(tx, id),
    ],
    [
      'subscription/cancel',
      'workspace.cancelled',
      'workspaces.lifecycle',
      false,
      (tx, id, now) => setSubscriptionCancellation(tx, id, true, now),
    ],
    [
      'subscription/resume',
      'workspace.resumed',
      'workspaces.lifecycle',
      false,
      (tx, id, now) => setSubscriptionCancellation(tx, id, false, now),
    ],
    [
      'delete/cancel',
      'workspace.deletion_cancelled',
      'workspaces.lifecycle',
      false,
      (tx, id) => cancelDeletion(tx, id),
    ],
    [
      'sandbox/reset',
      'workspace.sandbox_reset',
      'workspaces.support',
      false,
      (tx, id) => resetSandbox(tx, id),
    ],
  ] as const satisfies ReadonlyArray<
    readonly [
      string,
      PlatformAuditAction,
      'workspaces.support' | 'workspaces.billing' | 'workspaces.lifecycle',
      boolean,
      (tx: Prisma.TransactionClient, licenseId: bigint, now: Date) => Promise<ActionOutcome>,
    ]
  >) {
    app.post(
      `/workspaces/:licenseId/${path}`,
      { config: gate(permission, action, fresh) },
      async (request, reply) => {
        const { licenseId } = await tenantOf(request);
        const outcome = await perform(request, licenseId, (tx, now) => run(tx, licenseId, now));
        return answer(reply, licenseId, outcome);
      },
    );
  }

  app.post(
    '/workspaces/:licenseId/extend-trial',
    { config: gate('workspaces.support', 'workspace.trial_extended') },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const { days } = parse(extendTrialBody, request.body);
      const outcome = await perform(request, licenseId, (tx, now) =>
        extendTrial(tx, licenseId, days, now),
      );
      return answer(reply, licenseId, outcome);
    },
  );

  app.post(
    '/workspaces/:licenseId/set-plan',
    { config: gate('workspaces.billing', 'workspace.plan_changed') },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const { plan } = parse(setPlanBody, request.body);
      const outcome = await perform(request, licenseId, (tx) => setPlan(tx, licenseId, plan));
      return answer(reply, licenseId, outcome);
    },
  );

  app.post(
    '/workspaces/:licenseId/suspend',
    { config: gate('workspaces.lifecycle', 'workspace.suspended', true) },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const reason = request.platformAudit!.reason!;
      const outcome = await perform(request, licenseId, (tx, now) =>
        suspend(tx, licenseId, reason, now),
      );
      return answer(reply, licenseId, outcome);
    },
  );

  app.get('/workspaces/:licenseId/overrides', { config: read }, async (request, reply) => {
    const { licenseId } = await tenantOf(request);
    const overrides = await readOverrides(app.platformDb, licenseId, new Date(clock()));
    return reply.header('cache-control', 'no-store').send({ overrides });
  });

  app.put(
    '/workspaces/:licenseId/overrides',
    { config: gate('workspaces.billing', 'workspace.overrides_changed') },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const body = parse(overridesBody, request.body);
      const adminId = request.platformSession!.adminId;
      const outcome = await perform(request, licenseId, (tx, now) =>
        putOverrides(
          tx,
          licenseId,
          {
            entitlements: body.entitlements,
            seat_ceiling: body.seat_ceiling,
            mail_daily_cap: body.mail_daily_cap,
            expires_at: body.expires_at === null ? null : new Date(body.expires_at),
          },
          adminId,
          now,
        ),
      );
      return answer(reply, licenseId, outcome, {
        overrides: await readOverrides(app.platformDb, licenseId, new Date(clock())),
      });
    },
  );

  app.post(
    '/workspaces/:licenseId/resend-owner-verification',
    { config: gate('workspaces.support', 'workspace.owner_verification_resent') },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const token = randomBytes(32).toString('base64url');
      const hours = env.SIGNUP_VERIFICATION_TTL_HOURS;
      const outcome = await perform(request, licenseId, (tx, now) =>
        issueOwnerVerification(tx, licenseId, {
          hash: hashToken(token),
          expiresAt: new Date(now.getTime() + hours * 3_600_000),
        }),
      );
      if (!outcome.owner) return answer(reply, licenseId, outcome);

      const url = `${env.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
      const status = await mail(request, 'workspace_owner_verification.mail', {
        to: outcome.owner.email,
        // Account mail, like the owner's own resend (`account-lifecycle.ts`).
        licenseId: null,
        kind: 'email_verification',
        ...verifyEmailMail(
          { locale: mailLocale(outcome.owner.locale), appUrl: env.WEB_APP_URL },
          { url, hours },
        ),
      });
      return answer(reply, licenseId, outcome, { mail: status === 'sent' ? 'sent' : 'failed' });
    },
  );

  app.post(
    '/workspaces/:licenseId/force-ownership-transfer',
    { config: gate('workspaces.lifecycle', 'workspace.ownership_transferred', true) },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const body = parse(forceTransferBody, request.body);
      const outcome = await perform(request, licenseId, (tx) =>
        forceOwnershipTransfer(tx, licenseId, body.to_account_id, body.verification_checklist),
      );
      if (outcome.unchanged) return answer(reply, licenseId, outcome);

      // Both sides and every admin hear it, so a transfer nobody asked for
      // cannot pass unnoticed.
      const [organization, people] = await Promise.all([
        app.platformDb.license.findUniqueOrThrow({
          where: { id: licenseId },
          select: { organization: { select: { name: true } } },
        }),
        app.platformDb.agentMembership.findMany({
          where: {
            licenseId,
            suspended: false,
            OR: [
              {
                agentId: {
                  in: [
                    outcome.toAccountId,
                    ...(outcome.fromAccountId === null ? [] : [outcome.fromAccountId]),
                  ],
                },
              },
              { role: { in: ['admin', 'viceowner'] } },
            ],
          },
          select: { agentId: true, locale: true, agent: { select: { email: true } } },
        }),
      ]);
      const emailOf = (id: string | null) =>
        id === null ? null : (people.find((p) => p.agentId === id)?.agent.email ?? null);
      const newOwner = emailOf(outcome.toAccountId) ?? outcome.toAccountId;
      const previousOwner = emailOf(outcome.fromAccountId);
      const statuses = await Promise.all(
        people.map((person) =>
          mail(request, 'workspace_ownership_transferred.mail', {
            to: person.agent.email,
            licenseId,
            kind: 'ownership_transferred',
            ...ownershipTransferredMail(
              { locale: mailLocale(person.locale), appUrl: env.WEB_APP_URL },
              {
                workspaceName: organization.organization.name,
                newOwner,
                previousOwner,
                role:
                  person.agentId === outcome.toAccountId
                    ? 'new_owner'
                    : person.agentId === outcome.fromAccountId
                      ? 'previous_owner'
                      : 'admin',
              },
            ),
          }),
        ),
      );
      return answer(reply, licenseId, outcome, {
        mail: statuses.every((status) => status === 'sent') ? 'sent' : 'failed',
      });
    },
  );

  app.post(
    '/workspaces/:licenseId/delete',
    { config: gate('workspaces.lifecycle', 'workspace.deletion_scheduled', true) },
    async (request, reply) => {
      const { licenseId } = await tenantOf(request);
      const { confirm_name: confirmName } = parse(deleteBody, request.body);
      const reason = request.platformAudit!.reason!;
      const outcome = await perform(request, licenseId, (tx, now) =>
        scheduleDeletion(tx, licenseId, { confirmName, reason }, now),
      );
      if (outcome.unchanged) return answer(reply, licenseId, outcome);

      const owner = await app.platformDb.agentMembership.findFirst({
        where: { licenseId, role: 'owner' },
        select: {
          locale: true,
          agent: { select: { email: true } },
          license: { select: { organization: { select: { name: true, timezone: true } } } },
        },
      });
      if (!owner) return answer(reply, licenseId, outcome, { mail: 'failed' });
      const locale = mailLocale(owner.locale);
      const { name, timezone } = owner.license.organization;
      const status = await mail(request, 'workspace_purge_scheduled.mail', {
        to: owner.agent.email,
        licenseId,
        kind: 'workspace_purge_scheduled',
        ...workspacePurgeScheduledMail(
          { locale, appUrl: env.WEB_APP_URL },
          {
            workspaceName: name,
            purgeAt: formatDay(outcome.purgeAt, locale, timezone),
            days: PURGE_COOLING_OFF_DAYS,
          },
        ),
      });
      return answer(reply, licenseId, outcome, { mail: status === 'sent' ? 'sent' : 'failed' });
    },
  );

  app.get('/workspaces/purge-queue', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send({ data: await purgeQueue(app.platformDb) }),
  );
}
