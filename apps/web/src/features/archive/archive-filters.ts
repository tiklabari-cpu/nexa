/**
 * The Archive's filters (AR-02 · tm 336.2): what the address holds, what the list
 * asks the server for, which combinations cannot hold, and how a date range moves.
 *
 * The address carries **ids and enum words only** (GV-05): agents and tags by id,
 * teams by number, days as `YYYY-MM-DD`. Never a name or an e-mail address — a
 * filtered link can be pasted into a chat without carrying anyone's personal data,
 * and opening it in another browser gives the same list. The parameter names are
 * the API's own, so the address and the request are the same words.
 *
 * Reading is forgiving (a hand-edited or stale link drops what it cannot
 * understand rather than failing the screen); writing is canonical (a default
 * leaves no trace, the order is fixed), so the same filters are always the same
 * address.
 */
import {
  ADAPTER_CHANNEL_TYPES,
  ARCHIVE_MAX_FILTER_IDS,
  ARCHIVE_MAX_TAGS,
  ARCHIVE_RATING_FILTERS,
  ARCHIVE_TAG_MODES,
  DEFAULT_DAY_BOUNDARY,
  RISK_FLAG_TYPES,
  THREAD_HANDLED_BY,
  isDayKey,
  isUuid,
  localDayKey,
  shiftDayKey,
  type AdapterChannelType,
  type ArchiveRatingFilter,
  type ArchiveTagMode,
  type DayBoundary,
  type RiskFlagType,
  type ThreadHandledBy,
} from '@siyahtus/types';

export interface ArchiveFilters {
  /** First conversation day (the workspace's calendar, ID-04), included. */
  dateFrom: string | null;
  /** Last conversation day, included. */
  dateTo: string | null;
  agentIds: string[];
  groupIds: number[];
  rating: ArchiveRatingFilter | null;
  tagIds: string[];
  tagMode: ArchiveTagMode;
  untagged: boolean;
  handledBy: ThreadHandledBy[];
  riskFlags: RiskFlagType[];
  channel: AdapterChannelType | null;
}

export const NO_FILTERS: ArchiveFilters = Object.freeze({
  dateFrom: null,
  dateTo: null,
  agentIds: [],
  groupIds: [],
  rating: null,
  tagIds: [],
  tagMode: 'any',
  untagged: false,
  handledBy: [],
  riskFlags: [],
  channel: null,
}) as ArchiveFilters;

/** Every address key a filter owns; `writeFilters` replaces exactly these and nothing else. */
export const FILTER_PARAMS = [
  'date_from',
  'date_to',
  'agent_id',
  'group_id',
  'rating',
  'tag',
  'tag_mode',
  'untagged',
  'handled_by',
  'risk_flag',
  'channel',
] as const;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** The values the address names, in the vocabulary's order, once each. */
function pickAll<T extends string>(values: readonly T[], found: readonly string[]): T[] {
  return values.filter((value) => found.includes(value));
}

function uniqueIds(found: readonly string[], max: number): string[] {
  return [...new Set(found.filter((id) => isUuid(id)))].slice(0, max);
}

function uniqueNumbers(found: readonly string[], max: number): number[] {
  const numbers = found
    .filter((value) => /^[1-9]\d{0,14}$/.test(value))
    .map((value) => Number(value));
  return [...new Set(numbers)].slice(0, max);
}

function dayOrNull(value: string | null): string | null {
  return value !== null && isDayKey(value) ? value : null;
}

/** The filters an address holds. Anything it says that this build does not understand is dropped. */
export function readFilters(params: URLSearchParams): ArchiveFilters {
  return {
    dateFrom: dayOrNull(params.get('date_from')),
    dateTo: dayOrNull(params.get('date_to')),
    agentIds: uniqueIds(params.getAll('agent_id'), ARCHIVE_MAX_FILTER_IDS),
    groupIds: uniqueNumbers(params.getAll('group_id'), ARCHIVE_MAX_FILTER_IDS),
    rating: oneOf(ARCHIVE_RATING_FILTERS, params.get('rating')),
    tagIds: uniqueIds(params.getAll('tag'), ARCHIVE_MAX_TAGS),
    tagMode: oneOf(ARCHIVE_TAG_MODES, params.get('tag_mode')) ?? 'any',
    untagged: params.get('untagged') === 'true',
    handledBy: pickAll(THREAD_HANDLED_BY, params.getAll('handled_by')),
    riskFlags: pickAll(RISK_FLAG_TYPES, params.getAll('risk_flag')),
    channel: oneOf(ADAPTER_CHANNEL_TYPES, params.get('channel')),
  };
}

/**
 * The filters as the API's query parameters — also the address's own spelling.
 * A default (`tag_mode=any`, no `untagged`) is left out; arrays repeat the key.
 */
