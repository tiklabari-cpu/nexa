import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  checkCustomFieldValue,
  customFieldError,
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
