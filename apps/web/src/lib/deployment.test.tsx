/**
 * `useDeployment` (tm 257.13): the anonymous read of `GET /deployment`, its one
 * shared cache entry, and the ordinary-deployment answer it gives while that
 * read is loading or has failed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEPLOYMENT_FALLBACK, DEPLOYMENT_QUERY_KEY, useDeployment } from './deployment.js';

const PILOT = {
  pilot_mode: true,
  contact_email: 'pilot-desk@siyahtus.test',
  signup_enabled: true,
  email_verification_required: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDeployment(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useDeployment(), { wrapper }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDeployment', () => {
  it('answers as an ordinary deployment while the read is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { result } = renderDeployment();
    expect(result.current).toStrictEqual({
      pilot_mode: false,
      contact_email: null,
      signup_enabled: true,
      email_verification_required: false,
      // No documents named, so no terms box and no links (tm 257.9).
      privacy_policy_url: null,
      terms_url: null,
      terms_version: null,
    });
    expect(DEPLOYMENT_FALLBACK).toStrictEqual(result.current);
  });

  it('reads GET /deployment without a credential and returns what it says', async () => {
    const fetch = vi.fn(async () => json(PILOT));
    vi.stubGlobal('fetch', fetch);

    const { result } = renderDeployment();
    await waitFor(() => expect(result.current.pilot_mode).toBe(true));
    expect(result.current).toStrictEqual(PILOT);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/deployment');
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it.each([
    ['a server error', async () => json({ error: { type: 'internal', message: 'x' } }, 500)],
    ['a rate limit', async () => json({ error: { type: 'too_many_requests', message: 'x' } }, 429)],
    [
      'a network failure',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('falls back to pilot mode off on %s', async (_label, respond) => {
    const fetch = vi.fn(respond);
    vi.stubGlobal('fetch', fetch);

    const { result, queryClient } = renderDeployment();
    await waitFor(() =>
      expect(queryClient.getQueryState(DEPLOYMENT_QUERY_KEY)?.status).toBe('error'),
    );
    expect(result.current).toStrictEqual(DEPLOYMENT_FALLBACK);
  });

  it('shares one cache entry, so every screen reading it costs one request', async () => {
    const fetch = vi.fn(async () => json(PILOT));
    vi.stubGlobal('fetch', fetch);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const first = renderDeployment(queryClient);
    await waitFor(() => expect(first.result.current.pilot_mode).toBe(true));
    const second = renderDeployment(queryClient);

    expect(second.result.current).toStrictEqual(PILOT);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['deployment'])).toStrictEqual(PILOT);
  });
});
