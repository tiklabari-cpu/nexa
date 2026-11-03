import { describe, expect, it } from 'vitest';
import { SIGNED_IDENTITY_LIMITS } from '@siyahtus/types';
import { CredentialDecryptError } from '../../lib/credential-cipher.js';
import {
  IdentityLedger,
  IdentitySecretCodec,
  identityAge,
  identitySignatureMatches,
  newIdentitySecret,
  parseIdentityClaim,
  signIdentity,
  type IdentityClaim,
  type IdentityLedgerStore,
} from './member-identity.js';
import { MemberTokenCodec, newSigningKey } from './member-token.js';

const SECRET = 'a-customer-token-secret-of-at-least-32-chars';
const LICENSE = 7n;
/** The example the documentation prints, and its known answer (types' own test). */
const EXAMPLE_SECRET = 'sti_example-secret-do-not-use-0123456789abcdef';
const EXAMPLE_HASH = '42ad1f80b50c90774fd19d7fff514edaf19f4d8ec6a395131f4e1baad3d3a754';

function claimFor(
  secret: string,
  fields: { userId: string; username?: string | null; email?: string | null; ts: number },
): IdentityClaim {
  return {
    userId: fields.userId,
    username: fields.username ?? null,
    email: fields.email ?? null,
    ts: fields.ts,
    hash: signIdentity(secret, fields),
  };
}

