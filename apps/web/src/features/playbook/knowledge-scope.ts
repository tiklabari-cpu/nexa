/**
 * Who a knowledge source is for, and how the single list narrows by it
 * (tm 309.3 · AI-14).
 *
 * The store is one list: what the AI agent answers players from and what
 * Copilot drafts replies from (`docs/adr/single-knowledge-store.md`). A source
 * names its audiences, the AI agents and brands it is for, an owner, an end
 * date and a review interval. These helpers say what the list shows about
 * that — the audience chips, the "review needed" and "ended" badges — and cut
 * it by the controls above the list. Pure, so the same rule drives the Playbook
 * list and the Copilot page.
 *
 * Every field is optional on `KnowledgeSource`: a row from a release that
 * predates the store reads as the defaults (both audiences, every agent, every
 * brand, no end, unowned), which is also what the migration gave it.
 */
import {
  DEFAULT_KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
  isKnowledgeReviewDue,
  type KnowledgeAudience,
} from '@siyahtus/types';
import type { KnowledgeSource } from './types.js';

/** What a source's audiences amount to, in the words the panel uses. */
export type AudienceKind = 'both' | 'ai_agent' | 'agents_only';

type ScopeFacet = Pick<KnowledgeSource, 'audiences'>;

/** The audiences a source names; a row that names none reads as both. */
export function audiencesOf(source: ScopeFacet): readonly KnowledgeAudience[] {
  const named = source.audiences ?? [];
  return named.length > 0 ? named : DEFAULT_KNOWLEDGE_AUDIENCES;
}

/**
 * `agents_only` — `[copilot]` alone, which never reaches a player (the old
 * "Copilot's own knowledge"); `ai_agent` — the AI agent alone; `both`.
 */
export function audienceKindOf(source: ScopeFacet): AudienceKind {
  const audiences = audiencesOf(source);
  const ai = audiences.includes('ai_agent');
  const copilot = audiences.includes('copilot');
  if (ai && copilot) return 'both';
  return ai ? 'ai_agent' : 'agents_only';
}

type DueFacet = Pick<KnowledgeSource, 'review_due_at' | 'reviewed_at' | 'review_interval_days'>;

/**
 * Whether the source is due a review at `now` (AI-14-S3). The server's
 * `review_due_at` is read as sent; a row with only `reviewed_at` is worked out
 * the way the server does. A source with neither has nothing to be late on.
 */
export function needsReview(source: DueFacet, now: Date): boolean {
  if (source.review_due_at) return new Date(source.review_due_at).getTime() < now.getTime();
  if (source.reviewed_at) {
    return isKnowledgeReviewDue(
      new Date(source.reviewed_at),
      source.review_interval_days ?? KNOWLEDGE_REVIEW_INTERVAL_DAYS.default,
      now,
    );
  }
  return false;
}

/** Whether the source's end date has passed — it answers nothing any more. */
export function hasEnded(source: Pick<KnowledgeSource, 'valid_until'>, now: Date): boolean {
  return source.valid_until != null && new Date(source.valid_until).getTime() <= now.getTime();
}

/**
 * A published KB article's source: its title, text and scope are the
 * article's, so only the meta fields (owner, language, review interval) are
 * edited from the store.
 */
export function isArticleSource(source: Pick<KnowledgeSource, 'kb_article_id'>): boolean {
  return source.kb_article_id != null;
}

/** What the controls above the list pick. `all` is no narrowing on that axis. */
export interface KnowledgeScopeControls {
  audience: 'all' | AudienceKind;
  /** `all`, `every` (the sources for every brand), or a brand id. */
  brand: string;
  /** `all`, `none` (unowned), or a member id. */
  owner: string;
  /** Only the sources due a review. */
  needsReview: boolean;
}

export const DEFAULT_SCOPE_CONTROLS: KnowledgeScopeControls = {
  audience: 'all',
  brand: 'all',
  owner: 'all',
  needsReview: false,
};

export function hasActiveScopeControls(controls: KnowledgeScopeControls): boolean {
  return (
    controls.audience !== 'all' ||
    controls.brand !== 'all' ||
    controls.owner !== 'all' ||
    controls.needsReview
  );
}

/**
 * The sources that pass every control. A brand picked from the list keeps the
 * sources for that brand and the ones for every brand — the same pair
 * `GET /knowledge-sources?brand_id=` returns — since a conversation of that
 * brand reads both.
 */
export function applyScopeControls<T extends Partial<KnowledgeSource>>(
  sources: readonly T[],
  controls: KnowledgeScopeControls,
  now: Date,
): T[] {
  return sources.filter((source) => {
    if (controls.audience !== 'all' && audienceKindOf(source) !== controls.audience) return false;

    const brandIds = source.brand_ids ?? [];
    if (controls.brand === 'every') {
      if (brandIds.length > 0) return false;
    } else if (controls.brand !== 'all') {
      if (brandIds.length > 0 && !brandIds.includes(controls.brand)) return false;
    }

    if (controls.owner === 'none') {
      if (source.owner_id != null) return false;
    } else if (controls.owner !== 'all' && source.owner_id !== controls.owner) {
      return false;
    }

    return !controls.needsReview || needsReview(source, now);
  });
}

