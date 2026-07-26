/**
 * Ticket e-mail templates — branded, variabled ticket mail (FR-MOD-08.7.5).
 *
 * Managed under `/settings/ticket-email-templates`, alongside ticket rules and
 * the tag library, because a template is workspace configuration an admin
 * authors once and the inbox then draws on. It rides the tenant-wide ticket
 * scopes: reads take `tickets--all:ro`, writes `tickets--all:rw` — deciding the
 * mail every ticket can send is an admin action, not a group-scoped agent's.
 *
 * The route only shapes and forwards the request; the placeholder-validity
 * judgement (KK "Geçersiz değişken/format engeli") lives in the service, over
 * the shared `@nexa/types` catalogue, so the check cannot drift from the one the
 * authoring form runs.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import {
  TicketEmailTemplateService,
  type TicketEmailTemplateInput,
  type TicketEmailTemplatePatch,
} from '../services/tickets/ticket-email-template-service.js';

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  enabled: z.boolean().optional(),
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    subject: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(10000).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const templateIdSchema = z.string().uuid();

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

export default async function ticketEmailTemplateRoutes(app: FastifyInstance): Promise<void> {
  const templates = new TicketEmailTemplateService();

  app.get(
    '/settings/ticket-email-templates',
    { config: { scopes: ['tickets--all:ro', 'tickets--all:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const result = await request.withTenant((tx) => templates.list(tx, tenant));
      return reply.send(result);
    },
  );

  app.post(
    '/settings/ticket-email-templates',
    { config: { scopes: ['tickets--all:rw'] } },
    async (request, reply) => {
      const body = parse(createBody, request.body);
      const tenant = request.tenant();
      const input: TicketEmailTemplateInput = {
        name: body.name,
        subject: body.subject,
        body: body.body,
        enabled: body.enabled,
      };
      const template = await request.withTenant((tx) => templates.create(tx, tenant, input));
      return reply.status(201).send(template);
    },
  );

  app.patch<{ Params: { templateId: string } }>(
    '/settings/ticket-email-templates/:templateId',
    { config: { scopes: ['tickets--all:rw'] } },
    async (request, reply) => {
      const id = parse(templateIdSchema, request.params.templateId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      const patch: TicketEmailTemplatePatch = {
        name: body.name,
        subject: body.subject,
        body: body.body,
        enabled: body.enabled,
      };
      const template = await request.withTenant((tx) => templates.update(tx, tenant, id, patch));
      return reply.send(template);
    },
  );

  app.delete<{ Params: { templateId: string } }>(
    '/settings/ticket-email-templates/:templateId',
    { config: { scopes: ['tickets--all:rw'] } },
    async (request, reply) => {
      const id = parse(templateIdSchema, request.params.templateId);
      const tenant = request.tenant();
      await request.withTenant((tx) => templates.remove(tx, tenant, id));
      return reply.status(204).send();
    },
  );
}
