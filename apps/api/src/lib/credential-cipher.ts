/**
 * Encryption for the provider credentials Apps connections keep (tm 263).
 *
 * A live card has to present the user's key to the provider again — on every
 * chat-panel lookup, on every Telegram reply — so a hash (what mock cards keep)
 * is not enough: the value must come back. AES-256-GCM, because it is
 * authenticated: a ciphertext edited in the database fails to open rather than
 * opening into something else.
 *
 * The additional data binds a ciphertext to the row it was written for
 * (`licenseId:appId`, `licenseId:channelId`). Without it, anyone able to write
 * the table could copy one workspace's ciphertext into another's row and have
 * this process present the first workspace's key on the second's behalf.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64url. The version is the
 * first thing read, so a future key rotation can introduce `v2` without guessing.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown for anything that does not open: wrong key, wrong row, edited bytes, bad format. */
export class CredentialDecryptError extends Error {
  constructor() {
    // Deliberately says nothing about which check failed or what the value was.
    super('credential could not be decrypted');
    this.name = 'CredentialDecryptError';
  }
}

function keyBytes(hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error('credential key must be 64 hexadecimal characters');
  }
  return Buffer.from(hexKey, 'hex');
}

export function encryptCredential(plain: string, hexKey: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(hexKey), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join(':');
}

export function decryptCredential(sealed: string, hexKey: string, aad: string): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new CredentialDecryptError();
  const [, rawIv, rawTag, rawBody] = parts as [string, string, string, string];
  const iv = Buffer.from(rawIv, 'base64url');
  const tag = Buffer.from(rawTag, 'base64url');
  const body = Buffer.from(rawBody, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CredentialDecryptError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(hexKey), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialDecryptError();
  }
}

/** The row binding for an Apps installation's credential. */
export function appCredentialAad(licenseId: string, appId: string): string {
  return `app:${licenseId}:${appId}`;
}

/** The row binding for a channel's credential (a Telegram bot token). */
export function channelCredentialAad(licenseId: string, channelId: string): string {
  return `channel:${licenseId}:${channelId}`;
}
