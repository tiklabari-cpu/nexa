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
