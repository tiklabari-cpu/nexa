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

  it('sends the selected brand as X-SiyahTus-Brand (PRD §5.3-Marka)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({ fetchImpl, getBrandId: () => 'brand-b' });

    await client.get('/websites');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).get('X-SiyahTus-Brand')).toBe('brand-b');
  });

  it('omits X-SiyahTus-Brand entirely when no brand is selected', async () => {
    // License-wide NULL semantics (RLS `siyahtus_current_brand() IS NULL`) must
    // stay distinguishable from "the caller sent a brand" — an empty header
    // is not the same as no header.
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({ fetchImpl });

    await client.get('/websites');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).has('X-SiyahTus-Brand')).toBe(false);
  });

  it('carries the brand header on blob fetches too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(new Blob(['data']), { status: 200 }),
    );
    const client = new ApiClient({ fetchImpl, getBrandId: () => 'brand-b' });

    await client.getBlob('/uploads/key-1');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init!.headers).get('X-SiyahTus-Brand')).toBe('brand-b');
  });

  it('returns the blob plus the filename the server assigned via content-disposition', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(new Blob(['date,chats\r\n'], { type: 'text/csv' }), {
          status: 200,
          headers: {
            'content-disposition':
              'attachment; filename="siyahtus-overview-2026-01-01-2026-01-31.csv"',
          },
        }),
    );
    const client = new ApiClient({ fetchImpl });

    const { blob, filename } = await client.getFile('/reports/export?group=overview&format=csv');

    expect(filename).toBe('siyahtus-overview-2026-01-01-2026-01-31.csv');
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

    const error = (await client
      .getFile('/reports/export?group=overview')
      .catch((e: unknown) => e)) as ApiClientError;

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

/**
 * One renewal when the server refuses the credential itself (tm 259.1).
 *
 * The access token lives an hour at most. Before this, a panel left open past
 * that answered every request with a 401 and an "API unreachable" screen. The
 * client now renews once and repeats the request — but only for the 401 that
 * says the *bearer* was refused (`details.oauth_error: 'invalid_token'`, RFC
 * 6750 §3.1). The API also answers 401 for a wrong password or code inside an
 * authenticated request, and renewing there would spend a refresh token,
 * submit the wrong password twice, and end the session on the second refusal.
 */
describe('a refused credential is renewed once (tm 259.1 · NFR-S2)', () => {
  /** The auth plugin's answer to an expired, revoked or unknown bearer token. */
  const refusedCredential = () =>
    jsonResponse(
      {
        error: {
          type: 'authentication',
          message: 'Invalid or expired credentials.',
          request_id: 'rq-401',
          details: { oauth_error: 'invalid_token' },
        },
      },
      { status: 401 },
    );

  /** A 401 a handler raised about something inside the request, not about the token. */
  const wrongPassword = () =>
    jsonResponse(
      {
        error: {
          type: 'authentication',
          message: 'That password is not correct.',
          request_id: 'rq-pw',
        },
      },
      { status: 401 },
    );

  const bearerOf = (init: RequestInit | undefined) =>
    new Headers(init?.headers).get('Authorization');

  it('renews after a refused credential and repeats the request once, with the new token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      bearerOf(init) === 'Bearer stale' ? refusedCredential() : jsonResponse({ items: [] }),
    );
    const renewAccessToken = vi.fn(async () => 'fresh');
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken,
    });

    await expect(client.get('/chats')).resolves.toEqual({ items: [] });

    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(renewAccessToken).toHaveBeenCalledWith('stale');
    expect(fetchImpl.mock.calls.map(([, init]) => bearerOf(init))).toEqual([
      'Bearer stale',
      'Bearer fresh',
    ]);
  });

  it('repeats a write with the same body — a refused credential never reached the handler', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      bearerOf(init) === 'Bearer stale' ? refusedCredential() : jsonResponse({ id: 'e1' }),
    );
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken: async () => 'fresh',
    });

    await client.post('/chats/X/events', { text: 'hello' });

    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST']);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.body)).toEqual([
      '{"text":"hello"}',
      '{"text":"hello"}',
    ]);
  });

  it('lets the original 401 through when the session cannot be renewed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusedCredential());
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken: async () => null,
    });

    const error = (await client.get('/chats').catch((e: unknown) => e)) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(401);
    expect(error.details).toEqual({ oauth_error: 'invalid_token' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not renew a 401 about a wrong password inside the request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => wrongPassword());
    const renewAccessToken = vi.fn(async () => 'fresh');
    const onSessionRejected = vi.fn();
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'live',
      renewAccessToken,
      onSessionRejected,
    });

    const error = (await client
      .request('DELETE', '/auth/2fa', { password: 'wrong' })
      .catch((e: unknown) => e)) as ApiClientError;

    expect(error.message).toBe('That password is not correct.');
    expect(renewAccessToken).not.toHaveBeenCalled();
    expect(onSessionRejected).not.toHaveBeenCalled();
    // Submitted once: a second try would spend the attempt budget for nothing.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not renew for a request that carried no token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusedCredential());
    const renewAccessToken = vi.fn(async () => 'fresh');
    const client = new ApiClient({ fetchImpl, renewAccessToken });

    await client.get('/chats').catch(() => undefined);

    expect(renewAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a credential refused again right after renewal, once, without looping', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusedCredential());
    const renewAccessToken = vi.fn(async () => 'fresh');
    const onSessionRejected = vi.fn();
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken,
      onSessionRejected,
    });

    const error = (await client.get('/chats').catch((e: unknown) => e)) as ApiClientError;

    expect(error.status).toBe(401);
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // A token minted a moment ago and refused anyway is not stale: the
    // membership or the workspace is gone, and the session cannot continue.
    expect(onSessionRejected).toHaveBeenCalledTimes(1);
    expect(onSessionRejected).toHaveBeenCalledWith('fresh');
  });

  it('does not end the session when the repeat fails for a reason inside the request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      bearerOf(init) === 'Bearer stale' ? refusedCredential() : wrongPassword(),
    );
    const onSessionRejected = vi.fn();
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken: async () => 'fresh',
      onSessionRejected,
    });

    const error = (await client
      .request('POST', '/auth/2fa/recovery-codes', { password: 'wrong' })
      .catch((e: unknown) => e)) as ApiClientError;

    expect(error.message).toBe('That password is not correct.');
    expect(onSessionRejected).not.toHaveBeenCalled();
  });

  it('renews for an attachment download too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      bearerOf(init) === 'Bearer stale'
        ? refusedCredential()
        : new Response(new Blob(['png']), { status: 200 }),
    );
    const renewAccessToken = vi.fn(async () => 'fresh');
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken,
    });

    const blob = await client.getBlob('/uploads/key-1');

    expect(blob.size).toBeGreaterThan(0);
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
  });

  it('renews for a report export too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      bearerOf(init) === 'Bearer stale'
        ? refusedCredential()
        : new Response(new Blob(['date,chats\r\n']), { status: 200 }),
    );
    const client = new ApiClient({
      fetchImpl,
      getAccessToken: () => 'stale',
      renewAccessToken: async () => 'fresh',
    });

    const { blob } = await client.getFile('/reports/export?group=overview&format=csv');

    expect(blob.size).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
