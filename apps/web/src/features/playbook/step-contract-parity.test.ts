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
import { validateSteps } from '@siyahtus/ai-mock';
import {
  PROCEDURE_PROBLEM_CODES,
  PROCEDURE_WARNING_CODES,
  PROC_BRANCH_STEP_TYPES,
  PROC_STEP_TYPES,
  SLOT_PROBLEM_CODES,
  splitSkillProcedure,
  validateSkillProcedure,
} from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { hasMessage } from '../../lib/i18n.js';
import { depositProcedureFields } from '../../test/procedure-fixtures.js';
import {
  EDITOR_BRANCH_TYPES,
  EDITOR_PROC_STEP_TYPES,
  blankProcStep,
  procedureDraft,
  procedureFields,
} from './procedure-authoring.js';
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
  // By id (AI-12 · tm 307.3), the way the team picker writes it.
  { type: 'transfer_to_team', group: 'Support', group_id: 7 },
  { type: 'transfer_to_team', group_id: 7 },
  { type: 'transfer_to_team', group: '', group_id: 7 },
  { type: 'transfer_to_team', group: 'Support', group_id: 0 },
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

/**
 * The procedure editor (AI-03 · tm 296.5) has no gate of its own to drift: it
 * runs `validateSkillProcedure`, the API's function, on `procedureFields` —
 * the body Save sends. What can still drift is everything around it: a step
 * type the server gains and the editor never offers, a refusal code with no
 * sentence in one of the console's languages, a definition the form reads in
 * and writes back changed.
 */
describe('procedure editor parity with the server (AI-03)', () => {
  it('offers every step type the server takes, the passive tool aside', () => {
    expect(new Set([...EDITOR_PROC_STEP_TYPES, 'tool'])).toStrictEqual(new Set(PROC_STEP_TYPES));
    expect(new Set(EDITOR_BRANCH_TYPES)).toStrictEqual(new Set(PROC_BRANCH_STEP_TYPES));
  });

  it.each([...PROCEDURE_PROBLEM_CODES, ...SLOT_PROBLEM_CODES, ...PROCEDURE_WARNING_CODES])(
    'words %s in English and Turkish',
    (code) => {
      const key = `playbook.procedure.problem.${code}`;
      expect(hasMessage('en', key)).toBe(true);
      expect(hasMessage('tr', key)).toBe(true);
    },
  );

  it('sends the §3.1 deposit procedure back exactly as the server stored it', () => {
    const stored = validateSkillProcedure(depositProcedureFields());
    if (!stored.ok) throw new Error(JSON.stringify(stored.problems));
    const row = splitSkillProcedure(stored.procedure);

    const body = procedureFields(procedureDraft(row));

    expect(body).toStrictEqual(row);
    const resaved = validateSkillProcedure(body);
    expect(resaved.ok && splitSkillProcedure(resaved.procedure)).toStrictEqual(row);
  });

  it('a blank step of each offered type is refused for what is missing, never for its shape', () => {
    // A blank the editor mints must fail on the empty box the author has to
    // fill — not on an unknown field or a bad option nobody can see.
    const shapeCodes = new Set(['procedure_unknown_field', 'procedure_step_unknown_type']);
    for (const type of EDITOR_PROC_STEP_TYPES) {
      const result = validateSkillProcedure(
        procedureFields({
          ...procedureDraft({ when_to_use: 'x' }),
          steps: procedureDraft({ procedure: { steps: [blankProcStep(type, 'yeni')] } }).steps,
        }),
      );
      const codes = result.ok ? [] : result.problems.map((problem) => problem.code);
      expect(
        codes.filter((code) => shapeCodes.has(code)),
        type,
      ).toEqual([]);
    }
  });
});
