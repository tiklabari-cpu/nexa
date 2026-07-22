import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  deriveCodeChallenge,
  generateToken,
  hashPassword,
  hashToken,
  isValidCodeVerifier,
  verifyCodeChallenge,
  verifyPassword,
} from './crypto.js';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword('correct-horse-battery-staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword('correct-horse-battery-stapl', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('salts, so identical passwords produce different hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same', a)).resolves.toBe(true);
    await expect(verifyPassword('same', b)).resolves.toBe(true);
  });

  it('embeds its parameters so they can be raised later', async () => {
    const hash = await hashPassword('x');
    const [algorithm, N, r, p] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(N)).toBe(32768);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('never stores the password itself', async () => {
    const hash = await hashPassword('super-secret-value');
    expect(hash).not.toContain('super-secret-value');
  });

  it('normalises unicode so the same typed password always matches', async () => {
    // U+00E9 vs e + U+0301 — identical on screen, different bytes. Without
    // NFKC a password typed on one keyboard layout fails on another.
    const composed = 'caf\u00e9-password';
    const decomposed = 'cafe\u0301-password';
    expect(composed).not.toBe(decomposed);
    const hash = await hashPassword(composed);
    await expect(verifyPassword(decomposed, hash)).resolves.toBe(true);
  });

  it('returns false for an account with no password, without throwing', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
  });

  it('spends real time even when there is no stored hash', async () => {
    // Returning instantly would make "this account exists but is SSO-only"
    // measurable.
    const started = performance.now();
    await verifyPassword('anything', null);
    expect(performance.now() - started).toBeGreaterThan(10);
  });

  it.each([
    ['empty', ''],
    ['not our format', 'plaintext-password'],
    ['wrong algorithm', 'bcrypt$1$2$3$salt$hash'],
    ['truncated', 'scrypt$32768$8$1$salt'],
    ['non-numeric parameters', 'scrypt$N$r$p$c2FsdA$aGFzaA'],
  ])('rejects a %s stored hash rather than throwing', async (_label, stored) => {
    await expect(verifyPassword('x', stored)).resolves.toBe(false);
  });
});

describe('token generation and hashing', () => {
  it('produces url-safe, non-repeating tokens', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries at least 256 bits of entropy by default', () => {
    // base64url of 32 bytes is 43 characters.
    expect(generateToken().length).toBeGreaterThanOrEqual(43);
  });

  it('hashes deterministically so lookup by hash is a single indexed query', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(`${token}x`)).not.toBe(hashToken(token));
  });
});

describe('constantTimeEqual', () => {
  it('compares equal values as equal', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
  });

  it('returns false for different values', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('does not throw on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths, which would itself leak the
    // length through an exception path.
    expect(() => constantTimeEqual('short', 'much-longer-value')).not.toThrow();
    expect(constantTimeEqual('short', 'much-longer-value')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});

describe('PKCE', () => {
  it('accepts verifiers of the permitted length and alphabet', () => {
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
    expect(isValidCodeVerifier('AZaz09-._~'.repeat(5))).toBe(true);
  });

  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(129)],
    ['reserved character', `${'a'.repeat(42)}+`],
    ['whitespace', `${'a'.repeat(42)} `],
    ['empty', ''],
  ])('rejects a %s verifier', (_label, verifier) => {
    expect(isValidCodeVerifier(verifier)).toBe(false);
  });

  it('derives the S256 challenge from RFC 7636 appendix B', () => {
    // The specification's own worked example — proves the encoding matches
    // what any conforming client will send.
    expect(deriveCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('verifies a matching verifier and rejects anything else', () => {
    const verifier = 'a'.repeat(50);
    const challenge = deriveCodeChallenge(verifier);
    expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
    expect(verifyCodeChallenge('b'.repeat(50), challenge)).toBe(false);
  });

  it('refuses a malformed verifier even when its digest would match', () => {
    // A client sending an out-of-spec verifier is not one we want to
    // interoperate with; accepting it would weaken the alphabet guarantee.
    const bad = 'a'.repeat(20);
    expect(verifyCodeChallenge(bad, deriveCodeChallenge(bad))).toBe(false);
  });
});
