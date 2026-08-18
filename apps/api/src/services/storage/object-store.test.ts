/**
 * `STORAGE_PROVIDER` selects an object store (M-PROV-a · §D113/K3).
 *
 * Three routes each said `new LocalStore(env.STORAGE_LOCAL_DIR)`, so the key was
 * validated and then ignored. There is one implementation and there is meant to
 * be — a real S3 provider is out of scope (CLAUDE.md) — which makes the
 * temptation here to assert `instanceof LocalStore` and call it covered. That
 * proves nothing about the seam, so the store that comes back is exercised
 * through the interface instead: the round trip and the `exists` check are what
 * `attachment.ts` leans on to refuse an attachment nobody uploaded.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createObjectStore, digestBytes, STORAGE_PROVIDERS } from './object-store.js';
import { buildKey } from './upload-url.js';

/** `LocalStore` only accepts keys `buildKey` could have produced. */
const KEY = buildKey(7n, 'text/plain');

describe('createObjectStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-store-factory-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gives "local" a store rooted at STORAGE_LOCAL_DIR', async () => {
    const store = createObjectStore('local', { localDir: dir });

    expect(await store.exists(KEY)).toBe(false);
    await store.put(KEY, Buffer.from('hello'), 'text/plain');

    expect(await store.exists(KEY)).toBe(true);
    expect(await store.get(KEY)).toEqual({
      bytes: Buffer.from('hello'),
      contentType: 'text/plain',
    });
  });

  it('roots two stores independently, so the directory is the store', async () => {
    // The property the setting exists for: pointing `STORAGE_LOCAL_DIR`
    // somewhere else has to move the bytes, not just the label.
    const other = await mkdtemp(join(tmpdir(), 'nexa-store-factory-'));
    try {
      await createObjectStore('local', { localDir: dir }).put(KEY, Buffer.from('a'), 'text/plain');
      expect(await createObjectStore('local', { localDir: other }).exists(KEY)).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('has an implementation for every value the vocabulary allows', () => {
    for (const provider of STORAGE_PROVIDERS) {
      expect(createObjectStore(provider, { localDir: dir })).toBeDefined();
    }
    expect(STORAGE_PROVIDERS).toEqual(['local']);
  });
});

describe('digestBytes', () => {
  it('is sha256 over the bytes, independent of any store', () => {
    // Moved off `LocalStore` as a static so the upload route stopped importing
    // the concrete store it no longer picks. Same value as before the move —
    // the checksum is on the wire, so a change here is a contract change.
    expect(digestBytes(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
