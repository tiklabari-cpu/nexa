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
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { compileInstruction, stepProblemDetails, validateSteps } from '@siyahtus/ai-mock';
import {
  AI_ASSIGNMENT_MODES,
  AI_STALL_TIMEOUT_SECONDS_MAX,
  AI_STALL_TIMEOUT_SECONDS_MIN,
  AI_WELCOME_MESSAGE_MAX,
  ANSWER_LENGTHS,
  HUMAN_BUTTON_LABEL_MAX,
  readAiWelcome,
  readHumanButtonLabel,
  BATCH_WINDOW_SECONDS_MAX,
  DAILY_MEMORY_RECALLS,
  DEFAULT_AI_ASSIGNMENT_MODE,
  clarifyThresholdsProblem,
  ADDRESS_FORMS,
  EMOJI_USES,
  MAX_QUESTIONS_PER_MESSAGE_MAX,
  MAX_QUESTIONS_PER_MESSAGE_MIN,
  readPersonaStyle,
  fallbackTakenProblem,
  guardrailSetupProblem,
  type GuardrailSetupProblem,
  readClarifyThresholds,
  DEFAULT_AI_STALL_TIMEOUT_SECONDS,
  DEFAULT_SKILL_MODE,
  HANDOFF_MESSAGE_MAX,
  HANDOFF_MESSAGE_REASONS,
  HANDOFF_TRIGGER_BOUNDS,
  HANDOFF_TRIGGER_LOCKED_REASON,
  DEFAULT_KNOWLEDGE_LIST_AUDIENCE,
  CRAWL_SCOPES,
  DEFAULT_CRAWL_SCOPE,
  KNOWLEDGE_CRAWL_PATHS,
  KNOWLEDGE_JOB_ACTIVE_STATUSES,
  KNOWLEDGE_PAGE_STATUSES,
  KNOWLEDGE_PAGE_LIMIT,
  normalizeCrawlPaths,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_LIST_AUDIENCES,
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
  KNOWLEDGE_SCOPE_IDS_MAX,
  KNOWLEDGE_TABLE_SOURCE_TYPE,
  LOCKED_HANDOFF_REASONS,
  isKnowledgeReviewDue,
  isLockedHandoffReason,
  knowledgeReviewDueAt,
  normaliseLanguage,
  normalizeKnowledgeAudiences,
  normalizeKnowledgeDocumentMime,
  mergeHandoffMessages,
  mergeHandoffTriggers,
  readHandoffAfterHours,
  readHandoffMessages,
  readHandoffTriggers,
  readResolutionCriteria,
  storedHandoffMessages,
  NO_ANSWER_POLICIES,
  NO_ANSWER_TEXT_MAX,
  SKILL_MODES,
  procedureProblemDetails,
  readBatchWindowSeconds,
  readDailyMemory,
  readNoAnswerSettings,
  splitSkillProcedure,
  validateResolutionCriteria,
  validateSkillProcedure,
  validateSkillSelection,
  type AiAssignmentMode,
  type Cond,
  type AiNoAnswerSettings,
  type HandoffAfterHours,
  type HandoffMessages,
  type HandoffTriggers,
  type KnowledgeAudience,
  type Procedure,
  type ProcedureProblem,
  type SkillMode,
  type SkillProcedureFields,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { assertPublicHttpUrl } from '../lib/ssrf.js';
import type { SafeHttp } from '../lib/safe-fetch.js';
import { isCsvParseError, parseCsv, type CsvLimits } from '../lib/csv-import.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  createKnowledgeSourceDraft,
  createSkillDraft,
  createAiAgentDraft,
  deleteKnowledgeSourceDraft,
  deleteSkillDraft,
  updateAiAgentDraft,
  knowledgeScopeOfFiling,
  reviewKnowledgeSourceDraft,
  updateKnowledgeSourceDraft,
  updateSkillDraft,
  upsertHandoffSettingsDraft,
  type KnowledgeAudienceScope,
  type KnowledgeFiling,
} from '../services/ai/config-draft.js';
import { configAuthorOf } from '../lib/config-author.js';
import { withStepTeamIds } from '../services/ai/step-teams.js';
import {
  copyPlaceholders,
  isLockedCopy,
  refuseTemplatePublish,
  templateLocked,
  templatePublishProblem,
} from '../services/ai-templates/install.js';
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
import {
  enqueueKnowledgeJob,
  KNOWLEDGE_JOB_SELECT,
  knowledgeJobInProgress,
  serialiseKnowledgeJob,
} from '../services/ai/crawler/jobs.js';
import { settleCrawledSource } from '../services/ai/crawler/job-runner.js';
import {
  isDuplicateDocument,
  knowledgeFileLink,
  knowledgeSourceExists,
  readUploadedDocument,
} from '../services/ai/knowledge-document.js';
import { createObjectStore } from '../services/storage/object-store.js';
import { KnowledgeDownloadSigner } from '../services/storage/upload-url.js';
import { ProcedureExamples, storeProcedureExamples } from '../services/ai/procedure-examples.js';
import { computeNextRefreshAt } from '../services/ai/knowledge-refresh.js';
import type { Env } from '../config/env.js';
import type { MeteredLlm } from '../services/ai/metered-llm.js';
import { ConversationEngine } from '../services/ai/conversation/conversation-engine.js';
import { KnowledgeTableFacts } from '../services/ai/conversation/facts.js';
import {
  AccessInfoResolver,
  createAccessInfoFetcher,
} from '../services/knowledge-tables/access-info.js';
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
 * Who keeps a source true, what language it is in and how often a person
 * looks at it again (tm 309.1 · AI-14-S3) — on every write of a source. Meta
 * to retrieval (ADR-14b §2.2): none of them is indexed or changes what the AI
 * says, so all four types take them alike. `language` keeps the primary
 * subtag ({@link sourceMetaData}); `owner_id` must be a member
 * ({@link requireMember}).
 */
const sourceMetaFields = {
  owner_id: uuid.nullable().optional(),
  language: z.string().trim().max(35).nullable().optional(),
  review_interval_days: z
    .number()
    .int()
    .min(KNOWLEDGE_REVIEW_INTERVAL_DAYS.min)
    .max(KNOWLEDGE_REVIEW_INTERVAL_DAYS.max)
    .optional(),
};

/** Ids as one set: lower case, each once, in the order given. */
const idSet = z
  .array(uuid)
  .max(KNOWLEDGE_SCOPE_IDS_MAX)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/**
 * Who a source is for (tm 309.2 · AI-14, ADR §2.2–§2.4) — what retrieval
 * filters on, on every write of a source. `audiences` is never empty and is
 * kept in the store's one spelling (a repeat is folded); `ai_agent_ids` names
 * AI agents of this workspace and `brand_ids` its brands
 * ({@link requireSourceScope}), empty being every one; past `valid_until` the
 * source answers nothing. Omitted on a create: the scope of the agent record
 * named ({@link createScope}), every brand, no end.
 */
const sourceScopeFields = {
  audiences: z
    .array(z.enum(KNOWLEDGE_AUDIENCES))
    .min(1)
    .max(KNOWLEDGE_AUDIENCES.length)
    .transform((values) => normalizeKnowledgeAudiences(values))
    .optional(),
  ai_agent_ids: idSet.optional(),
  brand_ids: idSet.optional(),
  valid_until: z.string().datetime({ offset: true }).nullable().optional(),
};

/**
 * A list of URL path prefixes (tm 312 · AI-17) in the one spelling a source
 * keeps (`normalizeCrawlPaths`); an entry that is not a path prefix is a 400.
 */
