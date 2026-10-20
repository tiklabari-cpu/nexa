/**
 * The single knowledge store (tm 309 · SiyahTuş analysis AI-14, owner decision
 * K11; `docs/adr/single-knowledge-store.md`) — the vocabulary the schema
 * (`20261021090000_knowledge_single_store`), the contract (`KnowledgeSource`,
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