export function filterParams(filters: ArchiveFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  for (const id of filters.agentIds) params.append('agent_id', id);
  for (const id of filters.groupIds) params.append('group_id', String(id));
  if (filters.rating) params.set('rating', filters.rating);
  for (const id of filters.tagIds) params.append('tag', id);
  if (filters.tagMode !== 'any') params.set('tag_mode', filters.tagMode);
  if (filters.untagged) params.set('untagged', 'true');
  for (const value of filters.handledBy) params.append('handled_by', value);
  for (const value of filters.riskFlags) params.append('risk_flag', value);
  if (filters.channel) params.set('channel', filters.channel);
  return params;
}

/** The address after the filters changed: the screen's other keys (`c`, `status`, `group`) stay. */
export function writeFilters(params: URLSearchParams, filters: ArchiveFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FILTER_PARAMS) next.delete(key);
  for (const [key, value] of filterParams(filters)) next.append(key, value);
  return next;
}

/** True when any filter narrows the list (a lone `tag_mode` does not). */
export function isFiltered(filters: ArchiveFilters): boolean {
  return (
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.agentIds.length > 0 ||
    filters.groupIds.length > 0 ||
    filters.rating !== null ||
    filters.tagIds.length > 0 ||
    filters.untagged ||
    filters.handledBy.length > 0 ||
    filters.riskFlags.length > 0 ||
    filters.channel !== null
  );
}

/** Filters that cannot all hold. The list is asked for as written; the screen says so. */
export type FilterConflict = 'untagged_with_tags' | 'ai_with_agent' | 'date_order';

/**
 * Combinations that give an empty list (or, for `date_order`, a refused request).
 * They are reported, never repaired: removing one of two filters the person chose
 * would answer a question they did not ask.
 */
export function findConflicts(filters: ArchiveFilters): FilterConflict[] {
  const conflicts: FilterConflict[] = [];
  if (filters.untagged && filters.tagIds.length > 0 && filters.tagMode !== 'exclude') {
    conflicts.push('untagged_with_tags');
  }
  // "Handled by the AI" is a conversation no agent wrote in (ADR-09a).
  if (
    filters.agentIds.length > 0 &&
    filters.handledBy.length > 0 &&
    filters.handledBy.every((value) => value === 'ai')
  ) {
    conflicts.push('ai_with_agent');
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    conflicts.push('date_order');
  }
  return conflicts;
}

/**
 * Whether the agent filter offers everyone or only the caller. A Team Member
 * sees conversations of their teams and the ones they took part in (RL-02), so a
 * roster to pick colleagues from is not theirs: the filter is "me" (AR-02).
 */
export function agentFilterIsSelfOnly(role: string | undefined): boolean {
  return !['owner', 'viceowner', 'admin', 'team_lead'].includes(role ?? '');
}

// --- Dates ------------------------------------------------------------------

/** The day it is on the workspace's own calendar (zone and start hour of its day, ID-04). */
export function todayKey(boundary: DayBoundary, now: Date = new Date()): string {
  try {
    return localDayKey(now, boundary.timezone, boundary.hour);
  } catch {
    // A zone or hour the server would have refused: the shipped default, not a crash.
    return localDayKey(now, DEFAULT_DAY_BOUNDARY.timezone, DEFAULT_DAY_BOUNDARY.hour);
  }
}

export const DATE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface DayRange {
  dateFrom: string;
  dateTo: string;
}

/** A preset as days on the workspace's calendar; `today` is {@link todayKey}. */
export function presetRange(preset: DatePreset, today: string): DayRange {
  switch (preset) {
    case 'today':
      return { dateFrom: today, dateTo: today };
    case 'yesterday': {
      const day = shiftDayKey(today, -1);
      return { dateFrom: day, dateTo: day };
    }
    case 'last7':
      return { dateFrom: shiftDayKey(today, -6), dateTo: today };
    case 'last30':
      return { dateFrom: shiftDayKey(today, -29), dateTo: today };
    case 'thisMonth':
      return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  }
}

/** The first preset the filters' dates are exactly, if any (the chip says "Yesterday", not two dates). */
export function matchPreset(filters: ArchiveFilters, today: string): DatePreset | null {
  for (const preset of DATE_PRESETS) {
    const range = presetRange(preset, today);
    if (filters.dateFrom === range.dateFrom && filters.dateTo === range.dateTo) return preset;
  }
  return null;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
}

/**
 * The range one step ‹ earlier or › later: the same number of days, moved by its
 * own length (a single day moves one day). An open end counts as today. `null`
 * when it cannot move: no start day, a range that runs backwards, or — later —
 * the range already ends today. A step later that would pass today stops at
 * today (the range then ends today), never beyond it.
 */
export function shiftRange(
  filters: ArchiveFilters,
  direction: 'earlier' | 'later',
  today: string,
): DayRange | null {
  if (!filters.dateFrom) return null;
  const to = filters.dateTo ?? today;
  const length = daysBetween(filters.dateFrom, to) + 1;
  if (length < 1) return null;
  let delta = direction === 'earlier' ? -length : length;
  if (direction === 'later') {
    delta = Math.min(length, daysBetween(to, today));
    if (delta <= 0) return null;
  }
  return { dateFrom: shiftDayKey(filters.dateFrom, delta), dateTo: shiftDayKey(to, delta) };
}
