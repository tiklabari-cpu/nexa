import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  FORM_PLACEMENTS,
  TICKET_FORM_PLACEMENTS,
  CUSTOM_FIELD_OPTIONS_MAX,
  customFieldDisplayValue,
  customFieldOptionsProblem,
  isChoiceFieldType,
  checkCustomFieldValue,
  customFieldError,
  formPlacementEntity,
  isCustomFieldProblem,
} from './custom-fields.js';

const text = { label: 'Player ID', type: 'text' as const, required: false };
const requiredText = { label: 'Player ID', type: 'text' as const, required: true };
const number = { label: 'Balance', type: 'number' as const, required: false };
const boolean = { label: 'KYC done', type: 'boolean' as const, required: false };
const date = { label: 'Verified on', type: 'date' as const, required: false };

describe('custom field catalogue', () => {
  it('lists the two entities and the seven value types (WG-04)', () => {
    expect(CUSTOM_FIELD_ENTITIES).toEqual(['ticket', 'contact']);
    expect(CUSTOM_FIELD_TYPES).toEqual([
      'text',
      'number',
      'boolean',
      'date',
      'select',
      'multiselect',
      'topic',
    ]);
  });
});

describe('form placements (FR-MOD-08.7.7)', () => {
  it('lists the four forms the PRD counts, in its order', () => {
    expect(FORM_PLACEMENTS).toEqual(['pre_chat', 'post_chat', 'ticket', 'prospect']);
  });

  it('sends each placement to the entity its answers belong to', () => {
    // The three that ask a visitor about *themselves* are contact questions;
    // `ticket` asks about the request they are leaving, so its answers land on
    // the ticket that message opens (KK "contact/ticket'a yazma").
    expect(formPlacementEntity('pre_chat')).toBe('contact');
    expect(formPlacementEntity('post_chat')).toBe('contact');
    expect(formPlacementEntity('prospect')).toBe('contact');
    expect(formPlacementEntity('ticket')).toBe('ticket');
  });

  it('maps every placement, so adding one cannot leave a hole', () => {
    for (const placement of FORM_PLACEMENTS) {
      expect(CUSTOM_FIELD_ENTITIES).toContain(formPlacementEntity(placement));
    }
  });

  it('names the two forms asked on the offline screen', () => {
    // One moment, two destinations — which is the whole reason they are two
    // placements rather than one.
    expect(TICKET_FORM_PLACEMENTS).toEqual(['ticket', 'prospect']);
    expect(new Set(TICKET_FORM_PLACEMENTS.map(formPlacementEntity))).toEqual(
      new Set(['ticket', 'contact']),
    );
  });
});

describe('checkCustomFieldValue — requiredness (KK "zorunluluk")', () => {
  it('rejects a blank value on a required field', () => {
    const result = checkCustomFieldValue(requiredText, '   ');
    expect(isCustomFieldProblem(result)).toBe(true);
    if (isCustomFieldProblem(result)) expect(result.problem.reason).toBe('required');
  });

  it('accepts a blank value on an optional field, clearing it to null', () => {
    expect(checkCustomFieldValue(text, '')).toEqual({ value: null });
    expect(checkCustomFieldValue(text, undefined)).toEqual({ value: null });
  });

  it('accepts a present value on a required field', () => {
    expect(checkCustomFieldValue(requiredText, ' P-42 ')).toEqual({ value: 'P-42' });
  });
});

describe('checkCustomFieldValue — types (KK "tip")', () => {
  it('trims text', () => {
    expect(checkCustomFieldValue(text, '  hello  ')).toEqual({ value: 'hello' });
  });

  it('rejects a non-numeric number and canonicalises a valid one', () => {
    expect(isCustomFieldProblem(checkCustomFieldValue(number, 'lots'))).toBe(true);
    expect(checkCustomFieldValue(number, '01.50')).toEqual({ value: '1.5' });
  });

  it('only accepts true/false for a boolean, case-insensitively', () => {
    expect(checkCustomFieldValue(boolean, 'TRUE')).toEqual({ value: 'true' });
    expect(checkCustomFieldValue(boolean, 'false')).toEqual({ value: 'false' });
    expect(isCustomFieldProblem(checkCustomFieldValue(boolean, 'yes'))).toBe(true);
  });

  it('requires a real YYYY-MM-DD date', () => {
    expect(checkCustomFieldValue(date, '2026-07-26')).toEqual({ value: '2026-07-26' });
    expect(isCustomFieldProblem(checkCustomFieldValue(date, '26/07/2026'))).toBe(true);
    expect(isCustomFieldProblem(checkCustomFieldValue(date, '2026-13-40'))).toBe(true);
  });
});

