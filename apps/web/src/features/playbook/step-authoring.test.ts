/**
 * Authoring a step list: add, delete, retype, edit (FR-MOD-06.2.4).
 *
 * The retype assertion leads, because it is the one that keeps the editor
 * inside the contract: a `send_message` that becomes a `tag` and keeps its
 * `source`/`text` is a step the server's `validateStep` reads by discriminant
 * and the engine would run with fields nobody meant to store. "The old field is
 * gone" is therefore asserted as an absence, not as a new value.
 */
import { describe, expect, it } from 'vitest';
import {
  STEP_TYPES,
  addStep,
  blankStep,
  changeStepType,
  formatPhrases,
  parsePhrases,
  removeStep,
  toEntries,
  updateStep,
} from './step-authoring.js';
import { stepIssues } from './step-reorder.js';
import type { SkillStep } from './types.js';

/**
 * A step read as a plain bag of keys, so an assertion can ask whether a field
 * is *absent* — `SkillStep` declares every parameter optional, which makes
 * "undefined" and "not there" indistinguishable through the type.
 */
const fields = (step: SkillStep | undefined): Record<string, unknown> =>
  step as unknown as Record<string, unknown>;

describe('blankStep / addStep (FR-MOD-06.2.4)', () => {
  it('produces a shaped skeleton for each of the six PRD step types', () => {
    // The vocabulary is fixed by the contract — six, no more.
    expect(STEP_TYPES).toHaveLength(6);

    for (const type of STEP_TYPES) {
      const step = blankStep(type);
      expect(step.type).toBe(type);
    }

    // The required parameters are present but empty, which is what makes a new
    // step *reported* as incomplete rather than silently storable.
    expect(blankStep('detect_intent')).toEqual({ type: 'detect_intent', intent: '' });
    expect(blankStep('request_info')).toEqual({ type: 'request_info', field: '', prompt: '' });
    expect(blankStep('tag')).toEqual({ type: 'tag', tag: '' });
    expect(blankStep('summarize')).toEqual({ type: 'summarize' });
    expect(blankStep('send_message')).toEqual({ type: 'send_message', source: 'text', text: '' });
    expect(blankStep('transfer_to_team')).toEqual({ type: 'transfer_to_team', group: '' });
  });

  it('reports every freshly added step as one that blocks the save', () => {
    // Every type except `summarize` needs a parameter nobody has typed yet, so
    // the gate must name it rather than let an empty step reach the API.
    for (const type of STEP_TYPES) {
      const issues = stepIssues([blankStep(type)]);
      expect(issues.length, type).toBe(type === 'summarize' ? 0 : 1);
    }
  });

  it('appends to the end and leaves the existing steps untouched', () => {
    const entries = toEntries([{ type: 'tag', tag: 'shipping' }]);
    const next = addStep(entries, 'summarize');

    expect(next.map((entry) => entry.step.type)).toEqual(['tag', 'summarize']);
    expect(entries).toHaveLength(1);
  });

  it('never reuses a row id, even across a delete', () => {
    // `id` is the React key of a reorderable row: a recycled one makes React
    // move the wrong DOM node, and with it the focus of a keyboard reorder.
    let entries = toEntries([{ type: 'summarize' }]);
    entries = addStep(entries, 'tag');
    const seen = entries.map((entry) => entry.id);

    entries = removeStep(entries, 0);
    entries = addStep(entries, 'summarize');
    entries = addStep(entries, 'tag');

    const ids = entries.map((entry) => entry.id);
    expect(new Set([...seen, ...ids]).size).toBe(4);
  });
});

