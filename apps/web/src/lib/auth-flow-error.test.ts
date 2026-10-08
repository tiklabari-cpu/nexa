/**
 * Sign-in failures leave the store as codes, and the screen words them
 * (O14, tm 259.18).
 *
 * The store used to throw `new Error('Workspace not found.')` and the pages
 * printed `error.message`: a Turkish console showed English from a module with
 * no business choosing a language. Pinned from both sides — what the store
 * throws and keeps, and what the page makes of it in each language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from './api-client.js';
import { AuthFlowError, authFailureCode, authFailureMessage } from './auth-flow-error.js';
import { translate } from './i18n.js';

const tEn = (key: string): string => translate('en', key);
const tTr = (key: string): string => translate('tr', key);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A fresh copy of the store against a stubbed `fetch`: `ApiClient` binds
 * `globalThis.fetch` when it is constructed, and the store constructs its
 * anonymous client at module load. The error class comes from the same fresh
 * module graph, or `instanceof` would compare two different classes.
 */
async function openStore(fetchImpl?: typeof fetch) {
  if (fetchImpl) vi.stubGlobal('fetch', fetchImpl);
  vi.resetModules();
  const { useAuth } = await import('./auth-store.js');
  const { AuthFlowError: FreshAuthFlowError } = await import('./auth-flow-error.js');
  return { useAuth, FreshAuthFlowError };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the store throws', () => {
  it('signs in to a workspace the account does not have: a code, and no sentence', async () => {
    const { useAuth, FreshAuthFlowError } = await openStore(
      vi.fn(async () =>
        json({ memberships: [{ license_id: 'L-1', organization_name: 'Acme' }] }),
      ) as unknown as typeof fetch,
    );

    const failure = await useAuth
      .getState()
      .signIn('a@b.co', 'pw', 'L-OTHER')
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(FreshAuthFlowError);
    expect((failure as AuthFlowError).code).toBe('workspace_not_found');
    expect(useAuth.getState().error).toBe('workspace_not_found');
  });

  it('starts single sign-on for a connection with no app: a code', async () => {
    const { useAuth, FreshAuthFlowError } = await openStore(
      vi.fn(async () => json({ client_id: null })) as unknown as typeof fetch,
    );

    const failure = await useAuth
      .getState()
      .startSsoLogin('conn-1')
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(FreshAuthFlowError);
    expect((failure as AuthFlowError).code).toBe('no_app');
    expect(useAuth.getState().error).toBe('no_app');
  });

  it('completes a sign-in this browser never started: a code', async () => {
    const { useAuth, FreshAuthFlowError } = await openStore();
    const failure = await useAuth
      .getState()
      .completeSsoLogin('code', 'state')
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(FreshAuthFlowError);
    expect((failure as AuthFlowError).code).toBe('sso_not_started');
  });
});

describe('authFailureCode', () => {
  it('uses the API error type for a refusal and the fallback for anything else', () => {
    const refusal = new ApiClientError({
      type: 'not_allowed',
      status: 403,
      message: 'English prose from the server',
      requestId: 'req_1',
    });
    expect(authFailureCode(refusal, 'sign_in_failed')).toBe('not_allowed');
    expect(authFailureCode(new TypeError('Failed to fetch'), 'sign_in_failed')).toBe(
      'sign_in_failed',
    );
  });
});

describe('authFailureMessage', () => {
  it('words every store code in both languages, and none falls back to its own key', () => {
    for (const code of ['workspace_not_found', 'no_app', 'sso_not_started'] as const) {
      const en = authFailureMessage(tEn, new AuthFlowError(code), 'auth.callback.genericFailure');
      const tr = authFailureMessage(tTr, new AuthFlowError(code), 'auth.callback.genericFailure');
      expect(en).not.toContain('auth.flow');
      expect(tr).not.toContain('auth.flow');
      expect(tr).not.toBe(en);
    }
  });

  it('puts an API refusal through the error-type catalogue, not the server’s prose', () => {
    const refusal = new ApiClientError({
      type: 'not_allowed',
      status: 403,
      message: 'Slow down, said the server in English',
      requestId: 'req_2',
    });
    const message = authFailureMessage(tTr, refusal, 'auth.callback.genericFailure');
    expect(message).toBe(tTr('common.errors.not_allowed'));
    expect(message).not.toMatch(/Slow down/);
  });

  it('shows a thrown value of unknown shape as the caller’s fallback, never its text', () => {
    const message = authFailureMessage(
      tTr,
      new Error('Failed to fetch'),
      'auth.signin.ssoStartFailed',
    );
    expect(message).toBe('Tek oturum açma başlatılamadı.');
  });
});
