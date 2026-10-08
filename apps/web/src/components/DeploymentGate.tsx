/**
 * No screen before this deployment's settings are in (tm 259.4 · ADR
 * docs/adr/pilot-public-readiness.md K-a, "Güncelleme (tm 259.4)").
 *
 * Pilot mode hides surfaces — the demo password on the sign-in form, Billing
 * in the rail, Apps in the menu — and every screen learns it from
 * `GET /deployment`. Drawing first and asking second showed a pilot visitor
 * the ordinary deployment's page until the answer arrived, and for good if it
 * never did. So the whole app waits here, around `App` in `main.tsx`:
 *
 *   - until the first answer, the loading page — nothing below has mounted;
 *   - when three attempts have failed (`deploymentQuery`), "cannot reach the
 *     server" with a way to try again — not the ordinary deployment's screens
 *     on a guess (fail-closed). "Try again" is three attempts more, on the
 *     loading page: with nothing cached, a refetch is a first read again;
 *   - once an answer is cached, the app, for good: a background refetch, even
 *     a failed one, keeps the last answer and never brings this page back.
 *
 * The session restore starts only once the app mounts, after this answer —
 * one round trip more on a page load, the price of not drawing on a guess.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { deploymentQuery } from '../lib/deployment.js';
import { useTranslate } from '../lib/i18n.js';
import { LoadingPage } from './LoadingPage.js';

export function DeploymentGate({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslate();
  const { data, isError, refetch } = useQuery(deploymentQuery);

  if (data !== undefined) return <>{children}</>;
  if (!isError) return <LoadingPage />;

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-xs">
        <h1 className="text-lg font-semibold">{t('auth.startup.unreachable.title')}</h1>
        <p className="mt-2 text-sm text-content-secondary">{t('auth.startup.unreachable.body')}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          {t('auth.startup.unreachable.retry')}
        </button>
      </div>
    </main>
  );
}
