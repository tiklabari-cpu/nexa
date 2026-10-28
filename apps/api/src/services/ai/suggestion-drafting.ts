/**
 * The suggestion drafts (tm 318.1 · SiyahTuş analysis AI-23 §2–§3, AI-23-S2) —
 * the scheduler's `ai_suggestion_drafts` job. Per workspace and pass:
 *
 *   1. **Open from a cluster** (AI-23-S2): an unresolved-questions cluster
 *      (AI-22) whose items agents went on to answer at least
 *      `SUGGESTION_CLUSTER_ANSWERS_MIN` times in the last
 *      `SUGGESTION_CLUSTER_WINDOW_DAYS` opens one `promote_agent_answer`
 *      suggestion (`source: unresolved_cluster`) with those answers as its
 *      excerpt — once per window. Never on every hand-over: that is the cost
 *      and the noise S2 decided against.
 *   2. **Draft** the suggestions still `drafting` — an offered answer
 *      (`promote_agent_answer`) and a "the AI lacked this" mark
 *      (`missing_info`): a general piece of knowledge written from what the
 *      agent said, without what was the player's own — their name, username,
 *      e-mail and phone, amounts, dates, times and reference numbers. The
 *      `fast` model writes it where it may run
 *      (`{ title, body, applies_to_intent, removed_specifics }`); the lexical
 *      generaliser ({@link generaliseSpecifics}) is the floor — with no model
 *      (`LLM_PROVIDER=mock`), a workspace whose content may not leave its
 *      region (NFR-C4), a spent allowance or a reply that is not one — and
 *      also the last pass over the model's text: a model that kept "ali123"
 *      does not get it into the draft. Then the AI-26 mask, as for every AI
 *      record.
 *   3. **Look for it** in the knowledge base (AI-23 §3): the draft's body is
 *      embedded and searched; passages at `SUGGESTION_DUPLICATE_SIMILARITY` or
 *      above are kept as `similar_chunk_ids` — the review's "the information
 *      is there; why did the AI not find it?". An embedding that fails or is
 *      refused leaves the list empty; the draft is written all the same.
 *
 * The suggestion is then `new`, in the reviewers' queue. The generalisation
 * is a proposal: a person reads, edits and accepts it (AI-23 "Riskler"), and a
 * policy amount the generaliser took is written back by them.
 *
 * Like the other structured calls the agent's words are one JSON line after
 * a marker at the end of the instructions.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  SUGGESTION_BODY_MAX,
  SUGGESTION_CLUSTER_ANSWERS_MIN,
  SUGGESTION_CLUSTER_WINDOW_DAYS,
  SUGGESTION_DRAFTS_PER_PASS,
  SUGGESTION_DUPLICATE_SIMILARITY,
  SUGGESTION_EXCERPT_TEXT_MAX,
  SUGGESTION_SIMILAR_CHUNKS_MAX,
  SUGGESTION_SPECIFIC_KINDS,
  SUGGESTION_SPECIFIC_PLACEHOLDERS,
  SUGGESTION_TITLE_MAX,
  unresolvedSpaceKind,
  type SuggestionExcerptMessage,
  type SuggestionKind,
  type SuggestionProposedChange,
  type SuggestionSpecificKind,
} from '@siyahtus/types';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from './inference.js';
import type { KnowledgeService } from './knowledge-service.js';
import { MeteredLlm } from './metered-llm.js';
import type { JsonSchema } from './provider/json-schema.js';
import {
  refuseOverlongPrompt,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmResponseFormat,
} from './provider/llm-provider.js';
import { completeStructured } from './provider/structured-output.js';
import { announceSuggestionCreated, readExcerpt } from './suggestions.js';

// ---------------------------------------------------------------------------
// The lexical generaliser
// ---------------------------------------------------------------------------

/** What a draft is generalised against: the player's own identity, when known. */
export interface KnownSpecifics {
  names?: readonly (string | null | undefined)[];
  usernames?: readonly (string | null | undefined)[];
  emails?: readonly (string | null | undefined)[];
}

export interface GeneralisedText {
  text: string;
  removed: SuggestionSpecificKind[];
}