describe('customFieldError — the form-facing view of the same rule', () => {
  it('mirrors the validator: a message when invalid, null when fine', () => {
    expect(customFieldError(requiredText, '')).toMatch(/required/i);
    expect(customFieldError(number, 'lots')).toMatch(/number/i);
    expect(customFieldError(number, '42')).toBeNull();
    expect(customFieldError(text, '')).toBeNull();
  });
});

describe('choice types — select, multiselect, topic (WG-04)', () => {
  const options = [
    { value: 'withdrawal', label: 'Para çekme', target_group_id: 7 },
    { value: 'deposit', label: 'Para yatırma' },
    { value: 'other', label: 'Diğer' },
  ];
  const select = { label: 'Konu', type: 'select' as const, required: true, options };
  const topic = { label: 'Konu', type: 'topic' as const, required: false, options };
  const multi = { label: 'Oyunlar', type: 'multiselect' as const, required: false, options };

  it('names the three choice types', () => {
    expect(isChoiceFieldType('select')).toBe(true);
    expect(isChoiceFieldType('multiselect')).toBe(true);
    expect(isChoiceFieldType('topic')).toBe(true);
    expect(isChoiceFieldType('text')).toBe(false);
  });

  it('accepts only a value from the options for select and topic', () => {
    expect(checkCustomFieldValue(select, 'deposit')).toEqual({ value: 'deposit' });
    expect(checkCustomFieldValue(topic, ' withdrawal ')).toEqual({ value: 'withdrawal' });
    // The label is what the visitor sees, not what is stored.
    expect(isCustomFieldProblem(checkCustomFieldValue(select, 'Para yatırma'))).toBe(true);
    expect(customFieldError(topic, 'casino')).toMatch(/one of its options/);
    expect(customFieldError(select, '')).toMatch(/required/);
  });

  it('stores a multiselect as a JSON array in the options order, once each', () => {
    expect(checkCustomFieldValue(multi, '["other","withdrawal","other"]')).toEqual({
      value: '["withdrawal","other"]',
    });
    expect(checkCustomFieldValue(multi, '[]')).toEqual({ value: null });
    expect(isCustomFieldProblem(checkCustomFieldValue(multi, '["casino"]'))).toBe(true);
    expect(isCustomFieldProblem(checkCustomFieldValue(multi, 'withdrawal'))).toBe(true);
    expect(customFieldError({ ...multi, required: true }, '[]')).toMatch(/required/);
  });

  it('shows a stored choice by its label, and an unknown one as stored', () => {
    expect(customFieldDisplayValue(select, 'deposit')).toBe('Para yatırma');
    expect(customFieldDisplayValue(multi, '["withdrawal","gone"]')).toBe('Para çekme, gone');
    expect(customFieldDisplayValue({ type: 'text' }, 'deposit')).toBe('deposit');
    expect(customFieldDisplayValue(select, null)).toBeNull();
  });

  it('judges a definition’s options: 1–50, distinct, short, routing only on a topic', () => {
    expect(customFieldOptionsProblem('topic', options)).toBeNull();
    expect(customFieldOptionsProblem('select', [])).toMatch(/at least one/);
    expect(customFieldOptionsProblem('select', null)).toMatch(/at least one/);
    expect(customFieldOptionsProblem('select', options)).toMatch(/only a topic/);
    expect(customFieldOptionsProblem('text', options)).toMatch(/no options/);
    expect(customFieldOptionsProblem('text', null)).toBeNull();
    const many = Array.from({ length: CUSTOM_FIELD_OPTIONS_MAX + 1 }, (_, i) => ({
      value: `v${i}`,
      label: `L${i}`,
    }));
    expect(customFieldOptionsProblem('multiselect', many)).toMatch(/at most 50/);
    expect(customFieldOptionsProblem('select', [{ value: 'a', label: 'x'.repeat(81) }])).toMatch(
      /80/,
    );
    expect(
      customFieldOptionsProblem('select', [
        { value: 'a', label: 'A' },
        { value: 'a', label: 'B' },
      ]),
    ).toMatch(/twice/);
    expect(customFieldOptionsProblem('select', [{ value: ' ', label: 'A' }])).toMatch(/label/);
  });
});
