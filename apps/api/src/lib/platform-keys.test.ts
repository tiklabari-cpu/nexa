import { describe, expect, it } from 'vitest';
import { decryptCredential, encryptCredential } from './credential-cipher.js';
import { derivePlatformKey } from './platform-keys.js';

describe('derivePlatformKey (tm 389.4)', () => {
  const ROOT = 'r'.repeat(48);

  it('gives a stable 256-bit key per root, usable by the credential cipher', () => {
    const key = derivePlatformKey(ROOT, 'totpSecret');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(derivePlatformKey(ROOT, 'totpSecret')).toBe(key);
    const sealed = encryptCredential('JBSWY3DPEHPK3PXP', key, 'platform_admin_totp:a');
    expect(decryptCredential(sealed, key, 'platform_admin_totp:a')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never hands the root itself out, and a different root gives a different key', () => {
    const key = derivePlatformKey(ROOT, 'totpSecret');
    expect(key).not.toContain(Buffer.from(ROOT).toString('hex').slice(0, 16));
    expect(derivePlatformKey('s'.repeat(48), 'totpSecret')).not.toBe(key);
  });

  it('refuses an empty root', () => {
    expect(() => derivePlatformKey('', 'totpSecret')).toThrow(/empty/);
  });
});
