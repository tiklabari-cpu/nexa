/**
 * Where uploaded bytes live — the interface, and the factory `STORAGE_PROVIDER`
 * actually selects through (M-PROV-a · §D113/K3).
 *
 * The key was already validated and documented; what it was not, until now, was
 * *read*. Three routes each said `new LocalStore(env.STORAGE_LOCAL_DIR)`, so a
 * deployment could set `STORAGE_PROVIDER` to anything the enum allowed and the
 * process would keep writing to the same directory — the setting looked like a
 * choice and was not one. Same shape as `createVirusScanner`: an interface, the
 * mock implementation behind it, and one function that maps the env value to an
 * instance so an unknown value fails at boot rather than silently.
 *
 * **The interface is the call surface, not a wish list.** Deliberately no
 * `signedUrl` and no `delete`: signing lives in `upload-url.ts` because what is
 * signed is the *HTTP grant*, not the bytes — a real S3 provider would still
 * mint our own signature and then stream through us, since the grant carries a
 * licence and a scan verdict S3 knows nothing about — and nothing in this
 * codebase deletes an object (retention prunes rows and the mail spool, never
 * uploads). Methods with no caller are a contract a second implementation would
 * have to satisfy blind; the honest seam is the three operations that exist.
 *
 * `local-store.ts` imports the two types back out of here, type-only, so the
 * one runtime edge in the module graph runs this way and there is no cycle.
 */
import { createHash } from 'node:crypto';
import { LocalStore } from './local-store.js';

/** Bytes plus the content type they were stored with. */
export interface StoredFile {
  bytes: Buffer;
  contentType: string;
}

export interface ObjectStore {
  /** Store `bytes` under `key`, remembering `contentType` for the way back out. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The stored file, or null when the key holds nothing. */
  get(key: string): Promise<StoredFile | null>;
  /**
   * Whether the bytes are actually there.
   *
   * Security-relevant, not a convenience: `attachment.ts` uses it to refuse an
   * `attachment_url` pointing at a key that was granted and never used.
   */
  exists(key: string): Promise<boolean>;
}

/** The object stores this deployment can select between (`STORAGE_PROVIDER`). */
export const STORAGE_PROVIDERS = ['local'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export interface ObjectStoreOptions {
  /** Root the `local` provider writes under (`env.STORAGE_LOCAL_DIR`). */
  localDir: string;
}

/**
 * The store `STORAGE_PROVIDER` names.
 *
 * A `switch` over a one-value vocabulary, for the reason `siem-sink.ts` gives
 * for its own: the exhaustive form is what makes adding `s3` to the enum later
 * a compile error here rather than a silent fall-through to local disk.
 */
export function createObjectStore(
  provider: StorageProvider,
  options: ObjectStoreOptions,
): ObjectStore {
  switch (provider) {
    case 'local':
      return new LocalStore(options.localDir);
  }
}

/**
 * Content addressing for the caller's benefit — lets a client dedupe.
 *
 * A free function rather than a method: the digest of some bytes is the same
 * number wherever they are stored, so making it part of the interface would
 * oblige every future provider to reimplement one line of sha256, and making it
 * a static on `LocalStore` obliged the upload route to import the concrete
 * store it no longer chooses.
 */
export function digestBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
