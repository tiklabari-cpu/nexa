/**
 * Panel theme (NFR-I18N2 — the "tema" half of "tema+i18n provider").
 *
 * `tokens.css` has carried a complete light ramp on `:root` since the design
 * system landed, and tm 115 locked both ramps at WCAG AA. None of that was
 * reachable: `index.html` hard-coded `data-theme="dark"` on `<html>` and no code
 * anywhere in `apps/web/src` ever read or wrote that attribute, so the light
 * theme — and the half of `tokens.test.ts` that measures it — guarded a surface
 * no user could ever see. This module is the missing runtime.
 *
 * Deliberately the same shape as `i18n.ts`: a zustand store, `localStorage`, a
 * `THEMES`/`THEME_NAMES` pair for the switcher, and a hook. The two are the same
 * kind of preference — client-local chrome, no server round trip — and the panel
 * does not persist the agent's language server-side either, so persisting the
 * theme there would be a heavier mechanism than the neighbouring feature earns.
 *
 * **Light is the default** (owner, 2026-10-12; it was dark until then). A
 * fixed default, not `prefers-color-scheme`: following the OS would hand the
 * product's appearance to whatever the machine running the suite happens to
 * prefer — the same class of defect as the locale-dependent number
 * formatting of §D82 (tm 108), where the gate measured the laptop rather than
 * the code. The OS preference is therefore not consulted at all; only an
 * explicit choice moves the panel off light.
 */
import { create } from 'zustand';

export type Theme = 'dark' | 'light';

/** The themes offered in the switcher, in display order. Light leads: it is the default. */
export const THEMES: readonly Theme[] = ['light', 'dark'];

/**
 * Catalogue keys rather than literals — unlike `LOCALE_NAMES`, which names each
 * language in its own language and so needs no translation, "Dark"/"Light" are
 * ordinary UI strings and belong to whichever language the agent picked. The
 * switcher renders `t(THEME_NAMES[theme])`.
 */
export const THEME_NAMES: Record<Theme, string> = {
  dark: 'shell.account.theme.dark',
  light: 'shell.account.theme.light',
};

/**
 * Where the choice is remembered.
 *
 * The pre-paint boot script in `index.html` reads this exact key and applies the
 * same default; `theme.test.ts` asserts the two agree, because a drift there
 * would show as a flash of the wrong theme on every load and nothing else.
 */
export const THEME_STORAGE_KEY = 'siyahtus.admin.theme';

/** What an agent who has never chosen sees, and what any unreadable value falls back to. */
export const DEFAULT_THEME: Theme = 'light';

/** Narrow anything to a supported theme; only an explicit `dark` leaves the default. */
export function coerceTheme(value: string | null | undefined): Theme {
  return value === 'dark' ? 'dark' : DEFAULT_THEME;
}

/**
 * Initial theme: a remembered choice, otherwise light. Wrapped because storage
 * access throws outright in locked-down browsers.
 */
export function detectTheme(): Theme {
  try {
    return coerceTheme(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Paint the theme. `tokens.css` keys the dark ramp off `[data-theme='dark']` and
 * `tailwind.config.ts` keys every `dark:` variant off the same selector, so this
 * one attribute is the whole switch.
 */
function writeThemeAttribute(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  // `index.css` eases colour changes on every control. Without this pause a
  // theme switch would ease them too — controls fading across while the panels
  // around them snap — and anything reading colours in that window (axe, a
  // screenshot) would measure a half-painted page. `.theme-switching` turns
  // transitions off for the two frames the repaint takes.
  root.classList.add('theme-switching');
  root.dataset.theme = theme;
  const settle = globalThis.requestAnimationFrame ?? ((cb: () => void) => setTimeout(cb, 16));
  settle(() => settle(() => root.classList.remove('theme-switching')));
}

/**
 * Apply a *chosen* theme: paint it and remember it.
 *
 * Only a choice is persisted. Module init below paints without writing, so an
 * agent who never opens the switcher leaves no key behind — which keeps "never
 * chose" distinguishable from "chose dark" for whatever a later revision wants
 * to do with that (a third `system` option being the obvious one).
 */
export function applyTheme(theme: Theme): void {
  writeThemeAttribute(theme);
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A theme that cannot be remembered simply resets next load — not fatal.
  }
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const initialTheme = detectTheme();
writeThemeAttribute(initialTheme);

/**
 * The one source of the active theme.
 *
 * The attribute, not this store, is what the browser obeys — the store exists so
 * the switcher can show which option is selected and so a test can drive the
 * change through the same path the UI does.
 */
export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

/** `{ theme, setTheme }` — for the theme switcher. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return { theme, setTheme };
}

/** Read the active theme without React — for the odd non-component caller. */
export function getTheme(): Theme {
  return useThemeStore.getState().theme;
}
