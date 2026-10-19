/**
 * Compliance guardrails on the API (tm 301.2 · SiyahTuş analysis AI-08):
 *
 *   - `GET /ai-guardrails/platform` — the locked G1–G19 catalogue and its
 *     version, read-only. `PATCH`/`DELETE /ai-guardrails/platform/:ruleKey`
 *     exist to say so: 403 `not_allowed`, `guardrail_platform_locked`;
 *   - `GET`/`PUT /ai-guardrails/settings` — the agent's crisis text, complaint
 *     text, judge switch and the crisis text's approval;
 *   - `/ai-guardrails/rules` and `/ai-guardrails/phrases` — the workspace's
 *     stricter additions, CRUD;
 *   - `GET /ai-guardrails/hits` — the record of what the guardrails caught.
 *
 * Who: the Founder (owner) writes, an admin reads (AI-08: "Kurucu düzenler,
 * Yönetici görür"); the hit log is for the Team Lead too, a role tm 325
 * brings — until then it reads under the same scope as the rest. A write
 * never loosens the catalogue: a rule that would switch a locked rule off is
 * the lock's 403 (`guardrail-lock.ts`), and every write goes through
 * `config-draft.ts` (ADR-14b §2.5). Settings, rules and phrases belong to a
 * customer-facing agent — Copilot never talks to a player.
 */
import type { FastifyInstance } from 'fastify';
import type {
  AiForbiddenPhrase,
  AiGuardrailHit,
  AiGuardrailRule,
  AiGuardrailSettings,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import {
  FORBIDDEN_PHRASE_ACTIONS,
  FORBIDDEN_PHRASE_LANG,
  FORBIDDEN_PHRASE_MATCHES,
  FORBIDDEN_PHRASE_MAX,
  FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX,
  FORBIDDEN_PHRASES_PER_AGENT_MAX,
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_PLATFORM_LOCKED_REASON,
  GUARDRAIL_RULE_ACTIONS,
  GUARDRAIL_RULE_BODY_MAX,
  GUARDRAIL_RULE_TITLE_MAX,
  GUARDRAIL_RULES_PER_AGENT_MAX,
  GUARDRAIL_STAGES,
  GUARDRAIL_TEXT_MAX,
  GUIDANCE_SCOPE_IDS_MAX,
  PLATFORM_GUARDRAILS,
  PLATFORM_GUARDRAILS_VERSION,
  foldGuardrailText,
  forbiddenPhraseProblem,
  guardrailSetupProblem,
  isGuardrailId,
  readGuardrailHitRuleKey,
  readGuidanceScope,
  type ForbiddenPhraseMatch,
  type GuidanceScope,
  type PlatformGuardrail,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import {
  createForbiddenPhraseDraft,
  createGuardrailRuleDraft,
  deleteForbiddenPhraseDraft,
  deleteGuardrailRuleDraft,
  updateForbiddenPhraseDraft,
  updateGuardrailRuleDraft,
  upsertGuardrailSettingsDraft,
} from '../services/ai/config-draft.js';
import { guardrailRuleLoosening } from '../services/ai/guardrail-lock.js';
import type { Principal } from '../services/auth/principal.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

/**
 * The Founder writes (AI-08); `exactRole`, so a rank added above owner does
 * not widen it. A fresh object per route: Fastify keeps each route's config.
 */
function founderWrite(): { scopes: string[]; exactRole: 'owner'; principals: Array<'agent'> } {
  return { scopes: [...WRITE], exactRole: 'owner', principals: ['agent'] };
}

const HITS_DEFAULT_WINDOW_DAYS = 30;
const HITS_DEFAULT_LIMIT = 50;
const HITS_MAX_LIMIT = 100;

const uuid = z.string().uuid();
const ids = z.array(uuid).min(1).max(GUIDANCE_SCOPE_IDS_MAX);

const scopeSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ skill_ids: ids }).strict(),
  z.object({ brand_ids: ids }).strict(),
]);

const tenantText = z.string().trim().min(1).max(GUARDRAIL_TEXT_MAX);

const settingsQuery = z.object({ ai_agent_id: uuid });
const listQuery = z.object({ ai_agent_id: uuid.optional() });

