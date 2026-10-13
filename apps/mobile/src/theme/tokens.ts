/**
 * The RN counterpart of `apps/web/src/styles/tokens.css` (design-brief.md §2–§5).
 *
 * Hand-written, not generated: RN has no CSS custom properties to cascade
 * through, so there is no single file both platforms can share. Colour and
 * radius exist in `tokens.css` as literal values, though, so `tokens.test.ts`
 * parses that file and asserts every value below still matches it — the two
 * cannot silently drift on the numbers that *do* have one shared source.
 * Typography and spacing have no CSS-variable form (design-brief.md §3/§4 and
 * `apps/web/tailwind.config.ts` are prose/JS, not something safe to regex-parse
 * at the same fidelity), so those two are kept in step by hand.
 */

export type ThemeName = 'light' | 'dark';

/** Every colour the app draws with, camelCased from its `--kebab-case` token. */
export interface ColorTokens {
  bgCanvas: string;
  bgSurface: string;
  bgSurface2: string;
  bgRail: string;
  bgInset: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  brand100: string;
  brand500: string;
  brand600: string;
  brand700: string;
  brand950: string;
  brandText: string;
  focusRing: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  ai: string;
  note: string;
  bubbleAgentBg: string;
  bubbleAgentText: string;
  bubbleCustomerBg: string;
  bubbleCustomerText: string;
  bubbleNoteBg: string;
  bubbleAiBg: string;
}

const LIGHT: ColorTokens = {
  bgCanvas: '#f6f6f8',
  bgSurface: '#ffffff',
  bgSurface2: '#f3f3f6',
  bgRail: '#0c0c10',
  bgInset: '#ececf1',
  border: '#e4e4ea',
  borderStrong: '#cfcfd8',

  textPrimary: '#16161d',
  textSecondary: '#4b4b5a',
  textTertiary: '#5f5f6e',
  textInverse: '#ffffff',

  brand100: '#eeedfe',
  brand500: '#5b4fe9',
  brand600: '#4a3fd6',
  brand700: '#372cb3',
  brand950: '#1e1a4a',
  brandText: '#4a3fd6',
  focusRing: '#5b4fe9', // var(--brand-500)

  success: '#0f7349',
  warning: '#925400',
  danger: '#c4253a',
  info: '#0a6b94',
  ai: '#a3218f',
  note: '#7d6210',

  bubbleAgentBg: '#5b4fe9', // var(--brand-500)
  bubbleAgentText: '#ffffff',
  bubbleCustomerBg: '#f0f0f4',
  bubbleCustomerText: '#16161d', // var(--text-primary)
  bubbleNoteBg: '#fff7e6',
  bubbleAiBg: '#fbeff9',
};

/** Dark inherits every token it does not override — same as `[data-theme='dark']` does in CSS. */
const DARK: ColorTokens = {
  ...LIGHT,
  bgCanvas: '#09090c',
  bgSurface: '#111116',
  bgSurface2: '#18181f',
  bgRail: '#050507',
  bgInset: '#0d0d12',
  border: '#24242d',
  borderStrong: '#34343f',

  textPrimary: '#f2f2f5',
  textSecondary: '#a4a4b2',
  textTertiary: '#8a8a99',
  textInverse: '#09090c',

  brandText: '#a5a0ff',
  focusRing: '#8f87ff',

  success: '#3ed68c',
  warning: '#f5b14c',
  danger: '#ff6b7a',
  info: '#4fc3f7',
  ai: '#f08ae0',
  note: '#ffce73',

  bubbleCustomerBg: '#1c1c24',
  bubbleCustomerText: '#f2f2f5', // var(--text-primary), which dark overrides above
  bubbleNoteBg: '#2b2110',
  bubbleAiBg: '#2a1328',
};

export const COLORS: Record<ThemeName, ColorTokens> = { light: LIGHT, dark: DARK };

/** `--radius-sm/md/lg` from `tokens.css`, as RN's unitless px numbers. */
export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/**
 * design-brief.md §3 — size/line-height in px (tokens.css sets the root at the
 * browser default of 16px/rem, so `rem * 16` is exact) and the weight each step
 * carries. `apps/web/tailwind.config.ts`'s `fontSize` scale is the same numbers
 * in rem; this is that table, not a re-derivation of it.
 */
export const FONT_SIZE = {
  '2xs': { size: 11, lineHeight: 16, weight: '500' },
  xs: { size: 12, lineHeight: 18, weight: '500' },
  sm: { size: 13, lineHeight: 20, weight: '400' },
  base: { size: 15, lineHeight: 24, weight: '400' },
  lg: { size: 17, lineHeight: 26, weight: '600' },
  xl: { size: 20, lineHeight: 28, weight: '600' },
  '2xl': { size: 26, lineHeight: 34, weight: '700' },
  '3xl': { size: 34, lineHeight: 42, weight: '700' },
} as const;

/**
 * `Inter var` never actually loads on the web either — `tokens.css` names it
 * first in the stack but ships no `@font-face`, so every browser has always
 * fallen through to the system font that follows it. Bundling `Inter var` here
 * would make the two platforms diverge from what the web app *actually*
 * renders, not converge on it — so RN takes the same fallback directly via
 * `undefined`, which is `Text`'s own signal to use the platform default
 * (San Francisco on iOS, Roboto on Android).
 */
export const FONT_FAMILY = {
  sans: undefined,
  mono: undefined,
} as const;

/** design-brief.md §4 — the 4px-based scale, unitless px for RN's `StyleSheet`. */
export const SPACING = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;
