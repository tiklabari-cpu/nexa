/**
 * The workspace's hand-over rules (tm 303.3 · SiyahTuş analysis AI-09; owner
 * decision K9): `GET`/`POST /ai-agents/:aiAgentId/handoff-rules`,
 * `PUT …/handoff-rules/order` and `PATCH`/`DELETE …/handoff-rules/:ruleId`.
 *
 * Rules belong to a customer-facing agent — Copilot never talks to a player,
 * so it has none (404). Every write goes through `config-draft.ts` (ADR-14b
 * §2.5). The platform's locked rules (G1–G5, G13, G15) are listed but are the
 * guardrail catalogue's: naming one in a write is 400 `handoff_trigger_locked`,
 * the code a locked trigger gets on the settings (tm 303.1).
 */
import type { FastifyInstance } from 'fastify';
import type { AiHandoffRule } from '@prisma/client';
import { z } from 'zod';
import {
  HANDOFF_RULE_EXAMPLES,
  HANDOFF_RULE_PHRASE_MAX,
  HANDOFF_RULE_TITLE_MAX,
  HANDOFF_RULE_TOPICS,
  HANDOFF_RULES_PER_AGENT_MAX,
  HANDOFF_TRIGGER_LOCKED_REASON,
  GUARDRAIL_PRIORITIES,
  LOCKED_HANDOFF_RULES,
  RISK_FLAG_TYPES,
  isLockedHandoffRuleId,
  readHandoffRuleTarget,
  readHandoffRuleTrigger,
  type HandoffRuleTarget,
  type HandoffRuleTrigger,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import {
  createHandoffRuleDraft,
  deleteHandoffRuleDraft,
  reorderHandoffRulesDraft,
  updateHandoffRuleDraft,
} from '../services/ai/config-draft.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('topic'), value: z.enum(HANDOFF_RULE_TOPICS) }).strict(),
  z.object({ type: z.literal('procedure'), value: uuid }).strict(),
  z
    .object({
      type: z.literal('phrase'),
      value: z.string().trim().min(1).max(HANDOFF_RULE_PHRASE_MAX),
    })
    .strict(),
  z.object({ type: z.literal('risk_flag'), value: z.enum(RISK_FLAG_TYPES) }).strict(),
  z.object({ type: z.literal('ai_unresolved'), value: z.null() }).strict(),
  z.object({ type: z.literal('player_request'), value: z.null() }).strict(),
]);

