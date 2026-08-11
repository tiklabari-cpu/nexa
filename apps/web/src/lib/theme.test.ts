/**
 * The theme primitive: detection, the default, persistence, and the attribute.
 *
 * The load-bearing claims are (a) an agent who has never chosen gets dark — the
 * theme every screenshot and every reference in `apps/e2e/kanit/` was taken in —
 * and (b) a choice reaches `<html data-theme>`, which is the single selector
 * `tokens.css` and every Tailwind `dark:` variant key off.
 *
 * The last block reads `index.html`. That file carries a copy of the storage key
 * and the default in a pre-paint boot script, and a copy that drifts fails in
 * the one way nothing else here can see: the panel would paint the wrong theme
 * for one frame on every load and then correct itself. Same reasoning as
 * `tokens.test.ts` reading `tokens.css` — assert against the artefact, not
 * against a second transcription of it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  coerceTheme,
  DEFAULT_THEME,
  detectTheme,
  getTheme,
  THEME_NAMES,
  THEME_STORAGE_KEY,
  THEMES,
  useThemeStore,
} from './theme.js';
import { hasMessage, LOCALES } from './i18n.js';

beforeEach(() => {
  globalThis.localStorage.removeItem(THEME_STORAGE_KEY);
});

afterEach(() => {
  globalThis.localStorage.removeItem(THEME_STORAGE_KEY);
  useThemeStore.setState({ theme: DEFAULT_THEME });
  document.documentElement.dataset.theme = DEFAULT_THEME;
});

describe('coerceTheme', () => {
  it('only an explicit "light" leaves the default', () => {
    expect(coerceTheme('light')).toBe('light');
    expect(coerceTheme('dark')).toBe('dark');
  });

  it('falls back to dark for anything unrecognised, absent or empty', () => {
    // A value written by an older build, a hand-edited storage entry, or a key
    // that was never there must not leave the panel themeless.
    expect(coerceTheme('solarized')).toBe('dark');
    expect(coerceTheme(null)).toBe('dark');
    expect(coerceTheme(undefined)).toBe('dark');
    expect(coerceTheme('')).toBe('dark');
  });
});

describe('detectTheme', () => {
  it('defaults to dark when nothing has been chosen', () => {
    expect(detectTheme()).toBe('dark');
    expect(DEFAULT_THEME).toBe('dark');
  });

  it('honours a remembered choice', () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(detectTheme()).toBe('light');
  });

  /**
   * The OS preference is deliberately *not* consulted.
   *
   * jsdom reports `prefers-color-scheme` as unmatched and Playwright's default
   * is light, so a theme that followed the environment would flip the product —
   * and every screenshot in the evidence set — depending on where the suite ran.
   * That is the §D82 (tm 108) failure mode: a gate that measures the machine.
   */
  it('ignores the operating system preference', () => {
    expect(detectTheme()).toBe('dark');
    expect(globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false).toBe(false);
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(detectTheme()).toBe('light');
  });
});

describe('applyTheme', () => {
  it('writes the attribute the stylesheet keys off and remembers the choice', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

describe('useThemeStore', () => {
  it('starts on the default and moves the attribute when the switcher changes it', () => {
    expect(getTheme()).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(getTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    // Persisted, so the choice survives the reload the E2E suite performs.
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    useThemeStore.getState().setTheme('dark');
    expect(getTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('the switcher catalogue', () => {
  it('offers both themes, dark first', () => {
    expect([...THEMES]).toEqual(['dark', 'light']);
  });

  it('names every theme in every locale', () => {
    // Unlike languages, theme names are ordinary UI copy — a missing Turkish
    // entry would silently fall back to English inside an otherwise Turkish menu.
    for (const theme of THEMES) {
      for (const locale of LOCALES) {
        expect(hasMessage(locale, THEME_NAMES[theme]), `${locale}:${THEME_NAMES[theme]}`).toBe(
          true,
        );
      }
    }
  });
});

describe('the pre-paint boot script in index.html', () => {
  // `process.cwd()` is the vitest root — `apps/web` — however the suite starts.
  const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const htmlTagStart = INDEX_HTML.indexOf('<html');
  const openingHtmlTag = INDEX_HTML.slice(htmlTagStart, INDEX_HTML.indexOf('>', htmlTagStart) + 1);

  it('no longer hard-codes a theme onto <html>', () => {
    // The defect this task exists to fix: a literal attribute here overrode the
    // light ramp, the `prefers-color-scheme` block and any runtime choice at once.
    expect(openingHtmlTag).not.toMatch(/data-theme/);
  });

  it('reads the same storage key and applies the same default as theme.ts', () => {
    expect(INDEX_HTML).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(INDEX_HTML).toMatch(/=== 'light' \? 'light' : 'dark'/);
    expect(DEFAULT_THEME).toBe('dark');
  });

  it('runs before the deferred module bundle', () => {
    // Order is the whole point: the boot script is a plain inline script in
    // <head>, the bundle is `type="module"` (deferred) at the end of <body>.
    const boot = INDEX_HTML.indexOf('document.documentElement.dataset.theme');
    const headEnd = INDEX_HTML.indexOf('</head>');
    const bundle = INDEX_HTML.indexOf('type="module"');
    expect(boot).toBeGreaterThan(-1);
    expect(boot).toBeLessThan(headEnd);
    expect(bundle).toBeGreaterThan(headEnd);
  });
});
