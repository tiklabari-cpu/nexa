/**
 * The console's width classes (GV-04 · tm 385).
 *
 *   wide     ≥ 1280   the inbox's three panes and the Views menu, Details open
 *   desktop  1024–1279 the same panes; Details starts closed
 *   tablet   768–1023 two panes (list + transcript); Details and Copilot slide up
 *   phone    < 768    one pane at a time, with a way back
 *
 * Read from `matchMedia`, the same test the stylesheet's own breakpoints make,
 * so a component and a Tailwind `max-md:` class never disagree about where a
 * window stands. Where there is no `matchMedia` (jsdom, an old engine) the
 * answer is `wide`: the full desktop layout every other test renders.
 */
import { useEffect, useState } from 'react';

export type ViewportLayout = 'wide' | 'desktop' | 'tablet' | 'phone';

/** The lower edge of each class, in CSS px — Tailwind's `xl`, `lg` and `md`. */
export const LAYOUT_MIN_WIDTH = { wide: 1280, desktop: 1024, tablet: 768 } as const;

function matches(minWidth: number): boolean {
  return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
}

export function readViewportLayout(): ViewportLayout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
  if (matches(LAYOUT_MIN_WIDTH.wide)) return 'wide';
  if (matches(LAYOUT_MIN_WIDTH.desktop)) return 'desktop';
  if (matches(LAYOUT_MIN_WIDTH.tablet)) return 'tablet';
  return 'phone';
}

/** Below the desktop layout: the shell's rail stays narrow and the inbox drops a pane. */
export function isNarrowLayout(layout: ViewportLayout): boolean {
  return layout === 'tablet' || layout === 'phone';
}

/** The window's width class, live: turning a tablet or narrowing a window decides again. */
export function useViewportLayout(): ViewportLayout {
  const [layout, setLayout] = useState(readViewportLayout);

  useEffect(() => {
    const update = (): void => setLayout(readViewportLayout());
    // `resize` covers every edge at once and an engine whose media lists do not
    // fire `change`; the media lists cover a zoom that changes no pixel width.
    window.addEventListener('resize', update);
    const lists =
      typeof window.matchMedia === 'function'
        ? Object.values(LAYOUT_MIN_WIDTH).map((px) => window.matchMedia(`(min-width: ${px}px)`))
        : [];
    for (const list of lists) list.addEventListener?.('change', update);
    update();
    return () => {
      window.removeEventListener('resize', update);
      for (const list of lists) list.removeEventListener?.('change', update);
    };
  }, []);

  return layout;
}

/** The CSS variable the shell's height reads while {@link useVisualViewportHeight} runs. */
export const APP_HEIGHT_VAR = '--app-height';

/**
 * Keep the shell as tall as what is visible, not as the page.
 *
 * On iOS the on-screen keyboard shrinks the *visual* viewport and leaves the
 * layout viewport alone, so a composer pinned to the bottom of a 100%-high
 * shell sits under the keyboard. The visible height is written to
 * {@link APP_HEIGHT_VAR} on `<html>` while `enabled`, and removed after.
 */
export function useVisualViewportHeight(enabled: boolean): void {
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!enabled || !viewport) return;
    const root = document.documentElement;
    const update = (): void => {
      root.style.setProperty(APP_HEIGHT_VAR, `${Math.round(viewport.height)}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      root.style.removeProperty(APP_HEIGHT_VAR);
    };
  }, [enabled]);
}
