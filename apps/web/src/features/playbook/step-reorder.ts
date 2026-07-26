/**
 * Reordering skill steps, and the required-parameter check that gates a save.
 *
 * Order is behaviour: a `transfer_to_team` before a `send_message` hands the
 * conversation off and the reply never runs; swap them and the customer gets an
 * answer first. So the step list is reorderable — by drag for a mouse, and by
 * keyboard for everyone the drag excludes (NFR-A11Y4). Both paths go through
 * `moveStep` so they can never disagree about what the new order is.
 *
 * A step can also be reordered (or compiled) into a shape the engine cannot run
 * — most often a hand-over with no team named. `stepIssues` finds those so the
 * editor can refuse the save and say which step and why, rather than storing a
 * step that would be skipped in silence when a customer is waiting.
 */
import { describeStep, type SkillStep } from './types.js';

/**
 * Move the step at `from` to index `to`, returning a new array. Out-of-range or
 * no-op moves return an unchanged copy, so a caller never has to guard the edges
 * of the list before calling.
 */
export function moveStep<T>(steps: readonly T[], from: number, to: number): T[] {
  const next = [...steps];
  if (from < 0 || from >= next.length) return next;
  const clampedTo = Math.max(0, Math.min(to, next.length - 1));
  if (clampedTo === from) return next;
  const [moved] = next.splice(from, 1);
  next.splice(clampedTo, 0, moved as T);
  return next;
}

/** Human-readable move confirmation for the aria-live region a keyboard user hears. */
export function describeMove(steps: readonly SkillStep[], from: number, to: number): string {
  const clampedTo = Math.max(0, Math.min(to, steps.length - 1));
  const step = steps[from];
  const label = step ? describeStep(step) : 'Step';
  return `Moved “${label}” to position ${clampedTo + 1} of ${steps.length}.`;
}

export interface StepIssue {
  index: number;
  message: string;
}

/**
 * Required-parameter problems in a step list, in list order.
 *
 * The engine validates the same rules server-side, but a client check lets the
 * editor disable Save and name the offender the moment a required field is
 * cleared — the transfer target being the parameter an admin most often empties
 * while editing (FR-MOD-06.2.4).
 */
export function stepIssues(steps: readonly SkillStep[]): StepIssue[] {
  const issues: StepIssue[] = [];
  steps.forEach((step, index) => {
    const message = issueFor(step);
    if (message) issues.push({ index, message });
  });
  return issues;
}

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

/** The one missing required parameter for a step, or null when it is runnable. */
function issueFor(step: SkillStep): string | null {
  switch (step.type) {
    case 'transfer_to_team':
      return isBlank(step.group) ? 'Choose a team to hand the conversation over to.' : null;
    case 'detect_intent':
      return isBlank(step.intent) ? 'Name the intent this step should match.' : null;
    case 'request_info':
      if (isBlank(step.field)) return 'Name the information to collect.';
      return isBlank(step.prompt) ? 'Write the question to ask for it.' : null;
    case 'tag':
      return isBlank(step.tag) ? 'Name the tag to apply.' : null;
    case 'send_message':
      // A knowledge answer needs no text; a fixed reply cannot be empty.
      return step.source === 'text' && isBlank(step.text)
        ? 'Write the reply to send, or answer from knowledge instead.'
        : null;
    case 'summarize':
      return null;
    default:
      return null;
  }
}
