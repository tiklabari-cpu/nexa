/**
 * The AI's behaviour rules (Guidance, tm 299.1 · SiyahTuş analysis AI-07):
 * `GET`/`POST /ai-guidance`, `PATCH`/`DELETE /ai-guidance/:ruleId` and the
 * conflict check `POST /ai-guidance/check`.
 *
 * Rules belong to a customer-facing agent — Copilot never talks to a player,
 * so it has none. Every write goes through `config-draft.ts` (ADR-14b §2.5)
 * and is refused, before anything is written, when the rule goes against a
 * locked platform rule (`guidance_violates_locked_rule`, AI-07 §5). The check
 * never refuses: it warns about contradictions, duplicates and vague wording
 * among the rules whose scope overlaps the draft's (AI-07 §4).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AiGuidanceRule, Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_GUIDANCE_PRIORITY,
  GUIDANCE_BODY_MAX,
  GUIDANCE_CATEGORIES,
  GUIDANCE_PRIORITY_MAX,
  GUIDANCE_PRIORITY_MIN,
  GUIDANCE_RULES_PER_AGENT_MAX,
  GUIDANCE_SCOPE_IDS_MAX,
  GUIDANCE_TITLE_MAX,
  readGuidanceScope,
  type GuidanceCategory,
  type GuidanceScope,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import type { Env } from '../config/env.js';
import type { MeteredLlm } from '../services/ai/metered-llm.js';
import {
  createGuidanceRuleDraft,
  deleteGuidanceRuleDraft,
  updateGuidanceRuleDraft,
} from '../services/ai/config-draft.js';
import { configAuthorOf } from '../lib/config-author.js';
import {
  checkGroups,
  GUIDANCE_CHECK_RESPONSE_NAME,
  GUIDANCE_CHECK_SCHEMA,
  guidanceCheckSystemPrompt,
  guidanceCheckUserContent,
  heuristicCheck,
  lockedRuleViolation,
  mergeCheckResults,
  readCheckReply,
  scopesOverlap,
  type CheckedRule,
  type GuidanceCheckResult,
  type GuidanceDraft,
} from '../services/ai/guidance-check.js';
import { orderGuidance } from '../services/ai/conversation/guidance.js';
import { LlmProviderError } from '../services/ai/provider/llm-error.js';
import { refuseOverlongPrompt } from '../services/ai/provider/llm-provider.js';
import { completeStructured } from '../services/ai/provider/structured-output.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();
const ids = z.array(uuid).min(1).max(GUIDANCE_SCOPE_IDS_MAX);

const scopeSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ skill_ids: ids }).strict(),
  z.object({ brand_ids: ids }).strict(),
]);

const title = z.string().trim().min(1).max(GUIDANCE_TITLE_MAX);
const body = z.string().trim().min(1).max(GUIDANCE_BODY_MAX);
const category = z.enum(GUIDANCE_CATEGORIES);
const priority = z.number().int().min(GUIDANCE_PRIORITY_MIN).max(GUIDANCE_PRIORITY_MAX);

const createBody = z
  .object({
    ai_agent_id: uuid,
    title,
    body,
    category,
    scope: scopeSchema.optional(),
    priority: priority.optional(),
    active: z.boolean().optional(),
    owner_id: uuid.nullable().optional(),
  })
  .strict();

const updateBody = z
  .object({
    title: title.optional(),
    body: body.optional(),
    category: category.optional(),
    scope: scopeSchema.optional(),
    priority: priority.optional(),
    active: z.boolean().optional(),
    owner_id: uuid.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

const checkBody = z
  .object({
    ai_agent_id: uuid,
    rule_id: uuid.optional(),
    title: z.string().max(GUIDANCE_TITLE_MAX).optional(),
    body,
    category: category.optional(),
    scope: scopeSchema.optional(),
  })
  .strict();

const listQuery = z.object({ ai_agent_id: uuid.optional() });

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

/** The rule's words against the locked platform rules (AI-07 §5) — a 400 on every write. */
function refuseLockedViolation(text: string): void {
  const violation = lockedRuleViolation(text);
  if (violation) {
    throw ApiError.validation(violation.explanation, {
      reason: 'guidance_violates_locked_rule',
      locked_rule: violation.locked_rule,
    });
  }
}

