import { describe, expect, it } from 'vitest';
import { emailDomain, normaliseTranscriptDomain } from './transcript-export.js';

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
