import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from './api-client.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

describe('ApiClient', () => {
  it('sends the bearer token when one is available', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({ fetchImpl, getAccessToken: () => 'tok_123' });

    await client.get('/chats');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok_123');
  });

  it('omits Authorization when there is no token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({ fetchImpl });

    await client.get('/health');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).has('Authorization')).toBe(false);
  });

  it('sends the selected brand as X-Nexa-Brand (PRD §5.3-Marka)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({ fetchImpl, getBrandId: () => 'brand-b' });

    await client.get('/websites');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).get('X-Nexa-Brand')).toBe('brand-b');
  });

  it('omits X-Nexa-Brand entirely when no brand is selected', async () => {
    // License-wide NULL semantics (RLS `nexa_current_brand() IS NULL`) must
    // stay distinguishable from "the caller sent a brand" — an empty header
    // is not the same as no header.
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({ fetchImpl });

    await client.get('/websites');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).has('X-Nexa-Brand')).toBe(false);
  });

  it('carries the brand header on blob fetches too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(new Blob(['data']), { status: 200 }),
    );
    const client = new ApiClient({ fetchImpl, getBrandId: () => 'brand-b' });

    await client.getBlob('/uploads/key-1');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).get('X-Nexa-Brand')).toBe('brand-b');
  });

  it('returns the blob plus the filename the server assigned via content-disposition', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(new Blob(['date,chats\r\n'], { type: 'text/csv' }), {
          status: 200,
          headers: {
            'content-disposition': 'attachment; filename="nexa-overview-2026-01-01-2026-01-31.csv"',
          },
        }),
    );
    const client = new ApiClient({ fetchImpl });

    const { blob, filename } = await client.getFile('/reports/export?group=overview&format=csv');

    expect(filename).toBe('nexa-overview-2026-01-01-2026-01-31.csv');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('returns a null filename when content-disposition is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Blob(['x'])));
    const client = new ApiClient({ fetchImpl });

    const { filename } = await client.getFile('/reports/export?group=overview&format=csv');

    expect(filename).toBeNull();
  });

  it('surfaces the server error type and message when a file request fails, unlike getBlob', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            type: 'authorization',
            message: 'This token cannot export the overview report.',
            request_id: 'rq-9',
          },
        },
        { status: 403 },
      ),
    );
    const client = new ApiClient({ fetchImpl });

    const error = (await client.getFile('/reports/export?group=overview').catch((e: unknown) => e)) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(403);
    expect(error.type).toBe('authorization');
    expect(error.message).toBe('This token cannot export the overview report.');
    expect(error.requestId).toBe('rq-9');
  });

  it('normalises the base url so paths never double up slashes', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const client = new ApiClient({ baseUrl: 'http://localhost:4000/api/v1/', fetchImpl });

    await client.get('/health');

    expect(fetchImpl.mock.calls[0]![0]).toBe('http://localhost:4000/api/v1/health');
  });

  it('surfaces the server error type and request id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: { type: 'chat_inactive', message: 'Chat is not active.', request_id: 'rq-7' },
        },
        { status: 409 },
      ),
    );
    const client = new ApiClient({ fetchImpl });

    const error = await client.post('/chats/X/events', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    const apiError = error as ApiClientError;
    expect(apiError.type).toBe('chat_inactive');
    expect(apiError.status).toBe(409);
    expect(apiError.requestId).toBe('rq-7');
    expect(apiError.isRetryable).toBe(false);
  });

  it('reads Retry-After off a 429', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        { error: { type: 'too_many_requests', message: 'slow down', request_id: 'rq-8' } },
        { status: 429, headers: { 'Retry-After': '12' } },
      ),
    );
    const client = new ApiClient({ fetchImpl });

    const error = (await client.get('/chats').catch((e: unknown) => e)) as ApiClientError;

    expect(error.retryAfterSeconds).toBe(12);
    expect(error.isRetryable).toBe(true);
  });

  it('does not choke on an error response with an unparseable body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    );
    const client = new ApiClient({ fetchImpl });

    const error = (await client.get('/chats').catch((e: unknown) => e)) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.type).toBe('internal');
    expect(error.message).toContain('502');
  });

  it('reports transport failures as a network error rather than leaking the cause', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = new ApiClient({ fetchImpl });

    const error = (await client.get('/health').catch((e: unknown) => e)) as ApiClientError;

    expect(error.type).toBe('network');
    expect(error.status).toBe(0);
    expect(error.isRetryable).toBe(true);
  });

  it('returns undefined for 204 instead of trying to parse an empty body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = new ApiClient({ fetchImpl });

    await expect(client.delete('/tags/1')).resolves.toBeUndefined();
  });

  it('serialises the body only when one is provided', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const client = new ApiClient({ fetchImpl });

    await client.post('/chats', { text: 'hi' });
    const [, withBody] = fetchImpl.mock.calls[0]!;
    expect(withBody!.body).toBe('{"text":"hi"}');
    expect(new Headers(withBody!.headers).get('Content-Type')).toBe('application/json');

    await client.get('/chats');
    const [, withoutBody] = fetchImpl.mock.calls[1]!;
    expect(withoutBody!.body).toBeUndefined();
    expect(new Headers(withoutBody!.headers).has('Content-Type')).toBe(false);
  });
});
