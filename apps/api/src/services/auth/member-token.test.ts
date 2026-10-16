import { describe, expect, it } from 'vitest';
import { CredentialDecryptError } from '../../lib/credential-cipher.js';
import {
  MEMBER_TOKEN_FORMAT,
  MEMBER_TOKEN_MAX_LENGTH,
  MemberTokenCodec,
  memberKeyAad,
  newDeviceId,
  newSigningKey,
  type MemberTokenClaims,
} from './member-token.js';

const SECRET = 'test-customer-token-secret-0123456789abcdef';
const LICENSE = 41n;

function claims(over: Partial<MemberTokenClaims> = {}): MemberTokenClaims {
  return {
    sub: '3f1c9d2e-8b7a-4c6d-9e5f-1a2b3c4d5e6f',
    lic: LICENSE.toString(),
    did: newDeviceId(),
    oat: 1_760_000_000_000,
    iat: 1_760_000_100_000,
    exp: 1_762_592_100_000,
    ver: MEMBER_TOKEN_FORMAT,
    ...over,
  };
}

describe('member tokens (ID-03 · K4)', () => {
  const codec = new MemberTokenCodec(SECRET);
  const key = newSigningKey();

  it('signs nxm1.<kid>.<body>.<sig> and reads back exactly what it signed', () => {
    const signedClaims = claims();
    const signed = codec.sign(signedClaims, key, 3);
    expect(signed).toMatch(/^nxm1\.3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);

    const parsed = codec.parse(signed)!;
    expect(parsed.kid).toBe(3);
    expect(codec.verifySignature(parsed, key)).toBe(true);
    expect(codec.readClaims(parsed)).toEqual(signedClaims);
  });

  it('refuses a signature made by another key', () => {
    const parsed = codec.parse(codec.sign(claims(), key, 1))!;
    expect(codec.verifySignature(parsed, newSigningKey())).toBe(false);
  });

  it('covers the key version with the signature, so a token cannot name another key', () => {
    const [prefix, , body, signature] = codec.sign(claims(), key, 1).split('.');
    const renamed = codec.parse(`${prefix}.2.${body}.${signature}`)!;
    expect(codec.verifySignature(renamed, key)).toBe(false);
  });

  it('refuses a body edited under a kept signature', () => {
    const [prefix, kid, , signature] = codec.sign(claims(), key, 1).split('.');
    const edited = Buffer.from(
      JSON.stringify(claims({ sub: '00000000-0000-4000-8000-000000000000' })),
    ).toString('base64url');
    expect(
      codec.verifySignature(codec.parse(`${prefix}.${kid}.${edited}.${signature}`)!, key),
    ).toBe(false);
  });

  it.each([
    ['another prefix', 'nxc1.1.e30.c2ln'],
    ['three parts', 'nxm1.1.e30'],
    ['five parts', 'nxm1.1.e30.c2ln.x'],
    ['a zero key version', 'nxm1.0.e30.c2ln'],
    ['a leading zero', 'nxm1.01.e30.c2ln'],
    ['a version past int32', 'nxm1.2147483648.e30.c2ln'],
    ['an empty body', 'nxm1.1..c2ln'],
    ['an empty signature', 'nxm1.1.e30.'],
    ['too long', `nxm1.1.${'a'.repeat(MEMBER_TOKEN_MAX_LENGTH)}.c2ln`],
  ])('does not parse %s', (_label, token) => {
    expect(codec.parse(token)).toBeNull();
  });

  it.each([
    ['a sub that is not a uuid', { sub: 'customer-1' }],
    ['a licence that is not a number', { lic: '12a' }],
    ['no browser number', { did: '' }],
    ['a fractional time', { iat: 1.5 }],
    ['an unknown format', { ver: 2 }],
  ])('reads no claims from %s', (_label, over) => {
    const parsed = codec.parse(codec.sign(claims(over as Partial<MemberTokenClaims>), key, 1))!;
    expect(codec.readClaims(parsed)).toBeNull();
  });

  it('reads no claims from a body that is not JSON, or not an object', () => {
    for (const body of ['not-json', Buffer.from('null').toString('base64url')]) {
      expect(codec.readClaims({ kid: 1, body, signature: 'x' })).toBeNull();
    }
  });

  describe('the sealed signing key', () => {
    it('opens for the licence and version it was sealed for', () => {
      const sealed = codec.sealKey(LICENSE, 2, key);
      expect(sealed).toMatch(/^v1:/);
      expect(sealed).not.toContain(key.toString('base64url'));
      expect(codec.openKey(LICENSE, 2, sealed).equals(key)).toBe(true);
      // Another instance with the same deployment secret opens it too.
      expect(new MemberTokenCodec(SECRET).openKey(LICENSE, 2, sealed).equals(key)).toBe(true);
    });

    it('does not open for another licence, the other slot, or another deployment secret', () => {
      const sealed = codec.sealKey(LICENSE, 2, key);
      expect(() => codec.openKey(LICENSE + 1n, 2, sealed)).toThrow(CredentialDecryptError);
      expect(() => codec.openKey(LICENSE, 1, sealed)).toThrow(CredentialDecryptError);
      expect(() =>
        new MemberTokenCodec('another-customer-token-secret-0123456789').openKey(
          LICENSE,
          2,
          sealed,
        ),
      ).toThrow(CredentialDecryptError);
    });

    it('binds the additional data to licence and version', () => {
      expect(memberKeyAad(7n, 3)).toBe('member-token:7:3');
    });
  });

  it('refuses a deployment secret shorter than the customer token requires', () => {
    expect(() => new MemberTokenCodec('short')).toThrow(/at least 32/);
  });
});
