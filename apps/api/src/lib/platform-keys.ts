/**
 * The platform's sub-keys, derived from `PLATFORM_SETTINGS_KEY` (tm 389.4 ·
 * design.md §B2, §F).
 *
 * One root key in the environment, a separate key per purpose: the operators'
 * TOTP secrets (here), the platform audit chain's HMAC (389.5) and the AI API
 * keys pasted into the root panel (389.17). HKDF-SHA256 with a purpose label
 * as `info`, so a key derived for one use is useless for another — a leaked
 * audit key opens no TOTP secret — and rotating one purpose is a new label,
 * not a new environment variable.
 *
 * The root lives in the environment and never in the database, like
 * `AUDIT_CHAIN_SECRET`: a database dump alone does not open a sealed secret.
 */
import { hkdfSync } from 'node:crypto';

/** The `info` labels in use. A later purpose adds its own; none is ever reused. */
export const PLATFORM_KEY_INFO = {
  /** AES-256-GCM over `platform_admins.totp_secret_ciphertext`. */
  totpSecret: 'siyahtus/platform/totp-secret/v1',
} as const;

export type PlatformKeyPurpose = keyof typeof PLATFORM_KEY_INFO;

/**
 * A 256-bit sub-key for `purpose`, as the 64 hex characters
 * `lib/credential-cipher.ts` takes. No salt: the root is already a uniformly
 * random secret (RFC 5869 §3.1 allows the zero-length salt for that case).
 */
export function derivePlatformKey(root: string, purpose: PlatformKeyPurpose): string {
  if (root.length === 0) throw new Error('platform root key is empty');
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(root, 'utf8'), Buffer.alloc(0), PLATFORM_KEY_INFO[purpose], 32),
  ).toString('hex');
}
