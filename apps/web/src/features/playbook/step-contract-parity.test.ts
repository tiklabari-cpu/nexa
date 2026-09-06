/**
 * The editor's step gate and the server's must agree (FR-MOD-06.2.4).
 *
 * `stepIssues` exists so the editor can disable Save and name the offending
 * step the moment a required parameter is empty — the API answers the same
 * question, but only after a round trip and only as `Step 3: transfer_to_team
 * needs a team`, which is a sentence and not a place to type. Two gates for one
 * rule is a duplication that pays for itself and drifts the moment either side
 * gains a step type or a field.
 *
 * So this pins them to each other, over the shapes the editor can actually
 * produce: a step the client is willing to save is one `validateSteps` accepts
 * (or the admin meets a 400 they cannot act on), *and* a step the client
 * refuses is one the server would refuse too (or the editor blocks a save that
 * would have worked).
 */
import { validateSteps } from '@nexa/ai-mock';
import { describe, expect, it } from 'vitest';
import { STEP_TYPES, blankStep } from './step-authoring.js';
import { stepIssues } from './step-reorder.js';
import type { SkillStep } from './types.js';

/**
 * Every shape the editor can hand to `PATCH /skills/:id` — the six skeletons
 * "Add step" mints, each of them filled in, and the edges an admin reaches by
 * clearing a box or switching a reply's source.
 *
 * Deliberately not covering hand-crafted API payloads (a `phrases` that is not
 * an array, say): nothing in the UI can build one, and a stored skill's steps
 * came back through the same server validation.
 */
const CANDIDATES: SkillStep[] = [
  ...STEP_TYPES.map(blankStep),

  { type: 'detect_intent', intent: 'delivery' },
  { type: 'detect_intent', intent: 'delivery', phrases: [] },
  { type: 'detect_intent', intent: 'delivery', phrases: ['where is my order'] },
  { type: 'detect_intent', intent: '   ' },

  { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
  { type: 'request_info', field: 'order_number', prompt: '' },
  { type: 'request_info', field: '', prompt: 'What is your order number?' },

  { type: 'tag', tag: 'shipping' },
  { type: 'tag', tag: '  ' },

  { type: 'summarize' },

  { type: 'send_message', source: 'knowledge' },
  { type: 'send_message', source: 'text', text: 'On it.' },
  { type: 'send_message', source: 'text', text: '   ' },
  // Reachable only by editing steps outside the UI today, but it is exactly
  // what a retype that forgot to set the discriminant would leave behind.
  { type: 'send_message' },

  { type: 'transfer_to_team', group: 'Support' },
  { type: 'transfer_to_team', group: '' },
];

describe('step gate parity with the server (FR-MOD-06.2.4)', () => {
  it.each(CANDIDATES.map((step) => [JSON.stringify(step), step] as const))(
    'agrees with validateSteps about %s',
    (_label, step) => {
      const clientAccepts = stepIssues([step]).length === 0;
      const serverAccepts = validateSteps([step]).ok;

      expect(clientAccepts).toBe(serverAccepts);
    },
  );

  it('covers all six step types', () => {
    expect(new Set(CANDIDATES.map((step) => step.type)).size).toBe(STEP_TYPES.length);
  });
});
