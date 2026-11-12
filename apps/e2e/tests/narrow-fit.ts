/**
 * Measuring a screen below the desktop layout (GV-04): shared by the narrow
 * specs (tm 472.1 Settings + Customers, tm 472.3 Archive + Reports).
 *
 * A screen fits when the document, the shell's <main> and the page's own
 * scroller are never wider than the window, and no control sits past the
 * window's edge (cut off by a card) unless it is inside a scroller of its own.
 * `widest` names what pokes out when the page does scroll sideways, so a
 * failure says which element to fix.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures.js';

export const BAND = 'The console is designed for desktop';

/** A finger-sized target (WCAG 2.5.5's 44 px). */
export const TOUCH_MIN = 44;

export interface Fit {
  /** px the document, <main> and the page's scroller are wider than their box. */
  doc: number;
  main: number;
  page: number;
  /** Controls past the window's edge, outside any scroller of their own. */
  offscreen: string[];
  /** When the page scrolls sideways: what pokes out of it, outermost first. */
  widest: string[];
}

/** Measures the screen at hand; see the file comment for what counts. */
export async function measureFit(page: Page): Promise<Fit> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) throw new Error('no <main>');
    // The page's own scroller is the element that holds its header (`Page.tsx`).
    const pageEl = main.querySelector('h1')?.closest('header')?.parentElement ?? main;
    const vw = document.documentElement.clientWidth;
    const describe = (el: Element): string => {
      const text = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${text}"`;
    };
    const inOwnScroller = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== pageEl && p !== main; p = p.parentElement) {
        const overflowX = getComputedStyle(p).overflowX;
        if ((overflowX === 'auto' || overflowX === 'scroll') && p.scrollWidth > p.clientWidth) {
          return true;
        }
      }
      return false;
    };

    const offscreen: string[] = [];
    for (const el of Array.from(
      main.querySelectorAll('button, a[href], input, select, textarea, table, pre'),
    )) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= vw + 1 || inOwnScroller(el)) continue;
      // Not on screen at all: a screen reader's copy (the activity strip's table).
      if (el.closest('.sr-only')) continue;
      offscreen.push(`${describe(el)} ends at ${Math.round(box.right)} px`);
    }

    const widest: string[] = [];
    const pageRight = pageEl.getBoundingClientRect().right;
    if (pageEl.scrollWidth > pageEl.clientWidth) {
      for (const el of Array.from(pageEl.querySelectorAll('*'))) {
        const box = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        if (box.width === 0 || box.right <= pageRight + 1 || parent.right > pageRight + 1) continue;
        if (inOwnScroller(el)) continue;
        widest.push(`${describe(el)} is ${Math.round(box.width)} px`);
      }
    }

    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      page: pageEl.scrollWidth - pageEl.clientWidth,
      offscreen: offscreen.slice(0, 5),
      widest: widest.slice(0, 5),
    };
  });
}

export const FITS: Fit = { doc: 0, main: 0, page: 0, offscreen: [], widest: [] };

export async function expectTouchSized(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box, 'the target is on screen').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(TOUCH_MIN);
}

export function widthTag(testInfo: TestInfo): string {
  return (testInfo.project.use.viewport?.width ?? 1280) < 768 ? '375' : '768';
}
