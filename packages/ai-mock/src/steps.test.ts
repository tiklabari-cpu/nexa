/**
 * `validateSteps` refuses a step list with an English sentence for API callers
 * and a stable code for a console that words it in its own language (tm 261).
 * The two must not drift: every sentence has exactly one code, and the code
 * list is closed.
 */
import { describe, expect, it } from 'vitest';
import { STEP_PROBLEM_CODES, stepProblemDetails, validateSteps } from './steps.js';

const REFUSED: Array<[string, unknown, string, string]> = [
  ['a step that is not an object', ['nope'], 'step_not_object', 'step must be an object'],
  ['an unrecognised type', [{ type: 'dance' }], 'unknown_step_type', 'unknown step type: dance'],
  [
    'detect_intent with no intent',
    [{ type: 'detect_intent', intent: ' ' }],
    'detect_intent_needs_intent',
    'detect_intent needs an intent',
  ],
  [
    'detect_intent phrases that are not strings',
    [{ type: 'detect_intent', intent: 'refund', phrases: [1] }],
    'detect_intent_bad_phrases',
    'detect_intent phrases must be strings',
  ],
  [
    'request_info with no field',
    [{ type: 'request_info', prompt: 'Which order?' }],
    'request_info_needs_field',
    'request_info needs a field',
  ],
  [
    'request_info with no prompt',
    [{ type: 'request_info', field: 'order' }],
    'request_info_needs_prompt',
    'request_info needs a prompt',
  ],
  ['tag with no name', [{ type: 'tag' }], 'tag_needs_tag', 'tag needs a tag name'],
  [
    'send_message with no source',
    [{ type: 'send_message' }],
    'send_message_bad_source',
    'send_message source must be text or knowledge',
  ],
  [
    'send_message text with no text',
    [{ type: 'send_message', source: 'text' }],
    'send_message_needs_text',
    'send_message with source text needs the text',
  ],
  [
    'transfer_to_team with no team',
    [{ type: 'transfer_to_team' }],
    'transfer_to_team_needs_team',
    'transfer_to_team needs a team',
  ],
];

describe('step problem codes', () => {
  it.each(REFUSED)('%s → one code, same sentence', (_name, steps, code, sentence) => {
    const result = validateSteps(steps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(code);
    expect(result.reason).toBe(sentence);
    expect(result.index).toBe(0);
    expect(STEP_PROBLEM_CODES).toContain(code);
  });

  it('refuses a list that is not an array without a step number', () => {
    const result = validateSteps({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('steps_not_array');
    expect(stepProblemDetails(result)).toEqual({ reason: 'steps_not_array' });
  });

  it('numbers the step from 1 and carries the unrecognised type', () => {
    const result = validateSteps([{ type: 'summarize' }, { type: 'dance' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(stepProblemDetails(result)).toEqual({
      reason: 'unknown_step_type',
      step: 2,
      type: 'dance',
    });
  });

  it('every code has a refusal above (no orphan code)', () => {
    const covered = new Set(REFUSED.map(([, , code]) => code));
    covered.add('steps_not_array');
    expect([...STEP_PROBLEM_CODES].filter((code) => !covered.has(code))).toEqual([]);
  });
});
