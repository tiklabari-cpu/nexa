import { describe, expect, it } from 'vitest';
import { searchShape } from './search.js';

describe('searchShape', () => {
  it('reads a message number before the ten characters at its start', () => {
    expect(searchShape('TJ1H8CFKRV_7')).toBe('event');
  });

  it('reads ten characters as a number, with the whitespace a paste drags along', () => {
    expect(searchShape('TJ1H8CFKRV')).toBe('short_id');
    expect(searchShape('  TJ1H8CFKRV\n')).toBe('short_id');
  });

  it('does not fold case: a lower-case number is text', () => {
    expect(searchShape('tj1h8cfkrv')).toBe('text');
  });

  it('reads a UUID as a member number, whatever its case', () => {
    expect(searchShape('3f2b8c1e-5d4a-4e7b-9c1d-2a6f8e0b4c7d')).toBe('uuid');
    expect(searchShape('3F2B8C1E-5D4A-4E7B-9C1D-2A6F8E0B4C7D')).toBe('uuid');
  });

  it('reads one @ with something either side as an address', () => {
    expect(searchShape('Jane@Example.test')).toBe('email');
    expect(searchShape('jane@')).toBe('text');
    expect(searchShape('jane doe@example.test')).toBe('text');
  });

  it('leaves names, usernames and fragments as text', () => {
    expect(searchShape('Mehmet')).toBe('text');
    expect(searchShape('kral_oyuncu')).toBe('text');
    expect(searchShape('TJ1H8CFKR')).toBe('text');
  });
});
