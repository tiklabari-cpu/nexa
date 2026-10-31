/**
 * Reports "Save view" (FR-MOD-07.7, 07.7-h). An agent captures the current
 * report window — tab, date range, benchmark baseline — under a name and it
 * comes back on every reload. Per-browser like Inbox's saved filters
 * (`features/inbox/views.ts`), not shared workspace configuration.
 *
 * Deliberately a separate copy of that store rather than a shared generic
 * one: Inbox and Reports already have independent `tab`/`mode` domains, and a
 * shared store would force one feature's shape onto the other or hide a
 * divergence bug between them. Own `STORAGE_KEY` so the two never collide.
 *
 * Pure functions plus a storage-backed hook, tested in isolation the way
 * Inbox's is. UI binding (the save/apply/delete controls) is 07.7-k.
 */
import { useState } from 'react';
import { matchRank } from '../../lib/text-fold.js';
import {
  NO_REPORT_FILTER,
  isReportFilterEmpty,
  normalizeReportFilter,
  type ReportFilterState,
} from './report-filters.js';

/**
 * Mirrors `TabId` in `ReportsPage.tsx` — kept independent so this module has
 * no import edge to the page component (07.7-k wires the two together, in the
 * other direction: the page imports this type, not the reverse).
 *
 * Written before 07.7-i/-j added the four v2 tabs (Cases, Leads, Sales, Team
 * performance); extended here so a view saved on one of those tabs round-trips
 * instead of being silently dropped by `isSavedReportView` as unrecognised.
 */
export type ReportTabId =
  | 'overview'
  | 'ai-agent'
  | 'reviews'
  | 'breakdown'
  | 'staffing'
  | 'topics'
  | 'cases'
  | 'leads'
  | 'sales'
  | 'team-performance';

/** Mirrors `RangeMode` in `ReportsPage.tsx`. */
export type ReportRangeMode = 7 | 30 | 90 | 365 | 'custom';

/** Mirrors `BenchmarkBaseline` (`apps/api/src/routes/reports-metrics.ts`, 07.7-e). */
export type ReportBaseline = 'previous_period' | 'previous_year';

/** A named report filter an agent saved. */
export interface SavedReportView {
  id: string;
  name: string;
  tab: ReportTabId;
  mode: ReportRangeMode;
  customFrom: string;
  customTo: string;
  /** `null` when the view was saved with no benchmark comparison active. */
  baseline: ReportBaseline | null;
  /**
   * Which conversations the view counts (RP-01 · tm 368.2) — identifiers only.
   * Absent on a view saved before filters existed, and on one saved with none.
   */
  filter?: ReportFilterState;
}

/** The filter a "Save current view" action captures. */
export interface SavedReportViewInput {
  name: string;
  tab: ReportTabId;
  mode: ReportRangeMode;
  customFrom: string;
  customTo: string;
  baseline: ReportBaseline | null;
  filter?: ReportFilterState;
}

/** The report filter a saved view applies: its own, or none. */
export function savedViewFilter(view: SavedReportView): ReportFilterState {
  return view.filter ? normalizeReportFilter(view.filter) : NO_REPORT_FILTER;
}

const STORAGE_KEY = 'siyahtus.reports.saved-views';
export const SAVED_REPORT_VIEW_NAME_MAX = 40;

export const REPORT_TABS: readonly ReportTabId[] = [
  'overview',
  'ai-agent',
  'reviews',
  'breakdown',
  'staffing',
  'topics',
  'cases',
  'leads',
  'sales',
  'team-performance',
];
const REPORT_RANGE_MODES: ReportRangeMode[] = [7, 30, 90, 365, 'custom'];
const REPORT_BASELINES: ReportBaseline[] = ['previous_period', 'previous_year'];

/** `localStorage` can throw on access (private mode, sandboxed frames). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isReportRangeMode(value: unknown): value is ReportRangeMode {
  return (REPORT_RANGE_MODES as unknown[]).includes(value);
}

/** A stored filter is four lists of strings; `normalizeReportFilter` drops what is not an identifier. */
function isStoredFilter(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every(
    (list) => Array.isArray(list) && list.every((entry) => typeof entry === 'string'),
  );
}

/**
 * Accept only well-formed rows, so a hand-edited or stale `localStorage`
 * value — or a token from an older build — can never apply a tab/mode/
 * baseline this build does not understand.
 */
function isSavedReportView(value: unknown): value is SavedReportView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['tab'] === 'string' &&
    (REPORT_TABS as string[]).includes(v['tab']) &&
    isReportRangeMode(v['mode']) &&
    typeof v['customFrom'] === 'string' &&
    typeof v['customTo'] === 'string' &&
    (v['baseline'] === null ||
      (typeof v['baseline'] === 'string' &&
        (REPORT_BASELINES as string[]).includes(v['baseline']))) &&
    (v['filter'] === undefined || isStoredFilter(v['filter']))
  );
}

/** Read the saved views, dropping anything malformed. */
export function loadSavedReportViews(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): SavedReportView[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedReportView) : [];
  } catch {
    return [];
  }
}

/** Persist the saved views; a write that fails simply resets on the next load. */
export function saveSavedReportViews(
  views: SavedReportView[],
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // A view that cannot be remembered is not worth failing the click over.
  }
}

