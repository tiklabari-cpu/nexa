/**
 * Playbook › Geçmiş's data (tm 315 · AI-21): the change history's shapes as
 * `GET /ai/changes` serves them, the list path its filters build, and the
 * readable summary of one difference entry ("Adım 3: Finans'a devret → KYC'ye
 * devret").
 */
import {
  aiConfigStepOf,
  isAiConfigOmittedText,
  type AiConfigChangeAction,
  type AiConfigDiffEntry,
  type AiConfigEntityType,
} from '@siyahtus/types';

export interface AiConfigChange {
  id: string;
  ai_agent_id: string | null;
  entity_type: AiConfigEntityType;
  entity_id: string;
  entity_name: string | null;
  action: AiConfigChangeAction;
  actor: { id: string | null; type: string; role: string | null; name: string | null };
  at: string;
  version_id: string | null;
  draft_revision: number | null;
  note: string | null;
  fields: string[];
  diff: AiConfigDiffEntry[];
}

export interface AiConfigChangeDetail extends AiConfigChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
}

export interface AiConfigChangeList {
  items: AiConfigChange[];
  next_cursor: string | null;
  visibility: 'all' | 'own';
}

export interface HistoryFilters {
  entityType: AiConfigEntityType | '';
  action: AiConfigChangeAction | '';
  /** `YYYY-MM-DD`, the panel's day; empty: no bound. */
  from: string;
  to: string;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  entityType: '',
  action: '',
  from: '',
  to: '',
};

export const historyKeys = {
  all: ['playbook', 'ai-changes'] as const,
  list: (entityId: string | null, filters: HistoryFilters) =>
    ['playbook', 'ai-changes', 'list', entityId, filters] as const,
  detail: (id: string) => ['playbook', 'ai-changes', 'detail', id] as const,
};

/** The query string both the list and the export read. */
export function historyQuery(
  filters: HistoryFilters,
  entityId: string | null,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  if (entityId) params.set('entity_id', entityId);
  if (filters.entityType) params.set('entity_type', filters.entityType);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) params.set('to', new Date(`${filters.to}T23:59:59.999`).toISOString());
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** A value as the diff shows it: text as it is, a long text by its length, else JSON. */
export function diffValueText(value: unknown, omitted: (length: number) => string): string {
  if (value === undefined || value === null) return '—';
  if (isAiConfigOmittedText(value)) return omitted(value.length);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * One entry's line: "Adım 3 · target: Finans → KYC" for a step, "tone:
 * friendly → formal" otherwise. `step` renders the step's label.
 */
export function describeDiffEntry(
  entry: AiConfigDiffEntry,
  text: (value: unknown) => string,
  step: (n: number) => string,
): { label: string; before: string; after: string } {
  const at = aiConfigStepOf(entry.path);
  const label = at ? `${step(at.step)}${at.rest ? ` · ${at.rest}` : ''}` : entry.path;
  return {
    label,
    before: entry.kind === 'added' ? '—' : text(entry.before),
    after: entry.kind === 'removed' ? '—' : text(entry.after),
  };
}
