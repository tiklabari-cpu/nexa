/**
 * Rule bots — deterministic, LLM-free chatbots (FR-MOD-06.6).
 *
 * Managed under `/settings/bots`, alongside routing rules and ticket rules,
 * because a bot is workspace automation an admin configures once and the widget
 * then applies. It rides the bot scopes the AI playbook already declares — reads
 * take `agents-bot--all:ro`, writes `agents-bot--all:rw` — since configuring
 * what answers *every* visitor is an admin action and not something a
 * group-scoped agent does.
 *
 * Nothing on this surface reaches a model. That is the requirement, and it is
 * why these routes are here rather than as another section of `playbook.ts`: a
 * reader should not have to check whether the thing they are configuring will
 * call an LLM.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GROUP_PRIORITIES, RULE_BOT_MAX_GROUPS, RULE_BOT_MAX_REPLY } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import {
  RuleBotService,
  type RuleBotInput,
  type RuleBotPatch,
  type RuleBotRuleInput,
  type RuleBotRulePatch,
} from '../services/bots/rule-bot-service.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

// `.strict()` so a typo in a condition or action key is a 400, not a silently
// ignored rule that quietly matches nobody or does nothing — the ticket-rule
// editor's reasoning, and it matters more here: a rule that never fires is
// invisible until a customer is left waiting.
const conditionsSchema = z
  .object({
    message_equals: z.string().trim().max(2048).optional(),
    message_contains: z.string().trim().max(2048).optional(),
    message_word: z.string().trim().max(2048).optional(),
    page_url_contains: z.string().trim().max(2048).optional(),
    office_hours: z.enum(['open', 'closed']).optional(),
  })
  .strict();

const actionsSchema = z
  .object({
    send_message: z.string().trim().min(1).max(RULE_BOT_MAX_REPLY).optional(),
    add_tag: z.string().trim().min(1).max(64).optional(),
    transfer_to_group_id: z.number().int().nonnegative().optional(),
  })
  .strict();

const groupsSchema = z
  .array(
    z
      .object({
        group_id: z.number().int().nonnegative(),
        priority: z.enum(GROUP_PRIORITIES),
      })
      .strict(),
  )
  .max(RULE_BOT_MAX_GROUPS);

const createBotBody = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  groups: groupsSchema.optional(),
});

const updateBotBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    groups: groupsSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const createRuleBody = z.object({
  name: z.string().trim().min(1).max(120),
  conditions: conditionsSchema,
  actions: actionsSchema,
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const updateRuleBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    conditions: conditionsSchema.optional(),
    actions: actionsSchema.optional(),
    enabled: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const uuid = z.string().uuid();

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

export default async function botRoutes(app: FastifyInstance): Promise<void> {
  const bots = new RuleBotService();

  app.get('/settings/bots', { config: { scopes: READ } }, async (request, reply) => {
    const tenant = request.tenant();
    const result = await request.withTenant((tx) => bots.list(tx, tenant));
    return reply.send(result);
  });

  app.post('/settings/bots', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(createBotBody, request.body);
    const tenant = request.tenant();
    const input: RuleBotInput = {
      name: body.name,
      enabled: body.enabled,
      groups: body.groups,
    };
    const bot = await request.withTenant((tx) => bots.create(tx, tenant, input));
    return reply.status(201).send(bot);
  });

  app.patch<{ Params: { botId: string } }>(
    '/settings/bots/:botId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.botId);
      const body = parse(updateBotBody, request.body);
      const tenant = request.tenant();
      const patch: RuleBotPatch = {
        name: body.name,
        enabled: body.enabled,
        groups: body.groups,
      };
      const bot = await request.withTenant((tx) => bots.update(tx, tenant, id, patch));
      return reply.send(bot);
    },
  );

  app.delete<{ Params: { botId: string } }>(
    '/settings/bots/:botId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.botId);
      const tenant = request.tenant();
      await request.withTenant((tx) => bots.remove(tx, tenant, request.auditContext(), id));
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { botId: string } }>(
    '/settings/bots/:botId/rules',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const botId = parse(uuid, request.params.botId);
      const body = parse(createRuleBody, request.body);
      const tenant = request.tenant();
      const input: RuleBotRuleInput = {
        name: body.name,
        conditions: body.conditions,
        actions: body.actions,
        enabled: body.enabled,
        position: body.position,
      };
      const rule = await request.withTenant((tx) => bots.createRule(tx, tenant, botId, input));
      return reply.status(201).send(rule);
    },
  );

  app.patch<{ Params: { botId: string; ruleId: string } }>(
    '/settings/bots/:botId/rules/:ruleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const botId = parse(uuid, request.params.botId);
      const ruleId = parse(uuid, request.params.ruleId);
      const body = parse(updateRuleBody, request.body);
      const tenant = request.tenant();
      const patch: RuleBotRulePatch = {
        name: body.name,
        conditions: body.conditions,
        actions: body.actions,
        enabled: body.enabled,
        position: body.position,
      };
      const rule = await request.withTenant((tx) =>
        bots.updateRule(tx, tenant, botId, ruleId, patch),
      );
      return reply.send(rule);
    },
  );

  app.delete<{ Params: { botId: string; ruleId: string } }>(
    '/settings/bots/:botId/rules/:ruleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const botId = parse(uuid, request.params.botId);
      const ruleId = parse(uuid, request.params.ruleId);
      const tenant = request.tenant();
      await request.withTenant((tx) => bots.removeRule(tx, tenant, botId, ruleId));
      return reply.status(204).send();
    },
  );
}
