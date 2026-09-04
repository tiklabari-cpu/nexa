import { describe, expect, it } from 'vitest';
import { COMPANY_SECTORS, isCompanySector, isIanaTimeZone } from './company.js';

describe('company sector catalogue', () => {
  it('accepts every listed sector and rejects an arbitrary string', () => {
    for (const sector of COMPANY_SECTORS) {
      expect(isCompanySector(sector)).toBe(true);
    }
    expect(isCompanySector('Gaming')).toBe(false);
    expect(isCompanySector('')).toBe(false);
    expect(isCompanySector(null)).toBe(false);
    expect(isCompanySector(undefined)).toBe(false);
  });
});

describe('isIanaTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('Europe/Istanbul')).toBe(true);
    expect(isIanaTimeZone('America/New_York')).toBe(true);
  });

  it('rejects a misspelled or made-up zone', () => {
    expect(isIanaTimeZone('Europe/Istambul')).toBe(false);
    expect(isIanaTimeZone('Not/AZone')).toBe(false);
  });

  it('rejects non-strings and empty/blank values', () => {
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone('   ')).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(undefined)).toBe(false);
    expect(isIanaTimeZone(42)).toBe(false);
  });
});
