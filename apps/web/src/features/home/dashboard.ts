/**
 * Pure view-model logic for the Home dashboard (FR-MOD-13.1).
 *
 * Dependency-free (no React, no fetch, no formatting locale) so the card
 * arithmetic — which counter shows what, and how a week-over-week delta reads —
 * can be unit-tested on its own, the same discipline `reports-metrics.ts`
 * follows for the reports rates. The component turns these plain values into
 * formatted, coloured cards; nothing here renders.
 */
import type { ActivationStepKey, HomeDashboard } from '@nexa/types';

/** Display copy for each activation step, and where the "do it" link points. */
export interface ActivationStepCopy {
  label: string;
  description: string;
  /** The module that completes this step. */
  to: string;
}

export const ACTIVATION_COPY: Record<ActivationStepKey, ActivationStepCopy> = {
  install_widget: {
    label: 'Install the chat widget',
    description: 'Add your website so the widget can go live on it.',
    to: '/app/settings',
  },
  invite_teammate: {
    label: 'Invite a teammate',
    description: 'Bring the rest of your team into the workspace.',
    to: '/app/team',
  },
  customize_widget: {
    label: 'Customize your widget',
    description: 'Match the widget’s colour, theme and position to your brand.',
    to: '/app/settings#section-widget',
  },
  add_canned_response: {
    label: 'Create a canned response',
    description: 'Save a reply your team can drop in with #.',
    to: '/app/playbook',
  },
  set_up_ai_agent: {
    label: 'Set up an AI Agent',
    description: 'Let the AI answer the easy questions before a human steps in.',
    to: '/app/playbook',
  },
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
  label: string;
  value: number;
  hint: string;
}

/** The three live counters, in display order, with their labels. */
export function liveCards(live: HomeDashboard['live']): LiveCardModel[] {
  return [
    {
      key: 'visitors_online',
      label: 'Visitors online',
      value: live.visitors_online,
      hint: 'On the site right now',
    },
    {
      key: 'ongoing_chats',
      label: 'Ongoing chats',
      value: live.ongoing_chats,
      hint: 'Open conversations',
    },
    {
      key: 'agents_online',
      label: 'Agents online',
      value: live.agents_online,
      hint: 'Accepting chats',
    },
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
