/**
 * Playbook — AI agents, skills and knowledge.
 *
 * Two rules run through all of it. Steps are validated before they are stored,
 * because a step the engine cannot run would be skipped in silence at the
 * moment it mattered and an admin would have no way to know why nothing
 * happened. And a skill is never created active: an unfinished step list must
 * not start answering customers the instant it is saved.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { compileInstruction, stepProblemDetails, validateSteps } from '@siyahtus/ai-mock';
import {
  AI_ASSIGNMENT_MODES,
  AI_STALL_TIMEOUT_SECONDS_MAX,
  AI_STALL_TIMEOUT_SECONDS_MIN,
  ANSWER_LENGTHS,
  BATCH_WINDOW_SECONDS_MAX,
  DAILY_MEMORY_RECALLS,
  DEFAULT_AI_ASSIGNMENT_MODE,
  clarifyThresholdsProblem,
  fallbackTakenProblem,
  readClarifyThresholds,
  DEFAULT_AI_STALL_TIMEOUT_SECONDS,
  DEFAULT_SKILL_MODE,
  SKILL_MODES,
  procedureProblemDetails,
  readBatchWindowSeconds,
  readDailyMemory,
  splitSkillProcedure,
  validateSkillProcedure,
  validateSkillSelection,
  type AiAssignmentMode,
  type Procedure,
  type ProcedureProblem,
  type SkillMode,
  type SkillProcedureFields,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { assertPublicHttpUrl } from '../lib/ssrf.js';
import { isCsvParseError, parseCsv, type CsvLimits } from '../lib/csv-import.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  createSkillDraft,
  deleteSkillDraft,
  updateSkillDraft,
} from '../services/ai/config-draft.js';
import {
  refuseUnembeddable,
  type KnowledgeService,
  type PreparedChunks,
} from '../services/ai/knowledge-service.js';
import { AiDailyCapError } from '../services/ai/ai-daily-budget.js';
import { EmbeddingProviderError } from '../services/ai/provider/embedding-error.js';
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
import type { Env } from '../config/env.js';
import type { MeteredLlm } from '../services/ai/metered-llm.js';
import { ConversationEngine } from '../services/ai/conversation/conversation-engine.js';
import { exchangeHistory } from '../services/ai/conversation/context-loader.js';
import { conversationView } from '../services/ai/conversation/conversation-view.js';
import {
  SOP_DRAFT_SCHEMA,
  SOP_TEXT_MAX,
  draftFromModel,
  skeletonFromSop,
  sopDraftSystemPrompt,
  type SopDraftResult,
  type SopModelDraft,
} from '../services/ai/conversation/procedure/sop-draft.js';
import { describeSideEffects, emptyTurnState } from '../services/ai/conversation/turn.js';
import { LlmProviderError } from '../services/ai/provider/llm-error.js';
import { refuseOverlongPrompt } from '../services/ai/provider/llm-provider.js';
import { completeStructured } from '../services/ai/provider/structured-output.js';
import type { TenantClient, TenantContext } from '../lib/tenant.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();

/**
 * A skill's definition beyond its one-message steps (tm 296.2). The shape is
 * left to `validateSkillSelection` / `validateSkillProcedure` (@siyahtus/types),
 * which the editor runs too, so a refusal carries the same code either way.
 * `locked`, `template_key` and `template_version` are not here: the server
 * writes them, and a body naming them is not obeyed. `is_fallback` is the
 * author's (tm 297.2), checked apart: it needs the agent's other skills.
 */
const skillDefinitionFields = {
  mode: z.enum(SKILL_MODES).optional(),
  when_to_use: z.unknown().optional(),
  examples: z.unknown().optional(),
  priority: z.unknown().optional(),
  slots: z.unknown().optional(),
  procedure: z.unknown().optional(),
};

/** The agent's fallback (AI-05 §5) — at most one, {@link requireFallbackFree}. */
const isFallbackField = { is_fallback: z.boolean().optional() };

