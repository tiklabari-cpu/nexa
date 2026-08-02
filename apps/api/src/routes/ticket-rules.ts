/**
 * Ticket rules — condition + action automation over tickets (FR-MOD-08.6.2).
 *
 * Managed under `/settings/ticket-rules`, alongside routing rules and the tag
 * library, because a rule is workspace automation an admin configures once and
 * the inbox then applies. It rides the tenant-wide ticket scopes: reads take
 * `tickets--all:ro`, writes `tickets--all:rw` — configuring how *every* ticket
 * is triaged is an admin action, not something a group-scoped agent does.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import {
  TicketRuleService,
  type TicketRuleInput,
  type TicketRulePatch,
} from '../services/tickets/ticket-rule-service.js';

// `.strict()` so a typo in a condition or action key is a 400, not a silently
// ignored rule that quietly matches nobody or does nothing.
const conditionsSchema = z
  .object({
    subject_contains: z.string().trim().max(2048).optional(),
    source: z.enum(['chat', 'email']).optional(),
  })
  .strict();

const actionsSchema = z
  .object({
    assign_agent_id: z.string().uuid().optional(),
    assign_group_id: z.number().int().nonnegative().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    add_tag: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  conditions: conditionsSchema,
  actions: actionsSchema,
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    conditions: conditionsSchema.optional(),
    actions: actionsSchema.optional(),
    enabled: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const ruleIdSchema = z.string().uuid();

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

export default async function ticketRuleRoutes(app: FastifyInstance): Promise<void> {
  const rules = new TicketRuleService();

  app.get(
    '/settings/ticket-rules',
    { config: { scopes: ['tickets--all:ro', 'tickets--all:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const result = await request.withTenant((tx) => rules.list(tx, tenant));
      return reply.send(result);
    },
  );

  app.post(
    '/settings/ticket-rules',
    { config: { scopes: ['tickets--all:rw'] } },
    async (request, reply) => {
      const body = parse(createBody, request.body);
      const tenant = request.tenant();
      const input: TicketRuleInput = {
        name: body.name,
        conditions: body.conditions,
        actions: body.actions,
        enabled: body.enabled,
        position: body.position,
      };
      const rule = await request.withTenant((tx) => rules.create(tx, tenant, input));
      return reply.status(201).send(rule);
    },
  );

  app.patch<{ Params: { ruleId: string } }>(
    '/settings/ticket-rules/:ruleId',
    { config: { scopes: ['tickets--all:rw'] } },
    async (request, reply) => {
      const id = parse(ruleIdSchema, request.params.ruleId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      const patch: TicketRulePatch = {
        name: body.name,
        conditions: body.conditions,
        actions: body.actions,
        enabled: body.enabled,
        position: body.position,
      };
      const rule = await request.withTenant((tx) => rules.update(tx, tenant, id, patch));
      return reply.send(rule);
    },
  );

  app.delete<{ Params: { ruleId: string } }>(
    '/settings/ticket-rules/:ruleId',
    { config: { scopes: ['tickets--all:rw'] } },
    async (request, reply) => {
      const id = parse(ruleIdSchema, request.params.ruleId);
      const tenant = request.tenant();
      await request.withTenant((tx) => rules.remove(tx, tenant, request.auditContext(), id));
      return reply.status(204).send();
    },
  );
}
