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
 * Why a step list was refused, as a stable code. `reason` below is the English
 * sentence for API callers; the console words the code in its own language
 * (tm 261), so a Turkish editor does not read "transfer_to_team needs a team".
 */
export const STEP_PROBLEM_CODES = [
  'steps_not_array',
  'step_not_object',
  'unknown_step_type',
  'detect_intent_needs_intent',
  'detect_intent_bad_phrases',
  'request_info_needs_field',
  'request_info_needs_prompt',
  'tag_needs_tag',
  'send_message_bad_source',
  'send_message_needs_text',
  'transfer_to_team_needs_team',
] as const;

export type StepProblemCode = (typeof STEP_PROBLEM_CODES)[number];

/** A refusal: the sentence, its code, and the step type the sentence names (unknown type only). */
export interface StepProblem {
  ok: false;
  reason: string;
  code: StepProblemCode;
  type?: string;
}

/**
 * Validate a step that arrived as JSON — from the database, or from an API
 * caller editing steps directly.
 *
 * Returns a reason rather than a boolean: the editor shows it, and "invalid
 * step" alone gives an admin nothing to act on.
 */
export function validateStep(value: unknown): { ok: true; step: SkillStep } | StepProblem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'step must be an object', code: 'step_not_object' };
  }
  const step = value as Record<string, unknown>;
  const type = step['type'];

  if (typeof type !== 'string' || !(SKILL_STEP_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      reason: `unknown step type: ${String(type)}`,
      code: 'unknown_step_type',
      type: String(type),
    };
  }

  switch (type as SkillStepType) {
    case 'detect_intent': {
      if (!nonEmptyString(step['intent'])) {
        return {
          ok: false,
          reason: 'detect_intent needs an intent',
          code: 'detect_intent_needs_intent',
        };
      }
      const phrases = step['phrases'];
      if (phrases !== undefined && !isStringArray(phrases)) {
        return {
          ok: false,
          reason: 'detect_intent phrases must be strings',
          code: 'detect_intent_bad_phrases',
        };
      }
      return { ok: true, step: value as DetectIntentStep };
    }
    case 'request_info':
      if (!nonEmptyString(step['field'])) {
        return {
          ok: false,
          reason: 'request_info needs a field',
          code: 'request_info_needs_field',
        };
      }
      if (!nonEmptyString(step['prompt'])) {
        return {
          ok: false,
          reason: 'request_info needs a prompt',
          code: 'request_info_needs_prompt',
        };
      }
      return { ok: true, step: value as RequestInfoStep };
    case 'tag':
      if (!nonEmptyString(step['tag'])) {
        return { ok: false, reason: 'tag needs a tag name', code: 'tag_needs_tag' };
      }
      return { ok: true, step: value as TagStep };
    case 'summarize':
      return { ok: true, step: { type: 'summarize' } };
    case 'send_message': {
      const source = step['source'];
      if (source !== 'text' && source !== 'knowledge') {
        return {
          ok: false,
          reason: 'send_message source must be text or knowledge',
          code: 'send_message_bad_source',
        };
      }
      // A fixed reply with no text would send an empty message to a customer.
      if (source === 'text' && !nonEmptyString(step['text'])) {
        return {
          ok: false,
          reason: 'send_message with source text needs the text',
          code: 'send_message_needs_text',
        };
      }
      return { ok: true, step: value as SendMessageStep };
    }
    case 'transfer_to_team':
      if (!nonEmptyString(step['group'])) {
        return {
          ok: false,
          reason: 'transfer_to_team needs a team',
          code: 'transfer_to_team_needs_team',
        };
      }
      return { ok: true, step: value as TransferToTeamStep };
  }
}

export function validateSteps(
  value: unknown,
): { ok: true; steps: SkillStep[] } | (StepProblem & { index: number }) {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'steps must be an array', code: 'steps_not_array', index: -1 };
  }

  const steps: SkillStep[] = [];
  for (const [index, raw] of value.entries()) {
    const result = validateStep(raw);
    if (!result.ok) return { ...result, index };
    steps.push(result.step);
  }
  return { ok: true, steps };
}

/**
 * What a client needs to word a refusal itself: the code as `reason`, the
 * 1-based `step` it concerns (absent when the list as a whole was refused) and
 * the `type` an unknown-type sentence names. Goes in `error.details` on a write
 * and in `error_details` on a preview.
 */
export interface StepProblemDetails {
  reason: StepProblemCode;
  step?: number;
  type?: string;
}

export function stepProblemDetails(problem: StepProblem & { index: number }): StepProblemDetails {
  return {
    reason: problem.code,
    ...(problem.index >= 0 ? { step: problem.index + 1 } : {}),
    ...(problem.type !== undefined ? { type: problem.type } : {}),
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
