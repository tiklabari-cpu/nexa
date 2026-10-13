/**
 * Panel font presets (owner, 2026-10-13) — the runtime half.
 *
 * `theme.ts`'s shape: a zustand store, a `localStorage` key the pre-paint boot
 * script in `index.html` also reads, and one attribute on `<html>` that the
 * stylesheet keys off (`tokens.css` · `html[data-font=…]`).
 *
 * What differs from the theme: the choice is the **server's** answer. Which
 * preset applies — the workspace default or the member's own, whichever came
 * later — is resolved by the API and arrives with `GET /auth/me`
 * (`appearance`). This module paints that answer and never re-derives it. The
 * stored key only exists so the first paint of the next load is already right
 * instead of flashing Inter while the profile request is in flight.
 *
 * Inter is bundled (`main.tsx`); every other preset's files are fetched on
 * demand with `import()`, so a workspace on Inter downloads nothing extra.
 */
import { create } from 'zustand';
import { formatDate } from './format.js';
import {
  DEFAULT_PANEL_FONT_PRESET,
  isPanelFontPreset,
  PANEL_FONT_PRESETS,
  type PanelAppearance,
  type PanelFontPreset,
} from '@siyahtus/types';

/** Read by the boot script in `index.html` too; `font.test.ts` holds the two together. */
export const FONT_STORAGE_KEY = 'siyahtus.font';

/** Narrow anything to a preset; anything unreadable is the built-in Inter. */
export function coerceFont(value: string | null | undefined): PanelFontPreset {
  return isPanelFontPreset(value) ? value : DEFAULT_PANEL_FONT_PRESET;
}

/** The remembered preset, for the first paint. Storage throws in locked-down browsers. */
export function detectFont(): PanelFontPreset {
  try {
    return coerceFont(globalThis.localStorage?.getItem(FONT_STORAGE_KEY));
  } catch {
    return DEFAULT_PANEL_FONT_PRESET;
  }
}

/**
 * The font files of each preset. Inter is already in the bundle; the rest are
 * separate chunks Vite emits for these dynamic imports.
 */
const FONT_FILES: Record<PanelFontPreset, () => Promise<unknown>> = {
  inter: () => Promise.resolve(),
  'plus-jakarta': () => import('@fontsource-variable/plus-jakarta-sans'),
  'manrope-dm-sans': () =>
    Promise.all([import('@fontsource-variable/manrope'), import('@fontsource-variable/dm-sans')]),
  nunito: () =>
    Promise.all([
      import('@fontsource-variable/nunito'),
      import('@fontsource-variable/nunito-sans'),
    ]),
  figtree: () => import('@fontsource-variable/figtree'),
};

const requested = new Set<PanelFontPreset>();

/** Fetch a preset's files once. A failed fetch leaves the fallback stack showing. */
export function loadFontFiles(preset: PanelFontPreset): Promise<void> {
  if (requested.has(preset)) return Promise.resolve();
  requested.add(preset);
  return FONT_FILES[preset]()
    .then(() => undefined)
    .catch(() => {
      requested.delete(preset);
    });
}

/** Every preset's files — for the pickers, which show each option in its own face. */
export function loadAllFontFiles(): Promise<void> {
  return Promise.all(PANEL_FONT_PRESETS.map(loadFontFiles)).then(() => undefined);
}

/** Paint a preset: the attribute, its files, and the key the next load starts from. */
export function applyFont(preset: PanelFontPreset): void {
  void loadFontFiles(preset);
  if (typeof document !== 'undefined') document.documentElement.dataset.font = preset;
  try {
    globalThis.localStorage?.setItem(FONT_STORAGE_KEY, preset);
  } catch {
    // Not remembered: the next load paints Inter until the profile arrives.
  }
}

interface FontStore {
  /** The preset on screen. */
  font: PanelFontPreset;
  /** The server's last answer; `null` until a profile has loaded. */
  appearance: PanelAppearance | null;
  /** Paint and keep the server's answer. */
  setAppearance: (appearance: PanelAppearance | undefined) => void;
  /** Paint a preset ahead of the server's answer (an optimistic pick). */
  preview: (preset: PanelFontPreset) => void;
}

const initialFont = detectFont();
applyFont(initialFont);

export const useFontStore = create<FontStore>((set) => ({
  font: initialFont,
  appearance: null,
  setAppearance: (appearance) => {
    // An older server sends no `appearance`: the built-in look.
    const font = appearance?.effective_font_preset ?? DEFAULT_PANEL_FONT_PRESET;
    applyFont(font);
    set({ font, appearance: appearance ?? null });
  },
  preview: (preset) => {
    applyFont(preset);
    set({ font: preset });
  },
}));

/** The catalogue key of a preset's display name (`shell.font.<key>`). */
export function fontNameKey(preset: PanelFontPreset): string {
  return `shell.font.${preset}`;
}

/**
 * Where the font on screen comes from, in words — "Workspace default: Figtree ·
 * 12 Oct" — so "the latest choice wins" is visible rather than surprising.
 */
export function fontSourceText(
  t: (key: string, params?: Record<string, string | number>) => string,
  appearance: PanelAppearance | null,
): string {
  const preset = appearance?.effective_font_preset ?? DEFAULT_PANEL_FONT_PRESET;
  const font = t(fontNameKey(preset));
  if (!appearance || appearance.source === 'builtin') {
    return t('shell.account.font.source.builtin', { font });
  }
  const at =
    appearance.source === 'user'
      ? appearance.user_font_preset_set_at
      : appearance.workspace_font_preset_set_at;
  return t(`shell.account.font.source.${appearance.source}`, {
    font,
    date: formatDate(at) ?? '',
  });
}