/**
 * A stable-enough id for a saved view. `crypto.randomUUID` where available,
 * else a short random fallback — the id only needs to be unique within one
 * browser's saved list.
 */
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the fallback
  }
  return `srv_${Math.random().toString(36).slice(2)}`;
}

/**
 * Append a saved view built from a name and the current filter. The name is
 * trimmed and capped; an empty name is rejected — the list is returned
 * unchanged with `added: null` so the caller can keep its input open rather
 * than storing a nameless view.
 */
export function addSavedReportView(
  views: SavedReportView[],
  input: SavedReportViewInput,
  makeId: () => string = newId,
): { views: SavedReportView[]; added: SavedReportView | null } {
  const name = input.name.trim().slice(0, SAVED_REPORT_VIEW_NAME_MAX);
  if (name.length === 0) return { views, added: null };
  const view: SavedReportView = {
    id: makeId(),
    name,
    tab: input.tab,
    mode: input.mode,
    customFrom: input.customFrom,
    customTo: input.customTo,
    baseline: input.baseline,
    // Left out when nothing narrows, so a view without filters stays the shape
    // it always was (and an older build reads it unchanged).
    ...(input.filter && !isReportFilterEmpty(input.filter)
      ? { filter: normalizeReportFilter(input.filter) }
      : {}),
  };
  return { views: [...views, view], added: view };
}

/** Drop a saved view by id. */
export function removeSavedReportView(views: SavedReportView[], id: string): SavedReportView[] {
  return views.filter((v) => v.id !== id);
}

/**
 * The saved report views, persisted across reloads. Returns the list and the
 * two ways to change it: `add` (returns the created view, or null if the
 * name was empty) and `remove`.
 */
export function useSavedReportViews(): {
  views: SavedReportView[];
  add: (input: SavedReportViewInput) => SavedReportView | null;
  remove: (id: string) => void;
} {
  // Lazy initialiser: read the remembered list once, on mount — which is what
  // a page reload replays.
  const [views, setViews] = useState<SavedReportView[]>(loadSavedReportViews);

  const apply = (next: SavedReportView[]): void => {
    setViews(next);
    saveSavedReportViews(next);
  };

  return {
    views,
    add: (input) => {
      const { views: next, added } = addSavedReportView(views, input);
      if (added) apply(next);
      return added;
    },
    remove: (id) => apply(removeSavedReportView(views, id)),
  };
}

/** `ReportTabId` → its catalogue key; the page and the command palette read the one table. */
export const REPORT_TAB_LABEL_KEYS: Record<ReportTabId, string> = {
  overview: 'reports.tabs.overview',
  'ai-agent': 'reports.tabs.aiAgent',
  reviews: 'reports.tabs.reviews',
  breakdown: 'reports.tabs.breakdown',
  staffing: 'reports.tabs.staffing',
  topics: 'reports.tabs.topics',
  cases: 'reports.tabs.cases',
  leads: 'reports.tabs.leads',
  sales: 'reports.tabs.sales',
  'team-performance': 'reports.tabs.teamPerformance',
};

/** A tab id read off an address; anything this build does not know is `null`. */
export function parseReportTab(value: string | null): ReportTabId | null {
  return value !== null && (REPORT_TABS as readonly string[]).includes(value)
    ? (value as ReportTabId)
    : null;
}

/** Where a report view opens: a tab, or a saved view by id (the page applies it). */
export function reportsHref(target: { tab: ReportTabId } | { viewId: string }): string {
  return 'tab' in target
    ? `/app/reports?tab=${target.tab}`
    : `/app/reports?view=${encodeURIComponent(target.viewId)}`;
}

/** One report view the command palette offers (IN-11). */
export interface ReportViewMatch {
  id: string;
  /** The tab's own label, or the saved view's name. */
  label: string;
  /** For a saved view, the tab it opens on; absent on a tab. */
  sub?: string;
  href: string;
}

/**
 * Report views — the tabs, then the agent's saved views — whose label matches
 * `query`, ranked like the settings sections (label start, label inside, then
 * the tab id as an alias), at most `limit`. The caller decides who may see
 * reports at all; this only matches.
 */
export function searchReportViews(
  query: string,
  labelOf: (tab: ReportTabId) => string,
  savedViews: readonly SavedReportView[],
  limit = 6,
): ReportViewMatch[] {
  const found: { match: ReportViewMatch; rank: number; order: number }[] = [];
  let order = 0;
  for (const tab of REPORT_TABS) {
    const rank = matchRank(query, labelOf(tab), [tab.replace(/-/g, ' ')]);
    if (rank !== null) {
      found.push({
        match: { id: `tab:${tab}`, label: labelOf(tab), href: reportsHref({ tab }) },
        rank,
        order: order++,
      });
    }
  }
  for (const view of savedViews) {
    const rank = matchRank(query, view.name);
    if (rank !== null) {
      found.push({
        match: {
          id: `view:${view.id}`,
          label: view.name,
          sub: labelOf(view.tab),
          href: reportsHref({ viewId: view.id }),
        },
        rank,
        order: order++,
      });
    }
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((f) => f.match);
}
