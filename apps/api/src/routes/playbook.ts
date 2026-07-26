/**
 * Playbook — AI agents, skills and knowledge.
 *
 * Two rules run through all of it. Steps are validated before they are stored,
 * because a step the engine cannot run would be skipped in silence at the
 * moment it mattered and an admin would have no way to know why nothing
 * happened. And a skill is never created active: an unfinished step list must
 * not start answering customers the instant it is saved.
 */
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { compileInstruction, validateSteps } from '@nexa/ai-mock';
import { ApiError } from '../lib/api-error.js';
import { assertPublicHttpUrl } from '../lib/ssrf.js';
import { KnowledgeService } from '../services/ai/knowledge-service.js';
import { crawl } from '../services/ai/web-crawler.js';
import { SkillEngine } from '../services/ai/skill-engine.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();

const createSkillBody = z.object({
  name: z.string().trim().min(1).max(120),
  ai_agent_id: uuid.optional(),
  instruction: z.string().max(10_000).optional(),
  steps: z.array(z.unknown()).optional(),
});

const updateSkillBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    instruction: z.string().max(10_000).optional(),
    steps: z.array(z.unknown()).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const compileBody = z.object({ instruction: z.string().min(1).max(10_000) });

const previewBody = z.object({
  steps: z.array(z.unknown()),
  message: z.string().trim().min(1).max(10_000),
  ai_agent_id: uuid.nullable().optional(),
});

const ANSWER_LENGTHS = ['short', 'medium', 'long'] as const;

/**
 * A website source is crawled from a URL; every other type indexes the text the
 * admin pasted. So exactly one of `source_url` (website) or `content` (the rest)
 * is required — enforced here rather than left for the handler to re-check.
 */
const createSourceBody = z
  .object({
    ai_agent_id: uuid,
    name: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(100_000).optional(),
    source_url: z.string().trim().min(1).max(2048).optional(),
    type: z.enum(['website', 'file', 'article', 'faq']).default('article'),
  })
  .superRefine((body, ctx) => {
    if (body.type === 'website') {
      if (!body.source_url) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source_url'], message: 'a website source needs a URL to crawl' });
      }
    } else if (!body.content) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'content is required' });
    }
  });

const updateAgentBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    tone: z.string().trim().max(40).nullable().optional(),
    avatar_url: z.string().trim().max(2048).nullable().optional(),
    languages: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
    answer_length: z.enum(ANSWER_LENGTHS).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

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

/** Rejects a step list the engine could not run, naming the offending step. */
function requireValidSteps(steps: unknown[]): unknown[] {
  const result = validateSteps(steps);
  if (!result.ok) {
    throw ApiError.validation(
      result.index >= 0 ? `Step ${result.index + 1}: ${result.reason}` : result.reason,
    );
  }
  return steps;
}

