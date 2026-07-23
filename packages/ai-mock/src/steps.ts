/**
 * Skill step vocabulary (PRD FR-MOD-06.2.4).
 *
 * A discriminated union rather than a bag of optional fields, so a step that
 * cannot work — a transfer with no team, a fixed reply with no text — fails to
 * type-check instead of failing silently in front of a customer.
 */

export const SKILL_STEP_TYPES = [
  'detect_intent',
  'request_info',
  'tag',
  'summarize',
  'send_message',
  'transfer_to_team',
] as const;

export type SkillStepType = (typeof SKILL_STEP_TYPES)[number];

/** Gate: the skill only continues when the message matches. */
export interface DetectIntentStep {
  type: 'detect_intent';
  intent: string;
  /** Phrases to look for. Falls back to the intent name when empty. */
  phrases?: string[];
}

/** Ask for something, once, and remember it was asked. */
export interface RequestInfoStep {
  type: 'request_info';
  field: string;
  prompt: string;
}

export interface TagStep {
  type: 'tag';
  tag: string;
}

export interface SummarizeStep {
  type: 'summarize';
}

/** Either a fixed reply or one retrieved from the knowledge base. */
export interface SendMessageStep {
  type: 'send_message';
  source: 'text' | 'knowledge';
  text?: string;
}

export interface TransferToTeamStep {
  type: 'transfer_to_team';
  group: string;
}

export type SkillStep =
  | DetectIntentStep
  | RequestInfoStep
  | TagStep
  | SummarizeStep
  | SendMessageStep
  | TransferToTeamStep;

/**
 * Validate a step that arrived as JSON — from the database, or from an API
 * caller editing steps directly.
 *
 * Returns a reason rather than a boolean: the editor shows it, and "invalid
 * step" alone gives an admin nothing to act on.
 */
export function validateStep(
  value: unknown,
): { ok: true; step: SkillStep } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'step must be an object' };
  }
  const step = value as Record<string, unknown>;
  const type = step['type'];

  if (typeof type !== 'string' || !(SKILL_STEP_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: `unknown step type: ${String(type)}` };
  }

  switch (type as SkillStepType) {
    case 'detect_intent': {
      if (!nonEmptyString(step['intent']))
        return { ok: false, reason: 'detect_intent needs an intent' };
      const phrases = step['phrases'];
      if (phrases !== undefined && !isStringArray(phrases)) {
        return { ok: false, reason: 'detect_intent phrases must be strings' };
      }
      return { ok: true, step: value as DetectIntentStep };
    }
    case 'request_info':
      if (!nonEmptyString(step['field']))
        return { ok: false, reason: 'request_info needs a field' };
      if (!nonEmptyString(step['prompt']))
        return { ok: false, reason: 'request_info needs a prompt' };
      return { ok: true, step: value as RequestInfoStep };
    case 'tag':
      if (!nonEmptyString(step['tag'])) return { ok: false, reason: 'tag needs a tag name' };
      return { ok: true, step: value as TagStep };
    case 'summarize':
      return { ok: true, step: { type: 'summarize' } };
    case 'send_message': {
      const source = step['source'];
      if (source !== 'text' && source !== 'knowledge') {
        return { ok: false, reason: 'send_message source must be text or knowledge' };
      }
      // A fixed reply with no text would send an empty message to a customer.
      if (source === 'text' && !nonEmptyString(step['text'])) {
        return { ok: false, reason: 'send_message with source text needs the text' };
      }
      return { ok: true, step: value as SendMessageStep };
    }
    case 'transfer_to_team':
      if (!nonEmptyString(step['group'])) {
        return { ok: false, reason: 'transfer_to_team needs a team' };
      }
      return { ok: true, step: value as TransferToTeamStep };
  }
}

export function validateSteps(
  value: unknown,
): { ok: true; steps: SkillStep[] } | { ok: false; reason: string; index: number } {
  if (!Array.isArray(value)) return { ok: false, reason: 'steps must be an array', index: -1 };

  const steps: SkillStep[] = [];
  for (const [index, raw] of value.entries()) {
    const result = validateStep(raw);
    if (!result.ok) return { ok: false, reason: result.reason, index };
    steps.push(result.step);
  }
  return { ok: true, steps };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
