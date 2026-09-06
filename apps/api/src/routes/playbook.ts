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
import { isCsvParseError, parseCsv, type CsvLimits } from '../lib/csv-import.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { KnowledgeService } from '../services/ai/knowledge-service.js';
import {
  isKnowledgeBulkHeaderError,
  mapKnowledgeBulkRow,
  resolveKnowledgeBulkColumns,
  type KnowledgeBulkColumnIndex,
} from '../services/ai/knowledge-bulk-row.js';
import {
  isKnowledgeFileParseError,
  parseKnowledgeFile,
  titleFromFilename,
} from '../services/ai/knowledge-file-parse.js';
import {
  BulkWebsiteCrawler,
  checkWebsiteUrl,
  type BulkCrawlLimits,
  type BulkCrawlRefusal,
} from '../services/ai/knowledge-bulk-crawl.js';
import { crawl } from '../services/ai/web-crawler.js';
import { computeNextRefreshAt, fetchRefreshedText } from '../services/ai/knowledge-refresh.js';
import { SkillEngine } from '../services/ai/skill-engine.js';
import type { TenantClient } from '../lib/tenant.js';

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
 * A website source is crawled from a URL; an `article` or a `faq` indexes the
 * text the admin pasted. So exactly one of `source_url` (website) or `content`
 * (the rest) is required — enforced here rather than left for the handler to
 * re-check.
 *
 * `file` is the type this endpoint refuses. It used to be accepted with pasted
 * `content` like any other, which made "File" a label rather than a fact: an
 * admin could type into a box and have the source appear in the Files tab. A
 * file source now comes from `POST /knowledge-sources/file`, where there are
 * bytes to check, a type allow-list to check them against and a budget to
 * measure them by — none of which a pasted string has. Refusing it here is the
 * other half of that: one way in, not two, so the tab means what it says.
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
    if (body.type === 'file') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'a file source must be uploaded through POST /knowledge-sources/file',
      });
    } else if (body.type === 'website') {
      if (!body.source_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source_url'],
          message: 'a website source needs a URL to crawl',
        });
      }
    } else if (!body.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is required',
      });
    }
  });

/**
 * The upload body (FR-MOD-06.3.2, "File").
 *
 * **Base64 in a JSON body, not multipart.** The repo already made this call
 * once, for `/knowledge-sources/bulk`: the file's bytes travel inside the JSON
 * envelope so parsing stays on the server, behind budgets a caller cannot get
 * around, and there is one body-parsing surface with one error shape rather
 * than two. Multipart would add a dependency, a second parser with its own
 * limits and its own failure modes, and a second convention inside one panel.
 *
 * **Base64 rather than the plain JSON string `bulk` uses**, because the two
 * carry different things. A bulk import is a *document* the admin assembled;
 * an upload is a *file* the admin picked, and the bytes have to reach the
 * server undecoded for the server to be able to say whether they are text at
 * all. A JSON string has already been decoded by the browser: a UTF-16 export
 * or a PDF renamed `.txt` would arrive as replacement characters that look
 * like perfectly valid text, and the byte budget would be measuring characters
 * rather than bytes. The cost is a third more bytes on the wire, which is what
 * the route's own `bodyLimit` is sized for.
 */
const uploadSourceBody = z.object({
  ai_agent_id: uuid,
  /** Optional: the file's own name is the title when the admin does not type one. */
  name: z.string().trim().min(1).max(200).optional(),
  filename: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).max(255),
  // No length cap: `KNOWLEDGE_FILE_LIMITS.maxBytes` is the single authority on
  // size, and a second one here would give one rule two different messages.
  data: z.string().min(1),
});

/**
 * Editing an existing source (FR-MOD-06.3.3).
 *
 * The shape mirrors `createSourceBody`'s split, because the same fact decides
 * both: a source's text comes from exactly one place, and only that place is
 * editable. `name` is a title and belongs to every type. `content` belongs to
 * `article` and `faq` — the types whose text was typed. `source_url` belongs to
 * `website`, whose text is the crawl. `file` takes neither, since its text is
 * the bytes that were uploaded; accepting a pasted `content` for it would undo
 * exactly what `createSourceBody` refuses `type: file` to protect.
 *
 * Which type the source *is* is a database fact, not a body field, so the
 * per-type check cannot live in the schema — it runs in the handler against the
 * loaded row. What lives here is the part that needs no row: the field is
 * refused when it is present and wrong, never dropped, so an admin who sends
 * the wrong one is told rather than left believing an edit landed.
 *
 * `refresh_after_days` (FR-MOD-06.3.3, tm 198.4) follows the same rule as
 * `source_url`: only a `website` source has anything to re-crawl, so it is
 * refused rather than ignored for the other three types. `null` is a legal
 * value — it turns automatic refresh back off — so the field is nullable, not
 * merely optional.
 */
const updateSourceBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(100_000).optional(),
    source_url: z.string().trim().min(1).max(2048).optional(),
    refresh_after_days: z.number().int().min(1).max(365).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/**
 * The transport ceiling for the upload route only, so the 1 MiB `bodyLimit`
 * every other route inherits stays where `server.ts` put it.
 *
 * Sized above `KNOWLEDGE_FILE_MAX_BYTES` rather than equal to it, for the same
 * reason `BULK_BODY_LIMIT` is: base64 costs a third more bytes, and a ceiling
 * that sat at the content limit would refuse a legal file with an opaque
 * body-too-large before the handler ran, instead of with the typed error that
 * names the limit. Auth is an `onRequest` hook and body parsing is not, so only
 * an authenticated principal holding the write scope can make the process
 * buffer this much.
 */
const KNOWLEDGE_FILE_BODY_LIMIT = 4_194_304; // 4 MiB

/** Strict base64: the alphabet, correct padding, and a length that is a whole number of quartets. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The bulk import budget (NFR-S8).
 *
 * Synchronous and bounded on purpose: 200 rows is a spreadsheet an admin
 * assembled by hand, which finishes inside one request, so there is no job
 * table, no queue and no progress bar to build, watch and get wrong. Exceeding
 * any of the three refuses the request — `parseCsv` never truncates to fit,
 * because a silently shortened import looks exactly like a complete one.
 */
const BULK_CSV_LIMITS: CsvLimits = {
  maxRows: 200,
  // The same ceiling `createSourceBody` puts on a single source's `content`, so
  // a row cannot carry text the one-at-a-time endpoint would have refused.
  maxCellChars: 100_000,
  maxBytes: 5_242_880, // 5 MiB
};

/**
 * The buffer ceiling for this route only, so the 1 MiB `bodyLimit` every other
 * route inherits stays where `server.ts` put it.
 *
 * Higher than `maxBytes` above rather than equal to it: the CSV travels as a
 * JSON string, and escaping quotes and newlines can nearly double a
 * quote-heavy file. Sizing the transport ceiling above the content ceiling
 * means an oversized file is refused by the *typed* budget error that names the
 * limit, instead of by an opaque body-too-large before the handler ever runs.
 * Auth is an `onRequest` hook and body parsing is not, so only an authenticated
 * principal holding the write scope can make the process buffer this much.
 */
const BULK_BODY_LIMIT = 12_582_912; // 12 MiB

/**
 * The separate, much smaller budget for the rows that cost an outbound request
 * (NFR-S7 · NFR-S8).
 *
 * The row ceiling above bounds writes; this one bounds *fetches*, and they are
 * not the same risk. 200 rows of pasted text is a spreadsheet. 200 rows of URLs
 * is one HTTP call the server turns into 200 probes of whatever the file names
 * — a port scanner with an admin's credentials in front of it. Twenty covers
 * importing a help centre's pages in one go and caps the amplification at a
 * number a human could have typed by hand.
 *
 * The time budget is shared by every crawl in the request rather than given per
 * row, so a file cannot buy more outbound requests by pointing at slow hosts.
 * It sits above `withTenant`'s 10s transaction timeout on purpose: crawling
 * happens outside the transaction, and if the two were ever tangled the crawl
 * budget outliving the transaction timeout is what makes that fail loudly.
 */
const BULK_CRAWL_LIMITS: BulkCrawlLimits = {
  maxWebsiteRows: 20,
  totalBudgetMs: 15_000,
};

const bulkImportBody = z.object({
  ai_agent_id: uuid,
  // No length cap here: `BULK_CSV_LIMITS.maxBytes` is the single authority on
  // size, and duplicating it would produce two different messages for one rule.
  csv: z.string().min(1),
  dry_run: z.boolean().default(false),
});

/** One row's verdict, mirroring `KnowledgeBulkRowResult` in the contract. */
interface BulkRowReport {
  line: number;
  name: string | null;
  type: string | null;
  status: 'imported' | 'skipped';
  id: string | null;
  chunk_count: number | null;
  added_by_name: string | null;
  error: string | null;
}

/**
 * What a skipped row shows in the results table.
 *
 * A rejected row's cells are echoed back so the admin can find it in their
 * spreadsheet — but a row is often rejected *for* being oversized, and 200 of
 * those echoed whole would turn a small refusal into a huge response. So the
 * echo is capped at the same 200 characters a valid `name` may hold.
 */
