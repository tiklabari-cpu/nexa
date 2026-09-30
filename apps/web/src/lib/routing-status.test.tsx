/**
 * Changing routing status refreshes the Team roster (FR-MOD-04.3.3, FR-MOD-01.1.3).
 *
 * `auth-store.setRoutingStatus` only moves the auth store, so the roster query
 * `['team', 'agents']` — which the palette's toggle and the inbox rail's select
 * both leave behind — kept its stale "Accepting chats" until the next push or
 * the 30 s stale time. The hook under test is the one place both callers go
 * through. The real store answers a stubbed `fetch`, so the assertions cover the
 * write and the invalidation as one behaviour.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './auth-store.js';
import { useSetRoutingStatus } from './routing-status.js';

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSetRoutingStatus(), { wrapper });
  return { result, invalidate };
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'owner@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['agents--my:rw'],
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSetRoutingStatus', () => {
  it('invalidates the Team roster once the write has succeeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { routing_status: 'not_accepting_chats' })),
    );
    const { result, invalidate } = setup();

    await act(async () => {
      await result.current('not_accepting_chats');
    });

    expect(useAuth.getState().agent?.routing_status).toBe('not_accepting_chats');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['team', 'agents'] });
  });

  it('leaves the roster alone when the write is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(403, { error: { type: 'authorization', message: 'Your token cannot.' } }),
      ),
    );
    const { result, invalidate } = setup();

    await act(async () => {
      await expect(result.current('not_accepting_chats')).rejects.toBeDefined();
    });

    expect(useAuth.getState().agent?.routing_status).toBe('accepting_chats');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
