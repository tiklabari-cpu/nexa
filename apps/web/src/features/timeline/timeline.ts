/**
 * The conversation timeline's pure half (ID-09 · tm 334.2): the address, the
 * request URLs, the in-page filter, the connection dividers and the clock.
 *
 * `chat` is the member's day (`chat_id`) and `thread` one connection
 * (`thread_id`); the address spells the code's names and the ids glossary is
 * applied where words are drawn (ID-01, K1 = A).
 */
import {
  TIMELINE_KINDS,
  TIMELINE_PAGE_SIZE,
  type TimelineItem,
  type TimelineKind,
  type TimelinePage,
} from '@siyahtus/types';

/** The page's own address; the Inbox and the Archive link here. */
export const TIMELINE_PATH = '/app/inbox/timeline';

export const CHAT_PARAM = 'chat';
export const THREAD_PARAM = 'thread';
export const KINDS_PARAM = 'kinds';

export interface TimelineAddress {
  chatId: string | null;
  threadId: string | null;
  /** Empty = every kind. */
  kinds: TimelineKind[];
}

const KIND_SET: ReadonlySet<string> = new Set(TIMELINE_KINDS);

/** The kinds in a `kinds=a,b` value, in catalogue order; unknown names are dropped. */
export function parseKinds(value: string | null): TimelineKind[] {
  if (!value) return [];
  const named = new Set(value.split(',').map((part) => part.trim()));
  return TIMELINE_KINDS.filter((kind) => named.has(kind) && KIND_SET.has(kind));
}

export function readAddress(params: URLSearchParams): TimelineAddress {
  return {
    chatId: params.get(CHAT_PARAM) || null,
    threadId: params.get(THREAD_PARAM) || null,
    kinds: parseKinds(params.get(KINDS_PARAM)),
  };
}

/** The address of a timeline: a whole day, or one connection of it. */
export function timelineAddress(chatId: string, threadId?: string | null): string {
  const params = new URLSearchParams({ [CHAT_PARAM]: chatId });
  if (threadId) params.set(THREAD_PARAM, threadId);
  return `${TIMELINE_PATH}?${params.toString()}`;
}

/** The address with `kinds` set (all kinds removes the parameter), other parameters kept. */
export function writeKinds(
  params: URLSearchParams,
  kinds: readonly TimelineKind[],
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (kinds.length === 0 || kinds.length === TIMELINE_KINDS.length) next.delete(KINDS_PARAM);
  else next.set(KINDS_PARAM, kinds.join(','));
  return next;
}

/** The address with the connection set or dropped (the day view). */
export function writeThread(params: URLSearchParams, threadId: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (threadId) next.set(THREAD_PARAM, threadId);
  else next.delete(THREAD_PARAM);
  return next;
}

/** `GET /chats/{chatId}/timeline` for one page. */
export function timelineUrl(address: TimelineAddress, pageId: string | undefined): string {
  const query = new URLSearchParams({ limit: String(TIMELINE_PAGE_SIZE) });
  if (address.threadId) query.set('thread_id', address.threadId);
  if (address.kinds.length > 0) query.set('kinds', address.kinds.join(','));
  if (pageId) query.set('page_id', pageId);
  const chat = encodeURIComponent(address.chatId ?? '');
  return `/chats/${chat}/timeline?${query.toString()}`;
}

/** What the first page says about the whole read; absent until it arrives. */
export type TimelineMeta = Pick<TimelinePage, 'audit' | 'audit_expired' | 'audit_retained_since'>;

// ---------------------------------------------------------------------------
// Words in a row

