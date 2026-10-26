/**
 * Where "enter as the customer" lands (tm 389.15 · FR-ADMIN-21 · design.md §G).
 *
 * The root panel opened a session on one member and sent the operator's new
 * tab to `/auth/impersonate#code=…`. The code is in the fragment so it never
 * reaches a server log, a proxy or a referrer; this page takes it out of the
 * address bar at once (a reload, the history or a shared screen must not show
 * it) and trades it at `POST /auth/impersonation/exchange`. Success signs this
 * tab in as the member and `App` swaps to the console — the redirect is the
 * router's, as in `AuthCallbackPage`. Only a failure needs a screen.
 *
 * The trade is single-use, so it runs once: StrictMode mounts every effect
 * twice in development, and a second attempt would spend a spent code and
 * report a failure on an entry that worked.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import { authFailureMessage } from '../../lib/auth-flow-error.js';
import { useAuth, type ImpersonationEnd } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

/** The code from `#code=…`, or null. */
export function handoffCodeOf(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('code');
  return code && code.length > 0 ? code : null;
}

function Stage({ children }: { children: ReactElement }): ReactElement {
  return (
    <main className="auth-stage flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm text-center">{children}</div>
    </main>
  );
}

export function ImpersonatePage(): ReactElement {
  const t = useTranslate();
  const startImpersonation = useAuth((s) => s.startImpersonation);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = handoffCodeOf(window.location.hash);
    // Out of the address bar before anything else happens, whatever happens.
    window.history.replaceState(null, '', window.location.pathname);
    if (!code) {
      setError(t('auth.impersonate.noCode'));
      return;
    }
    startImpersonation(code).catch((cause: unknown) => {
      // Spent, late or unknown are one 401 on purpose; say what to do about it.
      if (cause instanceof ApiClientError && cause.status === 401) {
        setError(t('auth.impersonate.invalid'));
        return;
      }
      setError(authFailureMessage(t, cause, 'auth.impersonate.failed'));
    });
  }, [startImpersonation, t]);

  return (
    <Stage>
      {error ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          <p className="text-xs text-content-secondary">{t('auth.impersonate.again')}</p>
        </div>
      ) : (
        <p role="status" className="text-sm text-content-secondary">
          {t('auth.impersonate.entering')}
        </p>
      )}
    </Stage>
  );
}

const ENDED_KEYS: Record<ImpersonationEnd, string> = {
  ended: 'auth.impersonate.ended',
  expired: 'auth.impersonate.expired',
  unreachable: 'auth.impersonate.unreachable',
};

/** What an impersonation tab shows once its session is over: nothing to sign in to. */
export function ImpersonationEndedPage({ reason }: { reason: ImpersonationEnd }): ReactElement {
  const t = useTranslate();
  return (
    <Stage>
      <div className="flex flex-col gap-3" data-testid="impersonation-ended">
        <h1 className="text-lg font-semibold text-content">{t('auth.impersonate.endedTitle')}</h1>
        <p role="status" className="text-sm text-content-secondary">
          {t(ENDED_KEYS[reason])}
        </p>
        <p className="text-xs text-content-secondary">{t('auth.impersonate.closeTab')}</p>
      </div>
    </Stage>
  );
}
