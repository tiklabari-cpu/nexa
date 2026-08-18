/**
 * The `local` storage provider — the `ObjectStore` implementation
 * `STORAGE_PROVIDER=local` selects (see `object-store.ts`).
 *
 * Files land under `STORAGE_LOCAL_DIR`, which lives inside the already-ignored
 * `.data/`. Keys are `<licenseId>/<uuid><ext>` and are built by `buildKey`, so
 * the only path segments here are digits and a uuid — but the join is still
 * checked against the root before every read and write. A traversal bug in this
 * file would hand out the filesystem, and "the caller cannot reach it" is an
 * argument that stops being true the first time someone adds a caller.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ObjectStore, StoredFile } from './object-store.js';
import { licenseOfKey } from './upload-url.js';

/**
 * Re-exported where it has always been imported from. It is declared next to
 * the `ObjectStore` interface it belongs to, and a type-only import back means
 * this file still has exactly one runtime dependency direction.
 */
export type { StoredFile };

export class LocalStore implements ObjectStore {
  readonly #root: string;

  constructor(directory: string) {
    this.#root = resolve(directory);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const path = this.#pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    // The content type is not recoverable from the extension for every type we
    // allow, and guessing it on the way out is how a text/plain becomes a
    // text/html in someone's browser.
    await writeFile(`${path}.type`, contentType);
  }

  async get(key: string): Promise<StoredFile | null> {
    const path = this.#pathFor(key);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(path),
        readFile(`${path}.type`, 'utf8'),
      ]);
      return { bytes, contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  /**
   * Whether the bytes are actually here.
   *
   * A grant is permission to upload, not permission to claim: without this,
   * an event could point at a key that was issued and never used, and every
   * recipient would see a broken attachment we told them was fine.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.#pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  #pathFor(key: string): string {
    const license = licenseOfKey(key);
    if (license === null) {
      throw new Error('refusing to touch a key that is not in our own format');
    }
    // Keys are flat so they fit one path parameter; on disk they still fan out
    // per licence, so no directory ends up with every file in the system.
    const path = resolve(join(this.#root, String(license), key));
    if (path !== this.#root && !path.startsWith(this.#root + sep)) {
      throw new Error('refusing a path that escapes the storage root');
    }
    return path;
  }
}