export default async function playbookRoutes(app: FastifyInstance): Promise<void> {
  const knowledge = new KnowledgeService();
  const engine = new SkillEngine(knowledge);

  // --- AI agents -------------------------------------------------------------

  app.get('/ai-agents', { config: { scopes: READ } }, async (request, reply) => {
    const agents = await request.withTenant((tx) =>
      tx.aiAgent.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { skills: true } } },
      }),
    );

    return reply.send({ items: agents.map(serialiseAgent) });
  });

  app.patch<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.aiAgentId);
      const body = parse(updateAgentBody, request.body);

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.aiAgent.findFirst({
          where: { id },
          select: { id: true, persona: true },
        });
        if (!existing) throw ApiError.notFound('AI agent not found.');

        // `answer_length` lives inside the persona JSON alongside anything else
        // an admin has set (a signature, say), so merge rather than overwrite —
        // clearing it removes just that key.
        let persona: Prisma.InputJsonValue | undefined;
        if (body.answer_length !== undefined) {
          const current =
            existing.persona && typeof existing.persona === 'object' && !Array.isArray(existing.persona)
              ? (existing.persona as Record<string, unknown>)
              : {};
          const next = { ...current };
          if (body.answer_length === null) delete next['answerLength'];
          else next['answerLength'] = body.answer_length;
          persona = next as Prisma.InputJsonValue;
        }

        return tx.aiAgent.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.tone !== undefined ? { tone: body.tone } : {}),
            ...(body.avatar_url !== undefined ? { avatarUrl: body.avatar_url } : {}),
            ...(body.languages !== undefined ? { languages: body.languages } : {}),
            ...(persona !== undefined ? { persona } : {}),
          },
          include: { _count: { select: { skills: true } } },
        });
      });

      return reply.send(serialiseAgent(updated));
    },
  );

  // --- Skills ----------------------------------------------------------------

  app.get('/skills', { config: { scopes: READ } }, async (request, reply) => {
    const skills = await request.withTenant((tx) =>
      // AI-agent skills only. Copilot owns a `kind: 'copilot'` skill purely to
      // anchor its assist runs (FR-MOD-12) — it is not something an admin wrote
      // and must not appear in the Playbook list beside the real ones.
      tx.skill.findMany({
        where: { kind: 'ai_agent' },
        orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      }),
    );
    return reply.send({ items: skills.map(serialiseSkill) });
  });

  app.post('/skills', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(createSkillBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    const steps = body.steps ? requireValidSteps(body.steps) : [];

    const created = await request.withTenant(async (tx) => {
      if (body.ai_agent_id) {
        const agent = await tx.aiAgent.findFirst({
          where: { id: body.ai_agent_id },
          select: { id: true },
        });
        if (!agent) throw ApiError.validation('That AI agent does not exist.');
      }

      return tx.skill.create({
        data: {
          licenseId: tenant.licenseId,
          name: body.name,
          kind: 'ai_agent',
          ...(body.ai_agent_id ? { aiAgentId: body.ai_agent_id } : {}),
          ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
          steps: steps as object,
          // Never live on creation.
          active: false,
          createdBy: principal.kind === 'agent' ? principal.accountId : null,
          updatedAt: new Date(),
        },
      });
    });

    return reply.status(201).send(serialiseSkill(created));
  });

  app.get<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const skill = await request.withTenant((tx) => tx.skill.findFirst({ where: { id } }));
      if (!skill) throw ApiError.notFound('Skill not found.');
      return reply.send(serialiseSkill(skill));
    },
  );

  app.patch<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const body = parse(updateSkillBody, request.body);
      const steps = body.steps ? requireValidSteps(body.steps) : undefined;

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.skill.findFirst({ where: { id } });
        if (!existing) throw ApiError.notFound('Skill not found.');

        // Turning on a skill with nothing to run would look enabled and do
        // nothing, which is the hardest kind of misconfiguration to notice.
        const finalSteps = steps ?? (existing.steps as unknown[]);
        if (body.active === true && (!Array.isArray(finalSteps) || finalSteps.length === 0)) {
          throw new ApiError('not_allowed', 'A skill needs at least one step before it can run.');
        }

        return tx.skill.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
            ...(steps !== undefined ? { steps: steps as object } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            updatedAt: new Date(),
          },
        });
      });

      return reply.send(serialiseSkill(updated));
    },
  );

  app.delete<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const deleted = await request.withTenant(async (tx) => {
        const { count } = await tx.skill.deleteMany({ where: { id } });
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Skill not found.');
      return reply.status(204).send();
    },
  );

  // --- Authoring -------------------------------------------------------------

  app.post('/skills/compile', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(compileBody, request.body);
    const { steps, unrecognised } = compileInstruction(body.instruction);
    return reply.send({ steps, unrecognised });
  });

  app.post('/skills/preview', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(previewBody, request.body);
    const tenant = request.tenant();

    // The real engine, no writes. A preview running different logic would be
    // worse than no preview.
    const result = await request.withTenant((tx) =>
      engine.preview(tx, tenant, {
        steps: body.steps,
        message: body.message,
        aiAgentId: body.ai_agent_id ?? null,
      }),
    );

    return reply.send({
      outcome: result.outcome,
      reply: result.reply,
      tags: result.tags,
      transfer_to: result.transferTo,
      summary: result.summary,
      log: result.log,
      errors: result.errors,
    });
  });

  app.get<{ Params: { skillId: string } }>(
    '/skills/:skillId/runs',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const limit = parse(
        z.coerce.number().int().min(1).max(100).default(25),
        (request.query as { limit?: unknown })?.limit ?? 25,
      );

      const { skill, runs } = await request.withTenant(async (tx) => ({
        skill: await tx.skill.findFirst({ where: { id }, select: { id: true } }),
        runs: await tx.skillRun.findMany({
          where: { skillId: id },
          orderBy: { ranAt: 'desc' },
          take: limit,
        }),
      }));
      if (!skill) throw ApiError.notFound('Skill not found.');

      return reply.send({
        items: runs.map((run) => {
          const log = run.log as { outcome?: string; entries?: unknown[] } | unknown[];
          // Runs recorded before the log gained an outcome are plain arrays.
          const isEnvelope = !Array.isArray(log);
          return {
            id: run.id,
            chat_id: run.chatId,
            status: run.status,
            outcome: isEnvelope ? ((log.outcome as string | undefined) ?? null) : null,
            ran_at: run.ranAt.toISOString(),
            log: isEnvelope ? (log.entries ?? []) : log,
          };
        }),
      });
    },
  );

  // --- Knowledge -------------------------------------------------------------

  app.get('/knowledge-sources', { config: { scopes: READ } }, async (request, reply) => {
    const sources = await request.withTenant((tx) =>
      tx.knowledgeSource.findMany({
        // The customer-facing AI agent's sources only. Copilot keeps its own base
        // (FR-MOD-12.2) on a `kind: 'copilot'` agent, reachable through
        // `/copilot/knowledge` — the two must never show each other's sources.
        where: { aiAgent: { kind: 'ai_agent' } },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { chunks: true } } },
      }),
    );

    return reply.send({
      items: sources.map((s) => ({
        id: s.id,
        ai_agent_id: s.aiAgentId,
        name: s.name,
        type: s.type,
        status: s.status,
        source_url: s.sourceUrl,
        chunk_count: s._count.chunks,
        updated_at: s.updatedAt.toISOString(),
      })),
    });
  });

  app.post('/knowledge-sources', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(createSourceBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    // A website is crawled *before* the transaction: the SSRF guard rejects a
    // private/internal target with a 400 (`source_url` never reaches a fetcher),
    // and the fetch+parse — even mocked — has no business holding a DB row open.
    let content = body.content ?? '';
    let sourceUrl: string | null = null;
    if (body.type === 'website') {
      const url = assertPublicHttpUrl(body.source_url ?? '');
      const page = await crawl(url);
      content = page.text;
      sourceUrl = url.toString();
    }

    const created = await request.withTenant(async (tx) => {
      const agent = await tx.aiAgent.findFirst({
        where: { id: body.ai_agent_id },
        select: { id: true },
      });
      if (!agent) throw ApiError.validation('That AI agent does not exist.');

      const source = await tx.knowledgeSource.create({
        data: {
          aiAgentId: body.ai_agent_id,
          licenseId: tenant.licenseId,
          type: body.type,
          name: body.name,
          content,
          sourceUrl,
          status: 'indexing',
          addedBy: principal.kind === 'agent' ? principal.accountId : null,
          updatedAt: new Date(),
        },
      });

      // Indexed in the same transaction: a source that exists but is not
      // searchable looks ready and answers nothing.
      const chunks = await knowledge.index(tx, tenant, source.id, content);

      return { source, chunks };
    });

    return reply.status(201).send({
      id: created.source.id,
      ai_agent_id: created.source.aiAgentId,
      name: created.source.name,
      type: created.source.type,
      status: created.chunks > 0 ? 'ready' : 'empty',
      source_url: created.source.sourceUrl,
      chunk_count: created.chunks,
      updated_at: created.source.updatedAt.toISOString(),
    });
  });

  app.delete<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const deleted = await request.withTenant(async (tx) => {
        // Chunks cascade with the source; leaving them would keep answering
        // from text the admin believes they deleted.
        const { count } = await tx.knowledgeSource.deleteMany({ where: { id } });
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Knowledge source not found.');
      return reply.status(204).send();
    },
  );
}

