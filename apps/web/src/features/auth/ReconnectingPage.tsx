/**
 * What a session shows while it cannot reach the server (tm 259.2).
 *
 * The stored refresh token is kept through a 429, a 5xx or a dead network, so
 * the agent is still signed in — the panel just has no access token to act
 * with until an attempt gets through. A blank page would read as a crash and
 * the sign-in form as being thrown out, so this says what is happening and
 * offers the two ways on: "Try now", and "Sign out" for an agent who would
 * rather not wait.
 *
 * After a page load it is the whole page. Mid-session `App` lays it over the
 * shell, which stays mounted and inert underneath: a half-typed reply lives in
 * component state and must outlast a two-minute outage.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { cn } from '../../components/ui/cn.js';
import { useAuth } from '../../lib/auth-store.js';
import { usePageTitle } from '../../lib/document-title.js';
import { useTranslate } from '../../lib/i18n.js';

const PROGRESS_KEYS = {
  waiting: 'auth.reconnecting.waiting',
  trying: 'auth.reconnecting.trying',
  paused: 'auth.reconnecting.paused',
} as const;

/** Names the tab "Reconnecting…" while a whole-page reconnect screen is up. */
function ReconnectingTitle(): null {
  const t = useTranslate();
  usePageTitle(t('auth.reconnecting.title'));
  return null;
}

export function ReconnectingPage({ overShell = false }: { overShell?: boolean }): ReactElement {
  const t = useTranslate();
  const progress = useAuth((s) => s.reconnect) ?? 'waiting';
  const retryNow = useAuth((s) => s.retryNow);
  const signOut = useAuth((s) => s.signOut);
  const heading = useRef<HTMLHeadingElement>(null);

  // Over the shell, focus was somewhere that has just turned inert; a keyboard
  // or screen reader user starts again from what this screen says. After a
  // page load nothing had focus, and the page reads from the top as it is.
  useEffect(() => {
    if (overShell) heading.current?.focus();
  }, [overShell]);

  return (
    <main
      className={cn(
        'flex items-center justify-center bg-canvas p-6',
        overShell ? 'fixed inset-0 z-50' : 'min-h-full',
      )}
    >
      {!overShell && <ReconnectingTitle />}
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-xs">
        <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {t('auth.reconnecting.title')}
        </h1>
        <p role="status" className="mt-2 text-sm text-content-secondary">
          {t(PROGRESS_KEYS[progress])}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={retryNow}
            disabled={progress === 'trying'}
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {t('auth.reconnecting.retry')}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            {t('auth.reconnecting.signOut')}
          </button>
        </div>
      </div>
    </main>
  );
}
