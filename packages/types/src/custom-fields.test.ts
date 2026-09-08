import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  FORM_PLACEMENTS,
  TICKET_FORM_PLACEMENTS,
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
  it('lists the two entities and four value types', () => {
    expect(CUSTOM_FIELD_ENTITIES).toEqual(['ticket', 'contact']);
    expect(CUSTOM_FIELD_TYPES).toEqual(['text', 'number', 'boolean', 'date']);
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