const targetSchema = z
  .union([
    z.object({ group_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
    z.object({ topic: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) }).strict(),
  ])
  .nullable();

const title = z.string().trim().min(1).max(HANDOFF_RULE_TITLE_MAX);
const priority = z.enum(GUARDRAIL_PRIORITIES);

const createBody = z
  .object({
    title,
    trigger: triggerSchema,
    target: targetSchema.optional(),
    priority: priority.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const updateBody = z
  .object({
    title: title.optional(),
    trigger: triggerSchema.optional(),
    target: targetSchema.optional(),
    priority: priority.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

const orderBody = z
  .object({ rule_ids: z.array(z.string()).max(HANDOFF_RULES_PER_AGENT_MAX) })
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

/** A locked rule named in a write (AI-09 KK: "Kilitli tetikleyiciler API'den kapatılamaz"). */
function refuseLockedRule(id: string): void {
  if (!isLockedHandoffRuleId(id)) return;
  throw ApiError.validation(`${id} is a locked platform rule and cannot be changed.`, {
    reason: HANDOFF_TRIGGER_LOCKED_REASON,
    rule: id,
  });
}

/** The customer-facing agent, under the caller's RLS; 404 for Copilot or another workspace's. */
async function customerFacingAgent(tx: TenantClient, id: string): Promise<void> {
  const agent = await tx.aiAgent.findFirst({
    where: { id, kind: 'ai_agent' },
    select: { id: true },
  });
  if (!agent) throw ApiError.notFound('AI agent not found.');
}

/**
 * What a rule names is the workspace's own: a procedure skill of this agent,
 * a team of this workspace. A foreign id would be invisible under RLS and
 * the rule would never fire, or hand over to nobody.
 */
async function requireNamed(
  tx: TenantClient,
  aiAgentId: string,
  trigger: HandoffRuleTrigger | undefined,
  target: HandoffRuleTarget | null | undefined,
): Promise<void> {
  if (trigger?.type === 'procedure') {
    const skill = await tx.skill.findFirst({
      where: { id: trigger.value, aiAgentId, mode: 'procedure' },
      select: { id: true },
    });
    if (!skill) {
      throw ApiError.validation('trigger.value: not a procedure of this AI agent.', {
        reason: 'handoff_rule_unknown_procedure',
      });
    }
  }
  if (target && 'group_id' in target) {
    const group = await tx.group.findFirst({
      where: { id: BigInt(target.group_id) },
      select: { id: true },
    });
    if (!group) {
      throw ApiError.validation('target.group_id: not a team of this workspace.', {
        reason: 'handoff_rule_unknown_team',
      });
    }
  }
}

/** The target as its two columns. */
function targetColumns(target: HandoffRuleTarget | null) {
  return {
    targetGroupId: target && 'group_id' in target ? BigInt(target.group_id) : null,
    targetTopic: target && 'topic' in target ? target.topic : null,
  };
}

const ORDER = [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

async function agentRules(tx: TenantClient, aiAgentId: string): Promise<AiHandoffRule[]> {
  return tx.aiHandoffRule.findMany({ where: { aiAgentId }, orderBy: [...ORDER] });
}

function serialiseRule(rule: AiHandoffRule) {
  return {
    id: rule.id,
    ai_agent_id: rule.aiAgentId,
    position: rule.position,
    active: rule.active,
    title: rule.title,
    trigger: readHandoffRuleTrigger(rule.triggerType, rule.triggerValue) ?? {
      type: rule.triggerType,
      value: rule.triggerValue,
    },
    target: readHandoffRuleTarget(rule.targetGroupId, rule.targetTopic),
    priority: rule.priority,
    created_by: rule.createdBy,
    updated_by: rule.updatedBy,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

function serialiseList(aiAgentId: string, rules: readonly AiHandoffRule[]) {
  return {
    ai_agent_id: aiAgentId,
    locked: LOCKED_HANDOFF_RULES,
    items: rules.map(serialiseRule),
    examples: HANDOFF_RULE_EXAMPLES,
  };
}

export default async function aiHandoffRulesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId/handoff-rules',
    { config: { scopes: READ } },
    async (request, reply) => {
      const aiAgentId = parse(uuid, request.params.aiAgentId);
      const rules = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, aiAgentId);
        return agentRules(tx, aiAgentId);
      });
      return reply.send(serialiseList(aiAgentId, rules));
    },
  );

  app.post<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId/handoff-rules',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const aiAgentId = parse(uuid, request.params.aiAgentId);
      const input = parse(createBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;
      const target = input.target ?? null;

      const created = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, aiAgentId);
        await requireNamed(tx, aiAgentId, input.trigger, target);
        const held = await tx.aiHandoffRule.aggregate({
          where: { aiAgentId },
          _count: { _all: true },
          _max: { position: true },
        });
        if (held._count._all >= HANDOFF_RULES_PER_AGENT_MAX) {
          throw ApiError.validation(
            `An AI agent holds at most ${HANDOFF_RULES_PER_AGENT_MAX} hand-over rules.`,
            { reason: 'handoff_rules_limit', limit: HANDOFF_RULES_PER_AGENT_MAX },
          );
        }
        return createHandoffRuleDraft(tx, {
          licenseId: tenant.licenseId,
          aiAgentId,
          position: (held._max.position ?? 0) + 1,
          active: input.active ?? true,
          title: input.title,
          triggerType: input.trigger.type,
          triggerValue: input.trigger.value,
          ...targetColumns(target),
          priority: input.priority ?? 'normal',
          createdBy: actor,
          updatedBy: actor,
        });
      });
      return reply.code(201).send(serialiseRule(created));
    },
  );

  app.put<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId/handoff-rules/order',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const aiAgentId = parse(uuid, request.params.aiAgentId);
      const input = parse(orderBody, request.body);
      for (const id of input.rule_ids) refuseLockedRule(id);
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;

      const rules = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, aiAgentId);
        const held = await agentRules(tx, aiAgentId);
        const given = new Set(input.rule_ids);
        if (
          given.size !== input.rule_ids.length ||
          given.size !== held.length ||
          held.some((rule) => !given.has(rule.id))
        ) {
          throw ApiError.validation('rule_ids: every rule of this AI agent, each once.', {
            reason: 'handoff_rules_order_mismatch',
          });
        }
        await reorderHandoffRulesDraft(tx, input.rule_ids, actor);
        return agentRules(tx, aiAgentId);
      });
      return reply.send(serialiseList(aiAgentId, rules));
    },
  );

  app.patch<{ Params: { aiAgentId: string; ruleId: string } }>(
    '/ai-agents/:aiAgentId/handoff-rules/:ruleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const aiAgentId = parse(uuid, request.params.aiAgentId);
      refuseLockedRule(request.params.ruleId);
      const id = parse(uuid, request.params.ruleId);
      const input = parse(updateBody, request.body);
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;

      const updated = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, aiAgentId);
        const existing = await tx.aiHandoffRule.findFirst({
          where: { id, aiAgentId },
          select: { id: true },
        });
        if (!existing) throw ApiError.notFound('Hand-over rule not found.');
        await requireNamed(tx, aiAgentId, input.trigger, input.target);
        return updateHandoffRuleDraft(tx, id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.trigger !== undefined
            ? { triggerType: input.trigger.type, triggerValue: input.trigger.value }
            : {}),
          ...(input.target !== undefined ? targetColumns(input.target) : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedBy: actor,
        });
      });
      return reply.send(serialiseRule(updated));
    },
  );

  app.delete<{ Params: { aiAgentId: string; ruleId: string } }>(
    '/ai-agents/:aiAgentId/handoff-rules/:ruleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const aiAgentId = parse(uuid, request.params.aiAgentId);
      refuseLockedRule(request.params.ruleId);
      const id = parse(uuid, request.params.ruleId);
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;

      await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, aiAgentId);
        const existing = await tx.aiHandoffRule.findFirst({
          where: { id, aiAgentId },
          select: { id: true },
        });
        if (!existing || (await deleteHandoffRuleDraft(tx, id)) === 0) {
          throw ApiError.notFound('Hand-over rule not found.');
        }
        // The rules after it move up: positions stay 1…n.
        const rest = await agentRules(tx, aiAgentId);
        if (rest.some((rule, index) => rule.position !== index + 1)) {
          await reorderHandoffRulesDraft(
            tx,
            rest.map((rule) => rule.id),
            actor,
          );
        }
      });
      return reply.code(204).send();
    },
  );
}
