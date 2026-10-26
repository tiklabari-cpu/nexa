/**
 * An impersonation tab's session (tm 389.15 · FR-ADMIN-21 · design.md §G).
 *
 * The operator's browser may also hold a session of its own — a refresh
 * token in `localStorage`, shared by every tab, and access tokens passed
 * between them on a BroadcastChannel. An impersonation tab must stay out of
 * all of it: its token lives in its own `sessionStorage`, is never renewed,
 * never broadcast, and ending it neither revokes nor forgets the browser's own
 * stored session. These tests pin each of those, against a stub server that
 * records every request.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStoreModule from './auth-store.js';

vi.setConfig({ testTimeout: 30_000 });

const REFRESH_KEY = 'siyahtus.refresh_token';
const IMPERSONATION_KEY = 'siyahtus.impersonation';

type Tab = typeof AuthStoreModule;

interface Seen {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ENDS_AT = () => new Date(Date.now() + 30 * 60_000).toISOString();

/** A server that knows one impersonation token and records everything asked of it. */
function stubServer(options: { refuseBearer?: boolean } = {}) {
  const seen: Seen[] = [];
  let live = true;
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const path = url.pathname.replace(/^\/api\/v1/, '');
    seen.push({
      method: init?.method ?? 'GET',
      path,
      authorization: headers.get('authorization'),
      body,
    });
    if (path === '/auth/impersonation/exchange') {
      return json({
        access_token: 'imp-token',
        token_type: 'Bearer',
        expires_in: 1800,
        account_id: 'acct-member',
        license_id: '7',
        organization_id: 'org-7',
        impersonation: { session_id: 'sess-1', mode: 'read_only', ends_at: ENDS_AT() },
      });
    }
    if (path === '/auth/impersonation/end') {
      live = false;
      return json({ ended: true });
    }
    const authorized = headers.get('authorization') === 'Bearer imp-token';
    if (!authorized || !live || options.refuseBearer) {
      return json(
        {
          error: {
            type: 'authentication',
            message: 'Invalid or expired credentials.',
            request_id: 'rq-1',
            details: { oauth_error: 'invalid_token' },
          },
        },
        401,
      );
    }
    if (path === '/auth/me') {
      return json({
        kind: 'agent',
        account_id: 'acct-member',
        email: 'member@example.test',
        name: 'Member',
        role: 'agent',
        organization_id: 'org-7',
        license_id: '7',
        scopes: [],
        routing_status: 'offline',
        impersonation: { session_id: 'sess-1', mode: 'read_only', ends_at: ENDS_AT() },
      });
    }
    return json({ items: [] });
  }) as typeof fetch;
  vi.stubGlobal('fetch', fetchStub);
  return {
    seen,
    calls: (path: string) => seen.filter((request) => request.path === path),
    endSession: () => {
      live = false;
    },
  };
}

class RecordingChannel {
  static posted: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {}
  postMessage(message: unknown): void {
    RecordingChannel.posted.push(message);
  }
  close(): void {}
}

const tabs: Tab[] = [];

async function openTab(): Promise<Tab> {
  vi.resetModules();
  const tab = await import('./auth-store.js');
  tabs.push(tab);
  return tab;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // The browser's own session, belonging to its other tabs.
  localStorage.setItem(REFRESH_KEY, 'browser-refresh-0');
  localStorage.setItem('siyahtus.client_id', 'siyahtus-agent-app-acme');
  RecordingChannel.posted = [];
  vi.stubGlobal('BroadcastChannel', RecordingChannel);
});

afterEach(() => {
  tabs.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('an impersonation tab (tm 389.15)', () => {
  it('signs in with the traded code, in this tab only, touching nothing of the browser’s session', async () => {
    const server = stubServer();
    const { useAuth } = await openTab();

    await useAuth.getState().startImpersonation('one-time-code');

    const state = useAuth.getState();
    expect(state.status).toBe('signed-in');
    expect(state.accessToken).toBe('imp-token');
    expect(state.agent?.impersonation).toMatchObject({ session_id: 'sess-1', mode: 'read_only' });
    expect(server.calls('/auth/impersonation/exchange')[0]?.body).toEqual({
      code: 'one-time-code',
    });
    expect(server.calls('/auth/me')[0]?.authorization).toBe('Bearer imp-token');

    expect(JSON.parse(sessionStorage.getItem(IMPERSONATION_KEY)!)).toMatchObject({
      token: 'imp-token',
    });
    expect(localStorage.getItem(REFRESH_KEY)).toBe('browser-refresh-0');
    expect(server.calls('/auth/token')).toHaveLength(0);
    expect(RecordingChannel.posted).toEqual([]);
  });

  it('comes back as the member after a reload, without spending the browser’s refresh token', async () => {
    stubServer();
    await (await openTab()).useAuth.getState().startImpersonation('one-time-code');

    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    expect(useAuth.getState().status).toBe('signed-in');
    expect(useAuth.getState().agent?.account_id).toBe('acct-member');
    expect(server.calls('/auth/token')).toHaveLength(0);
    expect(localStorage.getItem(REFRESH_KEY)).toBe('browser-refresh-0');
  });

  it('never renews: a refused token ends the session and says it ran out', async () => {
    const server = stubServer();
    const tab = await openTab();
    await tab.useAuth.getState().startImpersonation('one-time-code');

    server.endSession();
    await expect(tab.sessionClient().get('/chats')).rejects.toBeDefined();

    const state = tab.useAuth.getState();
    expect(state.status).toBe('signed-out');
    expect(state.impersonationEnded).toBe('expired');
    expect(state.accessToken).toBeNull();
    expect(server.calls('/auth/token')).toHaveLength(0);
    expect(sessionStorage.getItem(IMPERSONATION_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBe('browser-refresh-0');
  });

  it('ends on the server from "End session", and leaves the browser’s session alone', async () => {
    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().startImpersonation('one-time-code');

    await useAuth.getState().signOut();

    const end = server.calls('/auth/impersonation/end');
    expect(end).toHaveLength(1);
    expect(end[0]?.authorization).toBe('Bearer imp-token');
    expect(server.calls('/auth/revoke')).toHaveLength(0);
    expect(useAuth.getState().status).toBe('signed-out');
    expect(useAuth.getState().impersonationEnded).toBe('ended');
    expect(sessionStorage.getItem(IMPERSONATION_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBe('browser-refresh-0');
  });

  it('does not resume a session whose window has passed', async () => {
    const server = stubServer();
    sessionStorage.setItem(
      IMPERSONATION_KEY,
      JSON.stringify({ token: 'imp-token', endsAt: Date.now() - 1000 }),
    );
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    expect(useAuth.getState().status).toBe('signed-out');
    expect(useAuth.getState().impersonationEnded).toBe('expired');
    expect(server.seen).toHaveLength(0);
    expect(sessionStorage.getItem(IMPERSONATION_KEY)).toBeNull();
  });

  it('says a refused code failed and keeps nothing', async () => {
    stubServer();
    vi.stubGlobal('fetch', (async () =>
      json(
        { error: { type: 'authentication', message: 'no', request_id: 'rq-2' } },
        401,
      )) as typeof fetch);
    const { useAuth } = await openTab();

    await expect(useAuth.getState().startImpersonation('spent')).rejects.toBeDefined();
    expect(useAuth.getState().status).not.toBe('signed-in');
    expect(useAuth.getState().error).toBe('authentication');
    expect(sessionStorage.getItem(IMPERSONATION_KEY)).toBeNull();
  });
});