const createSkillBody = z.object({
  name: z.string().trim().min(1).max(120),
  ai_agent_id: uuid.optional(),
  instruction: z.string().max(10_000).optional(),
  steps: z.array(z.unknown()).optional(),
  ...skillDefinitionFields,
  ...isFallbackField,
});

const updateSkillBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    instruction: z.string().max(10_000).optional(),
    steps: z.array(z.unknown()).optional(),
    active: z.boolean().optional(),
    ...skillDefinitionFields,
    ...isFallbackField,
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

type SkillDefinitionBody = Pick<z.infer<typeof createSkillBody>, 'slots' | 'procedure'>;

const compileBody = z.object({
  mode: z.literal('single').optional(),
  instruction: z.string().min(1).max(10_000),
});

/** An SOP to draft a procedure from (tm 296.4 · AI-03 §11). */
const compileProcedureBody = z.object({
  mode: z.literal('procedure'),
  sop_text: z.string().trim().min(1).max(SOP_TEXT_MAX),
});

const previewBody = z
  .object({
    mode: z.enum(SKILL_MODES).default(DEFAULT_SKILL_MODE),
    steps: z.array(z.unknown()).optional(),
    // A procedure's definition (tm 296.4), judged as a save would judge it.
    when_to_use: z.unknown().optional(),
    examples: z.unknown().optional(),
    priority: z.unknown().optional(),
    slots: z.unknown().optional(),
    procedure: z.unknown().optional(),
    message: z.string().trim().min(1).max(10_000),
    /** The exchange before `message`, as the live path's history (tm 296.4). */
    conversation: z
      .array(
        z.object({
          role: z.enum(['visitor', 'ai', 'agent']),
          text: z.string().trim().min(1).max(10_000),
        }),
      )
      .max(40)
      .optional(),
    ai_agent_id: uuid.nullable().optional(),
  })
  .refine((body) => body.mode === 'procedure' || body.steps !== undefined, {
    message: 'steps is required unless mode is procedure',
    path: ['steps'],
  });

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
    batch_window_seconds: z
      .number()
      .int()
      .min(0)
      .max(BATCH_WINDOW_SECONDS_MAX)
      .nullable()
      .optional(),
    // Either field alone; the one left out keeps its value (tm 294).
    daily_memory: z
      .object({
        enabled: z.boolean().optional(),
        recall: z.enum(DAILY_MEMORY_RECALLS).optional(),
      })
      .strict()
      .refine((memory) => Object.keys(memory).length > 0, 'at least one field is required')
      .optional(),
    // Either one alone; the pair is judged once merged (tm 297.2).
    clarify_thresholds: z
      .object({
        high: z.number().min(0.01).max(1).optional(),
        low: z.number().min(0.01).max(1).optional(),
      })
      .strict()
      .refine((pair) => Object.keys(pair).length > 0, 'at least one field is required')
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/** Either field alone; the one left out keeps its value (tm 293.6). */
const handoffSettingsBody = z
  .object({
    assignment_mode: z.enum(AI_ASSIGNMENT_MODES).optional(),
    ai_stall_timeout_seconds: z
      .number()
      .int()
      .min(AI_STALL_TIMEOUT_SECONDS_MIN)
      .max(AI_STALL_TIMEOUT_SECONDS_MAX)
      .optional(),
  })
  .strict()
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
      { ...stepProblemDetails(result) },
    );
  }
  return steps;
}

/**
 * The mode-dependent columns of a skill write, judged and ready to store
 * (tm 296.2). `fields` is the definition as it will be — a PATCH's fields over
 * the stored ones — so a procedure is always judged whole: changing one slot
 * re-checks every step that names it. A refusal is a `400 validation` whose
 * `details` is the first problem's `ProcedureProblemDetails`.
 *
 * A `single` skill keeps whatever procedure it had (one switched back keeps
 * its draft); it may not be handed new slots or a new procedure.
 */