const MONTHS =
  'ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik|january|february|march|april|may|june|july|august|september|october|november|december';
const CURRENCY = '(?:TL|TRY|₺|USDT|USDC|USD|EUR|€|\\$|BTC|ETH|lira|dolar|euro)';
const NUMBER = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d{1,9}(?:[.,]\\d{1,2})?';

/**
 * Each detector in the order it runs: a wider pattern first, so a date is
 * never half-taken by the amount after it. Every one is bounded — no nested
 * or adjacent unbounded quantifiers over the same characters.
 */
const DETECTORS: ReadonlyArray<{ kind: SuggestionSpecificKind; pattern: RegExp }> = [
  {
    kind: 'email',
    pattern: /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,5}/gu,
  },
  {
    kind: 'phone',
    pattern:
      /(?<![\p{L}\p{N}])(?:\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\p{N}])/gu,
  },
  {
    kind: 'date',
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{1,2}\\s{1,3}(?:${MONTHS})(?:\\s{1,3}\\d{4})?)(?![\\p{L}\\p{N}])`,
      'giu',
    ),
  },
  // No time-of-day detector: "09:00–18:00" is a policy's hours far more often
  // than a player's moment, and alone it identifies nobody. The model may
  // still say it left one out (`time`).
  {
    kind: 'amount',
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${CURRENCY}\\s?(?:${NUMBER})|(?:${NUMBER})\\s?${CURRENCY})(?![\\p{L}\\p{N}])`,
      'giu',
    ),
  },
  {
    // A reference: letters and digits with dashes, at least four digits
    // ("PPR-20261014-482913", "TX88812345"), or a bare run of six digits.
    kind: 'reference',
    pattern:
      /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}]{1,20}(?:-[\p{L}\p{N}]{1,20}){1,4}|\p{Lu}{1,6}\p{N}{6,20}|\p{N}{6,24})(?![\p{L}\p{N}])/gu,
  },
  {
    // A username: letters then digits ("ali123", "Mehmet_88"), or a handle.
    kind: 'username',
    pattern:
      /(?<![\p{L}\p{N}@])(?:@[\p{L}\p{N}_.]{2,30}|\p{L}[\p{L}_.]{1,30}\p{N}{1,8}[\p{L}\p{N}_]{0,10})(?![\p{L}\p{N}])/gu,
  },
];

/**
 * Crypto networks and the like are policy, not a player's: "TRC20" stays. A
 * token written all in capitals is never taken for a username.
 */
function isUsernameException(token: string): boolean {
  return token === token.toUpperCase();
}