/** How many sources are due a review — the number on the list's warning. */
export function countNeedingReview(sources: readonly DueFacet[], now: Date): number {
  return sources.reduce((count, source) => count + (needsReview(source, now) ? 1 : 0), 0);
}

/**
 * The scope a form holds, as the pieces the create and edit requests send.
 * `validUntil` is a `YYYY-MM-DD` date (the `<input type="date">` value): a
 * source ends at the close of that day in the browser's zone, so "until 31
 * March" still answers on the 31st.
 */
export interface KnowledgeScopeValue {
  audiences: KnowledgeAudience[];
  brandIds: string[];
  validUntil: string;
  ownerId: string;
  language: string;
  reviewIntervalDays: string;
}

export function scopeValueOf(source?: Partial<KnowledgeSource>): KnowledgeScopeValue {
  return {
    audiences: source ? [...audiencesOf(source)] : [...DEFAULT_KNOWLEDGE_AUDIENCES],
    brandIds: [...(source?.brand_ids ?? [])],
    validUntil: source?.valid_until ? dateInputOf(new Date(source.valid_until)) : '',
    ownerId: source?.owner_id ?? '',
    language: source?.language ?? '',
    reviewIntervalDays: String(
      source?.review_interval_days ?? KNOWLEDGE_REVIEW_INTERVAL_DAYS.default,
    ),
  };
}

/** `YYYY-MM-DD` of an instant in the browser's zone, the date input's value. */
export function dateInputOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The instant a `YYYY-MM-DD` end date means: the last moment of that local day. */
export function validUntilOf(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const [year, month, day] = dateInput.split('-').map(Number) as [number, number, number];
  const end = new Date(year, month - 1, day, 23, 59, 59, 0);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

/** Whether a review interval the form holds is one the API accepts. */
export function isValidReviewInterval(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false;
  const days = Number(text);
  return days >= KNOWLEDGE_REVIEW_INTERVAL_DAYS.min && days <= KNOWLEDGE_REVIEW_INTERVAL_DAYS.max;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ScopePatch = Mutable<{
  audiences: KnowledgeAudience[];
  brand_ids: string[];
  valid_until: string | null;
  owner_id: string | null;
  language: string | null;
  review_interval_days: number;
}>;

/**
 * The scope fields that changed between a source and the form — and only
 * those. An unchanged audience list would still be a re-filing on the server,
 * and an empty patch is a 400, so the caller merges this into its own patch
 * and closes quietly when the whole thing is empty.
 *
 * `scope: false` leaves the reach fields out (audiences, brands, end date):
 * a KB article's source takes those from its article.
 */
export function scopePatchOf(
  source: Partial<KnowledgeSource>,
  value: KnowledgeScopeValue,
  options: { scope: boolean },
): Partial<ScopePatch> {
  const before = scopeValueOf(source);
  const patch: Partial<ScopePatch> = {};

  if (options.scope) {
    if (!sameSet(before.audiences, value.audiences)) patch.audiences = value.audiences;
    if (!sameSet(before.brandIds, value.brandIds)) patch.brand_ids = value.brandIds;
    if (before.validUntil !== value.validUntil) patch.valid_until = validUntilOf(value.validUntil);
  }
  if (before.ownerId !== value.ownerId)
    patch.owner_id = value.ownerId === '' ? null : value.ownerId;
  if (before.language !== value.language.trim()) {
    patch.language = value.language.trim() === '' ? null : value.language.trim();
  }
  if (before.reviewIntervalDays !== value.reviewIntervalDays) {
    patch.review_interval_days = Number(value.reviewIntervalDays);
  }
  return patch;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/**
 * The scope fields a create request carries — only those that are not what the
 * server would pick anyway (both audiences, every brand, no end, no owner, no
 * language, a 90-day review). A form left alone sends the body it always sent.
 */
export function scopeCreateBody(value: KnowledgeScopeValue): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (!sameSet(value.audiences, DEFAULT_KNOWLEDGE_AUDIENCES)) body['audiences'] = value.audiences;
  if (value.brandIds.length > 0) body['brand_ids'] = value.brandIds;
  const validUntil = validUntilOf(value.validUntil);
  if (validUntil) body['valid_until'] = validUntil;
  if (value.ownerId !== '') body['owner_id'] = value.ownerId;
  if (value.language.trim() !== '') body['language'] = value.language.trim();
  if (Number(value.reviewIntervalDays) !== KNOWLEDGE_REVIEW_INTERVAL_DAYS.default) {
    body['review_interval_days'] = Number(value.reviewIntervalDays);
  }
  return body;
}
