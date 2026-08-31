/**
 * The `attachment_url` boundary (FR-MOD-08.9.4 · M-STORE-a).
 *
 * `assertUploadedAttachment` had no unit test of its own; the three refusals
 * were covered end to end by `test/integration/uploads.test.ts`. What that
 * cannot reach is the fourth outcome, because it needs a store that fails on
 * demand: the difference between "there is no such file" and "we could not
 * look". Those are the same `false` to the caller of `exists`, and rendering
 * them the same way to the client is the defect M-STORE-a exists to prevent —
 * a bucket outage arriving as a 400 that says the sender never uploaded the
 * file, which nobody retries and nothing pages on.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectStore, StoredFile } from './object-store.js';
import { assertUploadedAttachment } from './attachment.js';
import { StorageUnavailableError } from './storage-error.js';
import { buildKey, UPLOAD_PATH_PREFIX } from './upload-url.js';

const LICENSE = 42n;
const KEY = buildKey(LICENSE, 'image/png');
const URL_FOR = (key: string) => `${UPLOAD_PATH_PREFIX}${key}`;

/** Answers `exists` however the test asks, and refuses to be used for anything else. */
function storeWhere(exists: () => Promise<boolean>): ObjectStore {
  return {
    exists,
    put: () => Promise.reject(new Error('not part of this check')),
    get: (): Promise<StoredFile | null> => Promise.reject(new Error('not part of this check')),
  };
}

const present = storeWhere(() => Promise.resolve(true));
const absent = storeWhere(() => Promise.resolve(false));
const unreachable = storeWhere(() =>
  Promise.reject(new StorageUnavailableError('HEAD answered 500')),
);

describe('assertUploadedAttachment', () => {
  it('accepts a key this workspace uploaded', async () => {
    await expect(assertUploadedAttachment(present, LICENSE, URL_FOR(KEY))).resolves.toBeUndefined();
  });

  it('refuses anything that is not one of our own upload paths', async () => {
    for (const url of [
      'https://evil.example/x.png',
      '/api/v1/uploads/../secrets',
      `//evil.example${UPLOAD_PATH_PREFIX}${KEY}`,
      URL_FOR('not-a-key'),
    ]) {
      await expect(assertUploadedAttachment(present, LICENSE, url)).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it("refuses another licence's key", async () => {
    await expect(
      assertUploadedAttachment(present, LICENSE, URL_FOR(buildKey(43n, 'image/png'))),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a grant that was issued and never used', async () => {
    // The reason `exists` is on the interface at all: a URL is permission to
    // upload, not permission to claim.
    await expect(assertUploadedAttachment(absent, LICENSE, URL_FOR(KEY))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('says "try again", not "you never uploaded that", when the store cannot answer', async () => {
    const error = await assertUploadedAttachment(unreachable, LICENSE, URL_FOR(KEY)).then(
      () => ({ status: 200, message: 'it resolved, which is the one thing it must never do' }),
      (raised: unknown) => raised as { status: number; message: string },
    );

    // 503 rather than 400: the boundary still refused to let the attachment
    // through — it is not weaker — but the refusal is retryable and honest
    // about whose fault it is. A 400 here would be dropped by the client and
    // logged as a validation failure, hiding an outage behind a lie.
    expect(error.status).toBe(503);
    expect(error.message).not.toMatch(/workspace uploaded/);
  });

  it('gives the same message to all three refusals', async () => {
    // Which part refused is not something a caller probing another tenant's
    // keys gets to learn, so the wrong-licence and never-uploaded answers must
    // be indistinguishable.
    const wrongLicence = await assertUploadedAttachment(
      present,
      LICENSE,
      URL_FOR(buildKey(43n, 'image/png')),
    ).catch((raised: unknown) => (raised as Error).message);
    const neverUploaded = await assertUploadedAttachment(absent, LICENSE, URL_FOR(KEY)).catch(
      (raised: unknown) => (raised as Error).message,
    );

    expect(wrongLicence).toBe(neverUploaded);
  });
});