/** A string detail, or null when the field is absent or not a non-empty string. */
export function detailString(item: TimelineItem, key: string): string | null {
  const value = item.details[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function detailNumber(item: TimelineItem, key: string): number | null {
  const value = item.details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The ids a decision of the AI read from, as the row names them. */
export function knowledgeSourceCount(item: TimelineItem): number {
  const ids = item.details['knowledge_source_ids'];
  return Array.isArray(ids) ? ids.length : 0;
}

/** One facet of an AI decision row: the catalogue key to draw and its values. */
export interface AiFacet {
  key: 'procedure' | 'step' | 'sources' | 'handoff';
  values: Record<string, string | number>;
}

/**
 * What an AI decision row says beyond the decision itself — the procedure and
 * step, how many knowledge sources it read, why it handed over (ID-09 KK:
 * "AI kararları (prosedür, kaynak, devir nedeni)"). A procedure run (the
 * `skill_run` source) carries its name and status instead.
 */
export function aiFacets(item: TimelineItem): AiFacet[] {
  const facets: AiFacet[] = [];
  const procedure = detailString(item, 'procedure_name') ?? detailString(item, 'procedure_id');
  if (procedure) facets.push({ key: 'procedure', values: { name: procedure } });
  const step = detailString(item, 'step');
  if (step) facets.push({ key: 'step', values: { step } });
  const sources = knowledgeSourceCount(item);
  if (sources > 0) facets.push({ key: 'sources', values: { count: sources } });
  const handoff = detailString(item, 'handoff_reason');
  if (handoff) facets.push({ key: 'handoff', values: { reason: handoff } });
  return facets;
}

export function isProcedureRun(item: TimelineItem): boolean {
  return item.kind === 'ai_decision' && item.details['source'] === 'skill_run';
}

export function slaNumbers(item: TimelineItem): {
  target: string;
  elapsed: number;
  limit: number;
} | null {
  const target = detailString(item, 'target');
  const elapsed = detailNumber(item, 'elapsed_minutes');
  const limit = detailNumber(item, 'target_minutes');
  return target !== null && elapsed !== null && limit !== null ? { target, elapsed, limit } : null;
}

/** `JSON.stringify` that never throws, for the expanded details and the search text. */
export function detailsJson(item: TimelineItem): string {
  try {
    return JSON.stringify(item.details, null, 2) ?? '{}';
  } catch {
    return '{}';
  }
}

// ---------------------------------------------------------------------------
// The in-page filter

/**
 * What the filter box matches a row against: everything the row shows or can
 * show — kind, actor, ids, text and the fields behind "Details" — so a
 * procedure id, a handoff code or a ticket number finds its row. The search is
 * over the rows loaded so far (the page says so); older ones need "Load more".
 */
export function rowSearchText(item: TimelineItem, labels: { kind: string; actor: string }): string {
  return [
    labels.kind,
    labels.actor,
    item.actor.id ?? '',
    item.id,
    item.thread_id ?? '',
    item.event_id ?? '',
    item.text ?? '',
    detailsJson(item),
  ]
    .join('\n')
    .toLowerCase();
}

/** Rows whose search text holds every word of `query` (case-insensitive, any order). */
export function matchesQuery(searchText: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => searchText.includes(word));
}

// ---------------------------------------------------------------------------
// Connection dividers

export type TimelineEntry =
  | { type: 'divider'; threadId: string; key: string }
  | { type: 'row'; item: TimelineItem; key: string };

/**
 * The rows with a divider ahead of each connection's first row. Only rows that
 * belong to a connection move the marker: an audit entry about the day as a
 * whole (`thread_id` null) sits between connections without ending one.
 */
export function withDividers(items: readonly TimelineItem[], dividers: boolean): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let current: string | null = null;
  for (const item of items) {
    if (dividers && item.thread_id !== null && item.thread_id !== current) {
      current = item.thread_id;
      entries.push({ type: 'divider', threadId: current, key: `divider:${item.kind}:${item.id}` });
    }
    entries.push({ type: 'row', item, key: `${item.kind}:${item.id}` });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The clock

/** The row's time in the workspace's zone (ID-04); a bad zone name falls back to UTC. */
export function formatRowTime(at: string, zone: string, locale: string | undefined): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'medium',
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** The same instant in UTC, to the millisecond — the tooltip, so a row can be matched to a log. */
export function utcTooltip(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return `UTC ${date.toISOString().replace('T', ' ').replace('Z', '')}`;
}

/** One tab-separated line for the clipboard: time (UTC ISO), kind, actor, text. */
export function rowClipboardLine(item: TimelineItem, actor: string): string {
  const text = (item.text ?? '').replace(/\s*\r?\n\s*/g, ' ');
  return [item.at, item.kind, actor, text].join('\t');
}
