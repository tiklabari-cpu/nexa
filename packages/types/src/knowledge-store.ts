/**
 * The single knowledge store (tm 309 · SiyahTuş analysis AI-14, owner decision
 * K11; `docs/adr/single-knowledge-store.md`) — the vocabulary the schema
 * (`20261020220000_knowledge_single_store`), the contract (`KnowledgeSource`,
 * `KbArticle.ai_audiences`) and the panel share.
 *
 * One store holds what the AI agent answers players from and what Copilot
 * drafts replies from. A source names who may use it (`audiences`): `ai_agent`
 * — every answer the AI gives a player, previews included — and `copilot`, the
 * agent's assistant. Copilot uses everything the AI agent may (`ai_agent ∪
 * copilot`), so `{copilot}` alone is "for agents only" and never reaches a
 * player. A published KB article joins the store when its `ai_audiences` is
 * not empty (AI-14-S2: open to both unless switched off).
 *
 * Every source is due a fresh look by a person every so often (AI-14-S3):
 * past `reviewed_at + review_interval_days` it needs a review. A due review
 * only warns; what takes a source out of retrieval is its `valid_until`.
 */

/** Who may use a source, in the one order a stored set lists them. */
export const KNOWLEDGE_AUDIENCES = ['ai_agent', 'copilot'] as const;
export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number];

/**
 * A new source's audiences, and a KB article's until it is switched off
 * (AI-14-S2): both.
 */
export const DEFAULT_KNOWLEDGE_AUDIENCES: readonly KnowledgeAudience[] = ['ai_agent', 'copilot'];

export function isKnowledgeAudience(value: unknown): value is KnowledgeAudience {
  return typeof value === 'string' && (KNOWLEDGE_AUDIENCES as readonly string[]).includes(value);
}

/**
 * A set of audiences in the one spelling the store keeps — no repeats, in
 * {@link KNOWLEDGE_AUDIENCES} order — so two equal sets are equal arrays and
 * `{copilot}` matches `{copilot}` exactly (`GET /copilot/knowledge`, ADR §3
 * detail 1). Values that are not audiences are dropped; whether an empty set
 * is allowed is the caller's to say (a source's never is, an article's means
 * "the AI does not use it").
 */
export function normalizeKnowledgeAudiences(values: readonly unknown[]): KnowledgeAudience[] {
  return KNOWLEDGE_AUDIENCES.filter((audience) => values.includes(audience));
}

/**
 * How often a source is due a review, in days (AI-14-S3). The bounds are a
 * typo guard — a review a day at the most, once a year at the least, the
 * window `refresh_after_days` keeps for re-crawling.
 */
export const KNOWLEDGE_REVIEW_INTERVAL_DAYS = { default: 90, min: 1, max: 365 } as const;

const DAY_MS = 86_400_000;

/** When a source reviewed at `reviewedAt` falls due again — whole 24-hour days. */
export function knowledgeReviewDueAt(reviewedAt: Date, intervalDays: number): Date {
  return new Date(reviewedAt.getTime() + intervalDays * DAY_MS);
}

/**
 * Whether a source needs a review at `now` — once its due moment has passed
 * (ADR §2.5). It still answers: only `valid_until` takes a source out.
 */
export function isKnowledgeReviewDue(reviewedAt: Date, intervalDays: number, now: Date): boolean {
  return knowledgeReviewDueAt(reviewedAt, intervalDays).getTime() < now.getTime();
}

/**
 * A source's language, as the primary subtag `normaliseLanguage` keeps
 * (`tr`, `en`); null is "not said". The column's CHECK holds the same shape.
 */
export const KNOWLEDGE_LANGUAGE_PATTERN = /^[a-z]{2,3}$/;

/**
 * What `GET /knowledge-sources?audience=` lists (tm 309.2 · ADR §2.7):
 * `ai_agent` — the default, the sources the AI agent answers players from,
 * which is what the list has always meant to the installed apps; `copilot` —
 * the sources whose audiences name Copilot; `all` — the whole store.
 */
export const KNOWLEDGE_LIST_AUDIENCES = ['all', 'ai_agent', 'copilot'] as const;
export type KnowledgeListAudience = (typeof KNOWLEDGE_LIST_AUDIENCES)[number];
export const DEFAULT_KNOWLEDGE_LIST_AUDIENCE: KnowledgeListAudience = 'ai_agent';

/**
 * The most AI agents, or brands, one source names (tm 309.2). A typo guard on
 * the request, not a product limit: a source for every agent or every brand
 * names none.
 */
export const KNOWLEDGE_SCOPE_IDS_MAX = 100;

/** Who a source is for, as the store keeps it — the columns retrieval filters on. */
export interface KnowledgeSourceScope {
  readonly audiences: readonly string[];
  /** Empty: every AI agent. */
  readonly aiAgentIds: readonly string[];
  /** Empty: every brand. */
  readonly brandIds: readonly string[];
  /** Past it the source answers nothing; null: no end. */
  readonly validUntil: Date | null;
}

/**
 * Who is about to draw on the store (tm 309.2 · ADR §2.2–§2.4).
 *
 * - `ai_agent` — the AI agent answering a player, previews included: the
 *   sources for the AI agent, for this agent or for every one (`aiAgentId`
 *   null — a turn with no agent of its own — reads every AI-agent source), and
 *   for the conversation's brand or every brand. A brand that is not known
 *   (`brandId` null) reads the every-brand sources only, so a source of one
 *   brand never reaches a player of another by default.
 * - `copilot` — the agents' assistant: every audience, for it uses whatever
 *   the AI agent may and what is for agents only; never narrowed by AI agent.
 *   Inside a conversation it is narrowed by that conversation's brand like the
 *   AI agent (`brandId`, null when not known); `brandId: undefined` is a
 *   question outside any conversation, which no brand narrows.
 */
export type KnowledgeReader =
  | {
      readonly audience: 'ai_agent';
      readonly aiAgentId: string | null;
      readonly brandId: string | null;
    }
  | { readonly audience: 'copilot'; readonly brandId?: string | null };

/**
 * Whether `reader` may use a source of `scope` at `now` — the knowledge
 * filter, said once. `KnowledgeService.search` holds the same condition in
 * SQL; `knowledge-scope.test.ts` plants every combination and requires the two
 * to agree. A source due a review still serves (only `validUntil` ends one).
 */
export function knowledgeSourceServes(
  scope: KnowledgeSourceScope,
  reader: KnowledgeReader,
  now: Date,
): boolean {
  if (scope.validUntil !== null && scope.validUntil.getTime() <= now.getTime()) return false;
  if (reader.audience === 'ai_agent') {
    if (!scope.audiences.includes('ai_agent')) return false;
    if (
      reader.aiAgentId !== null &&
      scope.aiAgentIds.length > 0 &&
      !scope.aiAgentIds.includes(reader.aiAgentId)
    ) {
      return false;
    }
  } else if (!scope.audiences.some((audience) => isKnowledgeAudience(audience))) {
    return false;
  }
  if (reader.brandId === undefined) return true;
  if (scope.brandIds.length === 0) return true;
  return reader.brandId !== null && scope.brandIds.includes(reader.brandId);
}