async function skillDefinitionData(
  tx: TenantClient,
  mode: SkillMode,
  fields: SkillProcedureFields,
  written: SkillDefinitionBody,
  locked?: Procedure,
): Promise<Prisma.SkillUncheckedUpdateInput> {
  if (mode === 'single') {
    for (const field of ['slots', 'procedure'] as const) {
      if (written[field] === undefined) continue;
      throwProcedureProblem({
        code: 'procedure_unknown_field',
        section: 'procedure',
        field,
        message: `${field} belongs to a procedure skill (mode: procedure)`,
      });
    }
    const [problem] = validateSkillSelection(fields);
    if (problem) throwProcedureProblem(problem);
    return {
      mode,
      whenToUse: typeof fields.when_to_use === 'string' ? fields.when_to_use.trim() : null,
      ...(Array.isArray(fields.examples)
        ? { examples: (fields.examples as string[]).map((example) => example.trim()) }
        : {}),
      ...(typeof fields.priority === 'number' ? { priority: fields.priority } : {}),
    };
  }

  const groups = await tx.group.findMany({ select: { id: true } });
  const result = validateSkillProcedure(fields, {
    groupIds: new Set(groups.map((group) => Number(group.id))),
    ...(locked ? { locked } : {}),
  });
  if (!result.ok) throwProcedureProblem(result.problems[0]!);
  const split = splitSkillProcedure(result.procedure);
  return {
    mode,
    whenToUse: split.when_to_use,
    examples: split.examples,
    priority: split.priority,
    slots: split.slots as unknown as Prisma.InputJsonValue,
    procedure: split.procedure as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Refuses a second fallback for one agent (AI-05 §5): `procedure_fallback_taken`,
 * naming the skill that already is. `self` is the skill being written, which
 * may be the fallback already. Skills without an agent count as one group.
 */
async function requireFallbackFree(
  tx: TenantClient,
  aiAgentId: string | null,
  self: string | null,
): Promise<void> {
  const taken = await tx.skill.findFirst({
    where: {
      kind: 'ai_agent',
      isFallback: true,
      aiAgentId,
      ...(self ? { id: { not: self } } : {}),
    },
    select: { name: true },
  });
  if (taken) throwProcedureProblem(fallbackTakenProblem(taken.name));
}

function throwProcedureProblem(problem: ProcedureProblem): never {
  throw ApiError.validation(problem.message, { ...procedureProblemDetails(problem) });
}

/** A stored skill's definition, as `validateSkillProcedure` reads it. */
function storedDefinition(skill: {
  whenToUse: string | null;
  examples: string[];
  priority: number;
  slots: unknown;
  procedure: unknown;
}): SkillProcedureFields {
  return {
    when_to_use: skill.whenToUse,
    examples: skill.examples,
    priority: skill.priority,
    slots: skill.slots,
    procedure: skill.procedure,
  };
}

export default async function playbookRoutes(
  app: FastifyInstance,
  {
    env,
    llm,
    knowledge,
  }: {
    env: Env;
    /**
     * The visitors' model, counted against the same daily AI caps (tm 257.8):
     * a preview is a real call on the deployment's key.
     */
    llm: MeteredLlm;
    /**
     * The server's one knowledge service, over its configured embedding
     * provider (tm 255.7) — the same instance the customer path searches with,
     * so a source indexed here is in the space a question is asked in.
     */
    knowledge: KnowledgeService;
  },
): Promise<void> {
  // The same provider and limits as the live path, for the reason the preview
  // shares the engine at all: a preview that answers differently is worse than
  // none (FR-MOD-06.2.5).
  const engine = new ConversationEngine({
    knowledge,
    llm,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxPromptChars: env.LLM_MAX_PROMPT_CHARS,
  });

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

        // `answer_length`, `batch_window_seconds`, `daily_memory` and
        // `clarify_thresholds` live inside the persona JSON alongside anything else an admin has set (a
        // signature, say), so merge rather than overwrite — clearing one
        // removes just that key.
        let persona: Prisma.InputJsonValue | undefined;
        if (
          body.answer_length !== undefined ||
          body.batch_window_seconds !== undefined ||
          body.daily_memory !== undefined ||
          body.clarify_thresholds !== undefined
        ) {
          const current =
            existing.persona &&
            typeof existing.persona === 'object' &&
            !Array.isArray(existing.persona)
              ? (existing.persona as Record<string, unknown>)
              : {};
          const next = { ...current };
          if (body.answer_length === null) delete next['answerLength'];
          else if (body.answer_length !== undefined) next['answerLength'] = body.answer_length;
          if (body.batch_window_seconds === null) delete next['batchWindowSeconds'];
          else if (body.batch_window_seconds !== undefined) {
            next['batchWindowSeconds'] = body.batch_window_seconds;
          }
          if (body.daily_memory !== undefined) {
            next['dailyMemory'] = { ...readDailyMemory(current), ...body.daily_memory };
          }
          if (body.clarify_thresholds !== undefined) {
            const pair = { ...readClarifyThresholds(current), ...body.clarify_thresholds };
            const problem = clarifyThresholdsProblem(pair);
            if (problem) throw ApiError.validation(`clarify_thresholds: ${problem}`);
            next['clarifyThresholds'] = pair;
          }
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

  // --- Hand-over settings (tm 293.2 · AI-11; widened by tm 303) ---------------
  //
  // When a person takes the agent's conversations: `ai_first` opens a
  // visitor's connection unassigned for the AI to answer and routes it when it
  // leaves the AI, `parallel` routes it on open (`services/chat/ai-first.ts`).
  // One row per customer-facing agent; none reads as the default. Copilot has
  // no hand-over — it never talks to a visitor — so it is not found here.

  /** The customer-facing agent, under the caller's RLS; 404 for Copilot or another workspace's. */
  async function customerFacingAgent(tx: TenantClient, id: string): Promise<void> {
    const agent = await tx.aiAgent.findFirst({
      where: { id, kind: 'ai_agent' },
      select: { id: true },
    });
    if (!agent) throw ApiError.notFound('AI agent not found.');
  }

  app.get<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId/handoff-settings',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.aiAgentId);
      const settings = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, id);
        return tx.aiHandoffSettings.findUnique({
          where: { aiAgentId: id },
          select: HANDOFF_SETTINGS_SELECT,
        });
      });
      return reply.send(serialiseHandoffSettings(id, settings));
    },
  );

  app.put<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId/handoff-settings',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.aiAgentId);
      const body = parse(handoffSettingsBody, request.body);
      const tenant = request.tenant();
      const fields = {
        ...(body.assignment_mode !== undefined ? { assignmentMode: body.assignment_mode } : {}),
        ...(body.ai_stall_timeout_seconds !== undefined
          ? { aiStallTimeoutSeconds: body.ai_stall_timeout_seconds }
          : {}),
      };
      const settings = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, id);
        return tx.aiHandoffSettings.upsert({
          where: { aiAgentId: id },
          create: { aiAgentId: id, licenseId: tenant.licenseId, ...fields },
          update: fields,
          select: HANDOFF_SETTINGS_SELECT,
        });
      });
      return reply.send(serialiseHandoffSettings(id, settings));
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
      const definition = await skillDefinitionData(tx, body.mode ?? DEFAULT_SKILL_MODE, body, body);
      if (body.is_fallback === true) await requireFallbackFree(tx, body.ai_agent_id ?? null, null);

      const createdBy = principal.kind === 'agent' ? principal.accountId : null;
      const created = await createSkillDraft(tx, {
        ...(definition as Pick<Prisma.SkillUncheckedCreateInput, 'mode' | 'whenToUse'>),
        licenseId: tenant.licenseId,
        name: body.name,
        kind: 'ai_agent',
        ...(body.ai_agent_id ? { aiAgentId: body.ai_agent_id } : {}),
        ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
        steps: steps as object,
        ...(body.is_fallback !== undefined ? { isFallback: body.is_fallback } : {}),
        // Never live on creation.
        active: false,
        createdBy,
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

        const mode = body.mode ?? (existing.mode as SkillMode);

        // Turning on a skill with nothing to run would look enabled and do
        // nothing, which is the hardest kind of misconfiguration to notice.
        const finalSteps = steps ?? (existing.steps as unknown[]);
        if (
          body.active === true &&
          mode === 'single' &&
          (!Array.isArray(finalSteps) || finalSteps.length === 0)
        ) {
          throw new ApiError('not_allowed', 'A skill needs at least one step before it can run.');
        }
        if (existing.locked && mode !== existing.mode) {
          throwProcedureProblem({
            code: 'procedure_locked_change',
            section: 'procedure',
            field: 'mode',
            message: 'a locked skill keeps its mode',
          });
        }

        const stored = storedDefinition(existing);
        const writesDefinition = (
          Object.keys(skillDefinitionFields) as Array<keyof typeof skillDefinitionFields>
        ).some((field) => body[field] !== undefined);
        // A locked copy may change only its texts and its team: judged against
        // the definition as stored.
        const lockedAs =
          existing.locked && existing.mode === 'procedure' ? validateSkillProcedure(stored) : null;
        const definition = writesDefinition
          ? await skillDefinitionData(
              tx,
              mode,
              {
                when_to_use: body.when_to_use !== undefined ? body.when_to_use : stored.when_to_use,
                examples: body.examples ?? stored.examples,
                priority: body.priority ?? stored.priority,
                slots: body.slots ?? stored.slots,
                procedure: body.procedure ?? stored.procedure,
              },
              body,
              lockedAs?.ok ? lockedAs.procedure : undefined,
            )
          : {};

        if (body.is_fallback === true && !existing.isFallback) {
          await requireFallbackFree(tx, existing.aiAgentId, existing.id);
        }

        const updated = await updateSkillDraft(tx, id, {
          ...definition,
          ...(body.is_fallback !== undefined ? { isFallback: body.is_fallback } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
          ...(steps !== undefined ? { steps: steps as object } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
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
        const count = await deleteSkillDraft(tx, id);
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
  // real engine over a message the author supplies. Only the preview declares
  // `aiBudget` (tm 257.8): compiling is deterministic and calls no model, and
  // a preview that would cross today's AI cap is a 429 — before the gate, or
  // from the engine when the call itself does not fit.
  //
  // A procedure drafted from an SOP (tm 296.4) is the exception: with a model
  // configured it is one structured-output call, so that branch asks the
  // budget itself — the route cannot declare `aiBudget` for one body and not
  // the other, and the instruction compiler must stay free.
  app.post(
    '/skills/compile',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
      const raw = request.body as { mode?: unknown } | null | undefined;
      if (raw?.mode === 'procedure') {
        const body = parse(compileProcedureBody, request.body);
        const { draft, unrecognised } = await draftProcedure(
          request,
          request.tenant(),
          body.sop_text,
        );
        return reply.send({ mode: 'procedure', steps: [], unrecognised, draft });
      }
      const body = parse(compileBody, request.body);
      const { steps, unrecognised } = compileInstruction(body.instruction);
      return reply.send({ mode: 'single', steps, unrecognised });
    },
  );

  /**
   * The SOP's draft: the rule-based skeleton with the `mock` provider, else
   * the model's, and the skeleton again when the model could not answer — a
   * timeout must not cost the author the draft. The daily cap is not a
   * failure of that kind: it is the 429 a preview gives.
   */
  async function draftProcedure(
    request: FastifyRequest,
    tenant: TenantContext,
    sopText: string,
  ): Promise<SopDraftResult> {
    if (llm.id === 'mock') return skeletonFromSop(sopText);
    await request.requireAiBudget();
    const prompt = {
      system: sopDraftSystemPrompt(),
      messages: [{ role: 'user' as const, content: sopText }],
    };
    try {
      refuseOverlongPrompt(prompt, env.LLM_MAX_PROMPT_CHARS);
      const { value } = await completeStructured<SopModelDraft>(
        llm.forTenant(tenant, { surface: 'ai_agent' }),
        {
          ...prompt,
          maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
          timeoutMs: env.LLM_TIMEOUT_MS,
          responseFormat: { name: 'sop_procedure_draft', schema: SOP_DRAFT_SCHEMA },
        },
      );
      return draftFromModel(value);
    } catch (error) {
      if (!(error instanceof LlmProviderError)) throw error;
      request.log.warn(
        { kind: error.kind, reason: error.reason },
        'the model could not draft the SOP; the rule-based skeleton was returned',
      );
      return skeletonFromSop(sopText);
    }
  }

  app.post(
    '/skills/preview',
    { config: { scopes: WRITE, aiInference: true, aiBudget: true } },
    async (request, reply) => {
      const body = parse(previewBody, request.body);
      const tenant = request.tenant();
      const history = body.conversation
        ? exchangeHistory(body.conversation, {
            maxMessages: env.AI_HISTORY_MAX_MESSAGES,
            maxChars: env.AI_HISTORY_MAX_CHARS,
          })
        : undefined;

      // A procedure is judged as a save would judge it (the license's teams
      // included) and not run when a save would refuse it: what the preview
      // shows must be what the saved skill would do.
      let definition: SkillProcedureFields | undefined;
      if (body.mode === 'procedure') {
        definition = {
          when_to_use: body.when_to_use,
          examples: body.examples,
          priority: body.priority,
          slots: body.slots,
          procedure: body.procedure,
        };
        const groups = await request.withTenant((tx) =>
          tx.group.findMany({ select: { id: true } }),
        );
        const verdict = validateSkillProcedure(definition, {
          groupIds: new Set(groups.map((group) => Number(group.id))),
        });
        if (!verdict.ok) {
          return reply.send({
            outcome: 'skipped',
            reply: null,
            tags: [],
            transfer_to: null,
            summary: null,
            log: [],
            errors: verdict.problems.map((problem) => problem.message),
            error_details: [],
            procedure_problems: verdict.problems.map(procedureProblemDetails),
            state: conversationView(emptyTurnState()),
          });
        }
      }

      // The real turn, no writes. A preview running different logic would be
      // worse than no preview.
      const result = await engine.preview((fn) => request.withTenant(fn), tenant, {
        steps: body.steps ?? [],
        message: body.message,
        aiAgentId: body.ai_agent_id ?? null,
        ...(definition ? { definition } : {}),
        ...(history ? { history } : {}),
      });
      const effects = describeSideEffects(result.sideEffects);

      return reply.send({
        outcome: result.decisions.outcome,
        reply: result.reply,
        tags: effects.tags,
        transfer_to: effects.transferTo,
        summary: effects.summary,
        log: result.decisions.log,
        errors: result.errors,
        error_details: result.error_details,
        ...(definition ? { procedure_problems: [] } : {}),
        state: conversationView(result.nextState),
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

      // The agent first (tm 257.20): a request that will write nothing must
      // not crawl a website or spend the day's AI allowance on its way to a 400.
      await request.withTenant((tx) => requireAiAgent(tx, body.ai_agent_id));

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

      // Embedded before the transaction as well, for the crawl's reason: the
      // provider is a network call with its own timeout (tm 255.7). A refusal
      // is a 503 with nothing written; a call today's AI cap cannot take is a
      // 429 `ai_daily_cap` with nothing written (tm 257.20).
      const prepared = await knowledge.prepare(content, tenant).catch(refuseUnembeddable);

      const created = await request.withTenant(async (tx) => {
        // Again inside the write: the agent may have been deleted meanwhile.
        await requireAiAgent(tx, body.ai_agent_id);

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
        const chunks = await knowledge.index(tx, tenant, source.id, prepared);

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
   * Chunks are written in the same transaction as the insert, for the reason
   * the endpoint above states: a source that exists but is not searchable
   * looks ready and answers nothing. They are embedded just before it opens,
   * with the bytes already judged — the provider is not paid for a refusal.
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

      // The agent before the embedding (tm 257.20), as on the endpoint above.
      await request.withTenant((tx) => requireAiAgent(tx, body.ai_agent_id));

      const prepared = await knowledge.prepare(parsed.text, tenant).catch(refuseUnembeddable);

      const created = await request.withTenant(async (tx) => {
        await requireAiAgent(tx, body.ai_agent_id);

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

        const chunks = await knowledge.index(tx, tenant, source.id, prepared);

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
        // `reason` + the numbers are what the console words in its own language
        // (tm 261); the position and the limits are facts, not prose.
        if (isCsvParseError(error)) {
          throw ApiError.validation(`csv: ${error.message}`, {
            reason: `csv_${error.code}`,
            line: error.line,
            column: error.column,
            max_rows: BULK_CSV_LIMITS.maxRows,
            max_cell_chars: BULK_CSV_LIMITS.maxCellChars,
            max_bytes: BULK_CSV_LIMITS.maxBytes,
          });
        }
        throw error;
      }

      let columns: KnowledgeBulkColumnIndex;
      try {
        columns = resolveKnowledgeBulkColumns(document.header);
      } catch (error) {
        if (isKnowledgeBulkHeaderError(error)) {
          throw ApiError.validation(`csv header: ${error.message}`, {
            reason: 'csv_header_missing',
            columns: error.missing.join(', '),
          });
        }
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
        if (!agent) {
          throw ApiError.validation('That AI agent does not exist.', {
            reason: 'ai_agent_not_found',
          });
        }
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
          {
            reason: 'csv_too_many_website_rows',
            rows: websiteRows,
            max: BULK_CRAWL_LIMITS.maxWebsiteRows,
          },
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

      // Today's AI allowance for the whole file, reserved before its first row
      // is embedded (tm 257.20): a file the day cannot afford is refused whole —
      // one 429 `ai_daily_cap`, not two hundred skipped rows — with nothing
      // crawled and nothing written. Pasted text is estimated here, chunk by
      // chunk as it will be sent; a website row's text exists only once it is
      // crawled, so its embedding reserves what it needs when it gets there.
      // Settled when the loop ends, however it ends: what the rows did not use
      // goes back to the day. A dry run embeds nothing and reserves nothing.
      const hold = body.dry_run
        ? null
        : await knowledge.hold(
            tenant,
            mapped.reduce(
              (sum, { result }) =>
                result.ok && result.value.type !== 'website'
                  ? sum + knowledge.estimate(result.value.content ?? '')
                  : sum,
              0,
            ),
          );

      try {
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

          // Embedded before the row's transaction, like its crawl (tm 255.7). A
          // row the provider could not embed is a row-level verdict like any
          // other — nothing is written for it, and the rows after it still get
          // their chance; the provider's circuit breaker keeps an outage from
          // costing every remaining row a full timeout. Drawn from the file's
          // hold; a crawled row the hold has no room for and today's cap cannot
          // take either is skipped with that reason (tm 257.20).
          let prepared: PreparedChunks;
          try {
            prepared = await knowledge.prepare(content, hold ?? tenant);
          } catch (error) {
            if (error instanceof AiDailyCapError) {
              skip(
                line,
                name,
                type,
                "This row was not indexed: today's AI allowance is used up; it renews at 00:00 UTC.",
              );
              continue;
            }
            if (!(error instanceof EmbeddingProviderError)) throw error;
            request.log.warn(
              { line, kind: error.kind },
              'bulk knowledge import: row could not be embedded',
            );
            skip(
              line,
              name,
              type,
              `This row could not be indexed: the embedding provider did not answer (${error.kind}).`,
            );
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
              const chunks = await knowledge.index(tx, tenant, source.id, prepared);
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
      } finally {
        await hold?.settle();
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
   * it and there is nothing to rebuild. The new text is embedded before that
   * transaction opens (tm 255.7); a refusal there is a 503 that, like a
   * refused crawl, leaves the source exactly as it was — the rename included.
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
      const prepared =
        text === null ? null : await knowledge.prepare(text, tenant).catch(refuseUnembeddable);

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

        // The new chunks are written in the same transaction as the update, so
        // the source can never be readable as edited while still answering from
        // the text it replaced. Untouched text needs no rebuild — chunks hold
        // the content, not the title.
        const chunks =
          prepared === null
            ? await tx.knowledgeChunk.count({ where: { sourceId: id } })
            : await knowledge.index(tx, tenant, id, prepared);

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
      // And embedded before the transaction too; a refusal keeps the stale
      // answer, exactly as a refused crawl does (tm 255.7).
      const prepared = await knowledge.prepare(text, tenant).catch(refuseUnembeddable);
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

        const chunks = await knowledge.index(tx, tenant, id, prepared);
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
const HANDOFF_SETTINGS_SELECT = { assignmentMode: true, aiStallTimeoutSeconds: true } as const;

/** `AiHandoffSettings` (contract): an agent with no row has the defaults. */
function serialiseHandoffSettings(
  aiAgentId: string,
  row: { assignmentMode: string; aiStallTimeoutSeconds: number } | null,
): { ai_agent_id: string; assignment_mode: AiAssignmentMode; ai_stall_timeout_seconds: number } {
  return {
    ai_agent_id: aiAgentId,
    // The CHECK holds the column to `AI_ASSIGNMENT_MODES`.
    assignment_mode:
      (row?.assignmentMode as AiAssignmentMode | undefined) ?? DEFAULT_AI_ASSIGNMENT_MODE,
    ai_stall_timeout_seconds: row?.aiStallTimeoutSeconds ?? DEFAULT_AI_STALL_TIMEOUT_SECONDS,
  };
}

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
    batch_window_seconds: readBatchWindowSeconds(persona),
    daily_memory: readDailyMemory(persona),
    clarify_thresholds: readClarifyThresholds(persona),
    active: agent.active,
    skills_count: agent._count.skills,
  };
}

/**
 * `Skill.createdBy` is a soft reference to `accounts.id` (no FK, so deleting
 * an account never blocks or cascades into a skill it once wrote). The wire
 * format carries both the resolved name (a bare UUID tells an admin nothing,
 * FR-MOD-05.5) and the id itself — the id is what the human-owner filter
 * narrows on, because two accounts can share a name and one can be renamed
 * (FR-MOD-05.4).
 */
/**
 * Refuse an `ai_agent_id` this workspace cannot see. Under RLS a foreign agent
 * is simply not visible, so "does not exist" and "belongs to someone else" are
 * one answer.
 */
async function requireAiAgent(tx: TenantClient, aiAgentId: string): Promise<void> {
  const agent = await tx.aiAgent.findFirst({ where: { id: aiAgentId }, select: { id: true } });
  if (!agent) throw ApiError.validation('That AI agent does not exist.');
}

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
    createdBy: string | null;
    mode: string;
    whenToUse: string | null;
    examples: string[];
    priority: number;
    slots: unknown;
    procedure: unknown;
    locked: boolean;
    templateKey: string | null;
    templateVersion: number | null;
    isFallback: boolean;
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
    mode: skill.mode,
    when_to_use: skill.whenToUse,
    examples: skill.examples,
    priority: skill.priority,
    slots: Array.isArray(skill.slots) ? skill.slots : [],
    procedure: skill.procedure ?? null,
    locked: skill.locked,
    template_key: skill.templateKey,
    template_version: skill.templateVersion,
    is_fallback: skill.isFallback,
    active: skill.active,
    runs_count: skill.runsCount,
    updated_at: skill.updatedAt.toISOString(),
    created_by_name: createdByName,
    created_by_id: skill.createdBy,
  };
}