/** One shape for an AI agent, so a read and the reply after a PATCH never drift. */
function serialiseAgent(agent: {
  id: string;
  name: string;
  kind: string;
  tone: string | null;
  avatarUrl: string | null;
  languages: string[];
  persona: unknown;
  active: boolean;
  _count: { skills: number };
}) {
  const persona =
    agent.persona && typeof agent.persona === 'object' && !Array.isArray(agent.persona)
      ? (agent.persona as Record<string, unknown>)
      : {};
  const answerLength = persona['answerLength'];
  return {
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
    tone: agent.tone,
    avatar_url: agent.avatarUrl,
    languages: agent.languages,
    answer_length: typeof answerLength === 'string' ? answerLength : null,
    active: agent.active,
    skills_count: agent._count.skills,
  };
}

function serialiseSkill(skill: {
  id: string;
  aiAgentId: string | null;
  name: string;
  kind: string;
  instruction: string | null;
  steps: unknown;
  active: boolean;
  runsCount: number;
  updatedAt: Date;
}) {
  return {
    id: skill.id,
    ai_agent_id: skill.aiAgentId,
    name: skill.name,
    kind: skill.kind,
    instruction: skill.instruction,
    steps: Array.isArray(skill.steps) ? skill.steps : [],
    active: skill.active,
    runs_count: skill.runsCount,
    updated_at: skill.updatedAt.toISOString(),
  };
}
