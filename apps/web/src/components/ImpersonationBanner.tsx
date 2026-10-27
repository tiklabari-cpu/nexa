/**
 * The red band of a support session (tm 389.15 · FR-ADMIN-21 · design.md §G).
 *
 * A SiyahTuş operator is signed in as a member from the root panel: every page
 * of the console says so, in a colour nothing else in the console uses, with
 * the member's address, the mode, a countdown to the session's end and the way
 * out. "End session" closes the platform session — and every token it was
 * traded for — through `POST /auth/impersonation/end`; the countdown reaching
 * zero forgets it here (the server already refuses it).
 *
 * The same red in both themes, white on it at better than 6:1, because this
 * band must never blend into a page. A labelled region rather than a live one:
 * a countdown announced every second would drown everything else out.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useAuth } from '../lib/auth-store.js';
import { useTranslate } from '../lib/i18n.js';

/** `m:ss`, or `h:mm:ss` past the hour. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function ImpersonationBanner(): ReactElement | null {
  const t = useTranslate();
  const impersonation = useAuth((s) => s.agent?.impersonation);
  const email = useAuth((s) => s.agent?.email ?? s.agent?.account_id ?? '');
  const signOut = useAuth((s) => s.signOut);
  const expire = useAuth((s) => s.expireImpersonation);
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);

  const endsAt = impersonation ? Date.parse(impersonation.ends_at) : null;

  // One ticking interval for as long as there is a session; StrictMode's
  // second mount clears the first one's, so there are never two.
  useEffect(() => {
    if (endsAt === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [endsAt]);

  const over = endsAt !== null && endsAt <= now;
  useEffect(() => {
    if (over) expire();
  }, [over, expire]);

  if (!impersonation || endsAt === null) return null;

  return (
    <section
      aria-label={t('shell.impersonation.label')}
      data-testid="impersonation-banner"
      data-mode={impersonation.mode}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-[#8f1d17] bg-[#b3261e] px-4 py-1.5 text-center text-xs text-white"
    >
      <span className="font-semibold uppercase tracking-wide">
        {t('shell.impersonation.label')}
      </span>
      <span>
        {t(
          impersonation.mode === 'read_only'
            ? 'shell.impersonation.readOnly'
            : 'shell.impersonation.full',
          { email },
        )}
      </span>
      <span className="tabular-nums">
        {t('shell.impersonation.endsIn', { time: countdown(endsAt - now) })}
      </span>
      <button
        type="button"
        disabled={ending}
        onClick={() => {
          setEnding(true);
          void signOut();
        }}
        className="rounded-md border border-white/80 px-2 py-0.5 font-medium text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-70"
      >
        {ending ? t('shell.impersonation.ending') : t('shell.impersonation.end')}
      </button>
    </section>
  );
}