const URL = /\bhttps?:\/\/[^\s<>"']{1,500}/giu;
const PROTECTED = '\uE000';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `text` without the player's specifics, each replaced by its placeholder
 * (`SUGGESTION_SPECIFIC_PLACEHOLDERS`), and the kinds it took. Links stay —
 * a policy's page is knowledge. Pure; linear in the text.
 */
export function generaliseSpecifics(text: string, known: KnownSpecifics = {}): GeneralisedText {
  const removed = new Set<SuggestionSpecificKind>();
  const links: string[] = [];
  let out = text.replace(URL, (url) => {
    links.push(url);
    return `${PROTECTED}${links.length - 1}${PROTECTED}`;
  });
  const literal = (
    values: readonly (string | null | undefined)[] | undefined,
    kind: SuggestionSpecificKind,
    words: boolean,
  ) => {
    for (const value of values ?? []) {
      const trimmed = value?.trim();
      if (!trimmed) continue;
      const parts = words ? trimmed.split(/\s+/u).filter((part) => part.length >= 3) : [trimmed];
      for (const part of parts) {
        const pattern = new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`,
          'giu',
        );
        out = out.replace(pattern, () => {
          removed.add(kind);
          return SUGGESTION_SPECIFIC_PLACEHOLDERS[kind];
        });
      }
    }
  };
  literal(known.emails, 'email', false);
  literal(known.usernames, 'username', false);
  literal(known.names, 'name', true);
  for (const { kind, pattern } of DETECTORS) {
    out = out.replace(pattern, (match) => {
      if (kind === 'username' && !match.startsWith('@') && isUsernameException(match)) return match;
      // A dashed word is a reference only with four digits in it ("e-posta" is not).
      if (kind === 'reference' && (match.match(/\p{N}/gu)?.length ?? 0) < 4) return match;
      removed.add(kind);
      return SUGGESTION_SPECIFIC_PLACEHOLDERS[kind];
    });
  }
  out = out.replace(/\uE000(\d{1,4})\uE000/gu, (_, index: string) => links[Number(index)] ?? '');
  return { text: out, removed: SUGGESTION_SPECIFIC_KINDS.filter((kind) => removed.has(kind)) };
}

function clean(text: string, max: number): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, max).trim();
}

/** The title the lexical draft gets: the body's first words, placeholders and all. */
export function lexicalTitle(body: string, kind: SuggestionKind): string {
  const sentence = body.split(/(?<=[.!?])\s/u)[0] ?? body;
  const words = sentence.split(/\s+/u).filter(Boolean).slice(0, 10).join(' ');
  const title = clean(words.replace(/[.!?:;,]+$/u, ''), SUGGESTION_TITLE_MAX);
  if (title) return title;
  return kind === 'missing_info' ? 'Eksik bilgi' : 'Ajan yanıtından bilgi';
}

export interface SuggestionDraft {
  change: SuggestionProposedChange;
  removed: SuggestionSpecificKind[];
  draftedBy: 'llm' | 'lexical';
}

/** A draft written without a model: the agent's words, generalised and masked. */
export function lexicalDraft(
  sourceText: string,
  kind: SuggestionKind,
  known: KnownSpecifics,
): SuggestionDraft | null {
  const general = generaliseSpecifics(sourceText, known);
  const body = clean(maskForWrite(general.text, 'agent').text, SUGGESTION_BODY_MAX);
  if (body === '') return null;
  return {
    change: { target: 'knowledge_snippet', title: lexicalTitle(body, kind), body, source_id: null },
    removed: general.removed,
    draftedBy: 'lexical',
  };
}

// ---------------------------------------------------------------------------
// The model's draft
// ---------------------------------------------------------------------------

/** `response_format.json_schema.name`. */
export const SUGGESTION_DRAFT_RESPONSE_NAME = 'suggestion_draft';

export const SUGGESTION_DRAFT_MARKER = '--- agent answer (JSON, last line) ---';

/** A title and a short body: its ceiling, in tokens. */
export const SUGGESTION_DRAFT_MAX_OUTPUT_TOKENS = 800;

/** What the model reads of the agent's words. */
export const SUGGESTION_DRAFT_SOURCE_MAX = 3000;

const DRAFT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short Turkish title for the knowledge.' },
    body: {
      type: 'string',
      description:
        "The general rule or information, in Turkish, without the player's name, username, amounts, dates or reference numbers.",
    },
    applies_to_intent: {
      type: 'string',
      description: 'What players ask when this applies, in a few words.',
    },
    removed_specifics: {
      type: 'array',
      items: { type: 'string', enum: SUGGESTION_SPECIFIC_KINDS },
      description: "The kinds of the player's own details that were left out.",
    },
  },
  required: ['title', 'body', 'applies_to_intent', 'removed_specifics'],
  additionalProperties: false,
};

export const SUGGESTION_DRAFT_RESPONSE_FORMAT: LlmResponseFormat = {
  name: SUGGESTION_DRAFT_RESPONSE_NAME,
  schema: DRAFT_SCHEMA,
};

export function buildSuggestionDraftPrompt(
  sourceText: string,
  kind: SuggestionKind,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const lines = [
    kind === 'missing_info'
      ? "A support agent of an online gaming site noted information the site's AI assistant lacked. Their words are below."
      : 'A support agent of an online gaming site answered a player well, and offered the answer to the AI assistant as knowledge. Their words are below.',
    "Rewrite them as general knowledge the assistant can use for every player: keep the policy, the rule and the steps; leave out everything that is this player's own — their name, username, e-mail, phone, amounts, dates, times and transaction or reference numbers.",
    'Write in Turkish. Reply with one JSON object: title, body, applies_to_intent, removed_specifics.',
    SUGGESTION_DRAFT_MARKER,
    JSON.stringify(sourceText.slice(0, SUGGESTION_DRAFT_SOURCE_MAX)),
  ];
  return {
    system: lines.join('\n'),
    messages: [{ role: 'user', content: 'Generalise this answer.' }],
  };
}

/**
 * The model's draft as the suggestion keeps it, or null when it is not one:
 * generalised again (a model can keep what it was told to drop), masked.
 */
export function readSuggestionDraftReply(
  value: unknown,
  known: KnownSpecifics,
): SuggestionDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply['title'] !== 'string' || typeof reply['body'] !== 'string') return null;
  const title = generaliseSpecifics(reply['title'], known);
  const body = generaliseSpecifics(reply['body'], known);
  const titleText = clean(maskForWrite(title.text, 'agent').text, SUGGESTION_TITLE_MAX);
  const bodyText = clean(maskForWrite(body.text, 'agent').text, SUGGESTION_BODY_MAX);
  if (titleText === '' || bodyText === '') return null;
  const said = Array.isArray(reply['removed_specifics']) ? reply['removed_specifics'] : [];
  const removed = new Set<SuggestionSpecificKind>([...title.removed, ...body.removed]);
  for (const kind of said) {
    if ((SUGGESTION_SPECIFIC_KINDS as readonly unknown[]).includes(kind)) {
      removed.add(kind as SuggestionSpecificKind);
    }
  }
  return {
    change: { target: 'knowledge_snippet', title: titleText, body: bodyText, source_id: null },
    removed: SUGGESTION_SPECIFIC_KINDS.filter((kind) => removed.has(kind)),
    draftedBy: 'llm',
  };
}

/**
 * What a drafted suggestion is written from: an offered answer's marked
 * agent messages (a cluster's: every agent message of its excerpt); a
 * "lacked this" mark's agent messages after the marked one, then its note.
 */
export function draftSourceOf(
  kind: SuggestionKind,
  excerpt: readonly SuggestionExcerptMessage[],
  note: string | null,
): string {
  const agentTexts = (messages: readonly SuggestionExcerptMessage[]) =>
    messages
      .filter((m) => m.author_type === 'agent')
      .map((m) => m.text.trim())
      .filter(Boolean);
  if (kind === 'promote_agent_answer') {
    const marked = agentTexts(excerpt.filter((m) => m.marked));
    return (marked.length > 0 ? marked : agentTexts(excerpt)).join('\n');
  }
  const at = excerpt.findIndex((m) => m.marked);
  const after = agentTexts(at === -1 ? [] : excerpt.slice(at + 1));
  return [...after, ...(note?.trim() ? [note.trim()] : [])].join('\n');
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface SuggestionDraftingLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const SILENT: SuggestionDraftingLogger = { info() {}, warn() {}, error() {} };

export interface SuggestionDraftingOptions {
  /** Searches the knowledge base for the draft; its embeddings are metered. */
  readonly knowledge: KnowledgeService;
  /** The model that drafts; `mock` drafts nothing (the lexical generaliser does). */
  readonly llm: LlmProvider | MeteredLlm;
  /** `LLM_MAX_OUTPUT_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_MAX_PROMPT_CHARS`. */
  readonly llmLimits: { maxOutputTokens: number; timeoutMs: number; maxPromptChars: number };
  readonly llmInference: InferenceProvider;
  readonly embeddingInference: InferenceProvider;
  /** The reviewers' badge (`ai_suggestion_created`); null where nothing listens. */
  readonly publisher: RealtimePublisher | null;
  readonly logger?: SuggestionDraftingLogger;
}

export interface SuggestionDraftTotals {
  tenants: number;
  opened: number;
  drafted: number;
  llm: number;
  duplicates: number;
}

interface PassState {
  llmCapped: boolean;
  embeddingCapped: boolean;
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

async function listTenants(db: PrismaClient): Promise<TenantContext[]> {
  const rows = await db.$queryRaw<TenantRow[]>`
    SELECT license_id, organization_id FROM retention_list_tenants()`;
  return rows.map((row) => ({ licenseId: row.license_id, organizationId: row.organization_id }));
}

const DAY = 24 * 3_600_000;

export class SuggestionDrafter {
  readonly #db: PrismaClient;
  readonly #options: SuggestionDraftingOptions;
  readonly #log: SuggestionDraftingLogger;

  constructor(db: PrismaClient, options: SuggestionDraftingOptions) {
    this.#db = db;
    this.#options = options;
    this.#log = options.logger ?? SILENT;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<{
    totals: SuggestionDraftTotals;
  }> {
    const now = options.now ?? new Date();
    const pass: PassState = { llmCapped: false, embeddingCapped: false };
    const totals: SuggestionDraftTotals = {
      tenants: 0,
      opened: 0,
      drafted: 0,
      llm: 0,
      duplicates: 0,
    };
    for (const tenant of await listTenants(this.#db)) {
      if (options.signal?.aborted) break;
      try {
        const result = await this.draftTenant(tenant, now, pass);
        totals.tenants += 1;
        totals.opened += result.opened;
        totals.drafted += result.drafted;
        totals.llm += result.llm;
        totals.duplicates += result.duplicates;
      } catch (error) {
        this.#log.error(
          {
            err: error,
            event: 'ai.suggestion_draft_failed',
            license_id: tenant.licenseId.toString(),
          },
          'suggestions could not be drafted; the next pass tries again',
        );
      }
    }
    return { totals };
  }

  /** One workspace's pass — steps 1–3 of the file header. */
  async draftTenant(
    tenant: TenantContext,
    now: Date,
    pass: PassState = { llmCapped: false, embeddingCapped: false },
  ): Promise<Omit<SuggestionDraftTotals, 'tenants'>> {
    const result = { opened: 0, drafted: 0, llm: 0, duplicates: 0 };
    const opened = await withTenant(this.#db, tenant, (tx) => openFromClusters(tx, tenant, now));
    result.opened = opened.length;
    for (const row of opened)
      await announceSuggestionCreated(this.#db, tenant, this.#options.publisher, row);

    const due = await withTenant(this.#db, tenant, (tx) =>
      tx.aiSuggestion.findMany({
        where: { status: 'drafting' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: SUGGESTION_DRAFTS_PER_PASS,
        select: {
          id: true,
          kind: true,
          chatId: true,
          aiAgentId: true,
          note: true,
          excerptMasked: true,
        },
      }),
    );
    if (due.length === 0) return result;
    const model =
      this.#options.llm.id !== 'mock' &&
      !pass.llmCapped &&
      (await this.#mayInfer(tenant, this.#options.llmInference));
    const searchable =
      !pass.embeddingCapped && (await this.#mayInfer(tenant, this.#options.embeddingInference));
    let workspaceCapped = false;

    for (const suggestion of due) {
      const kind = suggestion.kind as SuggestionKind;
      const excerpt = readExcerpt(suggestion.excerptMasked);
      const known = await withTenant(this.#db, tenant, (tx) =>
        knownSpecificsOf(tx, suggestion.chatId),
      );
      const source = draftSourceOf(kind, excerpt, suggestion.note);
      let draft: SuggestionDraft | null = null;
      if (source !== '' && model && !pass.llmCapped && !workspaceCapped) {
        try {
          draft = await this.#modelDraft(tenant, source, kind, known, suggestion.chatId);
        } catch (error) {
          if (error instanceof AiDailyCapError) {
            if (error.scope === 'workspace') workspaceCapped = true;
            else pass.llmCapped = true;
          } else {
            this.#log.warn(
              {
                err: error,
                event: 'ai.suggestion_model_draft_failed',
                license_id: tenant.licenseId.toString(),
              },
              'a suggestion could not be drafted by the model; the lexical draft stands',
            );
          }
        }
      }
      if (draft?.draftedBy === 'llm') result.llm += 1;
      draft ??= source === '' ? null : lexicalDraft(source, kind, known);

      const similar =
        draft && searchable && !pass.embeddingCapped
          ? await this.#similarChunks(tenant, draft.change.body, suggestion.chatId, pass)
          : [];
      if (similar.length > 0) result.duplicates += 1;

      const written = await withTenant(this.#db, tenant, (tx) =>
        tx.aiSuggestion.updateMany({
          where: { id: suggestion.id, status: 'drafting' },
          data: {
            status: 'new',
            ...(draft
              ? {
                  proposedChange: draft.change as unknown as Prisma.InputJsonObject,
                  removedSpecifics: draft.removed,
                  draftedBy: draft.draftedBy,
                }
              : {}),
            similarChunkIds: similar,
            updatedAt: new Date(),
          },
        }),
      );
      if (written.count > 0) result.drafted += 1;
    }
    return result;
  }

  async #modelDraft(
    tenant: TenantContext,
    source: string,
    kind: SuggestionKind,
    known: KnownSpecifics,
    chatId: string | null,
  ): Promise<SuggestionDraft | null> {
    const { llmLimits } = this.#options;
    // The model reads the agent's words generalised already: the player's
    // own details never leave for the provider.
    const prompt = buildSuggestionDraftPrompt(generaliseSpecifics(source, known).text, kind);
    refuseOverlongPrompt(prompt, llmLimits.maxPromptChars);
    const metered = MeteredLlm.wrap(this.#options.llm);
    const { value } = await completeStructured(
      metered.forTenant(tenant, { surface: 'coaching', chatId, configVersionId: null }),
      {
        ...prompt,
        maxOutputTokens: Math.min(llmLimits.maxOutputTokens, SUGGESTION_DRAFT_MAX_OUTPUT_TOKENS),
        timeoutMs: llmLimits.timeoutMs,
        tier: 'fast',
        responseFormat: SUGGESTION_DRAFT_RESPONSE_FORMAT,
      },
    );
    return readSuggestionDraftReply(value, known);
  }

  /** The knowledge passages at τ or above (AI-23 §3); empty on any failure. */
  async #similarChunks(
    tenant: TenantContext,
    body: string,
    chatId: string | null,
    pass: PassState,
  ): Promise<string[]> {
    const { knowledge } = this.#options;
    try {
      const query = await knowledge.embedQuery(body, tenant, {
        surface: 'coaching',
        chatId,
        configVersionId: null,
      });
      const threshold = SUGGESTION_DUPLICATE_SIMILARITY[unresolvedSpaceKind(query.space)];
      const found = await withTenant(this.#db, tenant, (tx) =>
        knowledge.search(tx, tenant, query, {
          reader: { audience: 'copilot' },
          limit: SUGGESTION_SIMILAR_CHUNKS_MAX,
        }),
      );
      return found.chunks.filter((chunk) => chunk.score >= threshold).map((chunk) => chunk.id);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        if (error.scope !== 'workspace') pass.embeddingCapped = true;
        return [];
      }
      this.#log.warn(
        {
          err: error,
          event: 'ai.suggestion_search_failed',
          license_id: tenant.licenseId.toString(),
        },
        'a suggestion could not be looked for in the knowledge base',
      );
      return [];
    }
  }

  /** Whether the workspace's content may go to `provider` (NFR-C4). */
  async #mayInfer(tenant: TenantContext, provider: InferenceProvider): Promise<boolean> {
    return withTenant(this.#db, tenant, async (tx) => {
      const residency = await readInferenceResidency(tx, tenant);
      return (
        residency !== null &&
        inferenceAllowed({
          provider,
          workspaceRegion: residency.region,
          hipaaScope: residency.hipaaScope,
        })
      );
    });
  }
}

/** The player's own name, username and e-mail, from the suggestion's chat while it exists. */
async function knownSpecificsOf(tx: TenantClient, chatId: string | null): Promise<KnownSpecifics> {
  if (chatId === null) return {};
  const chat = await tx.chat.findFirst({
    where: { id: chatId },
    select: { customer: { select: { name: true, username: true, email: true } } },
  });
  const customer = chat?.customer;
  if (!customer) return {};
  return { names: [customer.name], usernames: [customer.username], emails: [customer.email] };
}

/** A row the reviewers are told of. */
export interface OpenedSuggestion {
  id: string;
  aiAgentId: string;
  kind: SuggestionKind;
  teamId: bigint | null;
}

/**
 * Step 1 (AI-23-S2): the clusters agents kept answering, each opened as one
 * `promote_agent_answer` suggestion with the answers as its excerpt.
 */
async function openFromClusters(
  tx: TenantClient,
  tenant: TenantContext,
  now: Date,
): Promise<OpenedSuggestion[]> {
  const since = new Date(now.getTime() - SUGGESTION_CLUSTER_WINDOW_DAYS * DAY);
  const clusters = await tx.$queryRaw<Array<{ id: string; ai_agent_id: string }>>`
    SELECT c.id::text, c.ai_agent_id::text
      FROM ai_unresolved_clusters c
      JOIN ai_unresolved_items i ON i.cluster_id = c.id
     WHERE c.status <> 'ignored'
       AND i.created_at >= ${since}
       AND EXISTS (
         SELECT 1 FROM events e
          WHERE e.thread_id = i.thread_id AND e.author_type = 'agent' AND e.type = 'message'
            AND e.recipients = 'all' AND e.created_at > i.created_at)
       AND NOT EXISTS (
         SELECT 1 FROM ai_suggestions s
          WHERE s.cluster_id = c.id AND s.source = 'unresolved_cluster' AND s.created_at >= ${since})
     GROUP BY c.id
    HAVING count(DISTINCT i.id) >= ${SUGGESTION_CLUSTER_ANSWERS_MIN}
     ORDER BY c.id
     LIMIT 20`;
  const opened: OpenedSuggestion[] = [];
  for (const cluster of clusters) {
    const answers = await tx.$queryRaw<
      Array<{
        chat_id: string;
        thread_id: string;
        group_id: bigint | null;
        question: string;
        asked_at: Date;
        question_event: string | null;
        answer_id: string;
        answer: string | null;
        answered_at: Date;
      }>
    >`
      SELECT i.chat_id, i.thread_id, t.group_id, i.text_masked AS question,
             i.created_at AS asked_at, i.event_id AS question_event,
             a.id AS answer_id, a.text AS answer, a.created_at AS answered_at
        FROM ai_unresolved_items i
        JOIN threads t ON t.id = i.thread_id
        JOIN LATERAL (
          SELECT e.id, e.text, e.created_at FROM events e
           WHERE e.thread_id = i.thread_id AND e.author_type = 'agent' AND e.type = 'message'
             AND e.recipients = 'all' AND e.created_at > i.created_at
           ORDER BY e.created_at, e.id LIMIT 1) a ON TRUE
       WHERE i.cluster_id = ${cluster.id}::uuid AND i.created_at >= ${since}
       ORDER BY i.created_at DESC, i.id
       LIMIT ${SUGGESTION_CLUSTER_ANSWERS_MIN}`;
    const newest = answers[0];
    if (!newest) continue;
    const excerpt: SuggestionExcerptMessage[] = answers
      .slice()
      .reverse()
      .flatMap((row) => [
        {
          event_id: row.question_event ?? `${row.thread_id}_q`,
          author_type: 'customer' as const,
          is_ai: false,
          text: row.question.slice(0, SUGGESTION_EXCERPT_TEXT_MAX),
          created_at: row.asked_at.toISOString(),
          marked: false,
        },
        {
          event_id: row.answer_id,
          author_type: 'agent' as const,
          is_ai: false,
          text: maskForWrite(row.answer ?? '', 'agent').text.slice(0, SUGGESTION_EXCERPT_TEXT_MAX),
          created_at: row.answered_at.toISOString(),
          marked: true,
        },
      ]);
    const id = randomUUID();
    await tx.aiSuggestion.create({
      data: {
        id,
        licenseId: tenant.licenseId,
        aiAgentId: cluster.ai_agent_id,
        kind: 'promote_agent_answer',
        source: 'unresolved_cluster',
        chatId: newest.chat_id,
        threadId: newest.thread_id,
        eventIds: [newest.answer_id],
        excerptMasked: excerpt as unknown as Prisma.InputJsonArray,
        teamId: newest.group_id,
        clusterId: cluster.id,
        status: 'drafting',
        createdBy: null,
      },
    });
    opened.push({
      id,
      aiAgentId: cluster.ai_agent_id,
      kind: 'promote_agent_answer',
      teamId: newest.group_id,
    });
  }
  return opened;
}