const crawlPaths = z
  .array(z.string())
  .max(KNOWLEDGE_CRAWL_PATHS.maxCount)
  .transform((paths, ctx) => {
    const kept = normalizeCrawlPaths(paths);
    if (kept === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expected path prefixes starting with "/", at most ${KNOWLEDGE_CRAWL_PATHS.maxLength} characters, with no query, fragment, wildcard or space`,
      });
      return z.NEVER;
    }
    return kept;
  });

/**
 * How far a website source's crawl reaches (tm 312 · AI-17), on a create and
 * an edit. Only a website is crawled, so each is refused — never dropped — for
 * the other types ({@link refuseCrawlSettings}).
 */
const crawlSettingsFields = {
  crawl_scope: z.enum(CRAWL_SCOPES).optional(),
  page_limit: z
    .number()
    .int()
    .min(KNOWLEDGE_PAGE_LIMIT.min)
    .max(KNOWLEDGE_PAGE_LIMIT.max)
    .optional(),
  include_paths: crawlPaths.optional(),
  exclude_paths: crawlPaths.optional(),
};
const CRAWL_SETTINGS = ['crawl_scope', 'page_limit', 'include_paths', 'exclude_paths'] as const;

/** The crawl setting a body names, if it names one — the field to refuse for a source that is not a website. */
function namedCrawlSetting(body: Partial<Record<(typeof CRAWL_SETTINGS)[number], unknown>>) {
  return CRAWL_SETTINGS.find((field) => body[field] !== undefined);
}

/**
 * `brand_id` is a shorthand for `brand_ids: [brand_id]` (AI-17): naming a
 * different set in `brand_ids` as well is a contradiction, refused rather than
 * resolved by picking one.
 */
function refineBrandShorthand(
  body: { brand_id?: string; brand_ids?: string[] },
  ctx: z.RefinementCtx,
): void {
  if (
    body.brand_id !== undefined &&
    body.brand_ids !== undefined &&
    (body.brand_ids.length !== 1 || body.brand_ids[0] !== body.brand_id.toLowerCase())
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['brand_id'],
      message: 'brand_id and brand_ids name different brands',
    });
  }
}

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
    ...sourceMetaFields,
    ...sourceScopeFields,
    ...crawlSettingsFields,
    /** The one brand a website belongs to (AI-17): `brand_ids: [brand_id]`. */
    brand_id: uuid.optional(),
  })
  .superRefine((body, ctx) => {
    const crawlSetting = namedCrawlSetting(body);
    if (crawlSetting !== undefined && body.type !== 'website') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [crawlSetting],
        message: 'only a website source is crawled',
      });
    }
    refineBrandShorthand(body, ctx);
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
  })
  // `brand_id` is a shorthand: from here on the source's brands are `brand_ids`.
  .transform(({ brand_id, ...body }) =>
    brand_id === undefined ? body : { ...body, brand_ids: [brand_id.toLowerCase()] },
  );

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
  ...sourceMetaFields,
  ...sourceScopeFields,
});

/**
 * A PDF or Word document source (tm 313 · AI-18): the bytes are already in the
 * object store (`POST /uploads` with `purpose: knowledge_document`), named by
 * the grant's `upload_id`. The title is `name`, or `filename` without its
 * directories — one of the two is required, since the stored key keeps no
 * name. `brand_id` is the shorthand `POST /knowledge-sources` takes.
 */
const documentSourceBody = z
  .object({
    ai_agent_id: uuid,
    upload_id: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(200).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    brand_id: uuid.optional(),
    ...sourceMetaFields,
    ...sourceScopeFields,
  })
  .superRefine((body, ctx) => {
    refineBrandShorthand(body, ctx);
    if (body.name === undefined && body.filename === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'a document needs a name or its filename',
      });
    }
  })
  .transform(({ brand_id, ...body }) =>
    brand_id === undefined ? body : { ...body, brand_ids: [brand_id.toLowerCase()] },
  );

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
 *
 * The meta fields (tm 309.1) belong to every type. None of them is a review:
 * `reviewed_at` moves only through `POST …/review`. So do the scope fields
 * (tm 309.2) — but a KB article's source takes its title, text and audiences
 * from the article (`KB_ARTICLE_OWNED`).
 */
const updateSourceBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(100_000).optional(),
    source_url: z.string().trim().min(1).max(2048).optional(),
    refresh_after_days: z.number().int().min(1).max(365).nullable().optional(),
    ...sourceMetaFields,
    ...sourceScopeFields,
    ...crawlSettingsFields,
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/**
 * What a KB article's source takes from the article (AI-14-S2): its title,
 * text and audiences, and — since the KB is the whole workspace's — every AI
 * agent, every brand and no end. An edit of one of these here would be undone
 * by the article's next save, or would outlive it, so it is refused and the
 * article named instead. Its meta fields (owner, language, review interval)
 * are the store's to edit.
 */
const KB_ARTICLE_OWNED = [
  'name',
  'content',
  'source_url',
  'refresh_after_days',
  'audiences',
  'ai_agent_ids',
  'brand_ids',
  'valid_until',
] as const;

/**
 * `?owner_id=&stale=` on the source list (tm 309.1), `?audience=&brand_id=`
 * (tm 309.2). `brand_id` lists what that brand's conversations draw on: its
 * own sources and the every-brand ones.
 */
const listSourcesQuery = z.object({
  owner_id: uuid.optional(),
  stale: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  audience: z.enum(KNOWLEDGE_LIST_AUDIENCES).default(DEFAULT_KNOWLEDGE_LIST_AUDIENCE),
  brand_id: uuid.optional(),
});

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

// The empty state's form (tm 390.1): a name, and optionally the persona's
// tone, face and languages. Strict, unlike the PATCH: a create that drops a
// key it does not know (`active`, `instruction`) would answer 201 for a
// request it did not carry out.
const createAgentBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    tone: z.string().trim().max(40).nullable().optional(),
    avatar_url: z.string().trim().max(2048).nullable().optional(),
    languages: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  })
  .strict();

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
    // The persona's style (tm 299.1 · AI-07); null clears it.
    address_form: z.enum(ADDRESS_FORMS).nullable().optional(),
    emoji: z.enum(EMOJI_USES).nullable().optional(),
    max_questions_per_message: z
      .number()
      .int()
      .min(MAX_QUESTIONS_PER_MESSAGE_MIN)
      .max(MAX_QUESTIONS_PER_MESSAGE_MAX)
      .nullable()
      .optional(),
    // The opening words and the button's wording (tm 308 · AI-29); null or blank clears.
    welcome_message: z.string().max(AI_WELCOME_MESSAGE_MAX).nullable().optional(),
    human_button_label: z.string().max(HUMAN_BUTTON_LABEL_MAX).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const noAnswerPolicy = z.enum(NO_ANSWER_POLICIES).optional();

const triggerCount = (bounds: { min: number; max: number }) =>
  z.number().int().min(bounds.min).max(bounds.max).optional();

/** A trigger's fields: any of them alone, at least one (AI-09-S2). */
function triggerFields<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'at least one field is required')
    .optional();
}

/**
 * A locked trigger may be named only to say it stays on: `{ enabled: true }`.
 * Turning one off is refused before this schema runs (`refuseLockedTriggerOff`).
 */
const LOCKED_TRIGGER_SHAPE = Object.fromEntries(
  LOCKED_HANDOFF_REASONS.filter((reason) => reason !== 'abuse').map((reason) => [
    reason,
    z
      .object({ enabled: z.literal(true) })
      .strict()
      .optional(),
  ]),
);

/** The triggers a PUT changes; the ones left out keep their value (tm 303.1 · AI-09). */
const handoffTriggersBody = z
  .object({
    not_understood: triggerFields({
      enabled: z.boolean().optional(),
      turns: triggerCount(HANDOFF_TRIGGER_BOUNDS.not_understood_turns),
      ask_first: z.boolean().optional(),
    }),
    negative_sentiment: triggerFields({
      enabled: z.boolean().optional(),
      consecutive: triggerCount(HANDOFF_TRIGGER_BOUNDS.negative_sentiment_consecutive),
      ask_first: z.boolean().optional(),
    }),
    // G19 is locked; only how many warnings come first is the workspace's.
    abuse: triggerFields({
      enabled: z.literal(true).optional(),
      warnings: triggerCount(HANDOFF_TRIGGER_BOUNDS.abuse_warnings),
    }),
    loop_detected: triggerFields({ enabled: z.boolean().optional() }),
    max_turns: triggerFields({
      enabled: z.boolean().optional(),
      turns: triggerCount(HANDOFF_TRIGGER_BOUNDS.max_turns),
    }),
    repeat_same_day: triggerFields({ enabled: z.boolean().optional() }),
    ...LOCKED_TRIGGER_SHAPE,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one trigger is required');

/** The messages a PUT writes, by reason; null goes back to the default. */
const handoffMessagesBody = z
  .object(
    Object.fromEntries(
      HANDOFF_MESSAGE_REASONS.map((reason) => [
        reason,
        z.string().trim().min(1).max(HANDOFF_MESSAGE_MAX).nullable().optional(),
      ]),
    ),
  )
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one message is required');

/**
 * 400 `handoff_trigger_locked` for a request that turns a locked trigger off
 * (AI-09 KK: "Kilitli tetikleyiciler API'den kapatılamaz") — named apart from a
 * malformed body so the panel can say why.
 */
function refuseLockedTriggerOff(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const triggers = (body as Record<string, unknown>)['triggers'];
  if (triggers === null || typeof triggers !== 'object') return;
  for (const [trigger, fields] of Object.entries(triggers as Record<string, unknown>)) {
    if (!isLockedHandoffReason(trigger)) continue;
    const enabled =
      fields !== null && typeof fields === 'object'
        ? (fields as Record<string, unknown>)['enabled']
        : undefined;
    if (enabled !== undefined && enabled !== true) {
      throw ApiError.validation(`${trigger} is a locked trigger and cannot be turned off.`, {
        reason: HANDOFF_TRIGGER_LOCKED_REASON,
        trigger,
      });
    }
  }
}

/** Any field alone; the ones left out keep their value (tm 293.6, tm 298, tm 303.1). */
const handoffSettingsBody = z
  .object({
    assignment_mode: z.enum(AI_ASSIGNMENT_MODES).optional(),
    ai_stall_timeout_seconds: z
      .number()
      .int()
      .min(AI_STALL_TIMEOUT_SECONDS_MIN)
      .max(AI_STALL_TIMEOUT_SECONDS_MAX)
      .optional(),
    // The groups sent change; the rest keep their policy (AI-06).
    no_answer: z
      .object({
        policy_by_category: z
          .object({
            money: noAnswerPolicy,
            account: noAnswerPolicy,
            bonus: noAnswerPolicy,
            rg: noAnswerPolicy,
            other: noAnswerPolicy,
          })
          .strict()
          .refine((policies) => Object.keys(policies).length > 0, 'at least one group is required')
          .optional(),
        text: z.string().trim().min(1).max(NO_ANSWER_TEXT_MAX).nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'at least one field is required')
      .optional(),
    triggers: handoffTriggersBody.optional(),
    messages: handoffMessagesBody.optional(),
    after_hours: z
      .object({ text: z.string().trim().min(1).max(HANDOFF_MESSAGE_MAX).nullable() })
      .strict()
      .optional(),
    // The default "resolved" criteria (tm 303.4 · K9): a condition, judged by
    // `validateResolutionCriteria` in the handler; null is the platform's.
    resolution_criteria: z.record(z.unknown()).nullable().optional(),
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
  context: { locked?: Procedure; placeholders?: ReadonlySet<string> } = {},
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
    ...(context.locked ? { locked: context.locked } : {}),
    ...(context.placeholders ? { placeholders: context.placeholders } : {}),
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
    accessInfoHttp,
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
    /**
     * How the access information's `dynamic_url` is fetched (tm 310.4 · K13).
     * Omitted, the real safe client (`lib/safe-fetch.ts`); a test passes one
     * pinned to a local HTTPS fake.
     */
    accessInfoHttp?: SafeHttp;
  },
): Promise<void> {
  // The same provider and limits as the live path, for the reason the preview
  // shares the engine at all: a preview that answers differently is worse than
  // none (FR-MOD-06.2.5).
  const tableFacts = new KnowledgeTableFacts();
  const engine = new ConversationEngine({
    knowledge,
    llm,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxPromptChars: env.LLM_MAX_PROMPT_CHARS,
    facts: tableFacts,
    tables: tableFacts,
    access: new AccessInfoResolver({ fetcher: createAccessInfoFetcher(accessInfoHttp) }),
  });
  const procedureExamples = new ProcedureExamples();
  /** Where an uploaded PDF or Word document is (tm 313 · AI-18), and who signs its download link. */
  const documents = createObjectStore(env.STORAGE_PROVIDER, env.storage);
  const downloads = new KnowledgeDownloadSigner(env.UPLOAD_SIGNING_KEY);

  /** After a procedure skill's save commits: its examples embedded and stored (`storeProcedureExamples`). */
  function storeExamples(
    request: FastifyRequest,
    skill: { id: string; mode: string; examples: string[] },
  ): Promise<void> {
    return storeProcedureExamples(request, knowledge, procedureExamples, skill);
  }

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

  // The workspace's customer-facing agent (tm 390.1) — the Playbook's empty
  // state. One per workspace in v1, held by the partial unique index
  // `ai_agents_one_per_license` rather than a read-then-write, so two tabs
  // creating at once get one agent and one 409. Created switched off: going
  // live is the PATCH below, behind the crisis-text gate.
  app.post(
    '/ai-agents',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(createAgentBody, request.body);
      const tenant = request.tenant();
      try {
        const created = await request.withTenant(async (tx) => {
          const agent = await createAiAgentDraft(
            tx,
            configAuthorOf(request),
            {
              licenseId: tenant.licenseId,
              kind: 'ai_agent',
              name: body.name,
              active: false,
              ...(body.tone !== undefined ? { tone: body.tone } : {}),
              ...(body.avatar_url !== undefined ? { avatarUrl: body.avatar_url } : {}),
              ...(body.languages !== undefined ? { languages: body.languages } : {}),
            },
            { _count: { select: { skills: true } } },
          );
          return { ...serialiseAgent(agent), readiness: await agentReadiness(tx, agent) };
        });
        return reply.status(201).send(created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ApiError('ai_agent_exists', 'This workspace already has an AI agent.');
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.aiAgentId);
      const detail = await request.withTenant(async (tx) => {
        const agent = await tx.aiAgent.findFirst({
          where: { id },
          include: { _count: { select: { skills: true } } },
        });
        if (!agent) throw ApiError.notFound('AI agent not found.');
        return { ...serialiseAgent(agent), readiness: await agentReadiness(tx, agent) };
      });
      return reply.send(detail);
    },
  );

  app.patch<{ Params: { aiAgentId: string } }>(
    '/ai-agents/:aiAgentId',
    // An agent's broad PAT carries the scope; the role gate refuses it (tm 390.1).
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const id = parse(uuid, request.params.aiAgentId);
      const body = parse(updateAgentBody, request.body);

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.aiAgent.findFirst({
          where: { id },
          select: { id: true, kind: true, active: true, persona: true },
        });
        if (!existing) throw ApiError.notFound('AI agent not found.');

        // The guardrail gate (AI-08-S1 · tm 301.2): a customer-facing agent
        // goes live only once the Founder has approved its crisis text — the
        // text G3 sends a player at risk, whatever the hour. Only switching it
        // on is gated; an agent already live keeps answering, and Copilot never
        // talks to a player.
        if (body.active === true && !existing.active && existing.kind === 'ai_agent') {
          const settings = await tx.aiGuardrailSettings.findUnique({
            where: { aiAgentId: id },
            select: { crisisText: true, approvedAt: true },
          });
          const problem = guardrailSetupProblem(settings);
          if (problem) {
            throw new ApiError(
              'ai_guardrail_setup_incomplete',
              problem === 'crisis_text_missing'
                ? 'Write the crisis text in the guardrail settings and approve it before switching the AI agent on.'
                : 'The crisis text has not been approved by the owner; approve it before switching the AI agent on.',
              { details: { reason: problem } },
            );
          }
        }

        // `answer_length`, `batch_window_seconds`, `daily_memory`,
        // `clarify_thresholds` and the style (tm 299.1) live inside the persona JSON alongside anything else an admin has set (a
        // signature, say), so merge rather than overwrite — clearing one
        // removes just that key.
        let persona: Prisma.InputJsonValue | undefined;
        if (
          body.answer_length !== undefined ||
          body.batch_window_seconds !== undefined ||
          body.daily_memory !== undefined ||
          body.clarify_thresholds !== undefined ||
          body.address_form !== undefined ||
          body.emoji !== undefined ||
          body.max_questions_per_message !== undefined ||
          body.welcome_message !== undefined ||
          body.human_button_label !== undefined
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
          const style: Array<[string, unknown]> = [
            ['addressForm', body.address_form],
            ['emoji', body.emoji],
            ['maxQuestionsPerMessage', body.max_questions_per_message],
          ];
          for (const [key, value] of style) {
            if (value === null) delete next[key];
            else if (value !== undefined) next[key] = value;
          }
          const words: Array<[string, string | null | undefined]> = [
            ['welcome', body.welcome_message],
            ['humanButtonLabel', body.human_button_label],
          ];
          for (const [key, value] of words) {
            if (value === undefined) continue;
            const text = value?.trim() ?? '';
            if (text === '') delete next[key];
            else next[key] = text;
          }
          persona = next as Prisma.InputJsonValue;
        }

        return updateAiAgentDraft(
          tx,
          configAuthorOf(request),
          id,
          {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.tone !== undefined ? { tone: body.tone } : {}),
            ...(body.avatar_url !== undefined ? { avatarUrl: body.avatar_url } : {}),
            ...(body.languages !== undefined ? { languages: body.languages } : {}),
            ...(persona !== undefined ? { persona } : {}),
          },
          { _count: { select: { skills: true } } },
        );
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
      refuseLockedTriggerOff(request.body);
      const body = parse(handoffSettingsBody, request.body);
      const criteria = body.resolution_criteria
        ? requireResolutionCriteria(body.resolution_criteria)
        : null;
      const tenant = request.tenant();
      const settings = await request.withTenant(async (tx) => {
        await customerFacingAgent(tx, id);
        // `no_answer`, the triggers and the messages are merged over what is
        // stored, under the row the upsert then writes: what a write leaves
        // out keeps its value.
        const stored =
          body.no_answer || body.triggers || body.messages
            ? await tx.aiHandoffSettings.findUnique({
                where: { aiAgentId: id },
                select: { noAnswer: true, triggers: true, messages: true },
              })
            : null;
        const fields = {
          ...(body.assignment_mode !== undefined ? { assignmentMode: body.assignment_mode } : {}),
          ...(body.ai_stall_timeout_seconds !== undefined
            ? { aiStallTimeoutSeconds: body.ai_stall_timeout_seconds }
            : {}),
          ...(body.no_answer
            ? {
                noAnswer: mergeNoAnswer(
                  stored?.noAnswer ?? null,
                  body.no_answer,
                ) as unknown as Prisma.InputJsonObject,
              }
            : {}),
          ...(body.triggers
            ? {
                triggers: mergeHandoffTriggers(
                  stored?.triggers ?? null,
                  body.triggers,
                ) as unknown as Prisma.InputJsonObject,
              }
            : {}),
          ...(body.messages
            ? {
                messages: storedHandoffMessages(
                  mergeHandoffMessages(stored?.messages ?? null, body.messages),
                ),
              }
            : {}),
          ...(body.after_hours ? { afterHours: { text: body.after_hours.text } } : {}),
          ...(body.resolution_criteria !== undefined
            ? {
                resolutionCriteria:
                  criteria === null
                    ? Prisma.DbNull
                    : (criteria as unknown as Prisma.InputJsonObject),
              }
            : {}),
        };
        return upsertHandoffSettingsDraft(
          tx,
          configAuthorOf(request),
          { aiAgentId: id, licenseId: tenant.licenseId, ...fields },
          fields,
          HANDOFF_SETTINGS_SELECT,
        );
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
      const created = await createSkillDraft(tx, configAuthorOf(request), {
        ...(definition as Pick<Prisma.SkillUncheckedCreateInput, 'mode' | 'whenToUse'>),
        licenseId: tenant.licenseId,
        name: body.name,
        kind: 'ai_agent',
        ...(body.ai_agent_id ? { aiAgentId: body.ai_agent_id } : {}),
        ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
        steps: (await withStepTeamIds(tx, steps)) as object,
        ...(body.is_fallback !== undefined ? { isFallback: body.is_fallback } : {}),
        // Never live on creation.
        active: false,
        createdBy,
      });

      return { created, createdByName: await creatorName(tx, createdBy) };
    });
    await storeExamples(request, created);

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
        // The lock is the copy's template's (ADR `ai-template-catalog.md` §2.4).
        const locked = isLockedCopy(existing);
        if (locked && body.active === false) throw templateLocked('switched off');
        if (locked && mode !== existing.mode) {
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
        // A template copy's texts may hold its placeholders until they are
        // replaced; a locked copy may change only its texts and its team:
        // judged against the definition as stored.
        const placeholders = copyPlaceholders(existing.templateKey);
        const lockedAs =
          locked && existing.mode === 'procedure'
            ? validateSkillProcedure(stored, placeholders ? { placeholders } : {})
            : null;
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
              {
                ...(lockedAs?.ok ? { locked: lockedAs.procedure } : {}),
                ...(placeholders ? { placeholders } : {}),
              },
            )
          : {};

        // A copy goes on only filled in and routed (AI-15 §3–§4); an edit to
        // one that is on is held to the same.
        if (
          existing.templateKey !== null &&
          mode === 'procedure' &&
          (body.active ?? existing.active) &&
          (body.active === true || writesDefinition)
        ) {
          const problem = await templatePublishProblem(tx, {
            templateKey: existing.templateKey,
            whenToUse:
              definition.whenToUse !== undefined
                ? (definition.whenToUse as string | null)
                : existing.whenToUse,
            slots: definition.slots ?? existing.slots,
            procedure: definition.procedure ?? existing.procedure,
          });
          if (problem) refuseTemplatePublish(problem);
        }

        if (body.is_fallback === true && !existing.isFallback) {
          await requireFallbackFree(tx, existing.aiAgentId, existing.id);
        }

        // The rows describe the examples as they were; a new set is embedded
        // after this commits, and until then the skill is never narrowed away.
        // A procedure with none in the provider's space — saved before the
        // narrowing, while the provider failed, or in another space — gets
        // them on any save.
        const changed =
          mode !== existing.mode ||
          (body.examples !== undefined &&
            JSON.stringify(definition.examples ?? existing.examples) !==
              JSON.stringify(existing.examples));
        if (changed) await procedureExamples.clear(tx, id);
        const reembed =
          changed ||
          (mode === 'procedure' &&
            (await tx.aiProcedureExample.findFirst({
              where: { skillId: id, embeddingSpace: knowledge.space },
              select: { id: true },
            })) === null);

        const updated = await updateSkillDraft(tx, configAuthorOf(request), id, {
          ...definition,
          ...(body.is_fallback !== undefined ? { isFallback: body.is_fallback } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.instruction !== undefined ? { instruction: body.instruction } : {}),
          ...(steps !== undefined ? { steps: (await withStepTeamIds(tx, steps)) as object } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        });

        return { updated, createdByName: await creatorName(tx, updated.createdBy), reembed };
      });
      if (result.reembed) await storeExamples(request, result.updated);

      return reply.send(serialiseSkill(result.updated, result.createdByName));
    },
  );

  app.delete<{ Params: { skillId: string } }>(
    '/skills/:skillId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.skillId);
      const deleted = await request.withTenant(async (tx) => {
        const existing = await tx.skill.findFirst({
          where: { id },
          select: { locked: true, templateKey: true },
        });
        if (existing && isLockedCopy(existing)) throw templateLocked('deleted');
        const count = await deleteSkillDraft(tx, configAuthorOf(request), id);
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
            thread_id: run.threadId,
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
    const query = parse(listSourcesQuery, request.query ?? {});
    const now = new Date();
    const items = await request.withTenant(async (tx) => {
      const sources = await tx.knowledgeSource.findMany({
        // The one store, by audience (ADR §2.7). Without `?audience=` it is the
        // sources the AI agent answers players from — what this list has
        // always meant to the apps already installed; `all` is the whole store.
        where: {
          // A structured-table row's source is the row's (tm 310.2): it is
          // listed, edited and reviewed as the row, under /knowledge-tables.
          type: { not: KNOWLEDGE_TABLE_SOURCE_TYPE },
          ...(query.audience === 'all' ? {} : { audiences: { has: query.audience } }),
          ...(query.brand_id === undefined
            ? {}
            : { OR: [{ brandIds: { isEmpty: true } }, { brandIds: { has: query.brand_id } }] }),
          ...(query.owner_id === undefined ? {} : { ownerId: query.owner_id }),
        },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { chunks: true } }, jobs: ACTIVE_JOB },
      });
      // Due a review is arithmetic on two columns, and the list is unpaged, so
      // it is decided here, with the same function the reply's
      // `review_due_at` comes from — the filter and the badge cannot disagree.
      const listed =
        query.stale === undefined
          ? sources
          : sources.filter(
              (s) => isKnowledgeReviewDue(s.reviewedAt, s.reviewIntervalDays, now) === query.stale,
            );
      const names = await creatorNamesByIds(
        tx,
        listed.flatMap((s) => [s.addedBy, s.ownerId]),
      );
      return listed.map((s) => serialiseStoredSource(s, names));
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
      const meta = sourceMetaData(body);
      const scoped = sourceScopeData(body);

      // The agent, the owner and the scope first (tm 257.20): a request that
      // will write nothing must not crawl a website or spend the day's AI
      // allowance on its way to a 400.
      await request.withTenant(async (tx) => {
        await requireAiAgent(tx, body.ai_agent_id);
        await requireMember(tx, body.owner_id);
        await requireSourceScope(tx, body);
      });

      // A website is not fetched in the request (tm 312.3 · AI-17): the URL
      // passes the SSRF guard here — a private/internal target is a 400 with
      // nothing written — and its crawl is a job the runner works through after
      // the 201 (`services/ai/crawler/job-runner.ts`), every fetch guarded again.
      const content = body.type === 'website' ? '' : (body.content ?? '');
      const sourceUrl =
        body.type === 'website' ? assertPublicHttpUrl(body.source_url ?? '').toString() : null;

      // Embedded before the transaction: the provider is a network call with
      // its own timeout (tm 255.7). A refusal is a 503 with nothing written; a
      // call today's AI cap cannot take is a 429 `ai_daily_cap` with nothing
      // written (tm 257.20). A website's pages are embedded by its job.
      const prepared =
        body.type === 'website'
          ? null
          : await knowledge.prepare(content, tenant).catch(refuseUnembeddable);

      const created = await request.withTenant(async (tx) => {
        // Again inside the write: the agent may have been deleted meanwhile,
        // and the owner may have left.
        const agent = await requireAiAgent(tx, body.ai_agent_id);
        await requireMember(tx, body.owner_id);
        await requireSourceScope(tx, body);

        const addedBy = principal.kind === 'agent' ? principal.accountId : null;
        const source = await createKnowledgeSourceDraft(
          tx,
          configAuthorOf(request),
          createScope(agent, body),
          {
            licenseId: tenant.licenseId,
            type: body.type,
            name: body.name,
            content,
            sourceUrl,
            status: prepared === null ? 'crawling' : 'indexing',
            addedBy,
            ...meta,
            ...scoped,
            ...(body.type === 'website' ? websiteCrawlSettings(body) : {}),
          },
        );
        const names = await creatorNamesByIds(tx, [addedBy, source.ownerId]);

        // A website's crawl is queued in the same transaction as the source:
        // a source that says `crawling` always has the job that will end it.
        if (prepared === null) {
          const job = await enqueueKnowledgeJob(tx, {
            context: tenant,
            sourceId: source.id,
            kind: 'crawl',
            requestedBy: addedBy,
          });
          return { source, chunks: 0, jobId: job.id, names };
        }

        // Indexed in the same transaction: a source that exists but is not
        // searchable looks ready and answers nothing.
        const chunks = await knowledge.index(tx, tenant, source.id, prepared);
        return { source, chunks, jobId: null, names };
      });

      if (created.jobId !== null) {
        app.knowledgeJobs.wake();
        return reply
          .status(201)
          .send(
            serialiseSource(
              { ...created.source, jobs: [{ id: created.jobId }] },
              { status: 'crawling', chunks: 0 },
              created.names,
            ),
          );
      }
      return reply
        .status(201)
        .send(
          serialiseIndexedSource({ ...created.source, jobs: [] }, created.chunks, created.names),
        );
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
      const meta = sourceMetaData(body);
      const scoped = sourceScopeData(body);

      // The agent, the owner and the scope before the embedding (tm 257.20),
      // as on the endpoint above.
      await request.withTenant(async (tx) => {
        await requireAiAgent(tx, body.ai_agent_id);
        await requireMember(tx, body.owner_id);
        await requireSourceScope(tx, body);
      });

      const prepared = await knowledge.prepare(parsed.text, tenant).catch(refuseUnembeddable);

      const created = await request.withTenant(async (tx) => {
        const agent = await requireAiAgent(tx, body.ai_agent_id);
        await requireMember(tx, body.owner_id);
        await requireSourceScope(tx, body);

        const addedBy = principal.kind === 'agent' ? principal.accountId : null;
        const source = await createKnowledgeSourceDraft(
          tx,
          configAuthorOf(request),
          createScope(agent, body),
          {
            licenseId: tenant.licenseId,
            type: 'file',
            name: title,
            content: parsed.text,
            // A file has no URL. Storing the filename here would put a name
            // into a column every reader treats as a fetchable address.
            sourceUrl: null,
            status: 'indexing',
            addedBy,
            ...meta,
            ...scoped,
          },
        );

        const chunks = await knowledge.index(tx, tenant, source.id, prepared);

        return { source, chunks, names: await creatorNamesByIds(tx, [addedBy, source.ownerId]) };
      });

      // A file is indexed in this request; it has no job.
      return reply
        .status(201)
        .send(
          serialiseIndexedSource({ ...created.source, jobs: [] }, created.chunks, created.names),
        );
    },
  );

  /**
   * A PDF or Word document as a knowledge source (tm 313 · AI-18).
   *
   * Nothing is parsed here: a document is read by an isolated worker in a
   * `document` knowledge job, so the source is written `processing` together
   * with that job — a source that says `processing` always has the job that
   * will end it — and the answer is a 201 naming it. What this request does
   * is decide whether there is anything to read: the upload is this
   * workspace's document, stored, within the size, of the type its bytes say
   * (`readUploadedDocument`), and not a file the workspace already holds.
   *
   * The agent, owner and scope are checked before the object is read, and
   * again inside the write, as on the other creates.
   */
  app.post(
    '/knowledge-sources/document',
    { config: { scopes: WRITE, aiInference: true } },
    async (request, reply) => {
      const body = parse(documentSourceBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const title = body.name ?? titleFromFilename(body.filename ?? '');
      if (title === '') throw ApiError.validation('filename: a document needs a usable name.');
      const meta = sourceMetaData(body);
      const scoped = sourceScopeData(body);

      await request.withTenant(async (tx) => {
        await requireAiAgent(tx, body.ai_agent_id);
        await requireMember(tx, body.owner_id);
        await requireSourceScope(tx, body);
      });

      const document = await readUploadedDocument(documents, tenant.licenseId, body.upload_id);

      const created = await request
        .withTenant(async (tx) => {
          const agent = await requireAiAgent(tx, body.ai_agent_id);
          await requireMember(tx, body.owner_id);
          await requireSourceScope(tx, body);

          // One source per file per workspace. Looked for first so the answer
          // names the source; the unique index holds it under a race.
          const existing = await tx.knowledgeSource.findFirst({
            where: { fileSha256: document.sha256 },
            select: { id: true },
          });
          if (existing) throw knowledgeSourceExists(existing.id);

          const addedBy = principal.kind === 'agent' ? principal.accountId : null;
          const source = await createKnowledgeSourceDraft(
            tx,
            configAuthorOf(request),
            createScope(agent, body),
            {
              licenseId: tenant.licenseId,
              type: 'file',
              name: title,
              // A document's text is its chunks, written by its job.
              content: null,
              sourceUrl: null,
              status: 'processing',
              addedBy,
              fileKey: document.key,
              fileMime: document.mime,
              fileSize: document.size,
              fileSha256: document.sha256,
              ...meta,
              ...scoped,
            },
          );
          const job = await enqueueKnowledgeJob(tx, {
            context: tenant,
            sourceId: source.id,
            kind: 'document',
            requestedBy: addedBy,
          });
          return {
            source,
            jobId: job.id,
            names: await creatorNamesByIds(tx, [addedBy, source.ownerId]),
          };
        })
        .catch(async (error: unknown) => {
          if (!isDuplicateDocument(error)) throw error;
          const holder = await request.withTenant((tx) =>
            tx.knowledgeSource.findFirst({
              where: { fileSha256: document.sha256 },
              select: { id: true },
            }),
          );
          throw knowledgeSourceExists(holder?.id ?? null);
        });

      app.knowledgeJobs.wake();
      return reply
        .status(201)
        .send(
          serialiseSource(
            { ...created.source, jobs: [{ id: created.jobId }] },
            { status: 'processing', chunks: 0 },
            created.names,
          ),
        );
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
      const { filing, addedByName } = await request.withTenant(async (tx) => {
        const agent = await tx.aiAgent.findFirst({
          where: { id: body.ai_agent_id },
          select: { id: true, kind: true },
        });
        if (!agent) {
          throw ApiError.validation('That AI agent does not exist.', {
            reason: 'ai_agent_not_found',
          });
        }
        return { filing: agent, addedByName: await creatorName(tx, addedBy) };
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
              const source = await createKnowledgeSourceDraft(
                tx,
                configAuthorOf(request),
                knowledgeScopeOfFiling(filing),
                {
                  licenseId: tenant.licenseId,
                  type,
                  name,
                  content,
                  sourceUrl,
                  status: 'indexing',
                  addedBy,
                },
              );

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
      const meta = sourceMetaData(body);
      const scoped = sourceScopeData(body);

      const existing = await request.withTenant(async (tx) => {
        // Anywhere in the one store (tm 309.2): the list shows every audience.
        const found = await tx.knowledgeSource.findFirst({
          where: { id },
          select: {
            id: true,
            type: true,
            addedBy: true,
            refreshAfterDays: true,
            kbArticleId: true,
            sourceTable: true,
            sourceRowId: true,
            audiences: true,
            aiAgentIds: true,
          },
        });
        if (found?.kbArticleId) refuseKbArticleOwned(found.kbArticleId, body);
        if (found) refuseTableRowOwned(found);
        // The owner and the scope before the crawl and the embedding, like the
        // agent on create.
        if (found) {
          await requireMember(tx, body.owner_id);
          await requireSourceScope(tx, body);
        }
        return found;
      });
      // Under RLS a foreign source is simply not visible, so "does not exist"
      // and "belongs to another workspace" resolve to the same answer — 404,
      // never 403, which would confirm the id exists somewhere.
      if (!existing) throw ApiError.notFound('Knowledge source not found.');

      const isWebsite = existing.type === 'website';
      const principal = request.requirePrincipal();
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
      const crawlSetting = namedCrawlSetting(body);
      if (crawlSetting !== undefined && !isWebsite) {
        throw ApiError.validation(`${crawlSetting}: only a website source is crawled.`);
      }

      // A new URL is refused before the transaction when the SSRF guard says
      // so — a private or non-http target never touches the row — and crawled
      // by a job after the reply (tm 312.3): the pages in the store answer
      // until then.
      const text: string | null = body.content ?? null;
      const sourceUrl =
        body.source_url === undefined ? null : assertPublicHttpUrl(body.source_url).toString();
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
      // Who the source is for by audience and AI agent moves its filing too
      // (ADR §2.8.2); a field left out keeps what the source has.
      const rescope =
        body.audiences === undefined && body.ai_agent_ids === undefined
          ? undefined
          : {
              licenseId: tenant.licenseId,
              scope: {
                audiences: body.audiences ?? normalizeKnowledgeAudiences(existing.audiences),
                aiAgentIds: body.ai_agent_ids ?? existing.aiAgentIds,
              },
            };

      const updated = await request.withTenant(async (tx) => {
        await requireMember(tx, body.owner_id);
        await requireSourceScope(tx, body);
        const count = await updateKnowledgeSourceDraft(
          tx,
          configAuthorOf(request),
          id,
          {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(text === null ? {} : { content: text }),
            ...(sourceUrl === null ? {} : { sourceUrl, status: 'crawling' }),
            ...(refreshAfterDaysChanged ? { refreshAfterDays: body.refresh_after_days } : {}),
            ...(recomputeSchedule
              ? { nextRefreshAt: computeNextRefreshAt(effectiveRefreshAfterDays, now) }
              : {}),
            // Settings for the next crawl: nothing is fetched for them.
            ...(body.crawl_scope === undefined ? {} : { crawlScope: body.crawl_scope }),
            ...(body.page_limit === undefined ? {} : { pageLimit: body.page_limit }),
            ...(body.include_paths === undefined ? {} : { includePaths: body.include_paths }),
            ...(body.exclude_paths === undefined ? {} : { excludePaths: body.exclude_paths }),
            ...meta,
            ...scoped,
          },
          now,
          rescope,
        );
        // The row was there a moment ago; if it is gone now it was deleted
        // between the two statements, which is the same answer as never having
        // existed.
        if (count === 0) throw ApiError.notFound('Knowledge source not found.');

        // The new URL's crawl, queued with the edit; one already under way would
        // crawl the old one, so the edit waits for it (the whole write rolls back).
        if (sourceUrl !== null) {
          const job = await enqueueKnowledgeJob(tx, {
            context: tenant,
            sourceId: id,
            kind: 'crawl',
            requestedBy: principal.kind === 'agent' ? principal.accountId : null,
          });
          if (!job.created) throw knowledgeJobInProgress(job.id);
        }

        // The new chunks are written in the same transaction as the update, so
        // the source can never be readable as edited while still answering from
        // the text it replaced. Untouched text needs no rebuild — chunks hold
        // the content, not the title.
        const chunks =
          prepared === null
            ? await tx.knowledgeChunk.count({ where: { sourceId: id } })
            : await knowledge.index(tx, tenant, id, prepared);

        const source = await tx.knowledgeSource.findFirstOrThrow({
          where: { id },
          include: { jobs: ACTIVE_JOB },
        });
        return {
          source,
          chunks,
          names: await creatorNamesByIds(tx, [existing.addedBy, source.ownerId]),
        };
      });

      if (sourceUrl !== null) app.knowledgeJobs.wake();
      // A website says what its crawls left (`crawling`, `partial`…), not
      // what its chunk count suggests.
      return reply.send(
        isWebsite
          ? serialiseSource(
              updated.source,
              { status: updated.source.status, chunks: updated.chunks },
              updated.names,
            )
          : serialiseIndexedSource(updated.source, updated.chunks, updated.names),
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
          // Anywhere in the one store (tm 309.2), a KB article's source too:
          // its text is the article's as last mirrored, embedded again.
          where: { id },
          select: {
            id: true,
            type: true,
            sourceUrl: true,
            content: true,
            addedBy: true,
            refreshAfterDays: true,
            sourceTable: true,
            sourceRowId: true,
            fileKey: true,
          },
        }),
      );
      if (!existing) throw ApiError.notFound('Knowledge source not found.');
      refuseTableRowOwned(existing);

      // A website's refresh is its crawl, queued (tm 312.3) — the one already
      // under way when there is one — with the stored URL re-checked first,
      // not trusted from creation: a refusal writes nothing.
      if (existing.type === 'website') {
        const queued = await queueCrawl(request, id, existing.sourceUrl);
        return reply.send(serialiseStoredSource(queued.source, queued.names));
      }
      // A PDF or Word document is read again from its original by a
      // `document` job (tm 313 · AI-18): its text is its chunks, not
      // `content`, and embedding `content` again would empty it.
      if (existing.fileKey !== null) {
        const queued = await queueSourceJob(request, id, 'document');
        return reply.send(serialiseStoredSource(queued.source, queued.names));
      }
      const text = existing.content ?? '';
      // And embedded before the transaction too; a refusal keeps the stale
      // answer, exactly as a refused crawl does (tm 255.7).
      const prepared = await knowledge.prepare(text, tenant).catch(refuseUnembeddable);
      const now = new Date();

      const refreshed = await request.withTenant(async (tx) => {
        // Not a review (AI-14-S3): fetching the text again says nothing about
        // whether it is still right, so `reviewed_at` stays where it was.
        const count = await updateKnowledgeSourceDraft(
          tx,
          configAuthorOf(request),
          id,
          {
            content: text,
            lastRefreshError: null,
            nextRefreshAt: computeNextRefreshAt(existing.refreshAfterDays, now),
          },
          now,
          undefined,
          'reindex',
        );
        if (count === 0) throw ApiError.notFound('Knowledge source not found.');

        const chunks = await knowledge.index(tx, tenant, id, prepared);
        const source = await tx.knowledgeSource.findFirstOrThrow({
          where: { id },
          include: { jobs: ACTIVE_JOB },
        });
        return {
          source,
          chunks,
          names: await creatorNamesByIds(tx, [existing.addedBy, source.ownerId]),
        };
      });

      return reply.send(
        serialiseIndexedSource(refreshed.source, refreshed.chunks, refreshed.names),
      );
    },
  );

  /**
   * Queue a website source's crawl (tm 312.3 · AI-17), from the stored URL
   * re-checked by the SSRF guard first (NFR-S7) — the row is not the request
   * that created it. One under way is a 409 naming it; the panel follows the
   * job instead.
   */
  async function queueCrawl(
    request: FastifyRequest,
    id: string,
    storedUrl: string | null,
  ): Promise<{
    source: Parameters<typeof serialiseStoredSource>[0];
    names: ReadonlyMap<string, string>;
    created: boolean;
    jobId: string;
  }> {
    if (!storedUrl) throw ApiError.validation('This website source has no URL to crawl.');
    assertPublicHttpUrl(storedUrl);
    return queueSourceJob(request, id, 'crawl');
  }

  /**
   * Queue a source's job — a website's crawl, a document's read (tm 313 ·
   * AI-18) — or find the one already under way. A new job moves the source to
   * the status that says one is running (`crawling`, `processing`).
   */
  async function queueSourceJob(
    request: FastifyRequest,
    id: string,
    kind: 'crawl' | 'document',
  ): Promise<{
    source: Parameters<typeof serialiseStoredSource>[0];
    names: ReadonlyMap<string, string>;
    created: boolean;
    jobId: string;
  }> {
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const queued = await request.withTenant(async (tx) => {
      const job = await enqueueKnowledgeJob(tx, {
        context: tenant,
        sourceId: id,
        kind,
        requestedBy: principal.kind === 'agent' ? principal.accountId : null,
      });
      if (job.created) {
        await tx.knowledgeSource.updateMany({
          where: { id },
          data: { status: kind === 'crawl' ? 'crawling' : 'processing' },
        });
      }
      const source = await tx.knowledgeSource.findFirstOrThrow({
        where: { id },
        include: { _count: { select: { chunks: true } }, jobs: ACTIVE_JOB },
      });
      return {
        source,
        created: job.created,
        jobId: job.id,
        names: await creatorNamesByIds(tx, [source.addedBy, source.ownerId]),
      };
    });
    if (queued.created) app.knowledgeJobs.wake();
    return queued;
  }

  /**
   * The pages a website source's crawls found (tm 312.3 · AI-17), whatever
   * became of each — the detail drawer's table. Any other type has none.
   */
  app.get<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId/pages',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const query = parse(
        z.object({ status: z.enum(KNOWLEDGE_PAGE_STATUSES).optional() }),
        request.query ?? {},
      );
      const pages = await request.withTenant(async (tx) => {
        const source = await tx.knowledgeSource.findFirst({ where: { id }, select: { id: true } });
        if (!source) throw ApiError.notFound('Knowledge source not found.');
        return tx.knowledgePage.findMany({
          where: { sourceId: id, ...(query.status === undefined ? {} : { status: query.status }) },
          orderBy: { url: 'asc' },
        });
      });
      return reply.send({
        items: pages.map((page) => ({
          id: page.id,
          url: page.url,
          title: page.title,
          lang: page.lang,
          status: page.status,
          http_status: page.httpStatus,
          error: page.error,
          depth: page.depth,
          chunk_count: page.chunkCount,
          fetched_at: page.fetchedAt ? page.fetchedAt.toISOString() : null,
          changed_at: page.changedAt ? page.changedAt.toISOString() : null,
        })),
      });
    },
  );

  /**
   * A short-lived link to a document source's original (tm 313 · AI-18-S2) —
   * "Download original". The link needs no session (a browser following it
   * sends no bearer token), so it is narrow instead: this source's object,
   * this filename, five minutes (`GET /knowledge-files/:key`). A source with
   * no original — every type but a PDF or Word document — is a 404, as is
   * another workspace's (RLS), and the key is this workspace's by the row's
   * own CHECK.
   */
  app.get<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId/file',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const source = await request.withTenant((tx) =>
        tx.knowledgeSource.findFirst({
          where: { id },
          select: { name: true, fileKey: true, fileMime: true, fileSize: true },
        }),
      );
      const mime = normalizeKnowledgeDocumentMime(source?.fileMime);
      if (!source?.fileKey || mime === null || source.fileSize === null) {
        throw ApiError.notFound('This knowledge source has no original file.');
      }
      return reply.send(
        knowledgeFileLink(downloads, {
          key: source.fileKey,
          mime,
          size: source.fileSize,
          title: source.name,
        }),
      );
    },
  );

  /** "Crawl again" (tm 312.3 · AI-17): a website source's crawl, queued; 202 with the job. */
  app.post<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId/crawl',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const existing = await request.withTenant((tx) =>
        tx.knowledgeSource.findFirst({ where: { id }, select: { type: true, sourceUrl: true } }),
      );
      if (!existing) throw ApiError.notFound('Knowledge source not found.');
      if (existing.type !== 'website') {
        throw ApiError.validation('Only a website source is crawled.', {
          reason: 'knowledge_source_not_website',
        });
      }
      const queued = await queueCrawl(request, id, existing.sourceUrl);
      if (!queued.created) throw knowledgeJobInProgress(queued.jobId);
      const job = await request.withTenant((tx) =>
        tx.knowledgeJob.findFirstOrThrow({
          where: { id: queued.jobId },
          select: KNOWLEDGE_JOB_SELECT,
        }),
      );
      return reply.status(202).send(serialiseKnowledgeJob(job));
    },
  );

  /** A knowledge job's progress (tm 312.3 · AI-17) — the drawer polls it every 3 s. */
  app.get<{ Params: { jobId: string } }>(
    '/knowledge-jobs/:jobId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.jobId);
      const job = await request.withTenant((tx) =>
        tx.knowledgeJob.findFirst({ where: { id }, select: KNOWLEDGE_JOB_SELECT }),
      );
      if (!job) throw ApiError.notFound('Knowledge job not found.');
      return reply.send(serialiseKnowledgeJob(job));
    },
  );

  /**
   * Stop a job under way (tm 312.3 · AI-17). The runner's next write is
   * fenced out (its claim no longer holds a `running` job) and its fetch in
   * flight is dropped; the pages already indexed stay, and the source says
   * what it has. An ended job is answered as it is.
   */
  app.post<{ Params: { jobId: string } }>(
    '/knowledge-jobs/:jobId/cancel',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.jobId);
      const job = await request.withTenant(async (tx) => {
        const found = await tx.knowledgeJob.findFirst({
          where: { id },
          select: { sourceId: true },
        });
        if (!found) throw ApiError.notFound('Knowledge job not found.');
        const now = new Date();
        const { count } = await tx.knowledgeJob.updateMany({
          where: { id, status: { in: [...KNOWLEDGE_JOB_ACTIVE_STATUSES] } },
          data: { status: 'cancelled', leaseUntil: null, finishedAt: now, frontier: [] },
        });
        if (count > 0) await settleCrawledSource(tx, found.sourceId, now);
        return tx.knowledgeJob.findFirstOrThrow({ where: { id }, select: KNOWLEDGE_JOB_SELECT });
      });
      app.knowledgeJobs.abort(id);
      return reply.send(serialiseKnowledgeJob(job));
    },
  );

  /**
   * Review a source (tm 309.1 · AI-14-S3) — a person confirms it still holds.
   *
   * No body and no fetch: what is confirmed is the source as it stands, so
   * nothing is re-indexed and nothing the AI says changes. It is the one way
   * `reviewed_at` moves — an edit, a reindex and the freshness sweep's
   * re-crawl all leave it where it was, because none of them is a person
   * saying "this is still right". The source is found the way its edit and
   * reindex find it — anywhere in the one store (tm 309.2); a foreign or
   * unknown id is a 404.
   */
  app.post<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId/review',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const reviewed = await request.withTenant(async (tx) => {
        const existing = await tx.knowledgeSource.findFirst({
          where: { id },
          select: { id: true, sourceTable: true, sourceRowId: true },
        });
        if (existing) refuseTableRowOwned(existing);
        if (
          !existing ||
          (await reviewKnowledgeSourceDraft(tx, configAuthorOf(request), id)) === 0
        ) {
          throw ApiError.notFound('Knowledge source not found.');
        }
        const source = await tx.knowledgeSource.findFirstOrThrow({
          where: { id },
          include: { _count: { select: { chunks: true } }, jobs: ACTIVE_JOB },
        });
        return { source, names: await creatorNamesByIds(tx, [source.addedBy, source.ownerId]) };
      });

      return reply.send(serialiseStoredSource(reviewed.source, reviewed.names));
    },
  );

  app.delete<{ Params: { sourceId: string } }>(
    '/knowledge-sources/:sourceId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      let originalKey: string | null = null;
      const deleted = await request.withTenant(async (tx) => {
        // A KB article's source goes when the article is unpublished or its
        // AI is switched off (AI-14-S2); deleted here it would come back with
        // the article's next save.
        const mirror = await tx.knowledgeSource.findFirst({
          where: { id, OR: [{ kbArticleId: { not: null } }, { sourceTable: { not: null } }] },
          select: { kbArticleId: true, sourceTable: true, sourceRowId: true },
        });
        if (mirror?.kbArticleId) refuseKbArticleOwned(mirror.kbArticleId);
        // A table row's source goes with its row (tm 310.2).
        if (mirror) refuseTableRowOwned(mirror);
        // A PDF or Word document's original is removed after the delete
        // commits (tm 313.3); its key is read here, while the row exists.
        originalKey =
          (await tx.knowledgeSource.findFirst({ where: { id }, select: { fileKey: true } }))
            ?.fileKey ?? null;
        // Chunks cascade with the source; leaving them would keep answering
        // from text the admin believes they deleted.
        const count = await deleteKnowledgeSourceDraft(tx, configAuthorOf(request), id, {
          kbArticleId: null,
          sourceTable: null,
        });
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
      // After the commit: a store that does not answer must not undo a delete
      // the admin already has. The object it leaves is the orphan sweep's
      // (`knowledge-document-sweep.ts`), never a source's.
      if (originalKey !== null) {
        await documents.delete(originalKey).catch((error: unknown) => {
          request.log.warn({ err: error }, 'knowledge document original could not be removed');
        });
      }
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
 * `names` resolves `added_by` and `owner_id` ({@link creatorNamesByIds}).
 */
function serialiseIndexedSource(
  source: SourceRow,
  chunks: number,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return serialiseSource(source, { status: chunks > 0 ? 'ready' : 'empty', chunks }, names);
}

/** A source as it is stored — the list and a review — with its own status and chunk count. */
function serialiseStoredSource(
  source: SourceRow & { status: string; _count: { chunks: number } },
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return serialiseSource(source, { status: source.status, chunks: source._count.chunks }, names);
}

/** The columns every source reply reads. */
interface SourceRow {
  id: string;
  aiAgentId: string;
  name: string;
  type: string;
  sourceUrl: string | null;
  updatedAt: Date;
  addedBy: string | null;
  refreshAfterDays: number | null;
  nextRefreshAt: Date | null;
  lastRefreshError: string | null;
  language: string | null;
  ownerId: string | null;
  reviewedAt: Date;
  reviewIntervalDays: number;
  audiences: string[];
  aiAgentIds: string[];
  brandIds: string[];
  validUntil: Date | null;
  kbArticleId: string | null;
  crawlScope: string | null;
  pageLimit: number | null;
  includePaths: string[];
  excludePaths: string[];
  lastCrawledAt: Date | null;
  pageCount: number;
  fileMime: string | null;
  fileSize: number | null;
  fileSha256: string | null;
  /** The source's job under way, if any ({@link ACTIVE_JOB}). */
  jobs: ReadonlyArray<{ id: string }>;
}

/**
 * A source's job under way (tm 312 · AI-17) — `job_id` on every source reply.
 * At most one exists (`knowledge_jobs_one_active_per_source`).
 */
const ACTIVE_JOB = {
  where: { status: { in: [...KNOWLEDGE_JOB_ACTIVE_STATUSES] } },
  select: { id: true },
  take: 1,
} satisfies Prisma.KnowledgeSource$jobsArgs;

/**
 * A new website source's crawl settings, what the body left out filled in: a
 * single page, at most `KNOWLEDGE_PAGE_LIMIT.default` pages, every path.
 */
function websiteCrawlSettings(body: {
  crawl_scope?: (typeof CRAWL_SCOPES)[number];
  page_limit?: number;
  include_paths?: string[];
  exclude_paths?: string[];
}) {
  return {
    crawlScope: body.crawl_scope ?? DEFAULT_CRAWL_SCOPE,
    pageLimit: body.page_limit ?? KNOWLEDGE_PAGE_LIMIT.default,
    includePaths: body.include_paths ?? [],
    excludePaths: body.exclude_paths ?? [],
  };
}

function serialiseSource(
  source: SourceRow,
  indexed: { status: string; chunks: number },
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const nameOf = (accountId: string | null) =>
    accountId === null ? null : (names.get(accountId) ?? null);
  return {
    id: source.id,
    ai_agent_id: source.aiAgentId,
    name: source.name,
    type: source.type,
    status: indexed.status,
    source_url: source.sourceUrl,
    chunk_count: indexed.chunks,
    updated_at: source.updatedAt.toISOString(),
    added_by_name: nameOf(source.addedBy),
    refresh_after_days: source.refreshAfterDays,
    next_refresh_at: source.nextRefreshAt ? source.nextRefreshAt.toISOString() : null,
    last_refresh_error: source.lastRefreshError,
    language: source.language,
    owner_id: source.ownerId,
    owner_name: nameOf(source.ownerId),
    reviewed_at: source.reviewedAt.toISOString(),
    review_interval_days: source.reviewIntervalDays,
    review_due_at: knowledgeReviewDueAt(source.reviewedAt, source.reviewIntervalDays).toISOString(),
    audiences: source.audiences,
    ai_agent_ids: source.aiAgentIds,
    brand_ids: source.brandIds,
    valid_until: source.validUntil ? source.validUntil.toISOString() : null,
    kb_article_id: source.kbArticleId,
    // A website source added before tm 312 has no settings stored: it was a
    // single page, and the default limit is what it would be crawled under.
    crawl_scope: source.type === 'website' ? (source.crawlScope ?? DEFAULT_CRAWL_SCOPE) : null,
    page_limit:
      source.type === 'website' ? (source.pageLimit ?? KNOWLEDGE_PAGE_LIMIT.default) : null,
    include_paths: source.includePaths,
    exclude_paths: source.excludePaths,
    last_crawled_at: source.lastCrawledAt ? source.lastCrawledAt.toISOString() : null,
    page_count: source.pageCount,
    // A PDF or Word document's original (tm 313 · AI-18); null on the rest.
    file_mime: source.fileMime,
    file_size: source.fileSize,
    file_sha256: source.fileSha256,
    job_id: source.jobs[0]?.id ?? null,
  };
}

/**
 * A create's scope by audience and AI agent: what the body names, and where it
 * names nothing, the scope of the agent record it names — the AI agent's
 * source for the AI and Copilot, that agent alone; Copilot's for agents only.
 */
function createScope(
  agent: KnowledgeFiling,
  body: { audiences?: KnowledgeAudience[]; ai_agent_ids?: string[] },
): KnowledgeAudienceScope {
  const filed = knowledgeScopeOfFiling(agent);
  return {
    audiences: body.audiences ?? filed.audiences,
    aiAgentIds: body.ai_agent_ids ?? filed.aiAgentIds,
  };
}

/** The brand and end-date fields a body names, as columns; an omitted one is left alone. */
function sourceScopeData(body: { brand_ids?: string[]; valid_until?: string | null }): {
  brandIds?: string[];
  validUntil?: Date | null;
} {
  return {
    ...(body.brand_ids === undefined ? {} : { brandIds: body.brand_ids }),
    ...(body.valid_until === undefined
      ? {}
      : { validUntil: body.valid_until === null ? null : new Date(body.valid_until) }),
  };
}

/**
 * Refuse an `ai_agent_ids` entry that is not one of this workspace's AI agents
 * — the Copilot record included, which no AI agent search reads (ADR §2.3) —
 * and a `brand_ids` entry that is not one of its brands. Under RLS another
 * workspace's record is simply not there, so a stranger and an unknown id are
 * one answer: 400 with the id and `details.reason`.
 */
async function requireSourceScope(
  tx: TenantClient,
  body: { ai_agent_ids?: string[]; brand_ids?: string[] },
): Promise<void> {
  if (body.ai_agent_ids !== undefined && body.ai_agent_ids.length > 0) {
    const found = await tx.aiAgent.findMany({
      where: { id: { in: body.ai_agent_ids }, kind: 'ai_agent' },
      select: { id: true },
    });
    const known = new Set(found.map((agent) => agent.id));
    const unknown = body.ai_agent_ids.find((agentId) => !known.has(agentId));
    if (unknown !== undefined) {
      throw ApiError.validation(`ai_agent_ids: ${unknown} is not an AI agent of this workspace.`, {
        reason: 'knowledge_source_unknown_ai_agent',
        ai_agent_id: unknown,
      });
    }
  }
  if (body.brand_ids !== undefined && body.brand_ids.length > 0) {
    const found = await tx.brand.findMany({
      where: { id: { in: body.brand_ids } },
      select: { id: true },
    });
    const known = new Set(found.map((brand) => brand.id));
    const unknown = body.brand_ids.find((brandId) => !known.has(brandId));
    if (unknown !== undefined) {
      throw ApiError.validation(`brand_ids: ${unknown} is not a brand of this workspace.`, {
        reason: 'knowledge_source_unknown_brand',
        brand_id: unknown,
      });
    }
  }
}

/**
 * A KB article's source takes its title, text and audiences from the article
 * (AI-14-S2) and goes with it: changing one of those here, or deleting the
 * source, is refused with the article to go to instead. `body` absent: the
 * delete.
 */
function refuseKbArticleOwned(kbArticleId: string, body?: Record<string, unknown>): void {
  const field = body ? KB_ARTICLE_OWNED.find((key) => body[key] !== undefined) : undefined;
  if (body && field === undefined) return;
  throw ApiError.validation(
    field
      ? `${field}: this source is a published KB article's — edit the article instead.`
      : "This source is a published KB article's: unpublish the article, or switch its AI audiences off.",
    { reason: 'knowledge_source_from_kb_article', kb_article_id: kbArticleId },
  );
}

/**
 * A structured-table row's source (tm 310.2 · AI-13) holds the row's text and
 * meta fields, written by the row's writer alone: editing, reindexing,
 * reviewing or deleting it here is refused with the row to go to instead
 * (`/knowledge-tables/{table}/{rowId}`).
 */
function refuseTableRowOwned(source: {
  sourceTable: string | null;
  sourceRowId: string | null;
}): void {
  if (source.sourceTable === null) return;
  throw ApiError.validation(
    "This source is a structured table row's: change, review or delete the row instead.",
    {
      reason: 'knowledge_source_from_table_row',
      source_table: source.sourceTable,
      source_row_id: source.sourceRowId,
    },
  );
}

/**
 * The meta fields a body names, as columns — an omitted one is left alone
 * (the column default on a create). `language` keeps its primary subtag; a
 * value that is not a language tag is a 400 before anything is fetched.
 */
function sourceMetaData(body: {
  owner_id?: string | null;
  language?: string | null;
  review_interval_days?: number;
}): { ownerId?: string | null; language?: string | null; reviewIntervalDays?: number } {
  let language: string | null | undefined = body.language;
  if (typeof language === 'string') {
    language = normaliseLanguage(language);
    if (language === null) {
      throw ApiError.validation('language: expected a language tag such as "tr" or "en-GB".');
    }
  }
  return {
    ...(body.owner_id === undefined ? {} : { ownerId: body.owner_id }),
    ...(language === undefined ? {} : { language }),
    ...(body.review_interval_days === undefined
      ? {}
      : { reviewIntervalDays: body.review_interval_days }),
  };
}

/**
 * Refuse an `owner_id` that is not a member of this workspace. Under RLS an
 * account is visible only to a licence it works for, so a stranger and an
 * unknown id are one answer. No owner — omitted or null — needs no check.
 */
async function requireMember(tx: TenantClient, accountId: string | null | undefined) {
  if (accountId === null || accountId === undefined) return;
  const account = await tx.account.findFirst({ where: { id: accountId }, select: { id: true } });
  if (!account) {
    throw ApiError.validation('owner_id: that person is not a member of this workspace.');
  }
}

/** One shape for an AI agent, so a read and the reply after a PATCH never drift. */
const HANDOFF_SETTINGS_SELECT = {
  assignmentMode: true,
  aiStallTimeoutSeconds: true,
  noAnswer: true,
  triggers: true,
  messages: true,
  afterHours: true,
  resolutionCriteria: true,
} as const;

/** `AiHandoffSettings` (contract): an agent with no row has the defaults. */
function serialiseHandoffSettings(
  aiAgentId: string,
  row: {
    assignmentMode: string;
    aiStallTimeoutSeconds: number;
    noAnswer: unknown;
    triggers: unknown;
    messages: unknown;
    afterHours: unknown;
    resolutionCriteria: unknown;
  } | null,
): {
  ai_agent_id: string;
  assignment_mode: AiAssignmentMode;
  ai_stall_timeout_seconds: number;
  no_answer: AiNoAnswerSettings;
  triggers: HandoffTriggers;
  messages: HandoffMessages;
  after_hours: HandoffAfterHours;
  resolution_criteria: Cond | null;
} {
  return {
    ai_agent_id: aiAgentId,
    // The CHECK holds the column to `AI_ASSIGNMENT_MODES`.
    assignment_mode:
      (row?.assignmentMode as AiAssignmentMode | undefined) ?? DEFAULT_AI_ASSIGNMENT_MODE,
    ai_stall_timeout_seconds: row?.aiStallTimeoutSeconds ?? DEFAULT_AI_STALL_TIMEOUT_SECONDS,
    no_answer: readNoAnswerSettings(row?.noAnswer ?? null),
    triggers: readHandoffTriggers(row?.triggers ?? null),
    messages: readHandoffMessages(row?.messages ?? null),
    after_hours: readHandoffAfterHours(row?.afterHours ?? null),
    resolution_criteria: readResolutionCriteria(row?.resolutionCriteria ?? null),
  };
}

/** The default "resolved" criteria a PUT sends, or the procedure problem it is refused with (tm 303.4). */
function requireResolutionCriteria(value: unknown): Cond {
  const validated = validateResolutionCriteria(value);
  if (!validated.ok) throwProcedureProblem(validated.problems[0] as ProcedureProblem);
  return validated.criteria;
}

/** The stored `no_answer` with a PUT's groups and sentence over it (tm 298). */
function mergeNoAnswer(
  stored: unknown,
  change: {
    policy_by_category?: Partial<AiNoAnswerSettings['policy_by_category']>;
    text?: string | null;
  },
): AiNoAnswerSettings {
  const current = readNoAnswerSettings(stored);
  const policies = { ...current.policy_by_category };
  for (const [category, policy] of Object.entries(change.policy_by_category ?? {})) {
    if (policy) policies[category as keyof typeof policies] = policy;
  }
  return {
    policy_by_category: policies,
    text: change.text === undefined ? current.text : change.text,
  };
}

/**
 * What the agent still needs (`GET /ai-agents/{id}`, tm 390.1). `ready` is the
 * panel's rule (FR-MOD-06.1, PRD KK4 — `apps/web` `readiness.ts`, which reads
 * the same two lists): an indexed source the agent may answer players from
 * (`/knowledge-sources`' default list, narrowed to this agent) AND one of its
 * skills active with steps — a procedure's in its definition. The crisis-text
 * gate is reported apart: it refuses the switch, not the readiness.
 */
async function agentReadiness(
  tx: TenantClient,
  agent: { id: string; kind: string },
): Promise<{
  ready: boolean;
  has_knowledge: boolean;
  has_skill: boolean;
  guardrail_problem: GuardrailSetupProblem | null;
}> {
  // One after another: the three reads share the request's transaction.
  const source = await tx.knowledgeSource.findFirst({
    where: {
      type: { not: KNOWLEDGE_TABLE_SOURCE_TYPE },
      audiences: { has: 'ai_agent' },
      OR: [{ aiAgentIds: { isEmpty: true } }, { aiAgentIds: { has: agent.id } }],
      chunks: { some: {} },
    },
    select: { id: true },
  });
  const skills = await tx.skill.findMany({
    where: { aiAgentId: agent.id, kind: 'ai_agent', active: true },
    select: { mode: true, steps: true, procedure: true },
  });
  // Copilot never talks to a player, so no crisis text gates it.
  const guardrail =
    agent.kind === 'ai_agent'
      ? await tx.aiGuardrailSettings.findUnique({
          where: { aiAgentId: agent.id },
          select: { crisisText: true, approvedAt: true },
        })
      : undefined;
  const hasSteps = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
  const hasSkill = skills.some((skill) =>
    skill.mode === 'procedure'
      ? hasSteps(
          skill.procedure && typeof skill.procedure === 'object' && !Array.isArray(skill.procedure)
            ? (skill.procedure as Record<string, unknown>)['steps']
            : undefined,
        )
      : hasSteps(skill.steps),
  );
  const hasKnowledge = source !== null;
  return {
    ready: hasKnowledge && hasSkill,
    has_knowledge: hasKnowledge,
    has_skill: hasSkill,
    guardrail_problem: guardrail === undefined ? null : guardrailSetupProblem(guardrail),
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
  const style = readPersonaStyle(persona);
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
    address_form: style.addressForm,
    emoji: style.emoji,
    max_questions_per_message: style.maxQuestionsPerMessage,
    welcome_message: readAiWelcome(persona),
    human_button_label: readHumanButtonLabel(persona),
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
 * one answer. The record found is what a source is filed under.
 */
async function requireAiAgent(tx: TenantClient, aiAgentId: string): Promise<KnowledgeFiling> {
  const agent = await tx.aiAgent.findFirst({
    where: { id: aiAgentId },
    select: { id: true, kind: true },
  });
  if (!agent) throw ApiError.validation('That AI agent does not exist.');
  return agent;
}

export async function creatorName(
  tx: TenantClient,
  createdBy: string | null,
): Promise<string | null> {
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

export function serialiseSkill(
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
