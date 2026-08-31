/**
 * `LocalStore`'s half of the contract the `s3` provider made explicit
 * (M-STORE-a).
 *
 * The round trip and the traversal guard are covered through the factory
 * (`object-store.test.ts`). What is here is the one behaviour that changed: this
 * store used to answer every failure with `null`/`false`, which on a local disk
 * was very nearly always right, because very nearly every failure is ENOENT.
 * "Very nearly" stopped being good enough when the interface acquired a second
 * implementation — a contract only one side keeps is not a contract, and
 * `attachment.ts` renders `false` to the caller as "that is not a file this
 * workspace uploaded".
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './local-store.js';
import { StorageUnavailableError } from './storage-error.js';
import { buildKey } from './upload-url.js';

const KEY = buildKey(7n, 'text/plain');

describe('LocalStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-local-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('answers a key nobody wrote with a plain absence', async () => {
    const store = new LocalStore(dir);

    expect(await store.exists(KEY)).toBe(false);
    expect(await store.get(KEY)).toBeNull();
  });

  it('throws rather than reporting absence when the path cannot be read', async () => {
    // A directory where the object should be: `readFile` gives EISDIR, not
    // ENOENT. Stand-in for the class of faults a real volume produces —
    // permissions, a full disk, IO errors — none of which is evidence that the
    // file was never uploaded, and all of which used to come back as `null`.
    const store = new LocalStore(dir);
    await mkdir(join(dir, '7', KEY), { recursive: true });

    await expect(store.get(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('keeps treating a missing licence directory as absence', async () => {
    // ENOTDIR belongs with ENOENT: it is what a lookup returns when a parent
    // segment is not a directory, which for `<licence>/<uuid>` says the same
    // thing — no licence has ever written here.
    await writeFile(join(dir, '7'), 'not a directory');
    const store = new LocalStore(dir);

    expect(await store.exists(KEY)).toBe(false);
    expect(await store.get(KEY)).toBeNull();
  });
});
