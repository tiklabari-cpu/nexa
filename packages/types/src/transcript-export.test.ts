import { describe, expect, it } from 'vitest';
import {
  emailDomain,
  normaliseForwardAddress,
  normaliseTranscriptDomain,
  unverifiedForwardAddress,
} from './transcript-export.js';

describe('transcript recipients (AR-04-S3 · tm 338)', () => {
  it('stores a domain trimmed, lower-case and without the @', () => {
    expect(normaliseTranscriptDomain(' @Sirket.COM ')).toBe('sirket.com');
    expect(normaliseTranscriptDomain('mail.sirket.com.tr')).toBe('mail.sirket.com.tr');
  });

  it('refuses what is not a domain name', () => {
    for (const value of ['sirket', '*.sirket.com', 'a b.com', 'x@sirket.com', '-a.com', '']) {
      expect(normaliseTranscriptDomain(value), value).toBeNull();
    }
  });

  it("reads an address's domain after its last @", () => {
    expect(emailDomain('Finance@Sirket.com')).toBe('sirket.com');
    expect(emailDomain('a@b@evil.test')).toBe('evil.test');
    expect(emailDomain('no-at-sign')).toBeNull();
    expect(emailDomain('trailing@')).toBeNull();
  });
});

describe('transcript forwarding (WG-06 · tm 345)', () => {
  it('stores an address trimmed, with its domain lower-case', () => {
    expect(normaliseForwardAddress(' Arsiv@Sirket.COM ')).toBe('Arsiv@sirket.com');
  });

  it('refuses what is not an address at a domain name', () => {
    for (const value of [
      'sirket.com',
      '@sirket.com',
      'a b@sirket.com',
      'a@sirket',
      'a@@b.com',
      '',
    ]) {
      expect(normaliseForwardAddress(value), value).toBeNull();
    }
  });

  it('names the first address outside the verified domains', () => {
    expect(unverifiedForwardAddress(['a@sirket.com', 'b@gmail.com'], ['sirket.com'])).toBe(
      'b@gmail.com',
    );
    expect(unverifiedForwardAddress(['a@sirket.com'], ['sirket.com'])).toBeNull();
    expect(unverifiedForwardAddress(['a@mail.sirket.com'], ['sirket.com'])).toBe(
      'a@mail.sirket.com',
    );
    expect(unverifiedForwardAddress([], [])).toBeNull();
  });
});
