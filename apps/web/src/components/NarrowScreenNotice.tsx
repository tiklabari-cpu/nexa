/**
 * The "designed for desktop" band (tm 259.25 · O6, made per-screen by GV-04 · tm 385).
 *
 * Below 1024 px most of the console still keeps its desktop layout — fixed-width
 * menus, wide tables — and scrolls sideways inside `<main>` rather than sliding
 * the whole page. A screen that has been laid out for a narrow window says so
 * in its navigation entry (`responsive: true`, `isResponsiveRoute`) and gets no
 * band; every other screen gets this band above it, never in place of it, so
 * the console is always reachable.
 *
 * "Continue anyway" dismisses the band for the tab's session (`sessionStorage`):
 * a reload does not show it again, a new tab does. Storage can be unavailable
 * (a privacy mode, a sandboxed frame) — then the choice lasts as long as the page.
 *
 * The decision follows the window, not the first paint: turning a tablet, or
 * narrowing a desktop window, decides again.
 */
import { useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslate } from '../lib/i18n.js';
import { isNarrowLayout, useViewportLayout } from '../lib/viewport.js';
import { isResponsiveRoute } from './navigation.js';

/** Narrower than this, an unadapted screen shows the band. The breakpoint Tailwind calls `lg`. */
export const NARROW_SCREEN_MAX = 1024;

/** The tab's "Continue anyway". */
export const NARROW_SCREEN_KEY = 'siyahtus.narrow_screen.continue';

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

/** Should the band show over the screen at hand, and the way to dismiss it. */
export function useNarrowScreenNotice(): { show: boolean; continueAnyway: () => void } {
  const narrow = isNarrowLayout(useViewportLayout());
  const { pathname } = useLocation();
  const [continued, setContinued] = useState(readContinued);

  return {
    show: narrow && !continued && !isResponsiveRoute(pathname),
    continueAnyway: () => {
      writeContinued();
      setContinued(true);
    },
  };
}

export function NarrowScreenNotice({ onContinue }: { onContinue: () => void }): ReactElement {
  const t = useTranslate();
  return (
    <section
      aria-label={t('shell.narrow.title')}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface-2 px-3 py-2 text-sm"
    >
      <p className="min-w-0 flex-1 basis-64">
        <strong className="font-semibold">{t('shell.narrow.title')}</strong>{' '}
        <span className="text-content-secondary">
          {t('shell.narrow.body')} {t('shell.narrow.mobileApp')}
        </span>
      </p>
      <button
        type="button"
        onClick={onContinue}
        className="min-h-11 shrink-0 rounded-md bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600"
      >
        {t('shell.narrow.continue')}
      </button>
    </section>
  );
}
