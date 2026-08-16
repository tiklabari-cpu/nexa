/**
 * `expo-crypto` is the platform's own SHA-256 and CSPRNG, so it is stubbed here
 * rather than re-implemented. What is left is exactly what this module owns:
 * that the verifier is fresh and legal, that the challenge is the *digest* of it
 * rather than the thing itself, and that base64 becomes base64url before it is
 * put in a query string.
 *
 * The digest stub is a marker (`sha256(<input>)`) rather than a fixed string, so
 * a challenge derived from the wrong value cannot pass by coincidence. The one
 * known-answer test below uses RFC 7636 Appendix B's vector, which is what
 * proves the encoding step against a number nobody in this repository chose.
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
    getRandomBytesAsync: async (count: number) => {
      // Distinct per call and per byte — enough to tell "fresh each time" from
      // "the same buffer handed back", which is the property being tested.
      counter += 1;
      return Uint8Array.from({ length: count }, (_, i) => (i * 31 + counter * 7) % 256);
    },
    digestStringAsync: async (_algorithm: string, data: string) =>
      (globalThis as { __digests__?: Record<string, string> }).__digests__?.[data] ??
      `sha256(${data})`,
  };
});

import { base64Url, createPkcePair, createState, deriveChallenge } from './pkce';

/** The server's rule, restated rather than imported: RFC 7636 §4.1. */
const UNRESERVED = /^[A-Za-z0-9\-._~]{43,128}$/;

/** ASCII → bytes, so the encoder can be exercised without Node's Buffer. */
function bytesOf(ascii: string): Uint8Array {
  return Uint8Array.from({ length: ascii.length }, (_, i) => ascii.charCodeAt(i));
}

describe('createPkcePair', () => {
  it('produces a verifier the server will accept', async () => {
    const { verifier } = await createPkcePair();
    expect(verifier).toMatch(UNRESERVED);
  });

  it('challenges with the digest of the verifier, never the verifier', async () => {
    const { verifier, challenge } = await createPkcePair();

    // The stub echoes its input, so this asserts *which* string was hashed.
    expect(challenge).toBe(base64UrlOfMarker(`sha256(${verifier})`));
    expect(challenge).not.toBe(verifier);
  });

  it('does not repeat itself', async () => {
    const pairs = await Promise.all([createPkcePair(), createPkcePair(), createPkcePair()]);
    expect(new Set(pairs.map((p) => p.verifier)).size).toBe(3);
  });
});

describe('deriveChallenge', () => {
  it('matches RFC 7636 Appendix B', async () => {
    // The published pair. Both halves are fixed by the RFC, so this test fails
    // if the encoding drops padding wrongly, keeps `+`/`/`, or hashes the wrong
    // string — the three ways a challenge is silently unusable.
    (globalThis as { __digests__?: Record<string, string> }).__digests__ = {
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk': 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM=',
    };

    await expect(deriveChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('carries no padding or non-URL characters into the query', async () => {
    (globalThis as { __digests__?: Record<string, string> }).__digests__ = {
      slash: 'Eokxg0SKol92s6q3zda2l/I0X+4mhrujLsQpNg0vfuY=',
    };

    await expect(deriveChallenge('slash')).resolves.toBe(
      'Eokxg0SKol92s6q3zda2l_I0X-4mhrujLsQpNg0vfuY',
    );
  });

  it('is stable for a given verifier', async () => {
    delete (globalThis as { __digests__?: Record<string, string> }).__digests__;
    const verifier = 'a'.repeat(43);
    expect(await deriveChallenge(verifier)).toBe(await deriveChallenge(verifier));
  });
});

describe('createState', () => {
  it('is fresh each time and long enough to be unguessable', async () => {
    const states = await Promise.all([createState(), createState(), createState()]);
    expect(new Set(states).size).toBe(3);
    for (const state of states) expect(state.length).toBeGreaterThanOrEqual(16);
  });
});

describe('base64Url', () => {
  // RFC 4648 §10's vectors in the unpadded URL alphabet. Three code paths hide
  // in the tail — zero, one and two leftover bytes — and these walk all three.
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j', (input, expected) => {
    expect(base64Url(bytesOf(input))).toBe(expected);
  });

  it('uses - and _ where standard base64 uses + and /', () => {
    // 0xFB 0xFF is `+/8` in standard base64.
    expect(base64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
  });

  it('never emits padding', () => {
    for (let length = 1; length <= 8; length += 1) {
      expect(base64Url(Uint8Array.from({ length }, (_, i) => i))).not.toContain('=');
    }
  });
});

/** What `base64Url` would make of the stub digest, so the assertion is exact. */
function base64UrlOfMarker(marker: string): string {
  return marker.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
