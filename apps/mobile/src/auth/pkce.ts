/**
 * PKCE, on a device that has no `crypto.subtle`.
 *
 * React Native ships no Web Crypto, so the web app's `crypto.getRandomValues` +
 * `crypto.subtle.digest` pair is unavailable here. `expo-crypto` is the
 * platform's own — it reaches SecRandomCopyBytes on iOS and SecureRandom on
 * Android rather than seeding a JavaScript PRNG, which matters: a verifier from
 * `Math.random` is a verifier an attacker can reproduce, and the whole point of
 * PKCE is that only the app that started the login can finish it.
 *
 * The server enforces the shape it needs (`isValidCodeVerifier`, S256 only), so
 * nothing here is the security boundary. What is here is the part the server
 * cannot check: that the verifier was unpredictable and that it never leaves
 * this process except as its own digest.
 */
import * as Crypto from 'expo-crypto';

export interface PkcePair {
  /** The secret, kept in memory until the code is exchanged (RFC 7636 §4.1). */
  verifier: string;
  /** `BASE64URL(SHA256(verifier))` — the only half that travels early. */
  challenge: string;
}

/**
 * 48 bytes → 64 base64url characters, comfortably inside RFC 7636's 43–128 and
 * matching what `apps/web` sends. Larger would be legal and pointless: the
 * digest is 256 bits either way.
 */
const VERIFIER_BYTES = 48;

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64Url(await Crypto.getRandomBytesAsync(VERIFIER_BYTES));
  return { verifier, challenge: await deriveChallenge(verifier) };
}

export async function deriveChallenge(verifier: string): Promise<string> {
  // BASE64 rather than the default HEX: a hex digest is 64 characters of the
  // wrong alphabet, and the server compares against `BASE64URL(SHA256(...))`.
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return toBase64Url(digest);
}

/**
 * An opaque value echoed back by the callback, so a redirect that did not come
 * from the login this app started can be told apart from one that did
 * (RFC 6749 §10.12). Same generator as the verifier — it needs the same
 * unguessability and nothing more.
 */
export async function createState(): Promise<string> {
  return base64Url(await Crypto.getRandomBytesAsync(16));
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encoded by hand rather than through `btoa`, which is not a React Native
 * global: it exists in some Hermes builds and not others, and "sign-in throws
 * `btoa is not a function` on one platform" is exactly the kind of defect that
 * only shows up on a device. Twelve lines is cheaper than that surprise.
 */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);

    out += BASE64URL_ALPHABET[(triple >> 18) & 63]! + BASE64URL_ALPHABET[(triple >> 12) & 63]!;
    // The tail is truncated, not padded: base64url in OAuth carries no `=`
    // (RFC 7636 §4.1 defers to RFC 4648 §5 without padding).
    if (b !== undefined) out += BASE64URL_ALPHABET[(triple >> 6) & 63]!;
    if (c !== undefined) out += BASE64URL_ALPHABET[triple & 63]!;
  }
  return out;
}

/** Base64 → base64url: RFC 4648 §5's alphabet, without the padding. */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
