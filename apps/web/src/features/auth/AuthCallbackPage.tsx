/**
 * Where a federated sign-in comes back to (NFR-S11 · S11-i).
 *
 * The ACS does not mint a session — it ends where `POST /auth/authorize` ends,
 * with a single-use authorization code, and redirects the browser here with it.
 * This page redeems that code at `/auth/token` using the PKCE verifier the tab
 * kept in `sessionStorage`, which is the whole point of the arrangement: a code
 * that leaks in transit is worthless to anybody but the browser that started
 * the login.
 *
 * There is nothing to click. Success flips the store to `signed-in`, at which
 * point `App` swaps to the signed-in router and `*` lands in the inbox — the
 * redirect is the router's, not this page's, so a session never appears while
 * a stale route is still on screen. Only a failure needs a screen at all.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

export function AuthCallbackPage(): ReactElement {
  const t = useTranslate();
  const [params] = useSearchParams();
  const completeSsoLogin = useAuth((s) => s.completeSsoLogin);
  const [error, setError] = useState<string | null>(null);

  const code = params.get('code');
  const state = params.get('state');
  // The authorization-code exchange is single-use, so it must run exactly once.
  // StrictMode mounts every effect twice in development, and a second attempt
  // would spend an already-spent verifier and report a failure on a sign-in
  // that worked.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!code) {
      setError(t('auth.callback.noCode'));
      return;
    }
    completeSsoLogin(code, state).catch((cause: unknown) => {
      // i18n-ignore: a store-thrown message, not raw server prose reaching the screen.
      setError(cause instanceof Error ? cause.message : t('auth.callback.genericFailure'));
    });
  }, [code, state, completeSsoLogin, t]);

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
            <p className="mt-4 text-xs text-content-secondary">
              <Link to="/" className="text-content-brand underline">
                {t('auth.common.backToSignIn')}
              </Link>
            </p>
          </>
        ) : (
          <p role="status" className="text-sm text-content-secondary">
            {t('auth.callback.signingIn')}
          </p>
        )}
      </div>
    </main>
  );
}
