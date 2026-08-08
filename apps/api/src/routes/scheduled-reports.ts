/**
 * Scheduled report exports — list, create, read, edit and cancel, plus one
 * definition's delivery history (PRD §5.3-Reports).
 *
 * Kept out of `reports.ts` because it is a different kind of surface: every
 * other `/reports/*` route is a synchronous read that answers "what happened in
 * this window", while these define background work that mails data out later.
 *
 * Every operation on a *definition* takes `reports_manage` — the write scope
 * this slice adds — rather than the read-only `reports_read`. Creating, editing
 * and cancelling a schedule are plainly mutations; the two reads take the same
 * scope because a definition carries the mailboxes its reports go to, so reading
 * one answers "who receives our numbers", which belongs to managing the
 * schedules rather than to reading a report. Only `ADMIN_SCOPES` carries it, so
 * an ordinary agent token is refused at the guard (FR-MOD-07.7
 * "permission-based visibility").
 *
 * That applies to the by-id read as much as to the list: it returns the same
 * DTO, recipients included, so gating it on `reports_read` would hand the read
 * scope the very thing the list refuses it.
 *
 * The delivery history is the one exception, and for the same reason rather
 * than in spite of it — see the route.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { isAgent } from '../services/auth/principal.js';
import {
  ScheduledReportService,
  type ScheduledExportInput,
  type ScheduledExportPatch,
} from '../services/reports/scheduled-report-service.js';

/**
 * `.strict()` so a mistyped key is a 400 rather than a schedule that silently
 * ignores what the caller asked for and runs on the defaults instead.
 *
 * `group` is only shape-checked here; the catalogue lookup that decides whether
 * it names a real report lives in the service, next to the catalogue itself.
 * `format` is an enum of one: `csv` is the only shape the scheduler renders, and
 * accepting `pdf` here would promise a delivery nothing produces.
 */
const createBody = z
  .object({
    group: z.string().trim().min(1).max(64),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    format: z.enum(['csv']).optional(),
    // A cap on the fan-out: a schedule is unattended, recurring egress, and an
    // unbounded list would make one definition a mailing list.
    recipients: z.array(z.string().trim().email()).min(1).max(20),
    enabled: z.boolean().optional(),
  })
  .strict();

/**
 * The same pieces as `createBody`, each optional — the validation a value has to
 * survive must not depend on which verb carried it.
 *
 * `.refine` rejects the empty body: a PATCH that changes nothing is a client
 * that meant to change something and sent the wrong keys, and answering 200 to
 * it would hide the bug behind an unchanged definition.
 */
const updateBody = z
  .object({
    group: createBody.shape.group.optional(),
    frequency: createBody.shape.frequency.optional(),
    format: createBody.shape.format,
    recipients: createBody.shape.recipients.optional(),
    enabled: createBody.shape.enabled,
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const scheduledExportIdSchema = z.string().uuid();

/**
 * `.max(100)` rejects rather than clamps: a caller that asked for 500 and got
 * 100 back would have no way to tell a capped page from the whole history.
 */
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function scheduledReportRoutes(app: FastifyInstance): Promise<void> {
  const schedules = new ScheduledReportService();

  app.get(
    '/reports/scheduled-exports',
    { config: { scopes: ['reports_manage'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const result = await request.withTenant((tx) => schedules.list(tx, tenant));
      return reply.send(result);
    },
  );

  app.post(
    '/reports/scheduled-exports',
    { config: { scopes: ['reports_manage'] } },
    async (request, reply) => {
      const body = parse(createBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const input: ScheduledExportInput = {
        group: body.group,
        frequency: body.frequency,
        format: body.format ?? 'csv',
        recipients: body.recipients,
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        // A soft reference for the settings screen. A bot token may hold the
        // scope and leaves it unset rather than borrowing someone's identity.
        ...(isAgent(principal) ? { createdByAgentId: principal.accountId } : {}),
      };

      const created = await request.withTenant((tx) => schedules.create(tx, tenant, input));
      return reply.status(201).send(created);
    },
  );

  app.get<{ Params: { scheduledExportId: string } }>(
    '/reports/scheduled-exports/:scheduledExportId',
    { config: { scopes: ['reports_manage'] } },
    async (request, reply) => {
      const id = parse(scheduledExportIdSchema, request.params.scheduledExportId);
      const tenant = request.tenant();
      const schedule = await request.withTenant((tx) => schedules.get(tx, tenant, id));
      return reply.send(schedule);
    },
  );

  app.patch<{ Params: { scheduledExportId: string } }>(
    '/reports/scheduled-exports/:scheduledExportId',
    { config: { scopes: ['reports_manage'] } },
    async (request, reply) => {
      const id = parse(scheduledExportIdSchema, request.params.scheduledExportId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();

      // Spread rather than assign each key: an explicit `undefined` would read
      // as "clear this field" to the service, which is not what "absent" means.
      const patch: ScheduledExportPatch = {
        ...(body.group === undefined ? {} : { group: body.group }),
        ...(body.frequency === undefined ? {} : { frequency: body.frequency }),
        ...(body.format === undefined ? {} : { format: body.format }),
        ...(body.recipients === undefined ? {} : { recipients: body.recipients }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      };

      const updated = await request.withTenant((tx) => schedules.update(tx, tenant, id, patch));
      return reply.send(updated);
    },
  );

  /**
   * The one route here that takes `reports_read` rather than `reports_manage`.
   *
   * Not an inconsistency — it is what the DTO makes possible. A run says which
   * period it covered, how it ended and how many mailboxes it reached; it never
   * names one. The addresses are the reason the definition surface is gated on
   * the management scope, and with them absent, "did last week's report go
   * out?" is a question about reports, answerable by anyone who may read them
   * (NFR-M5). The `error` line comes back as the sweep sanitised it: one
   * bounded line naming the cause, which is what makes a failed delivery
   * visible instead of silent.
   */
  app.get<{ Params: { scheduledExportId: string } }>(
    '/reports/scheduled-exports/:scheduledExportId/runs',
    { config: { scopes: ['reports_read'] } },
    async (request, reply) => {
      const id = parse(scheduledExportIdSchema, request.params.scheduledExportId);
      const { limit } = parse(runsQuery, request.query);
      const tenant = request.tenant();
      const result = await request.withTenant((tx) => schedules.runs(tx, tenant, id, limit));
      return reply.send(result);
    },
  );

  app.delete<{ Params: { scheduledExportId: string } }>(
    '/reports/scheduled-exports/:scheduledExportId',
    { config: { scopes: ['reports_manage'] } },
    async (request, reply) => {
      const id = parse(scheduledExportIdSchema, request.params.scheduledExportId);
      const tenant = request.tenant();
      await request.withTenant((tx) => schedules.remove(tx, tenant, id));
      return reply.status(204).send();
    },
  );
}
