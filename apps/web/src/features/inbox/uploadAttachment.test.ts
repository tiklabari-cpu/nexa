/**
 * A single-use upload URL (tm 446) seen from the composer: a 409 from the
 * signed PUT means the key already holds a file — ours from a lost answer,
 * or someone else's — so the composer asks for a fresh grant once instead of
 * pointing a message at bytes this attempt cannot vouch for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api-client.js';
import { UploadHttpError, uploadAttachment } from './uploadAttachment.js';

const FILE = new File(['png'], 'photo.png', { type: 'image/png' });

/** `POST /uploads` hands out grant 1, 2, 3…; the PUTs answer from `statuses`, in order. */
function stage(statuses: number[], body: unknown = {}) {
  let granted = 0;
  const post = vi.fn(async () => {
    granted += 1;
    return {
      upload_url: `/api/v1/uploads/k${granted}?sig=${granted}`,
      file_url: `/api/v1/uploads/k${granted}`,
    };
  });
  const put = vi.fn(async (_url: string, _init?: RequestInit) => {
    const status = statuses.shift() ?? 201;
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', put);
  return { api: { post } as unknown as ApiClient, post, put };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadAttachment', () => {
  it('sends the bytes under the type it was granted for', async () => {
    const { api, post, put } = stage([201]);

    await expect(uploadAttachment(api, FILE)).resolves.toEqual({
      fileUrl: '/api/v1/uploads/k1',
      contentType: 'image/png',
      name: 'photo.png',
    });
    expect(post).toHaveBeenCalledWith('/uploads', {
      filename: 'photo.png',
      content_type: 'image/png',
      size_bytes: FILE.size,
    });
    expect(put.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('answers a 409 with one fresh grant and hangs the message on the file that one stored', async () => {
    const { api, post, put } = stage([409, 201]);

    const uploaded = await uploadAttachment(api, FILE);

    expect(post).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/uploads/k1?sig=1',
      '/api/v1/uploads/k2?sig=2',
    ]);
    expect(uploaded.fileUrl).toBe('/api/v1/uploads/k2');
  });

  it('gives up after the second 409 rather than asking forever', async () => {
    const { api, post } = stage([409, 409, 201]);

    await expect(uploadAttachment(api, FILE)).rejects.toMatchObject({ status: 409 });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other refusal, and carries its reason', async () => {
    const { api, post } = stage([400], {
      error: { type: 'validation', details: { reason: 'content_type_mismatch' } },
    });

    const failure = await uploadAttachment(api, FILE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UploadHttpError);
    expect(failure).toMatchObject({ status: 400, reason: 'content_type_mismatch' });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