/** The customer-facing agent, under the caller's RLS; a validation error otherwise. */
async function requireCustomerFacingAgent(tx: TenantClient, id: string): Promise<void> {
  const agent = await tx.aiAgent.findFirst({
    where: { id, kind: 'ai_agent' },
    select: { id: true },
  });
  if (!agent) throw ApiError.validation('That AI agent does not exist.');
}

/**
 * A scope that names only what the workspace has: the agent's own skills, its
 * own brands. A foreign id would be invisible under RLS and read as "nowhere".
 */
async function requireScopeTargets(
  tx: TenantClient,
  aiAgentId: string,
  scope: GuidanceScope,
): Promise<void> {
  if ('skill_ids' in scope) {
    const found = await tx.skill.count({ where: { id: { in: scope.skill_ids }, aiAgentId } });
    if (found !== new Set(scope.skill_ids).size) {
      throw ApiError.validation('scope.skill_ids: every id must be a skill of this AI agent.');
    }
  } else if ('brand_ids' in scope) {
    const found = await tx.brand.count({ where: { id: { in: scope.brand_ids } } });
    if (found !== new Set(scope.brand_ids).size) {
      throw ApiError.validation('scope.brand_ids: every id must be a brand of this workspace.');
    }
  }
}

export function serialiseRule(rule: AiGuidanceRule) {
  return {
    id: rule.id,
    ai_agent_id: rule.aiAgentId,
    title: rule.title,
    body: rule.body,
    category: rule.category as GuidanceCategory,
    scope: readGuidanceScope(rule.scope) ?? rule.scope,
    priority: rule.priority,
    active: rule.active,
    owner_id: rule.ownerId,
    created_by: rule.createdBy,
    updated_by: rule.updatedBy,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

export default async function aiGuidanceRoutes(
  app: FastifyInstance,
  { env, llm }: { env: Env; llm: MeteredLlm },
): Promise<void> {
  app.get('/ai-guidance', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const rules = await request.withTenant((tx) =>
      tx.aiGuidanceRule.findMany({
        where: {
          aiAgent: { kind: 'ai_agent' },
          ...(query.ai_agent_id ? { aiAgentId: query.ai_agent_id } : {}),
        },
      }),
    );
    return reply.send({
      items: orderGuidance(
        rules.map((rule) => ({ ...rule, category: rule.category as GuidanceCategory })),
      ).map(serialiseRule),
    });
  });

  app.post('/ai-guidance', { config: { scopes: WRITE } }, async (request, reply) => {
    const input = parse(createBody, request.body);
    refuseLockedViolation(input.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const actor = principal.kind === 'agent' ? principal.accountId : null;
    const scope = input.scope ?? { all: true };

    const created = await request.withTenant(async (tx) => {
      await requireCustomerFacingAgent(tx, input.ai_agent_id);
      await requireScopeTargets(tx, input.ai_agent_id, scope);
      const held = await tx.aiGuidanceRule.count({ where: { aiAgentId: input.ai_agent_id } });
      if (held >= GUIDANCE_RULES_PER_AGENT_MAX) {
        throw ApiError.validation(
          `An AI agent holds at most ${GUIDANCE_RULES_PER_AGENT_MAX} behaviour rules.`,
          { reason: 'guidance_rules_limit', limit: GUIDANCE_RULES_PER_AGENT_MAX },
        );
      }
      return createGuidanceRuleDraft(tx, configAuthorOf(request), {
        licenseId: tenant.licenseId,
        aiAgentId: input.ai_agent_id,
        title: input.title,
        body: input.body,
        category: input.category,
        scope: scope as Prisma.InputJsonValue,
        priority: input.priority ?? DEFAULT_GUIDANCE_PRIORITY,
        active: input.active ?? true,
        ownerId: input.owner_id ?? null,
        createdBy: actor,
        updatedBy: actor,
      });
    });
    return reply.code(201).send(serialiseRule(created));
  });

  app.patch<{ Params: { ruleId: string } }>(
    '/ai-guidance/:ruleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.ruleId);
      const input = parse(updateBody, request.body);
      if (input.body !== undefined) refuseLockedViolation(input.body);
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.aiGuidanceRule.findFirst({
          where: { id },
          select: { id: true, aiAgentId: true },
        });
        if (!existing) throw ApiError.notFound('Behaviour rule not found.');
        if (input.scope) await requireScopeTargets(tx, existing.aiAgentId, input.scope);
        return updateGuidanceRuleDraft(tx, configAuthorOf(request), id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.scope !== undefined ? { scope: input.scope as Prisma.InputJsonValue } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.owner_id !== undefined ? { ownerId: input.owner_id } : {}),
          updatedBy: actor,
        });
      });
      return reply.send(serialiseRule(updated));
    },
  );

  app.delete<{ Params: { ruleId: string } }>(
    '/ai-guidance/:ruleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.ruleId);
      const deleted = await request.withTenant((tx) =>
        deleteGuidanceRuleDraft(tx, configAuthorOf(request), id),
      );
      if (deleted === 0) throw ApiError.notFound('Behaviour rule not found.');
      return reply.code(204).send();
    },
  );

  app.post(
    '/ai-guidance/check',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
      const input = parse(checkBody, request.body);
      const scope = input.scope ?? { all: true };
      const draft: GuidanceDraft = { body: input.body, category: input.category ?? 'other' };

      const overlapping = await request.withTenant(async (tx) => {
        await requireCustomerFacingAgent(tx, input.ai_agent_id);
        const rules = await tx.aiGuidanceRule.findMany({
          where: {
            aiAgentId: input.ai_agent_id,
            active: true,
            ...(input.rule_id ? { id: { not: input.rule_id } } : {}),
          },
          select: { id: true, body: true, category: true, scope: true, priority: true },
        });
        return orderGuidance(
          rules
            .map((rule) => ({
              ...rule,
              category: rule.category as GuidanceCategory,
              scope: readGuidanceScope(rule.scope),
            }))
            .filter(
              (rule): rule is typeof rule & { scope: GuidanceScope } =>
                rule.scope !== null && scopesOverlap(rule.scope, scope),
            ),
        );
      });

      const checked: CheckedRule[] = overlapping.map((rule) => ({
        id: rule.id,
        body: rule.body,
        category: rule.category,
      }));
      const { result, by } = await checkWithModel(request, draft, checked);
      return reply.send({
        locked: lockedRuleViolation(input.body),
        ...result,
        compared: checked.length,
        checked_by: by,
      });
    },
  );

  /**
   * The model's reading, a group of at most 20 rules per call; the word-overlap
   * reading with the `mock` provider, and in place of any group the model could
   * not answer — a timeout must not cost the author the check. The daily cap
   * is the 429 a preview gives.
   */
  async function checkWithModel(
    request: FastifyRequest,
    draft: GuidanceDraft,
    rules: readonly CheckedRule[],
  ): Promise<{ result: GuidanceCheckResult; by: 'model' | 'rules' }> {
    if (llm.id === 'mock') return { result: heuristicCheck(draft, rules), by: 'rules' };
    await request.requireAiBudget();
    const bound = llm.forTenant(request.tenant(), { surface: 'ai_agent' });
    const groups = rules.length > 0 ? checkGroups(rules) : [[]];
    const results: GuidanceCheckResult[] = [];
    let by: 'model' | 'rules' = 'model';
    for (const group of groups) {
      const prompt = {
        system: guidanceCheckSystemPrompt(),
        messages: [{ role: 'user' as const, content: guidanceCheckUserContent(draft, group) }],
      };
      try {
        refuseOverlongPrompt(prompt, env.LLM_MAX_PROMPT_CHARS);
        const { value } = await completeStructured<GuidanceCheckResult>(bound, {
          ...prompt,
          maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
          timeoutMs: env.LLM_TIMEOUT_MS,
          responseFormat: { name: GUIDANCE_CHECK_RESPONSE_NAME, schema: GUIDANCE_CHECK_SCHEMA },
        });
        results.push(readCheckReply(value, group));
      } catch (error) {
        if (!(error instanceof LlmProviderError)) throw error;
        request.log.warn(
          { kind: error.kind, reason: error.reason },
          'the model could not check the behaviour rule; the word-overlap reading was returned',
        );
        results.push(heuristicCheck(draft, group));
        by = 'rules';
      }
    }
    return { result: mergeCheckResults(results), by };
  }
}
