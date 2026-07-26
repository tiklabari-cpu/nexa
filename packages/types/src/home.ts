/**
 * Home dashboard (FR-MOD-13.1).
 *
 * The workspace's landing overview, in three parts:
 *   - an **activation checklist** derived from real setup state (not a stored
 *     to-do list) — each step is "done" because the thing it asks for exists;
 *   - **live counters** — who and what is active right now;
 *   - a **week-over-week performance** summary.
 *
 * Every figure is computed server-side so the cards, the checkmarks and the
 * deltas all quote the same numbers — the client only lays them out. The weekly
 * `chats`/`resolved` are the same window figures the Reports overview calls
 * `chats`/`closed` for an equal range (a deliberate consistency, so the Home
 * glance never disagrees with the full report a click away).
 */

/** The activation milestones, in the order the checklist shows them. */
export const ACTIVATION_STEPS = [
  'install_widget',
  'invite_teammate',
  'customize_widget',
  'add_canned_response',
  'set_up_ai_agent',
] as const;
export type ActivationStepKey = (typeof ACTIVATION_STEPS)[number];

export interface ActivationStep {
  key: ActivationStepKey;
  done: boolean;
}

export interface ActivationChecklist {
  steps: ActivationStep[];
  /** How many steps are done, and how many there are — so a caller need not recount. */
  completed: number;
  total: number;
}

/** The live counters — who and what is active on the workspace right now. */
export interface HomeLiveCounts {
  /** Distinct people on the site now: an open chat, or a visit inside the live window. */
  visitors_online: number;
  /** Conversations currently open. */
  ongoing_chats: number;
  /** Teammates set to accept chats (not suspended). */
  agents_online: number;
}

export interface HomeSatisfaction {
  good: number;
  bad: number;
  responses: number;
  /** Good ÷ rated, or null when nobody rated — an unrated week is unknown, not 0%. */
  score: number | null;
}

export interface HomeWeeklyWindow {
  range: { from: string; to: string };
  /** Conversations started in the window. */
  chats: number;
  /** Conversations started in the window that are now resolved (closed). */
  resolved: number;
}

export interface HomeWeeklyPerformance extends HomeWeeklyWindow {
  satisfaction: HomeSatisfaction;
  /** The equal-length week before, so each KPI can show a week-over-week delta. */
  previous: HomeWeeklyWindow & { satisfaction_score: number | null };
}

export interface HomeDashboard {
  activation: ActivationChecklist;
  live: HomeLiveCounts;
  weekly: HomeWeeklyPerformance;
}
