/**
 * The two key shapes (tm 357 · HD-02): an upload's and an e-mailed file's.
 *
 * The point of the second shape is what it is *not*: an upload key. Every door
 * that takes an upload key — `GET /uploads/{key}`, the composer's
 * `attachment_keys`, a chat's `attachment_url` — asks `licenseOfKey`, so the
 * one property that keeps a sensitive e-mailed file behind the ticket's door
 * (role check, audit entry) is that `licenseOfKey` refuses it.
 */
import { describe, expect, it } from 'vitest';
import {
  buildKey,
  buildMailKey,
  keyFromAttachmentUrl,
  licenseOfKey,
  licenseOfMailKey,
  licenseOfStoredKey,
  UPLOAD_PATH_PREFIX,
} from './upload-url.js';

describe('upload and e-mailed-file keys', () => {
  it('builds an e-mailed-file key under its licence, with the extension of its type', () => {
    const key = buildMailKey(42n, 'application/pdf');
    expect(key).toMatch(/^42-m-[0-9a-f-]{36}\.pdf$/);
    expect(licenseOfMailKey(key)).toBe(42n);
    expect(licenseOfStoredKey(key)).toBe(42n);
  });

  it('is not an upload key, so no upload door serves or accepts it', () => {
    const key = buildMailKey(42n, 'image/png');
    expect(licenseOfKey(key)).toBeNull();
    expect(keyFromAttachmentUrl(`${UPLOAD_PATH_PREFIX}${key}`)).toBeNull();
  });

  it('keeps an upload key what it was — and not an e-mailed one', () => {
    const key = buildKey(42n, 'image/png');
    expect(licenseOfKey(key)).toBe(42n);
    expect(licenseOfMailKey(key)).toBeNull();
    expect(licenseOfStoredKey(key)).toBe(42n);
  });

  it('refuses anything that is neither', () => {
    for (const key of ['', '42', '42-m-', '../42-m-x.pdf', '42-m-not-a-uuid.pdf', 'x-m-1.pdf']) {
      expect(licenseOfStoredKey(key), key).toBeNull();
    }
  });
});
