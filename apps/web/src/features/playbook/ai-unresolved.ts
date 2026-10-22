/**
 * The unresolved questions report's data (tm 317.3 · AI-22): the wire shapes of
 * `/ai/unresolved/*` (`routes/ai-unresolved.ts`), the query keys they live
 * under, and how the list's filters become a request.
 *
 * `chat_id` is the member's day and `thread_id` one connection (K1 = A,
 * `ids.thread` / `ids.chat`): the screens name them through `ids.*`, never by literal.
 */
import {
  UNRESOLVED_SPIKE_THRESHOLD_MAX,
  UNRESOLVED_SPIKE_THRESHOLD_MIN,
  type UnresolvedClusterStatus,
  type UnresolvedLabelSource,
  type UnresolvedListSort,
  type UnresolvedListStatus,
  type UnresolvedReason,
  type UnresolvedSuggestedAction,
} from '@siyahtus/types';

export interface UnresolvedReasonCount {
  reason: UnresolvedReason;
  count: number;
}

export interface UnresolvedCluster {
  id: string;
  ai_agent_id: string;
  label: string;
  label_source: UnresolvedLabelSource;
  suggested_action: UnresolvedSuggestedAction | null;
  status: UnresolvedClusterStatus;
  ignore_reason: string | null;
  item_count: number;
  count_7d: number;
  handoff_count: number;
  abandon_count: number;
  handoff_rate: number;
  abandon_rate: number;
  post_fix_count: number;
  is_new: boolean;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  linked_change_id: string | null;
  reasons: UnresolvedReasonCount[];
  matching_count: number | null;
}

export interface UnresolvedClusterList {
  clusters: UnresolvedCluster[];
  total: number;
  unclustered_count: number;
  spike_threshold: number;
}

export interface UnresolvedExample {
  id: string;
  text: string;
  context: string | null;
  reason: UnresolvedReason;
  language: string | null;
  brand_id: string | null;
  chat_id: string;
  thread_id: string;
  created_at: string;
}

export interface UnresolvedClusterDetail extends UnresolvedCluster {
  examples: UnresolvedExample[];
  trend: Array<{ date: string; count: number }>;
  languages: Array<{ language: string | null; count: number }>;
}

export interface UnresolvedSettings {
  spike_threshold: number;
  default_threshold: number;
  window_minutes: number;
  min_threshold: number;
  max_threshold: number;
}

export interface KnowledgeProposal {
  cluster_id: string;
  ai_agent_id: string;
  target: 'knowledge_snippet';
  title: string;
  questions: string[];
  body: string;
}

export interface AddExamplesResult {
  skill_id: string;
  added: string[];
  skipped: number;
  examples_count: number;
}

export interface MergeResult {
  cluster: UnresolvedCluster;
  absorbed: number;
}

/** What the filter bar holds; empty strings are "any". */
export interface UnresolvedFilters {
  status: UnresolvedListStatus;
  sort: UnresolvedListSort;
  reason: UnresolvedReason | '';
  language: string;
  brandId: string;
  /** `YYYY-MM-DD` as a date input holds it. */
  from: string;
  to: string;
}

export const DEFAULT_UNRESOLVED_FILTERS: UnresolvedFilters = {
  status: 'open',
  sort: 'count_7d',
  reason: '',
  language: '',
  brandId: '',
  from: '',
  to: '',
};

export const unresolvedKeys = {
  all: (agentId: string) => ['ai', 'unresolved', agentId] as const,
  list: (agentId: string, filters: UnresolvedFilters) =>
    ['ai', 'unresolved', agentId, 'list', filters] as const,
  detail: (agentId: string, clusterId: string) =>
    ['ai', 'unresolved', agentId, 'detail', clusterId] as const,
  settings: ['ai', 'unresolved', 'settings'] as const,
};

/** A two-letter language code, or null while the box holds something else. */
export function languageFilterOf(value: string): string | null {
  const code = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

/** The list request for an agent and the filter bar: only what is set is sent. */
export function unresolvedListPath(agentId: string, filters: UnresolvedFilters): string {
  const params = new URLSearchParams({
    ai_agent_id: agentId,
    status: filters.status,
    sort: filters.sort,
  });
  if (filters.reason) params.set('reason', filters.reason);
  const language = languageFilterOf(filters.language);
  if (language) params.set('language', language);
  if (filters.brandId) params.set('brand_id', filters.brandId);
  if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set('to', `${filters.to}T23:59:59.999Z`);
  return `/ai/unresolved/clusters?${params.toString()}`;
}

/** Whether the filter bar differs from the default view. */
export function unresolvedFiltersActive(filters: UnresolvedFilters): boolean {
  return (
    filters.status !== DEFAULT_UNRESOLVED_FILTERS.status ||
    filters.reason !== '' ||
    languageFilterOf(filters.language) !== null ||
    filters.brandId !== '' ||
    filters.from !== '' ||
    filters.to !== ''
  );
}

/** The surge threshold a box holds, or null while it is not a whole number in range. */
export function spikeThresholdOf(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= UNRESOLVED_SPIKE_THRESHOLD_MIN && n <= UNRESOLVED_SPIKE_THRESHOLD_MAX ? n : null;
}

/**
 * The editor's opening text for a knowledge snippet (AI-22 "Bilgi ekle"): the
 * questions the cluster collected, then a place for the answer. The headings
 * are the caller's — they are words the panel translates.
 */
export function knowledgeDraftOf(
  questions: readonly string[],
  headings: { questions: string; answer: string },
): string {
  return [
    headings.questions,
    ...questions.map((question) => `- ${question}`),
    '',
    headings.answer,
    '',
  ].join('\n');
}
