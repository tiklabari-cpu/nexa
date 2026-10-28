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
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  ObjectStore,
  StoredFile,
  StoredFileInfo,
  StoredKnowledgeObject,
} from './object-store.js';
import { StorageUnavailableError } from './storage-error.js';
import { licenseOfKnowledgeKey, storedObjectPath } from './upload-url.js';

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

  /**
   * `allSettled` rather than `all`, which matters more than it looks.
   *
   * Two reads run together and either can fail. `Promise.all` rejects with
   * whichever *lost the race*, so a file that cannot be read while its `.type`
   * sidecar is simply absent would be classified by whichever error arrived
   * first — absence on one scheduling, a failure on the next. Both outcomes are
   * inspected instead, and a real fault wins over a missing sidecar regardless
   * of the order they land in.
   */
  async get(key: string): Promise<StoredFile | null> {
    const path = this.#pathFor(key);
    const [bytes, contentType] = await Promise.allSettled([
      readFile(path),
      readFile(`${path}.type`, 'utf8'),
    ]);

    const fault = [bytes, contentType].find(
      (result) => result.status === 'rejected' && !isMissing(result.reason),
    );
    if (fault?.status === 'rejected') {
      throw new StorageUnavailableError(`GET ${key} could not read ${path}`, {
        cause: fault.reason,
      });
    }
    if (bytes.status === 'rejected' || contentType.status === 'rejected') return null;

    return { bytes: bytes.value, contentType: contentType.value.trim() };
  }

  /**
   * Whether the bytes are actually here.
   *
   * A grant is permission to upload, not permission to claim: without this,
   * an event could point at a key that was issued and never used, and every
   * recipient would see a broken attachment we told them was fine.
   *
   * Only ENOENT is an absence. This used to catch everything and answer
   * `false`, which on a local disk was very nearly always right — but the
   * interface is now shared with a provider where "could not ask" is a routine
   * outcome, and a contract only one implementation keeps is not a contract.
   * A permission error or a full-blown IO fault on the volume says nothing
   * about whether the file is there, and answering `false` to it hands the
   * caller a 400 saying they never uploaded it.
   */
  async exists(key: string): Promise<boolean> {
    const path = this.#pathFor(key);
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw new StorageUnavailableError(`HEAD ${key} could not stat ${path}`, { cause: error });
    }
  }

  /**
   * The length from the file, the type from its sidecar — `get` without the
   * read of the bytes, and classified the same way: both lookups are inspected,
   * a real fault wins over a missing sidecar, and only ENOENT is an absence.
   */
  async stat(key: string): Promise<StoredFileInfo | null> {
    const path = this.#pathFor(key);
    const [info, contentType] = await Promise.allSettled([
      stat(path),
      readFile(`${path}.type`, 'utf8'),
    ]);

    const fault = [info, contentType].find(
      (result) => result.status === 'rejected' && !isMissing(result.reason),
    );
    if (fault?.status === 'rejected') {
      throw new StorageUnavailableError(`HEAD ${key} could not stat ${path}`, {
        cause: fault.reason,
      });
    }
    // A directory where the object should be is the fault `get` meets as
    // EISDIR — not an absence, whatever the sidecar says.
    if (info.status === 'fulfilled' && !info.value.isFile()) {
      throw new StorageUnavailableError(`HEAD ${key} found something other than a file at ${path}`);
    }
    if (info.status === 'rejected' || contentType.status === 'rejected') return null;

    return { contentType: contentType.value.trim(), sizeBytes: info.value.size };
  }

  /**
   * The file and its sidecar gone. Already absent is done, not a fault — the
   * retention sweep (tm 357) deletes before it marks, so a run cut short
   * deletes again next time. Anything else is the store failing.
   */
  async delete(key: string): Promise<void> {
    const path = this.#pathFor(key);
    try {
      await rm(path, { force: true });
      await rm(`${path}.type`, { force: true });
    } catch (error) {
      throw new StorageUnavailableError(`DELETE ${key} could not remove ${path}`, { cause: error });
    }
  }

  /**
   * The licence's knowledge documents: what is in its `knowledge/` directory
   * under a name of the knowledge-key shape (the `.type` sidecars and anything
   * a person left there are not objects). A licence that never stored one has
   * no directory — an empty list, not a fault.
   */
  async listKnowledge(licenseId: bigint): Promise<StoredKnowledgeObject[]> {
    const directory = resolve(join(this.#root, String(licenseId), 'knowledge'));
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw new StorageUnavailableError(`LIST ${licenseId}/knowledge could not read ${directory}`, {
        cause: error,
      });
    }
    const found: StoredKnowledgeObject[] = [];
    for (const name of names) {
      if (licenseOfKnowledgeKey(name) !== licenseId) continue;
      try {
        const info = await stat(join(directory, name));
        if (info.isFile()) found.push({ key: name, lastModified: info.mtime });
      } catch (error) {
        // Deleted between the listing and the stat: gone is not listed.
        if (isMissing(error)) continue;
        throw new StorageUnavailableError(`LIST ${licenseId}/knowledge could not stat ${name}`, {
          cause: error,
        });
      }
    }
    return found;
  }

  #pathFor(key: string): string {
    const relative = storedObjectPath(key);
    if (relative === null) {
      throw new Error('refusing to touch a key that is not in our own format');
    }
    // Keys are flat so they fit one path parameter; on disk they still fan out
    // per licence, so no directory ends up with every file in the system.
    const path = resolve(join(this.#root, ...relative.split('/')));
    if (path !== this.#root && !path.startsWith(this.#root + sep)) {
      throw new Error('refusing a path that escapes the storage root');
    }
    return path;
  }
}

/**
 * The errno values that mean "there is nothing at this path", as opposed to
 * "this path could not be read".
 *
 * ENOTDIR belongs with ENOENT: it is what a lookup returns when a *parent*
 * segment is not a directory, which for keys laid out `<licence>/<uuid>` is the
 * same statement — no licence has ever written here. EACCES, EPERM, EIO, EBUSY
 * and friends are deliberately not in the list.
 */
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
