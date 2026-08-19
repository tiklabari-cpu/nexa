/**
 * Pure view-model logic for the Home dashboard (FR-MOD-13.1).
 *
 * Dependency-free (no React, no fetch, no formatting locale, no i18n) so the
 * card arithmetic — which counter shows what, and how a week-over-week delta
 * reads — can be unit-tested on its own, the same discipline
 * `reports-metrics.ts` follows for the reports rates. The component turns
 * these plain values into formatted, translated, coloured cards; nothing here
 * renders or names a piece of display text — a module-level `t()` call would
 * freeze at import time and never follow a locale switch (I18N-e, tm 133.5),
 * so the label/description strings live in `locales/{en,tr}/home.ts`, keyed by
 * the same `ActivationStepKey`/live-counter key this file already carries.
 */
import type { ActivationStepKey, HomeDashboard } from '@nexa/types';

/** Where each activation step's "do it" link points. */
export const ACTIVATION_STEP_ROUTE: Record<ActivationStepKey, string> = {
  install_widget: '/app/settings',
  invite_teammate: '/app/team',
  customize_widget: '/app/settings#section-widget',
  add_canned_response: '/app/playbook',
  set_up_ai_agent: '/app/playbook',
};

export interface ActivationSummary {
  completed: number;
  total: number;
  allDone: boolean;
  /** 0..1 progress, for a bar. 1 when there are no steps (nothing left to do). */
  ratio: number;
}

export function activationSummary(activation: HomeDashboard['activation']): ActivationSummary {
  const { completed, total } = activation;
  return {
    completed,
    total,
    allDone: total > 0 && completed >= total,
    ratio: total === 0 ? 1 : completed / total,
  };
}

export interface LiveCardModel {
  key: keyof HomeDashboard['live'];
  value: number;
}

/** The three live counters, in display order. */
export function liveCards(live: HomeDashboard['live']): LiveCardModel[] {
  return [
    { key: 'visitors_online', value: live.visitors_online },
    { key: 'ongoing_chats', value: live.ongoing_chats },
    { key: 'agents_online', value: live.agents_online },
  ];
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface CountDelta {
  direction: DeltaDirection;
  /** Signed change from previous to current (current − previous). */
  change: number;
}

/**
 * Week-over-week change of a count. `flat` when unchanged, so the component can
 * render a neutral "no change" rather than a coloured arrow that implies motion.
 */
export function countDelta(current: number, previous: number): CountDelta {
  const change = current - previous;
  return { direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat', change };
}

export interface ScoreDelta {
  direction: DeltaDirection;
  /** Change in percentage *points* (e.g. 0.62 → 0.57 is −5), or null when unknowable. */
  points: number;
}

/**
 * Week-over-week change of a satisfaction score (a 0..1 rate). Null when either
 * week is unrated: a delta against "unknown" is not −100%, it is no delta at
 * all, so the card shows the score without a misleading arrow.
 */
export function scoreDelta(current: number | null, previous: number | null): ScoreDelta | null {
  if (current == null || previous == null) return null;
  const points = Math.round((current - previous) * 100);
  return { direction: points > 0 ? 'up' : points < 0 ? 'down' : 'flat', points };
}
