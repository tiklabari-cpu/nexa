import { afterEach, describe, expect, it, vi } from 'vitest';
import { newAttemptKey } from './attempt-key.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('purchase attempt key (FR-MOD-10.1.4)', () => {
  it('is a v4 UUID — the shape the purchase endpoint validates', () => {
    expect(newAttemptKey()).toMatch(UUID_V4);
  });

  it('is different every time, so two purchases are never one replay', () => {
    const keys = new Set(Array.from({ length: 200 }, newAttemptKey));
    expect(keys.size).toBe(200);
  });

  it('still produces a valid UUID without crypto.randomUUID', () => {
    // `randomUUID` needs a secure context; the console is served over plain HTTP
    // in local development, and a key the server rejects would make buying
    // impossible there rather than merely unseeded.
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i * 7;
        return bytes;
      },
    });
    expect(newAttemptKey()).toMatch(UUID_V4);
  });

  it('still produces a valid UUID with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    const keys = Array.from({ length: 20 }, newAttemptKey);
    for (const key of keys) expect(key).toMatch(UUID_V4);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('falls back rather than throwing when randomUUID itself throws', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('insecure context');
      },
      getRandomValues: (bytes: Uint8Array) => bytes,
    });
    expect(newAttemptKey()).toMatch(UUID_V4);
  });
});
