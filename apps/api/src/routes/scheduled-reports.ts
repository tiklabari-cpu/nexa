/**
 * Scheduled report exports — list and create (PRD §5.3-Reports).
 *
 * Kept out of `reports.ts` because it is a different kind of surface: every
 * other `/reports/*` route is a synchronous read that answers "what happened in
 * this window", while these define background work that mails data out later.
 *
 * Both operations take `reports_manage` — the write scope this slice adds —
 * rather than the read-only `reports_read`. Creating a schedule is plainly a
 * mutation; listing takes the same scope because a definition carries the
 * mailboxes its reports go to, so the list answers "who receives our numbers",
 * which belongs to managing the schedules rather than to reading a report. Only
 * `ADMIN_SCOPES` carries it, so an ordinary agent token is refused at the guard
 * (FR-MOD-07.7 "permission-based visibility").
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { isAgent } from '../services/auth/principal.js';
import {
  ScheduledReportService,
  type ScheduledExportInput,
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
}
