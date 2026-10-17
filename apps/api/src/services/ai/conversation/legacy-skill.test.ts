/**
 * The legacy skill adapter (tm 292.2 · AI-03 §10): every stored step type
 * reaches the one engine as a procedure step, in order, under the name the
 * admin wrote it as.
 */
import { SKILL_STEP_TYPES, validateSteps, type SkillStep } from '@siyahtus/ai-mock';
import { describe, expect, it } from 'vitest';
import { adaptLegacySkill, stepLogName } from './legacy-skill.js';

/** One stored step of every type, in the order an admin might write them. */
const EVERY_TYPE: SkillStep[] = [
  { type: 'detect_intent', intent: 'deposit', phrases: ['deposit', 'payment'] },
  { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
  { type: 'tag', tag: 'payments' },
  { type: 'summarize' },
  { type: 'send_message', source: 'text', text: 'Thanks, checking now.' },
  { type: 'send_message', source: 'knowledge' },
  { type: 'transfer_to_team', group: 'Finance' },
];

describe('adaptLegacySkill', () => {
  it('maps each stored step type to its procedure step, keeping the order', () => {
    const procedure = adaptLegacySkill(EVERY_TYPE);

    expect(procedure).toEqual({
      mode: 'single',
      whenToUse: [{ intent: 'deposit', phrases: ['deposit', 'payment'] }],
      steps: [
        {
          type: 'collect',
          slot: 'order number',
          prompt: 'What is your order number?',
          authored: 'request_info',
        },
        { type: 'tag', tag: 'payments', authored: 'tag' },
        { type: 'summarize', authored: 'summarize' },
        { type: 'say', text: 'Thanks, checking now.', authored: 'send_message' },
        { type: 'answer_from_knowledge', authored: 'send_message' },
        { type: 'handoff', target: 'Finance', authored: 'transfer_to_team' },
      ],
    });
  });

  it('covers the whole stored vocabulary — a step type added later cannot be dropped silently', () => {
    expect(new Set(EVERY_TYPE.map((step) => step.type))).toEqual(new Set(SKILL_STEP_TYPES));
    const procedure = adaptLegacySkill(EVERY_TYPE);
    // Every step but the gate survives as a step, and names itself as written.
    expect(procedure.steps.map(stepLogName)).toEqual(
      EVERY_TYPE.filter((step) => step.type !== 'detect_intent').map((step) => step.type),
    );
  });

  it('lifts every gate out of the list wherever it was written, all of them required', () => {
    const procedure = adaptLegacySkill([
      { type: 'tag', tag: 'early' },
      { type: 'detect_intent', intent: 'refund' },
      { type: 'send_message', source: 'text', text: 'Refunds take 5 days.' },
      { type: 'detect_intent', intent: 'card', phrases: ['card'] },
    ]);

    expect(procedure.whenToUse).toEqual([
      { intent: 'refund', phrases: [] },
      { intent: 'card', phrases: ['card'] },
    ]);
    expect(procedure.steps.map((step) => step.type)).toEqual(['tag', 'say']);
  });

  it('turns a gate-free list into a procedure that applies to every message', () => {
    expect(adaptLegacySkill([{ type: 'tag', tag: 'all' }]).whenToUse).toEqual([]);
  });

  it('adapts what validation accepts, as stored', () => {
    const parsed = validateSteps([
      { type: 'send_message', source: 'text', text: 'Hello' },
      { type: 'transfer_to_team', group: 'Support' },
    ]);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(adaptLegacySkill(parsed.steps).steps).toEqual([
      { type: 'say', text: 'Hello', authored: 'send_message' },
      { type: 'handoff', target: 'Support', authored: 'transfer_to_team' },
    ]);
  });
});

describe('stepLogName', () => {
  it('names an adapted step as it was authored, and a native one by its type', () => {
    expect(
      stepLogName({ type: 'collect', slot: 'x', prompt: 'X?', authored: 'request_info' }),
    ).toBe('request_info');
    expect(stepLogName({ type: 'collect', slot: 'x', prompt: 'X?' })).toBe('collect');
  });
});
