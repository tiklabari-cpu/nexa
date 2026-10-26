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
 *   GET  /workspaces/{licenseId}/ai-summary            workspaces.read     counts (389.19 adds more)
 *
 * The workspace's own audit trail is `GET /audit/workspaces/{licenseId}`
 * (`routes/platform/audit.ts`, tm 389.5) — one route, not a second copy here.
 *
 * A licence number that is not one (`abc`, a UUID) is the same 404 as an
 * unknown one. Reads write no audit entry; the note does, in the same
 * transaction as the note — on the platform chain and on the workspace's own
 * trail, with the note's id and length, never its text.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { PLAN_IDS } from '../../services/billing/subscription-service.js';
import { invoiceCsvRows, invoiceFilename } from '../../services/billing/invoice-service.js';
import {
  addWorkspaceNote,
  PlatformWorkspaces,
  USAGE_DAYS_DEFAULT,
  USAGE_DAYS_MAX,
  WORKSPACE_SORTS,
  WorkspaceCursorError,
} from '../../services/platform/workspaces.js';
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

const CURSOR_REFUSED =
  '`cursor` is not a cursor of this list with these filters. Start again without it.';

export default async function platformWorkspacesRoutes(
  app: FastifyInstance,
  options: { env: Env; now?: () => number },
): Promise<void> {
  const workspaces = new PlatformWorkspaces(app.platformDb, {
    env: options.env,
    ...(options.now ? { now: options.now } : {}),
  });
  const read = { platform: { permission: 'workspaces.read' as const } };

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
    return workspaces.aiSummary(tenant.licenseId);
  });
}
