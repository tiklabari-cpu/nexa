import { describe, expect, it } from 'vitest';
import type { SkillStep } from './types.js';
import { describeMove, moveStep, stepIssues } from './step-reorder.js';

const STEPS: SkillStep[] = [
  { type: 'detect_intent', intent: 'delivery' },
  { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
  { type: 'send_message', source: 'knowledge' },
];

describe('moveStep', () => {
  it('moves a step up, which is what the keyboard "up" alternative calls', () => {
    // Keyboard reorder: move index 1 to index 0. Order must actually change.
    const next = moveStep(STEPS, 1, 0);
    expect(next.map((s) => s.type)).toEqual(['request_info', 'detect_intent', 'send_message']);
    // The source list is left untouched — the caller swaps in the returned copy.
    expect(STEPS.map((s) => s.type)).toEqual(['detect_intent', 'request_info', 'send_message']);
  });

  it('moves a step down', () => {
    const next = moveStep(STEPS, 0, 2);
    expect(next.map((s) => s.type)).toEqual(['request_info', 'send_message', 'detect_intent']);
  });

  it('clamps an over-run target instead of dropping the step', () => {
    const next = moveStep(STEPS, 0, 99);
    expect(next).toHaveLength(STEPS.length);
    expect(next[next.length - 1]?.type).toBe('detect_intent');
  });

  it('returns an unchanged copy for a no-op or out-of-range move', () => {
    expect(moveStep(STEPS, 1, 1).map((s) => s.type)).toEqual(STEPS.map((s) => s.type));
    expect(moveStep(STEPS, -1, 0).map((s) => s.type)).toEqual(STEPS.map((s) => s.type));
  });

  it('announces the move for the aria-live region', () => {
    expect(describeMove(STEPS, 1, 0)).toContain('position 1 of 3');
  });
});

describe('stepIssues — required parameters', () => {
  it('flags a hand-over with no team named (the transfer target)', () => {
    const steps: SkillStep[] = [{ type: 'transfer_to_team', group: '' }];
    const issues = stepIssues(steps);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ index: 0 });
    expect(issues[0]?.message).toMatch(/team/i);
  });

  it('passes a hand-over once a team is named', () => {
    expect(stepIssues([{ type: 'transfer_to_team', group: 'Support' }])).toHaveLength(0);
  });

  it('flags a fixed reply with no text but not a knowledge answer', () => {
    expect(stepIssues([{ type: 'send_message', source: 'text', text: '' }])).toHaveLength(1);
    expect(stepIssues([{ type: 'send_message', source: 'knowledge' }])).toHaveLength(0);
  });

  it('reports the offending index after a reorder', () => {
    const withTransfer: SkillStep[] = [...STEPS, { type: 'transfer_to_team', group: '' }];
    const reordered = moveStep(withTransfer, 3, 1);
    const issues = stepIssues(reordered);
    expect(issues[0]?.index).toBe(1);
  });

  it('finds no issues in a well-formed list', () => {
    expect(stepIssues(STEPS)).toHaveLength(0);
  });
});
