/**
 * Traffic's status tabs (FR-MOD-13.2, rapor-1 §644) — All plus the six funnel
 * states, in the order the module lists them.
 *
 * Unlike `knowledge-tabs.ts` / `skill-tabs.ts`, a tab here is not a
 * client-side partition of an already-loaded list: which visitors show under
 * a tab is decided by the server (`GET /traffic?activity=…`, 13.2-f "Match
 * all filters"). These helpers only say *what to ask the server for* and,
 * given a list, *how many landed where* — they never re-filter a response
 * themselves, so the board and the tab strip cannot disagree about who is on
 * it.
 */
import type { TrafficActivity, TrafficVisitor } from './types.js';

export type TrafficTab = 'all' | TrafficActivity;

export interface TrafficTabDef {
  id: TrafficTab;
  label: string;
}

/** rapor-1 §644 order, left to right — not the funnel/enum order. */
export const TRAFFIC_TABS: readonly TrafficTabDef[] = [
  { id: 'all', label: 'All' },
  { id: 'chatting', label: 'Chatting' },
  { id: 'supervised', label: 'Supervised' },
  { id: 'queued', label: 'Queued' },
  { id: 'waiting', label: 'Waiting for reply' },
  { id: 'invited', label: 'Invited' },
  { id: 'browsing', label: 'Browsing' },
];

const TAB_IDS: readonly string[] = TRAFFIC_TABS.map((tab) => tab.id);

/**
 * Whether a value (typically read straight from a URL parameter) names one of
 * the tabs. An unrecognized value is not an error — the caller falls back to
 * `all`, the same safe-failure rule `isKnowledgeType` uses.
 */
export function isTrafficTab(value: string | null): value is TrafficTab {
  return value !== null && TAB_IDS.includes(value);
}

/**
 * The `activity` values a tab asks the server for. `all` sends none — the
 * API already treats an omitted `activity` as "every state" — so selecting it
 * never adds a constraint the server would not already apply.
 */
export function tabToActivity(tab: TrafficTab): TrafficActivity[] | undefined {
  return tab === 'all' ? undefined : [tab];
}

type VisitorFacet = Pick<TrafficVisitor, 'activity'>;

/**
 * How many visitors of a loaded list land under each tab. Trustworthy only
 * for a list that reflects a tab's true membership — the response to the
 * unfiltered `all` query — since a narrower response only ever reports the
 * visitors it was asked for, not the rest of the board.
 */
export function countByTab(visitors: readonly VisitorFacet[]): Record<TrafficTab, number> {
  const counts: Record<TrafficTab, number> = {
    all: visitors.length,
    chatting: 0,
    supervised: 0,
    queued: 0,
    waiting: 0,
    invited: 0,
    browsing: 0,
  };
  for (const visitor of visitors) counts[visitor.activity] += 1;
  return counts;
}
