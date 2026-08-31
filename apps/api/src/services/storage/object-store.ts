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
 * runtime edges in the module graph all run this way and there is no cycle.
 * `StorageUnavailableError` is the exception that proves it: both providers
 * throw it, so it lives in its own module rather than here, and is re-exported
 * from here because this is where the contract that requires it is written.
 */
import { createHash } from 'node:crypto';
import { LocalStore } from './local-store.js';
import { S3Store, type S3StoreOptions } from './s3-store.js';
import { StorageUnavailableError } from './storage-error.js';

export { StorageUnavailableError };
export type { S3StoreOptions };

/** Bytes plus the content type they were stored with. */
export interface StoredFile {
  bytes: Buffer;
  contentType: string;
}

/**
 * The three operations, and the one rule they share.
 *
 * **A `null` or a `false` from here is a statement, not a shrug.** It means the
 * store looked and the object is not there — ENOENT on disk, `404` from a
 * bucket. An implementation that cannot reach its storage, or is refused by it,
 * throws `StorageUnavailableError` instead; it never answers "no" on behalf of
 * a system it could not ask. The reason is `exists` below, and the argument in
 * full is in `storage-error.ts`.
 */
export interface ObjectStore {
  /**
   * Store `bytes` under `key`, remembering `contentType` for the way back out.
   *
   * Resolves only once the bytes are durably stored — the caller writes an
   * `attachment_url` referring to them the moment it returns.
   */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The stored file, or null when the key demonstrably holds nothing. */
  get(key: string): Promise<StoredFile | null>;
  /**
   * Whether the bytes are actually there.
   *
   * Security-relevant, not a convenience: `attachment.ts` uses it to refuse an
   * `attachment_url` pointing at a key that was granted and never used. Which
   * is also why `false` may only ever mean a definite absence — it is rendered
   * to the caller as "that is not a file this workspace uploaded", and a store
   * that says it while merely unreachable turns an outage into an accusation.
   */
  exists(key: string): Promise<boolean>;
}

/** The object stores this deployment can select between (`STORAGE_PROVIDER`). */
export const STORAGE_PROVIDERS = ['local', 's3'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/**
 * Every setting any provider needs, assembled once by `parseEnv` (`env.storage`).
 *
 * One object rather than a per-provider argument, because `STORAGE_PROVIDER` is
 * chosen at runtime: a call site holding a `StorageProvider` variable cannot
 * know which half of a union to supply, so it has to supply both. `s3` is
 * therefore `null`-able rather than optional — a deployment with no S3
 * configuration says so, and cannot express it by forgetting.
 */
export interface ObjectStoreOptions {
  /** Root the `local` provider writes under (`env.STORAGE_LOCAL_DIR`). */
  localDir: string;
  /** `STORAGE_S3_*`, or null when this deployment has none configured. */
  s3: S3StoreOptions | null;
}

/**
 * The store `STORAGE_PROVIDER` names.
 *
 * An exhaustive `switch`, for the reason `siem-sink.ts` gives for its own — and
 * it worked: adding `s3` to the vocabulary was a compile error here rather than
 * a silent fall-through to local disk.
 *
 * The `s3` branch throws rather than falling back, because a fallback is the
 * failure this whole item is about. A deployment that asked for the shared
 * bucket and quietly got pod-local disk would keep serving, keep accepting
 * uploads, and lose one in four downloads. `parseEnv` already refuses to boot
 * without the configuration, so the only way to reach this line is to build the
 * options by hand and leave it out.
 */
export function createObjectStore(
  provider: StorageProvider,
  options: ObjectStoreOptions,
): ObjectStore {
  switch (provider) {
    case 'local':
      return new LocalStore(options.localDir);
    case 's3':
      if (!options.s3) {
        throw new Error('STORAGE_PROVIDER=s3 but no STORAGE_S3_* configuration was supplied');
      }
      return new S3Store(options.s3);
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