const settingsBody = z
  .object({
    ai_agent_id: uuid,
    crisis_text: tenantText.nullable().optional(),
    complaint_text: tenantText.nullable().optional(),
    judge_enabled: z.boolean().optional(),
    approve_crisis_text: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, 'at least one setting is required');

const ruleTitle = z.string().trim().min(1).max(GUARDRAIL_RULE_TITLE_MAX);
const ruleBody = z.string().trim().min(1).max(GUARDRAIL_RULE_BODY_MAX);
const ruleCategory = z.enum(GUARDRAIL_CATEGORIES);
const ruleAction = z.enum(GUARDRAIL_RULE_ACTIONS);

const createRuleBody = z
  .object({
    ai_agent_id: uuid,
    title: ruleTitle,
    body: ruleBody,
    category: ruleCategory,
    action: ruleAction.optional(),
    scope: scopeSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const updateRuleBody = z
  .object({
    title: ruleTitle.optional(),
    body: ruleBody.optional(),
    category: ruleCategory.optional(),
    action: ruleAction.optional(),
    scope: scopeSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

// The length is the dialect's (`forbiddenPhraseProblem`), which knows the
// match; this is only the outer bound.
const phraseText = z.string().trim().min(1).max(FORBIDDEN_PHRASE_MAX);
const phraseMatch = z.enum(FORBIDDEN_PHRASE_MATCHES);
const phraseLang = z.string().regex(FORBIDDEN_PHRASE_LANG, 'two lower-case letters').nullable();
const phraseAction = z.enum(FORBIDDEN_PHRASE_ACTIONS);

const createPhraseBody = z
  .object({
    ai_agent_id: uuid,
    phrase: phraseText,
    match: phraseMatch.optional(),
    lang: phraseLang.optional(),
    scope: scopeSchema.optional(),
    action: phraseAction.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const updatePhraseBody = z
  .object({
    phrase: phraseText.optional(),
    match: phraseMatch.optional(),
    lang: phraseLang.optional(),
    scope: scopeSchema.optional(),
    action: phraseAction.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

const hitsQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  rule_key: z
    .string()
    .max(64)
    .refine((key) => readGuardrailHitRuleKey(key) !== null, 'G1–G19, rule:<id> or phrase:<id>')
    .optional(),
  stage: z.enum(GUARDRAIL_STAGES).optional(),
  chat_id: z.string().min(1).max(12).optional(),
  limit: z.coerce.number().int().min(1).optional(),
  page_id: z.string().max(512).optional(),
});

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

/** The lock's answer: the catalogue is the platform's, not the workspace's. */
function locked(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError('not_allowed', message, {
    details: { reason: GUARDRAIL_PLATFORM_LOCKED_REASON, ...details },
  });
}

/** A workspace rule that would switch a locked rule off — refused before anything is written. */
function refuseLoosening(text: string): void {
  const loosening = guardrailRuleLoosening(text);
  if (loosening) {
    throw locked(loosening.explanation, { locked_rule: loosening.locked_rule });
  }
}

function refuseBadPhrase(phrase: string, match: ForbiddenPhraseMatch): void {
  const problem = forbiddenPhraseProblem(phrase, match);
  if (problem) throw ApiError.validation(problem.message, { reason: problem.reason });
}

/** The customer-facing agent, under the caller's RLS; a validation error otherwise. */
async function requireCustomerFacingAgent(tx: TenantClient, id: string): Promise<void> {
  const agent = await tx.aiAgent.findFirst({
    where: { id, kind: 'ai_agent' },
    select: { id: true },
  });
  if (!agent) throw ApiError.validation('That AI agent does not exist.');
}

/** A scope that names only the agent's own skills and the workspace's own brands. */
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

/** The actor of a Founder-only write: always an agent (`principals: ['agent']`). */
function actorOf(principal: Principal): string | null {
  return principal.kind === 'agent' ? principal.accountId : null;
}

function serialisePlatformRule(rule: PlatformGuardrail) {
  return {
    id: rule.id,
    title: rule.title,
    prompt: rule.prompt,
    category: rule.category,
    action: rule.action,
    target: rule.target,
    priority: rule.priority,
    handoff_reason: rule.handoffReason,
    risk_flag: rule.riskFlag,
    understand_risks: rule.understandRisks,
    lexicon_alone: rule.lexiconAlone,
    applies_when: rule.appliesWhen,
    tenant_text: rule.tenantText,
    warnings_before_handoff: rule.warningsBeforeHandoff,
    stages: GUARDRAIL_STAGES.filter((stage) => (stage === 'input' ? rule.input : rule.output)),
    locked: true,
  };
}

function serialiseSettings(aiAgentId: string, row: AiGuardrailSettings | null) {
  return {
    ai_agent_id: aiAgentId,
    crisis_text: row?.crisisText ?? null,
    complaint_text: row?.complaintText ?? null,
    judge_enabled: row?.judgeEnabled ?? false,
    crisis_text_approved: Boolean(row?.approvedAt),
    approved_by: row?.approvedBy ?? null,
    approved_at: row?.approvedAt?.toISOString() ?? null,
    // The platform's suggested text for the workspace's country (AI-08-S1) is
    // the root panel's (tm 389.19); until it exists there is none to offer.
    crisis_text_draft: null,
    setup_problem: guardrailSetupProblem(
      row ? { crisisText: row.crisisText, approvedAt: row.approvedAt } : null,
    ),
    updated_by: row?.updatedBy ?? null,
    updated_at: row?.updatedAt.toISOString() ?? null,
  };
}

function serialiseRule(rule: AiGuardrailRule) {
  return {
    id: rule.id,
    ai_agent_id: rule.aiAgentId,
    title: rule.title,
    body: rule.body,
    category: rule.category,
    action: rule.action,
    scope: readGuidanceScope(rule.scope) ?? rule.scope,
    active: rule.active,
    created_by: rule.createdBy,
    updated_by: rule.updatedBy,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

function serialisePhrase(phrase: AiForbiddenPhrase) {
  return {
    id: phrase.id,
    ai_agent_id: phrase.aiAgentId,
    phrase: phrase.phrase,
    match: phrase.match,
    lang: phrase.lang,
    scope: readGuidanceScope(phrase.scope) ?? phrase.scope,
    action: phrase.action,
    active: phrase.active,
    created_by: phrase.createdBy,
    updated_by: phrase.updatedBy,
    created_at: phrase.createdAt.toISOString(),
    updated_at: phrase.updatedAt.toISOString(),
  };
}

function serialiseHit(hit: AiGuardrailHit) {
  return {
    id: hit.id,
    chat_id: hit.chatId,
    thread_id: hit.threadId,
    turn_id: hit.turnId,
    rule_key: hit.ruleKey,
    stage: hit.stage,
    action_taken: hit.actionTaken,
    evidence: hit.evidence,
    pattern_index: hit.patternIndex,
    catalog_version: hit.catalogVersion,
    created_at: hit.createdAt.toISOString(),
  };
}

/** The hit log's keyset: (created_at DESC, id DESC). */
interface HitCursor {
  createdAt: string;
  id: string;
}

function encodeHitCursor(cursor: HitCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** A cursor this route did not write is a 400, not a fresh start (audit log's export rule). */
function decodeHitCursor(pageId: string): HitCursor {
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as HitCursor;
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.createdAt === 'string' &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }
  throw ApiError.validation('page_id: not a cursor from a previous page.');
}

/** Same match and the same folded words: one phrase twice. */
async function refuseDuplicatePhrase(
  tx: TenantClient,
  aiAgentId: string,
  phrase: { phrase: string; match: ForbiddenPhraseMatch },
  exceptId?: string,
): Promise<void> {
  const siblings = await tx.aiForbiddenPhrase.findMany({
    where: { aiAgentId, match: phrase.match, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, phrase: true },
  });
  const key = (text: string) =>
    phrase.match === 'regex' ? text.trim() : foldGuardrailText(text.trim());
  const twin = siblings.find((sibling) => key(sibling.phrase) === key(phrase.phrase));
  if (twin) {
    throw ApiError.validation('This phrase is already on the list.', {
      reason: 'forbidden_phrase_exists',
      phrase_id: twin.id,
    });
  }
}

/** At most {@link FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX} patterns per agent. */
async function refuseRegexOverLimit(
  tx: TenantClient,
  aiAgentId: string,
  exceptId?: string,
): Promise<void> {
  const held = await tx.aiForbiddenPhrase.count({
    where: { aiAgentId, match: 'regex', ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (held >= FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX) {
    throw ApiError.validation(
      `An AI agent holds at most ${FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX} pattern phrases.`,
      { reason: 'forbidden_phrase_regex_limit', limit: FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX },
    );
  }
}

export default async function aiGuardrailRoutes(app: FastifyInstance): Promise<void> {
  // --- The platform catalogue: read-only -----------------------------------

  app.get('/ai-guardrails/platform', { config: { scopes: READ } }, async (_request, reply) => {
    return reply.send({
      version: PLATFORM_GUARDRAILS_VERSION,
      rules: PLATFORM_GUARDRAILS.map(serialisePlatformRule),
    });
  });

  // The catalogue is code, so there is nothing to write; these say so to a
  // client that tries, rather than a 404 that reads as "not here yet".
  for (const method of ['PATCH', 'DELETE'] as const) {
    app.route<{ Params: { ruleKey: string } }>({
      method,
      url: '/ai-guardrails/platform/:ruleKey',
      config: { scopes: READ },
      handler: async (request) => {
        const key = request.params.ruleKey.toUpperCase();
        if (!isGuardrailId(key)) throw ApiError.notFound('Platform guardrail not found.');
        throw locked(
          `${key} is a locked platform rule: it cannot be changed or switched off. A workspace may only add stricter rules (/ai-guardrails/rules).`,
          { locked_rule: key },
        );
      },
    });
  }

  // --- Settings ------------------------------------------------------------

  app.get('/ai-guardrails/settings', { config: { scopes: READ } }, async (request, reply) => {
    const { ai_agent_id: aiAgentId } = parse(settingsQuery, request.query);
    const row = await request.withTenant(async (tx) => {
      await requireCustomerFacingAgent(tx, aiAgentId);
      return tx.aiGuardrailSettings.findUnique({ where: { aiAgentId } });
    });
    return reply.send(serialiseSettings(aiAgentId, row));
  });

  app.put('/ai-guardrails/settings', { config: founderWrite() }, async (request, reply) => {
    const input = parse(settingsBody, request.body);
    const tenant = request.tenant();
    const actor = actorOf(request.requirePrincipal());

    const row = await request.withTenant(async (tx) => {
      await requireCustomerFacingAgent(tx, input.ai_agent_id);
      const stored = await tx.aiGuardrailSettings.findUnique({
        where: { aiAgentId: input.ai_agent_id },
        select: { crisisText: true },
      });
      const crisisText =
        input.crisis_text !== undefined ? input.crisis_text : (stored?.crisisText ?? null);
      // The approval is of the text as it stands: a new text is unapproved
      // until the same write, or a later one, approves it.
      const textChanged =
        input.crisis_text !== undefined && input.crisis_text !== (stored?.crisisText ?? null);
      let approval: { approvedBy: string | null; approvedAt: Date | null } | undefined;
      if (input.approve_crisis_text === true) {
        if (!crisisText) {
          throw ApiError.validation('There is no crisis text to approve.', {
            reason: 'guardrail_crisis_text_missing',
          });
        }
        approval = { approvedBy: actor, approvedAt: new Date() };
      } else if (input.approve_crisis_text === false || textChanged) {
        approval = { approvedBy: null, approvedAt: null };
      }

      const fields = {
        ...(input.crisis_text !== undefined ? { crisisText: input.crisis_text } : {}),
        ...(input.complaint_text !== undefined ? { complaintText: input.complaint_text } : {}),
        ...(input.judge_enabled !== undefined ? { judgeEnabled: input.judge_enabled } : {}),
        ...(approval ?? {}),
        updatedBy: actor,
      };
      // The insert half carries the text the approval is of: Postgres checks
      // the row an upsert would insert before it finds the conflict.
      return upsertGuardrailSettingsDraft(
        tx,
        { aiAgentId: input.ai_agent_id, licenseId: tenant.licenseId, ...fields, crisisText },
        fields,
      );
    });
    return reply.send(serialiseSettings(input.ai_agent_id, row));
  });

  // --- Workspace rules -----------------------------------------------------

  app.get('/ai-guardrails/rules', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const rules = await request.withTenant((tx) =>
      tx.aiGuardrailRule.findMany({
        where: {
          aiAgent: { kind: 'ai_agent' },
          ...(query.ai_agent_id ? { aiAgentId: query.ai_agent_id } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return reply.send({ items: rules.map(serialiseRule) });
  });

  app.post('/ai-guardrails/rules', { config: founderWrite() }, async (request, reply) => {
    const input = parse(createRuleBody, request.body);
    refuseLoosening(input.body);
    const tenant = request.tenant();
    const actor = actorOf(request.requirePrincipal());
    const scope = input.scope ?? { all: true };

    const created = await request.withTenant(async (tx) => {
      await requireCustomerFacingAgent(tx, input.ai_agent_id);
      await requireScopeTargets(tx, input.ai_agent_id, scope);
      const held = await tx.aiGuardrailRule.count({ where: { aiAgentId: input.ai_agent_id } });
      if (held >= GUARDRAIL_RULES_PER_AGENT_MAX) {
        throw ApiError.validation(
          `An AI agent holds at most ${GUARDRAIL_RULES_PER_AGENT_MAX} compliance rules.`,
          { reason: 'guardrail_rules_limit', limit: GUARDRAIL_RULES_PER_AGENT_MAX },
        );
      }
      return createGuardrailRuleDraft(tx, {
        licenseId: tenant.licenseId,
        aiAgentId: input.ai_agent_id,
        title: input.title,
        body: input.body,
        category: input.category,
        action: input.action ?? 'prompt_only',
        scope: scope as Prisma.InputJsonValue,
        active: input.active ?? true,
        createdBy: actor,
        updatedBy: actor,
      });
    });
    return reply.code(201).send(serialiseRule(created));
  });

  /** A platform rule's key where a workspace rule's id goes: the lock, not a 400. */
  function refusePlatformKey(ruleId: string): void {
    const key = ruleId.toUpperCase();
    if (isGuardrailId(key)) {
      throw locked(
        `${key} is a locked platform rule: it cannot be changed or switched off. A workspace may only add stricter rules.`,
        { locked_rule: key },
      );
    }
  }

  app.patch<{ Params: { ruleId: string } }>(
    '/ai-guardrails/rules/:ruleId',
    { config: founderWrite() },
    async (request, reply) => {
      refusePlatformKey(request.params.ruleId);
      const id = parse(uuid, request.params.ruleId);
      const input = parse(updateRuleBody, request.body);
      if (input.body !== undefined) refuseLoosening(input.body);
      const actor = actorOf(request.requirePrincipal());

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.aiGuardrailRule.findFirst({
          where: { id },
          select: { id: true, aiAgentId: true },
        });
        if (!existing) throw ApiError.notFound('Compliance rule not found.');
        if (input.scope) await requireScopeTargets(tx, existing.aiAgentId, input.scope);
        return updateGuardrailRuleDraft(tx, id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.action !== undefined ? { action: input.action } : {}),
          ...(input.scope !== undefined ? { scope: input.scope as Prisma.InputJsonValue } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedBy: actor,
        });
      });
      return reply.send(serialiseRule(updated));
    },
  );

  app.delete<{ Params: { ruleId: string } }>(
    '/ai-guardrails/rules/:ruleId',
    { config: founderWrite() },
    async (request, reply) => {
      refusePlatformKey(request.params.ruleId);
      const id = parse(uuid, request.params.ruleId);
      const deleted = await request.withTenant((tx) => deleteGuardrailRuleDraft(tx, id));
      if (deleted === 0) throw ApiError.notFound('Compliance rule not found.');
      return reply.code(204).send();
    },
  );

  // --- Forbidden phrases ---------------------------------------------------

  app.get('/ai-guardrails/phrases', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const phrases = await request.withTenant((tx) =>
      tx.aiForbiddenPhrase.findMany({
        where: {
          aiAgent: { kind: 'ai_agent' },
          ...(query.ai_agent_id ? { aiAgentId: query.ai_agent_id } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return reply.send({ items: phrases.map(serialisePhrase) });
  });

  app.post('/ai-guardrails/phrases', { config: founderWrite() }, async (request, reply) => {
    const input = parse(createPhraseBody, request.body);
    const match = input.match ?? 'word';
    refuseBadPhrase(input.phrase, match);
    const tenant = request.tenant();
    const actor = actorOf(request.requirePrincipal());
    const scope = input.scope ?? { all: true };

    const created = await request.withTenant(async (tx) => {
      await requireCustomerFacingAgent(tx, input.ai_agent_id);
      await requireScopeTargets(tx, input.ai_agent_id, scope);
      const held = await tx.aiForbiddenPhrase.count({ where: { aiAgentId: input.ai_agent_id } });
      if (held >= FORBIDDEN_PHRASES_PER_AGENT_MAX) {
        throw ApiError.validation(
          `An AI agent holds at most ${FORBIDDEN_PHRASES_PER_AGENT_MAX} forbidden phrases.`,
          { reason: 'forbidden_phrases_limit', limit: FORBIDDEN_PHRASES_PER_AGENT_MAX },
        );
      }
      if (match === 'regex') await refuseRegexOverLimit(tx, input.ai_agent_id);
      await refuseDuplicatePhrase(tx, input.ai_agent_id, { phrase: input.phrase, match });
      return createForbiddenPhraseDraft(tx, {
        licenseId: tenant.licenseId,
        aiAgentId: input.ai_agent_id,
        phrase: input.phrase,
        match,
        lang: input.lang ?? null,
        scope: scope as Prisma.InputJsonValue,
        action: input.action ?? 'block',
        active: input.active ?? true,
        createdBy: actor,
        updatedBy: actor,
      });
    });
    return reply.code(201).send(serialisePhrase(created));
  });

  app.patch<{ Params: { phraseId: string } }>(
    '/ai-guardrails/phrases/:phraseId',
    { config: founderWrite() },
    async (request, reply) => {
      const id = parse(uuid, request.params.phraseId);
      const input = parse(updatePhraseBody, request.body);
      const actor = actorOf(request.requirePrincipal());

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.aiForbiddenPhrase.findFirst({
          where: { id },
          select: { id: true, aiAgentId: true, phrase: true, match: true },
        });
        if (!existing) throw ApiError.notFound('Forbidden phrase not found.');
        // The phrase and its match are one thing: a new match re-reads the
        // stored words, a new phrase is read under the stored match.
        const phrase = input.phrase ?? existing.phrase;
        const match = input.match ?? (existing.match as ForbiddenPhraseMatch);
        if (input.phrase !== undefined || input.match !== undefined) {
          refuseBadPhrase(phrase, match);
          if (match === 'regex' && existing.match !== 'regex') {
            await refuseRegexOverLimit(tx, existing.aiAgentId, id);
          }
          await refuseDuplicatePhrase(tx, existing.aiAgentId, { phrase, match }, id);
        }
        if (input.scope) await requireScopeTargets(tx, existing.aiAgentId, input.scope);
        return updateForbiddenPhraseDraft(tx, id, {
          ...(input.phrase !== undefined ? { phrase: input.phrase } : {}),
          ...(input.match !== undefined ? { match: input.match } : {}),
          ...(input.lang !== undefined ? { lang: input.lang } : {}),
          ...(input.scope !== undefined ? { scope: input.scope as Prisma.InputJsonValue } : {}),
          ...(input.action !== undefined ? { action: input.action } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedBy: actor,
        });
      });
      return reply.send(serialisePhrase(updated));
    },
  );

  app.delete<{ Params: { phraseId: string } }>(
    '/ai-guardrails/phrases/:phraseId',
    { config: founderWrite() },
    async (request, reply) => {
      const id = parse(uuid, request.params.phraseId);
      const deleted = await request.withTenant((tx) => deleteForbiddenPhraseDraft(tx, id));
      if (deleted === 0) throw ApiError.notFound('Forbidden phrase not found.');
      return reply.code(204).send();
    },
  );

  // --- The hit log ---------------------------------------------------------

  app.get('/ai-guardrails/hits', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(hitsQuery, request.query);
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
      throw ApiError.validation('`from` must be before `to`.');
    }
    const limit = Math.min(query.limit ?? HITS_DEFAULT_LIMIT, HITS_MAX_LIMIT);
    const cursor = query.page_id ? decodeHitCursor(query.page_id) : null;

    // One conversation's hits are its whole record; the log otherwise opens
    // on the last 30 days unless the caller names a start.
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    else if (!query.chat_id) {
      createdAt.gte = new Date(Date.now() - HITS_DEFAULT_WINDOW_DAYS * 86_400_000);
    }
    if (query.to) createdAt.lte = new Date(query.to);

    const filters: Prisma.AiGuardrailHitWhereInput[] = [{ createdAt }];
    if (query.rule_key) filters.push({ ruleKey: query.rule_key });
    if (query.stage) filters.push({ stage: query.stage });
    if (query.chat_id) filters.push({ chatId: query.chat_id });
    if (cursor) {
      const at = new Date(cursor.createdAt);
      filters.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }] });
    }

    const rows = await request.withTenant((tx) =>
      tx.aiGuardrailHit.findMany({
        where: { AND: filters },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return reply.send({
      items: page.map(serialiseHit),
      ...(rows.length > limit && last
        ? {
            next_page_id: encodeHitCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          }
        : {}),
    });
  });
}
