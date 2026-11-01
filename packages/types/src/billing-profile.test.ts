import { describe, expect, it } from 'vitest';
import {
  billingProfileProblem,
  formatInvoiceNumber,
  isValidTaxId,
  isValidVatId,
  normaliseTaxId,
  normaliseVatId,
} from './billing-profile.js';

describe('billing profile rules (tm 383 · BL-02)', () => {
  it('accepts a Turkish VKN and a TCKN with valid check digits, refuses the rest', () => {
    expect(isValidTaxId('TR', '1234567890')).toBe(true);
    expect(isValidTaxId('TR', '10000000146')).toBe(true);
    // Last digit off by one: the second check digit fails.
    expect(isValidTaxId('TR', '10000000147')).toBe(false);
    // A TCKN never starts with 0.
    expect(isValidTaxId('TR', '00000000146')).toBe(false);
    expect(isValidTaxId('TR', '12345')).toBe(false);
    expect(isValidTaxId('TR', 'ABC1234567')).toBe(false);
  });

  it('takes any 2–32 letters and digits outside Turkey', () => {
    expect(isValidTaxId('DE', '12345678901')).toBe(true);
    expect(isValidTaxId('MT', 'C12345')).toBe(true);
    expect(isValidTaxId('DE', 'X')).toBe(false);
    expect(isValidTaxId('DE', 'A'.repeat(33))).toBe(false);
  });

  it('normalises what people type before checking it', () => {
    expect(normaliseTaxId(' 123.456-7890 ')).toBe('1234567890');
    expect(normaliseVatId('de 123 456 789')).toBe('DE123456789');
    expect(isValidVatId('DE123456789')).toBe(true);
    expect(isValidVatId('123456789')).toBe(false);
  });

  it('names the field and the rule a profile breaks', () => {
    expect(billingProfileProblem({ country: 'tr', tax_id: '1234567890' })).toEqual({
      field: 'country',
      problem: 'country_invalid',
    });
    expect(billingProfileProblem({ country: 'TR', tax_id: '12345' })).toEqual({
      field: 'tax_id',
      problem: 'tax_id_invalid',
    });
    expect(billingProfileProblem({ country: 'TR', tax_id: null })).toEqual({
      field: 'tax_id',
      problem: 'tax_id_required',
    });
    expect(billingProfileProblem({ country: 'DE', tax_id: null, vat_id: 'nope' })).toEqual({
      field: 'vat_id',
      problem: 'vat_id_invalid',
    });
    expect(billingProfileProblem({ country: 'DE', invoice_email: 'not-an-address' })).toEqual({
      field: 'invoice_email',
      problem: 'invoice_email_invalid',
    });
    expect(billingProfileProblem({ country: 'DE', tax_id: null })).toBeNull();
  });

  it('numbers an invoice by year and a six-digit serial', () => {
    expect(formatInvoiceNumber(2026, 123)).toBe('2026-000123');
    expect(formatInvoiceNumber(2026, 1_234_567)).toBe('2026-1234567');
  });
});