const ECHO_MAX = 200;

function echoCell(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  return trimmed.length > ECHO_MAX ? `${trimmed.slice(0, ECHO_MAX)}…` : trimmed;
}

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
            existing.persona &&
            typeof existing.persona === 'object' &&
            !Array.isArray(existing.persona)
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
    const items = await request.withTenant(async (tx) => {
      // AI-agent skills only. Copilot owns a `kind: 'copilot'` skill purely to
      // anchor its assist runs (FR-MOD-12) — it is not something an admin wrote
      // and must not appear in the Playbook list beside the real ones.
      const skills = await tx.skill.findMany({
        where: { kind: 'ai_agent' },
        orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      });
      const nameByCreatedBy = await creatorNamesByIds(
        tx,
        skills.map((skill) => skill.createdBy),
      );
      return skills.map((skill) =>
        serialiseSkill(
          skill,
          skill.createdBy ? (nameByCreatedBy.get(skill.createdBy) ?? null) : null,
        ),
      );
    });
    return reply.send({ items });
  });

  app.post('/skills', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(createSkillBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    const steps = body.steps ? requireValidSteps(body.steps) : [];

    const { created, createdByName } = await request.withTenant(async (tx) => {
      if (body.ai_agent_id) {
        const agent = await tx.aiAgent.findFirst({
          where: { id: body.ai_agent_id },
          select: { id: true },
        });
        if (!agent) throw ApiError.validation('That AI agent does not exist.');
      }

      const createdBy = principal.kind === 'agent' ? principal.accountId : null;
      const created = await tx.skill.create({
        data: {
          licenseId: tenant.licenseId,
          name: body.name,
          kind: 'ai_agent',
          ...(body.ai_agent_id ? { aiAgentId: body.ai_agent_id } : {}),
          ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
          steps: steps as object,
          // Never live on creation.
          active: false,
          createdBy,
          updatedAt: new Date(),
        },
      });

      return { created, createdByName: await creatorName(tx, createdBy) };
    });

    return reply.status(201).send(serialiseSkill(created, createdByName));
  });

  app.get<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const result = await request.withTenant(async (tx) => {
        const skill = await tx.skill.findFirst({ where: { id } });
        if (!skill) throw ApiError.notFound('Skill not found.');
        return { skill, createdByName: await creatorName(tx, skill.createdBy) };
      });
      return reply.send(serialiseSkill(result.skill, result.createdByName));
    },
  );

  app.patch<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const body = parse(updateSkillBody, request.body);
      const steps = body.steps ? requireValidSteps(body.steps) : undefined;

      const result = await request.withTenant(async (tx) => {
        const existing = await tx.skill.findFirst({ where: { id } });
        if (!existing) throw ApiError.notFound('Skill not found.');

        // Turning on a skill with nothing to run would look enabled and do
        // nothing, which is the hardest kind of misconfiguration to notice.
        const finalSteps = steps ?? (existing.steps as unknown[]);
        if (body.active === true && (!Array.isArray(finalSteps) || finalSteps.length === 0)) {
          throw new ApiError('not_allowed', 'A skill needs at least one step before it can run.');
        }

        const updated = await tx.skill.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
            ...(steps !== undefined ? { steps: steps as object } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            updatedAt: new Date(),
          },
        });

        return { updated, createdByName: await creatorName(tx, updated.createdBy) };
      });

      return reply.send(serialiseSkill(result.updated, result.createdByName));
    },
  );

  app.delete<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const deleted = await request.withTenant(async (tx) => {
        const { count } = await tx.skill.deleteMany({ where: { id } });
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `skill:${id}`,
            metadata: { kind: 'skill' },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Skill not found.');
      return reply.status(204).send();
    },
  );

  // --- Authoring -------------------------------------------------------------

  // Both authoring endpoints declare `aiInference` (NFR-C4 · C4-e): compiling
  // turns a natural-language instruction into steps, and a preview runs the
  // real engine over a message the author supplies.
  app.post(
    '/skills/compile',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
      const body = parse(compileBody, request.body);
      const { steps, unrecognised } = compileInstruction(body.instruction);
      return reply.send({ steps, unrecognised });
    },
  );

  app.post(
    '/skills/preview',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
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
    },
  );

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
    const items = await request.withTenant(async (tx) => {
      const sources = await tx.knowledgeSource.findMany({
        // The customer-facing AI agent's sources only. Copilot keeps its own base
        // (FR-MOD-12.2) on a `kind: 'copilot'` agent, reachable through
        // `/copilot/knowledge` — the two must never show each other's sources.
        where: { aiAgent: { kind: 'ai_agent' } },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { chunks: true } } },
      });
      const nameByAddedBy = await creatorNamesByIds(
        tx,
        sources.map((s) => s.addedBy),
      );
      return sources.map((s) => ({
        id: s.id,
        ai_agent_id: s.aiAgentId,
        name: s.name,
        type: s.type,
        status: s.status,
        source_url: s.sourceUrl,
        chunk_count: s._count.chunks,
        updated_at: s.updatedAt.toISOString(),
        added_by_name: s.addedBy ? (nameByAddedBy.get(s.addedBy) ?? null) : null,
        refresh_after_days: s.refreshAfterDays,
        next_refresh_at: s.nextRefreshAt ? s.nextRefreshAt.toISOString() : null,
        last_refresh_error: s.lastRefreshError,
      }));
    });

    return reply.send({ items });
  });

  // Indexing embeds the source text — a model call over workspace content.
  app.post(
    '/knowledge-sources',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
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

        const addedBy = principal.kind === 'agent' ? principal.accountId : null;
        const source = await tx.knowledgeSource.create({
          data: {
            aiAgentId: body.ai_agent_id,
            licenseId: tenant.licenseId,
            type: body.type,
            name: body.name,
            content,
            sourceUrl,
            status: 'indexing',
            addedBy,
            updatedAt: new Date(),
          },
        });

        // Indexed in the same transaction: a source that exists but is not
        // searchable looks ready and answers nothing.
        const chunks = await knowledge.index(tx, tenant, source.id, content);

        return { source, chunks, addedByName: await creatorName(tx, addedBy) };
      });

      return reply
        .status(201)
        .send(serialiseIndexedSource(created.source, created.chunks, created.addedByName));
    },
  );

  /**
   * File upload — the only way a `file` source is created.
   *
   * The order of operations is the whole design, and it is the same order the
   * `website` path uses: **judge the bytes before opening a transaction, and
   * write nothing until they have passed.** Decoding, the type allow-list, the
   * UTF-8 check and both budgets all run first, so a refused upload leaves no
   * row, no chunk and no half-created source — and none of that work holds a
   * database connection open.
   *
   * Nothing here writes to disk. There is no object store, no temporary file
   * and no path built from anything the caller sent: the bytes exist as a
   * `Buffer` for the length of the request and what is kept is the text they
   * parsed to. The filename is a *title* and nothing else.
   *
   * Chunk, embed and index happen in the same transaction as the insert, for
   * the reason the endpoint above states: a source that exists but is not
   * searchable looks ready and answers nothing.
   */
  app.post(
    '/knowledge-sources/file',
    { config: { scopes: WRITE, aiInference: true }, bodyLimit: KNOWLEDGE_FILE_BODY_LIMIT },
    async (request, reply) => {
      const body = parse(uploadSourceBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      // `Buffer.from(x, 'base64')` never fails — it skips characters outside
      // the alphabet and returns whatever it could make of the rest. So a
      // payload that is not base64 has to be refused before decoding, or a
      // corrupted upload would arrive as plausible-looking bytes.
      const encoded = body.data.replace(/\s+/g, '');
      if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
        throw ApiError.validation('data: expected base64-encoded file bytes.');
      }

      let parsed;
      try {
        parsed = parseKnowledgeFile({
          contentType: body.content_type,
          bytes: Buffer.from(encoded, 'base64'),
        });
      } catch (error) {
        if (isKnowledgeFileParseError(error)) throw ApiError.validation(`file: ${error.message}`);
        throw error;
      }

      const title = body.name ?? titleFromFilename(body.filename);
      if (title === '') throw ApiError.validation('filename: a file needs a usable name.');

      const created = await request.withTenant(async (tx) => {
        const agent = await tx.aiAgent.findFirst({
          where: { id: body.ai_agent_id },
          select: { id: true },
        });
        if (!agent) throw ApiError.validation('That AI agent does not exist.');

        const addedBy = principal.kind === 'agent' ? principal.accountId : null;
        const source = await tx.knowledgeSource.create({
          data: {
            aiAgentId: body.ai_agent_id,
            licenseId: tenant.licenseId,
            type: 'file',
            name: title,
            content: parsed.text,
            // A file has no URL. Storing the filename here would put a name
            // into a column every reader treats as a fetchable address.
            sourceUrl: null,
            status: 'indexing',
            addedBy,
            updatedAt: new Date(),
          },
        });

        const chunks = await knowledge.index(tx, tenant, source.id, parsed.text);

        return { source, chunks, addedByName: await creatorName(tx, addedBy) };
      });

      return reply
        .status(201)
        .send(serialiseIndexedSource(created.source, created.chunks, created.addedByName));
    },
  );

  /**
   * Bulk import — the multi-row counterpart of the endpoint above.
   *
   * Three decisions carry it.
   *
   * 1. **The file cannot choose its target.** `ai_agent_id` is a body field,
   *    not a column, so a stray `ai_agent_id` column is ignored like any other
   *    unrecognised header. That is what makes checking ownership once — before
   *    the loop — sound rather than a shortcut: there is no second agent id
   *    anywhere in the request for a later row to smuggle in, and every row is
   *    written against the id that check approved.
   * 2. **One short transaction per row, not one long one.** Partial success is
   *    already the contract, so a single transaction would buy nothing and cost
   *    a great deal: it would hold a connection open across 200 create+embed
   *    pairs. The row is the unit of work and the unit of failure.
   * 3. **Partial success is a 200, not a 207.** The ADR-06 error envelope is
   *    for a request refused as a whole — unparseable CSV, a header missing a
   *    column, a budget overrun. Once rows are being judged individually, the
   *    verdicts are the response body, and a client that reads `imported` and
   *    `failed` needs no new status code to understand them.
   * 4. **A `website` row is fetched before its transaction opens, one at a
   *    time, against a budget the whole file shares.** This is the single-source
   *    path's rule (`assertPublicHttpUrl` then `crawl`, both outside the
   *    transaction) applied per row — see `services/ai/knowledge-bulk-crawl.ts`
   *    for why the refusals are deliberately indistinguishable from each other.
   *    A dry run runs the guard but makes no request at all.
   */
  app.post(
    '/knowledge-sources/bulk',
    { config: { scopes: WRITE, aiInference: true }, bodyLimit: BULK_BODY_LIMIT },
    async (request, reply) => {
      const body = parse(bulkImportBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      // Neither a malformed file nor a header missing a column can be blamed on
      // one row — nothing can be salvaged from either, so both refuse the whole
      // request rather than producing 200 identical row failures.
      let document;
      try {
        document = parseCsv(body.csv, BULK_CSV_LIMITS);
      } catch (error) {
        if (isCsvParseError(error)) throw ApiError.validation(`csv: ${error.message}`);
        throw error;
      }

      let columns: KnowledgeBulkColumnIndex;
      try {
        columns = resolveKnowledgeBulkColumns(document.header);
      } catch (error) {
        if (isKnowledgeBulkHeaderError(error))
          throw ApiError.validation(`csv header: ${error.message}`);
        throw error;
      }

      // Ownership first, and outside the loop. Under RLS a foreign agent simply
      // is not visible, so this resolves "does not exist" and "belongs to
      // someone else" into the same answer — and it runs before a single row is
      // written, so a refused import writes nothing at all.
      //
      // The whole file is one request from one principal, so the name every
      // created row will carry is resolved once here, not per row.
      const addedBy = principal.kind === 'agent' ? principal.accountId : null;
      const addedByName = await request.withTenant(async (tx) => {
        const agent = await tx.aiAgent.findFirst({
          where: { id: body.ai_agent_id },
          select: { id: true },
        });
        if (!agent) throw ApiError.validation('That AI agent does not exist.');
        return creatorName(tx, addedBy);
      });

      // Every row is validated before any row is acted on. How many of them ask
      // for a fetch decides whether this request may reach the network at all,
      // and that has to be known before the first one goes out — not discovered
      // on row 87, with 86 probes already sent. Mapping is pure, so the extra
      // pass costs nothing but the ordering it buys.
      const mapped = document.rows.map((row, index) => ({
        // 1-based among *data* rows, matching `parseCsv`: a quoted cell may span
        // several physical lines, so a file line number would not address the
        // row the admin is looking for.
        line: index + 1,
        row,
        result: mapKnowledgeBulkRow(columns, row),
      }));

      const websiteRows = mapped.filter(
        (entry) => entry.result.ok && entry.result.value.type === 'website',
      ).length;
      if (websiteRows > BULK_CRAWL_LIMITS.maxWebsiteRows) {
        // Refused whole, like every other budget overrun, and refused here —
        // before the crawler is even constructed, so an oversized file buys
        // zero outbound requests rather than the first twenty.
        throw ApiError.validation(
          `csv: this file has ${websiteRows} website rows; one import may crawl at most ${BULK_CRAWL_LIMITS.maxWebsiteRows}.`,
        );
      }

      // One budget for the whole file, spent one row at a time.
      const crawler = new BulkWebsiteCrawler(BULK_CRAWL_LIMITS);

      const results: BulkRowReport[] = [];
      let imported = 0;
      let failed = 0;

      const skip = (
        line: number,
        name: string | null,
        type: string | null,
        error: string,
      ): void => {
        results.push({
          line,
          name,
          type,
          status: 'skipped',
          id: null,
          chunk_count: null,
          added_by_name: null,
          error,
        });
        failed += 1;
      };

      /**
       * The real reason stays in the log; what goes back is one sentence for
       * every refusal, so a reply cannot be read as a map of the network.
       */
      const refuseWebsiteRow = (
        line: number,
        name: string,
        type: string,
        refusal: BulkCrawlRefusal,
      ): void => {
        request.log.warn(
          { line, reason: refusal.reason, detail: refusal.detail },
          'bulk knowledge import: website row refused',
        );
        skip(line, name, type, refusal.message);
      };

      for (const { line, row, result } of mapped) {
        if (!result.ok) {
          skip(
            line,
            echoCell(row[columns.name]),
            echoCell(row[columns.type]),
            `${result.error.field}: ${result.error.message}`,
          );
          continue;
        }

        const { name, type } = result.value;
        let content = result.value.content ?? '';
        let sourceUrl: string | null = null;

        if (type === 'website') {
          const target = result.value.source_url ?? '';
          if (body.dry_run) {
            // A preview runs the guard and stops there. That is the verdict a
            // preview exists to give, and fetching for one would make a dry run
            // a way to probe hosts with nothing written to show for it.
            const checked = checkWebsiteUrl(target);
            if (!checked.ok) {
              refuseWebsiteRow(line, name, type, checked);
              continue;
            }
          } else {
            // Resolved *before* the transaction below is opened, exactly as the
            // single-source path does it: a fetch has no business holding a DB
            // row open. A refused row is a verdict, not a reason to stop
            // reading the file.
            const crawled = await crawler.crawl(target);
            if (!crawled.ok) {
              refuseWebsiteRow(line, name, type, crawled);
              continue;
            }
            content = crawled.content;
            sourceUrl = crawled.url;
          }
        }

        if (body.dry_run) {
          results.push({
            line,
            name,
            type,
            status: 'imported',
            id: null,
            chunk_count: null,
            added_by_name: null,
            error: null,
          });
          imported += 1;
          continue;
        }

        try {
          const created = await request.withTenant(async (tx) => {
            const source = await tx.knowledgeSource.create({
              data: {
                aiAgentId: body.ai_agent_id,
                licenseId: tenant.licenseId,
                type,
                name,
                content,
                sourceUrl,
                status: 'indexing',
                addedBy,
                updatedAt: new Date(),
              },
            });

            // Same transaction as the create, exactly as the single-source path:
            // a source that exists but is not searchable looks ready and answers
            // nothing.
            const chunks = await knowledge.index(tx, tenant, source.id, content);
            return { source, chunks };
          });

          results.push({
            line,
            name,
            type,
            status: 'imported',
            id: created.source.id,
            chunk_count: created.chunks,
            added_by_name: addedByName,
            error: null,
          });
          imported += 1;
        } catch (error) {
          // A row that fails to write is a row-level verdict like any other: the
          // 199 rows after it still deserve to be imported. Logged in full,
          // reported generically — a database message is not something to hand
          // back over HTTP.
          request.log.error({ err: error, line }, 'bulk knowledge import: row failed to save');
          skip(line, name, type, 'This row could not be saved.');
        }
      }

      return reply.send({ imported, failed, dry_run: body.dry_run, results });
    },
  );

  /**
   * Edit a source (FR-MOD-06.3.3).
   *
   * Two orderings carry it, and both are the ones the create paths already
   * settled on.
   *
   * **The row is read before the body is judged**, because which field an edit
   * may carry is decided by the source's type and the type is not in the
   * request. A `content` sent for a `website`, or a `source_url` sent for a
   * `file`, is refused rather than dropped: Zod strips unknown keys, so a field
   * that is *known but wrong* would otherwise be the one silent failure mode
   * here — an admin pressing Save on a box whose value never leaves.
   *
   * **A new URL is crawled before the write transaction opens**, exactly as in
   * `POST /knowledge-sources`: the SSRF guard refuses a private target with a
   * 400 before any fetcher sees it, and the fetch does not hold a row open. A
   * refused edit leaves the source, its text and its chunks untouched.
   *
   * Changed text is re-indexed inside the same transaction as the update. A
   * rename is not — the name is joined at retrieval time, so no chunk carries
   * it and there is nothing to rebuild.
   */
  app.patch<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const body = parse(updateSourceBody, request.body);
      const tenant = request.tenant();

      const existing = await request.withTenant(async (tx) =>
        tx.knowledgeSource.findFirst({
          where: { id, aiAgent: { kind: 'ai_agent' } },
          select: { id: true, type: true, addedBy: true, refreshAfterDays: true },
        }),
      );
      // Under RLS a foreign source is simply not visible, so "does not exist"
      // and "belongs to another workspace" resolve to the same answer — 404,
      // never 403, which would confirm the id exists somewhere.
      if (!existing) throw ApiError.notFound('Knowledge source not found.');

      const isWebsite = existing.type === 'website';
      if (body.content !== undefined && (isWebsite || existing.type === 'file')) {
        throw ApiError.validation(
          `content: a ${existing.type} source's text comes from ${
            isWebsite ? 'its crawl' : 'the file that was uploaded'
          }, not from this field.`,
        );
      }
      if (body.source_url !== undefined && !isWebsite) {
        throw ApiError.validation('source_url: only a website source has a URL.');
      }
      if (body.refresh_after_days !== undefined && !isWebsite) {
        throw ApiError.validation(
          'refresh_after_days: only a website source can be scheduled for automatic refresh.',
        );
      }

      // Crawled outside the transaction, and refused before it: a private or
      // non-http target never reaches the fetcher and never touches the row.
      let text: string | null = body.content ?? null;
      let sourceUrl: string | null = null;
      if (body.source_url !== undefined) {
        const url = assertPublicHttpUrl(body.source_url);
        text = (await crawl(url)).text;
        sourceUrl = url.toString();
      }

      // A schedule change or a fresh crawl both restart the countdown, from
      // now — the source is, in either case, as fresh as it has just been
      // made. Renaming alone touches neither.
      const now = new Date();
      const refreshAfterDaysChanged = body.refresh_after_days !== undefined;
      const effectiveRefreshAfterDays: number | null =
        body.refresh_after_days !== undefined ? body.refresh_after_days : existing.refreshAfterDays;
      const recomputeSchedule = refreshAfterDaysChanged || sourceUrl !== null;

      const updated = await request.withTenant(async (tx) => {
        const { count } = await tx.knowledgeSource.updateMany({
          where: { id },
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(text === null ? {} : { content: text }),
            ...(sourceUrl === null ? {} : { sourceUrl }),
            ...(refreshAfterDaysChanged ? { refreshAfterDays: body.refresh_after_days } : {}),
            ...(recomputeSchedule
              ? { nextRefreshAt: computeNextRefreshAt(effectiveRefreshAfterDays, now) }
              : {}),
            updatedAt: now,
          },
        });
        // The row was there a moment ago; if it is gone now it was deleted
        // between the two statements, which is the same answer as never having
        // existed.
        if (count === 0) throw ApiError.notFound('Knowledge source not found.');

        // Re-chunked and re-embedded in the same transaction as the update, so
        // the source can never be readable as edited while still answering from
        // the text it replaced. Untouched text needs no rebuild — chunks hold
        // the content, not the title.
        const chunks =
          text === null
            ? await tx.knowledgeChunk.count({ where: { sourceId: id } })
            : await knowledge.index(tx, tenant, id, text);

        const source = await tx.knowledgeSource.findFirstOrThrow({ where: { id } });
        return { source, chunks, addedByName: await creatorName(tx, existing.addedBy) };
      });

      return reply.send(
        serialiseIndexedSource(updated.source, updated.chunks, updated.addedByName),
      );
    },
  );

  /**
   * Reindex a source (FR-MOD-06.3.3) — refresh it from wherever its text came
   * from, without changing what it is.
   *
   * For a `website` that means crawling the stored URL again, and **the SSRF
   * guard runs again on it** (NFR-S7). "It was validated when it was added" is
   * the one assumption that must not be made here: the row is not the request
   * that created it. It can have been written before a guard existed, by a
   * later importer, or straight into the database — and this endpoint turns any
   * value sitting in that column into an outbound request the server makes from
   * inside the network. So the stored value is treated as untrusted input, like
   * the one the create path took from the body.
   *
   * A refusal leaves everything as it was: the old text and the old chunks
   * survive, so a blocked refresh keeps a stale answer rather than replacing it
   * with none.
   *
   * For every other type there is nothing to fetch, and the text already held
   * is chunked and embedded again — which is what makes a source that indexed
   * to nothing recoverable without retyping it.
   *
   * On success this also restarts `next_refresh_at`'s countdown, using
   * whatever `refresh_after_days` the source already has (FR-MOD-06.3.3,
   * tm 198.4) — a manual reindex and the freshness sweep are the same
   * refresh, whichever triggered it, so both push the schedule out from now.
   */
  app.post<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId/reindex',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const tenant = request.tenant();

      const existing = await request.withTenant(async (tx) =>
        tx.knowledgeSource.findFirst({
          where: { id, aiAgent: { kind: 'ai_agent' } },
          select: {
            id: true,
            type: true,
            sourceUrl: true,
            content: true,
            addedBy: true,
            refreshAfterDays: true,
          },
        }),
      );
      if (!existing) throw ApiError.notFound('Knowledge source not found.');

      // Re-checked, not trusted from creation — and outside the transaction,
      // so a refusal costs no row lock and writes nothing. Same crawl path
      // the freshness sweep uses (`knowledge-refresh.ts`), so there is one
      // SSRF gate for "refresh this source", not two.
      const text = await fetchRefreshedText(existing);
      const now = new Date();

      const refreshed = await request.withTenant(async (tx) => {
        const { count } = await tx.knowledgeSource.updateMany({
          where: { id },
          data: {
            content: text,
            updatedAt: now,
            lastRefreshError: null,
            nextRefreshAt: computeNextRefreshAt(existing.refreshAfterDays, now),
          },
        });
        if (count === 0) throw ApiError.notFound('Knowledge source not found.');

        const chunks = await knowledge.index(tx, tenant, id, text);
        const source = await tx.knowledgeSource.findFirstOrThrow({ where: { id } });
        return { source, chunks, addedByName: await creatorName(tx, existing.addedBy) };
      });

      return reply.send(
        serialiseIndexedSource(refreshed.source, refreshed.chunks, refreshed.addedByName),
      );
    },
  );

  app.delete<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const deleted = await request.withTenant(async (tx) => {
        // Chunks cascade with the source; leaving them would keep answering
        // from text the admin believes they deleted.
        const { count } = await tx.knowledgeSource.deleteMany({ where: { id } });
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `knowledge_source:${id}`,
            metadata: { kind: 'knowledge_source' },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Knowledge source not found.');
      return reply.status(204).send();
    },
  );
}

