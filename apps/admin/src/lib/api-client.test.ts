/**
 * The platform API client (tm 389.6): base path, bearer, no brand header, no cookie, the error
 * envelope, and which 401s end the session.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError, errorMessageKey, isForbidden } from './api-client.js';

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' },
  });
}

function client(response: Response, token: string | null = 'tok-1') {
  const fetchImpl = vi.fn(async () => response);
  const onSessionEnded = vi.fn();
  const api = new ApiClient({ getAccessToken: () => token, onSessionEnded, fetchImpl });
  return { api, fetchImpl, onSessionEnded };
}

describe('the request', () => {
  it('goes to /platform/v1 with the bearer token and no cookie', async () => {
    const { api, fetchImpl } = client(respond(200, { ok: true }));

    await api.get('/auth/me');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/platform/v1/auth/me');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1');
    expect(init.credentials).toBe('omit');
  });

  it('sends no Authorization header without a token, and never a brand header', async () => {
    const { api, fetchImpl } = client(respond(200, {}), null);

    await api.get('/meta');

    const headers = new Headers(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers,
    );
    expect(headers.has('Authorization')).toBe(false);
    expect([...headers.keys()].some((name) => /brand/i.test(name))).toBe(false);
    expect(headers.get('X-SiyahTus-Locale')).toMatch(/^(en|tr)$/);
  });

  it('serialises a JSON body and reads a 204 as undefined', async () => {
    const { api, fetchImpl } = client(respond(204));

    await expect(api.post('/auth/logout', { a: 1 })).resolves.toBeUndefined();

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('honours a base URL override and strips a trailing slash', async () => {
    const fetchImpl = vi.fn(async () => respond(200, {}));
    await new ApiClient({ baseUrl: '/x/', fetchImpl }).get('/y');

    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/x/y');
  });
});

describe('a failure', () => {
  it('becomes an ApiClientError carrying the ADR-06 type, status and request id', async () => {
    const { api } = client(
      respond(403, {
        error: {
          type: 'platform_totp_required',
          message: 'Finish signing in.',
          request_id: 'req-9',
          details: { next: 'totp_verify' },
        },
      }),
    );

    const error = await api.get('/auth/me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      type: 'platform_totp_required',
      status: 403,
      requestId: 'req-9',
      details: { next: 'totp_verify' },
    });
  });

  it('is `network` when nothing answered', async () => {
    const api = new ApiClient({
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });

    const error = (await api.get('/meta').catch((e: unknown) => e)) as ApiClientError;

    expect(error.type).toBe('network');
    expect(error.isRetryable).toBe(true);
  });

  it('reads Retry-After off a 429', async () => {
    const response = new Response(
      JSON.stringify({ error: { type: 'too_many_requests', message: 'x', request_id: 'r' } }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '42' },
      },
    );
    const { api } = client(response);

    const error = (await api.post('/auth/login', {}).catch((e: unknown) => e)) as ApiClientError;

    expect(error.retryAfterSeconds).toBe(42);
  });

  it('maps to a catalogue key by type, never to the server prose', () => {
    const known = new ApiClientError({
      type: 'platform_reason_required',
      status: 400,
      message: 'English',
      requestId: 'r',
    });
    // A type this build has never heard of (a server ahead of the SPA) must not surface as a raw key.
    const unknown = new ApiClientError({
      type: 'from_the_future' as never,
      status: 400,
      message: 'x',
      requestId: 'r',
    });

    expect(errorMessageKey(known)).toBe('common.errors.platform_reason_required');
    expect(errorMessageKey(unknown)).toBe('common.errors.unknown');
    expect(errorMessageKey(new Error('boom'))).toBe('common.errors.unknown');
  });

  it('tells a role refusal from every other 403', () => {
    const refusal = new ApiClientError({
      type: 'authorization',
      status: 403,
      message: 'x',
      requestId: 'r',
    });
    const stage = new ApiClientError({
      type: 'platform_totp_required',
      status: 403,
      message: 'x',
      requestId: 'r',
    });

    expect(isForbidden(refusal)).toBe(true);
    expect(isForbidden(stage)).toBe(false);
    expect(isForbidden(new Error('x'))).toBe(false);
  });
});

describe('which 401 ends the session', () => {
  const body = { error: { type: 'authentication', message: 'x', request_id: 'r' } };

  it('is any 401 on a route that is not a credential check, with a token in hand', async () => {
    const { api, onSessionEnded } = client(respond(401, body));

    await api.get('/auth/me').catch(() => undefined);

    expect(onSessionEnded).toHaveBeenCalledWith('tok-1');
  });

  it.each([
    '/auth/login',
    '/auth/invite/accept',
    '/auth/totp/activate',
    '/auth/totp/verify',
    '/auth/totp/reverify',
  ])('is not a 401 on %s — that is a handler saying the credential was wrong', async (path) => {
    const { api, onSessionEnded } = client(respond(401, body));

    await api.post(path, {}).catch(() => undefined);

    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it('is not a 401 when there was no token to refuse', async () => {
    const { api, onSessionEnded } = client(respond(401, body), null);

    await api.get('/auth/me').catch(() => undefined);

    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it('is not a 403 or a 5xx', async () => {
    for (const status of [403, 500]) {
      const { api, onSessionEnded } = client(respond(status, body));
      await api.get('/auth/me').catch(() => undefined);
      expect(onSessionEnded).not.toHaveBeenCalled();
    }
  });
});
