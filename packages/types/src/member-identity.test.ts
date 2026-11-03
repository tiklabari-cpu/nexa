import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MEMBER_IDENTITY_SECRET_PREFIX,
  MEMBER_IDENTITY_SECRET_ROTATION_GRACE,
  SIGNED_IDENTITY_LIMITS,
  SIGNED_IDENTITY_REFUSALS,
  SIGNED_IDENTITY_VERSION,
  isSignedIdentityRefusal,
  signedIdentityMessage,
} from './member-identity.js';

/**
 * The example the install guide and the settings screen print. Its signature is
 * a known answer: an operator who copies the example into PHP or Node gets this
 * hex, or their message is not the one SiyahTuş checks.
 */
const EXAMPLE_SECRET = 'sti_example-secret-do-not-use-0123456789abcdef';

describe('signedIdentityMessage (ID-03 · K28)', () => {
  it('is the version line, then user_id, username, email and ts, one per line', () => {
    expect(
      signedIdentityMessage({
        user_id: 'player-42',
        username: 'ayse',
        email: 'ayse@example.com',
        ts: 1_730_000_000,
      }),
    ).toBe('siyahtus-identify-v1\nplayer-42\nayse\nayse@example.com\n1730000000');
  });

  it('signs an absent username or e-mail as an empty line, never as "null"', () => {
    const message = signedIdentityMessage({ user_id: 'player-42', ts: 1_730_000_000 });
    expect(message).toBe('siyahtus-identify-v1\nplayer-42\n\n\n1730000000');
    expect(signedIdentityMessage({ user_id: 'player-42', username: null, ts: 1_730_000_000 })).toBe(
      message,
    );
  });

  it('gives the known-answer HMACs the documentation prints', () => {
    const sign = (message: string): string =>
      createHmac('sha256', EXAMPLE_SECRET).update(message, 'utf8').digest('hex');
    expect(
      sign(
        signedIdentityMessage({
          user_id: 'player-42',
          username: 'ayse',
          email: 'ayse@example.com',
          ts: 1_730_000_000,
        }),
      ),
    ).toBe('42ad1f80b50c90774fd19d7fff514edaf19f4d8ec6a395131f4e1baad3d3a754');
    expect(sign(signedIdentityMessage({ user_id: 'player-42', ts: 1_730_000_000 }))).toBe(
      '3331af73a38236e04d688061d3adf5da0244eb6dcd3faadfff728c7d53f18452',
    );
  });

  it('starts with a versioned line, so a later format cannot be confused with this one', () => {
    expect(SIGNED_IDENTITY_VERSION).toBe('siyahtus-identify-v1');
    expect(signedIdentityMessage({ user_id: 'x', ts: 1 }).split('\n')[0]).toBe(
      SIGNED_IDENTITY_VERSION,
    );
  });
});

describe('SIGNED_IDENTITY_LIMITS (ID-03 · K28)', () => {
  it('keeps a signature for five minutes and tolerates a minute of the operator clock running ahead', () => {
    expect(SIGNED_IDENTITY_LIMITS.maxAgeSeconds).toBe(300);
    expect(SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds).toBe(60);
    expect(Object.isFrozen(SIGNED_IDENTITY_LIMITS)).toBe(true);
  });

  it('bounds the username like the pre-chat form does', () => {
    expect(SIGNED_IDENTITY_LIMITS.usernameMaxLength).toBe(120);
  });
});

describe('MEMBER_IDENTITY_SECRET_ROTATION_GRACE (ID-03 · K28)', () => {
  it('defaults to a day, allows retiring the old secret at once, and stops at 30 days', () => {
    expect(MEMBER_IDENTITY_SECRET_ROTATION_GRACE).toEqual({
      defaultSeconds: 86_400,
      minSeconds: 0,
      maxSeconds: 30 * 86_400,
    });
    expect(Object.isFrozen(MEMBER_IDENTITY_SECRET_ROTATION_GRACE)).toBe(true);
  });
});

describe('SIGNED_IDENTITY_REFUSALS', () => {
  it('names every reason once and recognises only those', () => {
    expect(new Set(SIGNED_IDENTITY_REFUSALS).size).toBe(SIGNED_IDENTITY_REFUSALS.length);
    for (const reason of SIGNED_IDENTITY_REFUSALS)
      expect(isSignedIdentityRefusal(reason)).toBe(true);
    expect(isSignedIdentityRefusal('revoked')).toBe(false);
    expect(isSignedIdentityRefusal(undefined)).toBe(false);
  });

  it('marks the secret so a scanner can find a leaked one', () => {
    expect(MEMBER_IDENTITY_SECRET_PREFIX).toBe('sti_');
  });
});
