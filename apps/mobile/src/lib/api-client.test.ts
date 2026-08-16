import { ApiClient, ApiClientError } from './api-client';
import { MOBILE_ENDPOINTS } from './contract';

const BASE = 'https://api.example.com/api/v1';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function clientWith(fetchImpl: jest.Mock, options: { getAccessToken?: () => string | null } = {}) {
  return new ApiClient({
    baseUrl: BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...options,
  });
}

/**
 * Assert the rejection *and* narrow it in one step. `.catch(e => e)` widens the
 * result to a union with the success body, which then needs a cast on every
 * property read — and a cast would also hide a request that wrongly resolved.
 */
async function rejection(promise: Promise<unknown>): Promise<ApiClientError> {
  try {
    await promise;
  } catch (caught) {
    return caught as ApiClientError;
  }
  throw new Error('Expected the request to reject, but it resolved.');
}

describe('ApiClient', () => {
  it('calls the absolute URL a phone needs, since there is no origin to resolve against', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));

    await clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.health);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('drops a trailing slash on the base so the path never doubles up', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const client = new ApiClient({
      baseUrl: `${BASE}/`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.request('get', MOBILE_ENDPOINTS.health);

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/api/v1/health');
  });

  it('substitutes path parameters and percent-encodes them', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ summary: 'x' }));

    await clientWith(fetchImpl).request('post', MOBILE_ENDPOINTS.copilotChatSummary, {
      params: { chatId: 'a/b c' },
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.example.com/api/v1/copilot/chats/a%2Fb%20c/summary',
    );
  });

  it('refuses to send a URL with an unfilled placeholder', async () => {
    const fetchImpl = jest.fn();

    await expect(
      clientWith(fetchImpl).request('post', MOBILE_ENDPOINTS.copilotChatSummary),
    ).rejects.toThrow('Missing path parameter "chatId"');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serialises a query and omits the keys left undefined', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ items: [] }));

    await clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.chats, {
      query: { view: 'my', limit: 25, page_id: undefined },
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.example.com/api/v1/chats?view=my&limit=25',
    );
  });

  it('attaches the bearer token and the brand header when both are available', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const client = new ApiClient({
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: () => 'tok-1',
      getBrandId: () => 'brand-9',
    });

    await client.request('get', MOBILE_ENDPOINTS.chats);

    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer tok-1',
      'X-Nexa-Brand': 'brand-9',
    });
  });

  it('sends no Authorization header when there is no session yet', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));

    await clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.health);

    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('turns an ADR-06 error envelope into a typed error carrying the request id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            type: 'authorization',
            message: 'Missing scope chats--all:ro.',
            request_id: 'req-42',
            details: { scope: 'chats--all:ro' },
          },
        },
        { status: 403 },
      ),
    );

    const error = await rejection(clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.chats));

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.type).toBe('authorization');
    expect(error.status).toBe(403);
    expect(error.requestId).toBe('req-42');
    expect(error.details).toEqual({ scope: 'chats--all:ro' });
    expect(error.isRetryable).toBe(false);
  });

  it('falls back to the X-Request-Id header when the body is not an envelope', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('<html>502</html>', {
        status: 502,
        headers: { 'X-Request-Id': 'req-edge' },
      }),
    );

    const error = await rejection(clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.chats));

    expect(error.type).toBe('internal');
    expect(error.requestId).toBe('req-edge');
    expect(error.message).toBe('Request failed with status 502.');
  });

  it('surfaces Retry-After so a rate-limited screen can back off', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { type: 'too_many_requests', message: 'Slow down.', request_id: 'req-7' } },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      );

    const error = await rejection(clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.chats));

    expect(error.retryAfterSeconds).toBe(30);
    expect(error.isRetryable).toBe(true);
  });

  it('reports a transport failure as one honest network category', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const error = await rejection(clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.health));

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.type).toBe('network');
    expect(error.status).toBe(0);
    expect(error.isRetryable).toBe(true);
  });

  it('aborts a request that outlives its timeout and calls it a timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      const client = new ApiClient({
        baseUrl: BASE,
        timeoutMs: 100,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const pending = rejection(client.request('get', MOBILE_ENDPOINTS.health));
      jest.advanceTimersByTime(100);
      const error = await pending;

      expect(error.type).toBe('timeout');
      expect(error.message).toBe('The server did not answer within 100ms.');
      expect(error.isRetryable).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rethrows the caller's own abort rather than dressing it up as a timeout", async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const pending = clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.health, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow('Aborted');
    await expect(pending).rejects.not.toBeInstanceOf(ApiClientError);
  });

  it('returns undefined for 204 instead of choking on an empty body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      clientWith(fetchImpl).request('get', MOBILE_ENDPOINTS.health),
    ).resolves.toBeUndefined();
  });
});
