import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotp,
  generateTotpForStep,
  generateTotpSecret,
  hotp,
  isValidTotpSecret,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TotpSecretError,
  totpStep,
  verifyTotp,
  type TotpAlgorithm,
} from './totp.js';

/**
 * The published vectors are the point of this suite. An OTP implementation that
 * is wrong in the truncation, the counter encoding or the digit count still
 * produces six plausible digits every thirty seconds, and still round-trips
 * against itself — so a test written only against our own output would pass
 * while no real authenticator app could ever log anybody in. Only the RFC
 * numbers catch that.
 */

/** RFC 4226 Appendix D — ASCII "12345678901234567890". */
const RFC4226_KEY = Buffer.from('12345678901234567890', 'ascii');

/** RFC 6238 Appendix B uses a different seed per digest, all ASCII digits. */
const RFC6238_SEEDS: Record<TotpAlgorithm, Buffer> = {
  sha1: Buffer.from('12345678901234567890', 'ascii'),
  sha256: Buffer.from('12345678901234567890123456789012', 'ascii'),
  sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii'),
};

describe('base32 (RFC 4648)', () => {
  // Section 10 of the RFC, minus the `=` padding we deliberately do not emit.
  const VECTORS = [
    { plain: 'f', encoded: 'MY' },
    { plain: 'fo', encoded: 'MZXQ' },
    { plain: 'foo', encoded: 'MZXW6' },
    { plain: 'foob', encoded: 'MZXW6YQ' },
    { plain: 'fooba', encoded: 'MZXW6YTB' },
    { plain: 'foobar', encoded: 'MZXW6YTBOI' },
  ];

  it.each(VECTORS)('encodes $plain to $encoded', ({ plain, encoded }) => {
    expect(base32Encode(Buffer.from(plain, 'ascii'))).toBe(encoded);
  });

  it.each(VECTORS)('decodes $encoded back to $plain', ({ plain, encoded }) => {
    expect(base32Decode(encoded).toString('ascii')).toBe(plain);
  });

  it('accepts the padding it never writes, plus lower case, spaces and dashes', () => {
    expect(base32Decode('MZXW6YTBOI======').toString('ascii')).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi').toString('ascii')).toBe('foobar');
  });

  it('rejects a symbol outside the alphabet', () => {
    // 0, 1 and 8 are exactly the characters RFC 4648 base32 leaves out.
    expect(() => base32Decode('MZXW0YTB')).toThrow(TotpSecretError);
    expect(() => base32Decode('MZXW6YT!')).toThrow(TotpSecretError);
  });

  it('rejects non-zero padding bits rather than decoding to a different key', () => {
    // 'MZXW6YTBOJ' differs from the canonical 'MZXW6YTBOI' only in bits that
    // the encoder always leaves zero, so a lenient decoder would silently
    // accept a secret that is not the one that was enrolled.
    expect(() => base32Decode('MZXW6YTBOJ')).toThrow(TotpSecretError);
  });

  it('rejects an empty secret', () => {
    expect(() => base32Decode('   ')).toThrow(TotpSecretError);
  });

  it('never quotes the secret in the error it throws', () => {
    const secret = 'MZXW6YTB!SUPERSECRET';
    try {
      base32Decode(secret);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('SUPERSECRET');
      expect((error as Error).message).not.toContain('!');
    }
  });

  it('round-trips arbitrary byte lengths', () => {
    for (let length = 1; length <= 24; length += 1) {
      const bytes = Buffer.alloc(length, length);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });
});

describe('HOTP (RFC 4226 Appendix D test vectors)', () => {
  const VECTORS = [
    { counter: 0, code: '755224' },
    { counter: 1, code: '287082' },
    { counter: 2, code: '359152' },
    { counter: 3, code: '969429' },
    { counter: 4, code: '338314' },
    { counter: 5, code: '254676' },
    { counter: 6, code: '287922' },
    { counter: 7, code: '162583' },
    { counter: 8, code: '399871' },
    { counter: 9, code: '520489' },
  ];

  it.each(VECTORS)('counter $counter produces $code', ({ counter, code }) => {
    expect(hotp(RFC4226_KEY, counter)).toBe(code);
  });

  it('accepts the counter as a bigint, which is how Postgres returns it', () => {
    expect(hotp(RFC4226_KEY, 5n)).toBe('254676');
  });

  it('keeps the leading zeros that make a code six characters', () => {
    // Counter 0 at eight digits is 84755224; at six it is 755224 — the same
    // number truncated, which is what a shorter digit count means. A code that
    // dropped a leading zero would be five characters and never match.
    expect(hotp(RFC4226_KEY, 0, { digits: 8 })).toBe('84755224');
    for (const { counter } of VECTORS) {
      expect(hotp(RFC4226_KEY, counter)).toHaveLength(TOTP_DIGITS);
    }
  });

  it('refuses a negative counter instead of producing a code for one', () => {
    expect(() => hotp(RFC4226_KEY, -1)).toThrow(RangeError);
  });
});

describe('TOTP (RFC 6238 Appendix B test vectors)', () => {
  // All eighteen published rows: six timestamps by three digests. The
  // SHA-256/SHA-512 rows are not a feature we ship — enrollment pins SHA-1 —
  // but they are what proves the dynamic truncation reads the right offset out
  // of a 32- and 64-byte digest as well as a 20-byte one.
  const VECTORS: { time: number; algorithm: TotpAlgorithm; code: string }[] = [
    { time: 59, algorithm: 'sha1', code: '94287082' },
    { time: 59, algorithm: 'sha256', code: '46119246' },
    { time: 59, algorithm: 'sha512', code: '90693936' },
    { time: 1111111109, algorithm: 'sha1', code: '07081804' },
    { time: 1111111109, algorithm: 'sha256', code: '68084774' },
    { time: 1111111109, algorithm: 'sha512', code: '25091201' },
    { time: 1111111111, algorithm: 'sha1', code: '14050471' },
    { time: 1111111111, algorithm: 'sha256', code: '67062674' },
    { time: 1111111111, algorithm: 'sha512', code: '99943326' },
    { time: 1234567890, algorithm: 'sha1', code: '89005924' },
    { time: 1234567890, algorithm: 'sha256', code: '91819424' },
    { time: 1234567890, algorithm: 'sha512', code: '93441116' },
    { time: 2000000000, algorithm: 'sha1', code: '69279037' },
    { time: 2000000000, algorithm: 'sha256', code: '90698825' },
    { time: 2000000000, algorithm: 'sha512', code: '38618901' },
    { time: 20000000000, algorithm: 'sha1', code: '65353130' },
    { time: 20000000000, algorithm: 'sha256', code: '77737706' },
    { time: 20000000000, algorithm: 'sha512', code: '47863826' },
  ];

  it.each(VECTORS)('$algorithm at T=$time produces $code', ({ time, algorithm, code }) => {
    const step = totpStep(time * 1000);
    expect(hotp(RFC6238_SEEDS[algorithm], step, { digits: 8, algorithm })).toBe(code);
  });

  // The step column of the same table, in decimal. If the counter encoding were
  // wrong the codes above would already be wrong, but this pins the arithmetic
  // separately so a failure says which half broke.
  it.each([
    { time: 59, step: 1 },
    { time: 1111111109, step: 37037036 },
    { time: 1111111111, step: 37037037 },
    { time: 1234567890, step: 41152263 },
    { time: 2000000000, step: 66666666 },
    { time: 20000000000, step: 666666666 },
  ])('T=$time is step $step', ({ time, step }) => {
    expect(totpStep(time * 1000)).toBe(step);
  });

  it('reaches the same SHA-1 codes through the base32 secret path', () => {
    const secret = base32Encode(RFC6238_SEEDS.sha1);
    for (const vector of VECTORS.filter((v) => v.algorithm === 'sha1')) {
      expect(generateTotp(secret, vector.time * 1000, { digits: 8 })).toBe(vector.code);
    }
  });

  it('produces the six-digit tail of the published eight-digit code', () => {
    // HOTP is `binary mod 10^digits`, so six digits is the eight-digit value
    // with the top two dropped. Anything else means the modulo is wrong.
    const secret = base32Encode(RFC6238_SEEDS.sha1);
    expect(generateTotp(secret, 59_000)).toBe('287082');
  });
});

describe('secret generation', () => {
  it('is 160 bits of RFC 4648 base32, upper case and unpadded', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(TOTP_SECRET_BYTES);
  });

  it('is different every time', () => {
    const secrets = new Set(Array.from({ length: 64 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(64);
  });

  it('accepts its own secrets and rejects what is too short or malformed', () => {
    expect(isValidTotpSecret(generateTotpSecret())).toBe(true);
    // 15 bytes — one below the RFC 4226 floor of 128 bits.
    expect(isValidTotpSecret(base32Encode(Buffer.alloc(15, 7)))).toBe(false);
    expect(isValidTotpSecret('not base32 at all!')).toBe(false);
    expect(isValidTotpSecret('')).toBe(false);
  });
});

describe('verifyTotp', () => {
  const SECRET = 'MZXW6YTBOIMZXW6YTBOIMZXW6YTBOIMZ'; // 20 bytes, valid base32
  const NOW = 1_700_000_000_000;
  const STEP = totpStep(NOW);

  it('accepts the code for the current step and reports which step it was', () => {
    const result = verifyTotp({ secret: SECRET, code: generateTotp(SECRET, NOW), nowMs: NOW });
    expect(result).toEqual({ ok: true, step: STEP });
  });

  it('accepts one step of drift in either direction', () => {
    const period = TOTP_PERIOD_SECONDS * 1000;
    const early = verifyTotp({
      secret: SECRET,
      code: generateTotpForStep(SECRET, STEP - 1),
      nowMs: NOW,
    });
    const late = verifyTotp({
      secret: SECRET,
      code: generateTotpForStep(SECRET, STEP + 1),
      nowMs: NOW,
    });
    expect(early).toEqual({ ok: true, step: STEP - 1 });
    expect(late).toEqual({ ok: true, step: STEP + 1 });
    // Same thing seen from the other side: a code generated now is still good
    // one period later, and was already good one period early.
    expect(
      verifyTotp({ secret: SECRET, code: generateTotp(SECRET, NOW), nowMs: NOW + period }),
    ).toEqual({ ok: true, step: STEP });
  });

  it('refuses two steps of drift — the window is a bound, not a suggestion', () => {
    expect(
      verifyTotp({ secret: SECRET, code: generateTotpForStep(SECRET, STEP - 2), nowMs: NOW }),
    ).toEqual({ ok: false, reason: 'mismatch' });
    expect(
      verifyTotp({ secret: SECRET, code: generateTotpForStep(SECRET, STEP + 2), nowMs: NOW }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a code belonging to somebody else', () => {
    const other = generateTotpSecret();
    expect(verifyTotp({ secret: SECRET, code: generateTotp(other, NOW), nowMs: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('separates malformed input from a wrong code', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', '12 34 5', '000000x']) {
      expect(verifyTotp({ secret: SECRET, code, nowMs: NOW })).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('forgives the spaces and dashes a user copies along with the code', () => {
    const code = generateTotp(SECRET, NOW);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    const dashed = `${code.slice(0, 3)}-${code.slice(3)}`;
    expect(verifyTotp({ secret: SECRET, code: spaced, nowMs: NOW })).toEqual({
      ok: true,
      step: STEP,
    });
    expect(verifyTotp({ secret: SECRET, code: dashed, nowMs: NOW })).toEqual({
      ok: true,
      step: STEP,
    });
  });

  describe('replay guard', () => {
    it('refuses a code whose step has already been spent', () => {
      const code = generateTotp(SECRET, NOW);
      const first = verifyTotp({ secret: SECRET, code, nowMs: NOW });
      expect(first).toEqual({ ok: true, step: STEP });

      // The caller persisted `first.step`; the same code arrives again inside
      // the same 30 seconds, which is exactly the window a phished code has.
      expect(verifyTotp({ secret: SECRET, code, nowMs: NOW, lastUsedStep: STEP })).toEqual({
        ok: false,
        reason: 'replayed',
      });
    });

    it('still refuses it a step later, where the drift window would revive it', () => {
      // This is the case the guard exists for: without it, a code spent at step
      // N is accepted again at N+1 because N is then the "previous" step.
      const code = generateTotp(SECRET, NOW);
      const later = NOW + TOTP_PERIOD_SECONDS * 1000;
      expect(verifyTotp({ secret: SECRET, code, nowMs: later, lastUsedStep: STEP })).toEqual({
        ok: false,
        reason: 'replayed',
      });
    });

    it('refuses any step at or before the last one, not just the last one', () => {
      expect(
        verifyTotp({
          secret: SECRET,
          code: generateTotpForStep(SECRET, STEP - 1),
          nowMs: NOW,
          lastUsedStep: STEP,
        }),
      ).toEqual({ ok: false, reason: 'replayed' });
    });

    it('lets the next step through', () => {
      expect(
        verifyTotp({
          secret: SECRET,
          code: generateTotpForStep(SECRET, STEP + 1),
          nowMs: NOW,
          lastUsedStep: STEP,
        }),
      ).toEqual({ ok: true, step: STEP + 1 });
    });

    it('takes the step as a bigint, which is what Prisma reads out of BIGINT', () => {
      const code = generateTotp(SECRET, NOW);
      expect(verifyTotp({ secret: SECRET, code, nowMs: NOW, lastUsedStep: BigInt(STEP) })).toEqual({
        ok: false,
        reason: 'replayed',
      });
    });

    it('treats a null last step as "nothing spent yet"', () => {
      const code = generateTotp(SECRET, NOW);
      expect(verifyTotp({ secret: SECRET, code, nowMs: NOW, lastUsedStep: null })).toEqual({
        ok: true,
        step: STEP,
      });
    });

    it('does not report a wrong code as a replay', () => {
      expect(
        verifyTotp({ secret: SECRET, code: '000000', nowMs: NOW, lastUsedStep: STEP + 5 }),
      ).toEqual({ ok: false, reason: 'mismatch' });
    });
  });

  it('throws on a corrupt stored secret instead of calling it a wrong code', () => {
    expect(() => verifyTotp({ secret: 'nope!', code: '123456', nowMs: NOW })).toThrow(
      TotpSecretError,
    );
  });

  it('survives a clock at the epoch, where the previous step would be negative', () => {
    expect(() => verifyTotp({ secret: SECRET, code: '123456', nowMs: 0 })).not.toThrow();
    expect(verifyTotp({ secret: SECRET, code: generateTotp(SECRET, 0), nowMs: 0 })).toEqual({
      ok: true,
      step: 0,
    });
  });
});

describe('buildOtpauthUri', () => {
  const SECRET = 'MZXW6YTBOIMZXW6YTBOIMZXW6YTBOIMZ';

  it('carries the issuer in both the label and the query, as apps expect', () => {
    const uri = buildOtpauthUri({ issuer: 'Nexa', accountName: 'ada@acme.test', secret: SECRET });
    expect(uri.startsWith('otpauth://totp/Nexa:')).toBe(true);
    expect(uri).toContain('issuer=Nexa');
    expect(uri).toContain(`secret=${SECRET}`);
  });

  it('pins the parameters verifyTotp actually computes with', () => {
    const uri = buildOtpauthUri({ issuer: 'Nexa', accountName: 'ada@acme.test', secret: SECRET });
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain(`digits=${TOTP_DIGITS}`);
    expect(uri).toContain(`period=${TOTP_PERIOD_SECONDS}`);
  });

  it('encodes a colon inside a component so the label keeps one separator', () => {
    const uri = buildOtpauthUri({
      issuer: 'Nexa: Support',
      accountName: 'ada:admin@acme.test',
      secret: SECRET,
    });
    const label = uri.slice('otpauth://totp/'.length, uri.indexOf('?'));
    expect(label.split(':')).toHaveLength(2);
    expect(decodeURIComponent(label.split(':')[0] ?? '')).toBe('Nexa: Support');
    expect(decodeURIComponent(label.split(':')[1] ?? '')).toBe('ada:admin@acme.test');
  });

  it('encodes a space as %20, not as the + a query builder would emit', () => {
    const uri = buildOtpauthUri({
      issuer: 'Nexa Support',
      accountName: 'ada@acme.test',
      secret: SECRET,
    });
    expect(uri).toContain('issuer=Nexa%20Support');
    expect(uri).not.toContain('+');
  });

  it('normalizes a secret that was handed over spaced or lower case', () => {
    const uri = buildOtpauthUri({
      issuer: 'Nexa',
      accountName: 'ada@acme.test',
      secret: 'mzxw6ytb oimzxw6ytboimzxw6ytboimz',
    });
    expect(uri).toContain(`secret=${SECRET}`);
  });

  it('refuses to build a URI nothing could enroll', () => {
    expect(() => buildOtpauthUri({ issuer: '  ', accountName: 'ada', secret: SECRET })).toThrow(
      TypeError,
    );
    expect(() => buildOtpauthUri({ issuer: 'Nexa', accountName: ' ', secret: SECRET })).toThrow(
      TypeError,
    );
    expect(() =>
      buildOtpauthUri({ issuer: 'Nexa', accountName: 'ada', secret: 'too-short' }),
    ).toThrow(TotpSecretError);
  });

  it('produces a URI an authenticator would parse into the same code we verify', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri({ issuer: 'Nexa', accountName: 'ada@acme.test', secret });
    const parsed = new URL(uri);
    const enrolled = parsed.searchParams.get('secret') ?? '';
    const now = 1_700_000_000_000;
    expect(verifyTotp({ secret, code: generateTotp(enrolled, now), nowMs: now })).toEqual({
      ok: true,
      step: totpStep(now),
    });
  });
});
