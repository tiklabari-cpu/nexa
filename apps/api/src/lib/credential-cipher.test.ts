import { describe, expect, it } from 'vitest';
import {
  appCredentialAad,
  channelCredentialAad,
  CredentialDecryptError,
  decryptCredential,
  encryptCredential,
} from './credential-cipher.js';

const KEY = 'a1'.repeat(32);
const OTHER_KEY = 'b2'.repeat(32);
const PLAIN = 'xkeysib-test-0123456789abcdef-NOTAREALKEY';
const AAD = appCredentialAad('lic-1', 'brevo');

describe('credential cipher (tm 263 · FR-MOD-09.2)', () => {
  it('round-trips a credential under the same key and row', () => {
    const sealed = encryptCredential(PLAIN, KEY, AAD);
    expect(decryptCredential(sealed, KEY, AAD)).toBe(PLAIN);
  });

  it('never carries the plain value, and two seals of one value differ', () => {
    const a = encryptCredential(PLAIN, KEY, AAD);
    const b = encryptCredential(PLAIN, KEY, AAD);
    expect(a).not.toContain(PLAIN);
    expect(a).not.toContain(Buffer.from(PLAIN).toString('base64url'));
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
  });

  it('refuses the wrong key', () => {
    const sealed = encryptCredential(PLAIN, KEY, AAD);
    expect(() => decryptCredential(sealed, OTHER_KEY, AAD)).toThrow(CredentialDecryptError);
  });

  it("refuses a ciphertext copied into another workspace's or another card's row", () => {
    const sealed = encryptCredential(PLAIN, KEY, AAD);
    expect(() => decryptCredential(sealed, KEY, appCredentialAad('lic-2', 'brevo'))).toThrow(
      CredentialDecryptError,
    );
    expect(() => decryptCredential(sealed, KEY, appCredentialAad('lic-1', 'freshdesk'))).toThrow(
      CredentialDecryptError,
    );
    expect(() => decryptCredential(sealed, KEY, channelCredentialAad('lic-1', 'brevo'))).toThrow(
      CredentialDecryptError,
    );
  });

  it('refuses an edited tag, body or iv, and a malformed value', () => {
    const sealed = encryptCredential(PLAIN, KEY, AAD);
    const [v, iv, tag, body] = sealed.split(':') as [string, string, string, string];
    const flip = (part: string): string => {
      const bytes = Buffer.from(part, 'base64url');
      bytes[0] = bytes[0]! ^ 0x01;
      return bytes.toString('base64url');
    };
    for (const edited of [
      [v, iv, flip(tag), body],
      [v, iv, tag, flip(body)],
      [v, flip(iv), tag, body],
      ['v9', iv, tag, body],
    ]) {
      expect(() => decryptCredential(edited.join(':'), KEY, AAD)).toThrow(CredentialDecryptError);
    }
    expect(() => decryptCredential('not-a-credential', KEY, AAD)).toThrow(CredentialDecryptError);
    expect(() => decryptCredential(`${v}:${iv}:${tag}`, KEY, AAD)).toThrow(CredentialDecryptError);
  });

  it('says nothing about the value when it refuses', () => {
    const sealed = encryptCredential(PLAIN, KEY, AAD);
    try {
      decryptCredential(sealed, OTHER_KEY, AAD);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(PLAIN);
      expect(String(error)).not.toContain(OTHER_KEY);
    }
  });

  it('refuses a key that is not 32 bytes of hex', () => {
    expect(() => encryptCredential(PLAIN, 'short', AAD)).toThrow(/64 hexadecimal/);
    expect(() => encryptCredential(PLAIN, 'zz'.repeat(32), AAD)).toThrow(/64 hexadecimal/);
  });
});