describe('parseIdentityClaim (ID-03 · K28)', () => {
  const valid = {
    user_id: 'player-42',
    username: 'ayse',
    email: 'ayse@example.com',
    ts: 1_730_000_000,
    user_hash: EXAMPLE_HASH,
  };

  it('reads the five fields the page hands identify', () => {
    expect(parseIdentityClaim(valid)).toEqual({
      userId: 'player-42',
      username: 'ayse',
      email: 'ayse@example.com',
      ts: 1_730_000_000,
      hash: EXAMPLE_HASH,
    });
  });

  it('takes a ts written as digits and a signature in capitals, and normalises both', () => {
    const parsed = parseIdentityClaim({
      ...valid,
      ts: '1730000000',
      user_hash: EXAMPLE_HASH.toUpperCase(),
    });
    expect(parsed?.ts).toBe(1_730_000_000);
    expect(parsed?.hash).toBe(EXAMPLE_HASH);
  });

  it('reads an empty or missing username and e-mail as absent — both sign as an empty line', () => {
    expect(parseIdentityClaim({ ...valid, username: '', email: undefined })).toMatchObject({
      username: null,
      email: null,
    });
    expect(parseIdentityClaim({ ...valid, username: null, email: null })).toMatchObject({
      username: null,
      email: null,
    });
  });

  it('refuses a control character in any field, so no value can move a line into the next field', () => {
    // "a\nb" as the id with no username signs the same message as "a" with
    // username "b" — refused, so the order of the lines is the whole format.
    expect(parseIdentityClaim({ ...valid, user_id: 'a\nb', username: '' })).toBeNull();
    expect(parseIdentityClaim({ ...valid, username: 'ay\nse' })).toBeNull();
    expect(parseIdentityClaim({ ...valid, email: 'a@b.c\r' })).toBeNull();
    expect(parseIdentityClaim({ ...valid, user_id: 'tab\there' })).toBeNull();
    expect(parseIdentityClaim({ ...valid, username: 'del\u007f' })).toBeNull();
  });

  it('refuses what cannot be checked: no id, over-long fields, a bad ts, a short or non-hex signature', () => {
    for (const bad of [
      null,
      'player-42',
      [valid],
      { ...valid, user_id: '' },
      { ...valid, user_id: 42 },
      { ...valid, user_id: 'x'.repeat(SIGNED_IDENTITY_LIMITS.userIdMaxLength + 1) },
      { ...valid, username: 'x'.repeat(SIGNED_IDENTITY_LIMITS.usernameMaxLength + 1) },
      { ...valid, username: 7 },
      { ...valid, email: 'not-an-address' },
      { ...valid, email: `${'x'.repeat(250)}@b.cd` },
      { ...valid, ts: 1.5 },
      { ...valid, ts: -1 },
      { ...valid, ts: '17e8' },
      { ...valid, ts: undefined },
      { ...valid, user_hash: EXAMPLE_HASH.slice(1) },
      { ...valid, user_hash: `${EXAMPLE_HASH.slice(1)}g` },
      { ...valid, user_hash: undefined },
    ]) {
      expect(parseIdentityClaim(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('accepts the bounds themselves', () => {
    expect(
      parseIdentityClaim({
        ...valid,
        user_id: 'x'.repeat(SIGNED_IDENTITY_LIMITS.userIdMaxLength),
        username: 'y'.repeat(SIGNED_IDENTITY_LIMITS.usernameMaxLength),
      }),
    ).not.toBeNull();
  });
});

describe('signIdentity / identitySignatureMatches', () => {
  it('makes the known-answer signature the documentation prints', () => {
    expect(
      signIdentity(EXAMPLE_SECRET, {
        userId: 'player-42',
        username: 'ayse',
        email: 'ayse@example.com',
        ts: 1_730_000_000,
      }),
    ).toBe(EXAMPLE_HASH);
  });

  it('accepts a signature made with any of the secrets it is given, and no other', () => {
    const current = newIdentitySecret();
    const previous = newIdentitySecret();
    const claim = claimFor(previous, { userId: 'p1', ts: 100 });
    expect(identitySignatureMatches(claim, [current, previous])).toBe(true);
    expect(identitySignatureMatches(claim, [current])).toBe(false);
    expect(identitySignatureMatches(claim, [])).toBe(false);
  });

  it('covers every field and the time: changing any one breaks it', () => {
    const secret = newIdentitySecret();
    const claim = claimFor(secret, {
      userId: 'p1',
      username: 'ali',
      email: 'ali@x.test',
      ts: 1_000,
    });
    expect(identitySignatureMatches(claim, [secret])).toBe(true);
    for (const change of [
      { userId: 'p2' },
      { username: 'veli' },
      { username: null },
      { email: 'veli@x.test' },
      { ts: 1_001 },
    ]) {
      expect(identitySignatureMatches({ ...claim, ...change }, [secret])).toBe(false);
    }
  });

  it('is keyed with the secret string itself, not some decoding of it', () => {
    const secret = newIdentitySecret();
    const claim = claimFor(secret, { userId: 'p1', ts: 1 });
    const decoded = Buffer.from(secret.slice(4), 'base64url').toString('latin1');
    expect(identitySignatureMatches(claim, [decoded])).toBe(false);
  });
});

describe('identityAge', () => {
  const now = 1_730_000_000_000;
  const seconds = now / 1000;

  it('keeps a signature for five minutes and no longer (exactly the limit passes)', () => {
    expect(identityAge(seconds, now)).toBe('ok');
    expect(identityAge(seconds - SIGNED_IDENTITY_LIMITS.maxAgeSeconds, now)).toBe('ok');
    expect(identityAge(seconds - SIGNED_IDENTITY_LIMITS.maxAgeSeconds - 1, now)).toBe('expired');
  });

  it('tolerates the operator clock a minute ahead, not more (clock skew)', () => {
    expect(identityAge(seconds + SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds, now)).toBe('ok');
    expect(identityAge(seconds + SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds + 1, now)).toBe(
      'future',
    );
  });
});

describe('IdentitySecretCodec', () => {
  const codec = new IdentitySecretCodec(SECRET);

  it('seals in the credential-cipher format and opens what it sealed', () => {
    const secret = newIdentitySecret();
    const sealed = codec.seal(LICENSE, 3, secret);
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain(secret);
    expect(codec.open(LICENSE, 3, sealed)).toBe(secret);
  });

  it('binds the ciphertext to its licence and version', () => {
    const sealed = codec.seal(LICENSE, 3, newIdentitySecret());
    expect(() => codec.open(8n, 3, sealed)).toThrow(CredentialDecryptError);
    expect(() => codec.open(LICENSE, 2, sealed)).toThrow(CredentialDecryptError);
  });

  it('does not open under another deployment secret, nor a member-token key sealed under the same one', () => {
    const sealed = codec.seal(LICENSE, 1, newIdentitySecret());
    expect(() =>
      new IdentitySecretCodec('another-customer-token-secret-0123456789').open(LICENSE, 1, sealed),
    ).toThrow(CredentialDecryptError);
    // Its own KEK label: the member-token key's ciphertext is not an identity secret.
    const memberKey = new MemberTokenCodec(SECRET).sealKey(LICENSE, 1, newSigningKey());
    expect(() => codec.open(LICENSE, 1, memberKey)).toThrow();
  });

  it('refuses a short deployment secret', () => {
    expect(() => new IdentitySecretCodec('short')).toThrow(/at least 32/);
  });
});

describe('newIdentitySecret', () => {
  it('is the scanner prefix and 256 random bits, different every time', () => {
    const a = newIdentitySecret();
    expect(a).toMatch(/^sti_[A-Za-z0-9_-]{43}$/);
    expect(newIdentitySecret()).not.toBe(a);
  });
});

/** Redis, as far as the ledger uses it. */
class FakeStore implements IdentityLedgerStore {
  readonly values = new Map<string, { value: string; ttlMs: number }>();
  readonly hashes = new Map<string, Map<string, number>>();
  readonly ttls = new Map<string, number>();
  failing = false;

  async set(key: string, value: string, _px: 'PX', ttlMs: number, _nx: 'NX') {
    if (this.failing) throw new Error('redis down');
    if (this.values.has(key)) return null;
    this.values.set(key, { value, ttlMs });
    return 'OK';
  }
  async hincrby(key: string, field: string, increment: number) {
    if (this.failing) throw new Error('redis down');
    const hash = this.hashes.get(key) ?? new Map<string, number>();
    hash.set(field, (hash.get(field) ?? 0) + increment);
    this.hashes.set(key, hash);
    return hash.get(field)!;
  }
  async expire(key: string, seconds: number) {
    this.ttls.set(key, seconds);
    return 1;
  }
  async hgetall(key: string) {
    if (this.failing) throw new Error('redis down');
    return Object.fromEntries(
      [...(this.hashes.get(key) ?? new Map<string, number>())].map(([k, v]) => [k, String(v)]),
    );
  }
}

describe('IdentityLedger', () => {
  const nowMs = 1_730_000_000_000;
  const claim: IdentityClaim = {
    userId: 'p1',
    username: null,
    email: null,
    ts: nowMs / 1000 - 10,
    hash: 'a'.repeat(64),
  };

  it('spends a signature once: the second claim of the same one is a replay', async () => {
    const store = new FakeStore();
    const ledger = new IdentityLedger(store);
    expect(await ledger.claim(LICENSE, claim, nowMs)).toBe(true);
    expect(await ledger.claim(LICENSE, claim, nowMs)).toBe(false);
    // Per licence: the same bytes under another workspace's secret are another signature.
    expect(await ledger.claim(8n, claim, nowMs)).toBe(true);
  });

  it('keeps the record past the last moment the signature could still pass', async () => {
    const store = new FakeStore();
    await new IdentityLedger(store).claim(LICENSE, claim, nowMs);
    const [record] = [...store.values.values()];
    // 300 s of life minus the 10 s already gone, plus the skew allowance again.
    expect(record!.ttlMs).toBe(
      (SIGNED_IDENTITY_LIMITS.maxAgeSeconds - 10 + SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds) *
        1000,
    );
  });

  it('throws when the record cannot be reached — the caller refuses rather than accept unchecked', async () => {
    const store = new FakeStore();
    store.failing = true;
    await expect(new IdentityLedger(store).claim(LICENSE, claim, nowMs)).rejects.toThrow();
  });

  it('counts outcomes per day and reads the last week back by reason', async () => {
    const store = new FakeStore();
    const ledger = new IdentityLedger(store);
    const today = new Date(nowMs);
    const sixDaysAgo = new Date(nowMs - 6 * 86_400_000);
    const eightDaysAgo = new Date(nowMs - 8 * 86_400_000);
    await ledger.record(LICENSE, 'verified', today);
    await ledger.record(LICENSE, 'verified', sixDaysAgo);
    await ledger.record(LICENSE, 'bad_signature', today);
    await ledger.record(LICENSE, 'disabled', today);
    await ledger.record(LICENSE, 'disabled', eightDaysAgo);
    await ledger.record(8n, 'verified', today);

    expect(await ledger.read(LICENSE, today)).toEqual({
      days: 7,
      verified: 2,
      refused: { bad_signature: 1, disabled: 1 },
    });
    // A day's counters outlive the window that reads them, then go.
    expect([...store.ttls.values()].every((seconds) => seconds === 8 * 86_400)).toBe(true);
  });

  it('never fails a mint for a counter, and reads "unknown" rather than zero when Redis is down', async () => {
    const store = new FakeStore();
    store.failing = true;
    const ledger = new IdentityLedger(store);
    await expect(ledger.record(LICENSE, 'verified')).resolves.toBeUndefined();
    expect(await ledger.read(LICENSE)).toBeNull();
  });
});