/**
 * One shape for a knowledge source that was just indexed, so the four endpoints
 * that index one — create, upload, edit and reindex — cannot drift apart.
 *
 * They already had: `added_by_name` reached three of these replies one release
 * after the column started being written, so the table showed an author for a
 * source added one way and a dash for the same source added another. Four
 * copies of nine lines is how that happens.
 *
 * `status` is recomputed from the chunk count rather than read off the row,
 * because the row was loaded before `index()` ran and still says `indexing`.
 */
function serialiseIndexedSource(
  source: {
    id: string;
    aiAgentId: string;
    name: string;
    type: string;
    sourceUrl: string | null;
    updatedAt: Date;
    refreshAfterDays: number | null;
    nextRefreshAt: Date | null;
    lastRefreshError: string | null;
  },
  chunks: number,
  addedByName: string | null,
): Record<string, unknown> {
  return {
    id: source.id,
    ai_agent_id: source.aiAgentId,
    name: source.name,
    type: source.type,
    status: chunks > 0 ? 'ready' : 'empty',
    source_url: source.sourceUrl,
    chunk_count: chunks,
    updated_at: source.updatedAt.toISOString(),
    added_by_name: addedByName,
    refresh_after_days: source.refreshAfterDays,
    next_refresh_at: source.nextRefreshAt ? source.nextRefreshAt.toISOString() : null,
    last_refresh_error: source.lastRefreshError,
  };
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

/**
 * `Skill.createdBy` is a soft reference to `accounts.id` (no FK, so deleting
 * an account never blocks or cascades into a skill it once wrote) — the wire
 * format never exposes the raw id, only the resolved name, since a bare UUID
 * tells an admin nothing (FR-MOD-05.5).
 */
async function creatorName(tx: TenantClient, createdBy: string | null): Promise<string | null> {
  if (!createdBy) return null;
  const account = await tx.account.findFirst({ where: { id: createdBy }, select: { name: true } });
  return account?.name ?? null;
}

/** Bulk form of {@link creatorName}, one query for a whole list response. */
async function creatorNamesByIds(
  tx: TenantClient,
  createdByIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(createdByIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const accounts = await tx.account.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(accounts.map((account) => [account.id, account.name]));
}

function serialiseSkill(
  skill: {
    id: string;
    aiAgentId: string | null;
    name: string;
    kind: string;
    instruction: string | null;
    steps: unknown;
    active: boolean;
    runsCount: number;
    updatedAt: Date;
  },
  createdByName: string | null,
) {
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
    created_by_name: createdByName,
  };
}
