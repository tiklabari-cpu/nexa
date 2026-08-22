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
import type { OnboardingSurveyAnswer } from './domain.js';

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

/**
 * Which activation step a "What are you tracking?" survey answer (FR-MOD-07.2)
 * says matters most — the checklist brings that one step to the front, the
 * rest keep their usual order. A goal without an obvious single step
 * (`revenue_impact`) or without a signal at all (`other`, or the popover never
 * answered) leaves the default order alone.
 */
export const SURVEY_ANSWER_PRIORITY_STEP: Partial<
  Record<OnboardingSurveyAnswer, ActivationStepKey>
> = {
  agent_performance: 'set_up_ai_agent',
  team_sharing: 'invite_teammate',
  spotting_problems: 'install_widget',
  revenue_impact: 'customize_widget',
};

/** `ACTIVATION_STEPS`, resequenced so the survey's preferred step (if any) leads. */
export function orderActivationSteps(
  signal: OnboardingSurveyAnswer | null,
): readonly ActivationStepKey[] {
  const preferred = signal ? SURVEY_ANSWER_PRIORITY_STEP[signal] : undefined;
  if (!preferred) return ACTIVATION_STEPS;
  return [preferred, ...ACTIVATION_STEPS.filter((key) => key !== preferred)];
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