describe('removeStep (FR-MOD-06.2.4)', () => {
  const entries = toEntries([
    { type: 'detect_intent', intent: 'delivery' },
    { type: 'tag', tag: 'shipping' },
    { type: 'summarize' },
  ]);

  it('drops one step and keeps the order of the rest', () => {
    const next = removeStep(entries, 1);
    expect(next.map((entry) => entry.step.type)).toEqual(['detect_intent', 'summarize']);
    // Identity is preserved for the survivors, so open/closed state follows them.
    expect(next[0]?.id).toBe(entries[0]?.id);
    expect(next[1]?.id).toBe(entries[2]?.id);
  });

  it('returns an unchanged copy for an out-of-range index', () => {
    expect(removeStep(entries, 9)).toHaveLength(3);
    expect(removeStep(entries, -1)).toHaveLength(3);
  });
});

describe('changeStepType (FR-MOD-06.2.4)', () => {
  it('drops every field the old type owned', () => {
    const entries = toEntries([{ type: 'send_message', source: 'text', text: 'On it.' }]);
    const step = fields(changeStepType(entries, 0, 'tag')[0]?.step);

    expect(step['type']).toBe('tag');
    expect(step['tag']).toBe('');
    // The assertion that matters: the old parameters are *gone*, not blank.
    expect('source' in step).toBe(false);
    expect('text' in step).toBe(false);
  });

  it('drops the intent and phrases of a detect_intent turned into a transfer', () => {
    const entries = toEntries([
      { type: 'detect_intent', intent: 'delivery', phrases: ['where is my order'] },
    ]);
    const step = fields(changeStepType(entries, 0, 'transfer_to_team')[0]?.step);

    expect(step).toEqual({ type: 'transfer_to_team', group: '' });
  });

  it('keeps the row id, so an open step stays open and focus is not lost', () => {
    const entries = toEntries([{ type: 'tag', tag: 'shipping' }]);
    expect(changeStepType(entries, 0, 'summarize')[0]?.id).toBe(entries[0]?.id);
  });

  it('is a no-op for the same type or a missing index', () => {
    const entries = toEntries([{ type: 'tag', tag: 'shipping' }]);
    expect(changeStepType(entries, 0, 'tag')[0]?.step).toEqual({ type: 'tag', tag: 'shipping' });
    expect(changeStepType(entries, 5, 'summarize')).toHaveLength(1);
  });
});

describe('updateStep (FR-MOD-06.2.4)', () => {
  it('merges a parameter into one step and leaves its neighbours alone', () => {
    const entries = toEntries([
      { type: 'tag', tag: '' },
      { type: 'tag', tag: 'shipping' },
    ]);
    const next = updateStep(entries, 0, { tag: 'billing' });

    expect(next[0]?.step).toEqual({ type: 'tag', tag: 'billing' });
    expect(next[1]?.step).toEqual({ type: 'tag', tag: 'shipping' });
  });

  it('removes a key set to undefined rather than storing an undefined value', () => {
    // Clearing an optional field has to leave the same JSON a step that never
    // had it produces — otherwise "is there anything to save?" answers yes for
    // an edit that changed nothing.
    const entries = toEntries([{ type: 'detect_intent', intent: 'delivery', phrases: ['hi'] }]);
    const step = fields(updateStep(entries, 0, { phrases: undefined })[0]?.step);

    expect('phrases' in step).toBe(false);
    expect(JSON.stringify(step)).toBe(
      JSON.stringify({ type: 'detect_intent', intent: 'delivery' }),
    );
  });
});

describe('parsePhrases / formatPhrases (FR-MOD-06.2.4)', () => {
  it('reads one phrase per line and ignores blank ones', () => {
    expect(parsePhrases('where is my order\n\n  tracking  \n')).toEqual([
      'where is my order',
      'tracking',
    ]);
  });

  it('returns undefined for an empty box so the optional field is simply absent', () => {
    expect(parsePhrases('')).toBeUndefined();
    expect(parsePhrases('   \n  ')).toBeUndefined();
  });

  it('round-trips back into the textarea', () => {
    const phrases: SkillStep['phrases'] = ['where is my order', 'tracking'];
    expect(parsePhrases(formatPhrases(phrases))).toEqual(phrases);
    expect(formatPhrases(undefined)).toBe('');
  });
});
