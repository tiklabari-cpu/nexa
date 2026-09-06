/**
 * Authoring a skill's step list: add, remove, retype, edit (FR-MOD-06.2.4).
 *
 * `step-reorder.ts` next door answers "what order do they run in?"; this file
 * answers "what steps are there at all?". They were separate questions until
 * now only because the editor could not answer the second one: a skill created
 * from "New skill" is born with `steps: []` and nothing in the UI could ever
 * give it one, so the whole ordered-steps surface was unreachable for anything
 * but a template.
 *
 * The logic lives here rather than in the component for the same reason
 * `moveStep` does: an off-by-one in a splice is invisible in a rendered list
 * and obvious in a unit test.
 *
 * Two invariants this file exists to hold:
 *
 * 1. **Retyping drops what the old type owned.** A `send_message` that becomes
 *    a `tag` must not keep `source`/`text` — the server's `validateStep`
 *    (`@nexa/ai-mock`) reads the discriminant and would either reject the step
 *    or store fields the engine never looks at. Dropping them here is what
 *    keeps the client's idea of a valid step inside the server's.
 * 2. **Ids are never reused.** `id` is the React key of a reorderable row, so a
 *    recycled id makes React move the wrong DOM node — and with it the
 *    keyboard focus of whoever is reordering by ↑/↓.
 */
import type { SkillStep } from './types.js';

export type StepType = SkillStep['type'];

/**
 * The six the PRD names, in the order the "add a step" control offers them —
 * roughly the order a skill reads: decide, gather, label, summarise, answer,
 * hand over. A seventh type is out of scope by definition: the vocabulary is
 * the contract `@nexa/ai-mock`'s `SKILL_STEP_TYPES` enforces server-side.
 */
export const STEP_TYPES = [
  'detect_intent',
  'request_info',
  'tag',
  'summarize',
  'send_message',
  'transfer_to_team',
] as const;

/**
 * Which fields each type owns. The single source for both "what does a new step
 * of this type look like?" and "what survives a retype?" — two rules that would
 * drift apart if written twice.
 */
const STEP_FIELDS: Record<StepType, readonly string[]> = {
  detect_intent: ['intent', 'phrases'],
  request_info: ['field', 'prompt'],
  tag: ['tag'],
  summarize: [],
  send_message: ['source', 'text'],
  transfer_to_team: ['group'],
};

/**
 * A step of `type` with its required fields present but empty.
 *
 * Empty rather than absent on purpose: `stepIssues` then reports it as a step
 * missing a required parameter — which blocks the save and names the row —
 * instead of the editor quietly offering to store something the server would
 * refuse with a step number and no other context.
 *
 * `phrases` is left off: it is genuinely optional (the intent name is the
 * fallback), and an empty array would be stored noise.
 */
export function blankStep(type: StepType): SkillStep {
  switch (type) {
    case 'detect_intent':
      return { type, intent: '' };
    case 'request_info':
      return { type, field: '', prompt: '' };
    case 'tag':
      return { type, tag: '' };
    case 'summarize':
      return { type };
    case 'send_message':
      return { type, source: 'text', text: '' };
    case 'transfer_to_team':
      return { type, group: '' };
  }
}

/**
 * A step paired with a stable client id.
 *
 * The id is what lets the list key by identity rather than position, which is
 * what lets the browser keep focus on a row while it moves — the keyboard
 * reorder alternative (NFR-A11Y4) depends on it.
 */
export interface StepEntry {
  id: string;
  step: SkillStep;
}

let stepSeq = 0;

/** Wrap a step in a never-before-used id. */
export function toEntry(step: SkillStep): StepEntry {
  stepSeq += 1;
  return { id: `step-${stepSeq}`, step };
}

/** Wrap a whole list, e.g. when the editor opens or a compile replaces it. */
export function toEntries(steps: readonly SkillStep[]): StepEntry[] {
  return steps.map(toEntry);
}

/** Append a blank step of `type`. New steps go last: a skill reads top-down. */
export function addStep(entries: readonly StepEntry[], type: StepType): StepEntry[] {
  return [...entries, toEntry(blankStep(type))];
}

/** Drop the step at `index`, leaving the order of the rest untouched. */
export function removeStep(entries: readonly StepEntry[], index: number): StepEntry[] {
  if (index < 0 || index >= entries.length) return [...entries];
  return entries.filter((_entry, i) => i !== index);
}

/**
 * Retype the step at `index`, keeping its row identity and dropping every field
 * the new type does not own (see invariant 1 above).
 */
export function changeStepType(
  entries: readonly StepEntry[],
  index: number,
  type: StepType,
): StepEntry[] {
  const entry = entries[index];
  if (!entry || entry.step.type === type) return [...entries];

  const previous = entry.step as unknown as Record<string, unknown>;
  const carried: Record<string, unknown> = {};
  for (const field of STEP_FIELDS[type]) {
    if (previous[field] !== undefined) carried[field] = previous[field];
  }

  const step = { ...blankStep(type), ...carried } as SkillStep;
  return entries.map((current, i) => (i === index ? { id: current.id, step } : current));
}

/**
 * Merge `patch` into the step at `index`. A key set to `undefined` is *removed*
 * rather than stored as undefined, so clearing an optional field (`phrases`)
 * leaves the same JSON a step that never had it would produce — which is what
 * keeps the editor's "is there anything to save?" comparison honest.
 */
export function updateStep(
  entries: readonly StepEntry[],
  index: number,
  patch: Partial<SkillStep>,
): StepEntry[] {
  const entry = entries[index];
  if (!entry) return [...entries];

  const next: Record<string, unknown> = { ...entry.step };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }

  return entries.map((current, i) =>
    i === index ? { id: current.id, step: next as unknown as SkillStep } : current,
  );
}

/**
 * The phrase list as typed: one per line, blanks ignored.
 *
 * `undefined` for an empty box rather than `[]` — `phrases` is optional, and
 * storing an empty array would make a step that has never had phrases differ
 * from one whose phrases were cleared.
 */
export function parsePhrases(value: string): string[] | undefined {
  const phrases = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return phrases.length > 0 ? phrases : undefined;
}

/** The inverse, for filling the textarea from a stored step. */
export function formatPhrases(phrases: readonly string[] | undefined): string {
  return (phrases ?? []).join('\n');
}
