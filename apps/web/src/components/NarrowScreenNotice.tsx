/**
 * The console on a narrow screen (tm 259.25 · O6).
 *
 * The panel is laid out for a desktop — a 3-pane inbox, fixed-width menus — and
 * at 390 px the inbox measured ~1415 px wide. Until the owner decides between a
 * fully responsive console and "use the mobile app on a phone" (PLAN §D207), a
 * window narrower than {@link NARROW_SCREEN_MAX} is told so and offered the way
 * on, rather than handed a page that slides sideways.
 *
 * "Continue anyway" is remembered for the tab's session (`sessionStorage`): a
 * reload does not ask again, a new tab does. Storage can be unavailable (a
 * privacy mode, a sandboxed frame) — then the choice lasts as long as the page.
 *
 * The decision follows the window, not the first paint: turning a tablet, or
 * narrowing a desktop window, decides again (`resize`). The shell stays mounted
 * underneath, so turning back finds the console exactly where it was.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BASE_TITLE } from '../lib/document-title.js';
import { useTranslate } from '../lib/i18n.js';

/** Narrower than this, the console asks first. The breakpoint Tailwind calls `lg`. */
export const NARROW_SCREEN_MAX = 1024;

/** The tab's "Continue anyway". */
export const NARROW_SCREEN_KEY = 'siyahtus.narrow_screen.continue';

function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < NARROW_SCREEN_MAX;
}

function readContinued(): boolean {
  try {
    return window.sessionStorage.getItem(NARROW_SCREEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeContinued(): void {
  try {
    window.sessionStorage.setItem(NARROW_SCREEN_KEY, '1');
  } catch {
    // Storage is unavailable: the choice holds until the page is reloaded.
  }
}

/** Should the notice stand in for the console right now, and the way past it. */
export function useNarrowScreenNotice(): { show: boolean; continueAnyway: () => void } {
  const [narrow, setNarrow] = useState(isNarrow);
  const [continued, setContinued] = useState(readContinued);

  useEffect(() => {
    const onResize = (): void => setNarrow(isNarrow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    show: narrow && !continued,
    continueAnyway: () => {
      writeContinued();
      setContinued(true);
    },
  };
}

export function NarrowScreenNotice({ onContinue }: { onContinue: () => void }): ReactElement {
  const t = useTranslate();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Whatever held focus may have just been hidden with the console (a turned
  // tablet); the notice is what a screen reader should be reading now.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6 text-content">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white"
          >
            S
          </span>
          <span className="text-lg font-semibold">{BASE_TITLE}</span>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
            {t('shell.narrow.title')}
          </h1>
          <p className="text-sm text-content-secondary">{t('shell.narrow.body')}</p>
          <p className="text-sm text-content-secondary">{t('shell.narrow.mobileApp')}</p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-2 w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white"
          >
            {t('shell.narrow.continue')}
          </button>
        </div>
      </div>
    </main>
  );
}
